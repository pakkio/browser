const logger = require('./logger');

const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const MAX_ASKED = 8;           // panels asked for in one request
const MIN_SIDE = 0.03;
const FULL_PAGE_AREA = 0.7;
const SAME_PANEL_OVERLAP = 0.8;
const REQUEST_TIMEOUT_MS = 20000;
const BACKOFF_MS = 10 * 60 * 1000;

// After a failed request, until when not to ask again (a bad key or no credit fails every page)
let blockedUntil = 0;

/** One box question and one yes/no question per panel: a box always has four edges, even for a panel that is not there. */
function buildQuestions() {
    const questions = {};
    for (let i = 1; i <= MAX_ASKED; i++) {
        questions[`panel${i}`] = {
            type: 'box',
            instructions: `panel number ${i} of the comic page in reading order (top row first, left to right), the whole frame including its border`
        };
        questions[`exists${i}`] = {
            type: 'noul',
            instructions: `The comic page has at least ${i} panel${i > 1 ? 's' : ''}.`
        };
    }
    return questions;
}

function overlap(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (w <= 0 || h <= 0) return 0;
    return (w * h) / Math.min(a.w * a.h, b.w * b.h);
}

/** Turn the model's answers into panels in reading order. Returns null when unusable. */
function parseDecisions(answers) {
    if (!answers) return null;
    const panels = [];
    for (let i = 1; i <= MAX_ASKED; i++) {
        if (!(answers[`exists${i}`]?.noul >= 0.5)) break;
        const box = answers[`panel${i}`]?.box;
        if (!box) break;
        const x = Math.max(0, Math.min(1, Number(box.left)));
        const y = Math.max(0, Math.min(1, Number(box.top)));
        const panel = { x, y, w: Math.min(1, Number(box.right)) - x, h: Math.min(1, Number(box.bottom)) - y };
        if (![panel.x, panel.y, panel.w, panel.h].every(Number.isFinite) || panel.w < MIN_SIDE || panel.h < MIN_SIDE) continue;
        if (panels.some((p) => overlap(p, panel) >= SAME_PANEL_OVERLAP)) continue;
        panels.push({ x, y, w: round(panel.w), h: round(panel.h) });
    }
    if (panels.length === 0) return null;
    // A single page-sized panel is as likely a miss as a splash page, as with the other tiers
    if (panels.length === 1 && panels[0].w * panels[0].h >= FULL_PAGE_AREA) return null;
    return panels;
}

function round(value) {
    return Math.round(value * 10000) / 10000;
}

/**
 * Ask an OpenRouter decision model (such as typesafe/jev-1.14, the only one that answers box
 * questions) to locate the panels. It reads the page in one pass and generates no text, so it is
 * faster and cheaper than a vision LLM. Returns panels as fractions of the image, or null.
 */
async function detectPanelsByDecisions(image, { model, apiKey, onCost }) {
    if (!model || !apiKey || Date.now() < blockedUntil) return null;
    try {
        const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                state: ['One page of a comic book:', { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` } }],
                questions: buildQuestions()
            }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        if (!response.ok) {
            blockedUntil = Date.now() + BACKOFF_MS;
            logger.warn(`Comic panel decision model ${model} answered ${response.status}, pausing it for 10 minutes`);
            return null;
        }
        const body = await response.json();
        if (onCost && typeof body.usage?.cost === 'number') onCost(body.usage.cost);
        const panels = parseDecisions(body.answers);
        if (!panels) logger.info(`Comic panel decision model ${model} found no usable layout`);
        return panels;
    } catch (error) {
        logger.warn(`Comic panel decision request failed: ${error.message}`);
        return null;
    }
}

/** Forget a pause after a failed request (used by the tests). */
function resetDecisionBackoff() {
    blockedUntil = 0;
}

module.exports = { detectPanelsByDecisions, parseDecisions, resetDecisionBackoff };
