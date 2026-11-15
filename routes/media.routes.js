const { Router } = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const {
  serveVideoTranscode,
  serveVideoStream,
  serveVideoStreamInfo,
  serveSubtitle,
  serveVideoThumbnail,
} = require('../lib/file-handlers');
const { checkVideoCodec } = require('../lib/video-codec-checker');
const { resolveSafePath } = require('../utils/pathSecurity');
const ApiError = require('../utils/ApiError');
const path = require('path');

const router = Router();

const previewLimiter = require('express-rate-limit')({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// Video transcoding
router.get('/video-transcode', previewLimiter, asyncHandler(serveVideoTranscode));

// Seekable streaming without storing transcoded copies
router.get('/video-stream', asyncHandler(serveVideoStream));
router.get('/api/video-stream-info', previewLimiter, asyncHandler(serveVideoStreamInfo));

// Subtitles
router.get('/subtitle', asyncHandler(serveSubtitle));

// Video thumbnails
router.get('/video-thumbnail', previewLimiter, asyncHandler(serveVideoThumbnail));

// Video codec check
router.get('/api/video-codec-check', asyncHandler(async (req, res) => {
  const requestedFile = req.query.path;
  if (!requestedFile) throw ApiError.badRequest('File path is required');

  const filePath = resolveSafePath(requestedFile);
  const codecInfo = await checkVideoCodec(filePath);
  res.json(codecInfo);
}));

module.exports = router;
