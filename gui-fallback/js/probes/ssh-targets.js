/* ── SSH Targets ───────────────────────────────────────────────────────── */
const _SSH_TARGET_COLS = ['ip_address', 'host_name', 'host_type', 'key_env_var', 'source_ip', 'notes', 'updated_at', '_actions'];
const _SSH_TARGET_FIELD_META = {
  ip_address: { label: 'IP Address', sortKey: 'ip_address' },
  host_name: { label: 'Host Name', sortKey: 'host_name' },
  host_type: { label: 'Type', sortKey: 'host_type' },
  key_env_var: { label: 'Key Env Var', sortKey: 'key_env_var' },
  source_ip: { label: 'Source IP', sortKey: 'source_ip' },
  notes: { label: 'Notes', sortKey: 'notes' },
  updated_at: { label: 'Updated', sortKey: 'updated_at' },
  _actions: { label: 'Actions' },
};

let _sshTargetsTableView = null;

function _ensureSshTargetsTableView() {
  if (_sshTargetsTableView || typeof TableView === 'undefined') return _sshTargetsTableView;
  _sshTargetsTableView = TableView.create({
    storageKey: 'ssh-targets-table-prefs',
    columns: _SSH_TARGET_COLS,
    meta: _SSH_TARGET_FIELD_META,
    getTable: () => document.getElementById('ssh-targets-table'),
    fallbackColumn: 'ip_address',
    minWidth: 40,
    getDefaultWidth: col => col === '_actions' ? 46 : null,
    sort: {
      storageKey: 'ssh-targets-table-sort',
      defaultKey: 'ip_address',
      defaultDir: 1,
    },
    onSortChange: () => {
      renderSshTargets();
      _ensureSshTargetsLayoutController()?.scheduleLayoutSave();
    },
    onColumnResizeEnd: () => {
      _ensureSshTargetsLayoutController()?.scheduleLayoutSave();
    },
  });
  return _sshTargetsTableView;
}

let _sshTargetsLayoutController = null;

function _sshTargetsColumnSeed(col) {
  const types = {
    ip_address: 'TEXT', host_name: 'TEXT', host_type: 'TEXT', key_env_var: 'TEXT',
    source_ip: 'TEXT', notes: 'TEXT', updated_at: 'TEXT',
  };
  const lengths = {
    ip_address: 15, host_name: 32, host_type: 16, key_env_var: 28,
    source_ip: 15, notes: 60, updated_at: 19,
  };
  return {
    sqlite_column: col.startsWith('_') ? null : col,
    data_type: types[col] || null,
    sample_max_length: lengths[col] || null,
    min_width_px: col === '_actions' ? 40 : 40,
    max_width_px: col === '_actions' ? 46 : 900,
    width_px: _ensureSshTargetsTableView()?.prefs?.getWidth(col) || (col === '_actions' ? 46 : null),
  };
}

function _ensureSshTargetsLayoutController() {
  if (_sshTargetsLayoutController || typeof TableBucketLayouts === 'undefined') return _sshTargetsLayoutController;
  _sshTargetsLayoutController = TableBucketLayouts.create({
    getTable: () => document.getElementById('ssh-targets-table'),
    getView: () => _ensureSshTargetsTableView(),
    getColumns: () => _SSH_TARGET_COLS,
    getMeta: col => _SSH_TARGET_FIELD_META[col],
    getDefaultWidth: col => col === '_actions' ? 46 : null,
    getColumnSeed: col => _sshTargetsColumnSeed(col),
    render: () => renderSshTargets(),
    surfaceLabel: 'SSH Targets',
    layoutContextTitle: 'SSH Targets Layout Context',
  });
  return _sshTargetsLayoutController;
}

async function toggleSshTargetsHorizontalScroll() {
  const controller = _ensureSshTargetsLayoutController();
  if (!controller) return;
  await controller.toggleHorizontalScroll();
}

async function openSshTargetsLayoutContextModal() {
  const controller = _ensureSshTargetsLayoutController();
  if (!controller) return;
  await controller.openLayoutContextModal();
}

function _sshTargetsVisibleCols() {
  return _ensureSshTargetsTableView()?.getVisibleCols() || ['ip_address'];
}

function _sshTargetSortValue(entry, sortKey) {
  switch (sortKey) {
    case 'ip_address': return entry.ip_address || '';
    case 'host_name': return entry.host_name || '';
    case 'host_type': return entry.host_type || '';
    case 'key_env_var': return entry.key_env_var || '';
    case 'source_ip': return entry.source_ip || '';
    case 'notes': return entry.notes || '';
    case 'updated_at': return entry.updated_at || '';
    default: return '';
  }
}

function _sshTargetTypeHtml(entry) {
  const typeColours = {
    'lxc-fleet': '#1d4ed8', 'lxc': '#0f766e', 'qemu': '#7c3aed',
    'citadel': '#b91c1c', 'pve': '#92400e', 'pfsense': '#15803d'
  };
  const colour = typeColours[entry.host_type] || '#555';
  return `<span class="tag" style="background:${colour};color:#fff">${esc(entry.host_type || '?')}</span>`;
}

function _sshTargetActionCell(entry) {
  return `<td class="table-action-cell" style="width:46px"><div class="table-inline-actions"><button class="secondary table-icon-btn table-icon-btn--delete" type="button" title="Delete SSH target ${esc(entry.ip_address || '')}" aria-label="Delete SSH target ${esc(entry.ip_address || '')}" data-ssh-del="${esc(entry.ip_address || '')}"></button></div></td>`;
}

function _sshTargetCell(entry, col) {
  switch (col) {
    case 'ip_address':
      return `<td><code>${esc(entry.ip_address || '')}</code></td>`;
    case 'host_name':
      return `<td>${esc(entry.host_name || '—')}</td>`;
    case 'host_type':
      return `<td>${_sshTargetTypeHtml(entry)}</td>`;
    case 'key_env_var':
      return `<td><code style="font-size:11px">${esc(entry.key_env_var || '')}</code></td>`;
    case 'source_ip':
      return `<td><code>${esc(entry.source_ip || '—')}</code></td>`;
    case 'notes':
      return `<td class="table-cell-clip" style="font-size:11px;color:var(--text-dim)">${esc(entry.notes || '—')}</td>`;
    case 'updated_at':
      return `<td style="font-size:11px">${esc((entry.updated_at || '').slice(0,16).replace('T',' '))}</td>`;
    case '_actions':
      return _sshTargetActionCell(entry);
    default:
      return '<td></td>';
  }
}

function openSshTargetsColsModal() {
  const view = _ensureSshTargetsTableView();
  if (!view) return;
  view.openColumns(
    document.getElementById('ssh-targets-cols-modal-list'),
    document.getElementById('ssh-targets-cols-modal'),
    col => _SSH_TARGET_FIELD_META[col].label
  );
}

function _applySshTargetsColsModal() {
  const view = _ensureSshTargetsTableView();
  if (!view) return;
  view.applyColumns(document.getElementById('ssh-targets-cols-modal'), () => {
    renderSshTargets();
    HubModal.close(document.getElementById('ssh-targets-cols-modal'));
    _ensureSshTargetsLayoutController()?.scheduleLayoutSave();
  });
}

async function loadSshTargets() {
  const err = document.getElementById('ssh-targets-error');
  if (err) err.hidden = true;
  try {
    const r = await apiFetch('/api/v1/ssh-targets');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _sshTargets = await r.json();
    renderSshTargets();
  } catch (e) {
    if (err) { err.textContent = `Failed to load SSH Targets: ${e.message}`; err.hidden = false; }
  }
}

function renderSshTargets() {
  const tbody = document.getElementById('ssh-targets-tbody');
  if (!tbody) return;
  const view = _ensureSshTargetsTableView();
  const visibleCols = _sshTargetsVisibleCols();
  if (!_sshTargets.length) {
    view?.render(() => {
      tbody.innerHTML = `<tr><td colspan="${Math.max(1, visibleCols.length)}" style="color:var(--text-dim);text-align:center">No entries — click Rebuild to populate from config</td></tr>`;
    });
    return;
  }
  const rows = view?.sorter ? view.sorter.sortRows(_sshTargets, _sshTargetSortValue) : _sshTargets.slice();
  view?.render(() => {
    tbody.innerHTML = rows.map(entry => `<tr>${visibleCols.map(col => _sshTargetCell(entry, col)).join('')}</tr>`).join('');
  });
}

async function rebuildSshTargets() {
  const btn = document.getElementById('ssh-targets-rebuild-btn');
  const status = document.getElementById('ssh-targets-status');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Rebuilding…'; }
  try {
    const r = await apiFetch('/api/v1/ssh-targets/rebuild', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
    status.textContent = `✓ ${d.message}`;
    _sshTargets = [];
    await loadSshTargets();
  } catch (e) {
    status.textContent = `✗ Rebuild failed: ${e.message}`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↺ Rebuild from config'; }
  }
}

async function deleteSshTarget(ip) {
  const ok = await HubDialogs.confirmDelete({
    title: 'Delete SSH target?',
    message: `Remove SSH target for ${ip}?`,
    detail: 'This deletes the Blueprints SSH target record from the table.',
  });
  if (!ok) return;
  try {
    const r = await apiFetch(`/api/v1/ssh-targets/${encodeURIComponent(ip)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
    _sshTargets = _sshTargets.filter(e => e.ip_address !== ip);
    renderSshTargets();
  } catch (e) {
    await HubDialogs.alertError({
      title: 'Delete failed',
      message: `Failed to delete SSH target: ${e.message}`,
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  _ensureSshTargetsTableView();
  document.getElementById('ssh-targets-cols-modal-apply')?.addEventListener('click', _applySshTargetsColsModal);
  document.getElementById('ssh-targets-tbody')?.addEventListener('click', e => {
    const delBtn = e.target.closest('[data-ssh-del]');
    if (!delBtn) return;
    deleteSshTarget(delBtn.dataset.sshDel);
  });
  _sshTargetsTableView?.onLayoutChange(() => {
    renderSshTargets();
  });
});
