const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const yauzl = require('yauzl');
const { createExtractorFromFile } = require('node-unrar-js');
const tar = require('tar');
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
    const isTar = ext === '.tar' || filePath.endsWith('.tar');
    const isTgz = ext === '.tgz' || filePath.endsWith('.tgz');
    const isTarGz = filePath.endsWith('.tar.gz');
    const isOar = ext === '.oar' || filePath.endsWith('.oar');
    // const isGzipped = isTarGz || isTgz; // No longer used
    
    if (!['zip', 'rar', 'tar', 'tgz', 'tar.gz', 'oar'].includes(ext.replace('.', '')) && !isTar && !isTgz && !isTarGz && !isOar) {
        console.log(`[${new Date().toISOString()}] ❌ Archive contents: Not a supported archive: ${filePath}`);
        return res.status(400).send('Not a supported archive format');
    }
    
    try {
        let contents = [];
        
        if (ext === '.zip') {
            contents = await getZipContents(filePath, subPath, cache);
        } else if (ext === '.rar') {
            contents = await getRarContents(filePath, subPath, cache);
        } else if (isTar || isTgz || isTarGz || isOar) {
            contents = await getTarContents(filePath, subPath, cache);
        }
        
        console.log(`[${new Date().toISOString()}] ✅ Archive contents: Found ${contents.length} items`);
        res.json(contents);
    } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Archive contents error:`, error);
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
    const isTar = ext === '.tar' || fullArchivePath.endsWith('.tar');
    const isTgz = ext === '.tgz' || fullArchivePath.endsWith('.tgz');
    const isTarGz = fullArchivePath.endsWith('.tar.gz');
    const isOar = ext === '.oar' || fullArchivePath.endsWith('.oar');
    // const isGzipped = isTarGz || isTgz; // No longer used
    
    try {
        if (ext === '.zip') {
            await extractFileFromZip(fullArchivePath, filePath, res);
        } else if (ext === '.rar') {
            await extractFileFromRar(fullArchivePath, filePath, res);
        } else if (isTar || isTgz || isTarGz || isOar) {
            await extractFileFromTar(fullArchivePath, filePath, res);
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
        console.log(`[archive-handlers] Entering serveArchiveContents for ${requestedFile}, subPath=${subPath}`);
        contents = await getTarContents(filePath, subPath, cache);
    } catch (error) {
        throw error;
    }
}

async function getTarContents(filePath, subPath, cache) {
    const cacheKey = cache.generateKey(filePath, 'tar-contents', `${subPath}`);
    const cachedContents = await cache.get('archive-contents', cacheKey, filePath);
    if (cachedContents) return cachedContents;

    const contents = [];
    const directories = new Set();
    let tarError = null;
    try {
        await tar.t({
            file: filePath,
            onentry: entry => {
                const fullPath = entry.path;
                if (subPath && !fullPath.startsWith(subPath + '/') && fullPath !== subPath) return;
                let relativePath = subPath ? fullPath.slice(subPath.length + 1) : fullPath;
                if (relativePath.startsWith('/')) relativePath = relativePath.slice(1);
                if (!relativePath) return;
                if (relativePath.includes('/')) {
                    const dirName = relativePath.split('/')[0];
                    directories.add(dirName);
                } else {
                    contents.push({
                        name: relativePath,
                        isDirectory: entry.type === 'Directory',
                        size: entry.size || null,
                        modified: entry.mtime ? entry.mtime.toISOString() : null
                    });
                }
            }
        });
    } catch (err) {
        tarError = err;
    }

    // If tar.t failed, try CLI fallback for .oar/.tar/.tgz/.tar.gz
    if (tarError) {
        const ext = path.extname(filePath).toLowerCase();
        const isOar = ext === '.oar' || filePath.endsWith('.oar');
        const isTgz = ext === '.tgz' || filePath.endsWith('.tgz');
        const isTarGz = filePath.endsWith('.tar.gz');
        const isTar = ext === '.tar' || filePath.endsWith('.tar');
        if (isOar || isTar || isTgz || isTarGz) {
            // Try system tar CLI
            const { exec } = require('child_process');
            const tarArgs = [];
            if (isTgz || isTarGz || isOar) {
                tarArgs.push('-tzf', filePath);
            } else {
                tarArgs.push('-tf', filePath);
            }
            try {
                const output = await new Promise((resolve, reject) => {
                    exec(`tar ${tarArgs.join(' ')}`, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
                        if (error) return reject(error);
                        resolve(stdout);
                    });
                });
                // Parse output
                const seen = new Set();
                output.split('\n').forEach(line => {
                    if (!line) return;
                    let fullPath = line.trim();
                    if (subPath && !fullPath.startsWith(subPath + '/') && fullPath !== subPath) return;
                    let relativePath = subPath ? fullPath.slice(subPath.length + 1) : fullPath;
                    if (relativePath.startsWith('/')) relativePath = relativePath.slice(1);
                    if (!relativePath) return;
                    if (relativePath.includes('/')) {
                        const dirName = relativePath.split('/')[0];
                        if (!seen.has(dirName)) {
                            directories.add(dirName);
                            seen.add(dirName);
                        }
                    } else {
                        contents.push({
                            name: relativePath,
                            isDirectory: false, // Can't detect dir from tar CLI output
                            size: null,
                            modified: null
                        });
                    }
                });
            } catch (cliErr) {
                console.error(`[archive-handlers] Both node-tar and CLI tar failed for ${filePath}:`, tarError, cliErr);
                throw tarError; // Prefer original error
            }
        } else {
            throw tarError;
        }
    }

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

    await cache.set('archive-contents', cacheKey, result, filePath);
    return result;
}


const TEXT_EXTENSIONS = [
    '.txt', '.md', '.js', '.css', '.json', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.go', '.rs', '.csv', '.srt', '.xml', '.yaml', '.yml', '.ini', '.conf', '.log', '.sh', '.bat', '.ps1', '.sql', '.php', '.rb', '.swift', '.kt', '.dart', '.r', '.scala', '.clj', '.elm', '.vue', '.jsx', '.tsx', '.ts', '.less', '.scss', '.sass', '.styl', '.svelte', '.astro', '.lsl', '.lua', '.pl', '.asm', '.s', '.vb', '.pas', '.f90', '.f95', '.f03', '.f08', '.for', '.cobol', '.cob', '.zig', '.m', '.mm', '.groovy', '.gradle', '.cmake', '.dockerfile'
];

function isTextExtension(ext) {
    return TEXT_EXTENSIONS.includes(ext);
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
                        if (isTextExtension(ext)) {
                            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                            res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
                            readStream.pipe(res);
                            readStream.on('end', resolve);
                            readStream.on('error', reject);
                        } else {
                            // Hex dump mode
                            const chunks = [];
                            let bytesRead = 0;
                            readStream.on('data', chunk => {
                                if (bytesRead < 512) {
                                    const needed = Math.min(512 - bytesRead, chunk.length);
                                    chunks.push(chunk.slice(0, needed));
                                    bytesRead += needed;
                                    if (bytesRead >= 512) readStream.destroy();
                                }
                            });
                            readStream.on('end', () => {
                                const buffer = Buffer.concat(chunks);
                                const hex = buffer.toString('hex').match(/.{1,2}/g).map((b, i) => (i % 16 === 0 ? (i ? '\n' : '') + ('0000' + (i).toString(16)).slice(-4) + ': ' : '') + b + (i % 2 === 1 ? ' ' : '')).join('').replace(/\n/g, '\n');
                                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                                res.setHeader('X-Content-Mode', 'hex');
                                res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}.hex"`);
                                res.end(hex);
                                resolve();
                            });
                            readStream.on('error', reject);
                        }
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
        console.log(`[archive-handlers] Entering extractFileFromRar for ${archivePath}, filePath=${filePath}`);
        const extractor = await createExtractorFromFile({ filepath: archivePath });
        const list = await extractor.getFileList();
        let fileHeaders = [];
        if (list && list.fileHeaders) {
            fileHeaders = Array.isArray(list.fileHeaders) ? list.fileHeaders : Array.from(list.fileHeaders);
        } else if (Array.isArray(list)) {
            fileHeaders = list;
        }
        let found = false;
        for (const header of fileHeaders) {
            if ((header.name || header.filename) === filePath) {
                found = true;
                const ext = path.extname(filePath).toLowerCase();
                const stream = await extractor.stream(header);
                if (isTextExtension(ext)) {
                    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                    res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
                    stream.pipe(res);
                    stream.on('end', () => {});
                    stream.on('error', (err) => { throw err; });
                } else {
                    // Hex dump mode
                    const chunks = [];
                    let bytesRead = 0;
                    stream.on('data', chunk => {
                        if (bytesRead < 512) {
                            const needed = Math.min(512 - bytesRead, chunk.length);
                            chunks.push(chunk.slice(0, needed));
                            bytesRead += needed;
                            if (bytesRead >= 512) stream.destroy();
                        }
                    });
                    stream.on('end', () => {
                        const buffer = Buffer.concat(chunks);
                        const hex = buffer.toString('hex').match(/.{1,2}/g).map((b, i) => (i % 16 === 0 ? (i ? '\n' : '') + ('0000' + (i).toString(16)).slice(-4) + ': ' : '') + b + (i % 2 === 1 ? ' ' : '')).join('').replace(/\n/g, '\n');
                        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                        res.setHeader('X-Content-Mode', 'hex');
                        res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}.hex"`);
                        res.end(hex);
                    });
                    stream.on('error', (err) => { throw err; });
                }
                break;
            }
        }
        if (!found) throw new Error('File not found in archive');
    } catch (error) {
        throw error;
    }
}

async function extractFileFromTar(archivePath, filePath, res) {
    let found = false;
    await tar.t({
        file: archivePath,
        onentry: entry => {
            if (entry.path === filePath) {
                found = true;
                const ext = path.extname(filePath).toLowerCase();
                if (isTextExtension(ext)) {
                    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                    res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
                    entry.pipe(res);
                } else {
                    // Hex dump mode
                    const chunks = [];
                    let bytesRead = 0;
                    entry.on('data', chunk => {
                        if (bytesRead < 512) {
                            const needed = Math.min(512 - bytesRead, chunk.length);
                            chunks.push(chunk.slice(0, needed));
                            bytesRead += needed;
                            if (bytesRead >= 512) entry.destroy();
                        }
                    });
                    entry.on('end', () => {
                        const buffer = Buffer.concat(chunks);
                        const hex = buffer.toString('hex').match(/.{1,2}/g).map((b, i) => (i % 16 === 0 ? (i ? '\n' : '') + ('0000' + (i).toString(16)).slice(-4) + ': ' : '') + b + (i % 2 === 1 ? ' ' : '')).join('').replace(/\n/g, '\n');
                        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                        res.setHeader('X-Content-Mode', 'hex');
                        res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}.hex"`);
                        res.end(hex);
                    });
                    entry.on('error', (err) => { throw err; });
                }
            }
        }
    });
    if (!found) throw new Error('File not found in archive');
}


module.exports = {
    serveArchiveContents,
    serveArchiveFile
};
