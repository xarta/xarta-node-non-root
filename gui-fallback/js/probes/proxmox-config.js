/* ── Proxmox Config ───────────────────────────────────────────────────────── */

const _PVE_CFG_COLS = [
  'pve_name',
  'vmid',
  'vm_type',
  'name',
  'status',
  'cores',
  'memory_mb',
  'networks',
  'detected',
  'tags',
  'last_probed',
  '_actions',
];

const _PVE_CFG_FIELD_META = {
  pve_name: { label: 'PVE', sortKey: 'pve_name' },
  vmid: { label: 'VMID', sortKey: 'vmid' },
  vm_type: { label: 'Type', sortKey: 'vm_type' },
  name: { label: 'Name', sortKey: 'name' },
  status: { label: 'Status', sortKey: 'status' },
  cores: { label: 'Cores', sortKey: 'cores' },
  memory_mb: { label: 'RAM MB', sortKey: 'memory_mb' },
  networks: { label: 'Networks', sortKey: 'networks' },
  detected: { label: 'Detected', sortKey: 'detected' },
  tags: { label: 'Tags', sortKey: 'tags' },
  last_probed: { label: 'Last Probed', sortKey: 'last_probed' },
  _actions: { label: 'Actions' },
};

let _pveFilterTimer = null;  // debounce handle for pve-search input
let _pveConfigTableView = null;
let _pveOpenGroups = new Set();
let _pveOpenNetDetails = new Set();
let _pveAutoFitMeasuringDetails = false;

function _ensurePveConfigTableView() {
  if (_pveConfigTableView || typeof TableView === 'undefined') return _pveConfigTableView;
  _pveConfigTableView = TableView.create({
    storageKey: 'proxmox-config-table-prefs',
    columns: _PVE_CFG_COLS,
    meta: _PVE_CFG_FIELD_META,
    getTable: _pveConfigTableEl,
    fallbackColumn: 'pve_name',
    minWidth: 40,
    getDefaultWidth: col => col === '_actions' ? _pveConfigActionCellWidth() : null,
    sort: {
      storageKey: 'proxmox-config-table-sort',
      defaultKey: 'pve_name',
      defaultDir: 1,
    },
    onSortChange: () => {
      renderProxmoxConfig();
      _ensurePveConfigLayoutController()?.scheduleLayoutSave();
    },
    onColumnResizeEnd: () => {
      _ensurePveConfigLayoutController()?.scheduleLayoutSave();
    },
  });
  return _pveConfigTableView;
}

let _pveConfigLayoutController = null;

function _pveConfigColumnSeed(col) {
  const types = {
    pve_name: 'TEXT', vmid: 'INTEGER', vm_type: 'TEXT', name: 'TEXT', status: 'TEXT',
    cores: 'INTEGER', memory_mb: 'INTEGER', networks: 'TEXT', detected: 'TEXT',
    tags: 'TEXT', last_probed: 'TEXT',
  };
  const lengths = {
    pve_name: 24, vmid: 5, vm_type: 8, name: 36, status: 12,
    cores: 4, memory_mb: 8, networks: 64, detected: 32, tags: 48, last_probed: 19,
  };
  return {
    sqlite_column: col.startsWith('_') ? null : col,
    data_type: types[col] || null,
    sample_max_length: lengths[col] || null,
    min_width_px: col === '_actions' ? 40 : 40,
    max_width_px: col === '_actions' ? 46 : 900,
    width_px: _ensurePveConfigTableView()?.prefs?.getWidth(col) || (col === '_actions' ? 46 : null),
  };
}

function _preparePveConfigGroupedAutoFitMeasurement() {
  const previousOpenGroups = new Set(_pveOpenGroups);
  const previousOpenNetDetails = new Set(_pveOpenNetDetails);
  const previousMeasuringDetails = _pveAutoFitMeasuringDetails;
  _pveFilteredRows().forEach(row => {
    const safePve = 'pg' + String(row.pve_name || '').replace(/[^a-zA-Z0-9]/g, '_');
    const safeid = String(row.config_id).replace(/[^a-zA-Z0-9_-]/g, '_');
    _pveOpenGroups.add(safePve);
    if ((_proxmoxNetsMap[row.config_id] || []).length > 0) {
      _pveOpenNetDetails.add(safeid);
    }
  });
  _pveAutoFitMeasuringDetails = true;
  renderProxmoxConfig();
  return () => {
    _pveOpenGroups = previousOpenGroups;
    _pveOpenNetDetails = previousOpenNetDetails;
    _pveAutoFitMeasuringDetails = previousMeasuringDetails;
    renderProxmoxConfig();
  };
}

function _ensurePveConfigLayoutController() {
  if (_pveConfigLayoutController || typeof TableBucketLayouts === 'undefined') return _pveConfigLayoutController;
  _pveConfigLayoutController = TableBucketLayouts.create({
    getTable: _pveConfigTableEl,
    getView: () => _ensurePveConfigTableView(),
    getColumns: () => _PVE_CFG_COLS,
    getMeta: col => _PVE_CFG_FIELD_META[col],
    getDefaultWidth: col => col === '_actions' ? _pveConfigActionCellWidth() : null,
    getColumnSeed: col => _pveConfigColumnSeed(col),
    render: () => renderProxmoxConfig(),
    autoFitMode: 'grouped',
    prepareGroupedAutoFitMeasurement: _preparePveConfigGroupedAutoFitMeasurement,
    surfaceLabel: 'Proxmox Config',
    layoutContextTitle: 'Proxmox Config Layout Context',
  });
  return _pveConfigLayoutController;
}

async function toggleProxmoxConfigHorizontalScroll() {
  const controller = _ensurePveConfigLayoutController();
  if (!controller) return;
  await controller.toggleHorizontalScroll();
}

async function openProxmoxConfigLayoutContextModal() {
  const controller = _ensurePveConfigLayoutController();
  if (!controller) return;
  await controller.openLayoutContextModal();
}

function _pveConfigVisibleCols() {
  return _ensurePveConfigTableView()?.getVisibleCols() || ['pve_name'];
}

function _pveConfigTableEl() {
  return document.getElementById('pve-config-table');
}

function _pveConfigTbodyEl() {
  return document.getElementById('pve-tbody');
}

function _pveConfigActionCellWidth() {
  return 46;
}

function _pveConfigFormatDate(value) {
  return ((value || '—').replace('T', ' ').slice(0, 19)) || '—';
}

function _pveConfigDetectedItems(row) {
  const badges = [];
  const dockge = (() => { try { return JSON.parse(row.dockge_json || '[]'); } catch (_) { return []; } })();
  const portainer = (() => { try { return JSON.parse(row.portainer_json || '[]'); } catch (_) { return []; } })();
  const caddy = (() => { try { return JSON.parse(row.caddy_json || '[]'); } catch (_) { return []; } })();
  if (row.has_docker) badges.push('<span class="tag" style="background:#1d4ed8;color:#fff">docker</span>');
  portainer.forEach(p => badges.push(`<span class="tag" style="background:#0f766e;color:#fff" title="${esc(p.data_dir || p.method || '')}">portainer</span>`));
  caddy.forEach(c => badges.push(`<span class="tag" style="background:#15803d;color:#fff" title="${esc(c.caddyfile || '')}">caddy</span>`));
  dockge.forEach(g => badges.push(`<span class="tag" style="background:#92400e;color:#fff" title="${esc(g.stacks_dir || g.container || '')}">dockge</span>`));
  return badges;
}

function _pveConfigSortValue(row, sortKey) {
  const nets = _proxmoxNetsMap[row.config_id] || [];
  switch (sortKey) {
    case 'pve_name': return row.pve_name || '';
    case 'vmid': return Number(row.vmid || 0);
    case 'vm_type': return row.vm_type || '';
    case 'name': return row.name || '';
    case 'status': return row.status || '';
    case 'cores': return Number(row.cores || 0);
    case 'memory_mb': return Number(row.memory_mb || 0);
    case 'networks': return nets[0]?.ip_address || row.ip_address || '';
    case 'detected': return _pveConfigDetectedItems(row).length;
    case 'tags': return row.tags || '';
    case 'last_probed': return row.last_probed || '';
    default: return '';
  }
}

function _pveConfigDetectSummaryRows(rows, sortKey, sortDir) {
  const byPve = new Map();
  rows.forEach(row => {
    const pve = row.pve_name || '';
    if (!byPve.has(pve)) byPve.set(pve, []);
    byPve.get(pve).push(row);
  });

  const groups = Array.from(byPve.entries()).map(([pve, groupRows]) => {
    const sortedRows = groupRows.slice().sort((left, right) => {
      let cmp = 0;
      if (sortKey) {
        const l = _pveConfigSortValue(left, sortKey);
        const r = _pveConfigSortValue(right, sortKey);
        if (typeof l === 'number' && typeof r === 'number') cmp = l - r;
        else cmp = String(l).localeCompare(String(r), undefined, { numeric: true, sensitivity: 'base' });
      }
      if (cmp === 0) cmp = (left.pve_name || '').localeCompare((right.pve_name || ''), undefined, { numeric: true, sensitivity: 'base' });
      if (cmp === 0) cmp = Number(left.vmid || 0) - Number(right.vmid || 0);
      return cmp * sortDir;
    });
    const lxcCnt = sortedRows.filter(row => row.vm_type === 'lxc').length;
    const qemuCnt = sortedRows.filter(row => row.vm_type === 'qemu').length;
    return {
      pve,
      safePve: 'pg' + pve.replace(/[^a-zA-Z0-9]/g, '_'),
      rows: sortedRows,
      typeSummary: [
        qemuCnt ? `${qemuCnt} VM${qemuCnt !== 1 ? 's' : ''}` : '',
        lxcCnt ? `${lxcCnt} LXC${lxcCnt !== 1 ? 's' : ''}` : '',
      ].filter(Boolean).join(', ') || `${sortedRows.length} machine${sortedRows.length !== 1 ? 's' : ''}`,
      sortValue: sortKey === 'pve_name' || !sortKey ? pve : _pveConfigSortValue(sortedRows[0] || {}, sortKey),
    };
  });

  groups.sort((left, right) => {
    let cmp;
    if (typeof left.sortValue === 'number' && typeof right.sortValue === 'number') cmp = left.sortValue - right.sortValue;
    else cmp = String(left.sortValue).localeCompare(String(right.sortValue), undefined, { numeric: true, sensitivity: 'base' });
    if (cmp === 0) cmp = left.pve.localeCompare(right.pve, undefined, { numeric: true, sensitivity: 'base' });
    return cmp * sortDir;
  });

  return groups;
}

function _pveConfigRenderDeleteCell(configId) {
  return `<td class="table-action-cell" style="text-align:right;width:${_pveConfigActionCellWidth()}px"><div class="table-inline-actions"><button class="secondary table-icon-btn table-icon-btn--delete" type="button" title="Delete Proxmox config" aria-label="Delete Proxmox config" data-pve-del-config="${esc(configId)}"></button></div></td>`;
}

function _pveConfigRenderNetDeleteButton(netId, netKey) {
  return `<button class="secondary table-icon-btn table-icon-btn--delete table-icon-btn--sm" type="button" title="Delete NIC ${esc(netKey)}" aria-label="Delete NIC ${esc(netKey)}" data-pve-del-net="${esc(netId)}" data-pve-del-net-key="${esc(netKey)}"></button>`;
}

function _pveConfigRenderNetworksCell(configId, safeid, nets, ipAddress) {
  if (!nets.length) {
    return ipAddress ? `<td><code>${esc(ipAddress)}</code></td>` : '<td><span style="color:var(--text-dim)">—</span></td>';
  }
  const firstIp = nets[0].ip_address || '—';
  const isOpen = _pveOpenNetDetails.has(safeid);
  return `<td><button class="secondary table-row-toggle-button" style="padding:1px 5px;font-size:11px;margin-right:4px" type="button" data-pve-nets-toggle="${safeid}" id="nets-btn-${safeid}"><span class="table-row-toggle-icon${isOpen ? ' is-open' : ''}" aria-hidden="true"></span>${nets.length}</button><code>${esc(firstIp)}</code></td>`;
}

function _pveConfigRenderMainCell(row, col, safeid, nets) {
  switch (col) {
    case 'pve_name': return `<td><code>${esc(row.pve_name || '')}</code></td>`;
    case 'vmid': return `<td>${esc(String(row.vmid || ''))}</td>`;
    case 'vm_type': return `<td>${esc(row.vm_type || '')}</td>`;
    case 'name': return `<td class="table-cell-clip">${esc(row.name || '')}</td>`;
    case 'status': return `<td>${esc(row.status || '—')}</td>`;
    case 'cores': return `<td style="text-align:right">${row.cores ?? '—'}</td>`;
    case 'memory_mb': return `<td style="text-align:right">${row.memory_mb ?? '—'}</td>`;
    case 'networks': return _pveConfigRenderNetworksCell(row.config_id, safeid, nets, row.ip_address || '');
    case 'detected': {
      const badges = _pveConfigDetectedItems(row);
      return `<td>${badges.length ? badges.join(' ') : '<span style="color:var(--text-dim)">—</span>'}</td>`;
    }
    case 'tags': return `<td class="table-cell-clip">${esc(row.tags || '—')}</td>`;
    case 'last_probed': return `<td style="white-space:nowrap;color:var(--text-dim)">${esc(_pveConfigFormatDate(row.last_probed))}</td>`;
    case '_actions': return _pveConfigRenderDeleteCell(row.config_id);
    default: return '<td></td>';
  }
}

function _pveConfigRenderGroupRow(group, visibleCols, isOpen) {
  const cellCount = Math.max(1, visibleCols.length);
  const groupColumn = esc(visibleCols[0] || 'pve_name');
  if (cellCount === 1) {
    return `<tr data-pve-group-hdr="${group.safePve}" data-pve-group-open="${isOpen ? '1' : '0'}" data-pve-group-toggle="${group.safePve}" style="cursor:pointer;background:var(--surface);border-top:2px solid var(--border)"><td data-col="${groupColumn}" style="padding:7px 10px;font-weight:600"><span id="pve-grp-arrow-${group.safePve}"><span class="table-row-toggle-icon${isOpen ? ' is-open' : ''}" aria-hidden="true"></span></span><code>${esc(group.pve)}</code><span style="font-size:11px;font-weight:normal;color:var(--text-dim);margin-left:8px">${group.typeSummary}</span></td></tr>`;
  }
  return `<tr data-pve-group-hdr="${group.safePve}" data-pve-group-open="${isOpen ? '1' : '0'}" data-pve-group-toggle="${group.safePve}" style="cursor:pointer;background:var(--surface);border-top:2px solid var(--border)"><td data-col="${groupColumn}" style="padding:7px 10px;font-weight:600"><span id="pve-grp-arrow-${group.safePve}"><span class="table-row-toggle-icon${isOpen ? ' is-open' : ''}" aria-hidden="true"></span></span><code>${esc(group.pve)}</code></td><td colspan="${cellCount - 1}" style="padding:7px 10px;font-weight:600"><span style="font-size:11px;font-weight:normal;color:var(--text-dim)">${group.typeSummary}</span></td></tr>`;
}

function _pveConfigRenderNetDetailRow(groupSafePve, safeid, nets, colspan) {
  const netsHtml = nets.map(net => {
    const srcTag = net.ip_source && net.ip_source !== 'conf'
      ? ` <span style="color:#94a3b8;font-size:10px">(${esc(net.ip_source)})</span>` : '';
    return `<tr style="background:var(--bg-alt,#161b22)"><td style="padding:2px 4px 2px 16px;color:var(--text-dim);font-size:11px;white-space:nowrap">${esc(net.net_key)} <span style="display:inline-flex;vertical-align:middle;margin-left:4px">${_pveConfigRenderNetDeleteButton(net.net_id, net.net_key)}</span></td><td colspan="2"><code style="font-size:11px">${esc(net.ip_address || '—')}</code>${srcTag}</td><td><code style="font-size:11px">${esc(net.mac_address || '—')}</code></td><td style="font-size:11px">${net.vlan_tag ?? '—'}</td><td style="font-size:11px;color:var(--text-dim)">${esc(net.bridge || '—')}</td><td style="font-size:11px;color:var(--text-dim)">${esc(net.model || '—')}</td><td colspan="4"></td></tr>`;
  }).join('');
  return `<tr id="nets-detail-${safeid}" data-pve-group="${groupSafePve}" data-nets-detail="1" style="display:table-row"><td colspan="${colspan}" style="padding:0;border-top:1px solid var(--border,#30363d)"><table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:10px;color:var(--text-dim);background:var(--bg-darker,#0d1117)"><th style="padding:2px 4px 2px 16px;text-align:left">NIC</th><th colspan="2" style="text-align:left">IP</th><th style="text-align:left">MAC</th><th style="text-align:left">VLAN</th><th style="text-align:left">Bridge</th><th style="text-align:left">Model</th><th colspan="4"></th></tr></thead><tbody>${netsHtml}</tbody></table></td></tr>`;
}

function _pveConfigRenderNetMeasurementRows(groupSafePve, safeid, nets, visibleCols) {
  return nets.map(net => {
    const netText = `${net.net_key || ''} ${net.ip_address || ''}`.trim() || '—';
    const detectedText = [net.mac_address || '', net.vlan_tag == null ? '' : `vlan ${net.vlan_tag}`].filter(Boolean).join(' · ') || '—';
    const tagsText = [net.bridge || '', net.model || ''].filter(Boolean).join(' · ') || '—';
    return `<tr data-pve-group="${groupSafePve}" data-nets-detail="${safeid}" data-net-measurement-row="1" style="display:table-row">${visibleCols.map(col => {
      switch (col) {
        case 'pve_name':
        case 'vmid':
        case 'vm_type':
        case 'name':
        case 'status':
        case 'cores':
        case 'memory_mb':
          return '<td></td>';
        case 'networks':
          return `<td><code>${esc(netText)}</code></td>`;
        case 'detected':
          return `<td><code style="font-size:11px">${esc(detectedText)}</code></td>`;
        case 'tags':
          return `<td style="font-size:11px;color:var(--text-dim)">${esc(tagsText)}</td>`;
        case 'last_probed':
          return '<td></td>';
        case '_actions':
          return '<td></td>';
        default:
          return '<td></td>';
      }
    }).join('')}</tr>`;
  }).join('');
}

function _pveConfigRenderSharedTable(renderBody) {
  const view = _ensurePveConfigTableView();
  view?.render(renderBody);
}

function _pveOpenConfigColsModal() {
  const view = _ensurePveConfigTableView();
  if (!view) return;
  const list = document.getElementById('pve-config-cols-modal-list');
  view.openColumns(list, document.getElementById('pve-config-cols-modal'), col => _PVE_CFG_FIELD_META[col].label);
}

function _pveApplyConfigColsModal() {
  const view = _ensurePveConfigTableView();
  if (!view) return;
  const modal = document.getElementById('pve-config-cols-modal');
  view.applyColumns(modal, () => {
    renderProxmoxConfig();
    HubModal.close(modal);
    _ensurePveConfigLayoutController()?.scheduleLayoutSave();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  _ensurePveConfigTableView();
  _ensurePveConfigLayoutController()?.init();

  const pveSearch = document.getElementById('pve-search');
  if (pveSearch) {
    pveSearch.addEventListener('input', () => {
      clearTimeout(_pveFilterTimer);
      _pveFilterTimer = setTimeout(renderProxmoxConfig, 250);
    });
  }

  const wire = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  wire('pve-probe-btn',                 () => probeProxmoxConfig());
  wire('pve-enrich-btn',                () => enrichNetsFromPfsense());
  wire('pve-enrich-arp-btn',            () => enrichFromPfsenseArp());
  wire('pve-findips-btn',               () => findIpsByArp());
  wire('pve-findips-pve-btn',           () => findIpsViaPve());
  wire('pve-findips-qemu-btn',          () => findIpsViaQemuAgent());
  wire('pve-findips-pfsense-sweep-btn', () => findIpsViaPfsenseSweep());
  wire('pve-probe-services-btn',        () => probeVmServices());
  wire('pve-config-cols-modal-apply',   () => _pveApplyConfigColsModal());

  _pveConfigTableView?.onLayoutChange(() => {
    renderProxmoxConfig();
  });

  _pveConfigTbodyEl()?.addEventListener('click', e => {
    const groupToggle = e.target.closest('[data-pve-group-toggle]');
    if (groupToggle) {
      togglePveGroup(groupToggle.dataset.pveGroupToggle);
      return;
    }
    const netsToggle = e.target.closest('[data-pve-nets-toggle]');
    if (netsToggle) {
      toggleNets(netsToggle.dataset.pveNetsToggle);
      return;
    }
    const delConfig = e.target.closest('[data-pve-del-config]');
    if (delConfig) {
      deleteProxmoxConfig(delConfig.dataset.pveDelConfig);
      return;
    }
    const delNet = e.target.closest('[data-pve-del-net]');
    if (delNet) {
      deleteProxmoxNet(delNet.dataset.pveDelNet, delNet.dataset.pveDelNetKey || '');
    }
  });

  if (typeof ResponsiveLayout !== 'undefined') {
    ResponsiveLayout.registerTabControls('proxmox-config', 'pg-ctrl-proxmox-config');
  }
});

async function findIpsByArp() {
  const btn    = document.getElementById('pve-findips-btn');
  const status = document.getElementById('pve-probe-status');
  btn.disabled = true;
  btn.textContent = '⏳ Scanning…';
  status.hidden = true;
  try {
    const r = await apiFetch('/api/v1/proxmox-nets/find-ips-by-arp', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
    if (d.scanned === 0) {
      status.textContent = `⚠ ${d.message}`;
      status.style.color = 'var(--text-dim)';
    } else {
      status.textContent = `✓ ARP scan complete — ${d.message}`;
      status.style.color = 'var(--accent)';
      await loadProxmoxNets();
      renderProxmoxConfig();
    }
    status.hidden = false;
  } catch (e) {
    status.textContent = `✗ ARP scan failed: ${e.message}`;
    status.style.color = '#f87171';
    status.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = '🔎 Find IPs by ARP';
  }
}

async function findIpsViaPve() {
  const btn    = document.getElementById('pve-findips-pve-btn');
  const status = document.getElementById('pve-probe-status');
  btn.disabled = true;
  btn.textContent = '⏳ Scanning via PVE…';
  status.hidden = true;
  try {
    const r = await apiFetch('/api/v1/proxmox-nets/find-ips-via-pve', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
    status.textContent = `✓ PVE scan complete — ${d.message}`;
    status.style.color = 'var(--accent)';
    status.hidden = false;
    if (d.found > 0 || d.vlans_added?.length) {
      await loadProxmoxNets();
      renderProxmoxConfig();
      await loadVlans();
    }
  } catch (e) {
    status.textContent = `✗ PVE scan failed: ${e.message}`;
    status.style.color = '#f87171';
    status.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = '🔎 Find IPs via PVE';
  }
}

async function enrichFromPfsenseArp() {
  const btn    = document.getElementById('pve-enrich-arp-btn');
  const status = document.getElementById('pve-probe-status');
  btn.disabled = true;
  btn.textContent = '⏳ Reading pfSense ARP…';
  status.hidden = true;
  try {
    const r = await apiFetch('/api/v1/proxmox-nets/enrich-from-pfsense-arp', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
    status.textContent = `✓ pfSense ARP — ${d.message}`;
    status.style.color = 'var(--accent)';
    status.hidden = false;
    if (d.enriched > 0) {
      await loadProxmoxNets();
      renderProxmoxConfig();
      await loadVlans();
    }
  } catch (e) {
    status.textContent = `✗ pfSense ARP failed: ${e.message}`;
    status.style.color = '#f87171';
    status.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = '⇑ Fill IPs from pfSense ARP';
  }
}

async function findIpsViaQemuAgent() {
  const btn    = document.getElementById('pve-findips-qemu-btn');
  const status = document.getElementById('pve-probe-status');
  btn.disabled = true;
  btn.textContent = '⏳ Querying QEMU agents…';
  status.hidden = true;
  try {
    const r = await apiFetch('/api/v1/proxmox-nets/find-ips-via-qemu-agent', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
    status.textContent = `✓ QEMU agent — ${d.message}`;
    status.style.color = 'var(--accent)';
    status.hidden = false;
    if (d.found > 0) { await loadProxmoxNets(); renderProxmoxConfig(); }
  } catch (e) {
    status.textContent = `✗ QEMU agent failed: ${e.message}`;
    status.style.color = '#f87171';
    status.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = '\uD83D\uDD17 Find IPs via QEMU Agent';
  }
}

async function findIpsViaPfsenseSweep() {
  const btn    = document.getElementById('pve-findips-pfsense-sweep-btn');
  const status = document.getElementById('pve-probe-status');
  btn.disabled = true;
  btn.textContent = '⏳ pfSense sweep…';
  status.hidden = true;
  try {
    const r = await apiFetch('/api/v1/proxmox-nets/find-ips-via-pfsense-sweep', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
    status.textContent = `✓ pfSense sweep — ${d.message}`;
    status.style.color = 'var(--accent)';
    status.hidden = false;
    if (d.found > 0) { await loadProxmoxNets(); renderProxmoxConfig(); await loadVlans(); }
  } catch (e) {
    status.textContent = `✗ pfSense sweep failed: ${e.message}`;
    status.style.color = '#f87171';
    status.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = '\uD83D\uDD0E Find IPs via pfSense sweep';
  }
}

async function deleteProxmoxNet(net_id, net_key) {
  const ok = await HubDialogs.confirmDelete({
    title: 'Delete NIC record?',
    message: `Delete NIC "${net_key}" (${net_id})?`,
    detail: 'This removes the NIC record from Blueprints only. It does not change Proxmox.',
  });
  if (!ok) return;
  try {
    const r = await apiFetch(`/api/v1/proxmox-nets/${encodeURIComponent(net_id)}`, { method: 'DELETE' });
    if (!r.ok && r.status !== 204) { const d = await r.json().catch(()=>{}); throw new Error(d?.detail || `HTTP ${r.status}`); }
    await loadProxmoxNets();
    renderProxmoxConfig();
  } catch (e) {
    await HubDialogs.alertError({
      title: 'Delete failed',
      message: `Failed to delete NIC: ${e.message}`,
    });
  }
}

async function deleteProxmoxConfig(config_id) {
  const ok = await HubDialogs.confirmDelete({
    title: 'Delete Proxmox config?',
    message: `Delete "${config_id}" from Blueprints?`,
    detail: 'This removes the config from all Blueprints nodes. The VM or LXC itself is unaffected.',
  });
  if (!ok) return;
  try {
    const r = await apiFetch(`/api/v1/proxmox-config/${encodeURIComponent(config_id)}`, { method: 'DELETE' });
    if (!r.ok && r.status !== 204) { const d = await r.json().catch(()=>{}); throw new Error(d?.detail || `HTTP ${r.status}`); }
    await loadProxmoxConfig();
  } catch (e) {
    await HubDialogs.alertError({
      title: 'Delete failed',
      message: `Failed to delete config: ${e.message}`,
    });
  }
}

async function loadProxmoxConfig() {
  const err = document.getElementById('pve-error');
  err.hidden = true;
  checkProxmoxProbeStatus();
  try {
    const r = await apiFetch('/api/v1/proxmox-config');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _proxmoxConfig = await r.json();
    await loadProxmoxNets();
    renderProxmoxConfig();
    // Async table data lands after initial menu paint on hard refresh.
    // Recompute fn-item visibility once real rows are available.
    if (typeof ProbesMenuConfig !== 'undefined') ProbesMenuConfig.updateActiveTab('proxmox-config');
    loadVlans(); // refresh VLAN tab whenever proxmox config is loaded
  } catch (e) {
    err.textContent = `Failed to load Proxmox config: ${e.message}`;
    err.hidden = false;
  }
}

async function checkProxmoxProbeStatus() {
  const btn = document.getElementById('pve-probe-btn');
  const status = document.getElementById('pve-probe-status');
  try {
    const r = await apiFetch('/api/v1/proxmox-config/probe/status');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    btn.disabled = !d.configured;
    if (!d.configured) {
      btn.title = d.reason;
      status.textContent = `⚠ Probe unavailable: ${d.reason}`;
      status.style.color = 'var(--text-dim)';
      status.hidden = false;
    }
  } catch (e) {
    btn.disabled = true;
    btn.title = `Could not check probe status: ${e.message}`;
  }
}

function renderProxmoxConfig() {
  const q = (document.getElementById('pve-search').value || '').toLowerCase();
  const rows = _pveFilteredRows();
  const tbody = _pveConfigTbodyEl();
  const view = _ensurePveConfigTableView();
  const sortState = view?.getSortState() || { key: 'pve_name', dir: 1 };
  const visibleCols = _pveConfigVisibleCols();
  const stepsToggleBtn     = document.getElementById('pve-steps-toggle-btn');
  const expandAllBtn       = document.getElementById('pve-expand-all-btn');
  const collapseAllBtn     = document.getElementById('pve-collapse-all-btn');
  if (!rows.length) {
    _pveConfigRenderSharedTable(() => {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${Math.max(1, visibleCols.length)}">No Proxmox configs found.</td></tr>`;
    });
    if (stepsToggleBtn) stepsToggleBtn.hidden = true;
    if (expandAllBtn)   expandAllBtn.hidden   = true;
    if (collapseAllBtn) collapseAllBtn.hidden = true;
    return;
  }

  const hasAnyNets = rows.some(d => (_proxmoxNetsMap[d.config_id] || []).length > 0);
  if (stepsToggleBtn) stepsToggleBtn.hidden = false;
  if (expandAllBtn)   expandAllBtn.hidden   = !hasAnyNets;
  if (collapseAllBtn) collapseAllBtn.hidden = !hasAnyNets;

  const groups = _pveConfigDetectSummaryRows(rows, sortState.key || 'pve_name', sortState.dir === -1 ? -1 : 1);
  _pveConfigRenderSharedTable(() => {
    const html = [];
    groups.forEach(group => {
      const isOpen = q.length > 0 || _pveOpenGroups.has(group.safePve);
      html.push(_pveConfigRenderGroupRow(group, visibleCols, isOpen));
      group.rows.forEach(row => {
        const safeid = row.config_id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const nets = _proxmoxNetsMap[row.config_id] || [];
        if (isOpen) {
          html.push(`<tr data-pve-group="${group.safePve}" data-vm-row="${safeid}" style="display:table-row">${visibleCols.map(col => _pveConfigRenderMainCell(row, col, safeid, nets)).join('')}</tr>`);
          if (nets.length > 0 && _pveOpenNetDetails.has(safeid)) {
            html.push(_pveAutoFitMeasuringDetails
              ? _pveConfigRenderNetMeasurementRows(group.safePve, safeid, nets, visibleCols)
              : _pveConfigRenderNetDetailRow(group.safePve, safeid, nets, Math.max(1, visibleCols.length)));
          }
        }
      });
    });
    tbody.innerHTML = html.join('');
  });
}

function _pveFilteredRows() {
  const q = (document.getElementById('pve-search').value || '').toLowerCase();
  return _proxmoxConfig.filter(d =>
    (d.pve_name || '').toLowerCase().includes(q) ||
    String(d.vmid || '').toLowerCase().includes(q) ||
    (d.name || '').toLowerCase().includes(q) ||
    (d.ip_address || '').toLowerCase().includes(q) ||
    (d.tags || '').toLowerCase().includes(q)
  );
}

function getProxmoxConfigExpansionState() {
  const q = (document.getElementById('pve-search')?.value || '').toLowerCase();
  const rows = _pveFilteredRows();
  const expandableRows = rows.filter(row => (_proxmoxNetsMap[row.config_id] || []).length > 0);
  if (!expandableRows.length) {
    return { hasExpandable: false, anyExpanded: false, anyCollapsed: false };
  }

  let anyExpanded = false;
  let anyCollapsed = false;
  expandableRows.forEach(row => {
    const safePve = 'pg' + String(row.pve_name || '').replace(/[^a-zA-Z0-9]/g, '_');
    const safeid = String(row.config_id).replace(/[^a-zA-Z0-9_-]/g, '_');
    const groupOpen = q.length > 0 || _pveOpenGroups.has(safePve);
    const detailOpen = _pveOpenNetDetails.has(safeid);
    const fullyExpanded = groupOpen && detailOpen;

    // Manual group opens count as expanded from a user perspective.
    // Expand-all target state for a row is groupOpen + detailOpen.
    if (groupOpen || fullyExpanded) anyExpanded = true;
    if (!fullyExpanded) anyCollapsed = true;
  });

  return {
    hasExpandable: true,
    anyExpanded: anyExpanded,
    anyCollapsed: anyCollapsed,
  };
}

function toggleNets(safeid) {
  if (_pveOpenNetDetails.has(safeid)) _pveOpenNetDetails.delete(safeid);
  else _pveOpenNetDetails.add(safeid);
  renderProxmoxConfig();
  if (typeof ProbesMenuConfig !== 'undefined') ProbesMenuConfig.updateActiveTab('proxmox-config');
}

function togglePveGroup(safePve) {
  if (_pveOpenGroups.has(safePve)) _pveOpenGroups.delete(safePve);
  else _pveOpenGroups.add(safePve);
  renderProxmoxConfig();
  if (typeof ProbesMenuConfig !== 'undefined') ProbesMenuConfig.updateActiveTab('proxmox-config');
}

function setAllNets(open) {
  const filteredRows = _pveFilteredRows();
  if (open) {
    filteredRows.forEach(row => {
      const safePve = 'pg' + String(row.pve_name || '').replace(/[^a-zA-Z0-9]/g, '_');
      _pveOpenGroups.add(safePve);
      if ((_proxmoxNetsMap[row.config_id] || []).length > 0) {
        _pveOpenNetDetails.add(String(row.config_id).replace(/[^a-zA-Z0-9_-]/g, '_'));
      }
    });
  } else {
    _pveOpenGroups.clear();
    _pveOpenNetDetails.clear();
  }
  renderProxmoxConfig();
  if (typeof ProbesMenuConfig !== 'undefined') ProbesMenuConfig.updateActiveTab('proxmox-config');
}

async function loadProxmoxNets() {
  try {
    const r = await apiFetch('/api/v1/proxmox-nets');
    if (!r.ok) return;
    const nets = await r.json();
    _proxmoxNetsMap = {};
    for (const n of nets) {
      if (!_proxmoxNetsMap[n.config_id]) _proxmoxNetsMap[n.config_id] = [];
      _proxmoxNetsMap[n.config_id].push(n);
    }
  } catch (e) { /* non-fatal */ }
}

async function enrichNetsFromPfsense() {
  const btn    = document.getElementById('pve-enrich-btn');
  const status = document.getElementById('pve-probe-status');
  btn.disabled = true;
  status.hidden = true;
  try {
    const r = await apiFetch('/api/v1/proxmox-nets/enrich-from-pfsense', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
    status.textContent = `⇑ Enriched ${d.enriched ?? 0} of ${d.checked ?? 0} net interfaces from pfSense`;
    status.style.color = 'var(--accent)';
    status.hidden = false;
    await loadProxmoxNets();
    renderProxmoxConfig();
  } catch (e) {
    status.textContent = `✗ Enrich failed: ${e.message}`;
    status.style.color = '#f87171';
    status.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

function togglePveSteps() {
  const panel = document.getElementById('pve-steps-panel');
  const btn   = document.getElementById('pve-steps-toggle-btn');
  const open  = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'flex';
  if (btn) btn.innerHTML = open ? '&#9881; Steps &#9663;' : '&#9881; Steps &#9652;';
}

async function fullProbeProxmox() {
  const btn    = document.getElementById('pve-full-probe-btn');
  const status = document.getElementById('pve-probe-status');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Running…'; }
  status.style.color = 'var(--text-dim)';
  status.hidden = false;

  // [label, url, refreshNets after step]
  const STEPS = [
    ['1/8 Probing PVE configs',        '/api/v1/proxmox-config/probe',                    false],
    ['2/8 Fill IPs from pfSense',      '/api/v1/proxmox-nets/enrich-from-pfsense',         true],
    ['3/8 Fill IPs from pfSense ARP',  '/api/v1/proxmox-nets/enrich-from-pfsense-arp',     true],
    ['4/8 Find IPs by ARP scan',       '/api/v1/proxmox-nets/find-ips-by-arp',             true],
    ['5/8 Find IPs via PVE API',       '/api/v1/proxmox-nets/find-ips-via-pve',            true],
    ['6/8 Find IPs via QEMU agents',   '/api/v1/proxmox-nets/find-ips-via-qemu-agent',     true],
    ['7/8 Find IPs via pfSense sweep', '/api/v1/proxmox-nets/find-ips-via-pfsense-sweep',  true],
    ['8/8 Probe VM services via SSH',  '/api/v1/proxmox-config/probe-services',            false],
  ];

  const stepResults = [];
  for (const [label, url, refreshNets] of STEPS) {
    status.textContent = `⏳ ${label}…`;
    try {
      const r = await apiFetch(url, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        stepResults.push(`⚠ ${label}: ${d.detail || 'HTTP ' + r.status}`);
      } else {
        const msg = d.message || '';
        stepResults.push(`✓ ${label}${msg ? ': ' + msg : ''}`);
        if (refreshNets) { await loadProxmoxNets(); renderProxmoxConfig(); }
      }
    } catch (e) {
      stepResults.push(`✗ ${label}: ${e.message}`);
    }
  }
  await loadProxmoxConfig();
  const ok = stepResults.filter(s => s.startsWith('✓')).length;
  status.textContent = `⚡ Full probe done — ${ok}/${STEPS.length} steps succeeded`;
  status.style.color = ok >= STEPS.length - 1 ? 'var(--accent)' : '#f59e0b';
  if (btn) { btn.disabled = false; btn.textContent = '⚡ Full Probe'; }
  console.log('Full probe results:', stepResults);
}

async function probeVmServices() {
  const btn    = document.getElementById('pve-probe-services-btn');
  const status = document.getElementById('pve-probe-status');
  btn.disabled = true;
  btn.textContent = '⏳ Probing VM services…';
  status.hidden = true;
  try {
    const r = await apiFetch('/api/v1/proxmox-config/probe-services', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
    status.textContent = `✓ VM services — ${d.message}`;
    status.style.color = 'var(--accent)';
    status.hidden = false;
    if (d.updated > 0) { await loadProxmoxConfig(); }
  } catch (e) {
    status.textContent = `✗ VM services probe failed: ${e.message}`;
    status.style.color = '#f87171';
    status.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = '&#128065; Probe VM Services';
  }
}

async function probeProxmoxConfig() {
  const btn    = document.getElementById('pve-probe-btn');
  const status = document.getElementById('pve-probe-status');
  btn.disabled = true;
  btn.textContent = '⟳ Probing…';
  status.hidden = true;
  try {
    const r = await apiFetch('/api/v1/proxmox-config/probe', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
    const nc = d.nets_created ?? 0, nu = d.nets_updated ?? 0;
    status.textContent = `✓ Done — ${d.total ?? 0} VMs (${d.created ?? 0} new, ${d.updated ?? 0} updated)`
      + (nc + nu ? `; ${nc + nu} net interfaces (${nc} new, ${nu} updated)` : '');
    status.style.color = 'var(--accent)';
    status.hidden = false;
    _proxmoxConfig = [];
    await loadProxmoxConfig();
  } catch (e) {
    status.textContent = `✗ Probe failed: ${e.message}`;
    status.style.color = '#f87171';
    status.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = '▶ Probe PVE';
  }
}
