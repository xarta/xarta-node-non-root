/* ── VPS Dockge ──────────────────────────────────────────────────────── */

const _VPS_DOCKGE_POLL_MS = 30000;
const _VPS_DOCKGE_COLS = ['stack', 'services', 'containers', 'status_health', 'updated', 'actions'];
const _VPS_DOCKGE_FIELD_META = {
  stack: { label: 'Stack' },
  services: { label: 'Services' },
  containers: { label: 'Containers' },
  status_health: { label: 'Status<br>Health' },
  updated: { label: 'Updated' },
  actions: { label: 'Actions' },
};
const _VPS_DOCKGE_PROJECT_URLS = Object.freeze({
  'claude-code': 'https://code.claude.com/docs/en',
  crawl4ai: 'https://docs.crawl4ai.com/',
  dockge: 'https://dockge.kuma.pet/',
  'edge-core': 'https://doc.traefik.io/traefik/',
  headscale: 'https://headscale.net/',
  hermes: 'https://github.com/NousResearch/hermes-agent',
  litellm: 'https://www.litellm.ai/',
  liteparse: 'https://github.com/run-llama/liteparse',
  markitdown: 'https://github.com/microsoft/markitdown',
  'matrix-synapse': 'https://element-hq.github.io/synapse/latest/',
  'nullclaw01': 'https://github.com/nullclaw/nullclaw',
  'nullclaw-basics': 'https://github.com/nullclaw/nullclaw',
  'nullclaw-docs-search': 'https://github.com/nullclaw/nullclaw',
  paperclip: 'https://paperclip.ing/',
  playwright: 'https://playwright.dev/',
  'pockettts-openai': 'https://pockettts.org/',
  scrapling: 'https://github.com/D4Vinci/Scrapling',
  searxng: 'https://docs.searxng.org/',
  speedtest: 'https://www.speedtest.net/apps/cli',
  'turbovec-docs': 'https://github.com/RyanCodrai/turbovec',
  vikunja: 'https://vikunja.io/',
});
let _vpsDockgeTableView = null;
let _vpsDockgeNarrationState = 'IDLE';
let _vpsDockgeNarrationStack = null;
let _vpsDockgeNarrationRunId = 0;
let _vpsDockgeNarrationClickTimer = null;
let _vpsDockgeNarrationLastClickAt = 0;
let _vpsDockgeNarrationLongPressTimer = null;
let _vpsDockgeNarrationLastLongPressAt = 0;
let _vpsDockgeDownloadBusyStack = null;
const _VPS_DOCKGE_NARRATION_DOUBLE_CLICK_MS = 260;
const _VPS_DOCKGE_NARRATION_LONG_PRESS_MS = 650;

function _ensureVpsDockgeTableView() {
  if (_vpsDockgeTableView || typeof TableView === 'undefined') return _vpsDockgeTableView;
  _vpsDockgeTableView = TableView.create({
    storageKey: 'vps-dockge-table-widths',
    columns: _VPS_DOCKGE_COLS,
    meta: _VPS_DOCKGE_FIELD_META,
    getTable: () => document.getElementById('vps-dockge-table'),
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
  return _vpsDockgeTableView;
}

function _vpsDockgeIsActive() {
  return document.getElementById('tab-vps-dockge')?.classList.contains('active');
}

function _vpsDockgeProjectUrl(stackName) {
  const key = String(stackName || '').trim().toLowerCase();
  return _VPS_DOCKGE_PROJECT_URLS[key] || null;
}

function _vpsDockgeRenderStackName(stack) {
  const name = stack?.stack_name || '-';
  const url = _vpsDockgeProjectUrl(name);
  if (!url) return `<strong>${esc(name)}</strong>`;
  return (
    `<a class="vps-dockge-stack-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" ` +
    `title="Open ${esc(name)} project website">${esc(name)}</a>`
  );
}

function _vpsDockgeStatusTone(status) {
  const text = String(status || '').toLowerCase();
  if (text === 'running' || text === 'healthy') return 'var(--ok,#3fb950)';
  if (text === 'partial' || text === 'starting' || text === 'mixed') return 'var(--warn,#e6a817)';
  if (text === 'stopped' || text === 'none') return 'var(--text-dim)';
  if (text === 'unhealthy' || text === 'unknown') return 'var(--err,#f85149)';
  return 'var(--text-dim)';
}

function _vpsDockgeBadge(value) {
  const label = value || 'unknown';
  return `<span style="display:inline-block;border:1px solid currentColor;border-radius:6px;padding:2px 7px;font-size:11px;color:${_vpsDockgeStatusTone(label)}">${esc(label)}</span>`;
}

function _vpsDockgeContainerTone(container) {
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

function _vpsDockgeRenderContainerChip(container) {
  const label = container.name || container.service || container.id || '-';
  const state = container.state || 'unknown';
  const health = container.health || '';
  const status = container.status || '';
  const tone = _vpsDockgeContainerTone(container);
  const titleParts = [`state: ${state}`];
  if (health) titleParts.push(`health: ${health}`);
  if (status) titleParts.push(status);
  return (
    `<span class="ip-chip vps-dockge-container-chip vps-dockge-container-chip--${esc(tone)}" ` +
    `title="${esc(titleParts.join(' | '))}">${esc(label)}:${esc(state)}</span>`
  );
}

function _vpsDockgeFormatTime(value) {
  if (!value) return '-';
  return String(value).replace('T', ' ').replace(/\.\d+.*$/, '').replace('+00:00', '').slice(0, 19);
}

function _vpsDockgeFormatUpdatedHtml(value) {
  const text = _vpsDockgeFormatTime(value);
  if (text === '-') return '<span class="vps-dockge-updated">-</span>';
  const [date, time] = text.split(' ');
  return `<span class="vps-dockge-updated"><span>${esc(date || text)}</span>${time ? `<span>${esc(time)}</span>` : ''}</span>`;
}

function _vpsDockgeFilterRows(stacks) {
  const q = (document.getElementById('vps-dockge-search')?.value || '').trim().toLowerCase();
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

function _vpsDockgeActionButtons(stack) {
  const name = esc(stack.stack_name || '');
  const rawName = stack.stack_name || '';
  const status = String(stack.status || 'unknown').toLowerCase();
  const projectUrl = _vpsDockgeProjectUrl(rawName);
  const buttons = [];
  if (status === 'running' || status === 'partial') {
    buttons.push(`<button class="secondary table-icon-btn table-icon-btn--restart" type="button" title="Restart stack" aria-label="Restart stack" data-vps-dockge-action="restart" data-vps-dockge-stack="${name}"></button>`);
    buttons.push(`<button class="secondary table-icon-btn table-icon-btn--power-stop" type="button" title="Stop stack" aria-label="Stop stack" data-vps-dockge-action="stop" data-vps-dockge-stack="${name}"></button>`);
  } else if (status === 'stopped') {
    buttons.push(`<button class="secondary table-icon-btn table-icon-btn--power-start" type="button" title="Start stack" aria-label="Start stack" data-vps-dockge-action="start" data-vps-dockge-stack="${name}"></button>`);
  } else {
    buttons.push(`<button class="secondary table-icon-btn table-icon-btn--restart" type="button" title="Refresh before acting on this stack" aria-label="Stack action unavailable" disabled></button>`);
  }
  buttons.push(`<button class="secondary table-icon-btn table-icon-btn--speaker vps-dockge-narration-btn is-idle" type="button"
      title="Speak stack condition; long press regenerates narration"
      aria-label="Speak ${name} stack condition"
      aria-pressed="false"
      data-vps-dockge-narrate-stack="${name}"></button>`);
  buttons.push(`<button class="secondary table-icon-btn table-icon-btn--speaker vps-dockge-download-btn" type="button"
      title="Generate and download MP3 narration"
      aria-label="Generate and download ${name} MP3 narration"
      data-vps-dockge-download-stack="${name}"></button>`);
  if (projectUrl) {
    buttons.push(`<button class="secondary table-icon-btn table-icon-btn--external" type="button"
      title="Open project repository or website"
      aria-label="Open ${name} project repository or website"
      data-vps-dockge-project-url="${esc(projectUrl)}"></button>`);
  } else {
    buttons.push(`<button class="secondary table-icon-btn table-icon-btn--external" type="button"
      title="No project repository configured"
      aria-label="No project repository configured for ${name}"
      disabled></button>`);
  }
  buttons.push(`<button class="secondary table-icon-btn table-icon-btn--terminal" type="button"
    title="${String(rawName).toLowerCase() === 'hermes' ? 'VPS Hermes terminal target is not configured yet' : 'No terminal target configured'}"
    aria-label="No terminal target configured for ${name}"
    disabled></button>`);
  return `<div class="table-inline-actions table-inline-actions--stacked">${buttons.join('')}</div>`;
}

function _vpsDockgeNarrationButtons() {
  return Array.from(document.querySelectorAll('[data-vps-dockge-narrate-stack]'));
}

function _vpsDockgeDownloadButtons() {
  return Array.from(document.querySelectorAll('[data-vps-dockge-download-stack]'));
}

function _vpsDockgeNarrationRenderButtons(message = '') {
  const activeStack = _vpsDockgeNarrationStack;
  const state = _vpsDockgeNarrationState;
  _vpsDockgeNarrationButtons().forEach(btn => {
    const isActive = activeStack && btn.dataset.vpsDockgeNarrateStack === activeStack;
    const clean = isActive ? state : 'IDLE';
    const isSpeaking = clean === 'SPEAKING';
    const isPaused = clean === 'PAUSED';
    btn.classList.toggle('is-idle', clean === 'IDLE');
    btn.classList.toggle('is-speaking', isSpeaking);
    btn.classList.toggle('is-paused', isPaused);
    btn.classList.toggle('is-generating', isActive && /generat|prepar/i.test(String(message || '')));
    btn.setAttribute('aria-pressed', isSpeaking ? 'true' : 'false');
    const stackName = btn.dataset.vpsDockgeNarrateStack || 'stack';
    const label = isPaused
      ? `Resume ${stackName} stack audio`
      : (isSpeaking ? `Pause ${stackName} stack audio` : `Speak ${stackName} stack condition`);
    btn.setAttribute('aria-label', label);
    btn.title = `${label}; long press regenerates narration`;
  });
}

function _vpsDockgeDownloadRenderButtons() {
  const busyStack = _vpsDockgeDownloadBusyStack;
  _vpsDockgeDownloadButtons().forEach(btn => {
    const stackName = btn.dataset.vpsDockgeDownloadStack || 'stack';
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

function _vpsDockgeRenderActionButtonStates(message = '') {
  _vpsDockgeNarrationRenderButtons(message);
  _vpsDockgeDownloadRenderButtons();
}

function _vpsDockgeNarrationSetState(stackName, state = 'IDLE', message = '') {
  const clean = ['IDLE', 'SPEAKING', 'PAUSED'].includes(state) ? state : 'IDLE';
  _vpsDockgeNarrationState = clean;
  _vpsDockgeNarrationStack = clean === 'IDLE' && !message ? null : stackName;
  _vpsDockgeRenderActionButtonStates(message);
  const status = document.getElementById('vps-dockge-status');
  if (status && message) {
    status.textContent = message;
    status.style.color = 'var(--text-dim)';
    status.hidden = false;
  }
}

function _vpsDockgeNarrationClearClickTimer() {
  if (!_vpsDockgeNarrationClickTimer) return;
  clearTimeout(_vpsDockgeNarrationClickTimer);
  _vpsDockgeNarrationClickTimer = null;
}

function _vpsDockgeNarrationClearLongPressTimer() {
  if (!_vpsDockgeNarrationLongPressTimer) return;
  clearTimeout(_vpsDockgeNarrationLongPressTimer);
  _vpsDockgeNarrationLongPressTimer = null;
}

function _vpsDockgeNarrationResetClassifiers() {
  _vpsDockgeNarrationClearClickTimer();
  _vpsDockgeNarrationClearLongPressTimer();
  _vpsDockgeNarrationLastClickAt = 0;
}

async function _vpsDockgeNarrationStopClient() {
  if (typeof BlueprintsTtsClient !== 'undefined' && typeof BlueprintsTtsClient.stop === 'function') {
    try {
      await BlueprintsTtsClient.stop();
    } catch (e) {
      console.warn('VPS Dockge narration: failed to stop TTS', e);
    }
  }
}

async function _vpsDockgeNarrationStop() {
  const stackName = _vpsDockgeNarrationStack;
  _vpsDockgeNarrationResetClassifiers();
  _vpsDockgeNarrationRunId += 1;
  _vpsDockgeNarrationSetState(stackName, 'IDLE', '');
  await _vpsDockgeNarrationStopClient();
}

async function _vpsDockgeNarrationPause() {
  if (typeof BlueprintsTtsClient === 'undefined' || typeof BlueprintsTtsClient.pause !== 'function') {
    await _vpsDockgeNarrationStop();
    return;
  }
  try {
    const result = await BlueprintsTtsClient.pause();
    if (result?.paused) {
      _vpsDockgeNarrationSetState(_vpsDockgeNarrationStack, 'PAUSED', '');
      return;
    }
  } catch (e) {
    console.warn('VPS Dockge narration: failed to pause TTS', e);
  }
  await _vpsDockgeNarrationStop();
}

async function _vpsDockgeNarrationResume() {
  if (typeof BlueprintsTtsClient === 'undefined' || typeof BlueprintsTtsClient.resume !== 'function') {
    await _vpsDockgeNarrationStop();
    return;
  }
  try {
    const result = await BlueprintsTtsClient.resume();
    if (result?.resumed) {
      _vpsDockgeNarrationSetState(_vpsDockgeNarrationStack, 'SPEAKING', '');
      return;
    }
  } catch (e) {
    console.warn('VPS Dockge narration: failed to resume TTS', e);
  }
  await _vpsDockgeNarrationStop();
}

async function _vpsDockgeNarrationMarkdown(stackName, force = false) {
  _vpsDockgeNarrationSetState(stackName, 'SPEAKING', force ? `Regenerating ${stackName} narration...` : `Preparing ${stackName} narration...`);
  return _vpsDockgeFetchNarrationMarkdown(stackName, force);
}

async function _vpsDockgeFetchNarrationMarkdown(stackName, force = false) {
  const r = await apiFetch(`/api/v1/vps-dockge/stacks/${encodeURIComponent(stackName)}/speech`, {
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

function _vpsDockgeDownloadFilename(stackName, contentType) {
  const safe = String(stackName || 'stack').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'stack';
  const ext = String(contentType || '').includes('wav') ? 'wav' : 'mp3';
  return `vps-dockge-${safe}-narration.${ext}`;
}

function _vpsDockgeSetDownloadButtonState(btn, busy) {
  if (btn) {
    btn.disabled = busy;
    btn.classList.toggle('is-generating', busy);
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    btn.title = busy ? 'Generating MP3 narration...' : 'Generate and download MP3 narration';
  }
  _vpsDockgeDownloadRenderButtons();
}

async function _vpsDockgeDownloadNarrationMp3(stackName, btn) {
  if (!stackName || _vpsDockgeDownloadBusyStack) return;
  if (typeof BlueprintsTtsClient === 'undefined' || typeof BlueprintsTtsClient.synthesize !== 'function') {
    const status = document.getElementById('vps-dockge-status');
    if (status) {
      status.textContent = 'TTS download unavailable.';
      status.style.color = 'var(--err,#f85149)';
      status.hidden = false;
    }
    return;
  }

  _vpsDockgeDownloadBusyStack = stackName;
  _vpsDockgeSetDownloadButtonState(btn, true);
  const status = document.getElementById('vps-dockge-status');
  if (status) {
    status.textContent = `Generating ${stackName} MP3 narration...`;
    status.style.color = 'var(--text-dim)';
    status.hidden = false;
  }

  try {
    const text = await _vpsDockgeFetchNarrationMarkdown(stackName, false);
    const result = await BlueprintsTtsClient.synthesize({
      text,
      interrupt: false,
      mode: 'batch',
      format: 'mp3',
      timeoutMs: 360000,
      allowFallback: false,
      eventKind: 'vps_dockge_stack_narration_download',
      fallbackKind: 'positive',
      sanitizeText: false,
      transformProfile: 'none',
    });
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = _vpsDockgeDownloadFilename(stackName, result.contentType);
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
    _vpsDockgeDownloadBusyStack = null;
    _vpsDockgeSetDownloadButtonState(btn, false);
  }
}

async function _vpsDockgeNarrationStart(stackName, force = false) {
  if (!stackName) return;
  if (typeof BlueprintsTtsClient === 'undefined' || typeof BlueprintsTtsClient.speak !== 'function') {
    _vpsDockgeNarrationSetState(stackName, 'IDLE', 'TTS unavailable.');
    return;
  }
  const runId = _vpsDockgeNarrationRunId + 1;
  _vpsDockgeNarrationRunId = runId;
  await _vpsDockgeNarrationStopClient();
  if (runId !== _vpsDockgeNarrationRunId) return;
  _vpsDockgeNarrationSetState(stackName, 'SPEAKING', force ? `Regenerating ${stackName} narration...` : `Preparing ${stackName} narration...`);
  try {
    const text = await _vpsDockgeNarrationMarkdown(stackName, force);
    if (runId !== _vpsDockgeNarrationRunId) return;
    _vpsDockgeNarrationSetState(stackName, 'SPEAKING', '');
    await BlueprintsTtsClient.speak({
      text,
      interrupt: true,
      mode: 'stream',
      eventKind: 'vps_dockge_stack_narration',
      fallbackKind: 'positive',
      sanitizeText: false,
      transformProfile: 'none',
    });
  } catch (e) {
    if (e?.name === 'AbortError') {
      if (runId === _vpsDockgeNarrationRunId) _vpsDockgeNarrationSetState(stackName, 'IDLE', '');
      return;
    }
    console.warn('VPS Dockge narration: TTS failed', e);
    const message = e?.message ? `TTS failed: ${e.message}` : 'TTS failed.';
    if (runId === _vpsDockgeNarrationRunId) _vpsDockgeNarrationSetState(stackName, 'IDLE', message);
    return;
  }
  if (runId === _vpsDockgeNarrationRunId) _vpsDockgeNarrationSetState(stackName, 'IDLE', '');
}

const _vpsDockgeNarrationFsm = (() => {
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
    const state = _vpsDockgeNarrationStack === stackName ? _vpsDockgeNarrationState : 'IDLE';
    const transition = transitions[state]?.[event];
    if (!transition) return;
    for (const action of transition.actions) {
      if (action === 'start') await _vpsDockgeNarrationStart(stackName, false);
      else if (action === 'regenerate') await _vpsDockgeNarrationStart(stackName, true);
      else if (action === 'pause') await _vpsDockgeNarrationPause();
      else if (action === 'resume') await _vpsDockgeNarrationResume();
      else if (action === 'stop') await _vpsDockgeNarrationStop();
    }
  }

  return { dispatch };
})();

function _vpsDockgeNarrationHandleClick(stackName) {
  if (Date.now() - _vpsDockgeNarrationLastLongPressAt < 700) return;
  _vpsDockgeNarrationClearClickTimer();
  const now = Date.now();
  if (
    _vpsDockgeNarrationLastClickAt
    && (now - _vpsDockgeNarrationLastClickAt) <= _VPS_DOCKGE_NARRATION_DOUBLE_CLICK_MS
  ) {
    _vpsDockgeNarrationLastClickAt = 0;
    _vpsDockgeNarrationFsm.dispatch(stackName, 'doubleTap');
    return;
  }
  _vpsDockgeNarrationLastClickAt = now;
  _vpsDockgeNarrationClickTimer = setTimeout(() => {
    _vpsDockgeNarrationClickTimer = null;
    _vpsDockgeNarrationLastClickAt = 0;
    _vpsDockgeNarrationFsm.dispatch(stackName, 'tap');
  }, _VPS_DOCKGE_NARRATION_DOUBLE_CLICK_MS);
}

function _vpsDockgeNarrationHandlePointerDown(event, stackName) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  _vpsDockgeNarrationClearLongPressTimer();
  _vpsDockgeNarrationLongPressTimer = setTimeout(() => {
    _vpsDockgeNarrationLongPressTimer = null;
    _vpsDockgeNarrationLastLongPressAt = Date.now();
    _vpsDockgeNarrationResetClassifiers();
    _vpsDockgeNarrationFsm.dispatch(stackName, 'longPress');
  }, _VPS_DOCKGE_NARRATION_LONG_PRESS_MS);
}

function _vpsDockgeExposureLabel(kind) {
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

function _vpsDockgeKindClass(kind) {
  return String(kind || 'unknown').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
}

function _vpsDockgeServicePill(stack, service) {
  const exposure = (stack.service_exposures || {})[service] || { service, label: service, kind: 'internal' };
  const kind = exposure.kind || 'internal';
  const title = exposure.url
    ? `${exposure.label || service}: ${exposure.url}`
    : `${exposure.label || service}: ${_vpsDockgeExposureLabel(kind)}`;
  return `<button class="vps-dockge-service-pill vps-dockge-service-pill--${esc(_vpsDockgeKindClass(kind))}" type="button"
      title="${esc(title)}"
      data-vps-dockge-service="${esc(service)}"
      data-vps-dockge-service-stack="${esc(stack.stack_name || '')}">
      ${esc(exposure.label || service)}<span class="vps-dockge-service-kind">${esc(_vpsDockgeExposureLabel(kind))}</span>
    </button>`;
}

function _vpsDockgeModalEls() {
  return {
    dialog: document.getElementById('vps-dockge-service-modal'),
    badge: document.getElementById('vps-dockge-service-modal-badge'),
    title: document.getElementById('vps-dockge-service-modal-title'),
    status: document.getElementById('vps-dockge-service-modal-status'),
    body: document.getElementById('vps-dockge-service-modal-body'),
    error: document.getElementById('vps-dockge-service-modal-error'),
    openBtn: document.getElementById('vps-dockge-service-modal-open'),
  };
}

function _vpsDockgeResetServiceModal() {
  const { dialog, badge, title, status, body, error, openBtn } = _vpsDockgeModalEls();
  if (dialog) dialog.dataset.tone = 'info';
  if (badge) badge.textContent = 'SVC';
  if (title) title.textContent = 'VPS Dockge Service';
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

function _vpsDockgeInfoRow(label, value) {
  const text = value == null || value === '' ? '-' : String(value);
  return `<div style="display:grid;grid-template-columns:110px minmax(0,1fr);gap:8px;font-size:12px;line-height:1.6;margin-bottom:6px">
    <strong style="color:var(--text-dim)">${esc(label)}</strong>
    <span style="min-width:0;overflow-wrap:anywhere">${esc(text)}</span>
  </div>`;
}

function _vpsDockgeChecksHtml(title, checks) {
  const rows = (checks || []).map(check => {
    const ok = check.ok ? 'ok' : 'fail';
    const color = check.ok ? 'var(--ok,#3fb950)' : 'var(--text-dim)';
    const status = check.status == null ? '-' : check.status;
    return `<div class="vps-dockge-openapi-row">
      <span style="color:${color};text-transform:uppercase">${esc(ok)} ${esc(String(status))}</span>
      <span style="overflow-wrap:anywhere">${esc(check.url || '')}${check.error ? `<br><span style="color:var(--err,#f85149)">${esc(check.error)}</span>` : ''}</span>
    </div>`;
  }).join('');
  return `<h3>${esc(title)}</h3><div class="vps-dockge-openapi-paths">${rows || '<span style="color:var(--text-dim);font-size:12px">No checks run.</span>'}</div>`;
}

function _vpsDockgeOpenApiHtml(openapi) {
  if (!openapi) {
    return `<h3>API schema</h3><p style="color:var(--text-dim);font-size:12px;line-height:1.7;margin:0">No OpenAPI schema was detected from the standard endpoints.</p>`;
  }
  const rows = (openapi.paths || []).map(row => `<div class="vps-dockge-openapi-row">
    <span>${esc((row.methods || []).join(', ') || '-')}</span>
    <code style="overflow-wrap:anywhere">${esc(row.path || '')}</code>
  </div>`).join('');
  return `<h3>${esc(openapi.title || 'OpenAPI')}</h3>
    ${_vpsDockgeInfoRow('Version', openapi.version || '-')}
    ${_vpsDockgeInfoRow('Schema', openapi.url || '-')}
    ${_vpsDockgeInfoRow('Paths', openapi.path_count || 0)}
    ${openapi.description ? `<p style="font-size:12px;line-height:1.7;color:var(--text-dim)">${esc(openapi.description)}</p>` : ''}
    <div class="vps-dockge-openapi-paths">${rows || '<span style="color:var(--text-dim);font-size:12px">No paths listed.</span>'}</div>`;
}

function _vpsDockgeRenderServiceInfo(data) {
  const { body, openBtn } = _vpsDockgeModalEls();
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
  body.innerHTML = `<div class="vps-dockge-service-modal-grid">
    <div class="vps-dockge-service-modal-panel">
      <h3>Service</h3>
      ${_vpsDockgeInfoRow('Stack', data.stack_name)}
      ${_vpsDockgeInfoRow('Service', exposure.service || data.service)}
      ${_vpsDockgeInfoRow('Kind', _vpsDockgeExposureLabel(exposure.kind))}
      ${_vpsDockgeInfoRow('Source', exposure.source || '-')}
      ${_vpsDockgeInfoRow('URL', exposure.url || '-')}
      ${_vpsDockgeInfoRow('Open URL', exposure.open_url || '-')}
      ${_vpsDockgeInfoRow('Upstream', route.upstream || '-')}
      ${_vpsDockgeInfoRow('Ports', ports || '-')}
      ${exposure.description ? `<p style="font-size:12px;line-height:1.7">${esc(exposure.description)}</p>` : ''}
      ${exposure.notes ? `<p style="font-size:12px;line-height:1.7;color:var(--text-dim)">${esc(exposure.notes)}</p>` : ''}
      <h3 style="margin-top:14px">Tests</h3>
      <p style="font-size:12px;line-height:1.7;color:var(--text-dim);margin:0">${esc(data.tests?.detail || exposure.tests_todo || 'Tests can be added later.')}</p>
    </div>
    <div class="vps-dockge-service-modal-panel">
      ${_vpsDockgeOpenApiHtml(data.openapi)}
    </div>
    <div class="vps-dockge-service-modal-panel">
      ${_vpsDockgeChecksHtml('Endpoint checks', [data.home_check].filter(Boolean))}
    </div>
    <div class="vps-dockge-service-modal-panel">
      ${_vpsDockgeChecksHtml('OpenAPI checks', data.openapi_checks)}
      <div style="height:12px"></div>
      ${_vpsDockgeChecksHtml('Docs checks', data.docs_checks)}
    </div>
  </div>`;
}

async function openVpsDockgeServiceInfo(stackName, serviceName) {
  const stack = _vpsDockgeStacks.find(item => item.stack_name === stackName);
  const exposure = stack?.service_exposures?.[serviceName] || null;
  if (['caddy-web', 'tailnet-web'].includes(exposure?.kind) && exposure.open_url) {
    window.open(exposure.open_url, '_blank', 'noopener,noreferrer');
    return;
  }

  const { dialog, badge, title, status, error } = _vpsDockgeModalEls();
  if (!dialog) return;
  _vpsDockgeResetServiceModal();
  if (badge) badge.textContent = _vpsDockgeExposureLabel(exposure?.kind || 'internal').toUpperCase();
  if (title) title.textContent = `${stackName} / ${serviceName}`;
  if (status) status.textContent = 'Loading service information...';
  HubModal.open(dialog, { onClose: _vpsDockgeResetServiceModal });
  try {
    const r = await apiFetch(`/api/v1/vps-dockge/stacks/${encodeURIComponent(stackName)}/services/${encodeURIComponent(serviceName)}/info`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
    if (status) status.textContent = data.openapi ? 'OpenAPI schema detected.' : 'Service information loaded.';
    _vpsDockgeRenderServiceInfo(data);
  } catch (e) {
    if (status) status.textContent = '';
    if (error) error.textContent = `Failed to load service information: ${e.message}`;
  }
}

function _vpsDockgeStackErrorButton(stack) {
  if (!stack.error) return '';
  return `<button class="vps-dockge-stack-error-btn" type="button"
      title="Show stack error"
      aria-label="Show ${esc(stack.stack_name || 'stack')} error"
      data-vps-dockge-error-stack="${esc(stack.stack_name || '')}"></button>`;
}

async function openVpsDockgeStackError(stackName) {
  const stack = _vpsDockgeStacks.find(item => item.stack_name === stackName);
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

function _vpsDockgeCell(col, stack, rendered) {
  const value = rendered[col] || '';
  const className = col === 'actions' ? 'table-action-cell vps-dockge-actions-cell' : `vps-dockge-col-${col}`;
  return `<td data-col="${esc(col)}" class="${esc(className)}">${value}</td>`;
}

function _vpsDockgeVisibleCols() {
  return _ensureVpsDockgeTableView()?.getVisibleCols() || _VPS_DOCKGE_COLS;
}

function _renderVpsDockgeStackRows() {
  const tbody = document.getElementById('vps-dockge-tbody');
  if (!tbody) return;
  const rows = _vpsDockgeFilterRows(_vpsDockgeStacks || []);
  const visibleCols = _vpsDockgeVisibleCols();
  if (!rows.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${visibleCols.length || 1}">No VPS Dockge stacks found.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(stack => {
    const services = (stack.services || []).map(service => _vpsDockgeServicePill(stack, service)).join(' ');
    const containers = (stack.containers || []).map(container => _vpsDockgeRenderContainerChip(container)).join('');
    const rendered = {
      stack: `<div class="vps-dockge-stack-cell">${_vpsDockgeRenderStackName(stack)}${_vpsDockgeStackErrorButton(stack)}</div>`,
      services: services || '<span style="color:var(--text-dim)">-</span>',
      containers: containers
        ? `<div class="vps-dockge-container-list">${containers}</div>`
        : '<span style="color:var(--text-dim)">-</span>',
      status_health: `<div class="vps-dockge-status-stack">${_vpsDockgeBadge(stack.status)}${_vpsDockgeBadge(stack.health)}</div>`,
      updated: _vpsDockgeFormatUpdatedHtml(stack.updated_at),
      actions: _vpsDockgeActionButtons(stack),
    };
    return `<tr>${visibleCols.map(col => _vpsDockgeCell(col, stack, rendered)).join('')}</tr>`;
  }).join('');
  _vpsDockgeRenderActionButtonStates();
}

function renderVpsDockgeStacks() {
  const tableView = _ensureVpsDockgeTableView();
  if (tableView) {
    tableView.render(_renderVpsDockgeStackRows);
    return;
  }
  _renderVpsDockgeStackRows();
}

function _ensureVpsDockgePoll() {
  if (_vpsDockgePollInterval) return;
  _vpsDockgePollInterval = setInterval(() => {
    if (_vpsDockgeIsActive()) loadVpsDockgeStacks({ silent: true });
  }, _VPS_DOCKGE_POLL_MS);
}

async function loadVpsDockgeStacks(options = {}) {
  const err = document.getElementById('vps-dockge-error');
  const status = document.getElementById('vps-dockge-status');
  if (err) err.hidden = true;
  if (status && !options.silent) {
    status.textContent = 'Loading VPS Dockge stacks...';
    status.style.color = 'var(--text-dim)';
    status.hidden = false;
  }
  _ensureVpsDockgePoll();
  try {
    const r = await apiFetch('/api/v1/vps-dockge/stacks');
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
    _vpsDockgeStacks = data.stacks || [];
    renderVpsDockgeStacks();
    if (status) {
      const via = data.ssh_host ? ` via ${data.ssh_host}` : '';
      status.textContent = `${_vpsDockgeStacks.length} stack${_vpsDockgeStacks.length === 1 ? '' : 's'} from ${data.stacks_dir || 'VPS Dockge'}${via}`;
      status.style.color = 'var(--text-dim)';
      status.hidden = false;
    }
  } catch (e) {
    if (err) {
      err.textContent = `Failed to load VPS Dockge stacks: ${e.message}`;
      err.hidden = false;
    }
    if (status) status.hidden = true;
  }
}

async function vpsDockgeStackAction(stackName, action, btn) {
  const status = document.getElementById('vps-dockge-status');
  if (btn) btn.disabled = true;
  if (status) {
    status.textContent = `${action} ${stackName}...`;
    status.style.color = 'var(--text-dim)';
    status.hidden = false;
  }
  try {
    const r = await apiFetch(`/api/v1/vps-dockge/stacks/${encodeURIComponent(stackName)}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
    const next = data.result;
    if (next) {
      const idx = _vpsDockgeStacks.findIndex(stack => stack.stack_name === stackName);
      if (idx === -1) _vpsDockgeStacks.push(next);
      else _vpsDockgeStacks[idx] = next;
      renderVpsDockgeStacks();
    }
    if (status) {
      status.textContent = `${action} ${stackName} succeeded.`;
      status.style.color = 'var(--ok,#3fb950)';
    }
    setTimeout(() => loadVpsDockgeStacks({ silent: true }), 1200);
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
  document.getElementById('vps-dockge-search')?.addEventListener('input', renderVpsDockgeStacks);
  const vpsDockgeTbody = document.getElementById('vps-dockge-tbody');
  vpsDockgeTbody?.addEventListener('pointerdown', e => {
    const btn = e.target.closest('[data-vps-dockge-narrate-stack]');
    if (!btn) return;
    _vpsDockgeNarrationHandlePointerDown(e, btn.dataset.vpsDockgeNarrateStack);
  });
  vpsDockgeTbody?.addEventListener('pointerup', _vpsDockgeNarrationClearLongPressTimer);
  vpsDockgeTbody?.addEventListener('pointercancel', _vpsDockgeNarrationClearLongPressTimer);
  vpsDockgeTbody?.addEventListener('pointerout', e => {
    const btn = e.target.closest('[data-vps-dockge-narrate-stack]');
    if (btn && !btn.contains(e.relatedTarget)) _vpsDockgeNarrationClearLongPressTimer();
  });
  vpsDockgeTbody?.addEventListener('contextmenu', e => {
    if (e.target.closest('[data-vps-dockge-narrate-stack]')) e.preventDefault();
  });
  vpsDockgeTbody?.addEventListener('dblclick', e => {
    const narrationBtn = e.target.closest('[data-vps-dockge-narrate-stack]');
    if (!narrationBtn) return;
    e.preventDefault();
    _vpsDockgeNarrationResetClassifiers();
    _vpsDockgeNarrationFsm.dispatch(narrationBtn.dataset.vpsDockgeNarrateStack, 'doubleTap');
  });
  vpsDockgeTbody?.addEventListener('click', e => {
    const narrationBtn = e.target.closest('[data-vps-dockge-narrate-stack]');
    if (narrationBtn) {
      e.preventDefault();
      _vpsDockgeNarrationHandleClick(narrationBtn.dataset.vpsDockgeNarrateStack);
      return;
    }
    const downloadBtn = e.target.closest('[data-vps-dockge-download-stack]');
    if (downloadBtn) {
      e.preventDefault();
      _vpsDockgeDownloadNarrationMp3(downloadBtn.dataset.vpsDockgeDownloadStack, downloadBtn);
      return;
    }
    const projectBtn = e.target.closest('[data-vps-dockge-project-url]');
    if (projectBtn && projectBtn.dataset.vpsDockgeProjectUrl) {
      e.preventDefault();
      window.open(projectBtn.dataset.vpsDockgeProjectUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    const errorBtn = e.target.closest('[data-vps-dockge-error-stack]');
    if (errorBtn) {
      openVpsDockgeStackError(errorBtn.dataset.vpsDockgeErrorStack);
      return;
    }
    const serviceBtn = e.target.closest('[data-vps-dockge-service]');
    if (serviceBtn) {
      openVpsDockgeServiceInfo(serviceBtn.dataset.vpsDockgeServiceStack, serviceBtn.dataset.vpsDockgeService);
      return;
    }
    const btn = e.target.closest('[data-vps-dockge-action]');
    if (!btn) return;
    vpsDockgeStackAction(btn.dataset.vpsDockgeStack, btn.dataset.vpsDockgeAction, btn);
  });
  if (typeof ResponsiveLayout !== 'undefined') {
    ResponsiveLayout.registerTabControls('vps-dockge', 'pg-ctrl-vps-dockge');
  }
});
