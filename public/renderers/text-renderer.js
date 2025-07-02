class TextRenderer {
    constructor() {
        this.handleKeyDown = null;
        this.currentPage = 1;
        this.pages = [];
        this.linesPerPage = 50;
    }

    cleanup() {
        if (this.handleKeyDown) {
            document.removeEventListener('keydown', this.handleKeyDown);
            this.handleKeyDown = null;
        }
    }

    async render(filePath, fileName, contentCode, contentOther, options = {}) {
        this.cleanup();
        const extension = fileName.split('.').pop().toLowerCase();
        const response = await window.authManager.authenticatedFetch(`/files?path=${encodeURIComponent(filePath)}`);
        
        if (!response) {
            throw new Error('Authentication required');
        }
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const text = await response.text();

        if (extension === 'csv') {
            this.renderCSV(text, contentOther);
        } else if (extension === 'srt') {
            this.renderSRT(text, contentOther);
        } else {
            this.renderPaginatedText(text, contentOther, extension);
        }
    }

    renderPaginatedText(text, contentOther, extension) {
        const lines = text.split('\n');
        this.pages = [];
        for (let i = 0; i < lines.length; i += this.linesPerPage) {
            this.pages.push(lines.slice(i, i + this.linesPerPage).join('\n'));
        }
        this.currentPage = 1;

        const textContainer = document.createElement('div');
        textContainer.className = 'text-container';

        const controls = document.createElement('div');
        controls.className = 'text-controls';
        controls.style.cssText = `display: flex; align-items: center; margin-bottom: 10px;`;
        controls.innerHTML = `
            <button id="text-prev">Previous</button>
            <span id="text-page-info" style="margin: 0 10px;"></span>
            <button id="text-next">Next</button>
            <input type="number" id="text-page-jump" placeholder="Page" style="width: 60px; margin-left: 20px;">
            <button id="text-jump-btn" style="margin-left: 5px;">Go</button>
        `;

        const pageContent = document.createElement('pre');
        const codeContent = document.createElement('code');
        pageContent.appendChild(codeContent);

        textContainer.appendChild(controls);
        textContainer.appendChild(pageContent);
        contentOther.appendChild(textContainer);
        contentOther.style.display = 'block';

        const prevBtn = controls.querySelector('#text-prev');
        const nextBtn = controls.querySelector('#text-next');
        const pageInfo = controls.querySelector('#text-page-info');
        const jumpInput = controls.querySelector('#text-page-jump');
        const jumpBtn = controls.querySelector('#text-jump-btn');

        const showPage = (page) => {
            if (page < 1 || page > this.pages.length) {
                return;
            }
            this.currentPage = page;
            codeContent.textContent = this.pages[this.currentPage - 1];
            codeContent.className = `language-${extension}`;
            hljs.highlightElement(codeContent);
            pageInfo.textContent = `Page ${this.currentPage} of ${this.pages.length}`;
            prevBtn.disabled = this.currentPage === 1;
            nextBtn.disabled = this.currentPage === this.pages.length;
        };

        prevBtn.addEventListener('click', () => showPage(this.currentPage - 1));
        nextBtn.addEventListener('click', () => showPage(this.currentPage + 1));
        jumpBtn.addEventListener('click', () => {
            const page = parseInt(jumpInput.value, 10);
            if (!isNaN(page)) {
                showPage(page);
            }
        });

        this.handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT') return;
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                prevBtn.click();
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                nextBtn.click();
            }
        };
        document.addEventListener('keydown', this.handleKeyDown);

        showPage(1);
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