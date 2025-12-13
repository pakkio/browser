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
        this.currentVideo = null; // Will store reference to video element
        this.availableSubtitles = []; // Will store list of available subtitle files
        
        const video = document.createElement('video');
        this.currentVideo = video;
        video.controls = true;
        video.preload = 'metadata';
        video.style.maxWidth = '100%';
        video.style.height = 'auto';
        video.crossOrigin = 'anonymous'; // Allow loading subtitles from same server
        
        // Add a custom attribute to track our click handling
        video.setAttribute('data-custom-click', 'true');
        
        // Check if this file is inside an archive
        const isArchiveVideo = filePath.includes('||');
        
        if (isArchiveVideo) {
            // Extract archive path and file name from the filePath
            const [archivePath, videoFileName] = filePath.split('||');
            
            // Use archive video endpoint for archived videos
            video.src = `/archive-video?path=${encodeURIComponent(archivePath)}&fileName=${encodeURIComponent(videoFileName)}`;
            
            // Add loading indicator for archive extraction
            const loadingDiv = document.createElement('div');
            loadingDiv.style.color = '#666';
            loadingDiv.style.marginBottom = '10px';
            loadingDiv.innerHTML = `🔄 Extracting video from archive...`;
            contentOther.appendChild(loadingDiv);
            
            video.addEventListener('loadstart', () => {
                loadingDiv.innerHTML = '🔄 Loading extracted video...';
            });
            
            video.addEventListener('canplay', () => {
                loadingDiv.style.display = 'none';
            });
        } else {
            // Check if this file needs transcoding
            const needsTranscoding = fileName.toLowerCase().endsWith('.avi') ||
                                    fileName.toLowerCase().endsWith('.wmv') ||
                                    fileName.toLowerCase().endsWith('.mpg') ||
                                    fileName.toLowerCase().endsWith('.mpeg');

            // Allow forcing transcoding via options (for MP4 files with codec issues)
            const forceTranscode = options.forceTranscode || false;

            if (needsTranscoding || forceTranscode) {
                // Use transcoding endpoint
                video.src = `/video-transcode?path=${encodeURIComponent(filePath)}`;

                // Add loading indicator for transcoding
                const loadingDiv = document.createElement('div');
                loadingDiv.style.color = '#666';
                loadingDiv.style.marginBottom = '10px';
                const ext = fileName.split('.').pop().toUpperCase();
                loadingDiv.innerHTML = `🔄 Transcoding ${ext} file for playback...`;
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
            
            // Try to auto-detect and load subtitle files
            await this.loadSubtitles(video, filePath, fileName);
            
            // Discover all available subtitle files in the directory
            await this.discoverSubtitles(filePath, fileName);
        }
        
        // Error handling
        const errorDiv = document.createElement('div');
        errorDiv.style.color = 'red';
        errorDiv.style.marginTop = '10px';
        errorDiv.style.display = 'none';
        
        video.addEventListener('error', async (e) => {
            console.error('Video error:', e, video.error);
            errorDiv.style.display = 'block';

            const errorCode = video.error?.code;
            const errorMessage = video.error?.message || '';
            const isDemuxerError = errorMessage.includes('DEMUXER_ERROR') || errorMessage.includes('FFmpegDemuxer');
            const isNetworkError = errorCode === 2;
            const isDecodeError = errorCode === 3;
            const isFormatError = errorCode === 4;

            let troubleshootingHint = '';
            let transcodeButton = '';

            if (isDemuxerError || isDecodeError || isFormatError) {
                troubleshootingHint = '<br><small>⚠️ This video may have an unsupported codec or be corrupted.</small>';

                // For MP4/MOV/MKV files with codec issues, offer transcoding
                if (fileName.toLowerCase().match(/\.(mp4|mov|mkv)$/)) {
                    transcodeButton = `
                        <br><button id="transcode-video-btn" style="
                            margin-top: 10px;
                            padding: 8px 16px;
                            background: #4ecdc4;
                            color: white;
                            border: none;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 14px;
                        ">🔄 Try Transcoding</button>
                        <br><small style="color: #999;">Click to attempt automatic transcoding to a browser-compatible format</small>
                    `;

                    // Add click handler after DOM update
                    setTimeout(() => {
                        const transcodeBtn = document.getElementById('transcode-video-btn');
                        if (transcodeBtn) {
                            transcodeBtn.addEventListener('click', () => {
                                // Reload the video renderer with forceTranscode option
                                if (window.fileExplorer && window.fileExplorer.showContent) {
                                    const path = filePath.substring(0, filePath.lastIndexOf('/'));
                                    window.fileExplorer.showContent(path, fileName, { forceTranscode: true });
                                } else {
                                    location.reload();
                                }
                            });
                        }
                    }, 100);
                }
            } else if (isNetworkError) {
                troubleshootingHint = '<br><small>⚠️ Network issue - check if the file path contains special characters or emojis.</small>';
            }

            errorDiv.innerHTML = `
                <strong>Video Error:</strong><br>
                ${this.getErrorMessage(errorCode)}<br>
                <small>File: ${fileName}</small>
                ${errorMessage ? `<br><small style="color: #ff9999;">Details: ${errorMessage}</small>` : ''}
                ${troubleshootingHint}
                ${transcodeButton}
                ${(options.needsTranscoding || false) ? '<br><small>Try refreshing if transcoding failed</small>' : ''}
            `;
        });
        
        video.addEventListener('loadedmetadata', () => {
            console.log('Video loaded:', fileName, `${video.videoWidth}x${video.videoHeight}`);
        });
        
        // Buffering indicator for seeking to unbuffered positions
        let bufferingOverlay = null;
        let bufferingStartTime = null;
        let bufferingInterval = null;
        
        const showBufferingIndicator = (targetTime) => {
            if (bufferingOverlay) return; // Already showing
            
            bufferingStartTime = Date.now();
            bufferingOverlay = document.createElement('div');
            bufferingOverlay.id = 'video-buffering-overlay';
            bufferingOverlay.style.cssText = `
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background: rgba(0,0,0,0.85); color: white; padding: 20px 30px;
                border-radius: 12px; z-index: 10000; font-size: 18px; text-align: center;
                min-width: 200px; backdrop-filter: blur(5px);
            `;
            bufferingOverlay.innerHTML = `
                <div style="margin-bottom: 10px;">⏳ Buffering...</div>
                <div style="font-size: 14px; color: #aaa;">Seeking to ${Math.floor(targetTime / 60)}:${String(Math.floor(targetTime % 60)).padStart(2, '0')}</div>
                <div id="buffering-time" style="font-size: 24px; margin-top: 10px;">0s</div>
            `;
            document.body.appendChild(bufferingOverlay);
            
            // Update elapsed time every 100ms
            bufferingInterval = setInterval(() => {
                const elapsed = ((Date.now() - bufferingStartTime) / 1000).toFixed(1);
                const timeEl = document.getElementById('buffering-time');
                if (timeEl) timeEl.textContent = `${elapsed}s`;
            }, 100);
        };
        
        const hideBufferingIndicator = () => {
            if (bufferingInterval) {
                clearInterval(bufferingInterval);
                bufferingInterval = null;
            }
            if (bufferingOverlay) {
                bufferingOverlay.remove();
                bufferingOverlay = null;
                bufferingStartTime = null;
            }
        };
        
        // Show buffering when waiting for data
        video.addEventListener('waiting', () => {
            console.log('VIDEO EVENT: waiting at', video.currentTime);
            showBufferingIndicator(video.currentTime);
        });
        
        video.addEventListener('seeking', () => {
            console.log('VIDEO EVENT: seeking to', video.currentTime);
            showBufferingIndicator(video.currentTime);
        });
        
        video.addEventListener('stalled', () => {
            console.log('VIDEO EVENT: stalled at', video.currentTime);
            showBufferingIndicator(video.currentTime);
        });
        
        // Hide buffering when playback resumes
        video.addEventListener('playing', () => {
            console.log('VIDEO EVENT: playing at', video.currentTime);
            hideBufferingIndicator();
        });
        
        video.addEventListener('seeked', () => {
            console.log('VIDEO EVENT: seeked to', video.currentTime, 'readyState:', video.readyState);
            // Small delay to check if we're actually playing or still buffering
            setTimeout(() => {
                if (!video.paused && video.readyState >= 3) {
                    hideBufferingIndicator();
                }
            }, 100);
        });
        
        video.addEventListener('canplaythrough', () => {
            console.log('VIDEO EVENT: canplaythrough');
            hideBufferingIndicator();
        });
        
        // Also hide on pause (user intentionally paused)
        video.addEventListener('pause', () => {
            console.log('VIDEO EVENT: pause, readyState:', video.readyState);
            // Only hide if we were buffering, not if user paused
            if (bufferingOverlay && video.readyState >= 3) {
                hideBufferingIndicator();
            }
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
            
            // Add click handlers after video is ready to play
            this.setupVideoClickHandlers(video, fileName);
        });
        
        // Try multiple event approaches for maximum compatibility
        console.log('Adding ALL click handlers for:', fileName);
        
        // Approach 1: Direct click with various phases
        video.addEventListener('click', (e) => {
            console.log('CLICK: Video click detected on', fileName);
            e.stopPropagation();
            setTimeout(() => {
                console.log('CLICK: Executing video action');
                this.togglePlayAndFullscreen(video);
            }, 200);
        }, false);
        
        // Approach 2: Pointer events (modern approach)
        video.addEventListener('pointerup', (e) => {
            if (e.button === 0) { // Left click
                console.log('POINTER: Video pointer up on', fileName);
                setTimeout(() => {
                    console.log('POINTER: Executing video action');
                    this.togglePlayAndFullscreen(video);
                }, 150);
            }
        });
        
        // Approach 3: Touch events for mobile
        video.addEventListener('touchend', (e) => {
            console.log('TOUCH: Video touch end on', fileName);
            e.preventDefault();
            setTimeout(() => {
                console.log('TOUCH: Executing video action');
                this.togglePlayAndFullscreen(video);
            }, 100);
        });
        
        // Create simple clickable overlay for video
        const videoWrapper = document.createElement('div');
        videoWrapper.style.position = 'relative';
        videoWrapper.style.display = 'inline-block';
        videoWrapper.style.width = '100%';
        
        const clickOverlay = document.createElement('div');
        clickOverlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 2;
            cursor: pointer;
            background: transparent;
        `;
        
        clickOverlay.addEventListener('click', (e) => {
            console.log('OVERLAY CLICK: Simulating spacebar press');
            
            // Create and dispatch a fake spacebar keydown event
            const spaceEvent = new KeyboardEvent('keydown', {
                code: 'Space',
                key: ' ',
                keyCode: 32,
                which: 32,
                bubbles: true,
                cancelable: true
            });
            
            document.dispatchEvent(spaceEvent);
        });
        
        videoWrapper.appendChild(video);
        videoWrapper.appendChild(clickOverlay);
        contentOther.appendChild(videoWrapper);
        contentOther.appendChild(errorDiv);
        
        // Add subtitle selector UI
        if (!isArchiveVideo) {
            const subtitleControls = this.createSubtitleControls(video, filePath, fileName);
            contentOther.appendChild(subtitleControls);
        }
        
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
            } else if (e.key === 's' || e.key === 'S') {
                e.preventDefault();
                this.showSubtitleSearchDialog();
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
    
    setupVideoClickHandlers(video, fileName) {
        // Prevent multiple click handlers on the same video
        if (video.hasAttribute('data-click-handlers-added')) {
            return;
        }
        video.setAttribute('data-click-handlers-added', 'true');
        
        console.log('Adding video click handlers for:', fileName);
        
        // Try a timeout-based approach to let the browser handle its stuff first
        let clickTimeout = null;
        
        video.addEventListener('click', (e) => {
            console.log('Video click detected');
            
            // Clear any existing timeout
            if (clickTimeout) {
                clearTimeout(clickTimeout);
            }
            
            // Set a small delay to let browser controls handle first
            clickTimeout = setTimeout(() => {
                console.log('Executing delayed video click action');
                this.togglePlayAndFullscreen(video);
            }, 50); // Very short delay
        });
        
        // Also try the mousedown approach 
        video.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // Left mouse button
                console.log('Video mousedown - will toggle in 100ms');
                setTimeout(() => {
                    console.log('Executing mousedown video action');
                    this.togglePlayAndFullscreen(video);
                }, 100);
            }
        });
        
        // Keep double-click as reliable backup
        video.addEventListener('dblclick', (e) => {
            console.log('Video double-click triggered');
            e.preventDefault();
            this.togglePlayAndFullscreen(video);
        });
    }
    
    seekVideo(video, seconds) {
        // Allow seeking anywhere in the video - the browser will make Range requests as needed
        if (video.duration && !isNaN(video.duration)) {
            
            const oldTime = video.currentTime;
            const newTime = seconds > 0 
                ? Math.min(oldTime + seconds, video.duration)
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
        const videoExtensions = ['mp4', 'avi', 'mov', 'mkv', 'webm', 'mpg', 'mpeg', 'wmv', 'm4v', 'flv', '3gp', 'ts', 'mts', 'm2ts'];
        
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
        const videoExtensions = ['mp4', 'avi', 'mov', 'mkv', 'webm', 'mpg', 'mpeg', 'wmv', 'm4v', 'flv', '3gp', 'ts', 'mts', 'm2ts'];
        
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
            const response = await window.authManager.authenticatedFetch('/api/annotations');
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
            <div style="font-size: 10px; color: #999; margin-top: 4px;">Press 1-5 for stars, R/G/Y/B for colors, C for comment, S for subtitles</div>
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
            const response = await window.authManager.authenticatedFetch('/api/annotations');
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
            const response = await window.authManager.authenticatedFetch('/api/annotations', {
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
                
                // DON'T refresh file list - it causes jumping back to first file
                // Just update the current file's annotation display in the file list
                if (window.fileExplorer && window.fileExplorer.updateFileAnnotationDisplay) {
                    window.fileExplorer.updateFileAnnotationDisplay(filePath, annotation);
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
    
    async loadSubtitles(video, videoPath, videoFileName) {
        // Get base path without file extension
        const basePath = videoPath.substring(0, videoPath.lastIndexOf('.'));
        const baseFileName = videoFileName.substring(0, videoFileName.lastIndexOf('.'));
        
        // Try common subtitle naming patterns
        const subtitleExtensions = ['.srt', '.vtt'];
        const subtitlePatterns = [
            basePath,  // same name as video
            `${basePath}.en`,  // with language code
            `${basePath}.eng`,
            `${basePath}.english`
        ];
        
        for (const pattern of subtitlePatterns) {
            for (const ext of subtitleExtensions) {
                const subtitlePath = pattern + ext;
                const subtitleFileName = subtitlePath.split('/').pop();
                
                try {
                    // Try to fetch the subtitle file to see if it exists
                    const response = await window.authManager.authenticatedFetch(
                        `/subtitle?path=${encodeURIComponent(subtitlePath)}`
                    );
                    
                    if (response.ok) {
                        console.log(`Found subtitle file: ${subtitleFileName}`);
                        
                        // Create a track element
                        const track = document.createElement('track');
                        track.kind = 'subtitles';
                        track.label = this.getSubtitleLabel(subtitleFileName);
                        track.srclang = this.detectLanguage(subtitleFileName);
                        track.src = `/subtitle?path=${encodeURIComponent(subtitlePath)}`;
                        track.default = true; // Make this the default subtitle track
                        
                        video.appendChild(track);
                        
                        console.log(`Added subtitle track: ${subtitleFileName} (${track.srclang})`);
                        
                        // Show a subtle notification
                        this.showSubtitleNotification(`Subtitles loaded: ${subtitleFileName}`);
                        
                        // Stop after finding the first subtitle file
                        return;
                    }
                } catch (error) {
                    // File doesn't exist or error fetching, continue trying other patterns
                    console.debug(`Subtitle not found: ${subtitleFileName}`);
                }
            }
        }
        
        console.log('No subtitle files found for video');
    }
    
    async discoverSubtitles(videoPath, videoFileName) {
        // Get directory path from video path
        const lastSlash = videoPath.lastIndexOf('/');
        const directoryPath = lastSlash > 0 ? videoPath.substring(0, lastSlash) : '';

        try {
            // Fetch directory listing
            const response = await window.authManager.authenticatedFetch(
                `/files/list?path=${encodeURIComponent(directoryPath)}`
            );

            if (!response.ok) {
                console.log('Could not fetch directory listing for subtitle discovery');
                return;
            }

            const data = await response.json();

            // Get ALL subtitle files in the directory (no filtering by video name)
            this.availableSubtitles = (data.files || [])
                .filter(file => {
                    const name = file.name.toLowerCase();
                    const hasSubtitleExt = name.endsWith('.srt') || name.endsWith('.vtt');
                    return hasSubtitleExt && !file.isDirectory;
                })
                .map(file => ({
                    name: file.name,
                    path: directoryPath ? `${directoryPath}/${file.name}` : file.name
                }));

            console.log(`Found ${this.availableSubtitles.length} subtitle files in directory`);
        } catch (error) {
            console.error('Error discovering subtitles:', error);
            this.availableSubtitles = [];
        }
    }
    
    showSubtitleSearchDialog() {
        if (!this.currentVideo) {
            console.log('No video element available');
            return;
        }
        
        if (this.availableSubtitles.length === 0) {
            this.showSubtitleNotification('No subtitle files found in this directory');
            return;
        }
        
        // Create modal dialog
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10001;
            backdrop-filter: blur(5px);
        `;
        
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: rgba(30, 30, 30, 0.95);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 10px;
            padding: 25px;
            max-width: 600px;
            width: 90%;
            max-height: 80vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        `;
        
        const title = document.createElement('h3');
        title.textContent = '💬 Select Subtitle File';
        title.style.cssText = `
            margin: 0 0 15px 0;
            color: #fff;
            font-size: 18px;
        `;
        
        const searchBox = document.createElement('input');
        searchBox.type = 'text';
        searchBox.placeholder = 'Type to filter subtitles...';
        searchBox.style.cssText = `
            width: 100%;
            padding: 10px;
            margin-bottom: 15px;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 5px;
            color: #fff;
            font-size: 14px;
            box-sizing: border-box;
        `;
        
        const listContainer = document.createElement('div');
        listContainer.style.cssText = `
            flex: 1;
            overflow-y: auto;
            margin-bottom: 15px;
        `;
        
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `
            display: flex;
            gap: 10px;
            justify-content: flex-end;
        `;
        
        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel (Esc)';
        cancelButton.style.cssText = `
            padding: 8px 16px;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: #fff;
            border-radius: 5px;
            cursor: pointer;
            font-size: 13px;
        `;
        
        const renderList = (filter = '') => {
            listContainer.innerHTML = '';
            
            const filtered = this.availableSubtitles.filter(sub => 
                sub.name.toLowerCase().includes(filter.toLowerCase())
            );
            
            if (filtered.length === 0) {
                const noResults = document.createElement('div');
                noResults.textContent = 'No matching subtitles found';
                noResults.style.cssText = `
                    color: #999;
                    padding: 20px;
                    text-align: center;
                `;
                listContainer.appendChild(noResults);
                return;
            }
            
            filtered.forEach((subtitle, index) => {
                const item = document.createElement('div');
                item.textContent = subtitle.name;
                item.style.cssText = `
                    padding: 12px 15px;
                    margin-bottom: 5px;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 5px;
                    color: #fff;
                    cursor: pointer;
                    transition: all 0.2s;
                `;
                
                item.addEventListener('mouseenter', () => {
                    item.style.background = 'rgba(76, 175, 80, 0.3)';
                    item.style.borderColor = 'rgba(76, 175, 80, 0.5)';
                });
                
                item.addEventListener('mouseleave', () => {
                    item.style.background = 'rgba(255, 255, 255, 0.05)';
                    item.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                });
                
                item.addEventListener('click', async () => {
                    await this.loadSubtitleFile(subtitle.path, subtitle.name);
                    modal.remove();
                });
                
                listContainer.appendChild(item);
            });
        };
        
        // Initial render
        renderList();
        
        // Search functionality
        searchBox.addEventListener('input', (e) => {
            renderList(e.target.value);
        });
        
        // Close on cancel
        cancelButton.addEventListener('click', () => {
            modal.remove();
        });
        
        // Close on Escape
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                modal.remove();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
        
        // Close on background click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
        buttonContainer.appendChild(cancelButton);
        
        dialog.appendChild(title);
        dialog.appendChild(searchBox);
        dialog.appendChild(listContainer);
        dialog.appendChild(buttonContainer);
        
        modal.appendChild(dialog);
        document.body.appendChild(modal);
        
        // Focus search box
        setTimeout(() => searchBox.focus(), 100);
    }
    
    async loadSubtitleFile(subtitlePath, subtitleName) {
        if (!this.currentVideo) {
            console.error('No video element available');
            return;
        }
        
        try {
            // Fetch the subtitle file
            const response = await window.authManager.authenticatedFetch(
                `/subtitle?path=${encodeURIComponent(subtitlePath)}`
            );
            
            if (!response.ok) {
                throw new Error(`Failed to load subtitle: ${response.statusText}`);
            }
            
            // Remove existing subtitle tracks
            const existingTracks = this.currentVideo.querySelectorAll('track');
            existingTracks.forEach(track => track.remove());
            
            // Create new track element
            const track = document.createElement('track');
            track.kind = 'subtitles';
            track.label = this.getSubtitleLabel(subtitleName);
            track.srclang = this.detectLanguage(subtitleName);
            track.src = `/subtitle?path=${encodeURIComponent(subtitlePath)}`;
            track.default = true;
            
            this.currentVideo.appendChild(track);
            
            // Enable the track
            setTimeout(() => {
                if (this.currentVideo.textTracks.length > 0) {
                    this.currentVideo.textTracks[0].mode = 'showing';
                }
            }, 100);
            
            console.log(`Loaded subtitle: ${subtitleName}`);
            this.showSubtitleNotification(`Subtitle loaded: ${subtitleName}`);
            
        } catch (error) {
            console.error('Error loading subtitle file:', error);
            this.showSubtitleNotification(`Error loading subtitle: ${error.message}`);
        }
    }
    
    getSubtitleLabel(filename) {
        // Extract language from filename if present
        const lowerName = filename.toLowerCase();
        if (lowerName.includes('.en.') || lowerName.includes('.eng.') || lowerName.includes('.english.')) {
            return 'English';
        }
        if (lowerName.includes('.it.') || lowerName.includes('.ita.') || lowerName.includes('.italian.')) {
            return 'Italian';
        }
        if (lowerName.includes('.es.') || lowerName.includes('.spa.') || lowerName.includes('.spanish.')) {
            return 'Spanish';
        }
        if (lowerName.includes('.fr.') || lowerName.includes('.fra.') || lowerName.includes('.french.')) {
            return 'French';
        }
        if (lowerName.includes('.de.') || lowerName.includes('.ger.') || lowerName.includes('.german.')) {
            return 'German';
        }
        return 'Subtitles';
    }
    
    detectLanguage(filename) {
        // Detect language code from filename
        const lowerName = filename.toLowerCase();
        if (lowerName.includes('.en.') || lowerName.includes('.eng.') || lowerName.includes('.english.')) {
            return 'en';
        }
        if (lowerName.includes('.it.') || lowerName.includes('.ita.') || lowerName.includes('.italian.')) {
            return 'it';
        }
        if (lowerName.includes('.es.') || lowerName.includes('.spa.') || lowerName.includes('.spanish.')) {
            return 'es';
        }
        if (lowerName.includes('.fr.') || lowerName.includes('.fra.') || lowerName.includes('.french.')) {
            return 'fr';
        }
        if (lowerName.includes('.de.') || lowerName.includes('.ger.') || lowerName.includes('.german.')) {
            return 'de';
        }
        return 'en'; // Default to English
    }
    
    showSubtitleNotification(message) {
        const notification = document.createElement('div');
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            background: rgba(76, 175, 80, 0.9);
            color: white;
            padding: 10px 15px;
            border-radius: 5px;
            font-size: 14px;
            z-index: 10000;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            backdrop-filter: blur(10px);
        `;
        
        document.body.appendChild(notification);
        
        // Fade out after 3 seconds
        setTimeout(() => {
            notification.style.transition = 'opacity 0.5s';
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 500);
        }, 3000);
    }
    
    createSubtitleControls(video, videoPath, videoFileName) {
        const container = document.createElement('div');
        container.style.cssText = `
            margin-top: 15px;
            padding: 15px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.1);
        `;
        
        const title = document.createElement('div');
        title.textContent = '💬 Subtitles';
        title.style.cssText = `
            font-weight: bold;
            margin-bottom: 10px;
            color: #fff;
            font-size: 14px;
        `;
        container.appendChild(title);
        
        const info = document.createElement('div');
        info.style.cssText = `
            font-size: 12px;
            color: #999;
            margin-bottom: 10px;
        `;
        info.textContent = 'Subtitles are auto-loaded if found. Press "S" or click the button to select from available subtitles:';
        container.appendChild(info);

        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; gap: 10px; align-items: center;';

        const selectButton = document.createElement('button');
        selectButton.textContent = 'Select Subtitle (S)';
        selectButton.style.cssText = `
            padding: 8px 16px;
            background: rgba(76, 175, 80, 0.2);
            border: 1px solid rgba(76, 175, 80, 0.5);
            color: #4caf50;
            border-radius: 5px;
            cursor: pointer;
            font-size: 13px;
            transition: all 0.3s;
        `;

        selectButton.addEventListener('mouseenter', () => {
            selectButton.style.background = 'rgba(76, 175, 80, 0.3)';
        });

        selectButton.addEventListener('mouseleave', () => {
            selectButton.style.background = 'rgba(76, 175, 80, 0.2)';
        });

        selectButton.addEventListener('click', () => {
            this.showSubtitleSearchDialog();
        });
        
        buttonContainer.appendChild(selectButton);
        container.appendChild(buttonContainer);
        
        return container;
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
        
        // Remove any buffering overlay
        const bufferingOverlay = document.getElementById('video-buffering-overlay');
        if (bufferingOverlay) {
            bufferingOverlay.remove();
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