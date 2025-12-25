const path = require('path');
const fs = require('fs').promises;
const https = require('https');
const http = require('http');
const pdfParse = require('pdf-parse');
// Use the same dotenv config as server.js
require('dotenv').config();

class AIFileAnalyzer {
    constructor() {
        // Determine AI provider: 'lmstudio' or 'openrouter'
        // LM Studio is preferred if configured, falls back to OpenRouter
        this.provider = process.env.AI_PROVIDER || 
            (process.env.LMSTUDIO_URL ? 'lmstudio' : 
             process.env.OPENROUTER_API_KEY ? 'openrouter' : 'none');
        
        // LM Studio configuration
        this.lmstudioUrl = process.env.LMSTUDIO_URL || 'http://10.5.0.2:1234';
        this.lmstudioModel = process.env.LMSTUDIO_MODEL || 'llama-3.1-deephermes-r1-reasoning-8b-darkidol-instruct-1.2-uncensored';
        
        // OpenRouter configuration
        this.openrouterApiKey = process.env.OPENROUTER_API_KEY ? process.env.OPENROUTER_API_KEY.trim() : null;
        this.openrouterModel = process.env.OPENROUTER_DEFAULT_MODEL || 'openai/gpt-4o-mini';
        
        // Debug logging for environment variables
        console.log('AI Provider:', this.provider);
        if (this.provider === 'lmstudio') {
            console.log('LM Studio URL:', this.lmstudioUrl);
            console.log('LM Studio Model:', this.lmstudioModel);
        } else if (this.provider === 'openrouter') {
            console.log('OPENROUTER_API_KEY loaded:', !!this.openrouterApiKey);
            console.log('OPENROUTER_DEFAULT_MODEL:', this.openrouterModel);
        }
    }

    /**
     * Get AI configuration based on provider
     */
    getAIConfig() {
        if (this.provider === 'lmstudio') {
            const url = new URL(this.lmstudioUrl);
            return {
                provider: 'lmstudio',
                hostname: url.hostname,
                port: parseInt(url.port) || 1234,
                path: '/v1/chat/completions',
                protocol: url.protocol === 'https:' ? https : http,
                model: this.lmstudioModel,
                headers: {
                    'Content-Type': 'application/json'
                }
            };
        } else if (this.provider === 'openrouter' && this.openrouterApiKey) {
            return {
                provider: 'openrouter',
                hostname: 'openrouter.ai',
                port: 443,
                path: '/api/v1/chat/completions',
                protocol: https,
                model: this.openrouterModel,
                headers: {
                    'Authorization': `Bearer ${this.openrouterApiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': process.env.OPENROUTER_APP_URL || 'http://localhost:7863',
                    'X-Title': process.env.OPENROUTER_APP_TITLE || 'File Browser AI'
                }
            };
        }
        return null;
    }

    /**
     * Make an AI API request (works with both LM Studio and OpenRouter)
     */
    makeAIRequest(messages, options = {}) {
        return new Promise((resolve, reject) => {
            const config = this.getAIConfig();
            
            if (!config) {
                resolve({
                    success: false,
                    error: 'No AI provider configured',
                    content: null
                });
                return;
            }

            const requestBody = {
                model: config.model,
                messages: messages,
                temperature: options.temperature || 0.7,
                ...(options.max_tokens && { max_tokens: options.max_tokens }),
                // Only include response_format for OpenRouter, not LM Studio
                ...(options.response_format && config.provider === 'openrouter' && { response_format: options.response_format })
            };

            const postData = JSON.stringify(requestBody);
            const headers = {
                ...config.headers,
                'Content-Length': Buffer.byteLength(postData)
            };

            const requestOptions = {
                hostname: config.hostname,
                port: config.port,
                path: config.path,
                method: 'POST',
                headers: headers
            };

            console.log(`Making AI request to ${config.provider}:`, {
                hostname: requestOptions.hostname,
                port: requestOptions.port,
                path: requestOptions.path,
                model: config.model
            });

            const startTime = Date.now();
            
            const req = config.protocol.request(requestOptions, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    const elapsed = (Date.now() - startTime) / 1000;
                    console.log(`AI response received from ${config.provider} in ${elapsed.toFixed(2)}s`);
                    console.log(`AI response data (first 500 chars):`, data.substring(0, 500));
                    try {
                        const result = JSON.parse(data);
                        
                        if (result.error) {
                            console.error('AI API returned error:', result.error);
                            resolve({
                                success: false,
                                error: `${config.provider} API Error: ${result.error.message || JSON.stringify(result.error)}`,
                                content: null
                            });
                            return;
                        }
                        
                        if (!result.choices || !result.choices[0]) {
                            resolve({
                                success: false,
                                error: `Invalid API response structure`,
                                content: null
                            });
                            return;
                        }
                        
                        const content = result.choices[0].message.content;
                        
                        resolve({
                            success: true,
                            content: content,
                            stats: {
                                model: config.model,
                                provider: config.provider,
                                total_time: (Date.now() - startTime) / 1000,
                                input_tokens: result.usage?.prompt_tokens || 0,
                                output_tokens: result.usage?.completion_tokens || 0,
                                cached: result.choices[0]?.finish_reason === 'cached'
                            }
                        });
                    } catch (error) {
                        resolve({
                            success: false,
                            error: `Failed to parse API response: ${error.message}`,
                            content: null
                        });
                    }
                });
            });
            
            req.on('error', (error) => {
                console.error('AI request error:', error);
                resolve({
                    success: false,
                    error: error.message,
                    content: null
                });
            });
            
            req.write(postData);
            req.end();
        });
    }

    /**
     * Collect file names from a directory (non-recursive)
     */
    async collectFileNames(directoryPath) {
        const files = [];

        try {
            const entries = await fs.readdir(directoryPath, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(directoryPath, entry.name);
                const relativePath = path.relative(directoryPath, fullPath);
                
                // Skip hidden files, node_modules, .git, etc.
                if (entry.name.startsWith('.') || 
                    entry.name === 'node_modules' || 
                    entry.name === '__pycache__' ||
                    entry.name === 'dist' ||
                    entry.name === 'build') {
                    continue;
                }

                if (entry.isDirectory()) {
                    // Add directory name
                    files.push({
                        name: entry.name,
                        type: 'directory',
                        path: relativePath,
                        fullPath: fullPath
                    });
                } else {
                    // Add file with extension info
                    const ext = path.extname(entry.name).toLowerCase();
                    const stats = await fs.stat(fullPath);
                    
                    files.push({
                        name: entry.name,
                        type: 'file',
                        extension: ext,
                        path: relativePath,
                        fullPath: fullPath,
                        size: stats.size,
                        modified: stats.mtime.toISOString()
                    });
                }
            }
        } catch (error) {
            console.error(`Error reading directory ${directoryPath}:`, error);
        }

        return files;
    }

    /**
     * Filter files to focus on potentially interesting content
     */
    filterInterestingFiles(files) {
        const interestingExtensions = [
            '.pdf', '.txt', '.md', '.doc', '.docx', 
            '.epub', '.py', '.js', '.html', '.json',
            '.csv', '.xlsx', '.pptx', '.rtf',
            // Audio formats
            '.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.wma',
            // Video formats  
            '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm',
            // Image formats
            '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp', '.svg',
            // Archive formats
            '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2',
            // Other interesting formats
            '.cbz', '.cbr', '.mobi', '.azw', '.azw3'
        ];

        const interestingKeywords = [
            'readme', 'doc', 'guide', 'manual', 'tutorial', 
            'book', 'story', 'novel', 'article', 'paper',
            'research', 'report', 'analysis', 'notes',
            'journal', 'diary', 'log', 'spec', 'design',
            // Media-related keywords
            'album', 'music', 'song', 'track', 'playlist', 'concert', 'live',
            'video', 'movie', 'film', 'documentary', 'series', 'episode',
            'photo', 'picture', 'image', 'gallery', 'collection'
        ];

        return files.filter(file => {
            if (file.type === 'directory') {
                // Include interesting directory names
                const dirName = file.name.toLowerCase();
                return interestingKeywords.some(keyword => dirName.includes(keyword)) ||
                       ['docs', 'documentation', 'books', 'papers', 'articles'].includes(dirName);
            }
            
            // Get filename without extension for analysis
            const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
            
            // Exclude files that are just numbers or very generic patterns
            if (this.isGenericFile(nameWithoutExt)) {
                return false;
            }
            
            // Include files with interesting extensions
            if (interestingExtensions.includes(file.extension)) {
                return true;
            }
            
            // Include files with interesting names (even without extension)
            const fileName = file.name.toLowerCase();
            return interestingKeywords.some(keyword => fileName.includes(keyword));
        });
    }

    /**
     * Check if a filename is too generic to be interesting
     */
    isGenericFile(nameWithoutExt) {
        // Exclude files that are just numbers
        if (/^\d+$/.test(nameWithoutExt)) {
            return true;
        }
        
        // Exclude files that are mostly numbers with minimal text
        if (/^\d{5,}/.test(nameWithoutExt)) {
            return true;
        }
        
        // Exclude very generic patterns like "track01", "song1", etc.
        if (/^(track|song|audio|video|file|untitled|new|copy|document)\d*$/i.test(nameWithoutExt)) {
            return true;
        }
        
        // Exclude single character or very short generic names
        if (nameWithoutExt.length <= 2) {
            return true;
        }
        
        return false;
    }

    /**
     * Call the LLM to analyze files and suggest what's interesting
     */
    async analyzeFilesWithLLM(files, userContext = '') {
        // Limit the number of files to prevent request size issues
        const maxFiles = 100;
        const limitedFiles = files.slice(0, maxFiles);
        
        // Prepare the file data for analysis
        const fileData = limitedFiles.map(file => ({
            name: file.name,
            type: file.type,
            path: file.path,
            extension: file.extension || '',
            size: file.size || 0
        }));

        // Create the prompt for the LLM
        const prompt = `You are an AI assistant helping a user discover interesting files to read from their file browser. 

User request: ${userContext || 'General browsing'}

Here are the files and directories available in the current directory:
${JSON.stringify(fileData, null, 2)}

IMPORTANT INSTRUCTIONS:
- Pay close attention to the user's specific request above
- If they ask for specific authors (like "Heinlein"), look carefully at filenames for those author names
- If they ask for "shortest files", consider file sizes
- If they ask for specific genres or topics, prioritize those matches
- Look for patterns in filenames that match the user's request

Based on the file names, extensions, paths, and sizes, suggest the 5-8 most relevant files that match the user's request. Consider:
1. Educational content (PDFs, books, documentation)
2. Fiction and literature (novels, stories, authors)
3. Technical content (guides, manuals, code)
4. Media content (music, videos, images)
5. Research and academic content
6. Personal documents and notes

For each suggestion, provide:
- The file path
- A brief reason why it matches the user's request
- What type of content it likely contains
- An engagement score (1-10) for how well it matches the request

Respond in JSON format:
{
  "suggestions": [
    {
      "path": "relative/path/to/file",
      "name": "filename.ext", 
      "reason": "Why this matches the user's request",
      "content_type": "Type of content (e.g., 'Science Fiction Novel', 'Technical Guide', 'Music Album')",
      "engagement_score": 8
    }
  ],
  "summary": "Brief overview of what was found that matches the user's request"
}`;

        // Check if AI is configured
        const config = this.getAIConfig();
        if (!config) {
            // Fallback response when no AI provider is available
            const fallbackResponse = {
                suggestions: [
                    {
                        path: "sample.pdf",
                        name: "Sample Document.pdf",
                        reason: "This is a sample suggestion. Configure AI_PROVIDER and LMSTUDIO_URL (or OPENROUTER_API_KEY) in .env to get real AI-powered suggestions.",
                        content_type: "Sample PDF Document",
                        engagement_score: 7
                    },
                    {
                        path: "README.md",
                        name: "README.md",
                        reason: "Documentation files often contain important information about the project.",
                        content_type: "Documentation",
                        engagement_score: 6
                    }
                ],
                summary: "Sample AI analysis. Configure an AI provider to get real suggestions."
            };
            
            return {
                analysis: fallbackResponse,
                stats: { model: "none", provider: "none", total_time: 0, input_tokens: 0, output_tokens: 0, cached: false },
                rawResponse: JSON.stringify(fallbackResponse)
            };
        }

        // Make the AI request
        const messages = [
            {
                role: "system", 
                content: "You are an AI analyzing file collections to suggest interesting reading material. You must respond with valid JSON according to the provided schema."
            },
            {
                role: "user",
                content: prompt
            }
        ];

        const result = await this.makeAIRequest(messages, {
            temperature: 0.7,
            response_format: { type: "json_object" }
        });

        if (!result.success) {
            // Return error as a valid response structure
            const errorResponse = {
                suggestions: [
                    {
                        path: "error.txt",
                        name: "Analysis Error.txt",
                        reason: `Failed to analyze files: ${result.error}`,
                        content_type: "Error Report",
                        engagement_score: 5
                    }
                ],
                summary: `Error during AI analysis: ${result.error}`
            };
            
            return {
                analysis: errorResponse,
                stats: { 
                    model: config.model, 
                    provider: config.provider,
                    total_time: 0, 
                    input_tokens: 0, 
                    output_tokens: 0, 
                    cached: false, 
                    error: result.error 
                },
                rawResponse: JSON.stringify(errorResponse)
            };
        }

        // Try to parse the LLM response as JSON
        let analysis;
        try {
            analysis = typeof result.content === 'string' ? JSON.parse(result.content) : result.content;
        } catch (parseError) {
            // If the LLM didn't return valid JSON, create a fallback response
            analysis = {
                suggestions: [{
                    path: limitedFiles[0]?.path || 'unknown',
                    name: limitedFiles[0]?.name || 'unknown',
                    reason: 'LLM response was not in valid JSON format',
                    content_type: 'Unknown',
                    engagement_score: 5
                }],
                summary: `Analysis completed but response format was unexpected. Raw response: ${typeof result.content === 'string' ? result.content.substring(0, 200) : JSON.stringify(result.content).substring(0, 200)}...`
            };
        }
        
        return {
            analysis,
            stats: result.stats,
            rawResponse: result.content
        };
    }

    /**
     * Extract text from PDF file
     */
    async extractPdfText(filePath) {
        try {
            // Import config to get baseDir
            const config = require('./config');
            const fullPath = path.resolve(config.baseDir, filePath);
            
            const dataBuffer = await fs.readFile(fullPath);
            const data = await pdfParse(dataBuffer);
            return data.text;
        } catch (error) {
            throw new Error(`Failed to extract PDF text: ${error.message}`);
        }
    }

    /**
     * Summarize file content using AI
     */
    async summarizeFileContent(filePath = null, content = null, fullPdf = false) {
        // Check if AI is configured
        const config = this.getAIConfig();
        if (!config) {
            return {
                summary: "AI summary is not available. Please configure AI_PROVIDER and LMSTUDIO_URL (or OPENROUTER_API_KEY) in the .env file to enable AI-powered summaries.",
                stats: { model: "none", provider: "none", total_time: 0, input_tokens: 0, output_tokens: 0, cached: false }
            };
        }

        if (!content && !filePath) {
            throw new Error('Either file path or content must be provided');
        }

        // Handle full PDF extraction if requested
        let finalContent = content;
        if (fullPdf && filePath && path.extname(filePath).toLowerCase() === '.pdf') {
            try {
                finalContent = await this.extractPdfText(filePath);
            } catch (error) {
                return {
                    summary: `Failed to extract full PDF text: ${error.message}`,
                    stats: { model: "none", provider: "none", total_time: 0, input_tokens: 0, output_tokens: 0, cached: false, error: error.message }
                };
            }
        }

        // Create the prompt for summarization
        const prompt = `You are an AI assistant that creates concise, useful summaries of documents and files.

${finalContent ? `Please summarize the following content:

${finalContent.substring(0, 12000)}` : `Please summarize the file at path: ${filePath}

Note: The content should be extracted from the file first.`}

INSTRUCTIONS:
- Create a clear, concise summary in 2-4 paragraphs
- Identify the main topic, key points, and important details
- If it's code, explain what the code does and its purpose
- If it's a document, summarize the main arguments or information
- If it's data, describe what kind of data and its structure
- Keep the summary informative but brief
- Use bullet points for key takeaways if helpful

Respond with just the summary text, no additional formatting.`;

        const messages = [
            {
                role: "system", 
                content: "You are an AI that creates helpful, concise summaries of files and documents. Always provide clear, accurate summaries that capture the essential information."
            },
            {
                role: "user",
                content: prompt
            }
        ];

        const result = await this.makeAIRequest(messages, {
            max_tokens: 500,
            temperature: 0.3
        });

        if (!result.success) {
            return {
                summary: `Error during AI summarization: ${result.error}`,
                stats: { 
                    model: config.model, 
                    provider: config.provider,
                    total_time: 0, 
                    input_tokens: 0, 
                    output_tokens: 0, 
                    cached: false, 
                    error: result.error 
                }
            };
        }

        return {
            summary: result.content,
            stats: result.stats
        };
    }

    /**
     * Main method to analyze a directory and get AI suggestions
     */
    async analyzeDirectory(directoryPath, userContext = '') {
        try {
            console.log(`Analyzing directory: ${directoryPath}`);
            
            // Collect all files
            const allFiles = await this.collectFileNames(directoryPath);
            console.log(`Found ${allFiles.length} total files/directories`);
            console.log('Sample files found:', allFiles.map(f => `${f.name} (${f.extension || 'no-ext'})`).slice(0, 5));
            
            // Filter to interesting files
            const interestingFiles = this.filterInterestingFiles(allFiles);
            console.log(`Filtered to ${interestingFiles.length} potentially interesting files`);
            console.log('Interesting files found:', interestingFiles.map(f => f.name).slice(0, 10));
            console.log('Sample extensions found:', [...new Set(allFiles.map(f => f.extension).filter(Boolean))].slice(0, 10));
            
            if (interestingFiles.length === 0) {
                return {
                    suggestions: [],
                    summary: 'No particularly interesting files found in this directory.',
                    stats: null
                };
            }

            // Get LLM analysis
            const result = await this.analyzeFilesWithLLM(interestingFiles, userContext);
            
            // Sort suggestions by engagement score (highest first)
            const sortedSuggestions = (result.analysis.suggestions || []).sort((a, b) => {
                return (b.engagement_score || 0) - (a.engagement_score || 0);
            });

            return {
                suggestions: sortedSuggestions,
                summary: result.analysis.summary || 'Analysis completed',
                stats: result.stats,
                totalFiles: allFiles.length,
                filteredFiles: interestingFiles.length
            };
            
        } catch (error) {
            console.error('Error in analyzeDirectory:', error);
            throw error;
        }
    }
}

module.exports = AIFileAnalyzer;