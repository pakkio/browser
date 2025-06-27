const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Mock external dependencies
jest.mock('pdf2pic');
jest.mock('yauzl');
jest.mock('node-unrar-js');
jest.mock('child_process');

const app = require('../server');

describe('Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('File Browser Workflow', () => {
    test('should browse directory and serve files', async () => {
      // Mock fs operations
      jest.spyOn(fs, 'readdirSync').mockReturnValue([
        { name: 'test.txt', isDirectory: () => false },
        { name: 'folder', isDirectory: () => true }
      ]);
      
      jest.spyOn(fs, 'statSync').mockReturnValue({
        size: 1024,
        mtime: new Date('2023-01-01')
      });
      
      const mockStream = {
        on: jest.fn((event, callback) => {
          if (event === 'error') return;
        }),
        pipe: jest.fn((res) => {
          res.end('test content');
        })
      };
      
      jest.spyOn(fs, 'createReadStream').mockReturnValue(mockStream);

      // 1. Browse root directory
      const browseResponse = await request(app)
        .get('/api/browse')
        .expect(200);

      expect(browseResponse.body.files).toBeDefined();
      expect(Array.isArray(browseResponse.body.files)).toBe(true);

      // 2. Serve a file  
      const fileResponse = await request(app)
        .get('/files?path=test.txt');

      expect(fileResponse.status).toBe(200);
    });

    test('should handle complete PDF workflow', async () => {
      const { exec } = require('child_process');
      const pdf2pic = require('pdf2pic');
      
      // Mock PDF info
      exec.mockImplementation((command, callback) => {
        if (command.includes('pdfinfo')) {
          callback(null, 'Pages: 5\nCreator: Test', '');
        }
      });
      
      // Mock PDF conversion
      const mockConvert = jest.fn().mockResolvedValue({
        base64: 'base64encodedimage'
      });
      pdf2pic.fromPath.mockReturnValue(mockConvert);

      // 1. Get PDF info
      const infoResponse = await request(app)
        .get('/api/pdf-info?path=test.pdf')
        .expect(200);

      expect(infoResponse.body.pages).toBe(5);

      // 2. Get PDF preview
      const previewResponse = await request(app)
        .get('/pdf-preview?path=test.pdf&page=1')
        .expect(200);

      expect(mockConvert).toHaveBeenCalledWith(1, { responseType: "base64" });
    });

    test('should handle complete comic workflow', async () => {
      const yauzl = require('yauzl');
      
      // Mock CBZ extraction
      const mockZipfile = {
        readEntry: jest.fn(),
        on: jest.fn((event, callback) => {
          if (event === 'entry') {
            callback({ fileName: 'page001.jpg' });
          } else if (event === 'end') {
            callback();
          }
        }),
        openReadStream: jest.fn((entry, callback) => {
          const mockStream = {
            pipe: jest.fn((res) => {
              res.setHeader('Content-Type', 'image/jpeg');
              res.end('mock image');
            }),
            on: jest.fn((event, callback) => {
              if (event === 'end') callback();
            })
          };
          callback(null, mockStream);
        }),
        close: jest.fn()
      };

      yauzl.open.mockImplementation((path, options, callback) => {
        callback(null, mockZipfile);
      });

      // Test comic preview
      const response = await request(app)
        .get('/comic-preview?path=test.cbz&page=1');

      expect(response.status).toBe(200);
    });

    test('should handle complete EPUB workflow', async () => {
      const yauzl = require('yauzl');
      
      // Mock EPUB extraction with proper structure
      const mockFiles = new Map();
      mockFiles.set('META-INF/container.xml', 
        '<?xml version="1.0"?><container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>');
      mockFiles.set('content.opf', 
        '<?xml version="1.0"?><package><metadata><dc:title>Test Book</dc:title></metadata><spine><itemref idref="ch1"/></spine><manifest><item id="ch1" href="ch1.html"/></manifest></package>');
      mockFiles.set('ch1.html', 
        '<html><body><h1>Chapter 1</h1><p>Test content</p></body></html>');
      
      const mockZipfile = {
        readEntry: jest.fn(),
        on: jest.fn((event, callback) => {
          if (event === 'entry') {
            Array.from(mockFiles.keys()).forEach(fileName => {
              callback({ fileName });
            });
          } else if (event === 'end') {
            callback();
          }
        }),
        openReadStream: jest.fn((entry, callback) => {
          const content = mockFiles.get(entry.fileName) || '';
          const mockStream = {
            on: jest.fn((event, callback) => {
              if (event === 'data') callback(Buffer.from(content));
              if (event === 'end') callback();
            })
          };
          callback(null, mockStream);
        })
      };

      yauzl.open.mockImplementation((path, options, callback) => {
        callback(null, mockZipfile);
      });

      // Test EPUB preview
      const response = await request(app)
        .get('/epub-preview?path=test.epub');

      expect(response.status).toBe(200);
      if (response.status === 200) {
        expect(response.body).toHaveProperty('metadata');
      }
    });
  });

  describe('Error Handling Integration', () => {
    test('should handle cascading errors gracefully', async () => {
      // 1. Mock file not found error
      jest.spyOn(fs, 'createReadStream').mockImplementation(() => {
        const stream = require('stream');
        const errorStream = new stream.Readable();
        errorStream._read = () => {};
        process.nextTick(() => {
          errorStream.emit('error', new Error('ENOENT: no such file or directory'));
        });
        return errorStream;
      });

      const response1 = await request(app)
        .get('/files?path=nonexistent.txt');
      expect(response1.status).toBe(500);

      // 2. Invalid PDF
      const { exec } = require('child_process');
      exec.mockImplementation((command, callback) => {
        callback(new Error('Invalid PDF'), '', 'Error reading PDF');
      });

      await request(app)
        .get('/api/pdf-info?path=invalid.pdf')
        .expect(500);

      // 3. Corrupted archive
      const yauzl = require('yauzl');
      yauzl.open.mockImplementation((path, options, callback) => {
        callback(new Error('Corrupted archive'));
      });

      await request(app)
        .get('/comic-preview?path=corrupted.cbz&page=1')
        .expect(500);
    });
  });

  describe('Security Integration', () => {
    test('should prevent path traversal attacks', async () => {
      // Test specific path traversal patterns that should be blocked
      const response1 = await request(app)
        .get('/api/browse?path=../../../etc/passwd');
      expect(response1.status).toBe(403);

      const response2 = await request(app)
        .get('/files?path=../../../etc/passwd');
      expect(response2.status).toBe(403);

      // Test path that should fail with file not found
      const response3 = await request(app)
        .get('/files?path=/etc/passwd');
      expect([403, 500]).toContain(response3.status); // Either forbidden or file not found
    });
  });

  describe('Performance Integration', () => {
    test('should handle concurrent requests', async () => {
      // Mock successful responses
      jest.spyOn(fs, 'readdirSync').mockReturnValue([
        { name: 'test.txt', isDirectory: () => false }
      ]);
      jest.spyOn(fs, 'statSync').mockReturnValue({
        size: 1024,
        mtime: new Date()
      });

      // Create multiple concurrent requests
      const requests = Array(5).fill(null).map(() => 
        request(app).get('/api/browse').expect(200)
      );

      const responses = await Promise.all(requests);
      
      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.files).toBeDefined();
      });
    });
  });
});