const request = require('supertest');
const fs = require('fs');

describe('EPUB Tests', () => {
  let app;

  beforeAll(() => {
    process.env.AUTH = 'FALSE';
    app = require('../server.js');
  });

  describe('GET /epub-cover', () => {
    test('should require file path parameter', async () => {
      const response = await request(app)
        .get('/epub-cover')
        .expect(400);

      expect(response.body.error).toBe('Missing file path');
    });

    test('should handle EPUB file opening errors', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      const yauzl = require('yauzl');
      yauzl.open = jest.fn((filePath, options, callback) => {
        callback(new Error('Failed to open EPUB'));
      });

      const response = await request(app)
        .get('/epub-cover?path=test.epub&cover=images/cover.jpg')
        .expect(500);

      expect(response.body.error).toBeDefined();
    });

    test('should return 404 when cover image not found', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      const yauzl = require('yauzl');
      yauzl.open = jest.fn((filePath, options, callback) => {
        const mockZipfile = {
          readEntry: jest.fn(),
          on: jest.fn((event, handler) => {
            if (event === 'entry') {
              setTimeout(() => handler({ fileName: 'content.opf' }));
              setTimeout(() => handler({ fileName: 'chapter1.html' }));
            } else if (event === 'end') {
              setTimeout(() => handler());
            }
          }),
          openReadStream: jest.fn()
        };
        callback(null, mockZipfile);
      });

      const response = await request(app)
        .get('/epub-cover?path=test.epub&cover=images/cover.jpg')
        .expect(404);

      expect(response.body.error).toBe('Cover image not found');
    }, 10000);
  });

  describe('GET /images/:filename', () => {
    test('should return 404 as images endpoint is a placeholder', async () => {
      const response = await request(app)
        .get('/images/cover.jpg')
        .expect(404);

      expect(response.body.error).toBe('Image endpoint not fully implemented yet');
    });
  });

  describe('GET /cover.jpeg and /cover.jpg', () => {
    test('should return 404 for cover.jpeg', async () => {
      const response = await request(app)
        .get('/cover.jpeg')
        .expect(404);

      expect(response.body.error).toContain('Cover image not found');
    });

    test('should return 404 for cover.jpg', async () => {
      const response = await request(app)
        .get('/cover.jpg')
        .expect(404);

      expect(response.body.error).toContain('Cover image not found');
    });
  });

  describe('EPUB Content Extraction Edge Cases', () => {
    test('should handle EPUB with missing container.xml', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      const yauzl = require('yauzl');
      yauzl.open = jest.fn((filePath, options, callback) => {
        const mockZipfile = {
          readEntry: jest.fn(),
          on: jest.fn((event, handler) => {
            if (event === 'entry') {
              setTimeout(() => handler({ fileName: 'content.opf' }));
            } else if (event === 'end') {
              setTimeout(() => handler());
            }
          }),
          openReadStream: jest.fn()
        };
        callback(null, mockZipfile);
      });

      const response = await request(app)
        .get('/epub-preview?path=test.epub')
        .expect(500);

      expect(response.body.error).toContain('Missing container.xml');
    }, 15000);

    test('should handle EPUB with missing OPF file', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      const yauzl = require('yauzl');
      yauzl.open = jest.fn((filePath, options, callback) => {
        const files = new Map();
        files.set('META-INF/container.xml', '<?xml version="1.0"?><container><rootfiles><rootfile full-path="missing.opf"/></rootfiles></container>');

        let entryIndex = 0;
        const mockZipfile = {
          readEntry: jest.fn(),
          on: jest.fn((event, handler) => {
            if (event === 'entry') {
              setTimeout(() => {
                entryIndex++;
                handler({
                  fileName: 'META-INF/container.xml',
                  isDirectory: () => false
                });
              }, 5);
            } else if (event === 'end') {
              setTimeout(() => handler(), 100);
            }
            return mockZipfile;
          }),
          openReadStream: jest.fn((entry, callback) => {
            const content = files.get(entry.fileName);
            const mockStream = {
              on: jest.fn((event, handler) => {
                if (event === 'data') {
                  setTimeout(() => handler(Buffer.from(content)), 1);
                } else if (event === 'end') {
                  setTimeout(() => handler(), 2);
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
    }, 15000);

    test('should handle EPUB with no readable chapters', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      const yauzl = require('yauzl');
      yauzl.open = jest.fn((filePath, options, callback) => {
        const files = new Map();
        files.set('META-INF/container.xml', '<?xml version="1.0"?><container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>');
        files.set('content.opf', '<?xml version="1.0"?><package><metadata><dc:title>Test</dc:title></metadata><spine></spine><manifest></manifest></package>');

        const fileNames = ['META-INF/container.xml', 'content.opf'];
        const mockZipfile = {
          readEntry: jest.fn(),
          on: jest.fn((event, handler) => {
            if (event === 'entry') {
              fileNames.forEach((name, i) => {
                setTimeout(() => handler({
                  fileName: name,
                  isDirectory: () => false
                }), (i + 1) * 10);
              });
            } else if (event === 'end') {
              setTimeout(() => handler(), 100);
            }
            return mockZipfile;
          }),
          openReadStream: jest.fn((entry, callback) => {
            const content = files.get(entry.fileName);
            const mockStream = {
              on: jest.fn((event, handler) => {
                if (event === 'data') {
                  setTimeout(() => handler(Buffer.from(content)), 1);
                } else if (event === 'end') {
                  setTimeout(() => handler(), 2);
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
    }, 15000);
  });
});
