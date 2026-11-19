// Settings panel: theme selection and served-root selection, opened from the gear button.
(function () {
    const THEMES = [
        { id: 'light', label: '☀️ Bright' },
        { id: 'dark', label: '🌙 Dark' },
        { id: 'contrast', label: '⚫ Very dark, contrasted' }
    ];

    function getTheme() {
        try { return localStorage.getItem('fb-theme') || 'dark'; } catch { return 'dark'; }
    }

    function applyTheme(id) {
        document.documentElement.dataset.theme = id;
        try { localStorage.setItem('fb-theme', id); } catch { /* storage unavailable: theme lasts for this page only */ }
    }

    async function api(url, options) {
        const fetcher = window.authManager && window.authManager.authenticatedFetch
            ? window.authManager.authenticatedFetch.bind(window.authManager)
            : fetch;
        const res = await fetcher(url, options);
        if (!res) throw new Error('Authentication required');
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        return body;
    }

    function joinPath(base, name) {
        return base.replace(/[\\/]+$/, '') + (base.includes('\\') ? '\\' : '/') + name;
    }

    function open() {
        const overlay = document.createElement('div');
        overlay.className = 'config-overlay';
        overlay.innerHTML = `
            <div class="config-modal" role="dialog" aria-label="Settings">
                <h3>⚙️ Settings</h3>
                <h4>Theme</h4>
                <div class="config-themes"></div>
                <h4>Root folder</h4>
                <div class="config-row">
                    <input type="text" id="config-root-input" spellcheck="false">
                    <button id="config-browse">Browse</button>
                </div>
                <div class="config-dirs" style="display:none"></div>
                <h4>mega.nz login</h4>
                <div class="config-row">
                    <input type="text" id="config-mega-user" placeholder="Email" autocomplete="username" spellcheck="false">
                </div>
                <div class="config-row" style="margin-top:6px">
                    <input type="password" id="config-mega-pass" placeholder="Password" autocomplete="current-password">
                    <button id="config-mega-save">Remember</button>
                    <button id="config-mega-forget" style="display:none">Forget</button>
                </div>
                <div class="config-mega-status" style="font-size:0.8rem;opacity:0.75;margin-top:4px"></div>
                <div class="config-msg"></div>
                <div class="config-actions">
                    <button id="config-close">Close</button>
                    <button id="config-apply" class="primary">Use this root</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const $ = (sel) => overlay.querySelector(sel);
        const input = $('#config-root-input');
        const dirsBox = $('.config-dirs');
        const msg = $('.config-msg');
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
        $('#config-close').addEventListener('click', close);

        const themeBox = $('.config-themes');
        THEMES.forEach((t) => {
            const b = document.createElement('button');
            b.textContent = t.label;
            b.setAttribute('aria-pressed', String(getTheme() === t.id));
            b.addEventListener('click', () => {
                applyTheme(t.id);
                themeBox.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
            });
            themeBox.appendChild(b);
        });

        async function browse(dir) {
            msg.textContent = '';
            try {
                const data = await api(`/api/config/dirs?path=${encodeURIComponent(dir || '')}`);
                dirsBox.style.display = 'block';
                dirsBox.innerHTML = '';
                if (data.path) input.value = data.path;
                const add = (label, target) => {
                    const d = document.createElement('div');
                    d.textContent = label;
                    d.addEventListener('click', () => browse(target));
                    dirsBox.appendChild(d);
                };
                if (data.parent !== null) add('⬆️ ..', data.parent);
                data.dirs.forEach((name) => add(`📁 ${name}`, data.path ? joinPath(data.path, name) : name));
            } catch (err) {
                msg.textContent = err.message;
            }
        }

        $('#config-browse').addEventListener('click', () => browse(input.value));
        $('#config-apply').addEventListener('click', async () => {
            msg.textContent = '';
            try {
                await api('/api/config/root', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: input.value })
                });
                location.reload();
            } catch (err) {
                msg.textContent = err.message;
            }
        });

        const megaUser = $('#config-mega-user');
        const megaPass = $('#config-mega-pass');
        const megaStatus = $('.config-mega-status');
        const megaForget = $('#config-mega-forget');
        const megaUrl = '/api/config/credentials/mega';
        function showMega(state) {
            megaUser.value = state.username || '';
            megaPass.value = '';
            megaPass.placeholder = state.saved ? 'Saved (type to replace)' : 'Password';
            megaStatus.textContent = state.saved ? `Remembered for ${state.username} (stored encrypted on the server)` : 'Not saved';
            megaForget.style.display = state.saved ? '' : 'none';
        }
        api(megaUrl).then(showMega).catch(() => { megaStatus.textContent = 'Only available from the machine running the server'; });
        $('#config-mega-save').addEventListener('click', async () => {
            msg.textContent = '';
            try {
                showMega(await api(megaUrl, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: megaUser.value, password: megaPass.value })
                }));
            } catch (err) {
                msg.textContent = err.message;
            }
        });
        megaForget.addEventListener('click', async () => {
            msg.textContent = '';
            try { showMega(await api(megaUrl, { method: 'DELETE' })); } catch (err) { msg.textContent = err.message; }
        });

        fetch('/api/server-info').then((r) => r.json()).then((d) => { input.value = d.rootDir || ''; }).catch(() => {});
    }

    document.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('config-btn');
        if (btn) btn.addEventListener('click', open);
    });
})();
