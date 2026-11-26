/**
 * Builds the fixture folder the parity tests serve: plain files, archives, comics, an EPUB,
 * DOCX files, subtitles and (when ffmpeg is installed) short video clips. Every file and folder
 * gets the same fixed timestamp so two copies answer identically.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const jpeg = require('jpeg-js');
const tar = require('tar');

const FIXED_TIME = new Date('2024-03-01T10:00:00Z');

// --- Minimal ZIP writer (stored and deflated entries) ------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** entries: [{ name, data (Buffer|string), store? }]; a name ending in '/' is a folder. */
function zipBuffer(entries) {
  const dosTime = (10 << 11) | (0 << 5); // 10:00:00
  const dosDate = ((2024 - 1980) << 9) | (3 << 5) | 1; // 2024-03-01
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data || '', 'utf8');
    const deflate = !e.store && raw.length > 0 && !e.name.endsWith('/');
    const body = deflate ? zlib.deflateRawSync(raw) : raw;
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(e.name.endsWith('/') ? 0x10 : 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** A JPEG comic page: a light background with dark panels in a grid. */
function pageJpeg(cols, rows, shade) {
  const width = 300;
  const height = 400;
  const data = Buffer.alloc(width * height * 4);
  const gutter = 16;
  const pw = (width - gutter * (cols + 1)) / cols;
  const ph = (height - gutter * (rows + 1)) / rows;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cx = Math.floor((x - gutter) / (pw + gutter));
      const cy = Math.floor((y - gutter) / (ph + gutter));
      const inX = cx >= 0 && cx < cols && x - gutter - cx * (pw + gutter) < pw;
      const inY = cy >= 0 && cy < rows && y - gutter - cy * (ph + gutter) < ph;
      const v = inX && inY ? shade : 250;
      const i = (y * width + x) * 4;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return jpeg.encode({ data, width, height }, 90).data;
}

function deterministicBytes(n, seed) {
  const b = Buffer.alloc(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    b[i] = s & 0xff;
  }
  return b;
}

function hasFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function setTimes(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) setTimes(p);
    fs.utimesSync(p, FIXED_TIME, FIXED_TIME);
  }
  fs.utimesSync(dir, FIXED_TIME, FIXED_TIME);
}

/** Create the fixture tree in `root`. `rarSample` is a real RAR archive to copy in, if any. */
function buildFixtures(root, { rarSample } = {}) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const w = (rel, data) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  };

  w('hello.txt', 'Hello world\n');
  w('notes.md', '# Notes\n\nSome *markdown* text.\n');
  w('spaced name.txt', 'spaces in the name\n');
  w('unicode-é.txt', 'accented name\n');
  w('Zeta.TXT', 'upper case extension\n');
  w('.hidden', 'hidden file\n');
  w('data.bin', deterministicBytes(2048, 7));
  w('sub/deep/file.json', '{"a": 1}\n');
  w('sub/a.srt', '1\n00:00:01,000 --> 00:00:02,500\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld\n');
  w('sub/b.vtt', 'WEBVTT\n\n00:00.000 --> 00:01.000\nHi\n');
  w('sub/Second Folder/x.txt', 'x\n');
  w('empty/.keep', '');
  w('fake.pdf', '%PDF-1.4 not really a pdf\n');
  const samplePdf = path.join(__dirname, '..', '..', 'test.pdf');
  if (fs.existsSync(samplePdf)) {
    w('doc.pdf', fs.readFileSync(samplePdf));
    // A comic whose pages are an image and then every page of a PDF
    w('pdfcomic.cbz', zipBuffer([
      { name: 'a.jpg', data: pageJpeg(1, 1, 90), store: true },
      { name: 'b.pdf', data: fs.readFileSync(samplePdf), store: true },
    ]));
  }

  w('archive.zip', zipBuffer([
    { name: 'top.txt', data: 'top level\n' },
    { name: 'dir/', data: '' },
    { name: 'dir/inner.txt', data: 'inner text\n' },
    { name: 'dir/img.png', data: deterministicBytes(300, 3), store: true },
    { name: 'dir/blob.bin', data: deterministicBytes(700, 5) },
    { name: 'dir/small.bin', data: deterministicBytes(300, 11) },
    { name: 'dir/Bravo.md', data: '# b\n' },
    { name: 'dir/alpha.md', data: '# a\n' },
    { name: 'nested/a/b/c.txt', data: 'deep\n' },
    { name: 'nested/a/d.txt', data: 'd\n' },
  ]));

  // Comic: three pages (p10 sorts before p2 as plain strings), plus a file that is not a page
  const comic = zipBuffer([
    { name: 'p1.jpg', data: pageJpeg(2, 2, 40), store: true },
    { name: 'p2.jpg', data: pageJpeg(1, 3, 60), store: true },
    { name: 'p10.jpg', data: pageJpeg(3, 1, 80), store: true },
    { name: 'readme.txt', data: 'not a page' },
    { name: 'clip.mp4', data: deterministicBytes(500, 9), store: true },
  ]);
  w('comic.cbz', comic);
  w('zipped.cbr', comic); // a ZIP with a .cbr name
  w('broken.cbz', 'this is not a zip file at all');
  if (rarSample && fs.existsSync(rarSample)) {
    fs.copyFileSync(rarSample, path.join(root, 'text.cbr'));
    fs.copyFileSync(rarSample, path.join(root, 'plain.rar'));
  }

  const cover = pageJpeg(1, 1, 120);
  w('book.epub', zipBuffer([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', data: '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OEBPS/content.opf', data: `<?xml version="1.0"?>
<package><metadata><dc:title>Parity Book</dc:title><dc:creator>A. Writer</dc:creator><dc:description>A test book</dc:description>
<meta name="cover" content="cover-img"/></metadata>
<manifest><item id="cover-img" href="images/cover.jpg" media-type="image/jpeg"/>
<item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>` },
    { name: 'OEBPS/ch1.xhtml', data: `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title><style>p{}</style></head>
<body class="b"><h1>Chapter One</h1><p style="x">It was a “dark” night — caf&#233; &amp; more&hellip; 中文 text.</p>${'<p>Filler paragraph for length.</p>'.repeat(5)}</body></html>` },
    { name: 'OEBPS/ch2.xhtml', data: '<html><body><h2>Second</h2><p>Short.</p></body></html>' },
    { name: 'OEBPS/images/cover.jpg', data: cover, store: true },
  ]));

  w('doc.docx', zipBuffer([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'word/document.xml', data: '<w:document><w:body><w:p><w:r><w:t>Quarterly report</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Revenue &amp; costs</w:t><w:tab/><w:t>up</w:t></w:r></w:p></w:body></w:document>' },
  ]));
  w('thumb.docx', zipBuffer([
    { name: 'docProps/thumbnail.jpeg', data: cover, store: true },
    { name: 'word/document.xml', data: '<w:document/>' },
  ]));

  // Tar archives, built from a staging folder
  const stage = path.join(root, '..', `${path.basename(root)}-tarstage`);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(path.join(stage, 'pkg', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(stage, 'pkg', 'README.txt'), 'tar readme\n');
  fs.writeFileSync(path.join(stage, 'pkg', 'lib', 'code.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(stage, 'top.json'), '{}\n');
  const tarOpts = { cwd: stage, sync: true, portable: true, mtime: FIXED_TIME };
  tar.c({ ...tarOpts, file: path.join(root, 'bundle.tar') }, ['pkg', 'top.json']);
  tar.c({ ...tarOpts, gzip: true, file: path.join(root, 'bundle.tar.gz') }, ['pkg', 'top.json']);
  fs.rmSync(stage, { recursive: true, force: true });

  const ffmpeg = hasFfmpeg();
  if (ffmpeg) {
    const run = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'ignore' });
    run(['-f', 'lavfi', '-i', 'testsrc=duration=3:size=160x120:rate=10', '-f', 'lavfi', '-i', 'sine=duration=3',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-g', '10', '-c:a', 'aac', '-shortest', path.join(root, 'clip.mp4')]);
    run(['-f', 'lavfi', '-i', 'testsrc=duration=3:size=160x120:rate=10', '-c:v', 'mpeg4', path.join(root, 'old.avi')]);
  }

  setTimes(root);
  return { ffmpeg, rar: !!(rarSample && fs.existsSync(rarSample)) };
}

/** Copy a fixture tree keeping timestamps. */
function copyFixtures(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true, preserveTimestamps: true });
  setTimes(to);
}

module.exports = { buildFixtures, copyFixtures, pageJpeg, zipBuffer, FIXED_TIME };
