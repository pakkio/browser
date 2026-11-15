const ApiError = require('../utils/ApiError');
const logger = require('../lib/logger');

/**
 * Global Express error-handling middleware.
 * Must be registered LAST (after all routes) with app.use().
 *
 * Handles:
 *  - ApiError instances → proper JSON error response
 *  - Errors with a status (e.g. body-parser 413) → that status
 *  - Generic errors    → 500 Internal Server Error
 *  - Logs everything with timestamp
 */
function errorHandler(err, req, res, _next) {
  // Prevent double-response if headers already sent
  if (res.headersSent) return;

  const isApiError = err instanceof ApiError;
  const statusCode = isApiError ? err.statusCode : (err.status || err.statusCode || 500);
  const message = statusCode >= 500 && !isApiError
    ? 'Internal server error'
    : err.message;

  const timestamp = new Date().toISOString();

  // Log server errors for debugging
  if (statusCode >= 500) {
    logger.error('Express error handler:', { error: err.message, stack: err.stack, url: req.url, method: req.method });
  }

  const body = {
    error: message,
    timestamp,
  };

  if (isApiError && err.details) {
    body.details = err.details;
  }

  if (process.env.NODE_ENV === 'development' && !isApiError) {
    body.stack = err.stack;
  }

  res.status(statusCode).json(body);
}

module.exports = errorHandler;
