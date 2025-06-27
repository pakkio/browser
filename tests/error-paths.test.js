const request = require('supertest');
const fs = require('fs');
const path = require('path');

describe('Error Path Coverage Tests', () => {
  let app;
  
  beforeAll(() => {
    process.env.AUTH = 'FALSE'; // Disable auth for testing
    app = require('../server.js');
  });

  describe('PDF Info Error Paths', () => {
    test('should handle pdfinfo command not found', async () => {
      // Mock exec to simulate command not found
      const { exec } = require('child_process');
      const originalExec = exec;
      
      // Mock exec for this test
      require('child_process').exec = jest.fn((command, callback) => {
        callback(new Error('Command not found'), '', 'pdfinfo: command not found');
      });

      const response = await request(app)
        .get('/api/pdf-info?path=test.pdf')
        .expect(500);
      
      expect(response.text).toBe('Failed to get PDF info');
      
      // Restore original exec
      require('child_process').exec = originalExec;
    });

    test('should handle invalid PDF info output', async () => {
      // Mock exec to return output without Pages field
      const { exec } = require('child_process');
      const originalExec = exec;
      
      require('child_process').exec = jest.fn((command, callback) => {
        callback(null, 'Title: Test PDF\nAuthor: Test Author', '');
      });

      const response = await request(app)
        .get('/api/pdf-info?path=test.pdf')
        .expect(500);
      
      expect(response.text).toBe('Could not parse PDF info');
      
      // Restore original exec
      require('child_process').exec = originalExec;
    });
  });

  describe('PDF Preview Error Paths', () => {
    test('should handle pdf2pic conversion failure', async () => {
      // Mock pdf2pic to throw error
      const pdf2pic = require('pdf2pic');
      const originalFromPath = pdf2pic.fromPath;
      
      pdf2pic.fromPath = jest.fn(() => ({
        [Symbol.asyncIterator]: async function* () {
          throw new Error('PDF conversion failed');
        },
        // Mock the page conversion method
        '1': () => Promise.reject(new Error('PDF conversion failed'))
      }));

      // Override the conversion function to simulate failure
      const mockConvert = jest.fn().mockRejectedValue(new Error('PDF conversion failed'));
      pdf2pic.fromPath = jest.fn(() => mockConvert);

      const response = await request(app)
        .get('/pdf-preview?path=test.pdf&page=1')
        .expect(500);
      
      expect(response.text).toContain('PDF conversion error');
      
      // Restore original function
      pdf2pic.fromPath = originalFromPath;
    });

    test('should handle empty PDF conversion result', async () => {
      // Mock pdf2pic to return empty result
      const pdf2pic = require('pdf2pic');
      const originalFromPath = pdf2pic.fromPath;
      
      const mockConvert = jest.fn().mockResolvedValue({ base64: '' });
      pdf2pic.fromPath = jest.fn(() => mockConvert);

      const response = await request(app)
        .get('/pdf-preview?path=test.pdf&page=1')
        .expect(500);
      
      expect(response.text).toContain('PDF conversion returned empty result');
      
      // Restore original function
      pdf2pic.fromPath = originalFromPath;
    });
  });

  describe('Comic Archive Error Paths', () => {
    test('should handle CBZ extraction errors', async () => {
      // Mock yauzl to simulate ZIP file error
      const yauzl = require('yauzl');
      const originalOpen = yauzl.open;
      
      yauzl.open = jest.fn((filePath, options, callback) => {
        callback(new Error('Corrupted ZIP file'));
      });

      const response = await request(app)
        .get('/comic-preview?path=test.cbz&page=1')
        .expect(500);
      
      expect(response.text).toContain('Comic extraction error');
      
      // Restore original function
      yauzl.open = originalOpen;
    });

    test('should handle CBZ with no images', async () => {
      // Mock yauzl to simulate ZIP with no image files
      const yauzl = require('yauzl');
      const originalOpen = yauzl.open;
      
      yauzl.open = jest.fn((filePath, options, callback) => {
        const mockZipfile = {
          readEntry: jest.fn(),
          close: jest.fn(),
          on: jest.fn((event, handler) => {
            if (event === 'entry') {
              // Simulate entry with non-image file
              setTimeout(() => handler({ fileName: 'readme.txt' }), 10);
            } else if (event === 'end') {
              setTimeout(() => handler(), 20);
            }
          })
        };
        callback(null, mockZipfile);
      });

      const response = await request(app)
        .get('/comic-preview?path=test.cbz&page=1')
        .expect(500);
      
      expect(response.text).toContain('Page not found');
      
      // Restore original function
      yauzl.open = originalOpen;
    });

    test('should handle CBR unrar command failure', async () => {
      // Mock exec for unrar command failure
      const { exec } = require('child_process');
      const originalExec = exec;
      
      require('child_process').exec = jest.fn((command, callback) => {
        if (command.includes('unrar')) {
          callback(new Error('unrar command failed'), '', 'Archive is corrupted');
        } else {
          originalExec.apply(this, arguments);
        }
      });

      const response = await request(app)
        .get('/comic-preview?path=test.cbr&page=1')
        .expect(500);
      
      expect(response.text).toContain('Comic extraction error');
      
      // Restore original exec
      require('child_process').exec = originalExec;
    });
  });

  describe('File System Error Paths', () => {
    test('should handle directory stat errors gracefully', async () => {
      // Mock fs.statSync to throw error for specific files
      const originalStatSync = fs.statSync;
      
      fs.statSync = jest.fn((filePath) => {
        if (filePath.includes('problematic-file')) {
          throw new Error('Permission denied');
        }
        return originalStatSync(filePath);
      });

      // This test verifies the error handling in the file listing
      const response = await request(app)
        .get('/api/browse')
        .expect(200); // Should still succeed even with stat errors
      
      expect(response.body.files).toBeDefined();
      
      // Restore original function
      fs.statSync = originalStatSync;
    });
  });

  describe('EPUB Error Edge Cases', () => {
    test('should handle EPUB with invalid container.xml format', async () => {
      const yauzl = require('yauzl');
      const originalOpen = yauzl.open;
      
      yauzl.open = jest.fn((filePath, options, callback) => {
        const files = new Map();
        files.set('META-INF/container.xml', 'invalid xml content');
        
        const mockZipfile = {
          readEntry: jest.fn(),
          on: jest.fn((event, handler) => {
            if (event === 'entry') {
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
      
      expect(response.body.error).toContain('Could not find OPF file path');
      
      // Restore original function
      yauzl.open = originalOpen;
    });

    test('should handle EPUB stream read errors', async () => {
      const yauzl = require('yauzl');
      const originalOpen = yauzl.open;
      
      yauzl.open = jest.fn((filePath, options, callback) => {
        const mockZipfile = {
          readEntry: jest.fn(),
          on: jest.fn((event, handler) => {
            if (event === 'entry') {
              setTimeout(() => handler({ 
                fileName: 'META-INF/container.xml',
                isDirectory: () => false 
              }), 10);
            } else if (event === 'end') {
              setTimeout(() => handler(), 20);
            }
          }),
          openReadStream: jest.fn((entry, callback) => {
            callback(new Error('Stream read error'));
          })
        };
        callback(null, mockZipfile);
      });

      const response = await request(app)
        .get('/epub-preview?path=test.epub')
        .expect(500);
      
      expect(response.body.error).toBeDefined();
      
      // Restore original function
      yauzl.open = originalOpen;
    });
  });

  describe('General Error Handling', () => {
    test('should handle requests to non-existent routes', async () => {
      const response = await request(app)
        .get('/non-existent-route')
        .expect(404);
    });

    test('should handle malformed request URLs', async () => {
      const response = await request(app)
        .get('/api/browse?path=%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd')
        .expect(403);
      
      expect(response.text).toBe('Forbidden');
    });
  });
});