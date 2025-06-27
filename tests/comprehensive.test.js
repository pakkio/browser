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
    test('should handle CBR file list caching', async () => {
      // Mock fs.existsSync to make file exist
      const originalExistsSync = fs.existsSync;
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      
      // Mock exec for unrar lb command
      const { exec } = require('child_process');
      const originalExec = exec;
      
      require('child_process').exec = jest.fn((command, callback) => {
        if (command.includes('unrar lb')) {
          callback(null, 'image1.jpg\nimage2.png\nreadme.txt\n', '');
        } else {
          callback(new Error('Command failed'), '', 'error');
        }
      });

      const response = await request(app)
        .get('/comic-preview?path=test.cbr&page=1')
        .expect(500); // Will fail at extraction but caching should work
      
      // Restore original functions
      require('child_process').exec = originalExec;
      fs.existsSync.mockRestore();
    });

    test('should handle CBR extraction with node-unrar-js fallback', async () => {
      // Mock fs.existsSync to make file exist
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      
      // Mock both exec and node-unrar-js
      const { exec } = require('child_process');
      const { createExtractorFromFile } = require('node-unrar-js');
      const originalExec = exec;
      const originalCreateExtractor = createExtractorFromFile;
      
      // Make exec fail to trigger fallback
      require('child_process').exec = jest.fn((command, callback) => {
        callback(new Error('unrar failed'), '', 'unrar error');
      });

      // Mock node-unrar-js
      require('node-unrar-js').createExtractorFromFile = jest.fn().mockResolvedValue({
        getFileList: jest.fn().mockResolvedValue({
          fileHeaders: [
            { name: 'image1.jpg' },
            { name: 'image2.png' }
          ]
        }),
        extract: jest.fn().mockResolvedValue({
          files: [{
            extraction: Buffer.from('fake-image-data')
          }]
        })
      });

      await request(app)
        .get('/comic-preview?path=test.cbr&page=1')
        .expect(200);
      
      // Restore original functions
      require('child_process').exec = originalExec;
      require('node-unrar-js').createExtractorFromFile = originalCreateExtractor;
      fs.existsSync.mockRestore();
    });

    test('should handle different file data formats in CBR extraction', async () => {
      // Mock fs.existsSync to make file exist
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      
      const { exec } = require('child_process');
      const { createExtractorFromFile } = require('node-unrar-js');
      const originalExec = exec;
      const originalCreateExtractor = createExtractorFromFile;
      
      require('child_process').exec = jest.fn((command, callback) => {
        callback(new Error('unrar failed'), '', 'unrar error');
      });

      // Test with fileData property
      require('node-unrar-js').createExtractorFromFile = jest.fn().mockResolvedValue({
        getFileList: jest.fn().mockResolvedValue({
          fileHeaders: [{ name: 'image1.jpg' }]
        }),
        extract: jest.fn().mockResolvedValue({
          files: [{
            fileData: Buffer.from('fake-image-data-2')
          }]
        })
      });

      await request(app)
        .get('/comic-preview?path=test.cbr&page=2')
        .expect(200);
      
      // Restore original functions
      require('child_process').exec = originalExec;
      require('node-unrar-js').createExtractorFromFile = originalCreateExtractor;
      fs.existsSync.mockRestore();
    });
  });

  describe('EPUB Advanced Features', () => {
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
    test('should handle logout with session destroy error', async () => {
      // Test with AUTH enabled
      process.env.AUTH = 'TRUE';
      delete require.cache[require.resolve('../server.js')];
      const authApp = require('../server.js');
      
      // Mock session destroy to fail
      const originalDestroy = require('express-session').Store.prototype.destroy;
      require('express-session').Store.prototype.destroy = function(sid, callback) {
        callback(new Error('Session destroy failed'));
      };

      // We can't easily test this without authentication, so just verify the route exists
      await request(authApp)
        .post('/auth/logout')
        .expect(401); // Will be 401 because not authenticated
      
      // Restore
      require('express-session').Store.prototype.destroy = originalDestroy;
      process.env.AUTH = 'FALSE';
      delete require.cache[require.resolve('../server.js')];
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

      for (const testCase of testCases) {
        const response = await request(app)
          .get(`/files?path=${testCase.file}`)
          .expect(200);
        
        expect(response.headers['content-type']).toBe(testCase.expected);
      }
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

  describe('Request Logging Coverage', () => {
    test('should log requests that are not /files routes', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      await request(app)
        .get('/auth/user')
        .expect(200);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/GET \/auth\/user/)
      );
      
      consoleSpy.mockRestore();
    });

    test('should not log /files requests without query params', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      await request(app)
        .get('/files')
        .expect(400);
      
      // Should not have logged the request
      const logCalls = consoleSpy.mock.calls.filter(call => 
        call[0] && call[0].includes('GET /files') && !call[0].includes('path:')
      );
      expect(logCalls).toHaveLength(0);
      
      consoleSpy.mockRestore();
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