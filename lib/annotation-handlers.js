const fs = require('fs');
const path = require('path');
const { baseDir } = require('./config');

function ensureBrowserDir() {
    // Use project baseDir for .browser directory
    const browserDir = path.join(baseDir, '.browser');
    if (!fs.existsSync(browserDir)) {
        fs.mkdirSync(browserDir, { recursive: true });
    }
    return browserDir;
}

// Get annotations file path
function getAnnotationsPath() {
    return path.join(ensureBrowserDir(), 'annotations.json');
}

// Get annotations directory path (for directory-based storage)
function getAnnotationsDir() {
    const annotationsDir = path.join(ensureBrowserDir(), 'annotations');
    if (!fs.existsSync(annotationsDir)) {
        fs.mkdirSync(annotationsDir, { recursive: true });
    }
    return annotationsDir;
}

// Get directory-specific annotation file path
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

// Load annotations from disk
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

// Save annotations to disk
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

// Load annotations from directory structure (for a specific directory)
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

// Save annotations for a specific directory
function saveDirectoryAnnotations(filePath, annotations) {
    try {
        const annotationFilePath = getDirectoryAnnotationPath(filePath);
        console.log(`[${new Date().toISOString()}] 📝 Saving annotations to: ${annotationFilePath}`);
        console.log(`[${new Date().toISOString()}] 📝 Annotations data:`, JSON.stringify(annotations, null, 2));
        
        fs.writeFileSync(annotationFilePath, JSON.stringify(annotations, null, 2));
        console.log(`[${new Date().toISOString()}] ✅ Successfully saved annotations`);
        return true;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error saving directory annotations: ${error.message}`);
        console.error(`[${new Date().toISOString()}] ❌ Stack trace:`, error.stack);
        return false;
    }
}

// Load all annotations from both legacy and directory-based storage
function loadAllAnnotations() {
    let allAnnotations = {};
    
    // First, load from legacy single file if it exists
    const legacyAnnotations = loadAnnotations();
    Object.assign(allAnnotations, legacyAnnotations);
    
    // Then, load from directory-based storage
    try {
        const annotationsDir = path.join(ensureBrowserDir(), 'annotations');
        if (fs.existsSync(annotationsDir)) {
            const files = fs.readdirSync(annotationsDir);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const filePath = path.join(annotationsDir, file);
                    const data = fs.readFileSync(filePath, 'utf8');
                    const dirAnnotations = JSON.parse(data);
                    Object.assign(allAnnotations, dirAnnotations);
                }
            }
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error loading all annotations: ${error.message}`);
    }
    
    return allAnnotations;
}

// Save individual annotation using directory structure
function saveAnnotation(filePath, annotation) {
    try {
        // Load existing annotations for this directory
        const dirAnnotations = loadDirectoryAnnotations(filePath);
        
        // Update or add the annotation
        if (annotation && (annotation.comment || annotation.stars || annotation.color)) {
            dirAnnotations[filePath] = {
                ...annotation,
                lastModified: new Date().toISOString()
            };
        } else {
            // Remove annotation if all values are empty
            delete dirAnnotations[filePath];
        }
        
        // Save back to directory file
        return saveDirectoryAnnotations(filePath, dirAnnotations);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error saving annotation: ${error.message}`);
        return false;
    }
}

// Delete individual annotation
function deleteAnnotation(filePath) {
    try {
        // Load existing annotations for this directory
        const dirAnnotations = loadDirectoryAnnotations(filePath);
        
        // Remove the annotation
        delete dirAnnotations[filePath];
        
        // Save back to directory file
        return saveDirectoryAnnotations(filePath, dirAnnotations);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error deleting annotation: ${error.message}`);
        return false;
    }
}

// Get annotations for a file or all files
function getAnnotations(req, res) {
    try {
        const filePath = req.query.path;
        
        if (filePath) {
            // Return annotations for specific file - check both legacy and directory storage
            const legacyAnnotations = loadAnnotations();
            const dirAnnotations = loadDirectoryAnnotations(filePath);
            const annotation = dirAnnotations[filePath] || legacyAnnotations[filePath] || {};
            res.json(annotation);
        } else {
            // Return all annotations using new combined function
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
        
        // Use the new directory-based save function
        if (saveAnnotation(filePath, annotation)) {
            // Load the saved annotation to return it
            const dirAnnotations = loadDirectoryAnnotations(filePath);
            const savedAnnotation = dirAnnotations[filePath] || {};
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
        
        // Use the new directory-based delete function
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
        const { query, hasComment, hasStars, hasColor, color, fileType } = req.query;
        const annotations = loadAllAnnotations();
        
        let results = [];
        
        for (const [filePath, annotation] of Object.entries(annotations)) {
            let matches = true;
            
            // Filter by query in comments
            if (query && annotation.comment) {
                matches = annotation.comment.toLowerCase().includes(query.toLowerCase());
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

module.exports = {
    getAnnotations,
    postAnnotations,
    deleteAnnotations,
    searchAnnotations
};