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

// ComicRenderer is now in comic-renderer.js

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

    async render(filePath, fileName, contentCode, contentOther, options = {}) {
        this.cleanup();
        const initialSubPath = options.initialSubPath || '';
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
            window.logger.error('DOCX render error:', error);
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
            window.logger.error('XLSX render error:', error);
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
            window.logger.error('PPTX render error:', error);
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
        this.viewMode = localStorage.getItem('archiveViewMode') || 'shelf'; // 'shelf' | 'split'
        this.sortField = localStorage.getItem('librarySortField') || 'name';
        this.sortAsc = (localStorage.getItem('librarySortAsc') || 'true') === 'true';
        this.contentArea = null;
        this.pathDisplay = null;
        this.backBtn = null;
        this.previewPane = null;
        this.bodyArea = null;
        this.subPdfRenderer = null;
        this.thumbAbortController = null;
        this.previewObjectUrl = null;
        this.panelMode = false;
        this.panels = null;
        this.panelIndex = -1;
        this.panelsFromAI = false;
        this.panelImg = null;
        this.panelStage = null;
        this.panelStatusEl = null;
        this.panelKey = null;
        this.panelNavBusy = false;
        this.aiPanelAbort = null;
        this.panView = null;
        this.drag = null;
        this.panelMouseDown = null;
        this.panelMouseMove = null;
        this.panelMouseUp = null;
        this.panelWingsHandler = null;
    }

    cleanupPreviewPanel() {
        if (this.aiPanelAbort) {
            this.aiPanelAbort.abort('cleanup');
            this.aiPanelAbort = null;
        }
        if (this.panelMouseDown) {
            document.removeEventListener('mousedown', this.panelMouseDown);
            document.removeEventListener('mousemove', this.panelMouseMove);
            document.removeEventListener('mouseup', this.panelMouseUp);
            this.panelMouseDown = this.panelMouseMove = this.panelMouseUp = null;
        }
        if (this.panelWingsHandler) {
            window.removeEventListener('wings-changed', this.panelWingsHandler);
            this.panelWingsHandler = null;
        }
        if (this.previewObjectUrl) {
            URL.revokeObjectURL(this.previewObjectUrl);
            this.previewObjectUrl = null;
        }
        this.panelMode = false;
        this.panels = null;
        this.panelIndex = -1;
        this.panelsFromAI = false;
        this.panelImg = null;
        this.panelStage = null;
        this.panelStatusEl = null;
        this.panelKey = null;
        this.panView = null;
        this.drag = null;
    }

    cleanup() {
        this.cleanupPreviewPanel();
        this.currentPath = '';
        this.currentArchive = null;
        this.selectedIndex = -1;
        this.archiveFiles = [];
        this.previewIndex = -1;
        this.contentArea = null;
        this.pathDisplay = null;
        this.backBtn = null;
        this.previewPane = null;
        this.bodyArea = null;
        if (this.thumbAbortController) {
            this.thumbAbortController.abort();
            this.thumbAbortController = null;
        }
        if (this.subPdfRenderer) {
            this.subPdfRenderer.cleanup();
            this.subPdfRenderer = null;
        }
        
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

    getFileType(file) {
        if (file.isDirectory) return 'directory';
        const ext = (file.name.includes('.') ? file.name.split('.').pop() : '').toLowerCase();
        if (['mp4', 'avi', 'mov', 'mkv', 'webm', 'mpg', 'mpeg', 'wmv', 'm4v', 'flv'].includes(ext)) return 'video';
        if (['jpg', 'jpeg', 'jfif', 'pjpeg', 'pjp', 'png', 'gif', 'webp', 'bmp'].includes(ext)) return 'image';
        if (ext === 'pdf') return 'pdf';
        if (['cbz', 'cbr'].includes(ext)) return 'comic';
        if (ext === 'epub') return 'epub';
        if (['docx', 'doc'].includes(ext)) return 'docx';
        return 'generic';
    }

    getTypeIcon(type) {
        const icons = {
            directory: '📁',
            video: '🎬',
            image: '🖼️',
            pdf: '📄',
            comic: '📚',
            epub: '📖',
            docx: '📝',
            generic: '📄'
        };
        return icons[type] || icons.generic;
    }

    sortArchiveFiles(files) {
        return [...files].sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) {
                return a.isDirectory ? -1 : 1;
            }
            let cmp = 0;
            switch (this.sortField) {
                case 'name':
                    cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
                    break;
                case 'date': {
                    const da = a.modified ? new Date(a.modified).getTime() : 0;
                    const db = b.modified ? new Date(b.modified).getTime() : 0;
                    cmp = da - db;
                    break;
                }
                case 'size':
                    cmp = (a.size || 0) - (b.size || 0);
                    break;
                case 'type': {
                    const ea = (a.name.includes('.') ? a.name.split('.').pop() : '').toLowerCase();
                    const eb = (b.name.includes('.') ? b.name.split('.').pop() : '').toLowerCase();
                    cmp = ea.localeCompare(eb) || a.name.toLowerCase().localeCompare(b.name.toLowerCase());
                    break;
                }
            }
            return this.sortAsc ? cmp : -cmp;
        });
    }

    async render(filePath, fileName, contentCode, contentOther, options = {}) {
        this.cleanup();
        const initialSubPath = options.initialSubPath || '';
        
        const archiveContainer = document.createElement('div');
        archiveContainer.className = 'archive-container';
        archiveContainer.style.cssText = `
            background: #2a2a2a;
            border: 1px solid #444;
            border-radius: 8px;
            font-family: Arial, sans-serif;
            max-width: 100%;
            height: 85vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        `;

        // Navigation bar
        const navBar = document.createElement('div');
        navBar.className = 'archive-nav';
        navBar.style.cssText = `
            background: #333;
            border-bottom: 1px solid #555;
            padding: 10px 14px;
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
        `;

        const backBtn = document.createElement('button');
        backBtn.textContent = '← Back';
        backBtn.disabled = true;

        const pathDisplay = document.createElement('span');
        pathDisplay.style.cssText = `
            font-family: monospace;
            background: #2a2a2a;
            color: #4ecdc4;
            padding: 6px 12px;
            border: 1px solid #555;
            border-radius: 4px;
            flex: 1;
            min-width: 160px;
        `;
        pathDisplay.textContent = fileName;

        // Sort controls (matching LibraryRenderer)
        const sortSelect = document.createElement('select');
        sortSelect.className = 'library-sort-field';
        sortSelect.innerHTML = `
            <option value="name">Name</option>
            <option value="date">Date</option>
            <option value="size">Size</option>
            <option value="type">Type</option>
        `;
        sortSelect.value = this.sortField;

        const sortDirBtn = document.createElement('button');
        sortDirBtn.className = 'library-sort-direction';
        sortDirBtn.textContent = this.sortAsc ? '↑' : '↓';
        sortDirBtn.title = this.sortAsc ? 'Sorted ascending' : 'Sorted descending';

        // View mode toggle: Library Shelf vs Split List
        const viewToggleBtn = document.createElement('button');
        const updateViewBtnLabel = () => {
            viewToggleBtn.textContent = this.viewMode === 'shelf' ? '☰ Split List' : '📚 Shelf View';
            viewToggleBtn.title = this.viewMode === 'shelf' ? 'Switch to Split List + Live Preview' : 'Switch to Library Shelf View (collage)';
        };
        updateViewBtnLabel();

        navBar.appendChild(backBtn);
        navBar.appendChild(pathDisplay);
        navBar.appendChild(sortSelect);
        navBar.appendChild(sortDirBtn);
        navBar.appendChild(viewToggleBtn);

        const bodyArea = document.createElement('div');
        bodyArea.className = 'archive-body';
        bodyArea.style.cssText = `
            flex: 1;
            display: flex;
            min-height: 0;
            overflow: hidden;
        `;

        const contentArea = document.createElement('div');
        contentArea.className = 'archive-content';

        const previewPane = document.createElement('div');
        previewPane.className = 'archive-inline-preview';

        this.contentArea = contentArea;
        this.pathDisplay = pathDisplay;
        this.backBtn = backBtn;
        this.previewPane = previewPane;
        this.bodyArea = bodyArea;

        const applyLayoutMode = () => {
            bodyArea.innerHTML = '';
            if (this.viewMode === 'shelf') {
                contentArea.style.cssText = `
                    flex: 1;
                    width: 100%;
                    height: 100%;
                    overflow-y: auto;
                    padding: 0;
                `;
                bodyArea.appendChild(contentArea);
            } else {
                contentArea.style.cssText = `
                    width: 38%;
                    min-width: 260px;
                    max-width: 480px;
                    overflow-y: auto;
                    padding: 10px;
                    border-right: 1px solid #444;
                `;
                previewPane.style.cssText = `
                    flex: 1;
                    min-width: 0;
                    height: 100%;
                    overflow: auto;
                    padding: 10px;
                    display: flex;
                    flex-direction: column;
                    background: #1e1e1e;
                `;
                previewPane.innerHTML = '<div style="color: #888; padding: 20px; text-align: center;">Select a file to preview</div>';
                bodyArea.appendChild(contentArea);
                bodyArea.appendChild(previewPane);
            }
        };

        applyLayoutMode();

        sortSelect.addEventListener('change', () => {
            this.sortField = sortSelect.value;
            localStorage.setItem('librarySortField', this.sortField);
            this.renderFileList(this.archiveFiles, this.currentArchive, this.currentPath, contentArea, pathDisplay, backBtn);
        });

        sortDirBtn.addEventListener('click', () => {
            this.sortAsc = !this.sortAsc;
            localStorage.setItem('librarySortAsc', String(this.sortAsc));
            sortDirBtn.textContent = this.sortAsc ? '↑' : '↓';
            this.renderFileList(this.archiveFiles, this.currentArchive, this.currentPath, contentArea, pathDisplay, backBtn);
        });

        viewToggleBtn.addEventListener('click', () => {
            this.viewMode = this.viewMode === 'shelf' ? 'split' : 'shelf';
            localStorage.setItem('archiveViewMode', this.viewMode);
            updateViewBtnLabel();
            applyLayoutMode();
            this.renderFileList(this.archiveFiles, this.currentArchive, this.currentPath, contentArea, pathDisplay, backBtn);
        });

        archiveContainer.appendChild(navBar);
        archiveContainer.appendChild(bodyArea);
        contentOther.appendChild(archiveContainer);
        contentOther.style.display = 'block';

        // Load archive contents
        try {
            await this.loadArchiveContents(filePath, initialSubPath, contentArea, pathDisplay, backBtn);
            this.setupKeyboardNavigation(filePath, contentArea, pathDisplay, backBtn);
        } catch (error) {
            window.logger.error('Archive load error:', error);
            contentArea.innerHTML = `<div style="color: red; padding: 20px;">Error loading archive: ${error.message}</div>`;
        }
    }

    async loadArchiveContents(archivePath, subPath, contentArea, pathDisplay, backBtn) {
        if (this.thumbAbortController) {
            this.thumbAbortController.abort();
            this.thumbAbortController = null;
        }
        contentArea.innerHTML = '<div style="padding: 20px;">⏳ Loading archive contents...</div>';
        
        try {
            const response = await window.authManager.authenticatedFetch(`/archive-contents?path=${encodeURIComponent(archivePath)}&subPath=${encodeURIComponent(subPath)}`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            this.renderFileList(data, archivePath, subPath, contentArea, pathDisplay, backBtn);
        } catch (error) {
            window.logger.error('Failed to load archive contents:', error);
            contentArea.innerHTML = `<div style="color: red; padding: 20px;">Error: ${error.message}</div>`;
        }
    }

    renderFileList(files, archivePath, currentPath, contentArea, pathDisplay, backBtn) {
        contentArea.innerHTML = '';
        
        const sortedFiles = this.sortArchiveFiles(files);

        // Store current state
        this.archiveFiles = sortedFiles;
        this.currentArchive = archivePath;
        this.currentPath = currentPath;
        this.selectedIndex = -1;
        
        // Update path display
        const displayPath = currentPath ? `${this.getBaseName(archivePath)}/${currentPath}` : this.getBaseName(archivePath);
        pathDisplay.textContent = `${displayPath} (${sortedFiles.length} items)`;
        
        // Update back button
        backBtn.disabled = !currentPath;
        backBtn.onclick = () => {
            const parentPath = currentPath.split('/').slice(0, -1).join('/');
            this.loadArchiveContents(archivePath, parentPath, contentArea, pathDisplay, backBtn);
        };

        if (sortedFiles.length === 0) {
            contentArea.innerHTML = '<div style="padding: 20px; color: #666;">No files found in this location.</div>';
            if (this.previewPane) {
                this.previewPane.innerHTML = '<div style="color: #888; padding: 20px; text-align: center;">No files to preview</div>';
            }
            return;
        }

        if (this.viewMode === 'shelf') {
            this.renderShelfView(sortedFiles, archivePath, currentPath, contentArea, pathDisplay, backBtn);
            return;
        }

        const fileList = document.createElement('div');
        fileList.className = 'file-list';

        sortedFiles.forEach((file, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.style.cssText = `
                display: flex;
                align-items: center;
                padding: 8px 12px;
                border-bottom: 1px solid #444;
                cursor: pointer;
                transition: background-color 0.2s;
            `;

            const icon = document.createElement('span');
            icon.style.cssText = `
                margin-right: 10px;
                font-size: 16px;
                width: 20px;
            `;
            icon.textContent = this.getTypeIcon(this.getFileType(file));

            const name = document.createElement('span');
            name.textContent = file.name;
            name.style.cssText = `
                flex: 1;
                font-family: monospace;
                word-break: break-all;
            `;

            const size = document.createElement('span');
            if (!file.isDirectory && file.size !== undefined && file.size !== null) {
                size.textContent = this.formatFileSize(file.size);
                size.style.cssText = `
                    color: #888;
                    font-size: 12px;
                    margin-left: 10px;
                    white-space: nowrap;
                `;
            }

            fileItem.appendChild(icon);
            fileItem.appendChild(name);
            if (size.textContent) fileItem.appendChild(size);

            if (file.isDirectory) {
                fileItem.onclick = () => {
                    this.selectArchiveFile(index, { autoPreview: false });
                    const newPath = currentPath ? `${currentPath}/${file.name}` : file.name;
                    this.loadArchiveContents(archivePath, newPath, contentArea, pathDisplay, backBtn);
                };
            } else {
                fileItem.onclick = () => {
                    this.selectArchiveFile(index, { autoPreview: true });
                };
                fileItem.ondblclick = () => {
                    const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
                    this.previewFile(archivePath, filePath, file.name, index, { fullView: true });
                };
            }

            fileList.appendChild(fileItem);
        });

        contentArea.appendChild(fileList);
        
        // Auto-select first file for immediate preview and keyboard navigation
        if (sortedFiles.length > 0) {
            const firstFileIdx = sortedFiles.findIndex(f => !f.isDirectory);
            const initialIdx = firstFileIdx !== -1 ? firstFileIdx : 0;
            setTimeout(() => this.selectArchiveFile(initialIdx, { autoPreview: true }), 50);
        }
    }

    renderShelfView(sortedFiles, archivePath, currentPath, contentArea, pathDisplay, backBtn) {
        const container = document.createElement('div');
        container.className = 'library-container';
        container.style.minHeight = '100%';

        const loadingBar = document.createElement('div');
        loadingBar.className = 'library-loading';
        loadingBar.innerHTML = `
            <div class="library-loading-text">Loading previews... <span class="archive-loading-percent">0%</span></div>
            <div class="library-loading-bar">
                <div class="library-loading-fill archive-loading-fill"></div>
            </div>
        `;
        container.appendChild(loadingBar);

        const shelf = document.createElement('div');
        shelf.className = 'library-shelf';

        const maxSize = Math.max(...sortedFiles.map(f => f.size || 0), 1);

        sortedFiles.forEach((file, index) => {
            const type = this.getFileType(file);
            const item = document.createElement('div');
            item.className = 'library-book archive-shelf-item';
            item.dataset.index = index;
            item.dataset.name = file.name;

            const sizeRatio = (file.size || 0) / maxSize;
            const shadowDepth = Math.max(3, Math.min(20, Math.floor(sizeRatio * 20)));
            item.style.setProperty('--book-shadow-depth', `${shadowDepth}px`);
            item.style.setProperty('--book-shadow-blur', `${shadowDepth * 1.5}px`);

            let hash = 0;
            for (let i = 0; i < file.name.length; i++) {
                hash = (hash * 31 + file.name.charCodeAt(i)) >>> 0;
            }
            const tilt = ((hash % 7) - 3) * 0.6;
            const placeholderRatio = 0.6 + ((hash >>> 3) % 8) * 0.12;
            item.style.setProperty('--tilt', `${tilt}deg`);
            item.style.setProperty('--thumb-ratio', placeholderRatio.toFixed(2));

            const thumbContainer = document.createElement('div');
            thumbContainer.className = 'library-thumb-container';

            const thumbnail = document.createElement('div');
            thumbnail.className = `library-thumbnail library-thumb-${type}`;
            thumbnail.dataset.type = type;
            thumbnail.dataset.file = file.name;
            thumbnail.innerHTML = `<span class="library-placeholder-icon">${this.getTypeIcon(type)}</span>`;

            thumbContainer.appendChild(thumbnail);
            item.appendChild(thumbContainer);

            const info = document.createElement('div');
            info.className = 'library-info';
            const shortName = file.name.length > 28
                ? file.name.substring(0, 22) + '...' + (file.name.includes('.') ? '.' + file.name.split('.').pop() : '')
                : file.name;
            info.innerHTML = `
                <span class="library-name" title="${file.name}">${shortName}</span>
                ${!file.isDirectory && file.size != null ? `<span class="library-size">${this.formatFileSize(file.size)}</span>` : ''}
            `;
            item.appendChild(info);

            item.addEventListener('click', (e) => {
                e.preventDefault();
                this.selectArchiveFile(index, { autoPreview: false });
                if (file.isDirectory) {
                    const newPath = currentPath ? `${currentPath}/${file.name}` : file.name;
                    this.loadArchiveContents(archivePath, newPath, contentArea, pathDisplay, backBtn);
                } else {
                    const entryPath = currentPath ? `${currentPath}/${file.name}` : file.name;
                    this.previewFile(archivePath, entryPath, file.name, index, { fullView: true });
                }
            });

            shelf.appendChild(item);
        });

        container.appendChild(shelf);
        contentArea.appendChild(container);

        this.loadShelfThumbnails(shelf, loadingBar, archivePath, currentPath);
    }

    async loadShelfThumbnails(shelf, loadingBar, archivePath, currentPath) {
        if (this.thumbAbortController) {
            this.thumbAbortController.abort();
        }
        const abortController = new AbortController();
        this.thumbAbortController = abortController;
        const { signal } = abortController;

        const items = Array.from(shelf.querySelectorAll('.library-thumbnail'));
        const total = items.length;
        let loaded = 0;

        const percentEl = loadingBar.querySelector('.archive-loading-percent');
        const fillEl = loadingBar.querySelector('.archive-loading-fill');

        const updateProgress = () => {
            const pct = total > 0 ? Math.round((loaded / total) * 100) : 100;
            if (percentEl) percentEl.textContent = `${pct}%`;
            if (fillEl) fillEl.style.width = `${pct}%`;
            if (pct >= 100) {
                setTimeout(() => {
                    loadingBar.classList.add('complete');
                    setTimeout(() => { loadingBar.style.display = 'none'; }, 300);
                }, 200);
            }
        };

        updateProgress();

        const showThumb = (thumbEl, url) => {
            let img = thumbEl.querySelector('img.library-thumb-img');
            if (!img) {
                img = document.createElement('img');
                img.className = 'library-thumb-img';
                img.onload = () => {
                    if (img.naturalWidth && img.naturalHeight) {
                        const ratio = Math.min(1.8, Math.max(0.5, img.naturalWidth / img.naturalHeight));
                        thumbEl.closest('.library-book')?.style.setProperty('--thumb-ratio', ratio.toFixed(3));
                    }
                    const icon = thumbEl.querySelector('.library-placeholder-icon');
                    if (icon) icon.style.display = 'none';
                };
                thumbEl.insertBefore(img, thumbEl.firstChild);
            }
            img.src = url;
        };

        // Fast server-side two-pass LOD thumbnails (handles PDFs of any size & images, cached on disk)
        const jobs = [];
        for (const thumbEl of items) {
            const type = thumbEl.dataset.type;
            if (type === 'image' || type === 'pdf') {
                jobs.push({ el: thumbEl, name: thumbEl.dataset.file, ok: false, done: false });
            } else {
                loaded++;
            }
        }
        updateProgress();
        if (jobs.length === 0) return;

        const byName = new Map(jobs.map(j => [j.name, j]));
        const streamBatch = async (batchJobs, size, onThumb) => {
            for (const j of batchJobs) j.done = false;
            let resp;
            try {
                resp = await window.authManager.authenticatedFetch('/api/archive-thumbnails', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        archive: archivePath,
                        subPath: currentPath || '',
                        files: batchJobs.map(j => j.name),
                        size,
                    }),
                    signal,
                });
            } catch (e) {
                return signal.aborted ? 'aborted' : 'unsupported';
            }
            if (!resp || resp.status === 404 || resp.status === 405) return 'unsupported';
            if (!resp.ok || !resp.body) return 'failed';

            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            const handle = (line) => {
                if (!line.trim()) return;
                let msg;
                try { msg = JSON.parse(line); } catch { return; }
                const job = byName.get(msg.name);
                if (!job || job.done) return;
                job.done = true;
                onThumb(job, msg.data ? `data:${msg.type};base64,${msg.data}` : null, msg);
            };
            try {
                for (;;) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    let nl;
                    while ((nl = buffer.indexOf('\n')) >= 0) {
                        handle(buffer.slice(0, nl));
                        buffer = buffer.slice(nl + 1);
                    }
                }
                handle(buffer);
            } catch (e) {
                if (!signal.aborted) window.logger.debug?.('Archive thumb stream interrupted:', e);
            }
            return 'ok';
        };

        const tinyStatus = await streamBatch(jobs, 96, (job, url, msg) => {
            if (url) {
                job.ok = true;
                showThumb(job.el, url);
            } else if (msg && msg.corrupted) {
                const reason = msg.error || 'Corrupted file';
                const book = job.el.closest('.library-book');
                if (book) {
                    book.classList.add('library-book-corrupted');
                    book.title = `⚠️ ${reason}`;
                }
                if (!job.el.querySelector('.library-corrupted-badge')) {
                    const badge = document.createElement('div');
                    badge.className = 'library-corrupted-badge';
                    badge.textContent = '⚠️ CORRUPTED';
                    job.el.appendChild(badge);
                }
                let reasonEl = job.el.querySelector('.library-corrupted-reason');
                if (!reasonEl) {
                    reasonEl = document.createElement('div');
                    reasonEl.className = 'library-corrupted-reason';
                    job.el.appendChild(reasonEl);
                }
                reasonEl.textContent = reason.replace(/^Corrupted:\s*/i, '');
            }
            loaded++;
            updateProgress();
        });
        if (tinyStatus === 'ok') {
            if (signal.aborted || !shelf.isConnected) return;
            for (const j of jobs) if (!j.done) { j.done = true; loaded++; }
            updateProgress();
            const sharp = jobs.filter(j => j.ok);
            if (sharp.length) {
                await streamBatch(sharp, 400, (job, url) => {
                    if (url) showThumb(job.el, url);
                });
            }
            return;
        }
        if (signal.aborted || !shelf.isConnected) return;

        // Fallback for servers without /api/archive-thumbnails: client-side rendering
        const MAX_INLINE_PDF_THUMB_BYTES = 64 * 1024 * 1024;
        let nextIdx = 0;
        const worker = async () => {
            while (nextIdx < jobs.length) {
                const job = jobs[nextIdx++];
                const thumbEl = job.el;
                if (signal.aborted || !shelf.isConnected) return;

                const type = thumbEl.dataset.type;
                const fileName = thumbEl.dataset.file;
                const fileMeta = this.archiveFiles.find(f => f.name === fileName);
                const entryPath = currentPath ? `${currentPath}/${fileName}` : fileName;
                const rawUrl = `/archive-file?archive=${encodeURIComponent(archivePath)}&file=${encodeURIComponent(entryPath)}`;

                try {
                    if (type === 'image') {
                        await new Promise((resolve) => {
                            const img = document.createElement('img');
                            img.className = 'library-thumb-img';
                            img.loading = 'lazy';
                            img.onload = () => {
                                if (img.naturalWidth && img.naturalHeight) {
                                    const ratio = Math.min(1.8, Math.max(0.5, img.naturalWidth / img.naturalHeight));
                                    thumbEl.closest('.library-book')?.style.setProperty('--thumb-ratio', ratio.toFixed(3));
                                }
                                const icon = thumbEl.querySelector('.library-placeholder-icon');
                                if (icon) icon.style.display = 'none';
                                resolve();
                            };
                            img.onerror = () => resolve();
                            img.src = rawUrl;
                            thumbEl.insertBefore(img, thumbEl.firstChild);
                        });
                    } else if (type === 'pdf' && (!fileMeta || !fileMeta.size || fileMeta.size <= MAX_INLINE_PDF_THUMB_BYTES)) {
                        if (window.pdfJsLoaded) {
                            await window.pdfJsLoaded.catch(() => {});
                        }
                        if (typeof pdfjsLib !== 'undefined' && !signal.aborted) {
                            const resp = await window.authManager.authenticatedFetch(rawUrl, { signal });
                            if (resp && resp.ok && !signal.aborted) {
                                const buf = await resp.arrayBuffer();
                                if (signal.aborted) return;
                                const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
                                const page = await pdf.getPage(1);
                                const baseVp = page.getViewport({ scale: 1 });
                                const scale = Math.min(1.5, 260 / (baseVp.width || 260));
                                const vp = page.getViewport({ scale });

                                const canvas = document.createElement('canvas');
                                canvas.width = vp.width;
                                canvas.height = vp.height;
                                await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;

                                showThumb(thumbEl, canvas.toDataURL('image/jpeg', 0.82));
                                pdf.destroy?.();
                            }
                        }
                    }
                } catch (err) {
                    if (err?.name !== 'AbortError') {
                        window.logger.debug?.('Archive thumb error:', fileName, err);
                    }
                } finally {
                    loaded++;
                    updateProgress();
                }
            }
        };

        await Promise.all(Array.from({ length: Math.min(2, jobs.length) }, () => worker()));
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

    async previewFile(archivePath, filePath, fileName, fileIndex, { fullView = false, enterPanelMode = null } = {}) {
        // Clean up any existing full-view preview handlers, panel mode, or active PDF renderer
        this.cleanupPreviewPanel();
        if (this.previewKeydownHandler) {
            document.removeEventListener('keydown', this.previewKeydownHandler);
            this.previewKeydownHandler = null;
        }
        if (this.subPdfRenderer) {
            this.subPdfRenderer.cleanup();
            this.subPdfRenderer = null;
        }

        this.previewIndex = fileIndex;

        try {
            const targetContainer = fullView
                ? document.getElementById('content-other')
                : (this.previewPane || document.getElementById('content-other'));
            if (!targetContainer) throw new Error('Content container not found');

            const isInline = targetContainer === this.previewPane && !fullView;
            targetContainer.innerHTML = '';
            targetContainer.style.display = isInline ? 'flex' : 'block';

            const extension = fileName.split('.').pop().toLowerCase();
            const rawUrl = `/archive-file?archive=${encodeURIComponent(archivePath)}&file=${encodeURIComponent(filePath)}`;

            const createControls = () => {
                const controls = document.createElement('div');
                controls.className = 'archive-preview-controls';
                controls.style.cssText = `display: flex; align-items: center; margin-bottom: 10px; gap: 10px; padding: 6px 10px; border-radius: 4px; flex-shrink: 0;`;

                if (!isInline) {
                    const backBtn = document.createElement('button');
                    backBtn.textContent = '← Back to Archive';
                    backBtn.onclick = () => this.revertToListView(archivePath, targetContainer);
                    controls.appendChild(backBtn);
                }

                const fileInfo = document.createElement('span');
                fileInfo.textContent = fileName;
                fileInfo.style.cssText = 'font-weight: bold; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
                controls.appendChild(fileInfo);

                if (isInline) {
                    const expandBtn = document.createElement('button');
                    expandBtn.textContent = '⛶ Full View';
                    expandBtn.title = 'Open full preview (Enter)';
                    expandBtn.onclick = () => this.previewFile(archivePath, filePath, fileName, fileIndex, { fullView: true });
                    controls.appendChild(expandBtn);
                }

                const openTabLink = document.createElement('a');
                openTabLink.href = rawUrl;
                openTabLink.target = '_blank';
                openTabLink.rel = 'noopener';
                openTabLink.textContent = '↗ Open';
                openTabLink.style.cssText = 'color: #4ecdc4; text-decoration: none; font-size: 12px; padding: 4px 8px; border: 1px solid #4ecdc4; border-radius: 4px;';
                controls.appendChild(openTabLink);

                return controls;
            };

            if (extension === 'pdf') {
                const previewContainer = document.createElement('div');
                previewContainer.className = 'archive-preview-container';
                previewContainer.style.cssText = `background: #2a2a2a; border: 1px solid #444; padding: 10px; border-radius: 5px; height: ${isInline ? '100%' : '85vh'}; display: flex; flex-direction: column; flex: 1;`;

                const controls = createControls();
                previewContainer.appendChild(controls);

                const pdfHost = document.createElement('div');
                pdfHost.style.cssText = 'flex: 1; min-height: 0; overflow: auto; position: relative;';
                previewContainer.appendChild(pdfHost);
                targetContainer.appendChild(previewContainer);

                if (typeof PDFRenderer !== 'undefined') {
                    this.subPdfRenderer = new PDFRenderer();
                    await this.subPdfRenderer.render(rawUrl, fileName, document.createElement('pre'), pdfHost, {
                        onAdjacentFile: (step) => this.navigateArchiveEntry(step, ['pdf'], archivePath, targetContainer, { fullView: !isInline }),
                    });
                } else {
                    const iframe = document.createElement('iframe');
                    iframe.style.cssText = `width: 100%; height: 100%; border: 1px solid #444; background: #fff; border-radius: 4px;`;
                    iframe.src = rawUrl;
                    pdfHost.appendChild(iframe);
                }

                if (!isInline) {
                    this.previewKeydownHandler = (e) => {
                        if (e.defaultPrevented) return;
                        if (e.key === 'Escape' || e.key === 'Backspace') {
                            e.preventDefault();
                            this.revertToListView(archivePath, targetContainer);
                        }
                    };
                    document.addEventListener('keydown', this.previewKeydownHandler);
                }
            } else if (extension === 'ipynb') {
                // Handle Jupyter Notebook files from archives
                const previewContainer = document.createElement('div');
                previewContainer.className = 'archive-preview-container';
                previewContainer.style.cssText = `background: #1a1a2e; border: 1px solid #333; padding: 10px; border-radius: 5px; height: ${isInline ? '100%' : '85vh'}; overflow-y: auto; flex: 1;`;

                const controls = createControls();
                previewContainer.appendChild(controls);

                // Fetch notebook content from archive
                const response = await window.authManager.authenticatedFetch(rawUrl);
                if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

                const rawText = await response.text();
                
                // Create a container for the notebook content
                const notebookContent = document.createElement('div');
                notebookContent.id = 'archive-notebook-content';
                previewContainer.appendChild(notebookContent);
                targetContainer.appendChild(previewContainer);

                // Use the NotebookRenderer if available
                if (typeof NotebookRenderer !== 'undefined') {
                    const notebookRenderer = new NotebookRenderer();
                    let notebook;
                    try {
                        notebook = JSON.parse(rawText);
                    } catch (e) {
                        notebookContent.innerHTML = `<div style="color: #ff6b6b; padding: 20px;">Invalid .ipynb file (not valid JSON)</div>`;
                        return;
                    }

                    if (!notebook || !Array.isArray(notebook.cells)) {
                        notebookContent.innerHTML = `<div style="color: #ff6b6b; padding: 20px;">Invalid .ipynb file (missing cells)</div>`;
                        return;
                    }

                    const wrapper = document.createElement('div');
                    wrapper.className = 'notebook-container';

                    const header = document.createElement('div');
                    header.className = 'notebook-header';

                    const title = document.createElement('div');
                    title.className = 'notebook-title';
                    title.textContent = fileName;

                    const meta = document.createElement('div');
                    meta.className = 'notebook-meta';
                    meta.textContent = notebookRenderer.formatNotebookMeta(notebook);

                    const actions = document.createElement('div');
                    actions.className = 'notebook-actions';

                    const toggleRawBtn = document.createElement('button');
                    toggleRawBtn.className = 'notebook-action-btn';
                    toggleRawBtn.textContent = 'Raw JSON';

                    const downloadLink = document.createElement('a');
                    downloadLink.className = 'notebook-action-btn';
                    downloadLink.href = rawUrl;
                    downloadLink.download = fileName;
                    downloadLink.textContent = 'Download';

                    actions.appendChild(toggleRawBtn);
                    actions.appendChild(downloadLink);

                    header.appendChild(title);
                    header.appendChild(meta);
                    header.appendChild(actions);

                    const body = document.createElement('div');
                    body.className = 'notebook-body';

                    const rawPanel = document.createElement('pre');
                    rawPanel.className = 'notebook-raw';
                    rawPanel.style.display = 'none';
                    rawPanel.textContent = rawText;

                    const renderedPanel = document.createElement('div');
                    renderedPanel.className = 'notebook-rendered';

                    notebookRenderer.renderCells(notebook, renderedPanel);

                    body.appendChild(renderedPanel);
                    body.appendChild(rawPanel);

                    wrapper.appendChild(header);
                    wrapper.appendChild(body);

                    notebookContent.appendChild(wrapper);

                    toggleRawBtn.addEventListener('click', () => {
                        const showRaw = rawPanel.style.display === 'none';
                        rawPanel.style.display = showRaw ? 'block' : 'none';
                        renderedPanel.style.display = showRaw ? 'none' : 'block';
                        toggleRawBtn.textContent = showRaw ? 'Rendered' : 'Raw JSON';
                    });
                } else {
                    const pre = document.createElement('pre');
                    pre.style.cssText = 'background: #222; color: #f8f8f2; border-radius: 8px; padding: 16px; font-size: 1em; font-family: monospace; line-height: 1.8; overflow-x: auto; white-space: pre-wrap; word-break: break-word;';
                    pre.textContent = rawText;
                    notebookContent.appendChild(pre);
                }

                if (!isInline) {
                    this.previewKeydownHandler = (e) => this.handlePreviewKeys(e, archivePath, targetContainer, null, fileIndex);
                    document.addEventListener('keydown', this.previewKeydownHandler);
                }
            } else if (['docx', 'doc'].includes(extension) && typeof mammoth !== 'undefined') {
                const previewContainer = document.createElement('div');
                previewContainer.className = 'archive-preview-container';
                previewContainer.style.cssText = `background: #2a2a2a; border: 1px solid #444; padding: 10px; border-radius: 5px; height: ${isInline ? '100%' : '85vh'}; display: flex; flex-direction: column; flex: 1;`;

                const controls = createControls();
                previewContainer.appendChild(controls);

                const response = await window.authManager.authenticatedFetch(rawUrl);
                if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                const arrayBuffer = await response.arrayBuffer();
                const result = await mammoth.convertToHtml({ arrayBuffer });

                const docxDiv = document.createElement('div');
                docxDiv.style.cssText = 'background: #fff; color: #111; padding: 20px; border-radius: 4px; flex: 1; overflow-y: auto; line-height: 1.6;';
                docxDiv.innerHTML = result.value;
                previewContainer.appendChild(docxDiv);
                targetContainer.appendChild(previewContainer);

                if (!isInline) {
                    this.previewKeydownHandler = (e) => this.handlePreviewKeys(e, archivePath, targetContainer, null, fileIndex);
                    document.addEventListener('keydown', this.previewKeydownHandler);
                }
            } else if (['xlsx', 'xls'].includes(extension) && typeof XLSX !== 'undefined') {
                const previewContainer = document.createElement('div');
                previewContainer.className = 'archive-preview-container';
                previewContainer.style.cssText = `background: #2a2a2a; border: 1px solid #444; padding: 10px; border-radius: 5px; height: ${isInline ? '100%' : '85vh'}; display: flex; flex-direction: column; flex: 1;`;

                const controls = createControls();
                previewContainer.appendChild(controls);

                const response = await window.authManager.authenticatedFetch(rawUrl);
                if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                const arrayBuffer = await response.arrayBuffer();
                const workbook = XLSX.read(arrayBuffer, { type: 'array' });

                const sheetDiv = document.createElement('div');
                sheetDiv.style.cssText = 'background: #fff; color: #111; padding: 12px; border-radius: 4px; flex: 1; overflow: auto;';
                sheetDiv.innerHTML = XLSX.utils.sheet_to_html(workbook.Sheets[workbook.SheetNames[0]]);
                previewContainer.appendChild(sheetDiv);
                targetContainer.appendChild(previewContainer);

                if (!isInline) {
                    this.previewKeydownHandler = (e) => this.handlePreviewKeys(e, archivePath, targetContainer, null, fileIndex);
                    document.addEventListener('keydown', this.previewKeydownHandler);
                }
            } else if (['mp4', 'webm', 'mov', 'mkv', 'avi', 'mpg', 'mpeg', 'wmv'].includes(extension)) {
                const previewContainer = document.createElement('div');
                previewContainer.className = 'archive-preview-container';
                previewContainer.style.cssText = `background: #2a2a2a; border: 1px solid #444; padding: 10px; border-radius: 5px; height: ${isInline ? '100%' : '85vh'}; display: flex; flex-direction: column; flex: 1;`;

                const controls = createControls();
                const video = document.createElement('video');
                video.controls = true;
                video.autoplay = !isInline;
                video.style.cssText = 'width: 100%; max-height: 75vh; flex: 1; background: #000; border-radius: 4px;';
                video.src = rawUrl;

                previewContainer.appendChild(controls);
                previewContainer.appendChild(video);
                targetContainer.appendChild(previewContainer);

                if (!isInline) {
                    this.previewKeydownHandler = (e) => this.handlePreviewKeys(e, archivePath, targetContainer, rawUrl, fileIndex);
                    document.addEventListener('keydown', this.previewKeydownHandler);
                }
            } else if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'].includes(extension)) {
                const previewContainer = document.createElement('div');
                previewContainer.className = 'archive-preview-container';
                previewContainer.style.cssText = `background: #2a2a2a; border: 1px solid #444; padding: 10px; border-radius: 5px; display: flex; flex-direction: column; gap: 16px;`;

                const controls = createControls();
                const audio = document.createElement('audio');
                audio.controls = true;
                audio.src = rawUrl;
                audio.style.cssText = 'width: 100%;';

                previewContainer.appendChild(controls);
                previewContainer.appendChild(audio);
                targetContainer.appendChild(previewContainer);

                if (!isInline) {
                    this.previewKeydownHandler = (e) => this.handlePreviewKeys(e, archivePath, targetContainer, rawUrl, fileIndex);
                    document.addEventListener('keydown', this.previewKeydownHandler);
                }
            } else if (['html', 'htm'].includes(extension)) {
                const previewContainer = document.createElement('div');
                previewContainer.className = 'archive-preview-container';
                previewContainer.style.cssText = `background: #2a2a2a; border: 1px solid #444; padding: 10px; border-radius: 5px; height: ${isInline ? '100%' : '85vh'}; display: flex; flex-direction: column; flex: 1;`;

                const controls = createControls();
                const iframe = document.createElement('iframe');
                iframe.style.cssText = 'width: 100%; flex: 1; border: 1px solid #444; background: #fff; border-radius: 4px;';
                iframe.src = rawUrl;

                previewContainer.appendChild(controls);
                previewContainer.appendChild(iframe);
                targetContainer.appendChild(previewContainer);

                if (!isInline) {
                    this.previewKeydownHandler = (e) => this.handlePreviewKeys(e, archivePath, targetContainer, rawUrl, fileIndex);
                    document.addEventListener('keydown', this.previewKeydownHandler);
                }
            } else {
                const previewContainer = document.createElement('div');
                previewContainer.className = 'archive-preview-container';
                previewContainer.style.cssText = `background: #2a2a2a; border: 1px solid #444; padding: 10px; border-radius: 5px; height: ${isInline ? '100%' : '85vh'}; display: flex; flex-direction: column; flex: 1; overflow: auto;`;

                const controls = createControls();
                previewContainer.appendChild(controls);
                targetContainer.appendChild(previewContainer);

                const response = await window.authManager.authenticatedFetch(rawUrl);
                if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

                const contentMode = response.headers.get('X-Content-Mode');
                const contentType = response.headers.get('Content-Type') || '';
                if (contentMode === 'hex' || contentType.startsWith('text/') || contentType.includes('json') || contentType.includes('javascript') || contentType.includes('xml')) {
                    const text = await response.text();
                    const pre = document.createElement('pre');
                    pre.style.cssText = 'background: #222; color: #f8f8f2; border-radius: 8px; padding: 16px; font-size: 0.9em; font-family: monospace; line-height: 1.6; overflow: auto; flex: 1; white-space: pre-wrap; word-break: break-word; box-sizing: border-box; margin: 0;';
                    pre.textContent = text;
                    previewContainer.appendChild(pre);
                    if (!isInline) {
                        this.previewKeydownHandler = (e) => this.handlePreviewKeys(e, archivePath, targetContainer, null, fileIndex);
                        document.addEventListener('keydown', this.previewKeydownHandler);
                    }
                } else {
                    const statusSpan = document.createElement('span');
                    statusSpan.className = 'archive-panel-status';
                    statusSpan.style.cssText = 'font-style: italic; color: #4ecdc4; font-size: 12px; margin-left: 8px; white-space: nowrap;';
                    controls.appendChild(statusSpan);

                    const stage = document.createElement('div');
                    stage.className = 'archive-image-stage';
                    stage.style.cssText = 'flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative;';
                    const img = document.createElement('img');
                    img.style.cssText = `max-width: 100%; max-height: 100%; object-fit: contain; display: block; border: 1px solid #444; border-radius: 4px; transform-origin: 0 0; transition: transform 0.25s ease;`;
                    stage.appendChild(img);
                    previewContainer.appendChild(stage);

                    const blob = await response.blob();
                    const url = URL.createObjectURL(blob);
                    this.previewObjectUrl = url;
                    this.panelImg = img;
                    this.panelStage = stage;
                    this.panelStatusEl = statusSpan;
                    this.panelKey = `zip:${archivePath}:${filePath}`;
                    img.src = url;

                    this.setupImagePanelInteractions();
                    if (!isInline) {
                        this.previewKeydownHandler = (e) => this.handlePreviewKeys(e, archivePath, targetContainer, url, fileIndex);
                        document.addEventListener('keydown', this.previewKeydownHandler);
                    }
                    if (enterPanelMode) {
                        try { await img.decode(); } catch (e) { /* decode fallback */ }
                        if (this.panelImg === img) {
                            await this.enterImagePanelMode(enterPanelMode === 'last' ? -1 : 0);
                        }
                    }
                }
            }

        } catch (error) {
            window.logger.error('Preview error:', error);
            if (this.previewPane && !fullView) {
                this.previewPane.innerHTML = `<div style="color: #ff6b6b; padding: 20px;">Error previewing ${fileName}: ${error.message}</div>`;
            } else {
                alert(`Error previewing file: ${error.message}`);
            }
        }
    }

    navigateArchiveEntry(step, extensions, archivePath, targetContainer, { fullView = true, enterPanelMode = null } = {}) {
        const files = this.archiveFiles;
        if (!files || !files.length || this.previewIndex < 0) return false;
        const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
        for (let k = 1; k < files.length; k++) {
            const idx = (((this.previewIndex + step * k) % files.length) + files.length) % files.length;
            const file = files[idx];
            if (file.isDirectory) continue;
            if (extensions && extensions.length && !extensions.includes(extOf(file.name))) continue;
            const nextFilePath = this.currentPath ? `${this.currentPath}/${file.name}` : file.name;
            this.previewFile(archivePath, nextFilePath, file.name, idx, { fullView, enterPanelMode });
            return true;
        }
        return false;
    }

    setupImagePanelInteractions() {
        this.panelMouseDown = (e) => {
            if (e.button !== 0 || !this.panelMode || !this.panView || !this.panelImg || !this.panelStage) return;
            if (!this.panelStage.contains(e.target)) return;
            e.preventDefault();
            this.drag = { x: e.clientX, y: e.clientY, tx: this.panView.tx, ty: this.panView.ty };
            this.panelImg.style.transition = 'none';
            this.panelImg.style.cursor = 'grabbing';
        };
        this.panelMouseMove = (e) => {
            if (!this.drag || !this.panelImg) return;
            this.panView.tx = this.drag.tx + e.clientX - this.drag.x;
            this.panView.ty = this.drag.ty + e.clientY - this.drag.y;
            this.panelImg.style.transform = `translate(${this.panView.tx}px, ${this.panView.ty}px) scale(${this.panView.scale})`;
        };
        this.panelMouseUp = () => {
            if (!this.drag) return;
            this.drag = null;
            if (this.panelImg) {
                this.panelImg.style.transition = 'transform 0.25s ease';
                this.panelImg.style.cursor = this.panelMode ? 'grab' : '';
            }
        };
        this.panelWingsHandler = () => {
            if (this.panelMode && this.panels) {
                setTimeout(() => this.showImagePanel(this.panelIndex), 0);
            }
        };
        document.addEventListener('mousedown', this.panelMouseDown);
        document.addEventListener('mousemove', this.panelMouseMove);
        document.addEventListener('mouseup', this.panelMouseUp);
        window.addEventListener('wings-changed', this.panelWingsHandler);
    }

    async enterImagePanelMode(startIndex = 0) {
        const helper = window.ComicPanelHelper;
        const img = this.panelImg;
        if (!helper || !img || !img.src) return;
        try { await img.decode(); } catch (e) { /* keep going */ }
        if (this.panelImg !== img) return;

        this.panelMode = true;
        this.panels = helper.detectPanels(img);
        this.panelsFromAI = false;
        const idx = startIndex < 0 ? this.panels.length - 1 : startIndex;
        this.showImagePanel(idx);
        this.requestImageAIPanels(img, startIndex < 0);
    }

    exitImagePanelMode() {
        if (this.aiPanelAbort) {
            this.aiPanelAbort.abort('exit');
            this.aiPanelAbort = null;
        }
        if (this.panelImg) {
            this.panelImg.style.transform = '';
            this.panelImg.style.cursor = '';
        }
        if (this.panelStatusEl) this.panelStatusEl.textContent = '';
        this.panelMode = false;
        this.panels = null;
        this.panelIndex = -1;
        this.panelsFromAI = false;
        this.panView = null;
        this.drag = null;
    }

    async requestImageAIPanels(img, jumpToLast = false) {
        const helper = window.ComicPanelHelper;
        if (!helper || !this.panelKey) return;
        if (this.aiPanelAbort) this.aiPanelAbort.abort('superseded');
        const abort = new AbortController();
        this.aiPanelAbort = abort;
        const key = this.panelKey;
        if (this.panelStatusEl) this.panelStatusEl.textContent = `${this.panelStatusEl.textContent} · AI…`;
        try {
            const res = await helper.fetchAIPanels(img, key, { signal: abort.signal });
            if (abort.signal.aborted || !this.panelMode || this.panelImg !== img) return;
            if (res && res.panels) {
                this.panels = res.panels;
                this.panelsFromAI = true;
                const targetIdx = jumpToLast ? res.panels.length - 1 : Math.min(Math.max(this.panelIndex, 0), res.panels.length - 1);
                this.showImagePanel(targetIdx);
            } else {
                this.showImagePanel(this.panelIndex);
            }
        } catch (err) {
            if (err?.name !== 'AbortError') {
                window.logger.warn('[ArchiveRenderer] AI panels failed:', err?.message || err);
                if (this.panelMode && this.panelImg === img) this.showImagePanel(this.panelIndex);
            }
        }
    }

    showImagePanel(index) {
        const helper = window.ComicPanelHelper;
        if (!helper || !this.panelImg || !this.panelStage || !this.panels || !this.panels.length) return;
        this.panelIndex = Math.max(0, Math.min(index, this.panels.length - 1));
        this.panView = helper.applyPanelTransform(this.panelImg, this.panelStage, this.panels[this.panelIndex]);
        if (this.panelStatusEl) {
            this.panelStatusEl.textContent = `Panel ${this.panelIndex + 1}/${this.panels.length}${this.panelsFromAI ? ' (AI)' : ''}`;
        }
    }

    async nextImagePanel(archivePath, contentOther) {
        if (!this.panelImg) return;
        if (!this.panelMode) {
            await this.enterImagePanelMode(0);
            return;
        }
        if (this.panels && this.panelIndex + 1 < this.panels.length) {
            this.showImagePanel(this.panelIndex + 1);
            return;
        }
        if (this.panelNavBusy) return;
        this.panelNavBusy = true;
        try {
            const imgExts = ['jpg', 'jpeg', 'jfif', 'pjpeg', 'pjp', 'png', 'gif', 'webp', 'bmp'];
            const fullView = Boolean(this.previewKeydownHandler);
            this.navigateArchiveEntry(1, imgExts, archivePath, contentOther, { fullView, enterPanelMode: 'first' });
        } finally {
            this.panelNavBusy = false;
        }
    }

    async previousImagePanel(archivePath, contentOther) {
        if (!this.panelImg) return;
        if (!this.panelMode) {
            await this.enterImagePanelMode(0);
            return;
        }
        if (this.panelIndex > 0) {
            this.showImagePanel(this.panelIndex - 1);
            return;
        }
        if (this.panelNavBusy) return;
        this.panelNavBusy = true;
        try {
            const imgExts = ['jpg', 'jpeg', 'jfif', 'pjpeg', 'pjp', 'png', 'gif', 'webp', 'bmp'];
            const fullView = Boolean(this.previewKeydownHandler);
            this.navigateArchiveEntry(-1, imgExts, archivePath, contentOther, { fullView, enterPanelMode: 'last' });
        } finally {
            this.panelNavBusy = false;
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
                this.previewFile(archivePath, nextFilePath, nextFile.name, nextIndex, { fullView: true });
            }
        };

        switch (e.key) {
            case 'Escape':
                e.preventDefault();
                if (this.panelMode) {
                    this.exitImagePanelMode();
                } else {
                    this.revertToListView(archivePath, contentOther);
                }
                break;
            case 'Backspace':
                e.preventDefault();
                this.revertToListView(archivePath, contentOther);
                break;
            case '.':
                if (this.panelImg) {
                    e.preventDefault();
                    this.nextImagePanel(archivePath, contentOther);
                }
                break;
            case ',':
                if (this.panelImg) {
                    e.preventDefault();
                    this.previousImagePanel(archivePath, contentOther);
                }
                break;
            case '0':
                if (this.panelImg) {
                    e.preventDefault();
                    if (!this.panelMode) this.enterImagePanelMode(0);
                    else this.showImagePanel(0);
                }
                break;
            case 'ArrowLeft':
            case 'a':
                e.preventDefault();
                navigate('prev');
                break;
            case 'ArrowRight':
            case 'd':
                e.preventDefault();
                navigate('next');
                break;
            case 'n':
            case 'N':
                if (e.ctrlKey || e.altKey || e.metaKey) break;
                e.preventDefault();
                this.navigateArchiveEntry(1, null, archivePath, contentOther, { fullView: true });
                break;
            case 'p':
            case 'P':
                if (e.ctrlKey || e.altKey || e.metaKey) break;
                e.preventDefault();
                this.navigateArchiveEntry(-1, null, archivePath, contentOther, { fullView: true });
                break;
        }
    }

    async revertToListView(archivePath, contentOther) {
        this.cleanupPreviewPanel();
        if (this.previewKeydownHandler) {
            document.removeEventListener('keydown', this.previewKeydownHandler);
            this.previewKeydownHandler = null;
        }
        if (this.subPdfRenderer) {
            this.subPdfRenderer.cleanup();
            this.subPdfRenderer = null;
        }
        const savedPath = this.currentPath;
        const savedIndex = this.previewIndex >= 0 ? this.previewIndex : this.selectedIndex;
        this.previewIndex = -1;

        contentOther.innerHTML = '';
        await this.render(archivePath, this.getBaseName(archivePath), document.getElementById('content-code'), contentOther, { initialSubPath: savedPath });
        if (savedIndex >= 0) {
            setTimeout(() => this.selectArchiveFile(savedIndex, { autoPreview: true }), 60);
        }
    }

    setupKeyboardNavigation(archivePath, contentArea, pathDisplay, backBtn) {
        this.keydownHandler = (event) => {
            if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT' || event.target.tagName === 'TEXTAREA') return;
            // Ignore when full-view preview handler is active
            if (this.previewKeydownHandler) return;
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
                            this.previewFile(this.currentArchive, filePath, file.name, this.selectedIndex, { fullView: true });
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
                case '.':
                    if (this.panelImg) {
                        event.preventDefault();
                        this.nextImagePanel(this.currentArchive || archivePath, this.previewPane || document.getElementById('content-other'));
                        return;
                    }
                    break;
                case ',':
                    if (this.panelImg) {
                        event.preventDefault();
                        this.previousImagePanel(this.currentArchive || archivePath, this.previewPane || document.getElementById('content-other'));
                        return;
                    }
                    break;
                case '0':
                    if (this.panelImg) {
                        event.preventDefault();
                        if (!this.panelMode) this.enterImagePanelMode(0);
                        else this.showImagePanel(0);
                        return;
                    }
                    break;
                case 'Escape':
                    if (this.panelMode) {
                        event.preventDefault();
                        this.exitImagePanelMode();
                        return;
                    }
                    break;
                case 'n':
                case 'N':
                case 'p':
                case 'P':
                    if (event.ctrlKey || event.altKey || event.metaKey) break;
                    event.preventDefault();
                    if (window.fileExplorer && window.fileExplorer.openAdjacentFile) {
                        const name = this.getBaseName(this.currentArchive || archivePath);
                        window.fileExplorer.openAdjacentFile(name, event.key.toLowerCase() === 'n' ? 1 : -1, ['cbz', 'cbr', 'zip', 'rar', '7z']);
                    }
                    return;
            }

            if (newIndex !== this.selectedIndex) {
                this.selectArchiveFile(newIndex, { autoPreview: true });
            }
        };

        document.addEventListener('keydown', this.keydownHandler);
    }

    selectArchiveFile(index, { autoPreview = true } = {}) {
        const fileItems = document.querySelectorAll('.archive-content .file-item, .archive-content .archive-shelf-item');
        fileItems.forEach(item => {
            item.classList.remove('selected');
            item.style.backgroundColor = '';
        });

        if (index >= 0 && index < this.archiveFiles.length && index < fileItems.length) {
            this.selectedIndex = index;
            const selectedItem = fileItems[index];
            selectedItem.classList.add('selected');
            selectedItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

            const file = this.archiveFiles[index];
            if (this.viewMode === 'split' && autoPreview && file && !file.isDirectory && this.previewPane) {
                const filePath = this.currentPath ? `${this.currentPath}/${file.name}` : file.name;
                this.previewFile(this.currentArchive, filePath, file.name, index, { fullView: false });
            } else if (this.viewMode === 'split' && file && file.isDirectory && this.previewPane) {
                this.previewPane.innerHTML = `<div style="color: #888; padding: 20px; text-align: center;">📁 Folder: <strong>${file.name}</strong><br><small>Click or press Enter to open</small></div>`;
            }
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

    async render(filePath, fileName, contentCode, contentOther, options = {}) {
        this.cleanup();
        const initialSubPath = options.initialSubPath || '';
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
            window.logger.error('HTML rendering error:', error);
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
                    window.logger.info(`Auto-scaled to ${Math.round(autoScale * 100)}% to fit content`);
                }
            }
        } catch (error) {
            window.logger.warn('Auto-scaling failed (likely due to CORS):', error.message);
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
            window.logger.warn('Fit to window failed:', error.message);
            this.setZoom(1.0);
        }
    }
}