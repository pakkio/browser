// Global Jest setup: mock child_process to avoid external tool dependencies (pdfinfo, ffmpeg)

jest.mock('child_process', () => {
  const { Readable } = require('stream');
  const { EventEmitter } = require('events');

  function makeReadable(data = '') {
    const r = new Readable({ read() {} });
    if (data && data.length) {
      // push async to simulate streaming
      process.nextTick(() => {
        r.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
        r.push(null);
      });
    } else {
      process.nextTick(() => r.push(null));
    }
    return r;
  }

  function mockSpawn(cmd, args) {
    // Minimal EventEmitter with stdout/stderr streams
    const proc = new EventEmitter();
    proc.stdout = makeReadable('');
    proc.stderr = makeReadable('');
    proc.kill = () => {};
    // Close successfully shortly after
    process.nextTick(() => proc.emit('close', 0));
    return proc;
  }

  function mockExec(cmd, options, cb) {
    // exec(cmd, cb) and exec(cmd, options, cb) are both used by the handlers
    if (typeof options === 'function') {
      cb = options;
    }
    // Provide predictable output for pdfinfo calls used by getPdfInfo
    if (cmd && cmd.startsWith('pdfinfo')) {
      const stdout = 'Title: Mock PDF\nPages: 3\n';
      return cb && cb(null, stdout, '');
    }
    // Default: succeed with empty output
    return cb && cb(null, '', '');
  }

  // jest.fn wrappers keep the default behaviour but let tests override it
  // No native unrar in tests: probing it fails, so the handlers use the mocked node-unrar-js
  function mockSpawnSync() {
    return { error: Object.assign(new Error('spawnSync ENOENT'), { code: 'ENOENT' }), status: null };
  }

  function mockExecFile(cmd, args, options, cb) {
    cb = [args, options, cb].find((arg) => typeof arg === 'function');
    return cb && cb(Object.assign(new Error('execFile ENOENT'), { code: 'ENOENT' }), '', '');
  }

  return {
    spawn: jest.fn(mockSpawn),
    exec: jest.fn(mockExec),
    execFile: jest.fn(mockExecFile),
    spawnSync: jest.fn(mockSpawnSync)
  };
});


// Stub OAuth/session config so server.js can load without real credentials
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-client-secret';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';

// config.js derives baseDir from process.argv[2]; when running a single file
// (`jest tests/x.test.js`) that would be the test path, so drop extra args
process.argv = process.argv.slice(0, 2);
