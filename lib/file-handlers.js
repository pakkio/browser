const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const pdf2pic = require('pdf2pic');
const yauzl = require('yauzl');
const { createExtractorFromFile } = require('node-unrar-js');
const { baseDir, mimeTypes, getImageMimeType } = require('./config');

const pendingRequests = new Map();
const baseReal = fs.realpathSync.native ? fs.realpathSync.native(baseDir) : fs.realpathSync(baseDir);
const fsp = fs.promises;

// In-memory PDF page cache (LRU with mtime validation)
const PDF_CACHE_MAX_BYTES = 100 * 1024 * 1024; // 100MB cap
const PDF_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour TTL
const pdfPageCache = {
    entries: new Map(), // key -> { buffer, mtimeMs, size, lastAccess, createdAt }
    totalBytes: 0,
    get(key, currentMtime) {
        const entry = this.entries.get(key);
        if (!entry) return null;
        const now = Date.now();
        // Invalidate if source changed or TTL expired
        if (entry.mtimeMs !== currentMtime || (now - entry.createdAt) > PDF_CACHE_TTL_MS) {
            this.totalBytes -= entry.size;
            this.entries.delete(key);
            return null;
        }
        entry.lastAccess = now;
        return entry;
    },
    set(key, buffer, mtimeMs) {
        const now = Date.now();
        const size = buffer.length;
        if (size > PDF_CACHE_MAX_BYTES * 0.5) {
            // Avoid caching extremely large single pages (>50% budget)
            return;
        }
        if (this.entries.has(key)) {
            const old = this.entries.get(key);
            this.totalBytes -= old.size;
        }
        this.entries.set(key, { buffer, mtimeMs, size, lastAccess: now, createdAt: now });
        this.totalBytes += size;
        this.evictIfNeeded();
    },
    evictIfNeeded() {
        if (this.totalBytes <= PDF_CACHE_MAX_BYTES) return;
        // Convert map to array and sort by lastAccess (LRU)
        const sorted = Array.from(this.entries.entries()).sort((a, b) => a[1].lastAccess - b[1].lastAccess);
        for (const [key, val] of sorted) {
            if (this.totalBytes <= PDF_CACHE_MAX_BYTES * 0.85) break; // trim to 85%
            this.entries.delete(key);
            this.totalBytes -= val.size;
            console.log(`[${new Date().toISOString()}] 🧹 PDF Cache EVICT: ${key} (${val.size} bytes)`);
        }
    },
    stats() {
        return { count: this.entries.size, totalBytes: this.totalBytes };
    }
};

// Track in-flight PDF conversions to deduplicate concurrent requests
const pendingPdfConversions = new Map();

async function serveBrowseRequest(req, res) {
    let requestedPath = req.query.path;
    
    // If no path specified, try to use last browsed path from session
    if (requestedPath === undefined || requestedPath === '') {
        if (req.session && req.session.lastBrowsedPath) {
            requestedPath = req.session.lastBrowsedPath;
            console.log(`[${new Date().toISOString()}] Resuming from session: "${requestedPath}"`);
        } else {
            requestedPath = '';
        }
    }

    const unsafePath = path.join(baseDir, requestedPath);
    let dirPath;
    try {
        dirPath = fs.realpathSync.native ? fs.realpathSync.native(unsafePath) : fs.realpathSync(unsafePath);
    } catch (e) {
        console.log(`[${new Date().toISOString()}] ❌ Path resolution error for ${unsafePath}: ${e.message}`);
        return res.status(404).send('Directory not found');
    }

    if (!dirPath.startsWith(baseReal)) {
        console.log(`[${new Date().toISOString()}] ❌ Forbidden (symlink/base escape) to: ${dirPath}`);
        return res.status(403).send('Forbidden');
    }

    
    console.log(`[${new Date().toISOString()}] GET /api/browse - path: "${requestedPath}"`);
    console.log(`[${new Date().toISOString()}] Resolved to: ${dirPath}`);

    if (!dirPath.startsWith(baseDir)) {
        console.log(`[${new Date().toISOString()}] ❌ Forbidden access attempt to: ${dirPath}`);
        return res.status(403).send('Forbidden');
    }

    try {
        const entries = await fsp.readdir(dirPath, { withFileTypes: true });
        console.log(`[${new Date().toISOString()}] ✅ Found ${entries.length} files/directories`);

        const statsPromises = entries.map(async entry => {
            const entryPath = path.join(dirPath, entry.name);
            try {
                const stat = await fsp.stat(entryPath);
                return { entry, stat };
            } catch (e) {
                console.log(`[${new Date().toISOString()}] ⚠️  Stat error for ${entry.name}: ${e.message}`);
                return { entry, stat: null };
            }
        });

        const statsResults = await Promise.all(statsPromises);
        const fileList = statsResults.map(({ entry, stat }) => ({
            name: entry.name,
            isDirectory: entry.isDirectory(),
            size: stat && !entry.isDirectory() ? stat.size : null,
            modified: stat ? stat.mtime.toISOString() : null
        }));

        if (req.session) {
            req.session.lastBrowsedPath = requestedPath;
        }

        const response = { files: fileList, currentPath: requestedPath, basePath: baseDir };
        console.log(`[${new Date().toISOString()}] 📤 Sending ${fileList.length} items in response`);

        if (req.path === '/files/list') {
            res.json(fileList);
        } else {
            res.json(response);
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Browse error: ${error.message}`);
        res.status(500).send(error.toString());
    }
}

function serveFileList(req, res) {
    const requestedPath = req.query.path || '';
    const dirPath = path.join(baseDir, requestedPath);

    if (!dirPath.startsWith(baseDir)) {
        return res.status(403).send('Forbidden');
    }

    try {
        const files = fs.readdirSync(dirPath, { withFileTypes: true });
        const fileList = files.map(file => {
            const filePath = path.join(dirPath, file.name);
            let stats = null;
            try {
                stats = fs.statSync(filePath);
            } catch (e) {}
            return {
                name: file.name,
                isDirectory: file.isDirectory(),
                size: stats && !file.isDirectory() ? stats.size : null,
                modified: stats ? stats.mtime.toISOString() : null
            };
        });
        res.json(fileList);
    } catch (error) {
        res.status(500).send(error.toString());
    }
}

function serveFile(req, res) {
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
}

function getPdfInfo(req, res) {
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
}

async function servePdfPreview(req, res) {
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
        const stats = fs.statSync(filePath);
        const mtimeMs = stats.mtime.getTime();
        const cacheKey = `${filePath}:${page}`;

        // Attempt cache hit
        const cached = pdfPageCache.get(cacheKey, mtimeMs);
        if (cached) {
            console.log(`[${new Date().toISOString()}] ⚡ PDF cache HIT page ${page} (${cached.buffer.length} bytes)`);
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('X-PDF-Cache', 'HIT');
            return res.send(cached.buffer);
        }

        // Deduplicate concurrent conversions
        if (pendingPdfConversions.has(cacheKey)) {
            console.log(`[${new Date().toISOString()}] ⏳ Awaiting in-flight conversion for page ${page}`);
            try {
                const buffer = await pendingPdfConversions.get(cacheKey);
                res.setHeader('Content-Type', 'image/png');
                res.setHeader('X-PDF-Cache', 'WAIT-HIT');
                return res.send(buffer);
            } catch (e) {
                console.warn(`[${new Date().toISOString()}] ⚠️ In-flight conversion failed, retrying fresh: ${e.message}`);
            }
        }

        console.log(`[${new Date().toISOString()}] 🔄 Converting PDF page ${page}...`);
        const options = {
            density: 120,
            format: "png",
            width: 900,
            height: 1200
        };

        const convert = pdf2pic.fromPath(filePath, options);
        const conversionPromise = (async () => {
            const result = await convert(page, { responseType: "base64" });
            if (!result || !result.base64 || result.base64.length === 0) {
                throw new Error('PDF conversion returned empty result');
            }
            const buffer = Buffer.from(result.base64, 'base64');
            pdfPageCache.set(cacheKey, buffer, mtimeMs);
            return buffer;
        })();

        pendingPdfConversions.set(cacheKey, conversionPromise);

        let buffer;
        try {
            buffer = await conversionPromise;
            console.log(`[${new Date().toISOString()}] ✅ PDF conversion successful (${buffer.length} bytes)`);
        } finally {
            pendingPdfConversions.delete(cacheKey);
        }

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('X-PDF-Cache', 'MISS');
        res.send(buffer);
    } catch (error) {
        pendingPdfConversions.delete(`${filePath}:${page}`);
        console.error(`[${new Date().toISOString()}] ❌ PDF conversion error: ${error.message}`);
        res.status(500).send(`PDF conversion error: ${error.message}`);
    }
}

async function serveVideoTranscode(req, res) {
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
    if (!['.avi', '.wmv', '.mpg', '.mpeg'].includes(ext)) {
        return res.status(400).send('Only AVI, WMV, MPG, and MPEG files supported for transcoding');
    }
    
    try {
        console.log(`[${new Date().toISOString()}] 🔄 Transcoding ${ext.toUpperCase()} to WebM...`);
        
        res.setHeader('Content-Type', 'video/webm');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-cache');
        
        const ffmpeg = spawn('ffmpeg', [
            '-i', filePath,
            '-c:v', 'libvpx-vp9',
            '-preset', 'fast',
            '-crf', '30',
            '-c:a', 'libopus',
            '-f', 'webm',
            '-'
        ]);
        
        // Timeout di sicurezza 10 minuti
        const killTimer = setTimeout(() => {
            console.warn(`[${new Date().toISOString()}] ⏱️ FFmpeg timeout reached, killing process`);
            ffmpeg.kill('SIGKILL');
        }, 10 * 60 * 1000);

        ffmpeg.stderr.on('data', (data) => {
            console.log(`[FFmpeg] ${data.toString()}`);
        });
        
        ffmpeg.stdout.pipe(res);
        
        ffmpeg.on('close', (code) => {
            clearTimeout(killTimer);
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
        
        req.on('close', () => {
            clearTimeout(killTimer);
            ffmpeg.kill('SIGKILL');
        });
        
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Video transcoding error: ${error.message}`);
        res.status(500).send(`Video transcoding error: ${error.message}`);
    }
}

module.exports = {
    serveBrowseRequest,
    serveFileList,
    serveFile,
    getPdfInfo,
    servePdfPreview,
    serveVideoTranscode
};