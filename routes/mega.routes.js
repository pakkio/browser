const { Router } = require('express');
const path = require('path');
const asyncHandler = require('../middleware/asyncHandler');
const ApiError = require('../utils/ApiError');
const config = require('../lib/config');
const mega = require('../lib/mega');
const logger = require('../lib/logger');
const { getComicInfo, serveComicPreview } = require('../lib/comic-handlers');

const router = Router();

const megaLimiter = require('express-rate-limit')({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

// Files that a browser would run if opened inline from this origin are always downloaded instead
const ACTIVE_CONTENT = new Set(['.html', '.htm', '.xhtml', '.svg', '.xml', '.js', '.mjs']);

router.get('/api/mega/list', megaLimiter, asyncHandler(async (req, res) => {
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  res.json(await mega.listFolder(id));
}));

router.get('/api/mega/file', megaLimiter, asyncHandler(async (req, res) => {
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!id) throw ApiError.badRequest('id is required');
  const node = await mega.getFile(id);
  const size = node.size || 0;
  const name = node.name || 'file';
  const ext = path.extname(name).toLowerCase();

  let start = 0;
  let end = size - 1;
  let partial = false;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = parseInt(range[1], 10);
      if (range[2]) end = Math.min(parseInt(range[2], 10), size - 1);
    } else {
      start = Math.max(size - parseInt(range[2], 10), 0); // suffix range: last N bytes
    }
    if (start > end || start >= size) {
      res.status(416).set('Content-Range', `bytes */${size}`).end();
      return;
    }
    partial = true;
  }

  const asAttachment = req.query.download === '1' || ACTIVE_CONTENT.has(ext);
  res.status(partial ? 206 : 200);
  res.set({
    'Content-Type': config.mimeTypes[ext] || 'application/octet-stream',
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `${asAttachment ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; media-src 'self'; img-src 'self' data:",
    'Cache-Control': 'private, max-age=0',
  });
  if (partial) res.set('Content-Range', `bytes ${start}-${end}/${size}`);
  if (size === 0) { res.end(); return; }

  // megajs treats an end of 0 as "to the end of the file", so a one-byte read at offset 0 is asked as 0-1
  const stream = node.download({ start, end: end === 0 ? 1 : end });
  const abort = () => stream.destroy();
  res.on('close', abort);
  stream.on('error', (err) => {
    logger.warn('mega.nz download failed', { error: err && err.message });
    if (!res.headersSent) res.status(502).end(); else res.destroy();
  });
  if (end === 0) {
    stream.once('data', chunk => res.end(chunk.subarray(0, 1)));
  } else {
    stream.pipe(res);
  }
}));

// Comics (cbz / cbr / zip): download once to a temp copy, then reuse the local comic extraction
const COMIC_EXTENSIONS = new Set(['.cbz', '.cbr', '.zip']);

async function comicRequest(req) {
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!id) throw ApiError.badRequest('id is required');
  const node = await mega.getFile(id);
  if (!COMIC_EXTENSIONS.has(path.extname(node.name || '').toLowerCase())) throw ApiError.badRequest('Not a comic archive');
  const resolvedPath = await mega.localCopy(node);
  return { query: { path: node.name, page: req.query.page }, resolvedPath };
}

router.get('/api/mega/comic-info', megaLimiter, asyncHandler(async (req, res) => {
  await getComicInfo(await comicRequest(req), res, req.app.locals.cache);
}));

router.get('/api/mega/comic-page', megaLimiter, asyncHandler(async (req, res) => {
  await serveComicPreview(await comicRequest(req), res, req.app.locals.cache);
}));

module.exports = router;
