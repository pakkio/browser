class AnnotationManager {
    constructor() {
        this.annotations = {};
        this.colors = [
            { name: 'red', hex: '#f44336', label: 'Red' },
            { name: 'orange', hex: '#ff9800', label: 'Orange' },
            { name: 'yellow', hex: '#ffeb3b', label: 'Yellow' },
            { name: 'green', hex: '#4caf50', label: 'Green' },
            { name: 'blue', hex: '#2196f3', label: 'Blue' },
            { name: 'purple', hex: '#9c27b0', label: 'Purple' },
            { name: 'pink', hex: '#e91e63', label: 'Pink' },
            { name: 'teal', hex: '#009688', label: 'Teal' }
        ];
        this.loadAnnotations();
    }

    getFileTypeFromExtension(extension, fileName = '') {
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

    async loadAnnotations() {
        try {
            // Use direct fetch if authManager is not available or auth is disabled
            const fetchFn = window.authManager?.authenticatedFetch || fetch;
            const response = await fetchFn('/api/annotations');
            if (response && response.ok) {
                this.annotations = await response.json();
                this.updateFileListDisplay();
            }
        } catch (error) {
            console.error('Failed to load annotations:', error);
        }
    }

    async saveAnnotation(filePath, annotation) {
        try {
            console.log('saveAnnotation called with:', { filePath, annotation });
            
            // Use direct fetch if authManager is not available or auth is disabled
            const fetchFn = window.authManager?.authenticatedFetch || fetch;
            
            const response = await fetchFn('/api/annotations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    filePath,
                    ...annotation
                })
            });

            console.log('Response received:', response);

            if (response && response.ok) {
                const result = await response.json();
                console.log('Response JSON:', result);
                
                if (result.success) {
                    if (result.annotation && Object.keys(result.annotation).length > 0) {
                        this.annotations[filePath] = result.annotation;
                    } else {
                        delete this.annotations[filePath];
                    }
                    this.updateFileListDisplay();
                    return true;
                }
            } else {
                console.error('Response not ok:', response.status, response.statusText);
            }
            return false;
        } catch (error) {
            console.error('Failed to save annotation:', error);
            return false;
        }
    }

    async deleteAnnotation(filePath) {
        try {
            // Use direct fetch if authManager is not available or auth is disabled
            const fetchFn = window.authManager?.authenticatedFetch || fetch;
            const response = await fetchFn(`/api/annotations?path=${encodeURIComponent(filePath)}`, {
                method: 'DELETE'
            });

            if (response && response.ok) {
                delete this.annotations[filePath];
                this.updateFileListDisplay();
                return true;
            }
            return false;
        } catch (error) {
            console.error('Failed to delete annotation:', error);
            return false;
        }
    }

    getAnnotation(filePath) {
        return this.annotations[filePath] || {};
    }

    updateFileListDisplay() {
        const fileItems = document.querySelectorAll('.file-item');
        fileItems.forEach((item, index) => {
            const fileName = item.querySelector('.file-name');
            if (!fileName) return;

            const filePath = this.getFilePathFromItem(item, index);
            const annotation = this.getAnnotation(filePath);

            // Remove existing annotations display
            const existingAnnotations = item.querySelector('.file-annotations');
            if (existingAnnotations) {
                existingAnnotations.remove();
            }

            // Add new annotations display
            if (Object.keys(annotation).length > 0) {
                const annotationsDiv = document.createElement('div');
                annotationsDiv.className = 'file-annotations';
                annotationsDiv.style.cssText = `
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    margin-left: 8px;
                `;

                // Color indicator
                if (annotation.color) {
                    const colorInfo = this.colors.find(c => c.name === annotation.color);
                    if (colorInfo) {
                        const colorDot = document.createElement('span');
                        colorDot.className = 'color-indicator';
                        colorDot.style.cssText = `
                            width: 8px;
                            height: 8px;
                            border-radius: 50%;
                            background-color: ${colorInfo.hex};
                            display: inline-block;
                        `;
                        colorDot.title = `Color: ${colorInfo.label}`;
                        annotationsDiv.appendChild(colorDot);
                    }
                }

                // Stars indicator
                if (annotation.stars) {
                    const starsSpan = document.createElement('span');
                    starsSpan.className = 'stars-indicator';
                    starsSpan.textContent = '⭐'.repeat(annotation.stars);
                    starsSpan.style.cssText = `
                        font-size: 10px;
                        line-height: 1;
                    `;
                    starsSpan.title = `Rating: ${annotation.stars}/5 stars`;
                    annotationsDiv.appendChild(starsSpan);
                }

                // Comment indicator
                if (annotation.comment) {
                    const commentIcon = document.createElement('span');
                    commentIcon.className = 'comment-indicator';
                    commentIcon.textContent = '💬';
                    commentIcon.style.cssText = `
                        font-size: 10px;
                        line-height: 1;
                    `;
                    commentIcon.title = `Comment: ${annotation.comment.substring(0, 50)}${annotation.comment.length > 50 ? '...' : ''}`;
                    annotationsDiv.appendChild(commentIcon);
                }

                item.appendChild(annotationsDiv);
            }
        });
    }

    getFilePathFromItem(item, index) {
        if (window.fileExplorer && window.fileExplorer.filteredFiles) {
            const files = window.fileExplorer.filteredFiles();
            const currentPath = window.fileExplorer.currentPath();
            if (files[index]) {
                return currentPath ? `${currentPath}/${files[index].name}` : files[index].name;
            }
        }
        return '';
    }

    showAnnotationDialog(filePath, fileName) {
        const annotation = this.getAnnotation(filePath);
        
        // Create modal backdrop
        const backdrop = document.createElement('div');
        backdrop.className = 'annotation-modal-backdrop';
        backdrop.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'annotation-modal';
        modal.style.cssText = `
            background: #2a2a2a;
            border: 1px solid #444444;
            border-radius: 8px;
            padding: 20px;
            max-width: 500px;
            width: 90%;
            color: #d4d4d4;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        `;

        modal.innerHTML = `
            <div class="annotation-header" style="margin-bottom: 20px;">
                <h3 style="margin: 0; color: #00aacc; font-size: 1.2rem;">Annotate File</h3>
                <p style="margin: 5px 0 0 0; color: #888888; font-size: 0.9rem; word-break: break-all;">${fileName}</p>
            </div>
            
            <div class="annotation-content">
                <!-- Comment Section -->
                <div class="annotation-section" style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; color: #00aacc; font-weight: 500;">💬 Comment:</label>
                    <textarea id="annotation-comment" placeholder="Add your comment here..."
                        style="width: 100%; height: 80px; background: #333333; border: 1px solid #555555; 
                               border-radius: 4px; color: #d4d4d4; padding: 8px; resize: vertical; 
                               font-family: inherit; font-size: 0.9rem;">${annotation.comment || ''}</textarea>
                </div>

                <!-- Stars Section -->
                <div class="annotation-section" style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; color: #00aacc; font-weight: 500;">⭐ Rating:</label>
                    <div class="stars-input" style="display: flex; gap: 5px; align-items: center;">
                        ${[1, 2, 3, 4, 5].map(i => `
                            <span class="star" data-value="${i}" 
                                style="font-size: 20px; cursor: pointer; color: ${(annotation.stars >= i) ? '#ffeb3b' : '#666666'}; 
                                       transition: color 0.2s;">⭐</span>
                        `).join('')}
                        <button type="button" id="clear-stars" style="margin-left: 10px; background: #444444; border: 1px solid #666666; 
                                color: #d4d4d4; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;">Clear</button>
                    </div>
                </div>

                <!-- Color Section -->
                <div class="annotation-section" style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; color: #00aacc; font-weight: 500;">🎨 Color Label:</label>
                    <div class="colors-input" style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
                        ${this.colors.map(color => `
                            <div class="color-option" data-color="${color.name}" 
                                style="width: 24px; height: 24px; border-radius: 50%; background-color: ${color.hex}; 
                                       cursor: pointer; border: 2px solid ${(annotation.color === color.name) ? '#ffffff' : 'transparent'}; 
                                       transition: all 0.2s;" title="${color.label}"></div>
                        `).join('')}
                        <button type="button" id="clear-color" style="background: #444444; border: 1px solid #666666; 
                                color: #d4d4d4; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;">Clear</button>
                    </div>
                </div>
            </div>

            <div class="annotation-actions" style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
                <button type="button" id="delete-annotation" style="background: #f44336; border: 1px solid #d32f2f; 
                        color: white; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Delete All</button>
                <button type="button" id="cancel-annotation" style="background: #444444; border: 1px solid #666666; 
                        color: #d4d4d4; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Cancel</button>
                <button type="button" id="save-annotation" style="background: #4caf50; border: 1px solid #388e3c; 
                        color: white; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Save</button>
            </div>
        `;

        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        // Helper function to safely remove modal
        const closeModal = () => {
            if (backdrop && backdrop.parentNode) {
                backdrop.parentNode.removeChild(backdrop);
            }
        };

        // Add event listeners
        let currentStars = annotation.stars || 0;
        let currentColor = annotation.color || '';

        // Star rating
        modal.querySelectorAll('.star').forEach(star => {
            star.addEventListener('click', () => {
                currentStars = parseInt(star.dataset.value);
                modal.querySelectorAll('.star').forEach((s, i) => {
                    s.style.color = (i < currentStars) ? '#ffeb3b' : '#666666';
                });
            });
        });

        modal.querySelector('#clear-stars').addEventListener('click', () => {
            currentStars = 0;
            modal.querySelectorAll('.star').forEach(s => {
                s.style.color = '#666666';
            });
        });

        // Color selection
        modal.querySelectorAll('.color-option').forEach(colorEl => {
            colorEl.addEventListener('click', () => {
                modal.querySelectorAll('.color-option').forEach(c => {
                    c.style.border = '2px solid transparent';
                });
                colorEl.style.border = '2px solid #ffffff';
                currentColor = colorEl.dataset.color;
            });
        });

        modal.querySelector('#clear-color').addEventListener('click', () => {
            modal.querySelectorAll('.color-option').forEach(c => {
                c.style.border = '2px solid transparent';
            });
            currentColor = '';
        });

        // Action buttons
        const cancelBtn = modal.querySelector('#cancel-annotation');
        const deleteBtn = modal.querySelector('#delete-annotation');
        const saveBtn = modal.querySelector('#save-annotation');

        if (cancelBtn) {
            cancelBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('Cancel clicked');
                closeModal();
            });
        }

        if (deleteBtn) {
            deleteBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                console.log('Delete clicked');
                if (confirm('Delete all annotations for this file?')) {
                    try {
                        await this.deleteAnnotation(filePath);
                        closeModal();
                    } catch (error) {
                        console.error('Delete error:', error);
                        alert('Failed to delete annotation. Please try again.');
                    }
                }
            });
        }

        if (saveBtn) {
            saveBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                console.log('Save clicked');
                
                try {
                    const commentInput = modal.querySelector('#annotation-comment');
                    const comment = commentInput ? commentInput.value : '';
                    
                    console.log('Saving annotation:', {
                        filePath,
                        comment: comment || undefined,
                        stars: currentStars || undefined,
                        color: currentColor || undefined
                    });
                    
                    const success = await this.saveAnnotation(filePath, {
                        comment: comment || undefined,
                        stars: currentStars || undefined,
                        color: currentColor || undefined
                    });

                    if (success) {
                        console.log('Save successful');
                        closeModal();
                    } else {
                        console.error('Save failed');
                        alert('Failed to save annotation. Please try again.');
                    }
                } catch (error) {
                    console.error('Save error:', error);
                    alert('Failed to save annotation: ' + error.message);
                }
            });
        }

        // Close on backdrop click
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                closeModal();
            }
        });

        // Focus on comment input
        setTimeout(() => {
            modal.querySelector('#annotation-comment').focus();
        }, 100);
    }

    async searchAnnotations(query, filters = {}) {
        try {
            const params = new URLSearchParams();
            if (query) params.append('query', query);
            if (filters.hasComment) params.append('hasComment', 'true');
            if (filters.hasStars) params.append('hasStars', 'true');
            if (filters.hasColor) params.append('hasColor', 'true');
            if (filters.color) params.append('color', filters.color);
            if (filters.fileType) params.append('fileType', filters.fileType);

            // Use direct fetch if authManager is not available or auth is disabled
            const fetchFn = window.authManager?.authenticatedFetch || fetch;
            const response = await fetchFn(`/api/search-annotations?${params}`);
            if (response && response.ok) {
                return await response.json();
            }
            return [];
        } catch (error) {
            console.error('Failed to search annotations:', error);
            return [];
        }
    }

    async showBookmarksView() {
        const allAnnotations = await this.searchAnnotations();
        
        // Create modal backdrop
        const backdrop = document.createElement('div');
        backdrop.className = 'bookmarks-modal-backdrop';
        backdrop.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'bookmarks-modal';
        modal.style.cssText = `
            background: #2a2a2a;
            border: 1px solid #444444;
            border-radius: 8px;
            padding: 20px;
            max-width: 800px;
            width: 95%;
            height: 80vh;
            color: #d4d4d4;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            display: flex;
            flex-direction: column;
        `;

        modal.innerHTML = `
            <div class="bookmarks-header" style="margin-bottom: 20px; border-bottom: 1px solid #444444; padding-bottom: 15px;">
                <h3 style="margin: 0; color: #00aacc; font-size: 1.3rem; display: flex; align-items: center; gap: 10px;">
                    📚 Bookmarks (.browser)
                    <span style="font-size: 0.8rem; color: #888888; font-weight: normal;">(${allAnnotations.length} files)</span>
                </h3>
                <div class="bookmarks-search" style="margin-top: 15px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                    <input type="text" id="bookmarks-search" placeholder="Search in comments..." 
                           style="flex: 1; min-width: 200px; background: #333333; border: 1px solid #555555; 
                                  border-radius: 4px; color: #d4d4d4; padding: 6px 10px; font-size: 0.9rem;">
                    <select id="bookmarks-file-type" style="background: #333333; border: 1px solid #555555; 
                            border-radius: 4px; color: #d4d4d4; padding: 6px 10px; font-size: 0.9rem;">
                        <option value="all">All File Types</option>
                        <option value="image">🖼️ Images</option>
                        <option value="video">🎬 Videos</option>
                        <option value="audio">🎵 Audio</option>
                        <option value="pdf">📄 PDF</option>
                        <option value="code">💻 Code</option>
                        <option value="notebook">📓 Notebooks</option>
                        <option value="text">📝 Text Documents</option>
                        <option value="table">📊 Spreadsheets</option>
                        <option value="presentation">📊 Presentations</option>
                        <option value="subtitle">💬 Subtitles</option>
                        <option value="comic">📚 Comics</option>
                        <option value="ebook">📖 E-books</option>
                        <option value="archive">📦 Archives</option>
                    </select>
                    <select id="bookmarks-filter" style="background: #333333; border: 1px solid #555555; 
                            border-radius: 4px; color: #d4d4d4; padding: 6px 10px; font-size: 0.9rem;">
                        <option value="">All Annotations</option>
                        <option value="comment">With Comments</option>
                        <option value="stars">With Stars</option>
                        <option value="color">With Colors</option>
                        ${this.colors.map(c => `<option value="color-${c.name}">Color: ${c.label}</option>`).join('')}
                    </select>
                    <button id="refresh-bookmarks" style="background: #444444; border: 1px solid #666666; 
                            color: #d4d4d4; padding: 6px 12px; border-radius: 4px; cursor: pointer;">🔄 Refresh</button>
                </div>
            </div>
            
            <div class="bookmarks-content" style="flex: 1; overflow-y: auto;">
                <div id="bookmarks-list"></div>
            </div>

            <div class="bookmarks-actions" style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #444444; text-align: right;">
                <button type="button" id="close-bookmarks" style="background: #444444; border: 1px solid #666666; 
                        color: #d4d4d4; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Close</button>
            </div>
        `;

        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        // Render bookmarks list
        const renderBookmarks = (annotations) => {
            const bookmarksList = modal.querySelector('#bookmarks-list');
            
            if (annotations.length === 0) {
                bookmarksList.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: #888888;">
                        <p style="font-size: 1.1rem; margin-bottom: 10px;">📝 No bookmarks yet</p>
                        <p>Start adding comments, stars, or colors to files to create bookmarks!</p>
                    </div>
                `;
                return;
            }

            bookmarksList.innerHTML = annotations.map(annotation => {
                const fileName = annotation.filePath.split('/').pop();
                const directory = annotation.filePath.includes('/') ? 
                    annotation.filePath.substring(0, annotation.filePath.lastIndexOf('/')) : '';
                
                return `
                    <div class="bookmark-item" data-path="${annotation.filePath}" 
                         style="border: 1px solid #444444; border-radius: 6px; padding: 15px; margin-bottom: 12px; 
                                background: #333333; cursor: pointer; transition: all 0.2s;">
                        <div class="bookmark-header" style="display: flex; align-items: flex-start; gap: 12px; margin-bottom: 10px;">
                            <div class="bookmark-indicators" style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                                ${annotation.color ? `<span style="width: 12px; height: 12px; border-radius: 50%; 
                                    background-color: ${this.colors.find(c => c.name === annotation.color)?.hex}; 
                                    display: inline-block;"></span>` : ''}
                                ${annotation.stars ? `<span style="color: #ffeb3b; font-size: 14px;">
                                    ${'⭐'.repeat(annotation.stars)}</span>` : ''}
                                ${annotation.comment ? `<span style="color: #2196f3; font-size: 14px;">💬</span>` : ''}
                            </div>
                            <div class="bookmark-info" style="flex: 1; min-width: 0;">
                                <div class="bookmark-filename" style="font-weight: 500; color: #00aacc; 
                                     margin-bottom: 4px; word-break: break-all;">${fileName}</div>
                                ${directory ? `<div class="bookmark-directory" style="font-size: 0.8rem; 
                                    color: #888888; margin-bottom: 8px;">📁 ${directory}</div>` : ''}
                                ${annotation.comment ? `<div class="bookmark-comment" style="color: #d4d4d4; 
                                    font-size: 0.9rem; line-height: 1.4; background: #2a2a2a; padding: 8px; 
                                    border-radius: 4px; margin-bottom: 8px;">${annotation.comment}</div>` : ''}
                            </div>
                            <div class="bookmark-actions" style="flex-shrink: 0;">
                                <button class="edit-bookmark" data-path="${annotation.filePath}" data-filename="${fileName}"
                                        style="background: transparent; border: 1px solid #555555; color: #d4d4d4; 
                                               padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 12px;">
                                    ✏️ Edit
                                </button>
                            </div>
                        </div>
                        <div class="bookmark-meta" style="font-size: 0.75rem; color: #666666; text-align: right;">
                            Last modified: ${new Date(annotation.lastModified).toLocaleString()}
                        </div>
                    </div>
                `;
            }).join('');

            // Add click handlers for bookmarks
            bookmarksList.querySelectorAll('.bookmark-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (e.target.closest('.bookmark-actions')) return;
                    
                    const filePath = item.dataset.path;
                    this.navigateToFile(filePath);
                    closeModal();
                });
            });

            // Add edit button handlers
            bookmarksList.querySelectorAll('.edit-bookmark').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const filePath = btn.dataset.path;
                    const fileName = btn.dataset.filename;
                    this.showAnnotationDialog(filePath, fileName);
                });
            });
        };

        // Initial render
        renderBookmarks(allAnnotations);

        // Search functionality
        const searchInput = modal.querySelector('#bookmarks-search');
        const fileTypeSelect = modal.querySelector('#bookmarks-file-type');
        const filterSelect = modal.querySelector('#bookmarks-filter');

        const filterBookmarks = async () => {
            const searchQuery = searchInput.value.trim();
            const fileTypeValue = fileTypeSelect.value;
            const filterValue = filterSelect.value;
            
            let filters = {};
            
            if (filterValue === 'comment') filters.hasComment = true;
            else if (filterValue === 'stars') filters.hasStars = true;
            else if (filterValue === 'color') filters.hasColor = true;
            else if (filterValue.startsWith('color-')) {
                filters.color = filterValue.replace('color-', '');
            }
            
            if (fileTypeValue && fileTypeValue !== 'all') {
                filters.fileType = fileTypeValue;
            }
            
            const filteredAnnotations = await this.searchAnnotations(searchQuery || undefined, filters);
            renderBookmarks(filteredAnnotations);
        };

        searchInput.addEventListener('input', filterBookmarks);
        fileTypeSelect.addEventListener('change', filterBookmarks);
        filterSelect.addEventListener('change', filterBookmarks);

        // Refresh button
        modal.querySelector('#refresh-bookmarks').addEventListener('click', async () => {
            await this.loadAnnotations();
            const refreshedAnnotations = await this.searchAnnotations();
            renderBookmarks(refreshedAnnotations);
            searchInput.value = '';
            fileTypeSelect.value = 'all';
            filterSelect.value = '';
        });

        // Close button
        modal.querySelector('#close-bookmarks').addEventListener('click', () => {
            document.body.removeChild(backdrop);
        });

        // Close on backdrop click
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                closeModal();
            }
        });

        // Focus search input
        setTimeout(() => searchInput.focus(), 100);
    }

    navigateToFile(filePath) {
        // Navigate to the directory containing the file and select it
        const directory = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
        const fileName = filePath.split('/').pop();
        
        // Use the existing file explorer to navigate
        if (window.fileExplorer && window.fileExplorer.loadFiles) {
            window.fileExplorer.loadFiles(directory);
            
            // After loading, try to select the file
            setTimeout(() => {
                const fileItems = document.querySelectorAll('.file-item .file-name');
                fileItems.forEach((item, index) => {
                    if (item.textContent === fileName) {
                        if (window.fileExplorer.selectFile) {
                            window.fileExplorer.selectFile(index, filePath, fileName);
                        }
                    }
                });
            }, 500);
        }
    }
}

// Initialize global annotation manager
window.annotationManager = new AnnotationManager();