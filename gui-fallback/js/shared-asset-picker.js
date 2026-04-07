'use strict';

const AssetPicker = (() => {
    let _assets = [];
    let _cfg = null;

    function _els() {
        return {
            dialog: document.getElementById('asset-picker-modal'),
            title: document.getElementById('asset-picker-title'),
            status: document.getElementById('asset-picker-status'),
            filter: document.getElementById('asset-picker-filter'),
            sort: document.getElementById('asset-picker-sort'),
            grid: document.getElementById('asset-picker-grid'),
        };
    }

    function _esc(s) {
        if (s === null || s === undefined) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function _fmtBytes(b) {
        if (b < 1024) return `${b} B`;
        if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
        return `${(b / 1048576).toFixed(1)} MB`;
    }

    function _setStatus(message, color) {
        const els = _els();
        if (!els.status) return;
        els.status.textContent = message || '';
        els.status.style.color = color || '';
    }

    function _render() {
        const els = _els();
        if (!_cfg || !els.grid) return;

        const filter = (els.filter.value || '').trim().toLowerCase();
        const sort = els.sort.value || 'name-asc';
        const isIcon = _cfg.kind === 'icon';
        const isExploreMode = _cfg.mode === 'explore';

        const items = _assets
            .filter(asset => !filter || asset.filename.toLowerCase().includes(filter) || asset.path.toLowerCase().includes(filter))
            .sort((left, right) => {
                if (sort === 'name-desc') return right.filename.localeCompare(left.filename);
                if (sort === 'size-desc') return (right.size || 0) - (left.size || 0) || left.filename.localeCompare(right.filename);
                if (sort === 'size-asc') return (left.size || 0) - (right.size || 0) || left.filename.localeCompare(right.filename);
                return left.filename.localeCompare(right.filename);
            });

        if (!items.length) {
            els.grid.innerHTML = '<p style="color:var(--text-dim);font-size:12px">No assets match the current filter.</p>';
            return;
        }

        els.grid.innerHTML = '';
        for (const asset of items) {
            const card = document.createElement('div');
            card.className = isIcon ? 'asset-picker-card asset-picker-card--icon' : 'asset-picker-card asset-picker-card--sound';
            card.dataset.path = asset.path;

            if (isIcon) {
                card.innerHTML = `
                    <img class="asset-picker-thumb" src="${_esc(asset.url)}" alt="${_esc(asset.filename)}">
                    <div class="asset-picker-meta">
                        <span class="asset-picker-name">${_esc(asset.filename)}</span>
                        <small class="asset-picker-size">${_fmtBytes(asset.size || 0)}</small>
                    </div>
                    <div class="asset-picker-actions">
                        ${isExploreMode
                            ? '<button class="btn-small secondary asset-picker-delete" type="button">Delete</button>'
                            : '<button class="btn-small asset-picker-select" type="button">Select</button>'}
                    </div>
                `;
            } else {
                card.innerHTML = `
                    <div class="asset-picker-meta">
                        <span class="asset-picker-name">${_esc(asset.filename)}</span>
                        <small class="asset-picker-size">${_fmtBytes(asset.size || 0)}</small>
                    </div>
                    <div class="asset-picker-actions">
                        <button class="asset-picker-play btn-small secondary" type="button" data-url="${_esc(asset.url)}" title="Preview">▶</button>
                        ${isExploreMode
                            ? '<button class="btn-small secondary asset-picker-delete" type="button">Delete</button>'
                            : '<button class="btn-small asset-picker-select" type="button">Select</button>'}
                    </div>
                `;
                card.querySelector('.asset-picker-play').addEventListener('click', (e) => {
                    e.stopPropagation();
                    const url = e.currentTarget.dataset.url;
                    if (url && typeof SoundManager !== 'undefined') {
                        SoundManager.previewToggle(url, { button: e.currentTarget });
                    }
                });
            }

            if (isExploreMode) {
                card.querySelector('.asset-picker-delete').addEventListener('click', (e) => {
                    e.stopPropagation();
                    void _deleteAsset(asset.path);
                });
            } else {
                card.querySelector('.asset-picker-select').addEventListener('click', (e) => {
                    e.stopPropagation();
                    void _select(asset.path);
                });
                card.addEventListener('click', () => { void _select(asset.path); });
            }
            els.grid.appendChild(card);
        }
    }

    async function _select(assetPath) {
        if (!_cfg || typeof _cfg.onSelect !== 'function') return;
        _setStatus('Assigning...', '');
        try {
            await _cfg.onSelect(assetPath);
            HubModal.close(_els().dialog);
        } catch (e) {
            _setStatus(`✗ ${e.message || e}`, 'var(--danger,#f85149)');
        }
    }

    async function _deleteAsset(assetPath) {
        if (!_cfg || typeof _cfg.onDelete !== 'function') return;

        const confirmed = await HubDialogs.confirmDelete({
            title: 'Delete Asset',
            message: `Delete ${assetPath}?`,
            detail: 'This removes the uploaded file from the shared asset folder. Assigned assets cannot be deleted until they are unassigned.',
            confirmLabel: 'Delete',
        });
        if (!confirmed) return;

        _setStatus('Deleting...', '');
        try {
            await _cfg.onDelete(assetPath);
            _assets = _assets.filter(a => a.path !== assetPath);
            _setStatus(`✓ Deleted ${assetPath}`, 'var(--ok,#3fb950)');
            _render();
            if (!_assets.length) {
                const els = _els();
                els.grid.innerHTML = `<p style="color:var(--text-dim);font-size:12px">${_cfg.emptyMessage || 'No assets uploaded yet.'}</p>`;
            }
        } catch (e) {
            _setStatus(`✗ ${e.message || e}`, 'var(--danger,#f85149)');
        }
    }

    async function _loadAssets() {
        const els = _els();
        if (!_cfg) return;
        els.grid.innerHTML = '<p style="color:var(--text-dim);font-size:12px">Loading...</p>';
        try {
            const resp = await apiFetch(_cfg.browseUrl);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            _assets = await resp.json();
            if (!_assets.length) {
                els.grid.innerHTML = `<p style="color:var(--text-dim);font-size:12px">${_cfg.emptyMessage || 'No assets uploaded yet.'}</p>`;
                return;
            }
            _render();
        } catch (e) {
            els.grid.innerHTML = `<p style="color:var(--danger,#f85149);font-size:12px">✗ ${_esc(e.message)}</p>`;
        }
    }

    function open(cfg) {
        const els = _els();
        _cfg = cfg;
        _assets = [];
        els.title.textContent = cfg.title || (cfg.mode === 'explore' ? 'Explore assets' : 'Choose asset');
        els.filter.value = '';
        els.sort.value = 'name-asc';
        _setStatus(cfg.mode === 'explore' ? 'Browse and preview assets. Use Delete to remove files.' : '');
        HubModal.open(els.dialog, {
            onOpen: () => {
                els.filter.focus();
                void _loadAssets();
            },
            onClose: () => {
                if (typeof SoundManager !== 'undefined') SoundManager.stopPreview();
                els.grid.innerHTML = '';
                _setStatus('');
                _assets = [];
                _cfg = null;
            },
        });
    }

    function init() {
        const els = _els();
        if (els.filter && !els.filter.dataset.assetPickerWired) {
            els.filter.dataset.assetPickerWired = '1';
            els.filter.addEventListener('input', _render);
        }
        if (els.sort && !els.sort.dataset.assetPickerWired) {
            els.sort.dataset.assetPickerWired = '1';
            els.sort.addEventListener('change', _render);
        }
    }

    return { init, open };
})();

AssetPicker.init();