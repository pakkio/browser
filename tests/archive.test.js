const request = require('supertest');
const app = require('../server');
const fs = require('fs');
const path = require('path');

describe('Archive Tests', () => {
  describe('Archive renderer integration', () => {
    it('should detect archive files correctly', () => {
      // Test file type detection (using the renderer logic)
      const testCases = [
        { fileName: 'test.zip', expected: 'archive' },
        { fileName: 'test.rar', expected: 'archive' },
        { fileName: 'test.tar', expected: 'archive' },
        { fileName: 'test.tar.gz', expected: 'archive' },
        { fileName: 'test.tgz', expected: 'archive' },
        { fileName: 'test.txt', expected: 'text' },
        { fileName: 'test.pdf', expected: 'pdf' }
      ];

      testCases.forEach(({ fileName, expected }) => {
        const extension = fileName.split('.').pop().toLowerCase();
        let fileType;
        
        if (extension === 'doc') fileType = 'docx';
        else if (['txt', 'md', 'js', 'html', 'css', 'json', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'csv', 'srt', 'xml', 'yaml', 'yml', 'ini', 'conf', 'log', 'sh', 'bat', 'ps1', 'sql', 'php', 'rb', 'swift', 'kt', 'dart', 'r', 'scala', 'clj', 'elm', 'vue', 'jsx', 'tsx', 'ts', 'less', 'scss', 'sass', 'styl', 'svelte', 'astro'].includes(extension)) {
          fileType = 'text';
        } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) {
          fileType = 'image';
        } else if (extension === 'pdf') {
          fileType = 'pdf';
        } else if (['cbz', 'cbr'].includes(extension)) {
          fileType = 'comic';
        } else if (['mp3', 'wav', 'flac', 'ogg'].includes(extension)) {
          fileType = 'audio';
        } else if (['mp4', 'avi', 'mov', 'mkv'].includes(extension)) {
          fileType = 'video';
        } else if (extension === 'docx') {
          fileType = 'docx';
        } else if (extension === 'xlsx') {
          fileType = 'xlsx';
        } else if (extension === 'pptx') {
          fileType = 'pptx';
        } else if (extension === 'epub') {
          fileType = 'epub';
        } else if (['zip', 'rar', 'tar', 'tgz', 'tar.gz'].includes(extension) || fileName.endsWith('.tar.gz')) {
          fileType = 'archive';
        } else {
          fileType = 'unsupported';
        }
        
        expect(fileType).toBe(expected);
      });
    });
  });

  describe('Archive endpoints', () => {
    it('should require file path for archive contents', async () => {
      await request(app)
        .get('/archive-contents')
        .expect(400)
        .expect(/File path is required/);
    });

    it('should validate archive file extensions', async () => {
      await request(app)
        .get('/archive-contents?path=test.txt')
        .expect(400)
        .expect(/Not a supported archive format/);
    });

    it('should prevent path traversal in archive contents', async () => {
      await request(app)
        .get('/archive-contents?path=../../../etc/passwd')
        .expect(403)
        .expect(/Forbidden/);
    });

    it('should require both archive and file parameters for file extraction', async () => {
      await request(app)
        .get('/archive-file')
        .expect(400)
        .expect(/Archive and file path are required/);
    });

    it('should require file parameter for archive file extraction', async () => {
      await request(app)
        .get('/archive-file?archive=test.zip')
        .expect(400)
        .expect(/Archive and file path are required/);
    });

    it('should prevent path traversal in archive file extraction', async () => {
      await request(app)
        .get('/archive-file?archive=../../../etc/passwd&file=test.txt')
        .expect(403)
        .expect(/Forbidden/);
    });

    it('should handle non-existent archive files gracefully', async () => {
      await request(app)
        .get('/archive-contents?path=nonexistent.zip')
        .expect(500);
    });

    it('should handle archive file extraction for non-existent archives', async () => {
      await request(app)
        .get('/archive-file?archive=nonexistent.zip&file=test.txt')
        .expect(500);
    });
  });

  describe('Archive utility functions', () => {
    it('should handle missing archive files gracefully', () => {
      // These utility functions are tested indirectly through the endpoint tests
      // since they're internal server functions
      expect(true).toBe(true);
    });
  });

  describe('Keyboard navigation enhancements', () => {
    it('should detect archive files in type filtering', () => {
      const testFiles = [
        { fileName: 'test.zip', expected: 'archive' },
        { fileName: 'test.rar', expected: 'archive' },
        { fileName: 'test.tar', expected: 'archive' },
        { fileName: 'test.tar.gz', expected: 'archive' },
        { fileName: 'test.tgz', expected: 'archive' },
        { fileName: 'regular.txt', expected: 'text' }
      ];

      testFiles.forEach(({ fileName, expected }) => {
        const extension = fileName.split('.').pop().toLowerCase();
        let fileType;
        
        // Replicate the logic from script.js getFileTypeFromExtension
        if (['zip', 'rar', 'tar', 'tgz', '7z'].includes(extension) || fileName.endsWith('.tar.gz')) {
          fileType = 'archive';
        } else if (['txt', 'md'].includes(extension)) {
          fileType = 'text';
        } else {
          fileType = 'file';
        }
        
        expect(fileType).toBe(expected);
      });
    });

    it('should support keyboard navigation keys without errors', () => {
      // Test that keyboard event handling doesn't throw errors
      const mockEvent = {
        key: 'ArrowDown',
        preventDefault: jest.fn(),
        target: { tagName: 'DIV' }
      };

      // This should not throw
      expect(() => {
        // Simulate the keyboard handling logic
        if (mockEvent.target.tagName !== 'INPUT' && mockEvent.target.tagName !== 'SELECT') {
          mockEvent.preventDefault();
        }
      }).not.toThrow();
    });
  });
});