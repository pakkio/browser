
// Enhanced file renderer supporting PDFs, images, videos, audio, and text files

class FileRenderer {
    constructor() {
        this.handlers = new Map();
        this.setupHandlers();
    }

    setupHandlers() {
        this.handlers.set('text', new TextRenderer());
        this.handlers.set('image', new ImageRenderer());
        this.handlers.set('pdf', new PDFRenderer());
        this.handlers.set('comic', new ComicRenderer());
        this.handlers.set('audio', new AudioRenderer());
        this.handlers.set('video', new VideoRenderer());
        this.handlers.set('docx', new DocxRenderer());
        this.handlers.set('xlsx', new XlsxRenderer());
        this.handlers.set('pptx', new PptxRenderer());
        this.handlers.set('epub', new EpubRenderer());
        // Treat .doc as .docx for rendering
        this.handlers.set('doc', this.handlers.get('docx'));
        // Add a CSS class to the <pre> element for better text contrast and fix font rendering
        const style = document.createElement('style');
        style.innerHTML = `
            pre#content-code, pre code#content-code {
                background: #222 !important;
                color: #f8f8f2 !important;
                border-radius: 8px;
                padding: 16px;
                font-size: 1em;
                font-family: 'Fira Mono', 'Consolas', 'Menlo', 'Monaco', 'Liberation Mono', monospace !important;
                line-height: 1.8 !important;
                letter-spacing: 0.02em !important;
                overflow-x: auto;
                white-space: pre-wrap !important;
                word-break: break-word !important;
                box-sizing: border-box;
            }
            pre#content-code code, pre code#content-code {
                display: block;
                line-height: inherit !important;
                font-family: inherit !important;
                font-size: inherit !important;
                background: none !important;
                color: inherit !important;
                padding: 0;
                margin: 0;
            }
            pre#content-code::-webkit-scrollbar, pre code#content-code::-webkit-scrollbar {
                height: 8px;
                background: #222;
            }
            pre#content-code::-webkit-scrollbar-thumb, pre code#content-code::-webkit-scrollbar-thumb {
                background: #444;
                border-radius: 4px;
            }
        `;
        document.head.appendChild(style);
    }

    getFileType(fileName) {
        const extension = fileName.split('.').pop().toLowerCase();
        // Treat .doc as .docx
        if (extension === 'doc') return 'docx';

        if (['txt', 'md', 'js', 'html', 'css', 'json', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'csv', 'srt', 'xml', 'yaml', 'yml', 'ini', 'conf', 'log', 'sh', 'bat', 'ps1', 'sql', 'php', 'rb', 'swift', 'kt', 'dart', 'r', 'scala', 'clj', 'elm', 'vue', 'jsx', 'tsx', 'ts', 'less', 'scss', 'sass', 'styl', 'svelte', 'astro'].includes(extension)) {
            return 'text';
        } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) {
            return 'image';
        } else if (extension === 'pdf') {
            return 'pdf';
        } else if (['cbz', 'cbr'].includes(extension)) {
            return 'comic';
        } else if (['mp3', 'wav', 'flac', 'ogg'].includes(extension)) {
            return 'audio';
        } else if (['mp4', 'avi', 'mov', 'mkv'].includes(extension)) {
            return 'video';
        } else if (extension === 'docx') {
            return 'docx';
        } else if (extension === 'xlsx') {
            return 'xlsx';
        } else if (extension === 'pptx') {
            return 'pptx';
        } else if (extension === 'epub') {
            return 'epub';
        }
        return 'unsupported';
    }

    async render(filePath, fileName, contentCode, contentOther) {
        const fileType = this.getFileType(fileName);
        const handler = this.handlers.get(fileType);
        
        contentCode.innerHTML = '';
        contentOther.innerHTML = '';
        contentCode.parentElement.style.display = 'none';
        contentOther.style.display = 'none';
        
        if (handler) {
            await handler.render(filePath, fileName, contentCode, contentOther);
        } else {
            contentOther.textContent = 'File type not supported for preview.';
            contentOther.style.display = 'block';
        }
    }

    async testRender(fileType, testFilePath, testFileName) {
        const handler = this.handlers.get(fileType);
        if (!handler) {
            console.error(`No handler for file type: ${fileType}`);
            return false;
        }

        try {
            const testContainer = document.createElement('div');
            testContainer.id = 'test-container';
            document.body.appendChild(testContainer);

            const mockContentCode = document.createElement('pre');
            const mockContentOther = document.createElement('div');
            testContainer.appendChild(mockContentCode);
            testContainer.appendChild(mockContentOther);

            console.log(`Testing ${fileType} with file: ${testFileName}`);
            await handler.render(testFilePath, testFileName, mockContentCode, mockContentOther);
            
            console.log(`✓ ${fileType} render completed successfully`);
            return true;
        } catch (error) {
            console.error(`✗ ${fileType} render failed:`, error);
            return false;
        }
    }
}

class TextRenderer {
    async render(filePath, fileName, contentCode, contentOther) {
        const extension = fileName.split('.').pop().toLowerCase();
        const response = await fetch(`/files?path=${encodeURIComponent(filePath)}`);
        const text = await response.text();
        
        if (extension === 'csv') {
            this.renderCSV(text, contentOther);
        } else if (extension === 'srt') {
            this.renderSRT(text, contentOther);
        } else {
            contentCode.textContent = text;
            contentCode.className = `language-${extension}`;
            hljs.highlightElement(contentCode);
            contentCode.parentElement.style.display = 'block';
        }
    }
    
    renderCSV(csvText, contentOther) {
        const lines = csvText.split('\n').filter(line => line.trim());
        if (lines.length === 0) return;
        
        const csvContainer = document.createElement('div');
        csvContainer.className = 'csv-container';
        csvContainer.style.cssText = `
            background: rgba(255, 255, 255, 0.1);
            padding: 20px;
            border-radius: 15px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            overflow-x: auto;
        `;
        
        const table = document.createElement('table');
        table.style.cssText = `
            width: 100%;
            border-collapse: collapse;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 10px;
        `;
        
        lines.forEach((line, index) => {
            const row = document.createElement('tr');
            const cells = this.parseCSVLine(line);
            
            cells.forEach((cell, cellIndex) => {
                const cellElement = document.createElement(index === 0 ? 'th' : 'td');
                cellElement.textContent = cell;
                cellElement.style.cssText = `
                    padding: 8px 12px;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    color: ${index === 0 ? '#4ecdc4' : '#ffffff'};
                    font-weight: ${index === 0 ? 'bold' : 'normal'};
                    background: ${index === 0 ? 'rgba(78, 205, 196, 0.1)' : 'transparent'};
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 200px;
                `;
                row.appendChild(cellElement);
            });
            table.appendChild(row);
        });
        
        csvContainer.appendChild(table);
        contentOther.appendChild(csvContainer);
        contentOther.style.display = 'block';
    }
    
    renderSRT(srtText, contentOther) {
        const srtContainer = document.createElement('div');
        srtContainer.className = 'srt-container';
        srtContainer.style.cssText = `
            background: rgba(255, 255, 255, 0.1);
            padding: 20px;
            border-radius: 15px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            max-height: 70vh;
            overflow-y: auto;
        `;
        
        const subtitles = this.parseSRT(srtText);
        
        subtitles.forEach((subtitle, index) => {
            const subtitleBlock = document.createElement('div');
            subtitleBlock.style.cssText = `
                margin-bottom: 20px;
                padding: 15px;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 10px;
                border-left: 3px solid #4ecdc4;
            `;
            
            const timeCode = document.createElement('div');
            timeCode.textContent = `${subtitle.start} → ${subtitle.end}`;
            timeCode.style.cssText = `
                color: #4ecdc4;
                font-size: 12px;
                font-weight: bold;
                margin-bottom: 8px;
            `;
            
            const text = document.createElement('div');
            text.innerHTML = subtitle.text.replace(/\n/g, '<br>');
            text.style.cssText = `
                color: #ffffff;
                line-height: 1.4;
            `;
            
            subtitleBlock.appendChild(timeCode);
            subtitleBlock.appendChild(text);
            srtContainer.appendChild(subtitleBlock);
        });
        
        contentOther.appendChild(srtContainer);
        contentOther.style.display = 'block';
    }
    
    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        
        result.push(current.trim());
        return result;
    }
    
    parseSRT(srtText) {
        const blocks = srtText.split(/\n\s*\n/).filter(block => block.trim());
        const subtitles = [];
        
        blocks.forEach(block => {
            const lines = block.trim().split('\n');
            if (lines.length >= 3) {
                const timeLine = lines[1];
                const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/);
                
                if (timeMatch) {
                    subtitles.push({
                        start: timeMatch[1],
                        end: timeMatch[2],
                        text: lines.slice(2).join('\n')
                    });
                }
            }
        });
        
        return subtitles;
    }
}

class ImageRenderer {
    async render(filePath, fileName, contentCode, contentOther) {
        const img = document.createElement('img');
        img.src = `/files?path=${encodeURIComponent(filePath)}`;
        img.style.maxWidth = '100%';
        img.onerror = () => {
            contentOther.textContent = `Failed to load image: ${fileName}`;
        };
        contentOther.appendChild(img);
        contentOther.style.display = 'block';
    }
}

class PDFRenderer {
    async render(filePath, fileName, contentCode, contentOther) {
        const pdfContainer = document.createElement('div');
        pdfContainer.className = 'pdf-container';
        
        const controls = document.createElement('div');
        controls.className = 'pdf-controls';
        controls.innerHTML = `
            <button id="pdf-prev">Previous</button>
            <span id="pdf-page-info">Page 1</span>
            <button id="pdf-next">Next</button>
            <span id="pdf-status" style="margin-left: 10px; font-style: italic;"></span>
        `;
        
        const pageImg = document.createElement('img');
        pageImg.style.maxWidth = '100%';
        pageImg.style.border = '1px solid #ccc';
        
        pdfContainer.appendChild(controls);
        pdfContainer.appendChild(pageImg);
        contentOther.appendChild(pdfContainer);
        contentOther.style.display = 'block';
        
        let currentPage = 1;
        const statusElement = controls.querySelector('#pdf-status');
        
        const loadPage = async (page) => {
            try {
                statusElement.textContent = 'Loading...';
                const response = await fetch(`/pdf-preview?path=${encodeURIComponent(filePath)}&page=${page}`);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const blob = await response.blob();
                if (blob.size === 0) {
                    throw new Error('Empty response');
                }
                
                pageImg.src = URL.createObjectURL(blob);
                document.getElementById('pdf-page-info').textContent = `Page ${page}`;
                statusElement.textContent = '';
            } catch (error) {
                console.error('PDF load error:', error);
                statusElement.textContent = `Error: ${error.message}`;
                pageImg.src = '';
            }
        };
        
        document.getElementById('pdf-prev').addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                loadPage(currentPage);
            }
        });
        
        document.getElementById('pdf-next').addEventListener('click', () => {
            currentPage++;
            loadPage(currentPage);
        });
        
        await loadPage(currentPage);
    }
}

class ComicRenderer {
    async render(filePath, fileName, contentCode, contentOther) {
        const comicContainer = document.createElement('div');
        comicContainer.className = 'comic-container';
        
        const controls = document.createElement('div');
        controls.className = 'comic-controls';
        controls.innerHTML = `
            <button id="comic-prev">Previous</button>
            <span id="comic-page-info">Page 1</span>
            <button id="comic-next">Next</button>
            <span id="comic-status" style="margin-left: 10px; font-style: italic;"></span>
        `;
        
        const pageImg = document.createElement('img');
        pageImg.style.maxWidth = '100%';
        pageImg.style.border = '1px solid #ccc';
        pageImg.style.display = 'block';
        pageImg.style.margin = '0 auto';
        
        comicContainer.appendChild(controls);
        comicContainer.appendChild(pageImg);
        contentOther.appendChild(comicContainer);
        contentOther.style.display = 'block';
        
        let currentPage = 1;
        const statusElement = controls.querySelector('#comic-status');
        
        const loadPage = async (page) => {
            try {
                statusElement.textContent = 'Loading...';
                const response = await fetch(`/comic-preview?path=${encodeURIComponent(filePath)}&page=${page}`);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const blob = await response.blob();
                pageImg.src = URL.createObjectURL(blob);
                document.getElementById('comic-page-info').textContent = `Page ${page}`;
                statusElement.textContent = '';
            } catch (error) {
                console.error('Comic load error:', error);
                statusElement.textContent = `Error: ${error.message}`;
            }
        };
        
        document.getElementById('comic-prev').addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                loadPage(currentPage);
            }
        });
        
        document.getElementById('comic-next').addEventListener('click', () => {
            currentPage++;
            loadPage(currentPage);
        });
        
        await loadPage(currentPage);
    }
}

class AudioRenderer {
    async render(filePath, fileName, contentCode, contentOther) {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = `/files?path=${encodeURIComponent(filePath)}`;
        contentOther.appendChild(audio);
        contentOther.style.display = 'block';
    }
}

class VideoRenderer {
    async render(filePath, fileName, contentCode, contentOther) {
        const video = document.createElement('video');
        video.controls = true;
        video.src = `/files?path=${encodeURIComponent(filePath)}`;
        video.style.maxWidth = '100%';
        contentOther.appendChild(video);
        contentOther.style.display = 'block';
    }
}

class DocxRenderer {
    async render(filePath, fileName, contentCode, contentOther) {
        try {
            const response = await fetch(`/files?path=${encodeURIComponent(filePath)}`);
            const arrayBuffer = await response.arrayBuffer();
            
            const result = await mammoth.convertToHtml({arrayBuffer: arrayBuffer});
            
            const docxContainer = document.createElement('div');
            docxContainer.className = 'docx-container';
            docxContainer.style.cssText = `
                background: white;
                padding: 20px;
                border: 1px solid #ccc;
                border-radius: 4px;
                font-family: Arial, sans-serif;
                line-height: 1.6;
                max-width: 100%;
                overflow-x: auto;
            `;
            
            docxContainer.innerHTML = result.value;
            
            if (result.messages && result.messages.length > 0) {
                const messagesDiv = document.createElement('div');
                messagesDiv.className = 'docx-messages';
                messagesDiv.style.cssText = `
                    margin-top: 10px;
                    padding: 10px;
                    background: #f5f5f5;
                    font-size: 12px;
                    color: #666;
                `;
                messagesDiv.innerHTML = '<strong>Conversion notes:</strong><br>' + 
                    result.messages.map(m => m.message).join('<br>');
                docxContainer.appendChild(messagesDiv);
            }
            
            contentOther.appendChild(docxContainer);
            contentOther.style.display = 'block';
        } catch (error) {
            console.error('DOCX render error:', error);
            contentOther.innerHTML = `<div style="color: red;">Error loading DOCX file: ${error.message}</div>`;
            contentOther.style.display = 'block';
        }
    }
}

class XlsxRenderer {
    async render(filePath, fileName, contentCode, contentOther) {
        try {
            const response = await fetch(`/files?path=${encodeURIComponent(filePath)}`);
            const arrayBuffer = await response.arrayBuffer();
            
            const workbook = XLSX.read(arrayBuffer, {type: 'array'});
            
            const xlsxContainer = document.createElement('div');
            xlsxContainer.className = 'xlsx-container';
            xlsxContainer.style.cssText = `
                background: white;
                padding: 20px;
                border: 1px solid #ccc;
                border-radius: 4px;
                max-width: 100%;
                overflow-x: auto;
            `;
            
            if (workbook.SheetNames.length > 1) {
                const tabsDiv = document.createElement('div');
                tabsDiv.className = 'xlsx-tabs';
                tabsDiv.style.cssText = `
                    margin-bottom: 10px;
                    border-bottom: 1px solid #ccc;
                `;
                
                workbook.SheetNames.forEach((sheetName, index) => {
                    const tab = document.createElement('button');
                    tab.textContent = sheetName;
                    tab.style.cssText = `
                        padding: 8px 16px;
                        margin-right: 4px;
                        border: 1px solid #ccc;
                        background: ${index === 0 ? '#007acc' : '#f5f5f5'};
                        color: ${index === 0 ? 'white' : 'black'};
                        cursor: pointer;
                        border-radius: 4px 4px 0 0;
                    `;
                    tab.onclick = () => this.showSheet(workbook, sheetName, xlsxContainer, workbook.SheetNames);
                    tabsDiv.appendChild(tab);
                });
                
                xlsxContainer.appendChild(tabsDiv);
            }
            
            const sheetDiv = document.createElement('div');
            sheetDiv.className = 'xlsx-sheet';
            xlsxContainer.appendChild(sheetDiv);
            
            this.showSheet(workbook, workbook.SheetNames[0], xlsxContainer, workbook.SheetNames);
            
            contentOther.appendChild(xlsxContainer);
            contentOther.style.display = 'block';
        } catch (error) {
            console.error('XLSX render error:', error);
            contentOther.innerHTML = `<div style="color: red;">Error loading XLSX file: ${error.message}</div>`;
            contentOther.style.display = 'block';
        }
    }
    
    showSheet(workbook, sheetName, container, allSheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const htmlTable = XLSX.utils.sheet_to_html(worksheet);
        
        const sheetDiv = container.querySelector('.xlsx-sheet');
        sheetDiv.innerHTML = htmlTable;
        
        const table = sheetDiv.querySelector('table');
        if (table) {
            table.style.cssText = `
                border-collapse: collapse;
                width: 100%;
                font-size: 12px;
            `;
            
            const cells = table.querySelectorAll('td, th');
            cells.forEach(cell => {
                cell.style.cssText = `
                    border: 1px solid #ccc;
                    padding: 4px 8px;
                    text-align: left;
                `;
            });
            
            const headers = table.querySelectorAll('th');
            headers.forEach(header => {
                header.style.backgroundColor = '#f5f5f5';
                header.style.fontWeight = 'bold';
            });
        }
        
        if (allSheetNames.length > 1) {
            const tabs = container.querySelectorAll('.xlsx-tabs button');
            tabs.forEach(tab => {
                const isActive = tab.textContent === sheetName;
                tab.style.background = isActive ? '#007acc' : '#f5f5f5';
                tab.style.color = isActive ? 'white' : 'black';
            });
        }
    }
}

class PptxRenderer {
    async render(filePath, fileName, contentCode, contentOther) {
        try {
            const pptxContainer = document.createElement('div');
            pptxContainer.className = 'pptx-container';
            pptxContainer.style.cssText = `
                background: white;
                padding: 20px;
                border: 1px solid #ccc;
                border-radius: 4px;
                text-align: center;
            `;
            
            pptxContainer.innerHTML = `
                <div style="padding: 40px; color: #666;">
                    <h3>PowerPoint Presentation</h3>
                    <p>${fileName}</p>
                    <p style="margin-top: 20px;">
                        <strong>Note:</strong> PowerPoint preview is not fully supported yet.<br>
                        <a href="/files?path=${encodeURIComponent(filePath)}" 
                           download="${fileName}" 
                           style="color: #007acc; text-decoration: none;">
                            Click here to download the file
                        </a>
                    </p>
                </div>
            `;
            
            contentOther.appendChild(pptxContainer);
            contentOther.style.display = 'block';
        } catch (error) {
            console.error('PPTX render error:', error);
            contentOther.innerHTML = `<div style="color: red;">Error loading PPTX file: ${error.message}</div>`;
            contentOther.style.display = 'block';
        }
    }
}

class EpubRenderer {
    async render(filePath, fileName, contentCode, contentOther) {
        try {
            const response = await fetch(`/epub-preview?path=${encodeURIComponent(filePath)}`);
            const epubData = await response.json();
            
            if (!response.ok) {
                throw new Error(epubData.error || 'Failed to load EPUB');
            }
            
            const epubContainer = document.createElement('div');
            epubContainer.className = 'epub-container';
            epubContainer.style.cssText = `
                background: rgba(255, 255, 255, 0.1);
                padding: 20px;
                border-radius: 15px;
                border: 1px solid rgba(255, 255, 255, 0.2);
                min-height: 70vh;
                max-height: 85vh;
                overflow: visible;
                display: flex;
                flex-direction: column;
            `;
            
            // Create header with book info and cover
            const header = document.createElement('div');
            header.className = 'epub-header';
            header.style.cssText = `
                margin-bottom: 20px;
                padding: 15px;
                background: rgba(78, 205, 196, 0.1);
                border-radius: 10px;
                border-left: 3px solid #4ecdc4;
                display: flex;
                gap: 20px;
                align-items: flex-start;
            `;
            
            let headerContent = `
                <div style="flex: 1;">
                    <h3 style="color: #4ecdc4; margin: 0 0 10px 0; font-size: 1.4rem; font-weight: bold;">
                        ${epubData.metadata.title || fileName}
                    </h3>
                    ${epubData.metadata.creator ? `<p style="color: #ffffff; margin: 8px 0; font-size: 1rem; font-weight: 500;">Author: ${epubData.metadata.creator}</p>` : ''}
                    ${epubData.metadata.description ? `<p style="color: rgba(255,255,255,0.9); margin: 8px 0; font-size: 0.9rem; font-style: italic; line-height: 1.4;">${epubData.metadata.description}</p>` : ''}
                </div>
            `;
            
            if (epubData.coverImage) {
                headerContent += `
                    <div style="flex-shrink: 0;">
                        <img src="/epub-cover?path=${encodeURIComponent(filePath)}&cover=${encodeURIComponent(epubData.coverImage)}" 
                             alt="Book cover" 
                             style="max-width: 120px; max-height: 160px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);" 
                             onerror="this.parentNode.innerHTML='<div style=&quot;width: 120px; height: 160px; background: rgba(78, 205, 196, 0.1); border: 2px dashed #4ecdc4; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #4ecdc4; font-size: 0.8rem; text-align: center; padding: 10px;&quot;>Cover image<br>not found</div>'">
                    </div>
                `;
            }
            
            header.innerHTML = headerContent;
            
            // Create navigation controls
            const controls = document.createElement('div');
            controls.className = 'epub-controls';
            controls.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
                padding: 15px;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 10px;
                border: 1px solid rgba(255, 255, 255, 0.1);
            `;
            
            // Create chapter selector
            const chapterSelect = document.createElement('select');
            chapterSelect.id = 'epub-chapter-select';
            chapterSelect.style.cssText = `
                flex: 1;
                padding: 8px 12px;
                margin: 0 10px;
                background: rgba(40, 40, 60, 0.9);
                border: 1px solid rgba(78, 205, 196, 0.3);
                border-radius: 8px;
                color: #ffffff;
                font-size: 0.9rem;
                max-width: 300px;
            `;
            
            epubData.chapters.forEach((chapter, index) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = chapter.title || `Chapter ${index + 1}`;
                option.style.cssText = `
                    background: rgba(40, 40, 60, 0.95);
                    color: #ffffff;
                    padding: 8px;
                `;
                chapterSelect.appendChild(option);
            });
            
            const prevBtn = document.createElement('button');
            prevBtn.textContent = '‹ Previous';
            prevBtn.style.cssText = `
                padding: 8px 16px;
                background: rgba(78, 205, 196, 0.2);
                border: 1px solid #4ecdc4;
                border-radius: 8px;
                color: #4ecdc4;
                cursor: pointer;
                font-weight: 600;
                transition: all 0.3s ease;
            `;
            
            const nextBtn = document.createElement('button');
            nextBtn.textContent = 'Next ›';
            nextBtn.style.cssText = prevBtn.style.cssText;
            
            controls.appendChild(prevBtn);
            controls.appendChild(chapterSelect);
            controls.appendChild(nextBtn);
            
            // Create content area
            const contentArea = document.createElement('div');
            contentArea.id = 'epub-content';
            contentArea.style.cssText = `
                flex: 1;
                min-height: 400px;
                max-height: 60vh;
                overflow-y: auto;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 10px;
                padding: 30px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                font-family: 'Georgia', 'Times New Roman', serif;
                font-size: 16px;
                line-height: 1.8;
                color: #ffffff;
                box-shadow: inset 0 2px 8px rgba(0,0,0,0.2);
                scrollbar-width: thin;
                scrollbar-color: #4ecdc4 transparent;
            `;
            
            // Add custom scrollbar styles
            const style = document.createElement('style');
            style.textContent = `
                #epub-content::-webkit-scrollbar {
                    width: 8px;
                }
                #epub-content::-webkit-scrollbar-track {
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 10px;
                }
                #epub-content::-webkit-scrollbar-thumb {
                    background: #4ecdc4;
                    border-radius: 10px;
                }
                #epub-content::-webkit-scrollbar-thumb:hover {
                    background: #45b7aa;
                }
            `;
            document.head.appendChild(style);
            
            // Assemble the container
            epubContainer.appendChild(header);
            epubContainer.appendChild(controls);
            epubContainer.appendChild(contentArea);
            
            // Add event listeners
            let currentChapter = 0;
            
            const showChapter = (chapterIndex) => {
                if (chapterIndex >= 0 && chapterIndex < epubData.chapters.length) {
                    currentChapter = chapterIndex;
                    chapterSelect.value = chapterIndex;
                    contentArea.innerHTML = epubData.chapters[chapterIndex].content;
                    
                    // Style the content
                    const elements = contentArea.querySelectorAll('*');
                    elements.forEach(el => {
                        el.style.color = '#ffffff';
                        if (el.tagName === 'H1') {
                            el.style.color = '#4ecdc4';
                            el.style.fontSize = '1.8rem';
                            el.style.fontWeight = 'bold';
                            el.style.marginBottom = '20px';
                            el.style.marginTop = '25px';
                            el.style.borderBottom = '2px solid rgba(78, 205, 196, 0.3)';
                            el.style.paddingBottom = '10px';
                        }
                        if (el.tagName === 'H2') {
                            el.style.color = '#4ecdc4';
                            el.style.fontSize = '1.5rem';
                            el.style.fontWeight = '600';
                            el.style.marginBottom = '18px';
                            el.style.marginTop = '20px';
                        }
                        if (el.tagName === 'H3') {
                            el.style.color = '#4ecdc4';
                            el.style.fontSize = '1.3rem';
                            el.style.fontWeight = '600';
                            el.style.marginBottom = '15px';
                            el.style.marginTop = '18px';
                        }
                        if (el.tagName === 'P') {
                            el.style.marginBottom = '16px';
                            el.style.textAlign = 'justify';
                            el.style.fontSize = '16px';
                            el.style.lineHeight = '1.8';
                            el.style.color = 'rgba(255,255,255,0.95)';
                        }
                        if (el.tagName === 'IMG') {
                            el.style.maxWidth = '100%';
                            el.style.height = 'auto';
                            el.style.display = 'block';
                            el.style.margin = '20px auto';
                            el.style.borderRadius = '8px';
                            el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
                            
                            // Fix EPUB image paths
                            const src = el.src || el.getAttribute('src');
                            if (src && !src.startsWith('http') && !src.startsWith('/')) {
                                // Convert relative EPUB image paths to use our images endpoint
                                const filename = src.split('/').pop();
                                el.src = `/images/${filename}?epub=${encodeURIComponent(filePath)}`;
                                el.onerror = function() {
                                    this.style.display = 'none';
                                };
                            }
                        }
                        if (el.tagName === 'BLOCKQUOTE') {
                            el.style.borderLeft = '4px solid #4ecdc4';
                            el.style.paddingLeft = '20px';
                            el.style.marginLeft = '0';
                            el.style.fontStyle = 'italic';
                            el.style.color = 'rgba(255,255,255,0.9)';
                            el.style.background = 'rgba(78, 205, 196, 0.05)';
                            el.style.padding = '15px 20px';
                            el.style.borderRadius = '0 8px 8px 0';
                        }
                    });
                    
                    prevBtn.disabled = chapterIndex === 0;
                    nextBtn.disabled = chapterIndex === epubData.chapters.length - 1;
                    
                    prevBtn.style.opacity = prevBtn.disabled ? '0.5' : '1';
                    nextBtn.style.opacity = nextBtn.disabled ? '0.5' : '1';
                }
            };
            
            prevBtn.addEventListener('click', () => {
                if (currentChapter > 0) {
                    showChapter(currentChapter - 1);
                }
            });
            
            nextBtn.addEventListener('click', () => {
                if (currentChapter < epubData.chapters.length - 1) {
                    showChapter(currentChapter + 1);
                }
            });
            
            chapterSelect.addEventListener('change', (e) => {
                showChapter(parseInt(e.target.value));
            });
            
            // Show first chapter
            showChapter(0);
            
            contentOther.appendChild(epubContainer);
            contentOther.style.display = 'block';
            
        } catch (error) {
            console.error('EPUB render error:', error);
            contentOther.innerHTML = `
                <div style="color: red; padding: 20px; background: rgba(255,255,255,0.1); border-radius: 10px;">
                    <h3>Error loading EPUB file</h3>
                    <p>${error.message}</p>
                    <p style="margin-top: 15px; font-size: 0.9rem; opacity: 0.8;">
                        <a href="/files?path=${encodeURIComponent(filePath)}" 
                           download="${fileName}" 
                           style="color: #4ecdc4; text-decoration: none;">
                            Download file instead
                        </a>
                    </p>
                </div>
            `;
            contentOther.style.display = 'block';
        }
    }
}