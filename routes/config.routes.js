const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../auth');
const asyncHandler = require('../middleware/asyncHandler');
const ApiError = require('../utils/ApiError');
const config = require('../lib/config');
const { readLatestPath, saveLatestPath } = require('../utils/latestPath');

const router = Router();

// Public: the UI asks for the root before the user signs in
router.get('/api/server-info', (req, res) => {
  const currentPath = req.session.currentPath || req.session.lastBrowsedPath || readLatestPath();
  res.json({ rootDir: config.baseDir, currentPath });
});

// Changing the served root exposes other folders of this machine, so only
// the machine itself may do it (the socket address, not a spoofable header).
function localOnly(req, res, next) {
  const addr = req.socket.remoteAddress;
  if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(addr)) return next();
  next(ApiError.forbidden('Changing the root is only allowed from this machine'));
}

// Sub-folders of any directory (drives when path is empty on Windows), for the root picker
router.get('/api/config/dirs', requireAuth, localOnly, asyncHandler(async (req, res) => {
  const requested = typeof req.query.path === 'string' ? req.query.path : '';
  if (!requested && process.platform === 'win32') {
    const drives = [];
    for (let c = 65; c <= 90; c++) {
      const drive = `${String.fromCharCode(c)}:\\`;
      if (fs.existsSync(drive)) drives.push(drive);
    }
    return res.json({ path: '', parent: null, dirs: drives });
  }

  const dir = path.resolve(config.toNativePath(requested || config.baseDir));
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    throw ApiError.badRequest(err.message);
  }
  const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name).sort((a, b) => a.localeCompare(b));
  const parent = path.dirname(dir);
  res.json({ path: dir, parent: parent === dir ? (process.platform === 'win32' ? '' : null) : parent, dirs });
}));

// Switch the served root at runtime
router.post('/api/config/root', requireAuth, localOnly, (req, res) => {
  const requested = req.body && req.body.path;
  if (!requested || typeof requested !== 'string') {
    throw ApiError.badRequest('path is required');
  }
  let rootDir;
  try {
    rootDir = config.setBaseDir(requested);
  } catch (err) {
    throw ApiError.badRequest(err.message);
  }
  req.session.currentPath = '';
  req.session.lastBrowsedPath = '';
  saveLatestPath('');
  res.json({ success: true, rootDir });
});

module.exports = router;
