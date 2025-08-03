class AudioRenderer {
    async render(filePath, fileName, contentCode, contentOther, options = {}) {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = `/files?path=${encodeURIComponent(filePath)}`;
        contentOther.appendChild(audio);
        contentOther.style.display = 'block';
    }
    
    cleanup() {
        // Stop any playing audio in content areas
        const audios = document.querySelectorAll('#content-other audio');
        audios.forEach(audio => {
            audio.pause();
            audio.currentTime = 0;
        });
    }
}

class VideoRenderer {
    constructor() {
        this.handleKeyDown = null;
        this.handleWheel = null;
    }

    async render(filePath, fileName, contentCode, contentOther, options = {}) {
        // Store current file info for annotations
        this.currentFilePath = filePath;
        this.currentFileName = fileName;
        
        const video = document.createElement('video');
        video.controls = true;
        video.preload = 'metadata';
        video.style.maxWidth = '100%';
        video.style.height = 'auto';
        
        // Check if this file needs transcoding
        const needsTranscoding = fileName.toLowerCase().endsWith('.avi') || fileName.toLowerCase().endsWith('.wmv');
        
        if (needsTranscoding) {
            // Use transcoding endpoint for AVI/WMV files
            video.src = `/video-transcode?path=${encodeURIComponent(filePath)}`;
            
            // Add loading indicator for transcoding
            const loadingDiv = document.createElement('div');
            loadingDiv.style.color = '#666';
            loadingDiv.style.marginBottom = '10px';
            loadingDiv.innerHTML = `🔄 Transcoding ${fileName.toLowerCase().endsWith('.avi') ? 'AVI' : 'WMV'} file for playback...`;
            contentOther.appendChild(loadingDiv);
            
            video.addEventListener('loadstart', () => {
                loadingDiv.innerHTML = '🔄 Loading transcoded video...';
            });
            
            video.addEventListener('canplay', () => {
                loadingDiv.style.display = 'none';
            });
        } else {
            // Use direct file serving for other formats
            video.src = `/files?path=${encodeURIComponent(filePath)}`;
        }
        
        // Error handling
        const errorDiv = document.createElement('div');
        errorDiv.style.color = 'red';
        errorDiv.style.marginTop = '10px';
        errorDiv.style.display = 'none';
        
        video.addEventListener('error', (e) => {
            console.error('Video error:', e, video.error);
            errorDiv.style.display = 'block';
            errorDiv.innerHTML = `
                <strong>Video Error:</strong><br>
                ${this.getErrorMessage(video.error?.code)}<br>
                <small>File: ${fileName}</small>
                ${needsTranscoding ? '<br><small>Try refreshing if transcoding failed</small>' : ''}
            `;
        });
        
        video.addEventListener('loadedmetadata', () => {
            console.log('Video loaded:', fileName, `${video.videoWidth}x${video.videoHeight}`);
        });
        
        video.addEventListener('canplay', () => {
            console.log('Video can play:', fileName);
            
            // Auto-play and auto-fullscreen if opened via keyboard navigation
            if (options.autoPlay && options.keyboardNavigation) {
                video.play().then(() => {
                    // Enter fullscreen after play starts
                    return video.requestFullscreen();
                }).catch(err => {
                    console.log('Auto-play/fullscreen error (may be due to browser policy):', err);
                });
            }
        });
        
        contentOther.appendChild(video);
        contentOther.appendChild(errorDiv);
        
        // Explicitly call load() to prevent premature load attempts
        video.load();
        
        // Add annotation status overlay
        this.annotationOverlay = document.createElement('div');
        this.annotationOverlay.style.cssText = `
            position: absolute;
            top: 10px;
            left: 10px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            z-index: 10;
            font-family: monospace;
        `;
        this.annotationOverlay.textContent = 'Loading annotations...';
        contentOther.appendChild(this.annotationOverlay);
        
        contentOther.style.display = 'block';
        
        // Load and display current annotations
        this.loadCurrentAnnotations();
        
        // Add keyboard handler for spacebar fullscreen toggle and play/pause
        this.handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }
            
            if (e.code === 'Space') {
                e.preventDefault();
                this.togglePlayAndFullscreen(video);
            } else if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'PageUp' || e.code === 'PageDown') {
                e.preventDefault();
                this.navigateToAdjacentFile(e.code);
            } else if (e.key === 'r' || e.key === 'g' || e.key === 'y' || e.key === 'b' || e.key === 'c' || 
                       (e.key >= '1' && e.key <= '5')) {
                e.preventDefault();
                this.handleAnnotationShortcut(e.key);
            }
        };
        
        document.addEventListener('keydown', this.handleKeyDown);
        
        // Add mouse wheel handler for fast forward/backward
        let wheelTimeout;
        this.handleWheel = (e) => {
            // Only handle wheel events when mouse is over the video
            if (e.target === video || video.contains(e.target)) {
                e.preventDefault();
                e.stopPropagation();
                
                // Throttle wheel events to prevent rapid seeking
                if (wheelTimeout) return;
                wheelTimeout = setTimeout(() => wheelTimeout = null, 100);
                
                const skipAmount = 10; // seconds to skip for wheel
                
                // Simple check - just needs duration
                if (video.duration && !isNaN(video.duration)) {
                    
                    const oldTime = video.currentTime;
                    let newTime;
                    
                    if (e.deltaY > 0) {
                        // Wheel down - fast forward
                        newTime = Math.min(oldTime + skipAmount, video.duration);
                    } else if (e.deltaY < 0) {
                        // Wheel up - rewind  
                        newTime = Math.max(oldTime - skipAmount, 0);
                    }
                    
                    if (newTime !== undefined && newTime !== oldTime) {
                        video.currentTime = newTime;
                        console.log('Seek:', oldTime.toFixed(1), '->', newTime.toFixed(1));
                        
                        // Show visual feedback for successful seek
                        const message = document.createElement('div');
                        const direction = e.deltaY > 0 ? '⏩' : '⏪';
                        message.textContent = `${direction} ${Math.round(newTime)}s`;
                        message.style.cssText = `
                            position: fixed; top: 20%; left: 50%; transform: translate(-50%, -50%);
                            background: rgba(0,0,0,0.7); color: white; padding: 8px 16px;
                            border-radius: 20px; z-index: 9999; font-size: 16px; font-weight: bold;
                        `;
                        document.body.appendChild(message);
                        setTimeout(() => message.remove(), 1000);
                    }
                } else {
                    // Show visual feedback when video isn't ready for seeking
                    const message = document.createElement('div');
                    message.textContent = '⏳ Video still loading - please wait';
                    message.style.cssText = `
                        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                        background: rgba(0,0,0,0.8); color: white; padding: 10px 20px;
                        border-radius: 5px; z-index: 9999; font-size: 14px;
                    `;
                    document.body.appendChild(message);
                    setTimeout(() => message.remove(), 2000);
                }
            }
        };
        
        video.addEventListener('wheel', this.handleWheel);
    }
    
    seekVideo(video, seconds) {
        if (video.duration && !isNaN(video.duration) && video.readyState >= 2 && 
            video.seekable.length > 0 && video.seekable.end(0) > 5) {
            
            const oldTime = video.currentTime;
            const seekableEnd = video.seekable.end(video.seekable.length - 1);
            const newTime = seconds > 0 
                ? Math.min(oldTime + seconds, seekableEnd)
                : Math.max(oldTime + seconds, 0);
            
            if (newTime !== oldTime) {
                video.currentTime = newTime;
                
                // Show visual feedback
                const message = document.createElement('div');
                const direction = seconds > 0 ? '⏩' : '⏪';
                message.textContent = `${direction} ${Math.round(newTime)}s`;
                message.style.cssText = `
                    position: fixed; top: 20%; left: 50%; transform: translate(-50%, -50%);
                    background: rgba(0,0,0,0.7); color: white; padding: 8px 16px;
                    border-radius: 20px; z-index: 9999; font-size: 16px; font-weight: bold;
                `;
                document.body.appendChild(message);
                setTimeout(() => message.remove(), 1000);
            }
        }
    }
    
    navigateToAdjacentFile(keyCode) {
        // Check if file explorer is available
        if (!window.fileExplorer || !window.fileExplorer.filteredFiles || !window.fileExplorer.selectFile) {
            console.log('File explorer not available for navigation');
            return;
        }
        
        const filteredFiles = window.fileExplorer.filteredFiles();
        const currentIndex = this.getCurrentFileIndex(filteredFiles);
        
        if (currentIndex === -1) {
            console.log('Current file not found in directory listing');
            return;
        }
        
        let newIndex = currentIndex;
        let direction = '';
        
        switch (keyCode) {
            case 'ArrowUp':
                newIndex = this.findPreviousVideoFile(filteredFiles, currentIndex);
                direction = 'previous';
                break;
            case 'ArrowDown':
                newIndex = this.findNextVideoFile(filteredFiles, currentIndex);
                direction = 'next';
                break;
            case 'PageUp':
                newIndex = this.findPreviousVideoFile(filteredFiles, currentIndex);
                direction = 'previous';
                break;
            case 'PageDown':
                newIndex = this.findNextVideoFile(filteredFiles, currentIndex);
                direction = 'next';
                break;
        }
        
        if (newIndex !== -1 && newIndex !== currentIndex) {
            const newFile = filteredFiles[newIndex];
            const currentPath = window.fileExplorer.currentPath();
            const filePath = currentPath ? `${currentPath}/${newFile.name}` : newFile.name;
            
            // Show navigation feedback
            this.showNavigationFeedback(direction, newFile.name);
            
            // Navigate to the new file with autoplay
            window.fileExplorer.selectFile(newIndex, filePath, newFile.name, { 
                autoPlay: true, 
                keyboardNavigation: true 
            });
            
            // Also trigger content loading
            window.fileExplorer.showContent(currentPath, newFile.name, { 
                autoPlay: true, 
                keyboardNavigation: true 
            });
            
            // Update details panel
            window.fileExplorer.updateDetails(newFile);
        } else {
            // Show feedback when at boundaries
            const message = direction === 'next' ? 'No more videos ahead' : 'No more videos behind';
            this.showNavigationFeedback('boundary', message);
        }
    }
    
    getCurrentFileIndex(filteredFiles) {
        if (!this.currentFileName) return -1;
        
        return filteredFiles.findIndex(file => file.name === this.currentFileName);
    }
    
    findNextVideoFile(filteredFiles, startIndex) {
        const videoExtensions = ['mp4', 'avi', 'mov', 'mkv', 'webm', 'mpg', 'mpeg', 'wmv'];
        
        // Search forward from current position
        for (let i = startIndex + 1; i < filteredFiles.length; i++) {
            const file = filteredFiles[i];
            if (!file.isDirectory && this.isVideoFile(file.name, videoExtensions)) {
                return i;
            }
        }
        
        // Wrap around to beginning
        for (let i = 0; i < startIndex; i++) {
            const file = filteredFiles[i];
            if (!file.isDirectory && this.isVideoFile(file.name, videoExtensions)) {
                return i;
            }
        }
        
        return -1; // No video files found
    }
    
    findPreviousVideoFile(filteredFiles, startIndex) {
        const videoExtensions = ['mp4', 'avi', 'mov', 'mkv', 'webm', 'mpg', 'mpeg', 'wmv'];
        
        // Search backward from current position
        for (let i = startIndex - 1; i >= 0; i--) {
            const file = filteredFiles[i];
            if (!file.isDirectory && this.isVideoFile(file.name, videoExtensions)) {
                return i;
            }
        }
        
        // Wrap around to end
        for (let i = filteredFiles.length - 1; i > startIndex; i--) {
            const file = filteredFiles[i];
            if (!file.isDirectory && this.isVideoFile(file.name, videoExtensions)) {
                return i;
            }
        }
        
        return -1; // No video files found
    }
    
    isVideoFile(filename, videoExtensions) {
        const extension = filename.split('.').pop().toLowerCase();
        return videoExtensions.includes(extension);
    }
    
    showNavigationFeedback(direction, message) {
        const feedback = document.createElement('div');
        
        let displayText = '';
        let backgroundColor = 'rgba(0,0,0,0.8)';
        
        if (direction === 'next') {
            displayText = `⏭️ Next: ${message}`;
            backgroundColor = 'rgba(76, 175, 80, 0.9)';
        } else if (direction === 'previous') {
            displayText = `⏮️ Previous: ${message}`;
            backgroundColor = 'rgba(33, 150, 243, 0.9)';
        } else if (direction === 'boundary') {
            displayText = `⚠️ ${message}`;
            backgroundColor = 'rgba(255, 152, 0, 0.9)';
        }
        
        feedback.textContent = displayText;
        feedback.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: ${backgroundColor};
            color: white;
            padding: 15px 25px;
            border-radius: 8px;
            z-index: 10000;
            font-size: 16px;
            font-weight: bold;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            backdrop-filter: blur(10px);
        `;
        
        document.body.appendChild(feedback);
        
        // Remove after 2 seconds
        setTimeout(() => {
            if (feedback.parentNode) {
                feedback.remove();
            }
        }, 2000);
    }
    
    handleAnnotationShortcut(key) {
        // Get current file info from renderer context
        if (!this.currentFilePath || !this.currentFileName) {
            return;
        }
        
        // Map key to annotation action
        let type, value;
        switch (key) {
            case 'r':
                type = 'color';
                value = '#f44336';
                break;
            case 'g':
                type = 'color';
                value = '#4caf50';
                break;
            case 'y':
                type = 'color';
                value = '#ffeb3b';
                break;
            case 'b':
                type = 'color';
                value = '#2196f3';
                break;
            case 'c':
                type = 'comment';
                break;
            case '1':
            case '2':
            case '3':
            case '4':
            case '5':
                type = 'stars';
                value = parseInt(key);
                break;
            default:
                return;
        }
        
        // Save annotation directly
        this.saveAnnotationDirectly(type, value);
    }
    
    async loadCurrentAnnotations() {
        try {
            const response = await fetch('/api/annotations');
            const data = await response.json();
            // Handle different possible response formats
            let annotation = {};
            if (data.annotations && data.annotations[this.currentFilePath]) {
                annotation = data.annotations[this.currentFilePath];
            } else if (data[this.currentFilePath]) {
                annotation = data[this.currentFilePath];
            }
            this.updateAnnotationDisplay(annotation);
        } catch (error) {
            console.error('Error loading annotations:', error);
            this.updateAnnotationDisplay({});
        }
    }
    
    updateAnnotationDisplay(annotation) {
        // Create visual star rating display (1-5 stars)
        let starsDisplay = '';
        const currentRating = annotation.stars || 0;
        for (let i = 1; i <= 5; i++) {
            if (i <= currentRating) {
                starsDisplay += `<span style="color: #ffd700; font-size: 16px;">★</span>`;
            } else {
                starsDisplay += `<span style="color: #666; font-size: 16px;">☆</span>`;
            }
        }
        if (currentRating === 0) {
            starsDisplay += ' <span style="color: #999; font-size: 12px;">(No rating)</span>';
        } else {
            starsDisplay += ` <span style="color: #999; font-size: 12px;">(${currentRating}/5)</span>`;
        }
        
        const colorNames = {
            '#f44336': 'Red',
            '#4caf50': 'Green',
            '#ffeb3b': 'Yellow',
            '#2196f3': 'Blue'
        };
        const color = annotation.color ? colorNames[annotation.color] || 'Custom' : 'No color';
        const comment = annotation.comment ? 'Has comment' : 'No comment';
        
        this.annotationOverlay.innerHTML = `
            <div style="margin-bottom: 4px;">Stars: ${starsDisplay}</div>
            <div style="margin-bottom: 4px;">Color: <span style="color: ${annotation.color || '#ccc'}">${color}</span></div>
            <div style="font-size: 11px;">${comment}</div>
            <div style="font-size: 10px; color: #999; margin-top: 4px;">Press 1-5 for stars, R/G/Y/B for colors, C for comment</div>
        `;
        
        if (annotation.color) {
            this.annotationOverlay.style.borderLeft = `4px solid ${annotation.color}`;
        } else {
            this.annotationOverlay.style.borderLeft = 'none';
        }
    }
    
    async saveAnnotationDirectly(type, value) {
        const filePath = this.currentFilePath;
        console.log('saveAnnotationDirectly:', type, value, 'for file:', filePath);
        
        if (type === 'comment') {
            // Show comment dialog
            if (window.showAnnotationDialog) {
                window.showAnnotationDialog(filePath, this.currentFileName);
            }
            return;
        }
        
        // Get current annotation first
        let existingAnnotation = {};
        try {
            const response = await fetch('/api/annotations');
            const data = await response.json();
            if (data.annotations && data.annotations[filePath]) {
                existingAnnotation = data.annotations[filePath];
            } else if (data[filePath]) {
                existingAnnotation = data[filePath];
            }
            console.log('Existing annotation:', existingAnnotation);
        } catch (error) {
            console.log('No existing annotations found');
        }
        
        // For color and stars, update annotation directly
        const annotation = {
            comment: existingAnnotation.comment || '',
            color: type === 'color' ? value : existingAnnotation.color,
            stars: type === 'stars' ? value : existingAnnotation.stars
        };
        
        console.log('Saving annotation:', annotation);
        
        // Save annotation
        try {
            const response = await fetch('/api/annotations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    filePath: filePath,
                    ...annotation
                })
            });
            
            const data = await response.json();
            console.log('Save response:', data);
            
            if (data.success) {
                // Update cache
                if (!window.annotationsCache) window.annotationsCache = {};
                window.annotationsCache[filePath] = annotation;
                
                // Update the overlay display
                this.updateAnnotationDisplay(annotation);
                
                // Refresh file list display if file explorer is available
                if (window.fileExplorer && window.fileExplorer.loadFiles) {
                    const currentPath = window.fileExplorer.currentPath();
                    window.fileExplorer.loadFiles(currentPath);
                }
                
                // Show feedback
                this.showQuickAnnotationFeedback(type, value);
            } else {
                console.error('Save failed:', data);
                this.showQuickAnnotationFeedback('error', 'Save failed');
            }
        } catch (error) {
            console.error('Error saving annotation:', error);
            this.showQuickAnnotationFeedback('error', 'Network error');
        }
    }
    
    showQuickAnnotationFeedback(type, value) {
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
    
    togglePlayAndFullscreen(video) {
        // Toggle play/pause
        if (video.paused) {
            video.play().catch(err => {
                console.error('Error attempting to play video:', err);
            });
        } else {
            video.pause();
        }
        
        // Toggle fullscreen
        if (!document.fullscreenElement) {
            video.requestFullscreen().catch(err => {
                console.error('Error attempting to enable fullscreen:', err);
            });
        } else {
            document.exitFullscreen().catch(err => {
                console.error('Error attempting to exit fullscreen:', err);
            });
        }
    }
    
    cleanup() {
        if (this.handleKeyDown) {
            document.removeEventListener('keydown', this.handleKeyDown);
            this.handleKeyDown = null;
        }
        if (this.handleWheel) {
            // Note: wheel event listener is attached to video element, not document
            // It will be automatically cleaned up when video element is removed
            this.handleWheel = null;
        }
        
        // Stop any playing videos in content areas
        const videos = document.querySelectorAll('#content-other video');
        videos.forEach(video => {
            video.pause();
            video.currentTime = 0;
        });
    }
    
    getErrorMessage(errorCode) {
        const errors = {
            1: 'MEDIA_ERR_ABORTED - Video loading was aborted',
            2: 'MEDIA_ERR_NETWORK - Network error occurred',
            3: 'MEDIA_ERR_DECODE - Video decoding failed (unsupported format or codec)',
            4: 'MEDIA_ERR_SRC_NOT_SUPPORTED - Video format not supported'
        };
        return errors[errorCode] || 'Unknown video error';
    }
}