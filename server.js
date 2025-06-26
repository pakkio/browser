const express = require('express');
const fs = require('fs');
const path = require('path');
const { convert } = require('pdf2pic');
const yauzl = require('yauzl');
const { createExtractorFromFile } = require('node-unrar-js');

const app = express();
const port = 3000;

const baseDir = path.resolve(process.argv[2] || '.');
console.log(`Browsing directory: ${baseDir}`);

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.woff': 'application/font-woff',
    '.ttf': 'application/font-ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'application/font-otf',
    '.wasm': 'application/wasm',
    '.pdf': 'application/pdf',
    '.cbz': 'application/vnd.comicbook+zip',
    '.cbr': 'application/vnd.comicbook-rar'
};

app.use(express.static('public'));

app.get('/api/browse', (req, res) => {
    const requestedPath = req.query.path || '';
    const dirPath = path.join(baseDir, requestedPath);

    if (!dirPath.startsWith(baseDir)) {
        return res.status(403).send('Forbidden');
    }

    try {
        const files = fs.readdirSync(dirPath, { withFileTypes: true });
        const fileList = files.map(file => ({
            name: file.name,
            isDirectory: file.isDirectory(),
        }));
        res.json(fileList);
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

app.get('/files', (req, res) => {
    const requestedFile = req.query.path;
    if (!requestedFile) {
        return res.status(400).send('File path is required');
    }
    const filePath = path.join(baseDir, requestedFile);

    if (!filePath.startsWith(baseDir)) {
        return res.status(403).send('Forbidden');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);

    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
        res.status(500).send(err.message);
    });
    stream.pipe(res);
});

app.get('/pdf-preview', async (req, res) => {
    const requestedFile = req.query.path;
    const page = parseInt(req.query.page) || 1;
    
    if (!requestedFile) {
        return res.status(400).send('File path is required');
    }
    
    const filePath = path.join(baseDir, requestedFile);
    
    if (!filePath.startsWith(baseDir)) {
        return res.status(403).send('Forbidden');
    }
    
    if (path.extname(filePath).toLowerCase() !== '.pdf') {
        return res.status(400).send('Not a PDF file');
    }
    
    try {
        const options = {
            density: 100,
            saveFilename: "page",
            savePath: "/tmp",
            format: "png",
            width: 800,
            height: 1000
        };
        
        const convertResult = convert(filePath, options);
        const result = await convertResult(page, {responseType: "buffer"});
        
        res.setHeader('Content-Type', 'image/png');
        res.send(result.buffer);
    } catch (error) {
        res.status(500).send(`PDF conversion error: ${error.message}`);
    }
});

app.get('/comic-preview', async (req, res) => {
    const requestedFile = req.query.path;
    const page = parseInt(req.query.page) || 1;
    
    if (!requestedFile) {
        return res.status(400).send('File path is required');
    }
    
    const filePath = path.join(baseDir, requestedFile);
    
    if (!filePath.startsWith(baseDir)) {
        return res.status(403).send('Forbidden');
    }
    
    const ext = path.extname(filePath).toLowerCase();
    if (!['.cbz', '.cbr'].includes(ext)) {
        return res.status(400).send('Not a comic book archive');
    }
    
    try {
        if (ext === '.cbz') {
            await extractFromCBZ(filePath, page, res);
        } else if (ext === '.cbr') {
            await extractFromCBR(filePath, page, res);
        }
    } catch (error) {
        res.status(500).send(`Comic extraction error: ${error.message}`);
    }
});

async function extractFromCBZ(filePath, page, res) {
    return new Promise((resolve, reject) => {
        yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
            if (err) return reject(err);
            
            const imageFiles = [];
            
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                if (entry.fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
                    imageFiles.push(entry);
                }
                zipfile.readEntry();
            });
            
            zipfile.on('end', () => {
                imageFiles.sort((a, b) => a.fileName.localeCompare(b.fileName));
                
                if (page > imageFiles.length || page < 1) {
                    return reject(new Error('Page not found'));
                }
                
                const targetEntry = imageFiles[page - 1];
                zipfile.openReadStream(targetEntry, (err, readStream) => {
                    if (err) return reject(err);
                    
                    const ext = path.extname(targetEntry.fileName).toLowerCase();
                    const mimeType = {
                        '.jpg': 'image/jpeg',
                        '.jpeg': 'image/jpeg',
                        '.png': 'image/png',
                        '.gif': 'image/gif',
                        '.webp': 'image/webp'
                    }[ext] || 'image/jpeg';
                    
                    res.setHeader('Content-Type', mimeType);
                    readStream.pipe(res);
                    resolve();
                });
            });
        });
    });
}

async function extractFromCBR(filePath, page, res) {
    try {
        const extractor = await createExtractorFromFile({ filepath: filePath });
        const list = extractor.getFileList();
        
        const imageFiles = list.fileHeaders.filter(header => 
            header.name.match(/\.(jpg|jpeg|png|gif|webp)$/i)
        ).sort((a, b) => a.name.localeCompare(b.name));
        
        if (page > imageFiles.length || page < 1) {
            throw new Error('Page not found');
        }
        
        const targetFile = imageFiles[page - 1];
        const extracted = extractor.extract({ files: [targetFile.name] });
        
        const file = extracted.files[0];
        if (!file) {
            throw new Error('Could not extract file');
        }
        
        const ext = path.extname(targetFile.name).toLowerCase();
        const mimeType = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp'
        }[ext] || 'image/jpeg';
        
        res.setHeader('Content-Type', mimeType);
        res.send(Buffer.from(file.extraction));
    } catch (error) {
        throw error;
    }
}

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});