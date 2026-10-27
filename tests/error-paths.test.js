const request = require('supertest');
const fs = require('fs');

jest.mock('node-unrar-js', () => ({
  createExtractorFromFile: jest.fn().mockRejectedValue(new Error('File is not RAR archive'))
}));

describe('Error Path Coverage Tests', () => {
  let app;

  beforeAll(() => {
    process.env.AUTH = 'FALSE';
    delete require.cache[require.resolve('../lib/config.js')];
    app = require('../server.js');
  });

  describe('PDF Info Error Paths', () => {
    test('should handle pdfinfo command not found', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      const { exec } = require('child_process');
      exec.mockImplementation((command, callback) => {
        callback(new Error('Command not found'), '', 'pdfinfo: command not found');
      });

      const response = await request(app)
        .get('/api/pdf-info?path=test.pdf')
        .expect(500);

      expect(response.text).toBe('Failed to get PDF info');
    });

    test('should handle invalid PDF info output', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      const { exec } = require('child_process');
      exec.mockImplementation((command, callback) => {
        callback(null, 'Title: Test PDF\nAuthor: Test Author', '');
      });

      const response = await request(app)
        .get('/api/pdf-info?path=test.pdf')
        .expect(500);

      expect(response.text).toBe('Could not parse PDF info');
    });
  });

  describe('Comic Archive Error Paths', () => {
    test('should handle CBZ extraction errors', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from([0x50, 0x4B, 0x03]));

      const yauzl = require('yauzl');
      yauzl.open = jest.fn((filePath, options, callback) => {
        callback(new Error('Corrupted ZIP file'));
      });

      const response = await request(app)
        .get('/comic-preview?path=test.cbz&page=1')
        .expect(500);

      expect(response.text).toContain('Comic extraction failed due to an unexpected error');
    });

    test('should handle CBZ with no images', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from([0x50, 0x4B, 0x03]));

      const yauzl = require('yauzl');
      yauzl.open = jest.fn((filePath, options, callback) => {
        const mockZipfile = {
          readEntry: jest.fn(),
          close: jest.fn(),
          on: jest.fn((event, handler) => {
            if (event === 'entry') {
              setTimeout(() => handler({ fileName: 'readme.txt' }), 5);
            } else if (event === 'end') {
              setTimeout(() => handler(), 10);
            }
            return mockZipfile;
          }),
          openReadStream: jest.fn()
        };
        callback(null, mockZipfile);
      });

      const response = await request(app)
        .get('/comic-preview?path=test.cbz&page=1')
        .expect(404);

      expect(response.text).toContain('Page not found');
    });

    test('should handle CBR extraction command failure', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024, isDirectory: () => false });
      jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07]));

      const response = await request(app)
        .get('/comic-preview?path=test.cbr&page=1')
        .expect(422);

      expect(response.text).toContain('Archive file is corrupted and cannot be processed');
    });
  });

  describe('File System Error Paths', () => {
    test('should handle stat errors gracefully', async () => {
      jest.spyOn(fs.promises, 'readdir').mockResolvedValue([
        { name: 'problematic-file.txt', isDirectory: () => false }
      ]);
      jest.spyOn(fs.promises, 'stat').mockRejectedValue(new Error('Permission denied'));

      const response = await request(app)
        .get('/api/browse')
        .expect(200);

      expect(response.body.files).toBeDefined();
    });
  });

  describe('General Error Handling', () => {
    test('should handle requests to non-existent routes', async () => {
      await request(app)
        .get('/non-existent-route')
        .expect(404);
    });

    test('should prevent path traversal attacks', async () => {
      const response = await request(app)
        .get('/api/browse?path=%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd')
        .expect(403);

      expect(response.text).toBe('Forbidden');
    });
  });
});
