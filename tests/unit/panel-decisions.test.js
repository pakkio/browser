jest.mock('../../lib/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { detectPanelsByDecisions, parseDecisions, resetDecisionBackoff } = require('../../lib/panel-decisions');

const box = (left, top, right, bottom) => ({ type: 'box', box: { left, top, right, bottom }, confidence: 0.9 });
const yes = { type: 'noul', noul: 0.99 };
const no = { type: 'noul', noul: 0.01 };

const THREE = {
    panel1: box(0.05, 0.05, 0.96, 0.39), exists1: yes,
    panel2: box(0.05, 0.41, 0.49, 0.97), exists2: yes,
    panel3: box(0.52, 0.42, 0.95, 0.96), exists3: yes,
    panel4: box(0.52, 0.4, 0.96, 0.96), exists4: no
};

describe('panel decisions', () => {
    afterEach(() => {
        delete global.fetch;
        resetDecisionBackoff();
    });

    test('parseDecisions keeps the panels that exist, in order, with width and height', () => {
        const panels = parseDecisions(THREE);
        expect(panels).toHaveLength(3);
        expect(panels[0]).toEqual({ x: 0.05, y: 0.05, w: 0.91, h: 0.34 });
        expect(panels[2].x).toBeGreaterThan(panels[1].x);
    });

    test('parseDecisions drops a repeated panel and tiny ones', () => {
        const panels = parseDecisions({
            panel1: box(0.05, 0.05, 0.96, 0.39), exists1: yes,
            panel2: box(0.06, 0.05, 0.96, 0.39), exists2: yes,
            panel3: box(0.1, 0.5, 0.11, 0.9), exists3: yes,
            panel4: box(0.1, 0.5, 0.9, 0.9), exists4: yes
        });
        expect(panels).toHaveLength(2);
    });

    test('parseDecisions is unsure about nothing or one page-sized panel', () => {
        expect(parseDecisions(null)).toBeNull();
        expect(parseDecisions({ panel1: box(0, 0, 1, 1), exists1: no })).toBeNull();
        expect(parseDecisions({ panel1: box(0.02, 0.02, 0.98, 0.98), exists1: yes, exists2: no })).toBeNull();
    });

    test('sends the page and the questions to the decisions endpoint', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ answers: THREE }) });
        const panels = await detectPanelsByDecisions(Buffer.from('jpeg'), { model: 'typesafe/jev-1.14', apiKey: 'k' });

        expect(panels).toHaveLength(3);
        const [url, init] = global.fetch.mock.calls[0];
        expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
        expect(init.headers.Authorization).toBe('Bearer k');
        const body = JSON.parse(init.body);
        expect(body.model).toBe('typesafe/jev-1.14');
        expect(body.state[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
        expect(body.questions.panel1.type).toBe('box');
        expect(body.questions.exists8.type).toBe('noul');
    });

    test('does nothing without a model or a key', async () => {
        global.fetch = jest.fn();
        expect(await detectPanelsByDecisions(Buffer.from('x'), { model: '', apiKey: 'k' })).toBeNull();
        expect(await detectPanelsByDecisions(Buffer.from('x'), { model: 'm', apiKey: undefined })).toBeNull();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('an error answer pauses the model so later pages do not wait on it', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 402 });
        expect(await detectPanelsByDecisions(Buffer.from('x'), { model: 'm', apiKey: 'k' })).toBeNull();
        expect(await detectPanelsByDecisions(Buffer.from('x'), { model: 'm', apiKey: 'k' })).toBeNull();
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('a network failure answers null without throwing', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
        expect(await detectPanelsByDecisions(Buffer.from('x'), { model: 'm', apiKey: 'k' })).toBeNull();
    });
});
