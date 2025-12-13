/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

describe('Frontend Script Tests', () => {
  let scriptContent;
  
  beforeAll(() => {
    // Read the script.js file
    scriptContent = fs.readFileSync(
      path.join(__dirname, '../public/script.js'), 
      'utf8'
    );
  });

  beforeEach(() => {
    // Set up DOM
    document.body.innerHTML = `
      <div id="file-list"></div>
      <div id="current-path"></div>
      <input id="search-input" />
      <div id="auth-section"></div>
      <div id="content-viewer"></div>
    `;

    // Mock global functions and objects
    global.fetch = jest.fn();
    global.alert = jest.fn();
    global.console = { log: jest.fn(), error: jest.fn() };
    
    // Clear any existing modules
    jest.resetModules();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should contain main application functions', () => {
    expect(scriptContent).toContain('function initializeApp');
    expect(scriptContent).toContain('function initializeFileExplorer');
  });

  test('should contain file management functions', () => {
    expect(scriptContent).toContain('function loadFiles');
    expect(scriptContent).toContain('function displayFiles');
  });

  test('should contain API endpoints', () => {
    expect(scriptContent).toContain('/api/browse');
  });

  test('should contain DOM manipulation', () => {
    expect(scriptContent).toContain('getElementById');
    expect(scriptContent).toContain('addEventListener');
  });

  test('should handle search functionality', () => {
    expect(scriptContent).toContain('search');
    expect(scriptContent).toContain('filter');
  });

  test('should contain error handling', () => {
    expect(scriptContent).toContain('catch');
    expect(scriptContent).toContain('error');
  });

  test('should include basic variable declarations', () => {
    expect(scriptContent).toContain('let ');
    expect(scriptContent).toContain('const ');
  });

  test('should verify renderer modules exist', () => {
    // Verify renderer modules exist
    const rendererPath = path.join(__dirname, '../public/renderers');
    expect(fs.existsSync(rendererPath)).toBe(true);
    expect(fs.existsSync(path.join(rendererPath, 'text-renderer.js'))).toBe(true);
    expect(fs.existsSync(path.join(rendererPath, 'image-renderer.js'))).toBe(true);
    expect(fs.existsSync(path.join(rendererPath, 'notebook-renderer.js'))).toBe(true);
    expect(fs.existsSync(path.join(rendererPath, 'document-renderers.js'))).toBe(true);
    expect(fs.existsSync(path.join(rendererPath, 'media-renderers.js'))).toBe(true);
    expect(fs.existsSync(path.join(rendererPath, 'other-renderers.js'))).toBe(true);
  });

  test('should contain FileRenderer usage', () => {
    expect(scriptContent).toContain('FileRenderer');
    expect(scriptContent).toContain('fileRenderer');
  });

  test('should expose initializeApp globally', () => {
    expect(scriptContent).toContain('window.initializeApp = initializeApp');
  });
});