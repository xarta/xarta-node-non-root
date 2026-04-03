/* ── Dockge Stacks ──────────────────────────────────────────────────────── */

const _DOCKGE_COLS = ['services', 'pve_host', 'source_vmid', 'vm_type_badge', 'source_lxc_name', 'stack_name', 'status', 'env_file_exists', 'host_type', 'parent', 'obsolete', 'notes', 'last_probed'];
const _DOCKGE_FIELD_META = {
  services: { label: 'SVCS', sortKey: 'services' },
  pve_host: { label: 'PVE', sortKey: 'pve_host' },
  source_vmid: { label: 'VMID', sortKey: 'source_vmid' },
  vm_type_badge: { label: 'TYPE', sortKey: 'vm_type' },
  source_lxc_name: { label: 'LXC', sortKey: 'source_lxc_name' },
  stack_name: { label: 'Stack', sortKey: 'stack_name' },
  status: { label: 'Status', sortKey: 'status' },
  env_file_exists: { label: '.ENV', sortKey: 'env_file_exists' },
  host_type: { label: 'Host type', sortKey: 'host_type' },
  parent: { label: 'Parent', sortKey: 'parent' },
  obsolete: { label: 'Obs', sortKey: 'obsolete' },
  notes: { label: 'Notes', sortKey: 'notes' },
  last_probed: { label: 'Last Probed', sortKey: 'last_probed' },
};

let _dockgeTableView = null;
let _dockgeOpenServices = new Set();

document.addEventListener('DOMContentLoaded', () => {
  let _dockgeFilterTimer = null;
  const searchEl = document.getElementById('dockge-search');
  const toggleEl = document.getElementById('dockge-hide-obsolete');
  _ensureDockgeTableView();
  _ensureDockgeLayoutController()?.init();
  if (searchEl) searchEl.addEventListener('input', () => {
    clearTimeout(_dockgeFilterTimer);
    _dockgeFilterTimer = setTimeout(renderDockgeStacks, 250);
  });
  if (toggleEl) toggleEl.addEventListener('change', renderDockgeStacks);
  document.getElementById('dockge-cols-modal-apply')?.addEventListener('click', _applyDockgeColsModal);
  document.getElementById('dockge-tbody')?.addEventListener('click', e => {
    const svcToggle = e.target.closest('[data-dockge-svc-toggle]');
    if (svcToggle) {
      toggleDockgeServices(svcToggle.dataset.dockgeSvcToggle);
      return;
    }
    const obsToggle = e.target.closest('[data-dockge-obs]');
    if (obsToggle) {
      toggleDockgeObsolete(obsToggle.dataset.dockgeObs);
      return;
    }
  });
  document.getElementById('dockge-tbody')?.addEventListener('dblclick', e => {
    const noteEl = e.target.closest('[data-dockge-note]');
    if (!noteEl) return;
    editDockgeNote(noteEl.dataset.dockgeNote, noteEl);
  });
  _dockgeTableView?.onLayoutChange(() => {
    renderDockgeStacks();
  });
  if (typeof ResponsiveLayout !== 'undefined') {
    ResponsiveLayout.registerTabControls('dockge-stacks', 'pg-ctrl-dockge-stacks');
  }
});

function _ensureDockgeTableView() {
  if (_dockgeTableView || typeof TableView === 'undefined') return _dockgeTableView;
  _dockgeTableView = TableView.create({
    storageKey: 'dockge-table-prefs',
    columns: _DOCKGE_COLS,
    meta: _DOCKGE_FIELD_META,
    getTable: () => document.getElementById('dockge-table'),
    fallbackColumn: 'stack_name',
    minWidth: 40,
    sort: {
      storageKey: 'dockge-table-sort',
      defaultKey: 'stack_name',
      defaultDir: 1,
    },
    onSortChange: () => {
      renderDockgeStacks();
      _ensureDockgeLayoutController()?.scheduleLayoutSave();
    },
    onColumnResizeEnd: () => {
      _ensureDockgeLayoutController()?.scheduleLayoutSave();
    },
  });
  return _dockgeTableView;
}

let _dockgeLayoutController = null;

function _dockgeColumnSeed(col) {
  const types = {
    services: 'INTEGER', pve_host: 'TEXT', source_vmid: 'INTEGER', vm_type_badge: 'TEXT',
    source_lxc_name: 'TEXT', stack_name: 'TEXT', status: 'TEXT', env_file_exists: 'INTEGER',
    host_type: 'TEXT', parent: 'TEXT', obsolete: 'INTEGER', notes: 'TEXT', last_probed: 'TEXT',
  };
  const sqliteCol = { vm_type_badge: 'vm_type' };
  const lengths = {
    services: 4, pve_host: 16, source_vmid: 5, vm_type_badge: 8,
    source_lxc_name: 24, stack_name: 36, status: 12, env_file_exists: 4,
    host_type: 16, parent: 32, obsolete: 4, notes: 60, last_probed: 19,
  };
  return {
    sqlite_column: sqliteCol[col] !== undefined ? sqliteCol[col] : col,
    data_type: types[col] || null,
    sample_max_length: lengths[col] || null,
    min_width_px: 40,
    max_width_px: 900,
    width_px: _ensureDockgeTableView()?.prefs?.getWidth(col) || null,
  };
}

function _ensureDockgeLayoutController() {
  if (_dockgeLayoutController || typeof TableBucketLayouts === 'undefined') return _dockgeLayoutController;
  _dockgeLayoutController = TableBucketLayouts.create({
    getTable: () => document.getElementById('dockge-table'),
    getView: () => _ensureDockgeTableView(),
    getColumns: () => _DOCKGE_COLS,
    getMeta: col => _DOCKGE_FIELD_META[col],
    getDefaultWidth: () => null,
    getColumnSeed: col => _dockgeColumnSeed(col),
    render: () => renderDockgeStacks(),
    surfaceLabel: 'Dockge Stacks',
    layoutContextTitle: 'Dockge Stacks Layout Context',
  });
  return _dockgeLayoutController;
}

async function toggleDockgeHorizontalScroll() {
  const controller = _ensureDockgeLayoutController();
  if (!controller) return;
  await controller.toggleHorizontalScroll();
}

async function openDockgeLayoutContextModal() {
  const controller = _ensureDockgeLayoutController();
  if (!controller) return;
  await controller.openLayoutContextModal();
}

function _dockgeVisibleCols() {
  return _ensureDockgeTableView()?.getVisibleCols() || ['stack_name'];
}

function openDockgeColsModal() {
  const view = _ensureDockgeTableView();
  if (!view) return;
  view.openColumns(
    document.getElementById('dockge-cols-modal-list'),
    document.getElementById('dockge-cols-modal'),
    col => _DOCKGE_FIELD_META[col].label
  );
}

function _applyDockgeColsModal() {
  const view = _ensureDockgeTableView();
  if (!view) return;
  view.applyColumns(document.getElementById('dockge-cols-modal'), () => {
    renderDockgeStacks();
    HubModal.close(document.getElementById('dockge-cols-modal'));
    _ensureDockgeLayoutController()?.scheduleLayoutSave();
  });
}

async function loadDockgeStacks() {
  const err = document.getElementById('dockge-error');
  err.hidden = true;
  checkDockgeProbeStatus();
  try {
    const [stacksRes, svcsRes] = await Promise.all([
      apiFetch('/api/v1/dockge-stacks'),
      apiFetch('/api/v1/dockge-stacks/services'),
    ]);
    if (!stacksRes.ok) throw new Error(`HTTP ${stacksRes.status}`);
    _dockgeStacks = await stacksRes.json();
    _dockgeServicesMap = {};
    if (svcsRes.ok) {
      const svcs = await svcsRes.json();
      for (const s of svcs) {
        if (!_dockgeServicesMap[s.stack_id]) _dockgeServicesMap[s.stack_id] = [];
        _dockgeServicesMap[s.stack_id].push(s);
      }
    }
    const hasStacks = _dockgeStacks.length > 0;
    const expandAllBtn   = document.getElementById('dockge-expand-all-btn');
    const collapseAllBtn = document.getElementById('dockge-collapse-all-btn');
    if (expandAllBtn)   expandAllBtn.hidden   = !hasStacks;
    if (collapseAllBtn) collapseAllBtn.hidden = !hasStacks;
    renderDockgeStacks();
    // Async table data lands after initial menu paint on hard refresh.
    // Recompute fn-item visibility once real rows are available.
    if (typeof ProbesMenuConfig !== 'undefined') ProbesMenuConfig.updateActiveTab('dockge-stacks');
  } catch (e) {
    err.textContent = `Failed to load Dockge stacks: ${e.message}`;
    err.hidden = false;
  }
}

async function checkDockgeProbeStatus() {
  const btn    = document.getElementById('dockge-probe-btn');
  const status = document.getElementById('dockge-probe-status');
  try {
    const r = await apiFetch('/api/v1/dockge-stacks/probe/status');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (btn) btn.disabled = !d.configured;
    if (!d.configured) {
      if (btn) btn.title = d.reason;
      status.textContent = `⚠️ Probe unavailable: ${d.reason}`;
      status.style.color = 'var(--text-dim)';
      status.hidden = false;
    }
  } catch (e) {
    if (btn) btn.disabled = true;
  }
}

function toggleDockgeServices(safeid) {
  if (_dockgeOpenServices.has(safeid)) _dockgeOpenServices.delete(safeid);
  else _dockgeOpenServices.add(safeid);
  renderDockgeStacks();
  if (typeof ProbesMenuConfig !== 'undefined') ProbesMenuConfig.updateActiveTab('dockge-stacks');
}

function setAllDockgeServices(open) {
  const rows = _dockgeFilteredRows();
  if (open) {
    rows.forEach(row => {
      if ((_dockgeServicesMap[row.stack_id] || []).length > 0) {
        _dockgeOpenServices.add((row.stack_id || '').replace(/[^a-zA-Z0-9_-]/g,'_'));
      }
    });
  } else {
    _dockgeOpenServices.clear();
  }
  renderDockgeStacks();
  if (typeof ProbesMenuConfig !== 'undefined') ProbesMenuConfig.updateActiveTab('dockge-stacks');
}

function _parentBadge(ctx, stackName) {
  if (!ctx || ctx === 'unknown') return '<span style="color:var(--text-dim)">—</span>';
  const colours = {
    'dockge-stack':    '#92400e',
    'docker-compose':  '#1e3a5f',
    'docker-run':      '#374151',
    'portainer-stack': '#064e3b',
    'native':          '#3b0764',
  };
  const col   = colours[ctx] || '#374151';
  const label = stackName ? `${ctx}: ${stackName}` : ctx;
  return `<span class="tag" style="background:${col};color:#fff">${esc(label)}</span>`;
}

function _vmTypeBadge(vmType) {
  if (!vmType) return '';
  const col = vmType === 'lxc' ? '#1e3a8a' : vmType === 'qemu' ? '#4c1d95' : '#374151';
  return `<span class="tag" style="background:${col};color:#fff">${esc(vmType)}</span>`;
}

function renderDockgeStacks() {
  const rows = _dockgeFilteredRows();
  const tbody = document.getElementById('dockge-tbody');
  const view = _ensureDockgeTableView();
  const visibleCols = _dockgeVisibleCols();
  if (!rows.length) {
    view?.render(() => {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${Math.max(1, visibleCols.length)}">No Dockge stacks found.</td></tr>`;
    });
    return;
  }
  const sortedRows = view?.sorter ? view.sorter.sortRows(rows, (row, key) => _dockgeSortValue(row, key)) : rows.slice();
  view?.render(() => {
    tbody.innerHTML = sortedRows.map(d => {
    const probed      = (d.last_probed || '—').replace('T',' ').slice(0,19);
    const safeid      = (d.stack_id || '').replace(/[^a-zA-Z0-9_-]/g,'_');
    const svcs        = _dockgeServicesMap[d.stack_id] || [];
    const svcCount    = svcs.length;
    const envBadge    = d.env_file_exists ? '<span style="color:var(--ok)">✓</span>' : '<span style="color:var(--text-dim)">✗</span>';
    const typeBadge   = _vmTypeBadge(d.vm_type);
    const parentBadge = _parentBadge(d.parent_context, d.parent_stack_name);
    const statusCol   = d.status === 'running' ? 'var(--ok)'
                      : d.status === 'stopped'  ? '#f87171'
                      : d.status === 'partial'  ? '#fbbf24'
                      : 'var(--text-dim)';
    const obsBadge    = d.obsolete
      ? `<button class="secondary" title="Mark as active" style="padding:1px 5px;font-size:11px;color:#f87171" type="button" data-dockge-obs="${esc(d.stack_id)}">obs</button>`
      : `<button class="secondary" title="Mark as obsolete" style="padding:1px 5px;font-size:11px;color:var(--text-dim)" type="button" data-dockge-obs="${esc(d.stack_id)}">—</button>`;
    const notesCell   = `<span style="font-size:11px;color:var(--text-dim);cursor:pointer" title="Double-click to edit" data-dockge-note="${esc(d.stack_id)}">${esc(d.notes||'')}</span>`;

    // Toggle button (shows service count)
    const servicesOpen = _dockgeOpenServices.has(safeid);
    const toggleCell = svcCount > 0
      ? `<button class="secondary" id="dockge-svc-btn-${safeid}" style="padding:1px 5px;font-size:11px" type="button" data-dockge-svc-toggle="${safeid}">${servicesOpen ? '&#9660;' : '&#9658;'} ${svcCount}</button>`
      : `<span style="color:var(--text-dim)">${svcCount}</span>`;

    // Services expandable sub-row
    const svcSubRow = svcCount > 0 ? `
      <tr id="dockge-svc-${safeid}" style="display:${servicesOpen ? 'table-row' : 'none'}">
        <td colspan="${Math.max(1, visibleCols.length)}" style="padding:0 0 4px 28px;background:var(--bg-el)">
          <table style="width:100%;font-size:12px;border-collapse:collapse">
            <thead><tr style="color:var(--text-dim);border-bottom:1px solid var(--border)">
              <th style="padding:3px 8px;text-align:left">Service</th>
              <th style="padding:3px 8px;text-align:left">Image</th>
              <th style="padding:3px 8px;text-align:left">Ports</th>
              <th style="padding:3px 8px;text-align:left">State</th>
              <th style="padding:3px 8px;text-align:left">Container ID</th>
            </tr></thead>
            <tbody>
              ${svcs.map(sv => {
                let ports = '—';
                try { const pp = JSON.parse(sv.ports_json||'[]'); ports = Array.isArray(pp) && pp.length ? pp.join(', ') : '—'; } catch(_){}
                const stateCol = sv.container_state === 'running' ? 'var(--ok)'
                               : sv.container_state === 'exited'  ? '#f87171'
                               : 'var(--text-dim)';
                return `<tr>
                  <td style="padding:2px 8px"><strong>${esc(sv.service_name||'')}</strong></td>
                  <td style="padding:2px 8px;color:var(--text-dim);font-size:11px">${esc(sv.image||'—')}</td>
                  <td style="padding:2px 8px">${esc(ports)}</td>
                  <td style="padding:2px 8px;color:${stateCol}">${esc(sv.container_state||'—')}</td>
                  <td style="padding:2px 8px;font-size:11px;color:var(--text-dim)">${esc(sv.container_id||'—')}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </td>
      </tr>` : '';

    const cellMap = {
      services: `<td>${toggleCell}</td>`,
      pve_host: `<td><code>${esc(d.pve_host||'')}</code></td>`,
      source_vmid: `<td>${esc(d.source_vmid||'')}</td>`,
      vm_type_badge: `<td>${typeBadge}</td>`,
      source_lxc_name: `<td>${esc(d.source_lxc_name||'—')}</td>`,
      stack_name: `<td><strong>${esc(d.stack_name||'')}</strong></td>`,
      status: `<td style="color:${statusCol}">${esc(d.status||'—')}</td>`,
      env_file_exists: `<td style="text-align:center">${envBadge}</td>`,
      host_type: `<td style="font-size:11px;color:var(--text-dim)">${esc(d.vm_type==='lxc'?'LXC':d.vm_type==='qemu'?'VM':'—')}</td>`,
      parent: `<td>${parentBadge}</td>`,
      obsolete: `<td style="text-align:center">${obsBadge}</td>`,
      notes: `<td style="max-width:180px">${notesCell}</td>`,
      last_probed: `<td style="white-space:nowrap;color:var(--text-dim)">${esc(probed)}</td>`,
    };
    return `<tr>${visibleCols.map(col => cellMap[col] || '<td></td>').join('')}</tr>${svcSubRow}`;
  }).join('');
  });
}

function _dockgeFilteredRows() {
  const q = (document.getElementById('dockge-search')?.value || '').toLowerCase();
  const hideObs = !!document.getElementById('dockge-hide-obsolete')?.checked;
  return _dockgeStacks.filter(d =>
    (!hideObs || !d.obsolete) &&
    (
      (d.source_vmid || '').toString().includes(q) ||
      (d.source_lxc_name || '').toLowerCase().includes(q) ||
      (d.stack_name || '').toLowerCase().includes(q) ||
      (d.status || '').toLowerCase().includes(q) ||
      (d.parent_context || '').toLowerCase().includes(q) ||
      (d.ip_address || '').toLowerCase().includes(q) ||
      (d.notes || '').toLowerCase().includes(q)
    )
  );
}

function getDockgeExpansionState() {
  const rows = _dockgeFilteredRows();
  const expandableRows = rows.filter(row => (_dockgeServicesMap[row.stack_id] || []).length > 0);
  if (!expandableRows.length) {
    return { hasExpandable: false, anyExpanded: false, anyCollapsed: false };
  }
  let anyExpanded = false;
  let anyCollapsed = false;
  expandableRows.forEach(row => {
    const safeid = (row.stack_id || '').replace(/[^a-zA-Z0-9_-]/g,'_');
    const expanded = _dockgeOpenServices.has(safeid);
    if (expanded) anyExpanded = true;
    else anyCollapsed = true;
  });
  return {
    hasExpandable: true,
    anyExpanded: anyExpanded,
    anyCollapsed: anyCollapsed,
  };
}

function _dockgeSortValue(row, sortKey) {
  const svcs = _dockgeServicesMap[row.stack_id] || [];
  switch (sortKey) {
    case 'services': return svcs.length;
    case 'pve_host': return row.pve_host || '';
    case 'source_vmid': return Number(row.source_vmid || 0);
    case 'vm_type': return row.vm_type || '';
    case 'source_lxc_name': return row.source_lxc_name || '';
    case 'stack_name': return row.stack_name || '';
    case 'status': return row.status || '';
    case 'env_file_exists': return row.env_file_exists ? 1 : 0;
    case 'host_type': return row.vm_type === 'lxc' ? 'LXC' : row.vm_type === 'qemu' ? 'VM' : '';
    case 'parent': return `${row.parent_context || ''} ${row.parent_stack_name || ''}`.trim();
    case 'obsolete': return row.obsolete ? 1 : 0;
    case 'notes': return row.notes || '';
    case 'last_probed': return row.last_probed || '';
    default: return '';
  }
}

async function toggleDockgeObsolete(stackId) {
  const row = _dockgeStacks.find(d => d.stack_id === stackId);
  if (!row) return;
  const newVal = row.obsolete ? 0 : 1;
  try {
    const r = await apiFetch(`/api/v1/dockge-stacks/${encodeURIComponent(stackId)}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({obsolete: newVal}),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    row.obsolete = newVal;
    renderDockgeStacks();
  } catch (e) {
    await HubDialogs.alertError({
      title: 'Update failed',
      message: `Failed to update obsolete flag: ${e.message}`,
    });
  }
}

async function editDockgeNote(stackId, el) {
  const row = _dockgeStacks.find(d => d.stack_id === stackId);
  if (!row) return;
  const newNote = await HubDialogs.prompt({
    title: 'Edit Dockge note',
    message: `Edit note for "${stackId}".`,
    inputLabel: 'Note',
    value: row.notes || '',
    confirmText: 'Save',
    cancelText: 'Cancel',
  });
  if (newNote === null) return; // cancelled
  try {
    const r = await apiFetch(`/api/v1/dockge-stacks/${encodeURIComponent(stackId)}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({notes: newNote}),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    row.notes = newNote;
    renderDockgeStacks();
  } catch (e) {
    await HubDialogs.alertError({
      title: 'Save failed',
      message: `Failed to save note: ${e.message}`,
    });
  }
}

async function probeDockgeStacks() {
  const btn    = document.getElementById('dockge-probe-btn');
  const status = document.getElementById('dockge-probe-status');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Probing…'; }
  status.hidden = true;
  try {
    const r = await apiFetch('/api/v1/dockge-stacks/probe', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
    status.textContent = `✓ Done — stacks: ${d.stacks_total??0} (new: ${d.stacks_created??0}), services: ${d.services_total??0}, machines: ${d.machines_probed??0}`;
    status.style.color = 'var(--accent)';
    status.hidden = false;
    _dockgeStacks = [];
    await loadDockgeStacks();
  } catch (e) {
    status.textContent = `✗ Probe failed: ${e.message}`;
    status.style.color = '#f87171';
    status.hidden = false;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '▶ Probe Dockge'; }
  }
}
