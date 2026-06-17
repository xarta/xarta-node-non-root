'use strict';

let _disksTopology = null;
let _disksNodeById = new Map();
let _disksParentById = new Map();
let _disksCurrentNodeId = 'fleet:disks';
let _disksLoadPromise = null;
let _disksSourceIssues = [];
let _disksInitDone = false;
let _disksLayoutFrame = 0;

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
    'part-label',
    'backing-drive',
    'drive-model',
    'transport',
    'source',
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
  const drivePath = _disksFactValue(driveNode, 'Path');
  if (drivePath) candidatePaths.add(drivePath);
  (Array.isArray(driveNode.children) ? driveNode.children : []).forEach(child => {
    const childPath = _disksFactValue(child, 'Path');
    if (childPath) candidatePaths.add(childPath);
  });
  return (Array.isArray(hostNode.children) ? hostNode.children : []).filter(child => {
    if (!child || String(child.group || '').trim() !== 'Logical systems') return false;
    if (String(child.kind || '').trim().toLowerCase() !== 'volume') return false;
    const backingDrive = _disksFactValue(child, 'Backing drive');
    if (backingDrive && backingDrive === driveLabel) return true;
    const path = _disksFactValue(child, 'Path');
    return !!(path && candidatePaths.has(path));
  });
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

function _disksPrimaryOpenTarget(node) {
  if (!node) return null;
  if (String(node.kind || '').trim().toLowerCase() !== 'pool-link') return node;
  return _disksShortcutTarget(node) || node;
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
        ${node.smart ? `<button type="button" class="disks-card__smart" data-disks-smart-host="${_disksEsc(node.smart.host)}" data-disks-smart-device="${_disksEsc(node.smart.device_path)}" data-disks-smart-label="${_disksEsc(_disksSmartLabel(node))}">S.M.A.R.T.</button>` : ''}
      </div>
      <button type="button" class="disks-card__main" data-disks-node="${_disksEsc(primaryTarget.id)}">
        <div class="disks-card__header">
          <img class="disks-card__icon" src="${_disksNodeIcon(node)}" alt="" />
          <div class="disks-card__text">
            <div class="disks-card__title-row">
              <strong class="disks-card__title">${_disksEsc(node.label)}</strong>
              ${drivePurpose ? `<span class="disks-card__title-suffix">(${_disksEsc(drivePurpose)})</span>` : ''}
            </div>
            ${showSubtitle ? `<div class="disks-card__subtitle">${_disksEsc(node.subtitle)}</div>` : ''}
            ${poolCaption}
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
        ${node.note ? `<p class="disks-card__note">${_disksEsc(node.note)}</p>` : ''}
        ${_disksFactsHtml(node.facts, 6, { kind: node?.kind, context: 'card' })}
        <div class="disks-card__footer">
          <span>${cta}</span>
          ${hasChildren ? `<span>${primaryTarget.children.length} item${primaryTarget.children.length === 1 ? '' : 's'}</span>` : '<span>Details</span>'}
        </div>
      </button>
    </article>
  `;
}

function _disksGroupsHtml(node) {
  const groups = _disksGroupChildren(node);
  if (!groups.length) {
    return `
      <section class="disks-empty-state">
        <h3>This branch stops here</h3>
        <p>The current item has detail, but no deeper drill-down is exposed yet.</p>
      </section>
    `;
  }
  return groups.map(group => {
    const isPhysicalDriveGroup = String(group.name).trim().toLowerCase() === 'physical drives'
      && group.items.every(item => item?.kind === 'drive');
    if (isPhysicalDriveGroup) {
      return _disksPhysicalDriveGroupHtml(group, node);
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

function _disksScrollToTop() {
  const shell = _disksEl('disks-shell');
  if (!shell) return;
  shell.scrollTop = 0;
}

function _disksOnShellClick(event) {
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
}
