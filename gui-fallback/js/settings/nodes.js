/* ── Nodes ────────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  const retouchBtn = document.getElementById('retouch-btn');
  if (retouchBtn) {
    retouchBtn.addEventListener('click', function() { retouchTable(this); });
  }
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
  if (typeof HubSelect !== 'undefined') {
    HubSelect.init('retouch-table-select');
  }
  if (typeof ResponsiveLayout !== 'undefined') {
    ResponsiveLayout.registerTabControls('nodes', 'pg-ctrl-nodes');
  }
});

let _pendingNodeAction = null;
let _pendingNodeRestart = null;

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
    btn.innerHTML = orig;
    btn.style.color = '';
    btn.title = btn.dataset.origTitle || btn.title || '';
  }, delayMs || 3000);
}

function _setNodeActionButton(btn, html, color, title) {
  if (!btn) return;
  if (!btn.dataset.origTitle) btn.dataset.origTitle = btn.title || '';
  btn.innerHTML = html;
  btn.style.color = color || '';
  if (title !== undefined) btn.title = title;
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
    btn.textContent = '…';
  }

  try {
    const r = await apiFetch(`/api/v1/nodes/${encodeURIComponent(pending.nodeId)}/restart`, { method: 'POST' });
    if (btn) {
      btn.innerHTML = r.ok ? '&#10003; Sent' : `&#10007; ${r.status}`;
      btn.style.color = r.ok ? 'var(--ok,#3fb950)' : 'var(--danger,#f85149)';
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
        btn.innerHTML = orig;
        btn.style.color = '';
      }, 3000);
    }
  }
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
  if (!_nodes.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No nodes registered.</td></tr>';
    return;
  }
  tbody.innerHTML = _nodes.flatMap(n => {
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
    const mainRow = `<tr>
      <td style="white-space:nowrap"><strong title="${esc(n.node_id)}"${nameStyle}>${esc(n.display_name || n.node_id)}</strong></td>
      <td>${addrs || '<span style="color:var(--text-dim)">—</span>'}</td>
      <td>${hostnamesHtml}</td>
      <td id="node-gen-${safeid}" style="font-size:12px;color:var(--text-dim)">…</td>
      <td id="node-ver-${safeid}" style="font-size:12px;color:var(--text-dim)">…</td>
      <td>${pendingBadge}</td>
      <td style="width:200px;max-width:200px"><div style="display:flex;flex-wrap:wrap;gap:3px">
        <button class="secondary" style="font-size:11px;padding:2px 7px" onclick="nodeRestart('${esc(n.node_id)}',this)" title="restart blueprints-app service">&#8635; Restart</button>
        <button class="secondary" style="font-size:11px;padding:2px 7px" onclick="nodeGitPull('${esc(n.node_id)}',this)" title="git pull outer on this node">&#8593; Pull</button>
        <button class="secondary" style="font-size:11px;padding:2px 7px" onclick="nodePurgeQueue('${esc(n.node_id)}',this)" title="purge unsent sync queue entries">&#128465; Queue</button>
        <button id="node-pct-${safeid}" class="secondary" style="font-size:11px;padding:2px 7px" onclick="nodePct('${esc(n.node_id)}',this)" title="start or stop LXC via pct on PVE host" data-pct-status="unknown">&#x23FB; Stop</button>
        <button class="secondary" style="font-size:11px;padding:2px 7px;color:var(--danger,#f85149)" onclick="nodeDeleteRow('${esc(n.node_id)}',this)" title="remove this node from DB">&#10005; Delete</button>
      </div></td>
    </tr>`;
    return mainRow;
  }).join('');
}



async function enrichNodeVersions() {
  for (const n of _nodes) {
    const safeid = n.node_id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const genCell = document.getElementById(`node-gen-${safeid}`);
    const verCell = document.getElementById(`node-ver-${safeid}`);
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
      if (verCell) verCell.textContent = '—';
      continue;
    }
    try {
      const r = await apiFetch(healthUrl, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (genCell) { genCell.textContent = d.gen ?? '—'; genCell.style.color = ''; }
      if (verCell) { verCell.textContent = d.commit || '—'; verCell.style.color = ''; verCell.title = ''; }
    } catch {
      if (genCell) { genCell.textContent = '?'; genCell.style.color = 'var(--text-dim)'; }
      if (verCell) { verCell.textContent = '?'; verCell.style.color = 'var(--text-dim)'; }
    }
  }
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
  const orig = btn ? btn.innerHTML : '';
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
        btn.textContent = '…';
      }
      try {
        const r = await apiFetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/git-pull`, { method: 'POST' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        _setNodeActionButton(btn, '&#10003; Pull', 'var(--ok,#3fb950)');
      } catch (e) {
        _setNodeActionButton(btn, '&#10007; err', 'var(--danger,#f85149)');
        _restoreNodeActionButton(btn, orig, 3000);
        throw e;
      }
      _restoreNodeActionButton(btn, orig, 3000);
    },
  });
}

async function nodePurgeQueue(nodeId, btn) {
  const n = _nodes.find(x => x.node_id === nodeId);
  const cnt = n ? (n.pending_count || 0) : '?';
  const orig = btn ? btn.innerHTML : '';
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
        btn.textContent = '…';
      }
      try {
        const r = await apiFetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/sync-queue`, { method: 'DELETE' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        _setNodeActionButton(btn, '&#10003; Done', 'var(--ok,#3fb950)');
        _nodes = [];
        setTimeout(loadNodes, 500);
      } catch (e) {
        _setNodeActionButton(btn, '&#10007; err', 'var(--danger,#f85149)');
        _restoreNodeActionButton(btn, orig, 3000);
        throw e;
      }
      _restoreNodeActionButton(btn, orig, 3000);
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
  const orig = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '…';
  }
  try {
    const r = await apiFetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _nodes = [];
    loadNodes();
  } catch (e) {
    _setNodeActionButton(btn, '&#10007; err', 'var(--danger,#f85149)');
    _restoreNodeActionButton(btn, orig, 3000);
    await HubDialogs.alertError({
      title: 'Delete failed',
      message: `Unable to delete node: ${e.message}`,
    });
    return;
  }
  _restoreNodeActionButton(btn, orig, 3000);
}

async function enrichNodePctStatus() {
  await Promise.all(_nodes.map(async n => {
    const safeid = n.node_id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const btn = document.getElementById(`node-pct-${safeid}`);
    if (!btn || btn.disabled) return;  // skip buttons mid-action
    try {
      const r = await apiFetch(`/api/v1/nodes/${encodeURIComponent(n.node_id)}/pct-status`);
      if (!r.ok) { btn.dataset.pctStatus = 'unknown'; return; }
      const d = await r.json();
      const st = (d.status || 'unknown').toLowerCase();
      btn.dataset.pctStatus = st;
      if (st === 'running') {
        btn.innerHTML = '&#9632; Stop';
        btn.title = `Stop LXC ${d.vmid} on ${d.pve_host}`;
      } else if (st === 'stopped') {
        btn.innerHTML = '&#9654; Start';
        btn.title = `Start LXC ${d.vmid} on ${d.pve_host}`;
      } else {
        btn.innerHTML = '&#x23FB; PCT';
        btn.title = 'start or stop LXC via pct on PVE host (status unknown)';
      }
    } catch {
      btn.dataset.pctStatus = 'unknown';
    }
  }));
}

async function nodePct(nodeId, btn) {
  const currentStatus = btn.dataset.pctStatus || 'unknown';
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
  const orig = btn.innerHTML;
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
      btn.disabled = true;
      btn.textContent = '…';
      try {
        const r = await apiFetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/pct`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          const detail = err.detail || `HTTP ${r.status}`;
          _setNodeActionButton(btn, `&#10007; ${r.status}`, 'var(--danger,#f85149)', detail);
          _restoreNodeActionButton(btn, orig, 4000);
          throw new Error(detail);
        }
        _setNodeActionButton(btn, '&#10003; Done', 'var(--ok,#3fb950)');
        btn.dataset.pctStatus = action === 'start' ? 'running' : 'stopped';
        setTimeout(() => {
          btn.disabled = false;
          btn.innerHTML = action === 'start' ? '&#9632; Stop' : '&#9654; Start';
          btn.style.color = '';
          btn.dataset.pctStatus = action === 'start' ? 'running' : 'stopped';
          btn.title = btn.dataset.origTitle || btn.title || '';
        }, 3000);
      } catch (e) {
        if (!String(e.message || '').startsWith('HTTP') && !btn.innerHTML.includes('&#10007;')) {
          _setNodeActionButton(btn, '&#10007; err', 'var(--danger,#f85149)');
          _restoreNodeActionButton(btn, orig, 3000);
        }
        throw e;
      }
    },
  });
}
