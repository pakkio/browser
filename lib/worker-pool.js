const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');

const DEFAULT_MAX_WORKERS = Math.max(1, Math.min(4, (os.cpus()?.length || 2) - 1));
const WORKER_IDLE_TIMEOUT_MS = 60 * 1000;
const WORKER_SCRIPT = path.join(__dirname, 'cpu-worker.js');

/**
 * Limit how many async tasks run concurrently (e.g. stat calls on a large directory or ffmpeg spawns).
 */
async function mapWithConcurrency(items, concurrency, fn) {
    const limit = Math.max(1, concurrency || 16);
    const results = new Array(items.length);
    let nextIndex = 0;

    async function runner() {
        while (nextIndex < items.length) {
            const idx = nextIndex++;
            results[idx] = await fn(items[idx], idx);
        }
    }

    const workers = [];
    const count = Math.min(limit, items.length);
    for (let i = 0; i < count; i++) {
        workers.push(runner());
    }
    await Promise.all(workers);
    return results;
}

/**
 * Create a semaphore function `withLimit(fn)` that runs at most `concurrency` promises at once.
 */
function createLimiter(concurrency) {
    const limit = Math.max(1, concurrency || 4);
    let active = 0;
    const queue = [];

    const next = () => {
        if (active >= limit || queue.length === 0) return;
        active++;
        const { fn, resolve, reject } = queue.shift();
        Promise.resolve()
            .then(fn)
            .then(resolve, reject)
            .finally(() => {
                active--;
                next();
            });
    };

    return function withLimit(fn) {
        return new Promise((resolve, reject) => {
            queue.push({ fn, resolve, reject });
            next();
        });
    };
}

/**
 * Lightweight lazy worker_threads pool for offloading CPU-bound tasks from the main event loop.
 * Workers are spawned on demand up to `maxWorkers` and unref'd / retired when idle so tests and
 * server shutdown never hang.
 */
class WorkerPool {
    constructor(maxWorkers = DEFAULT_MAX_WORKERS) {
        this.maxWorkers = maxWorkers;
        this.workers = new Set();
        this.idleWorkers = [];
        this.queue = [];
        this.nextTaskId = 1;
    }

    run(type, payload, timeoutMs = 45000) {
        // In Jest environments with mocked modules or when threads are disabled, allow direct fallback
        if (process.env.WORKER_POOL_DISABLED === 'true' || process.env.JEST_WORKER_ID !== undefined) {
            const { executeTask } = require('./cpu-worker');
            return executeTask(type, payload);
        }

        return new Promise((resolve, reject) => {
            const task = {
                id: this.nextTaskId++,
                type,
                payload,
                resolve,
                reject,
                timeoutMs,
                timer: null
            };
            this.queue.push(task);
            this._dispatch();
        });
    }

    _dispatch() {
        if (this.queue.length === 0) return;

        let workerEntry = this.idleWorkers.pop();
        if (!workerEntry && this.workers.size < this.maxWorkers) {
            workerEntry = this._createWorker();
        }
        if (!workerEntry) return;

        const task = this.queue.shift();
        if (workerEntry.idleTimer) {
            clearTimeout(workerEntry.idleTimer);
            workerEntry.idleTimer = null;
        }

        workerEntry.currentTask = task;
        if (task.timeoutMs > 0) {
            task.timer = setTimeout(() => {
                if (workerEntry.currentTask === task) {
                    workerEntry.currentTask = null;
                    this._removeWorker(workerEntry);
                    task.reject(new Error(`Worker task '${task.type}' timed out after ${task.timeoutMs}ms`));
                    this._dispatch();
                }
            }, task.timeoutMs);
            task.timer.unref?.();
        }

        workerEntry.worker.ref();
        workerEntry.worker.postMessage({ id: task.id, type: task.type, payload: task.payload });
    }

    _createWorker() {
        const worker = new Worker(WORKER_SCRIPT);
        worker.unref();
        const entry = { worker, currentTask: null, idleTimer: null };
        this.workers.add(entry);

        worker.on('message', (msg) => {
            const task = entry.currentTask;
            if (!task || msg.id !== task.id) return;
            entry.currentTask = null;
            if (task.timer) clearTimeout(task.timer);

            if (msg.error) {
                task.reject(new Error(msg.error));
            } else {
                task.resolve(msg.result);
            }

            this._releaseWorker(entry);
        });

        worker.on('error', (err) => {
            const task = entry.currentTask;
            entry.currentTask = null;
            if (task) {
                if (task.timer) clearTimeout(task.timer);
                task.reject(err);
            }
            this._removeWorker(entry);
            this._dispatch();
        });

        worker.on('exit', (code) => {
            const task = entry.currentTask;
            entry.currentTask = null;
            if (task) {
                if (task.timer) clearTimeout(task.timer);
                task.reject(new Error(`Worker exited unexpectedly with code ${code}`));
            }
            this._removeWorker(entry);
            this._dispatch();
        });

        return entry;
    }

    _releaseWorker(entry) {
        if (!this.workers.has(entry)) return;
        if (this.queue.length > 0) {
            this.idleWorkers.push(entry);
            this._dispatch();
            return;
        }
        entry.worker.unref();
        entry.idleTimer = setTimeout(() => {
            this._removeWorker(entry);
        }, WORKER_IDLE_TIMEOUT_MS);
        entry.idleTimer.unref?.();
        this.idleWorkers.push(entry);
    }

    _removeWorker(entry) {
        if (entry.idleTimer) {
            clearTimeout(entry.idleTimer);
            entry.idleTimer = null;
        }
        this.workers.delete(entry);
        const idx = this.idleWorkers.indexOf(entry);
        if (idx !== -1) this.idleWorkers.splice(idx, 1);
        try {
            entry.worker.terminate();
        } catch (e) {}
    }

    async destroy() {
        for (const entry of Array.from(this.workers)) {
            this._removeWorker(entry);
        }
    }
}

const defaultPool = new WorkerPool();

module.exports = {
    WorkerPool,
    defaultPool,
    mapWithConcurrency,
    createLimiter
};
