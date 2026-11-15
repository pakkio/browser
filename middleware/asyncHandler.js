/**
 * Wraps an async route handler so thrown errors / rejected promises
 * are forwarded to Express's error-handling middleware via next().
 *
 * Usage:  router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
