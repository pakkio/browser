class ImagePairRenderer {
    constructor() {
        this.handleKeyDown = null;
        this.isFullscreen = false;
        this.originalParent = null;
        this.fullscreenContainer = null;
        this.currentImageContainer = null;
        this.isTruncatedView = false;
        this.images = [];
        this.currentIndex = 0;
        this.coverMode = true; // Start with cover mode enabled
        this.zoomLevel = 1.0; // Current zoom level
        this.minZoom = 0.25; // Minimum zoom (25%)
        this.maxZoom = 5.0; // Maximum zoom (500%)
        this.zoomStep = 0.25; // Zoom increment
    }

    cleanup() {
        if (this.handleKeyDown) {
            document.removeEventListener('keydown', this.handleKeyDown);
            this.handleKeyDown = null;
        }
        if (this.isFullscreen) {
            this.exitFullscreen();
        }
    }

    async render(filePath, fileName, contentCode, contentOther, options = {}) {
        this.cleanup();
        this.images = options.images || [];
        this.currentIndex = this.images.findIndex(img => img.name === fileName);
        this.currentDirectory = filePath.substring(0, filePath.lastIndexOf('/'));

        contentOther.innerHTML = '';
        const imagePairContainer = document.createElement('div');
        imagePairContainer.className = 'image-pair-container';
        imagePairContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            position: relative;
        `;
        this.currentImageContainer = imagePairContainer;

        const controls = this.createControls();
        imagePairContainer.appendChild(controls);

        const pagesContainer = document.createElement('div');
        pagesContainer.className = 'image-pages-container';
        pagesContainer.style.cssText = `
            display: flex;
            gap: 10px;
            flex: 1;
            align-items: center;
            justify-content: center;
            width: 100%;
            transition: opacity 0.3s ease;
            opacity: 1;
        `;
        imagePairContainer.appendChild(pagesContainer);

        contentOther.appendChild(imagePairContainer);
        contentOther.style.display = 'block';

        this.loadPage(this.currentIndex);
        this.setupKeyboardNavigation();
    }

    createControls() {
        const controls = document.createElement('div');
        controls.className = 'image-controls';
        controls.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 10px;
            background: rgba(0, 0, 0, 0.6);
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            z-index: 10;
            opacity: 0;
            transition: opacity 0.3s ease-in-out;
        `;

        this.currentImageContainer.addEventListener('mouseenter', () => controls.style.opacity = '1');
        this.currentImageContainer.addEventListener('mouseleave', () => controls.style.opacity = '0');

        controls.innerHTML = `
            <button id="image-prev">Previous</button>
            <span id="image-page-info" style="margin: 0 10px; color: white;"></span>
            <button id="image-next">Next</button>
            <button id="image-cover-mode" style="margin-left: 20px;">Cover Mode: ON</button>
            <button id="image-zoom-out" style="margin-left: 20px;">-</button>
            <span id="image-zoom-level" style="margin: 0 5px; color: white; min-width: 60px; text-align: center; display: inline-block;">100%</span>
            <button id="image-zoom-in">+</button>
            <button id="image-zoom-reset" style="margin-left: 10px;">Reset</button>
            <button id="image-fullscreen" style="margin-left: 20px;">Fullscreen</button>
        `;

        controls.querySelector('#image-prev').addEventListener('click', () => this.previousPage());
        controls.querySelector('#image-next').addEventListener('click', () => this.nextPage());
        controls.querySelector('#image-cover-mode').addEventListener('click', (e) => this.toggleCoverMode(e.target));
        controls.querySelector('#image-zoom-out').addEventListener('click', () => this.zoomOut());
        controls.querySelector('#image-zoom-in').addEventListener('click', () => this.zoomIn());
        controls.querySelector('#image-zoom-reset').addEventListener('click', () => this.resetZoom());
        controls.querySelector('#image-fullscreen').addEventListener('click', () => this.toggleFullscreen());

        return controls;
    }

    async loadPage(index) {
        this.currentIndex = index;
        const pagesContainer = this.currentImageContainer.querySelector('.image-pages-container');
        
        // Show loading state
        pagesContainer.style.opacity = '0.3';
        
        const leftIndex = this.getLeftPageIndex(index);
        const rightIndex = this.getRightPageIndex(index);

        // Preload images before showing them
        const imagesToLoad = [];
        if (leftIndex !== -1) {
            imagesToLoad.push(this.images[leftIndex]);
        }
        if (rightIndex !== -1) {
            imagesToLoad.push(this.images[rightIndex]);
        }

        try {
            // Wait for all images to preload
            const preloadedImages = await Promise.all(
                imagesToLoad.map(imageData => this.preloadImage(imageData))
            );

            // Clear container and add preloaded images
            pagesContainer.innerHTML = '';
            preloadedImages.forEach(img => {
                pagesContainer.appendChild(img);
            });

            // Update styles now that we know how many images we have
            const isSingleImage = preloadedImages.length === 1;
            preloadedImages.forEach(img => {
                this.updateImageStyles(img, isSingleImage);
            });

            // Smooth fade-in
            pagesContainer.style.opacity = '1';
            
        } catch (error) {
            console.warn('Error preloading images:', error);
            // Fallback to immediate loading
            pagesContainer.innerHTML = '';
            const fallbackImages = [];
            if (leftIndex !== -1) {
                const leftImg = this.createImage(this.images[leftIndex]);
                pagesContainer.appendChild(leftImg);
                fallbackImages.push(leftImg);
            }
            if (rightIndex !== -1) {
                const rightImg = this.createImage(this.images[rightIndex]);
                pagesContainer.appendChild(rightImg);
                fallbackImages.push(rightImg);
            }
            
            // Update styles for fallback images
            const isSingleImage = fallbackImages.length === 1;
            fallbackImages.forEach(img => {
                this.updateImageStyles(img, isSingleImage);
            });
            
            pagesContainer.style.opacity = '1';
        }

        this.updatePageInfo();
        this.updateZoomDisplay();
        
        // Preload adjacent images in background for smoother navigation
        this.preloadAdjacentImages(index);
    }

    getLeftPageIndex(index) {
        if (this.coverMode) {
            if (index === 0) return 0;
            return index % 2 === 1 ? index : index - 1;
        }
        return index;
    }

    getRightPageIndex(index) {
        if (this.coverMode) {
            if (index === 0 || index >= this.images.length -1) return -1;
            return index % 2 === 1 ? index + 1 : index;
        }
        return index + 1 < this.images.length ? index + 1 : -1;
    }

    createImage(imageData) {
        const img = document.createElement('img');
        const imagePath = this.currentDirectory ? `${this.currentDirectory}/${imageData.name}` : imageData.name;
        img.src = `/files?path=${encodeURIComponent(imagePath)}`;
        
        // Set initial styles based on fullscreen state
        this.updateImageStyles(img, false);
        
        return img;
    }

    preloadImage(imageData) {
        return new Promise((resolve, reject) => {
            const img = document.createElement('img');
            const imagePath = this.currentDirectory ? `${this.currentDirectory}/${imageData.name}` : imageData.name;
            
            img.onload = () => {
                // Set styles after loading - we'll update this properly when adding to DOM
                this.updateImageStyles(img, false);
                resolve(img);
            };
            
            img.onerror = () => {
                reject(new Error(`Failed to load image: ${imageData.name}`));
            };
            
            // Start loading
            img.src = `/files?path=${encodeURIComponent(imagePath)}`;
        });
    }

    preloadAdjacentImages(currentIndex) {
        // Preload next and previous images silently in background
        const preloadIndices = [];
        
        if (this.coverMode) {
            // Preload next pair
            if (currentIndex < this.images.length - 2) {
                const nextIndex = currentIndex % 2 === 1 ? currentIndex + 2 : currentIndex + 1;
                preloadIndices.push(this.getLeftPageIndex(nextIndex), this.getRightPageIndex(nextIndex));
            }
            // Preload previous pair
            if (currentIndex > 0) {
                const prevIndex = currentIndex % 2 === 1 ? currentIndex - 2 : currentIndex - 1;
                preloadIndices.push(this.getLeftPageIndex(prevIndex), this.getRightPageIndex(prevIndex));
            }
        } else {
            // Preload next pair
            if (currentIndex < this.images.length - 2) {
                preloadIndices.push(currentIndex + 2, currentIndex + 3);
            }
            // Preload previous pair
            if (currentIndex > 1) {
                preloadIndices.push(currentIndex - 2, currentIndex - 3);
            }
        }
        
        // Filter valid indices and preload in background
        preloadIndices
            .filter(idx => idx >= 0 && idx < this.images.length)
            .forEach(idx => {
                if (this.images[idx]) {
                    // Silent preload - don't wait for result
                    this.preloadImage(this.images[idx]).catch(() => {
                        // Ignore preload errors
                    });
                }
            });
    }

    updateImageStyles(img, isSingleImage = false) {
        if (this.isFullscreen) {
            // In fullscreen, use much larger base sizes and different approach
            const scaledWidth = Math.min(95 * this.zoomLevel, 300); // Allow up to 300% width in fullscreen
            const scaledHeight = Math.min(95 * this.zoomLevel, 300); // Allow up to 300% height in fullscreen
            
            img.style.cssText = `
                max-width: ${scaledWidth}%;
                max-height: ${scaledHeight}%;
                width: auto;
                height: auto;
                object-fit: contain;
                transition: all 0.3s ease;
                cursor: ${this.zoomLevel > 1 ? 'move' : 'zoom-in'};
            `;
        } else {
            // In windowed mode, adjust width based on single vs pair
            const baseWidth = isSingleImage ? 70 : 48; // Larger if single image
            const scaledWidth = baseWidth * this.zoomLevel;
            const scaledHeight = 100 * this.zoomLevel;
            
            img.style.cssText = `
                max-width: ${scaledWidth}%;
                max-height: ${scaledHeight}%;
                object-fit: contain;
                transition: all 0.3s ease;
                cursor: ${this.zoomLevel > 1 ? 'move' : 'zoom-in'};
            `;
        }
    }

    updateAllImageStyles() {
        const images = this.currentImageContainer.querySelectorAll('img');
        const isSingleImage = images.length === 1;
        images.forEach(img => this.updateImageStyles(img, isSingleImage));
        this.updateZoomDisplay();
    }

    updatePageInfo() {
        const pageInfo = this.currentImageContainer.querySelector('#image-page-info');
        const leftIndex = this.getLeftPageIndex(this.currentIndex);
        const rightIndex = this.getRightPageIndex(this.currentIndex);

        let info = `Image ${leftIndex + 1}`;
        if (rightIndex !== -1) {
            info += ` & ${rightIndex + 1}`;
        }
        info += ` of ${this.images.length}`;
        pageInfo.textContent = info;
    }

    async previousPage() {
        let newIndex = this.currentIndex;
        if (this.coverMode) {
            if (this.currentIndex > 0) {
                newIndex = this.currentIndex % 2 === 1 ? this.currentIndex - 2 : this.currentIndex - 1;
            }
        } else {
            newIndex = this.currentIndex - 2;
        }
        if (newIndex < 0) newIndex = 0;
        await this.loadPage(newIndex);
    }

    async nextPage() {
        let newIndex = this.currentIndex;
        if (this.coverMode) {
            if (this.currentIndex < this.images.length - 1) {
                 newIndex = this.currentIndex % 2 === 1 ? this.currentIndex + 2 : this.currentIndex + 1;
            }
        } else {
            newIndex = this.currentIndex + 2;
        }
        if (newIndex >= this.images.length) newIndex = this.images.length -1;
        await this.loadPage(newIndex);
    }

    async toggleCoverMode(button) {
        this.coverMode = !this.coverMode;
        button.textContent = `Cover Mode: ${this.coverMode ? 'ON' : 'OFF'}`;
        await this.loadPage(this.currentIndex);
    }

    zoomIn() {
        if (this.zoomLevel < this.maxZoom) {
            this.zoomLevel += this.zoomStep;
            this.updateAllImageStyles();
        }
    }

    zoomOut() {
        if (this.zoomLevel > this.minZoom) {
            this.zoomLevel -= this.zoomStep;
            this.updateAllImageStyles();
        }
    }

    resetZoom() {
        this.zoomLevel = 1.0;
        this.updateAllImageStyles();
    }

    updateZoomDisplay() {
        const zoomDisplay = this.currentImageContainer.querySelector('#image-zoom-level');
        if (zoomDisplay) {
            zoomDisplay.textContent = `${Math.round(this.zoomLevel * 100)}%`;
        }
    }

    setupKeyboardNavigation() {
        this.handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT') return;
            switch (e.key) {
                case 'ArrowLeft':
                    e.preventDefault();
                    this.previousPage();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.nextPage();
                    break;
                case 'f':
                    e.preventDefault();
                    this.toggleFullscreen();
                    break;
                case 'Escape':
                    e.preventDefault();
                    if (this.isFullscreen) {
                        this.exitFullscreen();
                    }
                    break;
                case '+':
                case '=':
                    e.preventDefault();
                    this.zoomIn();
                    break;
                case '-':
                case '_':
                    e.preventDefault();
                    this.zoomOut();
                    break;
                case '0':
                    e.preventDefault();
                    this.resetZoom();
                    break;
            }
        };
        document.addEventListener('keydown', this.handleKeyDown);
    }

    toggleFullscreen() {
        if (this.isFullscreen) {
            this.exitFullscreen();
        } else {
            this.enterFullscreen();
        }
    }

    enterFullscreen() {
        if (this.isFullscreen) return;
        this.originalParent = this.currentImageContainer.parentNode;
        this.fullscreenContainer = document.createElement('div');
        this.fullscreenContainer.className = 'image-fullscreen-overlay';
        this.fullscreenContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: #000;
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            margin: 0;
        `;
        this.fullscreenContainer.appendChild(this.currentImageContainer);
        document.body.appendChild(this.fullscreenContainer);
        this.isFullscreen = true;
        
        // Update container styles for fullscreen
        this.currentImageContainer.style.width = '100%';
        this.currentImageContainer.style.height = '100%';
        
        // Update image styles for fullscreen mode
        this.updateAllImageStyles();
    }

    exitFullscreen() {
        if (!this.isFullscreen) return;
        this.originalParent.appendChild(this.currentImageContainer);
        document.body.removeChild(this.fullscreenContainer);
        this.isFullscreen = false;
        
        // Restore container styles for windowed mode
        this.currentImageContainer.style.width = '';
        this.currentImageContainer.style.height = '';
        
        // Update image styles for windowed mode
        this.updateAllImageStyles();
    }
}
