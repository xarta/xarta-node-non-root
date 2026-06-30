// Dave Email page - read-only PIM email mailbox view.

'use strict';

const EmailPage = (() => {
  const API_ROOT = '/api/v1/personal/email';
  const ULTRAWIDE_QUERY = '(min-width: 2400px) and (max-height: 1280px)';
  const VIEW_IDS = ['plain', 'html', 'markdown', 'raw'];
  const RICH_VIEW_IDS = new Set(['html', 'markdown']);
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
    mailbox: null,
    folders: [],
    messages: [],
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

  function el(id) {
    return document.getElementById(id);
  }

  function fetcher() {
    return typeof apiFetch === 'function' ? apiFetch : fetch;
  }

  async function fetchJson(url, options = {}) {
    const resp = await fetcher()(url, options);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.detail || `HTTP ${resp.status}`);
    return data;
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
    const flags = Array.isArray(folder?.flags) ? folder.flags : [];
    return flags.length ? flags.join(', ') : 'mailbox folder';
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
    return String(state.message?.uid || '');
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
    meta.textContent = `${mailboxAddress()} - ${folderCount} folders - ${rowCount} ${state.folder || 'INBOX'} rows`;
  }

  function renderFolderChip() {
    const chip = el('email-folder-chip');
    if (chip) chip.textContent = `Folder: ${state.folder || 'INBOX'}`;
  }

  function renderViewTabs() {
    const richAllowed = richViewsAllowed();
    document.querySelectorAll('[data-email-view-button]').forEach(button => {
      const view = button.dataset.emailViewButton || '';
      const blocked = RICH_VIEW_IDS.has(view) && !richAllowed;
      button.dataset.active = view === state.view ? 'true' : 'false';
      button.disabled = blocked;
      button.title = blocked
        ? 'HTML and Markdown views require a green message security result'
        : '';
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

  function messageRowHtml(row) {
    const selected = String(row.uid || '') === activeMessageUid();
    return `
      <div class="email-message-row" data-email-message-uid="${escHtml(row.uid || '')}" data-selected="${selected ? 'true' : 'false'}" tabindex="0">
        <div>
          <div class="email-message-title">${escHtml(row.subject || '(no subject)')}</div>
          <div class="email-message-from">${escHtml(row.from || '')}</div>
          <div class="email-message-date">${escHtml(row.date || '')}</div>
        </div>
        <button class="email-row-btn email-row-btn--open" type="button" data-email-message-uid="${escHtml(row.uid || '')}" title="Open message" aria-label="Open message"></button>
      </div>
    `;
  }

  function renderMessages() {
    const count = el('email-inbox-count');
    if (count) count.textContent = String(state.messages.length);
    const heading = el('email-inbox-heading');
    if (heading) heading.textContent = state.folder || 'INBOX';
    const host = el('email-message-list');
    if (!host) return;
    if (state.folderLoading) {
      host.innerHTML = `<div class="email-empty">Loading last 30 messages for ${escHtml(state.folder || 'INBOX')}.</div>`;
      return;
    }
    host.innerHTML = state.messages.length
      ? state.messages.map(messageRowHtml).join('')
      : `<div class="email-empty">No messages loaded for ${escHtml(state.folder || 'INBOX')}.</div>`;
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
      return '<div class="email-empty">No backend security result is attached to this message yet.</div>';
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

  function htmlFrameDocument(value) {
    const origin = window.location?.origin || '';
    const imgSources = origin ? `data: ${origin}` : 'data:';
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
<body>${value}</body>
</html>`;
  }

  function renderHtmlMessage(content, value) {
    if (!value) {
      content.innerHTML = '<div class="email-empty">No sanitized HTML view is available for this message.</div>';
      return;
    }
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
    frame.srcdoc = htmlFrameDocument(value);
    shell.appendChild(safety);
    shell.appendChild(frame);
    content.appendChild(shell);
  }

  function richViewsAllowed() {
    return String(securityAggregate().status || '').toLowerCase() === 'green';
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

  function renderMessage() {
    if (RICH_VIEW_IDS.has(state.view) && !richViewsAllowed()) state.view = 'plain';
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
    const views = message.views || {};
    const value = String(views[state.view] || '');
    if (state.view === 'html') {
      renderHtmlMessage(content, value);
      return;
    }
    if (state.view === 'raw') {
      renderRawMessage(content, value);
      return;
    }
    const pre = document.createElement('pre');
    pre.textContent = value || `No ${state.view} view is available for this message.`;
    content.textContent = '';
    content.appendChild(pre);
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
    const rows = [
      ['Credential storage', state.status?.storage === 'postgres' ? 'Postgres, encrypted mailbox password' : 'not ready'],
      ['IMAP read', caps.imap_read ? 'enabled' : 'disabled'],
      ['SMTP self-test gate', caps.smtp_self_test ? 'self mailbox only' : 'disabled'],
      ['General outbound', caps.smtp_general_send ? 'enabled' : 'disabled'],
      ['Delete capability', caps.delete ? 'enabled' : 'disabled'],
      ['AI outbound', caps.ai_send ? 'enabled' : 'disabled'],
      ['Security checks', checks.available ? 'required and available' : 'required; message view blocked if unavailable'],
      ['Current message security', aggregate.status ? `${aggregate.status} - ${aggregate.summary || ''}` : 'open a message'],
      ['DKIM / SPF / DMARC', messageSecurity.available ? `${messageSecurity.dkim?.signature_count || 0} DKIM, SPF ${messageSecurity.spf?.result || 'n/a'}, DMARC ${messageSecurity.dmarc?.result || 'n/a'}` : 'not checked yet'],
      ['Local AI scam judgement', messageSecurity.llm?.called ? `called ${messageSecurity.llm.model || 'local model'}` : 'not checked yet'],
      ['HTML sandbox', 'srcdoc iframe, no scripts, no same-origin storage'],
      ['Image proxy', 'same-site JPEG transform, no cookies or referrer'],
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

  function secondaryTabsHtml(layout = 'secondary') {
    const tabs = [
      ['checks', 'Checks'],
      ['security', 'Security'],
    ];
    return tabs.map(([id, label]) => `
      <button type="button" data-email-secondary-tab="${escHtml(id)}" data-active="${state.secondaryTab === id ? 'true' : 'false'}" data-email-secondary-layout="${escHtml(layout)}">${escHtml(label)}</button>
    `).join('');
  }

  function secondaryBodyHtml() {
    if (state.secondaryTab === 'checks') return capabilityRowsHtml();
    if (state.secondaryTab === 'security') return messageSecurityHtml();
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
        : (state.secondaryTab === 'checks' ? 'Email Checks' : 'Email Folders');
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

  function renderAll() {
    renderMeta();
    renderFolderChip();
    renderFolderControls();
    renderFolders();
    renderMessages();
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

  async function load(options = {}) {
    if (state.loading) return state.status;
    if (state.loaded && !options.force) {
      renderUltrawide();
      return state.status;
    }
    const selectedFolder = options.folder || (state.loaded ? state.folder : 'INBOX') || 'INBOX';
    state.folderLoadSeq += 1;
    state.loading = true;
    state.error = '';
    setStatus('Loading email middleware', 'unknown');
    try {
      const [status, folders, messages] = await Promise.all([
        fetchJson(`${API_ROOT}/status`),
        fetchJson(`${API_ROOT}/folders`),
        fetchJson(`${API_ROOT}/folder-messages?folder=${encodeURIComponent(selectedFolder)}&limit=30`),
      ]);
      state.status = status;
      state.mailbox = folders.mailbox || messages.mailbox || status.mailboxes?.[0] || null;
      state.folders = Array.isArray(folders.folders) ? folders.folders : [];
      state.messages = Array.isArray(messages.messages) ? messages.messages : [];
      state.folder = messages.folder || selectedFolder;
      state.folderLoading = false;
      state.message = null;
      state.loaded = true;
      setStatus('Email middleware ready', 'ok');
      renderAll();
      return status;
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
    state.folderLoading = true;
    setStatus(`Loading ${clean} messages`, 'unknown');
    renderAll();
    try {
      const data = await fetchJson(`${API_ROOT}/folder-messages?folder=${encodeURIComponent(clean)}&limit=30`);
      if (seq !== state.folderLoadSeq) return false;
      state.mailbox = data.mailbox || state.mailbox;
      state.folder = data.folder || clean;
      state.messages = Array.isArray(data.messages) ? data.messages : [];
      state.folderLoading = false;
      setStatus(`${state.folder} selected`, 'ok');
      renderAll();
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

  async function openMessage(uid) {
    const cleanUid = String(uid || '').trim();
    if (!cleanUid) return false;
    const runId = securityRunId();
    beginSecurityProgress(runId, cleanUid, state.folder || 'INBOX');
    try {
      const folder = encodeURIComponent(state.folder || 'INBOX');
      const data = await fetchJson(`${API_ROOT}/messages/${encodeURIComponent(cleanUid)}?folder=${folder}&security_run_id=${encodeURIComponent(runId)}`);
      state.message = data.message || null;
      state.view = 'plain';
      if (state.message?.security?.progress && !state.message.security.progress.run_id) {
        state.message.security.progress.run_id = runId;
      }
      completeSecurityProgress(state.message?.security || {});
      renderMessages();
      renderMessage();
      renderSecondaryPanels();
      return true;
    } catch (error) {
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
    if (RICH_VIEW_IDS.has(clean) && !richViewsAllowed()) {
      setStatus(`${clean.toUpperCase()} view requires a green message security result`, 'warn');
      renderViewTabs();
      return false;
    }
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
    try {
      state.status = await fetchJson(`${API_ROOT}/status`);
      setStatus('Email safety checks refreshed', 'ok');
    } catch (error) {
      setStatus(error.message || String(error), 'err');
    }
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
        const folder = encodeURIComponent(state.folder || 'INBOX');
        const data = await fetchJson(`${API_ROOT}/messages/${encodeURIComponent(uid)}/security?folder=${folder}&security_run_id=${encodeURIComponent(runId)}`);
        if (state.message && data.security) state.message.security = data.security;
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
    return false;
  }

  function bind() {
    if (document.body.dataset.emailPageBound === '1') return;
    document.body.dataset.emailPageBound = '1';
    if (window.BlueprintsEventStream && typeof window.BlueprintsEventStream.on === 'function') {
      window.BlueprintsEventStream.on(SECURITY_PROGRESS_EVENT, handleSecurityProgressEvent);
      window.BlueprintsEventStream.resumeSoon?.('email security progress listener');
    } else {
      document.addEventListener('blueprints:event', event => {
        if (event.detail?.event_type === SECURITY_PROGRESS_EVENT) handleSecurityProgressEvent(event.detail);
      });
    }
    document.addEventListener('click', event => {
      const target = event.target;
      const actionBtn = target.closest?.('[data-email-action]');
      if (actionBtn) {
        event.preventDefault();
        handleAction(actionBtn.dataset.emailAction);
        return;
      }
      const tabBtn = target.closest?.('[data-email-secondary-tab]');
      if (tabBtn) {
        event.preventDefault();
        state.secondaryTab = tabBtn.dataset.emailSecondaryTab || 'folders';
        renderSecondaryPanels();
        renderUltrawide();
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
        openMessage(messageRow.dataset.emailMessageUid || '');
        return;
      }
      if (!target.closest?.('[data-email-folder-dropdown]')) closeFolderMenus();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest?.('.email-message-row[data-email-message-uid]');
      if (!row) return;
      event.preventDefault();
      openMessage(row.dataset.emailMessageUid || '');
    });
    ['email-secondary-modal-close', 'email-secondary-modal-footer-close'].forEach(id => {
      const btn = el(id);
      if (btn) btn.addEventListener('click', closeModal);
    });
    window.addEventListener('resize', renderUltrawide);
    window.addEventListener('orientationchange', renderUltrawide);
  }

  function snapshot() {
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
      selected_uid: activeMessageUid(),
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
