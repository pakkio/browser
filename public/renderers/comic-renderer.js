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
        this.cleanup();
        this.currentPage = 1;
        this.totalPages = null;
        this.currentFilePath = filePath; // Store the file path for later use
        this.abortController = new AbortController();

        const comicContainer = this.createComicContainer();
        const { controls, pagesContainer } = this.createUIElements(comicContainer);
        
        contentOther.innerHTML = '';
        contentOther.appendChild(comicContainer);
        contentOther.style.display = 'block';
        
        this.setupEventHandlers(controls, filePath);
        this.setupKeyboardNavigation();
        
        try {
            await this.loadComicInfo(filePath);
            await this.loadPage(1);
        } catch (error) {
            console.error('Error loading comic:', error);
            controls.querySelector('#comic-status').textContent = `Error: ${error.message}`;
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

    setupEventHandlers(controls, filePath) {
        const prevBtn = controls.querySelector('#comic-prev');
        const nextBtn = controls.querySelector('#comic-next');
        const jumpInput = controls.querySelector('#comic-page-jump');
        const jumpBtn = controls.querySelector('#comic-jump-btn');

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
            const response = await fetch(`/api/comic-info?path=${encodeURIComponent(filePath)}`);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[ComicRenderer] Comic info HTTP error: ${response.status} - ${errorText}`);
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const info = await response.json();
            console.log(`[ComicRenderer] Comic info received:`, info);
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
            
        } catch (error) {
            console.error('Error loading page:', error);
            if (statusElement) statusElement.textContent = `Error loading page: ${error.message}`;
        }
    }

    async fetchAndCachePage(page) {
        try {
            const filePath = this.getCurrentFilePath();
            console.log(`[ComicRenderer] Fetching page ${page} from file: ${filePath}`);
            
            const response = await fetch(`/comic-preview?path=${encodeURIComponent(filePath)}&page=${page}`, {
                signal: this.abortController?.signal
            });
            
            console.log(`[ComicRenderer] Response status: ${response.status}, Content-Type: ${response.headers.get('Content-Type')}`);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[ComicRenderer] HTTP error: ${response.status} - ${errorText}`);
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const blob = await response.blob();
            console.log(`[ComicRenderer] Received blob: size=${blob.size}, type=${blob.type}`);
            
            if (blob.size === 0) {
                throw new Error(`Empty response received for page ${page}`);
            }
            
            const url = URL.createObjectURL(blob);
            this.pageCache.set(page, url);
            console.log(`[ComicRenderer] Created object URL for page ${page}: ${url}`);
            return url;
            
        } catch (error) {
            if (error.name === 'AbortError') return null;
            console.error(`[ComicRenderer] Error fetching page ${page}:`, error);
            throw error;
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
}