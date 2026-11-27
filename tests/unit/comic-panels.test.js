const path = require('path');

const mockHome = path.join(require('os').tmpdir(), `comic-panels-test-${process.pid}`);
jest.mock('os', () => ({ ...jest.requireActual('os'), homedir: () => mockHome }));

const mockMakeAIRequest = jest.fn();
let mockOpenRouterKey = null;
jest.mock('../../lib/ai-file-analyzer', () => jest.fn().mockImplementation(() => ({
    opencodegoApiKey: 'key',
    provider: 'opencodego',
    opencodegoModel: 'light',
    opencodegoFallbackModels: ['mid'],
    openrouterApiKey: mockOpenRouterKey,
    openrouterModel: 'or-model',
    makeAIRequest: mockMakeAIRequest
})));
jest.mock('../../lib/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const fs = require('fs');
const crypto = require('crypto');
const jpeg = require('jpeg-js');
const { detectComicPanels, parsePanels, isFullPage, resetProviderLimits } = require('../../lib/comic-panels');

const LIMIT_ERROR = {
    success: false,
    error: 'opencodego API Error: OpenCode Go usage limit reached (5-hour, resets in 3h 12m). To keep going now, upgrade.'
};

const FULL = [{ x: 0, y: 0, w: 1, h: 1 }];
const SIX = [0, 1, 2].flatMap((row) => [0, 1].map((col) => ({ x: col * 0.5, y: row / 3, w: 0.5, h: 1 / 3 })));
const reply = (panels, model) => ({ success: true, content: JSON.stringify({ panels }), stats: { model } });

function runDetect(image = crypto.randomBytes(16)) {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    return detectComicPanels({ body: image }, res).then(() => res);
}

describe('comic panel detection', () => {
    beforeEach(() => {
        mockMakeAIRequest.mockReset();
        mockOpenRouterKey = null;
        resetProviderLimits();
        delete process.env.AI_VISION_MODEL;
        delete process.env.AI_VISION_STRONG_MODEL;
    });

    afterAll(() => fs.rmSync(mockHome, { recursive: true, force: true }));

    test('isFullPage tells a page-sized panel from a real layout', () => {
        expect(isFullPage(FULL)).toBe(true);
        expect(isFullPage([{ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }])).toBe(false);
        expect(isFullPage(SIX)).toBe(false);
    });

    test('parsePanels keeps valid panels and drops tiny ones', () => {
        const panels = parsePanels('{"panels":[{"x":0,"y":0,"w":0.5,"h":0.5},{"x":0,"y":0,"w":0.01,"h":0.5}]}');
        expect(panels).toHaveLength(1);
    });

    test('the reply carries the cost of every model call made for the page', async () => {
        process.env.AI_VISION_MODEL = 'light';
        process.env.AI_VISION_STRONG_MODEL = 'strong';
        const priced = (panels, model, cost) => ({ ...reply(panels, model), stats: { model, cost } });
        mockMakeAIRequest.mockResolvedValueOnce(priced(FULL, 'light', 0.0001)).mockResolvedValueOnce(priced(SIX, 'strong', 0.002));

        const res = await runDetect();

        expect(res.json.mock.calls[0][0].cost).toBeCloseTo(0.0021);
    });

    test('no cost is reported when the provider gives none', async () => {
        mockMakeAIRequest.mockResolvedValueOnce(reply(SIX, 'light'));
        const res = await runDetect();
        expect(res.json.mock.calls[0][0]).not.toHaveProperty('cost');
    });

    test('a full-page answer is re-asked of the strong model, whose answer wins', async () => {
        process.env.AI_VISION_MODEL = 'light';
        process.env.AI_VISION_STRONG_MODEL = 'strong';
        mockMakeAIRequest.mockResolvedValueOnce(reply(FULL, 'light')).mockResolvedValueOnce(reply(SIX, 'strong'));

        const res = await runDetect();

        expect(mockMakeAIRequest.mock.calls.map((c) => c[1].model)).toEqual(['light', 'strong']);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ panels: SIX, model: 'strong' }));
    });

    test('the full-page answer is kept when the strong model fails', async () => {
        process.env.AI_VISION_MODEL = 'light';
        process.env.AI_VISION_STRONG_MODEL = 'strong';
        mockMakeAIRequest
            .mockResolvedValueOnce(reply(FULL, 'light'))
            .mockResolvedValueOnce({ success: false, error: 'boom' })
            .mockResolvedValue({ success: false, error: 'boom' });

        const res = await runDetect();

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ panels: FULL }));
    });

    test('a layout with several panels is accepted without asking the strong model', async () => {
        process.env.AI_VISION_MODEL = 'light';
        process.env.AI_VISION_STRONG_MODEL = 'strong';
        mockMakeAIRequest.mockResolvedValueOnce(reply(SIX, 'light'));

        await runDetect();

        expect(mockMakeAIRequest).toHaveBeenCalledTimes(1);
    });

    test('without a strong model a full-page answer is accepted as is', async () => {
        process.env.AI_VISION_MODEL = 'light';
        mockMakeAIRequest.mockResolvedValueOnce(reply(FULL, 'light'));

        const res = await runDetect();

        expect(mockMakeAIRequest).toHaveBeenCalledTimes(1);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ panels: FULL }));
    });

    test('a usage-limit error stops after one call and answers 429', async () => {
        mockMakeAIRequest.mockResolvedValue(LIMIT_ERROR);

        const res = await runDetect();

        expect(mockMakeAIRequest).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith({ error: 'AI usage limit reached (5-hour, resets in 3h 12m)' });
    });

    test('once the limit is known, later pages skip OpenCode Go without calling it', async () => {
        mockMakeAIRequest.mockResolvedValue(LIMIT_ERROR);

        await runDetect();
        const res = await runDetect();

        expect(mockMakeAIRequest).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(429);
    });

    test('on a usage limit the page goes to OpenRouter, and later pages start there', async () => {
        mockOpenRouterKey = 'or-key';
        mockMakeAIRequest
            .mockResolvedValueOnce(LIMIT_ERROR)
            .mockResolvedValueOnce(reply(SIX, 'or-model'))
            .mockResolvedValueOnce(reply(SIX, 'or-model'));

        const first = await runDetect();
        const second = await runDetect();

        expect(mockMakeAIRequest.mock.calls.map((c) => c[1].model)).toEqual(['light', 'or-model', 'or-model']);
        expect(first.json).toHaveBeenCalledWith(expect.objectContaining({ panels: SIX, model: 'or-model' }));
        expect(second.json).toHaveBeenCalledWith(expect.objectContaining({ panels: SIX }));
    });

    test('a rejected OpenRouter key answers 503 and later pages do not call it again', async () => {
        mockOpenRouterKey = 'bad-key';
        mockMakeAIRequest
            .mockResolvedValueOnce(LIMIT_ERROR)
            .mockResolvedValueOnce({ success: false, error: 'openrouter API Error: User not found.' });

        const first = await runDetect();
        const second = await runDetect();

        expect(mockMakeAIRequest).toHaveBeenCalledTimes(2);
        expect(first.status).toHaveBeenCalledWith(503);
        expect(first.json).toHaveBeenCalledWith({ error: 'The AI provider rejected the API key (User not found)' });
        expect(second.status).toHaveBeenCalledWith(503);
    });

    test('OPENROUTER vision model can be chosen with AI_VISION_OPENROUTER_MODEL', async () => {
        mockOpenRouterKey = 'or-key';
        process.env.AI_VISION_OPENROUTER_MODEL = 'vision/pick';
        mockMakeAIRequest.mockResolvedValueOnce(LIMIT_ERROR).mockResolvedValueOnce(reply(SIX, 'vision/pick'));

        try {
            await runDetect();
        } finally {
            delete process.env.AI_VISION_OPENROUTER_MODEL;
        }

        expect(mockMakeAIRequest.mock.calls[1][1].model).toBe('vision/pick');
    });

    test('AI_VISION_PROVIDER=openrouter asks the OpenRouter model first and never OpenCode Go', async () => {
        mockOpenRouterKey = 'or-key';
        process.env.AI_VISION_PROVIDER = 'openrouter';
        process.env.AI_VISION_OPENROUTER_MODEL = 'google/lite';
        process.env.AI_VISION_MODEL = 'grok';
        mockMakeAIRequest.mockResolvedValueOnce(reply(SIX, 'google/lite'));

        try {
            await runDetect();
        } finally {
            delete process.env.AI_VISION_PROVIDER;
            delete process.env.AI_VISION_OPENROUTER_MODEL;
        }

        expect(mockMakeAIRequest).toHaveBeenCalledTimes(1);
        expect(mockMakeAIRequest.mock.calls[0][1].model).toBe('google/lite');
    });

    describe('decision model tier', () => {
        const answers = {
            panel1: { box: { left: 0.05, top: 0.05, right: 0.96, bottom: 0.39 } }, exists1: { noul: 0.99 },
            panel2: { box: { left: 0.05, top: 0.41, right: 0.49, bottom: 0.97 } }, exists2: { noul: 0.99 },
            exists3: { noul: 0.01 }
        };
        beforeEach(() => {
            process.env.AI_VISION_DECISION_MODEL = 'typesafe/jev-1.14';
            process.env.OPENROUTER_API_KEY = 'or-key';
        });
        afterEach(() => {
            delete process.env.AI_VISION_DECISION_MODEL;
            delete process.env.OPENROUTER_API_KEY;
            delete global.fetch;
        });

        test('answers the page without asking an LLM', async () => {
            global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ answers }) });
            const res = await runDetect();
            expect(mockMakeAIRequest).not.toHaveBeenCalled();
            expect(res.json.mock.calls[0][0]).toMatchObject({ source: 'decision', model: 'typesafe/jev-1.14' });
            expect(res.json.mock.calls[0][0].panels).toHaveLength(2);
        });

        test('falls through to the LLM when the decision model fails', async () => {
            global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
            mockMakeAIRequest.mockResolvedValueOnce(reply(SIX, 'light'));
            const res = await runDetect();
            expect(mockMakeAIRequest).toHaveBeenCalledTimes(1);
            expect(res.json.mock.calls[0][0].panels).toHaveLength(6);
        });
    });

    describe('gutter detection tier', () => {
        // Two dark panels side by side on a white page
        const twoPanels = (h = 300) => {
            const w = 200;
            const data = Buffer.alloc(w * h * 4, 255);
            for (let y = 20; y < h - 20; y++) {
                for (let x = 0; x < w; x++) {
                    if ((x >= 10 && x < 95) || (x >= 105 && x < 190)) data.set([30, 40, 60, 255], (y * w + x) * 4);
                }
            }
            return jpeg.encode({ data, width: w, height: h }, 90).data;
        };

        test('a page with clear gutters is answered without asking an AI', async () => {
            const res = await runDetect(twoPanels());
            expect(mockMakeAIRequest).not.toHaveBeenCalled();
            expect(res.json.mock.calls[0][0]).toMatchObject({ cached: false, source: 'gutters' });
            expect(res.json.mock.calls[0][0].panels).toHaveLength(2);
        });

        test('COMIC_PANELS_GUTTERS=false sends the page to the AI instead', async () => {
            process.env.COMIC_PANELS_GUTTERS = 'false';
            mockMakeAIRequest.mockResolvedValueOnce(reply(SIX, 'light'));
            try {
                await runDetect(twoPanels(320));
            } finally {
                delete process.env.COMIC_PANELS_GUTTERS;
            }
            expect(mockMakeAIRequest).toHaveBeenCalledTimes(1);
        });
    });
});
