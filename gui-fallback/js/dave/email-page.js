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
  const PROBABLE_TRUSTED_SECURITY_POLL_MS = 2500;
  const PROBABLE_TRUSTED_SECURITY_POLL_ATTEMPTS = 36;
  const HEALTH_POLL_MS = 15000;
  const CACHE_STATUS_POLL_MS = 30000;
  const SECURITY_PROGRESS_EVENT = 'pim.email.security.progress';
  const ORIGINAL_IMAGE_BUTTONS_STORAGE_KEY = 'blueprints.pimEmail.showOriginalImageButtons';
  const MARKDOWN_PREVIEW_STORAGE_KEY = 'blueprints.pimEmail.renderMarkdownPreview';
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

  function initialOriginalImageButtonsVisible() {
    try {
      return window.localStorage?.getItem(ORIGINAL_IMAGE_BUTTONS_STORAGE_KEY) === 'true';
    } catch (error) {
      return false;
    }
  }

  function initialMarkdownPreviewEnabled() {
    try {
      return window.localStorage?.getItem(MARKDOWN_PREVIEW_STORAGE_KEY) !== 'false';
    } catch (error) {
      return true;
    }
  }

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
    selectedMessageUids: new Set(),
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
    showOriginalImageButtons: initialOriginalImageButtonsVisible(),
    renderMarkdownPreview: initialMarkdownPreviewEnabled(),
    trustedNestedTab: 'probable',
    trustedSenders: [],
    trustedLoading: false,
    trustedLoaded: false,
    trustedError: '',
    searchMode: 'simple',
    searchQuery: '',
    searchTerms: [{ field: 'default', operator: 'AND', value: '' }],
    searchFolder: '',
    searchSentFrom: '',
    searchSentTo: '',
    searchReceivedFrom: '',
    searchReceivedTo: '',
    searchHybrid: true,
    searchRerank: true,
    searchLoading: false,
    searchError: '',
    searchResults: null,
    searchLastElapsedMs: null,
    searchSeq: 0,
    messageContextMenuOpen: false,
    messageContextUids: [],
    securitySegmentModalOpen: false,
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

  function delay(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
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

  function staleHealthErrorVisible() {
    const text = String(el('email-status-strip')?.querySelector?.('.email-status-text')?.textContent || '');
    return /PIM Email stack API is unavailable|Email middleware unavailable/i.test(text);
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
      <div class="email-security-meter" role="group" aria-label="${escHtml(label)}">
        <span class="email-sr-only" aria-live="polite">${escHtml(label)}</span>
        ${segments.map(segment => `
          <button
            type="button"
            class="email-security-meter__segment"
            data-segment="${escHtml(segment.id)}"
            data-email-security-segment="${escHtml(segment.id)}"
            data-tone="${escHtml(segment.tone)}"
            data-status="${escHtml(segment.status)}"
            title="${escHtml(`${segment.label}: ${segment.status}${segment.finding_codes.length ? ` (${segment.finding_codes.join(', ')})` : ''}`)}"
            aria-label="${escHtml(`${segment.label}: ${segment.status}`)}"
          ></button>
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
    const segment = (id, label, status, tone, items = []) => ({
      id,
      label,
      status,
      tone,
      finding_codes: items.map(item => String(item.code || '')).filter(Boolean),
    });
    const authItems = byPrefix('AUTHRES_');
    const dkimItems = byPrefix('DKIM_');
    const spfItems = byPrefix('SPF_');
    const dmarcItems = byPrefix('DMARC_');
    const inputItems = byCodes(['LLM_INPUT_SANITIZED', 'LLM_BODY_OVERSIZE']);
    const llmJsonItems = byCodes(['LLM_JSON_INVALID']);
    const llmJudgementItems = byPrefix('LLM_SCAM_TRAITS_');
    return [
      segment('service', 'Svc', 'complete', security?.available ? 'green' : 'red'),
      segment('parse', 'Parse', 'complete', 'green'),
      segment('authres_provider', 'Auth', 'complete', segmentToneFromFindings(authItems), authItems),
      segment('dkim_crypto', 'DKIM', 'complete', segmentToneFromFindings(dkimItems), dkimItems),
      segment('spf_protocol', 'SPF', 'complete', segmentToneFromFindings(spfItems), spfItems),
      segment('dmarc_policy', 'DMARC', 'complete', segmentToneFromFindings(dmarcItems), dmarcItems),
      segment('llm_input', 'Input', 'complete', segmentToneFromFindings(inputItems, 'green'), inputItems),
      segment('llm_json', 'JSON', 'complete', security?.llm?.valid_json ? 'green' : 'red', llmJsonItems),
      segment('llm_judgement', 'AI', 'complete', segmentToneFromFindings(llmJudgementItems), llmJudgementItems),
      segment('aggregate', 'All', 'complete', String(security?.aggregate?.status || 'amber').toLowerCase(), findings),
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

  function rowMessageUid(row) {
    return String(row?.dataset?.emailMessageEmailUid || row?.dataset?.emailMessageUid || '').trim();
  }

  function contextMessageUids(anchorEl = null) {
    const anchorRow = anchorEl?.closest?.('.email-message-row') || null;
    const anchorUid = rowMessageUid(anchorRow);
    if (anchorUid && state.selectedMessageUids.has(anchorUid) && state.selectedMessageUids.size > 1) {
      return Array.from(state.selectedMessageUids);
    }
    if (!anchorUid && state.selectedMessageUids.size > 1) {
      return Array.from(state.selectedMessageUids);
    }
    const uid = anchorUid || activeMessageUid();
    return uid ? [uid] : [];
  }

  function currentContextMessageUids() {
    return Array.isArray(state.messageContextUids) ? state.messageContextUids.filter(Boolean) : [];
  }

  function isMessagePayload(value) {
    return Boolean(
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && (value.email_uid || value.headers || value.views)
    );
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

  function searchEndpoint() {
    return `${API_ROOT}/local/search`;
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

  function probableTrustedEndpoint(uid) {
    return `${API_ROOT}/local/messages/${encodeURIComponent(uid)}/probable-trusted-sender`;
  }

  function trustedProbableSendersEndpoint(options = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit || 500), 2000));
    return `${API_ROOT}/local/trusted/probable-senders?limit=${limit}`;
  }

  function trustedProbableSenderDeleteEndpoint(senderEmail) {
    return `${API_ROOT}/local/trusted/probable-senders?sender_email=${encodeURIComponent(senderEmail)}`;
  }

  const SEARCH_FIELDS = [
    ['default', 'All'],
    ['from', 'From'],
    ['recipients', 'Recipients'],
    ['to', 'To'],
    ['cc', 'Cc'],
    ['bcc', 'Bcc'],
    ['subject', 'Subject'],
    ['content', 'Body'],
    ['image', 'Images'],
    ['message_id', 'Message ID'],
    ['uid', 'UID'],
    ['folder', 'Folder'],
    ['sent_at', 'Sent date'],
    ['received_at', 'Received date'],
  ];

  function searchDefaultTerms() {
    return [{ field: 'default', operator: 'AND', value: '' }];
  }

  function normalizeSearchTerms(terms) {
    const incoming = Array.isArray(terms) ? terms : [];
    const normalized = incoming.slice(0, 12).map((term, index) => ({
      field: SEARCH_FIELDS.some(([id]) => id === term?.field) ? term.field : 'default',
      operator: index === 0 ? 'AND' : (String(term?.operator || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'),
      value: String(term?.value || '').trim(),
    }));
    return normalized.length ? normalized : searchDefaultTerms();
  }

  function searchFieldOptionsHtml(value) {
    return SEARCH_FIELDS.map(([id, label]) => (
      `<option value="${escHtml(id)}"${id === value ? ' selected' : ''}>${escHtml(label)}</option>`
    )).join('');
  }

  function searchFolderOptionsHtml() {
    const folders = Array.isArray(state.folders) ? state.folders : [];
    const seen = new Set();
    const options = ['<option value="">Any folder</option>'];
    folders.forEach(folder => {
      const name = String(folder?.path || folder?.name || '').trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      options.push(`<option value="${escHtml(name)}"${state.searchFolder === name ? ' selected' : ''}>${escHtml(name)}</option>`);
    });
    return options.join('');
  }

  function readSearchForm(form) {
    if (!form) return;
    const mode = form.querySelector('[data-email-search-mode]:checked')?.value || state.searchMode || 'simple';
    state.searchMode = mode === 'advanced' ? 'advanced' : 'simple';
    state.searchQuery = String(form.querySelector('[data-email-search-query]')?.value || '').trim();
    state.searchFolder = String(form.querySelector('[data-email-search-folder]')?.value || '').trim();
    state.searchSentFrom = String(form.querySelector('[data-email-search-date="sent-from"]')?.value || '').trim();
    state.searchSentTo = String(form.querySelector('[data-email-search-date="sent-to"]')?.value || '').trim();
    state.searchReceivedFrom = String(form.querySelector('[data-email-search-date="received-from"]')?.value || '').trim();
    state.searchReceivedTo = String(form.querySelector('[data-email-search-date="received-to"]')?.value || '').trim();
    state.searchHybrid = Boolean(form.querySelector('[data-email-search-toggle="hybrid"]')?.checked);
    state.searchRerank = Boolean(form.querySelector('[data-email-search-toggle="rerank"]')?.checked);
    const rows = Array.from(form.querySelectorAll('[data-email-search-row]'));
    state.searchTerms = normalizeSearchTerms(rows.map((row, index) => ({
      field: row.querySelector('[data-email-search-term-field]')?.value || 'default',
      operator: index === 0 ? 'AND' : (row.querySelector('[data-email-search-term-operator]')?.value || 'AND'),
      value: row.querySelector('[data-email-search-term-value]')?.value || '',
    })));
  }

  function syncSearchModeControls() {
    const advanced = state.searchMode === 'advanced';
    document.querySelectorAll('[data-email-search-form]').forEach(form => {
      form.querySelectorAll('[data-email-search-mode]').forEach(input => {
        input.checked = input.value === state.searchMode;
      });
      const simplePanel = form.querySelector('.email-search-simple');
      const advancedPanel = form.querySelector('.email-search-advanced');
      if (simplePanel) simplePanel.hidden = advanced;
      if (advancedPanel) advancedPanel.hidden = !advanced;
    });
  }

  function searchFocusFieldFor(active, form) {
    if (!active || !form) return null;
    if (active.matches?.('[data-email-search-query]')) return { type: 'query' };
    if (active.matches?.('[data-email-search-folder]')) return { type: 'folder' };
    if (active.matches?.('[data-email-search-date]')) {
      return { type: 'date', key: active.dataset.emailSearchDate || '' };
    }
    if (active.matches?.('[data-email-search-clear-date]')) {
      return { type: 'clear-date', key: active.dataset.emailSearchClearDate || '' };
    }
    if (active.matches?.('[data-email-search-mode]')) {
      return { type: 'mode', value: active.value || '' };
    }
    if (active.matches?.('[data-email-search-toggle]')) {
      return { type: 'toggle', key: active.dataset.emailSearchToggle || '' };
    }
    const row = active.closest?.('[data-email-search-row]');
    if (!row) return null;
    const rowIndex = Array.from(form.querySelectorAll('[data-email-search-row]')).indexOf(row);
    if (rowIndex < 0) return null;
    if (active.matches?.('[data-email-search-term-operator]')) return { type: 'term-operator', rowIndex };
    if (active.matches?.('[data-email-search-term-field]')) return { type: 'term-field', rowIndex };
    if (active.matches?.('[data-email-search-term-value]')) return { type: 'term-value', rowIndex };
    return null;
  }

  function captureSearchFocus() {
    const active = document.activeElement;
    const form = active?.closest?.('[data-email-search-form]');
    if (!form) return null;
    const field = searchFocusFieldFor(active, form);
    if (!field) return null;
    readSearchForm(form);
    const root = active.closest?.('#email-secondary-bottom-body, #email-secondary-modal-body, #ultrawide-sidecar');
    const snapshot = {
      rootId: root?.id || '',
      field,
      selection: null,
    };
    if (
      (active.type === 'text' || active.type === 'search')
      && typeof active.selectionStart === 'number'
      && typeof active.selectionEnd === 'number'
    ) {
      snapshot.selection = {
        start: active.selectionStart,
        end: active.selectionEnd,
        direction: active.selectionDirection || 'none',
      };
    }
    return snapshot;
  }

  function matchingControlByData(root, selector, dataKey, dataValue) {
    return Array.from(root.querySelectorAll(selector)).find(node => node.dataset?.[dataKey] === dataValue) || null;
  }

  function searchFocusTarget(root, field) {
    if (!root || !field) return null;
    if (field.type === 'query') return root.querySelector('[data-email-search-query]');
    if (field.type === 'folder') return root.querySelector('[data-email-search-folder]');
    if (field.type === 'date') return matchingControlByData(root, '[data-email-search-date]', 'emailSearchDate', field.key);
    if (field.type === 'clear-date') return matchingControlByData(root, '[data-email-search-clear-date]', 'emailSearchClearDate', field.key);
    if (field.type === 'mode') {
      return Array.from(root.querySelectorAll('[data-email-search-mode]')).find(node => node.value === field.value) || null;
    }
    if (field.type === 'toggle') return matchingControlByData(root, '[data-email-search-toggle]', 'emailSearchToggle', field.key);
    if (field.type.startsWith('term-')) {
      const row = root.querySelectorAll('[data-email-search-row]')[field.rowIndex];
      if (!row) return null;
      if (field.type === 'term-operator') return row.querySelector('[data-email-search-term-operator]');
      if (field.type === 'term-field') return row.querySelector('[data-email-search-term-field]');
      if (field.type === 'term-value') return row.querySelector('[data-email-search-term-value]');
    }
    return null;
  }

  function restoreSearchFocus(snapshot) {
    if (!snapshot) return;
    const restore = () => {
      const root = snapshot.rootId ? el(snapshot.rootId) : document;
      const target = searchFocusTarget(root || document, snapshot.field) || searchFocusTarget(document, snapshot.field);
      if (!target || target.disabled) return;
      target.focus({ preventScroll: true });
      if (snapshot.selection && typeof target.setSelectionRange === 'function') {
        try {
          target.setSelectionRange(snapshot.selection.start, snapshot.selection.end, snapshot.selection.direction);
        } catch (error) {
          // Some input types do not allow programmatic selection; focus is the important part.
        }
      }
    };
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(restore);
    else window.setTimeout(restore, 0);
  }

  function currentSearchPayload({ offset = 0, limit = MESSAGE_LIST_LIMIT } = {}) {
    const terms = normalizeSearchTerms(state.searchTerms).filter(term => term.value || term.field.endsWith('_at'));
    return {
      mode: state.searchMode === 'advanced' ? 'advanced' : 'simple',
      query: state.searchMode === 'advanced' ? '' : state.searchQuery,
      terms: state.searchMode === 'advanced' ? terms : [],
      folder: state.searchFolder,
      sent_from: state.searchSentFrom,
      sent_to: state.searchSentTo,
      received_from: state.searchReceivedFrom,
      received_to: state.searchReceivedTo,
      hybrid: state.searchHybrid,
      rerank: state.searchRerank,
      limit: Math.max(1, Math.min(Number(limit || MESSAGE_LIST_LIMIT), 200)),
      offset: Math.max(0, Number(offset || 0)),
    };
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
    const stale = Number(download.stale_running || 0) > 0 || Boolean(download.last_run?.stale);
    if (stale && Number(download.running || 0) <= 0) return false;
    return Boolean(
      Number(download.running || 0) > 0
      || download.activity
      || download.recent_activity
    );
  }

  function healthHeartbeatActive() {
    const status = String(state.health?.status || '').toLowerCase();
    if (status === 'red') return false;
    return downloadHealthActivity();
  }

  function healthHeartbeatLabel() {
    const health = state.health || {};
    const status = health.status || 'pending';
    const issues = Array.isArray(health.issues) ? health.issues.length : 0;
    const warnings = Array.isArray(health.warnings) ? health.warnings.length : 0;
    const download = health.download || {};
    const staleDownloads = Number(download.stale_running || 0) > 0 || Boolean(download.last_run?.stale);
    const active = staleDownloads
      ? 'download state stale'
      : downloadHealthActivity()
      ? 'checking IMAP folders'
      : (health.activity ? 'background health/cache active' : 'health/cache OK');
    if (issues) return `PIM Email ${status}, ${issues} issue${issues === 1 ? '' : 's'}, ${active}`;
    if (warnings) return `PIM Email ${status}, ${warnings} warning${warnings === 1 ? '' : 's'}, ${active}`;
    if (downloadHealthActivity()) {
      const running = Number(download.running || 0);
      return `PIM Email checking IMAP folders${running ? `, ${running} run${running === 1 ? '' : 's'} active` : ''}`;
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
    if (!state.loaded || state.folderLoading || !state.messagesHasMore || state.readSource === 'search') return null;
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
    const doc = new DOMParser().parseFromString(`<body>${value}</body>`, 'text/html');
    let changed = false;
    if (entry?.sources?.size) {
      Array.from(doc.images).forEach(img => {
        const local = localMessageImageUrl(img.getAttribute('src') || '');
        if (!local) return;
        const cached = entry.sources.get(local.key);
        if (!cached?.dataUrl) return;
        img.setAttribute('src', cached.dataUrl);
        changed = true;
      });
    }
    if (appendImageOutcomeDetails(doc, message)) changed = true;
    return changed ? doc.body.innerHTML : value;
  }

  function imageDerivativeRows(message) {
    const rows = message?.stored?.external_image_derivatives;
    return Array.isArray(rows) ? rows : [];
  }

  function imageOutcomeMap(message) {
    const outcomes = new Map();
    imageDerivativeRows(message).forEach(row => {
      const status = String(row?.status || '').toLowerCase();
      if (!status || status === 'stored') return;
      const source = String(row?.source_url || '').trim();
      if (!source) return;
      outcomes.set(source, row);
      try {
        outcomes.set(new URL(source).href, row);
      } catch (error) {}
    });
    return outcomes;
  }

  function imageOutcomeText(row) {
    const status = String(row?.status || 'not stored').trim() || 'not stored';
    const reason = String(row?.reason || row?.last_error || 'image was not stored').trim();
    return `${status}: ${reason}`;
  }

  function imageOutcomeMetadata(row) {
    const metadata = row?.metadata;
    return metadata && typeof metadata === 'object' ? metadata : {};
  }

  function cleanImageOutcomeDetail(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  function imageOutcomeMeaning(row) {
    const status = String(row?.status || '').toLowerCase();
    const reason = String(row?.reason || row?.last_error || '').toLowerCase();
    if (reason.includes('could not be decoded safely')) {
      return 'The worker fetched bytes for this URL, then Pillow could not decode, normalize, resize, and re-encode them as a bounded local JPEG. That usually means invalid or truncated image bytes, malformed/unsupported image data, or Pillow refusing a decompression-bomb style payload.';
    }
    if (reason.includes('did not return an image')) {
      return 'The URL did not return a response that the worker was willing to decode as an image. It may have returned HTML, a login/redirect/error body, or a non-image Content-Type.';
    }
    if (reason.includes('payload is too large') || reason.includes('empty or too large')) {
      return 'The image was refused by the size guard before it could be stored locally.';
    }
    if (reason.includes('private or unsafe') || reason.includes('not an allowed http')) {
      return 'The URL was blocked before fetch because it was not a public, safe HTTP(S) image URL.';
    }
    if (status === 'blocked') {
      return 'The worker treated this as unsafe to store as a local image, so the HTML keeps a placeholder instead.';
    }
    if (status === 'unavailable') {
      return 'The worker could not obtain a usable image from this URL, so there is no local image to render.';
    }
    if (status === 'pending') {
      return 'The worker considered this retryable; a later image-worker pass may try again.';
    }
    if (status === 'failed') {
      return 'The worker hit a non-terminal processing failure while trying to fetch or transform this image.';
    }
    return 'The image worker did not store a local image for this source.';
  }

  function imageOutcomeLibraryDetail(row) {
    const metadata = imageOutcomeMetadata(row);
    const errorClass = cleanImageOutcomeDetail(
      metadata.error_cause_class || metadata.cause_class || metadata.error_class,
    );
    const errorMessage = cleanImageOutcomeDetail(
      metadata.error_cause_message || metadata.cause_message || metadata.error_message || row?.last_error,
    );
    if (errorClass && errorMessage) return `${errorClass}: ${errorMessage}`;
    if (errorClass) return errorClass;
    if (errorMessage) return errorMessage;
    if (String(row?.reason || '').toLowerCase().includes('could not be decoded safely')) {
      return 'not recorded for this row; future worker failures include bounded decoder detail when available';
    }
    return '';
  }

  function imageOutcomeHoverText(row) {
    const lines = [imageOutcomeText(row), '', `Meaning: ${imageOutcomeMeaning(row)}`];
    const libraryDetail = imageOutcomeLibraryDetail(row);
    if (libraryDetail) lines.push(`Library detail: ${libraryDetail}`);
    const decision = cleanImageOutcomeDetail(row?.safety_decision);
    if (decision) lines.push(`Worker decision: ${decision}`);
    const contentType = cleanImageOutcomeDetail(row?.content_type);
    if (contentType) lines.push(`Fetched content type: ${contentType}`);
    const transform = cleanImageOutcomeDetail(row?.transform_version);
    if (transform) lines.push(`Transform row: ${transform}`);
    const updated = cleanImageOutcomeDetail(row?.updated_at);
    if (updated) lines.push(`Updated: ${updated}`);
    const source = cleanImageOutcomeDetail(row?.source_url);
    if (source) lines.push(`Original URL: ${source}`);
    return lines.join('\n');
  }

  function imageOutcomeDiagnostic(row, context = {}) {
    const fallbackText = String(context.fallbackText || '').trim();
    const href = cleanImageOutcomeDetail(context.href || '');
    const message = context.message || state.message || {};
    const rawHash = cleanImageOutcomeDetail(message?.raw_sha256);
    const status = row ? String(row?.status || 'not stored').trim() : 'not recorded';
    const reason = row
      ? String(row?.reason || row?.last_error || 'image was not stored').trim()
      : (fallbackText || 'No worker outcome row is recorded for this placeholder yet.');
    const diagnostic = {
      schema: 'xarta.pim_email.image_block_diagnostic.v1',
      summary: row ? imageOutcomeText(row) : reason,
      status,
      reason,
      meaning: row
        ? imageOutcomeMeaning(row)
        : 'The sanitized HTML contains a local-safe placeholder, but the opened message payload did not include a matching external-image derivative row for this source.',
      policy: 'Blueprints never loads remote email images directly in the readable HTML view. The PIM Email image worker must fetch public image bytes, pass URL and size guards, decode them with Pillow, normalize/resize/re-encode them as a bounded local JPEG, validate the result, and store only that local asset. When any gate fails, the sanitized email keeps a placeholder.',
      source_url: cleanImageOutcomeDetail(row?.source_url) || href,
      library_detail: row ? imageOutcomeLibraryDetail(row) : '',
      worker_decision: row ? cleanImageOutcomeDetail(row?.safety_decision) : '',
      content_type: row ? cleanImageOutcomeDetail(row?.content_type) : '',
      transform_version: row ? cleanImageOutcomeDetail(row?.transform_version) : '',
      updated_at: row ? cleanImageOutcomeDetail(row?.updated_at) : '',
      email_uid: cleanImageOutcomeDetail(message?.email_uid || message?.uid),
      raw_sha256: rawHash ? `${rawHash.slice(0, 16)}...` : '',
      fallback_only: !row,
    };
    if (String(reason).toLowerCase().includes('could not be decoded safely')) {
      diagnostic.decode_detail = 'The remote worker received bytes, but the image transform library could not safely open and decode them. Common causes are truncated/corrupt bytes, unsupported image data, a non-image response body, or a decoder/decompression-bomb safety refusal.';
    }
    return diagnostic;
  }

  function imageDiagnosticTitle(diagnostic) {
    const status = diagnostic?.status ? `${diagnostic.status}: ` : '';
    return `${status}${diagnostic?.reason || diagnostic?.summary || 'Remote image blocked'}`;
  }

  function imageDiagnosticDetailText(diagnostic) {
    const rows = [
      ['Meaning', diagnostic?.meaning],
      ['Decode detail', diagnostic?.decode_detail],
      ['Local safety policy', diagnostic?.policy],
      ['Status', diagnostic?.status],
      ['Reason', diagnostic?.reason],
      ['Library detail', diagnostic?.library_detail],
      ['Worker decision', diagnostic?.worker_decision],
      ['Fetched content type', diagnostic?.content_type],
      ['Transform version', diagnostic?.transform_version],
      ['Updated', diagnostic?.updated_at],
      ['Original URL', diagnostic?.source_url],
      ['email_uid', diagnostic?.email_uid],
      ['Raw hash', diagnostic?.raw_sha256],
    ].filter(([, value]) => String(value || '').trim());
    return rows.map(([label, value]) => `${label}:\n${value}`).join('\n\n');
  }

  function encodeImageDiagnostic(diagnostic) {
    try {
      return JSON.stringify(diagnostic || {});
    } catch (error) {
      return '{}';
    }
  }

  function decorateImageDiagnosticElement(element, diagnostic, title) {
    if (!element) return;
    element.classList.add('email-image-diagnostic-trigger');
    element.setAttribute('role', 'button');
    element.setAttribute('tabindex', '0');
    element.setAttribute('title', title);
    element.setAttribute('aria-label', `Open image block detail: ${title}`);
    element.setAttribute('data-email-image-diagnostic', encodeImageDiagnostic(diagnostic));
  }

  async function openImageDiagnosticModal(diagnostic) {
    const title = imageDiagnosticTitle(diagnostic);
    const detail = imageDiagnosticDetailText(diagnostic);
    if (typeof HubDialogs !== 'undefined' && typeof HubDialogs.alert === 'function') {
      await HubDialogs.alert({
        title: 'Remote Image Blocked',
        badge: 'IMG',
        tone: 'warning',
        message: title,
        detail,
        width: 'min(760px,96vw)',
      });
      return true;
    }
    setStatus(title, 'warn');
    return false;
  }

  function parseImageDiagnosticPayload(value) {
    try {
      const parsed = JSON.parse(String(value || '{}'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function imageOriginalForPlaceholder(placeholder) {
    const wrap = placeholder?.closest?.('.email-image-wrap') || null;
    if (wrap) {
      const original = wrap.querySelector('a.email-image-original[href]');
      if (original) return original;
    }
    let next = placeholder?.nextElementSibling || null;
    while (next) {
      if (next.matches?.('a.email-image-original[href]')) return next;
      if (!next.matches?.('.email-image-error')) break;
      next = next.nextElementSibling;
    }
    return null;
  }

  function imageDetailForPlaceholder(placeholder) {
    const next = placeholder?.nextElementSibling || null;
    if (next?.matches?.('.email-image-error')) return next;
    const wrap = placeholder?.closest?.('.email-image-wrap') || null;
    return wrap?.querySelector?.('.email-image-error') || null;
  }

  function appendImageOutcomeDetails(doc, message) {
    const outcomes = imageOutcomeMap(message);
    let changed = false;
    Array.from(doc.querySelectorAll('.email-image-blocked')).forEach(placeholder => {
      const existingDetail = imageDetailForPlaceholder(placeholder);
      const original = imageOriginalForPlaceholder(placeholder);
      if (!placeholder) return;
      const href = String(original?.getAttribute?.('href') || '').trim();
      const row = href ? (outcomes.get(href) || outcomes.get(original?.href || '')) : null;
      const fallbackText = original
        ? 'Remote image blocked in the local-safe view; no worker outcome row is recorded for this source yet.'
        : 'Image blocked in the local-safe view; no worker outcome row is recorded for this placeholder yet.';
      const text = row ? imageOutcomeText(row) : fallbackText;
      const title = row ? imageOutcomeHoverText(row) : (original ? `${fallbackText}\nOriginal URL: ${href}` : fallbackText);
      const diagnostic = imageOutcomeDiagnostic(row, { fallbackText, href, message });
      if (existingDetail) {
        existingDetail.textContent = text;
        decorateImageDiagnosticElement(existingDetail, diagnostic, title);
        decorateImageDiagnosticElement(placeholder, diagnostic, title);
        changed = true;
        return;
      }
      const detail = doc.createElement('span');
      detail.className = 'email-image-error';
      detail.textContent = text;
      decorateImageDiagnosticElement(detail, diagnostic, title);
      decorateImageDiagnosticElement(placeholder, diagnostic, title);
      placeholder.insertAdjacentElement('afterend', detail);
      changed = true;
    });
    return changed;
  }

  function connectHtmlFrameImageDiagnostics(frame) {
    if (!frame) return;
    frame.addEventListener('load', () => {
      let doc = null;
      try {
        doc = frame.contentDocument || frame.contentWindow?.document || null;
      } catch (error) {
        return;
      }
      if (!doc || doc.__emailImageDiagnosticsBound) return;
      doc.__emailImageDiagnosticsBound = true;
      const openFromTarget = target => {
        const trigger = target?.closest?.('.email-image-diagnostic-trigger');
        if (!trigger) return false;
        const diagnostic = parseImageDiagnosticPayload(trigger.getAttribute('data-email-image-diagnostic'));
        openImageDiagnosticModal(diagnostic);
        return true;
      };
      doc.addEventListener('click', event => {
        if (!openFromTarget(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
      });
      doc.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (!openFromTarget(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
      });
    });
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
      const uid = rowMessageUid(row);
      const multiSelected = uid && state.selectedMessageUids.has(uid);
      row.dataset.selected = uid && uid === activeUid ? 'true' : 'false';
      row.dataset.multiSelected = multiSelected ? 'true' : 'false';
      const checkbox = row.querySelector('[data-email-message-select]');
      if (checkbox) checkbox.checked = Boolean(multiSelected);
    });
  }

  function toggleMessageSelection(uid, checked) {
    const clean = String(uid || '').trim();
    if (!clean) return false;
    if (checked) state.selectedMessageUids.add(clean);
    else state.selectedMessageUids.delete(clean);
    syncSelectedMessageRows();
    return true;
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
    const multiSelected = state.selectedMessageUids.has(key);
    const search = row?.search && typeof row.search === 'object' ? row.search : null;
    const sources = Array.isArray(search?.sources) ? search.sources.join('+') : '';
    const score = Number(search?.score || 0);
    const searchMeta = search
      ? `<div class="email-message-search-meta">${escHtml(sources || 'search')}${score ? ` ${escHtml(score.toFixed(3))}` : ''}</div>`
      : '';
    const searchSnippet = search?.snippet
      ? `<div class="email-message-snippet">${escHtml(search.snippet)}</div>`
      : '';
    return `
      <div class="email-message-row" data-email-message-uid="${escHtml(row.uid || '')}" data-email-message-email-uid="${escHtml(row.email_uid || '')}" data-selected="${selected ? 'true' : 'false'}" data-multi-selected="${multiSelected ? 'true' : 'false'}" tabindex="0">
        <label class="hub-checkbox email-row-select" title="Select message" aria-label="Select message ${escHtml(row.subject || row.email_uid || '')}">
          <input class="hub-checkbox__input" type="checkbox" data-email-message-select="${escHtml(key)}"${multiSelected ? ' checked' : ''}>
          <span class="hub-checkbox__box" aria-hidden="true"></span>
        </label>
        <div>
          <div class="email-message-title">${escHtml(row.subject || '(no subject)')}</div>
          <div class="email-message-from">${escHtml(row.from || '')}</div>
          <div class="email-message-date">${escHtml(row.date || '')}</div>
          ${searchMeta}
          ${searchSnippet}
        </div>
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
      host.innerHTML = state.readSource === 'search'
        ? '<div class="email-empty">Searching local email corpus.</div>'
        : `<div class="email-empty">Loading last ${MESSAGE_LIST_LIMIT} messages for ${escHtml(state.folder || 'INBOX')}.</div>`;
      restoreMessageListAnchor(anchor);
      return;
    }
    host.innerHTML = state.messages.length
      ? `${state.messages.map(messageRowHtml).join('')}${messageListTailHtml()}`
      : (state.readSource === 'search'
        ? '<div class="email-empty">No search results loaded.</div>'
        : `<div class="email-empty">No messages loaded for ${escHtml(state.folder || 'INBOX')}.</div>`);
    restoreMessageListAnchor(anchor);
    installMessageRowContextFsms();
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
    const targetUids = contextMessageUids(anchorEl);
    if (!targetUids.length) {
      setStatus('Open a message before using message actions', 'warn');
      return true;
    }
    state.messageContextUids = targetUids;
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

    const multi = targetUids.length > 1;
    const actionColumns = multi
      ? [
          [messageContextButton('copy-selected-message-uids', `Copy ${targetUids.length} email_uids`)],
          [messageContextButton('toggle-original-image-buttons', state.showOriginalImageButtons ? 'Hide original buttons' : 'Show original buttons')],
        ]
      : [
          [messageContextButton('force-refresh-message', 'Force refresh')],
          [messageContextButton('mark-sender-probable-trusted', 'Mark sender probable trusted')],
          [messageContextButton('show-message-uid', 'Show / copy email_uid')],
          [messageContextButton('toggle-original-image-buttons', state.showOriginalImageButtons ? 'Hide original buttons' : 'Show original buttons')],
          [messageContextButton('toggle-markdown-preview', state.renderMarkdownPreview ? 'Show raw Markdown' : 'Render Markdown preview')],
        ];
    actionColumns.forEach(items => {
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
      if (event.target?.closest?.('[data-email-list-toggle], .email-message-row')) return;
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

  function externalImageDerivativeSummary(message = state.message) {
    const storedSummary = message?.stored?.external_image_derivative_summary;
    if (storedSummary && typeof storedSummary === 'object') return storedSummary;
    const securitySummary = message?.html_security?.external_image_derivatives;
    return securitySummary && typeof securitySummary === 'object' ? securitySummary : {};
  }

  function imageOutcomeSummaryText(summary) {
    const total = Number(summary?.total || 0);
    if (!total) return 'no derivative rows for current message';
    const parts = [
      ['stored', summary.stored],
      ['blocked', summary.blocked],
      ['unavailable', summary.unavailable],
      ['pending', summary.pending],
      ['failed', summary.failed],
      ['other', summary.other],
    ].filter(([, value]) => Number(value || 0) > 0)
      .map(([label, value]) => `${Number(value)} ${label}`);
    return `${total} total: ${parts.join(', ')}`;
  }

  function imageReasonSummaryText(summary) {
    const reasons = summary?.reasons && typeof summary.reasons === 'object' ? summary.reasons : {};
    const parts = Object.entries(reasons)
      .filter(([, count]) => Number(count || 0) > 0)
      .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
      .slice(0, 4)
      .map(([reason, count]) => `${Number(count)} ${reason}`);
    return parts.length ? parts.join('; ') : 'no stored failure reasons';
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
    if (proxied) rows.push(`${proxied} image asset${proxied === 1 ? '' : 's'} transformed`);
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

  function currentSecuritySegments() {
    const security = state.message?.security || {};
    const segments = state.securityProgress?.segments?.length
      ? state.securityProgress.segments
      : (security?.progress?.segments || (security?.available ? securitySegmentsFromFindings(security) : []));
    return mergeSecuritySegments([], segments);
  }

  function securitySegmentById(segmentId) {
    const cleanId = String(segmentId || '').trim();
    return currentSecuritySegments().find(segment => segment.id === cleanId) || normalizeSecuritySegment({ id: cleanId });
  }

  function securitySegmentFindings(segmentId) {
    const security = state.message?.security || {};
    const findings = Array.isArray(security.findings) ? security.findings : [];
    const segment = securitySegmentById(segmentId);
    const codes = new Set((segment.finding_codes || []).map(code => String(code || '')).filter(Boolean));
    if (codes.size) return findings.filter(finding => codes.has(String(finding.code || '')));
    const id = String(segmentId || '');
    if (id === 'aggregate') return findings;
    if (id === 'authres_provider') return findings.filter(finding => String(finding.code || '').startsWith('AUTHRES_'));
    if (id === 'dkim_crypto') return findings.filter(finding => String(finding.code || '').startsWith('DKIM_'));
    if (id === 'spf_protocol') return findings.filter(finding => String(finding.code || '').startsWith('SPF_'));
    if (id === 'dmarc_policy') return findings.filter(finding => String(finding.code || '').startsWith('DMARC_'));
    if (id === 'llm_input') return findings.filter(finding => ['LLM_INPUT_SANITIZED', 'LLM_BODY_OVERSIZE'].includes(String(finding.code || '')));
    if (id === 'llm_json') return findings.filter(finding => String(finding.code || '').startsWith('LLM_JSON_'));
    if (id === 'llm_judgement') return findings.filter(finding => String(finding.code || '').startsWith('LLM_SCAM_TRAITS_'));
    return [];
  }

  function securitySegmentDetailHtml(segmentId, security) {
    const id = String(segmentId || '');
    const dkim = security?.dkim || {};
    const spf = security?.spf || {};
    const dmarc = security?.dmarc || {};
    const llm = security?.llm || {};
    const judgement = llm.judgement || {};
    const policy = llm.policy || {};
    if (id === 'authres_provider') return authenticationResultsHtml(security);
    if (id === 'dkim_crypto') {
      return securityKvRowsHtml([
        ['Signatures', dkim.signature_count ?? 0],
        ['Aligned pass', Boolean(dkim.aligned_pass), dkim.aligned_pass ? 'green' : 'amber'],
        ['Failed signatures', Array.isArray(dkim.failed) ? dkim.failed.length : 0, Array.isArray(dkim.failed) && dkim.failed.length ? 'red' : 'green'],
      ]);
    }
    if (id === 'spf_protocol') {
      return securityKvRowsHtml([
        ['Evaluated', Boolean(spf.evaluated), spf.evaluated ? 'green' : 'amber'],
        ['Result', spf.result || 'n/a', spf.result || 'amber'],
        ['Aligned pass', Boolean(spf.aligned_pass), spf.aligned_pass ? 'green' : 'amber'],
        ['Mail-from domain', spf.mail_from_domain || 'n/a'],
        ['Source IP', spf.source_ip || 'n/a'],
      ]);
    }
    if (id === 'dmarc_policy') {
      return securityKvRowsHtml([
        ['Result', dmarc.result || 'n/a', dmarc.result || 'amber'],
        ['Policy', dmarc.policy || 'n/a', dmarc.policy === 'none' ? 'amber' : 'info'],
        ['Policy domain', dmarc.policy_domain || 'n/a'],
        ['Aligned pass', Boolean(dmarc.aligned_pass), dmarc.aligned_pass ? 'green' : 'amber'],
      ]);
    }
    if (id === 'llm_input' || id === 'llm_json' || id === 'llm_judgement') {
      return `
        ${securityKvRowsHtml([
          ['Prompt variant', policy.prompt_variant || 'standard_v1'],
          ['Probable-trusted sender', policy.probable_trusted_sender?.sender_email || 'none', policy.probable_trusted_sender?.sender_email ? 'amber' : 'info'],
          ['Suspicious threshold', policy.suspicious_risk_threshold ?? 50],
          ['Deterministic protections', policy.deterministic_protections || 'unchanged'],
          ['Called', Boolean(llm.called), llm.called ? 'green' : 'amber'],
          ['Model', llm.model || 'n/a'],
          ['Valid JSON', Boolean(llm.valid_json), llm.valid_json ? 'green' : 'red'],
          ['Verdict', judgement.verdict || 'n/a', judgement.verdict || ''],
          ['Risk score', judgement.risk_score ?? 'n/a'],
        ])}
        ${localAiSecurityHtml(security)}
      `;
    }
    return securityKvRowsHtml([
      ['Available', Boolean(security?.available), security?.available ? 'green' : 'red'],
      ['Schema', security?.schema || 'n/a'],
      ['Checked', security?.checked_at || 'n/a'],
      ['Duration', security?.duration_ms ? `${security.duration_ms} ms` : 'n/a'],
    ]);
  }

  function securitySegmentInsightHtml(segmentId) {
    const message = state.message || null;
    const security = message?.security || null;
    const segment = securitySegmentById(segmentId);
    const aggregate = security?.aggregate || {};
    const findings = securitySegmentFindings(segment.id);
    if (!message) return '<div class="email-empty">Open a message to view segment details.</div>';
    if (!security?.available) {
      return `<div class="email-empty">Security result unavailable for ${escHtml(message.email_uid || message.uid || 'this message')}.</div>`;
    }
    return `
      <div class="email-security-segment-modal-body">
        <section class="email-security-segment-summary" data-tone="${escHtml(securityToneName(segment.tone || aggregate.status))}">
          <div>
            <h4>${escHtml(segment.label || segment.id)}</h4>
            <p>${escHtml(aggregate.summary || 'Current message security result.')}</p>
          </div>
          ${securityPillHtml(segment.tone || aggregate.status || 'unknown', segment.tone || aggregate.status)}
        </section>
        ${securityKvRowsHtml([
          ['Segment', segment.id],
          ['Segment status', segment.status || 'pending', segment.tone || aggregate.status],
          ['Aggregate', aggregate.status || 'unknown', aggregate.status],
          ['Score', aggregate.score ?? aggregate.risk_score ?? 'n/a', aggregate.status],
          ['email_uid', message.email_uid || message.uid || 'n/a'],
          ['Raw hash', security.raw_sha256 ? `${String(security.raw_sha256).slice(0, 16)}...` : 'n/a'],
        ])}
        <section class="email-security-section">
          <div class="email-security-section__head">
            <h4>Segment Detail</h4>
            ${securityPillHtml(segment.finding_codes?.length ? `${segment.finding_codes.length} finding codes` : 'no direct codes', segment.finding_codes?.length ? segment.tone : 'info')}
          </div>
          ${securitySegmentDetailHtml(segment.id, security)}
        </section>
        <section class="email-security-section">
          <div class="email-security-section__head">
            <h4>Findings</h4>
            ${securityPillHtml(`${findings.length} shown`, findings.length ? segment.tone : 'info')}
          </div>
          ${findings.length ? securityFindingsHtml({ findings }) : '<div class="email-empty">No findings are mapped directly to this segment.</div>'}
        </section>
      </div>
    `;
  }

  function openSecuritySegmentModal(segmentId) {
    const modal = el('email-security-segment-modal');
    const title = el('email-security-segment-modal-title');
    const body = el('email-security-segment-modal-body');
    const status = el('email-security-segment-modal-status');
    if (!modal || !body) return false;
    const segment = securitySegmentById(segmentId);
    if (title) title.textContent = `${segment.label || segment.id} Security`;
    body.innerHTML = securitySegmentInsightHtml(segment.id);
    if (status) status.textContent = state.message?.email_uid || '';
    state.securitySegmentModalOpen = true;
    if (typeof HubModal !== 'undefined') HubModal.open(modal, { onClose: () => { state.securitySegmentModalOpen = false; } });
    else if (typeof modal.showModal === 'function' && !modal.open) modal.showModal();
    return true;
  }

  function closeSecuritySegmentModal() {
    const modal = el('email-security-segment-modal');
    if (!modal) return;
    state.securitySegmentModalOpen = false;
    if (typeof HubModal !== 'undefined') HubModal.close(modal);
    else if (typeof modal.close === 'function') modal.close();
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
    ${state.showOriginalImageButtons ? '' : '.email-image-original { display:none !important; }'}
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
    .email-image-error {
      display:block;
      justify-self:start;
      max-width:min(100%, 720px);
      border:1px solid #ffb3b3;
      border-radius:5px;
      background:#6f1017;
      color:#fff;
      padding:5px 8px;
      font-size:12px;
      line-height:1.35;
      white-space:normal;
    }
    .email-image-diagnostic-trigger {
      cursor:pointer;
    }
    .email-image-diagnostic-trigger:focus-visible {
      outline:2px solid #1458b8;
      outline-offset:2px;
    }
  </style>
</head>
<body data-original-image-buttons="${state.showOriginalImageButtons ? 'shown' : 'hidden'}">${bodyHtml}</body>
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
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('title', 'Sanitized email HTML');
    connectHtmlFrameImageDiagnostics(frame);
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

  function safeMarkdownHref(value) {
    const clean = String(value || '').trim();
    if (!clean) return '';
    if (clean.startsWith('/api/v1/personal/email/local/images/')) return clean;
    if (/^https?:\/\//i.test(clean)) return clean;
    if (/^(?:mailto|tel):[^\s]+$/i.test(clean)) return clean;
    try {
      const url = new URL(clean, window.location?.origin || undefined);
      if (url.origin === window.location?.origin && url.pathname.startsWith('/api/v1/personal/email/local/images/')) {
        return url.href;
      }
    } catch (error) {}
    return '';
  }

  function safeMarkdownImageSrc(value) {
    const clean = String(value || '').trim();
    if (!clean) return '';
    if (clean.startsWith('/api/v1/personal/email/local/images/')) return clean;
    if (/^data:image\//i.test(clean)) return clean;
    try {
      const url = new URL(clean, window.location?.origin || undefined);
      if (url.origin === window.location?.origin && url.pathname.startsWith('/api/v1/personal/email/local/images/')) {
        return url.href;
      }
    } catch (error) {}
    return '';
  }

  function rawMarkdownText(value) {
    const clean = String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    return clean || 'No Markdown view is available for this message.';
  }

  function sharedMarkdownHtml(value) {
    const renderer = window.BlueprintsMarkdown?.render;
    if (typeof renderer === 'function') {
      return renderer(value, { emptyText: 'No Markdown view is available for this message.' });
    }
    return `<pre class="email-markdown-raw">${escHtml(rawMarkdownText(value))}</pre>`;
  }

  function sanitizeEmailMarkdownPreview(shell) {
    if (!shell) return;
    shell.querySelectorAll('img').forEach(img => {
      const cleanSrc = safeMarkdownImageSrc(img.getAttribute('src') || img.getAttribute('data-rich-md-image-uri') || '');
      if (!cleanSrc) {
        const blocked = document.createElement('span');
        blocked.className = 'email-markdown-image-blocked';
        const alt = String(img.getAttribute('alt') || '').trim();
        blocked.textContent = alt ? `[image blocked: ${alt}]` : '[image blocked]';
        img.replaceWith(blocked);
        return;
      }
      img.setAttribute('src', cleanSrc);
      img.classList.add('email-markdown-image');
      img.setAttribute('loading', 'lazy');
    });
    shell.querySelectorAll('a[href]').forEach(anchor => {
      const cleanHref = safeMarkdownHref(anchor.getAttribute('href') || '');
      if (!cleanHref) {
        const blocked = document.createElement('span');
        blocked.className = 'email-markdown-link-blocked';
        blocked.textContent = anchor.textContent || anchor.getAttribute('href') || '';
        anchor.replaceWith(blocked);
        return;
      }
      anchor.setAttribute('href', cleanHref);
      if (/^https?:\/\//i.test(cleanHref)) {
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener noreferrer');
      } else {
        anchor.removeAttribute('target');
        anchor.removeAttribute('rel');
      }
    });
  }

  function renderRawMarkdownMessage(content, value) {
    const pre = document.createElement('pre');
    pre.className = 'email-markdown-view email-markdown-raw';
    pre.textContent = rawMarkdownText(value);
    content.textContent = '';
    content.appendChild(pre);
  }

  function renderMarkdownMessage(content, value) {
    if (!state.renderMarkdownPreview) {
      renderRawMarkdownMessage(content, value);
      return;
    }
    const shell = document.createElement('div');
    shell.className = 'email-markdown-view calendar-markdown-preview';
    shell.dataset.emailMarkdownMode = 'preview';
    shell.innerHTML = sharedMarkdownHtml(value);
    sanitizeEmailMarkdownPreview(shell);
    content.textContent = '';
    content.appendChild(shell);
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
    if (state.view === 'markdown') {
      renderMarkdownMessage(content, value);
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
    const imageSummary = externalImageDerivativeSummary();
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
      ['HTML sandbox', 'srcdoc iframe, no email scripts; parent-only diagnostic click bridge'],
      ['Image assets', 'worker JPEG transforms, no remote fetch on open'],
      ['Local image assets', proxied ? `${proxied} transformed/rendered` : 'none in current message'],
      ['Remote images', imageSummary.total ? `${imageSummary.stored || 0} stored, ${imageSummary.blocked || 0} blocked, ${imageSummary.unavailable || 0} unavailable` : (remote ? `${remote} blocked` : 'none in current message')],
      ['Remote image outcomes', imageOutcomeSummaryText(imageSummary)],
      ['Image failure reasons', imageReasonSummaryText(imageSummary)],
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

  function trustedSendersRowsHtml() {
    const rows = Array.isArray(state.trustedSenders) ? state.trustedSenders : [];
    if (state.trustedLoading && !rows.length) {
      return '<div class="email-empty">Loading probable trusted senders.</div>';
    }
    if (state.trustedError) {
      return `<div class="email-empty">${escHtml(state.trustedError)}</div>`;
    }
    if (!rows.length) {
      return '<div class="email-empty">No probable trusted senders have been added.</div>';
    }
    return `
      <div class="email-trusted-table">
        ${rows.map(row => `
          <div class="email-trusted-row">
            <div class="email-trusted-row__main">
              <strong>${escHtml(row.sender_email || '')}</strong>
              <span>${escHtml(row.display_name || row.sender_domain || 'probable trusted')}</span>
              <span>${escHtml(row.updated_at || '')}</span>
            </div>
            <button class="email-trusted-remove" type="button" data-email-trusted-remove="${escHtml(row.sender_email || '')}">Remove</button>
          </div>
        `).join('')}
      </div>
    `;
  }

  function trustedSendersHtml() {
    return `
      <div class="email-trusted-panel">
        <div class="email-trusted-tabs" role="tablist" aria-label="Trusted sender tables">
          <button type="button" data-email-trusted-tab="probable" data-active="${state.trustedNestedTab === 'probable' ? 'true' : 'false'}">Probable trusted senders</button>
        </div>
        <section class="email-trusted-section">
          <div class="email-cache-section__head">
            <h4>Probable Trusted Senders</h4>
            ${securityPillHtml(`${state.trustedSenders.length} active`, 'info')}
          </div>
          <form class="email-trusted-add" data-email-trusted-add-form>
            <input type="email" name="sender_email" placeholder="sender@example.com" autocomplete="off" required>
            <button type="submit">Add</button>
          </form>
          ${trustedSendersRowsHtml()}
        </section>
      </div>
    `;
  }

  function searchSummaryHtml() {
    if (state.searchLoading) return '<div class="email-empty">Searching local corpus.</div>';
    if (state.searchError) return `<div class="email-empty">${escHtml(state.searchError)}</div>`;
    const result = state.searchResults;
    if (!result) return '';
    const timings = result.timings || {};
    const index = result.index || {};
    const docs = Number(index.documents || 0);
    const vectors = Number(index.vectors_indexed || 0);
    const bits = [
      `${result.total ?? state.messages.length} candidates`,
      `${timings.elapsed_ms ?? state.searchLastElapsedMs ?? 0} ms`,
      `PG ${timings.postgres_ms ?? 0} ms`,
      `Vec ${timings.vector_ms ?? 0} ms`,
      `Rank ${timings.rerank_ms ?? 0} ms`,
      `${vectors}/${docs} vectors`,
    ];
    return `
      <div class="email-search-summary">
        ${bits.map(bit => `<span>${escHtml(bit)}</span>`).join('')}
      </div>
    `;
  }

  function searchTermRowsHtml() {
    return normalizeSearchTerms(state.searchTerms).map((term, index) => `
      <div class="email-search-row" data-email-search-row>
        <select data-email-search-term-operator aria-label="Operator"${index === 0 ? ' disabled' : ''}>
          <option value="AND"${term.operator !== 'OR' ? ' selected' : ''}>AND</option>
          <option value="OR"${term.operator === 'OR' ? ' selected' : ''}>OR</option>
        </select>
        <select data-email-search-term-field aria-label="Field">
          ${searchFieldOptionsHtml(term.field)}
        </select>
        <input type="text" data-email-search-term-value value="${escHtml(term.value)}" placeholder="term, phrase, or wild*" autocomplete="off">
        <button class="email-search-icon-btn" type="button" data-email-search-remove-row="${index}" aria-label="Remove search row"${index === 0 ? ' disabled' : ''}>X</button>
      </div>
    `).join('');
  }

  function searchDateFieldHtml(key, label, value) {
    return `
      <label class="email-search-date-field">
        <span>${escHtml(label)}</span>
        <span class="email-search-date-control">
          <input type="datetime-local" data-email-search-date="${escHtml(key)}" value="${escHtml(value)}" aria-label="${escHtml(label)}">
          <button class="email-search-clear-date" type="button" data-email-search-clear-date="${escHtml(key)}" aria-label="Clear ${escHtml(label)}" title="Clear ${escHtml(label)}"></button>
        </span>
      </label>
    `;
  }

  function emailSearchHtml() {
    const advanced = state.searchMode === 'advanced';
    return `
      <div class="email-search-panel">
        <form class="email-search-form" data-email-search-form>
          <div class="email-search-toolbar">
            <div class="email-search-mode" role="radiogroup" aria-label="Search mode">
              <label><input type="radio" name="email-search-mode" data-email-search-mode value="simple"${advanced ? '' : ' checked'}> Simple</label>
              <label><input type="radio" name="email-search-mode" data-email-search-mode value="advanced"${advanced ? ' checked' : ''}> Advanced</label>
            </div>
            <button type="submit" class="email-search-submit"${state.searchLoading ? ' disabled' : ''}>Search</button>
          </div>
          <div class="email-search-simple"${advanced ? ' hidden' : ''}>
            <input type="search" data-email-search-query value="${escHtml(state.searchQuery)}" placeholder="Search email" autocomplete="off">
          </div>
          <div class="email-search-advanced"${advanced ? '' : ' hidden'}>
            ${searchTermRowsHtml()}
            <button class="email-search-add-row" type="button" data-email-search-add-row>Add row</button>
          </div>
          <div class="email-search-filters">
            <select data-email-search-folder aria-label="Folder">
              ${searchFolderOptionsHtml()}
            </select>
            ${searchDateFieldHtml('received-from', 'Received from', state.searchReceivedFrom)}
            ${searchDateFieldHtml('received-to', 'Received to', state.searchReceivedTo)}
            ${searchDateFieldHtml('sent-from', 'Sent from', state.searchSentFrom)}
            ${searchDateFieldHtml('sent-to', 'Sent to', state.searchSentTo)}
          </div>
          <div class="email-search-toggles">
            <label class="hub-checkbox email-search-toggle">
              <input class="hub-checkbox__input" type="checkbox" data-email-search-toggle="hybrid"${state.searchHybrid ? ' checked' : ''}>
              <span class="hub-checkbox__box" aria-hidden="true"></span>
              <span class="hub-checkbox__label">Hybrid</span>
            </label>
            <label class="hub-checkbox email-search-toggle">
              <input class="hub-checkbox__input" type="checkbox" data-email-search-toggle="rerank"${state.searchRerank ? ' checked' : ''}>
              <span class="hub-checkbox__box" aria-hidden="true"></span>
              <span class="hub-checkbox__label">Rerank</span>
            </label>
          </div>
        </form>
        ${searchSummaryHtml()}
      </div>
    `;
  }

  async function refreshTrustedSenders(options = {}) {
    if (state.trustedLoading) return state.trustedSenders;
    state.trustedLoading = true;
    state.trustedError = '';
    if (!options.silent) renderSecondaryPanels();
    try {
      const data = await fetchJson(trustedProbableSendersEndpoint());
      state.trustedSenders = Array.isArray(data.probable_trusted_senders)
        ? data.probable_trusted_senders
        : [];
      state.trustedLoaded = true;
      return state.trustedSenders;
    } catch (error) {
      state.trustedError = error.message || String(error);
      return state.trustedSenders;
    } finally {
      state.trustedLoading = false;
      if (state.secondaryTab === 'trusted') {
        renderSecondaryPanels();
        renderUltrawide();
      }
    }
  }

  async function addTrustedSenderFromForm(form) {
    const input = form?.querySelector?.('input[name="sender_email"]');
    const sender = String(input?.value || '').trim();
    if (!sender) return false;
    setStatus('Adding probable trusted sender', 'unknown');
    try {
      await fetchJson(trustedProbableSendersEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender_email: sender }),
      });
      if (input) input.value = '';
      await refreshTrustedSenders({ silent: true });
      setStatus(`Added ${sender} probable trusted`, 'ok');
      return true;
    } catch (error) {
      setStatus(error.message || String(error), 'err');
      return false;
    }
  }

  async function removeTrustedSender(senderEmail) {
    const sender = String(senderEmail || '').trim();
    if (!sender) return false;
    setStatus('Removing probable trusted sender', 'unknown');
    try {
      await fetchJson(trustedProbableSenderDeleteEndpoint(sender), { method: 'DELETE' });
      await refreshTrustedSenders({ silent: true });
      setStatus(`Removed ${sender} probable trusted`, 'ok');
      return true;
    } catch (error) {
      setStatus(error.message || String(error), 'err');
      return false;
    }
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
      ['trusted', 'Trusted'],
      ['search', 'Search'],
    ];
    return tabs.map(([id, label]) => `
      <button type="button" data-email-secondary-tab="${escHtml(id)}" data-active="${state.secondaryTab === id ? 'true' : 'false'}" data-email-secondary-layout="${escHtml(layout)}">${escHtml(label)}</button>
    `).join('');
  }

  function secondaryBodyHtml() {
    if (state.secondaryTab === 'checks') return capabilityRowsHtml();
    if (state.secondaryTab === 'security') return messageSecurityHtml();
    if (state.secondaryTab === 'cache') return cacheStatusHtml();
    if (state.secondaryTab === 'trusted') return trustedSendersHtml();
    if (state.secondaryTab === 'search') return emailSearchHtml();
    return foldersHtml();
  }

  function renderSecondaryPanels() {
    const focusSnapshot = captureSearchFocus();
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
        : (state.secondaryTab === 'checks' ? 'Email Checks' : (state.secondaryTab === 'cache' ? 'Email Cache' : (state.secondaryTab === 'trusted' ? 'Email Trusted' : (state.secondaryTab === 'search' ? 'Email Search' : 'Email Folders'))));
    }
    restoreSearchFocus(focusSnapshot);
  }

  function renderUltrawide() {
    if (typeof window.UltrawideSidecar === 'undefined') return;
    const active = document.getElementById('tab-email')?.classList.contains('active');
    const match = window.matchMedia ? window.matchMedia(ULTRAWIDE_QUERY).matches : false;
    if (!active || !match) return;
    const focusSnapshot = captureSearchFocus();
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
    restoreSearchFocus(focusSnapshot);
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
      const tone = healthTone();
      if (!options.silent || (tone !== 'red' && staleHealthErrorVisible())) {
        setStatus(
          staleHealthErrorVisible() ? 'Email health restored' : 'Email health refreshed',
          tone === 'red' ? 'err' : (tone === 'amber' ? 'warn' : 'ok')
        );
      }
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
      const cacheAge = Date.now() - Number(state.cacheStatusLastRefreshed || 0);
      if (state.secondaryTab === 'cache' || cacheAge >= CACHE_STATUS_POLL_MS) {
        refreshCacheStatus({ silent: true });
      }
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
    state.readSource = 'local';
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

  async function runEmailSearch(options = {}) {
    if (options.form) readSearchForm(options.form);
    const append = Boolean(options.append);
    const offset = append ? Math.max(0, Number(options.offset || state.messageListOffset || state.messages.length)) : 0;
    const limit = append ? MESSAGE_PREFETCH_AHEAD : MESSAGE_LIST_LIMIT;
    const seq = append ? state.searchSeq : state.searchSeq + 1;
    if (!append) {
      state.searchSeq = seq;
      state.folderLoadSeq += 1;
      state.folder = 'Search';
      state.readSource = 'search';
      state.message = null;
      state.messages = [];
      state.messageListOffset = 0;
      state.messageListTotal = null;
      state.messagesHasMore = false;
      state.messagesLoadingMore = false;
      state.searchResults = null;
      state.searchError = '';
      state.searchLastElapsedMs = null;
      clearMessagePrefetch();
      state.messageWarmSeen = new Set();
      resetMessagePrefetchQueues();
      state.messageListSignature = '';
      state.messagePendingUid = '';
      state.folderLoading = true;
      state.searchLoading = true;
      setStatus('Searching local email corpus', 'unknown');
      renderAll();
    } else {
      if (state.searchLoading || state.messagesLoadingMore || !state.messagesHasMore) return false;
      state.messagesLoadingMore = true;
      state.searchLoading = true;
      renderMessages({ preserveScroll: true });
    }
    const startedAt = performance.now();
    try {
      const payload = currentSearchPayload({ offset, limit });
      const data = await fetchJson(searchEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (seq !== state.searchSeq || state.readSource !== 'search') return false;
      state.mailbox = data.mailbox || state.mailbox;
      state.searchResults = data || null;
      state.searchError = '';
      state.searchLastElapsedMs = Number(data?.timings?.elapsed_ms || Math.round(performance.now() - startedAt));
      applyMessageListResponse(data, { append, offset });
      state.folderLoading = false;
      state.messagesLoadingMore = false;
      setStatus(`Search returned ${state.messages.length} messages in ${state.searchLastElapsedMs} ms`, 'ok');
      if (append) {
        renderMessages({ preserveScroll: true });
        renderSecondaryPanels();
      } else {
        renderAll();
      }
      refreshCacheStatus({ silent: true });
      return true;
    } catch (error) {
      if (seq !== state.searchSeq) return false;
      state.searchError = error.message || String(error);
      if (!append) state.messages = [];
      state.folderLoading = false;
      state.messagesLoadingMore = false;
      setStatus(state.searchError, 'err');
      renderAll();
      return false;
    } finally {
      if (seq === state.searchSeq) {
        state.searchLoading = false;
        state.folderLoading = false;
        state.messagesLoadingMore = false;
        renderSecondaryPanels();
      }
    }
  }

  async function loadMoreSearch() {
    if (!state.loaded || state.readSource !== 'search' || state.folderLoading || state.messagesLoadingMore || !state.messagesHasMore) return false;
    return runEmailSearch({
      append: true,
      offset: state.messageListOffset || state.messages.length,
    });
  }

  async function loadMoreMessages() {
    if (!state.loaded || state.folderLoading || state.messagesLoadingMore || !state.messagesHasMore) return false;
    if (state.readSource === 'search') return loadMoreSearch();
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

  async function searchPanel() {
    if (!state.loaded) await load();
    state.secondaryTab = 'search';
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
      if (isMessagePayload(data.message)) {
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

  async function copyText(value) {
    const text = String(value || '');
    if (!text) return false;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.left = '-1000px';
    document.body.appendChild(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } finally {
      area.remove();
    }
    return copied;
  }

  async function showMessageUid() {
    closeMessageContextMenu();
    const contextUids = currentContextMessageUids();
    const uid = contextUids.length === 1 ? contextUids[0] : activeMessageUid();
    if (!uid) {
      setStatus('Open a message before copying email_uid', 'warn');
      return false;
    }
    let copied = false;
    try {
      copied = await copyText(uid);
    } catch (error) {
      copied = false;
    }
    setStatus(copied ? 'Message email_uid copied' : 'Message email_uid ready to copy', copied ? 'ok' : 'warn');
    if (typeof HubDialogs !== 'undefined' && typeof HubDialogs.alert === 'function') {
      await HubDialogs.alert({
        title: 'Message email_uid',
        message: uid,
        tone: copied ? 'success' : 'info',
      });
    }
    return copied;
  }

  async function copySelectedMessageUids() {
    closeMessageContextMenu();
    const uids = currentContextMessageUids();
    if (!uids.length) {
      setStatus('Select messages before copying email_uids', 'warn');
      return false;
    }
    const text = uids.join('\n');
    let copied = false;
    try {
      copied = await copyText(text);
    } catch (error) {
      copied = false;
    }
    setStatus(copied ? `${uids.length} email_uids copied` : `${uids.length} email_uids ready to copy`, copied ? 'ok' : 'warn');
    return copied;
  }

  function toggleOriginalImageButtons() {
    closeMessageContextMenu();
    state.showOriginalImageButtons = !state.showOriginalImageButtons;
    try {
      window.localStorage?.setItem(
        ORIGINAL_IMAGE_BUTTONS_STORAGE_KEY,
        state.showOriginalImageButtons ? 'true' : 'false',
      );
    } catch (error) {}
    if (state.view === 'html') renderMessage();
    setStatus(
      state.showOriginalImageButtons ? 'Sanitized HTML original buttons shown' : 'Sanitized HTML original buttons hidden',
      'ok',
    );
    return true;
  }

  function toggleMarkdownPreview() {
    closeMessageContextMenu();
    state.renderMarkdownPreview = !state.renderMarkdownPreview;
    try {
      window.localStorage?.setItem(
        MARKDOWN_PREVIEW_STORAGE_KEY,
        state.renderMarkdownPreview ? 'true' : 'false',
      );
    } catch (error) {}
    if (state.view === 'markdown') renderMessage();
    setStatus(
      state.renderMarkdownPreview ? 'Markdown preview rendered' : 'Raw Markdown shown',
      'ok',
    );
    return true;
  }

  function messageHasProbableTrustedSecurity(message, senderEmail = '') {
    const llm = message?.security?.llm || {};
    const policy = llm.policy || {};
    const trusted = policy.probable_trusted_sender || {};
    const expectedSender = String(senderEmail || '').trim().toLowerCase();
    const actualSender = String(trusted.sender_email || '').trim().toLowerCase();
    return policy.prompt_variant === 'probable_trusted_sender_v1'
      && (!expectedSender || actualSender === expectedSender);
  }

  async function waitForProbableTrustedSecurityResult(uid, senderEmail = '') {
    let latestMessage = null;
    let lastError = null;
    for (let attempt = 0; attempt < PROBABLE_TRUSTED_SECURITY_POLL_ATTEMPTS; attempt += 1) {
      try {
        const refreshed = await fetchJson(messageEndpoint(uid));
        latestMessage = refreshed.message || latestMessage;
        if (messageHasProbableTrustedSecurity(latestMessage, senderEmail)) {
          return { settled: true, message: latestMessage, error: null };
        }
      } catch (error) {
        lastError = error;
      }
      if (attempt + 1 < PROBABLE_TRUSTED_SECURITY_POLL_ATTEMPTS) {
        await delay(PROBABLE_TRUSTED_SECURITY_POLL_MS);
      }
    }
    return { settled: false, message: latestMessage, error: lastError };
  }

  async function markSenderProbableTrusted() {
    closeMessageContextMenu();
    const uid = activeMessageUid();
    if (!uid) {
      setStatus('Open a message before marking sender trust', 'warn');
      return false;
    }
    setStatus('Marking sender probable trusted', 'unknown');
    try {
      invalidateOpenedMessageCache(uid);
      const data = await fetchJson(probableTrustedEndpoint(uid), { method: 'POST' });
      const sender = data?.probable_trusted_sender?.sender_email || 'sender';
      setStatus(`Marked ${sender} probable trusted; waiting for security LLM`, 'unknown');
      const refreshed = await waitForProbableTrustedSecurityResult(uid, sender);
      if (refreshed.message) {
        cacheOpenedMessage(uid, null, refreshed.message);
        if (activeMessageUid() === uid) {
          state.message = refreshed.message;
          state.view = defaultMessageView(state.message);
          state.securityProgress = null;
          renderMessage();
          renderSecondaryPanels();
          renderUltrawide();
          syncSelectedMessageRows();
        }
      }
      const done = refreshed.settled;
      const suffix = done ? 'security LLM complete' : 'security LLM still queued';
      setStatus(`Marked ${sender} probable trusted; ${suffix}`, done ? 'ok' : 'warn');
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

  function rectSnapshot(node) {
    if (!node || typeof node.getBoundingClientRect !== 'function') return null;
    const rect = node.getBoundingClientRect();
    const round = value => Math.round(Number(value || 0) * 100) / 100;
    return {
      x: round(rect.x),
      y: round(rect.y),
      width: round(rect.width),
      height: round(rect.height),
      top: round(rect.top),
      right: round(rect.right),
      bottom: round(rect.bottom),
      left: round(rect.left),
    };
  }

  function trustedAddLayoutFor(surface, selector) {
    const form = document.querySelector(selector);
    if (!form) return { surface, present: false, visible: false };
    const input = form.querySelector('input');
    const button = form.querySelector('button');
    const formRect = rectSnapshot(form);
    const inputRect = rectSnapshot(input);
    const buttonRect = rectSnapshot(button);
    const formStyle = window.getComputedStyle ? window.getComputedStyle(form) : null;
    const buttonStyle = window.getComputedStyle && button ? window.getComputedStyle(button) : null;
    const visible = !!(
      formRect
      && formRect.width > 0
      && formRect.height > 0
      && formStyle?.display !== 'none'
      && formStyle?.visibility !== 'hidden'
    );
    const sameRow = !!(inputRect && buttonRect && Math.abs(inputRect.top - buttonRect.top) <= 2);
    const buttonDropped = !!(inputRect && buttonRect && buttonRect.top > inputRect.bottom - 2);
    const inputOverflowsForm = !!(formRect && inputRect && inputRect.right > formRect.right + 1);
    const buttonOverflowsForm = !!(formRect && buttonRect && buttonRect.right > formRect.right + 1);
    return {
      surface,
      present: true,
      visible,
      same_row: sameRow,
      button_dropped: buttonDropped,
      input_overflows_form: inputOverflowsForm,
      button_overflows_form: buttonOverflowsForm,
      form_display: formStyle?.display || '',
      form_columns: formStyle?.gridTemplateColumns || '',
      button_width: buttonRect?.width || 0,
      button_display: buttonStyle?.display || '',
      form_rect: formRect,
      input_rect: inputRect,
      button_rect: buttonRect,
    };
  }

  function trustedAddLayoutSnapshot() {
    const surfaces = [
      trustedAddLayoutFor('bottom', '#email-secondary-bottom-body .email-trusted-add'),
      trustedAddLayoutFor('modal', '#email-secondary-modal-body .email-trusted-add'),
      trustedAddLayoutFor('ultrawide', '#ultrawide-sidecar .email-trusted-add'),
    ];
    const active = surfaces.find(item => item.visible) || surfaces.find(item => item.present) || null;
    return {
      active_surface: active?.surface || '',
      same_row: !!active?.same_row,
      button_dropped: !!active?.button_dropped,
      input_overflows_form: !!active?.input_overflows_form,
      button_overflows_form: !!active?.button_overflows_form,
      surfaces,
    };
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
    if (action === 'mark-sender-probable-trusted') return markSenderProbableTrusted();
    if (action === 'show-message-uid') return showMessageUid();
    if (action === 'copy-selected-message-uids') return copySelectedMessageUids();
    if (action === 'toggle-original-image-buttons') return toggleOriginalImageButtons();
    if (action === 'toggle-markdown-preview') return toggleMarkdownPreview();
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

  function messageRowTargetUid(row) {
    return rowMessageUid(row);
  }

  function openMessageContextMenuForRow(row) {
    const uid = messageRowTargetUid(row);
    if (!uid) return false;
    state.messagePendingUid = uid;
    syncSelectedMessageRows();
    const opened = openMessageContextMenuAt(row);
    openMessage(uid).catch(error => {
      setStatus(error.message || String(error), 'err');
    });
    return opened;
  }

  function installMessageRowContextFsm(row) {
    if (!row || row.dataset.emailRowContextFsm === '1') return;
    row.dataset.emailRowContextFsm = '1';

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
      row.dataset.emailContextSuppressClick = '1';
      openMessageContextMenuForRow(row);
    };

    row.addEventListener('pointerdown', event => {
      if (event.button !== undefined && event.button !== 0) return;
      if (event.target?.closest?.('[data-email-message-select], .email-row-select')) return;
      fsm.state = 'pressing';
      fsm.pointerId = event.pointerId;
      fsm.startX = event.clientX;
      fsm.startY = event.clientY;
      clearTimer();
      fsm.timer = window.setTimeout(openFromLongPress, MESSAGE_CONTEXT_LONG_PRESS_MS);
      if (typeof row.setPointerCapture === 'function') {
        try {
          row.setPointerCapture(event.pointerId);
        } catch (error) {
          // Pointer capture can fail after fast release; document-level click suppression still handles it.
        }
      }
    });

    row.addEventListener('pointermove', event => {
      if (fsm.state !== 'pressing' || event.pointerId !== fsm.pointerId) return;
      const dx = event.clientX - fsm.startX;
      const dy = event.clientY - fsm.startY;
      if (Math.hypot(dx, dy) > MESSAGE_CONTEXT_MOVE_PX) cancelPress();
    });

    row.addEventListener('pointerup', event => {
      if (event.pointerId !== fsm.pointerId) return;
      if (fsm.state === 'pressing') cancelPress();
      else {
        clearTimer();
        fsm.state = 'idle';
        fsm.pointerId = null;
      }
    });

    row.addEventListener('pointercancel', event => {
      if (event.pointerId === fsm.pointerId) cancelPress();
    });

    row.addEventListener('lostpointercapture', cancelPress);
    row.addEventListener('contextmenu', event => {
      event.preventDefault();
      if (openMessageContextMenuForRow(row)) {
        fsm.suppressNextClick = true;
        row.dataset.emailContextSuppressClick = '1';
      }
    });

    row.addEventListener('click', event => {
      if (!fsm.suppressNextClick && row.dataset.emailContextSuppressClick !== '1') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      fsm.suppressNextClick = false;
      delete row.dataset.emailContextSuppressClick;
    }, true);
  }

  function installMessageContextToggleFsms() {
    document.querySelectorAll('[data-email-list-toggle]').forEach(installMessageContextToggleFsm);
  }

  function installMessageRowContextFsms() {
    document.querySelectorAll('#email-message-list .email-message-row[data-email-message-uid]').forEach(installMessageRowContextFsm);
  }

  function bind() {
    if (document.body.dataset.emailPageBound === '1') return;
    document.body.dataset.emailPageBound = '1';
    installMessageContextToggleFsms();
    installMessageRowContextFsms();
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
      const securitySegment = target.closest?.('[data-email-security-segment]');
      if (securitySegment) {
        event.preventDefault();
        openSecuritySegmentModal(securitySegment.dataset.emailSecuritySegment || securitySegment.dataset.segment || '');
        return;
      }
      const tabBtn = target.closest?.('[data-email-secondary-tab]');
      if (tabBtn) {
        event.preventDefault();
        state.secondaryTab = tabBtn.dataset.emailSecondaryTab || 'folders';
        renderSecondaryPanels();
        renderUltrawide();
        if (state.secondaryTab === 'cache') refreshCacheStatus({ silent: true });
        if (state.secondaryTab === 'trusted' && !state.trustedLoaded) refreshTrustedSenders({ silent: true });
        return;
      }
      const searchClearDate = target.closest?.('[data-email-search-clear-date]');
      if (searchClearDate) {
        event.preventDefault();
        const form = searchClearDate.closest('[data-email-search-form]');
        const key = searchClearDate.dataset.emailSearchClearDate || '';
        const input = Array.from(form?.querySelectorAll?.('[data-email-search-date]') || [])
          .find(node => node.dataset.emailSearchDate === key);
        if (input) input.value = '';
        readSearchForm(form);
        input?.focus?.({ preventScroll: true });
        return;
      }
      const searchAddRow = target.closest?.('[data-email-search-add-row]');
      if (searchAddRow) {
        event.preventDefault();
        const form = searchAddRow.closest('[data-email-search-form]');
        readSearchForm(form);
        state.searchTerms = normalizeSearchTerms(state.searchTerms);
        state.searchTerms.push({ field: 'default', operator: 'AND', value: '' });
        renderSecondaryPanels();
        renderUltrawide();
        return;
      }
      const searchRemoveRow = target.closest?.('[data-email-search-remove-row]');
      if (searchRemoveRow) {
        event.preventDefault();
        const form = searchRemoveRow.closest('[data-email-search-form]');
        readSearchForm(form);
        const index = Number(searchRemoveRow.dataset.emailSearchRemoveRow || -1);
        state.searchTerms = normalizeSearchTerms(state.searchTerms).filter((_, rowIndex) => rowIndex !== index);
        if (!state.searchTerms.length) state.searchTerms = searchDefaultTerms();
        renderSecondaryPanels();
        renderUltrawide();
        return;
      }
      const trustedTab = target.closest?.('[data-email-trusted-tab]');
      if (trustedTab) {
        event.preventDefault();
        state.trustedNestedTab = trustedTab.dataset.emailTrustedTab || 'probable';
        renderSecondaryPanels();
        renderUltrawide();
        if (!state.trustedLoaded) refreshTrustedSenders({ silent: true });
        return;
      }
      const trustedRemove = target.closest?.('[data-email-trusted-remove]');
      if (trustedRemove) {
        event.preventDefault();
        removeTrustedSender(trustedRemove.dataset.emailTrustedRemove || '');
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
      const selectLabel = target.closest?.('.email-row-select');
      if (selectLabel && !target.closest?.('[data-email-message-select]')) {
        event.stopPropagation();
        return;
      }
      const messageSelect = target.closest?.('[data-email-message-select]');
      if (messageSelect) {
        event.stopPropagation();
        toggleMessageSelection(messageSelect.dataset.emailMessageSelect || '', messageSelect.checked);
        return;
      }
      const messageRow = target.closest?.('[data-email-message-uid]');
      if (messageRow) {
        event.preventDefault();
        if (messageRow.dataset.emailContextSuppressClick === '1') {
          delete messageRow.dataset.emailContextSuppressClick;
          return;
        }
        openMessage(messageRow.dataset.emailMessageEmailUid || messageRow.dataset.emailMessageUid || '');
        return;
      }
      if (!target.closest?.('[data-email-folder-dropdown]')) closeFolderMenus();
    });
    document.addEventListener('change', event => {
      const searchForm = event.target.closest?.('[data-email-search-form]');
      if (searchForm) {
        readSearchForm(searchForm);
        if (event.target.closest?.('[data-email-search-mode]')) {
          syncSearchModeControls();
        }
        return;
      }
      const messageSelect = event.target.closest?.('[data-email-message-select]');
      if (!messageSelect) return;
      toggleMessageSelection(messageSelect.dataset.emailMessageSelect || '', messageSelect.checked);
    });
    document.addEventListener('input', event => {
      const searchForm = event.target.closest?.('[data-email-search-form]');
      if (searchForm) {
        readSearchForm(searchForm);
        if (event.target.closest?.('[data-email-search-mode]')) {
          syncSearchModeControls();
        }
      }
    });
    document.addEventListener('submit', event => {
      const searchForm = event.target.closest?.('[data-email-search-form]');
      if (searchForm) {
        event.preventDefault();
        runEmailSearch({ form: searchForm });
        return;
      }
      const form = event.target.closest?.('[data-email-trusted-add-form]');
      if (!form) return;
      event.preventDefault();
      addTrustedSenderFromForm(form);
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest?.('.email-message-row[data-email-message-uid]');
      if (!row) return;
      if (event.target.closest?.('[data-email-message-select], .email-row-select')) return;
      event.preventDefault();
      openMessage(row.dataset.emailMessageEmailUid || row.dataset.emailMessageUid || '');
    });
    ['email-secondary-modal-close', 'email-secondary-modal-footer-close'].forEach(id => {
      const btn = el(id);
      if (btn) btn.addEventListener('click', closeModal);
    });
    ['email-security-segment-modal-close', 'email-security-segment-modal-footer-close'].forEach(id => {
      const btn = el(id);
      if (btn) btn.addEventListener('click', closeSecuritySegmentModal);
    });
    const securitySegmentModal = el('email-security-segment-modal');
    if (securitySegmentModal) {
      securitySegmentModal.addEventListener('close', () => {
        state.securitySegmentModalOpen = false;
      });
    }
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
      search_mode: state.searchMode,
      search_loading: state.searchLoading,
      search_error: state.searchError,
      search_elapsed_ms: state.searchLastElapsedMs,
      search_total: state.searchResults?.total ?? null,
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
      selected_message_count: state.selectedMessageUids.size,
      selected_message_uids: Array.from(state.selectedMessageUids).slice(0, 20),
      show_original_image_buttons: state.showOriginalImageButtons,
      render_markdown_preview: state.renderMarkdownPreview,
      trusted_sender_count: state.trustedSenders.length,
      trusted_loaded: state.trustedLoaded,
      trusted_add_layout: trustedAddLayoutSnapshot(),
      last_message_timing: state.lastMessageTiming,
      message_timings: state.messageTimings.slice(0, 6),
      message_context_menu_open: state.messageContextMenuOpen,
      security_segment_modal_open: state.securitySegmentModalOpen,
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
    searchPanel,
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
    'email.search': () => EmailPage.searchPanel(),
    'email.security': () => EmailPage.securityChecks(),
  });
}
