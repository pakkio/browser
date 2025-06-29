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
        
        // Check if this is an AVI file that needs transcoding
        const isAVI = fileName.toLowerCase().endsWith('.avi');
        
        if (isAVI) {
            // Use transcoding endpoint for AVI files
            video.src = `/video-transcode?path=${encodeURIComponent(filePath)}`;
            
            // Add loading indicator for transcoding
            const loadingDiv = document.createElement('div');
            loadingDiv.style.color = '#666';
            loadingDiv.style.marginBottom = '10px';
            loadingDiv.innerHTML = '🔄 Transcoding AVI file for playback...';
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
                ${isAVI ? '<br><small>Try refreshing if transcoding failed</small>' : ''}
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
            }
        };
        
        document.addEventListener('keydown', this.handleKeyDown);
        
        // Add mouse wheel handler for fast forward/backward
        this.handleWheel = (e) => {
            // Only handle wheel events when mouse is over the video
            if (e.target === video || video.contains(e.target)) {
                e.preventDefault();
                const skipAmount = 10; // seconds to skip
                
                // Ensure video is loaded and has duration
                if (video.duration && !isNaN(video.duration)) {
                    if (e.deltaY < 0) {
                        // Wheel up - fast forward
                        video.currentTime = Math.min(video.currentTime + skipAmount, video.duration);
                    } else {
                        // Wheel down - rewind
                        video.currentTime = Math.max(video.currentTime - skipAmount, 0);
                    }
                }
            }
        };
        
        video.addEventListener('wheel', this.handleWheel);
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