const express = require('express');
const { getDb } = require('../core/db');
const logger = require('../core/logger');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const session = req.session;
    const { knex } = getDb();

    const folders = await knex('folders')
      .where({ session_id: session.sessionId })
      .select(
        'id',
        'name',
        'path',
        'special_use as specialUse',
        'uid_validity as uidValidity',
        'uid_next as uidNext'
      )
      .orderBy('path');

    res.json(folders);

  } catch (err) {
    logger.error('Failed to fetch folders', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch folders' });
  }
});

module.exports = router;

