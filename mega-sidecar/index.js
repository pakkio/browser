'use strict';

/**
 * mega.nz helper for the Rust server (there is no mature mega.nz client for Rust).
 *
 * Listens on 127.0.0.1 on a free port, prints "MEGA_SIDECAR_PORT <port>" and serves:
 *   GET  /list?id=            folder contents and breadcrumb trail
 *   GET  /file?id=&download=  file bytes, with byte ranges
 *   GET  /local-copy?id=      path of a downloaded copy of a comic archive
 *   POST /reset               forget the logged-in session
 *
 * Every request must carry the X-Sidecar-Token the server started it with; the saved login comes
 * base64-encoded in X-Mega-User / X-Mega-Secret. Errors are answered as {error, timestamp}.
 * Nodes are addressed by mega node id, never by path.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { pipeline } = require('stream/promises');
const { Storage } = require('megajs');

const TOKEN = process.env.SIDECAR_TOKEN;
if (!TOKEN) {
  process.stderr.write('SIDECAR_TOKEN is required\n');
  process.exit(1);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// --- Session --------------------------------------------------------------------------------
let session = null; // { key, storage: Promise<Storage> }

function reset() {
  const old = session;
  session = null;
  if (old) old.storage.then(s => s.close()).catch(() => {});
}

async function getStorage(creds) {
  const key = `${creds.username}\n${creds.secret}`;
  if (session && session.key !== key) reset();
  if (!session) {
    const storage = new Storage({ email: creds.username, password: creds.secret, keepalive: false }).ready;
    session = { key, storage };
    storage.catch(() => {
      if (session && session.storage === storage) session = null;
    });
  }
  try {
    return await session.storage;
  } catch (err) {
    throw new HttpError(401, 'mega.nz login failed. Check the saved email and password.');
  }
}

function describeNode(node) {
  return {
    id: node.nodeId,
    name: node.name || '(unnamed)',
    directory: !!node.directory,
    size: node.directory ? null : (node.size || 0),
    modified: node.timestamp ? node.timestamp * 1000 : null,
  };
}

function findNode(storage, id) {
  if (!id) return storage.root;
  // Own properties only: ids like "constructor" must not resolve to Object.prototype members
  const node = Object.prototype.hasOwnProperty.call(storage.files, id) ? storage.files[id] : null;
  if (!node) throw new HttpError(404, 'Not found in mega.nz');
  return node;
}

async function listFolder(storage, id) {
  const folder = findNode(storage, id);
  if (!folder.directory) throw new HttpError(400, 'Not a folder');
  const items = (folder.children || []).map(describeNode).sort((a, b) =>
    (a.directory === b.directory ? a.name.localeCompare(b.name, undefined, { numeric: true }) : (a.directory ? -1 : 1)));
  const crumbs = [];
  for (let n = folder; n && n !== storage.root; n = n.parent) crumbs.unshift({ id: n.nodeId, name: n.name || '(unnamed)' });
  return { id: folder === storage.root ? '' : folder.nodeId, root: folder === storage.root, crumbs, items };
}

function getFile(storage, id) {
  const node = findNode(storage, id);
  if (!id || node.directory) throw new HttpError(400, 'Not a file');
  return node;
}

// --- Local copies of comic archives ----------------------------------------------------------
const cacheDir = () => path.join(os.tmpdir(), 'filebrowser-mega');
const MAX_COPY_BYTES = (parseInt(process.env.MEGA_MAX_COPY_MB, 10) || 1024) * 1024 * 1024;
const MAX_COPY_AGE_MS = 24 * 60 * 60 * 1000;
const COMIC_EXTENSIONS = new Set(['.cbz', '.cbr', '.zip']);
const pendingCopies = new Map();

async function pruneCopies() {
  try {
    for (const name of await fs.promises.readdir(cacheDir())) {
      const file = path.join(cacheDir(), name);
      const stat = await fs.promises.stat(file);
      if (Date.now() - stat.mtimeMs > MAX_COPY_AGE_MS) await fs.promises.rm(file, { force: true });
    }
  } catch {
    // nothing to prune yet
  }
}

async function localCopy(node) {
  if (!COMIC_EXTENSIONS.has(path.extname(node.name || '').toLowerCase())) throw new HttpError(400, 'Not a comic archive');
  const size = node.size || 0;
  if (size > MAX_COPY_BYTES) {
    throw new HttpError(413, `File is too large to open here (limit ${Math.round(MAX_COPY_BYTES / 1048576)} MB). Download it instead.`);
  }
  const safeId = String(node.nodeId).replace(/[^\w-]/g, '_');
  const file = path.join(cacheDir(), `${safeId}-${size}-${node.timestamp || 0}${path.extname(node.name || '').toLowerCase()}`);
  if (fs.existsSync(file)) return file;
  if (pendingCopies.has(file)) return pendingCopies.get(file);
  const job = (async () => {
    await fs.promises.mkdir(cacheDir(), { recursive: true });
    pruneCopies();
    const partial = `${file}.${process.pid}.part`;
    try {
      await pipeline(node.download({}), fs.createWriteStream(partial));
      await fs.promises.rename(partial, file);
    } catch (err) {
      await fs.promises.rm(partial, { force: true });
      throw new HttpError(502, 'Could not download the file from mega.nz');
    }
    return file;
  })().finally(() => pendingCopies.delete(file));
  pendingCopies.set(file, job);
  return job;
}

// --- File download with ranges ---------------------------------------------------------------
// Files a browser would run if opened inline from this origin are always downloaded instead
const ACTIVE_CONTENT = new Set(['.html', '.htm', '.xhtml', '.svg', '.xml', '.js', '.mjs']);
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg', '.pjpeg': 'image/jpeg', '.pjp': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.tiff': 'image/tiff', '.tif': 'image/tiff',
  '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.mpg': 'video/mpeg', '.mpeg': 'video/mpeg',
  '.wmv': 'video/x-ms-wmv', '.woff': 'application/font-woff', '.ttf': 'application/font-ttf',
  '.eot': 'application/vnd.ms-fontobject', '.otf': 'application/font-otf', '.wasm': 'application/wasm',
  '.pdf': 'application/pdf', '.cbz': 'application/vnd.comicbook+zip', '.cbr': 'application/vnd.comicbook-rar',
  '.epub': 'application/epub+zip',
};

function sendFile(node, req, res, download) {
  const size = node.size || 0;
  const name = node.name || 'file';
  const ext = path.extname(name).toLowerCase();
  let start = 0;
  let end = size - 1;
  let partial = false;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = parseInt(range[1], 10);
      if (range[2]) end = Math.min(parseInt(range[2], 10), size - 1);
    } else {
      start = Math.max(size - parseInt(range[2], 10), 0); // suffix range: last N bytes
    }
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    partial = true;
  }
  const asAttachment = download === '1' || ACTIVE_CONTENT.has(ext);
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `${asAttachment ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; media-src 'self'; img-src 'self' data:",
    'Cache-Control': 'private, max-age=0',
  };
  if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(partial ? 206 : 200, headers);
  if (size === 0) { res.end(); return; }

  // megajs treats an end of 0 as "to the end of the file", so a one-byte read at offset 0 is asked as 0-1
  const stream = node.download({ start, end: end === 0 ? 1 : end });
  res.on('close', () => stream.destroy());
  stream.on('error', () => res.destroy());
  if (end === 0) stream.once('data', chunk => res.end(chunk.subarray(0, 1)));
  else stream.pipe(res);
}

// --- HTTP ------------------------------------------------------------------------------------
function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function credentialsOf(req) {
  const decode = (h) => Buffer.from(String(req.headers[h] || ''), 'base64').toString('utf8');
  const creds = { username: decode('x-mega-user'), secret: decode('x-mega-secret') };
  if (!creds.username || !creds.secret) throw new HttpError(409, 'No mega.nz login saved. Add it in Settings.');
  return creds;
}

async function handle(req, res) {
  if (req.headers['x-sidecar-token'] !== TOKEN) throw new HttpError(403, 'Forbidden');
  const url = new URL(req.url, 'http://127.0.0.1');
  const id = url.searchParams.get('id') || '';

  if (req.method === 'POST' && url.pathname === '/reset') {
    reset();
    return sendJson(res, 200, { success: true });
  }
  if (req.method !== 'GET') throw new HttpError(404, 'Route not found');

  const storage = await getStorage(credentialsOf(req));
  switch (url.pathname) {
    case '/list':
      return sendJson(res, 200, await listFolder(storage, id));
    case '/file':
      if (!id) throw new HttpError(400, 'id is required');
      return sendFile(getFile(storage, id), req, res, url.searchParams.get('download'));
    case '/local-copy': {
      if (!id) throw new HttpError(400, 'id is required');
      const node = getFile(storage, id);
      return sendJson(res, 200, { path: await localCopy(node), name: node.name });
    }
    default:
      throw new HttpError(404, 'Route not found');
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : 'Internal server error';
    if (!res.headersSent) sendJson(res, status, { error: message, timestamp: new Date().toISOString() });
    else res.destroy();
  });
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`MEGA_SIDECAR_PORT ${server.address().port}\n`);
});

// Exit together with the server that started us
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
