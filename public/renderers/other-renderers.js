// Shared annotation shortcut handler for all renderers
function handleAnnotationShortcut(key) {
    // Get current file info from window.fileExplorer
    const fileExplorer = window.fileExplorer;
    if (!fileExplorer) return;
    
    // Find currently selected file
    const selectedItems = document.querySelectorAll('.file-item.selected');
    if (selectedItems.length === 0) return;
    
    const selectedItem = selectedItems[0];
    const fileName = selectedItem.querySelector('.file-name').textContent;
    
    // Create file object
    const file = { name: fileName, isDirectory: false };
    
    // Map key to annotation action
    let type, value;
    switch (key) {
        case 'r': type = 'color'; value = '#f44336'; break;
        case 'g': type = 'color'; value = '#4caf50'; break;
        case 'y': type = 'color'; value = '#ffeb3b'; break;
        case 'b': type = 'color'; value = '#2196f3'; break;
        case 'c': type = 'comment'; break;
        case '1': case '2': case '3': case '4': case '5':
            type = 'stars'; value = parseInt(key); break;
        default: return;
    }
    
    // Use the quickAnnotate function from file explorer
    if (fileExplorer.quickAnnotate) {
        fileExplorer.quickAnnotate(file, type, value);
    }
}

class ComicRenderer {
    constructor() {
        this.handleKeyDown = null;
        this.currentPage = 1;
        this.totalPages = null;
        this.abortController = null;
        this.pageCache = new Map();
        this.preloadQueue = [];
    }


    cleanup() {
        if (this.handleKeyDown) {
            document.removeEventListener('keydown', this.handleKeyDown);
            this.handleKeyDown = null;
        }
        
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        
        // Clean up cached page URLs
        for (const url of this.pageCache.values()) {
            URL.revokeObjectURL(url);
        }
        this.pageCache.clear();
        this.preloadQueue = [];
    }

    async render(filePath, fileName, contentCode, contentOther, options = {}) {
        this.cleanup();
        this.currentPage = 1;
        this.totalPages = null;
        this.abortController = new AbortController();

        const comicContainer = document.createElement('div');
        comicContainer.className = 'comic-container';
        comicContainer.style.cssText = `height: 100%; display: flex; flex-direction: column;`;
        
        const controls = document.createElement('div');
        controls.className = 'comic-controls';
        controls.style.cssText = `display: flex; align-items: center; margin-bottom: 10px; flex-shrink: 0;`;
        controls.innerHTML = `
            <button id="comic-prev">Previous</button>
            <span id="comic-page-info">Page 1</span>
            <button id="comic-next">Next</button>
            <input type="number" id="comic-page-jump" placeholder="Page" style="width: 60px; margin-left: 20px;">
            <button id="comic-jump-btn" style="margin-left: 5px;">Go</button>
            <span id="comic-status" style="margin-left: 10px; font-style: italic;"></span>
        `;
        
        const pageImg = document.createElement('img');
        pageImg.style.cssText = `
            max-width: 100%;
            max-height: calc(100% - 60px);
            border: 1px solid #ccc;
            display: block;
            margin: 0 auto;
            object-fit: contain;
            flex: 1;
        `;
        
        comicContainer.appendChild(controls);
        comicContainer.appendChild(pageImg);
        
        contentOther.innerHTML = '';
        contentOther.appendChild(comicContainer);
        contentOther.style.display = 'block';
        
        const prevBtn = controls.querySelector('#comic-prev');
        const nextBtn = controls.querySelector('#comic-next');
        const pageInfo = controls.querySelector('#comic-page-info');
        const jumpInput = controls.querySelector('#comic-page-jump');
        const jumpBtn = controls.querySelector('#comic-jump-btn');
        const statusElement = controls.querySelector('#comic-status');

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
            
            // Check cache first
            if (this.pageCache.has(page)) {
                pageImg.src = this.pageCache.get(page);
                pageImg.style.opacity = '1';
                statusElement.textContent = '';
                updatePageInfo();
                this.preloadAdjacentPages(page);
                return;
            }
            
            try {
                if (this.totalPages) {
                    statusElement.innerHTML = `⏳ Loading page... fetching ${page}/${this.totalPages}`;
                } else {
                    statusElement.innerHTML = '⏳ Loading page...';
                }
                pageImg.style.opacity = '0.5';
                
                const url = await this.fetchAndCachePage(page);
                if (url) {
                    pageImg.src = url;
                    pageImg.style.opacity = '1';
                    statusElement.textContent = '';
                    updatePageInfo();
                    this.preloadAdjacentPages(page);
                }
            } catch (error) {
                if (error.name === 'AbortError') {
                    console.log('Comic loading aborted');
                    return;
                }
                console.error('Comic load error:', error);
                pageImg.style.opacity = '1';
                statusElement.textContent = `Error: ${error.message}`;
                updatePageInfo();
            }
        };
        
        this.fetchAndCachePage = async (page) => {
            const response = await window.authManager.authenticatedFetch(`/comic-preview?path=${encodeURIComponent(filePath)}&page=${page}`, {
                signal: this.abortController.signal
            });
            
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
            
            const url = URL.createObjectURL(blob);
            this.pageCache.set(page, url);
            return url;
        };
        
        this.preloadAdjacentPages = async (currentPage) => {
            const pagesToPreload = [currentPage + 1, currentPage - 1, currentPage + 2];
            
            for (const page of pagesToPreload) {
                if (page > 0 && (!this.totalPages || page <= this.totalPages) && !this.pageCache.has(page)) {
                    // Add to preload queue if not already there
                    if (!this.preloadQueue.includes(page)) {
                        this.preloadQueue.push(page);
                    }
                }
            }
            
            // Process preload queue
            this.processPreloadQueue();
        };
        
        this.processPreloadQueue = async () => {
            if (this.preloadQueue.length === 0) return;
            
            const page = this.preloadQueue.shift();
            try {
                await this.fetchAndCachePage(page);
                console.log(`Preloaded page ${page}`);
            } catch (error) {
                console.log(`Failed to preload page ${page}:`, error.message);
            }
            
            // Continue processing queue with a small delay
            if (this.preloadQueue.length > 0) {
                setTimeout(() => this.processPreloadQueue(), 100);
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
            } else if (e.key === 'r' || e.key === 'g' || e.key === 'y' || e.key === 'b' || e.key === 'c' || 
                       (e.key >= '1' && e.key <= '5')) {
                e.preventDefault();
                handleAnnotationShortcut(e.key);
            }
        };
        document.addEventListener('keydown', this.handleKeyDown);

        // Fetch total pages
        try {
            const infoResponse = await window.authManager.authenticatedFetch(`/api/comic-info?path=${encodeURIComponent(filePath)}`, {
                signal: this.abortController.signal
            });
            if (infoResponse.ok) {
                const info = await infoResponse.json();
                updateTotalPages(info.pages);
            }
        } catch (e) {
            if (e.name === 'AbortError') {
                console.log('Comic info fetch aborted');
                return;
            }
            console.error("Could not fetch comic info", e);
        }
        
        await loadPage(1);
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
                    } else if (e.key === 'r' || e.key === 'g' || e.key === 'y' || e.key === 'b' || e.key === 'c' || 
                               (e.key >= '1' && e.key <= '5')) {
                        e.preventDefault();
                        handleAnnotationShortcut(e.key);
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

class ArchiveRenderer {
    constructor() {
        this.currentPath = '';
        this.currentArchive = null;
        this.selectedIndex = -1;
        this.archiveFiles = [];
        this.keydownHandler = null;
        this.previewKeydownHandler = null;
        this.previewIndex = -1;
    }

    cleanup() {
        this.currentPath = '';
        this.currentArchive = null;
        this.selectedIndex = -1;
        this.archiveFiles = [];
        this.previewIndex = -1;
        
        // Remove keyboard event listener
        if (this.keydownHandler) {
            document.removeEventListener('keydown', this.keydownHandler);
            this.keydownHandler = null;
        }
        if (this.previewKeydownHandler) {
            document.removeEventListener('keydown', this.previewKeydownHandler);
            this.previewKeydownHandler = null;
        }
    }

    async render(filePath, fileName, contentCode, contentOther) {
        this.cleanup();
        
        const archiveContainer = document.createElement('div');
        archiveContainer.className = 'archive-container';
        archiveContainer.style.cssText = `
            background: white;
            border: 1px solid #ccc;
            border-radius: 4px;
            font-family: Arial, sans-serif;
            max-width: 100%;
            height: 70vh;
            display: flex;
            flex-direction: column;
        `;

        // Navigation bar
        const navBar = document.createElement('div');
        navBar.className = 'archive-nav';
        navBar.style.cssText = `
            background: #f5f5f5;
            border-bottom: 1px solid #ccc;
            padding: 10px;
            display: flex;
            align-items: center;
            gap: 10px;
        `;

        const backBtn = document.createElement('button');
        backBtn.textContent = '← Back';
        backBtn.style.cssText = `
            padding: 5px 10px;
            border: 1px solid #ccc;
            background: white;
            cursor: pointer;
            border-radius: 3px;
        `;
        backBtn.disabled = true;

        const pathDisplay = document.createElement('span');
        pathDisplay.style.cssText = `
            font-family: monospace;
            background: white;
            padding: 5px 10px;
            border: 1px solid #ccc;
            border-radius: 3px;
            flex: 1;
        `;
        pathDisplay.textContent = fileName;

        navBar.appendChild(backBtn);
        navBar.appendChild(pathDisplay);

        // Content area
        const contentArea = document.createElement('div');
        contentArea.className = 'archive-content';
        contentArea.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 10px;
        `;

        archiveContainer.appendChild(navBar);
        archiveContainer.appendChild(contentArea);
        contentOther.appendChild(archiveContainer);
        contentOther.style.display = 'block';

        // Load archive contents
        try {
            await this.loadArchiveContents(filePath, '', contentArea, pathDisplay, backBtn);
            this.setupKeyboardNavigation(filePath, contentArea, pathDisplay, backBtn);
        } catch (error) {
            console.error('Archive load error:', error);
            contentArea.innerHTML = `<div style="color: red; padding: 20px;">Error loading archive: ${error.message}</div>`;
        }
    }

    async loadArchiveContents(archivePath, subPath, contentArea, pathDisplay, backBtn) {
        contentArea.innerHTML = '<div style="padding: 20px;">⏳ Loading archive contents...</div>';
        
        try {
            const response = await window.authManager.authenticatedFetch(`/archive-contents?path=${encodeURIComponent(archivePath)}&subPath=${encodeURIComponent(subPath)}`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            this.renderFileList(data, archivePath, subPath, contentArea, pathDisplay, backBtn);
        } catch (error) {
            console.error('Failed to load archive contents:', error);
            contentArea.innerHTML = `<div style="color: red; padding: 20px;">Error: ${error.message}</div>`;
        }
    }

    renderFileList(files, archivePath, currentPath, contentArea, pathDisplay, backBtn) {
        contentArea.innerHTML = '';
        
        // Store current state
        this.archiveFiles = files;
        this.currentArchive = archivePath;
        this.currentPath = currentPath;
        this.selectedIndex = -1;
        
        // Update path display
        const displayPath = currentPath ? `${this.getBaseName(archivePath)}/${currentPath}` : this.getBaseName(archivePath);
        pathDisplay.textContent = displayPath;
        
        // Update back button
        backBtn.disabled = !currentPath;
        backBtn.onclick = () => {
            const parentPath = currentPath.split('/').slice(0, -1).join('/');
            this.loadArchiveContents(archivePath, parentPath, contentArea, pathDisplay, backBtn);
        };

        if (files.length === 0) {
            contentArea.innerHTML = '<div style="padding: 20px; color: #666;">No files found in this location.</div>';
            return;
        }

        const fileList = document.createElement('div');
        fileList.className = 'file-list';
        
        // Sort files: directories first, then files
        const sortedFiles = files.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) {
                return a.isDirectory ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        sortedFiles.forEach((file, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.style.cssText = `
                display: flex;
                align-items: center;
                padding: 8px 12px;
                border-bottom: 1px solid #eee;
                cursor: pointer;
                transition: background-color 0.2s;
            `;
            
            fileItem.onmouseover = () => fileItem.style.backgroundColor = '#f0f0f0';
            fileItem.onmouseout = () => fileItem.style.backgroundColor = 'white';

            const icon = document.createElement('span');
            icon.style.cssText = `
                margin-right: 10px;
                font-size: 16px;
                width: 20px;
            `;
            icon.textContent = file.isDirectory ? '📁' : '📄';

            const name = document.createElement('span');
            name.textContent = file.name;
            name.style.cssText = `
                flex: 1;
                font-family: monospace;
            `;

            const size = document.createElement('span');
            if (!file.isDirectory && file.size !== undefined) {
                size.textContent = this.formatFileSize(file.size);
                size.style.cssText = `
                    color: #666;
                    font-size: 12px;
                    margin-left: 10px;
                `;
            }

            fileItem.appendChild(icon);
            fileItem.appendChild(name);
            if (size.textContent) fileItem.appendChild(size);

            if (file.isDirectory) {
                fileItem.onclick = () => {
                    const newPath = currentPath ? `${currentPath}/${file.name}` : file.name;
                    this.loadArchiveContents(archivePath, newPath, contentArea, pathDisplay, backBtn);
                };
            } else {
                fileItem.onclick = () => {
                    const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
                    this.previewFile(archivePath, filePath, file.name, index);
                };
            }

            fileList.appendChild(fileItem);
        });

        contentArea.appendChild(fileList);
        
        // Auto-select first file for keyboard navigation
        if (files.length > 0) {
            setTimeout(() => this.selectArchiveFile(0), 100);
        }
    }

    getBaseName(path) {
        return path.split('/').pop() || path;
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    async previewFile(archivePath, filePath, fileName, fileIndex) {
        // Clean up any existing preview handlers
        if (this.previewKeydownHandler) {
            document.removeEventListener('keydown', this.previewKeydownHandler);
            this.previewKeydownHandler = null;
        }

        this.previewIndex = fileIndex;

        try {
            const contentOther = document.getElementById('content-other');
            if (!contentOther) throw new Error('Content container not found');

            contentOther.innerHTML = '';
            contentOther.style.display = 'block';

            const extension = fileName.split('.').pop().toLowerCase();

            if (extension === 'pdf') {
                const pdfUrl = `/archive-file?archive=${encodeURIComponent(archivePath)}&file=${encodeURIComponent(filePath)}`;
                
                const previewContainer = document.createElement('div');
                previewContainer.className = 'archive-preview-container';
                previewContainer.style.cssText = `background: white; border: 1px solid #ccc; padding: 10px; border-radius: 5px; height: 80vh;`;

                const controls = document.createElement('div');
                controls.className = 'archive-preview-controls';
                controls.style.cssText = `display: flex; align-items: center; margin-bottom: 10px; gap: 10px;`;

                const backBtn = document.createElement('button');
                backBtn.textContent = '← Back to Archive';
                backBtn.onclick = () => this.revertToListView(archivePath, contentOther);

                const fileInfo = document.createElement('span');
                fileInfo.textContent = `Viewing: ${fileName}`;
                fileInfo.style.fontWeight = 'bold';

                controls.appendChild(backBtn);
                controls.appendChild(fileInfo);

                const iframe = document.createElement('iframe');
                iframe.style.cssText = `width: 100%; height: calc(100% - 40px); border: 1px solid #ddd;`;
                iframe.src = pdfUrl;

                previewContainer.appendChild(controls);
                previewContainer.appendChild(iframe);
                contentOther.appendChild(previewContainer);

                this.previewKeydownHandler = (e) => this.handlePreviewKeys(e, archivePath, contentOther, pdfUrl, fileIndex);
                document.addEventListener('keydown', this.previewKeydownHandler);
            } else {
                const previewContainer = document.createElement('div');
                previewContainer.className = 'archive-preview-container';
                previewContainer.style.cssText = `background: white; border: 1px solid #ccc; padding: 10px; border-radius: 5px;`;

                const controls = document.createElement('div');
                controls.className = 'archive-preview-controls';
                controls.style.cssText = `display: flex; align-items: center; margin-bottom: 10px; gap: 10px;`;

                const backBtn = document.createElement('button');
                backBtn.textContent = '← Back to Archive';
                backBtn.onclick = () => this.revertToListView(archivePath, contentOther);

                const fileInfo = document.createElement('span');
                fileInfo.textContent = `Viewing: ${fileName}`;
                fileInfo.style.fontWeight = 'bold';

                controls.appendChild(backBtn);
                controls.appendChild(fileInfo);

                const img = document.createElement('img');
                img.style.cssText = `max-width: 100%; max-height: 80vh; display: block; margin: 0 auto; border: 1px solid #ddd;`;

                previewContainer.appendChild(controls);
                previewContainer.appendChild(img);
                contentOther.appendChild(previewContainer);

                const response = await window.authManager.authenticatedFetch(`/archive-file?archive=${encodeURIComponent(archivePath)}&file=${encodeURIComponent(filePath)}`);
                if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                img.src = url;

                this.previewKeydownHandler = (e) => this.handlePreviewKeys(e, archivePath, contentOther, url, fileIndex);
                document.addEventListener('keydown', this.previewKeydownHandler);

                img.onload = () => URL.revokeObjectURL(url); // Revoke on load to free memory
            }

        } catch (error) {
            console.error('Preview error:', error);
            alert(`Error previewing file: ${error.message}`);
        }
    }

    handlePreviewKeys(e, archivePath, contentOther, currentUrl, fileIndex) {
        if (e.target.tagName === 'INPUT') return;

        const navigate = (direction) => {
            let currentFileIndex = this.previewIndex;

            let nextIndex = -1;

            if (direction === 'next') {
                for (let i = currentFileIndex + 1; i < this.archiveFiles.length; i++) {
                    if (!this.archiveFiles[i].isDirectory) {
                        nextIndex = i;
                        break;
                    }
                }
            } else { // prev
                for (let i = currentFileIndex - 1; i >= 0; i--) {
                    if (!this.archiveFiles[i].isDirectory) {
                        nextIndex = i;
                        break;
                    }
                }
            }

            if (nextIndex !== -1) {
                const nextFile = this.archiveFiles[nextIndex];
                const nextFilePath = this.currentPath ? `${this.currentPath}/${nextFile.name}` : nextFile.name;
                this.previewFile(archivePath, nextFilePath, nextFile.name, nextIndex);
            }
        };

        switch (e.key) {
            case 'Escape':
            case 'Backspace':
                e.preventDefault();
                this.revertToListView(archivePath, contentOther);
                break;
            case 'ArrowLeft':
                e.preventDefault();
                navigate('prev');
                break;
            case 'ArrowRight':
                e.preventDefault();
                navigate('next');
                break;
        }
    }

    

    revertToListView(archivePath, contentOther) {
        if (this.previewKeydownHandler) {
            document.removeEventListener('keydown', this.previewKeydownHandler);
            this.previewKeydownHandler = null;
        }
        this.previewIndex = -1;
        // Re-render the file list view
        const navBar = document.createElement('div');
        const pathDisplay = document.createElement('span');
        const backBtn = document.createElement('button');
        this.loadArchiveContents(archivePath, this.currentPath, contentOther, pathDisplay, backBtn);
    }

    setupKeyboardNavigation(archivePath, contentArea, pathDisplay, backBtn) {
        this.keydownHandler = (event) => {
            if (this.archiveFiles.length === 0) return;

            let newIndex = this.selectedIndex;
            switch(event.key) {
                case 'ArrowUp':
                    event.preventDefault();
                    newIndex = this.selectedIndex > 0 ? this.selectedIndex - 1 : this.archiveFiles.length - 1;
                    break;
                case 'ArrowDown':
                    event.preventDefault();
                    newIndex = this.selectedIndex < this.archiveFiles.length - 1 ? this.selectedIndex + 1 : 0;
                    break;
                case 'Home':
                    event.preventDefault();
                    newIndex = 0;
                    break;
                case 'End':
                    event.preventDefault();
                    newIndex = this.archiveFiles.length - 1;
                    break;
                case 'Enter':
                    event.preventDefault();
                    if (this.selectedIndex >= 0 && this.selectedIndex < this.archiveFiles.length) {
                        const file = this.archiveFiles[this.selectedIndex];
                        if (file.isDirectory) {
                            const newPath = this.currentPath ? `${this.currentPath}/${file.name}` : file.name;
                            this.loadArchiveContents(this.currentArchive, newPath, contentArea, pathDisplay, backBtn);
                        } else {
                            const filePath = this.currentPath ? `${this.currentPath}/${file.name}` : file.name;
                            this.previewFile(this.currentArchive, filePath, file.name, this.selectedIndex);
                        }
                    }
                    return;
                case 'Backspace':
                    event.preventDefault();
                    if (this.currentPath !== '') {
                        const parentPath = this.currentPath.split('/').slice(0, -1).join('/');
                        this.loadArchiveContents(this.currentArchive, parentPath, contentArea, pathDisplay, backBtn);
                    }
                    return;
            }

            if (newIndex !== this.selectedIndex) {
                this.selectArchiveFile(newIndex);
            }
        };

        document.addEventListener('keydown', this.keydownHandler);
    }

    selectArchiveFile(index) {
        const fileItems = document.querySelectorAll('.archive-content .file-item');
        fileItems.forEach(item => item.style.backgroundColor = 'white');

        if (index >= 0 && index < this.archiveFiles.length && index < fileItems.length) {
            this.selectedIndex = index;
            const selectedItem = fileItems[index];
            selectedItem.style.backgroundColor = '#e3f2fd';
            selectedItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }
}

class HtmlRenderer {
    constructor() {
        this.handleKeyDown = null;
        this.zoomLevel = 1.0;
        this.minZoom = 0.1;
        this.maxZoom = 5.0;
        this.zoomStep = 0.1;
    }

    cleanup() {
        if (this.handleKeyDown) {
            document.removeEventListener('keydown', this.handleKeyDown);
            this.handleKeyDown = null;
        }
    }

    async render(filePath, fileName, contentCode, contentOther) {
        this.cleanup();
        this.zoomLevel = 1.0;

        try {
            contentOther.innerHTML = '';
            contentOther.style.display = 'block';

            const htmlContainer = document.createElement('div');
            htmlContainer.className = 'html-container';
            htmlContainer.style.cssText = `
                width: 100%;
                height: 100vh;
                display: flex;
                flex-direction: column;
                background: white;
                border: 1px solid #ccc;
                border-radius: 5px;
            `;

            // Create controls
            const controls = document.createElement('div');
            controls.className = 'html-controls';
            controls.style.cssText = `
                display: flex;
                align-items: center;
                padding: 10px;
                background: #f5f5f5;
                border-bottom: 1px solid #ddd;
                gap: 10px;
                flex-shrink: 0;
            `;

            const fileInfo = document.createElement('span');
            fileInfo.textContent = `HTML: ${fileName}`;
            fileInfo.style.fontWeight = 'bold';

            const zoomControls = document.createElement('div');
            zoomControls.style.cssText = `display: flex; align-items: center; gap: 5px; margin-left: auto;`;
            
            const zoomOutBtn = document.createElement('button');
            zoomOutBtn.textContent = '−';
            zoomOutBtn.title = 'Zoom Out';
            zoomOutBtn.onclick = () => this.adjustZoom(-this.zoomStep);

            const zoomDisplay = document.createElement('span');
            zoomDisplay.id = 'zoom-display';
            zoomDisplay.textContent = '100%';
            zoomDisplay.style.cssText = `min-width: 50px; text-align: center; font-family: monospace;`;

            const zoomInBtn = document.createElement('button');
            zoomInBtn.textContent = '+';
            zoomInBtn.title = 'Zoom In';
            zoomInBtn.onclick = () => this.adjustZoom(this.zoomStep);

            const resetBtn = document.createElement('button');
            resetBtn.textContent = 'Reset';
            resetBtn.title = 'Reset Zoom';
            resetBtn.onclick = () => this.setZoom(1.0);

            const fitBtn = document.createElement('button');
            fitBtn.textContent = 'Fit';
            fitBtn.title = 'Fit to Window';
            fitBtn.onclick = () => this.fitToWindow();

            zoomControls.appendChild(zoomOutBtn);
            zoomControls.appendChild(zoomDisplay);
            zoomControls.appendChild(zoomInBtn);
            zoomControls.appendChild(resetBtn);
            zoomControls.appendChild(fitBtn);

            controls.appendChild(fileInfo);
            controls.appendChild(zoomControls);

            // Create iframe container with scrolling
            const iframeContainer = document.createElement('div');
            iframeContainer.style.cssText = `
                flex: 1;
                overflow: auto;
                background: #f0f0f0;
                position: relative;
            `;

            // Create iframe
            const iframe = document.createElement('iframe');
            iframe.id = 'html-iframe';
            iframe.style.cssText = `
                width: 100%;
                height: 100%;
                border: none;
                background: white;
                transform-origin: top left;
                transition: transform 0.2s ease;
            `;

            // Set iframe source to the HTML file
            const htmlUrl = `/file?path=${encodeURIComponent(filePath)}`;
            iframe.src = htmlUrl;

            // Handle iframe load to implement auto-scaling
            iframe.onload = () => {
                this.setupAutoScaling(iframe, iframeContainer);
            };

            iframeContainer.appendChild(iframe);
            htmlContainer.appendChild(controls);
            htmlContainer.appendChild(iframeContainer);
            contentOther.appendChild(htmlContainer);

            // Setup keyboard controls
            this.handleKeyDown = (e) => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                
                switch(e.key) {
                    case '+':
                    case '=':
                        e.preventDefault();
                        this.adjustZoom(this.zoomStep);
                        break;
                    case '-':
                        e.preventDefault();
                        this.adjustZoom(-this.zoomStep);
                        break;
                    case '0':
                        if (e.ctrlKey || e.metaKey) {
                            e.preventDefault();
                            this.setZoom(1.0);
                        }
                        break;
                    case 'f':
                        if (e.ctrlKey || e.metaKey) {
                            e.preventDefault();
                            this.fitToWindow();
                        }
                        break;
                }
            };

            document.addEventListener('keydown', this.handleKeyDown);

        } catch (error) {
            console.error('HTML rendering error:', error);
            contentOther.innerHTML = `<div style="padding: 20px; color: red;">Error rendering HTML: ${error.message}</div>`;
        }
    }

    setupAutoScaling(iframe, container) {
        try {
            // Get iframe document dimensions
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            const body = iframeDoc.body;
            const html = iframeDoc.documentElement;

            if (!body || !html) return;

            // Get actual content dimensions
            const contentWidth = Math.max(
                body.scrollWidth,
                body.offsetWidth,
                html.clientWidth,
                html.scrollWidth,
                html.offsetWidth
            );

            const contentHeight = Math.max(
                body.scrollHeight,
                body.offsetHeight,
                html.clientHeight,
                html.scrollHeight,
                html.offsetHeight
            );

            // Get container dimensions
            const containerWidth = container.clientWidth;
            const containerHeight = container.clientHeight;

            // If content is larger than container, auto-scale
            if (contentWidth > containerWidth || contentHeight > containerHeight) {
                const scaleX = containerWidth / contentWidth;
                const scaleY = containerHeight / contentHeight;
                const autoScale = Math.min(scaleX, scaleY, 1.0);

                if (autoScale < 1.0) {
                    this.setZoom(autoScale);
                    console.log(`Auto-scaled to ${Math.round(autoScale * 100)}% to fit content`);
                }
            }
        } catch (error) {
            console.warn('Auto-scaling failed (likely due to CORS):', error.message);
        }
    }

    adjustZoom(delta) {
        const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoomLevel + delta));
        this.setZoom(newZoom);
    }

    setZoom(zoom) {
        this.zoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
        
        const iframe = document.getElementById('html-iframe');
        const zoomDisplay = document.getElementById('zoom-display');
        
        if (iframe) {
            iframe.style.transform = `scale(${this.zoomLevel})`;
            
            // Adjust iframe dimensions to account for scaling
            const scaledWidth = 100 / this.zoomLevel;
            const scaledHeight = 100 / this.zoomLevel;
            iframe.style.width = `${scaledWidth}%`;
            iframe.style.height = `${scaledHeight}%`;
        }
        
        if (zoomDisplay) {
            zoomDisplay.textContent = `${Math.round(this.zoomLevel * 100)}%`;
        }
    }

    fitToWindow() {
        const iframe = document.getElementById('html-iframe');
        const container = iframe?.parentElement;
        
        if (!iframe || !container) return;

        try {
            // Get iframe document dimensions
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            const body = iframeDoc.body;
            const html = iframeDoc.documentElement;

            if (!body || !html) {
                this.setZoom(1.0);
                return;
            }

            const contentWidth = Math.max(
                body.scrollWidth,
                body.offsetWidth,
                html.clientWidth,
                html.scrollWidth,
                html.offsetWidth
            );

            const containerWidth = container.clientWidth;
            const fitScale = Math.min(1.0, containerWidth / contentWidth);
            
            this.setZoom(fitScale);
        } catch (error) {
            console.warn('Fit to window failed:', error.message);
            this.setZoom(1.0);
        }
    }
}