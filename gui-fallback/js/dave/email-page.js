// Dave Email page - read-only PIM email mailbox view.

'use strict';

const EmailPage = (() => {
  const API_ROOT = '/api/v1/personal/email';
  const ULTRAWIDE_QUERY = '(min-width: 2400px) and (max-height: 1280px)';
  const VIEW_IDS = ['plain', 'html', 'markdown', 'raw'];
  const EMAIL_SECONDARY_TABS = [
    ['checks', 'Checks'],
    ['security', 'Security'],
    ['cache', 'Cache'],
    ['trusted', 'Trusted'],
    ['search', 'Search'],
    ['rules', 'Rules'],
  ];
  const EMAIL_SECONDARY_TAB_IDS = new Set(['folders', ...EMAIL_SECONDARY_TABS.map(([id]) => id)]);
  const EMAIL_SECONDARY_TAB_TITLES = new Map([
    ['folders', 'Email Folders'],
    ['checks', 'Email Checks'],
    ['security', 'Email Security'],
    ['cache', 'Email Cache'],
    ['trusted', 'Email Trusted'],
    ['search', 'Email Search'],
    ['rules', 'Email Rules'],
  ]);
  const TRUSTED_VIEW_OPTIONS = [
    ['probable', 'Probable trusted senders'],
  ];
  const RULES_TOOL_OPTIONS = [
    ['rules', 'Rules list'],
    ['paths', 'Paths'],
    ['bulk', 'Bulk move'],
    ['create', 'Create rule'],
    ['apply', 'Preview/apply'],
  ];
  const RULES_TOOL_IDS = new Set(RULES_TOOL_OPTIONS.map(([id]) => id));
  const VPATH_TREE_LONG_PRESS_MS = 520;
  const MESSAGE_LIST_LIMIT = 100;
  const MESSAGE_PREFETCH_AHEAD = 100;
  const MESSAGE_SCROLL_LOAD_PX = 320;
  const MESSAGE_WARM_LIMIT = 100;
  const MESSAGE_OPEN_CACHE_LIMIT = Number.POSITIVE_INFINITY;
  const MESSAGE_OPEN_CACHE_MAX_BYTES = 512 * 1024 * 1024;
  const MESSAGE_OPEN_CACHE_OPENED_BONUS_MS = 2 * 60 * 60 * 1000;
  const MESSAGE_OPEN_PREFETCH_LIMIT = 100;
  const MESSAGE_OPEN_PREFETCH_QUEUE_LIMIT = 240;
  const MESSAGE_OPEN_PREFETCH_CONCURRENCY = 1;
  const MESSAGE_OPEN_PREFETCH_START_DELAY_MS = 2500;
  const MESSAGE_IMAGE_PREFETCH_CONCURRENCY = 2;
  const MESSAGE_IMAGE_CACHE_SOURCE_LIMIT = 120;
  const MESSAGE_IMAGE_CACHE_MAX_BYTES = 256 * 1024 * 1024;
  const MESSAGE_IMAGE_CACHE_CONCURRENCY = 4;
  const MESSAGE_CONTEXT_MENU_ID = 'email-message-context-menu';
  const MESSAGE_CONTEXT_LONG_PRESS_MS = 420;
  const MESSAGE_CONTEXT_MOVE_PX = 10;
  const PROBABLE_TRUSTED_SECURITY_POLL_MS = 2500;
  const PROBABLE_TRUSTED_SECURITY_POLL_ATTEMPTS = 36;
  const HEALTH_POLL_MS = 15000;
  const CACHE_STATUS_POLL_MS = 30000;
  const ACTIVITY_HEARTBEAT_REFRESH_MS = 1000;
  const CACHE_HEARTBEAT_RECENT_MS = 6000;
  const SECURITY_PROGRESS_EVENT = 'pim.email.security.progress';
  const CACHE_STATE_EVENT = 'pim.email.cache.state';
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
    messageOpenPrefetchControllers: new Map(),
    messageOpenPrefetchPromises: new Map(),
    messageOpenPrefetchPausedUntil: 0,
    messageImagePrefetchSeen: new Set(),
    messageImagePrefetchQueue: [],
    messageImagePrefetchInFlight: 0,
    messageImagePrefetchCompleted: 0,
    messageImagePrefetchFailed: 0,
    messageImagePrefetchSkipped: 0,
    messageImageCache: new Map(),
    messageImageCacheBytes: 0,
    messageServerCacheStates: new Map(),
    messageCacheStateTimer: null,
    messageCacheStateLastRefreshed: 0,
    messageCacheStateError: '',
    messageCacheStateLoading: false,
    messageOpenCacheHit: false,
    messageOpenSeq: 0,
    messagePendingUid: '',
    messageTimings: [],
    lastMessageTiming: null,
    messageOpenTelemetryInFlight: 0,
    messageOpenTelemetryCompleted: 0,
    messageOpenTelemetryFailed: 0,
    messageOpenTelemetryLastError: '',
    lastMessageOpenTelemetry: null,
    cacheStatus: null,
    cacheStatusError: '',
    cacheStatusLoading: false,
    cacheStatusLastRefreshed: 0,
    cacheStatusPollTimer: null,
    cacheStateSseCount: 0,
    cacheStateSseLastAt: 0,
    activityHeartbeat: null,
    activityHeartbeatLoading: false,
    activityHeartbeatError: '',
    activityHeartbeatLastRefreshed: 0,
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
    virtualPaths: [],
    virtualPathCatalogRequestSeq: 0,
    virtualPathRules: [],
    virtualPathRulesLoading: false,
    virtualPathRulesLoaded: false,
    virtualPathRulesError: '',
    virtualPathRuleLastRun: null,
    virtualPathRuleApplyLoading: false,
    virtualPathRuleSearch: '',
    virtualPathRuleTool: 'rules',
    virtualPathRuleExpanded: new Set(),
    virtualPathRuleDrafts: new Map(),
    virtualPathRuleSaving: new Set(),
    virtualPathRuleOpenSections: new Set(),
    virtualPathPicker: {
      open: false,
      targetKey: '',
      mode: 'select',
      selectedPath: '',
      actionPath: '',
      moveSourcePath: '',
      error: '',
    },
    virtualPathPickerDragPath: '',
    virtualPathPickerLongPressTimer: null,
    virtualPathPickerLongPressPath: '',
    virtualPathRuleContextEmailUid: '',
    virtualPathRuleContextLoading: false,
    virtualPathRuleContextError: '',
    virtualPathRuleContextHistory: null,
    virtualPathRuleContextPreview: null,
    virtualPathEditorOpen: false,
    virtualPathEditorEmailUid: '',
    virtualPathEditorPaths: [],
    virtualPathEditorError: '',
    messageContextMenuOpen: false,
    messageContextUids: [],
    securitySegmentModalOpen: false,
    auditLedgerModalOpen: false,
    auditLedgerLoading: false,
    auditLedgerError: '',
    auditLedgerEmailUid: '',
    auditLedgerHistory: null,
    auditLedgerMailbox: null,
    auditLedgerMessageSummary: null,
    auditLedgerSeq: 0,
    auditLedgerLoadedAt: '',
    healthPollTimer: null,
    activityHeartbeatTimer: null,
    emailIntroMinHeight: 0,
    emailIntroHeightLockPending: false,
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
  let auditLedgerLocalDateTimeFormatter = null;

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

  function scheduleEmailIntroHeightLock() {
    if (state.emailIntroHeightLockPending) return;
    state.emailIntroHeightLockPending = true;
    const applyLock = () => {
      state.emailIntroHeightLockPending = false;
      const intro = document.querySelector('#tab-email .email-page--intro');
      if (!intro) return;
      const rectHeight = intro.getBoundingClientRect?.().height || 0;
      const measured = Math.ceil(Math.max(rectHeight, intro.scrollHeight || 0));
      if (!measured) return;
      if (measured > Number(state.emailIntroMinHeight || 0) + 1) {
        state.emailIntroMinHeight = measured;
        intro.style.setProperty('--email-intro-min-height', `${measured}px`);
        if (window.BodyShade && typeof window.BodyShade.scheduleSizeFillTable === 'function') {
          window.BodyShade.scheduleSizeFillTable();
        }
      } else if (state.emailIntroMinHeight > 0) {
        intro.style.setProperty('--email-intro-min-height', `${state.emailIntroMinHeight}px`);
      }
    };
    const schedule = () => {
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(applyLock);
      else window.setTimeout(applyLock, 0);
    };
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(schedule);
    else schedule();
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
    scheduleEmailIntroHeightLock();
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
    const metadata = folderMetadata(folder);
    const semantics = String(metadata.count_semantics || '').trim();
    if (metadata.meta_virtual_folder) {
      const noun = semantics === 'distinct_messages' ? 'message' : 'row';
      return `read-only meta, ${count} ${noun}${count === 1 ? '' : 's'}`;
    }
    if (metadata.virtual_path) {
      const noun = semantics === 'virtual_path_association_rows' ? 'assignment' : 'row';
      return `${count} ${noun}${count === 1 ? '' : 's'}`;
    }
    const roleText = role ? `${role}, ` : '';
    return `${roleText}${count} local row${count === 1 ? '' : 's'}`;
  }

  function folderMetadata(folder) {
    const metadata = folder?.metadata;
    return metadata && typeof metadata === 'object' ? metadata : {};
  }

  function selectedFolderRecord() {
    const active = String(state.folder || 'INBOX').toLocaleLowerCase();
    return state.folders.find(folder => (
      String(folderName(folder) || '').toLocaleLowerCase() === active
    )) || null;
  }

  function selectedFolderCapabilities() {
    const folder = selectedFolderRecord();
    const metadata = folderMetadata(folder);
    const readOnly = Boolean(metadata.read_only || metadata.meta_virtual_folder);
    return {
      read_only: readOnly,
      assignable: !readOnly && metadata.assignable !== false,
      removable: !readOnly && metadata.removable !== false,
      move_controls_enabled: !readOnly && metadata.move_controls_enabled !== false,
      meta_virtual_folder: Boolean(metadata.meta_virtual_folder),
      virtual_folder_suffix: String(metadata.virtual_folder_suffix || ''),
      derived_from_folder: String(metadata.derived_from_folder || ''),
    };
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
    const role = String(node?.folder?.special_use_role || '').trim().toLocaleLowerCase();
    const metadata = folderMetadata(node?.folder);
    if (role.includes('inbox') || metadata.derived_from_folder === 'incoming-corpus') return 'inbox';
    if (role.includes('archive')) return 'archive';
    if (role.includes('draft')) return 'drafts';
    if (role.includes('sent')) return 'sent';
    if (role.includes('trash') || role.includes('junk') || role.includes('spam')) return 'rubbish';
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
    const searchModeControl = layout === 'ultrawide' && state.secondaryTab === 'search'
      ? searchModeToolbarDropdownHtml(layout)
      : '';
    const trustedViewControl = layout === 'ultrawide' && state.secondaryTab === 'trusted'
      ? trustedViewToolbarDropdownHtml(layout)
      : '';
    const rulesToolControl = layout === 'ultrawide' && state.secondaryTab === 'rules'
      ? rulesToolToolbarDropdownHtml(layout)
      : '';
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
        ${searchModeControl}
        ${trustedViewControl}
        ${rulesToolControl}
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

  function cacheMessagesEndpoint() {
    return `${API_ROOT}/local/cache/messages`;
  }

  function cacheStatusEndpoint() {
    return `${API_ROOT}/local/cache/status`;
  }

  function activityEndpoint() {
    return `${API_ROOT}/local/activity`;
  }

  function messageEndpoint(uid, row = null, options = {}) {
    const emailUid = String(row?.email_uid || uid || '').trim();
    const params = new URLSearchParams();
    if (options.opened === false) params.set('opened', 'false');
    const query = params.toString();
    return `${API_ROOT}/local/messages/${encodeURIComponent(emailUid)}${query ? `?${query}` : ''}`;
  }

  function messageOpenedEndpoint(uid, row = null) {
    const emailUid = String(row?.email_uid || uid || '').trim();
    return `${API_ROOT}/local/messages/${encodeURIComponent(emailUid)}/opened`;
  }

  function messageActionsEndpoint(uid, options = {}) {
    const emailUid = String(uid || '').trim();
    const limit = Math.max(1, Math.min(Number(options.limit || 500), 500));
    return `${API_ROOT}/local/messages/${encodeURIComponent(emailUid)}/actions?limit=${limit}`;
  }

  function virtualPathsEndpoint() {
    return `${API_ROOT}/local/virtual-paths`;
  }

  function virtualPathSubtreeEndpoint() {
    return `${API_ROOT}/local/virtual-paths/subtree`;
  }

  function virtualPathBulkMoveEndpoint() {
    return `${API_ROOT}/local/virtual-paths/bulk-move`;
  }

  function messageVirtualPathsReplaceEndpoint(uid) {
    return `${API_ROOT}/local/messages/${encodeURIComponent(uid)}/virtual-paths/replace`;
  }

  function virtualPathRulesEndpoint() {
    return `${API_ROOT}/local/virtual-path-rules`;
  }

  function virtualPathRuleUpdateEndpoint(ruleId) {
    return `${API_ROOT}/local/virtual-path-rules/${encodeURIComponent(ruleId)}`;
  }

  function virtualPathRuleArchiveEndpoint(ruleId) {
    return `${API_ROOT}/local/virtual-path-rules/${encodeURIComponent(ruleId)}/archive`;
  }

  function virtualPathRuleApplyEndpoint() {
    return `${API_ROOT}/local/virtual-path-rules/apply`;
  }

  function messageVirtualPathRuleHistoryEndpoint(uid) {
    return `${API_ROOT}/local/messages/${encodeURIComponent(uid)}/virtual-path-rules/history`;
  }

  function forceRefreshEndpoint(uid) {
    return `${API_ROOT}/local/messages/${encodeURIComponent(uid)}/force-refresh`;
  }

  function localViewRefreshEndpoint(uid) {
    return `${API_ROOT}/local/messages/${encodeURIComponent(uid)}/refresh-local-view`;
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

  const SEARCH_MODE_OPTIONS = [
    ['simple', 'Simple'],
    ['advanced', 'Advanced'],
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

  function searchModeLabel(mode = state.searchMode) {
    const clean = mode === 'advanced' ? 'advanced' : 'simple';
    return SEARCH_MODE_OPTIONS.find(([id]) => id === clean)?.[1] || 'Simple';
  }

  function readSearchForm(form) {
    if (!form) return;
    state.searchMode = state.searchMode === 'advanced' ? 'advanced' : 'simple';
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
      form.classList.toggle('email-search-form--advanced', advanced);
      const simplePanel = form.querySelector('.email-search-simple');
      const advancedPanel = form.querySelector('.email-search-advanced');
      const toolbar = form.querySelector('.email-search-toolbar');
      if (simplePanel) simplePanel.hidden = advanced;
      if (advancedPanel) advancedPanel.hidden = !advanced;
      if (toolbar) toolbar.hidden = advanced;
    });
    document.querySelectorAll('[data-email-search-mode-dropdown]').forEach(dropdown => {
      dropdown.dataset.mode = state.searchMode;
      dropdown.querySelectorAll('[data-email-search-mode-label]').forEach(label => {
        label.textContent = `Search: ${searchModeLabel()}`;
      });
      dropdown.querySelectorAll('[data-email-search-mode-option]').forEach(option => {
        option.setAttribute('aria-checked', option.dataset.emailSearchModeOption === state.searchMode ? 'true' : 'false');
      });
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

  function controlSelectionSnapshot(active) {
    if (!active) return null;
    const type = String(active.type || '').toLowerCase();
    if (
      (type === 'text' || type === 'search' || active.tagName === 'TEXTAREA')
      && typeof active.selectionStart === 'number'
      && typeof active.selectionEnd === 'number'
    ) {
      return {
        start: active.selectionStart,
        end: active.selectionEnd,
        direction: active.selectionDirection || 'none',
      };
    }
    return null;
  }

  function captureSearchFocus() {
    const active = document.activeElement;
    const form = active?.closest?.('[data-email-search-form]');
    if (!form) {
      const preserveKey = String(active?.dataset?.emailPreserveFocus || '').trim();
      if (!preserveKey) return null;
      const root = active.closest?.('#email-secondary-bottom-body, #email-secondary-modal-body, #ultrawide-sidecar');
      return {
        rootId: root?.id || '',
        field: { type: 'preserve', key: preserveKey },
        selection: controlSelectionSnapshot(active),
      };
    }
    const field = searchFocusFieldFor(active, form);
    if (!field) return null;
    readSearchForm(form);
    const root = active.closest?.('#email-secondary-bottom-body, #email-secondary-modal-body, #ultrawide-sidecar');
    const snapshot = {
      rootId: root?.id || '',
      field,
      selection: controlSelectionSnapshot(active),
    };
    return snapshot;
  }

  function matchingControlByData(root, selector, dataKey, dataValue) {
    return Array.from(root.querySelectorAll(selector)).find(node => node.dataset?.[dataKey] === dataValue) || null;
  }

  function searchFocusTarget(root, field) {
    if (!root || !field) return null;
    if (field.type === 'preserve') {
      return matchingControlByData(root, '[data-email-preserve-focus]', 'emailPreserveFocus', field.key);
    }
    if (field.type === 'query') return root.querySelector('[data-email-search-query]');
    if (field.type === 'folder') return root.querySelector('[data-email-search-folder]');
    if (field.type === 'date') return matchingControlByData(root, '[data-email-search-date]', 'emailSearchDate', field.key);
    if (field.type === 'clear-date') return matchingControlByData(root, '[data-email-search-clear-date]', 'emailSearchClearDate', field.key);
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
    const totalCount = Number(state.messageListTotal || 0);
    const folder = state.folder || 'INBOX';
    const metadata = folderMetadata(selectedFolderRecord());
    const countSemantics = String(metadata.count_semantics || '').trim();
    let rowSummary = `${rowCount} ${folder} rows loaded`;
    if (totalCount > 0) {
      rowSummary = `${rowCount}/${totalCount} ${folder} rows loaded`;
      if (countSemantics === 'distinct_messages') {
        rowSummary = `${rowSummary} (${totalCount} distinct messages)`;
      } else if (countSemantics === 'virtual_path_association_rows') {
        rowSummary = `${rowSummary} (${totalCount} assignments)`;
      }
    }
    const source = 'local corpus';
    meta.textContent = `${mailboxAddress()} - ${source} - ${folderCount} folders - ${rowSummary}`;
    scheduleEmailIntroHeightLock();
  }

  function renderFolderChip() {
    const chip = el('email-folder-chip');
    if (chip) chip.textContent = `Folder: ${state.folder || 'INBOX'}`;
  }

  function browserActivityHeartbeatActive() {
    const recentCacheStateEvent = state.cacheStateSseLastAt
      && Date.now() - state.cacheStateSseLastAt < CACHE_HEARTBEAT_RECENT_MS;
    return Boolean(
      recentCacheStateEvent
      || state.cacheStatusLoading
      || state.messageCacheStateLoading
      || state.messageOpenTelemetryInFlight > 0
      || state.messageOpenPrefetchInFlight > 0
      || state.messageOpenPrefetchQueue.length > 0
      || state.messageImagePrefetchInFlight > 0
      || state.messageImagePrefetchQueue.length > 0
      || Array.from(state.messageImageCache.values()).some(entry => entry?.pending)
    );
  }

  function stackActivityHeartbeat() {
    const activity = state.activityHeartbeat;
    return activity && typeof activity === 'object' && !Array.isArray(activity) ? activity : {};
  }

  function stackActivityHeartbeatActive() {
    return Boolean(stackActivityHeartbeat().active);
  }

  function activityHeartbeatActive() {
    return stackActivityHeartbeatActive() || browserActivityHeartbeatActive();
  }

  function activityHeartbeatTone() {
    const stack = stackActivityHeartbeat();
    const tone = String(stack.tone || '').toLowerCase();
    if (stack.active && ['green', 'amber', 'red'].includes(tone)) return tone;
    if (browserActivityHeartbeatActive()) return 'amber';
    return 'unknown';
  }

  function activityHeartbeatLabel() {
    const stack = stackActivityHeartbeat();
    if (stack.active && stack.label) return `PIM Email ${stack.label}`;
    if (browserActivityHeartbeatActive()) return 'PIM Email cache/browser activity active';
    if (state.activityHeartbeatError) return 'PIM Email activity unavailable';
    return 'PIM Email activity idle';
  }

  function activityHeartbeatView() {
    const tone = activityHeartbeatTone();
    const beating = activityHeartbeatActive();
    return {
      className: `email-activity-heartbeat email-activity-heartbeat--${tone}${beating ? ' email-activity-heartbeat--beating' : ''}`,
      label: activityHeartbeatLabel(),
    };
  }

  function activityHeartbeatHtml() {
    const view = activityHeartbeatView();
    return `<span class="${escHtml(view.className)}" role="img" aria-label="${escHtml(view.label)}" title="${escHtml(view.label)}">&#9829;</span>`;
  }

  function healthStatusTone() {
    const status = String(state.health?.status || '').toLowerCase();
    if (status === 'red') return 'red';
    if (status === 'amber') return 'amber';
    if (status === 'green') return 'green';
    return 'unknown';
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

  function closeSearchModeMenus(except = null) {
    document.querySelectorAll('[data-email-search-mode-dropdown].open').forEach(dropdown => {
      if (except && dropdown === except) return;
      dropdown.classList.remove('open');
      dropdown.querySelectorAll('[data-email-search-mode-menu-toggle]').forEach(button => {
        button.setAttribute('aria-expanded', 'false');
      });
    });
  }

  function closeTrustedViewMenus(except = null) {
    document.querySelectorAll('[data-email-trusted-view-dropdown].open').forEach(dropdown => {
      if (except && dropdown === except) return;
      dropdown.classList.remove('open');
      dropdown.querySelectorAll('[data-email-trusted-view-menu-toggle]').forEach(button => {
        button.setAttribute('aria-expanded', 'false');
      });
    });
  }

  function closeRulesToolMenus(except = null) {
    document.querySelectorAll('[data-email-rules-tool-dropdown].open').forEach(dropdown => {
      if (except && dropdown === except) return;
      dropdown.classList.remove('open');
      dropdown.querySelectorAll('[data-email-rules-tool-menu-toggle]').forEach(button => {
        button.setAttribute('aria-expanded', 'false');
      });
    });
  }

  function toggleFolderMenu(button) {
    const dropdown = button?.closest?.('[data-email-folder-dropdown]');
    if (!dropdown || dropdown.classList.contains('is-disabled') || button.disabled) return false;
    const nextOpen = !dropdown.classList.contains('open');
    closeSearchModeMenus();
    closeTrustedViewMenus();
    closeRulesToolMenus();
    closeFolderMenus(dropdown);
    dropdown.classList.toggle('open', nextOpen);
    dropdown.querySelectorAll('[data-email-folder-menu-toggle]').forEach(toggle => {
      toggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    });
    return true;
  }

  function toggleSearchModeMenu(button) {
    const dropdown = button?.closest?.('[data-email-search-mode-dropdown]');
    if (!dropdown || button.disabled) return false;
    const nextOpen = !dropdown.classList.contains('open');
    closeFolderMenus();
    closeTrustedViewMenus();
    closeRulesToolMenus();
    closeSearchModeMenus(dropdown);
    dropdown.classList.toggle('open', nextOpen);
    dropdown.querySelectorAll('[data-email-search-mode-menu-toggle]').forEach(toggle => {
      toggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    });
    return true;
  }

  function toggleTrustedViewMenu(button) {
    const dropdown = button?.closest?.('[data-email-trusted-view-dropdown]');
    if (!dropdown || button.disabled) return false;
    const nextOpen = !dropdown.classList.contains('open');
    closeFolderMenus();
    closeSearchModeMenus();
    closeRulesToolMenus();
    closeTrustedViewMenus(dropdown);
    dropdown.classList.toggle('open', nextOpen);
    dropdown.querySelectorAll('[data-email-trusted-view-menu-toggle]').forEach(toggle => {
      toggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    });
    return true;
  }

  function toggleRulesToolMenu(button) {
    const dropdown = button?.closest?.('[data-email-rules-tool-dropdown]');
    if (!dropdown || button.disabled) return false;
    const nextOpen = !dropdown.classList.contains('open');
    closeFolderMenus();
    closeSearchModeMenus();
    closeTrustedViewMenus();
    closeRulesToolMenus(dropdown);
    dropdown.classList.toggle('open', nextOpen);
    dropdown.querySelectorAll('[data-email-rules-tool-menu-toggle]').forEach(toggle => {
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
    state.messageOpenPrefetchControllers.forEach((uid, controller) => {
      try {
        controller.abort();
      } catch (error) {}
    });
    state.messageOpenPrefetchControllers = new Map();
    state.messageOpenPrefetchPromises = new Map();
    state.messageOpenPrefetchPausedUntil = performance.now() + MESSAGE_OPEN_PREFETCH_START_DELAY_MS;
    state.messageImagePrefetchSeen = new Set();
    state.messageImagePrefetchQueue = [];
    state.messageImagePrefetchInFlight = 0;
    state.messageImagePrefetchCompleted = 0;
    state.messageImagePrefetchFailed = 0;
    state.messageImagePrefetchSkipped = 0;
  }

  function messageUidsFromRows(rows, limit = 200) {
    const uids = [];
    const seen = new Set();
    (rows || []).forEach(row => {
      if (uids.length >= limit) return;
      const uid = messageIdentity(row);
      if (!uid || seen.has(uid)) return;
      seen.add(uid);
      uids.push(uid);
    });
    return uids;
  }

  function setMessageServerCacheStates(states) {
    if (!states || typeof states !== 'object' || Array.isArray(states)) return false;
    Object.entries(states).forEach(([uid, value]) => {
      const cleanUid = String(uid || value?.email_uid || '').trim();
      if (!cleanUid || !value || typeof value !== 'object') return;
      state.messageServerCacheStates.set(cleanUid, value);
    });
    state.messageCacheStateLastRefreshed = Date.now();
    state.messageCacheStateError = '';
    notifyCacheStateChanged();
    return true;
  }

  function handleCacheStateEvent(event) {
    const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
    const states = payload.message_states || event?.message_states || null;
    if (!setMessageServerCacheStates(states)) return;
    state.cacheStateSseCount += 1;
    state.cacheStateSseLastAt = Date.now();
    notifyCacheStateChanged();
  }

  function refreshMessageCacheStates(rows = state.messages, options = {}) {
    const uids = messageUidsFromRows(rows, Math.max(1, Math.min(Number(options.limit || 200), 200)));
    if (!uids.length) return Promise.resolve(null);
    state.messageCacheStateLoading = true;
    return fetchJson(cacheMessagesEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PIM-Email-Client-Priority': 'background',
      },
      body: JSON.stringify({ email_uids: uids, limit: uids.length }),
    }).then(data => {
      setMessageServerCacheStates(data?.message_states || {});
      return data;
    }).catch(error => {
      state.messageCacheStateError = error.message || String(error);
      return null;
    }).finally(() => {
      state.messageCacheStateLoading = false;
      notifyCacheStateChanged();
    });
  }

  function scheduleMessageCacheStateRefresh(rows = state.messages, delayMs = 700) {
    if (state.messageCacheStateTimer) {
      window.clearTimeout(state.messageCacheStateTimer);
      state.messageCacheStateTimer = null;
    }
    const batch = Array.isArray(rows) ? rows.slice(0, 200) : state.messages.slice(0, 200);
    state.messageCacheStateTimer = window.setTimeout(() => {
      state.messageCacheStateTimer = null;
      refreshMessageCacheStates(batch);
    }, Math.max(0, Number(delayMs || 0)));
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
        headers: {
          'Content-Type': 'application/json',
          'X-PIM-Email-Client-Priority': 'background',
        },
        body: JSON.stringify({ email_uids: batch, limit: batch.length }),
      }).then(data => {
        setMessageServerCacheStates(data?.message_states || {});
        scheduleMessageCacheStateRefresh(rows, 900);
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
    renderActivityHeartbeatChrome();
    updateMessageCacheStrips();
    scheduleEmailIntroHeightLock();
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
    if (state.messageOpenPrefetchStarted <= 0 && state.messageOpenPrefetchInFlight <= 0) {
      state.messageOpenPrefetchPausedUntil = Math.max(
        state.messageOpenPrefetchPausedUntil,
        performance.now() + MESSAGE_OPEN_PREFETCH_START_DELAY_MS,
      );
    }
    pumpMessageOpenPrefetch();
    notifyCacheStateChanged();
  }

  function pauseMessageOpenPrefetch(durationMs = 3500, options = {}) {
    const exceptUid = String(options.exceptUid || '').trim();
    state.messageOpenPrefetchPausedUntil = Math.max(
      state.messageOpenPrefetchPausedUntil,
      performance.now() + durationMs,
    );
    state.messageOpenPrefetchControllers.forEach((uid, controller) => {
      if (exceptUid && uid === exceptUid) return;
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
    state.messageOpenPrefetchControllers.set(controller, task.uid);
    let request = null;
    try {
      request = fetchJson(messageEndpoint(task.uid, task.row, { opened: false }), {
        headers: { 'X-PIM-Email-Client-Priority': 'background' },
        signal: controller.signal,
        priority: 'low',
      });
      state.messageOpenPrefetchPromises.set(task.uid, request);
      const data = await request;
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
      if (request && state.messageOpenPrefetchPromises.get(task.uid) === request) {
        state.messageOpenPrefetchPromises.delete(task.uid);
      }
      notifyCacheStateChanged();
    }
  }

  function pumpMessageOpenPrefetch() {
    if (state.messagePendingUid) {
      window.setTimeout(pumpMessageOpenPrefetch, 250);
      return;
    }
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
      entry = {
        rawSha,
        sources: new Map(),
        bytes: 0,
        pending: null,
        lastUsed: performance.now(),
        totalSources: 0,
        complete: false,
        renderedHtml: '',
        renderedHtmlRawSha: '',
        renderedHtmlLength: 0,
      };
      state.messageImageCache.set(uid, entry);
    }
    entry.rawSha = rawSha || entry.rawSha || '';
    entry.lastUsed = performance.now();
    return entry;
  }

  function ensureMessageImageCache(message) {
    const uid = String(message?.email_uid || '').trim();
    if (!uid) return null;
    const rawSha = messageRawSha(message);
    const existing = state.messageImageCache.get(uid);
    if (existing?.complete && (!rawSha || !existing.rawSha || existing.rawSha === rawSha)) {
      existing.lastUsed = performance.now();
      return Promise.resolve(existing);
    }
    const html = String(message?.views?.html || '');
    if (!html) return null;
    const entry = imageCacheEntryForMessage(message);
    if (!entry) return null;
    if (entry.pending) return entry.pending;
    const sources = localImageSourcesFromHtml(html).slice(0, MESSAGE_IMAGE_CACHE_SOURCE_LIMIT);
    entry.totalSources = sources.length;
    entry.complete = sources.length > 0 && entry.sources.size >= sources.length;
    const missing = sources.filter(item => !entry.sources.has(item.key));
    if (!missing.length) {
      notifyCacheStateChanged();
      return Promise.resolve(entry);
    }
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
      entry.complete = sources.length > 0 && entry.sources.size >= sources.length;
      notifyCacheStateChanged();
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
    const rawSha = messageRawSha(message);
    if (
      entry?.renderedHtml
      && entry.renderedHtmlRawSha === rawSha
      && entry.renderedHtmlLength === value.length
    ) {
      entry.lastUsed = performance.now();
      return entry.renderedHtml;
    }
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
    const html = changed ? doc.body.innerHTML : value;
    if (entry && changed) {
      entry.renderedHtml = html;
      entry.renderedHtmlRawSha = rawSha;
      entry.renderedHtmlLength = value.length;
    }
    return html;
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

  function imageExistingOutcomeText(existingDetail) {
    const text = String(existingDetail?.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || /no worker outcome row is recorded/i.test(text)) return '';
    return text;
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
    const preservedText = cleanImageOutcomeDetail(context.preservedText || '');
    const href = cleanImageOutcomeDetail(context.href || '');
    const message = context.message || state.message || {};
    const rawHash = cleanImageOutcomeDetail(message?.raw_sha256);
    const status = row ? String(row?.status || 'not stored').trim() : 'not recorded';
    const reason = row
      ? String(row?.reason || row?.last_error || 'image was not stored').trim()
      : (preservedText || fallbackText || 'No worker outcome row is recorded for this placeholder yet.');
    const diagnostic = {
      schema: 'xarta.pim_email.image_block_diagnostic.v1',
      summary: row ? imageOutcomeText(row) : reason,
      status,
      reason,
      meaning: row
        ? imageOutcomeMeaning(row)
        : preservedText
          ? 'The sanitized HTML already carried this image outcome detail. This linked image placeholder has no separate original-source control, so the browser preserved the server-rendered detail instead of claiming the worker outcome row is missing.'
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
      fallback_only: !row && !preservedText,
      sanitized_detail_only: !row && Boolean(preservedText),
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
      const existingOutcomeText = imageExistingOutcomeText(existingDetail);
      const missingOutcomeText = original
        ? 'Remote image blocked in the local-safe view; no worker outcome row is recorded for this source yet.'
        : 'Image blocked in the local-safe view; no worker outcome row is recorded for this placeholder yet.';
      const fallbackText = existingOutcomeText || missingOutcomeText;
      const text = row ? imageOutcomeText(row) : fallbackText;
      const title = row ? imageOutcomeHoverText(row) : (original ? `${fallbackText}\nOriginal URL: ${href}` : fallbackText);
      const diagnostic = imageOutcomeDiagnostic(row, {
        fallbackText,
        preservedText: existingOutcomeText,
        href,
        message,
      });
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
    const bindFrameDocument = () => {
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
      const openLinkFromTarget = target => {
        const anchor = target?.closest?.('a[href]');
        if (!anchor) return false;
        const cleanHref = safeMarkdownHref(anchor.getAttribute('href') || '');
        if (!cleanHref) return false;
        if (/^mailto:/i.test(cleanHref) || /^tel:/i.test(cleanHref)) {
          window.location.href = cleanHref;
          return true;
        }
        const opened = window.open(cleanHref, '_blank', 'noopener,noreferrer');
        if (opened) opened.opener = null;
        return true;
      };
      doc.addEventListener('click', event => {
        const handled = openFromTarget(event.target) || openLinkFromTarget(event.target);
        if (!handled) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
      doc.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const handled = openFromTarget(event.target) || openLinkFromTarget(event.target);
        if (!handled) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    };
    frame.addEventListener('load', bindFrameDocument);
    [0, 25, 100, 250, 500].forEach(delay => {
      window.setTimeout(bindFrameDocument, delay);
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

  function messageBrowserCacheState(uid) {
    const cleanUid = String(uid || '').trim();
    const rawCached = cleanUid ? state.messageOpenCache.has(cleanUid) : false;
    const imageEntry = cleanUid ? state.messageImageCache.get(cleanUid) : null;
    const imageSources = imageEntry?.sources instanceof Map ? imageEntry.sources.size : 0;
    const imageTotal = Number(imageEntry?.totalSources || imageSources || 0);
    const imagesComplete = Boolean(
      imageEntry
      && !imageEntry.pending
      && imageEntry.complete
      && imageTotal > 0
      && imageSources >= imageTotal
    );
    return {
      rawCached,
      imageSources,
      imageTotal,
      imagesComplete,
    };
  }

  function cacheVisualLegendRows(currentState) {
    const rows = [
      ['none', 'Red', 'No cache', 'No server source or browser cache is currently reported.'],
      ['server-source', 'Orange', 'Server source', 'Sanitized source is cached; local image assets are not confirmed.'],
      ['server-assets', 'Amber', 'Server assets', 'Sanitized source and at least some local image assets are cached on the stack.'],
      ['browser-raw', 'Dark green', 'Browser body', 'Server cache is complete and this browser tab has the message body cached.'],
      ['browser-assets', 'Bright green', 'Browser assets', 'This browser tab has the message body and local images cached.'],
    ];
    return rows.map(([stateName, color, label, description]) => {
      const current = stateName === currentState;
      const text = `${color}: ${label}`;
      return `
        <span class="email-cache-tooltip__row" data-current="${current ? 'true' : 'false'}">
          <span class="email-cache-tooltip__swatch" data-cache-state="${escHtml(stateName)}" aria-hidden="true"></span>
          <span>${current ? `<strong>${escHtml(text)}</strong>` : escHtml(text)} - ${escHtml(description)}</span>
        </span>
      `;
    }).join('');
  }

  function cacheStripTooltipHtml(visual) {
    const current = visual?.state || 'none';
    const serverText = `Server images ${visual?.server_images_cached ?? 0}/${visual?.server_images_total ?? 0}`;
    const browserText = `Browser raw ${visual?.browser_raw_cached ? 'yes' : 'no'}, images ${visual?.browser_images_cached ?? 0}/${visual?.browser_images_total ?? 0}`;
    const staleText = visual?.server_state_stale
      ? '<span class="email-cache-tooltip__note">Server report was stale; browser-loaded local assets prove the displayed cached state.</span>'
      : '';
    return `
      <span class="email-cache-tooltip" role="tooltip">
        <span class="email-cache-tooltip__title">${escHtml(visual?.label || 'No cache')}</span>
        <span class="email-cache-tooltip__meta">${escHtml(`${serverText}; ${browserText}`)}</span>
        ${staleText}
        <span class="email-cache-tooltip__legend">${cacheVisualLegendRows(current)}</span>
      </span>
    `;
  }

  function messageCacheVisualState(uid) {
    const cleanUid = String(uid || '').trim();
    const server = state.messageServerCacheStates.get(cleanUid) || {};
    const browser = messageBrowserCacheState(cleanUid);
    const sourceCached = Boolean(server.source_cached);
    const serverImagesTotal = Number(server.server_images_total || 0);
    const serverImagesCached = Number(server.server_images_cached || 0);
    const serverComplete = Boolean(server.server_complete);
    const browserImagesComplete = Boolean(
      browser.imagesComplete
      || (browser.rawCached && browser.imageTotal === 0 && serverImagesTotal === 0 && sourceCached)
    );
    const browserVerifiedComplete = Boolean(browser.rawCached && browserImagesComplete);
    const serverStateStale = Boolean(!serverComplete && browserVerifiedComplete);
    const effectiveServerComplete = Boolean(serverComplete || serverStateStale);
    const effectiveSourceCached = Boolean(sourceCached || browser.rawCached);
    let cacheState = 'none';
    let label = 'No cache';
    if (effectiveServerComplete && browser.rawCached && browserImagesComplete) {
      cacheState = 'browser-assets';
      label = serverStateStale
        ? 'Browser message/assets cached; server report stale'
        : 'Server and browser message/assets cached';
    } else if (effectiveServerComplete && browser.rawCached) {
      cacheState = 'browser-raw';
      label = 'Server cache complete and browser message cached';
    } else if (effectiveSourceCached && (serverImagesCached > 0 || effectiveServerComplete)) {
      cacheState = 'server-assets';
      label = serverImagesTotal
        ? `Server image cache ${serverImagesCached}/${serverImagesTotal}`
        : 'Server cache complete; message has no local image assets';
    } else if (effectiveSourceCached) {
      cacheState = 'server-source';
      label = 'Server sanitized source cached';
    }
    const title = [
      label,
      `browser raw ${browser.rawCached ? 'yes' : 'no'}`,
      `browser images ${browser.imageSources}/${browser.imageTotal}`,
      `server images ${serverImagesCached}/${serverImagesTotal}`,
      serverStateStale ? 'server report stale' : '',
    ].filter(Boolean).join('; ');
    return {
      state: cacheState,
      label,
      title,
      source_cached: sourceCached,
      server_complete: serverComplete,
      server_state_stale: serverStateStale,
      server_images_cached: serverImagesCached,
      server_images_total: serverImagesTotal,
      browser_raw_cached: browser.rawCached,
      browser_images_cached: browser.imageSources,
      browser_images_total: browser.imageTotal,
      browser_images_complete: browserImagesComplete,
    };
  }

  function messageCacheVisualCounts(rows = state.messages) {
    const counts = {
      none: 0,
      server_source: 0,
      server_assets: 0,
      browser_raw: 0,
      browser_assets: 0,
    };
    (rows || []).forEach(row => {
      const uid = messageIdentity(row);
      if (!uid) return;
      const key = messageCacheVisualState(uid).state.replace(/-/g, '_');
      if (Object.prototype.hasOwnProperty.call(counts, key)) counts[key] += 1;
    });
    return counts;
  }

  function updateMessageCacheStrips() {
    document.querySelectorAll('#email-message-list .email-message-row[data-email-message-email-uid]').forEach(row => {
      const uid = rowMessageUid(row);
      if (!uid) return;
      const visual = messageCacheVisualState(uid);
      row.dataset.cacheState = visual.state;
      const strip = row.querySelector('.email-message-cache-strip');
      if (strip) {
        const tooltipKey = `${visual.state}|${visual.title}`;
        if (strip.dataset.cacheTooltipKey === tooltipKey) return;
        strip.dataset.cacheTooltipKey = tooltipKey;
        strip.setAttribute('title', visual.title);
        strip.setAttribute('aria-label', visual.title);
        strip.innerHTML = cacheStripTooltipHtml(visual);
      }
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
    setMessageServerCacheStates(data?.message_states || {});
    refreshMessageCacheStates(incoming);
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
      heading.innerHTML = `<span>${escHtml(state.folder || 'INBOX')}</span>${activityHeartbeatHtml()}`;
    }
    renderMeta();
    scheduleEmailIntroHeightLock();
  }

  function messageRowHtml(row) {
    const key = messageIdentity(row);
    const selected = key === activeMessageUid();
    const multiSelected = state.selectedMessageUids.has(key);
    const cacheVisual = messageCacheVisualState(key);
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
      <div class="email-message-row" data-email-message-uid="${escHtml(row.uid || '')}" data-email-message-email-uid="${escHtml(row.email_uid || '')}" data-cache-state="${escHtml(cacheVisual.state)}" data-selected="${selected ? 'true' : 'false'}" data-multi-selected="${multiSelected ? 'true' : 'false'}" tabindex="0">
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
        <span class="email-message-cache-strip" title="${escHtml(cacheVisual.title)}" aria-label="${escHtml(cacheVisual.title)}" data-cache-tooltip-key="${escHtml(`${cacheVisual.state}|${cacheVisual.title}`)}">
          ${cacheStripTooltipHtml(cacheVisual)}
        </span>
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
          [
            messageContextButton('refresh-local-message-view', 'Refresh local view'),
            messageContextButton('force-refresh-message', 'Force refresh'),
          ],
          [messageContextButton('mark-sender-probable-trusted', 'Mark sender probable trusted')],
          [
            messageContextButton('open-message-audit-ledger', 'Open audit ledger'),
            messageContextButton('edit-message-virtual-paths', 'Edit virtual paths'),
            messageContextButton('open-virtual-path-rules', 'Open virtual-path rules'),
            messageContextButton('show-message-uid', 'Show / copy email_uid'),
          ],
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

  function auditLedgerInfoGridHtml(rows) {
    return `
      <div class="email-audit-ledger-info-grid">
        ${rows.map(([label, value, tone, wide]) => `
          <div class="email-audit-ledger-info${wide ? ' email-audit-ledger-info--wide' : ''}">
            <span class="email-audit-ledger-info__label">${escHtml(label)}</span>
            <span class="email-audit-ledger-info__value">${tone ? securityPillHtml(value, tone) : escHtml(formatSecurityValue(value))}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function auditLedgerMessageSummary(uid) {
    const clean = String(uid || '').trim();
    const row = state.messages.find(item => (
      String(item.email_uid || '') === clean || String(item.uid || '') === clean
    )) || null;
    const opened = state.message && (
      String(state.message.email_uid || '') === clean || String(state.message.uid || '') === clean
    ) ? state.message : null;
    const source = opened || row || {};
    return {
      email_uid: clean,
      subject: source.subject || '',
      from: source.from || source.sender || '',
      date: source.date || source.received_at || source.sent_at || '',
    };
  }

  function auditLedgerSubjectText(summary) {
    const value = String(summary?.subject || '').trim();
    return value || 'Subject unavailable';
  }

  function auditLedgerParseDateTime(value) {
    const raw = String(value ?? '').trim();
    if (!raw || raw === 'n/a') return null;
    const normalized = raw
      .replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/, '$1T$2')
      .replace(/\s+UTC$/i, 'Z');
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function auditLedgerRoundedDate(value) {
    const date = auditLedgerParseDateTime(value);
    if (!date) return null;
    return new Date(Math.round(date.getTime() / 1000) * 1000);
  }

  function auditLedgerLocalFormatter() {
    if (!auditLedgerLocalDateTimeFormatter && typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
      auditLedgerLocalDateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        timeZoneName: 'short',
      });
    }
    return auditLedgerLocalDateTimeFormatter;
  }

  function auditLedgerLocalDateTime(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return 'n/a';
    const rounded = auditLedgerRoundedDate(raw);
    if (!rounded) return raw;
    const formatter = auditLedgerLocalFormatter();
    if (formatter && typeof formatter.formatToParts === 'function') {
      const parts = Object.fromEntries(formatter.formatToParts(rounded).map(part => [part.type, part.value]));
      if (parts.year && parts.month && parts.day && parts.hour && parts.minute && parts.second) {
        const hour = parts.hour === '24' ? '00' : parts.hour;
        const zone = parts.timeZoneName ? ` ${parts.timeZoneName}` : '';
        return `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}:${parts.second}${zone}`;
      }
      return formatter.format(rounded);
    }
    const pad = valuePart => String(valuePart).padStart(2, '0');
    return [
      `${rounded.getFullYear()}-${pad(rounded.getMonth() + 1)}-${pad(rounded.getDate())}`,
      `${pad(rounded.getHours())}:${pad(rounded.getMinutes())}:${pad(rounded.getSeconds())}`,
    ].join(' ');
  }

  function auditLedgerJsonHtml(value) {
    const safe = value && typeof value === 'object' ? value : {};
    const text = Object.keys(safe).length ? JSON.stringify(safe, null, 2) : '{}';
    return `<pre class="email-audit-ledger-json">${escHtml(text)}</pre>`;
  }

  function auditLedgerPathChipsHtml(paths) {
    const items = Array.isArray(paths) ? paths.filter(Boolean) : [];
    if (!items.length) return '<div class="email-audit-ledger-empty">No current virtual paths recorded.</div>';
    return `
      <div class="email-audit-ledger-paths">
        ${items.map(path => `<span class="email-audit-ledger-path">${escHtml(path)}</span>`).join('')}
      </div>
    `;
  }

  function auditLedgerEventTone(event) {
    const type = String(event?.event_type || '').toLowerCase();
    const op = String(event?.virtual_path_operation || '').toLowerCase();
    const status = String(event?.result_status || '').toLowerCase();
    if (status && status !== 'ok') return 'red';
    if (type === 'message_open') return 'info';
    if (op === 'remove') return 'amber';
    if (op === 'add' || op === 'set') return 'green';
    if (type === 'virtual_path_change') return 'info';
    return 'unknown';
  }

  function auditLedgerEventTitle(event) {
    const type = String(event?.event_type || '').trim();
    const action = String(event?.action || '').trim();
    const op = String(event?.virtual_path_operation || '').trim();
    const path = String(event?.virtual_path || event?.destination_virtual_path || event?.source_virtual_path || '').trim();
    if (type === 'message_open') return 'Message opened';
    if (op && path) return `${op} ${path}`;
    if (action) return action;
    return type || 'ledger event';
  }

  function auditLedgerEventTimestamp(event) {
    const value = String(event?.event_ts || event?.created_at || '').trim();
    return auditLedgerLocalDateTime(value);
  }

  function auditLedgerEventPathLabel(event) {
    const path = String(event?.virtual_path || '').trim();
    const before = String(event?.virtual_path_before || '').trim();
    const after = String(event?.virtual_path_after || '').trim();
    const source = String(event?.source_virtual_path || '').trim();
    const destination = String(event?.destination_virtual_path || '').trim();
    if (path) return path;
    if (before || after) return `${before || 'none'} -> ${after || 'none'}`;
    if (source || destination) return `${source || 'none'} -> ${destination || 'none'}`;
    return 'n/a';
  }

  function auditLedgerEventDetailHtml(event) {
    return `
      <div class="email-audit-ledger-row__detail">
        ${securityKvRowsHtml([
          ['Event id', event.event_id || 'n/a'],
          ['Timestamp', auditLedgerLocalDateTime(event.event_ts || event.created_at)],
          ['Event type', event.event_type || 'n/a', auditLedgerEventTone(event)],
          ['Action', event.action || 'n/a'],
          ['Operation', event.virtual_path_operation || 'n/a', event.virtual_path_operation || 'info'],
          ['Virtual path', event.virtual_path || 'n/a'],
          ['Before', event.virtual_path_before || 'n/a'],
          ['After', event.virtual_path_after || 'n/a'],
          ['Source path', event.source_virtual_path || 'n/a'],
          ['Destination path', event.destination_virtual_path || 'n/a'],
          ['Actor', event.actor || 'n/a'],
          ['Surface', event.source_surface || 'n/a'],
          ['Request', event.request_id || 'n/a'],
          ['Result', event.result_status || 'n/a', event.result_status || 'info'],
        ])}
        <div class="email-audit-ledger-row__metadata">
          <h4>Metadata</h4>
          ${auditLedgerJsonHtml(event.metadata)}
        </div>
      </div>
    `;
  }

  function auditLedgerEventRowsHtml(events) {
    const rows = Array.isArray(events) ? events : [];
    if (!rows.length) return '<div class="email-audit-ledger-empty">No audit events are recorded for this message.</div>';
    return `
      <div class="email-audit-ledger-table" role="table" aria-label="Audit ledger events">
        <div class="email-audit-ledger-table__head" role="row">
          <span></span>
          <span role="columnheader">Time</span>
          <span role="columnheader">Event</span>
          <span role="columnheader">Action</span>
          <span role="columnheader">Op</span>
          <span role="columnheader">Path</span>
          <span role="columnheader">Actor</span>
          <span role="columnheader">Source</span>
          <span role="columnheader">Result</span>
        </div>
        ${rows.map(event => `
          <details
            class="email-audit-ledger-row"
            data-email-audit-event-detail
            data-tone="${escHtml(auditLedgerEventTone(event))}"
            name="email-audit-ledger-event"
          >
            <summary class="email-audit-ledger-row__summary" role="row">
              <span class="email-audit-ledger-row__toggle" aria-hidden="true"></span>
              <span role="cell" title="${escHtml(event.event_ts || event.created_at || '')}">${escHtml(auditLedgerEventTimestamp(event))}</span>
              <span role="cell" title="${escHtml(event.event_id || '')}">${escHtml(auditLedgerEventTitle(event))}</span>
              <span role="cell">${escHtml(formatSecurityValue(event.action || 'n/a'))}</span>
              <span role="cell">${securityPillHtml(event.virtual_path_operation || 'n/a', event.virtual_path_operation || 'info')}</span>
              <span role="cell" title="${escHtml(auditLedgerEventPathLabel(event))}">${escHtml(auditLedgerEventPathLabel(event))}</span>
              <span role="cell">${escHtml(formatSecurityValue(event.actor || 'n/a'))}</span>
              <span role="cell" title="${escHtml(formatSecurityValue(event.source_surface || 'n/a'))}">${escHtml(formatSecurityValue(event.source_surface || 'n/a'))}</span>
              <span role="cell">${securityPillHtml(event.result_status || 'n/a', event.result_status || 'info')}</span>
            </summary>
            ${auditLedgerEventDetailHtml(event)}
          </details>
        `).join('')}
      </div>
    `;
  }

  function wireAuditLedgerDetails() {
    const details = document.querySelectorAll('[data-email-audit-event-detail]');
    details.forEach(detail => {
      if (detail.dataset.emailAuditDetailBound === '1') return;
      detail.dataset.emailAuditDetailBound = '1';
      detail.addEventListener('toggle', () => {
        if (!detail.open) return;
        details.forEach(item => {
          if (item !== detail) item.open = false;
        });
      });
    });
  }

  function auditLedgerModalHtml() {
    if (state.auditLedgerLoading) {
      return '<div class="email-empty">Loading audit ledger.</div>';
    }
    if (state.auditLedgerError) {
      return `<div class="hub-modal-error">${escHtml(state.auditLedgerError)}</div>`;
    }
    const history = state.auditLedgerHistory || {};
    const summary = state.auditLedgerMessageSummary || auditLedgerMessageSummary(state.auditLedgerEmailUid);
    const ledgerState = history.state || {};
    const events = Array.isArray(history.events) ? history.events : [];
    return `
      <div class="email-audit-ledger-shell">
        <section class="email-audit-ledger-overview">
          <div class="email-audit-ledger-message-card">
            <span class="email-audit-ledger-info__label">Subject</span>
            <h3>${escHtml(auditLedgerSubjectText(summary))}</h3>
            <div class="email-audit-ledger-message-card__meta">
              ${summary.from ? `<span>${escHtml(summary.from)}</span>` : ''}
              ${summary.date ? `<span>${escHtml(summary.date)}</span>` : ''}
            </div>
          </div>
          ${auditLedgerInfoGridHtml([
            ['Events', `${events.length} event${events.length === 1 ? '' : 's'}`, events.length ? 'info' : 'amber'],
            ['Mailbox', history.mailbox_id || state.auditLedgerMailbox?.mailbox_id || 'n/a'],
            ['Current paths', ledgerState.current_virtual_path_count ?? 0, 'info'],
            ['Open count', ledgerState.open_count ?? 'n/a'],
            ['Folder changes', ledgerState.folder_change_count ?? 'n/a'],
            ['Latest operation', ledgerState.latest_virtual_path_operation || 'n/a', ledgerState.latest_virtual_path_operation || 'info'],
            ['Latest path', ledgerState.latest_virtual_path || 'n/a'],
            ['Last opened', auditLedgerLocalDateTime(ledgerState.last_opened_at)],
            ['Latest path change', auditLedgerLocalDateTime(ledgerState.latest_virtual_path_changed_at)],
            ['Loaded', auditLedgerLocalDateTime(state.auditLedgerLoadedAt)],
            ['email_uid', history.email_uid || state.auditLedgerEmailUid || 'n/a', '', true],
            ['Raw hash', ledgerState.raw_sha256 ? `${String(ledgerState.raw_sha256).slice(0, 16)}...` : 'n/a'],
          ])}
        </section>
        <section class="email-audit-ledger-section">
          <div class="email-audit-ledger-section__head">
            <h3>Current Virtual Paths</h3>
            ${securityPillHtml(ledgerState.current_virtual_path_count ?? 0, 'info')}
          </div>
          ${auditLedgerPathChipsHtml(ledgerState.current_virtual_paths)}
        </section>
        <section class="email-audit-ledger-section">
          <div class="email-audit-ledger-section__head">
            <h3>Events</h3>
            ${securityPillHtml(`limit ${history.limit ?? 500}`, 'info')}
          </div>
          ${auditLedgerEventRowsHtml(events)}
        </section>
      </div>
    `;
  }

  function renderAuditLedgerModal() {
    const modal = el('email-audit-ledger-modal');
    const title = el('email-audit-ledger-modal-title');
    const body = el('email-audit-ledger-modal-body');
    const status = el('email-audit-ledger-modal-status');
    if (title) title.textContent = 'Message Audit Ledger';
    if (body) {
      body.innerHTML = auditLedgerModalHtml();
      wireAuditLedgerDetails();
    }
    if (status) {
      status.textContent = state.auditLedgerLoading
        ? 'Loading'
        : (state.auditLedgerEmailUid || '');
    }
    return Boolean(modal && body);
  }

  async function loadAuditLedger(emailUid) {
    const clean = String(emailUid || '').trim();
    if (!clean) return null;
    const seq = state.auditLedgerSeq + 1;
    state.auditLedgerSeq = seq;
    state.auditLedgerLoading = true;
    state.auditLedgerError = '';
    state.auditLedgerHistory = null;
    state.auditLedgerMailbox = null;
    state.auditLedgerLoadedAt = '';
    renderAuditLedgerModal();
    try {
      const data = await fetchJson(messageActionsEndpoint(clean, { limit: 500 }));
      if (seq !== state.auditLedgerSeq) return null;
      state.auditLedgerHistory = data.history || null;
      state.auditLedgerMailbox = data.mailbox || null;
      state.auditLedgerLoadedAt = new Date().toISOString();
      state.auditLedgerLoading = false;
      state.auditLedgerError = '';
      renderAuditLedgerModal();
      return data;
    } catch (error) {
      if (seq !== state.auditLedgerSeq) return null;
      state.auditLedgerLoading = false;
      state.auditLedgerError = error.message || String(error);
      renderAuditLedgerModal();
      return null;
    }
  }

  function closeAuditLedgerModal() {
    const modal = el('email-audit-ledger-modal');
    state.auditLedgerModalOpen = false;
    if (!modal) return;
    if (typeof HubModal !== 'undefined') HubModal.close(modal);
    else if (typeof modal.close === 'function') modal.close();
  }

  function openAuditLedgerModal(emailUid) {
    const clean = String(emailUid || '').trim();
    if (!clean) {
      setStatus('Select a message before opening the audit ledger', 'warn');
      return false;
    }
    state.auditLedgerEmailUid = clean;
    state.auditLedgerMessageSummary = auditLedgerMessageSummary(clean);
    state.auditLedgerModalOpen = true;
    state.auditLedgerLoading = true;
    state.auditLedgerError = '';
    state.auditLedgerHistory = null;
    state.auditLedgerMailbox = null;
    state.auditLedgerLoadedAt = '';
    renderAuditLedgerModal();
    const modal = el('email-audit-ledger-modal');
    if (modal) {
      if (typeof HubModal !== 'undefined') {
        HubModal.open(modal, { onClose: () => { state.auditLedgerModalOpen = false; } });
      } else if (typeof modal.showModal === 'function' && !modal.open) {
        modal.showModal();
      }
    }
    return loadAuditLedger(clean);
  }

  function openContextAuditLedger() {
    const uids = currentContextMessageUids();
    if (uids.length !== 1) {
      setStatus('Select one message before opening the audit ledger', 'warn');
      return false;
    }
    const uid = uids[0];
    closeMessageContextMenu();
    return openAuditLedgerModal(uid);
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
    frame.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('title', 'Sanitized email HTML');
    frame.srcdoc = htmlFrameDocument(value, message);
    connectHtmlFrameImageDiagnostics(frame);
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
      telemetry_status: timing.telemetry_status || '',
      telemetry_ms: Number.isFinite(Number(timing.telemetry_ms))
        ? Math.max(0, Math.round(Number(timing.telemetry_ms || 0)))
        : null,
      at: Date.now(),
    };
    state.lastMessageTiming = entry;
    state.messageTimings.unshift(entry);
    state.messageTimings = state.messageTimings.slice(0, 12);
    notifyCacheStateChanged();
  }

  function recordMessageOpenTelemetry(timing) {
    const entry = {
      uid: String(timing.uid || ''),
      source: timing.source || 'email-ui',
      status: timing.status || 'ok',
      telemetry_ms: Math.max(0, Math.round(Number(timing.telemetry_ms || 0))),
      error: timing.error || '',
      at: Date.now(),
    };
    state.lastMessageOpenTelemetry = entry;
    if (entry.status === 'ok') {
      state.messageOpenTelemetryCompleted += 1;
      state.messageOpenTelemetryLastError = '';
    } else {
      state.messageOpenTelemetryFailed += 1;
      state.messageOpenTelemetryLastError = entry.error || 'message-open telemetry failed';
    }
    const row = state.messageTimings.find(item => (
      item.uid === entry.uid && item.source === entry.source && item.telemetry_status === 'queued'
    ));
    if (row) {
      row.telemetry_status = entry.status;
      row.telemetry_ms = entry.telemetry_ms;
    }
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
            <span>${escHtml(item.telemetry_status ? `${item.telemetry_status}${item.telemetry_ms === null ? '' : ` ${item.telemetry_ms} ms`}` : 'telemetry n/a')}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function cacheStatusHtml() {
    const status = state.cacheStatus || {};
    const prefetchTotal = state.messageOpenPrefetchQueue.length + state.messageOpenPrefetchInFlight;
    const pausedMs = Math.max(0, Math.round(state.messageOpenPrefetchPausedUntil - performance.now()));
    const stripCounts = messageCacheVisualCounts();
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
            ['Open telemetry', `${state.messageOpenTelemetryInFlight} in flight, ${state.messageOpenTelemetryCompleted} done, ${state.messageOpenTelemetryFailed} failed`],
            ['Image prefetch queue', `${state.messageImagePrefetchQueue.length + state.messageImagePrefetchInFlight} pending/running, ${state.messageImagePrefetchCompleted} done, ${state.messageImagePrefetchFailed} failed`],
            ['Current source warm set', `${state.messageWarmSeen.size} UIDs seen`],
            ['Browser image memory', `${state.messageImageCache.size} messages, ${formatBytes(state.messageImageCacheBytes)} / ${formatBytes(MESSAGE_IMAGE_CACHE_MAX_BYTES)}`],
            ['Visible cache strips', `red ${stripCounts.none}, orange ${stripCounts.server_source}, amber ${stripCounts.server_assets}, dark green ${stripCounts.browser_raw}, light green ${stripCounts.browser_assets}`],
            ['SSE cache-state events', `${state.cacheStateSseCount} received${state.cacheStateSseLastAt ? `, last ${Math.round((Date.now() - state.cacheStateSseLastAt) / 1000)}s ago` : ''}`],
            ['Row cache states', state.messageCacheStateLastRefreshed ? `${Math.round((Date.now() - state.messageCacheStateLastRefreshed) / 1000)}s ago` : 'pending'],
            ['Service worker image cache', state.serviceWorkerImageCacheCount === null ? 'pending' : `${state.serviceWorkerImageCacheCount} requests`],
            ['Last refreshed', lastRefresh],
          ])}
          ${state.messageOpenPrefetchLastError ? `<div class="email-empty">${escHtml(state.messageOpenPrefetchLastError)}</div>` : ''}
          ${state.messageOpenTelemetryLastError ? `<div class="email-empty">${escHtml(state.messageOpenTelemetryLastError)}</div>` : ''}
          ${state.messageCacheStateError ? `<div class="email-empty">${escHtml(state.messageCacheStateError)}</div>` : ''}
          ${state.cacheStatusError ? `<div class="email-empty">${escHtml(state.cacheStatusError)}</div>` : ''}
        </section>
        ${cacheStatsSectionHtml('Stack Source Artifacts', status.source_artifact_cache || status.cache)}
        ${cacheStatsSectionHtml('Stack Local Images', status.image_asset_cache, [
          ['Warm tasks', `${status.image_asset_cache_warm_tasks?.active ?? 'n/a'} active, ${status.image_asset_cache_warm_tasks?.queued ?? 'n/a'} queued / ${status.image_asset_cache_warm_tasks?.max ?? 'memory-pressure'} (${status.image_asset_cache_warm_tasks?.limit_mode || 'memory-pressure-cache-capacity'})`],
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
        <section class="email-trusted-section">
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
        <div class="email-search-term-controls">
          <select data-email-search-term-operator aria-label="Operator"${index === 0 ? ' disabled' : ''}>
            <option value="AND"${term.operator !== 'OR' ? ' selected' : ''}>AND</option>
            <option value="OR"${term.operator === 'OR' ? ' selected' : ''}>OR</option>
          </select>
          <select data-email-search-term-field aria-label="Field">
            ${searchFieldOptionsHtml(term.field)}
          </select>
        </div>
        <div class="email-search-value-control">
          <input type="text" data-email-search-term-value value="${escHtml(term.value)}" placeholder="term, phrase, or wild*" autocomplete="off">
          <button class="email-search-icon-btn" type="button" data-email-search-remove-row="${index}" aria-label="Remove search row"${index === 0 ? ' disabled' : ''}>X</button>
        </div>
        ${index === 0 ? `<button type="submit" class="email-search-submit email-search-submit--advanced"${state.searchLoading ? ' disabled' : ''}>Search</button>` : '<span class="email-search-row-tail" aria-hidden="true"></span>'}
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
        <form class="email-search-form${advanced ? ' email-search-form--advanced' : ''}" data-email-search-form>
          <div class="email-search-toolbar"${advanced ? ' hidden' : ''}>
            <div class="email-search-simple"${advanced ? ' hidden' : ''}>
              <input type="search" data-email-search-query value="${escHtml(state.searchQuery)}" placeholder="Search email" autocomplete="off">
            </div>
            <button type="submit" class="email-search-submit"${state.searchLoading ? ' disabled' : ''}>Search</button>
          </div>
          <div class="email-search-advanced"${advanced ? '' : ' hidden'}>
            ${searchTermRowsHtml()}
            <button class="email-search-add-row" type="button" data-email-search-add-row>Add row</button>
          </div>
          <div class="email-search-filters">
            <div class="email-search-filter-column">
              ${searchDateFieldHtml('received-from', 'Received from', state.searchReceivedFrom)}
              ${searchDateFieldHtml('received-to', 'Received to', state.searchReceivedTo)}
            </div>
            <div class="email-search-filter-column">
              ${searchDateFieldHtml('sent-from', 'Sent from', state.searchSentFrom)}
              ${searchDateFieldHtml('sent-to', 'Sent to', state.searchSentTo)}
            </div>
            <div class="email-search-filter-column email-search-filter-column--source">
              <label class="email-search-filter-field">
                <span>Folder</span>
                <select data-email-search-folder aria-label="Folder">
                  ${searchFolderOptionsHtml()}
                </select>
              </label>
              <div class="email-search-filter-field">
                <span>Options</span>
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
              </div>
            </div>
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

  function parseRuleTextarea(form, name, fallback = {}) {
    const raw = String(form?.querySelector?.(`[name="${name}"]`)?.value || '').trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  }

  function parseRuleJsonField(form, name, fallback = {}, label = 'JSON') {
    try {
      return parseRuleTextarea(form, name, fallback);
    } catch (error) {
      throw new Error(`${label} is not valid JSON: ${error.message || String(error)}`);
    }
  }

  function virtualPathRuleDraftFromRule(rule) {
    return {
      display_name: String(rule?.display_name || rule?.name || ''),
      description: String(rule?.description || ''),
      status: String(rule?.status || 'active'),
      sequence: rule?.sequence === null || typeof rule?.sequence === 'undefined' ? '' : String(rule.sequence),
      stop_on_match: Boolean(rule?.stop_on_match),
      predicate: ruleJsonValue(rule?.predicate || {}),
      action: ruleJsonValue(rule?.action || {}),
      scope: ruleJsonValue(rule?.scope || {}),
    };
  }

  function readVirtualPathRuleDrafts(root = document) {
    const activeForm = document.activeElement?.closest?.('[data-email-rule-edit-form]') || null;
    const forms = [
      ...(root.matches?.('[data-email-rule-edit-form]') ? [root] : []),
      ...Array.from(root.querySelectorAll?.('[data-email-rule-edit-form]') || []),
    ];
    forms.sort((a, b) => {
      if (a === activeForm) return 1;
      if (b === activeForm) return -1;
      return 0;
    }).forEach(form => {
      if (root === document && form !== activeForm && !form.getClientRects?.().length) return;
      const ruleId = String(form.dataset.emailRuleId || '').trim();
      if (!ruleId) return;
      state.virtualPathRuleDrafts.set(ruleId, {
        display_name: String(form.querySelector('[name="display_name"]')?.value || ''),
        description: String(form.querySelector('[name="description"]')?.value || ''),
        status: String(form.querySelector('[name="status"]')?.value || 'active'),
        sequence: String(form.querySelector('[name="sequence"]')?.value || ''),
        stop_on_match: Boolean(form.querySelector('[name="stop_on_match"]')?.checked),
        predicate: String(form.querySelector('[name="predicate"]')?.value || ''),
        action: String(form.querySelector('[name="action"]')?.value || ''),
        scope: String(form.querySelector('[name="scope"]')?.value || ''),
      });
    });
  }

  function virtualPathRuleDraft(rule) {
    const ruleId = String(rule?.rule_id || '').trim();
    return (ruleId && state.virtualPathRuleDrafts.get(ruleId)) || virtualPathRuleDraftFromRule(rule);
  }

  function virtualPathRuleSavePayload(form) {
    const sequenceRaw = String(form?.querySelector?.('[name="sequence"]')?.value || '').trim();
    const sequence = sequenceRaw ? Number(sequenceRaw) : undefined;
    if (typeof sequence !== 'undefined' && (!Number.isFinite(sequence) || sequence < 0)) {
      throw new Error('Sequence must be a non-negative number.');
    }
    return {
      display_name: String(form?.querySelector?.('[name="display_name"]')?.value || '').trim() || 'Virtual path rule',
      description: String(form?.querySelector?.('[name="description"]')?.value || ''),
      status: String(form?.querySelector?.('[name="status"]')?.value || 'active'),
      sequence,
      stop_on_match: Boolean(form?.querySelector?.('[name="stop_on_match"]')?.checked),
      predicate: parseRuleJsonField(form, 'predicate', {}, 'Predicate JSON'),
      action: parseRuleJsonField(form, 'action', {}, 'Action JSON'),
      scope: parseRuleJsonField(form, 'scope', {}, 'Scope JSON'),
      actor: 'email-ui',
      metadata: { source_surface: 'pim-email-ui' },
    };
  }

  async function refreshVirtualPathRules(options = {}) {
    if (state.virtualPathRulesLoading) return state.virtualPathRules;
    state.virtualPathRulesLoading = true;
    state.virtualPathRulesError = '';
    renderVirtualPathRuleCatalogState();
    const catalogRequestSeq = ++state.virtualPathCatalogRequestSeq;
    try {
      const [paths, rules] = await Promise.all([
        fetchJson(virtualPathsEndpoint()),
        fetchJson(virtualPathRulesEndpoint()),
      ]);
      if (catalogRequestSeq === state.virtualPathCatalogRequestSeq) {
        state.virtualPaths = Array.isArray(paths.result?.virtual_paths)
          ? paths.result.virtual_paths
          : [];
      }
      state.virtualPathRules = Array.isArray(rules.result?.rules)
        ? rules.result.rules
        : [];
      state.virtualPathRulesLoaded = true;
      return state.virtualPathRules;
    } catch (error) {
      state.virtualPathRulesError = virtualPathRulesErrorMessage(error);
      return state.virtualPathRules;
    } finally {
      state.virtualPathRulesLoading = false;
      if (state.secondaryTab === 'rules') {
        renderVirtualPathRuleCatalogState();
      }
    }
  }

  async function refreshVirtualPathCatalog(options = {}) {
    const catalogRequestSeq = ++state.virtualPathCatalogRequestSeq;
    const paths = await fetchJson(virtualPathsEndpoint());
    if (catalogRequestSeq !== state.virtualPathCatalogRequestSeq) return state.virtualPaths;
    state.virtualPaths = Array.isArray(paths.result?.virtual_paths)
      ? paths.result.virtual_paths
      : [];
    if (options.patchControls !== false && state.secondaryTab === 'rules') {
      // Catalog values are response-owned. Patch those controls in place so an
      // explicit picker open never recreates an operator-owned Rules form.
      renderVirtualPathRuleCatalogState();
    }
    return state.virtualPaths;
  }

  async function createVirtualPathFromForm(form) {
    const input = form?.querySelector?.('[name="path"]');
    const parentInput = form?.querySelector?.('[name="parent_path"]');
    const childInput = form?.querySelector?.('[name="child_name"]');
    const path = normalizeVirtualPath(input?.value || childVirtualPath(parentInput?.value || '', childInput?.value || ''));
    if (!path) return false;
    if (parentInput?.value && !virtualPathAllows(parentInput.value, 'can_create_child')) {
      setStatus('Children cannot be created below that path.', 'err');
      return false;
    }
    setStatus('Creating virtual path', 'unknown');
    try {
      await fetchJson(virtualPathsEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ virtual_path: path, actor: 'email-ui', source_surface: 'pim-email-ui' }),
      });
      if (input) input.value = '';
      if (childInput) childInput.value = '';
      await refreshVirtualPathRules({ silent: true });
      await load({ force: true, preserveOpenedMessage: true });
      setStatus(`Created ${path}`, 'ok');
      return true;
    } catch (error) {
      setStatus(error.message || String(error), 'err');
      return false;
    }
  }

  async function bulkMoveVirtualPathFromForm(form) {
    const source = String(form?.querySelector?.('[name="source"]')?.value || '').trim();
    const destination = String(form?.querySelector?.('[name="destination"]')?.value || '').trim();
    const apply = Boolean(form?.querySelector?.('[name="apply"]')?.checked);
    if (!source || !destination) return false;
    setStatus(apply ? 'Applying virtual-path bulk move' : 'Dry-running virtual-path bulk move', 'unknown');
    try {
      const data = await fetchJson(virtualPathBulkMoveEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_virtual_path: source,
          destination_virtual_path: destination,
          dry_run: !apply,
          actor: 'email-ui',
          source_surface: 'pim-email-ui',
        }),
      });
      state.virtualPathRuleLastRun = {
        run: {
          mode: apply ? 'bulk_move' : 'bulk_move_dry_run',
          run_id: `${source} -> ${destination}`,
          status: 'completed',
          changed_count: data.result?.changed_count ?? 0,
        },
      };
      await refreshVirtualPathRules({ silent: true });
      if (apply) await load({ force: true, preserveOpenedMessage: true });
      setStatus(`${apply ? 'Moved' : 'Previewed'} ${data.result?.candidate_count ?? 0} messages`, 'ok');
      return true;
    } catch (error) {
      setStatus(error.message || String(error), 'err');
      return false;
    }
  }

  async function createVirtualPathRuleFromForm(form) {
    const name = String(form?.querySelector?.('[name="name"]')?.value || '').trim() || 'Virtual path rule';
    const sequenceRaw = String(form?.querySelector?.('[name="sequence"]')?.value || '').trim();
    const sequence = sequenceRaw ? Number(sequenceRaw) : undefined;
    if (typeof sequence !== 'undefined' && (!Number.isFinite(sequence) || sequence < 0)) {
      setStatus('Sequence must be a non-negative number.', 'err');
      return false;
    }
    setStatus('Creating virtual-path rule', 'unknown');
    try {
      await fetchJson(virtualPathRulesEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: name,
          description: String(form?.querySelector?.('[name="description"]')?.value || ''),
          sequence,
          stop_on_match: Boolean(form?.querySelector?.('[name="stop_on_match"]')?.checked),
          predicate: parseRuleJsonField(form, 'predicate', {}, 'Predicate JSON'),
          action: parseRuleJsonField(form, 'action', {}, 'Action JSON'),
          scope: parseRuleJsonField(form, 'scope', {}, 'Scope JSON'),
          actor: 'email-ui',
          source_surface: 'pim-email-ui',
        }),
      });
      await refreshVirtualPathRules({ silent: true });
      setStatus(`Created ${name}`, 'ok');
      return true;
    } catch (error) {
      setStatus(error.message || String(error), 'err');
      return false;
    }
  }

  async function saveVirtualPathRuleFromForm(form) {
    const ruleId = String(form?.dataset?.emailRuleId || '').trim();
    if (!ruleId) return false;
    readVirtualPathRuleDrafts(form);
    let payload = {};
    try {
      payload = virtualPathRuleSavePayload(form);
    } catch (error) {
      setStatus(error.message || String(error), 'err');
      return false;
    }
    setStatus('Saving virtual-path rule', 'unknown');
    state.virtualPathRuleSaving.add(ruleId);
    renderVirtualPathRuleListHosts();
    try {
      await fetchJson(virtualPathRuleUpdateEndpoint(ruleId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      state.virtualPathRuleDrafts.delete(ruleId);
      await refreshVirtualPathRules({ silent: true });
      setStatus(`Saved ${payload.display_name || ruleId}`, 'ok');
      return true;
    } catch (error) {
      setStatus(error.message || String(error), 'err');
      return false;
    } finally {
      state.virtualPathRuleSaving.delete(ruleId);
      renderVirtualPathRuleListHosts();
      renderUltrawide();
    }
  }

  async function applyVirtualPathRulesFromForm(form) {
    const ruleId = String(form?.querySelector?.('[name="rule_id"]')?.value || '').trim();
    const apply = Boolean(form?.querySelector?.('[name="apply"]')?.checked);
    let scope = {};
    try {
      scope = scopeFromApplyForm(form);
    } catch (error) {
      setStatus(error.message || String(error), 'err');
      return false;
    }
    setStatus(apply ? 'Applying virtual-path rules' : 'Dry-running virtual-path rules', 'unknown');
    state.virtualPathRuleApplyLoading = true;
    renderSecondaryPanels();
    try {
      const data = await fetchJson(virtualPathRuleApplyEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule_ids: ruleId ? [ruleId] : [],
          scope,
          dry_run: !apply,
          actor: 'email-ui',
          source_surface: 'pim-email-ui',
        }),
      });
      state.virtualPathRuleLastRun = data.result || null;
      await refreshVirtualPathRules({ silent: true });
      if (apply) await load({ force: true, preserveOpenedMessage: true });
      setStatus(`${apply ? 'Applied' : 'Previewed'} ${data.result?.application_count ?? 0} rule actions`, 'ok');
      return true;
    } catch (error) {
      setStatus(error.message || String(error), 'err');
      return false;
    } finally {
      state.virtualPathRuleApplyLoading = false;
      renderSecondaryPanels();
      renderUltrawide();
    }
  }

  async function archiveVirtualPathRule(ruleId) {
    const clean = String(ruleId || '').trim();
    if (!clean) return false;
    setStatus('Archiving virtual-path rule', 'unknown');
    try {
      await fetchJson(virtualPathRuleArchiveEndpoint(clean), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor: 'email-ui' }),
      });
      await refreshVirtualPathRules({ silent: true });
      setStatus('Virtual-path rule archived', 'ok');
      return true;
    } catch (error) {
      setStatus(error.message || String(error), 'err');
      return false;
    }
  }

  async function toggleVirtualPathRuleActive(ruleId, checked) {
    const clean = String(ruleId || '').trim();
    if (!clean) return false;
    if (checked) {
      renderVirtualPathRuleListHosts();
      return true;
    }
    const archived = await archiveVirtualPathRule(clean);
    if (!archived) renderVirtualPathRuleListHosts();
    return archived;
  }

  async function previewSingleVirtualPathRule(ruleId) {
    const clean = String(ruleId || '').trim();
    if (!clean) return false;
    const contextUid = String(state.virtualPathRuleContextEmailUid || '').trim();
    const scope = contextUid ? { message_uids: [contextUid], limit: 1 } : { limit: 100 };
    setStatus('Previewing virtual-path rule', 'unknown');
    state.virtualPathRuleApplyLoading = true;
    renderSecondaryPanels();
    try {
      const data = await fetchJson(virtualPathRuleApplyEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule_ids: [clean],
          scope,
          dry_run: true,
          actor: 'email-ui',
          source_surface: 'pim-email-ui',
        }),
      });
      state.virtualPathRuleLastRun = data.result || null;
      setStatus(`Previewed ${data.result?.application_count ?? 0} rule actions`, 'ok');
      return true;
    } catch (error) {
      setStatus(error.message || String(error), 'err');
      return false;
    } finally {
      state.virtualPathRuleApplyLoading = false;
      renderSecondaryPanels();
      renderUltrawide();
    }
  }

  async function loadVirtualPathRuleMessageContext(emailUid) {
    const uid = String(emailUid || '').trim();
    if (!uid || state.virtualPathRuleContextLoading) return false;
    state.virtualPathRuleContextLoading = true;
    state.virtualPathRuleContextError = '';
    state.virtualPathRuleContextHistory = null;
    state.virtualPathRuleContextPreview = null;
    renderSecondaryPanels();
    try {
      const [historyResult, previewResult] = await Promise.allSettled([
        fetchJson(messageVirtualPathRuleHistoryEndpoint(uid)),
        fetchJson(virtualPathRuleApplyEndpoint(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rule_ids: [],
            scope: { message_uids: [uid], limit: 1 },
            dry_run: true,
            actor: 'email-ui',
            source_surface: 'pim-email-ui-message-rules-filter',
            request_id: `message-rules-filter:${uid}`,
          }),
        }),
      ]);
      if (historyResult.status === 'fulfilled') {
        state.virtualPathRuleContextHistory = historyResult.value?.result || null;
      } else {
        state.virtualPathRuleContextError = virtualPathRulesErrorMessage(historyResult.reason);
      }
      if (previewResult.status === 'fulfilled') {
        state.virtualPathRuleContextPreview = previewResult.value?.result || null;
      } else {
        const previewError = virtualPathRulesErrorMessage(previewResult.reason);
        state.virtualPathRuleContextError = state.virtualPathRuleContextError
          ? `${state.virtualPathRuleContextError}; ${previewError}`
          : previewError;
      }
      return true;
    } finally {
      state.virtualPathRuleContextLoading = false;
      renderSecondaryPanels();
      renderUltrawide();
    }
  }

  async function openVirtualPathRulesForMessage(emailUid) {
    const uid = String(emailUid || activeMessageUid() || '').trim();
    if (!uid) return openSecondaryModalTab('rules');
    state.virtualPathRuleSearch = '';
    state.virtualPathRuleExpanded = new Set();
    state.virtualPathRuleContextEmailUid = uid;
    state.virtualPathRuleContextLoading = false;
    state.virtualPathRuleContextError = '';
    state.virtualPathRuleContextHistory = null;
    state.virtualPathRuleContextPreview = null;
    await openSecondaryModalTab('rules');
    loadVirtualPathRuleMessageContext(uid);
    return true;
  }

  function renderVirtualPathRuleListHosts() {
    const focusSnapshot = captureSearchFocus();
    readVirtualPathRuleDrafts();
    document.querySelectorAll('[data-email-vpath-rules-list-host]').forEach(host => {
      host.innerHTML = virtualPathRulesListHtml();
    });
    document.querySelectorAll('[data-email-vpath-rule-count]').forEach(node => {
      node.textContent = virtualPathRuleCountSummary();
    });
    restoreSearchFocus(focusSnapshot);
  }

  function renderVirtualPathRuleCatalogState() {
    const tool = normalizeRulesTool(state.virtualPathRuleTool);
    const listMode = tool === 'rules';
    const pathCount = Array.isArray(state.virtualPaths) ? state.virtualPaths.length : 0;
    const title = listMode ? virtualPathRuleCountSummary() : `${pathCount} paths available`;
    const statusHtml = listMode
      ? `${state.virtualPathRulesLoading ? '<div class="email-empty">Loading virtual-path rules.</div>' : ''}${state.virtualPathRulesError ? `<div class="email-error">${escHtml(state.virtualPathRulesError)}</div>` : ''}`
      : '';
    const pathOptions = virtualPathOptionsHtml();
    const ruleOptions = ruleOptionsHtml();

    if (listMode) readVirtualPathRuleDrafts();
    document.querySelectorAll('.email-rules-panel').forEach(panel => {
      const count = panel.querySelector('[data-email-vpath-rule-count]');
      if (count) count.textContent = title;
      const pathMeta = panel.querySelector('[data-email-vpath-path-count]');
      if (pathMeta) pathMeta.textContent = `${pathCount} paths`;
      const status = panel.querySelector('[data-email-vpath-rule-status]');
      if (status) status.innerHTML = statusHtml;
      panel.querySelectorAll('[data-email-vpath-options]').forEach(datalist => {
        datalist.innerHTML = pathOptions;
      });
      if (listMode) {
        const listHost = panel.querySelector('[data-email-vpath-rules-list-host]');
        if (listHost) listHost.innerHTML = virtualPathRulesListHtml();
      }
      panel.querySelectorAll('[data-email-rule-apply-form] select[name="rule_id"]').forEach(select => {
        const selected = select.value;
        select.innerHTML = ruleOptions;
        if (Array.from(select.options).some(option => option.value === selected)) select.value = selected;
      });
      syncVirtualPathRuleControls(panel);
    });
  }

  function toggleVirtualPathRuleExpanded(ruleId) {
    const clean = String(ruleId || '').trim();
    if (!clean) return false;
    if (state.virtualPathRuleExpanded.has(clean)) state.virtualPathRuleExpanded.delete(clean);
    else state.virtualPathRuleExpanded = new Set([clean]);
    renderVirtualPathRuleListHosts();
    return true;
  }

  function activeVirtualPathRulesRoot() {
    const modal = el('email-secondary-modal');
    if (modal?.open) {
      const modalBody = el('email-secondary-modal-body');
      if (modalBody?.querySelector?.('.email-rules-panel')) return modalBody;
    }
    const ultrawide = document.querySelector('#ultrawide-sidecar .email-rules-panel');
    if (ultrawide) return ultrawide.closest('#ultrawide-sidecar') || ultrawide;
    const bottom = el('email-secondary-bottom-body');
    if (bottom?.querySelector?.('.email-rules-panel')) return bottom;
    return null;
  }

  function captureVirtualPathRuleSectionState(root = null) {
    if (state.secondaryTab !== 'rules') return;
    const host = root || activeVirtualPathRulesRoot();
    if (!host) return;
    host.querySelectorAll('[data-email-vpath-rule-section]').forEach(details => {
      const sectionId = String(details.dataset.emailVpathRuleSection || '').trim();
      if (!sectionId) return;
      if (details.open) state.virtualPathRuleOpenSections.add(sectionId);
      else state.virtualPathRuleOpenSections.delete(sectionId);
    });
  }

  function virtualPathRuleSectionOpenAttr(sectionId) {
    return state.virtualPathRuleOpenSections.has(String(sectionId || '').trim()) ? ' open' : '';
  }

  function syncVirtualPathRuleSectionDom(sectionId) {
    const clean = String(sectionId || '').trim();
    if (!clean) return;
    const open = state.virtualPathRuleOpenSections.has(clean);
    document.querySelectorAll('[data-email-vpath-rule-section]').forEach(details => {
      if (String(details.dataset.emailVpathRuleSection || '').trim() === clean) details.open = open;
    });
  }

  function toggleVirtualPathRuleSection(sectionId) {
    const clean = String(sectionId || '').trim();
    if (!clean) return false;
    if (state.virtualPathRuleOpenSections.has(clean)) state.virtualPathRuleOpenSections.delete(clean);
    else state.virtualPathRuleOpenSections.add(clean);
    syncVirtualPathRuleSectionDom(clean);
    return true;
  }

  function syncVirtualPathRunButton(form) {
    const checked = Boolean(form?.querySelector?.('[data-email-vpath-apply-toggle]')?.checked);
    const button = form?.querySelector?.('[data-email-vpath-run-label]');
    if (!button) return;
    button.textContent = checked
      ? String(button.dataset.applyLabel || 'Apply')
      : String(button.dataset.previewLabel || 'Preview');
  }

  function syncVirtualPathScopeControls(form) {
    const select = form?.querySelector?.('[data-email-vpath-scope-mode]');
    if (!select) return;
    const mode = String(select.value || 'all');
    form.querySelectorAll('[data-email-vpath-scope-field]').forEach(node => {
      node.hidden = node.dataset.emailVpathScopeField !== mode;
    });
    const limit = form.querySelector('[name="limit"]');
    if (limit) {
      limit.disabled = mode === 'selected_message';
      if (mode === 'selected_message') limit.value = '1';
    }
  }

  function syncVirtualPathRuleControls(root = document) {
    root.querySelectorAll('[data-email-vpath-bulk-form], [data-email-rule-apply-form]').forEach(form => {
      syncVirtualPathRunButton(form);
      syncVirtualPathScopeControls(form);
    });
  }

  function syncSecondaryModalMode() {
    const modal = el('email-secondary-modal');
    if (!modal) return;
    modal.classList.toggle('email-secondary-modal--rules', state.secondaryTab === 'rules');
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

  function searchModeDropdownHtml(layout = 'secondary', options = {}) {
    const active = state.secondaryTab === 'search';
    const activateSearch = options.activateSearch !== false;
    const placement = options.placement || (activateSearch ? 'tab' : 'toolbar');
    const primaryAttrs = activateSearch
      ? `data-email-secondary-tab="search" data-active="${active ? 'true' : 'false'}" data-email-secondary-layout="${escHtml(layout)}"`
      : 'aria-label="Choose search mode" aria-haspopup="menu" aria-expanded="false" data-email-search-mode-menu-toggle';
    return `
      <div class="email-search-tab-dropdown email-folder-tab-dropdown" data-email-search-mode-dropdown data-email-search-mode-placement="${escHtml(placement)}" data-active="${active ? 'true' : 'false'}" data-mode="${escHtml(state.searchMode)}" data-email-secondary-layout="${escHtml(layout)}">
        <div class="email-folder-tab-split">
          <button class="email-folder-tab email-folder-tab--primary" type="button" ${primaryAttrs}>
            <span data-email-search-mode-label>Search: ${escHtml(searchModeLabel())}</span>
          </button>
          <button class="email-folder-tab-caret" type="button" aria-label="Choose search mode" aria-haspopup="menu" aria-expanded="false" data-email-search-mode-menu-toggle>
            <span class="menu-editor-icon menu-editor-icon--chevron-down" aria-hidden="true"></span>
          </button>
        </div>
        <div class="email-folder-tab-menu" role="menu">
          ${SEARCH_MODE_OPTIONS.map(([id, label]) => `
            <button class="email-folder-tab-menu__item" type="button" role="menuitemradio" aria-checked="${state.searchMode === id ? 'true' : 'false'}" data-email-search-mode-option="${escHtml(id)}">${escHtml(label)}</button>
          `).join('')}
        </div>
      </div>
    `;
  }

  function searchTabDropdownHtml(layout = 'secondary') {
    return searchModeDropdownHtml(layout, { activateSearch: true, placement: 'tab' });
  }

  function searchModeToolbarDropdownHtml(layout = 'ultrawide') {
    return searchModeDropdownHtml(layout, { activateSearch: false, placement: 'toolbar' });
  }

  function trustedViewOptionCount(id) {
    if (id === 'probable') return Array.isArray(state.trustedSenders) ? state.trustedSenders.length : 0;
    return 0;
  }

  function trustedViewOptionLabel(id, label) {
    return `${label} (${trustedViewOptionCount(id)})`;
  }

  function trustedViewLabel() {
    const found = TRUSTED_VIEW_OPTIONS.find(([id]) => id === state.trustedNestedTab);
    const option = found || TRUSTED_VIEW_OPTIONS[0];
    return trustedViewOptionLabel(option[0], option[1]);
  }

  function trustedViewDropdownHtml(layout = 'secondary', options = {}) {
    const active = state.secondaryTab === 'trusted';
    const activateTrusted = options.activateTrusted !== false;
    const placement = options.placement || (activateTrusted ? 'tab' : 'toolbar');
    const label = activateTrusted ? 'Trusted' : trustedViewLabel();
    const primaryAttrs = activateTrusted
      ? `data-email-secondary-tab="trusted" data-active="${active ? 'true' : 'false'}" data-email-secondary-layout="${escHtml(layout)}"`
      : 'aria-label="Choose trusted sender table" aria-haspopup="menu" aria-expanded="false" data-email-trusted-view-menu-toggle';
    return `
      <div class="email-trusted-view-dropdown email-folder-tab-dropdown" data-email-trusted-view-dropdown data-email-trusted-view-placement="${escHtml(placement)}" data-active="${active ? 'true' : 'false'}" data-view="${escHtml(state.trustedNestedTab)}" data-email-secondary-layout="${escHtml(layout)}">
        <div class="email-folder-tab-split">
          <button class="email-folder-tab email-folder-tab--primary" type="button" ${primaryAttrs}>
            <span data-email-trusted-view-label>${escHtml(label)}</span>
          </button>
          <button class="email-folder-tab-caret" type="button" aria-label="Choose trusted sender table" aria-haspopup="menu" aria-expanded="false" data-email-trusted-view-menu-toggle>
            <span class="menu-editor-icon menu-editor-icon--chevron-down" aria-hidden="true"></span>
          </button>
        </div>
        <div class="email-folder-tab-menu" role="menu">
          ${TRUSTED_VIEW_OPTIONS.map(([id, labelText]) => `
            <button class="email-folder-tab-menu__item" type="button" role="menuitemradio" aria-checked="${state.trustedNestedTab === id ? 'true' : 'false'}" data-email-trusted-view-option="${escHtml(id)}">${escHtml(trustedViewOptionLabel(id, labelText))}</button>
          `).join('')}
        </div>
      </div>
    `;
  }

  function trustedTabDropdownHtml(layout = 'secondary') {
    return trustedViewDropdownHtml(layout, { activateTrusted: true, placement: 'tab' });
  }

  function trustedViewToolbarDropdownHtml(layout = 'ultrawide') {
    return trustedViewDropdownHtml(layout, { activateTrusted: false, placement: 'toolbar' });
  }

  function normalizeRulesTool(tool) {
    const clean = String(tool || '').trim();
    return RULES_TOOL_IDS.has(clean) ? clean : 'rules';
  }

  function rulesToolLabel(tool = state.virtualPathRuleTool) {
    const clean = normalizeRulesTool(tool);
    return RULES_TOOL_OPTIONS.find(([id]) => id === clean)?.[1] || 'Rules list';
  }

  function rulesToolTabLabel(tool = state.virtualPathRuleTool) {
    const clean = normalizeRulesTool(tool);
    if (clean === 'rules') return 'Rules: List';
    if (clean === 'create') return 'Rules: Create';
    return `Rules: ${rulesToolLabel(clean)}`;
  }

  function rulesToolDropdownHtml(layout = 'secondary', options = {}) {
    const active = state.secondaryTab === 'rules';
    const activeTool = normalizeRulesTool(state.virtualPathRuleTool);
    const activateRules = options.activateRules !== false;
    const placement = options.placement || (activateRules ? 'tab' : 'toolbar');
    const label = activateRules ? rulesToolTabLabel(activeTool) : rulesToolLabel(activeTool);
    const primaryAttrs = activateRules
      ? `data-email-secondary-tab="rules" data-active="${active ? 'true' : 'false'}" data-email-secondary-layout="${escHtml(layout)}"`
      : 'aria-label="Choose Rules tool" aria-haspopup="menu" aria-expanded="false" data-email-rules-tool-menu-toggle';
    return `
      <div class="email-rules-tool-dropdown email-folder-tab-dropdown" data-email-rules-tool-dropdown data-email-rules-tool-placement="${escHtml(placement)}" data-active="${active ? 'true' : 'false'}" data-tool="${escHtml(activeTool)}" data-email-secondary-layout="${escHtml(layout)}">
        <div class="email-folder-tab-split">
          <button class="email-folder-tab email-folder-tab--primary" type="button" ${primaryAttrs}>
            <span data-email-rules-tool-label>${escHtml(label)}</span>
          </button>
          <button class="email-folder-tab-caret" type="button" aria-label="Choose Rules tool" aria-haspopup="menu" aria-expanded="false" data-email-rules-tool-menu-toggle>
            <span class="menu-editor-icon menu-editor-icon--chevron-down" aria-hidden="true"></span>
          </button>
        </div>
        <div class="email-folder-tab-menu" role="menu">
          ${RULES_TOOL_OPTIONS.map(([id, label]) => `
            <button class="email-folder-tab-menu__item" type="button" role="menuitemradio" aria-checked="${activeTool === id ? 'true' : 'false'}" data-email-rules-tool-option="${escHtml(id)}">${escHtml(label)}</button>
          `).join('')}
        </div>
      </div>
    `;
  }

  function rulesTabDropdownHtml(layout = 'secondary') {
    return rulesToolDropdownHtml(layout, { activateRules: true, placement: 'tab' });
  }

  function rulesToolToolbarDropdownHtml(layout = 'ultrawide') {
    return rulesToolDropdownHtml(layout, { activateRules: false, placement: 'toolbar' });
  }

  function secondaryTabButtonHtml(id, label, layout = 'secondary') {
    return `<button type="button" data-email-secondary-tab="${escHtml(id)}" data-active="${state.secondaryTab === id ? 'true' : 'false'}" data-email-secondary-layout="${escHtml(layout)}">${escHtml(label)}</button>`;
  }

  function secondaryTabsHtml(layout = 'secondary') {
    return EMAIL_SECONDARY_TABS.map(([id, label]) => (
      id === 'search' && layout !== 'ultrawide'
        ? searchTabDropdownHtml(layout)
        : id === 'trusted' && layout !== 'ultrawide'
          ? trustedTabDropdownHtml(layout)
        : id === 'rules' && layout !== 'ultrawide'
          ? rulesTabDropdownHtml(layout)
        : secondaryTabButtonHtml(id, label, layout)
    )).join('');
  }

  function normalizeSecondaryTab(tabId) {
    const clean = String(tabId || '').trim();
    return EMAIL_SECONDARY_TAB_IDS.has(clean) ? clean : 'folders';
  }

  function ruleJsonValue(value, fallback = {}) {
    try {
      return JSON.stringify(value && typeof value === 'object' ? value : fallback, null, 2);
    } catch (error) {
      return JSON.stringify(fallback, null, 2);
    }
  }

  function virtualPathRulesErrorMessage(error) {
    const text = String(error?.message || error || '').trim();
    if (/^(not found|http 404)$/i.test(text)) {
      return 'Virtual-path rule endpoints are not available in the running Blueprints service.';
    }
    return text || 'Virtual-path rules are unavailable.';
  }

  function clearVirtualPathRuleMessageContext() {
    state.virtualPathRuleContextEmailUid = '';
    state.virtualPathRuleContextLoading = false;
    state.virtualPathRuleContextError = '';
    state.virtualPathRuleContextHistory = null;
    state.virtualPathRuleContextPreview = null;
  }

  function virtualPathRuleContextApplications() {
    const items = [];
    const pushApps = value => {
      const apps = Array.isArray(value?.applications) ? value.applications : [];
      apps.forEach(app => items.push(app));
    };
    pushApps(state.virtualPathRuleContextHistory);
    pushApps(state.virtualPathRuleContextPreview);
    pushApps(state.virtualPathRuleLastRun);
    return items;
  }

  function virtualPathRuleContextIds() {
    const ids = new Set();
    virtualPathRuleContextApplications().forEach(app => {
      const id = String(app?.rule_id || '').trim();
      if (id) ids.add(id);
    });
    return ids;
  }

  function ruleSearchText(rule) {
    return [
      rule?.display_name,
      rule?.rule_id,
      rule?.status,
      rule?.current_version,
      ruleJsonValue(rule?.predicate || {}),
      ruleJsonValue(rule?.action || {}),
      ruleJsonValue(rule?.scope || {}),
    ].join(' ').toLowerCase();
  }

  function filteredVirtualPathRules() {
    const rules = Array.isArray(state.virtualPathRules) ? state.virtualPathRules : [];
    const query = String(state.virtualPathRuleSearch || '').trim().toLowerCase();
    const contextUid = String(state.virtualPathRuleContextEmailUid || '').trim();
    const contextIds = virtualPathRuleContextIds();
    return rules.filter(rule => {
      const ruleId = String(rule?.rule_id || '').trim();
      if (contextUid && !contextIds.has(ruleId)) return false;
      if (!query) return true;
      return ruleSearchText(rule).includes(query);
    });
  }

  function virtualPathRuleCountSummary() {
    const total = Array.isArray(state.virtualPathRules) ? state.virtualPathRules.length : 0;
    const shown = filteredVirtualPathRules().length;
    return shown === total ? `${total} rules` : `${shown}/${total} rules`;
  }

  function formatRuleCondition(condition) {
    if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return 'Custom predicate';
    if (Array.isArray(condition.all)) return `All of ${condition.all.length}`;
    if (Array.isArray(condition.any)) return `Any of ${condition.any.length}`;
    if (condition.not) return 'Not';
    const field = String(condition.field || '').trim();
    const op = String(condition.op || condition.operator || '').trim();
    const value = String(condition.value ?? '').trim();
    if (field && op && value) return `${field} ${op} ${value}`;
    if (field && op) return `${field} ${op}`;
    return 'Custom predicate';
  }

  function formatRuleAction(action) {
    const actions = Array.isArray(action) ? action : [action];
    return actions
      .filter(item => item && typeof item === 'object')
      .map(item => {
        const op = String(item.operation || '').trim() || 'action';
        if (op === 'move') {
          const source = String(item.source_virtual_path || '').trim();
          const dest = String(item.destination_virtual_path || item.virtual_path || '').trim();
          return `${source || 'source'} -> ${dest || 'destination'}`;
        }
        const path = String(item.virtual_path || item.destination_virtual_path || '').trim();
        return `${op}${path ? ` ${path}` : ''}`;
      })
      .join(', ') || 'Custom action';
  }

  function formatRuleScope(scope) {
    const clean = scope && typeof scope === 'object' && !Array.isArray(scope) ? scope : {};
    if (Array.isArray(clean.message_uids) && clean.message_uids.length) return `${clean.message_uids.length} messages`;
    if (Array.isArray(clean.virtual_paths) && clean.virtual_paths.length) return clean.virtual_paths.join(', ');
    if (clean.incoming_x) return 'Incoming-eligible messages';
    if (clean.limit) return `All local emails, limit ${clean.limit}`;
    return 'All local emails';
  }

  function ruleAuditForRule(ruleId) {
    const clean = String(ruleId || '').trim();
    const seen = new Set();
    return virtualPathRuleContextApplications()
      .filter(app => String(app?.rule_id || '').trim() === clean)
      .filter(app => {
        const key = String(app?.application_id || `${app?.run_id || ''}:${app?.email_uid || ''}:${app?.event_ts || ''}`);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 4);
  }

  function ruleDetailSectionHtml(title, value) {
    return `
      <section class="email-rule-detail-section">
        <h4>${escHtml(title)}</h4>
        <pre><code>${escHtml(ruleJsonValue(value || {}))}</code></pre>
      </section>
    `;
  }

  function ruleAuditHtml(rule) {
    const apps = ruleAuditForRule(rule?.rule_id || '');
    if (!apps.length) return '<div class="email-rule-audit-empty">No run history loaded for this rule.</div>';
    return `
      <div class="email-rule-audit-list">
        ${apps.map(app => `
          <div class="email-rule-audit-row">
            <span>${escHtml(app.action_status || (app.matched ? 'matched' : 'not matched'))}</span>
            <span>${escHtml(app.operation || '')}</span>
            <span>${escHtml(app.event_ts || app.run_id || '')}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function virtualPathRuleRowHtml(rule) {
    const ruleId = String(rule?.rule_id || '').trim();
    const expanded = state.virtualPathRuleExpanded?.has?.(ruleId);
    const status = String(rule?.status || 'unknown');
    const active = status === 'active';
    const draft = virtualPathRuleDraft(rule);
    const saving = state.virtualPathRuleSaving.has(ruleId);
    return `
      <article class="email-rule-row" data-email-vpath-rule-row="${escHtml(ruleId)}" data-expanded="${expanded ? 'true' : 'false'}">
        <div class="email-rule-row__top">
          <button class="email-rule-row__toggle" type="button" data-email-vpath-rule-toggle="${escHtml(ruleId)}" aria-expanded="${expanded ? 'true' : 'false'}">
            <span class="email-rule-row__chevron" aria-hidden="true"></span>
            <span class="email-rule-row__title">${escHtml(rule.display_name || ruleId || 'Virtual path rule')}</span>
          </button>
          <label class="hub-checkbox email-rule-row__active">
            <input class="hub-checkbox__input" type="checkbox" data-email-vpath-rule-active-toggle="${escHtml(ruleId)}"${active ? ' checked' : ''}${active ? '' : ' disabled'}>
            <span class="hub-checkbox__box" aria-hidden="true"></span>
            <span class="hub-checkbox__label">Active</span>
          </label>
        </div>
        <div class="email-rule-row__summary">
          <span>${escHtml(status)}</span>
          <span>v${escHtml(rule.current_version ?? '')}</span>
          <span>${escHtml(formatRuleCondition(rule.predicate || {}))}</span>
          <span>${escHtml(formatRuleAction(rule.action || {}))}</span>
          <span>${escHtml(formatRuleScope(rule.scope || {}))}</span>
        </div>
        <div class="email-rule-row__meta">${escHtml(ruleId)}</div>
        <div class="email-rule-row__details"${expanded ? '' : ' hidden'}>
          <form class="email-rule-form email-rule-form--wide email-rule-edit-form" data-email-rule-edit-form data-email-rule-id="${escHtml(ruleId)}">
            <div class="email-rule-edit-grid">
              <label>
                <span>Rule name</span>
                <input name="display_name" value="${escHtml(draft.display_name)}" data-email-preserve-focus="vpath-rule-edit-${escHtml(ruleId)}-name" autocomplete="off"${saving ? ' disabled' : ''}>
              </label>
              <label>
                <span>Status</span>
                <select name="status" data-email-preserve-focus="vpath-rule-edit-${escHtml(ruleId)}-status"${saving ? ' disabled' : ''}>
                  <option value="active"${draft.status === 'active' ? ' selected' : ''}>Active</option>
                  <option value="archived"${draft.status === 'archived' ? ' selected' : ''}>Archived</option>
                </select>
              </label>
              <label class="email-rule-sequence-field">
                <span>Sequence</span>
                <input name="sequence" type="number" min="0" step="1" value="${escHtml(draft.sequence)}" data-email-preserve-focus="vpath-rule-edit-${escHtml(ruleId)}-sequence"${saving ? ' disabled' : ''}>
              </label>
              <label class="hub-checkbox email-rule-apply-toggle email-rule-edit-stop">
                <input class="hub-checkbox__input" name="stop_on_match" type="checkbox" data-email-preserve-focus="vpath-rule-edit-${escHtml(ruleId)}-stop"${draft.stop_on_match ? ' checked' : ''}${saving ? ' disabled' : ''}>
                <span class="hub-checkbox__box" aria-hidden="true"></span>
                <span class="hub-checkbox__label">Stop on match</span>
              </label>
              <label class="email-rule-edit-description">
                <span>Description</span>
                <textarea name="description" data-email-preserve-focus="vpath-rule-edit-${escHtml(ruleId)}-description" spellcheck="false"${saving ? ' disabled' : ''}>${escHtml(draft.description)}</textarea>
              </label>
            </div>
            <div class="email-rule-detail-grid email-rule-detail-grid--edit">
              <label class="email-rule-detail-section">
                <span>Predicate JSON</span>
                <textarea name="predicate" data-email-preserve-focus="vpath-rule-edit-${escHtml(ruleId)}-predicate" spellcheck="false"${saving ? ' disabled' : ''}>${escHtml(draft.predicate)}</textarea>
              </label>
              <label class="email-rule-detail-section">
                <span>Action JSON</span>
                <textarea name="action" data-email-preserve-focus="vpath-rule-edit-${escHtml(ruleId)}-action" spellcheck="false"${saving ? ' disabled' : ''}>${escHtml(draft.action)}</textarea>
              </label>
              <label class="email-rule-detail-section">
                <span>Scope JSON</span>
                <textarea name="scope" data-email-preserve-focus="vpath-rule-edit-${escHtml(ruleId)}-scope" spellcheck="false"${saving ? ' disabled' : ''}>${escHtml(draft.scope)}</textarea>
              </label>
            <section class="email-rule-detail-section">
              <h4>Run History</h4>
              ${ruleAuditHtml(rule)}
            </section>
            </div>
            <div class="email-rule-row__actions">
              <button class="hub-action-btn hub-primary" type="submit"${saving ? ' disabled' : ''}>${saving ? 'Saving...' : 'Save rule'}</button>
              <button class="hub-action-btn" type="button" data-email-rule-apply-one="${escHtml(ruleId)}"${state.virtualPathRuleApplyLoading ? ' disabled' : ''}>Preview dry-run</button>
              <button class="hub-action-btn email-rule-danger" type="button" data-email-vpath-rule-archive="${escHtml(ruleId)}"${saving ? ' disabled' : ''}>Archive</button>
            </div>
          </form>
        </div>
      </article>
    `;
  }

  function virtualPathName(folder) {
    return String(folder?.path || folder?.name || folder?.virtual_path || '').trim();
  }

  function normalizeVirtualPath(path) {
    return String(path || '')
      .split('/')
      .map(part => part.trim())
      .filter(Boolean)
      .join('/');
  }

  function virtualPathBaseName(path) {
    const parts = normalizeVirtualPath(path).split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  }

  function childVirtualPath(parentPath, childName) {
    const parent = normalizeVirtualPath(parentPath);
    const child = normalizeVirtualPath(childName);
    if (!child) return parent;
    return parent ? `${parent}/${child}` : child;
  }

  function virtualPathRecordFor(path) {
    const clean = normalizeVirtualPath(path);
    return (state.virtualPaths || []).find(item => normalizeVirtualPath(virtualPathName(item)) === clean) || null;
  }

  function virtualPathCapabilities(path) {
    const record = virtualPathRecordFor(path);
    if (!record || typeof record !== 'object') return null;
    const capabilities = record.capabilities && typeof record.capabilities === 'object'
      ? record.capabilities
      : record.metadata && typeof record.metadata === 'object'
        ? record.metadata
        : record;
    return capabilities && typeof capabilities === 'object' ? capabilities : null;
  }

  function isReadOnlyVirtualPath(path) {
    const clean = normalizeVirtualPath(path);
    if (!clean) return false;
    const capabilities = virtualPathCapabilities(clean);
    return capabilities ? Boolean(capabilities.read_only) : true;
  }

  function isMutableVirtualPath(path) {
    const clean = normalizeVirtualPath(path);
    const capabilities = virtualPathCapabilities(clean);
    return Boolean(clean && capabilities && capabilities.assignable && !capabilities.read_only);
  }

  function virtualPathAllows(path, capability) {
    const clean = normalizeVirtualPath(path);
    if (!clean) return capability === 'can_create_child';
    return Boolean(virtualPathCapabilities(clean)?.[capability]);
  }

  function virtualPathOptionsHtml(options = {}) {
    return state.virtualPaths
      .filter(item => !options.assignableOnly || Boolean((item.capabilities || item.metadata || item)?.assignable))
      .map(item => virtualPathName(item))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map(path => `<option value="${escHtml(path)}"></option>`)
      .join('');
  }

  function splitVirtualPathInput(value) {
    return String(value || '')
      .split(/[\n,]+/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  function virtualPathInputControlHtml({ label, name, key, value = '', placeholder = '', multi = false, allowRoot = false, mutable = false }) {
    return `
      <div class="email-vpath-picker-field">
        <span class="email-rule-field-label">${escHtml(label)}</span>
        <div class="email-rule-field-action-row email-vpath-picker-input-row">
          <input name="${escHtml(name)}" value="${escHtml(value)}" data-email-preserve-focus="${escHtml(key)}" data-email-vpath-input-key="${escHtml(key)}"${multi ? ' data-email-vpath-multi="true"' : ''}${allowRoot ? ' data-email-vpath-allow-root="true"' : ''}${mutable ? ' data-email-vpath-mutable="true"' : ''} placeholder="${escHtml(placeholder)}" autocomplete="off" aria-label="${escHtml(label)}" readonly>
          <button class="hub-action-btn" type="button" data-email-vpath-picker-open data-email-vpath-picker-target="${escHtml(key)}" aria-label="Choose ${escHtml(label)}">Choose</button>
        </div>
      </div>
    `;
  }

  function buildVirtualPathTree() {
    const root = { name: 'Virtual paths', path: '', direct: true, children: new Map() };
    const query = String(state.virtualPathPicker?.searchQuery || '').trim().toLowerCase();
    state.virtualPaths
      .filter(item => {
        if (!query) return true;
        const path = virtualPathName(item).toLowerCase();
        const capabilities = item?.capabilities || item?.metadata || item || {};
        return path.includes(query)
          || String(capabilities.path_kind || '').toLowerCase().includes(query)
          || String(capabilities.special_role || '').toLowerCase().includes(query);
      })
      .map(item => normalizeVirtualPath(virtualPathName(item)))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .forEach(path => {
        const parts = path.split('/').filter(Boolean);
        let node = root;
        const pathParts = [];
        parts.forEach((part, index) => {
          pathParts.push(part);
          if (!node.children.has(part)) {
            node.children.set(part, {
              name: part,
              path: pathParts.join('/'),
              direct: false,
              children: new Map(),
            });
          }
          node = node.children.get(part);
          if (index === parts.length - 1) node.direct = true;
        });
      });
    return root;
  }

  function canDropVirtualPath(sourcePath, targetParentPath, operation = 'move') {
    const source = normalizeVirtualPath(sourcePath);
    const targetParent = normalizeVirtualPath(targetParentPath);
    if (!virtualPathAllows(source, operation === 'copy' ? 'can_copy_subtree' : 'can_move_subtree')) return false;
    if (targetParent && !virtualPathAllows(targetParent, 'can_create_child')) return false;
    if (source === targetParent || targetParent.startsWith(`${source}/`)) return false;
    const destination = childVirtualPath(targetParent, virtualPathBaseName(source));
    return Boolean(destination && destination !== source);
  }

  function virtualPathTreeNodeHtml(node, depth = 0) {
    const path = normalizeVirtualPath(node.path);
    const childNodes = Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name));
    const readOnly = isReadOnlyVirtualPath(path);
    const capabilities = virtualPathCapabilities(path) || {};
    const mutable = Boolean(capabilities.can_move_subtree);
    const selected = normalizeVirtualPath(state.virtualPathPicker?.selectedPath || '') === path;
    const actionOpen = normalizeVirtualPath(state.virtualPathPicker?.actionPath || '') === path;
    const kind = capabilities.path_kind === 'meta_view'
      ? 'Read-only meta view'
      : capabilities.is_protected_root
        ? `Protected ${capabilities.special_role || 'special'} root`
        : childNodes.length ? 'Mutable branch' : 'Mutable path';
    return `
      <li class="email-vpath-tree-item" data-readonly="${readOnly ? 'true' : 'false'}">
        <div class="email-vpath-tree-node${selected ? ' is-selected' : ''}${actionOpen ? ' is-action-open' : ''}${readOnly ? ' is-readonly' : ''}" style="--vpath-depth:${depth}" data-email-vpath-tree-drop-target="${escHtml(path)}">
          <button class="email-vpath-tree-node__main" type="button" data-email-vpath-tree-select="${escHtml(path)}" data-email-vpath-tree-node="${escHtml(path)}" draggable="${mutable ? 'true' : 'false'}">
            <span class="email-vpath-tree-node__name">${escHtml(node.name)}</span>
            <span class="email-vpath-tree-node__kind">${escHtml(kind)}</span>
          </button>
          <button class="email-vpath-tree-node__actions" type="button" aria-label="Path actions" data-email-vpath-tree-actions="${escHtml(path)}">...</button>
        </div>
        ${actionOpen ? virtualPathTreeActionPanelHtml(path) : ''}
        ${childNodes.length ? `<ol class="email-vpath-tree-children">${childNodes.map(child => virtualPathTreeNodeHtml(child, depth + 1)).join('')}</ol>` : ''}
      </li>
    `;
  }

  function virtualPathTreeActionPanelHtml(path) {
    const clean = normalizeVirtualPath(path);
    const capabilities = virtualPathCapabilities(clean) || {};
    const canCreateChild = !clean || Boolean(capabilities.can_create_child);
    const targetLabel = clean || 'Root';
    return `
      <div class="email-vpath-tree-actions-panel">
        <strong>${escHtml(targetLabel)}</strong>
        <div class="email-vpath-tree-create-row">
          <input data-email-vpath-tree-child-name value="" placeholder="Child path name" autocomplete="off"${canCreateChild ? '' : ' disabled'}>
          <button class="hub-action-btn hub-primary" type="button" data-email-vpath-tree-create-child="${escHtml(clean)}"${canCreateChild ? '' : ' disabled'}>Create child</button>
        </div>
        ${clean ? `
          <div class="email-vpath-tree-action-buttons">
            ${capabilities.can_copy_subtree ? `<button class="hub-action-btn" type="button" data-email-vpath-tree-copy="${escHtml(clean)}">Copy</button>` : ''}
            ${capabilities.can_move_subtree ? `<button class="hub-action-btn" type="button" data-email-vpath-tree-move="${escHtml(clean)}">Move</button>` : ''}
            ${capabilities.can_archive_subtree ? `<button class="hub-action-btn" type="button" data-email-vpath-tree-archive="${escHtml(clean)}">Archive</button>` : ''}
            ${capabilities.can_delete_subtree ? `<button class="hub-action-btn email-rule-danger" type="button" data-email-vpath-tree-delete="${escHtml(clean)}">Delete</button>` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  function virtualPathTreeHtml() {
    const root = buildVirtualPathTree();
    const childNodes = Array.from(root.children.values()).sort((a, b) => a.name.localeCompare(b.name));
    return `
      <div class="email-vpath-tree-root">
        <button class="hub-action-btn" type="button" data-email-vpath-tree-select="" data-email-vpath-tree-node="">Root</button>
        <button class="hub-action-btn" type="button" data-email-vpath-tree-actions="">Root actions</button>
      </div>
      ${state.virtualPathPicker?.actionPath === '' ? virtualPathTreeActionPanelHtml('') : ''}
      <ol class="email-vpath-tree">
        ${childNodes.length ? childNodes.map(child => virtualPathTreeNodeHtml(child, 0)).join('') : '<li class="email-empty">No virtual paths loaded.</li>'}
      </ol>
    `;
  }

  function ensureVirtualPathTreePickerDialog() {
    let dialog = el('email-vpath-tree-picker-modal');
    if (dialog) return dialog;
    const host = document.createElement('div');
    host.innerHTML = `
      <dialog id="email-vpath-tree-picker-modal" class="hub-modal email-vpath-tree-picker-modal">
        <div class="hub-modal-header">
          <h2 class="hub-modal-title" data-email-vpath-tree-title>Virtual paths</h2>
          <button class="hub-modal-close" type="button" aria-label="Close" data-email-vpath-tree-close>&#10005;</button>
        </div>
        <div class="hub-modal-body" data-email-vpath-tree-body></div>
        <div class="hub-modal-footer">
          <button class="hub-modal-btn secondary" type="button" data-email-vpath-tree-close>Close</button>
        </div>
      </dialog>
    `.trim();
    dialog = host.firstElementChild;
    document.body.appendChild(dialog);
    if (typeof HubModal !== 'undefined') HubModal.init(document.body);
    return dialog;
  }

  function virtualPathHelpContent(kind) {
    if (kind === 'bulk') {
      return `
        <div class="email-vpath-help" data-email-vpath-help-kind="bulk">
          <p class="email-vpath-help__lede">Bulk Move changes where selected messages are currently associated. It does not move, rename, or reorganise folder paths.</p>
          <section class="email-vpath-help-card">
            <h3>What this form changes</h3>
            <div class="email-vpath-help-flow" aria-label="A message association moves from one exact path to another exact path">
              <div class="email-vpath-help-flow__node">
                <span>Message</span>
                <code>example message</code>
              </div>
              <span class="email-vpath-help-flow__arrow" aria-hidden="true">→</span>
              <div class="email-vpath-help-flow__node">
                <span>Source association removed</span>
                <code>INBOX</code>
              </div>
              <span class="email-vpath-help-flow__arrow" aria-hidden="true">→</span>
              <div class="email-vpath-help-flow__node">
                <span>Destination association added</span>
                <code>Projects/Next</code>
              </div>
            </div>
            <p>The source and destination are exact mutable paths. The path tree itself stays exactly where it is.</p>
          </section>
          <section class="email-vpath-help-card email-vpath-help-card--warning">
            <h3>Root is not a destination here</h3>
            <p>There is no <strong>Root</strong> value in this form because Root is a structural parent, not a message association path. This form intentionally cannot reparent a subtree.</p>
          </section>
          <section class="email-vpath-help-card">
            <h3>What if I want to move a folder to Root?</h3>
            <p>For example, to place <code>INBOX/__ MORE 01/docker.com</code> alongside <code>Authy</code>, switch to <strong>Rules: Paths</strong>. Open the path actions, choose <strong>Move</strong>, then choose <strong>Root</strong> in the destination picker. The resulting path is <code>docker.com</code>; its descendants are previewed and rebased with it.</p>
          </section>
        </div>
      `;
    }
    return `
      <div class="email-vpath-help" data-email-vpath-help-kind="paths">
        <p class="email-vpath-help__lede">Paths is where you organise the virtual-path tree. A root-level path has no parent path segment.</p>
        <section class="email-vpath-help-card">
          <h3>Move a path branch to Root</h3>
          <div class="email-vpath-help-tree" aria-label="Path tree before and after moving docker.com to Root">
            <div class="email-vpath-help-tree__column">
              <strong>Before</strong>
              <code>Root</code>
              <span>├─ Authy</span>
              <span>└─ INBOX</span>
              <span class="email-vpath-help-tree__nested">└─ __ MORE 01</span>
              <span class="email-vpath-help-tree__nested2">└─ docker.com</span>
            </div>
            <span class="email-vpath-help-tree__arrow" aria-hidden="true">→</span>
            <div class="email-vpath-help-tree__column">
              <strong>After Move → Root</strong>
              <code>Root</code>
              <span>├─ Authy</span>
              <span>├─ INBOX</span>
              <span>└─ docker.com</span>
            </div>
          </div>
          <p>Open <code>INBOX/__ MORE 01/docker.com</code> in the tree, choose <strong>Move</strong>, then press <strong>Root</strong> at the top of the destination picker. Root means “no parent path”, so the destination becomes <code>docker.com</code>.</p>
        </section>
        <section class="email-vpath-help-card">
          <h3>Safe structural actions</h3>
          <p>Preview before applying a copy, move, archive, or delete. The preview reports the affected descendants, association changes, collisions, and audit events. Protected special roots stay in place, but their mutable descendants can be organised normally. Read-only <code>_X</code> views are never mutable destinations.</p>
        </section>
        <section class="email-vpath-help-card email-vpath-help-card--tip">
          <h3>When Bulk Move is the better tool</h3>
          <p>Use <strong>Rules: Bulk Move</strong> when the tree should stay unchanged and you only want messages currently associated with one exact path to become associated with another one. For example, moving message associations from <code>INBOX</code> to <code>Projects/Next</code> does not move <code>INBOX</code> or any of its children.</p>
        </section>
      </div>
    `;
  }

  function ensureVirtualPathHelpDialog() {
    let dialog = el('email-vpath-help-modal');
    if (dialog) return dialog;
    const host = document.createElement('div');
    host.innerHTML = `
      <dialog id="email-vpath-help-modal" class="hub-modal email-vpath-help-modal">
        <div class="hub-modal-header">
          <h2 class="hub-modal-title" data-email-vpath-help-title>Paths help</h2>
          <button class="hub-modal-close" type="button" aria-label="Close" data-email-vpath-help-close>&#10005;</button>
        </div>
        <div class="hub-modal-body" data-email-vpath-help-body></div>
        <div class="hub-modal-footer">
          <button class="hub-modal-btn secondary" type="button" data-email-vpath-help-close>Close</button>
        </div>
      </dialog>
    `.trim();
    dialog = host.firstElementChild;
    document.body.appendChild(dialog);
    if (typeof HubModal !== 'undefined') HubModal.init(document.body);
    return dialog;
  }

  function openVirtualPathHelp(kind) {
    const cleanKind = kind === 'bulk' ? 'bulk' : 'paths';
    const dialog = ensureVirtualPathHelpDialog();
    const title = dialog.querySelector('[data-email-vpath-help-title]');
    const body = dialog.querySelector('[data-email-vpath-help-body]');
    if (title) title.textContent = cleanKind === 'bulk' ? 'Bulk Move messages' : 'Organise path trees';
    if (body) body.innerHTML = virtualPathHelpContent(cleanKind);
    if (typeof HubModal !== 'undefined') HubModal.open(dialog);
    else if (typeof dialog.showModal === 'function') dialog.showModal();
  }

  function closeVirtualPathHelp() {
    const dialog = el('email-vpath-help-modal');
    if (dialog && typeof HubModal !== 'undefined') HubModal.close(dialog);
    else if (dialog?.open && typeof dialog.close === 'function') dialog.close();
  }

  function renderVirtualPathTreePicker() {
    const dialog = ensureVirtualPathTreePickerDialog();
    const title = dialog.querySelector('[data-email-vpath-tree-title]');
    const body = dialog.querySelector('[data-email-vpath-tree-body]');
    const picker = state.virtualPathPicker || {};
    const moving = picker.mode === 'move-destination' && picker.moveSourcePath;
    if (title) title.textContent = moving ? 'Choose destination' : 'Choose virtual path';
    if (body) {
      body.innerHTML = `
        ${picker.error ? `<div class="email-error">${escHtml(picker.error)}</div>` : ''}
        ${moving ? `<div class="email-vpath-tree-banner"><strong>${picker.subtreeOperation === 'copy' ? 'Copy' : 'Move'}</strong><span>${escHtml(picker.moveSourcePath)}</span></div>` : ''}
        <label class="email-vpath-tree-search">
          <span>Search paths</span>
          <input type="search" value="${escHtml(picker.searchQuery || '')}" data-email-vpath-tree-search placeholder="Path, role, or kind" autocomplete="off">
        </label>
        ${virtualPathTreeHtml()}
      `;
    }
    return dialog;
  }

  function virtualPathPickerTargetInput() {
    const key = String(state.virtualPathPicker?.targetKey || '').trim();
    if (!key) return null;
    return Array.from(document.querySelectorAll('[data-email-vpath-input-key]'))
      .find(input => input.dataset.emailVpathInputKey === key) || null;
  }

  async function openVirtualPathTreePicker(targetKey, options = {}) {
    const cleanKey = String(targetKey || '').trim();
    const input = cleanKey
      ? Array.from(document.querySelectorAll('[data-email-vpath-input-key]')).find(node => node.dataset.emailVpathInputKey === cleanKey)
      : null;
    const current = input?.dataset?.emailVpathMulti === 'true'
      ? splitVirtualPathInput(input.value)[0] || ''
      : input?.value || '';
    try {
      // The chooser can outlive another client or an audited stack mutation.
      // Fetch before mounting so a retired path is never an actionable choice.
      await refreshVirtualPathCatalog({ patchControls: true });
    } catch (error) {
      setStatus(`Could not refresh virtual paths: ${virtualPathRulesErrorMessage(error)}`, 'err');
      return false;
    }
    state.virtualPathPicker = {
      open: true,
      targetKey: cleanKey,
      mode: options.mode || 'select',
      selectedPath: normalizeVirtualPath(options.selectedPath || current),
      actionPath: typeof options.actionPath === 'undefined' ? null : normalizeVirtualPath(options.actionPath),
      moveSourcePath: normalizeVirtualPath(options.moveSourcePath || ''),
      subtreeOperation: options.subtreeOperation === 'copy' ? 'copy' : 'move',
      searchQuery: String(options.searchQuery || ''),
      error: '',
    };
    const dialog = renderVirtualPathTreePicker();
    if (typeof HubModal !== 'undefined') {
      HubModal.open(dialog, {
        onClose: () => {
          state.virtualPathPicker.open = false;
          clearVirtualPathTreeLongPress();
        },
      });
    } else if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    }
    return true;
  }

  function closeVirtualPathTreePicker() {
    const dialog = el('email-vpath-tree-picker-modal');
    state.virtualPathPicker.open = false;
    clearVirtualPathTreeLongPress();
    if (dialog && typeof HubModal !== 'undefined') HubModal.close(dialog);
    else if (dialog?.open && typeof dialog.close === 'function') dialog.close();
  }

  function setVirtualPathPickerError(message) {
    state.virtualPathPicker.error = String(message || '');
    renderVirtualPathTreePicker();
  }

  function dispatchPathInputChange(input) {
    input?.dispatchEvent?.(new Event('input', { bubbles: true }));
    input?.dispatchEvent?.(new Event('change', { bubbles: true }));
  }

  async function applyVirtualPathPickerSelection(path) {
    const clean = normalizeVirtualPath(path);
    const picker = state.virtualPathPicker || {};
    if (picker.mode === 'move-destination' && picker.moveSourcePath) {
      return moveVirtualPathIntoParent(picker.moveSourcePath, clean);
    }
    const input = virtualPathPickerTargetInput();
    if (!input) return false;
    if (!clean && input.dataset.emailVpathAllowRoot !== 'true') return false;
    if (clean && input.dataset.emailVpathMutable === 'true' && isReadOnlyVirtualPath(clean)) {
      setVirtualPathPickerError('This path is read-only.');
      return false;
    }
    if (input.dataset.emailVpathMulti === 'true') {
      const paths = splitVirtualPathInput(input.value);
      if (clean && !paths.includes(clean)) paths.push(clean);
      input.value = paths.join(', ');
    } else {
      input.value = clean;
    }
    dispatchPathInputChange(input);
    closeVirtualPathTreePicker();
    input.focus?.({ preventScroll: true });
    return true;
  }

  function confirmHubAction(opts) {
    if (typeof HubDialogs !== 'undefined' && typeof HubDialogs.confirm === 'function') {
      return HubDialogs.confirm(opts);
    }
    return Promise.resolve(true);
  }

  function confirmHubDelete(opts) {
    if (typeof HubDialogs !== 'undefined' && typeof HubDialogs.confirmDelete === 'function') {
      return HubDialogs.confirmDelete(opts);
    }
    return confirmHubAction(Object.assign({ tone: 'danger' }, opts || {}));
  }

  async function createVirtualPathFromPicker(parentPath, childName) {
    const path = childVirtualPath(parentPath, childName);
    if (!path) {
      setVirtualPathPickerError('Enter a child path name.');
      return false;
    }
    if (parentPath && !virtualPathAllows(parentPath, 'can_create_child')) {
      setVirtualPathPickerError('Children cannot be created below this path.');
      return false;
    }
    setStatus('Creating virtual path', 'unknown');
    try {
      await fetchJson(virtualPathsEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ virtual_path: path, actor: 'email-ui', source_surface: 'pim-email-ui-tree-picker' }),
      });
      await refreshVirtualPathRules({ silent: true });
      state.virtualPathPicker.selectedPath = path;
      state.virtualPathPicker.actionPath = path;
      state.virtualPathPicker.error = '';
      renderVirtualPathTreePicker();
      await applyVirtualPathPickerSelection(path);
      setStatus(`Created ${path}`, 'ok');
      return true;
    } catch (error) {
      setVirtualPathPickerError(error.message || String(error));
      setStatus(error.message || String(error), 'err');
      return false;
    }
  }

  async function archiveVirtualPathFromPicker(path, action = 'archive') {
    const clean = normalizeVirtualPath(path);
    const capability = action === 'delete' ? 'can_delete_subtree' : 'can_archive_subtree';
    if (!virtualPathAllows(clean, capability)) {
      setVirtualPathPickerError('This path operation is protected.');
      return false;
    }
    let preview;
    try {
      preview = await fetchJson(virtualPathSubtreeEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: action,
          source_virtual_path: clean,
          dry_run: true,
          actor: 'email-ui',
          source_surface: 'pim-email-ui-tree-picker',
        }),
      });
    } catch (error) {
      setVirtualPathPickerError(error.message || String(error));
      return false;
    }
    const impact = preview.result || {};
    if (!impact.can_apply) {
      setVirtualPathPickerError(`Cannot ${action}: ${(impact.blockers || []).join(', ') || 'operation blocked'}.`);
      return false;
    }
    const ok = await confirmHubDelete({
      title: action === 'delete' ? 'Delete virtual path' : 'Archive virtual path',
      message: clean,
      detail: `${impact.affected_path_count || 0} paths, ${impact.distinct_message_count || 0} messages, ${impact.association_remove_count || 0} associations. Message content is unchanged.`,
      confirmText: action === 'delete' ? 'Delete' : 'Archive',
    });
    if (!ok) return false;
    setStatus(action === 'delete' ? 'Deleting virtual path' : 'Archiving virtual path', 'unknown');
    try {
      await fetchJson(virtualPathSubtreeEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: action, source_virtual_path: clean, dry_run: false, actor: 'email-ui', source_surface: 'pim-email-ui-tree-picker' }),
      });
      const target = virtualPathPickerTargetInput();
      if (target && normalizeVirtualPath(target.value) === clean) {
        target.value = '';
        dispatchPathInputChange(target);
      }
      await refreshVirtualPathRules({ silent: true });
      await load({ force: true, preserveOpenedMessage: true });
      state.virtualPathPicker.selectedPath = '';
      state.virtualPathPicker.actionPath = '';
      state.virtualPathPicker.error = '';
      renderVirtualPathTreePicker();
      setStatus(`${action === 'delete' ? 'Deleted' : 'Archived'} ${clean}`, 'ok');
      return true;
    } catch (error) {
      setVirtualPathPickerError(error.message || String(error));
      setStatus(error.message || String(error), 'err');
      return false;
    }
  }

  async function transferVirtualPathSubtree(sourcePath, destinationPath, operation = 'move') {
    const source = normalizeVirtualPath(sourcePath);
    const destination = normalizeVirtualPath(destinationPath);
    if (!source || !destination || source === destination) return false;
    const capability = operation === 'copy' ? 'can_copy_subtree' : 'can_move_subtree';
    if (!virtualPathAllows(source, capability)) {
      setVirtualPathPickerError('This path operation is protected.');
      return false;
    }
    let preview;
    try {
      preview = await fetchJson(virtualPathSubtreeEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation,
          source_virtual_path: source,
          destination_virtual_path: destination,
          dry_run: true,
          actor: 'email-ui',
          source_surface: 'pim-email-ui-tree-picker',
        }),
      });
    } catch (error) {
      setVirtualPathPickerError(error.message || String(error));
      return false;
    }
    const impact = preview.result || {};
    if (!impact.can_apply) {
      const reason = (impact.collisions || []).length
        ? `${impact.collisions.length} destination collision(s)`
        : (impact.blockers || []).join(', ') || 'operation blocked';
      setVirtualPathPickerError(`Cannot ${operation}: ${reason}.`);
      return false;
    }
    const ok = await confirmHubAction({
      title: `${operation === 'copy' ? 'Copy' : 'Move'} virtual-path subtree`,
      message: `${source} -> ${destination}`,
      detail: `${impact.affected_path_count || 0} paths, ${impact.distinct_message_count || 0} messages, ${impact.association_count || 0} source associations.`,
      confirmText: operation === 'copy' ? 'Copy' : 'Move',
    });
    if (!ok) return false;
    setStatus(`${operation === 'copy' ? 'Copying' : 'Moving'} virtual path`, 'unknown');
    try {
      await fetchJson(virtualPathSubtreeEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation,
          source_virtual_path: source,
          destination_virtual_path: destination,
          dry_run: false,
          actor: 'email-ui',
          source_surface: 'pim-email-ui-tree-picker',
        }),
      });
      await refreshVirtualPathRules({ silent: true });
      await load({ force: true, preserveOpenedMessage: true });
      state.virtualPathPicker.selectedPath = destination;
      state.virtualPathPicker.actionPath = destination;
      state.virtualPathPicker.mode = 'select';
      state.virtualPathPicker.moveSourcePath = '';
      state.virtualPathPicker.subtreeOperation = 'move';
      state.virtualPathPicker.error = '';
      renderVirtualPathTreePicker();
      setStatus(`${operation === 'copy' ? 'Copied' : 'Moved'} ${source}`, 'ok');
      return true;
    } catch (error) {
      setVirtualPathPickerError(error.message || String(error));
      setStatus(error.message || String(error), 'err');
      return false;
    }
  }

  function moveVirtualPath(sourcePath, destinationPath) {
    return transferVirtualPathSubtree(sourcePath, destinationPath, 'move');
  }

  function moveVirtualPathIntoParent(sourcePath, parentPath) {
    const source = normalizeVirtualPath(sourcePath);
    const parent = normalizeVirtualPath(parentPath);
    const operation = state.virtualPathPicker?.subtreeOperation === 'copy' ? 'copy' : 'move';
    if (!canDropVirtualPath(source, parent, operation)) {
      setVirtualPathPickerError('Choose a different mutable destination.');
      return false;
    }
    return transferVirtualPathSubtree(source, childVirtualPath(parent, virtualPathBaseName(source)), operation);
  }

  function openVirtualPathMoveDestination(path, operation = 'move') {
    const clean = normalizeVirtualPath(path);
    const capability = operation === 'copy' ? 'can_copy_subtree' : 'can_move_subtree';
    if (!virtualPathAllows(clean, capability)) {
      setVirtualPathPickerError('This path operation is protected.');
      return false;
    }
    state.virtualPathPicker.mode = 'move-destination';
    state.virtualPathPicker.moveSourcePath = clean;
    state.virtualPathPicker.subtreeOperation = operation === 'copy' ? 'copy' : 'move';
    state.virtualPathPicker.selectedPath = '';
    state.virtualPathPicker.actionPath = '';
    state.virtualPathPicker.error = '';
    renderVirtualPathTreePicker();
    return true;
  }

  function clearVirtualPathTreeLongPress() {
    if (state.virtualPathPickerLongPressTimer) window.clearTimeout(state.virtualPathPickerLongPressTimer);
    state.virtualPathPickerLongPressTimer = null;
    state.virtualPathPickerLongPressPath = '';
  }

  function startVirtualPathTreeLongPress(path) {
    clearVirtualPathTreeLongPress();
    state.virtualPathPickerLongPressPath = normalizeVirtualPath(path);
    state.virtualPathPickerLongPressTimer = window.setTimeout(() => {
      state.virtualPathPicker.actionPath = state.virtualPathPickerLongPressPath;
      state.virtualPathPicker.selectedPath = state.virtualPathPickerLongPressPath;
      state.virtualPathPicker.error = '';
      renderVirtualPathTreePicker();
      clearVirtualPathTreeLongPress();
    }, VPATH_TREE_LONG_PRESS_MS);
  }

  function scopeFromApplyForm(form) {
    const mode = String(form?.querySelector?.('[name="scope_mode"]')?.value || 'all');
    const limit = Math.max(1, Math.min(Number(form?.querySelector?.('[name="limit"]')?.value || 100), 20000));
    if (mode === 'advanced') return parseRuleTextarea(form, 'scope_json', {});
    if (mode === 'virtual_paths') {
      const paths = splitVirtualPathInput(form?.querySelector?.('[name="scope_paths"]')?.value || '');
      if (!paths.length) throw new Error('Choose at least one virtual path for selected-path scope.');
      return { virtual_paths: paths, limit };
    }
    if (mode === 'incoming_x') return { incoming_x: true, limit };
    if (mode === 'selected_message') {
      const uid = String(state.virtualPathRuleContextEmailUid || activeMessageUid() || '').trim();
      if (!uid) throw new Error('Open a message before using selected-message scope.');
      return { message_uids: [uid], limit: 1 };
    }
    return { limit };
  }

  function rulesApplyScopeDefaultMode() {
    return state.virtualPathRuleContextEmailUid ? 'selected_message' : 'all';
  }

  function scopeModeOptionsHtml(defaultMode) {
    const selected = value => value === defaultMode ? ' selected' : '';
    return `
      <option value="all"${selected('all')}>All local emails</option>
      <option value="virtual_paths"${selected('virtual_paths')}>Selected virtual path(s)</option>
      <option value="incoming_x"${selected('incoming_x')}>Incoming-eligible messages</option>
      ${state.virtualPathRuleContextEmailUid ? `<option value="selected_message"${selected('selected_message')}>Selected message</option>` : ''}
      <option value="advanced"${selected('advanced')}>Advanced JSON scope</option>
    `;
  }

  function ruleContextBannerHtml() {
    const uid = String(state.virtualPathRuleContextEmailUid || '').trim();
    if (!uid) return '';
    const loading = state.virtualPathRuleContextLoading ? '<span>Checking current matches.</span>' : '';
    const error = state.virtualPathRuleContextError
      ? `<span class="email-rule-context-error">${escHtml(state.virtualPathRuleContextError)}</span>`
      : '';
    return `
      <div class="email-rule-context">
        <div>
          <strong>Message Rules</strong>
          <span>${escHtml(uid)}</span>
        </div>
        ${loading}
        ${error}
        <button class="hub-action-btn" type="button" data-email-vpath-rule-context-clear>Show All Rules</button>
      </div>
    `;
  }

  function virtualPathRulesListHtml() {
    const rules = filteredVirtualPathRules();
    if (!rules.length) {
      const text = state.virtualPathRuleContextEmailUid
        ? 'No current or historical virtual-path rules for this message.'
        : state.virtualPathRuleSearch
          ? 'No virtual-path rules match this search.'
          : 'No virtual-path rules loaded.';
      return `<div class="email-empty">${escHtml(text)}</div>`;
    }
    return `
      <div class="email-rules-list">
        ${rules.map(rule => virtualPathRuleRowHtml(rule)).join('')}
      </div>
    `;
  }

  function ruleOptionsHtml() {
    return `
      <option value="">All active rules</option>
      ${(state.virtualPathRules || []).map(rule => {
        const ruleId = String(rule?.rule_id || '').trim();
        if (!ruleId) return '';
        const label = String(rule?.display_name || ruleId);
        return `<option value="${escHtml(ruleId)}">${escHtml(label)}</option>`;
      }).join('')}
    `;
  }

  function rulesPathsToolHtml() {
    return `
      <section class="email-rule-card email-rule-tool-panel" data-email-rules-tool-panel="paths">
        <h3>Paths</h3>
        <form class="email-rule-form" data-email-vpath-create-form>
          ${virtualPathInputControlHtml({
            label: 'Parent path',
            name: 'parent_path',
            key: 'vpath-create-parent',
            placeholder: 'Root',
            allowRoot: true,
            mutable: true,
          })}
          <div class="email-vpath-picker-field">
            <span class="email-rule-field-label">Child path</span>
            <div class="email-rule-field-action-row email-vpath-picker-input-row">
              <input name="child_name" data-email-preserve-focus="vpath-create-child" placeholder="Project/Next" autocomplete="off" aria-label="Child path">
              <button class="hub-action-btn hub-primary" type="submit">Create path</button>
            </div>
          </div>
          <input name="path" type="hidden">
        </form>
      </section>
    `;
  }

  function rulesBulkToolHtml() {
    return `
      <section class="email-rule-card email-rule-tool-panel" data-email-rules-tool-panel="bulk">
        <h3>Bulk Move (messages)</h3>
        <form class="email-rule-form" data-email-vpath-bulk-form>
          ${virtualPathInputControlHtml({
            label: 'Source path',
            name: 'source',
            key: 'vpath-bulk-source',
            placeholder: 'Projects/Current',
            mutable: true,
          })}
          ${virtualPathInputControlHtml({
            label: 'Destination path',
            name: 'destination',
            key: 'vpath-bulk-destination',
            placeholder: 'Projects/Next',
            mutable: true,
          })}
          <div class="email-rule-action-row">
            <label class="hub-checkbox email-rule-apply-toggle">
              <input class="hub-checkbox__input" name="apply" data-email-vpath-apply-toggle="bulk" type="checkbox">
              <span class="hub-checkbox__box" aria-hidden="true"></span>
              <span class="hub-checkbox__label">Move messages now</span>
            </label>
            <button class="hub-action-btn hub-primary" type="submit" data-email-vpath-run-label data-preview-label="Preview bulk move" data-apply-label="Move messages">Preview bulk move</button>
          </div>
        </form>
      </section>
    `;
  }

  function rulesCreateToolHtml() {
    return `
      <section class="email-rule-card email-rule-tool-panel" data-email-rules-tool-panel="create">
        <h3>Create Rule</h3>
        <form class="email-rule-form email-rule-form--wide" data-email-rule-create-form>
          <div class="email-rule-create-primary-grid">
            <span class="email-rule-field-label email-rule-create-primary-grid__name-label">Rule name</span>
            <span class="email-rule-field-label email-rule-create-primary-grid__sequence-label">Sequence</span>
            <input class="email-rule-create-primary-grid__name-control" name="name" data-email-preserve-focus="vpath-rule-create-name" placeholder="Rule name" autocomplete="off" aria-label="Rule name">
            <input class="email-rule-create-primary-grid__sequence-control" name="sequence" data-email-preserve-focus="vpath-rule-create-sequence" type="number" min="0" step="1" placeholder="100" aria-label="Sequence">
            <label class="hub-checkbox email-rule-apply-toggle email-rule-edit-stop">
              <input class="hub-checkbox__input" name="stop_on_match" type="checkbox" data-email-preserve-focus="vpath-rule-create-stop">
              <span class="hub-checkbox__box" aria-hidden="true"></span>
              <span class="hub-checkbox__label">Stop on match</span>
            </label>
          </div>
          <label class="email-rule-edit-description">
            <span>Description</span>
            <textarea name="description" data-email-preserve-focus="vpath-rule-create-description" spellcheck="false"></textarea>
          </label>
          <label>
            <span>Predicate JSON</span>
            <textarea name="predicate" data-email-preserve-focus="vpath-rule-create-predicate" spellcheck="false">${escHtml(ruleJsonValue({ field: 'subject', op: 'contains', value: '' }))}</textarea>
          </label>
          <label>
            <span>Action JSON</span>
            <textarea name="action" data-email-preserve-focus="vpath-rule-create-action" spellcheck="false">${escHtml(ruleJsonValue({ operation: 'add', virtual_path: '' }))}</textarea>
          </label>
          <label>
            <span>Default scope JSON</span>
            <textarea name="scope" data-email-preserve-focus="vpath-rule-create-scope" spellcheck="false">${escHtml(ruleJsonValue({ limit: 100 }))}</textarea>
          </label>
          <button class="hub-action-btn hub-primary" type="submit">Create rule</button>
        </form>
      </section>
    `;
  }

  function rulesApplyToolHtml(defaultScopeMode) {
    return `
      <section class="email-rule-card email-rule-tool-panel" data-email-rules-tool-panel="apply">
        <h3>Preview/Apply Rules</h3>
        <form class="email-rule-form email-rule-form--wide" data-email-rule-apply-form>
          <label>
            <span>Rule</span>
            <select name="rule_id" data-email-preserve-focus="vpath-rule-apply-id">
              ${ruleOptionsHtml()}
            </select>
          </label>
          <div class="email-rule-scope-limit-grid">
            <span class="email-rule-field-label email-rule-scope-limit-grid__scope-label">Scope</span>
            <span class="email-rule-field-label email-rule-scope-limit-grid__limit-label">Limit</span>
            <select class="email-rule-scope-limit-grid__scope-control" name="scope_mode" data-email-preserve-focus="vpath-rule-apply-scope-mode" data-email-vpath-scope-mode aria-label="Scope">
              ${scopeModeOptionsHtml(defaultScopeMode)}
            </select>
            <input class="email-rule-scope-limit-grid__limit-control" name="limit" data-email-preserve-focus="vpath-rule-apply-limit" type="number" min="1" max="20000" value="${defaultScopeMode === 'selected_message' ? '1' : '100'}" aria-label="Limit">
          </div>
          <div data-email-vpath-scope-field="virtual_paths" hidden>
            ${virtualPathInputControlHtml({
              label: 'Virtual path(s)',
              name: 'scope_paths',
              key: 'vpath-rule-apply-paths',
              placeholder: 'Projects/Example',
              multi: true,
            })}
          </div>
          <label data-email-vpath-scope-field="selected_message"${defaultScopeMode === 'selected_message' ? '' : ' hidden'}>
            <span>Selected message</span>
            <input value="${escHtml(state.virtualPathRuleContextEmailUid || '')}" disabled>
          </label>
          <label data-email-vpath-scope-field="advanced" hidden>
            <span>Advanced scope JSON</span>
            <textarea name="scope_json" data-email-preserve-focus="vpath-rule-apply-scope-json" spellcheck="false">${escHtml(ruleJsonValue({ limit: 100 }))}</textarea>
          </label>
          <div class="email-rule-action-row">
            <label class="hub-checkbox email-rule-apply-toggle">
              <input class="hub-checkbox__input" name="apply" data-email-vpath-apply-toggle="rules" type="checkbox">
              <span class="hub-checkbox__box" aria-hidden="true"></span>
              <span class="hub-checkbox__label">Apply matched changes now</span>
            </label>
            <button class="hub-action-btn hub-primary" type="submit" data-email-vpath-run-label data-preview-label="Preview rule matches" data-apply-label="Apply matched changes"${state.virtualPathRuleApplyLoading ? ' disabled' : ''}>Preview rule matches</button>
          </div>
        </form>
      </section>
    `;
  }

  function rulesToolPanelHtml(defaultScopeMode) {
    const tool = normalizeRulesTool(state.virtualPathRuleTool);
    if (tool === 'paths') return rulesPathsToolHtml();
    if (tool === 'bulk') return rulesBulkToolHtml();
    if (tool === 'create') return rulesCreateToolHtml();
    if (tool === 'apply') return rulesApplyToolHtml(defaultScopeMode);
    return '';
  }

  function rulesPanelHtml() {
    const tool = normalizeRulesTool(state.virtualPathRuleTool);
    const listMode = tool === 'rules';
    const loading = state.virtualPathRulesLoading ? '<div class="email-empty">Loading virtual-path rules.</div>' : '';
    const error = state.virtualPathRulesError ? `<div class="email-error">${escHtml(state.virtualPathRulesError)}</div>` : '';
    const pathCount = Array.isArray(state.virtualPaths) ? state.virtualPaths.length : 0;
    const lastRun = state.virtualPathRuleLastRun?.run;
    const defaultScopeMode = rulesApplyScopeDefaultMode();
    const helpKind = tool === 'bulk' || tool === 'paths' ? tool : '';
    const toolbarTitle = listMode ? virtualPathRuleCountSummary() : `${pathCount} paths available`;
    const toolbarMeta = listMode ? `${pathCount} paths` : '';
    return `
      <section class="email-rules-panel">
        <div class="email-rules-toolbar${listMode ? '' : ' email-rules-toolbar--tool'}">
          <div class="email-rules-counts">
            <strong data-email-vpath-rule-count>${escHtml(toolbarTitle)}</strong>
            ${toolbarMeta ? `<span data-email-vpath-path-count>${escHtml(toolbarMeta)}</span>` : ''}
          </div>
          ${listMode ? `<input type="search" data-email-vpath-rule-search data-email-preserve-focus="vpath-rule-search" value="${escHtml(state.virtualPathRuleSearch || '')}" placeholder="Search rules" autocomplete="off">` : '<span class="email-rules-toolbar__spacer" aria-hidden="true"></span>'}
          <div class="email-rules-toolbar__actions">
            ${helpKind ? `<button class="email-vpath-help-trigger" type="button" data-email-vpath-help-open="${helpKind}" aria-label="Help with ${helpKind === 'bulk' ? 'Bulk Move messages' : 'Paths'}" title="How this tool works"><span aria-hidden="true">?</span></button>` : ''}
            <button class="hub-action-btn" type="button" data-email-action="refresh-vpath-rules">Refresh</button>
          </div>
        </div>
        ${ruleContextBannerHtml()}
        <div data-email-vpath-rule-status>${listMode ? loading : ''}${listMode ? error : ''}</div>
        <datalist id="email-vpath-options" data-email-vpath-options>${virtualPathOptionsHtml()}</datalist>
        ${listMode ? `<div class="email-rules-list-host" data-email-vpath-rules-list-host>
          ${virtualPathRulesListHtml()}
        </div>` : ''}
        ${lastRun ? `
          <div class="email-rule-last-run">
            <strong>Last run</strong>
            <span>${escHtml(lastRun.mode || '')}</span>
            <span>${escHtml(lastRun.run_id || '')}</span>
            <span>${escHtml(lastRun.status || '')}</span>
            <span>${escHtml(lastRun.changed_count ?? 0)} changed</span>
          </div>
        ` : ''}
        <div class="email-rules-operations">
          ${rulesToolPanelHtml(defaultScopeMode)}
        </div>
      </section>
    `;
  }

  function secondaryBodyHtml() {
    if (state.secondaryTab === 'checks') return capabilityRowsHtml();
    if (state.secondaryTab === 'security') return messageSecurityHtml();
    if (state.secondaryTab === 'cache') return cacheStatusHtml();
    if (state.secondaryTab === 'trusted') return trustedSendersHtml();
    if (state.secondaryTab === 'search') return emailSearchHtml();
    if (state.secondaryTab === 'rules') return rulesPanelHtml();
    return foldersHtml();
  }

  function renderSecondaryPanels() {
    const focusSnapshot = captureSearchFocus();
    readVirtualPathRuleDrafts();
    captureVirtualPathRuleSectionState();
    syncSecondaryModalMode();
    document.querySelectorAll('.email-secondary-tabs').forEach(host => {
      host.innerHTML = secondaryTabsHtml(host.closest('#ultrawide-sidecar') ? 'ultrawide' : 'secondary');
    });
    renderFolderControls();
    const bottom = el('email-secondary-bottom-body');
    if (bottom) bottom.innerHTML = secondaryBodyHtml();
    const modal = el('email-secondary-modal-body');
    if (modal) modal.innerHTML = secondaryBodyHtml();
    const modalTitle = el('email-secondary-modal-title');
    if (modalTitle) modalTitle.textContent = EMAIL_SECONDARY_TAB_TITLES.get(state.secondaryTab) || 'Email Folders';
    syncVirtualPathRuleControls();
    restoreSearchFocus(focusSnapshot);
  }

  function renderUltrawide() {
    if (typeof window.UltrawideSidecar === 'undefined') return;
    const active = document.getElementById('tab-email')?.classList.contains('active');
    const match = window.matchMedia ? window.matchMedia(ULTRAWIDE_QUERY).matches : false;
    if (!active || !match) return;
    const focusSnapshot = captureSearchFocus();
    readVirtualPathRuleDrafts();
    captureVirtualPathRuleSectionState();
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
    syncVirtualPathRuleControls(shell);
    restoreSearchFocus(focusSnapshot);
  }

  function scheduleUltrawideRender() {
    const run = () => renderUltrawide();
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(run);
    else window.setTimeout(run, 0);
    window.setTimeout(run, 250);
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
    scheduleEmailIntroHeightLock();
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

  function renderActivityHeartbeatChrome() {
    const heading = el('email-inbox-heading');
    if (!heading) return;
    const view = activityHeartbeatView();
    let existing = heading.querySelector('.email-activity-heartbeat');
    if (!existing) {
      heading.insertAdjacentHTML('beforeend', activityHeartbeatHtml());
      existing = heading.querySelector('.email-activity-heartbeat');
    }
    if (!existing) return;
    if (existing.className !== view.className) existing.className = view.className;
    if (existing.getAttribute('aria-label') !== view.label) existing.setAttribute('aria-label', view.label);
    if (existing.getAttribute('title') !== view.label) existing.setAttribute('title', view.label);
    const heart = String.fromCharCode(9829);
    if (existing.textContent !== heart) existing.textContent = heart;
  }

  async function refreshActivityHeartbeat(options = {}) {
    if (state.activityHeartbeatLoading) {
      if (state.loaded && !options.deferRender) renderActivityHeartbeatChrome();
      return state.activityHeartbeat;
    }
    state.activityHeartbeatLoading = true;
    try {
      const data = await fetchJson(activityEndpoint(), {
        headers: { 'X-PIM-Email-Client-Priority': 'background' },
      });
      state.activityHeartbeat = data.activity || null;
      state.activityHeartbeatError = '';
      state.activityHeartbeatLastRefreshed = Date.now();
      if (state.loaded && !options.deferRender) renderActivityHeartbeatChrome();
      return state.activityHeartbeat;
    } catch (error) {
      state.activityHeartbeatError = error.message || String(error);
      if (state.loaded && !options.deferRender) renderActivityHeartbeatChrome();
      return state.activityHeartbeat;
    } finally {
      state.activityHeartbeatLoading = false;
    }
  }

  function ensureActivityHeartbeat() {
    renderActivityHeartbeatChrome();
    refreshActivityHeartbeat({ silent: true });
    if (state.activityHeartbeatTimer) return;
    state.activityHeartbeatTimer = window.setInterval(() => {
      if (!state.loaded || document.hidden) return;
      refreshActivityHeartbeat({ silent: true });
    }, ACTIVITY_HEARTBEAT_REFRESH_MS);
  }

  function ensureHealthPoll() {
    ensureActivityHeartbeat();
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
      const tone = healthStatusTone();
      if (!options.silent || (tone !== 'red' && staleHealthErrorVisible())) {
        setStatus(
          staleHealthErrorVisible() ? 'Email health restored' : 'Email health refreshed',
          tone === 'red' ? 'err' : (tone === 'amber' ? 'warn' : 'ok')
        );
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
      return null;
    }
  }

  async function load(options = {}) {
    if (state.loading) return state.status;
    if (state.loaded && !options.force) {
      ensureActivityHeartbeat();
      renderUltrawide();
      scheduleUltrawideRender();
      return state.status;
    }
    const selectedFolder = options.folder || (state.loaded ? state.folder : 'INBOX') || 'INBOX';
    const preserveList = Boolean(state.loaded && options.force);
    const preserveOpenedMessage = options.preserveOpenedMessage !== false;
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
      state.message = preserveList && preserveOpenedMessage && previousUid && state.messages.some(row => messageIdentity(row) === previousUid)
        ? previousMessage
        : null;
      state.loaded = true;
      setStatus('Email middleware ready', 'ok');
      renderAll({ messageListAnchor: listAnchor });
      scheduleUltrawideRender();
      scheduleMessagePagePrefetch();
      refreshCacheStatus({ silent: true });
      ensureHealthPoll();
      healthPromise.then(() => {
        if (!state.loaded) return;
        refreshActivityHeartbeat({ silent: true });
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
    const uid = activeMessageUid();
    if (uid) invalidateOpenedMessageCache(uid);
    const result = await load({ force: true, preserveOpenedMessage: false });
    if (uid && state.messages.some(row => messageIdentity(row) === uid)) {
      await openMessage(uid);
    }
    return result;
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

  async function recordMessageOpenClick(uid, row = null, source = 'email-ui') {
    const emailUid = String(row?.email_uid || uid || '').trim();
    if (!emailUid) return null;
    return fetchJson(messageOpenedEndpoint(emailUid, row), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actor: 'email-ui',
        source_surface: source,
        metadata: {
          cached: source === 'browser-cache',
          selected_folder: state.folder || '',
        },
      }),
    });
  }

  function recordMessageOpenClickFireAndForget(uid, row = null, source = 'email-ui') {
    const emailUid = String(row?.email_uid || uid || '').trim();
    if (!emailUid) return false;
    const run = () => {
      const telemetryStartedAt = performance.now();
      state.messageOpenTelemetryInFlight += 1;
      notifyCacheStateChanged();
      recordMessageOpenClick(emailUid, row, source)
        .then(() => {
          recordMessageOpenTelemetry({
            uid: emailUid,
            source,
            status: 'ok',
            telemetry_ms: performance.now() - telemetryStartedAt,
          });
        })
        .catch(error => {
          recordMessageOpenTelemetry({
            uid: emailUid,
            source,
            status: 'failed',
            telemetry_ms: performance.now() - telemetryStartedAt,
            error: error.message || String(error),
          });
        })
        .finally(() => {
          state.messageOpenTelemetryInFlight = Math.max(0, state.messageOpenTelemetryInFlight - 1);
          notifyCacheStateChanged();
        });
    };
    window.setTimeout(run, 0);
    return true;
  }

  async function openMessage(uid) {
    const cleanUid = String(uid || '').trim();
    if (!cleanUid) return false;
    const openSeq = state.messageOpenSeq + 1;
    state.messageOpenSeq = openSeq;
    const startedAt = performance.now();
    const row = state.messages.find(item => (
      String(item.email_uid || '') === cleanUid || String(item.uid || '') === cleanUid
    )) || null;
    const emailUid = String(row?.email_uid || cleanUid).trim();
    if (!emailUid) return false;
    setStatus('Opening local message', 'unknown');
    state.messageOpenCacheHit = false;
    const cached = cachedOpenedMessage(emailUid, row, { opened: true });
    if (cached) {
      try {
        if (openSeq !== state.messageOpenSeq) return false;
        state.messageOpenCacheHit = true;
        state.message = cached;
        state.messagePendingUid = '';
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
          source: 'browser-cache',
          body_ms: performance.now() - startedAt,
          network_ms: 0,
          telemetry_status: 'queued',
        });
        recordMessageOpenClickFireAndForget(emailUid, row, 'browser-cache');
        window.setTimeout(() => pauseMessageOpenPrefetch(1500), 0);
        return true;
      } catch (error) {
        if (openSeq === state.messageOpenSeq) state.messagePendingUid = '';
        setStatus(error.message || String(error), 'err');
        return false;
      }
    }
    state.messagePendingUid = emailUid;
    syncSelectedMessageRows();
    renderMessageLoading(row, emailUid);
    pauseMessageOpenPrefetch(3500);
    const prefetched = state.messageOpenPrefetchPromises.get(emailUid) || null;
    if (prefetched) {
      try {
        const networkStartedAt = performance.now();
        const data = await prefetched;
        const networkMs = performance.now() - networkStartedAt;
        if (openSeq !== state.messageOpenSeq) return false;
        state.message = data?.message || null;
        if (state.message) {
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
            source: 'browser-prefetch',
            body_ms: performance.now() - startedAt,
            network_ms: networkMs,
          });
          recordMessageOpenClickFireAndForget(emailUid, row, 'browser-prefetch');
          return true;
        }
      } catch (error) {
        if (error?.name !== 'AbortError') {
          state.messageOpenPrefetchLastError = error.message || String(error);
        }
      }
    }
    try {
      const networkStartedAt = performance.now();
      const data = await fetchJson(messageEndpoint(emailUid, row, { opened: true }), {
        headers: { 'X-PIM-Email-Client-Priority': 'foreground' },
        priority: 'high',
      });
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

  function ensureVirtualPathEditorDialog() {
    let dialog = el('email-vpath-editor-modal');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'email-vpath-editor-modal';
    dialog.className = 'hub-modal email-vpath-editor-modal';
    dialog.innerHTML = `
      <form method="dialog" class="hub-modal__panel email-vpath-editor">
        <header class="hub-modal__header">
          <h2>Virtual Paths</h2>
          <button type="button" class="hub-modal__close" data-email-vpath-editor-close aria-label="Close">&times;</button>
        </header>
        <div class="hub-modal__body" data-email-vpath-editor-body></div>
        <footer class="hub-modal__footer">
          <button type="button" data-email-vpath-editor-close>Close</button>
          <button type="submit" data-email-vpath-editor-save>Save</button>
        </footer>
      </form>
    `;
    dialog.addEventListener('click', event => {
      if (event.target === dialog || event.target.closest?.('[data-email-vpath-editor-close]')) {
        event.preventDefault();
        closeVirtualPathEditor();
      }
    });
    dialog.addEventListener('submit', event => {
      const form = event.target.closest?.('.email-vpath-editor');
      if (!form) return;
      event.preventDefault();
      saveVirtualPathEditor(form);
    });
    document.body.appendChild(dialog);
    return dialog;
  }

  function renderVirtualPathEditorDialog() {
    const dialog = ensureVirtualPathEditorDialog();
    const body = dialog.querySelector('[data-email-vpath-editor-body]');
    const pathsText = (state.virtualPathEditorPaths || []).join('\n');
    const options = virtualPathOptionsHtml({ assignableOnly: true });
    if (body) {
      body.innerHTML = `
        ${state.virtualPathEditorError ? `<div class="email-error">${escHtml(state.virtualPathEditorError)}</div>` : ''}
        <datalist id="email-vpath-editor-options">${options}</datalist>
        <label class="email-vpath-editor__field">
          <span>${escHtml(state.virtualPathEditorEmailUid || '')}</span>
          <textarea name="virtual_paths" spellcheck="false" list="email-vpath-editor-options">${escHtml(pathsText)}</textarea>
        </label>
      `;
    }
  }

  function closeVirtualPathEditor() {
    const dialog = el('email-vpath-editor-modal');
    state.virtualPathEditorOpen = false;
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }

  async function openVirtualPathEditor(emailUid = '') {
    closeMessageContextMenu();
    const uid = String(emailUid || activeMessageUid() || '').trim();
    if (!uid) {
      setStatus('Open a message before editing virtual paths', 'warn');
      return false;
    }
    state.virtualPathEditorOpen = true;
    state.virtualPathEditorEmailUid = uid;
    state.virtualPathEditorError = '';
    state.virtualPathEditorPaths = [];
    renderVirtualPathEditorDialog();
    const dialog = ensureVirtualPathEditorDialog();
    if (typeof HubModal !== 'undefined') HubModal.open(dialog);
    else if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    try {
      const [history] = await Promise.all([
        fetchJson(messageActionsEndpoint(uid)),
        refreshVirtualPathRules({ silent: true }),
      ]);
      const paths = history.history?.state?.current_virtual_paths;
      state.virtualPathEditorPaths = Array.isArray(paths) ? paths.map(String) : [];
      renderVirtualPathEditorDialog();
      return true;
    } catch (error) {
      state.virtualPathEditorError = error.message || String(error);
      renderVirtualPathEditorDialog();
      return false;
    }
  }

  async function saveVirtualPathEditor(form) {
    const uid = state.virtualPathEditorEmailUid;
    if (!uid) return false;
    const paths = String(form?.querySelector?.('[name="virtual_paths"]')?.value || '')
      .split(/\r?\n/)
      .map(item => item.trim())
      .filter(Boolean);
    const protectedPath = paths.find(path => !isMutableVirtualPath(path));
    if (protectedPath) {
      state.virtualPathEditorError = `${protectedPath} is not an assignable mutable virtual path.`;
      renderVirtualPathEditorDialog();
      return false;
    }
    setStatus('Saving virtual paths', 'unknown');
    try {
      await fetchJson(messageVirtualPathsReplaceEndpoint(uid), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          virtual_paths: paths,
          actor: 'email-ui',
          source_surface: 'pim-email-ui',
        }),
      });
      closeVirtualPathEditor();
      await refreshVirtualPathRules({ silent: true });
      await load({ force: true, preserveOpenedMessage: true });
      setStatus('Virtual paths saved', 'ok');
      return true;
    } catch (error) {
      state.virtualPathEditorError = error.message || String(error);
      renderVirtualPathEditorDialog();
      setStatus(error.message || String(error), 'err');
      return false;
    }
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

  function setSearchMode(mode) {
    const clean = mode === 'advanced' ? 'advanced' : 'simple';
    const forms = Array.from(document.querySelectorAll('[data-email-search-form]'));
    const activeForm = document.activeElement?.closest?.('[data-email-search-form]')
      || forms.find(form => !form.closest('[hidden]') && form.getClientRects?.().length)
      || forms[0];
    if (activeForm) readSearchForm(activeForm);
    state.searchMode = clean;
    state.secondaryTab = 'search';
    closeSearchModeMenus();
    closeRulesToolMenus();
    renderSecondaryPanels();
    renderUltrawide();
    return true;
  }

  function setTrustedNestedTab(tabId) {
    const clean = TRUSTED_VIEW_OPTIONS.some(([id]) => id === tabId) ? tabId : 'probable';
    state.trustedNestedTab = clean;
    state.secondaryTab = 'trusted';
    closeTrustedViewMenus();
    closeRulesToolMenus();
    renderSecondaryPanels();
    renderUltrawide();
    if (!state.trustedLoaded) refreshTrustedSenders({ silent: true });
    return true;
  }

  function setRulesTool(tool) {
    readVirtualPathRuleDrafts();
    state.virtualPathRuleTool = normalizeRulesTool(tool);
    state.secondaryTab = 'rules';
    closeRulesToolMenus();
    renderSecondaryPanels();
    renderUltrawide();
    if (!state.virtualPathRulesLoaded) refreshVirtualPathRules({ silent: true });
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

  function refreshSecondaryTabData(tabId) {
    const clean = normalizeSecondaryTab(tabId);
    if (clean === 'cache') refreshCacheStatus({ silent: true });
    if (clean === 'trusted' && !state.trustedLoaded) refreshTrustedSenders({ silent: true });
    if (clean === 'rules' && !state.virtualPathRulesLoaded) refreshVirtualPathRules({ silent: true });
  }

  function activateSecondaryTab(tabId) {
    state.secondaryTab = normalizeSecondaryTab(tabId);
    renderSecondaryPanels();
    renderUltrawide();
    refreshSecondaryTabData(state.secondaryTab);
    return true;
  }

  function openSecondaryModalElement() {
    const modal = el('email-secondary-modal');
    if (modal) {
      if (typeof HubModal !== 'undefined') HubModal.open(modal);
      else if (typeof modal.showModal === 'function' && !modal.open) modal.showModal();
      return true;
    }
    return false;
  }

  function focusSecondaryModalTab(tabId) {
    const clean = normalizeSecondaryTab(tabId);
    window.requestAnimationFrame(() => {
      const modal = el('email-secondary-modal');
      if (!modal || !modal.open) return;
      let target = null;
      if (clean !== 'folders') {
        target = Array.from(modal.querySelectorAll('[data-email-secondary-tab]'))
          .find(node => node.dataset.emailSecondaryTab === clean) || null;
      }
      if (!target && clean === 'folders') {
        target = modal.querySelector('[data-email-folder-menu-toggle], [data-email-folder-name]');
      }
      if (!target) {
        target = modal.querySelector('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
      }
      target?.focus?.({ preventScroll: true });
    });
  }

  async function prepareSecurityChecks() {
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
  }

  async function openSecondaryModalTab(tabId = 'folders') {
    const clean = normalizeSecondaryTab(tabId);
    if (!state.loaded) await load();
    if (clean === 'checks') await refreshHealth();
    if (clean === 'security') await prepareSecurityChecks();
    if (clean === 'rules' && !state.virtualPathRulesLoaded) await refreshVirtualPathRules({ silent: true });
    activateSecondaryTab(clean);
    openSecondaryModalElement();
    focusSecondaryModalTab(clean);
    return true;
  }

  async function browseFolders() {
    return openSecondaryModalTab('folders');
  }

  async function safeChecks() {
    return openSecondaryModalTab('checks');
  }

  async function searchPanel() {
    return openSecondaryModalTab('search');
  }

  async function securityChecks() {
    return openSecondaryModalTab('security');
  }

  async function cachePanel() {
    return openSecondaryModalTab('cache');
  }

  async function trustedPanel() {
    return openSecondaryModalTab('trusted');
  }

  async function rulesPanel() {
    clearVirtualPathRuleMessageContext();
    state.virtualPathRuleSearch = '';
    return openSecondaryModalTab('rules');
  }

  async function openSecondaryPanel(tabId = 'folders') {
    return openSecondaryModalTab(tabId);
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

  async function refreshLocalMessageView() {
    closeMessageContextMenu();
    const uid = activeMessageUid();
    if (!uid) {
      setStatus('Open a message before refreshing the local view', 'warn');
      return false;
    }
    setStatus('Refreshing local-safe message view', 'unknown');
    try {
      invalidateOpenedMessageCache(uid);
      clearBrowserImageStorageCache(uid);
      const data = await fetchJson(localViewRefreshEndpoint(uid), { method: 'POST' });
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
      setStatus('Local-safe view refreshed', 'ok');
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
    if (String(action || '').startsWith('secondary-')) {
      const tab = String(action || '').slice('secondary-'.length);
      if (tab === 'rules') {
        clearVirtualPathRuleMessageContext();
        state.virtualPathRuleSearch = '';
      }
      return openSecondaryModalTab(tab);
    }
    if (action === 'refresh') return refresh();
    if (action === 'browse-folders') return browseFolders();
    if (action === 'view-plain') return setView('plain');
    if (action === 'view-html') return setView('html');
    if (action === 'view-markdown') return setView('markdown');
    if (action === 'view-raw') return setView('raw');
    if (action === 'toggle-list') return toggleList();
    if (action === 'safe-checks') return safeChecks();
    if (action === 'security-checks') return securityChecks();
    if (action === 'refresh-local-message-view') return refreshLocalMessageView();
    if (action === 'force-refresh-message') return forceRefreshMessage();
    if (action === 'mark-sender-probable-trusted') return markSenderProbableTrusted();
    if (action === 'open-message-audit-ledger') return openContextAuditLedger();
    if (action === 'edit-message-virtual-paths') return openVirtualPathEditor();
    if (action === 'open-virtual-path-rules') {
      const uid = state.messageContextUids?.[0] || activeMessageUid() || '';
      return openVirtualPathRulesForMessage(uid);
    }
    if (action === 'refresh-vpath-rules') return refreshVirtualPathRules();
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
      window.BlueprintsEventStream.on(CACHE_STATE_EVENT, handleCacheStateEvent);
      window.BlueprintsEventStream.resumeSoon?.('email SSE listeners');
    } else {
      document.addEventListener('blueprints:event', event => {
        if (event.detail?.event_type === SECURITY_PROGRESS_EVENT) handleSecurityProgressEvent(event.detail);
        if (event.detail?.event_type === CACHE_STATE_EVENT) handleCacheStateEvent(event.detail);
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
      const searchModeToggle = target.closest?.('[data-email-search-mode-menu-toggle]');
      if (searchModeToggle) {
        event.preventDefault();
        toggleSearchModeMenu(searchModeToggle);
        return;
      }
      const searchModeOption = target.closest?.('[data-email-search-mode-option]');
      if (searchModeOption) {
        event.preventDefault();
        setSearchMode(searchModeOption.dataset.emailSearchModeOption || 'simple');
        return;
      }
      const trustedViewToggle = target.closest?.('[data-email-trusted-view-menu-toggle]');
      if (trustedViewToggle) {
        event.preventDefault();
        toggleTrustedViewMenu(trustedViewToggle);
        return;
      }
      const trustedViewOption = target.closest?.('[data-email-trusted-view-option]');
      if (trustedViewOption) {
        event.preventDefault();
        setTrustedNestedTab(trustedViewOption.dataset.emailTrustedViewOption || 'probable');
        return;
      }
      const rulesToolToggle = target.closest?.('[data-email-rules-tool-menu-toggle]');
      if (rulesToolToggle) {
        event.preventDefault();
        toggleRulesToolMenu(rulesToolToggle);
        return;
      }
      const rulesToolOption = target.closest?.('[data-email-rules-tool-option]');
      if (rulesToolOption) {
        event.preventDefault();
        setRulesTool(rulesToolOption.dataset.emailRulesToolOption || 'rules');
        return;
      }
      const tabBtn = target.closest?.('[data-email-secondary-tab]');
      if (tabBtn) {
        event.preventDefault();
        activateSecondaryTab(tabBtn.dataset.emailSecondaryTab || 'folders');
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
      const trustedRemove = target.closest?.('[data-email-trusted-remove]');
      if (trustedRemove) {
        event.preventDefault();
        removeTrustedSender(trustedRemove.dataset.emailTrustedRemove || '');
        return;
      }
      const ruleToggle = target.closest?.('[data-email-vpath-rule-toggle]');
      if (ruleToggle) {
        event.preventDefault();
        toggleVirtualPathRuleExpanded(ruleToggle.dataset.emailVpathRuleToggle || '');
        return;
      }
      const ruleRow = target.closest?.('[data-email-vpath-rule-row]');
      if (ruleRow && !target.closest?.('button, a, input, textarea, select, label, summary, form, [contenteditable="true"]')) {
        event.preventDefault();
        toggleVirtualPathRuleExpanded(ruleRow.dataset.emailVpathRuleRow || '');
        return;
      }
      const ruleSectionSummary = target.closest?.('[data-email-vpath-rule-section] > summary');
      if (ruleSectionSummary) {
        const details = ruleSectionSummary.closest('[data-email-vpath-rule-section]');
        event.preventDefault();
        toggleVirtualPathRuleSection(details?.dataset?.emailVpathRuleSection || '');
        return;
      }
      const ruleContextClear = target.closest?.('[data-email-vpath-rule-context-clear]');
      if (ruleContextClear) {
        event.preventDefault();
        clearVirtualPathRuleMessageContext();
        renderSecondaryPanels();
        renderUltrawide();
        return;
      }
      const ruleApplyOne = target.closest?.('[data-email-rule-apply-one]');
      if (ruleApplyOne) {
        event.preventDefault();
        previewSingleVirtualPathRule(ruleApplyOne.dataset.emailRuleApplyOne || '');
        return;
      }
      const ruleArchive = target.closest?.('[data-email-vpath-rule-archive]');
      if (ruleArchive) {
        event.preventDefault();
        archiveVirtualPathRule(ruleArchive.dataset.emailVpathRuleArchive || '');
        return;
      }
      const virtualPathHelpOpen = target.closest?.('[data-email-vpath-help-open]');
      if (virtualPathHelpOpen) {
        event.preventDefault();
        openVirtualPathHelp(virtualPathHelpOpen.dataset.emailVpathHelpOpen || 'paths');
        return;
      }
      const virtualPathHelpClose = target.closest?.('[data-email-vpath-help-close]');
      if (virtualPathHelpClose) {
        event.preventDefault();
        closeVirtualPathHelp();
        return;
      }
      const pathPickerOpen = target.closest?.('[data-email-vpath-picker-open]');
      if (pathPickerOpen) {
        event.preventDefault();
        openVirtualPathTreePicker(pathPickerOpen.dataset.emailVpathPickerTarget || '');
        return;
      }
      const pathTreeClose = target.closest?.('[data-email-vpath-tree-close]');
      if (pathTreeClose) {
        event.preventDefault();
        closeVirtualPathTreePicker();
        return;
      }
      const pathTreeActions = target.closest?.('[data-email-vpath-tree-actions]');
      if (pathTreeActions) {
        event.preventDefault();
        const path = normalizeVirtualPath(pathTreeActions.dataset.emailVpathTreeActions || '');
        state.virtualPathPicker.actionPath = state.virtualPathPicker.actionPath === path ? null : path;
        state.virtualPathPicker.selectedPath = path;
        state.virtualPathPicker.error = '';
        renderVirtualPathTreePicker();
        return;
      }
      const pathTreeCreateChild = target.closest?.('[data-email-vpath-tree-create-child]');
      if (pathTreeCreateChild) {
        event.preventDefault();
        const panel = pathTreeCreateChild.closest('.email-vpath-tree-actions-panel');
        const childName = panel?.querySelector?.('[data-email-vpath-tree-child-name]')?.value || '';
        createVirtualPathFromPicker(pathTreeCreateChild.dataset.emailVpathTreeCreateChild || '', childName);
        return;
      }
      const pathTreeArchive = target.closest?.('[data-email-vpath-tree-archive]');
      if (pathTreeArchive) {
        event.preventDefault();
        archiveVirtualPathFromPicker(pathTreeArchive.dataset.emailVpathTreeArchive || '', 'archive');
        return;
      }
      const pathTreeDelete = target.closest?.('[data-email-vpath-tree-delete]');
      if (pathTreeDelete) {
        event.preventDefault();
        archiveVirtualPathFromPicker(pathTreeDelete.dataset.emailVpathTreeDelete || '', 'delete');
        return;
      }
      const pathTreeMove = target.closest?.('[data-email-vpath-tree-move]');
      if (pathTreeMove) {
        event.preventDefault();
        openVirtualPathMoveDestination(pathTreeMove.dataset.emailVpathTreeMove || '');
        return;
      }
      const pathTreeCopy = target.closest?.('[data-email-vpath-tree-copy]');
      if (pathTreeCopy) {
        event.preventDefault();
        openVirtualPathMoveDestination(pathTreeCopy.dataset.emailVpathTreeCopy || '', 'copy');
        return;
      }
      const pathTreeSelect = target.closest?.('[data-email-vpath-tree-select]');
      if (pathTreeSelect) {
        event.preventDefault();
        applyVirtualPathPickerSelection(pathTreeSelect.dataset.emailVpathTreeSelect || '');
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
      if (!target.closest?.('[data-email-search-mode-dropdown]')) closeSearchModeMenus();
      if (!target.closest?.('[data-email-trusted-view-dropdown]')) closeTrustedViewMenus();
      if (!target.closest?.('[data-email-rules-tool-dropdown]')) closeRulesToolMenus();
    });
    document.addEventListener('change', event => {
      const searchForm = event.target.closest?.('[data-email-search-form]');
      if (searchForm) {
        readSearchForm(searchForm);
        return;
      }
      const vpathApplyToggle = event.target.closest?.('[data-email-vpath-apply-toggle]');
      if (vpathApplyToggle) {
        syncVirtualPathRunButton(vpathApplyToggle.closest('form'));
        return;
      }
      const vpathScopeMode = event.target.closest?.('[data-email-vpath-scope-mode]');
      if (vpathScopeMode) {
        syncVirtualPathScopeControls(vpathScopeMode.closest('form'));
        return;
      }
      const ruleEditForm = event.target.closest?.('[data-email-rule-edit-form]');
      if (ruleEditForm) {
        readVirtualPathRuleDrafts(ruleEditForm);
        return;
      }
      const ruleActiveToggle = event.target.closest?.('[data-email-vpath-rule-active-toggle]');
      if (ruleActiveToggle) {
        toggleVirtualPathRuleActive(ruleActiveToggle.dataset.emailVpathRuleActiveToggle || '', ruleActiveToggle.checked);
        return;
      }
      const messageSelect = event.target.closest?.('[data-email-message-select]');
      if (!messageSelect) return;
      toggleMessageSelection(messageSelect.dataset.emailMessageSelect || '', messageSelect.checked);
    });
    document.addEventListener('input', event => {
      const pathTreeSearch = event.target.closest?.('[data-email-vpath-tree-search]');
      if (pathTreeSearch) {
        state.virtualPathPicker.searchQuery = String(pathTreeSearch.value || '');
        renderVirtualPathTreePicker();
        const restored = document.querySelector('[data-email-vpath-tree-search]');
        restored?.focus?.({ preventScroll: true });
        restored?.setSelectionRange?.(restored.value.length, restored.value.length);
        return;
      }
      const ruleSearch = event.target.closest?.('[data-email-vpath-rule-search]');
      if (ruleSearch) {
        state.virtualPathRuleSearch = String(ruleSearch.value || '');
        renderVirtualPathRuleListHosts();
        return;
      }
      const ruleEditForm = event.target.closest?.('[data-email-rule-edit-form]');
      if (ruleEditForm) {
        readVirtualPathRuleDrafts(ruleEditForm);
        return;
      }
      const searchForm = event.target.closest?.('[data-email-search-form]');
      if (searchForm) {
        readSearchForm(searchForm);
      }
    });
    document.addEventListener('submit', event => {
      const searchForm = event.target.closest?.('[data-email-search-form]');
      if (searchForm) {
        event.preventDefault();
        runEmailSearch({ form: searchForm });
        return;
      }
      const ruleEditForm = event.target.closest?.('[data-email-rule-edit-form]');
      if (ruleEditForm) {
        event.preventDefault();
        saveVirtualPathRuleFromForm(ruleEditForm);
        return;
      }
      const vpathCreateForm = event.target.closest?.('[data-email-vpath-create-form]');
      if (vpathCreateForm) {
        event.preventDefault();
        createVirtualPathFromForm(vpathCreateForm);
        return;
      }
      const vpathBulkForm = event.target.closest?.('[data-email-vpath-bulk-form]');
      if (vpathBulkForm) {
        event.preventDefault();
        bulkMoveVirtualPathFromForm(vpathBulkForm);
        return;
      }
      const ruleCreateForm = event.target.closest?.('[data-email-rule-create-form]');
      if (ruleCreateForm) {
        event.preventDefault();
        createVirtualPathRuleFromForm(ruleCreateForm);
        return;
      }
      const ruleApplyForm = event.target.closest?.('[data-email-rule-apply-form]');
      if (ruleApplyForm) {
        event.preventDefault();
        applyVirtualPathRulesFromForm(ruleApplyForm);
        return;
      }
      const form = event.target.closest?.('[data-email-trusted-add-form]');
      if (!form) return;
      event.preventDefault();
      addTrustedSenderFromForm(form);
    });
    document.addEventListener('pointerdown', event => {
      const node = event.target.closest?.('[data-email-vpath-tree-node]');
      if (!node) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      startVirtualPathTreeLongPress(node.dataset.emailVpathTreeNode || '');
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(eventName => {
      document.addEventListener(eventName, event => {
        if (!state.virtualPathPickerLongPressTimer) return;
        if (eventName === 'pointerleave' && event.target.closest?.('[data-email-vpath-tree-node]')) return;
        clearVirtualPathTreeLongPress();
      });
    });
    document.addEventListener('dragstart', event => {
      const node = event.target.closest?.('[data-email-vpath-tree-node]');
      if (!node) return;
      const path = normalizeVirtualPath(node.dataset.emailVpathTreeNode || '');
      if (!virtualPathAllows(path, 'can_move_subtree')) {
        event.preventDefault();
        return;
      }
      state.virtualPathPickerDragPath = path;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', path);
    });
    document.addEventListener('dragover', event => {
      const targetNode = event.target.closest?.('[data-email-vpath-tree-drop-target]');
      if (!targetNode || !state.virtualPathPickerDragPath) return;
      const parentPath = normalizeVirtualPath(targetNode.dataset.emailVpathTreeDropTarget || '');
      const canDrop = canDropVirtualPath(state.virtualPathPickerDragPath, parentPath);
      targetNode.classList.toggle('is-drop-target', canDrop);
      if (!canDrop) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    });
    document.addEventListener('dragleave', event => {
      const targetNode = event.target.closest?.('[data-email-vpath-tree-drop-target]');
      targetNode?.classList?.remove('is-drop-target');
    });
    document.addEventListener('drop', event => {
      const targetNode = event.target.closest?.('[data-email-vpath-tree-drop-target]');
      if (!targetNode || !state.virtualPathPickerDragPath) return;
      event.preventDefault();
      const parentPath = normalizeVirtualPath(targetNode.dataset.emailVpathTreeDropTarget || '');
      document.querySelectorAll('.email-vpath-tree-node.is-drop-target').forEach(node => node.classList.remove('is-drop-target'));
      moveVirtualPathIntoParent(state.virtualPathPickerDragPath, parentPath);
      state.virtualPathPickerDragPath = '';
    });
    document.addEventListener('dragend', () => {
      state.virtualPathPickerDragPath = '';
      document.querySelectorAll('.email-vpath-tree-node.is-drop-target').forEach(node => node.classList.remove('is-drop-target'));
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
    ['email-audit-ledger-modal-close', 'email-audit-ledger-modal-footer-close'].forEach(id => {
      const btn = el(id);
      if (btn) btn.addEventListener('click', closeAuditLedgerModal);
    });
    const securitySegmentModal = el('email-security-segment-modal');
    if (securitySegmentModal) {
      securitySegmentModal.addEventListener('close', () => {
        state.securitySegmentModalOpen = false;
      });
    }
    const auditLedgerModal = el('email-audit-ledger-modal');
    if (auditLedgerModal) {
      auditLedgerModal.addEventListener('close', () => {
        state.auditLedgerModalOpen = false;
      });
    }
    window.addEventListener('resize', renderUltrawide);
    window.addEventListener('orientationchange', renderUltrawide);
    window.addEventListener('load', scheduleUltrawideRender);
    document.addEventListener('blueprints:page-state-changed', event => {
      if (event.detail?.page?.tab === 'email') scheduleUltrawideRender();
    });
  }

  function snapshot() {
    const activeUid = activeMessageUid();
    const imageCache = activeUid ? state.messageImageCache.get(activeUid) : null;
    const selectedCacheVisual = activeUid ? messageCacheVisualState(activeUid) : null;
    const selectedFolder = selectedFolderRecord();
    const selectedCapabilities = selectedFolderCapabilities();
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
      selected_folder_meta: folderMetadata(selectedFolder),
      selected_folder_capabilities: selectedCapabilities,
      folder_assignment_disabled: !selectedCapabilities.move_controls_enabled,
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
      message_open_telemetry_in_flight: state.messageOpenTelemetryInFlight,
      message_open_telemetry_completed: state.messageOpenTelemetryCompleted,
      message_open_telemetry_failed: state.messageOpenTelemetryFailed,
      message_open_telemetry_last_error: state.messageOpenTelemetryLastError,
      last_message_open_telemetry: state.lastMessageOpenTelemetry,
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
      message_cache_strip_counts: messageCacheVisualCounts(),
      selected_cache_visual: selectedCacheVisual,
      message_cache_state_count: state.messageServerCacheStates.size,
      message_cache_state_loading: state.messageCacheStateLoading,
      message_cache_state_error: state.messageCacheStateError,
      message_cache_state_last_refreshed: state.messageCacheStateLastRefreshed,
      cache_state_sse_count: state.cacheStateSseCount,
      cache_state_sse_last_at: state.cacheStateSseLastAt,
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
      audit_ledger_modal_open: state.auditLedgerModalOpen,
      audit_ledger_email_uid: state.auditLedgerEmailUid,
      audit_ledger_loading: state.auditLedgerLoading,
      audit_ledger_error: state.auditLedgerError,
      audit_ledger_event_count: Array.isArray(state.auditLedgerHistory?.events) ? state.auditLedgerHistory.events.length : 0,
      audit_ledger_current_virtual_paths: Array.isArray(state.auditLedgerHistory?.state?.current_virtual_paths)
        ? state.auditLedgerHistory.state.current_virtual_paths
        : [],
      audit_ledger_last_opened_at: state.auditLedgerHistory?.state?.last_opened_at || '',
      view: state.view,
      secondary_tab: state.secondaryTab,
      list_collapsed: state.listCollapsed,
      activity_heartbeat_active: activityHeartbeatActive(),
      activity_heartbeat: state.activityHeartbeat,
      activity_heartbeat_last_refreshed: state.activityHeartbeatLastRefreshed,
      email_intro_min_height: state.emailIntroMinHeight,
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
    cachePanel,
    trustedPanel,
    rulesPanel,
    openSecondaryPanel,
    setView,
    toggleList,
    viewPlain: () => setView('plain'),
    viewHtml: () => setView('html'),
    viewMarkdown: () => setView('markdown'),
    viewRaw: () => setView('raw'),
    openMessage,
    openAuditLedger: openAuditLedgerModal,
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
    'email.cache': () => EmailPage.cachePanel(),
    'email.trusted': () => EmailPage.trustedPanel(),
    'email.rules': () => EmailPage.rulesPanel(),
    'email.secondary.folders': () => EmailPage.openSecondaryPanel('folders'),
    'email.secondary.checks': () => EmailPage.openSecondaryPanel('checks'),
    'email.secondary.security': () => EmailPage.openSecondaryPanel('security'),
    'email.secondary.cache': () => EmailPage.openSecondaryPanel('cache'),
    'email.secondary.trusted': () => EmailPage.openSecondaryPanel('trusted'),
    'email.secondary.search': () => EmailPage.openSecondaryPanel('search'),
    'email.secondary.rules': () => EmailPage.openSecondaryPanel('rules'),
  });
}
