/* Blueprints public web research modal. */

'use strict';

const WEB_RESEARCH_LS_KEY = 'bp_web_research_v1';
const WEB_RESEARCH_DOUBLE_CLICK_MS = 260;
const WEB_RESEARCH_LONG_PRESS_MS = 650;
const WEB_RESEARCH_SPLIT_LONG_PRESS_MS = 200;
const WEB_RESEARCH_SPLIT_DRAG_ACTIVATE_PX = 3;
const WEB_RESEARCH_SPLIT_LONG_PRESS_MOVE_PX = 12;
const WEB_RESEARCH_SPLIT_DOUBLE_TAP_MS = 320;
const WEB_RESEARCH_SPLIT_DOUBLE_TAP_MOVE_PX = 24;
const WEB_RESEARCH_SPLIT_DEFAULT_RATIO = 0.58;
const WEB_RESEARCH_SPLIT_EDGE_GUARD_PX = 44;
const WEB_RESEARCH_STATE_SCHEMA = 3;

let _webResearchState = {
  query: '',
  depth: 'standard',
  result: null,
  recent: {},
  searchedAt: null,
  schema: WEB_RESEARCH_STATE_SCHEMA,
  splitRatio: WEB_RESEARCH_SPLIT_DEFAULT_RATIO,
  privateMode: false,
};
let _webResearchInFlight = false;
let _webResearchSpeechState = 'IDLE';
let _webResearchSpeechRunId = 0;
let _webResearchSpeechClickTimer = null;
let _webResearchSpeechLastClickAt = 0;
let _webResearchSpeechLongPressTimer = null;
let _webResearchSpeechLastLongPressAt = 0;
let _webResearchPrivacyPointer = null;
let _webResearchPrivacyClickTimer = null;
let _webResearchPrivacyLastClickAt = 0;
let _webResearchPrivacyLastLongPressAt = 0;
let _webResearchSplitPointer = null;
let _webResearchSplitResizeQueued = false;
let _webResearchTopShadePointer = null;
let _webResearchTopShadeResizeQueued = false;
let _webResearchControlsRatio = 1;
let _webResearchPrivacyDocMarkdown = '';
let _webResearchEgressIp = {
  ip: '',
  checkedAt: '',
  error: '',
  loading: false,
};

function _webResearchEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function _webResearchMarkdownHtml(markdown) {
  const text = String(markdown || '').trim() || 'No summary returned.';
  if (typeof _mdToHtml === 'function') return _mdToHtml(text);
  return `<pre class="web-research-markdown-plain bp-font-role-docs-markdown">${_webResearchEsc(text)}</pre>`;
}

function _webResearchDocMarkdownHtml(markdown) {
  let text = String(markdown || '').trim();
  if (typeof _docsPreviewMarkdown === 'function') {
    text = _docsPreviewMarkdown(text);
  } else {
    text = text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
  }
  return _webResearchMarkdownHtml(text);
}

function _webResearchOptionKey(opts = _webResearchState) {
  return JSON.stringify({
    query: String(opts.query || '').trim(),
    depth: opts.depth || 'standard',
  });
}

function _webResearchLoadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(WEB_RESEARCH_LS_KEY) || '{}');
    if (!raw || typeof raw !== 'object') return;
    const privateMode = !!raw.privateMode;
    _webResearchState = {
      ..._webResearchState,
      query: privateMode ? '' : String(raw.query || ''),
      depth: ['quick', 'standard', 'deep'].includes(raw.depth) ? raw.depth : 'standard',
      result: !privateMode && raw.result && typeof raw.result === 'object' ? raw.result : null,
      recent: !privateMode && raw.recent && typeof raw.recent === 'object' ? raw.recent : {},
      searchedAt: privateMode ? null : raw.searchedAt || null,
      schema: WEB_RESEARCH_STATE_SCHEMA,
      splitRatio: raw.schema >= 2 && Number.isFinite(raw.splitRatio)
        ? raw.splitRatio
        : WEB_RESEARCH_SPLIT_DEFAULT_RATIO,
      privateMode,
    };
  } catch {
    localStorage.removeItem(WEB_RESEARCH_LS_KEY);
  }
}

function _webResearchSaveState() {
  const recentEntries = Object.entries(_webResearchState.recent || {}).slice(-8);
  const payload = {
    depth: _webResearchState.depth,
    schema: WEB_RESEARCH_STATE_SCHEMA,
    splitRatio: _webResearchState.splitRatio,
    privateMode: !!_webResearchState.privateMode,
  };
  if (!_webResearchState.privateMode) {
    payload.query = _webResearchState.query;
    payload.result = _webResearchState.result;
    payload.recent = Object.fromEntries(recentEntries);
    payload.searchedAt = _webResearchState.searchedAt;
  }
  localStorage.setItem(WEB_RESEARCH_LS_KEY, JSON.stringify(payload));
}

function _webResearchSetForm() {
  const q = document.getElementById('web-research-query');
  const depth = document.getElementById('web-research-depth');
  if (q) q.value = _webResearchState.query || '';
  if (depth) depth.value = _webResearchState.depth || 'standard';
}

function _webResearchReadForm() {
  _webResearchState.query = (document.getElementById('web-research-query')?.value || '').trim();
  _webResearchState.depth = document.getElementById('web-research-depth')?.value || 'standard';
}

function _webResearchSetStatus(text = '', isError = false) {
  const status = document.getElementById('web-research-status');
  const err = document.getElementById('web-research-error');
  if (status) status.textContent = isError ? '' : text;
  if (err) err.textContent = isError ? text : '';
}

function _webResearchRenderPrivacyToggle() {
  const btn = document.getElementById('web-research-private-toggle');
  if (!btn) return;
  const enabled = !!_webResearchState.privateMode;
  btn.classList.toggle('is-private', enabled);
  btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  btn.setAttribute('aria-label', enabled ? 'Private mode on' : 'Private mode off');
  btn.title = enabled
    ? 'Private mode on: local history, speech cache, and task artifacts are reduced. Long press for details.'
    : 'Private mode off: local query/result retention is enabled. Long press for details.';
  const text = btn.querySelector('.web-research-private-text');
  if (text) text.textContent = enabled ? 'Private' : 'Retained';
}

function _webResearchSetPrivateMode(enabled) {
  _webResearchState.privateMode = !!enabled;
  if (_webResearchState.privateMode) {
    _webResearchState.recent = {};
    _webResearchState.searchedAt = null;
  }
  _webResearchSaveState();
  _webResearchRenderPrivacyToggle();
}

async function _webResearchOpenPrivacyDoc() {
  const modal = document.getElementById('web-research-privacy-modal');
  const doc = document.getElementById('web-research-privacy-doc');
  const err = document.getElementById('web-research-privacy-error');
  if (!modal || !doc || typeof HubModal === 'undefined') return;
  if (err) err.textContent = '';
  if (!_webResearchPrivacyDocMarkdown) {
    doc.textContent = 'Loading privacy documentation...';
  } else {
    doc.innerHTML = _webResearchDocMarkdownHtml(_webResearchPrivacyDocMarkdown);
  }
  HubModal.open(modal);
  if (_webResearchPrivacyDocMarkdown) return;
  try {
    const response = await apiFetch('/api/v1/web-research/privacy-doc');
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.detail || data.error || `HTTP ${response.status}`);
    _webResearchPrivacyDocMarkdown = String(data.markdown || '').trim();
    document.getElementById('web-research-privacy-title').textContent = data.title || 'Web Research Privacy Mode';
    doc.innerHTML = _webResearchDocMarkdownHtml(_webResearchPrivacyDocMarkdown);
  } catch (e) {
    doc.textContent = 'Could not load privacy documentation.';
    if (err) err.textContent = e?.message || 'Privacy documentation could not be loaded.';
  }
}

const _webResearchPrivacyKeyFsm = (() => {
  const transitions = {
    RETAINED: {
      tap: { next: 'PRIVATE', actions: ['enablePrivate'] },
      doubleTap: { next: 'RETAINED', actions: ['emitDoubleTap'] },
      longPress: { next: 'RETAINED', actions: ['openDoc'] },
    },
    PRIVATE: {
      tap: { next: 'RETAINED', actions: ['disablePrivate'] },
      doubleTap: { next: 'PRIVATE', actions: ['emitDoubleTap'] },
      longPress: { next: 'PRIVATE', actions: ['openDoc'] },
    },
  };
  let state = 'RETAINED';

  function syncState() {
    state = _webResearchState.privateMode ? 'PRIVATE' : 'RETAINED';
  }

  function emit(name, detail = {}) {
    const key = document.getElementById('web-research-private-toggle');
    key?.dispatchEvent(new CustomEvent('webresearchprivacykey', {
      bubbles: true,
      detail: { event: name, state, ...detail },
    }));
  }

  function execute(action, detail) {
    if (action === 'enablePrivate') {
      _webResearchSetPrivateMode(true);
      emit('tap', detail);
    } else if (action === 'disablePrivate') {
      _webResearchSetPrivateMode(false);
      emit('tap', detail);
    } else if (action === 'emitDoubleTap') {
      emit('doubleTap', detail);
    } else if (action === 'openDoc') {
      emit('longPress', detail);
      _webResearchOpenPrivacyDoc();
    }
  }

  function dispatch(event, detail = {}) {
    syncState();
    const transition = transitions[state]?.[event];
    if (!transition) return;
    state = transition.next;
    for (const action of transition.actions) execute(action, detail);
    syncState();
  }

  return { dispatch };
})();

function _webResearchClearPrivacyLongPress() {
  if (!_webResearchPrivacyPointer?.longPressTimer) return;
  clearTimeout(_webResearchPrivacyPointer.longPressTimer);
  _webResearchPrivacyPointer.longPressTimer = null;
}

function _webResearchClearPrivacyClickTimer() {
  if (!_webResearchPrivacyClickTimer) return;
  clearTimeout(_webResearchPrivacyClickTimer);
  _webResearchPrivacyClickTimer = null;
}

function _webResearchPrivacyPointerDown(event) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const key = document.getElementById('web-research-private-toggle');
  if (!key) return;
  _webResearchClearPrivacyLongPress();
  _webResearchPrivacyPointer = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    longPressTriggered: false,
    longPressTimer: setTimeout(() => {
      if (!_webResearchPrivacyPointer || _webResearchPrivacyPointer.pointerId !== event.pointerId) return;
      _webResearchPrivacyPointer.longPressTriggered = true;
      _webResearchPrivacyLastLongPressAt = Date.now();
      _webResearchClearPrivacyClickTimer();
      _webResearchPrivacyLastClickAt = 0;
      _webResearchPrivacyKeyFsm.dispatch('longPress', {
        clientX: _webResearchPrivacyPointer.startX,
        clientY: _webResearchPrivacyPointer.startY,
      });
    }, WEB_RESEARCH_LONG_PRESS_MS),
  };
  key.setPointerCapture?.(event.pointerId);
  key.addEventListener('pointermove', _webResearchPrivacyPointerMove);
  key.addEventListener('pointerup', _webResearchPrivacyPointerUp);
  key.addEventListener('pointercancel', _webResearchPrivacyPointerCancel);
}

function _webResearchPrivacyPointerMove(event) {
  const pointer = _webResearchPrivacyPointer;
  if (!pointer || pointer.pointerId !== event.pointerId) return;
  const dx = event.clientX - pointer.startX;
  const dy = event.clientY - pointer.startY;
  const moved = Math.sqrt((dx * dx) + (dy * dy));
  if (moved > WEB_RESEARCH_SPLIT_LONG_PRESS_MOVE_PX) _webResearchClearPrivacyLongPress();
}

function _webResearchPrivacyPointerUp(event) {
  const pointer = _webResearchPrivacyPointer;
  const key = document.getElementById('web-research-private-toggle');
  if (!pointer || pointer.pointerId !== event.pointerId) return;
  _webResearchClearPrivacyLongPress();
  key?.releasePointerCapture?.(event.pointerId);
  key?.removeEventListener('pointermove', _webResearchPrivacyPointerMove);
  key?.removeEventListener('pointerup', _webResearchPrivacyPointerUp);
  key?.removeEventListener('pointercancel', _webResearchPrivacyPointerCancel);
  if (pointer.longPressTriggered) {
    _webResearchPrivacyLastLongPressAt = Date.now();
    _webResearchClearPrivacyClickTimer();
    _webResearchPrivacyLastClickAt = 0;
  }
}

function _webResearchPrivacyPointerCancel(event) {
  const pointer = _webResearchPrivacyPointer;
  const key = document.getElementById('web-research-private-toggle');
  if (!pointer || pointer.pointerId !== event.pointerId) return;
  _webResearchClearPrivacyLongPress();
  key?.releasePointerCapture?.(event.pointerId);
  key?.removeEventListener('pointermove', _webResearchPrivacyPointerMove);
  key?.removeEventListener('pointerup', _webResearchPrivacyPointerUp);
  key?.removeEventListener('pointercancel', _webResearchPrivacyPointerCancel);
}

function _webResearchPrivacyHandleClick(event) {
  const now = Date.now();
  if (now - _webResearchPrivacyLastLongPressAt < 700) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  _webResearchClearPrivacyClickTimer();
  if (
    _webResearchPrivacyLastClickAt
    && (now - _webResearchPrivacyLastClickAt) <= WEB_RESEARCH_DOUBLE_CLICK_MS
  ) {
    _webResearchPrivacyLastClickAt = 0;
    _webResearchPrivacyKeyFsm.dispatch('doubleTap', { clientX: event.clientX, clientY: event.clientY });
    return;
  }
  _webResearchPrivacyLastClickAt = now;
  _webResearchPrivacyClickTimer = setTimeout(() => {
    _webResearchPrivacyClickTimer = null;
    _webResearchPrivacyLastClickAt = 0;
    _webResearchPrivacyKeyFsm.dispatch('tap', { clientX: event.clientX, clientY: event.clientY });
  }, WEB_RESEARCH_DOUBLE_CLICK_MS);
}

function _webResearchRenderEgressIp() {
  const box = document.getElementById('web-research-ip-box');
  const value = document.getElementById('web-research-ip-value');
  if (!box || !value) return;
  box.classList.toggle('is-error', !!_webResearchEgressIp.error);
  box.classList.toggle('is-loading', !!_webResearchEgressIp.loading);
  box.disabled = !!_webResearchEgressIp.loading;
  if (_webResearchEgressIp.loading && !_webResearchEgressIp.ip) {
    value.textContent = 'checking';
  } else if (_webResearchEgressIp.error) {
    value.textContent = 'unavailable';
  } else {
    value.textContent = _webResearchEgressIp.ip || 'not checked';
  }
  const titleBits = ['Click to refresh public IP observed by nullclaw01 web research tooling'];
  if (_webResearchEgressIp.checkedAt) titleBits.push(`Checked: ${_webResearchEgressIp.checkedAt}`);
  if (_webResearchEgressIp.error) titleBits.push(_webResearchEgressIp.error);
  box.title = titleBits.join('\n');
}

async function _webResearchLoadEgressIp(force = false) {
  if (_webResearchEgressIp.loading && !force) return;
  _webResearchEgressIp = { ..._webResearchEgressIp, loading: true, error: '' };
  _webResearchRenderEgressIp();
  try {
    const response = await apiFetch('/api/v1/web-research/egress-ip');
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok || !data.ip) {
      throw new Error(data.detail || data.error || `HTTP ${response.status}`);
    }
    _webResearchEgressIp = {
      ip: String(data.ip || ''),
      checkedAt: String(data.checked_at || ''),
      error: '',
      loading: false,
    };
  } catch (e) {
    _webResearchEgressIp = {
      ..._webResearchEgressIp,
      error: e?.message || 'Could not check web research IP.',
      loading: false,
    };
  }
  _webResearchRenderEgressIp();
}

function _webResearchSetBusy(busy) {
  _webResearchInFlight = !!busy;
  ['web-research-submit', 'web-research-clear'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !!busy;
  });
  ['web-research-query', 'web-research-depth'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !!busy;
  });
}

function _webResearchRender() {
  const panel = document.getElementById('web-research-results');
  if (!panel) return;
  const result = _webResearchState.result;
  if (!result || typeof result !== 'object') {
    panel.classList.remove('has-result');
    panel.innerHTML = '<div class="web-research-empty">No research yet.</div>';
    _webResearchSetStatus('', false);
    return;
  }
  panel.classList.add('has-result');
  const display = result.display && typeof result.display === 'object' ? result.display : {};
  const sources = Array.isArray(display.source_items) ? display.source_items : [];
  const warnings = Array.isArray(display.warnings) ? display.warnings : [];
  const firewallNotes = Array.isArray(display.firewall_notes) ? display.firewall_notes : [];
  const markdown = String(display.summary_markdown || '').trim();
  const sourceStatus = `${sources.length} source${sources.length === 1 ? '' : 's'}`;
  const sourceRows = sources.length ? sources.map(item => {
    const label = _webResearchEsc(item.label || '');
    const title = _webResearchEsc(item.title || item.url || 'Untitled source');
    const url = String(item.url || '');
    const link = url
      ? `<a href="${_webResearchEsc(url)}" target="_blank" rel="noreferrer">${_webResearchEsc(url)}</a>`
      : '<span class="web-research-muted">No URL</span>';
    const claims = Array.isArray(item.claims) && item.claims.length
      ? `<ul class="web-research-claims">${item.claims.slice(0, 4).map(claim => `<li>${_webResearchEsc(claim)}</li>`).join('')}</ul>`
      : '';
    return `
      <article class="web-research-source">
        <div class="web-research-source-main">
          <div class="web-research-source-head">
            <span>${title}</span>
            ${label ? `<span class="web-research-pill ok">${label}</span>` : ''}
          </div>
          <div class="web-research-source-url">${link}</div>
          ${item.snippet ? `<p class="web-research-snippet">${_webResearchEsc(item.snippet)}</p>` : ''}
          <div class="web-research-meta">
            ${item.source_type ? `<span class="web-research-pill">${_webResearchEsc(item.source_type)}</span>` : ''}
            ${item.retrieval_method ? `<span class="web-research-pill">${_webResearchEsc(item.retrieval_method)}</span>` : ''}
            ${item.domain ? `<span class="web-research-pill">${_webResearchEsc(item.domain)}</span>` : ''}
          </div>
          ${claims}
        </div>
      </article>`;
  }).join('') : '<div class="web-research-empty">No sources returned.</div>';
  const warningsHtml = warnings.length ? `
    <section class="web-research-note-block">
      <h3>Warnings</h3>
      ${warnings.map(item => `<p class="web-research-warning">${_webResearchEsc(item)}</p>`).join('')}
    </section>` : '';
  const firewallHtml = firewallNotes.length ? `
    <section class="web-research-note-block">
      <h3>Boundary Notes</h3>
      ${firewallNotes.map(item => `<p class="web-research-note">${_webResearchEsc(item)}</p>`).join('')}
    </section>` : '';
  panel.innerHTML = `
    <div class="web-research-split" id="web-research-split">
      <section class="web-research-answer" id="web-research-synthesis-pane">
        <div class="web-research-speech-control" id="web-research-speech-control">
          <span class="web-research-tts-status bp-font-role-status-meta" id="web-research-tts-status"></span>
          <button class="docs-tree-speaker-btn web-research-speaker" type="button" id="web-research-speaker" aria-label="Speak web research" title="Speak web research"></button>
        </div>
        <div class="web-research-answer-head">
          <strong>${_webResearchEsc(result.query || _webResearchState.query || 'Research')}</strong>
          <span class="web-research-pill ${result.ok ? 'ok' : ''}">${_webResearchEsc(result.status || 'succeeded')}</span>
          <span class="web-research-pill">${_webResearchEsc(result.depth || _webResearchState.depth || 'standard')}</span>
          ${result.private_mode ? '<span class="web-research-pill private">private</span>' : ''}
        </div>
        <div class="web-research-markdown bp-font-role-docs-markdown">${_webResearchMarkdownHtml(markdown)}</div>
      </section>
      <div class="body-shade-handle web-research-shade-handle" id="web-research-shade-handle" role="separator" aria-label="Resize web research synthesis and sources" aria-orientation="horizontal" tabindex="0">
        <div class="body-shade-grip"></div>
      </div>
      <section class="web-research-sources" id="web-research-sources-pane">
        <div class="web-research-section-title">Sources</div>
        ${sourceRows}
        ${warningsHtml}
        ${firewallHtml}
      </section>
    </div>
  `;
  _webResearchSetStatus(result.ok === false ? `Research failed. ${sourceStatus} returned.` : `${sourceStatus} returned.`, result.ok === false);
  _webResearchBindSpeaker();
  _webResearchInitSplit();
}

function _webResearchGetSplitParts() {
  const split = document.getElementById('web-research-split');
  const synthesis = document.getElementById('web-research-synthesis-pane');
  const handle = document.getElementById('web-research-shade-handle');
  const sources = document.getElementById('web-research-sources-pane');
  if (!split || !synthesis || !handle || !sources) return null;
  return { split, synthesis, handle, sources };
}

function _webResearchViewportHeight() {
  if (window.visualViewport && Number.isFinite(window.visualViewport.height) && window.visualViewport.height > 0) {
    return window.visualViewport.height;
  }
  return window.innerHeight || document.documentElement.clientHeight || 0;
}

function _webResearchSplitTotal(parts) {
  if (!parts) return 0;
  const layoutTotal = Math.max(0, parts.split.clientHeight - parts.handle.offsetHeight);
  const rect = parts.split.getBoundingClientRect();
  const modal = document.getElementById('web-research-modal');
  const modalBottom = modal ? modal.getBoundingClientRect().bottom : _webResearchViewportHeight();
  const visibleBottom = Math.min(_webResearchViewportHeight(), modalBottom) - WEB_RESEARCH_SPLIT_EDGE_GUARD_PX;
  const visibleTotal = Math.max(0, visibleBottom - rect.top - parts.handle.offsetHeight);
  if (!layoutTotal) return visibleTotal;
  return Math.min(layoutTotal, visibleTotal);
}

function _webResearchClampVisibleSplitHandle(persist = false) {
  const parts = _webResearchGetSplitParts();
  if (!parts) return;
  const total = _webResearchSplitTotal(parts);
  if (!total) return;
  const current = parts.synthesis.getBoundingClientRect().height;
  if (current > total) _webResearchApplySplitHeight(total, persist);
}

function _webResearchClampSplitHeight(height) {
  const parts = _webResearchGetSplitParts();
  if (!parts) return 0;
  const total = _webResearchSplitTotal(parts);
  if (!total) return 0;
  return Math.max(0, Math.min(Math.round(height), total));
}

function _webResearchApplySplitHeight(height, persist = true) {
  const parts = _webResearchGetSplitParts();
  if (!parts) return;
  const total = _webResearchSplitTotal(parts);
  if (!total) return;
  const next = _webResearchClampSplitHeight(height);
  const sourcesHeight = Math.max(0, total - next);
  parts.synthesis.style.setProperty('--web-research-synthesis-height', `${next}px`);
  parts.synthesis.classList.toggle('is-collapsed', next <= 1);
  parts.sources.classList.toggle('is-collapsed', sourcesHeight <= 1);
  parts.handle.setAttribute('aria-valuemin', '0');
  parts.handle.setAttribute('aria-valuemax', String(total));
  parts.handle.setAttribute('aria-valuenow', String(next));
  if (persist) {
    _webResearchState.splitRatio = Math.max(0, Math.min(1, next / total));
    _webResearchSaveState();
  }
}

function _webResearchSyncSplit() {
  const parts = _webResearchGetSplitParts();
  if (!parts) return;
  const total = _webResearchSplitTotal(parts);
  if (!total) return;
  const ratio = Number.isFinite(_webResearchState.splitRatio)
    ? _webResearchState.splitRatio
    : WEB_RESEARCH_SPLIT_DEFAULT_RATIO;
  _webResearchApplySplitHeight(total * ratio, false);
  _webResearchClampVisibleSplitHandle(false);
}

function _webResearchQueueSplitSync() {
  if (_webResearchSplitResizeQueued) return;
  _webResearchSplitResizeQueued = true;
  requestAnimationFrame(() => {
    _webResearchSplitResizeQueued = false;
    _webResearchSyncSplit();
  });
}

function _webResearchGetTopShadeParts() {
  const controls = document.getElementById('web-research-controls-panel');
  const handle = document.getElementById('web-research-top-shade-handle');
  const results = document.getElementById('web-research-results');
  if (!controls || !handle || !results) return null;
  return { controls, handle, results };
}

function _webResearchGetControlsMaxHeight() {
  const parts = _webResearchGetTopShadeParts();
  if (!parts) return 0;
  return Math.max(0, Math.ceil(parts.controls.scrollHeight));
}

function _webResearchApplyControlsHeight(height) {
  const parts = _webResearchGetTopShadeParts();
  if (!parts) return;
  const max = _webResearchGetControlsMaxHeight();
  const next = Math.max(0, Math.min(Math.round(height), max));
  parts.controls.style.setProperty('--web-research-controls-height', `${next}px`);
  parts.controls.classList.toggle('is-collapsed', next <= 1);
  parts.handle.setAttribute('aria-valuemin', '0');
  parts.handle.setAttribute('aria-valuemax', String(max));
  parts.handle.setAttribute('aria-valuenow', String(next));
  _webResearchControlsRatio = max ? Math.max(0, Math.min(1, next / max)) : 1;
  _webResearchQueueSplitSync();
}

function _webResearchSyncTopShade() {
  const max = _webResearchGetControlsMaxHeight();
  if (!max) return;
  _webResearchApplyControlsHeight(max * _webResearchControlsRatio);
}

function _webResearchQueueTopShadeSync() {
  if (_webResearchTopShadeResizeQueued) return;
  _webResearchTopShadeResizeQueued = true;
  requestAnimationFrame(() => {
    _webResearchTopShadeResizeQueued = false;
    _webResearchSyncTopShade();
  });
}

const _webResearchShadeHandleFsm = (() => {
  const transitions = {
    IDLE: {
      tap: { next: 'IDLE', actions: ['emitTap'] },
      doubleTap: { next: 'IDLE', actions: ['emitDoubleTap'] },
      longPress: { next: 'IDLE', actions: ['emitLongPress'] },
      dragStart: { next: 'DRAGGING', actions: ['emitDragStart'] },
      keyResize: { next: 'IDLE', actions: ['resizeByKey'] },
    },
    DRAGGING: {
      dragMove: { next: 'DRAGGING', actions: ['resizeByDrag'] },
      dragEnd: { next: 'IDLE', actions: ['emitDragEnd'] },
      dragCancel: { next: 'IDLE', actions: ['emitDragCancel'] },
    },
  };
  let state = 'IDLE';

  function emit(name, detail = {}) {
    const handle = document.getElementById('web-research-shade-handle');
    handle?.dispatchEvent(new CustomEvent('webresearchshadehandle', {
      bubbles: true,
      detail: { event: name, state, ...detail },
    }));
  }

  function execute(action, detail) {
    if (action === 'emitTap') emit('tap', detail);
    else if (action === 'emitDoubleTap') emit('doubleTap', detail);
    else if (action === 'emitLongPress') emit('longPress', detail);
    else if (action === 'emitDragStart') emit('dragStart', detail);
    else if (action === 'resizeByDrag') {
      _webResearchApplySplitHeight(detail.height);
      emit('dragMove', detail);
    } else if (action === 'resizeByKey') {
      _webResearchApplySplitHeight(detail.height);
      emit('keyResize', detail);
    } else if (action === 'emitDragEnd') emit('dragEnd', detail);
    else if (action === 'emitDragCancel') emit('dragCancel', detail);
  }

  function dispatch(event, detail = {}) {
    const transition = transitions[state]?.[event];
    if (!transition) return;
    state = transition.next;
    for (const action of transition.actions) execute(action, detail);
  }

  return { dispatch };
})();

const _webResearchTopShadeHandleFsm = (() => {
  const transitions = {
    IDLE: {
      tap: { next: 'IDLE', actions: ['emitTap'] },
      doubleTap: { next: 'IDLE', actions: ['emitDoubleTap'] },
      longPress: { next: 'IDLE', actions: ['emitLongPress'] },
      dragStart: { next: 'DRAGGING', actions: ['emitDragStart'] },
      keyResize: { next: 'IDLE', actions: ['resizeByKey'] },
    },
    DRAGGING: {
      dragMove: { next: 'DRAGGING', actions: ['resizeByDrag'] },
      dragEnd: { next: 'IDLE', actions: ['emitDragEnd'] },
      dragCancel: { next: 'IDLE', actions: ['emitDragCancel'] },
    },
  };
  let state = 'IDLE';

  function emit(name, detail = {}) {
    const handle = document.getElementById('web-research-top-shade-handle');
    handle?.dispatchEvent(new CustomEvent('webresearchtopshadehandle', {
      bubbles: true,
      detail: { event: name, state, ...detail },
    }));
  }

  function execute(action, detail) {
    if (action === 'emitTap') emit('tap', detail);
    else if (action === 'emitDoubleTap') emit('doubleTap', detail);
    else if (action === 'emitLongPress') emit('longPress', detail);
    else if (action === 'emitDragStart') emit('dragStart', detail);
    else if (action === 'resizeByDrag') {
      _webResearchApplyControlsHeight(detail.height);
      emit('dragMove', detail);
    } else if (action === 'resizeByKey') {
      _webResearchApplyControlsHeight(detail.height);
      emit('keyResize', detail);
    } else if (action === 'emitDragEnd') emit('dragEnd', detail);
    else if (action === 'emitDragCancel') emit('dragCancel', detail);
  }

  function dispatch(event, detail = {}) {
    const transition = transitions[state]?.[event];
    if (!transition) return;
    state = transition.next;
    for (const action of transition.actions) execute(action, detail);
  }

  return { dispatch };
})();

function _webResearchClearSplitLongPress() {
  if (!_webResearchSplitPointer?.longPressTimer) return;
  clearTimeout(_webResearchSplitPointer.longPressTimer);
  _webResearchSplitPointer.longPressTimer = null;
}

function _webResearchClearTopShadeLongPress() {
  if (!_webResearchTopShadePointer?.longPressTimer) return;
  clearTimeout(_webResearchTopShadePointer.longPressTimer);
  _webResearchTopShadePointer.longPressTimer = null;
}

function _webResearchHandleSplitTap(event) {
  const now = Date.now();
  const last = _webResearchSplitPointer?.lastTap || null;
  if (last) {
    const dt = now - last.at;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    const moved = Math.sqrt((dx * dx) + (dy * dy));
    if (dt <= WEB_RESEARCH_SPLIT_DOUBLE_TAP_MS && moved <= WEB_RESEARCH_SPLIT_DOUBLE_TAP_MOVE_PX) {
      _webResearchSplitPointer = { lastTap: null };
      _webResearchShadeHandleFsm.dispatch('doubleTap', { clientX: event.clientX, clientY: event.clientY });
      return;
    }
  }
  _webResearchSplitPointer = {
    ...(_webResearchSplitPointer || {}),
    lastTap: { at: now, x: event.clientX, y: event.clientY },
  };
  _webResearchShadeHandleFsm.dispatch('tap', { clientX: event.clientX, clientY: event.clientY });
}

function _webResearchHandleTopShadeTap(event) {
  const now = Date.now();
  const last = _webResearchTopShadePointer?.lastTap || null;
  if (last) {
    const dt = now - last.at;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    const moved = Math.sqrt((dx * dx) + (dy * dy));
    if (dt <= WEB_RESEARCH_SPLIT_DOUBLE_TAP_MS && moved <= WEB_RESEARCH_SPLIT_DOUBLE_TAP_MOVE_PX) {
      _webResearchTopShadePointer = { lastTap: null };
      _webResearchTopShadeHandleFsm.dispatch('doubleTap', {
        clientX: event.clientX,
        clientY: event.clientY,
      });
      return;
    }
  }
  _webResearchTopShadePointer = {
    ...(_webResearchTopShadePointer || {}),
    lastTap: { at: now, x: event.clientX, y: event.clientY },
  };
  _webResearchTopShadeHandleFsm.dispatch('tap', { clientX: event.clientX, clientY: event.clientY });
}

function _webResearchInitSplit() {
  const parts = _webResearchGetSplitParts();
  if (!parts) return;
  const handle = parts.handle;
  if (handle.dataset.webResearchSplitBound !== '1') {
    handle.dataset.webResearchSplitBound = '1';
    handle.addEventListener('pointerdown', _webResearchSplitPointerDown);
    handle.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
    });
    handle.addEventListener('keydown', _webResearchSplitKeydown);
  }
  _webResearchQueueSplitSync();
}

function _webResearchInitTopShade() {
  const parts = _webResearchGetTopShadeParts();
  if (!parts) return;
  const handle = parts.handle;
  if (handle.dataset.webResearchTopShadeBound !== '1') {
    handle.dataset.webResearchTopShadeBound = '1';
    handle.addEventListener('pointerdown', _webResearchTopShadePointerDown);
    handle.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
    });
    handle.addEventListener('keydown', _webResearchTopShadeKeydown);
  }
  _webResearchQueueTopShadeSync();
}

function _webResearchTopShadePointerDown(event) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const parts = _webResearchGetTopShadeParts();
  if (!parts) return;
  event.preventDefault();
  event.stopPropagation();
  const startHeight = parts.controls.getBoundingClientRect().height;
  _webResearchClearTopShadeLongPress();
  _webResearchTopShadePointer = {
    pointerId: event.pointerId,
    startY: event.clientY,
    startX: event.clientX,
    startHeight,
    isDragging: false,
    longPressTriggered: false,
    lastTap: _webResearchTopShadePointer?.lastTap || null,
    longPressTimer: setTimeout(() => {
      if (!_webResearchTopShadePointer || _webResearchTopShadePointer.pointerId !== event.pointerId) return;
      _webResearchTopShadePointer.longPressTriggered = true;
      _webResearchTopShadeHandleFsm.dispatch('longPress', {
        clientX: _webResearchTopShadePointer.startX,
        clientY: _webResearchTopShadePointer.startY,
      });
    }, WEB_RESEARCH_SPLIT_LONG_PRESS_MS),
  };
  parts.handle.classList.add('is-grabbing');
  parts.handle.setPointerCapture?.(event.pointerId);
  parts.handle.addEventListener('pointermove', _webResearchTopShadePointerMove);
  parts.handle.addEventListener('pointerup', _webResearchTopShadePointerUp);
  parts.handle.addEventListener('pointercancel', _webResearchTopShadePointerCancel);
}

function _webResearchTopShadePointerMove(event) {
  const pointer = _webResearchTopShadePointer;
  if (!pointer || pointer.pointerId !== event.pointerId) return;
  const dy = event.clientY - pointer.startY;
  const dx = event.clientX - pointer.startX;
  const moved = Math.sqrt((dx * dx) + (dy * dy));
  if (moved > WEB_RESEARCH_SPLIT_LONG_PRESS_MOVE_PX) _webResearchClearTopShadeLongPress();
  if (!pointer.isDragging && moved > WEB_RESEARCH_SPLIT_DRAG_ACTIVATE_PX) {
    pointer.isDragging = true;
    _webResearchTopShadeHandleFsm.dispatch('dragStart', { clientX: event.clientX, clientY: event.clientY });
  }
  if (!pointer.isDragging) return;
  _webResearchTopShadeHandleFsm.dispatch('dragMove', {
    clientX: event.clientX,
    clientY: event.clientY,
    height: pointer.startHeight + dy,
  });
}

function _webResearchTopShadePointerUp(event) {
  const pointer = _webResearchTopShadePointer;
  const parts = _webResearchGetTopShadeParts();
  if (!pointer || pointer.pointerId !== event.pointerId) return;
  _webResearchClearTopShadeLongPress();
  parts?.handle.classList.remove('is-grabbing');
  parts?.handle.releasePointerCapture?.(event.pointerId);
  parts?.handle.removeEventListener('pointermove', _webResearchTopShadePointerMove);
  parts?.handle.removeEventListener('pointerup', _webResearchTopShadePointerUp);
  parts?.handle.removeEventListener('pointercancel', _webResearchTopShadePointerCancel);
  if (pointer.isDragging) {
    _webResearchTopShadeHandleFsm.dispatch('dragEnd', { clientX: event.clientX, clientY: event.clientY });
  } else if (!pointer.longPressTriggered) {
    _webResearchHandleTopShadeTap(event);
  }
}

function _webResearchTopShadePointerCancel(event) {
  const pointer = _webResearchTopShadePointer;
  const parts = _webResearchGetTopShadeParts();
  if (!pointer || pointer.pointerId !== event.pointerId) return;
  _webResearchClearTopShadeLongPress();
  parts?.handle.classList.remove('is-grabbing');
  parts?.handle.releasePointerCapture?.(event.pointerId);
  parts?.handle.removeEventListener('pointermove', _webResearchTopShadePointerMove);
  parts?.handle.removeEventListener('pointerup', _webResearchTopShadePointerUp);
  parts?.handle.removeEventListener('pointercancel', _webResearchTopShadePointerCancel);
  _webResearchTopShadeHandleFsm.dispatch('dragCancel', { clientX: event.clientX, clientY: event.clientY });
}

function _webResearchSplitPointerDown(event) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const parts = _webResearchGetSplitParts();
  if (!parts) return;
  event.preventDefault();
  event.stopPropagation();
  const startHeight = parts.synthesis.getBoundingClientRect().height;
  _webResearchClearSplitLongPress();
  _webResearchSplitPointer = {
    pointerId: event.pointerId,
    startY: event.clientY,
    startX: event.clientX,
    startHeight,
    isDragging: false,
    longPressTriggered: false,
    lastTap: _webResearchSplitPointer?.lastTap || null,
    longPressTimer: setTimeout(() => {
      if (!_webResearchSplitPointer || _webResearchSplitPointer.pointerId !== event.pointerId) return;
      _webResearchSplitPointer.longPressTriggered = true;
      _webResearchShadeHandleFsm.dispatch('longPress', {
        clientX: _webResearchSplitPointer.startX,
        clientY: _webResearchSplitPointer.startY,
      });
    }, WEB_RESEARCH_SPLIT_LONG_PRESS_MS),
  };
  parts.handle.classList.add('is-grabbing');
  parts.handle.setPointerCapture?.(event.pointerId);
  parts.handle.addEventListener('pointermove', _webResearchSplitPointerMove);
  parts.handle.addEventListener('pointerup', _webResearchSplitPointerUp);
  parts.handle.addEventListener('pointercancel', _webResearchSplitPointerCancel);
}

function _webResearchSplitPointerMove(event) {
  const pointer = _webResearchSplitPointer;
  if (!pointer || pointer.pointerId !== event.pointerId) return;
  const dy = event.clientY - pointer.startY;
  const dx = event.clientX - pointer.startX;
  const moved = Math.sqrt((dx * dx) + (dy * dy));
  if (moved > WEB_RESEARCH_SPLIT_LONG_PRESS_MOVE_PX) _webResearchClearSplitLongPress();
  if (!pointer.isDragging && moved > WEB_RESEARCH_SPLIT_DRAG_ACTIVATE_PX) {
    pointer.isDragging = true;
    _webResearchShadeHandleFsm.dispatch('dragStart', { clientX: event.clientX, clientY: event.clientY });
  }
  if (!pointer.isDragging) return;
  _webResearchShadeHandleFsm.dispatch('dragMove', {
    clientX: event.clientX,
    clientY: event.clientY,
    height: pointer.startHeight + dy,
  });
}

function _webResearchSplitPointerUp(event) {
  const pointer = _webResearchSplitPointer;
  const parts = _webResearchGetSplitParts();
  if (!pointer || pointer.pointerId !== event.pointerId) return;
  _webResearchClearSplitLongPress();
  parts?.handle.classList.remove('is-grabbing');
  parts?.handle.releasePointerCapture?.(event.pointerId);
  parts?.handle.removeEventListener('pointermove', _webResearchSplitPointerMove);
  parts?.handle.removeEventListener('pointerup', _webResearchSplitPointerUp);
  parts?.handle.removeEventListener('pointercancel', _webResearchSplitPointerCancel);
  if (pointer.isDragging) {
    _webResearchClampVisibleSplitHandle(true);
    _webResearchShadeHandleFsm.dispatch('dragEnd', { clientX: event.clientX, clientY: event.clientY });
  } else if (!pointer.longPressTriggered) {
    _webResearchHandleSplitTap(event);
  }
}

function _webResearchSplitPointerCancel(event) {
  const pointer = _webResearchSplitPointer;
  const parts = _webResearchGetSplitParts();
  if (!pointer || pointer.pointerId !== event.pointerId) return;
  _webResearchClearSplitLongPress();
  parts?.handle.classList.remove('is-grabbing');
  parts?.handle.releasePointerCapture?.(event.pointerId);
  parts?.handle.removeEventListener('pointermove', _webResearchSplitPointerMove);
  parts?.handle.removeEventListener('pointerup', _webResearchSplitPointerUp);
  parts?.handle.removeEventListener('pointercancel', _webResearchSplitPointerCancel);
  _webResearchShadeHandleFsm.dispatch('dragCancel', { clientX: event.clientX, clientY: event.clientY });
}

function _webResearchSplitKeydown(event) {
  const parts = _webResearchGetSplitParts();
  if (!parts) return;
  const current = parts.synthesis.getBoundingClientRect().height;
  const total = _webResearchSplitTotal(parts);
  let next = current;
  if (event.key === 'ArrowUp') next = current - 32;
  else if (event.key === 'ArrowDown') next = current + 32;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = total;
  else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    _webResearchShadeHandleFsm.dispatch('tap');
    return;
  } else {
    return;
  }
  event.preventDefault();
  _webResearchShadeHandleFsm.dispatch('keyResize', { height: next, key: event.key });
}

function _webResearchTopShadeKeydown(event) {
  const parts = _webResearchGetTopShadeParts();
  if (!parts) return;
  const current = parts.controls.getBoundingClientRect().height;
  const max = _webResearchGetControlsMaxHeight();
  let next = current;
  if (event.key === 'ArrowUp') next = current - 32;
  else if (event.key === 'ArrowDown') next = current + 32;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = max;
  else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    _webResearchTopShadeHandleFsm.dispatch('tap');
    return;
  } else {
    return;
  }
  event.preventDefault();
  _webResearchTopShadeHandleFsm.dispatch('keyResize', { height: next, key: event.key });
}

function openWebResearchModal(options = {}) {
  _webResearchLoadState();
  _webResearchControlsRatio = 1;
  if (typeof options.query === 'string' && options.query.trim()) {
    _webResearchState.query = options.query.trim();
  }
  _webResearchSetForm();
  _webResearchRenderPrivacyToggle();
  _webResearchRender();
  const modal = document.getElementById('web-research-modal');
  if (!modal || typeof HubModal === 'undefined') return;
  HubModal.open(modal, {
    onOpen: () => {
      const input = document.getElementById('web-research-query');
      if (input) {
        input.focus();
        input.select();
      }
      _webResearchInitTopShade();
      _webResearchQueueTopShadeSync();
      _webResearchQueueSplitSync();
      _webResearchLoadEgressIp(false);
    },
  });
}

async function _webResearchRun() {
  if (_webResearchInFlight) return;
  _webResearchReadForm();
  if (!_webResearchState.query) {
    _webResearchSetStatus('Enter a web research query.', true);
    return;
  }
  const cached = _webResearchState.privateMode ? null : _webResearchState.recent?.[_webResearchOptionKey()];
  if (cached && typeof cached === 'object') {
    _webResearchState.result = cached;
    _webResearchState.searchedAt = cached.searched_at || _webResearchState.searchedAt;
    _webResearchSaveState();
    _webResearchRender();
  }
  _webResearchSetBusy(true);
  _webResearchSetStatus('Researching...', false);
  try {
    const response = await apiFetch('/api/v1/web-research/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: _webResearchState.query,
        depth: _webResearchState.depth,
        private_mode: !!_webResearchState.privateMode,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
    data.searched_at = new Date().toISOString();
    _webResearchState.result = data;
    _webResearchState.searchedAt = data.searched_at;
    _webResearchState.recent = _webResearchState.recent || {};
    if (!_webResearchState.privateMode) {
      _webResearchState.recent[_webResearchOptionKey()] = data;
    }
    _webResearchSaveState();
    _webResearchRender();
  } catch (e) {
    _webResearchSetStatus(`Web research failed: ${e.message || e}`, true);
  } finally {
    _webResearchSetBusy(false);
  }
}

function _webResearchClear() {
  _webResearchSpeechStop();
  const depth = _webResearchState.depth || 'standard';
  const splitRatio = Number.isFinite(_webResearchState.splitRatio)
    ? _webResearchState.splitRatio
    : WEB_RESEARCH_SPLIT_DEFAULT_RATIO;
  const privateMode = !!_webResearchState.privateMode;
  try {
    localStorage.removeItem(WEB_RESEARCH_LS_KEY);
  } catch {
    // Best-effort cleanup; the visible modal state is still reset below.
  }
  _webResearchState = {
    query: '',
    depth,
    result: null,
    recent: {},
    searchedAt: null,
    schema: WEB_RESEARCH_STATE_SCHEMA,
    splitRatio,
    privateMode,
  };
  _webResearchSetForm();
  _webResearchSaveState();
  _webResearchRender();
  _webResearchSetStatus('', false);
  _webResearchRenderPrivacyToggle();
}

function _webResearchSpeechSetState(state = 'IDLE', message = '') {
  const clean = ['IDLE', 'SPEAKING', 'PAUSED'].includes(state) ? state : 'IDLE';
  _webResearchSpeechState = clean;
  const btn = document.getElementById('web-research-speaker');
  const status = document.getElementById('web-research-tts-status');
  const isSpeaking = clean === 'SPEAKING';
  const isPaused = clean === 'PAUSED';
  if (btn) {
    btn.classList.toggle('is-idle', clean === 'IDLE');
    btn.classList.toggle('is-speaking', isSpeaking);
    btn.classList.toggle('is-paused', isPaused);
    btn.classList.toggle('is-generating', /generat|prepar/i.test(String(message || '')));
    btn.setAttribute('aria-pressed', isSpeaking ? 'true' : 'false');
    const label = isPaused ? 'Resume web research audio' : (isSpeaking ? 'Pause web research audio' : 'Speak web research');
    btn.setAttribute('aria-label', label);
    btn.title = `${label}; long press regenerates narration`;
  }
  if (status) status.textContent = message;
}

function _webResearchSpeechSyncState() {
  const btn = document.getElementById('web-research-speaker');
  if (!btn) {
    _webResearchSpeechState = 'IDLE';
    return _webResearchSpeechState;
  }
  if (btn.classList.contains('is-speaking')) _webResearchSpeechState = 'SPEAKING';
  else if (btn.classList.contains('is-paused')) _webResearchSpeechState = 'PAUSED';
  else _webResearchSpeechState = 'IDLE';
  return _webResearchSpeechState;
}

function _webResearchSpeechClearClickTimer() {
  if (!_webResearchSpeechClickTimer) return;
  clearTimeout(_webResearchSpeechClickTimer);
  _webResearchSpeechClickTimer = null;
}

function _webResearchSpeechClearLongPressTimer() {
  if (!_webResearchSpeechLongPressTimer) return;
  clearTimeout(_webResearchSpeechLongPressTimer);
  _webResearchSpeechLongPressTimer = null;
}

function _webResearchSpeechResetClassifiers() {
  _webResearchSpeechClearClickTimer();
  _webResearchSpeechClearLongPressTimer();
  _webResearchSpeechLastClickAt = 0;
}

async function _webResearchSpeechStopClient() {
  if (typeof BlueprintsTtsClient !== 'undefined' && typeof BlueprintsTtsClient.stop === 'function') {
    try {
      await BlueprintsTtsClient.stop();
    } catch (e) {
      console.warn('web research narration: failed to stop TTS', e);
    }
  }
}

async function _webResearchSpeechStop() {
  _webResearchSpeechResetClassifiers();
  _webResearchSpeechRunId += 1;
  _webResearchSpeechSetState('IDLE', '');
  await _webResearchSpeechStopClient();
}

async function _webResearchSpeechPause() {
  if (typeof BlueprintsTtsClient === 'undefined' || typeof BlueprintsTtsClient.pause !== 'function') {
    await _webResearchSpeechStop();
    return;
  }
  try {
    const result = await BlueprintsTtsClient.pause();
    if (result?.paused) {
      _webResearchSpeechSetState('PAUSED', '');
      return;
    }
  } catch (e) {
    console.warn('web research narration: failed to pause TTS', e);
  }
  await _webResearchSpeechStop();
}

async function _webResearchSpeechResume() {
  if (typeof BlueprintsTtsClient === 'undefined' || typeof BlueprintsTtsClient.resume !== 'function') {
    await _webResearchSpeechStop();
    return;
  }
  try {
    const result = await BlueprintsTtsClient.resume();
    if (result?.resumed) {
      _webResearchSpeechSetState('SPEAKING', '');
      return;
    }
  } catch (e) {
    console.warn('web research narration: failed to resume TTS', e);
  }
  await _webResearchSpeechStop();
}

async function _webResearchSpeechMarkdown(force = false) {
  const result = _webResearchState.result;
  const display = result?.display && typeof result.display === 'object' ? result.display : {};
  if (!result || !display.summary_markdown) throw new Error('Run web research before starting audio.');
  _webResearchSpeechSetState('SPEAKING', force ? 'Regenerating...' : 'Preparing...');
  const response = await apiFetch('/api/v1/web-research/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cache_key: result.cache_key || null,
      query: result.query || _webResearchState.query,
      depth: _webResearchState.depth,
      markdown: display.summary_markdown,
      display,
      force_refresh: !!force,
      private_mode: !!result.private_mode || !!_webResearchState.privateMode,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
  const markdown = String(data.markdown || display.audio_markdown || '').trim();
  if (!markdown) throw new Error('Narration was empty.');
  if (data.cache_key && result.cache_key !== data.cache_key && !result.private_mode) {
    result.cache_key = data.cache_key;
    _webResearchSaveState();
  }
  return markdown;
}

async function _webResearchSpeechStart(force = false) {
  if (typeof BlueprintsTtsClient === 'undefined' || typeof BlueprintsTtsClient.speak !== 'function') {
    _webResearchSpeechSetState('IDLE', 'TTS unavailable.');
    return;
  }
  const runId = _webResearchSpeechRunId + 1;
  _webResearchSpeechRunId = runId;
  await _webResearchSpeechStopClient();
  if (runId !== _webResearchSpeechRunId) return;
  _webResearchSpeechSetState('SPEAKING', force ? 'Regenerating...' : 'Preparing...');
  try {
    const text = await _webResearchSpeechMarkdown(force);
    if (runId !== _webResearchSpeechRunId) return;
    _webResearchSpeechSetState('SPEAKING', '');
    await BlueprintsTtsClient.speak({
      text,
      mode: 'stream',
      sanitizeText: true,
      transformProfile: 'speech',
      interrupt: true,
      eventKind: 'web_research_narration',
      fallbackKind: 'neutral',
    });
  } catch (e) {
    if (e?.name === 'AbortError') {
      if (runId === _webResearchSpeechRunId) _webResearchSpeechSetState('IDLE', '');
      return;
    }
    console.warn('web research narration: TTS failed', e);
    if (runId === _webResearchSpeechRunId) _webResearchSpeechSetState('IDLE', `TTS failed: ${e.message || e}`);
    return;
  }
  if (runId === _webResearchSpeechRunId) _webResearchSpeechSetState('IDLE', '');
}

const _webResearchSpeechFsm = (() => {
  const transitions = {
    IDLE: {
      tap: { actions: ['start'] },
      doubleTap: { actions: ['stop'] },
      longPress: { actions: ['regenerate'] },
    },
    SPEAKING: {
      tap: { actions: ['pause'] },
      doubleTap: { actions: ['stop'] },
      longPress: { actions: ['regenerate'] },
    },
    PAUSED: {
      tap: { actions: ['resume'] },
      doubleTap: { actions: ['stop'] },
      longPress: { actions: ['regenerate'] },
    },
  };

  async function execute(action) {
    if (action === 'start') return _webResearchSpeechStart(false);
    if (action === 'regenerate') return _webResearchSpeechStart(true);
    if (action === 'pause') return _webResearchSpeechPause();
    if (action === 'resume') return _webResearchSpeechResume();
    if (action === 'stop') return _webResearchSpeechStop();
    return undefined;
  }

  async function dispatch(event) {
    const state = _webResearchSpeechSyncState();
    const transition = transitions[state]?.[event];
    if (!transition) return;
    for (const action of transition.actions) await execute(action);
  }

  return { dispatch };
})();

function _webResearchSpeechHandleClick() {
  if (Date.now() - _webResearchSpeechLastLongPressAt < 700) return;
  _webResearchSpeechClearClickTimer();
  const now = Date.now();
  if (
    _webResearchSpeechLastClickAt
    && (now - _webResearchSpeechLastClickAt) <= WEB_RESEARCH_DOUBLE_CLICK_MS
  ) {
    _webResearchSpeechLastClickAt = 0;
    _webResearchSpeechFsm.dispatch('doubleTap');
    return;
  }
  _webResearchSpeechLastClickAt = now;
  _webResearchSpeechClickTimer = setTimeout(() => {
    _webResearchSpeechClickTimer = null;
    _webResearchSpeechLastClickAt = 0;
    _webResearchSpeechFsm.dispatch('tap');
  }, WEB_RESEARCH_DOUBLE_CLICK_MS);
}

async function _webResearchSpeechHandleDoubleClick() {
  _webResearchSpeechResetClassifiers();
  await _webResearchSpeechFsm.dispatch('doubleTap');
}

function _webResearchSpeechHandlePointerDown(event) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  _webResearchSpeechClearLongPressTimer();
  _webResearchSpeechLongPressTimer = setTimeout(() => {
    _webResearchSpeechLongPressTimer = null;
    _webResearchSpeechLastLongPressAt = Date.now();
    _webResearchSpeechResetClassifiers();
    _webResearchSpeechFsm.dispatch('longPress');
  }, WEB_RESEARCH_LONG_PRESS_MS);
}

function _webResearchBindSpeaker() {
  const speaker = document.getElementById('web-research-speaker');
  if (!speaker || speaker.dataset.webResearchSpeechBound === '1') return;
  speaker.dataset.webResearchSpeechBound = '1';
  speaker.addEventListener('pointerdown', e => {
    e.stopPropagation();
    _webResearchSpeechHandlePointerDown(e);
  });
  speaker.addEventListener('pointerup', e => {
    e.stopPropagation();
    _webResearchSpeechClearLongPressTimer();
  });
  speaker.addEventListener('pointercancel', _webResearchSpeechClearLongPressTimer);
  speaker.addEventListener('pointerleave', _webResearchSpeechClearLongPressTimer);
  speaker.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
  });
  speaker.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    _webResearchSpeechHandleClick();
  });
  speaker.addEventListener('dblclick', e => {
    e.preventDefault();
    e.stopPropagation();
    _webResearchSpeechHandleDoubleClick();
  });
  _webResearchSpeechSetState(_webResearchSpeechState, '');
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('web-research-form');
  form?.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    _webResearchRun();
  }, true);
  form?.addEventListener('submit', e => {
    e.preventDefault();
    e.stopPropagation();
    _webResearchRun();
  });
  document.getElementById('web-research-clear')?.addEventListener('click', e => {
    e.preventDefault();
    _webResearchClear();
  });
  document.getElementById('web-research-ip-box')?.addEventListener('click', e => {
    e.preventDefault();
    _webResearchLoadEgressIp(true);
  });
  const privateToggle = document.getElementById('web-research-private-toggle');
  privateToggle?.addEventListener('pointerdown', _webResearchPrivacyPointerDown);
  privateToggle?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    _webResearchPrivacyHandleClick(e);
  });
  privateToggle?.addEventListener('dblclick', e => {
    e.preventDefault();
    e.stopPropagation();
    _webResearchClearPrivacyClickTimer();
    _webResearchPrivacyLastClickAt = 0;
    _webResearchPrivacyKeyFsm.dispatch('doubleTap', { clientX: e.clientX, clientY: e.clientY });
  });
  privateToggle?.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
  });
  privateToggle?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      _webResearchPrivacyKeyFsm.dispatch('tap');
    } else if (e.key === '?') {
      e.preventDefault();
      _webResearchPrivacyKeyFsm.dispatch('longPress');
    }
  });
  document.getElementById('web-research-privacy-doc')?.addEventListener('click', e => {
    const link = e.target.closest('[data-docs-preview-link]');
    if (!link) return;
    if (typeof docsOpenByPath !== 'function') {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    docsOpenByPath(link.dataset.docsPreviewLink || '');
  });
  ['web-research-depth'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      _webResearchReadForm();
      _webResearchSaveState();
    });
  });
  _webResearchBindSpeaker();
  _webResearchInitTopShade();
  _webResearchRenderEgressIp();
  _webResearchRenderPrivacyToggle();
  window.addEventListener('resize', _webResearchQueueSplitSync);
  window.addEventListener('resize', _webResearchQueueTopShadeSync);
  window.visualViewport?.addEventListener('resize', _webResearchQueueSplitSync);
  window.visualViewport?.addEventListener('resize', _webResearchQueueTopShadeSync);
});

window.openWebResearchModal = openWebResearchModal;
