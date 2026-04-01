/* ── Machines ─────────────────────────────────────────────────────────── */
const _MCH_COLS = ['machine_id', 'name', 'type', 'machine_kind', 'platform', 'parent_machine_id', 'status', 'ip_addresses'];
const _MCH_FIELD_META = {
  machine_id: {
    label: 'ID',
    sortKey: 'machine_id',
    defaultWidth: 150,
    render: m => `<td><code style="font-size:12px;color:var(--text-dim)">${esc(m.machine_id || '')}</code></td>`,
  },
  name: {
    label: 'Name',
    sortKey: 'name',
    defaultWidth: 220,
    render: m => `<td><strong>${esc(m.name || '')}</strong></td>`,
  },
  type: {
    label: 'Type',
    sortKey: 'type',
    defaultWidth: 100,
    render: m => `<td>${esc(m.type || '')}</td>`,
  },
  machine_kind: {
    label: 'Kind',
    sortKey: 'machine_kind',
    defaultWidth: 110,
    render: m => {
      const kind = (m.machine_kind || '').toLowerCase();
      const kindCls = ['proxmox', 'lxc', 'vm', 'docker'].includes(kind) ? `kind-${kind}` : 'kind-default';
      return `<td><span class="kind-badge ${kindCls}">${esc(m.machine_kind || '—')}</span></td>`;
    },
  },
  platform: {
    label: 'Platform',
    sortKey: 'platform',
    defaultWidth: 120,
    render: m => `<td>${esc(m.platform || '')}</td>`,
  },
  parent_machine_id: {
    label: 'Parent',
    sortKey: 'parent_machine_id',
    defaultWidth: 150,
    render: m => `<td><code style="font-size:11px;color:var(--text-dim)">${esc(m.parent_machine_id || '—')}</code></td>`,
  },
  status: {
    label: 'Status',
    sortKey: 'status',
    defaultWidth: 100,
    render: m => {
      const statusCls = (m.status || '') === 'active'
        ? 'status-deployed'
        : (m.status || '') === 'stopped'
          ? 'status-planned'
          : '';
      return `<td><span class="${statusCls}">${esc(m.status || '')}</span></td>`;
    },
  },
  ip_addresses: {
    label: 'IPs',
    sortKey: 'ip_addresses',
    defaultWidth: 240,
    render: m => {
      const ips = (m.ip_addresses || []).map(ip => `<span class="ip-chip">${esc(ip)}</span>`).join(' ');
      return `<td>${ips || '<span style="color:var(--text-dim)">—</span>'}</td>`;
    },
  },
};

let _mchFilterTimer = null;
let _mchTableView = null;
let _mchLayoutController = null;

function _ensureMachinesTableView() {
  if (_mchTableView || typeof TableView === 'undefined') return _mchTableView;
  _mchTableView = TableView.create({
    storageKey: 'machines-table-prefs',
    columns: _MCH_COLS,
    meta: _MCH_FIELD_META,
    getTable: () => document.getElementById('machines-table'),
    getDefaultWidth: col => (_MCH_FIELD_META[col] || {}).defaultWidth || null,
    minWidth: 40,
    sort: {
      storageKey: 'machines-table-sort',
    },
    onSortChange: () => {
      renderMachines();
      _ensureMachinesLayoutController()?.scheduleLayoutSave();
    },
    onColumnResizeEnd: () => {
      _ensureMachinesLayoutController()?.scheduleLayoutSave();
    },
  });
  return _mchTableView;
}

function _mchVisibleCols() {
  const view = _ensureMachinesTableView();
  return view ? view.getVisibleCols() : _MCH_COLS;
}

function _mchColumnSeed(col) {
  switch (col) {
    case 'machine_id':
      return { sqlite_column: 'machine_id', data_type: 'TEXT', sample_max_length: 32, min_width_px: 100, max_width_px: 320 };
    case 'name':
      return { sqlite_column: 'name', data_type: 'TEXT', sample_max_length: 28, min_width_px: 140, max_width_px: 520 };
    case 'type':
      return { sqlite_column: 'type', data_type: 'TEXT', sample_max_length: 16, min_width_px: 96, max_width_px: 220 };
    case 'machine_kind':
      return { sqlite_column: 'machine_kind', data_type: 'TEXT', sample_max_length: 16, min_width_px: 100, max_width_px: 220 };
    case 'platform':
      return { sqlite_column: 'platform', data_type: 'TEXT', sample_max_length: 16, min_width_px: 100, max_width_px: 240 };
    case 'parent_machine_id':
      return { sqlite_column: 'parent_machine_id', data_type: 'TEXT', sample_max_length: 32, min_width_px: 120, max_width_px: 360 };
    case 'status':
      return { sqlite_column: 'status', data_type: 'TEXT', sample_max_length: 16, min_width_px: 96, max_width_px: 220 };
    case 'ip_addresses':
      return { sqlite_column: 'ip_addresses', data_type: 'TEXT', sample_max_length: 48, min_width_px: 140, max_width_px: 760 };
    default:
      return {};
  }
}

function _ensureMachinesLayoutController() {
  if (_mchLayoutController || typeof TableBucketLayouts === 'undefined') return _mchLayoutController;
  _mchLayoutController = TableBucketLayouts.create({
    getTable: () => document.getElementById('machines-table'),
    getView: () => _ensureMachinesTableView(),
    getColumns: () => _MCH_COLS,
    getMeta: col => _MCH_FIELD_META[col],
    getDefaultWidth: col => (_MCH_FIELD_META[col] || {}).defaultWidth || null,
    getColumnSeed: col => _mchColumnSeed(col),
    render: () => renderMachines(),
    surfaceLabel: 'Machines',
    layoutContextTitle: 'Machines Layout Context',
  });
  return _mchLayoutController;
}

function _mchSortValue(machine, sortKey) {
  switch (sortKey) {
    case 'machine_id':
      return machine.machine_id || '';
    case 'name':
      return machine.name || '';
    case 'type':
      return machine.type || '';
    case 'machine_kind':
      return machine.machine_kind || '';
    case 'platform':
      return machine.platform || '';
    case 'parent_machine_id':
      return machine.parent_machine_id || '';
    case 'status':
      return machine.status || '';
    case 'ip_addresses':
      return machine.ip_addresses || [];
    default:
      return '';
  }
}

function _mchRebuildThead() {
  const view = _ensureMachinesTableView();
  view?.rebuildHead();
}

function _mchRenderSharedTable(renderBody) {
  const view = _ensureMachinesTableView();
  if (!view) return;
  view.render(renderBody);
}

function mchOpenColsModal() {
  const view = _ensureMachinesTableView();
  if (!view) return;
  view.openColumns(
    document.getElementById('mch-cols-modal-list'),
    document.getElementById('mch-cols-modal')
  );
}

function _mchApplyColsModal() {
  const view = _ensureMachinesTableView();
  if (!view) return;
  const modal = document.getElementById('mch-cols-modal');
  view.applyColumns(modal, () => {
    renderMachines();
    HubModal.close(modal);
    _ensureMachinesLayoutController()?.scheduleLayoutSave();
  });
}

async function toggleMachinesHorizontalScroll() {
  const controller = _ensureMachinesLayoutController();
  if (!controller) return;
  await controller.toggleHorizontalScroll();
}

async function openMachinesLayoutContextModal() {
  const controller = _ensureMachinesLayoutController();
  if (!controller) return;
  await controller.openLayoutContextModal();
}

document.addEventListener('DOMContentLoaded', () => {
  _ensureMachinesTableView();
  _ensureMachinesLayoutController()?.init();
  const mchSearch = document.getElementById('machine-search');
  if (mchSearch) {
    mchSearch.addEventListener('input', () => {
      clearTimeout(_mchFilterTimer);
      _mchFilterTimer = setTimeout(renderMachines, 250);
    });
  }
  document.getElementById('mch-cols-modal-apply')?.addEventListener('click', _mchApplyColsModal);
  if (typeof ResponsiveLayout !== 'undefined') {
    ResponsiveLayout.registerTabControls('machines', 'pg-ctrl-machines');
  }
});
async function loadMachines() {
  const err = document.getElementById('machines-error');
  err.hidden = true;
  try {
    const r = await apiFetch('/api/v1/machines');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _machines = await r.json();
    renderMachines();
  } catch (e) {
    err.textContent = `Failed to load machines: ${e.message}`;
    err.hidden = false;
  }
}

function renderMachines() {
  const view = _ensureMachinesTableView();
  const q = (document.getElementById('machine-search').value || '').toLowerCase();
  const tbody = document.getElementById('machines-tbody');
  let visible = _machines.filter(m =>
    !q || (m.machine_id || '').toLowerCase().includes(q) ||
    (m.name || '').toLowerCase().includes(q) ||
    (m.type || '').toLowerCase().includes(q) ||
    (m.machine_kind || '').toLowerCase().includes(q) ||
    (m.description || '').toLowerCase().includes(q) ||
    JSON.stringify(m.ip_addresses || []).toLowerCase().includes(q)
  );
  visible = view?.sorter ? view.sorter.sortRows(visible, _mchSortValue) : visible;
  if (!visible.length) {
    _mchRenderSharedTable(() => {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${Math.max(1, _mchVisibleCols().length)}">${_machines.length ? 'No matching machines.' : 'No machines registered.'}</td></tr>`;
    });
    return;
  }
  _mchRenderSharedTable(() => {
    tbody.innerHTML = visible.map(m => `<tr>${_mchVisibleCols().map(col => _MCH_FIELD_META[col].render(m)).join('')}</tr>`).join('');
  });
}
