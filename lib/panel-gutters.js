const jpeg = require('jpeg-js');

const GRID_SIDE = 500;       // the page is sampled on a grid of about this many cells along its long side
const BACKGROUND_TOLERANCE = 28;  // gray levels from the page background that still count as background
const GUTTER_INK = 0.012;    // a row or column with less ink than this is part of a gutter
const GUTTER_SIZE = 0.012;   // narrowest gutter, as a fraction of the page side
const MIN_SIDE = 0.03;
const MIN_AREA = 0.015;
const MAX_PANELS = 12;
const MIN_COVERAGE = 0.35;
const FULL_PAGE_AREA = 0.7;

/** Sample the decoded image on a coarse grid of gray levels. */
function toGrid({ width, height, data }) {
    const step = Math.max(1, Math.floor(Math.max(width, height) / GRID_SIDE));
    const w = Math.floor(width / step);
    const h = Math.floor(height / step);
    const gray = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = ((y * step) * width + x * step) * 4;
            gray[y * w + x] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
        }
    }
    return { gray, w, h };
}

/** The page background is the median gray of the outer ring of the page. */
function backgroundLevel({ gray, w, h }) {
    const ring = Math.max(1, Math.round(Math.min(w, h) * 0.02));
    const levels = [];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (x < ring || y < ring || x >= w - ring || y >= h - ring) levels.push(gray[y * w + x]);
        }
    }
    levels.sort((a, b) => a - b);
    return levels[levels.length >> 1];
}

/** Ink fraction of every row (axis 'y') or column (axis 'x') of a box. */
function profile(ink, w, box, axis) {
    const rows = axis === 'y';
    const out = new Array(rows ? box.y1 - box.y0 : box.x1 - box.x0).fill(0);
    for (let y = box.y0; y < box.y1; y++) {
        for (let x = box.x0; x < box.x1; x++) {
            if (ink[y * w + x]) out[rows ? y - box.y0 : x - box.x0]++;
        }
    }
    const length = rows ? box.x1 - box.x0 : box.y1 - box.y0;
    return out.map((count) => count / length);
}

/** Runs of content in a profile, split wherever a gap of at least minGap cells separates them. */
function spans(values, minGap) {
    const out = [];
    let start = -1;
    let last = -1;
    values.forEach((value, i) => {
        if (value <= GUTTER_INK) return;
        if (start >= 0 && i - last - 1 >= minGap) {
            out.push([start, last + 1]);
            start = -1;
        }
        if (start < 0) start = i;
        last = i;
    });
    if (start >= 0) out.push([start, last + 1]);
    return out;
}

/** Shrink a box to the rows and columns that hold content; null when it holds none. */
function trim(ink, w, box) {
    const rows = spans(profile(ink, w, box, 'y'), Infinity);
    if (rows.length === 0) return null;
    const rowTrimmed = { ...box, y0: box.y0 + rows[0][0], y1: box.y0 + rows[0][1] };
    const cols = spans(profile(ink, w, rowTrimmed, 'x'), Infinity);
    if (cols.length === 0) return null;
    return { ...rowTrimmed, x0: box.x0 + cols[0][0], x1: box.x0 + cols[0][1] };
}

/** Cut a box along the gutters that run across it on the given axis. */
function cut(ink, w, box, axis) {
    const rows = axis === 'y';
    const minGap = Math.max(2, Math.round((rows ? box.gh : box.gw) * GUTTER_SIZE));
    return spans(profile(ink, w, box, axis), minGap).map(([a, b]) => (rows
        ? { ...box, y0: box.y0 + a, y1: box.y0 + b }
        : { ...box, x0: box.x0 + a, x1: box.x0 + b }));
}

/** X-Y cut: split along row gutters, then column gutters, and so on until no gutter is left. */
function split(ink, w, box, axis, leaves, otherTried = false) {
    const inner = trim(ink, w, box);
    if (!inner) return;
    const parts = cut(ink, w, inner, axis);
    const next = axis === 'y' ? 'x' : 'y';
    if (parts.length > 1) {
        parts.forEach((part) => split(ink, w, part, next, leaves));
    } else if (!otherTried) {
        split(ink, w, inner, next, leaves, true);
    } else {
        leaves.push(inner);
    }
}

/**
 * Find comic panels by their gutters: the bands of page background between them.
 * Returns panels as fractions of the image in reading order, or null when the layout is not
 * clear enough to trust (not a JPEG, no gutters, borderless art), so the caller can ask an AI.
 */
function detectPanelsByGutters(jpegBuffer) {
    let image;
    try {
        image = jpeg.decode(jpegBuffer, { useTArray: true, maxMemoryUsageInMB: 512 });
    } catch (e) {
        return null;
    }

    const { gray, w, h } = toGrid(image);
    if (w < 20 || h < 20) return null;

    const background = backgroundLevel({ gray, w, h });
    const ink = new Uint8Array(w * h);
    let inkCount = 0;
    for (let i = 0; i < ink.length; i++) {
        if (Math.abs(gray[i] - background) > BACKGROUND_TOLERANCE) {
            ink[i] = 1;
            inkCount++;
        }
    }
    const inkRatio = inkCount / ink.length;
    if (inkRatio < 0.02 || inkRatio > 0.97) return null;

    const leaves = [];
    split(ink, w, { x0: 0, y0: 0, x1: w, y1: h, gw: w, gh: h }, 'y', leaves);

    const panels = leaves
        .map((b) => ({ x: b.x0 / w, y: b.y0 / h, w: (b.x1 - b.x0) / w, h: (b.y1 - b.y0) / h }))
        .filter((p) => p.w >= MIN_SIDE && p.h >= MIN_SIDE && p.w * p.h >= MIN_AREA)
        .map((p) => ({ x: round(p.x), y: round(p.y), w: round(p.w), h: round(p.h) }));

    if (panels.length === 0 || panels.length > MAX_PANELS) return null;
    // A single page-sized panel is as likely a missed layout as a splash page
    if (panels.length === 1 && panels[0].w * panels[0].h >= FULL_PAGE_AREA) return null;
    if (panels.reduce((sum, p) => sum + p.w * p.h, 0) < MIN_COVERAGE) return null;
    return panels;
}

function round(value) {
    return Math.round(value * 10000) / 10000;
}

module.exports = { detectPanelsByGutters };
