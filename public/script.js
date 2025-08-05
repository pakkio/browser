console.log('FileRenderer type:', typeof FileRenderer);

// Initialize the main application
function initializeApp() {
    console.log('Initializing main application...');
    
    // Make sure we're authenticated before proceeding
    if (!window.authManager?.authenticated) {
        console.warn('Attempted to initialize app without authentication');
        return;
    }

    initializeFileExplorer();
}

function initializeFileExplorer() {
    const fileList = document.getElementById('file-list');
    const contentCode = document.getElementById('content-code');
    const contentOther = document.getElementById('content-other');
    const fileDetails = document.getElementById('file-details');
    const fileTypeFilter = document.getElementById('file-type-filter');
    const searchInput = document.getElementById('search-input');
    let currentPath = '';
    let currentFiles = [];
    let filteredFiles = [];
    let selectedIndex = -1;
    let serverRootDir = '';  // Will be fetched from server
    const fileRenderer = new FileRenderer();

    function matchesSearchTerms(filename, searchTerms) {
        if (!searchTerms || searchTerms.length === 0) return true;
        
        const lowerFilename = filename.toLowerCase();
        return searchTerms.every(term => lowerFilename.includes(term.toLowerCase()));
    }

    function parseSearchQuery(query) {
        return query.trim().split(/\s+/).filter(term => term.length > 0);
    }

    function loadFiles(path) {
        console.log('Loading files for path:', path);
        
        // Save current path to session
        fetch('/api/current-path', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: path })
        }).catch(err => console.warn('Failed to save current path:', err));
        
        // Show prominent loading popup
        if (window.debugConsole) {
            window.debugConsole.showProgress('Loading directory...', 10);
        }
        
        // Clear current file list
        fileList.innerHTML = '<li style="color: #666;">Loading...</li>';
        
        window.authManager.authenticatedFetch(`/api/browse?path=${encodeURIComponent(path)}`)
            .then(response => {
                if (!response) {
                    // Authentication failed, handled by authManager
                    return;
                }
                console.log('Response status:', response.status);
                if (window.debugConsole) {
                    window.debugConsole.showProgress('Processing response...', 50);
                }
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (!data) return; // Handle auth failure
                console.log('Received data:', data);
                if (window.debugConsole) {
                    window.debugConsole.showProgress('Rendering file list...', 80);
                }
                currentFiles = data.files;
                displayFiles(data.files, path);
                updateCurrentPathDisplay(data.currentPath, data.files.length);
                
                // Auto-display folder contents after loading
                autoDisplayFolderContents(data.files, path);
                
                if (window.debugConsole) {
                    window.debugConsole.showProgress('Complete', 100);
                }
            })
            .catch(error => {
                console.error('Error loading files:', error);
                document.getElementById('current-path-display').textContent = 'Error loading directory';
                fileList.innerHTML = '<li style="color: red;">Error: ' + error.message + '</li>';
            })
            .finally(() => {
                // Hide progress overlay
                if (window.debugConsole) {
                    window.debugConsole.hideProgress();
                }
            });
    }
    
    function displayFiles(data, path) {
        fileList.innerHTML = '';
        
        console.log('displayFiles called with path:', JSON.stringify(path), 'path !== "":', path !== '');
        
        if (path !== '') {
            const parentLi = document.createElement('li');
            parentLi.textContent = '..';
            parentLi.classList.add('parent-dir');
            parentLi.addEventListener('click', () => {
                console.log('Parent directory clicked. Current path:', JSON.stringify(currentPath));
                const lastSlashIndex = currentPath.lastIndexOf('/');
                console.log('Last slash index:', lastSlashIndex);
                
                if (lastSlashIndex > 0) {
                    currentPath = currentPath.substring(0, lastSlashIndex);
                } else {
                    currentPath = '';  // Go to root if we're at first level
                }
                
                console.log('New path after parent navigation:', JSON.stringify(currentPath));
                clearContentView();
                loadFiles(currentPath);
            });
            fileList.appendChild(parentLi);
            console.log('Added parent directory (..) to file list');
        } else {
            console.log('At root directory - not showing parent (..)');
        }
        
        const selectedFilter = fileTypeFilter.value;
        const searchQuery = searchInput.value;
        const searchTerms = parseSearchQuery(searchQuery);
        
        // Perform filtering (both type and search)
        filteredFiles = data.filter(file => {
            // Type filter
            let typeMatches = true;
            if (selectedFilter !== 'all') {
                if (file.isDirectory) {
                    typeMatches = selectedFilter === 'directory';
                } else {
                    const extension = file.name.split('.').pop().toLowerCase();
                    const fileType = getFileTypeFromExtension(extension, file.name);
                    typeMatches = fileType === selectedFilter;
                }
            }
            
            // Search filter
            const searchMatches = matchesSearchTerms(file.name, searchTerms);
            
            return typeMatches && searchMatches;
        });
        
        // Update path display with filtered count if different from total
        const hasFilters = selectedFilter !== 'all' || searchTerms.length > 0;
        if (hasFilters) {
            const pathDisplay = document.getElementById('current-path-display');
            const currentText = pathDisplay.textContent;
            const baseText = currentText.replace(/ \(\d+ items\).*/, '').replace(/ \(\d+ of \d+ items\).*/, '');
            pathDisplay.textContent = `${baseText} (${filteredFiles.length} of ${data.length} items)`;
        }
        
        selectedIndex = -1;
        
        filteredFiles.forEach((file, index) => {
                    const li = document.createElement('li');
                    li.classList.add('file-item');
                    li.setAttribute('data-index', index);
                    
                    const fileIcon = document.createElement('span');
                    fileIcon.classList.add('file-icon');
                    
                    const fileName = document.createElement('span');
                    fileName.classList.add('file-name');
                    fileName.textContent = file.name;
                    
                    const fileSize = document.createElement('span');
                    fileSize.classList.add('file-size');
                    if (file.size) {
                        fileSize.textContent = formatFileSize(file.size);
                    }
                    
                    li.appendChild(fileIcon);
                    li.appendChild(fileName);
                    li.appendChild(fileSize);
                    
                    // Add file type data attribute for styling
                    if (file.isDirectory) {
                        li.setAttribute('data-type', 'directory');
                        li.addEventListener('click', () => {
                            currentPath = path ? `${path}/${file.name}` : file.name;
                            loadFiles(currentPath);
                            updateDetails(null);
                        });
                    } else {
                        const extension = file.name.split('.').pop().toLowerCase();
                        
                        if (extension === 'pdf') {
                            li.setAttribute('data-type', 'pdf');
                        } else if (['cbz', 'cbr'].includes(extension)) {
                            li.setAttribute('data-type', 'comic');
                        } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) {
                            li.setAttribute('data-type', 'image');
                        } else if (['mp4', 'avi', 'mov', 'mkv'].includes(extension)) {
                            li.setAttribute('data-type', 'video');
                        } else if (['mp3', 'wav', 'flac', 'ogg'].includes(extension)) {
                            li.setAttribute('data-type', 'audio');
                        } else if (['js', 'html', 'css', 'json', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'xml', 'yaml', 'yml', 'ini', 'conf', 'log', 'sh', 'bat', 'ps1', 'sql', 'php', 'rb', 'swift', 'kt', 'dart', 'r', 'scala', 'clj', 'elm', 'vue', 'jsx', 'tsx', 'ts', 'less', 'scss', 'sass', 'styl', 'svelte', 'astro'].includes(extension)) {
                            li.setAttribute('data-type', 'code');
                        } else if (extension === 'ipynb') {
                            li.setAttribute('data-type', 'notebook');
                        } else if (['txt', 'md', 'rtf', 'doc', 'docx', 'odt'].includes(extension)) {
                            li.setAttribute('data-type', 'text');
                        } else if (['csv', 'xlsx', 'xls', 'ods'].includes(extension)) {
                            li.setAttribute('data-type', 'table');
                        } else if (['pptx', 'ppt', 'odp'].includes(extension)) {
                            li.setAttribute('data-type', 'presentation');
                        } else if (extension === 'srt') {
                            li.setAttribute('data-type', 'subtitle');
                        } else if (extension === 'epub') {
                            li.setAttribute('data-type', 'ebook');
                        } else if (['zip', 'rar', 'tar', 'tgz', '7z'].includes(extension) || (file.name && file.name.endsWith('.tar.gz'))) {
                            li.setAttribute('data-type', 'archive');
                        } else if (file.name && !file.name.includes('.')) {
                            // Files without extension - treat as text
                            li.setAttribute('data-type', 'text');
                        } else {
                            // Unknown extensions - treat as text for better visibility
                            li.setAttribute('data-type', 'text');
                        }
                        
                        li.addEventListener('click', (e) => {
                            // Check if clicked on annotation button
                            if (e.target.closest('.annotation-btn')) {
                                return; // Don't select file if annotation button was clicked
                            }
                            
                            const filePath = path ? `${path}/${file.name}` : file.name;
                            selectFile(index, filePath, file.name);
                            showContent(path, file.name);
                            updateDetails(file);
                        });

                        li.addEventListener('dblclick', (e) => {
                            // Check if clicked on annotation button
                            if (e.target.closest('.annotation-btn')) {
                                return;
                            }
                            
                            const filePath = path ? `${path}/${file.name}` : file.name;
                            
                            // Open file with default system program
                            window.authManager.authenticatedFetch('/api/open-file', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({ filePath })
                            })
                            .then(response => {
                                if (!response) return; // Auth failure handled by authManager
                                if (!response.ok) {
                                    throw new Error(`Failed to open file: ${response.status}`);
                                }
                                return response.json();
                            })
                            .then(result => {
                                if (result && !result.success) {
                                    console.error('Failed to open file:', result.error);
                                }
                            })
                            .catch(error => {
                                console.error('Error opening file:', error);
                            });
                        });

                        // Add annotation button for files
                        const annotationBtn = document.createElement('button');
                        annotationBtn.className = 'annotation-btn';
                        annotationBtn.innerHTML = '📝';
                        annotationBtn.title = 'Add annotation';
                        annotationBtn.style.cssText = `
                            background: transparent;
                            border: 1px solid #555555;
                            color: #d4d4d4;
                            padding: 2px 6px;
                            border-radius: 3px;
                            cursor: pointer;
                            font-size: 12px;
                            margin-left: auto;
                            opacity: 0.7;
                            transition: all 0.2s;
                            flex-shrink: 0;
                        `;
                        
                        annotationBtn.addEventListener('mouseenter', () => {
                            annotationBtn.style.opacity = '1';
                            annotationBtn.style.background = '#333333';
                        });
                        
                        annotationBtn.addEventListener('mouseleave', () => {
                            annotationBtn.style.opacity = '0.7';
                            annotationBtn.style.background = 'transparent';
                        });
                        
                        annotationBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const filePath = path ? `${path}/${file.name}` : file.name;
                            console.log('Annotation button clicked for:', filePath);
                            
                            if (!window.annotationManager) {
                                console.error('AnnotationManager not initialized');
                                alert('Annotation system not available. Please refresh the page.');
                                return;
                            }
                            
                            try {
                                window.annotationManager.showAnnotationDialog(filePath, file.name);
                            } catch (error) {
                                console.error('Error showing annotation dialog:', error);
                                alert('Failed to open annotation dialog: ' + error.message);
                            }
                        });
                        
                        li.appendChild(annotationBtn);
                        
                    }
                    fileList.appendChild(li);
                });
        
        // Update annotations display after files are loaded
        setTimeout(() => {
            window.annotationManager?.updateFileListDisplay();
        }, 100);
    }

    function showContent(path, fileName, options = {}) {
        const filePath = path ? `${path}/${fileName}` : fileName;
        
        fileRenderer.render(filePath, fileName, contentCode, contentOther, options);
    }
    
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
    
    function updateDetails(file) {
        if (!file) {
            fileDetails.innerHTML = '<p>Select a file to view details</p>';
            return;
        }
        
        const extension = file.name.split('.').pop().toLowerCase();
        const fileType = getFileTypeDescription(extension);
        
        fileDetails.innerHTML = `
            <div class="detail-item">
                <span class="detail-label">Name:</span>
                <span class="detail-value" title="${file.name}">${file.name}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">Type:</span>
                <span class="detail-value">${fileType}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">Extension:</span>
                <span class="detail-value">.${extension}</span>
            </div>
            ${file.size ? `
            <div class="detail-item">
                <span class="detail-label">Size:</span>
                <span class="detail-value">${formatFileSize(file.size)}</span>
            </div>
            ` : ''}
            ${file.modified ? `
            <div class="detail-item">
                <span class="detail-label">Modified:</span>
                <span class="detail-value">${new Date(file.modified).toLocaleDateString()}</span>
            </div>
            ` : ''}
        `;
    }
    
    function getFileTypeFromExtension(extension, fileName = '') {
        if (extension === 'pdf') return 'pdf';
        if (['cbz', 'cbr'].includes(extension)) return 'comic';
        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) return 'image';
        if (['mp4', 'avi', 'mov', 'mkv'].includes(extension)) return 'video';
        if (['mp3', 'wav', 'flac', 'ogg'].includes(extension)) return 'audio';
        if (['js', 'html', 'css', 'json', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'xml', 'yaml', 'yml', 'ini', 'conf', 'log', 'sh', 'bat', 'ps1', 'sql', 'php', 'rb', 'swift', 'kt', 'dart', 'r', 'scala', 'clj', 'elm', 'vue', 'jsx', 'tsx', 'ts', 'less', 'scss', 'sass', 'styl', 'svelte', 'astro'].includes(extension)) return 'code';
        if (extension === 'ipynb') return 'notebook';
        if (['txt', 'md', 'rtf', 'doc', 'docx', 'odt'].includes(extension)) return 'text';
        if (['csv', 'xlsx', 'xls', 'ods'].includes(extension)) return 'table';
        if (['pptx', 'ppt', 'odp'].includes(extension)) return 'presentation';
        if (extension === 'srt') return 'subtitle';
        if (extension === 'epub') return 'ebook';
        if (['zip', 'rar', 'tar', 'tgz', '7z'].includes(extension) || (fileName && fileName.endsWith('.tar.gz'))) return 'archive';
        if (!fileName || !fileName.includes('.')) return 'text'; // Files without extension
        return 'text'; // Unknown extensions treated as text
    }
    
    function getFileTypeDescription(extension) {
        const types = {
            'pdf': 'PDF Document',
            'jpg': 'JPEG Image', 'jpeg': 'JPEG Image', 'png': 'PNG Image', 'gif': 'GIF Image', 'webp': 'WebP Image',
            'mp4': 'MP4 Video', 'avi': 'AVI Video', 'mov': 'QuickTime Video', 'mkv': 'Matroska Video',
            'mp3': 'MP3 Audio', 'wav': 'WAV Audio', 'flac': 'FLAC Audio', 'ogg': 'OGG Audio',
            'txt': 'Text File', 'md': 'Markdown', 'rtf': 'Rich Text Format',
            'doc': 'Word Document', 'docx': 'Word Document', 'odt': 'OpenDocument Text',
            'csv': 'CSV Spreadsheet', 'xls': 'Excel Spreadsheet', 'xlsx': 'Excel Spreadsheet', 'ods': 'OpenDocument Spreadsheet',
            'ppt': 'PowerPoint Presentation', 'pptx': 'PowerPoint Presentation', 'odp': 'OpenDocument Presentation',
            'srt': 'Subtitle File',
            'js': 'JavaScript', 'html': 'HTML Document', 'css': 'CSS Stylesheet', 'json': 'JSON Data',
            'py': 'Python Script', 'java': 'Java Source', 'c': 'C Source', 'cpp': 'C++ Source',
            'xml': 'XML Document', 'yaml': 'YAML Config', 'yml': 'YAML Config',
            'cbz': 'Comic Book Archive', 'cbr': 'Comic Book Archive', 'zip': 'ZIP Archive/Comic Book Archive',
            'epub': 'EPUB E-book',
            'ipynb': 'Jupyter Notebook',
            'rar': 'RAR Archive', 'tar': 'TAR Archive',
            'tgz': 'Compressed TAR Archive', '7z': '7-Zip Archive'
        };
        return types[extension] || 'Text File';
    }
    
    function updateCurrentPathDisplay(fullPath, fileCount) {
        const pathDisplay = document.getElementById('current-path-display');
        
        // Create breadcrumb navigation
        const pathParts = fullPath ? fullPath.split('/') : [];
        let breadcrumbs = `<button class="path-home" onclick="console.log('Home button clicked'); window.fileExplorer.loadFiles('')" title="Go to Root Directory (${serverRootDir})">🏠</button>`;
        
        if (pathParts.length > 0) {
            breadcrumbs += ' / ';
            pathParts.forEach((part, index) => {
                if (part) {
                    const pathToHere = pathParts.slice(0, index + 1).join('/');
                    breadcrumbs += `<button class="path-segment" onclick="window.fileExplorer.loadFiles('${pathToHere}')" title="Navigate to ${pathToHere}">${part}</button>`;
                    if (index < pathParts.length - 1) {
                        breadcrumbs += ' / ';
                    }
                }
            });
        }
        
        breadcrumbs += ` <span class="item-count">(${fileCount} items)</span>`;
        pathDisplay.innerHTML = breadcrumbs;
    }
    
    function selectFile(index, filePath, fileName, options = {}) {
        const items = document.querySelectorAll('.file-item');
        items.forEach(item => item.classList.remove('selected'));

        if (index >= 0 && index < filteredFiles.length) {
            selectedIndex = index;
            items[index].classList.add('selected');
            
            // Scroll into view if needed
            items[index].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }
    
    function handleKeyNavigation(event) {
        // Don't interfere with typing in search input, filter select, or textarea
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT' || event.target.tagName === 'TEXTAREA') {
            return;
        }
        
        // Don't interfere when annotation modal is open
        if (document.querySelector('.annotation-modal-backdrop') || document.querySelector('.bookmarks-modal-backdrop')) {
            return;
        }
        
        // Don't interfere when specific renderers are active that handle their own navigation
        const archiveContainer = document.querySelector('.archive-container');
        const pdfContainer = document.querySelector('.pdf-container');
        if ((archiveContainer && contentOther.style.display !== 'none') || (pdfContainer && contentOther.style.display !== 'none')) {
            return; // Renderer handles its own arrow keys
        }

        if (filteredFiles.length === 0 && event.key !== 'Backspace') return;

        let newIndex = selectedIndex;
        switch(event.key) {
            case 'ArrowUp':
                event.preventDefault();
                newIndex = selectedIndex > 0 ? selectedIndex - 1 : filteredFiles.length - 1;
                break;
            case 'ArrowDown':
                event.preventDefault();
                newIndex = selectedIndex < filteredFiles.length - 1 ? selectedIndex + 1 : 0;
                break;
            case 'PageUp':
                event.preventDefault();
                newIndex = Math.max(0, selectedIndex - 10);
                break;
            case 'PageDown':
                event.preventDefault();
                newIndex = Math.min(filteredFiles.length - 1, selectedIndex + 10);
                break;
            case 'Home':
                event.preventDefault();
                newIndex = 0;
                break;
            case 'End':
                event.preventDefault();
                newIndex = filteredFiles.length - 1;
                break;
            case 'Enter':
                event.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < filteredFiles.length) {
                    const file = filteredFiles[selectedIndex];
                    if (file.isDirectory) {
                        currentPath = currentPath ? `${currentPath}/${file.name}` : file.name;
                        loadFiles(currentPath);
                        updateDetails(null);
                    } else {
                        showContent(currentPath, file.name, { autoPlay: true, keyboardNavigation: true });
                    }
                }
                return;
            case 'Backspace':
                event.preventDefault();
                if (currentPath !== '') {
                    currentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
                    loadFiles(currentPath);
                    updateDetails(null);
                }
                return;
            case '/':
                event.preventDefault();
                // Focus on search input when user types '/'
                searchInput.focus();
                return;
            case 'Escape':
                event.preventDefault();
                // Clear search when Escape is pressed
                if (searchInput.value !== '') {
                    searchInput.value = '';
                    displayFiles(currentFiles, currentPath);
                    // Re-focus on file list
                    document.querySelector('.file-item.selected')?.focus();
                }
                return;
            case 'r':
                event.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < filteredFiles.length) {
                    quickAnnotate(filteredFiles[selectedIndex], 'color', '#f44336');
                }
                return;
            case 'g':
                event.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < filteredFiles.length) {
                    quickAnnotate(filteredFiles[selectedIndex], 'color', '#4caf50');
                }
                return;
            case 'y':
                event.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < filteredFiles.length) {
                    quickAnnotate(filteredFiles[selectedIndex], 'color', '#ffeb3b');
                }
                return;
            case 'b':
                event.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < filteredFiles.length) {
                    quickAnnotate(filteredFiles[selectedIndex], 'color', '#2196f3');
                }
                return;
            case 'c':
                event.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < filteredFiles.length) {
                    quickAnnotate(filteredFiles[selectedIndex], 'comment');
                }
                return;
            case '1':
            case '2':
            case '3':
            case '4':
            case '5':
                event.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < filteredFiles.length) {
                    quickAnnotate(filteredFiles[selectedIndex], 'stars', parseInt(event.key));
                }
                return;
        }
        if (newIndex !== selectedIndex) {
            const file = filteredFiles[newIndex];
            const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
            const isVideo = ['mp4', 'avi', 'mov', 'mkv', 'webm', 'mpg', 'mpeg', 'wmv'].includes(
                file.name.split('.').pop().toLowerCase()
            );
            const options = isVideo ? { autoPlay: true, keyboardNavigation: true } : {};
            selectFile(newIndex, filePath, file.name, options);
            updateDetails(file);
        }
    }
    
    // Event listeners
    document.addEventListener('keydown', handleKeyNavigation);
    
    fileTypeFilter.addEventListener('change', () => {
        // Show brief loading for filtering large directories
        if (currentFiles.length > 100) {
            if (window.debugConsole) {
                window.debugConsole.showProgress('Filtering files...', 50);
            }
            
            setTimeout(() => {
                displayFiles(currentFiles, currentPath);
                if (window.debugConsole) {
                    window.debugConsole.hideProgress();
                }
            }, 50);
        } else {
            displayFiles(currentFiles, currentPath);
        }
    });

    searchInput.addEventListener('input', () => {
        // Show brief loading for searching in large directories
        if (currentFiles.length > 100) {
            if (window.debugConsole) {
                window.debugConsole.showProgress('Searching files...', 30);
            }
            
            setTimeout(() => {
                displayFiles(currentFiles, currentPath);
                if (window.debugConsole) {
                    window.debugConsole.hideProgress();
                }
            }, 50);
        } else {
            displayFiles(currentFiles, currentPath);
        }
    });

    // Bookmarks button
    const bookmarksBtn = document.getElementById('bookmarks-btn');
    if (bookmarksBtn) {
        bookmarksBtn.addEventListener('click', () => {
            window.annotationManager?.showBookmarksView();
        });
    }

    // Fetch server info and restore saved current path from session, then load files
    fetch('/api/server-info')
        .then(response => response.json())
        .then(data => {
            serverRootDir = data.rootDir || '';
            currentPath = data.currentPath || '';
            console.log('Server root directory:', serverRootDir);
            console.log('Restored current path:', currentPath);
            loadFiles(currentPath);
        })
        .catch(err => {
            console.warn('Failed to fetch server info, starting at root:', err);
            loadFiles(currentPath);
        });
    
    // Quick annotation function for keyboard shortcuts
    function quickAnnotate(file, type, value) {
        const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
        
        if (type === 'comment') {
            // Show comment dialog
            if (window.showAnnotationDialog) {
                window.showAnnotationDialog(filePath, file.name);
            }
            return;
        }
        
        // For color and stars, update annotation directly
        const existingAnnotation = window.annotationsCache?.[filePath] || {};
        const annotation = {
            comment: existingAnnotation.comment || '',
            color: type === 'color' ? value : existingAnnotation.color,
            stars: type === 'stars' ? value : existingAnnotation.stars
        };
        
        // Save annotation
        fetch('/api/annotations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                filePath: filePath,
                ...annotation
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Update cache
                if (!window.annotationsCache) window.annotationsCache = {};
                window.annotationsCache[filePath] = annotation;
                
                // Refresh display
                displayFiles(currentFiles, currentPath);
                
                // Show feedback
                showQuickAnnotationFeedback(type, value);
            }
        })
        .catch(error => {
            console.error('Error saving annotation:', error);
            showQuickAnnotationFeedback('error', 'Failed to save');
        });
    }
    
    // Show visual feedback for quick annotations
    function showQuickAnnotationFeedback(type, value) {
        const feedback = document.createElement('div');
        feedback.className = 'quick-annotation-feedback';
        
        let message = '';
        if (type === 'color') {
            const colorNames = {
                '#f44336': 'Red',
                '#4caf50': 'Green', 
                '#ffeb3b': 'Yellow',
                '#2196f3': 'Blue'
            };
            message = `Color: ${colorNames[value]}`;
            feedback.style.backgroundColor = value;
        } else if (type === 'stars') {
            message = `Rating: ${'⭐'.repeat(value)}`;
        } else if (type === 'error') {
            message = value;
            feedback.style.backgroundColor = '#f44336';
        }
        
        feedback.textContent = message;
        feedback.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 10px 15px;
            border-radius: 5px;
            color: white;
            font-weight: bold;
            z-index: 1000;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;
        
        document.body.appendChild(feedback);
        
        // Animate in
        setTimeout(() => feedback.style.opacity = '1', 10);
        
        // Remove after 2 seconds
        setTimeout(() => {
            feedback.style.opacity = '0';
            setTimeout(() => feedback.remove(), 300);
        }, 2000);
    }

    // Auto-display folder contents based on primary content type
    function autoDisplayFolderContents(files, currentPath) {
        if (!files || files.length === 0) return;
        
        // Count different file types
        const imageFiles = files.filter(file => !file.isDirectory && 
            ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(file.name.split('.').pop().toLowerCase()));
        const videoFiles = files.filter(file => !file.isDirectory && 
            ['mp4', 'avi', 'mov', 'mkv', 'webm', 'mpg', 'mpeg', 'wmv'].includes(file.name.split('.').pop().toLowerCase()));
        const pdfFiles = files.filter(file => !file.isDirectory && 
            file.name.split('.').pop().toLowerCase() === 'pdf');
        const comicFiles = files.filter(file => !file.isDirectory && 
            ['cbz', 'cbr'].includes(file.name.split('.').pop().toLowerCase()));
        
        let primaryContent = null;
        
        // Determine primary content type (prioritize images for pair viewing)
        if (imageFiles.length > 1) {
            primaryContent = { type: 'images', files: imageFiles };
        } else if (videoFiles.length > 0) {
            primaryContent = { type: 'video', files: videoFiles };
        } else if (pdfFiles.length > 0) {
            primaryContent = { type: 'pdf', files: pdfFiles };
        } else if (comicFiles.length > 0) {
            primaryContent = { type: 'comic', files: comicFiles };
        } else if (imageFiles.length === 1) {
            primaryContent = { type: 'image', files: imageFiles };
        }
        
        // Auto-display the primary content
        if (primaryContent) {
            const firstFile = primaryContent.files[0];
            const filePath = currentPath ? `${currentPath}/${firstFile.name}` : firstFile.name;
            console.log(`Auto-displaying ${primaryContent.type} content:`, firstFile.name);
            showContent(currentPath, firstFile.name);
        }
    }
    
    // Clear the content view
    function clearContentView() {
        contentCode.innerHTML = '';
        contentOther.innerHTML = '';
        contentCode.parentElement.style.display = 'none';
        contentOther.style.display = 'none';
        
        // Stop any media that might be playing
        if (fileRenderer) {
            fileRenderer.stopAllMedia();
        }
    }

    // Expose file explorer state for keyboard navigation
    window.fileExplorer = {
        currentPath: () => currentPath,
        currentFiles: () => currentFiles,
        filteredFiles: () => filteredFiles,
        loadFiles: loadFiles,
        updateDetails: updateDetails,
        selectFile: selectFile,
        showContent: showContent,
        quickAnnotate: quickAnnotate,
        autoDisplayFolderContents: autoDisplayFolderContents,
        clearContentView: clearContentView
    };
}


// Expose initializeApp globally so auth.js can call it
window.initializeApp = initializeApp;
