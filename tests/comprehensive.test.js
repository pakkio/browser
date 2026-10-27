const request = require('supertest');
const fs = require('fs');

jest.mock('node-unrar-js', () => ({
  createExtractorFromFile: jest.fn()
}));

function defaultExecMock(cmd, opts, cb) {
  if (typeof opts === 'function') { cb = opts; }
  if (cmd && cmd.startsWith('pdfinfo')) {
    return cb && cb(null, 'Title: Mock PDF\nPages: 3\n', '');
  }
  return cb && cb(null, '', '');
}

describe('Comprehensive Coverage Tests', () => {
  let app;

  beforeAll(() => {
    process.env.AUTH = 'FALSE';
    delete require.cache[require.resolve('../lib/config.js')];
    app = require('../server.js');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('CBR Comic Extraction', () => {
    beforeEach(() => {
      const { exec } = require('child_process');
      exec.mockImplementation(defaultExecMock);
    });

    test('should handle CBR extraction with fileHeaders array', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024, isDirectory: () => false });
      jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07]));

      const nodeUnrar = require('node-unrar-js');
      nodeUnrar.createExtractorFromFile.mockResolvedValue({
        getFileList: jest.fn().mockResolvedValue({
          fileHeaders: [
            { name: 'image1.jpg' },
            { name: 'image2.png' }
          ]
        }),
        extract: jest.fn().mockResolvedValue({
          files: [{ extraction: Buffer.from('fake-image-data') }]
        })
      });

      const { exec } = require('child_process');
      exec.mockImplementation((cmd, opts, cb) => {
        if (typeof opts === 'function') { cb = opts; }
        if (cmd.includes('unrar p')) {
          return cb(null, Buffer.from('fake-image-data'), '');
        }
        return defaultExecMock(cmd, opts, cb);
      });

      const response = await request(app)
        .get('/comic-preview?path=test.cbr&page=1')
        .expect(200);

      expect(response.headers['content-type']).toContain('image');
    });

    test('should handle CBR extraction with fileData property', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024, isDirectory: () => false });
      jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07]));

      const nodeUnrar = require('node-unrar-js');
      nodeUnrar.createExtractorFromFile.mockResolvedValue({
        getFileList: jest.fn().mockResolvedValue({
          fileHeaders: [{ name: 'image1.jpg' }]
        }),
        extract: jest.fn().mockResolvedValue({
          files: [{ fileData: Buffer.from('fake-image-data-2') }]
        })
      });

      const { exec } = require('child_process');
      exec.mockImplementation((cmd, opts, cb) => {
        if (typeof opts === 'function') { cb = opts; }
        if (cmd.includes('unrar p')) {
          return cb(null, Buffer.from('fake-image-data'), '');
        }
        return defaultExecMock(cmd, opts, cb);
      });

      const response = await request(app)
        .get('/comic-preview?path=test.cbr&page=1')
        .expect(200);

      expect(response.headers['content-type']).toContain('image');
    });

    test('should handle CBR extraction errors gracefully', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024, isDirectory: () => false });
      jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07]));

      const nodeUnrar = require('node-unrar-js');
      nodeUnrar.createExtractorFromFile.mockRejectedValue(
        new Error('File is not RAR archive')
      );

      await request(app)
        .get('/comic-preview?path=test.cbr&page=1')
        .expect(422);
    });
  });

  describe('EPUB Advanced Features', () => {
    test('should handle EPUB with cover metadata patterns', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      const yauzl = require('yauzl');
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

      yauzl.open = jest.fn((filePath, options, callback) => {
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
    }, 15000);

    test('should handle EPUB with large chapter content truncation', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      const yauzl = require('yauzl');
      const largeContent = '<html><body>' + 'x'.repeat(60000) + '</body></html>';

      const files = new Map();
      files.set('META-INF/container.xml', '<?xml version="1.0"?><container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>');
      files.set('content.opf', `<?xml version="1.0"?>
<package>
  <metadata><dc:title>Large Book</dc:title></metadata>
  <spine><itemref idref="ch1"/></spine>
  <manifest><item id="ch1" href="ch1.html"/></manifest>
</package>`);
      files.set('ch1.html', largeContent);

      yauzl.open = jest.fn((filePath, options, callback) => {
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
    }, 15000);
  });

  describe('Additional Auth Edge Cases', () => {
    test('should handle logout when auth is disabled', async () => {
      const response = await request(app)
        .post('/auth/logout')
        .expect(404);

      expect(response.body.error).toBe('Authentication is disabled');
    });

    test('should return auth status when auth is disabled', async () => {
      const response = await request(app)
        .get('/auth/user')
        .expect(200);

      expect(response.body.authDisabled).toBe(true);
      expect(response.body.authenticated).toBe(false);
    });
  });

  describe('File Serving Edge Cases', () => {
    test('should handle different MIME types correctly', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      const content = 'test content';
      jest.spyOn(fs, 'statSync').mockReturnValue({
        isDirectory: () => false,
        size: Buffer.byteLength(content)
      });
      jest.spyOn(fs, 'createReadStream').mockImplementation(() => {
        const { Readable } = require('stream');
        const stream = new Readable({ read() {} });
        stream.push(content);
        stream.push(null);
        return stream;
      });

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

      for (const testCase of testCases) {
        const res = await request(app)
          .get(`/files?path=${testCase.file}`)
          .buffer(true)
          .parse((res, cb) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => cb(null, data));
          });

        expect(res.status).toBe(200);
        const ct = res.headers['content-type'];
        expect(ct).toBe(testCase.expected);
      }
    });
  });

  describe('Request Logging Coverage', () => {
    test('should handle /auth/user endpoint', async () => {
      const response = await request(app)
        .get('/auth/user')
        .expect(200);

      expect(response.body.authDisabled).toBe(true);
    });

    test('should return 400 for /files without path', async () => {
      await request(app)
        .get('/files')
        .expect(400);
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
