// ../.env takes precedence; a local .env only fills in what it leaves unset
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
// NOTE: Pinned to Express 4.x (was 5.1.0) because express-session and
// express-rate-limit had compatibility issues with Express 5's async
// error handling. Async route handlers are wrapped with asyncHandler.
const path = require('path');
const helmet = require('helmet');
const session = require('express-session');
const { passport, requireAuth } = require('./auth');
const FileCache = require('./cache');

const config = require('./lib/config');
const { AUTH_ENABLED, port, validateEnv } = config;
const errorHandler = require('./middleware/errorHandler');
const logger = require('./lib/logger');

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

// --- Validate environment ---
validateEnv().forEach(w => logger.warn(`Environment: ${w}`));

logger.info('File Browser Server Starting...');
logger.info(`Base directory: ${config.baseDir}`);
logger.info(`Port: ${port}`);
logger.info(`Authentication: ${AUTH_ENABLED ? 'ENABLED' : 'DISABLED'}`);

const app = express();

// --- Memory monitoring (skip during tests) ---
if (!isTest) {
  const monitor = {
    check() {
      const { heapUsed, rss } = process.memoryUsage();
      const heapMB = Math.round(heapUsed / 1024 / 1024);
      const rssMB = Math.round(rss / 1024 / 1024);
      if (heapMB > 500 || rssMB > 1024) {
        logger.warn(`High memory usage: ${heapMB}MB heap, ${rssMB}MB RSS`);
      }
    },
    start() {
      this.check();
      setInterval(() => this.check(), 10 * 60 * 1000).unref();
    },
  };
  monitor.start();
}

// --- Global crash guards ---
process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION - Server will attempt to continue:', { message: err.message, stack: err.stack });
});
process.on('unhandledRejection', (reason) => {
  logger.error('UNHANDLED PROMISE REJECTION:', { reason: reason?.message || reason, stack: reason?.stack });
});

// --- Request parsing ---
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// --- Security headers ---
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      'script-src-elem': ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      'img-src': ["'self'", 'data:', 'blob:'],
      'media-src': ["'self'", 'blob:'],
      'connect-src': ["'self'"],
      'worker-src': ["'self'", 'blob:', 'https://cdnjs.cloudflare.com'],
      // PDFs and HTML from archives are shown in same-origin iframes; the browser's
      // PDF viewer needs object-src. Other sites still cannot frame the app.
      'object-src': ["'self'"],
      'frame-ancestors': ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Browsers ask for /favicon.ico on every page; answer it before session and auth run
app.get('/favicon.ico', (req, res) => res.status(204).end());

// --- Session ---
if (!process.env.SESSION_SECRET) {
  if (isProduction) {
    logger.error('SESSION_SECRET environment variable is required. Generate one with: openssl rand -hex 32');
    process.exit(1);
  }
  logger.warn('SESSION_SECRET not set. Using insecure default for development. Set SESSION_SECRET in .env for production.');
}
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-insecure-secret-do-not-use-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

// --- Authentication ---
if (AUTH_ENABLED) {
  app.use(passport.initialize());
  app.use(passport.session());
}

// --- Cache (disk-based, shared via app.locals) ---
const cache = new FileCache({
  maxAge: 24 * 60 * 60 * 1000,
  maxSize: 500 * 1024 * 1024,
});
app.locals.cache = cache;

// --- Static files ---
app.use(express.static(path.join(__dirname, 'public')));

// --- Route modules ---
const createAuthRouter = require('./routes/auth.routes');
app.use(createAuthRouter(passport));

// Server info is public; root switching inside applies its own auth
app.use(require('./routes/config.routes'));

// All API routes below this point require authentication
app.use(requireAuth);

app.use(require('./routes/browse.routes'));
app.use(require('./routes/file-ops.routes'));
app.use(require('./routes/documents.routes'));
app.use(require('./routes/comics.routes'));
app.use(require('./routes/media.routes'));
app.use(require('./routes/annotations.routes'));
app.use(require('./routes/ai.routes'));
app.use(require('./routes/cache.routes'));

// --- Error handling (must be last) ---
app.use(errorHandler);

// --- 404 catch-all ---
app.use((req, res) => {
  logger.warn(`Route not found: ${req.method} ${req.url}`);
  res.status(404).json({ error: 'Route not found', path: req.url, method: req.method });
});

// --- Start server ---
if (require.main === module) {
  const server = app.listen(port, () => {
    logger.info(`Server running at http://localhost:${port}`);
    logger.info(`Serving files from: ${config.baseDir}`);
    logger.info('Server started successfully!');
  });

  server.setTimeout(300000); // 5 minutes

  // server.close() alone waits for open video streams and keep-alive sockets,
  // so drop them and force-exit if closing still takes too long
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) {
      logger.info('Forced exit');
      process.exit(1);
    }
    shuttingDown = true;
    logger.info(`${signal} received. Shutting down...`);
    server.close(() => {
      logger.info('Server closed successfully');
      process.exit(0);
    });
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
