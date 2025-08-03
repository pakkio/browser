class PDFUIManager {
    constructor() {
        this.doublePageMode = true;
        this.coverMode = true;
        this.textLayerVisible = false;
        this.currentPage = 1;
        this.totalPages = null;
    }

    createPDFContainer() {
        const pdfContainer = document.createElement('div');
        pdfContainer.className = 'pdf-container';
        pdfContainer.style.cssText = `height: 100%; display: flex; flex-direction: column; position: relative;`;
        return pdfContainer;
    }

    createControls(pdfContainer) {
        const controls = document.createElement('div');
        controls.className = 'pdf-controls';
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
            z-index: 10; 
            flex-shrink: 0;
            opacity: 0;
            transition: opacity 0.3s ease-in-out;
        `;

        pdfContainer.addEventListener('mouseenter', () => controls.style.opacity = '1');
        pdfContainer.addEventListener('mouseleave', () => controls.style.opacity = '0');

        controls.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; color: white;">
                <div style="display: flex; align-items: center; gap: 5px;">
                    <button id="pdf-prev">Previous</button>
                    <span id="pdf-page-info" style="margin: 0 10px;">Page 1</span>
                    <button id="pdf-next">Next</button>
                </div>
                <div style="display: flex; align-items: center; gap: 5px;">
                    <input type="number" id="pdf-page-jump" placeholder="Page" style="width: 60px;">
                    <button id="pdf-jump-btn">Go</button>
                </div>
                <div style="display: flex; align-items: center; gap: 5px;">
                    <button id="pdf-zoom-out" title="Zoom Out">🔍-</button>
                    <span id="pdf-zoom-level" style="margin: 0 5px; min-width: 50px; text-align: center;">100%</span>
                    <button id="pdf-zoom-in" title="Zoom In">🔍+</button>
                    <button id="pdf-fit-width" title="Fit to Width">⏹️</button>
                </div>
                <div style="display: flex; align-items: center; gap: 5px;">
                    <button id="pdf-double-page-toggle" title="Toggle Double Page View">📖</button>
                    <button id="pdf-cover-mode-toggle" title="Treat first page as cover">📚</button>
                    <button id="pdf-text-toggle" title="Toggle Text Selection">🔤</button>
                </div>
                <span id="pdf-status" style="font-style: italic; color: #ccc;"></span>
            </div>
        `;

        return controls;
    }

    createPagesContainer() {
        const pagesContainer = document.createElement('div');
        pagesContainer.className = 'pdf-pages-container';
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

        const pageContainer1 = this.createPageContainer('pdf-container-left', 'pdf-page-left', 'pdf-text-layer-left');
        const pageContainer2 = this.createPageContainer('pdf-container-right', 'pdf-page-right', 'pdf-text-layer-right');

        pagesContainer.appendChild(pageContainer1);
        pagesContainer.appendChild(pageContainer2);

        return pagesContainer;
    }

    createPageContainer(containerId, canvasId, textLayerId) {
        const pageContainer = document.createElement('div');
        pageContainer.id = containerId;
        pageContainer.style.cssText = `
            position: relative;
            flex: 1;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            overflow: auto;
            padding: 10px;
        `;

        const canvas = document.createElement('canvas');
        canvas.id = canvasId;
        canvas.style.cssText = `
            border: 1px solid #ccc;
            display: block;
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
            background: white;
        `;

        const textLayer = document.createElement('div');
        textLayer.id = textLayerId;
        textLayer.className = 'textLayer';
        textLayer.style.cssText = `
            position: absolute;
            left: 0;
            top: 0;
            overflow: hidden;
            opacity: 0;
            line-height: 1.0;
            pointer-events: none;
            user-select: text;
            z-index: 2;
        `;

        pageContainer.appendChild(canvas);
        pageContainer.appendChild(textLayer);

        return pageContainer;
    }

    addTextLayerStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .textLayer {
                position: absolute;
                overflow: hidden;
                line-height: 1.0;
                font-size: 1px;
            }
            
            .textLayer > span {
                color: transparent;
                position: absolute;
                white-space: pre;
                cursor: text;
                transform-origin: 0% 0%;
                font-family: sans-serif;
            }
            
            .textLayer ::selection {
                background: rgba(0, 120, 255, 0.4) !important;
                color: transparent !important;
            }
            
            .textLayer ::-moz-selection {
                background: rgba(0, 120, 255, 0.4) !important;
                color: transparent !important;
            }
            
            #pdf-text-layer-left, #pdf-text-layer-right {
                user-select: text !important;
                -webkit-user-select: text !important;
                -moz-user-select: text !important;
                -ms-user-select: text !important;
                pointer-events: auto !important;
            }
            
            /* Ensure text layers don't interfere with mouse wheel when not in text selection mode */
            #pdf-text-layer-left:not([data-text-visible="true"]), 
            #pdf-text-layer-right:not([data-text-visible="true"]) {
                pointer-events: none !important;
            }
            
            #pdf-text-layer-left:hover, #pdf-text-layer-right:hover {
                background: rgba(255, 255, 0, 0.05);
            }
        `;
        document.head.appendChild(style);
    }

    setupEventHandlers(controls, onPageChange, onModeChange) {
        const prevBtn = controls.querySelector('#pdf-prev');
        const nextBtn = controls.querySelector('#pdf-next');
        const jumpInput = controls.querySelector('#pdf-page-jump');
        const jumpBtn = controls.querySelector('#pdf-jump-btn');
        const doublePageToggle = controls.querySelector('#pdf-double-page-toggle');
        const coverModeToggle = controls.querySelector('#pdf-cover-mode-toggle');
        const textToggle = controls.querySelector('#pdf-text-toggle');
        
        // Zoom controls
        const zoomOutBtn = controls.querySelector('#pdf-zoom-out');
        const zoomInBtn = controls.querySelector('#pdf-zoom-in');
        const fitWidthBtn = controls.querySelector('#pdf-fit-width');
        const zoomLevelSpan = controls.querySelector('#pdf-zoom-level');

        // Set initial button states
        doublePageToggle.innerHTML = '📄 Single Page';
        doublePageToggle.style.background = '#4CAF50';
        coverModeToggle.innerHTML = '📚 Cover Mode ON';
        coverModeToggle.style.background = '#4CAF50';

        prevBtn.addEventListener('click', () => {
            const newPage = this.calculatePreviousPage();
            if (newPage !== this.currentPage) {
                onPageChange(newPage);
            }
        });

        nextBtn.addEventListener('click', () => {
            const newPage = this.calculateNextPage();
            if (newPage !== this.currentPage) {
                onPageChange(newPage);
            }
        });

        jumpBtn.addEventListener('click', () => {
            const page = parseInt(jumpInput.value);
            if (page && page > 0 && page <= this.totalPages) {
                onPageChange(page);
            }
        });

        jumpInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                jumpBtn.click();
            }
        });

        doublePageToggle.addEventListener('click', () => {
            this.doublePageMode = !this.doublePageMode;
            doublePageToggle.innerHTML = this.doublePageMode ? '📄 Single Page' : '📖 Double Page';
            doublePageToggle.style.background = this.doublePageMode ? '#4CAF50' : '#FF9800';
            onModeChange();
        });

        coverModeToggle.addEventListener('click', () => {
            this.coverMode = !this.coverMode;
            coverModeToggle.innerHTML = this.coverMode ? '📚 Cover Mode ON' : '📚 Cover Mode OFF';
            coverModeToggle.style.background = this.coverMode ? '#4CAF50' : '#FF9800';
            onModeChange();
        });

        textToggle.addEventListener('click', () => {
            this.toggleTextLayer();
        });

        // Zoom controls event listeners
        zoomOutBtn.addEventListener('click', () => {
            onModeChange('zoom-out');
        });

        zoomInBtn.addEventListener('click', () => {
            onModeChange('zoom-in');
        });

        fitWidthBtn.addEventListener('click', () => {
            onModeChange('fit-width');
        });

        return {
            prevBtn,
            nextBtn,
            jumpInput,
            jumpBtn,
            doublePageToggle,
            coverModeToggle,
            textToggle,
            zoomOutBtn,
            zoomInBtn,
            fitWidthBtn,
            zoomLevelSpan
        };
    }

    calculatePreviousPage() {
        if (this.currentPage <= 1) return 1;
        
        if (this.doublePageMode) {
            if (this.coverMode && this.currentPage === 2) {
                return 1; // Go back to cover
            } else if (this.coverMode && this.currentPage > 2) {
                return this.currentPage - 2;
            } else if (!this.coverMode) {
                return this.currentPage - 2;
            }
        }
        return this.currentPage - 1;
    }

    calculateNextPage() {
        if (this.currentPage >= this.totalPages) return this.totalPages;
        
        if (this.doublePageMode) {
            if (this.coverMode && this.currentPage === 1) {
                return 2; // From cover to page 2
            } else {
                return Math.min(this.currentPage + 2, this.totalPages);
            }
        }
        return this.currentPage + 1;
    }

    updatePageInfo() {
        const pageInfo = document.querySelector('#pdf-page-info');
        const prevBtn = document.querySelector('#pdf-prev');
        const nextBtn = document.querySelector('#pdf-next');

        if (!pageInfo) return;

        if (this.doublePageMode && this.totalPages) {
            if (this.coverMode && this.currentPage === 1) {
                pageInfo.textContent = `Page 1 (Front Cover) of ${this.totalPages}`;
            } else if (this.coverMode && this.currentPage === this.totalPages) {
                pageInfo.textContent = `Page ${this.totalPages} (Rear Cover) of ${this.totalPages}`;
            } else if (this.coverMode && this.currentPage > 1) {
                const endPage = Math.min(this.currentPage + 1, this.totalPages);
                if (endPage > this.currentPage && endPage < this.totalPages) {
                    pageInfo.textContent = `Pages ${this.currentPage}-${endPage} of ${this.totalPages}`;
                } else {
                    pageInfo.textContent = `Page ${this.currentPage} of ${this.totalPages}`;
                }
            } else {
                const endPage = Math.min(this.currentPage + 1, this.totalPages);
                if (endPage > this.currentPage) {
                    pageInfo.textContent = `Pages ${this.currentPage}-${endPage} of ${this.totalPages}`;
                } else {
                    pageInfo.textContent = `Page ${this.currentPage} of ${this.totalPages}`;
                }
            }
        } else {
            pageInfo.textContent = `Page ${this.currentPage} of ${this.totalPages}`;
        }

        if (prevBtn) prevBtn.disabled = this.currentPage === 1;
        if (nextBtn) {
            if (this.doublePageMode) {
                nextBtn.disabled = this.currentPage >= this.totalPages;
            } else {
                nextBtn.disabled = this.currentPage === this.totalPages;
            }
        }
    }

    toggleTextLayer() {
        this.textLayerVisible = !this.textLayerVisible;
        const textToggle = document.querySelector('#pdf-text-toggle');
        
        if (textToggle) {
            textToggle.innerHTML = this.textLayerVisible ? '🔤 Text Selection ON' : '🔤 Text Selection';
            textToggle.style.background = this.textLayerVisible ? '#4CAF50' : '#FF9800';
        }

        const textLayer1 = document.getElementById('pdf-text-layer-left');
        const textLayer2 = document.getElementById('pdf-text-layer-right');

        if (this.textLayerVisible) {
            if (textLayer1) {
                textLayer1.style.opacity = '1';
                textLayer1.style.pointerEvents = 'auto';
                textLayer1.style.display = 'block';
                textLayer1.setAttribute('data-text-visible', 'true');
            }
            if (textLayer2) {
                textLayer2.style.opacity = '1';
                textLayer2.style.pointerEvents = 'auto';
                textLayer2.style.display = 'block';
                textLayer2.setAttribute('data-text-visible', 'true');
            }
        } else {
            if (textLayer1) {
                textLayer1.style.opacity = '0';
                textLayer1.style.pointerEvents = 'none';
                textLayer1.style.display = 'none';
                textLayer1.removeAttribute('data-text-visible');
            }
            if (textLayer2) {
                textLayer2.style.opacity = '0';
                textLayer2.style.pointerEvents = 'none';
                textLayer2.style.display = 'none';
                textLayer2.removeAttribute('data-text-visible');
            }
        }
    }

    setStatus(message) {
        const statusElement = document.querySelector('#pdf-status');
        if (statusElement) {
            statusElement.textContent = message;
        }
    }

    setCurrentPage(page) {
        this.currentPage = page;
        this.updatePageInfo();
    }

    setTotalPages(total) {
        this.totalPages = total;
        this.updatePageInfo();
    }

    updateZoomDisplay(zoomLevel, fitToWidth) {
        const zoomLevelSpan = document.getElementById('pdf-zoom-level');
        const fitWidthBtn = document.getElementById('pdf-fit-width');
        
        if (zoomLevelSpan) {
            if (fitToWidth) {
                zoomLevelSpan.textContent = 'Fit';
            } else {
                zoomLevelSpan.textContent = Math.round(zoomLevel * 100) + '%';
            }
        }
        
        if (fitWidthBtn) {
            fitWidthBtn.style.background = fitToWidth ? '#4CAF50' : '#FF9800';
        }
    }
}