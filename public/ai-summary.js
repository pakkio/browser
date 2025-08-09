// AI Summary functionality
class AISummaryManager {
    constructor() {
        this.currentFilePath = null;
        this.currentFileContent = null;
        this.isGenerating = false;
        this.initializeUI();
        console.log('🤖 AI Summary Manager initialized');
    }

    initializeUI() {
        this.summaryBtn = document.getElementById('generate-summary-btn');
        this.summaryContent = document.getElementById('summary-content');
        this.summaryStats = document.getElementById('summary-stats');
        this.pdfOptions = document.getElementById('pdf-summary-options');
        
        console.log('🤖 Summary UI elements:', {
            summaryBtn: !!this.summaryBtn,
            summaryContent: !!this.summaryContent,
            summaryStats: !!this.summaryStats,
            pdfOptions: !!this.pdfOptions
        });
        
        if (this.summaryBtn) {
            this.summaryBtn.addEventListener('click', () => {
                const useFullPdf = this.shouldUseFullPdf();
                this.generateSummary(useFullPdf);
            });
            console.log('🤖 Summary button click listener added');
        } else {
            console.error('🤖 Generate summary button not found!');
        }

        // Listen for file selection changes
        document.addEventListener('fileSelected', (event) => {
            this.onFileSelected(event.detail);
        });

        // Listen for tab changes
        document.addEventListener('click', (event) => {
            if (event.target.matches('[data-tab="summary"]')) {
                this.onSummaryTabSelected();
            }
        });
    }

    onFileSelected(fileData) {
        console.log('🤖 File selected for summary:', fileData);
        this.currentFilePath = fileData.path;
        this.currentFileContent = fileData.content;
        
        // Show/hide PDF options based on file type
        const isPdf = fileData.name?.toLowerCase().endsWith('.pdf');
        if (this.pdfOptions) {
            this.pdfOptions.style.display = isPdf ? 'flex' : 'none';
        }
        
        // Enable/disable the summary button based on file type
        if (this.summaryBtn) {
            const canSummarize = this.canSummarizeFile(fileData);
            console.log('🤖 Can summarize file:', canSummarize, 'File:', fileData.name);
            this.summaryBtn.disabled = !canSummarize;
            
            if (canSummarize) {
                this.updateSummaryPlaceholder(`Ready to summarize: ${fileData.name}`);
            } else {
                this.updateSummaryPlaceholder('This file type cannot be summarized.');
            }
        } else {
            console.warn('🤖 Summary button not found');
        }

        // Clear previous summary when selecting a new file
        this.clearSummary();
    }

    shouldUseFullPdf() {
        const fullPdfRadio = document.querySelector('input[name="pdf-summary-type"][value="full"]');
        return fullPdfRadio && fullPdfRadio.checked;
    }

    onSummaryTabSelected() {
        // Auto-focus on summary generation when tab is selected
        if (!this.currentFilePath) {
            this.updateSummaryPlaceholder('Select a file to generate an AI summary of its content.');
        }
    }

    canSummarizeFile(fileData) {
        if (!fileData || !fileData.name) return false;

        const extension = fileData.name.split('.').pop()?.toLowerCase();
        const summarizableTypes = [
            'txt', 'md', 'readme', 'log', 'json', 'xml', 'csv',
            'js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 
            'php', 'rb', 'go', 'rs', 'swift', 'kt', 'dart',
            'html', 'css', 'scss', 'less', 'sql', 'sh', 'bat',
            'yml', 'yaml', 'toml', 'ini', 'conf', 'cfg', 'rtf',
            'pdf' // Add PDF support
        ];

        // Exclude binary types that definitely can't be summarized
        const excludedTypes = [
            'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp', 'svg', 'ico',
            'mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v',
            'mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a',
            'zip', 'rar', '7z', 'tar', 'gz', 'bz2',
            'exe', 'dll', 'so', 'dmg', 'pkg', 'deb', 'rpm'
        ];

        // If it's an excluded binary type, can't summarize
        if (excludedTypes.includes(extension)) {
            return false;
        }

        // Can summarize if we have content, it's a known text type, or it's unknown (probably text)
        return (fileData.content && fileData.content.trim().length > 0) || 
               summarizableTypes.includes(extension) ||
               !extension; // Files without extensions are often text
    }

    async generateSummary(useFullPdf = false) {
        if (this.isGenerating || !this.currentFilePath) return;

        this.isGenerating = true;
        this.showLoadingState();

        try {
            // Extract content if we don't have it already
            let content = this.currentFileContent;
            if (!content && !useFullPdf) {
                content = await this.extractFileContent();
            }

            const response = await window.authManager.authenticatedFetch('/api/summarize-file', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    path: this.currentFilePath,
                    content: useFullPdf ? null : content,
                    fullPdf: useFullPdf
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.message || 'Summary generation failed');
            }

            this.displaySummary(data.summary, data.stats);
            
        } catch (error) {
            console.error('Error generating summary:', error);
            this.showError(error.message);
        } finally {
            this.isGenerating = false;
            this.hideLoadingState();
        }
    }

    async extractFileContent() {
        // Try to get content from the current renderer
        const contentCode = document.getElementById('content-code');
        const contentOther = document.getElementById('content-other');
        
        if (contentCode && contentCode.textContent && contentCode.textContent.trim()) {
            return contentCode.textContent;
        }
        
        // For PDF files, try to extract text from the entire document using PDF.js API
        if (this.currentFilePath?.endsWith('.pdf') && window.pdfRenderer?.pdfDoc) {
            console.log('🤖 Extracting full PDF content using PDF.js API...');
            const fullPdfText = await this.extractFullPdfText(window.pdfRenderer.pdfDoc);
            if (fullPdfText && fullPdfText.trim()) {
                return fullPdfText;
            }
        }
        
        if (contentOther) {
            // For PDF files, try to extract text from PDF.js text layers
            const textLayers = contentOther.querySelectorAll('.textLayer');
            if (textLayers.length > 0) {
                let pdfText = '';
                textLayers.forEach((layer, index) => {
                    const text = layer.innerText || layer.textContent;
                    if (text && text.trim()) {
                        pdfText += `Page ${index + 1}:\n${text}\n\n`;
                    }
                });
                
                // If we only have one page and it's a PDF, try to load more pages for better summary
                if (textLayers.length === 1 && this.currentFilePath?.endsWith('.pdf')) {
                    console.log('🤖 Only one PDF page loaded, attempting to load more pages...');
                    await this.loadMorePDFPages();
                    
                    // Re-extract after loading more pages
                    const updatedTextLayers = contentOther.querySelectorAll('.textLayer');
                    if (updatedTextLayers.length > textLayers.length) {
                        pdfText = '';
                        updatedTextLayers.forEach((layer, index) => {
                            const text = layer.innerText || layer.textContent;
                            if (text && text.trim()) {
                                pdfText += `Page ${index + 1}:\n${text}\n\n`;
                            }
                        });
                        console.log(`🤖 Enhanced PDF extraction: ${updatedTextLayers.length} pages loaded`);
                    }
                }
                
                if (pdfText.trim()) {
                    console.log('🤖 Using fallback PDF text extraction from visible pages');
                    return pdfText;
                }
            }
            
            // Try to extract text from other rendered content
            const textContent = contentOther.innerText || contentOther.textContent;
            if (textContent && textContent.trim()) {
                return textContent;
            }
        }

        // If no content is available, return null so the API can handle file reading
        return null;
    }

    async loadMorePDFPages() {
        try {
            // Try to trigger loading of next few pages by simulating navigation
            const nextBtn = document.querySelector('#pdf-next');
            
            if (nextBtn && !nextBtn.disabled) {
                console.log('🤖 Loading next PDF pages for better summary...');
                
                // Load next 3-4 pages to get more content for summary
                for (let i = 0; i < 3; i++) {
                    if (nextBtn && !nextBtn.disabled) {
                        nextBtn.click();
                        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for page to load
                    } else {
                        break;
                    }
                }
                
                // Go back to first page
                const firstBtn = document.querySelector('#pdf-first');
                if (firstBtn) {
                    firstBtn.click();
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        } catch (error) {
            console.warn('🤖 Could not load additional PDF pages:', error);
        }
    }

    async extractFullPdfText(pdfDoc) {
        try {
            const numPages = pdfDoc.numPages;
            console.log(`🤖 Extracting text from ${numPages} PDF pages...`);
            
            let fullText = '';
            const maxPages = Math.min(numPages, 10); // Limit to first 10 pages to avoid token limits
            
            for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
                try {
                    const page = await pdfDoc.getPage(pageNum);
                    const textContent = await page.getTextContent();
                    
                    let pageText = '';
                    textContent.items.forEach((item) => {
                        if (item.str) {
                            pageText += item.str + ' ';
                        }
                    });
                    
                    if (pageText.trim()) {
                        fullText += `Page ${pageNum}:\n${pageText.trim()}\n\n`;
                    }
                } catch (pageError) {
                    console.warn(`🤖 Error extracting text from page ${pageNum}:`, pageError);
                }
            }
            
            if (maxPages < numPages) {
                fullText += `\n[Note: This is a ${numPages}-page document. Only the first ${maxPages} pages were processed for summarization.]\n`;
            }
            
            console.log(`🤖 Successfully extracted text from ${maxPages} pages (${fullText.length} characters)`);
            return fullText;
            
        } catch (error) {
            console.error('🤖 Error extracting full PDF text:', error);
            return null;
        }
    }

    showLoadingState() {
        if (this.summaryBtn) {
            const btnText = this.summaryBtn.querySelector('.summary-btn-text');
            const spinner = this.summaryBtn.querySelector('.summary-spinner');
            
            if (btnText) btnText.style.display = 'none';
            if (spinner) spinner.style.display = 'inline';
            
            this.summaryBtn.disabled = true;
        }

        this.summaryContent.innerHTML = `
            <div class="summary-loading">
                <div style="text-align: center; padding: 30px;">
                    <div style="font-size: 24px; margin-bottom: 15px;">🤖</div>
                    <div>Generating AI summary...</div>
                    <div style="font-size: 0.7rem; color: #888; margin-top: 8px;">
                        This may take a moment
                    </div>
                </div>
            </div>
        `;
    }

    hideLoadingState() {
        if (this.summaryBtn) {
            const btnText = this.summaryBtn.querySelector('.summary-btn-text');
            const spinner = this.summaryBtn.querySelector('.summary-spinner');
            
            if (btnText) btnText.style.display = 'inline';
            if (spinner) spinner.style.display = 'none';
            
            this.summaryBtn.disabled = !this.canSummarizeFile({
                name: this.currentFilePath?.split('/').pop() || '',
                content: this.currentFileContent
            });
        }
    }

    displaySummary(summary, stats) {
        this.summaryContent.innerHTML = `
            <div class="summary-text">${this.formatSummaryText(summary)}</div>
        `;

        if (stats && this.summaryStats) {
            this.summaryStats.innerHTML = `
                <div class="summary-stat">
                    <span class="summary-stat-value">${stats.model || 'N/A'}</span>
                    <span>Model</span>
                </div>
                <div class="summary-stat">
                    <span class="summary-stat-value">${Math.round(stats.total_time || 0)}s</span>
                    <span>Time</span>
                </div>
                <div class="summary-stat">
                    <span class="summary-stat-value">${stats.input_tokens || 0}</span>
                    <span>Input Tokens</span>
                </div>
                <div class="summary-stat">
                    <span class="summary-stat-value">${stats.output_tokens || 0}</span>
                    <span>Output Tokens</span>
                </div>
            `;
            this.summaryStats.style.display = 'block';
        }
    }

    formatSummaryText(summary) {
        // Basic formatting for the summary text
        return summary
            .replace(/\n\n/g, '</p><p>')
            .replace(/^\s*/, '<p>')
            .replace(/\s*$/, '</p>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>');
    }

    showError(message) {
        this.summaryContent.innerHTML = `
            <div class="summary-error">
                <div style="font-weight: 600; margin-bottom: 8px;">⚠️ Summary Generation Failed</div>
                <div>${message}</div>
                <button onclick="window.aiSummary.generateSummary()" 
                        style="margin-top: 10px; padding: 6px 12px; background: #4ecdc4; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.75rem;">
                    Try Again
                </button>
            </div>
        `;
        
        if (this.summaryStats) {
            this.summaryStats.style.display = 'none';
        }
    }

    updateSummaryPlaceholder(message) {
        if (this.summaryContent) {
            this.summaryContent.innerHTML = `
                <div class="summary-placeholder">
                    ${message}
                </div>
            `;
        }
        
        if (this.summaryStats) {
            this.summaryStats.style.display = 'none';
        }
    }

    clearSummary() {
        if (this.summaryStats) {
            this.summaryStats.style.display = 'none';
        }
    }
}

// Initialize the AI Summary Manager when the page loads
function initializeAISummary() {
    console.log('🤖 Initializing AI Summary Manager...');
    try {
        window.aiSummary = new AISummaryManager();
        console.log('✅ AI Summary Manager initialized successfully');
        return true;
    } catch (error) {
        console.error('❌ Failed to initialize AI Summary Manager:', error);
        return false;
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAISummary);
} else {
    initializeAISummary();
}

// Also try initializing after a delay in case DOM isn't fully ready
setTimeout(() => {
    if (!window.aiSummary) {
        console.log('🤖 Retrying AI Summary Manager initialization...');
        initializeAISummary();
    } else if (window.aiSummary && !window.aiSummary.summaryBtn) {
        console.log('🤖 Re-initializing UI elements...');
        window.aiSummary.initializeUI();
    }
}, 2000);