const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { extractDocxText, buildDocxTextPreviewSvg, textFromDocumentXml } = require('../../lib/docx-text-preview');

/** Minimal ZIP writer (stored entries) so the tests need no archive dependency. */
function makeZip(entries) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const [name, content] of Object.entries(entries)) {
        const nameBuf = Buffer.from(name);
        const data = Buffer.from(content);
        const crc = zlib.crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt32LE(offset, 42);
        locals.push(local, nameBuf, data);
        centrals.push(central, nameBuf);
        offset += local.length + nameBuf.length + data.length;
    }
    const centralBuf = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Object.keys(entries).length, 8);
    end.writeUInt16LE(Object.keys(entries).length, 10);
    end.writeUInt32LE(centralBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, centralBuf, end]);
}

const para = (text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const documentXml = (...paras) =>
    `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${paras.join('')}</w:body></w:document>`;

describe('docx text preview', () => {
    let dir;
    beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-test-')); });
    afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    const write = (name, entries) => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, makeZip(entries));
        return file;
    };

    test('reads paragraphs, tabs and XML entities from word/document.xml', async () => {
        const file = write('a.docx', {
            '[Content_Types].xml': '<Types/>',
            'word/document.xml': documentXml(para('Hello &amp; welcome'), para('Second &lt;line&gt;'),
                '<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t></w:r></w:p>')
        });
        await expect(extractDocxText(file)).resolves.toBe('Hello & welcome\nSecond <line>\na b');
    });

    test('returns null for a docx with no text, a ZIP without document.xml, and non-ZIP files', async () => {
        await expect(extractDocxText(write('empty.docx', { 'word/document.xml': documentXml(para('')) }))).resolves.toBeNull();
        await expect(extractDocxText(write('other.docx', { 'word/styles.xml': '<s/>' }))).resolves.toBeNull();
        const bogus = path.join(dir, 'bogus.docx');
        fs.writeFileSync(bogus, 'not a zip');
        await expect(extractDocxText(bogus)).resolves.toBeNull();
        await expect(extractDocxText(path.join(dir, 'missing.docx'))).resolves.toBeNull();
    });

    test('textFromDocumentXml collapses runs of blank paragraphs', () => {
        expect(textFromDocumentXml(documentXml(para('a'), para(''), para(''), para(''), para('b')))).toBe('a\n\nb');
    });

    test('SVG preview escapes markup and caps lines and width', () => {
        const long = Array.from({ length: 30 }, (_, i) => `line ${i} <b>&"x"</b> ${'y'.repeat(60)}`).join('\n');
        const svg = buildDocxTextPreviewSvg(long);
        expect(svg).toContain('&lt;b&gt;&amp;&quot;');
        expect(svg).not.toContain('<b>');
        expect((svg.match(/<text /g) || []).length).toBeLessThanOrEqual(13); // 12 lines + the header
    });
});
