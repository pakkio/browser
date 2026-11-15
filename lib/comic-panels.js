const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const AIFileAnalyzer = require('./ai-file-analyzer');
const logger = require('./logger');
const { detectPanelsByGutters } = require('./panel-gutters');
const { detectPanelsByDecisions, resetDecisionBackoff } = require('./panel-decisions');

const CACHE_DIR = path.join(os.homedir(), '.browser', 'cache', 'comic-panels');
const MAX_PANELS = 20;
const MIN_SIDE = 0.03;
const FULL_PAGE_AREA = 0.7;

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

/** True when the answer is a single panel that covers most of the page. */
function isFullPage(panels) {
    return panels.length === 1 && panels[0].w * panels[0].h >= FULL_PAGE_AREA;
}

function isUsageLimit(error) {
    return /usage limit/i.test(String(error));
}

const OPENCODEGO_LIMIT_MESSAGE = 'OpenCode Go usage limit reached';
// OpenRouter answered that the API key is not valid, and until when not to ask again
let openrouterRejected = { until: 0, message: '' };

function isAuthError(error) {
    return /user not found|invalid api key|incorrect api key|unauthorized|authentication/i.test(String(error));
}
// Until when OpenCode Go is known to be out of quota (so the next pages skip it)
let opencodegoBlockedUntil = 0;

/** Milliseconds until the quota resets, read from "resets in 3h 12m"; 10 minutes when unknown. */
function resetDelay(error) {
    const match = /resets in (?:(\d+)h)?\s*(?:(\d+)m)?/i.exec(String(error));
    const minutes = match ? Number(match[1] || 0) * 60 + Number(match[2] || 0) : 0;
    return (minutes || 10) * 60 * 1000;
}

/**
 * Ask the models in turn until one returns usable panels. A page answered with one full-page
 * panel is often a miss by a light model, so the strong model (when given) is asked once more
 * and its answer wins; the full-page answer is kept if it fails too.
 */
async function askModels(analyzer, messages, models, strongModel) {
    const queue = [...models];
    let fullPageAnswer = null;
    let lastError = 'No AI provider configured';
    while (queue.length > 0) {
        const model = queue.shift();
        const result = await analyzer.makeAIRequest(messages, {
            temperature: 0.1,
            // Reasoning models spend part of this budget thinking; 800 left them with no room to answer
            max_tokens: 4000,
            response_format: { type: 'json_object' },
            ...(model && { model })
        });

        const panels = result.success ? parsePanels(result.content) : null;
        if (panels) {
            const answer = { panels, model: result.stats?.model };
            if (isFullPage(panels) && !fullPageAnswer && strongModel && model !== strongModel) {
                logger.info(`Comic panel detection: ${model || 'default model'} saw one full-page panel, asking ${strongModel}`);
                fullPageAnswer = answer;
                queue.splice(0, queue.length, strongModel, ...queue.filter((m) => m !== strongModel));
                continue;
            }
            return { found: answer, lastError };
        }
        lastError = result.success ? 'The AI reply held no usable panels' : result.error;
        logger.warn(`Comic panel detection with ${model || 'default model'} failed: ${lastError}`);
        // Every model shares the provider's quota, so the others would fail the same way
        if (isUsageLimit(lastError)) break;
    }
    return { found: fullPageAnswer, lastError };
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

    const respondWith = (panels, extra) => {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify({ panels }));
        return res.json({ panels, cached: false, ...extra });
    };

    // Clear gutters between panels need no AI: it is free and instant
    if (process.env.COMIC_PANELS_GUTTERS !== 'false') {
        const panels = detectPanelsByGutters(image);
        if (panels) return respondWith(panels, { source: 'gutters' });
    }

    // A decision model reads the page in one pass without generating text: faster and cheaper than an LLM
    const decisionModel = process.env.AI_VISION_DECISION_MODEL;
    if (decisionModel) {
        const panels = await detectPanelsByDecisions(image, {
            model: decisionModel,
            apiKey: process.env.OPENROUTER_API_KEY?.trim()
        });
        if (panels) return respondWith(panels, { source: 'decision', model: decisionModel });
    }

    try {
        const analyzer = new AIFileAnalyzer();
        // Panel detection uses OpenCode Go whenever it is configured, unless OpenRouter is asked for
        const openrouterFirst = process.env.AI_VISION_PROVIDER === 'openrouter' && Boolean(analyzer.openrouterApiKey);
        if (openrouterFirst) analyzer.provider = 'openrouter';
        else if (analyzer.opencodegoApiKey) analyzer.provider = 'opencodego';

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
            : [(openrouterFirst ? process.env.AI_VISION_OPENROUTER_MODEL : process.env.AI_VISION_MODEL) || null];

        let outcome = { found: null, lastError: 'No AI provider configured' };
        const canUseOpenRouter = analyzer.provider === 'opencodego' && analyzer.openrouterApiKey;

        const alreadyBlocked = analyzer.provider === 'opencodego' && Date.now() < opencodegoBlockedUntil;
        if (alreadyBlocked) {
            outcome.lastError = OPENCODEGO_LIMIT_MESSAGE;
        } else {
            outcome = await askModels(analyzer, messages, models,
                openrouterFirst ? process.env.AI_VISION_OPENROUTER_STRONG_MODEL : process.env.AI_VISION_STRONG_MODEL);
        }

        // OpenCode Go's quota is spent: remember it for a while and carry on with OpenRouter
        if (!outcome.found && analyzer.provider === 'opencodego' && isUsageLimit(outcome.lastError)) {
            if (!alreadyBlocked) opencodegoBlockedUntil = Date.now() + resetDelay(outcome.lastError);
            if (canUseOpenRouter && Date.now() < openrouterRejected.until) {
                outcome = { found: null, lastError: openrouterRejected.message };
            } else if (canUseOpenRouter) {
                logger.warn('OpenCode Go usage limit reached, using OpenRouter for comic panels');
                analyzer.provider = 'openrouter';
                outcome = await askModels(
                    analyzer, messages,
                    [process.env.AI_VISION_OPENROUTER_MODEL || analyzer.openrouterModel],
                    process.env.AI_VISION_OPENROUTER_STRONG_MODEL
                );
                // A rejected key fails the same way on every page: stop asking for a while
                if (!outcome.found && isAuthError(outcome.lastError)) {
                    openrouterRejected = { until: Date.now() + 10 * 60 * 1000, message: outcome.lastError };
                }
            }
        }

        const { found, lastError } = outcome;
        if (found) {
            fs.mkdirSync(CACHE_DIR, { recursive: true });
            fs.writeFileSync(cacheFile, JSON.stringify({ panels: found.panels }));
            return res.json({ panels: found.panels, cached: false, model: found.model });
        }

        if (isAuthError(lastError)) {
            const detail = String(lastError).replace(/^.*?Error:\s*/, '').replace(/\.$/, '');
            return res.status(503).json({ error: `The AI provider rejected the API key (${detail})` });
        }
        if (isUsageLimit(lastError)) {
            const limit = /usage limit reached \([^)]*\)/i.exec(lastError);
            return res.status(429).json({ error: limit ? `AI ${limit[0]}` : 'AI usage limit reached' });
        }
        res.status(502).json({ error: lastError });
    } catch (error) {
        logger.error(`Comic panel detection error: ${error.message}`);
        res.status(500).json({ error: 'Panel detection failed' });
    }
}

/** Forget that OpenCode Go ran out of quota (used by the tests). */
function resetProviderLimits() {
    opencodegoBlockedUntil = 0;
    openrouterRejected = { until: 0, message: '' };
    resetDecisionBackoff();
}

module.exports = { detectComicPanels, parsePanels, isFullPage, resetProviderLimits };
