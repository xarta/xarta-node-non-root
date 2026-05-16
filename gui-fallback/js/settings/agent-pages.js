/* ── Agent Pages ─────────────────────────────────────────────────────── */

'use strict';

const AGENT_HERMES_LOCAL_SETTING_KEY = 'agent_pages.hermes_local_url';

let _agentHermesLoaded = false;
let _agentHermesUrl = '';

function _agentPagesEls() {
  return {
    frame: document.getElementById('agent-hermes-frame'),
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

async function _agentPagesEstablishHermesSession() {
  if (typeof apiFetch !== 'function') return false;
  try {
    const r = await apiFetch('/api/v1/dashboard-auth/hermes-local/session', { method: 'POST' });
    return r.ok;
  } catch (e) {
    return false;
  }
}

async function _agentPagesLoadHermes() {
  const { frame } = _agentPagesEls();
  if (!frame) return;
  const url = await _agentPagesResolveHermesUrl();
  if (!url) {
    _agentPagesScheduleViewportFit();
    return;
  }
  if (!_agentHermesLoaded || !frame.src) {
    const ok = await _agentPagesEstablishHermesSession();
    if (!ok) {
      _agentPagesScheduleViewportFit();
      return;
    }
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
    _agentPagesScheduleViewportFit();
    return;
  }
  await _agentPagesEstablishHermesSession();
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
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function _agentPagesBindHermesControls() {
  const els = _agentPagesEls();
  els.frame?.addEventListener('load', () => {
    _agentPagesScheduleViewportFit();
  });
}

document.addEventListener('DOMContentLoaded', _agentPagesBindHermesControls);
window._agentPagesLoadHermes = _agentPagesLoadHermes;
window._agentPagesRefreshHermes = _agentPagesRefreshHermes;
window._agentPagesOpenHermes = _agentPagesOpenHermes;
