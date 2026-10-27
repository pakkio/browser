const request = require('supertest');
const fs = require('fs');
const path = require('path');

describe('EPUB Tests', () => {
  let app;
  
  beforeAll(() => {
    process.env.AUTH = 'FALSE'; // Disable auth for testing
    app = require('../server.js');
  });

  beforeEach(() => {
    // Handlers check existence first; anything not named "nonexistent*" exists
    const realExists = fs.existsSync;
    jest.spyOn(fs, 'existsSync').mockImplementation((p) =>
      String(p).includes('nonexistent') ? false : (String(p).endsWith('.epub') ? true : realExists(p)));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /epub-cover', () => {
    test('should require a file path', async () => {
      const response = await request(app)
        .get('/epub-cover')
        .expect(400);
      
      expect(response.body.error).toBe('Missing file path');
    });

    test('should return 404 when the EPUB does not exist', async () => {
      const response = await request(app)
        .get('/epub-cover?path=nonexistent.epub&cover=images/cover.jpg')
        .expect(404);
      
      expect(response.body.error).toBe('File not found');
    });

    test('should handle EPUB file opening errors', async () => {
      const yauzl = require('yauzl');
      const originalOpen = yauzl.open;
      yauzl.open = jest.fn((filePath, options, callback) => callback(new Error('bad zip')));

      const response = await request(app)
        .get('/epub-cover?path=test.epub&cover=images/cover.jpg')
        .expect(500);
      
      expect(response.body.error).toBe('bad zip');
      yauzl.open = originalOpen;
    });

    test('should return 404 when cover image not found', async () => {
      // Mock yauzl to simulate EPUB without cover
      const yauzl = require('yauzl');
      const originalOpen = yauzl.open;
      
      yauzl.open = jest.fn((filePath, options, callback) => {
        const mockZipfile = {
          readEntry: jest.fn(),
          on: jest.fn((event, handler) => {
            if (event === 'entry') {
              // Simulate some entries but not the cover
              setImmediate(() => handler({ fileName: 'content.opf' }));
              setImmediate(() => handler({ fileName: 'chapter1.html' }));
            } else if (event === 'end') {
              setImmediate(() => handler());
            }
          })
        };
        callback(null, mockZipfile);
      });

      const response = await request(app)
        .get('/epub-cover?path=test.epub&cover=images/cover.jpg')
        .expect(404);
        
      expect(response.body.error).toBe('Cover image not found');
      expect(response.body.requestedPath).toBe('images/cover.jpg');
      
      // Restore original function
      yauzl.open = originalOpen;
    }, 10000);
  });

  describe('GET /images/:filename', () => {
    // The endpoint is still a placeholder; image serving goes through /epub-cover
    test('should return 404 placeholder response', async () => {
      const response = await request(app)
        .get('/images/cover.jpg?epub=test.epub')
        .expect(404);
      
      expect(response.body.error).toBe('Image endpoint not fully implemented yet');
    });
  });

  describe('GET /cover.jpeg and /cover.jpg', () => {
    test.each(['/cover.jpeg', '/cover.jpg'])('%s should 404 and point to /epub-cover', async (url) => {
      const response = await request(app)
        .get(url)
        .set('Referer', 'http://localhost:3000/epub-preview?path=test.epub')
        .expect(404);
      
      expect(response.body.error).toContain('/epub-cover');
    });
  });

  describe('EPUB Content Extraction Edge Cases', () => {
    const containerXml = (opf) =>
      `<?xml version="1.0"?><container><rootfiles><rootfile full-path="${opf}"/></rootfiles></container>`;

    // Minimal lazy-entries yauzl stand-in: each readEntry() emits the next entry or 'end'
    function mockEpub(files) {
      const yauzl = require('yauzl');
      const originalOpen = yauzl.open;
      yauzl.open = jest.fn((filePath, options, callback) => {
        const names = Array.from(files.keys());
        const handlers = {};
        let index = 0;
        const zipfile = {
          on: (event, handler) => { handlers[event] = handler; },
          readEntry: () => {
            setImmediate(() => {
              if (index < names.length) handlers.entry({ fileName: names[index++] });
              else handlers.end();
            });
          },
          openReadStream: (entry, cb) => {
            const content = Buffer.from(files.get(entry.fileName));
            const stream = {
              on: (event, handler) => {
                if (event === 'data') setImmediate(() => handler(content));
                if (event === 'end') setImmediate(() => setImmediate(handler));
              }
            };
            cb(null, stream);
          }
        };
        callback(null, zipfile);
      });
      return () => { yauzl.open = originalOpen; };
    }

    test('should handle EPUB with missing container.xml', async () => {
      const restore = mockEpub(new Map([['content.opf', '<package/>']]));

      const response = await request(app)
        .get('/epub-preview?path=test.epub')
        .expect(500);
      
      expect(response.body.error).toContain('Missing container.xml');
      restore();
    }, 15000);

    test('should handle EPUB with missing OPF file', async () => {
      const restore = mockEpub(new Map([['META-INF/container.xml', containerXml('missing.opf')]]));

      const response = await request(app)
        .get('/epub-preview?path=test.epub')
        .expect(500);
      
      expect(response.body.error).toContain('Could not find OPF file');
      restore();
    }, 15000);

    test('should handle EPUB with no readable chapters', async () => {
      const restore = mockEpub(new Map([
        ['META-INF/container.xml', containerXml('content.opf')],
        ['content.opf', '<?xml version="1.0"?><package><metadata><dc:title>Test</dc:title></metadata><spine></spine><manifest></manifest></package>']
      ]));

      const response = await request(app)
        .get('/epub-preview?path=test.epub')
        .expect(500);
      
      expect(response.body.error).toContain('No readable chapters found');
      restore();
    }, 15000);
  });
});
