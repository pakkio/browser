const request = require('supertest');
const app = require('../server');
const FileCache = require('../cache');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Cache System Tests', () => {
  describe('FileCache utility', () => {
    let cache;

    beforeEach(() => {
      cache = new FileCache({
        cacheDir: path.join(os.tmpdir(), 'test-cache'),
        maxAge: 5000, // 5 seconds for testing
        maxSize: 1024 * 1024 // 1MB for testing
      });
    });

    afterEach(async () => {
      // Clean up test cache
      await cache.clear();
    });

    it('should initialize cache directory structure', () => {
      expect(cache.initialized).toBe(true);
      expect(fs.existsSync(cache.cacheDir)).toBe(true);
      
      // Check subdirectories exist
      const subdirs = ['comic-lists', 'archive-contents', 'pdf-info', 'thumbnails', 'directory-listings'];
      subdirs.forEach(subdir => {
        expect(fs.existsSync(path.join(cache.cacheDir, subdir))).toBe(true);
      });
    });

    it('should generate consistent cache keys', () => {
      const key1 = cache.generateKey('/path/to/file.zip', 'contents', 'subfolder');
      const key2 = cache.generateKey('/path/to/file.zip', 'contents', 'subfolder');
      const key3 = cache.generateKey('/path/to/file.zip', 'contents', 'different');
      
      expect(key1).toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key1).toMatch(/^[a-f0-9]{32}$/); // MD5 hash format
    });

    it('should store and retrieve cached data', async () => {
      const testData = { files: ['file1.txt', 'file2.txt'], count: 2 };
      const key = 'test-key';
      
      // Set cache
      const setResult = await cache.set('archive-contents', key, testData);
      expect(setResult).toBe(true);
      
      // Get cache
      const cachedData = await cache.get('archive-contents', key);
      expect(cachedData).toEqual(testData);
    });

    it('should return null for non-existent cache entries', async () => {
      const cachedData = await cache.get('archive-contents', 'non-existent-key');
      expect(cachedData).toBeNull();
    });

    it('should invalidate cache based on source file modification time', async () => {
      // Create a temporary test file
      const testFile = path.join(os.tmpdir(), 'test-source.txt');
      fs.writeFileSync(testFile, 'test content');
      
      const testData = { data: 'cached content' };
      const key = 'mtime-test';
      
      // Set cache with source file
      await cache.set('archive-contents', key, testData, testFile);
      
      // Should get cached data
      let cachedData = await cache.get('archive-contents', key, testFile);
      expect(cachedData).toEqual(testData);
      
      // Modify source file
      setTimeout(() => {
        fs.writeFileSync(testFile, 'modified content');
      }, 10);
      
      // Wait a bit then check cache
      setTimeout(async () => {
        cachedData = await cache.get('archive-contents', key, testFile);
        expect(cachedData).toBeNull(); // Should be invalidated
        
        // Clean up
        fs.unlinkSync(testFile);
      }, 50);
    });

    it('should provide cache statistics', async () => {
      // Add some test data
      await cache.set('comic-lists', 'test1', { files: ['a', 'b'] });
      await cache.set('archive-contents', 'test2', { files: ['c', 'd'] });
      
      const stats = await cache.getStats();
      
      expect(stats).toHaveProperty('totalFiles');
      expect(stats).toHaveProperty('totalSize');
      expect(stats).toHaveProperty('categories');
      expect(stats.totalFiles).toBeGreaterThan(0);
      expect(stats.categories).toHaveProperty('comic-lists');
      expect(stats.categories).toHaveProperty('archive-contents');
    });

    it('should clear all cache entries', async () => {
      // Add some test data
      await cache.set('comic-lists', 'test1', { files: ['a', 'b'] });
      await cache.set('archive-contents', 'test2', { files: ['c', 'd'] });
      
      // Clear cache
      const success = await cache.clear();
      expect(success).toBe(true);
      
      // Verify cache is empty
      const stats = await cache.getStats();
      expect(stats.totalFiles).toBe(0);
    });
  });

  describe('Cache API endpoints', () => {
    it('should get cache statistics', async () => {
      await request(app)
        .get('/api/cache/stats')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('totalFiles');
          expect(res.body).toHaveProperty('totalSize');
          expect(res.body).toHaveProperty('totalSizeFormatted');
          expect(res.body).toHaveProperty('categories');
          expect(Array.isArray(res.body.categories)).toBe(true);
        });
    });

    it('should clear cache', async () => {
      await request(app)
        .post('/api/cache/clear')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
          expect(res.body.message).toContain('cleared successfully');
        });
    });
  });

  describe('Integration with existing functionality', () => {
    it('should not break existing archive endpoint behavior', async () => {
      await request(app)
        .get('/archive-contents?path=test.txt')
        .expect(400)
        .expect(/Not a supported archive format/);
    });

    it('should not break existing comic endpoint behavior', async () => {
      await request(app)
        .get('/comic-preview?path=test.txt')
        .expect(400)
        .expect(/Not a comic book archive/);
    });
  });
});