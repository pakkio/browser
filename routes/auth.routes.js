const { Router } = require('express');
const { setupAuthRoutes } = require('../lib/auth-routes');

/**
 * Auth routes — conditionally enabled via AUTH_ENABLED.
 */
function createAuthRouter(passport) {
  const router = Router();
  setupAuthRoutes(router, passport);
  return router;
}

module.exports = createAuthRouter;
