class PDFRenderer {
    constructor() {
        this.handleKeyDown = null;
        this.pdfDoc = null;
        this.renderTask1 = null;
        this.renderTask2 = null;
        this.renderTimeout = null;
        this.uiManager = new PDFUIManager();
        this.filePath = null;
    }

    cleanup() {
        if (this.handleKeyDown) {
            document.removeEventListener('keydown', this.handleKeyDown);
            this.handleKeyDown = null;
        }
        
        if (this.renderTask1) {
            this.renderTask1.cancel();
            this.renderTask1 = null;
        }
        if (this.renderTask2) {
            this.renderTask2.cancel();
            this.renderTask2 = null;
        }
        if (this.renderTimeout) {
            clearTimeout(this.renderTimeout);
            this.renderTimeout = null;
        }
        
        this.pdfDoc = null;
    }

    async render(filePath, fileName, contentCode, contentOther) {
        this.cleanup();
        this.filePath = filePath;

        const pdfContainer = this.uiManager.createPDFContainer();
        const controls = this.uiManager.createControls(pdfContainer);
        const pagesContainer = this.uiManager.createPagesContainer();
        
        pdfContainer.appendChild(pagesContainer);
        pdfContainer.appendChild(controls);
        contentOther.appendChild(pdfContainer);
        contentOther.style.display = 'block';
        
        this.uiManager.addTextLayerStyles();
        
        this.setupEventHandlers(controls);
        this.setupKeyboardNavigation();
        
        try {
            await this.loadPDF(filePath);
        } catch (error) {
            console.error('PDF loading error:', error);
            this.uiManager.setStatus(`Error: ${error.message}`);
        }
    }

    setupEventHandlers(controls) {
        this.uiManager.setupEventHandlers(
            controls,
            (page) => this.loadPage(page),
            () => this.refreshCurrentPage()
        );
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
                    if (this.uiManager.totalPages) this.loadPage(this.uiManager.totalPages);
                    break;
                case 'r': case 'g': case 'y': case 'b': case 'c':
                case '1': case '2': case '3': case '4': case '5':
                    if (typeof handleAnnotationShortcut === 'function') {
                        handleAnnotationShortcut(e.key);
                    }
                    break;
            }
        };

        document.addEventListener('keydown', this.handleKeyDown);
    }

    async loadPDF(filePath) {
        this.uiManager.setStatus('Loading PDF...');
        
        try {
            const response = await window.authManager.authenticatedFetch(`/api/pdf-info?path=${encodeURIComponent(filePath)}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const info = await response.json();
            this.uiManager.setTotalPages(info.pages);
            this.uiManager.setStatus('');
            
            await this.loadPage(1);
        } catch (error) {
            console.error('Failed to load PDF info:', error);
            throw error;
        }
    }

    async loadPage(page) {
        if (page < 1) page = 1;
        if (this.uiManager.totalPages && page > this.uiManager.totalPages) {
            page = this.uiManager.totalPages;
        }

        this.uiManager.setCurrentPage(page);
        
        // Cancel any pending renders
        if (this.renderTask1) this.renderTask1.cancel();
        if (this.renderTask2) this.renderTask2.cancel();
        if (this.renderTimeout) clearTimeout(this.renderTimeout);

        const canvas1 = document.getElementById('pdf-page-left');
        const canvas2 = document.getElementById('pdf-page-right');
        
        if (!canvas1 || !canvas2) return;

        try {
            this.uiManager.setStatus(`Loading page ${page}...`);
            
            if (this.uiManager.doublePageMode) {
                await this.loadDoublePage(page, canvas1, canvas2);
            } else {
                await this.loadSinglePage(page, canvas1);
                this.hideCanvas(canvas2);
            }
            
            this.uiManager.setStatus('');
        } catch (error) {
            console.error('Error loading page:', error);
            this.uiManager.setStatus(`Error loading page: ${error.message}`);
        }
    }

    async loadDoublePage(page, canvas1, canvas2) {
        const leftPage = page;
        let rightPage = null;

        if (this.uiManager.coverMode) {
            if (page === 1 || page === this.uiManager.totalPages) {
                // Show cover alone
                await this.renderPage(leftPage, canvas1);
                this.hideCanvas(canvas2);
                return;
            } else {
                rightPage = Math.min(page + 1, this.uiManager.totalPages);
            }
        } else {
            rightPage = Math.min(page + 1, this.uiManager.totalPages);
        }

        // Load left page
        await this.renderPage(leftPage, canvas1);
        
        // Load right page if needed
        if (rightPage && rightPage <= this.uiManager.totalPages && rightPage !== leftPage) {
            await this.renderPage(rightPage, canvas2);
        } else {
            this.hideCanvas(canvas2);
        }
    }

    async loadSinglePage(page, canvas) {
        await this.renderPage(page, canvas);
    }

    async renderPage(pageNum, canvas) {
        try {
            const response = await window.authManager.authenticatedFetch(
                `/pdf-preview?path=${encodeURIComponent(this.filePath)}&page=${pageNum}`
            );
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const blob = await response.blob();
            const img = new Image();
            
            return new Promise((resolve, reject) => {
                img.onload = () => {
                    const ctx = canvas.getContext('2d');
                    const containerRect = canvas.parentElement.getBoundingClientRect();
                    const maxWidth = containerRect.width - 20;
                    const maxHeight = containerRect.height - 20;
                    
                    const scale = Math.min(maxWidth / img.width, maxHeight / img.height);
                    const width = img.width * scale;
                    const height = img.height * scale;
                    
                    canvas.width = width;
                    canvas.height = height;
                    canvas.style.display = 'block';
                    
                    ctx.clearRect(0, 0, width, height);
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    resolve();
                };
                
                img.onerror = () => reject(new Error('Failed to load page image'));
                img.src = URL.createObjectURL(blob);
            });
        } catch (error) {
            console.error(`Error rendering page ${pageNum}:`, error);
            throw error;
        }
    }

    hideCanvas(canvas) {
        canvas.style.display = 'none';
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    previousPage() {
        const newPage = this.uiManager.calculatePreviousPage();
        if (newPage !== this.uiManager.currentPage) {
            this.loadPage(newPage);
        }
    }

    nextPage() {
        const newPage = this.uiManager.calculateNextPage();
        if (newPage !== this.uiManager.currentPage) {
            this.loadPage(newPage);
        }
    }

    refreshCurrentPage() {
        this.loadPage(this.uiManager.currentPage);
    }
}