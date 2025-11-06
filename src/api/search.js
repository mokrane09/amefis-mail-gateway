const express = require('express');
const { getDb } = require('../core/db');
const logger = require('../core/logger');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const session = req.session;
    const { knex } = getDb();
    const { q, limit = 50 } = req.query;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const searchTerm = q.trim();

    // Build search query combining:
    // 1. Full-text search on subject_tsv and body_tsv
    // 2. Trigram similarity on subject and from_email for partial matches
    
    const tsQuery = knex.raw('plainto_tsquery(\'simple\', ?)', [searchTerm]);
    
    let query = knex('messages')
      .where({ session_id: session.sessionId })
      .where(function() {
        // Full-text search on subject
        this.where(knex.raw('subject_tsv @@ plainto_tsquery(\'simple\', ?)', [searchTerm]))
          // Full-text search on body
          .orWhere(knex.raw('body_tsv @@ plainto_tsquery(\'simple\', ?)', [searchTerm]))
          // Trigram similarity on subject
          .orWhere('subject', 'ilike', `%${searchTerm}%`)
          // Trigram similarity on email addresses
          .orWhere('from_email', 'ilike', `%${searchTerm}%`)
          .orWhere('to_list', 'ilike', `%${searchTerm}%`)
          .orWhere('cc_list', 'ilike', `%${searchTerm}%`)
          .orWhere('bcc_list', 'ilike', `%${searchTerm}%`);
      });

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

    logger.debug('Search executed', { 
      sessionId: session.sessionId, 
      query: searchTerm, 
      results: messages.length 
    });

    res.json(messages);

  } catch (err) {
    logger.error('Search failed', { error: err.message });
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;

