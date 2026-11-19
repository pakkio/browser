const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('pdf2pic');
jest.mock('yauzl');
jest.mock('node-unrar-js');

describe('Remembered credentials', () => {
  let app;
  let credentials;
  let dir;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-cred-'));
    process.env.CREDENTIALS_DIR = dir;
    process.env.AUTH = 'FALSE';
    jest.resetModules();
    credentials = require('../lib/credentials');
    app = require('../server');
  });

  afterAll(() => {
    delete process.env.CREDENTIALS_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('stores the secret encrypted and reads it back server-side', () => {
    credentials.save('mega', { username: 'me@example.com', secret: 'hunter2-pass' });
    expect(fs.readFileSync(path.join(dir, '.credentials.json'), 'utf8')).not.toContain('hunter2-pass');
    expect(credentials.get('mega')).toEqual({ username: 'me@example.com', secret: 'hunter2-pass' });
  });

  test('returns null when the key no longer matches', () => {
    credentials.save('mega', { username: 'a@b.c', secret: 's3cret' });
    fs.writeFileSync(path.join(dir, '.credentials.key'), 'ab'.repeat(32));
    expect(credentials.get('mega')).toBeNull();
    fs.rmSync(path.join(dir, '.credentials.key'));
    credentials.save('mega', { username: 'a@b.c', secret: 's3cret' });
  });

  test('API saves, reports and forgets without ever returning the password', async () => {
    let res = await request(app).put('/api/config/credentials/mega').send({ username: ' x@y.z ', password: 'pw-123' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ saved: true, username: 'x@y.z' });
    expect(JSON.stringify(res.body)).not.toContain('pw-123');

    res = await request(app).get('/api/config/credentials/mega');
    expect(res.body).toEqual({ saved: true, username: 'x@y.z' });

    res = await request(app).delete('/api/config/credentials/mega');
    expect(res.body).toEqual({ saved: false, username: null });
  });

  test('rejects missing fields and unknown services', async () => {
    let res = await request(app).put('/api/config/credentials/mega').send({ username: 'x@y.z' });
    expect(res.status).toBe(400);
    res = await request(app).get('/api/config/credentials/other');
    expect(res.status).toBe(400);
  });
});
