const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Encrypted on-disk store for service logins (e.g. mega.nz).
 * Secrets are AES-256-GCM encrypted. The key comes from CREDENTIALS_KEY, or is generated once
 * into a separate key file. Both files are git-ignored and written with owner-only permissions.
 */
const dataDir = () => process.env.CREDENTIALS_DIR || path.join(__dirname, '..');
const storeFile = () => path.join(dataDir(), '.credentials.json');
const keyFile = () => path.join(dataDir(), '.credentials.key');

function getKey() {
  if (process.env.CREDENTIALS_KEY) {
    return crypto.createHash('sha256').update(process.env.CREDENTIALS_KEY).digest();
  }
  try {
    return Buffer.from(fs.readFileSync(keyFile(), 'utf8').trim(), 'hex');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyFile(), key.toString('hex'), { mode: 0o600 });
  return key;
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64')).join('.');
}

function decrypt(token) {
  const [iv, tag, data] = token.split('.').map(p => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function writeStore(store) {
  fs.writeFileSync(storeFile(), JSON.stringify(store), { mode: 0o600 });
}

/** Save (or replace) the login for a service. */
function save(service, { username, secret }) {
  const store = readStore();
  store[service] = { username, secret: encrypt(secret) };
  writeStore(store);
}

/** Full login including the decrypted secret, for server-side use only. Null when none/unreadable. */
function get(service) {
  const entry = readStore()[service];
  if (!entry) return null;
  try {
    return { username: entry.username, secret: decrypt(entry.secret) };
  } catch (err) {
    return null; // key changed or file tampered with
  }
}

/** Public view: whether a login is saved and for which user, never the secret. */
function describe(service) {
  const entry = readStore()[service];
  return { saved: !!entry, username: entry ? entry.username : null };
}

function remove(service) {
  const store = readStore();
  delete store[service];
  writeStore(store);
}

module.exports = { save, get, describe, remove };
