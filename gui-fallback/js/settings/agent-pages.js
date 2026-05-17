/* ── Agent Pages ─────────────────────────────────────────────────────── */

'use strict';

const AGENT_PAGE_CONFIGS = {
  'hermes-local': {
    settingKey: 'agent_pages.hermes_local_url',
    runtimeKey: 'hermesLocalUrl',
    sessionEndpoint: '/api/v1/dashboard-auth/hermes-local/session',
    frameId: 'agent-hermes-local-frame',
    targets: {
      terminal: 'local-hermes-container',
      tui: 'local-hermes',
      setup: 'local-hermes-setup',
    },
  },
  'hermes-vps': {
    settingKey: 'agent_pages.hermes_vps_url',
    runtimeKey: 'hermesVpsUrl',
    sessionEndpoint: '/api/v1/dashboard-auth/hermes-vps/session',
    frameId: 'agent-hermes-vps-frame',
    targets: {
      terminal: 'hermes-vps-container',
      tui: 'hermes-vps-agent',
      setup: 'hermes-vps-setup',
    },
  },
};

const _agentPageState = Object.fromEntries(Object.keys(AGENT_PAGE_CONFIGS).map(pageId => [
  pageId,
  { loaded: false, url: '' },
]));

function _agentPagesConfig(pageId) {
  return AGENT_PAGE_CONFIGS[pageId] || AGENT_PAGE_CONFIGS['hermes-local'];
}

function _agentPagesState(pageId) {
  const key = AGENT_PAGE_CONFIGS[pageId] ? pageId : 'hermes-local';
  return _agentPageState[key];
}

function _agentPagesEls(pageId) {
  const config = _agentPagesConfig(pageId);
  return {
    frame: document.getElementById(config.frameId),
  };
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

function _agentPagesCurrentPageId() {
  return document.getElementById('tab-hermes-vps')?.classList.contains('active')
    ? 'hermes-vps'
    : 'hermes-local';
}

async function _agentPagesResolveUrl(pageId = _agentPagesCurrentPageId()) {
  const config = _agentPagesConfig(pageId);
  const state = _agentPagesState(pageId);
  const configured = window.BLUEPRINTS_AGENT_PAGES?.[config.runtimeKey]
    || (typeof getFrontendSetting === 'function'
      ? getFrontendSetting(config.settingKey, '')
      : '');
  if (configured) {
    state.url = configured;
    return configured;
  }
  if (typeof loadFrontendSettings === 'function') {
    await loadFrontendSettings();
    const refreshed = typeof getFrontendSetting === 'function'
      ? getFrontendSetting(config.settingKey, '')
      : '';
    if (refreshed) {
      state.url = refreshed;
      return refreshed;
    }
  }
  state.url = '';
  return '';
}

async function _agentPagesEstablishSession(pageId = _agentPagesCurrentPageId()) {
  const config = _agentPagesConfig(pageId);
  if (typeof apiFetch !== 'function') return false;
  try {
    const r = await apiFetch(config.sessionEndpoint, { method: 'POST' });
    return r.ok;
  } catch (e) {
    return false;
  }
}

async function _agentPagesLoadHermes(pageId = _agentPagesCurrentPageId()) {
  const state = _agentPagesState(pageId);
  const { frame } = _agentPagesEls(pageId);
  if (!frame) return;
  const url = await _agentPagesResolveUrl(pageId);
  if (!url) {
    _agentPagesScheduleViewportFit();
    return;
  }
  if (!state.loaded || !frame.src) {
    const ok = await _agentPagesEstablishSession(pageId);
    if (!ok) {
      _agentPagesScheduleViewportFit();
      return;
    }
    frame.src = url;
    state.loaded = true;
  }
  _agentPagesScheduleViewportFit();
}

async function _agentPagesRefreshHermes(pageId = _agentPagesCurrentPageId()) {
  const state = _agentPagesState(pageId);
  const { frame } = _agentPagesEls(pageId);
  if (!frame) return;
  const url = await _agentPagesResolveUrl(pageId);
  if (!url) {
    _agentPagesScheduleViewportFit();
    return;
  }
  await _agentPagesEstablishSession(pageId);
  if (frame.src) {
    try {
      frame.contentWindow?.location?.reload();
      return;
    } catch (e) {}
  }
  frame.src = url;
  state.loaded = true;
}

async function _agentPagesOpenHermes(pageId = _agentPagesCurrentPageId()) {
  const state = _agentPagesState(pageId);
  const url = state.url || await _agentPagesResolveUrl(pageId);
  if (!url) {
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function _agentPagesOpenTerminal(kind, pageId = _agentPagesCurrentPageId()) {
  const targetId = _agentPagesConfig(pageId).targets[kind];
  if (targetId) window.openSshTerminalTarget?.(targetId);
}

function _agentPagesBindHermesControls() {
  Object.keys(AGENT_PAGE_CONFIGS).forEach(pageId => {
    const els = _agentPagesEls(pageId);
    els.frame?.addEventListener('load', () => {
      _agentPagesScheduleViewportFit();
    });
  });
}

document.addEventListener('DOMContentLoaded', _agentPagesBindHermesControls);
window._agentPagesLoadHermes = _agentPagesLoadHermes;
window._agentPagesRefreshHermes = _agentPagesRefreshHermes;
window._agentPagesOpenHermes = _agentPagesOpenHermes;
window._agentPagesOpenTerminal = _agentPagesOpenTerminal;
