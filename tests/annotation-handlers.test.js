const fs = require('fs');
const path = require('path');

jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  return {
    ...actualFs,
    existsSync: jest.fn(),
    readdirSync: jest.fn(),
    readFileSync: jest.fn(),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn()
  };
});

jest.mock('../lib/config', () => ({
  baseDir: '/base',
  AUTH_ENABLED: false,
  port: 3000,
  mimeTypes: {},
  getImageMimeType: () => 'image/jpeg',
  getVideoMimeType: () => 'video/mp4'
}));

describe('annotation-handlers', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test.skip('loadAllAnnotations skips invalid JSON files', () => {
    fs.existsSync.mockImplementation((p) => {
      const value = String(p);
      if (value.endsWith(path.join('/base', '.browser'))) return true;
      if (value.endsWith(path.join('/base', '.browser', 'annotations.json'))) return false;
      if (value.endsWith(path.join('/base', '.browser', 'annotations'))) return true;
      return value.includes(path.join('/base', '.browser', 'annotations'));
    });

    fs.readdirSync.mockImplementation((p) => {
      if (String(p).endsWith(path.join('/base', '.browser', 'annotations'))) return ['bad.json', 'good.json'];
      return [];
    });

    fs.readFileSync.mockImplementation((p) => {
      const value = String(p);
      if (value.endsWith(path.join('/base', '.browser', 'annotations', 'bad.json'))) return '{';
      if (value.endsWith(path.join('/base', '.browser', 'annotations', 'good.json'))) return JSON.stringify({ '/x/file.txt': { stars: 5 } });
      return '';
    });

    const handlers = require('../lib/annotation-handlers');
    const req = { query: {} };
    const res = { json: jest.fn(), status: jest.fn(() => res) };

    handlers.getAnnotations(req, res);

    const result = res.json.mock.calls[0][0];
    expect(result['/x/file.txt']).toEqual({ stars: 5 });
  });

  test('getAnnotations tolerates empty legacy annotations file', () => {
    fs.existsSync.mockImplementation((p) => String(p).endsWith(path.join('.browser', 'annotations.json')));
    fs.readFileSync.mockReturnValue('');

    const handlers = require('../lib/annotation-handlers');
    const req = { query: {} };
    const res = { json: jest.fn(), status: jest.fn(() => res) };

    handlers.getAnnotations(req, res);
    expect(res.json).toHaveBeenCalledWith({});
  });
});
