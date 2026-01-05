const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const { baseDir } = require('./config');

async function serveEpubCover(req, res) {
    try {
        const filePath = req.query.path;
        let coverPath = req.query.cover;
        
        console.log(`[${new Date().toISOString()}] GET /epub-cover - file: "${filePath}", cover: "${coverPath || 'auto-detect'}"`);
        
        if (!filePath) {
            console.log(`[${new Date().toISOString()}] ❌ EPUB cover: Missing file path`);
            return res.status(400).json({ error: 'Missing file path' });
        }

        const fullPath = path.join(baseDir, filePath);
        
        if (!fs.existsSync(fullPath)) {
            console.log(`[${new Date().toISOString()}] ❌ EPUB cover: File not found: ${fullPath}`);
            return res.status(404).json({ error: 'File not found' });
        }

        yauzl.open(fullPath, { lazyEntries: true }, (err, zipfile) => {
            if (err) {
                console.error(`[${new Date().toISOString()}] ❌ EPUB cover: ZIP open error: ${err.message}`);
                return res.status(500).json({ error: err.message });
            }
            
            const allEntries = [];
            const files = new Map();
            let foundCover = false;
            
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                if (!entry || !entry.fileName) {
                    zipfile.readEntry();
                    return;
                }
                
                allEntries.push(entry.fileName);
                
                // If we have an explicit cover path, look for it directly
                if (coverPath && entry.fileName === coverPath) {
                    foundCover = true;
                    console.log(`[${new Date().toISOString()}] ✅ Found exact cover match: ${entry.fileName}`);
                    zipfile.openReadStream(entry, (streamErr, readStream) => {
                        if (streamErr) {
                            console.error(`[${new Date().toISOString()}] ❌ EPUB cover: Stream error: ${streamErr.message}`);
                            return res.status(500).json({ error: streamErr.message });
                        }
                        
                        const mimeType = coverPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
                        res.setHeader('Content-Type', mimeType);
                        res.setHeader('Cache-Control', 'public, max-age=86400');
                        readStream.pipe(res);
                    });
                } else {
                    // Store file content for later processing if we need to auto-detect cover
                    if (!coverPath && (entry.fileName.endsWith('.opf') || entry.fileName === 'META-INF/container.xml' || /\.(jpe?g|png|gif)$/i.test(entry.fileName))) {
                        zipfile.openReadStream(entry, (streamErr, readStream) => {
                            if (streamErr) {
                                zipfile.readEntry();
                                return;
                            }
                            
                            const chunks = [];
                            readStream.on('data', chunk => chunks.push(chunk));
                            readStream.on('end', () => {
                                files.set(entry.fileName, Buffer.concat(chunks));
                                zipfile.readEntry();
                            });
                            readStream.on('error', () => zipfile.readEntry());
                        });
                    } else {
                        zipfile.readEntry();
                    }
                }
            });
            
            zipfile.on('end', () => {
                if (res.headersSent) return;
                
                // If no explicit cover path, try to auto-detect from OPF
                if (!coverPath) {
                    console.log(`[${new Date().toISOString()}] 🔍 Auto-detecting cover from EPUB metadata...`);
                    
                    // Find container.xml to locate OPF
                    const containerXml = files.get('META-INF/container.xml');
                    if (containerXml) {
                        const containerContent = containerXml.toString('utf8');
                        const opfPathMatch = containerContent.match(/full-path="([^"]+)"/i);
                        
                        if (opfPathMatch) {
                            const opfPath = opfPathMatch[1];
                            const opfContent = files.get(opfPath);
                            
                            if (opfContent) {
                                const opfStr = opfContent.toString('utf8');
                                const opfDir = path.dirname(opfPath);
                                
                                // Method 1: Look for <meta name="cover" content="..."/>
                                let detectedCover = null;
                                const coverMetaMatch = opfStr.match(/<meta\s+name="cover"\s+content="([^"]+)"/i);
                                if (coverMetaMatch) {
                                    const coverId = coverMetaMatch[1];
                                    const coverItemMatch = opfStr.match(new RegExp(`<item\\s+[^>]*id="${coverId}"[^>]*href="([^"]+)"`, 'i')) ||
                                                          opfStr.match(new RegExp(`<item\\s+[^>]*href="([^"]+)"[^>]*id="${coverId}"`, 'i'));
                                    if (coverItemMatch) {
                                        detectedCover = opfDir === '.' ? coverItemMatch[1] : `${opfDir}/${coverItemMatch[1]}`;
                                    }
                                }
                                
                                // Method 2: Look for cover-image id
                                if (!detectedCover) {
                                    const coverItemMatch = opfStr.match(/<item[^>]*id="cover-image"[^>]*href="([^"]+)"/i) ||
                                                          opfStr.match(/<item[^>]*href="([^"]+)"[^>]*id="cover-image"/i);
                                    if (coverItemMatch) {
                                        detectedCover = opfDir === '.' ? coverItemMatch[1] : `${opfDir}/${coverItemMatch[1]}`;
                                    }
                                }
                                
                                // Method 3: Look for any item with "cover" in the id
                                if (!detectedCover) {
                                    const coverItemMatch = opfStr.match(/<item[^>]*id="[^"]*cover[^"]*"[^>]*href="([^"]+\.(jpe?g|png|gif))"/i);
                                    if (coverItemMatch) {
                                        detectedCover = opfDir === '.' ? coverItemMatch[1] : `${opfDir}/${coverItemMatch[1]}`;
                                    }
                                }
                                
                                // Method 4: Look for first image in manifest
                                if (!detectedCover) {
                                    const imageItemMatch = opfStr.match(/<item[^>]*media-type="image\/[^"]*"[^>]*href="([^"]+)"/i);
                                    if (imageItemMatch) {
                                        detectedCover = opfDir === '.' ? imageItemMatch[1] : `${opfDir}/${imageItemMatch[1]}`;
                                    }
                                }
                                
                                if (detectedCover) {
                                    console.log(`[${new Date().toISOString()}] ✅ Auto-detected cover: ${detectedCover}`);
                                    
                                    // Check if we have this image in our files map
                                    const imageBuffer = files.get(detectedCover);
                                    if (imageBuffer) {
                                        const mimeType = detectedCover.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
                                        res.setHeader('Content-Type', mimeType);
                                        res.setHeader('Cache-Control', 'public, max-age=86400');
                                        res.send(imageBuffer);
                                        return;
                                    }
                                }
                            }
                        }
                    }
                }
                
                console.log(`[${new Date().toISOString()}] ❌ EPUB cover not found. Looking for: "${coverPath || 'auto-detect'}"`);
                res.status(404).json({ 
                    error: 'Cover image not found',
                    requestedPath: coverPath || 'auto-detect',
                    availableEntries: allEntries.filter(e => /\.(jpe?g|png|gif)$/i.test(e)).slice(0, 20)
                });
            });
        });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ EPUB cover: General error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

async function serveEpubPreview(req, res) {
    const requestedFile = req.query.path;
    console.log(`[${new Date().toISOString()}] GET /epub-preview - file: "${requestedFile}"`);
    console.log(`[${new Date().toISOString()}] [EPUB Debug] Full URL: ${req.url}`);
    console.log(`[${new Date().toISOString()}] [EPUB Debug] Query params:`, req.query);
    console.log(`[${new Date().toISOString()}] [EPUB Debug] Headers:`, req.headers);
    
    if (!requestedFile) {
        console.log(`[${new Date().toISOString()}] ❌ EPUB preview: File path is required`);
        return res.status(400).json({ error: 'File path is required' });
    }
    
    const filePath = path.join(baseDir, requestedFile);
    console.log(`[${new Date().toISOString()}] [EPUB Debug] Base dir: ${baseDir}`);
    console.log(`[${new Date().toISOString()}] [EPUB Debug] Requested file: ${requestedFile}`);
    console.log(`[${new Date().toISOString()}] [EPUB Debug] Full file path: ${filePath}`);
    console.log(`[${new Date().toISOString()}] [EPUB Debug] File exists: ${fs.existsSync(filePath)}`);
    
    if (!filePath.startsWith(baseDir)) {
        console.log(`[${new Date().toISOString()}] ❌ EPUB preview: Forbidden access to ${filePath}`);
        return res.status(403).json({ error: 'Forbidden' });
    }
    
    if (!fs.existsSync(filePath)) {
        console.log(`[${new Date().toISOString()}] ❌ EPUB preview: File not found: ${filePath}`);
        return res.status(404).json({ error: 'File not found' });
    }
    
    if (path.extname(filePath).toLowerCase() !== '.epub') {
        console.log(`[${new Date().toISOString()}] ❌ EPUB preview: Not an EPUB file: ${filePath}`);
        return res.status(400).json({ error: 'Not an EPUB file' });
    }
    
    try {
        console.log(`[${new Date().toISOString()}] 🔄 Extracting EPUB content...`);
        const epubData = await extractEpubContent(filePath);
        console.log(`[${new Date().toISOString()}] ✅ EPUB extraction completed - ${epubData.chapters.length} chapters`);
        console.log(`[${new Date().toISOString()}] [EPUB Debug] Setting Content-Type to application/json`);
        res.setHeader('Content-Type', 'application/json');
        res.json(epubData);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ EPUB extraction error: ${error.message}`);
        console.error(`[${new Date().toISOString()}] [EPUB Debug] Error stack:`, error.stack);
        res.setHeader('Content-Type', 'application/json');
        res.status(500).json({ error: `EPUB extraction error: ${error.message}` });
    }
}

async function extractEpubContent(filePath) {
    console.log(`[${new Date().toISOString()}] 📖 Starting EPUB extraction for: ${filePath}`);
    
    return new Promise((resolve, reject) => {
        yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
            if (err) {
                console.error(`[${new Date().toISOString()}] ❌ EPUB: Failed to open ZIP file: ${err.message}`);
                return reject(err);
            }
            
            console.log(`[${new Date().toISOString()}] 📖 EPUB: Successfully opened ZIP file`);
            
            const files = new Map();
            let metadata = {};
            let spine = [];
            let entryCount = 0;
            
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                entryCount++;
                
                if (!entry || !entry.fileName) {
                    console.warn(`[${new Date().toISOString()}] ⚠️ EPUB: Invalid entry ${entryCount}, skipping`);
                    zipfile.readEntry();
                    return;
                }
                
                console.log(`[${new Date().toISOString()}] 📖 EPUB: Processing entry ${entryCount}: "${entry.fileName}"`);
                
                if (entry.fileName.endsWith('/')) {
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Skipping directory: ${entry.fileName}`);
                    zipfile.readEntry();
                    return;
                }
                
                zipfile.openReadStream(entry, (err, readStream) => {
                    if (err) {
                        console.error(`[${new Date().toISOString()}] ❌ EPUB: Failed to read entry "${entry.fileName}": ${err.message}`);
                        zipfile.readEntry();
                        return;
                    }
                    
                    const chunks = [];
                    readStream.on('data', chunk => chunks.push(chunk));
                    readStream.on('end', () => {
                        const content = Buffer.concat(chunks).toString('utf8');
                        files.set(entry.fileName, content);
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Extracted "${entry.fileName}" (${content.length} chars)`);
                        zipfile.readEntry();
                    });
                    readStream.on('error', (streamErr) => {
                        console.error(`[${new Date().toISOString()}] ❌ EPUB: Stream error for "${entry.fileName}": ${streamErr.message}`);
                        zipfile.readEntry();
                    });
                });
            });
            
            zipfile.on('end', async () => {
                console.log(`[${new Date().toISOString()}] 📖 EPUB: Finished reading ZIP file. Total entries processed: ${entryCount}`);
                console.log(`[${new Date().toISOString()}] 📖 EPUB: Total files extracted: ${files.size}`);
                console.log(`[${new Date().toISOString()}] 📖 EPUB: File list: ${Array.from(files.keys()).join(', ')}`);
                
                try {
                    // Parse container.xml to find OPF file
                    const containerXml = files.get('META-INF/container.xml');
                    if (!containerXml) {
                        console.error(`[${new Date().toISOString()}] ❌ EPUB: Missing container.xml file`);
                        throw new Error('Missing container.xml');
                    }
                    
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Found container.xml (${containerXml.length} chars)`);
                    
                    const opfPathMatch = containerXml.match(/full-path="([^"]+)"/i);
                    if (!opfPathMatch) {
                        console.error(`[${new Date().toISOString()}] ❌ EPUB: Could not find OPF path in container.xml`);
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Container.xml content: ${containerXml.substring(0, 500)}...`);
                        throw new Error('Could not find OPF file path');
                    }
                    
                    const opfPath = opfPathMatch[1];
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Found OPF path: "${opfPath}"`);
                    
                    const opfContent = files.get(opfPath);
                    if (!opfContent) {
                        console.error(`[${new Date().toISOString()}] ❌ EPUB: Could not find OPF file at path: "${opfPath}"`);
                        throw new Error('Could not find OPF file');
                    }
                    
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Found OPF content (${opfContent.length} chars)`);
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: OPF preview: ${opfContent.substring(0, 200)}...`);
                    
                    // Extract metadata
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Extracting metadata...`);
                    const titleMatch = opfContent.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
                    const creatorMatch = opfContent.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i);
                    const descMatch = opfContent.match(/<dc:description[^>]*>([^<]+)<\/dc:description>/i);
                    
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Title: ${titleMatch ? titleMatch[1] : 'None'}`);
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Creator: ${creatorMatch ? creatorMatch[1] : 'None'}`);
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Description: ${descMatch ? descMatch[1].substring(0, 100) : 'None'}...`);
                    
                    // Extract cover image - try multiple methods
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Searching for cover image...`);
                    let coverPath = null;
                    
                    // Method 1: Look for <meta name="cover" content="..."/>
                    const coverMetaMatch = opfContent.match(/<meta\s+name="cover"\s+content="([^"]+)"/i);
                    if (coverMetaMatch) {
                        const coverId = coverMetaMatch[1];
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Found cover meta with ID: ${coverId}`);
                        const coverItemMatch = opfContent.match(new RegExp(`<item\\s+id="${coverId}"[^>]*href="([^"]+)"`, 'i'));
                        if (coverItemMatch) {
                            const opfDir = path.dirname(opfPath);
                            coverPath = opfDir === '.' ? coverItemMatch[1] : `${opfDir}/${coverItemMatch[1]}`;
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Method 1 - Cover path: ${coverPath}`);
                        } else {
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Method 1 - Could not find item with cover ID`);
                        }
                    } else {
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Method 1 - No cover meta found`);
                    }
                    
                    // Method 2: Look for cover-image in manifest items if method 1 failed
                    if (!coverPath) {
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Trying method 2 - looking for cover-image ID`);
                        const coverItemMatch = opfContent.match(/<item[^>]*id="cover-image"[^>]*href="([^"]+)"/i) ||
                                             opfContent.match(/<item[^>]*href="([^"]+)"[^>]*id="cover-image"/i);
                        if (coverItemMatch) {
                            const opfDir = path.dirname(opfPath);
                            coverPath = opfDir === '.' ? coverItemMatch[1] : `${opfDir}/${coverItemMatch[1]}`;
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Method 2 - Cover path: ${coverPath}`);
                        } else {
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Method 2 - No cover-image ID found`);
                        }
                    }
                    
                    // Method 3: Look for any item with "cover" in the id
                    if (!coverPath) {
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Trying method 3 - looking for any cover ID`);
                        const coverItemMatch = opfContent.match(/<item[^>]*id="[^"]*cover[^"]*"[^>]*href="([^"]+)"/i);
                        if (coverItemMatch) {
                            const opfDir = path.dirname(opfPath);
                            coverPath = opfDir === '.' ? coverItemMatch[1] : `${opfDir}/${coverItemMatch[1]}`;
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Method 3 - Cover path: ${coverPath}`);
                        } else {
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Method 3 - No cover ID pattern found`);
                        }
                    }
                    
                    // Method 4: Look for first image file as fallback
                    if (!coverPath) {
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Trying method 4 - looking for first image file`);
                        const imageItemMatch = opfContent.match(/<item[^>]*media-type="image\/[^"]*"[^>]*href="([^"]+)"/i);
                        if (imageItemMatch) {
                            const opfDir = path.dirname(opfPath);
                            coverPath = opfDir === '.' ? imageItemMatch[1] : `${opfDir}/${imageItemMatch[1]}`;
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Method 4 - Cover path: ${coverPath}`);
                        } else {
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Method 4 - No image files found in manifest`);
                        }
                    }
                    
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Final cover path: ${coverPath || 'None'}`);
                    
                    // Additional debugging for cover path resolution
                    if (coverPath) {
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Checking if cover exists in ZIP...`);
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Looking for: "${coverPath}"`);
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Available files: ${Array.from(files.keys()).filter(f => f.includes('cover') || f.includes('jpeg') || f.includes('jpg') || f.includes('png')).join(', ')}`);
                        if (files.has(coverPath)) {
                            console.log(`[${new Date().toISOString()}] ✅ EPUB: Cover file found in extracted files`);
                        } else {
                            console.log(`[${new Date().toISOString()}] ❌ EPUB: Cover file NOT found in extracted files`);
                            // Try case-insensitive match
                            const lowerCoverPath = coverPath.toLowerCase();
                            for (const filePath of files.keys()) {
                                if (filePath.toLowerCase() === lowerCoverPath) {
                                    console.log(`[${new Date().toISOString()}] 🔍 EPUB: Found case-insensitive match: "${filePath}" for "${coverPath}"`);
                                    break;
                                }
                            }
                        }
                    }
                    
                    if (coverPath && !files.has(coverPath)) {
                        console.log(`[${new Date().toISOString()}] ⚠️ EPUB: Cover file "${coverPath}" not found in extracted files`);
                    }
                    
                    metadata = {
                        title: titleMatch ? titleMatch[1] : null,
                        creator: creatorMatch ? creatorMatch[1] : null,
                        description: descMatch ? descMatch[1] : null,
                        coverPath: coverPath
                    };
                    
                    // Extract spine order
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Extracting spine order...`);
                    const spineMatches = opfContent.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i);
                    if (spineMatches) {
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Found spine section`);
                        const itemrefMatches = spineMatches[1].match(/<itemref[^>]*idref="([^"]+)"/gi);
                        if (itemrefMatches) {
                            spine = itemrefMatches.map(match => {
                                const idMatch = match.match(/idref="([^"]+)"/i);
                                return idMatch ? idMatch[1] : null;
                            }).filter(Boolean);
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Found ${spine.length} spine items: ${spine.join(', ')}`);
                        } else {
                            console.log(`[${new Date().toISOString()}] ⚠️ EPUB: No itemref matches found in spine`);
                        }
                    } else {
                        console.log(`[${new Date().toISOString()}] ❌ EPUB: No spine section found`);
                    }
                    
                    // Map spine IDs to file paths
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Mapping manifest items...`);
                    const manifestItems = new Map();
                    const manifestMatches = opfContent.match(/<item[^>]+>/gi);
                    if (manifestMatches) {
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Found ${manifestMatches.length} manifest items`);
                        manifestMatches.forEach((item, index) => {
                            const idMatch = item.match(/id="([^"]+)"/i);
                            const hrefMatch = item.match(/href="([^"]+)"/i);
                            if (idMatch && hrefMatch) {
                                manifestItems.set(idMatch[1], hrefMatch[1]);
                                if (index < 10) { // Log first 10 items
                                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Manifest item: ${idMatch[1]} -> ${hrefMatch[1]}`);
                                }
                            }
                        });
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Total manifest items mapped: ${manifestItems.size}`);
                    } else {
                        console.log(`[${new Date().toISOString()}] ❌ EPUB: No manifest items found`);
                    }
                    
                    // Extract chapters
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Extracting chapters...`);
                    const opfDir = path.dirname(opfPath);
                    const chapters = [];
                    
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: OPF directory: "${opfDir}"`);
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Processing ${Math.min(spine.length, 20)} chapters`);
                    
                    for (const spineId of spine.slice(0, 20)) { // Limit to first 20 chapters
                        const href = manifestItems.get(spineId);
                        if (href) {
                            const chapterPath = opfDir === '.' ? href : `${opfDir}/${href}`;
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Processing chapter: ${spineId} -> ${href} -> ${chapterPath}`);
                            const chapterContent = files.get(chapterPath);
                            if (chapterContent) {
                                console.log(`[${new Date().toISOString()}] 📖 EPUB: Found chapter content (${chapterContent.length} chars)`);
                            } else {
                                console.log(`[${new Date().toISOString()}] ⚠️ EPUB: Chapter content not found for path: ${chapterPath}`);
                                console.log(`[${new Date().toISOString()}] 📖 EPUB: Available files: ${Array.from(files.keys()).slice(0, 10).join(', ')}...`);
                            }
                            if (chapterContent) {
                                // Extract title from content
                                const titleMatch = chapterContent.match(/<title[^>]*>([^<]+)<\/title>/i) ||
                                                chapterContent.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i);
                                
                                // Clean HTML content while preserving text content
                                let cleanContent = chapterContent
                                    .replace(/<script[\s\S]*?<\/script>/gi, '')
                                    .replace(/<style[\s\S]*?<\/style>/gi, '')
                                    .replace(/<head[\s\S]*?<\/head>/gi, '')
                                    .replace(/<\/?html[^>]*>/gi, '')
                                    .replace(/<\/?body[^>]*>/gi, '')
                                    .replace(/class="[^"]*"/gi, '')
                                    .replace(/style="[^"]*"/gi, '')
                                    .replace(/xmlns[^=]*="[^"]*"/gi, '')
                                    .replace(/<\?xml[^>]*\?>/gi, '')
                                    .trim();
                                
                                // If content is mostly empty after cleaning, try to extract text content
                                if (cleanContent.length < 100 || !cleanContent.match(/<[^>]+>/)) {
                                    console.log(`[${new Date().toISOString()}] ⚠️ EPUB: Chapter content seems empty, trying body extraction`);
                                    // Try to extract just the text content if HTML structure is problematic
                                    const textMatch = chapterContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                                    if (textMatch) {
                                        cleanContent = textMatch[1]
                                            .replace(/<script[\s\S]*?<\/script>/gi, '')
                                            .replace(/<style[\s\S]*?<\/style>/gi, '')
                                            .replace(/class="[^"]*"/gi, '')
                                            .replace(/style="[^"]*"/gi, '')
                                            .trim();
                                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Extracted body content (${cleanContent.length} chars)`);
                                    } else {
                                        console.log(`[${new Date().toISOString()}] ⚠️ EPUB: No body section found, using original content`);
                                        cleanContent = chapterContent.trim();
                                    }
                                }
                                
                                // Decode HTML entities (including incomplete ones)
                                cleanContent = cleanContent
                                    .replace(/&#(\d+);?/g, (match, dec) => String.fromCharCode(dec))
                                    .replace(/&#x([a-fA-F0-9]+);?/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
                                    .replace(/&quot;?/g, '"')
                                    .replace(/&apos;?/g, "'")
                                    .replace(/&lt;?/g, '<')
                                    .replace(/&gt;?/g, '>')
                                    .replace(/&nbsp;?/g, ' ')
                                    .replace(/&amp;?/g, '&');
                                    
                                // Clean up problematic Unicode characters that cause LaTeX errors
                                cleanContent = cleanContent
                                    // Smart quotes to regular quotes
                                    .replace(/[\u2018\u2019]/g, "'")  // Left/right single quotation marks → apostrophe
                                    .replace(/[\u201C\u201D]/g, '"')  // Left/right double quotation marks → quote
                                    // Dashes
                                    .replace(/[\u2013\u2014]/g, '--') // En dash, Em dash → double hyphen
                                    // Other common problematic characters
                                    .replace(/\u2026/g, '...')        // Horizontal ellipsis → three dots
                                    .replace(/\u00A0/g, ' ')          // Non-breaking space → regular space
                                    .replace(/\u2022/g, '* ')         // Bullet → asterisk
                                    .replace(/[\u2020\u2021]/g, '*')  // Dagger/double dagger → asterisk
                                    // Unicode space characters → regular space
                                    .replace(/[\u2002-\u2009\u200A\u202F\u205F]/g, ' ') // Various Unicode spaces
                                    .replace(/\u200B/g, '')           // Zero Width Space → remove
                                    // Handle CJK (Chinese, Japanese, Korean) characters
                                    .replace(/汉语水平考试/g, 'HSK')    // Chinese Proficiency Test → HSK
                                    // CJK Punctuation (must come before character ranges to avoid partial matches)
                                    .replace(/[\u3000-\u303f]/g, ' ')     // CJK Symbols and Punctuation → space
                                    .replace(/。/g, '.')                  // Ideographic full stop → period
                                    .replace(/、/g, ',')                  // Ideographic comma → comma
                                    .replace(/「/g, '"')                  // Left corner bracket → quote
                                    .replace(/」/g, '"')                  // Right corner bracket → quote
                                    .replace(/『/g, '"')                  // Left white corner bracket → quote
                                    .replace(/』/g, '"')                  // Right white corner bracket → quote
                                    .replace(/[\u4e00-\u9fff]/g, '[CJK]') // Chinese characters → placeholder
                                    .replace(/[\u3040-\u309f]/g, '[CJK]') // Hiragana → placeholder
                                    .replace(/[\u30a0-\u30ff]/g, '[CJK]') // Katakana → placeholder
                                    .replace(/[\uac00-\ud7af]/g, '[CJK]') // Korean → placeholder
                                    // Additional CJK ranges
                                    .replace(/[\u2e80-\u2eff]/g, '[CJK]') // CJK Radicals Supplement
                                    .replace(/[\u2f00-\u2fdf]/g, '[CJK]') // Kangxi Radicals
                                    .replace(/[\u3400-\u4dbf]/g, '[CJK]') // CJK Extension A
                                    .replace(/[\uf900-\ufaff]/g, '[CJK]') // CJK Compatibility Ideographs
                                    // Remove or replace other potentially problematic Unicode characters
                                    .replace(/[\u0080-\u009F]/g, '')  // Control characters
                                    .replace(/[\uF000-\uF8FF]/g, '')  // Private Use Area characters
                                    // Replace any remaining high Unicode characters with safe alternatives
                                    .replace(/[\u2100-\u214F]/g, '')  // Letterlike symbols
                                    .replace(/[\u2200-\u22FF]/g, '')  // Mathematical operators (keep our declared ones)
                                    .replace(/[\u2300-\u23FF]/g, ''); // Miscellaneous technical symbols
                                
                                // Truncate content if too large (>50KB per chapter)
                                if (cleanContent.length > 50000) {
                                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Truncating large chapter content from ${cleanContent.length} chars`);
                                    cleanContent = cleanContent.substring(0, 50000) + '...\n\n<p><em>[Content truncated for performance]</em></p>';
                                }
                                
                                const chapterTitle = titleMatch ? titleMatch[1].trim() : `Chapter ${chapters.length + 1}`;
                                console.log(`[${new Date().toISOString()}] 📖 EPUB: Added chapter: "${chapterTitle}" (${cleanContent.length} chars)`);
                                
                                chapters.push({
                                    title: chapterTitle,
                                    content: cleanContent
                                });
                            }
                        }
                    }
                    
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Total chapters extracted: ${chapters.length}`);
                    
                    if (chapters.length === 0) {
                        console.error(`[${new Date().toISOString()}] ❌ EPUB: No readable chapters found`);
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Spine items: ${spine.length}, Manifest items: ${manifestItems.size}`);
                        throw new Error('No readable chapters found');
                    }
                    
                    // Extract cover image data if found
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Processing cover image...`);
                    let coverImage = null;
                    if (metadata.coverPath) {
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: Looking for cover at path: ${metadata.coverPath}`);
                        // Read cover as binary data
                        if (files.has(metadata.coverPath)) {
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Found cover file: ${metadata.coverPath}`);
                            const mimeType = metadata.coverPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
                            console.log(`[${new Date().toISOString()}] 📖 EPUB: Cover MIME type: ${mimeType}`);
                            // Store the cover path for serving via separate endpoint
                            coverImage = metadata.coverPath;
                        }
                        if (!coverImage) {
                            console.log(`[${new Date().toISOString()}] ⚠️ EPUB: Cover file not found in extracted files`);
                        }
                    } else {
                        console.log(`[${new Date().toISOString()}] 📖 EPUB: No cover path specified in metadata`);
                    }
                    
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Extraction completed successfully`);
                    console.log(`[${new Date().toISOString()}] 📖 EPUB: Final result - Metadata: ${JSON.stringify(metadata)}, Chapters: ${chapters.length}, Cover: ${coverImage || 'None'}`);
                    
                    resolve({ metadata, chapters, coverImage });
                } catch (error) {
                    reject(error);
                }
            });
        });
    });
}

// Handle direct cover image requests - fallback
function serveCoverImageFallback(req, res) {
    console.log(`[${new Date().toISOString()}] GET /cover.jpeg - direct request (should be rare after URL rewriting)`);
    console.log(`[${new Date().toISOString()}] Referer: ${req.get('Referer')}`);
    
    // This is a fallback for any missed image references
    // In most cases, images should go through /epub-cover endpoint
    res.status(404).json({ 
        error: 'Cover image not found. Images should use /epub-cover endpoint.',
        hint: 'This suggests a URL rewriting issue in EPUB content'
    });
}

async function serveEpubAsPdf(req, res) {
    const requestedFile = req.query.path;
    console.log(`[${new Date().toISOString()}] GET /epub-pdf - file: "${requestedFile}"`);
    
    if (!requestedFile) {
        console.log(`[${new Date().toISOString()}] ❌ EPUB to PDF: File path is required`);
        return res.status(400).json({ error: 'File path is required' });
    }
    
    const filePath = path.join(baseDir, requestedFile);
    console.log(`[${new Date().toISOString()}] [EPUB to PDF] Full file path: ${filePath}`);
    
    if (!filePath.startsWith(baseDir)) {
        console.log(`[${new Date().toISOString()}] ❌ EPUB to PDF: Forbidden access to ${filePath}`);
        return res.status(403).json({ error: 'Forbidden' });
    }
    
    if (!fs.existsSync(filePath)) {
        console.log(`[${new Date().toISOString()}] ❌ EPUB to PDF: File not found: ${filePath}`);
        return res.status(404).json({ error: 'File not found' });
    }
    
    if (path.extname(filePath).toLowerCase() !== '.epub') {
        console.log(`[${new Date().toISOString()}] ❌ EPUB to PDF: Not an EPUB file: ${filePath}`);
        return res.status(400).json({ error: 'Not an EPUB file' });
    }
    
    try {
        console.log(`[${new Date().toISOString()}] 🔄 Converting EPUB to PDF...`);
        const pdfBuffer = await convertEpubToPdf(filePath);
        
        console.log(`[${new Date().toISOString()}] ✅ EPUB to PDF conversion completed - ${pdfBuffer.length} bytes`);
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${path.basename(requestedFile, '.epub')}.pdf"`);
        res.send(pdfBuffer);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ EPUB to PDF conversion error: ${error.message}`);
        res.status(500).json({ error: `EPUB to PDF conversion error: ${error.message}` });
    }
}

async function validateImage(imagePath) {
    const { spawn } = require('child_process');
    
    return new Promise((resolve) => {
        console.log(`[${new Date().toISOString()}] 🔍 Validating image: ${imagePath}`);
        
        // Use ImageMagick's identify command with more detailed output to check image validity
        const identify = spawn('identify', ['-ping', '-verbose', imagePath]);
        
        let isValid = false;
        let stderr = '';
        let stdout = '';
        
        identify.stdout.on('data', (data) => {
            stdout += data.toString();
            // Check for successful image identification and valid dimensions
            const output = data.toString();
            
            // Check for various corruption patterns
            const hasZeroDimensions = output.includes('0x0');
            const hasNegative32768 = output.includes('-32768');
            const hasCorruptedDimensions = output.includes('32768x0') || output.includes('0x32768');
            const hasInvalidValues = output.includes('inf') || output.includes('nan');
            
            if (output.includes(imagePath) && 
                !hasZeroDimensions && 
                !hasNegative32768 && 
                !hasCorruptedDimensions &&
                !hasInvalidValues) {
                // Additional check for reasonable dimensions using multiple patterns
                const geometryMatch = output.match(/Geometry:\s*(\d+)x(\d+)/) ||
                                    output.match(/(\d+)x(\d+)/) ||
                                    output.match(/width:\s*(\d+).*height:\s*(\d+)/);
                
                if (geometryMatch) {
                    const width = parseInt(geometryMatch[1]);
                    const height = parseInt(geometryMatch[2]);
                    if (width > 0 && height > 0 && width < 50000 && height < 50000) {
                        // Additional safety check for the specific 32768 corruption
                        if (width !== 32768 || height !== 0) {
                            isValid = true;
                        }
                    }
                }
            }
        });
        
        identify.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        identify.on('close', (code) => {
            console.log(`[${new Date().toISOString()}] 🔍 Image validation result for ${imagePath}:`);
            console.log(`[${new Date().toISOString()}] - Exit code: ${code}`);
            console.log(`[${new Date().toISOString()}] - Is valid: ${isValid}`);
            console.log(`[${new Date().toISOString()}] - Stdout preview: ${stdout.substring(0, 300)}...`);
            
            // Check for specific corruption patterns and log them
            const hasZeroDimensions = stdout.includes('0x0');
            const hasNegative32768 = stdout.includes('-32768');
            const hasCorruptedDimensions = stdout.includes('32768x0') || stdout.includes('0x32768');
            const hasInvalidValues = stdout.includes('inf') || stdout.includes('nan');
            
            if (hasZeroDimensions || hasNegative32768 || hasCorruptedDimensions || hasInvalidValues) {
                console.log(`[${new Date().toISOString()}] - Corruption detected: 0x0=${hasZeroDimensions}, -32768=${hasNegative32768}, 32768x0=${hasCorruptedDimensions}, inf/nan=${hasInvalidValues}`);
            }
            
            if (stderr) {
                console.log(`[${new Date().toISOString()}] - Stderr: ${stderr.substring(0, 200)}...`);
            }
            
            if (code === 0 && isValid) {
                console.log(`[${new Date().toISOString()}] ✅ Image is valid: ${imagePath}`);
                resolve(true);
            } else {
                console.log(`[${new Date().toISOString()}] ❌ Image is corrupted: ${imagePath} - Code: ${code}, Valid: ${isValid}`);
                resolve(false);
            }
        });
        
        identify.on('error', (error) => {
            console.log(`[${new Date().toISOString()}] ❌ ImageMagick error for ${imagePath}: ${error.message}`);
            resolve(false);
        });
        
        // Timeout after 10 seconds (increased for verbose output)
        setTimeout(() => {
            identify.kill();
            console.log(`[${new Date().toISOString()}] ⏰ Image validation timed out: ${imagePath}`);
            resolve(false);
        }, 10000);
    });
}

async function preprocessEpubForPdf(epubFilePath) {
    const yauzl = require('yauzl');
    const os = require('os');
    const fs = require('fs');
    
    return new Promise((resolve, reject) => {
        console.log(`[${new Date().toISOString()}] 🔄 Preprocessing EPUB for PDF conversion: ${epubFilePath}`);
        
        // Create temporary directory for processing
        const tempDir = path.join(os.tmpdir(), `epub-preprocess-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        
        // Enhanced cleanup function
        const cleanup = (keepTempEpub = false) => {
            try {
                if (fs.existsSync(tempDir)) {
                    // If keeping temp EPUB, only clean the extract directory
                    if (keepTempEpub) {
                        const extractDir = path.join(tempDir, 'extract');
                        if (fs.existsSync(extractDir)) {
                            fs.rmSync(extractDir, { recursive: true, force: true });
                        }
                    } else {
                        fs.rmSync(tempDir, { recursive: true, force: true });
                    }
                }
            } catch (cleanupErr) {
                console.warn(`[${new Date().toISOString()}] ⚠️ Cleanup warning: ${cleanupErr.message}`);
            }
        };
        
        try {
            fs.mkdirSync(tempDir, { recursive: true });
            console.log(`[${new Date().toISOString()}] 📁 Created temp directory: ${tempDir}`);
        } catch (err) {
            console.error(`[${new Date().toISOString()}] ❌ Failed to create temp directory: ${err.message}`);
            return resolve(epubFilePath); // Fallback to original
        }
        
        yauzl.open(epubFilePath, { lazyEntries: true }, async (err, zipfile) => {
            if (err) {
                console.error(`[${new Date().toISOString()}] ❌ Failed to open EPUB: ${err.message}`);
                cleanup();
                return resolve(epubFilePath); // Fallback to original
            }
            
            const files = new Map();
            const corruptedImages = new Set();
            let processedCount = 0;
            let totalEntries = 0;
            let processingErrors = 0;
            
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                if (entry.fileName.endsWith('/')) {
                    // Skip directories
                    zipfile.readEntry();
                    return;
                }
                
                totalEntries++;
                
                // Process this entry
                zipfile.openReadStream(entry, async (streamErr, readStream) => {
                    if (streamErr) {
                        console.error(`[${new Date().toISOString()}] ❌ Failed to read entry "${entry.fileName}": ${streamErr.message}`);
                        processingErrors++;
                        zipfile.readEntry();
                        return;
                    }
                    
                    try {
                        const chunks = [];
                        readStream.on('data', chunk => chunks.push(chunk));
                        readStream.on('end', async () => {
                            try {
                                const content = Buffer.concat(chunks);
                                
                                // No longer sanitizing CJK characters - xelatex will handle them natively
                                files.set(entry.fileName, content);
                                
                                // Check if this is an image file
                                const isImage = /\.(jpe?g|png|gif|bmp|tiff?)$/i.test(entry.fileName);
                                if (isImage) {
                                    // Write to temp file for validation with better error handling
                                    const tempImagePath = path.join(tempDir, `temp-${Math.random().toString(36).slice(2)}${path.extname(entry.fileName)}`);
                                    try {
                                        fs.writeFileSync(tempImagePath, content);
                                        
                                        // Add timeout to validation
                                        const validationPromise = validateImage(tempImagePath);
                                        const timeoutPromise = new Promise((_, timeoutReject) => {
                                            setTimeout(() => timeoutReject(new Error('Validation timeout')), 15000);
                                        });
                                        
                                        const isValid = await Promise.race([validationPromise, timeoutPromise]);
                                        
                                        if (!isValid) {
                                            console.log(`[${new Date().toISOString()}] 🗑️ Marking corrupted image for removal: ${entry.fileName}`);
                                            corruptedImages.add(entry.fileName);
                                        }
                                        
                                        // Clean up temp image file
                                        if (fs.existsSync(tempImagePath)) {
                                            fs.unlinkSync(tempImagePath);
                                        }
                                    } catch (tempErr) {
                                        console.error(`[${new Date().toISOString()}] ❌ Error validating image ${entry.fileName}: ${tempErr.message}`);
                                        // Mark as corrupted if validation fails to be safe
                                        corruptedImages.add(entry.fileName);
                                        processingErrors++;
                                        
                                        // Clean up temp image file on error
                                        try {
                                            if (fs.existsSync(tempImagePath)) {
                                                fs.unlinkSync(tempImagePath);
                                            }
                                        } catch (unlinkErr) {
                                            console.warn(`[${new Date().toISOString()}] ⚠️ Failed to clean temp file: ${unlinkErr.message}`);
                                        }
                                    }
                                }
                                
                                processedCount++;
                                if (processedCount % 10 === 0) {
                                    console.log(`[${new Date().toISOString()}] 📊 Processed ${processedCount}/${totalEntries} files`);
                                }
                                
                                // Read next entry
                                zipfile.readEntry();
                            } catch (processingErr) {
                                console.error(`[${new Date().toISOString()}] ❌ Error processing ${entry.fileName}: ${processingErr.message}`);
                                processingErrors++;
                                
                                // If too many errors, abort and use original file
                                if (processingErrors > Math.min(10, totalEntries * 0.5)) {
                                    console.error(`[${new Date().toISOString()}] ❌ Too many processing errors (${processingErrors}), aborting preprocessing`);
                                    cleanup();
                                    resolve(epubFilePath);
                                    return;
                                }
                                
                                zipfile.readEntry();
                            }
                        });
                        
                        readStream.on('error', (streamErr) => {
                            console.error(`[${new Date().toISOString()}] ❌ Stream error for "${entry.fileName}": ${streamErr.message}`);
                            processingErrors++;
                            zipfile.readEntry();
                        });
                    } catch (entryErr) {
                        console.error(`[${new Date().toISOString()}] ❌ Error setting up stream for ${entry.fileName}: ${entryErr.message}`);
                        processingErrors++;
                        zipfile.readEntry();
                    }
                });
            });
            
            zipfile.on('error', (zipErr) => {
                console.error(`[${new Date().toISOString()}] ❌ ZIP reading error: ${zipErr.message}`);
                cleanup();
                resolve(epubFilePath); // Fallback to original
            });
            
            zipfile.on('end', async () => {
                console.log(`[${new Date().toISOString()}] 📊 Finished processing ${totalEntries} total entries`);
                console.log(`[${new Date().toISOString()}] 📊 Processed ${processedCount} files`);
                console.log(`[${new Date().toISOString()}] 📊 Found ${corruptedImages.size} corrupted images to remove`);
                console.log(`[${new Date().toISOString()}] 📊 Processing errors: ${processingErrors}`);
                
                if (corruptedImages.size === 0) {
                    // No corrupted images, use original file
                    console.log(`[${new Date().toISOString()}] ✅ No preprocessing needed, using original EPUB`);
                    cleanup();
                    resolve(epubFilePath);
                    return;
                }
                
                // Create new EPUB without corrupted images
                try {
                    const result = await createCleanedEpub();
                    resolve(result);
                } catch (createErr) {
                    console.error(`[${new Date().toISOString()}] ❌ Failed to create cleaned EPUB: ${createErr.message}`);
                    cleanup();
                    resolve(epubFilePath); // Fallback to original
                }
                
                async function createCleanedEpub() {
                    const tempEpubPath = path.join(tempDir, 'cleaned.epub');
                    const { spawn } = require('child_process');
                    
                    // Write all non-corrupted files to temp directory
                    const extractDir = path.join(tempDir, 'extract');
                    fs.mkdirSync(extractDir, { recursive: true });
                    
                    let filesWritten = 0;
                    let writeErrors = 0;
                    
                    for (const [fileName, content] of files) {
                        if (!corruptedImages.has(fileName)) {
                            try {
                                const filePath = path.join(extractDir, fileName);
                                const fileDir = path.dirname(filePath);
                                
                                // Create directory structure
                                if (!fs.existsSync(fileDir)) {
                                    fs.mkdirSync(fileDir, { recursive: true });
                                }
                                
                                fs.writeFileSync(filePath, content);
                                filesWritten++;
                            } catch (writeErr) {
                                console.error(`[${new Date().toISOString()}] ❌ Failed to write file ${fileName}: ${writeErr.message}`);
                                writeErrors++;
                                
                                // If too many write errors, abort
                                if (writeErrors > 5) {
                                    throw new Error(`Too many file write errors: ${writeErrors}`);
                                }
                            }
                        } else {
                            console.log(`[${new Date().toISOString()}] 🗑️ Skipping corrupted image: ${fileName}`);
                        }
                    }
                    
                    console.log(`[${new Date().toISOString()}] 📊 Wrote ${filesWritten} files to extract directory`);
                    
                    // Create ZIP using system command with better error handling
                    return new Promise((zipResolve) => {
                        const zip = spawn('zip', ['-r', tempEpubPath, '.'], {
                            cwd: extractDir,
                            stdio: ['pipe', 'pipe', 'pipe']
                        });
                        
                        let zipStderr = '';
                        
                        zip.stderr.on('data', (data) => {
                            zipStderr += data.toString();
                        });
                        
                        zip.on('close', (code) => {
                            if (code === 0 && fs.existsSync(tempEpubPath)) {
                                const stats = fs.statSync(tempEpubPath);
                                console.log(`[${new Date().toISOString()}] ✅ Created cleaned EPUB: ${tempEpubPath} (${stats.size} bytes)`);
                                cleanup(true); // Keep the temp EPUB but clean extract dir
                                zipResolve(tempEpubPath);
                            } else {
                                console.error(`[${new Date().toISOString()}] ❌ ZIP creation failed with code ${code}`);
                                if (zipStderr) {
                                    console.error(`[${new Date().toISOString()}] ZIP stderr: ${zipStderr}`);
                                }
                                cleanup();
                                zipResolve(epubFilePath); // Fallback to original
                            }
                        });
                        
                        zip.on('error', (zipErr) => {
                            console.error(`[${new Date().toISOString()}] ❌ ZIP creation error: ${zipErr.message}`);
                            cleanup();
                            zipResolve(epubFilePath); // Fallback to original
                        });
                        
                        // Timeout for ZIP operation
                        setTimeout(() => {
                            zip.kill();
                            console.error(`[${new Date().toISOString()}] ❌ ZIP creation timed out`);
                            cleanup();
                            zipResolve(epubFilePath);
                        }, 60000); // 1 minute timeout
                    });
                }
            });
        });
    });
}

async function convertEpubToPdf(epubFilePath) {
    const { spawn } = require('child_process');
    const os = require('os');
    const fs = require('fs');
    
    return new Promise(async (resolve, reject) => {
        let processedEpubPath = epubFilePath;
        let tempDir = null;
        
        try {
            // Preprocess EPUB to remove corrupted images
            console.log(`[${new Date().toISOString()}] 🔄 Preprocessing EPUB to remove corrupted images...`);
            processedEpubPath = await preprocessEpubForPdf(epubFilePath);
            
            if (processedEpubPath !== epubFilePath) {
                tempDir = path.dirname(processedEpubPath);
                console.log(`[${new Date().toISOString()}] ✅ Using cleaned EPUB: ${processedEpubPath}`);
            }
        } catch (preprocessErr) {
            console.error(`[${new Date().toISOString()}] ⚠️ EPUB preprocessing failed, using original: ${preprocessErr.message}`);
            // Continue with original file if preprocessing fails
        }
        
        // Create temporary output file
        const tempPdfPath = path.join(os.tmpdir(), `epub-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
        
        console.log(`[${new Date().toISOString()}] 📖 Converting EPUB: ${processedEpubPath}`);
        console.log(`[${new Date().toISOString()}] 📄 Temp PDF: ${tempPdfPath}`);
        
        // Use pandoc with xelatex - supports Unicode characters natively
        // Note: CJK support requires texlive-lang-chinese package (xeCJK.sty)
        // We use a simpler setup that works without CJK packages
        const pandoc = spawn('pandoc', [
            processedEpubPath,
            '-o', tempPdfPath,
            '--pdf-engine=xelatex',
            '--pdf-engine-opt=-interaction=nonstopmode',
            '--pdf-engine-opt=-file-line-error',
            '--from=epub',
            '--to=pdf',
            // PDF quality settings - larger font and better spacing for screen reading
            '-V', 'geometry:margin=0.75in',
            '-V', 'fontsize=12pt',
            '-V', 'linestretch=1.3',
            // Basic packages for image handling (fontspec is included by xelatex by default)
            '-V', 'header-includes=\\usepackage{graphicx}',
            '-V', 'header-includes=\\usepackage{grffile}',
            // Set default max dimensions for images to prevent division by zero errors
            '-V', 'header-includes=\\setkeys{Gin}{width=\\textwidth,height=\\textheight,keepaspectratio}',
            // High DPI settings for sharper rendering
            '--dpi=300'
        ]);
        
        let stderr = '';
        let timeoutHandle;
        
        // Cleanup function
        const cleanup = () => {
            // Clean up temp PDF file
            if (fs.existsSync(tempPdfPath)) {
                try {
                    fs.unlinkSync(tempPdfPath);
                } catch (unlinkErr) {
                    console.warn(`[${new Date().toISOString()}] ⚠️ Failed to clean temp PDF: ${unlinkErr.message}`);
                }
            }
            // Clean up preprocessed EPUB if it was created
            if (tempDir && fs.existsSync(tempDir)) {
                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                } catch (rmErr) {
                    console.warn(`[${new Date().toISOString()}] ⚠️ Failed to clean temp directory: ${rmErr.message}`);
                }
            }
        };
        
        pandoc.stderr.on('data', (data) => {
            stderr += data.toString();
            console.log(`[${new Date().toISOString()}] [pandoc stderr] ${data.toString()}`);
        });
        
        pandoc.on('error', (error) => {
            console.error(`[${new Date().toISOString()}] ❌ Pandoc spawn error: ${error.message}`);
            cleanup();
            if (timeoutHandle) clearTimeout(timeoutHandle);
            reject(new Error(`Failed to spawn pandoc: ${error.message}`));
        });
        
        pandoc.on('close', (code) => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            
            if (code !== 0) {
                console.error(`[${new Date().toISOString()}] ❌ Pandoc exited with code ${code}`);
                console.error(`[${new Date().toISOString()}] stderr: ${stderr}`);
                
                cleanup();
                
                // Detect specific error types and provide helpful messages
                let errorMessage = 'PDF conversion failed';
                
                if (stderr.includes('Unicode character') || stderr.includes('not set up for use with LaTeX')) {
                    // Extract the Unicode character if possible for better debugging
                    const unicodeMatch = stderr.match(/Unicode character (.+?) \(U\+([0-9A-F]+)\)/);
                    if (unicodeMatch) {
                        const charCode = unicodeMatch[2];
                        console.log(`[${new Date().toISOString()}] 🔍 Problematic Unicode character: ${unicodeMatch[1]} (U+${charCode})`);
                        
                        // Log this for future enhancement
                        console.log(`[${new Date().toISOString()}] 💡 Consider adding: '-V', 'header-includes=\\\\DeclareUnicodeCharacter{${charCode}}{[replacement]}',`);
                        
                        errorMessage = `This EPUB contains Unicode character "${unicodeMatch[1]}" (U+${charCode}) that cannot be converted to PDF. The character may be a special symbol, emoji, or non-Latin character not supported by our PDF converter.`;
                    } else {
                        // Try to extract the line that caused the error for better context
                        const lineMatch = stderr.match(/l\.(\d+)\s+(.*)/);
                        if (lineMatch) {
                            console.log(`[${new Date().toISOString()}] 🔍 Error at line ${lineMatch[1]}: ${lineMatch[2].substring(0, 100)}...`);
                        }
                        errorMessage = 'This EPUB contains Unicode characters or special symbols that cannot be converted to PDF. Try viewing the EPUB directly instead.';
                    }
                } else if (stderr.includes('Division by 0') || stderr.includes('graphics Error') || stderr.includes('Dimension too large')) {
                    errorMessage = 'This EPUB contains images with invalid dimensions that cannot be processed. The EPUB file may be corrupted or use an unsupported image format. Our preprocessing should have caught this - the corruption may be in a format we don\'t yet handle.';
                } else if (stderr.includes('Font') && stderr.includes('not loadable')) {
                    errorMessage = 'PDF conversion failed due to missing fonts. The required LaTeX fonts are not installed on the server.';
                } else if (stderr.includes('Emergency stop') || stderr.includes('Fatal error')) {
                    errorMessage = 'PDF conversion encountered a fatal error. This typically indicates severely corrupted EPUB content or incompatible formatting.';
                } else if (stderr.includes('No pages of output') || stderr.includes('Output written on')) {
                    // Sometimes LaTeX produces warnings but still succeeds
                    if (fs.existsSync(tempPdfPath)) {
                        const stats = fs.statSync(tempPdfPath);
                        if (stats.size > 0) {
                            console.log(`[${new Date().toISOString()}] ⚠️ LaTeX warnings but PDF was created (${stats.size} bytes)`);
                            // Continue to read the PDF despite warnings
                            fs.readFile(tempPdfPath, (err, data) => {
                                cleanup();
                                
                                if (err) {
                                    console.error(`[${new Date().toISOString()}] ❌ Failed to read PDF: ${err.message}`);
                                    reject(err);
                                    return;
                                }
                                
                                console.log(`[${new Date().toISOString()}] ✅ PDF conversion successful with warnings: ${data.length} bytes`);
                                resolve(data);
                            });
                            return;
                        }
                    }
                    errorMessage = 'PDF conversion produced no output. The EPUB content may be empty or incompatible with PDF format.';
                } else {
                    // Generic error with shortened technical details
                    const shortError = stderr.substring(0, 300);
                    errorMessage = `PDF conversion failed: ${shortError}${stderr.length > 300 ? '...' : ''}`;
                }
                
                reject(new Error(errorMessage));
                return;
            }
            
            // Read the generated PDF
            fs.readFile(tempPdfPath, (err, data) => {
                cleanup();
                
                if (err) {
                    console.error(`[${new Date().toISOString()}] ❌ Failed to read PDF: ${err.message}`);
                    reject(err);
                    return;
                }
                
                console.log(`[${new Date().toISOString()}] ✅ PDF conversion successful: ${data.length} bytes`);
                resolve(data);
            });
        });
        
        // Set timeout (5 minutes max for conversion)
        timeoutHandle = setTimeout(() => {
            pandoc.kill();
            cleanup();
            reject(new Error('EPUB to PDF conversion timed out after 5 minutes'));
        }, 5 * 60 * 1000);
    });
}

module.exports = {
    serveEpubCover,
    serveEpubPreview,
    serveCoverImageFallback,
    serveEpubAsPdf
};