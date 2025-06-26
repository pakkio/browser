const express = require('express');
const fs = require('fs');
const path = require('path');
const pdf2pic = require('pdf2pic');
const yauzl = require('yauzl');
const { createExtractorFromFile } = require('node-unrar-js');

const app = express();
const port = 3000;

const baseDir = path.resolve(process.argv[2] || '.');

console.log('================================');
console.log('🚀 File Browser Server Starting...');
console.log(`📂 Base directory: ${baseDir}`);
console.log(`🔧 Port: ${port}`);
console.log('================================');

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.woff': 'application/font-woff',
    '.ttf': 'application/font-ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'application/font-otf',
    '.wasm': 'application/wasm',
    '.pdf': 'application/pdf',
    '.cbz': 'application/vnd.comicbook+zip',
    '.cbr': 'application/vnd.comicbook-rar',
    '.epub': 'application/epub+zip'
};

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/browse', (req, res) => {
    const requestedPath = req.query.path || '';
    const dirPath = path.join(baseDir, requestedPath);
    
    console.log(`[${new Date().toISOString()}] GET /api/browse - path: "${requestedPath}"`);
    console.log(`[${new Date().toISOString()}] Resolved to: ${dirPath}`);

    if (!dirPath.startsWith(baseDir)) {
        console.log(`[${new Date().toISOString()}] ❌ Forbidden access attempt to: ${dirPath}`);
        return res.status(403).send('Forbidden');
    }

    try {
        const files = fs.readdirSync(dirPath, { withFileTypes: true });
        console.log(`[${new Date().toISOString()}] ✅ Found ${files.length} files/directories`);
        
        const fileList = files.map(file => {
            const filePath = path.join(dirPath, file.name);
            let stats = null;
            try {
                stats = fs.statSync(filePath);
            } catch (e) {
                console.log(`[${new Date().toISOString()}] ⚠️  Stat error for ${file.name}: ${e.message}`);
            }
            
            return {
                name: file.name,
                isDirectory: file.isDirectory(),
                size: stats && !file.isDirectory() ? stats.size : null,
                modified: stats ? stats.mtime.toISOString() : null
            };
        });
        
        const response = {
            files: fileList,
            currentPath: dirPath,
            basePath: baseDir
        };
        console.log(`[${new Date().toISOString()}] 📤 Sending ${fileList.length} items in response`);
        res.json(response);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Browse error: ${error.message}`);
        res.status(500).send(error.toString());
    }
});

app.get('/files', (req, res) => {
    const requestedFile = req.query.path;
    console.log(`[${new Date().toISOString()}] GET /files - path: "${requestedFile}"`);
    
    if (!requestedFile) {
        console.log(`[${new Date().toISOString()}] ❌ File path is required`);
        return res.status(400).send('File path is required');
    }
    const filePath = path.join(baseDir, requestedFile);

    if (!filePath.startsWith(baseDir)) {
        console.log(`[${new Date().toISOString()}] ❌ Forbidden file access attempt: ${filePath}`);
        return res.status(403).send('Forbidden');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    console.log(`[${new Date().toISOString()}] 📁 Serving file: ${filePath} (${contentType})`);
    res.setHeader('Content-Type', contentType);

    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
        console.error(`[${new Date().toISOString()}] ❌ File stream error: ${err.message}`);
        res.status(500).send(err.message);
    });
    stream.pipe(res);
});

app.get('/pdf-preview', async (req, res) => {
    const requestedFile = req.query.path;
    const page = parseInt(req.query.page) || 1;
    console.log(`[${new Date().toISOString()}] GET /pdf-preview - file: "${requestedFile}", page: ${page}`);
    
    if (!requestedFile) {
        console.log(`[${new Date().toISOString()}] ❌ PDF preview: File path is required`);
        return res.status(400).send('File path is required');
    }
    
    const filePath = path.join(baseDir, requestedFile);
    
    if (!filePath.startsWith(baseDir)) {
        console.log(`[${new Date().toISOString()}] ❌ PDF preview: Forbidden access to ${filePath}`);
        return res.status(403).send('Forbidden');
    }
    
    if (path.extname(filePath).toLowerCase() !== '.pdf') {
        console.log(`[${new Date().toISOString()}] ❌ PDF preview: Not a PDF file: ${filePath}`);
        return res.status(400).send('Not a PDF file');
    }
    
    try {
        console.log(`[${new Date().toISOString()}] 🔄 Converting PDF page ${page}...`);
        const options = {
            density: 100,
            format: "png",
            width: 800,
            height: 1000
        };
        
        const convert = pdf2pic.fromPath(filePath, options);
        const result = await convert(page, { responseType: "base64" });
        
        if (result && result.base64 && result.base64.length > 0) {
            console.log(`[${new Date().toISOString()}] ✅ PDF conversion successful, sending ${result.base64.length} bytes`);
            const buffer = Buffer.from(result.base64, 'base64');
            res.setHeader('Content-Type', 'image/png');
            res.send(buffer);
        } else {
            throw new Error('PDF conversion returned empty result');
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ PDF conversion error: ${error.message}`);
        res.status(500).send(`PDF conversion error: ${error.message}`);
    }
});

app.get('/comic-preview', async (req, res) => {
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
        console.error(`[${new Date().toISOString()}] ❌ Comic extraction error: ${error.message}`);
        res.status(500).send(`Comic extraction error: ${error.message}`);
    }
});

async function extractFromCBZ(filePath, page, res) {
    return new Promise((resolve, reject) => {
        yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
            if (err) return reject(err);
            
            const imageFiles = [];
            
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                if (entry.fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
                    imageFiles.push(entry);
                }
                zipfile.readEntry();
            });
            
            zipfile.on('end', () => {
                imageFiles.sort((a, b) => a.fileName.localeCompare(b.fileName));
                
                if (page > imageFiles.length || page < 1) {
                    return reject(new Error('Page not found'));
                }
                
                const targetEntry = imageFiles[page - 1];
                zipfile.openReadStream(targetEntry, (err, readStream) => {
                    if (err) return reject(err);
                    
                    const ext = path.extname(targetEntry.fileName).toLowerCase();
                    const mimeType = {
                        '.jpg': 'image/jpeg',
                        '.jpeg': 'image/jpeg',
                        '.png': 'image/png',
                        '.gif': 'image/gif',
                        '.webp': 'image/webp'
                    }[ext] || 'image/jpeg';
                    
                    res.setHeader('Content-Type', mimeType);
                    readStream.pipe(res);
                    resolve();
                });
            });
        });
    });
}

async function extractFromCBR(filePath, page, res) {
    try {
        const extractor = await createExtractorFromFile({ filepath: filePath });
        const list = extractor.getFileList();
        
        const imageFiles = list.fileHeaders.filter(header => 
            header.name.match(/\.(jpg|jpeg|png|gif|webp)$/i)
        ).sort((a, b) => a.name.localeCompare(b.name));
        
        if (page > imageFiles.length || page < 1) {
            throw new Error('Page not found');
        }
        
        const targetFile = imageFiles[page - 1];
        const extracted = extractor.extract({ files: [targetFile.name] });
        
        const file = extracted.files[0];
        if (!file) {
            throw new Error('Could not extract file');
        }
        
        const ext = path.extname(targetFile.name).toLowerCase();
        const mimeType = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp'
        }[ext] || 'image/jpeg';
        
        res.setHeader('Content-Type', mimeType);
        res.send(Buffer.from(file.extraction));
    } catch (error) {
        throw error;
    }
}

app.get('/epub-cover', async (req, res) => {
    try {
        const filePath = req.query.path;
        const coverPath = req.query.cover;
        
        console.log(`[${new Date().toISOString()}] GET /epub-cover - file: "${filePath}", cover: "${coverPath}"`);
        
        if (!filePath || !coverPath) {
            console.log(`[${new Date().toISOString()}] ❌ EPUB cover: Missing parameters`);
            return res.status(400).json({ error: 'Missing file path or cover path' });
        }

        const yauzl = require('yauzl');
        
        yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
            if (err) {
                console.error(`[${new Date().toISOString()}] ❌ EPUB cover: ZIP open error: ${err.message}`);
                return res.status(500).json({ error: err.message });
            }
            
            const allEntries = [];
            let foundCover = false;
            
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                allEntries.push(entry.fileName);
                console.log(`[${new Date().toISOString()}] 📁 EPUB entry: "${entry.fileName}"`);
                
                if (entry.fileName === coverPath) {
                    foundCover = true;
                    console.log(`[${new Date().toISOString()}] ✅ Found cover: ${entry.fileName}`);
                    zipfile.openReadStream(entry, (err, readStream) => {
                        if (err) {
                            console.error(`[${new Date().toISOString()}] ❌ EPUB cover: Stream error: ${err.message}`);
                            return res.status(500).json({ error: err.message });
                        }
                        
                        const mimeType = coverPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
                        res.setHeader('Content-Type', mimeType);
                        readStream.pipe(res);
                    });
                } else {
                    zipfile.readEntry();
                }
            });
            
            zipfile.on('end', () => {
                if (!res.headersSent) {
                    console.log(`[${new Date().toISOString()}] ❌ EPUB cover not found. Looking for: "${coverPath}"`);
                    console.log(`[${new Date().toISOString()}] Available entries: ${allEntries.join(', ')}`);
                    res.status(404).json({ 
                        error: 'Cover image not found',
                        requestedPath: coverPath,
                        availableEntries: allEntries.slice(0, 20) // Limit to first 20 for readability
                    });
                }
            });
        });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ EPUB cover: General error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.get('/epub-preview', async (req, res) => {
    const requestedFile = req.query.path;
    console.log(`[${new Date().toISOString()}] GET /epub-preview - file: "${requestedFile}"`);
    
    if (!requestedFile) {
        console.log(`[${new Date().toISOString()}] ❌ EPUB preview: File path is required`);
        return res.status(400).json({ error: 'File path is required' });
    }
    
    const filePath = path.join(baseDir, requestedFile);
    
    if (!filePath.startsWith(baseDir)) {
        console.log(`[${new Date().toISOString()}] ❌ EPUB preview: Forbidden access to ${filePath}`);
        return res.status(403).json({ error: 'Forbidden' });
    }
    
    if (path.extname(filePath).toLowerCase() !== '.epub') {
        console.log(`[${new Date().toISOString()}] ❌ EPUB preview: Not an EPUB file: ${filePath}`);
        return res.status(400).json({ error: 'Not an EPUB file' });
    }
    
    try {
        console.log(`[${new Date().toISOString()}] 🔄 Extracting EPUB content...`);
        const epubData = await extractEpubContent(filePath);
        console.log(`[${new Date().toISOString()}] ✅ EPUB extraction completed - ${epubData.chapters.length} chapters`);
        res.json(epubData);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ EPUB extraction error: ${error.message}`);
        res.status(500).json({ error: `EPUB extraction error: ${error.message}` });
    }
});

async function extractEpubContent(filePath) {
    return new Promise((resolve, reject) => {
        yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
            if (err) return reject(err);
            
            const files = new Map();
            let metadata = {};
            let spine = [];
            
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                if (entry.fileName.endsWith('/')) {
                    zipfile.readEntry();
                    return;
                }
                
                zipfile.openReadStream(entry, (err, readStream) => {
                    if (err) {
                        zipfile.readEntry();
                        return;
                    }
                    
                    const chunks = [];
                    readStream.on('data', chunk => chunks.push(chunk));
                    readStream.on('end', () => {
                        const content = Buffer.concat(chunks).toString('utf8');
                        files.set(entry.fileName, content);
                        zipfile.readEntry();
                    });
                });
            });
            
            zipfile.on('end', async () => {
                try {
                    // Parse container.xml to find OPF file
                    const containerXml = files.get('META-INF/container.xml');
                    if (!containerXml) {
                        throw new Error('Missing container.xml');
                    }
                    
                    const opfPathMatch = containerXml.match(/full-path="([^"]+)"/i);
                    if (!opfPathMatch) {
                        throw new Error('Could not find OPF file path');
                    }
                    
                    const opfPath = opfPathMatch[1];
                    const opfContent = files.get(opfPath);
                    if (!opfContent) {
                        throw new Error('Could not find OPF file');
                    }
                    
                    // Extract metadata
                    const titleMatch = opfContent.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
                    const creatorMatch = opfContent.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i);
                    const descMatch = opfContent.match(/<dc:description[^>]*>([^<]+)<\/dc:description>/i);
                    
                    // Extract cover image - try multiple methods
                    let coverPath = null;
                    
                    // Method 1: Look for <meta name="cover" content="..."/>
                    const coverMetaMatch = opfContent.match(/<meta\s+name="cover"\s+content="([^"]+)"/i);
                    if (coverMetaMatch) {
                        const coverId = coverMetaMatch[1];
                        const coverItemMatch = opfContent.match(new RegExp(`<item\\s+id="${coverId}"[^>]*href="([^"]+)"`, 'i'));
                        if (coverItemMatch) {
                            const opfDir = path.dirname(opfPath);
                            coverPath = opfDir === '.' ? coverItemMatch[1] : `${opfDir}/${coverItemMatch[1]}`;
                        }
                    }
                    
                    // Method 2: Look for cover-image in manifest items if method 1 failed
                    if (!coverPath) {
                        const coverItemMatch = opfContent.match(/<item[^>]*id="cover-image"[^>]*href="([^"]+)"/i) ||
                                             opfContent.match(/<item[^>]*href="([^"]+)"[^>]*id="cover-image"/i);
                        if (coverItemMatch) {
                            const opfDir = path.dirname(opfPath);
                            coverPath = opfDir === '.' ? coverItemMatch[1] : `${opfDir}/${coverItemMatch[1]}`;
                        }
                    }
                    
                    // Method 3: Look for any item with "cover" in the id
                    if (!coverPath) {
                        const coverItemMatch = opfContent.match(/<item[^>]*id="[^"]*cover[^"]*"[^>]*href="([^"]+)"/i);
                        if (coverItemMatch) {
                            const opfDir = path.dirname(opfPath);
                            coverPath = opfDir === '.' ? coverItemMatch[1] : `${opfDir}/${coverItemMatch[1]}`;
                        }
                    }
                    
                    metadata = {
                        title: titleMatch ? titleMatch[1] : null,
                        creator: creatorMatch ? creatorMatch[1] : null,
                        description: descMatch ? descMatch[1] : null,
                        coverPath: coverPath
                    };
                    
                    // Extract spine order
                    const spineMatches = opfContent.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i);
                    if (spineMatches) {
                        const itemrefMatches = spineMatches[1].match(/<itemref[^>]*idref="([^"]+)"/gi);
                        if (itemrefMatches) {
                            spine = itemrefMatches.map(match => {
                                const idMatch = match.match(/idref="([^"]+)"/i);
                                return idMatch ? idMatch[1] : null;
                            }).filter(Boolean);
                        }
                    }
                    
                    // Map spine IDs to file paths
                    const manifestItems = new Map();
                    const manifestMatches = opfContent.match(/<item[^>]+>/gi);
                    if (manifestMatches) {
                        manifestMatches.forEach(item => {
                            const idMatch = item.match(/id="([^"]+)"/i);
                            const hrefMatch = item.match(/href="([^"]+)"/i);
                            if (idMatch && hrefMatch) {
                                manifestItems.set(idMatch[1], hrefMatch[1]);
                            }
                        });
                    }
                    
                    // Extract chapters
                    const opfDir = path.dirname(opfPath);
                    const chapters = [];
                    
                    for (const spineId of spine.slice(0, 20)) { // Limit to first 20 chapters
                        const href = manifestItems.get(spineId);
                        if (href) {
                            const chapterPath = opfDir === '.' ? href : `${opfDir}/${href}`;
                            const chapterContent = files.get(chapterPath);
                            if (chapterContent) {
                                // Extract title from content
                                const titleMatch = chapterContent.match(/<title[^>]*>([^<]+)<\/title>/i) ||
                                                chapterContent.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i);
                                
                                // Clean HTML content
                                let cleanContent = chapterContent
                                    .replace(/<script[\s\S]*?<\/script>/gi, '')
                                    .replace(/<style[\s\S]*?<\/style>/gi, '')
                                    .replace(/<head[\s\S]*?<\/head>/gi, '')
                                    .replace(/<\/?html[^>]*>/gi, '')
                                    .replace(/<\/?body[^>]*>/gi, '')
                                    .replace(/class="[^"]*"/gi, '')
                                    .replace(/style="[^"]*"/gi, '')
                                    .trim();
                                
                                // Truncate content if too large (>50KB per chapter)
                                if (cleanContent.length > 50000) {
                                    cleanContent = cleanContent.substring(0, 50000) + '...\n\n<p><em>[Content truncated for performance]</em></p>';
                                }
                                
                                chapters.push({
                                    title: titleMatch ? titleMatch[1].trim() : `Chapter ${chapters.length + 1}`,
                                    content: cleanContent
                                });
                            }
                        }
                    }
                    
                    if (chapters.length === 0) {
                        throw new Error('No readable chapters found');
                    }
                    
                    // Extract cover image data if found
                    let coverImage = null;
                    if (metadata.coverPath) {
                        // Read cover as binary data
                        for (const [fileName, content] of files.entries()) {
                            if (fileName === metadata.coverPath) {
                                // Re-read the file as binary
                                const entry = Array.from(zipfile.entriesRead || []).find(e => e.fileName === fileName);
                                if (entry) {
                                    const mimeType = fileName.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
                                    // For now, store path - we'll serve it via separate endpoint
                                    coverImage = fileName;
                                }
                                break;
                            }
                        }
                    }
                    
                    resolve({ metadata, chapters, coverImage });
                } catch (error) {
                    reject(error);
                }
            });
        });
    });
}

// Handle direct cover image requests from EPUB content
app.get('/cover.jpeg', (req, res) => {
    console.log(`[${new Date().toISOString()}] GET /cover.jpeg - redirecting to proper handler`);
    res.status(404).json({ error: 'Cover image should be accessed via /epub-cover endpoint' });
});

app.get('/cover.jpg', (req, res) => {
    console.log(`[${new Date().toISOString()}] GET /cover.jpg - redirecting to proper handler`);
    res.status(404).json({ error: 'Cover image should be accessed via /epub-cover endpoint' });
});

app.use((req, res, next) => {
    if (!req.url.includes('/files') || req.url.includes('?')) {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    }
    next();
});

app.listen(port, () => {
    console.log(`🚀 Server started successfully!`);
    console.log(`📂 Browsing directory: ${baseDir}`);
    console.log(`🌐 Server listening at http://localhost:${port}`);
    console.log(`⏰ Started at: ${new Date().toISOString()}`);
    console.log('================================');
});