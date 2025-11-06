const crypto = require('crypto');
const logger = require('./logger');

// In-memory map: token -> { imapClient, email, host, sessionId, lastSeenAt }
const sessions = new Map();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createSession({ imapClient, email, host, sessionId }) {
  const token = generateToken();
  sessions.set(token, {
    imapClient,
    email,
    host,
    sessionId,
    lastSeenAt: new Date()
  });
  logger.info('Session created', { sessionId, email, token: token.substring(0, 8) + '...' });
  return token;
}

function getSession(token) {
  return sessions.get(token) || null;
}

function updateLastSeen(token) {
  const session = sessions.get(token);
  if (session) {
    session.lastSeenAt = new Date();
  }
}

function deleteSession(token) {
  const session = sessions.get(token);
  if (session) {
    logger.info('Session deleted from memory', { 
      sessionId: session.sessionId, 
      email: session.email 
    });
    sessions.delete(token);
  }
}

function getAllActiveSessions() {
  return Array.from(sessions.entries()).map(([token, session]) => ({
    token,
    ...session
  }));
}

function deleteSessionById(sessionId) {
  for (const [token, session] of sessions.entries()) {
    if (session.sessionId === sessionId) {
      sessions.delete(token);
      logger.info('Session deleted by ID', { sessionId });
      return true;
    }
  }
  return false;
}

module.exports = {
  generateToken,
  createSession,
  getSession,
  updateLastSeen,
  deleteSession,
  getAllActiveSessions,
  deleteSessionById
};

