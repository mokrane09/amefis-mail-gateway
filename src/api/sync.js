const express = require('express');
const { syncAllActiveSessions } = require('../core/syncEngine');
const logger = require('../core/logger');

const router = express.Router();

router.post('/now', async (req, res) => {
  try {
    const session = req.session;
    
    logger.info('Manual sync triggered', { sessionId: session.sessionId });
    
    // Trigger sync immediately
    await syncAllActiveSessions();
    
    res.json({ 
      success: true, 
      message: 'Sync completed successfully' 
    });

  } catch (err) {
    logger.error('Manual sync failed', { error: err.message });
    res.status(500).json({ error: 'Sync failed: ' + err.message });
  }
});

module.exports = router;

