/* ── SSH Terminal ─────────────────────────────────────────────────────── */

'use strict';

let _sshTerminalTargets = [];
let _sshTerminalTargetId = '';
let _sshTerminalTerm = null;
let _sshTerminalWs = null;
let _sshTerminalResizeObserver = null;
let _sshTerminalLastSize = { cols: 100, rows: 28 };
let _sshTerminalHasAutoConnected = false;
let _sshTerminalManualDisconnect = false;

function _sshTerminalEls() {
  return {
    target: document.getElementById('ssh-terminal-target'),
    connect: document.getElementById('ssh-terminal-connect'),
    disconnect: document.getElementById('ssh-terminal-disconnect'),
    fullscreen: document.getElementById('ssh-terminal-fullscreen'),
    status: document.getElementById('ssh-terminal-status'),
    shell: document.getElementById('ssh-terminal-shell'),
    xterm: document.getElementById('ssh-terminal-xterm'),
  };
}

function _sshTerminalSetStatus(message, tone = '') {
  const { status } = _sshTerminalEls();
  if (!status) return;
  status.textContent = message || '';
  status.style.color = tone === 'error'
    ? 'var(--err,#f85149)'
    : (tone === 'ok' ? 'var(--ok,#3fb950)' : 'var(--text-dim)');
}

function _sshTerminalViewportHeight() {
  if (window.visualViewport && Number.isFinite(window.visualViewport.height) && window.visualViewport.height > 0) {
    return window.visualViewport.height;
  }
  return window.innerHeight || document.documentElement.clientHeight || 720;
}

function _sshTerminalIsActiveTab() {
  return document.getElementById('tab-ssh-terminal')?.classList.contains('active');
}

function _sshTerminalApplyShellSize() {
  const { shell } = _sshTerminalEls();
  if (!shell || !_sshTerminalIsActiveTab()) return;
  const top = Math.max(0, shell.getBoundingClientRect().top);
  const height = Math.max(220, Math.floor(_sshTerminalViewportHeight() - top));
  shell.style.height = `${height}px`;
  shell.style.minHeight = `${height}px`;
  shell.style.maxHeight = `${height}px`;
}

function _sshTerminalSetConnected(connected) {
  const { connect, disconnect, target } = _sshTerminalEls();
  if (connect) connect.disabled = !!connected;
  if (disconnect) disconnect.disabled = !connected;
  if (target) target.disabled = !!connected;
  if (typeof SettingsMenuConfig !== 'undefined') {
    window.setTimeout(() => SettingsMenuConfig.updateActiveTab('ssh-terminal'), 0);
  }
}

function _sshTerminalMeasure() {
  _sshTerminalApplyShellSize();
  const { xterm } = _sshTerminalEls();
  if (!xterm) return { cols: 100, rows: 28 };
  const rect = xterm.getBoundingClientRect();
  const cell = _sshTerminalCellSize();
  const cols = Math.max(40, Math.min(240, Math.floor((rect.width - 16) / cell.width)));
  const rows = Math.max(10, Math.min(80, Math.floor((rect.height - 16) / cell.height)));
  return { cols, rows };
}

function _sshTerminalCellSize() {
  // xterm exposes its measured cell dimensions internally; using them keeps
  // the browser viewport and PTY row count aligned after font/layout settle.
  const cell = _sshTerminalTerm?._core?._renderService?.dimensions?.css?.cell;
  const width = Number(cell?.width);
  const height = Number(cell?.height);
  return {
    width: Number.isFinite(width) && width > 0 ? width : 9,
    height: Number.isFinite(height) && height > 0 ? height : 17,
  };
}

function _sshTerminalResize(send = true, force = false) {
  if (!_sshTerminalTerm) return;
  _sshTerminalApplyShellSize();
  const size = _sshTerminalMeasure();
  if (!force && size.cols === _sshTerminalLastSize.cols && size.rows === _sshTerminalLastSize.rows) return;
  _sshTerminalLastSize = size;
  _sshTerminalTerm.resize(size.cols, size.rows);
  if (send && _sshTerminalWs && _sshTerminalWs.readyState === WebSocket.OPEN) {
    _sshTerminalWs.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
  }
}

function _sshTerminalScheduleSettledResize(send = true) {
  [0, 40, 180, 500, 1000, 1800].forEach(delay => {
    window.setTimeout(() => _sshTerminalResize(send, true), delay);
  });
}

function _sshTerminalShouldAutoShade() {
  return _sshTerminalIsActiveTab()
    && window.matchMedia
    && window.matchMedia('(max-width: 600px) and (orientation: portrait)').matches;
}

function _sshTerminalSyncPortraitMode() {
  document.body.classList.toggle('ssh-terminal-phone-portrait', !!_sshTerminalShouldAutoShade());
}

function _sshTerminalRevealShellIfNeeded() {
  const { shell } = _sshTerminalEls();
  if (!shell || !_sshTerminalShouldAutoShade()) return;
  const rect = shell.getBoundingClientRect();
  const viewportH = _sshTerminalViewportHeight();
  if (rect.top >= viewportH || rect.bottom <= 24) {
    shell.scrollIntoView({ block: 'start', inline: 'nearest' });
  }
}

function _sshTerminalEnsurePortraitVisibility() {
  _sshTerminalSyncPortraitMode();
  if (!_sshTerminalShouldAutoShade()) return;
  window.BodyShade?.syncActiveHandle?.();
  if (!document.body.classList.contains('shade-is-up')) window.BodyShade?.snapUp?.();
  _sshTerminalScheduleSettledResize(true);
  [80, 360, 760].forEach(delay => {
    window.setTimeout(() => {
      _sshTerminalResize(true, true);
      _sshTerminalRevealShellIfNeeded();
    }, delay);
  });
}

function _sshTerminalEnsureTerminal() {
  if (_sshTerminalTerm) return _sshTerminalTerm;
  if (typeof Terminal === 'undefined') {
    _sshTerminalSetStatus('Terminal renderer unavailable.', 'error');
    return null;
  }
  const { xterm } = _sshTerminalEls();
  if (!xterm) return null;

  _sshTerminalTerm = new Terminal({
    cursorBlink: true,
    convertEol: false,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.25,
    scrollback: 6000,
    theme: {
      background: '#05070b',
      foreground: '#d7deea',
      cursor: '#5b9cf6',
      selectionBackground: '#244f87',
      black: '#05070b',
      red: '#f85149',
      green: '#3fb950',
      yellow: '#e6a817',
      blue: '#5b9cf6',
      magenta: '#c586f7',
      cyan: '#39c5cf',
      white: '#d7deea',
      brightBlack: '#7b82a0',
      brightWhite: '#ffffff',
    },
  });
  _sshTerminalTerm.open(xterm);
  _sshTerminalTerm.onData(data => {
    if (_sshTerminalWs && _sshTerminalWs.readyState === WebSocket.OPEN) {
      _sshTerminalWs.send(JSON.stringify({ type: 'input', data }));
    }
  });
  _sshTerminalResizeObserver = new ResizeObserver(() => _sshTerminalResize(true));
  _sshTerminalResizeObserver.observe(xterm);
  _sshTerminalScheduleSettledResize(false);
  return _sshTerminalTerm;
}

async function _sshTerminalLoadTargets() {
  const { target } = _sshTerminalEls();
  const r = await apiFetch('/api/v1/ssh-terminal/targets');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  _sshTerminalTargets = await r.json();
  if (typeof window._settingsSyncSshTerminalTargetMenu === 'function') {
    window._settingsSyncSshTerminalTargetMenu(_sshTerminalTargets);
  }
  if (target) {
    target.innerHTML = _sshTerminalTargets.map(item => (
      `<option value="${esc(item.target_id || '')}" ${item.enabled ? '' : 'disabled'}>${esc(item.label || item.target_id || '')}</option>`
    )).join('');
  }
  if (_sshTerminalTargetId && _sshTerminalTargets.some(item => item.target_id === _sshTerminalTargetId)) {
    if (target) target.value = _sshTerminalTargetId;
  } else {
    const firstEnabled = _sshTerminalTargets.find(item => item.enabled !== false) || _sshTerminalTargets[0];
    if (!firstEnabled) return;
    _sshTerminalTargetId = firstEnabled.target_id;
    if (target) target.value = _sshTerminalTargetId;
  }
}

function _sshTerminalEnsureSettingsGroup() {
  const bridge = window.BlueprintsHubMenuBridge;
  if (bridge && bridge.activeGroup && bridge.activeGroup !== 'settings') {
    if (typeof switchGroup === 'function') switchGroup('settings');
    return;
  }
  if (typeof SettingsMenuConfig !== 'undefined') {
    SettingsMenuConfig.showGroup();
    SettingsMenuConfig.updateActiveTab('ssh-terminal');
  }
}

async function _sshTerminalConnect() {
  const term = _sshTerminalEnsureTerminal();
  const { target } = _sshTerminalEls();
  if (!term) return;
  if (_sshTerminalWs && _sshTerminalWs.readyState === WebSocket.OPEN) return;

  _sshTerminalManualDisconnect = false;
  _sshTerminalTargetId = target?.value || _sshTerminalTargetId || 'local-hermes-container';
  const selected = _sshTerminalTargets.find(item => item.target_id === _sshTerminalTargetId);
  if (selected && selected.enabled === false) {
    _sshTerminalSetStatus(`${selected.label || selected.target_id} is pending.`, 'error');
    _sshTerminalSetConnected(false);
    return;
  }
  _sshTerminalLastSize = _sshTerminalMeasure();
  term.clear();
  term.writeln(`Connecting to ${_sshTerminalTargetId}...`);
  _sshTerminalSetStatus('Connecting...');
  _sshTerminalSetConnected(true);

  const secret = localStorage.getItem(_LS_SECRET_KEY) || '';
  const token = await _computeApiToken(secret, '/api/v1/ssh-terminal/ws');
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams({
    target: _sshTerminalTargetId,
    token,
    cols: String(_sshTerminalLastSize.cols),
    rows: String(_sshTerminalLastSize.rows),
  });
  const ws = new WebSocket(`${proto}//${window.location.host}/api/v1/ssh-terminal/ws?${params.toString()}`);
  _sshTerminalWs = ws;

  ws.addEventListener('open', () => {
    term.clear();
    term.focus();
    _sshTerminalSetStatus('Connected.', 'ok');
    _sshTerminalEnsurePortraitVisibility();
    _sshTerminalScheduleSettledResize(true);
  });
  ws.addEventListener('message', event => {
    term.write(String(event.data || ''));
  });
  ws.addEventListener('close', event => {
    if (_sshTerminalWs !== ws) return;
    _sshTerminalWs = null;
    _sshTerminalSetConnected(false);
    const clean = event.code === 1000 || event.code === 1001;
    _sshTerminalSetStatus(clean ? 'Disconnected.' : `Disconnected (${event.code}).`, clean ? '' : 'error');
  });
  ws.addEventListener('error', () => {
    _sshTerminalSetStatus('Terminal websocket error.', 'error');
  });
}

function _sshTerminalDisconnect() {
  _sshTerminalManualDisconnect = true;
  _sshTerminalHasAutoConnected = true;
  document.body.classList.remove('ssh-terminal-phone-portrait');
  const disconnectedTarget = _sshTerminalTargetId || 'local-hermes-container';
  if (_sshTerminalTerm) {
    _sshTerminalTerm.writeln(`\r\n[Disconnected from ${disconnectedTarget}]`);
  }
  if (_sshTerminalWs) {
    const ws = _sshTerminalWs;
    _sshTerminalWs = null;
    try {
      ws.close(1000, 'closed by browser');
    } catch (e) {}
  }
  const targetId = disconnectedTarget;
  apiFetch(`/api/v1/ssh-terminal/targets/${encodeURIComponent(targetId)}/disconnect`, { method: 'POST' })
    .catch(() => {});
  _sshTerminalSetConnected(false);
  _sshTerminalSetStatus('Disconnected.');
}

function _sshTerminalToggleFullscreen() {
  const isShadeUp = document.body.classList.contains('shade-is-up');
  if (isShadeUp) window.BodyShade?.snapDown?.();
  else window.BodyShade?.snapUp?.();
  if (typeof SettingsMenuConfig !== 'undefined') SettingsMenuConfig.updateActiveTab('ssh-terminal');
  _sshTerminalScheduleSettledResize(true);
}

async function _sshTerminalLoadTab() {
  _sshTerminalEnsureTerminal();
  try {
    _sshTerminalSyncPortraitMode();
    await _sshTerminalLoadTargets();
    _sshTerminalSetStatus(_sshTerminalWs ? 'Connected.' : 'Ready.');
    _sshTerminalScheduleSettledResize(true);
    window.setTimeout(_sshTerminalEnsurePortraitVisibility, 120);
    if (!_sshTerminalWs && !_sshTerminalHasAutoConnected && !_sshTerminalManualDisconnect) {
      _sshTerminalHasAutoConnected = true;
      window.setTimeout(() => _sshTerminalConnect(), 80);
    }
  } catch (e) {
    _sshTerminalSetStatus(`Unable to load terminal targets: ${e.message}`, 'error');
  }
}

function openSshTerminalTarget(targetId, options = {}) {
  const nextTargetId = targetId || 'local-hermes-container';
  const previousTargetId = _sshTerminalTargetId || 'local-hermes-container';
  if (_sshTerminalWs && previousTargetId !== nextTargetId) {
    _sshTerminalTargetId = previousTargetId;
    _sshTerminalDisconnect();
  }
  _sshTerminalTargetId = nextTargetId;
  if (options.connect !== false) {
    _sshTerminalHasAutoConnected = false;
    _sshTerminalManualDisconnect = false;
  }
  if (_sshTerminalTerm) {
    _sshTerminalTerm.writeln(`\r\n[Switching to ${nextTargetId}]`);
  }
  _sshTerminalEnsureSettingsGroup();
  if (typeof switchTab === 'function') switchTab('ssh-terminal');
  _sshTerminalSyncPortraitMode();
  if (typeof SettingsMenuConfig !== 'undefined') SettingsMenuConfig.updateActiveTab('ssh-terminal');
  window.setTimeout(() => {
    const { target } = _sshTerminalEls();
    if (target && _sshTerminalTargetId) target.value = _sshTerminalTargetId;
    _sshTerminalLoadTab();
  }, 0);
}

function _sshTerminalSelectLocalHermes() {
  openSshTerminalTarget('local-hermes-container');
}

function _sshTerminalSelectLocalHermesSetup() {
  openSshTerminalTarget('local-hermes-setup');
}

function _sshTerminalOpenHermesAgent() {
  if ((_sshTerminalTargetId || '').startsWith('hermes-vps')) {
    openSshTerminalTarget('hermes-vps-agent');
    return;
  }
  openSshTerminalTarget('local-hermes');
}

function _sshTerminalOpenHermesSetup() {
  if ((_sshTerminalTargetId || '').startsWith('hermes-vps')) {
    openSshTerminalTarget('hermes-vps-setup');
    return;
  }
  openSshTerminalTarget('local-hermes-setup');
}

function _sshTerminalCurrentTargetId() {
  return _sshTerminalTargetId || 'local-hermes-container';
}

function _sshTerminalCurrentTargetIsHermes() {
  const targetId = _sshTerminalCurrentTargetId();
  return targetId.startsWith('local-hermes') || targetId.startsWith('hermes-vps');
}

function _sshTerminalIsConnected() {
  return !!(_sshTerminalWs && _sshTerminalWs.readyState === WebSocket.OPEN);
}

function _sshTerminalFullscreenLabel() {
  return document.body.classList.contains('shade-is-up')
    ? 'Exit Full Screen'
    : 'Full Screen';
}

function _sshTerminalInit() {
  const { target, connect, disconnect, fullscreen } = _sshTerminalEls();
  target?.addEventListener('change', () => { _sshTerminalTargetId = target.value; });
  connect?.addEventListener('click', _sshTerminalConnect);
  disconnect?.addEventListener('click', _sshTerminalDisconnect);
  fullscreen?.addEventListener('click', _sshTerminalToggleFullscreen);
  window.addEventListener('resize', () => {
    _sshTerminalSyncPortraitMode();
    _sshTerminalResize(true);
  }, { passive: true });
  window.visualViewport?.addEventListener('resize', () => {
    _sshTerminalSyncPortraitMode();
    _sshTerminalResize(true);
  }, { passive: true });
  document.addEventListener('bodyshadechange', () => {
    if (typeof SettingsMenuConfig !== 'undefined') SettingsMenuConfig.updateActiveTab('ssh-terminal');
    _sshTerminalScheduleSettledResize(true);
  });
  const urlTarget = new URLSearchParams(window.location.search).get('terminal');
  if (urlTarget) _sshTerminalTargetId = urlTarget;
}

document.addEventListener('DOMContentLoaded', _sshTerminalInit);
window.openSshTerminalTarget = openSshTerminalTarget;
window._sshTerminalConnect = _sshTerminalConnect;
window._sshTerminalDisconnect = _sshTerminalDisconnect;
window._sshTerminalToggleFullscreen = _sshTerminalToggleFullscreen;
window._sshTerminalSelectLocalHermes = _sshTerminalSelectLocalHermes;
window._sshTerminalSelectLocalHermesSetup = _sshTerminalSelectLocalHermesSetup;
window._sshTerminalOpenHermesAgent = _sshTerminalOpenHermesAgent;
window._sshTerminalOpenHermesSetup = _sshTerminalOpenHermesSetup;
window._sshTerminalCurrentTargetId = _sshTerminalCurrentTargetId;
window._sshTerminalCurrentTargetIsHermes = _sshTerminalCurrentTargetIsHermes;
window._sshTerminalIsConnected = _sshTerminalIsConnected;
window._sshTerminalFullscreenLabel = _sshTerminalFullscreenLabel;
window._sshTerminalResize = _sshTerminalResize;
