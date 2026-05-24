// voice-mode.js — browser-local STT/TTS toggles plus node-local active lease.

'use strict';

const BlueprintsVoiceMode = (() => {
  const LS_BROWSER_ID = 'blueprints.voice.browser_id';
  const LS_STT = 'blueprints.voice.stt_enabled';
  const LS_TTS = 'blueprints.voice.tts_enabled';
  const STATUS_URL = '/api/v1/voice-mode/status';
  const ACTIVATE_URL = '/api/v1/voice-mode/activate';
  const DEACTIVATE_URL = '/api/v1/voice-mode/deactivate';

  let _serverState = { active: null, revision: 0, updated_at: 0 };
  let _statusLoaded = false;
  let _initDone = false;

  function _browserId() {
    try {
      const existing = localStorage.getItem(LS_BROWSER_ID);
      if (existing) return existing;
      const generated = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(LS_BROWSER_ID, generated);
      return generated;
    } catch (_) {
      return `browser-${Date.now()}`;
    }
  }

  function _browserLabel() {
    const platform = navigator.platform || 'browser';
    const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    return `${standalone ? 'PWA' : 'Browser'} on ${platform}`;
  }

  function _boolFromStorage(key) {
    try { return localStorage.getItem(key) === 'true'; } catch (_) { return false; }
  }

  function _setBoolStorage(key, value) {
    try { localStorage.setItem(key, value ? 'true' : 'false'); } catch (_) {}
  }

  function _localState() {
    return {
      browser_id: _browserId(),
      browser_label: _browserLabel(),
      stt_enabled: _boolFromStorage(LS_STT),
      tts_enabled: _boolFromStorage(LS_TTS),
    };
  }

  function _isActiveOwner() {
    return !!(_serverState.active && _serverState.active.browser_id === _browserId());
  }

  function _els() {
    return {
      modal: document.getElementById('voice-mode-modal'),
      browserLabel: document.getElementById('voice-mode-browser-label'),
      browserMeta: document.getElementById('voice-mode-browser-meta'),
      combined: document.getElementById('voice-mode-combined-toggle'),
      stt: document.getElementById('voice-mode-stt-toggle'),
      tts: document.getElementById('voice-mode-tts-toggle'),
      sttLed: document.getElementById('voice-mode-stt-led'),
      ttsLed: document.getElementById('voice-mode-tts-led'),
      activate: document.getElementById('voice-mode-activate-btn'),
      status: document.getElementById('voice-mode-status'),
    };
  }

  function _setStatus(message) {
    const status = _els().status;
    if (status) status.textContent = message || '';
  }

  function _capabilityLed(enabled) {
    if (!enabled) return 'red';
    return _isActiveOwner() ? 'green' : 'yellow';
  }

  function _render() {
    const els = _els();
    if (!els.modal) return;
    const local = _localState();
    const active = _serverState.active || null;
    const ownsLease = _isActiveOwner();

    if (els.browserLabel) els.browserLabel.textContent = local.browser_label;
    if (els.browserMeta) {
      els.browserMeta.textContent = active
        ? `Active: ${active.browser_label || active.browser_id}`
        : 'Active: none';
    }
    if (els.stt) els.stt.checked = local.stt_enabled;
    if (els.tts) els.tts.checked = local.tts_enabled;
    if (els.combined) els.combined.checked = local.stt_enabled && local.tts_enabled;
    if (els.sttLed) els.sttLed.dataset.state = _capabilityLed(local.stt_enabled);
    if (els.ttsLed) els.ttsLed.dataset.state = _capabilityLed(local.tts_enabled);
    if (els.activate) {
      els.activate.textContent = ownsLease ? 'Deactivate' : 'Activate';
      els.activate.disabled = !ownsLease && !local.stt_enabled && !local.tts_enabled;
    }
  }

  function _applyServerState(payload) {
    const next = payload && payload.active !== undefined ? payload : (payload?.payload || {});
    if (!next || next.active === undefined) return;
    const revision = Number(next.revision || 0);
    if (_serverState.revision && revision && revision < _serverState.revision) return;
    _serverState = {
      active: next.active || null,
      revision,
      updated_at: Number(next.updated_at || 0),
    };
    _statusLoaded = true;
    _render();
  }

  async function reconcile() {
    try {
      const response = await apiFetch(STATUS_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      _applyServerState(await response.json());
      return _serverState;
    } catch (error) {
      _setStatus(`Voice Mode status unavailable: ${error.message || error}`);
      throw error;
    }
  }

  async function _post(url, body) {
    const response = await apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || (payload && payload.ok === false)) {
      throw new Error(payload?.detail || `HTTP ${response.status}`);
    }
    _applyServerState(payload);
    return payload;
  }

  async function activate() {
    const local = _localState();
    if (!local.stt_enabled && !local.tts_enabled) {
      _setStatus('Enable STT or TTS before activating this browser.');
      _render();
      return;
    }
    _setStatus('Activating...');
    await _post(ACTIVATE_URL, local);
    _setStatus('Active lease held by this browser.');
  }

  async function deactivate() {
    _setStatus('Deactivating...');
    await _post(DEACTIVATE_URL, _localState());
    _setStatus('Voice Mode deactivated for this browser.');
  }

  async function _deactivateIfNowInvalid() {
    const local = _localState();
    if (_isActiveOwner() && !local.stt_enabled && !local.tts_enabled) {
      await deactivate();
    }
  }

  function _setLocalToggles({ stt, tts }) {
    if (typeof stt === 'boolean') _setBoolStorage(LS_STT, stt);
    if (typeof tts === 'boolean') _setBoolStorage(LS_TTS, tts);
    _render();
    _deactivateIfNowInvalid().catch((error) => _setStatus(error.message || String(error)));
  }

  async function toggleActive() {
    try {
      if (_isActiveOwner()) await deactivate();
      else await activate();
      _render();
    } catch (error) {
      _setStatus(error.message || String(error));
      _render();
    }
  }

  async function open() {
    const els = _els();
    if (!els.modal) return;
    _render();
    reconcile().catch(() => {});
    if (typeof HubModal !== 'undefined') {
      HubModal.open(els.modal, { onOpen: _render });
    } else if (typeof els.modal.showModal === 'function') {
      els.modal.showModal();
    }
  }

  async function canSpeakHermesUtterance() {
    if (!_statusLoaded) {
      try { await reconcile(); } catch (_) { return false; }
    }
    const local = _localState();
    return !!(
      local.tts_enabled
      && _serverState.active
      && _serverState.active.browser_id === local.browser_id
      && _serverState.active.tts_enabled
    );
  }

  function _wire() {
    if (_initDone) return;
    _initDone = true;
    const els = _els();
    if (!els.modal) return;
    els.combined?.addEventListener('change', () => {
      _setLocalToggles({ stt: els.combined.checked, tts: els.combined.checked });
    });
    els.stt?.addEventListener('change', () => _setLocalToggles({ stt: els.stt.checked }));
    els.tts?.addEventListener('change', () => _setLocalToggles({ tts: els.tts.checked }));
    els.activate?.addEventListener('click', toggleActive);

    document.addEventListener('blueprints:event', (event) => {
      if (event.detail?.event_type === 'voice.mode.changed') {
        _applyServerState(event.detail.payload || {});
      }
    });
    window.addEventListener('focus', () => reconcile().catch(() => {}));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reconcile().catch(() => {});
    });
    reconcile().catch(() => {});
    _render();
  }

  document.addEventListener('DOMContentLoaded', _wire);

  return {
    open,
    reconcile,
    canSpeakHermesUtterance,
    getBrowserId: _browserId,
  };
})();

window.BlueprintsVoiceMode = BlueprintsVoiceMode;
