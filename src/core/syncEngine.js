const cron = require('node-cron');
const dayjs = require('dayjs');
const { getDb } = require('./db');
const sessionStore = require('./sessionStore');
const logger = require('./logger');
const files = require('./files');

let syncCronJob = null;
let expiryCronJob = null;

// SSE clients registry: sessionId -> Set of response objects
const sseClients = new Map();

function registerSSEClient(sessionId, res) {
  if (!sseClients.has(sessionId)) {
    sseClients.set(sessionId, new Set());
  }
  sseClients.get(sessionId).add(res);
  logger.debug('SSE client registered', { sessionId });
}

function unregisterSSEClient(sessionId, res) {
  if (sseClients.has(sessionId)) {
    sseClients.get(sessionId).delete(res);
    if (sseClients.get(sessionId).size === 0) {
      sseClients.delete(sessionId);
    }
  }
  logger.debug('SSE client unregistered', { sessionId });
}

function notifySSEClients(sessionId, event) {
  if (!sseClients.has(sessionId)) return;
  
  const message = `data: ${JSON.stringify(event)}\n\n`;
  
  for (const res of sseClients.get(sessionId)) {
    try {
      res.write(message);
    } catch (err) {
      logger.error('Failed to send SSE event', { sessionId, error: err.message });
    }
  }
}

async function syncFolder(session, folder, knex) {
  const { imapClient, sessionId } = session;
  
  try {
    if (!imapClient.isConnected()) {
      logger.warn('IMAP client not connected for sync', { sessionId, folder: folder.path });
      return;
    }

    const mailbox = await imapClient.openMailbox(folder.path);
    
    // Update folder metadata
    await knex('folders')
      .where({ id: folder.id })
      .update({
        uid_next: mailbox.uidNext,
        highest_modseq: mailbox.highestModseq
      });

    const capabilities = imapClient.getCapabilities();

    if (capabilities.condstore && folder.highest_modseq) {
      // Use CONDSTORE for efficient delta sync
      await syncWithCondstore(session, folder, mailbox, knex);
    } else {
      // Fallback: check for new messages by UIDNEXT
      await syncByUidNext(session, folder, mailbox, knex);
    }

    // Check for flag changes on recent messages (last 1000 UIDs)
    await syncFlagChanges(session, folder, knex);

  } catch (err) {
    logger.error('Folder sync failed', { 
      sessionId, 
      folder: folder.path, 
      error: err.message 
    });
  }
}

async function syncWithCondstore(session, folder, mailbox, knex) {
  const { imapClient, sessionId } = session;
  
  try {
    // Fetch messages changed since last known modseq
    const criteria = {
      modseq: folder.highest_modseq
    };

    const uids = await imapClient.searchUIDs(criteria);
    
    if (uids.length > 0) {
      logger.debug('CONDSTORE delta found', { 
        sessionId, 
        folder: folder.path, 
        count: uids.length 
      });

      const messages = await imapClient.fetchByUIDs(uids);
      await processMessages(messages, folder, sessionId, knex);
    }

  } catch (err) {
    logger.error('CONDSTORE sync failed', { sessionId, error: err.message });
  }
}

async function syncByUidNext(session, folder, mailbox, knex) {
  const { imapClient, sessionId } = session;
  
  try {
    // Get highest UID we have stored
    const result = await knex('messages')
      .where({ folder_id: folder.id })
      .max('uid as max_uid')
      .first();

    const lastUid = result?.max_uid || 0;
    const newUidNext = mailbox.uidNext;

    if (newUidNext > lastUid + 1) {
      // New messages available
      const startUid = lastUid + 1;
      const endUid = newUidNext - 1;
      const range = `${startUid}:${endUid}`;

      logger.debug('Fetching new messages', { 
        sessionId, 
        folder: folder.path, 
        range 
      });

      const uids = await imapClient.searchUIDs({ uid: range });
      
      if (uids.length > 0) {
        const messages = await imapClient.fetchByUIDs(uids);
        await processNewMessages(messages, folder, sessionId, knex);
        
        // Notify SSE clients
        notifySSEClients(sessionId, {
          type: 'new',
          data: {
            folderId: folder.id,
            folderPath: folder.path,
            count: messages.length
          }
        });
      }
    }

  } catch (err) {
    logger.error('UID-based sync failed', { sessionId, error: err.message });
  }
}

async function syncFlagChanges(session, folder, knex) {
  const { imapClient, sessionId } = session;
  
  try {
    // Get recent UIDs (last 1000)
    const recentMessages = await knex('messages')
      .where({ folder_id: folder.id })
      .orderBy('uid', 'desc')
      .limit(1000)
      .select('id', 'uid', 'seen', 'flagged', 'answered', 'deleted');

    if (recentMessages.length === 0) return;

    const uids = recentMessages.map(m => m.uid);
    const fetchedMessages = await imapClient.fetchByUIDs(uids);

    for (const fetched of fetchedMessages) {
      const stored = recentMessages.find(m => m.uid === fetched.uid);
      if (!stored) continue;

      const flags = extractFlags(fetched.flags);
      
      // Check if flags changed
      if (
        flags.seen !== stored.seen ||
        flags.flagged !== stored.flagged ||
        flags.answered !== stored.answered ||
        flags.deleted !== stored.deleted
      ) {
        await knex('messages')
          .where({ id: stored.id })
          .update({
            seen: flags.seen,
            flagged: flags.flagged,
            answered: flags.answered,
            deleted: flags.deleted
          });

        notifySSEClients(sessionId, {
          type: 'flags',
          data: {
            messageId: stored.id,
            flags
          }
        });
      }
    }

  } catch (err) {
    logger.error('Flag sync failed', { sessionId, error: err.message });
  }
}

async function processMessages(messages, folder, sessionId, knex) {
  // Update existing messages (flags, etc)
  for (const msg of messages) {
    const flags = extractFlags(msg.flags);
    
    await knex('messages')
      .where({ folder_id: folder.id, uid: msg.uid })
      .update({
        seen: flags.seen,
        flagged: flags.flagged,
        answered: flags.answered,
        deleted: flags.deleted
      });
  }
}

async function processNewMessages(messages, folder, sessionId, knex) {
  const { v4: uuidv4 } = require('uuid');
  const { simpleParser } = require('mailparser');
  const html = require('./html');
  const files = require('./files');
  
  // Get session email for file storage
  const session = await knex('sessions').where({ id: sessionId }).first();
  if (!session) return;
  
  // Get IMAP client from active sessions
  const activeSessions = sessionStore.getAllActiveSessions();
  const activeSession = activeSessions.find(s => s.sessionId === sessionId);
  if (!activeSession) return;
  
  const imapClient = activeSession.imapClient;
  
  for (const msg of messages) {
    try {
      const envelope = msg.envelope || {};
      const flags = extractFlags(msg.flags);
      
      // Compute thread key
      const threadKey = computeThreadKey(envelope);
      
      // Parse full message for body and attachments
      const source = await imapClient.fetchMessageSource(msg.uid);
      const parsed = await simpleParser(source);
      
      let bodyText = '';
      let bodyHtml = '';
      let hasText = false;
      let hasHtml = false;
      
      if (parsed.text) {
        bodyText = parsed.text;
        hasText = true;
      }
      
      if (parsed.html) {
        bodyHtml = parsed.html;
        hasHtml = true;
      }
      
      const snippet = html.createSnippet(bodyText || html.extractPlainText(bodyHtml), 200);
      
      const messageId = uuidv4();
      
      await knex('messages').insert({
        id: messageId,
        session_id: sessionId,
        folder_id: folder.id,
        uid: msg.uid,
        msg_id: envelope.messageId || null,
        thread_key: threadKey,
        subject: envelope.subject || null,
        date: envelope.date || null,
        from_name: envelope.from?.[0]?.name || null,
        from_email: envelope.from?.[0]?.address || null,
        to_list: envelope.to?.map(a => a.address).join(', ') || null,
        cc_list: envelope.cc?.map(a => a.address).join(', ') || null,
        bcc_list: envelope.bcc?.map(a => a.address).join(', ') || null,
        seen: flags.seen,
        flagged: flags.flagged,
        answered: flags.answered,
        draft: flags.draft,
        deleted: flags.deleted,
        has_html: hasHtml,
        has_text: hasText,
        snippet,
        size: msg.size || 0,
        has_attachments: (parsed.attachments?.length || 0) > 0,
        body_tsv: knex.raw('to_tsvector(\'simple\', ?)', [bodyText])
      }).onConflict(['folder_id', 'uid']).ignore();
      
      // Process attachments
      if (parsed.attachments && parsed.attachments.length > 0) {
        for (const attachment of parsed.attachments) {
          try {
            const isInline = !!attachment.contentId;
            const cid = attachment.contentId ? attachment.contentId.replace(/^<|>$/g, '') : null;
            
            const { relativePath } = await files.saveAttachment(
              session.email,
              messageId,
              attachment.filename || 'unnamed',
              attachment.content
            );
            
            await knex('attachments').insert({
              session_id: sessionId,
              message_id: messageId,
              filename: attachment.filename || 'unnamed',
              mime_type: attachment.contentType || 'application/octet-stream',
              size: attachment.size || 0,
              path: relativePath,
              is_inline: isInline,
              cid
            });
          } catch (err) {
            logger.error('Failed to save attachment during sync', { 
              messageId, 
              filename: attachment.filename,
              error: err.message 
            });
          }
        }
      }
    } catch (err) {
      logger.error('Failed to process new message during sync', { 
        uid: msg.uid,
        folder: folder.path,
        error: err.message 
      });
    }
  }
}

function computeThreadKey(envelope) {
  if (envelope.references && envelope.references.length > 0) {
    return envelope.references[0];
  }
  if (envelope.inReplyTo) {
    return envelope.inReplyTo;
  }
  return envelope.messageId || null;
}

function extractFlags(flags) {
  // Handle different flag formats: Array, Set, or undefined
  let flagArray = [];
  
  if (!flags) {
    flagArray = [];
  } else if (Array.isArray(flags)) {
    flagArray = flags;
  } else if (flags instanceof Set) {
    flagArray = Array.from(flags);
  } else if (typeof flags === 'object') {
    // Handle object with flags property or other structures
    flagArray = flags.flags ? Array.from(flags.flags) : [];
  }
  
  const flagSet = new Set(flagArray.map(f => String(f).toLowerCase()));
  
  return {
    seen: flagSet.has('\\seen'),
    flagged: flagSet.has('\\flagged'),
    answered: flagSet.has('\\answered'),
    draft: flagSet.has('\\draft'),
    deleted: flagSet.has('\\deleted')
  };
}

async function syncAllActiveSessions() {
  const startTime = Date.now();
  const { knex } = getDb();
  const activeSessions = sessionStore.getAllActiveSessions();

  if (activeSessions.length === 0) return;

  logger.debug('Starting sync for active sessions', { count: activeSessions.length });

  for (const session of activeSessions) {
    try {
      // Get all folders for this session
      const folders = await knex('folders')
        .where({ session_id: session.sessionId })
        .select('*');

      for (const folder of folders) {
        await syncFolder(session, folder, knex);
      }

    } catch (err) {
      logger.error('Session sync failed', { 
        sessionId: session.sessionId, 
        error: err.message 
      });
    }
  }

  const duration = Date.now() - startTime;
  logger.debug('Sync completed', { duration, sessions: activeSessions.length });
}

async function expireInactiveSessions() {
  const { knex } = getDb();
  const now = dayjs();
  const sessionDurationHours = parseInt(process.env.SESSION_DURATION_HOURS || '2', 10);

  try {
    // Find expired sessions in DB (check both expires_at and last_seen_at for safety)
    const expiredSessions = await knex('sessions')
      .where('expires_at', '<', now.toISOString())
      .orWhere('last_seen_at', '<', now.subtract(sessionDurationHours, 'hours').toISOString())
      .select('*');

    if (expiredSessions.length === 0) return;

    logger.info('Expiring sessions', { count: expiredSessions.length });

    for (const session of expiredSessions) {
      try {
        // Close IMAP connection
        const memorySession = sessionStore.getAllActiveSessions()
          .find(s => s.sessionId === session.id);

        if (memorySession) {
          await memorySession.imapClient.disconnect();
          sessionStore.deleteSessionById(session.id);
        }

        // Delete session from DB (cascade will clean messages, folders, attachments)
        await knex('sessions').where({ id: session.id }).delete();

        // Delete attachments directory
        await files.deleteSessionAttachments(session.email);

        // Close any SSE connections
        if (sseClients.has(session.id)) {
          for (const res of sseClients.get(session.id)) {
            res.end();
          }
          sseClients.delete(session.id);
        }

        logger.info('Session expired', { 
          sessionId: session.id, 
          email: session.email 
        });

      } catch (err) {
        logger.error('Failed to expire session', { 
          sessionId: session.id, 
          error: err.message 
        });
      }
    }

  } catch (err) {
    logger.error('Session expiry job failed', { error: err.message });
  }
}

function startSyncEngine() {
  // Sync active sessions every minute
  syncCronJob = cron.schedule('*/1 * * * *', async () => {
    await syncAllActiveSessions();
  });

  // Expire inactive sessions every minute
  expiryCronJob = cron.schedule('*/1 * * * *', async () => {
    await expireInactiveSessions();
  });

  logger.info('Sync engine started');
}

function stopSyncEngine() {
  if (syncCronJob) {
    syncCronJob.stop();
    syncCronJob = null;
  }
  
  if (expiryCronJob) {
    expiryCronJob.stop();
    expiryCronJob = null;
  }

  logger.info('Sync engine stopped');
}

module.exports = {
  startSyncEngine,
  stopSyncEngine,
  syncAllActiveSessions,
  expireInactiveSessions,
  registerSSEClient,
  unregisterSSEClient,
  notifySSEClients
};

