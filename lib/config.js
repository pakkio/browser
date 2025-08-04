const path = require('path');

const AUTH_ENABLED = ['TRUE', 'YES', '1', 'true', 'yes'].includes((process.env.AUTH || 'FALSE').toUpperCase());
const port = process.env.PORT || 3000;
const baseDir = path.resolve(process.argv[2] || '.');

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

module.exports = {
    AUTH_ENABLED,
    port,
    baseDir,
    mimeTypes,
    getImageMimeType,
    getVideoMimeType
};