/* Blueprints public web research modal. */

'use strict';

const WEB_RESEARCH_LS_KEY = 'bp_web_research_v1';
const WEB_RESEARCH_DOUBLE_CLICK_MS = 260;
const WEB_RESEARCH_LONG_PRESS_MS = 650;

let _webResearchState = {
  query: '',
  depth: 'standard',
  result: null,
  recent: {},
  searchedAt: null,
};
let _webResearchInFlight = false;
let _webResearchSpeechState = 'IDLE';
let _webResearchSpeechRunId = 0;
let _webResearchSpeechClickTimer = null;
let _webResearchSpeechLastClickAt = 0;
let _webResearchSpeechLongPressTimer = null;
let _webResearchSpeechLastLongPressAt = 0;

function _webResearchEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
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
    _webResearchState = {
      ..._webResearchState,
      query: String(raw.query || ''),
      depth: ['quick', 'standard', 'deep'].includes(raw.depth) ? raw.depth : 'standard',
      result: raw.result && typeof raw.result === 'object' ? raw.result : null,
      recent: raw.recent && typeof raw.recent === 'object' ? raw.recent : {},
      searchedAt: raw.searchedAt || null,
    };
  } catch {
    localStorage.removeItem(WEB_RESEARCH_LS_KEY);
  }
}

function _webResearchSaveState() {
  const recentEntries = Object.entries(_webResearchState.recent || {}).slice(-8);
  localStorage.setItem(WEB_RESEARCH_LS_KEY, JSON.stringify({
    query: _webResearchState.query,
    depth: _webResearchState.depth,
    result: _webResearchState.result,
    recent: Object.fromEntries(recentEntries),
    searchedAt: _webResearchState.searchedAt,
  }));
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
    panel.innerHTML = '<div class="web-research-empty">No research yet.</div>';
    _webResearchSetStatus('', false);
    return;
  }
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
    <section class="web-research-answer">
      <div class="web-research-answer-head">
        <strong>${_webResearchEsc(result.query || _webResearchState.query || 'Research')}</strong>
        <span class="web-research-pill ${result.ok ? 'ok' : ''}">${_webResearchEsc(result.status || 'succeeded')}</span>
        <span class="web-research-pill">${_webResearchEsc(result.depth || _webResearchState.depth || 'standard')}</span>
      </div>
      <pre class="web-research-markdown bp-font-role-docs-markdown">${_webResearchEsc(markdown || 'No summary returned.')}</pre>
    </section>
    <section class="web-research-sources">
      <div class="web-research-section-title">Sources</div>
      ${sourceRows}
    </section>
    ${warningsHtml}
    ${firewallHtml}
  `;
  _webResearchSetStatus(result.ok === false ? `Research failed. ${sourceStatus} returned.` : `${sourceStatus} returned.`, result.ok === false);
}

function openWebResearchModal(options = {}) {
  _webResearchLoadState();
  if (typeof options.query === 'string' && options.query.trim()) {
    _webResearchState.query = options.query.trim();
  }
  _webResearchSetForm();
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
  const cached = _webResearchState.recent?.[_webResearchOptionKey()];
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
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
    data.searched_at = new Date().toISOString();
    _webResearchState.result = data;
    _webResearchState.searchedAt = data.searched_at;
    _webResearchState.recent = _webResearchState.recent || {};
    _webResearchState.recent[_webResearchOptionKey()] = data;
    _webResearchSaveState();
    _webResearchRender();
  } catch (e) {
    _webResearchSetStatus(`Web research failed: ${e.message || e}`, true);
  } finally {
    _webResearchSetBusy(false);
  }
}

function _webResearchClear() {
  _webResearchState.result = null;
  _webResearchState.query = '';
  _webResearchState.searchedAt = null;
  _webResearchSetForm();
  _webResearchSaveState();
  _webResearchRender();
  _webResearchSetStatus('', false);
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
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
  const markdown = String(data.markdown || display.audio_markdown || '').trim();
  if (!markdown) throw new Error('Narration was empty.');
  if (data.cache_key && result.cache_key !== data.cache_key) {
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

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('web-research-form');
  form?.addEventListener('submit', e => {
    e.preventDefault();
    _webResearchRun();
  });
  document.getElementById('web-research-clear')?.addEventListener('click', e => {
    e.preventDefault();
    _webResearchClear();
  });
  ['web-research-depth'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      _webResearchReadForm();
      _webResearchSaveState();
    });
  });
  const speaker = document.getElementById('web-research-speaker');
  speaker?.addEventListener('pointerdown', e => {
    e.stopPropagation();
    _webResearchSpeechHandlePointerDown(e);
  });
  speaker?.addEventListener('pointerup', e => {
    e.stopPropagation();
    _webResearchSpeechClearLongPressTimer();
  });
  speaker?.addEventListener('pointercancel', _webResearchSpeechClearLongPressTimer);
  speaker?.addEventListener('pointerleave', _webResearchSpeechClearLongPressTimer);
  speaker?.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
  });
  speaker?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    _webResearchSpeechHandleClick();
  });
  speaker?.addEventListener('dblclick', e => {
    e.preventDefault();
    e.stopPropagation();
    _webResearchSpeechHandleDoubleClick();
  });
});

window.openWebResearchModal = openWebResearchModal;
