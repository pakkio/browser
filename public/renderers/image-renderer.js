class ImageRenderer {
    constructor() {
        this.handleKeyDown = null;
        this.isFullscreen = false;
        this.originalParent = null;
        this.fullscreenContainer = null;
        this.currentImageContainer = null;
        this.isTruncatedView = false;
    }

    cleanup() {
        if (this.handleKeyDown) {
            document.removeEventListener('keydown', this.handleKeyDown);
            this.handleKeyDown = null;
        }
        
        // Exit fullscreen if active
        if (this.isFullscreen) {
            this.exitFullscreen();
        }
    }

    async render(filePath, fileName, contentCode, contentOther, options = {}) {
        this.cleanup();
        try {
            const img = document.createElement('img');
            const imageContainer = document.createElement('div');
            imageContainer.className = 'image-container';
            imageContainer.style.cssText = `
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 200px;
                text-align: center;
                position: relative;
                height: 100%;
            `;
            
            // Store reference for fullscreen
            this.currentImageContainer = imageContainer;
            
            // Create controls
            const controls = document.createElement('div');
            controls.className = 'image-controls';
            controls.style.cssText = `
                position: absolute;
                top: 10px;
                right: 10px;
                z-index: 10;
                opacity: 0;
                transition: opacity 0.3s ease-in-out;
            `;
            
            const fullscreenBtn = document.createElement('button');
            fullscreenBtn.id = 'image-fullscreen';
            fullscreenBtn.innerHTML = '📺 Fullscreen';
            fullscreenBtn.title = 'Toggle Fullscreen (F key)';
            fullscreenBtn.style.cssText = `
                background: #4CAF50;
                color: white;
                border: none;
                padding: 8px 12px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 12px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            `;
            
            controls.appendChild(fullscreenBtn);
            imageContainer.appendChild(controls);
            
            // Show controls on hover
            imageContainer.addEventListener('mouseenter', () => {
                controls.style.opacity = '1';
            });
            imageContainer.addEventListener('mouseleave', () => {
                controls.style.opacity = '0';
            });
            
            // Fullscreen button event listener
            fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());

            // Add loading indicator
            const loadingDiv = document.createElement('div');
            loadingDiv.style.cssText = `
                padding: 20px;
                color: #4ecdc4;
                font-style: italic;
            `;
            loadingDiv.textContent = 'Loading image...';
            imageContainer.appendChild(loadingDiv);

            img.style.cssText = `
                max-width: 100%;
                max-height: 80vh;
                object-fit: contain;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                display: none;
            `;

            let imageLoadTimeout;

            const cleanup = () => {
                if (imageLoadTimeout) {
                    clearTimeout(imageLoadTimeout);
                    imageLoadTimeout = null;
                }
            };

            img.onload = () => {
                cleanup();
                loadingDiv.style.display = 'none';
                img.style.display = 'block';
                
                // Add image info
                const infoDiv = document.createElement('div');
                infoDiv.style.cssText = `
                    margin-top: 10px;
                    padding: 8px 12px;
                    background: rgba(78, 205, 196, 0.1);
                    border-radius: 4px;
                    font-size: 12px;
                    color: #4ecdc4;
                `;
                infoDiv.textContent = `${fileName} • ${img.naturalWidth}×${img.naturalHeight}`;
                imageContainer.appendChild(infoDiv);
            };

            img.onerror = (errorEvent) => {
                cleanup();
                console.error(`Failed to load image: ${fileName}`, errorEvent);
                
                imageContainer.innerHTML = '';
                const errorDiv = document.createElement('div');
                errorDiv.style.cssText = `
                    padding: 30px;
                    background: rgba(255, 0, 0, 0.1);
                    border: 2px dashed rgba(255, 0, 0, 0.3);
                    border-radius: 8px;
                    color: #ff6b6b;
                    text-align: center;
                `;
                
                errorDiv.innerHTML = `
                    <div style="font-size: 48px; margin-bottom: 15px;">🖼️</div>
                    <h3 style="margin: 0 0 10px 0; color: #ff6b6b;">Image Load Failed</h3>
                    <p style="margin: 5px 0; font-size: 14px;"><strong>File:</strong> ${fileName}</p>
                    <p style="margin: 10px 0; font-size: 12px; opacity: 0.8;">
                        The image file may be corrupted, in an unsupported format, or too large to display.
                    </p>
                    <div style="margin-top: 15px;">
                        <a href="/files?path=${encodeURIComponent(filePath)}" 
                           download="${fileName}"
                           style="display: inline-block; padding: 8px 16px; background: #4ecdc4; color: white; text-decoration: none; border-radius: 4px; margin-right: 10px;">
                            📥 Download Image
                        </a>
                        <button onclick="location.reload()" 
                                style="padding: 8px 16px; background: #666; color: white; border: none; border-radius: 4px; cursor: pointer;">
                            🔄 Retry
                        </button>
                    </div>
                `;
                
                imageContainer.appendChild(errorDiv);
            };

            // Set a timeout for image loading
            imageLoadTimeout = setTimeout(() => {
                if (img.complete === false) {
                    console.warn(`Image loading timeout for: ${fileName}`);
                    loadingDiv.innerHTML = `
                        <div style="color: #ff9999;">
                            ⏱️ Loading is taking longer than expected...<br>
                            <small style="opacity: 0.7;">Large image or slow connection</small>
                        </div>
                    `;
                }
            }, 10000); // 10 second timeout warning

            // Attempt to load the image
            img.src = `/files?path=${encodeURIComponent(filePath)}`;
            imageContainer.appendChild(img);
            
            contentOther.appendChild(imageContainer);
            contentOther.style.display = 'block';
            
            // Setup keyboard navigation
            this.setupKeyboardNavigation();

        } catch (error) {
            console.error(`Error in ImageRenderer for ${fileName}:`, error);
            throw new Error(`Image rendering failed: ${error.message}`);
        }
    }

    setupKeyboardNavigation() {
        this.handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT') return;
            
            switch (e.key) {
                case 'f':
                case 'F':
                    e.preventDefault();
                    this.toggleFullscreen();
                    break;
                case 'Escape':
                    e.preventDefault();
                    if (this.isFullscreen) {
                        this.exitFullscreen();
                    }
                    break;
                case 'b':
                case 'B':
                    e.preventDefault();
                    if (this.isFullscreen) {
                        this.toggleTruncatedView();
                    }
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
        if (this.isFullscreen || !this.currentImageContainer) return;

        const imageContainer = this.currentImageContainer;

        // Store original parent and position
        this.originalParent = imageContainer.parentNode;

        // Create fullscreen container
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
        `;

        // Move image container to fullscreen
        this.fullscreenContainer.appendChild(imageContainer);
        document.body.appendChild(this.fullscreenContainer);

        // Update styles for fullscreen
        imageContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
            text-align: center;
            position: relative;
            background: #000;
        `;

        // Set initial view mode to 100% (non-truncated)
        this.isTruncatedView = false;

        // Update controls for fullscreen
        const controls = imageContainer.querySelector('.image-controls');
        if (controls) {
            controls.style.cssText = `
                position: absolute;
                top: 20px;
                right: 20px;
                z-index: 10;
                opacity: 1;
                transition: opacity 0.3s ease-in-out;
            `;
        }

        // Update fullscreen button
        const fullscreenBtn = controls?.querySelector('#image-fullscreen');
        if (fullscreenBtn) {
            fullscreenBtn.textContent = '🪟 Exit Fullscreen';
            fullscreenBtn.title = 'Exit Fullscreen (ESC key)';
        }

        // Hide info div in fullscreen
        const infoDiv = imageContainer.querySelector('div:last-child');
        if (infoDiv && infoDiv.textContent && infoDiv.textContent.includes('×')) {
            infoDiv.style.display = 'none';
        }

        this.isFullscreen = true;
        
        // Apply initial fullscreen image styles
        this.updateFullscreenImageStyles();
        
        console.log('Image entered fullscreen mode');
    }

    exitFullscreen() {
        if (!this.isFullscreen || !this.fullscreenContainer || !this.originalParent) return;

        const imageContainer = this.fullscreenContainer.querySelector('.image-container');
        if (imageContainer) {
            // Restore original styles
            imageContainer.style.cssText = `
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 200px;
                text-align: center;
                position: relative;
                height: 100%;
            `;

            // Restore image styles
            const img = imageContainer.querySelector('img');
            if (img) {
                img.style.cssText = `
                    max-width: 100%;
                    max-height: 80vh;
                    object-fit: contain;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    display: block;
                `;
            }

            // Restore controls
            const controls = imageContainer.querySelector('.image-controls');
            if (controls) {
                controls.style.cssText = `
                    position: absolute;
                    top: 10px;
                    right: 10px;
                    z-index: 10;
                    opacity: 0;
                    transition: opacity 0.3s ease-in-out;
                `;
            }

            // Update fullscreen button
            const fullscreenBtn = controls?.querySelector('#image-fullscreen');
            if (fullscreenBtn) {
                fullscreenBtn.textContent = '📺 Fullscreen';
                fullscreenBtn.title = 'Toggle Fullscreen (F key)';
            }

            // Show info div again
            const infoDiv = imageContainer.querySelector('div:last-child');
            if (infoDiv && infoDiv.textContent && infoDiv.textContent.includes('×')) {
                infoDiv.style.display = 'block';
            }

            // Move back to original parent
            this.originalParent.appendChild(imageContainer);
        }

        // Remove fullscreen container
        document.body.removeChild(this.fullscreenContainer);

        // Reset state
        this.fullscreenContainer = null;
        this.originalParent = null;
        this.isFullscreen = false;
        this.isTruncatedView = false;
        console.log('Image exited fullscreen mode');
    }

    toggleTruncatedView() {
        if (!this.isFullscreen) return;

        this.isTruncatedView = !this.isTruncatedView;
        this.updateFullscreenImageStyles();
        console.log(`Image view mode: ${this.isTruncatedView ? 'truncated' : '100%'}`);
    }

    updateFullscreenImageStyles() {
        if (!this.isFullscreen || !this.fullscreenContainer) return;

        const imageContainer = this.fullscreenContainer.querySelector('.image-container');
        if (!imageContainer) return;

        const img = imageContainer.querySelector('img');
        if (!img) return;

        if (this.isTruncatedView) {
            // Truncated view - show image end clearly with some padding
            img.style.cssText = `
                max-width: calc(100vw - 40px);
                max-height: calc(100vh - 40px);
                object-fit: contain;
                border-radius: 0;
                box-shadow: none;
                display: block;
            `;
        } else {
            // 100% view - maximize space usage
            img.style.cssText = `
                max-width: 100vw;
                max-height: 100vh;
                object-fit: contain;
                border-radius: 0;
                box-shadow: none;
                display: block;
            `;
        }
    }
}