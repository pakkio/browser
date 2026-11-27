const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const logger = require('./logger');

const TIMEOUT_MS = 90000;
const MIN_SIDE = 0.03;
// Replies of the model the detector asks on doubtful pages, kept so a page is never paid twice
const LLM_CACHE_DIR = path.join(os.homedir(), '.browser', 'cache', 'comic-panels', 'llm');

/** Width and height read from a JPEG's start-of-frame marker, or null. */
function jpegSize(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    let i = 2;
    while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC)
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
            return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
}

/**
 * Turn the detector's output into panels as fractions of the page. A page the detector says is
 * not a comic page (cover, ad, illustration) becomes one full-page panel; null when nothing usable.
 */
function convertPanels(detected, pageInfo, size) {
    if (pageInfo && pageInfo.page_type && pageInfo.page_type !== 'comic') {
        return [{ x: 0, y: 0, w: 1, h: 1 }];
    }
    if (!Array.isArray(detected) || !size) return null;
    const panels = [];
    for (const p of detected) {
        if (!Array.isArray(p.bbox) || p.bbox.length !== 4) continue;
        const [bx, by, bw, bh] = p.bbox.map(Number);
        const x = Math.max(0, Math.min(1, bx / size.width));
        const y = Math.max(0, Math.min(1, by / size.height));
        const w = Math.min(1 - x, bw / size.width);
        const h = Math.min(1 - y, bh / size.height);
        if ([x, y, w, h].every(Number.isFinite) && w >= MIN_SIDE && h >= MIN_SIDE) {
            panels.push({ x: round(x), y: round(y), w: round(w), h: round(h) });
        }
    }
    return panels.length > 0 ? panels : null;
}

function round(value) {
    return Math.round(value * 10000) / 10000;
}

function defaultPython() {
    return process.platform === 'win32' ? 'python' : 'python3';
}

/** Path to panel_detector.py from COMIC_PANELS_DETECTOR (the script or the folder holding it). */
function detectorScript(setting) {
    if (!setting) return null;
    const resolved = path.resolve(setting);
    return resolved.toLowerCase().endsWith('.py') ? resolved : path.join(resolved, 'panel_detector.py');
}

/**
 * Find the panels with the comics-panel OpenCV detector. OpenCV draws the boxes; when an
 * OpenRouter key is set, a cheap vision model only reviews doubtful pages and tells covers and
 * ads from comic pages. Returns panels as fractions of the image, or null.
 */
async function detectPanelsWithOpenCV(image, options = {}) {
    const script = detectorScript(options.detector);
    if (!script || !fs.existsSync(script)) return null;
    const size = jpegSize(image);
    if (!size) return null;

    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'comic-panel-'));
    try {
        const imagePath = path.join(workDir, 'page.jpg');
        await fs.promises.writeFile(imagePath, image);

        const args = [script, imagePath, '-o', workDir, '--json', '--no-crops'];
        if (options.apiKey) {
            args.push('--llm-verify', '--llm-page-type', '--llm-cache', LLM_CACHE_DIR);
            if (options.model) args.push('--llm-model', options.model);
        }
        const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
        if (options.apiKey) env.OPENROUTER_API_KEY = options.apiKey;
        else delete env.OPENROUTER_API_KEY;

        await new Promise((resolve, reject) => {
            execFile(options.python || defaultPython(), args,
                { cwd: path.dirname(script), env, timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
                (error, stdout, stderr) => {
                    if (error) reject(new Error(String(stderr || error.message).trim().split('\n').pop()));
                    else resolve();
                });
        });

        const readJson = async (name) => {
            try {
                return JSON.parse(await fs.promises.readFile(path.join(workDir, name), 'utf8'));
            } catch (e) {
                return null;
            }
        };
        const panels = convertPanels(await readJson('page_panels.json'), await readJson('page_page.json'), size);
        if (!panels) logger.info('Comic panel OpenCV detector found no panels');
        return panels;
    } catch (error) {
        logger.warn(`Comic panel OpenCV detector failed: ${error.message}`);
        return null;
    } finally {
        fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
}

module.exports = { detectPanelsWithOpenCV, convertPanels, jpegSize, detectorScript };
