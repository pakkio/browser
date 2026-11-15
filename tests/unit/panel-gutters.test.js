const jpeg = require('jpeg-js');
const { detectPanelsByGutters } = require('../../lib/panel-gutters');

const W = 600;
const H = 900;

/** A page of the given background with dark panels (pixel boxes [x, y, w, h]) on it. */
function page(background, boxes, { panelColor = [40, 60, 90], noise = 0 } = {}) {
    const data = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) {
        data.set([...background, 255], i * 4);
    }
    for (const [bx, by, bw, bh] of boxes) {
        for (let y = by; y < by + bh; y++) {
            for (let x = bx; x < bx + bw; x++) {
                const jitter = noise ? Math.round((Math.sin(x * 7 + y * 13) * noise)) : 0;
                data.set([panelColor[0] + jitter, panelColor[1] + jitter, panelColor[2] + jitter, 255], (y * W + x) * 4);
            }
        }
    }
    return jpeg.encode({ data, width: W, height: H }, 90).data;
}

const GRID = [[30, 30, 255, 270], [315, 30, 255, 270], [30, 330, 255, 270], [315, 330, 255, 270], [30, 630, 540, 240]];

describe('panel detection by gutters', () => {
    test('finds a grid of panels in reading order', () => {
        const panels = detectPanelsByGutters(page([250, 250, 250], GRID));
        expect(panels).toHaveLength(5);
        expect(panels[0].x).toBeCloseTo(30 / W, 1);
        expect(panels[1].x).toBeGreaterThan(0.5);
        expect(panels[1].y).toBeCloseTo(panels[0].y, 1);
        expect(panels[2].y).toBeGreaterThan(panels[0].y + 0.2);
        expect(panels[4].w).toBeGreaterThan(0.85);
    });

    test('works on a yellowed page with textured art', () => {
        const panels = detectPanelsByGutters(page([228, 210, 160], GRID, { panelColor: [120, 90, 60], noise: 30 }));
        expect(panels).toHaveLength(5);
    });

    test('works on a dark page with light panels', () => {
        const panels = detectPanelsByGutters(page([10, 10, 10], GRID, { panelColor: [200, 190, 180] }));
        expect(panels).toHaveLength(5);
    });

    test('keeps a tall panel beside two stacked ones', () => {
        const panels = detectPanelsByGutters(page([250, 250, 250], [[30, 30, 255, 840], [315, 30, 255, 400], [315, 470, 255, 400]]));
        expect(panels).toHaveLength(3);
        expect(panels[0].h).toBeGreaterThan(0.85);
        expect(panels[1].y).toBeLessThan(panels[2].y);
    });

    test('is unsure about a splash page, so an AI gets asked', () => {
        expect(detectPanelsByGutters(page([250, 250, 250], [[10, 10, 580, 880]]))).toBeNull();
    });

    test('is unsure about a blank page', () => {
        expect(detectPanelsByGutters(page([250, 250, 250], []))).toBeNull();
    });

    test('is unsure about data that is not a JPEG', () => {
        expect(detectPanelsByGutters(Buffer.from('not an image'))).toBeNull();
    });
});
