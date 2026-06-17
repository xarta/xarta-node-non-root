'use strict';

let _disksTopology = null;
let _disksNodeById = new Map();
let _disksParentById = new Map();
let _disksCurrentNodeId = 'fleet:disks';
let _disksLoadPromise = null;
let _disksSourceIssues = [];
let _disksInitDone = false;
let _disksLayoutFrame = 0;
let _disksFilesystemTreeCache = new Map();
let _disksFilesystemTreePaths = new Map();
let _disksFilesystemTreeLoadingKeys = new Set();
let _disksNoteDrafts = new Map();
let _disksNoteOpen = new Set();
let _disksNoteSaving = new Set();
let _disksNoteErrors = new Map();
let _disksNoteSaveTimers = new Map();
let _disksOfflineBrowseState = null;

const _DISKS_BLUE_ICON = '/fallback-ui/assets/icons/ui/drive-blue.svg';
const _DISKS_GOLD_ICON = '/fallback-ui/assets/icons/ui/drive-gold.svg';
const _DISKS_HOST_ICON = '/fallback-ui/assets/icons/ui/proxmox-blue.svg';
const _DISKS_HOST_GOLD_ICON = '/fallback-ui/assets/icons/ui/proxmox-gold.svg';
const _DISKS_CLUSTER_MIN_CARD_WIDTH = 220;
const _DISKS_CLUSTER_COLORS = [
  '91, 156, 246',
  '230, 168, 23',
  '62, 189, 153',
  '224, 92, 92',
  '173, 130, 255',
  '58, 188, 218',
];
const _DISKS_FULL_WIDTH_FACTS = new Set([
  'model',
  'description',
  'guest-roles',
  'assigned-to',
  'backed-by',
  'assignment',
]);
const _DISKS_FACT_PRIORITIES = {
  fleet: [
    'source',
    'installed-total',
    'guest-assigned',
    'known-capacity',
    'known-free',
  ],
  host: [
    'source',
    'installed-total',
    'guest-assigned',
    'known-capacity',
    'known-free',
  ],
  'nested-host': [
    'source',
    'installed-total',
    'guest-assigned',
    'known-capacity',
    'known-free',
  ],
  drive: [
    'path',
    'serial',
    'model',
    'vendor',
    'transport',
    'assigned-to',
    'assignment',
    'rotational',
    'filesystem',
    'mount',
    'part-label',
    'uuid',
    'pools',
  ],
  partition: [
    'path',
    'filesystem',
    'mount',
    'part-label',
    'uuid',
    'serial',
    'vendor',
    'transport',
    'rotational',
    'model',
    'pools',
  ],
  volume: [
    'filesystem',
    'mount',
    'path',
    'volume-label',
    'uuid',
    'assigned-to',
    'part-label',
    'backing-drive',
    'drive-model',
    'transport',
    'source',
  ],
  'guest-storage': [
    'filesystem',
    'mount',
    'path',
    'volume-label',
    'uuid',
    'guest-pool',
    'guest-vdev',
    'part-label',
    'backed-by',
    'model',
    'guest-host',
  ],
  pool: [
    'health',
    'fragmentation',
    'path',
    'mount',
    'uuid',
    'source',
  ],
  default: [
    'path',
    'filesystem',
    'serial',
    'vendor',
    'transport',
    'rotational',
    'mount',
    'part-label',
    'uuid',
    'model',
    'source',
  ],
};

function _disksEl(id) {
  return document.getElementById(id);
}

function _disksEsc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _disksFormatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let size = value;
  let unitIdx = 0;
  while (size >= 1024 && unitIdx < units.length - 1) {
    size /= 1024;
    unitIdx += 1;
  }
  const decimals = size >= 100 || unitIdx === 0 ? 0 : 1;
  return `${size.toFixed(decimals)}${units[unitIdx]}`;
}

function _disksByteValue(value) {
  const bytes = Number(value);
  return Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
}

function _disksPartialUsage(node) {
  if (!node || node.used_bytes != null) return null;
  const total = _disksByteValue(node.total_bytes);
  const knownUsed = _disksByteValue(node.known_used_bytes);
  const unknownBytes = _disksByteValue(node.guest_assigned_unknown_bytes);
  if (total == null || knownUsed == null || unknownBytes == null || unknownBytes <= 0 || unknownBytes >= total) {
    return null;
  }
  const knownTotal = Math.max(0, total - unknownBytes);
  if (!knownTotal) return null;
  const knownFree = Math.max(0, knownTotal - knownUsed);
  return {
    total,
    knownUsed,
    knownTotal,
    knownFree,
    unknownBytes,
    knownPct: Math.max(0, Math.min(100, (knownUsed / knownTotal) * 100)),
  };
}

function _disksUsageText(node) {
  const partial = _disksPartialUsage(node);
  if (partial) {
    return `${_disksFormatBytes(partial.knownUsed)} used · ${_disksFormatBytes(partial.knownFree)} free on ${_disksFormatBytes(partial.knownTotal)} known`;
  }
  if (node && typeof node.usage_text === 'string' && node.usage_text.trim()) {
    return node.usage_text.trim();
  }
  if (!node || node.total_bytes == null) return 'Usage unavailable';
  const used = node.used_bytes == null ? '—' : _disksFormatBytes(node.used_bytes);
  return `${used} / ${_disksFormatBytes(node.total_bytes)}`;
}

function _disksUsagePct(node) {
  const partial = _disksPartialUsage(node);
  if (partial) return partial.knownPct;
  if (!node || node.usage_pct == null || node.usage_pct === '') return null;
  const pct = Number(node.usage_pct);
  return Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : null;
}

function _disksUsagePctLabel(node, pct) {
  const partial = _disksPartialUsage(node);
  if (partial) {
    return `${pct.toFixed(1)}% of known capacity used`;
  }
  return `${pct.toFixed(1)}% used`;
}

function _disksStatusTone(status) {
  if (status === 'ok') return 'ok';
  if (status === 'warn') return 'warn';
  if (status === 'fail') return 'fail';
  if (status === 'stale') return 'stale';
  return 'info';
}

function _disksNodeIcon(node) {
  const kind = String(node?.kind || '').trim();
  if (kind === 'host' || kind === 'nested-host') return _DISKS_HOST_ICON;
  if (kind === 'pool' || kind === 'dataset' || kind === 'volume') return _DISKS_GOLD_ICON;
  return _DISKS_BLUE_ICON;
}

function _disksFilesystemTreeReset() {
  _disksFilesystemTreeCache = new Map();
  _disksFilesystemTreePaths = new Map();
  _disksFilesystemTreeLoadingKeys = new Set();
}

function _disksUserNote(node) {
  return String(node?.user_note || '').trim();
}

function _disksNoteDraftForNode(node) {
  const nodeId = String(node?.id || '').trim();
  if (!nodeId) return '';
  return _disksNoteDrafts.has(nodeId) ? String(_disksNoteDrafts.get(nodeId) || '') : _disksUserNote(node);
}

function _disksOfflineBrowserMeta(node) {
  const raw = node && typeof node.offline_browser === 'object' ? node.offline_browser : null;
  const host = String(raw?.host || '').trim();
  const guestId = String(raw?.guest_id || '').trim();
  const volumeRef = String(raw?.volume_ref || '').trim();
  if (!host || !guestId || !volumeRef) return null;
  return {
    host,
    guest_id: guestId,
    guest_name: String(raw?.guest_name || '').trim(),
    volume_ref: volumeRef,
    volume_label: String(raw?.volume_label || '').trim(),
    slot: String(raw?.slot || '').trim(),
  };
}

function _disksNormalizeRelativePath(path) {
  const text = String(path || '').trim().replace(/\\/g, '/');
  if (!text || text === '.') return '.';
  if (text.startsWith('/')) return '.';
  const parts = [];
  text.split('/').forEach(part => {
    if (!part || part === '.') return;
    if (part === '..') return;
    parts.push(part);
  });
  return parts.join('/') || '.';
}

function _disksFilesystemBrowserMeta(node) {
  const raw = node && typeof node.filesystem_browser === 'object' ? node.filesystem_browser : null;
  const host = String(raw?.host || '').trim();
  const rootPath = String(raw?.root_path || '').trim();
  if (!host || !rootPath) return null;
  const browseMode = String(raw?.browse_mode || '').trim().toLowerCase() === 'device_ro'
    ? 'device_ro'
    : 'mounted';
  return {
    host,
    root_path: rootPath,
    root_display: String(raw?.root_display || '').trim(),
    browse_mode: browseMode,
    filesystem: String(raw?.filesystem || '').trim(),
    source_path: String(raw?.source_path || '').trim(),
    dataset_name: String(raw?.dataset_name || '').trim(),
    download_available: !!raw?.download_available,
  };
}

function _disksFilesystemTreeNodeKey(node, meta) {
  const treeIdentity = meta.browse_mode === 'device_ro'
    ? `${meta.host}::device_ro::${meta.source_path || meta.root_path}`
    : `${meta.host}::mounted::${meta.root_path}`;
  return `${String(node?.id || '').trim()}::${treeIdentity}`;
}

function _disksFilesystemTreeCacheKey(meta, path) {
  const treeIdentity = meta.browse_mode === 'device_ro'
    ? `${meta.host}::device_ro::${meta.source_path || meta.root_path}`
    : `${meta.host}::mounted::${meta.root_path}`;
  return `${treeIdentity}::${_disksNormalizeRelativePath(path)}`;
}

function _disksFilesystemTreePathForNode(node, meta) {
  return _disksFilesystemTreePaths.get(_disksFilesystemTreeNodeKey(node, meta)) || '.';
}

function _disksFilesystemTreeCached(node, meta, path) {
  return _disksFilesystemTreeCache.get(_disksFilesystemTreeCacheKey(meta, path)) || null;
}

function _disksFilesystemTreeLoading(node, meta, path) {
  return _disksFilesystemTreeLoadingKeys.has(_disksFilesystemTreeCacheKey(meta, path));
}

function _disksFilesystemTreeFormatTimestamp(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return date.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch (_) {
    return date.toLocaleString();
  }
}

function _disksFilesystemTreeEntryMetaText(entry) {
  const bits = [];
  const symlinkTarget = String(entry?.symlink_target || '').trim();
  if (symlinkTarget) bits.push(`link -> ${symlinkTarget}`);
  if (String(entry?.type || '').trim() === 'file' && entry?.size_bytes != null) {
    bits.push(_disksFormatBytes(entry.size_bytes));
  }
  const modified = _disksFilesystemTreeFormatTimestamp(entry?.modified_at);
  if (modified) bits.push(modified);
  const errorText = String(entry?.error || '').trim();
  if (errorText) bits.push(errorText);
  return bits.join(' · ');
}

function _disksFilesystemTreeStatusText(data) {
  const total = Number(data?.entry_count || 0);
  const shown = Number(data?.returned_count || 0);
  if (!total) return 'This folder is empty.';
  if (data?.truncated && shown && total > shown) {
    return `Showing first ${shown} of ${total} items in this folder`;
  }
  return `${total} item${total === 1 ? '' : 's'} in this folder`;
}

function _disksFilesystemTreeRowHtml(entry) {
  const type = String(entry?.type || '').trim() === 'folder' ? 'folder' : 'file';
  const browseable = type === 'folder' && !!entry?.browseable;
  const path = _disksNormalizeRelativePath(entry?.path || '.');
  const detailText = _disksFilesystemTreeEntryMetaText(entry);
  const nameHtml = browseable
    ? `<button class="docs-tree-name bp-font-role-docs-markdown" type="button" data-disks-tree-action="browse" data-path="${_disksEsc(path)}" title="${_disksEsc(`Open ${entry?.name || 'folder'}`)}">${_disksEsc(entry?.name || path)}</button>`
    : `<span class="docs-tree-name disks-tree__name-static bp-font-role-docs-markdown">${_disksEsc(entry?.name || path)}</span>`;
  const labelHtml = detailText
    ? `
        <span class="docs-tree-label">
          ${nameHtml}
          <span class="docs-tree-subpath">${_disksEsc(detailText)}</span>
        </span>
      `
    : nameHtml;
  const typeBadge = `<span class="docs-tree-badge">${type === 'folder' ? 'Dir' : 'File'}</span>`;
  const linkBadge = entry?.symlink ? '<span class="docs-tree-badge">Link</span>' : '';
  return `
    <div class="docs-tree-row" data-path="${_disksEsc(path)}" data-type="${_disksEsc(type)}">
      <span class="docs-tree-icon docs-tree-icon--${_disksEsc(type)}" aria-hidden="true"></span>
      ${labelHtml}
      <span class="docs-tree-actions">
        ${linkBadge}
        ${typeBadge}
        <button class="secondary table-icon-btn table-icon-btn--pull disks-tree__download-btn" type="button" disabled title="Download is coming later" aria-label="Download is coming later"></button>
      </span>
    </div>
  `;
}

function _disksFilesystemTreeSectionHtml(node) {
  const meta = _disksFilesystemBrowserMeta(node);
  if (!meta) return '';
  const currentPath = _disksFilesystemTreePathForNode(node, meta);
  const cached = _disksFilesystemTreeCached(node, meta, currentPath);
  const loading = _disksFilesystemTreeLoading(node, meta, currentPath);
  const data = cached?.ok ? cached.data : null;
  const error = cached && cached.ok === false ? cached.error : '';
  const absolutePath = String(data?.current_absolute_path || meta.root_path).trim() || meta.root_path;
  const relativePath = String(data?.current_path || currentPath || '.').trim() || '.';
  const canGoUp = !!data?.parent_path && relativePath !== '.';
  const rootDisabled = relativePath === '.';
  const filesystemLabel = (_disksFilesystemPillLabel(node) || meta.filesystem || 'filesystem').toUpperCase();
  const breadcrumbs = Array.isArray(data?.breadcrumbs) ? data.breadcrumbs : [];
  const rootMetaText = meta.browse_mode === 'device_ro'
    ? (meta.source_path || meta.root_display || meta.root_path)
    : (meta.root_display || meta.root_path);
  const breadcrumbHtml = breadcrumbs.map(crumb => `
    <button class="docs-tree-crumb bp-font-role-docs-markdown" type="button" data-disks-tree-action="browse" data-path="${_disksEsc(crumb?.path || '.')}">${_disksEsc(crumb?.label || 'root')}</button>
  `).join('');

  let listHtml = '<div class="docs-tree-loading">Loading folder...</div>';
  if (error) {
    listHtml = '<div class="docs-tree-empty">Could not load this folder.</div>';
  } else if (data) {
    const entries = Array.isArray(data.entries) ? data.entries : [];
    listHtml = entries.length
      ? entries.map(entry => _disksFilesystemTreeRowHtml(entry)).join('')
      : '<div class="docs-tree-empty">This folder is empty.</div>';
  } else if (!loading) {
    listHtml = '<div class="docs-tree-empty">Preparing filesystem tree…</div>';
  }

  const statusText = error
    ? ''
    : loading && !data
      ? 'Loading folder...'
      : _disksFilesystemTreeStatusText(data);

  return `
    <section class="disks-group disks-tree">
      <div class="disks-group__header">
        <h3>Filesystem tree</h3>
        <span>Protected in-page browse · download later</span>
      </div>
      <div class="disks-tree__meta">
        <span class="disks-pill">${_disksEsc(meta.host)}</span>
        <span class="disks-pill">${_disksEsc(filesystemLabel)}</span>
        <code class="disks-tree__root">${_disksEsc(rootMetaText)}</code>
      </div>
      <div class="docs-tree-shell disks-tree__shell">
        <div class="disks-tree__toolbar">
          <button class="hub-modal-btn secondary" type="button" data-disks-tree-action="up"${canGoUp ? '' : ' disabled'}>Up</button>
          <code class="docs-tree-path disks-tree__path">${_disksEsc(absolutePath)}</code>
          <div class="disks-tree__toolbar-actions">
            <button class="hub-modal-btn secondary" type="button" data-disks-tree-action="root"${rootDisabled ? ' disabled' : ''}>Root</button>
            <button class="hub-modal-btn secondary" type="button" data-disks-tree-action="refresh">Refresh</button>
          </div>
        </div>
        <div class="docs-tree-breadcrumbs"${breadcrumbs.length > 1 ? '' : ' hidden'}>${breadcrumbHtml}</div>
        <div class="docs-tree-panel">
          <div class="docs-tree-list">${listHtml}</div>
        </div>
        <p class="docs-tree-status">${_disksEsc(statusText)}</p>
        <p class="hub-modal-error disks-tree__error"${error ? '' : ' hidden'}>${_disksEsc(error ? `Error: ${error}` : '')}</p>
        <p class="disks-tree__relative bp-font-role-status-meta">${_disksEsc(relativePath === '.' ? 'root' : relativePath)}</p>
      </div>
    </section>
  `;
}

function _disksOfflineBrowserSectionHtml(node) {
  const meta = _disksOfflineBrowserMeta(node);
  if (!meta) return '';
  const guestLabel = meta.guest_name || `VM ${meta.guest_id}`;
  const volumeLabel = meta.volume_label || meta.volume_ref;
  return `
    <section class="disks-group disks-offline-browser">
      <div class="disks-group__header">
        <h3>Offline VM disk</h3>
        <span>Read-only browse with watchdog cleanup</span>
      </div>
      <div class="disks-offline-browser__panel">
        <div class="disks-offline-browser__copy">
          <strong>${_disksEsc(volumeLabel)}</strong>
          <p>This is a Proxmox VM disk for ${_disksEsc(guestLabel)}. Blueprints can attach it read-only only while the guest is stopped, and will auto-clean up if the browser disappears.</p>
        </div>
        <button
          type="button"
          class="hub-modal-btn secondary disks-offline-browser__open"
          data-disks-offline-open="${_disksEsc(String(node?.id || '').trim())}"
        >Browse offline</button>
      </div>
    </section>
  `;
}

function _disksFilesystemTreeNavigate(node, meta, path) {
  _disksFilesystemTreePaths.set(
    _disksFilesystemTreeNodeKey(node, meta),
    _disksNormalizeRelativePath(path),
  );
  renderDisksPage();
}

function _disksFilesystemTreeRefresh(node, meta) {
  const currentPath = _disksFilesystemTreePathForNode(node, meta);
  _disksFilesystemTreeCache.delete(_disksFilesystemTreeCacheKey(meta, currentPath));
  renderDisksPage();
}

function _disksEnsureFilesystemTree(node) {
  const meta = _disksFilesystemBrowserMeta(node);
  if (!meta) return;
  const currentPath = _disksFilesystemTreePathForNode(node, meta);
  const cacheKey = _disksFilesystemTreeCacheKey(meta, currentPath);
  if (_disksFilesystemTreeCache.has(cacheKey) || _disksFilesystemTreeLoadingKeys.has(cacheKey)) {
    return;
  }
  _disksFilesystemTreeLoadingKeys.add(cacheKey);
  apiFetch('/api/v1/disks/filesystem/tree', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host: meta.host,
      root_path: meta.root_path,
      browse_mode: meta.browse_mode,
      source_path: meta.browse_mode === 'device_ro' ? meta.source_path : null,
      path: currentPath === '.' ? null : currentPath,
    }),
  })
    .then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || `HTTP ${response.status}`);
      }
      _disksFilesystemTreeCache.set(cacheKey, { ok: true, data });
      _disksFilesystemTreePaths.set(
        _disksFilesystemTreeNodeKey(node, meta),
        _disksNormalizeRelativePath(data?.current_path || currentPath),
      );
    })
    .catch(err => {
      const message = err && err.message ? err.message : String(err || 'Filesystem tree failed');
      _disksFilesystemTreeCache.set(cacheKey, { ok: false, error: message });
    })
    .finally(() => {
      _disksFilesystemTreeLoadingKeys.delete(cacheKey);
      if (_disksCurrentNodeId === String(node?.id || '')) renderDisksPage();
    });
}

function _disksIndexTree(node, parentId = '') {
  if (!node || !node.id) return;
  _disksNodeById.set(node.id, node);
  _disksParentById.set(node.id, parentId || '');
  const children = Array.isArray(node.children) ? node.children : [];
  children.forEach(child => _disksIndexTree(child, node.id));
}

function _disksCurrentNode() {
  return _disksNodeById.get(_disksCurrentNodeId) || (_disksTopology ? _disksTopology.root : null);
}

function _disksBreadcrumbs() {
  const crumbs = [];
  let cursor = _disksCurrentNodeId;
  while (cursor) {
    const node = _disksNodeById.get(cursor);
    if (!node) break;
    crumbs.unshift(node);
    cursor = _disksParentById.get(cursor) || '';
  }
  return crumbs;
}

function _disksGroupChildren(node) {
  const groups = [];
  const index = new Map();
  const children = Array.isArray(node?.children) ? node.children : [];
  children.forEach(child => {
    const name = String(child?.group || 'Items').trim() || 'Items';
    if (!index.has(name)) {
      index.set(name, groups.length);
      groups.push({ name, items: [] });
    }
    groups[index.get(name)].items.push(child);
  });
  return groups;
}

function _disksStatusMessage(text, tone = 'info', persist = false) {
  const el = _disksEl('disks-status');
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = '';
    el.className = 'disks-status';
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.className = `disks-status disks-status--${tone}`;
  if (persist) return;
  window.clearTimeout(_disksStatusMessage._timer);
  _disksStatusMessage._timer = window.setTimeout(() => {
    if (el.textContent === text) {
      el.hidden = true;
    }
  }, 4000);
}

function _disksFactSlug(label) {
  return String(label ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'fact';
}

function _disksOrderFacts(facts, options = {}) {
  const items = Array.isArray(facts) ? facts.slice() : [];
  if (!items.length) return [];
  const kind = String(options.kind || '').trim().toLowerCase();
  const priorities = _DISKS_FACT_PRIORITIES[kind] || _DISKS_FACT_PRIORITIES.default;
  const priorityIndex = new Map(priorities.map((label, idx) => [label, idx]));
  return items
    .map((fact, idx) => ({
      fact,
      idx,
      key: _disksFactSlug(fact?.label),
    }))
    .sort((left, right) => {
      const leftPriority = priorityIndex.has(left.key) ? priorityIndex.get(left.key) : Number.MAX_SAFE_INTEGER;
      const rightPriority = priorityIndex.has(right.key) ? priorityIndex.get(right.key) : Number.MAX_SAFE_INTEGER;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return left.idx - right.idx;
    })
    .map(entry => entry.fact);
}

function _disksFactValue(node, label) {
  const key = String(label ?? '').trim().toLowerCase();
  const fact = (Array.isArray(node?.facts) ? node.facts : []).find(item => {
    return String(item?.label ?? '').trim().toLowerCase() === key;
  });
  return String(fact?.value ?? '').trim();
}

function _disksFactList(node, label) {
  return _disksFactValue(node, label)
    .split(/[,\n]+/)
    .map(value => value.trim())
    .filter(Boolean);
}

function _disksSmartLabel(node) {
  const name = String(node?.label ?? '').trim();
  const model = _disksFactValue(node, 'model');
  if (name && model) return `${name} ${model}`;
  return name || model || 'Drive health';
}

function _disksHostNodeFor(node) {
  let cursorId = String(node?.id || '').trim();
  while (cursorId) {
    const current = _disksNodeById.get(cursorId);
    const kind = String(current?.kind || '').trim().toLowerCase();
    if (kind === 'host' || kind === 'nested-host') return current;
    cursorId = _disksParentById.get(cursorId) || '';
  }
  return null;
}

function _disksGuestMeta(node) {
  const raw = node && typeof node.guest_identity === 'object' ? node.guest_identity : null;
  const host = String(raw?.host || '').trim();
  const guestKey = String(raw?.guest_key || '').trim();
  if (!host || !guestKey) return null;
  return {
    host,
    guest_key: guestKey,
    guest_id: String(raw?.guest_id || '').trim(),
    guest_kind: String(raw?.guest_kind || '').trim().toLowerCase(),
    guest_kind_label: String(raw?.guest_kind_label || '').trim(),
    guest_name: String(raw?.guest_name || '').trim(),
    guest_display: String(raw?.guest_display || '').trim(),
    guest_summary_label: String(raw?.guest_summary_label || '').trim(),
    guest_button_label: String(raw?.guest_button_label || '').trim(),
  };
}

function _disksGuestSummaryKey(meta) {
  if (!meta) return '';
  const host = String(meta.host || '').trim();
  const guestKey = String(meta.guest_key || '').trim();
  return host && guestKey ? `${host}::${guestKey}` : '';
}

function _disksGuestSummaryButtonHtml(meta, options = {}) {
  const key = _disksGuestSummaryKey(meta);
  if (!key) return '';
  const label = String(options.label || meta.guest_button_label || meta.guest_summary_label || meta.guest_display || 'Guest').trim();
  const title = String(options.title || `Open guest disk summary for ${meta.guest_display || meta.guest_summary_label || 'this guest'}`).trim();
  const className = String(options.className || 'disks-card__jump disks-card__jump--guest').trim();
  return `
    <button
      type="button"
      class="${_disksEsc(className)}"
      title="${_disksEsc(title)}"
      aria-label="${_disksEsc(title)}"
      data-disks-guest-host="${_disksEsc(meta.host)}"
      data-disks-guest-key="${_disksEsc(meta.guest_key)}"
    >${_disksEsc(label)}</button>
  `;
}

function _disksIsGuestDiskNode(node) {
  const meta = _disksGuestMeta(node);
  if (!meta) return false;
  const kind = String(node?.kind || '').trim().toLowerCase();
  if (!['volume', 'dataset'].includes(kind)) return false;
  return /^(vm|base|subvol)-\d+-/i.test(String(node?.label || '').trim());
}

function _disksNearestAncestor(node, kinds) {
  const allowed = new Set((Array.isArray(kinds) ? kinds : []).map(value => String(value || '').trim().toLowerCase()).filter(Boolean));
  if (!allowed.size) return null;
  let cursorId = _disksParentById.get(String(node?.id || '').trim()) || '';
  while (cursorId) {
    const current = _disksNodeById.get(cursorId);
    if (!current) break;
    const kind = String(current.kind || '').trim().toLowerCase();
    if (allowed.has(kind)) return current;
    cursorId = _disksParentById.get(cursorId) || '';
  }
  return null;
}

function _disksHostLogicalSystemNodes(hostNode) {
  return (Array.isArray(hostNode?.children) ? hostNode.children : []).filter(child => {
    return child && String(child.group || '').trim() === 'Logical systems';
  });
}

function _disksPoolNodeFor(hostNode, poolName) {
  const cleanPool = String(poolName || '').trim();
  if (!hostNode || !cleanPool) return null;
  return _disksHostLogicalSystemNodes(hostNode).find(child => {
    return String(child?.kind || '').trim().toLowerCase() === 'pool'
      && String(child?.label || '').trim() === cleanPool;
  }) || null;
}

function _disksNodePoolNames(node) {
  const pools = new Set(_disksDrivePools(node));
  _disksFactList(node, 'Pools').forEach(pool => pools.add(pool));
  const singlePool = _disksFactValue(node, 'Pool');
  if (singlePool) pools.add(singlePool);
  return Array.from(pools).filter(Boolean);
}

function _disksLogicalNodesForDrive(hostNode, driveNode) {
  if (!hostNode || !driveNode) return [];
  const driveLabel = String(driveNode.label || '').trim();
  if (!driveLabel) return [];
  const candidatePaths = new Set();
  const candidateGuestPaths = new Set();
  const candidateMounts = new Set();
  const candidateUuids = new Set();
  const drivePath = _disksFactValue(driveNode, 'Path');
  if (drivePath) candidatePaths.add(drivePath);
  const driveGuestPath = _disksFactValue(driveNode, 'Guest path');
  if (driveGuestPath) candidateGuestPaths.add(driveGuestPath);
  const driveMount = _disksFactValue(driveNode, 'Mount');
  if (driveMount) candidateMounts.add(driveMount);
  const driveUuid = _disksFactValue(driveNode, 'UUID');
  if (driveUuid) candidateUuids.add(driveUuid);
  (Array.isArray(driveNode.children) ? driveNode.children : []).forEach(child => {
    const childPath = _disksFactValue(child, 'Path');
    if (childPath) candidatePaths.add(childPath);
    const childGuestPath = _disksFactValue(child, 'Guest path');
    if (childGuestPath) candidateGuestPaths.add(childGuestPath);
    const childMount = _disksFactValue(child, 'Mount');
    if (childMount) candidateMounts.add(childMount);
    const childUuid = _disksFactValue(child, 'UUID');
    if (childUuid) candidateUuids.add(childUuid);
  });
  return (Array.isArray(hostNode.children) ? hostNode.children : []).filter(child => {
    if (!child || String(child.group || '').trim() !== 'Logical systems') return false;
    if (String(child.kind || '').trim().toLowerCase() !== 'volume') return false;
    const backingDrive = _disksFactValue(child, 'Backing drive');
    if (backingDrive && backingDrive === driveLabel) return true;
    const path = _disksFactValue(child, 'Path');
    if (path && candidatePaths.has(path)) return true;
    const guestPath = _disksFactValue(child, 'Guest path');
    if (guestPath && candidateGuestPaths.has(guestPath)) return true;
    const mount = _disksFactValue(child, 'Mount');
    if (mount && candidateMounts.has(mount)) return true;
    const uuid = _disksFactValue(child, 'UUID');
    return !!(uuid && candidateUuids.has(uuid));
  });
}

function _disksUniqueVolumeMatch(node) {
  if (!node) return null;
  const sourcePaths = new Set([
    _disksFactValue(node, 'Path'),
    _disksFactValue(node, 'Guest path'),
  ].filter(Boolean));
  const sourceMounts = new Set([
    _disksFactValue(node, 'Mount'),
  ].filter(Boolean));
  const sourceUuids = new Set([
    _disksFactValue(node, 'UUID'),
  ].filter(Boolean));
  const sourceVolumeLabels = new Set([
    _disksFactValue(node, 'Volume label'),
  ].filter(Boolean));

  const candidates = Array.from(_disksNodeById.values()).filter(candidate => {
    if (!candidate || candidate === node) return false;
    if (String(candidate.kind || '').trim().toLowerCase() !== 'volume') return false;
    let score = 0;
    const candidateValues = [
      _disksFactValue(candidate, 'Path'),
      _disksFactValue(candidate, 'Guest path'),
    ];
    if (candidateValues.some(value => value && sourcePaths.has(value))) score += 80;
    const candidateUuid = _disksFactValue(candidate, 'UUID');
    if (candidateUuid && sourceUuids.has(candidateUuid)) score += 100;
    const candidateMount = _disksFactValue(candidate, 'Mount');
    if (candidateMount && sourceMounts.has(candidateMount)) score += 30;
    const candidateVolumeLabel = _disksFactValue(candidate, 'Volume label');
    if (candidateVolumeLabel && sourceVolumeLabels.has(candidateVolumeLabel)) score += 15;
    candidate._disksMatchScore = score;
    return score > 0;
  }).sort((left, right) => {
    const scoreDelta = (right._disksMatchScore || 0) - (left._disksMatchScore || 0);
    if (scoreDelta !== 0) return scoreDelta;
    return String(left.label || '').localeCompare(String(right.label || ''));
  });

  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  const topScore = candidates[0]._disksMatchScore || 0;
  const secondScore = candidates[1]._disksMatchScore || 0;
  return topScore > secondScore ? candidates[0] : null;
}

function _disksLogicalNodesForPartition(hostNode, partitionNode) {
  if (!hostNode || !partitionNode) return [];
  const partPath = _disksFactValue(partitionNode, 'Path');
  if (!partPath) return [];
  return _disksHostLogicalSystemNodes(hostNode).filter(child => {
    if (!child) return false;
    const kind = String(child.kind || '').trim().toLowerCase();
    if (kind === 'pool') return false;
    return _disksFactValue(child, 'Path') === partPath;
  });
}

function _disksShortcutTarget(node) {
  if (!node) return null;
  const kind = String(node.kind || '').trim().toLowerCase();
  const hostNode = _disksHostNodeFor(node);
  if (!hostNode) return null;

  if (kind === 'pool-link') {
    return _disksPoolNodeFor(hostNode, _disksFactValue(node, 'Pool') || node.label);
  }

  const pools = _disksNodePoolNames(node);
  if (pools.length === 1) {
    const poolNode = _disksPoolNodeFor(hostNode, pools[0]);
    if (poolNode) return poolNode;
  }

  if (kind === 'drive') {
    const logicalNodes = _disksLogicalNodesForDrive(hostNode, node);
    return logicalNodes.length === 1 ? logicalNodes[0] : null;
  }

  if (kind === 'partition') {
    const logicalNodes = _disksLogicalNodesForPartition(hostNode, node);
    return logicalNodes.length === 1 ? logicalNodes[0] : null;
  }

  return null;
}

function _disksFilesystemShortcutLabel(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  const lower = clean.toLowerCase();
  if (lower === 'zfs' || lower === 'zfs_member') return 'ZFS';
  if (lower === 'exfat') return 'exFAT';
  return clean.toUpperCase();
}

function _disksShortcutMeta(node) {
  const target = _disksShortcutTarget(node);
  if (!target || !target.id) return null;
  const targetKind = String(target.kind || '').trim().toLowerCase();
  const label = targetKind === 'pool'
    ? 'ZFS'
    : _disksFilesystemShortcutLabel(
      _disksFactValue(target, 'Filesystem') || _disksFactValue(node, 'Filesystem')
    );
  if (!label) return null;
  return {
    target,
    label,
    tone: label === 'ZFS' ? 'zfs' : 'fs',
    title: targetKind === 'pool'
      ? `Open ZFS pool ${String(target.label || '').trim() || 'details'}`
      : `Open ${label} details for ${String(target.label || '').trim() || 'allocation'}`,
  };
}

function _disksFilesystemPillLabel(node) {
  const direct = _disksFilesystemShortcutLabel(_disksFactValue(node, 'Filesystem'));
  if (direct) return direct;
  const shortcut = _disksShortcutMeta(node);
  return shortcut && shortcut.tone === 'fs' ? shortcut.label : '';
}

function _disksPrimaryOpenTarget(node) {
  if (!node) return null;
  if (String(node.kind || '').trim().toLowerCase() !== 'pool-link') return node;
  return _disksShortcutTarget(node) || node;
}

function _disksFilesystemTarget(node) {
  const shortcut = _disksShortcutMeta(node);
  if (shortcut?.target?.id) return shortcut.target;
  return _disksUniqueVolumeMatch(node);
}

function _disksDriveSingleMemberPoolName(driveNode, hostNode) {
  if (!driveNode || !hostNode) return '';
  const pools = _disksDrivePools(driveNode);
  if (pools.length !== 1) return '';
  const poolName = String(pools[0] || '').trim();
  if (!poolName) return '';
  const poolNode = (Array.isArray(hostNode.children) ? hostNode.children : []).find(child => {
    return child
      && String(child.group || '').trim() === 'Logical systems'
      && String(child.kind || '').trim().toLowerCase() === 'pool'
      && String(child.label || '').trim() === poolName;
  });
  if (!poolNode) return '';
  const memberCount = (Array.isArray(poolNode.children) ? poolNode.children : []).filter(child => {
    return String(child?.kind || '').trim().toLowerCase() === 'pool-member';
  }).length;
  return memberCount === 1 ? poolName : '';
}

function _disksDriveStandalonePurposeLabel(driveNode, hostNode) {
  const logicalNodes = _disksLogicalNodesForDrive(hostNode, driveNode);
  if (!logicalNodes.length) return '';
  const ranked = logicalNodes.slice().sort((left, right) => {
    const totalDelta = (_disksByteValue(right?.total_bytes) || 0) - (_disksByteValue(left?.total_bytes) || 0);
    if (totalDelta !== 0) return totalDelta;
    const usedDelta = (_disksByteValue(right?.used_bytes) || 0) - (_disksByteValue(left?.used_bytes) || 0);
    if (usedDelta !== 0) return usedDelta;
    return String(left?.label || '').localeCompare(String(right?.label || ''));
  });
  return String(ranked[0]?.label || '').trim();
}

function _disksDrivePurposeLabel(node) {
  if (!node || String(node.kind || '').trim().toLowerCase() !== 'drive') return '';
  const hostNode = _disksHostNodeFor(node);
  if (!hostNode) return '';
  const poolName = _disksDriveSingleMemberPoolName(node, hostNode);
  if (poolName) return poolName;
  const logicalLabel = _disksDriveStandalonePurposeLabel(node, hostNode);
  if (!logicalLabel) return '';
  const driveLabel = String(node.label || '').trim().toLowerCase();
  return logicalLabel.trim().toLowerCase() === driveLabel ? '' : logicalLabel;
}

function _disksFactsHtml(facts, limit = 6, options = {}) {
  const items = _disksOrderFacts(facts, options).slice(0, limit);
  if (!items.length) return '';
  return `<div class="disks-facts">${items.map(fact => `
    <div class="disks-facts__item disks-facts__item--${_disksEsc(_disksFactSlug(fact.label))}${_DISKS_FULL_WIDTH_FACTS.has(_disksFactSlug(fact.label)) ? ' disks-facts__item--full' : ''}">
      <span class="disks-facts__label">${_disksEsc(fact.label)}</span>
      <span class="disks-facts__value">${_disksEsc(fact.value)}</span>
    </div>
  `).join('')}</div>`;
}

function _disksHeroHtml(node) {
  const pct = _disksUsagePct(node);
  const partial = _disksPartialUsage(node);
  const crumbs = _disksBreadcrumbs();
  const backTarget = crumbs.length > 1 ? crumbs[crumbs.length - 2].id : '';
  const drivePurpose = _disksDrivePurposeLabel(node);
  const filesystemPill = _disksFilesystemPillLabel(node);
  const facts = Array.isArray(node?.facts) ? node.facts.slice() : [];
  if (partial) {
    facts.push(
      { label: 'Installed total', value: _disksFormatBytes(partial.total) },
      { label: 'Known capacity', value: _disksFormatBytes(partial.knownTotal) },
      { label: 'Known free', value: _disksFormatBytes(partial.knownFree) },
    );
  }
  const installedTotal = _disksByteValue(node?.installed_total_bytes);
  const displayedTotal = _disksByteValue(node?.total_bytes);
  if (!partial && installedTotal != null && displayedTotal != null && Math.abs(installedTotal - displayedTotal) > 1) {
    facts.push({ label: 'Installed total', value: _disksFormatBytes(installedTotal) });
  }
  const sourceIssueHtml = _disksSourceIssues.length
    ? `<div class="disks-source-issues">${_disksSourceIssues.map(issue => `<span>${_disksEsc(issue)}</span>`).join('')}</div>`
    : '';
  return `
    <div class="disks-page__chrome">
      <div class="disks-breadcrumbs">
        ${crumbs.map((crumb, idx) => `
          <button type="button" class="disks-breadcrumbs__item${idx === crumbs.length - 1 ? ' is-current' : ''}" data-disks-node="${_disksEsc(crumb.id)}">
            ${_disksEsc(crumb.label)}
          </button>
        `).join('<span class="disks-breadcrumbs__sep">/</span>')}
      </div>
      ${backTarget ? `<button type="button" class="disks-back-btn" data-disks-node="${_disksEsc(backTarget)}">Back</button>` : ''}
    </div>
    <section class="disks-hero">
      <div class="disks-hero__head">
        <div class="disks-hero__icon-wrap">
          <img class="disks-hero__icon" src="${_disksNodeIcon(node)}" alt="" />
        </div>
        <div class="disks-hero__copy">
          <div class="disks-hero__eyebrow">${_disksEsc(node.kind || 'storage')}</div>
          <h2 class="disks-hero__title">
            ${_disksEsc(node.label || 'Disks')}
            ${drivePurpose ? `<span class="disks-hero__title-suffix">(${_disksEsc(drivePurpose)})</span>` : ''}
          </h2>
          ${node.subtitle ? `<p class="disks-hero__subtitle">${_disksEsc(node.subtitle)}</p>` : ''}
          ${node.note ? `<p class="disks-hero__note">${_disksEsc(node.note)}</p>` : ''}
        </div>
      </div>
      <div class="disks-hero__meter-wrap">
        <div class="disks-hero__meter-meta">
          <span class="disks-pill disks-pill--${_disksStatusTone(node.status)}">${_disksEsc(node.status || 'info')}</span>
          ${filesystemPill ? `<span class="disks-pill">${_disksEsc(filesystemPill)}</span>` : ''}
          ${pct == null ? '' : `<span class="disks-hero__pct">${pct.toFixed(1)}%</span>`}
        </div>
        <div class="disks-usage-line">
          <strong>${_disksEsc(_disksUsageText(node))}</strong>
          ${pct == null ? '' : `<span>${_disksEsc(_disksUsagePctLabel(node, pct))}</span>`}
        </div>
        ${pct == null ? '' : `
          <div class="disks-meter" aria-hidden="true">
            <span class="disks-meter__fill" style="width:${pct}%"></span>
          </div>
        `}
        ${_disksFactsHtml(facts, 12, { kind: node?.kind, context: 'hero' })}
        ${sourceIssueHtml}
      </div>
    </section>
  `;
}

function _disksDrivePools(node) {
  const pools = new Set();
  const visit = current => {
    if (!current || typeof current !== 'object') return;
    (Array.isArray(current.facts) ? current.facts : []).forEach(fact => {
      if (String(fact?.label ?? '').trim().toLowerCase() !== 'pools') return;
      String(fact?.value ?? '')
        .split(/[,\n]+/)
        .map(value => value.trim())
        .filter(Boolean)
        .forEach(value => pools.add(value));
    });
    const children = Array.isArray(current.children) ? current.children : [];
    children.forEach(child => {
      if (String(child?.kind ?? '').trim().toLowerCase() === 'pool-link' && String(child?.label ?? '').trim()) {
        pools.add(String(child.label).trim());
      }
      visit(child);
    });
  };
  visit(node);
  return Array.from(pools);
}

function _disksTransportTokens(value) {
  return String(value ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(token => token.trim())
    .filter(Boolean);
}

function _disksDriveTypeMeta(node) {
  const transport = _disksFactValue(node, 'Transport').toLowerCase();
  const transportTokens = new Set(_disksTransportTokens(transport));
  const rotational = _disksFactValue(node, 'Rotational').toLowerCase();
  const model = `${_disksFactValue(node, 'Model')} ${node?.subtitle || ''}`.toLowerCase();
  if (transportTokens.has('nvme')) {
    return { key: 'nvme', order: 0 };
  }
  if (transportTokens.has('usb') && /(datatraveler|flash|thumb|stick|reader)/i.test(model)) {
    return { key: 'removable', order: 3 };
  }
  if (rotational === 'no' || /\bssd\b/i.test(model)) {
    return { key: 'ssd', order: 1 };
  }
  if (rotational === 'yes') {
    return { key: 'mechanical', order: 2 };
  }
  return { key: 'other', order: 4 };
}

function _disksTransportSortValue(transport) {
  const tokens = new Set(_disksTransportTokens(transport));
  const order = {
    nvme: 0,
    sata: 1,
    sas: 2,
    scsi: 3,
    usb: 4,
    thunderbolt: 5,
  };
  for (const key of Object.keys(order)) {
    if (tokens.has(key)) return order[key];
  }
  return 99;
}

function _disksDriveEntry(node) {
  return {
    node,
    pools: _disksDrivePools(node),
    transport: _disksFactValue(node, 'Transport').toLowerCase(),
    type: _disksDriveTypeMeta(node),
  };
}

function _disksAnnotatedDriveEntries(items) {
  const entries = (Array.isArray(items) ? items : []).map(_disksDriveEntry);
  const poolCounts = new Map();
  entries.forEach(entry => {
    entry.pools.forEach(pool => {
      poolCounts.set(pool, (poolCounts.get(pool) || 0) + 1);
    });
  });
  entries.forEach(entry => {
    const pools = entry.pools.slice().sort((left, right) => {
      const countDelta = (poolCounts.get(right) || 0) - (poolCounts.get(left) || 0);
      if (countDelta !== 0) return countDelta;
      return left.localeCompare(right);
    });
    entry.primaryPool = pools[0] || '';
  });
  return entries;
}

function _disksSortDriveEntries(left, right) {
  if (left.type.order !== right.type.order) {
    return left.type.order - right.type.order;
  }
  const transportDelta = _disksTransportSortValue(left.transport) - _disksTransportSortValue(right.transport);
  if (transportDelta !== 0) return transportDelta;
  const transportCompare = left.transport.localeCompare(right.transport);
  if (transportCompare !== 0) return transportCompare;
  return String(left.node?.label ?? '').localeCompare(String(right.node?.label ?? ''));
}

function _disksPoolColor(poolName) {
  let hash = 0;
  const name = String(poolName ?? '');
  for (let idx = 0; idx < name.length; idx += 1) {
    hash = ((hash << 5) - hash + name.charCodeAt(idx)) | 0;
  }
  return _DISKS_CLUSTER_COLORS[Math.abs(hash) % _DISKS_CLUSTER_COLORS.length];
}

function _disksSingleDriveConfig(entry, options = {}) {
  return {
    entry,
    poolName: options.poolName || '',
    poolColor: options.poolColor || '',
    pooledSingle: !!options.pooledSingle,
  };
}

function _disksSingleDriveConfigId(config) {
  return String(config?.entry?.node?.id || '');
}

function _disksIsFeaturedSingleDrive(config) {
  if (!config || !config.entry || !config.entry.node) return false;
  if (config.pooledSingle) return true;
  const status = String(config.entry.node.status || '').trim().toLowerCase();
  if (status && status !== 'info' && status !== 'ok') return true;
  return Boolean(String(config.entry.node.note || '').trim());
}

function _disksBuildPhysicalDriveLayout(items) {
  const entries = _disksAnnotatedDriveEntries(items);

  const pooledByName = new Map();
  const unpooled = [];
  entries.forEach(entry => {
    if (!entry.primaryPool) {
      unpooled.push(entry);
      return;
    }
    if (!pooledByName.has(entry.primaryPool)) {
      pooledByName.set(entry.primaryPool, {
        pool: entry.primaryPool,
        color: _disksPoolColor(entry.primaryPool),
        items: [],
      });
    }
    pooledByName.get(entry.primaryPool).items.push(entry);
  });

  const pooled = Array.from(pooledByName.values()).sort((left, right) => {
    const countDelta = right.items.length - left.items.length;
    if (countDelta !== 0) return countDelta;
    const leftTop = left.items.slice().sort(_disksSortDriveEntries)[0];
    const rightTop = right.items.slice().sort(_disksSortDriveEntries)[0];
    const itemDelta = leftTop && rightTop ? _disksSortDriveEntries(leftTop, rightTop) : 0;
    if (itemDelta !== 0) return itemDelta;
    return left.pool.localeCompare(right.pool);
  });
  pooled.forEach(group => group.items.sort(_disksSortDriveEntries));
  unpooled.sort(_disksSortDriveEntries);

  const pooledSingles = pooled
    .filter(group => group.items.length === 1)
    .map(group => _disksSingleDriveConfig(group.items[0], {
      poolName: group.pool,
      poolColor: group.color,
      pooledSingle: true,
    }))
    .sort((left, right) => _disksSortDriveEntries(left.entry, right.entry));
  const unpooledSingles = unpooled
    .map(entry => _disksSingleDriveConfig(entry))
    .sort((left, right) => _disksSortDriveEntries(left.entry, right.entry));

  const featuredCandidates = [];
  const featuredIds = new Set();
  pooledSingles.forEach(config => {
    const id = _disksSingleDriveConfigId(config);
    if (!id || featuredIds.has(id)) return;
    featuredIds.add(id);
    featuredCandidates.push(config);
  });
  unpooledSingles.forEach(config => {
    const id = _disksSingleDriveConfigId(config);
    if (!id || featuredIds.has(id) || !_disksIsFeaturedSingleDrive(config)) return;
    featuredIds.add(id);
    featuredCandidates.push(config);
  });
  featuredCandidates.sort((left, right) => _disksSortDriveEntries(left.entry, right.entry));
  const useFeaturedShelf = featuredCandidates.length >= 2;
  const selectedFeaturedIds = useFeaturedShelf ? featuredIds : new Set();
  const remainingSingles = [
    ...pooledSingles.filter(config => !selectedFeaturedIds.has(_disksSingleDriveConfigId(config))),
    ...unpooledSingles.filter(config => !selectedFeaturedIds.has(_disksSingleDriveConfigId(config))),
  ];

  return {
    multiPools: pooled.filter(group => group.items.length > 1),
    featuredSingles: useFeaturedShelf ? featuredCandidates : [],
    remainingSingles,
  };
}

function _disksPhysicalLayoutHtml(layout) {
  return `
    ${layout.multiPools.length ? `
      <div class="disks-cluster-shelf" data-disks-layout-shelf="clusters">
        ${layout.multiPools.map(_disksPoolClusterHtml).join('')}
      </div>
    ` : ''}
    ${layout.featuredSingles.length ? `
      <div class="disks-featured-shelf" data-disks-layout-shelf="featured">
        ${layout.featuredSingles.map(_disksFeaturedSingleBlockHtml).join('')}
      </div>
    ` : ''}
    ${layout.remainingSingles.length ? `
      <div class="disks-card-grid">
        ${layout.remainingSingles.map(_disksSingleDriveHtml).join('')}
      </div>
    ` : ''}
  `;
}

function _disksSingleDriveHtml(config) {
  return _disksCardHtml(config.entry.node, {
    poolName: config.poolName,
    poolColor: config.poolColor,
    pooledSingle: config.pooledSingle,
  });
}

function _disksPoolClusterHtml(group, options = {}) {
  const count = group.items.length;
  const name = String(options.displayName || group.pool || '').trim();
  const detail = String(options.detail || '').trim();
  const meta = String(options.meta || `${count} member${count === 1 ? '' : 's'} · ZFS pool`).trim();
  return `
    <section class="disks-pool-cluster" data-disks-layout-role="cluster" data-disks-member-count="${count}" style="--disks-cluster-rgb:${_disksEsc(group.color)};">
      <div class="disks-pool-cluster__header">
        <span class="disks-pool-cluster__name-wrap">
          <span class="disks-pool-cluster__name">${_disksEsc(name)}</span>
          ${detail ? `<span class="disks-pool-cluster__detail">${_disksEsc(detail)}</span>` : ''}
        </span>
        <span class="disks-pool-cluster__meta">${_disksEsc(meta)}</span>
      </div>
      <div class="disks-card-grid disks-card-grid--cluster" data-disks-cluster-grid data-disks-pool="${_disksEsc(group.pool)}">
        ${group.items.map(entry => _disksCardHtml(entry.node, {
          poolName: group.pool,
          poolColor: group.color,
        })).join('')}
      </div>
    </section>
  `;
}

function _disksFeaturedSingleBlockHtml(config) {
  return `
    <div class="disks-featured-block" data-disks-layout-role="featured" data-disks-member-count="1">
      ${_disksSingleDriveHtml(config)}
    </div>
  `;
}

function _disksInventoryNamedGroupHtml(name, entries, options = {}) {
  const meta = String(options.meta || `${entries.length} item${entries.length === 1 ? '' : 's'}`).trim();
  const columnCount = Math.max(1, Math.min(2, Number.parseInt(options.columns || '2', 10) || 2));
  return `
    <section class="disks-inventory-bundle">
      <div class="disks-pool-cluster__header">
        <span class="disks-inventory-bundle__name">${_disksEsc(name)}</span>
        <span class="disks-pool-cluster__meta">${_disksEsc(meta)}</span>
      </div>
      <div class="disks-card-grid disks-card-grid--inventory-bundle" style="--disks-inventory-columns:${columnCount};">
        ${entries.map(entry => _disksCardHtml(entry.node, { contextKind: 'host' })).join('')}
      </div>
    </section>
  `;
}

function _disksTakeInventoryEntries(entries, labels, usedIds) {
  const matches = [];
  labels.forEach(label => {
    const match = entries.find(entry => {
      const entryId = String(entry?.node?.id ?? '');
      return entryId && !usedIds.has(entryId) && String(entry?.node?.label ?? '').trim() === label;
    });
    if (!match) return;
    usedIds.add(String(match.node.id || ''));
    matches.push(match);
  });
  return matches;
}

function _disksConfiguredPhysicalDriveLayoutHtml(group, currentNode) {
  const layout = currentNode?.layout_hints?.physical_drive_layout;
  if (!layout || typeof layout !== 'object') return '';
  const entries = _disksAnnotatedDriveEntries(group.items);
  if (!entries.length) return '';

  const usedIds = new Set();
  const clusterSections = [];
  const sections = [];
  const takePool = poolName => {
    return entries.filter(entry => {
      const entryId = String(entry?.node?.id ?? '');
      if (!entryId || usedIds.has(entryId)) return false;
      if (String(entry.primaryPool || '') !== poolName) return false;
      usedIds.add(entryId);
      return true;
    });
  };

  (Array.isArray(layout.pool_clusters) ? layout.pool_clusters : []).forEach(cluster => {
    const poolName = String(cluster?.pool || '').trim();
    if (!poolName) return;
    const matched = takePool(poolName);
    if (!matched.length) return;
    clusterSections.push(_disksPoolClusterHtml({
      pool: poolName,
      color: _disksPoolColor(poolName),
      items: matched,
    }, {
      displayName: String(cluster?.display_name || poolName).trim() || poolName,
      detail: String(cluster?.detail || '').trim(),
      meta: String(cluster?.meta || '').trim(),
    }));
  });

  (Array.isArray(layout.bundles) ? layout.bundles : []).forEach(bundle => {
    const name = String(bundle?.name || '').trim();
    const labels = Array.isArray(bundle?.labels)
      ? bundle.labels.map(label => String(label || '').trim()).filter(Boolean)
      : [];
    if (!name || !labels.length) return;
    const matched = _disksTakeInventoryEntries(entries, labels, usedIds);
    if (!matched.length) return;
    sections.push(_disksInventoryNamedGroupHtml(name, matched, {
      columns: bundle?.columns,
      meta: bundle?.meta,
    }));
  });

  const remainingNodes = entries
    .filter(entry => !usedIds.has(String(entry?.node?.id ?? '')))
    .map(entry => entry.node);
  if (remainingNodes.length) {
    sections.push(_disksPhysicalLayoutHtml(_disksBuildPhysicalDriveLayout(remainingNodes)));
  }

  return `
    ${clusterSections.length ? `
      <div class="disks-cluster-shelf" data-disks-layout-shelf="clusters">
        ${clusterSections.join('')}
      </div>
    ` : ''}
    ${sections.join('')}
  `;
}

function _disksPhysicalDriveGroupHtml(group, currentNode) {
  const inventorySpecificHtml = _disksConfiguredPhysicalDriveLayoutHtml(group, currentNode);
  if (inventorySpecificHtml) {
    return `
      <section class="disks-group disks-group--physical">
        <div class="disks-group__header">
          <h3>${_disksEsc(group.name)}</h3>
          <span>${group.items.length} item${group.items.length === 1 ? '' : 's'}</span>
        </div>
        <div class="disks-physical-layout">
          ${inventorySpecificHtml}
        </div>
      </section>
    `;
  }
  const layout = _disksBuildPhysicalDriveLayout(group.items);
  return `
    <section class="disks-group disks-group--physical">
      <div class="disks-group__header">
        <h3>${_disksEsc(group.name)}</h3>
        <span>${group.items.length} item${group.items.length === 1 ? '' : 's'}</span>
      </div>
      <div class="disks-physical-layout">
        ${_disksPhysicalLayoutHtml(layout)}
      </div>
    </section>
  `;
}

function _disksCardHtml(node, options = {}) {
  const primaryTarget = _disksPrimaryOpenTarget(node) || node;
  const shortcut = _disksShortcutMeta(node);
  const guestMeta = _disksGuestMeta(node);
  const filesystemTarget = shortcut ? shortcut.target : _disksFilesystemTarget(node);
  const filesystemPill = shortcut ? '' : _disksFilesystemPillLabel(node);
  const floatingFilesystemPill = !shortcut && !filesystemTarget && String(node?.kind || '').trim().toLowerCase() === 'drive'
    ? filesystemPill
    : '';
  const inlineFilesystemPill = floatingFilesystemPill || filesystemTarget ? '' : filesystemPill;
  const floatingFilesystemButton = !shortcut && filesystemTarget
    && String(node?.kind || '').trim().toLowerCase() === 'drive'
    ? `
        <button type="button" class="disks-card__jump disks-card__jump--fs" title="${_disksEsc(`Open ${filesystemPill} details for ${String(filesystemTarget.label || 'filesystem').trim() || 'filesystem'}`)}" aria-label="${_disksEsc(`Open ${filesystemPill} details for ${String(filesystemTarget.label || 'filesystem').trim() || 'filesystem'}`)}" data-disks-node="${_disksEsc(filesystemTarget.id)}">${_disksEsc(filesystemPill)}</button>
      `
    : '';
  const inlineFilesystemButton = !shortcut && filesystemTarget
    && String(node?.kind || '').trim().toLowerCase() !== 'drive'
    ? `
        <div class="disks-card__meta-pills">
          <span class="disks-card__jump disks-card__jump--fs" title="${_disksEsc(`Open ${filesystemPill} details for ${String(filesystemTarget.label || 'filesystem').trim() || 'filesystem'}`)}" aria-label="${_disksEsc(`Open ${filesystemPill} details for ${String(filesystemTarget.label || 'filesystem').trim() || 'filesystem'}`)}" data-disks-node="${_disksEsc(filesystemTarget.id)}">${_disksEsc(filesystemPill)}</span>
        </div>
      `
    : '';
  const pct = _disksUsagePct(node);
  const hasChildren = Array.isArray(primaryTarget.children) && primaryTarget.children.length > 0;
  const cta = hasChildren ? 'Open' : 'View';
  const tone = _disksStatusTone(node.status);
  const canForget = !!node?.cached_missing && !!node?.cache_host;
  const showSubtitle = !!node.subtitle && node.kind !== 'drive';
  const drivePurpose = _disksDrivePurposeLabel(node);
  const kindSlug = _disksFactSlug(node.kind || 'item');
  const contextSlug = _disksFactSlug(options.contextKind || _disksCurrentNode()?.kind || 'context');
  const classes = [
    'disks-card',
    `disks-card--${_disksEsc(_disksStatusTone(node.status))}`,
    `disks-card--kind-${_disksEsc(kindSlug)}`,
    `disks-card--context-${_disksEsc(contextSlug)}`,
  ];
  if (node.smart) classes.push('disks-card--has-smart');
  if (shortcut) classes.push('disks-card--has-shortcut');
  if (options.poolName) classes.push('disks-card--pooled');
  const nodeId = String(node?.id || '').trim();
  const userNote = _disksUserNote(node);
  const noteOpen = !!nodeId && _disksNoteOpen.has(nodeId);
  const noteDraft = noteOpen ? _disksNoteDraftForNode(node) : '';
  const noteSaving = !!nodeId && _disksNoteSaving.has(nodeId);
  const noteError = !!nodeId ? String(_disksNoteErrors.get(nodeId) || '').trim() : '';
  const attrs = [];
  if (options.poolName) {
    attrs.push(`data-disks-pool="${_disksEsc(options.poolName)}"`);
  }
  if (options.pooledSingle) {
    attrs.push('data-disks-pool-single="true"');
  }
  const styleAttr = options.poolColor ? ` style="--disks-cluster-rgb:${_disksEsc(options.poolColor)};"` : '';
  const poolCaption = options.pooledSingle && options.poolName
    && String(options.poolName || '').trim().toLowerCase() !== String(drivePurpose || '').trim().toLowerCase()
    ? `<div class="disks-card__pool-caption">ZFS · ${_disksEsc(options.poolName)}</div>`
    : '';
  return `
    <article class="${classes.join(' ')}" ${attrs.join(' ')}${styleAttr}>
      <div class="disks-card__actions">
        <span class="disks-pill disks-pill--${_disksEsc(tone)}">${_disksEsc(node.status || 'info')}</span>
        ${canForget ? `<button type="button" class="disks-card__forget" title="Remove cached inventory memory" aria-label="Remove cached inventory memory" data-disks-forget-host="${_disksEsc(node.cache_host)}" data-disks-forget-node="${_disksEsc(node.id)}">×</button>` : ''}
        ${shortcut ? `<button type="button" class="disks-card__jump disks-card__jump--${_disksEsc(shortcut.tone)}" title="${_disksEsc(shortcut.title)}" aria-label="${_disksEsc(shortcut.title)}" data-disks-node="${_disksEsc(shortcut.target.id)}">${_disksEsc(shortcut.label)}</button>` : ''}
        ${guestMeta ? _disksGuestSummaryButtonHtml(guestMeta) : ''}
        ${floatingFilesystemButton}
        ${floatingFilesystemPill ? `<span class="disks-card__jump disks-card__jump--static" aria-label="${_disksEsc(`${floatingFilesystemPill} filesystem`)}">${_disksEsc(floatingFilesystemPill)}</span>` : ''}
        ${node.smart ? `<button type="button" class="disks-card__smart" data-disks-smart-host="${_disksEsc(node.smart.host)}" data-disks-smart-device="${_disksEsc(node.smart.device_path)}" data-disks-smart-label="${_disksEsc(_disksSmartLabel(node))}">S.M.A.R.T.</button>` : ''}
      </div>
      <div class="disks-card__main" data-disks-node="${_disksEsc(primaryTarget.id)}" role="button" tabindex="0">
        <div class="disks-card__header">
          <img class="disks-card__icon" src="${_disksNodeIcon(node)}" alt="" />
          <div class="disks-card__text">
            <div class="disks-card__title-row">
              <strong class="disks-card__title">${_disksEsc(node.label)}</strong>
              ${drivePurpose ? `<span class="disks-card__title-suffix">(${_disksEsc(drivePurpose)})</span>` : ''}
            </div>
            ${showSubtitle ? `<div class="disks-card__subtitle">${_disksEsc(node.subtitle)}</div>` : ''}
            ${poolCaption}
            ${inlineFilesystemButton}
            ${inlineFilesystemPill ? `<div class="disks-card__meta-pills"><span class="disks-pill">${_disksEsc(inlineFilesystemPill)}</span></div>` : ''}
          </div>
        </div>
        <div class="disks-card__usage">
          <div class="disks-card__usage-line">
            <span>${_disksEsc(_disksUsageText(node))}</span>
            ${pct == null ? '' : `<strong>${pct.toFixed(1)}%</strong>`}
          </div>
          ${pct == null ? '' : `
            <div class="disks-meter disks-meter--compact" aria-hidden="true">
              <span class="disks-meter__fill" style="width:${pct}%"></span>
            </div>
          `}
        </div>
        ${userNote ? `
          <div class="disks-card__user-note">
            <span class="disks-card__user-note-label">Notes</span>
            <p class="disks-card__user-note-copy">${_disksEsc(userNote)}</p>
          </div>
        ` : ''}
        ${noteOpen ? `
          <div class="disks-card__note-editor">
            <label class="disks-card__note-editor-label" for="disks-note-${_disksEsc(nodeId)}">Notes</label>
            <textarea
              class="disks-card__note-editor-input"
              id="disks-note-${_disksEsc(nodeId)}"
              rows="3"
              placeholder="Private note for this card"
              data-disks-note-input="${_disksEsc(nodeId)}"
            >${_disksEsc(noteDraft)}</textarea>
            <p class="disks-card__note-editor-status${noteError ? ' is-error' : ''}">
              ${_disksEsc(noteError || (noteSaving ? 'Saving…' : 'Autosaves on pause'))}
            </p>
          </div>
        ` : ''}
        ${node.note ? `<p class="disks-card__note">${_disksEsc(node.note)}</p>` : ''}
        ${_disksFactsHtml(node.facts, 6, { kind: node?.kind, context: 'card' })}
        <div class="disks-card__footer">
          <span class="disks-card__footer-copy">
            <span>${cta}</span>
            ${hasChildren ? `<span>${primaryTarget.children.length} item${primaryTarget.children.length === 1 ? '' : 's'}</span>` : '<span>Details</span>'}
          </span>
          <span
            class="disks-card__footer-action"
            data-disks-note-toggle="${_disksEsc(nodeId)}"
            data-disks-note-open="${noteOpen ? 'true' : 'false'}"
            title="${_disksEsc(noteOpen ? 'Hide notes editor' : 'Add or edit a note')}"
          >
            <span class="disks-card__footer-icon" aria-hidden="true"></span>
            <span>Notes</span>
          </span>
        </div>
      </div>
    </article>
  `;
}

function _disksGuestBuckets(items) {
  const buckets = new Map();
  const remainder = [];
  (Array.isArray(items) ? items : []).forEach(item => {
    if (!_disksIsGuestDiskNode(item)) {
      remainder.push(item);
      return;
    }
    const meta = _disksGuestMeta(item);
    const key = _disksGuestSummaryKey(meta);
    if (!key) {
      remainder.push(item);
      return;
    }
    if (!buckets.has(key)) {
      buckets.set(key, { meta, items: [] });
    }
    buckets.get(key).items.push(item);
  });
  return {
    buckets: Array.from(buckets.values()).sort((left, right) => {
      const leftLabel = String(left?.meta?.guest_summary_label || left?.meta?.guest_display || '').trim();
      const rightLabel = String(right?.meta?.guest_summary_label || right?.meta?.guest_display || '').trim();
      return leftLabel.localeCompare(rightLabel);
    }),
    remainder,
  };
}

function _disksGuestBucketHtml(bucket, currentNode) {
  const meta = bucket?.meta || {};
  const items = (Array.isArray(bucket?.items) ? bucket.items.slice() : []).sort((left, right) => {
    return String(left?.label || '').localeCompare(String(right?.label || ''));
  });
  const count = items.length;
  const subtitle = String(meta.guest_display || '').trim();
  return `
    <section class="disks-guest-bucket">
      <div class="disks-guest-bucket__header">
        <span class="disks-guest-bucket__copy">
          <span class="disks-guest-bucket__name">${_disksEsc(meta.guest_summary_label || subtitle || 'Guest')}</span>
          <span class="disks-guest-bucket__meta">${_disksEsc(`${subtitle || 'Guest'} · ${count} disk${count === 1 ? '' : 's'}`)}</span>
        </span>
        ${_disksGuestSummaryButtonHtml(meta, {
          className: 'hub-modal-btn secondary disks-guest-bucket__summary',
          label: 'Summary',
          title: `Open guest disk summary for ${subtitle || meta.guest_summary_label || 'this guest'}`,
        })}
      </div>
      <div class="disks-card-grid">
        ${items.map(item => _disksCardHtml(item, { contextKind: currentNode?.kind || '' })).join('')}
      </div>
    </section>
  `;
}

function _disksGuestGroupedSectionHtml(group, currentNode) {
  const grouped = _disksGuestBuckets(group.items);
  if (!grouped.buckets.length) return '';
  return `
    <section class="disks-group disks-group--guested">
      <div class="disks-group__header">
        <h3>${_disksEsc(group.name)}</h3>
        <span>${group.items.length} item${group.items.length === 1 ? '' : 's'}</span>
      </div>
      <div class="disks-guest-buckets">
        ${grouped.buckets.map(bucket => _disksGuestBucketHtml(bucket, currentNode)).join('')}
      </div>
      ${grouped.remainder.length ? `
        <div class="disks-card-grid">
          ${grouped.remainder.map(item => _disksCardHtml(item, { contextKind: currentNode?.kind || '' })).join('')}
        </div>
      ` : ''}
    </section>
  `;
}

function _disksGroupsHtml(node) {
  const groups = _disksGroupChildren(node);
  if (!groups.length) {
    if (_disksFilesystemBrowserMeta(node) || _disksOfflineBrowserMeta(node)) return '';
    return `
      <section class="disks-empty-state">
        <h3>This branch stops here</h3>
        <p>The current item has detail, but no deeper drill-down is exposed yet.</p>
      </section>
    `;
  }
  const currentKind = String(node?.kind || '').trim().toLowerCase();
  return groups.map(group => {
    const isPhysicalDriveGroup = String(group.name).trim().toLowerCase() === 'physical drives'
      && group.items.every(item => item?.kind === 'drive');
    if (isPhysicalDriveGroup) {
      return _disksPhysicalDriveGroupHtml(group, node);
    }
    const shouldGuestGroup = ['dataset', 'pool'].includes(currentKind)
      && group.items.some(item => _disksIsGuestDiskNode(item));
    if (shouldGuestGroup) {
      return _disksGuestGroupedSectionHtml(group, node);
    }
    return `
      <section class="disks-group">
        <div class="disks-group__header">
          <h3>${_disksEsc(group.name)}</h3>
          <span>${group.items.length} item${group.items.length === 1 ? '' : 's'}</span>
        </div>
        <div class="disks-card-grid">
          ${group.items.map(item => _disksCardHtml(item, { contextKind: node?.kind || '' })).join('')}
        </div>
      </section>
    `;
  }).join('');
}

function _disksLoadingHtml() {
  return `
    <div class="disks-empty-state disks-empty-state--loading">
      <span class="spinner" aria-hidden="true"></span>
      <p>Loading disk inventory…</p>
    </div>
  `;
}

function renderDisksPage() {
  const shell = _disksEl('disks-shell');
  if (!shell) return;
  if (!_disksTopology || !_disksTopology.root) {
    shell.innerHTML = _disksLoadingHtml();
    return;
  }
  if (!_disksNodeById.has(_disksCurrentNodeId)) {
    _disksCurrentNodeId = _disksTopology.root.id;
  }
  const node = _disksCurrentNode();
  if (!node) {
    shell.innerHTML = _disksLoadingHtml();
    return;
  }
  shell.innerHTML = `
    <div class="disks-page">
      ${_disksHeroHtml(node)}
      ${_disksFilesystemTreeSectionHtml(node)}
      ${_disksOfflineBrowserSectionHtml(node)}
      <div class="disks-groups">
        ${_disksGroupsHtml(node)}
      </div>
    </div>
  `;
  shell.querySelectorAll('.disks-card__smart').forEach(button => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const smartBtn = event.currentTarget;
      _disksOpenSmart(
        smartBtn.dataset.disksSmartHost || '',
        smartBtn.dataset.disksSmartDevice || '',
        smartBtn.dataset.disksSmartLabel || ''
      );
    });
  });
  _disksEnsureFilesystemTree(node);
  _disksScheduleLayoutPass();
}

function _disksClusterGapPx(grid) {
  const styles = window.getComputedStyle(grid);
  const value = Number.parseFloat(styles.columnGap || styles.gap || '0');
  return Number.isFinite(value) ? value : 0;
}

function _disksShelfTrackCount(shelf) {
  const width = shelf.clientWidth || shelf.getBoundingClientRect().width;
  const gap = _disksClusterGapPx(shelf);
  const visualColumns = Math.max(
    1,
    Math.min(3, Math.floor((width + gap) / (_DISKS_CLUSTER_MIN_CARD_WIDTH + gap))),
  );
  return visualColumns * 2;
}

function _disksClusterSpanForTracks(cardCount, tracks) {
  if (tracks <= 2) return 2;
  if (tracks <= 4) {
    return cardCount <= 2 ? 2 : 4;
  }
  if (cardCount <= 2) return 2;
  if (cardCount <= 4) return 4;
  return 6;
}

function _disksClusterColumnsForTracks(cardCount, span, tracks) {
  if (tracks <= 2) return 1;
  if (span <= 2) return 1;
  if (span <= 4) return Math.min(2, cardCount);
  return Math.min(3, cardCount);
}

function _disksFeaturedSpanForTracks(blockCount, tracks) {
  if (tracks <= 2) return 2;
  if (blockCount === 2) return tracks / 2;
  return 2;
}

function _disksSetClusterEdges(card, sides) {
  const main = card.querySelector('.disks-card__main');
  if (!main) return;
  ['top', 'right', 'bottom', 'left'].forEach(side => {
    main.style.setProperty(`--disks-cluster-${side}`, sides.includes(side) ? '2px' : '0px');
  });
}

function _disksResetCardHeights(scope) {
  if (!scope) return;
  scope.querySelectorAll('.disks-card__main').forEach(main => {
    main.style.removeProperty('min-height');
  });
}

function _disksCollectCardRows(cards) {
  const entries = Array.from(cards || [])
    .map(card => {
      const main = card.querySelector('.disks-card__main');
      if (!main) return null;
      return { card, main };
    })
    .filter(Boolean);
  if (!entries.length) return [];
  const rows = [];
  entries.forEach(entry => {
    const rect = entry.card.getBoundingClientRect();
    let row = rows.find(candidate => Math.abs(candidate.top - rect.top) < 8);
    if (!row) {
      row = { top: rect.top, entries: [] };
      rows.push(row);
    }
    row.entries.push(entry);
  });
  rows.sort((left, right) => left.top - right.top);
  return rows;
}

function _disksEqualizeCards(cards) {
  const entries = Array.from(cards || [])
    .map(card => {
      const main = card.querySelector('.disks-card__main');
      if (!main) return null;
      return { card, main };
    })
    .filter(Boolean);
  if (!entries.length) return;
  const maxHeight = entries.reduce((height, entry) => {
    return Math.max(height, entry.main.getBoundingClientRect().height);
  }, 0);
  entries.forEach(entry => {
    entry.main.style.minHeight = `${Math.ceil(maxHeight)}px`;
  });
}

function _disksEqualizeCardRowHeights(cards) {
  _disksCollectCardRows(cards).forEach(row => {
    _disksEqualizeCards(row.entries.map(entry => entry.card));
  });
}

function _disksEqualizeDirectGridHeights(grid) {
  if (!grid) return;
  _disksEqualizeCardRowHeights(grid.querySelectorAll(':scope > .disks-card'));
}

function _disksBlockRows(block) {
  if (!block) return [];
  const clusterGrid = block.querySelector(':scope [data-disks-cluster-grid]');
  if (clusterGrid) {
    return _disksCollectCardRows(clusterGrid.querySelectorAll(':scope > .disks-card'))
      .map(row => row.entries.map(entry => entry.card));
  }
  const directCards = Array.from(block.querySelectorAll(':scope > .disks-card'));
  if (directCards.length) return [directCards];
  const nestedCards = Array.from(block.querySelectorAll('.disks-card'));
  return nestedCards.length ? [nestedCards] : [];
}

function _disksEqualizeShelfHeights(shelf) {
  if (!shelf) return;
  const blocks = Array.from(shelf.querySelectorAll(':scope > [data-disks-layout-role]'));
  if (!blocks.length) {
    _disksEqualizeCardRowHeights(shelf.querySelectorAll('.disks-card'));
    return;
  }
  const rowsByIndex = [];
  blocks.forEach(block => {
    _disksBlockRows(block).forEach((rowCards, rowIndex) => {
      if (!rowsByIndex[rowIndex]) rowsByIndex[rowIndex] = [];
      rowsByIndex[rowIndex].push(...rowCards);
    });
  });
  rowsByIndex.forEach(rowCards => _disksEqualizeCards(rowCards));
}

function _disksApplyClusterEdges(grid) {
  const cards = Array.from(grid.querySelectorAll(':scope > .disks-card'));
  if (!cards.length) return;
  const rows = [];
  cards.forEach(card => {
    const rect = card.getBoundingClientRect();
    let row = rows.find(entry => Math.abs(entry.top - rect.top) < 6);
    if (!row) {
      row = { top: rect.top, cards: [] };
      rows.push(row);
    }
    row.cards.push({ card, left: rect.left });
  });
  rows.sort((left, right) => left.top - right.top);
  rows.forEach(row => row.cards.sort((left, right) => left.left - right.left));
  rows.forEach((row, rowIndex) => {
    const isTop = rowIndex === 0;
    const isBottom = rowIndex === rows.length - 1;
    row.cards.forEach((entry, colIndex) => {
      const sides = [];
      if (isTop) sides.push('top');
      if (isBottom) sides.push('bottom');
      if (colIndex === 0) sides.push('left');
      if (colIndex === row.cards.length - 1) sides.push('right');
      _disksSetClusterEdges(entry.card, sides);
    });
  });
}

function _disksApplyPhysicalDriveLayout() {
  const shell = _disksEl('disks-shell');
  if (!shell) return;
  _disksResetCardHeights(shell);
  let layoutChanged = false;
  shell.querySelectorAll('[data-disks-layout-shelf]').forEach(shelf => {
    const tracks = _disksShelfTrackCount(shelf);
    if (shelf.style.getPropertyValue('--disks-layout-tracks') !== String(tracks)) {
      shelf.style.setProperty('--disks-layout-tracks', String(tracks));
      layoutChanged = true;
    }
    const mode = String(shelf.dataset.disksLayoutShelf || '').trim().toLowerCase();
    const blocks = Array.from(shelf.querySelectorAll(':scope > [data-disks-layout-role]'));
    if (mode === 'clusters') {
      blocks.forEach(block => {
        const count = Math.max(1, Number.parseInt(block.dataset.disksMemberCount || '1', 10) || 1);
        const span = _disksClusterSpanForTracks(count, tracks);
        if (block.style.getPropertyValue('--disks-layout-span') !== String(span)) {
          block.style.setProperty('--disks-layout-span', String(span));
          layoutChanged = true;
        }
        const grid = block.querySelector('[data-disks-cluster-grid]');
        if (!grid) return;
        const columns = _disksClusterColumnsForTracks(count, span, tracks);
        if (grid.style.getPropertyValue('--disks-cluster-columns') !== String(columns)) {
          grid.style.setProperty('--disks-cluster-columns', String(columns));
          layoutChanged = true;
        }
      });
      return;
    }
    if (mode === 'featured') {
      const span = _disksFeaturedSpanForTracks(blocks.length, tracks);
      blocks.forEach(block => {
        if (block.style.getPropertyValue('--disks-layout-span') !== String(span)) {
          block.style.setProperty('--disks-layout-span', String(span));
          layoutChanged = true;
        }
      });
    }
  });
  if (layoutChanged) {
    window.requestAnimationFrame(_disksApplyPhysicalDriveLayout);
    return;
  }
  shell.querySelectorAll('[data-disks-cluster-grid]').forEach(_disksApplyClusterEdges);
  shell.querySelectorAll('[data-disks-pool-single]').forEach(card => {
    _disksSetClusterEdges(card, ['top', 'right', 'bottom', 'left']);
  });
  shell.querySelectorAll('.disks-card').forEach(card => {
    const header = card.querySelector('.disks-card__header');
    const actions = card.querySelector('.disks-card__actions');
    if (!header || !actions) return;
    const reserve = Math.max(64, Math.ceil(actions.getBoundingClientRect().width + 12));
    header.style.setProperty('--disks-card-actions-reserve', `${reserve}px`);
  });
  shell.querySelectorAll('[data-disks-layout-shelf]').forEach(_disksEqualizeShelfHeights);
  shell.querySelectorAll('.disks-card-grid').forEach(grid => {
    if (grid.closest('[data-disks-layout-shelf]')) return;
    _disksEqualizeDirectGridHeights(grid);
  });
}

function _disksScheduleLayoutPass() {
  window.cancelAnimationFrame(_disksLayoutFrame);
  _disksLayoutFrame = window.requestAnimationFrame(() => {
    _disksLayoutFrame = 0;
    _disksApplyPhysicalDriveLayout();
  });
}

function _disksIndexTopology(root) {
  _disksNodeById = new Map();
  _disksParentById = new Map();
  _disksIndexTree(root, '');
  if (!_disksCurrentNodeId || !_disksNodeById.has(_disksCurrentNodeId)) {
    _disksCurrentNodeId = root.id;
  }
}

function _disksCollectSourceIssues(payload) {
  const issues = [];
  const sources = payload && typeof payload.sources === 'object' ? payload.sources : {};
  ['storage_overlay', 'thunderbolt_overlay'].forEach(key => {
    const source = sources[key];
    if (!source || source.ok !== false || !source.error) return;
    issues.push(`${key.replace(/_/g, ' ')} unavailable`);
  });
  return issues;
}

async function loadDisks(force = false) {
  _disksInit();
  if (_disksLoadPromise) return _disksLoadPromise;
  if (!_disksTopology || force) {
    _disksStatusMessage('Refreshing disk inventory…', 'info', true);
    if (!_disksTopology) renderDisksPage();
  }
  _disksLoadPromise = (async () => {
    try {
      const response = await apiFetch('/api/v1/disks/topology', {
        cache: 'no-store',
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(detail || `HTTP ${response.status}`);
      }
      const payload = await response.json();
      if (!payload || !payload.root || !payload.root.id) {
        throw new Error('Disk topology payload was missing its root node.');
      }
      _disksTopology = payload;
      _disksSourceIssues = _disksCollectSourceIssues(payload);
      _disksFilesystemTreeReset();
      _disksIndexTopology(payload.root);
      _disksLoaded = true;
      renderDisksPage();
      _disksStatusMessage('Disk inventory refreshed.', _disksSourceIssues.length ? 'warn' : 'ok');
      return payload;
    } catch (err) {
      const message = err && err.message ? err.message : String(err || 'Disk inventory failed');
      if (!_disksTopology) {
        const shell = _disksEl('disks-shell');
        if (shell) {
          shell.innerHTML = `
            <section class="disks-empty-state">
              <h3>Disk inventory unavailable</h3>
              <p>${_disksEsc(message)}</p>
            </section>
          `;
        }
      }
      _disksStatusMessage(`Disk inventory failed: ${message}`, 'fail', true);
      throw err;
    } finally {
      _disksLoadPromise = null;
    }
  })();
  return _disksLoadPromise;
}

async function _disksForgetCachedNode(host, nodeId) {
  const cleanHost = String(host || '').trim();
  const cleanNodeId = String(nodeId || '').trim();
  if (!cleanHost || !cleanNodeId) return;
  _disksStatusMessage('Removing cached inventory item…', 'info', true);
  const response = await apiFetch(`/api/v1/disks/memory/forget?host=${encodeURIComponent(cleanHost)}&node_id=${encodeURIComponent(cleanNodeId)}`, {
    method: 'POST',
    cache: 'no-store',
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || `HTTP ${response.status}`);
  }
  await loadDisks(true);
  _disksStatusMessage('Cached inventory item removed.', 'ok');
}

function _disksSmartSummaryFacts(host, devicePath, label, body) {
  const facts = [];
  const add = (label, value) => {
    const text = String(value ?? '').trim();
    if (!text || text === 'undefined') return;
    facts.push({ label, value: text });
  };

  add('Host', host);
  add('Device', devicePath || body?.device?.name || label);
  add('Model', body?.model_name || body?.device?.model_name || body?.device?.name);
  add('Serial', body?.serial_number || body?.device?.serial_number);
  if (body?.smart_status && Object.prototype.hasOwnProperty.call(body.smart_status, 'passed')) {
    add('Health', body.smart_status.passed ? 'PASSED' : 'FAILED');
  }
  add('Temperature', body?.temperature?.current ? `${body.temperature.current}°C` : '');
  add('Power-on', body?.power_on_time?.hours != null ? `${body.power_on_time.hours} h` : '');
  add('NVMe used', body?.nvme_smart_health_information_log?.percentage_used != null
    ? `${body.nvme_smart_health_information_log.percentage_used}%`
    : '');
  add('Media errors', body?.nvme_smart_health_information_log?.media_errors);
  add('Critical warning', body?.nvme_smart_health_information_log?.critical_warning);
  add('smartctl exit', body?._smartctl_exit_status);
  add('smartctl detail', body?._smartctl_error);
  return facts;
}

async function _disksOpenSmart(host, devicePath, label = '') {
  const dialog = _disksEl('disks-smart-modal');
  const title = _disksEl('disks-smart-title');
  const subtitle = _disksEl('disks-smart-subtitle');
  const summary = _disksEl('disks-smart-summary');
  const jsonEl = _disksEl('disks-smart-json');
  const rawWrap = _disksEl('disks-smart-raw');
  const errEl = _disksEl('disks-smart-error');
  if (!dialog || !title || !subtitle || !summary || !jsonEl || !rawWrap || !errEl) return;

  title.textContent = label || devicePath || 'Drive health';
  subtitle.textContent = host ? `${host} · ${devicePath}` : devicePath;
  summary.innerHTML = '<div class="disks-smart-summary__item"><span>status</span><strong>Loading S.M.A.R.T...</strong></div>';
  jsonEl.textContent = '';
  rawWrap.open = false;
  rawWrap.hidden = true;
  errEl.hidden = true;

  try {
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', 'open');
    }
  } catch (_) {
    dialog.setAttribute('open', 'open');
  }

  try {
    const response = await apiFetch(`/api/v1/disks/smart?host=${encodeURIComponent(host)}&device_path=${encodeURIComponent(devicePath)}`, {
      cache: 'no-store',
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(detail || `HTTP ${response.status}`);
    }
    const payload = await response.json();
    const body = payload && typeof payload.body === 'object' ? payload.body : {};
    const facts = _disksSmartSummaryFacts(host, devicePath, label, body);
    summary.innerHTML = facts.length
      ? facts.map(fact => `<div class="disks-smart-summary__item"><span>${_disksEsc(fact.label)}</span><strong>${_disksEsc(fact.value)}</strong></div>`).join('')
      : '<div class="disks-smart-summary__item"><span>Status</span><strong>No compact summary available</strong></div>';
    jsonEl.textContent = JSON.stringify(body, null, 2);
    rawWrap.hidden = false;
  } catch (err) {
    const message = err && err.message ? err.message : String(err || 'S.M.A.R.T. failed');
    summary.innerHTML = '';
    jsonEl.textContent = '';
    rawWrap.hidden = true;
    errEl.hidden = false;
    errEl.textContent = message;
  }
}

function _disksCloseSmart() {
  const dialog = _disksEl('disks-smart-modal');
  if (!dialog) return;
  try {
    dialog.close();
  } catch (_) {
    dialog.removeAttribute('open');
  }
}

function _disksGuestSummaryPriority(node) {
  const kind = String(node?.kind || '').trim().toLowerCase();
  if (kind === 'dataset') return 4;
  if (kind === 'volume') return 3;
  if (kind === 'partition') return 2;
  if (kind === 'drive') return 1;
  return 0;
}

function _disksGuestSummarySignature(node) {
  const bits = [
    _disksFactValue(node, 'UUID'),
    _disksFactValue(node, 'Mount'),
    _disksFactValue(node, 'Path'),
    _disksFactValue(node, 'Guest path'),
    String(node?.label || '').trim(),
  ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
  return bits.join('|') || String(node?.id || '').trim();
}

function _disksGuestSummaryCandidates(hostNode, host, guestKey) {
  const matches = [];
  const visit = current => {
    if (!current || typeof current !== 'object') return;
    const meta = _disksGuestMeta(current);
    if (meta && meta.host === host && meta.guest_key === guestKey) {
      const kind = String(current.kind || '').trim().toLowerCase();
      if (kind === 'dataset' || kind === 'volume' || kind === 'drive' || kind === 'partition') {
        matches.push(current);
      }
    }
    (Array.isArray(current.children) ? current.children : []).forEach(child => visit(child));
  };
  visit(hostNode);

  const deduped = new Map();
  matches.forEach(node => {
    const signature = _disksGuestSummarySignature(node);
    const existing = deduped.get(signature);
    if (!existing || _disksGuestSummaryPriority(node) > _disksGuestSummaryPriority(existing)) {
      deduped.set(signature, node);
    }
  });

  return Array.from(deduped.values()).sort((left, right) => {
    const leftLabel = String(left?.label || '').trim();
    const rightLabel = String(right?.label || '').trim();
    const priorityDelta = _disksGuestSummaryPriority(right) - _disksGuestSummaryPriority(left);
    if (priorityDelta !== 0) return priorityDelta;
    return leftLabel.localeCompare(rightLabel);
  });
}

function _disksGuestSummaryMeta(items) {
  const metas = (Array.isArray(items) ? items : [])
    .map(item => _disksGuestMeta(item))
    .filter(Boolean);
  if (!metas.length) return null;
  return metas.sort((left, right) => {
    const leftLabel = String(left?.guest_summary_label || '').trim();
    const rightLabel = String(right?.guest_summary_label || '').trim();
    const leftDisplay = String(left?.guest_display || '').trim();
    const rightDisplay = String(right?.guest_display || '').trim();
    if (rightLabel.length !== leftLabel.length) return rightLabel.length - leftLabel.length;
    if (rightDisplay.length !== leftDisplay.length) return rightDisplay.length - leftDisplay.length;
    return rightLabel.localeCompare(leftLabel);
  })[0];
}

function _disksGuestStorageGroup(node) {
  const datasetAncestor = _disksNearestAncestor(node, ['dataset']);
  if (datasetAncestor) {
    return String(datasetAncestor.subtitle || datasetAncestor.label || 'Dataset').trim() || 'Dataset';
  }
  if (/whole-controller passthrough/i.test(String(node?.note || ''))) {
    return 'Whole-controller passthrough';
  }
  const assignment = _disksFactValue(node, 'Assignment');
  if (/raw disk passthrough/i.test(assignment)) {
    return 'Raw drive passthrough';
  }
  const poolAncestor = _disksNearestAncestor(node, ['pool']);
  if (poolAncestor) {
    return `Pool ${String(poolAncestor.label || '').trim()}`;
  }
  return 'Other storage';
}

function _disksGuestSummaryEntryLabel(node) {
  const role = _disksFactValue(node, 'Guest roles');
  const volumeLabel = _disksFactValue(node, 'Volume label');
  return role || String(node?.label || volumeLabel || 'Disk').trim() || 'Disk';
}

function _disksGuestSummaryEntrySubtitle(node) {
  const bits = [];
  const primaryLabel = _disksGuestSummaryEntryLabel(node);
  const nodeLabel = String(node?.label || '').trim();
  if (nodeLabel && nodeLabel !== primaryLabel) bits.push(nodeLabel);
  const filesystem = _disksFactValue(node, 'Filesystem');
  if (filesystem) bits.push(_disksFilesystemShortcutLabel(filesystem));
  const mount = _disksFactValue(node, 'Mount');
  if (mount) {
    bits.push(mount);
  } else {
    const path = _disksFactValue(node, 'Path') || _disksFactValue(node, 'Guest path');
    if (path) bits.push(path);
  }
  return bits.join(' · ');
}

function _disksGuestSummaryDetail(node) {
  const bits = [];
  const backingDrive = _disksFactValue(node, 'Backing drive');
  if (backingDrive) bits.push(`backed by ${backingDrive}`);
  const assignment = _disksFactValue(node, 'Assignment');
  if (assignment) bits.push(assignment);
  const source = _disksFactValue(node, 'Source');
  if (source) bits.push(source);
  return bits.join(' · ');
}

function _disksGuestSummaryUsage(nodes) {
  let totalBytes = 0;
  let knownUsedBytes = 0;
  let unknownBytes = 0;
  (Array.isArray(nodes) ? nodes : []).forEach(node => {
    const total = _disksByteValue(node?.total_bytes);
    const used = _disksByteValue(node?.used_bytes);
    if (total != null) totalBytes += total;
    if (used != null) {
      knownUsedBytes += used;
    } else if (total != null) {
      unknownBytes += total;
    }
  });
  const knownTotal = Math.max(0, totalBytes - unknownBytes);
  return {
    totalBytes: totalBytes || 0,
    knownUsedBytes: knownUsedBytes || 0,
    unknownBytes: unknownBytes || 0,
    knownTotal,
  };
}

function _disksGuestSummaryEntryHtml(node) {
  const primaryLabel = _disksGuestSummaryEntryLabel(node);
  const subtitle = _disksGuestSummaryEntrySubtitle(node);
  const detail = _disksGuestSummaryDetail(node);
  const pct = _disksUsagePct(node);
  return `
    <article class="disks-guest-summary__entry">
      <div class="disks-guest-summary__entry-top">
        <button type="button" class="disks-guest-summary__entry-open" data-disks-node="${_disksEsc(node.id)}">${_disksEsc(primaryLabel)}</button>
        <span class="disks-guest-summary__entry-usage">${_disksEsc(_disksUsageText(node))}</span>
      </div>
      ${subtitle ? `<p class="disks-guest-summary__entry-subtitle">${_disksEsc(subtitle)}</p>` : ''}
      ${pct == null ? '' : `
        <div class="disks-meter disks-meter--compact" aria-hidden="true">
          <span class="disks-meter__fill" style="width:${pct}%"></span>
        </div>
      `}
      ${detail ? `<p class="disks-guest-summary__entry-detail">${_disksEsc(detail)}</p>` : ''}
    </article>
  `;
}

function _disksGuestSummaryHtml(meta, items) {
  const usage = _disksGuestSummaryUsage(items);
  const sectionsByName = new Map();
  items.forEach(node => {
    const name = _disksGuestStorageGroup(node);
    if (!sectionsByName.has(name)) {
      sectionsByName.set(name, []);
    }
    sectionsByName.get(name).push(node);
  });
  const sections = Array.from(sectionsByName.entries())
    .map(([name, sectionItems]) => ({ name, items: sectionItems }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const summaryText = usage.unknownBytes > 0
    ? `${_disksFormatBytes(usage.knownUsedBytes)} known used on ${_disksFormatBytes(usage.knownTotal)} known · ${_disksFormatBytes(usage.unknownBytes)} still measured only partially`
    : `${_disksFormatBytes(usage.knownUsedBytes)} used on ${_disksFormatBytes(usage.totalBytes)} total`;

  return `
    <div class="disks-guest-summary__intro">
      <div class="disks-guest-summary__chips">
        <span class="disks-pill">${_disksEsc(meta.host)}</span>
        <span class="disks-pill">${_disksEsc(meta.guest_kind_label || 'Guest')} ${_disksEsc(meta.guest_id || '')}</span>
        <span class="disks-pill">${items.length} item${items.length === 1 ? '' : 's'}</span>
      </div>
      <p class="disks-guest-summary__note">${_disksEsc(summaryText)}</p>
    </div>
    <div class="disks-guest-summary__sections">
      ${sections.map(section => {
        const sectionUsage = _disksGuestSummaryUsage(section.items);
        const sectionMeta = sectionUsage.totalBytes
          ? _disksFormatBytes(sectionUsage.totalBytes)
          : `${section.items.length} item${section.items.length === 1 ? '' : 's'}`;
        return `
          <section class="disks-guest-summary__section">
            <div class="disks-guest-summary__section-head">
              <h3 class="disks-guest-summary__section-title">${_disksEsc(section.name)}</h3>
              <span class="disks-guest-summary__section-meta">${_disksEsc(sectionMeta)}</span>
            </div>
            <div class="disks-guest-summary__entries">
              ${section.items.map(item => _disksGuestSummaryEntryHtml(item)).join('')}
            </div>
          </section>
        `;
      }).join('')}
    </div>
  `;
}

function _disksOpenGuestSummary(host, guestKey) {
  const dialog = _disksEl('disks-guest-modal');
  const title = _disksEl('disks-guest-title');
  const subtitle = _disksEl('disks-guest-subtitle');
  const body = _disksEl('disks-guest-body');
  const errEl = _disksEl('disks-guest-error');
  if (!dialog || !title || !subtitle || !body || !errEl) return;

  const hostNode = _disksNodeById.get(`host:${host}`);
  const items = hostNode ? _disksGuestSummaryCandidates(hostNode, host, guestKey) : [];
  const sampleMeta = _disksGuestSummaryMeta(items);
  if (!sampleMeta || !items.length) {
    title.textContent = 'Guest disks';
    subtitle.textContent = host ? `${host} · no guest disk summary found` : 'No guest disk summary found';
    body.innerHTML = '';
    errEl.hidden = false;
    errEl.textContent = 'Could not find any guest-backed disks for that summary.';
  } else {
    title.textContent = sampleMeta.guest_summary_label || sampleMeta.guest_display || 'Guest disks';
    subtitle.textContent = `${sampleMeta.guest_display || sampleMeta.guest_summary_label} · ${host}`;
    body.innerHTML = _disksGuestSummaryHtml(sampleMeta, items);
    errEl.hidden = true;
    errEl.textContent = '';
  }

  try {
    if (window.HubModal && typeof window.HubModal.open === 'function') {
      window.HubModal.open(dialog);
    } else if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', 'open');
    }
  } catch (_) {
    dialog.setAttribute('open', 'open');
  }
}

function _disksCloseGuestSummary() {
  const dialog = _disksEl('disks-guest-modal');
  if (!dialog) return;
  try {
    if (window.HubModal && typeof window.HubModal.close === 'function') {
      window.HubModal.close(dialog);
    } else {
      dialog.close();
    }
  } catch (_) {
    dialog.removeAttribute('open');
  }
}

function _disksSetNodeUserNote(nodeId, note) {
  const node = _disksNodeById.get(String(nodeId || '').trim());
  if (!node) return;
  const cleanNote = String(note || '').trim();
  if (cleanNote) node.user_note = cleanNote;
  else delete node.user_note;
}

function _disksToggleNoteEditor(nodeId) {
  const cleanNodeId = String(nodeId || '').trim();
  if (!cleanNodeId || !_disksNodeById.has(cleanNodeId)) return;
  if (_disksNoteOpen.has(cleanNodeId)) {
    _disksNoteOpen.delete(cleanNodeId);
  } else {
    _disksNoteOpen.add(cleanNodeId);
    _disksNoteDrafts.set(cleanNodeId, _disksUserNote(_disksNodeById.get(cleanNodeId)));
  }
  renderDisksPage();
  if (_disksNoteOpen.has(cleanNodeId)) {
    window.requestAnimationFrame(() => {
      const input = document.getElementById(`disks-note-${cleanNodeId}`);
      if (input) input.focus();
    });
  }
}

async function _disksSaveNoteNow(nodeId) {
  const cleanNodeId = String(nodeId || '').trim();
  if (!cleanNodeId) return;
  const note = String(_disksNoteDrafts.get(cleanNodeId) || '').trim();
  _disksNoteSaving.add(cleanNodeId);
  _disksNoteErrors.delete(cleanNodeId);
  renderDisksPage();
  try {
    const response = await apiFetch('/api/v1/disks/note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_id: cleanNodeId, note }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.detail || `HTTP ${response.status}`);
    }
    _disksSetNodeUserNote(cleanNodeId, note);
  } catch (err) {
    const message = err && err.message ? err.message : String(err || 'Note save failed');
    _disksNoteErrors.set(cleanNodeId, message);
  } finally {
    _disksNoteSaving.delete(cleanNodeId);
    renderDisksPage();
  }
}

function _disksQueueNoteSave(nodeId, value) {
  const cleanNodeId = String(nodeId || '').trim();
  if (!cleanNodeId) return;
  _disksNoteDrafts.set(cleanNodeId, String(value || ''));
  _disksNoteErrors.delete(cleanNodeId);
  const existing = _disksNoteSaveTimers.get(cleanNodeId);
  if (existing) window.clearTimeout(existing);
  const timer = window.setTimeout(() => {
    _disksNoteSaveTimers.delete(cleanNodeId);
    _disksSaveNoteNow(cleanNodeId).catch(() => {});
  }, 450);
  _disksNoteSaveTimers.set(cleanNodeId, timer);
}

function _disksOfflineBrowseReset() {
  if (_disksOfflineBrowseState?.heartbeatTimer) {
    window.clearInterval(_disksOfflineBrowseState.heartbeatTimer);
  }
  _disksOfflineBrowseState = null;
}

function _disksOfflineBrowseCacheKey(sourcePath, relativePath) {
  return `${String(sourcePath || '').trim()}::${_disksNormalizeRelativePath(relativePath)}`;
}

function _disksOfflineBrowseCurrentSource() {
  const state = _disksOfflineBrowseState;
  if (!state) return null;
  return (Array.isArray(state.sources) ? state.sources : []).find(source => {
    return String(source?.path || '').trim() === String(state.sourcePath || '').trim();
  }) || null;
}

function _disksOfflineBrowseCurrentPath() {
  const state = _disksOfflineBrowseState;
  if (!state) return '.';
  return state.paths.get(String(state.sourcePath || '').trim()) || '.';
}

function _disksOfflineBrowseRender() {
  const dialog = _disksEl('disks-offline-modal');
  const title = _disksEl('disks-offline-title');
  const subtitle = _disksEl('disks-offline-subtitle');
  const body = _disksEl('disks-offline-body');
  if (!dialog || !title || !subtitle || !body) return;
  const state = _disksOfflineBrowseState;
  if (!state) {
    title.textContent = 'Offline browse';
    subtitle.textContent = '';
    body.innerHTML = '<div class="docs-tree-empty">Offline browse is closed.</div>';
    return;
  }
  const source = _disksOfflineBrowseCurrentSource();
  const currentPath = _disksOfflineBrowseCurrentPath();
  const cacheKey = _disksOfflineBrowseCacheKey(source?.path || '', currentPath);
  const cached = state.cache.get(cacheKey) || null;
  const loading = state.loadingKeys.has(cacheKey);
  const data = cached?.ok ? cached.data : null;
  const error = cached && cached.ok === false ? cached.error : '';
  const absolutePath = String(data?.current_absolute_path || '/').trim() || '/';
  const relativePath = String(data?.current_path || currentPath || '.').trim() || '.';
  const canGoUp = !!data?.parent_path && relativePath !== '.';
  const rootDisabled = relativePath === '.';
  const breadcrumbs = Array.isArray(data?.breadcrumbs) ? data.breadcrumbs : [];
  const breadcrumbHtml = breadcrumbs.map(crumb => `
    <button class="docs-tree-crumb bp-font-role-docs-markdown" type="button" data-disks-offline-action="browse" data-path="${_disksEsc(crumb?.path || '.')}">${_disksEsc(crumb?.label || 'root')}</button>
  `).join('');
  let listHtml = '<div class="docs-tree-loading">Loading folder...</div>';
  if (error) {
    listHtml = '<div class="docs-tree-empty">Could not load this folder.</div>';
  } else if (data) {
    const entries = Array.isArray(data.entries) ? data.entries : [];
    listHtml = entries.length
      ? entries.map(entry => _disksFilesystemTreeRowHtml(entry).replace(/data-disks-tree-action/g, 'data-disks-offline-action')).join('')
      : '<div class="docs-tree-empty">This folder is empty.</div>';
  } else if (!loading) {
    listHtml = '<div class="docs-tree-empty">Preparing offline file tree…</div>';
  }
  const sourceButtons = (Array.isArray(state.sources) ? state.sources : []).map(item => {
    const itemPath = String(item?.path || '').trim();
    const selected = itemPath && itemPath === String(state.sourcePath || '').trim();
    const label = String(item?.label || item?.path || 'filesystem').trim();
    const filesystem = String(item?.filesystem || '').trim().toUpperCase();
    return `
      <button
        type="button"
        class="disks-offline-modal__source${selected ? ' is-active' : ''}"
        data-disks-offline-source="${_disksEsc(itemPath)}"
      >
        <span>${_disksEsc(label)}</span>
        <span>${_disksEsc(filesystem || 'FS')}</span>
      </button>
    `;
  }).join('');
  const statusText = error
    ? ''
    : loading && !data
      ? 'Loading folder...'
      : _disksFilesystemTreeStatusText(data);
  title.textContent = state.title || 'Offline browse';
  subtitle.textContent = state.subtitle || '';
  body.innerHTML = `
    <div class="disks-offline-modal__meta">
      <span class="disks-pill">${_disksEsc(state.host || '')}</span>
      <span class="disks-pill">${_disksEsc(String(source?.filesystem || 'filesystem').toUpperCase())}</span>
      <code class="disks-tree__root">${_disksEsc(source?.path || '')}</code>
    </div>
    <div class="disks-offline-modal__sources">${sourceButtons}</div>
    <div class="docs-tree-shell disks-tree__shell">
      <div class="disks-tree__toolbar">
        <button class="hub-modal-btn secondary" type="button" data-disks-offline-action="up"${canGoUp ? '' : ' disabled'}>Up</button>
        <code class="docs-tree-path disks-tree__path">${_disksEsc(absolutePath)}</code>
        <div class="disks-tree__toolbar-actions">
          <button class="hub-modal-btn secondary" type="button" data-disks-offline-action="root"${rootDisabled ? ' disabled' : ''}>Root</button>
          <button class="hub-modal-btn secondary" type="button" data-disks-offline-action="refresh">Refresh</button>
        </div>
      </div>
      <div class="docs-tree-breadcrumbs"${breadcrumbs.length > 1 ? '' : ' hidden'}>${breadcrumbHtml}</div>
      <div class="docs-tree-panel">
        <div class="docs-tree-list">${listHtml}</div>
      </div>
      <p class="docs-tree-status">${_disksEsc(statusText)}</p>
      <p class="hub-modal-error disks-tree__error"${error ? '' : ' hidden'}>${_disksEsc(error ? `Error: ${error}` : '')}</p>
      <p class="disks-tree__relative bp-font-role-status-meta">${_disksEsc(relativePath === '.' ? 'root' : relativePath)}</p>
    </div>
  `;
}

function _disksOfflineBrowseLoad(force = false) {
  const state = _disksOfflineBrowseState;
  const source = _disksOfflineBrowseCurrentSource();
  if (!state || !source) return;
  const currentPath = _disksOfflineBrowseCurrentPath();
  const cacheKey = _disksOfflineBrowseCacheKey(source.path, currentPath);
  if (force) state.cache.delete(cacheKey);
  if (state.cache.has(cacheKey) || state.loadingKeys.has(cacheKey)) {
    _disksOfflineBrowseRender();
    return;
  }
  state.loadingKeys.add(cacheKey);
  _disksOfflineBrowseRender();
  apiFetch('/api/v1/disks/filesystem/tree', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host: state.host,
      root_path: '/',
      browse_mode: 'device_ro',
      source_path: source.path,
      path: currentPath === '.' ? null : currentPath,
    }),
  })
    .then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || `HTTP ${response.status}`);
      }
      state.cache.set(cacheKey, { ok: true, data });
      state.paths.set(String(source.path || '').trim(), _disksNormalizeRelativePath(data?.current_path || currentPath));
    })
    .catch(err => {
      const message = err && err.message ? err.message : String(err || 'Offline browse failed');
      state.cache.set(cacheKey, { ok: false, error: message });
    })
    .finally(() => {
      state.loadingKeys.delete(cacheKey);
      _disksOfflineBrowseRender();
    });
}

function _disksOfflineBrowseStartHeartbeat() {
  const state = _disksOfflineBrowseState;
  if (!state || !state.sessionId) return;
  if (state.heartbeatTimer) window.clearInterval(state.heartbeatTimer);
  state.heartbeatTimer = window.setInterval(() => {
    if (!_disksOfflineBrowseState?.sessionId) return;
    apiFetch('/api/v1/disks/offline-browse/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: _disksOfflineBrowseState.sessionId }),
    }).catch(() => {});
  }, 5000);
}

function _disksCloseOfflineBrowseModal() {
  const dialog = _disksEl('disks-offline-modal');
  const state = _disksOfflineBrowseState;
  const sessionId = String(state?.sessionId || '').trim();
  if (state?.heartbeatTimer) {
    window.clearInterval(state.heartbeatTimer);
  }
  _disksOfflineBrowseReset();
  if (sessionId) {
    apiFetch('/api/v1/disks/offline-browse/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    }).catch(() => {});
  }
  if (!dialog) return;
  try {
    if (window.HubModal && typeof window.HubModal.close === 'function') {
      window.HubModal.close(dialog);
    } else {
      dialog.close();
    }
  } catch (_) {
    dialog.removeAttribute('open');
  }
}

async function _disksOpenOfflineBrowse(node) {
  const meta = _disksOfflineBrowserMeta(node);
  if (!meta) return;
  const guestLabel = meta.guest_name || `VM ${meta.guest_id}`;
  const volumeLabel = meta.volume_label || meta.volume_ref;
  const confirmed = window.HubDialogs && typeof window.HubDialogs.confirm === 'function'
    ? await window.HubDialogs.confirm({
      title: 'Open offline disk browser',
      message: `Attach ${volumeLabel} from ${guestLabel} read-only?`,
      detail: 'The VM must stay stopped. Blueprints will attach this one disk read-only, browse it only inside this authenticated page, and auto-clean it up on close or after heartbeat timeout.',
      tone: 'warning',
      confirmText: 'Attach read-only',
    })
    : window.confirm(`Attach ${volumeLabel} from ${guestLabel} read-only?`);
  if (!confirmed) return;
  _disksStatusMessage('Preparing read-only offline disk browse…', 'info', true);
  const response = await apiFetch('/api/v1/disks/offline-browse/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host: meta.host,
      guest_id: meta.guest_id,
      guest_name: meta.guest_name,
      volume_ref: meta.volume_ref,
      volume_label: meta.volume_label,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || `HTTP ${response.status}`);
  }
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  const defaultSource = sources.find(source => !!source?.default) || sources[0] || null;
  _disksOfflineBrowseState = {
    sessionId: String(payload.session_id || '').trim(),
    host: String(payload.host || meta.host || '').trim(),
    title: volumeLabel,
    subtitle: `${guestLabel} · read-only attach`,
    sources,
    sourcePath: String(defaultSource?.path || '').trim(),
    paths: new Map(),
    cache: new Map(),
    loadingKeys: new Set(),
    heartbeatTimer: 0,
  };
  const dialog = _disksEl('disks-offline-modal');
  if (dialog) {
    try {
      if (window.HubModal && typeof window.HubModal.open === 'function') {
        window.HubModal.open(dialog);
      } else if (typeof dialog.showModal === 'function' && !dialog.open) {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', 'open');
      }
    } catch (_) {
      dialog.setAttribute('open', 'open');
    }
  }
  _disksOfflineBrowseRender();
  _disksOfflineBrowseStartHeartbeat();
  _disksOfflineBrowseLoad();
  _disksStatusMessage('Offline disk browse attached read-only.', 'ok');
}

function _disksScrollToTop() {
  const shell = _disksEl('disks-shell');
  if (!shell) return;
  shell.scrollTop = 0;
}

function _disksOnShellInput(event) {
  const noteInput = event.target.closest('[data-disks-note-input]');
  if (!noteInput) return;
  _disksQueueNoteSave(noteInput.dataset.disksNoteInput || '', noteInput.value || '');
}

function _disksOnShellKeydown(event) {
  const nodeTarget = event.target.closest('.disks-card__main[data-disks-node]');
  if (!nodeTarget) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (event.target.closest('[data-disks-note-input]') || event.target.closest('[data-disks-note-toggle]')) return;
  event.preventDefault();
  nodeTarget.click();
}

function _disksOnShellFocusOut(event) {
  const noteInput = event.target.closest('[data-disks-note-input]');
  if (!noteInput) return;
  const nodeId = String(noteInput.dataset.disksNoteInput || '').trim();
  if (!nodeId) return;
  const timer = _disksNoteSaveTimers.get(nodeId);
  if (timer) {
    window.clearTimeout(timer);
    _disksNoteSaveTimers.delete(nodeId);
  }
  _disksSaveNoteNow(nodeId).catch(() => {});
}

function _disksOnShellClick(event) {
  const noteToggle = event.target.closest('[data-disks-note-toggle]');
  if (noteToggle) {
    event.preventDefault();
    event.stopPropagation();
    _disksToggleNoteEditor(noteToggle.dataset.disksNoteToggle || '');
    return;
  }
  const offlineOpenBtn = event.target.closest('[data-disks-offline-open]');
  if (offlineOpenBtn) {
    event.preventDefault();
    event.stopPropagation();
    const targetId = offlineOpenBtn.dataset.disksOfflineOpen || '';
    const node = _disksNodeById.get(targetId);
    if (!node) return;
    _disksOpenOfflineBrowse(node).catch(err => {
      const message = err && err.message ? err.message : String(err || 'Offline browse failed');
      _disksStatusMessage(`Could not open offline disk browser: ${message}`, 'fail', true);
    });
    return;
  }
  const treeActionBtn = event.target.closest('[data-disks-tree-action]');
  if (treeActionBtn) {
    event.preventDefault();
    event.stopPropagation();
    const node = _disksCurrentNode();
    const meta = _disksFilesystemBrowserMeta(node);
    if (!node || !meta) return;
    const action = String(treeActionBtn.dataset.disksTreeAction || '').trim();
    if (action === 'browse') {
      _disksFilesystemTreeNavigate(node, meta, treeActionBtn.dataset.path || '.');
      return;
    }
    if (action === 'up') {
      const currentPath = _disksFilesystemTreePathForNode(node, meta);
      const cached = _disksFilesystemTreeCached(node, meta, currentPath);
      const parentPath = cached?.ok ? (cached.data?.parent_path || '.') : '.';
      _disksFilesystemTreeNavigate(node, meta, parentPath);
      return;
    }
    if (action === 'root') {
      _disksFilesystemTreeNavigate(node, meta, '.');
      return;
    }
    if (action === 'refresh') {
      _disksFilesystemTreeRefresh(node, meta);
      return;
    }
  }
  const guestSummaryBtn = event.target.closest('[data-disks-guest-key]');
  if (guestSummaryBtn) {
    event.preventDefault();
    event.stopPropagation();
    _disksOpenGuestSummary(
      guestSummaryBtn.dataset.disksGuestHost || '',
      guestSummaryBtn.dataset.disksGuestKey || ''
    );
    return;
  }
  const forgetBtn = event.target.closest('[data-disks-forget-host]');
  if (forgetBtn) {
    event.preventDefault();
    event.stopPropagation();
    _disksForgetCachedNode(
      forgetBtn.dataset.disksForgetHost || '',
      forgetBtn.dataset.disksForgetNode || ''
    ).catch(err => {
      const message = err && err.message ? err.message : String(err || 'Failed to remove cached inventory item');
      _disksStatusMessage(`Could not remove cached inventory item: ${message}`, 'fail', true);
    });
    return;
  }
  const smartBtn = event.target.closest('[data-disks-smart-host]');
  if (smartBtn) {
    event.preventDefault();
    event.stopPropagation();
    _disksOpenSmart(
      smartBtn.dataset.disksSmartHost || '',
      smartBtn.dataset.disksSmartDevice || '',
      smartBtn.dataset.disksSmartLabel || ''
    );
    return;
  }
  if (event.target.closest('.disks-card__note-editor')) {
    event.stopPropagation();
    return;
  }
  const nodeBtn = event.target.closest('[data-disks-node]');
  if (!nodeBtn) return;
  event.preventDefault();
  const targetId = nodeBtn.dataset.disksNode || '';
  if (!targetId || !_disksNodeById.has(targetId)) return;
  _disksCurrentNodeId = targetId;
  renderDisksPage();
  _disksScrollToTop();
}

function _disksInit() {
  if (_disksInitDone) return;
  _disksInitDone = true;
  window.addEventListener('resize', _disksScheduleLayoutPass, { passive: true });
  _disksEl('disks-shell')?.addEventListener('click', _disksOnShellClick);
  _disksEl('disks-shell')?.addEventListener('input', _disksOnShellInput);
  _disksEl('disks-shell')?.addEventListener('keydown', _disksOnShellKeydown);
  _disksEl('disks-shell')?.addEventListener('focusout', _disksOnShellFocusOut);
  _disksEl('disks-smart-modal')?.addEventListener('click', (event) => {
    const closeBtn = event.target.closest('.hub-modal-close');
    if (closeBtn) {
      event.preventDefault();
      _disksCloseSmart();
    }
  });
  _disksEl('disks-smart-modal')?.addEventListener('cancel', (event) => {
    event.preventDefault();
    _disksCloseSmart();
  });
  _disksEl('disks-guest-modal')?.addEventListener('click', (event) => {
    const closeBtn = event.target.closest('.hub-modal-close');
    if (closeBtn) {
      event.preventDefault();
      _disksCloseGuestSummary();
      return;
    }
    const nodeBtn = event.target.closest('[data-disks-node]');
    if (!nodeBtn) return;
    event.preventDefault();
    const targetId = nodeBtn.dataset.disksNode || '';
    if (!targetId || !_disksNodeById.has(targetId)) return;
    _disksCloseGuestSummary();
    _disksCurrentNodeId = targetId;
    renderDisksPage();
    _disksScrollToTop();
  });
  _disksEl('disks-guest-modal')?.addEventListener('cancel', (event) => {
    event.preventDefault();
    _disksCloseGuestSummary();
  });
  _disksEl('disks-offline-modal')?.addEventListener('click', (event) => {
    const closeBtn = event.target.closest('.hub-modal-close');
    if (closeBtn) {
      event.preventDefault();
      _disksCloseOfflineBrowseModal();
      return;
    }
    const sourceBtn = event.target.closest('[data-disks-offline-source]');
    if (sourceBtn && _disksOfflineBrowseState) {
      event.preventDefault();
      _disksOfflineBrowseState.sourcePath = String(sourceBtn.dataset.disksOfflineSource || '').trim();
      _disksOfflineBrowseRender();
      _disksOfflineBrowseLoad();
      return;
    }
    const actionBtn = event.target.closest('[data-disks-offline-action]');
    if (actionBtn && _disksOfflineBrowseState) {
      event.preventDefault();
      const action = String(actionBtn.dataset.disksOfflineAction || '').trim();
      if (action === 'browse') {
        _disksOfflineBrowseState.paths.set(
          String(_disksOfflineBrowseState.sourcePath || '').trim(),
          _disksNormalizeRelativePath(actionBtn.dataset.path || '.'),
        );
        _disksOfflineBrowseRender();
        _disksOfflineBrowseLoad();
        return;
      }
      if (action === 'up') {
        const source = _disksOfflineBrowseCurrentSource();
        const currentPath = _disksOfflineBrowseCurrentPath();
        const cached = _disksOfflineBrowseState.cache.get(
          _disksOfflineBrowseCacheKey(source?.path || '', currentPath)
        );
        const parentPath = cached?.ok ? (cached.data?.parent_path || '.') : '.';
        _disksOfflineBrowseState.paths.set(
          String(_disksOfflineBrowseState.sourcePath || '').trim(),
          _disksNormalizeRelativePath(parentPath),
        );
        _disksOfflineBrowseRender();
        _disksOfflineBrowseLoad();
        return;
      }
      if (action === 'root') {
        _disksOfflineBrowseState.paths.set(String(_disksOfflineBrowseState.sourcePath || '').trim(), '.');
        _disksOfflineBrowseRender();
        _disksOfflineBrowseLoad();
        return;
      }
      if (action === 'refresh') {
        _disksOfflineBrowseLoad(true);
      }
    }
  });
  _disksEl('disks-offline-modal')?.addEventListener('cancel', (event) => {
    event.preventDefault();
    _disksCloseOfflineBrowseModal();
  });
}
