// help-surface.js — app-wide Blueprints help modal and deterministic action dispatcher.

'use strict';

const BlueprintsHelpSurface = (() => {
  let _lastTurn = null;

  function _esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  function _activeSurface() {
    const activePanel = document.querySelector('.tab-panel.active');
    const tab = activePanel ? activePanel.id.replace(/^tab-/, '') : '';
    const group = window.BlueprintsHubMenuBridge?.activeGroup || '';
    return [group, tab].filter(Boolean).join('.');
  }

  function _setStatus(message, isError = false) {
    const status = document.getElementById('bp-help-status');
    const error = document.getElementById('bp-help-error');
    if (status) status.textContent = isError ? '' : message;
    if (error) error.textContent = isError ? message : '';
  }

  function _setBusy(busy) {
    ['bp-help-submit', 'bp-help-speak', 'bp-help-action'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = !!busy;
    });
  }

  function _query() {
    return (document.getElementById('bp-help-query')?.value || '').trim();
  }

  function _requestBody(query, voice = false) {
    return {
      query,
      search_mode: 'hybrid',
      max_docs: 3,
      max_chars_per_doc: 2500,
      top_k: 5,
      surface: _activeSurface(),
      voice,
    };
  }

  async function _postHelp(path, body) {
    const response = await apiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || data);
      throw new Error(detail || `HTTP ${response.status}`);
    }
    return data;
  }

  function _renderEvidence(evidence) {
    if (!evidence || !Array.isArray(evidence.documents) || !evidence.documents.length) {
      return '<div class="bp-help-evidence-empty">No bounded document evidence returned.</div>';
    }
    return evidence.documents.map((doc, index) => `
      <section class="bp-help-evidence-doc">
        <div class="bp-help-evidence-title">${index + 1}. ${_esc(doc.title || doc.path || 'Document')}</div>
        <div class="bp-help-evidence-path">${_esc(doc.path || '')}</div>
        <pre class="bp-help-evidence-text">${_esc(doc.text || '')}</pre>
      </section>
    `).join('');
  }

  function _renderWarnings(warnings) {
    if (!Array.isArray(warnings) || !warnings.length) return '';
    return `
      <div class="bp-help-warnings">
        ${warnings.map(w => `<div class="bp-help-warning">${_esc(w.message || w.code || JSON.stringify(w))}</div>`).join('')}
      </div>
    `;
  }

  function _renderTurn(data) {
    _lastTurn = data;
    const shortEl = document.getElementById('bp-help-short');
    const answerEl = document.getElementById('bp-help-answer');
    const evidenceEl = document.getElementById('bp-help-evidence');
    const actionBtn = document.getElementById('bp-help-action');
    const shortText = data?.short_response?.text || '';
    const markdown = data?.modal_response?.markdown || data?.answer || '';
    if (shortEl) shortEl.textContent = shortText;
    if (answerEl) answerEl.textContent = markdown;
    if (evidenceEl) evidenceEl.innerHTML = _renderEvidence(data?.evidence);
    if (actionBtn) {
      actionBtn.hidden = !(data?.action?.dispatch);
      actionBtn.disabled = !(data?.action?.dispatch);
    }
    _setStatus(data?.task_id ? `Task ${data.task_id}` : 'Help response ready.');
    const warningHost = document.getElementById('bp-help-warnings');
    if (warningHost) warningHost.innerHTML = _renderWarnings(data?.warnings);
  }

  async function ask({ speak = false } = {}) {
    const query = _query();
    if (!query) {
      _setStatus('Enter a help question.', true);
      return;
    }
    _setBusy(true);
    _setStatus(speak ? 'Preparing help and voice...' : 'Preparing help...');
    try {
      const data = await _postHelp('/api/v1/help/turn', _requestBody(query, speak));
      _renderTurn(data);
      if (speak) await speakLast();
    } catch (err) {
      _setStatus(`Help failed: ${err.message || err}`, true);
    } finally {
      _setBusy(false);
    }
  }

  async function speakLast() {
    const text = _lastTurn?.short_response?.text || '';
    if (!text) {
      const query = _query();
      if (!query) {
        _setStatus('Enter a help question.', true);
        return;
      }
      _setBusy(true);
      try {
        const data = await _postHelp('/api/v1/help/short', _requestBody(query, true));
        _renderTurn(data);
      } catch (err) {
        _setStatus(`Voice help failed: ${err.message || err}`, true);
        _setBusy(false);
        return;
      }
      _setBusy(false);
    }
    const speakText = _lastTurn?.short_response?.text || '';
    if (!speakText || typeof BlueprintsTtsClient === 'undefined') return;
    try {
      await BlueprintsTtsClient.speak({
        text: speakText,
        interrupt: true,
        mode: 'stream',
        eventKind: 'help_short',
        fallbackKind: 'positive',
      });
    } catch (err) {
      _setStatus(`TTS failed: ${err.message || err}`, true);
    }
  }

  function _openKnownModal(dispatch) {
    const opener = dispatch?.opener || '';
    const modalId = dispatch?.modal_id || '';
    const openers = {
      openDocsSearchModal: () => openDocsSearchModal({ query: _query(), mode: 'hybrid', focusQuery: false }),
      openNewDocModal: () => openNewDocModal(),
      openAddDocModal: () => openAddDocModal(),
      'BlueprintsHelpSurface.open': () => open(),
    };
    const fn = openers[opener];
    if (typeof fn === 'function') {
      fn();
      return true;
    }
    const modal = modalId ? document.getElementById(modalId) : null;
    if (!modal) return false;
    if (typeof HubModal !== 'undefined') HubModal.open(modal);
    else if (!modal.open) modal.showModal();
    return true;
  }

  async function _openCatalogedDoc(dispatch) {
    if (!dispatch?.doc_id && !dispatch?.path) return false;
    if (dispatch.group && typeof switchGroup === 'function') switchGroup(dispatch.group);
    if (dispatch.tab && typeof switchTab === 'function') switchTab(dispatch.tab);
    const menu = window.BlueprintsHubMenuBridge?.getActiveMenuConfig?.();
    if (menu && dispatch.tab && typeof menu.updateActiveTab === 'function') menu.updateActiveTab(dispatch.tab);
    if (typeof loadDocs === 'function' && (!Array.isArray(_docsAll) || !_docsAll.length)) {
      await loadDocs();
    }
    if (dispatch.doc_id && typeof docsSelectDoc === 'function') {
      return await docsSelectDoc(dispatch.doc_id);
    }
    if (dispatch.path && typeof docsOpenByPath === 'function') {
      docsOpenByPath(dispatch.path);
      return true;
    }
    return false;
  }

  async function executeAction(action = null) {
    const chosen = action || _lastTurn?.action;
    const dispatch = chosen?.dispatch;
    if (!dispatch) return false;
    if (dispatch.type === 'open_page' || dispatch.type === 'open_modal') {
      if (dispatch.group && typeof switchGroup === 'function') switchGroup(dispatch.group);
      if (dispatch.tab && typeof switchTab === 'function') {
        switchTab(dispatch.tab);
        const menu = window.BlueprintsHubMenuBridge?.getActiveMenuConfig?.();
        if (menu && typeof menu.updateActiveTab === 'function') menu.updateActiveTab(dispatch.tab);
      }
    }
    if (dispatch.type === 'open_modal') {
      window.setTimeout(() => _openKnownModal(dispatch), 50);
    }
    if (dispatch.type === 'open_doc') {
      return await _openCatalogedDoc(dispatch);
    }
    return true;
  }

  function open() {
    const modal = document.getElementById('bp-help-modal');
    if (!modal) return;
    if (typeof HubModal !== 'undefined') {
      HubModal.open(modal, {
        onOpen: () => {
          const input = document.getElementById('bp-help-query');
          if (input) input.focus();
        },
      });
    } else if (!modal.open) {
      modal.showModal();
    }
  }

  function init() {
    document.getElementById('bp-help-open')?.addEventListener('click', open);
    document.getElementById('bp-help-submit')?.addEventListener('click', () => ask({ speak: false }));
    document.getElementById('bp-help-speak')?.addEventListener('click', () => ask({ speak: true }));
    document.getElementById('bp-help-action')?.addEventListener('click', () => { executeAction(); });
    document.getElementById('bp-help-query')?.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      ask({ speak: false });
    });
  }

  return {
    ask,
    executeAction,
    init,
    open,
    speakLast,
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  BlueprintsHelpSurface.init();
});
