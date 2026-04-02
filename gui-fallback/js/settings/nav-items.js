// nav-items.js — Nav Items management page for Blueprints Settings
// xarta-node Blueprints GUI
//
// Displays all nav_items from the database grouped by menu_group.
// Supports inline editing of label, icon_emoji, icon_asset, sound_asset, sort_order.
// File upload buttons per row for icon and sound assets.
// "Browse existing" picker to assign already-uploaded assets without re-uploading.
// Bulk upload: drop a .zip / .7z / .tar.gz archive to extract into the assets folder.
// Icon preview column showing the resolved icon (asset > emoji > fallback).
// Sound preview/play button per row.

'use strict';

// ── Column definitions ─────────────────────────────────────────────────────────

const _NI_COLS = ['icon', 'item_key', 'label', 'page_label', 'icon_emoji', 'icon_asset', 'sound_asset', 'sort_order', 'fn_key', '_actions'];
const _NI_ACTION_INLINE_WIDTH = 44;
const _NI_ICON_ASSET_INLINE_WIDTH = 96;
const _NI_SOUND_ASSET_INLINE_WIDTH = 122;

// _NI_FIELD_META is populated below after _niIconHtml is defined.
let _NI_FIELD_META = null;

// ── TableView / BucketLayouts instances ────────────────────────────────────────

let _navItems = [];
let _editingNavItemId = null;
let _niTableView = null;
let _niLayoutController = null;
let _niOpenAssetMenu = null;

function _niAssetUrl(path, updatedAt) {
    if (!path) return '';
    const ts = updatedAt ? new Date(updatedAt).getTime() : 0;
    return `/fallback-ui/assets/${path}${ts ? `?v=${ts}` : ''}`;
}

function _niEditModalEls() {
    return {
        dialog: document.getElementById('nav-item-edit-modal'),
        title: document.getElementById('nav-item-edit-title'),
        context: document.getElementById('nav-item-edit-context'),
        label: document.getElementById('nav-item-edit-label'),
        pageLabel: document.getElementById('nav-item-edit-page-label'),
        emoji: document.getElementById('nav-item-edit-emoji'),
        order: document.getElementById('nav-item-edit-order'),
        error: document.getElementById('nav-item-edit-error'),
        saveBtn: document.getElementById('nav-item-edit-save-btn'),
    };
}

function _niSetModalMessage(el, message, color) {
    if (!el) return;
    el.textContent = message || '';
    if (color) el.style.color = color;
    else el.style.color = '';
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function loadNavItems() {
    const statusEl = document.getElementById('nav-items-status');
    try {
        // First pass: fetch current state to discover which groups need seeding
        const r0 = await apiFetch('/api/v1/nav-items');
        const current = r0.ok ? await r0.json() : [];
        const seededGroups = new Set(current.map(i => i.menu_group));

        // Trigger auto-seed for any absent group by calling that group's menu config
        const cfgMap = {
            probes:    typeof ProbesMenuConfig    !== 'undefined' ? ProbesMenuConfig    : null,
            synthesis: typeof SynthesisMenuConfig !== 'undefined' ? SynthesisMenuConfig : null,
            settings:  typeof SettingsMenuConfig  !== 'undefined' ? SettingsMenuConfig  : null,
        };
        const seedTasks = [];
        for (const [group, cfg] of Object.entries(cfgMap)) {
            if (!seededGroups.has(group) && cfg) {
                seedTasks.push(cfg.loadNavItemsFromDB());
            }
        }
        if (seedTasks.length) {
            if (statusEl) { statusEl.textContent = `⏳ Seeding ${seedTasks.length} group(s)…`; statusEl.style.color = ''; }
            await Promise.all(seedTasks);
        }

        // Second pass: fetch final state
        const r1 = await apiFetch('/api/v1/nav-items');
        if (!r1.ok) throw new Error(`HTTP ${r1.status}`);
        _navItems = await r1.json();
        renderNavItems();
        if (statusEl) statusEl.textContent = '';
    } catch (e) {
        if (statusEl) { statusEl.textContent = `✗ ${e.message}`; statusEl.style.color = 'var(--danger,#f85149)'; }
    }
}

// ── Table rendering ───────────────────────────────────────────────────────────

// ── Icon helper ────────────────────────────────────────────────────────────────

function _niIconHtml(item) {
    if (item.icon_asset) {
        return `<img class="ni-icon-preview menu-icon" src="${_esc(_niAssetUrl(item.icon_asset, item.updated_at))}" alt="" data-icon-fallback="1">`;
    }
    if (item.icon_emoji) {
        return `<span class="ni-icon-emoji">${_esc(item.icon_emoji)}</span>`;
    }
    return `<img class="ni-icon-preview menu-icon" src="/fallback-ui/assets/icons/fallback.svg" alt="?" data-icon-fallback="1">`;
}

function _niAssetActionCell(item, options) {
    const path = item[options.pathField] || '';
    const pathHtml = path
        ? `<span class="ni-asset-name" title="${_esc(path)}">${_esc(path)}</span>`
        : `<span class="ni-asset-none">—</span>`;
    const shouldCollapse = _niShouldCollapseAssetActions(options.columnKey, options.requiredWidth);
    const menuKey = `${item.item_id}:${options.assetType}`;
    const inlineActions = `${options.includeUpload ? `<button type="button" class="table-icon-btn table-icon-btn--sm table-icon-btn--upload" data-ni-upload="${_esc(options.assetType)}" data-item-id="${_esc(item.item_id)}" title="${_esc(options.uploadTitle)}" aria-label="${_esc(options.uploadTitle)}"></button>` : ''}${options.includeBrowse ? `<button type="button" class="table-icon-btn table-icon-btn--sm table-icon-btn--browse" data-ni-browse="${_esc(options.assetType)}" data-item-id="${_esc(item.item_id)}" title="${_esc(options.browseTitle)}" aria-label="${_esc(options.browseTitle)}"></button>` : ''}${options.includePlay && path ? `<button type="button" class="table-icon-btn table-icon-btn--sm table-icon-btn--play-toggle" data-ni-play="${_esc(path)}" data-updated="${_esc(item.updated_at || '')}" title="${_esc(options.playTitle)}" aria-label="${_esc(options.playTitle)}" aria-pressed="false">▶</button>` : ''}${options.includeClear && path ? `<button type="button" class="table-icon-btn table-icon-btn--sm table-icon-btn--clear-asset" data-ni-clear="${_esc(options.pathField)}" data-item-id="${_esc(item.item_id)}" title="${_esc(options.clearTitle)}" aria-label="${_esc(options.clearTitle)}"></button>` : ''}`;
    const collapsedActions = `<span class="table-asset-menu-anchor"><button type="button" class="table-icon-btn table-icon-btn--sm table-icon-btn--scarab" title="${_esc(options.menuTitle)}" aria-label="${_esc(options.menuTitle)}" aria-expanded="${_niOpenAssetMenu === menuKey ? 'true' : 'false'}" data-ni-asset-menu-trigger="${_esc(menuKey)}"></button>${_niOpenAssetMenu === menuKey ? `<span class="table-asset-menu" data-ni-asset-menu="${_esc(menuKey)}">${inlineActions}</span>` : ''}</span>`;
    return `<td class="${_esc(options.cellClass)}"><div class="ni-asset-cell">${pathHtml}<div class="ni-asset-btns"><input type="file" class="ni-file-input" style="display:none" data-item-id="${_esc(item.item_id)}" data-asset-type="${_esc(options.assetType)}" accept="${_esc(options.accept)}">${shouldCollapse ? collapsedActions : inlineActions}</div></div></td>`;
}

// ── Build field meta (called once after _niIconHtml is available) ──────────────

function _niBuildFieldMeta() {
    if (_NI_FIELD_META) return _NI_FIELD_META;
    _NI_FIELD_META = {
        icon: {
            label: 'Icon',
            render: item => `<td class="ni-col-icon">${_niIconHtml(item)}</td>`,
        },
        item_key: {
            label: 'Key',
            sortKey: 'item_key',
            render: item => `<td class="ni-col-key"><code>${_esc(item.item_key)}</code>${item.is_fn ? ' <span class="ni-fn-badge">fn</span>' : ''}</td>`,
        },
        label: {
            label: 'Label',
            sortKey: 'label',
            render: item => `<td class="ni-col-label">${_esc(item.label)}</td>`,
        },
        page_label: {
            label: 'Page Label',
            sortKey: 'page_label',
            render: item => `<td class="ni-col-page-label">${_esc(item.page_label || '')}</td>`,
        },
        icon_emoji: {
            label: 'Emoji',
            sortKey: 'icon_emoji',
            render: item => `<td class="ni-col-emoji">${_esc(item.icon_emoji || '')}</td>`,
        },
        icon_asset: {
            label: 'Icon Asset',
            render: item => _niAssetActionCell(item, {
                columnKey: 'icon_asset',
                pathField: 'icon_asset',
                assetType: 'icons',
                cellClass: 'ni-col-icon-asset',
                accept: '.svg,.png,.ico,.jpg,.jpeg,.webp',
                requiredWidth: _NI_ICON_ASSET_INLINE_WIDTH,
                menuTitle: 'Icon asset actions',
                uploadTitle: 'Upload icon',
                browseTitle: 'Browse icons',
                clearTitle: 'Clear icon',
                playTitle: '',
                includeUpload: true,
                includeBrowse: true,
                includePlay: false,
                includeClear: true,
            }),
        },
        sound_asset: {
            label: 'Sound Asset',
            render: item => _niAssetActionCell(item, {
                columnKey: 'sound_asset',
                pathField: 'sound_asset',
                assetType: 'sounds',
                cellClass: 'ni-col-sound-asset',
                accept: '.wav,.mp3,.ogg,.flac,.webm,.m4a',
                requiredWidth: _NI_SOUND_ASSET_INLINE_WIDTH,
                menuTitle: 'Sound asset actions',
                uploadTitle: 'Upload sound',
                browseTitle: 'Browse sounds',
                clearTitle: 'Clear sound',
                playTitle: 'Preview sound',
                includeUpload: true,
                includeBrowse: true,
                includePlay: true,
                includeClear: true,
            }),
        },
        sort_order: {
            label: 'Order',
            sortKey: 'sort_order',
            render: item => `<td class="ni-col-order">${item.sort_order}</td>`,
        },
        fn_key: {
            label: 'Type',
            sortKey: 'fn_key',
            render: item => `<td class="ni-col-type">${item.fn_key ? `<small>${_esc(item.fn_key)}</small>` : 'nav'}</td>`,
        },
        _actions: {
            label: 'Actions',
            render: item => `<td class="table-action-cell"><div class="table-inline-actions"><button type="button" class="table-icon-btn table-icon-btn--edit" data-ni-edit="${_esc(item.item_id)}" title="Edit nav item" aria-label="Edit nav item"></button></div></td>`,
        },
    };
    return _NI_FIELD_META;
}

// ── Column/sort helpers ────────────────────────────────────────────────────────

function _niDefaultWidth(col) {
    switch (col) {
        case 'icon':       return 44;
        case 'item_key':   return 120;
        case 'label':      return 120;
        case 'icon_asset': return 200;
        case 'sound_asset': return 200;
        case '_actions':   return _NI_ACTION_INLINE_WIDTH;
        default:           return null;
    }
}

function _niColumnType(col) {
    if (col === '_actions' || col === 'icon') return null;
    return 'TEXT';
}

function _niColumnSeed(col) {
    return {
        sqlite_column: col.startsWith('_') ? null : col,
        data_type: _niColumnType(col),
        sample_max_length: col === 'icon_asset' || col === 'sound_asset' ? 60 : 32,
        min_width_px: col === '_actions' ? _NI_ACTION_INLINE_WIDTH : 40,
        max_width_px: col === 'icon_asset' || col === 'sound_asset' ? 400 : (col === '_actions' ? _NI_ACTION_INLINE_WIDTH : 900),
        width_px: _ensureNiTableView()?.prefs?.getWidth(col) || _niDefaultWidth(col),
    };
}

function _niShouldCollapseAssetActions(columnKey, requiredWidth) {
    const view = _ensureNiTableView();
    return !!(view && typeof TableRowActions !== 'undefined' && TableRowActions.shouldCollapse({
        view,
        getTable: () => document.getElementById('ni-table'),
        columnKey,
        requiredWidth,
        defaultWidth: _niDefaultWidth(columnKey),
    }));
}

function _niToggleAssetMenu(menuKey) {
    _niOpenAssetMenu = _niOpenAssetMenu === menuKey ? null : menuKey;
    renderNavItems();
}

function _niCloseAssetMenu() {
    if (!_niOpenAssetMenu) return;
    _niOpenAssetMenu = null;
    renderNavItems();
}

function _niSortValue(item, sortKey) {
    switch (sortKey) {
        case 'item_key':   return item.item_key || '';
        case 'label':      return item.label || '';
        case 'page_label': return item.page_label || '';
        case 'icon_emoji': return item.icon_emoji || '';
        case 'sort_order': return item.sort_order ?? 0;
        case 'fn_key':     return item.fn_key || '';
        default:           return '';
    }
}

// ── TableView + BucketLayouts factories ────────────────────────────────────────

function _ensureNiTableView() {
    if (_niTableView || typeof TableView === 'undefined') return _niTableView;
    _niBuildFieldMeta();
    _niTableView = TableView.create({
        storageKey: 'nav-items-table-prefs',
        columns: _NI_COLS,
        meta: _NI_FIELD_META,
        getTable: () => document.getElementById('ni-table'),
        getDefaultWidth: col => _niDefaultWidth(col),
        minWidth: 40,
        sort: { storageKey: 'nav-items-table-sort' },
        onSortChange: () => { renderNavItems(); _ensureNiLayoutController()?.scheduleLayoutSave(); },
        onColumnResizeEnd: () => _ensureNiLayoutController()?.scheduleLayoutSave(),
    });
    return _niTableView;
}

function _ensureNiLayoutController() {
    if (_niLayoutController || typeof TableBucketLayouts === 'undefined') return _niLayoutController;
    _niBuildFieldMeta();
    _niLayoutController = TableBucketLayouts.create({
        getTable: () => document.getElementById('ni-table'),
        getView: () => _ensureNiTableView(),
        getColumns: () => _NI_COLS,
        getMeta: col => (_NI_FIELD_META || _niBuildFieldMeta())[col],
        getDefaultWidth: col => _niDefaultWidth(col),
        getColumnSeed: col => _niColumnSeed(col),
        render: () => renderNavItems(),
        surfaceLabel: 'Nav Items',
        layoutContextTitle: 'Nav Items Layout Context',
    });
    return _niLayoutController;
}

// ── Column chooser + layout context ───────────────────────────────────────────

function _openNiColsModal() {
    const view = _ensureNiTableView();
    if (!view) return;
    view.openColumns(
        document.getElementById('ni-cols-modal-list'),
        document.getElementById('ni-cols-modal')
    );
}

function _applyNiColsModal() {
    const view = _ensureNiTableView();
    if (!view) return;
    const modal = document.getElementById('ni-cols-modal');
    view.applyColumns(modal, () => {
        renderNavItems();
        HubModal.close(modal);
        _ensureNiLayoutController()?.scheduleLayoutSave();
    });
}

async function openNiLayoutContextModal() {
    const controller = _ensureNiLayoutController();
    if (!controller) return;
    await controller.openLayoutContextModal();
}

function toggleNiHorizontalScroll() {
    const controller = _ensureNiLayoutController();
    if (!controller) return;
    controller.toggleHorizontalScroll();
}

// ── Table rendering ────────────────────────────────────────────────────────────

function renderNavItems() {
    const bulkArea = document.getElementById('nav-items-bulk-area');
    if (bulkArea && !bulkArea.firstChild) {
        bulkArea.appendChild(_niBulkUploadPanelEl());
    }

    const meta = _NI_FIELD_META || _niBuildFieldMeta();
    const view = _ensureNiTableView();
    const visibleCols = view ? view.getVisibleCols() : _NI_COLS;

    view?.render(() => {
        const tbody = document.getElementById('ni-tbody');
        if (!tbody) return;

        const groups = ['probes', 'synthesis', 'settings'];
        let html = '';
        let hasAny = false;

        for (const group of groups) {
            const rawGroup = _navItems
                .filter(i => i.menu_group === group)
                .sort((a, b) => (a.sort_order - b.sort_order) || a.item_key.localeCompare(b.item_key));
            if (!rawGroup.length) continue;
            hasAny = true;

            const sorted = (view?.sorter?.getState()?.dir !== 0)
                ? view.sorter.sortRows(rawGroup, _niSortValue)
                : rawGroup;

            html += `<tr class="table-group-row"><td class="table-group-cell" colspan="${visibleCols.length}">${_esc(group.charAt(0).toUpperCase() + group.slice(1))}</td></tr>`;
            html += sorted.map(item =>
                `<tr data-item-id="${_esc(item.item_id)}">${visibleCols.map(col => meta[col].render(item)).join('')}</tr>`
            ).join('');
        }

        if (!hasAny) {
            html = `<tr class="empty-row"><td colspan="${visibleCols.length}">No nav items found.</td></tr>`;
        }

        tbody.innerHTML = html;

        // img error fallback — error events don't bubble so must bind directly
        tbody.querySelectorAll('img[data-icon-fallback]').forEach(img => {
            img.addEventListener('error', function () {
                if (!this.dataset.usedFallback) {
                    this.dataset.usedFallback = '1';
                    this.src = '/fallback-ui/assets/icons/fallback.svg';
                }
            });
        });
    });
}

// ── Bulk upload panel ─────────────────────────────────────────────────────────

function _niBulkUploadPanelEl() {
    const panel = document.createElement('div');
    panel.className = 'ni-bulk-panel';
    panel.innerHTML = `
        <div class="ni-bulk-header">Bulk asset upload</div>
        <p class="ni-bulk-desc">Upload a <strong>.zip</strong>, <strong>.7z</strong>, or <strong>.tar.gz</strong> archive.
        Files with matching extensions are extracted into the icons or sounds folder automatically.</p>
        <div class="ni-bulk-row">
            <select id="ni-bulk-type" style="padding:4px 8px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px">
                <option value="icons">Icons (.svg .png .ico .jpg .webp)</option>
                <option value="sounds">Sounds (.wav .mp3 .ogg .flac .webm .m4a)</option>
            </select>
            <label class="btn-small secondary ni-upload-label" style="cursor:pointer">
                📦 Choose archive
                <input type="file" id="ni-bulk-file" accept=".zip,.7z,.tar,.gz,.bz2,.tgz,.txz,.tar.gz,.tar.bz2,.tar.xz" style="display:none">
            </label>
            <span id="ni-bulk-filename" style="font-size:12px;color:var(--text-dim)">No file chosen</span>
            <button id="ni-bulk-upload-btn" class="btn-small" disabled>Upload &amp; extract</button>
        </div>
        <p id="ni-bulk-status" style="font-size:12px;margin:4px 0 0"></p>
    `;

    const fileInput = panel.querySelector('#ni-bulk-file');
    const filenameSpan = panel.querySelector('#ni-bulk-filename');
    const uploadBtn = panel.querySelector('#ni-bulk-upload-btn');
    const statusEl = panel.querySelector('#ni-bulk-status');

    fileInput.addEventListener('change', () => {
        const f = fileInput.files[0];
        filenameSpan.textContent = f ? f.name : 'No file chosen';
        uploadBtn.disabled = !f;
    });

    uploadBtn.addEventListener('click', async () => {
        const file = fileInput.files[0];
        const assetType = panel.querySelector('#ni-bulk-type').value;
        if (!file) return;

        uploadBtn.disabled = true;
        statusEl.textContent = '⏳ Uploading and extracting…';
        statusEl.style.color = '';

        const form = new FormData();
        form.append('file', file);
        form.append('asset_type', assetType);
        try {
            const resp = await apiFetch('/api/v1/nav-items/upload-bulk', { method: 'POST', body: form });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
                throw new Error(err.detail || `HTTP ${resp.status}`);
            }
            const result = await resp.json();
            const names = result.extracted.join(', ') || '(none)';
            if (result.count === 0) {
                statusEl.textContent = `⚠ No matching files found in archive. Check the type dropdown matches your archive contents.`;
                statusEl.style.color = 'var(--warn,#d29922)';
            } else {
                statusEl.textContent = `✓ Extracted ${result.count} file(s): ${names}`;
                statusEl.style.color = 'var(--ok,#3fb950)';
            }
            fileInput.value = '';
            filenameSpan.textContent = 'No file chosen';
            uploadBtn.disabled = true;
        } catch (e) {
            statusEl.textContent = `✗ ${e.message}`;
            statusEl.style.color = 'var(--danger,#f85149)';
            uploadBtn.disabled = false;
        }
    });

    return panel;
}

// ── Row builder ───────────────────────────────────────────────────────────────
// ── Asset picker modal ────────────────────────────────────────────────────────

async function _niOpenPicker(itemId, assetType) {
    AssetPicker.open({
        title: `Choose ${assetType === 'icons' ? 'icon' : 'sound'}`,
        kind: assetType === 'icons' ? 'icon' : 'sound',
        browseUrl: `/api/v1/nav-items/assets?type=${assetType}`,
        emptyMessage: 'No assets uploaded yet.',
        onSelect: async (assetPath) => {
            await _niPickerSelect(itemId, assetType, assetPath);
        },
    });
}

async function _niPickerSelect(itemId, assetType, assetPath) {
    const form = new FormData();
    form.append('item_id', itemId);
    form.append('asset_path', assetPath);
    form.append('asset_type', assetType);

    const resp = await apiFetch('/api/v1/nav-items/assign-asset', { method: 'POST', body: form });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
    }
    const result = await resp.json();

    const field = assetType === 'icons' ? 'icon_asset' : 'sound_asset';
    const idx = _navItems.findIndex(i => i.item_id === itemId);
    if (idx !== -1) _navItems[idx][field] = result.path;

    renderNavItems();
    _niReloadNavConfig(itemId);

    const pageStatus = document.getElementById('nav-items-status');
    if (pageStatus) {
        pageStatus.textContent = `✓ Assigned: ${result.path}`;
        pageStatus.style.color = 'var(--ok,#3fb950)';
        setTimeout(() => { pageStatus.textContent = ''; }, 2500);
    }
}

// ── Edit / save ───────────────────────────────────────────────────────────────

function _niOpenEditModal(itemId) {
    const item = _navItems.find(i => i.item_id === itemId);
    if (!item) return;

    const modal = _niEditModalEls();
    _editingNavItemId = itemId;
    modal.title.textContent = 'Edit Nav Item';
    modal.context.textContent = `${item.menu_group} • ${item.item_key}${item.fn_key ? ` • ${item.fn_key}` : ''}`;
    modal.label.value = item.label || '';
    modal.pageLabel.value = item.page_label || '';
    modal.emoji.value = item.icon_emoji || '';
    modal.order.value = item.sort_order ?? 0;
    _niSetModalMessage(modal.error, '');
    HubModal.open(modal.dialog, {
        onOpen: () => modal.label.focus(),
        onClose: () => _niSetModalMessage(modal.error, ''),
    });
}

function _niSubmitEditModal() {
    const modal = _niEditModalEls();
    const itemId = _editingNavItemId;
    const item = _navItems.find(i => i.item_id === itemId);
    if (!item) return;

    const label = modal.label.value.trim();
    const pageLabel = modal.pageLabel.value.trim();
    const emoji = modal.emoji.value.trim();
    const orderRaw = modal.order.value.trim();

    if (!label) {
        _niSetModalMessage(modal.error, 'Label is required.');
        return;
    }
    if (orderRaw && Number.isNaN(parseInt(orderRaw, 10))) {
        _niSetModalMessage(modal.error, 'Sort order must be a number.');
        return;
    }

    _niSetModalMessage(modal.error, '');
    _niSaveItem(itemId, {
        label,
        page_label: pageLabel || null,
        icon_emoji: emoji || null,
        sort_order: parseInt(orderRaw || String(item.sort_order), 10) || 0,
    }, {
        onSuccess: () => HubModal.close(modal.dialog),
        onError: (message) => _niSetModalMessage(modal.error, message),
    });
}

function _niSaveItem(itemId, update, handlers) {
    const statusEl = document.getElementById('nav-items-status');
    apiFetch(`/api/v1/nav-items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
    })
    .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
    })
    .then(updated => {
        const idx = _navItems.findIndex(i => i.item_id === itemId);
        if (idx !== -1) _navItems[idx] = updated;
        renderNavItems();
        _niReloadNavConfig(itemId);
        if (statusEl) { statusEl.textContent = '✓ Saved'; statusEl.style.color = 'var(--ok,#3fb950)'; }
        setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2500);
        if (handlers && typeof handlers.onSuccess === 'function') handlers.onSuccess(updated);
    })
    .catch(e => {
        if (statusEl) { statusEl.textContent = `✗ ${e.message}`; statusEl.style.color = 'var(--danger,#f85149)'; }
        if (handlers && typeof handlers.onError === 'function') handlers.onError(`Save failed: ${e.message}`);
    });
}

function _niClearAsset(itemId, field) {
    _niSaveItem(itemId, { [field]: '' });
}

// ── File upload (single asset) ────────────────────────────────────────────────

async function _niUploadAsset(input) {
    const itemId = input.dataset.itemId;
    const assetType = input.dataset.assetType;
    const file = input.files[0];
    if (!file || !itemId || !assetType) return;

    const statusEl = document.getElementById('nav-items-status');
    if (statusEl) { statusEl.textContent = '⏳ Uploading…'; statusEl.style.color = ''; }

    const form = new FormData();
    form.append('file', file);
    form.append('item_id', itemId);
    form.append('asset_type', assetType);

    try {
        const resp = await apiFetch('/api/v1/nav-items/upload-asset', { method: 'POST', body: form });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
            throw new Error(err.detail || `HTTP ${resp.status}`);
        }
        const result = await resp.json();
        const field = assetType === 'icons' ? 'icon_asset' : 'sound_asset';
        const idx = _navItems.findIndex(i => i.item_id === itemId);
        if (idx !== -1) _navItems[idx][field] = result.path;
        renderNavItems();
        _niReloadNavConfig(itemId);
        if (statusEl) { statusEl.textContent = `✓ Uploaded: ${result.path}`; statusEl.style.color = 'var(--ok,#3fb950)'; }
        setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
    } catch (e) {
        if (statusEl) { statusEl.textContent = `✗ Upload failed: ${e.message}`; statusEl.style.color = 'var(--danger,#f85149)'; }
    }
    input.value = '';
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function _esc(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

document.addEventListener('DOMContentLoaded', () => {
    _niBuildFieldMeta();
    _ensureNiTableView();
    _ensureNiLayoutController()?.init();

    const saveBtn = document.getElementById('nav-item-edit-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', _niSubmitEditModal);

    const colsApplyBtn = document.getElementById('ni-cols-modal-apply');
    if (colsApplyBtn) colsApplyBtn.addEventListener('click', _applyNiColsModal);

    const tbody = document.getElementById('ni-tbody');
    if (tbody) {
        tbody.addEventListener('click', e => {
            const assetMenuTrigger = e.target.closest('[data-ni-asset-menu-trigger]');
            if (assetMenuTrigger) {
                e.stopPropagation();
                _niToggleAssetMenu(assetMenuTrigger.dataset.niAssetMenuTrigger);
                return;
            }
            const uploadBtn = e.target.closest('[data-ni-upload]');
            if (uploadBtn) {
                const tr = uploadBtn.closest('tr');
                const inp = tr?.querySelector(`.ni-file-input[data-asset-type="${uploadBtn.dataset.niUpload}"]`);
                if (inp) inp.click();
                return;
            }
            const browseBtn = e.target.closest('[data-ni-browse]');
            if (browseBtn) { _niOpenPicker(browseBtn.dataset.itemId, browseBtn.dataset.niBrowse); return; }
            const playBtn = e.target.closest('[data-ni-play]');
            if (playBtn && typeof SoundManager !== 'undefined') {
                SoundManager.previewToggle(_niAssetUrl(playBtn.dataset.niPlay, playBtn.dataset.updated), { button: playBtn });
                return;
            }
            const clearBtn = e.target.closest('[data-ni-clear]');
            if (clearBtn) { _niClearAsset(clearBtn.dataset.itemId, clearBtn.dataset.niClear); return; }
            const editBtn = e.target.closest('[data-ni-edit]');
            if (editBtn) { _niOpenEditModal(editBtn.dataset.niEdit); return; }
        });
        tbody.addEventListener('change', e => {
            const inp = e.target.closest('.ni-file-input');
            if (inp) _niUploadAsset(inp);
        });
    }
    document.addEventListener('click', e => {
        if (!e.target.closest('.table-asset-menu-anchor')) _niCloseAssetMenu();
    });
});

// Reload the navbar for the group that owns itemId so icon/label changes
// are visible immediately without a full page refresh.
function _niReloadNavConfig(itemId) {
    const item = _navItems.find(i => i.item_id === itemId);
    if (!item) return;
    const cfgMap = {
        probes:    typeof ProbesMenuConfig    !== 'undefined' ? ProbesMenuConfig    : null,
        synthesis: typeof SynthesisMenuConfig !== 'undefined' ? SynthesisMenuConfig : null,
        settings:  typeof SettingsMenuConfig  !== 'undefined' ? SettingsMenuConfig  : null,
    };
    const navCfg = cfgMap[item.menu_group];
    if (navCfg) navCfg.loadNavItemsFromDB();
}

