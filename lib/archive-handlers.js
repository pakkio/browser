const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const yauzl = require('yauzl');
const { createExtractorFromFile } = require('node-unrar-js');
const tar = require('tar-stream');
const zlib = require('zlib');
const { baseDir, mimeTypes } = require('./config');

async function serveArchiveContents(req, res, cache) {
    const requestedFile = req.query.path;
    const subPath = req.query.subPath || '';
    console.log(`[${new Date().toISOString()}] GET /archive-contents - file: "${requestedFile}", subPath: "${subPath}"`);
    
    if (!requestedFile) {
        console.log(`[${new Date().toISOString()}] ❌ Archive contents: File path is required`);
        return res.status(400).send('File path is required');
    }
    
    const filePath = path.join(baseDir, requestedFile);
    
    if (!filePath.startsWith(baseDir)) {
        console.log(`[${new Date().toISOString()}] ❌ Archive contents: Forbidden access to ${filePath}`);
        return res.status(403).send('Forbidden');
    }
    
    const ext = path.extname(filePath).toLowerCase();
    const isGzipped = filePath.endsWith('.tar.gz') || ext === '.tgz';
    
    if (!['zip', 'rar', 'tar'].includes(ext.replace('.', '')) && !isGzipped) {
        console.log(`[${new Date().toISOString()}] ❌ Archive contents: Not a supported archive: ${filePath}`);
        return res.status(400).send('Not a supported archive format');
    }
    
    try {
        let contents = [];
        
        if (ext === '.zip') {
            contents = await getZipContents(filePath, subPath, cache);
        } else if (ext === '.rar') {
            contents = await getRarContents(filePath, subPath, cache);
        } else if (ext === '.tar' || isGzipped) {
            contents = await getTarContents(filePath, subPath, isGzipped, cache);
        }
        
        console.log(`[${new Date().toISOString()}] ✅ Archive contents: Found ${contents.length} items`);
        res.json(contents);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Archive contents error: ${error.message}`);
        res.status(500).send(`Archive reading error: ${error.message}`);
    }
}

async function serveArchiveFile(req, res) {
    const archivePath = req.query.archive;
    const filePath = req.query.file;
    console.log(`[${new Date().toISOString()}] GET /archive-file - archive: "${archivePath}", file: "${filePath}"`);
    
    if (!archivePath || !filePath) {
        console.log(`[${new Date().toISOString()}] ❌ Archive file: Archive and file path are required`);
        return res.status(400).send('Archive and file path are required');
    }
    
    const fullArchivePath = path.join(baseDir, archivePath);
    
    if (!fullArchivePath.startsWith(baseDir)) {
        console.log(`[${new Date().toISOString()}] ❌ Archive file: Forbidden access to ${fullArchivePath}`);
        return res.status(403).send('Forbidden');
    }
    
    const ext = path.extname(fullArchivePath).toLowerCase();
    const isGzipped = fullArchivePath.endsWith('.tar.gz') || ext === '.tgz';
    
    try {
        if (ext === '.zip') {
            await extractFileFromZip(fullArchivePath, filePath, res);
        } else if (ext === '.rar') {
            await extractFileFromRar(fullArchivePath, filePath, res);
        } else if (ext === '.tar' || isGzipped) {
            await extractFileFromTar(fullArchivePath, filePath, res, isGzipped);
        } else {
            throw new Error('Unsupported archive format');
        }
        
        console.log(`[${new Date().toISOString()}] ✅ Archive file extraction completed`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Archive file extraction error: ${error.message}`);
        res.status(500).send(`File extraction error: ${error.message}`);
    }
}

async function getZipContents(filePath, subPath, cache) {
    // Generate cache key including subPath
    const cacheKey = cache.generateKey(filePath, 'zip-contents', subPath);
    
    // Check disk cache first
    const cachedContents = await cache.get('archive-contents', cacheKey, filePath);
    if (cachedContents) {
        return cachedContents;
    }
    
    return new Promise((resolve, reject) => {
        yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
            if (err) return reject(err);
            
            const contents = [];
            const entries = new Map();
            
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                const fullPath = entry.fileName;
                
                // Skip directories ending with / and files not in the subPath
                if (subPath && !fullPath.startsWith(subPath + '/') && fullPath !== subPath) {
                    zipfile.readEntry();
                    return;
                }
                
                let relativePath = subPath ? fullPath.slice(subPath.length + 1) : fullPath;
                if (relativePath.startsWith('/')) relativePath = relativePath.slice(1);
                
                // Skip empty paths and nested files/directories
                if (!relativePath || relativePath.includes('/')) {
                    if (relativePath.includes('/')) {
                        // Add directory entry
                        const dirName = relativePath.split('/')[0];
                        if (!entries.has(dirName)) {
                            entries.set(dirName, {
                                name: dirName,
                                isDirectory: true,
                                size: null,
                                modified: null
                            });
                        }
                    }
                    zipfile.readEntry();
                    return;
                }
                
                entries.set(relativePath, {
                    name: relativePath,
                    isDirectory: false,
                    size: entry.uncompressedSize,
                    modified: entry.getLastModDate ? entry.getLastModDate().toISOString() : null
                });
                
                zipfile.readEntry();
            });
            
            zipfile.on('end', async () => {
                const result = Array.from(entries.values()).sort((a, b) => {
                    if (a.isDirectory && !b.isDirectory) return -1;
                    if (!a.isDirectory && b.isDirectory) return 1;
                    return a.name.localeCompare(b.name);
                });
                
                // Cache the result
                await cache.set('archive-contents', cacheKey, result, filePath);
                resolve(result);
            });
            
            zipfile.on('error', reject);
        });
    });
}

async function getRarContents(filePath, subPath, cache) {
    // Generate cache key including subPath
    const cacheKey = cache.generateKey(filePath, 'rar-contents', subPath);
    
    // Check disk cache first
    const cachedContents = await cache.get('archive-contents', cacheKey, filePath);
    if (cachedContents) {
        return cachedContents;
    }
    
    try {
        const extractor = await createExtractorFromFile({ filepath: filePath });
        const list = await extractor.getFileList();
        
        let fileHeaders = [];
        if (list && list.fileHeaders) {
            fileHeaders = Array.isArray(list.fileHeaders) ? list.fileHeaders : Array.from(list.fileHeaders);
        } else if (Array.isArray(list)) {
            fileHeaders = list;
        }
        
        const contents = [];
        const directories = new Set();
        
        for (const header of fileHeaders) {
            const fullPath = header.name || header.filename;
            if (!fullPath) continue;
            
            // Filter by subPath
            if (subPath && !fullPath.startsWith(subPath + '/') && fullPath !== subPath) {
                continue;
            }
            
            let relativePath = subPath ? fullPath.slice(subPath.length + 1) : fullPath;
            if (relativePath.startsWith('/')) relativePath = relativePath.slice(1);
            
            if (!relativePath) continue;
            
            if (relativePath.includes('/')) {
                // Add directory entry
                const dirName = relativePath.split('/')[0];
                directories.add(dirName);
            } else {
                contents.push({
                    name: relativePath,
                    isDirectory: false,
                    size: header.unpSize || header.uncompressedSize || null,
                    modified: header.time ? new Date(header.time).toISOString() : null
                });
            }
        }
        
        // Add directories
        for (const dirName of directories) {
            contents.push({
                name: dirName,
                isDirectory: true,
                size: null,
                modified: null
            });
        }
        
        const result = contents.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });
        
        // Cache the result
        await cache.set('archive-contents', cacheKey, result, filePath);
        return result;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ RAR contents error: ${error.message}`);
        throw error;
    }
}

async function getTarContents(filePath, subPath, isGzipped, cache) {
    // Generate cache key including subPath and compression type
    const cacheKey = cache.generateKey(filePath, 'tar-contents', `${subPath}:${isGzipped}`);
    
    // Check disk cache first
    const cachedContents = await cache.get('archive-contents', cacheKey, filePath);
    if (cachedContents) {
        return cachedContents;
    }
    
    return new Promise((resolve, reject) => {
        const contents = [];
        const directories = new Set();
        
        const extract = tar.extract();
        
        extract.on('entry', (header, stream, next) => {
            const fullPath = header.name;
            
            // Filter by subPath
            if (subPath && !fullPath.startsWith(subPath + '/') && fullPath !== subPath) {
                stream.resume();
                return next();
            }
            
            let relativePath = subPath ? fullPath.slice(subPath.length + 1) : fullPath;
            if (relativePath.startsWith('/')) relativePath = relativePath.slice(1);
            
            if (!relativePath) {
                stream.resume();
                return next();
            }
            
            if (relativePath.includes('/')) {
                // Add directory entry
                const dirName = relativePath.split('/')[0];
                directories.add(dirName);
            } else {
                contents.push({
                    name: relativePath,
                    isDirectory: header.type === 'directory',
                    size: header.size || null,
                    modified: header.mtime ? header.mtime.toISOString() : null
                });
            }
            
            stream.resume();
            next();
        });
        
        extract.on('finish', async () => {
            // Add directories
            for (const dirName of directories) {
                contents.push({
                    name: dirName,
                    isDirectory: true,
                    size: null,
                    modified: null
                });
            }
            
            const result = contents.sort((a, b) => {
                if (a.isDirectory && !b.isDirectory) return -1;
                if (!a.isDirectory && b.isDirectory) return 1;
                return a.name.localeCompare(b.name);
            });
            
            // Cache the result
            await cache.set('archive-contents', cacheKey, result, filePath);
            resolve(result);
        });
        
        extract.on('error', reject);
        
        // Create read stream
        const readStream = fs.createReadStream(filePath);
        if (isGzipped) {
            readStream.pipe(zlib.createGunzip()).pipe(extract);
        } else {
            readStream.pipe(extract);
        }
    });
}

async function extractFileFromZip(archivePath, filePath, res) {
    return new Promise((resolve, reject) => {
        yauzl.open(archivePath, { lazyEntries: true }, (err, zipfile) => {
            if (err) return reject(err);
            
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                if (entry.fileName === filePath) {
                    zipfile.openReadStream(entry, (err, readStream) => {
                        if (err) return reject(err);
                        
                        const ext = path.extname(filePath).toLowerCase();
                        const mimeType = mimeTypes[ext] || 'application/octet-stream';
                        
                        res.setHeader('Content-Type', mimeType);
                        res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
                        
                        readStream.pipe(res);
                        readStream.on('end', resolve);
                        readStream.on('error', reject);
                    });
                } else {
                    zipfile.readEntry();
                }
            });
            
            zipfile.on('end', () => {
                reject(new Error('File not found in archive'));
            });
        });
    });
}

async function extractFileFromRar(archivePath, filePath, res) {
    try {
        const extractor = await createExtractorFromFile({ filepath: archivePath });
        const extracted = await extractor.extract({ files: [filePath] });
        
        let fileBuffer = null;
        let filesArray = [];
        
        if (extracted.files) {
            filesArray = Array.isArray(extracted.files) ? extracted.files : Array.from(extracted.files);
        }
        
        if (filesArray.length > 0) {
            const file = filesArray[0];
            if (file.extraction) {
                fileBuffer = Buffer.from(file.extraction);
            } else if (file.fileData) {
                fileBuffer = Buffer.from(file.fileData);
            } else if (file.data) {
                fileBuffer = Buffer.from(file.data);
            }
        }
        
        if (!fileBuffer) {
            throw new Error('Failed to extract file from RAR archive');
        }
        
        const ext = path.extname(filePath).toLowerCase();
        const mimeType = mimeTypes[ext] || 'application/octet-stream';
        
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
        res.send(fileBuffer);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ RAR extraction error: ${error.message}`);
        throw error;
    }
}

async function extractFileFromTar(archivePath, filePath, res, isGzipped) {
    return new Promise((resolve, reject) => {
        const extract = tar.extract();
        let found = false;
        
        extract.on('entry', (header, stream, next) => {
            if (header.name === filePath) {
                found = true;
                
                const ext = path.extname(filePath).toLowerCase();
                const mimeType = mimeTypes[ext] || 'application/octet-stream';
                
                res.setHeader('Content-Type', mimeType);
                res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
                
                stream.pipe(res);
                stream.on('end', resolve);
                stream.on('error', reject);
            } else {
                stream.resume();
            }
            next();
        });
        
        extract.on('finish', () => {
            if (!found) {
                reject(new Error('File not found in archive'));
            }
        });
        
        extract.on('error', reject);
        
        // Create read stream
        const readStream = fs.createReadStream(archivePath);
        if (isGzipped) {
            readStream.pipe(zlib.createGunzip()).pipe(extract);
        } else {
            readStream.pipe(extract);
        }
    });
}

module.exports = {
    serveArchiveContents,
    serveArchiveFile
};