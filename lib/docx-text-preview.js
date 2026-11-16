const yauzl = require('yauzl');

// Only the start of the document is needed for a thumbnail
const MAX_XML_BYTES = 256 * 1024;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, code) => {
        if (code[0] !== '#') return ENTITIES[code.toLowerCase()];
        const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    });
}

/** Plain text, one line per paragraph, from the WordprocessingML of word/document.xml. */
function textFromDocumentXml(xml) {
    return xml.split('</w:p>').map(paragraph => {
        let line = '';
        const parts = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\s*\/>/g;
        let part;
        while ((part = parts.exec(paragraph)) !== null) line += part[1] === undefined ? ' ' : part[1];
        return decodeXml(line);
    }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** First text of a .docx (it is a ZIP), or null when it cannot be read or has no text. */
function extractDocxText(filePath) {
    return new Promise((resolve) => {
        yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
            if (err) return resolve(null);
            let settled = false;
            const done = (value) => {
                if (settled) return;
                settled = true;
                zipfile.close();
                resolve(value);
            };
            zipfile.on('error', () => done(null));
            zipfile.on('end', () => done(null));
            zipfile.on('entry', (entry) => {
                if (entry.fileName !== 'word/document.xml') return zipfile.readEntry();
                zipfile.openReadStream(entry, (streamErr, stream) => {
                    if (streamErr) return done(null);
                    const chunks = [];
                    let size = 0;
                    const finish = () => {
                        const text = textFromDocumentXml(Buffer.concat(chunks).toString('utf8'));
                        done(text || null);
                    };
                    stream.on('data', (chunk) => {
                        chunks.push(chunk);
                        size += chunk.length;
                        if (size >= MAX_XML_BYTES) { stream.destroy(); finish(); }
                    });
                    stream.on('end', finish);
                    stream.on('error', () => done(null));
                });
            });
            zipfile.readEntry();
        });
    });
}

/** 200x200 SVG card showing the first lines of `text`. */
function buildDocxTextPreviewSvg(text) {
    const escape = (line) => line
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const lines = text.substring(0, 500).split('\n').slice(0, 12).map(line => escape(line.substring(0, 40)));
    const textElements = lines.map((line, i) =>
        `<text x="10" y="${25 + i * 14}" fill="#333" font-size="11" font-family="Arial, sans-serif">${line || ' '}</text>`
    ).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="#fff" stroke="#ddd" stroke-width="1"/>
  <rect x="5" y="5" width="190" height="30" fill="#2b579a" rx="2"/>
  <text x="10" y="25" fill="#fff" font-size="12" font-family="Arial, sans-serif" font-weight="bold">DOCX</text>
  <rect x="5" y="40" width="190" height="155" fill="#f9f9f9" rx="2"/>
  <g transform="translate(0, 25)">
    ${textElements}
  </g>
</svg>`;
}

module.exports = { extractDocxText, buildDocxTextPreviewSvg, textFromDocumentXml };
