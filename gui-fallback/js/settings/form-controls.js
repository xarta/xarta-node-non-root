// form-controls.js — Form Controls management page for Blueprints Settings
// xarta-node Blueprints GUI
//
// Manages the form_controls table: assign sound/icon assets to any form control
// (input, select, toggle, button, etc.) identified by a data-fc-key string.
//
// Pattern: each uniquely-identified interactive element in the GUI can carry a
// data-fc-key attribute.  That key is registered here with a sound and/or icon
// asset, drawn from the same shared /fallback-ui/assets/ pool as Nav Items.
//
// Bulk upload: refer to the Nav Items page — uploads made there go into the
// same shared assets folder and are immediately available here.

'use strict';

const _FC_COLS = ['icon', 'control_key', 'label', 'control_type', 'context', 'icon_asset', 'sound_on', 'sound_off', 'notes', '_actions'];
const _FC_ACTION_INLINE_WIDTH = 90;
const _FC_ACTION_COMPACT_WIDTH = 48;
const _FC_ICON_ASSET_INLINE_WIDTH = 96;
const _FC_SOUND_ASSET_INLINE_WIDTH = 122;

let _fcItems = [];
let _editingFcControlId = null;
let _fcPickerAssets = [];
let _fcDiscoveredKeys = [];
let _FC_FIELD_META = null;
let _fcTableView = null;
let _fcLayoutController = null;
let _fcOpenAssetMenu = null;

const _FC_KEY_CACHE_KEY = 'blueprintsFormControlDiscoveredKeys';

function _fcAssetUrl(path, updatedAt) {
    if (!path) return '';
    const ts = updatedAt ? new Date(updatedAt).getTime() : 0;
    return `/fallback-ui/assets/${path}${ts ? `?v=${ts}` : ''}`;
}

function _fcEditModalEls() {
    return {
        dialog: document.getElementById('fc-edit-modal'),
        title: document.getElementById('fc-edit-modal-title'),
        context: document.getElementById('fc-edit-modal-context'),
        key: document.getElementById('fc-edit-key'),
        keyBrowser: document.getElementById('fc-key-browser'),
        keyCacheStatus: document.getElementById('fc-key-cache-status'),
        keyFilter: document.getElementById('fc-key-filter'),
        keyList: document.getElementById('fc-key-list'),
        keyRefreshBtn: document.getElementById('fc-key-refresh-btn'),
        label: document.getElementById('fc-edit-label'),
        type: document.getElementById('fc-edit-type'),
        fieldContext: document.getElementById('fc-edit-context'),
        notes: document.getElementById('fc-edit-notes'),
        error: document.getElementById('fc-edit-modal-error'),
        saveBtn: document.getElementById('fc-edit-modal-save-btn'),
    };
}

function _fcSetModalMessage(el, message, color) {
    if (!el) return;
    el.textContent = message || '';
    el.style.color = color || '';
}

function _fcReadKeyCache() {
    try {
        const raw = localStorage.getItem(_FC_KEY_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.keys)) return null;
        return parsed;
    } catch {
        return null;
    }
}

function _fcWriteKeyCache(keys) {
    try {
        localStorage.setItem(_FC_KEY_CACHE_KEY, JSON.stringify({
            keys,
            fetchedAt: Date.now(),
        }));
    } catch {
        // ignore storage failures
    }
}

function _fcFormatCacheTime(ts) {
    if (!ts) return 'No local cache yet.';
    try {
        return `Cached ${new Date(ts).toLocaleString()}`;
    } catch {
        return 'Cache time unavailable.';
    }
}

function _fcRenderDiscoveredKeyList() {
    const modal = _fcEditModalEls();
    if (!modal.keyList) return;

    const filter = (modal.keyFilter.value || '').trim().toLowerCase();
    const items = _fcDiscoveredKeys.filter(entry => !filter || entry.key.toLowerCase().includes(filter));

    if (!items.length) {
        modal.keyList.innerHTML = '<p class="fc-key-list-empty">No discovered keys match the current filter.</p>';
        return;
    }

    modal.keyList.innerHTML = '';
    for (const entry of items) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fc-key-option';
        btn.innerHTML = `
            <span class="fc-key-option-key">${_esc(entry.key)}</span>
            <span class="fc-key-option-meta">${_esc((entry.sources || []).slice(0, 2).join(' • '))}${entry.sources && entry.sources.length > 2 ? ` +${entry.sources.length - 2} more` : ''}</span>
        `;
        btn.addEventListener('click', () => {
            modal.key.value = entry.key;
            modal.key.focus();
            modal.key.select();
        });
        modal.keyList.appendChild(btn);
    }
}

async function _fcLoadDiscoveredKeys(forceRefresh) {
    const modal = _fcEditModalEls();
    const cached = !forceRefresh ? _fcReadKeyCache() : null;

    if (cached && Array.isArray(cached.keys) && cached.keys.length) {
        _fcDiscoveredKeys = cached.keys;
        _fcSetModalMessage(modal.keyCacheStatus, `${cached.keys.length} keys found. ${_fcFormatCacheTime(cached.fetchedAt)}`, '');
        _fcRenderDiscoveredKeyList();
        return cached.keys;
    }

    _fcSetModalMessage(modal.keyCacheStatus, 'Scanning gui-fallback for data-fc-key values...', '');
    modal.keyList.innerHTML = '<p class="fc-key-list-empty">Scanning...</p>';
    try {
        const resp = await apiFetch('/api/v1/form-controls/discover-keys');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        _fcDiscoveredKeys = Array.isArray(data.keys) ? data.keys : [];
        _fcWriteKeyCache(_fcDiscoveredKeys);
        _fcSetModalMessage(modal.keyCacheStatus, `${_fcDiscoveredKeys.length} keys found. ${_fcFormatCacheTime(Date.now())}`, '');
        _fcRenderDiscoveredKeyList();
        return _fcDiscoveredKeys;
    } catch (e) {
        _fcSetModalMessage(modal.keyCacheStatus, `Key scan failed: ${e.message}`, 'var(--danger,#f85149)');
        modal.keyList.innerHTML = '<p class="fc-key-list-empty">Unable to load discovered keys.</p>';
        return [];
    }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function loadFormControls() {
    const statusEl = document.getElementById('fc-status');
    try {
        const resp = await apiFetch('/api/v1/form-controls');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        _fcItems = await resp.json();
        renderFormControls();
        const cached = _fcReadKeyCache();
        if (!cached || !Array.isArray(cached.keys) || !cached.keys.length) {
            void _fcLoadDiscoveredKeys(false);
        } else {
            _fcDiscoveredKeys = cached.keys;
        }
        if (statusEl) statusEl.textContent = '';
    } catch (e) {
        if (statusEl) {
            statusEl.textContent = `✗ ${e.message}`;
            statusEl.style.color = 'var(--danger,#f85149)';
        }
    }
}

// ── Table rendering ───────────────────────────────────────────────────────────

function _fcIconHtml(item) {
    if (item.icon_asset) {
        return `<img class="fc-icon-preview menu-icon" src="${_esc(_fcAssetUrl(item.icon_asset, item.updated_at))}" alt="" data-icon-fallback="1">`;
    }
    return `<span class="fc-icon-placeholder" title="No icon assigned">—</span>`;
}

function _fcAssetCell(item, options) {
    const path = item[options.field] || '';
    const shouldCollapse = _fcShouldCollapseAssetActions(options.columnKey, options.requiredWidth);
    const pathHtml = shouldCollapse
        ? ''
        : (path
            ? `<span class="fc-asset-name" title="${_esc(path)}">${_esc(path)}</span>`
            : `<span class="fc-asset-none">—</span>`);
    const menuKey = `${item.control_id}:${options.assetType}`;
    const inlineActions = `${options.includeUpload ? `<button type="button" class="table-icon-btn table-icon-btn--sm table-icon-btn--upload" data-fc-upload="${_esc(options.assetType)}" data-control-id="${_esc(item.control_id)}" title="${_esc(options.uploadTitle)}" aria-label="${_esc(options.uploadTitle)}"></button>` : ''}${options.includeBrowse ? `<button type="button" class="table-icon-btn table-icon-btn--sm table-icon-btn--browse" data-fc-browse="${_esc(options.assetType)}" data-control-id="${_esc(item.control_id)}" title="${_esc(options.browseTitle)}" aria-label="${_esc(options.browseTitle)}"></button>` : ''}${options.includePlay && path ? `<button type="button" class="table-icon-btn table-icon-btn--sm table-icon-btn--play-toggle" data-fc-play="${_esc(path)}" data-updated="${_esc(item.updated_at || '')}" title="${_esc(options.playTitle)}" aria-label="${_esc(options.playTitle)}" aria-pressed="false">▶</button>` : ''}${options.includeClear && path ? `<button type="button" class="table-icon-btn table-icon-btn--sm table-icon-btn--clear-asset" data-fc-clear="${_esc(options.field)}" data-control-id="${_esc(item.control_id)}" title="${_esc(options.clearTitle)}" aria-label="${_esc(options.clearTitle)}"></button>` : ''}`;
    const menuActions = `${options.includeUpload ? `<button type="button" class="table-icon-btn table-icon-btn--upload" data-fc-upload="${_esc(options.assetType)}" data-control-id="${_esc(item.control_id)}" title="${_esc(options.uploadTitle)}" aria-label="${_esc(options.uploadTitle)}"></button>` : ''}${options.includeBrowse ? `<button type="button" class="table-icon-btn table-icon-btn--browse" data-fc-browse="${_esc(options.assetType)}" data-control-id="${_esc(item.control_id)}" title="${_esc(options.browseTitle)}" aria-label="${_esc(options.browseTitle)}"></button>` : ''}${options.includePlay && path ? `<button type="button" class="table-icon-btn table-icon-btn--play-toggle" data-fc-play="${_esc(path)}" data-updated="${_esc(item.updated_at || '')}" title="${_esc(options.playTitle)}" aria-label="${_esc(options.playTitle)}" aria-pressed="false">▶</button>` : ''}${options.includeClear && path ? `<button type="button" class="table-icon-btn table-icon-btn--clear-asset" data-fc-clear="${_esc(options.field)}" data-control-id="${_esc(item.control_id)}" title="${_esc(options.clearTitle)}" aria-label="${_esc(options.clearTitle)}"></button>` : ''}`;
    const menuPath = `<div class="table-asset-menu-path" title="${_esc(path || 'No asset assigned')}">${_esc(path || 'No asset assigned')}</div>`;
    const collapsedActions = `<span class="table-asset-menu-anchor"><button type="button" class="table-icon-btn table-icon-btn--scarab" title="${_esc(options.menuTitle)}" aria-label="${_esc(options.menuTitle)}" aria-expanded="${_fcOpenAssetMenu === menuKey ? 'true' : 'false'}" data-fc-asset-menu-trigger="${_esc(menuKey)}"></button>${_fcOpenAssetMenu === menuKey ? `<span class="table-asset-menu" data-fc-asset-menu="${_esc(menuKey)}">${menuPath}<span class="table-asset-menu-actions">${menuActions}</span></span>` : ''}</span>`;
    return `<td class="${_esc(options.cellClass)}"><div class="fc-asset-cell${shouldCollapse ? ' is-collapsed' : ''}">${pathHtml}<div class="fc-asset-btns"><input type="file" class="fc-file-input" style="display:none" data-control-id="${_esc(item.control_id)}" data-asset-type="${_esc(options.assetType)}" accept="${_esc(options.accept)}">${shouldCollapse ? collapsedActions : inlineActions}</div></div></td>`;
}

function _fcActionButtons(item) {
    const controlId = _esc(item.control_id);
    return `<button type="button" class="table-icon-btn table-icon-btn--edit" data-fc-edit="${controlId}" title="Edit form control" aria-label="Edit form control"></button><button type="button" class="table-icon-btn table-icon-btn--delete" data-fc-delete="${controlId}" title="Delete form control" aria-label="Delete form control"></button>`;
}

function _fcBuildFieldMeta() {
    if (_FC_FIELD_META) return _FC_FIELD_META;
    _FC_FIELD_META = {
        icon: {
            label: 'Icon',
            render: item => `<td class="fc-col-icon">${_fcIconHtml(item)}</td>`,
        },
        control_key: {
            label: 'Control Key',
            sortKey: 'control_key',
            render: item => `<td class="fc-col-key"><code>${_esc(item.control_key)}</code></td>`,
        },
        label: {
            label: 'Label',
            sortKey: 'label',
            render: item => `<td class="fc-col-label">${_esc(item.label || '')}</td>`,
        },
        control_type: {
            label: 'Type',
            sortKey: 'control_type',
            render: item => `<td class="fc-col-type">${_esc(item.control_type || '')}</td>`,
        },
        context: {
            label: 'Context',
            sortKey: 'context',
            render: item => `<td class="fc-col-context">${_esc(item.context || '')}</td>`,
        },
        icon_asset: {
            label: 'Icon Asset',
            sortKey: 'icon_asset',
            render: item => _fcAssetCell(item, {
                columnKey: 'icon_asset',
                field: 'icon_asset',
                assetType: 'icons',
                cellClass: 'fc-col-icon-asset',
                accept: '.svg,.png,.ico,.jpg,.jpeg,.webp',
                requiredWidth: _FC_ICON_ASSET_INLINE_WIDTH,
                menuTitle: 'Icon asset actions',
                uploadTitle: 'Upload icon',
                browseTitle: 'Browse icons',
                playTitle: '',
                clearTitle: 'Clear icon',
                includeUpload: true,
                includeBrowse: true,
                includePlay: false,
                includeClear: true,
            }),
        },
        sound_on: {
            label: 'Sound On',
            sortKey: 'sound_asset',
            render: item => _fcAssetCell(item, {
                columnKey: 'sound_on',
                field: 'sound_asset',
                assetType: 'sounds',
                accept: '.wav,.mp3,.ogg,.flac,.webm,.m4a',
                cellClass: 'fc-col-sound-on',
                requiredWidth: _FC_SOUND_ASSET_INLINE_WIDTH,
                menuTitle: 'Sound on actions',
                uploadTitle: 'Upload on sound',
                browseTitle: 'Browse on sounds',
                playTitle: 'Preview on sound',
                clearTitle: 'Clear on sound',
                includeUpload: true,
                includeBrowse: true,
                includePlay: true,
                includeClear: true,
            }),
        },
        sound_off: {
            label: 'Sound Off',
            sortKey: 'sound_asset_off',
            render: item => _fcAssetCell(item, {
                columnKey: 'sound_off',
                field: 'sound_asset_off',
                assetType: 'sounds_off',
                accept: '.wav,.mp3,.ogg,.flac,.webm,.m4a',
                cellClass: 'fc-col-sound-off',
                requiredWidth: _FC_SOUND_ASSET_INLINE_WIDTH,
                menuTitle: 'Sound off actions',
                uploadTitle: 'Upload off sound',
                browseTitle: 'Browse off sounds',
                playTitle: 'Preview off sound',
                clearTitle: 'Clear off sound',
                includeUpload: true,
                includeBrowse: true,
                includePlay: true,
                includeClear: true,
            }),
        },
        notes: {
            label: 'Notes',
            sortKey: 'notes',
            render: item => `<td class="fc-col-notes"><span class="table-cell-clamp">${_esc(item.notes || '') || '—'}</span></td>`,
        },
        _actions: {
            label: 'Actions',
            render: item => {
                if (_fcCompactRowActions()) {
                    return `<td class="table-action-cell table-action-cell--compact" style="width:${_fcActionCellWidth()}px"><button class="table-row-action-trigger secondary" type="button" title="Form control actions" data-fc-actions="${_esc(item.control_id)}">&#8942;</button></td>`;
                }
                return `<td class="table-action-cell" style="white-space:nowrap"><div class="table-inline-actions">${_fcActionButtons(item)}</div></td>`;
            },
        },
    };
    return _FC_FIELD_META;
}

function _fcDefaultWidth(col) {
    switch (col) {
        case 'icon': return 44;
        case 'control_key': return 150;
        case 'label': return 140;
        case 'control_type': return 100;
        case 'context': return 130;
        case 'icon_asset':
        case 'sound_on':
        case 'sound_off': return 200;
        case 'notes': return 220;
        case '_actions': return _fcActionCellWidth();
        default: return null;
    }
}

function _fcColumnType(col) {
    if (col === 'icon' || col === '_actions') return null;
    return 'TEXT';
}

function _fcColumnSeed(col) {
    return {
        sqlite_column: col === 'sound_on' ? 'sound_asset' : (col === 'sound_off' ? 'sound_asset_off' : (col.startsWith('_') ? null : col)),
        data_type: _fcColumnType(col),
        sample_max_length: col === 'notes' ? 120 : (col === 'icon_asset' || col === 'sound_on' || col === 'sound_off' ? 60 : 32),
        min_width_px: col === '_actions' ? _FC_ACTION_COMPACT_WIDTH : 40,
        max_width_px: col === '_actions' ? _FC_ACTION_INLINE_WIDTH : (col === 'notes' ? 480 : 400),
        width_px: _ensureFcTableView()?.prefs?.getWidth(col) || _fcDefaultWidth(col),
    };
}

function _fcSortValue(item, sortKey) {
    switch (sortKey) {
        case 'control_key': return item.control_key || '';
        case 'label': return item.label || '';
        case 'control_type': return item.control_type || '';
        case 'context': return item.context || '';
        case 'icon_asset': return item.icon_asset || '';
        case 'sound_asset': return item.sound_asset || '';
        case 'sound_asset_off': return item.sound_asset_off || '';
        case 'notes': return item.notes || '';
        default: return '';
    }
}

function _ensureFcTableView() {
    if (_fcTableView || typeof TableView === 'undefined') return _fcTableView;
    _fcBuildFieldMeta();
    _fcTableView = TableView.create({
        storageKey: 'form-controls-table-prefs',
        columns: _FC_COLS,
        meta: _FC_FIELD_META,
        getTable: () => document.getElementById('fc-table'),
        getDefaultWidth: col => _fcDefaultWidth(col),
        minWidth: 40,
        sort: { storageKey: 'form-controls-table-sort' },
        onSortChange: () => { renderFormControls(); _ensureFcLayoutController()?.scheduleLayoutSave(); },
        onColumnResizeEnd: () => _ensureFcLayoutController()?.scheduleLayoutSave(),
    });
    return _fcTableView;
}

function _ensureFcLayoutController() {
    if (_fcLayoutController || typeof TableBucketLayouts === 'undefined') return _fcLayoutController;
    _fcBuildFieldMeta();
    _fcLayoutController = TableBucketLayouts.create({
        getTable: () => document.getElementById('fc-table'),
        getView: () => _ensureFcTableView(),
        getColumns: () => _FC_COLS,
        getMeta: col => (_FC_FIELD_META || _fcBuildFieldMeta())[col],
        getDefaultWidth: col => _fcDefaultWidth(col),
        getColumnSeed: col => _fcColumnSeed(col),
        render: () => renderFormControls(),
        surfaceLabel: 'Form Controls',
        layoutContextTitle: 'Form Controls Layout Context',
    });
    return _fcLayoutController;
}

function _fcCompactRowActions() {
    const view = _ensureFcTableView();
    return !!(view && typeof TableRowActions !== 'undefined' && TableRowActions.shouldCollapse({
        view,
        getTable: () => document.getElementById('fc-table'),
        columnKey: '_actions',
        requiredWidth: _FC_ACTION_INLINE_WIDTH,
        defaultWidth: _FC_ACTION_INLINE_WIDTH,
    }));
}

function _fcActionCellWidth() {
    return _fcCompactRowActions() ? _FC_ACTION_COMPACT_WIDTH : _FC_ACTION_INLINE_WIDTH;
}

function _fcShouldCollapseAssetActions(columnKey, requiredWidth) {
    const view = _ensureFcTableView();
    return !!(view && typeof TableRowActions !== 'undefined' && TableRowActions.shouldCollapse({
        view,
        getTable: () => document.getElementById('fc-table'),
        columnKey,
        requiredWidth,
        defaultWidth: _fcDefaultWidth(columnKey),
    }));
}

function _fcToggleAssetMenu(menuKey) {
    _fcOpenAssetMenu = _fcOpenAssetMenu === menuKey ? null : menuKey;
    renderFormControls();
}

function _fcCloseAssetMenu() {
    if (!_fcOpenAssetMenu) return;
    _fcOpenAssetMenu = null;
    renderFormControls();
}

function _openFcRowActions(controlId) {
    if (typeof TableRowActions === 'undefined') return;
    const item = _fcItems.find(entry => String(entry.control_id) === String(controlId));
    if (!item) return;
    TableRowActions.open({
        title: item.label || item.control_key || 'Form control actions',
        subtitle: item.context || item.control_type || 'Form Controls',
        actions: [
            {
                label: 'Edit form control',
                detail: 'Open the form control editor',
                onClick: () => _fcOpenEditModal(item.control_id),
            },
            {
                label: 'Delete form control',
                detail: 'Remove this form control mapping',
                tone: 'danger',
                onClick: () => _fcOpenDeleteModal(item.control_id),
            },
        ],
    });
}

function _openFcColsModal() {
    const view = _ensureFcTableView();
    if (!view) return;
    view.openColumns(
        document.getElementById('fc-cols-modal-list'),
        document.getElementById('fc-cols-modal')
    );
}

function _applyFcColsModal() {
    const view = _ensureFcTableView();
    if (!view) return;
    const modal = document.getElementById('fc-cols-modal');
    view.applyColumns(modal, () => {
        renderFormControls();
        HubModal.close(modal);
        _ensureFcLayoutController()?.scheduleLayoutSave();
    });
}

async function openFcLayoutContextModal() {
    const controller = _ensureFcLayoutController();
    if (!controller) return;
    await controller.openLayoutContextModal();
}

function toggleFcHorizontalScroll() {
    const controller = _ensureFcLayoutController();
    if (!controller) return;
    controller.toggleHorizontalScroll();
}

function renderFormControls() {
    const tbody = document.getElementById('fc-tbody');
    const view = _ensureFcTableView();
    if (!tbody || !view) return;

    const visibleCols = view.getVisibleCols() || _FC_COLS;
    const meta = _FC_FIELD_META || _fcBuildFieldMeta();
    if (!_fcItems.length) {
        view.render(() => {
            tbody.innerHTML = `<tr class="empty-row"><td colspan="${Math.max(1, visibleCols.length)}">No form controls registered yet. Use the Settings context menu to add the first key.</td></tr>`;
        });
        return;
    }

    const baseRows = [..._fcItems].sort((a, b) => (a.label || a.control_key || '').localeCompare(b.label || b.control_key || ''));
    const rows = view.sorter ? view.sorter.sortRows(baseRows, _fcSortValue) : baseRows;
    view.render(() => {
        tbody.innerHTML = rows.map(item => `<tr data-control-id="${_esc(item.control_id)}">${visibleCols.map(col => meta[col].render(item)).join('')}</tr>`).join('');
        tbody.querySelectorAll('img[data-icon-fallback]').forEach(img => {
            img.addEventListener('error', function() {
                if (!this.dataset.usedFallback) {
                    this.dataset.usedFallback = '1';
                    this.src = '/fallback-ui/assets/icons/fallback.svg';
                }
            });
        });
    });
}

// ── Add new control ───────────────────────────────────────────────────────────

async function _fcAddNew() {
    const modal = _fcEditModalEls();
    _editingFcControlId = null;
    const badge = document.getElementById('fc-edit-modal-badge');
    if (badge) badge.textContent = 'ADD';
    modal.title.textContent = 'Add Control Key';
    modal.context.textContent = 'Create a new form-control mapping for a data-fc-key used in the GUI.';
    modal.key.disabled = false;
    modal.keyBrowser.hidden = false;
    modal.key.value = '';
    modal.keyFilter.value = '';
    modal.label.value = '';
    modal.type.value = '';
    modal.fieldContext.value = '';
    modal.notes.value = '';
    _fcSetModalMessage(modal.error, '');
    const cached = _fcReadKeyCache();
    if (cached && Array.isArray(cached.keys) && cached.keys.length) {
        _fcDiscoveredKeys = cached.keys;
        _fcSetModalMessage(modal.keyCacheStatus, `${cached.keys.length} keys found. ${_fcFormatCacheTime(cached.fetchedAt)}`, '');
        _fcRenderDiscoveredKeyList();
    } else {
        modal.keyList.innerHTML = '<p class="fc-key-list-empty">Scanning...</p>';
    }
    HubModal.open(modal.dialog, {
        onOpen: () => {
            modal.key.focus();
            if (!cached || !Array.isArray(cached.keys) || !cached.keys.length) {
                void _fcLoadDiscoveredKeys(false);
            }
        },
        onClose: () => {
            _fcSetModalMessage(modal.error, '');
            _fcSetModalMessage(modal.keyCacheStatus, '');
        },
    });
}

async function _fcSubmitEditModal() {
    const modal = _fcEditModalEls();
    const statusEl = document.getElementById('fc-status');
    const key = modal.key.value.trim();
    const label = modal.label.value.trim();
    const controlType = modal.type.value.trim();
    const context = modal.fieldContext.value.trim();
    const notes = modal.notes.value.trim();

    if (!key) {
        _fcSetModalMessage(modal.error, 'Control key is required.');
        return;
    }
    if (!label) {
        _fcSetModalMessage(modal.error, 'Label is required.');
        return;
    }

    _fcSetModalMessage(modal.error, '');

    const isEdit = !!_editingFcControlId;

    try {
        const payload = isEdit
            ? {
                label,
                control_type: controlType || null,
                context: context || null,
                notes: notes || null,
            }
            : {
                control_key: key,
                label,
                control_type: controlType || null,
                context: context || null,
                notes: notes || null,
            };

        const resp = await apiFetch(isEdit ? `/api/v1/form-controls/${_editingFcControlId}` : '/api/v1/form-controls', {
            method: isEdit ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
            throw new Error(err.detail || `HTTP ${resp.status}`);
        }
        const saved = await resp.json();
        if (isEdit) {
            const idx = _fcItems.findIndex(i => i.control_id === _editingFcControlId);
            if (idx !== -1) _fcItems[idx] = saved;
        } else {
            _fcItems.push(saved);
        }
        HubModal.close(modal.dialog);
        renderFormControls();
        if (typeof FormControlManager !== 'undefined') FormControlManager.reload();
        if (statusEl) {
            statusEl.textContent = isEdit ? `✓ Updated "${saved.label}"` : `✓ Created "${saved.label}"`;
            statusEl.style.color = 'var(--ok,#3fb950)';
        }
    } catch (e) {
        _fcSetModalMessage(modal.error, `Save failed: ${e.message}`);
        if (statusEl) { statusEl.textContent = `✗ ${e.message}`; statusEl.style.color = 'var(--danger,#f85149)'; }
    }
}

// ── Inline edit dialog ────────────────────────────────────────────────────────

async function _fcOpenEditModal(controlId) {
    const item = _fcItems.find(i => i.control_id === controlId);
    if (!item) return;
    const modal = _fcEditModalEls();
    _editingFcControlId = controlId;
    const badge = document.getElementById('fc-edit-modal-badge');
    if (badge) badge.textContent = 'EDIT';
    modal.title.textContent = 'Edit Control Key';
    modal.context.textContent = `${item.control_key}${item.context ? ` • ${item.context}` : ''}`;
    modal.key.disabled = true;
    modal.keyBrowser.hidden = true;
    modal.key.value = item.control_key || '';
    modal.label.value = item.label || '';
    modal.type.value = item.control_type || '';
    modal.fieldContext.value = item.context || '';
    modal.notes.value = item.notes || '';
    _fcSetModalMessage(modal.error, '');
    HubModal.open(modal.dialog, {
        onOpen: () => modal.label.focus(),
        onClose: () => _fcSetModalMessage(modal.error, ''),
    });
}

// ── Delete ────────────────────────────────────────────────────────────────────

async function _fcOpenDeleteModal(controlId) {
    const item = _fcItems.find(i => i.control_id === controlId);
    if (!item) return;
    const ok = await HubDialogs.confirmDelete({
        title: 'Delete form control?',
        message: `Delete form control "${item.label}" (key: ${item.control_key})?`,
        detail: 'This removes only the database entry. The underlying key will simply have no icon or sound until it is created again.',
    });
    if (!ok) return;
    await _fcDeleteRow(controlId);
}

async function _fcDeleteRow(controlId) {
    const item = _fcItems.find(i => i.control_id === controlId);
    if (!item) return;

    const statusEl = document.getElementById('fc-status');
    try {
        const resp = await apiFetch(`/api/v1/form-controls/${controlId}`, { method: 'DELETE' });
        if (!resp.ok && resp.status !== 204) {
            const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
            throw new Error(err.detail || `HTTP ${resp.status}`);
        }
        _fcItems = _fcItems.filter(i => i.control_id !== controlId);
        renderFormControls();
        if (typeof FormControlManager !== 'undefined') FormControlManager.reload();
        if (statusEl) { statusEl.textContent = `✓ Deleted "${item.label}"`; statusEl.style.color = 'var(--ok,#3fb950)'; }
    } catch (e) {
        if (statusEl) { statusEl.textContent = `✗ ${e.message}`; statusEl.style.color = 'var(--danger,#f85149)'; }
        await HubDialogs.alertError({
            title: 'Delete failed',
            message: `Delete failed: ${e.message}`,
        });
    }
}

// ── Asset upload ──────────────────────────────────────────────────────────────

async function _fcUploadAsset(inp) {
    const file      = inp.files[0];
    const controlId = inp.dataset.controlId;
    const assetType = inp.dataset.assetType;
    if (!file || !controlId) return;

    const statusEl = document.getElementById('fc-status');
    if (statusEl) { statusEl.textContent = '⏳ Uploading…'; statusEl.style.color = ''; }

    const form = new FormData();
    form.append('file', file);
    // sounds_off uses the same file folder as sounds; only the DB column differs
    form.append('asset_type', assetType === 'sounds_off' ? 'sounds' : assetType);

    try {
        // Step 1: upload the file (returns path, no row update)
        const upResp = await apiFetch('/api/v1/form-controls/upload-asset', { method: 'POST', body: form });
        if (!upResp.ok) {
            const err = await upResp.json().catch(() => ({ detail: `HTTP ${upResp.status}` }));
            throw new Error(err.detail || `HTTP ${upResp.status}`);
        }
        const { path } = await upResp.json();

        // Step 2: assign path to the control row
        const assignForm = new FormData();
        assignForm.append('control_id', controlId);
        assignForm.append('asset_path', path);
        assignForm.append('asset_type', assetType);  // may be sounds_off
        const assignResp = await apiFetch('/api/v1/form-controls/assign-asset', { method: 'POST', body: assignForm });
        if (!assignResp.ok) {
            const err = await assignResp.json().catch(() => ({ detail: `HTTP ${assignResp.status}` }));
            throw new Error(err.detail || `HTTP ${assignResp.status}`);
        }
        const result = await assignResp.json();
        const field  = assetType === 'icons' ? 'icon_asset' : (assetType === 'sounds_off' ? 'sound_asset_off' : 'sound_asset');
        const idx    = _fcItems.findIndex(i => i.control_id === controlId);
        if (idx !== -1) _fcItems[idx][field] = result.path;

        renderFormControls();
        if (typeof FormControlManager !== 'undefined') FormControlManager.reload();
        inp.value = '';
        if (statusEl) { statusEl.textContent = `✓ Uploaded and assigned ${path}`; statusEl.style.color = 'var(--ok,#3fb950)'; }
    } catch (e) {
        if (statusEl) { statusEl.textContent = `✗ ${e.message}`; statusEl.style.color = 'var(--danger,#f85149)'; }
    }
}

// ── Clear asset field ─────────────────────────────────────────────────────────

async function _fcClearAsset(controlId, field) {
    const statusEl = document.getElementById('fc-status');
    try {
        const resp = await apiFetch(`/api/v1/form-controls/${controlId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [field]: null }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
            throw new Error(err.detail || `HTTP ${resp.status}`);
        }
        const updated = await resp.json();
        const idx = _fcItems.findIndex(i => i.control_id === controlId);
        if (idx !== -1) _fcItems[idx] = updated;
        renderFormControls();
        if (typeof FormControlManager !== 'undefined') FormControlManager.reload();
        if (statusEl) { statusEl.textContent = `✓ Cleared ${field}`; statusEl.style.color = 'var(--ok,#3fb950)'; }
    } catch (e) {
        if (statusEl) { statusEl.textContent = `✗ ${e.message}`; statusEl.style.color = 'var(--danger,#f85149)'; }
    }
}

async function _fcOpenPicker(controlId, assetType) {
    const browseType = assetType === 'sounds_off' ? 'sounds' : assetType;
    AssetPicker.open({
        title: `Choose ${assetType === 'icons' ? 'icon' : (assetType === 'sounds_off' ? 'off sound' : 'sound')}`,
        kind: assetType === 'icons' ? 'icon' : 'sound',
        browseUrl: `/api/v1/form-controls/assets?type=${browseType}`,
        emptyMessage: 'No assets uploaded yet.',
        onSelect: async (assetPath) => {
            await _fcPickerSelect(controlId, assetType, assetPath);
        },
    });
}

async function _fcOpenExplorePicker(assetType) {
    AssetPicker.open({
        title: `Explore ${assetType === 'icons' ? 'icons' : 'sounds'}`,
        mode: 'explore',
        kind: assetType === 'icons' ? 'icon' : 'sound',
        browseUrl: `/api/v1/form-controls/assets?type=${assetType}`,
        emptyMessage: 'No assets uploaded yet.',
        onDelete: async (assetPath) => {
            const resp = await apiFetch(`/api/v1/form-controls/assets?type=${encodeURIComponent(assetType)}&asset_path=${encodeURIComponent(assetPath)}`, {
                method: 'DELETE',
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
                const detail = typeof err.detail === 'string'
                    ? err.detail
                    : (err.detail?.message || err.message || `HTTP ${resp.status}`);
                throw new Error(detail);
            }
        },
    });
}

function openFcExploreIcons() {
    void _fcOpenExplorePicker('icons');
}

function openFcExploreSounds() {
    void _fcOpenExplorePicker('sounds');
}

async function _fcPickerSelect(controlId, assetType, assetPath) {
    const form = new FormData();
    form.append('control_id', controlId);
    form.append('asset_path', assetPath);
    form.append('asset_type', assetType);

    const resp = await apiFetch('/api/v1/form-controls/assign-asset', { method: 'POST', body: form });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
    }
    const result = await resp.json();
    const field  = assetType === 'icons' ? 'icon_asset' : (assetType === 'sounds_off' ? 'sound_asset_off' : 'sound_asset');
    const idx    = _fcItems.findIndex(i => i.control_id === controlId);
    if (idx !== -1) _fcItems[idx][field] = result.path;

    renderFormControls();
    if (typeof FormControlManager !== 'undefined') FormControlManager.reload();

    const pageStatus = document.getElementById('fc-status');
    if (pageStatus) { pageStatus.textContent = `✓ Assigned ${result.path}`; pageStatus.style.color = 'var(--ok,#3fb950)'; }
}

// ── Utilities (re-use from nav-items scope if present; else define locally) ───

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
    if (b < 1024)       return `${b} B`;
    if (b < 1048576)    return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1048576).toFixed(1)} MB`;
}

document.addEventListener('DOMContentLoaded', () => {
    _fcBuildFieldMeta();
    _ensureFcTableView();
    _ensureFcLayoutController()?.init();

    const editModal = _fcEditModalEls();
    if (editModal.saveBtn && !editModal.saveBtn.dataset.fcWired) {
        editModal.saveBtn.dataset.fcWired = '1';
        editModal.saveBtn.addEventListener('click', () => { void _fcSubmitEditModal(); });
    }
    if (editModal.keyFilter && !editModal.keyFilter.dataset.fcKeysWired) {
        editModal.keyFilter.dataset.fcKeysWired = '1';
        editModal.keyFilter.addEventListener('input', _fcRenderDiscoveredKeyList);
    }
    if (editModal.keyRefreshBtn && !editModal.keyRefreshBtn.dataset.fcKeysWired) {
        editModal.keyRefreshBtn.dataset.fcKeysWired = '1';
        editModal.keyRefreshBtn.addEventListener('click', () => { void _fcLoadDiscoveredKeys(true); });
    }

    const colsApplyBtn = document.getElementById('fc-cols-modal-apply');
    if (colsApplyBtn) colsApplyBtn.addEventListener('click', _applyFcColsModal);

    const tbody = document.getElementById('fc-tbody');
    if (tbody) {
        tbody.addEventListener('click', e => {
            const assetMenuTrigger = e.target.closest('[data-fc-asset-menu-trigger]');
            if (assetMenuTrigger) {
                e.stopPropagation();
                _fcToggleAssetMenu(assetMenuTrigger.dataset.fcAssetMenuTrigger);
                return;
            }
            const actionsBtn = e.target.closest('[data-fc-actions]');
            if (actionsBtn) {
                _openFcRowActions(actionsBtn.dataset.fcActions);
                return;
            }
            const uploadBtn = e.target.closest('[data-fc-upload]');
            if (uploadBtn) {
                const tr = uploadBtn.closest('tr');
                const inp = tr?.querySelector(`.fc-file-input[data-asset-type="${uploadBtn.dataset.fcUpload}"]`);
                if (inp) inp.click();
                return;
            }
            const browseBtn = e.target.closest('[data-fc-browse]');
            if (browseBtn) {
                _fcOpenPicker(browseBtn.dataset.controlId, browseBtn.dataset.fcBrowse);
                return;
            }
            const playBtn = e.target.closest('[data-fc-play]');
            if (playBtn && typeof SoundManager !== 'undefined') {
                SoundManager.previewToggle(_fcAssetUrl(playBtn.dataset.fcPlay, playBtn.dataset.updated), { button: playBtn });
                return;
            }
            const clearBtn = e.target.closest('[data-fc-clear]');
            if (clearBtn) {
                _fcClearAsset(clearBtn.dataset.controlId, clearBtn.dataset.fcClear);
                return;
            }
            const editBtn = e.target.closest('[data-fc-edit]');
            if (editBtn) {
                _fcOpenEditModal(editBtn.dataset.fcEdit);
                return;
            }
            const deleteBtn = e.target.closest('[data-fc-delete]');
            if (deleteBtn) {
                _fcOpenDeleteModal(deleteBtn.dataset.fcDelete);
            }
        });
        tbody.addEventListener('change', e => {
            const inp = e.target.closest('.fc-file-input');
            if (inp) _fcUploadAsset(inp);
        });
    }
    document.addEventListener('click', e => {
        if (!e.target.closest('.table-asset-menu-anchor')) _fcCloseAssetMenu();
    });
});
