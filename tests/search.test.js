const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('GET /api/search', () => {
  let app;
  let config;
  let root;
  let originalBaseDir;

  beforeAll(() => {
    process.env.AUTH = 'FALSE';
    app = require('../server.js');
    config = require('../lib/config');
    originalBaseDir = config.baseDir;

    root = fs.mkdtempSync(path.join(os.tmpdir(), 'search-test-'));
    fs.mkdirSync(path.join(root, 'medical', 'reports'), { recursive: true });
    fs.mkdirSync(path.join(root, '.browser'));
    fs.writeFileSync(path.join(root, 'top-Dimissione.pdf'), 'x');
    fs.writeFileSync(path.join(root, 'medical', '2026-07-09_pronto-soccorso-dimissione.pdf'), 'x');
    fs.writeFileSync(path.join(root, 'medical', 'reports', 'visita.pdf'), 'x');
    fs.writeFileSync(path.join(root, '.browser', 'dimissione-hidden.json'), 'x');
    config.setBaseDir(root);
  });

  afterAll(() => {
    config.setBaseDir(originalBaseDir);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('matches a partial, case-insensitive name in nested folders', async () => {
    const response = await request(app).get('/api/search?q=dimiss').expect(200);

    const found = response.body.results.map(r => `${r.dir}|${r.name}`).sort();
    expect(found).toEqual([
      'medical|2026-07-09_pronto-soccorso-dimissione.pdf',
      '|top-Dimissione.pdf'
    ]);
    expect(response.body.truncated).toBe(false);
  });

  test('requires every term to match', async () => {
    const response = await request(app).get('/api/search?q=pronto%20dimiss').expect(200);

    expect(response.body.results).toHaveLength(1);
    expect(response.body.results[0].dir).toBe('medical');
  });

  test('searches only below the given folder', async () => {
    const response = await request(app).get('/api/search?path=medical&q=dimiss').expect(200);

    expect(response.body.results.map(r => r.name)).toEqual(['2026-07-09_pronto-soccorso-dimissione.pdf']);
  });

  test('returns folders too and skips the hidden .browser folder', async () => {
    const response = await request(app).get('/api/search?q=report').expect(200);

    expect(response.body.results).toEqual([{ name: 'reports', dir: 'medical', isDirectory: true }]);
  });

  test('returns nothing for an empty query', async () => {
    const response = await request(app).get('/api/search?q=%20').expect(200);

    expect(response.body.results).toEqual([]);
  });

  test('rejects path traversal', async () => {
    await request(app).get('/api/search?path=../../..&q=a').expect(403);
  });
});
