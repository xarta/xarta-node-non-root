const _ARP_MANUAL_COLS = ['ip_address', 'mac_address', 'notes', 'updated_at', '_actions'];
const _ARP_MANUAL_FIELD_META = {
  ip_address: { label: 'IP Address', sortKey: 'ip_address', render: entry => `<td><code>${esc(entry.ip_address || '—')}</code></td>` },
  mac_address: { label: 'MAC Address', sortKey: 'mac_address', render: entry => `<td><code>${esc(entry.mac_address || '—')}</code></td>` },
  notes: { label: 'Notes', sortKey: 'notes', render: entry => `<td>${esc(entry.notes || '')}</td>` },
  updated_at: { label: 'Updated', sortKey: 'updated_at', render: entry => `<td style="color:var(--text-dim);font-size:11px">${esc((entry.updated_at || '').slice(0,16).replace('T',' '))}</td>` },
  _actions: { label: 'Actions', render: entry => _renderArpManualActionsCell(entry) },
};

const _ARP_ACTION_INLINE_WIDTH = 90;
const _ARP_ACTION_COMPACT_WIDTH = 48;
const _ARP_LAYOUT_USER_CODE = '00';
const _ARP_LAYOUT_RESERVED_CODE = '00';
const _ARP_LAYOUT_SAVE_DELAY_MS = 300;

let _arpManualEditId = null;
let _arpManualTableView = null;
let _arpManualLayoutKey = '';
let _arpManualLayoutAppliedSignature = '';
let _arpManualLayoutSaveTimer = null;
let _arpManualApplyingRemoteLayout = false;
let _arpManualLayoutRequestSeq = 0;

function _arpManualTableEl() {
  return document.getElementById('arp-manual-table');
}

function _arpManualViewportBits() {
  const width = window.innerWidth || document.documentElement.clientWidth || 0;
  const portrait = window.matchMedia('(orientation: portrait)').matches;
  return {
    shade_up: !!document.body?.classList.contains('shade-is-up'),
    horizontal_scroll: !!_arpManualTableView?.isHorizontalScrollEnabled(),
    mobile: width <= 600,
    portrait,
    wide: !portrait && width >= 1600,
  };
}

function _arpManualTableCode() {
  return _arpManualTableEl()?.dataset.layoutTableCode || '0E';
}

function _arpManualTableName() {
  return _arpManualTableEl()?.dataset.layoutTableName || 'arp-manual';
}

function _arpManualColumnType(col) {
  switch (col) {
    case 'ip_address': return 'TEXT';
    case 'mac_address': return 'TEXT';
    case 'notes': return 'TEXT';
    case 'updated_at': return 'TEXT';
    default: return null;
  }
}

function _arpManualDefaultWidth(col) {
  if (!_arpManualTableView) return col === '_actions' ? _ARP_ACTION_INLINE_WIDTH : null;
  return col === '_actions' ? _arpActionCellWidth(_arpCompactRowActions()) : null;
}

function _arpManualColumnSeeds() {
  return _ARP_MANUAL_COLS.map((col, index) => {
    const meta = _ARP_MANUAL_FIELD_META[col] || { label: col };
    const width = _arpManualTableView?.prefs?.getWidth(col) || _arpManualDefaultWidth(col);
    return {
      column_key: col,
      display_name: meta.label || col,
      sqlite_column: col.startsWith('_') ? null : col,
      width_px: width || undefined,
      min_width_px: col === '_actions' ? _ARP_ACTION_COMPACT_WIDTH : 40,
      max_width_px: col === 'notes' ? 1200 : (col === '_actions' ? _ARP_ACTION_INLINE_WIDTH : 900),
      position: index,
      sort_direction: null,
      sort_priority: null,
      hidden: false,
      data_type: _arpManualColumnType(col),
      sample_max_length: col === 'notes' ? 48 : (col === 'ip_address' ? 15 : (col === 'mac_address' ? 17 : 16)),
    };
  });
}

function _arpManualBuildLayoutPayload() {
  const view = _ensureArpManualTableView();
  const hidden = view.getHiddenSet();
  const sortState = view.getSortState();
  const columns = _ARP_MANUAL_COLS.map((col, index) => {
    const meta = _ARP_MANUAL_FIELD_META[col] || { label: col };
    const isActiveSort = !!(meta.sortKey && sortState.key === meta.sortKey);
    return {
      column_key: col,
      display_name: meta.label || col,
      sqlite_column: col.startsWith('_') ? null : col,
      width_px: view.prefs.getWidth(col) || _arpManualDefaultWidth(col),
      min_width_px: col === '_actions' ? _ARP_ACTION_COMPACT_WIDTH : 40,
      max_width_px: col === 'notes' ? 1200 : (col === '_actions' ? _ARP_ACTION_INLINE_WIDTH : 900),
      position: index,
      sort_direction: isActiveSort ? (sortState.dir === -1 ? 'desc' : 'asc') : null,
      sort_priority: isActiveSort ? 0 : null,
      hidden: hidden.has(col),
      data_type: _arpManualColumnType(col),
      sample_max_length: col === 'notes' ? 48 : (col === 'ip_address' ? 15 : (col === 'mac_address' ? 17 : 16)),
    };
  });
  return {
    version: 1,
    seed_origin: 'manual',
    algorithm_version: 'v1',
    bucket_flags: _arpManualViewportBits(),
    columns,
  };
}

function _arpManualApplyRemoteLayout(layout) {
  const view = _ensureArpManualTableView();
  if (!view || !layout || !Array.isArray(layout.columns)) return;
  const hidden = new Set();
  let sortKey = null;
  let sortDir = 1;
  _arpManualApplyingRemoteLayout = true;
  try {
    layout.columns.forEach(col => {
      if (!col || !col.column_key) return;
      if (col.hidden) hidden.add(col.column_key);
      if (col.width_px && view.prefs?.setWidth) {
        view.prefs.setWidth(col.column_key, col.width_px);
      }
      if (col.sort_direction) {
        const meta = _ARP_MANUAL_FIELD_META[col.column_key] || null;
        sortKey = meta?.sortKey || col.column_key;
        sortDir = col.sort_direction === 'desc' ? -1 : 1;
      }
    });
    view.prefs.setHiddenSet(hidden);
    view.setSortState(sortKey, sortDir);
  } finally {
    _arpManualApplyingRemoteLayout = false;
  }
}

function _arpManualLayoutSignature(layoutData) {
  try {
    return JSON.stringify(layoutData || {});
  } catch (_) {
    return '';
  }
}

async function _arpManualResolveRemoteLayout(options = {}) {
  const view = _ensureArpManualTableView();
  if (!view) return null;
  const reqId = ++_arpManualLayoutRequestSeq;
  try {
    const response = await apiFetch('/api/v1/table-layouts/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reserved_code: _ARP_LAYOUT_RESERVED_CODE,
        user_code: _ARP_LAYOUT_USER_CODE,
        table_code: _arpManualTableCode(),
        table_name: _arpManualTableName(),
        bucket_bits: _arpManualViewportBits(),
        columns: _arpManualColumnSeeds(),
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (reqId !== _arpManualLayoutRequestSeq) return null;
    _arpManualLayoutKey = payload.layout_key || '';
    const nextSig = _arpManualLayoutSignature(payload.layout_data);
    if (nextSig && nextSig !== _arpManualLayoutAppliedSignature) {
      _arpManualApplyRemoteLayout(payload.layout_data);
      _arpManualLayoutAppliedSignature = nextSig;
      if (options.rerender !== false) renderArpManual();
    }
    return payload;
  } catch (error) {
    console.warn('Manual ARP table layout resolve failed:', error);
    return null;
  }
}

function _arpManualScheduleLayoutSave() {
  if (_arpManualApplyingRemoteLayout) return;
  clearTimeout(_arpManualLayoutSaveTimer);
  _arpManualLayoutSaveTimer = setTimeout(() => {
    _arpManualPersistLayout().catch(error => {
      console.warn('Manual ARP table layout save failed:', error);
    });
  }, _ARP_LAYOUT_SAVE_DELAY_MS);
}

async function _arpManualPersistLayout() {
  const view = _ensureArpManualTableView();
  if (!view) return;
  if (!_arpManualLayoutKey) {
    const resolved = await _arpManualResolveRemoteLayout({ rerender: false });
    if (!resolved?.layout_key) return;
  }
  const layoutData = _arpManualBuildLayoutPayload();
  const nextSig = _arpManualLayoutSignature(layoutData);
  if (nextSig === _arpManualLayoutAppliedSignature) return;
  const response = await apiFetch(`/api/v1/table-layouts/${encodeURIComponent(_arpManualLayoutKey)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layout_data: layoutData }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  _arpManualLayoutKey = payload.layout_key || _arpManualLayoutKey;
  _arpManualLayoutAppliedSignature = _arpManualLayoutSignature(payload.layout_data);
}

async function toggleArpManualHorizontalScroll() {
  const view = _ensureArpManualTableView();
  if (!view) return;
  view.toggleHorizontalScroll();
  await _arpManualResolveRemoteLayout({ rerender: true });
}

async function openArpManualLayoutContextModal() {
  if (typeof TableLayoutInspector === 'undefined') return;
  if (!_arpManualLayoutKey) {
    await _arpManualResolveRemoteLayout({ rerender: false });
  }
  try {
    const loadEntries = async () => {
      const query = new URLSearchParams({
        table_code: _arpManualTableCode(),
        user_code: _ARP_LAYOUT_USER_CODE,
      });
      const response = await apiFetch(`/api/v1/table-layouts?${query.toString()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = await response.json();
      return {
        activeKey: _arpManualLayoutKey,
        subtitle: `${rows.length} saved bucket${rows.length === 1 ? '' : 's'} for ${_arpManualTableName()}`,
        entries: rows.map(row => ({
          layoutKey: row.layout_key,
          reservedCode: row.reserved_code,
          userCode: row.user_code,
          tableCode: row.table_code,
          bucketCode: row.bucket_code,
          layoutData: row.layout_data || {},
          title: `Bucket ${row.bucket_code}`,
          subtitle: row.layout_key,
          hint: row.layout_key === _arpManualLayoutKey ? 'Active layout for the current Manual ARP viewport' : 'Saved sibling layout for another Manual ARP context',
        })),
      };
    };
    const initialState = await loadEntries();
    TableLayoutInspector.open({
      title: 'Manual ARP Layout Context',
      subtitle: initialState.subtitle,
      activeKey: initialState.activeKey,
      reloadEntries: loadEntries,
      onGenerate: async bucketFlags => {
        const response = await apiFetch('/api/v1/table-layouts/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reserved_code: _ARP_LAYOUT_RESERVED_CODE,
            user_code: _ARP_LAYOUT_USER_CODE,
            table_code: _arpManualTableCode(),
            table_name: _arpManualTableName(),
            bucket_bits: bucketFlags,
            columns: _arpManualColumnSeeds(),
          }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await response.json();
      },
      onDelete: async entry => {
        const confirmed = await HubDialogs.confirmDelete({
          title: 'Delete layout bucket?',
          message: `Delete Manual ARP layout bucket ${entry.bucketCode}?`,
          detail: 'This removes the saved layout row so it can be regenerated later if needed.',
        });
        if (!confirmed) return false;
        const response = await apiFetch(`/api/v1/table-layouts/${encodeURIComponent(entry.layoutKey)}`, {
          method: 'DELETE',
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      },
      onSaveColumns: async (entry, nextLayoutData) => {
        const saveResponse = await apiFetch(`/api/v1/table-layouts/${encodeURIComponent(entry.layoutKey)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ layout_data: nextLayoutData }),
        });
        if (!saveResponse.ok) throw new Error(`HTTP ${saveResponse.status}`);
        const payload = await saveResponse.json();
        const savedLayout = payload.layout_data || nextLayoutData;
        if (payload.layout_key === _arpManualLayoutKey) {
          _arpManualApplyRemoteLayout(savedLayout);
          _arpManualLayoutAppliedSignature = _arpManualLayoutSignature(savedLayout);
          renderArpManual();
        }
        return { layoutData: savedLayout };
      },
      entries: initialState.entries,
    });
  } catch (error) {
    await HubDialogs.alertError({
      title: 'Layout context unavailable',
      message: `Failed to load Manual ARP layout context: ${error.message}`,
    });
  }
}

function _ensureArpManualTableView() {
  if (_arpManualTableView || typeof TableView === 'undefined') return _arpManualTableView;
  _arpManualTableView = TableView.create({
    storageKey: 'arp-manual-table-prefs',
    columns: _ARP_MANUAL_COLS,
    meta: _ARP_MANUAL_FIELD_META,
    getTable: () => document.getElementById('arp-manual-table'),
    getDefaultWidth: col => (col === '_actions' ? _arpActionCellWidth(_arpCompactRowActions()) : null),
    minWidth: 40,
    sort: {
      storageKey: 'arp-manual-table-sort',
    },
    onSortChange: () => {
      renderArpManual();
      _arpManualScheduleLayoutSave();
    },
    onColumnResizeEnd: () => {
      _arpManualScheduleLayoutSave();
    },
  });
  return _arpManualTableView;
}

function _arpCompactRowActions() {
  if (!_arpManualTableView || typeof TableRowActions === 'undefined') return false;
  return TableRowActions.shouldCollapse({
    view: _arpManualTableView,
    getTable: () => document.getElementById('arp-manual-table'),
    columnKey: '_actions',
    requiredWidth: _ARP_ACTION_INLINE_WIDTH,
    defaultWidth: _ARP_ACTION_INLINE_WIDTH,
  });
}

function _arpActionCellWidth(isCompact) {
  return isCompact ? _ARP_ACTION_COMPACT_WIDTH : _ARP_ACTION_INLINE_WIDTH;
}

function _arpManualById(entryId) {
  return _arpManual.find(entry => entry.entry_id === entryId) || null;
}

function _arpManualSortValue(entry, sortKey) {
  switch (sortKey) {
    case 'ip_address':
      return entry.ip_address || '';
    case 'mac_address':
      return entry.mac_address || '';
    case 'notes':
      return entry.notes || '';
    case 'updated_at':
      return entry.updated_at || '';
    default:
      return '';
  }
}

function _renderArpManualActionButtons(entry) {
  return `<button class="secondary table-icon-btn table-icon-btn--edit" type="button" title="Edit manual ARP entry" aria-label="Edit manual ARP entry" data-arp-edit="${entry.entry_id}"></button>
    <button class="secondary table-icon-btn table-icon-btn--delete" type="button" title="Delete manual ARP entry" aria-label="Delete manual ARP entry" data-arp-del="${entry.entry_id}"></button>`;
}

function _renderArpManualActionsCell(entry) {
  const compact = _arpCompactRowActions();
  if (compact) {
    return `<td class="table-action-cell table-action-cell--compact" style="width:${_arpActionCellWidth(true)}px">
      <button class="table-row-action-trigger secondary" type="button" title="Manual ARP actions" aria-label="Manual ARP actions" data-arp-actions="${entry.entry_id}">&#8942;</button>
    </td>`;
  }
  return `<td class="table-action-cell" style="white-space:nowrap"><div class="table-inline-actions">${_renderArpManualActionButtons(entry)}</div></td>`;
}

function _openArpManualRowActions(entryId) {
  if (typeof TableRowActions === 'undefined') return;
  const entry = _arpManualById(entryId);
  if (!entry) return;
  TableRowActions.open({
    title: entry.ip_address || 'Manual ARP actions',
    subtitle: entry.mac_address || '',
    actions: [
      {
        label: 'Edit entry',
        detail: 'Update the IP, MAC address, or notes',
        onClick: () => _openArpManualEditModal(entryId),
      },
      {
        label: 'Delete entry',
        detail: 'Remove this manual ARP mapping from Blueprints',
        tone: 'danger',
        onClick: () => deleteArpManualEntry(entryId),
      },
    ],
  });
}

function _openArpManualColsModal() {
  const view = _ensureArpManualTableView();
  if (!view) return;
  view.openColumns(
    document.getElementById('arp-manual-cols-modal-list'),
    document.getElementById('arp-manual-cols-modal')
  );
}

function _applyArpManualColsModal() {
  const view = _ensureArpManualTableView();
  if (!view) return;
  const modal = document.getElementById('arp-manual-cols-modal');
  view.applyColumns(modal, () => {
    renderArpManual();
    HubModal.close(modal);
    _arpManualScheduleLayoutSave();
  });
}

async function loadArpManual() {
  const err = document.getElementById('arp-manual-error');
  if (err) err.hidden = true;
  try {
    const r = await apiFetch('/api/v1/arp-manual');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _arpManual = await r.json();
    renderArpManual();
  } catch (e) {
    if (err) { err.textContent = `Failed to load Manual ARP: ${e.message}`; err.hidden = false; }
  }
}

function renderArpManual() {
  const tbody = document.getElementById('arp-manual-tbody');
  if (!tbody) return;
  const view = _ensureArpManualTableView();
  const visibleCols = view ? view.getVisibleCols() : _ARP_MANUAL_COLS;
  if (!_arpManual.length) {
    view?.render(() => {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${Math.max(1, visibleCols.length)}">No entries yet — click "+ Add entry" to add one.</td></tr>`;
    });
    return;
  }
  const rows = view?.sorter ? view.sorter.sortRows(_arpManual, _arpManualSortValue) : _arpManual;
  view?.render(() => {
    tbody.innerHTML = rows.map(entry => `<tr>${visibleCols.map(col => _ARP_MANUAL_FIELD_META[col].render(entry)).join('')}</tr>`).join('');
  });
}

function addArpManualEntry() {
  _openArpManualEditModal(null);
}

function _openArpManualEditModal(entry_id) {
  const modal = document.getElementById('arp-manual-edit-modal');
  if (!modal) return;
  _arpManualEditId = entry_id;
  const entry = entry_id ? _arpManual.find(e => e.entry_id === entry_id) : null;
  const badge = document.getElementById('arp-manual-edit-badge');
  if (badge) badge.textContent = entry ? 'EDIT' : 'ADD';
  document.getElementById('arp-manual-edit-title').textContent = entry ? 'Edit entry' : 'Add entry';
  document.getElementById('arp-manual-edit-ip').value    = entry ? (entry.ip_address  || '') : '';
  document.getElementById('arp-manual-edit-mac').value   = entry ? (entry.mac_address || '') : '';
  document.getElementById('arp-manual-edit-notes').value = entry ? (entry.notes       || '') : '';
  document.getElementById('arp-manual-edit-error').textContent = '';
  const saveBtn = document.getElementById('arp-manual-edit-save-btn');
  if (saveBtn) saveBtn.disabled = false;
  HubModal.open(modal);
  setTimeout(() => document.getElementById('arp-manual-edit-ip').focus(), 50);
}

async function _submitArpManualEdit() {
  const modal   = document.getElementById('arp-manual-edit-modal');
  const errEl   = document.getElementById('arp-manual-edit-error');
  const saveBtn = document.getElementById('arp-manual-edit-save-btn');
  const ip    = document.getElementById('arp-manual-edit-ip').value.trim();
  const mac   = document.getElementById('arp-manual-edit-mac').value.trim();
  const notes = document.getElementById('arp-manual-edit-notes').value.trim();
  errEl.textContent = '';
  if (!ip)  { errEl.textContent = 'IP Address is required.'; return; }
  if (!mac) { errEl.textContent = 'MAC Address is required.'; return; }
  if (saveBtn) saveBtn.disabled = true;
  try {
    const isEdit = !!_arpManualEditId;
    const url    = isEdit ? `/api/v1/arp-manual/${encodeURIComponent(_arpManualEditId)}` : '/api/v1/arp-manual';
    const r = await apiFetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ ip_address: ip, mac_address: mac, notes: notes || null }),
    });
    if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
    HubModal.close(modal);
    _arpManual = [];
    await loadArpManual();
  } catch (e) {
    errEl.textContent = `Failed to ${_arpManualEditId ? 'update' : 'add'} entry: ${e.message}`;
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function deleteArpManualEntry(entry_id) {
  const entry = _arpManual.find(e => e.entry_id === entry_id);
  const ip = entry ? entry.ip_address : entry_id;
  const ok = await HubDialogs.confirmDelete({
    title: 'Delete manual ARP entry?',
    message: `Delete manual ARP entry for ${ip}?`,
    detail: 'This removes the manual entry from Blueprints only.',
  });
  if (!ok) return;
  try {
    const r = await apiFetch(`/api/v1/arp-manual/${encodeURIComponent(entry_id)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
    _arpManual = _arpManual.filter(e => e.entry_id !== entry_id);
    renderArpManual();
  } catch (e) {
    await HubDialogs.alertError({
      title: 'Delete failed',
      message: `Failed to delete entry: ${e.message}`,
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  _ensureArpManualTableView();
  _arpManualTableView?.onLayoutChange(() => {
    _arpManualResolveRemoteLayout({ rerender: true });
  });
  _arpManualResolveRemoteLayout({ rerender: false });

  const saveBtn = document.getElementById('arp-manual-edit-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', _submitArpManualEdit);

  const colsApplyBtn = document.getElementById('arp-manual-cols-modal-apply');
  if (colsApplyBtn) colsApplyBtn.addEventListener('click', _applyArpManualColsModal);

  const tbody = document.getElementById('arp-manual-tbody');
  if (tbody) {
    tbody.addEventListener('click', e => {
      const editBtn = e.target.closest('[data-arp-edit]');
      if (editBtn) { _openArpManualEditModal(editBtn.dataset.arpEdit); return; }
      const delBtn = e.target.closest('[data-arp-del]');
      if (delBtn) { deleteArpManualEntry(delBtn.dataset.arpDel); return; }
      const actionsBtn = e.target.closest('[data-arp-actions]');
      if (actionsBtn) { _openArpManualRowActions(actionsBtn.dataset.arpActions); }
    });
  }
});
