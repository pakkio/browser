const request = require('supertest');
const fs = require('fs');

jest.mock('node-unrar-js', () => ({
  createExtractorFromFile: jest.fn()
}));

describe('Integration Tests', () => {
  let app;

  beforeAll(() => {
    process.env.AUTH = 'FALSE';
    delete require.cache[require.resolve('../lib/config.js')];
    app = require('../server');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('File Browser Workflow', () => {
    test('should browse directory and serve files', async () => {
      jest.spyOn(fs.promises, 'readdir').mockResolvedValue([
        { name: 'test.txt', isDirectory: () => false },
        { name: 'folder', isDirectory: () => true }
      ]);
      jest.spyOn(fs.promises, 'stat').mockResolvedValue({
        size: 1024,
        mtime: new Date('2023-01-01'),
        isDirectory: () => false
      });

      const mockStream = {
        on: jest.fn((event, callback) => {
          if (event === 'error') return;
        }),
        pipe: jest.fn((res) => {
          res.end('test content');
        })
      };

      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({
        size: 1024,
        mtime: new Date('2023-01-01'),
        isDirectory: () => false
      });
      jest.spyOn(fs, 'createReadStream').mockReturnValue(mockStream);

      const browseResponse = await request(app)
        .get('/api/browse')
        .expect(200);

      expect(browseResponse.body.files).toBeDefined();
      expect(Array.isArray(browseResponse.body.files)).toBe(true);
    });

    test('should handle complete PDF workflow', async () => {
      const { exec } = require('child_process');
      const pdf2pic = require('pdf2pic');

      exec.mockImplementation((command, callback) => {
        if (command.includes('pdfinfo')) {
          callback(null, 'Pages: 5\nCreator: Test', '');
        }
      });

      const mockConvert = jest.fn().mockResolvedValue({
        base64: 'base64encodedimage'
      });
      pdf2pic.fromPath = jest.fn(() => mockConvert);

      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      const infoResponse = await request(app)
        .get('/api/pdf-info?path=test.pdf')
        .expect(200);

      expect(infoResponse.body.pages).toBe(5);

      const previewResponse = await request(app)
        .get('/pdf-preview?path=test.pdf&page=1')
        .expect(200);

      expect(mockConvert).toHaveBeenCalledWith(1, { responseType: "base64" });
    });

    test('should handle complete comic workflow', async () => {
      const yauzl = require('yauzl');

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

      yauzl.open = jest.fn((path, options, callback) => {
        callback(null, mockZipfile);
      });

      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from([0x50, 0x4B, 0x03]));

      const response = await request(app)
        .get('/comic-preview?path=test.cbz&page=1');

      expect(response.status).toBe(200);
    });

    test('should handle complete EPUB workflow', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      const yauzl = require('yauzl');
      const mockFiles = new Map();
      mockFiles.set('META-INF/container.xml',
        '<?xml version="1.0"?><container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>');
      mockFiles.set('content.opf',
        '<?xml version="1.0"?><package><metadata><dc:title>Test Book</dc:title></metadata><spine><itemref idref="ch1"/></spine><manifest><item id="ch1" href="ch1.html"/></manifest></package>');
      mockFiles.set('ch1.html',
        '<html><body><h1>Chapter 1</h1><p>Test content</p></body></html>');

      yauzl.open = jest.fn((path, options, callback) => {
        const mockZipfile = {
          readEntry: jest.fn(),
          on: jest.fn((event, handler) => {
            if (event === 'entry') {
              Array.from(mockFiles.keys()).forEach(fileName => {
                handler({ fileName });
              });
            } else if (event === 'end') {
              handler();
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
        callback(null, mockZipfile);
      });

      const response = await request(app)
        .get('/epub-preview?path=test.epub');

      expect(response.status).toBe(200);
      if (response.status === 200) {
        expect(response.body).toHaveProperty('metadata');
      }
    });
  });

  describe('Error Handling Integration', () => {
    test('should handle PDF info errors', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      const { exec } = require('child_process');
      exec.mockImplementation((command, callback) => {
        callback(new Error('Invalid PDF'), '', 'Error reading PDF');
      });

      await request(app)
        .get('/api/pdf-info?path=invalid.pdf')
        .expect(500);
    });
  });

  describe('Security Integration', () => {
    test('should prevent path traversal in browse', async () => {
      const response = await request(app)
        .get('/api/browse?path=../../../etc/passwd');
      expect(response.status).toBe(403);
    });

    test('should prevent path traversal in files', async () => {
      const response = await request(app)
        .get('/files?path=../../../etc/passwd');
      expect(response.status).toBe(403);
    });

    test('should handle absolute paths in files', async () => {
      const response = await request(app)
        .get('/files?path=/etc/passwd');
      expect([403, 404, 500]).toContain(response.status);
    });
  });

  describe('Performance Integration', () => {
    test('should handle concurrent requests', async () => {
      jest.spyOn(fs.promises, 'readdir').mockResolvedValue([
        { name: 'test.txt', isDirectory: () => false }
      ]);
      jest.spyOn(fs.promises, 'stat').mockResolvedValue({
        size: 1024,
        mtime: new Date(),
        isDirectory: () => false
      });

      const requests = Array(5).fill(null).map(() =>
        request(app).get('/api/browse').expect(200)
      );

      const responses = await Promise.all(requests);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.files).toBeDefined();
      });
    });
  });
});
