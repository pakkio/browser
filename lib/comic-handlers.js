const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const yauzl = require('yauzl');
const { createExtractorFromFile } = require('node-unrar-js');
const { baseDir, getImageMimeType } = require('./config');

const pendingRequests = new Map();

async function serveComicPreview(req, res, cache) {
    const requestedFile = req.query.path;
    const page = parseInt(req.query.page) || 1;
    console.log(`[${new Date().toISOString()}] GET /comic-preview - file: "${requestedFile}", page: ${page}`);
    
    if (!requestedFile) {
        console.log(`[${new Date().toISOString()}] ❌ Comic preview: File path is required`);
        return res.status(400).send('File path is required');
    }
    
    const filePath = path.join(baseDir, requestedFile);
    
    if (!filePath.startsWith(baseDir)) {
        console.log(`[${new Date().toISOString()}] ❌ Comic preview: Forbidden access to ${filePath}`);
        return res.status(403).send('Forbidden');
    }
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
        console.log(`[${new Date().toISOString()}] ❌ Comic preview: File not found: ${filePath}`);
        return res.status(404).send('File not found');
    }
    
    const ext = path.extname(filePath).toLowerCase();
    if (!['.cbz', '.cbr'].includes(ext)) {
        console.log(`[${new Date().toISOString()}] ❌ Comic preview: Not a comic archive: ${filePath}`);
        return res.status(400).send('Not a comic book archive');
    }
    
    try {
        console.log(`[${new Date().toISOString()}] 🔄 Extracting comic page ${page} from ${ext} file...`);
        if (ext === '.cbz') {
            await extractFromCBZ(filePath, page, res);
        } else if (ext === '.cbr') {
            await extractFromCBR(filePath, page, res);
        }
        console.log(`[${new Date().toISOString()}] ✅ Comic extraction completed`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Comic extraction error: ${error.message}`);
        
        // Handle specific error types
        if (error.message.includes('File is not RAR archive') || 
            error.message.includes('central directory record signature not found') ||
            error.message.includes('file is truncated') ||
            error.message.includes('not a zip file')) {
            
            console.warn(`[${new Date().toISOString()}] ⚠️ Archive corruption detected, attempting fallback extraction: ${filePath}`);
            try {
                if (ext === '.cbr') {
                    await extractFromCBZ(filePath, page, res);
                } else {
                    // For CBZ files, we can't do much more
                    return res.status(422).send('Archive file is corrupted or invalid');
                }
            } catch (zipError) {
                console.error(`[${new Date().toISOString()}] ❌ Comic extraction error (fallback): ${zipError.message}`);
                return res.status(422).send('Archive file is corrupted and cannot be processed');
            }
        } else if (error.message.includes('Page not found')) {
            return res.status(404).send(error.message);
        } else {
            // Generic error handling
            return res.status(500).send('Comic extraction failed due to an unexpected error');
        }
    }
}

async function getComicInfo(req, res, cache) {
    const requestedFile = req.query.path;
    console.log(`[${new Date().toISOString()}] GET /api/comic-info - file: "${requestedFile}"`);
    
    if (!requestedFile) {
        console.log(`[${new Date().toISOString()}] ❌ Comic info: File path is required`);
        return res.status(400).send('File path is required');
    }
    
    const filePath = path.join(baseDir, requestedFile);
    
    if (!filePath.startsWith(baseDir)) {
        console.log(`[${new Date().toISOString()}] ❌ Comic info: Forbidden access to ${filePath}`);
        return res.status(403).send('Forbidden');
    }
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
        console.log(`[${new Date().toISOString()}] ❌ Comic info: File not found: ${filePath}`);
        return res.status(404).send('File not found');
    }
    
    const ext = path.extname(filePath).toLowerCase();
    if (!['.cbz', '.cbr'].includes(ext)) {
        console.log(`[${new Date().toISOString()}] ❌ Comic info: Not a comic archive: ${filePath}`);
        return res.status(400).send('Not a comic book archive');
    }
    
    try {
        console.log(`[${new Date().toISOString()}] 🔄 Getting comic info for ${ext} file...`);
        const imageFiles = await getComicFileList(filePath, cache);
        
        res.json({
            pages: imageFiles.length,
            format: ext.replace('.', '').toUpperCase()
        });
        
        console.log(`[${new Date().toISOString()}] ✅ Comic info: Found ${imageFiles.length} pages`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Comic info error: ${error.message}`);
        
        // Handle specific error types
        if (error.message.includes('File is not RAR archive') || 
            error.message.includes('central directory record signature not found') ||
            error.message.includes('file is truncated') ||
            error.message.includes('not a zip file')) {
            
            console.warn(`[${new Date().toISOString()}] ⚠️ Archive corruption detected, attempting fallback: ${filePath}`);
            try {
                if (ext === '.cbr') {
                    const imageFiles = await getZipComicFileList(filePath);
                    res.json({
                        pages: imageFiles.length,
                        format: 'CBR (ZIP)'
                    });
                } else {
                    // For CBZ files, we can't do much more
                    return res.status(422).send('Archive file is corrupted or invalid');
                }
            } catch (zipError) {
                console.error(`[${new Date().toISOString()}] ❌ Comic info error (fallback): ${zipError.message}`);
                return res.status(422).send('Archive file is corrupted and cannot be processed');
            }
        } else {
            // Generic error handling
            return res.status(500).send('Comic info retrieval failed due to an unexpected error');
        }
    }
}

async function extractFromCBZ(filePath, page, res) {
    return new Promise((resolve, reject) => {
        // Check if file exists before attempting to open
        if (!fs.existsSync(filePath)) {
            return reject(new Error(`File not found: ${filePath}`));
        }
        
        yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
            if (err) {
                // Enhanced error handling for yauzl errors
                if (err.message.includes('central directory record signature not found')) {
                    return reject(new Error('Archive file is corrupted or not a valid ZIP file'));
                } else if (err.message.includes('file is truncated')) {
                    return reject(new Error('Archive file is truncated or incomplete'));
                } else if (err.message.includes('not a zip file')) {
                    return reject(new Error('File is not a valid ZIP archive'));
                }
                return reject(err);
            }
            
            const imageFiles = [];
            let hasError = false;
            
            // Add timeout to prevent hanging
            const timeout = setTimeout(() => {
                hasError = true;
                if (zipfile) {
                    zipfile.close();
                }
                reject(new Error('Archive processing timeout - file may be corrupted'));
            }, 30000); // 30 second timeout
            
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                if (hasError) return;
                
                if (!entry || !entry.fileName) {
                    zipfile.readEntry();
                    return;
                }
                
                if (entry.fileName.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif)$/i)) {
                    imageFiles.push(entry);
                }
                zipfile.readEntry();
            });
            
            zipfile.on('end', () => {
                if (hasError) return;
                clearTimeout(timeout);
                
                imageFiles.sort((a, b) => (a.fileName || '').localeCompare(b.fileName || ''));
                
                if (page > imageFiles.length || page < 1) {
                    zipfile.close();
                    return reject(new Error(`Page not found. Found ${imageFiles.length} images, requested page ${page}`));
                }
                
                const targetEntry = imageFiles[page - 1];
                zipfile.openReadStream(targetEntry, (err, readStream) => {
                    if (err) {
                        zipfile.close();
                        return reject(new Error(`Failed to extract page ${page}: ${err.message}`));
                    }
                    
                    const mimeType = getImageMimeType(targetEntry.fileName);
                    
                    res.setHeader('Content-Type', mimeType);
                    readStream.pipe(res);
                    
                    readStream.on('end', () => {
                        zipfile.close();
                        resolve();
                    });
                    
                    readStream.on('error', (err) => {
                        zipfile.close();
                        reject(new Error(`Stream error while reading page ${page}: ${err.message}`));
                    });
                });
            });
            
            zipfile.on('error', (err) => {
                if (hasError) return;
                hasError = true;
                clearTimeout(timeout);
                zipfile.close();
                reject(new Error(`Archive processing error: ${err.message}`));
            });
        });
    });
}

async function getZipComicFileList(filePath) {
    return new Promise((resolve, reject) => {
        // Check if file exists before attempting to open
        if (!fs.existsSync(filePath)) {
            return reject(new Error(`File not found: ${filePath}`));
        }
        
        yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
            if (err) {
                // Enhanced error handling for yauzl errors
                if (err.message.includes('central directory record signature not found')) {
                    return reject(new Error('Archive file is corrupted or not a valid ZIP file'));
                } else if (err.message.includes('file is truncated')) {
                    return reject(new Error('Archive file is truncated or incomplete'));
                } else if (err.message.includes('not a zip file')) {
                    return reject(new Error('File is not a valid ZIP archive'));
                }
                return reject(err);
            }
            
            const imageFiles = [];
            let hasError = false;
            
            // Add timeout to prevent hanging
            const timeout = setTimeout(() => {
                hasError = true;
                reject(new Error('Archive processing timeout - file may be corrupted'));
            }, 30000); // 30 second timeout
            
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                if (hasError) return;
                
                if (entry && entry.fileName && entry.fileName.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif)$/i)) {
                    imageFiles.push(entry.fileName);
                }
                zipfile.readEntry();
            });
            
            zipfile.on('end', () => {
                if (hasError) return;
                clearTimeout(timeout);
                imageFiles.sort();
                resolve(imageFiles);
            });
            
            zipfile.on('error', (err) => {
                if (hasError) return;
                hasError = true;
                clearTimeout(timeout);
                reject(new Error(`Archive processing error: ${err.message}`));
            });
        });
    });
}

async function getComicFileList(filePath, cache) {
    const cacheKey = cache.generateKey(filePath, 'comic-list');
    const cachedList = await cache.get('comic-lists', cacheKey, filePath);
    if (cachedList) {
        return cachedList;
    }

    // Check if file exists before attempting to process
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    try {
        const extractor = await createExtractorFromFile({ filepath: filePath });
        const list = await extractor.getFileList();

        let fileHeaders = [];
        if (list && list.fileHeaders) {
            fileHeaders = Array.isArray(list.fileHeaders) ? list.fileHeaders : Array.from(list.fileHeaders);
        } else if (Array.isArray(list)) {
            fileHeaders = list;
        } else if (list && typeof list === 'object' && list.files) {
            fileHeaders = Array.isArray(list.files) ? list.files : Array.from(list.files);
        } else {
            console.error(`[${new Date().toISOString()}] ❌ Unexpected list structure from node-unrar-js:`, list);
            throw new Error('Unexpected file list structure from RAR extractor');
        }

        const imageFiles = fileHeaders
            .map(header => header.name || header.filename)
            .filter(name => name && name.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif)$/i))
            .sort();

        console.log(`[${new Date().toISOString()}] 📖 CBR: Found ${imageFiles.length} image files using node-unrar-js`);

        await cache.set('comic-lists', cacheKey, imageFiles, filePath);
        return imageFiles;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ CBR: getComicFileList error with node-unrar-js: ${error.message}`);
        
        // Enhanced error handling for specific error types
        if (error.message.includes('File is not RAR archive') || 
            error.message.includes('corrupted') ||
            error.message.includes('invalid') ||
            error.message.includes('truncated')) {
            throw new Error('Archive file is corrupted or not a valid RAR file');
        } else if (error.message.includes('ENOENT') || error.message.includes('not found')) {
            throw new Error(`File not found: ${filePath}`);
        } else if (error.message.includes('EACCES') || error.message.includes('permission')) {
            throw new Error(`Permission denied accessing file: ${filePath}`);
        }
        
        throw error;
    }
}

async function extractFromCBR(filePath, page, res) {
    const requestKey = `${filePath}:${page}`;
    
    if (pendingRequests.has(requestKey)) {
        return pendingRequests.get(requestKey);
    }
    
    const promise = new Promise(async (resolve, reject) => {
        try {
            // Check if file exists before attempting to process
            if (!fs.existsSync(filePath)) {
                return reject(new Error(`File not found: ${filePath}`));
            }
            
            const imageFiles = await getComicFileList(filePath);
            
            if (page > imageFiles.length || page < 1) {
                return reject(new Error(`Page not found. Found ${imageFiles.length} images, requested page ${page}`));
            }
            
            const targetFile = imageFiles[page - 1];
            
            console.log(`[${new Date().toISOString()}] 📖 CBR: Extracting file ${targetFile} from ${path.basename(filePath)}`);
            
            const escapedFilePath = filePath.replace(/"/g, '\"');
            const escapedTargetFile = targetFile.replace(/"/g, '\"');
            
            // Add timeout to prevent hanging
            const timeout = setTimeout(() => {
                reject(new Error('CBR extraction timeout - file may be corrupted'));
            }, 60000); // 60 second timeout
            
            exec(`unrar p -inul "${escapedFilePath}" "${escapedTargetFile}"`, { 
                encoding: 'buffer', 
                maxBuffer: 50 * 1024 * 1024,
                timeout: 60000 // 60 second timeout
            }, (err, stdout, stderr) => {
                clearTimeout(timeout);
                
                if (err) {
                    console.error(`[${new Date().toISOString()}] ❌ CBR: Extraction failed for ${targetFile}`);
                    console.error(`[${new Date().toISOString()}] ❌ CBR: Error: ${err.message}`);
                    console.error(`[${new Date().toISOString()}] ❌ CBR: stderr: ${stderr}`);
                    console.error(`[${new Date().toISOString()}] ❌ CBR: Available files: ${imageFiles.slice(0, 10).join(', ')}`);
                    
                    // Enhanced error handling for specific error types
                    if (err.message.includes('corrupted') || 
                        err.message.includes('invalid') ||
                        err.message.includes('truncated') ||
                        stderr.toString().includes('Corrupt file')) {
                        console.log(`[${new Date().toISOString()}] 🔄 CBR: Archive corrupted, trying fallback extraction method`);
                        return extractFromCBZ(filePath, page, res).then(resolve).catch(reject);
                    } else if (err.killed || err.signal === 'SIGTERM') {
                        return reject(new Error('CBR extraction timeout - file may be corrupted'));
                    } else {
                        console.log(`[${new Date().toISOString()}] 🔄 CBR: Trying fallback extraction method`);
                        return extractFromCBZ(filePath, page, res).then(resolve).catch(reject);
                    }
                }
                
                if (!stdout || stdout.length === 0) {
                    return reject(new Error(`No data extracted from page ${page}`));
                }
                
                const mimeType = getImageMimeType(targetFile);
                
                res.setHeader('Content-Type', mimeType);
                res.send(stdout);
                resolve();
            });
        } catch (error) {
            console.error(`[${new Date().toISOString()}] ❌ CBR: extractFromCBR error: ${error.message}`);
            // Try fallback extraction as last resort
            extractFromCBZ(filePath, page, res).then(resolve).catch(reject);
        }
    });
    
    pendingRequests.set(requestKey, promise);
    
    promise.finally(() => {
        pendingRequests.delete(requestKey);
    });
    
    return promise;
}

module.exports = {
    serveComicPreview,
    getComicInfo
};