require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const session = require('express-session');
const { passport, requireAuth, optionalAuth } = require('./auth');
const FileCache = require('./cache');

const { AUTH_ENABLED, port, baseDir } = require('./lib/config');
const { setupAuthRoutes } = require('./lib/auth-routes');
const { 
    serveBrowseRequest, 
    serveFileList, 
    serveFile, 
    getPdfInfo, 
    servePdfPreview, 
    serveVideoTranscode 
} = require('./lib/file-handlers');
const { serveComicPreview, getComicInfo, serveArchiveVideo } = require('./lib/comic-handlers');
const { serveArchiveContents, serveArchiveFile } = require('./lib/archive-handlers');
const { serveEpubCover, serveEpubPreview, serveCoverImageFallback, serveEpubAsPdf } = require('./lib/epub-handlers');
const { getAnnotations, postAnnotations, deleteAnnotations, searchAnnotations } = require('./lib/annotation-handlers');
const { getCacheStats, clearCache } = require('./lib/cache-handlers');
const { openFile } = require('./lib/system-handlers');
const AIFileAnalyzer = require('./lib/ai-file-analyzer');
const { getHomogeneityModules } = require('./src/services/homogeneityService');
const { updateEntity } = require('./src/services/orthogonalityService');

const app = express();

// Request size limits to prevent memory exhaustion
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Memory monitoring and protection
const memoryMonitor = {
    checkMemory() {
        const usage = process.memoryUsage();
        const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
        const rssMB = Math.round(usage.rss / 1024 / 1024);
        
        // Log memory usage every 10 minutes in production
        if (process.env.NODE_ENV === 'production') {
            console.log(`📊 Memory: ${heapUsedMB}MB used, ${heapTotalMB}MB total, ${rssMB}MB RSS`);
        }
        
        // Warn if memory usage is high (>500MB heap or >1GB RSS)
        if (heapUsedMB > 500 || rssMB > 1024) {
            console.warn(`⚠️ High memory usage: ${heapUsedMB}MB heap, ${rssMB}MB RSS`);
        }
        
        return { heapUsedMB, heapTotalMB, rssMB };
    },
    
    startMonitoring() {
        // Check memory every 10 minutes
        setInterval(() => this.checkMemory(), 10 * 60 * 1000);
        // Initial check
        this.checkMemory();
    }
};

// Start memory monitoring
memoryMonitor.startMonitoring();

// Global error handling to prevent crashes
process.on('uncaughtException', (error) => {
    console.error('🚨 UNCAUGHT EXCEPTION - Server will attempt to continue:', error);
    console.error('Stack trace:', error.stack);
    // Don't exit the process - try to continue serving other requests
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 UNHANDLED PROMISE REJECTION at:', promise, 'reason:', reason);
    console.error('Stack trace:', reason?.stack || 'No stack trace available');
    // Don't exit the process - try to continue serving other requests
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received. Shutting down gracefully...');
    server.close(() => {
        console.log('✅ Server closed successfully');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received. Shutting down gracefully...');
    server.close(() => {
        console.log('✅ Server closed successfully');
        process.exit(0);
    });
});

console.log('================================');
console.log('🚀 File Browser Server Starting...');
console.log(`📂 Base directory: ${baseDir}`);
console.log(`🔧 Port: ${port}`);
console.log(`🔐 Authentication: ${AUTH_ENABLED ? 'ENABLED' : 'DISABLED'}`);
console.log('================================');

// Security headers & CSP
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            "script-src-elem": ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            "style-src": ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            "img-src": ["'self'", "data:"],
            "connect-src": ["'self'"],
            "worker-src": ["'self'", "blob:", "https://cdnjs.cloudflare.com"],
            "object-src": ["'none'"],
            "frame-ancestors": ["'none'"]
        }
    },
    crossOriginEmbedderPolicy: false
}));

// Session configuration (always enabled for browse state persistence)
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-fallback-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
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

// Rate limiting costose
const heavyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false
});

const previewLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false
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
app.get('/files/list', serveFileList);
app.get('/files', requireAuth, serveFile);
app.get('/pdf-preview', requireAuth, previewLimiter, servePdfPreview);
app.get('/video-transcode', requireAuth, previewLimiter, serveVideoTranscode);
app.get('/comic-preview', requireAuth, (req, res) => serveComicPreview(req, res, cache));

// Archive routes
app.get('/archive-video', requireAuth, (req, res) => serveArchiveVideo(req, res, cache));
app.get('/archive-contents', requireAuth, (req, res) => serveArchiveContents(req, res, cache));
app.get('/archive-file', requireAuth, serveArchiveFile);

// EPUB routes
app.get('/epub-cover', requireAuth, serveEpubCover);
app.get('/epub-preview', requireAuth, serveEpubPreview);
app.get('/epub-pdf', requireAuth, serveEpubAsPdf);
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

// AI File Summary route
app.post('/api/summarize-file', requireAuth, async (req, res) => {
    try {
        const { path: filePath, content, fullPdf } = req.body;
        
        if (!filePath && !content) {
            return res.status(400).json({ error: 'File path or content is required' });
        }

        const analyzer = new AIFileAnalyzer();
        const result = await analyzer.summarizeFileContent(filePath, content, fullPdf);
        
        res.json({
            success: true,
            summary: result.summary,
            stats: result.stats
        });
    } catch (error) {
        console.error('Error summarizing file:', error);
        res.status(500).json({ 
            error: 'Failed to summarize file', 
            message: error.message 
        });
    }
});

// AI File Analysis route
app.post('/api/analyze-files', requireAuth, heavyLimiter, async (req, res) => {
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

// Homogeneity endpoint
app.get('/api/homogeneity', (req, res) => {
  const modules = getHomogeneityModules();
  res.json({ modules });
});

// Orthogonality endpoint
app.post('/api/orthogonality', (req, res) => {
  const { name, value } = req.body;
  const result = updateEntity(name, value);
  res.json({ updated: { name, value: result } });
});

// Global Express error handler - must be last middleware
app.use((error, req, res, next) => {
    console.error('🚨 EXPRESS ERROR HANDLER:', {
        error: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method,
        timestamp: new Date().toISOString()
    });
    
    // Prevent sending response if headers already sent
    if (res.headersSent) {
        return next(error);
    }
    
    // Send user-friendly error response
    const statusCode = error.status || error.statusCode || 500;
    const message = statusCode === 500 ? 'Internal server error' : error.message;
    
    res.status(statusCode).json({
        error: message,
        timestamp: new Date().toISOString(),
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
});

// 404 handler for undefined routes
app.use((req, res) => {
    console.warn(`⚠️ 404 - Route not found: ${req.method} ${req.url}`);
    res.status(404).json({
        error: 'Route not found',
        path: req.url,
        method: req.method
    });
});

const server = app.listen(port, () => {
    console.log(`🌐 Server running at http://localhost:${port}`);
    console.log(`📂 Serving files from: ${baseDir}`);
    console.log('✅ Server started successfully!');
});

// Set server timeout to prevent hanging connections
server.setTimeout(300000); // 5 minutes

module.exports = app;