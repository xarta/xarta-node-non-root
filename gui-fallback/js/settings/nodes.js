/* ── Nodes ────────────────────────────────────────────────────────────── */

const _NODE_COLS = ['display_name', 'addresses', 'hostnames', 'gen', 'commit', 'commit_non_root', 'commit_inner', 'pending', '_actions'];
const _NODE_FIELD_META = {
  display_name: { label: 'Display Name', sortKey: 'display_name' },
  addresses: { label: 'Addresses', sortKey: 'addresses' },
  hostnames: { label: 'Hostnames', sortKey: 'hostnames' },
  gen: { label: 'Gen', sortKey: 'gen' },
  commit: { label: 'Commit (Outer)', sortKey: 'commit' },
  commit_non_root: { label: 'Commit (Non-root)', sortKey: 'commit_non_root' },
  commit_inner: { label: 'Commit (Inner)', sortKey: 'commit_inner' },
  pending: { label: 'Pending', sortKey: 'pending' },
  _actions: { label: 'Actions' },
};

const _NODE_ACTION_INLINE_WIDTH = 172;
const _NODE_ACTION_COMPACT_WIDTH = 48;

let _nodesTableView = null;
let _nodeRestartLongPressTimer = null;
let _nodeRestartLongPressFiredAt = 0;
let _nodeRestartSuppressNextClick = false;
let _fleetHealthRunning = false;

document.addEventListener('DOMContentLoaded', () => {
  const retouchBtn = document.getElementById('retouch-btn');
  if (retouchBtn) {
    retouchBtn.addEventListener('click', function() { retouchTable(this); });
  }
  const retouchAllBtn = document.getElementById('retouch-all-btn');
  if (retouchAllBtn) {
    retouchAllBtn.addEventListener('click', openRetouchAllModal);
  }
  const cancelBtn = document.getElementById('retouch-all-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', cancelRetouchAll);
  }
  const syncRefreshBtn = document.getElementById('sync-status-refresh-btn');
  if (syncRefreshBtn) {
    syncRefreshBtn.addEventListener('click', function() {
      if (typeof loadSyncStatus === 'function') loadSyncStatus();
    });
  }
  document.getElementById('fleet-health-run-btn')?.addEventListener('click', () => {
    runFleetHealthChecks({ source: 'manual' });
  });
  document.getElementById('fleet-health-copy-btn')?.addEventListener('click', copyFleetHealthReport);
  document.getElementById('fleet-health-clear-btn')?.addEventListener('click', clearFleetHealthReport);
  const actionConfirmBtn = document.getElementById('node-action-modal-confirm');
  if (actionConfirmBtn && !actionConfirmBtn.dataset.bound) {
    actionConfirmBtn.addEventListener('click', submitNodeActionModal);
    actionConfirmBtn.dataset.bound = '1';
  }
  const restartConfirmBtn = document.getElementById('node-restart-modal-confirm');
  if (restartConfirmBtn && !restartConfirmBtn.dataset.bound) {
    restartConfirmBtn.addEventListener('click', submitNodeRestart);
    restartConfirmBtn.dataset.bound = '1';
  }
  const lxcRebootConfirmBtn = document.getElementById('node-lxc-reboot-modal-confirm');
  if (lxcRebootConfirmBtn && !lxcRebootConfirmBtn.dataset.bound) {
    lxcRebootConfirmBtn.addEventListener('click', submitNodeLxcReboot);
    lxcRebootConfirmBtn.dataset.bound = '1';
  }
  const lxcRebootForceBtn = document.getElementById('node-lxc-reboot-modal-force');
  if (lxcRebootForceBtn && !lxcRebootForceBtn.dataset.bound) {
    lxcRebootForceBtn.addEventListener('click', submitNodeLxcForceCycle);
    lxcRebootForceBtn.dataset.bound = '1';
  }
  if (typeof HubSelect !== 'undefined') {
    HubSelect.init('retouch-table-select');
  }
  // Populate the retouch select from the API — the backend owns the syncable table list.
  loadRetouchTableSelect();
  _ensureNodesTableView();
  _ensureNodesLayoutController()?.init();
  document.getElementById('nodes-cols-modal-apply')?.addEventListener('click', _applyNodesColsModal);
  document.getElementById('nodes-tbody')?.addEventListener('click', e => {
    const restartBtn = e.target.closest('[data-node-restart]');
    if (restartBtn) {
      if (_nodeRestartSuppressNextClick || Date.now() - _nodeRestartLongPressFiredAt < 900) {
        _nodeRestartSuppressNextClick = false;
        e.preventDefault();
        return;
      }
      nodeRestart(restartBtn.dataset.nodeRestart, restartBtn);
      return;
    }

    const pullBtn = e.target.closest('[data-node-pull]');
    if (pullBtn) {
      nodeGitPull(pullBtn.dataset.nodePull, pullBtn);
      return;
    }

    const queueBtn = e.target.closest('[data-node-queue]');
    if (queueBtn) {
      nodePurgeQueue(queueBtn.dataset.nodeQueue, queueBtn);
      return;
    }

    const pctBtn = e.target.closest('[data-node-pct]');
    if (pctBtn) {
      nodePct(pctBtn.dataset.nodePct, pctBtn);
      return;
    }

    const deleteBtn = e.target.closest('[data-node-delete]');
    if (deleteBtn) {
      nodeDeleteRow(deleteBtn.dataset.nodeDelete, deleteBtn);
      return;
    }

    const rowActionsBtn = e.target.closest('[data-node-actions]');
    if (rowActionsBtn) {
      _openNodeRowActions(rowActionsBtn.dataset.nodeActions);
    }
  });
  const nodesTbody = document.getElementById('nodes-tbody');
  nodesTbody?.addEventListener('pointerdown', e => {
    const restartBtn = e.target.closest('[data-node-restart]');
    if (!restartBtn || restartBtn.disabled) return;
    clearTimeout(_nodeRestartLongPressTimer);
    _nodeRestartLongPressTimer = setTimeout(() => {
      _nodeRestartLongPressFiredAt = Date.now();
      _nodeRestartSuppressNextClick = true;
      openNodeLxcRebootModal(restartBtn.dataset.nodeRestart, restartBtn);
      setTimeout(() => { _nodeRestartSuppressNextClick = false; }, 2500);
    }, 700);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(eventName => {
    nodesTbody?.addEventListener(eventName, () => {
      clearTimeout(_nodeRestartLongPressTimer);
      _nodeRestartLongPressTimer = null;
    });
  });
  nodesTbody?.addEventListener('contextmenu', e => {
    if (!e.target.closest('[data-node-restart]')) return;
    e.preventDefault();
  });
  _nodesTableView?.onLayoutChange(() => {
    renderNodes();
  });
  if (typeof ResponsiveLayout !== 'undefined') {
    ResponsiveLayout.registerTabControls('nodes', 'pg-ctrl-nodes');
  }
});

let _pendingNodeAction = null;
let _pendingNodeRestart = null;
let _pendingNodeLxcReboot = null;
let _nodeLxcRebootTimer = null;
let _nodeLxcRebootPollTimer = null;

function _ensureNodesTableView() {
  if (_nodesTableView || typeof TableView === 'undefined') return _nodesTableView;
  _nodesTableView = TableView.create({
    storageKey: 'nodes-table-prefs',
    columns: _NODE_COLS,
    meta: _NODE_FIELD_META,
    getTable: () => document.getElementById('nodes-table'),
    fallbackColumn: 'display_name',
    minWidth: 40,
    getDefaultWidth: col => col === '_actions' && _nodeCompactRowActions() ? _nodeActionCellWidth() : null,
    sort: {
      storageKey: 'nodes-table-sort',
      defaultKey: 'display_name',
      defaultDir: 1,
    },
    onSortChange: () => {
      renderNodes();
      _ensureNodesLayoutController()?.scheduleLayoutSave();
    },
    onColumnResizeEnd: () => {
      _ensureNodesLayoutController()?.scheduleLayoutSave();
    },
  });
  return _nodesTableView;
}

let _nodesLayoutController = null;

function _nodesColumnSeed(col) {
  const types = {
    display_name: 'TEXT',
    addresses: 'TEXT',
    hostnames: 'TEXT',
    gen: 'TEXT',
    commit: 'TEXT',
    commit_non_root: 'TEXT',
    commit_inner: 'TEXT',
    pending: 'INTEGER',
  };
  const lengths = {
    display_name: 32,
    addresses: 24,
    hostnames: 32,
    gen: 8,
    commit: 12,
    commit_non_root: 12,
    commit_inner: 12,
    pending: 4,
  };
  return {
    sqlite_column: col.startsWith('_') ? null : col,
    data_type: types[col] || null,
    sample_max_length: lengths[col] || null,
    min_width_px: col === '_actions' ? _NODE_ACTION_COMPACT_WIDTH : 40,
    max_width_px: col === '_actions' ? _NODE_ACTION_INLINE_WIDTH : 900,
    width_px: _ensureNodesTableView()?.prefs?.getWidth(col) || null,
  };
}

function _ensureNodesLayoutController() {
  if (_nodesLayoutController || typeof TableBucketLayouts === 'undefined') return _nodesLayoutController;
  _nodesLayoutController = TableBucketLayouts.create({
    getTable: () => document.getElementById('nodes-table'),
    getView: () => _ensureNodesTableView(),
    getColumns: () => _NODE_COLS,
    getMeta: col => _NODE_FIELD_META[col],
    getDefaultWidth: col => col === '_actions' && _nodeCompactRowActions() ? _nodeActionCellWidth() : null,
    getColumnSeed: col => _nodesColumnSeed(col),
    render: () => renderNodes(),
    surfaceLabel: 'Fleet Nodes',
    layoutContextTitle: 'Fleet Nodes Layout Context',
  });
  return _nodesLayoutController;
}

async function toggleNodesHorizontalScroll() {
  const controller = _ensureNodesLayoutController();
  if (!controller) return;
  await controller.toggleHorizontalScroll();
}

async function autoFitNodesHorizontalLayout() {
  const measurements = [];
  const controller = _ensureNodesLayoutController();
  if (controller) {
    if (typeof controller.autoFitLayout === 'function') {
      const measurement = await controller.autoFitLayout({ percentile: 1 });
      if (measurement) measurements.push({ table: 'fleet-nodes', measurement });
    }
  }
  if (typeof autoFitBackupsLayout === 'function') {
    const measurement = await autoFitBackupsLayout();
    if (measurement) measurements.push({ table: 'node-backups', measurement });
  }
  if (measurements.length) {
    console.info('Fleet Nodes page auto-fit:', measurements);
  }
}

async function openNodesLayoutContextModal() {
  const controller = _ensureNodesLayoutController();
  if (!controller) return;
  await controller.openLayoutContextModal();
}

function _nodeCompactRowActions() {
  const view = _ensureNodesTableView();
  return typeof TableRowActions !== 'undefined' && TableRowActions.shouldCollapse({
    view,
    getTable: () => document.getElementById('nodes-table'),
    columnKey: '_actions',
    requiredWidth: _NODE_ACTION_INLINE_WIDTH,
    defaultWidth: _NODE_ACTION_INLINE_WIDTH,
  });
}

function _nodeActionCellWidth() {
  return _nodeCompactRowActions() ? _NODE_ACTION_COMPACT_WIDTH : _NODE_ACTION_INLINE_WIDTH;
}

function openNodesColsModal() {
  const view = _ensureNodesTableView();
  if (!view) return;
  view.openColumns(
    document.getElementById('nodes-cols-modal-list'),
    document.getElementById('nodes-cols-modal'),
    col => _NODE_FIELD_META[col].label
  );
}

function _applyNodesColsModal() {
  const view = _ensureNodesTableView();
  if (!view) return;
  view.applyColumns(document.getElementById('nodes-cols-modal'), () => {
    renderNodes();
    HubModal.close(document.getElementById('nodes-cols-modal'));
    _ensureNodesLayoutController()?.scheduleLayoutSave();
  });
}

function _nodeVisibleCols() {
  return _ensureNodesTableView()?.getVisibleCols() || ['display_name'];
}

function _nodeSortValue(node, sortKey) {
  switch (sortKey) {
    case 'display_name': return node.display_name || node.node_id || '';
    case 'addresses': return (node.addresses && node.addresses[0]) || '';
    case 'hostnames': return [node.primary_hostname || '', node.tailnet_hostname || ''].join(' ');
    case 'gen': return node._gen == null ? Number.NEGATIVE_INFINITY : Number(node._gen);
    case 'commit': return node._commit || '';
    case 'commit_non_root': return node._commit_non_root || '';
    case 'commit_inner': return node._commit_inner || '';
    case 'pending': return Number(node.pending_count || 0);
    default: return '';
  }
}

function _normalizeCommitValue(value) {
  const v = String(value || '').trim();
  if (!v || v === '—' || v === '?') return '';
  return v;
}

function _mostCommonValue(values) {
  const counts = new Map();
  let best = '';
  let bestCount = 0;
  values.forEach(v => {
    const next = (counts.get(v) || 0) + 1;
    counts.set(v, next);
    if (next > bestCount) {
      best = v;
      bestCount = next;
    }
  });
  return best;
}

function _commitBaseline(key) {
  const selfNode = _nodes.find(n => n.node_id === _selfNodeId);
  const selfVal = _normalizeCommitValue(selfNode ? selfNode[key] : '');
  if (selfVal) return selfVal;
  const values = _nodes
    .map(n => _normalizeCommitValue(n[key]))
    .filter(Boolean);
  return values.length ? _mostCommonValue(values) : '';
}

function _updateCommitMismatchFlags() {
  const outerBase = _commitBaseline('_commit');
  const nonRootBase = _commitBaseline('_commit_non_root');
  const innerBase = _commitBaseline('_commit_inner');

  _nodes.forEach(n => {
    const outerVal = _normalizeCommitValue(n._commit);
    const nonRootVal = _normalizeCommitValue(n._commit_non_root);
    const innerVal = _normalizeCommitValue(n._commit_inner);
    n._commit_mismatch_outer = !!(outerBase && outerVal && outerVal !== outerBase);
    n._commit_mismatch_non_root = !!(nonRootBase && nonRootVal && nonRootVal !== nonRootBase);
    n._commit_mismatch_inner = !!(innerBase && innerVal && innerVal !== innerBase);
  });
}

function _commitCellStyle(value, mismatch) {
  const isLoading = value == null;
  const color = isLoading ? 'var(--text-dim)' : 'inherit';
  const bg = mismatch
    ? 'background:color-mix(in srgb, var(--warn,#e6a817) 28%, transparent);'
    : '';
  return `font-size:12px;color:${color};${bg}`;
}

function _nodePctMeta(status, info) {
  const vmid = info && info.vmid ? ` ${info.vmid}` : '';
  const pveHost = info && info.pve_host ? ` on ${info.pve_host}` : '';
  if (status === 'running') {
    return {
      action: 'stop',
      className: 'table-icon-btn--power-stop',
      title: `Stop LXC${vmid}${pveHost}`,
      aria: 'Stop node container',
    };
  }
  if (status === 'stopped') {
    return {
      action: 'start',
      className: 'table-icon-btn--power-start',
      title: `Start LXC${vmid}${pveHost}`,
      aria: 'Start node container',
    };
  }
  return {
    action: 'unknown',
    className: 'table-icon-btn--power',
    title: 'Start or stop LXC via pct on the PVE host (status unknown)',
    aria: 'Container power action',
  };
}

function _nodePctButtonHtml(node) {
  const safeid = node.node_id.replace(/[^a-zA-Z0-9_-]/g, '_');
  const meta = _nodePctMeta(node._pct_status || 'unknown', node._pct_info || null);
  return `<button id="node-pct-${safeid}" class="secondary table-icon-btn ${meta.className}" type="button" title="${esc(meta.title)}" aria-label="${esc(meta.aria)}" data-node-pct="${esc(node.node_id)}" data-pct-status="${esc(node._pct_status || 'unknown')}"></button>`;
}

function _nodeActionButtons(node) {
  return `<button class="secondary table-icon-btn table-icon-btn--restart" type="button" title="Restart blueprints-app service" aria-label="Restart node service" data-node-restart="${esc(node.node_id)}"></button>
    <button class="secondary table-icon-btn table-icon-btn--pull" type="button" title="Git pull the root public repo on this node" aria-label="Git pull node repo" data-node-pull="${esc(node.node_id)}"></button>
    <button class="secondary table-icon-btn table-icon-btn--queue" type="button" title="Purge unsent sync queue entries for this node" aria-label="Purge node queue" data-node-queue="${esc(node.node_id)}"></button>
    ${_nodePctButtonHtml(node)}
    <button class="secondary table-icon-btn table-icon-btn--delete" type="button" title="Delete this node row from the local database" aria-label="Delete node row" data-node-delete="${esc(node.node_id)}"></button>`;
}

function _renderNodeActionsCell(node) {
  if (_nodeCompactRowActions()) {
    return `<td class="table-action-cell table-action-cell--compact" style="width:${_nodeActionCellWidth()}px">
      <button class="table-row-action-trigger secondary" type="button" title="Node actions" data-node-actions="${esc(node.node_id)}">&#8942;</button>
    </td>`;
  }
  return `<td class="table-action-cell" style="white-space:nowrap"><div class="table-inline-actions">${_nodeActionButtons(node)}</div></td>`;
}

function _openNodeRowActions(nodeId) {
  if (typeof TableRowActions === 'undefined') return;
  const node = _nodes.find(n => String(n.node_id) === String(nodeId));
  if (!node) return;
  const pctMeta = _nodePctMeta(node._pct_status || 'unknown', node._pct_info || null);
  const pctLabel = pctMeta.action === 'start' ? 'Start container' : pctMeta.action === 'stop' ? 'Stop container' : 'Container action unavailable';
  const pctDetail = pctMeta.action === 'start'
    ? 'Issue pct start on the parent Proxmox host'
    : pctMeta.action === 'stop'
      ? 'Issue pct stop on the parent Proxmox host'
      : 'Refresh Fleet Nodes once pct status is available';
  TableRowActions.open({
    title: node.display_name || node.node_id || 'Node actions',
    subtitle: node.node_id || '',
    actions: [
      {
        label: 'Restart service',
        detail: 'Restart blueprints-app on this node only',
        onClick: () => nodeRestart(nodeId),
      },
      {
        label: 'Reboot LXC',
        detail: 'Ask the parent Proxmox host to reboot this node container',
        tone: 'danger',
        onClick: () => openNodeLxcRebootModal(nodeId),
      },
      {
        label: 'Pull root repo',
        detail: 'Trigger /root/xarta-node git pull on this node only',
        onClick: () => nodeGitPull(nodeId),
      },
      {
        label: 'Purge queue',
        detail: 'Delete unsent sync queue entries for this node',
        tone: 'danger',
        onClick: () => nodePurgeQueue(nodeId),
      },
      {
        label: pctLabel,
        detail: pctDetail,
        tone: pctMeta.action === 'stop' ? 'danger' : undefined,
        onClick: () => nodePct(nodeId),
      },
      {
        label: 'Delete node row',
        detail: 'Remove this node record from the local database',
        tone: 'danger',
        onClick: () => nodeDeleteRow(nodeId),
      },
    ],
  });
}

function _nodeActionModalEls() {
  return {
    dialog: document.getElementById('node-action-modal'),
    badge: document.getElementById('node-action-modal-badge'),
    title: document.getElementById('node-action-modal-title'),
    message: document.getElementById('node-action-modal-message'),
    note: document.getElementById('node-action-modal-note'),
    status: document.getElementById('node-action-modal-status'),
    error: document.getElementById('node-action-modal-error'),
    closeBtn: document.getElementById('node-action-modal-close-btn'),
    confirmBtn: document.getElementById('node-action-modal-confirm'),
    closeBtns: Array.from(document.querySelectorAll('#node-action-modal .hub-modal-close')),
  };
}

function _resetNodeActionModal() {
  const { dialog, badge, title, message, note, status, error, closeBtn, confirmBtn, closeBtns } = _nodeActionModalEls();
  if (dialog) dialog.dataset.busy = '0';
  if (dialog) dialog.dataset.tone = 'info';
  if (badge) badge.textContent = 'INFO';
  if (title) title.textContent = 'Node Action';
  if (message) message.textContent = '';
  if (note) note.textContent = '';
  if (status) {
    status.textContent = '';
    status.style.color = 'var(--text-dim)';
  }
  if (error) error.textContent = '';
  if (closeBtn) closeBtn.textContent = 'Cancel';
  if (confirmBtn) {
    confirmBtn.textContent = 'Confirm';
    confirmBtn.disabled = false;
    confirmBtn.hidden = false;
    confirmBtn.classList.remove('danger', 'warning');
  }
  closeBtns.forEach(btn => { btn.disabled = false; });
  _pendingNodeAction = null;
}

function openNodeActionModal(opts) {
  const { dialog, badge, title, message, note, closeBtn, confirmBtn } = _nodeActionModalEls();
  if (!dialog) return;
  _resetNodeActionModal();
  _pendingNodeAction = opts || null;
  const tone = opts.infoOnly ? 'info' : (opts.confirmTone === 'danger' ? 'danger' : 'warning');
  if (dialog) dialog.dataset.tone = tone;
  if (badge) badge.textContent = opts.infoOnly ? 'INFO' : (opts.confirmTone === 'danger' ? 'WARN' : 'ACT');
  if (title) title.textContent = opts.title || 'Node Action';
  if (message) message.textContent = opts.message || '';
  if (note) note.textContent = opts.note || '';
  if (closeBtn) closeBtn.textContent = opts.infoOnly ? 'CLOSE' : 'Cancel';
  if (confirmBtn) {
    confirmBtn.textContent = opts.confirmLabel || 'Confirm';
    confirmBtn.hidden = !!opts.infoOnly;
    confirmBtn.classList.remove('danger', 'warning');
    if (!opts.infoOnly) {
      confirmBtn.classList.add(opts.confirmTone === 'danger' ? 'danger' : 'warning');
    }
  }
  HubModal.open(dialog, { onClose: _resetNodeActionModal });
}

async function submitNodeActionModal() {
  const pending = _pendingNodeAction;
  const { dialog, status, error, closeBtn, confirmBtn, closeBtns } = _nodeActionModalEls();
  if (!pending || !dialog || dialog.dataset.busy === '1') return;

  dialog.dataset.busy = '1';
  if (error) error.textContent = '';
  if (status) {
    status.textContent = pending.pendingText || 'Sending request...';
    status.style.color = 'var(--text-dim)';
  }
  if (confirmBtn) confirmBtn.disabled = true;
  closeBtns.forEach(btn => { btn.disabled = true; });

  try {
    if (typeof pending.run === 'function') {
      await pending.run();
    }
    if (status) {
      status.textContent = pending.successText || 'Request queued.';
      status.style.color = 'var(--ok,#3fb950)';
    }
    if (closeBtn) closeBtn.textContent = 'CLOSE';
    setTimeout(() => { HubModal.close(dialog); }, 900);
  } catch (e) {
    dialog.dataset.busy = '0';
    if (status) status.textContent = '';
    if (error) error.textContent = pending.errorPrefix ? `${pending.errorPrefix}: ${e.message}` : e.message;
    if (confirmBtn) confirmBtn.disabled = false;
    closeBtns.forEach(btn => { btn.disabled = false; });
    return;
  }
}

function _restoreNodeActionButton(btn, orig, delayMs) {
  if (!btn) return;
  setTimeout(() => {
    btn.disabled = false;
    btn.classList.remove('is-busy', 'is-success', 'is-error');
    if (btn.dataset.restorePctStatus) {
      _applyNodePctButtonState(btn, btn.dataset.restorePctStatus, null);
      delete btn.dataset.restorePctStatus;
    }
    btn.title = btn.dataset.origTitle || btn.title || '';
  }, delayMs || 3000);
}

function _setNodeActionButton(btn, html, color, title) {
  if (!btn) return;
  if (!btn.dataset.origTitle) btn.dataset.origTitle = btn.title || '';
  btn.classList.remove('is-busy', 'is-success', 'is-error');
  if (html === 'busy') btn.classList.add('is-busy');
  if (html === 'success') btn.classList.add('is-success');
  if (html === 'error') btn.classList.add('is-error');
  if (title !== undefined) btn.title = title;
}

function _applyNodePctButtonState(btn, status, info) {
  if (!btn) return;
  const meta = _nodePctMeta(status, info);
  btn.dataset.pctStatus = status || 'unknown';
  btn.classList.remove('table-icon-btn--power', 'table-icon-btn--power-start', 'table-icon-btn--power-stop');
  btn.classList.add(meta.className);
  btn.title = meta.title;
  btn.setAttribute('aria-label', meta.aria);
}

function _nodeRestartModalEls() {
  return {
    dialog: document.getElementById('node-restart-modal'),
    badge: document.getElementById('node-restart-modal-badge'),
    title: document.getElementById('node-restart-modal-title'),
    message: document.getElementById('node-restart-modal-message'),
    status: document.getElementById('node-restart-modal-status'),
    error: document.getElementById('node-restart-modal-error'),
    confirmBtn: document.getElementById('node-restart-modal-confirm'),
    closeBtns: Array.from(document.querySelectorAll('#node-restart-modal .hub-modal-close')),
  };
}

function _resetNodeRestartModal() {
  const { dialog, badge, title, message, status, error, confirmBtn, closeBtns } = _nodeRestartModalEls();
  if (dialog) dialog.dataset.busy = '0';
  if (dialog) dialog.dataset.tone = 'warning';
  if (badge) badge.textContent = 'RST';
  if (title) title.textContent = 'Restart Blueprints App';
  if (message) message.textContent = 'Restart blueprints-app on this node?';
  if (status) {
    status.textContent = '';
    status.style.color = 'var(--text-dim)';
  }
  if (error) error.textContent = '';
  if (confirmBtn) confirmBtn.disabled = false;
  closeBtns.forEach(btn => { btn.disabled = false; });
  _pendingNodeRestart = null;
}

function openNodeRestartModal(nodeId, btn) {
  const { dialog, message } = _nodeRestartModalEls();
  if (!dialog) return;
  _pendingNodeRestart = { nodeId, btn };
  _resetNodeRestartModal();
  _pendingNodeRestart = { nodeId, btn };
  if (message) message.textContent = `Restart blueprints-app on ${nodeId}?`;
  HubModal.open(dialog, { onClose: _resetNodeRestartModal });
}

async function submitNodeRestart() {
  const pending = _pendingNodeRestart;
  const { dialog, status, error, confirmBtn, closeBtns } = _nodeRestartModalEls();
  if (!pending || !dialog || dialog.dataset.busy === '1') return;

  const btn = pending.btn;
  const orig = btn ? btn.innerHTML : '';
  dialog.dataset.busy = '1';
  if (error) error.textContent = '';
  if (status) {
    status.textContent = 'Sending restart request...';
    status.style.color = 'var(--text-dim)';
  }
  if (confirmBtn) confirmBtn.disabled = true;
  closeBtns.forEach(closeBtn => { closeBtn.disabled = true; });
  if (btn) {
    btn.disabled = true;
    _setNodeActionButton(btn, 'busy');
  }

  try {
    const r = await apiFetch(`/api/v1/nodes/${encodeURIComponent(pending.nodeId)}/restart`, { method: 'POST' });
    if (btn) {
      _setNodeActionButton(btn, r.ok ? 'success' : 'error', '', r.ok ? 'Restart request queued' : `HTTP ${r.status}`);
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (status) {
      status.textContent = 'Restart request queued.';
      status.style.color = 'var(--ok,#3fb950)';
    }
    setTimeout(() => { HubModal.close(dialog); }, 900);
  } catch (e) {
    dialog.dataset.busy = '0';
    if (status) status.textContent = '';
    if (error) error.textContent = `Unable to restart node: ${e.message}`;
    if (confirmBtn) confirmBtn.disabled = false;
    closeBtns.forEach(closeBtn => { closeBtn.disabled = false; });
  } finally {
    if (btn) {
      setTimeout(() => {
        btn.disabled = false;
        btn.classList.remove('is-busy', 'is-success', 'is-error');
      }, 3000);
    }
  }
}

function _nodeLxcRebootModalEls() {
  return {
    dialog: document.getElementById('node-lxc-reboot-modal'),
    badge: document.getElementById('node-lxc-reboot-modal-badge'),
    title: document.getElementById('node-lxc-reboot-modal-title'),
    message: document.getElementById('node-lxc-reboot-modal-message'),
    note: document.getElementById('node-lxc-reboot-modal-note'),
    status: document.getElementById('node-lxc-reboot-modal-status'),
    error: document.getElementById('node-lxc-reboot-modal-error'),
    closeBtn: document.getElementById('node-lxc-reboot-modal-close-btn'),
    confirmBtn: document.getElementById('node-lxc-reboot-modal-confirm'),
    forceBtn: document.getElementById('node-lxc-reboot-modal-force'),
    closeBtns: Array.from(document.querySelectorAll('#node-lxc-reboot-modal .hub-modal-close')),
  };
}

function _clearNodeLxcRebootTimers() {
  if (_nodeLxcRebootTimer) {
    clearTimeout(_nodeLxcRebootTimer);
    _nodeLxcRebootTimer = null;
  }
  if (_nodeLxcRebootPollTimer) {
    clearInterval(_nodeLxcRebootPollTimer);
    _nodeLxcRebootPollTimer = null;
  }
}

function _resetNodeLxcRebootModal() {
  const { dialog, badge, title, message, note, status, error, confirmBtn, forceBtn, closeBtns } = _nodeLxcRebootModalEls();
  _clearNodeLxcRebootTimers();
  if (dialog) dialog.dataset.busy = '0';
  if (dialog) dialog.dataset.tone = 'warning';
  if (badge) badge.textContent = 'LXC';
  if (title) title.textContent = 'Reboot Node LXC';
  if (message) message.textContent = '';
  if (note) note.textContent = '';
  if (status) {
    status.textContent = '';
    status.style.color = 'var(--text-dim)';
  }
  if (error) error.textContent = '';
  if (confirmBtn) {
    confirmBtn.textContent = 'Reboot';
    confirmBtn.disabled = false;
    confirmBtn.hidden = false;
  }
  if (forceBtn) {
    forceBtn.hidden = true;
    forceBtn.disabled = false;
  }
  closeBtns.forEach(btn => { btn.disabled = false; });
  _pendingNodeLxcReboot = null;
}

function _nodeLxcStatusText(info) {
  const vmid = info?.vmid ? `LXC ${info.vmid}` : 'LXC';
  const pveHost = info?.pve_host ? ` on ${info.pve_host}` : '';
  return `${vmid}${pveHost}: ${info?.status || 'unknown'}`;
}

function _applyNodeLxcModalStatus(info) {
  const { message, note, status, confirmBtn, forceBtn } = _nodeLxcRebootModalEls();
  const pending = _pendingNodeLxcReboot;
  if (!pending) return;
  const current = String(info?.status || 'unknown').toLowerCase();
  pending.info = info || {};
  pending.status = current;

  if (message) message.textContent = _nodeLxcStatusText(info);
  if (status) {
    status.textContent = '';
    status.style.color = 'var(--text-dim)';
  }
  if (current === 'stopped') {
    pending.action = 'start';
    if (note) note.textContent = `${pending.nodeId} is stopped. Starting it is available from here.`;
    if (confirmBtn) confirmBtn.textContent = 'Start';
    if (forceBtn) forceBtn.hidden = true;
  } else {
    pending.action = 'reboot';
    if (note) note.textContent = `This asks the parent Proxmox host to reboot ${pending.nodeId}'s LXC.`;
    if (confirmBtn) confirmBtn.textContent = 'Reboot';
  }

  const node = _nodes.find(x => x.node_id === pending.nodeId);
  if (node) {
    node._pct_status = current;
    node._pct_info = { vmid: info?.vmid, pve_host: info?.pve_host };
  }
  if (pending.btn && pending.btn.dataset.nodePct) {
    _applyNodePctButtonState(pending.btn, current, info);
  }
}

async function _fetchNodeLxcStatus(nodeId) {
  const r = await apiFetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/pct-status`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
  return data;
}

async function openNodeLxcRebootModal(nodeId, btn) {
  const { dialog, status, error, confirmBtn } = _nodeLxcRebootModalEls();
  if (!dialog) return;
  _resetNodeLxcRebootModal();
  _pendingNodeLxcReboot = { nodeId, btn, status: 'unknown', action: 'reboot' };
  if (status) {
    status.textContent = 'Checking current LXC status...';
    status.style.color = 'var(--text-dim)';
  }
  if (confirmBtn) confirmBtn.disabled = true;
  HubModal.open(dialog, { onClose: _resetNodeLxcRebootModal });
  try {
    const info = await _fetchNodeLxcStatus(nodeId);
    _applyNodeLxcModalStatus(info);
    if (confirmBtn) confirmBtn.disabled = false;
  } catch (e) {
    if (error) error.textContent = `Unable to read LXC status: ${e.message}`;
    if (confirmBtn) confirmBtn.disabled = false;
  }
}

function _startNodeLxcRebootWatch() {
  const pending = _pendingNodeLxcReboot;
  const { status, forceBtn } = _nodeLxcRebootModalEls();
  if (!pending) return;
  _clearNodeLxcRebootTimers();
  _nodeLxcRebootPollTimer = setInterval(async () => {
    if (!_pendingNodeLxcReboot) return;
    try {
      const info = await _fetchNodeLxcStatus(pending.nodeId);
      _applyNodeLxcModalStatus(info);
    } catch (_) {}
  }, 3000);
  _nodeLxcRebootTimer = setTimeout(() => {
    if (forceBtn) forceBtn.hidden = false;
    if (status) {
      status.textContent = '20 second window elapsed. Force stop + start is now available.';
      status.style.color = 'var(--warn,#e6a817)';
    }
  }, 20000);
}

async function _submitNodeLxcAction(action) {
  const pending = _pendingNodeLxcReboot;
  const { dialog, status, error, confirmBtn, forceBtn, closeBtns } = _nodeLxcRebootModalEls();
  if (!pending || !dialog || dialog.dataset.busy === '1') return;

  dialog.dataset.busy = '1';
  if (error) error.textContent = '';
  if (status) {
    status.textContent = action === 'force-cycle' ? 'Sending force stop + start request...' : `Sending ${action} request...`;
    status.style.color = 'var(--text-dim)';
  }
  if (confirmBtn) confirmBtn.disabled = true;
  if (forceBtn) forceBtn.disabled = true;
  closeBtns.forEach(btn => { btn.disabled = true; });

  try {
    const r = await apiFetch(`/api/v1/nodes/${encodeURIComponent(pending.nodeId)}/pct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
    if (status) {
      status.textContent = action === 'force-cycle' ? 'Force stop + start request completed.' : `${action} request sent.`;
      status.style.color = 'var(--ok,#3fb950)';
    }
    setTimeout(async () => {
      try {
        const info = await _fetchNodeLxcStatus(pending.nodeId);
        _applyNodeLxcModalStatus(info);
        await enrichNodePctStatus();
      } catch (_) {}
    }, 1200);
    if (action === 'reboot') {
      _startNodeLxcRebootWatch();
    } else {
      _clearNodeLxcRebootTimers();
    }
  } catch (e) {
    if (error) error.textContent = `Unable to ${action} LXC: ${e.message}`;
    if (status) status.textContent = '';
  } finally {
    dialog.dataset.busy = '0';
    if (confirmBtn) confirmBtn.disabled = false;
    if (forceBtn) forceBtn.disabled = false;
    closeBtns.forEach(btn => { btn.disabled = false; });
  }
}

async function submitNodeLxcReboot() {
  const action = _pendingNodeLxcReboot?.action || 'reboot';
  await _submitNodeLxcAction(action);
}

async function submitNodeLxcForceCycle() {
  await _submitNodeLxcAction('force-cycle');
}

async function retouchTable(btn) {
  const sel = document.getElementById('retouch-table-select');
  const status = document.getElementById('retouch-status');
  const table = sel ? sel.value : '';
  if (!table) { if (status) { status.textContent = 'Select a table first'; status.style.color = 'var(--warn)'; } return; }
  if (btn) btn.disabled = true;
  if (status) { status.textContent = 'Retouching…'; status.style.color = 'var(--text-dim)'; }
  try {
    const r = await apiFetch(`/api/v1/sync/retouch/${encodeURIComponent(table)}`, { method: 'POST' });
    if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
    const data = await r.json();
    if (status) { status.textContent = `✓ ${data.requeued} rows re-queued from ${data.table}`; status.style.color = 'var(--ok)'; }
  } catch (e) {
    if (status) { status.textContent = `✗ ${e.message}`; status.style.color = 'var(--err)'; }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function loadNodes() {
  const err = document.getElementById('nodes-error');
  err.hidden = true;
  try {
    const r = await apiFetch('/api/v1/nodes');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _nodes = await r.json();
    _saveDiagNodes(_nodes);  // cache peer list for offline diagnostics
    renderNodes();
    enrichNodeVersions();
    enrichNodePctStatus();
  } catch (e) {
    err.textContent = `Failed to load nodes: ${e.message}`;
    err.hidden = false;
  }
}

function renderNodes() {
  const tbody = document.getElementById('nodes-tbody');
  const view = _ensureNodesTableView();
  const visibleCols = _nodeVisibleCols();
  if (!_nodes.length) {
    view?.render(() => {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${Math.max(1, visibleCols.length)}">No nodes registered.</td></tr>`;
    });
    return;
  }
  const rows = view?.sorter ? view.sorter.sortRows(_nodes, _nodeSortValue) : _nodes.slice();
  view?.render(() => {
    tbody.innerHTML = rows.flatMap(n => {
    const nameStyle = n.fleet_peer === false ? ' style="text-decoration:line-through;opacity:0.55"' : '';
    const pending = n.pending_count || 0;
    const pendingBadge = pending > 0
      ? `<span style="background:var(--badge-warn,#b45309);color:#fff;border-radius:4px;padding:1px 6px;font-size:11px">${pending}</span>`
      : `<span style="color:var(--text-dim)">—</span>`;
    const safeid = n.node_id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const addrs = (n.addresses || []).map(a => `<span class="ip-chip">${esc(a)}</span>`).join('<br>');
    const ph = n.primary_hostname || '';
    const th = n.tailnet_hostname || '';
    const hostnamesHtml = ph
      ? `<span class="ip-chip">${esc(ph)}</span>${th ? `<br><span class="ip-chip" style="opacity:0.75">${esc(th)}</span>` : ''}`
      : '<span style="color:var(--text-dim)">—</span>';
    const cellMap = {
      display_name: `<td style="white-space:nowrap"><strong title="${esc(n.node_id)}"${nameStyle}>${esc(n.display_name || n.node_id)}</strong></td>`,
      addresses: `<td>${addrs || '<span style="color:var(--text-dim)">—</span>'}</td>`,
      hostnames: `<td>${hostnamesHtml}</td>`,
      gen: `<td id="node-gen-${safeid}" style="font-size:12px;color:${n._gen == null ? 'var(--text-dim)' : 'inherit'}">${n._gen == null ? '…' : esc(String(n._gen))}</td>`,
      commit: `<td id="node-ver-outer-${safeid}" style="${_commitCellStyle(n._commit, n._commit_mismatch_outer)}" title="${esc(n._commit || '')}">${n._commit == null ? '…' : esc(n._commit)}</td>`,
      commit_non_root: `<td id="node-ver-non-root-${safeid}" style="${_commitCellStyle(n._commit_non_root, n._commit_mismatch_non_root)}" title="${esc(n._commit_non_root || '')}">${n._commit_non_root == null ? '…' : esc(n._commit_non_root)}</td>`,
      commit_inner: `<td id="node-ver-inner-${safeid}" style="${_commitCellStyle(n._commit_inner, n._commit_mismatch_inner)}" title="${esc(n._commit_inner || '')}">${n._commit_inner == null ? '…' : esc(n._commit_inner)}</td>`,
      pending: `<td>${pendingBadge}</td>`,
      _actions: _renderNodeActionsCell(n),
    };
    const mainRow = `<tr>${visibleCols.map(col => cellMap[col] || '<td></td>').join('')}</tr>`;
    return mainRow;
  }).join('');
  });
}



async function enrichNodeVersions() {
  for (const n of _nodes) {
    const safeid = n.node_id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const genCell = document.getElementById(`node-gen-${safeid}`);
    const verOuterCell = document.getElementById(`node-ver-outer-${safeid}`);
    const verNonRootCell = document.getElementById(`node-ver-non-root-${safeid}`);
    const verInnerCell = document.getElementById(`node-ver-inner-${safeid}`);
    // Self: use a relative URL (same origin, through Caddy).
    // Peers: use ui_url (Caddy HTTPS) — port 8080 is firewalled from the browser.
    // Fall back to addresses[0] only if ui_url absent (pre-firewall nodes).
    const isSelf = n.node_id === _selfNodeId;
    const healthUrl = isSelf
      ? '/health'
      : n.ui_url
        ? `${n.ui_url.replace(/\/$/, '')}/health`
        : (n.addresses && n.addresses[0] ? `${n.addresses[0].replace(/\/$/, '')}/health` : null);
    if (!healthUrl) {
      if (genCell) genCell.textContent = '—';
      if (verOuterCell) verOuterCell.textContent = '—';
      if (verNonRootCell) verNonRootCell.textContent = '—';
      if (verInnerCell) verInnerCell.textContent = '—';
      continue;
    }
    try {
      const r = await apiFetch(healthUrl, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      n._gen = d.gen ?? '—';
      if (genCell) { genCell.textContent = d.gen ?? '—'; genCell.style.color = ''; }

      // Use the nodes proxy endpoint to obtain all repo commits (outer/non-root/inner)
      // for both self and peer nodes through one consistent API contract.
      const vr = await apiFetch(`/api/v1/nodes/${encodeURIComponent(n.node_id)}/repo-versions`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!vr.ok) throw new Error(`HTTP ${vr.status}`);
      const v = await vr.json();

      n._commit = (v.outer && v.outer.commit) || '—';
      n._commit_non_root = (v.non_root && v.non_root.commit) || '—';
      n._commit_inner = (v.inner && v.inner.commit) || '—';

      if (verOuterCell) {
        verOuterCell.textContent = n._commit;
        verOuterCell.style.color = '';
        verOuterCell.title = '';
      }
      if (verNonRootCell) {
        verNonRootCell.textContent = n._commit_non_root;
        verNonRootCell.style.color = '';
        verNonRootCell.title = '';
      }
      if (verInnerCell) {
        verInnerCell.textContent = n._commit_inner;
        verInnerCell.style.color = '';
        verInnerCell.title = '';
      }
    } catch {
      n._gen = '?';
      n._commit = '?';
      n._commit_non_root = '?';
      n._commit_inner = '?';
      if (genCell) { genCell.textContent = '?'; genCell.style.color = 'var(--text-dim)'; }
      if (verOuterCell) { verOuterCell.textContent = '?'; verOuterCell.style.color = 'var(--text-dim)'; }
      if (verNonRootCell) { verNonRootCell.textContent = '?'; verNonRootCell.style.color = 'var(--text-dim)'; }
      if (verInnerCell) { verInnerCell.textContent = '?'; verInnerCell.style.color = 'var(--text-dim)'; }
    }
  }
  _updateCommitMismatchFlags();
  renderNodes();
  const sortKey = _nodesTableView?.getSortState().key;
  if (sortKey === 'gen' || sortKey === 'commit' || sortKey === 'commit_non_root' || sortKey === 'commit_inner') renderNodes();
}

function _fleetHealthEls() {
  return {
    output: document.getElementById('fleet-health-output'),
    status: document.getElementById('fleet-health-status'),
    runBtn: document.getElementById('fleet-health-run-btn'),
    copyBtn: document.getElementById('fleet-health-copy-btn'),
    clearBtn: document.getElementById('fleet-health-clear-btn'),
  };
}

function _setFleetHealthStatus(message, tone) {
  const { status } = _fleetHealthEls();
  if (!status) return;
  status.textContent = message || '';
  if (tone === 'ok') status.style.color = 'var(--ok,#3fb950)';
  else if (tone === 'warn') status.style.color = 'var(--warn,#e6a817)';
  else if (tone === 'err') status.style.color = 'var(--err,#f85149)';
  else status.style.color = 'var(--text-dim)';
}

function _appendFleetHealthReport(text) {
  const { output } = _fleetHealthEls();
  if (!output) return;
  const report = String(text || '').trimEnd();
  if (!report) return;
  output.value = output.value.trim()
    ? `${output.value.trimEnd()}\n\n${report}\n`
    : `${report}\n`;
  output.scrollTop = output.scrollHeight;
}

function recordFleetHealthBlockedReport(reason, options = {}) {
  const source = options.source || 'fleet-update';
  const stamp = new Date().toISOString();
  _appendFleetHealthReport([
    `Fleet health check: not run`,
    `Source: ${source}`,
    `Generated: ${stamp}`,
    `Nodes checked: 0/0`,
    `Nodes not checked: unknown`,
    `Problems found: 1`,
    `Checks not run: 1`,
    `Blocked: ${reason || 'unknown blocker'}`,
    `Log directory: /xarta-node/.lone-wolf/state/fleet-health-checks`,
  ].join('\n'));
  _setFleetHealthStatus('Fleet health checks were not run.', 'warn');
}

async function runFleetHealthChecks(options = {}) {
  const { runBtn } = _fleetHealthEls();
  if (_fleetHealthRunning) {
    _setFleetHealthStatus('Fleet health check already running.', 'warn');
    return null;
  }
  _fleetHealthRunning = true;
  if (runBtn) runBtn.disabled = true;
  _setFleetHealthStatus('Running fleet health checks...', '');
  const body = {
    source: options.source || 'manual',
    timeout_seconds: options.timeoutSeconds || 190,
  };
  if (options.expectedVersions) body.expected_versions = options.expectedVersions;

  try {
    const fetchOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      fetchOptions.signal = AbortSignal.timeout((body.timeout_seconds + 25) * 1000);
    }
    const r = await apiFetch('/api/v1/nodes/fleet-health-check', fetchOptions);
    let data = null;
    try {
      data = await r.json();
    } catch {
      data = null;
    }
    if (!r.ok) {
      throw new Error(`HTTP ${r.status}`);
    }
    const report = data?.text_report || JSON.stringify(data || {}, null, 2);
    _appendFleetHealthReport(report);
    const summary = data?.summary || {};
    const problems = Number(summary.problems_found || 0);
    const blocked = Number(summary.checks_not_run || 0);
    const checked = Number(summary.nodes_checked || 0);
    const targeted = Number(summary.nodes_targeted || 0);
    const saved = data?.log_path ? ` Saved: ${data.log_path}` : '';
    const tone = problems ? 'warn' : 'ok';
    _setFleetHealthStatus(`Checked ${checked}/${targeted}; problems ${problems}; blocked checks ${blocked}.${saved}`, tone);
    return data;
  } catch (e) {
    const message = e?.message || String(e);
    _appendFleetHealthReport([
      `Fleet health check: failed`,
      `Source: ${body.source}`,
      `Generated: ${new Date().toISOString()}`,
      `Nodes checked: 0/0`,
      `Problems found: 1`,
      `Checks not run: 1`,
      `Error: ${message}`,
      `Log directory: /xarta-node/.lone-wolf/state/fleet-health-checks`,
    ].join('\n'));
    _setFleetHealthStatus(`Fleet health check failed: ${message}`, 'err');
    throw e;
  } finally {
    _fleetHealthRunning = false;
    if (runBtn) runBtn.disabled = false;
  }
}

async function copyFleetHealthReport() {
  const { output } = _fleetHealthEls();
  if (!output || !output.value.trim()) {
    _setFleetHealthStatus('No fleet health report to copy.', 'warn');
    return;
  }
  try {
    await navigator.clipboard.writeText(output.value);
    _setFleetHealthStatus('Fleet health report copied.', 'ok');
  } catch {
    output.focus();
    output.select();
    document.execCommand('copy');
    _setFleetHealthStatus('Fleet health report copied.', 'ok');
  }
}

function clearFleetHealthReport() {
  const { output } = _fleetHealthEls();
  if (output) output.value = '';
  _setFleetHealthStatus('', '');
}

async function fleetUpdate(btn) {
  const ok = await HubDialogs.confirm({
    tone: 'warning',
    badge: 'WARN',
    title: 'Trigger fleet update?',
    message: 'Trigger git pull for the public and private repos on this node and queue the same action for all fleet peers?',
    detail: 'All nodes will pull latest code and restart if there are new commits.',
    confirmText: 'Update fleet',
    cancelText: 'Cancel',
  });
  if (!ok) return;
  const statusEl = document.getElementById('fleet-update-status');
  btn.disabled = true;
  const orig = btn.innerHTML;
  btn.innerHTML = '&#8987; Updating…';
  statusEl.textContent = '';
  statusEl.style.color = '';
  try {
    const r = await apiFetch('/api/v1/sync/git-pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'both' }),
    });
    if (r.ok) {
      statusEl.textContent = '✓ Queued for all nodes — peers will pull and restart shortly';
      statusEl.style.color = 'var(--ok,#3fb950)';
      setTimeout(() => { loadNodes(); }, 4000);
    } else {
      statusEl.textContent = `✗ HTTP ${r.status}`;
      statusEl.style.color = 'var(--danger,#f85149)';
    }
  } catch (e) {
    statusEl.textContent = `✗ ${e.message}`;
    statusEl.style.color = 'var(--danger,#f85149)';
  }
  btn.disabled = false;
  btn.innerHTML = orig;
  setTimeout(() => { statusEl.textContent = ''; statusEl.style.color = ''; }, 10000);
}

async function nodeRestart(nodeId, btn) {
  openNodeRestartModal(nodeId, btn);
}

async function nodeGitPull(nodeId, btn) {
  openNodeActionModal({
    title: 'Pull Root Repo?',
    message: `Trigger a root public repo git pull on ${nodeId}?`,
    note: 'This only pulls the selected node\'s /root/xarta-node repo.',
    confirmLabel: 'Pull',
    pendingText: 'Sending git pull request...',
    successText: 'Git pull request queued.',
    errorPrefix: 'Unable to trigger git pull',
    run: async () => {
      if (btn) {
        btn.disabled = true;
        _setNodeActionButton(btn, 'busy');
      }
      try {
        const r = await apiFetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/git-pull`, { method: 'POST' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        _setNodeActionButton(btn, 'success', '', 'Git pull request queued');
      } catch (e) {
        _setNodeActionButton(btn, 'error', '', 'Git pull request failed');
        _restoreNodeActionButton(btn, '', 3000);
        throw e;
      }
      _restoreNodeActionButton(btn, '', 3000);
    },
  });
}

async function nodePurgeQueue(nodeId, btn) {
  const n = _nodes.find(x => x.node_id === nodeId);
  const cnt = n ? (n.pending_count || 0) : '?';
  openNodeActionModal({
    title: 'Purge Sync Queue?',
    message: `Purge ${cnt} unsent sync queue entr${cnt === 1 ? 'y' : 'ies'} for ${nodeId}?`,
    note: 'This affects only unsent queue entries targeting the selected node.',
    confirmLabel: 'Purge Queue',
    confirmTone: 'danger',
    pendingText: 'Purging unsent queue entries...',
    successText: 'Queue entries purged.',
    errorPrefix: 'Unable to purge queue',
    run: async () => {
      if (btn) {
        btn.disabled = true;
        _setNodeActionButton(btn, 'busy');
      }
      try {
        const r = await apiFetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/sync-queue`, { method: 'DELETE' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        _setNodeActionButton(btn, 'success', '', 'Queue entries purged');
        _nodes = [];
        setTimeout(loadNodes, 500);
      } catch (e) {
        _setNodeActionButton(btn, 'error', '', 'Queue purge failed');
        _restoreNodeActionButton(btn, '', 3000);
        throw e;
      }
      _restoreNodeActionButton(btn, '', 3000);
    },
  });
}

async function nodeDeleteRow(nodeId, btn) {
  const ok = await HubDialogs.confirmDelete({
    title: 'Delete node row?',
    message: `Delete node "${nodeId}" from this node's local database?`,
    detail: 'This does not purge the sync queue. Use Purge Queue first if needed.',
  });
  if (!ok) return;
  if (btn) {
    btn.disabled = true;
    _setNodeActionButton(btn, 'busy');
  }
  try {
    const r = await apiFetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _nodes = [];
    loadNodes();
  } catch (e) {
    _setNodeActionButton(btn, 'error', '', 'Delete failed');
    _restoreNodeActionButton(btn, '', 3000);
    await HubDialogs.alertError({
      title: 'Delete failed',
      message: `Unable to delete node: ${e.message}`,
    });
    return;
  }
  _restoreNodeActionButton(btn, '', 3000);
}

async function enrichNodePctStatus() {
  await Promise.all(_nodes.map(async n => {
    const safeid = n.node_id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const btn = document.getElementById(`node-pct-${safeid}`);
    if (btn && btn.disabled) return;  // skip buttons mid-action
    try {
      const r = await apiFetch(`/api/v1/nodes/${encodeURIComponent(n.node_id)}/pct-status`);
      if (!r.ok) {
        n._pct_status = 'unknown';
        n._pct_info = null;
        if (btn) {
          btn.dataset.pctStatus = 'unknown';
          _applyNodePctButtonState(btn, 'unknown', null);
        }
        return;
      }
      const d = await r.json();
      const st = (d.status || 'unknown').toLowerCase();
      n._pct_status = st;
      n._pct_info = { vmid: d.vmid, pve_host: d.pve_host };
      if (btn) {
        btn.dataset.pctStatus = st;
        _applyNodePctButtonState(btn, st, d);
      }
    } catch {
      n._pct_status = 'unknown';
      n._pct_info = null;
      if (btn) {
        btn.dataset.pctStatus = 'unknown';
        _applyNodePctButtonState(btn, 'unknown', null);
      }
    }
  }));
}

async function nodePct(nodeId, btn) {
  const node = _nodes.find(x => x.node_id === nodeId);
  const currentStatus = btn?.dataset.pctStatus || node?._pct_status || 'unknown';
  let action;
  let title;
  let message;
  let note;
  let confirmLabel;
  if (currentStatus === 'running') {
    action = 'stop';
    title = 'Stop Node Container?';
    message = `Stop the LXC for ${nodeId}?`;
    note = 'This will issue pct stop on the parent Proxmox host.';
    confirmLabel = 'Stop';
  } else if (currentStatus === 'stopped') {
    action = 'start';
    title = 'Start Node Container?';
    message = `Start the LXC for ${nodeId}?`;
    note = 'This will issue pct start on the parent Proxmox host.';
    confirmLabel = 'Start';
  } else {
    openNodeActionModal({
      title: 'PCT Status Unknown',
      message: `Unable to determine whether ${nodeId} should be started or stopped.`,
      note: 'Refresh the Fleet Nodes page and try again once the pct status is available.',
      infoOnly: true,
    });
    return;
  }
  openNodeActionModal({
    title,
    message,
    note,
    confirmLabel,
    confirmTone: action === 'stop' ? 'danger' : '',
    pendingText: `${confirmLabel} request in progress...`,
    successText: `${confirmLabel} request sent.`,
    errorPrefix: `Unable to ${action} node`,
    run: async () => {
      if (btn) {
        btn.disabled = true;
        btn.dataset.restorePctStatus = btn.dataset.pctStatus || 'unknown';
        _setNodeActionButton(btn, 'busy');
      }
      try {
        const r = await apiFetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/pct`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          const detail = err.detail || `HTTP ${r.status}`;
          _setNodeActionButton(btn, 'error', '', detail);
          _restoreNodeActionButton(btn, '', 4000);
          throw new Error(detail);
        }
        if (btn) {
          const nextStatus = action === 'start' ? 'running' : 'stopped';
          _setNodeActionButton(btn, 'success', '', `${confirmLabel} request sent`);
          btn.dataset.restorePctStatus = nextStatus;
          setTimeout(() => {
            btn.disabled = false;
            _applyNodePctButtonState(btn, nextStatus, null);
            btn.classList.remove('is-busy', 'is-success', 'is-error');
            delete btn.dataset.restorePctStatus;
          }, 3000);
        }
        const node = _nodes.find(x => x.node_id === nodeId);
        if (node) {
          node._pct_status = action === 'start' ? 'running' : 'stopped';
        }
      } catch (e) {
        if (btn && !String(e.message || '').startsWith('HTTP')) {
          _setNodeActionButton(btn, 'error', '', `${confirmLabel} failed`);
          _restoreNodeActionButton(btn, '', 3000);
        }
        throw e;
      }
    },
  });
}

/* ── Retouch All ─────────────────────────────────────────────────────────── */

// Tables list is fetched from /api/v1/sync/tables — the backend's _ALLOWED_TABLES.
// Never hardcode this; the DB-driven app owns what is syncable.
async function _fetchSyncTables() {
  const r = await apiFetch('/api/v1/sync/tables');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  return data.tables || [];
}

async function loadRetouchTableSelect() {
  const sel = document.getElementById('retouch-table-select');
  if (!sel) return;
  try {
    const tables = await _fetchSyncTables();
    sel.innerHTML = '<option value="">— select table —</option>' +
      tables.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    if (typeof HubSelect !== 'undefined') HubSelect.init('retouch-table-select');
  } catch (e) {
    sel.innerHTML = `<option value="">(⚠ could not load tables)</option>`;
  }
}

// Module-level state — survives navigation across tabs.
let _retouchAllState = {
  running: false,
  cancelled: false,
  tables: [],      // [{table, status, detail}] — status: pending|checking|skipped|retouched|error
  currentIdx: -1,
  totalRetouched: 0,
  totalSkipped: 0,
  totalErrors: 0,
  startedAt: null,
  finishedAt: null,
};

function _retouchAllStatusIcon(status) {
  if (status === 'pending')   return '<span style="color:var(--text-dim)">&#9675;</span>';
  if (status === 'checking')  return '<span class="spinner" style="display:inline-block;width:12px;height:12px;vertical-align:middle"></span>';
  if (status === 'retouched') return '<span class="table-status-symbol table-status-symbol--ok" role="img" aria-label="Retouched" title="Retouched"></span>';
  if (status === 'skipped')   return '<span style="color:var(--text-dim)">&#8212;</span>';
  if (status === 'error')     return '<span class="table-status-symbol table-status-symbol--error" role="img" aria-label="Error" title="Error"></span>';
  return '';
}

function _renderRetouchAllProgress() {
  const container = document.getElementById('retouch-all-progress');
  const summary   = document.getElementById('retouch-all-summary');
  if (!container) return;

  container.innerHTML = _retouchAllState.tables.map(row => {
    const isActive = row.status === 'checking';
    const rowBg = isActive ? 'background:color-mix(in srgb,var(--accent,#58a6ff) 12%,transparent);' : '';
    return `<div style="display:flex;align-items:center;gap:8px;padding:3px 6px;border-radius:4px;${rowBg}">
      <span style="width:16px;text-align:center;flex-shrink:0">${_retouchAllStatusIcon(row.status)}</span>
      <span style="font-size:12px;flex:1;font-family:monospace">${esc(row.table)}</span>
      <span style="font-size:11px;color:var(--text-dim);white-space:nowrap">${esc(row.detail || '')}</span>
    </div>`;
  }).join('');

  if (summary) {
    const s = _retouchAllState;
    if (s.running) {
      const done = s.tables.filter(r => ['retouched', 'skipped', 'error'].includes(r.status)).length;
      summary.style.color = 'var(--text-dim)';
      summary.textContent = `Processing ${done + 1} of ${s.tables.length}…`;
    } else if (s.finishedAt) {
      if (s.cancelled && s.totalRetouched === 0 && s.totalSkipped === 0 && s.totalErrors === 0) {
        summary.style.color = 'var(--text-dim)';
        summary.textContent = 'Cancelled before any tables were processed.';
      } else {
        const parts = [];
        if (s.totalRetouched) parts.push(`${s.totalRetouched} retouched`);
        if (s.totalSkipped)   parts.push(`${s.totalSkipped} already in sync`);
        if (s.totalErrors)    parts.push(`${s.totalErrors} error(s)`);
        summary.style.color = s.totalErrors ? 'var(--warn,#e6a817)' : 'var(--ok,#3fb950)';
        summary.textContent = s.cancelled
          ? `Cancelled. ${parts.join(', ') || 'No tables processed'}.`
          : `Complete. ${parts.join(', ') || 'No tables processed'}.`;
      }
    } else {
      summary.textContent = '';
    }
  }
}

function _updateRetouchAllCancelBtn() {
  const btn = document.getElementById('retouch-all-cancel-btn');
  if (!btn) return;
  const s = _retouchAllState;
  if (!s.running && s.finishedAt) {
    btn.disabled = true;
    btn.textContent = s.cancelled ? 'Cancelled' : 'Done';
  } else if (s.running) {
    btn.disabled = false;
    btn.textContent = 'Cancel';
  } else {
    btn.disabled = false;
    btn.textContent = 'Cancel';
  }
}

function openRetouchAllModal() {
  const dialog = document.getElementById('retouch-all-modal');
  if (!dialog) return;

  // If a process is already running or finished, re-attach and show current state.
  if (_retouchAllState.running || _retouchAllState.finishedAt) {
    _renderRetouchAllProgress();
    _updateRetouchAllCancelBtn();
    HubModal.open(dialog);
    return;
  }

  // Fresh start — fetch table list from the API (source of truth).
  _retouchAllState = {
    running: true,
    cancelled: false,
    tables: [],
    currentIdx: -1,
    totalRetouched: 0,
    totalSkipped: 0,
    totalErrors: 0,
    startedAt: Date.now(),
    finishedAt: null,
  };
  // Show modal immediately with a loading state.
  const progress = document.getElementById('retouch-all-progress');
  if (progress) progress.innerHTML = '<div style="font-size:12px;color:var(--text-dim)"><span class="spinner" style="display:inline-block;width:12px;height:12px;vertical-align:middle"></span> Loading table list…</div>';
  const summary = document.getElementById('retouch-all-summary');
  if (summary) summary.textContent = '';
  _updateRetouchAllCancelBtn();
  HubModal.open(dialog);

  _fetchSyncTables().then(tables => {
    _retouchAllState.tables = tables.map(t => ({ table: t, status: 'pending', detail: '' }));
    _renderRetouchAllProgress();
    _runRetouchAll();
  }).catch(e => {
    _retouchAllState.running = false;
    _retouchAllState.finishedAt = Date.now();
    if (progress) progress.innerHTML = `<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--err,#f85149)"><span class="table-status-symbol table-status-symbol--error" aria-hidden="true"></span><span>Could not load table list: ${esc(String(e.message || e))}</span></div>`;
    _updateRetouchAllCancelBtn();
  });
}

function cancelRetouchAll() {
  if (!_retouchAllState.running) return;
  _retouchAllState.cancelled = true;
  _renderRetouchAllProgress();
  const summary = document.getElementById('retouch-all-summary');
  if (summary) {
    summary.style.color = 'var(--text-dim)';
    summary.textContent = 'Cancelling after current table completes…';
  }
}

async function _speakRetouchProgress(text) {
  try {
    if (typeof BlueprintsTtsClient !== 'undefined') {
      await BlueprintsTtsClient.speak({ text, interrupt: false });
    }
  } catch (_) { /* TTS is best-effort */ }
}

async function _runRetouchAll() {
  const s = _retouchAllState;

  for (let i = 0; i < s.tables.length; i++) {
    if (s.cancelled) break;

    s.currentIdx = i;
    const row = s.tables[i];
    row.status = 'checking';
    row.detail = 'checking parity…';
    _renderRetouchAllProgress();
    _updateRetouchAllCancelBtn();

    try {
      // Check parity with all peers.
      const parityResp = await apiFetch(`/api/v1/sync/parity/${encodeURIComponent(row.table)}`);
      if (!parityResp.ok) throw new Error(`parity check HTTP ${parityResp.status}`);
      const parity = await parityResp.json();

      if (!parity.needs_retouch) {
        // All peers match — skip.
        row.status = 'skipped';
        row.detail = `${parity.local.row_count} rows in sync`;
        s.totalSkipped++;
        _renderRetouchAllProgress();
        continue;
      }

      // Needs retouch — proceed.
      const mismatchCount = (parity.peers || []).filter(p => !p.match).length;
      row.detail = `retouching (${mismatchCount} peer(s) differ)…`;
      _renderRetouchAllProgress();

      await _speakRetouchProgress(`Retouching ${row.table.replace(/_/g, ' ')}`);

      const retouchResp = await apiFetch(`/api/v1/sync/retouch/${encodeURIComponent(row.table)}`, { method: 'POST' });
      if (!retouchResp.ok) throw new Error(`retouch HTTP ${retouchResp.status}`);
      const retouchData = await retouchResp.json();

      row.status = 'retouched';
      row.detail = `${retouchData.requeued} rows re-queued`;
      s.totalRetouched++;
      _renderRetouchAllProgress();

      await _speakRetouchProgress(`${row.table.replace(/_/g, ' ')} done`);

    } catch (e) {
      row.status = 'error';
      row.detail = String(e.message || e).slice(0, 60);
      s.totalErrors++;
      _renderRetouchAllProgress();
      await _speakRetouchProgress(`Error on ${row.table.replace(/_/g, ' ')}`);
    }

    // Small yield between tables to keep UI responsive.
    await new Promise(r => setTimeout(r, 80));
  }

  // Mark remaining pending rows as skipped if cancelled.
  if (s.cancelled) {
    s.tables.forEach(row => {
      if (row.status === 'pending' || row.status === 'checking') {
        row.status = 'skipped';
        row.detail = 'cancelled';
      }
    });
  }

  s.running = false;
  s.finishedAt = Date.now();
  _renderRetouchAllProgress();
  _updateRetouchAllCancelBtn();

  // Final TTS summary.
  const parts = [];
  if (s.totalRetouched) parts.push(`${s.totalRetouched} retouched`);
  if (s.totalSkipped)   parts.push(`${s.totalSkipped} in sync`);
  if (s.totalErrors)    parts.push(`${s.totalErrors} error${s.totalErrors > 1 ? 's' : ''}`);
  const finalMsg = s.cancelled
    ? 'Retouch all cancelled.'
    : `Retouch all complete. ${parts.join(', ') || 'Nothing to do'}.`;
  await _speakRetouchProgress(finalMsg);
}
