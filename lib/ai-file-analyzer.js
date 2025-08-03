const path = require('path');
const fs = require('fs').promises;
const https = require('https');
// Use the same dotenv config as server.js
require('dotenv').config();

class AIFileAnalyzer {
    constructor() {
        // Debug logging for environment variables
        console.log('OPENROUTER_API_KEY loaded:', !!process.env.OPENROUTER_API_KEY);
        console.log('OPENROUTER_DEFAULT_MODEL:', process.env.OPENROUTER_DEFAULT_MODEL || 'not set');
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
        
        return new Promise((resolve, reject) => {
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

            // Get API key and model from environment
            const apiKey = process.env.OPENROUTER_API_KEY ? process.env.OPENROUTER_API_KEY.trim() : null;
            const model = process.env.OPENROUTER_DEFAULT_MODEL || 'openai/gpt-4o-mini';
            
            console.log('Debug - API Key exists:', !!apiKey);
            console.log('Debug - API Key length:', apiKey ? apiKey.length : 0);
            console.log('Debug - API Key starts with:', apiKey ? apiKey.substring(0, 15) + '...' : 'null');
            console.log('Debug - Full API Key:', apiKey);
            console.log('Debug - API Key trimmed:', apiKey ? apiKey.trim() : 'null');
            
            // Check if API key is available
            if (!apiKey) {
                // Fallback response when no API key is available
                const fallbackResponse = {
                    suggestions: [
                        {
                            path: "sample.pdf",
                            name: "Sample Document.pdf",
                            reason: "This is a sample suggestion. Configure your OPENROUTER_API_KEY in .env to get real AI-powered suggestions.",
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
                    summary: "Sample AI analysis. Add your OpenRouter API key to get real suggestions."
                };
                
                resolve({
                    analysis: fallbackResponse,
                    stats: { model: "none", total_time: 0, input_tokens: 0, output_tokens: 0, cached: false },
                    rawResponse: JSON.stringify(fallbackResponse)
                });
                return;
            }

            // Define JSON schema for structured output
            const responseSchema = {
                type: "object",
                properties: {
                    suggestions: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                path: { type: "string" },
                                name: { type: "string" },
                                reason: { type: "string" },
                                content_type: { type: "string" },
                                engagement_score: { type: "number", minimum: 1, maximum: 10 }
                            },
                            required: ["path", "name", "reason", "content_type", "engagement_score"]
                        }
                    },
                    summary: { type: "string" }
                },
                required: ["suggestions", "summary"]
            };

            // Prepare the API request with structured output for compatible models
            const requestBody = {
                model: model,
                messages: [
                    {
                        role: "system", 
                        content: "You are an AI analyzing file collections to suggest interesting reading material. You must respond with valid JSON according to the provided schema."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ]
            };

            // Add structured output for models that support it (OpenAI models)
            if (model.includes('openai/') || model.includes('gpt-')) {
                requestBody.response_format = {
                    type: "json_schema",
                    json_schema: {
                        name: "file_analysis",
                        schema: responseSchema,
                        strict: true
                    }
                };
            } else {
                // For other models, use simple JSON mode
                requestBody.response_format = { type: "json_object" };
            }

            const postData = JSON.stringify(requestBody);

            const options = {
                hostname: 'openrouter.ai',
                port: 443,
                path: '/api/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                    'HTTP-Referer': process.env.OPENROUTER_APP_URL || 'http://localhost:7863',
                    'X-Title': process.env.OPENROUTER_APP_TITLE || 'File Browser AI'
                }
            };

            console.log('Debug - Request options:', {
                hostname: options.hostname,
                path: options.path,
                method: options.method,
                headers: {
                    ...options.headers,
                    'Authorization': `Bearer ${apiKey.substring(0, 10)}...`
                }
            });

            const startTime = Date.now();
            
            const req = https.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const result = JSON.parse(data);
                        
                        // Check for API error response
                        if (result.error) {
                            reject(new Error(`OpenRouter API Error: ${result.error.message} (Code: ${result.error.code})`));
                            return;
                        }
                        
                        if (!result.choices || !result.choices[0]) {
                            reject(new Error(`Invalid API response structure. Response: ${data}`));
                            return;
                        }
                        
                        const responseText = result.choices[0].message.content;
                        
                        // Collect statistics
                        const stats = {
                            model: model,
                            total_time: (Date.now() - startTime) / 1000,
                            input_tokens: result.usage?.prompt_tokens || 0,
                            output_tokens: result.usage?.completion_tokens || 0,
                            cached: result.choices[0]?.finish_reason === 'cached'
                        };
                        
                        // Try to parse the LLM response as JSON
                        let analysis;
                        try {
                            analysis = typeof responseText === 'string' ? JSON.parse(responseText) : responseText;
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
                                summary: `Analysis completed but response format was unexpected. Raw response: ${typeof responseText === 'string' ? responseText.substring(0, 200) : JSON.stringify(responseText).substring(0, 200)}...`
                            };
                        }
                        
                        resolve({
                            analysis,
                            stats,
                            rawResponse: responseText
                        });
                    } catch (error) {
                        reject(new Error(`Failed to parse API response: ${error.message}. Response: ${data}`));
                    }
                });
            });
            
            req.on('error', (error) => {
                console.error('API request error:', error);
                // Fallback response on error
                const errorResponse = {
                    suggestions: [
                        {
                            path: "error.txt",
                            name: "Analysis Error.txt",
                            reason: `Failed to analyze files: ${error.message}`,
                            content_type: "Error Report",
                            engagement_score: 5
                        }
                    ],
                    summary: `Error during AI analysis: ${error.message}`
                };
                
                resolve({
                    analysis: errorResponse,
                    stats: { 
                        model: model, 
                        total_time: (Date.now() - startTime) / 1000, 
                        input_tokens: 0, 
                        output_tokens: 0, 
                        cached: false, 
                        error: error.message 
                    },
                    rawResponse: JSON.stringify(errorResponse)
                });
            });
            
            // Send the request
            req.write(postData);
            req.end();
        });
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