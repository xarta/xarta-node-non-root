/* ── Manual Links ────────────────────────────────────────────────────────── */

let _manualLinksView = 'rendered';   // 'table' | 'rendered' | 'tree' | 'pretext' | 'grid'
let _editingLinkId   = null;         // null = add mode, string = edit mode
let _mlFilter    = '';               // table filter text
let _mlGroupBy   = 'none';          // 'none' | 'group' | 'host'
let _mlCollapsed = new Set();       // collapsed group keys
let _mlFilterTimer = null;          // debounce handle for ml-filter input
let _manualLinkCategories = [];
let _manualLinkCategoryItems = [];
let _mlGridOpen = new Set();
let _mlGridOpenLinkBranches = new Set();
let _mlExpandedRoutes = new Set();
let _mlGridDragId = null;
let _mlGridDragKind = null;
let _mlGridDragSourceParent = null;
let _mlGridDragOffsetX = null;
let _mlGridDragOffsetY = null;
let _mlGridDropCell = null;
let _mlGridCategoryNestIntent = null;
let _mlPanelResizeState = null;
let _mlPanelResizeRevealTimer = null;
let _mlGridInteractionActive = null;
let _mlGridInteractionTouchFallbackId = null;
let _mlPickedCategory = null;
let _mlCurrentGridLayoutBucket = null;
let _mlManagingCategoryId = null;
let _mlShadeViewportObserver = null;
const _ML_DEFAULT_PAGE_KEY = 'blueprintsDefaultManualLinksPage';
const _ML_GRID_ORDER_KEY = 'blueprintsManualLinksPage4GridOrder';
const _ML_GRID_LAYOUT_KEY = 'blueprintsManualLinksInterfaceLayout';
const _ML_GRID_DEBUG_KEY = 'blueprintsManualLinksInterfaceDebugCells';
const _ML_GRID_ROW_HEIGHT = 42;
const _ML_TOUCH_DRAG_HOLD_MS = 320;
const _ML_TOUCH_DRAG_MOVE_PX = 6;
const _ML_TOUCH_DRAG_SCROLL_EDGE = 72;
const _ML_LEAF_DOUBLE_TAP_MS = 520;
const _ML_DEFAULT_TAB = 'manual-links-rendered';
const _ML_GRID_INTERACTION_STATES = Object.freeze({
  IDLE: 'idle',
  LINK_PENDING: 'link-pending',
  PRESSING: 'pressing',
  DRAGGING: 'dragging',
});
const _ML_GRID_INTERACTION_TRANSITIONS = Object.freeze({
  idle: Object.freeze({
    press: Object.freeze({ next: 'pressing', actions: [] }),
    tapOther: Object.freeze({ next: 'link-pending', actions: ['startPending'] }),
    doubleTap: Object.freeze({ next: 'idle', actions: ['toggleRoute'] }),
    cancel: Object.freeze({ next: 'idle', actions: [] }),
  }),
  'link-pending': Object.freeze({
    press: Object.freeze({ next: 'pressing', actions: [] }),
    tapSame: Object.freeze({ next: 'idle', actions: ['clearPending', 'toggleRoute'] }),
    tapOther: Object.freeze({ next: 'link-pending', actions: ['replacePending'] }),
    doubleTap: Object.freeze({ next: 'idle', actions: ['clearPending', 'toggleRoute'] }),
    timeout: Object.freeze({ next: 'idle', actions: ['openPending', 'clearPending'] }),
    cancel: Object.freeze({ next: 'idle', actions: ['clearPending'] }),
  }),
  pressing: Object.freeze({
    hold: Object.freeze({ next: 'dragging', actions: ['clearPending'] }),
    release: Object.freeze({ next: 'idle', actions: [] }),
    cancel: Object.freeze({ next: 'idle', actions: ['clearPending'] }),
  }),
  dragging: Object.freeze({
    release: Object.freeze({ next: 'idle', actions: [] }),
    cancel: Object.freeze({ next: 'idle', actions: ['clearPending'] }),
  }),
});
const _ML_DEFAULT_ICON = 'icons/hieroglyphs/eye-of-horus-blue.svg';
const _ML_PAGE_TO_VIEW = {
  'manual-links-table': 'table',
  'manual-links-rendered': 'rendered',
  'manual-links-tree': 'tree',
  'manual-links-pretext': 'pretext',
  'manual-links-grid': 'grid',
};
const _ML_VIEW_TO_PAGE = {
  table: 'manual-links-table',
  rendered: 'manual-links-rendered',
  tree: 'manual-links-tree',
  pretext: 'manual-links-pretext',
  grid: 'manual-links-grid',
};
const _ML_TABLE_COLS = ['link_id', 'label', 'addresses', 'group_name', 'sort_order', 'host', 'notes', '_actions'];
const _ML_TABLE_FIELD_META = {
  link_id: {
    label: 'ID',
    render: lnk => `<td style="font-family:monospace;font-size:11px;color:var(--text-dim);max-width:80px;overflow:hidden;text-overflow:ellipsis" title="${esc(lnk.link_id)}">${esc(lnk.link_id.slice(0, 8))}</td>`,
  },
  label: {
    label: 'Label',
    sortKey: 'label',
    render: lnk => `<td style="max-width:160px">${lnk.icon ? _mlIconHtml(lnk.icon, 'ml-inline-icon') : ''}${lnk.label ? `<strong>${esc(lnk.label)}</strong>` : '<span style="color:var(--text-dim)">—</span>'}</td>`,
  },
  addresses: {
    label: 'Addresses',
    sortKey: 'addr',
    render: lnk => `<td style="max-width:200px">${_mlAddressParts(lnk).join(' ') || '<span style="color:var(--text-dim)">—</span>'}</td>`,
  },
  group_name: {
    label: 'Group',
    sortKey: 'group',
    render: lnk => `<td>${lnk.group_name ? esc(lnk.group_name) : '<span style="color:var(--text-dim)">—</span>'}</td>`,
  },
  sort_order: {
    label: 'Order',
    sortKey: 'order',
    defaultWidth: 64,
    render: lnk => `<td>${lnk.sort_order}</td>`,
  },
  host: {
    label: 'Host',
    sortKey: 'host',
    render: lnk => `<td style="font-size:12px">${_mlHostParts(lnk).join(', ') || '<span style="color:var(--text-dim)">—</span>'}</td>`,
  },
  notes: {
    label: 'Notes',
    sortKey: 'notes',
    render: lnk => `<td style="max-width:200px;font-size:12px;color:var(--text-dim)">${lnk.notes ? esc(lnk.notes) : ''}</td>`,
  },
  _actions: {
    label: 'Actions',
    defaultWidth: 96,
    render: lnk => _mlRenderActionsCell(lnk),
  },
};

let _mlTableView = null;
let _mlLayoutController = null;
const _ML_ACTION_INLINE_WIDTH = 96;
const _ML_ACTION_COMPACT_WIDTH = 48;

function _ensureManualLinksTableView() {
  if (_mlTableView || typeof TableView === 'undefined') return _mlTableView;
  _mlTableView = TableView.create({
    storageKey: 'manual-links-table-prefs',
    columns: _ML_TABLE_COLS,
    meta: _ML_TABLE_FIELD_META,
    getTable: () => document.getElementById('ml-table'),
    getDefaultWidth: col => (col === '_actions' ? _mlActionCellWidth() : ((_ML_TABLE_FIELD_META[col] || {}).defaultWidth || null)),
    minWidth: 40,
    sort: {
      storageKey: 'manual-links-table-sort',
    },
    onSortChange: () => {
      renderManualLinksTable();
      _ensureManualLinksLayoutController()?.scheduleLayoutSave();
    },
    onColumnResizeEnd: () => {
      _ensureManualLinksLayoutController()?.scheduleLayoutSave();
    },
  });
  return _mlTableView;
}

function _mlVisibleCols() {
  const view = _ensureManualLinksTableView();
  return view ? view.getVisibleCols() : _ML_TABLE_COLS;
}

function _mlColumnSeed(col) {
  switch (col) {
    case 'link_id':
      return { sqlite_column: 'link_id', data_type: 'TEXT', sample_max_length: 36, min_width_px: 80, max_width_px: 240 };
    case 'label':
      return { sqlite_column: 'label', data_type: 'TEXT', sample_max_length: 28, min_width_px: 120, max_width_px: 520 };
    case 'addresses':
      return { sqlite_column: null, data_type: 'TEXT', sample_max_length: 36, min_width_px: 140, max_width_px: 720 };
    case 'group_name':
      return { sqlite_column: 'group_name', data_type: 'TEXT', sample_max_length: 24, min_width_px: 100, max_width_px: 360 };
    case 'sort_order':
      return { sqlite_column: 'sort_order', data_type: 'INTEGER', sample_max_length: 4, min_width_px: 64, max_width_px: 120 };
    case 'host':
      return { sqlite_column: null, data_type: 'TEXT', sample_max_length: 32, min_width_px: 120, max_width_px: 620 };
    case 'notes':
      return { sqlite_column: 'notes', data_type: 'TEXT', sample_max_length: 64, min_width_px: 120, max_width_px: 1200 };
    case '_actions':
      return { sqlite_column: null, data_type: null, sample_max_length: null, min_width_px: _ML_ACTION_COMPACT_WIDTH, max_width_px: _ML_ACTION_INLINE_WIDTH, width_px: _mlActionCellWidth() };
    default:
      return {};
  }
}

function _ensureManualLinksLayoutController() {
  if (_mlLayoutController || typeof TableBucketLayouts === 'undefined') return _mlLayoutController;
  _mlLayoutController = TableBucketLayouts.create({
    getTable: () => document.getElementById('ml-table'),
    getView: () => _ensureManualLinksTableView(),
    getColumns: () => _ML_TABLE_COLS,
    getMeta: col => _ML_TABLE_FIELD_META[col],
    getDefaultWidth: col => (col === '_actions' ? _mlActionCellWidth() : ((_ML_TABLE_FIELD_META[col] || {}).defaultWidth || null)),
    getColumnSeed: col => _mlColumnSeed(col),
    render: () => renderManualLinksTable(),
    surfaceLabel: 'Manual Links',
    layoutContextTitle: 'Manual Links Layout Context',
  });
  return _mlLayoutController;
}

function _mlCompactRowActions() {
  const view = _ensureManualLinksTableView();
  return typeof TableRowActions !== 'undefined' && TableRowActions.shouldCollapse({
    view,
    getTable: () => document.getElementById('ml-table'),
    columnKey: '_actions',
    requiredWidth: _ML_ACTION_INLINE_WIDTH,
    defaultWidth: _ML_ACTION_INLINE_WIDTH,
  });
}

function _mlActionCellWidth() {
  return _mlCompactRowActions() ? _ML_ACTION_COMPACT_WIDTH : _ML_ACTION_INLINE_WIDTH;
}

function _mlAddressParts(lnk) {
  const addrParts = [];
  if (lnk.vlan_ip) addrParts.push(`<span class="badge" title="VLAN IP">${esc(lnk.vlan_ip)}</span>`);
  if (lnk.vlan_uri) addrParts.push(`<span class="badge" title="VLAN URI">${esc(lnk.vlan_uri)}</span>`);
  if (lnk.tailnet_ip) addrParts.push(`<span class="badge" title="Tailnet IP">${esc(lnk.tailnet_ip)}</span>`);
  if (lnk.tailnet_uri) addrParts.push(`<span class="badge" title="Tailnet URI">${esc(lnk.tailnet_uri)}</span>`);
  return addrParts;
}

function _mlHostParts(lnk) {
  const hostParts = [];
  if (lnk.pve_host) hostParts.push(`PVE: ${esc(lnk.pve_host)}`);
  if (lnk.is_internet) hostParts.push('<span class="badge" style="background:var(--accent-dim)">internet</span>');
  if (lnk.vm_id) hostParts.push(`VM ${esc(lnk.vm_id)}${lnk.vm_name ? ` (${esc(lnk.vm_name)})` : ''}`);
  if (lnk.lxc_id) hostParts.push(`LXC ${esc(lnk.lxc_id)}${lnk.lxc_name ? ` (${esc(lnk.lxc_name)})` : ''}`);
  if (lnk.location) hostParts.push(`<span style="color:var(--text-dim);font-size:11px">${esc(lnk.location)}</span>`);
  return hostParts;
}

function _mlActionButtons(lnk) {
  return `<button class="secondary table-icon-btn table-icon-btn--edit" type="button" title="Edit manual link" aria-label="Edit manual link" data-ml-edit="${esc(lnk.link_id)}"></button>
    <button class="secondary table-icon-btn table-icon-btn--delete" type="button" title="Delete manual link" aria-label="Delete manual link" data-ml-del="${esc(lnk.link_id)}"></button>`;
}

function _mlRenderActionsCell(lnk) {
  if (_mlCompactRowActions()) {
    return `<td class="table-action-cell table-action-cell--compact" style="width:${_mlActionCellWidth()}px">
      <button class="table-row-action-trigger secondary" type="button" title="Manual link actions" data-ml-row-actions="${esc(lnk.link_id)}">&#8942;</button>
    </td>`;
  }
  return `<td class="table-action-cell" style="white-space:nowrap"><div class="table-inline-actions">${_mlActionButtons(lnk)}</div></td>`;
}

function _mlOpenRowActions(linkId) {
  if (typeof TableRowActions === 'undefined') return;
  const link = _manualLinks.find(item => String(item.link_id) === String(linkId));
  if (!link) return;
  TableRowActions.open({
    title: link.label || link.link_id.slice(0, 8),
    subtitle: link.group_name || '',
    actions: [
      {
        label: 'Edit link',
        detail: 'Open the manual link editor',
        onClick: () => openManualLinkModal(link.link_id),
      },
      {
        label: 'Delete link',
        detail: 'Remove this manual link from Blueprints',
        tone: 'danger',
        onClick: () => deleteManualLink(link.link_id),
      },
    ],
  });
}

function _mlRebuildThead() {
  const view = _ensureManualLinksTableView();
  view?.rebuildHead();
}

function _mlRenderSharedTable(renderBody) {
  const view = _ensureManualLinksTableView();
  if (!view) return;
  view.render(renderBody);
}

function mlOpenColsModal() {
  const view = _ensureManualLinksTableView();
  if (!view) return;
  view.openColumns(
    document.getElementById('ml-cols-modal-list'),
    document.getElementById('ml-cols-modal')
  );
}

function _mlApplyColsModal() {
  const view = _ensureManualLinksTableView();
  if (!view) return;
  const modal = document.getElementById('ml-cols-modal');
  view.applyColumns(modal, () => {
    renderManualLinksTable();
    HubModal.close(modal);
    _ensureManualLinksLayoutController()?.scheduleLayoutSave();
  });
}

async function toggleManualLinksHorizontalScroll() {
  const controller = _ensureManualLinksLayoutController();
  if (!controller) return;
  await controller.toggleHorizontalScroll();
}

async function openManualLinksLayoutContextModal() {
  const controller = _ensureManualLinksLayoutController();
  if (!controller) return;
  await controller.openLayoutContextModal();
}

function _mlNormalizeDefaultTab(tabId) {
  if (tabId === 'manual-links') return _ML_DEFAULT_TAB;
  return _ML_PAGE_TO_VIEW[tabId] ? tabId : _ML_DEFAULT_TAB;
}

function _mlCurrentManualTabId() {
  return _ML_VIEW_TO_PAGE[_manualLinksView] || _ML_DEFAULT_TAB;
}

function _mlGetDefaultTabId() {
  const current = _mlNormalizeDefaultTab(localStorage.getItem(_ML_DEFAULT_PAGE_KEY) || _ML_DEFAULT_TAB);
  if (current !== localStorage.getItem(_ML_DEFAULT_PAGE_KEY)) {
    localStorage.setItem(_ML_DEFAULT_PAGE_KEY, current);
  }
  return current;
}

function _mlLabelForTab(tabId) {
  switch (_mlNormalizeDefaultTab(tabId)) {
    case 'manual-links-table': return 'Table';
    case 'manual-links-tree': return 'Page 2';
    case 'manual-links-pretext': return 'Page 3';
    case 'manual-links-grid': return 'Interface';
    case 'manual-links-rendered':
    default:
      return 'Page 1';
  }
}

function _mlSetDefaultTab(tabId) {
  const next = _mlNormalizeDefaultTab(tabId);
  localStorage.setItem(_ML_DEFAULT_PAGE_KEY, next);
  if (typeof HubDialogs !== 'undefined') {
    HubDialogs.alert({
      title: 'Default Manual Links Page',
      message: `${_mlLabelForTab(next)} is now the default Manual Links page.`,
      tone: 'success',
      badge: 'Manual',
    });
  }
  return next;
}

function _mlSetActiveAsDefault() {
  return _mlSetDefaultTab(_mlCurrentManualTabId());
}

function _mlOpenDefaultPage() {
  switchTab(_mlGetDefaultTabId());
}

function _mlGridDebugEnabled() {
  return localStorage.getItem(_ML_GRID_DEBUG_KEY) === '1';
}

function _mlSetGridDebugEnabled(enabled) {
  localStorage.setItem(_ML_GRID_DEBUG_KEY, enabled ? '1' : '0');
  _mlApplyGridDebugState();
  return enabled;
}

function _mlToggleGridDebugCells() {
  const enabled = _mlSetGridDebugEnabled(!_mlGridDebugEnabled());
  if (typeof HubDialogs !== 'undefined') {
    HubDialogs.alert({
      title: 'Interface Debug Cells',
      message: `Virtual cell borders are now ${enabled ? 'visible' : 'hidden'}.`,
      tone: enabled ? 'success' : 'info',
      badge: 'Manual',
    });
  }
  return enabled;
}

const BlueprintsManualLinks = {
  getCurrentTabId: _mlCurrentManualTabId,
  getDefaultTabId: _mlGetDefaultTabId,
  setDefaultTab: _mlSetDefaultTab,
  setActiveAsDefault: _mlSetActiveAsDefault,
  openDefault: _mlOpenDefaultPage,
  autoFitInterface: _mlAutoFitInterface,
  toggleDebugCells: _mlToggleGridDebugCells,
  debugCellsEnabled: _mlGridDebugEnabled,
};
window.BlueprintsManualLinks = BlueprintsManualLinks;

/* ── View toggle ─────────────────────────────────────────────────────────── */

function manualLinksShowView(view) {
  _manualLinksView = view;
  try {
    const tabId = _mlCurrentManualTabId();
    sessionStorage.setItem('blueprintsManualLinksActiveTab', tabId);
    const url = new URL(window.location.href);
    url.searchParams.set('group', 'synthesis');
    url.searchParams.set('tab', tabId);
    window.history.replaceState(window.history.state, '', url.toString());
  } catch (_) {}
  const isGrid = view === 'grid';
  document.body.classList.toggle('manual-links-grid-active', isGrid);
  document.getElementById('tab-manual-links')?.classList.toggle('ml-grid-active', isGrid);
  document.getElementById('ml-table-view').style.display    = view === 'table'    ? '' : 'none';
  document.getElementById('ml-rendered-view').style.display = view === 'rendered' ? '' : 'none';
  document.getElementById('ml-tree-view').style.display     = view === 'tree'     ? '' : 'none';
  document.getElementById('ml-pretext-view').style.display  = view === 'pretext'  ? '' : 'none';
  document.getElementById('ml-grid-view').style.display     = isGrid             ? '' : 'none';
  if (typeof SynthesisMenuConfig !== 'undefined') SynthesisMenuConfig.updateActiveTab('manual-links-' + view);
  // Show/hide the header filter input for the table sub-view
  if (typeof ResponsiveLayout !== 'undefined') ResponsiveLayout.updateControlsForTab('manual-links-' + view);
  if (view === 'table') renderManualLinksTable();
  else if (isGrid) renderManualLinksGrid();
  else renderManualLinksStoryViews();
  if (isGrid) _mlScheduleGridViewportFit();
}

function renderManualLinksStoryViews() {
  renderManualLinksRendered();
  renderManualLinksTree();
  renderManualLinksPretext();
  renderManualLinksGrid();
}

/* ── Load + render table ─────────────────────────────────────────────────── */

async function loadManualLinks() {
  const err = document.getElementById('ml-error');
  if (err) err.hidden = true;
  try {
    const r = await apiFetch('/api/v1/manual-links');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _manualLinks = await r.json();
    await loadManualLinkCategories();
    renderManualLinksTable();
    renderManualLinksStoryViews();
  } catch (e) {
    if (err) { err.textContent = `Failed to load manual links: ${e.message}`; err.hidden = false; }
  }
}

async function loadManualLinkCategories() {
  const r = await apiFetch('/api/v1/manual-link-categories');
  if (!r.ok) throw new Error(`categories HTTP ${r.status}`);
  const payload = await r.json();
  _manualLinkCategories = Array.isArray(payload.categories) ? payload.categories : [];
  _manualLinkCategoryItems = Array.isArray(payload.items) ? payload.items : [];
}

function renderManualLinksTable() {
  const view = _ensureManualLinksTableView();

  const tbody = document.getElementById('ml-tbody');
  if (!tbody) return;

  // Filter
  const q = (document.getElementById('ml-filter')?.value || '').toLowerCase().trim();
  let rows = q
    ? _manualLinks.filter(l => [
        l.label, l.vlan_ip, l.vlan_uri, l.tailnet_ip, l.tailnet_uri,
        l.group_name, l.pve_host, l.vm_name, l.lxc_name, l.location, l.notes
      ].some(v => v && v.toLowerCase().includes(q)))
    : [..._manualLinks];

  if (!rows.length) {
    _mlRenderSharedTable(() => {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${Math.max(1, _mlVisibleCols().length)}">${q ? 'No matches.' : 'No links yet — click + Add link'}</td></tr>`;
    });
    return;
  }

  // Sort
  rows = view?.sorter ? view.sorter.sortRows(rows, _mlGetSortVal) : rows;

  // Row HTML builder
  function rowHtml(lnk) {
    return `<tr>${_mlVisibleCols().map(col => _ML_TABLE_FIELD_META[col].render(lnk)).join('')}</tr>`;
  }

  if (_mlGroupBy === 'none') {
    _mlRenderSharedTable(() => {
      tbody.innerHTML = rows.map(rowHtml).join('');
    });
    return;
  }

  // Grouped rendering
  const keys = [];
  const map  = {};
  rows.forEach(lnk => {
    const k = _mlGroupKey(lnk);
    if (!map[k]) { map[k] = []; keys.push(k); }
    map[k].push(lnk);
  });

  let html = '';
  keys.forEach(k => {
    const collapsed = _mlCollapsed.has(k);
    html += `<tr class="ml-group-hdr" data-gkey="${esc(k)}">
      <td colspan="${Math.max(1, _mlVisibleCols().length)}"><span class="table-row-toggle-icon${collapsed ? '' : ' is-open'}" aria-hidden="true"></span>${esc(k)} <span style="font-weight:400;opacity:.6">(${map[k].length})</span></td>
    </tr>`;
    if (!collapsed) html += map[k].map(rowHtml).join('');
  });
  _mlRenderSharedTable(() => {
    tbody.innerHTML = html;
  });
}

/* ── Table helpers: sort / filter / group ────────────────────────────────── */

function mlSetGroupBy(by) {
  _mlGroupBy = by;
  _mlCollapsed.clear();
  renderManualLinksTable();
}

function mlToggleGroup(key) {
  if (_mlCollapsed.has(key)) _mlCollapsed.delete(key);
  else _mlCollapsed.add(key);
  renderManualLinksTable();
}

function _mlGetSortVal(lnk, col) {
  switch (col) {
    case 'label': return (lnk.label || '').toLowerCase();
    case 'addr':  return (lnk.vlan_uri || lnk.vlan_ip || lnk.tailnet_uri || lnk.tailnet_ip || '').toLowerCase();
    case 'group': return (lnk.group_name || '').toLowerCase();
    case 'order': return lnk.sort_order ?? 0;
    case 'host':  return (lnk.pve_host || lnk.vm_name || lnk.lxc_name || lnk.location || '').toLowerCase();
    case 'notes': return (lnk.notes || '').toLowerCase();
    default: return '';
  }
}

function _mlGroupKey(lnk) {
  if (_mlGroupBy === 'group') return lnk.group_name || '(no group)';
  if (_mlGroupBy === 'host')  return lnk.pve_host || lnk.vm_name || lnk.lxc_name || lnk.location || '(no host)';
  return '';
}

/* ── Rendered view ───────────────────────────────────────────────────────── */

function renderManualLinksRendered() {
  const container = document.getElementById('ml-rendered-body');
  if (!container) return;
  if (!_manualLinks.length) {
    container.innerHTML = '<p style="color:var(--text-dim);font-size:13px">No links defined yet.</p>';
    return;
  }

  // Separate top-level from children
  const topLevel  = _manualLinks.filter(l => !l.parent_id);
  const childMap  = {};
  _manualLinks.filter(l => l.parent_id).forEach(l => {
    if (!childMap[l.parent_id]) childMap[l.parent_id] = [];
    childMap[l.parent_id].push(l);
  });

  // Group top-level items
  const groups = {};
  const ungrouped = [];
  topLevel.forEach(l => {
    if (l.group_name) {
      if (!groups[l.group_name]) groups[l.group_name] = [];
      groups[l.group_name].push(l);
    } else {
      ungrouped.push(l);
    }
  });

  const sortByOrder = arr =>
    [...arr].sort((a, b) => (a.sort_order - b.sort_order) || (a.label || '').localeCompare(b.label || ''));

  function renderLink(lnk) {
    const icon = lnk.icon ? _mlIconHtml(lnk.icon, 'ml-inline-icon') : '';
    const labelHtml = lnk.label ? `<span style="font-weight:600">${icon}${esc(lnk.label)}</span>` : `${icon}<span style="color:var(--text-dim);font-style:italic">untitled</span>`;

    // Tooltip detail rows shared by all address chips on this item
    const sharedRows = [];
    if (lnk.pve_host)    sharedRows.push(`<div class="ml-tip-row"><span class="ml-tip-lbl">PVE host</span><span>${esc(lnk.pve_host)}</span></div>`);
    if (lnk.is_internet) sharedRows.push(`<div class="ml-tip-row"><span class="ml-tip-lbl">Network</span><span>internet</span></div>`);
    if (lnk.vm_id)       sharedRows.push(`<div class="ml-tip-row"><span class="ml-tip-lbl">VM</span><span>${esc(lnk.vm_id)}${lnk.vm_name ? ` (${esc(lnk.vm_name)})` : ''}</span></div>`);
    if (lnk.lxc_id)      sharedRows.push(`<div class="ml-tip-row"><span class="ml-tip-lbl">LXC</span><span>${esc(lnk.lxc_id)}${lnk.lxc_name ? ` (${esc(lnk.lxc_name)})` : ''}</span></div>`);
    if (lnk.location)    sharedRows.push(`<div class="ml-tip-row"><span class="ml-tip-lbl">Location</span><span>${esc(lnk.location)}</span></div>`);
    if (lnk.notes)       sharedRows.push(`<div class="ml-tip-row" style="max-width:280px"><span class="ml-tip-lbl">Notes</span><span style="white-space:normal">${esc(lnk.notes)}</span></div>`);;

    const mkAnchor = addr => {
      const hasScheme = /^https?:\/\//i.test(addr);
      const href = hasScheme ? addr : `http://${addr}`;
      return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer"
        style="color:var(--accent);text-decoration:none;font-family:monospace;font-size:13px">${esc(addr)}</a>`;
    };

    const mkChip = (primary, tipRows) =>
      `<span class="ml-tip">${mkAnchor(primary)}<div class="ml-tip-body">${tipRows.join('')}</div></span>`;

    const addrChips = [];

    // VLAN — prefer URI; show IP in tooltip if both present
    if (lnk.vlan_uri || lnk.vlan_ip) {
      const primary = lnk.vlan_uri || lnk.vlan_ip;
      const rows = [`<div class="ml-tip-row"><span class="ml-tip-lbl">VLAN</span><span style="font-family:monospace">${esc(primary)}</span></div>`];
      if (lnk.vlan_uri && lnk.vlan_ip)
        rows.push(`<div class="ml-tip-row"><span class="ml-tip-lbl">IP</span><span style="font-family:monospace">${esc(lnk.vlan_ip)}</span></div>`);
      rows.push(...sharedRows);
      addrChips.push(mkChip(primary, rows));
    }

    // Tailnet — prefer URI; show IP in tooltip if both present
    if (lnk.tailnet_uri || lnk.tailnet_ip) {
      const primary = lnk.tailnet_uri || lnk.tailnet_ip;
      const rows = [`<div class="ml-tip-row"><span class="ml-tip-lbl">Tailnet</span><span style="font-family:monospace">${esc(primary)}</span></div>`];
      if (lnk.tailnet_uri && lnk.tailnet_ip)
        rows.push(`<div class="ml-tip-row"><span class="ml-tip-lbl">IP</span><span style="font-family:monospace">${esc(lnk.tailnet_ip)}</span></div>`);
      rows.push(...sharedRows);
      addrChips.push(mkChip(primary, rows));
    }

    const children = sortByOrder(childMap[lnk.link_id] || []);

    return `<li style="margin-bottom:12px;list-style:none">
      <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 16px">
        <span style="min-width:160px">${labelHtml}</span>
        ${addrChips.join('')}
        ${!addrChips.length ? '<span style="color:var(--text-dim);font-size:12px;font-style:italic">no addresses</span>' : ''}
      </div>
      ${children.length ? `<ul style="margin:6px 0 0 16px;padding:0">${children.map(renderLink).join('')}</ul>` : ''}
    </li>`;
  }

  let html = '';
  if (ungrouped.length) {
    html += `<section style="margin-bottom:24px">
      <ul style="margin:0;padding:0">${sortByOrder(ungrouped).map(renderLink).join('')}</ul>
    </section>`;
  }
  Object.keys(groups).sort().forEach(g => {
    html += `<section style="margin-bottom:24px">
      <h3 style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--text-dim);
                 border-bottom:1px solid var(--border);padding-bottom:6px;margin-bottom:10px">${esc(g)}</h3>
      <ul style="margin:0;padding:0">${sortByOrder(groups[g]).map(renderLink).join('')}</ul>
    </section>`;
  });

  container.innerHTML = html;
}

/* ── Tree view (Page 2) ─────────────────────────────────────────────────── */

function _mlHostNode(lnk) {
  if (lnk.pve_host) return `PVE ${lnk.pve_host}`;
  if (lnk.vm_name || lnk.vm_id) return `VM ${lnk.vm_name || lnk.vm_id}`;
  if (lnk.lxc_name || lnk.lxc_id) return `LXC ${lnk.lxc_name || lnk.lxc_id}`;
  if (lnk.location) return `Location ${lnk.location}`;
  if (lnk.is_internet) return 'Internet';
  return 'Unassigned hardware';
}

function _mlPrimaryAddress(lnk) {
  return lnk.vlan_uri || lnk.vlan_ip || lnk.tailnet_uri || lnk.tailnet_ip || '';
}

function _mlLinkChip(lnk) {
  const address = _mlPrimaryAddress(lnk);
  if (!address) return '<span class="ml-tree-chip">No route</span>';
  const href = /^https?:\/\//i.test(address) ? address : `http://${address}`;
  return `<a class="ml-tree-chip" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(address)}</a>`;
}

function renderManualLinksTree() {
  const container = document.getElementById('ml-tree-body');
  if (!container) return;
  if (!_manualLinks.length) {
    container.innerHTML = '<p class="ml-page-empty">No links defined yet.</p>';
    return;
  }

  const roots = _manualLinks.filter(l => !l.parent_id);
  const childrenByParent = {};
  _manualLinks.filter(l => l.parent_id).forEach(l => {
    if (!childrenByParent[l.parent_id]) childrenByParent[l.parent_id] = [];
    childrenByParent[l.parent_id].push(l);
  });

  const buckets = {};
  roots.forEach(lnk => {
    const host = _mlHostNode(lnk);
    if (!buckets[host]) buckets[host] = [];
    buckets[host].push(lnk);
  });

  const orderedHosts = Object.keys(buckets).sort((a, b) => a.localeCompare(b));
  const sortLinks = arr => [...arr].sort((a, b) => (a.sort_order - b.sort_order) || (a.label || '').localeCompare(b.label || ''));

  function renderNode(lnk) {
    const children = sortLinks(childrenByParent[lnk.link_id] || []);
    const title = lnk.label || lnk.link_id.slice(0, 8);
    const subtitle = lnk.group_name ? `<span class="ml-tree-subtitle">${esc(lnk.group_name)}</span>` : '';
    const notes = lnk.notes ? `<div class="ml-tree-notes">${esc(lnk.notes)}</div>` : '';
    return `<li>
      <div class="ml-tree-row">
        <span class="ml-tree-title">${esc(title)}</span>
        ${subtitle}
        ${_mlLinkChip(lnk)}
      </div>
      ${notes}
      ${children.length ? `<ul class="ml-tree-children">${children.map(renderNode).join('')}</ul>` : ''}
    </li>`;
  }

  container.innerHTML = orderedHosts.map(host =>
    `<section class="ml-tree-host-section">
      <h3>${esc(host)}</h3>
      <ul class="ml-tree-root">${sortLinks(buckets[host]).map(renderNode).join('')}</ul>
    </section>`
  ).join('');
}

/* ── Pretext-inspired view (Page 3) ─────────────────────────────────────── */

function renderManualLinksPretext() {
  const container = document.getElementById('ml-pretext-body');
  if (!container) return;
  if (!_manualLinks.length) {
    container.innerHTML = '<p class="ml-page-empty">No links defined yet.</p>';
    return;
  }

  const records = [..._manualLinks].sort((a, b) => {
    const ag = (a.group_name || '').toLowerCase();
    const bg = (b.group_name || '').toLowerCase();
    if (ag !== bg) return ag.localeCompare(bg);
    return (a.sort_order - b.sort_order) || (a.label || '').localeCompare(b.label || '');
  });

  const segments = records.map((lnk, idx) => {
    const name = lnk.label || `Untitled ${idx + 1}`;
    const host = _mlHostNode(lnk);
    const primary = _mlPrimaryAddress(lnk);
    const secondary = [lnk.vlan_ip, lnk.tailnet_ip].filter(Boolean).join(' | ');
    const href = primary ? (/^https?:\/\//i.test(primary) ? primary : `http://${primary}`) : '';
    const chip = primary
      ? `<a class="ml-pretext-route" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(primary)}</a>`
      : '<span class="ml-pretext-route ml-pretext-route--dim">No route</span>';
    const meta = [lnk.group_name || 'no-group', host].join(' · ');
    const notes = lnk.notes ? `<p class="ml-pretext-notes">${esc(lnk.notes)}</p>` : '';
    const trail = secondary ? `<p class="ml-pretext-trail">${esc(secondary)}</p>` : '';
    return `<article class="ml-pretext-card">
      <header>
        <h4>${esc(name)}</h4>
        <p>${esc(meta)}</p>
      </header>
      ${chip}
      ${trail}
      ${notes}
    </article>`;
  }).join('');

  container.innerHTML = `<div class="ml-pretext-grid">${segments}</div>`;
}

/* ── Grid view (Page 4) ─────────────────────────────────────────────────── */

function _mlPrimaryRoute(lnk) {
  return lnk?.vlan_uri || lnk?.vlan_ip || lnk?.tailnet_uri || lnk?.tailnet_ip || '';
}

function _mlHref(addr) {
  if (!addr) return '';
  return /^https?:\/\//i.test(addr) ? addr : `http://${addr}`;
}

function _mlCategoryMaps() {
  const byParent = {};
  const byId = {};
  _manualLinkCategories.forEach(cat => {
    byId[cat.category_id] = cat;
    const parent = cat.parent_category_id || '__root__';
    if (!byParent[parent]) byParent[parent] = [];
    byParent[parent].push(cat);
  });
  return { byParent, byId };
}

function _mlItemsByCategory() {
  const byCategory = {};
  _manualLinkCategoryItems.forEach(item => {
    if (!byCategory[item.category_id]) byCategory[item.category_id] = [];
    byCategory[item.category_id].push(item);
  });
  return byCategory;
}

function _mlLinkTreeForCategory(categoryId, itemsByCategory) {
  const items = (itemsByCategory[categoryId] || []).filter(item => item.link);
  const byMappingId = new Map(items.map(item => [item.mapping_id, item]));
  const byLinkId = new Map(items.map(item => [item.link.link_id, item]));
  const childrenByParent = new Map();
  const roots = [];
  items.forEach(item => {
    const explicitParentId = item.parent_mapping_id;
    const fallbackParent = item.link.parent_id ? byLinkId.get(item.link.parent_id) : null;
    const parentMappingId = explicitParentId && byMappingId.has(explicitParentId)
      ? explicitParentId
      : (fallbackParent ? fallbackParent.mapping_id : null);
    if (parentMappingId) {
      if (!childrenByParent.has(parentMappingId)) childrenByParent.set(parentMappingId, []);
      childrenByParent.get(parentMappingId).push(item);
    } else {
      roots.push(item);
    }
  });
  const sortItems = arr => [...arr].sort((a, b) => {
    const ao = a.link?.sort_order ?? a.sort_order ?? 0;
    const bo = b.link?.sort_order ?? b.sort_order ?? 0;
    if (ao !== bo) return ao - bo;
    return (a.label_override || a.link?.label || '').localeCompare(b.label_override || b.link?.label || '');
  });
  return { roots: sortItems(roots), childrenByParent, sortItems };
}

function _mlSortCategories(cats) {
  return [...cats].sort((a, b) => (a.sort_order - b.sort_order) || (a.label || '').localeCompare(b.label || ''));
}

function _mlSavedGridOrder() {
  try {
    const parsed = JSON.parse(localStorage.getItem(_ML_GRID_ORDER_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function _mlOrderRootCategories(cats) {
  const saved = _mlSavedGridOrder();
  const pos = new Map(saved.map((id, idx) => [id, idx]));
  return _mlSortCategories(cats).sort((a, b) => {
    const ap = pos.has(a.category_id) ? pos.get(a.category_id) : Number.MAX_SAFE_INTEGER;
    const bp = pos.has(b.category_id) ? pos.get(b.category_id) : Number.MAX_SAFE_INTEGER;
    if (ap !== bp) return ap - bp;
    return (a.sort_order - b.sort_order) || (a.label || '').localeCompare(b.label || '');
  });
}

function _mlSaveGridOrderFromDom() {
  const ids = [...document.querySelectorAll('#ml-grid-body .ml-grid-board > [data-ml-grid-card]')]
    .map(card => card.dataset.categoryId)
    .filter(Boolean);
  localStorage.setItem(_ML_GRID_ORDER_KEY, JSON.stringify(ids));
}

function _mlSavedGridLayout() {
  try {
    const parsed = JSON.parse(localStorage.getItem(_ML_GRID_LAYOUT_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const bucket = _mlGridLayoutBucket();
    if (parsed[bucket] && typeof parsed[bucket] === 'object' && !Array.isArray(parsed[bucket])) return parsed[bucket];
    if (!parsed.mobile && !parsed.tablet && !parsed.desktop && bucket === 'desktop') return parsed;
    return {};
  } catch (_) {
    return {};
  }
}

function _mlSaveGridLayout(layout) {
  let store = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(_ML_GRID_LAYOUT_KEY) || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) store = parsed;
  } catch (_) {
    store = {};
  }
  if (!store.mobile && !store.tablet && !store.desktop) {
    store = { desktop: store };
  }
  store[_mlGridLayoutBucket()] = layout || {};
  localStorage.setItem(_ML_GRID_LAYOUT_KEY, JSON.stringify(store));
}

function _mlGridLayoutBucket() {
  const width = (window.visualViewport && Number.isFinite(window.visualViewport.width) && window.visualViewport.width > 0)
    ? window.visualViewport.width
    : (window.innerWidth || document.documentElement.clientWidth || 0);
  if (width <= 760) return 'mobile';
  if (width <= 1180) return 'tablet';
  return 'desktop';
}

function _mlRootGridLayoutFor(categoryId) {
  const layout = _mlSavedGridLayout()[categoryId];
  return layout && typeof layout === 'object' ? layout : {};
}

function _mlPanelCellCount(categoryId) {
  const maps = _mlCategoryMaps();
  const itemsByCategory = _mlItemsByCategory();
  const tree = _mlLinkTreeForCategory(categoryId, itemsByCategory);
  return 1 + _mlSortCategories(maps.byParent[categoryId] || []).length + tree.roots.length;
}

function _mlPanelContentRows(categoryId, cols = 1) {
  const maps = _mlCategoryMaps();
  const itemsByCategory = _mlItemsByCategory();
  const tree = _mlLinkTreeForCategory(categoryId, itemsByCategory);
  const childCount = _mlSortCategories(maps.byParent[categoryId] || []).length;
  const directCount = tree.roots.length;
  const width = Math.max(1, Number(cols) || 1);
  const labelRows = 1;
  const childRows = childCount ? Math.ceil(childCount / width) : 0;
  const directRows = directCount ? directCount : 0;
  const emptyRows = !childCount && !directCount ? 1 : 0;
  return Math.max(1, labelRows + childRows + directRows + emptyRows);
}

function _mlClampGridSpan(value, min, max = 6) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || min)));
}

function _mlGridPlacementStyles(category, shape = { cols: 1, rows: 1 }, { inPanel = false, cells = 1, panelRows = null } = {}) {
  if (inPanel) return [];
  const layout = _mlRootGridLayoutFor(category.category_id);
  const manualSize = layout.manualSize === true || Number.isFinite(Number(layout.w)) || Number.isFinite(Number(layout.h));
  const cols = _mlClampGridSpan(manualSize ? (layout.w || 1) : (layout.w || shape.cols || 1), 1, 6);
  const minRows = _mlCategoryIsPanel(category)
    ? Math.max(1, Number(panelRows) || 0, Math.ceil(Math.max(1, cells) / cols))
    : 1;
  const rows = _mlClampGridSpan(manualSize ? Math.max(layout.h || 1, minRows) : (layout.h || shape.rows || minRows), minRows, 12);
  const styles = [];
  if (cols > 1) styles.push(`grid-column:span ${cols}`);
  if (rows > 1) styles.push(`grid-row:span ${rows}`);
  return styles;
}

function _mlStyleAttr(styles) {
  return styles.length ? ` style="${styles.join(';')}"` : '';
}

function _mlRootLayoutSlot(categoryId, fallbackIndex) {
  const layout = _mlRootGridLayoutFor(categoryId);
  if (Number.isFinite(Number(layout.slot))) return Math.max(0, Math.round(Number(layout.slot)));
  if (Number.isFinite(Number(layout.col)) && Number.isFinite(Number(layout.row))) {
    return Math.max(0, ((Math.round(Number(layout.row)) - 1) * 6) + (Math.round(Number(layout.col)) - 1));
  }
  return fallbackIndex;
}

function _mlRenderRootGridChildren(roots, renderRoot) {
  const slotted = roots
    .map((cat, index) => ({ cat, index, slot: _mlRootLayoutSlot(cat.category_id, index) }))
    .sort((a, b) => (a.slot - b.slot) || (a.index - b.index));
  const usedSlots = new Set();
  const parts = [];
  let cursor = 0;
  slotted.forEach(item => {
    const slot = Math.max(cursor, item.slot);
    while (cursor < slot) {
      parts.push(`<i class="ml-grid-placeholder" aria-hidden="true" data-ml-grid-placeholder="${cursor}"></i>`);
      cursor += 1;
    }
    parts.push(renderRoot(item.cat));
    usedSlots.add(slot);
    cursor = slot + 1;
  });
  return parts.join('');
}

function _mlCategoryPath(categoryId) {
  const { byId } = _mlCategoryMaps();
  const parts = [];
  const seen = new Set();
  let current = byId[categoryId];
  while (current && !seen.has(current.category_id)) {
    seen.add(current.category_id);
    parts.unshift(current.label);
    current = current.parent_category_id ? byId[current.parent_category_id] : null;
  }
  return parts.join(' / ');
}

function _mlCategoryIcon(category) {
  return category?.icon || _ML_DEFAULT_ICON;
}

function _mlLinkIcon(link) {
  return link?.icon || _ML_DEFAULT_ICON;
}

function _mlCategoryIsPanel(category) {
  return Number(category?.show_panel || 0) === 1;
}

function _mlCssString(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '');
}

function _mlPanelGridShape(cellCount) {
  const total = Math.max(1, Number(cellCount) || 1);
  const rows = Math.max(1, Math.ceil(Math.sqrt(total)));
  const cols = Math.max(1, Math.ceil(total / rows));
  return { cols: Math.min(6, cols), rows };
}

function _mlPanelStyle(category, shape = null, extraStyles = []) {
  const styles = [];
  if (shape?.cols) styles.push(`--ml-panel-cols:${Math.max(1, Math.min(6, shape.cols))}`);
  if (shape?.rows) styles.push(`--ml-panel-rows:${Math.max(1, shape.rows)}`);
  const color = (category?.panel_color || '').trim();
  const background = (category?.panel_background || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    styles.push(`--ml-panel-accent:${esc(color)}`);
  }
  if (background) {
    const src = background.startsWith('icons/') ? `/fallback-ui/assets/${background}` : background;
    styles.push(`--ml-panel-bg:url("${_mlCssString(src)}")`);
  }
  return _mlStyleAttr([...styles, ...extraStyles]);
}

function _mlCategoryDescendsFrom(categoryId, possibleAncestorId) {
  const { byId } = _mlCategoryMaps();
  const seen = new Set();
  let current = byId[categoryId];
  while (current?.parent_category_id && !seen.has(current.category_id)) {
    seen.add(current.category_id);
    if (current.parent_category_id === possibleAncestorId) return true;
    current = byId[current.parent_category_id];
  }
  return false;
}

function _mlUniqueCategoryLabel(label, parentCategoryId, categoryId) {
  const base = (label || 'Category').trim();
  const siblings = _manualLinkCategories.filter(cat =>
    cat.category_id !== categoryId &&
    (cat.parent_category_id || '') === (parentCategoryId || '')
  );
  if (!siblings.some(cat => (cat.label || '').trim().toLowerCase() === base.toLowerCase())) return base;
  let n = 2;
  let candidate = `${base} (${n})`;
  while (siblings.some(cat => (cat.label || '').trim().toLowerCase() === candidate.toLowerCase())) {
    n += 1;
    candidate = `${base} (${n})`;
  }
  return candidate;
}

async function _mlUpdateCategory(categoryId, patch, { reopenManage = false } = {}) {
  const r = await apiFetch(`/api/v1/manual-link-categories/${encodeURIComponent(categoryId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
  await loadManualLinks();
  if (reopenManage && _mlManagingCategoryId) _mlOpenCategoryManage(_mlManagingCategoryId);
}

async function _mlMoveCategory(categoryId, parentCategoryId) {
  const category = _manualLinkCategories.find(cat => cat.category_id === categoryId);
  if (!category) return;
  const nextParent = parentCategoryId || null;
  if (nextParent === categoryId || (nextParent && _mlCategoryDescendsFrom(nextParent, categoryId))) {
    throw new Error('Cannot move a category into itself or one of its children.');
  }
  const patch = { parent_category_id: nextParent };
  const uniqueLabel = _mlUniqueCategoryLabel(category.label, nextParent, categoryId);
  if (uniqueLabel !== category.label) patch.label = uniqueLabel;
  await _mlUpdateCategory(categoryId, patch);
}

function _mlNextCategorySort(parentCategoryId = null) {
  const siblings = _manualLinkCategories.filter(cat => (cat.parent_category_id || '') === (parentCategoryId || ''));
  return siblings.length ? Math.max(...siblings.map(cat => Number(cat.sort_order || 0))) + 1 : 0;
}

async function _mlCreateCategoryFromMapping(mapping, parentCategoryId = null) {
  const label = mapping?.label_override || mapping?.link?.label || 'Category';
  const r = await apiFetch('/api/v1/manual-link-categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      label: _mlUniqueCategoryLabel(label, parentCategoryId || null, null),
      icon: _mlLinkIcon(mapping?.link),
      parent_category_id: parentCategoryId || null,
      sort_order: _mlNextCategorySort(parentCategoryId || null),
      show_panel: 0,
      notes: `Promoted from Manual Links placement ${mapping?.mapping_id || ''}`.trim(),
    }),
  });
  if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
  return r.json();
}

async function _mlPromoteOrMoveMapping(mappingId, parentCategoryId = null) {
  const source = _manualLinkCategoryItems.find(item => item.mapping_id === mappingId);
  if (!source) throw new Error(`mapping ${mappingId} not found`);
  const itemsByCategory = _mlItemsByCategory();
  const tree = _mlLinkTreeForCategory(source.category_id, itemsByCategory);
  const children = tree.sortItems(tree.childrenByParent.get(mappingId) || []);
  const hasPrimaryRoute = !!_mlPrimaryRoute(source.link);

  async function moveSubtree(item, nextCategoryId, nextParentMappingId) {
    const r = await apiFetch(`/api/v1/manual-link-categories/items/${encodeURIComponent(item.mapping_id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_id: nextCategoryId, parent_mapping_id: nextParentMappingId }),
    });
    if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
    const branchChildren = tree.sortItems(tree.childrenByParent.get(item.mapping_id) || []);
    for (const child of branchChildren) {
      await moveSubtree(child, nextCategoryId, item.mapping_id);
    }
  }

  if (children.length && !hasPrimaryRoute) {
    const category = await _mlCreateCategoryFromMapping(source, parentCategoryId || null);
    for (const child of children) {
      await moveSubtree(child, category.category_id, null);
    }
    const del = await apiFetch(`/api/v1/manual-link-categories/items/${encodeURIComponent(mappingId)}`, { method: 'DELETE' });
    if (!del.ok) throw new Error((await del.json()).detail || `HTTP ${del.status}`);
    await loadManualLinks();
    return;
  }

  if (parentCategoryId) {
    await _mlMoveCategoryItem(mappingId, parentCategoryId, null);
    return;
  }

  const category = await _mlCreateCategoryFromMapping(source, null);
  await moveSubtree(source, category.category_id, null);
  await loadManualLinks();
}

function _mlCategoryDestinationPickerHtml(sourceCategoryId) {
  const maps = _mlCategoryMaps();
  const renderCategory = (cat, depth) => {
    if (depth > 12) return '';
    const label = cat.label || cat.category_id.slice(0, 8);
    const disabled = cat.category_id === sourceCategoryId || _mlCategoryDescendsFrom(cat.category_id, sourceCategoryId)
      ? ' disabled aria-disabled="true"'
      : '';
    const choice = `<button class="ml-dest-choice" type="button" data-ml-category-dest-choice="${esc(cat.category_id)}" data-ml-category-dest-label="${esc(_mlCategoryPath(cat.category_id) || label)}"${disabled}>
      ${_mlIconHtml(_mlCategoryIcon(cat), 'ml-grid-icon ml-grid-icon--small')}<span>${esc(label)}</span>
    </button>`;
    const children = _mlSortCategories(maps.byParent[cat.category_id] || []);
    if (!children.length) return `<div class="ml-dest-leaf">${choice}</div>`;
    return `<details class="ml-dest-node">
      <summary>${_mlIconHtml(_mlCategoryIcon(cat), 'ml-grid-icon ml-grid-icon--small')}<span>${esc(label)}</span></summary>
      <div class="ml-dest-node-body">
        ${choice}
        ${children.map(child => renderCategory(child, depth + 1)).join('')}
      </div>
    </details>`;
  };
  const roots = _mlSortCategories(maps.byParent.__root__ || []);
  return `<div class="ml-dest-picker" data-ml-category-dest-panel="${esc(sourceCategoryId)}" hidden>
    <button class="ml-dest-choice" type="button" data-ml-category-dest-choice="" data-ml-category-dest-label="Top categories">
      ${_mlIconHtml(_ML_DEFAULT_ICON, 'ml-grid-icon ml-grid-icon--small')}<span>Top categories</span>
    </button>
    ${roots.map(cat => renderCategory(cat, 1)).join('') || '<p class="ml-page-empty">No destination categories.</p>'}
  </div>`;
}

function _mlDestinationPickerHtml(mappingId) {
  const maps = _mlCategoryMaps();
  const itemsByCategory = _mlItemsByCategory();
  const labelForItem = item => item.label_override || item.link?.label || item.link_id;
  const renderPosition = (category, item, tree, depth) => {
    if (!item?.link || depth > 12) return '';
    const children = tree.sortItems(tree.childrenByParent.get(item.mapping_id) || []);
    const label = labelForItem(item);
    const path = `${_mlCategoryPath(category.category_id) || category.label} / ${label}`;
    const disabled = item.mapping_id === mappingId ? ' disabled aria-disabled="true"' : '';
    const choice = `<button class="ml-dest-choice" type="button" data-ml-dest-choice="${esc(category.category_id)}" data-ml-dest-parent="${esc(item.mapping_id)}" data-ml-dest-label="${esc(path)}"${disabled}>
      ${_mlIconHtml(_mlLinkIcon(item.link), 'ml-grid-icon ml-grid-icon--small')}<span>Under ${esc(label)}</span>
    </button>`;
    if (!children.length) return `<div class="ml-dest-leaf">${choice}</div>`;
    return `<details class="ml-dest-node">
      <summary>${_mlIconHtml(_mlLinkIcon(item.link), 'ml-grid-icon ml-grid-icon--small')}<span>${esc(label)}</span></summary>
      <div class="ml-dest-node-body">
        ${choice}
        ${children.map(child => renderPosition(category, child, tree, depth + 1)).join('')}
      </div>
    </details>`;
  };
  const renderCategory = (cat, depth) => {
    if (depth > 12) return '';
    const children = _mlSortCategories(maps.byParent[cat.category_id] || []);
    const label = cat.label || cat.category_id.slice(0, 8);
    const tree = _mlLinkTreeForCategory(cat.category_id, itemsByCategory);
    const choice = `<button class="ml-dest-choice" type="button" data-ml-dest-choice="${esc(cat.category_id)}" data-ml-dest-parent="" data-ml-dest-label="${esc(_mlCategoryPath(cat.category_id) || label)}">
      ${_mlIconHtml(_mlCategoryIcon(cat), 'ml-grid-icon ml-grid-icon--small')}<span>Category root</span>
    </button>`;
    const body = [
      choice,
      ...tree.roots.map(item => renderPosition(cat, item, tree, depth + 1)),
      ...children.map(child => renderCategory(child, depth + 1)),
    ].join('');
    if (!children.length && !tree.roots.length) return `<div class="ml-dest-leaf">${choice}</div>`;
    return `<details class="ml-dest-node">
      <summary>${_mlIconHtml(_mlCategoryIcon(cat), 'ml-grid-icon ml-grid-icon--small')}<span>${esc(label)}</span></summary>
      <div class="ml-dest-node-body">${body}</div>
    </details>`;
  };
  const roots = _mlSortCategories(maps.byParent.__root__ || []);
  return `<div class="ml-dest-picker" data-ml-dest-panel="${esc(mappingId)}" hidden>
    ${roots.map(cat => renderCategory(cat, 1)).join('') || '<p class="ml-page-empty">No destination categories.</p>'}
  </div>`;
}

function _mlIconHtml(icon, className = 'ml-grid-icon') {
  const value = icon || _ML_DEFAULT_ICON;
  if (typeof value === 'string' && (/^(data:image\/|icons\/|\/|https?:\/\/)/i.test(value) || /\.svg($|\?)/i.test(value))) {
    const src = value.startsWith('icons/') ? `/fallback-ui/assets/${value}` : value;
    return `<img class="${esc(className)}" src="${esc(src)}" alt="" aria-hidden="true" />`;
  }
  return `<span class="${esc(className)}" aria-hidden="true">${esc(value)}</span>`;
}

function _mlRenderLinkMenuItem(item) {
  const lnk = item.link;
  if (!lnk) return '';
  const label = item.label_override || lnk.label || lnk.link_id.slice(0, 8);
  const route = _mlPrimaryRoute(lnk);
  const href = _mlHref(route);
  const expanded = _mlExpandedRoutes.has(item.mapping_id);
  const routeHtml = expanded
    ? (route ? `<span class="ml-grid-link-route">${esc(route)}</span>` : '<span class="ml-grid-link-route ml-grid-link-route--empty">No route</span>')
    : '';
  const attrs = `data-ml-grid-link="${esc(lnk.link_id)}" data-ml-grid-mapping="${esc(item.mapping_id)}" data-ml-grid-mapping-drag="${esc(item.mapping_id)}" data-ml-grid-href="${esc(href)}"`;
  return `<button type="button" class="ml-grid-link${expanded ? ' is-route-open' : ''}" draggable="true" ${attrs} title="Click to open, double-click to show route, long-press for alternatives">
    <span class="ml-grid-link-label">${esc(label)}</span>${routeHtml}
  </button>`;
}

function _mlRenderLinkTreeItem(item, tree, depth) {
  if (depth > 12) return '';
  const lnk = item.link;
  const children = tree.sortItems(tree.childrenByParent.get(item.mapping_id) || []);
  if (!children.length) return _mlRenderLinkMenuItem(item);
  const label = item.label_override || lnk.label || lnk.link_id.slice(0, 8);
  const open = _mlGridOpenLinkBranches.has(item.mapping_id) ? ' open' : '';
  return `<details class="ml-grid-subcategory ml-grid-link-branch" data-ml-grid-mapping="${esc(item.mapping_id)}"${open}>
    <summary draggable="true" data-ml-grid-mapping-drag="${esc(item.mapping_id)}">${_mlIconHtml(_mlLinkIcon(lnk), 'ml-grid-icon ml-grid-icon--small')}<span class="ml-grid-summary-label">${esc(label)}</span></summary>
    <div class="ml-grid-subcategory-body">${children.map(child => _mlRenderLinkTreeItem(child, tree, depth + 1)).join('')}</div>
  </details>`;
}

function _mlRenderCategoryMenu(category, depth, maps, itemsByCategory) {
  if (depth > 12) return '';
  const children = _mlSortCategories(maps.byParent[category.category_id] || []);
  const tree = _mlLinkTreeForCategory(category.category_id, itemsByCategory);
  const body = [
    ...tree.roots.map(item => _mlRenderLinkTreeItem(item, tree, depth + 1)),
    ...children.map(child => _mlRenderCategoryMenu(child, depth + 1, maps, itemsByCategory)),
  ].filter(Boolean).join('');
  if (depth === 1) return body || '<p class="ml-grid-empty">No links mapped yet.</p>';
  return `<details class="ml-grid-subcategory" data-ml-drop-zone data-ml-drop-parent="${esc(category.category_id)}">
    <summary>${_mlIconHtml(_mlCategoryIcon(category), 'ml-grid-icon ml-grid-icon--small')}${esc(category.label)}</summary>
    <div class="ml-grid-subcategory-body" data-ml-drop-zone data-ml-drop-parent="${esc(category.category_id)}">${body || '<span class="ml-grid-empty">Empty</span>'}</div>
  </details>`;
}

function renderManualLinksGrid() {
  const container = document.getElementById('ml-grid-body');
  if (!container) return;
  _mlCurrentGridLayoutBucket = _mlGridLayoutBucket();
  if (!_manualLinkCategories.length) {
    container.innerHTML = '<p class="ml-page-empty">No categories defined yet.</p>';
    return;
  }

  const maps = _mlCategoryMaps();
  const itemsByCategory = _mlItemsByCategory();
  const roots = _mlOrderRootCategories(maps.byParent.__root__ || []);
  const renderCard = (cat, { inPanel = false } = {}) => {
    const open = _mlGridOpen.has(cat.category_id);
    const placement = _mlGridPlacementStyles(cat, { cols: 1, rows: 1 }, { inPanel });
    return `<article class="ml-grid-card${open ? ' is-open' : ''}${inPanel ? ' ml-grid-card--in-panel' : ''}" data-ml-grid-card data-category-id="${esc(cat.category_id)}" draggable="true"${_mlStyleAttr(placement)}>
      <div class="ml-grid-card-head">
        <button class="ml-grid-card-label" type="button" data-ml-grid-toggle="${esc(cat.category_id)}">
          ${_mlIconHtml(_mlCategoryIcon(cat), 'ml-grid-card-icon')}
          <span class="ml-grid-card-title">${esc(cat.label)}</span>
        </button>
        <button class="ml-grid-manage" type="button" title="Manage category" aria-label="Manage category" data-ml-grid-manage="${esc(cat.category_id)}">${_mlIconHtml(HIEROGLYPHS.kheper, 'ml-grid-manage-icon')}</button>
      </div>
      <div class="ml-grid-menu" data-ml-drop-zone data-ml-drop-parent="${esc(cat.category_id)}" ${open ? '' : 'hidden'}>
        ${_mlRenderCategoryMenu(cat, 1, maps, itemsByCategory)}
      </div>
    </article>`;
  };
  const renderPanel = (cat) => {
    const children = _mlSortCategories(maps.byParent[cat.category_id] || []);
    const tree = _mlLinkTreeForCategory(cat.category_id, itemsByCategory);
    const directLinks = tree.roots.map(item => _mlRenderLinkTreeItem(item, tree, 1)).join('');
    const cellCount = _mlPanelCellCount(cat.category_id);
    const saved = _mlRootGridLayoutFor(cat.category_id);
    const manualSize = saved.manualSize === true || Number.isFinite(Number(saved.w)) || Number.isFinite(Number(saved.h));
    const defaultShape = _mlPanelGridShape(cellCount);
    const cols = _mlClampGridSpan(manualSize ? (saved.w || 1) : (saved.w || defaultShape.cols), 1, 6);
    const minRows = _mlPanelContentRows(cat.category_id, cols);
    const shape = {
      cols,
      rows: _mlClampGridSpan(
        manualSize ? Math.max(saved.h || 1, minRows) : (saved.h || Math.max(defaultShape.rows, minRows)),
        minRows,
        12
      ),
    };
    const placement = _mlGridPlacementStyles(cat, shape, { cells: cellCount, panelRows: minRows });
    return `<section class="ml-grid-panel ml-grid-panel--cols-${shape.cols}" data-ml-grid-card data-ml-grid-panel data-category-id="${esc(cat.category_id)}" data-ml-panel-cells="${esc(cellCount)}" data-ml-panel-min-rows="${esc(minRows)}"${_mlPanelStyle(cat, shape, placement)}>
      <div class="ml-grid-panel-body" data-ml-drop-zone data-ml-drop-parent="${esc(cat.category_id)}">
        <div class="ml-grid-panel-label-cell">
          <div class="ml-grid-panel-title" draggable="true" data-ml-panel-drag-handle>
            ${_mlIconHtml(_mlCategoryIcon(cat), 'ml-grid-card-icon')}
            <span>${esc(cat.label)}</span>
          </div>
          <button class="ml-grid-manage" type="button" title="Manage category" aria-label="Manage category" data-ml-grid-manage="${esc(cat.category_id)}">${_mlIconHtml(HIEROGLYPHS.kheper, 'ml-grid-manage-icon')}</button>
        </div>
        ${children.map(child => renderCard(child, { inPanel: true })).join('')}
        ${directLinks ? `<div class="ml-grid-panel-direct">${directLinks}</div>` : ''}
        ${!children.length && !directLinks ? '<p class="ml-grid-empty">Empty panel</p>' : ''}
      </div>
      <span class="ml-panel-resize ml-panel-resize--nw" data-ml-panel-resize="nw" aria-hidden="true"></span>
      <span class="ml-panel-resize ml-panel-resize--ne" data-ml-panel-resize="ne" aria-hidden="true"></span>
      <span class="ml-panel-resize ml-panel-resize--sw" data-ml-panel-resize="sw" aria-hidden="true"></span>
      <span class="ml-panel-resize ml-panel-resize--se" data-ml-panel-resize="se" aria-hidden="true"></span>
    </section>`;
  };
  container.innerHTML = `<div class="ml-grid-board" data-ml-drop-zone data-ml-drop-parent="">
    ${_mlRenderRootGridChildren(roots, cat => _mlCategoryIsPanel(cat) ? renderPanel(cat) : renderCard(cat))}
  </div>`;
  _mlApplyExplicitRootGridPlacements();
  _mlScheduleGridViewportFit();
  _mlAlignOpenGridMenus();
}

function _mlScheduleGridViewportFit() {
  window.requestAnimationFrame(_mlApplyExplicitRootGridPlacements);
  window.requestAnimationFrame(_mlFitGridViewport);
  window.requestAnimationFrame(_mlAlignOpenGridMenus);
  window.requestAnimationFrame(_mlApplyGridDebugState);
  window.setTimeout(_mlApplyExplicitRootGridPlacements, 120);
  window.setTimeout(_mlFitGridViewport, 120);
  window.setTimeout(_mlAlignOpenGridMenus, 120);
  window.setTimeout(_mlApplyGridDebugState, 120);
  window.setTimeout(_mlApplyExplicitRootGridPlacements, 320);
  window.setTimeout(_mlFitGridViewport, 320);
  window.setTimeout(_mlAlignOpenGridMenus, 320);
  window.setTimeout(_mlApplyGridDebugState, 320);
}

function _mlHandleGridViewportChange() {
  if (_manualLinksView === 'grid') {
    const bucket = _mlGridLayoutBucket();
    if (_mlCurrentGridLayoutBucket && bucket !== _mlCurrentGridLayoutBucket) {
      renderManualLinksGrid();
      return;
    }
  }
  _mlScheduleGridViewportFit();
}

function _mlFitGridViewport() {
  const shell = document.querySelector('#ml-grid-view .ml-page-shell--grid');
  if (!shell || document.getElementById('ml-grid-view')?.style.display === 'none') return;
  const viewportH = (window.visualViewport && Number.isFinite(window.visualViewport.height) && window.visualViewport.height > 0)
    ? window.visualViewport.height
    : (window.innerHeight || document.documentElement.clientHeight || 0);
  if (!viewportH) return;
  const rect = shell.getBoundingClientRect();
  const bottomPad = document.body.classList.contains('shade-is-up') ? 4 : 16;
  const h = Math.max(160, Math.floor(viewportH - rect.top - bottomPad));
  shell.style.setProperty('--ml-grid-height', `${h}px`);
}

function _mlAlignOpenGridMenus() {
  if (document.getElementById('ml-grid-view')?.style.display === 'none') return;
  const board = document.querySelector('#ml-grid-body .ml-grid-board');
  if (!board) return;
  const cards = [...board.querySelectorAll('[data-ml-grid-card]')];
  cards.forEach(card => card.classList.remove('ml-grid-card--align-right', 'ml-grid-card--align-center'));
  const lefts = [];
  cards.forEach(card => {
    const rect = card.getBoundingClientRect();
    if (rect.width <= 0) return;
    if (!lefts.some(left => Math.abs(left - rect.left) < 8)) lefts.push(rect.left);
  });
  lefts.sort((a, b) => a - b);
  cards.forEach(card => {
    const rect = card.getBoundingClientRect();
    if (!card.classList.contains('is-open') || rect.width <= 0) return;
    const colIndex = lefts.reduce((best, left, idx) => (
      Math.abs(left - rect.left) < Math.abs(lefts[best] - rect.left) ? idx : best
    ), 0);
    if (lefts.length === 1) {
      card.classList.add('ml-grid-card--align-center');
    } else if (lefts.length === 2) {
      if (colIndex === 1) card.classList.add('ml-grid-card--align-right');
    } else if (colIndex >= lefts.length - 2) {
      card.classList.add('ml-grid-card--align-right');
    }
  });
}

function _mlPositionDestinationPicker(trigger, panel) {
  if (!trigger || !panel || panel.hidden) return;
  const viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportH = (window.visualViewport && window.visualViewport.height) || window.innerHeight || document.documentElement.clientHeight || 0;
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(360, Math.max(240, viewportW - 24));
  const left = Math.max(12, Math.min(rect.right - width, viewportW - width - 12));
  const below = viewportH - rect.bottom - 12;
  const above = rect.top - 12;
  const openAbove = below < 220 && above > below;
  const maxHeight = Math.max(160, Math.min(460, (openAbove ? above : below) - 6));
  panel.classList.add('is-fixed');
  panel.style.width = `${Math.round(width)}px`;
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = openAbove
    ? `${Math.max(12, Math.round(rect.top - maxHeight - 6))}px`
    : `${Math.round(rect.bottom + 6)}px`;
  panel.style.maxHeight = `${Math.round(maxHeight)}px`;
}

function _mlInstallShadeViewportBinding() {
  if (_mlShadeViewportObserver) return;
  const schedule = () => {
    if (_manualLinksView !== 'grid') return;
    _mlScheduleGridViewportFit();
  };
  document.addEventListener('bodyshadechange', schedule);
  const shade = document.getElementById('body-shade');
  if (shade && window.MutationObserver) {
    _mlShadeViewportObserver = new MutationObserver(schedule);
    _mlShadeViewportObserver.observe(shade, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
  } else {
    _mlShadeViewportObserver = { disconnect() {} };
  }
}

const _mlGridInteractionFsm = (() => {
  let state = _ML_GRID_INTERACTION_STATES.IDLE;
  let pending = null;
  let suppressClickUntil = 0;
  let desktopPress = null;
  let lastRouteToggle = null;

  const clearPending = () => {
    if (pending?.timer) window.clearTimeout(pending.timer);
    pending = null;
  };

  const clearDesktopPress = () => {
    if (desktopPress?.timer) window.clearTimeout(desktopPress.timer);
    desktopPress = null;
    if (state === _ML_GRID_INTERACTION_STATES.PRESSING) state = _ML_GRID_INTERACTION_STATES.IDLE;
  };

  const toggleRoute = input => {
    const mappingId = input?.mappingId || '';
    if (!mappingId) return;
    const isDuplicateBrowserFollowup = input.source === 'dblclick' &&
      lastRouteToggle?.mappingId === mappingId &&
      lastRouteToggle.source !== 'dblclick' &&
      input.now - lastRouteToggle.at < 650;
    if (isDuplicateBrowserFollowup) return;
    _mlRememberOpenLinkBranches();
    if (_mlExpandedRoutes.has(mappingId)) _mlExpandedRoutes.delete(mappingId);
    else _mlExpandedRoutes.add(mappingId);
    lastRouteToggle = { mappingId, source: input.source, at: input.now };
    renderManualLinksGrid();
  };

  const startPending = input => {
    clearPending();
    pending = {
      mappingId: input.mappingId,
      href: input.href,
      ignoreClickUntil: input.source === 'pointer' ? input.now + 280 : 0,
      timer: window.setTimeout(() => dispatch('timeout'), _ML_LEAF_DOUBLE_TAP_MS),
    };
  };

  const isSyntheticClickEcho = input => (
    input.source === 'click' &&
    pending?.mappingId === input.mappingId &&
    pending.ignoreClickUntil &&
    input.now <= pending.ignoreClickUntil
  );

  const actions = {
    startPending,
    replacePending: startPending,
    clearPending,
    toggleRoute,
    openPending: () => {
      const href = pending?.href || '';
      if (href) window.open(href, '_blank', 'noopener,noreferrer');
    },
  };

  function dispatch(eventName, button = null, detail = {}) {
    if (eventName === 'suppressClick') {
      suppressClickUntil = Date.now() + 450;
      return;
    }
    const input = {
      source: detail.source || eventName,
      now: Date.now(),
      mappingId: button?.dataset?.mlGridMapping || pending?.mappingId || '',
      href: button?.dataset?.mlGridHref || pending?.href || '',
    };
    if (eventName === 'click' && Number(detail.clickDetail || 1) > 1) return;
    if (eventName === 'click' && isSyntheticClickEcho(input)) return;
    if ((eventName === 'tap' || eventName === 'click') && !input.mappingId) return;
    const classified = eventName === 'click' || eventName === 'tap'
      ? (state === _ML_GRID_INTERACTION_STATES.LINK_PENDING && pending?.mappingId === input.mappingId ? 'tapSame' : 'tapOther')
      : eventName;
    const transition = _ML_GRID_INTERACTION_TRANSITIONS[state]?.[classified];
    if (!transition) return;
    state = transition.next;
    transition.actions.forEach(action => actions[action]?.(input));
  }

  return {
    dispatch,
    getState: () => state,
    pointerDown(event) {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') {
        _mlStartTouchCategoryDrag(event);
        return;
      }
      const link = event.target.closest('[data-ml-grid-link]');
      if (!link) return;
      clearDesktopPress();
      state = _ML_GRID_INTERACTION_TRANSITIONS[state]?.press?.next || _ML_GRID_INTERACTION_STATES.PRESSING;
      desktopPress = {
        linkId: link.dataset.mlGridLink,
        mappingId: link.dataset.mlGridMapping || null,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        timer: window.setTimeout(() => {
          const linkId = desktopPress?.linkId;
          const mappingId = desktopPress?.mappingId;
          dispatch('cancel');
          clearDesktopPress();
          if (linkId) _mlOpenLinkDetail(linkId, mappingId);
        }, 560),
      };
    },
    pointerMove(event) {
      if (_mlGridInteractionActive?.pointerId === event.pointerId) {
        _mlMoveTouchCategoryDrag(event);
        return;
      }
      if (!desktopPress || desktopPress.pointerId !== event.pointerId) return;
      if (Math.abs(event.clientX - desktopPress.x) > 10 || Math.abs(event.clientY - desktopPress.y) > 10) clearDesktopPress();
    },
    pointerUp(event) {
      if (_mlGridInteractionActive?.pointerId === event.pointerId) {
        void _mlFinishTouchCategoryDrag(event);
        return;
      }
      if (!desktopPress || desktopPress.pointerId !== event.pointerId) return;
      clearDesktopPress();
    },
    pointerCancel(event) {
      if (_mlGridInteractionActive?.pointerId === event.pointerId) {
        void _mlFinishTouchCategoryDrag(event);
        return;
      }
      if (!desktopPress || desktopPress.pointerId !== event.pointerId) return;
      dispatch('cancel');
      clearDesktopPress();
    },
    touchStartFallback(event) {
      _mlStartTouchCategoryDragFallback(event);
    },
    touchMoveFallback(event) {
      _mlMoveTouchCategoryDragFallback(event);
    },
    touchEndFallback(event) {
      _mlFinishTouchCategoryDragFallback(event);
    },
    consumeSyntheticClick(target) {
      if (!suppressClickUntil || Date.now() > suppressClickUntil) return false;
      const handled = target?.closest?.('[data-ml-grid-link], [data-ml-grid-mapping-drag], [data-ml-panel-drag-handle], [data-ml-grid-toggle]');
      if (!handled) return false;
      suppressClickUntil = 0;
      return true;
    },
  };
})();

function _mlHandleLeafClick(button, source = 'click', detail = {}) {
  const eventName = source === 'dblclick' ? 'doubleTap' : (source === 'pointer' ? 'tap' : 'click');
  _mlGridInteractionFsm.dispatch(eventName, button, { ...detail, source });
}

function _mlSuppressLeafClickBriefly() {
  _mlGridInteractionFsm.dispatch('cancel');
}

function _mlSuppressCategoryToggleBriefly() {
  _mlSuppressGridClickBriefly();
}

function _mlSuppressGridClickBriefly() {
  _mlGridInteractionFsm.dispatch('suppressClick');
}

function _mlRevealPanelResizeHandles(panel) {
  if (!panel) return;
  document.querySelectorAll('.ml-grid-panel.is-resize-ready').forEach(openPanel => {
    if (openPanel !== panel) openPanel.classList.remove('is-resize-ready');
  });
  panel.classList.add('is-resize-ready');
  if (_mlPanelResizeRevealTimer) window.clearTimeout(_mlPanelResizeRevealTimer);
  _mlPanelResizeRevealTimer = window.setTimeout(() => {
    panel.classList.remove('is-resize-ready');
    _mlPanelResizeRevealTimer = null;
  }, 5000);
}

function _mlRememberOpenLinkBranches() {
  document.querySelectorAll('#ml-grid-body .ml-grid-link-branch[data-ml-grid-mapping]').forEach(branch => {
    const mappingId = branch.dataset.mlGridMapping;
    if (!mappingId) return;
    if (branch.open) _mlGridOpenLinkBranches.add(mappingId);
    else _mlGridOpenLinkBranches.delete(mappingId);
  });
}

function _mlClearCategoryNestIntent() {
  if (_mlGridCategoryNestIntent?.timer) clearTimeout(_mlGridCategoryNestIntent.timer);
  document.querySelectorAll('.ml-grid-card.is-nest-pending, .ml-grid-card.is-nest-ready').forEach(card => {
    card.classList.remove('is-nest-pending', 'is-nest-ready');
  });
  _mlGridCategoryNestIntent = null;
}

function _mlClearPickedCategory() {
  document.querySelectorAll('.ml-grid-card.is-touch-picked').forEach(card => card.classList.remove('is-touch-picked'));
  _mlPickedCategory = null;
}

function _mlPickCategoryForTouchPlacement(state) {
  _mlClearPickedCategory();
  _mlPickedCategory = {
    categoryId: state.categoryId,
    sourceParent: state.sourceParent || '',
    offsetX: Number.isFinite(Number(state.offsetX)) ? state.offsetX : 8,
    offsetY: Number.isFinite(Number(state.offsetY)) ? state.offsetY : 8,
  };
  document.querySelector(`[data-category-id="${CSS.escape(state.categoryId)}"]`)?.classList.add('is-touch-picked');
}

async function _mlPlacePickedCategory(event) {
  if (!_mlPickedCategory) return false;
  if (event.target.closest('[data-ml-grid-manage], [data-ml-panel-resize], [data-ml-grid-link]')) return false;
  event.preventDefault();
  event.stopPropagation();
  const picked = _mlPickedCategory;
  const target = event.target;
  const targetCard = target.closest?.('[data-ml-grid-card]');
  const dropZone = target.closest?.('[data-ml-drop-zone]');
  const board = target.closest?.('.ml-grid-board') || document.querySelector('#ml-grid-body .ml-grid-board');
  _mlGridDragId = picked.categoryId;
  _mlGridDragKind = 'category';
  _mlGridDragSourceParent = picked.sourceParent || '';
  _mlGridDragOffsetX = picked.offsetX;
  _mlGridDragOffsetY = picked.offsetY;
  try {
    await _mlHandleCategoryDrop(picked.categoryId, targetCard, dropZone, board, {
      clientX: event.clientX,
      clientY: event.clientY,
      placementClientX: event.clientX - picked.offsetX + 2,
      placementClientY: event.clientY - picked.offsetY + 2,
    });
  } catch (err) {
    await HubDialogs.alertError({
      title: 'Category move failed',
      message: err.message,
    });
  } finally {
    _mlGridDragId = null;
    _mlGridDragKind = null;
    _mlGridDragSourceParent = null;
    _mlGridDragOffsetX = null;
    _mlGridDragOffsetY = null;
    _mlClearCategoryNestIntent();
    _mlClearPickedCategory();
  }
  return true;
}

function _mlUpdateCategoryNestIntent(sourceCategoryId, targetCard) {
  if (_mlGridDragKind !== 'category') {
    _mlClearCategoryNestIntent();
    return;
  }
  const targetCategoryId = targetCard?.dataset.categoryId || '';
  if (!sourceCategoryId || !targetCategoryId || sourceCategoryId === targetCategoryId) {
    _mlClearCategoryNestIntent();
    return;
  }
  if (_mlCategoryDescendsFrom(targetCategoryId, sourceCategoryId)) {
    _mlClearCategoryNestIntent();
    return;
  }
  if (_mlGridCategoryNestIntent?.sourceId === sourceCategoryId && _mlGridCategoryNestIntent?.targetId === targetCategoryId) {
    return;
  }
  _mlClearCategoryNestIntent();
  targetCard.classList.add('is-nest-pending');
  const intent = {
    sourceId: sourceCategoryId,
    targetId: targetCategoryId,
    ready: false,
    timer: window.setTimeout(() => {
      intent.ready = true;
      targetCard.classList.remove('is-nest-pending');
      targetCard.classList.add('is-nest-ready');
    }, 5000),
  };
  _mlGridCategoryNestIntent = intent;
}

function _mlCategoryNestTargetForDrop(sourceCategoryId, targetCard) {
  const targetCategoryId = targetCard?.dataset.categoryId || '';
  if (!_mlGridCategoryNestIntent?.ready) return '';
  if (_mlGridCategoryNestIntent.sourceId !== sourceCategoryId) return '';
  if (_mlGridCategoryNestIntent.targetId !== targetCategoryId) return '';
  return targetCategoryId;
}

function _mlGridBoardMetrics(board) {
  if (!board) return null;
  const style = window.getComputedStyle(board);
  const cols = style.gridTemplateColumns
    .split(' ')
    .map(part => parseFloat(part))
    .filter(value => Number.isFinite(value) && value > 0);
  const gap = parseFloat(style.columnGap || style.gap || '10') || 10;
  const rowGap = parseFloat(style.rowGap || style.gap || '10') || gap;
  return {
    rect: board.getBoundingClientRect(),
    cols: Math.max(1, cols.length || 1),
    colWidth: cols[0] || 180,
    rowHeight: _ML_GRID_ROW_HEIGHT,
    gap,
    rowGap,
  };
}

function _mlApplyGridDebugState() {
  const board = document.querySelector('#ml-grid-body .ml-grid-board');
  if (!board) return;
  const enabled = _mlGridDebugEnabled();
  board.classList.toggle('is-debug-cells', enabled);
  if (!enabled) return;
  const metrics = _mlGridBoardMetrics(board);
  if (!metrics) return;
  board.style.setProperty('--ml-debug-col-width', `${Math.round(metrics.colWidth)}px`);
  board.style.setProperty('--ml-debug-col-step', `${Math.round(metrics.colWidth + metrics.gap)}px`);
  board.style.setProperty('--ml-debug-row-height', `${Math.round(metrics.rowHeight)}px`);
  board.style.setProperty('--ml-debug-row-step', `${Math.round(metrics.rowHeight + metrics.rowGap)}px`);
}

function _mlPointerGridCell(board, event) {
  const metrics = _mlGridBoardMetrics(board);
  if (!metrics) return null;
  const clientX = Number.isFinite(Number(event?.clientX)) ? Number(event.clientX) : metrics.rect.left;
  const clientY = Number.isFinite(Number(event?.clientY)) ? Number(event.clientY) : metrics.rect.top;
  const x = Math.max(0, clientX - metrics.rect.left);
  const y = Math.max(0, clientY - metrics.rect.top);
  return {
    col: Math.max(1, Math.min(metrics.cols, Math.floor(x / (metrics.colWidth + metrics.gap)) + 1)),
    row: Math.max(1, Math.floor(y / (metrics.rowHeight + metrics.rowGap)) + 1),
    metrics,
  };
}

function _mlGridDropPlacementEvent(event) {
  return event;
}

function _mlGridCellSlot(cell) {
  if (!cell) return null;
  return Math.max(0, ((Math.round(cell.row) - 1) * Math.max(1, cell.metrics?.cols || 1)) + (Math.round(cell.col) - 1));
}

function _mlSlotGridPosition(slot, cols) {
  const safeCols = Math.max(1, Math.round(Number(cols) || 1));
  const safeSlot = Math.max(0, Math.round(Number(slot) || 0));
  return {
    col: (safeSlot % safeCols) + 1,
    row: Math.floor(safeSlot / safeCols) + 1,
  };
}

function _mlElementSpan(element, axis) {
  if (!element) return 1;
  const style = window.getComputedStyle(element);
  const value = axis === 'row' ? style.gridRowEnd : style.gridColumnEnd;
  const match = String(value || '').match(/span\s+(\d+)/i);
  return match ? Math.max(1, Number(match[1]) || 1) : 1;
}

function _mlApplyExplicitRootGridPlacements() {
  const board = document.querySelector('#ml-grid-body .ml-grid-board');
  const metrics = _mlGridBoardMetrics(board);
  if (!board || !metrics) return;
  board.querySelectorAll(':scope > [data-ml-grid-card]').forEach(card => {
    const categoryId = card.dataset.categoryId;
    const layout = _mlRootGridLayoutFor(categoryId);
    if (!Number.isFinite(Number(layout.slot))) return;
    const pos = _mlSlotGridPosition(layout.slot, metrics.cols);
    const colSpan = Math.max(1, Math.min(metrics.cols, Math.round(Number(layout.w) || _mlElementSpan(card, 'column') || 1)));
    const rowSpan = Math.max(1, Math.round(Number(layout.h) || _mlElementSpan(card, 'row') || 1));
    card.style.gridColumn = `${pos.col} / span ${colSpan}`;
    card.style.gridRow = `${pos.row} / span ${rowSpan}`;
  });
}

function _mlGridDropTargetElement(board) {
  if (!board) return null;
  let el = board.querySelector(':scope > .ml-grid-drop-target');
  if (!el) {
    el = document.createElement('i');
    el.className = 'ml-grid-drop-target';
    el.setAttribute('aria-hidden', 'true');
    board.appendChild(el);
  }
  return el;
}

function _mlShowGridDropTarget(board, event) {
  const cell = _mlPointerGridCell(board, event);
  if (!board || !cell?.metrics) return null;
  const el = _mlGridDropTargetElement(board);
  if (!el) return cell;
  const { col, row, metrics } = cell;
  const left = (Math.round(col) - 1) * (metrics.colWidth + metrics.gap);
  const top = (Math.round(row) - 1) * (metrics.rowHeight + metrics.rowGap);
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  el.style.width = `${Math.round(metrics.colWidth)}px`;
  el.style.height = `${Math.round(metrics.rowHeight)}px`;
  el.dataset.mlGridDropSlot = String(_mlGridCellSlot(cell));
  _mlGridDropCell = cell;
  return cell;
}

function _mlClearGridDropTarget() {
  document.querySelectorAll('.ml-grid-drop-target').forEach(el => el.remove());
  _mlGridDropCell = null;
}

function _mlGridDropCellForEvent(board, event) {
  if (!board) return null;
  const liveCell = _mlPointerGridCell(board, event);
  if (!liveCell) return _mlGridDropCell;
  const liveSlot = _mlGridCellSlot(liveCell);
  const highlightedSlot = _mlGridCellSlot(_mlGridDropCell);
  return highlightedSlot === liveSlot ? _mlGridDropCell : liveCell;
}

function _mlElementGridCell(element, board) {
  const metrics = _mlGridBoardMetrics(board);
  if (!element || !metrics) return { col: 1, row: 1, metrics };
  const rect = element.getBoundingClientRect();
  return {
    col: Math.max(1, Math.min(metrics.cols, Math.floor(Math.max(0, rect.left - metrics.rect.left) / (metrics.colWidth + metrics.gap)) + 1)),
    row: Math.max(1, Math.floor(Math.max(0, rect.top - metrics.rect.top) / (metrics.rowHeight + metrics.rowGap)) + 1),
    metrics,
  };
}

function _mlSaveRootCategoryCell(categoryId, cell, patch = {}) {
  if (!categoryId || !cell) return;
  const layout = _mlSavedGridLayout();
  const current = layout[categoryId] || {};
  const slot = _mlGridCellSlot(cell);
  const next = {
    ...current,
    slot,
    ...patch,
  };
  delete next.col;
  delete next.row;
  Object.keys(layout).forEach(otherId => {
    if (otherId === categoryId) return;
    const other = layout[otherId];
    if (other?.slot === next.slot) {
      delete other.slot;
    }
  });
  layout[categoryId] = next;
  _mlSaveGridLayout(layout);
}

function _mlCategoryShapeForPacking(category) {
  if (!_mlCategoryIsPanel(category)) return { w: 1, h: 1 };
  const saved = _mlRootGridLayoutFor(category.category_id);
  const cellCount = _mlPanelCellCount(category.category_id);
  const fallback = _mlPanelGridShape(cellCount);
  const manualSize = saved.manualSize === true || Number.isFinite(Number(saved.w)) || Number.isFinite(Number(saved.h));
  const w = _mlClampGridSpan(manualSize ? (saved.w || fallback.cols) : fallback.cols, 1, 6);
  const minRows = _mlPanelContentRows(category.category_id, w);
  return {
    w,
    h: _mlClampGridSpan(
      manualSize ? Math.max(saved.h || 1, minRows) : Math.max(fallback.rows, minRows),
      minRows,
      12
    ),
  };
}

function _mlCanPlaceShape(occupied, col, row, w, h, cols) {
  if (col < 1 || row < 1 || col + w - 1 > cols) return false;
  for (let y = row; y < row + h; y += 1) {
    for (let x = col; x < col + w; x += 1) {
      const slot = ((y - 1) * cols) + (x - 1);
      if (occupied.has(slot)) return false;
    }
  }
  return true;
}

function _mlOccupyShape(occupied, col, row, w, h, cols) {
  for (let y = row; y < row + h; y += 1) {
    for (let x = col; x < col + w; x += 1) {
      occupied.add(((y - 1) * cols) + (x - 1));
    }
  }
}

function _mlFirstAvailableGridSlot(occupied, w, h, cols) {
  const safeCols = Math.max(1, Math.round(Number(cols) || 1));
  const safeW = Math.max(1, Math.min(safeCols, Math.round(Number(w) || 1)));
  const safeH = Math.max(1, Math.round(Number(h) || 1));
  for (let row = 1; row < 1000; row += 1) {
    for (let col = 1; col <= safeCols; col += 1) {
      if (_mlCanPlaceShape(occupied, col, row, safeW, safeH, safeCols)) {
        _mlOccupyShape(occupied, col, row, safeW, safeH, safeCols);
        return ((row - 1) * safeCols) + (col - 1);
      }
    }
  }
  const fallbackSlot = occupied.size;
  occupied.add(fallbackSlot);
  return fallbackSlot;
}

function _mlAutoFitInterface() {
  const board = document.querySelector('#ml-grid-body .ml-grid-board');
  const metrics = _mlGridBoardMetrics(board);
  const cols = Math.max(1, metrics?.cols || (_mlGridLayoutBucket() === 'mobile' ? 2 : 5));
  const maps = _mlCategoryMaps();
  const roots = _mlOrderRootCategories(maps.byParent.__root__ || []);
  const layout = {};
  const occupied = new Set();
  roots.forEach(cat => {
    const existing = _mlRootGridLayoutFor(cat.category_id);
    const shape = _mlCategoryShapeForPacking(cat);
    const manualSize = existing.manualSize || Number.isFinite(Number(existing.w)) || Number.isFinite(Number(existing.h));
    const w = Math.min(cols, Math.max(1, shape.w));
    const h = Math.max(1, shape.h, _mlCategoryIsPanel(cat) ? _mlPanelContentRows(cat.category_id, w) : 1);
    const slot = _mlFirstAvailableGridSlot(occupied, w, h, cols);
    layout[cat.category_id] = {
      ...existing,
      slot,
      ...(manualSize
        ? { w, h, manualSize: true }
        : {}),
    };
  });
  _mlSaveGridLayout(layout);
  renderManualLinksGrid();
  if (typeof HubDialogs !== 'undefined') HubDialogs.alert?.({
    title: 'Interface Auto Fit',
    message: 'Manual Links Interface items have been reflowed for this viewport.',
    tone: 'success',
    badge: 'Manual',
  });
}

function _mlPanelMinRows(card, width) {
  const cells = Math.max(1, Number(card?.dataset.mlPanelCells || 1));
  const categoryId = card?.dataset.categoryId;
  const contentRows = categoryId ? _mlPanelContentRows(categoryId, width) : Number(card?.dataset.mlPanelMinRows || 0);
  return Math.max(1, contentRows || 0, Math.ceil(cells / Math.max(1, width)));
}

function _mlApplyPanelResize(card, next) {
  if (!card || !next) return;
  card.style.gridColumn = `${Math.max(1, Math.round(next.col || 1))} / span ${next.w}`;
  card.style.gridRow = `${Math.max(1, Math.round(next.row || 1))} / span ${next.h}`;
  card.style.setProperty('--ml-panel-cols', next.w);
  card.style.setProperty('--ml-panel-rows', next.h);
}

function _mlStartPanelResize(event, handle) {
  const card = handle.closest('[data-ml-grid-panel]');
  const board = card?.closest('.ml-grid-board');
  if (!card || !board) return;
  event.preventDefault();
  event.stopPropagation();
  const categoryId = card.dataset.categoryId;
  const layout = _mlSavedGridLayout();
  const saved = layout[categoryId] || {};
  const metrics = _mlGridBoardMetrics(board);
  if (!metrics) return;
  const savedSlot = Number.isFinite(Number(saved.slot)) ? Math.max(0, Math.round(Number(saved.slot))) : null;
  const savedPos = savedSlot !== null ? _mlSlotGridPosition(savedSlot, metrics.cols) : null;
  const cell = savedPos ? { ...savedPos, metrics } : _mlElementGridCell(card, board);
  const rect = card.getBoundingClientRect();
  const widthFromRect = Math.max(1, Math.round((rect.width + metrics.gap) / (metrics.colWidth + metrics.gap)));
  const heightFromRect = Math.max(1, Math.round((rect.height + metrics.rowGap) / (metrics.rowHeight + metrics.rowGap)));
  const startCol = Math.max(1, Math.round(cell.col || 1));
  const start = {
    col: startCol,
    row: Math.max(1, Math.round(cell.row || 1)),
    slot: savedSlot !== null ? savedSlot : _mlGridCellSlot(cell),
    w: _mlClampGridSpan(saved.w || widthFromRect || 1, 1, Math.max(1, metrics.cols - startCol + 1)),
    h: _mlClampGridSpan(saved.h || heightFromRect || 1, _mlPanelMinRows(card, saved.w || widthFromRect || 1), 12),
  };
  _mlPanelResizeState = {
    categoryId,
    card,
    board,
    handle: handle.dataset.mlPanelResize || 'se',
    startX: event.clientX,
    startY: event.clientY,
    start,
    metrics,
    next: start,
  };
  card.classList.add('is-resizing');
  handle.setPointerCapture?.(event.pointerId);
}

function _mlUpdatePanelResize(event) {
  if (!_mlPanelResizeState) return;
  event.preventDefault();
  const { card, handle, start, metrics } = _mlPanelResizeState;
  const dx = Math.round((event.clientX - _mlPanelResizeState.startX) / (metrics.colWidth + metrics.gap));
  const dy = Math.round((event.clientY - _mlPanelResizeState.startY) / (metrics.rowHeight + metrics.rowGap));
  let col = start.col;
  let row = start.row;
  let w = start.w;
  let h = start.h;
  if (handle.includes('e')) w = start.w + dx;
  if (handle.includes('s')) h = start.h + dy;
  if (handle.includes('w')) {
    w = start.w - dx;
  }
  if (handle.includes('n')) {
    h = start.h - dy;
  }
  w = _mlClampGridSpan(w, 1, Math.max(1, metrics.cols - col + 1));
  h = _mlClampGridSpan(h, _mlPanelMinRows(card, w), 12);
  const next = { col, row, w, h };
  _mlPanelResizeState.next = next;
  _mlApplyPanelResize(card, next);
}

function _mlFinishPanelResize() {
  if (!_mlPanelResizeState) return;
  const { categoryId, card, start, next } = _mlPanelResizeState;
  card?.classList.remove('is-resizing');
  const layout = _mlSavedGridLayout();
  const current = layout[categoryId] || {};
  const slot = Number.isFinite(Number(current.slot)) ? current.slot : start.slot;
  layout[categoryId] = { ...current, slot, w: next.w, h: next.h, manualSize: true };
  _mlSaveGridLayout(layout);
  _mlPanelResizeState = null;
  _mlScheduleGridViewportFit();
}

async function _mlHandleCategoryDrop(draggedId, targetCard, dropZone, board, event) {
  const sourceParent = _mlGridDragSourceParent || '';
  const dropZoneParent = dropZone?.dataset.mlDropParent || '';
  const placementEvent = _mlGridDropPlacementEvent(event);
  const nestTargetId = _mlCategoryNestTargetForDrop(draggedId, targetCard);
  if (nestTargetId) {
    await _mlMoveCategory(draggedId, nestTargetId);
    return;
  }
  if (board && sourceParent === '') {
    const cell = _mlGridDropCellForEvent(board, placementEvent);
    if (cell) {
      _mlSaveRootCategoryCell(draggedId, cell);
      renderManualLinksGrid();
      return;
    }
  }
  if (board && dropZone?.classList.contains('ml-grid-board') && !targetCard) {
    const cell = _mlGridDropCellForEvent(board, placementEvent);
    _mlSaveRootCategoryCell(draggedId, cell);
    if (sourceParent) await _mlMoveCategory(draggedId, null);
    else renderManualLinksGrid();
    return;
  }
  if (dropZone && dropZoneParent !== sourceParent && dropZoneParent !== draggedId) {
    if (dropZoneParent === '') {
      const cell = _mlGridDropCellForEvent(board || dropZone, placementEvent);
      _mlSaveRootCategoryCell(draggedId, cell);
    } else if (sourceParent === '' && board) {
      const cell = _mlGridDropCellForEvent(board, placementEvent);
      if (cell) {
        _mlSaveRootCategoryCell(draggedId, cell);
        renderManualLinksGrid();
        return;
      }
    }
    await _mlMoveCategory(draggedId, dropZoneParent || null);
    return;
  }
  if (targetCard && targetCard.dataset.categoryId && targetCard.dataset.categoryId !== draggedId) {
    const targetParent = targetCard.parentElement?.closest('[data-ml-grid-panel]')?.dataset.categoryId || '';
    const sameContainer = targetCard.parentElement === document.querySelector(`[data-category-id="${CSS.escape(draggedId)}"]`)?.parentElement;
    if (sameContainer || sourceParent === targetParent) {
      if (!targetParent && board) {
        const cell = _mlGridDropCellForEvent(board, placementEvent);
        if (cell) {
          _mlSaveRootCategoryCell(draggedId, cell);
          renderManualLinksGrid();
        }
      } else {
        const dragged = targetCard.parentElement?.querySelector(`[data-category-id="${CSS.escape(draggedId)}"]`);
        if (dragged) {
          const rect = targetCard.getBoundingClientRect();
          const after = placementEvent.clientY > rect.top + (rect.height / 2);
          targetCard.parentElement.insertBefore(dragged, after ? targetCard.nextSibling : targetCard);
        }
      }
    } else {
      await _mlMoveCategory(draggedId, targetParent || null);
    }
    return;
  }
  _mlSaveGridOrderFromDom();
}

function _mlTouchDragSource(event) {
  if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return null;
  if (event.target.closest('[data-ml-grid-manage], [data-ml-panel-resize]')) return null;
  const mappingHandle = event.target.closest('[data-ml-grid-mapping-drag]');
  if (mappingHandle) {
    const mappingId = mappingHandle.dataset.mlGridMappingDrag;
    const mapping = _manualLinkCategoryItems.find(item => item.mapping_id === mappingId);
    return {
      kind: 'mapping',
      id: mappingId,
      sourceParent: mapping?.category_id || '',
      handle: mappingHandle,
      element: mappingHandle.closest('.ml-grid-link-branch, .ml-grid-link') || mappingHandle,
    };
  }
  const handle = event.target.closest('[data-ml-panel-drag-handle], [data-ml-grid-toggle]');
  if (!handle) return null;
  if (event.target.closest('[data-ml-grid-link]')) return null;
  const card = handle.closest('[data-ml-grid-card]');
  if (!card) return null;
  if (card.matches('[data-ml-grid-panel]') && !handle.matches('[data-ml-panel-drag-handle]')) return null;
  return handle;
}

function _mlGridInteractionTransition(current, input) {
  return _ML_GRID_INTERACTION_TRANSITIONS[current]?.[input]?.next || current || _ML_GRID_INTERACTION_STATES.IDLE;
}

function _mlSuppressNativeDraggable(root, suppress) {
  if (!root) return [];
  const elements = [];
  if (root.matches?.('[draggable="true"]')) elements.push(root);
  root.querySelectorAll?.('[draggable="true"]').forEach(el => elements.push(el));
  elements.forEach(el => {
    if (suppress) {
      el.dataset.mlTouchDraggableRestore = 'true';
      el.setAttribute('draggable', 'false');
    } else if (el.dataset.mlTouchDraggableRestore === 'true') {
      el.setAttribute('draggable', 'true');
      delete el.dataset.mlTouchDraggableRestore;
    }
  });
  return elements;
}

function _mlRestoreNativeDraggable(elements) {
  (elements || []).forEach(el => {
    if (el?.dataset?.mlTouchDraggableRestore === 'true') {
      el.setAttribute('draggable', 'true');
      delete el.dataset.mlTouchDraggableRestore;
    }
  });
}

function _mlStopTouchAutoScroll() {
  if (!_mlGridInteractionActive) return;
  if (_mlGridInteractionActive.autoScrollFrame) cancelAnimationFrame(_mlGridInteractionActive.autoScrollFrame);
  _mlGridInteractionActive.autoScrollFrame = null;
  _mlGridInteractionActive.autoScrollSpeed = 0;
}

function _mlTouchScrollTarget() {
  const shell = document.querySelector('#tab-manual-links.active .tab-scroll-shell');
  if (shell && shell.scrollHeight > shell.clientHeight + 2) return shell;
  return document.scrollingElement || document.documentElement;
}

function _mlRunTouchAutoScroll() {
  const state = _mlGridInteractionActive;
  if (!state || state.kind !== _ML_GRID_INTERACTION_STATES.DRAGGING || !state.autoScrollSpeed) {
    if (state) state.autoScrollFrame = null;
    return;
  }
  const target = state.scrollTarget || _mlTouchScrollTarget();
  if (target === document.scrollingElement || target === document.documentElement || target === document.body) {
    window.scrollBy(0, state.autoScrollSpeed);
  } else {
    target.scrollTop += state.autoScrollSpeed;
  }
  state.autoScrollFrame = requestAnimationFrame(_mlRunTouchAutoScroll);
}

function _mlUpdateTouchAutoScroll(clientY) {
  const state = _mlGridInteractionActive;
  if (!state || state.kind !== _ML_GRID_INTERACTION_STATES.DRAGGING) return;
  const viewportH = (window.visualViewport && Number.isFinite(window.visualViewport.height) && window.visualViewport.height > 0)
    ? window.visualViewport.height
    : (window.innerHeight || document.documentElement.clientHeight || 0);
  if (!viewportH) return;
  let speed = 0;
  if (clientY < _ML_TOUCH_DRAG_SCROLL_EDGE) {
    speed = -Math.ceil((_ML_TOUCH_DRAG_SCROLL_EDGE - clientY) / 6);
  } else if (clientY > viewportH - _ML_TOUCH_DRAG_SCROLL_EDGE) {
    speed = Math.ceil((clientY - (viewportH - _ML_TOUCH_DRAG_SCROLL_EDGE)) / 6);
  }
  speed = Math.max(-18, Math.min(18, speed));
  state.autoScrollSpeed = speed;
  if (speed && !state.autoScrollFrame) {
    state.autoScrollFrame = requestAnimationFrame(_mlRunTouchAutoScroll);
  } else if (!speed && state.autoScrollFrame) {
    cancelAnimationFrame(state.autoScrollFrame);
    state.autoScrollFrame = null;
  }
}

function _mlStartTouchCategoryDrag(event) {
  const source = _mlTouchDragSource(event);
  if (!source) return;
  const handle = source.handle || source;
  const card = source.kind === 'mapping' ? null : handle.closest('[data-ml-grid-card]');
  const dragElement = source.kind === 'mapping' ? source.element : card;
  if (!dragElement) return;
  event.preventDefault();
  event.stopPropagation?.();
  try {
    handle.setPointerCapture?.(event.pointerId);
  } catch (_) {}
  _mlGridInteractionActive = {
    kind: _mlGridInteractionTransition(_ML_GRID_INTERACTION_STATES.IDLE, 'press'),
    dragKind: source.kind || 'category',
    pointerId: event.pointerId,
    id: source.kind === 'mapping' ? source.id : card.dataset.categoryId,
    categoryId: source.kind === 'mapping' ? null : card.dataset.categoryId,
    mappingId: source.kind === 'mapping' ? source.id : null,
    card,
    element: dragElement,
    handle,
    captureEl: handle,
    sourceParent: source.sourceParent || '',
    nativeDraggables: _mlSuppressNativeDraggable(dragElement, true),
    scrollTarget: _mlTouchScrollTarget(),
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    timer: window.setTimeout(() => {
      if (!_mlGridInteractionActive || _mlGridInteractionActive.pointerId !== event.pointerId) return;
      _mlPromoteTouchCategoryDrag();
    }, _ML_TOUCH_DRAG_HOLD_MS),
  };
}

function _mlPromoteTouchCategoryDrag() {
  const state = _mlGridInteractionActive;
  if (!state || state.kind !== _ML_GRID_INTERACTION_STATES.PRESSING) return;
  const element = state.element || state.card;
  if (!element) return;
  state.kind = _mlGridInteractionTransition(state.kind, 'hold');
  const rect = element.getBoundingClientRect();
  const ghost = element.cloneNode(true);
  ghost.removeAttribute('id');
  ghost.classList.add('ml-grid-touch-ghost');
  ghost.style.width = `${Math.min(rect.width, window.innerWidth - 24)}px`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  document.body.appendChild(ghost);
  state.ghost = ghost;
  state.sourceDisplay = element.style.display;
  element.style.display = 'none';
  state.offsetX = state.x - rect.left;
  state.offsetY = state.y - rect.top;
  state.placementX = rect.left;
  state.placementY = rect.top;
  _mlGridDragId = state.id;
  _mlGridDragKind = state.dragKind;
  _mlGridDragSourceParent = state.dragKind === 'mapping'
    ? (state.sourceParent || '')
    : (state.card?.parentElement?.closest('[data-ml-grid-panel]')?.dataset.categoryId || '');
  state.sourceParent = _mlGridDragSourceParent;
  _mlGridDragOffsetX = state.offsetX;
  _mlGridDragOffsetY = state.offsetY;
  _mlClearCategoryNestIntent();
  if (state.dragKind === 'category') _mlSuppressCategoryToggleBriefly();
  else _mlSuppressLeafClickBriefly();
  element.classList.add('is-touch-dragging');
}

function _mlMoveTouchCategoryDrag(event) {
  if (!_mlGridInteractionActive || _mlGridInteractionActive.pointerId !== event.pointerId) return;
  _mlGridInteractionActive.x = event.clientX;
  _mlGridInteractionActive.y = event.clientY;
  if (_mlGridInteractionActive.kind === _ML_GRID_INTERACTION_STATES.PRESSING) {
    event.preventDefault();
    event.stopPropagation?.();
    const dx = Math.abs(event.clientX - _mlGridInteractionActive.startX);
    const dy = Math.abs(event.clientY - _mlGridInteractionActive.startY);
    if (Math.max(dx, dy) < _ML_TOUCH_DRAG_MOVE_PX) return;
    clearTimeout(_mlGridInteractionActive.timer);
    _mlPromoteTouchCategoryDrag();
    if (!_mlGridInteractionActive || _mlGridInteractionActive.kind !== _ML_GRID_INTERACTION_STATES.DRAGGING) return;
  }
  event.preventDefault();
  event.stopPropagation?.();
  const ghost = _mlGridInteractionActive.ghost;
  if (ghost) {
    const left = event.clientX - (_mlGridInteractionActive.offsetX || 0);
    const top = event.clientY - (_mlGridInteractionActive.offsetY || 0);
    _mlGridInteractionActive.placementX = left;
    _mlGridInteractionActive.placementY = top;
    ghost.style.transform = `translate(${Math.round(left - parseFloat(ghost.style.left || '0'))}px, ${Math.round(top - parseFloat(ghost.style.top || '0'))}px) scale(0.985)`;
  }
  const target = document.elementFromPoint(event.clientX, event.clientY);
  if (_mlGridInteractionActive.dragKind === 'category') {
    const targetCard = target?.closest?.('[data-ml-grid-card]');
    const dropZone = target?.closest?.('[data-ml-drop-zone]');
    const board = target?.closest?.('.ml-grid-board') || document.querySelector('#ml-grid-body .ml-grid-board');
    if (board) _mlShowGridDropTarget(board, event);
    else _mlClearGridDropTarget();
    const explicitStructuralDrop = !!dropZone && (!targetCard || targetCard.contains(dropZone));
    _mlUpdateCategoryNestIntent(_mlGridInteractionActive.categoryId, explicitStructuralDrop ? null : targetCard);
  } else {
    _mlClearCategoryNestIntent();
    _mlClearGridDropTarget();
  }
  _mlUpdateTouchAutoScroll(event.clientY);
}

async function _mlFinishTouchCategoryDrag(event) {
  if (!_mlGridInteractionActive || _mlGridInteractionActive.pointerId !== event.pointerId) return;
  const state = _mlGridInteractionActive;
  clearTimeout(state.timer);
  _mlGridInteractionActive = null;
  _mlGridInteractionTouchFallbackId = null;
  if (state.autoScrollFrame) cancelAnimationFrame(state.autoScrollFrame);
  try {
    state.captureEl?.releasePointerCapture?.(event.pointerId);
  } catch (_) {}
  _mlRestoreNativeDraggable(state.nativeDraggables);
  state.card?.classList.remove('is-touch-dragging');
  state.element?.classList.remove('is-touch-dragging');
  state.ghost?.remove();
  const releaseKind = state.kind;
  state.kind = _mlGridInteractionTransition(state.kind, event.type === 'pointercancel' ? 'cancel' : 'release');
  if (releaseKind !== _ML_GRID_INTERACTION_STATES.DRAGGING) {
    _mlClearGridDropTarget();
    if (state.element) state.element.style.display = state.sourceDisplay || '';
    if (event.type === 'pointercancel') return;
    event.preventDefault();
    event.stopPropagation?.();
    _mlSuppressGridClickBriefly();
    if (state.dragKind === 'mapping') {
      if (state.handle?.matches?.('[data-ml-grid-link]')) {
        _mlHandleLeafClick(state.handle, 'pointer');
      } else {
        const details = state.handle?.closest?.('.ml-grid-link-branch');
        if (details) details.open = !details.open;
      }
      return;
    }
    if (state.dragKind === 'category' && state.handle?.matches?.('[data-ml-panel-drag-handle]')) {
      _mlRevealPanelResizeHandles(state.card);
      return;
    }
    if (state.dragKind === 'category' && state.handle?.matches?.('[data-ml-grid-toggle]')) {
      _mlSuppressCategoryToggleBriefly();
      if (_mlGridOpen.has(state.categoryId)) _mlGridOpen.delete(state.categoryId);
      else {
        _mlGridOpen.clear();
        _mlGridOpen.add(state.categoryId);
      }
      renderManualLinksGrid();
    }
    return;
  }
  event.preventDefault();
  event.stopPropagation?.();
  if (state.dragKind === 'category') _mlSuppressCategoryToggleBriefly();
  else _mlSuppressLeafClickBriefly();
  const x = Number.isFinite(event.clientX) ? event.clientX : state.x;
  const y = Number.isFinite(event.clientY) ? event.clientY : state.y;
  const moved = Math.abs(x - state.startX) > 12 || Math.abs(y - state.startY) > 12;
  if (state.dragKind === 'mapping' && !moved) {
    _mlGridDragId = null;
    _mlGridDragKind = null;
    _mlGridDragSourceParent = null;
    _mlGridDragOffsetX = null;
    _mlGridDragOffsetY = null;
    _mlClearCategoryNestIntent();
    _mlClearGridDropTarget();
    if (state.element) state.element.style.display = state.sourceDisplay || '';
    return;
  }
  if (state.dragKind === 'category' && !moved && (event.pointerType === 'touch' || String(event.pointerId || '').startsWith('touch-'))) {
    _mlGridDragId = null;
    _mlGridDragKind = null;
    _mlGridDragSourceParent = null;
    _mlGridDragOffsetX = null;
    _mlGridDragOffsetY = null;
    _mlClearCategoryNestIntent();
    _mlClearGridDropTarget();
    if (state.element) state.element.style.display = state.sourceDisplay || '';
    _mlPickCategoryForTouchPlacement(state);
    return;
  }
  const target = document.elementFromPoint(x, y);
  const targetCard = target?.closest?.('[data-ml-grid-card]');
  const dropZone = target?.closest?.('[data-ml-drop-zone]');
  const board = target?.closest?.('.ml-grid-board') || document.querySelector('#ml-grid-body .ml-grid-board');
  try {
    if (state.dragKind === 'mapping') {
      const targetCategoryId = dropZone?.dataset.mlDropParent || targetCard?.dataset.categoryId || '';
      await _mlPromoteOrMoveMapping(state.mappingId, targetCategoryId || null);
    } else {
      const placement = { clientX: x, clientY: y };
      const targetParent = targetCard?.parentElement?.closest('[data-ml-grid-panel]')?.dataset.categoryId || '';
      const dropParent = dropZone?.dataset.mlDropParent || '';
      if (!state.sourceParent && board && !targetParent && !dropParent) {
        _mlSaveRootCategoryCell(state.categoryId, _mlGridDropCellForEvent(board, placement));
        renderManualLinksGrid();
      } else {
        await _mlHandleCategoryDrop(state.categoryId, targetCard, dropZone, board, placement);
      }
    }
  } catch (err) {
    await HubDialogs.alertError({
      title: state.dragKind === 'mapping' ? 'Link move failed' : 'Category move failed',
      message: err.message,
    });
  } finally {
    _mlGridDragId = null;
    _mlGridDragKind = null;
    _mlGridDragSourceParent = null;
    _mlGridDragOffsetX = null;
    _mlGridDragOffsetY = null;
    _mlClearCategoryNestIntent();
    _mlClearGridDropTarget();
    if (state.element) state.element.style.display = state.sourceDisplay || '';
  }
}

function _mlTouchEventPoint(event, changed = false) {
  const list = changed ? event.changedTouches : event.touches;
  if (!list || !list.length) return null;
  if (_mlGridInteractionTouchFallbackId !== null) {
    return [...list].find(touch => touch.identifier === _mlGridInteractionTouchFallbackId) || null;
  }
  return list[0];
}

function _mlTouchFallbackEvent(event, touch) {
  return {
    type: event.type,
    pointerType: 'touch',
    pointerId: `touch-${touch.identifier}`,
    target: event.target,
    clientX: touch.clientX,
    clientY: touch.clientY,
    preventDefault: () => {
      if (event.cancelable) event.preventDefault();
    },
    stopPropagation: () => event.stopPropagation(),
  };
}

function _mlStartTouchCategoryDragFallback(event) {
  if (_mlGridInteractionActive) return;
  const touch = _mlTouchEventPoint(event);
  if (!touch) return;
  const pseudo = _mlTouchFallbackEvent(event, touch);
  if (!_mlTouchDragSource(pseudo)) return;
  _mlGridInteractionTouchFallbackId = touch.identifier;
  _mlStartTouchCategoryDrag(pseudo);
  if (!_mlGridInteractionActive) _mlGridInteractionTouchFallbackId = null;
}

function _mlMoveTouchCategoryDragFallback(event) {
  if (!_mlGridInteractionActive || _mlGridInteractionTouchFallbackId === null) return;
  const touch = _mlTouchEventPoint(event);
  if (!touch) return;
  _mlMoveTouchCategoryDrag(_mlTouchFallbackEvent(event, touch));
}

function _mlFinishTouchCategoryDragFallback(event) {
  if (!_mlGridInteractionActive || _mlGridInteractionTouchFallbackId === null) return;
  const touch = _mlTouchEventPoint(event, true) || _mlTouchEventPoint(event);
  if (!touch) return;
  void _mlFinishTouchCategoryDrag(_mlTouchFallbackEvent(event, touch));
}

function _mlExtractDroppedUrl(dataTransfer) {
  if (!dataTransfer) return '';
  const uriList = dataTransfer.getData('text/uri-list') || '';
  const uri = uriList
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line && !line.startsWith('#'));
  const text = dataTransfer.getData('text/plain') || dataTransfer.getData('text') || '';
  const candidate = uri || text.trim();
  return /^https?:\/\//i.test(candidate) ? candidate : '';
}

function _mlMayContainDroppedUrl(dataTransfer) {
  const types = Array.from(dataTransfer?.types || []);
  return types.includes('text/uri-list') || types.includes('text/plain') || types.includes('text');
}

async function _mlIntakeDroppedUrl(url, targetCategoryId) {
  const r = await apiFetch('/api/v1/manual-links/intake-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, category_id: targetCategoryId || null }),
  });
  if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
  const result = await r.json();
  await loadManualLinks();
  if (typeof HubDialogs !== 'undefined') {
    const aiHint = result.ai_used ? `AI: ${result.ai_project || 'local'}` : 'AI fallback was not used';
    const title = result.created
      ? 'Link added'
      : (result.updated_existing_label ? 'Link label improved' : 'Link already existed');
    HubDialogs.alert({
      title,
      message: `${result.label || url} -> ${result.category_label || 'Unsorted'}\n${aiHint}`,
      tone: result.created ? 'success' : 'info',
      badge: 'Manual',
    });
  }
}

function _mlOpenLinkDetail(linkId, mappingId = null) {
  const lnk = _manualLinks.find(item => item.link_id === linkId);
  if (!lnk) return;
  const mapping = mappingId ? _manualLinkCategoryItems.find(item => item.mapping_id === mappingId) : null;
  const modal = document.getElementById('ml-link-detail-modal');
  const title = document.getElementById('ml-link-detail-title');
  const body = document.getElementById('ml-link-detail-body');
  if (!modal || !title || !body) return;
  const displayLabel = mapping?.label_override || lnk.label || 'Manual link';
  title.textContent = displayLabel;
  const routes = [
    ['VLAN URI', lnk.vlan_uri],
    ['VLAN IP', lnk.vlan_ip],
    ['Tailnet URI', lnk.tailnet_uri],
    ['Tailnet IP', lnk.tailnet_ip],
  ].filter(([, value]) => value);
  body.innerHTML = `
    <div class="ml-detail-routes">
      ${routes.map(([label, value]) => `<a class="ml-detail-route" href="${esc(_mlHref(value))}" target="_blank" rel="noopener noreferrer"><span>${esc(label)}</span><strong>${esc(value)}</strong></a>`).join('') || '<p class="ml-page-empty">No routes recorded.</p>'}
    </div>
    <div class="ml-detail-editor" data-ml-detail-editor data-link-id="${esc(linkId)}"${mapping ? ` data-mapping-id="${esc(mapping.mapping_id)}"` : ''}>
      <div class="ml-detail-editor-head">
        <span>Edit</span>
        <button class="hub-action-btn" type="button" data-ml-detail-full-edit="${esc(linkId)}">Full Edit</button>
      </div>
      <div class="ml-detail-form-grid">
        <label class="ml-detail-field">
          <span>Menu display name</span>
          <input type="text" data-ml-detail-field="label_override" value="${esc(mapping?.label_override || '')}" placeholder="${esc(lnk.label || '')}" ${mapping ? '' : 'disabled'} />
        </label>
        <label class="ml-detail-field">
          <span>Canonical label</span>
          <input type="text" data-ml-detail-field="label" value="${esc(lnk.label || '')}" />
        </label>
        <label class="ml-detail-field">
          <span>Icon</span>
          <input type="text" data-ml-detail-field="icon" value="${esc(lnk.icon || '')}" />
        </label>
        <label class="ml-detail-field">
          <span>VLAN URI</span>
          <input type="text" data-ml-detail-field="vlan_uri" value="${esc(lnk.vlan_uri || '')}" />
        </label>
        <label class="ml-detail-field">
          <span>Tailnet URI</span>
          <input type="text" data-ml-detail-field="tailnet_uri" value="${esc(lnk.tailnet_uri || '')}" />
        </label>
        <label class="ml-detail-field">
          <span>VLAN IP</span>
          <input type="text" data-ml-detail-field="vlan_ip" value="${esc(lnk.vlan_ip || '')}" />
        </label>
        <label class="ml-detail-field">
          <span>Tailnet IP</span>
          <input type="text" data-ml-detail-field="tailnet_ip" value="${esc(lnk.tailnet_ip || '')}" />
        </label>
        <label class="ml-detail-field ml-detail-field--wide">
          <span>Notes</span>
          <textarea rows="3" data-ml-detail-field="notes">${esc(lnk.notes || '')}</textarea>
        </label>
      </div>
      ${mapping ? '<p class="ml-detail-help">Menu display name changes only this placement. Canonical label changes the link everywhere that has no override.</p>' : '<p class="ml-detail-help">Open this from an Interface menu item to edit that placement display name.</p>'}
      <p class="hub-modal-error" data-ml-detail-error></p>
      <div class="ml-detail-actions">
        <button class="hub-action-btn" type="button" data-ml-detail-save>Save</button>
      </div>
    </div>
    <dl class="ml-detail-meta">
      ${lnk.group_name ? `<dt>Group</dt><dd>${esc(lnk.group_name)}</dd>` : ''}
      ${lnk.pve_host ? `<dt>PVE host</dt><dd>${esc(lnk.pve_host)}</dd>` : ''}
      ${lnk.vm_id || lnk.vm_name ? `<dt>VM</dt><dd>${esc([lnk.vm_id, lnk.vm_name].filter(Boolean).join(' / '))}</dd>` : ''}
      ${lnk.lxc_id || lnk.lxc_name ? `<dt>LXC</dt><dd>${esc([lnk.lxc_id, lnk.lxc_name].filter(Boolean).join(' / '))}</dd>` : ''}
      ${lnk.location ? `<dt>Location</dt><dd>${esc(lnk.location)}</dd>` : ''}
      ${lnk.notes ? `<dt>Notes</dt><dd>${esc(lnk.notes)}</dd>` : ''}
    </dl>`;
  HubModal.open(modal);
}

async function _mlSaveLinkDetail(editor) {
  const linkId = editor?.dataset.linkId;
  if (!linkId) return;
  const err = editor.querySelector('[data-ml-detail-error]');
  if (err) err.textContent = '';
  const field = name => editor.querySelector(`[data-ml-detail-field="${name}"]`)?.value?.trim() ?? '';
  const linkBody = {
    label: field('label') || null,
    icon: field('icon') || null,
    vlan_uri: field('vlan_uri') || null,
    tailnet_uri: field('tailnet_uri') || null,
    vlan_ip: field('vlan_ip') || null,
    tailnet_ip: field('tailnet_ip') || null,
    notes: field('notes') || null,
  };
  try {
    const linkResp = await apiFetch(`/api/v1/manual-links/${encodeURIComponent(linkId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(linkBody),
    });
    if (!linkResp.ok) throw new Error((await linkResp.json()).detail || `HTTP ${linkResp.status}`);
    const mappingId = editor.dataset.mappingId;
    if (mappingId) {
      const rawOverride = field('label_override');
      const mappingResp = await apiFetch(`/api/v1/manual-link-categories/items/${encodeURIComponent(mappingId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label_override: rawOverride || null }),
      });
      if (!mappingResp.ok) throw new Error((await mappingResp.json()).detail || `HTTP ${mappingResp.status}`);
    }
    await loadManualLinks();
    _mlOpenLinkDetail(linkId, mappingId || null);
  } catch (e) {
    if (err) err.textContent = e.message;
  }
}

function _mlOpenCategoryManage(categoryId) {
  _mlManagingCategoryId = categoryId;
  const category = _manualLinkCategories.find(cat => cat.category_id === categoryId);
  const modal = document.getElementById('ml-category-manage-modal');
  const title = document.getElementById('ml-category-manage-title');
  const body = document.getElementById('ml-category-manage-body');
  if (!category || !modal || !title || !body) return;
  title.textContent = category.label;
  const itemsByCategory = _mlItemsByCategory();
  const maps = _mlCategoryMaps();
  const tree = _mlLinkTreeForCategory(categoryId, itemsByCategory);
  const renderCategoryRow = (cat, depth) => {
    const children = _mlSortCategories(maps.byParent[cat.category_id] || []);
    const currentParent = cat.parent_category_id ? (_mlCategoryPath(cat.parent_category_id) || 'Top categories') : 'Top categories';
    const controls = `<div class="ml-manage-row-actions">
      <div class="ml-dest-control">
        <button class="hub-action-btn ml-dest-trigger" type="button" data-ml-category-dest-trigger="${esc(cat.category_id)}">
          <span data-ml-category-dest-label>${esc(currentParent)}</span>
        </button>
        ${_mlCategoryDestinationPickerHtml(cat.category_id)}
      </div>
      <button class="hub-action-btn ml-manage-mini-action" type="button" data-ml-open-category-manage="${esc(cat.category_id)}" title="Manage category">MG</button>
      <button class="hub-action-btn ml-manage-mini-action" type="button" data-ml-move-category="${esc(cat.category_id)}" title="Move category">MV</button>
      <button class="hub-action-btn ml-manage-mini-action" type="button" data-ml-move-category-top="${esc(cat.category_id)}" title="Move to top categories">TOP</button>
    </div>`;
    const rowInner = children.length
      ? `<button class="ml-manage-twist" type="button" data-ml-category-manage-toggle="${esc(cat.category_id)}" aria-label="Toggle ${esc(cat.label)}"></button>`
      : '<span class="ml-manage-twist ml-manage-twist--empty" aria-hidden="true"></span>';
    const main = `<div class="ml-manage-row-main"${children.length ? ` data-ml-category-manage-toggle="${esc(cat.category_id)}"` : ''}>
        ${_mlIconHtml(_mlCategoryIcon(cat), 'ml-manage-row-icon')}
        <strong>${esc(cat.label || cat.category_id.slice(0, 8))}</strong>
        <span>${esc(_mlCategoryIsPanel(cat) ? 'Panel category' : 'Category')}</span>
      </div>`;
    if (!children.length) {
      return `<div class="ml-manage-row ml-manage-row--category" data-category-id="${esc(cat.category_id)}" data-ml-category-destination-id="${esc(cat.parent_category_id || '')}" style="--ml-manage-depth:${depth}">
        ${rowInner}${main}${controls}
      </div>`;
    }
    return `<div class="ml-manage-node ml-manage-node--category" data-ml-category-manage-node data-category-id="${esc(cat.category_id)}" data-ml-category-destination-id="${esc(cat.parent_category_id || '')}" style="--ml-manage-depth:${depth}">
      <div class="ml-manage-row ml-manage-row--summary">${rowInner}${main}${controls}</div>
      <div class="ml-manage-node-panel" hidden>
        <div class="ml-manage-children">
          ${children.map(child => renderCategoryRow(child, depth + 1)).join('')}
        </div>
      </div>
    </div>`;
  };
  const renderManageRow = (item, depth) => {
    if (!item?.link || depth > 12) return '';
    const children = tree.sortItems(tree.childrenByParent.get(item.mapping_id) || []);
    const label = item.label_override || item.link?.label || item.link_id;
    const route = _mlPrimaryRoute(item.link) || 'No route';
    const currentPath = _mlCategoryPath(categoryId) || category.label;
    const controls = `<div class="ml-manage-row-actions">
      <div class="ml-dest-control">
        <button class="hub-action-btn ml-dest-trigger" type="button" data-ml-dest-trigger="${esc(item.mapping_id)}">
          <span data-ml-dest-label>${esc(currentPath)}</span>
        </button>
        ${_mlDestinationPickerHtml(item.mapping_id)}
      </div>
      <button class="hub-action-btn ml-manage-mini-action" type="button" data-ml-link-icon="${esc(item.link.link_id)}" title="Choose icon">IC</button>
      <button class="hub-action-btn ml-manage-mini-action" type="button" data-ml-copy-item="${esc(item.mapping_id)}" title="Copy mapping">CP</button>
      <button class="hub-action-btn ml-manage-mini-action" type="button" data-ml-move-item="${esc(item.mapping_id)}" title="Move mapping">MV</button>
      <button class="hub-action-btn ml-manage-mini-action" type="button" data-ml-remove-item="${esc(item.mapping_id)}" title="Remove mapping">RM</button>
    </div>`;
    const rowInner = children.length
      ? `<button class="ml-manage-twist" type="button" data-ml-manage-toggle="${esc(item.mapping_id)}" aria-label="Toggle ${esc(label)}"></button>`
      : '<span class="ml-manage-twist ml-manage-twist--empty" aria-hidden="true"></span>';
    const main = `<div class="ml-manage-row-main"${children.length ? ` data-ml-manage-toggle="${esc(item.mapping_id)}"` : ''}>
        ${_mlIconHtml(_mlLinkIcon(item.link), 'ml-manage-row-icon')}
        <strong>${esc(label)}</strong>
        <span>${esc(route)}</span>
      </div>`;
    if (!children.length) {
      return `<div class="ml-manage-row ml-manage-row--leaf" data-mapping-id="${esc(item.mapping_id)}" data-ml-destination-id="${esc(categoryId)}" style="--ml-manage-depth:${depth}">
        ${rowInner}${main}${controls}
      </div>`;
    }
    return `<div class="ml-manage-node" data-ml-manage-node data-mapping-id="${esc(item.mapping_id)}" data-ml-destination-id="${esc(categoryId)}" style="--ml-manage-depth:${depth}">
      <div class="ml-manage-row ml-manage-row--summary">${rowInner}${main}${controls}</div>
      <div class="ml-manage-node-panel" hidden>
        <div class="ml-manage-children">
          ${children.map(child => renderManageRow(child, depth + 1)).join('')}
        </div>
      </div>
    </div>`;
  };
  const childCategories = _mlSortCategories(maps.byParent[categoryId] || []);
  const categoryHtml = childCategories.map(cat => renderCategoryRow(cat, 0)).join('');
  const treeHtml = tree.roots.map(item => renderManageRow(item, 0)).join('');
  const icon = _mlCategoryIcon(category);
  const canDeleteCategory = childCategories.length === 0 && tree.roots.length === 0;
  body.innerHTML = `<div class="ml-manage-category-tools">
      ${_mlIconHtml(icon, 'ml-manage-category-icon')}
      <span class="ml-manage-category-icon-text" title="${esc(icon)}">${esc(icon)}</span>
      <button class="hub-action-btn ml-manage-mini-action" type="button" data-ml-category-icon="${esc(categoryId)}" title="Choose category icon">Icon</button>
      <button class="hub-action-btn ml-manage-mini-action" type="button" data-ml-category-icon-default="${esc(categoryId)}" title="Use default category icon">Default</button>
      ${canDeleteCategory ? `<button class="hub-action-btn ml-manage-mini-action ml-manage-delete-category" type="button" data-ml-delete-category="${esc(categoryId)}" title="Delete empty category">Delete</button>` : ''}
    </div>
    <div class="ml-manage-category-edit">
      <label class="ml-manage-panel-field">
        <span>Name</span>
        <input type="text" data-ml-category-label="${esc(categoryId)}" value="${esc(category.label || '')}" />
      </label>
      <label class="ml-manage-panel-field ml-manage-panel-field--wide">
        <span>Notes</span>
        <input type="text" data-ml-category-notes="${esc(categoryId)}" value="${esc(category.notes || '')}" placeholder="optional category notes" />
      </label>
      <button class="hub-action-btn ml-manage-mini-action" type="button" data-ml-category-details-save="${esc(categoryId)}">Apply</button>
    </div>
    <div class="ml-manage-panel-tools">
      <label class="hub-checkbox ml-manage-panel-check">
        <input class="hub-checkbox__input" type="checkbox" data-ml-category-show-panel="${esc(categoryId)}"${_mlCategoryIsPanel(category) ? ' checked' : ''} />
        <span class="hub-checkbox__box" aria-hidden="true"></span>
        <span class="hub-checkbox__label">Show Panel</span>
      </label>
      <label class="ml-manage-panel-field">
        <span>Colour</span>
        <input type="color" data-ml-category-panel-color="${esc(categoryId)}" value="${esc(category.panel_color || '#5b9cf6')}" />
      </label>
      <label class="ml-manage-panel-field ml-manage-panel-field--wide">
        <span>Background</span>
        <input type="text" data-ml-category-panel-background="${esc(categoryId)}" value="${esc(category.panel_background || '')}" placeholder="asset path or URL" />
      </label>
      <button class="hub-action-btn ml-manage-mini-action" type="button" data-ml-category-panel-bg-pick="${esc(categoryId)}">Pick</button>
      <button class="hub-action-btn ml-manage-mini-action" type="button" data-ml-category-panel-bg-import="${esc(categoryId)}">Save</button>
      <button class="hub-action-btn ml-manage-mini-action" type="button" data-ml-category-panel-save="${esc(categoryId)}">Apply</button>
    </div>
    <p class="ml-manage-path">${esc(_mlCategoryPath(categoryId))}</p>
    <div class="ml-manage-list">
      ${categoryHtml ? `<p class="ml-manage-section-label">Child categories</p>${categoryHtml}` : ''}
    </div>
    <div class="ml-manage-list">
      ${treeHtml ? `<p class="ml-manage-section-label">Link mappings</p>${treeHtml}` : '<p class="ml-page-empty">No links mapped directly to this category.</p>'}
    </div>`;
  HubModal.open(modal);
}

async function _mlDeleteCategory(categoryId) {
  const category = _manualLinkCategories.find(cat => cat.category_id === categoryId);
  const label = category?.label || 'this category';
  const ok = await HubDialogs.confirmDelete({
    title: 'Delete empty category?',
    message: `Delete ${label} from Manual Links?`,
    detail: 'Only empty categories can be deleted. Links and mappings stay untouched.',
  });
  if (!ok) return;
  const r = await apiFetch(`/api/v1/manual-link-categories/${encodeURIComponent(categoryId)}`, {
    method: 'DELETE',
  });
  if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
  HubModal.close(document.getElementById('ml-category-manage-modal'));
  _mlManagingCategoryId = null;
  await loadManualLinks();
}

async function _mlUpdateCategoryIcon(categoryId, iconPath) {
  await _mlUpdateCategory(categoryId, { icon: iconPath }, { reopenManage: true });
}

function _mlOpenCategoryIconPicker(categoryId) {
  if (typeof AssetPicker === 'undefined') return;
  AssetPicker.open({
    title: 'Choose category icon',
    kind: 'icon',
    browseUrl: '/api/v1/nav-items/assets?type=icons',
    emptyMessage: 'No icons uploaded yet.',
    onSelect: async (assetPath) => {
      await _mlUpdateCategoryIcon(categoryId, assetPath);
    },
  });
}

async function _mlUpdateLinkIcon(linkId, iconPath) {
  const r = await apiFetch(`/api/v1/manual-links/${encodeURIComponent(linkId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ icon: iconPath }),
  });
  if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
  await loadManualLinks();
  if (_mlManagingCategoryId) _mlOpenCategoryManage(_mlManagingCategoryId);
}

function _mlOpenLinkIconPicker(linkId) {
  if (typeof AssetPicker === 'undefined') return;
  AssetPicker.open({
    title: 'Choose link icon',
    kind: 'icon',
    browseUrl: '/api/v1/nav-items/assets?type=icons',
    emptyMessage: 'No icons uploaded yet.',
    onSelect: async (assetPath) => {
      await _mlUpdateLinkIcon(linkId, assetPath);
    },
  });
}

function _mlOpenIconPickerForInput(inputId) {
  if (typeof AssetPicker === 'undefined') return;
  const input = document.getElementById(inputId);
  AssetPicker.open({
    title: 'Choose icon',
    kind: 'icon',
    browseUrl: '/api/v1/nav-items/assets?type=icons',
    emptyMessage: 'No icons uploaded yet.',
    onSelect: async (assetPath) => {
      if (input) input.value = assetPath;
    },
  });
}

async function _mlImportIconUrlForInput(inputId, errorId = 'ml-modal-error') {
  const input = document.getElementById(inputId);
  const err = document.getElementById(errorId);
  if (err) err.textContent = '';
  const url = (input?.value || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    if (err) err.textContent = 'Enter an http(s) icon URL first.';
    return;
  }
  try {
    const r = await apiFetch('/api/v1/nav-items/import-asset-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, asset_type: 'icons' }),
    });
    if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
    const result = await r.json();
    if (input) input.value = result.path;
  } catch (e) {
    if (err) err.textContent = e.message;
    else throw e;
  }
}

function openManualLinkCategoryModal() {
  const dlg = document.getElementById('ml-category-modal');
  const err = document.getElementById('ml-category-modal-error');
  if (!dlg) return;
  if (err) err.textContent = '';
  const roots = _manualLinkCategories.filter(cat => !cat.parent_category_id);
  const nextSort = roots.length ? Math.max(...roots.map(cat => cat.sort_order || 0)) + 1 : 0;
  const values = {
    'ml-category-label': '',
    'ml-category-icon': _ML_DEFAULT_ICON,
    'ml-category-sort-order': String(nextSort),
    'ml-category-panel-color': '#5b9cf6',
    'ml-category-panel-background': '',
    'ml-category-notes': '',
  };
  Object.entries(values).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });
  const showPanel = document.getElementById('ml-category-show-panel');
  if (showPanel) showPanel.checked = false;
  HubModal.open(dlg);
}

async function submitManualLinkCategory() {
  const err = document.getElementById('ml-category-modal-error');
  if (err) err.textContent = '';
  const label = document.getElementById('ml-category-label')?.value.trim() || '';
  if (!label) {
    if (err) err.textContent = 'Label is required.';
    return;
  }
  const body = {
    label,
    icon: document.getElementById('ml-category-icon')?.value.trim() || _ML_DEFAULT_ICON,
    parent_category_id: null,
    sort_order: parseInt(document.getElementById('ml-category-sort-order')?.value || '0', 10),
    show_panel: document.getElementById('ml-category-show-panel')?.checked ? 1 : 0,
    panel_color: document.getElementById('ml-category-panel-color')?.value.trim() || null,
    panel_background: document.getElementById('ml-category-panel-background')?.value.trim() || null,
    notes: document.getElementById('ml-category-notes')?.value.trim() || null,
  };
  try {
    const r = await apiFetch('/api/v1/manual-link-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
    HubModal.close(document.getElementById('ml-category-modal'));
    await loadManualLinks();
  } catch (e) {
    if (err) err.textContent = e.message;
  }
}

async function _mlRemoveCategoryItem(mappingId) {
  const ok = await HubDialogs.confirm({
    title: 'Remove mapping?',
    message: 'Remove this link from the selected category?',
    detail: 'The canonical manual link record will stay intact.',
    tone: 'warning',
    badge: 'Manual',
    confirmText: 'Remove',
  });
  if (!ok) return;
  const r = await apiFetch(`/api/v1/manual-link-categories/items/${encodeURIComponent(mappingId)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
  await loadManualLinks();
  if (_mlManagingCategoryId) _mlOpenCategoryManage(_mlManagingCategoryId);
}

async function _mlMoveCategoryItem(mappingId, categoryId, parentMappingId = null) {
  const source = _manualLinkCategoryItems.find(item => item.mapping_id === mappingId);
  if (!source) throw new Error(`mapping ${mappingId} not found`);
  const itemsByCategory = _mlItemsByCategory();
  const tree = _mlLinkTreeForCategory(source.category_id, itemsByCategory);
  async function moveOne(item, nextParentMappingId) {
    const r = await apiFetch(`/api/v1/manual-link-categories/items/${encodeURIComponent(item.mapping_id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_id: categoryId, parent_mapping_id: nextParentMappingId }),
    });
    if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
    const children = tree.sortItems(tree.childrenByParent.get(item.mapping_id) || []);
    for (const child of children) {
      await moveOne(child, item.mapping_id);
    }
  }
  await moveOne(source, parentMappingId);
  await loadManualLinks();
  if (_mlManagingCategoryId) _mlOpenCategoryManage(_mlManagingCategoryId);
}

async function _mlCopyCategoryItem(mappingId, categoryId, parentMappingId = null) {
  const source = _manualLinkCategoryItems.find(item => item.mapping_id === mappingId);
  if (!source) throw new Error(`mapping ${mappingId} not found`);
  const itemsByCategory = _mlItemsByCategory();
  const tree = _mlLinkTreeForCategory(source.category_id, itemsByCategory);
  async function copyOne(item, nextCategoryId, nextParentMappingId) {
    const r = await apiFetch('/api/v1/manual-link-categories/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_id: nextCategoryId,
        link_id: item.link_id,
        parent_mapping_id: nextParentMappingId,
        sort_order: item.sort_order ?? 0,
        label_override: item.label_override || null,
        notes: item.notes || null,
      }),
    });
    if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
    const copied = await r.json();
    const children = tree.sortItems(tree.childrenByParent.get(item.mapping_id) || []);
    for (const child of children) {
      await copyOne(child, nextCategoryId, copied.mapping_id);
    }
    return copied;
  }
  await copyOne(source, categoryId, parentMappingId);
  await loadManualLinks();
  if (_mlManagingCategoryId) _mlOpenCategoryManage(_mlManagingCategoryId);
}

/* ── Modal: Add / Edit ───────────────────────────────────────────────────── */

function _mlManualLinkTree(excludeLinkId = null) {
  const childrenByParent = new Map();
  const roots = [];
  const sorted = [..._manualLinks]
    .filter(link => link.link_id !== excludeLinkId)
    .sort((a, b) => (a.sort_order - b.sort_order) || (a.label || '').localeCompare(b.label || ''));
  sorted.forEach(link => {
    const parentId = link.parent_id && link.parent_id !== excludeLinkId ? link.parent_id : '';
    if (!parentId || !_manualLinks.some(candidate => candidate.link_id === parentId && candidate.link_id !== excludeLinkId)) {
      roots.push(link);
      return;
    }
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(link);
  });
  return { roots, childrenByParent };
}

function _mlManualLinkLabel(linkId) {
  if (!linkId) return '— none —';
  const link = _manualLinks.find(item => item.link_id === linkId);
  return link ? (link.label || link.link_id.slice(0, 8)) : '— none —';
}

function _mlSetParentSelection(linkId) {
  const input = document.getElementById('ml-parent-id');
  const label = document.getElementById('ml-parent-picker-label');
  if (input) input.value = linkId || '';
  if (label) label.textContent = _mlManualLinkLabel(linkId);
}

function _mlParentPickerHtml(selectedId, excludeLinkId) {
  const { roots, childrenByParent } = _mlManualLinkTree(excludeLinkId);
  const renderLink = (link, depth) => {
    if (depth > 12) return '';
    const children = childrenByParent.get(link.link_id) || [];
    const active = selectedId === link.link_id ? ' is-selected' : '';
    const button = `<button class="ml-parent-choice${active}" type="button" data-ml-parent-choice="${esc(link.link_id)}" style="--ml-parent-depth:${depth}">
      ${_mlIconHtml(_mlLinkIcon(link), 'ml-grid-icon ml-grid-icon--small')}<span>${esc(link.label || link.link_id.slice(0, 8))}</span>
    </button>`;
    if (!children.length) return button;
    return `<details class="ml-parent-node" open>
      <summary style="--ml-parent-depth:${depth}">${_mlIconHtml(_mlLinkIcon(link), 'ml-grid-icon ml-grid-icon--small')}<span>${esc(link.label || link.link_id.slice(0, 8))}</span></summary>
      <div>${button}${children.map(child => renderLink(child, depth + 1)).join('')}</div>
    </details>`;
  };
  return `<button class="ml-parent-choice${!selectedId ? ' is-selected' : ''}" type="button" data-ml-parent-choice="" style="--ml-parent-depth:0">— none —</button>
    ${roots.map(link => renderLink(link, 0)).join('') || '<p class="ml-page-empty">No parent links available.</p>'}`;
}

function openManualLinkModal(linkId) {
  _editingLinkId = linkId || null;
  const dlg = document.getElementById('ml-modal');
  const badge = document.getElementById('ml-modal-badge');
  if (badge) badge.textContent = linkId ? 'EDIT' : 'ADD';
  document.getElementById('ml-modal-title').textContent = linkId ? 'Edit link' : 'Add link';
  const modalErr = document.getElementById('ml-modal-error');
  if (modalErr) modalErr.textContent = '';

  const defaults = {
    link_id: '', vlan_ip: '', vlan_uri: '', tailnet_ip: '', tailnet_uri: '',
    label: '', icon: '', group_name: '', parent_id: '', sort_order: 0,
    pve_host: '', is_internet: 0, vm_id: '', vm_name: '', lxc_id: '', lxc_name: '', notes: '',
  };
  const lnk = linkId ? (_manualLinks.find(l => l.link_id === linkId) || defaults) : defaults;

  const parentPanel = document.getElementById('ml-parent-picker-panel');
  if (parentPanel) parentPanel.innerHTML = _mlParentPickerHtml(lnk.parent_id || '', linkId);

  const fields = ['vlan_ip','vlan_uri','tailnet_ip','tailnet_uri','label','icon','group_name','sort_order','pve_host','vm_id','vm_name','lxc_id','lxc_name','location','notes'];
  fields.forEach(f => {
    const el = document.getElementById(`ml-${f.replace(/_/g,'-')}`);
    if (el) el.value = lnk[f] !== null && lnk[f] !== undefined ? lnk[f] : '';
  });
  document.getElementById('ml-is-internet').checked = !!lnk.is_internet;
  _mlSetParentSelection(lnk.parent_id || '');

  HubModal.open(dlg);
}

async function submitManualLink() {
  const modalErr = document.getElementById('ml-modal-error');
  if (modalErr) modalErr.textContent = '';
  const get = id => document.getElementById(id)?.value?.trim() ?? '';
  const body = {
    vlan_ip:     get('ml-vlan-ip')     || null,
    vlan_uri:    get('ml-vlan-uri')    || null,
    tailnet_ip:  get('ml-tailnet-ip')  || null,
    tailnet_uri: get('ml-tailnet-uri') || null,
    label:       get('ml-label')       || null,
    icon:        get('ml-icon')        || null,
    group_name:  get('ml-group-name')  || null,
    parent_id:   get('ml-parent-id')   || null,
    sort_order:  parseInt(get('ml-sort-order') || '0', 10),
    pve_host:    get('ml-pve-host')    || null,
    is_internet: document.getElementById('ml-is-internet').checked ? 1 : 0,
    vm_id:       get('ml-vm-id')       || null,
    vm_name:     get('ml-vm-name')     || null,
    lxc_id:      get('ml-lxc-id')      || null,
    lxc_name:    get('ml-lxc-name')    || null,
    location:    get('ml-location')    || null,
    notes:       get('ml-notes')       || null,
  };

  try {
    if (_editingLinkId) {
      const r = await apiFetch(`/api/v1/manual-links/${_editingLinkId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
    } else {
      const r = await apiFetch('/api/v1/manual-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
    }
    HubModal.close(document.getElementById('ml-modal'));
    await loadManualLinks();
  } catch (e) {
    if (modalErr) modalErr.textContent = e.message;
  }
}

async function deleteManualLink(linkId) {
  const ok = await HubDialogs.confirmDelete({
    title: 'Delete manual link?',
    message: 'Delete this manual link from Blueprints?',
    detail: 'This removes the link record from Blueprints only.',
  });
  if (!ok) return;
  const err = document.getElementById('ml-error');
  if (err) err.hidden = true;
  try {
    const r = await apiFetch(`/api/v1/manual-links/${linkId}`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
    await loadManualLinks();
  } catch (e) {
    if (err) { err.textContent = e.message; err.hidden = false; }
    await HubDialogs.alertError({
      title: 'Delete failed',
      message: `Failed to delete manual link: ${e.message}`,
    });
  }
}

/* ── Helper: setEl (local fallback if not in utils.js) ──────────────────── */
// No setEl in this codebase — direct DOM manipulation used instead (see above)

/* ── Bootstrap ─────────────────────────────────────────────────────────────────────── */
// Wire the header filter input and register the page-controls group
// for the manual-links-table pseudo-tab (switchTab redirects to it via
// manualLinksShowView, so ResponsiveLayout.updateControlsForTab is driven
// from there rather than from the normal switchTab flow).

document.addEventListener('DOMContentLoaded', () => {
  _ensureManualLinksTableView();
  _ensureManualLinksLayoutController()?.init();
  document.getElementById('ml-modal-save-btn')?.addEventListener('click', submitManualLink);
  document.getElementById('ml-icon-pick-btn')?.addEventListener('click', () => _mlOpenIconPickerForInput('ml-icon'));
  document.getElementById('ml-icon-import-btn')?.addEventListener('click', () => { void _mlImportIconUrlForInput('ml-icon', 'ml-modal-error'); });
  document.getElementById('ml-parent-picker-btn')?.addEventListener('click', () => {
    const panel = document.getElementById('ml-parent-picker-panel');
    const btn = document.getElementById('ml-parent-picker-btn');
    if (!panel) return;
    panel.hidden = !panel.hidden;
    if (btn) btn.setAttribute('aria-expanded', String(!panel.hidden));
  });
  document.getElementById('ml-parent-picker-panel')?.addEventListener('click', e => {
    const choice = e.target.closest('[data-ml-parent-choice]');
    if (!choice) return;
    _mlSetParentSelection(choice.dataset.mlParentChoice || '');
    document.getElementById('ml-parent-picker-panel').hidden = true;
    document.getElementById('ml-parent-picker-btn')?.setAttribute('aria-expanded', 'false');
  });
  document.getElementById('ml-category-modal-save-btn')?.addEventListener('click', submitManualLinkCategory);
  document.getElementById('ml-category-icon-pick-btn')?.addEventListener('click', () => _mlOpenIconPickerForInput('ml-category-icon'));
  document.getElementById('ml-category-icon-import-btn')?.addEventListener('click', () => { void _mlImportIconUrlForInput('ml-category-icon', 'ml-category-modal-error'); });
  document.getElementById('ml-category-panel-bg-pick-btn')?.addEventListener('click', () => _mlOpenIconPickerForInput('ml-category-panel-background'));
  document.getElementById('ml-category-panel-bg-import-btn')?.addEventListener('click', () => { void _mlImportIconUrlForInput('ml-category-panel-background', 'ml-category-modal-error'); });
  document.getElementById('ml-cols-modal-apply')?.addEventListener('click', _mlApplyColsModal);

  const mlFilter = document.getElementById('ml-filter');
  if (mlFilter) {
    mlFilter.addEventListener('input', () => {
      clearTimeout(_mlFilterTimer);
      _mlFilterTimer = setTimeout(renderManualLinksTable, 250);
    });
  }
  document.getElementById('ml-tbody')?.addEventListener('click', e => {
    const groupRow = e.target.closest('tr.ml-group-hdr[data-gkey]');
    if (groupRow) {
      mlToggleGroup(groupRow.dataset.gkey);
      return;
    }
    const editBtn = e.target.closest('[data-ml-edit]');
    if (editBtn) {
      openManualLinkModal(editBtn.dataset.mlEdit);
      return;
    }
    const delBtn = e.target.closest('[data-ml-del]');
    if (delBtn) {
      deleteManualLink(delBtn.dataset.mlDel);
      return;
    }
    const actionsBtn = e.target.closest('[data-ml-row-actions]');
    if (actionsBtn) {
      _mlOpenRowActions(actionsBtn.dataset.mlRowActions);
    }
  });
  document.getElementById('ml-grid-body')?.addEventListener('click', e => {
    if (_mlGridInteractionFsm.consumeSyntheticClick(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (_mlPickedCategory) {
      void _mlPlacePickedCategory(e);
      return;
    }
    const panelHandle = e.target.closest('[data-ml-panel-drag-handle]');
    if (panelHandle) {
      const panel = panelHandle.closest('[data-ml-grid-panel]');
      if (panel) {
        e.preventDefault();
        e.stopPropagation();
        _mlRevealPanelResizeHandles(panel);
        return;
      }
    }
    const link = e.target.closest('[data-ml-grid-link]');
    if (link) {
      e.preventDefault();
      e.stopPropagation();
      _mlHandleLeafClick(link, 'click', { clickDetail: e.detail });
      return;
    }
    const toggle = e.target.closest('[data-ml-grid-toggle]');
    if (toggle) {
      const categoryId = toggle.dataset.mlGridToggle;
      if (_mlGridOpen.has(categoryId)) _mlGridOpen.delete(categoryId);
      else {
        _mlGridOpen.clear();
        _mlGridOpen.add(categoryId);
      }
      renderManualLinksGrid();
      return;
    }
    const manage = e.target.closest('[data-ml-grid-manage]');
    if (manage) {
      _mlOpenCategoryManage(manage.dataset.mlGridManage);
    }
  });
  document.getElementById('ml-grid-body')?.addEventListener('dblclick', e => {
    const link = e.target.closest('[data-ml-grid-link]');
    if (!link) return;
    e.preventDefault();
    e.stopPropagation();
    _mlHandleLeafClick(link, 'dblclick');
  });
  document.getElementById('ml-grid-body')?.addEventListener('toggle', e => {
    const branch = e.target.closest?.('.ml-grid-link-branch[data-ml-grid-mapping]');
    if (!branch || !document.getElementById('ml-grid-body')?.contains(branch)) return;
    const mappingId = branch.dataset.mlGridMapping;
    if (!mappingId) return;
    if (branch.open) _mlGridOpenLinkBranches.add(mappingId);
    else _mlGridOpenLinkBranches.delete(mappingId);
  }, true);
  document.getElementById('ml-grid-body')?.addEventListener('contextmenu', e => {
    if (!e.target.closest('[data-ml-grid-mapping-drag], [data-ml-panel-drag-handle], [data-ml-grid-toggle]')) return;
    e.preventDefault();
  });
  document.getElementById('ml-grid-body')?.addEventListener('dragstart', e => {
    const mappingDrag = e.target.closest('[data-ml-grid-mapping-drag]');
    if (mappingDrag) {
      _mlGridDragId = mappingDrag.dataset.mlGridMappingDrag;
      const mapping = _manualLinkCategoryItems.find(item => item.mapping_id === _mlGridDragId);
      _mlGridDragKind = 'mapping';
      _mlGridDragSourceParent = mapping?.category_id || '';
      _mlGridDragOffsetX = null;
      _mlGridDragOffsetY = null;
      _mlSuppressLeafClickBriefly();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', _mlGridDragId);
      return;
    }
    const card = e.target.closest('[data-ml-grid-card]');
    if (!card) return;
    if (card.matches('[data-ml-grid-panel]') && !e.target.closest('[data-ml-panel-drag-handle]')) {
      e.preventDefault();
      return;
    }
    _mlGridDragId = card.dataset.categoryId;
    _mlGridDragKind = 'category';
    _mlGridDragSourceParent = card.parentElement?.closest('[data-ml-grid-panel]')?.dataset.categoryId || '';
    const rect = card.getBoundingClientRect();
    _mlGridDragOffsetX = Number.isFinite(Number(e.clientX)) && e.clientX > 0 ? e.clientX - rect.left : Math.min(rect.width / 2, 40);
    _mlGridDragOffsetY = Number.isFinite(Number(e.clientY)) && e.clientY > 0 ? e.clientY - rect.top : Math.min(rect.height / 2, 24);
    // For panels, show the whole panel as the drag ghost rather than just the title
    // handle, so the user sees exactly what they are moving and where it will land.
    if (card.matches('[data-ml-grid-panel]')) {
      try { e.dataTransfer.setDragImage(card, Math.round(_mlGridDragOffsetX), Math.round(_mlGridDragOffsetY)); } catch (_) {}
    }
    _mlClearCategoryNestIntent();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', _mlGridDragId);
  });
  document.getElementById('ml-grid-body')?.addEventListener('dragover', e => {
    const droppedUrl = _mlExtractDroppedUrl(e.dataTransfer);
    if (!_mlGridDragId && !droppedUrl && !_mlMayContainDroppedUrl(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = _mlGridDragId ? 'move' : 'copy';
    if (_mlGridDragKind !== 'category') {
      _mlClearCategoryNestIntent();
      _mlClearGridDropTarget();
      return;
    }
    const targetCard = e.target.closest('[data-ml-grid-card]');
    const dropZone = e.target.closest('[data-ml-drop-zone]');
    const board = e.target.closest('.ml-grid-board') || document.querySelector('#ml-grid-body .ml-grid-board');
    if (board) _mlShowGridDropTarget(board, e);
    else _mlClearGridDropTarget();
    const explicitStructuralDrop = !!dropZone && (!targetCard || targetCard.contains(dropZone));
    _mlUpdateCategoryNestIntent(_mlGridDragId, explicitStructuralDrop ? null : targetCard);
  });
  document.getElementById('ml-grid-body')?.addEventListener('drop', async e => {
    e.preventDefault();
    const droppedUrl = _mlExtractDroppedUrl(e.dataTransfer);
    if (!_mlGridDragId && droppedUrl) {
      const targetCard = e.target.closest('[data-ml-grid-card]');
      const dropZone = e.target.closest('[data-ml-drop-zone]');
      const targetCategoryId = dropZone?.dataset.mlDropParent || targetCard?.dataset.categoryId || '';
      try {
        await _mlIntakeDroppedUrl(droppedUrl, targetCategoryId);
      } catch (err) {
        await HubDialogs.alertError({ title: 'URL intake failed', message: err.message });
      }
      return;
    }
    if (!_mlGridDragId) return;
    const draggedId = _mlGridDragId;
    const targetCard = e.target.closest('[data-ml-grid-card]');
    const dropZone = e.target.closest('[data-ml-drop-zone]');
    const board = e.target.closest('.ml-grid-board');
    try {
      if (_mlGridDragKind === 'mapping') {
        const targetCategoryId = dropZone?.dataset.mlDropParent || targetCard?.dataset.categoryId || '';
        await _mlPromoteOrMoveMapping(draggedId, targetCategoryId || null);
        _mlGridDragId = null;
        _mlGridDragKind = null;
        _mlGridDragSourceParent = null;
        _mlGridDragOffsetX = null;
        _mlGridDragOffsetY = null;
        _mlClearCategoryNestIntent();
        _mlClearGridDropTarget();
        return;
      }
      await _mlHandleCategoryDrop(draggedId, targetCard, dropZone, board, e);
    } catch (err) {
      await HubDialogs.alertError({
        title: 'Category move failed',
        message: err.message,
      });
    }
    _mlGridDragId = null;
    _mlGridDragKind = null;
    _mlGridDragSourceParent = null;
    _mlGridDragOffsetX = null;
    _mlGridDragOffsetY = null;
    _mlClearCategoryNestIntent();
    _mlClearGridDropTarget();
  });
  document.getElementById('ml-grid-body')?.addEventListener('dragend', () => {
    _mlGridDragId = null;
    _mlGridDragKind = null;
    _mlGridDragSourceParent = null;
    _mlGridDragOffsetX = null;
    _mlGridDragOffsetY = null;
    _mlClearCategoryNestIntent();
    _mlClearGridDropTarget();
  });
  document.getElementById('ml-grid-body')?.addEventListener('pointerdown', e => _mlGridInteractionFsm.pointerDown(e));
  document.getElementById('ml-grid-body')?.addEventListener('pointerdown', e => {
    const handle = e.target.closest('[data-ml-panel-resize]');
    if (handle) _mlStartPanelResize(e, handle);
  });
  document.getElementById('ml-grid-body')?.addEventListener('pointermove', e => _mlGridInteractionFsm.pointerMove(e));
  document.getElementById('ml-grid-body')?.addEventListener('pointermove', _mlUpdatePanelResize);
  document.getElementById('ml-grid-body')?.addEventListener('pointerup', e => _mlGridInteractionFsm.pointerUp(e));
  document.getElementById('ml-grid-body')?.addEventListener('pointerup', _mlFinishPanelResize);
  document.getElementById('ml-grid-body')?.addEventListener('pointercancel', e => _mlGridInteractionFsm.pointerCancel(e));
  document.getElementById('ml-grid-body')?.addEventListener('pointercancel', _mlFinishPanelResize);
  document.addEventListener('pointermove', e => _mlGridInteractionFsm.pointerMove(e), { passive: false });
  document.addEventListener('pointerup', e => _mlGridInteractionFsm.pointerUp(e), { passive: false });
  document.addEventListener('pointercancel', e => _mlGridInteractionFsm.pointerCancel(e), { passive: false });
  document.getElementById('ml-grid-body')?.addEventListener('touchstart', e => _mlGridInteractionFsm.touchStartFallback(e), { passive: false });
  document.addEventListener('touchmove', e => _mlGridInteractionFsm.touchMoveFallback(e), { passive: false });
  document.addEventListener('touchend', e => _mlGridInteractionFsm.touchEndFallback(e), { passive: false });
  document.addEventListener('touchcancel', e => _mlGridInteractionFsm.touchEndFallback(e), { passive: false });
  document.getElementById('ml-link-detail-body')?.addEventListener('click', async e => {
    const fullEdit = e.target.closest('[data-ml-detail-full-edit]');
    if (fullEdit) {
      e.preventDefault();
      HubModal.close(document.getElementById('ml-link-detail-modal'));
      openManualLinkModal(fullEdit.dataset.mlDetailFullEdit);
      return;
    }
    const save = e.target.closest('[data-ml-detail-save]');
    if (save) {
      e.preventDefault();
      const editor = save.closest('[data-ml-detail-editor]');
      await _mlSaveLinkDetail(editor);
    }
  });
  document.getElementById('ml-category-manage-body')?.addEventListener('click', async e => {
    try {
      const deleteCategory = e.target.closest('[data-ml-delete-category]');
      if (deleteCategory) {
        e.preventDefault();
        e.stopPropagation();
        await _mlDeleteCategory(deleteCategory.dataset.mlDeleteCategory);
        return;
      }
      const openCategoryManage = e.target.closest('[data-ml-open-category-manage]');
      if (openCategoryManage) {
        e.preventDefault();
        e.stopPropagation();
        _mlOpenCategoryManage(openCategoryManage.dataset.mlOpenCategoryManage);
        return;
      }
      const categoryToggle = e.target.closest('[data-ml-category-manage-toggle]');
      if (categoryToggle) {
        e.preventDefault();
        e.stopPropagation();
        const node = categoryToggle.closest('[data-ml-category-manage-node]');
        const panel = node?.querySelector(':scope > .ml-manage-node-panel');
        if (node && panel) {
          const open = panel.hidden;
          panel.hidden = !open;
          node.classList.toggle('is-open', open);
        }
        return;
      }
      const categoryDestTrigger = e.target.closest('[data-ml-category-dest-trigger]');
      if (categoryDestTrigger) {
        e.preventDefault();
        e.stopPropagation();
        const row = categoryDestTrigger.closest('[data-category-id]');
        const panel = row?.querySelector(`[data-ml-category-dest-panel="${CSS.escape(categoryDestTrigger.dataset.mlCategoryDestTrigger)}"]`);
        if (!panel) return;
        row.closest('#ml-category-manage-body')?.querySelectorAll('.ml-dest-picker').forEach(other => {
          if (other !== panel) other.hidden = true;
        });
        panel.hidden = !panel.hidden;
        _mlPositionDestinationPicker(categoryDestTrigger, panel);
        return;
      }
      const categoryChoice = e.target.closest('[data-ml-category-dest-choice]');
      if (categoryChoice) {
        e.preventDefault();
        e.stopPropagation();
        if (categoryChoice.disabled) return;
        const row = categoryChoice.closest('[data-category-id]');
        if (!row) return;
        row.dataset.mlCategoryDestinationId = categoryChoice.dataset.mlCategoryDestChoice || '';
        const label = row.querySelector('[data-ml-category-dest-label]');
        if (label) label.textContent = categoryChoice.dataset.mlCategoryDestLabel || 'Top categories';
        const panel = categoryChoice.closest('.ml-dest-picker');
        if (panel) panel.hidden = true;
        return;
      }
      const moveCategoryTop = e.target.closest('[data-ml-move-category-top]');
      if (moveCategoryTop) {
        e.preventDefault();
        e.stopPropagation();
        await _mlMoveCategory(moveCategoryTop.dataset.mlMoveCategoryTop, null);
        if (_mlManagingCategoryId) _mlOpenCategoryManage(_mlManagingCategoryId);
        return;
      }
      const moveCategory = e.target.closest('[data-ml-move-category]');
      if (moveCategory) {
        e.preventDefault();
        e.stopPropagation();
        const row = moveCategory.closest('[data-category-id]');
        await _mlMoveCategory(moveCategory.dataset.mlMoveCategory, row?.dataset.mlCategoryDestinationId || null);
        if (_mlManagingCategoryId) _mlOpenCategoryManage(_mlManagingCategoryId);
        return;
      }
      const linkIcon = e.target.closest('[data-ml-link-icon]');
      if (linkIcon) {
        e.preventDefault();
        e.stopPropagation();
        _mlOpenLinkIconPicker(linkIcon.dataset.mlLinkIcon);
        return;
      }
      const categoryIcon = e.target.closest('[data-ml-category-icon]');
      if (categoryIcon) {
        e.preventDefault();
        e.stopPropagation();
        _mlOpenCategoryIconPicker(categoryIcon.dataset.mlCategoryIcon);
        return;
      }
      const categoryIconDefault = e.target.closest('[data-ml-category-icon-default]');
      if (categoryIconDefault) {
        e.preventDefault();
        e.stopPropagation();
        await _mlUpdateCategoryIcon(categoryIconDefault.dataset.mlCategoryIconDefault, _ML_DEFAULT_ICON);
        return;
      }
      const categoryDetailsSave = e.target.closest('[data-ml-category-details-save]');
      if (categoryDetailsSave) {
        e.preventDefault();
        e.stopPropagation();
        const categoryId = categoryDetailsSave.dataset.mlCategoryDetailsSave;
        const label = document.querySelector(`[data-ml-category-label="${CSS.escape(categoryId)}"]`)?.value?.trim();
        if (!label) {
          await HubDialogs.alertError({ title: 'Category save failed', message: 'Category name cannot be blank.' });
          return;
        }
        await _mlUpdateCategory(categoryId, {
          label,
          notes: document.querySelector(`[data-ml-category-notes="${CSS.escape(categoryId)}"]`)?.value?.trim() || null,
        }, { reopenManage: true });
        const updated = _manualLinkCategories.find(cat => cat.category_id === categoryId);
        if (updated && document.getElementById('ml-category-manage-title')) {
          document.getElementById('ml-category-manage-title').textContent = updated.label;
        }
        return;
      }
      const panelPick = e.target.closest('[data-ml-category-panel-bg-pick]');
      if (panelPick) {
        e.preventDefault();
        e.stopPropagation();
        const categoryId = panelPick.dataset.mlCategoryPanelBgPick;
        const input = document.querySelector(`[data-ml-category-panel-background="${CSS.escape(categoryId)}"]`);
        if (typeof AssetPicker !== 'undefined') {
          AssetPicker.open({
            title: 'Choose panel background',
            kind: 'icon',
            browseUrl: '/api/v1/nav-items/assets?type=icons',
            emptyMessage: 'No images uploaded yet.',
            onSelect: async (assetPath) => {
              if (input) input.value = assetPath;
            },
          });
        }
        return;
      }
      const panelImport = e.target.closest('[data-ml-category-panel-bg-import]');
      if (panelImport) {
        e.preventDefault();
        e.stopPropagation();
        const categoryId = panelImport.dataset.mlCategoryPanelBgImport;
        const input = document.querySelector(`[data-ml-category-panel-background="${CSS.escape(categoryId)}"]`);
        const url = (input?.value || '').trim();
        if (!/^https?:\/\//i.test(url)) {
          await HubDialogs.alertError({ title: 'Panel background import failed', message: 'Enter an http(s) image URL first.' });
          return;
        }
        const r = await apiFetch('/api/v1/nav-items/import-asset-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, asset_type: 'icons' }),
        });
        if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
        const result = await r.json();
        if (input) input.value = result.path;
        return;
      }
      const panelSave = e.target.closest('[data-ml-category-panel-save]');
      if (panelSave) {
        e.preventDefault();
        e.stopPropagation();
        const categoryId = panelSave.dataset.mlCategoryPanelSave;
        await _mlUpdateCategory(categoryId, {
          show_panel: document.querySelector(`[data-ml-category-show-panel="${CSS.escape(categoryId)}"]`)?.checked ? 1 : 0,
          panel_color: document.querySelector(`[data-ml-category-panel-color="${CSS.escape(categoryId)}"]`)?.value || null,
          panel_background: document.querySelector(`[data-ml-category-panel-background="${CSS.escape(categoryId)}"]`)?.value?.trim() || null,
        }, { reopenManage: true });
        return;
      }
      const manageToggle = e.target.closest('[data-ml-manage-toggle]');
      if (manageToggle) {
        e.preventDefault();
        e.stopPropagation();
        const node = manageToggle.closest('[data-ml-manage-node]');
        const panel = node?.querySelector(':scope > .ml-manage-node-panel');
        if (node && panel) {
          const open = panel.hidden;
          panel.hidden = !open;
          node.classList.toggle('is-open', open);
        }
        return;
      }
      const destTrigger = e.target.closest('[data-ml-dest-trigger]');
      if (destTrigger) {
        e.preventDefault();
        e.stopPropagation();
        const row = destTrigger.closest('[data-mapping-id]');
        const panel = row?.querySelector(`[data-ml-dest-panel="${CSS.escape(destTrigger.dataset.mlDestTrigger)}"]`);
        if (!panel) return;
        row.closest('#ml-category-manage-body')?.querySelectorAll('.ml-dest-picker').forEach(other => {
          if (other !== panel) other.hidden = true;
        });
        panel.hidden = !panel.hidden;
        _mlPositionDestinationPicker(destTrigger, panel);
        return;
      }
      const choice = e.target.closest('[data-ml-dest-choice]');
      if (choice) {
        e.preventDefault();
        e.stopPropagation();
        if (choice.disabled) return;
        const row = choice.closest('[data-mapping-id]');
        if (!row) return;
        row.dataset.mlDestinationId = choice.dataset.mlDestChoice;
        row.dataset.mlDestinationParentId = choice.dataset.mlDestParent || '';
        const label = row.querySelector('[data-ml-dest-label]');
        if (label) label.textContent = choice.dataset.mlDestLabel || choice.textContent.trim();
        const panel = choice.closest('.ml-dest-picker');
        if (panel) panel.hidden = true;
        return;
      }
      const remove = e.target.closest('[data-ml-remove-item]');
      if (remove) {
        e.preventDefault();
        e.stopPropagation();
        await _mlRemoveCategoryItem(remove.dataset.mlRemoveItem);
        return;
      }
      const copy = e.target.closest('[data-ml-copy-item]');
      if (copy) {
        e.preventDefault();
        e.stopPropagation();
        const row = copy.closest('[data-mapping-id]');
        const categoryId = row?.dataset.mlDestinationId;
        const parentMappingId = row?.dataset.mlDestinationParentId || null;
        if (categoryId) await _mlCopyCategoryItem(copy.dataset.mlCopyItem, categoryId, parentMappingId);
        return;
      }
      const move = e.target.closest('[data-ml-move-item]');
      if (move) {
        e.preventDefault();
        e.stopPropagation();
        const row = move.closest('[data-mapping-id]');
        const categoryId = row?.dataset.mlDestinationId;
        const parentMappingId = row?.dataset.mlDestinationParentId || null;
        if (categoryId) await _mlMoveCategoryItem(move.dataset.mlMoveItem, categoryId, parentMappingId);
      }
    } catch (err) {
      await HubDialogs.alertError({
        title: 'Manual Links update failed',
        message: err.message,
      });
    }
  });
  if (typeof ResponsiveLayout !== 'undefined') {
    ResponsiveLayout.registerTabControls('manual-links-table', 'pg-ctrl-manual-links-table');
  }
  _mlInstallShadeViewportBinding();
  window.addEventListener('resize', _mlHandleGridViewportChange, { passive: true });
  window.addEventListener('orientationchange', _mlHandleGridViewportChange, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', _mlHandleGridViewportChange, { passive: true });
    window.visualViewport.addEventListener('scroll', _mlScheduleGridViewportFit, { passive: true });
  }
});
