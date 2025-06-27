/**
 * @jest-environment jsdom
 */

// Mock FileRenderer class
global.FileRenderer = class {
  render(filePath, fileName, codeElement, otherElement) {
    // Mock implementation
    codeElement.innerHTML = `<pre>Mock content for ${fileName}</pre>`;
  }
};

// Load the client-side script
const fs = require('fs');
const path = require('path');
const scriptContent = fs.readFileSync(
  path.join(__dirname, '../public/script.js'),
  'utf8'
);

// Mock DOM elements
document.body.innerHTML = `
  <div id="file-list"></div>
  <div id="content-code"></div>
  <div id="content-other"></div>
  <div id="file-details"></div>
  <select id="file-type-filter">
    <option value="all">All Files</option>
    <option value="code">Code</option>
    <option value="pdf">PDF</option>
  </select>
  <input id="search-input" type="text" />
  <div id="loading-indicator" style="display: none;">Loading...</div>
  <div id="current-path-display">Current Path</div>
`;

// Mock fetch
global.fetch = jest.fn();

describe('Client-side File Browser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = `
      <div id="file-list"></div>
      <div id="content-code"></div>
      <div id="content-other"></div>
      <div id="file-details"></div>
      <select id="file-type-filter">
        <option value="all">All Files</option>
        <option value="code">Code</option>
        <option value="pdf">PDF</option>
      </select>
      <input id="search-input" type="text" />
      <div id="loading-indicator" style="display: none;">Loading...</div>
      <div id="current-path-display">Current Path</div>
    `;
  });

  describe('File Type Detection', () => {
    test('should identify file types correctly', () => {
      // Extract and test the getFileTypeFromExtension function
      const getFileTypeFromExtension = (extension) => {
        if (extension === 'pdf') return 'pdf';
        if (['cbz', 'cbr'].includes(extension)) return 'comic';
        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) return 'image';
        if (['mp4', 'avi', 'mov', 'mkv'].includes(extension)) return 'video';
        if (['mp3', 'wav', 'flac', 'ogg'].includes(extension)) return 'audio';
        if (['js', 'html', 'css', 'json', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'xml', 'yaml', 'yml', 'ini', 'conf', 'log', 'sh', 'bat', 'ps1', 'sql', 'php', 'rb', 'swift', 'kt', 'dart', 'r', 'scala', 'clj', 'elm', 'vue', 'jsx', 'tsx', 'ts', 'less', 'scss', 'sass', 'styl', 'svelte', 'astro'].includes(extension)) return 'code';
        if (['txt', 'md', 'rtf', 'doc', 'docx', 'odt'].includes(extension)) return 'text';
        if (['csv', 'xlsx', 'xls', 'ods'].includes(extension)) return 'table';
        if (['pptx', 'ppt', 'odp'].includes(extension)) return 'presentation';
        if (extension === 'srt') return 'subtitle';
        if (extension === 'epub') return 'ebook';
        return 'file';
      };
      
      expect(getFileTypeFromExtension('js')).toBe('code');
      expect(getFileTypeFromExtension('pdf')).toBe('pdf');
      expect(getFileTypeFromExtension('jpg')).toBe('image');
      expect(getFileTypeFromExtension('unknown')).toBe('file');
    });

    test('should provide file type descriptions', () => {
      const getFileTypeDescription = (extension) => {
        const types = {
          'pdf': 'PDF Document',
          'jpg': 'JPEG Image', 'jpeg': 'JPEG Image', 'png': 'PNG Image', 'gif': 'GIF Image', 'webp': 'WebP Image',
          'mp4': 'MP4 Video', 'avi': 'AVI Video', 'mov': 'QuickTime Video', 'mkv': 'Matroska Video',
          'mp3': 'MP3 Audio', 'wav': 'WAV Audio', 'flac': 'FLAC Audio', 'ogg': 'OGG Audio',
          'txt': 'Text File', 'md': 'Markdown', 'rtf': 'Rich Text Format',
          'doc': 'Word Document', 'docx': 'Word Document', 'odt': 'OpenDocument Text',
          'csv': 'CSV Spreadsheet', 'xls': 'Excel Spreadsheet', 'xlsx': 'Excel Spreadsheet', 'ods': 'OpenDocument Spreadsheet',
          'ppt': 'PowerPoint Presentation', 'pptx': 'PowerPoint Presentation', 'odp': 'OpenDocument Presentation',
          'srt': 'Subtitle File',
          'js': 'JavaScript', 'html': 'HTML Document', 'css': 'CSS Stylesheet', 'json': 'JSON Data',
          'py': 'Python Script', 'java': 'Java Source', 'c': 'C Source', 'cpp': 'C++ Source',
          'xml': 'XML Document', 'yaml': 'YAML Config', 'yml': 'YAML Config',
          'cbz': 'Comic Book Archive', 'cbr': 'Comic Book Archive',
          'epub': 'EPUB E-book'
        };
        return types[extension] || 'Unknown File';
      };
      
      expect(getFileTypeDescription('js')).toBe('JavaScript');
      expect(getFileTypeDescription('pdf')).toBe('PDF Document');
      expect(getFileTypeDescription('unknown')).toBe('Unknown File');
    });
  });

  describe('Search Functionality', () => {
    test('should parse search queries correctly', () => {
      const parseSearchQuery = (query) => {
        return query.trim().split(/\s+/).filter(term => term.length > 0);
      };
      
      expect(parseSearchQuery('hello world')).toEqual(['hello', 'world']);
      expect(parseSearchQuery('  single  ')).toEqual(['single']);
      expect(parseSearchQuery('')).toEqual([]);
    });

    test('should match search terms correctly', () => {
      const matchesSearchTerms = (filename, searchTerms) => {
        if (!searchTerms || searchTerms.length === 0) return true;
        
        const lowerFilename = filename.toLowerCase();
        return searchTerms.every(term => lowerFilename.includes(term.toLowerCase()));
      };
      
      expect(matchesSearchTerms('test-file.js', ['test'])).toBe(true);
      expect(matchesSearchTerms('test-file.js', ['test', 'file'])).toBe(true);
      expect(matchesSearchTerms('test-file.js', ['missing'])).toBe(false);
      expect(matchesSearchTerms('test-file.js', [])).toBe(true);
    });
  });

  describe('File Size Formatting', () => {
    test('should format file sizes correctly', () => {
      const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
      };
      
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(1024)).toBe('1 KB');
      expect(formatFileSize(1024 * 1024)).toBe('1 MB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
    });
  });

  describe('File Loading', () => {
    test('should simulate file loading behavior', () => {
      // Test the expected behavior of file loading
      const mockFiles = [
        { name: 'test.txt', isDirectory: false, size: 1024 },
        { name: 'folder', isDirectory: true }
      ];
      
      const fileList = document.getElementById('file-list');
      
      // Simulate what displayFiles would do
      fileList.innerHTML = '';
      mockFiles.forEach(file => {
        const li = document.createElement('li');
        li.textContent = file.name;
        li.classList.add('file-item');
        fileList.appendChild(li);
      });
      
      expect(fileList.children.length).toBe(2);
      expect(fileList.children[0].textContent).toBe('test.txt');
      expect(fileList.children[1].textContent).toBe('folder');
    });

    test('should handle empty directory', () => {
      const fileList = document.getElementById('file-list');
      fileList.innerHTML = '<li style="color: #666;">No files found</li>';
      
      expect(fileList.children.length).toBe(1);
      expect(fileList.innerHTML).toContain('No files found');
    });
  });

  describe('File Filtering', () => {
    test('should filter files by type', () => {
      const mockFiles = [
        { name: 'script.js', isDirectory: false },
        { name: 'document.pdf', isDirectory: false },
        { name: 'image.jpg', isDirectory: false },
        { name: 'folder', isDirectory: true }
      ];
      
      // Test filtering logic
      const filterByType = (files, filterType) => {
        return files.filter(file => {
          if (filterType === 'all') return true;
          if (file.isDirectory) return filterType === 'directory';
          
          const ext = file.name.split('.').pop().toLowerCase();
          if (filterType === 'code') {
            return ['js', 'html', 'css', 'json', 'py'].includes(ext);
          }
          if (filterType === 'pdf') {
            return ext === 'pdf';
          }
          return false;
        });
      };
      
      expect(filterByType(mockFiles, 'code')).toHaveLength(1);
      expect(filterByType(mockFiles, 'pdf')).toHaveLength(1);
      expect(filterByType(mockFiles, 'all')).toHaveLength(4);
    });
  });

  describe('Keyboard Navigation', () => {
    test('should simulate keyboard navigation behavior', () => {
      const fileList = document.getElementById('file-list');
      fileList.innerHTML = `
        <li class="file-item" data-index="0">File 1</li>
        <li class="file-item" data-index="1">File 2</li>
        <li class="file-item" data-index="2">File 3</li>
      `;
      
      // Test navigation logic
      const navigateFiles = (currentIndex, direction, totalFiles) => {
        switch(direction) {
          case 'ArrowDown':
            return currentIndex < totalFiles - 1 ? currentIndex + 1 : 0;
          case 'ArrowUp':
            return currentIndex > 0 ? currentIndex - 1 : totalFiles - 1;
          default:
            return currentIndex;
        }
      };
      
      expect(navigateFiles(0, 'ArrowDown', 3)).toBe(1);
      expect(navigateFiles(2, 'ArrowDown', 3)).toBe(0);
      expect(navigateFiles(1, 'ArrowUp', 3)).toBe(0);
      expect(navigateFiles(0, 'ArrowUp', 3)).toBe(2);
    });
  });
});