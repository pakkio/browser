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
        
        // Show loading indicator
        const loadingIndicator = document.getElementById('loading-indicator');
        loadingIndicator.style.display = 'block';
        loadingIndicator.textContent = 'Loading directory...';
        
        // Clear current file list
        fileList.innerHTML = '<li style="color: #666;">Loading...</li>';
        
        window.authManager.authenticatedFetch(`/api/browse?path=${encodeURIComponent(path)}`)
            .then(response => {
                if (!response) {
                    // Authentication failed, handled by authManager
                    return;
                }
                console.log('Response status:', response.status);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (!data) return; // Handle auth failure
                console.log('Received data:', data);
                currentFiles = data.files;
                displayFiles(data.files, path);
                updateCurrentPathDisplay(data.currentPath, data.files.length);
            })
            .catch(error => {
                console.error('Error loading files:', error);
                document.getElementById('current-path-display').textContent = 'Error loading directory';
                fileList.innerHTML = '<li style="color: red;">Error: ' + error.message + '</li>';
            })
            .finally(() => {
                // Hide loading indicator
                loadingIndicator.style.display = 'none';
            });
    }
    
    function displayFiles(data, path) {
        fileList.innerHTML = '';
        
        if (path !== '') {
            const parentLi = document.createElement('li');
            parentLi.textContent = '..';
            parentLi.classList.add('parent-dir');
            parentLi.addEventListener('click', () => {
                currentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
                loadFiles(currentPath);
            });
            fileList.appendChild(parentLi);
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

    function showContent(path, fileName) {
        const filePath = path ? `/${path}/${fileName}` : `/${fileName}`;
        fileRenderer.render(filePath, fileName, contentCode, contentOther);
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
            'cbz': 'Comic Book Archive', 'cbr': 'Comic Book Archive',
            'epub': 'EPUB E-book',
            'ipynb': 'Jupyter Notebook',
            'zip': 'ZIP Archive', 'rar': 'RAR Archive', 'tar': 'TAR Archive',
            'tgz': 'Compressed TAR Archive', '7z': '7-Zip Archive'
        };
        return types[extension] || 'Text File';
    }
    
    function updateCurrentPathDisplay(fullPath, fileCount) {
        const pathDisplay = document.getElementById('current-path-display');
        pathDisplay.textContent = `${fullPath} (${fileCount} items)`;
    }
    
    function selectFile(index, filePath, fileName) {
        const items = document.querySelectorAll('.file-item');
        items.forEach(item => item.classList.remove('selected'));

        if (index >= 0 && index < filteredFiles.length) {
            selectedIndex = index;
            items[index].classList.add('selected');
            // Update details instantly upon navigation
            // Render file instantly upon navigation
            fileRenderer.render(filePath, fileName, contentCode, contentOther);

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
                        showContent(currentPath, file.name);
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
        }
        if (newIndex !== selectedIndex) {
            const file = filteredFiles[newIndex];
            const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
            selectFile(newIndex, filePath, file.name);
            updateDetails(file);
        }
    }
    
    // Event listeners
    document.addEventListener('keydown', handleKeyNavigation);
    
    fileTypeFilter.addEventListener('change', () => {
        // Show brief loading for filtering large directories
        if (currentFiles.length > 100) {
            const loadingIndicator = document.getElementById('loading-indicator');
            loadingIndicator.style.display = 'block';
            loadingIndicator.textContent = 'Filtering files...';
            
            setTimeout(() => {
                displayFiles(currentFiles, currentPath);
                loadingIndicator.style.display = 'none';
            }, 50);
        } else {
            displayFiles(currentFiles, currentPath);
        }
    });

    searchInput.addEventListener('input', () => {
        // Show brief loading for searching in large directories
        if (currentFiles.length > 100) {
            const loadingIndicator = document.getElementById('loading-indicator');
            loadingIndicator.style.display = 'block';
            loadingIndicator.textContent = 'Searching files...';
            
            setTimeout(() => {
                displayFiles(currentFiles, currentPath);
                loadingIndicator.style.display = 'none';
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

    loadFiles(currentPath);
    
    // Expose file explorer state for keyboard navigation
    window.fileExplorer = {
        currentPath: () => currentPath,
        currentFiles: () => currentFiles,
        filteredFiles: () => filteredFiles,
        loadFiles: loadFiles,
        updateDetails: updateDetails
    };
}


// Expose initializeApp globally so auth.js can call it
window.initializeApp = initializeApp;
