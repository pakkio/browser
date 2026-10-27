const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const AIFileAnalyzer = require('./ai-file-analyzer');
const logger = require('./logger');

const CACHE_DIR = path.join(os.homedir(), '.browser', 'cache', 'comic-panels');
const MAX_PANELS = 20;
const MIN_SIDE = 0.03;

const PROMPT = `This is one page of a comic book. Find every panel (frame) on the page.
Answer with JSON only, in this exact shape:
{"panels":[{"x":0.0,"y":0.0,"w":1.0,"h":1.0}]}
x and y are the top-left corner of the panel and w and h its width and height, all as fractions of the image width and height (0 to 1).
List the panels in reading order: top row first, left to right within a row.
A cover, a splash page or a full-page illustration is a single panel covering the illustrated area.
Ignore speech balloons, captions and page margins: they are part of a panel, not panels of their own.`;

/** Pull the panel list out of a model reply and clamp it to the image. Returns null when unusable. */
function parsePanels(content) {
    const match = String(content).replace(/```(?:json)?/gi, '').match(/\{[\s\S]*\}/);
    if (!match) return null;

    let parsed;
    try {
        parsed = JSON.parse(match[0]);
    } catch (e) {
        return null;
    }
    if (!parsed || !Array.isArray(parsed.panels)) return null;

    const panels = [];
    for (const p of parsed.panels.slice(0, MAX_PANELS)) {
        const x = Math.max(0, Math.min(1, Number(p.x)));
        const y = Math.max(0, Math.min(1, Number(p.y)));
        const w = Math.min(1 - x, Number(p.w));
        const h = Math.min(1 - y, Number(p.h));
        if ([x, y, w, h].every(Number.isFinite) && w >= MIN_SIDE && h >= MIN_SIDE) {
            panels.push({ x, y, w, h });
        }
    }
    return panels.length > 0 ? panels : null;
}

/**
 * POST /api/comic-panels with the page image as image/jpeg.
 * Asks the configured AI provider to locate the panels; results are cached by image hash.
 */
async function detectComicPanels(req, res) {
    const image = req.body;
    if (!Buffer.isBuffer(image) || image.length === 0) {
        return res.status(400).json({ error: 'A JPEG page image is required' });
    }

    const hash = crypto.createHash('sha1').update(image).digest('hex');
    const cacheFile = path.join(CACHE_DIR, `${hash}.json`);
    try {
        return res.json({ panels: JSON.parse(fs.readFileSync(cacheFile, 'utf8')).panels, cached: true });
    } catch (e) {
        // Not cached yet
    }

    try {
        const analyzer = new AIFileAnalyzer();
        // Panel detection uses OpenCode Go whenever it is configured
        if (analyzer.opencodegoApiKey) analyzer.provider = 'opencodego';

        const messages = [{
            role: 'user',
            content: [
                { type: 'text', text: PROMPT },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` } }
            ]
        }];

        // Models that cannot read images fail or answer without panels, so try the next one
        const models = analyzer.provider === 'opencodego'
            ? [...new Set([process.env.AI_VISION_MODEL, analyzer.opencodegoModel, ...analyzer.opencodegoFallbackModels].filter(Boolean))]
            : [process.env.AI_VISION_MODEL || null];

        let lastError = 'No AI provider configured';
        for (const model of models) {
            const result = await analyzer.makeAIRequest(messages, {
                temperature: 0.1,
                max_tokens: 800,
                response_format: { type: 'json_object' },
                ...(model && { model })
            });

            const panels = result.success ? parsePanels(result.content) : null;
            if (panels) {
                fs.mkdirSync(CACHE_DIR, { recursive: true });
                fs.writeFileSync(cacheFile, JSON.stringify({ panels }));
                return res.json({ panels, cached: false, model: result.stats?.model });
            }
            lastError = result.success ? 'The AI reply held no usable panels' : result.error;
            logger.warn(`Comic panel detection with ${model || 'default model'} failed: ${lastError}`);
        }

        res.status(502).json({ error: lastError });
    } catch (error) {
        logger.error(`Comic panel detection error: ${error.message}`);
        res.status(500).json({ error: 'Panel detection failed' });
    }
}

module.exports = { detectComicPanels, parsePanels };
