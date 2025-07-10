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
        if (error.message.includes('File is not RAR archive')) {
            console.warn(`[${new Date().toISOString()}] ⚠️ CBR is not a RAR, attempting to extract as ZIP: ${filePath}`);
            try {
                await extractFromCBZ(filePath, page, res);
            } catch (zipError) {
                console.error(`[${new Date().toISOString()}] ❌ Comic extraction error (fallback): ${zipError.message}`);
                res.status(500).send(`Comic extraction error: ${zipError.message}`);
            }
        } else {
            console.error(`[${new Date().toISOString()}] ❌ Comic extraction error: ${error.message}`);
            res.status(500).send(`Comic extraction error: ${error.message}`);
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
        if (error.message.includes('File is not RAR archive')) {
            console.warn(`[${new Date().toISOString()}] ⚠️ CBR is not a RAR, attempting to read as ZIP: ${filePath}`);
            try {
                const imageFiles = await getZipComicFileList(filePath);
                res.json({
                    pages: imageFiles.length,
                    format: 'CBR (ZIP)'
                });
            } catch (zipError) {
                console.error(`[${new Date().toISOString()}] ❌ Comic info error (fallback): ${zipError.message}`);
                res.status(500).send(`Comic info error: ${zipError.message}`);
            }
        } else {
            console.error(`[${new Date().toISOString()}] ❌ Comic info error: ${error.message}`);
            res.status(500).send(`Comic info error: ${error.message}`);
        }
    }
}

async function extractFromCBZ(filePath, page, res) {
    return new Promise((resolve, reject) => {
        yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
            if (err) return reject(err);
            
            const imageFiles = [];
            
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
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
                imageFiles.sort((a, b) => (a.fileName || '').localeCompare(b.fileName || ''));
                
                if (page > imageFiles.length || page < 1) {
                    zipfile.close();
                    return reject(new Error(`Page not found. Found ${imageFiles.length} images, requested page ${page}`));
                }
                
                const targetEntry = imageFiles[page - 1];
                zipfile.openReadStream(targetEntry, (err, readStream) => {
                    if (err) {
                        zipfile.close();
                        return reject(err);
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
                        reject(err);
                    });
                });
            });
            
            zipfile.on('error', (err) => {
                zipfile.close();
                reject(err);
            });
        });
    });
}

async function getZipComicFileList(filePath) {
    return new Promise((resolve, reject) => {
        yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
            if (err) return reject(err);
            const imageFiles = [];
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                if (entry.fileName.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif)$/i)) {
                    imageFiles.push(entry.fileName);
                }
                zipfile.readEntry();
            });
            zipfile.on('end', () => {
                imageFiles.sort();
                resolve(imageFiles);
            });
            zipfile.on('error', reject);
        });
    });
}

async function getComicFileList(filePath, cache) {
    const cacheKey = cache.generateKey(filePath, 'comic-list');
    const cachedList = await cache.get('comic-lists', cacheKey, filePath);
    if (cachedList) {
        return cachedList;
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
            const imageFiles = await getComicFileList(filePath);
            
            if (page > imageFiles.length || page < 1) {
                return reject(new Error(`Page not found. Found ${imageFiles.length} images, requested page ${page}`));
            }
            
            const targetFile = imageFiles[page - 1];
            
            console.log(`[${new Date().toISOString()}] 📖 CBR: Extracting file ${targetFile} from ${path.basename(filePath)}`);
            
            const escapedFilePath = filePath.replace(/"/g, '\"');
            const escapedTargetFile = targetFile.replace(/"/g, '\"');
            exec(`unrar p -inul "${escapedFilePath}" "${escapedTargetFile}"`, { encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
                if (err) {
                    console.error(`[${new Date().toISOString()}] ❌ CBR: Extraction failed for ${targetFile}`);
                    console.error(`[${new Date().toISOString()}] ❌ CBR: Error: ${err.message}`);
                    console.error(`[${new Date().toISOString()}] ❌ CBR: stderr: ${stderr}`);
                    console.error(`[${new Date().toISOString()}] ❌ CBR: Available files: ${imageFiles.slice(0, 10).join(', ')}`);
                    console.log(`[${new Date().toISOString()}] 🔄 CBR: Trying fallback extraction method`);
                    return extractFromCBZ(filePath, page, res).then(resolve).catch(reject);
                }
                
                const mimeType = getImageMimeType(targetFile);
                
                res.setHeader('Content-Type', mimeType);
                res.send(stdout);
                resolve();
            });
        } catch (error) {
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