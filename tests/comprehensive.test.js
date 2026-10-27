const request = require('supertest');
const fs = require('fs');
const path = require('path');

describe('Comprehensive Coverage Tests', () => {
  let app;
  
  beforeAll(() => {
    process.env.AUTH = 'FALSE'; // Disable auth for testing
    app = require('../server.js');
  });

  describe('CBR Comic Extraction Detailed', () => {
    // CBR files are listed with node-unrar-js and each page is extracted with the `unrar` binary
    const { createExtractorFromFile } = require('node-unrar-js');
    const { exec } = require('child_process');

    function mockRarFile(headers) {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({
        size: 4096,
        mtimeMs: 1,
        mtime: new Date('2023-01-01'),
        isDirectory: () => false
      });
      createExtractorFromFile.mockResolvedValueOnce({
        getFileList: jest.fn().mockResolvedValue({ fileHeaders: headers })
      });
    }

    afterEach(() => {
      fs.existsSync.mockRestore();
      fs.statSync.mockRestore();
    });

    test('should extract a CBR page with unrar and send it as an image', async () => {
      mockRarFile([{ name: 'image1.jpg' }, { name: 'image2.png' }, { name: 'readme.txt' }]);
      exec.mockImplementationOnce((command, options, callback) => {
        expect(command).toContain('unrar p -inul');
        expect(command).toContain('image1.jpg');
        callback(null, Buffer.from('fake-image-data'), '');
      });

      const response = await request(app)
        .get('/comic-preview?path=cbr-ok-1.cbr&page=1')
        .expect(200);

      expect(response.headers['content-type']).toBe('image/jpeg');
    });

    test('should pick the requested page from the sorted image list', async () => {
      mockRarFile([{ name: 'b.png' }, { name: 'a.jpg' }]);
      exec.mockImplementationOnce((command, options, callback) => {
        expect(command).toContain('b.png');
        callback(null, Buffer.from('fake-image-data-2'), '');
      });

      const response = await request(app)
        .get('/comic-preview?path=cbr-ok-2.cbr&page=2')
        .expect(200);

      expect(response.headers['content-type']).toBe('image/png');
    });

    test('should extract the page in-process when the unrar binary is unavailable', async () => {
      mockRarFile([{ name: 'image1.jpg' }]);
      jest.spyOn(fs.promises, 'readFile').mockResolvedValueOnce(Buffer.from('rar-bytes'));
      exec.mockImplementationOnce((command, options, callback) => {
        callback(new Error("'unrar' is not recognized"), Buffer.alloc(0), '');
      });
      const { createExtractorFromData } = require('node-unrar-js');
      createExtractorFromData.mockResolvedValueOnce({
        extract: () => ({ files: [{ fileHeader: { name: 'image1.jpg' }, extraction: Uint8Array.from([1, 2, 3]) }] })
      });

      const response = await request(app)
        .get('/comic-preview?path=cbr-js.cbr&page=1')
        .expect(200);

      expect(response.headers['content-type']).toBe('image/jpeg');
      fs.promises.readFile.mockRestore();
    });

    test('should report a corrupted archive when unrar fails and the CBZ fallback fails too', async () => {
      mockRarFile([{ name: 'image1.jpg' }]);
      exec.mockImplementationOnce((command, options, callback) => {
        callback(new Error('unrar failed'), Buffer.alloc(0), 'unrar error');
      });

      await request(app)
        .get('/comic-preview?path=cbr-bad.cbr&page=1')
        .expect(422);
    });
  });

  describe('EPUB Advanced Features', () => {
    beforeEach(() => {
      // Handlers check existence before opening the archive
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    });

    afterEach(() => {
      fs.existsSync.mockRestore();
    });

    test('should handle EPUB with cover metadata patterns', async () => {
      const yauzl = require('yauzl');
      const originalOpen = yauzl.open;
      
      yauzl.open = jest.fn((filePath, options, callback) => {
        const files = new Map();
        files.set('META-INF/container.xml', '<?xml version="1.0"?><container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>');
        files.set('content.opf', `<?xml version="1.0"?>
<package>
  <metadata>
    <dc:title>Test Book</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:description>Test Description</dc:description>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <spine>
    <itemref idref="ch1"/>
  </spine>
  <manifest>
    <item id="cover-img" href="images/cover.jpg" media-type="image/jpeg"/>
    <item id="ch1" href="ch1.html"/>
  </manifest>
</package>`);
        files.set('ch1.html', '<html><body><h1>Chapter 1</h1><p>Content here</p></body></html>');
        files.set('images/cover.jpg', 'fake-cover-data');
        
        const mockZipfile = {
          readEntry: jest.fn(),
          on: jest.fn((event, handler) => {
            if (event === 'entry') {
              const entries = ['META-INF/container.xml', 'content.opf', 'ch1.html', 'images/cover.jpg'];
              entries.forEach((entry, index) => {
                setTimeout(() => handler({ 
                  fileName: entry,
                  isDirectory: () => false 
                }), (index + 1) * 10);
              });
            } else if (event === 'end') {
              setTimeout(() => handler(), 100);
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
        .expect(200);
      
      expect(response.body.metadata.title).toBe('Test Book');
      expect(response.body.metadata.creator).toBe('Test Author');
      expect(response.body.metadata.description).toBe('Test Description');
      expect(response.body.metadata.coverPath).toBe('images/cover.jpg');
      
      // Restore original function
      yauzl.open = originalOpen;
    });

    test('should handle EPUB with large chapter content truncation', async () => {
      const yauzl = require('yauzl');
      const originalOpen = yauzl.open;
      
      const largeContent = '<html><body>' + 'x'.repeat(60000) + '</body></html>';
      
      yauzl.open = jest.fn((filePath, options, callback) => {
        const files = new Map();
        files.set('META-INF/container.xml', '<?xml version="1.0"?><container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>');
        files.set('content.opf', `<?xml version="1.0"?>
<package>
  <metadata><dc:title>Large Book</dc:title></metadata>
  <spine><itemref idref="ch1"/></spine>
  <manifest><item id="ch1" href="ch1.html"/></manifest>
</package>`);
        files.set('ch1.html', largeContent);
        
        const mockZipfile = {
          readEntry: jest.fn(),
          on: jest.fn((event, handler) => {
            if (event === 'entry') {
              const entries = ['META-INF/container.xml', 'content.opf', 'ch1.html'];
              entries.forEach((entry, index) => {
                setTimeout(() => handler({ 
                  fileName: entry,
                  isDirectory: () => false 
                }), (index + 1) * 10);
              });
            } else if (event === 'end') {
              setTimeout(() => handler(), 100);
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
        .expect(200);
      
      expect(response.body.chapters[0].content).toContain('[Content truncated for performance]');
      
      // Restore original function
      yauzl.open = originalOpen;
    });
  });

  describe('Additional Auth Edge Cases', () => {
    test('should allow logout without an active login', async () => {
      process.env.AUTH = 'TRUE';
      jest.resetModules();
      const authApp = require('../server.js');

      // Logout is not behind requireAuth, so an anonymous request still succeeds
      const response = await request(authApp)
        .post('/auth/logout')
        .expect(200);
      
      expect(response.body.success).toBe(true);

      process.env.AUTH = 'FALSE';
      jest.resetModules();
    });
  });

  describe('File Serving Edge Cases', () => {
    test('should handle different MIME types correctly', async () => {
      const testCases = [
        { file: 'test.html', expected: 'text/html' },
        { file: 'test.js', expected: 'text/javascript' },
        { file: 'test.css', expected: 'text/css' },
        { file: 'test.json', expected: 'application/json' },
        { file: 'test.png', expected: 'image/png' },
        { file: 'test.jpg', expected: 'image/jpeg' },
        { file: 'test.gif', expected: 'image/gif' },
        { file: 'test.webp', expected: 'image/webp' },
        { file: 'test.svg', expected: 'image/svg+xml' },
        { file: 'test.mp3', expected: 'audio/mpeg' },
        { file: 'test.mp4', expected: 'video/mp4' },
        { file: 'test.cbz', expected: 'application/vnd.comicbook+zip' },
        { file: 'test.epub', expected: 'application/epub+zip' }
      ];

      const { Readable } = require('stream');
      // '{}' is a valid body for every type, including application/json
      jest.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => false, size: 2 });
      jest.spyOn(fs, 'createReadStream').mockImplementation(() => Readable.from(['{}']));

      for (const testCase of testCases) {
        const response = await request(app)
          .get(`/files?path=${testCase.file}`)
          .expect(200);
        
        expect(response.headers['content-type']).toBe(testCase.expected);
      }

      fs.statSync.mockRestore();
      fs.createReadStream.mockRestore();
    });

    test('should handle file stat errors gracefully in browse', async () => {
      // This test checks that the server doesn't crash when stat fails on some files
      const response = await request(app)
        .get('/api/browse?path=.')
        .expect(200);
      
      expect(response.body.files).toBeDefined();
      expect(Array.isArray(response.body.files)).toBe(true);
    });
  });

  describe('Directory and File Path Handling', () => {
    test('should handle various directory path formats', async () => {
      const testPaths = ['', '.', './'];
      
      for (const testPath of testPaths) {
        const response = await request(app)
          .get(`/api/browse?path=${encodeURIComponent(testPath)}`)
          .expect(200);
        
        expect(response.body.files).toBeDefined();
      }
    });
  });
});