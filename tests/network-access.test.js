const request = require('supertest');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isLoopback, isPrivateAddress } = require('../utils/networkAccess');

jest.mock('pdf2pic');
jest.mock('yauzl');
jest.mock('node-unrar-js');

describe('isPrivateAddress', () => {
  test.each([
    '10.0.0.5', '10.255.255.255', '172.16.0.1', '172.31.255.1', '192.168.1.10', '169.254.3.4',
    '100.64.0.1', '100.127.255.255', '127.0.0.1', '::1', '::ffff:192.168.1.10', 'fd12:3456::1',
    'fc00::1', 'fe80::1', 'fe80::1%eth0',
  ])('%s is private', (addr) => expect(isPrivateAddress(addr)).toBe(true));

  test.each([
    '8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.1.1', '100.63.0.1', '100.128.0.1', '11.0.0.1',
    '::ffff:8.8.8.8', '2001:4860:4860::8888', '999.1.1.1', '10.0.0', '', undefined, null, 'not-an-ip',
  ])('%s is not private', (addr) => expect(isPrivateAddress(addr)).toBe(false));

  test('only the machine itself is loopback', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('192.168.1.10')).toBe(false);
  });
});

describe('saved logins from other devices', () => {
  let dir;
  let router;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-net-'));
    process.env.CREDENTIALS_DIR = dir;
    process.env.AUTH = 'FALSE';
    jest.resetModules();
    router = require('../routes/config.routes');
  });

  afterAll(() => {
    delete process.env.CREDENTIALS_DIR;
    delete process.env.CREDENTIALS_REMOTE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    delete process.env.CREDENTIALS_REMOTE;
  });

  // The app as seen from a client at the given socket address
  const appFrom = (addr) => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      Object.defineProperty(req.socket, 'remoteAddress', { value: addr, configurable: true });
      req.session = {};
      next();
    });
    app.use(router);
    app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ error: err.message }));
    return app;
  };

  const save = (addr, headers = {}) =>
    request(appFrom(addr)).put('/api/config/credentials/mega').set(headers).send({ username: 'a@b.c', password: 'pw' });

  test('a phone on the home network can save and read the login', async () => {
    expect((await save('192.168.1.50')).status).toBe(200);
    const res = await request(appFrom('192.168.1.50')).get('/api/config/credentials/mega');
    expect(res.body).toEqual({ saved: true, username: 'a@b.c' });
    expect((await request(appFrom('::ffff:10.1.2.3')).delete('/api/config/credentials/mega')).status).toBe(200);
  });

  test('the public internet is refused', async () => {
    const res = await save('8.8.8.8');
    expect(res.status).toBe(403);
    expect((await request(appFrom('2001:4860:4860::8888')).get('/api/config/credentials/mega')).status).toBe(403);
  });

  test('a private address behind a forwarding proxy is refused', async () => {
    expect((await save('192.168.1.50', { 'X-Forwarded-For': '8.8.8.8' })).status).toBe(403);
    expect((await save('192.168.1.50', { 'X-Real-IP': '8.8.8.8' })).status).toBe(403);
  });

  test('CREDENTIALS_REMOTE=off keeps it to this machine', async () => {
    process.env.CREDENTIALS_REMOTE = 'off';
    expect((await save('192.168.1.50')).status).toBe(403);
    expect((await save('127.0.0.1')).status).toBe(200);
  });

  test('changing the served root stays local-only', async () => {
    const res = await request(appFrom('192.168.1.50')).post('/api/config/root').send({ path: dir });
    expect(res.status).toBe(403);
  });
});
