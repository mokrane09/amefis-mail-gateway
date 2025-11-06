const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const logger = require('./logger');

const IDLE_RECYCLE_MIN = 25 * 60 * 1000; // 25 minutes
const IDLE_RECYCLE_MAX = 29 * 60 * 1000; // 29 minutes

class ImapManager {
  constructor() {
    this.client = null;
    this.capabilities = {
      idle: false,
      move: false,
      condstore: false,
      qresync: false
    };
    this.idleTimer = null;
    this.currentMailbox = null;
    this.eventCallbacks = {
      onExists: null,
      onExpunge: null,
      onFlags: null
    };
  }

  async connect({ host, port, secure, email, password }) {
    const imapConfig = {
      host: host || process.env.IMAP_DEFAULT_HOST,
      port: port || parseInt(process.env.IMAP_DEFAULT_PORT || '993', 10),
      secure: secure !== undefined ? secure : (process.env.IMAP_DEFAULT_SECURE === 'true'),
      auth: {
        user: email,
        pass: password
      },
      logger: false
    };

    this.client = new ImapFlow(imapConfig);

    this.client.on('error', (err) => {
      logger.error('IMAP client error', { email, error: err.message });
    });

    this.client.on('close', () => {
      logger.info('IMAP connection closed', { email });
      this.stopIdle();
    });

    await this.client.connect();
    logger.info('IMAP connected', { email, host: imapConfig.host });

    // Detect capabilities
    this.detectCapabilities();

    return this.client;
  }

  detectCapabilities() {
    if (!this.client) return;

    const caps = this.client.capabilities || new Set();
    this.capabilities.idle = caps.has('IDLE');
    this.capabilities.move = caps.has('MOVE');
    this.capabilities.condstore = caps.has('CONDSTORE');
    this.capabilities.qresync = caps.has('QRESYNC');

    logger.info('IMAP capabilities detected', this.capabilities);
  }

  getCapabilities() {
    return { ...this.capabilities };
  }

  async listFolders() {
    if (!this.client) throw new Error('IMAP client not connected');

    const list = await this.client.list();
    
    return list.map(folder => {
      // Detect special use flags
      let specialUse = null;
      if (folder.specialUse) {
        specialUse = folder.specialUse;
      } else if (folder.flags) {
        const flags = Array.isArray(folder.flags) ? folder.flags : [];
        const specialFlag = flags.find(f => f.startsWith('\\'));
        if (specialFlag) {
          specialUse = specialFlag;
        }
      }

      return {
        name: folder.name,
        path: folder.path,
        specialUse,
        delimiter: folder.delimiter
      };
    });
  }

  async openMailbox(path, options = {}) {
    if (!this.client) throw new Error('IMAP client not connected');

    const mailbox = await this.client.mailboxOpen(path, options);
    this.currentMailbox = path;

    logger.debug('Mailbox opened', { 
      path, 
      uidValidity: mailbox.uidValidity,
      uidNext: mailbox.uidNext,
      exists: mailbox.exists 
    });

    return {
      path: mailbox.path,
      uidValidity: mailbox.uidValidity,
      uidNext: mailbox.uidNext,
      exists: mailbox.exists,
      highestModseq: mailbox.highestModseq || null
    };
  }

  async closeMailbox() {
    if (this.client && this.currentMailbox) {
      await this.client.mailboxClose();
      this.currentMailbox = null;
    }
  }

  async fetchNewestUIDs(path, limit = 50) {
    const mailbox = await this.openMailbox(path);
    
    if (mailbox.exists === 0) {
      return [];
    }

    const start = Math.max(1, mailbox.exists - limit + 1);
    const range = `${start}:*`;

    const messages = [];
    for await (const msg of this.client.fetch(range, { 
      uid: true,
      flags: true,
      envelope: true,
      bodyStructure: true,
      size: true
    })) {
      messages.push(msg);
    }

    return messages;
  }

  async fetchByUIDs(uids, options = {}) {
    if (!this.client) throw new Error('IMAP client not connected');
    if (!uids || uids.length === 0) return [];

    const fetchOptions = {
      uid: true,
      flags: true,
      envelope: true,
      bodyStructure: true,
      size: true,
      ...options
    };

    const messages = [];
    const uidRange = uids.join(',');
    
    for await (const msg of this.client.fetch(uidRange, fetchOptions, { uid: true })) {
      messages.push(msg);
    }

    return messages;
  }

  async fetchMessageSource(uid) {
    if (!this.client) throw new Error('IMAP client not connected');
    
    const { content } = await this.client.download(String(uid), false, { uid: true });
    return content;
  }

  async parseMessage(uid) {
    const source = await this.fetchMessageSource(uid);
    const parsed = await simpleParser(source);
    return parsed;
  }

  async setFlags(uid, flags, options = {}) {
    if (!this.client) throw new Error('IMAP client not connected');
    
    const action = options.remove ? { del: flags } : { add: flags };
    await this.client.messageFlagsSet(String(uid), flags, action);
  }

  async moveMessage(uid, targetPath) {
    if (!this.client) throw new Error('IMAP client not connected');

    if (this.capabilities.move) {
      await this.client.messageMove(String(uid), targetPath, { uid: true });
    } else {
      // Fallback: copy + delete
      await this.client.messageCopy(String(uid), targetPath, { uid: true });
      await this.client.messageFlagsAdd(String(uid), ['\\Deleted'], { uid: true });
    }
  }

  async deleteMessage(uid, hard = false) {
    if (!this.client) throw new Error('IMAP client not connected');

    await this.client.messageFlagsAdd(String(uid), ['\\Deleted'], { uid: true });
    
    if (hard) {
      await this.client.mailboxClose();
      await this.openMailbox(this.currentMailbox);
    }
  }

  async searchUIDs(criteria) {
    if (!this.client) throw new Error('IMAP client not connected');
    
    return await this.client.search(criteria, { uid: true });
  }

  async getStatus(path) {
    if (!this.client) throw new Error('IMAP client not connected');
    
    const status = await this.client.status(path, {
      messages: true,
      uidNext: true,
      uidValidity: true,
      highestModseq: true
    });

    return status;
  }

  async startIdle(onUpdate) {
    if (!this.capabilities.idle || !this.client) return;

    this.stopIdle();

    try {
      // Set up event listeners
      if (onUpdate) {
        this.client.on('exists', (data) => {
          logger.debug('IDLE: new message', { count: data.count });
          onUpdate({ type: 'exists', data });
        });

        this.client.on('expunge', (data) => {
          logger.debug('IDLE: message expunged', { seq: data.seq });
          onUpdate({ type: 'expunge', data });
        });

        this.client.on('flags', (data) => {
          logger.debug('IDLE: flags updated', { uid: data.uid });
          onUpdate({ type: 'flags', data });
        });
      }

      // Start IDLE in background (don't await - it blocks until IDLE ends)
      this.client.idle().then(() => {
        logger.debug('IDLE ended', { mailbox: this.currentMailbox });
      }).catch(err => {
        logger.error('IDLE error', { error: err.message });
      });
      
      logger.info('IDLE started on mailbox', { mailbox: this.currentMailbox });

      // Schedule idle recycling between 25-29 minutes
      const recycleTime = IDLE_RECYCLE_MIN + Math.random() * (IDLE_RECYCLE_MAX - IDLE_RECYCLE_MIN);
      this.idleTimer = setTimeout(async () => {
        logger.debug('Recycling IDLE connection');
        await this.stopIdle();
        await this.startIdle(onUpdate);
      }, recycleTime);

    } catch (err) {
      logger.error('Failed to start IDLE', { error: err.message });
    }
  }

  async stopIdle() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    try {
      if (this.client && this.client.idling) {
        this.client.idling = false;
        logger.debug('IDLE stopped');
      }
    } catch (err) {
      logger.error('Error stopping IDLE', { error: err.message });
    }
  }

  async disconnect() {
    await this.stopIdle();
    
    if (this.client) {
      try {
        await this.client.logout();
      } catch (err) {
        logger.error('Error during IMAP logout', { error: err.message });
      }
      this.client = null;
    }
  }

  isConnected() {
    return this.client && this.client.usable;
  }
}

module.exports = ImapManager;

