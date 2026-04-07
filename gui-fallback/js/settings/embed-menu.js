// embed-menu.js — Embedded selector menu editor (settings tab)
// xarta-node Blueprints GUI

'use strict';

const _EM_COLS = ['icon', 'item_key', 'label', 'menu_context', 'page_index', 'sort_order', 'icon_asset', 'sound_asset', 'enabled', '_move', '_edit'];

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
        case 'menu_context': return 100;
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
    if (col === 'menu_context') return 'TEXT';
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
        case 'menu_context': return `${item.menu_context || 'embed'}__${String(item.page_index || 0).padStart(6, '0')}__${String(item.sort_order || 0).padStart(6, '0')}`;
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
        menu_context: {
            label: 'Context',
            sortKey: 'menu_context',
            render: item => `<td><code>${_esc(item.menu_context || 'embed')}</code></td>`,
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
        renderEmGrid();
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

// ── Grid editor state ───────────────────────────────────────────────────────
let _emGridDragItemId = null;           // item_id | 'placeholder' | null
let _emGridDragGroup = null;            // 'embed' | 'fallback-ui' | null
let _emGridDragPlaceholderFlatIdx = null; // flat index of dragged empty slot, or null

function _emGetPageSize() {
    const ps = window.BLUEPRINTS_SELECTOR_BUTTONS && window.BLUEPRINTS_SELECTOR_BUTTONS.pageSize;
    return (ps && Number.isFinite(ps) && ps > 0) ? Math.round(ps) : 3;
}

function _emGridItemsByGroup(group) {
    return _embedMenuItems.filter(item => (item.menu_context || 'embed') === group);
}

function _emPrettifyContext(ctx) {
    return ctx.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Build sparse Map<flatIdx, item>.  flatIdx = page_index * pageSize + sort_order. */
function _emBuildFlatMap(items, pageSize) {
    const map = new Map();
    for (const item of _emSortItems(items)) {
        const flatIdx = (item.page_index || 0) * pageSize + (item.sort_order || 0);
        if (!map.has(flatIdx)) map.set(flatIdx, item); // first wins on collision
    }
    return map;
}

function _emGridCellHtml(item, flatIdx, group, pageSize) {
    const col = flatIdx % pageSize;
    const embedClass = group === 'embed' ? ' em-grid-cell--embed' : '';
    const pageBadge = col === 0 ? `<span class="em-grid-cell__page-badge">P${Math.floor(flatIdx / pageSize)}</span>` : '';

    if (!item) {
        return `<div class="em-grid-cell em-grid-cell--empty${embedClass}" draggable="true" data-em-grid-group="${group}" data-em-flat-idx="${flatIdx}" title="Empty slot">${pageBadge}<img class="em-grid-cell__placeholder-icon" src="/fallback-ui/assets/icons/ui/placeholder-circle-gold.svg" alt=""></div>`;
    }

    const iconHtml = item.icon_asset
        ? `<img class="em-grid-cell__icon" src="${_esc(_emAssetUrl(item.icon_asset, item.updated_at))}" alt="" data-icon-fallback="1">`
        : item.icon_emoji
            ? `<span class="em-grid-cell__emoji">${_esc(item.icon_emoji)}</span>`
            : `<span class="em-grid-cell__icon em-grid-cell__icon--blank"></span>`;

    const disabledClass = item.enabled ? '' : ' em-grid-cell--disabled';
    return `<div class="em-grid-cell em-grid-cell--item${embedClass}${disabledClass}" draggable="true" data-em-grid-id="${_esc(item.item_id)}" data-em-grid-group="${group}" data-em-flat-idx="${flatIdx}" title="${_esc(item.label || item.item_key)}">${pageBadge}${iconHtml}<span class="em-grid-cell__label">${_esc(item.label || item.item_key)}</span></div>`;
}

function renderEmGrid() {
    const sections = document.getElementById('em-grid-sections');
    if (!sections) return;
    const pageSize = _emGetPageSize();

    // Group items by context; non-embed contexts first (alpha), embed last.
    const ctxMap = new Map();
    for (const item of _embedMenuItems) {
        const ctx = item.menu_context || 'embed';
        if (!ctxMap.has(ctx)) ctxMap.set(ctx, []);
        ctxMap.get(ctx).push(item);
    }
    const contexts = [...ctxMap.keys()].sort((a, b) => {
        if (a === 'embed') return 1;
        if (b === 'embed') return -1;
        return a.localeCompare(b);
    });

    sections.innerHTML = '';
    for (const ctx of contexts) {
        const items = ctxMap.get(ctx);
        if (!items || !items.length) continue;

        const section = document.createElement('div');
        section.className = 'em-grid-section';
        section.dataset.emGridCtx = ctx;

        const label = document.createElement('p');
        label.className = 'em-grid-section__label';
        label.textContent = _emPrettifyContext(ctx);
        section.appendChild(label);

        const grid = document.createElement('div');
        grid.className = 'em-grid';
        grid.style.setProperty('--em-grid-cols', String(pageSize));

        const flatMap = _emBuildFlatMap(items, pageSize);
        const maxFlat = Math.max(...flatMap.keys());
        const totalCells = (Math.floor(maxFlat / pageSize) + 2) * pageSize;
        const parts = [];
        for (let i = 0; i < totalCells; i++) {
            parts.push(_emGridCellHtml(flatMap.get(i) ?? null, i, ctx, pageSize));
        }
        grid.innerHTML = parts.join('');
        grid.querySelectorAll('img[data-icon-fallback="1"]').forEach(img => {
            img.addEventListener('error', function onErr() {
                this.removeEventListener('error', onErr);
                this.src = '/fallback-ui/assets/icons/fallback.svg';
            });
        });

        section.appendChild(grid);
        sections.appendChild(section);
    }
}

function _emGridResetDrag(editor) {
    _emGridDragItemId = null;
    _emGridDragGroup = null;
    _emGridDragPlaceholderFlatIdx = null;
    if (editor) {
        editor.querySelectorAll('.is-dragging, .em-grid-cell--drag-over').forEach(el => {
            el.classList.remove('is-dragging', 'em-grid-cell--drag-over');
        });
    }
}

async function _emGridSaveChanges(items, newFlatMap, pageSize) {
    const updates = [];
    for (const [flatIdx, item] of newFlatMap) {
        const newPage = Math.floor(flatIdx / pageSize);
        const newSort = flatIdx % pageSize;
        if (newPage !== (item.page_index || 0) || newSort !== (item.sort_order || 0)) {
            updates.push({ item_id: item.item_id, page_index: newPage, sort_order: newSort });
        }
    }
    if (!updates.length) return;

    _emSetStatus('Saving…');
    try {
        for (const upd of updates) {
            const resp = await apiFetch(`/api/v1/embed-menu-items/${encodeURIComponent(upd.item_id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page_index: upd.page_index, sort_order: upd.sort_order }),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        }
        await loadEmbedMenuItems();
        _emNotifySelectorRefresh();
        _emSetStatus('Saved.', 'var(--success,#2ea043)');
    } catch (e) {
        _emSetStatus(`✗ ${e.message}`, 'var(--danger,#f85149)');
    }
}

/** Move item to targetFlatIdx. If insertShift=true and slot is occupied, shift >= target right. */
async function _emGridMoveItem(dragItemId, group, targetFlatIdx, insertShift) {
    const pageSize = _emGetPageSize();
    const items = _emGridItemsByGroup(group);
    const flatMap = _emBuildFlatMap(items, pageSize);
    const dragItem = items.find(item => item.item_id === dragItemId);
    if (!dragItem) return;
    const sourceFlatIdx = (dragItem.page_index || 0) * pageSize + (dragItem.sort_order || 0);
    if (sourceFlatIdx === targetFlatIdx) return;

    flatMap.delete(sourceFlatIdx);
    if (insertShift && flatMap.has(targetFlatIdx)) {
        const toShift = [...flatMap.entries()].filter(([idx]) => idx >= targetFlatIdx).sort((a, b) => b[0] - a[0]);
        for (const [idx, itm] of toShift) { flatMap.delete(idx); flatMap.set(idx + 1, itm); }
    }
    flatMap.set(targetFlatIdx, dragItem);
    await _emGridSaveChanges(items, flatMap, pageSize);
}

/** Insert gap at targetFlatIdx, shifting all items >= targetFlatIdx right by one. */
async function _emGridInsertPlaceholder(group, targetFlatIdx) {
    const pageSize = _emGetPageSize();
    const items = _emGridItemsByGroup(group);
    const flatMap = _emBuildFlatMap(items, pageSize);
    const toShift = [...flatMap.entries()].filter(([idx]) => idx >= targetFlatIdx).sort((a, b) => b[0] - a[0]);
    for (const [idx, itm] of toShift) { flatMap.delete(idx); flatMap.set(idx + 1, itm); }
    // targetFlatIdx is now vacant — the gap
    await _emGridSaveChanges(items, flatMap, pageSize);
}

/** Move an existing empty slot from fromFlatIdx to toFlatIdx (close old gap, open new one). */
async function _emGridMoveEmptySlot(group, fromFlatIdx, toFlatIdx) {
    if (fromFlatIdx === toFlatIdx) return;
    const pageSize = _emGetPageSize();
    const items = _emGridItemsByGroup(group);
    const flatMap = _emBuildFlatMap(items, pageSize);
    if (flatMap.has(fromFlatIdx)) return; // not actually empty

    // Close old gap (shift items after it left)
    const step1 = [...flatMap.entries()].filter(([idx]) => idx > fromFlatIdx).sort((a, b) => a[0] - b[0]);
    for (const [idx, itm] of step1) { flatMap.delete(idx); flatMap.set(idx - 1, itm); }
    // Adjust target for the shift
    const adjTarget = toFlatIdx > fromFlatIdx ? toFlatIdx - 1 : toFlatIdx;
    // Open new gap (shift items at/after adjTarget right)
    const step2 = [...flatMap.entries()].filter(([idx]) => idx >= adjTarget).sort((a, b) => b[0] - a[0]);
    for (const [idx, itm] of step2) { flatMap.delete(idx); flatMap.set(idx + 1, itm); }
    await _emGridSaveChanges(items, flatMap, pageSize);
}

/** Remove empty slot at flatIdx, closing the gap by shifting items after it left. */
async function _emGridRemovePlaceholder(group, flatIdx) {
    const pageSize = _emGetPageSize();
    const items = _emGridItemsByGroup(group);
    const flatMap = _emBuildFlatMap(items, pageSize);
    if (flatMap.has(flatIdx)) return; // not actually empty

    const toShift = [...flatMap.entries()].filter(([idx]) => idx > flatIdx).sort((a, b) => a[0] - b[0]);
    for (const [idx, itm] of toShift) { flatMap.delete(idx); flatMap.set(idx - 1, itm); }
    await _emGridSaveChanges(items, flatMap, pageSize);
}

function _emShowGridItemModal(item) {
    const modal = document.getElementById('em-grid-info-modal');
    if (!modal) return;
    const titleEl = document.getElementById('em-grid-info-title');
    const bodyEl = document.getElementById('em-grid-info-body');
    if (titleEl) titleEl.textContent = item.label || item.item_key;
    if (bodyEl) {
        bodyEl.innerHTML = `<dl class="em-grid-info-dl">`
            + `<dt>Key</dt><dd><code>${_esc(item.item_key)}</code></dd>`
            + `<dt>Context</dt><dd><code>${_esc(item.menu_context || 'embed')}</code></dd>`
            + `<dt>Page</dt><dd>${item.page_index || 0}</dd>`
            + `<dt>Order</dt><dd>${item.sort_order || 0}</dd>`
            + (item.icon_asset ? `<dt>Icon</dt><dd><code>${_esc(item.icon_asset)}</code></dd>` : '')
            + (!item.enabled ? `<dt>Status</dt><dd style="color:var(--danger,#f85149)">Disabled</dd>` : '')
            + `</dl>`;
    }
    HubModal.open(modal);
}

function _wireEmGrid() {
    const editor = document.getElementById('em-grid-editor');
    if (!editor || editor.dataset.gridBound) return;
    editor.dataset.gridBound = '1';

    // Palette placeholder dragstart
    const palette = document.getElementById('em-grid-palette-placeholder');
    if (palette) {
        palette.addEventListener('dragstart', (e) => {
            _emGridDragItemId = 'placeholder';
            _emGridDragGroup = null; // palette has no source group
            _emGridDragPlaceholderFlatIdx = null;
            if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'all'; e.dataTransfer.setData('text/plain', 'placeholder'); }
        });
        palette.addEventListener('dragend', () => _emGridResetDrag(editor));
    }

    // Cell dragstart (items and empty slots)
    editor.addEventListener('dragstart', (e) => {
        const cell = e.target instanceof Element ? e.target.closest('.em-grid-cell[data-em-flat-idx]') : null;
        if (!cell || cell.id === 'em-grid-palette-placeholder') return;
        const group = cell.getAttribute('data-em-grid-group');
        if (!group) return;
        if (cell.classList.contains('em-grid-cell--empty')) {
            _emGridDragItemId = 'placeholder';
            _emGridDragPlaceholderFlatIdx = Number.parseInt(cell.getAttribute('data-em-flat-idx') || '-1', 10);
        } else {
            _emGridDragItemId = cell.getAttribute('data-em-grid-id');
            _emGridDragPlaceholderFlatIdx = null;
        }
        _emGridDragGroup = group;
        cell.classList.add('is-dragging');
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', _emGridDragItemId || ''); }
    });

    // Dragover cells
    editor.addEventListener('dragover', (e) => {
        const cell = e.target instanceof Element ? e.target.closest('.em-grid-cell[data-em-flat-idx]') : null;
        if (!cell || cell.id === 'em-grid-palette-placeholder' || !_emGridDragItemId) return;
        const group = cell.getAttribute('data-em-grid-group');
        if (!group) return;
        // Item drag: same group only. Empty-cell drag: same group only. Palette placeholder: any group.
        if (_emGridDragItemId !== 'placeholder' && group !== _emGridDragGroup) return;
        if (_emGridDragItemId === 'placeholder' && _emGridDragPlaceholderFlatIdx !== null && group !== _emGridDragGroup) return;
        // Don't drag item over itself
        const targetId = cell.getAttribute('data-em-grid-id');
        if (targetId && targetId === _emGridDragItemId) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        cell.classList.add('em-grid-cell--drag-over');
    });

    editor.addEventListener('dragleave', (e) => {
        const cell = e.target instanceof Element ? e.target.closest('.em-grid-cell') : null;
        if (cell) cell.classList.remove('em-grid-cell--drag-over');
    });

    editor.addEventListener('drop', async (e) => {
        const cell = e.target instanceof Element ? e.target.closest('.em-grid-cell[data-em-flat-idx]') : null;
        if (!cell || !_emGridDragItemId) return;
        const group = cell.getAttribute('data-em-grid-group');
        if (!group) return;
        const targetFlatIdx = Number.parseInt(cell.getAttribute('data-em-flat-idx') || '0', 10);
        e.preventDefault();
        cell.classList.remove('em-grid-cell--drag-over');

        const dragId = _emGridDragItemId;
        const dragGroup = _emGridDragGroup;
        const placeholderFlatIdx = _emGridDragPlaceholderFlatIdx;
        _emGridResetDrag(editor);

        if (dragId === 'placeholder') {
            if (placeholderFlatIdx !== null) {
                // Moving an existing empty slot
                if (dragGroup !== group) return;
                await _emGridMoveEmptySlot(group, placeholderFlatIdx, targetFlatIdx);
            } else {
                // From palette — insert new gap
                await _emGridInsertPlaceholder(group, targetFlatIdx);
            }
        } else {
            if (group !== dragGroup) return;
            const isTargetEmpty = cell.classList.contains('em-grid-cell--empty');
            await _emGridMoveItem(dragId, group, targetFlatIdx, !isTargetEmpty);
        }
    });

    editor.addEventListener('dragend', () => _emGridResetDrag(editor));

    // Trash drop zone — only accepts empty slot drag
    const trash = document.getElementById('em-grid-trash');
    if (trash) {
        trash.addEventListener('dragover', (e) => {
            if (_emGridDragItemId !== 'placeholder' || _emGridDragPlaceholderFlatIdx === null) return;
            e.preventDefault();
            trash.classList.add('drag-target-active');
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        });
        trash.addEventListener('dragleave', () => trash.classList.remove('drag-target-active'));
        trash.addEventListener('drop', async (e) => {
            trash.classList.remove('drag-target-active');
            const group = _emGridDragGroup;
            const flatIdx = _emGridDragPlaceholderFlatIdx;
            _emGridResetDrag(editor);
            if (!group || flatIdx === null) return;
            e.preventDefault();
            await _emGridRemovePlaceholder(group, flatIdx);
        });
    }

    // Double-click → info modal (desktop)
    editor.addEventListener('dblclick', (e) => {
        const cell = e.target instanceof Element ? e.target.closest('.em-grid-cell--item') : null;
        if (!cell) return;
        const itemId = cell.getAttribute('data-em-grid-id');
        const item = _embedMenuItems.find(r => r.item_id === itemId);
        if (item) requestAnimationFrame(() => _emShowGridItemModal(item));
    });

    // Touch drag + double-tap (mobile)
    let _touchDrag = null;
    let _touchLastTapTime = 0;
    let _touchLastTapCell = null;

    function _touchDragCleanup() {
        if (!_touchDrag) return;
        if (_touchDrag.ghost) _touchDrag.ghost.remove();
        if (_touchDrag.sourceCell) _touchDrag.sourceCell.classList.remove('is-dragging');
        if (_touchDrag.lastTarget) _touchDrag.lastTarget.classList.remove('em-grid-cell--drag-over');
        const trash = document.getElementById('em-grid-trash');
        if (trash) trash.classList.remove('drag-target-active');
        _touchDrag = null;
    }

    function _touchDragPaletteStart(e) {
        const touch = e.touches[0];
        _touchDrag = {
            isPalette: true, isEmptySlot: false, sourceCell: null,
            group: null, flatIdx: null, itemId: 'placeholder',
            startX: touch.clientX, startY: touch.clientY,
            dragging: false, ghost: null, lastTarget: null,
        };
    }

    if (palette) {
        palette.addEventListener('touchstart', _touchDragPaletteStart, { passive: true });
    }

    editor.addEventListener('touchstart', (e) => {
        const cell = e.target instanceof Element ? e.target.closest('.em-grid-cell[data-em-flat-idx]') : null;
        if (!cell || cell.id === 'em-grid-palette-placeholder') return;
        const now = Date.now();
        // Double-tap detection
        if (_touchLastTapCell === cell && now - _touchLastTapTime < 350) {
            _touchLastTapTime = 0; _touchLastTapCell = null;
            const itemId = cell.getAttribute('data-em-grid-id');
            const item = _embedMenuItems.find(r => r.item_id === itemId);
            if (item) setTimeout(() => _emShowGridItemModal(item), 0);
            return;
        }
        _touchLastTapTime = now;
        _touchLastTapCell = cell;
        const touch = e.touches[0];
        _touchDrag = {
            isPalette: false,
            isEmptySlot: cell.classList.contains('em-grid-cell--empty'),
            sourceCell: cell,
            group: cell.getAttribute('data-em-grid-group'),
            flatIdx: Number.parseInt(cell.getAttribute('data-em-flat-idx') || '0', 10),
            itemId: cell.classList.contains('em-grid-cell--empty') ? 'placeholder' : cell.getAttribute('data-em-grid-id'),
            startX: touch.clientX, startY: touch.clientY,
            dragging: false, ghost: null, lastTarget: null,
        };
    }, { passive: true });

    editor.addEventListener('touchmove', (e) => {
        if (!_touchDrag) return;
        const touch = e.touches[0];
        const dx = touch.clientX - _touchDrag.startX;
        const dy = touch.clientY - _touchDrag.startY;
        if (!_touchDrag.dragging && Math.sqrt(dx * dx + dy * dy) > 8) {
            _touchDrag.dragging = true;
            // Create ghost
            const src = _touchDrag.sourceCell || document.getElementById('em-grid-palette-placeholder');
            if (src) {
                const ghost = src.cloneNode(true);
                ghost.removeAttribute('id');
                ghost.style.cssText = 'position:fixed;pointer-events:none;opacity:.7;z-index:9999;width:80px;height:80px;box-sizing:border-box;';
                document.body.appendChild(ghost);
                _touchDrag.ghost = ghost;
                if (_touchDrag.sourceCell) _touchDrag.sourceCell.classList.add('is-dragging');
            }
        }
        if (!_touchDrag.dragging) return;
        e.preventDefault();
        const ghost = _touchDrag.ghost;
        if (ghost) { ghost.style.left = (touch.clientX - 40) + 'px'; ghost.style.top = (touch.clientY - 40) + 'px'; }
        // Highlight target
        if (_touchDrag.lastTarget) { _touchDrag.lastTarget.classList.remove('em-grid-cell--drag-over'); _touchDrag.lastTarget = null; }
        const trash = document.getElementById('em-grid-trash');
        if (trash) trash.classList.remove('drag-target-active');
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        const trashHit = el && trash && (el === trash || trash.contains(el));
        if (trashHit && _touchDrag.isEmptySlot && !_touchDrag.isPalette) {
            trash.classList.add('drag-target-active');
        } else {
            const cell = el instanceof Element ? el.closest('.em-grid-cell[data-em-flat-idx]') : null;
            if (cell && cell !== _touchDrag.sourceCell) { cell.classList.add('em-grid-cell--drag-over'); _touchDrag.lastTarget = cell; }
        }
    }, { passive: false });

    async function _touchDragCommit(touch) {
        if (!_touchDrag || !_touchDrag.dragging) { _touchDragCleanup(); return; }
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        const trash = document.getElementById('em-grid-trash');
        const trashHit = el && trash && (el === trash || trash.contains(el));
        const dragId = _touchDrag.itemId;
        const dragGroup = _touchDrag.group;
        const sourceFlatIdx = _touchDrag.flatIdx;
        const isEmptySlot = _touchDrag.isEmptySlot;
        const isPalette = _touchDrag.isPalette;
        _touchDragCleanup();

        if (trashHit && isEmptySlot && !isPalette) {
            await _emGridRemovePlaceholder(dragGroup, sourceFlatIdx);
            return;
        }
        const cell = el instanceof Element ? el.closest('.em-grid-cell[data-em-flat-idx]') : null;
        if (!cell) return;
        const targetGroup = cell.getAttribute('data-em-grid-group');
        const targetFlatIdx = Number.parseInt(cell.getAttribute('data-em-flat-idx') || '0', 10);
        if (dragId === 'placeholder') {
            if (isPalette) {
                await _emGridInsertPlaceholder(targetGroup, targetFlatIdx);
            } else {
                if (targetGroup !== dragGroup) return;
                await _emGridMoveEmptySlot(dragGroup, sourceFlatIdx, targetFlatIdx);
            }
        } else {
            if (targetGroup !== dragGroup) return;
            await _emGridMoveItem(dragId, dragGroup, targetFlatIdx, !cell.classList.contains('em-grid-cell--empty'));
        }
    }

    editor.addEventListener('touchend', (e) => {
        if (!_touchDrag) return;
        const touch = e.changedTouches[0];
        void _touchDragCommit(touch);
    });
    editor.addEventListener('touchcancel', () => _touchDragCleanup());
    if (palette) {
        palette.addEventListener('touchend', (e) => {
            if (!_touchDrag) return;
            const touch = e.changedTouches[0];
            void _touchDragCommit(touch);
        });
        palette.addEventListener('touchcancel', () => _touchDragCleanup());
    }
}

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
    _wireEmGrid();
})();
