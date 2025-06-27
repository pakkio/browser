// Enhanced file renderer supporting PDFs, images, videos, audio, and text files

class FileRenderer {
    constructor() {
        this.handlers = new Map();
        this.currentHandler = null; // To keep track of the active renderer
        this.setupHandlers();
    }

    setupHandlers() {
        this.handlers.set('text', new TextRenderer());
        this.handlers.set('image', new ImageRenderer());
        this.handlers.set('pdf', new PDFRenderer());
        this.handlers.set('comic', new ComicRenderer());
        this.handlers.set('audio', new AudioRenderer());
        this.handlers.set('video', new VideoRenderer());
        this.handlers.set('docx', new DocxRenderer());
        this.handlers.set('xlsx', new XlsxRenderer());
        this.handlers.set('pptx', new PptxRenderer());
        this.handlers.set('epub', new EpubRenderer());
        // Treat .doc as .docx for rendering
        this.handlers.set('doc', this.handlers.get('docx'));
        // Add a CSS class to the <pre> element for better text contrast and fix font rendering
        const style = document.createElement('style');
        style.innerHTML = `
            pre#content-code, pre code#content-code {
                background: #222 !important;
                color: #f8f8f2 !important;
                border-radius: 8px;
                padding: 16px;
                font-size: 1em;
                font-family: 'Fira Mono', 'Consolas', 'Menlo', 'Monaco', 'Liberation Mono', monospace !important;
                line-height: 1.8 !important;
                letter-spacing: 0.02em !important;
                overflow-x: auto;
                white-space: pre-wrap !important;
                word-break: break-word !important;
                box-sizing: border-box;
            }
            pre#content-code code, pre code#content-code {
                display: block;
                line-height: inherit !important;
                font-family: inherit !important;
                font-size: inherit !important;
                background: none !important;
                color: inherit !important;
                padding: 0;
                margin: 0;
            }
            pre#content-code::-webkit-scrollbar, pre code#content-code::-webkit-scrollbar {
                height: 8px;
                background: #222;
            }
            pre#content-code::-webkit-scrollbar-thumb, pre code#content-code::-webkit-scrollbar-thumb {
                background: #444;
                border-radius: 4px;
            }
        `;
        document.head.appendChild(style);
    }

    getFileType(fileName) {
        const extension = fileName.split('.').pop().toLowerCase();
        // Treat .doc as .docx
        if (extension === 'doc') return 'docx';

        if (['txt', 'md', 'js', 'html', 'css', 'json', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'csv', 'srt', 'xml', 'yaml', 'yml', 'ini', 'conf', 'log', 'sh', 'bat', 'ps1', 'sql', 'php', 'rb', 'swift', 'kt', 'dart', 'r', 'scala', 'clj', 'elm', 'vue', 'jsx', 'tsx', 'ts', 'less', 'scss', 'sass', 'styl', 'svelte', 'astro'].includes(extension)) {
            return 'text';
        } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) {
            return 'image';
        } else if (extension === 'pdf') {
            return 'pdf';
        } else if (['cbz', 'cbr'].includes(extension)) {
            return 'comic';
        } else if (['mp3', 'wav', 'flac', 'ogg'].includes(extension)) {
            return 'audio';
        } else if (['mp4', 'avi', 'mov', 'mkv'].includes(extension)) {
            return 'video';
        } else if (extension === 'docx') {
            return 'docx';
        } else if (extension === 'xlsx') {
            return 'xlsx';
        } else if (extension === 'pptx') {
            return 'pptx';
        } else if (extension === 'epub') {
            return 'epub';
        }
        return 'unsupported';
    }

    async render(filePath, fileName, contentCode, contentOther) {
        // Cleanup previous renderer's specific event listeners or states
        if (this.currentHandler && typeof this.currentHandler.cleanup === 'function') {
            this.currentHandler.cleanup();
        }

        const fileType = this.getFileType(fileName);
        const handler = this.handlers.get(fileType);
        this.currentHandler = handler; // Set the new handler

        contentCode.innerHTML = '';
        contentOther.innerHTML = '';
        contentCode.parentElement.style.display = 'none';
        contentOther.style.display = 'none';
        
        if (handler) {
            await handler.render(filePath, fileName, contentCode, contentOther);
        } else {
            contentOther.textContent = 'File type not supported for preview.';
            contentOther.style.display = 'block';
        }
    }

    async testRender(fileType, testFilePath, testFileName) {
        const handler = this.handlers.get(fileType);
        if (!handler) {
            console.error(`No handler for file type: ${fileType}`);
            return false;
        }

        try {
            const testContainer = document.createElement('div');
            testContainer.id = 'test-container';
            document.body.appendChild(testContainer);

            const mockContentCode = document.createElement('pre');
            const mockContentOther = document.createElement('div');
            testContainer.appendChild(mockContentCode);
            testContainer.appendChild(mockContentOther);

            console.log(`Testing ${fileType} with file: ${testFileName}`);
            await handler.render(testFilePath, testFileName, mockContentCode, mockContentOther);
            
            console.log(`✓ ${fileType} render completed successfully`);
            return true;
        } catch (error) {
            console.error(`✗ ${fileType} render failed:`, error);
            return false;
        }
    }
}

class TextRenderer {
    constructor() {
        this.handleKeyDown = null;
        this.currentPage = 1;
        this.pages = [];
        this.linesPerPage = 50;
    }

    cleanup() {
        if (this.handleKeyDown) {
            document.removeEventListener('keydown', this.handleKeyDown);
            this.handleKeyDown = null;
        }
    }

    async render(filePath, fileName, contentCode, contentOther) {
        this.cleanup();
        const extension = fileName.split('.').pop().toLowerCase();
        const response = await window.authManager.authenticatedFetch(`/files?path=${encodeURIComponent(filePath)}`);
        
        if (!response) {
            throw new Error('Authentication required');
        }
        
        if (!response.ok) {
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

        const controls = document.createElement('div');
        controls.className = 'text-controls';
        controls.style.cssText = `display: flex; align-items: center; margin-bottom: 10px;`;
        controls.innerHTML = `
            <button id="text-prev">Previous</button>
            <span id="text-page-info" style="margin: 0 10px;"></span>
            <button id="text-next">Next</button>
            <input type="number" id="text-page-jump" placeholder="Page" style="width: 60px; margin-left: 20px;">
            <button id="text-jump-btn" style="margin-left: 5px;">Go</button>
        `;

        const pageContent = document.createElement('pre');
        const codeContent = document.createElement('code');
        pageContent.appendChild(codeContent);

        textContainer.appendChild(controls);
        textContainer.appendChild(pageContent);
        contentOther.appendChild(textContainer);
        contentOther.style.display = 'block';

        const prevBtn = controls.querySelector('#text-prev');
        const nextBtn = controls.querySelector('#text-next');
        const pageInfo = controls.querySelector('#text-page-info');
        const jumpInput = controls.querySelector('#text-page-jump');
        const jumpBtn = controls.querySelector('#text-jump-btn');

        const showPage = (page) => {
            if (page < 1 || page > this.pages.length) {
                return;
            }
            this.currentPage = page;
            codeContent.textContent = this.pages[this.currentPage - 1];
            codeContent.className = `language-${extension}`;
            hljs.highlightElement(codeContent);
            pageInfo.textContent = `Page ${this.currentPage} of ${this.pages.length}`;
            prevBtn.disabled = this.currentPage === 1;
            nextBtn.disabled = this.currentPage === this.pages.length;
        };

        prevBtn.addEventListener('click', () => showPage(this.currentPage - 1));
        nextBtn.addEventListener('click', () => showPage(this.currentPage + 1));
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
                prevBtn.click();
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                nextBtn.click();
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

class ImageRenderer {
    async render(filePath, fileName, contentCode, contentOther) {
        const img = document.createElement('img');
        img.src = `/files?path=${encodeURIComponent(filePath)}`;
        img.style.maxWidth = '100%';
        img.onerror = () => {
            contentOther.textContent = `Failed to load image: ${fileName}`;
        };
        contentOther.appendChild(img);
        contentOther.style.display = 'block';
    }
}

class PDFRenderer {
    constructor() {
        this.handleKeyDown = null;
        this.currentPage = 1;
        this.totalPages = null;
    }

    cleanup() {
        if (this.handleKeyDown) {
            document.removeEventListener('keydown', this.handleKeyDown);
            this.handleKeyDown = null;
        }
    }

    async render(filePath, fileName, contentCode, contentOther) {
        this.cleanup();
        this.currentPage = 1;
        this.totalPages = null;

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
        
        const pageImg = document.createElement('img');
        pageImg.style.maxWidth = '100%';
        pageImg.style.border = '1px solid #ccc';
        
        pdfContainer.appendChild(controls);
        pdfContainer.appendChild(pageImg);
        contentOther.appendChild(pdfContainer);
        contentOther.style.display = 'block';
        
        const prevBtn = controls.querySelector('#pdf-prev');
        const nextBtn = controls.querySelector('#pdf-next');
        const pageInfo = controls.querySelector('#pdf-page-info');
        const jumpInput = controls.querySelector('#pdf-page-jump');
        const jumpBtn = controls.querySelector('#pdf-jump-btn');
        const statusElement = controls.querySelector('#pdf-status');

        const updateTotalPages = (totalPages) => {
            this.totalPages = totalPages;
            updatePageInfo();
        };

        const updatePageInfo = () => {
            if (this.totalPages) {
                pageInfo.textContent = `Page ${this.currentPage} of ${this.totalPages}`;
            } else {
                pageInfo.textContent = `Page ${this.currentPage}`;
            }
            prevBtn.disabled = this.currentPage === 1;
            nextBtn.disabled = this.totalPages !== null && this.currentPage === this.totalPages;
        };
        
        const loadPage = async (page) => {
            if (page < 1 || (this.totalPages && page > this.totalPages)) {
                return;
            }
            this.currentPage = page;
            try {
                statusElement.textContent = 'Loading...';
                const response = await window.authManager.authenticatedFetch(`/pdf-preview?path=${encodeURIComponent(filePath)}&page=${page}`);
                
                if (!response.ok) {
                    if (response.status === 500) { // Assume 500 means end of pages if total is unknown
                        if (!this.totalPages) {
                            this.totalPages = this.currentPage - 1;
                        }
                    }
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const blob = await response.blob();
                if (blob.size === 0) {
                    throw new Error('Empty response');
                }
                
                pageImg.src = URL.createObjectURL(blob);
                statusElement.textContent = '';
                updatePageInfo();
            } catch (error) {
                console.error('PDF load error:', error);
                statusElement.textContent = `Error: ${error.message}`;
                pageImg.src = '';
                updatePageInfo();
            }
        };
        
        prevBtn.addEventListener('click', () => loadPage(this.currentPage - 1));
        nextBtn.addEventListener('click', () => loadPage(this.currentPage + 1));
        jumpBtn.addEventListener('click', () => {
            const page = parseInt(jumpInput.value, 10);
            if (!isNaN(page)) {
                loadPage(page);
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

        // Fetch total pages
        try {
            const infoResponse = await window.authManager.authenticatedFetch(`/api/pdf-info?path=${encodeURIComponent(filePath)}`);
            if (infoResponse.ok) {
                const info = await infoResponse.json();
                updateTotalPages(info.pages);
            }
        } catch (e) {
            console.error("Could not fetch PDF info", e);
        }
        
        await loadPage(1);
    }
}

class ComicRenderer {
    async render(filePath, fileName, contentCode, contentOther) {
        const comicContainer = document.createElement('div');
        comicContainer.className = 'comic-container';
        
        const controls = document.createElement('div');
        controls.className = 'comic-controls';
        controls.innerHTML = `
            <button id="comic-prev">Previous</button>
            <span id="comic-page-info">Page 1</span>
            <button id="comic-next">Next</button>
            <span id="comic-status" style="margin-left: 10px; font-style: italic;"></span>
        `;
        
        const pageImg = document.createElement('img');
        pageImg.style.maxWidth = '100%';
        pageImg.style.border = '1px solid #ccc';
        pageImg.style.display = 'block';
        pageImg.style.margin = '0 auto';
        
        comicContainer.appendChild(controls);
        comicContainer.appendChild(pageImg);
        contentOther.appendChild(comicContainer);
        contentOther.style.display = 'block';
        
        let currentPage = 1;
        const statusElement = controls.querySelector('#comic-status');
        
        const loadPage = async (page) => {
            try {
                statusElement.innerHTML = '⏳ Loading page...';
                pageImg.style.opacity = '0.5';
                const response = await window.authManager.authenticatedFetch(`/comic-preview?path=${encodeURIComponent(filePath)}&page=${page}`);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const blob = await response.blob();
                pageImg.src = URL.createObjectURL(blob);
                pageImg.style.opacity = '1';
                document.getElementById('comic-page-info').textContent = `Page ${page}`;
                statusElement.textContent = '';
            } catch (error) {
                console.error('Comic load error:', error);
                pageImg.style.opacity = '1';
                statusElement.textContent = `Error: ${error.message}`;
            }
        };
        
        document.getElementById('comic-prev').addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                loadPage(currentPage);
            }
        });
        
        document.getElementById('comic-next').addEventListener('click', () => {
            currentPage++;
            loadPage(currentPage);
        });
        
        await loadPage(currentPage);
    }
}

class AudioRenderer {
    async render(filePath, fileName, contentCode, contentOther) {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = `/files?path=${encodeURIComponent(filePath)}`;
        contentOther.appendChild(audio);
        contentOther.style.display = 'block';
    }
}

class VideoRenderer {
    async render(filePath, fileName, contentCode, contentOther) {
        const video = document.createElement('video');
        video.controls = true;
        video.preload = 'metadata';
        video.style.maxWidth = '100%';
        video.style.height = 'auto';
        
        // Check if this is an AVI file that needs transcoding
        const isAVI = fileName.toLowerCase().endsWith('.avi');
        
        if (isAVI) {
            // Use transcoding endpoint for AVI files
            video.src = `/video-transcode?path=${encodeURIComponent(filePath)}`;
            
            // Add loading indicator for transcoding
            const loadingDiv = document.createElement('div');
            loadingDiv.style.color = '#666';
            loadingDiv.style.marginBottom = '10px';
            loadingDiv.innerHTML = '🔄 Transcoding AVI file for playback...';
            contentOther.appendChild(loadingDiv);
            
            video.addEventListener('loadstart', () => {
                loadingDiv.innerHTML = '🔄 Loading transcoded video...';
            });
            
            video.addEventListener('canplay', () => {
                loadingDiv.style.display = 'none';
            });
        } else {
            // Use direct file serving for other formats
            video.src = `/files?path=${encodeURIComponent(filePath)}`;
        }
        
        // Error handling
        const errorDiv = document.createElement('div');
        errorDiv.style.color = 'red';
        errorDiv.style.marginTop = '10px';
        errorDiv.style.display = 'none';
        
        video.addEventListener('error', (e) => {
            console.error('Video error:', e, video.error);
            errorDiv.style.display = 'block';
            errorDiv.innerHTML = `
                <strong>Video Error:</strong><br>
                ${this.getErrorMessage(video.error?.code)}<br>
                <small>File: ${fileName}</small>
                ${isAVI ? '<br><small>Try refreshing if transcoding failed</small>' : ''}
            `;
        });
        
        video.addEventListener('loadedmetadata', () => {
            console.log('Video loaded:', fileName, `${video.videoWidth}x${video.videoHeight}`);
        });
        
        video.addEventListener('canplay', () => {
            console.log('Video can play:', fileName);
        });
        
        contentOther.appendChild(video);
        contentOther.appendChild(errorDiv);
        contentOther.style.display = 'block';
    }
    
    getErrorMessage(errorCode) {
        const errors = {
            1: 'MEDIA_ERR_ABORTED - Video loading was aborted',
            2: 'MEDIA_ERR_NETWORK - Network error occurred',
            3: 'MEDIA_ERR_DECODE - Video decoding failed (unsupported format or codec)',
            4: 'MEDIA_ERR_SRC_NOT_SUPPORTED - Video format not supported'
        };
        return errors[errorCode] || 'Unknown video error';
    }
}

class DocxRenderer {
    constructor() {
        this.handleKeyDown = null;
        this.currentPage = 1;
        this.totalPages = 0;
        this.pageHeight = 0;
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
            const response = await window.authManager.authenticatedFetch(`/files?path=${encodeURIComponent(filePath)}`);
            const arrayBuffer = await response.arrayBuffer();
            
            const result = await mammoth.convertToHtml({arrayBuffer: arrayBuffer});
            
            const docxContainer = document.createElement('div');
            docxContainer.className = 'docx-container';
            docxContainer.style.cssText = `
                background: white;
                padding: 20px;
                border: 1px solid #ccc;
                border-radius: 4px;
                font-family: Arial, sans-serif;
                line-height: 1.6;
                max-width: 100%;
                height: 70vh;
                overflow-y: auto;
            `;
            
            const docxContent = document.createElement('div');
            docxContent.innerHTML = result.value;
            docxContainer.appendChild(docxContent);

            const controls = document.createElement('div');
            controls.className = 'docx-controls';
            controls.style.cssText = `display: flex; align-items: center; margin-top: 10px;`;
            controls.innerHTML = `
                <button id="docx-prev">Previous</button>
                <span id="docx-page-info" style="margin: 0 10px;"></span>
                <button id="docx-next">Next</button>
                <input type="number" id="docx-page-jump" placeholder="Page" style="width: 60px; margin-left: 20px;">
                <button id="docx-jump-btn" style="margin-left: 5px;">Go</button>
            `;
            
            contentOther.appendChild(controls);
            contentOther.appendChild(docxContainer);
            contentOther.style.display = 'block';

            // Pagination logic
            setTimeout(() => {
                this.pageHeight = docxContainer.clientHeight;
                const contentHeight = docxContent.scrollHeight;
                this.totalPages = Math.ceil(contentHeight / this.pageHeight);
                this.currentPage = 1;

                const prevBtn = controls.querySelector('#docx-prev');
                const nextBtn = controls.querySelector('#docx-next');
                const pageInfo = controls.querySelector('#docx-page-info');
                const jumpInput = controls.querySelector('#docx-page-jump');
                const jumpBtn = controls.querySelector('#docx-jump-btn');

                const showPage = (page) => {
                    if (page < 1 || page > this.totalPages) return;
                    this.currentPage = page;
                    docxContainer.scrollTop = (this.currentPage - 1) * this.pageHeight;
                    pageInfo.textContent = `Page ${this.currentPage} of ${this.totalPages}`;
                    prevBtn.disabled = this.currentPage === 1;
                    nextBtn.disabled = this.currentPage === this.totalPages;
                };

                prevBtn.addEventListener('click', () => showPage(this.currentPage - 1));
                nextBtn.addEventListener('click', () => showPage(this.currentPage + 1));
                jumpBtn.addEventListener('click', () => {
                    const page = parseInt(jumpInput.value, 10);
                    if (!isNaN(page)) showPage(page);
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

                showPage(1);
            }, 100);

        } catch (error) {
            console.error('DOCX render error:', error);
            contentOther.innerHTML = `<div style="color: red;">Error loading DOCX file: ${error.message}</div>`;
            contentOther.style.display = 'block';
        }
    }
}

class XlsxRenderer {
    async render(filePath, fileName, contentCode, contentOther) {
        try {
            const response = await window.authManager.authenticatedFetch(`/files?path=${encodeURIComponent(filePath)}`);
            const arrayBuffer = await response.arrayBuffer();
            
            const workbook = XLSX.read(arrayBuffer, {type: 'array'});
            
            const xlsxContainer = document.createElement('div');
            xlsxContainer.className = 'xlsx-container';
            xlsxContainer.style.cssText = `
                background: white;
                padding: 20px;
                border: 1px solid #ccc;
                border-radius: 4px;
                max-width: 100%;
                overflow-x: auto;
            `;
            
            if (workbook.SheetNames.length > 1) {
                const tabsDiv = document.createElement('div');
                tabsDiv.className = 'xlsx-tabs';
                tabsDiv.style.cssText = `
                    margin-bottom: 10px;
                    border-bottom: 1px solid #ccc;
                `;
                
                workbook.SheetNames.forEach((sheetName, index) => {
                    const tab = document.createElement('button');
                    tab.textContent = sheetName;
                    tab.style.cssText = `
                        padding: 8px 16px;
                        margin-right: 4px;
                        border: 1px solid #ccc;
                        background: ${index === 0 ? '#007acc' : '#f5f5f5'};
                        color: ${index === 0 ? 'white' : 'black'};
                        cursor: pointer;
                        border-radius: 4px 4px 0 0;
                    `;
                    tab.onclick = () => this.showSheet(workbook, sheetName, xlsxContainer, workbook.SheetNames);
                    tabsDiv.appendChild(tab);
                });
                
                xlsxContainer.appendChild(tabsDiv);
            }
            
            const sheetDiv = document.createElement('div');
            sheetDiv.className = 'xlsx-sheet';
            xlsxContainer.appendChild(sheetDiv);
            
            this.showSheet(workbook, workbook.SheetNames[0], xlsxContainer, workbook.SheetNames);
            
            contentOther.appendChild(xlsxContainer);
            contentOther.style.display = 'block';
        } catch (error) {
            console.error('XLSX render error:', error);
            contentOther.innerHTML = `<div style="color: red;">Error loading XLSX file: ${error.message}</div>`;
            contentOther.style.display = 'block';
        }
    }
    
    showSheet(workbook, sheetName, container, allSheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const htmlTable = XLSX.utils.sheet_to_html(worksheet);
        
        const sheetDiv = container.querySelector('.xlsx-sheet');
        sheetDiv.innerHTML = htmlTable;
        
        const table = sheetDiv.querySelector('table');
        if (table) {
            table.style.cssText = `
                border-collapse: collapse;
                width: 100%;
                font-size: 12px;
            `;
            
            const cells = table.querySelectorAll('td, th');
            cells.forEach(cell => {
                cell.style.cssText = `
                    border: 1px solid #ccc;
                    padding: 4px 8px;
                    text-align: left;
                `;
            });
            
            const headers = table.querySelectorAll('th');
            headers.forEach(header => {
                header.style.backgroundColor = '#f5f5f5';
                header.style.fontWeight = 'bold';
            });
        }
        
        if (allSheetNames.length > 1) {
            const tabs = container.querySelectorAll('.xlsx-tabs button');
            tabs.forEach(tab => {
                const isActive = tab.textContent === sheetName;
                tab.style.background = isActive ? '#007acc' : '#f5f5f5';
                tab.style.color = isActive ? 'white' : 'black';
            });
        }
    }
}

class PptxRenderer {
    async render(filePath, fileName, contentCode, contentOther) {
        try {
            const pptxContainer = document.createElement('div');
            pptxContainer.className = 'pptx-container';
            pptxContainer.style.cssText = `
                background: white;
                padding: 20px;
                border: 1px solid #ccc;
                border-radius: 4px;
                text-align: center;
            `;
            
            pptxContainer.innerHTML = `
                <div style="padding: 40px; color: #666;">
                    <h3>PowerPoint Presentation</h3>
                    <p>${fileName}</p>
                    <p style="margin-top: 20px;">
                        <strong>Note:</strong> PowerPoint preview is not fully supported yet.<br>
                        <a href="/files?path=${encodeURIComponent(filePath)}" 
                           download="${fileName}" 
                           style="color: #007acc; text-decoration: none;">
                            Click here to download the file
                        </a>
                    </p>
                </div>
            `;
            
            contentOther.appendChild(pptxContainer);
            contentOther.style.display = 'block';
        } catch (error) {
            console.error('PPTX render error:', error);
            contentOther.innerHTML = `<div style="color: red;">Error loading PPTX file: ${error.message}</div>`;
            contentOther.style.display = 'block';
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