// Mobile (Android-optimised) layout controller.
// On narrow / touch screens the three desktop panes collapse into one screen at a time:
//   list screen  -> tap a file -> viewer screen (top bar with Back, title and Info)
// The details panel becomes a bottom sheet, and the Android back button / gesture steps back.
(function () {
    'use strict';

    const mq = window.matchMedia('(max-width: 768px), (pointer: coarse) and (max-height: 500px)');
    const body = document.body;
    const isMobile = () => mq.matches;

    function enableViewport() {
        body.classList.toggle('is-mobile', isMobile());
        if (!isMobile()) {
            body.classList.remove('m-viewer', 'm-sheet');
        }
    }

    // --- Top bar shown on the viewer screen -------------------------------------------------
    const bar = document.createElement('div');
    bar.id = 'm-bar';
    bar.innerHTML =
        '<button id="m-back" type="button" aria-label="Back">←</button>' +
        '<span id="m-title"></span>' +
        '<button id="m-info" type="button" aria-label="Details">ⓘ</button>';
    body.appendChild(bar);

    const backdrop = document.createElement('div');
    backdrop.id = 'm-backdrop';
    body.appendChild(backdrop);

    const titleEl = bar.querySelector('#m-title');

    function setTitle(text) {
        titleEl.textContent = text || '';
    }

    // --- Navigation state, mirrored in history so the Android back button works -------------
    function openViewer(title) {
        if (!isMobile()) return;
        setTitle(title);
        if (!body.classList.contains('m-viewer')) {
            body.classList.add('m-viewer');
            try { history.pushState({ mView: 'viewer' }, ''); } catch (e) { /* history unavailable */ }
        }
        const viewer = document.querySelector('.content-viewer');
        if (viewer) viewer.scrollTop = 0;
    }

    function closeSheet() {
        body.classList.remove('m-sheet');
    }

    function closeViewer() {
        closeSheet();
        body.classList.remove('m-viewer');
        // Leave fullscreen if a viewer put us there
        if (document.fullscreenElement && document.exitFullscreen) {
            document.exitFullscreen().catch(() => { /* already leaving */ });
        }
    }

    window.addEventListener('popstate', () => {
        // The sheet's history entry was just popped, so the viewer entry is still on the stack
        if (body.classList.contains('m-sheet')) { closeSheet(); return; }
        if (body.classList.contains('m-viewer')) closeViewer();
    });

    bar.querySelector('#m-back').addEventListener('click', () => {
        if (body.classList.contains('m-sheet')) { closeSheet(); return; }
        // Go through history so the stack stays consistent with the system back button
        if (history.state && history.state.mView === 'viewer') history.back();
        else closeViewer();
    });

    bar.querySelector('#m-info').addEventListener('click', () => {
        body.classList.toggle('m-sheet');
        if (body.classList.contains('m-sheet')) {
            try { history.pushState({ mView: 'sheet' }, ''); } catch (e) { /* history unavailable */ }
        }
    });
    backdrop.addEventListener('click', () => {
        if (history.state && history.state.mView === 'sheet') history.back();
        else closeSheet();
    });

    // --- Tap handling on the file list --------------------------------------------------------
    // Capture phase so we run before the desktop handlers.
    const fileList = document.getElementById('file-list');
    if (fileList) {
        fileList.addEventListener('click', (event) => {
            if (!isMobile()) return;
            const li = event.target.closest('li');
            if (!li || li.classList.contains('parent-dir')) return;
            if (event.target.closest('.annotation-btn')) return;

            const nameEl = li.querySelector('.file-name');
            const name = nameEl ? nameEl.textContent.trim() : li.textContent.trim();

            if (li.getAttribute('data-type') === 'directory' && window.fileExplorer && !li.classList.contains('search-result')) {
                // No Enter key on a phone: a tap on a folder simply opens it
                event.stopImmediatePropagation();
                const base = window.fileExplorer.currentPath();
                window.fileExplorer.loadFiles(base ? base + '/' + name : name);
                return;
            }
            openViewer(name);
        }, true);
    }

    // Keep the viewer title in sync when the library view opens items from inside the viewer
    const observer = new MutationObserver(() => {
        const selected = document.querySelector('#file-list li.selected .file-name');
        if (selected && body.classList.contains('m-viewer')) setTitle(selected.textContent.trim());
    });
    if (fileList) observer.observe(fileList, { attributes: true, subtree: true, attributeFilter: ['class'] });

    // The desktop-only focus-mode keys make no sense on a phone
    document.addEventListener('keydown', (e) => {
        if (isMobile() && (e.key === 'h' || e.key === 'H')) e.stopPropagation();
    }, true);

    // iOS/Android keyboards resize the visual viewport: expose real height for CSS
    function setVh() {
        const h = (window.visualViewport ? window.visualViewport.height : window.innerHeight);
        document.documentElement.style.setProperty('--m-vh', h + 'px');
    }
    setVh();
    window.addEventListener('resize', setVh);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', setVh);

    mq.addEventListener ? mq.addEventListener('change', enableViewport) : mq.addListener(enableViewport);
    enableViewport();
})();
