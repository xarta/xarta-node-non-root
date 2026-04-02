const _CADDY_COLS = ['pve_host', 'source_vmid', 'source_lxc_name', 'caddyfile_path', 'domains_json', 'upstreams_json', 'last_probed'];
const _CADDY_FIELD_META = {
  pve_host: { label: 'PVE', sortKey: 'pve_host' },
  source_vmid: { label: 'VMID', sortKey: 'source_vmid' },
  source_lxc_name: { label: 'LXC', sortKey: 'source_lxc_name' },
  caddyfile_path: { label: 'Caddyfile', sortKey: 'caddyfile_path' },
  domains_json: { label: 'Domains', sortKey: 'domains_json' },
  upstreams_json: { label: 'Upstreams', sortKey: 'upstreams_json' },
  last_probed: { label: 'Last Probed', sortKey: 'last_probed' },
};

let _caddyTableView = null;

document.addEventListener('DOMContentLoaded', () => {
  let _caddyFilterTimer = null;
  const searchEl = document.getElementById('caddy-search');
  _ensureCaddyTableView();
  if (searchEl) searchEl.addEventListener('input', () => {
    clearTimeout(_caddyFilterTimer);
    _caddyFilterTimer = setTimeout(renderCaddyConfigs, 250);
  });
  document.getElementById('caddy-cols-modal-apply')?.addEventListener('click', _applyCaddyColsModal);
  _caddyTableView?.onLayoutChange(() => {
    renderCaddyConfigs();
  });
  if (typeof ResponsiveLayout !== 'undefined') {
    ResponsiveLayout.registerTabControls('caddy-configs', 'pg-ctrl-caddy-configs');
  }
});

function _ensureCaddyTableView() {
  if (_caddyTableView || typeof TableView === 'undefined') return _caddyTableView;
  _caddyTableView = TableView.create({
    storageKey: 'caddy-table-prefs',
    columns: _CADDY_COLS,
    meta: _CADDY_FIELD_META,
    getTable: () => document.getElementById('caddy-table'),
    fallbackColumn: 'pve_host',
    minWidth: 40,
    sort: {
      storageKey: 'caddy-table-sort',
      defaultKey: 'pve_host',
      defaultDir: 1,
    },
    onSortChange: () => {
      renderCaddyConfigs();
      _ensureCaddyLayoutController()?.scheduleLayoutSave();
    },
    onColumnResizeEnd: () => {
      _ensureCaddyLayoutController()?.scheduleLayoutSave();
    },
  });
  return _caddyTableView;
}

let _caddyLayoutController = null;

function _caddyColumnSeed(col) {
  const types = {
    pve_host: 'TEXT', source_vmid: 'INTEGER', source_lxc_name: 'TEXT',
    caddyfile_path: 'TEXT', domains_json: 'TEXT', upstreams_json: 'TEXT', last_probed: 'TEXT',
  };
  const lengths = {
    pve_host: 16, source_vmid: 5, source_lxc_name: 24,
    caddyfile_path: 48, domains_json: 64, upstreams_json: 64, last_probed: 19,
  };
  return {
    sqlite_column: col,
    data_type: types[col] || null,
    sample_max_length: lengths[col] || null,
    min_width_px: 40,
    max_width_px: 900,
    width_px: _ensureCaddyTableView()?.prefs?.getWidth(col) || null,
  };
}

function _ensureCaddyLayoutController() {
  if (_caddyLayoutController || typeof TableBucketLayouts === 'undefined') return _caddyLayoutController;
  _caddyLayoutController = TableBucketLayouts.create({
    getTable: () => document.getElementById('caddy-table'),
    getView: () => _ensureCaddyTableView(),
    getColumns: () => _CADDY_COLS,
    getMeta: col => _CADDY_FIELD_META[col],
    getDefaultWidth: () => null,
    getColumnSeed: col => _caddyColumnSeed(col),
    render: () => renderCaddyConfigs(),
    surfaceLabel: 'Caddy Configs',
    layoutContextTitle: 'Caddy Configs Layout Context',
  });
  return _caddyLayoutController;
}

async function toggleCaddyHorizontalScroll() {
  const controller = _ensureCaddyLayoutController();
  if (!controller) return;
  await controller.toggleHorizontalScroll();
}

async function openCaddyLayoutContextModal() {
  const controller = _ensureCaddyLayoutController();
  if (!controller) return;
  await controller.openLayoutContextModal();
}

function openCaddyColsModal() {
  const view = _ensureCaddyTableView();
  if (!view) return;
  view.openColumns(
    document.getElementById('caddy-cols-modal-list'),
    document.getElementById('caddy-cols-modal'),
    col => _CADDY_FIELD_META[col].label
  );
}

function _applyCaddyColsModal() {
  const view = _ensureCaddyTableView();
  if (!view) return;
  view.applyColumns(document.getElementById('caddy-cols-modal'), renderCaddyConfigs);
  HubModal.close(document.getElementById('caddy-cols-modal'));
}

async function loadCaddyConfigs() {
  const err = document.getElementById('caddy-error');
  err.hidden = true;
  checkCaddyProbeStatus();
  try {
    const r = await apiFetch('/api/v1/caddy-configs');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _caddyConfigs = await r.json();
    renderCaddyConfigs();
  } catch (e) {
    err.textContent = `Failed to load Caddy configs: ${e.message}`;
    err.hidden = false;
  }
}

async function checkCaddyProbeStatus() {
  const btn = document.getElementById('caddy-probe-btn');
  const status = document.getElementById('caddy-probe-status');
  try {
    const r = await apiFetch('/api/v1/caddy-configs/probe/status');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (btn) btn.disabled = !d.configured;
    if (!d.configured) {
      if (btn) btn.title = d.reason;
      status.textContent = `⚠ Probe unavailable: ${d.reason}`;
      status.style.color = 'var(--text-dim)';
      status.hidden = false;
    }
  } catch (e) {
    if (btn) btn.disabled = true;
  }
}

function renderCaddyConfigs() {
  const q = (document.getElementById('caddy-search').value || '').toLowerCase();
  const rows = _caddyConfigs.filter(d =>
    (d.pve_host         || '').toLowerCase().includes(q) ||
    (d.source_lxc_name  || '').toLowerCase().includes(q) ||
    (d.source_vmid      || '').toLowerCase().includes(q) ||
    (d.domains_json     || '').toLowerCase().includes(q) ||
    (d.upstreams_json   || '').toLowerCase().includes(q)
  );
  const tbody = document.getElementById('caddy-tbody');
  const view = _ensureCaddyTableView();
  const visibleCols = view?.getVisibleCols() || ['pve_host'];
  if (!rows.length) {
    view?.render(() => {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${Math.max(1, visibleCols.length)}">No Caddy configs found.</td></tr>`;
    });
    return;
  }
  const sortedRows = view?.sorter ? view.sorter.sortRows(rows, (row, key) => _caddySortValue(row, key)) : rows.slice();
  view?.render(() => {
    tbody.innerHTML = sortedRows.map(d => {
    const probed = (d.last_probed || '—').replace('T',' ').slice(0,19);
    let domains = '—';
    try { const a = JSON.parse(d.domains_json || ''); domains = Array.isArray(a) ? a.join(', ') : '—'; } catch(_) {}
    let upstreams = '—';
    try { const a = JSON.parse(d.upstreams_json || ''); upstreams = Array.isArray(a) ? a.join(', ') : '—'; } catch(_) {}
    const cellMap = {
      pve_host: `<td><code>${esc(d.pve_host || '')}</code></td>`,
      source_vmid: `<td>${esc(d.source_vmid || '')}</td>`,
      source_lxc_name: `<td>${esc(d.source_lxc_name || '—')}</td>`,
      caddyfile_path: `<td style="font-size:11px;color:var(--text-dim)">${esc(d.caddyfile_path || '—')}</td>`,
      domains_json: `<td style="font-size:12px">${esc(domains)}</td>`,
      upstreams_json: `<td style="font-size:12px">${esc(upstreams)}</td>`,
      last_probed: `<td style="white-space:nowrap;color:var(--text-dim)">${esc(probed)}</td>`,
    };
    return `<tr>${visibleCols.map(col => cellMap[col] || '<td></td>').join('')}</tr>`;
  }).join('');
  });
}

function _caddySortValue(row, sortKey) {
  switch (sortKey) {
    case 'pve_host': return row.pve_host || '';
    case 'source_vmid': return Number(row.source_vmid || 0);
    case 'source_lxc_name': return row.source_lxc_name || '';
    case 'caddyfile_path': return row.caddyfile_path || '';
    case 'domains_json':
      try {
        const domains = JSON.parse(row.domains_json || '[]');
        return Array.isArray(domains) ? domains.join(', ') : '';
      } catch (_) {
        return row.domains_json || '';
      }
    case 'upstreams_json':
      try {
        const upstreams = JSON.parse(row.upstreams_json || '[]');
        return Array.isArray(upstreams) ? upstreams.join(', ') : '';
      } catch (_) {
        return row.upstreams_json || '';
      }
    case 'last_probed': return row.last_probed || '';
    default: return '';
  }
}

async function probeCaddyConfigs() {
  const btn    = document.getElementById('caddy-probe-btn');
  const status = document.getElementById('caddy-probe-status');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Probing…'; }
  status.hidden = true;
  try {
    const r = await apiFetch('/api/v1/caddy-configs/probe', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
    status.textContent = `✓ Done — created: ${d.created ?? 0}, updated: ${d.updated ?? 0}, hosts: ${d.pve_hosts_probed ?? 0}`;
    status.style.color = 'var(--accent)';
    status.hidden = false;
    _caddyConfigs = [];
    await loadCaddyConfigs();
  } catch (e) {
    status.textContent = `✗ Probe failed: ${e.message}`;
    status.style.color = '#f87171';
    status.hidden = false;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '▶ Probe Caddy'; }
  }
}
