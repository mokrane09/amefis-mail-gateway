const express = require('express');
const { v4: uuidv4 } = require('uuid');
const dayjs = require('dayjs');
const { simpleParser } = require('mailparser');
const { getDb } = require('../core/db');
const ImapManager = require('../core/imapManager');
const sessionStore = require('../core/sessionStore');
const files = require('../core/files');
const html = require('../core/html');
const logger = require('../core/logger');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { host, port, secure, email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const { knex } = getDb();
    const expiresAt = dayjs().add(2, 'hours');

    // Create session in DB
    const [session] = await knex('sessions')
      .insert({
        email,
        host: host || process.env.IMAP_DEFAULT_HOST,
        expires_at: expiresAt.toISOString()
      })
      .returning('*');

    // Connect to IMAP
    const imapManager = new ImapManager();
    await imapManager.connect({ host, port, secure, email, password });

    // List folders
    const folderList = await imapManager.listFolders();
    const folderInserts = folderList.map(f => ({
      session_id: session.id,
      name: f.name,
      path: f.path,
      special_use: f.specialUse,
      uid_validity: 0 // Will be updated when mailbox is opened
    }));

    const folders = await knex('folders')
      .insert(folderInserts)
      .returning('*');

    // Find INBOX
    const inbox = folders.find(f => 
      f.path.toUpperCase() === 'INBOX' || 
      f.special_use === '\\Inbox'
    );

    if (inbox) {
      // Open INBOX and preload 50 newest messages
      const mailbox = await imapManager.openMailbox(inbox.path);
      
      await knex('folders')
        .where({ id: inbox.id })
        .update({
          uid_validity: mailbox.uidValidity,
          uid_next: mailbox.uidNext,
          highest_modseq: mailbox.highestModseq
        });

      const messages = await imapManager.fetchNewestUIDs(inbox.path, 50);
      
      // Process each message
      for (const msg of messages) {
        try {
          await processAndStoreMessage(msg, inbox, session, imapManager, knex);
        } catch (err) {
          logger.error('Failed to process message during login', { 
            uid: msg.uid, 
            error: err.message 
          });
        }
      }

      // Start IDLE on INBOX if supported
      const capabilities = imapManager.getCapabilities();
      if (capabilities.idle) {
        imapManager.startIdle((event) => {
          logger.debug('IDLE event received', { type: event.type });
          // IDLE events will be handled by sync engine
        });
      }
    }

    // Create in-memory session
    const sessionToken = sessionStore.createSession({
      imapClient: imapManager,
      email,
      host: session.host,
      sessionId: session.id
    });

    logger.info('Login successful', { email, sessionId: session.id });

    res.json({
      sessionToken,
      expiresAt: expiresAt.toISOString(),
      email
    });

  } catch (err) {
    logger.error('Login failed', { email, error: err.message });
    res.status(500).json({ error: 'Login failed: ' + err.message });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const session = req.session; // Added by auth middleware
    const { knex } = getDb();

    // Close IMAP connection
    if (session.imapClient) {
      await session.imapClient.disconnect();
    }

    // Delete session from DB (cascade will clean everything)
    await knex('sessions').where({ id: session.sessionId }).delete();

    // Delete attachments
    await files.deleteSessionAttachments(session.email);

    // Remove from memory
    sessionStore.deleteSession(req.token);

    logger.info('Logout successful', { sessionId: session.sessionId, email: session.email });

    res.status(204).send();

  } catch (err) {
    logger.error('Logout failed', { error: err.message });
    res.status(500).json({ error: 'Logout failed: ' + err.message });
  }
});

async function processAndStoreMessage(msg, folder, session, imapManager, knex) {
  const envelope = msg.envelope || {};
  const flags = extractFlags(msg.flags);
  
  // Determine thread key
  const threadKey = computeThreadKey(envelope);
  
  // Parse message for body content
  const source = await imapManager.fetchMessageSource(msg.uid);
  const parsed = await simpleParser(source);
  
  // Extract text and create snippet
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
  
  // Insert message
  const messageId = uuidv4();
  await knex('messages').insert({
    id: messageId,
    session_id: session.id,
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
  });
  
  // Process attachments
  if (parsed.attachments && parsed.attachments.length > 0) {
    for (const attachment of parsed.attachments) {
      try {
        const isInline = !!attachment.contentId;
        const cid = attachment.contentId ? attachment.contentId.replace(/^<|>$/g, '') : null;
        
        // Save attachment to disk
        const { relativePath } = await files.saveAttachment(
          session.email,
          messageId,
          attachment.filename || 'unnamed',
          attachment.content
        );
        
        await knex('attachments').insert({
          session_id: session.id,
          message_id: messageId,
          filename: attachment.filename || 'unnamed',
          mime_type: attachment.contentType || 'application/octet-stream',
          size: attachment.size || 0,
          path: relativePath,
          is_inline: isInline,
          cid
        });
        
      } catch (err) {
        logger.error('Failed to save attachment', { 
          messageId, 
          filename: attachment.filename,
          error: err.message 
        });
      }
    }
  }
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

function computeThreadKey(envelope) {
  // Simple threading: use oldest reference, or in-reply-to, or message-id
  if (envelope.references && envelope.references.length > 0) {
    return envelope.references[0];
  }
  if (envelope.inReplyTo) {
    return envelope.inReplyTo;
  }
  return envelope.messageId || null;
}

module.exports = router;

