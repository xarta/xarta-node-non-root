// Dave Email page - read-only PIM email mailbox view.

'use strict';

const EmailPage = (() => {
  const API_ROOT = '/api/v1/personal/email';
  const ULTRAWIDE_QUERY = '(min-width: 2400px) and (max-height: 1280px)';
  const VIEW_IDS = ['plain', 'html', 'markdown'];

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
    view: 'plain',
    secondaryTab: 'folders',
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
    const strip = el('email-status-strip');
    if (!strip) return;
    const cleanTone = ['ok', 'warn', 'err', 'unknown'].includes(tone) ? tone : 'unknown';
    strip.innerHTML = `
      <span class="email-status-dot email-status-dot--${cleanTone}" aria-hidden="true"></span>
      <span class="email-status-text">${escHtml(text || '')}</span>
    `;
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

  function isInboxFolder(name) {
    return String(name || '').trim().toUpperCase() === 'INBOX';
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
    const inboxCount = state.messages.length;
    meta.textContent = `${mailboxAddress()} - ${folderCount} folders - ${inboxCount} Inbox rows`;
  }

  function renderFolderChip() {
    const chip = el('email-folder-chip');
    if (chip) chip.textContent = `Folder: ${state.folder || 'INBOX'}`;
  }

  function renderViewTabs() {
    document.querySelectorAll('[data-email-view-button]').forEach(button => {
      button.dataset.active = button.dataset.emailViewButton === state.view ? 'true' : 'false';
    });
  }

  function folderButtonHtml(folder) {
    const name = folderName(folder);
    if (!name) return '';
    const active = String(name).toUpperCase() === String(state.folder || 'INBOX').toUpperCase();
    return `
      <button class="email-folder-btn" type="button" data-email-folder-name="${escHtml(name)}" data-active="${active ? 'true' : 'false'}">
        <span class="email-folder-name">${escHtml(name)}</span>
        <span class="email-folder-flags">${escHtml(folderFlags(folder))}</span>
      </button>
    `;
  }

  function foldersHtml() {
    if (!state.folders.length) return '<div class="email-empty">No folders loaded.</div>';
    return state.folders.map(folderButtonHtml).join('');
  }

  function renderFolders() {
    const host = el('email-folder-list');
    if (host) host.innerHTML = foldersHtml();
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
    const host = el('email-message-list');
    if (!host) return;
    if (!isInboxFolder(state.folder)) {
      host.innerHTML = '<div class="email-empty">Folder listing is available; message listing is limited to Inbox in this MVP.</div>';
      return;
    }
    host.innerHTML = state.messages.length
      ? state.messages.map(messageRowHtml).join('')
      : '<div class="email-empty">No Inbox messages loaded.</div>';
  }

  function renderMessage() {
    renderViewTabs();
    const meta = el('email-message-meta');
    const content = el('email-message-content');
    if (!content) return;
    const message = state.message;
    if (!message) {
      if (meta) meta.textContent = 'Select a message';
      content.innerHTML = '<div class="email-empty">Open a message from the Inbox list.</div>';
      return;
    }
    const headers = message.headers || {};
    if (meta) {
      const subject = headers.subject || '(no subject)';
      const from = headers.from || '';
      const date = headers.date || '';
      meta.textContent = `${subject} - ${from} - ${date}`;
    }
    const views = message.views || {};
    const value = String(views[state.view] || '');
    if (state.view === 'html') {
      content.innerHTML = value
        ? `<div class="email-html-view">${value}</div>`
        : '<div class="email-empty">No sanitized HTML view is available for this message.</div>';
      return;
    }
    const pre = document.createElement('pre');
    pre.textContent = value || `No ${state.view} view is available for this message.`;
    content.textContent = '';
    content.appendChild(pre);
  }

  function capabilityRowsHtml() {
    const caps = state.status?.capabilities || {};
    const rows = [
      ['Credential storage', state.status?.storage === 'postgres' ? 'Postgres, encrypted mailbox password' : 'not ready'],
      ['IMAP read', caps.imap_read ? 'enabled' : 'disabled'],
      ['SMTP self-test gate', caps.smtp_self_test ? 'self mailbox only' : 'disabled'],
      ['General outbound', caps.smtp_general_send ? 'enabled' : 'disabled'],
      ['Delete capability', caps.delete ? 'enabled' : 'disabled'],
      ['AI outbound', caps.ai_send ? 'enabled' : 'disabled'],
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
      ['folders', 'Folders'],
      ['checks', 'Checks'],
    ];
    return tabs.map(([id, label]) => `
      <button type="button" data-email-secondary-tab="${escHtml(id)}" data-active="${state.secondaryTab === id ? 'true' : 'false'}" data-email-secondary-layout="${escHtml(layout)}">${escHtml(label)}</button>
    `).join('');
  }

  function secondaryBodyHtml() {
    if (state.secondaryTab === 'checks') return capabilityRowsHtml();
    return foldersHtml();
  }

  function renderSecondaryPanels() {
    document.querySelectorAll('.email-secondary-tabs').forEach(host => {
      host.innerHTML = secondaryTabsHtml(host.closest('#ultrawide-sidecar') ? 'ultrawide' : 'secondary');
    });
    const bottom = el('email-secondary-bottom-body');
    if (bottom) bottom.innerHTML = secondaryBodyHtml();
    const modal = el('email-secondary-modal-body');
    if (modal) modal.innerHTML = secondaryBodyHtml();
    const modalTitle = el('email-secondary-modal-title');
    if (modalTitle) modalTitle.textContent = state.secondaryTab === 'checks' ? 'Email Checks' : 'Email Folders';
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
      <div class="email-ultrawide-content">${secondaryBodyHtml()}</div>
    `;
    window.UltrawideSidecar.setTitle('Email');
    window.UltrawideSidecar.clear();
    window.UltrawideSidecar.appendNode(shell);
  }

  function renderAll() {
    renderMeta();
    renderFolderChip();
    renderFolders();
    renderMessages();
    renderMessage();
    renderSecondaryPanels();
    renderUltrawide();
    if (window.BodyShade && typeof window.BodyShade.scheduleSizeFillTable === 'function') {
      window.BodyShade.scheduleSizeFillTable();
    }
  }

  function renderError(message) {
    state.error = message || 'Email middleware unavailable';
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
    state.loading = true;
    state.error = '';
    setStatus('Loading email middleware', 'unknown');
    try {
      const [status, folders, inbox] = await Promise.all([
        fetchJson(`${API_ROOT}/status`),
        fetchJson(`${API_ROOT}/folders`),
        fetchJson(`${API_ROOT}/inbox?limit=30`),
      ]);
      state.status = status;
      state.mailbox = folders.mailbox || inbox.mailbox || status.mailboxes?.[0] || null;
      state.folders = Array.isArray(folders.folders) ? folders.folders : [];
      state.messages = Array.isArray(inbox.messages) ? inbox.messages : [];
      state.folder = 'INBOX';
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

  async function openMessage(uid) {
    const cleanUid = String(uid || '').trim();
    if (!cleanUid) return false;
    if (!isInboxFolder(state.folder)) {
      setStatus('Only Inbox message opening is wired in this MVP', 'warn');
      return false;
    }
    setStatus('Opening message', 'unknown');
    try {
      const folder = encodeURIComponent(state.folder || 'INBOX');
      const data = await fetchJson(`${API_ROOT}/messages/${encodeURIComponent(cleanUid)}?folder=${folder}`);
      state.message = data.message || null;
      setStatus('Message opened', 'ok');
      renderMessages();
      renderMessage();
      return true;
    } catch (error) {
      setStatus(error.message || String(error), 'err');
      return false;
    }
  }

  function setFolder(name) {
    const clean = String(name || '').trim() || 'INBOX';
    state.folder = clean;
    state.message = null;
    if (!isInboxFolder(clean)) {
      setStatus('Folder list loaded; Inbox is the only message listing in this MVP', 'warn');
    } else {
      setStatus('Inbox selected', state.loaded ? 'ok' : 'unknown');
    }
    renderAll();
    return true;
  }

  function setView(view) {
    const clean = VIEW_IDS.includes(view) ? view : 'plain';
    state.view = clean;
    renderMessage();
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
    if (action === 'safe-checks') return safeChecks();
    return false;
  }

  function bind() {
    if (document.body.dataset.emailPageBound === '1') return;
    document.body.dataset.emailPageBound = '1';
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
      const folderBtn = target.closest?.('[data-email-folder-name]');
      if (folderBtn) {
        event.preventDefault();
        setFolder(folderBtn.dataset.emailFolderName || 'INBOX');
        return;
      }
      const messageRow = target.closest?.('[data-email-message-uid]');
      if (messageRow) {
        event.preventDefault();
        openMessage(messageRow.dataset.emailMessageUid || '');
      }
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
      status: state.error ? 'error' : (state.loaded ? 'ready' : ''),
      mailbox: mailboxAddress(),
      folder_count: state.folders.length,
      inbox_count: state.messages.length,
      selected_uid: activeMessageUid(),
      view: state.view,
      secondary_tab: state.secondaryTab,
      error: state.error,
    };
  }

  bind();

  return {
    load,
    refresh,
    browseFolders,
    safeChecks,
    setView,
    viewPlain: () => setView('plain'),
    viewHtml: () => setView('html'),
    viewMarkdown: () => setView('markdown'),
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
    'email.safeChecks': () => EmailPage.safeChecks(),
  });
}
