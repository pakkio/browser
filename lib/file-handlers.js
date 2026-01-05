const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const pdf2pic = require('pdf2pic');
const yauzl = require('yauzl');
const { createExtractorFromFile } = require('node-unrar-js');
const { baseDir, mimeTypes, getImageMimeType } = require('./config');

const pendingRequests = new Map();
let baseReal = baseDir;
try {
    baseReal = fs.realpathSync.native ? fs.realpathSync.native(baseDir) : fs.realpathSync(baseDir);
} catch {
    // Keep baseReal as baseDir if it doesn't exist yet (e.g. during tests)
}
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

    // Block obvious path traversal attempts even if target doesn't exist
    if (!unsafePath.startsWith(baseDir)) {
        console.log(`[${new Date().toISOString()}] ❌ Forbidden access attempt to: ${unsafePath}`);
        return res.status(403).send('Forbidden');
    }

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
        
        // Filter out .browser directory (used for sparse annotations storage)
        const filteredEntries = entries.filter(entry => entry.name !== '.browser');
        console.log(`[${new Date().toISOString()}] ✅ Found ${filteredEntries.length} files/directories (${entries.length - filteredEntries.length} hidden)`);
        
        const statsPromises = filteredEntries.map(async entry => {
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
        // Filter out .browser directory (used for sparse annotations storage)
        const filteredFiles = files.filter(file => file.name !== '.browser');
        const fileList = filteredFiles.map(file => {
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

    // Decode URI component to handle special characters and emojis correctly
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(requestedFile);
    } catch (e) {
        console.log(`[${new Date().toISOString()}] ❌ Failed to decode path: ${requestedFile}`);
        decodedPath = requestedFile;
    }

    const filePath = path.join(baseDir, decodedPath);
    console.log(`[${new Date().toISOString()}] 📁 Resolved path: ${filePath}`);

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

        // Log file size for video files to help diagnose issues
        const ext = path.extname(filePath).toLowerCase();
        if (['.mp4', '.avi', '.mov', '.mkv', '.webm'].includes(ext)) {
            console.log(`[${new Date().toISOString()}] 📹 Video file size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        }
    } catch (error) {
        console.log(`[${new Date().toISOString()}] ❌ File not found or inaccessible: ${filePath}`);
        console.log(`[${new Date().toISOString()}] ❌ Error: ${error.message}`);
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

    // Decode URI component to handle special characters
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(requestedFile);
    } catch (e) {
        console.log(`[${new Date().toISOString()}] ❌ Failed to decode path: ${requestedFile}`);
        decodedPath = requestedFile;
    }

    const filePath = path.join(baseDir, decodedPath);

    if (!filePath.startsWith(baseDir)) {
        return res.status(403).send('Forbidden');
    }

    const ext = path.extname(filePath).toLowerCase();
    const supportedFormats = ['.avi', '.wmv', '.mpg', '.mpeg', '.mp4', '.mov', '.mkv', '.flv', '.m4v'];
    if (!supportedFormats.includes(ext)) {
        return res.status(400).send(`Video format ${ext} not supported for transcoding. Supported: ${supportedFormats.join(', ')}`);
    }
    
    try {
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            console.error(`[${new Date().toISOString()}] ❌ File not found for transcoding: ${filePath}`);
            return res.status(404).send('Video file not found');
        }

        console.log(`[${new Date().toISOString()}] 🔄 Transcoding ${ext.toUpperCase()} to WebM...`);
        console.log(`[${new Date().toISOString()}] 📁 Source file: ${filePath}`);

        res.setHeader('Content-Type', 'video/webm');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-cache');

        const ffmpeg = spawn('ffmpeg', [
            '-i', filePath,
            '-c:v', 'libvpx-vp9',
            '-preset', 'fast',
            '-crf', '30',
            '-b:v', '1M',        // Limit video bitrate
            '-c:a', 'libopus',
            '-b:a', '128k',      // Limit audio bitrate
            '-f', 'webm',
            '-'
        ]);

        // Timeout di sicurezza 10 minuti
        const killTimer = setTimeout(() => {
            console.warn(`[${new Date().toISOString()}] ⏱️ FFmpeg timeout reached, killing process`);
            ffmpeg.kill('SIGKILL');
        }, 10 * 60 * 1000);

        let stderrOutput = '';
        ffmpeg.stderr.on('data', (data) => {
            const output = data.toString();
            stderrOutput += output;
            // Only log progress lines, not every single line
            if (output.includes('time=') || output.includes('error') || output.includes('Error')) {
                console.log(`[FFmpeg] ${output.trim()}`);
            }
        });

        ffmpeg.stdout.pipe(res);

        ffmpeg.on('close', (code) => {
            clearTimeout(killTimer);
            if (code === 0) {
                console.log(`[${new Date().toISOString()}] ✅ Video transcoding completed successfully`);
            } else {
                console.error(`[${new Date().toISOString()}] ❌ FFmpeg failed with code ${code}`);
                console.error(`[${new Date().toISOString()}] FFmpeg stderr: ${stderrOutput.slice(-500)}`); // Last 500 chars
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
            console.log(`[${new Date().toISOString()}] 🛑 Client closed connection, stopping transcode`);
            ffmpeg.kill('SIGKILL');
        });

    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Video transcoding error: ${error.message}`);
        console.error(`[${new Date().toISOString()}] Stack trace: ${error.stack}`);
        res.status(500).send(`Video transcoding error: ${error.message}`);
    }
}

// Convert SRT subtitle format to WebVTT format
function convertSRTtoVTT(srtContent) {
    // Start with WebVTT header
    let vtt = 'WEBVTT\n\n';
    
    // Replace SRT timestamps with VTT format (comma to dot)
    // SRT: 00:00:20,000 --> 00:00:24,400
    // VTT: 00:00:20.000 --> 00:00:24.400
    vtt += srtContent.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    
    return vtt;
}

async function serveSubtitle(req, res) {
    const requestedFileRaw = req.query.path;
    console.log(`[${new Date().toISOString()}] GET /subtitle - path: "${requestedFileRaw}"`);

    if (!requestedFileRaw || typeof requestedFileRaw !== 'string') {
        console.log(`[${new Date().toISOString()}] ❌ Subtitle path is required`);
        return res.status(400).send('Subtitle path is required');
    }

    // Always resolve against baseDir (even if user sends absolute paths)
    const requestedFile = requestedFileRaw.replace(/^[/\\]+/, '');
    const filePath = path.join(baseDir, requestedFile);

    if (!filePath.startsWith(baseDir)) {
        console.log(`[${new Date().toISOString()}] ❌ Forbidden subtitle access: ${filePath}`);
        return res.status(403).send('Forbidden');
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.srt' && ext !== '.vtt') {
        console.log(`[${new Date().toISOString()}] ❌ Not a subtitle file: ${filePath}`);
        return res.status(400).send('Only SRT and VTT subtitle files are supported');
    }

    try {
        if (!fs.existsSync(filePath)) {
            console.log(`[${new Date().toISOString()}] ❌ Subtitle file not found: ${filePath}`);
            return res.status(404).send('Subtitle file not found');
        }

        const content = await fsp.readFile(filePath, 'utf8');

        // Convert SRT to VTT if needed
        let subtitleContent = content;
        if (ext === '.srt') {
            console.log(`[${new Date().toISOString()}] 🔄 Converting SRT to WebVTT format`);
            subtitleContent = convertSRTtoVTT(content);
        }

        // Set proper content-type for WebVTT
        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(subtitleContent);

        console.log(`[${new Date().toISOString()}] ✅ Subtitle served successfully`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Subtitle serving error: ${error.message}`);
        res.status(500).send(`Subtitle error: ${error.message}`);
    }
}

// Validate PDF file integrity using ghostscript
async function validatePdf(req, res) {
    const requestedFile = req.query.path;
    console.log(`[${new Date().toISOString()}] GET /api/validate-pdf - path: "${requestedFile}"`);
    
    if (!requestedFile) {
        return res.status(400).json({ error: 'File path is required' });
    }
    
    // Decode URI component to handle special characters
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(requestedFile);
    } catch (e) {
        decodedPath = requestedFile;
    }
    
    const filePath = path.join(baseDir, decodedPath);
    
    if (!filePath.startsWith(baseDir)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    
    if (path.extname(filePath).toLowerCase() !== '.pdf') {
        return res.status(400).json({ error: 'Not a PDF file' });
    }
    
    try {
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ 
                valid: false,
                error: 'File not found',
                diagnosis: 'The PDF file does not exist at the specified path.'
            });
        }
        
        // Get file stats
        const stats = fs.statSync(filePath);
        const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
        
        // Run ghostscript validation
        const gsResult = await new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve({
                    valid: false,
                    error: 'Validation timeout',
                    diagnosis: 'PDF validation took too long. The file may be extremely large or corrupted.'
                });
            }, 30000); // 30 second timeout
            
            exec(`gs -dNODISPLAY -dBATCH -dNOPAUSE -sDEVICE=nullpage "${filePath}" 2>&1`, 
                { timeout: 25000 },
                (error, stdout, stderr) => {
                    clearTimeout(timeout);
                    const output = stdout + stderr;
                    
                    // Parse ghostscript output for specific errors
                    const issues = [];
                    let severity = 'ok';
                    
                    if (output.includes('Catalog dictionary not located')) {
                        issues.push('Missing catalog dictionary - PDF structure is severely damaged');
                        severity = 'critical';
                    }
                    if (output.includes('no startxref token found')) {
                        issues.push('Missing cross-reference table - file may be truncated or incomplete');
                        severity = 'critical';
                    }
                    if (output.includes('xref table was repaired')) {
                        issues.push('Cross-reference table was corrupted and required repair');
                        if (severity !== 'critical') severity = 'warning';
                    }
                    if (output.includes("Couldn't initialise file")) {
                        issues.push('PDF cannot be initialized - file is unreadable');
                        severity = 'critical';
                    }
                    if (output.includes('Error: Cannot find a \'startxref\'')) {
                        issues.push('Cannot locate PDF start marker - file structure is broken');
                        severity = 'critical';
                    }
                    if (output.includes('This file had errors')) {
                        if (severity !== 'critical') severity = 'warning';
                    }
                    if (output.includes('encrypted') || output.includes('password')) {
                        issues.push('PDF is password protected or encrypted');
                        severity = 'protected';
                    }
                    if (output.includes('No pages will be processed')) {
                        issues.push('No readable pages found in the PDF');
                        severity = 'critical';
                    }
                    
                    // Determine diagnosis message
                    let diagnosis = '';
                    let recommendation = '';
                    
                    if (severity === 'critical') {
                        diagnosis = 'This PDF is severely corrupted and cannot be displayed.';
                        recommendation = 'Re-download the file from the original source. The current file appears to be incomplete or damaged during transfer.';
                    } else if (severity === 'protected') {
                        diagnosis = 'This PDF is password protected.';
                        recommendation = 'You need the password to view this file, or obtain an unprotected version.';
                    } else if (severity === 'warning') {
                        diagnosis = 'This PDF has minor issues but may still be viewable.';
                        recommendation = 'Try opening the file anyway. If it fails, consider re-downloading.';
                    } else {
                        diagnosis = 'PDF structure appears valid.';
                        recommendation = '';
                    }
                    
                    resolve({
                        valid: severity === 'ok' || severity === 'warning',
                        severity: severity,
                        issues: issues,
                        diagnosis: diagnosis,
                        recommendation: recommendation,
                        fileSize: `${fileSizeMB} MB`,
                        gsOutput: output.slice(0, 1000) // First 1000 chars of output for debugging
                    });
                }
            );
        });
        
        console.log(`[${new Date().toISOString()}] PDF validation result: ${gsResult.severity} - ${gsResult.issues.length} issues`);
        res.json(gsResult);
        
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ PDF validation error: ${error.message}`);
        res.status(500).json({ 
            valid: false,
            error: 'Validation failed',
            diagnosis: `Error during validation: ${error.message}`
        });
    }
}

// Disk-based thumbnail cache in .browser/.thumbs/
const crypto = require('crypto');

function getThumbsCacheDir() {
    const thumbsDir = path.join(baseDir, '.browser', '.thumbs');
    if (!fs.existsSync(thumbsDir)) {
        fs.mkdirSync(thumbsDir, { recursive: true });
    }
    return thumbsDir;
}

function getThumbnailCachePath(filePath, position) {
    const hash = crypto.createHash('md5').update(`${filePath}:${position}`).digest('hex');
    const ext = '.jpg';
    return path.join(getThumbsCacheDir(), `${hash}${ext}`);
}

function getThumbnailCacheMetaPath(filePath, position) {
    const hash = crypto.createHash('md5').update(`${filePath}:${position}`).digest('hex');
    return path.join(getThumbsCacheDir(), `${hash}.meta`);
}

// Check if cached thumbnail is valid (exists and source file hasn't changed)
function getCachedThumbnail(filePath, position, sourceMtime) {
    try {
        const cachePath = getThumbnailCachePath(filePath, position);
        const metaPath = getThumbnailCacheMetaPath(filePath, position);

        if (fs.existsSync(cachePath) && fs.existsSync(metaPath)) {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            if (meta.sourceMtime === sourceMtime) {
                return fs.readFileSync(cachePath);
            }
        }
    } catch (e) {
        // Cache miss or error
    }
    return null;
}

// Save thumbnail to disk cache
function saveThumbnailToCache(filePath, position, buffer, sourceMtime) {
    try {
        const cachePath = getThumbnailCachePath(filePath, position);
        const metaPath = getThumbnailCacheMetaPath(filePath, position);

        fs.writeFileSync(cachePath, buffer);
        fs.writeFileSync(metaPath, JSON.stringify({
            sourcePath: filePath,
            position: position,
            sourceMtime: sourceMtime,
            createdAt: Date.now()
        }));

        console.log(`[${new Date().toISOString()}] 💾 Thumbnail cached: ${path.basename(filePath)}`);
    } catch (e) {
        console.error(`[${new Date().toISOString()}] ❌ Failed to cache thumbnail: ${e.message}`);
    }
}

// Generate video thumbnail at specified position (default 50%)
async function serveVideoThumbnail(req, res) {
    const requestedFile = req.query.path;
    const position = parseFloat(req.query.position) || 0.5; // Default to 50%

    console.log(`[${new Date().toISOString()}] GET /video-thumbnail - file: "${requestedFile}", position: ${position * 100}%`);

    if (!requestedFile) {
        return res.status(400).send('File path is required');
    }

    let decodedPath;
    try {
        decodedPath = decodeURIComponent(requestedFile);
    } catch (e) {
        decodedPath = requestedFile;
    }

    const filePath = path.join(baseDir, decodedPath);

    if (!filePath.startsWith(baseDir)) {
        return res.status(403).send('Forbidden');
    }

    const ext = path.extname(filePath).toLowerCase();
    const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.mpg', '.mpeg', '.wmv', '.m4v', '.flv', '.3gp', '.ts', '.mts', '.m2ts'];
    if (!videoExtensions.includes(ext)) {
        return res.status(400).send('Not a video file');
    }

    try {
        const stats = fs.statSync(filePath);
        const mtimeMs = stats.mtime.getTime();

        // Check disk cache first
        const cachedBuffer = getCachedThumbnail(decodedPath, position, mtimeMs);
        if (cachedBuffer) {
            console.log(`[${new Date().toISOString()}] ⚡ Video thumbnail DISK cache HIT`);
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('X-Thumbnail-Cache', 'DISK-HIT');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.send(cachedBuffer);
        }

        // Get video duration using ffprobe
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        let probeResult;
        try {
            probeResult = await execAsync(
                `ffprobe -v quiet -print_format json -show_format "${filePath}"`
            );
        } catch (probeError) {
            // ffprobe failed - file is likely corrupted or incomplete
            console.error(`[${new Date().toISOString()}] ❌ ffprobe failed for ${path.basename(filePath)}: ${probeError.message}`);
            return res.status(422).send('Video file is corrupted or incomplete');
        }
        
        let probeInfo;
        try {
            probeInfo = JSON.parse(probeResult.stdout);
        } catch (parseError) {
            return res.status(422).send('Could not parse video metadata');
        }
        
        const duration = parseFloat(probeInfo.format?.duration) || 0;

        if (duration === 0) {
            return res.status(422).send('Could not determine video duration - file may be corrupted');
        }

        // Calculate timestamp at specified position
        const seekTime = Math.floor(duration * position);

        console.log(`[${new Date().toISOString()}] 🎬 Generating thumbnail at ${seekTime}s of ${duration}s total`);

        // Generate thumbnail using ffmpeg
        const thumbnailPromise = new Promise((resolve, reject) => {
            const chunks = [];
            const ffmpeg = spawn('ffmpeg', [
                '-ss', seekTime.toString(),
                '-i', filePath,
                '-vframes', '1',
                '-vf', 'scale=320:-1',
                '-f', 'image2',
                '-c:v', 'mjpeg',
                '-q:v', '3',
                '-'
            ]);

            ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
            ffmpeg.stderr.on('data', () => {}); // Ignore stderr

            ffmpeg.on('close', (code) => {
                if (code === 0 && chunks.length > 0) {
                    resolve(Buffer.concat(chunks));
                } else {
                    reject(new Error(`FFmpeg exited with code ${code}`));
                }
            });

            ffmpeg.on('error', reject);

            // Timeout after 30 seconds
            setTimeout(() => {
                ffmpeg.kill('SIGKILL');
                reject(new Error('Thumbnail generation timeout'));
            }, 30000);
        });

        const buffer = await thumbnailPromise;

        // Save to disk cache
        saveThumbnailToCache(decodedPath, position, buffer, mtimeMs);

        console.log(`[${new Date().toISOString()}] ✅ Thumbnail generated (${buffer.length} bytes)`);

        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('X-Thumbnail-Cache', 'MISS');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(buffer);

    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Video thumbnail error: ${error.message}`);
        res.status(500).send(`Thumbnail generation error: ${error.message}`);
    }
}

// Get directory contents with metadata for library view
async function serveDirectoryLibrary(req, res) {
    const requestedPath = req.query.path || '';

    console.log(`[${new Date().toISOString()}] GET /api/library - path: "${requestedPath}"`);

    const unsafePath = path.join(baseDir, requestedPath);

    if (!unsafePath.startsWith(baseDir)) {
        return res.status(403).send('Forbidden');
    }

    let dirPath;
    try {
        dirPath = fs.realpathSync.native ? fs.realpathSync.native(unsafePath) : fs.realpathSync(unsafePath);
    } catch (e) {
        return res.status(404).send('Directory not found');
    }

    if (!dirPath.startsWith(baseReal)) {
        return res.status(403).send('Forbidden');
    }

    try {
        const entries = await fsp.readdir(dirPath, { withFileTypes: true });
        const filteredEntries = entries.filter(entry => entry.name !== '.browser');

        const filePromises = filteredEntries.map(async entry => {
            const entryPath = path.join(dirPath, entry.name);
            try {
                if (entry.isDirectory()) {
                    const stat = await fsp.stat(entryPath);
                    return {
                        name: entry.name,
                        isDirectory: true,
                        size: null,
                        modified: stat.mtime.toISOString(),
                        thumbnailType: 'directory',
                        extension: ''
                    };
                }

                const stat = await fsp.stat(entryPath);
                const ext = path.extname(entry.name).toLowerCase();

                // Determine file type for thumbnail generation
                const videoExts = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.mpg', '.mpeg', '.wmv', '.m4v', '.flv'];
                const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
                const pdfExts = ['.pdf'];
                const comicExts = ['.cbz', '.cbr'];
                const epubExts = ['.epub'];
                const docxExts = ['.docx', '.doc'];

                let thumbnailType = 'generic';
                if (videoExts.includes(ext)) thumbnailType = 'video';
                else if (imageExts.includes(ext)) thumbnailType = 'image';
                else if (pdfExts.includes(ext)) thumbnailType = 'pdf';
                else if (comicExts.includes(ext)) thumbnailType = 'comic';
                else if (epubExts.includes(ext)) thumbnailType = 'epub';
                else if (docxExts.includes(ext)) thumbnailType = 'docx';

                return {
                    name: entry.name,
                    isDirectory: entry.isDirectory(),
                    size: entry.isDirectory() ? null : stat.size,
                    modified: stat.mtime.toISOString(),
                    thumbnailType: entry.isDirectory() ? 'directory' : thumbnailType,
                    extension: ext.substring(1)
                };
            } catch (e) {
                return null;
            }
        });

        const files = (await Promise.all(filePromises)).filter(f => f !== null);

        res.json({
            path: requestedPath,
            files: files,
            totalFiles: files.length
        });

    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Library error: ${error.message}`);
        res.status(500).send(error.toString());
    }
}

// DOCX thumbnail preview - extracts embedded thumbnail or generates one
async function serveDocxPreview(req, res) {
    const requestedFile = req.query.path;
    console.log(`[${new Date().toISOString()}] GET /docx-preview - file: "${requestedFile}"`);
    
    if (!requestedFile) {
        return res.status(400).json({ error: 'File path is required' });
    }
    
    const filePath = path.join(baseDir, requestedFile);
    
    if (!filePath.startsWith(baseReal) && !filePath.startsWith(baseDir)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }
    
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.docx' && ext !== '.doc') {
        return res.status(400).json({ error: 'Not a Word document' });
    }
    
    try {
        // DOCX files are ZIP archives - try to extract embedded thumbnail
        if (ext === '.docx') {
            const thumbnail = await extractDocxThumbnail(filePath);
            if (thumbnail) {
                res.setHeader('Content-Type', thumbnail.mimeType);
                res.setHeader('Cache-Control', 'public, max-age=86400');
                res.send(thumbnail.data);
                return;
            }
        }
        
        // Fallback: Generate a text preview image using pandoc
        const textPreview = await generateDocxTextPreview(filePath);
        if (textPreview) {
            res.setHeader('Content-Type', 'image/svg+xml');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.send(textPreview);
            return;
        }
        
        console.log(`[${new Date().toISOString()}] ⚠️ No thumbnail generated for DOCX: ${requestedFile}`);
        res.status(404).json({ error: 'No thumbnail available' });
        
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ DOCX preview error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

// Extract embedded thumbnail from DOCX file (stored in docProps/thumbnail.*)
async function extractDocxThumbnail(filePath) {
    return new Promise((resolve) => {
        yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
            if (err) {
                console.log(`[${new Date().toISOString()}] ⚠️ Failed to open DOCX as ZIP: ${err.message}`);
                resolve(null);
                return;
            }
            
            let found = false;
            
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                if (!entry || !entry.fileName) {
                    zipfile.readEntry();
                    return;
                }
                
                // Look for thumbnail in docProps folder
                const fileName = entry.fileName.toLowerCase();
                if (fileName.startsWith('docprops/thumbnail.') || 
                    fileName === 'thumbnail.jpeg' || 
                    fileName === 'thumbnail.png' ||
                    fileName === 'docprops/thumbnail.jpeg' ||
                    fileName === 'docprops/thumbnail.png' ||
                    fileName === 'docprops/thumbnail.wmf' ||
                    fileName === 'docprops/thumbnail.emf') {
                    
                    found = true;
                    console.log(`[${new Date().toISOString()}] ✅ Found DOCX thumbnail: ${entry.fileName}`);
                    
                    zipfile.openReadStream(entry, (streamErr, readStream) => {
                        if (streamErr) {
                            resolve(null);
                            return;
                        }
                        
                        const chunks = [];
                        readStream.on('data', chunk => chunks.push(chunk));
                        readStream.on('end', () => {
                            const data = Buffer.concat(chunks);
                            let mimeType = 'image/jpeg';
                            if (fileName.endsWith('.png')) mimeType = 'image/png';
                            else if (fileName.endsWith('.wmf')) mimeType = 'image/x-wmf';
                            else if (fileName.endsWith('.emf')) mimeType = 'image/x-emf';
                            
                            resolve({ data, mimeType });
                        });
                        readStream.on('error', () => resolve(null));
                    });
                } else {
                    zipfile.readEntry();
                }
            });
            
            zipfile.on('end', () => {
                if (!found) {
                    console.log(`[${new Date().toISOString()}] ⚠️ No thumbnail found in DOCX`);
                    resolve(null);
                }
            });
            
            zipfile.on('error', () => resolve(null));
        });
    });
}

// Generate a text-based SVG preview from DOCX using pandoc
async function generateDocxTextPreview(filePath) {
    return new Promise((resolve) => {
        // Use pandoc to extract plain text from DOCX
        const pandoc = spawn('pandoc', [filePath, '-t', 'plain', '--wrap=none']);
        
        let text = '';
        let stderr = '';
        
        pandoc.stdout.on('data', (data) => {
            text += data.toString();
        });
        
        pandoc.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        pandoc.on('close', (code) => {
            if (code !== 0 || !text.trim()) {
                console.log(`[${new Date().toISOString()}] ⚠️ Pandoc failed or no text: ${stderr}`);
                resolve(null);
                return;
            }
            
            // Take first ~500 chars for preview
            const previewText = text.trim().substring(0, 500);
            const lines = previewText.split('\n').slice(0, 12); // Max 12 lines
            
            // Generate SVG with text preview
            const escapedLines = lines.map(line => {
                return line
                    .substring(0, 40) // Max 40 chars per line
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;');
            });
            
            const lineHeight = 14;
            const startY = 25;
            const textElements = escapedLines.map((line, i) => 
                `<text x="10" y="${startY + i * lineHeight}" fill="#333" font-size="11" font-family="Arial, sans-serif">${line || ' '}</text>`
            ).join('\n');
            
            const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="#fff" stroke="#ddd" stroke-width="1"/>
  <rect x="5" y="5" width="190" height="30" fill="#2b579a" rx="2"/>
  <text x="10" y="25" fill="#fff" font-size="12" font-family="Arial, sans-serif" font-weight="bold">📝 DOCX</text>
  <rect x="5" y="40" width="190" height="155" fill="#f9f9f9" rx="2"/>
  <g transform="translate(0, 25)">
    ${textElements}
  </g>
</svg>`;
            
            console.log(`[${new Date().toISOString()}] ✅ Generated DOCX text preview SVG`);
            resolve(Buffer.from(svg, 'utf8'));
        });
        
        pandoc.on('error', (error) => {
            console.log(`[${new Date().toISOString()}] ⚠️ Pandoc spawn error: ${error.message}`);
            resolve(null);
        });
        
        // Timeout after 10 seconds
        setTimeout(() => {
            pandoc.kill();
            resolve(null);
        }, 10000);
    });
}

module.exports = {
    serveBrowseRequest,
    serveFileList,
    serveFile,
    getPdfInfo,
    servePdfPreview,
    serveVideoTranscode,
    serveSubtitle,
    validatePdf,
    serveVideoThumbnail,
    serveDirectoryLibrary,
    serveDocxPreview
};