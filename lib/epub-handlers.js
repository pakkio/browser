const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const config = require('./config');
const logger = require('./logger');

async function serveEpubCover(req, res) {
    try {
        const filePath = req.query.path;
        let coverPath = req.query.cover;
        
        logger.info(` GET /epub-cover - file: "${filePath}", cover: "${coverPath || 'auto-detect'}"`);
        
        if (!filePath) {
            logger.warn(` ❌ EPUB cover: Missing file path`);
            return res.status(400).json({ error: 'Missing file path' });
        }

        const fullPath = path.join(config.baseDir, filePath);
        
        if (!fs.existsSync(fullPath)) {
            logger.warn(` ❌ EPUB cover: File not found: ${fullPath}`);
            return res.status(404).json({ error: 'File not found' });
        }

        yauzl.open(fullPath, { lazyEntries: true }, (err, zipfile) => {
            if (err) {
                logger.error(` ❌ EPUB cover: ZIP open error: ${err.message}`);
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
                    logger.info(` ✅ Found exact cover match: ${entry.fileName}`);
                    zipfile.openReadStream(entry, (streamErr, readStream) => {
                        if (streamErr) {
                            logger.error(` ❌ EPUB cover: Stream error: ${streamErr.message}`);
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
                    logger.info(` 🔍 Auto-detecting cover from EPUB metadata...`);
                    
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
                                    logger.info(` ✅ Auto-detected cover: ${detectedCover}`);
                                    
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
                
                logger.warn(` ❌ EPUB cover not found. Looking for: "${coverPath || 'auto-detect'}"`);
                res.status(404).json({ 
                    error: 'Cover image not found',
                    requestedPath: coverPath || 'auto-detect',
                    availableEntries: allEntries.filter(e => /\.(jpe?g|png|gif)$/i.test(e)).slice(0, 20)
                });
            });
        });
    } catch (error) {
        logger.error(` ❌ EPUB cover: General error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

async function serveEpubPreview(req, res) {
    const requestedFile = req.query.path;
    logger.info(` GET /epub-preview - file: "${requestedFile}"`);
    logger.info(` [EPUB Debug] Full URL: ${req.url}`);
    logger.info(` [EPUB Debug] Query params:`, req.query);
    logger.info(` [EPUB Debug] Headers:`, req.headers);
    
    if (!requestedFile) {
        logger.warn(` ❌ EPUB preview: File path is required`);
        return res.status(400).json({ error: 'File path is required' });
    }
    
    const filePath = path.join(config.baseDir, requestedFile);
    logger.info(` [EPUB Debug] Base dir: ${config.baseDir}`);
    logger.info(` [EPUB Debug] Requested file: ${requestedFile}`);
    logger.info(` [EPUB Debug] Full file path: ${filePath}`);
    logger.info(` [EPUB Debug] File exists: ${fs.existsSync(filePath)}`);
    
    if (!filePath.startsWith(config.baseDir)) {
        logger.warn(` ❌ EPUB preview: Forbidden access to ${filePath}`);
        return res.status(403).json({ error: 'Forbidden' });
    }
    
    if (!fs.existsSync(filePath)) {
        logger.warn(` ❌ EPUB preview: File not found: ${filePath}`);
        return res.status(404).json({ error: 'File not found' });
    }
    
    if (path.extname(filePath).toLowerCase() !== '.epub') {
        logger.warn(` ❌ EPUB preview: Not an EPUB file: ${filePath}`);
        return res.status(400).json({ error: 'Not an EPUB file' });
    }
    
    try {
        logger.info(` 🔄 Extracting EPUB content...`);
        const epubData = await extractEpubContent(filePath);
        logger.info(` ✅ EPUB extraction completed - ${epubData.chapters.length} chapters`);
        logger.info(` [EPUB Debug] Setting Content-Type to application/json`);
        res.setHeader('Content-Type', 'application/json');
        res.json(epubData);
    } catch (error) {
        logger.error(` ❌ EPUB extraction error: ${error.message}`);
        logger.error(` [EPUB Debug] Error stack:`, error.stack);
        res.setHeader('Content-Type', 'application/json');
        res.status(500).json({ error: `EPUB extraction error: ${error.message}` });
    }
}

async function extractEpubContent(filePath) {
    logger.info(` 📖 Starting EPUB extraction for: ${filePath}`);
    
    return new Promise((resolve, reject) => {
        yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
            if (err) {
                logger.error(` ❌ EPUB: Failed to open ZIP file: ${err.message}`);
                return reject(err);
            }
            
            logger.info(` 📖 EPUB: Successfully opened ZIP file`);
            
            const files = new Map();
            let metadata = {};
            let spine = [];
            let entryCount = 0;
            
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                entryCount++;
                
                if (!entry || !entry.fileName) {
                    logger.warn(` ⚠️ EPUB: Invalid entry ${entryCount}, skipping`);
                    zipfile.readEntry();
                    return;
                }
                
                logger.info(` 📖 EPUB: Processing entry ${entryCount}: "${entry.fileName}"`);
                
                if (entry.fileName.endsWith('/')) {
                    logger.info(` 📖 EPUB: Skipping directory: ${entry.fileName}`);
                    zipfile.readEntry();
                    return;
                }
                
                zipfile.openReadStream(entry, (err, readStream) => {
                    if (err) {
                        logger.error(` ❌ EPUB: Failed to read entry "${entry.fileName}": ${err.message}`);
                        zipfile.readEntry();
                        return;
                    }
                    
                    const chunks = [];
                    readStream.on('data', chunk => chunks.push(chunk));
                    readStream.on('end', () => {
                        const content = Buffer.concat(chunks).toString('utf8');
                        files.set(entry.fileName, content);
                        logger.info(` 📖 EPUB: Extracted "${entry.fileName}" (${content.length} chars)`);
                        zipfile.readEntry();
                    });
                    readStream.on('error', (streamErr) => {
                        logger.error(` ❌ EPUB: Stream error for "${entry.fileName}": ${streamErr.message}`);
                        zipfile.readEntry();
                    });
                });
            });
            
            zipfile.on('end', async () => {
                logger.info(` 📖 EPUB: Finished reading ZIP file. Total entries processed: ${entryCount}`);
                logger.info(` 📖 EPUB: Total files extracted: ${files.size}`);
                logger.info(` 📖 EPUB: File list: ${Array.from(files.keys()).join(', ')}`);
                
                try {
                    // Parse container.xml to find OPF file
                    const containerXml = files.get('META-INF/container.xml');
                    if (!containerXml) {
                        logger.error(` ❌ EPUB: Missing container.xml file`);
                        throw new Error('Missing container.xml');
                    }
                    
                    logger.info(` 📖 EPUB: Found container.xml (${containerXml.length} chars)`);
                    
                    const opfPathMatch = containerXml.match(/full-path="([^"]+)"/i);
                    if (!opfPathMatch) {
                        logger.error(` ❌ EPUB: Could not find OPF path in container.xml`);
                        logger.info(` 📖 EPUB: Container.xml content: ${containerXml.substring(0, 500)}...`);
                        throw new Error('Could not find OPF file path');
                    }
                    
                    const opfPath = opfPathMatch[1];
                    logger.info(` 📖 EPUB: Found OPF path: "${opfPath}"`);
                    
                    const opfContent = files.get(opfPath);
                    if (!opfContent) {
                        logger.error(` ❌ EPUB: Could not find OPF file at path: "${opfPath}"`);
                        throw new Error('Could not find OPF file');
                    }
                    
                    logger.info(` 📖 EPUB: Found OPF content (${opfContent.length} chars)`);
                    logger.info(` 📖 EPUB: OPF preview: ${opfContent.substring(0, 200)}...`);
                    
                    // Extract metadata
                    logger.info(` 📖 EPUB: Extracting metadata...`);
                    const titleMatch = opfContent.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
                    const creatorMatch = opfContent.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i);
                    const descMatch = opfContent.match(/<dc:description[^>]*>([^<]+)<\/dc:description>/i);
                    
                    logger.info(` 📖 EPUB: Title: ${titleMatch ? titleMatch[1] : 'None'}`);
                    logger.info(` 📖 EPUB: Creator: ${creatorMatch ? creatorMatch[1] : 'None'}`);
                    logger.info(` 📖 EPUB: Description: ${descMatch ? descMatch[1].substring(0, 100) : 'None'}...`);
                    
                    // Extract cover image - try multiple methods
                    logger.info(` 📖 EPUB: Searching for cover image...`);
                    let coverPath = null;
                    
                    // Method 1: Look for <meta name="cover" content="..."/>
                    const coverMetaMatch = opfContent.match(/<meta\s+name="cover"\s+content="([^"]+)"/i);
                    if (coverMetaMatch) {
                        const coverId = coverMetaMatch[1];
                        logger.info(` 📖 EPUB: Found cover meta with ID: ${coverId}`);
                        const coverItemMatch = opfContent.match(new RegExp(`<item\\s+id="${coverId}"[^>]*href="([^"]+)"`, 'i'));
                        if (coverItemMatch) {
                            const opfDir = path.dirname(opfPath);
                            coverPath = opfDir === '.' ? coverItemMatch[1] : `${opfDir}/${coverItemMatch[1]}`;
                            logger.info(` 📖 EPUB: Method 1 - Cover path: ${coverPath}`);
                        } else {
                            logger.info(` 📖 EPUB: Method 1 - Could not find item with cover ID`);
                        }
                    } else {
                        logger.info(` 📖 EPUB: Method 1 - No cover meta found`);
                    }
                    
                    // Method 2: Look for cover-image in manifest items if method 1 failed
                    if (!coverPath) {
                        logger.info(` 📖 EPUB: Trying method 2 - looking for cover-image ID`);
                        const coverItemMatch = opfContent.match(/<item[^>]*id="cover-image"[^>]*href="([^"]+)"/i) ||
                                             opfContent.match(/<item[^>]*href="([^"]+)"[^>]*id="cover-image"/i);
                        if (coverItemMatch) {
                            const opfDir = path.dirname(opfPath);
                            coverPath = opfDir === '.' ? coverItemMatch[1] : `${opfDir}/${coverItemMatch[1]}`;
                            logger.info(` 📖 EPUB: Method 2 - Cover path: ${coverPath}`);
                        } else {
                            logger.info(` 📖 EPUB: Method 2 - No cover-image ID found`);
                        }
                    }
                    
                    // Method 3: Look for any item with "cover" in the id
                    if (!coverPath) {
                        logger.info(` 📖 EPUB: Trying method 3 - looking for any cover ID`);
                        const coverItemMatch = opfContent.match(/<item[^>]*id="[^"]*cover[^"]*"[^>]*href="([^"]+)"/i);
                        if (coverItemMatch) {
                            const opfDir = path.dirname(opfPath);
                            coverPath = opfDir === '.' ? coverItemMatch[1] : `${opfDir}/${coverItemMatch[1]}`;
                            logger.info(` 📖 EPUB: Method 3 - Cover path: ${coverPath}`);
                        } else {
                            logger.info(` 📖 EPUB: Method 3 - No cover ID pattern found`);
                        }
                    }
                    
                    // Method 4: Look for first image file as fallback
                    if (!coverPath) {
                        logger.info(` 📖 EPUB: Trying method 4 - looking for first image file`);
                        const imageItemMatch = opfContent.match(/<item[^>]*media-type="image\/[^"]*"[^>]*href="([^"]+)"/i);
                        if (imageItemMatch) {
                            const opfDir = path.dirname(opfPath);
                            coverPath = opfDir === '.' ? imageItemMatch[1] : `${opfDir}/${imageItemMatch[1]}`;
                            logger.info(` 📖 EPUB: Method 4 - Cover path: ${coverPath}`);
                        } else {
                            logger.info(` 📖 EPUB: Method 4 - No image files found in manifest`);
                        }
                    }
                    
                    logger.info(` 📖 EPUB: Final cover path: ${coverPath || 'None'}`);
                    
                    // Additional debugging for cover path resolution
                    if (coverPath) {
                        logger.info(` 📖 EPUB: Checking if cover exists in ZIP...`);
                        logger.info(` 📖 EPUB: Looking for: "${coverPath}"`);
                        logger.info(` 📖 EPUB: Available files: ${Array.from(files.keys()).filter(f => f.includes('cover') || f.includes('jpeg') || f.includes('jpg') || f.includes('png')).join(', ')}`);
                        if (files.has(coverPath)) {
                            logger.info(` ✅ EPUB: Cover file found in extracted files`);
                        } else {
                            logger.warn(` ❌ EPUB: Cover file NOT found in extracted files`);
                            // Try case-insensitive match
                            const lowerCoverPath = coverPath.toLowerCase();
                            for (const filePath of files.keys()) {
                                if (filePath.toLowerCase() === lowerCoverPath) {
                                    logger.info(` 🔍 EPUB: Found case-insensitive match: "${filePath}" for "${coverPath}"`);
                                    break;
                                }
                            }
                        }
                    }
                    
                    if (coverPath && !files.has(coverPath)) {
                        logger.info(` ⚠️ EPUB: Cover file "${coverPath}" not found in extracted files`);
                    }
                    
                    metadata = {
                        title: titleMatch ? titleMatch[1] : null,
                        creator: creatorMatch ? creatorMatch[1] : null,
                        description: descMatch ? descMatch[1] : null,
                        coverPath: coverPath
                    };
                    
                    // Extract spine order
                    logger.info(` 📖 EPUB: Extracting spine order...`);
                    const spineMatches = opfContent.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i);
                    if (spineMatches) {
                        logger.info(` 📖 EPUB: Found spine section`);
                        const itemrefMatches = spineMatches[1].match(/<itemref[^>]*idref="([^"]+)"/gi);
                        if (itemrefMatches) {
                            spine = itemrefMatches.map(match => {
                                const idMatch = match.match(/idref="([^"]+)"/i);
                                return idMatch ? idMatch[1] : null;
                            }).filter(Boolean);
                            logger.info(` 📖 EPUB: Found ${spine.length} spine items: ${spine.join(', ')}`);
                        } else {
                            logger.info(` ⚠️ EPUB: No itemref matches found in spine`);
                        }
                    } else {
                        logger.warn(` ❌ EPUB: No spine section found`);
                    }
                    
                    // Map spine IDs to file paths
                    logger.info(` 📖 EPUB: Mapping manifest items...`);
                    const manifestItems = new Map();
                    const manifestMatches = opfContent.match(/<item[^>]+>/gi);
                    if (manifestMatches) {
                        logger.info(` 📖 EPUB: Found ${manifestMatches.length} manifest items`);
                        manifestMatches.forEach((item, index) => {
                            const idMatch = item.match(/id="([^"]+)"/i);
                            const hrefMatch = item.match(/href="([^"]+)"/i);
                            if (idMatch && hrefMatch) {
                                manifestItems.set(idMatch[1], hrefMatch[1]);
                                if (index < 10) { // Log first 10 items
                                    logger.info(` 📖 EPUB: Manifest item: ${idMatch[1]} -> ${hrefMatch[1]}`);
                                }
                            }
                        });
                        logger.info(` 📖 EPUB: Total manifest items mapped: ${manifestItems.size}`);
                    } else {
                        logger.warn(` ❌ EPUB: No manifest items found`);
                    }
                    
                    // Extract chapters
                    logger.info(` 📖 EPUB: Extracting chapters...`);
                    const opfDir = path.dirname(opfPath);
                    const chapters = [];
                    
                    logger.info(` 📖 EPUB: OPF directory: "${opfDir}"`);
                    logger.info(` 📖 EPUB: Processing ${Math.min(spine.length, 20)} chapters`);
                    
                    for (const spineId of spine.slice(0, 20)) { // Limit to first 20 chapters
                        const href = manifestItems.get(spineId);
                        if (href) {
                            const chapterPath = opfDir === '.' ? href : `${opfDir}/${href}`;
                            logger.info(` 📖 EPUB: Processing chapter: ${spineId} -> ${href} -> ${chapterPath}`);
                            const chapterContent = files.get(chapterPath);
                            if (chapterContent) {
                                logger.info(` 📖 EPUB: Found chapter content (${chapterContent.length} chars)`);
                            } else {
                                logger.info(` ⚠️ EPUB: Chapter content not found for path: ${chapterPath}`);
                                logger.info(` 📖 EPUB: Available files: ${Array.from(files.keys()).slice(0, 10).join(', ')}...`);
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
                                    logger.info(` ⚠️ EPUB: Chapter content seems empty, trying body extraction`);
                                    // Try to extract just the text content if HTML structure is problematic
                                    const textMatch = chapterContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                                    if (textMatch) {
                                        cleanContent = textMatch[1]
                                            .replace(/<script[\s\S]*?<\/script>/gi, '')
                                            .replace(/<style[\s\S]*?<\/style>/gi, '')
                                            .replace(/class="[^"]*"/gi, '')
                                            .replace(/style="[^"]*"/gi, '')
                                            .trim();
                                        logger.info(` 📖 EPUB: Extracted body content (${cleanContent.length} chars)`);
                                    } else {
                                        logger.info(` ⚠️ EPUB: No body section found, using original content`);
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
                                    logger.info(` 📖 EPUB: Truncating large chapter content from ${cleanContent.length} chars`);
                                    cleanContent = cleanContent.substring(0, 50000) + '...\n\n<p><em>[Content truncated for performance]</em></p>';
                                }
                                
                                const chapterTitle = titleMatch ? titleMatch[1].trim() : `Chapter ${chapters.length + 1}`;
                                logger.info(` 📖 EPUB: Added chapter: "${chapterTitle}" (${cleanContent.length} chars)`);
                                
                                chapters.push({
                                    title: chapterTitle,
                                    content: cleanContent
                                });
                            }
                        }
                    }
                    
                    logger.info(` 📖 EPUB: Total chapters extracted: ${chapters.length}`);
                    
                    if (chapters.length === 0) {
                        logger.error(` ❌ EPUB: No readable chapters found`);
                        logger.info(` 📖 EPUB: Spine items: ${spine.length}, Manifest items: ${manifestItems.size}`);
                        throw new Error('No readable chapters found');
                    }
                    
                    // Extract cover image data if found
                    logger.info(` 📖 EPUB: Processing cover image...`);
                    let coverImage = null;
                    if (metadata.coverPath) {
                        logger.info(` 📖 EPUB: Looking for cover at path: ${metadata.coverPath}`);
                        // Read cover as binary data
                        if (files.has(metadata.coverPath)) {
                            logger.info(` 📖 EPUB: Found cover file: ${metadata.coverPath}`);
                            const mimeType = metadata.coverPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
                            logger.info(` 📖 EPUB: Cover MIME type: ${mimeType}`);
                            // Store the cover path for serving via separate endpoint
                            coverImage = metadata.coverPath;
                        }
                        if (!coverImage) {
                            logger.info(` ⚠️ EPUB: Cover file not found in extracted files`);
                        }
                    } else {
                        logger.info(` 📖 EPUB: No cover path specified in metadata`);
                    }
                    
                    logger.info(` 📖 EPUB: Extraction completed successfully`);
                    logger.info(` 📖 EPUB: Final result - Metadata: ${JSON.stringify(metadata)}, Chapters: ${chapters.length}, Cover: ${coverImage || 'None'}`);
                    
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
    logger.info(` GET /cover.jpeg - direct request (should be rare after URL rewriting)`);
    logger.info(` Referer: ${req.get('Referer')}`);
    
    // This is a fallback for any missed image references
    // In most cases, images should go through /epub-cover endpoint
    res.status(404).json({ 
        error: 'Cover image not found. Images should use /epub-cover endpoint.',
        hint: 'This suggests a URL rewriting issue in EPUB content'
    });
}


module.exports = {
    serveEpubCover,
    serveEpubPreview,
    serveCoverImageFallback
};