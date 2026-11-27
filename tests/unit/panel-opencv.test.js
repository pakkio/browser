const path = require('path');

jest.mock('../../lib/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const mockExecFile = jest.fn();
jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), execFile: (...args) => mockExecFile(...args) }));

const fs = require('fs');
const os = require('os');
const jpeg = require('jpeg-js');
const { detectPanelsWithOpenCV, convertPanels, jpegSize, detectorScript, parseLlmCost } = require('../../lib/panel-opencv');

const page = (width = 200, height = 300) =>
    jpeg.encode({ data: Buffer.alloc(width * height * 4, 255), width, height }, 80).data;

/** Fake detector run: writes the given JSON files into the -o folder like panel_detector.py does. */
function fakeDetector(files, error = null, log = '') {
    mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        const out = args[args.indexOf('-o') + 1];
        for (const [name, value] of Object.entries(files)) {
            fs.writeFileSync(path.join(out, name), JSON.stringify(value));
        }
        cb(error, '', error ? 'Traceback\nModuleNotFoundError: No module named cv2' : log);
    });
}

describe('OpenCV panel detector tier', () => {
    const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-opencv-test-'));
    const script = path.join(scriptDir, 'panel_detector.py');
    fs.writeFileSync(script, '');

    beforeEach(() => mockExecFile.mockReset());
    afterAll(() => fs.rmSync(scriptDir, { recursive: true, force: true }));

    test('jpegSize reads the frame size', () => {
        expect(jpegSize(page(200, 300))).toEqual({ width: 200, height: 300 });
        expect(jpegSize(Buffer.from('not a jpeg'))).toBeNull();
    });

    test('detectorScript accepts the folder or the script', () => {
        expect(detectorScript(scriptDir)).toBe(script);
        expect(detectorScript(script)).toBe(script);
        expect(detectorScript('')).toBeNull();
    });

    test('convertPanels turns pixel boxes into page fractions and drops slivers', () => {
        const panels = convertPanels(
            [{ bbox: [20, 30, 100, 150] }, { bbox: [0, 0, 2, 300] }, { bbox: 'bad' }],
            null, { width: 200, height: 300 });
        expect(panels).toEqual([{ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }]);
        expect(convertPanels([], null, { width: 200, height: 300 })).toBeNull();
    });

    test('a cover or ad page becomes one full-page panel', () => {
        expect(convertPanels([], { page_type: 'cover' }, { width: 1, height: 1 })).toEqual([{ x: 0, y: 0, w: 1, h: 1 }]);
    });

    test('runs the detector and returns its panels', async () => {
        fakeDetector({ 'page_panels.json': [{ bbox: [0, 0, 100, 300] }, { bbox: [100, 0, 100, 300] }] });
        const panels = await detectPanelsWithOpenCV(page(), { detector: scriptDir, python: 'py' });
        expect(panels).toEqual([{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }]);
        const [cmd, args, opts] = mockExecFile.mock.calls[0];
        expect(cmd).toBe('py');
        expect(args).not.toContain('--llm-verify');
        expect(opts.env.OPENROUTER_API_KEY).toBeUndefined();
    });

    test('with an OpenRouter key the model reviews doubtful pages', async () => {
        fakeDetector({ 'page_panels.json': [{ bbox: [0, 0, 100, 300] }] });
        await detectPanelsWithOpenCV(page(), { detector: scriptDir, apiKey: 'or-key', model: 'qwen/qwen3.7-flash' });
        const [, args, opts] = mockExecFile.mock.calls[0];
        expect(args).toEqual(expect.arrayContaining(['--llm-verify', '--llm-page-type', '--llm-model', 'qwen/qwen3.7-flash']));
        expect(opts.env.OPENROUTER_API_KEY).toBe('or-key');
    });

    test('parseLlmCost reads the detector summary line', () => {
        expect(parseLlmCost('x - INFO - LLM: 2 call(s), 1 cache hit(s), ~$0.00031 [answered by q x2]')).toBe(0.00031);
        expect(parseLlmCost('x - INFO - LLM: 0 call(s), 3 cache hit(s), $0 [q]')).toBe(0);
        expect(parseLlmCost('no model was used')).toBeNull();
    });

    test('reports what the model cost', async () => {
        fakeDetector({ 'page_panels.json': [{ bbox: [0, 0, 100, 300] }] }, null,
            'x - INFO - LLM: 1 call(s), 0 cache hit(s), ~$0.00020 [answered by qwen/qwen3.7-flash x1]');
        const onCost = jest.fn();
        await detectPanelsWithOpenCV(page(), { detector: scriptDir, apiKey: 'k', onCost });
        expect(onCost).toHaveBeenCalledWith(0.0002);
    });

    test('a failing detector or a missing script gives null', async () => {
        fakeDetector({}, new Error('exit 1'));
        expect(await detectPanelsWithOpenCV(page(), { detector: scriptDir })).toBeNull();
        expect(await detectPanelsWithOpenCV(page(), { detector: path.join(scriptDir, 'missing') })).toBeNull();
        expect(await detectPanelsWithOpenCV(page(), {})).toBeNull();
    });
});
