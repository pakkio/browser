// Shared annotation shortcut handler for all renderers
function handleAnnotationShortcut(key) {
    const fileExplorer = window.fileExplorer;
    if (!fileExplorer) return;
    
    const selectedItems = document.querySelectorAll('.file-item.selected');
    if (selectedItems.length === 0) return;
    
    const selectedItem = selectedItems[0];
    const fileName = selectedItem.querySelector('.file-name').textContent;
    const file = { name: fileName, isDirectory: false };
    
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
    
    if (fileExplorer.quickAnnotate) {
        fileExplorer.quickAnnotate(file, type, value);
    }
}

class ArchiveRenderer {
    constructor() {
        this.keydownHandler = null;
        this.previewKeydownHandler = null;
        this.archiveFiles = [];
        this.currentArchive = '';
        this.currentPath = '';
        this.selectedIndex = -1;
        this.isPreviewMode = false;
        this.previewData = null;
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

    cleanup() {
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
        
        const archiveContainer = this.createArchiveContainer();
        const { navBar, contentArea, pathDisplay, backBtn } = this.createUIElements(archiveContainer, fileName);
        
        contentOther.appendChild(archiveContainer);
        contentOther.style.display = 'block';

        try {
            await this.loadArchiveContents(filePath, '', contentArea, pathDisplay, backBtn);
            this.setupKeyboardNavigation(filePath, contentArea, pathDisplay, backBtn);
        } catch (error) {
            console.error('Archive load error:', error);
            contentArea.innerHTML = `<div style="color: red; padding: 20px;">Error loading archive: ${error.message}</div>`;
        }
    }

    createArchiveContainer() {
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
        return archiveContainer;
    }

    createUIElements(archiveContainer, fileName) {
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

        const contentArea = document.createElement('div');
        contentArea.className = 'archive-content';
        contentArea.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 10px;
        `;

        archiveContainer.appendChild(navBar);
        archiveContainer.appendChild(contentArea);

        return { navBar, contentArea, pathDisplay, backBtn };
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
        
        this.archiveFiles = files;
        this.currentArchive = archivePath;
        this.currentPath = currentPath;
        this.selectedIndex = -1;
        
        const displayPath = currentPath ? `${this.getBaseName(archivePath)}/${currentPath}` : this.getBaseName(archivePath);
        pathDisplay.textContent = displayPath;
        
        backBtn.disabled = !currentPath;
        backBtn.onclick = () => {
            const parentPath = currentPath.split('/').slice(0, -1).join('/');
            this.loadArchiveContents(archivePath, parentPath, contentArea, pathDisplay, backBtn);
        };

        if (files.length === 0) {
            contentArea.innerHTML = '<div style="padding: 20px; color: #666;">No files found in this location.</div>';
            return;
        }

        const fileList = this.createFileList(files, archivePath, currentPath, contentArea, pathDisplay, backBtn);
        contentArea.appendChild(fileList);
    }

    createFileList(files, archivePath, currentPath, contentArea, pathDisplay, backBtn) {
        const fileList = document.createElement('div');
        fileList.className = 'file-list';
        
        const sortedFiles = files.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) {
                return a.isDirectory ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        sortedFiles.forEach((file, index) => {
            const fileItem = this.createFileItem(file, index, archivePath, currentPath);
            fileList.appendChild(fileItem);
        });

        return fileList;
    }

    createFileItem(file, index, archivePath, currentPath) {
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

        return fileItem;
    }

    setupKeyboardNavigation(archivePath, contentArea, pathDisplay, backBtn) {
        this.keydownHandler = (e) => {
            if (e.target.tagName === 'INPUT' || this.isPreviewMode) return;
            
            const fileItems = contentArea.querySelectorAll('.file-item');
            
            switch (e.key) {
                case 'ArrowUp':
                    e.preventDefault();
                    this.navigateSelection(fileItems, -1);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this.navigateSelection(fileItems, 1);
                    break;
                case 'Enter':
                    e.preventDefault();
                    this.activateSelected(fileItems);
                    break;
                case 'Backspace':
                    e.preventDefault();
                    if (!backBtn.disabled) backBtn.click();
                    break;
                case 'r': case 'g': case 'y': case 'b': case 'c':
                case '1': case '2': case '3': case '4': case '5':
                    handleAnnotationShortcut(e.key);
                    break;
            }
        };

        document.addEventListener('keydown', this.keydownHandler);
    }

    navigateSelection(fileItems, direction) {
        if (fileItems.length === 0) return;
        
        fileItems[this.selectedIndex]?.classList.remove('selected');
        
        this.selectedIndex += direction;
        if (this.selectedIndex < 0) this.selectedIndex = fileItems.length - 1;
        if (this.selectedIndex >= fileItems.length) this.selectedIndex = 0;
        
        const selectedItem = fileItems[this.selectedIndex];
        selectedItem.classList.add('selected');
        selectedItem.style.backgroundColor = '#e3f2fd';
        selectedItem.scrollIntoView({ block: 'nearest' });
    }

    activateSelected(fileItems) {
        if (this.selectedIndex >= 0 && this.selectedIndex < fileItems.length) {
            fileItems[this.selectedIndex].click();
        }
    }

    async previewFile(archivePath, filePath, fileName, index) {
        // Implementation for file preview
        console.log('Preview file:', fileName);
    }
}