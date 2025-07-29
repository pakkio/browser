const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

class FileCache {
    constructor(options = {}) {
        this.cacheDir = options.cacheDir || path.join(os.homedir(), '.browser', 'cache');
        this.maxAge = options.maxAge || 24 * 60 * 60 * 1000; // 24 hours default
        this.maxSize = options.maxSize || 100 * 1024 * 1024; // 100MB default
        this.initialized = false;
        
        this.init();
    }

    init() {
        try {
            // Create cache directory structure
            if (!fs.existsSync(this.cacheDir)) {
                fs.mkdirSync(this.cacheDir, { recursive: true });
                console.log(`[${new Date().toISOString()}] 📁 Created cache directory: ${this.cacheDir}`);
            }

            // Create subdirectories for different cache types
            const subdirs = ['comic-lists', 'archive-contents', 'pdf-info', 'thumbnails', 'directory-listings'];
            subdirs.forEach(subdir => {
                const subdirPath = path.join(this.cacheDir, subdir);
                if (!fs.existsSync(subdirPath)) {
                    fs.mkdirSync(subdirPath, { recursive: true });
                }
            });

            this.initialized = true;
            console.log(`[${new Date().toISOString()}] ✅ Cache system initialized at ${this.cacheDir}`);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] ❌ Cache initialization failed: ${error.message}`);
            this.initialized = false;
        }
    }

    // Generate cache key from file path and operation
    generateKey(filePath, operation, extra = '') {
        const fullKey = `${filePath}:${operation}:${extra}`;
        return crypto.createHash('md5').update(fullKey).digest('hex');
    }

    // Get cache file path
    getCacheFilePath(category, key) {
        return path.join(this.cacheDir, category, `${key}.json`);
    }

    // Check if cache entry is valid based on source file modification time
    async isValidCache(cacheFilePath, sourceFilePath) {
        try {
            if (!fs.existsSync(cacheFilePath)) {
                console.log(`[${new Date().toISOString()}] 🔍 Cache invalid: File does not exist ${cacheFilePath}`);
                return false;
            }

            const cacheStats = fs.statSync(cacheFilePath);
            const sourceStats = fs.statSync(sourceFilePath);
            
            console.log(`[${new Date().toISOString()}] 🔍 Cache validation: source mtime=${sourceStats.mtime.getTime()}, cache mtime=${cacheStats.mtime.getTime()}, diff=${sourceStats.mtime.getTime() - cacheStats.mtime.getTime()}ms`);
            
            // Check if cache is newer than source file (allow 1 second tolerance for filesystem timing)
            if (sourceStats.mtime.getTime() > cacheStats.mtime.getTime() + 1000) {
                console.log(`[${new Date().toISOString()}] 🔍 Cache invalid: Source file is newer than cache`);
                return false;
            }

            // Check if cache is not too old
            const now = Date.now();
            const cacheAge = now - cacheStats.mtime.getTime();
            if (cacheAge > this.maxAge) {
                console.log(`[${new Date().toISOString()}] 🔍 Cache invalid: Cache is too old (${cacheAge}ms > ${this.maxAge}ms)`);
                return false;
            }

            console.log(`[${new Date().toISOString()}] 🔍 Cache valid: All checks passed`);
            return true;
        } catch (error) {
            console.log(`[${new Date().toISOString()}] 🔍 Cache invalid: Error ${error.message}`);
            return false;
        }
    }

    // Get cached data
    async get(category, key, sourceFilePath = null) {
        if (!this.initialized) {
            console.log(`[${new Date().toISOString()}] 🔍 Cache GET: Not initialized`);
            return null;
        }

        try {
            const cacheFilePath = this.getCacheFilePath(category, key);
            console.log(`[${new Date().toISOString()}] 🔍 Cache GET: Looking for ${cacheFilePath}`);
            
            // Check if cache is valid
            if (sourceFilePath && !(await this.isValidCache(cacheFilePath, sourceFilePath))) {
                console.log(`[${new Date().toISOString()}] 🔍 Cache GET: Invalid cache for ${key}`);
                return null;
            }

            if (!fs.existsSync(cacheFilePath)) {
                console.log(`[${new Date().toISOString()}] 🔍 Cache GET: File does not exist ${cacheFilePath}`);
                return null;
            }

            const cacheData = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
            console.log(`[${new Date().toISOString()}] 🔍 Cache GET: Successfully loaded ${Array.isArray(cacheData) ? cacheData.length : 'non-array'} items`);
            
            // Update access time for LRU (keep mtime as current time to prevent cache invalidation)
            const now = new Date();
            fs.utimesSync(cacheFilePath, now, now);

            console.log(`[${new Date().toISOString()}] 📋 Cache HIT: ${category}/${key}`);
            return cacheData.data;
        } catch (error) {
            console.error(`[${new Date().toISOString()}] ❌ Cache read error: ${error.message}`);
            return null;
        }
    }

    // Set cached data
    async set(category, key, data, sourceFilePath = null) {
        if (!this.initialized) {
            return false;
        }

        try {
            const cacheFilePath = this.getCacheFilePath(category, key);
            
            const cacheData = {
                data: data,
                timestamp: Date.now(),
                sourceFile: sourceFilePath,
                mtime: sourceFilePath ? fs.statSync(sourceFilePath).mtime : null
            };

            fs.writeFileSync(cacheFilePath, JSON.stringify(cacheData, null, 2));
            // Ensure the file is written to disk
            fs.fsyncSync(fs.openSync(cacheFilePath, 'r'));
            console.log(`[${new Date().toISOString()}] 💾 Cache SET: ${category}/${key} -> ${cacheFilePath}`);
            
            // Trigger cleanup if cache is getting large
            setImmediate(() => this.cleanup());
            
            return true;
        } catch (error) {
            console.error(`[${new Date().toISOString()}] ❌ Cache write error: ${error.message}`);
            return false;
        }
    }

    // Delete specific cache entry
    async delete(category, key) {
        if (!this.initialized) {
            return false;
        }

        try {
            const cacheFilePath = this.getCacheFilePath(category, key);
            if (fs.existsSync(cacheFilePath)) {
                fs.unlinkSync(cacheFilePath);
                console.log(`[${new Date().toISOString()}] 🗑️ Cache DELETE: ${category}/${key}`);
                return true;
            }
            return false;
        } catch (error) {
            console.error(`[${new Date().toISOString()}] ❌ Cache delete error: ${error.message}`);
            return false;
        }
    }

    // Get cache statistics
    async getStats() {
        if (!this.initialized) {
            return { error: 'Cache not initialized' };
        }

        try {
            const stats = {
                totalFiles: 0,
                totalSize: 0,
                categories: {}
            };

            const categories = fs.readdirSync(this.cacheDir);
            
            for (const category of categories) {
                const categoryPath = path.join(this.cacheDir, category);
                if (!fs.statSync(categoryPath).isDirectory()) continue;

                const files = fs.readdirSync(categoryPath);
                let categorySize = 0;

                files.forEach(file => {
                    const filePath = path.join(categoryPath, file);
                    const fileStats = fs.statSync(filePath);
                    categorySize += fileStats.size;
                });

                stats.categories[category] = {
                    files: files.length,
                    size: categorySize
                };

                stats.totalFiles += files.length;
                stats.totalSize += categorySize;
            }

            return stats;
        } catch (error) {
            return { error: error.message };
        }
    }

    // Cleanup old/large cache entries
    async cleanup() {
        if (!this.initialized) {
            return;
        }

        try {
            const stats = await this.getStats();
            
            // Skip cleanup if cache is small
            if (stats.totalSize < this.maxSize * 0.8) {
                return;
            }

            console.log(`[${new Date().toISOString()}] 🧹 Cache cleanup starting (${(stats.totalSize / 1024 / 1024).toFixed(1)}MB)`);

            const allFiles = [];
            const categories = Object.keys(stats.categories);

            // Collect all cache files with their access times
            for (const category of categories) {
                const categoryPath = path.join(this.cacheDir, category);
                const files = fs.readdirSync(categoryPath);

                files.forEach(file => {
                    const filePath = path.join(categoryPath, file);
                    const fileStats = fs.statSync(filePath);
                    
                    allFiles.push({
                        path: filePath,
                        accessTime: fileStats.atime,
                        size: fileStats.size,
                        category: category,
                        file: file
                    });
                });
            }

            // Sort by access time (LRU first)
            allFiles.sort((a, b) => a.accessTime - b.accessTime);

            // Remove old files until we're under the size limit
            let removedSize = 0;
            let removedCount = 0;
            const targetSize = this.maxSize * 0.7; // Clean up to 70% of max size

            for (const fileInfo of allFiles) {
                if (stats.totalSize - removedSize <= targetSize) {
                    break;
                }

                try {
                    fs.unlinkSync(fileInfo.path);
                    removedSize += fileInfo.size;
                    removedCount++;
                } catch (error) {
                    console.error(`[${new Date().toISOString()}] ❌ Failed to remove cache file: ${error.message}`);
                }
            }

            if (removedCount > 0) {
                console.log(`[${new Date().toISOString()}] ✅ Cache cleanup: removed ${removedCount} files (${(removedSize / 1024 / 1024).toFixed(1)}MB)`);
            }

        } catch (error) {
            console.error(`[${new Date().toISOString()}] ❌ Cache cleanup error: ${error.message}`);
        }
    }

    // Clear all cache
    async clear() {
        if (!this.initialized) {
            return false;
        }

        try {
            const categories = fs.readdirSync(this.cacheDir);
            let removedCount = 0;

            for (const category of categories) {
                const categoryPath = path.join(this.cacheDir, category);
                if (!fs.statSync(categoryPath).isDirectory()) continue;

                const files = fs.readdirSync(categoryPath);
                files.forEach(file => {
                    fs.unlinkSync(path.join(categoryPath, file));
                    removedCount++;
                });
            }

            console.log(`[${new Date().toISOString()}] 🗑️ Cache cleared: ${removedCount} files removed`);
            return true;
        } catch (error) {
            console.error(`[${new Date().toISOString()}] ❌ Cache clear error: ${error.message}`);
            return false;
        }
    }
}

module.exports = FileCache;