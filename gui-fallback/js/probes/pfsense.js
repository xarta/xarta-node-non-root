/* ── pfSense DNS ──────────────────────────────────────────────────────── */

const _DNS_COLS = [
  'ip_address',
  'fqdn',
  'record_type',
  'source',
  'mac_address',
  'active',
  'last_seen',
  'last_probed',
  'ping_ms',
  'last_ping_check',
];

const _DNS_FIELD_META = {
  ip_address: { label: 'IP Address', sortKey: 'ip_address' },
  fqdn: { label: 'FQDN', sortKey: 'fqdn' },
  record_type: { label: 'Type', sortKey: 'record_type' },
  source: { label: 'Source', sortKey: 'source' },
  mac_address: { label: 'MAC', sortKey: 'mac_address' },
  active: { label: 'Active', sortKey: 'active' },
  last_seen: { label: 'Last Seen', sortKey: 'last_seen' },
  last_probed: { label: 'Last Probed', sortKey: 'last_probed' },
  ping_ms: { label: 'Ping ms', sortKey: 'ping_ms' },
  last_ping_check: { label: 'Last Check', sortKey: 'last_ping_check' },
};

let _dnsFilterTimer = null;
let _dnsTableView = null;
let _dnsOpenGroups = new Set();

function _ensureDnsTableView() {
  if (_dnsTableView || typeof TableView === 'undefined') return _dnsTableView;
  _dnsTableView = TableView.create({
    storageKey: 'pfsense-dns-table-prefs',
    columns: _DNS_COLS,
    meta: _DNS_FIELD_META,
    getTable: _dnsTableEl,
    fallbackColumn: 'ip_address',
    minWidth: 40,
    sort: {
      storageKey: 'pfsense-dns-table-sort',
      defaultKey: 'ip_address',
      defaultDir: 1,
    },
    onSortChange: () => {
      renderPfSenseDns();
      _ensureDnsLayoutController()?.scheduleLayoutSave();
    },
    onColumnResizeEnd: () => {
      _ensureDnsLayoutController()?.scheduleLayoutSave();
    },
  });
  return _dnsTableView;
}

let _dnsLayoutController = null;

function _dnsColumnSeed(col) {
  const types = {
    ip_address: 'TEXT', fqdn: 'TEXT', record_type: 'TEXT', source: 'TEXT',
    mac_address: 'TEXT', active: 'INTEGER', last_seen: 'TEXT', last_probed: 'TEXT',
    ping_ms: 'REAL', last_ping_check: 'TEXT',
  };
  const lengths = {
    ip_address: 15, fqdn: 64, record_type: 8, source: 16, mac_address: 17,
    active: 3, last_seen: 19, last_probed: 19, ping_ms: 8, last_ping_check: 19,
  };
  return {
    sqlite_column: col,
    data_type: types[col] || null,
    sample_max_length: lengths[col] || null,
    min_width_px: 40,
    max_width_px: 900,
    width_px: _ensureDnsTableView()?.prefs?.getWidth(col) || null,
  };
}

function _ensureDnsLayoutController() {
  if (_dnsLayoutController || typeof TableBucketLayouts === 'undefined') return _dnsLayoutController;
  _dnsLayoutController = TableBucketLayouts.create({
    getTable: _dnsTableEl,
    getView: () => _ensureDnsTableView(),
    getColumns: () => _DNS_COLS,
    getMeta: col => _DNS_FIELD_META[col],
    getDefaultWidth: () => null,
    getColumnSeed: col => _dnsColumnSeed(col),
    render: () => renderPfSenseDns(),
    surfaceLabel: 'pfSense DNS',
    layoutContextTitle: 'pfSense DNS Layout Context',
  });
  return _dnsLayoutController;
}

async function togglePfSenseDnsHorizontalScroll() {
  const controller = _ensureDnsLayoutController();
  if (!controller) return;
  await controller.toggleHorizontalScroll();
}

async function openPfSenseDnsLayoutContextModal() {
  const controller = _ensureDnsLayoutController();
  if (!controller) return;
  await controller.openLayoutContextModal();
}

function _dnsVisibleCols() {
  return _ensureDnsTableView()?.getVisibleCols() || ['ip_address'];
}

function _dnsTableEl() {
  return document.getElementById('dns-table');
}

function _dnsTbodyEl() {
  return document.getElementById('dns-tbody');
}

function _dnsFormatDate(value) {
  return ((value || '—').replace('T', ' ').slice(0, 19)) || '—';
}

function _dnsIpToken(ip) {
  return String(ip || '')
    .split('.')
    .map(part => String(parseInt(part, 10) || 0).padStart(3, '0'))
    .join('.');
}

function _dnsNormalizeSortValue(value) {
  if (value == null) return '';
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return String(value).toLowerCase();
}

function _dnsCompareValues(left, right) {
  const a = _dnsNormalizeSortValue(left);
  const b = _dnsNormalizeSortValue(right);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function _dnsSortValue(record, sortKey) {
  switch (sortKey) {
    case 'ip_address':
      return _dnsIpToken(record.ip_address || '');
    case 'fqdn':
      return record.fqdn || '';
    case 'record_type':
      return record.record_type || '';
    case 'source':
      return record.source || '';
    case 'mac_address':
      return record.mac_address || '';
    case 'active':
      return record.active ? 1 : 0;
    case 'last_seen':
      return record.last_seen || '';
    case 'last_probed':
      return record.last_probed || '';
    case 'ping_ms':
      return record.ping_ms == null ? Number.POSITIVE_INFINITY : Number(record.ping_ms);
    case 'last_ping_check':
      return record.last_ping_check || '';
    default:
      return '';
  }
}

function _dnsSortRecords(records, sortKey, sortDir) {
  const activeKey = sortKey || 'ip_address';
  const dir = sortDir === -1 ? -1 : 1;
  return (records || []).slice().sort((left, right) => {
    let cmp = _dnsCompareValues(_dnsSortValue(left, activeKey), _dnsSortValue(right, activeKey));
    if (cmp === 0 && activeKey !== 'fqdn') {
      cmp = _dnsCompareValues(left.fqdn || '', right.fqdn || '');
    }
    if (cmp === 0 && activeKey !== 'record_type') {
      cmp = _dnsCompareValues(left.record_type || '', right.record_type || '');
    }
    if (cmp === 0) {
      cmp = _dnsCompareValues(left.source || '', right.source || '');
    }
    return cmp * dir;
  });
}

function _dnsGroupStats(records) {
  const activeCount = records.filter(r => r.active).length;
  const bestPing = records.reduce((best, record) => {
    if (record.ping_ms == null) return best;
    return best == null || record.ping_ms < best ? record.ping_ms : best;
  }, null);
  const mac = records.find(record => record.mac_address)?.mac_address || '—';
  return { activeCount, bestPing, mac };
}

function _dnsBuildGroups(rows, sortState) {
  const byIp = new Map();
  rows.forEach(record => {
    const ip = record.ip_address || '';
    if (!byIp.has(ip)) byIp.set(ip, []);
    byIp.get(ip).push(record);
  });

  const activeKey = sortState?.key || 'ip_address';
  const activeDir = sortState?.dir === -1 ? -1 : 1;
  const groups = Array.from(byIp.entries()).map(([ip, records]) => {
    const sortedRecords = _dnsSortRecords(records, activeKey, activeDir);
    const stats = _dnsGroupStats(sortedRecords);
    return {
      ip,
      safeip: 'dg' + ip.replace(/\./g, '_'),
      records: sortedRecords,
      stats,
      sortValue: activeKey === 'ip_address'
        ? _dnsIpToken(ip)
        : _dnsSortValue(sortedRecords[0] || {}, activeKey),
    };
  });

  groups.sort((left, right) => {
    let cmp = _dnsCompareValues(left.sortValue, right.sortValue);
    if (cmp === 0) cmp = _dnsCompareValues(_dnsIpToken(left.ip), _dnsIpToken(right.ip));
    return cmp * activeDir;
  });

  return groups;
}

function _dnsRenderPingCell(pingMs) {
  if (pingMs == null) {
    return '<td style="text-align:right;color:var(--text-dim)">—</td>';
  }
  if (pingMs < 10) {
    return `<td style="text-align:right;color:var(--ok)">${pingMs.toFixed(1)}</td>`;
  }
  if (pingMs < 100) {
    return `<td style="text-align:right;color:var(--warn)">${pingMs.toFixed(1)}</td>`;
  }
  return `<td style="text-align:right;color:var(--err)">${pingMs.toFixed(1)}</td>`;
}

function _dnsRenderDetailCell(record, col) {
  switch (col) {
    case 'ip_address':
      return '<td style="padding-left:20px;color:var(--text-dim);font-size:11px">↳</td>';
    case 'fqdn':
      return `<td class="table-cell-clip">${esc(record.fqdn || '')}</td>`;
    case 'record_type':
      return `<td>${esc(record.record_type || '')}</td>`;
    case 'source':
      return `<td class="table-cell-clip">${esc(record.source || '')}</td>`;
    case 'mac_address':
      return `<td><code style="font-size:11px">${esc(record.mac_address || '—')}</code></td>`;
    case 'active':
      return `<td style="text-align:center">${record.active ? '<span style="color:var(--ok)">✓</span>' : '<span style="color:var(--text-dim)">✗</span>'}</td>`;
    case 'last_seen':
      return `<td style="white-space:nowrap;color:var(--text-dim)">${esc(_dnsFormatDate(record.last_seen))}</td>`;
    case 'last_probed':
      return `<td style="white-space:nowrap;color:var(--text-dim)">${esc(_dnsFormatDate(record.last_probed))}</td>`;
    case 'ping_ms':
      return _dnsRenderPingCell(record.ping_ms);
    case 'last_ping_check':
      return `<td style="white-space:nowrap;color:var(--text-dim)">${esc(_dnsFormatDate(record.last_ping_check))}</td>`;
    default:
      return '<td></td>';
  }
}

function _dnsRenderGroupRow(group, isOpen, visibleCols) {
  const cellCount = Math.max(1, visibleCols.length);
  const stats = group.stats;
  const pingSummary = stats.bestPing == null
    ? ''
    : ` · <span style="color:${stats.bestPing < 10 ? 'var(--ok)' : stats.bestPing < 100 ? 'var(--warn)' : 'var(--err)'}">${stats.bestPing.toFixed(1)} ms</span>`;
  const summary = `${group.records.length} record${group.records.length !== 1 ? 's' : ''}${stats.activeCount < group.records.length ? ` · ${stats.activeCount} active` : ''}${pingSummary} · MAC ${esc(stats.mac)}`;
  if (cellCount === 1) {
    return `<tr data-dns-group-hdr="${group.safeip}" data-dns-group-open="${isOpen ? '1' : '0'}" data-dns-toggle="${group.safeip}" style="cursor:pointer;background:var(--surface);border-top:2px solid var(--border)">
      <td style="font-weight:600"><span id="dns-grp-arrow-${group.safeip}" style="font-size:10px;color:var(--text-dim);margin-right:5px">${isOpen ? '▼' : '▶'}</span><code>${esc(group.ip)}</code> <span style="color:var(--text-dim);font-size:12px">${summary}</span></td>
    </tr>`;
  }
  return `<tr data-dns-group-hdr="${group.safeip}" data-dns-group-open="${isOpen ? '1' : '0'}" data-dns-toggle="${group.safeip}" style="cursor:pointer;background:var(--surface);border-top:2px solid var(--border)">
    <td style="font-weight:600"><span id="dns-grp-arrow-${group.safeip}" style="font-size:10px;color:var(--text-dim);margin-right:5px">${isOpen ? '▼' : '▶'}</span><code>${esc(group.ip)}</code></td>
    <td colspan="${cellCount - 1}" style="color:var(--text-dim);font-size:12px">${summary}</td>
  </tr>`;
}

function _dnsRenderSharedTable(renderBody) {
  const view = _ensureDnsTableView();
  view?.render(renderBody);
}

function _dnsOpenColsModal() {
  const view = _ensureDnsTableView();
  if (!view) return;
  const list = document.getElementById('dns-cols-modal-list');
  view.openColumns(list, document.getElementById('dns-cols-modal'), col => _DNS_FIELD_META[col].label);
}

function _dnsApplyColsModal() {
  const view = _ensureDnsTableView();
  if (!view) return;
  const modal = document.getElementById('dns-cols-modal');
  view.applyColumns(modal, () => {
    renderPfSenseDns();
    HubModal.close(modal);
    _ensureDnsLayoutController()?.scheduleLayoutSave();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const dnsSearch = document.getElementById('dns-search');
  const dnsHideInact = document.getElementById('dns-hide-inactive');

  _ensureDnsTableView();

  if (dnsSearch) {
    dnsSearch.addEventListener('input', () => {
      clearTimeout(_dnsFilterTimer);
      _dnsFilterTimer = setTimeout(renderPfSenseDns, 250);
    });
  }
  if (dnsHideInact) {
    dnsHideInact.addEventListener('change', renderPfSenseDns);
  }

  _dnsTableView?.onLayoutChange(() => {
    renderPfSenseDns();
  });

  _dnsTbodyEl()?.addEventListener('click', e => {
    const toggle = e.target.closest('[data-dns-toggle]');
    if (!toggle) return;
    toggleDnsGroup(toggle.dataset.dnsToggle);
  });

  document.getElementById('dns-cols-modal-apply')?.addEventListener('click', _dnsApplyColsModal);

  if (typeof ResponsiveLayout !== 'undefined') {
    ResponsiveLayout.registerTabControls('pfsense-dns', 'pg-ctrl-pfsense-dns');
  }
});

async function loadPfSenseDns() {
  const err = document.getElementById('dns-error');
  err.hidden = true;
  checkProbeStatus();   // update button state every time tab is visited
  try {
    const r = await apiFetch('/api/v1/pfsense-dns');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _pfsenseDns = await r.json();
    renderPfSenseDns();
  } catch (e) {
    err.textContent = `Failed to load DNS entries: ${e.message}`;
    err.hidden = false;
  }
}

async function checkProbeStatus() {
  const btn    = document.getElementById('dns-probe-btn');
  const status = document.getElementById('dns-probe-status');
  try {
    const r = await apiFetch('/api/v1/pfsense-dns/probe/status');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (d.configured) {
      if (btn) { btn.disabled = false; btn.title = ''; }
      // Only clear the status line if it's showing a config message (not a probe result)
      if (status.dataset.type === 'config') { status.hidden = true; }
    } else {
      if (btn) { btn.disabled = true; btn.title = d.reason; }
      status.textContent = `⚠ Probe unavailable: ${d.reason}`;
      status.style.color = 'var(--text-dim)';
      status.dataset.type = 'config';
      status.hidden = false;
    }
  } catch (e) {
    if (btn) { btn.disabled = true; btn.title = `Could not check probe status: ${e.message}`; }
  }
}

function renderPfSenseDns() {
  const q = (document.getElementById('dns-search').value || '').toLowerCase();
  const hideInactive = document.getElementById('dns-hide-inactive').checked;
  const rows = _pfsenseDns.filter(d =>
    (!hideInactive || d.active) && (
      (d.ip_address || '').toLowerCase().includes(q) ||
      (d.fqdn || '').toLowerCase().includes(q) ||
      (d.record_type || '').toLowerCase().includes(q) ||
      (d.source || '').toLowerCase().includes(q) ||
      (d.mac_address || '').toLowerCase().includes(q)
    )
  );
  const tbody = _dnsTbodyEl();
  const view = _ensureDnsTableView();
  const sortState = view?.getSortState() || { key: 'ip_address', dir: 1 };
  const visibleCols = _dnsVisibleCols();
  if (!rows.length) {
    const msg = hideInactive ? 'No active DNS entries match the filter.' : 'No DNS entries found.';
    _dnsRenderSharedTable(() => {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${Math.max(1, visibleCols.length)}">${msg}</td></tr>`;
    });
    return;
  }
  const groups = _dnsBuildGroups(rows, sortState);

  _dnsRenderSharedTable(() => {
    const html = [];
    groups.forEach(group => {
      const isOpen = q.length > 0 || _dnsOpenGroups.has(group.safeip);
      html.push(_dnsRenderGroupRow(group, isOpen, visibleCols));
      group.records.forEach(record => {
        html.push(`<tr data-dns-ip="${group.safeip}" style="display:${isOpen ? 'table-row' : 'none'}">${visibleCols.map(col => _dnsRenderDetailCell(record, col)).join('')}</tr>`);
      });
    });
    tbody.innerHTML = html.join('');
  });
}

function setAllDnsGroups(open) {
  document.querySelectorAll('[data-dns-group-hdr]').forEach(hdr => {
    const safeip = hdr.dataset.dnsGroupHdr;
    if (open) _dnsOpenGroups.add(safeip);
    else _dnsOpenGroups.delete(safeip);
  });
  renderPfSenseDns();
}

function toggleDnsGroup(safeip) {
  const hdr   = document.querySelector(`[data-dns-group-hdr="${safeip}"]`);
  const isOpen = hdr && hdr.dataset.dnsGroupOpen === '1';
  if (isOpen) _dnsOpenGroups.delete(safeip);
  else _dnsOpenGroups.add(safeip);
  renderPfSenseDns();
}

async function probePfSense() {
  const btn    = document.getElementById('dns-probe-btn');
  const status = document.getElementById('dns-probe-status');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Probing…'; }
  status.hidden = true;
  try {
    const r = await apiFetch('/api/v1/pfsense-dns/probe', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
    const macs = d.mac_enriched ?? d.mac_addresses_found ?? 0;
    status.textContent = `✓ Probe complete — created: ${d.created ?? 0}, updated: ${d.updated ?? 0}, MACs enriched: ${macs}`;
    status.style.color = 'var(--accent)';
    status.dataset.type = 'probe';
    status.hidden = false;
    _pfsenseDns = [];
    await loadPfSenseDns();
  } catch (e) {
    status.textContent = `✗ Probe failed: ${e.message}`;
    status.style.color = '#f87171';
    status.dataset.type = 'probe';
    status.hidden = false;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '▶ Probe pfSense'; }
  }
}

async function pingSweep() {
  const btn    = document.getElementById('dns-sweep-btn');
  const status = document.getElementById('dns-sweep-status');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Sweeping…'; }
  status.hidden = true;
  try {
    const r = await apiFetch('/api/v1/pfsense-dns/ping-sweep', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
    status.textContent = `✓ Sweep complete — reached: ${d.reached}/${d.ips_checked}, MACs found: ${d.macs_found}`;
    status.style.color = 'var(--accent)';
    status.hidden = false;
    _pfsenseDns = [];
    await loadPfSenseDns();
  } catch (e) {
    status.textContent = `✗ Sweep failed: ${e.message}`;
    status.style.color = '#f87171';
    status.hidden = false;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '▶ Ping Sweep'; }
  }
}

/* ── Proxmox Config ───────────────────────────────────────────────────── */
