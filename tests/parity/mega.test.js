/**
 * mega.nz through the Node sidecar, without touching mega.nz:
 *  - the real sidecar's token gate, missing-login answer and reset;
 *  - the Rust server driving a stand-in sidecar: start-up, token, login hand-off, byte ranges,
 *    streaming, and comics read from the sidecar's local copy.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const request = require('supertest');
const { zipBuffer, pageJpeg } = require('./fixtures');

const REPO = path.join(__dirname, '..', '..');
const EXE = path.join(REPO, 'server-rs', 'target', 'release', process.platform === 'win32' ? 'filebrowser.exe' : 'filebrowser');
const WORK = path.join(os.tmpdir(), 'filebrowser-mega-test');
const PORT = 39121;
const describeIf = fs.existsSync(EXE) ? describe : describe.skip;

jest.setTimeout(60000);
const procs = [];
afterAll(() => procs.forEach(p => p.kill()));

function get(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath, headers: { connection: 'close', ...headers } }, (res) => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

describe('real mega.nz sidecar', () => {
  let port;
  beforeAll(async () => {
    const child = spawn(process.execPath, [path.join(REPO, 'mega-sidecar', 'index.js')], {
      env: { ...process.env, SIDECAR_TOKEN: 'tok' }, stdio: ['pipe', 'pipe', 'inherit'],
    });
    procs.push(child);
    port = await new Promise((resolve) => {
      child.stdout.on('data', d => {
        const m = /MEGA_SIDECAR_PORT (\d+)/.exec(String(d));
        if (m) resolve(Number(m[1]));
      });
    });
  });

  test('refuses requests without the token', async () => {
    expect((await get(port, '/list')).status).toBe(403);
    expect((await get(port, '/list', { 'x-sidecar-token': 'wrong' })).status).toBe(403);
  });

  test('asks for a saved login before contacting mega.nz', async () => {
    const res = await get(port, '/list', { 'x-sidecar-token': 'tok' });
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/No mega.nz login saved/);
  });

  test('reset and unknown routes', async () => {
    const reset = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/reset', method: 'POST', headers: { 'x-sidecar-token': 'tok', connection: 'close' } }, res => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', () => {});
      req.end();
    });
    expect(reset).toBe(200);
  });
});

describeIf('Rust server with a stand-in sidecar', () => {
  let agent;
  const comicPath = path.join(WORK, 'copy.cbz');

  beforeAll(async () => {
    fs.rmSync(WORK, { recursive: true, force: true });
    fs.mkdirSync(path.join(WORK, 'app', 'public'), { recursive: true });
    fs.mkdirSync(path.join(WORK, 'app', 'mega-sidecar'), { recursive: true });
    fs.mkdirSync(path.join(WORK, 'root'), { recursive: true });
    fs.writeFileSync(path.join(WORK, 'app', 'public', 'index.html'), '<!doctype html><title>t</title>');
    fs.writeFileSync(comicPath, zipBuffer([
      { name: 'a.jpg', data: Buffer.from(pageJpeg(1, 1, 50)), store: true },
      { name: 'b.jpg', data: Buffer.from(pageJpeg(2, 1, 50)), store: true },
    ]));
    // Stand-in: same protocol as mega-sidecar/index.js, answers from memory
    fs.writeFileSync(path.join(WORK, 'app', 'mega-sidecar', 'index.js'), `
      const http = require('http');
      const TOKEN = process.env.SIDECAR_TOKEN;
      const DATA = Buffer.from('0123456789abcdef');
      const server = http.createServer((req, res) => {
        if (req.headers['x-sidecar-token'] !== TOKEN) { res.writeHead(403); return res.end(); }
        const url = new URL(req.url, 'http://x');
        const user = Buffer.from(req.headers['x-mega-user'] || '', 'base64').toString();
        const secret = Buffer.from(req.headers['x-mega-secret'] || '', 'base64').toString();
        if (url.pathname === '/list') {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ id: url.searchParams.get('id'), user, secret, items: [] }));
        }
        if (url.pathname === '/file') {
          const m = /bytes=(\\d+)-(\\d+)/.exec(req.headers.range || '');
          const [s, e] = m ? [Number(m[1]), Number(m[2])] : [0, DATA.length - 1];
          const headers = { 'Content-Type': 'text/plain', 'Content-Length': String(e - s + 1), 'Accept-Ranges': 'bytes',
            'Content-Disposition': "inline; filename*=UTF-8''a.txt", 'Content-Security-Policy': "sandbox; default-src 'none'" };
          if (m) headers['Content-Range'] = 'bytes ' + s + '-' + e + '/' + DATA.length;
          res.writeHead(m ? 206 : 200, headers);
          return res.end(DATA.subarray(s, e + 1));
        }
        if (url.pathname === '/local-copy') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ path: ${JSON.stringify(comicPath)}, name: 'x.cbz' }));
        }
        res.writeHead(404); res.end();
      });
      server.listen(0, '127.0.0.1', () => console.log('MEGA_SIDECAR_PORT ' + server.address().port));
      process.stdin.on('end', () => process.exit(0)); process.stdin.resume();
    `);
    const env = { ...process.env, PORT: String(PORT), AUTH: 'FALSE', FILEBROWSER_APP_DIR: path.join(WORK, 'app'),
      CREDENTIALS_DIR: WORK, CREDENTIALS_KEY: 'test-key', FB_NODE: process.execPath, LOG_LEVEL: 'error' };
    const child = spawn(EXE, [path.join(WORK, 'root')], { env, stdio: 'ignore' });
    procs.push(child);
    agent = request(`http://127.0.0.1:${PORT}`);
    for (let i = 0; i < 100; i++) {
      try { await agent.get('/favicon.ico'); break; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
  });

  test('without a saved login the sidecar is not even started', async () => {
    const res = await agent.get('/api/mega/list');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('No mega.nz login saved. Add it in Settings.');
  });

  test('saved logins are encrypted and handed to the sidecar per request', async () => {
    const saved = await agent.put('/api/config/credentials/mega').send({ username: ' me@example.com ', password: 'p4ss' });
    expect(saved.body).toEqual({ saved: true, username: 'me@example.com' });
    expect(fs.readFileSync(path.join(WORK, '.credentials.json'), 'utf8')).not.toContain('p4ss');
    const res = await agent.get('/api/mega/list?id=abc');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'abc', user: 'me@example.com', secret: 'p4ss', items: [] });
    expect(res.headers['ratelimit-limit']).toBe('120');
  });

  test('file bytes and ranges are relayed', async () => {
    const whole = await agent.get('/api/mega/file?id=f');
    expect(whole.status).toBe(200);
    expect(whole.text).toBe('0123456789abcdef');
    expect(whole.headers['content-security-policy']).toBe("sandbox; default-src 'none'");
    const part = await agent.get('/api/mega/file?id=f').set('Range', 'bytes=2-5');
    expect(part.status).toBe(206);
    expect(part.text).toBe('2345');
    expect(part.headers['content-range']).toBe('bytes 2-5/16');
    expect((await agent.get('/api/mega/file')).status).toBe(400);
  });

  test('comics are read from the local copy', async () => {
    const info = await agent.get('/api/mega/comic-info?id=c');
    expect(info.body).toEqual({ pages: 2, format: 'CBZ' });
    const page = await agent.get('/api/mega/comic-page?id=c&page=2');
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toBe('image/jpeg');
  });

  test('removing the login', async () => {
    const res = await agent.delete('/api/config/credentials/mega');
    expect(res.body).toEqual({ saved: false, username: null });
    expect((await agent.get('/api/mega/list')).status).toBe(409);
  });
});
