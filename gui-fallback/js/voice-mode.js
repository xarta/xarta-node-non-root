// voice-mode.js — browser-local STT/TTS toggles plus node-local active lease.

'use strict';

const BlueprintsVoiceMode = (() => {
  const LS_BROWSER_ID = 'blueprints.voice.browser_id';
  const LS_STT = 'blueprints.voice.stt_enabled';
  const LS_STT_NOISE = 'blueprints.voice.stt_noise_reduction_enabled';
  const LS_STT_NOISE_LEVEL_DB = 'blueprints.voice.stt_noise_reduction_level_db';
  const LS_TTS = 'blueprints.voice.tts_enabled';
  const LS_CUE_ENABLED = 'blueprints.voice.announcement_cue_enabled';
  const LS_CUE_SOUND = 'blueprints.voice.announcement_cue_sound';
  const LS_CUE_REARM_MS = 'blueprints.voice.announcement_cue_rearm_ms';
  const STATUS_URL = '/api/v1/voice-mode/status';
  const ACTIVATE_URL = '/api/v1/voice-mode/activate';
  const DEACTIVATE_URL = '/api/v1/voice-mode/deactivate';
  const POLICY_URL = '/api/v1/voice-mode/policy';
  const CUE_DEFAULT_REARM_MS = 1500;
  const CUE_MIN_REARM_MS = 250;
  const CUE_MAX_REARM_MS = 5000;
  const CUE_STEP_MS = 250;
  const CUE_TTS_PRESTREAM_ESTIMATE_MS = 325;
  const CUE_MAX_TTS_START_DELAY_MS = 5000;
  const STT_NOISE_DEFAULT_DB = 6;
  const STT_NOISE_MIN_DB = 0;
  const STT_NOISE_MAX_DB = 12;
  const STT_NOISE_STEP_DB = 0.5;

  let _serverState = {
    active: null,
    policy: { tts_companion_model_preference: 'codex_spark' },
    revision: 0,
    updated_at: 0,
  };
  let _statusLoaded = false;
  let _initDone = false;
  let _lastAnnouncementCueAt = 0;

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

  function _stringFromStorage(key) {
    try { return localStorage.getItem(key) || ''; } catch (_) { return ''; }
  }

  function _setStringStorage(key, value) {
    try { localStorage.setItem(key, String(value || '')); } catch (_) {}
  }

  function _numberFromStorage(key, fallback) {
    try {
      const raw = Number(localStorage.getItem(key));
      return Number.isFinite(raw) ? raw : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function _clampRearmMs(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return CUE_DEFAULT_REARM_MS;
    const clamped = Math.max(CUE_MIN_REARM_MS, Math.min(CUE_MAX_REARM_MS, parsed));
    return Math.round(clamped / CUE_STEP_MS) * CUE_STEP_MS;
  }

  function _clampNoiseLevelDb(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return STT_NOISE_DEFAULT_DB;
    const clamped = Math.max(STT_NOISE_MIN_DB, Math.min(STT_NOISE_MAX_DB, parsed));
    return Math.round(clamped / STT_NOISE_STEP_DB) * STT_NOISE_STEP_DB;
  }

  function _cueState() {
    return {
      enabled: _boolFromStorage(LS_CUE_ENABLED),
      sound: _stringFromStorage(LS_CUE_SOUND),
      rearm_ms: _clampRearmMs(_numberFromStorage(LS_CUE_REARM_MS, CUE_DEFAULT_REARM_MS)),
    };
  }

  function _modelPreference(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/-/g, '_');
    return raw === 'local_private' ? 'local_private' : 'codex_spark';
  }

  function _policyState() {
    const policy = _serverState.policy || {};
    return {
      tts_companion_model_preference: _modelPreference(policy.tts_companion_model_preference),
    };
  }

  function _localState() {
    return {
      browser_id: _browserId(),
      browser_label: _browserLabel(),
      stt_enabled: _boolFromStorage(LS_STT),
      stt_noise_reduction_enabled: _boolFromStorage(LS_STT_NOISE),
      stt_noise_reduction_level_db: _clampNoiseLevelDb(_numberFromStorage(LS_STT_NOISE_LEVEL_DB, STT_NOISE_DEFAULT_DB)),
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
      stt: document.getElementById('voice-mode-stt-toggle'),
      sttNoise: document.getElementById('voice-mode-stt-noise-toggle'),
      sttNoiseLevel: document.getElementById('voice-mode-stt-noise-level'),
      sttNoiseLevelLabel: document.getElementById('voice-mode-stt-noise-level-label'),
      tts: document.getElementById('voice-mode-tts-toggle'),
      sttLed: document.getElementById('voice-mode-stt-led'),
      sttNoiseLed: document.getElementById('voice-mode-stt-noise-led'),
      ttsLed: document.getElementById('voice-mode-tts-led'),
      cueToggle: document.getElementById('voice-mode-cue-toggle'),
      cueSound: document.getElementById('voice-mode-cue-sound'),
      cuePick: document.getElementById('voice-mode-cue-pick'),
      cueTest: document.getElementById('voice-mode-cue-test'),
      cueRearm: document.getElementById('voice-mode-cue-rearm'),
      cueRearmLabel: document.getElementById('voice-mode-cue-rearm-label'),
      modelCodex: document.getElementById('voice-mode-model-codex'),
      modelLocal: document.getElementById('voice-mode-model-local'),
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
    const cue = _cueState();
    const policy = _policyState();
    const active = _serverState.active || null;
    const ownsLease = _isActiveOwner();

    if (els.browserLabel) els.browserLabel.textContent = local.browser_label;
    if (els.browserMeta) {
      els.browserMeta.textContent = active
        ? `Active: ${active.browser_label || active.browser_id}`
        : 'Active: none';
    }
    if (els.stt) els.stt.checked = local.stt_enabled;
    if (els.sttNoise) {
      els.sttNoise.checked = local.stt_noise_reduction_enabled;
      els.sttNoise.disabled = !local.stt_enabled;
    }
    if (els.sttNoiseLevel) {
      els.sttNoiseLevel.value = String(local.stt_noise_reduction_level_db);
      els.sttNoiseLevel.disabled = !local.stt_enabled || !local.stt_noise_reduction_enabled;
    }
    if (els.sttNoiseLevelLabel) {
      els.sttNoiseLevelLabel.textContent = `${local.stt_noise_reduction_level_db.toFixed(1)} dB`;
    }
    if (els.tts) els.tts.checked = local.tts_enabled;
    if (els.sttLed) els.sttLed.dataset.state = _capabilityLed(local.stt_enabled);
    if (els.sttNoiseLed) {
      els.sttNoiseLed.dataset.state = (local.stt_enabled && local.stt_noise_reduction_enabled)
        ? _capabilityLed(true)
        : 'red';
    }
    if (els.ttsLed) els.ttsLed.dataset.state = _capabilityLed(local.tts_enabled);
    if (els.cueToggle) els.cueToggle.checked = cue.enabled;
    if (els.cueSound) els.cueSound.value = cue.sound;
    if (els.cueRearm) els.cueRearm.value = String(cue.rearm_ms / 1000);
    if (els.cueRearmLabel) els.cueRearmLabel.textContent = `${(cue.rearm_ms / 1000).toFixed(2)}s`;
    if (els.cueTest) els.cueTest.disabled = !cue.sound;
    if (els.modelCodex) els.modelCodex.checked = policy.tts_companion_model_preference === 'codex_spark';
    if (els.modelLocal) els.modelLocal.checked = policy.tts_companion_model_preference === 'local_private';
    if (cue.sound && typeof SoundManager !== 'undefined' && typeof SoundManager.preload === 'function') {
      SoundManager.preload(_assetUrl(cue.sound)).catch(() => {});
    }
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
      policy: next.policy || { tts_companion_model_preference: 'codex_spark' },
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

  function _setSttNoiseReduction(value) {
    _setBoolStorage(LS_STT_NOISE, value);
    _render();
    _setStatus(value ? 'STT noise reduction enabled for this browser.' : 'STT noise reduction disabled.');
  }

  function _setSttNoiseLevelDb(value) {
    const level = _clampNoiseLevelDb(value);
    _setStringStorage(LS_STT_NOISE_LEVEL_DB, String(level));
    _render();
  }

  function sttNoiseReductionEnabled() {
    const local = _localState();
    return !!(local.stt_enabled && local.stt_noise_reduction_enabled);
  }

  function sttNoiseReductionLevelDb() {
    return _localState().stt_noise_reduction_level_db;
  }

  function _setCueEnabled(value) {
    _setBoolStorage(LS_CUE_ENABLED, value);
    _render();
  }

  function _setCueSound(assetPath) {
    _setStringStorage(LS_CUE_SOUND, assetPath || '');
    _render();
  }

  function _setCueRearmSeconds(seconds) {
    _setStringStorage(LS_CUE_REARM_MS, String(_clampRearmMs(Number(seconds) * 1000)));
    _render();
  }

  async function _setModelPreference(value) {
    const preference = _modelPreference(value);
    _setStatus('Updating companion model preference...');
    await _post(POLICY_URL, { tts_companion_model_preference: preference });
    _setStatus(preference === 'local_private'
      ? 'Companion prefers local private model.'
      : 'Companion prefers Codex Spark.');
  }

  function _assetUrl(assetPath) {
    const path = String(assetPath || '').trim();
    if (!path) return '';
    if (/^https?:\/\//i.test(path) || path.startsWith('/')) return path;
    return `/fallback-ui/assets/${path}`;
  }

  function _openCuePicker() {
    if (typeof AssetPicker === 'undefined') {
      _setStatus('Sound picker unavailable.');
      return;
    }
    AssetPicker.open({
      title: 'Choose announcement cue',
      kind: 'sound',
      browseUrl: '/api/v1/nav-items/assets?type=sounds',
      emptyMessage: 'No sound assets uploaded yet.',
      onSelect: async (assetPath) => {
        _setCueSound(assetPath);
        _setCueEnabled(true);
        _setStatus('Announcement cue selected.');
      },
    });
  }

  function _testCue(button) {
    const cue = _cueState();
    const url = _assetUrl(cue.sound);
    if (!url || typeof SoundManager === 'undefined') return;
    SoundManager.previewToggle(url, { button });
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

  function _payloadFlag(payload, key) {
    if (!payload) return undefined;
    if (payload[key] !== undefined) return payload[key];
    if (payload.metadata && payload.metadata[key] !== undefined) return payload.metadata[key];
    return undefined;
  }

  function _announcementCueEligible(evt) {
    const payload = evt?.payload || {};
    const metadata = payload.metadata || {};
    const explicit = _payloadFlag(payload, 'pre_roll');
    if (explicit === false || explicit === 'false' || explicit === 'suppress' || explicit === 'off') return false;
    if (metadata.realtime === true || payload.realtime === true) return false;
    const source = String(payload.source || evt?.source || '').toLowerCase();
    const agentId = String(payload.agent_id || '').toLowerCase();
    const subagentId = String(payload.subagent_id || '').toLowerCase();
    const purpose = String(metadata.purpose || '').toLowerCase();
    const platform = String(metadata.platform || '').toLowerCase();
    const hermesInstance = String(metadata.hermes_instance || '').toLowerCase();
    if (source === 'codex' || agentId === 'codex' || purpose === 'codex_status') return true;
    if (
      (source === 'hermes-local' || hermesInstance === 'hermes-local')
      && (
        agentId === 'tts-companion'
        || subagentId === 'xarta-tts-companion'
        || platform === 'matrix'
        || purpose === 'tts_companion'
      )
    ) return true;
    return explicit === true || explicit === 'true' || explicit === 'auto' || explicit === 'force';
  }

  async function maybePlayAnnouncementCue(evt) {
    const cue = _cueState();
    if (!cue.enabled || !cue.sound || !_announcementCueEligible(evt)) return false;
    if (!await canSpeakHermesUtterance()) return false;
    const now = Date.now();
    if (_lastAnnouncementCueAt && now - _lastAnnouncementCueAt < cue.rearm_ms) return false;
    const url = _assetUrl(cue.sound);
    if (!url || typeof SoundManager === 'undefined' || typeof SoundManager.playOneShot !== 'function') return false;
    _lastAnnouncementCueAt = now;
    const durationSeconds = await SoundManager.playOneShot(url, { waitForEnd: false });
    const durationMs = Math.max(0, Math.round(Number(durationSeconds || 0) * 1000));
    const delayMs = Math.max(
      0,
      Math.min(CUE_MAX_TTS_START_DELAY_MS, durationMs - CUE_TTS_PRESTREAM_ESTIMATE_MS)
    );
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return {
      played: true,
      duration_ms: durationMs,
      tts_prestream_estimate_ms: CUE_TTS_PRESTREAM_ESTIMATE_MS,
      tts_start_delay_ms: delayMs,
    };
  }

  function _wire() {
    if (_initDone) return;
    _initDone = true;
    const els = _els();
    if (!els.modal) return;
    els.stt?.addEventListener('change', () => _setLocalToggles({ stt: els.stt.checked }));
    els.sttNoise?.addEventListener('change', () => _setSttNoiseReduction(els.sttNoise.checked));
    els.sttNoiseLevel?.addEventListener('input', () => _setSttNoiseLevelDb(els.sttNoiseLevel.value));
    els.tts?.addEventListener('change', () => _setLocalToggles({ tts: els.tts.checked }));
    els.activate?.addEventListener('click', toggleActive);
    els.cueToggle?.addEventListener('change', () => _setCueEnabled(els.cueToggle.checked));
    els.cuePick?.addEventListener('click', _openCuePicker);
    els.cueTest?.addEventListener('click', () => _testCue(els.cueTest));
    els.cueRearm?.addEventListener('input', () => _setCueRearmSeconds(els.cueRearm.value));
    els.modelCodex?.addEventListener('change', () => {
      if (els.modelCodex.checked) _setModelPreference('codex_spark').catch((error) => _setStatus(error.message || String(error)));
    });
    els.modelLocal?.addEventListener('change', () => {
      if (els.modelLocal.checked) _setModelPreference('local_private').catch((error) => _setStatus(error.message || String(error)));
    });

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
    sttNoiseReductionEnabled,
    sttNoiseReductionLevelDb,
    maybePlayAnnouncementCue,
    getBrowserId: _browserId,
  };
})();

window.BlueprintsVoiceMode = BlueprintsVoiceMode;
