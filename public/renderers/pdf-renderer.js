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
        this.zoomLevel = 1.0; // Default zoom level
        this.fitToWidth = true; // Default to fit-to-width mode
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
            
            // Remove from specific PDF containers
            if (this.wheelListenerElements) {
                this.wheelListenerElements.forEach(element => {
                    if (element) {
                        element.removeEventListener('wheel', this.handleWheel);
                    }
                });
                this.wheelListenerElements = null;
            }
            
            this.handleWheel = null;
        }
        
        // Exit fullscreen if active
        if (this.isFullscreen) {
            this.exitFullscreen();
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
        
        // Cancel and clean up any active render tasks
        if (this.activeRenderTasks) {
            this.activeRenderTasks.forEach((task, canvasId) => {
                try {
                    task.cancel();
                } catch (e) {
                    console.warn(`Failed to cancel render task for ${canvasId}:`, e);
                }
            });
            this.activeRenderTasks.clear();
            this.activeRenderTasks = null;
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
            (mode) => this.handleModeChange(mode),
            () => this.toggleFullscreen()
        );
        
        // Add wheel listeners to PDF containers after they're created
        setTimeout(() => {
            const pdfContainer = document.querySelector('.pdf-container');
            const pagesContainer = document.querySelector('.pdf-pages-container');
            const leftContainer = document.getElementById('pdf-container-left');
            const rightContainer = document.getElementById('pdf-container-right');
            
            [pdfContainer, pagesContainer, leftContainer, rightContainer].forEach(container => {
                if (container) {
                    console.log('PDF: Adding wheel listener to', container.className || container.id);
                    container.addEventListener('wheel', this.handleWheel, { passive: false });
                    // Store reference for cleanup
                    if (!this.wheelListenerElements) this.wheelListenerElements = [];
                    this.wheelListenerElements.push(container);
                }
            });
        }, 50);
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
            console.log('PDF Wheel event fired:', {
                target: e.target.tagName,
                targetId: e.target.id,
                targetClass: e.target.className,
                deltaY: e.deltaY
            });
            
            // Skip if target is an input
            if (e.target.tagName === 'INPUT') {
                console.log('PDF Wheel: Skipping - target is INPUT');
                return;
            }
            
            console.log('PDF Wheel: Processing scroll', e.deltaY > 0 ? 'DOWN (next page)' : 'UP (previous page)');
            
            e.preventDefault();
            e.stopPropagation();
            
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
        
        // Show prominent loading popup
        if (window.debugConsole) {
            window.debugConsole.showProgress('Loading PDF document...', 10);
        }
        
        try {
            // Load the PDF document using authenticated fetch
            const response = await window.authManager.authenticatedFetch(
                `/files?path=${encodeURIComponent(filePath)}`,
                { timeout: 30000 } // 30 second timeout
            );
            
            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                let errorMessage;
                if (response.status === 404) {
                    errorMessage = `PDF file not found`;
                } else if (response.status === 500) {
                    errorMessage = `Server error loading PDF - file may be corrupted`;
                } else if (response.status === 403) {
                    errorMessage = `Access denied - PDF may be password protected`;
                } else {
                    errorMessage = `HTTP ${response.status}: ${errorText}`;
                }
                throw new Error(errorMessage);
            }
            
            const arrayBuffer = await response.arrayBuffer();
            
            if (window.debugConsole) {
                window.debugConsole.updateProgress('Processing PDF document...', 50);
            }
            
            this.pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            
            if (window.debugConsole) {
                window.debugConsole.updateProgress('PDF loaded successfully', 70);
            }
            
            this.uiManager.setTotalPages(this.pdfDoc.numPages);
            this.uiManager.setStatus('');
            
            // Initialize zoom display
            this.uiManager.updateZoomDisplay(this.zoomLevel, this.fitToWidth);
            
            await this.loadPage(1);
            
            // Hide loading popup on success
            if (window.debugConsole) {
                window.debugConsole.updateProgress('PDF ready', 100);
                setTimeout(() => {
                    window.debugConsole.hideProgress();
                }, 500);
            }
        } catch (error) {
            console.error('Failed to load PDF:', error);
            
            // Hide loading popup on error
            if (window.debugConsole) {
                window.debugConsole.hideProgress();
            }
            
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
            
            // Show brief loading popup for page changes (only if not initial load)
            if (window.debugConsole && page > 1) {
                window.debugConsole.showProgress(`Loading page ${page}...`, 50);
            }
            
            if (this.uiManager.doublePageMode) {
                await this.loadDoublePage(page, canvas1, canvas2);
            } else {
                await this.loadSinglePage(page, canvas1);
                this.hideCanvas(canvas2);
            }
            
            this.uiManager.setStatus('');
            
            // Hide loading popup for page changes
            if (window.debugConsole && page > 1) {
                setTimeout(() => {
                    window.debugConsole.hideProgress();
                }, 300);
            }
        } catch (error) {
            console.error('Error loading page:', error);
            this.uiManager.setStatus(`Error loading page: ${error.message}`);
            
            // Hide loading popup on error
            if (window.debugConsole && page > 1) {
                window.debugConsole.hideProgress();
            }
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
            // Cancel any existing render task for this canvas
            const canvasId = canvas.id;
            if (this.activeRenderTasks && this.activeRenderTasks.has(canvasId)) {
                const existingTask = this.activeRenderTasks.get(canvasId);
                existingTask.cancel();
                this.activeRenderTasks.delete(canvasId);
                // Small delay to ensure canvas is freed
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            
            // Clear the canvas to ensure clean state
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            if (!this.activeRenderTasks) {
                this.activeRenderTasks = new Map();
            }
            
            if (!this.pdfDoc) {
                // Load the PDF document using authenticated fetch
                const response = await window.authManager.authenticatedFetch(
                    `/files?path=${encodeURIComponent(this.filePath)}`,
                    { timeout: 30000 } // 30 second timeout
                );
                
                if (!response.ok) {
                    const errorText = await response.text().catch(() => 'Unknown error');
                    let errorMessage;
                    if (response.status === 404) {
                        errorMessage = `PDF file not found`;
                    } else if (response.status === 500) {
                        errorMessage = `Server error loading PDF - file may be corrupted`;
                    } else if (response.status === 403) {
                        errorMessage = `Access denied - PDF may be password protected`;
                    } else {
                        errorMessage = `HTTP ${response.status}: ${errorText}`;
                    }
                    throw new Error(errorMessage);
                }
                
                const arrayBuffer = await response.arrayBuffer();
                this.pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            }
            
            // Get the page
            const page = await this.pdfDoc.getPage(pageNum);
            
            // Get viewport and calculate scale for better readability
            const containerRect = canvas.parentElement.getBoundingClientRect();
            const maxWidth = containerRect.width - 40; // More padding
            const maxHeight = window.innerHeight - 200; // Use more of the viewport height
            
            const viewport = page.getViewport({ scale: 1.0 });
            
            // Calculate scale based on zoom mode
            let scale;
            
            if (this.fitToWidth) {
                // Fit to width mode
                scale = maxWidth / viewport.width;
                // Ensure minimum scale for readability (at least 1.0)
                scale = Math.max(scale, 1.0);
                // If the scaled height would be too tall, reduce scale but not below 0.8
                if (scale * viewport.height > maxHeight) {
                    scale = Math.max(maxHeight / viewport.height, 0.8);
                }
            } else {
                // Manual zoom mode
                scale = this.zoomLevel;
            }
            
            const scaledViewport = page.getViewport({ scale: scale });
            
            console.log(`PDF page ${pageNum}: original size ${viewport.width}x${viewport.height}, scale: ${scale.toFixed(2)}, final size: ${scaledViewport.width}x${scaledViewport.height}`);
            
            // Set canvas dimensions
            canvas.width = scaledViewport.width;
            canvas.height = scaledViewport.height;
            canvas.style.display = 'block';
            
            // Render the page
            const renderContext = {
                canvasContext: canvas.getContext('2d'),
                viewport: scaledViewport
            };
            
            const renderTask = page.render(renderContext);
            
            // Store the render task for cancellation if needed
            this.activeRenderTasks.set(canvasId, renderTask);
            
            // Wait for the render to complete
            await renderTask.promise;
            
            // Remove the completed task from tracking
            this.activeRenderTasks.delete(canvasId);
            
            // Render the text layer
            await this.renderTextLayer(page, scaledViewport, pageNum);
            
            return renderTask.promise;
        } catch (error) {
            // Clean up the render task from tracking on error
            const canvasId = canvas.id;
            if (this.activeRenderTasks && this.activeRenderTasks.has(canvasId)) {
                this.activeRenderTasks.delete(canvasId);
            }
            
            // Check if this is a rendering cancellation (not an actual error)
            if (error.name === 'RenderingCancelledException') {
                console.debug(`PDF rendering cancelled for page ${pageNum} (this is normal when scrolling quickly)`);
                return; // Don't treat this as an error
            }
            
            console.error(`Error rendering PDF page ${pageNum} from ${this.fileName || 'unknown file'}:`, {
                error: error.message,
                page: pageNum,
                filePath: this.filePath,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }
    
    async renderTextLayer(page, viewport, pageNum) {
        try {
            // Get text content
            const textContent = await page.getTextContent();
            
            // Get the text layer div
            const textLayerId = pageNum === this.uiManager.currentPage ? 'pdf-text-layer-left' : 'pdf-text-layer-right';
            const textLayerDiv = document.getElementById(textLayerId);
            
            if (!textLayerDiv) return;
            
            // Clear previous content
            textLayerDiv.innerHTML = '';
            
            // Set text layer dimensions
            textLayerDiv.style.width = `${viewport.width}px`;
            textLayerDiv.style.height = `${viewport.height}px`;
            
            // Render text layer
            pdfjsLib.renderTextLayer({
                textContent: textContent,
                container: textLayerDiv,
                viewport: viewport,
                textDivs: []
            });
        } catch (error) {
            console.warn(`Failed to render text layer for page ${pageNum}:`, error);
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

    handleModeChange(mode) {
        if (mode === 'zoom-out') {
            this.fitToWidth = false;
            this.zoomLevel = Math.max(0.5, this.zoomLevel - 0.25);
        } else if (mode === 'zoom-in') {
            this.fitToWidth = false;
            this.zoomLevel = Math.min(3.0, this.zoomLevel + 0.25);
        } else if (mode === 'fit-width') {
            this.fitToWidth = !this.fitToWidth;
            if (!this.fitToWidth && this.zoomLevel === 1.0) {
                this.zoomLevel = 1.25; // Default manual zoom
            }
        }
        
        // Update zoom display
        this.uiManager.updateZoomDisplay(this.zoomLevel, this.fitToWidth);
        
        // Refresh the current page with new zoom
        this.refreshCurrentPage();
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

        const pdfContainer = document.querySelector('.pdf-container');
        if (!pdfContainer) return;

        // Store original parent and position
        this.originalParent = pdfContainer.parentNode;

        // Create fullscreen container
        this.fullscreenContainer = document.createElement('div');
        this.fullscreenContainer.className = 'pdf-fullscreen-overlay';
        this.fullscreenContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: #222;
            z-index: 10000;
            display: flex;
            flex-direction: column;
        `;

        // Move PDF container to fullscreen
        this.fullscreenContainer.appendChild(pdfContainer);
        document.body.appendChild(this.fullscreenContainer);

        // Update styles for fullscreen
        pdfContainer.style.cssText = `
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            background: #222;
        `;

        // Set initial view mode to 100% (non-truncated)
        this.isTruncatedView = false;

        // Update controls for fullscreen
        const controls = pdfContainer.querySelector('.pdf-controls');
        if (controls) {
            controls.style.cssText = `
                position: static;
                bottom: auto;
                left: auto;
                right: auto;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 15px 20px;
                background: rgba(0, 0, 0, 0.8);
                backdrop-filter: blur(10px);
                border-top: 1px solid rgba(255, 255, 255, 0.2);
                flex-shrink: 0;
                opacity: 1;
                transition: opacity 0.3s ease-in-out;
                order: -1;
                margin-bottom: 10px;
                border-radius: 10px;
                flex-wrap: wrap;
                gap: 10px;
                color: white;
            `;
        }

        // Update fullscreen button
        const fullscreenBtn = controls?.querySelector('#pdf-fullscreen');
        if (fullscreenBtn) {
            fullscreenBtn.textContent = '🪟 Exit Fullscreen';
            fullscreenBtn.title = 'Exit Fullscreen (ESC key)';
        }

        this.isFullscreen = true;
        
        // Apply initial fullscreen page styles
        this.updateFullscreenPageStyles();
        
        console.log('PDF entered fullscreen mode');
        
        // Refresh current page to fit new container
        this.refreshCurrentPage();
    }

    exitFullscreen() {
        if (!this.isFullscreen || !this.fullscreenContainer || !this.originalParent) return;

        const pdfContainer = this.fullscreenContainer.querySelector('.pdf-container');
        if (pdfContainer) {
            // Restore original styles
            pdfContainer.style.cssText = 'height: 100%; display: flex; flex-direction: column; position: relative;';

            // Restore pages container
            const pagesContainer = pdfContainer.querySelector('.pdf-pages-container');
            if (pagesContainer) {
                pagesContainer.style.cssText = `
                    display: flex;
                    gap: 20px;
                    flex: 1;
                    align-items: flex-start;
                    justify-content: center;
                    min-height: 0;
                    padding: 20px;
                    overflow: auto;
                    height: 100%;
                `;
            }

            // Restore controls
            const controls = pdfContainer.querySelector('.pdf-controls');
            if (controls) {
                controls.style.cssText = `
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 10px;
                    background: rgba(0, 0, 0, 0.6);
                    backdrop-filter: blur(10px);
                    border-top: 1px solid rgba(255, 255, 255, 0.2);
                    flex-wrap: wrap;
                    gap: 10px;
                    z-index: 10;
                    flex-shrink: 0;
                    opacity: 0;
                    transition: opacity 0.3s ease-in-out;
                `;
            }

            // Update fullscreen button
            const fullscreenBtn = controls?.querySelector('#pdf-fullscreen');
            if (fullscreenBtn) {
                fullscreenBtn.textContent = '📺 Fullscreen';
                fullscreenBtn.title = 'Toggle Fullscreen (F key)';
            }

            // Move back to original parent
            this.originalParent.appendChild(pdfContainer);
        }

        // Remove fullscreen container
        document.body.removeChild(this.fullscreenContainer);

        // Reset state
        this.fullscreenContainer = null;
        this.originalParent = null;
        this.isFullscreen = false;
        this.isTruncatedView = false;
        console.log('PDF exited fullscreen mode');
        
        // Refresh current page to fit new container
        this.refreshCurrentPage();
    }

    toggleTruncatedView() {
        if (!this.isFullscreen) return;

        this.isTruncatedView = !this.isTruncatedView;
        this.updateFullscreenPageStyles();
        console.log(`PDF view mode: ${this.isTruncatedView ? 'truncated' : '100%'}`);
    }

    updateFullscreenPageStyles() {
        if (!this.isFullscreen || !this.fullscreenContainer) return;

        const pdfContainer = this.fullscreenContainer.querySelector('.pdf-container');
        if (!pdfContainer) return;

        // Update pages container based on view mode
        const pagesContainer = pdfContainer.querySelector('.pdf-pages-container');
        if (pagesContainer) {
            if (this.isTruncatedView) {
                // Truncated view - show page end clearly with more padding
                pagesContainer.style.cssText = `
                    display: flex;
                    gap: 20px;
                    flex: 1;
                    align-items: center;
                    justify-content: center;
                    min-height: 0;
                    padding: 40px;
                    overflow: auto;
                    height: 100%;
                    background: #222;
                `;
            } else {
                // 100% view - maximize space usage
                pagesContainer.style.cssText = `
                    display: flex;
                    gap: 20px;
                    flex: 1;
                    align-items: center;
                    justify-content: center;
                    min-height: 0;
                    padding: 20px;
                    overflow: auto;
                    height: 100%;
                    background: #222;
                `;
            }
        }
    }
}