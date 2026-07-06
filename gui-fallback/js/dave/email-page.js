// Dave Email page - read-only PIM email mailbox view.

'use strict';

const EmailPage = (() => {
  const API_ROOT = '/api/v1/personal/email';
  const ULTRAWIDE_QUERY = '(min-width: 2400px) and (max-height: 1280px)';
  const VIEW_IDS = ['plain', 'html', 'markdown', 'raw'];
  const MESSAGE_LIST_LIMIT = 100;
  const MESSAGE_PREFETCH_AHEAD = 100;
  const MESSAGE_SCROLL_LOAD_PX = 320;
  const MESSAGE_WARM_LIMIT = 100;
  const MESSAGE_OPEN_CACHE_LIMIT = 240;
  const MESSAGE_OPEN_CACHE_MAX_BYTES = 192 * 1024 * 1024;
  const MESSAGE_OPEN_CACHE_OPENED_BONUS_MS = 2 * 60 * 60 * 1000;
  const MESSAGE_OPEN_PREFETCH_LIMIT = 100;
  const MESSAGE_OPEN_PREFETCH_QUEUE_LIMIT = 240;
  const MESSAGE_OPEN_PREFETCH_CONCURRENCY = 8;
  const MESSAGE_IMAGE_PREFETCH_CONCURRENCY = 2;
  const MESSAGE_IMAGE_CACHE_LIMIT = 24;
  const MESSAGE_IMAGE_CACHE_SOURCE_LIMIT = 120;
  const MESSAGE_IMAGE_CACHE_MAX_BYTES = 64 * 1024 * 1024;
  const MESSAGE_IMAGE_CACHE_CONCURRENCY = 4;
  const MESSAGE_CONTEXT_MENU_ID = 'email-message-context-menu';
  const MESSAGE_CONTEXT_LONG_PRESS_MS = 420;
  const MESSAGE_CONTEXT_MOVE_PX = 10;
  const HEALTH_POLL_MS = 5000;
  const CACHE_STATUS_POLL_MS = 5000;
  const SECURITY_PROGRESS_EVENT = 'pim.email.security.progress';
  const SECURITY_SEGMENTS = [
    ['service', 'Svc'],
    ['parse', 'Parse'],
    ['authres_provider', 'Auth'],
    ['dkim_crypto', 'DKIM'],
    ['spf_protocol', 'SPF'],
    ['dmarc_policy', 'DMARC'],
    ['llm_input', 'Input'],
    ['llm_json', 'JSON'],
    ['llm_judgement', 'AI'],
    ['aggregate', 'All'],
  ];

  const state = {
    loaded: false,
    loading: false,
    error: '',
    status: null,
    health: null,
    localCorpus: null,
    readSource: 'local',
    mailbox: null,
    folders: [],
    messages: [],
    messageListOffset: 0,
    messageListTotal: null,
    messagesHasMore: false,
    messagesLoadingMore: false,
    messagePrefetchPage: null,
    messagePrefetchPromise: null,
    messagePrefetchFolder: '',
    messagePrefetchOffset: 0,
    messagePrefetchError: '',
    messageWarmSeen: new Set(),
    messageOpenCache: new Map(),
    messageOpenCacheBytes: 0,
    messageOpenPrefetchSeen: new Set(),
    messageOpenPrefetchQueue: [],
    messageOpenPrefetchInFlight: 0,
    messageOpenPrefetchStarted: 0,
    messageOpenPrefetchCompleted: 0,
    messageOpenPrefetchFailed: 0,
    messageOpenPrefetchSkipped: 0,
    messageOpenPrefetchLastError: '',
    messageOpenPrefetchLastUid: '',
    messageOpenPrefetchControllers: new Set(),
    messageOpenPrefetchPausedUntil: 0,
    messageImagePrefetchSeen: new Set(),
    messageImagePrefetchQueue: [],
    messageImagePrefetchInFlight: 0,
    messageImagePrefetchCompleted: 0,
    messageImagePrefetchFailed: 0,
    messageImagePrefetchSkipped: 0,
    messageImageCache: new Map(),
    messageImageCacheBytes: 0,
    messageOpenCacheHit: false,
    messageOpenSeq: 0,
    messagePendingUid: '',
    messageTimings: [],
    lastMessageTiming: null,
    cacheStatus: null,
    cacheStatusError: '',
    cacheStatusLoading: false,
    cacheStatusLastRefreshed: 0,
    cacheStatusPollTimer: null,
    serviceWorkerImageCacheCount: null,
    messageListSignature: '',
    messageListScrollPending: false,
    message: null,
    folder: 'INBOX',
    folderLoading: false,
    view: 'plain',
    secondaryTab: 'folders',
    listCollapsed: false,
    folderSet: 'system',
    folderGroup: '',
    expandedFolderKeys: new Set(),
    folderLoadSeq: 0,
    securityProgress: null,
    messageContextMenuOpen: false,
    healthPollTimer: null,
  };

  const escHtml = typeof esc === 'function'
    ? esc
    : value => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[ch]));

  let messageContextPointerHandler = null;
  let messageContextKeyHandler = null;

  function el(id) {
    return document.getElementById(id);
  }

  function fetcher() {
    return typeof apiFetch === 'function' ? apiFetch : fetch;
  }

  async function fetchJson(url, options = {}) {
    const resp = await fetcher()(url, options);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(errorMessageFromPayload(data, `HTTP ${resp.status}`));
    return data;
  }

  function errorMessageFromPayload(data, fallback) {
    const detail = data?.detail;
    if (typeof detail === 'string') return detail;
    if (detail && typeof detail === 'object') {
      return detail.message || detail.detail || detail.code || JSON.stringify(detail);
    }
    return data?.message || data?.error || fallback;
  }

  function setStatus(text, tone = 'unknown') {
    state.securityProgress = null;
    const strip = el('email-status-strip');
    if (!strip) return;
    const cleanTone = ['ok', 'warn', 'err', 'unknown'].includes(tone) ? tone : 'unknown';
    strip.innerHTML = `
      <span class="email-status-dot email-status-dot--${cleanTone}" aria-hidden="true"></span>
      <span class="email-status-text">${escHtml(text || '')}</span>
    `;
  }

  function securityRunId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `email-security-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function baseSecuritySegments(tone = 'pending', status = 'pending') {
    return SECURITY_SEGMENTS.map(([id, label]) => ({ id, label, tone, status, finding_codes: [] }));
  }

  function normalizeSecuritySegment(segment) {
    const id = String(segment?.id || '').trim();
    const fallback = SECURITY_SEGMENTS.find(([item]) => item === id) || [id, id || '?'];
    const tone = String(segment?.tone || '').toLowerCase();
    const status = String(segment?.status || '').toLowerCase();
    return {
      id: fallback[0],
      label: String(segment?.label || fallback[1]),
      tone: ['pending', 'running', 'green', 'amber', 'red'].includes(tone) ? tone : 'pending',
      status: ['pending', 'running', 'complete', 'error'].includes(status) ? status : 'pending',
      finding_codes: Array.isArray(segment?.finding_codes) ? segment.finding_codes : [],
    };
  }

  function mergeSecuritySegments(current, incoming) {
    const byId = new Map((current?.length ? current : baseSecuritySegments()).map(item => [item.id, item]));
    (incoming || []).map(normalizeSecuritySegment).forEach(item => byId.set(item.id, item));
    return SECURITY_SEGMENTS.map(([id]) => byId.get(id) || normalizeSecuritySegment({ id }));
  }

  function renderSecurityProgressStrip() {
    const strip = el('email-status-strip');
    if (!strip || !state.securityProgress) return;
    const segments = mergeSecuritySegments([], state.securityProgress.segments || []);
    const active = segments.find(item => item.status === 'running');
    const complete = segments.filter(item => item.status === 'complete').length;
    const label = active
      ? `Email security checks running: ${active.label}`
      : `Email security checks: ${complete} of ${segments.length} complete`;
    strip.innerHTML = `
      <div class="email-security-meter" role="status" aria-live="polite" aria-label="${escHtml(label)}">
        ${segments.map(segment => `
          <span
            class="email-security-meter__segment"
            data-segment="${escHtml(segment.id)}"
            data-tone="${escHtml(segment.tone)}"
            data-status="${escHtml(segment.status)}"
            title="${escHtml(`${segment.label}: ${segment.status}${segment.finding_codes.length ? ` (${segment.finding_codes.join(', ')})` : ''}`)}"
            aria-label="${escHtml(`${segment.label}: ${segment.status}`)}"
          ></span>
        `).join('')}
      </div>
    `;
  }

  function beginSecurityProgress(runId, uid, folder) {
    state.securityProgress = {
      run_id: runId,
      uid: String(uid || ''),
      folder: String(folder || ''),
      segments: baseSecuritySegments(),
    };
    const first = state.securityProgress.segments[0];
    first.status = 'running';
    first.tone = 'running';
    renderSecurityProgressStrip();
  }

  function completeSecurityProgress(security) {
    const segments = security?.progress?.segments || securitySegmentsFromFindings(security);
    state.securityProgress = {
      run_id: security?.progress?.run_id || state.securityProgress?.run_id || '',
      uid: activeMessageUid(),
      folder: state.folder,
      segments: mergeSecuritySegments(state.securityProgress?.segments, segments),
    };
    renderSecurityProgressStrip();
  }

  function renderOpenedMessageSecurityProgress(message = state.message) {
    if (!message?.security?.available) return false;
    completeSecurityProgress(message.security);
    return true;
  }

  function securityToneFromFinding(finding) {
    const severity = securityToneName(finding?.severity);
    const status = securityToneName(finding?.status || finding?.result);
    if (severity === 'red' || status === 'red') return 'red';
    if (severity === 'amber' || status === 'amber') return 'amber';
    if (severity === 'green' || status === 'green' || severity === 'info' || status === 'info') return 'green';
    return '';
  }

  function segmentToneFromFindings(findings, fallback = 'amber') {
    let tone = '';
    findings.forEach(finding => {
      tone = strongerRawTone(tone, securityToneFromFinding(finding));
    });
    return tone || fallback;
  }

  function securitySegmentsFromFindings(security) {
    const findings = Array.isArray(security?.findings) ? security.findings : [];
    const byPrefix = prefix => findings.filter(item => String(item.code || '').startsWith(prefix));
    const byCodes = codes => findings.filter(item => codes.includes(String(item.code || '')));
    return [
      { id: 'service', label: 'Svc', status: 'complete', tone: security?.available ? 'green' : 'red' },
      { id: 'parse', label: 'Parse', status: 'complete', tone: 'green' },
      { id: 'authres_provider', label: 'Auth', status: 'complete', tone: segmentToneFromFindings(byPrefix('AUTHRES_')) },
      { id: 'dkim_crypto', label: 'DKIM', status: 'complete', tone: segmentToneFromFindings(byPrefix('DKIM_')) },
      { id: 'spf_protocol', label: 'SPF', status: 'complete', tone: segmentToneFromFindings(byPrefix('SPF_')) },
      { id: 'dmarc_policy', label: 'DMARC', status: 'complete', tone: segmentToneFromFindings(byPrefix('DMARC_')) },
      { id: 'llm_input', label: 'Input', status: 'complete', tone: segmentToneFromFindings(byCodes(['LLM_INPUT_SANITIZED', 'LLM_BODY_OVERSIZE']), 'green') },
      { id: 'llm_json', label: 'JSON', status: 'complete', tone: security?.llm?.valid_json ? 'green' : 'red' },
      { id: 'llm_judgement', label: 'AI', status: 'complete', tone: segmentToneFromFindings(byPrefix('LLM_SCAM_TRAITS_')) },
      { id: 'aggregate', label: 'All', status: 'complete', tone: String(security?.aggregate?.status || 'amber').toLowerCase() },
    ];
  }

  function handleSecurityProgressEvent(event) {
    const payload = event?.payload || event?.detail?.payload || {};
    if (!state.securityProgress || payload.run_id !== state.securityProgress.run_id) return;
    const incoming = Array.isArray(payload.segments)
      ? payload.segments
      : [{ id: payload.stage_id, label: payload.label, tone: payload.tone, status: payload.status, finding_codes: payload.finding_codes || [] }];
    state.securityProgress.segments = mergeSecuritySegments(state.securityProgress.segments, incoming);
    renderSecurityProgressStrip();
  }

  function securityAggregate() {
    return state.message?.security?.aggregate || {};
  }

  function messageViewsAvailable(message) {
    const available = message?.views_available || message?.view_availability || {};
    return (available && typeof available === 'object') ? available : {};
  }

  function defaultMessageView(message) {
    const aggregate = message?.security?.aggregate || {};
    if (String(aggregate.status || '').toLowerCase() !== 'green') return 'plain';
    const views = message?.views || {};
    const available = messageViewsAvailable(message);
    if (available.html !== false && String(views.html || '').trim()) return 'html';
    if (available.markdown === true && String(views.markdown || '').trim()) return 'markdown';
    return 'plain';
  }

  function securityTone(status) {
    return {
      green: 'ok',
      amber: 'warn',
      red: 'err',
    }[String(status || '').toLowerCase()] || 'unknown';
  }

  function applyMessageSecurityStatus() {
    const status = String(securityAggregate().status || '').toLowerCase();
    document.querySelectorAll('.email-message-panel').forEach(panel => {
      if (['red', 'amber', 'green'].includes(status)) {
        panel.dataset.emailSecurity = status;
      } else {
        delete panel.dataset.emailSecurity;
      }
    });
  }

  function mailboxAddress() {
    return state.mailbox?.email_address
      || state.status?.mailboxes?.[0]?.email_address
      || 'configured mailbox';
  }

  function folderName(folder) {
    return String(folder?.name || folder?.path || folder || '').trim();
  }

  function folderFlags(folder) {
    const role = String(folder?.special_use_role || '').trim();
    const count = Number(folder?.message_count || 0);
    const roleText = role ? `${role}, ` : '';
    return `${roleText}${count} local row${count === 1 ? '' : 's'}`;
  }

  function folderDelimiter(folder) {
    const raw = String(folder?.delimiter || '/').trim();
    return raw || '/';
  }

  function folderPathParts(folder) {
    const name = folderName(folder);
    if (!name) return [];
    const delimiter = folderDelimiter(folder);
    const parts = name.split(delimiter).map(part => part.trim()).filter(Boolean);
    if (parts.length > 1) return parts;
    if (delimiter !== '/' && name.includes('/')) {
      return name.split('/').map(part => part.trim()).filter(Boolean);
    }
    return [name];
  }

  function folderSortKey(value) {
    const clean = String(value || '').trim();
    if (clean.toUpperCase() === 'INBOX') return '0000';
    return clean.toLocaleLowerCase();
  }

  function folderInitial(value) {
    const clean = String(value || '').trim();
    const first = clean.match(/[A-Za-z0-9]/)?.[0] || '#';
    return /[0-9]/.test(first) ? '0-9' : first.toUpperCase();
  }

  function normalizedFolderLabel(value) {
    return String(value || '').trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function folderSystemKind(node) {
    const key = normalizedFolderLabel(node?.label || node?.path || '');
    if (!key) return '';
    if (key === 'inbox') return 'inbox';
    if (['archive', 'archives', 'archived'].includes(key)) return 'archive';
    if (['draft', 'drafts'].includes(key)) return 'drafts';
    if (['sent', 'sentmail', 'sentmessages', 'sentitems'].includes(key)) return 'sent';
    if (['rubbish', 'trash', 'bin', 'deleted', 'deleteditems', 'junk', 'spam'].includes(key)) return 'rubbish';
    return '';
  }

  function folderSetLabel(setId) {
    return {
      system: 'Special folders',
      az: 'A-Z folders',
      inbox: 'Inbox',
      archive: 'Archive',
      drafts: 'Drafts',
      sent: 'Sent',
      rubbish: 'Rubbish / Junk',
    }[setId] || 'Folders';
  }

  function folderNodeKey(path) {
    return String(path || '').toLocaleLowerCase();
  }

  function buildFolderTree() {
    const root = { children: [], childrenByName: new Map() };
    for (const folder of state.folders) {
      const parts = folderPathParts(folder);
      if (!parts.length) continue;
      const delimiter = folderDelimiter(folder);
      let current = root;
      let path = '';
      parts.forEach((part, index) => {
        path = path ? `${path}${delimiter}${part}` : part;
        const key = part.toLocaleLowerCase();
        let node = current.childrenByName.get(key);
        if (!node) {
          node = {
            label: part,
            path,
            key: folderNodeKey(path),
            folder: null,
            children: [],
            childrenByName: new Map(),
          };
          current.childrenByName.set(key, node);
          current.children.push(node);
        }
        if (index === parts.length - 1) {
          node.folder = folder;
          node.path = folderName(folder);
          node.key = folderNodeKey(node.path);
        }
        current = node;
      });
    }
    const sortNodes = nodes => nodes
      .sort((a, b) => folderSortKey(a.label).localeCompare(folderSortKey(b.label)))
      .map(node => {
        node.children = sortNodes(node.children || []);
        return node;
      });
    return sortNodes(root.children);
  }

  function rootForSet(roots, setId) {
    return roots.find(node => folderSystemKind(node) === setId) || null;
  }

  function nodesForFolderSet(roots, setId) {
    if (setId === 'system') return roots.filter(node => folderSystemKind(node));
    if (setId === 'az') return roots.filter(node => !folderSystemKind(node));
    const root = rootForSet(roots, setId);
    if (!root) return [];
    return root.children?.length ? root.children : [root];
  }

  function folderSetOptions(roots) {
    const options = [
      { id: 'system', label: folderSetLabel('system'), count: nodesForFolderSet(roots, 'system').length },
      { id: 'az', label: folderSetLabel('az'), count: nodesForFolderSet(roots, 'az').length },
    ];
    ['inbox', 'archive', 'drafts', 'sent', 'rubbish'].forEach(setId => {
      const count = nodesForFolderSet(roots, setId).length;
      if (count) options.push({ id: setId, label: folderSetLabel(setId), count });
    });
    return options.filter(option => option.count > 0);
  }

  function exclusiveFolderGroups(nodes) {
    if (!nodes.length) return [];
    const buckets = [];
    for (const node of nodes) {
      const initial = folderInitial(node.label);
      let bucket = buckets[buckets.length - 1];
      if (!bucket || bucket.initial !== initial) {
        bucket = { initial, nodes: [] };
        buckets.push(bucket);
      }
      bucket.nodes.push(node);
    }
    const targetGroupCount = Math.min(6, Math.max(1, Math.ceil(nodes.length / 12)));
    const targetSize = Math.max(1, Math.ceil(nodes.length / targetGroupCount));
    const groups = [];
    let current = [];
    for (const bucket of buckets) {
      const currentCount = current.reduce((sum, item) => sum + item.nodes.length, 0);
      if (current.length && currentCount >= targetSize) {
        groups.push(current);
        current = [];
      }
      current.push(bucket);
    }
    if (current.length) groups.push(current);
    return groups.map((bucketGroup, index) => {
      const first = bucketGroup[0].initial;
      const last = bucketGroup[bucketGroup.length - 1].initial;
      const label = first === last ? first : `${first}-${last}`;
      return {
        key: `${first}:${last}:${index}`,
        label,
        nodes: bucketGroup.flatMap(bucket => bucket.nodes),
      };
    });
  }

  function distributeFolderColumns(nodes, columnCount = 3) {
    const target = Math.max(1, Math.ceil(nodes.length / columnCount));
    return Array.from({ length: columnCount }, (_, index) => (
      nodes.slice(index * target, index * target + target)
    ));
  }

  function selectedFolderView() {
    const roots = buildFolderTree();
    const options = folderSetOptions(roots);
    if (!options.some(option => option.id === state.folderSet)) {
      state.folderSet = options[0]?.id || 'system';
      state.folderGroup = '';
    }
    const nodes = nodesForFolderSet(roots, state.folderSet);
    const groups = state.folderSet === 'system'
      ? [{ key: 'all', label: 'All', nodes }]
      : exclusiveFolderGroups(nodes);
    if (!groups.some(group => group.key === state.folderGroup)) {
      state.folderGroup = groups[0]?.key || '';
    }
    const selectedGroup = groups.find(group => group.key === state.folderGroup) || groups[0] || { nodes: [], label: '' };
    return {
      options,
      groups,
      selectedGroup,
      columns: distributeFolderColumns(selectedGroup.nodes || []),
    };
  }

  function folderNodeHtml(node, depth = 0) {
    const children = Array.isArray(node.children) ? node.children : [];
    const hasChildren = children.length > 0;
    const selectable = Boolean(node.folder);
    const collapsed = hasChildren && !state.expandedFolderKeys.has(node.key);
    const active = String(node.path || '').toUpperCase() === String(state.folder || 'INBOX').toUpperCase();
    const flags = node.folder ? folderFlags(node.folder) : `${children.length} folders`;
    const rowTitle = node.path || node.label;
    const childHtml = hasChildren && !collapsed
      ? `<div class="email-folder-tree-children" role="group">${children.map(child => folderNodeHtml(child, depth + 1)).join('')}</div>`
      : '';
    return `
      <div class="email-folder-tree-node" role="treeitem" aria-level="${depth + 1}"${hasChildren ? ` aria-expanded="${collapsed ? 'false' : 'true'}"` : ''}>
        <div class="docs-tree-row email-folder-tree-row" style="--email-folder-depth:${depth}" data-active="${active ? 'true' : 'false'}">
          <button class="email-folder-tree-toggle" type="button" data-email-folder-toggle="${escHtml(node.key)}" aria-label="${collapsed ? 'Expand' : 'Collapse'} ${escHtml(node.label)}"${hasChildren ? '' : ' disabled'}></button>
          <span class="docs-tree-icon docs-tree-icon--folder" aria-hidden="true"></span>
          <button class="docs-tree-name email-folder-tree-name" type="button"${selectable ? ` data-email-folder-name="${escHtml(node.path)}"` : ' disabled'} data-active="${active ? 'true' : 'false'}" title="${escHtml(rowTitle)}">
            <span>${escHtml(node.label)}</span>
            <span class="docs-tree-subpath">${escHtml(flags)}</span>
          </button>
        </div>
        ${childHtml}
      </div>
    `;
  }

  function folderControlsHtml(layout = 'folders') {
    const view = selectedFolderView();
    const activeSet = view.options.find(option => option.id === state.folderSet) || view.options[0];
    const activeGroup = view.groups.find(group => group.key === state.folderGroup) || view.groups[0];
    const setLabel = activeSet ? `${activeSet.label} (${activeSet.count})` : 'List';
    const groupLabel = activeGroup ? `${activeGroup.label} (${activeGroup.nodes.length})` : 'Group';
    return `
      <div class="email-folder-browser-controls" data-email-folder-controls="${escHtml(layout)}">
        <div class="email-folder-tab-dropdown" data-email-folder-dropdown="set">
          <div class="email-folder-tab-split">
            <button class="email-folder-tab email-folder-tab--primary" type="button" aria-haspopup="menu" aria-expanded="false" data-email-folder-menu-toggle="set">${escHtml(setLabel)}</button>
            <button class="email-folder-tab-caret" type="button" aria-label="Choose folder list" aria-haspopup="menu" aria-expanded="false" data-email-folder-menu-toggle="set">
              <span class="menu-editor-icon menu-editor-icon--chevron-down" aria-hidden="true"></span>
            </button>
          </div>
          <div class="email-folder-tab-menu" role="menu">
            ${view.options.map(option => `
              <button class="email-folder-tab-menu__item" type="button" role="menuitemradio" aria-checked="${option.id === state.folderSet ? 'true' : 'false'}" data-email-folder-set-option="${escHtml(option.id)}">${escHtml(option.label)} (${option.count})</button>
            `).join('')}
          </div>
        </div>
        <div class="email-folder-tab-dropdown${view.groups.length <= 1 ? ' is-disabled' : ''}" data-email-folder-dropdown="group">
          <div class="email-folder-tab-split">
            <button class="email-folder-tab email-folder-tab--primary" type="button" aria-haspopup="menu" aria-expanded="false" data-email-folder-menu-toggle="group"${view.groups.length <= 1 ? ' disabled' : ''}>${escHtml(groupLabel)}</button>
            <button class="email-folder-tab-caret" type="button" aria-label="Choose folder group" aria-haspopup="menu" aria-expanded="false" data-email-folder-menu-toggle="group"${view.groups.length <= 1 ? ' disabled' : ''}>
              <span class="menu-editor-icon menu-editor-icon--chevron-down" aria-hidden="true"></span>
            </button>
          </div>
          <div class="email-folder-tab-menu" role="menu">
            ${view.groups.map(group => `
              <button class="email-folder-tab-menu__item" type="button" role="menuitemradio" aria-checked="${group.key === state.folderGroup ? 'true' : 'false'}" data-email-folder-group-option="${escHtml(group.key)}">${escHtml(group.label)} (${group.nodes.length})</button>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function foldersTreeHtml() {
    if (!state.folders.length) return '<div class="email-empty">No folders loaded.</div>';
    const view = selectedFolderView();
    return `
      <div class="email-folder-group-summary">
        <span>${escHtml(folderSetLabel(state.folderSet))}</span>
        <span>${escHtml(view.selectedGroup.label || 'All')}</span>
        <span>${view.selectedGroup.nodes.length} folders</span>
      </div>
      <div class="email-folder-tree email-folder-tree--columns" role="tree" aria-label="Email folders">
        ${view.columns.map((column, index) => `
          <section class="email-folder-column" aria-label="Folder column ${index + 1}">
            ${column.map(node => folderNodeHtml(node)).join('') || '<div class="email-empty">No folders in this column.</div>'}
          </section>
        `).join('')}
      </div>
    `;
  }

  function activeMessageUid() {
    return String(state.messagePendingUid || state.message?.email_uid || state.message?.uid || '');
  }

  function localCorpusAvailable() {
    return true;
  }

  function folderEndpoint() {
    return `${API_ROOT}/local/folders`;
  }

  function folderMessagesEndpoint(folder, options = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit || MESSAGE_LIST_LIMIT), 200));
    const offset = Math.max(0, Number(options.offset || 0));
    return `${API_ROOT}/local/folder-messages?folder=${encodeURIComponent(folder)}&limit=${limit}&offset=${offset}`;
  }

  function cacheWarmEndpoint() {
    return `${API_ROOT}/local/cache/warm`;
  }

  function cacheStatusEndpoint() {
    return `${API_ROOT}/local/cache/status`;
  }

  function messageEndpoint(uid, row = null) {
    const emailUid = String(row?.email_uid || uid || '').trim();
    return `${API_ROOT}/local/messages/${encodeURIComponent(emailUid)}`;
  }

  function forceRefreshEndpoint(uid) {
    return `${API_ROOT}/local/messages/${encodeURIComponent(uid)}/force-refresh`;
  }

  function renderMeta() {
    const meta = el('email-meta');
    if (!meta) return;
    if (state.error) {
      meta.textContent = 'Email middleware unavailable';
      return;
    }
    const folderCount = state.folders.length;
    const rowCount = state.messages.length;
    const source = 'local corpus';
    meta.textContent = `${mailboxAddress()} - ${source} - ${folderCount} folders - ${rowCount} ${state.folder || 'INBOX'} rows`;
  }

  function renderFolderChip() {
    const chip = el('email-folder-chip');
    if (chip) chip.textContent = `Folder: ${state.folder || 'INBOX'}`;
  }

  function healthTone() {
    const status = String(state.health?.status || '').toLowerCase();
    if (status === 'red') return 'red';
    if (downloadHealthActivity()) return 'green';
    if (status === 'amber') return 'amber';
    if (status === 'green') return 'amber';
    return 'unknown';
  }

  function downloadHealthActivity() {
    const download = state.health?.download || {};
    return Boolean(
      Number(download.running || 0) > 0
      || download.activity
      || download.recent_activity
    );
  }

  function healthHeartbeatActive() {
    const status = String(state.health?.status || '').toLowerCase();
    if (status === 'red') return false;
    return Boolean(state.health?.healthy || state.health?.activity || downloadHealthActivity());
  }

  function healthHeartbeatLabel() {
    const health = state.health || {};
    const status = health.status || 'pending';
    const issues = Array.isArray(health.issues) ? health.issues.length : 0;
    const warnings = Array.isArray(health.warnings) ? health.warnings.length : 0;
    const download = health.download || {};
    const active = downloadHealthActivity()
      ? 'checking downloads'
      : (health.activity ? 'background active' : 'healthy');
    if (issues) return `PIM Email ${status}, ${issues} issue${issues === 1 ? '' : 's'}, ${active}`;
    if (warnings) return `PIM Email ${status}, ${warnings} warning${warnings === 1 ? '' : 's'}, ${active}`;
    if (downloadHealthActivity()) {
      const running = Number(download.running || 0);
      return `PIM Email checking downloads${running ? `, ${running} run${running === 1 ? '' : 's'} active` : ''}`;
    }
    return `PIM Email ${status}, ${active}`;
  }

  function healthHeartbeatHtml() {
    const tone = healthTone();
    const beating = healthHeartbeatActive() ? ' email-health-heartbeat--beating' : '';
    const label = healthHeartbeatLabel();
    return `<span class="email-health-heartbeat email-health-heartbeat--${escHtml(tone)}${beating}" role="img" aria-label="${escHtml(label)}" title="${escHtml(label)}">&#9829;</span>`;
  }

  function renderViewTabs() {
    document.querySelectorAll('[data-email-view-button]').forEach(button => {
      const view = button.dataset.emailViewButton || '';
      button.dataset.active = view === state.view ? 'true' : 'false';
      button.disabled = false;
      button.title = '';
    });
  }

  function syncListCollapsed() {
    const tab = el('tab-email');
    if (tab) tab.classList.toggle('email-list-collapsed', state.listCollapsed);
    document.querySelectorAll('[data-email-list-toggle]').forEach(button => {
      const expanded = !state.listCollapsed;
      button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      button.setAttribute('title', expanded ? 'Collapse message list' : 'Expand message list');
      button.setAttribute('aria-label', expanded ? 'Collapse message list' : 'Expand message list');
      button.dataset.collapsed = state.listCollapsed ? 'true' : 'false';
    });
  }

  function foldersHtml() {
    return foldersTreeHtml();
  }

  function renderFolders() {
    const host = el('email-folder-list');
    if (host) host.innerHTML = foldersHtml();
  }

  function renderFolderControls() {
    document.querySelectorAll('[data-email-folder-controls-host]').forEach(host => {
      const layout = host.dataset.emailFolderControlsHost || 'folders';
      const show = state.folders.length > 0;
      host.innerHTML = show ? folderControlsHtml(layout) : '';
    });
  }

  function closeFolderMenus(except = null) {
    document.querySelectorAll('[data-email-folder-dropdown].open').forEach(dropdown => {
      if (except && dropdown === except) return;
      dropdown.classList.remove('open');
      dropdown.querySelectorAll('[data-email-folder-menu-toggle]').forEach(button => {
        button.setAttribute('aria-expanded', 'false');
      });
    });
  }

  function toggleFolderMenu(button) {
    const dropdown = button?.closest?.('[data-email-folder-dropdown]');
    if (!dropdown || dropdown.classList.contains('is-disabled') || button.disabled) return false;
    const nextOpen = !dropdown.classList.contains('open');
    closeFolderMenus(dropdown);
    dropdown.classList.toggle('open', nextOpen);
    dropdown.querySelectorAll('[data-email-folder-menu-toggle]').forEach(toggle => {
      toggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    });
    return true;
  }

  function messageIdentity(row) {
    return String(row?.email_uid || row?.uid || '').trim();
  }

  function messageListSignature(rows) {
    return (rows || []).map(row => [
      messageIdentity(row),
      row?.raw_sha256 || '',
      row?.date || row?.date_header || '',
      row?.subject || '',
      row?.from || row?.from_addr || '',
    ].join(':')).join('|');
  }

  function clearMessagePrefetch() {
    state.messagePrefetchPage = null;
    state.messagePrefetchPromise = null;
    state.messagePrefetchFolder = '';
    state.messagePrefetchOffset = 0;
    state.messagePrefetchError = '';
  }

  function messagePrefetchMatches(folder, offset) {
    return state.messagePrefetchFolder === folder
      && Number(state.messagePrefetchOffset) === Number(offset);
  }

  function resetMessagePrefetchQueues() {
    state.messageOpenPrefetchSeen = new Set();
    state.messageOpenPrefetchQueue = [];
    state.messageOpenPrefetchInFlight = 0;
    state.messageOpenPrefetchStarted = 0;
    state.messageOpenPrefetchCompleted = 0;
    state.messageOpenPrefetchFailed = 0;
    state.messageOpenPrefetchSkipped = 0;
    state.messageOpenPrefetchLastError = '';
    state.messageOpenPrefetchLastUid = '';
    state.messageOpenPrefetchControllers.forEach(controller => {
      try {
        controller.abort();
      } catch (error) {}
    });
    state.messageOpenPrefetchControllers = new Set();
    state.messageOpenPrefetchPausedUntil = 0;
    state.messageImagePrefetchSeen = new Set();
    state.messageImagePrefetchQueue = [];
    state.messageImagePrefetchInFlight = 0;
    state.messageImagePrefetchCompleted = 0;
    state.messageImagePrefetchFailed = 0;
    state.messageImagePrefetchSkipped = 0;
  }

  function warmMessageArtifacts(rows) {
    const uids = [];
    (rows || []).forEach(row => {
      if (uids.length >= MESSAGE_WARM_LIMIT) return;
      const uid = String(row?.email_uid || '').trim();
      if (!uid || state.messageWarmSeen.has(uid)) return;
      state.messageWarmSeen.add(uid);
      uids.push(uid);
    });
    if (!uids.length) return;
    const batch = uids;
    const runWarm = () => {
      fetchJson(cacheWarmEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email_uids: batch, limit: batch.length }),
      }).catch(() => {
        // Background warm misses must never affect list scrolling or message opening.
      });
    };
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(runWarm, { timeout: 2500 });
    } else {
      window.setTimeout(runWarm, 300);
    }
  }

  function notifyCacheStateChanged() {
    if (state.secondaryTab !== 'cache') return;
    renderSecondaryPanels();
    renderUltrawide();
  }

  function estimateOpenedMessageBytes(message) {
    if (!message) return 0;
    try {
      return new Blob([JSON.stringify(message)]).size;
    } catch (error) {
      const views = message.views || {};
      return [
        views.plain,
        views.html,
        views.markdown,
        views.raw,
        message.raw_sha256,
        message.email_uid,
      ].reduce((total, value) => total + String(value || '').length, 0);
    }
  }

  function messageOpenCacheScore(entry, now) {
    const lastUsed = Number(entry?.lastUsed || 0);
    const lastOpened = Number(entry?.lastOpened || 0);
    if (lastOpened && now - lastOpened < MESSAGE_OPEN_CACHE_OPENED_BONUS_MS) {
      return lastUsed + MESSAGE_OPEN_CACHE_OPENED_BONUS_MS;
    }
    return lastUsed;
  }

  function evictOpenedMessageCache() {
    const now = performance.now();
    while (
      state.messageOpenCache.size > MESSAGE_OPEN_CACHE_LIMIT
      || state.messageOpenCacheBytes > MESSAGE_OPEN_CACHE_MAX_BYTES
    ) {
      let evictKey = '';
      let evictScore = Infinity;
      state.messageOpenCache.forEach((entry, key) => {
        const score = messageOpenCacheScore(entry, now);
        if (score < evictScore) {
          evictScore = score;
          evictKey = key;
        }
      });
      if (!evictKey) break;
      const removed = state.messageOpenCache.get(evictKey);
      state.messageOpenCache.delete(evictKey);
      state.messageOpenCacheBytes = Math.max(
        0,
        state.messageOpenCacheBytes - Number(removed?.bytes || 0),
      );
      invalidateMessageImageCache(evictKey);
    }
  }

  function cacheOpenedMessage(emailUid, row, message, options = {}) {
    const uid = String(emailUid || message?.email_uid || '').trim();
    if (!uid || !message) return false;
    const bytes = estimateOpenedMessageBytes(message);
    if (bytes > MESSAGE_OPEN_CACHE_MAX_BYTES) return false;
    const existing = state.messageOpenCache.get(uid);
    if (existing) {
      state.messageOpenCacheBytes = Math.max(
        0,
        state.messageOpenCacheBytes - Number(existing.bytes || 0),
      );
    }
    const now = performance.now();
    const opened = options.opened !== false;
    state.messageOpenCache.set(uid, {
      message,
      rawSha: messageRawSha(message, row),
      bytes,
      lastUsed: now,
      lastOpened: opened ? now : Number(existing?.lastOpened || 0),
    });
    state.messageOpenCacheBytes += bytes;
    evictOpenedMessageCache();
    notifyCacheStateChanged();
    return true;
  }

  function cachedOpenedMessage(emailUid, row, options = {}) {
    const uid = String(emailUid || '').trim();
    if (!uid) return null;
    const entry = state.messageOpenCache.get(uid);
    if (!entry) return null;
    const rowRawSha = String(row?.raw_sha256 || '').trim();
    if (rowRawSha && entry.rawSha && rowRawSha !== entry.rawSha) {
      state.messageOpenCacheBytes = Math.max(
        0,
        state.messageOpenCacheBytes - Number(entry.bytes || 0),
      );
      state.messageOpenCache.delete(uid);
      invalidateMessageImageCache(uid);
      notifyCacheStateChanged();
      return null;
    }
    const now = performance.now();
    entry.lastUsed = now;
    if (options.opened !== false) entry.lastOpened = now;
    return entry.message || null;
  }

  function enqueueMessageOpenPrefetch(rows, options = {}) {
    const seq = state.folderLoadSeq;
    const folder = state.folder || 'INBOX';
    const batch = [];
    (rows || []).forEach(row => {
      if (batch.length >= MESSAGE_OPEN_PREFETCH_LIMIT) return;
      const uid = String(row?.email_uid || '').trim();
      if (!uid || state.messageOpenPrefetchSeen.has(uid) || state.messageOpenCache.has(uid)) {
        return;
      }
      state.messageOpenPrefetchSeen.add(uid);
      batch.push({ uid, row, seq, folder });
    });
    if (!batch.length) return;
    if (options.priority === 'front') {
      state.messageOpenPrefetchQueue.unshift(...batch.reverse());
    } else {
      state.messageOpenPrefetchQueue.push(...batch);
    }
    if (state.messageOpenPrefetchQueue.length > MESSAGE_OPEN_PREFETCH_QUEUE_LIMIT) {
      state.messageOpenPrefetchQueue.splice(MESSAGE_OPEN_PREFETCH_QUEUE_LIMIT);
    }
    pumpMessageOpenPrefetch();
    notifyCacheStateChanged();
  }

  function pauseMessageOpenPrefetch(durationMs = 3500) {
    state.messageOpenPrefetchPausedUntil = Math.max(
      state.messageOpenPrefetchPausedUntil,
      performance.now() + durationMs,
    );
    state.messageOpenPrefetchControllers.forEach(controller => {
      try {
        controller.abort();
      } catch (error) {}
    });
    window.setTimeout(pumpMessageOpenPrefetch, durationMs + 25);
  }

  async function prefetchOpenedMessage(task) {
    if (!task || task.seq !== state.folderLoadSeq || task.folder !== state.folder) {
      state.messageOpenPrefetchSkipped += 1;
      return;
    }
    if (cachedOpenedMessage(task.uid, task.row, { opened: false })) {
      state.messageOpenPrefetchSkipped += 1;
      return;
    }
    const controller = new AbortController();
    task.controller = controller;
    state.messageOpenPrefetchControllers.add(controller);
    try {
      const data = await fetchJson(messageEndpoint(task.uid, task.row), {
        signal: controller.signal,
      });
      if (task.seq !== state.folderLoadSeq || task.folder !== state.folder) {
        state.messageOpenPrefetchSkipped += 1;
        return;
      }
      const message = data.message || null;
      if (!message) {
        state.messageOpenPrefetchSkipped += 1;
        return;
      }
      cacheOpenedMessage(task.uid, task.row, message, { opened: false });
      enqueueMessageImagePrefetch(message);
      state.messageOpenPrefetchCompleted += 1;
      state.messageOpenPrefetchLastUid = task.uid;
    } catch (error) {
      if (error?.name === 'AbortError') {
        if (task.seq === state.folderLoadSeq && task.folder === state.folder) {
          state.messageOpenPrefetchQueue.unshift(task);
        }
        return;
      }
      state.messageOpenPrefetchFailed += 1;
      state.messageOpenPrefetchLastError = error.message || String(error);
    } finally {
      state.messageOpenPrefetchControllers.delete(controller);
      notifyCacheStateChanged();
    }
  }

  function pumpMessageOpenPrefetch() {
    const pauseMs = state.messageOpenPrefetchPausedUntil - performance.now();
    if (pauseMs > 0) {
      window.setTimeout(pumpMessageOpenPrefetch, pauseMs + 25);
      return;
    }
    while (
      state.messageOpenPrefetchInFlight < MESSAGE_OPEN_PREFETCH_CONCURRENCY
      && state.messageOpenPrefetchQueue.length
    ) {
      const task = state.messageOpenPrefetchQueue.shift();
      state.messageOpenPrefetchInFlight += 1;
      state.messageOpenPrefetchStarted += 1;
      prefetchOpenedMessage(task).finally(() => {
        state.messageOpenPrefetchInFlight = Math.max(0, state.messageOpenPrefetchInFlight - 1);
        pumpMessageOpenPrefetch();
        pumpMessageImagePrefetch();
        notifyCacheStateChanged();
      });
    }
  }

  function enqueueMessageImagePrefetch(message) {
    const uid = String(message?.email_uid || '').trim();
    if (!uid || state.messageImagePrefetchSeen.has(uid)) return;
    state.messageImagePrefetchSeen.add(uid);
    state.messageImagePrefetchQueue.push(message);
    pumpMessageImagePrefetch();
  }

  async function prefetchMessageImages(message) {
    if (!message) {
      state.messageImagePrefetchSkipped += 1;
      return;
    }
    try {
      await ensureMessageImageCache(message);
      state.messageImagePrefetchCompleted += 1;
    } catch (error) {
      state.messageImagePrefetchFailed += 1;
    } finally {
      notifyCacheStateChanged();
    }
  }

  function pumpMessageImagePrefetch() {
    if (state.messageOpenPrefetchQueue.length || state.messageOpenPrefetchInFlight) return;
    while (
      state.messageImagePrefetchInFlight < MESSAGE_IMAGE_PREFETCH_CONCURRENCY
      && state.messageImagePrefetchQueue.length
    ) {
      const message = state.messageImagePrefetchQueue.shift();
      state.messageImagePrefetchInFlight += 1;
      prefetchMessageImages(message).finally(() => {
        state.messageImagePrefetchInFlight = Math.max(0, state.messageImagePrefetchInFlight - 1);
        pumpMessageImagePrefetch();
        notifyCacheStateChanged();
      });
    }
  }

  function scheduleMessagePagePrefetch() {
    if (!state.loaded || state.folderLoading || !state.messagesHasMore) return null;
    const folder = state.folder || 'INBOX';
    const offset = state.messageListOffset || state.messages.length;
    if (state.messagePrefetchPage && messagePrefetchMatches(folder, offset)) {
      return Promise.resolve(state.messagePrefetchPage.data);
    }
    if (state.messagePrefetchPromise && messagePrefetchMatches(folder, offset)) {
      return state.messagePrefetchPromise;
    }
    const seq = state.folderLoadSeq;
    state.messagePrefetchFolder = folder;
    state.messagePrefetchOffset = offset;
    state.messagePrefetchError = '';
    const promise = fetchJson(folderMessagesEndpoint(folder, {
      limit: MESSAGE_PREFETCH_AHEAD,
      offset,
    })).then(data => {
      if (seq !== state.folderLoadSeq || folder !== state.folder) return null;
      state.messagePrefetchPage = { folder, offset, data };
      state.messagePrefetchPromise = null;
      warmMessageArtifacts(data?.messages || []);
      enqueueMessageOpenPrefetch(data?.messages || []);
      renderMessageListChrome();
      return data;
    }).catch(error => {
      if (seq === state.folderLoadSeq && folder === state.folder) {
        state.messagePrefetchError = error.message || String(error);
        state.messagePrefetchPromise = null;
      }
      return null;
    });
    state.messagePrefetchPromise = promise;
    return promise;
  }

  function takePrefetchedMessagePage(folder, offset) {
    if (!state.messagePrefetchPage || !messagePrefetchMatches(folder, offset)) return null;
    const data = state.messagePrefetchPage.data;
    state.messagePrefetchPage = null;
    return data;
  }

  function messageRawSha(message, row = null) {
    return String(message?.raw_sha256 || message?.stored?.raw_sha256 || row?.raw_sha256 || '').trim();
  }

  function evictOldestMapEntry(map, limit, onEvict = null) {
    while (map.size > limit) {
      let oldestKey = '';
      let oldestSeen = Infinity;
      map.forEach((entry, key) => {
        const seen = Number(entry?.lastUsed || 0);
        if (seen < oldestSeen) {
          oldestSeen = seen;
          oldestKey = key;
        }
      });
      if (!oldestKey) break;
      const entry = map.get(oldestKey);
      map.delete(oldestKey);
      if (typeof onEvict === 'function') onEvict(entry);
    }
  }

  function revokeImageCacheEntry(entry) {
    (entry?.sources || new Map()).forEach(item => {
      if (item?.objectUrl) URL.revokeObjectURL(item.objectUrl);
    });
  }

  function dropMessageImageCacheEntry(uid) {
    const key = String(uid || '').trim();
    if (!key) return;
    const entry = state.messageImageCache.get(key);
    if (!entry) return;
    state.messageImageCacheBytes = Math.max(
      0,
      state.messageImageCacheBytes - Number(entry.bytes || 0),
    );
    revokeImageCacheEntry(entry);
    state.messageImageCache.delete(key);
  }

  function evictMessageImageCacheForBytes(neededBytes, keepUid = '') {
    const needed = Math.max(0, Number(neededBytes || 0));
    while (
      state.messageImageCache.size
      && state.messageImageCacheBytes + needed > MESSAGE_IMAGE_CACHE_MAX_BYTES
    ) {
      let oldestKey = '';
      let oldestSeen = Infinity;
      state.messageImageCache.forEach((entry, key) => {
        if (key === keepUid && state.messageImageCache.size > 1) return;
        const seen = Number(entry?.lastUsed || 0);
        if (seen < oldestSeen) {
          oldestSeen = seen;
          oldestKey = key;
        }
      });
      if (!oldestKey || oldestKey === keepUid) break;
      dropMessageImageCacheEntry(oldestKey);
    }
  }

  function invalidateMessageImageCache(emailUid) {
    const uid = String(emailUid || '').trim();
    dropMessageImageCacheEntry(uid);
    notifyCacheStateChanged();
  }

  function invalidateOpenedMessageCache(emailUid) {
    const uid = String(emailUid || '').trim();
    const entry = state.messageOpenCache.get(uid);
    if (entry) {
      state.messageOpenCacheBytes = Math.max(
        0,
        state.messageOpenCacheBytes - Number(entry.bytes || 0),
      );
    }
    state.messageOpenCache.delete(uid);
    invalidateMessageImageCache(uid);
  }

  function clearBrowserImageStorageCache(emailUid) {
    const uid = String(emailUid || '').trim();
    if (!uid || !navigator.serviceWorker) return;
    const payload = { type: 'BP_PIM_EMAIL_CLEAR_IMAGE_CACHE', email_uid: uid };
    try {
      navigator.serviceWorker.controller?.postMessage(payload);
    } catch (error) {}
    navigator.serviceWorker.ready
      .then(registration => {
        try {
          registration.active?.postMessage(payload);
        } catch (error) {}
      })
      .catch(() => {});
  }

  function localMessageImageUrl(src) {
    try {
      const url = new URL(String(src || ''), window.location.origin);
      if (url.pathname !== `${API_ROOT}/local/images` && !url.pathname.startsWith(`${API_ROOT}/local/images/`)) {
        return null;
      }
      return {
        absolute: url.href,
        key: `${url.pathname}${url.search}`,
      };
    } catch (error) {
      return null;
    }
  }

  function localImageSourcesFromHtml(value) {
    if (!value || typeof DOMParser === 'undefined') return [];
    const doc = new DOMParser().parseFromString(`<body>${value}</body>`, 'text/html');
    const seen = new Set();
    return Array.from(doc.images).map(img => localMessageImageUrl(img.getAttribute('src') || ''))
      .filter(Boolean)
      .filter(item => {
        if (seen.has(item.key)) return false;
        seen.add(item.key);
        return true;
      });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('image cache read failed'));
      reader.readAsDataURL(blob);
    });
  }

  async function decodeCachedImage(dataUrl) {
    const img = new Image();
    img.decoding = 'async';
    img.src = dataUrl;
    if (typeof img.decode === 'function') {
      try {
        await img.decode();
      } catch (error) {
        // Some browsers reject decode() after a usable load; keeping the Image still helps memory cache.
      }
    }
    return img;
  }

  function imageCacheEntryForMessage(message) {
    const uid = String(message?.email_uid || '').trim();
    const rawSha = messageRawSha(message);
    if (!uid) return null;
    let entry = state.messageImageCache.get(uid);
    if (!entry || (entry.rawSha && rawSha && entry.rawSha !== rawSha)) {
      if (entry) dropMessageImageCacheEntry(uid);
      entry = { rawSha, sources: new Map(), bytes: 0, pending: null, lastUsed: performance.now() };
      state.messageImageCache.set(uid, entry);
    }
    entry.rawSha = rawSha || entry.rawSha || '';
    entry.lastUsed = performance.now();
    evictOldestMapEntry(state.messageImageCache, MESSAGE_IMAGE_CACHE_LIMIT, removed => {
      state.messageImageCacheBytes = Math.max(
        0,
        state.messageImageCacheBytes - Number(removed?.bytes || 0),
      );
      revokeImageCacheEntry(removed);
    });
    return entry;
  }

  function ensureMessageImageCache(message) {
    const html = String(message?.views?.html || '');
    const uid = String(message?.email_uid || '').trim();
    if (!uid || !html) return null;
    const entry = imageCacheEntryForMessage(message);
    if (!entry) return null;
    if (entry.pending) return entry.pending;
    const sources = localImageSourcesFromHtml(html).slice(0, MESSAGE_IMAGE_CACHE_SOURCE_LIMIT);
    const missing = sources.filter(item => !entry.sources.has(item.key));
    if (!missing.length) return Promise.resolve(entry);
    const activeUid = uid;
    entry.pending = (async () => {
      let nextIndex = 0;
      async function warmNextImage() {
        while (nextIndex < missing.length) {
          const item = missing[nextIndex];
          nextIndex += 1;
          if (entry.bytes >= MESSAGE_IMAGE_CACHE_MAX_BYTES) return;
          if (entry.sources.has(item.key)) continue;
          try {
            const response = await fetcher()(item.absolute, {
              credentials: 'same-origin',
              cache: 'force-cache',
            });
            if (!response.ok) continue;
            const blob = await response.blob();
            if (!String(blob.type || '').startsWith('image/')) continue;
            if (blob.size > MESSAGE_IMAGE_CACHE_MAX_BYTES) continue;
            evictMessageImageCacheForBytes(blob.size, uid);
            if (state.messageImageCacheBytes + blob.size > MESSAGE_IMAGE_CACHE_MAX_BYTES) return;
            const dataUrl = await blobToDataUrl(blob);
            const image = await decodeCachedImage(dataUrl);
            entry.sources.set(item.key, { dataUrl, image, bytes: blob.size });
            entry.bytes += blob.size;
            state.messageImageCacheBytes += blob.size;
            notifyCacheStateChanged();
          } catch (error) {
            // Browser-side image cache is opportunistic; direct local image URLs remain the fallback.
          }
        }
      }
      const workers = Array.from(
        { length: Math.min(MESSAGE_IMAGE_CACHE_CONCURRENCY, missing.length) },
        () => warmNextImage(),
      );
      await Promise.all(workers);
      return entry;
    })().finally(() => {
      entry.pending = null;
      if (activeMessageUid() === activeUid && state.view === 'html') {
        renderMessage();
      }
    });
    return entry.pending;
  }

  function htmlWithCachedMessageImages(value, message) {
    if (!value || typeof DOMParser === 'undefined') return value;
    const entry = imageCacheEntryForMessage(message);
    if (!entry || !entry.sources.size) return value;
    const doc = new DOMParser().parseFromString(`<body>${value}</body>`, 'text/html');
    let changed = false;
    Array.from(doc.images).forEach(img => {
      const local = localMessageImageUrl(img.getAttribute('src') || '');
      if (!local) return;
      const cached = entry.sources.get(local.key);
      if (!cached?.dataUrl) return;
      img.setAttribute('src', cached.dataUrl);
      changed = true;
    });
    return changed ? doc.body.innerHTML : value;
  }

  function messageListAnchorFromHost(host) {
    if (!host) return null;
    const hostRect = host.getBoundingClientRect();
    const rows = Array.from(host.querySelectorAll('.email-message-row[data-email-message-email-uid]'));
    const visible = rows.find(row => row.getBoundingClientRect().bottom >= hostRect.top);
    if (!visible) return { scrollTop: host.scrollTop };
    return {
      uid: visible.dataset.emailMessageEmailUid || visible.dataset.emailMessageUid || '',
      delta: visible.getBoundingClientRect().top - hostRect.top,
      scrollTop: host.scrollTop,
    };
  }

  function captureMessageListAnchor() {
    return messageListAnchorFromHost(el('email-message-list'));
  }

  function restoreMessageListAnchor(anchor) {
    const host = el('email-message-list');
    if (!host || !anchor) return;
    if (anchor.uid) {
      const row = Array.from(host.querySelectorAll('.email-message-row')).find(item => (
        item.dataset.emailMessageEmailUid === anchor.uid
        || item.dataset.emailMessageUid === anchor.uid
      ));
      if (row) {
        const hostRect = host.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        host.scrollTop += rowRect.top - hostRect.top - Number(anchor.delta || 0);
        return;
      }
    }
    host.scrollTop = Number(anchor.scrollTop || 0);
  }

  function syncSelectedMessageRows() {
    const activeUid = activeMessageUid();
    document.querySelectorAll('#email-message-list .email-message-row').forEach(row => {
      const uid = row.dataset.emailMessageEmailUid || row.dataset.emailMessageUid || '';
      row.dataset.selected = uid && uid === activeUid ? 'true' : 'false';
    });
  }

  function applyMessageListResponse(data, { append = false, offset = 0 } = {}) {
    const incoming = Array.isArray(data?.messages) ? data.messages : [];
    if (append) {
      const seen = new Set(state.messages.map(messageIdentity));
      incoming.forEach(row => {
        const key = messageIdentity(row);
        if (!key || seen.has(key)) return;
        seen.add(key);
        state.messages.push(row);
      });
    } else {
      state.messages = incoming;
    }
    const loadedEnd = Number(data?.next_offset ?? (offset + incoming.length));
    state.messageListOffset = Number.isFinite(loadedEnd) ? Math.max(0, loadedEnd) : state.messages.length;
    state.messageListTotal = Number.isFinite(Number(data?.total)) ? Number(data.total) : null;
    state.messagesHasMore = Boolean(data?.has_more);
    state.messageListSignature = messageListSignature(state.messages);
    warmMessageArtifacts(incoming);
    enqueueMessageOpenPrefetch(incoming);
  }

  function renderMessageListChrome() {
    const count = el('email-inbox-count');
    if (count) {
      const total = state.messageListTotal;
      count.textContent = total && total > state.messages.length
        ? `${state.messages.length}/${total}`
        : String(state.messages.length);
    }
    const heading = el('email-inbox-heading');
    if (heading) {
      heading.innerHTML = `<span>${escHtml(state.folder || 'INBOX')}</span>${healthHeartbeatHtml()}`;
    }
    renderMeta();
  }

  function messageRowHtml(row) {
    const key = messageIdentity(row);
    const selected = key === activeMessageUid();
    return `
      <div class="email-message-row" data-email-message-uid="${escHtml(row.uid || '')}" data-email-message-email-uid="${escHtml(row.email_uid || '')}" data-selected="${selected ? 'true' : 'false'}" tabindex="0">
        <div>
          <div class="email-message-title">${escHtml(row.subject || '(no subject)')}</div>
          <div class="email-message-from">${escHtml(row.from || '')}</div>
          <div class="email-message-date">${escHtml(row.date || '')}</div>
        </div>
        <button class="email-row-btn email-row-btn--open" type="button" data-email-message-uid="${escHtml(row.uid || '')}" data-email-message-email-uid="${escHtml(row.email_uid || '')}" title="Open message" aria-label="Open message"></button>
      </div>
    `;
  }

  function messageListTailHtml() {
    if (state.messagesLoadingMore) {
      return '<div class="email-empty email-message-list-tail">Loading more messages.</div>';
    }
    if (state.messagePrefetchPage) {
      const rows = Array.isArray(state.messagePrefetchPage.data?.messages)
        ? state.messagePrefetchPage.data.messages.length
        : MESSAGE_PREFETCH_AHEAD;
      return `<div class="email-empty email-message-list-tail">${rows} more messages are ready below the loaded ${state.messages.length} rows.</div>`;
    }
    if (state.messagePrefetchPromise) {
      return `<div class="email-empty email-message-list-tail">Preparing more messages below the loaded ${state.messages.length} rows.</div>`;
    }
    if (state.messagesHasMore) {
      return `<div class="email-empty email-message-list-tail">More messages are cached below the loaded ${state.messages.length} rows.</div>`;
    }
    return '';
  }

  function renderMessages(options = {}) {
    renderMessageListChrome();
    const host = el('email-message-list');
    if (!host) return;
    const anchor = options.anchor || (options.preserveScroll ? captureMessageListAnchor() : null);
    if (state.folderLoading) {
      host.innerHTML = `<div class="email-empty">Loading last ${MESSAGE_LIST_LIMIT} messages for ${escHtml(state.folder || 'INBOX')}.</div>`;
      restoreMessageListAnchor(anchor);
      return;
    }
    host.innerHTML = state.messages.length
      ? `${state.messages.map(messageRowHtml).join('')}${messageListTailHtml()}`
      : `<div class="email-empty">No messages loaded for ${escHtml(state.folder || 'INBOX')}.</div>`;
    restoreMessageListAnchor(anchor);
  }

  function closeMessageContextMenu() {
    const existing = el(MESSAGE_CONTEXT_MENU_ID);
    if (existing) existing.remove();
    if (messageContextPointerHandler) {
      document.removeEventListener('pointerdown', messageContextPointerHandler, true);
      messageContextPointerHandler = null;
    }
    if (messageContextKeyHandler) {
      document.removeEventListener('keydown', messageContextKeyHandler, true);
      messageContextKeyHandler = null;
    }
    state.messageContextMenuOpen = false;
  }

  function positionMessageContextMenu(host, menu, anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    const viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
    const margin = 8;
    const menuW = menu.offsetWidth || 360;
    const menuH = menu.offsetHeight || 120;
    let left = Math.min(Math.max(margin, rect.right - menuW), Math.max(margin, viewportW - menuW - margin));
    let top = rect.bottom + 6;
    if (top + menuH + margin > viewportH) top = rect.top - menuH - 6;
    top = Math.min(Math.max(margin, top), Math.max(margin, viewportH - menuH - margin));
    host.style.left = `${Math.round(left)}px`;
    host.style.top = `${Math.round(top)}px`;
    host.style.width = `${Math.round(menuW)}px`;
    host.style.height = `${Math.round(menuH)}px`;
  }

  function messageContextButton(action, label) {
    const btn = document.createElement('button');
    btn.className = 'hub-dropdown-item hub-dropdown-fn email-message-context-menu__item';
    btn.type = 'button';
    btn.dataset.emailAction = action;
    btn.setAttribute('role', 'menuitem');
    btn.textContent = label;
    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      handleAction(action);
    });
    return btn;
  }

  function openMessageContextMenuAt(anchorEl) {
    if (!anchorEl || typeof anchorEl.getBoundingClientRect !== 'function') return false;
    if (!activeMessageUid()) {
      setStatus('Open a message before using message actions', 'warn');
      return true;
    }
    closeFolderMenus();
    closeMessageContextMenu();
    const host = document.createElement('div');
    host.id = MESSAGE_CONTEXT_MENU_ID;
    host.className = 'hub-tab-dropdown open hub-context-menu-floating hub-context-menu-floating--columns email-message-context-menu';
    host.dataset.hubContextMenu = '1';
    host.dataset.hubMenuGroup = 'dave-email-message';
    host.style.position = 'fixed';
    host.style.zIndex = '12000';

    const menu = document.createElement('div');
    menu.className = 'hub-dropdown-menu hub-context-menu-floating__menu hub-context-menu-floating__menu--columns';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Message actions');
    menu.style.position = 'absolute';
    menu.style.top = '0';
    menu.style.left = '0';
    menu.style.marginTop = '0';

    [
      [messageContextButton('force-refresh-message', 'Force refresh')],
      [],
      [],
    ].forEach(items => {
      const column = document.createElement('div');
      column.className = 'hub-context-menu-floating__column';
      items.forEach(item => column.appendChild(item));
      menu.appendChild(column);
    });

    host.appendChild(menu);
    document.body.appendChild(host);
    positionMessageContextMenu(host, menu, anchorEl);
    state.messageContextMenuOpen = true;

    messageContextPointerHandler = event => {
      const current = el(MESSAGE_CONTEXT_MENU_ID);
      if (!current) return;
      if (current.contains(event.target)) return;
      if (event.target?.closest?.('[data-email-list-toggle]')) return;
      closeMessageContextMenu();
    };
    messageContextKeyHandler = event => {
      if (event.key === 'Escape') closeMessageContextMenu();
    };
    window.setTimeout(() => {
      if (!el(MESSAGE_CONTEXT_MENU_ID)) return;
      document.addEventListener('pointerdown', messageContextPointerHandler, true);
      document.addEventListener('keydown', messageContextKeyHandler, true);
    }, 0);
    return true;
  }

  function htmlSecurity() {
    return state.message?.html_security || {};
  }

  function htmlSafetyItems() {
    const security = htmlSecurity();
    const rows = [];
    const remote = Number(security.remote_images_blocked || 0);
    const proxied = Number(security.remote_images_proxied || 0);
    const tracking = Number(security.tracking_images_blocked || 0);
    const inline = Number(security.inline_images_rendered || 0);
    const active = Number(security.active_content_blocked || 0);
    const unsafeLinks = Number(security.unsafe_links_blocked || 0);
    rows.push(`sandboxed`);
    if (proxied) rows.push(`${proxied} remote image${proxied === 1 ? '' : 's'} transformed`);
    if (remote) rows.push(`${remote} remote image${remote === 1 ? '' : 's'} blocked`);
    if (tracking) rows.push(`${tracking} tracking image${tracking === 1 ? '' : 's'} detected`);
    if (inline) rows.push(`${inline} inline image${inline === 1 ? '' : 's'} shown`);
    if (active) rows.push(`${active} active block${active === 1 ? '' : 's'} removed`);
    if (unsafeLinks) rows.push(`${unsafeLinks} unsafe link${unsafeLinks === 1 ? '' : 's'} blocked`);
    return rows;
  }

  function securityToneName(value) {
    const clean = String(value || '').toLowerCase();
    if (['red', 'fail', 'failed', 'danger', 'high'].includes(clean)) return 'red';
    if (['amber', 'warning', 'warn', 'indeterminate', 'missing', 'medium'].includes(clean)) return 'amber';
    if (['green', 'pass', 'passed', 'ok', 'safe', 'low'].includes(clean)) return 'green';
    if (['info', 'reported'].includes(clean)) return 'info';
    return 'unknown';
  }

  function formatSecurityValue(value) {
    if (value === true) return 'yes';
    if (value === false) return 'no';
    if (value === null || value === undefined || value === '') return 'n/a';
    if (Array.isArray(value)) {
      if (!value.length) return 'none';
      return value.map(item => formatSecurityValue(item)).join(', ');
    }
    if (typeof value === 'object') {
      const pairs = Object.entries(value)
        .filter(([, item]) => item !== null && item !== undefined && item !== '')
        .map(([key, item]) => `${key}: ${formatSecurityValue(item)}`);
      return pairs.length ? pairs.join('; ') : 'none';
    }
    return String(value);
  }

  function securityPillHtml(value, tone = '') {
    const cleanTone = securityToneName(tone || value);
    return `<span class="email-security-pill" data-tone="${escHtml(cleanTone)}">${escHtml(formatSecurityValue(value))}</span>`;
  }

  function securityKvRowsHtml(rows) {
    return `
      <div class="email-security-kv">
        ${rows.map(([label, value, tone]) => `
          <div class="email-security-kv__row">
            <span>${escHtml(label)}</span>
            <span>${tone ? securityPillHtml(value, tone) : escHtml(formatSecurityValue(value))}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function securityDetailsHtml(details) {
    const entries = Object.entries(details || {})
      .filter(([, value]) => value !== null && value !== undefined && value !== '');
    if (!entries.length) return '';
    return `
      <div class="email-security-details">
        ${entries.map(([key, value]) => `
          <span><strong>${escHtml(key)}</strong> ${escHtml(formatSecurityValue(value))}</span>
        `).join('')}
      </div>
    `;
  }

  function dkimSignatureRowsHtml(label, signatures, tone) {
    const rows = Array.isArray(signatures) ? signatures : [];
    if (!rows.length) return '';
    return `
      <div class="email-security-signatures">
        <h5>${escHtml(label)}</h5>
        ${rows.map(item => `
          <div class="email-security-mini-card" data-tone="${escHtml(securityToneName(tone))}">
            <div class="email-security-mini-card__head">
              <span>${escHtml(item.domain || 'unknown domain')}</span>
              ${securityPillHtml(item.aligned ? 'aligned' : 'not aligned', item.aligned ? 'green' : 'amber')}
            </div>
            ${securityDetailsHtml({
              selector: item.selector,
              index: item.index,
            })}
          </div>
        `).join('')}
      </div>
    `;
  }

  function authenticationResultsHtml(security) {
    const auth = security?.authentication_results || {};
    const parsed = Array.isArray(auth.parsed) ? auth.parsed : [];
    const rows = [];
    parsed.forEach(header => {
      (header.results || []).forEach(result => {
        const method = String(result.method || '').toLowerCase();
        if (!['dkim', 'spf', 'dmarc'].includes(method)) return;
        rows.push({
          authserv_id: header.authserv_id || 'provider',
          method: method.toUpperCase(),
          result: result.result || 'reported',
        });
      });
    });
    if (!auth.present) {
      return '<div class="email-empty">No provider Authentication-Results header was reported.</div>';
    }
    if (!rows.length) {
      return '<div class="email-empty">Authentication-Results headers were present but did not report DKIM, SPF, or DMARC.</div>';
    }
    return `
      <div class="email-security-result-list">
        ${rows.map(row => `
          <div class="email-security-mini-card" data-tone="${escHtml(securityToneName(row.result))}">
            <div class="email-security-mini-card__head">
              <span>${escHtml(row.method)}</span>
              ${securityPillHtml(row.result)}
            </div>
            ${securityDetailsHtml({ provider: row.authserv_id })}
          </div>
        `).join('')}
      </div>
    `;
  }

  function localAiSecurityHtml(security) {
    const llm = security?.llm || {};
    const judgement = llm.judgement || {};
    const traits = Array.isArray(judgement.scam_traits) ? judgement.scam_traits : [];
    const responseHash = llm.response_sha256 ? `${String(llm.response_sha256).slice(0, 16)}...` : '';
    return `
      ${securityKvRowsHtml([
        ['Called', Boolean(llm.called), llm.called ? 'green' : 'amber'],
        ['Model', llm.model || 'n/a'],
        ['Valid JSON', Boolean(llm.valid_json), llm.valid_json ? 'green' : 'red'],
        ['Verdict', judgement.verdict || (llm.gate_error ? 'gate failed' : 'n/a'), judgement.verdict || (llm.gate_error ? 'red' : '')],
        ['Risk score', judgement.risk_score ?? 'n/a', Number(judgement.risk_score || 0) >= 50 ? 'red' : 'green'],
        ['Confidence', judgement.confidence ?? 'n/a'],
        ['Human review', Boolean(judgement.needs_human_review), judgement.needs_human_review ? 'amber' : 'green'],
        ['Response hash', responseHash || 'n/a'],
        ['Gate error', llm.gate_error || 'none', llm.gate_error ? 'red' : 'green'],
      ])}
      ${judgement.rationale ? `<p class="email-security-rationale">${escHtml(judgement.rationale)}</p>` : ''}
      ${traits.length ? `
        <div class="email-security-traits">
          ${traits.map(trait => securityPillHtml(trait.code || trait.label || trait, 'info')).join('')}
        </div>
      ` : ''}
    `;
  }

  function securityFindingsHtml(security) {
    const findings = Array.isArray(security?.findings) ? security.findings : [];
    if (!findings.length) return '<div class="email-empty">No detailed findings are available for this message.</div>';
    return `
      <div class="email-security-findings">
        ${findings.map(finding => {
          const tone = securityToneName(finding.severity || finding.status);
          return `
            <article class="email-security-finding" data-tone="${escHtml(tone)}">
              <div class="email-security-finding__head">
                <code>${escHtml(finding.code || 'UNKNOWN')}</code>
                <div class="email-security-finding__pills">
                  ${securityPillHtml(finding.status || 'n/a', finding.status)}
                  ${securityPillHtml(finding.severity || 'n/a', finding.severity)}
                </div>
              </div>
              <div class="email-security-finding__title">${escHtml(finding.title || finding.summary || '')}</div>
              ${securityDetailsHtml({ proof_kind: finding.proof_kind, result: finding.result, score_delta: finding.score_delta })}
              ${finding.explanation ? `<p>${escHtml(finding.explanation)}</p>` : ''}
              ${securityDetailsHtml(finding.details)}
            </article>
          `;
        }).join('')}
      </div>
    `;
  }

  function messageSecurityHtml() {
    const message = state.message || null;
    const security = message?.security || null;
    if (!message) {
      return '<div class="email-empty">Open a message to view security results.</div>';
    }
    if (!security?.available) {
      const reason = security?.blocked_reason || message?.blocked_reason || 'completed security result missing';
      const status = security?.security_status || 'missing';
      return `<div class="email-empty">Body blocked: ${escHtml(reason)} (${escHtml(status)}).</div>`;
    }
    const aggregate = security.aggregate || {};
    const context = security.context || {};
    const dkim = security.dkim || {};
    const spf = security.spf || {};
    const dmarc = security.dmarc || {};
    const localProof = Boolean(dkim.aligned_pass || spf.aligned_pass || dmarc.aligned_pass);
    const rawHash = security.raw_sha256 ? `${String(security.raw_sha256).slice(0, 16)}...` : 'n/a';
    return `
      <div class="email-security-panel" data-tone="${escHtml(securityToneName(aggregate.status))}">
        <section class="email-security-section email-security-section--summary">
          <div class="email-security-section__head">
            <h4>Aggregate</h4>
            ${securityPillHtml(aggregate.status || 'unknown', aggregate.status)}
          </div>
          ${securityKvRowsHtml([
            ['Score', aggregate.score ?? aggregate.risk_score ?? 'n/a', aggregate.status],
            ['Severity', aggregate.severity || 'n/a', aggregate.severity || aggregate.status],
            ['Security proof', localProof ? 'local proof exists' : 'no aligned local proof', localProof ? 'green' : 'amber'],
            ['Default view', aggregate.message_view_default || 'plain'],
            ['Checked', security.checked_at || 'n/a'],
            ['Duration', security.duration_ms ? `${security.duration_ms} ms` : 'n/a'],
            ['Raw hash', rawHash],
          ])}
          ${aggregate.summary ? `<p class="email-security-rationale">${escHtml(aggregate.summary)}</p>` : ''}
          ${securityKvRowsHtml([
            ['From domain', context.from_domain || 'n/a'],
            ['Return-path domain', context.return_path_domain || 'n/a'],
            ['Source IP', context.source_ip || 'n/a'],
            ['Received headers', context.received_header_count ?? 'n/a'],
          ])}
        </section>

        <section class="email-security-section">
          <div class="email-security-section__head">
            <h4>Local DKIM</h4>
            ${securityPillHtml(dkim.aligned_pass ? 'pass' : (dkim.signature_count ? 'not aligned' : 'missing'), dkim.aligned_pass ? 'green' : 'amber')}
          </div>
          ${securityKvRowsHtml([
            ['Signatures', dkim.signature_count ?? 0],
            ['Aligned pass', Boolean(dkim.aligned_pass), dkim.aligned_pass ? 'green' : 'amber'],
            ['Failed signatures', Array.isArray(dkim.failed) ? dkim.failed.length : 0, Array.isArray(dkim.failed) && dkim.failed.length ? 'red' : 'green'],
          ])}
          ${dkimSignatureRowsHtml('Passed signatures', dkim.passed, 'green')}
          ${dkimSignatureRowsHtml('Failed signatures', dkim.failed, 'red')}
        </section>

        <section class="email-security-section">
          <div class="email-security-section__head">
            <h4>Local SPF</h4>
            ${securityPillHtml(spf.result || (spf.evaluated ? 'unknown' : 'not evaluated'), spf.result || 'amber')}
          </div>
          ${securityKvRowsHtml([
            ['Evaluated', Boolean(spf.evaluated), spf.evaluated ? 'green' : 'amber'],
            ['Result', spf.result || 'n/a', spf.result || 'amber'],
            ['Aligned pass', Boolean(spf.aligned_pass), spf.aligned_pass ? 'green' : 'amber'],
            ['Mail-from domain', spf.mail_from_domain || 'n/a'],
            ['Source IP', spf.source_ip || 'n/a'],
            ['Reason', spf.explanation || 'n/a'],
          ])}
        </section>

        <section class="email-security-section">
          <div class="email-security-section__head">
            <h4>DMARC Policy</h4>
            ${securityPillHtml(dmarc.result || 'n/a', dmarc.result || 'amber')}
          </div>
          ${securityKvRowsHtml([
            ['Result', dmarc.result || 'n/a', dmarc.result || 'amber'],
            ['Policy', dmarc.policy || 'n/a', dmarc.policy === 'none' ? 'amber' : 'info'],
            ['Policy domain', dmarc.policy_domain || 'n/a'],
            ['Aligned pass', Boolean(dmarc.aligned_pass), dmarc.aligned_pass ? 'green' : 'amber'],
            ['Record', dmarc.record || 'n/a'],
          ])}
        </section>

        <section class="email-security-section">
          <div class="email-security-section__head">
            <h4>Provider Reported</h4>
            ${securityPillHtml(security.authentication_results?.present ? 'present' : 'missing', security.authentication_results?.present ? 'info' : 'amber')}
          </div>
          ${authenticationResultsHtml(security)}
        </section>

        <section class="email-security-section">
          <div class="email-security-section__head">
            <h4>Local AI</h4>
            ${securityPillHtml(security.llm?.valid_json ? 'valid JSON' : 'gate risk', security.llm?.valid_json ? 'green' : 'red')}
          </div>
          ${localAiSecurityHtml(security)}
        </section>

        <section class="email-security-section">
          <div class="email-security-section__head">
            <h4>Findings</h4>
            ${securityPillHtml(`${Array.isArray(security.findings) ? security.findings.length : 0} checks`, 'info')}
          </div>
          ${securityFindingsHtml(security)}
        </section>
      </div>
    `;
  }

  function htmlFrameDocument(value, message = state.message) {
    const origin = window.location?.origin || '';
    const imgSources = origin ? `data: ${origin}` : 'data:';
    const bodyHtml = htmlWithCachedMessageImages(value, message);
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${escHtml(imgSources)}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; connect-src 'none'; script-src 'none'; object-src 'none';">
  <style>
    :root { color-scheme: light; }
    html, body { min-height:100%; margin:0; }
    body {
      box-sizing:border-box;
      color:#172033;
      background:#f7f8fb;
      font:14px/1.52 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding:16px;
      overflow-wrap:anywhere;
    }
    a { color:#1458b8; text-decoration:underline; }
    img { max-width:100%; height:auto; display:block; margin:10px 0; }
    .email-image-wrap { display:inline-grid; gap:4px; max-width:100%; margin:10px 0; }
    .email-image-wrap img { margin:0; }
    .email-image-original {
      justify-self:start;
      border:1px solid #aebbd0;
      border-radius:5px;
      background:#eef3fa;
      color:#174f9c;
      padding:3px 7px;
      font-size:12px;
      line-height:1.3;
      text-decoration:none;
    }
    table { width:auto; max-width:100%; border-collapse:collapse; margin:12px 0; background:#fff; }
    th, td { border:1px solid #cfd6e3; padding:6px 8px; vertical-align:top; }
    th { background:#edf2f8; }
    blockquote { margin:10px 0; padding:8px 12px; border-left:4px solid #9ab0cc; background:#eef3fa; }
    pre, code { font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .email-image-blocked {
      display:inline-flex;
      margin:8px 0;
      padding:6px 8px;
      border:1px solid #c8a044;
      border-radius:5px;
      background:#fff7dc;
      color:#5f4600;
      font-size:12px;
    }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`;
  }

  function renderHtmlMessage(content, value, message = state.message) {
    if (!value) {
      content.innerHTML = '<div class="email-empty">No sanitized HTML view is available for this message.</div>';
      return;
    }
    ensureMessageImageCache(message);
    content.textContent = '';
    const shell = document.createElement('div');
    shell.className = 'email-html-shell';
    const safety = document.createElement('div');
    safety.className = 'email-html-safety';
    htmlSafetyItems().forEach(item => {
      const pill = document.createElement('span');
      pill.textContent = item;
      safety.appendChild(pill);
    });
    const frame = document.createElement('iframe');
    frame.className = 'email-html-frame';
    frame.setAttribute('sandbox', '');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('title', 'Sanitized email HTML');
    frame.srcdoc = htmlFrameDocument(value, message);
    shell.appendChild(safety);
    shell.appendChild(frame);
    content.appendChild(shell);
  }

  function rawFindingTone(finding) {
    const code = String(finding?.code || '').toUpperCase();
    const statusTone = securityToneName(finding?.status || finding?.result);
    const severityTone = securityToneName(finding?.severity);
    if (statusTone === 'green' || code.endsWith('_PASS')) return 'green';
    if (severityTone === 'red' || statusTone === 'red') return 'red';
    if (severityTone === 'amber' || statusTone === 'amber') return 'amber';
    return '';
  }

  function rawSignalTargets(details) {
    return Object.values(details || {})
      .flatMap(value => Array.isArray(value) ? value : [value])
      .map(value => String(value || '').trim().toLowerCase())
      .filter(value => value.length >= 3);
  }

  function rawSecuritySignals() {
    const security = state.message?.security || {};
    const findings = Array.isArray(security.findings) ? security.findings : [];
    return findings.map(finding => {
      const code = String(finding?.code || '').toUpperCase();
      let kind = '';
      if (code.startsWith('AUTHRES_')) kind = 'authres';
      else if (code.startsWith('DKIM_')) kind = 'dkim';
      else if (code.startsWith('SPF_')) kind = 'spf';
      else if (code.startsWith('DMARC_')) kind = 'dmarc';
      if (!kind) return null;
      return {
        kind,
        tone: rawFindingTone(finding),
        targets: rawSignalTargets(finding.details),
      };
    }).filter(signal => signal && signal.tone);
  }

  function strongerRawTone(current, candidate) {
    const rank = { red: 3, amber: 2, green: 1 };
    return (rank[candidate] || 0) > (rank[current] || 0) ? candidate : current;
  }

  function rawLineMatchesKind(line, kind) {
    const trimmed = line.trimStart();
    if (kind === 'authres') return trimmed.startsWith('authentication-results:') || trimmed.startsWith('arc-authentication-results:');
    if (kind === 'dkim') return trimmed.startsWith('dkim-signature:') || line.includes('dkim=');
    if (kind === 'spf') return trimmed.startsWith('received-spf:') || trimmed.startsWith('return-path:') || trimmed.startsWith('received:') || line.includes('spf=');
    if (kind === 'dmarc') return trimmed.startsWith('from:') || line.includes('dmarc=') || line.includes('_dmarc');
    return false;
  }

  function rawLineFallbackTone(line) {
    const securityLine = (
      line.trimStart().startsWith('authentication-results:')
      || line.trimStart().startsWith('arc-authentication-results:')
      || line.trimStart().startsWith('dkim-signature:')
      || line.trimStart().startsWith('received-spf:')
      || line.trimStart().startsWith('return-path:')
      || line.trimStart().startsWith('received:')
      || line.trimStart().startsWith('from:')
      || line.includes('dkim=')
      || line.includes('spf=')
      || line.includes('dmarc=')
    );
    if (!securityLine) return '';
    if (/\b(?:fail|hardfail|softfail|permerror)\b/.test(line)) return 'red';
    if (/\b(?:temperror|neutral|none|policy|missing|indeterminate)\b/.test(line)) return 'amber';
    if (/\bpass\b/.test(line)) return 'green';
    return '';
  }

  function rawLineTone(line, signals) {
    const lower = String(line || '').toLowerCase();
    let tone = '';
    signals.forEach(signal => {
      if (!rawLineMatchesKind(lower, signal.kind) && !signal.targets.some(target => lower.includes(target))) {
        return;
      }
      tone = strongerRawTone(tone, signal.tone);
    });
    return tone || rawLineFallbackTone(lower);
  }

  function renderRawMessage(content, value) {
    if (!value) {
      content.innerHTML = '<div class="email-empty">No safe raw view is available for this message.</div>';
      return;
    }
    const shell = document.createElement('div');
    shell.className = 'email-raw-shell';
    const legend = document.createElement('div');
    legend.className = 'email-raw-legend';
    [
      ['green', 'passed'],
      ['amber', 'indeterminate'],
      ['red', 'failed'],
    ].forEach(([tone, label]) => {
      const item = document.createElement('span');
      item.dataset.tone = tone;
      item.textContent = label;
      legend.appendChild(item);
    });
    const raw = document.createElement('div');
    raw.className = 'email-raw-view';
    const signals = rawSecuritySignals();
    String(value).split(/\n/).forEach((line, index) => {
      const row = document.createElement('div');
      row.className = 'email-raw-line';
      const tone = rawLineTone(line, signals);
      if (tone) row.dataset.tone = tone;
      const number = document.createElement('span');
      number.className = 'email-raw-line-no';
      number.textContent = String(index + 1);
      const code = document.createElement('code');
      code.textContent = line || ' ';
      row.appendChild(number);
      row.appendChild(code);
      raw.appendChild(row);
    });
    shell.appendChild(legend);
    shell.appendChild(raw);
    content.textContent = '';
    content.appendChild(shell);
  }

  function formatPlainMessageText(value) {
    const lines = String(value || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map(line => line.replace(/[ \t]+$/g, ''));
    const compact = [];
    let previousBlank = true;
    lines.forEach(line => {
      if (!line.trim()) {
        if (!previousBlank) compact.push('');
        previousBlank = true;
        return;
      }
      compact.push(line);
      previousBlank = false;
    });
    return compact.join('\n').trim();
  }

  function renderPlainMessage(content, value) {
    const pre = document.createElement('pre');
    pre.className = 'email-plain-view';
    pre.textContent = formatPlainMessageText(value) || 'No plain view is available for this message.';
    content.textContent = '';
    content.appendChild(pre);
  }

  function renderBlockedMessage(content, message) {
    const security = message?.security || {};
    const reason = security.blocked_reason || message?.blocked_reason || 'completed security result missing';
    const status = security.security_status || 'missing';
    const rawHash = message?.raw_sha256 ? `${String(message.raw_sha256).slice(0, 16)}...` : 'n/a';
    content.innerHTML = `
      <div class="email-empty">
        Body blocked: ${escHtml(reason)} (${escHtml(status)}).
        <br>
        <code>${escHtml(message?.email_uid || '')}</code>
        <br>
        Raw hash ${escHtml(rawHash)}
      </div>
    `;
  }

  function renderMessage() {
    renderViewTabs();
    const meta = el('email-message-meta');
    const content = el('email-message-content');
    if (!content) return;
    const message = state.message;
    if (!message) {
      applyMessageSecurityStatus();
      if (meta) meta.textContent = 'Select a message';
      content.innerHTML = '<div class="email-empty">Open a message from the selected folder list.</div>';
      return;
    }
    const headers = message.headers || {};
    if (meta) {
      const subject = headers.subject || '(no subject)';
      const from = headers.from || '';
      const date = headers.date || '';
      meta.textContent = `${subject} - ${from} - ${date}`;
    }
    applyMessageSecurityStatus();
    if (message.body_blocked) {
      renderBlockedMessage(content, message);
      return;
    }
    const views = message.views || {};
    const value = String(views[state.view] || '');
    if (state.view === 'html') {
      renderHtmlMessage(content, value, message);
      return;
    }
    if (state.view === 'raw') {
      renderRawMessage(content, value);
      return;
    }
    if (state.view === 'plain') {
      renderPlainMessage(content, value);
      return;
    }
    const pre = document.createElement('pre');
    pre.textContent = value || `No ${state.view} view is available for this message.`;
    content.textContent = '';
    content.appendChild(pre);
  }

  function renderMessageLoading(row, uid) {
    const meta = el('email-message-meta');
    const content = el('email-message-content');
    if (meta) {
      const subject = row?.subject || '(no subject)';
      const from = row?.from || '';
      const date = row?.date || '';
      meta.textContent = `${subject} - ${from} - ${date}`;
    }
    if (content) {
      content.innerHTML = `
        <div class="email-empty">
          Loading sanitized local body.
          <br>
          <code>${escHtml(uid || '')}</code>
        </div>
      `;
    }
  }

  function recordMessageTiming(timing) {
    const entry = {
      uid: String(timing.uid || ''),
      source: timing.source || 'network',
      body_ms: Math.max(0, Math.round(Number(timing.body_ms || 0))),
      network_ms: Math.max(0, Math.round(Number(timing.network_ms || 0))),
      at: Date.now(),
    };
    state.lastMessageTiming = entry;
    state.messageTimings.unshift(entry);
    state.messageTimings = state.messageTimings.slice(0, 12);
    notifyCacheStateChanged();
  }

  function capabilityRowsHtml() {
    const caps = state.status?.capabilities || {};
    const security = htmlSecurity();
    const checks = caps.security_checks || {};
    const aggregate = securityAggregate();
    const messageSecurity = state.message?.security || {};
    const remote = Number(security.remote_images_blocked || 0);
    const proxied = Number(security.remote_images_proxied || 0);
    const tracking = Number(security.tracking_images_blocked || 0);
    const inline = Number(security.inline_images_rendered || 0);
    const health = state.health || {};
    const imageHealth = health.external_images || {};
    const securityHealth = health.security || {};
    const downloadHealth = health.download || {};
    const lastRun = downloadHealth.last_run || {};
    const rows = [
      ['PIM health', health.status ? `${health.status}${health.activity ? ', active' : ', idle'}` : 'pending'],
      ['Download run', lastRun.status ? `${lastRun.status} ${lastRun.finished_at || lastRun.started_at || ''}` : 'pending'],
      ['Image worker queue', `${imageHealth.assigned || 0} assigned, ${imageHealth.due || 0} due, ${imageHealth.failed || 0} failed`],
      ['Security worker queue', `${securityHealth.assigned || 0} assigned, ${securityHealth.due || 0} due, ${securityHealth.failed || 0} failed`],
      ['Credential storage', state.status?.storage === 'postgres' ? 'Postgres, encrypted mailbox password' : 'not ready'],
      ['Local corpus read', caps.local_corpus_read ? 'enabled' : 'not ready'],
      ['SMTP self-test gate', caps.smtp_self_test ? 'self mailbox only' : 'disabled'],
      ['General outbound', caps.smtp_general_send ? 'enabled' : 'disabled'],
      ['Delete capability', caps.delete ? 'enabled' : 'disabled'],
      ['AI outbound', caps.ai_send ? 'enabled' : 'disabled'],
      ['Security checks', checks.available ? 'required and available' : 'required; message view blocked if unavailable'],
      ['Current message security', aggregate.status ? `${aggregate.status} - ${aggregate.summary || ''}` : 'open a message'],
      ['DKIM / SPF / DMARC', messageSecurity.available ? `${messageSecurity.dkim?.signature_count || 0} DKIM, SPF ${messageSecurity.spf?.result || 'n/a'}, DMARC ${messageSecurity.dmarc?.result || 'n/a'}` : 'not checked yet'],
      ['Local AI scam judgement', messageSecurity.llm?.called ? `called ${messageSecurity.llm.model || 'local model'}` : 'not checked yet'],
      ['HTML sandbox', 'srcdoc iframe, no scripts, no same-origin storage'],
      ['Image assets', 'worker JPEG transforms, no remote fetch on open'],
      ['Remote images', proxied ? `${proxied} transformed` : (remote ? `${remote} blocked` : 'none in current message')],
      ['Tracking images', tracking ? `${tracking} detected` : 'none detected'],
      ['Inline images', inline ? `${inline} transformed/rendered` : 'none in current message'],
    ];
    return `
      <div class="email-safe-list">
        ${rows.map(([label, value]) => `
          <div class="email-safe-item">
            <span>${escHtml(label)}</span>
            <span>${escHtml(value)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
  }

  function cacheKvRowsHtml(rows) {
    return `
      <div class="email-safe-list email-cache-kv">
        ${rows.map(([label, value]) => `
          <div class="email-safe-item email-cache-kv__row">
            <span>${escHtml(label)}</span>
            <span>${escHtml(value)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function cacheStatsSectionHtml(title, stats, extraRows = []) {
    const data = stats && typeof stats === 'object' ? stats : {};
    const rows = [
      ['Items', data.items ?? 'n/a'],
      ['Bytes', `${formatBytes(data.bytes)} / ${formatBytes(data.capacity_bytes)}`],
      ['Max', formatBytes(data.max_bytes)],
      ['Headroom', formatBytes(data.headroom_bytes)],
      ['Hits / misses', `${data.hits ?? 'n/a'} / ${data.misses ?? 'n/a'}`],
      ['Puts / evictions', `${data.puts ?? 'n/a'} / ${data.evictions ?? 'n/a'}`],
      ...extraRows,
    ];
    return `
      <section class="email-cache-section">
        <div class="email-cache-section__head">
          <h4>${escHtml(title)}</h4>
          ${securityPillHtml(data.items ?? 'n/a', 'info')}
        </div>
        ${cacheKvRowsHtml(rows)}
      </section>
    `;
  }

  function cacheTimingRowsHtml() {
    const rows = state.messageTimings.slice(0, 6);
    if (!rows.length) return '<div class="email-empty">Open a message to record click timing.</div>';
    return `
      <div class="email-cache-timing-list">
        ${rows.map(item => `
          <div class="email-cache-timing-row">
            <span>${escHtml(item.uid.slice(0, 18))}</span>
            <span>${escHtml(item.source)}</span>
            <span>${escHtml(`${item.body_ms} ms`)}</span>
            <span>${escHtml(item.network_ms ? `${item.network_ms} ms API` : 'no API wait')}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function cacheStatusHtml() {
    const status = state.cacheStatus || {};
    const prefetchTotal = state.messageOpenPrefetchQueue.length + state.messageOpenPrefetchInFlight;
    const pausedMs = Math.max(0, Math.round(state.messageOpenPrefetchPausedUntil - performance.now()));
    const lastRefresh = state.cacheStatusLastRefreshed
      ? `${Math.round((Date.now() - state.cacheStatusLastRefreshed) / 1000)}s ago`
      : 'pending';
    return `
      <div class="email-cache-panel">
        <section class="email-cache-section email-cache-section--summary">
          <div class="email-cache-section__head">
            <h4>Recent Rows</h4>
            ${securityPillHtml(`${state.messageOpenCache.size}/${MESSAGE_OPEN_PREFETCH_LIMIT}`, state.messageOpenCache.size >= MESSAGE_OPEN_PREFETCH_LIMIT ? 'green' : 'amber')}
          </div>
          ${cacheKvRowsHtml([
            ['Opened/body cache', `${state.messageOpenCache.size} messages, ${formatBytes(state.messageOpenCacheBytes)} / ${formatBytes(MESSAGE_OPEN_CACHE_MAX_BYTES)}`],
            ['Prefetch queue', `${prefetchTotal} pending/running, ${state.messageOpenPrefetchCompleted} done, ${state.messageOpenPrefetchFailed} failed, ${state.messageOpenPrefetchSkipped} skipped`],
            ['Prefetch pause', pausedMs ? `${pausedMs} ms remaining` : 'not paused'],
            ['Image prefetch queue', `${state.messageImagePrefetchQueue.length + state.messageImagePrefetchInFlight} pending/running, ${state.messageImagePrefetchCompleted} done, ${state.messageImagePrefetchFailed} failed`],
            ['Current source warm set', `${state.messageWarmSeen.size} UIDs seen`],
            ['Browser image memory', `${state.messageImageCache.size} messages, ${formatBytes(state.messageImageCacheBytes)} / ${formatBytes(MESSAGE_IMAGE_CACHE_MAX_BYTES)}`],
            ['Service worker image cache', state.serviceWorkerImageCacheCount === null ? 'pending' : `${state.serviceWorkerImageCacheCount} requests`],
            ['Last refreshed', lastRefresh],
          ])}
          ${state.messageOpenPrefetchLastError ? `<div class="email-empty">${escHtml(state.messageOpenPrefetchLastError)}</div>` : ''}
          ${state.cacheStatusError ? `<div class="email-empty">${escHtml(state.cacheStatusError)}</div>` : ''}
        </section>
        ${cacheStatsSectionHtml('Stack Source Artifacts', status.source_artifact_cache || status.cache)}
        ${cacheStatsSectionHtml('Stack Local Images', status.image_asset_cache, [
          ['Warm tasks', `${status.image_asset_cache_warm_tasks?.active ?? 'n/a'} / ${status.image_asset_cache_warm_tasks?.max ?? 'n/a'}`],
        ])}
        ${cacheStatsSectionHtml('Blueprints Proxy Images', status.proxy_image_cache)}
        <section class="email-cache-section">
          <div class="email-cache-section__head">
            <h4>Click Timing</h4>
            ${securityPillHtml(state.lastMessageTiming ? `${state.lastMessageTiming.body_ms} ms` : 'pending', state.lastMessageTiming && state.lastMessageTiming.body_ms <= 100 ? 'green' : 'amber')}
          </div>
          ${cacheTimingRowsHtml()}
        </section>
      </div>
    `;
  }

  async function browserPimEmailImageCacheCount() {
    if (typeof caches === 'undefined') return null;
    try {
      const names = await caches.keys();
      const name = names.find(item => item.includes('pim-email-images')) || '';
      if (!name) return 0;
      const cache = await caches.open(name);
      const keys = await cache.keys();
      return keys.length;
    } catch (error) {
      return null;
    }
  }

  async function refreshCacheStatus(options = {}) {
    if (state.cacheStatusLoading) return state.cacheStatus;
    state.cacheStatusLoading = true;
    try {
      const [data, swCount] = await Promise.all([
        fetchJson(cacheStatusEndpoint()),
        browserPimEmailImageCacheCount(),
      ]);
      state.cacheStatus = data || null;
      state.serviceWorkerImageCacheCount = swCount;
      state.cacheStatusError = '';
      state.cacheStatusLastRefreshed = Date.now();
      if (state.loaded && !options.deferRender) notifyCacheStateChanged();
      return state.cacheStatus;
    } catch (error) {
      state.cacheStatusError = error.message || String(error);
      if (state.loaded && !options.deferRender) notifyCacheStateChanged();
      return state.cacheStatus;
    } finally {
      state.cacheStatusLoading = false;
    }
  }

  function secondaryTabsHtml(layout = 'secondary') {
    const tabs = [
      ['checks', 'Checks'],
      ['security', 'Security'],
      ['cache', 'Cache'],
    ];
    return tabs.map(([id, label]) => `
      <button type="button" data-email-secondary-tab="${escHtml(id)}" data-active="${state.secondaryTab === id ? 'true' : 'false'}" data-email-secondary-layout="${escHtml(layout)}">${escHtml(label)}</button>
    `).join('');
  }

  function secondaryBodyHtml() {
    if (state.secondaryTab === 'checks') return capabilityRowsHtml();
    if (state.secondaryTab === 'security') return messageSecurityHtml();
    if (state.secondaryTab === 'cache') return cacheStatusHtml();
    return foldersHtml();
  }

  function renderSecondaryPanels() {
    document.querySelectorAll('.email-secondary-tabs').forEach(host => {
      host.innerHTML = secondaryTabsHtml(host.closest('#ultrawide-sidecar') ? 'ultrawide' : 'secondary');
    });
    renderFolderControls();
    const bottom = el('email-secondary-bottom-body');
    if (bottom) bottom.innerHTML = secondaryBodyHtml();
    const modal = el('email-secondary-modal-body');
    if (modal) modal.innerHTML = secondaryBodyHtml();
    const modalTitle = el('email-secondary-modal-title');
    if (modalTitle) {
      modalTitle.textContent = state.secondaryTab === 'security'
        ? 'Email Security'
        : (state.secondaryTab === 'checks' ? 'Email Checks' : (state.secondaryTab === 'cache' ? 'Email Cache' : 'Email Folders'));
    }
  }

  function renderUltrawide() {
    if (typeof window.UltrawideSidecar === 'undefined') return;
    const active = document.getElementById('tab-email')?.classList.contains('active');
    const match = window.matchMedia ? window.matchMedia(ULTRAWIDE_QUERY).matches : false;
    if (!active || !match) return;
    const shell = document.createElement('div');
    shell.className = 'email-ultrawide-shell';
    shell.innerHTML = `
      <div class="email-ultrawide-tabs" role="tablist" aria-label="Email ultrawide tabs">
        ${secondaryTabsHtml('ultrawide')}
      </div>
      <div class="email-ultrawide-content">
        <div class="email-ultrawide-folder-controls" data-email-folder-controls-host="ultrawide"></div>
        <div class="email-ultrawide-body">${secondaryBodyHtml()}</div>
      </div>
    `;
    window.UltrawideSidecar.setTitle('Email');
    window.UltrawideSidecar.clear();
    window.UltrawideSidecar.appendNode(shell);
    renderFolderControls();
  }

  function renderAll(options = {}) {
    renderMeta();
    renderFolderChip();
    renderFolderControls();
    renderFolders();
    renderMessages({
      preserveScroll: Boolean(options.preserveMessageListScroll),
      anchor: options.messageListAnchor || null,
    });
    renderMessage();
    renderSecondaryPanels();
    renderUltrawide();
    syncListCollapsed();
    if (window.BodyShade && typeof window.BodyShade.scheduleSizeFillTable === 'function') {
      window.BodyShade.scheduleSizeFillTable();
    }
  }

  function renderError(message) {
    state.error = message || 'Email middleware unavailable';
    state.folderLoading = false;
    setStatus(state.error, 'err');
    renderMeta();
    const list = el('email-message-list');
    if (list) list.innerHTML = `<div class="email-empty">${escHtml(state.error)}</div>`;
    const folders = el('email-folder-list');
    if (folders) folders.innerHTML = '<div class="email-empty">Folders unavailable.</div>';
    renderSecondaryPanels();
  }

  async function refreshHealth(options = {}) {
    try {
      const data = await fetchJson(`${API_ROOT}/local/health`);
      state.health = data.health || null;
      state.localCorpus = state.health?.local_corpus || state.localCorpus;
      state.mailbox = data.mailbox || state.mailbox;
      state.status = {
        ...(state.status || {}),
        storage: 'postgres',
        local_corpus: state.localCorpus || {},
        capabilities: {
          ...(state.status?.capabilities || {}),
          imap_read: false,
          local_corpus_read: true,
          safe_local_download: true,
          smtp_self_test: true,
          smtp_general_send: false,
          delete: false,
          ai_send: false,
          security_checks: {
            available: true,
            message_view_requires_security: true,
          },
        },
      };
      if (!options.silent) setStatus('Email health refreshed', healthTone() === 'red' ? 'err' : (healthTone() === 'amber' ? 'warn' : 'ok'));
      if (state.loaded && !options.deferRender) {
        renderMeta();
        renderMessageListChrome();
        renderSecondaryPanels();
        renderUltrawide();
      }
      return state.health;
    } catch (error) {
      state.health = {
        status: 'red',
        healthy: false,
        activity: false,
        heartbeat: false,
        issues: ['health_unavailable'],
        warnings: [],
      };
      if (!options.silent) setStatus(error.message || String(error), 'err');
      if (state.loaded && !options.deferRender) {
        renderMessageListChrome();
        renderSecondaryPanels();
      }
      return null;
    }
  }

  function ensureHealthPoll() {
    if (state.healthPollTimer) return;
    state.healthPollTimer = window.setInterval(() => {
      if (!state.loaded || document.hidden) return;
      refreshHealth({ silent: true });
      refreshCacheStatus({ silent: true });
    }, Math.min(HEALTH_POLL_MS, CACHE_STATUS_POLL_MS));
  }

  async function load(options = {}) {
    if (state.loading) return state.status;
    if (state.loaded && !options.force) {
      renderUltrawide();
      return state.status;
    }
    const selectedFolder = options.folder || (state.loaded ? state.folder : 'INBOX') || 'INBOX';
    const preserveList = Boolean(state.loaded && options.force);
    const listAnchor = preserveList ? captureMessageListAnchor() : null;
    const previousMessage = state.message;
    const previousUid = activeMessageUid();
    state.folderLoadSeq += 1;
    state.loading = true;
    state.error = '';
    state.readSource = 'local';
    clearMessagePrefetch();
    state.messageWarmSeen = new Set();
    resetMessagePrefetchQueues();
    state.messagePendingUid = '';
    setStatus('Loading local email corpus', 'unknown');
    const healthPromise = refreshHealth({ silent: true, deferRender: true });
    try {
      const [folders, messages] = await Promise.all([
        fetchJson(folderEndpoint()),
        fetchJson(folderMessagesEndpoint(selectedFolder)),
      ]);
      state.readSource = 'local';
      state.mailbox = folders.mailbox || messages.mailbox || state.mailbox || null;
      state.folders = Array.isArray(folders.folders) ? folders.folders : [];
      state.folder = messages.folder || selectedFolder;
      applyMessageListResponse(messages, { append: false, offset: 0 });
      state.folderLoading = false;
      state.message = preserveList && previousUid && state.messages.some(row => messageIdentity(row) === previousUid)
        ? previousMessage
        : null;
      state.loaded = true;
      setStatus('Email middleware ready', 'ok');
      renderAll({ messageListAnchor: listAnchor });
      scheduleMessagePagePrefetch();
      refreshCacheStatus({ silent: true });
      ensureHealthPoll();
      healthPromise.then(() => {
        if (!state.loaded) return;
        renderMeta();
        renderMessageListChrome();
        renderSecondaryPanels();
        renderUltrawide();
      });
      return state.status;
    } catch (error) {
      renderError(error.message || String(error));
      return null;
    } finally {
      state.loading = false;
    }
  }

  async function refresh() {
    return load({ force: true });
  }

  async function loadFolderMessages(folder) {
    const clean = String(folder || '').trim() || 'INBOX';
    const seq = state.folderLoadSeq + 1;
    state.folderLoadSeq = seq;
    state.folder = clean;
    state.message = null;
    state.messages = [];
    state.messageListOffset = 0;
    state.messageListTotal = null;
    state.messagesHasMore = false;
    state.messagesLoadingMore = false;
    clearMessagePrefetch();
    state.messageWarmSeen = new Set();
    resetMessagePrefetchQueues();
    state.messageListSignature = '';
    state.messagePendingUid = '';
    state.folderLoading = true;
    setStatus(`Loading ${clean} messages`, 'unknown');
    renderAll();
    try {
      const data = await fetchJson(folderMessagesEndpoint(clean));
      if (seq !== state.folderLoadSeq) return false;
      state.mailbox = data.mailbox || state.mailbox;
      state.readSource = 'local';
      state.folder = data.folder || clean;
      applyMessageListResponse(data, { append: false, offset: 0 });
      state.folderLoading = false;
      setStatus(`${state.folder} selected`, 'ok');
      renderAll();
      scheduleMessagePagePrefetch();
      refreshCacheStatus({ silent: true });
      return true;
    } catch (error) {
      if (seq !== state.folderLoadSeq) return false;
      state.messages = [];
      state.folderLoading = false;
      setStatus(error.message || String(error), 'err');
      renderAll();
      return false;
    }
  }

  async function loadMoreMessages() {
    if (!state.loaded || state.folderLoading || state.messagesLoadingMore || !state.messagesHasMore) return false;
    const seq = state.folderLoadSeq;
    const folder = state.folder || 'INBOX';
    const offset = state.messageListOffset || state.messages.length;
    const anchor = captureMessageListAnchor();
    const prefetched = takePrefetchedMessagePage(folder, offset);
    if (prefetched) {
      applyMessageListResponse(prefetched, { append: true, offset });
      setStatus(`Loaded ${state.messages.length} ${state.folder || 'INBOX'} messages`, 'ok');
      renderMessages({ anchor });
      scheduleMessagePagePrefetch();
      return true;
    }
    state.messagesLoadingMore = true;
    renderMessages({ anchor });
    try {
      let data = null;
      if (state.messagePrefetchPromise && messagePrefetchMatches(folder, offset)) {
        data = await state.messagePrefetchPromise;
      }
      if (!data) {
        data = await fetchJson(folderMessagesEndpoint(folder, {
          limit: MESSAGE_PREFETCH_AHEAD,
          offset,
        }));
      }
      if (seq !== state.folderLoadSeq || folder !== state.folder) return false;
      applyMessageListResponse(data, { append: true, offset });
      setStatus(`Loaded ${state.messages.length} ${state.folder || 'INBOX'} messages`, 'ok');
      scheduleMessagePagePrefetch();
      return true;
    } catch (error) {
      setStatus(error.message || String(error), 'err');
      return false;
    } finally {
      if (seq === state.folderLoadSeq && folder === state.folder) {
        state.messagesLoadingMore = false;
        renderMessages({ anchor });
      }
    }
  }

  function handleMessageListScroll() {
    if (state.messageListScrollPending) return;
    state.messageListScrollPending = true;
    window.requestAnimationFrame(() => {
      state.messageListScrollPending = false;
      const host = el('email-message-list');
      if (!host) return;
      const remaining = host.scrollHeight - host.scrollTop - host.clientHeight;
      if (remaining <= MESSAGE_SCROLL_LOAD_PX) loadMoreMessages();
    });
  }

  async function openMessage(uid) {
    const cleanUid = String(uid || '').trim();
    if (!cleanUid) return false;
    const openSeq = state.messageOpenSeq + 1;
    state.messageOpenSeq = openSeq;
    const startedAt = performance.now();
    pauseMessageOpenPrefetch();
    const row = state.messages.find(item => (
      String(item.email_uid || '') === cleanUid || String(item.uid || '') === cleanUid
    )) || null;
    const emailUid = String(row?.email_uid || cleanUid).trim();
    if (!emailUid) return false;
    setStatus('Opening local message', 'unknown');
    state.messageOpenCacheHit = false;
    const cached = cachedOpenedMessage(emailUid, row, { opened: true });
    if (cached) {
      state.messageOpenCacheHit = true;
      state.message = cached;
      state.messagePendingUid = '';
      state.view = defaultMessageView(state.message);
      state.securityProgress = null;
      syncSelectedMessageRows();
      renderMessage();
      renderSecondaryPanels();
      setStatus('Local email loaded', 'ok');
      renderOpenedMessageSecurityProgress();
      recordMessageTiming({
        uid: emailUid,
        source: 'browser-cache',
        body_ms: performance.now() - startedAt,
        network_ms: 0,
      });
      return true;
    }
    state.messagePendingUid = emailUid;
    syncSelectedMessageRows();
    renderMessageLoading(row, emailUid);
    try {
      const networkStartedAt = performance.now();
      const data = await fetchJson(messageEndpoint(emailUid, row));
      const networkMs = performance.now() - networkStartedAt;
      if (openSeq !== state.messageOpenSeq) return false;
      state.message = data.message || null;
      state.messagePendingUid = '';
      cacheOpenedMessage(emailUid, row, state.message, { opened: true });
      ensureMessageImageCache(state.message);
      state.view = defaultMessageView(state.message);
      state.securityProgress = null;
      syncSelectedMessageRows();
      renderMessage();
      renderSecondaryPanels();
      setStatus('Local email loaded', 'ok');
      renderOpenedMessageSecurityProgress();
      recordMessageTiming({
        uid: emailUid,
        source: 'api',
        body_ms: performance.now() - startedAt,
        network_ms: networkMs,
      });
      return true;
    } catch (error) {
      if (openSeq === state.messageOpenSeq) state.messagePendingUid = '';
      setStatus(error.message || String(error), 'err');
      return false;
    }
  }

  function setFolder(name) {
    return loadFolderMessages(name);
  }

  function setFolderSet(setId) {
    const clean = String(setId || '').trim() || 'system';
    state.folderSet = clean;
    state.folderGroup = '';
    state.secondaryTab = 'folders';
    renderFolderControls();
    renderFolders();
    renderSecondaryPanels();
    renderUltrawide();
    return true;
  }

  function setFolderGroup(groupKey) {
    state.folderGroup = String(groupKey || '').trim();
    state.secondaryTab = 'folders';
    renderFolderControls();
    renderFolders();
    renderSecondaryPanels();
    renderUltrawide();
    return true;
  }

  function setView(view) {
    const clean = VIEW_IDS.includes(view) ? view : 'plain';
    state.view = clean;
    renderMessage();
    return true;
  }

  function toggleList() {
    state.listCollapsed = !state.listCollapsed;
    syncListCollapsed();
    if (window.BodyShade && typeof window.BodyShade.scheduleSizeFillTable === 'function') {
      window.BodyShade.scheduleSizeFillTable();
    }
    return true;
  }

  function toggleFolderNode(key) {
    const clean = String(key || '').trim();
    if (!clean) return false;
    if (state.expandedFolderKeys.has(clean)) state.expandedFolderKeys.delete(clean);
    else state.expandedFolderKeys.add(clean);
    renderFolders();
    renderSecondaryPanels();
    renderUltrawide();
    return true;
  }

  async function browseFolders() {
    if (!state.loaded) await load();
    state.secondaryTab = 'folders';
    renderSecondaryPanels();
    const modal = el('email-secondary-modal');
    if (modal) {
      if (typeof HubModal !== 'undefined') HubModal.open(modal);
      else if (typeof modal.showModal === 'function' && !modal.open) modal.showModal();
    }
    renderUltrawide();
    return true;
  }

  async function safeChecks() {
    if (!state.loaded) await load();
    await refreshHealth();
    state.secondaryTab = 'checks';
    renderSecondaryPanels();
    const modal = el('email-secondary-modal');
    if (modal) {
      if (typeof HubModal !== 'undefined') HubModal.open(modal);
      else if (typeof modal.showModal === 'function' && !modal.open) modal.showModal();
    }
    renderUltrawide();
    return true;
  }

  async function securityChecks() {
    if (!state.loaded) await load();
    const uid = activeMessageUid();
    if (uid && !state.message?.security?.available) {
      const runId = securityRunId();
      beginSecurityProgress(runId, uid, state.folder || 'INBOX');
      try {
        const data = await fetchJson(
          `${API_ROOT}/local/messages/${encodeURIComponent(uid)}/security?security_run_id=${encodeURIComponent(runId)}`,
          { method: 'POST' },
        );
        if (state.message && data.security) state.message.security = data.security;
        const refreshed = await fetchJson(messageEndpoint(uid));
        state.message = refreshed.message || state.message;
        state.view = defaultMessageView(state.message);
      } catch (error) {
        setStatus(error.message || String(error), 'err');
      }
    }
    const aggregate = securityAggregate();
    if (uid && aggregate.status) {
      completeSecurityProgress(state.message?.security || {});
    } else if (!uid) {
      setStatus('Open a message to view security results', 'warn');
    }
    state.secondaryTab = 'security';
    renderSecondaryPanels();
    const modal = el('email-secondary-modal');
    if (modal) {
      if (typeof HubModal !== 'undefined') HubModal.open(modal);
      else if (typeof modal.showModal === 'function' && !modal.open) modal.showModal();
    }
    renderUltrawide();
    return true;
  }

  async function forceRefreshMessage() {
    closeMessageContextMenu();
    const uid = activeMessageUid();
    if (!uid) {
      setStatus('Open a message before force refresh', 'warn');
      return false;
    }
    setStatus('Force refreshing message from IMAP', 'unknown');
    try {
      invalidateOpenedMessageCache(uid);
      clearBrowserImageStorageCache(uid);
      const data = await fetchJson(forceRefreshEndpoint(uid), { method: 'POST' });
      if (data.message) {
        state.message = data.message;
      } else {
        const refreshed = await fetchJson(messageEndpoint(uid));
        state.message = refreshed.message || state.message;
      }
      cacheOpenedMessage(uid, null, state.message);
      clearBrowserImageStorageCache(uid);
      ensureMessageImageCache(state.message);
      state.view = defaultMessageView(state.message);
      state.securityProgress = null;
      renderMessage();
      renderSecondaryPanels();
      renderUltrawide();
      syncSelectedMessageRows();
      setStatus('Message force refresh complete', 'ok');
      return true;
    } catch (error) {
      setStatus(error.message || String(error), 'err');
      return false;
    }
  }

  function closeModal() {
    const modal = el('email-secondary-modal');
    if (!modal) return;
    if (typeof HubModal !== 'undefined') HubModal.close(modal);
    else if (typeof modal.close === 'function') modal.close();
  }

  function handleAction(action) {
    if (action === 'refresh') return refresh();
    if (action === 'browse-folders') return browseFolders();
    if (action === 'view-plain') return setView('plain');
    if (action === 'view-html') return setView('html');
    if (action === 'view-markdown') return setView('markdown');
    if (action === 'view-raw') return setView('raw');
    if (action === 'toggle-list') return toggleList();
    if (action === 'safe-checks') return safeChecks();
    if (action === 'security-checks') return securityChecks();
    if (action === 'force-refresh-message') return forceRefreshMessage();
    return false;
  }

  function installMessageContextToggleFsm(button) {
    if (!button || button.dataset.emailMessageContextFsm === '1') return;
    button.dataset.emailMessageContextFsm = '1';

    const fsm = {
      state: 'idle',
      pointerId: null,
      startX: 0,
      startY: 0,
      timer: null,
      suppressNextClick: false,
    };

    const clearTimer = () => {
      if (!fsm.timer) return;
      window.clearTimeout(fsm.timer);
      fsm.timer = null;
    };

    const cancelPress = () => {
      clearTimer();
      fsm.state = 'idle';
      fsm.pointerId = null;
    };

    const openFromLongPress = () => {
      if (fsm.state !== 'pressing') return;
      clearTimer();
      fsm.state = 'open';
      fsm.suppressNextClick = true;
      button.dataset.emailContextSuppressClick = '1';
      openMessageContextMenuAt(button);
    };

    button.addEventListener('pointerdown', event => {
      if (event.button !== undefined && event.button !== 0) return;
      fsm.state = 'pressing';
      fsm.pointerId = event.pointerId;
      fsm.startX = event.clientX;
      fsm.startY = event.clientY;
      clearTimer();
      fsm.timer = window.setTimeout(openFromLongPress, MESSAGE_CONTEXT_LONG_PRESS_MS);
      if (typeof button.setPointerCapture === 'function') {
        try {
          button.setPointerCapture(event.pointerId);
        } catch (error) {
          // Pointer capture can fail if the pointer is already gone; the FSM still cancels on document events.
        }
      }
    });

    button.addEventListener('pointermove', event => {
      if (fsm.state !== 'pressing' || event.pointerId !== fsm.pointerId) return;
      const dx = event.clientX - fsm.startX;
      const dy = event.clientY - fsm.startY;
      if (Math.hypot(dx, dy) > MESSAGE_CONTEXT_MOVE_PX) cancelPress();
    });

    button.addEventListener('pointerup', event => {
      if (event.pointerId !== fsm.pointerId) return;
      if (fsm.state === 'pressing') cancelPress();
      else {
        clearTimer();
        fsm.state = 'idle';
        fsm.pointerId = null;
      }
    });

    button.addEventListener('pointercancel', event => {
      if (event.pointerId === fsm.pointerId) cancelPress();
    });

    button.addEventListener('lostpointercapture', cancelPress);
    button.addEventListener('contextmenu', event => {
      event.preventDefault();
      if (openMessageContextMenuAt(button)) {
        fsm.suppressNextClick = true;
        button.dataset.emailContextSuppressClick = '1';
      }
    });

    button.addEventListener('click', event => {
      if (!fsm.suppressNextClick && button.dataset.emailContextSuppressClick !== '1') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      fsm.suppressNextClick = false;
      delete button.dataset.emailContextSuppressClick;
    }, true);
  }

  function installMessageContextToggleFsms() {
    document.querySelectorAll('[data-email-list-toggle]').forEach(installMessageContextToggleFsm);
  }

  function bind() {
    if (document.body.dataset.emailPageBound === '1') return;
    document.body.dataset.emailPageBound = '1';
    installMessageContextToggleFsms();
    const messageList = el('email-message-list');
    if (messageList) messageList.addEventListener('scroll', handleMessageListScroll, { passive: true });
    if (window.BlueprintsEventStream && typeof window.BlueprintsEventStream.on === 'function') {
      window.BlueprintsEventStream.on(SECURITY_PROGRESS_EVENT, handleSecurityProgressEvent);
      window.BlueprintsEventStream.resumeSoon?.('email security progress listener');
    } else {
      document.addEventListener('blueprints:event', event => {
        if (event.detail?.event_type === SECURITY_PROGRESS_EVENT) handleSecurityProgressEvent(event.detail);
      });
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.loaded) {
        refreshHealth({ silent: true });
        refreshCacheStatus({ silent: true });
      }
    });
    document.addEventListener('click', event => {
      const target = event.target;
      const actionBtn = target.closest?.('[data-email-action]');
      if (actionBtn) {
        event.preventDefault();
        if (actionBtn.dataset.emailContextSuppressClick === '1') {
          delete actionBtn.dataset.emailContextSuppressClick;
          return;
        }
        handleAction(actionBtn.dataset.emailAction);
        return;
      }
      const tabBtn = target.closest?.('[data-email-secondary-tab]');
      if (tabBtn) {
        event.preventDefault();
        state.secondaryTab = tabBtn.dataset.emailSecondaryTab || 'folders';
        renderSecondaryPanels();
        renderUltrawide();
        if (state.secondaryTab === 'cache') refreshCacheStatus({ silent: true });
        return;
      }
      const folderToggle = target.closest?.('[data-email-folder-toggle]');
      if (folderToggle) {
        event.preventDefault();
        toggleFolderNode(folderToggle.dataset.emailFolderToggle || '');
        return;
      }
      const folderBtn = target.closest?.('[data-email-folder-name]');
      if (folderBtn) {
        event.preventDefault();
        setFolder(folderBtn.dataset.emailFolderName || 'INBOX');
        return;
      }
      const menuToggle = target.closest?.('[data-email-folder-menu-toggle]');
      if (menuToggle) {
        event.preventDefault();
        toggleFolderMenu(menuToggle);
        return;
      }
      const setOption = target.closest?.('[data-email-folder-set-option]');
      if (setOption) {
        event.preventDefault();
        closeFolderMenus();
        setFolderSet(setOption.dataset.emailFolderSetOption || 'system');
        return;
      }
      const groupOption = target.closest?.('[data-email-folder-group-option]');
      if (groupOption) {
        event.preventDefault();
        closeFolderMenus();
        setFolderGroup(groupOption.dataset.emailFolderGroupOption || '');
        return;
      }
      const messageRow = target.closest?.('[data-email-message-uid]');
      if (messageRow) {
        event.preventDefault();
        openMessage(messageRow.dataset.emailMessageEmailUid || messageRow.dataset.emailMessageUid || '');
        return;
      }
      if (!target.closest?.('[data-email-folder-dropdown]')) closeFolderMenus();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest?.('.email-message-row[data-email-message-uid]');
      if (!row) return;
      event.preventDefault();
      openMessage(row.dataset.emailMessageEmailUid || row.dataset.emailMessageUid || '');
    });
    ['email-secondary-modal-close', 'email-secondary-modal-footer-close'].forEach(id => {
      const btn = el(id);
      if (btn) btn.addEventListener('click', closeModal);
    });
    window.addEventListener('resize', renderUltrawide);
    window.addEventListener('orientationchange', renderUltrawide);
  }

  function snapshot() {
    const activeUid = activeMessageUid();
    const imageCache = activeUid ? state.messageImageCache.get(activeUid) : null;
    return {
      loaded: state.loaded,
      loading: state.loading,
      folder_loading: state.folderLoading,
      status: state.error ? 'error' : (state.loaded ? 'ready' : ''),
      mailbox: mailboxAddress(),
      folder_count: state.folders.length,
      inbox_count: state.messages.length,
      message_count: state.messages.length,
      selected_folder: state.folder,
      selected_uid: activeUid,
      message_list_offset: state.messageListOffset,
      message_list_total: state.messageListTotal,
      message_list_has_more: state.messagesHasMore,
      message_prefetch_ready: !!state.messagePrefetchPage,
      message_prefetch_loading: !!state.messagePrefetchPromise,
      message_prefetch_offset: state.messagePrefetchOffset,
      message_prefetch_error: state.messagePrefetchError,
      message_open_cache_size: state.messageOpenCache.size,
      message_open_cache_bytes: state.messageOpenCacheBytes,
      message_open_cache_hit: state.messageOpenCacheHit,
      message_open_prefetch_queue: state.messageOpenPrefetchQueue.length,
      message_open_prefetch_in_flight: state.messageOpenPrefetchInFlight,
      message_open_prefetch_paused_ms: Math.max(0, Math.round(state.messageOpenPrefetchPausedUntil - performance.now())),
      message_open_prefetch_completed: state.messageOpenPrefetchCompleted,
      message_open_prefetch_failed: state.messageOpenPrefetchFailed,
      message_open_prefetch_skipped: state.messageOpenPrefetchSkipped,
      message_open_prefetch_last_error: state.messageOpenPrefetchLastError,
      message_image_prefetch_queue: state.messageImagePrefetchQueue.length,
      message_image_prefetch_in_flight: state.messageImagePrefetchInFlight,
      message_image_prefetch_completed: state.messageImagePrefetchCompleted,
      message_image_prefetch_failed: state.messageImagePrefetchFailed,
      message_image_prefetch_skipped: state.messageImagePrefetchSkipped,
      message_image_cache_size: state.messageImageCache.size,
      message_image_cache_bytes: state.messageImageCacheBytes,
      message_image_cache_ready: !!imageCache && !imageCache.pending && imageCache.sources.size > 0,
      message_image_cache_count: imageCache?.sources?.size || 0,
      message_image_cache_pending: !!imageCache?.pending,
      service_worker_image_cache_count: state.serviceWorkerImageCacheCount,
      cache_status: state.cacheStatus,
      cache_status_error: state.cacheStatusError,
      last_message_timing: state.lastMessageTiming,
      message_timings: state.messageTimings.slice(0, 6),
      message_context_menu_open: state.messageContextMenuOpen,
      view: state.view,
      secondary_tab: state.secondaryTab,
      list_collapsed: state.listCollapsed,
      folder_set: state.folderSet,
      folder_group: state.folderGroup,
      error: state.error,
    };
  }

  bind();

  return {
    load,
    refresh,
    browseFolders,
    safeChecks,
    securityChecks,
    setView,
    toggleList,
    viewPlain: () => setView('plain'),
    viewHtml: () => setView('html'),
    viewMarkdown: () => setView('markdown'),
    viewRaw: () => setView('raw'),
    openMessage,
    setFolder,
    snapshot,
  };
})();

window.BlueprintsEmailPage = EmailPage;

if (typeof DaveMenuConfig !== 'undefined') {
  DaveMenuConfig.registerFunctions({
    'email.refresh': () => EmailPage.refresh(),
    'email.browseFolders': () => EmailPage.browseFolders(),
    'email.viewPlain': () => EmailPage.viewPlain(),
    'email.viewHtml': () => EmailPage.viewHtml(),
    'email.viewMarkdown': () => EmailPage.viewMarkdown(),
    'email.viewRaw': () => EmailPage.viewRaw(),
    'email.toggleList': () => EmailPage.toggleList(),
    'email.safeChecks': () => EmailPage.safeChecks(),
    'email.security': () => EmailPage.securityChecks(),
  });
}
