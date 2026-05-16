/* ── Agent Pages ─────────────────────────────────────────────────────── */

'use strict';

const AGENT_HERMES_LOCAL_SETTING_KEY = 'agent_pages.hermes_local_url';

let _agentHermesLoaded = false;
let _agentHermesUrl = '';

function _agentPagesEls() {
  return {
    frame: document.getElementById('agent-hermes-frame'),
    status: document.getElementById('agent-hermes-status'),
    refresh: document.getElementById('agent-hermes-refresh-btn'),
    open: document.getElementById('agent-hermes-open-btn'),
    terminal: document.getElementById('agent-hermes-terminal-btn'),
    tui: document.getElementById('agent-hermes-tui-btn'),
    setup: document.getElementById('agent-hermes-setup-btn'),
  };
}

function _agentPagesSetStatus(message, tone = '') {
  const { status } = _agentPagesEls();
  if (!status) return;
  status.textContent = message || '';
  status.style.color = tone === 'ok'
    ? 'var(--ok,#3fb950)'
    : (tone === 'error' ? 'var(--err,#f85149)' : 'var(--text-dim)');
}

function _agentPagesScheduleViewportFit() {
  const schedule = () => {
    if (window.BodyShade?.scheduleSizeFillTable) {
      window.BodyShade.scheduleSizeFillTable();
    }
  };
  schedule();
  requestAnimationFrame(schedule);
  setTimeout(schedule, 120);
  setTimeout(schedule, 420);
}

async function _agentPagesResolveHermesUrl() {
  const configured = window.BLUEPRINTS_AGENT_PAGES?.hermesLocalUrl
    || (typeof getFrontendSetting === 'function'
      ? getFrontendSetting(AGENT_HERMES_LOCAL_SETTING_KEY, '')
      : '');
  if (configured) {
    _agentHermesUrl = configured;
    return configured;
  }
  if (typeof loadFrontendSettings === 'function') {
    await loadFrontendSettings();
    const refreshed = typeof getFrontendSetting === 'function'
      ? getFrontendSetting(AGENT_HERMES_LOCAL_SETTING_KEY, '')
      : '';
    if (refreshed) {
      _agentHermesUrl = refreshed;
      return refreshed;
    }
  }
  _agentHermesUrl = '';
  return '';
}

async function _agentPagesLoadHermes() {
  const { frame } = _agentPagesEls();
  if (!frame) return;
  const url = await _agentPagesResolveHermesUrl();
  if (!url) {
    _agentPagesSetStatus('Dashboard URL is not configured', 'error');
    _agentPagesScheduleViewportFit();
    return;
  }
  if (!_agentHermesLoaded || !frame.src) {
    _agentPagesSetStatus('Loading dashboard...');
    frame.src = url;
    _agentHermesLoaded = true;
  }
  _agentPagesScheduleViewportFit();
}

async function _agentPagesRefreshHermes() {
  const { frame } = _agentPagesEls();
  if (!frame) return;
  const url = await _agentPagesResolveHermesUrl();
  if (!url) {
    _agentPagesSetStatus('Dashboard URL is not configured', 'error');
    _agentPagesScheduleViewportFit();
    return;
  }
  _agentPagesSetStatus('Refreshing dashboard...');
  if (frame.src) {
    try {
      frame.contentWindow?.location?.reload();
      return;
    } catch (e) {}
  }
  frame.src = url;
  _agentHermesLoaded = true;
}

async function _agentPagesOpenHermes() {
  const url = _agentHermesUrl || await _agentPagesResolveHermesUrl();
  if (!url) {
    _agentPagesSetStatus('Dashboard URL is not configured', 'error');
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function _agentPagesBindHermesControls() {
  const els = _agentPagesEls();
  els.frame?.addEventListener('load', () => {
    _agentPagesSetStatus('Dashboard loaded', 'ok');
    _agentPagesScheduleViewportFit();
  });
  els.refresh?.addEventListener('click', _agentPagesRefreshHermes);
  els.open?.addEventListener('click', _agentPagesOpenHermes);
  els.terminal?.addEventListener('click', () => window.openSshTerminalTarget?.('local-hermes-container'));
  els.tui?.addEventListener('click', () => window.openSshTerminalTarget?.('local-hermes'));
  els.setup?.addEventListener('click', () => window.openSshTerminalTarget?.('local-hermes-setup'));
}

document.addEventListener('DOMContentLoaded', _agentPagesBindHermesControls);
window._agentPagesLoadHermes = _agentPagesLoadHermes;
window._agentPagesRefreshHermes = _agentPagesRefreshHermes;
window._agentPagesOpenHermes = _agentPagesOpenHermes;
