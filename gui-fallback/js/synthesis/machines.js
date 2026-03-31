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
let _mchTablePrefs = null;
let _mchHiddenCols = new Set();
let _mchTableSort = null;

function _ensureMachinesTablePrefs() {
  if (_mchTablePrefs || typeof TablePrefs === 'undefined') return _mchTablePrefs;
  _mchTablePrefs = TablePrefs.create({
    storageKey: 'machines-table-prefs',
    defaultHidden: [],
    minWidth: 40,
  });
  _mchTablePrefs.syncColumns(_MCH_COLS);
  _mchHiddenCols = _mchTablePrefs.getHiddenSet(_MCH_COLS);
  return _mchTablePrefs;
}

function _mchVisibleCols() {
  return _MCH_COLS.filter(col => !_mchHiddenCols.has(col));
}

function _ensureMachinesTableSort() {
  if (_mchTableSort || typeof TableSort === 'undefined') return _mchTableSort;
  _mchTableSort = TableSort.create({
    storageKey: 'machines-table-sort',
  });
  return _mchTableSort;
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
  const table = document.getElementById('machines-table');
  if (!table) return;
  const tr = table.querySelector('thead tr');
  if (!tr) return;
  const prefs = _ensureMachinesTablePrefs();
  const sorter = _ensureMachinesTableSort();
  tr.innerHTML = _mchVisibleCols().map(col => {
    const meta = _MCH_FIELD_META[col];
    const width = prefs ? prefs.getWidth(col) : null;
    const styleParts = [];
    if (width) styleParts.push(`width:${width}px`);
    else if (meta.defaultWidth) styleParts.push(`width:${meta.defaultWidth}px`);
    const style = styleParts.length ? ` style="${styleParts.join(';')}"` : '';
    const sortAttrs = meta.sortKey ? ` data-sort-key="${meta.sortKey}"` : '';
    const classAttr = meta.sortKey ? ' class="table-th-sort"' : '';
    const labelHtml = sorter && meta.sortKey ? sorter.renderLabel(meta.label, meta.sortKey) : meta.label;
    return `<th data-col="${col}"${sortAttrs}${classAttr}${style}>${labelHtml}</th>`;
  }).join('');
}

function _mchRenderSharedTable(renderBody) {
  const prefs = _ensureMachinesTablePrefs();
  if (!prefs) {
    _mchRebuildThead();
    renderBody();
    return;
  }
  prefs.renderTable({
    getTable: () => document.getElementById('machines-table'),
    rebuildHead: _mchRebuildThead,
    renderBody,
    minWidth: 40,
    afterBind: tableEl => {
      const sorter = _ensureMachinesTableSort();
      sorter?.bind(tableEl, renderMachines);
      sorter?.syncIndicators(tableEl);
    },
  });
}

function mchOpenColsModal() {
  const prefs = _ensureMachinesTablePrefs();
  if (!prefs) return;
  const list = document.getElementById('mch-cols-modal-list');
  TablePrefs.renderColumnChooser(list, _MCH_COLS, _mchHiddenCols, col => _MCH_FIELD_META[col].label);
  HubModal.open(document.getElementById('mch-cols-modal'));
}

function _mchApplyColsModal() {
  const prefs = _ensureMachinesTablePrefs();
  if (!prefs) return;
  const modal = document.getElementById('mch-cols-modal');
  const newHidden = TablePrefs.readHiddenFromChooser(modal, new Set(_mchHiddenCols));
  prefs.setHiddenSet(newHidden);
  _mchHiddenCols = prefs.getHiddenSet(_MCH_COLS);
  _mchRebuildThead();
  renderMachines();
  HubModal.close(modal);
}

document.addEventListener('DOMContentLoaded', () => {
  _ensureMachinesTablePrefs();
  const mchSearch = document.getElementById('machine-search');
  if (mchSearch) {
    mchSearch.addEventListener('input', () => {
      clearTimeout(_mchFilterTimer);
      _mchFilterTimer = setTimeout(renderMachines, 250);
    });
  }
  document.getElementById('mch-cols-modal-apply')?.addEventListener('click', _mchApplyColsModal);
  _mchTablePrefs?.onLayoutChange(() => {
    _mchHiddenCols = _mchTablePrefs.getHiddenSet(_MCH_COLS);
    _mchRebuildThead();
    renderMachines();
  });
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
  _ensureMachinesTablePrefs();
  const sorter = _ensureMachinesTableSort();
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
  visible = sorter ? sorter.sortRows(visible, _mchSortValue) : visible;
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
