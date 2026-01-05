const request = require('supertest');
const express = require('express');
const path = require('path');
const fs = require('fs');

// Mock external dependencies
jest.mock('pdf2pic');
jest.mock('yauzl');
jest.mock('node-unrar-js');
jest.mock('child_process');

describe('File Browser Server', () => {
  let app;
  
  beforeAll(() => {
    process.env.AUTH = 'FALSE'; // Disable auth for server tests
    delete require.cache[require.resolve('../server.js')];
    delete require.cache[require.resolve('../auth.js')];
    app = require('../server');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset all fs mocks
    jest.restoreAllMocks();
  });

  describe('GET /api/browse', () => {
    test('should return files in root directory', async () => {
      // Mock fs.readdirSync
      const mockFiles = [
        { name: 'test.txt', isDirectory: () => false },
        { name: 'folder', isDirectory: () => true }
      ];
      
      jest.spyOn(fs, 'readdirSync').mockReturnValue(mockFiles);
      jest.spyOn(fs, 'statSync').mockReturnValue({
        size: 1024,
        mtime: new Date('2023-01-01')
      });

      const response = await request(app)
        .get('/api/browse')
        .expect(200);

      expect(response.body).toHaveProperty('files');
      expect(response.body.files).toHaveLength(2);
    });

    test('should handle directory read errors', async () => {
      jest.spyOn(fs, 'readdirSync').mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await request(app)
        .get('/api/browse')
        .expect(500);
    });

    test('should prevent path traversal attacks', async () => {
      await request(app)
        .get('/api/browse?path=../../../etc/passwd')
        .expect(403);
    });
  });

  describe('GET /files', () => {
    test('should serve files with correct content type', async () => {
      const testContent = 'test file content';
      const mockStream = {
        on: jest.fn((event, callback) => {
          if (event === 'error') return;
          if (event === 'data') callback(Buffer.from(testContent));
          if (event === 'end') callback();
        }),
        pipe: jest.fn((res) => {
          res.end(testContent);
        })
      };
      
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'createReadStream').mockReturnValue(mockStream);
      jest.spyOn(fs, 'statSync').mockReturnValue({
        isDirectory: () => false,
        size: testContent.length
      });

      const response = await request(app)
        .get('/files?path=test.txt');
        
      expect(response.status).toBe(200);
    });

    test('should reject requests without file path', async () => {
      await request(app)
        .get('/files')
        .expect(400);
    });

    test('should prevent path traversal in file serving', async () => {
      await request(app)
        .get('/files?path=../../../etc/passwd')
        .expect(403);
    });
  });

  describe('GET /subtitle', () => {
    test('should ignore leading slash in subtitle path', async () => {
      jest.spyOn(fs, 'existsSync').mockImplementation((p) => String(p).endsWith('todo/my/sub.vtt'));
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi');

      const response = await request(app)
        .get('/subtitle?path=/todo/my/sub.vtt');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/vtt/);
    });
  });

  describe('GET /api/pdf-info', () => {
    test('should return PDF page count', async () => {
      const { exec } = require('child_process');
      exec.mockImplementation((command, callback) => {
        callback(null, 'Pages: 10\nOther info...', '');
      });

      const response = await request(app)
        .get('/api/pdf-info?path=test.pdf')
        .expect(200);

      expect(response.body).toEqual({ pages: 10 });
    });

    test('should handle PDF info errors', async () => {
      const { exec } = require('child_process');
      exec.mockImplementation((command, callback) => {
        callback(new Error('PDF error'), '', 'Error message');
      });

      await request(app)
        .get('/api/pdf-info?path=test.pdf')
        .expect(500);
    });
  });

  describe('GET /pdf-preview', () => {
    test('should convert PDF page to image', async () => {
      const pdf2pic = require('pdf2pic');
      const mockConvert = jest.fn().mockResolvedValue({
        base64: 'base64imagedata'
      });
      
      pdf2pic.fromPath.mockReturnValue(mockConvert);

      await request(app)
        .get('/pdf-preview?path=test.pdf&page=1')
        .expect(200);
    });

    test('should reject non-PDF files', async () => {
      await request(app)
        .get('/pdf-preview?path=test.txt&page=1')
        .expect(400);
    });
  });

  describe('GET /comic-preview', () => {
    test('should extract comic page from CBZ', async () => {
      const yauzl = require('yauzl');
      const mockZipfile = {
        readEntry: jest.fn(),
        on: jest.fn((event, callback) => {
          if (event === 'entry') {
            callback({ fileName: 'page1.jpg' });
          }
          if (event === 'end') {
            callback();
          }
        }),
        openReadStream: jest.fn((entry, callback) => {
          const mockStream = {
            pipe: jest.fn((res) => {
              res.setHeader('Content-Type', 'image/jpeg');
              res.end('mock image data');
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

      const response = await request(app)
        .get('/comic-preview?path=test.cbz&page=1');
        
      expect(response.status).toBe(200);
    });

    test('should reject non-comic files', async () => {
      await request(app)
        .get('/comic-preview?path=test.txt&page=1')
        .expect(400);
    });
  });

  describe('GET /epub-preview', () => {
    test('should extract EPUB content', async () => {
      const yauzl = require('yauzl');
      
      // Mock EPUB content
      const mockFiles = new Map();
      mockFiles.set('META-INF/container.xml', '<?xml version="1.0"?><container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>');
      mockFiles.set('content.opf', '<?xml version="1.0"?><package><metadata><dc:title>Test Book</dc:title></metadata><spine><itemref idref="ch1"/></spine><manifest><item id="ch1" href="ch1.html"/></manifest></package>');
      mockFiles.set('ch1.html', '<html><body><h1>Chapter 1</h1></body></html>');
      
      const mockZipfile = {
        readEntry: jest.fn(),
        on: jest.fn((event, callback) => {
          if (event === 'entry') {
            // Simulate entries for each file
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
              if (event === 'error') return;
            })
          };
          callback(null, mockStream);
        })
      };

      yauzl.open.mockImplementation((path, options, callback) => {
        callback(null, mockZipfile);
      });

      const response = await request(app)
        .get('/epub-preview?path=test.epub');
        
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('metadata');
    });

    test('should reject non-EPUB files', async () => {
      await request(app)
        .get('/epub-preview?path=test.txt')
        .expect(400);
    });
  });
});