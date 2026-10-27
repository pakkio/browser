// Global Jest setup: mock child_process to avoid external tool dependencies (pdfinfo, ffmpeg)

jest.mock('child_process', () => {
    const { Readable } = require('stream');
    const { EventEmitter } = require('events');

    function makeReadable(data = '') {
        const r = new Readable({ read() {} });
        if (data && data.length) {
            process.nextTick(() => {
                r.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
                r.push(null);
            });
        } else {
            process.nextTick(() => r.push(null));
        }
        return r;
    }

    return {
        spawn: jest.fn((cmd, args) => {
            const proc = new EventEmitter();
            proc.stdout = makeReadable('');
            proc.stderr = makeReadable('');
            proc.kill = () => {};
            process.nextTick(() => proc.emit('close', 0));
            return proc;
        }),
        exec: jest.fn((cmd, opts, cb) => {
            if (typeof opts === 'function') {
                cb = opts;
            }
            if (cmd && cmd.startsWith('pdfinfo')) {
                const stdout = 'Title: Mock PDF\nPages: 3\n';
                return cb && cb(null, stdout, '');
            }
            return cb && cb(null, '', '');
        })
    };
});

