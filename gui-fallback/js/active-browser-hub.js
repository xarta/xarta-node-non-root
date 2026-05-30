// active-browser-hub.js - app-wide Active Browser lease control modal.

'use strict';

const BlueprintsActiveBrowserHub = (() => {
  const VIEW_URL = '/api/v1/voice-mode/active-browser-view';
  const ACTIVATE_URL = '/api/v1/voice-mode/browser-clients/activate';
  const DEACTIVATE_URL = '/api/v1/voice-mode/browser-clients/deactivate';

  let _state = null;
  let _pollTimer = null;

  function _els() {
    return {
      modal: document.getElementById('active-browser-hub-modal'),
      label: document.getElementById('active-browser-hub-label'),
      meta: document.getElementById('active-browser-hub-meta'),
      status: document.getElementById('active-browser-hub-status'),
      active: document.getElementById('active-browser-hub-active'),
      view: document.getElementById('active-browser-hub-view'),
      viewport: document.getElementById('active-browser-hub-viewport'),
      version: document.getElementById('active-browser-hub-version'),
      toggle: document.getElementById('active-browser-hub-toggle'),
    };
  }

  function _voiceMode() {
    return window.BlueprintsVoiceMode || null;
  }

  function _localClient() {
    const voice = _voiceMode();
    const local = voice?.getLocalState?.() || {};
    const platform = navigator.platform || 'browser';
    return {
      browser_id: String(voice?.getBrowserId?.() || '').trim(),
      browser_label: String(voice?.getBrowserLabel?.() || `Browser on ${platform}`).trim(),
      tab_id: String(voice?.getTabId?.() || '').trim(),
      stt_enabled: !!local.stt_enabled,
      stt_mode: String(local.stt_mode || '').trim(),
      tts_enabled: !!local.tts_enabled,
    };
  }

  function _selectedClient() {
    const local = _localClient();
    const clients = Array.isArray(_state?.clients) ? _state.clients : [];
    return clients.find(client => client.browser_id === local.browser_id && client.tab_id === local.tab_id)
      || clients.find(client => client.browser_id === local.browser_id)
      || null;
  }

  function _ownsActiveBrowser() {
    const local = _localClient();
    const active = _state?.active || {};
    return !!(local.browser_id && active.browser_id === local.browser_id);
  }

  function _statusText() {
    const local = _localClient();
    const active = _state?.active || null;
    if (!active?.browser_id) return 'No Active Browser is selected.';
    if (active.browser_id === local.browser_id) {
      if (active.tab_id && local.tab_id && active.tab_id !== local.tab_id) {
        return 'This browser is active on another tab.';
      }
      return 'This browser is the Active Browser.';
    }
    return `Active Browser: ${active.browser_label || active.browser_id}`;
  }

  function _pageText(client) {
    const page = client?.page || _state?.view?.page || {};
    const group = page.group || '';
    const tab = page.tab || '';
    if (group && tab) return `${group} / ${tab}`;
    return tab || group || 'Page unknown';
  }

  function _viewportText(client) {
    const viewport = client?.viewport || _state?.view?.viewport || {};
    const classification = client?.viewport_classification || _state?.view?.viewport_classification || {};
    const w = Number(viewport.innerWidth || 0);
    const h = Number(viewport.innerHeight || 0);
    const primary = classification.primary || client?.viewport_class || _state?.view?.viewport_class || 'unknown';
    if (!w || !h) return primary;
    return `${w} x ${h} (${primary})`;
  }

  function _versionText(client) {
    const view = client || _state?.view || {};
    const frontend = view.frontend || {};
    const asset = frontend.asset_version || 'unknown';
    const sw = frontend.service_worker_cache_version || 'no SW';
    const match = view.frontend_asset_version_match ? 'matched' : 'check pending';
    return `${asset} / ${sw} / ${match}`;
  }

  function _setStatus(text, tone = '') {
    const { status } = _els();
    if (!status) return;
    status.textContent = text || '';
    status.dataset.tone = tone;
  }

  function _render() {
    const els = _els();
    const local = _localClient();
    const client = _selectedClient();
    const owns = _ownsActiveBrowser();
    if (els.label) els.label.textContent = local.browser_label || 'This browser';
    if (els.meta) els.meta.textContent = local.tab_id ? `tab ${local.tab_id}` : 'tab pending';
    if (els.active) els.active.textContent = _statusText();
    if (els.view) els.view.textContent = _pageText(client);
    if (els.viewport) els.viewport.textContent = _viewportText(client);
    if (els.version) els.version.textContent = _versionText(client);
    if (els.toggle) {
      els.toggle.textContent = owns ? 'Deactivate' : 'Activate';
      els.toggle.dataset.mode = owns ? 'deactivate' : 'activate';
      els.toggle.disabled = !local.browser_id;
    }
  }

  async function _json(method, url, body) {
    const response = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      deferDuringColumnResize: false,
      trackActivity: false,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.detail || `HTTP ${response.status}`);
    }
    return payload || {};
  }

  async function refresh() {
    _state = await _json('GET', VIEW_URL);
    _render();
    return _state;
  }

  async function _reportCurrentClient() {
    if (typeof window.BlueprintsActiveBrowserObserver?.reportNow === 'function') {
      await window.BlueprintsActiveBrowserObserver.reportNow('active-browser-hub');
    }
  }

  async function toggle() {
    const local = _localClient();
    if (!local.browser_id) return;
    const owns = _ownsActiveBrowser();
    const url = owns ? DEACTIVATE_URL : ACTIVATE_URL;
    const action = owns ? 'Deactivating...' : 'Activating...';
    try {
      _setStatus(action);
      await _reportCurrentClient();
      _state = await _json('POST', url, {
        browser_id: local.browser_id,
        tab_id: local.tab_id,
        stt_enabled: local.stt_enabled,
        stt_mode: local.stt_mode,
        tts_enabled: local.tts_enabled,
      });
      await refresh();
      if (typeof _voiceMode()?.reconcile === 'function') {
        _voiceMode().reconcile().catch(() => {});
      }
      _setStatus(owns ? 'Deactivated.' : 'Activated.', 'ok');
    } catch (error) {
      _setStatus(error.message || String(error), 'error');
      _render();
    }
  }

  function open() {
    const els = _els();
    if (!els.modal) return;
    _setStatus('');
    _render();
    _reportCurrentClient().then(refresh).catch(error => {
      _setStatus(error.message || String(error), 'error');
    });
    if (typeof HubModal !== 'undefined') {
      HubModal.open(els.modal, {
        onOpen: () => {
          _pollTimer = window.setInterval(() => refresh().catch(() => {}), 5000);
        },
        onClose: () => {
          if (_pollTimer) window.clearInterval(_pollTimer);
          _pollTimer = null;
        },
      });
    } else if (typeof els.modal.showModal === 'function') {
      els.modal.showModal();
    }
  }

  function _wire() {
    const els = _els();
    els.toggle?.addEventListener('click', toggle);
    document.addEventListener('blueprints:node-selector-toggle-long-press', event => {
      event.preventDefault();
      open();
    });
    document.addEventListener('blueprints:event', event => {
      if (event.detail?.event_type === 'voice.mode.changed') {
        refresh().catch(() => {});
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wire, { once: true });
  } else {
    _wire();
  }

  return Object.freeze({
    open,
    refresh,
    toggle,
  });
})();

window.BlueprintsActiveBrowserHub = BlueprintsActiveBrowserHub;
