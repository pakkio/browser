class AudioRenderer {
    async render(filePath, fileName, contentCode, contentOther) {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = `/files?path=${encodeURIComponent(filePath)}`;
        contentOther.appendChild(audio);
        contentOther.style.display = 'block';
    }
}

class VideoRenderer {
    constructor() {
        this.handleKeyDown = null;
        this.handleWheel = null;
    }

    async render(filePath, fileName, contentCode, contentOther) {
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
        });
        
        contentOther.appendChild(video);
        contentOther.appendChild(errorDiv);
        contentOther.style.display = 'block';
        
        // Add keyboard handler for spacebar fullscreen toggle and play/pause
        this.handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }
            
            if (e.code === 'Space') {
                e.preventDefault();
                this.togglePlayAndFullscreen(video);
            } else if (e.code === 'PageUp' || e.code === 'PageDown') {
                e.preventDefault();
                this.seekVideo(video, e.code === 'PageUp' ? -10 : 10);
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