const fs = require('fs');
const path = require('path');
const { exec, execFile, spawnSync } = require('child_process');
const yauzl = require('yauzl');
const { createExtractorFromFile, createExtractorFromData } = require('node-unrar-js');
const logger = require('./logger');
const pdf2pic = require('pdf2pic');
// Lazy-load pdfjs-dist only when needed (avoids Jest ESM parsing at require time)
async function getPdfPageCount(pdfPath) {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(fs.readFileSync(pdfPath));
    const doc = await getDocument({ data }).promise;
    return doc.numPages;
}

async function extractFileToTemp(archivePath, fileInArchive, tempDir, uniqueName = null) {
    return new Promise((resolve, reject) => {
        yauzl.open(archivePath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
            if (err) return reject(err);
            
            let found = false;
            let hasError = false;
            
            const timeout = setTimeout(() => {
                hasError = true;
                if (zipfile) zipfile.close();
                reject(new Error(`File extraction timeout: ${fileInArchive}`));
            }, 30000);
            
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                if (hasError) return;
                
                if (entry.fileName === fileInArchive) {
                    found = true;
                    clearTimeout(timeout);
                    zipfile.openReadStream(entry, (err, readStream) => {
                        if (err) {
                            zipfile.close();
                            return reject(err);
                        }
                        const fileName = uniqueName || path.basename(fileInArchive);
                        const tempFilePath = path.join(tempDir, fileName);
                        const writeStream = fs.createWriteStream(tempFilePath);
                        readStream.pipe(writeStream);
                        writeStream.on('finish', () => {
                            zipfile.close();
                            resolve(tempFilePath);
                        });
                        writeStream.on('error', (err) => {
                            zipfile.close();
                            reject(err);
                        });
                    });
                } else {
                    zipfile.readEntry();
                }
            });
            
            zipfile.on('end', () => {
                if (hasError) return;
                clearTimeout(timeout);
                zipfile.close();
                if (!found) {
                    reject(new Error(`File not found in archive: ${fileInArchive}`));
                }
            });
            
            zipfile.on('error', (err) => {
                if (hasError) return;
                hasError = true;
                clearTimeout(timeout);
                zipfile.close();
                reject(err);
            });
        });
    });
}
const { baseDir, getImageMimeType, getVideoMimeType } = require('./config');

const pendingRequests = new Map();
const requestCounts = new Map(); // Track request frequency per file
const MAX_CONCURRENT_REQUESTS = 10; // Prevent too many simultaneous requests
const MAX_REQUESTS_PER_FILE = 120; // Prevent request spam for same file
const REQUEST_WINDOW_MS = 60 * 1000; // Each request counts against its file for this long

// Handle unhandled promise rejections to prevent server crashes
process.on('unhandledRejection', (reason, promise) => {
    if (reason && reason.message && reason.message.includes('Archive file is corrupted')) {
        logger.error(` ❌ Unhandled promise rejection (archive corruption): ${reason.message}`);
        // Don't crash the server for archive corruption errors
        return;
    }
    logger.error(` ❌ Unhandled promise rejection:`, reason);
    // Let other unhandled rejections be handled normally
});

let unrarCommand;

/**
 * Locate a native unrar (on PATH, or the one shipped with WinRAR) once and remember it.
 * Returns null when none runs; the node-unrar-js (WASM) extractor is then used instead.
 */
function findUnrar() {
    if (unrarCommand !== undefined) return unrarCommand;
    unrarCommand = null;
    const candidates = ['unrar'];
    if (process.platform === 'win32') {
        for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
            candidates.push(path.join(base, 'WinRAR', 'UnRAR.exe'));
        }
    }
    for (const candidate of candidates) {
        const probe = spawnSync(candidate, [], { timeout: 5000, windowsHide: true });
        if (probe && !probe.error) {
            unrarCommand = candidate;
            break;
        }
    }
    logger.info(unrarCommand ? ` 📖 Using native unrar: ${unrarCommand}` : ' 📖 No native unrar found, using node-unrar-js');
    return unrarCommand;
}

/** Shell-quoted unrar command for exec(); keeps the bare name when none was detected. */
function unrarShellCommand() {
    const cmd = findUnrar();
    return cmd && cmd.includes(path.sep) ? `"${cmd}"` : 'unrar';
}

/** List the entry names of a RAR archive with the native unrar (bare list, UTF-8, no password prompt). */
function listRarEntries(unrar, filePath) {
    return new Promise((resolve, reject) => {
        execFile(unrar, ['lb', '-p-', '-scur', filePath], {
            encoding: 'buffer',
            maxBuffer: 50 * 1024 * 1024,
            timeout: 120000,
            windowsHide: true
        }, (err, stdout) => {
            if (err) return reject(err);
            // -scur asks for Unicode output, which unrar writes as UTF-16LE; fall back to UTF-8 otherwise
            const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout));
            const text = buf.includes(0) ? buf.toString('utf16le') : buf.toString('utf8');
            resolve(text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean));
        });
    });
}

/**
 * Extract one entry from a RAR archive in-process with node-unrar-js (WASM).
 * Used when the `unrar` binary is missing (e.g. running under Windows node) or fails.
 */
async function extractRarEntry(filePath, entryName) {
    const data = await fs.promises.readFile(filePath);
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const extractor = await createExtractorFromData({ data: arrayBuffer });
    const { files } = extractor.extract({ files: [entryName] });
    for (const file of files) {
        if (file.extraction) {
            return Buffer.from(file.extraction);
        }
    }
    throw new Error(`Entry not found in RAR archive: ${entryName}`);
}

/**
 * Read the first `length` bytes of a file (for magic-number checks)
 * without loading the whole archive into memory.
 */
function readFileHeader(filePath, length) {
    const fd = fs.openSync(filePath, 'r');
    try {
        const buffer = Buffer.alloc(length);
        const bytesRead = fs.readSync(fd, buffer, 0, length, 0);
        return buffer.subarray(0, bytesRead);
    } finally {
        fs.closeSync(fd);
    }
}

async function serveComicPreview(req, res, cache) {
    const requestedFile = req.query.path;
    const page = parseInt(req.query.page) || 1;
    logger.info(` GET /comic-preview - file: "${requestedFile}", page: ${page}`);
    
    if (!requestedFile) {
        logger.warn(` ❌ Comic preview: File path is required`);
        return res.status(400).send('File path is required');
    }
    
    const filePath = path.join(baseDir, requestedFile);
    
    if (!filePath.startsWith(baseDir)) {
        logger.warn(` ❌ Comic preview: Forbidden access to ${filePath}`);
        return res.status(403).send('Forbidden');
    }
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
        logger.warn(` ❌ Comic preview: File not found: ${filePath}`);
        return res.status(404).send('File not found');
    }
    
    const ext = path.extname(filePath).toLowerCase();
    if (!['.cbz', '.cbr', '.zip'].includes(ext)) {
        logger.warn(` ❌ Archive preview: Not a supported archive: ${filePath}`);
        return res.status(400).send('Not a supported archive');
    }
    
    try {
        logger.info(` 🔄 Extracting comic page ${page} from ${ext} file...`);
        if (ext === '.cbz' || ext === '.zip') {
            await extractFromCBZ(filePath, page, res, cache);
        } else if (ext === '.cbr') {
            await extractFromCBR(filePath, page, res, cache);
        }
        logger.info(` ✅ Comic extraction completed`);
    } catch (error) {
        logger.error(` ❌ Comic extraction error: ${error.message}`);
        
        // Handle specific error types
        if (error.message.includes('File is not RAR archive') || 
            error.message.includes('central directory record signature not found') ||
            error.message.includes('file is truncated') ||
            error.message.includes('not a zip file') ||
            error.message.includes('Archive file is corrupted and cannot be processed') ||
            error.message.includes('File is not a valid ZIP archive')) {
            
            logger.warn(` ⚠️ Archive corruption detected, attempting fallback extraction: ${filePath}`);
            try {
                if (ext === '.cbr') {
                    await extractFromCBZ(filePath, page, res, cache);
                } else {
                    // For CBZ files, we can't do much more
                    return res.status(422).send('Archive file is corrupted or invalid');
                }
            } catch (zipError) {
                logger.error(` ❌ Comic extraction error (fallback): ${zipError.message}`);
                return res.status(422).send('Archive file is corrupted and cannot be processed');
            }
        } else if (error.message.includes('Page not found')) {
            return res.status(404).send(error.message);
        } else if (error.message.includes('Request limit exceeded') || error.message.includes('Server busy')) {
            res.setHeader('Retry-After', '5');
            return res.status(429).send(error.message);
        } else {
            // Generic error handling
            return res.status(500).send('Comic extraction failed due to an unexpected error');
        }
    }
}

async function serveArchiveVideo(req, res, cache) {
    const requestedFile = req.query.path;
    const fileName = req.query.fileName;
    logger.info(` GET /archive-video - file: "${requestedFile}", fileName: "${fileName}"`);
    
    if (!requestedFile || !fileName) {
        logger.warn(` ❌ Archive video: Archive path and file name are required`);
        return res.status(400).send('Archive path and file name are required');
    }
    
    const filePath = path.join(baseDir, requestedFile);
    
    if (!filePath.startsWith(baseDir)) {
        logger.warn(` ❌ Archive video: Forbidden access to ${filePath}`);
        return res.status(403).send('Forbidden');
    }
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
        logger.warn(` ❌ Archive video: File not found: ${filePath}`);
        return res.status(404).send('File not found');
    }
    
    const ext = path.extname(filePath).toLowerCase();
    if (!['.cbz', '.cbr', '.zip'].includes(ext)) {
        logger.warn(` ❌ Archive video: Not a supported archive: ${filePath}`);
        return res.status(400).send('Not a supported archive');
    }
    
    try {
        logger.info(` 🔄 Extracting video ${fileName} from ${ext} file...`);
        if (ext === '.cbz' || ext === '.zip') {
            await extractVideoFromCBZ(filePath, fileName, res);
        } else if (ext === '.cbr') {
            await extractVideoFromCBR(filePath, fileName, res);
        }
        logger.info(` ✅ Archive video extraction completed`);
    } catch (error) {
        logger.error(` ❌ Archive video extraction error: ${error.message}`);
        
        // Handle specific error types
        if (error.message.includes('File is not RAR archive') || 
            error.message.includes('central directory record signature not found') ||
            error.message.includes('file is truncated') ||
            error.message.includes('not a zip file') ||
            error.message.includes('Archive file is corrupted and cannot be processed') ||
            error.message.includes('File is not a valid ZIP archive')) {
            
            logger.warn(` ⚠️ Archive corruption detected, attempting fallback extraction: ${filePath}`);
            try {
                if (ext === '.cbr') {
                    await extractVideoFromCBZ(filePath, fileName, res);
                } else {
                    // For CBZ files, we can't do much more
                    return res.status(422).send('Archive file is corrupted or invalid');
                }
            } catch (zipError) {
                logger.error(` ❌ Archive video extraction error (fallback): ${zipError.message}`);
                return res.status(422).send('Archive file is corrupted and cannot be processed');
            }
        } else if (error.message.includes('File not found')) {
            return res.status(404).send(error.message);
        } else {
            // Generic error handling
            return res.status(500).send('Archive video extraction failed due to an unexpected error');
        }
    }
}

async function getComicInfo(req, res, cache) {
    const requestedFile = req.query.path;
    logger.info(` GET /api/comic-info - file: "${requestedFile}"`);
    
    if (!requestedFile) {
        logger.warn(` ❌ Comic info: File path is required`);
        return res.status(400).send('File path is required');
    }
    
    const filePath = path.join(baseDir, requestedFile);
    
    if (!filePath.startsWith(baseDir)) {
        logger.warn(` ❌ Comic info: Forbidden access to ${filePath}`);
        return res.status(403).send('Forbidden');
    }
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
        logger.warn(` ❌ Comic info: File not found: ${filePath}`);
        return res.status(404).send('File not found');
    }
    
    const ext = path.extname(filePath).toLowerCase();
    if (!['.cbz', '.cbr', '.zip'].includes(ext)) {
        logger.warn(` ❌ Archive info: Not a supported archive: ${filePath}`);
        return res.status(400).send('Not a supported archive');
    }
    
    // Add timeout wrapper for the entire operation
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error('Comic info retrieval timeout - file may be corrupted or too large'));
        }, 45000); // 45 second timeout
    });
    
    try {
        logger.info(` 🔄 Getting comic info for ${ext} file...`);
        const imageFiles = await Promise.race([
            getComicFileList(filePath, cache),
            timeoutPromise
        ]);
        
        res.json({
            pages: imageFiles.length,
            format: ext.replace('.', '').toUpperCase()
        });
        
        logger.info(` ✅ Comic info: Found ${imageFiles.length} pages`);
    } catch (error) {
        logger.error(` ❌ Comic info error: ${error.message}`);
        
        // Handle timeout errors
        if (error.message.includes('timeout')) {
            logger.warn(` ⚠️ Comic info timeout: ${filePath}`);
            return res.status(408).send('Request timeout - file may be corrupted or too large');
        }
        
        // Handle specific error types
        if (error.message.includes('File is not RAR archive') || 
            error.message.includes('central directory record signature not found') ||
            error.message.includes('file is truncated') ||
            error.message.includes('not a zip file') ||
            error.message.includes('Archive file is corrupted and cannot be processed') ||
            error.message.includes('File is not a valid ZIP archive')) {
            
            logger.warn(` ⚠️ Archive corruption detected, attempting fallback: ${filePath}`);
            try {
                if (ext === '.cbr') {
                    const imageFiles = await Promise.race([
                        getZipComicFileList(filePath),
                        timeoutPromise
                    ]);
                    res.json({
                        pages: imageFiles.length,
                        format: 'CBR (ZIP)'
                    });
                } else {
                    // For CBZ files, we can't do much more
                    return res.status(422).send('Archive file is corrupted or invalid');
                }
            } catch (zipError) {
                logger.error(` ❌ Comic info error (fallback): ${zipError.message}`);
                if (zipError.message.includes('timeout')) {
                    return res.status(408).send('Request timeout - file may be corrupted or too large');
                }
                return res.status(422).send('Archive file is corrupted and cannot be processed');
            }
        } else {
            // Generic error handling
            return res.status(500).send('Comic info retrieval failed due to an unexpected error');
        }
    }
}

async function extractFromCBZ(filePath, page, res, cache) {
    try {
        // Check if file exists before attempting to process
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        
        // Get the expanded file list that includes PDF pages
        const imageFiles = await getComicFileList(filePath, cache);
        
        if (page > imageFiles.length || page < 1) {
            throw new Error(`Page not found. Found ${imageFiles.length} images, requested page ${page}`);
        }

        const target = imageFiles[page - 1];
        // Handle both string format (from CBR fallback) and object format (from CBZ)
        const targetEntry = typeof target === 'string' ? target : target.file;
        const pdfPage = typeof target === 'object' ? target.pdfPage : null;

        if (pdfPage) {
            // Handle PDF page rendering
            const tempDir = path.join(__dirname, '..', '_temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir);
            }
            // Use unique temp file name to avoid conflicts during extraction
            const timestamp = Date.now();
            const randomId = Math.random().toString(36).substring(7);
            const uniqueName = `extract_${timestamp}_${randomId}_${path.basename(targetEntry)}`;
            const tempFilePath = await extractFileToTemp(filePath, targetEntry, tempDir, uniqueName);

            try {
                // Verify the temp file exists and is readable
                if (!fs.existsSync(tempFilePath)) {
                    throw new Error(`Temp PDF file not found: ${tempFilePath}`);
                }
                
                const stats = fs.statSync(tempFilePath);
                if (stats.size === 0) {
                    throw new Error(`Temp PDF file is empty: ${tempFilePath}`);
                }
                
                // Validate that it's actually a PDF file by checking header
                const pdfBuffer = fs.readFileSync(tempFilePath, { start: 0, end: 7 });
                const pdfHeader = pdfBuffer.toString('ascii', 0, 8);
                if (!pdfHeader.startsWith('%PDF-')) {
                    throw new Error(`Invalid PDF file format: ${tempFilePath} (header: ${pdfHeader})`);
                }
                
                // Verify the requested page number is valid
                try {
                    const pageCount = await getPdfPageCount(tempFilePath);
                    if (pdfPage > pageCount) {
                        throw new Error(`Requested page ${pdfPage} exceeds PDF page count ${pageCount}`);
                    }
                } catch (pageCountError) {
                    logger.warn(` ⚠️ Could not verify page count: ${pageCountError.message}, proceeding with conversion`);
                }
                
                const options = {
                    density: 150,
                    format: "png",
                    width: 1200,
                    height: 1600,
                    quality: 100
                };
                
                logger.info(` 🔄 Converting PDF page ${pdfPage} from ${path.basename(tempFilePath)}`);
                
                try {
                    const convert = pdf2pic.fromPath(tempFilePath, options);
                    
                    // Try different response types if buffer fails
                    let result;
                    let conversionError;
                    
                    // First attempt: try with buffer response type
                    try {
                        result = await convert(pdfPage, { responseType: "buffer" });
                        if (result && result.buffer && result.buffer.length > 0) {
                            res.setHeader('Content-Type', 'image/png');
                            res.send(result.buffer);
                            logger.info(` ✅ PDF page ${pdfPage} converted successfully (buffer: ${result.buffer.length} bytes)`);
                            return;
                        }
                    } catch (bufferError) {
                        conversionError = bufferError;
                        logger.warn(` ⚠️ Buffer conversion failed, trying base64: ${bufferError.message}`);
                    }
                    
                    // Second attempt: try with base64 response type
                    try {
                        result = await convert(pdfPage, { responseType: "base64" });
                        if (result && result.base64 && result.base64.length > 0) {
                            const buffer = Buffer.from(result.base64, 'base64');
                            if (buffer.length > 0) {
                                res.setHeader('Content-Type', 'image/png');
                                res.send(buffer);
                                logger.info(` ✅ PDF page ${pdfPage} converted successfully (base64->buffer: ${buffer.length} bytes)`);
                                return;
                            }
                        }
                    } catch (base64Error) {
                        logger.warn(` ⚠️ Base64 conversion failed: ${base64Error.message}`);
                    }
                    
                    // Third attempt: try without specifying response type (default)
                    try {
                        result = await convert(pdfPage);
                        if (result) {
                            // Check for different possible result formats
                            if (result.buffer && result.buffer.length > 0) {
                                res.setHeader('Content-Type', 'image/png');
                                res.send(result.buffer);
                                logger.info(` ✅ PDF page ${pdfPage} converted successfully (default->buffer: ${result.buffer.length} bytes)`);
                                return;
                            } else if (result.base64 && result.base64.length > 0) {
                                const buffer = Buffer.from(result.base64, 'base64');
                                if (buffer.length > 0) {
                                    res.setHeader('Content-Type', 'image/png');
                                    res.send(buffer);
                                    logger.info(` ✅ PDF page ${pdfPage} converted successfully (default->base64->buffer: ${buffer.length} bytes)`);
                                    return;
                                }
                            } else if (result.path && fs.existsSync(result.path)) {
                                // Handle file path result
                                const imageBuffer = fs.readFileSync(result.path);
                                res.setHeader('Content-Type', 'image/png');
                                res.send(imageBuffer);
                                logger.info(` ✅ PDF page ${pdfPage} converted successfully (file->buffer: ${imageBuffer.length} bytes)`);
                                // Clean up temporary file
                                try {
                                    fs.unlinkSync(result.path);
                                } catch (unlinkErr) {
                                    logger.warn(` ⚠️ Failed to cleanup converted image: ${unlinkErr.message}`);
                                }
                                return;
                            }
                        }
                    } catch (defaultError) {
                        logger.warn(` ⚠️ Default conversion failed: ${defaultError.message}`);
                    }
                    
                    // If all conversion attempts failed, log detailed error info and throw
                    logger.error(` ❌ PDF conversion result:`, {
                        hasResult: !!result,
                        hasBuffer: !!(result && result.buffer),
                        bufferLength: result && result.buffer ? result.buffer.length : 'N/A',
                        hasBase64: !!(result && result.base64),
                        base64Length: result && result.base64 ? result.base64.length : 'N/A',
                        hasPath: !!(result && result.path),
                        pathExists: result && result.path ? fs.existsSync(result.path) : 'N/A',
                        originalError: conversionError ? conversionError.message : 'None'
                    });
                    throw new Error(`PDF to image conversion failed - no valid result for page ${pdfPage}. Original error: ${conversionError ? conversionError.message : 'Multiple conversion attempts failed'}`);
                } catch (conversionDetailError) {
                    logger.error(` ❌ Detailed PDF conversion error:`, conversionDetailError);
                    throw conversionDetailError;
                }
            } catch (conversionError) {
                logger.error(` ❌ PDF conversion error: ${conversionError.message}`);
                throw new Error(`PDF conversion failed: ${conversionError.message}`);
            } finally {
                try {
                    if (fs.existsSync(tempFilePath)) {
                        fs.unlinkSync(tempFilePath);
                        logger.info(` 🧹 Cleaned up temp file: ${path.basename(tempFilePath)}`);
                    }
                } catch (unlinkError) {
                    logger.warn(` ⚠️ Failed to cleanup temp file ${tempFilePath}: ${unlinkError.message}`);
                }
            }
        } else {
            // Handle regular image files
            return new Promise((resolve, reject) => {
                yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
                    if (err) {
                        return reject(err);
                    }
                    
                    let hasError = false;
                    const timeout = setTimeout(() => {
                        hasError = true;
                        if (zipfile) zipfile.close();
                        reject(new Error('Archive processing timeout'));
                    }, 30000);
                    
                    zipfile.readEntry();
                    zipfile.on('entry', (entry) => {
                        if (hasError) return;
                        
                        if (entry && entry.fileName === targetEntry) {
                            clearTimeout(timeout);
                            zipfile.openReadStream(entry, (err, readStream) => {
                                if (err) {
                                    zipfile.close();
                                    return reject(new Error(`Failed to extract page ${page}: ${err.message}`));
                                }

                                const mimeType = getImageMimeType(entry.fileName);
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
                        } else {
                            zipfile.readEntry();
                        }
                    });
                    
                    zipfile.on('end', () => {
                        if (hasError) return;
                        clearTimeout(timeout);
                        zipfile.close();
                        reject(new Error(`File ${targetEntry} not found in archive`));
                    });
                    
                    zipfile.on('error', (err) => {
                        if (hasError) return;
                        hasError = true;
                        clearTimeout(timeout);
                        zipfile.close();
                        reject(err);
                    });
                });
            });
        }
    } catch (error) {
        throw error;
    }
}

async function getZipComicFileList(filePath) {
    return new Promise((resolve, reject) => {
        // Check if file exists before attempting to open
        if (!fs.existsSync(filePath)) {
            return reject(new Error(`File not found: ${filePath}`));
        }
        
        // Basic file validation - check if it's a valid ZIP by reading first few bytes
        try {
            const buffer = readFileHeader(filePath, 4);
            const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);
            if (!isZip) {
                return reject(new Error('File is not a valid ZIP archive'));
            }
        } catch (validationError) {
            return reject(new Error('Unable to validate file format'));
        }
        
        try {
            yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
            if (err) {
                // Enhanced error handling for yauzl errors
                if (err.message.includes('central directory record signature not found')) {
                    return reject(new Error('Archive file is corrupted or not a valid ZIP file'));
                } else if (err.message.includes('file is truncated')) {
                    return reject(new Error('Archive file is truncated or incomplete'));
                } else if (err.message.includes('not a zip file') || err.message.includes('not a valid ZIP file')) {
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
                
                if (entry && entry.fileName) {
                    if (entry.fileName.trim().toLowerCase().match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|pdf)$/)) {
                        if (!imageFiles.includes(entry.fileName)) {
                            imageFiles.push(entry.fileName);
                        }
                    }
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
        } catch (error) {
            // Catch any synchronous errors from yauzl.open
            if (error.message.includes('central directory record signature not found')) {
                return reject(new Error('Archive file is corrupted or not a valid ZIP file'));
            } else if (error.message.includes('file is truncated')) {
                return reject(new Error('Archive file is truncated or incomplete'));
            } else if (error.message.includes('not a zip file') || error.message.includes('not a valid ZIP file')) {
                return reject(new Error('File is not a valid ZIP archive'));
            }
            return reject(error);
        }
    });
}

async function getComicFileList(filePath, cache) {
    const cacheKey = cache.generateKey(filePath, 'comic-list');
    logger.info(` 🔍 Looking for cache key: ${cacheKey} for file: ${path.basename(filePath)}`);
    const cachedList = await cache.get('comic-lists', cacheKey, filePath);
    if (cachedList) {
        logger.info(` 📋 Cache HIT: Using cached file list with ${cachedList.length} items`);
        return cachedList;
    }

    // Prevent multiple simultaneous processing of the same file
    const processingKey = `processing-${cacheKey}`;
    if (pendingRequests.has(processingKey)) {
        logger.info(` ⏳ Processing already in progress for key ${cacheKey}, waiting for existing request...`);
        return pendingRequests.get(processingKey);
    }

    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.cbz' || ext === '.zip') {
        const processingPromise = (async () => {
            try {
                // Double-check cache one more time before expensive processing
                const recheckedList = await cache.get('comic-lists', cacheKey, filePath);
                if (recheckedList) {
                    logger.info(` 📋 Cache HIT on recheck: Using cached file list with ${recheckedList.length} items`);
                    return recheckedList;
                }
                
                logger.info(` 🔄 Processing ZIP file list for cache key ${cacheKey} (no cache available)...`);
                const fileList = await getZipComicFileList(filePath);
                const expandedList = [];
                const processedFiles = new Set(); // Prevent duplicate processing
                
                for (const file of fileList) {
                    if (processedFiles.has(file)) continue;
                    processedFiles.add(file);
                    
                    if (path.extname(file).toLowerCase() === '.pdf') {
                        const tempDir = path.join(__dirname, '..', '_temp');
                        if (!fs.existsSync(tempDir)) {
                            fs.mkdirSync(tempDir);
                        }
                        
                        // Use unique temp file name to avoid conflicts
                        const timestamp = Date.now();
                        const randomId = Math.random().toString(36).substring(7);
                        const uniqueName = `${timestamp}_${randomId}_${path.basename(file)}`;
                        const tempFilePath = path.join(tempDir, uniqueName);
                        
                        logger.info(` 🔄 Extracting PDF: ${file} to ${tempFilePath}`);
                        await extractFileToTemp(filePath, file, tempDir, uniqueName);
                        logger.info(` ✅ Extracted to: ${tempFilePath}`);

                        try {
                            const pageCount = await getPdfPageCount(tempFilePath);
                            for (let i = 1; i <= pageCount; i++) {
                                expandedList.push({ file, pdfPage: i });
                            }
                        } catch (pdfError) {
                            logger.error(` ❌ PDF processing error for ${file}: ${pdfError.message}`);
                            // Skip this PDF if it can't be processed
                        } finally {
                            try {
                                if (fs.existsSync(tempFilePath)) {
                                    fs.unlinkSync(tempFilePath);
                                }
                            } catch (unlinkError) {
                                logger.warn(` ⚠️ Failed to cleanup temp file ${tempFilePath}: ${unlinkError.message}`);
                            }
                        }
                    } else {
                        expandedList.push({ file, type: 'image' });
                    }
                }
                await cache.set('comic-lists', cacheKey, expandedList, filePath);
                logger.info(` 💾 Cache SET: Successfully cached ${expandedList.length} items for key ${cacheKey}`);
                return expandedList;
            } catch (error) {
                logger.error(` ❌ ZIP: getComicFileList error: ${error.message}`);
                throw error;
            } finally {
                pendingRequests.delete(processingKey);
            }
        })();
        
        pendingRequests.set(processingKey, processingPromise);
        logger.info(` 🔄 Started processing for key ${cacheKey}, pending requests: ${pendingRequests.size}`);
        return processingPromise;
    }

    // ... (rest of the function for CBR files)

    
    // Handle RAR files (CBR)
    if (ext === '.cbr') {
        try {
            let entryNames = null;
            const unrar = findUnrar();
            if (unrar) {
                try {
                    entryNames = await listRarEntries(unrar, filePath);
                } catch (unrarErr) {
                    logger.warn(` ⚠️ CBR: native unrar listing failed (${unrarErr.message}), falling back to node-unrar-js`);
                }
            }

            if (!entryNames) {
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
                    logger.error(` ❌ Unexpected list structure from node-unrar-js:`, list);
                    throw new Error('Unexpected file list structure from RAR extractor');
                }
                entryNames = fileHeaders.map(header => header.name || header.filename);
            }

            const imageFiles = entryNames
                .filter(name => name && name.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|mp4|avi|mov|mkv|webm|mpg|mpeg|wmv)$/i))
                .sort();

            logger.info(` 📖 CBR: Found ${imageFiles.length} media files`);

            await cache.set('comic-lists', cacheKey, imageFiles, filePath);
            return imageFiles;
        } catch (error) {
            logger.error(` ❌ CBR: getComicFileList error with node-unrar-js: ${error.message}`);

            // Try fallback to ZIP extraction for misnamed CBR files
            if (error.message.includes('File is not RAR archive') ||
                error.message.includes('corrupted') ||
                error.message.includes('invalid') ||
                error.message.includes('truncated')) {

                logger.warn(` ⚠️ CBR: File may be a ZIP file with .cbr extension, trying ZIP extraction fallback...`);
                try {
                    const imageFiles = await getZipComicFileList(filePath);
                    logger.info(` ✅ CBR: Successfully extracted as ZIP - found ${imageFiles.length} files`);
                    // Return just the filenames (strings) to match CBR format, not objects
                    await cache.set('comic-lists', cacheKey, imageFiles, filePath);
                    return imageFiles;
                } catch (zipError) {
                    logger.error(` ❌ CBR: ZIP fallback also failed: ${zipError.message}`);
                    throw new Error('Archive file is corrupted or not a valid RAR/ZIP file');
                }
            } else if (error.message.includes('ENOENT') || error.message.includes('not found')) {
                throw new Error(`File not found: ${filePath}`);
            } else if (error.message.includes('EACCES') || error.message.includes('permission')) {
                throw new Error(`Permission denied accessing file: ${filePath}`);
            }

            throw error;
        }
    }
    
    throw new Error(`Unsupported archive format: ${ext}`);
}

async function extractFromCBR(filePath, page, res, cache) {
    const requestKey = `${filePath}:${page}`;
    
    // Prevent too many concurrent requests
    if (pendingRequests.size >= MAX_CONCURRENT_REQUESTS) {
        throw new Error('Server busy - too many concurrent comic requests. Please try again in a moment.');
    }
    
    // Prevent request spam for same file
    const fileRequestCount = requestCounts.get(filePath) || 0;
    if (fileRequestCount >= MAX_REQUESTS_PER_FILE) {
        throw new Error('Request limit exceeded for this file. Please try again later.');
    }
    
    if (pendingRequests.has(requestKey)) {
        return pendingRequests.get(requestKey);
    }
    
    // Increment request count
    requestCounts.set(filePath, fileRequestCount + 1);
    
    // Release this request's slot after the window so reading a long comic is not blocked
    setTimeout(() => {
        const currentCount = requestCounts.get(filePath) || 0;
        if (currentCount > 0) {
            requestCounts.set(filePath, Math.max(0, currentCount - 1));
        }
        if (currentCount <= 1) {
            requestCounts.delete(filePath);
        }
    }, REQUEST_WINDOW_MS).unref();

    const promise = new Promise(async (resolve, reject) => {
        try {
            // Check if file exists before attempting to process
            if (!fs.existsSync(filePath)) {
                return reject(new Error(`File not found: ${filePath}`));
            }

            // Basic file corruption detection
            try {
                const stats = fs.statSync(filePath);
                if (stats.size === 0) {
                    return reject(new Error('File is empty or corrupted - cannot process'));
                }
                
                // Check if file is accessible and has minimum expected size for RAR archive
                if (stats.size < 64) { // RAR files need at least this much for headers
                    return reject(new Error('File appears to be corrupted - insufficient size for valid RAR archive'));
                }
                
                // Quick RAR header validation - check for RAR signature
                const buffer = readFileHeader(filePath, 7);
                const rarSignatures = [
                    [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07], // RAR 1.5+
                    [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00], // RAR 5.0+
                ];
                
                const hasValidSignature = rarSignatures.some(sig => 
                    buffer.subarray(0, sig.length).equals(Buffer.from(sig))
                );
                
                if (!hasValidSignature) {
                    logger.warn(` ⚠️ CBR: File ${path.basename(filePath)} doesn't have valid RAR signature, may be corrupted or misnamed`);
                    // Don't fail here, let extraction attempt and fallback to CBZ if needed
                }
            } catch (validationError) {
                logger.warn(` ⚠️ CBR: Could not validate file ${path.basename(filePath)}: ${validationError.message}`);
                // Continue with extraction attempt
            }
            
            const imageFiles = await getComicFileList(filePath, cache);
            
            if (page > imageFiles.length || page < 1) {
                return reject(new Error(`Page not found. Found ${imageFiles.length} images, requested page ${page}`));
            }
            
            const targetFile = imageFiles[page - 1];
if (targetFile.pdfPage) {
    async function renderPdfPage(pdfPath, pageNum) {
    const pdf2pic = require("pdf2pic");
    const converter = pdf2pic.fromPath(pdfPath, {
        quality: 100,
        density: 300,
        saveFilename: `page_${pageNum}`,
        savePath: "/tmp/pdf_pages"
    });
    const filename = await converter(pageNum);
if (!fs.existsSync(filename.path)) {
    throw new Error(`Rendered file not found at path: ${filename.path}`);
}
    return filename.path;
}

// Render PDF page to image for response
    const renderedPath = await renderPdfPage(targetFile.file, targetFile.pdfPage);
    return res.sendFile(renderedPath);
}

            
            logger.info(` 📖 CBR: Extracting file ${targetFile} from ${path.basename(filePath)}`);
            
            const escapedFilePath = filePath.replace(/"/g, '\"');
            const escapedTargetFile = targetFile.replace(/"/g, '\"');
            
            // Add progressive timeout handling to prevent hanging
            let timeoutWarning = null;
            let finalTimeout = null;
            
            // Warning after 30 seconds
            timeoutWarning = setTimeout(() => {
                logger.warn(` ⚠️ CBR: Extraction taking longer than expected for ${path.basename(filePath)} (${targetFile}). This may indicate a large file or potential corruption.`);
            }, 30000);
            
            // Final timeout after 90 seconds (increased from 60)
            finalTimeout = setTimeout(() => {
                logger.error(` ⏰ CBR: Extraction timeout for ${path.basename(filePath)} after 90 seconds`);
                reject(new Error('CBR extraction timeout - The file is very large, corrupted, or the system is under heavy load. Please try again or check if the file is valid.'));
            }, 90000);
            
            const sendPage = (buffer) => {
                res.setHeader('Content-Type', getImageMimeType(targetFile));
                res.send(buffer);
                resolve();
            };

            const onUnrarResult = (err, stdout, stderr) => {
                // Clear both timeouts
                if (timeoutWarning) clearTimeout(timeoutWarning);
                if (finalTimeout) clearTimeout(finalTimeout);
                
                if (err) {
                    logger.error(` ❌ CBR: Extraction failed for ${targetFile}`);
                    logger.error(` ❌ CBR: Error: ${err.message}`);
                    logger.error(` ❌ CBR: stderr: ${stderr}`);
                    logger.error(` ❌ CBR: Available files: ${imageFiles.slice(0, 10).join(', ')}`);
                    
                    // Enhanced error handling for specific error types
                    if (err.message.includes('corrupted') ||
                        err.message.includes('invalid') ||
                        err.message.includes('truncated') ||
                        stderr.toString().includes('Corrupt file')) {
                        logger.info(` 🔄 CBR: Archive corrupted, trying fallback extraction method`);
                        return extractFromCBZ(filePath, page, res, cache).then(resolve).catch(fallbackError => {
                            logger.error(` ❌ CBR: Fallback extraction failed: ${fallbackError.message}`);
                            reject(new Error('Archive file is corrupted and cannot be processed with either CBR or CBZ methods'));
                        });
                    } else if (err.killed || err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
                        logger.info(` ⏰ CBR: Process timeout or killed for ${path.basename(filePath)}`);
                        return reject(new Error('CBR extraction timeout - The file is very large, corrupted, or the system is under heavy load. Please try again or use a different file format.'));
                    } else {
                        logger.info(` 🔄 CBR: Trying fallback extraction method`);
                        return extractFromCBZ(filePath, page, res, cache).then(resolve).catch(fallbackError => {
                            logger.error(` ❌ CBR: Fallback extraction failed: ${fallbackError.message}`);
                            reject(new Error('Archive file is corrupted and cannot be processed with either CBR or CBZ methods'));
                        });
                    }
                }
                
                if (!stdout || stdout.length === 0) {
                    return reject(new Error(`No data extracted from page ${page}`));
                }
                
                sendPage(stdout);
            };

            // The native unrar is preferred; the in-process extractor is the fallback when it is
            // missing or fails, and only then the CBZ route is tried
            const extractInProcess = (onFail) => {
                extractRarEntry(filePath, targetFile).then((buffer) => {
                    if (timeoutWarning) clearTimeout(timeoutWarning);
                    if (finalTimeout) clearTimeout(finalTimeout);
                    sendPage(buffer);
                }).catch((jsErr) => {
                    console.warn(`[${new Date().toISOString()}] ⚠️ CBR: node-unrar-js extraction failed: ${jsErr.message}`);
                    onFail();
                });
            };

            const runUnrarBinary = () => exec(`${unrarShellCommand()} p -inul -p- "${escapedFilePath}" "${escapedTargetFile}"`, {
                encoding: 'buffer',
                maxBuffer: 50 * 1024 * 1024,
                timeout: 90000 // 90 second timeout (increased)
            }, (err, stdout, stderr) => {
                if (err && !err.killed && err.signal !== 'SIGTERM' && err.code !== 'ETIMEDOUT') {
                    return extractInProcess(() => onUnrarResult(err, stdout, stderr));
                }
                onUnrarResult(err, stdout, stderr);
            });

            // Without a native unrar on Windows go straight to the in-process extractor
            if (process.platform === 'win32' && !findUnrar()) {
                extractInProcess(runUnrarBinary);
            } else {
                runUnrarBinary();
            }
        } catch (error) {
            logger.error(` ❌ CBR: extractFromCBR error: ${error.message}`);
            // Try fallback extraction as last resort
            extractFromCBZ(filePath, page, res, cache).then(resolve).catch(fallbackError => {
                logger.error(` ❌ CBR: Fallback extraction also failed: ${fallbackError.message}`);
                reject(new Error('Archive file is corrupted and cannot be processed with either CBR or CBZ methods'));
            });
        }
    });
    
    pendingRequests.set(requestKey, promise);
    
    // The caller handles rejection; this cleanup chain must not leave an unhandled one
    promise.finally(() => {
        pendingRequests.delete(requestKey);
    }).catch(() => {});
    
    return promise;
}

async function extractVideoFromCBZ(filePath, fileName, res) {
    return new Promise((resolve, reject) => {
        // Check if file exists before attempting to open
        if (!fs.existsSync(filePath)) {
            return reject(new Error(`File not found: ${filePath}`));
        }
        
        // Basic file validation - check if it's a valid ZIP by reading first few bytes
        try {
            const buffer = readFileHeader(filePath, 4);
            const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);
            if (!isZip) {
                return reject(new Error('File is not a valid ZIP archive'));
            }
        } catch (validationError) {
            return reject(new Error('Unable to validate file format'));
        }
        
        try {
            yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
            if (err) {
                // Enhanced error handling for yauzl errors
                if (err.message.includes('central directory record signature not found')) {
                    return reject(new Error('Archive file is corrupted or not a valid ZIP file'));
                } else if (err.message.includes('file is truncated')) {
                    return reject(new Error('Archive file is truncated or incomplete'));
                } else if (err.message.includes('not a zip file') || err.message.includes('not a valid ZIP file')) {
                    return reject(new Error('File is not a valid ZIP archive'));
                }
                return reject(err);
            }
            
            let hasError = false;
            let targetEntry = null;
            
            // Add timeout to prevent hanging
            const timeout = setTimeout(() => {
                hasError = true;
                if (zipfile) {
                    zipfile.close();
                }
                logger.error(` ⏰ CBZ: Archive processing timeout for ${path.basename(filePath)} after 30 seconds`);
                reject(new Error('CBZ archive processing timeout - The file is very large, corrupted, or contains too many files. Please try again or use a smaller archive.'));
            }, 30000); // 30 second timeout
            
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                if (hasError) return;
                
                if (!entry || !entry.fileName) {
                    zipfile.readEntry();
                    return;
                }
                
                if (entry.fileName === fileName) {
                    targetEntry = entry;
                    // Found the target file, stop processing
                    zipfile.close();
                    clearTimeout(timeout);
                    
                    // Open the file for reading
                    yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (err2, zipfile2) => {
                        if (err2) {
                            return reject(err2);
                        }
                        
                        zipfile2.readEntry();
                        zipfile2.on('entry', (entry2) => {
                            if (entry2.fileName === fileName) {
                                zipfile2.openReadStream(entry2, (err3, readStream) => {
                                    if (err3) {
                                        zipfile2.close();
                                        return reject(new Error(`Failed to extract video ${fileName}: ${err3.message}`));
                                    }
                                    
                                    const mimeType = getVideoMimeType(fileName);
                                    
                                    res.setHeader('Content-Type', mimeType);
                                    res.setHeader('Accept-Ranges', 'bytes');
                                    readStream.pipe(res);
                                    
                                    readStream.on('end', () => {
                                        zipfile2.close();
                                        resolve();
                                    });
                                    
                                    readStream.on('error', (err4) => {
                                        zipfile2.close();
                                        reject(new Error(`Stream error while reading video ${fileName}: ${err4.message}`));
                                    });
                                });
                            } else {
                                zipfile2.readEntry();
                            }
                        });
                        
                        zipfile2.on('end', () => {
                            zipfile2.close();
                            reject(new Error(`Video file ${fileName} not found in archive`));
                        });
                        
                        zipfile2.on('error', (err5) => {
                            zipfile2.close();
                            reject(new Error(`Archive processing error: ${err5.message}`));
                        });
                    });
                } else {
                    zipfile.readEntry();
                }
            });
            
            zipfile.on('end', () => {
                if (hasError) return;
                clearTimeout(timeout);
                zipfile.close();
                if (!targetEntry) {
                    reject(new Error(`Video file ${fileName} not found in archive`));
                }
            });
            
            zipfile.on('error', (err) => {
                if (hasError) return;
                hasError = true;
                clearTimeout(timeout);
                zipfile.close();
                reject(new Error(`Archive processing error: ${err.message}`));
            });
        });
        } catch (error) {
            // Catch any synchronous errors from yauzl.open
            if (error.message.includes('central directory record signature not found')) {
                return reject(new Error('Archive file is corrupted or not a valid ZIP file'));
            } else if (error.message.includes('file is truncated')) {
                return reject(new Error('Archive file is truncated or incomplete'));
            } else if (error.message.includes('not a zip file') || error.message.includes('not a valid ZIP file')) {
                return reject(new Error('File is not a valid ZIP archive'));
            }
            return reject(error);
        }
    });
}

async function extractVideoFromCBR(filePath, fileName, res) {
    try {
        // Check if file exists before attempting to process
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        
        logger.info(` 📹 CBR: Extracting video ${fileName} from ${path.basename(filePath)}`);
        
        const escapedFilePath = filePath.replace(/"/g, '\"');
        const escapedFileName = fileName.replace(/"/g, '\"');
        
        // Add timeout to prevent hanging
        const timeout = setTimeout(() => {
            throw new Error('CBR video extraction timeout - file may be corrupted');
        }, 60000); // 60 second timeout
        
        return new Promise((resolve, reject) => {
            exec(`${unrarShellCommand()} p -inul -p- "${escapedFilePath}" "${escapedFileName}"`, { 
                encoding: 'buffer', 
                maxBuffer: 100 * 1024 * 1024, // 100MB buffer for videos
                timeout: 60000 // 60 second timeout
            }, (err, stdout, stderr) => {
                clearTimeout(timeout);
                
                if (err) {
                    logger.error(` ❌ CBR: Video extraction failed for ${fileName}`);
                    logger.error(` ❌ CBR: Error: ${err.message}`);
                    logger.error(` ❌ CBR: stderr: ${stderr}`);
                    
                    // Enhanced error handling for specific error types
                    if (err.message.includes('corrupted') || 
                        err.message.includes('invalid') ||
                        err.message.includes('truncated') ||
                        stderr.toString().includes('Corrupt file')) {
                        logger.info(` 🔄 CBR: Archive corrupted, trying fallback extraction method`);
                        return extractVideoFromCBZ(filePath, fileName, res).then(resolve).catch(fallbackError => {
                            logger.error(` ❌ CBR: Fallback video extraction failed: ${fallbackError.message}`);
                            reject(new Error('Archive file is corrupted and cannot be processed with either CBR or CBZ methods'));
                        });
                    } else if (err.killed || err.signal === 'SIGTERM') {
                        return reject(new Error('CBR video extraction timeout - file may be corrupted'));
                    } else {
                        logger.info(` 🔄 CBR: Trying fallback extraction method`);
                        return extractVideoFromCBZ(filePath, fileName, res).then(resolve).catch(fallbackError => {
                            logger.error(` ❌ CBR: Fallback video extraction failed: ${fallbackError.message}`);
                            reject(new Error('Archive file is corrupted and cannot be processed with either CBR or CBZ methods'));
                        });
                    }
                }
                
                if (!stdout || stdout.length === 0) {
                    return reject(new Error(`No data extracted from video ${fileName}`));
                }
                
                const mimeType = getVideoMimeType(fileName);
                
                res.setHeader('Content-Type', mimeType);
                res.setHeader('Accept-Ranges', 'bytes');
                res.send(stdout);
                resolve();
            });
        });
    } catch (error) {
        logger.error(` ❌ CBR: extractVideoFromCBR error: ${error.message}`);
        // Try fallback extraction as last resort
        return extractVideoFromCBZ(filePath, fileName, res).catch(fallbackError => {
            logger.error(` ❌ CBR: Fallback video extraction also failed: ${fallbackError.message}`);
            throw new Error('Archive file is corrupted and cannot be processed with either CBR or CBZ methods');
        });
    }
}

module.exports = {
    serveComicPreview,
    getComicInfo,
    serveArchiveVideo
};