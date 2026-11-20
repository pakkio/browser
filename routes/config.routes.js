const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../auth');
const asyncHandler = require('../middleware/asyncHandler');
const ApiError = require('../utils/ApiError');
const config = require('../lib/config');
const credentials = require('../lib/credentials');
const { isLoopback, isPrivateAddress } = require('../utils/networkAccess');
const mega = require('../lib/mega');
const { readLatestPath, saveLatestPath } = require('../utils/latestPath');

const router = Router();

// Changing the served root exposes other folders of this machine, so only
// the machine itself may do it (the socket address, not a spoofable header).
function isLocalRequest(req) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
}

function localOnly(req, res, next) {
  if (isLocalRequest(req)) return next();
  next(ApiError.forbidden('Changing the root is only allowed from this machine'));
}

// Public: the UI asks for the root before the user signs in.
// parentRoot is only offered to the local machine: it lets ".." climb out of the root.
router.get('/api/server-info', (req, res) => {
  const currentPath = req.session.currentPath || req.session.lastBrowsedPath || readLatestPath();
  const parent = path.dirname(config.baseDir);
  const parentRoot = isLocalRequest(req) && parent !== config.baseDir ? parent : null;
  res.json({ rootDir: config.baseDir, currentPath, parentRoot });
});

// Saved logins may be managed from this machine and from devices on the same private network
// (so a phone can save the mega.nz login). Never from the public internet, and never through a
// proxy that adds forwarding headers. CREDENTIALS_REMOTE=off restricts it to this machine only.
function localOrPrivateNetwork(req, res, next) {
  const addr = req.socket.remoteAddress;
  if (isLoopback(addr)) return next();
  const remoteOff = String(process.env.CREDENTIALS_REMOTE || '').toLowerCase() === 'off';
  const proxied = !!(req.headers['x-forwarded-for'] || req.headers['forwarded'] || req.headers['x-real-ip']);
  if (!remoteOff && !proxied && isPrivateAddress(addr)) return next();
  next(ApiError.forbidden('Saved logins can only be changed from this machine or your private network'));
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

// Remembered logins for external services. The secret is stored encrypted and is never sent back.
const SERVICES = ['mega'];
function serviceParam(req, res, next) {
  if (!SERVICES.includes(req.params.service)) return next(ApiError.badRequest('Unknown service'));
  next();
}

router.get('/api/config/credentials/:service', requireAuth, localOrPrivateNetwork, serviceParam, (req, res) => {
  res.json(credentials.describe(req.params.service));
});

router.put('/api/config/credentials/:service', requireAuth, localOrPrivateNetwork, serviceParam, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || typeof username !== 'string' || !password || typeof password !== 'string') {
    throw ApiError.badRequest('username and password are required');
  }
  credentials.save(req.params.service, { username: username.trim(), secret: password });
  mega.reset(); // next mega.nz request logs in with the new login
  res.json(credentials.describe(req.params.service));
});

router.delete('/api/config/credentials/:service', requireAuth, localOrPrivateNetwork, serviceParam, (req, res) => {
  credentials.remove(req.params.service);
  mega.reset();
  res.json(credentials.describe(req.params.service));
});

module.exports = router;
