class TextRenderer {
    constructor() {
        this.handleKeyDown = null;
        this.currentPage = 1;
        this.pages = [];
        this.linesPerPage = 50;
        this.doublePageMode = true;
        this.coverMode = true;
    }

    // Map file extensions to highlight.js language identifiers
    getLanguageFromExtension(extension) {
        const languageMap = {
            // Common programming languages
            'js': 'javascript',
            'py': 'python',
            'c': 'c',
            'cpp': 'cpp',
            'h': 'c',
            'hpp': 'cpp',
            'java': 'java',
            'go': 'go',
            'rs': 'rust',
            'php': 'php',
            'rb': 'ruby',
            'swift': 'swift',
            'kt': 'kotlin',
            'dart': 'dart',
            'r': 'r',
            'scala': 'scala',
            'clj': 'clojure',
            'elm': 'elm',
            'ts': 'typescript',
            'tsx': 'typescript',
            'jsx': 'javascript',
            
            // Scripting and shell
            'sh': 'bash',
            'bat': 'batch',
            'ps1': 'powershell',
            'lua': 'lua',
            'pl': 'perl',
            'lsl': 'cpp', // LSL syntax is similar to C/C++
            
            // Web technologies
            'html': 'html',
            'css': 'css',
            'scss': 'scss',
            'sass': 'sass',
            'less': 'less',
            'vue': 'vue',
            'svelte': 'javascript',
            'astro': 'javascript',
            
            // Data and config
            'json': 'json',
            'xml': 'xml',
            'yaml': 'yaml',
            'yml': 'yaml',
            'toml': 'toml',
            'ini': 'ini',
            'conf': 'apache',
            
            // Database
            'sql': 'sql',
            
            // Assembly and low-level
            'asm': 'x86asm',
            's': 'x86asm',
            
            // Other languages
            'vb': 'vbnet',
            'pas': 'pascal',
            'f90': 'fortran',
            'f95': 'fortran',
            'f03': 'fortran',
            'f08': 'fortran',
            'for': 'fortran',
            'cobol': 'cobol',
            'cob': 'cobol',
            'zig': 'zig',
            'm': 'objectivec',
            'mm': 'objectivec',
            'groovy': 'groovy',
            'gradle': 'gradle',
            'cmake': 'cmake',
            'dockerfile': 'dockerfile',
            
            // Markup and documentation
            'md': 'markdown',
            'tex': 'latex',
            'srt': 'srt',
            
            // Default fallbacks
            'txt': 'plaintext',
            'log': 'plaintext',
            'csv': 'csv'
        };
        
        return languageMap[extension] || 'plaintext';
    }

    cleanup() {
        if (this.handleKeyDown) {
            document.removeEventListener('keydown', this.handleKeyDown);
            this.handleKeyDown = null;
        }
    }

    async render(filePath, fileName, contentCode, contentOther, options = {}) {
        this.cleanup();
        const extension = fileName.split('.').pop().toLowerCase();
        const response = await window.authManager.authenticatedFetch(`/files?path=${encodeURIComponent(filePath)}`);
        
        if (!response) {
            throw new Error('Authentication required');
        }
        
        if (!response.ok) {
            // Check for file-not-found errors and trigger auto-refresh
            if (response.status === 404 || response.status === 410) {
                console.log(`[TextRenderer] File not found: ${fileName}, triggering directory refresh`);
                
                // Show toast notification
                if (typeof showToast === 'function') {
                    showToast(`File "${fileName}" not found. The file may have been renamed, moved, or deleted. Refreshing...`, 'info');
                }
                
                contentOther.innerHTML = `
                    <div style="padding: 20px; margin: 20px; background: rgba(33, 150, 243, 0.1); border: 1px solid rgba(33, 150, 243, 0.3); border-radius: 8px; color: #64b5f6; font-family: monospace; text-align: center;">
                        <h3 style="color: #64b5f6; margin: 0 0 15px 0;">🔄 File Changed</h3>
                        <p style="margin: 10px 0; font-size: 14px;">
                            <strong>${fileName}</strong> was not found.
                        </p>
                        <p style="margin: 10px 0; font-size: 12px; opacity: 0.8;">
                            The file may have been renamed, moved, or deleted. Refreshing directory...
                        </p>
                    </div>
                `;
                contentOther.style.display = 'block';
                
                // Trigger directory refresh after a brief delay
                setTimeout(() => {
                    if (window.fileExplorer && window.fileExplorer.loadFiles) {
                        const currentPath = window.fileExplorer.currentPath();
                        console.log(`[TextRenderer] Refreshing directory: ${currentPath}`);
                        window.fileExplorer.loadFiles(currentPath);
                    }
                }, 500);
                return;
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const text = await response.text();

        if (extension === 'csv') {
            this.renderCSV(text, contentOther);
        } else if (extension === 'srt') {
            this.renderSRT(text, contentOther);
        } else {
            this.renderPaginatedText(text, contentOther, extension);
        }
    }

    renderPaginatedText(text, contentOther, extension) {
        const lines = text.split('\n');
        this.pages = [];
        for (let i = 0; i < lines.length; i += this.linesPerPage) {
            this.pages.push(lines.slice(i, i + this.linesPerPage).join('\n'));
        }
        this.currentPage = 1;

        const textContainer = document.createElement('div');
        textContainer.className = 'text-container';
        textContainer.style.cssText = `height: 100%; display: flex; flex-direction: column; position: relative;`;

        const controls = document.createElement('div');
        controls.className = 'text-controls';
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
        textContainer.addEventListener('mouseenter', () => controls.style.opacity = '1');
        textContainer.addEventListener('mouseleave', () => controls.style.opacity = '0');

        controls.innerHTML = `
            <button id="text-prev">Previous</button>
            <span id="text-page-info" style="margin: 0 10px; color: white;"></span>
            <button id="text-next">Next</button>
            <input type="number" id="text-page-jump" placeholder="Page" style="width: 60px; margin-left: 20px;">
            <button id="text-jump-btn" style="margin-left: 5px;">Go</button>
            <button id="text-double-page-toggle" style="margin-left: 20px;" title="Toggle Double Page View">📖</button>
            <button id="text-cover-mode-toggle" style="margin-left: 10px;" title="Treat first page as cover">📚</button>
        `;

        const pagesContainer = document.createElement('div');
        pagesContainer.className = 'text-pages-container';
        pagesContainer.style.cssText = `
            display: flex;
            gap: 20px;
            flex: 1;
            min-height: 0;
            height: 100%;
        `;

        const pageContent1 = document.createElement('pre');
        pageContent1.id = 'text-page-left';
        pageContent1.style.cssText = `
            flex: 1;
            margin: 0;
            padding: 20px;
            background: #222;
            color: #f8f8f2;
            border-radius: 8px;
            font-family: 'Fira Mono', 'Consolas', 'Menlo', 'Monaco', 'Liberation Mono', monospace;
            line-height: 1.6;
            overflow-y: auto;
            white-space: pre-wrap;
            word-break: break-word;
        `;
        const codeContent1 = document.createElement('code');
        pageContent1.appendChild(codeContent1);

        const pageContent2 = document.createElement('pre');
        pageContent2.id = 'text-page-right';
        pageContent2.style.cssText = `
            flex: 1;
            margin: 0;
            padding: 20px;
            background: #222;
            color: #f8f8f2;
            border-radius: 8px;
            font-family: 'Fira Mono', 'Consolas', 'Menlo', 'Monaco', 'Liberation Mono', monospace;
            line-height: 1.6;
            overflow-y: auto;
            white-space: pre-wrap;
            word-break: break-word;
            display: block;
        `;
        const codeContent2 = document.createElement('code');
        pageContent2.appendChild(codeContent2);

        pagesContainer.appendChild(pageContent1);
        pagesContainer.appendChild(pageContent2);

        textContainer.appendChild(pagesContainer);
        textContainer.appendChild(controls);
        contentOther.appendChild(textContainer);
        contentOther.style.display = 'block';

        const prevBtn = controls.querySelector('#text-prev');
        const nextBtn = controls.querySelector('#text-next');
        const pageInfo = controls.querySelector('#text-page-info');
        const jumpInput = controls.querySelector('#text-page-jump');
        const jumpBtn = controls.querySelector('#text-jump-btn');
        const doublePageToggle = controls.querySelector('#text-double-page-toggle');
        const coverModeToggle = controls.querySelector('#text-cover-mode-toggle');

        // Set initial button states to reflect default enabled modes
        doublePageToggle.innerHTML = '📄 Single Page';
        doublePageToggle.style.background = '#4CAF50';
        coverModeToggle.innerHTML = '📚 Cover Mode ON';
        coverModeToggle.style.background = '#4CAF50';

        const toggleCoverMode = () => {
            this.coverMode = !this.coverMode;
            coverModeToggle.innerHTML = this.coverMode ? '📚 Cover Mode ON' : '📚 Cover Mode';
            coverModeToggle.style.background = this.coverMode ? '#4CAF50' : '#9C27B0';
            
            // Adjust current page if needed for proper pairing
            if (this.coverMode && this.doublePageMode && this.currentPage > 1 && this.currentPage % 2 === 0) {
                // In cover mode, pages should be 1, 2-3, 4-5, etc.
                this.currentPage = this.currentPage;
            } else if (!this.coverMode && this.doublePageMode && this.currentPage > 1 && this.currentPage % 2 === 1) {
                // In normal mode, pages should be 1-2, 3-4, etc.
                this.currentPage = this.currentPage - 1;
            }
            
            showPage(this.currentPage);
        };

        const toggleDoublePageMode = () => {
            this.doublePageMode = !this.doublePageMode;
            doublePageToggle.textContent = this.doublePageMode ? 'Single Page' : 'Double Page';
            
            const pageContent2 = document.getElementById('text-page-right');
            if (this.doublePageMode) {
                pageContent2.style.display = 'block';
            } else {
                pageContent2.style.display = 'none';
            }
            
            showPage(this.currentPage);
        };

        const showPage = (page) => {
            if (page < 1 || page > this.pages.length) {
                return;
            }
            
            if (page < 1) page = 1;
            if (this.doublePageMode && page > this.pages.length) {
                page = this.pages.length % 2 === 0 ? this.pages.length - 1 : this.pages.length;
                if (page < 1) page = 1;
            } else if (page > this.pages.length) {
                page = this.pages.length;
            }
            
            this.currentPage = page;
            
            const codeContent1 = document.querySelector('#text-page-left code');
            const codeContent2 = document.querySelector('#text-page-right code');
            
            // Show left/first page
            codeContent1.textContent = this.pages[this.currentPage - 1];
            const language = this.getLanguageFromExtension(extension);
            codeContent1.className = `language-${language}`;
            
            // Apply syntax highlighting if available
            if (typeof hljs !== 'undefined') {
                hljs.highlightElement(codeContent1);
            }
            
            // Show right/second page if in double page mode
            if (this.doublePageMode) {
                let shouldShowRightPage = false;
                let rightPageIndex = this.currentPage;
                
                if (this.coverMode) {
                    // In cover mode: page 1 alone, then 2-3, 4-5, etc., last page alone
                    if (this.currentPage === 1) {
                        shouldShowRightPage = false; // Front cover page alone
                    } else if (this.currentPage === this.pages.length) {
                        shouldShowRightPage = false; // Rear cover page alone
                    } else if (this.currentPage % 2 === 0 && this.currentPage < this.pages.length - 1) {
                        shouldShowRightPage = true; // Even pages (2,4,6) pair with next (but not if next is last page)
                        rightPageIndex = this.currentPage;
                    } else if (this.currentPage % 2 === 1 && this.currentPage > 1) {
                        shouldShowRightPage = false; // Odd pages > 1 shown alone in cover mode
                    }
                } else {
                    // Normal mode: 1-2, 3-4, 5-6, etc.
                    shouldShowRightPage = this.currentPage < this.pages.length;
                    rightPageIndex = this.currentPage;
                }
                
                if (shouldShowRightPage) {
                    codeContent2.textContent = this.pages[rightPageIndex];
                    codeContent2.className = `language-${language}`;
                    
                    // Apply syntax highlighting if available
                    if (typeof hljs !== 'undefined') {
                        hljs.highlightElement(codeContent2);
                    }
                } else {
                    codeContent2.textContent = ''; // Clear if no more pages
                }
            }
            
            // Update page info
            if (this.doublePageMode) {
                if (this.coverMode && this.currentPage === 1) {
                    pageInfo.textContent = `Page 1 (Front Cover) of ${this.pages.length}`;
                } else if (this.coverMode && this.currentPage === this.pages.length) {
                    pageInfo.textContent = `Page ${this.pages.length} (Rear Cover) of ${this.pages.length}`;
                } else if (this.coverMode && this.currentPage > 1) {
                    const endPage = Math.min(this.currentPage + 1, this.pages.length);
                    if (this.currentPage % 2 === 0 && endPage > this.currentPage && endPage < this.pages.length) {
                        pageInfo.textContent = `Pages ${this.currentPage}-${endPage} of ${this.pages.length}`;
                    } else {
                        pageInfo.textContent = `Page ${this.currentPage} of ${this.pages.length}`;
                    }
                } else if (this.currentPage < this.pages.length) {
                    pageInfo.textContent = `Pages ${this.currentPage}-${this.currentPage + 1} of ${this.pages.length}`;
                } else {
                    pageInfo.textContent = `Page ${this.currentPage} of ${this.pages.length}`;
                }
            } else {
                pageInfo.textContent = `Page ${this.currentPage} of ${this.pages.length}`;
            }
            
            prevBtn.disabled = this.currentPage === 1;
            if (this.doublePageMode) {
                nextBtn.disabled = this.currentPage >= this.pages.length;
            } else {
                nextBtn.disabled = this.currentPage === this.pages.length;
            }
        };

        const navigatePrev = () => {
            if (!this.doublePageMode) {
                showPage(this.currentPage - 1);
                return;
            }
            
            if (this.coverMode) {
                // In cover mode: 1, 2-3, 4-5, 6-7, etc., last page alone
                if (this.currentPage === 1) {
                    return; // Already at front cover
                } else if (this.currentPage === this.pages.length) {
                    // From rear cover, go to previous page or pair
                    if (this.pages.length % 2 === 0) {
                        showPage(this.pages.length - 2); // Go to pair before rear cover
                    } else {
                        showPage(this.pages.length - 1); // Go to page before rear cover
                    }
                } else if (this.currentPage === 2) {
                    showPage(1); // Go to front cover
                } else if (this.currentPage % 2 === 0) {
                    showPage(this.currentPage - 2); // From even page, go back 2
                } else {
                    showPage(this.currentPage - 1); // From odd page > 1, go back 1
                }
            } else {
                // Normal mode: 1-2, 3-4, 5-6, etc.
                showPage(this.currentPage - 2);
            }
        };

        const navigateNext = () => {
            if (!this.doublePageMode) {
                showPage(this.currentPage + 1);
                return;
            }
            
            if (this.coverMode) {
                // In cover mode: 1, 2-3, 4-5, 6-7, etc., last page alone
                if (this.currentPage === this.pages.length) {
                    return; // Already at rear cover
                } else if (this.currentPage === 1) {
                    showPage(2); // From front cover to page 2
                } else if (this.currentPage % 2 === 0) {
                    // From even page, check if next would be the last page
                    if (this.currentPage + 2 === this.pages.length) {
                        showPage(this.pages.length); // Jump to rear cover
                    } else {
                        showPage(this.currentPage + 2); // From even page, advance 2
                    }
                } else {
                    // From odd page > 1, advance 1
                    if (this.currentPage + 1 === this.pages.length) {
                        showPage(this.pages.length); // Go to rear cover
                    } else {
                        showPage(this.currentPage + 1);
                    }
                }
            } else {
                // Normal mode: 1-2, 3-4, 5-6, etc.
                showPage(this.currentPage + 2);
            }
        };

        prevBtn.addEventListener('click', navigatePrev);
        nextBtn.addEventListener('click', navigateNext);
        doublePageToggle.addEventListener('click', toggleDoublePageMode);
        coverModeToggle.addEventListener('click', toggleCoverMode);
        jumpBtn.addEventListener('click', () => {
            const page = parseInt(jumpInput.value, 10);
            if (!isNaN(page)) {
                showPage(page);
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

        showPage(1);
    }
    
    renderCSV(csvText, contentOther) {
        const lines = csvText.split('\n').filter(line => line.trim());
        if (lines.length === 0) return;
        
        const csvContainer = document.createElement('div');
        csvContainer.className = 'csv-container';
        csvContainer.style.cssText = `
            background: rgba(255, 255, 255, 0.1);
            padding: 20px;
            border-radius: 15px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            overflow-x: auto;
        `;
        
        const table = document.createElement('table');
        table.style.cssText = `
            width: 100%;
            border-collapse: collapse;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 10px;
        `;
        
        lines.forEach((line, index) => {
            const row = document.createElement('tr');
            const cells = this.parseCSVLine(line);
            
            cells.forEach((cell, cellIndex) => {
                const cellElement = document.createElement(index === 0 ? 'th' : 'td');
                cellElement.textContent = cell;
                cellElement.style.cssText = `
                    padding: 8px 12px;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    color: ${index === 0 ? '#4ecdc4' : '#ffffff'};
                    font-weight: ${index === 0 ? 'bold' : 'normal'};
                    background: ${index === 0 ? 'rgba(78, 205, 196, 0.1)' : 'transparent'};
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 200px;
                `;
                row.appendChild(cellElement);
            });
            table.appendChild(row);
        });
        
        csvContainer.appendChild(table);
        contentOther.appendChild(csvContainer);
        contentOther.style.display = 'block';
    }
    
    renderSRT(srtText, contentOther) {
        const srtContainer = document.createElement('div');
        srtContainer.className = 'srt-container';
        srtContainer.style.cssText = `
            background: rgba(255, 255, 255, 0.1);
            padding: 20px;
            border-radius: 15px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            max-height: 70vh;
            overflow-y: auto;
        `;
        
        const subtitles = this.parseSRT(srtText);
        
        subtitles.forEach((subtitle, index) => {
            const subtitleBlock = document.createElement('div');
            subtitleBlock.style.cssText = `
                margin-bottom: 20px;
                padding: 15px;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 10px;
                border-left: 3px solid #4ecdc4;
            `;
            
            const timeCode = document.createElement('div');
            timeCode.textContent = `${subtitle.start} → ${subtitle.end}`;
            timeCode.style.cssText = `
                color: #4ecdc4;
                font-size: 12px;
                font-weight: bold;
                margin-bottom: 8px;
            `;
            
            const text = document.createElement('div');
            text.innerHTML = subtitle.text.replace(/\n/g, '<br>');
            text.style.cssText = `
                color: #ffffff;
                line-height: 1.4;
            `;
            
            subtitleBlock.appendChild(timeCode);
            subtitleBlock.appendChild(text);
            srtContainer.appendChild(subtitleBlock);
        });
        
        contentOther.appendChild(srtContainer);
        contentOther.style.display = 'block';
    }
    
    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        
        result.push(current.trim());
        return result;
    }
    
    parseSRT(srtText) {
        const blocks = srtText.split(/\n\s*\n/).filter(block => block.trim());
        const subtitles = [];
        
        blocks.forEach(block => {
            const lines = block.trim().split('\n');
            if (lines.length >= 3) {
                const timeLine = lines[1];
                const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/);
                
                if (timeMatch) {
                    subtitles.push({
                        start: timeMatch[1],
                        end: timeMatch[2],
                        text: lines.slice(2).join('\n')
                    });
                }
            }
        });
        
        return subtitles;
    }
}