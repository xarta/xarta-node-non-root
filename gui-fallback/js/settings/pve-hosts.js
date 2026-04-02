/* ── PVE Hosts ─────────────────────────────────────────────────────────── */
const _LS_PVE_HOSTS    = 'bp_pve_hosts';
const _LS_PVE_HOSTS_TS = 'bp_pve_hosts_ts';
const _PVE_HOSTS_TTL   = 3_600_000; // 1 hour

const _PVE_HOST_COLS = ['ip_address', 'name', 'tailnet_ip', 'version', 'port', 'ssh', 'last_scanned', '_actions'];
const _PVE_HOST_FIELD_META = {
  ip_address:   { label: 'IP', sortKey: 'ip_address', render: h => `<td><code>${esc(h.ip_address || '—')}</code></td>` },
  name:         { label: 'Name', sortKey: 'name', render: h => `<td>${esc(h.pve_name || h.hostname || h.pve_id || '—')}</td>` },
  tailnet_ip:   { label: 'Tailnet IP', sortKey: 'tailnet_ip', render: h => `<td><code>${esc(h.tailnet_ip || '—')}</code></td>` },
  version:      { label: 'Version', sortKey: 'version', render: h => `<td>${esc(h.version || '—')}</td>` },
  port:         { label: 'Port', sortKey: 'port', render: h => `<td>${h.port || 8006}</td>` },
  ssh:          { label: 'SSH', sortKey: 'ssh', render: h => `<td>${h.ssh_reachable ? '✅' : '—'}</td>` },
  last_scanned: { label: 'Last Scanned', sortKey: 'last_scanned', render: h => `<td style="white-space:nowrap;color:var(--text-dim)">${esc(((h.last_scanned || '—').replace('T', ' ').slice(0, 19)))}</td>` },
  _actions:     { label: 'Actions', render: h => _pveRenderActionsCell(h) },
};

let _pveHostsTableView = null;
const _PVE_ACTION_INLINE_WIDTH = 90;
const _PVE_ACTION_COMPACT_WIDTH = 48;

function _pveDefaultWidth(col) {
  if (!_pveHostsTableView) return col === '_actions' ? _PVE_ACTION_INLINE_WIDTH : null;
  return col === '_actions' ? _pveActionCellWidth() : null;
}

function _pveColumnType(col) {
  const types = {
    ip_address: 'TEXT',
    name: 'TEXT',
    tailnet_ip: 'TEXT',
    version: 'TEXT',
    port: 'INTEGER',
    ssh: 'INTEGER',
    last_scanned: 'TEXT',
  };
  return types[col] || null;
}

function _ensurePveHostsTableView() {
  if (_pveHostsTableView || typeof TableView === 'undefined') return _pveHostsTableView;
  _pveHostsTableView = TableView.create({
    storageKey: 'pve-hosts-table-prefs',
    columns: _PVE_HOST_COLS,
    meta: _PVE_HOST_FIELD_META,
    getTable: () => document.getElementById('pve-hosts-table'),
    getDefaultWidth: col => _pveDefaultWidth(col),
    minWidth: 40,
    sort: {
      storageKey: 'pve-hosts-table-sort',
    },
    onSortChange: () => {
      renderPveHosts();
      _ensurePveHostsLayoutController()?.scheduleLayoutSave();
    },
    onColumnResizeEnd: () => {
      _ensurePveHostsLayoutController()?.scheduleLayoutSave();
    },
  });
  return _pveHostsTableView;
}

function _pveCompactRowActions() {
  if (!_pveHostsTableView || typeof TableRowActions === 'undefined') return false;
  return TableRowActions.shouldCollapse({
    view: _pveHostsTableView,
    getTable: () => document.getElementById('pve-hosts-table'),
    columnKey: '_actions',
    requiredWidth: _PVE_ACTION_INLINE_WIDTH,
    defaultWidth: _PVE_ACTION_INLINE_WIDTH,
  });
}

function _pveActionCellWidth() {
  return _pveCompactRowActions() ? _PVE_ACTION_COMPACT_WIDTH : _PVE_ACTION_INLINE_WIDTH;
}

let _pveHostsLayoutController = null;

function _pveHostsColumnSeed(col) {
  const lengths = { ip_address: 15, name: 32, tailnet_ip: 15, version: 12, port: 4, ssh: 3, last_scanned: 19 };
  return {
    sqlite_column: col === 'name' ? 'pve_name' : col.startsWith('_') ? null : col,
    data_type: _pveColumnType(col),
    sample_max_length: lengths[col] || null,
    min_width_px: col === '_actions' ? _PVE_ACTION_COMPACT_WIDTH : 40,
    max_width_px: col === '_actions' ? _PVE_ACTION_INLINE_WIDTH : 900,
    width_px: _ensurePveHostsTableView()?.prefs?.getWidth(col) || _pveDefaultWidth(col),
  };
}

function _ensurePveHostsLayoutController() {
  if (_pveHostsLayoutController || typeof TableBucketLayouts === 'undefined') return _pveHostsLayoutController;
  _pveHostsLayoutController = TableBucketLayouts.create({
    getTable: () => document.getElementById('pve-hosts-table'),
    getView: () => _ensurePveHostsTableView(),
    getColumns: () => _PVE_HOST_COLS,
    getMeta: col => _PVE_HOST_FIELD_META[col],
    getDefaultWidth: col => _pveDefaultWidth(col),
    getColumnSeed: col => _pveHostsColumnSeed(col),
    render: () => renderPveHosts(),
    surfaceLabel: 'PVE Hosts',
    layoutContextTitle: 'PVE Hosts Layout Context',
  });
  return _pveHostsLayoutController;
}

async function togglePveHostsHorizontalScroll() {
  const controller = _ensurePveHostsLayoutController();
  if (!controller) return;
  await controller.toggleHorizontalScroll();
}

async function openPveHostsLayoutContextModal() {
  const controller = _ensurePveHostsLayoutController();
  if (!controller) return;
  await controller.openLayoutContextModal();
}

function _pveSortValue(host, sortKey) {
  switch (sortKey) {
    case 'ip_address':
      return host.ip_address || '';
    case 'name':
      return host.pve_name || host.hostname || host.pve_id || '';
    case 'tailnet_ip':
      return host.tailnet_ip || '';
    case 'version':
      return host.version || '';
    case 'port':
      return host.port == null ? 8006 : Number(host.port);
    case 'ssh':
      return host.ssh_reachable ? 1 : 0;
    case 'last_scanned':
      return host.last_scanned || '';
    default:
      return '';
  }
}

function _pveActionButtons(h) {
  return `<button class="secondary table-icon-btn table-icon-btn--edit" type="button" title="Edit PVE host" aria-label="Edit PVE host" data-pve-edit="${h.pve_id}"></button>
    <button class="secondary table-icon-btn table-icon-btn--delete" type="button" title="Delete PVE host" aria-label="Delete PVE host" data-pve-del="${h.pve_id}"></button>`;
}

function _pveRenderActionsCell(h) {
  if (_pveCompactRowActions()) {
    return `<td class="table-action-cell table-action-cell--compact" style="width:${_pveActionCellWidth()}px">
      <button class="table-row-action-trigger secondary" type="button" title="PVE host actions" onclick="_pveOpenRowActions('${esc(h.pve_id)}')">&#8942;</button>
    </td>`;
  }
  return `<td class="table-action-cell" style="white-space:nowrap"><div class="table-inline-actions">${_pveActionButtons(h)}</div></td>`;
}

function _pveOpenColsModal() {
  const view = _ensurePveHostsTableView();
  if (!view) return;
  view.openColumns(
    document.getElementById('pve-hosts-cols-modal-list'),
    document.getElementById('pve-hosts-cols-modal'),
    col => _PVE_HOST_FIELD_META[col].label
  );
}

function _pveApplyColsModal() {
  const view = _ensurePveHostsTableView();
  if (!view) return;
  const modal = document.getElementById('pve-hosts-cols-modal');
  view.applyColumns(modal, () => {
    renderPveHosts();
    HubModal.close(modal);
    _ensurePveHostsLayoutController()?.scheduleLayoutSave();
  });
}

function _savePveHostsCache(hosts) {
  try {
    localStorage.setItem(_LS_PVE_HOSTS, JSON.stringify(hosts));
    localStorage.setItem(_LS_PVE_HOSTS_TS, String(Date.now()));
  } catch (_) {}
}

async function loadPveHosts() {
  const err = document.getElementById('pve-hosts-error');
  err.hidden = true;
  try {
    const r = await apiFetch('/api/v1/pve-hosts');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _pveHosts = await r.json();
    _savePveHostsCache(_pveHosts);
    renderPveHosts();
  } catch (e) {
    err.textContent = `Failed to load PVE hosts: ${e.message}`;
    err.hidden = false;
  }
}

function renderPveHosts() {
  const tbody = document.getElementById('pve-hosts-tbody');
  const view = _ensurePveHostsTableView();
  const visibleCols = view?.getVisibleCols() || ['ip_address'];
  if (!_pveHosts.length) {
    view?.render(() => {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${Math.max(1, visibleCols.length)}">No PVE hosts found — run the scan first.</td></tr>`;
    });
    return;
  }
  const rows = view?.sorter ? view.sorter.sortRows(_pveHosts, _pveSortValue) : _pveHosts;
  view?.render(() => {
    const cols = view.getVisibleCols();
    tbody.innerHTML = rows.map(h => `<tr>${cols.map(col => _PVE_HOST_FIELD_META[col].render(h)).join('')}</tr>`).join('');
  });
}

function _pveOpenRowActions(pveId) {
  if (typeof TableRowActions === 'undefined') return;
  const host = _pveHosts.find(h => String(h.pve_id) === String(pveId));
  if (!host) return;
  TableRowActions.open({
    title: host.pve_name || host.hostname || host.pve_id || 'PVE host actions',
    subtitle: host.ip_address || '',
    actions: [
      {
        label: 'Edit host',
        detail: 'Update the display name or tailnet IP',
        onClick: () => _openPveHostEditModal(pveId),
      },
      {
        label: 'Delete host',
        detail: 'Remove this PVE host record from Blueprints',
        tone: 'danger',
        onClick: () => pveHostDelete(pveId),
      },
    ],
  });
}

async function pveHostDelete(pveId, btn) {
  const ok = await HubDialogs.confirmDelete({
    title: 'Delete PVE host?',
    message: `Delete PVE host ${pveId}?`,
    detail: 'This removes the host record from Blueprints only.',
  });
  if (!ok) return;
  if (btn) btn.disabled = true;
  try {
    const r = await apiFetch(`/api/v1/pve-hosts/${encodeURIComponent(pveId)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _pveHosts = _pveHosts.filter(h => h.pve_id !== pveId);
    _savePveHostsCache(_pveHosts);
    renderPveHosts();
  } catch (e) {
    if (btn) btn.disabled = false;
    await HubDialogs.alertError({
      title: 'Delete failed',
      message: `Failed to delete PVE host: ${e.message}`,
    });
  }
}

let _pveEditingId = null;

function _openPveHostEditModal(pveId) {
  const host = _pveHosts.find(h => h.pve_id === pveId);
  if (!host) return;
  _pveEditingId = pveId;
  document.getElementById('pve-host-edit-name').value    = host.pve_name    || '';
  document.getElementById('pve-host-edit-tailnet').value = host.tailnet_ip  || '';
  document.getElementById('pve-host-edit-error').textContent = '';
  document.getElementById('pve-host-edit-save-btn').disabled = false;
  HubModal.open(document.getElementById('pve-host-edit-modal'));
  document.getElementById('pve-host-edit-name').focus();
}

async function _submitPveHostEdit() {
  const pveId = _pveEditingId;
  if (!pveId) return;
  const errorEl  = document.getElementById('pve-host-edit-error');
  const saveBtn   = document.getElementById('pve-host-edit-save-btn');
  const newName    = document.getElementById('pve-host-edit-name').value.trim();
  const newTailnet = document.getElementById('pve-host-edit-tailnet').value.trim();
  errorEl.textContent = '';
  saveBtn.disabled = true;
  try {
    const r = await apiFetch(`/api/v1/pve-hosts/${encodeURIComponent(pveId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pve_name: newName || null, tailnet_ip: newTailnet || null }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const updated = await r.json();
    const idx = _pveHosts.findIndex(h => h.pve_id === pveId);
    if (idx !== -1) _pveHosts[idx] = updated;
    _savePveHostsCache(_pveHosts);
    renderPveHosts();
    HubModal.close(document.getElementById('pve-host-edit-modal'));
  } catch (e) {
    errorEl.textContent = `Save failed: ${e.message}`;
    saveBtn.disabled = false;
  }
}

async function scanPveHosts() {
  const btn    = document.getElementById('pve-scan-btn');
  const status = document.getElementById('pve-scan-status');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Scanning…'; }
  status.hidden = true;
  try {
    const r = await apiFetch('/api/v1/pve-hosts/scan', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
    const tailnetNote = (d.tailnet_resolved != null)
      ? (d.tailnet_resolved > 0
        ? `, tailnet: ${d.tailnet_resolved}/${d.found} resolved`
        : ` — tailnet IPs not resolved (use Edit to set manually)`)
      : '';
    status.textContent = `✓ Scanned ${d.ips_checked} IPs — found: ${d.found} (created: ${d.created}, updated: ${d.updated})${tailnetNote}`;
    status.style.color = 'var(--accent)';
    status.hidden = false;
    _pveHosts = [];
    await loadPveHosts();
  } catch (e) {
    status.textContent = `✗ Scan failed: ${e.message}`;
    status.style.color = '#f87171';
    status.hidden = false;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '▶ Scan for Proxmox'; }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  _ensurePveHostsTableView();

  _pveHostsTableView?.onLayoutChange(() => {
    renderPveHosts();
  });

  // Table event delegation — Edit and Del buttons
  document.getElementById('pve-hosts-tbody')?.addEventListener('click', e => {
    const editBtn = e.target.closest('[data-pve-edit]');
    const delBtn  = e.target.closest('[data-pve-del]');
    if (editBtn) _openPveHostEditModal(editBtn.dataset.pveEdit);
    if (delBtn)  pveHostDelete(delBtn.dataset.pveDel, delBtn);
  });

  // Edit modal Save button
  document.getElementById('pve-host-edit-save-btn')?.addEventListener('click', _submitPveHostEdit);
  document.getElementById('pve-hosts-cols-modal-apply')?.addEventListener('click', _pveApplyColsModal);
});
