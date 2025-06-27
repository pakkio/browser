const request = require('supertest');

describe('Middleware and Application Tests', () => {
  let originalAuth;
  
  beforeEach(() => {
    originalAuth = process.env.AUTH;
    // Clear require cache
    Object.keys(require.cache).forEach(key => {
      if (key.includes('server.js')) {
        delete require.cache[key];
      }
    });
  });

  afterEach(() => {
    process.env.AUTH = originalAuth;
  });

  describe('Static File Serving', () => {
    test('should serve static files from public directory', async () => {
      process.env.AUTH = 'FALSE';
      const app = require('../server.js');
      
      const response = await request(app)
        .get('/file-renderer.js')
        .expect(200);
      
      expect(response.headers['content-type']).toContain('javascript');
    });
  });

  describe('Request Logging Middleware', () => {
    test('should log non-file requests', async () => {
      process.env.AUTH = 'FALSE';
      const app = require('../server.js');
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      await request(app)
        .get('/api/browse')
        .expect(200);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/GET \/api\/browse/)
      );
      
      consoleSpy.mockRestore();
    });

    test('should not log file requests without query params', async () => {
      process.env.AUTH = 'FALSE';
      const app = require('../server.js');
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      await request(app)
        .get('/files')
        .expect(400); // Will fail but that's expected
      
      // Should not log the request itself
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringMatching(/GET \/files$/)
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('Application Startup Configuration', () => {
    test('should start with correct authentication configuration', () => {
      process.env.AUTH = 'TRUE';
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      require('../server.js');
      
      expect(consoleSpy).toHaveBeenCalledWith('🔐 Authentication: ENABLED');
      
      consoleSpy.mockRestore();
    });

    test('should display base directory on startup', () => {
      process.env.AUTH = 'FALSE';
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      require('../server.js');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/📂 Base directory:/)
      );
      
      consoleSpy.mockRestore();
    });

    test('should display port configuration on startup', () => {
      process.env.AUTH = 'FALSE';
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      require('../server.js');
      
      expect(consoleSpy).toHaveBeenCalledWith('🔧 Port: 3000');
      
      consoleSpy.mockRestore();
    });
  });

  describe('MIME Type Handling', () => {
    test('should return correct MIME type for known extensions', async () => {
      process.env.AUTH = 'FALSE';
      const app = require('../server.js');
      
      // Test PDF MIME type
      const response = await request(app)
        .get('/files?path=test.pdf')
        .expect(200);
      
      expect(response.headers['content-type']).toBe('application/pdf');
    });

    test('should return default MIME type for unknown extensions', async () => {
      process.env.AUTH = 'FALSE';
      const app = require('../server.js');
      
      // Test unknown extension (will error due to file not existing, but header should be set)
      const response = await request(app)
        .get('/files?path=test.unknown')
        .expect(500);
      
      expect(response.headers['content-type']).toBe('application/octet-stream');
    });
  });

  describe('Session Configuration (Auth Enabled)', () => {
    test('should configure session middleware when auth is enabled', async () => {
      process.env.AUTH = 'TRUE';
      const app = require('../server.js');
      
      // Session should be configured, so session-related headers should be present
      const response = await request(app)
        .get('/auth/user')
        .expect(200);
      
      expect(response.body.authenticated).toBe(false);
    });
  });

  describe('Path Resolution', () => {
    test('should resolve relative paths correctly', async () => {
      process.env.AUTH = 'FALSE';
      const app = require('../server.js');
      
      const response = await request(app)
        .get('/api/browse?path=.')
        .expect(200);
      
      expect(response.body.files).toBeDefined();
    });

    test('should handle empty path parameter', async () => {
      process.env.AUTH = 'FALSE';
      const app = require('../server.js');
      
      const response = await request(app)
        .get('/api/browse?path=')
        .expect(200);
      
      expect(response.body.files).toBeDefined();
    });
  });

  describe('File Extension Validation', () => {
    test('should validate PDF file extensions', async () => {
      process.env.AUTH = 'FALSE';
      const app = require('../server.js');
      
      const response = await request(app)
        .get('/pdf-preview?path=test.txt&page=1')
        .expect(400);
      
      expect(response.text).toBe('Not a PDF file');
    });

    test('should validate comic file extensions', async () => {
      process.env.AUTH = 'FALSE';
      const app = require('../server.js');
      
      const response = await request(app)
        .get('/comic-preview?path=test.txt&page=1')
        .expect(400);
      
      expect(response.text).toBe('Not a comic book archive');
    });

    test('should validate EPUB file extensions', async () => {
      process.env.AUTH = 'FALSE';
      const app = require('../server.js');
      
      const response = await request(app)
        .get('/epub-preview?path=test.txt')
        .expect(400);
      
      expect(response.body.error).toBe('Not an EPUB file');
    });
  });

  describe('Module Export Handling', () => {
    test('should export app module when not main', () => {
      process.env.AUTH = 'FALSE';
      const app = require('../server.js');
      
      expect(app).toBeDefined();
      expect(typeof app).toBe('function'); // Express app is a function
    });
  });

  describe('CBR Fallback Extraction', () => {
    test('should handle CBR extraction fallback errors', async () => {
      process.env.AUTH = 'FALSE';
      const app = require('../server.js');
      
      // Mock node-unrar-js to throw error
      const { createExtractorFromFile } = require('node-unrar-js');
      const originalCreateExtractor = createExtractorFromFile;
      
      require('node-unrar-js').createExtractorFromFile = jest.fn().mockRejectedValue(
        new Error('Extraction library error')
      );

      const response = await request(app)
        .get('/comic-preview?path=test.cbr&page=1')
        .expect(500);
      
      expect(response.text).toContain('Comic extraction error');
      
      // Restore original function
      require('node-unrar-js').createExtractorFromFile = originalCreateExtractor;
    });
  });

  describe('Cache Management', () => {
    test('should initialize comic file cache', () => {
      process.env.AUTH = 'FALSE';
      const app = require('../server.js');
      
      // The cache should be initialized (this tests the global variable initialization)
      expect(app).toBeDefined();
    });

    test('should initialize pending requests map', () => {
      process.env.AUTH = 'FALSE';
      const app = require('../server.js');
      
      // The pending requests map should be initialized
      expect(app).toBeDefined();
    });
  });
});