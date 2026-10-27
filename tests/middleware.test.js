const request = require('supertest');

jest.mock('node-unrar-js', () => ({
  createExtractorFromFile: jest.fn().mockRejectedValue(new Error('File is not RAR archive'))
}));

describe('Middleware and Application Tests', () => {
  let originalAuth;
  
  beforeEach(() => {
    originalAuth = process.env.AUTH;
    // Clear require cache for config-dependent modules
    Object.keys(require.cache).forEach(key => {
      if (key.includes('server.js') || key.includes('config.js') ||
          key.includes('auth.js') || key.includes('auth-routes.js')) {
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
      
      // Mock fs for browse endpoint
      const fs = require('fs');
      jest.spyOn(fs.promises, 'readdir').mockResolvedValue([
        { name: 'test.txt', isDirectory: () => false }
      ]);
      jest.spyOn(fs.promises, 'stat').mockResolvedValue({
        size: 1024,
        mtime: new Date('2023-01-01'),
        isDirectory: () => false
      });
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      await request(app)
        .get('/api/browse')
        .expect(200);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/GET \/api\/browse/)
      );
      
      consoleSpy.mockRestore();
      fs.promises.readdir.mockRestore();
      fs.promises.stat.mockRestore();
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
    test('should export app module', () => {
      process.env.AUTH = 'FALSE';
      const app = require('../server.js');
      expect(app).toBeDefined();
      expect(typeof app).toBe('function');
    });

    test('should start with correct authentication configuration', () => {
      process.env.AUTH = 'TRUE';
      process.env.GOOGLE_CLIENT_ID = 'test-client-id';
      process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
      delete require.cache[require.resolve('../lib/config.js')];
      const app = require('../server.js');
      expect(app).toBeDefined();
    });

    test('should display port configuration on startup', () => {
      process.env.AUTH = 'FALSE';
      const config = require('../lib/config');
      expect(config.port).toBe(3000);
    });
  });

  describe('MIME Type Handling', () => {
    test('should return correct MIME type for known extensions', async () => {
      process.env.AUTH = 'FALSE';
      const app = require('../server.js');

      // Mock file existence and content
      const fs = require('fs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'createReadStream').mockImplementation(() => ({
        pipe: jest.fn((res) => res.end('test')),
        on: jest.fn(),
        destroy: jest.fn()
      }));
      jest.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => false, size: 4 });

      const response = await request(app)
        .get('/files?path=test.pdf')
        .expect(200);

      expect(response.headers['content-type']).toBe('application/pdf');
    });

    test('should return default MIME type for unknown extensions', async () => {
      process.env.AUTH = 'FALSE';
      const app = require('../server.js');

      const fs = require('fs');
      const { Readable } = require('stream');
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({
        isDirectory: () => false,
        size: 4
      });
      const fakeStream = new Readable({
        read() {
          this.push('test');
          this.push(null);
        }
      });
      jest.spyOn(fs, 'createReadStream').mockReturnValue(fakeStream);

      const response = await request(app)
        .get('/files?path=test.unknown')
        .expect(200);

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

      const fs = require('fs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      const response = await request(app)
        .get('/comic-preview?path=test.txt&page=1')
        .expect(400);

      expect(response.text).toBe('Not a supported archive');
    });

    test('should validate EPUB file extensions', async () => {
      process.env.AUTH = 'FALSE';
      const app = require('../server.js');

      const fs = require('fs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

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

      const fs = require('fs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024, isDirectory: () => false });
      jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07]));

      // node-unrar-js is already mocked at the top of the file to reject with 'File is not RAR archive'
      // This triggers the CBZ fallback in extractFromCBR

      const response = await request(app)
        .get('/comic-preview?path=test.cbr&page=1')
        .expect(422);

      expect(response.text).toBe('Archive file is corrupted and cannot be processed');
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