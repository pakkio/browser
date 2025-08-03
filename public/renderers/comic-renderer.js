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
    }

    cleanup() {
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
        
        if (this.abortController) {
            this.abortController.abort('cleanup');
            this.abortController = null;
        }
        
        for (const url of this.pageCache.values()) {
            URL.revokeObjectURL(url);
        }
        this.pageCache.clear();
        this.preloadQueue = [];
        this.currentFilePath = null;
    }

    async render(filePath, fileName, contentCode, contentOther, options = {}) {
        try {
            this.cleanup();
            this.currentPage = 1;
            this.totalPages = null;
            this.currentFilePath = filePath; // Store the file path for later use
            this.abortController = new AbortController();
            this.fileName = fileName; // Store filename for error messages

            const comicContainer = this.createComicContainer();
            const { controls, pagesContainer } = this.createUIElements(comicContainer);
            
            contentOther.innerHTML = '';
            contentOther.appendChild(comicContainer);
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
                console.error('Error loading comic:', error);
                this.showComicError(controls, pagesContainer, error, fileName, filePath);
                
                // Hide loading popup on error
                if (window.debugConsole) {
                    window.debugConsole.hideProgress();
                }
            }
        } catch (error) {
            console.error(`Fatal error in ComicRenderer for ${fileName}:`, error);
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

        const isCorrupted = this.isComicCorruptionError(error);
        
        errorDiv.innerHTML = `
            <div style="font-size: 64px; margin-bottom: 20px;">📚</div>
            <h3 style="margin: 0 0 15px 0; color: #ff6b6b;">
                ${isCorrupted ? 'Comic File Corrupted' : 'Comic Load Failed'}
            </h3>
            <p style="margin: 10px 0; font-size: 14px;">
                <strong>File:</strong> ${fileName}
            </p>
            <p style="margin: 10px 0; font-size: 12px; opacity: 0.8; max-width: 400px;">
                ${isCorrupted 
                    ? 'The comic archive appears to be damaged, incomplete, or password-protected. Some pages may be missing or unreadable.'
                    : 'Failed to load the comic file. This may be due to an unsupported format or network issues.'}
            </p>
            <details style="margin: 15px 0; text-align: left; max-width: 500px;">
                <summary style="cursor: pointer; color: #ff9999; text-align: center;">Show error details</summary>
                <pre style="margin: 10px 0; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 4px; font-size: 11px; overflow-x: auto; text-align: left;">${error.message || error.toString()}</pre>
            </details>
            <div style="margin-top: 20px;">
                <a href="/files?path=${encodeURIComponent(filePath)}" 
                   download="${fileName}"
                   style="display: inline-block; padding: 10px 20px; background: #4ecdc4; color: white; text-decoration: none; border-radius: 4px; margin-right: 10px;">
                    📥 Download Comic
                </a>
                <button onclick="location.reload()" 
                        style="padding: 10px 20px; background: #666; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    🔄 Retry
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
            'password', 'encrypted', 'access denied', 'permission denied'
        ];
        return corruptionIndicators.some(indicator => errorMessage.includes(indicator));
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
                    }
                    break;
                case 'b':
                case 'B':
                    e.preventDefault();
                    if (this.isFullscreen) {
                        this.toggleTruncatedView();
                    }
                    break;
                case 'r': case 'g': case 'y': case 'b': case 'c':
                case '1': case '2': case '3': case '4': case '5':
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
            console.log(`[ComicRenderer] Loading comic info for: ${filePath}`);
            
            if (window.debugConsole) {
                window.debugConsole.updateProgress('Reading comic archive...', 30);
            }
            
            const response = await fetch(`/api/comic-info?path=${encodeURIComponent(filePath)}`);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[ComicRenderer] Comic info HTTP error: ${response.status} - ${errorText}`);
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const info = await response.json();
            console.log(`[ComicRenderer] Comic info received:`, info);
            
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
            console.error('[ComicRenderer] Failed to load comic info:', error);
            throw error;
        }
    }

    async loadPage(page) {
        if (page < 1) page = 1;
        if (this.totalPages && page > this.totalPages) {
            page = this.totalPages;
        }
        this.currentPage = page;
        
        const pageImg1 = document.getElementById('page-left');
        const pageImg2 = document.getElementById('page-right');
        const statusElement = document.querySelector('#comic-status');
        
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
            
            if (leftUrl) {
                pageImg1.onload = () => {
                    console.log(`[ComicRenderer] Page ${leftPage} image loaded successfully`);
                    pageImg1.style.opacity = '1';
                };
                pageImg1.onerror = (e) => {
                    console.error(`[ComicRenderer] Failed to load image for page ${leftPage}`, e);
                    pageImg1.style.opacity = '0.3';
                    pageImg1.alt = `Failed to load page ${leftPage}`;
                    pageImg1.title = `Page ${leftPage} failed to load - may be corrupted`;
                };
                pageImg1.src = leftUrl;
                pageImg1.style.display = 'block';
            }
            
            if (this.totalPages && rightPage <= this.totalPages) {
                if (statusElement) statusElement.innerHTML = `⏳ Loading page ${rightPage}...`;
                const rightUrl = this.pageCache.has(rightPage) ? 
                    this.pageCache.get(rightPage) : 
                    await this.fetchAndCachePage(rightPage);
                
                if (rightUrl) {
                    pageImg2.onload = () => {
                        console.log(`[ComicRenderer] Page ${rightPage} image loaded successfully`);
                        pageImg2.style.opacity = '1';
                    };
                    pageImg2.onerror = (e) => {
                        console.error(`[ComicRenderer] Failed to load image for page ${rightPage}`, e);
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
            console.error('Error loading page:', error);
            if (statusElement) statusElement.textContent = `Error loading page: ${error.message}`;
            
            // Hide loading popup on error
            if (window.debugConsole && page > 1) {
                window.debugConsole.hideProgress();
            }
        }
    }

    async fetchAndCachePage(page) {
        try {
            const filePath = this.getCurrentFilePath();
            console.log(`[ComicRenderer] Fetching page ${page} from file: ${filePath}`);
            
            const response = await fetch(`/comic-preview?path=${encodeURIComponent(filePath)}&page=${page}`, {
                signal: this.abortController?.signal,
                timeout: 30000 // 30 second timeout
            });
            
            console.log(`[ComicRenderer] Response status: ${response.status}, Content-Type: ${response.headers.get('Content-Type')}`);
            
            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                console.error(`[ComicRenderer] HTTP error: ${response.status} - ${errorText}`);
                
                // Provide more specific error messages
                let errorMessage;
                if (response.status === 404) {
                    errorMessage = `Page ${page} not found in comic archive`;
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
            console.log(`[ComicRenderer] Received blob: size=${blob.size}, type=${blob.type}`);
            
            if (blob.size === 0) {
                throw new Error(`Empty response received for page ${page} - may be corrupted or missing`);
            }
            
            // Validate that we received an image blob
            if (!blob.type.startsWith('image/')) {
                console.warn(`[ComicRenderer] Unexpected content type for page ${page}: ${blob.type}`);
                // Still try to create URL in case the server didn't set the correct content type
            }
            
            const url = URL.createObjectURL(blob);
            this.pageCache.set(page, url);
            console.log(`[ComicRenderer] Created object URL for page ${page}: ${url}`);
            return url;
            
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log(`[ComicRenderer] Page ${page} fetch aborted`);
                return null;
            }
            
            // Enhanced error logging
            console.error(`[ComicRenderer] Error fetching page ${page} from ${this.fileName || 'unknown file'}:`, {
                error: error.message,
                page: page,
                filePath: this.getCurrentFilePath(),
                timestamp: new Date().toISOString()
            });
            
            throw new Error(`Failed to load page ${page}: ${error.message}`);
        }
    }

    getCurrentFilePath() {
        // Return the stored file path from the render method
        return this.currentFilePath || '';
    }

    preloadAdjacentPages(currentPage) {
        const pagesToPreload = [currentPage - 2, currentPage - 1, currentPage + 2, currentPage + 3];
        
        for (const page of pagesToPreload) {
            if (page > 0 && (!this.totalPages || page <= this.totalPages) && !this.pageCache.has(page)) {
                this.preloadQueue.push(page);
            }
        }
        
        this.processPreloadQueue();
    }

    async processPreloadQueue() {
        if (this.preloadQueue.length === 0) return;
        
        const page = this.preloadQueue.shift();
        try {
            await this.fetchAndCachePage(page);
        } catch (error) {
            console.warn(`Preload failed for page ${page}:`, error);
        }
        
        // Continue processing queue
        setTimeout(() => this.processPreloadQueue(), 100);
    }

    previousPage() {
        if (this.currentPage > 1) {
            this.loadPage(this.currentPage - 2);
        }
    }

    nextPage() {
        if (!this.totalPages || this.currentPage < this.totalPages) {
            this.loadPage(this.currentPage + 2);
        }
    }

    updatePageInfo() {
        const pageInfo = document.querySelector('#comic-page-info');
        const prevBtn = document.querySelector('#comic-prev');
        const nextBtn = document.querySelector('#comic-next');
        
        if (!pageInfo) return;
        
        if (this.totalPages) {
            const endPage = Math.min(this.currentPage + 1, this.totalPages);
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
        
        console.log('Comic entered fullscreen mode');
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
        console.log('Comic exited fullscreen mode');
    }

    toggleTruncatedView() {
        if (!this.isFullscreen) return;

        this.isTruncatedView = !this.isTruncatedView;
        this.updateFullscreenPageStyles();
        console.log(`Comic view mode: ${this.isTruncatedView ? 'truncated' : '100%'}`);
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