const fs = require('fs');
const { isMainThread, parentPort } = require('worker_threads');

async function executeTask(type, payload) {
    switch (type) {
        case 'detectPanelsByGutters': {
            const { detectPanelsByGutters } = require('./panel-gutters');
            const buf = Buffer.isBuffer(payload.image) ? payload.image : Buffer.from(payload.image);
            return detectPanelsByGutters(buf);
        }
        case 'pdfPageCount': {
            const pdfParse = require('pdf-parse');
            const data = await fs.promises.readFile(payload.pdfPath);
            // pdf-parse's old pdf.js misreads a Buffer on recent Node versions ("bad XRef entry")
            const { numpages } = await pdfParse(new Uint8Array(data), { max: 1 });
            return numpages;
        }
        case 'extractRarEntry': {
            const { createExtractorFromData } = require('node-unrar-js');
            const data = await fs.promises.readFile(payload.filePath);
            const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            const extractor = await createExtractorFromData({ data: arrayBuffer });
            const { files } = extractor.extract({ files: [payload.entryName] });
            for (const file of files) {
                if (file.extraction) {
                    return Buffer.from(file.extraction);
                }
            }
            throw new Error(`Entry not found in RAR archive: ${payload.entryName}`);
        }
        case 'listRarEntries': {
            const { createExtractorFromFile } = require('node-unrar-js');
            const extractor = await createExtractorFromFile({ filepath: payload.filePath });
            const list = await extractor.getFileList();

            let fileHeaders = [];
            if (list && list.fileHeaders) {
                fileHeaders = Array.isArray(list.fileHeaders) ? list.fileHeaders : Array.from(list.fileHeaders);
            } else if (Array.isArray(list)) {
                fileHeaders = list;
            } else if (list && typeof list === 'object' && list.files) {
                fileHeaders = Array.isArray(list.files) ? list.files : Array.from(list.files);
            } else {
                throw new Error('Unexpected file list structure from RAR extractor');
            }
            return fileHeaders.map(header => header.name || header.filename);
        }
        default:
            throw new Error(`Unknown worker task type: ${type}`);
    }
}

if (!isMainThread && parentPort) {
    parentPort.on('message', async (msg) => {
        const { id, type, payload } = msg;
        try {
            const result = await executeTask(type, payload);
            parentPort.postMessage({ id, result });
        } catch (err) {
            parentPort.postMessage({ id, error: err?.message || String(err) });
        }
    });
}

module.exports = { executeTask };
