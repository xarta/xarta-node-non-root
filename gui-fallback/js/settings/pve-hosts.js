/* ── PVE Hosts ─────────────────────────────────────────────────────────── */
const _LS_PVE_HOSTS    = 'bp_pve_hosts';
const _LS_PVE_HOSTS_TS = 'bp_pve_hosts_ts';
const _PVE_HOSTS_TTL   = 3_600_000; // 1 hour

const _PVE_HOST_COLS = ['ip_address', 'name', 'tailnet_ip', 'version', 'port', 'ssh', 'last_scanned', '_actions'];
const _PVE_HOST_FIELD_META = {
  ip_address:   { label: 'IP', render: h => `<td><code>${esc(h.ip_address || '—')}</code></td>` },
  name:         { label: 'Name', render: h => `<td>${esc(h.pve_name || h.hostname || h.pve_id || '—')}</td>` },
  tailnet_ip:   { label: 'Tailnet IP', render: h => `<td><code>${esc(h.tailnet_ip || '—')}</code></td>` },
  version:      { label: 'Version', render: h => `<td>${esc(h.version || '—')}</td>` },
  port:         { label: 'Port', render: h => `<td>${h.port || 8006}</td>` },
  ssh:          { label: 'SSH', render: h => `<td>${h.ssh_reachable ? '✅' : '—'}</td>` },
  last_scanned: { label: 'Last Scanned', render: h => `<td style="white-space:nowrap;color:var(--text-dim)">${esc(((h.last_scanned || '—').replace('T', ' ').slice(0, 19)))}</td>` },
  _actions:     { label: 'Actions', render: h => _pveRenderActionsCell(h) },
};

let _pveHostsTablePrefs = null;
let _pveHiddenCols = new Set();
let _pveColResizeDone = false;

function _ensurePveHostsTablePrefs() {
  if (_pveHostsTablePrefs || typeof TablePrefs === 'undefined') return _pveHostsTablePrefs;
  _pveHostsTablePrefs = TablePrefs.create({
    storageKey: 'pve-hosts-table-prefs',
    defaultHidden: [],
    minWidth: 40,
  });
  _pveHostsTablePrefs.syncColumns(_PVE_HOST_COLS);
  _pveHiddenCols = _pveHostsTablePrefs.getHiddenSet(_PVE_HOST_COLS);
  return _pveHostsTablePrefs;
}

function _pveCompactRowActions() {
  return typeof TableRowActions !== 'undefined' && TableRowActions.isCompact();
}

function _pveActionCellWidth() {
  return _pveCompactRowActions() ? 48 : 90;
}

function _pveVisibleCols() {
  return _PVE_HOST_COLS.filter(col => !_pveHiddenCols.has(col));
}

function _pveActionButtons(h) {
  return `<button class="secondary" style="padding:2px 8px;font-size:11px" data-pve-edit="${h.pve_id}">Edit</button>
    <button class="secondary" style="padding:2px 8px;font-size:11px;color:#f87171" data-pve-del="${h.pve_id}">Del</button>`;
}

function _pveRenderActionsCell(h) {
  if (_pveCompactRowActions()) {
    return `<td class="table-action-cell table-action-cell--compact" style="width:${_pveActionCellWidth()}px">
      <button class="table-row-action-trigger secondary" type="button" title="PVE host actions" onclick="_pveOpenRowActions('${esc(h.pve_id)}')">&#8942;</button>
    </td>`;
  }
  return `<td class="table-action-cell" style="white-space:nowrap;width:${_pveActionCellWidth()}px"><div class="table-inline-actions">${_pveActionButtons(h)}</div></td>`;
}

function _pveRebuildThead() {
  const table = document.getElementById('pve-hosts-table');
  if (!table) return;
  const tr = table.querySelector('thead tr');
  if (!tr) return;
  const prefs = _ensurePveHostsTablePrefs();
  tr.innerHTML = _pveVisibleCols().map(col => {
    const width = prefs ? prefs.getWidth(col) : null;
    const styleParts = [];
    if (width) styleParts.push(`width:${width}px`);
    else if (col === '_actions') styleParts.push(`width:${_pveActionCellWidth()}px`);
    const style = styleParts.length ? ` style="${styleParts.join(';')}"` : '';
    return `<th data-col="${col}"${style}>${_PVE_HOST_FIELD_META[col].label}</th>`;
  }).join('');
  _pveColResizeDone = false;
}

function _pveInitColResize() {
  if (_pveColResizeDone) return;
  const table = document.getElementById('pve-hosts-table');
  const prefs = _ensurePveHostsTablePrefs();
  if (!table || !prefs) return;
  _pveColResizeDone = true;
  prefs.applyWidths(table);
  prefs.bindColumnResize(table, { minWidth: 40 });
}

function _pveOpenColsModal() {
  const prefs = _ensurePveHostsTablePrefs();
  if (!prefs) return;
  const list = document.getElementById('pve-hosts-cols-modal-list');
  TablePrefs.renderColumnChooser(list, _PVE_HOST_COLS, _pveHiddenCols, col => _PVE_HOST_FIELD_META[col].label);
  HubModal.open(document.getElementById('pve-hosts-cols-modal'));
}

function _pveApplyColsModal() {
  const prefs = _ensurePveHostsTablePrefs();
  if (!prefs) return;
  const modal = document.getElementById('pve-hosts-cols-modal');
  const newHidden = TablePrefs.readHiddenFromChooser(modal, new Set(_pveHiddenCols));
  prefs.setHiddenSet(newHidden);
  _pveHiddenCols = prefs.getHiddenSet(_PVE_HOST_COLS);
  _pveRebuildThead();
  renderPveHosts();
  HubModal.close(modal);
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
  _ensurePveHostsTablePrefs();
  _pveRebuildThead();
  if (!_pveHosts.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${Math.max(1, _pveVisibleCols().length)}">No PVE hosts found — run the scan first.</td></tr>`;
    return;
  }
  tbody.innerHTML = _pveHosts.map(h => `<tr>${_pveVisibleCols().map(col => _PVE_HOST_FIELD_META[col].render(h)).join('')}</tr>`).join('');
  _pveInitColResize();
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
  _ensurePveHostsTablePrefs();
  if (typeof ResponsiveLayout !== 'undefined') {
    ResponsiveLayout.registerTabControls('pve-hosts', 'pg-ctrl-pve-hosts');
  }

  _pveHostsTablePrefs?.onLayoutChange(() => {
    _pveHiddenCols = _pveHostsTablePrefs.getHiddenSet(_PVE_HOST_COLS);
    _pveRebuildThead();
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
  document.getElementById('pve-hosts-cols-btn')?.addEventListener('click', _pveOpenColsModal);
  document.getElementById('pve-hosts-cols-modal-apply')?.addEventListener('click', _pveApplyColsModal);
});
