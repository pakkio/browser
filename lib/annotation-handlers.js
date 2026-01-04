const fs = require('fs');
const path = require('path');
const { baseDir } = require('./config');

// Sparse storage: each file gets its own .json file in .browser/annotations/
// e.g., /path/to/video.mp4 -> .browser/annotations/_path_to_video.mp4.json

function ensureBrowserDir() {
    // Use project baseDir for .browser directory
    const browserDir = path.join(baseDir, '.browser');
    if (!fs.existsSync(browserDir)) {
        fs.mkdirSync(browserDir, { recursive: true });
    }
    return browserDir;
}

// Get sparse annotation file path for a given file (stored in .browser/annotations/)
function getSparseAnnotationPath(filePath) {
    const annotationsDir = getAnnotationsDir();
    // Create a safe filename from the full path
    let safeFileName = filePath.replace(/[^a-zA-Z0-9.-]/g, '_');
    
    // If too long, use a hash-based approach
    if (safeFileName.length > 200) {
        const crypto = require('crypto');
        const hash = crypto.createHash('md5').update(filePath).digest('hex');
        const ext = path.extname(filePath);
        const baseName = path.basename(filePath, ext);
        safeFileName = `${baseName.substring(0, 50)}_${hash}${ext}`;
    }
    
    return path.join(annotationsDir, `${safeFileName}.json`);
}

// Get the original file path from a sparse annotation filename
function getOriginalPathFromSparse(sparseFileName) {
    // This is stored inside the annotation file itself as 'originalPath'
    return null; // Will be read from file content
}

// Get legacy annotations file path
function getAnnotationsPath() {
    return path.join(ensureBrowserDir(), 'annotations.json');
}

// Get annotations directory path (for sparse and legacy directory-based storage)
function getAnnotationsDir() {
    const annotationsDir = path.join(ensureBrowserDir(), 'annotations');
    if (!fs.existsSync(annotationsDir)) {
        fs.mkdirSync(annotationsDir, { recursive: true });
    }
    return annotationsDir;
}

// Get directory-specific annotation file path (legacy)
function getDirectoryAnnotationPath(filePath) {
    const annotationsDir = getAnnotationsDir();
    const fileDir = path.dirname(filePath);
    // Create a more reliable safe name using hash if too long
    let safeDirName = fileDir.replace(/[^a-zA-Z0-9]/g, '_') || 'root';
    
    // If too long, use a hash-based approach
    if (safeDirName.length > 100) {
        const crypto = require('crypto');
        const hash = crypto.createHash('md5').update(fileDir).digest('hex');
        safeDirName = `${safeDirName.substring(0, 50)}_${hash}`;
    }
    
    return path.join(annotationsDir, `${safeDirName}.json`);
}

// Load sparse annotation for a specific file
function loadSparseAnnotation(filePath) {
    try {
        const sparseFile = getSparseAnnotationPath(filePath);
        if (fs.existsSync(sparseFile)) {
            const data = fs.readFileSync(sparseFile, 'utf8');
            const annotation = JSON.parse(data);
            // Verify this is the right file by checking originalPath
            if (annotation.originalPath === filePath) {
                return annotation;
            }
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error loading sparse annotation: ${error.message}`);
    }
    return null;
}

// Save sparse annotation for a specific file
function saveSparseAnnotation(filePath, annotation) {
    try {
        const sparseFile = getSparseAnnotationPath(filePath);
        
        // If annotation is empty, delete the file
        if (!annotation || (!annotation.comment && !annotation.stars && !annotation.color && 
            (!annotation.bookmarks || annotation.bookmarks.length === 0))) {
            if (fs.existsSync(sparseFile)) {
                fs.unlinkSync(sparseFile);
                console.log(`[${new Date().toISOString()}] 🗑️ Deleted empty annotation file: ${sparseFile}`);
            }
            return true;
        }
        
        // Store the original path in the annotation for reverse lookup
        annotation.originalPath = filePath;
        annotation.lastModified = new Date().toISOString();
        fs.writeFileSync(sparseFile, JSON.stringify(annotation, null, 2));
        console.log(`[${new Date().toISOString()}] ✅ Saved sparse annotation: ${sparseFile}`);
        return true;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error saving sparse annotation: ${error.message}`);
        return false;
    }
}

// Load annotations from legacy disk storage
function loadAnnotations() {
    try {
        const annotationsPath = getAnnotationsPath();
        if (fs.existsSync(annotationsPath)) {
            const data = fs.readFileSync(annotationsPath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error loading annotations: ${error.message}`);
    }
    return {};
}

// Save annotations to legacy disk storage
function saveAnnotations(annotations) {
    try {
        const annotationsPath = getAnnotationsPath();
        fs.writeFileSync(annotationsPath, JSON.stringify(annotations, null, 2));
        return true;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error saving annotations: ${error.message}`);
        return false;
    }
}

// Load annotations from legacy directory structure (for a specific directory)
function loadDirectoryAnnotations(filePath) {
    try {
        const annotationFilePath = getDirectoryAnnotationPath(filePath);
        if (fs.existsSync(annotationFilePath)) {
            const data = fs.readFileSync(annotationFilePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error loading directory annotations: ${error.message}`);
    }
    return {};
}

// Save annotations for a specific directory (legacy)
function saveDirectoryAnnotations(filePath, annotations) {
    try {
        const annotationFilePath = getDirectoryAnnotationPath(filePath);
        console.log(`[${new Date().toISOString()}] 📝 Saving annotations to: ${annotationFilePath}`);
        
        fs.writeFileSync(annotationFilePath, JSON.stringify(annotations, null, 2));
        console.log(`[${new Date().toISOString()}] ✅ Successfully saved annotations`);
        return true;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error saving directory annotations: ${error.message}`);
        console.error(`[${new Date().toISOString()}] ❌ Stack trace:`, error.stack);
        return false;
    }
}

// Load annotation for a file - tries sparse first, then falls back to legacy
function loadAnnotationForFile(filePath) {
    // First try sparse storage
    const sparseAnnotation = loadSparseAnnotation(filePath);
    if (sparseAnnotation) {
        return sparseAnnotation;
    }
    
    // Fall back to legacy directory-based storage
    const dirAnnotations = loadDirectoryAnnotations(filePath);
    if (dirAnnotations[filePath]) {
        return dirAnnotations[filePath];
    }
    
    // Fall back to legacy single file storage
    const legacyAnnotations = loadAnnotations();
    return legacyAnnotations[filePath] || {};
}

// Scan .browser/annotations/ directory for sparse annotation files
function loadSparseAnnotations() {
    const results = {};
    try {
        const annotationsDir = getAnnotationsDir();
        if (!fs.existsSync(annotationsDir)) return results;
        
        const files = fs.readdirSync(annotationsDir);
        for (const file of files) {
            if (file.endsWith('.json')) {
                const filePath = path.join(annotationsDir, file);
                try {
                    const data = fs.readFileSync(filePath, 'utf8');
                    const annotation = JSON.parse(data);
                    
                    // Sparse files have originalPath field
                    if (annotation.originalPath) {
                        results[annotation.originalPath] = annotation;
                    } else {
                        // Legacy directory-based format (contains multiple annotations)
                        // These are keyed by file path directly
                        for (const [key, value] of Object.entries(annotation)) {
                            if (typeof value === 'object' && value !== null) {
                                results[key] = value;
                            }
                        }
                    }
                } catch (error) {
                    console.error(`[${new Date().toISOString()}] ❌ Error reading annotation file ${filePath}: ${error.message}`);
                }
            }
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error scanning annotations directory: ${error.message}`);
    }
    return results;
}

// Load all annotations from sparse files, legacy directory-based, and legacy single file
function loadAllAnnotations() {
    let allAnnotations = {};
    
    // First, load from legacy single file if it exists
    const legacyAnnotations = loadAnnotations();
    Object.assign(allAnnotations, legacyAnnotations);
    
    // Then, load from .browser/annotations/ directory (includes both sparse and legacy dir-based)
    const sparseAnnotations = loadSparseAnnotations();
    Object.assign(allAnnotations, sparseAnnotations);
    
    return allAnnotations;
}

// Save individual annotation using sparse storage
function saveAnnotation(filePath, annotation) {
    try {
        // Get existing annotation to preserve bookmarks if not being updated
        const existing = loadAnnotationForFile(filePath);
        
        // Merge with existing (preserve bookmarks if not in new annotation)
        const merged = {
            ...existing,
            ...annotation
        };
        
        // Clean up empty fields
        if (!merged.comment) delete merged.comment;
        if (!merged.stars) delete merged.stars;
        if (!merged.color) delete merged.color;
        if (!merged.bookmarks || merged.bookmarks.length === 0) delete merged.bookmarks;
        
        return saveSparseAnnotation(filePath, merged);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error saving annotation: ${error.message}`);
        return false;
    }
}

// Delete individual annotation
function deleteAnnotation(filePath) {
    try {
        // Delete sparse file
        const sparseFile = getSparseAnnotationPath(filePath);
        if (fs.existsSync(sparseFile)) {
            fs.unlinkSync(sparseFile);
            console.log(`[${new Date().toISOString()}] 🗑️ Deleted sparse annotation: ${sparseFile}`);
        }
        
        // Also clean up from legacy storage if exists
        const dirAnnotations = loadDirectoryAnnotations(filePath);
        if (dirAnnotations[filePath]) {
            delete dirAnnotations[filePath];
            saveDirectoryAnnotations(filePath, dirAnnotations);
        }
        
        return true;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error deleting annotation: ${error.message}`);
        return false;
    }
}

// Rename annotation (move from old path to new path)
function renameAnnotation(oldPath, newPath) {
    try {
        // Load annotation from old path (checks sparse and legacy)
        const annotation = loadAnnotationForFile(oldPath);
        
        if (!annotation || Object.keys(annotation).length === 0) {
            // No annotation to migrate
            return true;
        }
        
        // Delete old annotation
        deleteAnnotation(oldPath);
        
        // Save to new path using sparse storage
        annotation.lastModified = new Date().toISOString();
        return saveSparseAnnotation(newPath, annotation);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error renaming annotation: ${error.message}`);
        return false;
    }
}

// Migrate all legacy annotations to sparse storage
function migrateToSparseStorage() {
    const results = { migrated: 0, failed: 0, skipped: 0, errors: [] };
    
    try {
        // Load all legacy annotations (not already in sparse format)
        const allAnnotations = {};
        
        // From single file
        Object.assign(allAnnotations, loadAnnotations());
        
        // From directory-based storage (legacy format - multi-file annotations)
        const annotationsDir = path.join(ensureBrowserDir(), 'annotations');
        if (fs.existsSync(annotationsDir)) {
            const files = fs.readdirSync(annotationsDir);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const filePath = path.join(annotationsDir, file);
                    try {
                        const data = fs.readFileSync(filePath, 'utf8');
                        const content = JSON.parse(data);
                        
                        // Skip files that are already in sparse format (have originalPath)
                        if (content.originalPath) {
                            continue;
                        }
                        
                        // Legacy format: object with file paths as keys
                        for (const [key, value] of Object.entries(content)) {
                            if (typeof value === 'object' && value !== null && !value.originalPath) {
                                allAnnotations[key] = value;
                            }
                        }
                    } catch (error) {
                        console.error(`[${new Date().toISOString()}] ⚠️ Error reading ${filePath}: ${error.message}`);
                    }
                }
            }
        }
        
        console.log(`[${new Date().toISOString()}] 📦 Found ${Object.keys(allAnnotations).length} legacy annotations to migrate`);
        
        // Migrate each annotation to sparse storage
        for (const [filePath, annotation] of Object.entries(allAnnotations)) {
            try {
                // Skip if already has originalPath (already migrated)
                if (annotation.originalPath) {
                    results.skipped++;
                    continue;
                }
                
                // Check if file exists (skip if it doesn't)
                if (!fs.existsSync(filePath)) {
                    console.log(`[${new Date().toISOString()}] ⚠️ Skipping non-existent file: ${filePath}`);
                    results.skipped++;
                    continue;
                }
                
                // Check if sparse file already exists with same originalPath
                const sparseFile = getSparseAnnotationPath(filePath);
                if (fs.existsSync(sparseFile)) {
                    try {
                        const existing = JSON.parse(fs.readFileSync(sparseFile, 'utf8'));
                        if (existing.originalPath === filePath) {
                            console.log(`[${new Date().toISOString()}] ⏭️ Already migrated: ${filePath}`);
                            results.skipped++;
                            continue;
                        }
                    } catch (e) {
                        // File exists but can't be read, try to overwrite
                    }
                }
                
                // Save as sparse
                if (saveSparseAnnotation(filePath, annotation)) {
                    results.migrated++;
                } else {
                    results.failed++;
                    results.errors.push(`Failed to save: ${filePath}`);
                }
            } catch (error) {
                results.failed++;
                results.errors.push(`${filePath}: ${error.message}`);
            }
        }
        
        console.log(`[${new Date().toISOString()}] ✅ Migration complete: ${results.migrated} migrated, ${results.skipped} skipped, ${results.failed} failed`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Migration error: ${error.message}`);
        results.errors.push(`General error: ${error.message}`);
    }
    
    return results;
}

// Get annotations for a file, directory, or all files
function getAnnotations(req, res) {
    try {
        const filePath = req.query.path;
        const isDirectory = req.query.directory === 'true';

        if (filePath && isDirectory) {
            // Return annotations for all files in the specified directory
            const allAnnotations = loadAllAnnotations();
            const dirPrefix = filePath ? filePath + '/' : '';
            const dirAnnotations = {};

            for (const [annotPath, annotation] of Object.entries(allAnnotations)) {
                // Check if the annotation path is in this directory (not in subdirs)
                if (filePath === '') {
                    // Root directory - match files without any /
                    if (!annotPath.includes('/')) {
                        dirAnnotations[annotPath] = annotation;
                    }
                } else if (annotPath.startsWith(dirPrefix)) {
                    // Check it's directly in this dir, not in a subdir
                    const remainder = annotPath.substring(dirPrefix.length);
                    if (!remainder.includes('/')) {
                        dirAnnotations[annotPath] = annotation;
                    }
                }
            }

            res.json({ annotations: dirAnnotations });
        } else if (filePath) {
            // Return annotations for specific file - checks sparse first, then legacy
            const annotation = loadAnnotationForFile(filePath);
            res.json(annotation);
        } else {
            // Return all annotations using combined function (sparse + legacy)
            const allAnnotations = loadAllAnnotations();
            res.json(allAnnotations);
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error getting annotations: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

// Add or update annotation for a file
function postAnnotations(req, res) {
    try {
        const { filePath, comment, stars, color } = req.body;
        
        if (!filePath) {
            return res.status(400).json({ error: 'File path is required' });
        }
        
        // Build annotation object
        let annotation = {};
        
        if (comment !== undefined) {
            if (comment.trim() !== '') {
                annotation.comment = comment.trim();
            }
        }
        
        if (stars !== undefined) {
            if (stars !== 0 && stars !== null) {
                annotation.stars = Math.max(1, Math.min(5, parseInt(stars)));
            }
        }
        
        if (color !== undefined) {
            if (color !== '' && color !== null) {
                annotation.color = color;
            }
        }
        
        // Use sparse storage for saving
        if (saveAnnotation(filePath, annotation)) {
            // Load the saved annotation to return it
            const savedAnnotation = loadAnnotationForFile(filePath);
            res.json({ success: true, annotation: savedAnnotation });
        } else {
            res.status(500).json({ error: 'Failed to save annotation' });
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error updating annotations: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

// Delete annotation for a file
function deleteAnnotations(req, res) {
    try {
        const filePath = req.query.path;
        
        if (!filePath) {
            return res.status(400).json({ error: 'File path is required' });
        }
        
        // Use sparse storage for delete
        if (deleteAnnotation(filePath)) {
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Failed to delete annotation' });
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error deleting annotations: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

// Search annotated files
function getFileTypeFromExtension(extension, fileName = '') {
    if (extension === 'pdf') return 'pdf';
    if (['cbz', 'cbr'].includes(extension)) return 'comic';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) return 'image';
    if (['mp4', 'avi', 'mov', 'mkv'].includes(extension)) return 'video';
    if (['mp3', 'wav', 'flac', 'ogg'].includes(extension)) return 'audio';
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

function searchAnnotations(req, res) {
    try {
        const { query, hasComment, hasStars, hasColor, hasBookmarks, color, fileType, directory } = req.query;
        const annotations = loadAllAnnotations();
        
        let results = [];
        
        // Build full directory path for comparison (handle both relative and absolute)
        let fullDirectoryPath = directory;
        if (directory && !directory.startsWith('/')) {
            // It's a relative path, prepend baseDir
            fullDirectoryPath = path.join(baseDir, directory);
        }
        
        for (const [filePath, annotation] of Object.entries(annotations)) {
            let matches = true;
            
            // Filter by directory (current folder only)
            if (directory) {
                const fileDir = path.dirname(filePath);
                
                // For exact directory match (not recursive)
                if (req.query.exactDir === 'true') {
                    // Check if file is directly in the directory
                    // Compare with both relative and full path versions
                    const relativeDirMatch = fileDir === directory || fileDir.endsWith('/' + directory);
                    const fullDirMatch = fileDir === fullDirectoryPath;
                    
                    if (!relativeDirMatch && !fullDirMatch) {
                        matches = false;
                    }
                } else {
                    // Recursive: check if file is in the directory or any subdirectory
                    const inRelativeDir = filePath.includes('/' + directory + '/') || filePath.startsWith(directory + '/');
                    const inFullDir = filePath.startsWith(fullDirectoryPath + '/');
                    
                    if (!inRelativeDir && !inFullDir) {
                        matches = false;
                    }
                }
            }
            
            // Filter by query in comments
            if (query && annotation.comment) {
                matches = matches && annotation.comment.toLowerCase().includes(query.toLowerCase());
            } else if (query && !annotation.comment) {
                matches = false;
            }
            
            // Filter by has comment
            if (hasComment === 'true' && !annotation.comment) {
                matches = false;
            }
            
            // Filter by has stars
            if (hasStars === 'true' && !annotation.stars) {
                matches = false;
            }
            
            // Filter by has color
            if (hasColor === 'true' && !annotation.color) {
                matches = false;
            }

            // Filter by has bookmarks (video bookmarks)
            if (hasBookmarks === 'true' && (!annotation.bookmarks || annotation.bookmarks.length === 0)) {
                matches = false;
            }

            // Filter by specific color
            if (color && annotation.color !== color) {
                matches = false;
            }
            
            // Filter by file type
            if (fileType && fileType !== 'all') {
                const fileName = filePath.split('/').pop();
                const extension = fileName.split('.').pop();
                const detectedFileType = getFileTypeFromExtension(extension, fileName);
                if (detectedFileType !== fileType) {
                    matches = false;
                }
            }
            
            if (matches) {
                results.push({
                    filePath,
                    ...annotation
                });
            }
        }
        
        // Sort by lastModified (newest first)
        results.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
        
        res.json(results);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error searching annotations: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

// Bookmark functions for videos - now using sparse storage
function saveBookmarks(filePath, bookmarks) {
    try {
        // Load existing annotation for this file
        const existing = loadAnnotationForFile(filePath);

        // Update bookmarks
        const annotation = {
            ...existing,
            bookmarks: bookmarks,
            lastModified: new Date().toISOString()
        };

        // Clean up empty bookmarks array
        if (!annotation.bookmarks || annotation.bookmarks.length === 0) {
            delete annotation.bookmarks;
        }

        // Save using sparse storage
        return saveSparseAnnotation(filePath, annotation);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error saving bookmarks: ${error.message}`);
        return false;
    }
}

function getBookmarks(filePath) {
    try {
        const annotation = loadAnnotationForFile(filePath);
        return annotation?.bookmarks || [];
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error loading bookmarks: ${error.message}`);
        return [];
    }
}

function addBookmark(filePath, bookmarkName, position) {
    try {
        const bookmarks = getBookmarks(filePath);

        // Check if bookmark with same name already exists
        const existingIndex = bookmarks.findIndex(b => b.name === bookmarkName);
        if (existingIndex !== -1) {
            bookmarks[existingIndex] = { name: bookmarkName, position };
        } else {
            bookmarks.push({ name: bookmarkName, position });
        }

        // Sort by position
        bookmarks.sort((a, b) => a.position - b.position);

        return saveBookmarks(filePath, bookmarks);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error adding bookmark: ${error.message}`);
        return false;
    }
}

function deleteBookmark(filePath, bookmarkName) {
    try {
        const bookmarks = getBookmarks(filePath);
        const filtered = bookmarks.filter(b => b.name !== bookmarkName);
        return saveBookmarks(filePath, filtered);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error deleting bookmark: ${error.message}`);
        return false;
    }
}

function renameBookmark(filePath, oldName, newName) {
    try {
        const bookmarks = getBookmarks(filePath);
        const bookmark = bookmarks.find(b => b.name === oldName);
        if (bookmark) {
            bookmark.name = newName;
            return saveBookmarks(filePath, bookmarks);
        }
        return false;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error renaming bookmark: ${error.message}`);
        return false;
    }
}

// API endpoint for bookmarks
function getBookmarksApi(req, res) {
    try {
        const filePath = req.query.path;
        if (!filePath) {
            return res.status(400).json({ error: 'File path is required' });
        }
        const bookmarks = getBookmarks(filePath);
        res.json(bookmarks);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error getting bookmarks: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

function postBookmarkApi(req, res) {
    try {
        const { filePath, name, position } = req.body;

        if (!filePath || !name) {
            return res.status(400).json({ error: 'File path and bookmark name are required' });
        }

        if (addBookmark(filePath, name, position)) {
            const bookmarks = getBookmarks(filePath);
            res.json({ success: true, bookmarks });
        } else {
            res.status(500).json({ error: 'Failed to save bookmark' });
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error posting bookmark: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

function deleteBookmarkApi(req, res) {
    try {
        const { filePath, name } = req.body;

        if (!filePath || !name) {
            return res.status(400).json({ error: 'File path and bookmark name are required' });
        }

        if (deleteBookmark(filePath, name)) {
            const bookmarks = getBookmarks(filePath);
            res.json({ success: true, bookmarks });
        } else {
            res.status(500).json({ error: 'Failed to delete bookmark' });
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error deleting bookmark: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

function renameBookmarkApi(req, res) {
    try {
        const { path: filePath, oldName, newName } = req.body;

        if (!filePath || !oldName || !newName) {
            return res.status(400).json({ error: 'File path, old name and new name are required' });
        }

        if (renameBookmark(filePath, oldName, newName)) {
            const bookmarks = getBookmarks(filePath);
            res.json({ success: true, bookmarks });
        } else {
            res.status(500).json({ error: 'Failed to rename bookmark' });
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error renaming bookmark: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

// API endpoint for migration to sparse storage
function migrateToSparseApi(req, res) {
    try {
        console.log(`[${new Date().toISOString()}] 🔄 Starting migration to sparse storage...`);
        const results = migrateToSparseStorage();
        res.json({ 
            success: true, 
            message: `Migration complete: ${results.migrated} migrated, ${results.skipped} skipped, ${results.failed} failed`,
            ...results 
        });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error during migration: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

module.exports = {
    getAnnotations,
    postAnnotations,
    deleteAnnotations,
    searchAnnotations,
    getBookmarksApi,
    postBookmarkApi,
    deleteBookmarkApi,
    renameBookmarkApi,
    getBookmarks,
    addBookmark,
    deleteBookmark,
    renameBookmark,
    renameAnnotation,
    migrateToSparseApi,
    migrateToSparseStorage
};