// EpubRenderer for EPUB books
class EpubRenderer {
    constructor() {
        this.handleKeyDown = null;
        this.doublePageMode = true;
        this.coverMode = true;
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
            console.log(`[EPUB Debug] Fetching: /epub-preview?path=${encodeURIComponent(filePath)}`);
            const response = await window.authManager.authenticatedFetch(`/epub-preview?path=${encodeURIComponent(filePath)}`);
            console.log(`[EPUB Debug] Response status: ${response.status}`);
            console.log(`[EPUB Debug] Response headers:`, response.headers);
            
            // Check if response is actually JSON
            const contentType = response.headers.get('content-type');
            console.log(`[EPUB Debug] Content-Type: ${contentType}`);
            
            const responseText = await response.text();
            console.log(`[EPUB Debug] Raw response:`, responseText.substring(0, 500));
            
            let epubData;
            try {
                epubData = JSON.parse(responseText);
            } catch (parseError) {
                console.error(`[EPUB Debug] JSON parse error:`, parseError);
                console.error(`[EPUB Debug] Response was not JSON:`, responseText);
                throw new Error(`Server returned non-JSON response: ${responseText.substring(0, 100)}`);
            }
            
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
                height: 100%;
                overflow: visible;
                display: flex;
                flex-direction: column;
                position: relative;
            `;
            
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
            
            const controls = document.createElement('div');
            controls.className = 'epub-controls';
            controls.style.cssText = `
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                display: flex;
                justify-content: center;
                align-items: center;
                padding: 10px;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(10px);
                border-top: 1px solid rgba(255, 255, 255, 0.2);
                flex-wrap: wrap;
                gap: 10px;
                z-index: 10;
                opacity: 0;
                transition: opacity 0.3s ease-in-out;
            `;
            epubContainer.addEventListener('mouseenter', () => controls.style.opacity = '1');
            epubContainer.addEventListener('mouseleave', () => controls.style.opacity = '0');
            
            controls.innerHTML = `
                <button id="epub-prev">‹ Previous</button>
                <select id="epub-chapter-select" style="flex: 1; max-width: 300px;"></select>
                <button id="epub-next">Next ›</button>
                <button id="epub-double-page-toggle" style="margin-left: 10px;" title="Toggle Double Chapter View">📖</button>
                <button id="epub-cover-mode-toggle" style="margin-left: 10px;" title="Treat first chapter as cover for proper book layout">📚</button>
                <span id="epub-page-info" style="margin: 0 10px; color: white;"></span>
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
                display: block;
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
            epubContainer.appendChild(contentContainer);
            epubContainer.appendChild(controls);
            
            const prevBtn = controls.querySelector('#epub-prev');
            const nextBtn = controls.querySelector('#epub-next');
            const pageInfo = controls.querySelector('#epub-page-info');
            const jumpInput = controls.querySelector('#epub-page-jump');
            const jumpBtn = controls.querySelector('#epub-jump-btn');
            const doublePageToggle = controls.querySelector('#epub-double-page-toggle');
            const coverModeToggle = controls.querySelector('#epub-cover-mode-toggle');

            // Set initial button states to reflect default enabled modes
            doublePageToggle.textContent = 'Single Chapter';
            coverModeToggle.innerHTML = '📚 Cover Mode ON';
            coverModeToggle.style.background = '#4CAF50';

            this.currentChapter = 0;
            this.totalChapters = epubData.chapters.length;

            const toggleCoverMode = () => {
                this.coverMode = !this.coverMode;
                coverModeToggle.innerHTML = this.coverMode ? '📚 Cover Mode ON' : '📚 Cover Mode';
                coverModeToggle.style.background = this.coverMode ? '#4CAF50' : '#9C27B0';
                
                // Simply refresh the current view - no complex logic needed
                showChapter(this.currentChapter);
            };

            const toggleDoublePageMode = () => {
                this.doublePageMode = !this.doublePageMode;
                doublePageToggle.textContent = this.doublePageMode ? 'Single Chapter' : 'Double Chapter';
                
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
                        console.log('[EPUB] Original content sample:', content.substring(0, 200));
                        
                        // Rewrite image URLs to use the epub-cover endpoint
                        let processedContent = content;
                        
                        // Fix HTML entities and escaped tags that might be causing display issues
                        processedContent = processedContent
                            .replace(/&lt;/g, '<')
                            .replace(/&gt;/g, '>')
                            .replace(/&amp;/g, '&')
                            .replace(/&quot;/g, '"')
                            .replace(/&#39;/g, "'");
                        
                        console.log('[EPUB] Processed content sample:', processedContent.substring(0, 200));
                        
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
                    if (this.doublePageMode) {
                        // Simple double-page logic: always show next chapter if available
                        const nextChapterIndex = chapterIndex + 1;
                        
                        if (nextChapterIndex < this.totalChapters) {
                            // Show next chapter on right page
                            let content2 = processContent(epubData.chapters[nextChapterIndex].content);
                            contentArea2.innerHTML = content2;
                            cleanContent(contentArea2);
                            styleContent(contentArea2);
                        } else {
                            // No more chapters - show empty page
                            contentArea2.innerHTML = '<div style="color: rgba(255,255,255,0.5); text-align: center; padding: 50px; font-style: italic;">End of book</div>';
                        }
                    }
                    
                    // Update page info and navigation
                    if (this.doublePageMode) {
                        const nextChapterIndex = chapterIndex + 1;
                        if (nextChapterIndex < this.totalChapters) {
                            pageInfo.textContent = `Chapters ${chapterIndex + 1}-${nextChapterIndex + 1} of ${this.totalChapters}`;
                        } else {
                            pageInfo.textContent = `Chapter ${chapterIndex + 1} of ${this.totalChapters}`;
                        }
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
                if (!this.doublePageMode) {
                    showChapter(this.currentChapter - 1);
                    return;
                }
                
                // Simple double-page navigation: go back by 1 chapter
                showChapter(this.currentChapter - 1);
            };

            const navigateNext = () => {
                if (!this.doublePageMode) {
                    showChapter(this.currentChapter + 1);
                    return;
                }
                
                // Simple double-page navigation: go forward by 1 chapter
                showChapter(this.currentChapter + 1);
            };

            prevBtn.addEventListener('click', navigatePrev);
            nextBtn.addEventListener('click', navigateNext);
            doublePageToggle.addEventListener('click', toggleDoublePageMode);
            coverModeToggle.addEventListener('click', toggleCoverMode);
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
                } else if (e.key === 'c' || e.key === 'C') {
                    e.preventDefault();
                    toggleCoverMode();
                }
            };
            document.addEventListener('keydown', this.handleKeyDown);
            
            contentOther.appendChild(epubContainer);
            contentOther.style.display = 'block';
            
            showChapter(0);
            
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