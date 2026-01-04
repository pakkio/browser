// Library View Renderer - displays directory contents as a visual book shelf
class LibraryRenderer {
    constructor() {
        this.currentPath = '';
        this.files = [];
        this.annotations = {};
        this.colors = [
            { name: 'blue', hex: '#2196f3', label: 'Blue' },
            { name: 'red', hex: '#f44336', label: 'Red' },
            { name: 'green', hex: '#4caf50', label: 'Green' },
            { name: 'white', hex: '#ffffff', label: 'White' },
            { name: 'black', hex: '#333333', label: 'Black' },
            { name: 'orange', hex: '#ff9800', label: 'Orange' },
            { name: 'purple', hex: '#9c27b0', label: 'Purple' },
            { name: 'yellow', hex: '#ffeb3b', label: 'Yellow' }
        ];
    }

    async render(dirPath, contentOther, options = {}) {
        this.currentPath = dirPath;

        // Fetch library data and annotations in parallel
        const [libraryResponse, annotationsResponse] = await Promise.all([
            window.authManager.authenticatedFetch(`/api/library?path=${encodeURIComponent(dirPath)}`),
            window.authManager.authenticatedFetch(`/api/annotations?path=${encodeURIComponent(dirPath)}&directory=true`)
        ]);

        if (!libraryResponse || !libraryResponse.ok) {
            contentOther.innerHTML = '<div class="library-error">Failed to load library</div>';
            contentOther.style.display = 'block';
            return;
        }

        const data = await libraryResponse.json();
        this.files = data.files;

        // Parse annotations
        this.annotations = {};
        if (annotationsResponse && annotationsResponse.ok) {
            try {
                const annotData = await annotationsResponse.json();
                if (annotData.annotations) {
                    // Index annotations by filename
                    for (const [path, annot] of Object.entries(annotData.annotations)) {
                        const fileName = path.split('/').pop();
                        this.annotations[fileName] = annot;
                    }
                }
            } catch (e) {
                console.log('Could not load annotations:', e);
            }
        }

        // Sort by name
        this.files.sort((a, b) => a.name.localeCompare(b.name));

        // Create library container
        const container = document.createElement('div');
        container.className = 'library-container';

        // Header
        const header = document.createElement('div');
        header.className = 'library-header';
        header.innerHTML = `
            <h2 class="library-title">${this.getDirectoryName(dirPath)}</h2>
            <span class="library-count">${this.files.length} items</span>
        `;
        container.appendChild(header);

        // Bookshelf
        const shelf = document.createElement('div');
        shelf.className = 'library-shelf';

        // Find max file size for shadow scaling
        const maxSize = Math.max(...this.files.map(f => f.size), 1);

        for (const file of this.files) {
            const bookItem = this.createBookItem(file, dirPath, maxSize);
            shelf.appendChild(bookItem);
        }

        container.appendChild(shelf);

        // Add tooltip container
        const tooltip = document.createElement('div');
        tooltip.className = 'library-tooltip';
        tooltip.id = 'library-tooltip';
        container.appendChild(tooltip);

        // Add loading indicator
        const loadingBar = document.createElement('div');
        loadingBar.className = 'library-loading';
        loadingBar.id = 'library-loading';
        loadingBar.innerHTML = `
            <div class="library-loading-text">Loading thumbnails... <span id="library-loading-percent">0%</span></div>
            <div class="library-loading-bar">
                <div class="library-loading-fill" id="library-loading-fill"></div>
            </div>
        `;
        container.insertBefore(loadingBar, shelf);

        contentOther.innerHTML = '';
        contentOther.appendChild(container);
        contentOther.style.display = 'block';

        // Load thumbnails with progress tracking
        this.loadThumbnails(shelf, dirPath);
    }

    getDirectoryName(path) {
        if (!path) return 'Root';
        const parts = path.split('/');
        return parts[parts.length - 1] || 'Root';
    }

    createBookItem(file, dirPath, maxSize) {
        const item = document.createElement('div');
        item.className = 'library-book';
        item.dataset.name = file.name;
        item.dataset.path = dirPath ? `${dirPath}/${file.name}` : file.name;

        // Calculate shadow depth based on file size (1-20px)
        const sizeRatio = file.size / maxSize;
        const shadowDepth = Math.max(3, Math.min(20, Math.floor(sizeRatio * 20)));
        const shadowBlur = shadowDepth * 1.5;

        item.style.setProperty('--book-shadow-depth', `${shadowDepth}px`);
        item.style.setProperty('--book-shadow-blur', `${shadowBlur}px`);

        // Create thumbnail container
        const thumbContainer = document.createElement('div');
        thumbContainer.className = 'library-thumb-container';

        const thumbnail = document.createElement('div');
        thumbnail.className = `library-thumbnail library-thumb-${file.thumbnailType}`;
        thumbnail.dataset.type = file.thumbnailType;
        thumbnail.dataset.file = file.name;

        // Placeholder icon based on type
        const icon = this.getTypeIcon(file.thumbnailType, file.extension);
        thumbnail.innerHTML = `<span class="library-placeholder-icon">${icon}</span>`;

        thumbContainer.appendChild(thumbnail);

        // Add annotation badges overlay
        const annotation = this.annotations[file.name];
        if (annotation) {
            const badges = this.createAnnotationBadges(annotation);
            thumbContainer.appendChild(badges);
        }

        item.appendChild(thumbContainer);

        // File info
        const info = document.createElement('div');
        info.className = 'library-info';
        info.innerHTML = `
            <span class="library-name">${this.truncateName(file.name)}</span>
            <span class="library-size">${this.formatSize(file.size)}</span>
        `;
        item.appendChild(info);

        // Hover handlers for tooltip
        item.addEventListener('mouseenter', (e) => this.showTooltip(e, file, annotation));
        item.addEventListener('mousemove', (e) => this.moveTooltip(e));
        item.addEventListener('mouseleave', () => this.hideTooltip());

        // Click handler - select and open in new tab
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const filePath = dirPath ? `${dirPath}/${file.name}` : file.name;

            // Remove selection from other items
            const container = item.closest('.library-shelf');
            if (container) {
                container.querySelectorAll('.library-book.selected').forEach(el => {
                    el.classList.remove('selected');
                });
            }

            // Select this item
            item.classList.add('selected');

            // Open in new tab
            this.openInNewTab(filePath, file.name);
        });

        return item;
    }

    createAnnotationBadges(annotation) {
        const badges = document.createElement('div');
        badges.className = 'library-badges';

        // Color indicator
        if (annotation.color) {
            const colorInfo = this.colors.find(c => c.name === annotation.color);
            if (colorInfo) {
                const colorBadge = document.createElement('span');
                colorBadge.className = 'library-badge library-badge-color';
                colorBadge.style.backgroundColor = colorInfo.hex;
                badges.appendChild(colorBadge);
            }
        }

        // Stars indicator
        if (annotation.stars) {
            const starsBadge = document.createElement('span');
            starsBadge.className = 'library-badge library-badge-stars';
            starsBadge.textContent = '★'.repeat(annotation.stars);
            badges.appendChild(starsBadge);
        }

        // Comment indicator
        if (annotation.comment) {
            const commentBadge = document.createElement('span');
            commentBadge.className = 'library-badge library-badge-comment';
            commentBadge.textContent = '💬';
            badges.appendChild(commentBadge);
        }

        // Bookmark indicator
        if (annotation.bookmark || annotation.bookmarks) {
            const bookmarkBadge = document.createElement('span');
            bookmarkBadge.className = 'library-badge library-badge-bookmark';
            bookmarkBadge.textContent = '🔖';
            badges.appendChild(bookmarkBadge);
        }

        return badges;
    }

    showTooltip(e, file, annotation) {
        const tooltip = document.getElementById('library-tooltip');
        if (!tooltip) return;

        let html = `<div class="tooltip-filename">${file.name}</div>`;
        html += `<div class="tooltip-size">${this.formatSize(file.size)}</div>`;

        if (annotation) {
            html += '<div class="tooltip-annotations">';

            if (annotation.stars) {
                html += `<div class="tooltip-stars">${'⭐'.repeat(annotation.stars)} (${annotation.stars}/5)</div>`;
            }

            if (annotation.color) {
                const colorInfo = this.colors.find(c => c.name === annotation.color);
                if (colorInfo) {
                    html += `<div class="tooltip-color">
                        <span class="tooltip-color-dot" style="background:${colorInfo.hex}"></span>
                        ${colorInfo.label}
                    </div>`;
                }
            }

            if (annotation.comment) {
                html += `<div class="tooltip-comment">💬 ${annotation.comment}</div>`;
            }

            if (annotation.bookmark || annotation.bookmarks) {
                const bookmarkInfo = annotation.bookmark || (annotation.bookmarks && annotation.bookmarks[0]);
                if (bookmarkInfo) {
                    html += `<div class="tooltip-bookmark">🔖 Bookmarked${bookmarkInfo.name ? ': ' + bookmarkInfo.name : ''}</div>`;
                }
            }

            html += '</div>';
        }

        tooltip.innerHTML = html;
        tooltip.style.display = 'block';
        this.moveTooltip(e);
    }

    moveTooltip(e) {
        const tooltip = document.getElementById('library-tooltip');
        if (!tooltip) return;

        const rect = tooltip.getBoundingClientRect();
        let x = e.clientX + 15;
        let y = e.clientY + 15;

        // Keep tooltip on screen
        if (x + rect.width > window.innerWidth) {
            x = e.clientX - rect.width - 15;
        }
        if (y + rect.height > window.innerHeight) {
            y = e.clientY - rect.height - 15;
        }

        tooltip.style.left = x + 'px';
        tooltip.style.top = y + 'px';
    }

    hideTooltip() {
        const tooltip = document.getElementById('library-tooltip');
        if (tooltip) {
            tooltip.style.display = 'none';
        }
    }

    getTypeIcon(type, extension) {
        const icons = {
            'video': '🎬',
            'image': '🖼️',
            'pdf': '📄',
            'comic': '📚',
            'epub': '📖',
            'generic': '📁'
        };
        return icons[type] || icons.generic;
    }

    truncateName(name) {
        if (name.length > 25) {
            const ext = name.includes('.') ? name.split('.').pop() : '';
            const baseName = name.substring(0, name.length - ext.length - 1);
            return baseName.substring(0, 20) + '...' + (ext ? '.' + ext : '');
        }
        return name;
    }

    formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    async loadThumbnails(shelf, dirPath) {
        const items = shelf.querySelectorAll('.library-thumbnail');
        const total = items.length;
        let loaded = 0;

        const updateProgress = () => {
            const percent = total > 0 ? Math.round((loaded / total) * 100) : 100;
            const percentEl = document.getElementById('library-loading-percent');
            const fillEl = document.getElementById('library-loading-fill');
            const loadingEl = document.getElementById('library-loading');

            if (percentEl) percentEl.textContent = `${percent}%`;
            if (fillEl) fillEl.style.width = `${percent}%`;

            // Hide loading bar when complete
            if (percent >= 100 && loadingEl) {
                setTimeout(() => {
                    loadingEl.classList.add('complete');
                    setTimeout(() => {
                        loadingEl.style.display = 'none';
                    }, 300);
                }, 200);
            }
        };

        // Show initial state
        updateProgress();

        for (const item of items) {
            const type = item.dataset.type;
            const fileName = item.dataset.file;
            const filePath = dirPath ? `${dirPath}/${fileName}` : fileName;

            try {
                let thumbnailUrl = null;

                if (type === 'video') {
                    thumbnailUrl = `/video-thumbnail?path=${encodeURIComponent(filePath)}&position=0.5`;
                } else if (type === 'image') {
                    thumbnailUrl = `/files?path=${encodeURIComponent(filePath)}`;
                } else if (type === 'pdf') {
                    thumbnailUrl = `/pdf-preview?path=${encodeURIComponent(filePath)}&page=1`;
                } else if (type === 'comic') {
                    thumbnailUrl = `/comic-preview?path=${encodeURIComponent(filePath)}&index=0`;
                } else if (type === 'epub') {
                    thumbnailUrl = `/epub-cover?path=${encodeURIComponent(filePath)}`;
                }

                if (thumbnailUrl) {
                    const img = document.createElement('img');
                    img.className = 'library-thumb-img';
                    img.loading = 'lazy';
                    img.onerror = () => {
                        img.style.display = 'none';
                        item.querySelector('.library-placeholder-icon').style.display = 'flex';
                        loaded++;
                        updateProgress();
                    };
                    img.onload = () => {
                        item.querySelector('.library-placeholder-icon').style.display = 'none';
                        loaded++;
                        updateProgress();
                    };
                    img.src = thumbnailUrl;
                    item.insertBefore(img, item.firstChild);
                } else {
                    // No thumbnail URL, count as loaded
                    loaded++;
                    updateProgress();
                }
            } catch (e) {
                console.log('Thumbnail load error for', fileName, e);
                loaded++;
                updateProgress();
            }
        }
    }

    openInNewTab(filePath, fileName) {
        // Open file in a new browser tab with the app (using hash to auto-load)
        const url = `/?file=${encodeURIComponent(filePath)}`;
        window.open(url, '_blank');
    }
}

// Create global instance
window.libraryRenderer = new LibraryRenderer();
