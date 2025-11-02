// Enhanced file renderer with modular architecture
// Renderer classes are loaded from separate modules in /renderers/ folder

class FileRenderer {
    constructor() {
        this.handlers = new Map();
        this.currentHandler = null; // To keep track of the active renderer
        this.setupHandlers();
    }

    setupHandlers() {
        this.handlers.set('text', new TextRenderer());
        this.handlers.set('image', new ImageRenderer());
        this.handlers.set('image-pair', new ImagePairRenderer());
        this.handlers.set('pdf', new PDFRenderer());
        this.handlers.set('comic', new ComicRenderer());
        this.handlers.set('audio', new AudioRenderer());
        this.handlers.set('video', new VideoRenderer());
        this.handlers.set('docx', new DocxRenderer());
        this.handlers.set('xlsx', new XlsxRenderer());
        this.handlers.set('pptx', new PptxRenderer());
        // Use PDF renderer for EPUB files (converts EPUB to PDF on the server)
        this.handlers.set('epub', new EpubPdfRenderer());
        this.handlers.set('archive', new ArchiveRenderer());
        this.handlers.set('html', new HtmlRenderer());
        // Treat .doc as .docx for rendering
        this.handlers.set('doc', this.handlers.get('docx'));
        // Add a CSS class to the <pre> element for better text contrast and fix font rendering
        const style = document.createElement('style');
        style.innerHTML = `
            pre#content-code, pre code#content-code {
                background: #222 !important;
                color: #f8f8f2 !important;
                border-radius: 8px;
                padding: 16px;
                font-size: 1em;
                font-family: 'Fira Mono', 'Consolas', 'Menlo', 'Monaco', 'Liberation Mono', monospace !important;
                line-height: 1.8 !important;
                letter-spacing: 0.02em !important;
                overflow-x: auto;
                white-space: pre-wrap !important;
                word-break: break-word !important;
                box-sizing: border-box;
            }
            pre#content-code code, pre code#content-code {
                display: block;
                line-height: inherit !important;
                font-family: inherit !important;
                font-size: inherit !important;
                background: none !important;
                color: inherit !important;
                padding: 0;
                margin: 0;
            }
            pre#content-code::-webkit-scrollbar, pre code#content-code::-webkit-scrollbar {
                height: 8px;
                background: #222;
            }
            pre#content-code::-webkit-scrollbar-thumb, pre code#content-code::-webkit-scrollbar-thumb {
                background: #444;
                border-radius: 4px;
            }
        `;
        document.head.appendChild(style);
    }

    async getFileType(fileName, filePath) {
        const extension = fileName.split('.').pop().toLowerCase();
        // Treat .doc as .docx
        if (extension === 'doc') return 'docx';

        if (extension === 'html') {
            return 'html';
        } else if (['txt', 'md', 'js', 'css', 'json', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'go', 'rs', 'csv', 'srt', 'xml', 'yaml', 'yml', 'ini', 'conf', 'log', 'sh', 'bat', 'ps1', 'sql', 'php', 'rb', 'swift', 'kt', 'dart', 'r', 'scala', 'clj', 'elm', 'vue', 'jsx', 'tsx', 'ts', 'less', 'scss', 'sass', 'styl', 'svelte', 'astro', 'lsl', 'lua', 'pl', 'asm', 's', 'vb', 'pas', 'f90', 'f95', 'f03', 'f08', 'for', 'cobol', 'cob', 'zig', 'm', 'mm', 'groovy', 'gradle', 'cmake', 'dockerfile'].includes(extension)) {
            return 'text';
        } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif'].includes(extension)) {
            const response = await fetch(`/files/list?path=${encodeURIComponent(filePath.substring(0, filePath.lastIndexOf('/')))}`);
            const files = await response.json();
            const imageFiles = files.filter(file => ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif'].includes(file.name.split('.').pop().toLowerCase()));
            return imageFiles.length > 1 ? 'image-pair' : 'image';
        } else if (extension === 'pdf') {
            return 'pdf';
        } else if (['cbz', 'cbr'].includes(extension)) {
            return 'comic';
        } else if (['mp3', 'wav', 'flac', 'ogg'].includes(extension)) {
            return 'audio';
        } else if (['mp4', 'avi', 'mov', 'mkv', 'webm', 'mpg', 'mpeg', 'wmv'].includes(extension)) {
            return 'video';
        } else if (extension === 'docx') {
            return 'docx';
        } else if (extension === 'xlsx') {
            return 'xlsx';
        } else if (extension === 'pptx') {
            return 'pptx';
        } else if (extension === 'epub') {
            return 'epub';
        } else if (['zip', 'rar', 'tar', 'tgz', 'tar.gz'].includes(extension) || fileName.endsWith('.tar.gz')) {
            return 'archive';
        }
        return 'unsupported';
    }

    stopAllMedia() {
        // Stop all video elements
        const videos = document.querySelectorAll('video');
        videos.forEach(video => {
            video.pause();
            video.currentTime = 0;
            video.src = '';
            video.load(); // Reset the video element
        });
        
        // Stop all audio elements
        const audios = document.querySelectorAll('audio');
        audios.forEach(audio => {
            audio.pause();
            audio.currentTime = 0;
            audio.src = '';
            audio.load(); // Reset the audio element
        });
        
        // Exit fullscreen if active
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(err => {
                console.log('Error exiting fullscreen:', err);
            });
        }
    }

    async render(filePath, fileName, contentCode, contentOther, options = {}) {
        try {
            // Stop all media playback before switching files
            this.stopAllMedia();
            
            // Cleanup previous renderer's specific event listeners or states
            if (this.currentHandler && typeof this.currentHandler.cleanup === 'function') {
                try {
                    this.currentHandler.cleanup();
                } catch (cleanupError) {
                    console.warn('Error during renderer cleanup:', cleanupError);
                }
            }

            const fileType = await this.getFileType(fileName, filePath);
            const handler = this.handlers.get(fileType);
            this.currentHandler = handler; // Set the new handler

            if (fileType === 'image-pair') {
                const response = await fetch(`/files/list?path=${encodeURIComponent(filePath.substring(0, filePath.lastIndexOf('/')))}`);
                const files = await response.json();
                options.images = files.filter(file => ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif'].includes(file.name.split('.').pop().toLowerCase()));
            }

            console.log(`FileRenderer: ${fileName} -> ${fileType} -> ${handler?.constructor?.name || 'no handler'}`);

            // Show progress for file rendering
            if (window.debugConsole) {
                window.debugConsole.showProgress(`Rendering ${fileType}: ${fileName}`, 20);
            }

            contentCode.innerHTML = '';
            contentOther.innerHTML = '';
            contentCode.parentElement.style.display = 'none';
            contentOther.style.display = 'none';
            
            if (handler) {
                try {
                    if (window.debugConsole) {
                        window.debugConsole.updateProgress(`Processing ${fileType}...`, 60);
                    }
                    await handler.render(filePath, fileName, contentCode, contentOther, options);
                    if (window.debugConsole) {
                        window.debugConsole.showProgress('Rendering complete', 100);
                        setTimeout(() => {
                            window.debugConsole.hideProgress();
                        }, 300);
                    }
                } catch (renderError) {
                    console.error(`Error rendering ${fileType} file "${fileName}":`, renderError);
                    this.showErrorMessage(contentOther, fileName, renderError, filePath);
                    if (window.debugConsole) {
                        window.debugConsole.hideProgress();
                    }
                }
            } else {
                contentOther.textContent = 'File type not supported for preview.';
                contentOther.style.display = 'block';
                if (window.debugConsole) {
                    window.debugConsole.hideProgress();
                }
            }
        } catch (fatalError) {
            console.error(`Fatal error in FileRenderer for "${fileName}":`, fatalError);
            this.showErrorMessage(contentOther, fileName, fatalError, filePath);
            if (window.debugConsole) {
                window.debugConsole.hideProgress();
            }
        }
    }

    showErrorMessage(contentContainer, fileName, error, filePath) {
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            padding: 20px;
            margin: 20px;
            background: rgba(255, 0, 0, 0.1);
            border: 1px solid rgba(255, 0, 0, 0.3);
            border-radius: 8px;
            color: #ff6b6b;
            font-family: monospace;
            text-align: center;
        `;
        
        const isCorruptedFile = this.isCorruptionError(error);
        const errorType = isCorruptedFile ? 'File appears to be corrupted' : 'File rendering error';
        
        errorDiv.innerHTML = `
            <h3 style="color: #ff6b6b; margin: 0 0 15px 0;">⚠️ ${errorType}</h3>
            <p style="margin: 10px 0; font-size: 14px;">
                <strong>File:</strong> ${fileName}
            </p>
            <p style="margin: 10px 0; font-size: 12px; opacity: 0.8;">
                ${isCorruptedFile 
                    ? 'The file may be damaged, incomplete, or in an unsupported format variant.' 
                    : 'An unexpected error occurred while trying to render this file.'}
            </p>
            <details style="margin: 15px 0; text-align: left;">
                <summary style="cursor: pointer; color: #ff9999;">Show error details</summary>
                <pre style="margin: 10px 0; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 4px; font-size: 11px; overflow-x: auto;">${error.message || error.toString()}</pre>
            </details>
            <div style="margin-top: 15px;">
                <a href="/files?path=${encodeURIComponent(filePath)}" 
                   download="${fileName}" 
                   style="display: inline-block; padding: 8px 16px; background: #4ecdc4; color: white; text-decoration: none; border-radius: 4px; font-size: 14px;">
                    📥 Download File
                </a>
                <button onclick="location.reload()" 
                        style="margin-left: 10px; padding: 8px 16px; background: #666; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                    🔄 Retry
                </button>
            </div>
        `;
        
        contentContainer.innerHTML = '';
        contentContainer.appendChild(errorDiv);
        contentContainer.style.display = 'block';
    }

    isCorruptionError(error) {
        const errorMessage = (error.message || error.toString()).toLowerCase();
        const corruptionIndicators = [
            'corrupt', 'corrupted', 'damaged', 'invalid', 'malformed', 
            'unexpected end', 'truncated', 'bad format', 'parse error',
            'failed to load', 'network error', 'decode error', 'format error',
            'unsupported', 'cannot read', 'invalid signature', 'header error'
        ];
        return corruptionIndicators.some(indicator => errorMessage.includes(indicator));
    }

    async testRender(fileType, testFilePath, testFileName) {
        const handler = this.handlers.get(fileType);
        if (!handler) {
            console.error(`No handler for file type: ${fileType}`);
            return false;
        }

        try {
            const testContainer = document.createElement('div');
            testContainer.id = 'test-container';
            document.body.appendChild(testContainer);

            const mockContentCode = document.createElement('pre');
            const mockContentOther = document.createElement('div');
            testContainer.appendChild(mockContentCode);
            testContainer.appendChild(mockContentOther);

            console.log(`Testing ${fileType} with file: ${testFileName}`);
            await handler.render(testFilePath, testFileName, mockContentCode, mockContentOther);
            
            console.log(`✓ ${fileType} render completed successfully`);
            return true;
        } catch (error) {
            console.error(`✗ ${fileType} render failed:`, error);
            return false;
        }
    }
}