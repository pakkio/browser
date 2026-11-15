const fs = require('fs');
const path = require('path');
const config = require('../lib/config');

// The root can change at runtime (config.setBaseDir), so read it on every call
function realBaseDir() {
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(config.baseDir) : fs.realpathSync(config.baseDir);
  } catch {
    return config.baseDir;
  }
}

/**
 * Resolve a user-supplied relative path against baseDir,
 * verify it stays within baseDir, and return the verified absolute path.
 * Throws ApiError on violation.
 */
function resolveSafePath(requestedPath) {
  const ApiError = require('./ApiError');
  const baseDir = config.baseDir;

  // Normalize: strip leading slash
  const normalized = (requestedPath || '').startsWith('/')
    ? requestedPath.slice(1)
    : (requestedPath || '');

  const joined = path.join(baseDir, normalized);

  // Quick reject obvious traversal before touching the filesystem
  if (!joined.startsWith(baseDir)) {
    throw ApiError.forbidden('Path outside allowed directory');
  }

  // Resolve symlinks to catch sneaky traversal
  let resolved;
  try {
    resolved = fs.realpathSync.native ? fs.realpathSync.native(joined) : fs.realpathSync(joined);
  } catch {
    // Path doesn't exist — still check the naive join
    if (!joined.startsWith(baseDir)) {
      throw ApiError.forbidden('Path outside allowed directory');
    }
    return joined; // return the naive join for non-existent paths (e.g. for writing)
  }

  if (!resolved.startsWith(realBaseDir())) {
    throw ApiError.forbidden('Path outside allowed directory');
  }

  return resolved;
}

/**
 * Resolve and stat a path. Returns { fullPath, stat } or throws ApiError.
 */
function resolveExistingPath(requestedPath) {
  const ApiError = require('./ApiError');
  const fullPath = resolveSafePath(requestedPath);

  let stat;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    throw ApiError.notFound('File or directory not found');
  }

  return { fullPath, stat };
}

/**
 * Express middleware: resolves req.query.path (or req.body.path) and attaches
 * req.verifiedPath + req.verifiedStat to the request.
 * Uses query param 'path' by default; pass a custom source function.
 */
function pathGuard(sourceFn) {
  return (req, _res, next) => {
    try {
      const requestedPath = sourceFn
        ? sourceFn(req)
        : (req.query.path !== undefined ? req.query.path : '');

      // If path is undefined but we allow empty (for root browsing)
      const { fullPath, stat } = resolveExistingPath(requestedPath);
      req.verifiedPath = fullPath;
      req.verifiedStat = stat;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { resolveSafePath, resolveExistingPath, pathGuard, realBaseDir };
