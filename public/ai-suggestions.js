// AI-powered file suggestions system
class AISuggestionsManager {
    constructor() {
        console.log('🧠 AI Suggestions constructor called');
        this.isVisible = false;
        this.currentSuggestions = [];
        this.currentPath = '';
        this.initializeUI();
        console.log('🧠 AI Suggestions initialization complete');
    }

    initializeUI() {
        // Add CSS styles
        this.addStyles();
        
        // Create the suggestion popup elements
        this.createPopupElements();
        
        // Add event listeners
        this.setupEventListeners();
    }

    addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .ai-suggestions-backdrop {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(4px);
                z-index: 1000;
                display: none;
                animation: fadeIn 0.3s ease-out;
            }

            .ai-suggestions-popup {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: #2d2d2d;
                border: 1px solid #555;
                border-radius: 12px;
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
                width: 90%;
                max-width: 800px;
                max-height: 80vh;
                overflow: hidden;
                z-index: 1001;
                animation: slideIn 0.4s ease-out;
            }

            .ai-suggestions-header {
                background: linear-gradient(135deg, #4ecdc4, #44a08d);
                color: white;
                padding: 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-radius: 12px 12px 0 0;
            }

            .ai-suggestions-header h2 {
                margin: 0;
                font-size: 24px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .ai-suggestions-close {
                background: none;
                border: none;
                color: white;
                font-size: 24px;
                cursor: pointer;
                padding: 5px;
                border-radius: 50%;
                transition: all 0.2s;
                width: 36px;
                height: 36px;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .ai-suggestions-close:hover {
                background: rgba(255, 255, 255, 0.2);
                transform: scale(1.1);
            }

            .ai-suggestions-content {
                padding: 20px;
                max-height: calc(80vh - 120px);
                overflow-y: auto;
                color: #e0e0e0;
            }

            .ai-suggestions-loading {
                text-align: center;
                padding: 40px;
                color: #888;
            }

            .ai-suggestions-spinner {
                display: inline-block;
                width: 40px;
                height: 40px;
                border: 3px solid #333;
                border-radius: 50%;
                border-top-color: #4ecdc4;
                animation: spin 1s ease-in-out infinite;
                margin-bottom: 10px;
            }

            .ai-suggestions-summary {
                background: rgba(78, 205, 196, 0.1);
                border: 1px solid rgba(78, 205, 196, 0.3);
                border-radius: 8px;
                padding: 15px;
                margin-bottom: 20px;
                font-style: italic;
                color: #b0e0dd;
            }

            .ai-suggestions-list {
                display: grid;
                gap: 15px;
            }

            .ai-suggestion-item {
                background: #3a3a3a;
                border: 1px solid #555;
                border-radius: 8px;
                padding: 18px;
                transition: all 0.3s ease;
                cursor: pointer;
                position: relative;
                overflow: hidden;
            }

            .ai-suggestion-item:hover {
                background: #404040;
                border-color: #4ecdc4;
                transform: translateY(-2px);
                box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3);
            }

            .ai-suggestion-item::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                width: 4px;
                height: 100%;
                background: linear-gradient(45deg, #4ecdc4, #44a08d);
                opacity: 0;
                transition: opacity 0.3s;
            }

            .ai-suggestion-item:hover::before {
                opacity: 1;
            }

            .ai-suggestion-header {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 10px;
            }

            .ai-suggestion-name {
                font-weight: 600;
                color: #4ecdc4;
                font-size: 16px;
                word-break: break-word;
            }

            .ai-suggestion-score {
                background: linear-gradient(45deg, #4ecdc4, #44a08d);
                color: white;
                padding: 4px 8px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: 600;
                min-width: 24px;
                text-align: center;
            }

            .ai-suggestion-type {
                color: #888;
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-bottom: 8px;
            }

            .ai-suggestion-reason {
                color: #ccc;
                line-height: 1.5;
                margin-bottom: 8px;
            }

            .ai-suggestion-path {
                color: #888;
                font-size: 12px;
                font-family: monospace;
                background: rgba(0, 0, 0, 0.3);
                padding: 4px 8px;
                border-radius: 4px;
                word-break: break-all;
            }

            .ai-suggestions-error {
                text-align: center;
                padding: 40px;
                color: #ff6b6b;
            }

            .ai-suggestions-stats {
                margin-top: 20px;
                padding: 15px;
                background: rgba(0, 0, 0, 0.2);
                border-radius: 8px;
                font-size: 12px;
                color: #888;
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
                gap: 10px;
            }

            .ai-suggestions-stat {
                text-align: center;
            }

            .ai-suggestions-stat-value {
                display: block;
                font-size: 18px;
                font-weight: 600;
                color: #4ecdc4;
            }

            .ai-suggestions-trigger {
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: linear-gradient(135deg, #4ecdc4, #44a08d);
                color: white;
                border: none;
                border-radius: 50%;
                width: 60px;
                height: 60px;
                font-size: 24px;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(78, 205, 196, 0.4);
                transition: all 0.3s ease;
                z-index: 9999;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .ai-suggestions-trigger:hover {
                transform: scale(1.1);
                box-shadow: 0 6px 20px rgba(78, 205, 196, 0.6);
            }

            .ai-suggestions-trigger:active {
                transform: scale(0.95);
            }

            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }

            @keyframes slideIn {
                from { 
                    opacity: 0;
                    transform: translate(-50%, -60%);
                }
                to { 
                    opacity: 1;
                    transform: translate(-50%, -50%);
                }
            }

            @keyframes spin {
                to { transform: rotate(360deg); }
            }

            /* Responsive design */
            @media (max-width: 768px) {
                .ai-suggestions-popup {
                    width: 95%;
                    margin: 10px;
                }

                .ai-suggestions-header h2 {
                    font-size: 20px;
                }

                .ai-suggestion-header {
                    flex-direction: column;
                    align-items: flex-start;
                    gap: 5px;
                }

                .ai-suggestions-trigger {
                    bottom: 15px;
                    right: 15px;
                    width: 50px;
                    height: 50px;
                    font-size: 20px;
                }
            }

            /* Custom prompt section styles */
            .ai-suggestions-prompt-section {
                background: #3a3a3a;
                border-bottom: 1px solid #555;
                padding: 15px 20px;
            }

            .prompt-input-container {
                display: flex;
                flex-direction: column;
                gap: 10px;
                margin-bottom: 15px;
            }

            .prompt-input-container label {
                color: #e0e0e0;
                font-weight: 500;
                font-size: 14px;
            }

            .custom-prompt-input {
                background: #2d2d2d;
                border: 1px solid #555;
                border-radius: 6px;
                color: #e0e0e0;
                padding: 8px 12px;
                font-size: 14px;
                flex: 1;
                margin-right: 10px;
            }

            .custom-prompt-input:focus {
                outline: none;
                border-color: #4ecdc4;
                box-shadow: 0 0 0 2px rgba(78, 205, 196, 0.2);
            }

            .analyze-button {
                background: linear-gradient(135deg, #4ecdc4, #44a08d);
                border: none;
                border-radius: 6px;
                color: white;
                padding: 8px 16px;
                font-size: 14px;
                cursor: pointer;
                transition: all 0.2s;
                font-weight: 500;
            }

            .analyze-button:hover {
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(78, 205, 196, 0.3);
            }

            .prompt-examples {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }

            .example-prompt {
                background: #4a4a4a;
                border: 1px solid #666;
                border-radius: 16px;
                padding: 4px 12px;
                font-size: 12px;
                color: #ccc;
                cursor: pointer;
                transition: all 0.2s;
                user-select: none;
            }

            .example-prompt:hover {
                background: #4ecdc4;
                color: white;
                transform: translateY(-1px);
            }

            @media (max-width: 768px) {
                .prompt-input-container {
                    flex-direction: column;
                }
                
                .custom-prompt-input {
                    margin-right: 0;
                    margin-bottom: 10px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    createPopupElements() {
        // Create backdrop
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'ai-suggestions-backdrop';

        // Create popup
        this.popup = document.createElement('div');
        this.popup.className = 'ai-suggestions-popup';

        // Create header
        const header = document.createElement('div');
        header.className = 'ai-suggestions-header';
        header.innerHTML = `
            <h2>
                🤖 AI File Suggestions
            </h2>
            <button class="ai-suggestions-close" title="Close">×</button>
        `;

        // Create content container
        this.content = document.createElement('div');
        this.content.className = 'ai-suggestions-content';

        // Assemble popup
        this.popup.appendChild(header);
        this.popup.appendChild(this.content);
        this.backdrop.appendChild(this.popup);

        // Create trigger button
        this.triggerButton = document.createElement('button');
        this.triggerButton.className = 'ai-suggestions-trigger';
        this.triggerButton.innerHTML = '🧠';
        this.triggerButton.title = 'Get AI suggestions for interesting files';
        console.log('🧠 Created trigger button:', this.triggerButton);

        // Add to document
        document.body.appendChild(this.backdrop);
        document.body.appendChild(this.triggerButton);
        console.log('🧠 Added trigger button to document body');
        
        // Debug visibility
        setTimeout(() => {
            const rect = this.triggerButton.getBoundingClientRect();
            const style = window.getComputedStyle(this.triggerButton);
            console.log('🧠 Brain icon position:', {
                rect,
                display: style.display,
                visibility: style.visibility,
                zIndex: style.zIndex,
                position: style.position,
                isVisible: rect.width > 0 && rect.height > 0
            });
        }, 1000);
    }

    setupEventListeners() {
        // Close button
        this.popup.querySelector('.ai-suggestions-close').addEventListener('click', () => {
            this.hide();
        });

        // Backdrop click to close (with better detection)
        this.backdrop.addEventListener('click', (e) => {
            // Only close if clicking directly on the backdrop, not on the popup or its children
            if (e.target === this.backdrop && !this.popup.contains(e.target)) {
                console.log('🧠 Closing AI popup due to backdrop click');
                this.hide();
            }
        });

        // Trigger button
        this.triggerButton.addEventListener('click', () => {
            this.show();
        });

        // Escape key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isVisible) {
                this.hide();
            }
        });
        
        // Prevent popup from closing when clicking inside it
        this.popup.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    async analyzeWithCustomPrompt() {
        const promptInput = this.content.querySelector('#custom-prompt');
        if (!promptInput) {
            console.error('Custom prompt input not found');
            return;
        }
        
        const customPrompt = promptInput.value.trim();
        
        if (!customPrompt) {
            alert('Please enter a prompt for the AI analysis.');
            return;
        }

        console.log('Analyzing with custom prompt:', customPrompt);
        await this.loadSuggestions(this.currentPath, customPrompt);
    }

    show() {
        this.isVisible = true;
        this.currentPath = window.fileExplorer?.currentPath() || '';
        this.backdrop.style.display = 'block';
        this.showPromptSelection();
    }

    showPromptSelection() {
        const displayPath = this.currentPath || '/mnt/z (root)';
        
        this.content.innerHTML = `
            <div class="ai-prompt-selection">
                <div style="text-align: center; padding: 30px 20px;">
                    <div style="font-size: 48px; margin-bottom: 20px;">🤖</div>
                    <h3 style="margin: 0 0 15px 0; color: #4ecdc4;">How would you like to analyze your files?</h3>
                    <p style="margin: 0 0 30px 0; color: #ccc; font-size: 14px;">
                        📂 Analyzing: ${displayPath}
                    </p>
                    
                    <div style="display: flex; flex-direction: column; gap: 15px; max-width: 400px; margin: 0 auto;">
                        <button class="prompt-option-btn" data-option="normal">
                            <div style="font-size: 20px; margin-bottom: 8px;">🎯 Normal Analysis</div>
                            <div style="font-size: 12px; color: #888;">
                                Find interesting files to read based on content and file types
                            </div>
                        </button>
                        
                        <button class="prompt-option-btn" data-option="custom">
                            <div style="font-size: 20px; margin-bottom: 8px;">✨ Custom Analysis</div>
                            <div style="font-size: 12px; color: #888;">
                                Use your own prompt to find specific types of files
                            </div>
                        </button>
                    </div>
                </div>
            </div>
            
            <style>
                .prompt-option-btn {
                    background: #3a3a3a;
                    border: 2px solid #555;
                    border-radius: 12px;
                    padding: 20px;
                    color: white;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    text-align: left;
                }
                
                .prompt-option-btn:hover {
                    background: #404040;
                    border-color: #4ecdc4;
                    transform: translateY(-2px);
                    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3);
                }
                
                .prompt-option-btn:active {
                    transform: translateY(0);
                }
            </style>
        `;

        // Add click handlers for the prompt options
        this.content.querySelectorAll('.prompt-option-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const option = btn.dataset.option;
                if (option === 'normal') {
                    this.loadSuggestions(); // Use default prompt
                } else if (option === 'custom') {
                    this.showCustomPromptInterface();
                }
            });
        });
    }

    showCustomPromptInterface() {
        this.content.innerHTML = `
            <div class="ai-custom-prompt-interface">
                <div style="text-align: center; padding: 20px;">
                    <div style="font-size: 32px; margin-bottom: 15px;">✨</div>
                    <h3 style="margin: 0 0 20px 0; color: #4ecdc4;">Custom AI Analysis</h3>
                    <p style="margin: 0 0 25px 0; color: #ccc; font-size: 14px;">
                        Tell the AI what kind of files you're looking for
                    </p>
                </div>
                
                <div class="prompt-input-container" style="padding: 0 20px;">
                    <label for="custom-prompt" style="display: block; margin-bottom: 8px; color: #e0e0e0; font-weight: 500;">Your Prompt:</label>
                    <input type="text" 
                           id="custom-prompt" 
                           class="custom-prompt-input" 
                           placeholder="e.g., 'find me the shortest files here', 'show me music from the 80s', 'find documents about AI'"
                           value="find interesting files to read">
                    <div style="margin-top: 10px; text-align: right;">
                        <button class="back-to-selection-btn" style="margin-right: 10px; padding: 8px 16px; background: #666; color: white; border: none; border-radius: 6px; cursor: pointer;">← Back</button>
                        <button class="analyze-button" style="padding: 8px 20px;">🔍 Analyze</button>
                    </div>
                </div>
                
                <div class="prompt-examples" style="padding: 20px;">
                    <div style="color: #888; font-size: 12px; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px;">Examples:</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                        <span class="example-prompt" data-prompt="find me the shortest audio files here">📏 Shortest files</span>
                        <span class="example-prompt" data-prompt="show me music albums from specific artists or bands">🎵 Artist albums</span>
                        <span class="example-prompt" data-prompt="find the most recently modified files">🕒 Recent files</span>
                        <span class="example-prompt" data-prompt="show me files with interesting or unusual names">✨ Unique names</span>
                        <span class="example-prompt" data-prompt="find documents about programming or technology">💻 Tech docs</span>
                        <span class="example-prompt" data-prompt="show me the largest files in this directory">📦 Large files</span>
                    </div>
                </div>
            </div>
        `;

        // Add event listeners
        const customPromptSetup = () => {
            // Analyze button
            this.content.querySelector('.analyze-button').addEventListener('click', () => {
                this.analyzeWithCustomPrompt();
            });

            // Enter key in prompt input
            this.content.querySelector('.custom-prompt-input').addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.analyzeWithCustomPrompt();
                }
            });

            // Back button
            this.content.querySelector('.back-to-selection-btn').addEventListener('click', () => {
                this.showPromptSelection();
            });

            // Example prompt clicks
            this.content.querySelectorAll('.example-prompt').forEach(example => {
                example.addEventListener('click', () => {
                    const promptInput = this.content.querySelector('.custom-prompt-input');
                    promptInput.value = example.getAttribute('data-prompt');
                    this.analyzeWithCustomPrompt();
                });
            });
        };

        customPromptSetup();
    }

    hide() {
        console.log('🧠 AI popup hiding - called from:', new Error().stack);
        this.isVisible = false;
        this.backdrop.style.display = 'none';
    }

    async loadSuggestions(pathOverride = null, customPrompt = null) {
        // Get current path from the file explorer or use override
        const currentPath = pathOverride || window.fileExplorer?.currentPath() || '';
        this.currentPath = currentPath;
        
        const displayPath = currentPath || '/mnt/z (root)';
        
        // Show loading state with current directory
        this.content.innerHTML = `
            <div class="ai-suggestions-loading">
                <div class="ai-suggestions-spinner"></div>
                <div>Analyzing files with AI...</div>
                <div style="font-size: 14px; margin-top: 10px; color: #4ecdc4; font-weight: 500;">
                    📂 Analyzing: ${displayPath}
                </div>
                <div style="font-size: 12px; margin-top: 5px; color: #666;">
                    This may take a moment while we examine your files
                </div>
            </div>
        `;

        try {
            
            // Use custom prompt or default
            const contextPrompt = customPrompt || 'User is browsing files and looking for interesting content to read';
            
            const response = await window.authManager.authenticatedFetch('/api/analyze-files', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    path: currentPath,
                    context: contextPrompt
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.message || 'Analysis failed');
            }

            this.displaySuggestions(data);
            
        } catch (error) {
            console.error('Error loading AI suggestions:', error);
            this.showError(error.message);
        }
    }

    displaySuggestions(data) {
        const { suggestions, summary, stats, totalFiles, filteredFiles } = data;

        if (suggestions.length === 0) {
            this.content.innerHTML = `
                <div class="ai-suggestions-error">
                    <div style="font-size: 48px; margin-bottom: 20px;">📭</div>
                    <div>No particularly interesting files found in this directory.</div>
                    <div style="font-size: 14px; margin-top: 10px; color: #888;">
                        Try navigating to a directory with documents, books, or other readable content.
                    </div>
                </div>
            `;
            return;
        }

        let html = '';

        // Add summary if available
        if (summary) {
            html += `
                <div class="ai-suggestions-summary">
                    <strong>📝 Analysis Summary:</strong><br>
                    ${summary}
                </div>
            `;
        }

        // Add suggestions
        html += '<div class="ai-suggestions-list">';
        
        suggestions.forEach(suggestion => {
            const scoreColor = suggestion.engagement_score >= 8 ? '#4ecdc4' : 
                              suggestion.engagement_score >= 6 ? '#ffd93d' : '#ff9f43';
            
            html += `
                <div class="ai-suggestion-item" data-path="${suggestion.path}">
                    <div class="ai-suggestion-header">
                        <div class="ai-suggestion-name">${suggestion.name}</div>
                        <div class="ai-suggestion-score" style="background: ${scoreColor}">
                            ${suggestion.engagement_score}/10
                        </div>
                    </div>
                    <div class="ai-suggestion-type">${suggestion.content_type}</div>
                    <div class="ai-suggestion-reason">${suggestion.reason}</div>
                    <div class="ai-suggestion-path">${suggestion.path}</div>
                </div>
            `;
        });
        
        html += '</div>';

        // Add stats if available
        if (stats || totalFiles !== undefined) {
            html += `
                <div class="ai-suggestions-stats">
                    <div class="ai-suggestions-stat">
                        <span class="ai-suggestions-stat-value">${totalFiles || 'N/A'}</span>
                        <span>Total Files</span>
                    </div>
                    <div class="ai-suggestions-stat">
                        <span class="ai-suggestions-stat-value">${filteredFiles || 'N/A'}</span>
                        <span>Analyzed</span>
                    </div>
                    <div class="ai-suggestions-stat">
                        <span class="ai-suggestions-stat-value">${suggestions.length}</span>
                        <span>Suggestions</span>
                    </div>
                    ${stats ? `
                    <div class="ai-suggestions-stat">
                        <span class="ai-suggestions-stat-value">${Math.round(stats.total_time || 0)}s</span>
                        <span>Analysis Time</span>
                    </div>
                    ` : ''}
                </div>
            `;
        }

        this.content.innerHTML = html;

        // Add click handlers for suggestions
        this.content.querySelectorAll('.ai-suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                const path = item.dataset.path;
                this.openSuggestedFile(path);
            });
        });
    }

    showError(message) {
        this.content.innerHTML = `
            <div class="ai-suggestions-error">
                <div style="font-size: 48px; margin-bottom: 20px;">⚠️</div>
                <div>Failed to analyze files</div>
                <div style="font-size: 14px; margin-top: 10px; color: #888;">
                    ${message}
                </div>
                <button onclick="window.aiSuggestions.loadSuggestions()" 
                        style="margin-top: 20px; padding: 10px 20px; background: #4ecdc4; color: white; border: none; border-radius: 6px; cursor: pointer;">
                    Try Again
                </button>
            </div>
        `;
    }

    openSuggestedFile(filePath) {
        // Navigate to the file using the existing file explorer functionality
        if (window.fileExplorer) {
            // Parse the path to get directory and filename
            const pathParts = filePath.split('/');
            const fileName = pathParts.pop();
            const dirPath = pathParts.join('/');

            // Update the file explorer to show the directory containing the file
            if (dirPath) {
                window.fileExplorer.loadFiles(dirPath);
            }

            // Give the file list time to load, then select the file
            setTimeout(() => {
                // Find and click the file in the list
                const fileItems = document.querySelectorAll('.file-item .file-name');
                for (const item of fileItems) {
                    if (item.textContent === fileName) {
                        item.closest('.file-item').click();
                        break;
                    }
                }
            }, 500);
        }

        // Close the suggestions popup
        this.hide();
    }
}

// Initialize the AI suggestions manager when the page loads
function initializeAISuggestions() {
    console.log('🤖 Initializing AI Suggestions Manager...');
    try {
        window.aiSuggestions = new AISuggestionsManager();
        console.log('✅ AI Suggestions Manager initialized successfully');
        return true;
    } catch (error) {
        console.error('❌ Failed to initialize AI Suggestions Manager:', error);
        return false;
    }
}

// Try to initialize immediately
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAISuggestions);
} else {
    // DOM is already ready
    initializeAISuggestions();
}

// Also try initializing after a delay in case DOM isn't fully ready
setTimeout(() => {
    if (!window.aiSuggestions) {
        console.log('🤖 Retrying AI Suggestions Manager initialization...');
        initializeAISuggestions();
    }
}, 2000);

// Additional check to ensure the trigger button is visible
setInterval(() => {
    if (window.aiSuggestions && window.aiSuggestions.triggerButton) {
        const button = window.aiSuggestions.triggerButton;
        const rect = button.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0;
        
        if (!isVisible) {
            console.log('🔧 AI Suggestions button not visible, forcing visibility');
            button.style.display = 'flex';
            button.style.visibility = 'visible';
            button.style.opacity = '1';
        }
    }
}, 5000);