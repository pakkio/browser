console.log('FileRenderer type:', typeof FileRenderer);

// Show a modal with all keyboard shortcuts
function showShortcutHelpPopup() {
    // Remove any existing help popup
    const existing = document.getElementById('shortcut-help-popup');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'shortcut-help-popup';
    backdrop.style.cssText = `
        position: fixed;
        top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0,0,0,0.5);
        z-index: 2000;
        display: flex; align-items: center; justify-content: center;
    `;
    const modal = document.createElement('div');
    modal.style.cssText = `
        background: #23272e;
        color: #d4d4d4;
        border-radius: 10px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.4);
        padding: 32px 28px 24px 28px;
        min-width: 340px;
        max-width: 90vw;
        font-size: 1rem;
        border: 1px solid #444;
        position: relative;
    `;
    modal.innerHTML = `
        <h2 style="margin-top:0;color:#00aacc;font-size:1.3rem;">Keyboard Shortcuts</h2>
        <table style="width:100%;margin:18px 0 0 0;font-size:1rem;border-collapse:collapse;">
            <tr><td style="padding:4px 12px 4px 0;">1–5</td><td>Set star rating</td></tr>
            <tr><td style="padding:4px 12px 4px 0;">b</td><td>Set color: Blue</td></tr>
            <tr><td style="padding:4px 12px 4px 0;">r</td><td>Set color: Red</td></tr>
            <tr><td style="padding:4px 12px 4px 0;">g</td><td>Set color: Green</td></tr>
            <tr><td style="padding:4px 12px 4px 0;">w</td><td>Set color: White</td></tr>
            <tr><td style="padding:4px 12px 4px 0;">l</td><td>Set color: Black</td></tr>
            <tr><td style="padding:4px 12px 4px 0;">o</td><td>Set color: Orange</td></tr>
            <tr><td style="padding:4px 12px 4px 0;">p</td><td>Set color: Purple</td></tr>
            <tr><td style="padding:4px 12px 4px 0;">y</td><td>Set color: Yellow</td></tr>
            <tr><td style="padding:4px 12px 4px 0;">s</td><td>Clear color label</td></tr>
            <tr><td style="padding:4px 12px 4px 0;">c</td><td>Add/edit comment</td></tr>
            <tr><td style="padding:4px 12px 4px 0;">?</td><td>Show this help</td></tr>
            <tr><td style="padding:4px 12px 4px 0;">Arrow keys</td><td>Navigate file list</td></tr>
            <tr><td style="padding:4px 12px 4px 0;">Enter</td><td>Open selected file</td></tr>
            <tr><td style="padding:4px 12px 4px 0;">/</td><td>Focus search</td></tr>
        </table>
        <button id="close-shortcut-help" style="position:absolute;top:12px;right:16px;background:#444;border:none;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:1.1rem;">×</button>
        <div style="margin-top:18px;font-size:0.95rem;color:#aaa;">Press <b>Esc</b> or click outside to close</div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    // Close logic
    function close() { backdrop.remove(); }
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
    modal.querySelector('#close-shortcut-help').addEventListener('click', close);
    document.addEventListener('keydown', function escListener(ev) {
        if (ev.key === 'Escape') {
            close();
            document.removeEventListener('keydown', escListener);
        }
    });
}

// Context menu functionality
function showContextMenu(x, y, filePath, fileName, isDirectory) {
    // Remove any existing context menu
    const existing = document.getElementById('context-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'context-menu';
    menu.style.cssText = `
        position: fixed;
        top: ${y}px;
        left: ${x}px;
        background: #2a2a2a;
        border: 1px solid #444;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 1000;
        min-width: 150px;
        font-size: 14px;
        color: #e0e0e0;
    `;

    // Check if file is a media file (video or audio)
    const extension = fileName.split('.').pop().toLowerCase();
    const isMediaFile = !isDirectory && (
        ['mp4', 'avi', 'mov', 'mkv', 'webm', 'mpg', 'mpeg', 'wmv', 'm4v', 'flv', '3gp', 'ts', 'mts', 'm2ts',
         'mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma'].includes(extension)
    );

    const menuItems = [];

    // Add "Open with native player" for media files
    if (isMediaFile) {
        menuItems.push({
            text: 'Open with Native Player',
            icon: '▶️',
            action: () => {
                window.authManager.authenticatedFetch('/api/open-file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePath })
                })
                .then(response => {
                    if (!response) return;
                    if (!response.ok) {
                        return response.text().then(text => {
                            throw new Error(text || 'Failed to open file');
                        });
                    }
                    console.log('Opened file with native player:', fileName);
                })
                .catch(error => {
                    console.error('Error opening file:', error);
                    alert('Failed to open file: ' + error.message);
                });
            }
        });
    }

    // Always add rename and delete
    menuItems.push(
        {
            text: `Rename ${isDirectory ? 'Folder' : 'File'}`,
            icon: '✏️',
            action: () => renameFile(filePath, fileName)
        },
        {
            text: `Move ${isDirectory ? 'Folder' : 'File'}`,
            icon: '📁',
            action: () => moveFile(filePath, fileName, isDirectory)
        },
        {
            text: `Delete ${isDirectory ? 'Folder' : 'File'}`,
            icon: '🗑️',
            action: () => deleteFile(filePath, fileName, isDirectory)
        }
    );

    menuItems.forEach((item, index) => {
        const menuItem = document.createElement('div');
        menuItem.style.cssText = `
            padding: 8px 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            border-bottom: ${index < menuItems.length - 1 ? '1px solid #444' : 'none'};
        `;
        menuItem.innerHTML = `<span>${item.icon}</span><span>${item.text}</span>`;
        
        menuItem.addEventListener('mouseenter', () => {
            menuItem.style.background = '#444';
        });
        menuItem.addEventListener('mouseleave', () => {
            menuItem.style.background = 'transparent';
        });
        menuItem.addEventListener('click', () => {
            menu.remove();
            item.action();
        });
        
        menu.appendChild(menuItem);
    });

    document.body.appendChild(menu);

    // Adjust position if menu goes off screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        menu.style.left = (x - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
        menu.style.top = (y - rect.height) + 'px';
    }

    // Close menu when clicking elsewhere
    function closeMenu(e) {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }
    }
    setTimeout(() => document.addEventListener('click', closeMenu), 10);
}

// File operation functions
async function renameFile(filePath, currentName) {
    const newName = prompt(`Rename "${currentName}" to:`, currentName);
    if (!newName || newName === currentName) return;

    try {
        const response = await window.authManager.authenticatedFetch('/api/file/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                oldPath: filePath,
                newName: newName
            })
        });

        const result = await response.json();
        if (result.success) {
            // Clear current content view to avoid showing stale data
            if (window.fileExplorer && window.fileExplorer.clearContentView) {
                window.fileExplorer.clearContentView();
            }
            
            // Refresh the file list
            if (window.fileExplorer && window.fileExplorer.loadFiles) {
                window.fileExplorer.loadFiles(window.fileExplorer.currentPath());
            }
            
            // Refresh annotations cache
            if (window.annotationManager && window.annotationManager.loadAnnotations) {
                window.annotationManager.loadAnnotations();
            }
            
            showToast(`Successfully renamed to "${newName}"`, 'success');
        } else {
            showToast(`Failed to rename: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Error renaming file:', error);
        showToast(`Error renaming file: ${error.message}`, 'error');
    }
}

async function deleteFile(filePath, fileName, isDirectory) {
    const fileType = isDirectory ? 'folder' : 'file';
    if (!confirm(`Are you sure you want to delete the ${fileType} "${fileName}"?\n\nThis action cannot be undone.`)) {
        return;
    }

    try {
        const response = await window.authManager.authenticatedFetch('/api/file', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filePath })
        });

        const result = await response.json();
        if (result.success) {
            // Clear current content view to avoid showing deleted file
            if (window.fileExplorer && window.fileExplorer.clearContentView) {
                window.fileExplorer.clearContentView();
            }
            
            // Refresh the file list
            if (window.fileExplorer && window.fileExplorer.loadFiles) {
                window.fileExplorer.loadFiles(window.fileExplorer.currentPath());
            }
            
            // Refresh annotations cache
            if (window.annotationManager && window.annotationManager.loadAnnotations) {
                window.annotationManager.loadAnnotations();
            }
            
            showToast(`Successfully deleted "${fileName}"`, 'success');
        } else {
            showToast(`Failed to delete: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Error deleting file:', error);
        showToast(`Error deleting file: ${error.message}`, 'error');
    }
}

// Recent folders management
const RECENT_FOLDERS_KEY = 'browser_recent_move_folders';
const RECENT_BROWSED_KEY = 'browser_recent_browsed_folders';
const MAX_RECENT_FOLDERS = 10;
const MAX_QUICK_FOLDERS = 5;

function getRecentFolders() {
    try {
        const stored = localStorage.getItem(RECENT_FOLDERS_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

function addRecentFolder(folderPath) {
    let recent = getRecentFolders();
    // Remove if already exists
    recent = recent.filter(f => f !== folderPath);
    // Add to front
    recent.unshift(folderPath);
    // Keep only last N
    recent = recent.slice(0, MAX_RECENT_FOLDERS);
    localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(recent));
}

// Browsed folders tracking (folders user has navigated to in file explorer)
function getRecentBrowsedFolders() {
    try {
        const stored = localStorage.getItem(RECENT_BROWSED_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

function addRecentBrowsedFolder(folderPath) {
    let recent = getRecentBrowsedFolders();
    // Remove if already exists
    recent = recent.filter(f => f !== folderPath);
    // Add to front
    recent.unshift(folderPath);
    // Keep only last N
    recent = recent.slice(0, MAX_RECENT_FOLDERS);
    localStorage.setItem(RECENT_BROWSED_KEY, JSON.stringify(recent));
}

// Move file function with folder picker dialog
async function moveFile(filePath, fileName, isDirectory) {
    const fileType = isDirectory ? 'folder' : 'file';
    const currentDir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
    
    // Create modal backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'move-modal-backdrop';
    backdrop.style.cssText = `
        position: fixed;
        top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0,0,0,0.6);
        z-index: 2000;
        display: flex; align-items: center; justify-content: center;
    `;
    
    const modal = document.createElement('div');
    modal.className = 'move-modal';
    modal.style.cssText = `
        background: #23272e;
        color: #d4d4d4;
        border-radius: 10px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.4);
        padding: 20px;
        min-width: 400px;
        max-width: 600px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        border: 1px solid #444;
    `;
    
    modal.innerHTML = `
        <h3 style="margin: 0 0 15px 0; color: #00aacc;">Move "${fileName}"</h3>
        
        <div style="margin-bottom: 10px;">
            <label style="font-size: 12px; color: #888;">Current location:</label>
            <div style="font-size: 13px; color: #aaa; padding: 5px; background: #1a1a1a; border-radius: 4px;">
                ${currentDir || '/ (root)'}
            </div>
        </div>
        
        <div id="quick-folders-section" style="margin-bottom: 12px;">
            <label style="font-size: 12px; color: #888;">Quick move to:</label>
            <div id="quick-folders-list" style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 5px;"></div>
        </div>
        
        <div style="margin-bottom: 10px;">
            <label style="font-size: 12px; color: #888;">Search folders:</label>
            <input type="text" id="folder-search-input" placeholder="Type to search folders..." style="
                width: 100%;
                padding: 8px;
                background: #1a1a1a;
                border: 1px solid #444;
                border-radius: 4px;
                color: #d4d4d4;
                font-size: 14px;
                box-sizing: border-box;
            ">
        </div>
        
        <div id="recent-folders-section" style="margin-bottom: 10px; display: none;">
            <label style="font-size: 12px; color: #888;">Recent move targets:</label>
            <div id="recent-folders-list" style="max-height: 80px; overflow-y: auto;"></div>
        </div>
        
        <div style="margin-bottom: 10px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 5px;">
                <label style="font-size: 12px; color: #888;">Browse folders:</label>
                <span id="browse-path" style="font-size: 11px; color: #666;"></span>
            </div>
            <div id="folder-browser" style="
                height: 200px;
                overflow-y: auto;
                background: #1a1a1a;
                border: 1px solid #444;
                border-radius: 4px;
                padding: 5px;
            "></div>
        </div>
        
        <div style="margin-bottom: 15px;">
            <label style="font-size: 12px; color: #888;">Target folder:</label>
            <div id="selected-target" style="
                padding: 8px;
                background: #2a4a2a;
                border: 1px solid #4a4;
                border-radius: 4px;
                font-size: 13px;
                min-height: 20px;
            ">/ (root)</div>
        </div>
        
        <div style="display: flex; gap: 10px; justify-content: flex-end;">
            <button id="move-cancel-btn" style="
                padding: 8px 16px;
                background: rgba(255,255,255,0.1);
                border: 1px solid #555;
                color: #d4d4d4;
                border-radius: 4px;
                cursor: pointer;
            ">Cancel</button>
            <button id="move-confirm-btn" style="
                padding: 8px 16px;
                background: #2196F3;
                border: none;
                color: white;
                border-radius: 4px;
                cursor: pointer;
            ">Move Here</button>
        </div>
    `;
    
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    
    let selectedPath = '';
    let browsePath = currentDir;
    
    const folderBrowser = modal.querySelector('#folder-browser');
    const selectedTarget = modal.querySelector('#selected-target');
    const browsPathDisplay = modal.querySelector('#browse-path');
    const searchInput = modal.querySelector('#folder-search-input');
    const recentSection = modal.querySelector('#recent-folders-section');
    const recentList = modal.querySelector('#recent-folders-list');
    const quickFoldersList = modal.querySelector('#quick-folders-list');
    
    // Render quick access folders (last 5 browsed folders)
    function renderQuickFolders() {
        const browsed = getRecentBrowsedFolders().slice(0, MAX_QUICK_FOLDERS);
        const moveTargets = getRecentFolders().slice(0, 3);
        
        // Combine and deduplicate, prioritizing browsed folders
        const allFolders = [...browsed];
        moveTargets.forEach(f => {
            if (!allFolders.includes(f)) allFolders.push(f);
        });
        const quickFolders = allFolders.slice(0, MAX_QUICK_FOLDERS);
        
        if (quickFolders.length === 0) {
            quickFoldersList.innerHTML = '<span style="color: #666; font-size: 12px;">No recent folders yet</span>';
            return;
        }
        
        quickFoldersList.innerHTML = quickFolders.map(folder => {
            const displayName = folder ? folder.split('/').pop() : 'root';
            const fullPath = folder || '/ (root)';
            return `
                <button class="quick-folder-btn" data-path="${folder}" title="${fullPath}" style="
                    padding: 6px 12px;
                    background: #3a3a4a;
                    border: 1px solid #555;
                    border-radius: 4px;
                    color: #d4d4d4;
                    cursor: pointer;
                    font-size: 12px;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    transition: all 0.2s;
                ">
                    <span style="color: #ffcc00;">📁</span>
                    <span>${displayName}</span>
                </button>
            `;
        }).join('');
        
        quickFoldersList.querySelectorAll('.quick-folder-btn').forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                btn.style.background = '#4a4a5a';
                btn.style.borderColor = '#2196F3';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.background = '#3a3a4a';
                btn.style.borderColor = '#555';
            });
            btn.addEventListener('click', () => {
                selectedPath = btn.dataset.path;
                selectedTarget.textContent = selectedPath || '/ (root)';
                browsePath = selectedPath;
                loadFolders(browsePath);
            });
        });
    }
    
    // Render recent folders (previous move targets)
    function renderRecentFolders() {
        const recent = getRecentFolders();
        if (recent.length === 0) {
            recentSection.style.display = 'none';
            return;
        }
        
        recentSection.style.display = 'block';
        recentList.innerHTML = recent.map(folder => `
            <div class="recent-folder-item" data-path="${folder}" style="
                padding: 6px 10px;
                cursor: pointer;
                border-radius: 4px;
                font-size: 13px;
                display: flex;
                align-items: center;
                gap: 8px;
            ">
                <span style="color: #ffcc00;">📁</span>
                <span>${folder || '/ (root)'}</span>
            </div>
        `).join('');
        
        recentList.querySelectorAll('.recent-folder-item').forEach(item => {
            item.addEventListener('mouseenter', () => item.style.background = '#333');
            item.addEventListener('mouseleave', () => item.style.background = 'transparent');
            item.addEventListener('click', () => {
                selectedPath = item.dataset.path;
                selectedTarget.textContent = selectedPath || '/ (root)';
                browsePath = selectedPath;
                loadFolders(browsePath);
            });
        });
    }
    
    // Load folders for browser
    async function loadFolders(path) {
        try {
            const response = await window.authManager.authenticatedFetch(`/api/directories?path=${encodeURIComponent(path)}`);
            const data = await response.json();
            
            browsPathDisplay.textContent = path || '/ (root)';
            
            let html = '';
            
            // Parent directory option
            if (data.parentPath !== null) {
                html += `
                    <div class="folder-item folder-parent" data-path="${data.parentPath}" data-action="navigate" style="
                        padding: 8px 10px;
                        cursor: pointer;
                        border-radius: 4px;
                        font-size: 13px;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        color: #888;
                    ">
                        <span>⬆️</span>
                        <span>.. (parent folder)</span>
                    </div>
                `;
            }
            
            // Current directory (select this folder)
            html += `
                <div class="folder-item folder-current" data-path="${path}" data-action="select" style="
                    padding: 8px 10px;
                    cursor: pointer;
                    border-radius: 4px;
                    font-size: 13px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    background: ${selectedPath === path ? '#2a4a2a' : 'transparent'};
                    border: 1px solid ${selectedPath === path ? '#4a4' : 'transparent'};
                ">
                    <span style="color: #4CAF50;">✓</span>
                    <span>Select this folder${path ? `: ${path.split('/').pop()}` : ': / (root)'}</span>
                </div>
            `;
            
            // Child directories
            data.directories.forEach(dir => {
                // Skip current file's directory if it's the same name (can't move into itself)
                if (isDirectory && dir.path === filePath) return;
                
                html += `
                    <div class="folder-item" data-path="${dir.path}" data-action="navigate" style="
                        padding: 8px 10px;
                        cursor: pointer;
                        border-radius: 4px;
                        font-size: 13px;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    ">
                        <span style="color: #ffcc00;">📁</span>
                        <span>${dir.name}</span>
                        <span style="margin-left: auto; color: #666;">→</span>
                    </div>
                `;
            });
            
            if (data.directories.length === 0 && data.parentPath === null) {
                html += `<div style="padding: 20px; text-align: center; color: #666;">No subfolders</div>`;
            }
            
            folderBrowser.innerHTML = html;
            
            // Add event listeners
            folderBrowser.querySelectorAll('.folder-item').forEach(item => {
                item.addEventListener('mouseenter', () => {
                    if (!item.classList.contains('folder-current') || selectedPath !== item.dataset.path) {
                        item.style.background = '#333';
                    }
                });
                item.addEventListener('mouseleave', () => {
                    if (item.classList.contains('folder-current') && selectedPath === item.dataset.path) {
                        item.style.background = '#2a4a2a';
                    } else {
                        item.style.background = 'transparent';
                    }
                });
                item.addEventListener('click', () => {
                    const action = item.dataset.action;
                    const path = item.dataset.path;
                    
                    if (action === 'navigate') {
                        browsePath = path;
                        loadFolders(path);
                    } else if (action === 'select') {
                        selectedPath = path;
                        selectedTarget.textContent = path || '/ (root)';
                        // Refresh to update selection styling
                        loadFolders(browsePath);
                    }
                });
                
                // Double-click to navigate into folder
                if (!item.classList.contains('folder-current') && !item.classList.contains('folder-parent')) {
                    item.addEventListener('dblclick', () => {
                        const path = item.dataset.path;
                        browsePath = path;
                        loadFolders(path);
                    });
                }
            });
            
        } catch (error) {
            console.error('Error loading folders:', error);
            folderBrowser.innerHTML = `<div style="padding: 20px; text-align: center; color: #f44;">Error loading folders</div>`;
        }
    }
    
    // Search functionality
    let searchTimeout;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(async () => {
            const query = searchInput.value.trim().toLowerCase();
            if (!query) {
                loadFolders(browsePath);
                return;
            }
            
            // Search through all directories recursively (simplified - just show matching from current view)
            try {
                const response = await window.authManager.authenticatedFetch(`/api/directories?path=`);
                const data = await response.json();
                
                // Filter directories that match
                const matches = data.directories.filter(dir => 
                    dir.name.toLowerCase().includes(query) ||
                    dir.path.toLowerCase().includes(query)
                );
                
                let html = matches.map(dir => `
                    <div class="folder-item" data-path="${dir.path}" data-action="select" style="
                        padding: 8px 10px;
                        cursor: pointer;
                        border-radius: 4px;
                        font-size: 13px;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    ">
                        <span style="color: #ffcc00;">📁</span>
                        <span>${dir.path}</span>
                    </div>
                `).join('');
                
                if (matches.length === 0) {
                    html = `<div style="padding: 20px; text-align: center; color: #666;">No folders match "${query}"</div>`;
                }
                
                folderBrowser.innerHTML = html;
                
                folderBrowser.querySelectorAll('.folder-item').forEach(item => {
                    item.addEventListener('mouseenter', () => item.style.background = '#333');
                    item.addEventListener('mouseleave', () => item.style.background = 'transparent');
                    item.addEventListener('click', () => {
                        selectedPath = item.dataset.path;
                        selectedTarget.textContent = selectedPath || '/ (root)';
                        searchInput.value = '';
                        browsePath = selectedPath;
                        loadFolders(browsePath);
                    });
                });
                
            } catch (error) {
                console.error('Error searching folders:', error);
            }
        }, 300);
    });
    
    // Initialize
    renderQuickFolders();
    renderRecentFolders();
    loadFolders(currentDir);
    
    // Close handlers
    function closeModal() {
        backdrop.remove();
    }
    
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal();
    });
    
    modal.querySelector('#move-cancel-btn').addEventListener('click', closeModal);
    
    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escHandler);
        }
    });
    
    // Move confirmation
    modal.querySelector('#move-confirm-btn').addEventListener('click', async () => {
        // Check if moving to same directory
        if (selectedPath === currentDir) {
            showToast('File is already in this directory', 'info');
            return;
        }
        
        try {
            const response = await window.authManager.authenticatedFetch('/api/file/move', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourcePath: filePath,
                    targetDir: selectedPath
                })
            });
            
            const result = await response.json();
            if (result.success) {
                // Add to recent folders
                addRecentFolder(selectedPath);
                
                closeModal();
                
                // Clear content view
                if (window.fileExplorer && window.fileExplorer.clearContentView) {
                    window.fileExplorer.clearContentView();
                }
                
                // Refresh the file list
                if (window.fileExplorer && window.fileExplorer.loadFiles) {
                    window.fileExplorer.loadFiles(window.fileExplorer.currentPath());
                }
                
                // Refresh annotations cache
                if (window.annotationManager && window.annotationManager.loadAnnotations) {
                    window.annotationManager.loadAnnotations();
                }
                
                showToast(`Successfully moved "${fileName}" to ${selectedPath || 'root'}`, 'success');
            } else {
                showToast(`Failed to move: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('Error moving file:', error);
            showToast(`Error moving file: ${error.message}`, 'error');
        }
    });
}

// Toast notification function
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'error' ? '#d32f2f' : type === 'success' ? '#388e3c' : '#1976d2'};
        color: white;
        padding: 12px 16px;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 2000;
        font-size: 14px;
        max-width: 300px;
        word-wrap: break-word;
    `;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    // Auto-remove after 4 seconds
    setTimeout(() => {
        if (toast.parentNode) {
            toast.remove();
        }
    }, 4000);
}

// Initialize the main application
function initializeApp() {
    console.log('Initializing main application...');
    
    // Make sure we're authenticated before proceeding
    if (!window.authManager?.authenticated) {
        console.warn('Attempted to initialize app without authentication');
        return;
    }

    initializeFileExplorer();
}

function initializeFileExplorer() {
    const fileList = document.getElementById('file-list');
    const contentCode = document.getElementById('content-code');
    const contentOther = document.getElementById('content-other');
    const fileDetails = document.getElementById('file-details');
    const fileTypeFilter = document.getElementById('file-type-filter');
    const searchInput = document.getElementById('search-input');
    const sortFieldSelect = document.getElementById('sort-field');
    const sortDirectionBtn = document.getElementById('sort-direction');
    let currentPath = '';
    let currentFiles = [];
    let filteredFiles = [];
    let selectedIndex = -1;
    let serverRootDir = '';  // Will be fetched from server
    let sortField = 'name';  // name, date, size, type
    let sortAscending = true;  // true = ascending, false = descending
    const fileRenderer = new FileRenderer();

    function matchesSearchTerms(filename, searchTerms) {
        if (!searchTerms || searchTerms.length === 0) return true;
        
        const lowerFilename = filename.toLowerCase();
        return searchTerms.every(term => lowerFilename.includes(term.toLowerCase()));
    }

    function parseSearchQuery(query) {
        return query.trim().split(/\s+/).filter(term => term.length > 0);
    }

    function sortFiles(files) {
        // Separate directories and files
        const directories = files.filter(f => f.isDirectory);
        const regularFiles = files.filter(f => !f.isDirectory);

        // Sort function based on current sort field
        const compareFn = (a, b) => {
            let comparison = 0;

            switch(sortField) {
                case 'name':
                    comparison = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
                    break;
                case 'date':
                    const dateA = a.modified ? new Date(a.modified).getTime() : 0;
                    const dateB = b.modified ? new Date(b.modified).getTime() : 0;
                    comparison = dateA - dateB;
                    break;
                case 'size':
                    const sizeA = a.size || 0;
                    const sizeB = b.size || 0;
                    comparison = sizeA - sizeB;
                    break;
                case 'type':
                    const extA = a.name.split('.').pop().toLowerCase();
                    const extB = b.name.split('.').pop().toLowerCase();
                    comparison = extA.localeCompare(extB);
                    // If extensions are the same, sort by name
                    if (comparison === 0) {
                        comparison = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
                    }
                    break;
            }

            return sortAscending ? comparison : -comparison;
        };

        // Sort directories and files separately
        directories.sort(compareFn);
        regularFiles.sort(compareFn);

        // Return directories first, then files
        return [...directories, ...regularFiles];
    }

    function loadFiles(path) {
        console.log('Loading files for path:', path);
        
        // Stop any playing media before loading new content
        clearContentView();
        
        // Track browsed folder for quick move access
        addRecentBrowsedFolder(path);
        
        // Save current path to session
        fetch('/api/current-path', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: path })
        }).catch(err => console.warn('Failed to save current path:', err));
        
        // Show prominent loading popup
        if (window.debugConsole) {
            window.debugConsole.showProgress('Loading directory...', 10);
        }
        
        // Clear current file list
        fileList.innerHTML = '<li style="color: #666;">Loading...</li>';
        
        window.authManager.authenticatedFetch(`/api/browse?path=${encodeURIComponent(path)}`)
            .then(response => {
                if (!response) {
                    // Authentication failed, handled by authManager
                    return;
                }
                console.log('Response status:', response.status);
                if (window.debugConsole) {
                    window.debugConsole.showProgress('Processing response...', 50);
                }
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (!data) return; // Handle auth failure
                console.log('Received data:', data);
                if (window.debugConsole) {
                    window.debugConsole.showProgress('Rendering file list...', 80);
                }
                currentFiles = data.files;
                displayFiles(data.files, path);
                updateCurrentPathDisplay(data.currentPath, data.files.length);
                
                // Update annotation manager with current directory
                if (window.annotationManager && window.annotationManager.setCurrentDirectory) {
                    // Build full path for annotation filtering
                    const fullPath = data.currentPath || path || '';
                    window.annotationManager.setCurrentDirectory(fullPath);
                }
                
                // Auto-display folder contents after loading
                autoDisplayFolderContents(data.files, path);
                
                if (window.debugConsole) {
                    window.debugConsole.showProgress('Complete', 100);
                }
            })
            .catch(error => {
                console.error('Error loading files:', error);
                document.getElementById('current-path-display').textContent = 'Error loading directory';
                fileList.innerHTML = '<li style="color: red;">Error: ' + error.message + '</li>';
            })
            .finally(() => {
                // Hide progress overlay
                if (window.debugConsole) {
                    window.debugConsole.hideProgress();
                }
            });
    }
    
    function displayFiles(data, path) {
        fileList.innerHTML = '';
        
        console.log('displayFiles called with path:', JSON.stringify(path), 'path !== "":', path !== '');
        
        if (path !== '') {
            const parentLi = document.createElement('li');
            parentLi.textContent = '..';
            parentLi.classList.add('parent-dir');
            parentLi.addEventListener('click', () => {
                console.log('Parent directory clicked. Current path:', JSON.stringify(currentPath));
                const lastSlashIndex = currentPath.lastIndexOf('/');
                console.log('Last slash index:', lastSlashIndex);
                
                if (lastSlashIndex > 0) {
                    currentPath = currentPath.substring(0, lastSlashIndex);
                } else {
                    currentPath = '';  // Go to root if we're at first level
                }
                
                console.log('New path after parent navigation:', JSON.stringify(currentPath));
                clearContentView();
                loadFiles(currentPath);
            });
            fileList.appendChild(parentLi);
            console.log('Added parent directory (..) to file list');
        } else {
            console.log('At root directory - not showing parent (..)');
        }
        
        const selectedFilter = fileTypeFilter.value;
        const searchQuery = searchInput.value;
        const searchTerms = parseSearchQuery(searchQuery);
        
        // Perform filtering (both type and search)
        filteredFiles = data.filter(file => {
            // Type filter
            let typeMatches = true;
            if (selectedFilter !== 'all') {
                if (file.isDirectory) {
                    typeMatches = selectedFilter === 'directory';
                } else {
                    // Handle .btpart files - strip the extension to get actual file type
                    let actualFileName = file.name;
                    if (file.name.toLowerCase().endsWith('.btpart')) {
                        actualFileName = file.name.substring(0, file.name.length - 7);
                    }
                    const extension = actualFileName.split('.').pop().toLowerCase();
                    const fileType = getFileTypeFromExtension(extension, actualFileName);
                    typeMatches = fileType === selectedFilter;
                }
            }

            // Search filter
            const searchMatches = matchesSearchTerms(file.name, searchTerms);

            return typeMatches && searchMatches;
        });

        // Sort the filtered files
        filteredFiles = sortFiles(filteredFiles);
        
        // Update path display with filtered count if different from total
        const hasFilters = selectedFilter !== 'all' || searchTerms.length > 0;
        if (hasFilters) {
            const pathDisplay = document.getElementById('current-path-display');
            const currentText = pathDisplay.textContent;
            const baseText = currentText.replace(/ \(\d+ items\).*/, '').replace(/ \(\d+ of \d+ items\).*/, '');
            pathDisplay.textContent = `${baseText} (${filteredFiles.length} of ${data.length} items)`;
        }
        
        selectedIndex = -1;
        
        filteredFiles.forEach((file, index) => {
                    const li = document.createElement('li');
                    li.classList.add('file-item');
                    li.setAttribute('data-index', index);
                    
                    const fileIcon = document.createElement('span');
                    fileIcon.classList.add('file-icon');
                    
                    const fileName = document.createElement('span');
                    fileName.classList.add('file-name');
                    fileName.textContent = file.name;
                    
                    const fileSize = document.createElement('span');
                    fileSize.classList.add('file-size');
                    if (file.size) {
                        fileSize.textContent = formatFileSize(file.size);
                    }
                    
                    li.appendChild(fileIcon);
                    li.appendChild(fileName);
                    li.appendChild(fileSize);
                    
                    // Add file type data attribute for styling
                    if (file.isDirectory) {
                        li.setAttribute('data-type', 'directory');
                        li.addEventListener('click', () => {
                            const dirPath = path ? `${path}/${file.name}` : file.name;
                            // Show library view on the right panel instead of navigating
                            // Use Enter key to navigate into the directory
                            showLibraryView(dirPath, file.name);
                            // Select this item for keyboard navigation
                            selectFile(index, dirPath, file.name, {});
                        });

                        // Add context menu for directories
                        li.addEventListener('contextmenu', (e) => {
                            e.preventDefault();
                            const filePath = path ? `${path}/${file.name}` : file.name;
                            showContextMenu(e.pageX, e.pageY, filePath, file.name, file.isDirectory);
                        });
                    } else {
                        // Handle .btpart files - strip the extension to get actual file type
                        let actualFileName = file.name;
                        if (file.name.toLowerCase().endsWith('.btpart')) {
                            actualFileName = file.name.substring(0, file.name.length - 7);
                        }
                        const extension = actualFileName.split('.').pop().toLowerCase();
                        
                        if (extension === 'pdf') {
                            li.setAttribute('data-type', 'pdf');
                        } else if (['cbz', 'cbr'].includes(extension)) {
                            li.setAttribute('data-type', 'comic');
                        } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) {
                            li.setAttribute('data-type', 'image');
                        } else if (['mp4', 'avi', 'mov', 'mkv', 'webm', 'mpg', 'mpeg', 'wmv', 'm4v', 'flv', '3gp', 'ts', 'mts', 'm2ts'].includes(extension)) {
                            li.setAttribute('data-type', 'video');
                        } else if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma'].includes(extension)) {
                            li.setAttribute('data-type', 'audio');
                        } else if (['js', 'html', 'css', 'json', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'xml', 'yaml', 'yml', 'ini', 'conf', 'log', 'sh', 'bat', 'ps1', 'sql', 'php', 'rb', 'swift', 'kt', 'dart', 'r', 'scala', 'clj', 'elm', 'vue', 'jsx', 'tsx', 'ts', 'less', 'scss', 'sass', 'styl', 'svelte', 'astro'].includes(extension)) {
                            li.setAttribute('data-type', 'code');
                        } else if (extension === 'ipynb') {
                            li.setAttribute('data-type', 'notebook');
                        } else if (['txt', 'md', 'rtf', 'doc', 'docx', 'odt'].includes(extension)) {
                            li.setAttribute('data-type', 'text');
                        } else if (['csv', 'xlsx', 'xls', 'ods'].includes(extension)) {
                            li.setAttribute('data-type', 'table');
                        } else if (['pptx', 'ppt', 'odp'].includes(extension)) {
                            li.setAttribute('data-type', 'presentation');
                        } else if (extension === 'srt') {
                            li.setAttribute('data-type', 'subtitle');
                        } else if (extension === 'epub') {
                            li.setAttribute('data-type', 'ebook');
                        } else if (['zip', 'rar', 'tar', 'tgz', '7z'].includes(extension) || (file.name && file.name.endsWith('.tar.gz'))) {
                            li.setAttribute('data-type', 'archive');
                        } else if (file.name && !file.name.includes('.')) {
                            // Files without extension - treat as text
                            li.setAttribute('data-type', 'text');
                        } else {
                            // Unknown extensions - treat as text for better visibility
                            li.setAttribute('data-type', 'text');
                        }
                        
                        li.addEventListener('click', (e) => {
                            // Check if clicked on annotation button
                            if (e.target.closest('.annotation-btn')) {
                                return; // Don't select file if annotation button was clicked
                            }
                            
                            const filePath = path ? `${path}/${file.name}` : file.name;
const videoExtensions = ['mp4', 'avi', 'mov', 'mkv', 'webm', 'mpg', 'mpeg', 'wmv', 'm4v', 'flv', '3gp', 'ts', 'mts', 'm2ts'];
                             const ext = file.name.split('.').pop().toLowerCase();
                             const isVideo = videoExtensions.includes(ext);
                             const options = isVideo ? { autoPlay: true, keyboardNavigation: true } : {};
                             selectFile(index, filePath, file.name, options);
                             showContent(path, file.name, options);
                             updateDetails(file);
                        });

                        // Add context menu for files
                        li.addEventListener('contextmenu', (e) => {
                            e.preventDefault();
                            const filePath = path ? `${path}/${file.name}` : file.name;
                            showContextMenu(e.pageX, e.pageY, filePath, file.name, file.isDirectory);
                        });

                        li.addEventListener('dblclick', (e) => {
                            // Check if clicked on annotation button
                            if (e.target.closest('.annotation-btn')) {
                                return;
                            }
                            
                            const filePath = path ? `${path}/${file.name}` : file.name;
                            
                            // Open file with default system program
                            window.authManager.authenticatedFetch('/api/open-file', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({ filePath })
                            })
                            .then(response => {
                                if (!response) return; // Auth failure handled by authManager
                                if (!response.ok) {
                                    throw new Error(`Failed to open file: ${response.status}`);
                                }
                                return response.json();
                            })
                            .then(result => {
                                if (result && !result.success) {
                                    console.error('Failed to open file:', result.error);
                                }
                            })
                            .catch(error => {
                                console.error('Error opening file:', error);
                            });
                        });

                        // Add annotation button for files
                        const annotationBtn = document.createElement('button');
                        annotationBtn.className = 'annotation-btn';
                        annotationBtn.innerHTML = '📝';
                        annotationBtn.title = 'Add annotation';
                        annotationBtn.style.cssText = `
                            background: transparent;
                            border: 1px solid #555555;
                            color: #d4d4d4;
                            padding: 2px 6px;
                            border-radius: 3px;
                            cursor: pointer;
                            font-size: 12px;
                            margin-left: auto;
                            opacity: 0.7;
                            transition: all 0.2s;
                            flex-shrink: 0;
                        `;
                        
                        annotationBtn.addEventListener('mouseenter', () => {
                            annotationBtn.style.opacity = '1';
                            annotationBtn.style.background = '#333333';
                        });
                        
                        annotationBtn.addEventListener('mouseleave', () => {
                            annotationBtn.style.opacity = '0.7';
                            annotationBtn.style.background = 'transparent';
                        });
                        
                        annotationBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const filePath = path ? `${path}/${file.name}` : file.name;
                            console.log('Annotation button clicked for:', filePath);
                            
                            if (!window.annotationManager) {
                                console.error('AnnotationManager not initialized');
                                alert('Annotation system not available. Please refresh the page.');
                                return;
                            }
                            
                            try {
                                window.annotationManager.showAnnotationDialog(filePath, file.name);
                            } catch (error) {
                                console.error('Error showing annotation dialog:', error);
                                alert('Failed to open annotation dialog: ' + error.message);
                            }
                        });
                        
                        li.appendChild(annotationBtn);
                        
                    }
                    fileList.appendChild(li);
                });
        
        // Update annotations display after files are loaded
        setTimeout(() => {
            window.annotationManager?.updateFileListDisplay();
        }, 100);
    }

    function showContent(path, fileName, options = {}) {
        const filePath = path ? `${path}/${fileName}` : fileName;

        fileRenderer.render(filePath, fileName, contentCode, contentOther, options);

        // Dispatch file selection event for AI summary
        document.dispatchEvent(new CustomEvent('fileSelected', {
            detail: {
                path: filePath,
                name: fileName,
                content: null // Content will be extracted later by the summary manager
            }
        }));
    }

    // Show library view for a directory (displays files as visual book shelf)
    async function showLibraryView(dirPath, dirName) {
        // Clear the code panel and show library in the other panel
        contentCode.innerHTML = '';
        contentCode.parentElement.style.display = 'none';

        // Render library view
        if (window.libraryRenderer) {
            await window.libraryRenderer.render(dirPath, contentOther);
        } else {
            contentOther.innerHTML = '<div class="library-error">Library renderer not loaded</div>';
            contentOther.style.display = 'block';
        }

        // Update file details panel
        fileDetails.innerHTML = `
            <div class="detail-item">
                <span class="detail-label">Directory:</span>
                <span class="detail-value" title="${dirName}">${dirName}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">Path:</span>
                <span class="detail-value" title="${dirPath}">${dirPath || '/'}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">View:</span>
                <span class="detail-value">Library View</span>
            </div>
            <p style="margin-top: 10px; font-size: 0.75rem; color: #888;">
                Click an item to view it. Press Enter to navigate into this folder.
            </p>
        `;
    }

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
    
    function updateDetails(file) {
        if (!file) {
            fileDetails.innerHTML = '<p>Select a file to view details</p>';
            return;
        }

        // Handle .btpart files - strip the extension to get actual file type
        let actualFileName = file.name;
        if (file.name.toLowerCase().endsWith('.btpart')) {
            actualFileName = file.name.substring(0, file.name.length - 7);
        }
        const extension = actualFileName.split('.').pop().toLowerCase();
        const fileType = getFileTypeDescription(extension);
        
        fileDetails.innerHTML = `
            <div class="detail-item">
                <span class="detail-label">Name:</span>
                <span class="detail-value" title="${file.name}">${file.name}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">Type:</span>
                <span class="detail-value">${fileType}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">Extension:</span>
                <span class="detail-value">.${extension}</span>
            </div>
            ${file.size ? `
            <div class="detail-item">
                <span class="detail-label">Size:</span>
                <span class="detail-value">${formatFileSize(file.size)}</span>
            </div>
            ` : ''}
            ${file.modified ? `
            <div class="detail-item">
                <span class="detail-label">Modified:</span>
                <span class="detail-value">${new Date(file.modified).toLocaleDateString()}</span>
            </div>
            ` : ''}
        `;
    }
    
    function getFileTypeFromExtension(extension, fileName = '') {
        if (extension === 'pdf') return 'pdf';
        if (['cbz', 'cbr'].includes(extension)) return 'comic';
        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) return 'image';
        if (['mp4', 'avi', 'mov', 'mkv', 'webm', 'mpg', 'mpeg', 'wmv', 'm4v', 'flv', '3gp', 'ts', 'mts', 'm2ts'].includes(extension)) return 'video';
        if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma'].includes(extension)) return 'audio';
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
    
    function getFileTypeDescription(extension) {
        const types = {
            'pdf': 'PDF Document',
            'jpg': 'JPEG Image', 'jpeg': 'JPEG Image', 'png': 'PNG Image', 'gif': 'GIF Image', 'webp': 'WebP Image',
            'mp4': 'MP4 Video', 'avi': 'AVI Video', 'mov': 'QuickTime Video', 'mkv': 'Matroska Video',
            'webm': 'WebM Video', 'mpg': 'MPEG Video', 'mpeg': 'MPEG Video', 'wmv': 'WMV Video',
            'm4v': 'M4V Video', 'flv': 'Flash Video', '3gp': '3GP Video', 'ts': 'MPEG-TS Video', 'mts': 'AVCHD Video', 'm2ts': 'Blu-ray Video',
            'mp3': 'MP3 Audio', 'wav': 'WAV Audio', 'flac': 'FLAC Audio', 'ogg': 'OGG Audio',
            'm4a': 'M4A Audio', 'aac': 'AAC Audio', 'wma': 'WMA Audio',
            'txt': 'Text File', 'md': 'Markdown', 'rtf': 'Rich Text Format',
            'doc': 'Word Document', 'docx': 'Word Document', 'odt': 'OpenDocument Text',
            'csv': 'CSV Spreadsheet', 'xls': 'Excel Spreadsheet', 'xlsx': 'Excel Spreadsheet', 'ods': 'OpenDocument Spreadsheet',
            'ppt': 'PowerPoint Presentation', 'pptx': 'PowerPoint Presentation', 'odp': 'OpenDocument Presentation',
            'srt': 'Subtitle File',
            'js': 'JavaScript', 'html': 'HTML Document', 'css': 'CSS Stylesheet', 'json': 'JSON Data',
            'py': 'Python Script', 'java': 'Java Source', 'c': 'C Source', 'cpp': 'C++ Source',
            'xml': 'XML Document', 'yaml': 'YAML Config', 'yml': 'YAML Config',
            'cbz': 'Comic Book Archive', 'cbr': 'Comic Book Archive', 'zip': 'ZIP Archive/Comic Book Archive',
            'epub': 'EPUB E-book',
            'ipynb': 'Jupyter Notebook',
            'rar': 'RAR Archive', 'tar': 'TAR Archive',
            'tgz': 'Compressed TAR Archive', '7z': '7-Zip Archive'
        };
        return types[extension] || 'Text File';
    }
    
    function updateCurrentPathDisplay(fullPath, fileCount) {
        const pathDisplay = document.getElementById('current-path-display');
        
        // Create breadcrumb navigation
        const pathParts = fullPath ? fullPath.split('/') : [];
        
        // Clear and rebuild with proper event listeners (CSP compliant)
        pathDisplay.innerHTML = '';
        
        // Parent folder button (only show if not at root)
        if (fullPath && fullPath !== '') {
            const parentBtn = document.createElement('button');
            parentBtn.className = 'path-parent';
            parentBtn.title = 'Go to Parent Folder';
            parentBtn.textContent = '⬆️';
            parentBtn.addEventListener('click', () => window.fileExplorer.goToParent());
            pathDisplay.appendChild(parentBtn);
            pathDisplay.appendChild(document.createTextNode(' '));
        }
        
        // Home button
        const homeBtn = document.createElement('button');
        homeBtn.className = 'path-home';
        homeBtn.title = `Go to Root Directory (${serverRootDir})`;
        homeBtn.textContent = '🏠';
        homeBtn.addEventListener('click', () => window.fileExplorer.loadFiles(''));
        pathDisplay.appendChild(homeBtn);
        
        if (pathParts.length > 0) {
            pathDisplay.appendChild(document.createTextNode(' / '));
            pathParts.forEach((part, index) => {
                if (part) {
                    const pathToHere = pathParts.slice(0, index + 1).join('/');
                    const segmentBtn = document.createElement('button');
                    segmentBtn.className = 'path-segment';
                    segmentBtn.title = `Navigate to ${pathToHere}`;
                    segmentBtn.textContent = part;
                    segmentBtn.addEventListener('click', () => window.fileExplorer.loadFiles(pathToHere));
                    pathDisplay.appendChild(segmentBtn);
                    if (index < pathParts.length - 1) {
                        pathDisplay.appendChild(document.createTextNode(' / '));
                    }
                }
            });
        }
        
        const countSpan = document.createElement('span');
        countSpan.className = 'item-count';
        countSpan.textContent = ` (${fileCount} items)`;
        pathDisplay.appendChild(countSpan);
    }
    
    function selectFile(index, filePath, fileName, options = {}) {
        const items = document.querySelectorAll('.file-item');
        items.forEach(item => item.classList.remove('selected'));

        // Check both filteredFiles length AND that DOM element exists (race condition protection)
        if (index >= 0 && index < filteredFiles.length && items[index]) {
            selectedIndex = index;
            items[index].classList.add('selected');
            
            // Scroll into view if needed
            items[index].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else if (index >= 0 && index < filteredFiles.length) {
            // DOM not ready yet, just update the index - the display will catch up
            selectedIndex = index;
            console.log(`selectFile: DOM element not ready for index ${index}, updating selectedIndex only`);
        }
    }
    
    function handleKeyNavigation(event) {
        // Don't interfere with typing in search input, filter select, or textarea
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT' || event.target.tagName === 'TEXTAREA') {
            return;
        }
        
        // Don't interfere when any modal is open
        if (document.querySelector('.annotation-modal-backdrop') || 
            document.querySelector('.bookmarks-modal-backdrop') ||
            document.querySelector('.move-modal-backdrop') ||
            document.querySelector('.bookmark-detail-backdrop')) {
            return;
        }
        
        // Don't interfere when specific renderers are active that handle their own navigation
        const archiveContainer = document.querySelector('.archive-container');
        const pdfContainer = document.querySelector('.pdf-container');
        const videoElement = document.querySelector('#content-other video');
        if ((archiveContainer && contentOther.style.display !== 'none') ||
            (pdfContainer && contentOther.style.display !== 'none') ||
            (videoElement && contentOther.style.display !== 'none')) {
            return; // Renderer handles its own keys
        }

        if (filteredFiles.length === 0 && event.key !== 'Backspace') return;

        let newIndex = selectedIndex;
        switch(event.key) {
            case 'ArrowUp':
                event.preventDefault();
                newIndex = selectedIndex > 0 ? selectedIndex - 1 : filteredFiles.length - 1;
                break;
            case 'ArrowDown':
                event.preventDefault();
                newIndex = selectedIndex < filteredFiles.length - 1 ? selectedIndex + 1 : 0;
                break;
            case 'PageUp':
                event.preventDefault();
                newIndex = Math.max(0, selectedIndex - 10);
                break;
            case 'PageDown':
                event.preventDefault();
                newIndex = Math.min(filteredFiles.length - 1, selectedIndex + 10);
                break;
            case 'Home':
                event.preventDefault();
                newIndex = 0;
                break;
            case 'End':
                event.preventDefault();
                newIndex = filteredFiles.length - 1;
                break;
            case 'Enter':
                event.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < filteredFiles.length) {
                    const file = filteredFiles[selectedIndex];
                    if (file.isDirectory) {
                        currentPath = currentPath ? `${currentPath}/${file.name}` : file.name;
                        loadFiles(currentPath);
                        updateDetails(null);
                    } else {
                        showContent(currentPath, file.name, { autoPlay: true, keyboardNavigation: true });
                    }
                }
                return;
            case '/':
                event.preventDefault();
                // Focus on search input when user types '/'
                searchInput.focus();
                return;
            case 'Escape':
                event.preventDefault();
                // Clear search when Escape is pressed
                if (searchInput.value !== '') {
                    searchInput.value = '';
                    displayFiles(currentFiles, currentPath);
                    // Re-focus on file list
                    document.querySelector('.file-item.selected')?.focus();
                }
                return;
            // Color label shortcuts
            case 'b': // blue
                event.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < filteredFiles.length) {
                    quickAnnotate(filteredFiles[selectedIndex], 'color', 'blue');
                }
                return;
            case 'r': // red
                event.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < filteredFiles.length) {
                    quickAnnotate(filteredFiles[selectedIndex], 'color', 'red');
                }
                return;
            case 'g': // green
                event.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < filteredFiles.length) {
                    quickAnnotate(filteredFiles[selectedIndex], 'color', 'green');
                }
                return;
            case 'w': // white
                event.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < filteredFiles.length) {
                    quickAnnotate(filteredFiles[selectedIndex], 'color', 'white');
                }
                return;
            case 'l': // black
                event.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < filteredFiles.length) {
                    quickAnnotate(filteredFiles[selectedIndex], 'color', 'black');
                }
                return;
            case 'o': // orange
                event.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < filteredFiles.length) {
                    quickAnnotate(filteredFiles[selectedIndex], 'color', 'orange');
                }
                return;
            case 'p': // purple
                event.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < filteredFiles.length) {
                    quickAnnotate(filteredFiles[selectedIndex], 'color', 'purple');
                }
                return;
            case 'y': // yellow
                event.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < filteredFiles.length) {
                    quickAnnotate(filteredFiles[selectedIndex], 'color', 'yellow');
                }
                return;
            case 's': // clear color
                event.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < filteredFiles.length) {
                    quickAnnotate(filteredFiles[selectedIndex], 'color', '');
                }
                return;
            case '?': // show help popup
                event.preventDefault();
                showShortcutHelpPopup();
                return;
            case 'c':
                event.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < filteredFiles.length) {
                    quickAnnotate(filteredFiles[selectedIndex], 'comment');
                }
                return;
            case '1':
            case '2':
            case '3':
            case '4':
            case '5':
                event.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < filteredFiles.length) {
                    quickAnnotate(filteredFiles[selectedIndex], 'stars', parseInt(event.key));
                }
                return;
        }
        if (newIndex !== selectedIndex) {
            const file = filteredFiles[newIndex];
            const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
            const isVideo = ['mp4', 'avi', 'mov', 'mkv', 'webm', 'mpg', 'mpeg', 'wmv', 'm4v', 'flv', '3gp', 'ts', 'mts', 'm2ts'].includes(
                file.name.split('.').pop().toLowerCase()
            );
            const options = isVideo ? { autoPlay: true, keyboardNavigation: true } : {};
            selectFile(newIndex, filePath, file.name, options);
            updateDetails(file);
        }
    }
    
    // Event listeners
    document.addEventListener('keydown', handleKeyNavigation);
    
    fileTypeFilter.addEventListener('change', () => {
        // Show brief loading for filtering large directories
        if (currentFiles.length > 100) {
            if (window.debugConsole) {
                window.debugConsole.showProgress('Filtering files...', 50);
            }
            
            setTimeout(() => {
                displayFiles(currentFiles, currentPath);
                if (window.debugConsole) {
                    window.debugConsole.hideProgress();
                }
            }, 50);
        } else {
            displayFiles(currentFiles, currentPath);
        }
    });

    searchInput.addEventListener('input', () => {
        // Show brief loading for searching in large directories
        if (currentFiles.length > 100) {
            if (window.debugConsole) {
                window.debugConsole.showProgress('Searching files...', 30);
            }

            setTimeout(() => {
                displayFiles(currentFiles, currentPath);
                if (window.debugConsole) {
                    window.debugConsole.hideProgress();
                }
            }, 50);
        } else {
            displayFiles(currentFiles, currentPath);
        }
    });

    // Sort field change event
    sortFieldSelect.addEventListener('change', () => {
        sortField = sortFieldSelect.value;
        displayFiles(currentFiles, currentPath);
    });

    // Sort direction toggle event
    sortDirectionBtn.addEventListener('click', () => {
        sortAscending = !sortAscending;
        sortDirectionBtn.textContent = sortAscending ? '↑' : '↓';
        sortDirectionBtn.title = sortAscending ? 'Sorted ascending (click for descending)' : 'Sorted descending (click for ascending)';
        displayFiles(currentFiles, currentPath);
    });

    // Tab switching functionality
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.getAttribute('data-tab');
            
            // Remove active class from all buttons and contents
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            // Add active class to clicked button and corresponding content
            button.classList.add('active');
            const tabContent = document.getElementById(`${tabName}-tab`);
            if (tabContent) {
                tabContent.classList.add('active');
            }
        });
    });

    // Bookmarks button
    const bookmarksBtn = document.getElementById('bookmarks-btn');
    if (bookmarksBtn) {
        bookmarksBtn.addEventListener('click', () => {
            window.annotationManager?.showBookmarksView();
        });
    }

    // Fetch server info and restore saved current path from session, then load files
    fetch('/api/server-info')
        .then(response => response.json())
        .then(data => {
            serverRootDir = data.rootDir || '';
            currentPath = data.currentPath || '';
            console.log('Server root directory:', serverRootDir);
            console.log('Restored current path:', currentPath);
            loadFiles(currentPath);
        })
        .catch(err => {
            console.warn('Failed to fetch server info, starting at root:', err);
            loadFiles(currentPath);
        });
    
    // Quick annotation function for keyboard shortcuts
    function quickAnnotate(file, type, value) {
        const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
        
        if (type === 'comment') {
            // Show comment dialog
            if (window.showAnnotationDialog) {
                window.showAnnotationDialog(filePath, file.name);
            }
            return;
        }
        
        // For color and stars, update annotation directly
        const existingAnnotation = window.annotationsCache?.[filePath] || {};
        const annotation = {
            comment: existingAnnotation.comment || '',
            color: type === 'color' ? value : existingAnnotation.color,
            stars: type === 'stars' ? value : existingAnnotation.stars
        };
        
        // Save annotation
        fetch('/api/annotations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                filePath: filePath,
                ...annotation
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Update cache
                if (!window.annotationsCache) window.annotationsCache = {};
                window.annotationsCache[filePath] = annotation;
                
                // Refresh display
                displayFiles(currentFiles, currentPath);
                
                // Show feedback
                showQuickAnnotationFeedback(type, value);
            }
        })
        .catch(error => {
            console.error('Error saving annotation:', error);
            showQuickAnnotationFeedback('error', 'Failed to save');
        });
    }
    
    // Show visual feedback for quick annotations
    function showQuickAnnotationFeedback(type, value) {
        const feedback = document.createElement('div');
        feedback.className = 'quick-annotation-feedback';
        
        let message = '';
        if (type === 'color') {
            const colorNames = {
                red: 'Red',
                orange: 'Orange',
                yellow: 'Yellow',
                green: 'Green',
                blue: 'Blue',
                purple: 'Purple',
                white: 'White',
                black: 'Black',
                pink: 'Pink',
                teal: 'Teal',
                '': 'None',
            };
            const colorHex = {
                red: '#f44336',
                orange: '#ff9800',
                yellow: '#ffeb3b',
                green: '#4caf50',
                blue: '#2196f3',
                purple: '#9c27b0',
                white: '#fff',
                black: '#111',
                pink: '#e91e63',
                teal: '#009688',
                '': '#444',
            };
            message = value === '' ? 'Color: None' : `Color: ${colorNames[value] || value}`;
            feedback.style.backgroundColor = colorHex[value] || value || '#444';
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

    // Auto-display folder contents based on primary content type
    function autoDisplayFolderContents(files, currentPath) {
        if (!files || files.length === 0) return;
        
        // Count different file types
        const imageFiles = files.filter(file => !file.isDirectory && 
            ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(file.name.split('.').pop().toLowerCase()));
        const videoFiles = files.filter(file => !file.isDirectory && 
            ['mp4', 'avi', 'mov', 'mkv', 'webm', 'mpg', 'mpeg', 'wmv', 'm4v', 'flv', '3gp', 'ts', 'mts', 'm2ts'].includes(file.name.split('.').pop().toLowerCase()));
        const pdfFiles = files.filter(file => !file.isDirectory && 
            file.name.split('.').pop().toLowerCase() === 'pdf');
        const comicFiles = files.filter(file => !file.isDirectory && 
            ['cbz', 'cbr'].includes(file.name.split('.').pop().toLowerCase()));
        
        let primaryContent = null;
        
        // Determine primary content type (prioritize images for pair viewing)
        if (imageFiles.length > 1) {
            primaryContent = { type: 'images', files: imageFiles };
        } else if (videoFiles.length > 0) {
            primaryContent = { type: 'video', files: videoFiles };
        } else if (pdfFiles.length > 0) {
            primaryContent = { type: 'pdf', files: pdfFiles };
        } else if (comicFiles.length > 0) {
            primaryContent = { type: 'comic', files: comicFiles };
        } else if (imageFiles.length === 1) {
            primaryContent = { type: 'image', files: imageFiles };
        }
        
        // Auto-display the primary content
        if (primaryContent) {
            const firstFile = primaryContent.files[0];
            const filePath = currentPath ? `${currentPath}/${firstFile.name}` : firstFile.name;
            console.log(`Auto-displaying ${primaryContent.type} content:`, firstFile.name);
            showContent(currentPath, firstFile.name);
        }
    }
    
    // Clear the content view
    function clearContentView() {
        contentCode.innerHTML = '';
        contentOther.innerHTML = '';
        contentCode.parentElement.style.display = 'none';
        contentOther.style.display = 'none';
        
        // Stop any media that might be playing
        if (fileRenderer) {
            fileRenderer.stopAllMedia();
        }
    }
    
    // Go to parent folder
    function goToParent() {
        if (currentPath === '') return;
        
        const lastSlashIndex = currentPath.lastIndexOf('/');
        if (lastSlashIndex > 0) {
            currentPath = currentPath.substring(0, lastSlashIndex);
        } else {
            // No slash or slash at position 0 means we're one level deep, go to root
            currentPath = '';
        }
        clearContentView();
        loadFiles(currentPath);
    }

    // Expose file explorer state for keyboard navigation
    window.fileExplorer = {
        currentPath: () => currentPath,
        currentFiles: () => currentFiles,
        filteredFiles: () => filteredFiles,
        serverRootDir: () => serverRootDir,
        loadFiles: loadFiles,
        updateDetails: updateDetails,
        selectFile: selectFile,
        showContent: showContent,
        quickAnnotate: quickAnnotate,
        autoDisplayFolderContents: autoDisplayFolderContents,
        clearContentView: clearContentView,
        goToParent: goToParent
    };

    // Check for file parameter in URL to auto-open a file
    const urlParams = new URLSearchParams(window.location.search);
    const fileToOpen = urlParams.get('file');
    if (fileToOpen) {
        // Extract directory and filename
        const lastSlash = fileToOpen.lastIndexOf('/');
        const dirPath = lastSlash > 0 ? fileToOpen.substring(0, lastSlash) : '';
        const fileName = lastSlash >= 0 ? fileToOpen.substring(lastSlash + 1) : fileToOpen;

        console.log(`Auto-opening file from URL: ${fileToOpen}`);

        // Load the directory first, then show the file
        setTimeout(() => {
            if (dirPath) {
                currentPath = dirPath;
                loadFiles(currentPath);
            }
            // Show the file content
            setTimeout(() => {
                showContent(dirPath, fileName, { autoPlay: true });
            }, 500);
        }, 100);
    }
}


// Expose initializeApp globally so auth.js can call it
window.initializeApp = initializeApp;
