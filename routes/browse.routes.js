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
router.get('/files/list', serveFileList);
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

// File operations (require full path resolution)
router.post('/api/open-file', asyncHandler(openFile));

// DOCX preview
router.get('/docx-preview', asyncHandler(serveDocxPreview));

module.exports = router;
