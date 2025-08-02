class PDFRenderer {
    constructor() {
        this.handleKeyDown = null;
        this.handleWheel = null;
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
        if (this.handleWheel) {
            document.removeEventListener('wheel', this.handleWheel);
            this.handleWheel = null;
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
        try {
            this.cleanup();
            this.filePath = filePath;
            this.fileName = fileName; // Store for error messages

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
                this.showPDFError(pagesContainer, error, fileName, filePath);
                this.uiManager.setStatus(`Error: ${error.message}`);
            }
        } catch (error) {
            console.error(`Fatal error in PDFRenderer for ${fileName}:`, error);
            throw new Error(`PDF rendering failed: ${error.message}`);
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

        this.handleWheel = (e) => {
            if (e.target.tagName === 'INPUT') return;
            
            e.preventDefault();
            
            if (e.deltaY > 0) {
                this.nextPage();
            } else if (e.deltaY < 0) {
                this.previousPage();
            }
        };

        document.addEventListener('keydown', this.handleKeyDown);
        document.addEventListener('wheel', this.handleWheel, { passive: false });
    }

    showPDFError(pagesContainer, error, fileName, filePath) {
        // Clear pages container and show error
        pagesContainer.innerHTML = '';
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 400px;
            padding: 30px;
            background: rgba(255, 0, 0, 0.1);
            border: 2px dashed rgba(255, 0, 0, 0.3);
            border-radius: 8px;
            color: #ff6b6b;
            text-align: center;
            margin: 20px;
        `;

        const isCorrupted = this.isPDFCorruptionError(error);
        
        errorDiv.innerHTML = `
            <div style="font-size: 64px; margin-bottom: 20px;">📄</div>
            <h3 style="margin: 0 0 15px 0; color: #ff6b6b;">
                ${isCorrupted ? 'PDF File Corrupted' : 'PDF Load Failed'}
            </h3>
            <p style="margin: 10px 0; font-size: 14px;">
                <strong>File:</strong> ${fileName}
            </p>
            <p style="margin: 10px 0; font-size: 12px; opacity: 0.8; max-width: 400px;">
                ${isCorrupted 
                    ? 'The PDF file appears to be damaged, incomplete, password-protected, or in an unsupported format.'
                    : 'Failed to load the PDF file. This may be due to browser compatibility issues or network problems.'}
            </p>
            <details style="margin: 15px 0; text-align: left; max-width: 500px;">
                <summary style="cursor: pointer; color: #ff9999; text-align: center;">Show error details</summary>
                <pre style="margin: 10px 0; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 4px; font-size: 11px; overflow-x: auto; text-align: left;">${error.message || error.toString()}</pre>
            </details>
            <div style="margin-top: 20px;">
                <a href="/files?path=${encodeURIComponent(filePath)}" 
                   download="${fileName}"
                   style="display: inline-block; padding: 10px 20px; background: #4ecdc4; color: white; text-decoration: none; border-radius: 4px; margin-right: 10px;">
                    📥 Download PDF
                </a>
                <button onclick="location.reload()" 
                        style="padding: 10px 20px; background: #666; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    🔄 Retry
                </button>
            </div>
        `;
        
        pagesContainer.appendChild(errorDiv);
    }

    isPDFCorruptionError(error) {
        const errorMessage = (error.message || error.toString()).toLowerCase();
        const corruptionIndicators = [
            'corrupt', 'corrupted', 'damaged', 'invalid', 'malformed',
            'unexpected end', 'truncated', 'bad format', 'parse error',
            'failed to load', 'network error', 'decode error', 'format error',
            'pdf', 'password', 'encrypted', 'access denied', 'permission denied',
            'invalid pdf', 'not a pdf', 'unsupported encryption'
        ];
        return corruptionIndicators.some(indicator => errorMessage.includes(indicator));
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
                `/pdf-preview?path=${encodeURIComponent(this.filePath)}&page=${pageNum}`,
                { timeout: 30000 } // 30 second timeout
            );
            
            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                let errorMessage;
                if (response.status === 404) {
                    errorMessage = `Page ${pageNum} not found in PDF`;
                } else if (response.status === 500) {
                    errorMessage = `Server error rendering page ${pageNum} - PDF may be corrupted`;
                } else if (response.status === 403) {
                    errorMessage = `Access denied - PDF may be password protected`;
                } else {
                    errorMessage = `HTTP ${response.status}: ${errorText}`;
                }
                throw new Error(errorMessage);
            }
            
            const blob = await response.blob();
            
            if (blob.size === 0) {
                throw new Error(`Empty response received for page ${pageNum}`);
            }
            
            // Validate that we received an image blob
            if (!blob.type.startsWith('image/')) {
                console.warn(`Unexpected content type for PDF page ${pageNum}: ${blob.type}`);
            }
            
            const img = new Image();
            
            return new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    reject(new Error(`Timeout loading image for page ${pageNum}`));
                }, 15000); // 15 second timeout for image loading
                
                img.onload = () => {
                    clearTimeout(timeoutId);
                    try {
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
                    } catch (renderError) {
                        reject(new Error(`Canvas rendering failed for page ${pageNum}: ${renderError.message}`));
                    }
                };
                
                img.onerror = (event) => {
                    clearTimeout(timeoutId);
                    console.error(`Image load error for page ${pageNum}:`, event);
                    reject(new Error(`Failed to load page ${pageNum} image - may be corrupted`));
                };
                
                try {
                    img.src = URL.createObjectURL(blob);
                } catch (urlError) {
                    clearTimeout(timeoutId);
                    reject(new Error(`Failed to create object URL for page ${pageNum}: ${urlError.message}`));
                }
            });
        } catch (error) {
            console.error(`Error rendering PDF page ${pageNum} from ${this.fileName || 'unknown file'}:`, {
                error: error.message,
                page: pageNum,
                filePath: this.filePath,
                timestamp: new Date().toISOString()
            });
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