const { Router } = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { getCacheStats, clearCache } = require('../lib/cache-handlers');

const router = Router();

router.get('/api/cache/stats', asyncHandler((req, res) => {
  getCacheStats(req, res, req.app.locals.cache);
}));

router.post('/api/cache/clear', asyncHandler((req, res) => {
  clearCache(req, res, req.app.locals.cache);
}));

module.exports = router;
