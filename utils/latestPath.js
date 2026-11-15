const fs = require('fs');
const path = require('path');
const config = require('../lib/config');
const logger = require('../lib/logger');

// Last browsed path, persisted next to the server as a session fallback
const latestPathFile = path.join(__dirname, '..', '.latest');

function readLatestPath() {
  try {
    if (fs.existsSync(latestPathFile)) {
      const content = fs.readFileSync(latestPathFile, 'utf-8').trim();
      const fullPath = path.resolve(config.baseDir, content);
      if (content && fullPath.startsWith(path.resolve(config.baseDir)) && fs.existsSync(fullPath)) {
        return content;
      }
    }
  } catch (err) {
    logger.warn('Failed to read .latest file:', err.message);
  }
  return '';
}

function saveLatestPath(pathToSave) {
  try {
    fs.writeFileSync(latestPathFile, pathToSave || '', 'utf-8');
  } catch (err) {
    logger.warn('Failed to save .latest file:', err.message);
  }
}

module.exports = { readLatestPath, saveLatestPath };
