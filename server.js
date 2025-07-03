// Load environment variables
require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const pdf2pic = require('pdf2pic');
const yauzl = require('yauzl');
const { createExtractorFromFile } = require('node-unrar-js');
const tar = require('tar-stream');
const session = require('express-session');
const { passport, requireAuth, optionalAuth } = require('./auth');
const FileCache = require('./cache');

const AUTH_ENABLED = ['TRUE', 'YES', '1', 'true', 'yes'].includes((process.env.AUTH || 'FALSE').toUpperCase());

const app = express();
const port = process.env.PORT || 3000;

const baseDir = path.resolve(process.argv[2] || '.');

// Session configuration (only if auth is enabled)
if (AUTH_ENABLED) {
    app.use(session({
        secret: process.env.SESSION_SECRET || 'your-fallback-secret-key-change-in-production',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: false, // Set to true in production with HTTPS
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        }
    }));

    // Initialize Passport
    app.use(passport.initialize());
    app.use(passport.session());
}

// Initialize disk-based cache system
const cache = new FileCache({
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    maxSize: 500 * 1024 * 1024   // 500MB cache limit
});

// In-memory cache for pending requests to avoid duplicate processing
const pendingRequests = new Map();

// Helper function for image MIME type detection
function getImageMimeType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.tiff': 'image/tiff',
        '.tif': 'image/tiff'
    };
    return mimeTypes[ext] || 'image/jpeg';
}

console.log('================================');
console.log('🚀 File Browser Server Starting...');
console.log(`📂 Base directory: ${baseDir}`);
console.log(`🔧 Port: ${port}`);
console.log(`🔐 Authentication: ${AUTH_ENABLED ? 'ENABLED' : 'DISABLED'}`);
console.log('================================');

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

// Authentication routes (only if auth is enabled)
if (AUTH_ENABLED) {
    app.get('/auth/google',
        passport.authenticate('google', { scope: ['profile', 'email'] })
    );

    app.get('/auth/google/callback',
        passport.authenticate('google', { failureRedirect: '/login-failed' }),
        (req, res) => {
            // Successful authentication
            console.log(`[${new Date().toISOString()}] ✅ Authentication successful for ${req.user.name}`);
            res.redirect('/');
        }
    );

    app.post('/auth/logout', (req, res) => {
        const userName = req.user?.name || 'Unknown user';
        req.logout((err) => {
            if (err) {
                console.error(`[${new Date().toISOString()}] ❌ Logout error: ${err.message}`);
                return res.status(500).json({ error: 'Logout failed' });
            }
            
            req.session.destroy((err) => {
                if (err) {
                    console.error(`[${new Date().toISOString()}] ❌ Session destroy error: ${err.message}`);
                    return res.status(500).json({ error: 'Session cleanup failed' });
                }
                
                console.log(`[${new Date().toISOString()}] 👋 User logged out: ${userName}`);
                res.json({ success: true, message: 'Logged out successfully' });
            });
        });
    });

    app.get('/login-failed', (req, res) => {
        res.status(401).send(`
            <html>
                <head><title>Login Failed</title></head>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h1>Authentication Failed</h1>
                    <p>Unable to authenticate with Google. Please try again.</p>
                    <a href="/auth/google" style="background: #4285f4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
                        Try Again
                    </a>
                </body>
            </html>
        `);
    });
} else {
    // When auth is disabled, return 404 for auth routes
    app.get('/auth/google', (req, res) => {
        res.status(404).json({ error: 'Authentication is disabled' });
    });
    
    app.get('/auth/google/callback', (req, res) => {
        res.status(404).json({ error: 'Authentication is disabled' });
    });
    
    app.post('/auth/logout', (req, res) => {
        res.status(404).json({ error: 'Authentication is disabled' });
    });
    
    app.get('/login-failed', (req, res) => {
        res.status(404).json({ error: 'Authentication is disabled' });
    });
}

// User info endpoint (works for both auth enabled/disabled)
app.get('/auth/user', (req, res) => {
    if (!AUTH_ENABLED) {
        res.json({ 
            authenticated: false, 
            authDisabled: true 
        });
    } else if (req.isAuthenticated && req.isAuthenticated()) {
        res.json({
            authenticated: true,
            user: {
                name: req.user.name,
                email: req.user.email,
                picture: req.user.picture
            }
        });
    } else {
        res.json({ authenticated: false });
    }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/browse', requireAuth, (req, res) => {
    const requestedPath = req.query.path || '';
    const dirPath = path.join(baseDir, requestedPath);
    
    console.log(`[${new Date().toISOString()}] GET /api/browse - path: "${requestedPath}"`);
    console.log(`[${new Date().toISOString()}] Resolved to: ${dirPath}`);

    if (!dirPath.startsWith(baseDir)) {
        console.log(`[${new Date().toISOString()}] ❌ Forbidden access attempt to: ${dirPath}`);
        return res.status(403).send('Forbidden');
    }

    try {
        const files = fs.readdirSync(dirPath, { withFileTypes: true });
        console.log(`[${new Date().toISOString()}] ✅ Found ${files.length} files/directories`);
        
        const fileList = files.map(file => {
            const filePath = path.join(dirPath, file.name);
            let stats = null;
            try {
                stats = fs.statSync(filePath);
            } catch (e) {
                console.log(`[${new Date().toISOString()}] ⚠️  Stat error for ${file.name}: ${e.message}`);
            }
            
            return {
                name: file.name,
                isDirectory: file.isDirectory(),
                size: stats && !file.isDirectory() ? stats.size : null,
                modified: stats ? stats.mtime.toISOString() : null
            };
        });
        
        const response = {
            files: fileList,
            currentPath: dirPath,
            basePath: baseDir
        };
        console.log(`[${new Date().toISOString()}] 📤 Sending ${fileList.length} items in response`);
        res.json(response);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Browse error: ${error.message}`);
        res.status(500).send(error.toString());
    }
});

app.get('/api/pdf-info', requireAuth, (req, res) => {
    const requestedFile = req.query.path;
    if (!requestedFile) {
        return res.status(400).send('File path is required');
    }
    const filePath = path.join(baseDir, requestedFile);
    if (!filePath.startsWith(baseDir)) {
        return res.status(403).send('Forbidden');
    }

    exec(`pdfinfo "${filePath}"`, (error, stdout, stderr) => {
        if (error) {
            console.error(`[${new Date().toISOString()}] ❌ PDF info error: ${stderr}`);
            return res.status(500).send('Failed to get PDF info');
        }
        const pagesMatch = stdout.match(/Pages:\s*(\d+)/);
        if (pagesMatch && pagesMatch[1]) {
            res.json({ pages: parseInt(pagesMatch[1], 10) });
        } else {
            res.status(500).send('Could not parse PDF info');
        }
    });
});

app.get('/files', requireAuth, (req, res) => {
    const requestedFile = req.query.path;
    console.log(`[${new Date().toISOString()}] GET /files - path: "${requestedFile}"`);
    
    if (!requestedFile) {
        console.log(`[${new Date().toISOString()}] ❌ File path is required`);
        return res.status(400).send('File path is required');
    }
    const filePath = path.join(baseDir, requestedFile);

    if (!filePath.startsWith(baseDir)) {
        console.log(`[${new Date().toISOString()}] ❌ Forbidden file access attempt: ${filePath}`);
        return res.status(403).send('Forbidden');
    }

    // Check if the path is a directory
    try {
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
            console.log(`[${new Date().toISOString()}] ❌ Attempted to serve a directory: ${filePath}`);
            return res.status(400).send('Requested resource is a directory, not a file');
        }
    } catch (error) {
        console.log(`[${new Date().toISOString()}] ❌ File not found: ${filePath}`);
        return res.status(404).send('File not found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    console.log(`[${new Date().toISOString()}] 📁 Serving file: ${filePath} (${contentType})`);
    
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;
    const range = req.headers.range;

    if (range) {
        // Parse Range header
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        
        console.log(`[${new Date().toISOString()}] 📁 Range request: ${start}-${end}/${fileSize}`);
        
        const stream = fs.createReadStream(filePath, { start, end });
        
        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': contentType,
        });
        
        stream.on('error', (err) => {
            console.error(`[${new Date().toISOString()}] ❌ File stream error: ${err.message}`);
            res.status(500).send(err.message);
        });
        stream.pipe(res);
    } else {
        // Regular file serve
        res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes'
        });
        
        const stream = fs.createReadStream(filePath);
        stream.on('error', (err) => {
            console.error(`[${new Date().toISOString()}] ❌ File stream error: ${err.message}`);
            res.status(500).send(err.message);
        });
        stream.pipe(res);
    }
});

app.get('/pdf-preview', requireAuth, async (req, res) => {
    const requestedFile = req.query.path;
    const page = parseInt(req.query.page) || 1;
    console.log(`[${new Date().toISOString()}] GET /pdf-preview - file: "${requestedFile}", page: ${page}`);
    
    if (!requestedFile) {
        console.log(`[${new Date().toISOString()}] ❌ PDF preview: File path is required`);
        return res.status(400).send('File path is required');
    }
    
    const filePath = path.join(baseDir, requestedFile);
    
    if (!filePath.startsWith(baseDir)) {
        console.log(`[${new Date().toISOString()}] ❌ PDF preview: Forbidden access to ${filePath}`);
        return res.status(403).send('Forbidden');
    }
    
    if (path.extname(filePath).toLowerCase() !== '.pdf') {
        console.log(`[${new Date().toISOString()}] ❌ PDF preview: Not a PDF file: ${filePath}`);
        return res.status(400).send('Not a PDF file');
    }
    
    try {
        console.log(`[${new Date().toISOString()}] 🔄 Converting PDF page ${page}...`);
        const options = {
            density: 100,
            format: "png",
            width: 800,
            height: 1000
        };
        
        const convert = pdf2pic.fromPath(filePath, options);
        const result = await convert(page, { responseType: "base64" });
        
        if (result && result.base64 && result.base64.length > 0) {
            console.log(`[${new Date().toISOString()}] ✅ PDF conversion successful, sending ${result.base64.length} bytes`);
            const buffer = Buffer.from(result.base64, 'base64');
            res.setHeader('Content-Type', 'image/png');
            res.send(buffer);
        } else {
            throw new Error('PDF conversion returned empty result');
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ PDF conversion error: ${error.message}`);
        res.status(500).send(`PDF conversion error: ${error.message}`);
    }
});

app.get('/video-transcode', requireAuth, async (req, res) => {
    const requestedFile = req.query.path;
    console.log(`[${new Date().toISOString()}] GET /video-transcode - file: "${requestedFile}"`);
    
    if (!requestedFile) {
        return res.status(400).send('File path is required');
    }
    
    const filePath = path.join(baseDir, requestedFile);
    
    if (!filePath.startsWith(baseDir)) {
        return res.status(403).send('Forbidden');
    }
    
    const ext = path.extname(filePath).toLowerCase();
    if (!['.avi', '.wmv'].includes(ext)) {
        return res.status(400).send('Only AVI and WMV files supported for transcoding');
    }
    
    try {
        console.log(`[${new Date().toISOString()}] 🔄 Transcoding ${ext.toUpperCase()} to WebM...`);
        
        // Set headers for streaming (using WebM for better streaming support)
        res.setHeader('Content-Type', 'video/webm');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-cache');
        
        // Use spawn instead of exec for better stream handling
        const ffmpeg = spawn('ffmpeg', [
            '-i', filePath,
            '-c:v', 'libvpx-vp9',
            '-preset', 'fast',
            '-crf', '30',
            '-c:a', 'libopus',
            '-f', 'webm',
            '-'
        ]);
        
        // Handle stderr for FFmpeg logging
        ffmpeg.stderr.on('data', (data) => {
            console.log(`[FFmpeg] ${data.toString()}`);
        });
        
        ffmpeg.stdout.pipe(res);
        
        ffmpeg.on('close', (code) => {
            if (code === 0) {
                console.log(`[${new Date().toISOString()}] ✅ Video transcoding completed`);
            } else {
                console.error(`[${new Date().toISOString()}] ❌ FFmpeg failed with code ${code}`);
            }
        });
        
        ffmpeg.on('error', (error) => {
            console.error(`[${new Date().toISOString()}] ❌ Transcoding error: ${error.message}`);
            if (!res.headersSent) {
                res.status(500).send(`Transcoding error: ${error.message}`);
            }
        });
        
        // Handle client disconnect
        req.on('close', () => {
            ffmpeg.kill('SIGKILL');
        });
        
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Video transcoding error: ${error.message}`);
        res.status(500).send(`Video transcoding error: ${error.message}`);
    }
});

app.get('/comic-preview', requireAuth, async (req, res) => {
    const requestedFile = req.query.path;
    const page = parseInt(req.query.page) || 1;
    console.log(`[${new Date().toISOString()}] GET /comic-preview - file: "${requestedFile}", page: ${page}`);
    
    if (!requestedFile) {
        console.log(`[${new Date().toISOString()}] ❌ Comic preview: File path is required`);
        return res.status(400).send('File path is required');
    }
    
    const filePath = path.join(baseDir, requestedFile);
    
    if (!filePath.startsWith(baseDir)) {
        console.log(`[${new Date().toISOString()}] ❌ Comic preview: Forbidden access to ${filePath}`);
        return res.status(403).send('Forbidden');
    }
    
    const ext = path.extname(filePath).toLowerCase();
    if (!['.cbz', '.cbr'].includes(ext)) {
        console.log(`[${new Date().toISOString()}] ❌ Comic preview: Not a comic archive: ${filePath}`);
        return res.status(400).send('Not a comic book archive');
    }
    
    try {
        console.log(`[${new Date().toISOString()}] 🔄 Extracting comic page ${page} from ${ext} file...`);
        if (ext === '.cbz') {
            await extractFromCBZ(filePath, page, res);
        } else if (ext === '.cbr') {
            await extractFromCBR(filePath, page, res);
        }
        console.log(`[${new Date().toISOString()}] ✅ Comic extraction completed`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Comic extraction error: ${error.message}`);
        res.status(500).send(`Comic extraction error: ${error.message}`);
    }
});

// Comic info endpoint to get total pages
app.get('/api/comic-info', requireAuth, async (req, res) => {
    const requestedFile = req.query.path;
    console.log(`[${new Date().toISOString()}] GET /api/comic-info - file: "${requestedFile}"`);
    
    if (!requestedFile) {
        console.log(`[${new Date().toISOString()}] ❌ Comic info: File path is required`);
        return res.status(400).send('File path is required');
    }
    
    const filePath = path.join(baseDir, requestedFile);
    
    if (!filePath.startsWith(baseDir)) {
        console.log(`[${new Date().toISOString()}] ❌ Comic info: Forbidden access to ${filePath}`);
        return res.status(403).send('Forbidden');
    }
    
    const ext = path.extname(filePath).toLowerCase();
    if (!['.cbz', '.cbr'].includes(ext)) {
        console.log(`[${new Date().toISOString()}] ❌ Comic info: Not a comic archive: ${filePath}`);
        return res.status(400).send('Not a comic book archive');
    }
    
    try {
        console.log(`[${new Date().toISOString()}] 🔄 Getting comic info for ${ext} file...`);
        const imageFiles = await getComicFileList(filePath);
        
        res.json({
            pages: imageFiles.length,
            format: ext.replace('.', '').toUpperCase()
        });
        
        console.log(`[${new Date().toISOString()}] ✅ Comic info: Found ${imageFiles.length} pages`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Comic info error: ${error.message}`);
        res.status(500).send(`Comic info error: ${error.message}`);
    }
});

// Archive contents endpoint
app.get('/archive-contents', requireAuth, async (req, res) => {
    const requestedFile = req.query.path;
    const subPath = req.query.subPath || '';
    console.log(`[${new Date().toISOString()}] GET /archive-contents - file: "${requestedFile}", subPath: "${subPath}"`);
    
    if (!requestedFile) {
        console.log(`[${new Date().toISOString()}] ❌ Archive contents: File path is required`);
        return res.status(400).send('File path is required');
    }
    
    const filePath = path.join(baseDir, requestedFile);
    
    if (!filePath.startsWith(baseDir)) {
        console.log(`[${new Date().toISOString()}] ❌ Archive contents: Forbidden access to ${filePath}`);
        return res.status(403).send('Forbidden');
    }
    
    const ext = path.extname(filePath).toLowerCase();
    const isGzipped = filePath.endsWith('.tar.gz') || ext === '.tgz';
    
    if (!['zip', 'rar', 'tar'].includes(ext.replace('.', '')) && !isGzipped) {
        console.log(`[${new Date().toISOString()}] ❌ Archive contents: Not a supported archive: ${filePath}`);
        return res.status(400).send('Not a supported archive format');
    }
    
    try {
        let contents = [];
        
        if (ext === '.zip') {
            contents = await getZipContents(filePath, subPath);
        } else if (ext === '.rar') {
            contents = await getRarContents(filePath, subPath);
        } else if (ext === '.tar' || isGzipped) {
            contents = await getTarContents(filePath, subPath, isGzipped);
        }
        
        console.log(`[${new Date().toISOString()}] ✅ Archive contents: Found ${contents.length} items`);
        res.json(contents);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Archive contents error: ${error.message}`);
        res.status(500).send(`Archive reading error: ${error.message}`);
    }
});

// Archive file extraction endpoint
app.get('/archive-file', requireAuth, async (req, res) => {
    const archivePath = req.query.archive;
    const filePath = req.query.file;
    console.log(`[${new Date().toISOString()}] GET /archive-file - archive: "${archivePath}", file: "${filePath}"`);
    
    if (!archivePath || !filePath) {
        console.log(`[${new Date().toISOString()}] ❌ Archive file: Archive and file path are required`);
        return res.status(400).send('Archive and file path are required');
    }
    
    const fullArchivePath = path.join(baseDir, archivePath);
    
    if (!fullArchivePath.startsWith(baseDir)) {
        console.log(`[${new Date().toISOString()}] ❌ Archive file: Forbidden access to ${fullArchivePath}`);
        return res.status(403).send('Forbidden');
    }
    
    const ext = path.extname(fullArchivePath).toLowerCase();
    const isGzipped = fullArchivePath.endsWith('.tar.gz') || ext === '.tgz';
    
    try {
        if (ext === '.zip') {
            await extractFileFromZip(fullArchivePath, filePath, res);
        } else if (ext === '.rar') {
            await extractFileFromRar(fullArchivePath, filePath, res);
        } else if (ext === '.tar' || isGzipped) {
            await extractFileFromTar(fullArchivePath, filePath, res, isGzipped);
        } else {
            throw new Error('Unsupported archive format');
        }
        
        console.log(`[${new Date().toISOString()}] ✅ Archive file extraction completed`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Archive file extraction error: ${error.message}`);
        res.status(500).send(`File extraction error: ${error.message}`);
    }
});

async function extractFromCBZ(filePath, page, res) {
    return new Promise((resolve, reject) => {
        yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
            if (err) return reject(err);
            
            const imageFiles = [];
            
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                if (!entry || !entry.fileName) {
                    zipfile.readEntry();
                    return;
                }
                
                if (entry.fileName.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif)$/i)) {
                    imageFiles.push(entry);
                }
                zipfile.readEntry();
            });
            
            zipfile.on('end', () => {
                imageFiles.sort((a, b) => (a.fileName || '').localeCompare(b.fileName || ''));
                
                if (page > imageFiles.length || page < 1) {
                    zipfile.close();
                    return reject(new Error(`Page not found. Found ${imageFiles.length} images, requested page ${page}`));
                }
                
                const targetEntry = imageFiles[page - 1];
                zipfile.openReadStream(targetEntry, (err, readStream) => {
                    if (err) {
                        zipfile.close();
                        return reject(err);
                    }
                    
                    const mimeType = getImageMimeType(targetEntry.fileName);
                    
                    res.setHeader('Content-Type', mimeType);
                    readStream.pipe(res);
                    
                    readStream.on('end', () => {
                        zipfile.close();
                        resolve();
                    });
                    
                    readStream.on('error', (err) => {
                        zipfile.close();
                        reject(err);
                    });
                });
            });
            
            zipfile.on('error', (err) => {
                zipfile.close();
                reject(err);
            });
        });
    });
}

async function getComicFileList(filePath) {
    // Generate cache key
    const cacheKey = cache.generateKey(filePath, 'comic-list');
    
    // Check disk cache first
    const cachedList = await cache.get('comic-lists', cacheKey, filePath);
    if (cachedList) {
        return cachedList;
    }
    
    return new Promise((resolve, reject) => {
        console.log(`[${new Date().toISOString()}] 📖 CBR: Running unrar l "${filePath}"`);
        exec(`unrar l "${filePath}"`, (err, stdout, stderr) => {
            if (err) {
                console.error(`[${new Date().toISOString()}] ❌ CBR: unrar error: ${err.message}`);
                console.error(`[${new Date().toISOString()}] ❌ CBR: stderr: ${stderr}`);
                return reject(err);
            }
            
            console.log(`[${new Date().toISOString()}] 📖 CBR: unrar stdout length: ${stdout.length}`);
            const lines = stdout.split('\n');
            
            // Find the line with dashes (separator between header and file list)
            const separatorIndex = lines.findIndex(line => line.includes('-------'));
            if (separatorIndex === -1) {
                console.error(`[${new Date().toISOString()}] ❌ CBR: Could not find separator in unrar output`);
                return reject(new Error('Invalid unrar output format'));
            }
            
            // Extract filenames from the lines after the separator
            const files = [];
            for (let i = separatorIndex + 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line || line.includes('-------')) break; // End of file list
                
                // Split by spaces and take the last part (filename)
                const parts = line.split(/\s+/);
                if (parts.length >= 5) { // Should have at least: attributes, size, date, time, name
                    const filename = parts[parts.length - 1];
                    if (filename && filename !== '1') { // Skip the summary line
                        files.push(filename);
                    }
                }
            }
            
            console.log(`[${new Date().toISOString()}] 📖 CBR: Found ${files.length} total files: ${files.slice(0, 5).join(', ')}${files.length > 5 ? '...' : ''}`);
            
            const imageFiles = files
                .filter(file => file.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif)$/i))
                .sort();
            
            console.log(`[${new Date().toISOString()}] 📖 CBR: Found ${imageFiles.length} image files: ${imageFiles.slice(0, 3).join(', ')}${imageFiles.length > 3 ? '...' : ''}`);
            
            // Cache the result to disk
            cache.set('comic-lists', cacheKey, imageFiles, filePath);
            resolve(imageFiles);
        });
    });
}

async function extractFromCBR(filePath, page, res) {
    const requestKey = `${filePath}:${page}`;
    
    // Check if same request is already in progress
    if (pendingRequests.has(requestKey)) {
        return pendingRequests.get(requestKey);
    }
    
    const promise = new Promise(async (resolve, reject) => {
        try {
            const imageFiles = await getComicFileList(filePath);
            
            if (page > imageFiles.length || page < 1) {
                return reject(new Error(`Page not found. Found ${imageFiles.length} images, requested page ${page}`));
            }
            
            const targetFile = imageFiles[page - 1];
            
            // Extract the specific file
            exec(`unrar p -inul "${filePath}" "${targetFile}"`, { encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
                if (err) {
                    return reject(new Error(`Failed to extract ${targetFile}: ${err.message}`));
                }
                
                const mimeType = getImageMimeType(targetFile);
                
                res.setHeader('Content-Type', mimeType);
                res.send(stdout);
                resolve();
            });
        } catch (error) {
            extractFromCBRFallback(filePath, page, res).then(resolve).catch(reject);
        }
    });
    
    // Store pending request
    pendingRequests.set(requestKey, promise);
    
    // Clean up after completion
    promise.finally(() => {
        pendingRequests.delete(requestKey);
    });
    
    return promise;
}

async function extractFromCBRFallback(filePath, page, res) {
    try {
        const extractor = await createExtractorFromFile({ filepath: filePath });
        const list = await extractor.getFileList();
        
        // Handle different possible structures from node-unrar-js
        let fileHeaders = [];
        if (list && list.fileHeaders) {
            // Convert Generator to array if needed
            if (Array.isArray(list.fileHeaders)) {
                fileHeaders = list.fileHeaders;
            } else if (list.fileHeaders[Symbol.iterator]) {
                fileHeaders = Array.from(list.fileHeaders);
            } else {
                fileHeaders = [...list.fileHeaders];
            }
        } else if (Array.isArray(list)) {
            fileHeaders = list;
        } else if (list && typeof list === 'object' && list.files) {
            fileHeaders = Array.isArray(list.files) ? list.files : Array.from(list.files);
        } else {
            console.error(`[${new Date().toISOString()}] ❌ Unexpected list structure:`, list);
            throw new Error('Unexpected file list structure from RAR extractor');
        }
        
        const imageFiles = fileHeaders.filter(header => 
            header.name && header.name.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif)$/i)
        ).sort((a, b) => a.name.localeCompare(b.name));
        
        if (page > imageFiles.length || page < 1) {
            throw new Error(`Page not found. Found ${imageFiles.length} images, requested page ${page}`);
        }
        
        const targetFile = imageFiles[page - 1];
        const fileName = targetFile.name || targetFile.filename;
        const extracted = await extractor.extract({ files: [fileName] });
        
        console.log(`[${new Date().toISOString()}] 📖 CBR extraction: Full extracted object:`, JSON.stringify(extracted, null, 2));
        console.log(`[${new Date().toISOString()}] 📖 CBR extraction: Extracted keys:`, Object.keys(extracted));
        
        // Handle Generator object for files
        let filesArray = [];
        if (extracted.files) {
            if (Array.isArray(extracted.files)) {
                filesArray = extracted.files;
            } else if (extracted.files[Symbol.iterator]) {
                filesArray = Array.from(extracted.files);
            }
        }
        
        console.log(`[${new Date().toISOString()}] 📖 CBR extraction: Files array length:`, filesArray.length);
        
        // Try different ways to access the file data
        let fileBuffer = null;
        
        if (filesArray.length > 0) {
            const file = filesArray[0];
            console.log(`[${new Date().toISOString()}] 📖 CBR extraction: File object keys:`, Object.keys(file));
            console.log(`[${new Date().toISOString()}] 📖 CBR extraction: File type:`, typeof file);
            
            // Check various possible properties for file data
            if (file.extraction) {
                console.log(`[${new Date().toISOString()}] ✅ CBR extraction: Using file.extraction property (${file.extraction.length} bytes)`);
                fileBuffer = Buffer.from(file.extraction);
            } else if (file.fileData) {
                console.log(`[${new Date().toISOString()}] ✅ CBR extraction: Using file.fileData property (${file.fileData.length} bytes)`);
                fileBuffer = Buffer.from(file.fileData);
            } else if (file.data) {
                console.log(`[${new Date().toISOString()}] ✅ CBR extraction: Using file.data property (${file.data.length} bytes)`);
                fileBuffer = Buffer.from(file.data);
            } else if (file instanceof Uint8Array || file instanceof Buffer) {
                console.log(`[${new Date().toISOString()}] ✅ CBR extraction: File is direct buffer (${file.length} bytes)`);
                fileBuffer = Buffer.from(file);
            }
        }
        
        // If files array is empty, try to use extractToMem
        if (!fileBuffer && filesArray.length === 0) {
            console.log(`[${new Date().toISOString()}] 📖 CBR extraction: Files array is empty, trying extractToMem`);
            try {
                const memExtracted = extractor.extractToMem({ files: [targetFile.name] });
                console.log(`[${new Date().toISOString()}] 📖 CBR extraction: extractToMem result:`, Object.keys(memExtracted));
                
                if (memExtracted.files && memExtracted.files.length > 0) {
                    const memFile = memExtracted.files[0];
                    console.log(`[${new Date().toISOString()}] 📖 CBR extraction: Memory file keys:`, Object.keys(memFile));
                    
                    if (memFile.extraction) {
                        fileBuffer = Buffer.from(memFile.extraction);
                    } else if (memFile.fileData) {
                        fileBuffer = Buffer.from(memFile.fileData);
                    } else if (memFile.data) {
                        fileBuffer = Buffer.from(memFile.data);
                    }
                }
            } catch (memError) {
                console.log(`[${new Date().toISOString()}] ⚠️ CBR extraction: extractToMem failed:`, memError.message);
            }
        }
        
        // If we still don't have data, check if files were extracted to disk
        if (!fileBuffer) {
            console.log(`[${new Date().toISOString()}] 📖 CBR extraction: Checking for extracted files on disk`);
            const extractedFilePath = path.join(__dirname, targetFile.name);
            console.log(`[${new Date().toISOString()}] 📖 CBR extraction: Looking for file at: ${extractedFilePath}`);
            
            try {
                if (fs.existsSync(extractedFilePath)) {
                    console.log(`[${new Date().toISOString()}] ✅ CBR extraction: Found extracted file on disk`);
                    fileBuffer = fs.readFileSync(extractedFilePath);
                    console.log(`[${new Date().toISOString()}] ✅ CBR extraction: Read ${fileBuffer.length} bytes from disk`);
                    
                    // Clean up the extracted file
                    try {
                        fs.unlinkSync(extractedFilePath);
                        console.log(`[${new Date().toISOString()}] 🧹 CBR extraction: Cleaned up extracted file`);
                    } catch (cleanupError) {
                        console.log(`[${new Date().toISOString()}] ⚠️ CBR extraction: Failed to cleanup file: ${cleanupError.message}`);
                    }
                } else {
                    console.log(`[${new Date().toISOString()}] ❌ CBR extraction: File not found on disk`);
                }
            } catch (diskError) {
                console.log(`[${new Date().toISOString()}] ❌ CBR extraction: Error reading from disk: ${diskError.message}`);
            }
        }
        
        if (!fileBuffer) {
            console.error(`[${new Date().toISOString()}] ❌ CBR extraction: No recognizable data format found after all attempts`);
            throw new Error('Could not extract file data');
        }
        
        const mimeType = getImageMimeType(fileName);
        
        res.setHeader('Content-Type', mimeType);
        res.send(fileBuffer);
        
    } catch (error) {
        throw error;
    }
}

app.get('/epub-cover', requireAuth, async (req, res) => {
    try {
        const filePath = req.query.path;
        const coverPath = req.query.cover;
        
        console.log(`[${new Date().toISOString()}] GET /epub-cover - file: "${filePath}", cover: "${coverPath}"`);
        
        if (!filePath || !coverPath) {
            console.log(`[${new Date().toISOString()}] ❌ EPUB cover: Missing parameters`);
            return res.status(400).json({ error: 'Missing file path or cover path' });
        }

        const yauzl = require('yauzl');
        
        const fullPath = path.join(baseDir, filePath);
        yauzl.open(fullPath, { lazyEntries: true }, (err, zipfile) => {
            if (err) {
                console.error(`[${new Date().toISOString()}] ❌ EPUB cover: ZIP open error: ${err.message}`);
                return res.status(500).json({ error: err.message });
            }
            
            const allEntries = [];
            let foundCover = false;
            
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                if (!entry || !entry.fileName) {
                    zipfile.readEntry();
                    return;
                }
                
                allEntries.push(entry.fileName);
                console.log(`[${new Date().toISOString()}] 📁 EPUB entry: "${entry.fileName}"`);
                
                // Log comparison for debugging
                if (entry.fileName.toLowerCase() === coverPath.toLowerCase()) {
                    console.log(`[${new Date().toISOString()}] 🔍 Case-insensitive match: "${entry.fileName}" === "${coverPath}"`);
                }
                
                if (entry.fileName === coverPath) {
                    foundCover = true;
                    console.log(`[${new Date().toISOString()}] ✅ Found exact cover match: ${entry.fileName}`);
                    zipfile.openReadStream(entry, (err, readStream) => {
                        if (err) {
                            console.error(`[${new Date().toISOString()}] ❌ EPUB cover: Stream error: ${err.message}`);
                            return res.status(500).json({ error: err.message });
                        }
                        
                        const mimeType = coverPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
                        res.setHeader('Content-Type', mimeType);
                        readStream.pipe(res);
                    });
                } else {
                    zipfile.readEntry();
                }
            });
            
            zipfile.on('end', () => {
                if (!res.headersSent) {
                    console.log(`[${new Date().toISOString()}] ❌ EPUB cover not found. Looking for: "${coverPath}"`);
                    console.log(`[${new Date().toISOString()}] Available entries: ${allEntries.join(', ')}`);
                    res.status(404).json({ 
                        error: 'Cover image not found',
                        requestedPath: coverPath,
                        availableEntries: allEntries.slice(0, 20) // Limit to first 20 for readability
                    });
                }
            });
        });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ EPUB cover: General error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.get('/epub-preview', requireAuth, async (req, res) => {
    const requestedFile = req.query.path;
    console.log(`[${new Date().toISOString()}] GET /epub-preview - file: "${requestedFile}"`);
    
    if (!requestedFile) {
        console.log(`[${new Date().toISOString()}] ❌ EPUB preview: File path is required`);
        return res.status(400).json({ error: 'File path is required' });
    }
    
    const filePath = path.join(baseDir, requestedFile);
    
    if (!filePath.startsWith(baseDir)) {
        console.log(`[${new Date().toISOString()}] ❌ EPUB preview: Forbidden access to ${filePath}`);
        return res.status(403).json({ error: 'Forbidden' });
    }
    
    if (path.extname(filePath).toLowerCase() !== '.epub') {
        console.log(`[${new Date().toISOString()}] ❌ EPUB preview: Not an EPUB file: ${filePath}`);
        return res.status(400).json({ error: 'Not an EPUB file' });
    }
    
    try {
        console.log(`[${new Date().toISOString()}] 🔄 Extracting EPUB content...`);
        const epubData = await extractEpubContent(filePath);
        console.log(`[${new Date().toISOString()}] ✅ EPUB extraction completed - ${epubData.chapters.length} chapters`);
        res.json(epubData);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ EPUB extraction error: ${error.message}`);
        res.status(500).json({ error: `EPUB extraction error: ${error.message}` });
    }
});

async function extractEpubContent(filePath) {
    console.log(`[${new Date().toISOString()}] 📖 Starting EPUB extraction for: ${filePath}`);
    
    return new Promise((resolve, reject) => {
        yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
            if (err) {
                console.error(`[${new Date().toISOString()}] ❌ EPUB: Failed to open ZIP file: ${err.message}`);
                return reject(err);
            }
            
            console.log(`[${new Date().toISOString()}] 📖 EPUB: Successfully opened ZIP file`);
            
            const files = new Map();
            let metadata = {};
            let spine = [];
            let entryCount = 0;
            
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                entryCount++;
                
                if (!entry || !entry.fileName) {
                    console.warn(`[${new Date().toISOString()}] ⚠️ EPUB: Invalid entry ${entryCount}, skipping`);
                    zipfile.readEntry();
                    return;
                }
                
                console.log(`[${new Date().toISOString()}] 📖 EPUB: Processing entry ${entryCount}: "${entry.fileName}"`);
                
                if (entry.fileName.endsWith('/')) {
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Skipping directory: ${entry.fileName}`);
                    zipfile.readEntry();
                    return;
                }
                
                zipfile.openReadStream(entry, (err, readStream) => {
                    if (err) {
                        console.error(`[${new Date().toISOString()}] ❌ EPUB: Failed to read entry "${entry.fileName}": ${err.message}`);
                        zipfile.readEntry();
                        return;
                    }
                    
                    const chunks = [];
                    readStream.on('data', chunk => chunks.push(chunk));
                    readStream.on('end', () => {
                        const content = Buffer.concat(chunks).toString('utf8');
                        files.set(entry.fileName, content);
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Extracted "${entry.fileName}" (${content.length} chars)`);
                        zipfile.readEntry();
                    });
                    readStream.on('error', (streamErr) => {
                        console.error(`[${new Date().toISOString()}] ❌ EPUB: Stream error for "${entry.fileName}": ${streamErr.message}`);
                        zipfile.readEntry();
                    });
                });
            });
            
            zipfile.on('end', async () => {
                console.log(`[${new Date().toISOString()}] 📖 EPUB: Finished reading ZIP file. Total entries processed: ${entryCount}`);
                console.log(`[${new Date().toISOString()}] 📖 EPUB: Total files extracted: ${files.size}`);
                console.log(`[${new Date().toISOString()}] 📖 EPUB: File list: ${Array.from(files.keys()).join(', ')}`);
                
                try {
                    // Parse container.xml to find OPF file
                    const containerXml = files.get('META-INF/container.xml');
                    if (!containerXml) {
                        console.error(`[${new Date().toISOString()}] ❌ EPUB: Missing container.xml file`);
                        throw new Error('Missing container.xml');
                    }
                    
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Found container.xml (${containerXml.length} chars)`);
                    
                    const opfPathMatch = containerXml.match(/full-path="([^"]+)"/i);
                    if (!opfPathMatch) {
                        console.error(`[${new Date().toISOString()}] ❌ EPUB: Could not find OPF path in container.xml`);
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Container.xml content: ${containerXml.substring(0, 500)}...`);
                        throw new Error('Could not find OPF file path');
                    }
                    
                    const opfPath = opfPathMatch[1];
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Found OPF path: "${opfPath}"`);
                    
                    const opfContent = files.get(opfPath);
                    if (!opfContent) {
                        console.error(`[${new Date().toISOString()}] ❌ EPUB: Could not find OPF file at path: "${opfPath}"`);
                        throw new Error('Could not find OPF file');
                    }
                    
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Found OPF content (${opfContent.length} chars)`);
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: OPF preview: ${opfContent.substring(0, 200)}...`);
                    
                    // Extract metadata
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Extracting metadata...`);
                    const titleMatch = opfContent.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
                    const creatorMatch = opfContent.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i);
                    const descMatch = opfContent.match(/<dc:description[^>]*>([^<]+)<\/dc:description>/i);
                    
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Title: ${titleMatch ? titleMatch[1] : 'None'}`);
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Creator: ${creatorMatch ? creatorMatch[1] : 'None'}`);
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Description: ${descMatch ? descMatch[1].substring(0, 100) : 'None'}...`);
                    
                    // Extract cover image - try multiple methods
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Searching for cover image...`);
                    let coverPath = null;
                    
                    // Method 1: Look for <meta name="cover" content="..."/>
                    const coverMetaMatch = opfContent.match(/<meta\s+name="cover"\s+content="([^"]+)"/i);
                    if (coverMetaMatch) {
                        const coverId = coverMetaMatch[1];
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Found cover meta with ID: ${coverId}`);
                        const coverItemMatch = opfContent.match(new RegExp(`<item\\s+id="${coverId}"[^>]*href="([^"]+)"`, 'i'));
                        if (coverItemMatch) {
                            const opfDir = path.dirname(opfPath);
                            coverPath = opfDir === '.' ? coverItemMatch[1] : `${opfDir}/${coverItemMatch[1]}`;
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Method 1 - Cover path: ${coverPath}`);
                        } else {
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Method 1 - Could not find item with cover ID`);
                        }
                    } else {
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Method 1 - No cover meta found`);
                    }
                    
                    // Method 2: Look for cover-image in manifest items if method 1 failed
                    if (!coverPath) {
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Trying method 2 - looking for cover-image ID`);
                        const coverItemMatch = opfContent.match(/<item[^>]*id="cover-image"[^>]*href="([^"]+)"/i) ||
                                             opfContent.match(/<item[^>]*href="([^"]+)"[^>]*id="cover-image"/i);
                        if (coverItemMatch) {
                            const opfDir = path.dirname(opfPath);
                            coverPath = opfDir === '.' ? coverItemMatch[1] : `${opfDir}/${coverItemMatch[1]}`;
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Method 2 - Cover path: ${coverPath}`);
                        } else {
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Method 2 - No cover-image ID found`);
                        }
                    }
                    
                    // Method 3: Look for any item with "cover" in the id
                    if (!coverPath) {
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Trying method 3 - looking for any cover ID`);
                        const coverItemMatch = opfContent.match(/<item[^>]*id="[^"]*cover[^"]*"[^>]*href="([^"]+)"/i);
                        if (coverItemMatch) {
                            const opfDir = path.dirname(opfPath);
                            coverPath = opfDir === '.' ? coverItemMatch[1] : `${opfDir}/${coverItemMatch[1]}`;
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Method 3 - Cover path: ${coverPath}`);
                        } else {
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Method 3 - No cover ID pattern found`);
                        }
                    }
                    
                    // Method 4: Look for first image file as fallback
                    if (!coverPath) {
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Trying method 4 - looking for first image file`);
                        const imageItemMatch = opfContent.match(/<item[^>]*media-type="image\/[^"]*"[^>]*href="([^"]+)"/i);
                        if (imageItemMatch) {
                            const opfDir = path.dirname(opfPath);
                            coverPath = opfDir === '.' ? imageItemMatch[1] : `${opfDir}/${imageItemMatch[1]}`;
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Method 4 - Cover path: ${coverPath}`);
                        } else {
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Method 4 - No image files found in manifest`);
                        }
                    }
                    
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Final cover path: ${coverPath || 'None'}`);
                    
                    // Additional debugging for cover path resolution
                    if (coverPath) {
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Checking if cover exists in ZIP...`);
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Looking for: "${coverPath}"`);
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Available files: ${Array.from(files.keys()).filter(f => f.includes('cover') || f.includes('jpeg') || f.includes('jpg') || f.includes('png')).join(', ')}`);
                        if (files.has(coverPath)) {
                            console.log(`[${new Date().toISOString()}] ✅ EPUB: Cover file found in extracted files`);
                        } else {
                            console.log(`[${new Date().toISOString()}] ❌ EPUB: Cover file NOT found in extracted files`);
                            // Try case-insensitive match
                            const lowerCoverPath = coverPath.toLowerCase();
                            for (const filePath of files.keys()) {
                                if (filePath.toLowerCase() === lowerCoverPath) {
                                    console.log(`[${new Date().toISOString()}] 🔍 EPUB: Found case-insensitive match: "${filePath}" for "${coverPath}"`);
                                    break;
                                }
                            }
                        }
                    }
                    
                    if (coverPath && !files.has(coverPath)) {
                        console.log(`[${new Date().toISOString()}] ⚠️ EPUB: Cover file "${coverPath}" not found in extracted files`);
                    }
                    
                    metadata = {
                        title: titleMatch ? titleMatch[1] : null,
                        creator: creatorMatch ? creatorMatch[1] : null,
                        description: descMatch ? descMatch[1] : null,
                        coverPath: coverPath
                    };
                    
                    // Extract spine order
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Extracting spine order...`);
                    const spineMatches = opfContent.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i);
                    if (spineMatches) {
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Found spine section`);
                        const itemrefMatches = spineMatches[1].match(/<itemref[^>]*idref="([^"]+)"/gi);
                        if (itemrefMatches) {
                            spine = itemrefMatches.map(match => {
                                const idMatch = match.match(/idref="([^"]+)"/i);
                                return idMatch ? idMatch[1] : null;
                            }).filter(Boolean);
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Found ${spine.length} spine items: ${spine.join(', ')}`);
                        } else {
                            console.log(`[${new Date().toISOString()}] ⚠️ EPUB: No itemref matches found in spine`);
                        }
                    } else {
                        console.log(`[${new Date().toISOString()}] ❌ EPUB: No spine section found`);
                    }
                    
                    // Map spine IDs to file paths
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Mapping manifest items...`);
                    const manifestItems = new Map();
                    const manifestMatches = opfContent.match(/<item[^>]+>/gi);
                    if (manifestMatches) {
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Found ${manifestMatches.length} manifest items`);
                        manifestMatches.forEach((item, index) => {
                            const idMatch = item.match(/id="([^"]+)"/i);
                            const hrefMatch = item.match(/href="([^"]+)"/i);
                            if (idMatch && hrefMatch) {
                                manifestItems.set(idMatch[1], hrefMatch[1]);
                                if (index < 10) { // Log first 10 items
                                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Manifest item: ${idMatch[1]} -> ${hrefMatch[1]}`);
                                }
                            }
                        });
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Total manifest items mapped: ${manifestItems.size}`);
                    } else {
                        console.log(`[${new Date().toISOString()}] ❌ EPUB: No manifest items found`);
                    }
                    
                    // Extract chapters
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Extracting chapters...`);
                    const opfDir = path.dirname(opfPath);
                    const chapters = [];
                    
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: OPF directory: "${opfDir}"`);
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Processing ${Math.min(spine.length, 20)} chapters`);
                    
                    for (const spineId of spine.slice(0, 20)) { // Limit to first 20 chapters
                        const href = manifestItems.get(spineId);
                        if (href) {
                            const chapterPath = opfDir === '.' ? href : `${opfDir}/${href}`;
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Processing chapter: ${spineId} -> ${href} -> ${chapterPath}`);
                            const chapterContent = files.get(chapterPath);
                            if (chapterContent) {
                                console.log(`[${new Date().toISOString()}] 📖 EPUB: Found chapter content (${chapterContent.length} chars)`);
                            } else {
                                console.log(`[${new Date().toISOString()}] ⚠️ EPUB: Chapter content not found for path: ${chapterPath}`);
                                console.log(`[${new Date().toISOString()}] 📖 EPUB: Available files: ${Array.from(files.keys()).slice(0, 10).join(', ')}...`);
                            }
                            if (chapterContent) {
                                // Extract title from content
                                const titleMatch = chapterContent.match(/<title[^>]*>([^<]+)<\/title>/i) ||
                                                chapterContent.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i);
                                
                                // Clean HTML content while preserving text content
                                let cleanContent = chapterContent
                                    .replace(/<script[\s\S]*?<\/script>/gi, '')
                                    .replace(/<style[\s\S]*?<\/style>/gi, '')
                                    .replace(/<head[\s\S]*?<\/head>/gi, '')
                                    .replace(/<\/?html[^>]*>/gi, '')
                                    .replace(/<\/?body[^>]*>/gi, '')
                                    .replace(/class="[^"]*"/gi, '')
                                    .replace(/style="[^"]*"/gi, '')
                                    .replace(/xmlns[^=]*="[^"]*"/gi, '')
                                    .replace(/<\?xml[^>]*\?>/gi, '')
                                    .trim();
                                
                                // If content is mostly empty after cleaning, try to extract text content
                                if (cleanContent.length < 100 || !cleanContent.match(/<[^>]+>/)) {
                                    console.log(`[${new Date().toISOString()}] ⚠️ EPUB: Chapter content seems empty, trying body extraction`);
                                    // Try to extract just the text content if HTML structure is problematic
                                    const textMatch = chapterContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                                    if (textMatch) {
                                        cleanContent = textMatch[1]
                                            .replace(/<script[\s\S]*?<\/script>/gi, '')
                                            .replace(/<style[\s\S]*?<\/style>/gi, '')
                                            .replace(/class="[^"]*"/gi, '')
                                            .replace(/style="[^"]*"/gi, '')
                                            .trim();
                                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Extracted body content (${cleanContent.length} chars)`);
                                    } else {
                                        console.log(`[${new Date().toISOString()}] ⚠️ EPUB: No body section found, using original content`);
                                        cleanContent = chapterContent.trim();
                                    }
                                }
                                
                                // Decode HTML entities (including incomplete ones)
                                cleanContent = cleanContent
                                    .replace(/&#(\d+);?/g, (match, dec) => String.fromCharCode(dec))
                                    .replace(/&#x([a-fA-F0-9]+);?/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
                                    .replace(/&quot;?/g, '"')
                                    .replace(/&apos;?/g, "'")
                                    .replace(/&lt;?/g, '<')
                                    .replace(/&gt;?/g, '>')
                                    .replace(/&nbsp;?/g, ' ')
                                    .replace(/&amp;?/g, '&');
                                
                                // Truncate content if too large (>50KB per chapter)
                                if (cleanContent.length > 50000) {
                                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Truncating large chapter content from ${cleanContent.length} chars`);
                                    cleanContent = cleanContent.substring(0, 50000) + '...\n\n<p><em>[Content truncated for performance]</em></p>';
                                }
                                
                                const chapterTitle = titleMatch ? titleMatch[1].trim() : `Chapter ${chapters.length + 1}`;
                                console.log(`[${new Date().toISOString()}] 📖 EPUB: Added chapter: "${chapterTitle}" (${cleanContent.length} chars)`);
                                
                                chapters.push({
                                    title: chapterTitle,
                                    content: cleanContent
                                });
                            }
                        }
                    }
                    
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Total chapters extracted: ${chapters.length}`);
                    
                    if (chapters.length === 0) {
                        console.error(`[${new Date().toISOString()}] ❌ EPUB: No readable chapters found`);
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Spine items: ${spine.length}, Manifest items: ${manifestItems.size}`);
                        throw new Error('No readable chapters found');
                    }
                    
                    // Extract cover image data if found
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Processing cover image...`);
                    let coverImage = null;
                    if (metadata.coverPath) {
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Looking for cover at path: ${metadata.coverPath}`);
                        // Read cover as binary data
                        if (files.has(metadata.coverPath)) {
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Found cover file: ${metadata.coverPath}`);
                            const mimeType = metadata.coverPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Cover MIME type: ${mimeType}`);
                            // Store the cover path for serving via separate endpoint
                            coverImage = metadata.coverPath;
                        }
                        if (!coverImage) {
                            console.log(`[${new Date().toISOString()}] ⚠️ EPUB: Cover file not found in extracted files`);
                        }
                    } else {
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: No cover path specified in metadata`);
                    }
                    
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Extraction completed successfully`);
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Final result - Metadata: ${JSON.stringify(metadata)}, Chapters: ${chapters.length}, Cover: ${coverImage || 'None'}`);
                    
                    resolve({ metadata, chapters, coverImage });
                } catch (error) {
                    reject(error);
                }
            });
        });
    });
}

// Handle direct cover image requests from EPUB content - this should rarely be needed now
app.get('/cover.jpeg', (req, res) => {
    console.log(`[${new Date().toISOString()}] GET /cover.jpeg - direct request (should be rare after URL rewriting)`);
    console.log(`[${new Date().toISOString()}] Referer: ${req.get('Referer')}`);
    
    // This is a fallback for any missed image references
    // In most cases, images should go through /epub-cover endpoint
    res.status(404).json({ 
        error: 'Cover image not found. Images should use /epub-cover endpoint.',
        hint: 'This suggests a URL rewriting issue in EPUB content'
    });
});

app.get('/cover.jpg', (req, res) => {
    console.log(`[${new Date().toISOString()}] GET /cover.jpg - checking for EPUB image context`);
    const referer = req.get('Referer');
    if (referer && referer.includes('epub')) {
        res.redirect('/images/cover.jpg');
    } else {
        res.status(404).json({ error: 'Cover image not found' });
    }
});

// Handle EPUB images extraction
app.get('/images/:filename', requireAuth, async (req, res) => {
    const filename = req.params.filename;
    const epubPath = req.query.epub;
    
    console.log(`[${new Date().toISOString()}] GET /images/${filename} - epub: "${epubPath}"`);
    
    if (!epubPath) {
        return res.status(400).json({ error: 'EPUB path required' });
    }
    
    const fullEpubPath = path.join(baseDir, epubPath);
    
    if (!fullEpubPath.startsWith(baseDir) || path.extname(fullEpubPath).toLowerCase() !== '.epub') {
        return res.status(403).json({ error: 'Invalid EPUB path' });
    }
    
    try {
        yauzl.open(fullEpubPath, { lazyEntries: true }, (err, zipfile) => {
            if (err) {
                console.error(`[${new Date().toISOString()}] ❌ EPUB images: ZIP open error: ${err.message}`);
                return res.status(500).json({ error: err.message });
            }
            
            let found = false;
            
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                if (!entry || !entry.fileName) {
                    zipfile.readEntry();
                    return;
                }
                
                if (entry.fileName.endsWith(filename) && entry.fileName.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif)$/i)) {
                    found = true;
                    console.log(`[${new Date().toISOString()}] ✅ Found EPUB image: ${entry.fileName}`);
                    zipfile.openReadStream(entry, (err, readStream) => {
                        if (err) {
                            console.error(`[${new Date().toISOString()}] ❌ EPUB images: Stream error: ${err.message}`);
                            return res.status(500).json({ error: err.message });
                        }
                        
                        const mimeType = getImageMimeType(entry.fileName);
                        
                        res.setHeader('Content-Type', mimeType);
                        readStream.pipe(res);
                    });
                } else {
                    zipfile.readEntry();
                }
            });
            
            zipfile.on('end', () => {
                if (!found && !res.headersSent) {
                    console.log(`[${new Date().toISOString()}] ❌ EPUB image not found: ${filename}`);
                    res.status(404).json({ error: 'Image not found in EPUB' });
                }
            });
        });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ EPUB images: General error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Archive utility functions
async function getZipContents(filePath, subPath) {
    // Generate cache key including subPath
    const cacheKey = cache.generateKey(filePath, 'zip-contents', subPath);
    
    // Check disk cache first
    const cachedContents = await cache.get('archive-contents', cacheKey, filePath);
    if (cachedContents) {
        return cachedContents;
    }
    
    return new Promise((resolve, reject) => {
        yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
            if (err) return reject(err);
            
            const contents = [];
            const entries = new Map();
            
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                const fullPath = entry.fileName;
                
                // Skip directories ending with / and files not in the subPath
                if (subPath && !fullPath.startsWith(subPath + '/') && fullPath !== subPath) {
                    zipfile.readEntry();
                    return;
                }
                
                let relativePath = subPath ? fullPath.slice(subPath.length + 1) : fullPath;
                if (relativePath.startsWith('/')) relativePath = relativePath.slice(1);
                
                // Skip empty paths and nested files/directories
                if (!relativePath || relativePath.includes('/')) {
                    // Handle directories
                    if (relativePath.includes('/')) {
                        const dirName = relativePath.split('/')[0];
                        if (dirName && !entries.has(dirName)) {
                            entries.set(dirName, {
                                name: dirName,
                                isDirectory: true,
                                size: 0
                            });
                        }
                    }
                    zipfile.readEntry();
                    return;
                }
                
                entries.set(relativePath, {
                    name: relativePath,
                    isDirectory: entry.fileName ? entry.fileName.endsWith('/') : false,
                    size: entry.uncompressedSize || 0
                });
                
                zipfile.readEntry();
            });
            
            zipfile.on('end', () => {
                const contents = Array.from(entries.values());
                // Cache the result
                cache.set('archive-contents', cacheKey, contents, filePath);
                resolve(contents);
            });
            
            zipfile.on('error', reject);
        });
    });
}

async function getRarContents(filePath, subPath) {
    // Generate cache key including subPath
    const cacheKey = cache.generateKey(filePath, 'rar-contents', subPath);
    
    // Check disk cache first
    const cachedContents = await cache.get('archive-contents', cacheKey, filePath);
    if (cachedContents) {
        return cachedContents;
    }
    
    try {
        const extractor = await createExtractorFromFile({ filepath: filePath });
        const list = await extractor.getFileList();
        
        let fileHeaders = [];
        if (list && list.fileHeaders) {
            fileHeaders = Array.isArray(list.fileHeaders) ? list.fileHeaders : Array.from(list.fileHeaders);
        } else if (Array.isArray(list)) {
            fileHeaders = list;
        }
        
        const contents = [];
        const directories = new Set();
        
        for (const header of fileHeaders) {
            const fullPath = header.name || header.filename;
            if (!fullPath) continue;
            
            // Filter by subPath
            if (subPath && !fullPath.startsWith(subPath + '/') && fullPath !== subPath) {
                continue;
            }
            
            let relativePath = subPath ? fullPath.slice(subPath.length + 1) : fullPath;
            if (relativePath.startsWith('/')) relativePath = relativePath.slice(1);
            
            if (!relativePath) continue;
            
            // Handle nested paths
            if (relativePath.includes('/')) {
                const dirName = relativePath.split('/')[0];
                if (dirName && !directories.has(dirName)) {
                    directories.add(dirName);
                    contents.push({
                        name: dirName,
                        isDirectory: true,
                        size: 0
                    });
                }
            } else {
                contents.push({
                    name: relativePath,
                    isDirectory: false,
                    size: header.fileSize || header.size || 0
                });
            }
        }
        
        // Cache the result
        cache.set('archive-contents', cacheKey, contents, filePath);
        return contents;
    } catch (error) {
        throw new Error(`Failed to read RAR archive: ${error.message}`);
    }
}

async function getTarContents(filePath, subPath, isGzipped) {
    // Generate cache key including subPath and compression type
    const cacheKey = cache.generateKey(filePath, 'tar-contents', `${subPath}:${isGzipped}`);
    
    // Check disk cache first
    const cachedContents = await cache.get('archive-contents', cacheKey, filePath);
    if (cachedContents) {
        return cachedContents;
    }
    
    return new Promise((resolve, reject) => {
        const contents = [];
        const directories = new Set();
        
        const extract = tar.extract();
        
        extract.on('entry', (header, stream, next) => {
            const fullPath = header.name;
            
            // Filter by subPath
            if (subPath && !fullPath.startsWith(subPath + '/') && fullPath !== subPath) {
                stream.resume();
                return next();
            }
            
            let relativePath = subPath ? fullPath.slice(subPath.length + 1) : fullPath;
            if (relativePath.startsWith('/')) relativePath = relativePath.slice(1);
            
            if (!relativePath) {
                stream.resume();
                return next();
            }
            
            // Handle nested paths
            if (relativePath.includes('/')) {
                const dirName = relativePath.split('/')[0];
                if (dirName && !directories.has(dirName)) {
                    directories.add(dirName);
                    contents.push({
                        name: dirName,
                        isDirectory: true,
                        size: 0
                    });
                }
            } else {
                contents.push({
                    name: relativePath,
                    isDirectory: header.type === 'directory',
                    size: header.size || 0
                });
            }
            
            stream.resume();
            next();
        });
        
        extract.on('finish', () => {
            // Cache the result
            cache.set('archive-contents', cacheKey, contents, filePath);
            resolve(contents);
        });
        
        extract.on('error', reject);
        
        const readStream = fs.createReadStream(filePath);
        if (isGzipped) {
            const zlib = require('zlib');
            readStream.pipe(zlib.createGunzip()).pipe(extract);
        } else {
            readStream.pipe(extract);
        }
    });
}

async function extractFileFromZip(archivePath, filePath, res) {
    return new Promise((resolve, reject) => {
        yauzl.open(archivePath, { lazyEntries: true }, (err, zipfile) => {
            if (err) return reject(err);
            
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                if (entry.fileName === filePath) {
                    zipfile.openReadStream(entry, (err, readStream) => {
                        if (err) return reject(err);
                        
                        const ext = path.extname(filePath).toLowerCase();
                        const mimeType = mimeTypes[ext] || 'application/octet-stream';
                        
                        res.setHeader('Content-Type', mimeType);
                        res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
                        
                        readStream.pipe(res);
                        readStream.on('end', resolve);
                        readStream.on('error', reject);
                    });
                } else {
                    zipfile.readEntry();
                }
            });
            
            zipfile.on('end', () => {
                reject(new Error('File not found in archive'));
            });
        });
    });
}

async function extractFileFromRar(archivePath, filePath, res) {
    try {
        const extractor = await createExtractorFromFile({ filepath: archivePath });
        const extracted = await extractor.extract({ files: [filePath] });
        
        let fileBuffer = null;
        let filesArray = [];
        
        if (extracted.files) {
            filesArray = Array.isArray(extracted.files) ? extracted.files : Array.from(extracted.files);
        }
        
        if (filesArray.length > 0) {
            const file = filesArray[0];
            if (file.extraction) {
                fileBuffer = Buffer.from(file.extraction);
            } else if (file.fileData) {
                fileBuffer = Buffer.from(file.fileData);
            } else if (file.data) {
                fileBuffer = Buffer.from(file.data);
            }
        }
        
        if (!fileBuffer) {
            throw new Error('Failed to extract file from RAR archive');
        }
        
        const ext = path.extname(filePath).toLowerCase();
        const mimeType = mimeTypes[ext] || 'application/octet-stream';
        
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
        res.send(fileBuffer);
        
    } catch (error) {
        throw new Error(`Failed to extract file from RAR: ${error.message}`);
    }
}

async function extractFileFromTar(archivePath, filePath, res, isGzipped) {
    return new Promise((resolve, reject) => {
        const extract = tar.extract();
        let found = false;
        
        extract.on('entry', (header, stream, next) => {
            if (header.name === filePath) {
                found = true;
                
                const ext = path.extname(filePath).toLowerCase();
                const mimeType = mimeTypes[ext] || 'application/octet-stream';
                
                res.setHeader('Content-Type', mimeType);
                res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
                
                stream.pipe(res);
                stream.on('end', resolve);
                stream.on('error', reject);
            } else {
                stream.resume();
            }
            next();
        });
        
        extract.on('finish', () => {
            if (!found) {
                reject(new Error('File not found in archive'));
            }
        });
        
        extract.on('error', reject);
        
        const readStream = fs.createReadStream(archivePath);
        if (isGzipped) {
            const zlib = require('zlib');
            readStream.pipe(zlib.createGunzip()).pipe(extract);
        } else {
            readStream.pipe(extract);
        }
    });
}

// Cache management endpoints
app.get('/api/cache/stats', requireAuth, async (req, res) => {
    try {
        const stats = await cache.getStats();
        const formattedStats = {
            ...stats,
            totalSizeFormatted: `${(stats.totalSize / 1024 / 1024).toFixed(1)} MB`,
            categories: Object.keys(stats.categories).map(name => ({
                name,
                files: stats.categories[name].files,
                size: stats.categories[name].size,
                sizeFormatted: `${(stats.categories[name].size / 1024 / 1024).toFixed(1)} MB`
            }))
        };
        res.json(formattedStats);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Cache stats error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/cache/clear', requireAuth, async (req, res) => {
    try {
        const success = await cache.clear();
        if (success) {
            res.json({ message: 'Cache cleared successfully' });
        } else {
            res.status(500).json({ error: 'Failed to clear cache' });
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Cache clear error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// File Annotation System
app.use(express.json());

// Ensure .browser directory exists
function ensureBrowserDir() {
    const browserDir = path.join(baseDir, '.browser');
    if (!fs.existsSync(browserDir)) {
        fs.mkdirSync(browserDir, { recursive: true });
    }
    return browserDir;
}

// Get annotations file path
function getAnnotationsPath() {
    return path.join(ensureBrowserDir(), 'annotations.json');
}

// Get annotations directory path (for directory-based storage)
function getAnnotationsDir() {
    const annotationsDir = path.join(ensureBrowserDir(), 'annotations');
    if (!fs.existsSync(annotationsDir)) {
        fs.mkdirSync(annotationsDir, { recursive: true });
    }
    return annotationsDir;
}

// Get directory-specific annotation file path
function getDirectoryAnnotationPath(filePath) {
    const annotationsDir = getAnnotationsDir();
    const fileDir = path.dirname(filePath);
    const safeDirName = fileDir.replace(/[^a-zA-Z0-9]/g, '_') || 'root';
    return path.join(annotationsDir, `${safeDirName}.json`);
}

// Load annotations from disk
function loadAnnotations() {
    try {
        const annotationsPath = getAnnotationsPath();
        if (fs.existsSync(annotationsPath)) {
            const data = fs.readFileSync(annotationsPath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error loading annotations: ${error.message}`);
    }
    return {};
}

// Save annotations to disk
function saveAnnotations(annotations) {
    try {
        const annotationsPath = getAnnotationsPath();
        fs.writeFileSync(annotationsPath, JSON.stringify(annotations, null, 2));
        return true;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error saving annotations: ${error.message}`);
        return false;
    }
}

// Load annotations from directory structure (for a specific directory)
function loadDirectoryAnnotations(filePath) {
    try {
        const annotationFilePath = getDirectoryAnnotationPath(filePath);
        if (fs.existsSync(annotationFilePath)) {
            const data = fs.readFileSync(annotationFilePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error loading directory annotations: ${error.message}`);
    }
    return {};
}

// Save annotations for a specific directory
function saveDirectoryAnnotations(filePath, annotations) {
    try {
        const annotationFilePath = getDirectoryAnnotationPath(filePath);
        fs.writeFileSync(annotationFilePath, JSON.stringify(annotations, null, 2));
        return true;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error saving directory annotations: ${error.message}`);
        return false;
    }
}

// Load all annotations (combines legacy single file + directory-based storage)
function loadAllAnnotations() {
    let allAnnotations = {};
    
    // First, load from legacy single file if it exists
    const legacyAnnotations = loadAnnotations();
    Object.assign(allAnnotations, legacyAnnotations);
    
    // Then, load from directory-based storage
    try {
        const annotationsDir = path.join(ensureBrowserDir(), 'annotations');
        if (fs.existsSync(annotationsDir)) {
            const files = fs.readdirSync(annotationsDir);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const filePath = path.join(annotationsDir, file);
                    const data = fs.readFileSync(filePath, 'utf8');
                    const dirAnnotations = JSON.parse(data);
                    Object.assign(allAnnotations, dirAnnotations);
                }
            }
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error loading directory annotations: ${error.message}`);
    }
    
    return allAnnotations;
}

// Save single annotation using directory-based storage
function saveAnnotation(filePath, annotation) {
    try {
        // Load existing annotations for this directory
        const dirAnnotations = loadDirectoryAnnotations(filePath);
        
        // Update or add the annotation
        if (annotation && (annotation.comment || annotation.stars || annotation.color)) {
            dirAnnotations[filePath] = {
                ...annotation,
                lastModified: new Date().toISOString()
            };
        } else {
            // Remove annotation if all values are empty
            delete dirAnnotations[filePath];
        }
        
        // Save back to directory file
        return saveDirectoryAnnotations(filePath, dirAnnotations);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error saving annotation: ${error.message}`);
        return false;
    }
}

// Delete annotation using directory-based storage
function deleteAnnotation(filePath) {
    try {
        // Load existing annotations for this directory
        const dirAnnotations = loadDirectoryAnnotations(filePath);
        
        // Remove the annotation
        delete dirAnnotations[filePath];
        
        // Save back to directory file
        return saveDirectoryAnnotations(filePath, dirAnnotations);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error deleting annotation: ${error.message}`);
        return false;
    }
}

// Get annotations for a file or all files
app.get('/api/annotations', requireAuth, (req, res) => {
    try {
        const filePath = req.query.path;
        
        if (filePath) {
            // Return annotations for specific file - check both legacy and directory storage
            const legacyAnnotations = loadAnnotations();
            const dirAnnotations = loadDirectoryAnnotations(filePath);
            const annotation = dirAnnotations[filePath] || legacyAnnotations[filePath] || {};
            res.json(annotation);
        } else {
            // Return all annotations using new combined function
            const allAnnotations = loadAllAnnotations();
            res.json(allAnnotations);
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error getting annotations: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Add or update annotation for a file
app.post('/api/annotations', requireAuth, (req, res) => {
    try {
        const { filePath, comment, stars, color } = req.body;
        
        if (!filePath) {
            return res.status(400).json({ error: 'File path is required' });
        }
        
        // Build annotation object
        let annotation = {};
        
        if (comment !== undefined) {
            if (comment.trim() !== '') {
                annotation.comment = comment.trim();
            }
        }
        
        if (stars !== undefined) {
            if (stars !== 0 && stars !== null) {
                annotation.stars = Math.max(1, Math.min(5, parseInt(stars)));
            }
        }
        
        if (color !== undefined) {
            if (color !== '' && color !== null) {
                annotation.color = color;
            }
        }
        
        // Use the new directory-based save function
        if (saveAnnotation(filePath, annotation)) {
            // Load the saved annotation to return it
            const dirAnnotations = loadDirectoryAnnotations(filePath);
            const savedAnnotation = dirAnnotations[filePath] || {};
            res.json({ success: true, annotation: savedAnnotation });
        } else {
            res.status(500).json({ error: 'Failed to save annotation' });
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error updating annotations: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Delete annotation for a file
app.delete('/api/annotations', requireAuth, (req, res) => {
    try {
        const filePath = req.query.path;
        
        if (!filePath) {
            return res.status(400).json({ error: 'File path is required' });
        }
        
        // Use the new directory-based delete function
        if (deleteAnnotation(filePath)) {
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Failed to delete annotation' });
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error deleting annotations: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Search annotated files
function getFileTypeFromExtension(extension, fileName = '') {
    if (extension === 'pdf') return 'pdf';
    if (['cbz', 'cbr'].includes(extension)) return 'comic';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) return 'image';
    if (['mp4', 'avi', 'mov', 'mkv'].includes(extension)) return 'video';
    if (['mp3', 'wav', 'flac', 'ogg'].includes(extension)) return 'audio';
    if (['js', 'html', 'css', 'json', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'xml', 'yaml', 'yml', 'ini', 'conf', 'log', 'sh', 'bat', 'ps1', 'sql', 'php', 'rb', 'swift', 'kt', 'dart', 'r', 'scala', 'clj', 'elm', 'vue', 'jsx', 'tsx', 'ts', 'less', 'scss', 'sass', 'styl', 'svelte', 'astro'].includes(extension)) return 'code';
    if (extension === 'ipynb') return 'notebook';
    if (['txt', 'md', 'rtf', 'doc', 'docx', 'odt'].includes(extension)) return 'text';
    if (['csv', 'xlsx', 'xls', 'ods'].includes(extension)) return 'table';
    if (['pptx', 'ppt', 'odp'].includes(extension)) return 'presentation';
    if (extension === 'srt') return 'subtitle';
    if (extension === 'epub') return 'ebook';
    if (['zip', 'rar', 'tar', 'tgz', '7z'].includes(extension) || (fileName && fileName.endsWith('.tar.gz'))) return 'archive';
    if (!fileName || !fileName.includes('.')) return 'text'; // Files without extension
    return 'text'; // Unknown extensions treated as text
}

app.get('/api/search-annotations', requireAuth, (req, res) => {
    try {
        const { query, hasComment, hasStars, hasColor, color, fileType } = req.query;
        const annotations = loadAllAnnotations();
        
        let results = [];
        
        for (const [filePath, annotation] of Object.entries(annotations)) {
            let matches = true;
            
            // Filter by query in comments
            if (query && annotation.comment) {
                matches = annotation.comment.toLowerCase().includes(query.toLowerCase());
            } else if (query && !annotation.comment) {
                matches = false;
            }
            
            // Filter by has comment
            if (hasComment === 'true' && !annotation.comment) {
                matches = false;
            }
            
            // Filter by has stars
            if (hasStars === 'true' && !annotation.stars) {
                matches = false;
            }
            
            // Filter by has color
            if (hasColor === 'true' && !annotation.color) {
                matches = false;
            }
            
            // Filter by specific color
            if (color && annotation.color !== color) {
                matches = false;
            }
            
            // Filter by file type
            if (fileType && fileType !== 'all') {
                const fileName = filePath.split('/').pop();
                const extension = fileName.split('.').pop();
                const detectedFileType = getFileTypeFromExtension(extension, fileName);
                if (detectedFileType !== fileType) {
                    matches = false;
                }
            }
            
            if (matches) {
                results.push({
                    filePath,
                    ...annotation
                });
            }
        }
        
        // Sort by lastModified (newest first)
        results.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
        
        res.json(results);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error searching annotations: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Open file with default system program
app.post('/api/open-file', requireAuth, (req, res) => {
    try {
        const { filePath } = req.body;
        
        if (!filePath) {
            return res.status(400).json({ error: 'File path is required' });
        }
        
        // Resolve full path within baseDir
        const fullPath = path.resolve(baseDir, filePath.startsWith('/') ? filePath.slice(1) : filePath);
        
        // Security check: ensure file is within baseDir
        if (!fullPath.startsWith(path.resolve(baseDir))) {
            return res.status(403).json({ error: 'Access denied: file outside allowed directory' });
        }
        
        // Check if file exists
        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        // Determine the command based on platform
        let command, args;
        
        if (process.platform === 'win32') {
            // Windows
            command = 'cmd';
            args = ['/c', 'start', '""', fullPath];
        } else if (process.platform === 'darwin') {
            // macOS
            command = 'open';
            args = [fullPath];
        } else {
            // Linux and other Unix-like systems
            command = 'xdg-open';
            args = [fullPath];
        }
        
        // Execute the command
        const { spawn } = require('child_process');
        const child = spawn(command, args, {
            detached: true,
            stdio: 'ignore'
        });
        
        child.unref(); // Don't keep the parent process alive
        
        console.log(`[${new Date().toISOString()}] 📂 Opened file with default program: ${filePath}`);
        res.json({ success: true, message: 'File opened successfully' });
        
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error opening file: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.use((req, res, next) => {
    if (!req.url.includes('/files') || req.url.includes('?')) {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    }
    next();
});

if (require.main === module) {
    app.listen(port, () => {
        console.log(`🚀 Server started successfully!`);
        console.log(`📂 Browsing directory: ${baseDir}`);
        console.log(`🌐 Server listening at http://localhost:${port}`);
        console.log(`⏰ Started at: ${new Date().toISOString()}`);
        console.log('================================');
    });
}

module.exports = app;