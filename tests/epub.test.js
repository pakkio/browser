const request = require('supertest');
const fs = require('fs');
const path = require('path');

describe('EPUB Tests', () => {
  let app;
  
  beforeAll(() => {
    process.env.AUTH = 'FALSE'; // Disable auth for testing
    app = require('../server.js');
  });

  describe('GET /epub-cover', () => {
    test('should require both file path and cover path parameters', async () => {
      const response = await request(app)
        .get('/epub-cover')
        .expect(400);
      
      expect(response.body.error).toBe('Missing file path or cover path');
    });

    test('should require cover path parameter', async () => {
      const response = await request(app)
        .get('/epub-cover?path=test.epub')
        .expect(400);
      
      expect(response.body.error).toBe('Missing file path or cover path');
    });

    test('should handle EPUB file opening errors', async () => {
      const response = await request(app)
        .get('/epub-cover?path=nonexistent.epub&cover=images/cover.jpg')
        .expect(500);
      
      expect(response.body.error).toBeDefined();
    });

    test('should return 404 when cover image not found', (done) => {
      // Mock yauzl to simulate EPUB without cover
      const yauzl = require('yauzl');
      const originalOpen = yauzl.open;
      
      yauzl.open = jest.fn((filePath, options, callback) => {
        const mockZipfile = {
          readEntry: jest.fn(),
          on: jest.fn((event, handler) => {
            if (event === 'entry') {
              // Simulate some entries but not the cover
              setTimeout(() => handler({ fileName: 'content.opf' }), 10);
              setTimeout(() => handler({ fileName: 'chapter1.html' }), 20);
            } else if (event === 'end') {
              setTimeout(() => handler(), 30);
            }
          })
        };
        callback(null, mockZipfile);
      });

      request(app)
        .get('/epub-cover?path=test.epub&cover=images/cover.jpg')
        .expect(404)
        .end((err, res) => {
          if (err) return done(err);
          expect(res.body.error).toBe('Cover image not found');
          expect(res.body.requestedPath).toBe('images/cover.jpg');
          
          // Restore original function
          yauzl.open = originalOpen;
          done();
        });
    });
  });

  describe('GET /images/:filename', () => {
    test('should require EPUB path parameter', async () => {
      const response = await request(app)
        .get('/images/cover.jpg')
        .expect(400);
      
      expect(response.body.error).toBe('EPUB path required');
    });

    test('should validate EPUB file path', async () => {
      const response = await request(app)
        .get('/images/cover.jpg?epub=../../../etc/passwd')
        .expect(403);
      
      expect(response.body.error).toBe('Invalid EPUB path');
    });

    test('should reject non-EPUB files', async () => {
      const response = await request(app)
        .get('/images/cover.jpg?epub=test.txt')
        .expect(403);
      
      expect(response.body.error).toBe('Invalid EPUB path');
    });

    test('should handle EPUB opening errors', async () => {
      const response = await request(app)
        .get('/images/cover.jpg?epub=nonexistent.epub')
        .expect(500);
      
      expect(response.body.error).toBeDefined();
    });

    test('should return 404 when image not found in EPUB', async () => {
      // Mock yauzl to simulate EPUB without requested image
      const yauzl = require('yauzl');
      const originalOpen = yauzl.open;
      
      yauzl.open = jest.fn((filePath, options, callback) => {
        const mockZipfile = {
          readEntry: jest.fn(),
          on: jest.fn((event, handler) => {
            if (event === 'entry') {
              // Simulate some entries but not the requested image
              setTimeout(() => handler({ fileName: 'content.opf' }), 10);
              setTimeout(() => handler({ fileName: 'other-image.png' }), 20);
            } else if (event === 'end') {
              setTimeout(() => handler(), 30);
            }
          })
        };
        callback(null, mockZipfile);
      });

      const response = await request(app)
        .get('/images/cover.jpg?epub=test.epub')
        .expect(404);
      
      expect(response.body.error).toBe('Image not found in EPUB');
      
      // Restore original function
      yauzl.open = originalOpen;
    });
  });

  describe('GET /cover.jpeg and /cover.jpg', () => {
    test('should redirect to images endpoint when referer contains epub', async () => {
      const response = await request(app)
        .get('/cover.jpeg')
        .set('Referer', 'http://localhost:3000/epub-preview?path=test.epub')
        .expect(302);
      
      expect(response.headers.location).toBe('/images/cover.jpeg');
    });

    test('should return 404 when no epub referer', async () => {
      const response = await request(app)
        .get('/cover.jpeg')
        .expect(404);
      
      expect(response.body.error).toBe('Cover image not found');
    });

    test('should handle cover.jpg requests with epub referer', async () => {
      const response = await request(app)
        .get('/cover.jpg')
        .set('Referer', 'http://localhost:3000/epub-preview?path=test.epub')
        .expect(302);
      
      expect(response.headers.location).toBe('/images/cover.jpg');
    });

    test('should return 404 for cover.jpg without epub referer', async () => {
      const response = await request(app)
        .get('/cover.jpg')
        .expect(404);
      
      expect(response.body.error).toBe('Cover image not found');
    });
  });

  describe('EPUB Content Extraction Edge Cases', () => {
    test('should handle EPUB with missing container.xml', async () => {
      // Mock yauzl to simulate EPUB without container.xml
      const yauzl = require('yauzl');
      const originalOpen = yauzl.open;
      
      yauzl.open = jest.fn((filePath, options, callback) => {
        const mockZipfile = {
          readEntry: jest.fn(),
          on: jest.fn((event, handler) => {
            if (event === 'entry') {
              // Simulate entries without container.xml
              setTimeout(() => handler({ fileName: 'content.opf' }), 10);
            } else if (event === 'end') {
              setTimeout(() => handler(), 20);
            }
          })
        };
        callback(null, mockZipfile);
      });

      const response = await request(app)
        .get('/epub-preview?path=test.epub')
        .expect(500);
      
      expect(response.body.error).toContain('Missing container.xml');
      
      // Restore original function
      yauzl.open = originalOpen;
    });

    test('should handle EPUB with missing OPF file', async () => {
      // Mock yauzl to simulate EPUB with container.xml but missing OPF
      const yauzl = require('yauzl');
      const originalOpen = yauzl.open;
      
      yauzl.open = jest.fn((filePath, options, callback) => {
        const files = new Map();
        files.set('META-INF/container.xml', '<?xml version="1.0"?><container><rootfiles><rootfile full-path="missing.opf"/></rootfiles></container>');
        
        const mockZipfile = {
          readEntry: jest.fn(),
          on: jest.fn((event, handler) => {
            if (event === 'entry') {
              // Only container.xml, no OPF file
              setTimeout(() => handler({ 
                fileName: 'META-INF/container.xml',
                isDirectory: () => false 
              }), 10);
            } else if (event === 'end') {
              setTimeout(() => handler(), 20);
            }
          }),
          openReadStream: jest.fn((entry, callback) => {
            const content = files.get(entry.fileName);
            const mockStream = {
              on: jest.fn((event, handler) => {
                if (event === 'data') {
                  setTimeout(() => handler(Buffer.from(content)), 10);
                } else if (event === 'end') {
                  setTimeout(() => handler(), 20);
                }
              })
            };
            callback(null, mockStream);
          })
        };
        callback(null, mockZipfile);
      });

      const response = await request(app)
        .get('/epub-preview?path=test.epub')
        .expect(500);
      
      expect(response.body.error).toContain('Could not find OPF file');
      
      // Restore original function
      yauzl.open = originalOpen;
    });

    test('should handle EPUB with no readable chapters', async () => {
      // Mock yauzl to simulate EPUB with OPF but no chapters
      const yauzl = require('yauzl');
      const originalOpen = yauzl.open;
      
      yauzl.open = jest.fn((filePath, options, callback) => {
        const files = new Map();
        files.set('META-INF/container.xml', '<?xml version="1.0"?><container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>');
        files.set('content.opf', '<?xml version="1.0"?><package><metadata><dc:title>Test</dc:title></metadata><spine></spine><manifest></manifest></package>');
        
        const mockZipfile = {
          readEntry: jest.fn(),
          on: jest.fn((event, handler) => {
            if (event === 'entry') {
              setTimeout(() => handler({ 
                fileName: 'META-INF/container.xml',
                isDirectory: () => false 
              }), 10);
              setTimeout(() => handler({ 
                fileName: 'content.opf',
                isDirectory: () => false 
              }), 20);
            } else if (event === 'end') {
              setTimeout(() => handler(), 30);
            }
          }),
          openReadStream: jest.fn((entry, callback) => {
            const content = files.get(entry.fileName);
            const mockStream = {
              on: jest.fn((event, handler) => {
                if (event === 'data') {
                  setTimeout(() => handler(Buffer.from(content)), 10);
                } else if (event === 'end') {
                  setTimeout(() => handler(), 20);
                }
              })
            };
            callback(null, mockStream);
          })
        };
        callback(null, mockZipfile);
      });

      const response = await request(app)
        .get('/epub-preview?path=test.epub')
        .expect(500);
      
      expect(response.body.error).toContain('No readable chapters found');
      
      // Restore original function
      yauzl.open = originalOpen;
    });
  });
});