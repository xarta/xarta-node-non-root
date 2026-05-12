/* ── Local Dockge ──────────────────────────────────────────────────────── */

const _LOCAL_DOCKGE_POLL_MS = 7000;
const _LOCAL_DOCKGE_COLS = ['stack', 'services', 'containers', 'status_health', 'updated', 'actions'];
const _LOCAL_DOCKGE_FIELD_META = {
  stack: { label: 'Stack' },
  services: { label: 'Services' },
  containers: { label: 'Containers' },
  status_health: { label: 'Status<br>Health' },
  updated: { label: 'Updated' },
  actions: { label: 'Actions' },
};
let _localDockgeTableView = null;
let _localDockgeNarrationState = 'IDLE';
let _localDockgeNarrationStack = null;
let _localDockgeNarrationRunId = 0;
let _localDockgeNarrationClickTimer = null;
let _localDockgeNarrationLastClickAt = 0;
let _localDockgeNarrationLongPressTimer = null;
let _localDockgeNarrationLastLongPressAt = 0;
let _localDockgeDownloadBusyStack = null;
const _LOCAL_DOCKGE_NARRATION_DOUBLE_CLICK_MS = 260;
const _LOCAL_DOCKGE_NARRATION_LONG_PRESS_MS = 650;

function _ensureLocalDockgeTableView() {
  if (_localDockgeTableView || typeof TableView === 'undefined') return _localDockgeTableView;
  _localDockgeTableView = TableView.create({
    storageKey: 'local-dockge-table-widths',
    columns: _LOCAL_DOCKGE_COLS,
    meta: _LOCAL_DOCKGE_FIELD_META,
    getTable: () => document.getElementById('local-dockge-table'),
    fallbackColumn: 'stack',
    minWidth: 54,
    getDefaultWidth: col => {
      if (col === 'stack') return 150;
      if (col === 'services') return 230;
      if (col === 'containers') return 270;
      if (col === 'status_health') return 104;
      if (col === 'updated') return 112;
      if (col === 'actions') return 136;
      return null;
    },
  });
  return _localDockgeTableView;
}

function _localDockgeIsActive() {
  return document.getElementById('tab-local-dockge')?.classList.contains('active');
}

function _localDockgeStatusTone(status) {
  const text = String(status || '').toLowerCase();
  if (text === 'running' || text === 'healthy') return 'var(--ok,#3fb950)';
  if (text === 'partial' || text === 'starting' || text === 'mixed') return 'var(--warn,#e6a817)';
  if (text === 'stopped' || text === 'none') return 'var(--text-dim)';
  if (text === 'unhealthy' || text === 'unknown') return 'var(--err,#f85149)';
  return 'var(--text-dim)';
}

function _localDockgeBadge(value) {
  const label = value || 'unknown';
  return `<span style="display:inline-block;border:1px solid currentColor;border-radius:6px;padding:2px 7px;font-size:11px;color:${_localDockgeStatusTone(label)}">${esc(label)}</span>`;
}

function _localDockgeContainerTone(container) {
  const health = String(container?.health || '').toLowerCase();
  const state = String(container?.state || '').toLowerCase();
  if (health === 'healthy') return 'ok';
  if (health === 'unhealthy') return 'error';
  if (health === 'starting' || state === 'restarting' || state === 'starting') return 'warn';
  if (state === 'running') return health ? 'warn' : 'unknown';
  if (state === 'exited' || state === 'dead' || state === 'removing') return 'error';
  if (state === 'created' || state === 'paused') return 'warn';
  if (state === 'stopped' || state === 'none') return 'stopped';
  return 'unknown';
}

function _localDockgeRenderContainerChip(container) {
  const label = container.name || container.service || container.id || '-';
  const state = container.state || 'unknown';
  const health = container.health || '';
  const status = container.status || '';
  const tone = _localDockgeContainerTone(container);
  const titleParts = [`state: ${state}`];
  if (health) titleParts.push(`health: ${health}`);
  if (status) titleParts.push(status);
  return (
    `<span class="ip-chip local-dockge-container-chip local-dockge-container-chip--${esc(tone)}" ` +
    `title="${esc(titleParts.join(' | '))}">${esc(label)}:${esc(state)}</span>`
  );
}

function _localDockgeFormatTime(value) {
  if (!value) return '-';
  return String(value).replace('T', ' ').replace(/\.\d+.*$/, '').replace('+00:00', '').slice(0, 19);
}

function _localDockgeFormatUpdatedHtml(value) {
  const text = _localDockgeFormatTime(value);
  if (text === '-') return '<span class="local-dockge-updated">-</span>';
  const [date, time] = text.split(' ');
  return `<span class="local-dockge-updated"><span>${esc(date || text)}</span>${time ? `<span>${esc(time)}</span>` : ''}</span>`;
}

function _localDockgeFilterRows(stacks) {
  const q = (document.getElementById('local-dockge-search')?.value || '').trim().toLowerCase();
  if (!q) return stacks;
  return stacks.filter(stack => {
    const haystack = [
      stack.stack_name,
      stack.status,
      stack.health,
      ...(stack.services || []),
      ...Object.values(stack.service_exposures || {}).map(e => `${e.kind || ''} ${e.url || ''} ${e.description || ''}`),
      ...(stack.containers || []).map(c => `${c.name || ''} ${c.service || ''} ${c.image || ''} ${c.state || ''} ${c.health || ''}`),
    ].join(' ').toLowerCase();
    return haystack.includes(q);
  });
}

function _localDockgeActionButtons(stack) {
  const name = esc(stack.stack_name || '');
  const status = String(stack.status || 'unknown').toLowerCase();
  const buttons = [];
  if (status === 'running' || status === 'partial') {
    buttons.push(`<button class="secondary table-icon-btn table-icon-btn--restart" type="button" title="Restart stack" aria-label="Restart stack" data-local-dockge-action="restart" data-local-dockge-stack="${name}"></button>`);
    buttons.push(`<button class="secondary table-icon-btn table-icon-btn--power-stop" type="button" title="Stop stack" aria-label="Stop stack" data-local-dockge-action="stop" data-local-dockge-stack="${name}"></button>`);
  } else if (status === 'stopped') {
    buttons.push(`<button class="secondary table-icon-btn table-icon-btn--power-start" type="button" title="Start stack" aria-label="Start stack" data-local-dockge-action="start" data-local-dockge-stack="${name}"></button>`);
  } else {
    buttons.push(`<button class="secondary table-icon-btn table-icon-btn--restart" type="button" title="Refresh before acting on this stack" aria-label="Stack action unavailable" disabled></button>`);
  }
  buttons.push(`<button class="secondary table-icon-btn table-icon-btn--speaker local-dockge-narration-btn is-idle" type="button"
      title="Speak stack condition; long press regenerates narration"
      aria-label="Speak ${name} stack condition"
      aria-pressed="false"
      data-local-dockge-narrate-stack="${name}"></button>`);
  buttons.push(`<button class="secondary table-icon-btn table-icon-btn--speaker local-dockge-download-btn" type="button"
      title="Generate and download MP3 narration"
      aria-label="Generate and download ${name} MP3 narration"
      data-local-dockge-download-stack="${name}"></button>`);
  return `<div class="table-inline-actions">${buttons.join('')}</div>`;
}

function _localDockgeNarrationButtons() {
  return Array.from(document.querySelectorAll('[data-local-dockge-narrate-stack]'));
}

function _localDockgeDownloadButtons() {
  return Array.from(document.querySelectorAll('[data-local-dockge-download-stack]'));
}

function _localDockgeNarrationRenderButtons(message = '') {
  const activeStack = _localDockgeNarrationStack;
  const state = _localDockgeNarrationState;
  _localDockgeNarrationButtons().forEach(btn => {
    const isActive = activeStack && btn.dataset.localDockgeNarrateStack === activeStack;
    const clean = isActive ? state : 'IDLE';
    const isSpeaking = clean === 'SPEAKING';
    const isPaused = clean === 'PAUSED';
    btn.classList.toggle('is-idle', clean === 'IDLE');
    btn.classList.toggle('is-speaking', isSpeaking);
    btn.classList.toggle('is-paused', isPaused);
    btn.classList.toggle('is-generating', isActive && /generat|prepar/i.test(String(message || '')));
    btn.setAttribute('aria-pressed', isSpeaking ? 'true' : 'false');
    const stackName = btn.dataset.localDockgeNarrateStack || 'stack';
    const label = isPaused
      ? `Resume ${stackName} stack audio`
      : (isSpeaking ? `Pause ${stackName} stack audio` : `Speak ${stackName} stack condition`);
    btn.setAttribute('aria-label', label);
    btn.title = `${label}; long press regenerates narration`;
  });
}

function _localDockgeDownloadRenderButtons() {
  const busyStack = _localDockgeDownloadBusyStack;
  _localDockgeDownloadButtons().forEach(btn => {
    const stackName = btn.dataset.localDockgeDownloadStack || 'stack';
    const busy = Boolean(busyStack && stackName === busyStack);
    btn.disabled = busy;
    btn.classList.toggle('is-generating', busy);
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    btn.setAttribute('aria-label', busy
      ? `Generating ${stackName} MP3 narration`
      : `Generate and download ${stackName} MP3 narration`);
    btn.title = busy ? 'Generating MP3 narration...' : 'Generate and download MP3 narration';
  });
}

function _localDockgeRenderActionButtonStates(message = '') {
  _localDockgeNarrationRenderButtons(message);
  _localDockgeDownloadRenderButtons();
}

function _localDockgeNarrationSetState(stackName, state = 'IDLE', message = '') {
  const clean = ['IDLE', 'SPEAKING', 'PAUSED'].includes(state) ? state : 'IDLE';
  _localDockgeNarrationState = clean;
  _localDockgeNarrationStack = clean === 'IDLE' && !message ? null : stackName;
  _localDockgeRenderActionButtonStates(message);
  const status = document.getElementById('local-dockge-status');
  if (status && message) {
    status.textContent = message;
    status.style.color = 'var(--text-dim)';
    status.hidden = false;
  }
}

function _localDockgeNarrationClearClickTimer() {
  if (!_localDockgeNarrationClickTimer) return;
  clearTimeout(_localDockgeNarrationClickTimer);
  _localDockgeNarrationClickTimer = null;
}

function _localDockgeNarrationClearLongPressTimer() {
  if (!_localDockgeNarrationLongPressTimer) return;
  clearTimeout(_localDockgeNarrationLongPressTimer);
  _localDockgeNarrationLongPressTimer = null;
}

function _localDockgeNarrationResetClassifiers() {
  _localDockgeNarrationClearClickTimer();
  _localDockgeNarrationClearLongPressTimer();
  _localDockgeNarrationLastClickAt = 0;
}

async function _localDockgeNarrationStopClient() {
  if (typeof BlueprintsTtsClient !== 'undefined' && typeof BlueprintsTtsClient.stop === 'function') {
    try {
      await BlueprintsTtsClient.stop();
    } catch (e) {
      console.warn('local Dockge narration: failed to stop TTS', e);
    }
  }
}

async function _localDockgeNarrationStop() {
  const stackName = _localDockgeNarrationStack;
  _localDockgeNarrationResetClassifiers();
  _localDockgeNarrationRunId += 1;
  _localDockgeNarrationSetState(stackName, 'IDLE', '');
  await _localDockgeNarrationStopClient();
}

async function _localDockgeNarrationPause() {
  if (typeof BlueprintsTtsClient === 'undefined' || typeof BlueprintsTtsClient.pause !== 'function') {
    await _localDockgeNarrationStop();
    return;
  }
  try {
    const result = await BlueprintsTtsClient.pause();
    if (result?.paused) {
      _localDockgeNarrationSetState(_localDockgeNarrationStack, 'PAUSED', '');
      return;
    }
  } catch (e) {
    console.warn('local Dockge narration: failed to pause TTS', e);
  }
  await _localDockgeNarrationStop();
}

async function _localDockgeNarrationResume() {
  if (typeof BlueprintsTtsClient === 'undefined' || typeof BlueprintsTtsClient.resume !== 'function') {
    await _localDockgeNarrationStop();
    return;
  }
  try {
    const result = await BlueprintsTtsClient.resume();
    if (result?.resumed) {
      _localDockgeNarrationSetState(_localDockgeNarrationStack, 'SPEAKING', '');
      return;
    }
  } catch (e) {
    console.warn('local Dockge narration: failed to resume TTS', e);
  }
  await _localDockgeNarrationStop();
}

async function _localDockgeNarrationMarkdown(stackName, force = false) {
  _localDockgeNarrationSetState(stackName, 'SPEAKING', force ? `Regenerating ${stackName} narration...` : `Preparing ${stackName} narration...`);
  return _localDockgeFetchNarrationMarkdown(stackName, force);
}

async function _localDockgeFetchNarrationMarkdown(stackName, force = false) {
  const r = await apiFetch(`/api/v1/local-dockge/stacks/${encodeURIComponent(stackName)}/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
  const markdown = String(data.markdown || '').trim();
  if (!markdown) throw new Error('Narration was empty.');
  return markdown;
}

function _localDockgeDownloadFilename(stackName, contentType) {
  const safe = String(stackName || 'stack').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'stack';
  const ext = String(contentType || '').includes('wav') ? 'wav' : 'mp3';
  return `local-dockge-${safe}-narration.${ext}`;
}

function _localDockgeSetDownloadButtonState(btn, busy) {
  if (btn) {
    btn.disabled = busy;
    btn.classList.toggle('is-generating', busy);
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    btn.title = busy ? 'Generating MP3 narration...' : 'Generate and download MP3 narration';
  }
  _localDockgeDownloadRenderButtons();
}

async function _localDockgeDownloadNarrationMp3(stackName, btn) {
  if (!stackName || _localDockgeDownloadBusyStack) return;
  if (typeof BlueprintsTtsClient === 'undefined' || typeof BlueprintsTtsClient.synthesize !== 'function') {
    const status = document.getElementById('local-dockge-status');
    if (status) {
      status.textContent = 'TTS download unavailable.';
      status.style.color = 'var(--err,#f85149)';
      status.hidden = false;
    }
    return;
  }

  _localDockgeDownloadBusyStack = stackName;
  _localDockgeSetDownloadButtonState(btn, true);
  const status = document.getElementById('local-dockge-status');
  if (status) {
    status.textContent = `Generating ${stackName} MP3 narration...`;
    status.style.color = 'var(--text-dim)';
    status.hidden = false;
  }

  try {
    const text = await _localDockgeFetchNarrationMarkdown(stackName, false);
    const result = await BlueprintsTtsClient.synthesize({
      text,
      interrupt: false,
      mode: 'batch',
      format: 'mp3',
      timeoutMs: 360000,
      allowFallback: false,
      eventKind: 'local_dockge_stack_narration_download',
      fallbackKind: 'positive',
      sanitizeText: false,
      transformProfile: 'none',
    });
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = _localDockgeDownloadFilename(stackName, result.contentType);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (status) {
      status.textContent = `Downloaded ${stackName} narration.`;
      status.style.color = 'var(--ok,#3fb950)';
    }
  } catch (e) {
    if (status) {
      status.textContent = `MP3 generation failed: ${e.message || e}`;
      status.style.color = 'var(--err,#f85149)';
      status.hidden = false;
    }
  } finally {
    _localDockgeDownloadBusyStack = null;
    _localDockgeSetDownloadButtonState(btn, false);
  }
}

async function _localDockgeNarrationStart(stackName, force = false) {
  if (!stackName) return;
  if (typeof BlueprintsTtsClient === 'undefined' || typeof BlueprintsTtsClient.speak !== 'function') {
    _localDockgeNarrationSetState(stackName, 'IDLE', 'TTS unavailable.');
    return;
  }
  const runId = _localDockgeNarrationRunId + 1;
  _localDockgeNarrationRunId = runId;
  await _localDockgeNarrationStopClient();
  if (runId !== _localDockgeNarrationRunId) return;
  _localDockgeNarrationSetState(stackName, 'SPEAKING', force ? `Regenerating ${stackName} narration...` : `Preparing ${stackName} narration...`);
  try {
    const text = await _localDockgeNarrationMarkdown(stackName, force);
    if (runId !== _localDockgeNarrationRunId) return;
    _localDockgeNarrationSetState(stackName, 'SPEAKING', '');
    await BlueprintsTtsClient.speak({
      text,
      interrupt: true,
      mode: 'stream',
      eventKind: 'local_dockge_stack_narration',
      fallbackKind: 'positive',
      sanitizeText: false,
      transformProfile: 'none',
    });
  } catch (e) {
    if (e?.name === 'AbortError') {
      if (runId === _localDockgeNarrationRunId) _localDockgeNarrationSetState(stackName, 'IDLE', '');
      return;
    }
    console.warn('local Dockge narration: TTS failed', e);
    const message = e?.message ? `TTS failed: ${e.message}` : 'TTS failed.';
    if (runId === _localDockgeNarrationRunId) _localDockgeNarrationSetState(stackName, 'IDLE', message);
    return;
  }
  if (runId === _localDockgeNarrationRunId) _localDockgeNarrationSetState(stackName, 'IDLE', '');
}

const _localDockgeNarrationFsm = (() => {
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

  async function dispatch(stackName, event) {
    const state = _localDockgeNarrationStack === stackName ? _localDockgeNarrationState : 'IDLE';
    const transition = transitions[state]?.[event];
    if (!transition) return;
    for (const action of transition.actions) {
      if (action === 'start') await _localDockgeNarrationStart(stackName, false);
      else if (action === 'regenerate') await _localDockgeNarrationStart(stackName, true);
      else if (action === 'pause') await _localDockgeNarrationPause();
      else if (action === 'resume') await _localDockgeNarrationResume();
      else if (action === 'stop') await _localDockgeNarrationStop();
    }
  }

  return { dispatch };
})();

function _localDockgeNarrationHandleClick(stackName) {
  if (Date.now() - _localDockgeNarrationLastLongPressAt < 700) return;
  _localDockgeNarrationClearClickTimer();
  const now = Date.now();
  if (
    _localDockgeNarrationLastClickAt
    && (now - _localDockgeNarrationLastClickAt) <= _LOCAL_DOCKGE_NARRATION_DOUBLE_CLICK_MS
  ) {
    _localDockgeNarrationLastClickAt = 0;
    _localDockgeNarrationFsm.dispatch(stackName, 'doubleTap');
    return;
  }
  _localDockgeNarrationLastClickAt = now;
  _localDockgeNarrationClickTimer = setTimeout(() => {
    _localDockgeNarrationClickTimer = null;
    _localDockgeNarrationLastClickAt = 0;
    _localDockgeNarrationFsm.dispatch(stackName, 'tap');
  }, _LOCAL_DOCKGE_NARRATION_DOUBLE_CLICK_MS);
}

function _localDockgeNarrationHandlePointerDown(event, stackName) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  _localDockgeNarrationClearLongPressTimer();
  _localDockgeNarrationLongPressTimer = setTimeout(() => {
    _localDockgeNarrationLongPressTimer = null;
    _localDockgeNarrationLastLongPressAt = Date.now();
    _localDockgeNarrationResetClassifiers();
    _localDockgeNarrationFsm.dispatch(stackName, 'longPress');
  }, _LOCAL_DOCKGE_NARRATION_LONG_PRESS_MS);
}

function _localDockgeExposureLabel(kind) {
  return {
    'caddy-web': 'web',
    'caddy-api': 'api',
    'tailnet-web': 'tailnet web',
    'tailnet-api': 'tailnet api',
    'localhost-api': 'local api',
    'localhost-web': 'local web',
    internal: 'internal',
  }[kind] || 'unknown';
}

function _localDockgeKindClass(kind) {
  return String(kind || 'unknown').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
}

function _localDockgeServicePill(stack, service) {
  const exposure = (stack.service_exposures || {})[service] || { service, label: service, kind: 'internal' };
  const kind = exposure.kind || 'internal';
  const title = exposure.url
    ? `${exposure.label || service}: ${exposure.url}`
    : `${exposure.label || service}: ${_localDockgeExposureLabel(kind)}`;
  return `<button class="local-dockge-service-pill local-dockge-service-pill--${esc(_localDockgeKindClass(kind))}" type="button"
      title="${esc(title)}"
      data-local-dockge-service="${esc(service)}"
      data-local-dockge-service-stack="${esc(stack.stack_name || '')}">
      ${esc(exposure.label || service)}<span class="local-dockge-service-kind">${esc(_localDockgeExposureLabel(kind))}</span>
    </button>`;
}

function _localDockgeModalEls() {
  return {
    dialog: document.getElementById('local-dockge-service-modal'),
    badge: document.getElementById('local-dockge-service-modal-badge'),
    title: document.getElementById('local-dockge-service-modal-title'),
    status: document.getElementById('local-dockge-service-modal-status'),
    body: document.getElementById('local-dockge-service-modal-body'),
    error: document.getElementById('local-dockge-service-modal-error'),
    openBtn: document.getElementById('local-dockge-service-modal-open'),
  };
}

function _localDockgeResetServiceModal() {
  const { dialog, badge, title, status, body, error, openBtn } = _localDockgeModalEls();
  if (dialog) dialog.dataset.tone = 'info';
  if (badge) badge.textContent = 'SVC';
  if (title) title.textContent = 'Local Dockge Service';
  if (status) status.textContent = '';
  if (body) body.innerHTML = '';
  if (error) error.textContent = '';
  if (openBtn) {
    openBtn.hidden = false;
    openBtn.disabled = true;
    openBtn.title = 'No browser-openable URL is available for this service.';
    openBtn.onclick = null;
  }
}

function _localDockgeInfoRow(label, value) {
  const text = value == null || value === '' ? '-' : String(value);
  return `<div style="display:grid;grid-template-columns:110px minmax(0,1fr);gap:8px;font-size:12px;line-height:1.6;margin-bottom:6px">
    <strong style="color:var(--text-dim)">${esc(label)}</strong>
    <span style="min-width:0;overflow-wrap:anywhere">${esc(text)}</span>
  </div>`;
}

function _localDockgeChecksHtml(title, checks) {
  const rows = (checks || []).map(check => {
    const ok = check.ok ? 'ok' : 'fail';
    const color = check.ok ? 'var(--ok,#3fb950)' : 'var(--text-dim)';
    const status = check.status == null ? '-' : check.status;
    return `<div class="local-dockge-openapi-row">
      <span style="color:${color};text-transform:uppercase">${esc(ok)} ${esc(String(status))}</span>
      <span style="overflow-wrap:anywhere">${esc(check.url || '')}${check.error ? `<br><span style="color:var(--err,#f85149)">${esc(check.error)}</span>` : ''}</span>
    </div>`;
  }).join('');
  return `<h3>${esc(title)}</h3><div class="local-dockge-openapi-paths">${rows || '<span style="color:var(--text-dim);font-size:12px">No checks run.</span>'}</div>`;
}

function _localDockgeOpenApiHtml(openapi) {
  if (!openapi) {
    return `<h3>API schema</h3><p style="color:var(--text-dim);font-size:12px;line-height:1.7;margin:0">No OpenAPI schema was detected from the standard endpoints.</p>`;
  }
  const rows = (openapi.paths || []).map(row => `<div class="local-dockge-openapi-row">
    <span>${esc((row.methods || []).join(', ') || '-')}</span>
    <code style="overflow-wrap:anywhere">${esc(row.path || '')}</code>
  </div>`).join('');
  return `<h3>${esc(openapi.title || 'OpenAPI')}</h3>
    ${_localDockgeInfoRow('Version', openapi.version || '-')}
    ${_localDockgeInfoRow('Schema', openapi.url || '-')}
    ${_localDockgeInfoRow('Paths', openapi.path_count || 0)}
    ${openapi.description ? `<p style="font-size:12px;line-height:1.7;color:var(--text-dim)">${esc(openapi.description)}</p>` : ''}
    <div class="local-dockge-openapi-paths">${rows || '<span style="color:var(--text-dim);font-size:12px">No paths listed.</span>'}</div>`;
}

function _localDockgeRenderServiceInfo(data) {
  const { body, openBtn } = _localDockgeModalEls();
  if (!body) return;
  const exposure = data.exposure || {};
  const route = exposure.route || {};
  const ports = (exposure.ports || []).map(port => {
    const pub = port.published ? `${port.host_ip || 'host'}:${port.published}` : '-';
    return `${pub} -> ${port.target || '-'} / ${port.protocol || 'tcp'}`;
  }).join('\n');
  if (openBtn) {
    openBtn.hidden = false;
    openBtn.disabled = !exposure.open_url;
    openBtn.title = exposure.open_url ? `Open ${exposure.open_url}` : 'No browser-openable URL is available for this service.';
    openBtn.onclick = exposure.open_url
      ? () => window.open(exposure.open_url, '_blank', 'noopener,noreferrer')
      : null;
  }
  body.innerHTML = `<div class="local-dockge-service-modal-grid">
    <div class="local-dockge-service-modal-panel">
      <h3>Service</h3>
      ${_localDockgeInfoRow('Stack', data.stack_name)}
      ${_localDockgeInfoRow('Service', exposure.service || data.service)}
      ${_localDockgeInfoRow('Kind', _localDockgeExposureLabel(exposure.kind))}
      ${_localDockgeInfoRow('Source', exposure.source || '-')}
      ${_localDockgeInfoRow('URL', exposure.url || '-')}
      ${_localDockgeInfoRow('Open URL', exposure.open_url || '-')}
      ${_localDockgeInfoRow('Upstream', route.upstream || '-')}
      ${_localDockgeInfoRow('Ports', ports || '-')}
      ${exposure.description ? `<p style="font-size:12px;line-height:1.7">${esc(exposure.description)}</p>` : ''}
      ${exposure.notes ? `<p style="font-size:12px;line-height:1.7;color:var(--text-dim)">${esc(exposure.notes)}</p>` : ''}
      <h3 style="margin-top:14px">Tests</h3>
      <p style="font-size:12px;line-height:1.7;color:var(--text-dim);margin:0">${esc(data.tests?.detail || exposure.tests_todo || 'Tests can be added later.')}</p>
    </div>
    <div class="local-dockge-service-modal-panel">
      ${_localDockgeOpenApiHtml(data.openapi)}
    </div>
    <div class="local-dockge-service-modal-panel">
      ${_localDockgeChecksHtml('Endpoint checks', [data.home_check].filter(Boolean))}
    </div>
    <div class="local-dockge-service-modal-panel">
      ${_localDockgeChecksHtml('OpenAPI checks', data.openapi_checks)}
      <div style="height:12px"></div>
      ${_localDockgeChecksHtml('Docs checks', data.docs_checks)}
    </div>
  </div>`;
}

async function openLocalDockgeServiceInfo(stackName, serviceName) {
  const stack = _localDockgeStacks.find(item => item.stack_name === stackName);
  const exposure = stack?.service_exposures?.[serviceName] || null;
  if (['caddy-web', 'tailnet-web'].includes(exposure?.kind) && exposure.open_url) {
    window.open(exposure.open_url, '_blank', 'noopener,noreferrer');
    return;
  }

  const { dialog, badge, title, status, error } = _localDockgeModalEls();
  if (!dialog) return;
  _localDockgeResetServiceModal();
  if (badge) badge.textContent = _localDockgeExposureLabel(exposure?.kind || 'internal').toUpperCase();
  if (title) title.textContent = `${stackName} / ${serviceName}`;
  if (status) status.textContent = 'Loading service information...';
  HubModal.open(dialog, { onClose: _localDockgeResetServiceModal });
  try {
    const r = await apiFetch(`/api/v1/local-dockge/stacks/${encodeURIComponent(stackName)}/services/${encodeURIComponent(serviceName)}/info`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
    if (status) status.textContent = data.openapi ? 'OpenAPI schema detected.' : 'Service information loaded.';
    _localDockgeRenderServiceInfo(data);
  } catch (e) {
    if (status) status.textContent = '';
    if (error) error.textContent = `Failed to load service information: ${e.message}`;
  }
}

function _localDockgeStackErrorButton(stack) {
  if (!stack.error) return '';
  return `<button class="local-dockge-stack-error-btn" type="button"
      title="Show stack error"
      aria-label="Show ${esc(stack.stack_name || 'stack')} error"
      data-local-dockge-error-stack="${esc(stack.stack_name || '')}"></button>`;
}

async function openLocalDockgeStackError(stackName) {
  const stack = _localDockgeStacks.find(item => item.stack_name === stackName);
  if (!stack?.error) return;
  if (typeof HubDialogs !== 'undefined' && typeof HubDialogs.alertError === 'function') {
    await HubDialogs.alertError({
      title: `${stackName} stack error`,
      message: 'Docker Compose could not inspect this stack cleanly.',
      detail: stack.error,
      confirmText: 'Close',
      width: 'min(720px,96vw)',
    });
    return;
  }
  alert(`${stackName} stack error\n\n${stack.error}`);
}

function _localDockgeCell(col, stack, rendered) {
  const value = rendered[col] || '';
  const className = col === 'actions' ? 'table-action-cell local-dockge-actions-cell' : `local-dockge-col-${col}`;
  return `<td data-col="${esc(col)}" class="${esc(className)}">${value}</td>`;
}

function _localDockgeVisibleCols() {
  return _ensureLocalDockgeTableView()?.getVisibleCols() || _LOCAL_DOCKGE_COLS;
}

function _renderLocalDockgeStackRows() {
  const tbody = document.getElementById('local-dockge-tbody');
  if (!tbody) return;
  const rows = _localDockgeFilterRows(_localDockgeStacks || []);
  const visibleCols = _localDockgeVisibleCols();
  if (!rows.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${visibleCols.length || 1}">No local Dockge stacks found.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(stack => {
    const services = (stack.services || []).map(service => _localDockgeServicePill(stack, service)).join(' ');
    const containers = (stack.containers || []).map(container => _localDockgeRenderContainerChip(container)).join('');
    const rendered = {
      stack: `<div class="local-dockge-stack-cell"><strong>${esc(stack.stack_name || '-')}</strong>${_localDockgeStackErrorButton(stack)}</div>`,
      services: services || '<span style="color:var(--text-dim)">-</span>',
      containers: containers
        ? `<div class="local-dockge-container-list">${containers}</div>`
        : '<span style="color:var(--text-dim)">-</span>',
      status_health: `<div class="local-dockge-status-stack">${_localDockgeBadge(stack.status)}${_localDockgeBadge(stack.health)}</div>`,
      updated: _localDockgeFormatUpdatedHtml(stack.updated_at),
      actions: _localDockgeActionButtons(stack),
    };
    return `<tr>${visibleCols.map(col => _localDockgeCell(col, stack, rendered)).join('')}</tr>`;
  }).join('');
  _localDockgeRenderActionButtonStates();
}

function renderLocalDockgeStacks() {
  const tableView = _ensureLocalDockgeTableView();
  if (tableView) {
    tableView.render(_renderLocalDockgeStackRows);
    return;
  }
  _renderLocalDockgeStackRows();
}

function _ensureLocalDockgePoll() {
  if (_localDockgePollInterval) return;
  _localDockgePollInterval = setInterval(() => {
    if (_localDockgeIsActive()) loadLocalDockgeStacks({ silent: true });
  }, _LOCAL_DOCKGE_POLL_MS);
}

async function loadLocalDockgeStacks(options = {}) {
  const err = document.getElementById('local-dockge-error');
  const status = document.getElementById('local-dockge-status');
  if (err) err.hidden = true;
  if (status && !options.silent) {
    status.textContent = 'Loading local Dockge stacks...';
    status.style.color = 'var(--text-dim)';
    status.hidden = false;
  }
  _ensureLocalDockgePoll();
  try {
    const r = await apiFetch('/api/v1/local-dockge/stacks');
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
    _localDockgeStacks = data.stacks || [];
    renderLocalDockgeStacks();
    if (status) {
      status.textContent = `${_localDockgeStacks.length} stack${_localDockgeStacks.length === 1 ? '' : 's'} from ${data.stacks_dir || 'local Dockge'}`;
      status.style.color = 'var(--text-dim)';
      status.hidden = false;
    }
  } catch (e) {
    if (err) {
      err.textContent = `Failed to load local Dockge stacks: ${e.message}`;
      err.hidden = false;
    }
    if (status) status.hidden = true;
  }
}

async function localDockgeStackAction(stackName, action, btn) {
  const status = document.getElementById('local-dockge-status');
  if (btn) btn.disabled = true;
  if (status) {
    status.textContent = `${action} ${stackName}...`;
    status.style.color = 'var(--text-dim)';
    status.hidden = false;
  }
  try {
    const r = await apiFetch(`/api/v1/local-dockge/stacks/${encodeURIComponent(stackName)}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
    const next = data.result;
    if (next) {
      const idx = _localDockgeStacks.findIndex(stack => stack.stack_name === stackName);
      if (idx === -1) _localDockgeStacks.push(next);
      else _localDockgeStacks[idx] = next;
      renderLocalDockgeStacks();
    }
    if (status) {
      status.textContent = `${action} ${stackName} succeeded.`;
      status.style.color = 'var(--ok,#3fb950)';
    }
    setTimeout(() => loadLocalDockgeStacks({ silent: true }), 1200);
  } catch (e) {
    if (status) {
      status.textContent = `${action} ${stackName} failed: ${e.message}`;
      status.style.color = 'var(--err,#f85149)';
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('local-dockge-search')?.addEventListener('input', renderLocalDockgeStacks);
  const localDockgeTbody = document.getElementById('local-dockge-tbody');
  localDockgeTbody?.addEventListener('pointerdown', e => {
    const btn = e.target.closest('[data-local-dockge-narrate-stack]');
    if (!btn) return;
    _localDockgeNarrationHandlePointerDown(e, btn.dataset.localDockgeNarrateStack);
  });
  localDockgeTbody?.addEventListener('pointerup', _localDockgeNarrationClearLongPressTimer);
  localDockgeTbody?.addEventListener('pointercancel', _localDockgeNarrationClearLongPressTimer);
  localDockgeTbody?.addEventListener('pointerout', e => {
    const btn = e.target.closest('[data-local-dockge-narrate-stack]');
    if (btn && !btn.contains(e.relatedTarget)) _localDockgeNarrationClearLongPressTimer();
  });
  localDockgeTbody?.addEventListener('contextmenu', e => {
    if (e.target.closest('[data-local-dockge-narrate-stack]')) e.preventDefault();
  });
  localDockgeTbody?.addEventListener('dblclick', e => {
    const narrationBtn = e.target.closest('[data-local-dockge-narrate-stack]');
    if (!narrationBtn) return;
    e.preventDefault();
    _localDockgeNarrationResetClassifiers();
    _localDockgeNarrationFsm.dispatch(narrationBtn.dataset.localDockgeNarrateStack, 'doubleTap');
  });
  localDockgeTbody?.addEventListener('click', e => {
    const narrationBtn = e.target.closest('[data-local-dockge-narrate-stack]');
    if (narrationBtn) {
      e.preventDefault();
      _localDockgeNarrationHandleClick(narrationBtn.dataset.localDockgeNarrateStack);
      return;
    }
    const downloadBtn = e.target.closest('[data-local-dockge-download-stack]');
    if (downloadBtn) {
      e.preventDefault();
      _localDockgeDownloadNarrationMp3(downloadBtn.dataset.localDockgeDownloadStack, downloadBtn);
      return;
    }
    const errorBtn = e.target.closest('[data-local-dockge-error-stack]');
    if (errorBtn) {
      openLocalDockgeStackError(errorBtn.dataset.localDockgeErrorStack);
      return;
    }
    const serviceBtn = e.target.closest('[data-local-dockge-service]');
    if (serviceBtn) {
      openLocalDockgeServiceInfo(serviceBtn.dataset.localDockgeServiceStack, serviceBtn.dataset.localDockgeService);
      return;
    }
    const btn = e.target.closest('[data-local-dockge-action]');
    if (!btn) return;
    localDockgeStackAction(btn.dataset.localDockgeStack, btn.dataset.localDockgeAction, btn);
  });
  if (typeof ResponsiveLayout !== 'undefined') {
    ResponsiveLayout.registerTabControls('local-dockge', 'pg-ctrl-local-dockge');
  }
});
