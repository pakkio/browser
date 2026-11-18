const { WorkerPool, mapWithConcurrency, createLimiter } = require('../../lib/worker-pool');

describe('worker-pool and concurrency helpers', () => {
    test('mapWithConcurrency preserves order and enforces concurrency bound', async () => {
        let active = 0;
        let maxActive = 0;
        const items = [10, 20, 30, 40, 50, 60, 70, 80];

        const results = await mapWithConcurrency(items, 3, async (item, idx) => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise((r) => setTimeout(r, 5));
            active--;
            return item + idx;
        });

        expect(maxActive).toBeLessThanOrEqual(3);
        expect(results).toEqual([10, 21, 32, 43, 54, 65, 76, 87]);
    });

    test('createLimiter limits concurrent task execution', async () => {
        const limit = createLimiter(2);
        let active = 0;
        let maxActive = 0;

        const tasks = Array.from({ length: 6 }, (_, i) =>
            limit(async () => {
                active++;
                maxActive = Math.max(maxActive, active);
                await new Promise((r) => setTimeout(r, 5));
                active--;
                return i * 2;
            })
        );

        const out = await Promise.all(tasks);
        expect(maxActive).toBeLessThanOrEqual(2);
        expect(out).toEqual([0, 2, 4, 6, 8, 10]);
    });

    test('WorkerPool executes tasks across worker threads', async () => {
        const prevJest = process.env.JEST_WORKER_ID;
        delete process.env.JEST_WORKER_ID;
        const pool = new WorkerPool(2);
        try {
            await expect(pool.run('unknownType', {})).rejects.toThrow(/Unknown worker task type/);
        } finally {
            if (prevJest !== undefined) process.env.JEST_WORKER_ID = prevJest;
            await pool.destroy();
        }
    });
});
