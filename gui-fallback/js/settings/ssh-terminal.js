/* ── SSH Terminal ─────────────────────────────────────────────────────── */

'use strict';

let _sshTerminalTargets = [];
let _sshTerminalTargetId = '';
let _sshTerminalTerm = null;
let _sshTerminalWs = null;
let _sshTerminalResizeObserver = null;
let _sshTerminalLastSize = { cols: 100, rows: 28 };
let _sshTerminalHasAutoConnected = false;

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
  if (shell.classList.contains('is-fullscreen')) {
    shell.style.height = '';
    shell.style.minHeight = '';
    shell.style.maxHeight = '';
    return;
  }
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
  if (target) {
    target.innerHTML = _sshTerminalTargets.map(item => (
      `<option value="${esc(item.target_id || '')}" ${item.enabled ? '' : 'disabled'}>${esc(item.label || item.target_id || '')}</option>`
    )).join('');
  }
  if (_sshTerminalTargetId && _sshTerminalTargets.some(item => item.target_id === _sshTerminalTargetId)) {
    if (target) target.value = _sshTerminalTargetId;
  } else if (_sshTerminalTargets[0]) {
    _sshTerminalTargetId = _sshTerminalTargets[0].target_id;
    if (target) target.value = _sshTerminalTargetId;
  }
}

async function _sshTerminalConnect() {
  const term = _sshTerminalEnsureTerminal();
  const { target } = _sshTerminalEls();
  if (!term) return;
  if (_sshTerminalWs && _sshTerminalWs.readyState === WebSocket.OPEN) return;

  _sshTerminalTargetId = target?.value || _sshTerminalTargetId || 'local-hermes';
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
    _sshTerminalScheduleSettledResize(true);
  });
  ws.addEventListener('message', event => {
    term.write(String(event.data || ''));
  });
  ws.addEventListener('close', event => {
    if (_sshTerminalWs === ws) _sshTerminalWs = null;
    _sshTerminalSetConnected(false);
    const clean = event.code === 1000 || event.code === 1001;
    _sshTerminalSetStatus(clean ? 'Disconnected.' : `Disconnected (${event.code}).`, clean ? '' : 'error');
  });
  ws.addEventListener('error', () => {
    _sshTerminalSetStatus('Terminal websocket error.', 'error');
  });
}

function _sshTerminalDisconnect() {
  if (_sshTerminalWs) {
    _sshTerminalWs.close(1000, 'closed by browser');
    _sshTerminalWs = null;
  }
  _sshTerminalSetConnected(false);
  _sshTerminalSetStatus('Disconnected.');
}

function _sshTerminalToggleFullscreen() {
  const { shell, fullscreen } = _sshTerminalEls();
  if (!shell) return;
  const active = !shell.classList.contains('is-fullscreen');
  shell.classList.toggle('is-fullscreen', active);
  if (fullscreen) {
    fullscreen.textContent = active ? 'Exit Full Screen' : 'Full Screen';
    fullscreen.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  if (typeof SettingsMenuConfig !== 'undefined') SettingsMenuConfig.updateActiveTab('ssh-terminal');
  _sshTerminalScheduleSettledResize(true);
}

async function _sshTerminalLoadTab() {
  _sshTerminalEnsureTerminal();
  try {
    await _sshTerminalLoadTargets();
    _sshTerminalSetStatus(_sshTerminalWs ? 'Connected.' : 'Ready.');
    _sshTerminalScheduleSettledResize(true);
    if (!_sshTerminalWs && !_sshTerminalHasAutoConnected) {
      _sshTerminalHasAutoConnected = true;
      window.setTimeout(() => _sshTerminalConnect(), 80);
    }
  } catch (e) {
    _sshTerminalSetStatus(`Unable to load terminal targets: ${e.message}`, 'error');
  }
}

function openSshTerminalTarget(targetId, options = {}) {
  _sshTerminalTargetId = targetId || 'local-hermes';
  if (options.connect !== false) _sshTerminalHasAutoConnected = false;
  if (typeof switchGroup === 'function') switchGroup('settings');
  if (typeof switchTab === 'function') switchTab('ssh-terminal');
  if (typeof SettingsMenuConfig !== 'undefined') SettingsMenuConfig.updateActiveTab('ssh-terminal');
  window.setTimeout(() => {
    const { target } = _sshTerminalEls();
    if (target && _sshTerminalTargetId) target.value = _sshTerminalTargetId;
    _sshTerminalLoadTab();
  }, 0);
}

function _sshTerminalSelectLocalHermes() {
  openSshTerminalTarget('local-hermes');
}

function _sshTerminalIsConnected() {
  return !!(_sshTerminalWs && _sshTerminalWs.readyState === WebSocket.OPEN);
}

function _sshTerminalFullscreenLabel() {
  return document.getElementById('ssh-terminal-shell')?.classList.contains('is-fullscreen')
    ? 'Exit Full Screen'
    : 'Full Screen';
}

function _sshTerminalInit() {
  const { target, connect, disconnect, fullscreen } = _sshTerminalEls();
  target?.addEventListener('change', () => { _sshTerminalTargetId = target.value; });
  connect?.addEventListener('click', _sshTerminalConnect);
  disconnect?.addEventListener('click', _sshTerminalDisconnect);
  fullscreen?.addEventListener('click', _sshTerminalToggleFullscreen);
  window.addEventListener('resize', () => _sshTerminalResize(true), { passive: true });
  window.visualViewport?.addEventListener('resize', () => _sshTerminalResize(true), { passive: true });
  const urlTarget = new URLSearchParams(window.location.search).get('terminal');
  if (urlTarget) _sshTerminalTargetId = urlTarget;
}

document.addEventListener('DOMContentLoaded', _sshTerminalInit);
window.openSshTerminalTarget = openSshTerminalTarget;
window._sshTerminalConnect = _sshTerminalConnect;
window._sshTerminalDisconnect = _sshTerminalDisconnect;
window._sshTerminalToggleFullscreen = _sshTerminalToggleFullscreen;
window._sshTerminalSelectLocalHermes = _sshTerminalSelectLocalHermes;
window._sshTerminalIsConnected = _sshTerminalIsConnected;
window._sshTerminalFullscreenLabel = _sshTerminalFullscreenLabel;
window._sshTerminalResize = _sshTerminalResize;
