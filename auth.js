const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

// Load environment variables
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const AUTH_ENABLED = ['TRUE', 'YES', '1', 'true', 'yes'].includes((process.env.AUTH || 'TRUE').toUpperCase());

// Configure Google OAuth strategy
passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: `${BASE_URL}/auth/google/callback`
}, (accessToken, refreshToken, profile, done) => {
    // In a real application, you would save user data to a database
    // For this demo, we'll just use the profile information
    const user = {
        id: profile.id,
        name: profile.displayName,
        email: profile.emails?.[0]?.value,
        picture: profile.photos?.[0]?.value,
        provider: 'google'
    };
    
    console.log(`[${new Date().toISOString()}] 🔐 User authenticated: ${user.name} (${user.email})`);
    return done(null, user);
}));

// Serialize user for session
passport.serializeUser((user, done) => {
    done(null, user);
});

// Deserialize user from session
passport.deserializeUser((user, done) => {
    done(null, user);
});

// Authentication middleware
function requireAuth(req, res, next) {
    // If authentication is disabled, always allow access
    if (!AUTH_ENABLED) {
        return next();
    }
    
    if (req.isAuthenticated()) {
        return next();
    }
    
    // Check if it's an API request
    if (req.path.startsWith('/api/') || req.path.startsWith('/files') || 
        req.path.startsWith('/pdf-preview') || req.path.startsWith('/comic-preview') ||
        req.path.startsWith('/epub-preview') || req.path.startsWith('/video-transcode')) {
        return res.status(401).json({ 
            error: 'Authentication required',
            loginUrl: '/auth/google'
        });
    }
    
    // Redirect to login for regular requests
    res.redirect('/auth/google');
}

// Optional authentication (doesn't redirect, just adds user info if available)
function optionalAuth(req, res, next) {
    // Always proceed, but user info will be available if authenticated
    next();
}

module.exports = {
    passport,
    requireAuth,
    optionalAuth
};