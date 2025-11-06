require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { initDb } = require('./core/db');
const { ensureAttachBase } = require('./core/files');
const sessionStore = require('./core/sessionStore');
const { startSyncEngine } = require('./core/syncEngine');
const logger = require('./core/logger');

// Handle BigInt serialization for JSON
BigInt.prototype.toJSON = function() {
  return this.toString();
};

// Import API routes
const authRouter = require('./api/auth');
const foldersRouter = require('./api/folders');
const messagesRouter = require('./api/messages');
const attachmentsRouter = require('./api/attachments');
const searchRouter = require('./api/search');
const eventsRouter = require('./api/events');

const PORT = process.env.PORT || 4001;

async function bootstrap() {
  try {
    // Initialize database
    logger.info('Initializing database...');
    initDb();

    // Ensure attachment base directory exists
    logger.info('Ensuring attachment directory...');
    await ensureAttachBase();

    // Create Express app
    const app = express();

    // Apply security middleware
    app.use(helmet({
      contentSecurityPolicy: false // Allow inline styles for email HTML
    }));

    // CORS
    app.use(cors({
      origin: true,
      credentials: true
    }));

    // Body parsing
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Rate limiting for login
    const loginLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5, // 5 attempts per window
      message: { error: 'Too many login attempts, please try again later' },
      standardHeaders: true,
      legacyHeaders: false
    });

    // Rate limiting for attachments
    const attachmentLimiter = rateLimit({
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 100, // 100 downloads per minute
      message: { error: 'Too many attachment downloads, please slow down' },
      standardHeaders: true,
      legacyHeaders: false
    });

    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Mount auth routes (no auth required)
    app.post('/login', loginLimiter, authRouter);

    // Authentication middleware for all other routes
    app.use((req, res, next) => {
      // Skip auth for login and health
      if (req.path === '/login' || req.path === '/health') {
        return next();
      }

      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authorization header required' });
      }

      const token = authHeader.substring(7);
      const session = sessionStore.getSession(token);

      if (!session) {
        return res.status(401).json({ error: 'Invalid or expired session' });
      }

      // Update last seen
      sessionStore.updateLastSeen(token);

      // Attach session to request
      req.session = session;
      req.token = token;

      next();
    });

    // Mount authenticated routes
    app.post('/logout', authRouter);
    app.use('/folders', foldersRouter);
    app.use('/messages', messagesRouter);
    app.use('/attachments', attachmentLimiter, attachmentsRouter);
    app.use('/search', searchRouter);
    app.use('/events', eventsRouter);

    // 404 handler
    app.use((req, res) => {
      res.status(404).json({ error: 'Not found' });
    });

    // Error handler
    app.use((err, req, res, next) => {
      logger.error('Unhandled error', { 
        error: err.message, 
        stack: err.stack,
        path: req.path 
      });
      
      res.status(500).json({ 
        error: process.env.NODE_ENV === 'production' 
          ? 'Internal server error' 
          : err.message 
      });
    });

    // Start HTTP server
    const server = app.listen(PORT, () => {
      logger.info(`Server listening on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // Start sync engine
    logger.info('Starting sync engine...');
    startSyncEngine();

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      
      server.close(() => {
        logger.info('HTTP server closed');
      });

      const { stopSyncEngine } = require('./core/syncEngine');
      stopSyncEngine();

      const { closeDb } = require('./core/db');
      await closeDb();

      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (err) {
    logger.error('Failed to bootstrap server', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

bootstrap();

