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

  function mockExec(cmd, cb) {
    // Provide predictable output for pdfinfo calls used by getPdfInfo
    if (cmd && cmd.startsWith('pdfinfo')) {
      const stdout = 'Title: Mock PDF\nPages: 3\n';
      return cb && cb(null, stdout, '');
    }
    // Default: succeed with empty output
    return cb && cb(null, '', '');
  }

  return { spawn: mockSpawn, exec: mockExec };
});

