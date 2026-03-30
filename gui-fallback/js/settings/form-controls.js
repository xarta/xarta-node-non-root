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

let _fcItems = [];
let _editingFcControlId = null;
let _deletingFcControlId = null;
let _fcPickerAssets = [];
let _fcDiscoveredKeys = [];

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

function _fcDeleteModalEls() {
    return {
        dialog: document.getElementById('fc-delete-modal'),
        message: document.getElementById('fc-delete-modal-message'),
        error: document.getElementById('fc-delete-modal-error'),
        cancelBtn: document.getElementById('fc-delete-modal-cancel'),
        confirmBtn: document.getElementById('fc-delete-modal-confirm'),
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

function renderFormControls() {
    const container = document.getElementById('fc-container');
    if (!container) return;
    container.innerHTML = '';

    if (!_fcItems.length) {
        const empty = document.createElement('p');
        empty.style.cssText = 'font-size:13px;color:var(--text-dim);padding:12px 0;margin:0';
        empty.textContent = 'No form controls registered yet. Use the Settings context menu to add the first key.';
        container.appendChild(empty);
        return;
    }

    const table = document.createElement('table');
    table.className = 'data-table fc-table';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Icon</th>
                <th>Control Key</th>
                <th>Label</th>
                <th>Type</th>
                <th>Context</th>
                <th>Icon Asset</th>
                <th>Sound (On / Off)</th>
                <th>Notes</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody id="fc-tbody"></tbody>
    `;
    // Wrap in table-wrap to constrain horizontal overflow — prevents the wide
    // table from spilling past the viewport width (which caused browser zoom on
    // narrow/rotated mobile viewports).
    const tableWrap = document.createElement('div');
    tableWrap.className = 'table-wrap';
    tableWrap.appendChild(table);
    container.appendChild(tableWrap);

    const tbody = table.querySelector('#fc-tbody');
    const sorted = [..._fcItems].sort((a, b) =>
        (a.label || a.control_key).localeCompare(b.label || b.control_key)
    );
    for (const item of sorted) {
        tbody.appendChild(_fcRowEl(item));
    }
}

// ── Icon resolution ───────────────────────────────────────────────────────────

function _resolvedIconHtml(item) {
    if (item.icon_asset) {
        return `<img class="fc-icon-preview menu-icon"
            src="${_esc(_fcAssetUrl(item.icon_asset, item.updated_at))}"
            alt="" data-fallback="1">`;
    }
    return `<span class="fc-icon-placeholder" title="No icon assigned">—</span>`;
}

// ── Row builder ───────────────────────────────────────────────────────────────

function _fcRowEl(item) {
    const tr = document.createElement('tr');
    tr.dataset.controlId = item.control_id;

    const typeLabel = item.control_type || '';

    tr.innerHTML = `
        <td class="fc-col-icon">${_resolvedIconHtml(item)}</td>
        <td class="fc-col-key"><code>${_esc(item.control_key)}</code></td>
        <td class="fc-col-label"><span class="fc-field" data-field="label">${_esc(item.label)}</span></td>
        <td class="fc-col-type"><span class="fc-field" data-field="control_type">${_esc(typeLabel)}</span></td>
        <td class="fc-col-context"><span class="fc-field" data-field="context">${_esc(item.context || '')}</span></td>
        <td class="fc-col-icon-asset">
            <span class="fc-field fc-asset-path" data-field="icon_asset">${_esc(item.icon_asset || '')}</span>
            <div class="fc-asset-actions">
                <label class="btn-small secondary fc-upload-label" title="Upload new icon">
                    ⬆ <input type="file" class="fc-file-input"
                        data-control-id="${item.control_id}" data-asset-type="icons"
                        accept=".svg,.png,.ico,.jpg,.jpeg,.webp" style="display:none">
                </label>
                <button class="btn-small secondary fc-browse-btn"
                    data-control-id="${item.control_id}" data-asset-type="icons"
                    title="Choose from existing icons">📋</button>
                ${item.icon_asset
                    ? `<button class="btn-small secondary fc-clear-asset"
                           data-control-id="${item.control_id}" data-field="icon_asset"
                           title="Clear icon">✕</button>`
                    : ''}
            </div>
        </td>
        <td class="fc-col-sound-asset">
            <div class="fc-sound-slot">
                <small style="color:var(--text-dim);font-size:10px">On:</small>
                <span class="fc-field fc-asset-path" data-field="sound_asset">${_esc(item.sound_asset || '')}</span>
                <div class="fc-asset-actions">
                    <label class="btn-small secondary fc-upload-label" title="Upload on-sound">
                        ⬆ <input type="file" class="fc-file-input"
                            data-control-id="${item.control_id}" data-asset-type="sounds"
                            accept=".wav,.mp3,.ogg,.flac,.webm,.m4a" style="display:none">
                    </label>
                    <button class="btn-small secondary fc-browse-btn"
                        data-control-id="${item.control_id}" data-asset-type="sounds"
                        title="Choose on-sound">📋</button>
                    ${item.sound_asset
                        ? `<button class="btn-small secondary fc-sound-play"
                               data-sound-path="${_esc(item.sound_asset)}"
                               data-updated="${_esc(item.updated_at || '')}"
                               title="Preview on-sound">▶</button>`
                        : ''}
                    ${item.sound_asset
                        ? `<button class="btn-small secondary fc-clear-asset"
                               data-control-id="${item.control_id}" data-field="sound_asset"
                               title="Clear on-sound">✕</button>`
                        : ''}
                </div>
            </div>
            <div class="fc-sound-slot" style="margin-top:4px">
                <small style="color:var(--text-dim);font-size:10px">Off:</small>
                <span class="fc-field fc-asset-path" data-field="sound_asset_off">${_esc(item.sound_asset_off || '')}</span>
                <div class="fc-asset-actions">
                    <label class="btn-small secondary fc-upload-label" title="Upload off-sound">
                        ⬆ <input type="file" class="fc-file-input"
                            data-control-id="${item.control_id}" data-asset-type="sounds_off"
                            accept=".wav,.mp3,.ogg,.flac,.webm,.m4a" style="display:none">
                    </label>
                    <button class="btn-small secondary fc-browse-btn"
                        data-control-id="${item.control_id}" data-asset-type="sounds_off"
                        title="Choose off-sound">📋</button>
                    ${item.sound_asset_off
                        ? `<button class="btn-small secondary fc-sound-play"
                               data-sound-path="${_esc(item.sound_asset_off)}"
                               data-updated="${_esc(item.updated_at || '')}"
                               title="Preview off-sound">▶</button>`
                        : ''}
                    ${item.sound_asset_off
                        ? `<button class="btn-small secondary fc-clear-asset"
                               data-control-id="${item.control_id}" data-field="sound_asset_off"
                               title="Clear off-sound">✕</button>`
                        : ''}
                </div>
            </div>
        </td>
        <td class="fc-col-notes"><span class="fc-field" data-field="notes">${_esc(item.notes || '')}</span></td>
        <td class="fc-col-actions">
            <button class="btn-small secondary fc-edit-btn"
                data-control-id="${item.control_id}" title="Edit">✏️</button>
            <button class="btn-small secondary fc-delete-btn"
                data-control-id="${item.control_id}" title="Delete">🗑</button>
        </td>
    `;

    // File upload inputs
    tr.querySelectorAll('.fc-file-input').forEach(inp => {
        inp.addEventListener('change', () => _fcUploadAsset(inp));
    });

    // Browse existing assets
    tr.querySelectorAll('.fc-browse-btn').forEach(btn => {
        btn.addEventListener('click', () => _fcOpenPicker(btn.dataset.controlId, btn.dataset.assetType));
    });

    // Sound preview
    tr.querySelectorAll('.fc-sound-play').forEach(btn => {
        btn.addEventListener('click', () => {
            const path = btn.dataset.soundPath;
            if (path && typeof SoundManager !== 'undefined') {
                SoundManager.previewToggle(_fcAssetUrl(path, btn.dataset.updated), { button: btn });
            }
        });
    });

    // Clear asset buttons
    tr.querySelectorAll('.fc-clear-asset').forEach(btn => {
        btn.addEventListener('click', () => _fcClearAsset(btn.dataset.controlId, btn.dataset.field));
    });

    // Edit button
    tr.querySelectorAll('.fc-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => _fcOpenEditModal(btn.dataset.controlId));
    });

    // Delete button
    tr.querySelectorAll('.fc-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => _fcOpenDeleteModal(btn.dataset.controlId));
    });

    // Icon img error fallback
    tr.querySelectorAll('.fc-icon-preview').forEach(img => {
        img.addEventListener('error', function () {
            if (!this.dataset.usedFallback) {
                this.dataset.usedFallback = '1';
                this.src = '/fallback-ui/assets/icons/fallback.svg';
            }
        });
    });

    return tr;
}

// ── Add new control ───────────────────────────────────────────────────────────

async function _fcAddNew() {
    const modal = _fcEditModalEls();
    _editingFcControlId = null;
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
    const modal = _fcDeleteModalEls();
    _deletingFcControlId = controlId;
    modal.message.textContent = `Delete form control "${item.label}" (key: ${item.control_key})?`;
    _fcSetModalMessage(modal.error, '');
    modal.cancelBtn.hidden = false;
    modal.confirmBtn.disabled = false;
    modal.confirmBtn.textContent = 'Delete';
    HubModal.open(modal.dialog, {
        onClose: () => _fcSetModalMessage(modal.error, ''),
    });
}

async function _fcDeleteRow() {
    const controlId = _deletingFcControlId;
    const item = _fcItems.find(i => i.control_id === controlId);
    if (!item) return;

    const modal = _fcDeleteModalEls();
    const statusEl = document.getElementById('fc-status');
    try {
        modal.cancelBtn.disabled = true;
        modal.confirmBtn.disabled = true;
        modal.confirmBtn.textContent = 'Deleting...';
        const resp = await apiFetch(`/api/v1/form-controls/${controlId}`, { method: 'DELETE' });
        if (!resp.ok && resp.status !== 204) {
            const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
            throw new Error(err.detail || `HTTP ${resp.status}`);
        }
        _fcItems = _fcItems.filter(i => i.control_id !== controlId);
        HubModal.close(modal.dialog);
        renderFormControls();
        if (typeof FormControlManager !== 'undefined') FormControlManager.reload();
        if (statusEl) { statusEl.textContent = `✓ Deleted "${item.label}"`; statusEl.style.color = 'var(--ok,#3fb950)'; }
    } catch (e) {
        _fcSetModalMessage(modal.error, `Delete failed: ${e.message}`);
        modal.cancelBtn.disabled = false;
        modal.confirmBtn.disabled = false;
        modal.confirmBtn.textContent = 'Delete';
        if (statusEl) { statusEl.textContent = `✗ ${e.message}`; statusEl.style.color = 'var(--danger,#f85149)'; }
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

(function initFormControlModalActions() {
    const editModal = _fcEditModalEls();
    const deleteModal = _fcDeleteModalEls();
    if (editModal.saveBtn && !editModal.saveBtn.dataset.fcWired) {
        editModal.saveBtn.dataset.fcWired = '1';
        editModal.saveBtn.addEventListener('click', () => { void _fcSubmitEditModal(); });
    }
    if (deleteModal.confirmBtn && !deleteModal.confirmBtn.dataset.fcDeleteWired) {
        deleteModal.confirmBtn.dataset.fcDeleteWired = '1';
        deleteModal.confirmBtn.addEventListener('click', () => { void _fcDeleteRow(); });
    }
    if (editModal.keyFilter && !editModal.keyFilter.dataset.fcKeysWired) {
        editModal.keyFilter.dataset.fcKeysWired = '1';
        editModal.keyFilter.addEventListener('input', _fcRenderDiscoveredKeyList);
    }
    if (editModal.keyRefreshBtn && !editModal.keyRefreshBtn.dataset.fcKeysWired) {
        editModal.keyRefreshBtn.dataset.fcKeysWired = '1';
        editModal.keyRefreshBtn.addEventListener('click', () => { void _fcLoadDiscoveredKeys(true); });
    }
})();
