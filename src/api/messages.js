const express = require('express');
const { getDb } = require('../core/db');
const html = require('../core/html');
const logger = require('../core/logger');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const session = req.session;
    const { knex } = getDb();
    const { folderId, limit = 50, cursorUid } = req.query;

    if (!folderId) {
      return res.status(400).json({ error: 'folderId is required' });
    }

    let query = knex('messages')
      .where({ 
        session_id: session.sessionId,
        folder_id: folderId 
      });

    if (cursorUid) {
      query = query.where('uid', '<', parseInt(cursorUid, 10));
    }

    const messages = await query
      .select(
        'id',
        'folder_id as folderId',
        'uid',
        'subject',
        'date',
        'from_name as fromName',
        'from_email as fromEmail',
        'to_list as toList',
        'cc_list as ccList',
        'bcc_list as bccList',
        'seen',
        'flagged',
        'answered',
        'draft',
        'deleted',
        'has_html as hasHtml',
        'has_text as hasText',
        'snippet',
        'size',
        'has_attachments as hasAttachments'
      )
      .orderBy('date', 'desc')
      .limit(parseInt(limit, 10));

    res.json(messages);

  } catch (err) {
    logger.error('Failed to fetch messages', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const session = req.session;
    const { knex } = getDb();
    const { id } = req.params;

    const message = await knex('messages')
      .where({ 
        id,
        session_id: session.sessionId 
      })
      .first();

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Fetch attachments
    const attachments = await knex('attachments')
      .where({ message_id: id })
      .select(
        'id',
        'filename',
        'mime_type as mimeType',
        'size',
        'is_inline as isInline',
        'cid'
      );

    // Build CID map for HTML rewriting
    const cidMap = {};
    let blockedRemoteImages = false;

    for (const att of attachments) {
      if (att.cid) {
        cidMap[att.cid] = att.id;
      }
      att.downloadUrl = `/attachments/${att.id}`;
    }

    // Parse full message for HTML/text content
    const imapManager = session.imapClient;
    let htmlContent = null;
    let textContent = null;

    try {
      // Re-open the folder if needed
      const folder = await knex('folders')
        .where({ id: message.folder_id })
        .first();

      if (folder) {
        const { simpleParser } = require('mailparser');
        await imapManager.openMailbox(folder.path);
        const source = await imapManager.fetchMessageSource(message.uid);
        const parsed = await simpleParser(source);

        if (parsed.html) {
          const sanitized = html.sanitizeEmailHtml(parsed.html, false);
          const { html: rewritten, hasBlockedRemote } = html.rewriteCidImages(sanitized, cidMap);
          htmlContent = rewritten;
          blockedRemoteImages = hasBlockedRemote;
        }

        if (parsed.text) {
          textContent = parsed.text;
        }
      }

    } catch (err) {
      logger.error('Failed to fetch message body', { 
        messageId: id, 
        error: err.message 
      });
    }

    res.json({
      id: message.id,
      folderId: message.folder_id,
      uid: message.uid,
      msgId: message.msg_id,
      threadKey: message.thread_key,
      subject: message.subject,
      date: message.date,
      fromName: message.from_name,
      fromEmail: message.from_email,
      toList: message.to_list,
      ccList: message.cc_list,
      bccList: message.bcc_list,
      seen: message.seen,
      flagged: message.flagged,
      answered: message.answered,
      draft: message.draft,
      deleted: message.deleted,
      hasHtml: message.has_html,
      hasText: message.has_text,
      snippet: message.snippet,
      size: message.size,
      hasAttachments: message.has_attachments,
      htmlContent,
      textContent,
      attachments,
      blockedRemoteImages
    });

  } catch (err) {
    logger.error('Failed to fetch message details', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch message details' });
  }
});

router.patch('/:id/flags', async (req, res) => {
  try {
    const session = req.session;
    const { knex } = getDb();
    const { id } = req.params;
    const { add = [], remove = [] } = req.body;

    const message = await knex('messages')
      .where({ 
        id,
        session_id: session.sessionId 
      })
      .first();

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Get folder
    const folder = await knex('folders')
      .where({ id: message.folder_id })
      .first();

    // Apply flags on IMAP server
    const imapManager = session.imapClient;
    await imapManager.openMailbox(folder.path);

    if (add.length > 0) {
      await imapManager.setFlags(message.uid, add);
    }

    if (remove.length > 0) {
      await imapManager.setFlags(message.uid, remove, { remove: true });
    }

    // Update DB
    const updates = {};
    
    for (const flag of add) {
      const flagLower = flag.toLowerCase();
      if (flagLower === '\\seen') updates.seen = true;
      if (flagLower === '\\flagged') updates.flagged = true;
      if (flagLower === '\\answered') updates.answered = true;
      if (flagLower === '\\draft') updates.draft = true;
    }

    for (const flag of remove) {
      const flagLower = flag.toLowerCase();
      if (flagLower === '\\seen') updates.seen = false;
      if (flagLower === '\\flagged') updates.flagged = false;
      if (flagLower === '\\answered') updates.answered = false;
      if (flagLower === '\\draft') updates.draft = false;
    }

    if (Object.keys(updates).length > 0) {
      await knex('messages')
        .where({ id })
        .update(updates);
    }

    logger.info('Flags updated', { messageId: id, add, remove });

    res.json({ success: true });

  } catch (err) {
    logger.error('Failed to update flags', { error: err.message });
    res.status(500).json({ error: 'Failed to update flags' });
  }
});

router.post('/:id/move', async (req, res) => {
  try {
    const session = req.session;
    const { knex } = getDb();
    const { id } = req.params;
    const { toFolderId } = req.body;

    if (!toFolderId) {
      return res.status(400).json({ error: 'toFolderId is required' });
    }

    const message = await knex('messages')
      .where({ 
        id,
        session_id: session.sessionId 
      })
      .first();

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const targetFolder = await knex('folders')
      .where({ 
        id: toFolderId,
        session_id: session.sessionId 
      })
      .first();

    if (!targetFolder) {
      return res.status(404).json({ error: 'Target folder not found' });
    }

    const sourceFolder = await knex('folders')
      .where({ id: message.folder_id })
      .first();

    // Move on IMAP server
    const imapManager = session.imapClient;
    await imapManager.openMailbox(sourceFolder.path);
    await imapManager.moveMessage(message.uid, targetFolder.path);

    // Delete from DB (will be re-synced in target folder)
    await knex('messages').where({ id }).delete();

    logger.info('Message moved', { 
      messageId: id, 
      from: sourceFolder.path, 
      to: targetFolder.path 
    });

    res.json({ success: true });

  } catch (err) {
    logger.error('Failed to move message', { error: err.message });
    res.status(500).json({ error: 'Failed to move message' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const session = req.session;
    const { knex } = getDb();
    const { id } = req.params;
    const { hard = false } = req.body;

    const message = await knex('messages')
      .where({ 
        id,
        session_id: session.sessionId 
      })
      .first();

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const folder = await knex('folders')
      .where({ id: message.folder_id })
      .first();

    const imapManager = session.imapClient;
    await imapManager.openMailbox(folder.path);

    if (hard) {
      // Permanent delete
      await imapManager.deleteMessage(message.uid, true);
      await knex('messages').where({ id }).delete();
      
      logger.info('Message permanently deleted', { messageId: id });
      
    } else {
      // Move to Trash
      const trashFolder = await knex('folders')
        .where({ 
          session_id: session.sessionId 
        })
        .where(function() {
          this.where('special_use', '\\Trash')
            .orWhere('name', 'like', '%Trash%')
            .orWhere('name', 'like', '%Deleted%');
        })
        .first();

      if (trashFolder && trashFolder.id !== folder.id) {
        await imapManager.moveMessage(message.uid, trashFolder.path);
        await knex('messages').where({ id }).delete();
        
        logger.info('Message moved to trash', { messageId: id });
      } else {
        // No trash folder, just mark as deleted
        await imapManager.deleteMessage(message.uid, false);
        await knex('messages')
          .where({ id })
          .update({ deleted: true });
        
        logger.info('Message marked as deleted', { messageId: id });
      }
    }

    res.json({ success: true });

  } catch (err) {
    logger.error('Failed to delete message', { error: err.message });
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

module.exports = router;

