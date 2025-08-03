require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const { passport, requireAuth, optionalAuth } = require('./auth');
const FileCache = require('./cache');

const { AUTH_ENABLED, port, baseDir } = require('./lib/config');
const { setupAuthRoutes } = require('./lib/auth-routes');
const { 
    serveBrowseRequest, 
    serveFile, 
    getPdfInfo, 
    servePdfPreview, 
    serveVideoTranscode 
} = require('./lib/file-handlers');
const { serveComicPreview, getComicInfo } = require('./lib/comic-handlers');
const { serveArchiveContents, serveArchiveFile } = require('./lib/archive-handlers');
const { serveEpubCover, serveEpubPreview, serveCoverImageFallback } = require('./lib/epub-handlers');
const { getAnnotations, postAnnotations, deleteAnnotations, searchAnnotations } = require('./lib/annotation-handlers');
const { getCacheStats, clearCache } = require('./lib/cache-handlers');
const { openFile } = require('./lib/system-handlers');
const AIFileAnalyzer = require('./lib/ai-file-analyzer');

const app = express();

console.log('================================');
console.log('🚀 File Browser Server Starting...');
console.log(`📂 Base directory: ${baseDir}`);
console.log(`🔧 Port: ${port}`);
console.log(`🔐 Authentication: ${AUTH_ENABLED ? 'ENABLED' : 'DISABLED'}`);
console.log('================================');

// Session configuration (always enabled for browse state persistence)
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-fallback-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Passport initialization (only if auth is enabled)
if (AUTH_ENABLED) {
    app.use(passport.initialize());
    app.use(passport.session());
}

// Initialize disk-based cache system
const cache = new FileCache({
    maxAge: 24 * 60 * 60 * 1000,
    maxSize: 500 * 1024 * 1024
});

// Setup routes
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Authentication routes
setupAuthRoutes(app, passport);

// API routes
app.get('/api/browse', requireAuth, serveBrowseRequest);
app.get('/api/pdf-info', requireAuth, getPdfInfo);
app.get('/api/comic-info', requireAuth, (req, res) => getComicInfo(req, res, cache));

// File serving routes
app.get('/files', requireAuth, serveFile);
app.get('/pdf-preview', requireAuth, servePdfPreview);
app.get('/video-transcode', requireAuth, serveVideoTranscode);
app.get('/comic-preview', requireAuth, (req, res) => serveComicPreview(req, res, cache));

// Archive routes
app.get('/archive-contents', requireAuth, (req, res) => serveArchiveContents(req, res, cache));
app.get('/archive-file', requireAuth, serveArchiveFile);

// EPUB routes
app.get('/epub-cover', requireAuth, serveEpubCover);
app.get('/epub-preview', requireAuth, serveEpubPreview);
app.get('/cover.jpeg', serveCoverImageFallback);
app.get('/cover.jpg', serveCoverImageFallback);

// Annotation routes
app.get('/api/annotations', requireAuth, getAnnotations);
app.post('/api/annotations', requireAuth, postAnnotations);
app.delete('/api/annotations', requireAuth, deleteAnnotations);
app.get('/api/search-annotations', requireAuth, searchAnnotations);

// Cache management routes
app.get('/api/cache/stats', requireAuth, (req, res) => getCacheStats(req, res, cache));
app.post('/api/cache/clear', requireAuth, (req, res) => clearCache(req, res, cache));

// System routes
app.post('/api/open-file', requireAuth, openFile);

// AI File Analysis route
app.post('/api/analyze-files', requireAuth, async (req, res) => {
    try {
        const { path: dirPath, context } = req.body;
        
        if (dirPath === undefined || dirPath === null) {
            return res.status(400).json({ error: 'Directory path is required' });
        }

        // Resolve the full path based on the baseDir
        // Handle empty string as root path
        const normalizedPath = dirPath.startsWith('/') ? dirPath.slice(1) : dirPath;
        const fullPath = path.resolve(baseDir, normalizedPath);
        
        // Security check - ensure the path is within baseDir
        if (!fullPath.startsWith(baseDir)) {
            return res.status(403).json({ error: 'Access denied: Path outside allowed directory' });
        }

        const analyzer = new AIFileAnalyzer();
        const result = await analyzer.analyzeDirectory(fullPath, context);
        
        res.json({
            success: true,
            ...result
        });
        
    } catch (error) {
        console.error('Error in AI file analysis:', error);
        res.status(500).json({ 
            error: 'Failed to analyze files',
            message: error.message
        });
    }
});

// Image serving route for EPUB content
app.get('/images/:filename', requireAuth, async (req, res) => {
    // This endpoint needs special handling for EPUB images - keeping as placeholder
    res.status(404).json({ error: 'Image endpoint not fully implemented yet' });
});

// Session-based current path persistence
app.get('/api/current-path', (req, res) => {
    const currentPath = req.session.currentPath || '';
    res.json({ currentPath });
});

app.post('/api/current-path', (req, res) => {
    const { path: newPath } = req.body;
    req.session.currentPath = newPath || '';
    req.session.lastBrowsedPath = newPath || '';  // Sync both session keys
    res.json({ success: true, currentPath: req.session.currentPath });
});

// Endpoint to get server root info
app.get('/api/server-info', (req, res) => {
    res.json({ 
        rootDir: baseDir,
        currentPath: req.session.currentPath || req.session.lastBrowsedPath || ''
    });
});

app.listen(port, () => {
    console.log(`🌐 Server running at http://localhost:${port}`);
    console.log(`📂 Serving files from: ${baseDir}`);
    console.log('✅ Server started successfully!');
});

module.exports = app;