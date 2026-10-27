const https = require('https');
const { EventEmitter } = require('events');

jest.mock('pdf-parse', () => jest.fn(), { virtual: true });

const ENV_KEYS = ['AI_PROVIDER', 'LMSTUDIO_URL', 'OPENROUTER_API_KEY', 'OPENCODEGO_API_KEY', 'OPENCODEGO_MODEL'];

function load(env) {
    ENV_KEYS.forEach(k => delete process.env[k]);
    Object.assign(process.env, env);
    jest.resetModules();
    const AIFileAnalyzer = require('../../lib/ai-file-analyzer');
    return new AIFileAnalyzer();
}

describe('AIFileAnalyzer providers', () => {
    afterEach(() => {
        ENV_KEYS.forEach(k => delete process.env[k]);
        jest.restoreAllMocks();
    });

    test('auto-detects opencodego when it is the only key', () => {
        expect(load({ OPENCODEGO_API_KEY: 'k' }).provider).toBe('opencodego');
    });

    test('prefers openrouter over opencodego in auto-detect', () => {
        expect(load({ OPENROUTER_API_KEY: 'a', OPENCODEGO_API_KEY: 'b' }).provider).toBe('openrouter');
    });

    test('opencodego config has endpoint, model and session header', () => {
        const cfg = load({ AI_PROVIDER: 'opencodego', OPENCODEGO_API_KEY: 'k' }).getAIConfig();
        expect(cfg.hostname).toBe('opencode.ai');
        expect(cfg.path).toBe('/zen/go/v1/chat/completions');
        expect(cfg.model).toBe('deepseek-v4.1-flash');
        expect(cfg.headers.Authorization).toBe('Bearer k');
        expect(cfg.headers['x-opencode-session']).toMatch(/^file-browser-/);
    });

    test('reports a missing opencodego key explicitly', async () => {
        const res = await load({ AI_PROVIDER: 'opencodego' }).makeAIRequest([]);
        expect(res.success).toBe(false);
        expect(res.error).toBe('OPENCODEGO_API_KEY is not set');
    });

    function mockResponse(body) {
        let sent;
        jest.spyOn(https, 'request').mockImplementation((opts, cb) => {
            const req = new EventEmitter();
            req.write = d => { sent = JSON.parse(d); };
            req.setTimeout = jest.fn();
            req.destroy = jest.fn();
            req.end = () => {
                const res = new EventEmitter();
                cb(res);
                res.emit('data', JSON.stringify(body));
                res.emit('end');
            };
            return req;
        });
        return () => sent;
    }

    test('sends response_format to opencodego', async () => {
        const sent = mockResponse({ choices: [{ message: { content: '{}' } }] });
        const a = load({ AI_PROVIDER: 'opencodego', OPENCODEGO_API_KEY: 'k' });
        const res = await a.makeAIRequest([], { response_format: { type: 'json_object' } });
        expect(res.success).toBe(true);
        expect(sent().response_format).toEqual({ type: 'json_object' });
    });

    test('treats null content as failure', async () => {
        mockResponse({ choices: [{ message: { content: null, reasoning_content: 'x' } }] });
        const a = load({ AI_PROVIDER: 'opencodego', OPENCODEGO_API_KEY: 'k' });
        const res = await a.makeAIRequest([]);
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/no content/);
    });
});
