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
                statusElement.innerHTML = '⏳ Loading page...';
                pageImg.style.opacity = '0.5';
                const response = await window.authManager.authenticatedFetch(`/comic-preview?path=${encodeURIComponent(filePath)}&page=${page}`);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const blob = await response.blob();
                pageImg.src = URL.createObjectURL(blob);
                pageImg.style.opacity = '1';
                document.getElementById('comic-page-info').textContent = `Page ${page}`;
                statusElement.textContent = '';
            } catch (error) {
                console.error('Comic load error:', error);
                pageImg.style.opacity = '1';
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

class DocxRenderer {
    constructor() {
        this.handleKeyDown = null;
        this.currentPage = 1;
        this.totalPages = 0;
        this.pageHeight = 0;
    }

    cleanup() {
        if (this.handleKeyDown) {
            document.removeEventListener('keydown', this.handleKeyDown);
            this.handleKeyDown = null;
        }
    }

    async render(filePath, fileName, contentCode, contentOther) {
        this.cleanup();
        try {
            const response = await window.authManager.authenticatedFetch(`/files?path=${encodeURIComponent(filePath)}`);
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
                height: 70vh;
                overflow-y: auto;
            `;
            
            const docxContent = document.createElement('div');
            docxContent.innerHTML = result.value;
            docxContainer.appendChild(docxContent);

            const controls = document.createElement('div');
            controls.className = 'docx-controls';
            controls.style.cssText = `display: flex; align-items: center; margin-top: 10px;`;
            controls.innerHTML = `
                <button id="docx-prev">Previous</button>
                <span id="docx-page-info" style="margin: 0 10px;"></span>
                <button id="docx-next">Next</button>
                <input type="number" id="docx-page-jump" placeholder="Page" style="width: 60px; margin-left: 20px;">
                <button id="docx-jump-btn" style="margin-left: 5px;">Go</button>
            `;
            
            contentOther.appendChild(controls);
            contentOther.appendChild(docxContainer);
            contentOther.style.display = 'block';

            // Pagination logic
            setTimeout(() => {
                this.pageHeight = docxContainer.clientHeight;
                const contentHeight = docxContent.scrollHeight;
                this.totalPages = Math.ceil(contentHeight / this.pageHeight);
                this.currentPage = 1;

                const prevBtn = controls.querySelector('#docx-prev');
                const nextBtn = controls.querySelector('#docx-next');
                const pageInfo = controls.querySelector('#docx-page-info');
                const jumpInput = controls.querySelector('#docx-page-jump');
                const jumpBtn = controls.querySelector('#docx-jump-btn');

                const showPage = (page) => {
                    if (page < 1 || page > this.totalPages) return;
                    this.currentPage = page;
                    docxContainer.scrollTop = (this.currentPage - 1) * this.pageHeight;
                    pageInfo.textContent = `Page ${this.currentPage} of ${this.totalPages}`;
                    prevBtn.disabled = this.currentPage === 1;
                    nextBtn.disabled = this.currentPage === this.totalPages;
                };

                prevBtn.addEventListener('click', () => showPage(this.currentPage - 1));
                nextBtn.addEventListener('click', () => showPage(this.currentPage + 1));
                jumpBtn.addEventListener('click', () => {
                    const page = parseInt(jumpInput.value, 10);
                    if (!isNaN(page)) showPage(page);
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
            }, 100);

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
            const response = await window.authManager.authenticatedFetch(`/files?path=${encodeURIComponent(filePath)}`);
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