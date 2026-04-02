const _VLAN_COLS = ['vlan_id', 'cidr', 'source', 'description', '_actions'];
const _VLAN_FIELD_META = {
  vlan_id: { label: 'VLAN', sortKey: 'vlan_id' },
  cidr: { label: 'CIDR', sortKey: 'cidr' },
  source: { label: 'Source', sortKey: 'source' },
  description: { label: 'Description', sortKey: 'description' },
  _actions: { label: 'Actions' },
};

let _vlanTableView = null;

function _ensureVlansTableView() {
  if (_vlanTableView || typeof TableView === 'undefined') return _vlanTableView;
  _vlanTableView = TableView.create({
    storageKey: 'vlans-table-prefs',
    columns: _VLAN_COLS,
    meta: _VLAN_FIELD_META,
    getTable: () => document.getElementById('vlans-table'),
    fallbackColumn: 'vlan_id',
    minWidth: 40,
    getDefaultWidth: col => col === '_actions' ? 46 : null,
    sort: {
      storageKey: 'vlans-table-sort',
      defaultKey: 'vlan_id',
      defaultDir: 1,
    },
    onSortChange: () => {
      renderVlans();
      _ensureVlansLayoutController()?.scheduleLayoutSave();
    },
    onColumnResizeEnd: () => {
      _ensureVlansLayoutController()?.scheduleLayoutSave();
    },
  });
  return _vlanTableView;
}

let _vlansLayoutController = null;

function _vlansColumnSeed(col) {
  const types = { vlan_id: 'INTEGER', cidr: 'TEXT', description: 'TEXT' };
  const lengths = { vlan_id: 4, cidr: 18, source: 9, description: 60 };
  return {
    sqlite_column: col === 'source' ? null : (col.startsWith('_') ? null : col),
    data_type: types[col] || null,
    sample_max_length: lengths[col] || null,
    min_width_px: col === '_actions' ? 40 : 40,
    max_width_px: col === '_actions' ? 46 : 900,
    width_px: _ensureVlansTableView()?.prefs?.getWidth(col) || (col === '_actions' ? 46 : null),
  };
}

function _ensureVlansLayoutController() {
  if (_vlansLayoutController || typeof TableBucketLayouts === 'undefined') return _vlansLayoutController;
  _vlansLayoutController = TableBucketLayouts.create({
    getTable: () => document.getElementById('vlans-table'),
    getView: () => _ensureVlansTableView(),
    getColumns: () => _VLAN_COLS,
    getMeta: col => _VLAN_FIELD_META[col],
    getDefaultWidth: col => col === '_actions' ? 46 : null,
    getColumnSeed: col => _vlansColumnSeed(col),
    render: () => renderVlans(),
    surfaceLabel: 'VLANs',
    layoutContextTitle: 'VLANs Layout Context',
  });
  return _vlansLayoutController;
}

async function toggleVlansHorizontalScroll() {
  const controller = _ensureVlansLayoutController();
  if (!controller) return;
  await controller.toggleHorizontalScroll();
}

async function openVlansLayoutContextModal() {
  const controller = _ensureVlansLayoutController();
  if (!controller) return;
  await controller.openLayoutContextModal();
}

function _vlanVisibleCols() {
  return _ensureVlansTableView()?.getVisibleCols() || ['vlan_id'];
}

function _vlanSortValue(vlan, sortKey) {
  switch (sortKey) {
    case 'vlan_id': return Number(vlan.vlan_id || 0);
    case 'cidr': return vlan.cidr || '';
    case 'source': return vlan.cidr_inferred ? 'inferred' : 'confirmed';
    case 'description': return vlan.description || '';
    default: return '';
  }
}

function _vlanRenderSource(vlan) {
  return vlan.cidr_inferred
    ? '<span style="color:#94a3b8;font-size:11px">inferred</span>'
    : '<span style="color:#4ade80;font-size:11px">confirmed</span>';
}

function _vlanRenderActions(vlan) {
  return `<td class="table-action-cell" style="width:46px"><div class="table-inline-actions"><button class="secondary table-icon-btn table-icon-btn--edit" type="button" title="Edit VLAN ${esc(String(vlan.vlan_id))}" aria-label="Edit VLAN ${esc(String(vlan.vlan_id))}" data-vlan-edit="${vlan.vlan_id}" data-vlan-cidr="${esc(vlan.cidr || '')}" data-vlan-desc="${esc(vlan.description || '')}"></button></div></td>`;
}

function _vlanRenderCell(vlan, col) {
  switch (col) {
    case 'vlan_id':
      return `<td><strong>${esc(String(vlan.vlan_id))}</strong></td>`;
    case 'cidr':
      return `<td><code>${esc(vlan.cidr || '—')}</code></td>`;
    case 'source':
      return `<td>${_vlanRenderSource(vlan)}</td>`;
    case 'description':
      return `<td class="table-cell-clip">${esc(vlan.description || '')}</td>`;
    case '_actions':
      return _vlanRenderActions(vlan);
    default:
      return '<td></td>';
  }
}

function openVlansColsModal() {
  const view = _ensureVlansTableView();
  if (!view) return;
  view.openColumns(
    document.getElementById('vlans-cols-modal-list'),
    document.getElementById('vlans-cols-modal'),
    col => _VLAN_FIELD_META[col].label
  );
}

function _applyVlansColsModal() {
  const view = _ensureVlansTableView();
  if (!view) return;
  view.applyColumns(document.getElementById('vlans-cols-modal'), renderVlans);
  HubModal.close(document.getElementById('vlans-cols-modal'));
}

async function loadVlans() {
  const err = document.getElementById('vlans-error');
  if (err) err.hidden = true;
  try {
    const r = await apiFetch('/api/v1/vlans');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _vlans = await r.json();
    renderVlans();
  } catch (e) {
    if (err) { err.textContent = `Failed to load VLANs: ${e.message}`; err.hidden = false; }
  }
}

function renderVlans() {
  const tbody = document.getElementById('vlans-tbody');
  if (!tbody) return;
  const view = _ensureVlansTableView();
  const visibleCols = _vlanVisibleCols();
  if (!_vlans.length) {
    view?.render(() => {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${Math.max(1, visibleCols.length)}">No VLANs discovered yet — run a Proxmox Config probe first.</td></tr>`;
    });
    return;
  }
  const rows = view?.sorter ? view.sorter.sortRows(_vlans, _vlanSortValue) : _vlans.slice();
  view?.render(() => {
    tbody.innerHTML = rows.map(vlan => `<tr>${visibleCols.map(col => _vlanRenderCell(vlan, col)).join('')}</tr>`).join('');
  });
}

let _editingVlanId = null;

function openVlanModal(vlan_id, currentCidr, currentDesc) {
  _editingVlanId = vlan_id;
  document.getElementById('vlan-modal-title').textContent = `Edit VLAN ${vlan_id}`;
  document.getElementById('vlan-modal-cidr').value = currentCidr || '';
  document.getElementById('vlan-modal-desc').value = currentDesc || '';
  document.getElementById('vlan-modal-error').textContent = '';
  HubModal.open(document.getElementById('vlan-modal'));
}

async function submitVlanEdit() {
  const errEl = document.getElementById('vlan-modal-error');
  const cidr = document.getElementById('vlan-modal-cidr').value.trim();
  const description = document.getElementById('vlan-modal-desc').value.trim();
  errEl.textContent = '';
  try {
    const r = await apiFetch(`/api/v1/vlans/${_editingVlanId}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ cidr: cidr || null, description: description || null }),
    });
    if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
    HubModal.close(document.getElementById('vlan-modal'));
    await loadVlans();
  } catch (e) {
    errEl.textContent = `Failed to save VLAN: ${e.message}`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  _ensureVlansTableView();
  document.getElementById('vlan-modal-save-btn')?.addEventListener('click', submitVlanEdit);
  document.getElementById('vlans-cols-modal-apply')?.addEventListener('click', _applyVlansColsModal);
  document.getElementById('vlans-tbody')?.addEventListener('click', e => {
    const editBtn = e.target.closest('[data-vlan-edit]');
    if (!editBtn) return;
    openVlanModal(+editBtn.dataset.vlanEdit, editBtn.dataset.vlanCidr, editBtn.dataset.vlanDesc);
  });
  _vlanTableView?.onLayoutChange(() => {
    renderVlans();
  });
});
