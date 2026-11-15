const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('pdf2pic');
jest.mock('yauzl');
jest.mock('node-unrar-js');

describe('Root selection (/api/config)', () => {
  let app;
  let config;
  let tmpRoot;
  let originalRoot;

  beforeAll(() => {
    process.env.AUTH = 'FALSE';
    jest.resetModules();
    config = require('../lib/config');
    app = require('../server');
    originalRoot = config.baseDir;
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-root-'));
    fs.mkdirSync(path.join(tmpRoot, 'sub'));
    fs.writeFileSync(path.join(tmpRoot, 'hello.txt'), 'hello');
  });

  afterAll(() => {
    config.setBaseDir(originalRoot);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('lists only sub-directories of a folder', async () => {
    const res = await request(app).get('/api/config/dirs').query({ path: tmpRoot });
    expect(res.status).toBe(200);
    expect(res.body.dirs).toEqual(['sub']);
    expect(path.resolve(res.body.parent)).toBe(path.dirname(path.resolve(tmpRoot)));
  });

  test('rejects a root that is not a directory', async () => {
    const res = await request(app).post('/api/config/root').send({ path: path.join(tmpRoot, 'hello.txt') });
    expect(res.status).toBe(400);
    expect(config.baseDir).toBe(originalRoot);
  });

  test('requires a path', async () => {
    const res = await request(app).post('/api/config/root').send({});
    expect(res.status).toBe(400);
  });

  test('switches the served root at runtime', async () => {
    const res = await request(app).post('/api/config/root').send({ path: tmpRoot });
    expect(res.status).toBe(200);
    expect(res.body.rootDir).toBe(fs.realpathSync.native(tmpRoot));

    const info = await request(app).get('/api/server-info');
    expect(info.body.rootDir).toBe(res.body.rootDir);

    const file = await request(app).get('/files').query({ path: 'hello.txt' });
    expect(file.status).toBe(200);
  });

  test('still refuses paths outside the new root', async () => {
    await request(app).post('/api/config/root').send({ path: tmpRoot });
    const res = await request(app).get('/files').query({ path: '../../../../etc/hosts' });
    expect([400, 403, 404]).toContain(res.status);
  });
});
