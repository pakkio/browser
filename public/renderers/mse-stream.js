/**
 * Plays a server-side rewrapped/transcoded movie through Media Source Extensions.
 *
 * The server streams fragmented MP4 from any start time (/video-stream?start=). Only the part
 * being watched is ever processed, nothing is stored anywhere, and seeking outside the buffered
 * range just restarts the stream at the new position.
 */
class MseStream {
    /** Returns a ready stream bound to the video element, or null when the browser or file can't use it. */
    static async attach(video, filePath) {
        if (!window.MediaSource) return null;
        let info;
        try {
            const response = await fetch(`/api/video-stream-info?path=${encodeURIComponent(filePath)}`);
            if (!response.ok) return null;
            info = await response.json();
        } catch (e) {
            return null;
        }
        if (!MediaSource.isTypeSupported(info.mime)) return null;
        return new MseStream(video, filePath, info);
    }

    constructor(video, filePath, info) {
        this.video = video;
        this.filePath = filePath;
        this.info = info;
        this.generation = 0; // bumped on every (re)start so a superseded stream stops itself
        this.abort = null;
        this.sourceBuffer = null;
        this.destroyed = false;

        this.mediaSource = new MediaSource();
        this.url = URL.createObjectURL(this.mediaSource);
        this.onSeeking = () => this.handleSeeking();
        video.addEventListener('seeking', this.onSeeking);
        this.mediaSource.addEventListener('sourceopen', () => this.open(), { once: true });
        video.src = this.url;
    }

    open() {
        if (this.destroyed) return;
        this.mediaSource.duration = this.info.duration;
        this.sourceBuffer = this.mediaSource.addSourceBuffer(this.info.mime);
        this.sourceBuffer.mode = 'segments';
        this.start(0);
    }

    /** Seconds of media buffered ahead of the playhead; 0 when the playhead is not inside a buffered range. */
    bufferedAhead() {
        const t = this.video.currentTime;
        const ranges = this.video.buffered;
        for (let i = 0; i < ranges.length; i++) {
            if (t >= ranges.start(i) - 0.05 && t <= ranges.end(i)) return ranges.end(i) - t;
        }
        return 0;
    }

    handleSeeking() {
        const t = this.video.currentTime;
        const ranges = this.video.buffered;
        for (let i = 0; i < ranges.length; i++) {
            if (t >= ranges.start(i) && t < ranges.end(i) - 0.25) return; // already buffered
        }
        this.start(t);
    }

    /** Wait until the source buffer is free, then run an operation on it and wait for it to finish. */
    operate(fn) {
        const sb = this.sourceBuffer;
        return new Promise((resolve, reject) => {
            const run = () => {
                const done = () => { sb.removeEventListener('error', fail); resolve(); };
                const fail = () => { sb.removeEventListener('updateend', done); reject(new Error('source buffer error')); };
                sb.addEventListener('updateend', done, { once: true });
                sb.addEventListener('error', fail, { once: true });
                try {
                    fn(sb);
                } catch (e) {
                    sb.removeEventListener('updateend', done);
                    sb.removeEventListener('error', fail);
                    reject(e);
                }
            };
            if (sb.updating) sb.addEventListener('updateend', run, { once: true });
            else run();
        });
    }

    /** Drop buffered media far behind the playhead to stay within the browser's memory quota. */
    async evictBehind(keepSeconds) {
        const cutoff = this.video.currentTime - keepSeconds;
        if (cutoff <= 0 || this.mediaSource.readyState !== 'open' || this.video.buffered.length === 0) return false;
        const first = this.video.buffered.start(0);
        if (cutoff <= first) return false;
        await this.operate((sb) => sb.remove(first, cutoff));
        return true;
    }

    async append(chunk) {
        try {
            await this.operate((sb) => sb.appendBuffer(chunk));
        } catch (e) {
            if (e.name !== 'QuotaExceededError') throw e;
            // Buffer full: free what was already played and try once more
            if (!(await this.evictBehind(5))) throw e;
            await this.operate((sb) => sb.appendBuffer(chunk));
        }
    }

    /** Begin (or restart) the stream at `time`, replacing whatever is buffered. */
    async start(time) {
        if (this.destroyed || !this.sourceBuffer) return;
        const generation = ++this.generation;
        if (this.abort) this.abort.abort();
        const controller = new AbortController();
        this.abort = controller;

        try {
            // Clear the buffer (this also reopens a source that was ended), then drop any half-parsed
            // segment of the stream being replaced so the timestamp offset can change
            await this.operate((sb) => sb.remove(0, this.info.duration));
            if (generation !== this.generation) return;
            this.sourceBuffer.abort();

            const response = await fetch(
                `/video-stream?path=${encodeURIComponent(this.filePath)}&start=${time.toFixed(3)}`,
                { signal: controller.signal }
            );
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            // The stream's own clock starts at 0: shift it to where the server really began
            const offset = parseFloat(response.headers.get('X-Video-Start')) || 0;
            this.sourceBuffer.timestampOffset = offset;
            const reader = response.body.getReader();

            for (;;) {
                // Reading slower than playback lets the connection back up and ffmpeg idle
                while (this.bufferedAhead() > 60 && generation === this.generation) {
                    await new Promise((resolve) => setTimeout(resolve, 500));
                }
                if (generation !== this.generation) return;
                const { done, value } = await reader.read();
                if (generation !== this.generation) return;
                if (done) break;
                await this.append(value);
                if (generation !== this.generation) return;
            }
            if (this.mediaSource.readyState === 'open') {
                this.mediaSource.endOfStream();
            }
        } catch (error) {
            if (error.name === 'AbortError' || generation !== this.generation || this.destroyed) return;
            window.logger?.error(`[MseStream] ${error.message}`);
            if (this.mediaSource.readyState === 'open') {
                try { this.mediaSource.endOfStream('decode'); } catch (e) { /* already closed */ }
            }
        }
    }

    destroy() {
        this.destroyed = true;
        this.generation++;
        if (this.abort) this.abort.abort();
        this.video.removeEventListener('seeking', this.onSeeking);
        URL.revokeObjectURL(this.url);
    }
}

window.MseStream = MseStream;
