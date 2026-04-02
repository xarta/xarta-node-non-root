/* ── Keys ──────────────────────────────────────────────────────────────── */
const _KEYS_COLS = ['label', 'env_var', 'path', 'present', 'pub_present', '_actions'];
const _KEYS_FIELD_META = {
  label: { label: 'Key', sortKey: 'label' },
  env_var: { label: 'Scope', sortKey: 'env_var' },
  path: { label: 'Path', sortKey: 'path' },
  present: { label: 'Private', sortKey: 'present' },
  pub_present: { label: 'Public', sortKey: 'pub_present' },
  _actions: { label: 'Actions' },
};

const _KEYS_ACTION_INLINE_WIDTH = 62;
const _KEYS_ACTION_COMPACT_WIDTH = 48;

let _keysTableView = null;

function _ensureKeysTableView() {
  if (_keysTableView || typeof TableView === 'undefined') return _keysTableView;
  _keysTableView = TableView.create({
    storageKey: 'keys-status-table-prefs',
    columns: _KEYS_COLS,
    meta: _KEYS_FIELD_META,
    getTable: () => document.getElementById('keys-status-table'),
    fallbackColumn: 'label',
    minWidth: 40,
    getDefaultWidth: col => {
      if (col === '_actions') return _keysActionCellWidth();
      if (col === 'path') return 260;
      if (col === 'env_var') return 170;
      if (col === 'present' || col === 'pub_present') return 92;
      return null;
    },
    sort: {
      storageKey: 'keys-status-table-sort',
      defaultKey: 'label',
      defaultDir: 1,
    },
    onSortChange: () => {
      renderKeysTable();
      _ensureKeysLayoutController()?.scheduleLayoutSave();
    },
    onColumnResizeEnd: () => {
      _ensureKeysLayoutController()?.scheduleLayoutSave();
    },
  });
  return _keysTableView;
}

let _keysLayoutController = null;

function _keysColumnSeed(col) {
  const types = { label: 'TEXT', env_var: 'TEXT', path: 'TEXT', present: 'INTEGER', pub_present: 'INTEGER' };
  const lengths = { label: 32, env_var: 28, path: 60, present: 3, pub_present: 3 };
  return {
    sqlite_column: col.startsWith('_') ? null : col,
    data_type: types[col] || null,
    sample_max_length: lengths[col] || null,
    min_width_px: col === '_actions' ? _KEYS_ACTION_COMPACT_WIDTH : 40,
    max_width_px: col === '_actions' ? _KEYS_ACTION_INLINE_WIDTH : 900,
    width_px: _ensureKeysTableView()?.prefs?.getWidth(col) || null,
  };
}

function _ensureKeysLayoutController() {
  if (_keysLayoutController || typeof TableBucketLayouts === 'undefined') return _keysLayoutController;
  _keysLayoutController = TableBucketLayouts.create({
    getTable: () => document.getElementById('keys-status-table'),
    getView: () => _ensureKeysTableView(),
    getColumns: () => _KEYS_COLS,
    getMeta: col => _KEYS_FIELD_META[col],
    getDefaultWidth: col => {
      if (col === '_actions') return _keysActionCellWidth();
      if (col === 'path') return 260;
      if (col === 'env_var') return 170;
      if (col === 'present' || col === 'pub_present') return 92;
      return null;
    },
    getColumnSeed: col => _keysColumnSeed(col),
    render: () => renderKeysTable(),
    surfaceLabel: 'SSH Keys',
    layoutContextTitle: 'SSH Keys Layout Context',
  });
  return _keysLayoutController;
}

async function toggleKeysHorizontalScroll() {
  const controller = _ensureKeysLayoutController();
  if (!controller) return;
  await controller.toggleHorizontalScroll();
}

async function openKeysLayoutContextModal() {
  const controller = _ensureKeysLayoutController();
  if (!controller) return;
  await controller.openLayoutContextModal();
}

function _keysVisibleCols() {
  return _ensureKeysTableView()?.getVisibleCols() || ['label'];
}

function _keysCompactRowActions() {
  const view = _ensureKeysTableView();
  return typeof TableRowActions !== 'undefined' && TableRowActions.shouldCollapse({
    view,
    getTable: () => document.getElementById('keys-status-table'),
    columnKey: '_actions',
    requiredWidth: _KEYS_ACTION_INLINE_WIDTH,
    defaultWidth: _KEYS_ACTION_INLINE_WIDTH,
  });
}

function _keysActionCellWidth() {
  return _keysCompactRowActions() ? _KEYS_ACTION_COMPACT_WIDTH : _KEYS_ACTION_INLINE_WIDTH;
}

function _keysSortValue(key, sortKey) {
  switch (sortKey) {
    case 'label':
      return key.label || '';
    case 'env_var':
      return key.env_var || '';
    case 'path':
      return key.path || '';
    case 'present':
      return key.present ? 1 : 0;
    case 'pub_present':
      return key.pub_present ? 1 : 0;
    default:
      return '';
  }
}

function _keysLabelCell(key) {
  return `<td style="font-weight:600">${esc(key.label || '—')}</td>`;
}

function _keysEnvVarCell(key) {
  return `<td style="color:var(--text-dim);font-size:12px">${esc(key.env_var || '—')}</td>`;
}

function _keysPathCell(key) {
  return `<td><span class="table-cell-clip"><span class="table-cell-clip__text" style="font-family:monospace;font-size:11px;color:var(--text-dim)">${esc(key.path || '—')}</span></span></td>`;
}

function _keysPrivateCell(key) {
  return `<td style="${key.present ? 'color:var(--ok)' : 'color:var(--err)'}">${key.present ? '&#10003; present' : '&#10007; missing'}</td>`;
}

function _keysPublicCell(key) {
  return `<td style="${key.pub_present ? 'color:var(--ok)' : 'color:var(--text-dim)'}">${key.pub_present ? '&#10003; present' : '&#10007; missing'}</td>`;
}

function _keysActionButtons(key) {
  const keyId = esc(key.id || '');
  const keyLabel = esc(key.label || '');
  const deleteBtn = key.present || key.pub_present
    ? `<button class="secondary table-icon-btn table-icon-btn--delete" type="button" title="Delete key files" aria-label="Delete key files" data-key-del-id="${keyId}" data-key-del-label="${keyLabel}"></button>`
    : '';
  return `<button class="secondary table-icon-btn table-icon-btn--history" type="button" title="Show key details" aria-label="Show key details" data-key-info="${keyId}"></button>${deleteBtn}`;
}

function _keysActionsCell(key) {
  if (_keysCompactRowActions()) {
    return `<td class="table-action-cell table-action-cell--compact" style="width:${_keysActionCellWidth()}px">
      <button class="table-row-action-trigger secondary" type="button" title="SSH key actions" aria-label="SSH key actions" data-key-actions="${esc(key.id || '')}">&#8942;</button>
    </td>`;
  }
  return `<td class="table-action-cell" style="white-space:nowrap"><div class="table-inline-actions">${_keysActionButtons(key)}</div></td>`;
}

function openKeysColsModal() {
  const view = _ensureKeysTableView();
  if (!view) return;
  view.openColumns(
    document.getElementById('keys-cols-modal-list'),
    document.getElementById('keys-cols-modal'),
    col => _KEYS_FIELD_META[col].label
  );
}

function _applyKeysColsModal() {
  const view = _ensureKeysTableView();
  if (!view) return;
  const modal = document.getElementById('keys-cols-modal');
  view.applyColumns(modal, () => {
    renderKeysTable();
    HubModal.close(modal);
  });
}

function _openKeyRowActions(id) {
  if (typeof TableRowActions === 'undefined') return;
  const key = _keys.find(item => String(item.id) === String(id));
  if (!key) return;
  const actions = [
    {
      label: 'Show details',
      detail: 'Open the SSH key scope and usage dialog',
      onClick: () => openKeyInfo(id),
    },
  ];
  if (key.present || key.pub_present) {
    actions.push({
      label: 'Delete key files',
      detail: 'Remove the private and public key files from this node',
      tone: 'danger',
      onClick: () => deleteKey(id, key.label || id),
    });
  }
  TableRowActions.open({
    title: key.label || 'SSH key actions',
    subtitle: key.env_var || '',
    actions,
  });
}

async function loadKeys() {
  const tbody = document.getElementById('keys-status-tbody');
  const err   = document.getElementById('keys-status-error');
  err.hidden  = true;
  try {
    const r = await apiFetch('/api/v1/keys/status');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _keys = (await r.json()).keys;
    renderKeysTable();
    updateKeyBadge(_keys);
  } catch (e) {
    err.textContent = `Failed to load key status: ${e.message}`;
    err.hidden = false;
  }
}

const KEY_INFO = {
  xarta_node: {
    comment: 'REDACTED-KEY-COMMENT',
    scope: 'xarta-node fleet LXCs only',
    usedBy: [
      { label: 'fleet-pull-public.sh / fleet-pull-private.sh', detail: 'Node-to-node SSH when triggering a git pull across all fleet nodes.' },
      { label: 'Node onboarding scripts', detail: 'Copying the keypair and .nodes.json to a new node during onboarding.' },
      { label: 'ssh-install.sh', detail: 'Installs this keypair on a new node.' },
      { label: 'Probes → SSH Targets table', detail: 'Assigned automatically to any IP belonging to a fleet LXC node.' },
      { label: 'GitHub SSH auth', detail: 'Used as the deploy key for authenticating git clone/pull of both repos on all nodes.' },
    ],
    notes: "Must be present on every fleet node. Its public key must be in each node's authorized_keys and registered as a GitHub deploy key.",
  },
  lxc: {
    comment: 'REDACTED-KEY-COMMENT',
    scope: 'Non-fleet LXCs only',
    usedBy: [
      { label: 'Probes → SSH Targets table', detail: 'Assigned automatically to LXC containers that are not xarta-node fleet members.' },
      { label: 'Dockge Stacks probe', detail: 'SSH into non-fleet LXCs to discover running Dockge/Docker stacks.' },
    ],
    notes: 'Never use for fleet LXCs or VMs. Strict scope: non-fleet LXCs only.',
  },
  vm: {
    comment: 'REDACTED-KEY-COMMENT',
    scope: 'QEMU VMs only (not LXCs, not PVE hosts)',
    usedBy: [
      { label: 'Probes → SSH Targets table', detail: 'Assigned to QEMU VMs (excluding citadel, PBS nodes, pfSense, and nested-PVE VMs).' },
      { label: 'push-vm-key.sh', detail: 'Distributes this public key to a target VM.' },
      { label: 'Dockge Stacks probe', detail: 'SSH into VMs to discover running Dockge/Docker stacks.' },
    ],
    notes: 'Do not use for LXCs or PVE hosts. Nested-PVE VMs use PROXMOX_SSH_KEY instead.',
  },
  citadel: {
    comment: 'REDACTED-KEY-COMMENT',
    scope: 'Citadel VM only — strictly isolated',
    usedBy: [
      { label: 'Probes → SSH Targets table', detail: 'Assigned to the citadel VM specifically (via CITADEL_VMID env var).' },
      { label: 'Dockge Stacks probe', detail: 'SSH into citadel to discover its running stacks.' },
    ],
    notes: 'The most tightly scoped key. It goes nowhere else and nothing else uses it. Do not copy to other nodes unless explicitly needed for a citadel probe.',
  },
  proxmox: {
    comment: 'REDACTED-KEY-COMMENT',
    scope: 'Proxmox PVE hosts only',
    usedBy: [
      { label: 'Probes → Proxmox Config probe', detail: 'SSH into PVE hosts to read network interface config for LXCs and VMs.' },
      { label: 'Probes → Proxmox Discovery', detail: 'SSH into PVE hosts to enumerate all LXCs and VMs (pct/qm list).' },
      { label: 'Nodes tab → PCT Status', detail: 'Live status polling of containers via pct exec on the PVE host.' },
      { label: 'Probes → Caddy Configs probe', detail: 'SSH into PVE hosts to read Caddyfile configs from containers.' },
      { label: 'Probes → SSH Targets table', detail: 'Assigned to PVE host IPs and nested-PVE VMs.' },
    ],
    notes: 'Required on any node that runs Proxmox probes. Only needs to be present on nodes performing active probes.',
  },
  pfsense: {
    comment: 'REDACTED-KEY-COMMENT',
    scope: 'pfSense firewall only',
    usedBy: [
      { label: 'Probes → pfSense DNS probe', detail: 'SSH into pfSense to harvest DNS resolver entries, domain overrides, and DHCP leases.' },
      { label: 'Probes → pfSense ARP sweep', detail: 'SSH into pfSense to read the ARP table and update last-seen / MAC data for DNS entries.' },
      { label: 'Probes → proxmox-nets pfSense sweep', detail: 'SSH into pfSense to resolve IPs for Proxmox VM/LXC NICs via ARP.' },
      { label: 'Probes → SSH Targets table', detail: 'Assigned to the pfSense IP (via PFSENSE_SSH_TARGET env var).' },
    ],
    notes: 'Only needs to be present on nodes that run pfSense probes. The pfSense probe user is a locked-down account with read-only shell access.',
  },
};

function renderKeysTable() {
  const tbody = document.getElementById('keys-status-tbody');
  const view = _ensureKeysTableView();
  const visibleCols = _keysVisibleCols();
  if (!_keys.length) {
    view?.render(() => {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${Math.max(1, visibleCols.length)}">No keys configured.</td></tr>`;
    });
    return;
  }
  const rows = view?.sorter ? view.sorter.sortRows(_keys, _keysSortValue) : _keys;
  view?.render(() => {
    tbody.innerHTML = rows.map(k => `<tr>${visibleCols.map(col => {
      switch (col) {
        case 'label':
          return _keysLabelCell(k);
        case 'env_var':
          return _keysEnvVarCell(k);
        case 'path':
          return _keysPathCell(k);
        case 'present':
          return _keysPrivateCell(k);
        case 'pub_present':
          return _keysPublicCell(k);
        case '_actions':
          return _keysActionsCell(k);
        default:
          return '';
      }
    }).join('')}</tr>`).join('');
  });
}

function openKeyInfo(id) {
  const info  = KEY_INFO[id];
  const key   = _keys.find(k => k.id === id);
  const modal = document.getElementById('key-info-modal');
  if (!info || !key || !modal) return;
  const badge = document.getElementById('key-info-badge');
  if (badge) badge.textContent = 'KEY';
  document.getElementById('key-info-title').textContent = key.label;
  document.getElementById('key-info-body').innerHTML = `
    <div style="margin-bottom:14px">
      <div style="display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;gap:12px">
          <span style="min-width:80px;color:var(--text-dim);font-size:11px;text-transform:uppercase;letter-spacing:.4px">Comment</span>
          <code style="font-size:12px;color:var(--accent)">${esc(info.comment)}</code>
        </div>
        <div style="display:flex;gap:12px">
          <span style="min-width:80px;color:var(--text-dim);font-size:11px;text-transform:uppercase;letter-spacing:.4px">Scope</span>
          <span style="font-size:13px">${esc(info.scope)}</span>
        </div>
        <div style="display:flex;gap:12px">
          <span style="min-width:80px;color:var(--text-dim);font-size:11px;text-transform:uppercase;letter-spacing:.4px">Path</span>
          <code style="font-size:12px;color:var(--text-dim)">${esc(key.path)}</code>
        </div>
        <div style="display:flex;gap:12px">
          <span style="min-width:80px;color:var(--text-dim);font-size:11px;text-transform:uppercase;letter-spacing:.4px">Status</span>
          <span style="${key.present ? 'color:var(--ok)' : 'color:var(--err)'}">
            ${key.present ? '&#10003; present' : '&#10007; not present on this node'}
          </span>
        </div>
      </div>
    </div>
    <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--text-dim);margin-bottom:8px">Used by</h3>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">
      ${info.usedBy.map(u => `
        <div style="background:var(--bg);border-radius:var(--radius);padding:8px 12px">
          <div style="font-size:13px;font-weight:600;margin-bottom:2px">${esc(u.label)}</div>
          <div style="font-size:12px;color:var(--text-dim)">${esc(u.detail)}</div>
        </div>`).join('')}
    </div>
    <div style="background:rgba(91,156,246,.07);border:1px solid var(--accent-dim);border-radius:var(--radius);padding:10px 12px;font-size:12px;color:var(--text-dim);line-height:1.6">
      ${esc(info.notes)}
    </div>`;
  HubModal.open(document.getElementById('key-info-modal'));
}

async function deleteKey(id, label) {
  const ok = id === 'xarta_node'
    ? await HubDialogs.confirmDelete({
        title: 'Delete fleet-critical key?',
        message: `Delete "${label}" from this node?`,
        detail:
          'Deleting this key will immediately break:\n' +
          '• All fleet-pull scripts (node-to-node SSH)\n' +
          '• Git push/pull on every fleet node (GitHub deploy key)\n' +
          '• Onboarding any new fleet node\n' +
          '• All SSH probe access to fleet LXCs\n\n' +
          'Only proceed if this key is backed up and you can re-onboard every affected node.',
        confirmText: 'Delete key',
        badge: 'CRIT',
      })
    : await HubDialogs.confirmDelete({
        title: 'Delete key files?',
        message: `Delete key files for "${label}" from this node?`,
        detail: 'The private and public key files will be permanently removed. Ensure they are backed up before deleting.',
        confirmText: 'Delete key',
      });
  if (!ok) return;
  try {
    const r = await apiFetch(`/api/v1/keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (r.status !== 204 && !r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.detail || `HTTP ${r.status}`);
    }
    await loadKeys();
  } catch (e) {
    await HubDialogs.alertError({
      title: 'Delete failed',
      message: `Failed to delete key: ${e.message}`,
    });
  }
}

function parseKeyBundle() {
  const txt    = document.getElementById('keys-import-textarea').value;
  const status = document.getElementById('keys-parse-status');
  const wrap   = document.getElementById('keys-import-checklist');
  const cbWrap = document.getElementById('keys-import-checkboxes');
  _parsedBundle = [];

  // Split on ==== ... ==== headers
  const headerRe = /^==== (.+?) \[([^\]]+)\] \((private|public)\) ====\s*$/m;
  const parts = txt.split(/(?=^==== )/m);
  const byId = {};

  for (const part of parts) {
    const m = part.match(headerRe);
    if (!m) continue;
    const label  = m[1];
    const id     = m[2];
    const kind   = m[3];   // 'private' | 'public'
    const body   = part.replace(headerRe, '').trim();
    if (!byId[id]) byId[id] = { id, label, private: '', public: '' };
    byId[id][kind] = body;
  }

  const parsed = Object.values(byId).filter(e => e.private);
  if (!parsed.length) {
    status.textContent = '✗ No recognisable key sections found.';
    status.style.color = 'var(--err)';
    wrap.style.display = 'none';
    return;
  }

  _parsedBundle = parsed;
  status.textContent = `Parsed ${parsed.length} key(s).`;
  status.style.color = 'var(--ok)';

  // Build checkbox list — match to known keys
  const knownIds = new Set(_keys.map(k => k.id));
  cbWrap.innerHTML = parsed.map(e => {
    const known = knownIds.has(e.id);
    const keyMeta = _keys.find(k => k.id === e.id);
    const lbl = keyMeta ? `${keyMeta.label} <span style="color:var(--text-dim);font-size:11px">[${e.id}]</span>`
                        : `<span style="color:var(--warn)">${esc(e.label)} [${esc(e.id)}] — unknown id, will not import</span>`;
    return `<label class="hub-checkbox hub-checkbox--row" style="cursor:${known?'pointer':'default'}">
      <input class="hub-checkbox__input" type="checkbox" data-bundle-id="${esc(e.id)}" ${known ? 'checked' : 'disabled'}>
      <span class="hub-checkbox__box" aria-hidden="true"></span>
      <span class="hub-checkbox__label">${lbl}</span>
    </label>`;
  }).join('');

  wrap.style.display = '';
}

async function importSelectedKeys() {
  const result   = document.getElementById('keys-import-result');
  const checked  = [...document.querySelectorAll('#keys-import-checkboxes input[type=checkbox]:checked')];
  const ids      = new Set(checked.map(cb => cb.dataset.bundleId));
  const toImport = _parsedBundle.filter(e => ids.has(e.id));

  if (!toImport.length) {
    result.textContent = 'No keys selected.';
    result.style.color = 'var(--text-dim)';
    return;
  }

  result.textContent = 'Importing…';
  result.style.color = 'var(--text-dim)';

  try {
    const r = await apiFetch('/api/v1/keys/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: toImport.map(e => ({ id: e.id, private: e.private, public: e.public })) }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
    const summary = d.results.map(res =>
      `${res.id}: ${res.status}${res.detail ? ' (' + res.detail + ')' : ''}`
    ).join(' | ');
    result.textContent = summary;
    result.style.color = d.results.every(res => res.status === 'written') ? 'var(--ok)' : 'var(--warn)';
    await loadKeys();
  } catch (e) {
    result.textContent = `Error: ${e.message}`;
    result.style.color = 'var(--err)';
  }
}

async function loadFromStore() {
  const pw     = document.getElementById('keys-store-password').value;
  const status = document.getElementById('keys-store-status');
  const ta     = document.getElementById('keys-store-bundle');
  if (pw.length < 10) return;
  status.style.color = 'var(--text-dim)';
  status.textContent = 'Fetching encrypted store…';
  try {
    const storeR = await apiFetch('/api/v1/keys/store');
    if (storeR.status === 404) {
      status.textContent = 'No encrypted store found — paste a key bundle above and Save to store.';
      status.style.color = 'var(--warn)';
      return;
    }
    if (!storeR.ok) throw new Error('HTTP ' + storeR.status);
    const storeD = await storeR.json();
    status.textContent = 'Decrypting…';
    let entries;
    try {
      const pt = await _ksDecrypt(pw, storeD.blob);
      entries  = JSON.parse(pt);
    } catch {
      throw new Error('Decryption failed — check your password.');
    }
    const ids = Object.keys(entries);
    if (!ids.length) {
      status.textContent = 'Encrypted store is empty.';
      status.style.color = 'var(--warn)';
      return;
    }
    const sections = [];
    for (const id of ids) {
      const e = entries[id], label = e.label || id;
      if (e.private) sections.push(`==== ${label} [${id}] (private) ====\n${e.private.trimEnd()}`);
      if (e.public)  sections.push(`==== ${label} [${id}] (public) ====\n${e.public.trimEnd()}`);
    }
    ta.value           = sections.join('\n\n');
    status.textContent = `✓ ${ids.length} key(s) loaded — edit if needed, then Save to store`;
    status.style.color = 'var(--ok)';
  } catch (e) {
    status.textContent = '✗ ' + e.message;
    status.style.color = 'var(--err)';
  }
}

function copyStoreBundle() {
  const ta = document.getElementById('keys-store-bundle');
  const s  = document.getElementById('keys-store-status');
  if (!ta.value.trim()) {
    s.textContent = 'Nothing to copy — load from store first.';
    s.style.color = 'var(--warn)';
    return;
  }
  navigator.clipboard.writeText(ta.value).then(() => {
    const prev = s.textContent;
    s.textContent = '✓ Copied to clipboard';
    s.style.color = 'var(--ok)';
    setTimeout(() => { s.textContent = prev; }, 2000);
  }).catch(async e => {
    await HubDialogs.alertError({
      title: 'Copy failed',
      message: `Copy failed: ${e.message}`,
    });
  });
}


/* ── Key Store Crypto (WebCrypto, client-side AES-256-GCM) ─────────────── */

async function _ksDeriveKey(password, salt) {
  const enc         = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function _ksEncrypt(password, plaintext) {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await _ksDeriveKey(password, salt);
  const ct   = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)
  );
  return JSON.stringify({
    v:    1,
    salt: Array.from(salt),
    iv:   Array.from(iv),
    ct:   Array.from(new Uint8Array(ct)),
  });
}

async function _ksDecrypt(password, blobJson) {
  const b   = JSON.parse(blobJson);
  const key = await _ksDeriveKey(password, new Uint8Array(b.salt));
  const pt  = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(b.iv) }, key, new Uint8Array(b.ct)
  );
  return new TextDecoder().decode(pt);
}

/* ── Encrypted Key Store UI ─────────────────────────────────────────────── */

let _storeDecrypted = null;

function onStorePasswordInput() {
  const pw = document.getElementById('keys-store-password').value;
  const ok = pw.length >= 10;
  document.getElementById('keys-store-load-btn').disabled = !ok;
  document.getElementById('keys-store-save-btn').disabled = !ok;
  document.getElementById('keys-store-open-btn').disabled = !ok;
}

function toggleStorePasswordVisibility() {
  const inp = document.getElementById('keys-store-password');
  const btn = document.getElementById('keys-store-pw-toggle');
  if (inp.type === 'password') {
    inp.type  = 'text';
    btn.title = 'Hide password';
  } else {
    inp.type  = 'password';
    btn.title = 'Show password';
  }
}

async function saveToStore() {
  const pw     = document.getElementById('keys-store-password').value;
  const bundle = document.getElementById('keys-store-bundle').value.trim();
  const status = document.getElementById('keys-store-status');
  const btn    = document.getElementById('keys-store-save-btn');
  if (pw.length < 10) return;
  if (!bundle) {
    status.textContent = 'Text area is empty — load from store or paste a key bundle first.';
    status.style.color = 'var(--warn)';
    return;
  }
  btn.disabled = true;
  status.style.color = 'var(--text-dim)';
  status.textContent = 'Encrypting…';
  try {
    const entries = {};
    const parts   = bundle.split(/(?=^==== )/m);
    for (const part of parts) {
      const m = part.match(/^==== (.+?) \[([^\]]+)\] \((private|public)\) ====\s*$/m);
      if (!m) continue;
      const lbl = m[1], id = m[2], kind = m[3];
      const body = part.replace(/^==== .+? ====\s*$/m, '').trim();
      if (!entries[id]) entries[id] = { label: lbl, private: '', public: '' };
      entries[id][kind] = body;
    }
    const count = Object.values(entries).filter(e => e.private).length;
    if (!count) {
      status.textContent = 'No valid key sections found — check format: ==== Label [id] (private) ====';
      status.style.color = 'var(--warn)';
      return;
    }
    const blob = await _ksEncrypt(pw, JSON.stringify(entries));
    const r    = await apiFetch('/api/v1/keys/store', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ blob }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || 'HTTP ' + r.status); }
    status.textContent = '✓ ' + count + ' key(s) saved to encrypted store';
    status.style.color = 'var(--ok)';
  } catch (e) {
    status.textContent = '✗ ' + e.message;
    status.style.color = 'var(--err)';
  } finally {
    btn.disabled = document.getElementById('keys-store-password').value.length < 10;
  }
}

async function openEncrypted() {
  const pw     = document.getElementById('keys-store-password').value;
  if (pw.length < 10) return;
  const status    = document.getElementById('keys-store-deploy-status');
  const btn       = document.getElementById('keys-store-open-btn');
  const checklist = document.getElementById('keys-store-checklist');
  const cbWrap    = document.getElementById('keys-store-checkboxes');
  btn.disabled            = true;
  checklist.style.display = 'none';
  _storeDecrypted         = null;
  status.style.color      = 'var(--text-dim)';
  status.textContent      = 'Fetching encrypted store\u2026';
  try {
    const storeR = await apiFetch('/api/v1/keys/store');
    if (storeR.status === 404) {
      status.textContent = 'No encrypted store found on this node.';
      status.style.color = 'var(--warn)';
      return;
    }
    if (!storeR.ok) throw new Error('HTTP ' + storeR.status);
    const storeD = await storeR.json();

    status.textContent = 'Decrypting\u2026';
    let entries;
    try {
      const pt = await _ksDecrypt(pw, storeD.blob);
      entries  = JSON.parse(pt);
    } catch {
      throw new Error('Decryption failed \u2014 check your password.');
    }

    _storeDecrypted = entries;
    const ids = Object.keys(entries);
    if (!ids.length) {
      status.textContent = 'Store is empty.';
      status.style.color = 'var(--warn)';
      return;
    }

    cbWrap.innerHTML = ids.map(id => {
      const lbl = entries[id].label || id;
          return '<label class="hub-checkbox hub-checkbox--row">' +
            '<input class="hub-checkbox__input" type="checkbox" value="' + esc(id) + '" checked>' +
            '<span class="hub-checkbox__box" aria-hidden="true"></span>' +
            '<span class="hub-checkbox__label">' + esc(lbl) + '</span>' +
             '</label>';
    }).join('');
    checklist.style.display = '';
    status.textContent      = '\u2713 Decrypted \u2014 ' + ids.length + ' key(s) found';
    status.style.color      = 'var(--ok)';
  } catch (e) {
    status.textContent = '\u2717 ' + e.message;
    status.style.color = 'var(--err)';
  } finally {
    btn.disabled = document.getElementById('keys-store-password').value.length < 10;
  }
}

async function importFromStore() {
  if (!_storeDecrypted) return;
  const cbWrap  = document.getElementById('keys-store-checkboxes');
  const result  = document.getElementById('keys-store-import-result');
  const checked = [...cbWrap.querySelectorAll('input[type=checkbox]:checked')].map(cb => cb.value);
  if (!checked.length) { result.textContent = 'Select at least one key.'; return; }

  const keysToImport = checked
    .filter(id => _storeDecrypted[id] && _storeDecrypted[id].private)
    .map(id => ({
      id,
      private: _storeDecrypted[id].private,
      public:  _storeDecrypted[id].public || '',
    }));
  if (!keysToImport.length) { result.textContent = 'No valid key material found in selection.'; return; }

  result.style.color = 'var(--text-dim)';
  result.textContent = 'Importing\u2026';
  try {
    const r = await apiFetch('/api/v1/keys/import', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ keys: keysToImport }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || 'HTTP ' + r.status);
    const written = d.results.filter(x => x.status === 'written').length;
    const failed  = d.results.filter(x => x.status === 'failed').length;
    result.textContent = '\u2713 Imported ' + written + ' key(s)' +
      (failed ? '; \u2717 ' + failed + ' failed' : '');
    result.style.color = failed ? 'var(--warn)' : 'var(--ok)';
    await loadKeys();
  } catch (e) {
    result.textContent = '\u2717 ' + e.message;
    result.style.color = 'var(--err)';
  }
}
document.addEventListener('DOMContentLoaded', () => {
  _ensureKeysTableView();
  document.getElementById('keys-cols-modal-apply')?.addEventListener('click', _applyKeysColsModal);
  document.getElementById('keys-status-tbody')?.addEventListener('click', e => {
    const infoBtn = e.target.closest('[data-key-info]');
    const delBtn  = e.target.closest('[data-key-del-id]');
    const actionBtn = e.target.closest('[data-key-actions]');
    if (infoBtn) openKeyInfo(infoBtn.dataset.keyInfo);
    if (delBtn)  deleteKey(delBtn.dataset.keyDelId, delBtn.dataset.keyDelLabel);
    if (actionBtn) _openKeyRowActions(actionBtn.dataset.keyActions);
  });
  _keysTableView?.onLayoutChange(() => {
    renderKeysTable();
  });
});