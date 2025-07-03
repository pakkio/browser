class PDFRenderer {
    constructor() {
        this.handleKeyDown = null;
        this.currentPage = 1;
        this.totalPages = null;
        this.pdfDoc = null;
        this.doublePageMode = false;
    }

    cleanup() {
        if (this.handleKeyDown) {
            document.removeEventListener('keydown', this.handleKeyDown);
            this.handleKeyDown = null;
        }
        this.pdfDoc = null;
    }

    async render(filePath, fileName, contentCode, contentOther) {
        this.cleanup();

        const pdfContainer = document.createElement('div');
        pdfContainer.className = 'pdf-container';
        pdfContainer.style.cssText = `height: 100%; display: flex; flex-direction: column;`;
        
        const controls = document.createElement('div');
        controls.className = 'pdf-controls';
        controls.style.cssText = `
            display: flex; 
            align-items: center; 
            margin-bottom: 20px; 
            padding: 15px; 
            background: rgba(255, 255, 255, 0.95); 
            border-radius: 8px; 
            box-shadow: 0 2px 8px rgba(0,0,0,0.1); 
            z-index: 10; 
            position: relative; 
            flex-shrink: 0;
        `;
        controls.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
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
                    <button id="pdf-double-page-toggle" style="background: #2196F3; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">📖 Double Page</button>
                    <button id="pdf-text-toggle" style="background: #FF9800; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer;" title="Toggle text selection overlay">🔤 Text Selection</button>
                </div>
                <span id="pdf-status" style="font-style: italic; color: #666;"></span>
            </div>
        `;
        
        const pagesContainer = document.createElement('div');
        pagesContainer.className = 'pdf-pages-container';
        pagesContainer.style.cssText = `
            display: flex;
            gap: 20px;
            flex: 1;
            align-items: center;
            justify-content: center;
            min-height: 0;
            padding: 10px;
            overflow: hidden;
        `;
        
        // Create containers for canvas + text layer
        const pageContainer1 = document.createElement('div');
        pageContainer1.id = 'pdf-container-left';
        pageContainer1.style.cssText = `
            position: relative;
            flex: 1;
            max-height: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
            overflow: hidden;
        `;

        const canvas1 = document.createElement('canvas');
        canvas1.id = 'pdf-page-left';
        canvas1.style.cssText = `
            max-width: 100%;
            max-height: 100%;
            border: 1px solid #ccc;
            display: block;
        `;

        const textLayer1 = document.createElement('div');
        textLayer1.id = 'pdf-text-layer-left';
        textLayer1.className = 'textLayer';
        textLayer1.style.cssText = `
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            overflow: hidden;
            opacity: 0;
            line-height: 1.0;
            pointer-events: none;
            user-select: text;
            z-index: 2;
        `;

        pageContainer1.appendChild(canvas1);
        pageContainer1.appendChild(textLayer1);

        const pageContainer2 = document.createElement('div');
        pageContainer2.id = 'pdf-container-right';
        pageContainer2.style.cssText = `
            position: relative;
            flex: 1;
            max-height: 100%;
            display: none;
            justify-content: center;
            align-items: center;
            overflow: hidden;
        `;

        const canvas2 = document.createElement('canvas');
        canvas2.id = 'pdf-page-right';
        canvas2.style.cssText = `
            max-width: 100%;
            max-height: 100%;
            border: 1px solid #ccc;
            display: block;
        `;

        const textLayer2 = document.createElement('div');
        textLayer2.id = 'pdf-text-layer-right';
        textLayer2.className = 'textLayer';
        textLayer2.style.cssText = `
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            overflow: hidden;
            opacity: 0;
            line-height: 1.0;
            pointer-events: none;
            user-select: text;
            z-index: 2;
        `;

        pageContainer2.appendChild(canvas2);
        pageContainer2.appendChild(textLayer2);
        
        pagesContainer.appendChild(pageContainer1);
        pagesContainer.appendChild(pageContainer2);
        
        pdfContainer.appendChild(controls);
        pdfContainer.appendChild(pagesContainer);
        contentOther.appendChild(pdfContainer);
        contentOther.style.display = 'block';
        
        // Add CSS for PDF text layer styling
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
            }
            
            #pdf-text-layer-left:hover, #pdf-text-layer-right:hover {
                background: rgba(255, 255, 0, 0.05);
            }
        `;
        document.head.appendChild(style);
        
        const prevBtn = controls.querySelector('#pdf-prev');
        const nextBtn = controls.querySelector('#pdf-next');
        const pageInfo = controls.querySelector('#pdf-page-info');
        const jumpInput = controls.querySelector('#pdf-page-jump');
        const jumpBtn = controls.querySelector('#pdf-jump-btn');
        const doublePageToggle = controls.querySelector('#pdf-double-page-toggle');
        const textToggle = controls.querySelector('#pdf-text-toggle');
        const statusElement = controls.querySelector('#pdf-status');
        
        let textLayerVisible = false;

        const updatePageInfo = () => {
            if (this.doublePageMode && this.totalPages) {
                const endPage = Math.min(this.currentPage + 1, this.totalPages);
                if (endPage > this.currentPage) {
                    pageInfo.textContent = `Pages ${this.currentPage}-${endPage} of ${this.totalPages}`;
                } else {
                    pageInfo.textContent = `Page ${this.currentPage} of ${this.totalPages}`;
                }
            } else {
                pageInfo.textContent = `Page ${this.currentPage} of ${this.totalPages}`;
            }
            
            prevBtn.disabled = this.currentPage === 1;
            if (this.doublePageMode) {
                nextBtn.disabled = this.currentPage >= this.totalPages;
            } else {
                nextBtn.disabled = this.currentPage === this.totalPages;
            }
        };

        const toggleTextLayer = () => {
            textLayerVisible = !textLayerVisible;
            textToggle.innerHTML = textLayerVisible ? '🔤 Text Selection ON' : '🔤 Text Selection';
            textToggle.style.background = textLayerVisible ? '#4CAF50' : '#FF9800';
            
            const textLayer1 = document.getElementById('pdf-text-layer-left');
            const textLayer2 = document.getElementById('pdf-text-layer-right');
            
            if (textLayerVisible) {
                textLayer1.style.opacity = '0.01';
                textLayer1.style.pointerEvents = 'auto';
                textLayer1.style.display = 'block';
                textLayer2.style.opacity = '0.01';
                textLayer2.style.pointerEvents = 'auto';
                textLayer2.style.display = 'block';
            } else {
                textLayer1.style.opacity = '0';
                textLayer1.style.pointerEvents = 'none';
                textLayer2.style.opacity = '0';
                textLayer2.style.pointerEvents = 'none';
            }
        };

        const toggleDoublePageMode = () => {
            this.doublePageMode = !this.doublePageMode;
            doublePageToggle.innerHTML = this.doublePageMode ? '📄 Single Page' : '📖 Double Page';
            doublePageToggle.style.background = this.doublePageMode ? '#4CAF50' : '#2196F3';
            
            const container1 = document.getElementById('pdf-container-left');
            const container2 = document.getElementById('pdf-container-right');
            
            if (this.doublePageMode) {
                container2.style.display = 'flex';
            } else {
                container2.style.display = 'none';
            }
            
            renderPage(this.currentPage);
        };
        
        const renderPage = async (pageNumber) => {
            if (!this.pdfDoc || pageNumber < 1 || pageNumber > this.totalPages) {
                return;
            }
            
            if (pageNumber < 1) pageNumber = 1;
            if (this.totalPages && pageNumber > this.totalPages) {
                pageNumber = this.doublePageMode ? 
                    (this.totalPages % 2 === 0 ? this.totalPages - 1 : this.totalPages) : 
                    this.totalPages;
                if (pageNumber < 1) pageNumber = 1;
            }
            
            this.currentPage = pageNumber;
            statusElement.textContent = 'Loading...';
            
            try {
                const canvas1 = document.getElementById('pdf-page-left');
                const canvas2 = document.getElementById('pdf-page-right');
                const textLayer1 = document.getElementById('pdf-text-layer-left');
                const textLayer2 = document.getElementById('pdf-text-layer-right');
                
                // Helper function to render text layer
                const renderTextLayer = async (page, viewport, textLayerDiv, canvas) => {
                    textLayerDiv.innerHTML = '';
                    
                    // Match the canvas dimensions exactly
                    const canvasRect = canvas.getBoundingClientRect();
                    const canvasStyle = window.getComputedStyle(canvas);
                    
                    textLayerDiv.style.width = canvas.width + 'px';
                    textLayerDiv.style.height = canvas.height + 'px';
                    textLayerDiv.style.left = '0px';
                    textLayerDiv.style.top = '0px';
                    textLayerDiv.style.transform = 'none';
                    
                    try {
                        const textContent = await page.getTextContent();
                        pdfjsLib.renderTextLayer({
                            textContent: textContent,
                            container: textLayerDiv,
                            viewport: viewport,
                            textDivs: []
                        });
                    } catch (textError) {
                        console.warn('Text layer render failed:', textError);
                    }
                };
                
                // Render left page
                const page1 = await this.pdfDoc.getPage(pageNumber);
                const viewport1 = page1.getViewport({ scale: 1.5 });
                const context1 = canvas1.getContext('2d');
                canvas1.height = viewport1.height;
                canvas1.width = viewport1.width;
                const renderContext1 = {
                    canvasContext: context1,
                    viewport: viewport1
                };
                await page1.render(renderContext1).promise;
                await renderTextLayer(page1, viewport1, textLayer1, canvas1);
                
                // Render right page if in double page mode and page exists
                if (this.doublePageMode && pageNumber + 1 <= this.totalPages) {
                    const page2 = await this.pdfDoc.getPage(pageNumber + 1);
                    const viewport2 = page2.getViewport({ scale: 1.5 });
                    const context2 = canvas2.getContext('2d');
                    canvas2.height = viewport2.height;
                    canvas2.width = viewport2.width;
                    const renderContext2 = {
                        canvasContext: context2,
                        viewport: viewport2
                    };
                    await page2.render(renderContext2).promise;
                    await renderTextLayer(page2, viewport2, textLayer2, canvas2);
                } else if (this.doublePageMode) {
                    // Clear right canvas and text layer if no page to show
                    const context2 = canvas2.getContext('2d');
                    context2.clearRect(0, 0, canvas2.width, canvas2.height);
                    textLayer2.innerHTML = '';
                }
                
                statusElement.textContent = '';
                updatePageInfo();
            } catch (error) {
                console.error('PDF page render error:', error);
                statusElement.textContent = `Error: ${error.message}`;
            }
        };

        const navigatePrev = () => {
            const step = this.doublePageMode ? 2 : 1;
            renderPage(this.currentPage - step);
        };

        const navigateNext = () => {
            const step = this.doublePageMode ? 2 : 1;
            renderPage(this.currentPage + step);
        };

        prevBtn.addEventListener('click', navigatePrev);
        nextBtn.addEventListener('click', navigateNext);
        doublePageToggle.addEventListener('click', toggleDoublePageMode);
        textToggle.addEventListener('click', toggleTextLayer);
        jumpBtn.addEventListener('click', () => {
            const page = parseInt(jumpInput.value, 10);
            if (!isNaN(page)) {
                renderPage(page);
            }
        });

        this.handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT') return;
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                navigatePrev();
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                navigateNext();
            } else if (e.key === 'd' || e.key === 'D') {
                e.preventDefault();
                toggleDoublePageMode();
            } else if (e.key === 't' || e.key === 'T') {
                e.preventDefault();
                toggleTextLayer();
            }
        };
        document.addEventListener('keydown', this.handleKeyDown);

        try {
            statusElement.textContent = 'Loading PDF...';
            const url = `/files?path=${encodeURIComponent(filePath)}`;
            const loadingTask = pdfjsLib.getDocument(url);
            this.pdfDoc = await loadingTask.promise;
            this.totalPages = this.pdfDoc.numPages;
            await renderPage(1);
        } catch (error) {
            console.error('PDF load error:', error);
            statusElement.textContent = `Error: ${error.message}`;
        }
    }
}

class EpubRenderer {
    constructor() {
        this.handleKeyDown = null;
        this.doublePageMode = false;
        this.currentChapter = 0;
        this.totalChapters = 0;
    }

    cleanup() {
        if (this.handleKeyDown) {
            document.removeEventListener('keydown', this.handleKeyDown);
            this.handleKeyDown = null;
        }
    }

    async render(filePath, fileName, contentCode, contentOther) {
        this.cleanup();
        try {
            const response = await window.authManager.authenticatedFetch(`/epub-preview?path=${encodeURIComponent(filePath)}`);
            const epubData = await response.json();
            
            if (!response.ok) {
                throw new Error(epubData.error || 'Failed to load EPUB');
            }
            
            const epubContainer = document.createElement('div');
            epubContainer.className = 'epub-container';
            epubContainer.style.cssText = `
                background: rgba(255, 255, 255, 0.1);
                padding: 20px;
                border-radius: 15px;
                border: 1px solid rgba(255, 255, 255, 0.2);
                min-height: 70vh;
                max-height: 85vh;
                overflow: visible;
                display: flex;
                flex-direction: column;
            `;
            
            // Create header with book info and cover
            const header = document.createElement('div');
            header.className = 'epub-header';
            header.style.cssText = `
                margin-bottom: 20px;
                padding: 15px;
                background: rgba(78, 205, 196, 0.1);
                border-radius: 10px;
                border-left: 3px solid #4ecdc4;
                display: flex;
                gap: 20px;
                align-items: flex-start;
            `;
            
            let headerContent = `
                <div style="flex: 1;">
                    <h3 style="color: #4ecdc4; margin: 0 0 10px 0; font-size: 1.4rem; font-weight: bold;">
                        ${epubData.metadata.title || fileName}
                    </h3>
                    ${epubData.metadata.creator ? `<p style="color: #ffffff; margin: 8px 0; font-size: 1rem; font-weight: 500;">Author: ${epubData.metadata.creator}</p>` : ''}
                    ${epubData.metadata.description ? `<p style="color: rgba(255,255,255,0.9); margin: 8px 0; font-size: 0.9rem; font-style: italic; line-height: 1.4;">${epubData.metadata.description}</p>` : ''}
                </div>
            `;
            
            if (epubData.coverImage) {
                headerContent += `
                    <div style="flex-shrink: 0;">
                        <img src="/epub-cover?path=${encodeURIComponent(filePath)}&cover=${encodeURIComponent(epubData.coverImage)}" 
                             alt="Book cover" 
                             style="max-width: 120px; max-height: 160px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);" 
                             onerror="this.parentNode.innerHTML='<div style=&quot;width: 120px; height: 160px; background: rgba(78, 205, 196, 0.1); border: 2px dashed #4ecdc4; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #4ecdc4; font-size: 0.8rem; text-align: center; padding: 10px;&quot;>Cover image<br>not found</div>'">
                    </div>
                `;
            }
            
            header.innerHTML = headerContent;
            
            // Create navigation controls
            const controls = document.createElement('div');
            controls.className = 'epub-controls';
            controls.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
                padding: 15px;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 10px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                flex-wrap: wrap;
                gap: 10px;
            `;
            
            controls.innerHTML = `
                <button id="epub-prev">‹ Previous</button>
                <select id="epub-chapter-select" style="flex: 1; max-width: 300px;"></select>
                <button id="epub-next">Next ›</button>
                <button id="epub-double-page-toggle" style="margin-left: 10px;">Double Chapter</button>
                <span id="epub-page-info" style="margin: 0 10px;"></span>
                <input type="number" id="epub-page-jump" placeholder="Chapter" style="width: 80px;">
                <button id="epub-jump-btn">Go</button>
            `;

            const chapterSelect = controls.querySelector('#epub-chapter-select');
            epubData.chapters.forEach((chapter, index) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = chapter.title || `Chapter ${index + 1}`;
                chapterSelect.appendChild(option);
            });
            
            // Create content area
            const contentContainer = document.createElement('div');
            contentContainer.className = 'epub-content-container';
            contentContainer.style.cssText = `
                flex: 1;
                display: flex;
                gap: 20px;
                min-height: 400px;
                max-height: 60vh;
            `;
            
            const contentArea = document.createElement('div');
            contentArea.id = 'epub-content';
            contentArea.style.cssText = `
                flex: 1;
                overflow-y: auto;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 10px;
                padding: 30px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                font-family: 'Georgia', 'Times New Roman', serif;
                font-size: 16px;
                line-height: 1.8;
                color: #ffffff;
                box-shadow: inset 0 2px 8px rgba(0,0,0,0.2);
                scrollbar-width: thin;
                scrollbar-color: #4ecdc4 transparent;
            `;
            
            const contentArea2 = document.createElement('div');
            contentArea2.id = 'epub-content-2';
            contentArea2.style.cssText = `
                flex: 1;
                overflow-y: auto;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 10px;
                padding: 30px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                font-family: 'Georgia', 'Times New Roman', serif;
                font-size: 16px;
                line-height: 1.8;
                color: #ffffff;
                box-shadow: inset 0 2px 8px rgba(0,0,0,0.2);
                scrollbar-width: thin;
                scrollbar-color: #4ecdc4 transparent;
                display: none;
            `;
            
            contentContainer.appendChild(contentArea);
            contentContainer.appendChild(contentArea2);
            
            // Add custom scrollbar styles
            const style = document.createElement('style');
            style.textContent = `
                #epub-content::-webkit-scrollbar {
                    width: 8px;
                }
                #epub-content::-webkit-scrollbar-track {
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 10px;
                }
                #epub-content::-webkit-scrollbar-thumb {
                    background: #4ecdc4;
                    border-radius: 10px;
                }
                #epub-content::-webkit-scrollbar-thumb:hover {
                    background: #45b7aa;
                }
            `;
            document.head.appendChild(style);
            
            // Assemble the container
            epubContainer.appendChild(header);
            epubContainer.appendChild(controls);
            epubContainer.appendChild(contentContainer);
            
            const prevBtn = controls.querySelector('#epub-prev');
            const nextBtn = controls.querySelector('#epub-next');
            const pageInfo = controls.querySelector('#epub-page-info');
            const jumpInput = controls.querySelector('#epub-page-jump');
            const jumpBtn = controls.querySelector('#epub-jump-btn');
            const doublePageToggle = controls.querySelector('#epub-double-page-toggle');

            this.currentChapter = 0;
            this.totalChapters = epubData.chapters.length;

            const toggleDoublePageMode = () => {
                this.doublePageMode = !this.doublePageMode;
                doublePageToggle.textContent = this.doublePageMode ? 'Single Chapter' : 'Double Chapter';
                
                const contentArea2 = document.getElementById('epub-content-2');
                if (this.doublePageMode) {
                    contentArea2.style.display = 'block';
                } else {
                    contentArea2.style.display = 'none';
                }
                
                showChapter(this.currentChapter);
            };

            const styleContent = (container) => {
                const elements = container.querySelectorAll('*');
                elements.forEach(el => {
                    el.style.color = '#ffffff';
                    if (el.tagName === 'H1') {
                        el.style.color = '#4ecdc4';
                        el.style.fontSize = '1.8rem';
                        el.style.fontWeight = 'bold';
                        el.style.marginBottom = '20px';
                        el.style.marginTop = '25px';
                        el.style.borderBottom = '2px solid rgba(78, 205, 196, 0.3)';
                        el.style.paddingBottom = '10px';
                    }
                    if (el.tagName === 'H2') {
                        el.style.color = '#4ecdc4';
                        el.style.fontSize = '1.5rem';
                        el.style.fontWeight = '600';
                        el.style.marginBottom = '18px';
                        el.style.marginTop = '20px';
                    }
                    if (el.tagName === 'H3') {
                        el.style.color = '#4ecdc4';
                        el.style.fontSize = '1.3rem';
                        el.style.fontWeight = '600';
                        el.style.marginBottom = '15px';
                        el.style.marginTop = '18px';
                    }
                    if (el.tagName === 'P') {
                        el.style.marginBottom = '16px';
                        el.style.textAlign = 'justify';
                        el.style.fontSize = '16px';
                        el.style.lineHeight = '1.8';
                        el.style.color = 'rgba(255,255,255,0.95)';
                    }
                    if (el.tagName === 'IMG') {
                        el.style.maxWidth = '100%';
                        el.style.height = 'auto';
                        el.style.display = 'block';
                        el.style.margin = '20px auto';
                        el.style.borderRadius = '8px';
                        el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
                        
                        const src = el.src || el.getAttribute('src');
                        if (src && !src.startsWith('http') && !src.startsWith('/epub-cover')) {
                            const cleanPath = src.replace(/^\.\.\//, '');
                            el.src = `/epub-cover?path=${encodeURIComponent(filePath)}&cover=${encodeURIComponent(cleanPath)}`;
                            el.onerror = function() {
                                this.style.display = 'none';
                            };
                        }
                    }
                    if (el.tagName === 'BLOCKQUOTE') {
                        el.style.borderLeft = '4px solid #4ecdc4';
                        el.style.paddingLeft = '20px';
                        el.style.marginLeft = '0';
                        el.style.fontStyle = 'italic';
                        el.style.color = 'rgba(255,255,255,0.9)';
                        el.style.background = 'rgba(78, 205, 196, 0.05)';
                        el.style.padding = '15px 20px';
                        el.style.borderRadius = '0 8px 8px 0';
                    }
                });
            };

            const showChapter = (chapterIndex) => {
                if (chapterIndex >= 0 && chapterIndex < this.totalChapters) {
                    this.currentChapter = chapterIndex;
                    chapterSelect.value = chapterIndex;
                    
                    const processContent = (content) => {
                        // Rewrite image URLs to use the epub-cover endpoint
                        let processedContent = content;
                        
                        // Rewrite src attributes
                        processedContent = processedContent.replace(/src=["']([^"']*\.(jpg|jpeg|png|gif))["']/gi, (match, imagePath) => {
                            const cleanPath = imagePath.replace(/^\.\.\//, '');
                            return `src="/epub-cover?path=${encodeURIComponent(filePath)}&cover=${encodeURIComponent(cleanPath)}"`;
                        });
                        
                        // Rewrite CSS background-image in style attributes
                        processedContent = processedContent.replace(/style=["']([^"']*background[^"']*url\(["']?([^"')]*\.(jpg|jpeg|png|gif))["']?\)[^"']*)["']/gi, (match, styleContent, imagePath) => {
                            const cleanPath = imagePath.replace(/^\.\.\//, '');
                            const newUrl = `/epub-cover?path=${encodeURIComponent(filePath)}&cover=${encodeURIComponent(cleanPath)}`;
                            const newStyle = styleContent.replace(/url\(["']?[^"')]*\.(jpg|jpeg|png|gif)["']?\)/gi, `url("${newUrl}")`);
                            return `style="${newStyle}"`;
                        });
                        
                        // Rewrite CSS background-image in style blocks
                        processedContent = processedContent.replace(/background-image:\s*url\(["']?([^"')]*\.(jpg|jpeg|png|gif))["']?\)/gi, (match, imagePath) => {
                            const cleanPath = imagePath.replace(/^\.\.\//, '');
                            return `background-image: url("/epub-cover?path=${encodeURIComponent(filePath)}&cover=${encodeURIComponent(cleanPath)}")`;
                        });
                        
                        // Rewrite href attributes for image links
                        processedContent = processedContent.replace(/href=["']([^"']*\.(jpg|jpeg|png|gif))["']/gi, (match, imagePath) => {
                            const cleanPath = imagePath.replace(/^\.\.\//, '');
                            return `href="/epub-cover?path=${encodeURIComponent(filePath)}&cover=${encodeURIComponent(cleanPath)}"`;
                        });
                        
                        return processedContent;
                    };

                    const cleanContent = (container) => {
                        // Remove duplicate navigation elements from EPUB content
                        const navElements = container.querySelectorAll('button, input[type="button"], input[type="submit"], a[href*="next"], a[href*="prev"], form');
                        navElements.forEach(el => {
                            const text = el.textContent?.toLowerCase() || '';
                            const href = el.getAttribute('href')?.toLowerCase() || '';
                            if (text.includes('next') || text.includes('prev') || text.includes('continue') || 
                                href.includes('next') || href.includes('prev') || el.tagName === 'FORM') {
                                el.remove();
                            }
                        });
                    };

                    // Load content for left/first area
                    let content1 = processContent(epubData.chapters[chapterIndex].content);
                    contentArea.innerHTML = content1;
                    cleanContent(contentArea);
                    styleContent(contentArea);
                    
                    // Load content for right/second area if in double page mode
                    const contentArea2 = document.getElementById('epub-content-2');
                    if (this.doublePageMode && chapterIndex + 1 < this.totalChapters) {
                        let content2 = processContent(epubData.chapters[chapterIndex + 1].content);
                        contentArea2.innerHTML = content2;
                        cleanContent(contentArea2);
                        styleContent(contentArea2);
                    } else if (this.doublePageMode) {
                        contentArea2.innerHTML = '<div style="color: rgba(255,255,255,0.5); text-align: center; padding: 50px;">No more chapters</div>';
                    }
                    
                    // Update page info and navigation
                    if (this.doublePageMode && chapterIndex + 1 < this.totalChapters) {
                        pageInfo.textContent = `Chapters ${chapterIndex + 1}-${chapterIndex + 2} of ${this.totalChapters}`;
                    } else {
                        pageInfo.textContent = `Chapter ${chapterIndex + 1} of ${this.totalChapters}`;
                    }
                    
                    prevBtn.disabled = chapterIndex === 0;
                    if (this.doublePageMode) {
                        nextBtn.disabled = chapterIndex >= this.totalChapters - 1;
                    } else {
                        nextBtn.disabled = chapterIndex === this.totalChapters - 1;
                    }
                    
                    prevBtn.style.opacity = prevBtn.disabled ? '0.5' : '1';
                    nextBtn.style.opacity = nextBtn.disabled ? '0.5' : '1';
                }
            };
            
            const navigatePrev = () => {
                const step = this.doublePageMode ? 2 : 1;
                showChapter(this.currentChapter - step);
            };

            const navigateNext = () => {
                const step = this.doublePageMode ? 2 : 1;
                showChapter(this.currentChapter + step);
            };

            prevBtn.addEventListener('click', navigatePrev);
            nextBtn.addEventListener('click', navigateNext);
            doublePageToggle.addEventListener('click', toggleDoublePageMode);
            chapterSelect.addEventListener('change', (e) => showChapter(parseInt(e.target.value)));
            jumpBtn.addEventListener('click', () => {
                const chapterNum = parseInt(jumpInput.value, 10);
                if (chapterNum >= 1 && chapterNum <= this.totalChapters) {
                    showChapter(chapterNum - 1);
                }
            });

            this.handleKeyDown = (e) => {
                if (e.target.tagName === 'INPUT') return;
                if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    navigatePrev();
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    navigateNext();
                } else if (e.key === 'd' || e.key === 'D') {
                    e.preventDefault();
                    toggleDoublePageMode();
                }
            };
            document.addEventListener('keydown', this.handleKeyDown);
            
            showChapter(0);
            
            contentOther.appendChild(epubContainer);
            contentOther.style.display = 'block';
            
        } catch (error) {
            console.error('EPUB render error:', error);
            contentOther.innerHTML = `
                <div style="color: red; padding: 20px; background: rgba(255,255,255,0.1); border-radius: 10px;">
                    <h3>Error loading EPUB file</h3>
                    <p>${error.message}</p>
                    <p style="margin-top: 15px; font-size: 0.9rem; opacity: 0.8;">
                        <a href="/files?path=${encodeURIComponent(filePath)}" 
                           download="${fileName}" 
                           style="color: #4ecdc4; text-decoration: none;">
                            Download file instead
                        </a>
                    </p>
                </div>
            `;
            contentOther.style.display = 'block';
        }
    }
}