const express = require('express');
const { Router } = express;
const asyncHandler = require('../middleware/asyncHandler');
const {
  serveComicPreview,
  getComicInfo,
  serveArchiveVideo,
} = require('../lib/comic-handlers');
const { detectComicPanels } = require('../lib/comic-panels');

const router = Router();

// All comic handlers accept (req, res, cache) — cache is on app.locals
const withCache = (handler) => (req, res, next) => {
  handler(req, res, req.app.locals.cache).catch(next);
};

router.get('/api/comic-info', withCache(getComicInfo));
router.get('/comic-preview', withCache(serveComicPreview));
router.post('/api/comic-panels', express.raw({ type: 'image/jpeg', limit: '6mb' }), asyncHandler(detectComicPanels));
router.get('/archive-video', withCache(serveArchiveVideo));

module.exports = router;
