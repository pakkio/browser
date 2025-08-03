// Global client-side error handling to prevent crashes
class GlobalErrorHandler {
    constructor() {
        this.errorCount = 0;
        this.maxErrors = 10; // Max errors before showing persistent warning
        this.setupErrorHandlers();
    }

    setupErrorHandlers() {
        // Handle uncaught JavaScript errors
        window.addEventListener('error', (event) => {
            this.handleError({
                type: 'JavaScript Error',
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                error: event.error
            });
        });

        // Handle unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            this.handleError({
                type: 'Unhandled Promise Rejection',
                message: event.reason?.message || event.reason,
                stack: event.reason?.stack
            });
            
            // Prevent the default browser behavior (logging to console)
            event.preventDefault();
        });

        // Handle resource loading errors
        window.addEventListener('error', (event) => {
            if (event.target !== window) {
                this.handleResourceError({
                    type: 'Resource Loading Error',
                    element: event.target.tagName,
                    source: event.target.src || event.target.href,
                    message: `Failed to load ${event.target.tagName.toLowerCase()}`
                });
            }
        }, true);

        console.log('🛡️ Global error handlers initialized');
    }

    handleError(errorInfo) {
        this.errorCount++;
        
        console.error('🚨 CLIENT ERROR CAUGHT:', {
            ...errorInfo,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            url: window.location.href,
            errorCount: this.errorCount
        });

        // Show user-friendly error notification
        this.showErrorNotification(errorInfo);

        // If too many errors, show persistent warning
        if (this.errorCount >= this.maxErrors) {
            this.showPersistentErrorWarning();
        }

        // Try to recover from common error scenarios
        this.attemptRecovery(errorInfo);
    }

    handleResourceError(errorInfo) {
        console.warn('⚠️ RESOURCE ERROR:', errorInfo);
        
        // Don't count resource errors toward the error limit
        // They're usually not critical to app functionality
    }

    showErrorNotification(errorInfo) {
        // Create temporary notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(255, 107, 107, 0.95);
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10001;
            max-width: 400px;
            font-size: 14px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.2);
        `;
        
        notification.innerHTML = `
            <div style="display: flex; align-items: center; margin-bottom: 8px;">
                <span style="font-size: 18px; margin-right: 8px;">⚠️</span>
                <strong>Something went wrong</strong>
                <button onclick="this.parentElement.parentElement.remove()" 
                        style="margin-left: auto; background: none; border: none; color: white; font-size: 18px; cursor: pointer;">×</button>
            </div>
            <div style="font-size: 12px; opacity: 0.9; margin-bottom: 10px;">
                ${this.getUserFriendlyMessage(errorInfo)}
            </div>
            <div style="font-size: 11px; opacity: 0.7;">
                The app will continue to work, but please refresh if you experience issues.
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Auto-remove after 8 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 8000);
    }

    getUserFriendlyMessage(errorInfo) {
        const message = errorInfo.message?.toLowerCase() || '';
        
        if (message.includes('network') || message.includes('fetch')) {
            return 'Network connection issue. Check your internet connection.';
        }
        
        if (message.includes('timeout')) {
            return 'Operation took too long. The server may be busy.';
        }
        
        if (message.includes('permission') || message.includes('cors')) {
            return 'Permission error. Try refreshing the page.';
        }
        
        if (message.includes('memory') || message.includes('quota')) {
            return 'Running low on memory. Try closing other browser tabs.';
        }
        
        if (errorInfo.type === 'Resource Loading Error') {
            return `Failed to load resource. This may affect some features.`;
        }
        
        return 'An unexpected error occurred. The app should continue working normally.';
    }

    showPersistentErrorWarning() {
        if (document.getElementById('persistent-error-warning')) {
            return; // Already showing
        }
        
        const warning = document.createElement('div');
        warning.id = 'persistent-error-warning';
        warning.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: linear-gradient(45deg, #ff6b6b, #ee5a52);
            color: white;
            padding: 10px;
            text-align: center;
            z-index: 10002;
            font-size: 14px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        `;
        
        warning.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
                <span>⚠️ Multiple errors detected. Consider refreshing the page.</span>
                <button onclick="window.location.reload()" 
                        style="background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 5px 10px; border-radius: 4px; cursor: pointer;">
                    Refresh Page
                </button>
                <button onclick="this.parentElement.parentElement.remove()" 
                        style="background: none; border: 1px solid rgba(255,255,255,0.3); color: white; padding: 5px 10px; border-radius: 4px; cursor: pointer;">
                    Dismiss
                </button>
            </div>
        `;
        
        document.body.appendChild(warning);
    }

    attemptRecovery(errorInfo) {
        const message = errorInfo.message?.toLowerCase() || '';
        
        // Recovery strategies for common errors
        if (message.includes('debugconsole') && window.debugConsole) {
            // If debug console fails, try to reinitialize
            try {
                window.debugConsole.hideProgress();
            } catch (e) {
                console.log('Attempted debug console recovery');
            }
        }
        
        if (message.includes('renderer') || message.includes('render')) {
            // If file renderer fails, try to clear any stuck loading states
            try {
                const loadingIndicators = document.querySelectorAll('[id*="loading"], [class*="loading"]');
                loadingIndicators.forEach(el => {
                    if (el.style.display !== 'none') {
                        el.style.display = 'none';
                    }
                });
            } catch (e) {
                console.log('Attempted loading state recovery');
            }
        }
    }

    // Public method to check if app is in error state
    isInErrorState() {
        return this.errorCount >= this.maxErrors;
    }

    // Public method to reset error count
    resetErrorCount() {
        this.errorCount = 0;
        const warning = document.getElementById('persistent-error-warning');
        if (warning) {
            warning.remove();
        }
    }
}

// Initialize global error handler when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.globalErrorHandler = new GlobalErrorHandler();
    });
} else {
    window.globalErrorHandler = new GlobalErrorHandler();
}