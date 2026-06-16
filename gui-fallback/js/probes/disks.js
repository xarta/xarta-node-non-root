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

function _disksUsageText(node) {
  if (node && typeof node.usage_text === 'string' && node.usage_text.trim()) {
    return node.usage_text.trim();
  }
  if (!node || node.total_bytes == null) return 'Usage unavailable';
  const used = node.used_bytes == null ? '—' : _disksFormatBytes(node.used_bytes);
  return `${used} / ${_disksFormatBytes(node.total_bytes)}`;
}

function _disksUsagePct(node) {
  if (!node || node.usage_pct == null || node.usage_pct === '') return null;
  const pct = Number(node.usage_pct);
  return Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : null;
}

function _disksStatusTone(status) {
  if (status === 'ok') return 'ok';
  if (status === 'warn') return 'warn';
  if (status === 'fail') return 'fail';
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

function _disksFactValue(node, label) {
  const key = String(label ?? '').trim().toLowerCase();
  const fact = (Array.isArray(node?.facts) ? node.facts : []).find(item => {
    return String(item?.label ?? '').trim().toLowerCase() === key;
  });
  return String(fact?.value ?? '').trim();
}

function _disksFactsHtml(facts, limit = 6) {
  const items = Array.isArray(facts) ? facts.slice(0, limit) : [];
  if (!items.length) return '';
  return `<div class="disks-facts">${items.map(fact => `
    <div class="disks-facts__item disks-facts__item--${_disksEsc(_disksFactSlug(fact.label))}">
      <span class="disks-facts__label">${_disksEsc(fact.label)}</span>
      <span class="disks-facts__value">${_disksEsc(fact.value)}</span>
    </div>
  `).join('')}</div>`;
}

function _disksHeroHtml(node) {
  const pct = _disksUsagePct(node);
  const crumbs = _disksBreadcrumbs();
  const backTarget = crumbs.length > 1 ? crumbs[crumbs.length - 2].id : '';
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
          <h2 class="disks-hero__title">${_disksEsc(node.label || 'Disks')}</h2>
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
          ${pct == null ? '' : `<span>${pct.toFixed(1)}% used</span>`}
        </div>
        ${pct == null ? '' : `
          <div class="disks-meter" aria-hidden="true">
            <span class="disks-meter__fill" style="width:${pct}%"></span>
          </div>
        `}
        ${_disksFactsHtml(node.facts, 12)}
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

function _disksDriveTypeMeta(node) {
  const transport = _disksFactValue(node, 'Transport').toLowerCase();
  const rotational = _disksFactValue(node, 'Rotational').toLowerCase();
  const model = `${_disksFactValue(node, 'Model')} ${node?.subtitle || ''}`.toLowerCase();
  if (transport === 'nvme') {
    return { key: 'nvme', order: 0 };
  }
  if (transport === 'usb' && /(datatraveler|flash|thumb|stick|reader)/i.test(model)) {
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
  const value = String(transport ?? '').trim().toLowerCase();
  const order = {
    nvme: 0,
    sata: 1,
    sas: 2,
    scsi: 3,
    usb: 4,
    thunderbolt: 5,
  };
  return Object.prototype.hasOwnProperty.call(order, value) ? order[value] : 99;
}

function _disksDriveEntry(node) {
  return {
    node,
    pools: _disksDrivePools(node),
    transport: _disksFactValue(node, 'Transport').toLowerCase(),
    type: _disksDriveTypeMeta(node),
  };
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

function _disksBuildPhysicalDriveLayout(items) {
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

  return {
    multiPools: pooled.filter(group => group.items.length > 1),
    pooledSingles: pooled.filter(group => group.items.length === 1),
    unpooled,
  };
}

function _disksPoolClusterHtml(group) {
  const count = group.items.length;
  return `
    <section class="disks-pool-cluster" style="--disks-cluster-rgb:${_disksEsc(group.color)};">
      <div class="disks-pool-cluster__header">
        <span class="disks-pool-cluster__name">${_disksEsc(group.pool)}</span>
        <span class="disks-pool-cluster__meta">${count} member${count === 1 ? '' : 's'} · ZFS pool</span>
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

function _disksPhysicalDriveGroupHtml(group) {
  const layout = _disksBuildPhysicalDriveLayout(group.items);
  return `
    <section class="disks-group disks-group--physical">
      <div class="disks-group__header">
        <h3>${_disksEsc(group.name)}</h3>
        <span>${group.items.length} item${group.items.length === 1 ? '' : 's'}</span>
      </div>
      <div class="disks-physical-layout">
        ${layout.multiPools.length ? `
          <div class="disks-cluster-shelf">
            ${layout.multiPools.map(_disksPoolClusterHtml).join('')}
          </div>
        ` : ''}
        ${layout.pooledSingles.length ? `
          <div class="disks-card-grid">
            ${layout.pooledSingles.map(groupEntry => _disksCardHtml(groupEntry.items[0].node, {
              poolName: groupEntry.pool,
              poolColor: groupEntry.color,
              pooledSingle: true,
            })).join('')}
          </div>
        ` : ''}
        ${layout.unpooled.length ? `
          <div class="disks-card-grid">
            ${layout.unpooled.map(entry => _disksCardHtml(entry.node)).join('')}
          </div>
        ` : ''}
      </div>
    </section>
  `;
}

function _disksCardHtml(node, options = {}) {
  const pct = _disksUsagePct(node);
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const cta = hasChildren ? 'Open' : 'View';
  const tone = _disksStatusTone(node.status);
  const showSubtitle = !!node.subtitle && node.kind !== 'drive';
  const classes = [
    'disks-card',
    `disks-card--${_disksEsc(_disksStatusTone(node.status))}`,
  ];
  if (node.smart) classes.push('disks-card--has-smart');
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
    ? `<div class="disks-card__pool-caption">ZFS · ${_disksEsc(options.poolName)}</div>`
    : '';
  return `
    <article class="${classes.join(' ')}" ${attrs.join(' ')}${styleAttr}>
      <div class="disks-card__actions">
        <span class="disks-pill disks-pill--${_disksEsc(tone)}">${_disksEsc(node.status || 'info')}</span>
        ${node.smart ? `<button type="button" class="disks-card__smart" data-disks-smart-host="${_disksEsc(node.smart.host)}" data-disks-smart-device="${_disksEsc(node.smart.device_path)}">S.M.A.R.T.</button>` : ''}
      </div>
      <button type="button" class="disks-card__main" data-disks-node="${_disksEsc(node.id)}">
        <div class="disks-card__header">
          <img class="disks-card__icon" src="${_disksNodeIcon(node)}" alt="" />
          <div class="disks-card__text">
            <div class="disks-card__title-row">
              <strong class="disks-card__title">${_disksEsc(node.label)}</strong>
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
        ${_disksFactsHtml(node.facts, 5)}
        <div class="disks-card__footer">
          <span>${cta}</span>
          ${hasChildren ? `<span>${node.children.length} item${node.children.length === 1 ? '' : 's'}</span>` : '<span>Details</span>'}
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
      return _disksPhysicalDriveGroupHtml(group);
    }
    return `
      <section class="disks-group">
        <div class="disks-group__header">
          <h3>${_disksEsc(group.name)}</h3>
          <span>${group.items.length} item${group.items.length === 1 ? '' : 's'}</span>
        </div>
        <div class="disks-card-grid">
          ${group.items.map(_disksCardHtml).join('')}
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
  _disksScheduleLayoutPass();
}

function _disksClusterGapPx(grid) {
  const styles = window.getComputedStyle(grid);
  const value = Number.parseFloat(styles.columnGap || styles.gap || '0');
  return Number.isFinite(value) ? value : 0;
}

function _disksBestClusterColumns(cardCount, maxColumns) {
  const limit = Math.max(1, Math.min(cardCount, maxColumns));
  let bestColumns = 1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let columns = 1; columns <= limit; columns += 1) {
    const rows = Math.ceil(cardCount / columns);
    const perimeter = (rows * 2) + (columns * 2);
    const waste = (rows * columns) - cardCount;
    const score = (perimeter * 100) + (waste * 20);
    if (score < bestScore || (score === bestScore && columns > bestColumns)) {
      bestScore = score;
      bestColumns = columns;
    }
  }
  return bestColumns;
}

function _disksSetClusterEdges(card, sides) {
  const main = card.querySelector('.disks-card__main');
  if (!main) return;
  ['top', 'right', 'bottom', 'left'].forEach(side => {
    main.style.setProperty(`--disks-cluster-${side}`, sides.includes(side) ? '2px' : '0px');
  });
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
  let layoutChanged = false;
  shell.querySelectorAll('[data-disks-cluster-grid]').forEach(grid => {
    const cards = grid.querySelectorAll(':scope > .disks-card');
    if (!cards.length) return;
    const width = grid.clientWidth || grid.getBoundingClientRect().width;
    const gap = _disksClusterGapPx(grid);
    const maxColumns = Math.max(1, Math.floor((width + gap) / (_DISKS_CLUSTER_MIN_CARD_WIDTH + gap)));
    const columns = _disksBestClusterColumns(cards.length, maxColumns);
    if (grid.style.getPropertyValue('--disks-cluster-columns') !== String(columns)) {
      grid.style.setProperty('--disks-cluster-columns', String(columns));
      layoutChanged = true;
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

function _disksSmartSummaryFacts(body) {
  const facts = [];
  const add = (label, value) => {
    const text = String(value ?? '').trim();
    if (!text || text === 'undefined') return;
    facts.push({ label, value: text });
  };
  add('Model', body?.model_name || body?.device?.model_name || body?.device?.name);
  add('Serial', body?.serial_number || body?.device?.serial_number);
  if (body?.smart_status && Object.prototype.hasOwnProperty.call(body.smart_status, 'passed')) {
    add('Passed', body.smart_status.passed ? 'yes' : 'no');
  }
  add('Temperature', body?.temperature?.current ? `${body.temperature.current}°C` : '');
  add('Power-on hours', body?.power_on_time?.hours);
  add('Percentage used', body?.nvme_smart_health_information_log?.percentage_used != null
    ? `${body.nvme_smart_health_information_log.percentage_used}%`
    : '');
  add('Media errors', body?.nvme_smart_health_information_log?.media_errors);
  add('Critical warning', body?.nvme_smart_health_information_log?.critical_warning);
  return facts;
}

async function _disksOpenSmart(host, devicePath) {
  const dialog = _disksEl('disks-smart-modal');
  const title = _disksEl('disks-smart-title');
  const subtitle = _disksEl('disks-smart-subtitle');
  const summary = _disksEl('disks-smart-summary');
  const jsonEl = _disksEl('disks-smart-json');
  const errEl = _disksEl('disks-smart-error');
  if (!dialog || !title || !subtitle || !summary || !jsonEl || !errEl) return;

  title.textContent = 'Drive health';
  subtitle.textContent = `${host} · ${devicePath}`;
  summary.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Loading S.M.A.R.T…</span>';
  jsonEl.textContent = '';
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
    const facts = _disksSmartSummaryFacts(body);
    summary.innerHTML = facts.length
      ? facts.map(fact => `<div class="disks-smart-summary__item"><span>${_disksEsc(fact.label)}</span><strong>${_disksEsc(fact.value)}</strong></div>`).join('')
      : '<div class="disks-smart-summary__item"><span>Status</span><strong>No compact summary available</strong></div>';
    jsonEl.textContent = JSON.stringify(body, null, 2);
  } catch (err) {
    const message = err && err.message ? err.message : String(err || 'S.M.A.R.T. failed');
    summary.innerHTML = '';
    jsonEl.textContent = '';
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
  const smartBtn = event.target.closest('[data-disks-smart-host]');
  if (smartBtn) {
    event.preventDefault();
    _disksOpenSmart(smartBtn.dataset.disksSmartHost || '', smartBtn.dataset.disksSmartDevice || '');
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
