const { AUTH_ENABLED } = require('./config');

function setupAuthRoutes(app, passport) {
    if (AUTH_ENABLED) {
        app.get('/auth/google',
            passport.authenticate('google', { scope: ['profile', 'email'] })
        );

        app.get('/auth/google/callback',
            passport.authenticate('google', { failureRedirect: '/login-failed' }),
            (req, res) => {
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
}

module.exports = { setupAuthRoutes };