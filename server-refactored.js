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

const app = express();

console.log('================================');
console.log('🚀 File Browser Server Starting...');
console.log(`📂 Base directory: ${baseDir}`);
console.log(`🔧 Port: ${port}`);
console.log(`🔐 Authentication: ${AUTH_ENABLED ? 'ENABLED' : 'DISABLED'}`);
console.log('================================');

// Session configuration (only if auth is enabled)
if (AUTH_ENABLED) {
    app.use(session({
        secret: process.env.SESSION_SECRET || 'your-fallback-secret-key-change-in-production',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: false,
            maxAge: 24 * 60 * 60 * 1000
        }
    }));

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

// TODO: Add other remaining routes (archive, epub, etc.)

app.listen(port, () => {
    console.log(`🌐 Server running at http://localhost:${port}`);
    console.log(`📂 Serving files from: ${baseDir}`);
    console.log('✅ Server started successfully!');
});

module.exports = app;