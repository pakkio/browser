const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

jest.mock('pdf2pic');
jest.mock('yauzl');
jest.mock('node-unrar-js');

// Fake mega.nz account: Cloud Drive / Photos / cat.jpg, plus readme.html, notes.txt, empty.bin
const mockData = Buffer.from('0123456789');
const mockDownload = jest.fn();
const mockLogins = jest.fn();
jest.mock('megajs', () => {
  const mk = (nodeId, name, directory, extra = {}) => ({ nodeId, name, directory, ...extra });
  return {
    Storage: class {
      constructor(opts) {
        mockLogins(opts);
        const root = mk('root', 'Cloud Drive', true);
        const photos = mk('d1', 'Photos', true, { parent: root, timestamp: 1700000000 });
        const cat = mk('f1', 'cat.jpg', false, { parent: photos, size: 10, timestamp: 1700000100 });
        const page = mk('f2', 'readme.html', false, { parent: root, size: 10 });
        const notes = mk('f3', 'notes.txt', false, { parent: root, size: 10 });
        const zero = mk('f4', 'empty.bin', false, { parent: root, size: 0 });
        const comic = mk('f5', 'issue1.cbz', false, { parent: root, size: 10, timestamp: 1700000200 });
        const huge = mk('f6', 'huge.cbz', false, { parent: root, size: 5 * 1024 * 1024 * 1024 });
        for (const f of [cat, page, notes, zero, comic, huge]) f.download = (...args) => mockDownload(...args);
        photos.children = [cat];
        root.children = [notes, photos, page, zero, comic, huge];
        this.root = root;
        this.files = { d1: photos, f1: cat, f2: page, f3: notes, f4: zero, f5: comic, f6: huge };
        this.ready = Promise.resolve(this);
      }
      close() { return Promise.resolve(); }
    },
  };
});

const collect = (res, cb) => {
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

const mockComicInfo = jest.fn();
const mockComicPage = jest.fn();
jest.mock('../lib/comic-handlers', () => {
  const actual = jest.requireActual('../lib/comic-handlers');
  return {
    ...actual,
    getComicInfo: (...args) => mockComicInfo(...args),
    serveComicPreview: (...args) => mockComicPage(...args),
  };
});

describe('mega.nz browsing', () => {
  let app;
  let mega;
  let credentials;
  let dir;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-mega-'));
    process.env.CREDENTIALS_DIR = dir;
    process.env.AUTH = 'FALSE';
    jest.resetModules();
    credentials = require('../lib/credentials');
    mega = require('../lib/mega');
    app = require('../server');
  });

  beforeEach(() => {
    mockDownload.mockReset();
    mockLogins.mockClear();
    mockDownload.mockImplementation(({ start = 0, end } = {}) => Readable.from([mockData.subarray(start, end === undefined ? undefined : end + 1)]));
    mega.reset();
    credentials.save('mega', { username: 'me@example.com', secret: 'pw' });
  });

  afterAll(() => {
    delete process.env.CREDENTIALS_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('asks for a login when none is saved', async () => {
    credentials.remove('mega');
    const res = await request(app).get('/api/mega/list');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/login/i);
  });

  test('lists the root with folders first and logs in with the saved login', async () => {
    const res = await request(app).get('/api/mega/list');
    expect(res.status).toBe(200);
    expect(res.body.root).toBe(true);
    expect(res.body.items.map(i => i.name)).toEqual(['Photos', 'empty.bin', 'huge.cbz', 'issue1.cbz', 'notes.txt', 'readme.html']);
    expect(res.body.items[0]).toMatchObject({ id: 'd1', directory: true, size: null, modified: 1700000000000 });
    expect(mockLogins).toHaveBeenCalledWith(expect.objectContaining({ email: 'me@example.com', password: 'pw' }));
  });

  test('reuses one session, and logs in again after the saved login changes', async () => {
    await request(app).get('/api/mega/list');
    await request(app).get('/api/mega/list?id=d1');
    expect(mockLogins).toHaveBeenCalledTimes(1);
    await request(app).put('/api/config/credentials/mega').send({ username: 'other@example.com', password: 'pw2' });
    await request(app).get('/api/mega/list');
    expect(mockLogins).toHaveBeenCalledTimes(2);
    expect(mockLogins).toHaveBeenLastCalledWith(expect.objectContaining({ email: 'other@example.com' }));
  });

  test('lists a sub-folder with its breadcrumb trail', async () => {
    const res = await request(app).get('/api/mega/list').query({ id: 'd1' });
    expect(res.body.root).toBe(false);
    expect(res.body.crumbs).toEqual([{ id: 'd1', name: 'Photos' }]);
    expect(res.body.items.map(i => i.name)).toEqual(['cat.jpg']);
  });

  test('404 for an unknown id and 400 when a file is listed as a folder', async () => {
    expect((await request(app).get('/api/mega/list').query({ id: 'nope' })).status).toBe(404);
    expect((await request(app).get('/api/mega/list').query({ id: 'f1' })).status).toBe(400);
    expect((await request(app).get('/api/mega/list').query({ id: 'constructor' })).status).toBe(404);
  });

  test('streams a whole file inline with safe headers', async () => {
    const res = await request(app).get('/api/mega/file').query({ id: 'f1' }).buffer(true).parse(collect);
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('0123456789');
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(res.headers['content-disposition']).toMatch(/^inline/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toMatch(/sandbox/);
    expect(res.headers['accept-ranges']).toBe('bytes');
  });

  test('supports byte ranges for seeking', async () => {
    const res = await request(app).get('/api/mega/file').query({ id: 'f1' }).set('Range', 'bytes=2-5')
      .buffer(true).parse(collect);
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 2-5/10');
    expect(res.body.toString()).toBe('2345');
    expect(mockDownload).toHaveBeenCalledWith({ start: 2, end: 5 });
  });

  test('supports suffix ranges and rejects unsatisfiable ones', async () => {
    let res = await request(app).get('/api/mega/file').query({ id: 'f1' }).set('Range', 'bytes=-3')
      .buffer(true).parse(collect);
    expect(res.headers['content-range']).toBe('bytes 7-9/10');
    expect(res.body.toString()).toBe('789');
    res = await request(app).get('/api/mega/file').query({ id: 'f1' }).set('Range', 'bytes=50-60');
    expect(res.status).toBe(416);
  });

  test('reads a single first byte despite the library treating end 0 as "to the end"', async () => {
    const res = await request(app).get('/api/mega/file').query({ id: 'f1' }).set('Range', 'bytes=0-0')
      .buffer(true).parse(collect);
    expect(res.status).toBe(206);
    expect(res.body.toString()).toBe('0');
  });

  test('forces download for active content such as html', async () => {
    const res = await request(app).get('/api/mega/file').query({ id: 'f2' });
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
  });

  test('download=1 forces attachment, and a folder or missing id is rejected', async () => {
    const res = await request(app).get('/api/mega/file').query({ id: 'f3', download: '1' });
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename\*=UTF-8.{2}notes\.txt/);
    expect((await request(app).get('/api/mega/file').query({ id: 'd1' })).status).toBe(400);
    expect((await request(app).get('/api/mega/file')).status).toBe(400);
  });

  test('empty files respond without contacting mega.nz', async () => {
    const res = await request(app).get('/api/mega/file').query({ id: 'f4' });
    expect(res.status).toBe(200);
    expect(mockDownload).not.toHaveBeenCalled();
  });

  describe('comics', () => {
    beforeEach(() => {
      fs.rmSync(path.join(os.tmpdir(), 'filebrowser-mega'), { recursive: true, force: true });
      mockComicInfo.mockReset().mockImplementation(async (req, res) => res.json({ pages: 3, format: 'CBZ' }));
      mockComicPage.mockReset().mockImplementation(async (req, res) => res.type('image/jpeg').send(Buffer.from('jpg')));
    });

    test('downloads a local copy once and hands it to the comic handlers', async () => {
      let res = await request(app).get('/api/mega/comic-info').query({ id: 'f5' });
      expect(res.body).toEqual({ pages: 3, format: 'CBZ' });
      const fakeReq = mockComicInfo.mock.calls[0][0];
      expect(fakeReq.resolvedPath).toMatch(/filebrowser-mega.*\.cbz$/);
      expect(fs.readFileSync(fakeReq.resolvedPath).toString()).toBe('0123456789');
      expect(fakeReq.query.path).toBe('issue1.cbz');

      res = await request(app).get('/api/mega/comic-page').query({ id: 'f5', page: '2' });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/image\/jpeg/);
      expect(mockComicPage.mock.calls[0][0].query.page).toBe('2');
      expect(mockDownload).toHaveBeenCalledTimes(1); // second request reused the copy
      fs.rmSync(fakeReq.resolvedPath, { force: true });
    });

    test('rejects non-comics, folders and missing ids', async () => {
      expect((await request(app).get('/api/mega/comic-info').query({ id: 'f3' })).status).toBe(400);
      expect((await request(app).get('/api/mega/comic-info').query({ id: 'd1' })).status).toBe(400);
      expect((await request(app).get('/api/mega/comic-page')).status).toBe(400);
      expect(mockComicInfo).not.toHaveBeenCalled();
    });

    test('refuses to copy files over the size limit', async () => {
      const res = await request(app).get('/api/mega/comic-info').query({ id: 'f6' });
      expect(res.status).toBe(413);
      expect(mockDownload).not.toHaveBeenCalled();
    });

    test('reports a failed download as a bad gateway and leaves no partial file', async () => {
      const { Readable: R } = require('stream');
      mockDownload.mockImplementation(() => new R({ read() { this.destroy(new Error('network')); } }));
      const res = await request(app).get('/api/mega/comic-info').query({ id: 'f5' });
      expect(res.status).toBe(502);
      const dir2 = path.join(os.tmpdir(), 'filebrowser-mega');
      const leftovers = fs.existsSync(dir2) ? fs.readdirSync(dir2).filter(n => n.endsWith('.part')) : [];
      expect(leftovers).toEqual([]);
    });
  });
});
