const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Storage } = require('megajs');
const credentials = require('./credentials');
const ApiError = require('../utils/ApiError');
const logger = require('./logger');

/**
 * mega.nz access using the remembered login (see credentials.js).
 * One logged-in session is kept and reused; it is dropped when the saved login changes.
 * Nodes are addressed by their mega node id, never by path, so names cannot be used to
 * reach anything outside the account.
 */
let session = null; // { key, storage: Promise<Storage> }

function sessionKey(creds) {
  return `${creds.username}\n${creds.secret}`;
}

/** Drop the cached session (call when the saved login changes). */
function reset() {
  const old = session;
  session = null;
  if (old) {
    old.storage.then(s => s.close()).catch(() => { /* already closed or never opened */ });
  }
}

async function getStorage() {
  const creds = credentials.get('mega');
  if (!creds) throw new ApiError(409, 'No mega.nz login saved. Add it in Settings.');
  const key = sessionKey(creds);
  if (session && session.key !== key) reset();
  if (!session) {
    const storage = new Storage({ email: creds.username, password: creds.secret, keepalive: false }).ready;
    session = { key, storage };
    storage.catch((err) => {
      logger.warn('mega.nz login failed', { error: err && err.message });
      if (session && session.storage === storage) session = null;
    });
  }
  try {
    return await session.storage;
  } catch (err) {
    throw new ApiError(401, 'mega.nz login failed. Check the saved email and password.');
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
  const node = typeof id === 'string' && Object.prototype.hasOwnProperty.call(storage.files, id) ? storage.files[id] : null;
  if (!node) throw ApiError.notFound('Not found in mega.nz');
  return node;
}

/** Folder contents (folders first, then by name) plus the breadcrumb trail from the root. */
async function listFolder(id) {
  const storage = await getStorage();
  const folder = findNode(storage, id);
  if (!folder.directory) throw ApiError.badRequest('Not a folder');

  const items = (folder.children || []).map(describeNode).sort((a, b) =>
    (a.directory === b.directory ? a.name.localeCompare(b.name, undefined, { numeric: true }) : (a.directory ? -1 : 1)));

  const crumbs = [];
  for (let n = folder; n && n !== storage.root; n = n.parent) crumbs.unshift({ id: n.nodeId, name: n.name || '(unnamed)' });
  return { id: folder === storage.root ? '' : folder.nodeId, root: folder === storage.root, crumbs, items };
}

/** A downloadable file node. */
async function getFile(id) {
  const storage = await getStorage();
  const node = findNode(storage, id);
  if (!id || node.directory) throw ApiError.badRequest('Not a file');
  return node;
}

// --- Local copies, for formats that need a real file on disk (comic archives) -----------------
const cacheDir = () => path.join(os.tmpdir(), 'filebrowser-mega');
const MAX_COPY_BYTES = (parseInt(process.env.MEGA_MAX_COPY_MB, 10) || 1024) * 1024 * 1024;
const MAX_COPY_AGE_MS = 24 * 60 * 60 * 1000;
const pendingCopies = new Map();

async function pruneCopies() {
  try {
    const dir = cacheDir();
    for (const name of await fs.promises.readdir(dir)) {
      const file = path.join(dir, name);
      const stat = await fs.promises.stat(file);
      if (Date.now() - stat.mtimeMs > MAX_COPY_AGE_MS) await fs.promises.rm(file, { force: true });
    }
  } catch (err) {
    // cache dir not there yet, or a file vanished meanwhile: nothing to prune
  }
}

/**
 * Path of a downloaded copy of a mega.nz file, downloading it first if needed. Copies live in the
 * OS temp folder, are reused for a day, and keep the original extension so format checks work.
 */
async function localCopy(node) {
  const size = node.size || 0;
  if (size > MAX_COPY_BYTES) {
    throw new ApiError(413, `File is too large to open here (limit ${Math.round(MAX_COPY_BYTES / 1048576)} MB). Download it instead.`);
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
      logger.warn('mega.nz copy failed', { error: err && err.message });
      throw new ApiError(502, 'Could not download the file from mega.nz');
    }
    return file;
  })().finally(() => pendingCopies.delete(file));
  pendingCopies.set(file, job);
  return job;
}

module.exports = { listFolder, getFile, localCopy, reset };
