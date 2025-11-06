const express = require('express');
const { registerSSEClient, unregisterSSEClient } = require('../core/syncEngine');
const logger = require('../core/logger');

const router = express.Router();

router.get('/', async (req, res) => {
  const session = req.session;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  res.flushHeaders();

  // Register this client
  registerSSEClient(session.sessionId, res);

  logger.info('SSE client connected', { sessionId: session.sessionId });

  // Send initial comment
  res.write(': connected\n\n');

  // Send heartbeat every 20 seconds
  const heartbeatInterval = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 20000);

  // Clean up on disconnect
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    unregisterSSEClient(session.sessionId, res);
    logger.info('SSE client disconnected', { sessionId: session.sessionId });
  });
});

module.exports = router;

