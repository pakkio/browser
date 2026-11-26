/**
 * Parity tests: the same requests go to the Node server (server.js) and the Rust server
 * (server-rs), each serving its own identical copy of a fixture folder, and the answers are
 * compared: status, the headers clients rely on, and the body (JSON deep-equal once the root
 * folder, timestamps and other volatile values are normalised; text and binary byte for byte).
 *
 * Run with: npm run test:parity   (builds nothing: run `cargo build --release` in server-rs first)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const request = require('supertest');
const { buildFixtures, copyFixtures, pageJpeg } = require('./fixtures');

const REPO = path.join(__dirname, '..', '..');
const EXE = path.join(REPO, 'server-rs', 'target', 'release', process.platform === 'win32' ? 'filebrowser.exe' : 'filebrowser');
const WORK = path.join(os.tmpdir(), 'filebrowser-parity');
const RAR_SAMPLE = (() => {
  const registry = path.join(os.homedir(), '.cargo', 'registry', 'src');
  try {
    for (const index of fs.readdirSync(registry)) {
      for (const pkg of fs.readdirSync(path.join(registry, index))) {
        if (pkg.startsWith('unrar-')) {
          const f = path.join(registry, index, pkg, 'data', 'unicode.rar');
          if (fs.existsSync(f)) return f;
        }
      }
    }
  } catch { /* no cargo registry */ }
  return null;
})();

function pdfTools() {
  const extra = process.env.PARITY_TOOLS_PATH ? `${process.env.PARITY_TOOLS_PATH}${path.delimiter}` : '';
  try {
    require('child_process').execFileSync('pdftoppm', ['-v'], { stdio: 'ignore', env: { ...process.env, PATH: extra + process.env.PATH } });
    return true;
  } catch {
    return false;
  }
}

const NODE_PORT = 39101;
const RUST_PORT = 39102;
const haveRust = fs.existsSync(EXE);
const describeIf = haveRust ? describe : describe.skip;

jest.setTimeout(120000);

let fixtureInfo;
const roots = {};
const procs = [];
let node;
let rust;

function serverEnv(port) {
  const extra = process.env.PARITY_TOOLS_PATH ? { PATH: `${process.env.PARITY_TOOLS_PATH}${path.delimiter}${process.env.PATH}` } : {};
  const env = { ...process.env, ...extra, PORT: String(port), AUTH: 'FALSE', AI_PROVIDER: 'none', OPENROUTER_API_KEY: '', OPENCODEGO_API_KEY: '', LMSTUDIO_URL: '', AI_VISION_DECISION_MODEL: '', SESSION_SECRET: 'parity-secret', LOG_LEVEL: 'error' };
  delete env.NODE_ENV;
  return env;
}

function start(cmd, args, port) {
  const child = spawn(cmd, args, { cwd: REPO, env: serverEnv(port), stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  procs.push(child);
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30000;
    const poll = () => {
      request(`http://127.0.0.1:${port}`).get('/favicon.ico').then(() => resolve(child)).catch(() => {
        if (Date.now() > deadline || child.exitCode !== null) reject(new Error(`server on ${port} did not start: ${stderr}`));
        else setTimeout(poll, 200);
      });
    };
    poll();
  });
}

// --- Normalisation -----------------------------------------------------------------------------
const VOLATILE_KEYS = new Set(['timestamp', 'lastModified', 'total_time', 'createdAt']);

function normalise(value, root) {
  const variants = [root, root.replace(/\\/g, '/'), JSON.stringify(root).slice(1, -1)];
  const fix = (s) => variants.reduce((acc, v) => acc.split(v).join('<ROOT>'), s);
  const walk = (v) => {
    if (typeof v === 'string') return fix(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        if (!VOLATILE_KEYS.has(k)) out[fix(k)] = walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(value);
}

const COMPARED_HEADERS = ['content-range', 'accept-ranges', 'x-content-mode', 'content-disposition', 'retry-after',
  'x-thumbnail-cache', 'x-pdf-cache', 'ratelimit-limit', 'ratelimit-policy'];

function mainType(res) {
  return String(res.headers['content-type'] || '').split(';')[0].trim();
}

function bodyOf(res, root) {
  const type = mainType(res);
  if (type === 'application/json') return { json: normalise(res.body, root) };
  const buf = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.text || '', 'utf8');
  if (type.startsWith('text/') || type === 'image/svg+xml') return { text: normalise(buf.toString('utf8'), root) };
  return { sha1: crypto.createHash('sha1').update(buf).digest('hex'), length: buf.length };
}

function binaryParser(res, cb) {
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

/**
 * Send the same request to both servers (Node first, then Rust) and return both answers.
 * build(agent) returns a supertest request.
 */
async function both(build) {
  const answers = [];
  for (const [agent, root] of [[node, roots.node], [rust, roots.rust]]) {
    const res = await build(agent).buffer(true).parse(binaryParser);
    let parsedBody = res.body;
    if (mainType(res) === 'application/json') {
      try { parsedBody = JSON.parse(res.body.toString('utf8')); } catch { parsedBody = res.body.toString('utf8'); }
    }
    answers.push({ res: { ...res, body: parsedBody, headers: res.headers, status: res.status }, root });
  }
  return answers;
}

/** Assert that both servers answered the same way. */
async function same(build, { headers = COMPARED_HEADERS, body = true, extraHeaders = [] } = {}) {
  const [[n, r]] = [await both(build)].map(([a, b]) => [a, b]);
  const label = build.toString().replace(/\s+/g, ' ').slice(0, 140);
  expect({ label, status: r.res.status }).toEqual({ label, status: n.res.status });
  expect({ label, type: mainType(r.res) }).toEqual({ label, type: mainType(n.res) });
  for (const h of [...headers, ...extraHeaders]) {
    expect({ label, header: h, value: r.res.headers[h] }).toEqual({ label, header: h, value: n.res.headers[h] });
  }
  if (body) {
    expect({ label, body: bodyOf(r.res, r.root) }).toEqual({ label, body: bodyOf(n.res, n.root) });
  }
  return [n.res, r.res];
}

// --- Setup -------------------------------------------------------------------------------------
beforeAll(async () => {
  if (!haveRust) return;
  const master = path.join(WORK, 'master');
  fixtureInfo = buildFixtures(master, { rarSample: RAR_SAMPLE });
  roots.node = path.join(WORK, 'node-root');
  roots.rust = path.join(WORK, 'rust-root');
  copyFixtures(master, roots.node);
  copyFixtures(master, roots.rust);
  roots.node = fs.realpathSync.native(roots.node);
  roots.rust = fs.realpathSync.native(roots.rust);
  await Promise.all([
    start(process.execPath, [path.join(REPO, 'server.js'), roots.node], NODE_PORT),
    start(EXE, [roots.rust], RUST_PORT),
  ]);
  node = request.agent(`http://127.0.0.1:${NODE_PORT}`);
  rust = request.agent(`http://127.0.0.1:${RUST_PORT}`);
});

afterAll(() => {
  for (const p of procs) p.kill();
});

// --- Tests -------------------------------------------------------------------------------------
describeIf('Rust server parity with the Node server', () => {
  test('the comparison notices a different answer (self-check)', async () => {
    // Cookie-less requests, so the sessions the other tests rely on stay identical
    const fresh = a => request(a === node ? `http://127.0.0.1:${NODE_PORT}` : `http://127.0.0.1:${RUST_PORT}`);
    const [n, r] = await both(a => (a === node ? fresh(a).get('/api/browse?path=') : fresh(a).get('/api/browse?path=sub')));
    expect(bodyOf(r.res, r.root)).not.toEqual(bodyOf(n.res, n.root));
    const [n2, r2] = await both(a => fresh(a).get('/files?path=' + (a === node ? 'hello.txt' : 'notes.md')));
    expect(bodyOf(r2.res, r2.root)).not.toEqual(bodyOf(n2.res, n2.root));
  });

  describe('static app and common responses', () => {
    test('index.html and assets are served byte for byte', async () => {
      await same(a => a.get('/'));
      await same(a => a.get('/style.css'));
      await same(a => a.get('/renderers/pdf-renderer.js'), { body: true });
    });

    test('security headers match helmet', async () => {
      const [n, r] = await same(a => a.get('/api/server-info'), {
        extraHeaders: ['content-security-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy', 'origin-agent-cluster',
          'referrer-policy', 'strict-transport-security', 'x-content-type-options', 'x-dns-prefetch-control', 'x-download-options',
          'x-frame-options', 'x-permitted-cross-domain-policies', 'x-xss-protection'],
      });
      expect(r.headers['x-powered-by']).toBeUndefined();
      expect(n.headers['x-powered-by']).toBeUndefined();
    });

    test('unknown routes and methods answer a JSON 404', async () => {
      await same(a => a.get('/no-such-route?x=1'));
      await same(a => a.post('/api/browse'));
      await same(a => a.get('/favicon.ico'));
    });

    test('auth endpoints with authentication disabled', async () => {
      await same(a => a.get('/auth/user'));
      await same(a => a.get('/auth/google'));
      await same(a => a.post('/auth/logout'));
      await same(a => a.get('/login-failed'));
    });

    test('readme', async () => {
      await same(a => a.get('/api/readme'));
    });
  });

  describe('browsing', () => {
    test('root and sub folders', async () => {
      await same(a => a.get('/api/browse'));
      await same(a => a.get('/api/browse?path=sub'));
      await same(a => a.get('/api/browse?path=sub%2Fdeep'));
      await same(a => a.get('/files/list?path=sub'));
      await same(a => a.get('/api/library'));
      await same(a => a.get('/api/library?path=sub'));
    });

    test('bad browse paths', async () => {
      await same(a => a.get('/api/browse?path=..%2F..%2F..'));
      await same(a => a.get('/api/browse?path=missing'));
      await same(a => a.get('/api/browse?path=hello.txt'), { body: false });
      await same(a => a.get('/api/library?path=..%2F..'));
      await same(a => a.get('/api/library?path=missing'));
    });

    test('folder picker and search', async () => {
      await same(a => a.get('/api/directories'));
      await same(a => a.get('/api/directories?path=sub'));
      await same(a => a.get('/api/directories?path=missing'));
      await same(a => a.get('/api/directories?path=..%2F..%2F..'));
      await same(a => a.get('/api/search?q=txt'));
      await same(a => a.get('/api/search?q=HELLO%20world'));
      await same(a => a.get('/api/search?q='));
      await same(a => a.get('/api/search?q=json&path=sub'));
      await same(a => a.get('/api/search?q=x&path=missing'));
    });

    test('current path round trip and server info', async () => {
      await same(a => a.post('/api/current-path').send({ path: 'sub' }));
      await same(a => a.get('/api/current-path'));
      await same(a => a.get('/api/server-info'));
      await same(a => a.post('/api/current-path').send({}));
      await same(a => a.get('/api/server-info'));
    });
  });

  describe('file serving', () => {
    test('whole files and byte ranges', async () => {
      await same(a => a.get('/files?path=hello.txt'), { extraHeaders: ['content-length'] });
      await same(a => a.get('/files?path=spaced%20name.txt'));
      await same(a => a.get('/files?path=unicode-%C3%A9.txt'));
      await same(a => a.get('/files?path=data.bin'), { extraHeaders: ['content-length'] });
      await same(a => a.get('/files?path=data.bin').set('Range', 'bytes=0-99'), { extraHeaders: ['content-length'] });
      await same(a => a.get('/files?path=data.bin').set('Range', 'bytes=2000-'), { extraHeaders: ['content-length'] });
      await same(a => a.get('/files?path=sub%2Fdeep%2Ffile.json'));
    });

    test('file errors', async () => {
      await same(a => a.get('/files'));
      await same(a => a.get('/files?path=missing.txt'));
      await same(a => a.get('/files?path=sub'));
      await same(a => a.get('/files?path=..%2F..%2Fsecret'));
    });

    test('subtitles', async () => {
      await same(a => a.get('/subtitle?path=sub%2Fa.srt'), { extraHeaders: ['cache-control'] });
      await same(a => a.get('/subtitle?path=%2Fsub%2Fb.vtt'));
      await same(a => a.get('/subtitle?path=hello.txt'));
      await same(a => a.get('/subtitle?path=sub%2Fnone.srt'));
      await same(a => a.get('/subtitle'));
    });
  });

  describe('archives', () => {
    test('zip listings', async () => {
      await same(a => a.get('/archive-contents?path=archive.zip'));
      await same(a => a.get('/archive-contents?path=archive.zip&subPath=dir'));
      await same(a => a.get('/archive-contents?path=archive.zip&subPath=nested%2Fa'));
      await same(a => a.get('/archive-contents?path=archive.zip&subPath=wrapper%2Fnested%2Fa'));
      await same(a => a.get('/archive-contents?path=archive.zip&subPath=a%2Fb'));
    });

    test('tar listings', async () => {
      await same(a => a.get('/archive-contents?path=bundle.tar'));
      await same(a => a.get('/archive-contents?path=bundle.tar&subPath=pkg'));
      await same(a => a.get('/archive-contents?path=bundle.tar.gz&subPath=pkg%2Flib'));
    });

    test('archive errors', async () => {
      await same(a => a.get('/archive-contents'));
      await same(a => a.get('/archive-contents?path=hello.txt'));
      await same(a => a.get('/archive-contents?path=..%2F..%2Fx.zip'));
      await same(a => a.get('/archive-file?archive=archive.zip'));
      await same(a => a.get('/archive-file?archive=archive.zip&file=nope.txt'), { body: false });
    });

    test('files from archives: text, typed, hex dump', async () => {
      await same(a => a.get('/archive-file?archive=archive.zip&file=dir%2Finner.txt'));
      await same(a => a.get('/archive-file?archive=archive.zip&file=dir%2Fimg.png'));
      await same(a => a.get('/archive-file?archive=archive.zip&file=dir%2Fsmall.bin'));
      await same(a => a.get('/archive-file?archive=archive.zip&file=extra%2Fdir%2Finner.txt'));
      await same(a => a.get('/archive-file?archive=bundle.tar&file=pkg%2FREADME.txt'));
      await same(a => a.get('/archive-file?archive=bundle.tar.gz&file=pkg%2Flib%2Fcode.js'));
    });
  });

  describe('fixed in the Rust server', () => {
    // archive-handlers.js destroys the stream after 512 bytes, so 'end' never fires and the
    // request for any larger unknown binary file hangs. The Rust server answers with the dump.
    test('hex dump of a binary file larger than 512 bytes inside a ZIP', async () => {
      const res = await rust.get('/archive-file?archive=archive.zip&file=dir%2Fblob.bin');
      expect(res.status).toBe(200);
      expect(res.headers['x-content-mode']).toBe('hex');
      const lines = res.text.split('\n');
      expect(lines).toHaveLength(32);
      expect(lines[0]).toMatch(/^0000: ([0-9a-f]{4} ){8}$/);
    });

    // getRarContents referenced an undefined variable, so RAR listings always failed.
    test('RAR archive listing and extraction', async () => {
      if (!fixtureInfo.rar) return;
      const list = await rust.get('/archive-contents?path=plain.rar');
      expect(list.status).toBe(200);
      expect(Array.isArray(list.body)).toBe(true);
      expect(list.body.length).toBeGreaterThan(0);
      const first = list.body.find(e => !e.isDirectory);
      const file = await rust.get(`/archive-file?archive=plain.rar&file=${encodeURIComponent(first.name)}`);
      expect(file.status).toBe(200);
      const nodeList = await node.get('/archive-contents?path=plain.rar');
      expect(nodeList.status).toBe(500);
    });

    // pdf2pic renders through GraphicsMagick, whose Ghostscript delegate only resolves when
    // Ghostscript is installed system-wide; with the portable tool pack the page fails.
    // The Rust server renders with Poppler directly.
    test('a PDF page inside a comic renders with the portable tool pack', async () => {
      if (!pdfTools()) return;
      const res = await rust.get('/comic-preview?path=pdfcomic.cbz&page=2').buffer(true).parse(binaryParser);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.body.subarray(1, 4).toString()).toBe('PNG');
    });

    // epub-cover joined the path without checking it stays inside the root.
    test('epub cover refuses paths outside the root', async () => {
      const res = await rust.get('/epub-cover?path=..%2F..%2F..%2Fsomething.epub');
      expect(res.status).toBe(403);
    });
  });

  describe('comics', () => {
    test('page counts', async () => {
      await same(a => a.get('/api/comic-info?path=comic.cbz'));
      await same(a => a.get('/api/comic-info?path=zipped.cbr'));
      await same(a => a.get('/api/comic-info?path=broken.cbz'));
      await same(a => a.get('/api/comic-info?path=hello.txt'));
      await same(a => a.get('/api/comic-info?path=missing.cbz'));
      await same(a => a.get('/api/comic-info'));
      if (fixtureInfo.rar) await same(a => a.get('/api/comic-info?path=text.cbr'));
    });

    test('pages', async () => {
      await same(a => a.get('/comic-preview?path=comic.cbz&page=1'));
      await same(a => a.get('/comic-preview?path=comic.cbz&page=2'));
      await same(a => a.get('/comic-preview?path=comic.cbz&page=3'));
      await same(a => a.get('/comic-preview?path=comic.cbz'));
      await same(a => a.get('/comic-preview?path=comic.cbz&page=99'));
      await same(a => a.get('/comic-preview?path=zipped.cbr&page=2'));
      await same(a => a.get('/comic-preview?path=broken.cbz&page=1'));
    });

    test('video inside a comic archive', async () => {
      await same(a => a.get('/archive-video?path=comic.cbz&fileName=clip.mp4'), { extraHeaders: ['accept-ranges'] });
      await same(a => a.get('/archive-video?path=comic.cbz'));
      await same(a => a.get('/archive-video?path=comic.cbz&fileName=none.mp4'), { body: false });
    });

    test('panel detection from gutters', async () => {
      for (const [cols, rows] of [[2, 2], [1, 3], [3, 2]]) {
        const page = Buffer.from(pageJpeg(cols, rows, 30));
        const hash = crypto.createHash('sha1').update(page).digest('hex');
        const cached = path.join(os.homedir(), '.browser', 'cache', 'comic-panels', `${hash}.json`);
        const [n, r] = await both(a => { fs.rmSync(cached, { force: true }); return a.post('/api/comic-panels').set('Content-Type', 'image/jpeg').send(page); });
        expect(r.res.status).toBe(200);
        expect(n.res.body.source).toBe('gutters');
        expect(n.res.body.panels).toHaveLength(cols * rows);
        expect(normalise(r.res.body, '')).toEqual(normalise(n.res.body, ''));
      }
      await same(a => a.post('/api/comic-panels').set('Content-Type', 'text/plain').send('x'));
    });
  });

  describe('documents', () => {
    test('epub', async () => {
      await same(a => a.get('/epub-preview?path=book.epub'));
      await same(a => a.get('/epub-cover?path=book.epub'), { extraHeaders: ['cache-control'] });
      await same(a => a.get('/epub-cover?path=book.epub&cover=OEBPS%2Fimages%2Fcover.jpg'));
      await same(a => a.get('/epub-cover?path=book.epub&cover=nope.jpg'));
      await same(a => a.get('/epub-preview?path=hello.txt'));
      await same(a => a.get('/epub-preview?path=missing.epub'));
      await same(a => a.get('/epub-cover'));
      await same(a => a.get('/cover.jpeg'));
      await same(a => a.get('/images/x.png'));
    });

    test('docx previews', async () => {
      await same(a => a.get('/docx-preview?path=doc.docx'), { extraHeaders: ['cache-control'] });
      await same(a => a.get('/docx-preview?path=thumb.docx'));
      await same(a => a.get('/docx-preview?path=hello.txt'));
      await same(a => a.get('/docx-preview?path=none.docx'));
    });

    test('pdf page count, pages and integrity check with Poppler and Ghostscript', async () => {
      if (!pdfTools()) return;
      await same(a => a.get('/api/pdf-info?path=doc.pdf'));
      await same(a => a.get('/pdf-preview?path=doc.pdf&page=1'));
      await same(a => a.get('/pdf-preview?path=doc.pdf&page=1'));
      await same(a => a.get('/pdf-preview?path=doc.pdf&page=999'), { body: false });
      await same(a => a.get('/api/validate-pdf?path=doc.pdf'));
      await same(a => a.get('/api/validate-pdf?path=fake.pdf'));
      await same(a => a.get('/api/pdf-info?path=fake.pdf'));
    });

    test('comics with a PDF inside', async () => {
      if (!pdfTools()) return;
      await same(a => a.get('/api/comic-info?path=pdfcomic.cbz'));
      await same(a => a.get('/comic-preview?path=pdfcomic.cbz&page=1'));
      await same(a => a.get('/comic-preview?path=pdfcomic.cbz&page=9'));
    });

    test('pdf requests that need no PDF tools', async () => {
      await same(a => a.get('/pdf-preview?path=hello.txt'));
      await same(a => a.get('/pdf-preview'));
      await same(a => a.get('/api/pdf-info'));
      await same(a => a.get('/api/validate-pdf?path=hello.txt'));
      await same(a => a.get('/api/validate-pdf?path=missing.pdf'));
    });
  });

  describe('video', () => {
    const ifVideo = () => fixtureInfo.ffmpeg;

    test('codec checks and stream info', async () => {
      if (!ifVideo()) return;
      await same(a => a.get('/api/video-codec-check?path=clip.mp4'));
      await same(a => a.get('/api/video-codec-check?path=old.avi'));
      await same(a => a.get('/api/video-stream-info?path=clip.mp4'));
      await same(a => a.get('/api/video-stream-info?path=old.avi'));
    });

    test('streams start with the same headers', async () => {
      if (!ifVideo()) return;
      for (const url of ['/video-stream?path=clip.mp4&start=1', '/video-stream?path=old.avi', '/video-transcode?path=clip.mp4']) {
        const [n, r] = await same(a => a.get(url), { body: false, extraHeaders: ['x-video-start', 'cache-control'] });
        expect(r.body.length).toBeGreaterThan(1000);
        expect(n.body.length).toBeGreaterThan(1000);
      }
    });

    test('thumbnails', async () => {
      if (!ifVideo()) return;
      await same(a => a.get('/video-thumbnail?path=clip.mp4'), { body: false });
      await same(a => a.get('/video-thumbnail?path=clip.mp4'), { body: false });
    });

    test('video request errors', async () => {
      await same(a => a.get('/video-stream?path=hello.txt'));
      await same(a => a.get('/video-stream?path=none.mp4'));
      await same(a => a.get('/video-thumbnail?path=hello.txt'));
      await same(a => a.get('/api/video-codec-check'));
    });
  });

  describe('annotations and bookmarks', () => {
    test('create, read, search, delete', async () => {
      await same(a => a.post('/api/annotations').send({ filePath: 'hello.txt', comment: '  nice  ', stars: '4', color: 'red' }));
      await same(a => a.post('/api/annotations').send({ filePath: 'sub/a.srt', stars: 9 }));
      await same(a => a.post('/api/annotations').send({ filePath: 'notes.md', comment: '' }));
      await same(a => a.post('/api/annotations').send({}));
      await same(a => a.get('/api/annotations?path=hello.txt'));
      await same(a => a.get('/api/annotations?path=sub&directory=true'));
      await same(a => a.get('/api/annotations'));
      await same(a => a.get('/api/search-annotations?hasComment=true'));
      await same(a => a.get('/api/search-annotations?query=NICE'));
      await same(a => a.get('/api/search-annotations?fileType=subtitle'));
      await same(a => a.get('/api/search-annotations?directory=sub&exactDir=true'));
      await same(a => a.delete('/api/annotations?path=sub%2Fa.srt'));
      await same(a => a.delete('/api/annotations'));
      await same(a => a.get('/api/annotations'));
    });

    test('bookmarks', async () => {
      await same(a => a.post('/bookmarks').send({ filePath: 'clip.mp4', name: 'end', position: 2.5 }));
      await same(a => a.post('/bookmarks').send({ filePath: 'clip.mp4', name: 'start', position: 0.5 }));
      await same(a => a.post('/bookmarks').send({ filePath: 'clip.mp4', name: 'start', position: 1 }));
      await same(a => a.get('/bookmarks?path=clip.mp4'));
      await same(a => a.put('/bookmarks').send({ path: 'clip.mp4', oldName: 'end', newName: 'finale' }));
      await same(a => a.put('/bookmarks').send({ path: 'clip.mp4', oldName: 'nope', newName: 'x' }));
      await same(a => a.delete('/bookmarks').send({ filePath: 'clip.mp4', name: 'start' }));
      await same(a => a.get('/api/search-annotations?hasBookmarks=true'));
      await same(a => a.post('/bookmarks').send({ filePath: 'clip.mp4' }));
      await same(a => a.get('/bookmarks'));
    });

    test('legacy migration', async () => {
      await same(a => a.post('/api/annotations/migrate-sparse'));
    });
  });

  describe('file operations', () => {
    test('rename, move and delete keep annotations', async () => {
      await same(a => a.post('/api/annotations').send({ filePath: 'notes.md', comment: 'keep me' }));
      await same(a => a.post('/api/file/rename').send({ oldPath: 'notes.md', newName: 'renamed.md' }));
      await same(a => a.get('/api/annotations?path=renamed.md'));
      await same(a => a.post('/api/file/rename').send({ oldPath: 'renamed.md', newName: 'hello.txt' }));
      await same(a => a.post('/api/file/rename').send({ oldPath: 'renamed.md', newName: '../../escape.md' }));
      await same(a => a.post('/api/file/rename').send({}));
      await same(a => a.post('/api/file/move').send({ sourcePath: 'renamed.md', targetDir: 'sub' }));
      await same(a => a.get('/api/browse?path=sub'));
      await same(a => a.post('/api/file/move').send({ sourcePath: 'sub/renamed.md', targetDir: 'missing' }));
      await same(a => a.post('/api/file/move').send({ sourcePath: 'none.md', targetDir: 'sub' }));
      await same(a => a.post('/api/file/move').send({ sourcePath: 'hello.txt', targetDir: 'hello.txt' }));
      await same(a => a.delete('/api/file').send({ path: 'sub/renamed.md' }));
      await same(a => a.delete('/api/file').send({ path: 'empty' }));
      await same(a => a.delete('/api/file').send({}));
      await same(a => a.delete('/api/file').send({ path: '../../x' }));
      await same(a => a.get('/api/browse'));
    });
  });

  describe('settings, cache and AI without a provider', () => {
    test('root picker and saved logins', async () => {
      await same(a => a.get('/api/config/dirs?path=' + encodeURIComponent(path.join(WORK, 'master'))), { body: false });
      await same(a => a.post('/api/config/root').send({}));
      await same(a => a.post('/api/config/root').send({ path: path.join(WORK, 'does-not-exist') }), { body: false });
      await same(a => a.get('/api/config/credentials/other'));
    });

    test('cache stats shape', async () => {
      const [n, r] = await same(a => a.get('/api/cache/stats'), { body: false });
      expect(Object.keys(r.body).sort()).toEqual(Object.keys(n.body).sort());
    });

    test('AI endpoints without a provider', async () => {
      await same(a => a.post('/api/summarize-file').send({}));
      await same(a => a.post('/api/summarize-file').send({ content: 'Some text to summarise' }));
      await same(a => a.post('/api/analyze-files').send({}));
      await same(a => a.post('/api/analyze-files').send({ path: 'empty' }));
    });
  });
});
