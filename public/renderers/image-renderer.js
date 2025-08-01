class ImageRenderer {
    async render(filePath, fileName, contentCode, contentOther, options = {}) {
        try {
            const img = document.createElement('img');
            const imageContainer = document.createElement('div');
            imageContainer.style.cssText = `
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 200px;
                text-align: center;
            `;

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

        } catch (error) {
            console.error(`Error in ImageRenderer for ${fileName}:`, error);
            throw new Error(`Image rendering failed: ${error.message}`);
        }
    }
}