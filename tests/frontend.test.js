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
      <button id="back-btn"></button>
      <input id="search-input" />
      <div id="auth-section"></div>
      <button id="login-btn"></button>
      <button id="logout-btn"></button>
      <div id="user-info"></div>
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

  test('should contain basic functions', () => {
    expect(scriptContent).toContain('function browse');
    expect(scriptContent).toContain('function openFile');
    expect(scriptContent).toContain('function checkAuth');
    expect(scriptContent).toContain('function login');
    expect(scriptContent).toContain('function logout');
  });

  test('should initialize when loaded', () => {
    // Mock fetch for auth check
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ authenticated: false, authDisabled: true })
    });

    // Execute the script
    eval(scriptContent);

    expect(global.fetch).toHaveBeenCalledWith('/auth/user');
  });

  test('should handle browse function calls', () => {
    // Setup mocks
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        files: [
          { name: 'test.txt', isDirectory: false, size: 1024 },
          { name: 'folder', isDirectory: true }
        ],
        currentPath: '/test',
        basePath: '/base'
      })
    });

    // Execute script
    eval(scriptContent);

    // Test that the browse function exists and can be called
    expect(typeof window.browse).toBe('function');
  });

  test('should contain file extension checks', () => {
    expect(scriptContent).toContain('.pdf');
    expect(scriptContent).toContain('.cbz');
    expect(scriptContent).toContain('.cbr');
    expect(scriptContent).toContain('.epub');
    expect(scriptContent).toContain('.avi');
  });

  test('should handle search functionality', () => {
    expect(scriptContent).toContain('search-input');
    expect(scriptContent).toContain('filter');
  });

  test('should contain authentication UI elements', () => {
    expect(scriptContent).toContain('login-btn');
    expect(scriptContent).toContain('logout-btn');
    expect(scriptContent).toContain('auth-section');
  });

  test('should handle file opening logic', () => {
    expect(scriptContent).toContain('openFile');
    expect(scriptContent).toContain('content-viewer');
  });

  test('should contain error handling', () => {
    expect(scriptContent).toContain('catch');
    expect(scriptContent).toContain('console.error');
  });

  test('should handle different file types', () => {
    const fileTypes = ['.pdf', '.cbz', '.cbr', '.epub', '.avi'];
    fileTypes.forEach(type => {
      expect(scriptContent).toContain(type);
    });
  });

  test('should have DOM manipulation functions', () => {
    expect(scriptContent).toContain('getElementById');
    expect(scriptContent).toContain('innerHTML');
    expect(scriptContent).toContain('addEventListener');
  });

  test('should handle navigation', () => {
    expect(scriptContent).toContain('back-btn');
    expect(scriptContent).toContain('current-path');
  });

  test('should include basic variable declarations', () => {
    expect(scriptContent).toContain('let ');
    expect(scriptContent).toContain('const ');
  });

  test('should contain fetch API calls', () => {
    expect(scriptContent).toContain('fetch(');
    expect(scriptContent).toContain('/api/browse');
  });
});