// Debug Console Module for File Browser
class DebugConsole {
    constructor() {
        this.messages = [];
        this.maxMessages = 1000;
        this.isVisible = false;
        this.init();
    }

    init() {
        // Intercept console.log, console.error, etc.
        this.originalConsole = {
            log: console.log,
            error: console.error,
            warn: console.warn,
            info: console.info
        };

        // Override console methods to capture messages
        console.log = (...args) => {
            this.originalConsole.log(...args);
            this.addMessage('log', args);
        };

        console.error = (...args) => {
            this.originalConsole.error(...args);
            this.addMessage('error', args);
        };

        console.warn = (...args) => {
            this.originalConsole.warn(...args);
            this.addMessage('warn', args);
        };

        console.info = (...args) => {
            this.originalConsole.info(...args);
            this.addMessage('info', args);
        };

        // Setup debug console UI
        this.setupUI();
        console.log('🐛 Debug Console initialized');
    }

    addMessage(type, args) {
        const timestamp = new Date().toLocaleTimeString();
        const message = {
            type,
            timestamp,
            content: args.map(arg => 
                typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
            ).join(' ')
        };

        this.messages.push(message);
        
        // Keep only the last maxMessages
        if (this.messages.length > this.maxMessages) {
            this.messages.shift();
        }

        this.updateDisplay();
    }

    setupUI() {
        const debugTab = document.getElementById('debug-tab');
        if (!debugTab) return;

        const clearBtn = document.getElementById('clear-debug-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearMessages());
        }

        // Setup tab switching
        const tabButtons = document.querySelectorAll('.tab-button');
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const tab = button.dataset.tab;
                if (tab === 'debug') {
                    this.isVisible = true;
                    this.updateDisplay();
                } else {
                    this.isVisible = false;
                }
            });
        });
    }

    updateDisplay() {
        if (!this.isVisible) return;

        const messagesContainer = document.getElementById('debug-messages');
        if (!messagesContainer) return;

        const html = this.messages.map(msg => {
            const typeClass = `debug-${msg.type}`;
            const icon = this.getTypeIcon(msg.type);
            return `
                <div class="debug-message ${typeClass}">
                    <span class="debug-timestamp">${msg.timestamp}</span>
                    <span class="debug-icon">${icon}</span>
                    <span class="debug-content">${this.escapeHtml(msg.content)}</span>
                </div>
            `;
        }).join('');

        messagesContainer.innerHTML = html;
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    getTypeIcon(type) {
        const icons = {
            log: '📝',
            error: '❌',
            warn: '⚠️',
            info: 'ℹ️'
        };
        return icons[type] || '📝';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    clearMessages() {
        this.messages = [];
        this.updateDisplay();
        console.log('🧹 Debug console cleared');
    }

    // Public methods for external use
    addCustomMessage(type, message) {
        this.addMessage(type, [message]);
    }

    showProgress(message, percentage) {
        this.addMessage('info', [`${message} ${percentage ? `(${percentage}%)` : ''}`]);
        this.showProgressOverlay(message, percentage);
    }

    updateProgress(message, percentage) {
        this.addMessage('info', [`${message} ${percentage ? `(${percentage}%)` : ''}`]);
        this.updateProgressOverlay(message, percentage);
    }

    hideProgress() {
        this.addMessage('info', ['Loading completed']);
        this.hideProgressOverlay();
    }

    showProgressOverlay(message, percentage = 0) {
        const progressContainer = document.getElementById('progress-container');
        const progressText = document.getElementById('progress-text');
        const progressPercentage = document.getElementById('progress-percentage');
        const progressFill = document.getElementById('progress-fill');

        if (progressContainer && progressText && progressPercentage && progressFill) {
            progressText.textContent = message;
            progressPercentage.textContent = `${percentage}%`;
            progressFill.style.width = `${percentage}%`;
            progressContainer.style.display = 'flex';
        }
    }

    updateProgressOverlay(message, percentage = 0) {
        const progressText = document.getElementById('progress-text');
        const progressPercentage = document.getElementById('progress-percentage');
        const progressFill = document.getElementById('progress-fill');

        if (progressText && progressPercentage && progressFill) {
            progressText.textContent = message;
            progressPercentage.textContent = `${percentage}%`;
            progressFill.style.width = `${percentage}%`;
        }
    }

    hideProgressOverlay() {
        const progressContainer = document.getElementById('progress-container');
        if (progressContainer) {
            // Small delay to show completion before hiding
            setTimeout(() => {
                progressContainer.style.display = 'none';
            }, 500);
        }
    }

    downloadLogs() {
        const logs = this.messages.map(msg => 
            `[${msg.timestamp}] ${msg.type.toUpperCase()}: ${msg.content}`
        ).join('\n');
        
        const blob = new Blob([logs], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `debug-logs-${new Date().toISOString().slice(0, 10)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// Initialize debug console when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.debugConsole = new DebugConsole();
    });
} else {
    window.debugConsole = new DebugConsole();
}