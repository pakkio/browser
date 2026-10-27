class ComicRenderer {
    constructor() {
        this.handleKeyDown = null;
        this.handleWheel = null;
        this.currentPage = 1;
        this.totalPages = null;
        this.currentFilePath = null;
        this.abortController = null;
        this.pageCache = new Map();
        this.preloadQueue = [];
        this.isFullscreen = false;
        this.originalParent = null;
        this.fullscreenContainer = null;
        this.isTruncatedView = false;
        this.retryAttempts = new Map(); // Track retry attempts per page
        this.isCleaningUp = false; // Flag to prevent operations during cleanup
        this.singlePage = false; // '1' key: show one page instead of a spread
        this.panelMode = false; // 'n' key: step through panels of the current page
        this.panels = null;
        this.panelIndex = -1;
    }

    isSingle() {
        return this.singlePage || this.panelMode;
    }

    ensureModeStyles() {
        if (document.getElementById('comic-mode-styles')) return;
        const style = document.createElement('style');
        style.id = 'comic-mode-styles';
        style.textContent = `
            .comic-container.comic-single #page-right { display: none !important; }
            .comic-container.comic-single #page-left { max-width: 100% !important; flex: none !important; }
            .comic-container.comic-panel .pages-container { overflow: hidden !important; }
            .comic-container.comic-panel #page-left { transform-origin: 0 0; transition: transform 0.25s ease; }
        `;
        document.head.appendChild(style);
    }

    applyModeClasses() {
        const container = document.querySelector('.comic-container');
        if (!container) return;
        container.classList.toggle('comic-single', this.isSingle());
        container.classList.toggle('comic-panel', this.panelMode);
    }

    async toggleSinglePage() {
        this.singlePage = !this.singlePage;
        if (this.panelMode) {
            this.exitPanelMode();
        }
        this.applyModeClasses();
        this.updatePageInfo();
        await this.loadPage(this.currentPage);
    }

    /**
     * Split a page image into panels by finding gutters (rows/columns that match the
     * page background) with a recursive XY-cut. Returns rects as fractions of the image,
     * in reading order (top to bottom, left to right).
     */
    detectPanels(img) {
        const full = [{ x: 0, y: 0, w: 1, h: 1 }];
        const nw = img.naturalWidth, nh = img.naturalHeight;
        if (!nw || !nh) return full;

        const scale = Math.min(1, 500 / Math.max(nw, nh));
        const w = Math.max(1, Math.round(nw * scale));
        const h = Math.max(1, Math.round(nh * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        let data;
        try {
            data = ctx.getImageData(0, 0, w, h).data;
        } catch (e) {
            return full;
        }

        // Background colour = most common colour on the outer frame of the page
        const bins = new Map();
        const sample = (x, y) => {
            const i = (y * w + x) * 4;
            const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
            bins.set(key, (bins.get(key) || 0) + 1);
        };
        for (let x = 0; x < w; x++) { sample(x, 0); sample(x, h - 1); }
        for (let y = 0; y < h; y++) { sample(0, y); sample(w - 1, y); }
        let bgKey = 0, bgCount = -1;
        for (const [key, count] of bins) {
            if (count > bgCount) { bgKey = key; bgCount = count; }
        }
        const br = ((bgKey >> 8) & 15) * 16 + 8;
        const bg = ((bgKey >> 4) & 15) * 16 + 8;
        const bb = (bgKey & 15) * 16 + 8;

        const isBg = new Uint8Array(w * h);
        for (let p = 0; p < w * h; p++) {
            const i = p * 4;
            const diff = Math.abs(data[i] - br) + Math.abs(data[i + 1] - bg) + Math.abs(data[i + 2] - bb);
            isBg[p] = diff <= 60 ? 1 : 0;
        }

        const rowIsGutter = (y, x0, x1) => {
            let n = 0;
            for (let x = x0; x < x1; x++) n += isBg[y * w + x];
            return n >= (x1 - x0) * 0.98;
        };
        const colIsGutter = (x, y0, y1) => {
            let n = 0;
            for (let y = y0; y < y1; y++) n += isBg[y * w + x];
            return n >= (y1 - y0) * 0.98;
        };

        const minGapY = Math.max(2, Math.round(h * 0.008));
        const minGapX = Math.max(2, Math.round(w * 0.008));
        const minW = w * 0.06, minH = h * 0.06;
        const out = [];

        // First gutter run of at least minGap inside [from, to); returns [start, end) or null
        const findGap = (from, to, isGutter, minGap) => {
            let start = -1;
            for (let i = from; i <= to; i++) {
                const g = i < to && isGutter(i);
                if (g && start < 0) start = i;
                if (!g && start >= 0) {
                    if (i - start >= minGap) return [start, i];
                    start = -1;
                }
            }
            return null;
        };

        const cut = (x0, y0, x1, y1, depth) => {
            // Trim gutters from the edges
            while (y0 < y1 && rowIsGutter(y0, x0, x1)) y0++;
            while (y1 > y0 && rowIsGutter(y1 - 1, x0, x1)) y1--;
            while (x0 < x1 && colIsGutter(x0, y0, y1)) x0++;
            while (x1 > x0 && colIsGutter(x1 - 1, y0, y1)) x1--;
            if (x1 - x0 < minW || y1 - y0 < minH) return;

            if (depth < 8) {
                const gapY = findGap(y0, y1, (y) => rowIsGutter(y, x0, x1), minGapY);
                if (gapY) {
                    cut(x0, y0, x1, gapY[0], depth + 1);
                    cut(x0, gapY[1], x1, y1, depth + 1);
                    return;
                }
                const gapX = findGap(x0, x1, (x) => colIsGutter(x, y0, y1), minGapX);
                if (gapX) {
                    cut(x0, y0, gapX[0], y1, depth + 1);
                    cut(gapX[1], y0, x1, y1, depth + 1);
                    return;
                }
            }
            out.push({ x: x0 / w, y: y0 / h, w: (x1 - x0) / w, h: (y1 - y0) / h });
        };

        cut(0, 0, w, h, 0);
        return out.length >= 2 ? out : full;
    }

    async enterPanelMode() {
        const img = document.getElementById('page-left');
        if (!img || !img.src) return;

        this.panelMode = true;
        this.applyModeClasses();
        this.updatePageInfo();
        // Re-layout in single-page mode (also fetches nothing extra, the left page is cached)
        await this.loadPage(this.currentPage);
        await this.preparePanels();
        this.showPanel(0);
    }

    async preparePanels() {
        const img = document.getElementById('page-left');
        if (!img) return;
        try {
            await img.decode();
        } catch (e) {
            // Image failed to decode; fall back to whole-page view below
        }
        this.panels = this.detectPanels(img);
        this.panelIndex = -1;
    }

    exitPanelMode() {
        const img = document.getElementById('page-left');
        if (img) img.style.transform = '';
        this.panelMode = false;
        this.panels = null;
        this.panelIndex = -1;
        this.applyModeClasses();
    }

    async nextPanel() {
        if (!this.panelMode) {
            await this.enterPanelMode();
            return;
        }
        if (this.panels && this.panelIndex + 1 < this.panels.length) {
            this.showPanel(this.panelIndex + 1);
            return;
        }
        // Past the last panel: continue on the next page, starting at its first panel
        if (this.totalPages && this.currentPage >= this.totalPages) return;
        await this.loadPage(this.currentPage + 1);
        await this.preparePanels();
        this.showPanel(0);
    }

    async firstPanel() {
        if (!this.panelMode) {
            await this.enterPanelMode();
            return;
        }
        this.showPanel(0);
    }

    async previousPanel() {
        if (!this.panelMode) return;
        if (this.panelIndex > 0) {
            this.showPanel(this.panelIndex - 1);
            return;
        }
        // Before the first panel: go to the last panel of the previous page
        if (this.currentPage <= 1) return;
        await this.loadPage(this.currentPage - 1);
        await this.preparePanels();
        this.showPanel(this.panels.length - 1);
    }

    showPanel(index) {
        const img = document.getElementById('page-left');
        const container = img && img.parentElement;
        if (!img || !container || !this.panels) return;
        this.panelIndex = Math.max(0, Math.min(index, this.panels.length - 1));
        const panel = this.panels[this.panelIndex];

        // Measure the untransformed image box
        const previous = img.style.transition;
        img.style.transition = 'none';
        img.style.transform = '';
        const imgRect = img.getBoundingClientRect();
        const boxRect = container.getBoundingClientRect();
        img.style.transition = previous;

        const pad = 12;
        const availW = boxRect.width - pad * 2;
        const availH = boxRect.height - pad * 2;
        const panelW = panel.w * imgRect.width;
        const panelH = panel.h * imgRect.height;
        if (!panelW || !panelH) return;

        const scale = Math.min(availW / panelW, availH / panelH);
        const centerX = (panel.x + panel.w / 2) * imgRect.width;
        const centerY = (panel.y + panel.h / 2) * imgRect.height;
        const tx = boxRect.left + boxRect.width / 2 - imgRect.left - centerX * scale;
        const ty = boxRect.top + boxRect.height / 2 - imgRect.top - centerY * scale;
        img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;

        const statusElement = document.querySelector('#comic-status');
        if (statusElement) {
            statusElement.textContent = `Panel ${this.panelIndex + 1}/${this.panels.length}`;
        }
    }

    cleanup() {
        // Mark as cleaning up to prevent any new operations
        this.isCleaningUp = true;
        
        if (this.handleKeyDown) {
            document.removeEventListener('keydown', this.handleKeyDown);
            this.handleKeyDown = null;
        }
        if (this.handleWheel) {
            document.removeEventListener('wheel', this.handleWheel);
            this.handleWheel = null;
        }
        
        // Exit fullscreen if active
        if (this.isFullscreen) {
            this.exitFullscreen();
        }
        
        // Clear preload queue first to prevent new fetch attempts
        this.preloadQueue = [];
        
        if (this.abortController) {
            this.abortController.abort('cleanup');
            this.abortController = null;
        }
        
        for (const url of this.pageCache.values()) {
            URL.revokeObjectURL(url);
        }
        this.pageCache.clear();
        this.currentFilePath = null;
        this.retryAttempts.clear();
        this.panelMode = false;
        this.panels = null;
        this.panelIndex = -1;
    }

    async render(filePath, fileName, contentCode, contentOther, options = {}) {
        try {
            this.cleanup();
            this.isCleaningUp = false; // Reset cleanup flag for new render
            this.currentPage = 1;
            this.totalPages = null;
            this.currentFilePath = filePath; // Store the file path for later use
            this.abortController = new AbortController();
            this.fileName = fileName; // Store filename for error messages

            const comicContainer = this.createComicContainer();
            const { controls, pagesContainer } = this.createUIElements(comicContainer);

            contentOther.innerHTML = '';
            contentOther.appendChild(comicContainer);
            this.ensureModeStyles();
            this.applyModeClasses();
            contentOther.style.display = 'block';
            
            this.setupEventHandlers(controls, filePath);
            this.setupKeyboardNavigation();
            
            // Show prominent loading popup
            if (window.debugConsole) {
                window.debugConsole.showProgress('Loading comic...', 10);
            }
            
            try {
                await this.loadComicInfo(filePath);
                await this.loadPage(1);
                
                // Hide loading popup on success
                if (window.debugConsole) {
                    window.debugConsole.updateProgress('Comic ready', 100);
                    setTimeout(() => {
                        window.debugConsole.hideProgress();
                    }, 500);
                }
            } catch (error) {
                window.logger.error('Error loading comic:', error);
                this.showComicError(controls, pagesContainer, error, fileName, filePath);
                
                // Hide loading popup on error
                if (window.debugConsole) {
                    window.debugConsole.hideProgress();
                }
            }
        } catch (error) {
            window.logger.error(`Fatal error in ComicRenderer for ${fileName}:`, error);
            throw new Error(`Comic rendering failed: ${error.message}`);
        }
    }

    createComicContainer() {
        const comicContainer = document.createElement('div');
        comicContainer.className = 'comic-container';
        comicContainer.style.cssText = `height: 100%; display: flex; flex-direction: column;`;
        return comicContainer;
    }

    createUIElements(comicContainer) {
        const controls = this.createControls();
        const pagesContainer = this.createPagesContainer();
        
        comicContainer.appendChild(controls);
        comicContainer.appendChild(pagesContainer);
        
        return { controls, pagesContainer };
    }

    createControls() {
        const controls = document.createElement('div');
        controls.className = 'comic-controls';
        controls.style.cssText = `display: flex; align-items: center; margin-bottom: 10px; flex-shrink: 0;`;
        controls.innerHTML = `
            <button id="comic-prev">Previous</button>
            <span id="comic-page-info">Page 1</span>
            <button id="comic-next">Next</button>
            <input type="number" id="comic-page-jump" placeholder="Page" style="width: 60px; margin-left: 20px;">
            <button id="comic-jump-btn" style="margin-left: 5px;">Go</button>
            <button id="comic-fullscreen" style="margin-left: 20px; background: #4CAF50; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;" title="Toggle Fullscreen (F key)">📺 Fullscreen</button>
            <span id="comic-status" style="margin-left: 10px; font-style: italic;">Loading comic info...</span>
        `;
        return controls;
    }

    createPagesContainer() {
        const pagesContainer = document.createElement('div');
        pagesContainer.className = 'pages-container';
        pagesContainer.style.cssText = `
            display: flex;
            gap: 10px;
            flex: 1;
            align-items: center;
            justify-content: center;
            min-height: 0;
        `;
        
        const pageImg1 = this.createPageImage('page-left');
        const pageImg2 = this.createPageImage('page-right');
        
        pagesContainer.appendChild(pageImg1);
        pagesContainer.appendChild(pageImg2);
        
        return pagesContainer;
    }

    createPageImage(id) {
        const pageImg = document.createElement('img');
        pageImg.id = id;
        pageImg.style.cssText = `
            max-width: 48%;
            max-height: calc(100% - 60px);
            border: 1px solid #ccc;
            object-fit: contain;
            flex: 1;
        `;
        return pageImg;
    }

    showComicError(controls, pagesContainer, error, fileName, filePath) {
        const statusElement = controls.querySelector('#comic-status');
        if (statusElement) {
            statusElement.textContent = `Error: ${error.message}`;
        }

        // Check if this is a file-not-found error - trigger auto-refresh
        if (this.isFileNotFoundError(error)) {
            this.handleFileNotFound(fileName, pagesContainer);
            return;
        }

        // Clear pages container and show error
        pagesContainer.innerHTML = '';
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 300px;
            padding: 30px;
            background: rgba(255, 0, 0, 0.1);
            border: 2px dashed rgba(255, 0, 0, 0.3);
            border-radius: 8px;
            color: #ff6b6b;
            text-align: center;
            margin: 20px;
        `;

        const friendlyError = this.getUserFriendlyErrorMessage(error);
        
        errorDiv.innerHTML = `
            <div style="font-size: 64px; margin-bottom: 20px;">📚</div>
            <h3 style="margin: 0 0 15px 0; color: #ff6b6b;">
                ${friendlyError.title}
            </h3>
            <p style="margin: 10px 0; font-size: 14px;">
                <strong>File:</strong> ${fileName}
            </p>
            <p style="margin: 15px 0; font-size: 13px; opacity: 0.9; max-width: 500px; line-height: 1.4;">
                ${friendlyError.message}
            </p>
            <div style="margin: 20px 0; text-align: left; max-width: 500px;">
                <h4 style="color: #4ecdc4; margin: 0 0 10px 0; font-size: 14px;">Suggestions:</h4>
                <ul style="margin: 0; padding-left: 20px; font-size: 12px; opacity: 0.8; line-height: 1.5;">
                    ${friendlyError.suggestions.map(suggestion => `<li style="margin-bottom: 5px;">${suggestion}</li>`).join('')}
                </ul>
            </div>
            <details style="margin: 15px 0; text-align: left; max-width: 500px;">
                <summary style="cursor: pointer; color: #ff9999; text-align: center;">Show error details</summary>
                <pre style="margin: 10px 0; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 4px; font-size: 11px; overflow-x: auto; text-align: left;">${error.message || error.toString()}</pre>
            </details>
            <div style="margin-top: 20px;">
                ${error.message && (error.message.includes('timeout') || error.message.includes('heavy load')) ? 
                    `<button onclick="window.location.reload()" 
                            style="padding: 10px 20px; background: #f39c12; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px;">
                        ⏱️ Try Again
                    </button>` : ''
                }
                <a href="/files?path=${encodeURIComponent(filePath)}" 
                   download="${fileName}"
                   style="display: inline-block; padding: 10px 20px; background: #4ecdc4; color: white; text-decoration: none; border-radius: 4px; margin-right: 10px;">
                    📥 Download Comic
                </a>
                <button onclick="location.reload()" 
                        style="padding: 10px 20px; background: #666; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    🔄 Reload Page
                </button>
            </div>
        `;
        
        pagesContainer.appendChild(errorDiv);
    }

    isComicCorruptionError(error) {
        const errorMessage = (error.message || error.toString()).toLowerCase();
        const corruptionIndicators = [
            'corrupt', 'corrupted', 'damaged', 'invalid', 'malformed',
            'unexpected end', 'truncated', 'bad format', 'parse error',
            'failed to load', 'network error', 'decode error', 'format error',
            'cannot extract', 'archive error', 'zip error', 'rar error',
            'password', 'encrypted', 'access denied', 'permission denied',
            'timeout', 'very large', 'heavy load', 'insufficient size'
        ];
        return corruptionIndicators.some(indicator => errorMessage.includes(indicator));
    }

    isFileNotFoundError(error) {
        const errorMessage = (error.message || error.toString()).toLowerCase();
        const notFoundIndicators = [
            'not found', '404', 'enoent', 'no such file', 'does not exist',
            'file not found', 'inaccessible'
        ];
        return notFoundIndicators.some(indicator => errorMessage.includes(indicator));
    }

    handleFileNotFound(fileName, pagesContainer) {
        window.logger.info(`[ComicRenderer] File not found: ${fileName}, triggering directory refresh`);
        
        // Show toast notification
        if (typeof showToast === 'function') {
            showToast(`File "${fileName}" not found. The file may have been renamed, moved, or deleted. Refreshing...`, 'info');
        }
        
        // Show a message in the container
        pagesContainer.innerHTML = '';
        const refreshDiv = document.createElement('div');
        refreshDiv.style.cssText = `
            padding: 20px;
            margin: 20px;
            background: rgba(33, 150, 243, 0.1);
            border: 1px solid rgba(33, 150, 243, 0.3);
            border-radius: 8px;
            color: #64b5f6;
            font-family: monospace;
            text-align: center;
        `;
        refreshDiv.innerHTML = `
            <h3 style="color: #64b5f6; margin: 0 0 15px 0;">🔄 File Changed</h3>
            <p style="margin: 10px 0; font-size: 14px;">
                <strong>${fileName}</strong> was not found.
            </p>
            <p style="margin: 10px 0; font-size: 12px; opacity: 0.8;">
                The file may have been renamed, moved, or deleted. Refreshing directory...
            </p>
        `;
        pagesContainer.appendChild(refreshDiv);
        
        // Trigger directory refresh after a brief delay
        setTimeout(() => {
            if (window.fileExplorer && window.fileExplorer.loadFiles) {
                const currentPath = window.fileExplorer.currentPath();
                window.logger.info(`[ComicRenderer] Refreshing directory: ${currentPath}`);
                window.fileExplorer.loadFiles(currentPath);
            }
        }, 500);
    }

    getUserFriendlyErrorMessage(error) {
        const errorMessage = (error.message || error.toString()).toLowerCase();
        
        // Check for file not found errors
        if (this.isFileNotFoundError(error)) {
            return {
                title: 'File Not Found',
                message: 'The comic file could not be found. It may have been renamed, moved, or deleted.',
                suggestions: [
                    'The directory will refresh automatically',
                    'Check if the file was moved to another location',
                    'Try refreshing the file list manually'
                ]
            };
        }
        
        if (errorMessage.includes('timeout')) {
            if (errorMessage.includes('very large') || errorMessage.includes('heavy load')) {
                return {
                    title: 'Loading Timeout',
                    message: 'The comic file is very large or the system is busy. This can happen with high-resolution comics or when processing multiple files.',
                    suggestions: [
                        'Wait a moment and try again',
                        'Try a smaller comic file',
                        'Check if the file is corrupted',
                        'Download the file to view locally'
                    ]
                };
            }
            return {
                title: 'Processing Timeout',
                message: 'The comic file took too long to process. This usually indicates a corrupted or very large file.',
                suggestions: [
                    'Try again - temporary issues often resolve',
                    'Check if the file opens in other comic readers',
                    'Re-download the file if possible',
                    'Convert to a different format (CBZ recommended)'
                ]
            };
        }
        
        if (errorMessage.includes('corrupted') || errorMessage.includes('invalid') || errorMessage.includes('damaged')) {
            return {
                title: 'Corrupted Archive',
                message: 'The comic archive appears to be damaged or incomplete.',
                suggestions: [
                    'Re-download the file from the original source',
                    'Try opening with a different comic reader to verify',
                    'Check if the file was completely downloaded',
                    'Contact the source for a replacement file'
                ]
            };
        }
        
        if (errorMessage.includes('password') || errorMessage.includes('encrypted')) {
            return {
                title: 'Password Protected',
                message: 'This comic archive is password protected and cannot be opened.',
                suggestions: [
                    'Obtain the password from the file source',
                    'Extract the archive manually with the password',
                    'Convert to an unprotected format'
                ]
            };
        }
        
        if (errorMessage.includes('network') || errorMessage.includes('connection')) {
            return {
                title: 'Network Error',
                message: 'There was a problem connecting to the server or downloading the comic.',
                suggestions: [
                    'Check your internet connection',
                    'Try refreshing the page',
                    'Wait a moment and try again',
                    'Contact support if the problem persists'
                ]
            };
        }
        
        // Default error message for unknown errors
        return {
            title: 'Comic Loading Error',
            message: 'An unexpected error occurred while loading the comic.',
            suggestions: [
                'Try refreshing the page',
                'Check if the file is accessible',
                'Try a different comic file',
                'Report this issue if it persists'
            ]
        };
    }

    setupEventHandlers(controls, filePath) {
        const prevBtn = controls.querySelector('#comic-prev');
        const nextBtn = controls.querySelector('#comic-next');
        const jumpInput = controls.querySelector('#comic-page-jump');
        const jumpBtn = controls.querySelector('#comic-jump-btn');
        const fullscreenBtn = controls.querySelector('#comic-fullscreen');

        prevBtn.addEventListener('click', () => this.previousPage());
        nextBtn.addEventListener('click', () => this.nextPage());
        
        jumpBtn.addEventListener('click', () => {
            const page = parseInt(jumpInput.value);
            if (page && page > 0) {
                this.loadPage(page);
            }
        });

        jumpInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                jumpBtn.click();
            }
        });
        
        fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    }

    setupKeyboardNavigation() {
        this.handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT') return;
            
            switch (e.key) {
                case 'ArrowLeft':
                case 'a':
                    e.preventDefault();
                    this.previousPage();
                    break;
                case 'ArrowRight':
                case 'd':
                    e.preventDefault();
                    this.nextPage();
                    break;
                case 'Home':
                    e.preventDefault();
                    this.loadPage(1);
                    break;
                case 'End':
                    e.preventDefault();
                    if (this.totalPages) this.loadPage(this.totalPages);
                    break;
                case 'f':
                case 'F':
                    e.preventDefault();
                    this.toggleFullscreen();
                    break;
                case 'Escape':
                    e.preventDefault();
                    if (this.isFullscreen) {
                        this.exitFullscreen();
                    } else if (this.panelMode) {
                        this.exitPanelMode();
                        this.loadPage(this.currentPage);
                    }
                    break;
                case 'b':
                case 'B':
                    e.preventDefault();
                    if (this.isFullscreen) {
                        this.toggleTruncatedView();
                    }
                    break;
                case '1':
                    e.preventDefault();
                    this.toggleSinglePage();
                    break;
                case 'n':
                case 'N':
                    e.preventDefault();
                    this.nextPanel();
                    break;
                case 'p':
                case 'P':
                    e.preventDefault();
                    this.previousPanel();
                    break;
                case '0':
                    e.preventDefault();
                    this.firstPanel();
                    break;
                case 'r': case 'g': case 'y': case 'c':
                case '2': case '3': case '4': case '5':
                    if (typeof handleAnnotationShortcut === 'function') {
                        handleAnnotationShortcut(e.key);
                    }
                    break;
            }
        };

        this.handleWheel = (e) => {
            if (e.deltaY > 0) {
                this.nextPage();
            } else if (e.deltaY < 0) {
                this.previousPage();
            }
        };

        document.addEventListener('keydown', this.handleKeyDown);
        document.addEventListener('wheel', this.handleWheel);
    }

    async loadComicInfo(filePath) {
        try {
            window.logger.info(`[ComicRenderer] Loading comic info for: ${filePath}`);
            
            if (window.debugConsole) {
                window.debugConsole.updateProgress('Reading comic archive...', 30);
            }
            
            const response = await fetch(`/api/comic-info?path=${encodeURIComponent(filePath)}`);
            
            if (!response.ok) {
                const errorText = await response.text();
                window.logger.error(`[ComicRenderer] Comic info HTTP error: ${response.status} - ${errorText}`);
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const info = await response.json();
            window.logger.info(`[ComicRenderer] Comic info received:`, info);
            
            if (window.debugConsole) {
                window.debugConsole.updateProgress(`Comic loaded - ${info.pages} pages`, 60);
            }
            
            this.totalPages = info.pages;
            this.updatePageInfo();
            
            const statusElement = document.querySelector('#comic-status');
            if (statusElement) {
                statusElement.textContent = `${info.format} - ${info.pages} pages`;
            }
        } catch (error) {
            window.logger.error('[ComicRenderer] Failed to load comic info:', error);
            throw error;
        }
    }

    async loadPage(page) {
        // Check if we're in cleanup state
        if (this.isCleaningUp || !this.currentFilePath) {
            window.logger.info(`[ComicRenderer] Skipping loadPage(${page}) - renderer is cleaning up or no file path`);
            return;
        }
        
        if (page < 1) page = 1;
        if (this.totalPages && page > this.totalPages) {
            page = this.totalPages;
        }
        this.currentPage = page;
        
        const pageImg1 = document.getElementById('page-left');
        const pageImg2 = document.getElementById('page-right');
        const statusElement = document.querySelector('#comic-status');
        
        // Check if DOM elements exist (they may have been removed during cleanup)
        if (!pageImg1 || !pageImg2) {
            window.logger.info(`[ComicRenderer] Skipping loadPage(${page}) - page elements not found`);
            return;
        }
        
        const leftPage = page;
        const rightPage = page + 1;
        
        try {
            if (statusElement) statusElement.innerHTML = `⏳ Loading page ${leftPage}...`;
            pageImg1.style.opacity = '0.5';
            pageImg2.style.opacity = '0.5';
            
            // Show brief loading popup for page navigation (only if not initial load)
            if (window.debugConsole && page > 1) {
                window.debugConsole.showProgress(`Loading page ${leftPage}...`, 40);
            }
            
            const leftUrl = this.pageCache.has(leftPage) ? 
                this.pageCache.get(leftPage) : 
                await this.fetchAndCachePage(leftPage);
            
            // Check if we're still valid after async operation
            if (this.isCleaningUp || !this.currentFilePath) {
                window.logger.info(`[ComicRenderer] Aborting loadPage(${page}) - renderer cleaned up during fetch`);
                return;
            }
            
            if (leftUrl) {
                pageImg1.onload = () => {
                    window.logger.info(`[ComicRenderer] Page ${leftPage} image loaded successfully`);
                    pageImg1.style.opacity = '1';
                };
                pageImg1.onerror = (e) => {
                    window.logger.error(`[ComicRenderer] Failed to load image for page ${leftPage}`, e);
                    pageImg1.style.opacity = '0.3';
                    pageImg1.alt = `Failed to load page ${leftPage}`;
                    pageImg1.title = `Page ${leftPage} failed to load - may be corrupted`;
                };
                pageImg1.src = leftUrl;
                pageImg1.style.display = 'block';
            }
            
            if (!this.isSingle() && this.totalPages && rightPage <= this.totalPages) {
                if (statusElement) statusElement.innerHTML = `⏳ Loading page ${rightPage}...`;
                const rightUrl = this.pageCache.has(rightPage) ? 
                    this.pageCache.get(rightPage) : 
                    await this.fetchAndCachePage(rightPage);
                
                // Check if we're still valid after async operation
                if (this.isCleaningUp || !this.currentFilePath) {
                    window.logger.info(`[ComicRenderer] Aborting loadPage(${page}) - renderer cleaned up during right page fetch`);
                    return;
                }
                
                if (rightUrl) {
                    pageImg2.onload = () => {
                        window.logger.info(`[ComicRenderer] Page ${rightPage} image loaded successfully`);
                        pageImg2.style.opacity = '1';
                    };
                    pageImg2.onerror = (e) => {
                        window.logger.error(`[ComicRenderer] Failed to load image for page ${rightPage}`, e);
                        pageImg2.style.opacity = '0.3';
                        pageImg2.alt = `Failed to load page ${rightPage}`;
                        pageImg2.title = `Page ${rightPage} failed to load - may be corrupted`;
                    };
                    pageImg2.src = rightUrl;
                    pageImg2.style.display = 'block';
                }
            } else {
                pageImg2.style.display = 'none';
            }
            
            if (statusElement) statusElement.textContent = '';
            this.updatePageInfo();
            this.preloadAdjacentPages(leftPage);
            
            // Hide loading popup for page navigation
            if (window.debugConsole && page > 1) {
                setTimeout(() => {
                    window.debugConsole.hideProgress();
                }, 300);
            }
            
        } catch (error) {
            // Don't show error if we're cleaning up
            if (this.isCleaningUp) {
                window.logger.info(`[ComicRenderer] loadPage(${page}) error suppressed during cleanup`);
                return;
            }
            
            window.logger.error('Error loading page:', error);
            if (statusElement) statusElement.textContent = `Error loading page: ${error?.message || 'Unknown error'}`;
            
            // Hide loading popup on error
            if (window.debugConsole && page > 1) {
                window.debugConsole.hideProgress();
            }
        }
    }

    async fetchAndCachePage(page) {
        try {
            // Check if we've been cleaned up before starting
            if (this.isCleaningUp || !this.currentFilePath || !this.abortController || this.abortController.signal.aborted) {
                window.logger.info(`[ComicRenderer] Skipping fetch for page ${page} - renderer was cleaned up`);
                return null;
            }
            
            const filePath = this.getCurrentFilePath();
            if (!filePath) {
                window.logger.info(`[ComicRenderer] Skipping fetch for page ${page} - no file path`);
                return null;
            }
            
            window.logger.info(`[ComicRenderer] Fetching page ${page} from file: ${filePath}`);
            
            const response = await fetch(`/comic-preview?path=${encodeURIComponent(filePath)}&page=${page}`, {
                signal: this.abortController?.signal,
                timeout: 30000 // 30 second timeout
            });
            
            window.logger.info(`[ComicRenderer] Response status: ${response.status}, Content-Type: ${response.headers.get('Content-Type')}`);
            
            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                window.logger.error(`[ComicRenderer] HTTP error: ${response.status} - ${errorText}`);
                
                // Provide more specific error messages
                let errorMessage;
                if (response.status === 404) {
                    errorMessage = `Page ${page} not found in comic archive`;
                } else if (response.status === 429) {
                    const retryAfter = response.headers.get('Retry-After');
                    errorMessage = `Too many requests while extracting page ${page}. Please wait${retryAfter ? ` ~${retryAfter}s` : ''} and try again.`;
                } else if (response.status === 500) {
                    errorMessage = `Server error extracting page ${page} - file may be corrupted`;
                } else if (response.status === 403) {
                    errorMessage = `Access denied - file may be password protected`;
                } else {
                    errorMessage = `HTTP ${response.status}: ${errorText}`;
                }
                
                throw new Error(errorMessage);
            }
            
            const blob = await response.blob();
            window.logger.info(`[ComicRenderer] Received blob: size=${blob.size}, type=${blob.type}`);
            
            if (blob.size === 0) {
                throw new Error(`Empty response received for page ${page} - may be corrupted or missing`);
            }
            
            // Validate that we received an image blob
            if (!blob.type.startsWith('image/')) {
                window.logger.warn(`[ComicRenderer] Unexpected content type for page ${page}: ${blob.type}`);
                // Still try to create URL in case the server didn't set the correct content type
            }
            
            const url = URL.createObjectURL(blob);
            this.pageCache.set(page, url);
            window.logger.info(`[ComicRenderer] Created object URL for page ${page}: ${url}`);
            return url;
            
        } catch (error) {
            if (error.name === 'AbortError') {
                window.logger.info(`[ComicRenderer] Page ${page} fetch aborted`);
                return null;
            }
            
            // Check if we're cleaning up - if so, don't treat this as an error
            if (this.isCleaningUp) {
                window.logger.info(`[ComicRenderer] Page ${page} fetch cancelled during cleanup`);
                return null;
            }
            
            // Ensure we have a valid error message
            const errorMessage = error?.message || error?.toString?.() || 'Unknown error occurred';
            
            // Enhanced error logging
            window.logger.error(`[ComicRenderer] Error fetching page ${page} from ${this.fileName || 'unknown file'}:`, {
                error: errorMessage,
                page: page,
                filePath: this.getCurrentFilePath(),
                timestamp: new Date().toISOString()
            });
            
            // Automatic retry for timeout errors (up to 2 retries)
            const isTimeoutError = errorMessage && (
                errorMessage.includes('timeout') || 
                errorMessage.includes('network') ||
                errorMessage.includes('fetch')
            );
            
            if (isTimeoutError && !this.isCleaningUp) {
                const currentFilePath = this.getCurrentFilePath();
                if (!currentFilePath) {
                    window.logger.info(`[ComicRenderer] Skipping retry for page ${page} - no file path`);
                    return null;
                }
                
                const retryKey = `${currentFilePath}:${page}`;
                const currentRetries = this.retryAttempts.get(retryKey) || 0;
                
                if (currentRetries < 2) {
                    window.logger.info(`[ComicRenderer] Retrying page ${page} (attempt ${currentRetries + 1}/2)`);
                    this.retryAttempts.set(retryKey, currentRetries + 1);
                    
                    // Wait briefly before retry
                    await new Promise(resolve => setTimeout(resolve, 1000 * (currentRetries + 1)));
                    
                    // Check again if we're still valid before retry
                    if (this.isCleaningUp || !this.currentFilePath) {
                        return null;
                    }
                    
                    // Recursive retry
                    return this.fetchAndCachePage(page);
                } else {
                    window.logger.error(`[ComicRenderer] Max retries reached for page ${page}`);
                    this.retryAttempts.delete(retryKey);
                }
            }
            
            throw new Error(`Failed to load page ${page}: ${errorMessage}`);
        }
    }

    getCurrentFilePath() {
        // Return the stored file path from the render method
        return this.currentFilePath || '';
    }

    preloadAdjacentPages(currentPage) {
        // Don't preload if cleaning up
        if (this.isCleaningUp || !this.currentFilePath) {
            return;
        }
        
        const pagesToPreload = this.isSingle()
            ? [currentPage - 2, currentPage - 1, currentPage + 1, currentPage + 2]
            : [currentPage - 2, currentPage - 1, currentPage + 2, currentPage + 3];
        
        for (const page of pagesToPreload) {
            if (page > 0 && (!this.totalPages || page <= this.totalPages) && !this.pageCache.has(page)) {
                this.preloadQueue.push(page);
            }
        }
        
        this.processPreloadQueue();
    }

    async processPreloadQueue() {
        // Stop processing if we've been cleaned up
        if (this.isCleaningUp || !this.currentFilePath || !this.abortController || this.abortController.signal.aborted) {
            this.preloadQueue = [];
            return;
        }
        
        if (this.preloadQueue.length === 0) return;
        
        const page = this.preloadQueue.shift();
        
        // Double-check before processing
        if (this.isCleaningUp || !this.currentFilePath) {
            this.preloadQueue = [];
            return;
        }
        
        try {
            await this.fetchAndCachePage(page);
        } catch (error) {
            // Only log warning if we're not cleaning up
            if (!this.isCleaningUp) {
                window.logger.warn(`Preload failed for page ${page}:`, error?.message || error);
            }
        }
        
        // Continue processing queue only if not cleaned up
        if (!this.isCleaningUp && this.currentFilePath && this.preloadQueue.length > 0) {
            setTimeout(() => this.processPreloadQueue(), 100);
        }
    }

    previousPage() {
        if (this.currentPage > 1) {
            const step = this.isSingle() ? 1 : 2;
            if (this.panelMode) this.exitPanelMode();
            this.loadPage(this.currentPage - step);
        }
    }

    nextPage() {
        if (!this.totalPages || this.currentPage < this.totalPages) {
            const step = this.isSingle() ? 1 : 2;
            if (this.panelMode) this.exitPanelMode();
            this.loadPage(this.currentPage + step);
        }
    }

    updatePageInfo() {
        const pageInfo = document.querySelector('#comic-page-info');
        const prevBtn = document.querySelector('#comic-prev');
        const nextBtn = document.querySelector('#comic-next');
        
        if (!pageInfo) return;
        
        if (this.totalPages) {
            const endPage = this.isSingle() ? this.currentPage : Math.min(this.currentPage + 1, this.totalPages);
            if (endPage > this.currentPage) {
                pageInfo.textContent = `Pages ${this.currentPage}-${endPage} of ${this.totalPages}`;
            } else {
                pageInfo.textContent = `Page ${this.currentPage} of ${this.totalPages}`;
            }
        } else {
            pageInfo.textContent = `Page ${this.currentPage}`;
        }
        
        if (prevBtn) prevBtn.disabled = this.currentPage === 1;
        if (nextBtn) nextBtn.disabled = this.totalPages !== null && this.currentPage >= this.totalPages;
    }

    toggleFullscreen() {
        if (this.isFullscreen) {
            this.exitFullscreen();
        } else {
            this.enterFullscreen();
        }
    }

    enterFullscreen() {
        if (this.isFullscreen) return;

        const comicContainer = document.querySelector('.comic-container');
        if (!comicContainer) return;

        // Store original parent and position
        this.originalParent = comicContainer.parentNode;

        // Create fullscreen container
        this.fullscreenContainer = document.createElement('div');
        this.fullscreenContainer.className = 'comic-fullscreen-overlay';
        this.fullscreenContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: #000;
            z-index: 10000;
            display: flex;
            flex-direction: column;
        `;

        // Move comic container to fullscreen
        this.fullscreenContainer.appendChild(comicContainer);
        document.body.appendChild(this.fullscreenContainer);

        // Update styles for fullscreen
        comicContainer.style.cssText = `
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            background: #000;
        `;

        // Update pages container for fullscreen
        const pagesContainer = comicContainer.querySelector('.pages-container');
        if (pagesContainer) {
            pagesContainer.style.cssText = `
                flex: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                padding: 10px;
                background: #000;
                min-height: 0;
                overflow: hidden;
            `;
        }

        // Set initial view mode to 100% (non-truncated)
        this.isTruncatedView = false;

        // Update controls for fullscreen
        const controls = comicContainer.querySelector('.comic-controls');
        if (controls) {
            controls.style.cssText = `
                display: flex;
                align-items: center;
                padding: 15px 20px;
                background: rgba(0, 0, 0, 0.8);
                color: white;
                flex-shrink: 0;
                justify-content: center;
                gap: 15px;
            `;
        }

        // Update fullscreen button
        const fullscreenBtn = controls?.querySelector('#comic-fullscreen');
        if (fullscreenBtn) {
            fullscreenBtn.textContent = '🪟 Exit Fullscreen';
            fullscreenBtn.title = 'Exit Fullscreen (ESC key)';
        }

        this.isFullscreen = true;
        
        // Apply initial fullscreen page styles
        this.updateFullscreenPageStyles();
        this.refreshPanelView();

        window.logger.info('Comic entered fullscreen mode');
    }

    exitFullscreen() {
        if (!this.isFullscreen || !this.fullscreenContainer || !this.originalParent) return;

        const comicContainer = this.fullscreenContainer.querySelector('.comic-container');
        if (comicContainer) {
            // Restore original styles
            comicContainer.style.cssText = 'height: 100%; display: flex; flex-direction: column;';

            // Restore pages container
            const pagesContainer = comicContainer.querySelector('.pages-container');
            if (pagesContainer) {
                pagesContainer.style.cssText = `
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 10px;
                    padding: 20px;
                `;
            }

            // Restore page images
            const pageImages = comicContainer.querySelectorAll('img');
            pageImages.forEach(img => {
                img.style.cssText = `
                    max-width: 48%;
                    max-height: calc(100% - 60px);
                    border: 1px solid #ccc;
                    object-fit: contain;
                    flex: 1;
                `;
            });

            // Restore controls
            const controls = comicContainer.querySelector('.comic-controls');
            if (controls) {
                controls.style.cssText = 'display: flex; align-items: center; margin-bottom: 10px; flex-shrink: 0;';
            }

            // Update fullscreen button
            const fullscreenBtn = controls?.querySelector('#comic-fullscreen');
            if (fullscreenBtn) {
                fullscreenBtn.textContent = '📺 Fullscreen';
                fullscreenBtn.title = 'Toggle Fullscreen (F key)';
            }

            // Move back to original parent
            this.originalParent.appendChild(comicContainer);
        }

        // Remove fullscreen container
        document.body.removeChild(this.fullscreenContainer);

        // Reset state
        this.fullscreenContainer = null;
        this.originalParent = null;
        this.isFullscreen = false;
        this.isTruncatedView = false;
        this.refreshPanelView();
        window.logger.info('Comic exited fullscreen mode');
    }

    // Fullscreen changes reset the image inline styles, so re-apply the current panel zoom
    refreshPanelView() {
        if (this.panelMode && this.panels) {
            setTimeout(() => this.showPanel(this.panelIndex), 0);
        }
    }

    toggleTruncatedView() {
        if (!this.isFullscreen) return;

        this.isTruncatedView = !this.isTruncatedView;
        this.updateFullscreenPageStyles();
        window.logger.info(`Comic view mode: ${this.isTruncatedView ? 'truncated' : '100%'}`);
    }

    updateFullscreenPageStyles() {
        if (!this.isFullscreen || !this.fullscreenContainer) return;

        const comicContainer = this.fullscreenContainer.querySelector('.comic-container');
        if (!comicContainer) return;

        // Update page images based on view mode
        const pageImages = comicContainer.querySelectorAll('img');
        pageImages.forEach(img => {
            if (this.isTruncatedView) {
                // Truncated view - show page end clearly with some padding
                img.style.cssText = `
                    max-width: 49%;
                    max-height: calc(100vh - 120px);
                    object-fit: contain;
                    border: 1px solid #333;
                `;
            } else {
                // 100% view - maximize space usage
                img.style.cssText = `
                    max-width: 49%;
                    max-height: calc(100vh - 80px);
                    object-fit: contain;
                    border: 1px solid #333;
                `;
            }
        });

        // Update pages container padding based on view mode
        const pagesContainer = comicContainer.querySelector('.pages-container');
        if (pagesContainer) {
            if (this.isTruncatedView) {
                pagesContainer.style.cssText = `
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 10px;
                    padding: 25px 10px;
                    background: #000;
                    min-height: 0;
                    overflow: hidden;
                `;
            } else {
                pagesContainer.style.cssText = `
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 10px;
                    padding: 10px;
                    background: #000;
                    min-height: 0;
                    overflow: hidden;
                `;
            }
        }
    }
}