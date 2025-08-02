const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const pdf2pic = require('pdf2pic');
const yauzl = require('yauzl');
const { createExtractorFromFile } = require('node-unrar-js');
const { baseDir, mimeTypes, getImageMimeType } = require('./config');

const pendingRequests = new Map();

function serveBrowseRequest(req, res) {
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
        
        // Store current path in session for resume functionality
        if (req.session) {
            req.session.lastBrowsedPath = requestedPath;
        }
        
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
    if (!['.avi', '.wmv'].includes(ext)) {
        return res.status(400).send('Only AVI and WMV files supported for transcoding');
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
        
        req.on('close', () => {
            ffmpeg.kill('SIGKILL');
        });
        
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Video transcoding error: ${error.message}`);
        res.status(500).send(`Video transcoding error: ${error.message}`);
    }
}

module.exports = {
    serveBrowseRequest,
    serveFile,
    getPdfInfo,
    servePdfPreview,
    serveVideoTranscode
};