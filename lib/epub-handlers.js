const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const { baseDir } = require('./config');

async function serveEpubCover(req, res) {
    try {
        const filePath = req.query.path;
        const coverPath = req.query.cover;
        
        console.log(`[${new Date().toISOString()}] GET /epub-cover - file: "${filePath}", cover: "${coverPath}"`);
        
        if (!filePath || !coverPath) {
            console.log(`[${new Date().toISOString()}] ❌ EPUB cover: Missing parameters`);
            return res.status(400).json({ error: 'Missing file path or cover path' });
        }

        const fullPath = path.join(baseDir, filePath);
        yauzl.open(fullPath, { lazyEntries: true }, (err, zipfile) => {
            if (err) {
                console.error(`[${new Date().toISOString()}] ❌ EPUB cover: ZIP open error: ${err.message}`);
                return res.status(500).json({ error: err.message });
            }
            
            const allEntries = [];
            let foundCover = false;
            
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                if (!entry || !entry.fileName) {
                    zipfile.readEntry();
                    return;
                }
                
                allEntries.push(entry.fileName);
                console.log(`[${new Date().toISOString()}] 📁 EPUB entry: "${entry.fileName}"`);
                
                // Log comparison for debugging
                if (entry.fileName.toLowerCase() === coverPath.toLowerCase()) {
                    console.log(`[${new Date().toISOString()}] 🔍 Case-insensitive match: "${entry.fileName}" === "${coverPath}"`);
                }
                
                if (entry.fileName === coverPath) {
                    foundCover = true;
                    console.log(`[${new Date().toISOString()}] ✅ Found exact cover match: ${entry.fileName}`);
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

async function convertEpubToPdf(epubFilePath) {
    const { spawn } = require('child_process');
    const os = require('os');
    
    return new Promise((resolve, reject) => {
        // Create temporary output file
        const tempPdfPath = path.join(os.tmpdir(), `epub-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
        
        console.log(`[${new Date().toISOString()}] 📖 Converting EPUB: ${epubFilePath}`);
        console.log(`[${new Date().toISOString()}] 📄 Temp PDF: ${tempPdfPath}`);
        
        // Use pandoc with pdflatex (more reliable font handling)
        // Optimize for quality with larger fonts and better spacing
        const pandoc = spawn('pandoc', [
            epubFilePath,
            '-o', tempPdfPath,
            '--pdf-engine=pdflatex',
            '--pdf-engine-opt=-interaction=nonstopmode',
            '--from=epub',
            '--to=pdf',
            // PDF quality settings - larger font and better spacing for screen reading
            '-V', 'geometry:margin=0.75in',
            '-V', 'fontsize=12pt',
            '-V', 'linestretch=1.3',
            // Use Computer Modern fonts which are sharper than default
            '-V', 'fontfamily=lmodern'
        ]);
        
        let stderr = '';
        
        pandoc.stderr.on('data', (data) => {
            stderr += data.toString();
            console.log(`[${new Date().toISOString()}] [pandoc stderr] ${data.toString()}`);
        });
        
        pandoc.on('error', (error) => {
            console.error(`[${new Date().toISOString()}] ❌ Pandoc spawn error: ${error.message}`);
            
            // Clean up temp file
            if (fs.existsSync(tempPdfPath)) {
                fs.unlinkSync(tempPdfPath);
            }
            
            reject(new Error(`Failed to spawn pandoc: ${error.message}`));
        });
        
        pandoc.on('close', (code) => {
            if (code !== 0) {
                console.error(`[${new Date().toISOString()}] ❌ Pandoc exited with code ${code}`);
                console.error(`[${new Date().toISOString()}] stderr: ${stderr}`);
                
                // Clean up temp file
                if (fs.existsSync(tempPdfPath)) {
                    fs.unlinkSync(tempPdfPath);
                }
                
                reject(new Error(`Pandoc conversion failed with code ${code}: ${stderr}`));
                return;
            }
            
            // Read the generated PDF
            fs.readFile(tempPdfPath, (err, data) => {
                // Clean up temp file
                if (fs.existsSync(tempPdfPath)) {
                    fs.unlinkSync(tempPdfPath);
                }
                
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
        setTimeout(() => {
            pandoc.kill();
            
            // Clean up temp file
            if (fs.existsSync(tempPdfPath)) {
                fs.unlinkSync(tempPdfPath);
            }
            
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