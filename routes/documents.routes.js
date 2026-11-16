const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../middleware/asyncHandler');
const {
  getPdfInfo,
  servePdfPreview,
  validatePdf,
} = require('../lib/file-handlers');
const {
  serveEpubCover,
  serveEpubPreview,
  serveCoverImageFallback,
} = require('../lib/epub-handlers');
const {
  serveArchiveContents,
  serveArchiveFile,
} = require('../lib/archive-handlers');

const router = Router();

const previewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// --- PDF ---
router.get('/api/pdf-info', asyncHandler(getPdfInfo));
router.get('/api/validate-pdf', asyncHandler(validatePdf));
router.get('/pdf-preview', previewLimiter, asyncHandler(servePdfPreview));

// --- EPUB ---
router.get('/epub-cover', asyncHandler(serveEpubCover));
router.get('/epub-preview', asyncHandler(serveEpubPreview));
router.get('/cover.jpeg', serveCoverImageFallback);
router.get('/cover.jpg', serveCoverImageFallback);

// Image serving for EPUB content - placeholder, images go through /epub-cover
router.get('/images/:filename', (req, res) => {
  res.status(404).json({ error: 'Image endpoint not fully implemented yet' });
});

// --- Archives ---
router.get('/archive-contents', asyncHandler((req, res, next) => {
  // Cache is injected by the server; accessed via req.app.locals
  serveArchiveContents(req, res, req.app.locals.cache);
}));
router.get('/archive-file', asyncHandler(serveArchiveFile));

module.exports = router;
