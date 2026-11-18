const { Router } = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const {
  serveBrowseRequest,
  serveFileList,
  serveFile,
  serveDirectoryLibrary,
  serveDocxPreview,
} = require('../lib/file-handlers');
const { openFile } = require('../lib/system-handlers');

const router = Router();

// Browse directory
router.get('/api/browse', asyncHandler(serveBrowseRequest));
router.get('/api/library', asyncHandler(serveDirectoryLibrary));

// File listing & serving
router.get('/files/list', asyncHandler(serveFileList));
router.get('/files', asyncHandler(serveFile));

// Current path persistence (session + .latest file)
const path = require('path');
const { readLatestPath, saveLatestPath } = require('../utils/latestPath');

router.get('/api/current-path', (req, res) => {
  const currentPath = req.session.currentPath || readLatestPath();
  res.json({ currentPath });
});

router.post('/api/current-path', (req, res) => {
  const { path: newPath } = req.body;
  req.session.currentPath = newPath || '';
  req.session.lastBrowsedPath = newPath || '';
  saveLatestPath(newPath || '');
  res.json({ success: true, currentPath: req.session.currentPath });
});

// List directories for folder picker
router.get('/api/directories', asyncHandler(async (req, res) => {
  const ApiError = require('../utils/ApiError');
  const { resolveSafePath } = require('../utils/pathSecurity');
  const fsp = require('fs').promises;

  const currentDir = req.query.path || '';
  const fullDir = resolveSafePath(currentDir);

  let entries;
  try {
    entries = await fsp.readdir(fullDir, { withFileTypes: true });
  } catch {
    throw ApiError.notFound('Directory not found');
  }

  const directories = entries
    .filter(e => e.isDirectory())
    .map(e => ({
      name: e.name,
      path: currentDir ? `${currentDir}/${e.name}` : e.name,
    }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  let parentPath = currentDir ? path.dirname(currentDir) : null;
  if (parentPath === '.') parentPath = '';

  res.json({ currentPath: currentDir, parentPath, directories });
}));

const SEARCH_MAX_RESULTS = 200;
const SEARCH_MAX_DIRS = 20000;

/**
 * Recursive, case-insensitive partial match on file and folder names.
 * Every whitespace-separated term of `q` must appear in the name.
 */
router.get('/api/search', asyncHandler(async (req, res) => {
  const ApiError = require('../utils/ApiError');
  const { resolveSafePath } = require('../utils/pathSecurity');
  const fsp = require('fs').promises;

  const terms = String(req.query.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return res.json({ results: [], truncated: false });

  const startDir = req.query.path || '';
  const fullStart = resolveSafePath(startDir);

  const results = [];
  const queue = [startDir];
  let visited = 0;
  let truncated = false;

  while (queue.length && !truncated) {
    const relDir = queue.shift();
    const absDir = relDir === startDir ? fullStart : resolveSafePath(relDir);
    let entries;
    try {
      entries = await fsp.readdir(absDir, { withFileTypes: true });
    } catch {
      if (relDir === startDir) throw ApiError.notFound('Directory not found');
      continue;
    }
    if (++visited > SEARCH_MAX_DIRS) { truncated = true; break; }

    for (const entry of entries) {
      if (entry.name === '.browser') continue;
      const lower = entry.name.toLowerCase();
      if (terms.every(t => lower.includes(t))) {
        if (results.length >= SEARCH_MAX_RESULTS) { truncated = true; break; }
        results.push({ name: entry.name, dir: relDir, isDirectory: entry.isDirectory() });
      }
      // Symlinked directories are not followed, so the walk cannot leave baseDir or loop
      if (entry.isDirectory()) queue.push(relDir ? `${relDir}/${entry.name}` : entry.name);
    }
  }

  res.json({ results, truncated });
}));

// File operations (require full path resolution)
router.post('/api/open-file', asyncHandler(openFile));

// DOCX preview
router.get('/docx-preview', asyncHandler(serveDocxPreview));

module.exports = router;
