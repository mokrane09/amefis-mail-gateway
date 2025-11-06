const express = require('express');
const fsPromises = require('fs').promises;
const { getDb } = require('../core/db');
const files = require('../core/files');
const logger = require('../core/logger');

const router = express.Router();

router.get('/:id', async (req, res) => {
  try {
    const session = req.session;
    const { knex } = getDb();
    const { id } = req.params;
    const { inline } = req.query;

    const attachment = await knex('attachments')
      .where({ 
        id,
        session_id: session.sessionId 
      })
      .first();

    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const filePath = files.getAttachmentPath(attachment.path);
    
    // Check if file exists
    const exists = await files.attachmentExists(attachment.path);
    if (!exists) {
      logger.error('Attachment file not found on disk', { 
        attachmentId: id, 
        path: attachment.path 
      });
      return res.status(404).json({ error: 'Attachment file not found' });
    }

    // Set headers
    const disposition = inline === '1' ? 'inline' : 'attachment';
    res.setHeader('Content-Type', attachment.mime_type);
    res.setHeader('Content-Disposition', `${disposition}; filename="${attachment.filename}"`);
    res.setHeader('Content-Length', attachment.size);

    // Stream file
    const fs = require('fs');
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);

    stream.on('error', (err) => {
      logger.error('Error streaming attachment', { 
        attachmentId: id, 
        error: err.message 
      });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream attachment' });
      }
    });

  } catch (err) {
    logger.error('Failed to serve attachment', { error: err.message });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to serve attachment' });
    }
  }
});

module.exports = router;

