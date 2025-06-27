// Authentication management
class AuthManager {
    constructor() {
        this.user = null;
        this.authenticated = false;
        this.authCheckPromise = null;
    }

    async checkAuthStatus() {
        if (this.authCheckPromise) {
            return this.authCheckPromise;
        }

        this.authCheckPromise = this.performAuthCheck();
        return this.authCheckPromise;
    }

    async performAuthCheck() {
        try {
            const response = await fetch('/auth/user', {
                credentials: 'include'
            });
            
            if (response.ok) {
                const data = await response.json();
                this.authenticated = data.authenticated;
                this.user = data.user || null;
                
                console.log('Authentication status:', this.authenticated ? 'Authenticated' : 'Not authenticated');
                if (this.authenticated) {
                    console.log('User:', this.user.name, this.user.email);
                }
                
                return this.authenticated;
            } else {
                console.warn('Auth check failed:', response.status);
                this.authenticated = false;
                this.user = null;
                return false;
            }
        } catch (error) {
            console.error('Auth check error:', error);
            this.authenticated = false;
            this.user = null;
            return false;
        }
    }

    async logout() {
        try {
            const response = await fetch('/auth/logout', {
                method: 'POST',
                credentials: 'include'
            });
            
            if (response.ok) {
                this.authenticated = false;
                this.user = null;
                this.authCheckPromise = null;
                
                // Reload the page to reset state
                window.location.reload();
            } else {
                console.error('Logout failed:', response.status);
            }
        } catch (error) {
            console.error('Logout error:', error);
        }
    }

    updateUI() {
        const authPanel = document.getElementById('auth-panel');
        const userBar = document.getElementById('user-bar');
        const container = document.querySelector('.container');
        const body = document.body;

        if (this.authenticated && this.user) {
            // Hide auth panel and show user bar
            authPanel.style.display = 'none';
            userBar.style.display = 'flex';
            container.style.display = 'flex';
            body.classList.add('authenticated');

            // Update user info
            const userAvatar = document.getElementById('user-avatar');
            const userName = document.getElementById('user-name');
            
            if (userAvatar && this.user.picture) {
                userAvatar.src = this.user.picture;
                userAvatar.style.display = 'block';
            }
            
            if (userName) {
                userName.textContent = this.user.name;
            }

            // Set up logout button
            const logoutBtn = document.getElementById('logout-btn');
            if (logoutBtn) {
                logoutBtn.addEventListener('click', () => this.logout());
            }
        } else {
            // Show auth panel and hide everything else
            authPanel.style.display = 'flex';
            userBar.style.display = 'none';
            container.style.display = 'none';
            body.classList.remove('authenticated');
        }
    }

    // Enhanced fetch that handles authentication
    async authenticatedFetch(url, options = {}) {
        const defaultOptions = {
            credentials: 'include',
            ...options
        };

        try {
            const response = await fetch(url, defaultOptions);
            
            if (response.status === 401) {
                // Authentication required
                console.log('Authentication required, redirecting to login');
                this.authenticated = false;
                this.user = null;
                this.authCheckPromise = null;
                this.updateUI();
                return null;
            }
            
            return response;
        } catch (error) {
            console.error('Authenticated fetch error:', error);
            throw error;
        }
    }
}

// Global auth manager instance
window.authManager = new AuthManager();

// Initialize authentication on page load
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Checking authentication status...');
    
    const isAuthenticated = await window.authManager.checkAuthStatus();
    window.authManager.updateUI();
    
    if (isAuthenticated) {
        console.log('User is authenticated, proceeding to load application');
        // Trigger the main application to load
        if (window.initializeApp) {
            window.initializeApp();
        }
    } else {
        console.log('User not authenticated, showing login screen');
    }
});

// Handle URL parameters (for post-authentication redirects)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('authenticated') === 'true') {
    // Remove the parameter from URL without page reload
    const newUrl = window.location.pathname;
    window.history.replaceState({}, document.title, newUrl);
    
    // Re-check authentication status
    window.authManager.checkAuthStatus().then(isAuthenticated => {
        window.authManager.updateUI();
        if (isAuthenticated && window.initializeApp) {
            window.initializeApp();
        }
    });
}