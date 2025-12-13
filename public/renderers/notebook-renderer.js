class NotebookRenderer {
    constructor() {
        this.handleKeyDown = null;
    }

    cleanup() {
        if (this.handleKeyDown) {
            document.removeEventListener('keydown', this.handleKeyDown);
            this.handleKeyDown = null;
        }
    }

    async render(filePath, fileName, contentCode, contentOther) {
        this.cleanup();

        const response = await window.authManager.authenticatedFetch(`/files?path=${encodeURIComponent(filePath)}`);
        if (!response) {
            throw new Error('Authentication required');
        }
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const rawText = await response.text();

        let notebook;
        try {
            notebook = JSON.parse(rawText);
        } catch (e) {
            throw new Error('Invalid .ipynb file (not valid JSON)');
        }

        if (!notebook || !Array.isArray(notebook.cells)) {
            throw new Error('Invalid .ipynb file (missing cells)');
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'notebook-container';

        const header = document.createElement('div');
        header.className = 'notebook-header';

        const title = document.createElement('div');
        title.className = 'notebook-title';
        title.textContent = fileName;

        const meta = document.createElement('div');
        meta.className = 'notebook-meta';
        meta.textContent = this.formatNotebookMeta(notebook);

        const actions = document.createElement('div');
        actions.className = 'notebook-actions';

        const toggleRawBtn = document.createElement('button');
        toggleRawBtn.className = 'notebook-action-btn';
        toggleRawBtn.textContent = 'Raw JSON';

        const downloadLink = document.createElement('a');
        downloadLink.className = 'notebook-action-btn';
        downloadLink.href = `/files?path=${encodeURIComponent(filePath)}`;
        downloadLink.download = fileName;
        downloadLink.textContent = 'Download';

        actions.appendChild(toggleRawBtn);
        actions.appendChild(downloadLink);

        header.appendChild(title);
        header.appendChild(meta);
        header.appendChild(actions);

        const body = document.createElement('div');
        body.className = 'notebook-body';

        const rawPanel = document.createElement('pre');
        rawPanel.className = 'notebook-raw';
        rawPanel.style.display = 'none';
        rawPanel.textContent = rawText;

        const renderedPanel = document.createElement('div');
        renderedPanel.className = 'notebook-rendered';

        this.renderCells(notebook, renderedPanel);

        body.appendChild(renderedPanel);
        body.appendChild(rawPanel);

        wrapper.appendChild(header);
        wrapper.appendChild(body);

        contentOther.appendChild(wrapper);
        contentOther.style.display = 'block';

        toggleRawBtn.addEventListener('click', () => {
            const showRaw = rawPanel.style.display === 'none';
            rawPanel.style.display = showRaw ? 'block' : 'none';
            renderedPanel.style.display = showRaw ? 'none' : 'block';
            toggleRawBtn.textContent = showRaw ? 'Rendered' : 'Raw JSON';
        });

        this.handleKeyDown = (e) => {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
            if (e.key === 'r') {
                e.preventDefault();
                toggleRawBtn.click();
            } else if (e.key === 'c' || e.key === 'r' || e.key === 'g' || e.key === 'y' || e.key === 'b' || (e.key >= '1' && e.key <= '5')) {
                e.preventDefault();
                if (typeof handleAnnotationShortcut === 'function') {
                    handleAnnotationShortcut(e.key);
                }
            }
        };
        document.addEventListener('keydown', this.handleKeyDown);
    }

    formatNotebookMeta(notebook) {
        const kernelName = notebook?.metadata?.kernelspec?.display_name || notebook?.metadata?.kernelspec?.name;
        const language = notebook?.metadata?.language_info?.name;
        const parts = [];
        if (kernelName) parts.push(kernelName);
        if (language && (!kernelName || kernelName.toLowerCase().indexOf(language.toLowerCase()) === -1)) {
            parts.push(language);
        }
        parts.push(`${notebook.cells.length} cells`);
        return parts.join(' • ');
    }

    renderCells(notebook, container) {
        notebook.cells.forEach((cell, index) => {
            const cellWrap = document.createElement('div');
            cellWrap.className = `nb-cell nb-cell-${cell.cell_type || 'unknown'}`;

            const cellHeader = document.createElement('div');
            cellHeader.className = 'nb-cell-header';
            cellHeader.textContent = `${cell.cell_type || 'cell'} [${index + 1}]`;

            const cellBody = document.createElement('div');
            cellBody.className = 'nb-cell-body';

            const sourceText = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');

            if (cell.cell_type === 'markdown') {
                const mdDiv = document.createElement('div');
                mdDiv.className = 'nb-markdown';
                mdDiv.innerHTML = this.renderMarkdownSafe(sourceText);
                cellBody.appendChild(mdDiv);
            } else {
                const pre = document.createElement('pre');
                pre.className = 'nb-code';
                const code = document.createElement('code');
                code.textContent = sourceText;
                pre.appendChild(code);
                cellBody.appendChild(pre);

                const lang = this.getHighlightLanguage(cell) || 'plaintext';
                if (typeof hljs !== 'undefined') {
                    try {
                        code.classList.add(`language-${lang}`);
                        hljs.highlightElement(code);
                    } catch (e) {
                        // ignore highlight errors
                    }
                }

                if (Array.isArray(cell.outputs) && cell.outputs.length) {
                    cell.outputs.forEach((output) => {
                        const outDiv = this.renderOutput(output);
                        if (outDiv) cellBody.appendChild(outDiv);
                    });
                }
            }

            cellWrap.appendChild(cellHeader);
            cellWrap.appendChild(cellBody);
            container.appendChild(cellWrap);
        });
    }

    getHighlightLanguage(cell) {
        const language = cell?.metadata?.language;
        if (typeof language === 'string' && language.trim()) return language.trim();
        return null;
    }

    renderOutput(output) {
        const outWrap = document.createElement('div');
        outWrap.className = 'nb-output';

        const type = output?.output_type;

        if (type === 'stream') {
            const pre = document.createElement('pre');
            pre.className = 'nb-output-stream';
            const text = Array.isArray(output.text) ? output.text.join('') : (output.text || '');
            pre.textContent = text;
            outWrap.appendChild(pre);
            return outWrap;
        }

        if (type === 'error') {
            const pre = document.createElement('pre');
            pre.className = 'nb-output-error';
            const traceback = Array.isArray(output.traceback) ? output.traceback.join('\n') : '';
            pre.textContent = `${output.ename || 'Error'}: ${output.evalue || ''}${traceback ? `\n${traceback}` : ''}`;
            outWrap.appendChild(pre);
            return outWrap;
        }

        if (type === 'execute_result' || type === 'display_data') {
            const data = output.data || {};

            if (data['text/html']) {
                const html = Array.isArray(data['text/html']) ? data['text/html'].join('') : data['text/html'];
                const div = document.createElement('div');
                div.className = 'nb-output-html';
                div.textContent = html;
                outWrap.appendChild(div);
                return outWrap;
            }

            if (data['image/png']) {
                const img = document.createElement('img');
                img.className = 'nb-output-image';
                const b64 = Array.isArray(data['image/png']) ? data['image/png'].join('') : data['image/png'];
                img.src = `data:image/png;base64,${b64}`;
                outWrap.appendChild(img);
                return outWrap;
            }

            if (data['image/jpeg']) {
                const img = document.createElement('img');
                img.className = 'nb-output-image';
                const b64 = Array.isArray(data['image/jpeg']) ? data['image/jpeg'].join('') : data['image/jpeg'];
                img.src = `data:image/jpeg;base64,${b64}`;
                outWrap.appendChild(img);
                return outWrap;
            }

            if (data['text/plain']) {
                const pre = document.createElement('pre');
                pre.className = 'nb-output-text';
                const text = Array.isArray(data['text/plain']) ? data['text/plain'].join('') : data['text/plain'];
                pre.textContent = text;
                outWrap.appendChild(pre);
                return outWrap;
            }
        }

        // Unknown output type: ignore
        return null;
    }

    renderMarkdownSafe(markdownText) {
        const escaped = this.escapeHTML(markdownText);
        return escaped
            .split(/\n{2,}/)
            .map(block => {
                const trimmed = block.trim();
                if (!trimmed) return '';
                const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
                if (h) {
                    const level = h[1].length;
                    return `<h${level}>${h[2]}</h${level}>`;
                }
                const listMatch = trimmed.match(/^(?:\-\s+.+\n?)+$/);
                if (listMatch) {
                    const items = trimmed.split('\n').map(line => line.replace(/^\-\s+/, '').trim()).filter(Boolean);
                    return `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`;
                }
                return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
            })
            .join('');
    }

    escapeHTML(text) {
        return String(text)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }
}
