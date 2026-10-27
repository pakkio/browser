const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const AUTH_ENABLED = ['TRUE', 'YES', '1', 'true', 'yes'].includes((process.env.AUTH || 'FALSE').toUpperCase());
const port = process.env.PORT || 3000;

// Determine base directory: arg from CLI, or current dir.
// Skip argv[2] when running under test runner (jest passes its own flags as args).
const testRunnerArgs = ['--config', '--testPathPattern', '--testNamePattern', '--testRunner'];
const argvDir = process.env.NODE_ENV === 'test' || testRunnerArgs.includes(process.argv[2])
    ? '.'
    : (process.argv[2] || '.');

// Use the real path: handlers compare realpath'd targets against baseDir, and a
// mapped Windows drive (Z:\) resolves to its network path (\server\share)
let baseDir = path.resolve(argvDir);
try {
    baseDir = fs.realpathSync.native(baseDir);
} catch (e) {
    // keep the resolved path if it doesn't exist yet
}
logger.debug('Config resolved', { argv: process.argv.slice(2), baseDir });

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.mpg': 'video/mpeg',
    '.mpeg': 'video/mpeg',
    '.wmv': 'video/x-ms-wmv',
    '.woff': 'application/font-woff',
    '.ttf': 'application/font-ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'application/font-otf',
    '.wasm': 'application/wasm',
    '.pdf': 'application/pdf',
    '.cbz': 'application/vnd.comicbook+zip',
    '.cbr': 'application/vnd.comicbook-rar',
    '.epub': 'application/epub+zip'
};

function getImageMimeType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const imageMimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.tiff': 'image/tiff',
        '.tif': 'image/tiff'
    };
    return imageMimeTypes[ext] || 'image/jpeg';
}

function getVideoMimeType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const videoMimeTypes = {
        '.mp4': 'video/mp4',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        '.mkv': 'video/x-matroska',
        '.webm': 'video/webm',
        '.mpg': 'video/mpeg',
        '.mpeg': 'video/mpeg',
        '.wmv': 'video/x-ms-wmv'
    };
    return videoMimeTypes[ext] || 'video/mp4';
}

/**
 * Mime type for a file extracted from an archive, or null when it is unknown.
 * Unlike getImageMimeType/getVideoMimeType this has no catch-all default, so
 * PDFs, audio and other known types keep their own type.
 */
function getArchiveMimeType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const known = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'].includes(ext)
        ? getImageMimeType(fileName)
        : ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.mpg', '.mpeg', '.wmv'].includes(ext)
            ? getVideoMimeType(fileName)
            : mimeTypes[ext];
    return known || null;
}

module.exports = {
    AUTH_ENABLED,
    port,
    baseDir,
    mimeTypes,
    getImageMimeType,
    getVideoMimeType,
    getArchiveMimeType
};