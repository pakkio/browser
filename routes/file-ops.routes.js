const { Router } = require('express');
const path = require('path');
const asyncHandler = require('../middleware/asyncHandler');
const { resolveSafePath } = require('../utils/pathSecurity');
const { renameAnnotation } = require('../lib/annotation-handlers');
const ApiError = require('../utils/ApiError');
const fsp = require('fs').promises;
const config = require('../lib/config');

const router = Router();

// Delete file or directory
router.delete('/api/file', asyncHandler(async (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) throw ApiError.badRequest('File path is required');

  const fullPath = resolveSafePath(filePath);
  const stats = await fsp.stat(fullPath);

  if (stats.isDirectory()) {
    await fsp.rm(fullPath, { recursive: true, force: true });
  } else {
    await fsp.unlink(fullPath);
  }

  res.json({ success: true, message: 'File deleted successfully' });
}));

// Rename file or directory
router.post('/api/file/rename', asyncHandler(async (req, res) => {
  const { oldPath, newName } = req.body;
  if (!oldPath || !newName) throw ApiError.badRequest('Old path and new name are required');

  const fullOldPath = resolveSafePath(oldPath);
  const dir = path.dirname(fullOldPath);
  const fullNewPath = path.join(dir, newName);

  // Ensure new path stays within baseDir
  const { baseDir } = config;
  if (!fullNewPath.startsWith(path.resolve(baseDir))) {
    throw ApiError.forbidden('New path outside allowed directory');
  }

  // Check if new name already exists
  try {
    await fsp.access(fullNewPath);
    throw ApiError.conflict('File with that name already exists');
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // File doesn't exist — good
  }

  await fsp.rename(fullOldPath, fullNewPath);

  // Preserve annotations
  const oldRelative = path.relative(path.resolve(baseDir), fullOldPath);
  const newRelative = path.relative(path.resolve(baseDir), fullNewPath);
  renameAnnotation(oldRelative, newRelative);

  res.json({ success: true, message: 'File renamed successfully', newPath: newRelative });
}));

// Move file to another directory
router.post('/api/file/move', asyncHandler(async (req, res) => {
  const { sourcePath, targetDir } = req.body;
  if (!sourcePath || targetDir === undefined) {
    throw ApiError.badRequest('Source path and target directory are required');
  }

  const fullSourcePath = resolveSafePath(sourcePath);
  const fullTargetDir = resolveSafePath(targetDir);

  // Verify target is a directory
  try {
    const stat = await fsp.stat(fullTargetDir);
    if (!stat.isDirectory()) throw ApiError.badRequest('Target is not a directory');
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw ApiError.notFound('Target directory not found');
  }

  // Verify source exists
  try {
    await fsp.access(fullSourcePath);
  } catch {
    throw ApiError.notFound('Source file not found');
  }

  const fileName = path.basename(fullSourcePath);
  const fullNewPath = path.join(fullTargetDir, fileName);

  // Check for collision
  try {
    await fsp.access(fullNewPath);
    throw ApiError.conflict('File with that name already exists in target directory');
  } catch (err) {
    if (err instanceof ApiError) throw err;
  }

  await fsp.rename(fullSourcePath, fullNewPath);

  // Preserve annotations
  const { baseDir } = config;
  const oldRelative = path.relative(path.resolve(baseDir), fullSourcePath);
  const newRelative = path.relative(path.resolve(baseDir), fullNewPath);
  renameAnnotation(oldRelative, newRelative);

  res.json({ success: true, message: 'File moved successfully', newPath: newRelative });
}));

module.exports = router;
