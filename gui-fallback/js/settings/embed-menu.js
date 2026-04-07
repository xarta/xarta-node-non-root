// embed-menu.js — Embedded selector menu editor (settings tab)
// xarta-node Blueprints GUI

'use strict';

const _EM_COLS = ['icon', 'item_key', 'label', 'page_index', 'sort_order', 'icon_asset', 'sound_asset', 'enabled', '_move', '_edit'];

let _EM_FIELD_META = null;
let _emTableView = null;
let _emLayoutController = null;

function _emStatusEl() { return document.getElementById('em-status'); }

function _emSetStatus(msg, color) {
    const el = _emStatusEl();
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = color || '';
}

function _emAssetUrl(path, updatedAt) {
    if (!path) return '';
    const ts = updatedAt ? new Date(updatedAt).getTime() : 0;
    return `/fallback-ui/assets/${path}${ts ? `?v=${ts}` : ''}`;
}

function _emSortItems(items) {
    return [...items].sort((a, b) => {
        const pageCmp = (a.page_index || 0) - (b.page_index || 0);
        if (pageCmp) return pageCmp;
        const sortCmp = (a.sort_order || 0) - (b.sort_order || 0);
        if (sortCmp) return sortCmp;
        return (a.item_key || '').localeCompare(b.item_key || '');
    });
}

function _emNextSortForPage(pageIndex) {
    const pageItems = _embedMenuItems.filter(item => item.page_index === pageIndex);
    if (!pageItems.length) return 0;
    return Math.max(...pageItems.map(item => item.sort_order || 0)) + 1;
}

function _emNotifySelectorRefresh() {
    window.dispatchEvent(new CustomEvent('bp:embed-menu-config-changed'));
}

function _emDefaultWidth(col) {
    switch (col) {
        case 'icon': return 44;
        case 'item_key': return 150;
        case 'label': return 160;
        case 'page_index': return 72;
        case 'sort_order': return 72;
        case 'icon_asset': return 180;
        case 'sound_asset': return 180;
        case 'enabled': return 72;
        case '_move': return 120;
        case '_edit': return 64;
        default: return null;
    }
}

function _emColumnType(col) {
    if (col.startsWith('_') || col === 'icon') return null;
    if (col === 'page_index' || col === 'sort_order' || col === 'enabled') return 'INTEGER';
    return 'TEXT';
}

function _emColumnSeed(col) {
    const sqliteColumn = col.startsWith('_')
        ? null
        : (col === 'icon' ? null : col);
    return {
        sqlite_column: sqliteColumn,
        data_type: _emColumnType(col),
        sample_max_length: col === 'label' ? 60 : (col === 'icon_asset' || col === 'sound_asset' ? 96 : 32),
        min_width_px: 40,
        max_width_px: col === 'label' ? 420 : 360,
        width_px: _ensureEmTableView()?.prefs?.getWidth(col) || _emDefaultWidth(col),
    };
}

function _emSortValue(item, sortKey) {
    switch (sortKey) {
        case 'item_key': return item.item_key || '';
        case 'label': return item.label || '';
        case 'page_index': return Number(item.page_index || 0);
        case 'sort_order': return Number(item.sort_order || 0);
        case 'icon_asset': return item.icon_asset || '';
        case 'sound_asset': return item.sound_asset || '';
        case 'enabled': return Number(item.enabled ? 1 : 0);
        default: return '';
    }
}

function _emIconHtml(item) {
    if (item.icon_asset) {
        return `<img class="fc-icon-preview menu-icon" src="${_esc(_emAssetUrl(item.icon_asset, item.updated_at))}" alt="" data-icon-fallback="1">`;
    }
    if (item.icon_emoji) {
        return `<span class="ni-icon-emoji">${_esc(item.icon_emoji)}</span>`;
    }
    return '<span class="fc-icon-placeholder">—</span>';
}

function _emBuildFieldMeta() {
    if (_EM_FIELD_META) return _EM_FIELD_META;
    _EM_FIELD_META = {
        icon: {
            label: 'Icon',
            render: item => `<td>${_emIconHtml(item)}</td>`,
        },
        item_key: {
            label: 'Key',
            sortKey: 'item_key',
            render: item => `<td><code>${_esc(item.item_key)}</code></td>`,
        },
        label: {
            label: 'Label',
            sortKey: 'label',
            render: item => `<td>${_esc(item.label || '')}</td>`,
        },
        page_index: {
            label: 'Page',
            sortKey: 'page_index',
            render: item => `<td>${Number(item.page_index || 0)}</td>`,
        },
        sort_order: {
            label: 'Order',
            sortKey: 'sort_order',
            render: item => `<td>${Number(item.sort_order || 0)}</td>`,
        },
        icon_asset: {
            label: 'Icon Asset',
            sortKey: 'icon_asset',
            render: item => `<td>${item.icon_asset ? `<span class="ni-asset-name" title="${_esc(item.icon_asset)}">${_esc(item.icon_asset)}</span>` : '—'}</td>`,
        },
        sound_asset: {
            label: 'Sound Asset',
            sortKey: 'sound_asset',
            render: item => `<td>${item.sound_asset ? `<span class="ni-asset-name" title="${_esc(item.sound_asset)}">${_esc(item.sound_asset)}</span>` : '—'}</td>`,
        },
        enabled: {
            label: 'Enabled',
            sortKey: 'enabled',
            render: item => `<td>${item.enabled ? 'yes' : 'no'}</td>`,
        },
        _move: {
            label: 'Move',
            render: item => `<td class="table-action-cell"><div class="table-inline-actions"><button type="button" class="table-icon-btn table-icon-btn--sm" data-em-page-prev="${_esc(item.item_id)}" title="Move to previous page" aria-label="Move to previous page">←</button><button type="button" class="table-icon-btn table-icon-btn--sm" data-em-page-next="${_esc(item.item_id)}" title="Move to next page" aria-label="Move to next page">→</button><button type="button" class="table-icon-btn table-icon-btn--sm" data-em-up="${_esc(item.item_id)}" title="Move up" aria-label="Move up">↑</button><button type="button" class="table-icon-btn table-icon-btn--sm" data-em-down="${_esc(item.item_id)}" title="Move down" aria-label="Move down">↓</button></div></td>`,
        },
        _edit: {
            label: 'Edit',
            render: item => `<td class="table-action-cell"><div class="table-inline-actions"><button type="button" class="table-icon-btn table-icon-btn--edit" data-em-edit="${_esc(item.item_id)}" title="Edit" aria-label="Edit"></button></div></td>`,
        },
    };
    return _EM_FIELD_META;
}

function _ensureEmTableView() {
    if (_emTableView || typeof TableView === 'undefined') return _emTableView;
    _emBuildFieldMeta();
    _emTableView = TableView.create({
        storageKey: 'embed-menu-table-prefs',
        columns: _EM_COLS,
        meta: _EM_FIELD_META,
        getTable: () => document.getElementById('em-table'),
        getDefaultWidth: col => _emDefaultWidth(col),
        minWidth: 40,
        sort: { storageKey: 'embed-menu-table-sort' },
        onSortChange: () => { renderEmbedMenuItems(); _ensureEmLayoutController()?.scheduleLayoutSave(); },
        onColumnResizeEnd: () => _ensureEmLayoutController()?.scheduleLayoutSave(),
    });
    return _emTableView;
}

function _ensureEmLayoutController() {
    if (_emLayoutController || typeof TableBucketLayouts === 'undefined') return _emLayoutController;
    _emBuildFieldMeta();
    _emLayoutController = TableBucketLayouts.create({
        getTable: () => document.getElementById('em-table'),
        getView: () => _ensureEmTableView(),
        getColumns: () => _EM_COLS,
        getMeta: col => (_EM_FIELD_META || _emBuildFieldMeta())[col],
        getDefaultWidth: col => _emDefaultWidth(col),
        getColumnSeed: col => _emColumnSeed(col),
        render: () => renderEmbedMenuItems(),
        surfaceLabel: 'Embed Menu',
        layoutContextTitle: 'Embed Menu Layout Context',
    });
    return _emLayoutController;
}

function _openEmColsModal() {
    const view = _ensureEmTableView();
    if (!view) return;
    view.openColumns(
        document.getElementById('em-cols-modal-list'),
        document.getElementById('em-cols-modal')
    );
}

function _applyEmColsModal() {
    const view = _ensureEmTableView();
    if (!view) return;
    const modal = document.getElementById('em-cols-modal');
    view.applyColumns(modal, () => {
        renderEmbedMenuItems();
        HubModal.close(modal);
        _ensureEmLayoutController()?.scheduleLayoutSave();
    });
}

async function openEmLayoutContextModal() {
    const controller = _ensureEmLayoutController();
    if (!controller) return;
    await controller.openLayoutContextModal();
}

async function loadEmbedMenuItems() {
    try {
        let resp = await apiFetch('/api/v1/embed-menu-items');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        _embedMenuItems = await resp.json();

        if (!_embedMenuItems.length) {
            const seedResp = await apiFetch('/api/v1/embed-menu-items/seed', { method: 'POST' });
            if (!seedResp.ok) throw new Error(`Seed failed (HTTP ${seedResp.status})`);
            resp = await apiFetch('/api/v1/embed-menu-items');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            _embedMenuItems = await resp.json();
        }

        renderEmbedMenuItems();
        _emSetStatus('');
    } catch (e) {
        _emSetStatus(`✗ ${e.message}`, 'var(--danger,#f85149)');
    }
}

function renderEmbedMenuItems() {
    const tbody = document.getElementById('em-tbody');
    const view = _ensureEmTableView();
    if (!tbody || !view) return;

    const visibleCols = view.getVisibleCols() || _EM_COLS;
    const meta = _EM_FIELD_META || _emBuildFieldMeta();
    const sortedBase = _emSortItems(_embedMenuItems);
    const sorted = view.sorter ? view.sorter.sortRows(sortedBase, _emSortValue) : sortedBase;
    if (!sorted.length) {
        view.render(() => {
            tbody.innerHTML = `<tr class="empty-row"><td colspan="${Math.max(1, visibleCols.length)}">No embed menu rows yet.</td></tr>`;
        });
        return;
    }

    view.render(() => {
        tbody.innerHTML = sorted.map(item => `<tr draggable="true" data-em-drag-id="${_esc(item.item_id)}" data-em-page="${item.page_index}">${visibleCols.map(col => meta[col].render(item)).join('')}</tr>`).join('');

        tbody.querySelectorAll('img[data-icon-fallback="1"]').forEach(img => {
            img.addEventListener('error', function onError() {
                this.removeEventListener('error', onError);
                this.src = '/fallback-ui/assets/icons/fallback.svg';
            });
        });
    });
}

function _emEditEls() {
    return {
        dialog: document.getElementById('em-edit-modal'),
        title: document.getElementById('em-edit-title'),
        context: document.getElementById('em-edit-context'),
        label: document.getElementById('em-edit-label'),
        page: document.getElementById('em-edit-page-index'),
        order: document.getElementById('em-edit-sort-order'),
        emoji: document.getElementById('em-edit-icon-emoji'),
        iconAsset: document.getElementById('em-edit-icon-asset'),
        soundAsset: document.getElementById('em-edit-sound-asset'),
        enabled: document.getElementById('em-edit-enabled'),
        error: document.getElementById('em-edit-error'),
        save: document.getElementById('em-edit-save-btn'),
        browseIcon: document.getElementById('em-edit-browse-icon-btn'),
        browseSound: document.getElementById('em-edit-browse-sound-btn'),
        previewSound: document.getElementById('em-edit-preview-sound-btn'),
    };
}

let _editingEmbedMenuItemId = null;
let _emDragItemId = null;

function _emOpenEdit(itemId) {
    const item = _embedMenuItems.find(row => row.item_id === itemId);
    if (!item) return;
    const els = _emEditEls();
    _editingEmbedMenuItemId = itemId;

    els.title.textContent = 'Edit Embedded Menu Item';
    els.context.textContent = `Action key: ${item.item_key}`;
    els.label.value = item.label || '';
    els.page.value = String(item.page_index || 0);
    els.order.value = String(item.sort_order || 0);
    els.emoji.value = item.icon_emoji || '';
    els.iconAsset.value = item.icon_asset || '';
    els.soundAsset.value = item.sound_asset || '';
    els.enabled.checked = !!item.enabled;
    els.error.textContent = '';

    HubModal.open(els.dialog, {
        onOpen: () => els.label.focus(),
        onClose: () => {
            _editingEmbedMenuItemId = null;
            if (typeof SoundManager !== 'undefined') SoundManager.stopPreview();
        },
    });
}

async function _emSaveEdit() {
    if (!_editingEmbedMenuItemId) return;
    const els = _emEditEls();
    const body = {
        label: (els.label.value || '').trim(),
        page_index: Math.max(0, Number.parseInt(els.page.value || '0', 10) || 0),
        sort_order: Math.max(0, Number.parseInt(els.order.value || '0', 10) || 0),
        icon_emoji: (els.emoji.value || '').trim() || null,
        icon_asset: (els.iconAsset.value || '').trim() || null,
        sound_asset: (els.soundAsset.value || '').trim() || null,
        enabled: els.enabled.checked ? 1 : 0,
    };
    if (!body.label) {
        els.error.textContent = 'Label is required.';
        return;
    }

    els.save.disabled = true;
    els.error.textContent = '';
    try {
        const resp = await apiFetch(`/api/v1/embed-menu-items/${encodeURIComponent(_editingEmbedMenuItemId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        HubModal.close(els.dialog);
        await loadEmbedMenuItems();
        _emNotifySelectorRefresh();
    } catch (e) {
        els.error.textContent = e.message || String(e);
    } finally {
        els.save.disabled = false;
    }
}

async function _emSwapSort(itemId, direction) {
    const sorted = _emSortItems(_embedMenuItems);
    const idx = sorted.findIndex(item => item.item_id === itemId);
    if (idx < 0) return;
    const current = sorted[idx];

    const samePage = sorted.filter(item => item.page_index === current.page_index);
    const pageIdx = samePage.findIndex(item => item.item_id === itemId);
    if (pageIdx < 0) return;
    const targetPageIdx = pageIdx + direction;
    if (targetPageIdx < 0 || targetPageIdx >= samePage.length) return;
    const target = samePage[targetPageIdx];

    try {
        const a = await apiFetch(`/api/v1/embed-menu-items/${encodeURIComponent(current.item_id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sort_order: target.sort_order }),
        });
        if (!a.ok) throw new Error(`HTTP ${a.status}`);

        const b = await apiFetch(`/api/v1/embed-menu-items/${encodeURIComponent(target.item_id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sort_order: current.sort_order }),
        });
        if (!b.ok) throw new Error(`HTTP ${b.status}`);

        await loadEmbedMenuItems();
        _emNotifySelectorRefresh();
    } catch (e) {
        _emSetStatus(`✗ ${e.message}`, 'var(--danger,#f85149)');
    }
}

async function _emMovePage(itemId, delta) {
    const item = _embedMenuItems.find(row => row.item_id === itemId);
    if (!item) return;
    const nextPage = Math.max(0, (item.page_index || 0) + delta);
    const nextSort = _emNextSortForPage(nextPage);

    try {
        const resp = await apiFetch(`/api/v1/embed-menu-items/${encodeURIComponent(itemId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page_index: nextPage, sort_order: nextSort }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        await loadEmbedMenuItems();
        _emNotifySelectorRefresh();
    } catch (e) {
        _emSetStatus(`✗ ${e.message}`, 'var(--danger,#f85149)');
    }
}

async function _emPersistPageOrder(pageIndex, orderedIds) {
    const pageItems = _emSortItems(_embedMenuItems).filter(item => item.page_index === pageIndex);
    if (!pageItems.length) return;

    const idToItem = new Map(pageItems.map(item => [item.item_id, item]));
    const updates = [];
    for (let i = 0; i < orderedIds.length; i += 1) {
        const item = idToItem.get(orderedIds[i]);
        if (!item) continue;
        if ((item.sort_order || 0) !== i) {
            updates.push({ item_id: item.item_id, sort_order: i });
        }
    }
    if (!updates.length) return;

    for (const update of updates) {
        const resp = await apiFetch(`/api/v1/embed-menu-items/${encodeURIComponent(update.item_id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sort_order: update.sort_order }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    }
}

async function _emDropReorder(dragItemId, targetItemId, pageIndex) {
    if (!dragItemId || !targetItemId || dragItemId === targetItemId) return;

    const pageItems = _emSortItems(_embedMenuItems).filter(item => item.page_index === pageIndex);
    const orderedIds = pageItems.map(item => item.item_id);
    const fromIdx = orderedIds.indexOf(dragItemId);
    const targetIdx = orderedIds.indexOf(targetItemId);
    if (fromIdx < 0 || targetIdx < 0) return;

    orderedIds.splice(fromIdx, 1);
    const insertIdx = fromIdx < targetIdx ? targetIdx - 1 : targetIdx;
    orderedIds.splice(insertIdx, 0, dragItemId);

    try {
        await _emPersistPageOrder(pageIndex, orderedIds);
        await loadEmbedMenuItems();
        _emNotifySelectorRefresh();
        _emSetStatus('Order saved.', 'var(--success,#2ea043)');
    } catch (e) {
        _emSetStatus(`✗ ${e.message}`, 'var(--danger,#f85149)');
    }
}

function _emOpenAssetPicker(kind) {
    const els = _emEditEls();
    const isIcon = kind === 'icon';
    AssetPicker.open({
        kind,
        title: isIcon ? 'Choose icon asset' : 'Choose sound asset',
        browseUrl: `/api/v1/nav-items/assets?type=${isIcon ? 'icons' : 'sounds'}`,
        emptyMessage: isIcon ? 'No icon assets uploaded yet.' : 'No sound assets uploaded yet.',
        onSelect: async (assetPath) => {
            if (isIcon) els.iconAsset.value = assetPath;
            else els.soundAsset.value = assetPath;
        },
    });
}

function _emPreviewSoundFromModal(btn) {
    const els = _emEditEls();
    const path = (els.soundAsset.value || '').trim();
    if (!path || typeof SoundManager === 'undefined') return;
    SoundManager.previewToggle(`/fallback-ui/assets/${path}`, { button: btn });
}

async function openEmExploreIcons() {
    AssetPicker.open({
        mode: 'explore',
        kind: 'icon',
        title: 'Explore icon assets',
        browseUrl: '/api/v1/nav-items/assets?type=icons',
        emptyMessage: 'No icon assets uploaded yet.',
        onDelete: async (assetPath) => {
            const resp = await apiFetch(`/api/v1/nav-items/assets?type=icons&asset_path=${encodeURIComponent(assetPath)}`, { method: 'DELETE' });
            if (!resp.ok) {
                const data = await resp.json().catch(() => null);
                throw new Error((data && data.detail && data.detail.message) || `HTTP ${resp.status}`);
            }
            await loadEmbedMenuItems();
        },
    });
}

async function openEmExploreSounds() {
    AssetPicker.open({
        mode: 'explore',
        kind: 'sound',
        title: 'Explore sound assets',
        browseUrl: '/api/v1/nav-items/assets?type=sounds',
        emptyMessage: 'No sound assets uploaded yet.',
        onDelete: async (assetPath) => {
            const resp = await apiFetch(`/api/v1/nav-items/assets?type=sounds&asset_path=${encodeURIComponent(assetPath)}`, { method: 'DELETE' });
            if (!resp.ok) {
                const data = await resp.json().catch(() => null);
                throw new Error((data && data.detail && data.detail.message) || `HTTP ${resp.status}`);
            }
            await loadEmbedMenuItems();
        },
    });
}

(function wireEmbedMenuEvents() {
    document.addEventListener('click', (event) => {
        const t = event.target;
        if (!(t instanceof Element)) return;

        const editId = t.getAttribute('data-em-edit');
        if (editId) {
            _emOpenEdit(editId);
            return;
        }
        const upId = t.getAttribute('data-em-up');
        if (upId) {
            void _emSwapSort(upId, -1);
            return;
        }
        const downId = t.getAttribute('data-em-down');
        if (downId) {
            void _emSwapSort(downId, 1);
            return;
        }
        const prevId = t.getAttribute('data-em-page-prev');
        if (prevId) {
            void _emMovePage(prevId, -1);
            return;
        }
        const nextId = t.getAttribute('data-em-page-next');
        if (nextId) {
            void _emMovePage(nextId, 1);
            return;
        }
    });

    const saveBtn = document.getElementById('em-edit-save-btn');
    if (saveBtn && !saveBtn.dataset.bound) {
        saveBtn.dataset.bound = '1';
        saveBtn.addEventListener('click', () => { void _emSaveEdit(); });
    }

    const browseIconBtn = document.getElementById('em-edit-browse-icon-btn');
    if (browseIconBtn && !browseIconBtn.dataset.bound) {
        browseIconBtn.dataset.bound = '1';
        browseIconBtn.addEventListener('click', () => _emOpenAssetPicker('icon'));
    }

    const browseSoundBtn = document.getElementById('em-edit-browse-sound-btn');
    if (browseSoundBtn && !browseSoundBtn.dataset.bound) {
        browseSoundBtn.dataset.bound = '1';
        browseSoundBtn.addEventListener('click', () => _emOpenAssetPicker('sound'));
    }

    const previewSoundBtn = document.getElementById('em-edit-preview-sound-btn');
    if (previewSoundBtn && !previewSoundBtn.dataset.bound) {
        previewSoundBtn.dataset.bound = '1';
        previewSoundBtn.addEventListener('click', () => _emPreviewSoundFromModal(previewSoundBtn));
    }

    const colsApplyBtn = document.getElementById('em-cols-modal-apply');
    if (colsApplyBtn && !colsApplyBtn.dataset.bound) {
        colsApplyBtn.dataset.bound = '1';
        colsApplyBtn.addEventListener('click', _applyEmColsModal);
    }

    const tbody = document.getElementById('em-tbody');
    if (tbody && !tbody.dataset.dragBound) {
        tbody.dataset.dragBound = '1';

        tbody.addEventListener('dragstart', (event) => {
            const tr = event.target instanceof Element ? event.target.closest('tr[data-em-drag-id]') : null;
            if (!tr) return;
            _emDragItemId = tr.getAttribute('data-em-drag-id');
            tr.classList.add('is-dragging');
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', _emDragItemId || '');
            }
        });

        tbody.addEventListener('dragover', (event) => {
            const tr = event.target instanceof Element ? event.target.closest('tr[data-em-drag-id]') : null;
            if (!tr || !_emDragItemId) return;
            const targetId = tr.getAttribute('data-em-drag-id');
            const targetPage = Number.parseInt(tr.getAttribute('data-em-page') || '0', 10) || 0;
            const dragItem = _embedMenuItems.find(item => item.item_id === _emDragItemId);
            if (!dragItem) return;
            if (dragItem.page_index !== targetPage) return;
            if (targetId === _emDragItemId) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        });

        tbody.addEventListener('drop', (event) => {
            const tr = event.target instanceof Element ? event.target.closest('tr[data-em-drag-id]') : null;
            if (!tr || !_emDragItemId) return;
            const targetId = tr.getAttribute('data-em-drag-id');
            const targetPage = Number.parseInt(tr.getAttribute('data-em-page') || '0', 10) || 0;
            const dragItem = _embedMenuItems.find(item => item.item_id === _emDragItemId);
            if (!dragItem) return;
            if (dragItem.page_index !== targetPage) return;
            event.preventDefault();
            void _emDropReorder(_emDragItemId, targetId, targetPage);
        });

        tbody.addEventListener('dragend', () => {
            _emDragItemId = null;
            tbody.querySelectorAll('tr.is-dragging').forEach(row => row.classList.remove('is-dragging'));
        });
    }

    _emBuildFieldMeta();
    _ensureEmTableView();
    _ensureEmLayoutController()?.init();
})();
