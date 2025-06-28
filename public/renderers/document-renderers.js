class PDFRenderer {
    constructor() {
        this.handleKeyDown = null;
        this.currentPage = 1;
        this.totalPages = null;
        this.pdfDoc = null;
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
        
        const controls = document.createElement('div');
        controls.className = 'pdf-controls';
        controls.style.cssText = `display: flex; align-items: center; margin-bottom: 10px;`;
        controls.innerHTML = `
            <button id="pdf-prev">Previous</button>
            <span id="pdf-page-info" style="margin: 0 10px;">Page 1</span>
            <button id="pdf-next">Next</button>
            <input type="number" id="pdf-page-jump" placeholder="Page" style="width: 60px; margin-left: 20px;">
            <button id="pdf-jump-btn" style="margin-left: 5px;">Go</button>
            <span id="pdf-status" style="margin-left: 10px; font-style: italic;"></span>
        `;
        
        const canvas = document.createElement('canvas');
        canvas.style.maxWidth = '100%';
        canvas.style.border = '1px solid #ccc';
        
        pdfContainer.appendChild(controls);
        pdfContainer.appendChild(canvas);
        contentOther.appendChild(pdfContainer);
        contentOther.style.display = 'block';
        
        const prevBtn = controls.querySelector('#pdf-prev');
        const nextBtn = controls.querySelector('#pdf-next');
        const pageInfo = controls.querySelector('#pdf-page-info');
        const jumpInput = controls.querySelector('#pdf-page-jump');
        const jumpBtn = controls.querySelector('#pdf-jump-btn');
        const statusElement = controls.querySelector('#pdf-status');

        const updatePageInfo = () => {
            pageInfo.textContent = `Page ${this.currentPage} of ${this.totalPages}`;
            prevBtn.disabled = this.currentPage === 1;
            nextBtn.disabled = this.currentPage === this.totalPages;
        };
        
        const renderPage = async (pageNumber) => {
            if (!this.pdfDoc || pageNumber < 1 || pageNumber > this.totalPages) {
                return;
            }
            this.currentPage = pageNumber;
            statusElement.textContent = 'Loading...';
            try {
                const page = await this.pdfDoc.getPage(pageNumber);
                const viewport = page.getViewport({ scale: 1.5 });
                const context = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                const renderContext = {
                    canvasContext: context,
                    viewport: viewport
                };
                await page.render(renderContext).promise;
                statusElement.textContent = '';
                updatePageInfo();
            } catch (error) {
                console.error('PDF page render error:', error);
                statusElement.textContent = `Error: ${error.message}`;
            }
        };

        prevBtn.addEventListener('click', () => renderPage(this.currentPage - 1));
        nextBtn.addEventListener('click', () => renderPage(this.currentPage + 1));
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
                prevBtn.click();
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                nextBtn.click();
            }
        };
        document.addEventListener('keydown', this.handleKeyDown);

        try {
            statusElement.textContent = 'Loading PDF...';
            const url = filePath.startsWith('/') ? `/files?path=${encodeURIComponent(filePath)}` : filePath;
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
            `;
            
            controls.innerHTML = `
                <button id="epub-prev">‹ Previous</button>
                <select id="epub-chapter-select" style="flex: 1; max-width: 300px;"></select>
                <button id="epub-next">Next ›</button>
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
            const contentArea = document.createElement('div');
            contentArea.id = 'epub-content';
            contentArea.style.cssText = `
                flex: 1;
                min-height: 400px;
                max-height: 60vh;
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
            epubContainer.appendChild(contentArea);
            
            const prevBtn = controls.querySelector('#epub-prev');
            const nextBtn = controls.querySelector('#epub-next');
            const pageInfo = controls.querySelector('#epub-page-info');
            const jumpInput = controls.querySelector('#epub-page-jump');
            const jumpBtn = controls.querySelector('#epub-jump-btn');

            let currentChapter = 0;
            const totalChapters = epubData.chapters.length;

            const showChapter = (chapterIndex) => {
                if (chapterIndex >= 0 && chapterIndex < totalChapters) {
                    currentChapter = chapterIndex;
                    chapterSelect.value = chapterIndex;
                    contentArea.innerHTML = epubData.chapters[chapterIndex].content;
                    
                    // Style the content
                    const elements = contentArea.querySelectorAll('*');
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
                            
                            // Fix EPUB image paths
                            const src = el.src || el.getAttribute('src');
                            if (src && !src.startsWith('http') && !src.startsWith('/')) {
                                // Convert relative EPUB image paths to use our images endpoint
                                const filename = src.split('/').pop();
                                el.src = `/images/${filename}?epub=${encodeURIComponent(filePath)}`;
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
                    
                    pageInfo.textContent = `Chapter ${currentChapter + 1} of ${totalChapters}`;
                    prevBtn.disabled = chapterIndex === 0;
                    nextBtn.disabled = chapterIndex === totalChapters - 1;
                    
                    prevBtn.style.opacity = prevBtn.disabled ? '0.5' : '1';
                    nextBtn.style.opacity = nextBtn.disabled ? '0.5' : '1';
                }
            };
            
            prevBtn.addEventListener('click', () => showChapter(currentChapter - 1));
            nextBtn.addEventListener('click', () => showChapter(currentChapter + 1));
            chapterSelect.addEventListener('change', (e) => showChapter(parseInt(e.target.value)));
            jumpBtn.addEventListener('click', () => {
                const chapterNum = parseInt(jumpInput.value, 10);
                if (chapterNum >= 1 && chapterNum <= totalChapters) {
                    showChapter(chapterNum - 1);
                }
            });

            this.handleKeyDown = (e) => {
                if (e.target.tagName === 'INPUT') return;
                if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    prevBtn.click();
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    nextBtn.click();
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