const fs = require('fs');
const os = require('os');
const path = require('path');
// setup-jest.js mocks child_process; this test needs the real one
const { execFileSync } = jest.requireActual('child_process');

// pdf-parse's old pdf.js misreads Buffers inside jest's VM realm (it reports 1 page), so the count is
// taken in a plain node process, which is how the server runs it.
function getPdfPageCount(file) {
    const script = `require(process.argv[1]).getPdfPageCount(process.argv[2]).then(n => console.log(n), e => { console.error(e.message); process.exit(1); })`;
    return Promise.resolve().then(() => Number(execFileSync(process.execPath,
        ['-e', script, path.resolve(__dirname, '../../lib/comic-handlers.js'), file],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })));
}

/** A tiny but well-formed PDF with `pages` empty pages. */
function makePdf(pages) {
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>'];
    const kids = Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(' ');
    objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
    for (let i = 0; i < pages; i++) objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>');
    let body = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((obj, i) => {
        offsets.push(body.length);
        body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    });
    const xref = body.length;
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.forEach(o => { body += `${String(o).padStart(10, '0')} 00000 n \n`; });
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(body, 'latin1');
}

describe('getPdfPageCount', () => {
    let dir;
    beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-count-')); });
    afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    test.each([1, 3, 12])('counts %i pages', async (n) => {
        const file = path.join(dir, `${n}.pdf`);
        fs.writeFileSync(file, makePdf(n));
        await expect(getPdfPageCount(file)).resolves.toBe(n);
    });

    test('rejects a file that is not a PDF', async () => {
        const file = path.join(dir, 'bad.pdf');
        fs.writeFileSync(file, 'not a pdf');
        await expect(getPdfPageCount(file)).rejects.toThrow();
    });
});
