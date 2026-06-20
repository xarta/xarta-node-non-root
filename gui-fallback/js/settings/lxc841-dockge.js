/* ── LXC841 Dockge ──────────────────────────────────────────────────────── */

const _LXC841_DOCKGE_POLL_MS = 30000;
const _LXC841_DOCKGE_METRICS_POLL_MS = 1000;
const _LXC841_DOCKGE_METRICS_WINDOW = 10;
const _LXC841_DOCKGE_METRICS_SEGMENTS = 16;
const _LXC841_DOCKGE_METRICS_TRACKS = 18;
const _LXC841_DOCKGE_METRICS_CPU_SCALE_CORES = 2;
const _LXC841_DOCKGE_METRICS_MEMORY_SCALE_BYTES = 8 * 1000 * 1000 * 1000;
const _LXC841_DOCKGE_COLS = ['stack', 'services', 'containers', 'status_health', 'updated', 'actions'];
const _LXC841_DOCKGE_FIELD_META = {
  stack: { label: 'Stack' },
  services: { label: 'Services' },
  containers: { label: 'Containers' },
  status_health: { label: 'Status<br>Health' },
  updated: { label: 'Updated' },
  actions: { label: 'Actions' },
};
const _LXC841_DOCKGE_PROJECT_URLS = Object.freeze({
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
let _lxc841DockgeTableView = null;
let _lxc841DockgeNarrationState = 'IDLE';
let _lxc841DockgeNarrationStack = null;
let _lxc841DockgeNarrationRunId = 0;
let _lxc841DockgeNarrationClickTimer = null;
let _lxc841DockgeNarrationLastClickAt = 0;
let _lxc841DockgeNarrationLongPressTimer = null;
let _lxc841DockgeNarrationLastLongPressAt = 0;
let _lxc841DockgeDownloadBusyStack = null;
let _lxc841DockgeLoadPromise = null;
let _lxc841DockgeMetricsPollInterval = null;
let _lxc841DockgeMetricsLoadPromise = null;
let _lxc841DockgeMetricsPulseSeq = 0;
let _lxc841DockgeLastMetricsSampleAt = '';
let _lxc841DockgeLastMetricsData = null;
const _lxc841DockgeMetricsByStack = new Map();
const _LXC841_DOCKGE_NARRATION_DOUBLE_CLICK_MS = 260;
const _LXC841_DOCKGE_NARRATION_LONG_PRESS_MS = 650;

function _ensureLxc841DockgeTableView() {
  if (_lxc841DockgeTableView || typeof TableView === 'undefined') return _lxc841DockgeTableView;
  _lxc841DockgeTableView = TableView.create({
    storageKey: 'lxc841-dockge-table-widths',
    columns: _LXC841_DOCKGE_COLS,
    meta: _LXC841_DOCKGE_FIELD_META,
    getTable: () => document.getElementById('lxc841-dockge-table'),
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
  return _lxc841DockgeTableView;
}

function _lxc841DockgeIsActive() {
  return document.getElementById('tab-lxc841-dockge')?.classList.contains('active');
}

function _lxc841DockgeProjectUrl(stackName) {
  const key = String(stackName || '').trim().toLowerCase();
  return _LXC841_DOCKGE_PROJECT_URLS[key] || null;
}

function _lxc841DockgeRenderStackName(stack) {
  const name = stack?.stack_name || '-';
  const url = _lxc841DockgeProjectUrl(name);
  if (!url) return `<strong>${esc(name)}</strong>`;
  return (
    `<a class="lxc841-dockge-stack-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" ` +
    `title="Open ${esc(name)} project website">${esc(name)}</a>`
  );
}

function _lxc841DockgeStatusTone(status) {
  const text = String(status || '').toLowerCase();
  if (text === 'running' || text === 'healthy') return 'var(--ok,#3fb950)';
  if (text === 'partial' || text === 'starting' || text === 'mixed') return 'var(--warn,#e6a817)';
  if (text === 'stopped' || text === 'none') return 'var(--text-dim)';
  if (text === 'unhealthy' || text === 'unknown') return 'var(--err,#f85149)';
  return 'var(--text-dim)';
}

function _lxc841DockgeBadge(value) {
  const label = value || 'unknown';
  return `<span style="display:inline-block;border:1px solid currentColor;border-radius:6px;padding:2px 7px;font-size:11px;color:${_lxc841DockgeStatusTone(label)}">${esc(label)}</span>`;
}

function _lxc841DockgeContainerTone(container) {
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

function _lxc841DockgeRenderContainerChip(container) {
  const label = container.name || container.service || container.id || '-';
  const state = container.state || 'unknown';
  const health = container.health || '';
  const status = container.status || '';
  const tone = _lxc841DockgeContainerTone(container);
  const titleParts = [`state: ${state}`];
  if (health) titleParts.push(`health: ${health}`);
  if (status) titleParts.push(status);
  return (
    `<span class="ip-chip lxc841-dockge-container-chip lxc841-dockge-container-chip--${esc(tone)}" ` +
    `title="${esc(titleParts.join(' | '))}">${esc(label)}:${esc(state)}</span>`
  );
}

function _lxc841DockgeFormatTime(value) {
  if (!value) return '-';
  return String(value).replace('T', ' ').replace(/\.\d+.*$/, '').replace('+00:00', '').slice(0, 19);
}

function _lxc841DockgeFormatUpdatedHtml(value) {
  const text = _lxc841DockgeFormatTime(value);
  if (text === '-') return '<span class="lxc841-dockge-updated">-</span>';
  const [date, time] = text.split(' ');
  return `<span class="lxc841-dockge-updated"><span>${esc(date || text)}</span>${time ? `<span>${esc(time)}</span>` : ''}</span>`;
}

function _lxc841DockgeClampPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, num));
}

function _lxc841DockgeFormatPercent(value) {
  const pct = _lxc841DockgeClampPercent(value);
  if (pct >= 10) return `${pct.toFixed(1)}%`;
  if (pct >= 1) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(3)}%`;
}

function _lxc841DockgeFormatBytes(value) {
  const bytes = Number(value) || 0;
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let size = Math.max(0, bytes);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const places = size >= 10 || unit === 0 ? 0 : 1;
  return `${size.toFixed(places)} ${units[unit]}`;
}

function _lxc841DockgeMetricState(stackName) {
  return _lxc841DockgeMetricsByStack.get(stackName) || null;
}

function _lxc841DockgeStackByName(stackName) {
  const target = String(stackName || '').toLowerCase();
  return (_lxc841DockgeStacks || []).find(stack => String(stack.stack_name || '').toLowerCase() === target) || null;
}

function _lxc841DockgeStackShowsResourceMotion(stack) {
  const status = String(stack?.status || '').toLowerCase();
  if (status === 'stopped' || status === 'none') return false;
  return (stack?.containers || []).some(container => String(container?.state || '').toLowerCase() === 'running');
}

function _lxc841DockgeAverageSample(samples, key) {
  const values = (samples || []).map(sample => Number(sample[key])).filter(Number.isFinite);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function _lxc841DockgeScaleCpuPercent(metric) {
  const dockerCpuPercent = Number(metric?.cpu_docker_percent);
  if (Number.isFinite(dockerCpuPercent)) {
    return _lxc841DockgeClampPercent(dockerCpuPercent / _LXC841_DOCKGE_METRICS_CPU_SCALE_CORES);
  }
  return _lxc841DockgeClampPercent(metric?.cpu_percent);
}

function _lxc841DockgeScaleMemoryPercent(memoryBytes) {
  return _lxc841DockgeClampPercent((Math.max(0, Number(memoryBytes) || 0) / _LXC841_DOCKGE_METRICS_MEMORY_SCALE_BYTES) * 100);
}

function _lxc841DockgeMetricSegmentIndex(percent) {
  const pct = _lxc841DockgeClampPercent(percent);
  const segmentSize = 100 / _LXC841_DOCKGE_METRICS_SEGMENTS;
  if (pct <= 0) return 0;
  return Math.min(_LXC841_DOCKGE_METRICS_SEGMENTS - 1, Math.ceil(pct / segmentSize) - 1);
}

function _lxc841DockgeSegmentBarHtml(kind, percent, tracePercent, pulseSeq) {
  const pct = _lxc841DockgeClampPercent(percent);
  const segmentSize = 100 / _LXC841_DOCKGE_METRICS_SEGMENTS;
  const leadIndex = _lxc841DockgeMetricSegmentIndex(pct);
  const traceIndex = Number.isFinite(Number(tracePercent)) ? _lxc841DockgeMetricSegmentIndex(tracePercent) : -1;
  const segments = [];
  for (let i = 0; i < _LXC841_DOCKGE_METRICS_SEGMENTS; i += 1) {
    const start = i * segmentSize;
    const fill = Math.max(0, Math.min(1, (pct - start) / segmentSize));
    const cls = [
      'local-dockge-resource-segment',
      fill > 0 ? 'is-filled' : '',
      pulseSeq && i === leadIndex ? 'is-pulsing' : '',
      i === traceIndex ? 'is-tracing' : '',
    ].filter(Boolean).join(' ');
    segments.push(`<span class="${cls}" style="--fill-pct:${(fill * 100).toFixed(1)}%"></span>`);
  }
  return `<div class="local-dockge-resource-bar local-dockge-resource-bar--${esc(kind)}" style="--local-dockge-resource-tracks:${_LXC841_DOCKGE_METRICS_TRACKS}">${segments.join('')}</div>`;
}

function _lxc841DockgeMetricsBarsContent(stackName) {
  const state = _lxc841DockgeMetricState(stackName);
  const stack = _lxc841DockgeStackByName(stackName);
  const showMotion = Boolean(state?.showMotion && _lxc841DockgeStackShowsResourceMotion(stack));
  const samples = state?.samples || [];
  const sampleCount = samples.length;
  const cpuPercent = _lxc841DockgeAverageSample(samples, 'cpu_percent');
  const memoryPercent = _lxc841DockgeAverageSample(samples, 'memory_percent');
  const cpuCores = _lxc841DockgeAverageSample(samples, 'cpu_cores');
  const memoryBytes = _lxc841DockgeAverageSample(samples, 'memory_bytes');
  const windowText = sampleCount
    ? `${sampleCount}s rolling average${sampleCount >= _LXC841_DOCKGE_METRICS_WINDOW ? '' : ' so far'}`
    : 'waiting for resource metrics';
  const trace = showMotion ? state?.trace : null;
  const traceCpuText = trace ? `; transient ${Number(trace.cpu_cores || 0).toFixed(3)} cores` : '';
  const traceMemText = trace ? `; transient ${_lxc841DockgeFormatBytes(trace.memory_bytes)}` : '';
  const cpuTitle = sampleCount
    ? `CPU ${_lxc841DockgeFormatPercent(cpuPercent)} of 2-core scale (${cpuCores.toFixed(3)} cores, ${windowText}${traceCpuText})`
    : 'CPU waiting for a successful metrics reading';
  const memTitle = sampleCount
    ? `RAM ${_lxc841DockgeFormatPercent(memoryPercent)} of 8 GB scale (${_lxc841DockgeFormatBytes(memoryBytes)}, ${windowText}, 500 MB per segment${traceMemText})`
    : 'RAM waiting for a successful metrics reading';
  const pulseSeq = showMotion ? (state?.pulseSeq || 0) : 0;
  return `
    <div class="local-dockge-resource-row" title="${esc(cpuTitle)}" aria-label="${esc(cpuTitle)}">
      ${_lxc841DockgeSegmentBarHtml('cpu', cpuPercent, trace?.cpu_percent, pulseSeq)}
    </div>
    <div class="local-dockge-resource-row" title="${esc(memTitle)}" aria-label="${esc(memTitle)}">
      ${_lxc841DockgeSegmentBarHtml('memory', memoryPercent, trace?.memory_percent, pulseSeq)}
    </div>`;
}

function _lxc841DockgeMetricsBarsHtml(stackName) {
  const name = stackName || '';
  return `<button class="local-dockge-resource-bars local-dockge-resource-bars--clickable" type="button"
      data-lxc841-dockge-metrics-stack="${esc(name)}"
      data-lxc841-dockge-metrics-open="${esc(name)}"
      aria-label="Open resource metrics for ${esc(name || 'stack')}">${_lxc841DockgeMetricsBarsContent(name)}</button>`;
}

function _lxc841DockgeMetricsModalContext(stackName) {
  const via = _lxc841DockgeLastMetricsData?.ssh_host ? ` via ${_lxc841DockgeLastMetricsData.ssh_host}` : '';
  return {
    surface: 'lxc841-dockge',
    surfaceLabel: '841 Dockge',
    hostLabel: `841 Dockge host${via}`,
    stackName,
    data: _lxc841DockgeLastMetricsData,
    state: _lxc841DockgeMetricState(stackName),
    scale: {
      cpuCores: _LXC841_DOCKGE_METRICS_CPU_SCALE_CORES,
      memoryBytes: _LXC841_DOCKGE_METRICS_MEMORY_SCALE_BYTES,
    },
  };
}

function _lxc841DockgeOpenMetricsModal(stackName) {
  if (typeof DockgeMetricsModal === 'undefined') return;
  DockgeMetricsModal.open(_lxc841DockgeMetricsModalContext(stackName));
}

function _lxc841DockgeRefreshMetricsModal() {
  if (typeof DockgeMetricsModal === 'undefined') return;
  const active = DockgeMetricsModal.current();
  if (active?.surface !== 'lxc841-dockge') return;
  DockgeMetricsModal.refresh(_lxc841DockgeMetricsModalContext(active.stackName));
}

function _lxc841DockgeFilterRows(stacks) {
  const q = (document.getElementById('lxc841-dockge-search')?.value || '').trim().toLowerCase();
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

function _lxc841DockgeActionButtons(stack) {
  const name = esc(stack.stack_name || '');
  const rawName = stack.stack_name || '';
  const status = String(stack.status || 'unknown').toLowerCase();
  const projectUrl = _lxc841DockgeProjectUrl(rawName);
  const buttons = [];
  if (status === 'running' || status === 'partial') {
    buttons.push(`<button class="secondary table-icon-btn table-icon-btn--restart" type="button" title="Restart stack" aria-label="Restart stack" data-lxc841-dockge-action="restart" data-lxc841-dockge-stack="${name}"></button>`);
    buttons.push(`<button class="secondary table-icon-btn table-icon-btn--power-stop" type="button" title="Stop stack" aria-label="Stop stack" data-lxc841-dockge-action="stop" data-lxc841-dockge-stack="${name}"></button>`);
  } else if (status === 'stopped') {
    buttons.push(`<button class="secondary table-icon-btn table-icon-btn--power-start" type="button" title="Start stack" aria-label="Start stack" data-lxc841-dockge-action="start" data-lxc841-dockge-stack="${name}"></button>`);
  } else {
    buttons.push(`<button class="secondary table-icon-btn table-icon-btn--restart" type="button" title="Refresh before acting on this stack" aria-label="Stack action unavailable" disabled></button>`);
  }
  buttons.push(`<button class="secondary table-icon-btn table-icon-btn--speaker lxc841-dockge-narration-btn is-idle" type="button"
      title="Speak stack condition; long press regenerates narration"
      aria-label="Speak ${name} stack condition"
      aria-pressed="false"
      data-lxc841-dockge-narrate-stack="${name}"></button>`);
  buttons.push(`<button class="secondary table-icon-btn table-icon-btn--speaker lxc841-dockge-download-btn" type="button"
      title="Generate and download MP3 narration"
      aria-label="Generate and download ${name} MP3 narration"
      data-lxc841-dockge-download-stack="${name}"></button>`);
  if (projectUrl) {
    buttons.push(`<button class="secondary table-icon-btn table-icon-btn--external" type="button"
      title="Open project repository or website"
      aria-label="Open ${name} project repository or website"
      data-lxc841-dockge-project-url="${esc(projectUrl)}"></button>`);
  } else {
    buttons.push(`<button class="secondary table-icon-btn table-icon-btn--external" type="button"
      title="No project repository configured"
      aria-label="No project repository configured for ${name}"
      disabled></button>`);
  }
  if (String(rawName).toLowerCase() === 'hermes') {
    buttons.push(`<button class="secondary table-icon-btn table-icon-btn--terminal" type="button"
      title="Open LXC841 Hermes terminal"
      aria-label="Open LXC841 Hermes terminal"
      data-ssh-terminal-target="hermes-lxc841-container"></button>`);
  } else {
    buttons.push(`<button class="secondary table-icon-btn table-icon-btn--terminal" type="button"
      title="No terminal target configured"
      aria-label="No terminal target configured for ${name}"
      disabled></button>`);
  }
  return `<div class="table-inline-actions table-inline-actions--stacked">${buttons.join('')}</div>`;
}

function _lxc841DockgeNarrationButtons() {
  return Array.from(document.querySelectorAll('[data-lxc841-dockge-narrate-stack]'));
}

function _lxc841DockgeDownloadButtons() {
  return Array.from(document.querySelectorAll('[data-lxc841-dockge-download-stack]'));
}

function _lxc841DockgeNarrationRenderButtons(message = '') {
  const activeStack = _lxc841DockgeNarrationStack;
  const state = _lxc841DockgeNarrationState;
  _lxc841DockgeNarrationButtons().forEach(btn => {
    const isActive = activeStack && btn.dataset.lxc841DockgeNarrateStack === activeStack;
    const clean = isActive ? state : 'IDLE';
    const isSpeaking = clean === 'SPEAKING';
    const isPaused = clean === 'PAUSED';
    btn.classList.toggle('is-idle', clean === 'IDLE');
    btn.classList.toggle('is-speaking', isSpeaking);
    btn.classList.toggle('is-paused', isPaused);
    btn.classList.toggle('is-generating', isActive && /generat|prepar/i.test(String(message || '')));
    btn.setAttribute('aria-pressed', isSpeaking ? 'true' : 'false');
    const stackName = btn.dataset.lxc841DockgeNarrateStack || 'stack';
    const label = isPaused
      ? `Resume ${stackName} stack audio`
      : (isSpeaking ? `Pause ${stackName} stack audio` : `Speak ${stackName} stack condition`);
    btn.setAttribute('aria-label', label);
    btn.title = `${label}; long press regenerates narration`;
  });
}

function _lxc841DockgeDownloadRenderButtons() {
  const busyStack = _lxc841DockgeDownloadBusyStack;
  _lxc841DockgeDownloadButtons().forEach(btn => {
    const stackName = btn.dataset.lxc841DockgeDownloadStack || 'stack';
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

function _lxc841DockgeRenderActionButtonStates(message = '') {
  _lxc841DockgeNarrationRenderButtons(message);
  _lxc841DockgeDownloadRenderButtons();
}

function _lxc841DockgeNarrationSetState(stackName, state = 'IDLE', message = '') {
  const clean = ['IDLE', 'SPEAKING', 'PAUSED'].includes(state) ? state : 'IDLE';
  _lxc841DockgeNarrationState = clean;
  _lxc841DockgeNarrationStack = clean === 'IDLE' && !message ? null : stackName;
  _lxc841DockgeRenderActionButtonStates(message);
  const status = document.getElementById('lxc841-dockge-status');
  if (status && message) {
    status.textContent = message;
    status.style.color = 'var(--text-dim)';
    status.hidden = false;
  }
}

function _lxc841DockgeNarrationClearClickTimer() {
  if (!_lxc841DockgeNarrationClickTimer) return;
  clearTimeout(_lxc841DockgeNarrationClickTimer);
  _lxc841DockgeNarrationClickTimer = null;
}

function _lxc841DockgeNarrationClearLongPressTimer() {
  if (!_lxc841DockgeNarrationLongPressTimer) return;
  clearTimeout(_lxc841DockgeNarrationLongPressTimer);
  _lxc841DockgeNarrationLongPressTimer = null;
}

function _lxc841DockgeNarrationResetClassifiers() {
  _lxc841DockgeNarrationClearClickTimer();
  _lxc841DockgeNarrationClearLongPressTimer();
  _lxc841DockgeNarrationLastClickAt = 0;
}

async function _lxc841DockgeNarrationStopClient() {
  if (typeof BlueprintsTtsClient !== 'undefined' && typeof BlueprintsTtsClient.stop === 'function') {
    try {
      await BlueprintsTtsClient.stop();
    } catch (e) {
      console.warn('LXC841 Dockge narration: failed to stop TTS', e);
    }
  }
}

async function _lxc841DockgeNarrationStop() {
  const stackName = _lxc841DockgeNarrationStack;
  _lxc841DockgeNarrationResetClassifiers();
  _lxc841DockgeNarrationRunId += 1;
  _lxc841DockgeNarrationSetState(stackName, 'IDLE', '');
  await _lxc841DockgeNarrationStopClient();
}

async function _lxc841DockgeNarrationPause() {
  if (typeof BlueprintsTtsClient === 'undefined' || typeof BlueprintsTtsClient.pause !== 'function') {
    await _lxc841DockgeNarrationStop();
    return;
  }
  try {
    const result = await BlueprintsTtsClient.pause();
    if (result?.paused) {
      _lxc841DockgeNarrationSetState(_lxc841DockgeNarrationStack, 'PAUSED', '');
      return;
    }
  } catch (e) {
    console.warn('LXC841 Dockge narration: failed to pause TTS', e);
  }
  await _lxc841DockgeNarrationStop();
}

async function _lxc841DockgeNarrationResume() {
  if (typeof BlueprintsTtsClient === 'undefined' || typeof BlueprintsTtsClient.resume !== 'function') {
    await _lxc841DockgeNarrationStop();
    return;
  }
  try {
    const result = await BlueprintsTtsClient.resume();
    if (result?.resumed) {
      _lxc841DockgeNarrationSetState(_lxc841DockgeNarrationStack, 'SPEAKING', '');
      return;
    }
  } catch (e) {
    console.warn('LXC841 Dockge narration: failed to resume TTS', e);
  }
  await _lxc841DockgeNarrationStop();
}

async function _lxc841DockgeNarrationMarkdown(stackName, force = false) {
  _lxc841DockgeNarrationSetState(stackName, 'SPEAKING', force ? `Regenerating ${stackName} narration...` : `Preparing ${stackName} narration...`);
  return _lxc841DockgeFetchNarrationMarkdown(stackName, force);
}

async function _lxc841DockgeFetchNarrationMarkdown(stackName, force = false) {
  const r = await apiFetch(`/api/v1/lxc841-dockge/stacks/${encodeURIComponent(stackName)}/speech`, {
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

function _lxc841DockgeDownloadFilename(stackName, contentType) {
  const safe = String(stackName || 'stack').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'stack';
  const ext = String(contentType || '').includes('wav') ? 'wav' : 'mp3';
  return `lxc841-dockge-${safe}-narration.${ext}`;
}

function _lxc841DockgeSetDownloadButtonState(btn, busy) {
  if (btn) {
    btn.disabled = busy;
    btn.classList.toggle('is-generating', busy);
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    btn.title = busy ? 'Generating MP3 narration...' : 'Generate and download MP3 narration';
  }
  _lxc841DockgeDownloadRenderButtons();
}

async function _lxc841DockgeDownloadNarrationMp3(stackName, btn) {
  if (!stackName || _lxc841DockgeDownloadBusyStack) return;
  if (typeof BlueprintsTtsClient === 'undefined' || typeof BlueprintsTtsClient.synthesize !== 'function') {
    const status = document.getElementById('lxc841-dockge-status');
    if (status) {
      status.textContent = 'TTS download unavailable.';
      status.style.color = 'var(--err,#f85149)';
      status.hidden = false;
    }
    return;
  }

  _lxc841DockgeDownloadBusyStack = stackName;
  _lxc841DockgeSetDownloadButtonState(btn, true);
  const status = document.getElementById('lxc841-dockge-status');
  if (status) {
    status.textContent = `Generating ${stackName} MP3 narration...`;
    status.style.color = 'var(--text-dim)';
    status.hidden = false;
  }

  try {
    const text = await _lxc841DockgeFetchNarrationMarkdown(stackName, false);
    const result = await BlueprintsTtsClient.synthesize({
      text,
      interrupt: false,
      mode: 'batch',
      format: 'mp3',
      timeoutMs: 360000,
      allowFallback: false,
      eventKind: 'lxc841_dockge_stack_narration_download',
      fallbackKind: 'positive',
      sanitizeText: false,
      transformProfile: 'none',
    });
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = _lxc841DockgeDownloadFilename(stackName, result.contentType);
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
    _lxc841DockgeDownloadBusyStack = null;
    _lxc841DockgeSetDownloadButtonState(btn, false);
  }
}

async function _lxc841DockgeNarrationStart(stackName, force = false) {
  if (!stackName) return;
  if (typeof BlueprintsTtsClient === 'undefined' || typeof BlueprintsTtsClient.speak !== 'function') {
    _lxc841DockgeNarrationSetState(stackName, 'IDLE', 'TTS unavailable.');
    return;
  }
  const runId = _lxc841DockgeNarrationRunId + 1;
  _lxc841DockgeNarrationRunId = runId;
  await _lxc841DockgeNarrationStopClient();
  if (runId !== _lxc841DockgeNarrationRunId) return;
  _lxc841DockgeNarrationSetState(stackName, 'SPEAKING', force ? `Regenerating ${stackName} narration...` : `Preparing ${stackName} narration...`);
  try {
    const text = await _lxc841DockgeNarrationMarkdown(stackName, force);
    if (runId !== _lxc841DockgeNarrationRunId) return;
    _lxc841DockgeNarrationSetState(stackName, 'SPEAKING', '');
    await BlueprintsTtsClient.speak({
      text,
      interrupt: true,
      mode: 'stream',
      eventKind: 'lxc841_dockge_stack_narration',
      fallbackKind: 'positive',
      sanitizeText: false,
      transformProfile: 'none',
    });
  } catch (e) {
    if (e?.name === 'AbortError') {
      if (runId === _lxc841DockgeNarrationRunId) _lxc841DockgeNarrationSetState(stackName, 'IDLE', '');
      return;
    }
    console.warn('LXC841 Dockge narration: TTS failed', e);
    const message = e?.message ? `TTS failed: ${e.message}` : 'TTS failed.';
    if (runId === _lxc841DockgeNarrationRunId) _lxc841DockgeNarrationSetState(stackName, 'IDLE', message);
    return;
  }
  if (runId === _lxc841DockgeNarrationRunId) _lxc841DockgeNarrationSetState(stackName, 'IDLE', '');
}

const _lxc841DockgeNarrationFsm = (() => {
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
    const state = _lxc841DockgeNarrationStack === stackName ? _lxc841DockgeNarrationState : 'IDLE';
    const transition = transitions[state]?.[event];
    if (!transition) return;
    for (const action of transition.actions) {
      if (action === 'start') await _lxc841DockgeNarrationStart(stackName, false);
      else if (action === 'regenerate') await _lxc841DockgeNarrationStart(stackName, true);
      else if (action === 'pause') await _lxc841DockgeNarrationPause();
      else if (action === 'resume') await _lxc841DockgeNarrationResume();
      else if (action === 'stop') await _lxc841DockgeNarrationStop();
    }
  }

  return { dispatch };
})();

function _lxc841DockgeNarrationHandleClick(stackName) {
  if (Date.now() - _lxc841DockgeNarrationLastLongPressAt < 700) return;
  _lxc841DockgeNarrationClearClickTimer();
  const now = Date.now();
  if (
    _lxc841DockgeNarrationLastClickAt
    && (now - _lxc841DockgeNarrationLastClickAt) <= _LXC841_DOCKGE_NARRATION_DOUBLE_CLICK_MS
  ) {
    _lxc841DockgeNarrationLastClickAt = 0;
    _lxc841DockgeNarrationFsm.dispatch(stackName, 'doubleTap');
    return;
  }
  _lxc841DockgeNarrationLastClickAt = now;
  _lxc841DockgeNarrationClickTimer = setTimeout(() => {
    _lxc841DockgeNarrationClickTimer = null;
    _lxc841DockgeNarrationLastClickAt = 0;
    _lxc841DockgeNarrationFsm.dispatch(stackName, 'tap');
  }, _LXC841_DOCKGE_NARRATION_DOUBLE_CLICK_MS);
}

function _lxc841DockgeNarrationHandlePointerDown(event, stackName) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  _lxc841DockgeNarrationClearLongPressTimer();
  _lxc841DockgeNarrationLongPressTimer = setTimeout(() => {
    _lxc841DockgeNarrationLongPressTimer = null;
    _lxc841DockgeNarrationLastLongPressAt = Date.now();
    _lxc841DockgeNarrationResetClassifiers();
    _lxc841DockgeNarrationFsm.dispatch(stackName, 'longPress');
  }, _LXC841_DOCKGE_NARRATION_LONG_PRESS_MS);
}

function _lxc841DockgeExposureLabel(kind) {
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

function _lxc841DockgeKindClass(kind) {
  return String(kind || 'unknown').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
}

function _lxc841DockgeServicePill(stack, service) {
  const exposure = (stack.service_exposures || {})[service] || { service, label: service, kind: 'internal' };
  const kind = exposure.kind || 'internal';
  const title = exposure.url
    ? `${exposure.label || service}: ${exposure.url}`
    : `${exposure.label || service}: ${_lxc841DockgeExposureLabel(kind)}`;
  return `<button class="lxc841-dockge-service-pill lxc841-dockge-service-pill--${esc(_lxc841DockgeKindClass(kind))}" type="button"
      title="${esc(title)}"
      data-lxc841-dockge-service="${esc(service)}"
      data-lxc841-dockge-service-stack="${esc(stack.stack_name || '')}">
      ${esc(exposure.label || service)}<span class="lxc841-dockge-service-kind">${esc(_lxc841DockgeExposureLabel(kind))}</span>
    </button>`;
}

function _lxc841DockgeModalEls() {
  return {
    dialog: document.getElementById('lxc841-dockge-service-modal'),
    badge: document.getElementById('lxc841-dockge-service-modal-badge'),
    title: document.getElementById('lxc841-dockge-service-modal-title'),
    status: document.getElementById('lxc841-dockge-service-modal-status'),
    body: document.getElementById('lxc841-dockge-service-modal-body'),
    error: document.getElementById('lxc841-dockge-service-modal-error'),
    openBtn: document.getElementById('lxc841-dockge-service-modal-open'),
  };
}

function _lxc841DockgeResetServiceModal() {
  const { dialog, badge, title, status, body, error, openBtn } = _lxc841DockgeModalEls();
  if (dialog) dialog.dataset.tone = 'info';
  if (badge) badge.textContent = 'SVC';
  if (title) title.textContent = 'LXC841 Dockge Service';
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

function _lxc841DockgeInfoRow(label, value) {
  const text = value == null || value === '' ? '-' : String(value);
  return `<div style="display:grid;grid-template-columns:110px minmax(0,1fr);gap:8px;font-size:12px;line-height:1.6;margin-bottom:6px">
    <strong style="color:var(--text-dim)">${esc(label)}</strong>
    <span style="min-width:0;overflow-wrap:anywhere">${esc(text)}</span>
  </div>`;
}

function _lxc841DockgeChecksHtml(title, checks) {
  const rows = (checks || []).map(check => {
    const ok = check.ok ? 'ok' : 'fail';
    const color = check.ok ? 'var(--ok,#3fb950)' : 'var(--text-dim)';
    const status = check.status == null ? '-' : check.status;
    return `<div class="lxc841-dockge-openapi-row">
      <span style="color:${color};text-transform:uppercase">${esc(ok)} ${esc(String(status))}</span>
      <span style="overflow-wrap:anywhere">${esc(check.url || '')}${check.error ? `<br><span style="color:var(--err,#f85149)">${esc(check.error)}</span>` : ''}</span>
    </div>`;
  }).join('');
  return `<h3>${esc(title)}</h3><div class="lxc841-dockge-openapi-paths">${rows || '<span style="color:var(--text-dim);font-size:12px">No checks run.</span>'}</div>`;
}

function _lxc841DockgeOpenApiHtml(openapi) {
  if (!openapi) {
    return `<h3>API schema</h3><p style="color:var(--text-dim);font-size:12px;line-height:1.7;margin:0">No OpenAPI schema was detected from the standard endpoints.</p>`;
  }
  const rows = (openapi.paths || []).map(row => `<div class="lxc841-dockge-openapi-row">
    <span>${esc((row.methods || []).join(', ') || '-')}</span>
    <code style="overflow-wrap:anywhere">${esc(row.path || '')}</code>
  </div>`).join('');
  return `<h3>${esc(openapi.title || 'OpenAPI')}</h3>
    ${_lxc841DockgeInfoRow('Version', openapi.version || '-')}
    ${_lxc841DockgeInfoRow('Schema', openapi.url || '-')}
    ${_lxc841DockgeInfoRow('Paths', openapi.path_count || 0)}
    ${openapi.description ? `<p style="font-size:12px;line-height:1.7;color:var(--text-dim)">${esc(openapi.description)}</p>` : ''}
    <div class="lxc841-dockge-openapi-paths">${rows || '<span style="color:var(--text-dim);font-size:12px">No paths listed.</span>'}</div>`;
}

function _lxc841DockgeRenderServiceInfo(data) {
  const { body, openBtn } = _lxc841DockgeModalEls();
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
  body.innerHTML = `<div class="lxc841-dockge-service-modal-grid">
    <div class="lxc841-dockge-service-modal-panel">
      <h3>Service</h3>
      ${_lxc841DockgeInfoRow('Stack', data.stack_name)}
      ${_lxc841DockgeInfoRow('Service', exposure.service || data.service)}
      ${_lxc841DockgeInfoRow('Kind', _lxc841DockgeExposureLabel(exposure.kind))}
      ${_lxc841DockgeInfoRow('Source', exposure.source || '-')}
      ${_lxc841DockgeInfoRow('URL', exposure.url || '-')}
      ${_lxc841DockgeInfoRow('Open URL', exposure.open_url || '-')}
      ${_lxc841DockgeInfoRow('Upstream', route.upstream || '-')}
      ${_lxc841DockgeInfoRow('Ports', ports || '-')}
      ${exposure.description ? `<p style="font-size:12px;line-height:1.7">${esc(exposure.description)}</p>` : ''}
      ${exposure.notes ? `<p style="font-size:12px;line-height:1.7;color:var(--text-dim)">${esc(exposure.notes)}</p>` : ''}
      <h3 style="margin-top:14px">Tests</h3>
      <p style="font-size:12px;line-height:1.7;color:var(--text-dim);margin:0">${esc(data.tests?.detail || exposure.tests_todo || 'Tests can be added later.')}</p>
    </div>
    <div class="lxc841-dockge-service-modal-panel">
      ${_lxc841DockgeOpenApiHtml(data.openapi)}
    </div>
    <div class="lxc841-dockge-service-modal-panel">
      ${_lxc841DockgeChecksHtml('Endpoint checks', [data.home_check].filter(Boolean))}
    </div>
    <div class="lxc841-dockge-service-modal-panel">
      ${_lxc841DockgeChecksHtml('OpenAPI checks', data.openapi_checks)}
      <div style="height:12px"></div>
      ${_lxc841DockgeChecksHtml('Docs checks', data.docs_checks)}
    </div>
  </div>`;
}

async function openLxc841DockgeServiceInfo(stackName, serviceName) {
  const stack = _lxc841DockgeStacks.find(item => item.stack_name === stackName);
  const exposure = stack?.service_exposures?.[serviceName] || null;
  if (['caddy-web', 'tailnet-web'].includes(exposure?.kind) && exposure.open_url) {
    window.open(exposure.open_url, '_blank', 'noopener,noreferrer');
    return;
  }

  const { dialog, badge, title, status, error } = _lxc841DockgeModalEls();
  if (!dialog) return;
  _lxc841DockgeResetServiceModal();
  if (badge) badge.textContent = _lxc841DockgeExposureLabel(exposure?.kind || 'internal').toUpperCase();
  if (title) title.textContent = `${stackName} / ${serviceName}`;
  if (status) status.textContent = 'Loading service information...';
  HubModal.open(dialog, { onClose: _lxc841DockgeResetServiceModal });
  try {
    const r = await apiFetch(`/api/v1/lxc841-dockge/stacks/${encodeURIComponent(stackName)}/services/${encodeURIComponent(serviceName)}/info`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
    if (status) status.textContent = data.openapi ? 'OpenAPI schema detected.' : 'Service information loaded.';
    _lxc841DockgeRenderServiceInfo(data);
  } catch (e) {
    if (status) status.textContent = '';
    if (error) error.textContent = `Failed to load service information: ${e.message}`;
  }
}

function _lxc841DockgeStackErrorButton(stack) {
  if (!stack.error) return '';
  return `<button class="lxc841-dockge-stack-error-btn" type="button"
      title="Show stack error"
      aria-label="Show ${esc(stack.stack_name || 'stack')} error"
      data-lxc841-dockge-error-stack="${esc(stack.stack_name || '')}"></button>`;
}

async function openLxc841DockgeStackError(stackName) {
  const stack = _lxc841DockgeStacks.find(item => item.stack_name === stackName);
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

function _lxc841DockgeCell(col, stack, rendered) {
  const value = rendered[col] || '';
  const className = col === 'actions' ? 'table-action-cell lxc841-dockge-actions-cell' : `lxc841-dockge-col-${col}`;
  return `<td data-col="${esc(col)}" class="${esc(className)}">${value}</td>`;
}

function _lxc841DockgeVisibleCols() {
  return _ensureLxc841DockgeTableView()?.getVisibleCols() || _LXC841_DOCKGE_COLS;
}

function _renderLxc841DockgeStackRows() {
  const tbody = document.getElementById('lxc841-dockge-tbody');
  if (!tbody) return;
  const rows = _lxc841DockgeFilterRows(_lxc841DockgeStacks || []);
  const visibleCols = _lxc841DockgeVisibleCols();
  if (!rows.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${visibleCols.length || 1}">No LXC841 Dockge stacks found.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(stack => {
    const services = (stack.services || []).map(service => _lxc841DockgeServicePill(stack, service)).join(' ');
    const containers = (stack.containers || []).map(container => _lxc841DockgeRenderContainerChip(container)).join('');
    const rendered = {
      stack: `<div class="lxc841-dockge-stack-cell">
        <div class="lxc841-dockge-stack-title">${_lxc841DockgeRenderStackName(stack)}${_lxc841DockgeStackErrorButton(stack)}</div>
        ${_lxc841DockgeMetricsBarsHtml(stack.stack_name || '')}
      </div>`,
      services: services || '<span style="color:var(--text-dim)">-</span>',
      containers: containers
        ? `<div class="lxc841-dockge-container-list">${containers}</div>`
        : '<span style="color:var(--text-dim)">-</span>',
      status_health: `<div class="lxc841-dockge-status-stack">${_lxc841DockgeBadge(stack.status)}${_lxc841DockgeBadge(stack.health)}</div>`,
      updated: _lxc841DockgeFormatUpdatedHtml(stack.updated_at),
      actions: _lxc841DockgeActionButtons(stack),
    };
    return `<tr>${visibleCols.map(col => _lxc841DockgeCell(col, stack, rendered)).join('')}</tr>`;
  }).join('');
  _lxc841DockgeRenderActionButtonStates();
}

function renderLxc841DockgeStacks() {
  const tableView = _ensureLxc841DockgeTableView();
  if (tableView) {
    tableView.render(_renderLxc841DockgeStackRows);
    return;
  }
  _renderLxc841DockgeStackRows();
}

function _updateLxc841DockgeMetricsDom() {
  document.querySelectorAll('[data-lxc841-dockge-metrics-stack]').forEach(el => {
    el.innerHTML = _lxc841DockgeMetricsBarsContent(el.dataset.lxc841DockgeMetricsStack || '');
  });
}

function _lxc841DockgeApplyMetrics(data) {
  const sampleAt = data.updated_at || '';
  if (!data.sample_ready || (sampleAt && sampleAt === _lxc841DockgeLastMetricsSampleAt)) return;
  _lxc841DockgeLastMetricsSampleAt = sampleAt;
  _lxc841DockgeLastMetricsData = data;
  const metricByStack = new Map((data.stacks || []).map(item => [item.stack_name, item]));
  const pulseSeq = _lxc841DockgeMetricsPulseSeq + 1;
  _lxc841DockgeMetricsPulseSeq = pulseSeq;

  (_lxc841DockgeStacks || []).forEach(stack => {
    const stackName = stack.stack_name || '';
    if (!stackName) return;
    const hasMetric = metricByStack.has(stackName);
    const metric = metricByStack.get(stackName) || {};
    const prev = _lxc841DockgeMetricsByStack.get(stackName) || { samples: [] };
    const memoryBytes = Math.max(0, Number(metric.memory_bytes) || 0);
    const cpuDockerPercent = Math.max(0, Number(metric.cpu_docker_percent) || 0);
    const cpuPercent = _lxc841DockgeScaleCpuPercent(metric);
    const memoryPercent = _lxc841DockgeScaleMemoryPercent(memoryBytes);
    const showMotion = hasMetric && _lxc841DockgeStackShowsResourceMotion(stack);
    const samples = [...(prev.samples || []), {
      cpu_percent: cpuPercent,
      cpu_cores: cpuDockerPercent / 100,
      memory_percent: memoryPercent,
      memory_bytes: memoryBytes,
      sampled_at: data.updated_at || new Date().toISOString(),
    }].slice(-_LXC841_DOCKGE_METRICS_WINDOW);
    _lxc841DockgeMetricsByStack.set(stackName, {
      samples,
      pulseSeq: showMotion ? pulseSeq : 0,
      showMotion,
      metric,
      trace: showMotion ? {
        cpu_percent: cpuPercent,
        cpu_cores: cpuDockerPercent / 100,
        memory_percent: memoryPercent,
        memory_bytes: memoryBytes,
      } : null,
      updated_at: data.updated_at || '',
    });
  });
  _updateLxc841DockgeMetricsDom();
  _lxc841DockgeRefreshMetricsModal();
}

async function loadLxc841DockgeMetrics() {
  if (_lxc841DockgeMetricsLoadPromise) return _lxc841DockgeMetricsLoadPromise;
  if (!_lxc841DockgeIsActive() || document.visibilityState === 'hidden') return null;
  _lxc841DockgeMetricsLoadPromise = (async () => {
    const r = await apiFetch('/api/v1/lxc841-dockge/metrics', { cache: 'no-store' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) throw new Error(data.detail || `HTTP ${r.status}`);
    _lxc841DockgeApplyMetrics(data);
    return data;
  })();
  try {
    return await _lxc841DockgeMetricsLoadPromise;
  } catch (e) {
    console.warn('LXC841 Dockge metrics failed', e);
    return null;
  } finally {
    _lxc841DockgeMetricsLoadPromise = null;
  }
}

function _ensureLxc841DockgeMetricsPoll() {
  if (_lxc841DockgeMetricsPollInterval) return;
  _lxc841DockgeMetricsPollInterval = setInterval(() => {
    if (_lxc841DockgeIsActive() && document.visibilityState !== 'hidden') {
      loadLxc841DockgeMetrics();
    }
  }, _LXC841_DOCKGE_METRICS_POLL_MS);
}

function _ensureLxc841DockgePoll() {
  if (_lxc841DockgePollInterval) return;
  _lxc841DockgePollInterval = setInterval(() => {
    if (_lxc841DockgeIsActive()) loadLxc841DockgeStacks({ silent: true });
  }, _LXC841_DOCKGE_POLL_MS);
}

function scheduleLxc841DockgeStacksLoad(options = {}) {
  window.setTimeout(() => loadLxc841DockgeStacks(options), 0);
}

async function loadLxc841DockgeStacks(options = {}) {
  if (_lxc841DockgeLoadPromise) return _lxc841DockgeLoadPromise;
  const err = document.getElementById('lxc841-dockge-error');
  const status = document.getElementById('lxc841-dockge-status');
  if (err) err.hidden = true;
  if (status && !options.silent) {
    status.textContent = 'Loading LXC841 Dockge stacks...';
    status.style.color = 'var(--text-dim)';
    status.hidden = false;
  }
  _ensureLxc841DockgePoll();
  _ensureLxc841DockgeMetricsPoll();
  _lxc841DockgeLoadPromise = (async () => {
    const r = await apiFetch('/api/v1/lxc841-dockge/stacks');
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
    _lxc841DockgeStacks = data.stacks || [];
    renderLxc841DockgeStacks();
    if (_lxc841DockgeIsActive()) loadLxc841DockgeMetrics();
    if (status) {
      const via = data.ssh_host ? ` via ${data.ssh_host}` : '';
      status.textContent = `${_lxc841DockgeStacks.length} stack${_lxc841DockgeStacks.length === 1 ? '' : 's'} from ${data.stacks_dir || 'LXC841 Dockge'}${via}`;
      status.style.color = 'var(--text-dim)';
      status.hidden = false;
    }
  })();
  try {
    await _lxc841DockgeLoadPromise;
  } catch (e) {
    if (err) {
      err.textContent = `Failed to load LXC841 Dockge stacks: ${e.message}`;
      err.hidden = false;
    }
    if (status) status.hidden = true;
  } finally {
    _lxc841DockgeLoadPromise = null;
  }
}

async function lxc841DockgeStackAction(stackName, action, btn) {
  const status = document.getElementById('lxc841-dockge-status');
  if (btn) btn.disabled = true;
  if (status) {
    status.textContent = `${action} ${stackName}...`;
    status.style.color = 'var(--text-dim)';
    status.hidden = false;
  }
  try {
    const r = await apiFetch(`/api/v1/lxc841-dockge/stacks/${encodeURIComponent(stackName)}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
    const next = data.result;
    if (next) {
      const idx = _lxc841DockgeStacks.findIndex(stack => stack.stack_name === stackName);
      if (idx === -1) _lxc841DockgeStacks.push(next);
      else _lxc841DockgeStacks[idx] = next;
      renderLxc841DockgeStacks();
    }
    if (status) {
      status.textContent = `${action} ${stackName} succeeded.`;
      status.style.color = 'var(--ok,#3fb950)';
    }
    setTimeout(() => loadLxc841DockgeStacks({ silent: true }), 1200);
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
  document.getElementById('lxc841-dockge-search')?.addEventListener('input', renderLxc841DockgeStacks);
  const lxc841DockgeTbody = document.getElementById('lxc841-dockge-tbody');
  lxc841DockgeTbody?.addEventListener('pointerdown', e => {
    const btn = e.target.closest('[data-lxc841-dockge-narrate-stack]');
    if (!btn) return;
    _lxc841DockgeNarrationHandlePointerDown(e, btn.dataset.lxc841DockgeNarrateStack);
  });
  lxc841DockgeTbody?.addEventListener('pointerup', _lxc841DockgeNarrationClearLongPressTimer);
  lxc841DockgeTbody?.addEventListener('pointercancel', _lxc841DockgeNarrationClearLongPressTimer);
  lxc841DockgeTbody?.addEventListener('pointerout', e => {
    const btn = e.target.closest('[data-lxc841-dockge-narrate-stack]');
    if (btn && !btn.contains(e.relatedTarget)) _lxc841DockgeNarrationClearLongPressTimer();
  });
  lxc841DockgeTbody?.addEventListener('contextmenu', e => {
    if (e.target.closest('[data-lxc841-dockge-narrate-stack]')) e.preventDefault();
  });
  lxc841DockgeTbody?.addEventListener('dblclick', e => {
    const narrationBtn = e.target.closest('[data-lxc841-dockge-narrate-stack]');
    if (!narrationBtn) return;
    e.preventDefault();
    _lxc841DockgeNarrationResetClassifiers();
    _lxc841DockgeNarrationFsm.dispatch(narrationBtn.dataset.lxc841DockgeNarrateStack, 'doubleTap');
  });
  lxc841DockgeTbody?.addEventListener('click', e => {
    const metricsBtn = e.target.closest('[data-lxc841-dockge-metrics-open]');
    if (metricsBtn) {
      e.preventDefault();
      _lxc841DockgeOpenMetricsModal(metricsBtn.dataset.lxc841DockgeMetricsOpen || '');
      return;
    }
    const narrationBtn = e.target.closest('[data-lxc841-dockge-narrate-stack]');
    if (narrationBtn) {
      e.preventDefault();
      _lxc841DockgeNarrationHandleClick(narrationBtn.dataset.lxc841DockgeNarrateStack);
      return;
    }
    const downloadBtn = e.target.closest('[data-lxc841-dockge-download-stack]');
    if (downloadBtn) {
      e.preventDefault();
      _lxc841DockgeDownloadNarrationMp3(downloadBtn.dataset.lxc841DockgeDownloadStack, downloadBtn);
      return;
    }
    const projectBtn = e.target.closest('[data-lxc841-dockge-project-url]');
    if (projectBtn && projectBtn.dataset.lxc841DockgeProjectUrl) {
      e.preventDefault();
      window.open(projectBtn.dataset.lxc841DockgeProjectUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    const terminalBtn = e.target.closest('[data-ssh-terminal-target]');
    if (terminalBtn) {
      e.preventDefault();
      if (typeof openSshTerminalTarget === 'function') {
        openSshTerminalTarget(terminalBtn.dataset.sshTerminalTarget);
      }
      return;
    }
    const errorBtn = e.target.closest('[data-lxc841-dockge-error-stack]');
    if (errorBtn) {
      openLxc841DockgeStackError(errorBtn.dataset.lxc841DockgeErrorStack);
      return;
    }
    const serviceBtn = e.target.closest('[data-lxc841-dockge-service]');
    if (serviceBtn) {
      openLxc841DockgeServiceInfo(serviceBtn.dataset.lxc841DockgeServiceStack, serviceBtn.dataset.lxc841DockgeService);
      return;
    }
    const btn = e.target.closest('[data-lxc841-dockge-action]');
    if (!btn) return;
    lxc841DockgeStackAction(btn.dataset.lxc841DockgeStack, btn.dataset.lxc841DockgeAction, btn);
  });
  if (typeof ResponsiveLayout !== 'undefined') {
    ResponsiveLayout.registerTabControls('lxc841-dockge', 'pg-ctrl-lxc841-dockge');
  }
});
