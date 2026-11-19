// mega.nz browser: a full-screen overlay opened from the cloud button.
// Browse folders, preview images / video / audio inline, download anything else.
// The server logs in with the login remembered in Settings; nothing secret reaches the page.
(function () {
    const MEDIA = {
        image: ['jpg', 'jpeg', 'jfif', 'pjpeg', 'pjp', 'png', 'gif', 'webp', 'bmp', 'avif'],
        video: ['mp4', 'webm', 'm4v', 'mov', 'ogv'],
        audio: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'],
        pdf: ['pdf'],
        text: ['txt', 'md', 'log', 'json', 'csv', 'tsv', 'yml', 'yaml', 'ini', 'cfg', 'srt', 'vtt', 'nfo'],
        comic: ['cbz', 'cbr']
    };
    const TEXT_LIMIT = 1024 * 1024; // only the first MB of a text file is loaded

    function kindOf(name) {
        const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
        return Object.keys(MEDIA).find((k) => MEDIA[k].includes(ext)) || 'file';
    }

    function icon(item) {
        if (item.directory) return '📁';
        return { image: '🖼️', video: '🎬', audio: '🎵', pdf: '📕', text: '📝', comic: '📚', file: '📄' }[kindOf(item.name)];
    }

    function formatSize(bytes) {
        if (!bytes) return '';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
        return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
    }

    async function api(url) {
        const fetcher = window.authManager && window.authManager.authenticatedFetch
            ? window.authManager.authenticatedFetch.bind(window.authManager)
            : fetch;
        const res = await fetcher(url);
        if (!res) throw new Error('Authentication required');
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        return body;
    }

    const fileUrl = (id, download) => `/api/mega/file?id=${encodeURIComponent(id)}${download ? '&download=1' : ''}`;
    const comicPageUrl = (id, page) => `/api/mega/comic-page?id=${encodeURIComponent(id)}&page=${page}`;

    // Previous / next controls plus arrow, PageUp/PageDown and Space keys for a paged viewer.
    // Returns { go, destroy }; render(page) is called for every page change.
    function pager(bar, total, render) {
        let page = 1;
        const prev = document.createElement('button');
        prev.type = 'button';
        prev.textContent = '‹';
        prev.setAttribute('aria-label', 'Previous page');
        const label = document.createElement('span');
        label.className = 'mega-page-label';
        const next = document.createElement('button');
        next.type = 'button';
        next.textContent = '›';
        next.setAttribute('aria-label', 'Next page');
        bar.append(prev, label, next);

        function go(n) {
            page = Math.min(Math.max(n, 1), total);
            label.textContent = `${page} / ${total}`;
            prev.disabled = page === 1;
            next.disabled = page === total;
            render(page);
        }
        prev.addEventListener('click', () => go(page - 1));
        next.addEventListener('click', () => go(page + 1));
        const onKey = (e) => {
            if (e.ctrlKey || e.altKey || e.metaKey) return;
            if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === 'n' || e.key === 'N' || (e.key === ' ' && !e.shiftKey)) { e.preventDefault(); e.stopPropagation(); go(page + 1); }
            else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'p' || e.key === 'P' || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); go(page - 1); }
        };
        window.addEventListener('keydown', onKey, true);
        return { go, current: () => page, destroy: () => window.removeEventListener('keydown', onKey, true) };
    }

    async function errorText(res) {
        const text = await res.text().catch(() => '');
        try { return JSON.parse(text).error || text; } catch (e) { return text || `HTTP ${res.status}`; }
    }

    function open() {
        const overlay = document.createElement('div');
        overlay.className = 'mega-overlay';
        overlay.innerHTML = `
            <div class="mega-panel" role="dialog" aria-label="mega.nz">
                <div class="mega-head">
                    <button class="mega-up" type="button" title="Up one folder" aria-label="Up one folder">↑</button>
                    <div class="mega-crumbs"></div>
                    <button class="mega-close" type="button" title="Close" aria-label="Close">✕</button>
                </div>
                <div class="mega-msg" role="status"></div>
                <div class="mega-body">
                    <ul class="mega-list"></ul>
                    <div class="mega-preview" style="display:none"></div>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const $ = (sel) => overlay.querySelector(sel);
        const list = $('.mega-list');
        const crumbs = $('.mega-crumbs');
        const msg = $('.mega-msg');
        const preview = $('.mega-preview');
        const upBtn = $('.mega-up');
        let parentId = null; // null = already at the root
        let token = 0; // ignore responses that arrive after a newer navigation

        const close = () => { overlay.remove(); window.removeEventListener('keydown', onKey, true); };
        const openable = (it) => !it.directory && kindOf(it.name) !== 'file';
        function adjacentFile(step) {
            for (let i = items.indexOf(previewItem) + step; i >= 0 && i < items.length; i += step) {
                if (openable(items[i])) return items[i];
            }
            return null;
        }
        const onKey = (e) => {
            if (e.key === 'Escape') { (preview.style.display !== 'none' ? closePreview : close)(); return; }
            // n / p: next / previous file in the folder (viewers with pages use them for pages instead)
            if ((e.key === 'n' || e.key === 'N' || e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.altKey && !e.metaKey
                && preview.style.display !== 'none' && !preview.querySelector('.mega-page-label')) {
                const next = adjacentFile(e.key.toLowerCase() === 'n' ? 1 : -1);
                if (next) { e.preventDefault(); e.stopPropagation(); msg.textContent = ''; showPreview(next); }
            }
        };
        window.addEventListener('keydown', onKey, true);
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
        $('.mega-close').addEventListener('click', close);

        let previewSeq = 0;
        let cleanups = [];
        let items = []; // contents of the folder being shown
        let previewItem = null;

        function closePreview() {
            previewSeq++;
            cleanups.forEach((fn) => { try { fn(); } catch (e) { /* already gone */ } });
            cleanups = [];
            preview.style.display = 'none';
            preview.innerHTML = ''; // also stops any playing media
            list.style.display = '';
        }

        async function renderText(item, body) {
            const res = await fetch(fileUrl(item.id), { headers: { Range: `bytes=0-${TEXT_LIMIT - 1}` } });
            if (!res.ok) throw new Error(await errorText(res));
            const text = await res.text();
            const total = parseInt((res.headers.get('Content-Range') || '').split('/')[1], 10);
            const pre = document.createElement('pre');
            pre.className = 'mega-text';
            pre.textContent = text + (total > TEXT_LIMIT ? `\n\n… showing the first ${formatSize(TEXT_LIMIT)} of ${formatSize(total)}. Download for the rest.` : '');
            body.appendChild(pre);
        }

        async function renderPdf(item, bar, body, seq) {
            if (!window.pdfJsLoaded) throw new Error('The PDF viewer is not available');
            await window.pdfJsLoaded;
            const pdf = await window.pdfjsLib.getDocument({ url: fileUrl(item.id) }).promise;
            if (seq !== previewSeq) { pdf.destroy(); return; }
            cleanups.push(() => pdf.destroy());
            const canvas = document.createElement('canvas');
            canvas.className = 'mega-pdf-page';
            body.appendChild(canvas);
            const ctx = canvas.getContext('2d');
            let drawing = 0;
            let task = null;
            const view = pager(bar, pdf.numPages, async (n) => {
                const mine = ++drawing;
                try {
                    const page = await pdf.getPage(n);
                    if (mine !== drawing) return;
                    const width = Math.max(body.clientWidth - 16, 200);
                    const dpr = Math.min(window.devicePixelRatio || 1, 2);
                    const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * dpr });
                    if (task) task.cancel();
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;
                    canvas.style.width = `${viewport.width / dpr}px`;
                    task = page.render({ canvasContext: ctx, viewport });
                    await task.promise;
                    body.scrollTop = 0;
                } catch (err) {
                    if (err && err.name === 'RenderingCancelledException') return;
                    msg.textContent = `Could not draw page ${n}: ${err.message}`;
                }
            });
            cleanups.push(view.destroy);
            view.go(1);
        }

        async function renderComic(item, bar, body, seq) {
            msg.textContent = 'Downloading comic from mega.nz…';
            const res = await fetch(`/api/mega/comic-info?id=${encodeURIComponent(item.id)}`);
            if (!res.ok) throw new Error(await errorText(res));
            const info = await res.json();
            if (seq !== previewSeq) return;
            msg.textContent = '';
            if (!info.pages) throw new Error('No pages found in this archive');
            const img = document.createElement('img');
            img.className = 'mega-comic-page';
            img.addEventListener('error', () => { msg.textContent = 'Could not load this page'; });
            img.addEventListener('load', () => { msg.textContent = ''; });
            body.appendChild(img);
            const view = pager(bar, info.pages, (n) => {
                msg.textContent = 'Loading page…';
                img.src = comicPageUrl(item.id, n);
                body.scrollTop = 0;
                if (n < info.pages) new Image().src = comicPageUrl(item.id, n + 1); // warm the next page
            });
            // Tap the right half to go forward, the left half to go back
            img.addEventListener('click', (e) => {
                const rect = img.getBoundingClientRect();
                view.go(view.current() + (e.clientX - rect.left > rect.width / 2 ? 1 : -1));
            });
            cleanups.push(view.destroy);
            view.go(1);
        }

        async function showPreview(item) {
            const kind = kindOf(item.name);
            const seq = ++previewSeq;
            previewItem = item;
            preview.innerHTML = '';
            const bar = document.createElement('div');
            bar.className = 'mega-preview-bar';
            const back = document.createElement('button');
            back.type = 'button';
            back.textContent = '← Back';
            back.addEventListener('click', closePreview);
            const title = document.createElement('span');
            title.className = 'mega-preview-title';
            title.textContent = item.name;
            const dl = document.createElement('a');
            dl.href = fileUrl(item.id, true);
            dl.textContent = '⬇';
            dl.title = 'Download';
            dl.setAttribute('download', item.name);
            bar.append(back, title);
            preview.appendChild(bar);
            list.style.display = 'none';
            preview.style.display = 'flex';

            if (['image', 'video', 'audio'].includes(kind)) {
                bar.appendChild(dl);
                const el = document.createElement({ image: 'img', video: 'video', audio: 'audio' }[kind]);
                el.src = fileUrl(item.id);
                if (kind !== 'image') { el.controls = true; el.autoplay = true; }
                el.className = 'mega-media';
                el.addEventListener('error', () => { msg.textContent = `Could not load ${item.name}`; });
                preview.appendChild(el);
                return;
            }

            const body = document.createElement('div');
            body.className = 'mega-scroll';
            preview.appendChild(body);
            try {
                if (kind === 'text') await renderText(item, body);
                else if (kind === 'pdf') await renderPdf(item, bar, body, seq);
                else if (kind === 'comic') await renderComic(item, bar, body, seq);
            } catch (err) {
                if (seq === previewSeq) msg.textContent = `Could not open ${item.name}: ${err.message}`;
            }
            if (seq === previewSeq) bar.appendChild(dl); // pager controls (if any) sit before the download button
        }

        async function load(id) {
            const mine = ++token;
            closePreview();
            msg.textContent = 'Loading…';
            list.innerHTML = '';
            try {
                const data = await api(`/api/mega/list?id=${encodeURIComponent(id || '')}`);
                if (mine !== token) return;
                items = data.items;
                msg.textContent = data.items.length ? '' : 'Empty folder';
                parentId = data.root ? null : (data.crumbs.length > 1 ? data.crumbs[data.crumbs.length - 2].id : '');
                upBtn.disabled = parentId === null;

                crumbs.innerHTML = '';
                const addCrumb = (label, target, last) => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.textContent = label;
                    b.disabled = last;
                    b.addEventListener('click', () => load(target));
                    crumbs.appendChild(b);
                };
                addCrumb('☁️ Cloud', '', data.crumbs.length === 0);
                data.crumbs.forEach((c, i) => addCrumb(c.name, c.id, i === data.crumbs.length - 1));

                data.items.forEach((item) => {
                    const li = document.createElement('li');
                    li.tabIndex = 0;
                    const ic = document.createElement('span');
                    ic.className = 'mega-icon';
                    ic.textContent = icon(item);
                    const name = document.createElement('span');
                    name.className = 'mega-name';
                    name.textContent = item.name;
                    const meta = document.createElement('span');
                    meta.className = 'mega-meta';
                    meta.textContent = item.directory ? '' : formatSize(item.size);
                    li.append(ic, name, meta);
                    const activate = () => {
                        if (item.directory) return load(item.id);
                        if (kindOf(item.name) === 'file') { window.location.href = fileUrl(item.id, true); return; }
                        msg.textContent = '';
                        showPreview(item);
                    };
                    li.addEventListener('click', activate);
                    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') activate(); });
                    list.appendChild(li);
                });
            } catch (err) {
                if (mine !== token) return;
                msg.textContent = err.message;
            }
        }

        upBtn.addEventListener('click', () => { if (parentId !== null) load(parentId); });
        load('');
    }

    document.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('mega-btn');
        if (btn) btn.addEventListener('click', open);
    });
})();
