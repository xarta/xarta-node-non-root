// voice-mode.js - browser-local STT/TTS selection plus backend Active Browser state.

'use strict';

const BlueprintsVoiceMode = (() => {
  const LS_BROWSER_ID = 'blueprints.voice.browser_id';
  const SS_TAB_ID = 'blueprints.active_browser.tab_id';
  const LS_STT = 'blueprints.voice.stt_enabled';
  const LS_STT_MODE = 'blueprints.voice.stt_mode';
  const LS_STT_NOISE = 'blueprints.voice.stt_noise_reduction_enabled';
  const LS_STT_NOISE_LEVEL_DB = 'blueprints.voice.stt_noise_reduction_level_db';
  const LS_TTS = 'blueprints.voice.tts_enabled';
  const LS_CUE_ENABLED = 'blueprints.voice.announcement_cue_enabled';
  const LS_CUE_SOUND = 'blueprints.voice.announcement_cue_sound';
  const LS_CUE_REARM_MS = 'blueprints.voice.announcement_cue_rearm_ms';
  const STATUS_URL = '/api/v1/voice-mode/status';
  const DEPENDENCY_HEALTH_URL = '/api/v1/voice-mode/dependency-health';
  const ACTIVATE_URL = '/api/v1/voice-mode/activate';
  const DEACTIVATE_URL = '/api/v1/voice-mode/deactivate';
  const POLICY_URL = '/api/v1/voice-mode/policy';
  const WAKE_SETTINGS_URL = '/api/v1/voice-mode/wake-settings';
  const AGGREGATION_TIMEOUT_URL = '/api/v1/voice-mode/stt/aggregation-timeout';
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
  const STT_VAD_RESET_DEFAULT_MS = 300;
  const STT_VAD_RESET_MIN_MS = 0;
  const STT_VAD_RESET_MAX_MS = 2000;
  const STT_VAD_RESET_STEP_MS = 50;
  const STT_PRE_ROLL_FRAMES_DEFAULT = 1;
  const STT_PRE_ROLL_FRAMES_MIN = 1;
  const STT_PRE_ROLL_FRAMES_MAX = 4;
  const STT_PRE_ROLL_FRAMES_STEP = 1;
  const STT_SILENCE_RESET_DEFAULT_MS = 2100;
  const STT_SILENCE_RESET_MIN_MS = 0;
  const STT_SILENCE_RESET_MAX_MS = 3000;
  const STT_SILENCE_RESET_STEP_MS = 300;
  const STT_WORD_DETECTION_PAYLOAD0_TIMEOUT_DEFAULT_MS = 0;
  const STT_WORD_DETECTION_PAYLOAD0_TIMEOUT_MIN_MS = 0;
  const STT_WORD_DETECTION_PAYLOAD0_TIMEOUT_MAX_MS = 3000;
  const STT_WORD_DETECTION_PAYLOAD0_TIMEOUT_STEP_MS = 300;
  const WAKE_ACTION_DELAY_MIN_MS = 0;
  const WAKE_ACTION_DELAY_MAX_MS = 3000;
  const WAKE_ACTION_DELAY_STEP_MS = 300;
  const STT_MODE_NONE = '';
  const STT_MODE_REALTIME = 'realtime_conversation';
  const STT_MODE_PUSH = 'push_to_talk';
  const STT_MODE_WAKE = 'wake_to_talk';
  const STT_MODES = new Set([STT_MODE_REALTIME, STT_MODE_PUSH, STT_MODE_WAKE]);

  let _serverState = {
    active: null,
    policy: { tts_companion_model_preference: 'codex_spark' },
    revision: 0,
    updated_at: 0,
  };
  let _statusLoaded = false;
  let _initDone = false;
  let _lastAnnouncementCueAt = 0;
  let _dependencyHealth = null;
  let _dependencyHealthTimer = null;
  let _dependencyHealthInFlight = false;
  let _wakeSettings = null;
  let _wakeSettingsLoaded = false;
  let _wakeSettingsInFlight = false;
  let _wakeSaveTimer = null;
  let _aggregationTimeout = null;
  let _aggregationTimeoutInFlight = false;
  let _activeModalTab = 'general';
  let _lastWakeControllerSyncKey = '';
  let _activeActivationSyncInFlight = false;

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

  function _tabId() {
    try {
      const existing = sessionStorage.getItem(SS_TAB_ID);
      if (existing) return existing;
      const generated = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      sessionStorage.setItem(SS_TAB_ID, generated);
      return generated;
    } catch (_) {
      return `tab-${Date.now()}`;
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

  function _normalizeSttMode(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
    if (!raw || raw === 'off' || raw === 'none' || raw === 'disabled') return STT_MODE_NONE;
    if (raw === 'realtime' || raw === 'real_time' || raw === 'conversation' || raw === 'realtime_conversation') {
      return STT_MODE_REALTIME;
    }
    if (raw === 'push' || raw === 'push_to_talk' || raw === 'ptt' || raw === 'stt') {
      return STT_MODE_PUSH;
    }
    if (raw === 'wake' || raw === 'wake_to_talk' || raw === 'wake_word') {
      return STT_MODE_WAKE;
    }
    return STT_MODES.has(raw) ? raw : STT_MODE_NONE;
  }

  function _storedSttMode() {
    try {
      const stored = localStorage.getItem(LS_STT_MODE);
      if (stored !== null) return _normalizeSttMode(stored);
    } catch (_) {}
    return _boolFromStorage(LS_STT) ? STT_MODE_PUSH : STT_MODE_NONE;
  }

  function _setStoredSttMode(mode) {
    const next = _normalizeSttMode(mode);
    _setStringStorage(LS_STT_MODE, next);
    _setBoolStorage(LS_STT, Boolean(next));
    return next;
  }

  function _sttModeStatusLabel(mode) {
    if (mode === STT_MODE_REALTIME) return 'Realtime conversation';
    if (mode === STT_MODE_PUSH) return 'Push-to-talk';
    if (mode === STT_MODE_WAKE) return 'Wake-to-talk';
    return 'STT';
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
      wake_to_talk: _cleanWakeSettings(policy.wake_to_talk),
      stt: _cleanSttPolicy(policy.stt),
    };
  }

  function _defaultWakeSettings() {
    return {
      instances: {
        local: {
          enabled: true,
          label: 'hermes-local',
          matrix_server: 'tb1',
          matrix_room_id: '',
          wake_word: 'Computer',
          wake_aliases: ['computer'],
          hermes_prefix: 'hermes: ',
          auto_execute_silence_ms: 0,
          execute_cancel_ms: 0,
          commands: {
            pause: 'pause-dictation',
            execute: 'execute',
            resume: 'resume-dictation',
            cancel: 'cancel-dictation',
          },
        },
        vps: {
          enabled: true,
          label: 'hermes-VPS',
          matrix_server: 'vps',
          matrix_room_id: '',
          wake_word: 'Mini-Me',
          wake_aliases: ['mini-me', 'mini me', 'minime'],
          hermes_prefix: 'hermes-vps: ',
          auto_execute_silence_ms: 0,
          execute_cancel_ms: 0,
          commands: {
            pause: 'pause-dictation',
            execute: 'execute',
            resume: 'resume-dictation',
            cancel: 'cancel-dictation',
          },
        },
      },
    };
  }

  function _cleanWakeString(value, fallback = '', maxLength = 255) {
    const text = String(value == null ? fallback : value).trim();
    return (text || fallback).slice(0, maxLength);
  }

  function _cleanWakeDelayMs(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return _cleanWakeDelayMs(fallback, 0);
    const clamped = Math.max(WAKE_ACTION_DELAY_MIN_MS, Math.min(WAKE_ACTION_DELAY_MAX_MS, parsed));
    return Math.round(clamped / WAKE_ACTION_DELAY_STEP_MS) * WAKE_ACTION_DELAY_STEP_MS;
  }

  function _wakeAliases(wakeWord, configured) {
    const aliases = [];
    const values = [];
    String(wakeWord || '').split(';').forEach(part => values.push(part));
    if (Array.isArray(configured)) configured.forEach(value => values.push(value));
    values.forEach(value => {
      const normalized = String(value || '').trim().toLowerCase().replace(/-/g, ' ').replace(/[.,]/g, '');
      const spaced = normalized.split(/\s+/).filter(Boolean).join(' ');
      const compact = spaced.replace(/\s+/g, '');
      const hyphenated = spaced.replace(/\s+/g, '-');
      [spaced, compact, hyphenated].forEach(candidate => {
        if (candidate && !aliases.includes(candidate)) aliases.push(candidate);
      });
    });
    return aliases.slice(0, 16);
  }

  function _cleanWakeCommands(value) {
    const raw = value && typeof value === 'object' ? value : {};
    return {
      pause: _cleanWakeString(raw.pause, 'pause-dictation', 80),
      execute: _cleanWakeString(raw.execute, 'execute', 80),
      resume: _cleanWakeString(raw.resume, 'resume-dictation', 80),
      cancel: _cleanWakeString(raw.cancel, 'cancel-dictation', 80),
    };
  }

  function _cleanWakeInstance(instanceId, value) {
    const defaults = _defaultWakeSettings().instances[instanceId] || _defaultWakeSettings().instances.local;
    const raw = value && typeof value === 'object' ? value : {};
    const matrixServer = instanceId === 'vps' ? 'vps' : 'tb1';
    const wakeWord = _cleanWakeString(raw.wake_word, defaults.wake_word, 160);
    return {
      enabled: true,
      label: defaults.label,
      matrix_server: matrixServer,
      matrix_room_id: _cleanWakeString(raw.matrix_room_id, defaults.matrix_room_id, 255),
      wake_word: wakeWord,
      wake_aliases: _wakeAliases(wakeWord, raw.wake_aliases),
      hermes_prefix: _cleanWakeString(raw.hermes_prefix, defaults.hermes_prefix, 40),
      auto_execute_silence_ms: _cleanWakeDelayMs(raw.auto_execute_silence_ms, defaults.auto_execute_silence_ms),
      execute_cancel_ms: _cleanWakeDelayMs(raw.execute_cancel_ms, defaults.execute_cancel_ms),
      commands: _cleanWakeCommands(raw.commands),
    };
  }

  function _cleanWakeSettings(value) {
    const raw = value && typeof value === 'object' ? value : {};
    const instances = raw.instances && typeof raw.instances === 'object' ? raw.instances : {};
    return {
      instances: {
        local: _cleanWakeInstance('local', instances.local),
        vps: _cleanWakeInstance('vps', instances.vps),
      },
    };
  }

  function _cleanSttPolicy(value) {
    const raw = value && typeof value === 'object' ? value : {};
    const aggregationMs = Number(raw.speech_aggregation_timeout_ms);
    const vadResetMs = Number(raw.vad_reset_timeout_ms);
    const preRollFrames = Number(raw.pre_roll_frames ?? raw.num_pre_roll_frames ?? raw.num_pre_roll);
    const silenceResetMs = Number(raw.silence_reset_timeout_ms);
    const payload0TimeoutMs = Number(
      raw.word_detection_payload0_timeout_ms ?? raw.vad_payload0_timeout_ms ?? raw.payload0_timeout_ms,
    );
    let prefixPartialInterruptTts = _policyBool(
      raw.word_detection_prefix_partial_interrupt_tts_enabled ?? raw.match_prefix_partial_interrupt_tts,
      false,
    );
    const prefixFinalInterruptTts = _policyBool(
      raw.word_detection_prefix_final_interrupt_tts_enabled ?? raw.match_prefix_final_interrupt_tts,
      false,
    );
    if (prefixPartialInterruptTts && prefixFinalInterruptTts) prefixPartialInterruptTts = false;
    return {
      speech_aggregation_timeout_ms: Number.isFinite(aggregationMs) ? Math.max(50, Math.min(300, Math.round(aggregationMs / 10) * 10)) : 80,
      vad_reset_timeout_ms: Number.isFinite(vadResetMs)
        ? Math.max(STT_VAD_RESET_MIN_MS, Math.min(STT_VAD_RESET_MAX_MS, Math.round(vadResetMs / STT_VAD_RESET_STEP_MS) * STT_VAD_RESET_STEP_MS))
        : STT_VAD_RESET_DEFAULT_MS,
      pre_roll_frames: Number.isFinite(preRollFrames)
        ? Math.max(STT_PRE_ROLL_FRAMES_MIN, Math.min(STT_PRE_ROLL_FRAMES_MAX, Math.round(preRollFrames / STT_PRE_ROLL_FRAMES_STEP) * STT_PRE_ROLL_FRAMES_STEP))
        : STT_PRE_ROLL_FRAMES_DEFAULT,
      silero_vad_enabled: _policyBool(raw.silero_vad_enabled ?? raw.silero_enabled, false),
      vad_interrupt_tts_enabled: _policyBool(raw.vad_interrupt_tts_enabled ?? raw.vad_interrupt_tts, false),
      word_detection_match_interrupt_tts_enabled: _policyBool(
        raw.word_detection_match_interrupt_tts_enabled ?? raw.match_interrupt_tts,
        false,
      ),
      word_detection_prefix_partial_interrupt_tts_enabled: prefixPartialInterruptTts,
      word_detection_prefix_final_interrupt_tts_enabled: prefixFinalInterruptTts,
      word_detection_payload0_timeout_ms: Number.isFinite(payload0TimeoutMs)
        ? Math.max(STT_WORD_DETECTION_PAYLOAD0_TIMEOUT_MIN_MS, Math.min(STT_WORD_DETECTION_PAYLOAD0_TIMEOUT_MAX_MS, Math.round(payload0TimeoutMs / STT_WORD_DETECTION_PAYLOAD0_TIMEOUT_STEP_MS) * STT_WORD_DETECTION_PAYLOAD0_TIMEOUT_STEP_MS))
        : STT_WORD_DETECTION_PAYLOAD0_TIMEOUT_DEFAULT_MS,
      always_pre_roll_enabled: _policyBool(raw.always_pre_roll_enabled ?? raw.always_pre_roll, false),
      silence_reset_timeout_ms: Number.isFinite(silenceResetMs)
        ? Math.max(STT_SILENCE_RESET_MIN_MS, Math.min(STT_SILENCE_RESET_MAX_MS, Math.round(silenceResetMs / STT_SILENCE_RESET_STEP_MS) * STT_SILENCE_RESET_STEP_MS))
        : STT_SILENCE_RESET_DEFAULT_MS,
    };
  }

  function _policyBool(value, fallback = false) {
    if (value == null) return !!fallback;
    if (typeof value === 'boolean') return value;
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
  }

  function _cleanPolicy(value) {
    const raw = value && typeof value === 'object' ? value : {};
    return {
      tts_companion_model_preference: _modelPreference(raw.tts_companion_model_preference),
      wake_to_talk: _cleanWakeSettings(raw.wake_to_talk),
      stt: _cleanSttPolicy(raw.stt),
    };
  }

  function _localState() {
    const sttMode = _storedSttMode();
    return {
      browser_id: _browserId(),
      browser_label: _browserLabel(),
      tab_id: _tabId(),
      stt_enabled: Boolean(sttMode),
      stt_mode: sttMode,
      stt_noise_reduction_enabled: _boolFromStorage(LS_STT_NOISE),
      stt_noise_reduction_level_db: _clampNoiseLevelDb(_numberFromStorage(LS_STT_NOISE_LEVEL_DB, STT_NOISE_DEFAULT_DB)),
      tts_enabled: _boolFromStorage(LS_TTS),
    };
  }

  function _isActiveOwner() {
    return !!(_serverState.active && _serverState.active.browser_id === _browserId());
  }

  function _activeSttMode() {
    return _isActiveOwner() ? _localState().stt_mode : '';
  }

  function _canUseSelectedSttMode(mode) {
    return _isActiveOwner() && _localState().stt_mode === _normalizeSttMode(mode);
  }

  function _ownsActiveSttMode(mode) {
    return _canUseSelectedSttMode(mode);
  }

  function _els() {
    return {
      modal: document.getElementById('voice-mode-modal'),
      browserLabel: document.getElementById('voice-mode-browser-label'),
      browserMeta: document.getElementById('voice-mode-browser-meta'),
      sttRealtime: document.getElementById('voice-mode-stt-realtime-toggle'),
      sttPush: document.getElementById('voice-mode-stt-push-toggle'),
      sttWake: document.getElementById('voice-mode-stt-wake-toggle'),
      sttNoise: document.getElementById('voice-mode-stt-noise-toggle'),
      sttNoiseLevel: document.getElementById('voice-mode-stt-noise-level'),
      sttNoiseLevelLabel: document.getElementById('voice-mode-stt-noise-level-label'),
      tts: document.getElementById('voice-mode-tts-toggle'),
      sttRealtimeIssue: document.getElementById('voice-mode-stt-realtime-issue'),
      sttPushIssue: document.getElementById('voice-mode-stt-push-issue'),
      sttWakeIssue: document.getElementById('voice-mode-stt-wake-issue'),
      sttNoiseIssue: document.getElementById('voice-mode-stt-noise-issue'),
      ttsIssue: document.getElementById('voice-mode-tts-issue'),
      sttRealtimeLed: document.getElementById('voice-mode-stt-realtime-led'),
      sttPushLed: document.getElementById('voice-mode-stt-push-led'),
      sttWakeLed: document.getElementById('voice-mode-stt-wake-led'),
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
      tabGeneral: document.getElementById('voice-mode-tab-general'),
      tabLocal: document.getElementById('voice-mode-tab-local'),
      tabVps: document.getElementById('voice-mode-tab-vps'),
      panelGeneral: document.getElementById('voice-mode-panel-general'),
      panelLocal: document.getElementById('voice-mode-panel-local'),
      panelVps: document.getElementById('voice-mode-panel-vps'),
      aggWrap: document.getElementById('voice-mode-aggregation-wrap'),
      aggSlider: document.getElementById('voice-mode-aggregation-timeout'),
      aggLabel: document.getElementById('voice-mode-aggregation-label'),
      vadResetSlider: document.getElementById('voice-mode-vad-reset-timeout'),
      vadResetLabel: document.getElementById('voice-mode-vad-reset-label'),
      silenceResetSlider: document.getElementById('voice-mode-silence-reset-timeout'),
      silenceResetLabel: document.getElementById('voice-mode-silence-reset-label'),
      wakeRuntime: document.getElementById('voice-mode-wake-runtime'),
      wakeRuntimeLabel: document.getElementById('voice-mode-wake-runtime-label'),
    };
  }

  function _setStatus(message) {
    const status = _els().status;
    if (status) status.textContent = message || '';
  }

  function _componentHealth(key) {
    const component = _dependencyHealth?.components?.[key] || null;
    return component && typeof component === 'object' ? component : null;
  }

  function _componentIssue(key) {
    const component = _componentHealth(key);
    return component && component.ok === false && component.issue ? String(component.issue) : '';
  }

  function _setIssue(el, issue) {
    if (!el) return;
    const text = String(issue || '').trim();
    el.textContent = text ? ` (${text})` : '';
    el.hidden = !text;
  }

  function _setLed(el, state, alert) {
    if (!el) return;
    el.dataset.state = state;
    if (alert) el.dataset.alert = 'true';
    else delete el.dataset.alert;
  }

  function _capabilityLed(enabled, issue, activated = _isActiveOwner()) {
    if (issue) return 'red';
    if (!enabled) return 'red';
    return activated ? 'green' : 'yellow';
  }

  function _activeBrowserLabel(active) {
    if (!active) return 'none';
    return active.browser_label || active.browser_id || 'unknown browser';
  }

  function _syncExternalVoiceState() {
    try {
      window.MatrixChat?.syncVoiceModeAudioState?.();
    } catch (_) {}
  }

  function _publishVoiceModeChanged() {
    try {
      const syncPayload = {
        stt_mode: sttMode(),
        active_owner: _isActiveOwner(),
        selected_stt_mode_active: _isActiveOwner() ? sttMode() : '',
        wake_settings: getWakeSettings(),
      };
      const syncKey = JSON.stringify(syncPayload);
      if (syncKey === _lastWakeControllerSyncKey) return;
      _lastWakeControllerSyncKey = syncKey;
      window.dispatchEvent(new CustomEvent('blueprints:voice-mode:changed', {
        detail: syncPayload,
      }));
    } catch (_) {}
  }

  function _tabButtonFor(tab) {
    const els = _els();
    if (tab === 'local') return els.tabLocal;
    if (tab === 'vps') return els.tabVps;
    return els.tabGeneral;
  }

  function _tabPanelFor(tab) {
    const els = _els();
    if (tab === 'local') return els.panelLocal;
    if (tab === 'vps') return els.panelVps;
    return els.panelGeneral;
  }

  function _renderVoiceModeTabs(els = _els()) {
    ['general', 'local', 'vps'].forEach(tab => {
      const button = _tabButtonFor(tab);
      const panel = _tabPanelFor(tab);
      const selected = tab === _activeModalTab;
      if (button) {
        button.classList.toggle('is-active', selected);
        button.setAttribute('aria-selected', selected ? 'true' : 'false');
      }
      if (panel) panel.hidden = !selected;
    });
  }

  function _setVoiceModeTab(tab) {
    _activeModalTab = ['general', 'local', 'vps'].includes(tab) ? tab : 'general';
    _renderVoiceModeTabs();
  }

  function _instanceControl(instanceId, key) {
    return document.querySelector(`[data-wake-instance="${instanceId}"][data-wake-key="${key}"]`);
  }

  function _instanceValue(instanceId, key, fallback = '') {
    const el = _instanceControl(instanceId, key);
    if (!el) return fallback;
    if (el.type === 'checkbox') return el.checked;
    return el.value;
  }

  function _setControlValue(el, value) {
    if (!el) return;
    if (el.type === 'checkbox') {
      el.checked = !!value;
    } else {
      el.value = value == null ? '' : String(value);
    }
  }

  function _renderWakeInstance(instanceId, instance) {
    if (!instance) return;
    const keys = [
      'matrix_room_id',
      'wake_word',
      'auto_execute_silence_ms',
      'execute_cancel_ms',
      'commands.pause',
      'commands.execute',
      'commands.resume',
      'commands.cancel',
    ];
    keys.forEach(key => {
      const el = _instanceControl(instanceId, key);
      const value = key.startsWith('commands.')
        ? instance.commands?.[key.split('.')[1]]
        : instance[key];
      _setControlValue(el, value);
      const output = document.querySelector(`[data-wake-instance="${instanceId}"][data-wake-output="${key}"]`);
      if (output) {
        if (key === 'auto_execute_silence_ms' || key === 'execute_cancel_ms') {
          output.textContent = Number(value) > 0 ? `${value} ms` : 'Off';
        } else {
          output.textContent = `${value} ms`;
        }
      }
    });
  }

  function _renderWakePanels(settings) {
    const wakeSettings = _cleanWakeSettings(settings);
    Object.entries(wakeSettings.instances || {}).forEach(([instanceId, instance]) => {
      _renderWakeInstance(instanceId, instance);
    });
  }

  function _renderAggregationTimeout(sttPolicy) {
    const els = _els();
    const supported = _aggregationTimeout?.supported === true;
    if (els.aggWrap) els.aggWrap.hidden = !supported;
    const value = supported
      ? Number(_aggregationTimeout.aggregation_timeout_ms)
      : Number(sttPolicy?.speech_aggregation_timeout_ms || 80);
    if (els.aggSlider && Number.isFinite(value)) els.aggSlider.value = String(value);
    if (els.aggLabel && Number.isFinite(value)) els.aggLabel.textContent = `${value} ms`;
  }

  function _formatVadResetTimeout(ms) {
    const value = Math.max(STT_VAD_RESET_MIN_MS, Math.min(STT_VAD_RESET_MAX_MS, Math.round(Number(ms || 0) / STT_VAD_RESET_STEP_MS) * STT_VAD_RESET_STEP_MS));
    return value > 0 ? `${value} ms` : 'Off';
  }

  function _renderVadResetTimeout(sttPolicy) {
    const els = _els();
    const value = _cleanSttPolicy(sttPolicy).vad_reset_timeout_ms;
    if (els.vadResetSlider) els.vadResetSlider.value = String(value);
    if (els.vadResetLabel) els.vadResetLabel.textContent = _formatVadResetTimeout(value);
  }

  function _formatSilenceResetTimeout(ms) {
    const value = Math.max(STT_SILENCE_RESET_MIN_MS, Math.min(STT_SILENCE_RESET_MAX_MS, Math.round(Number(ms || 0) / STT_SILENCE_RESET_STEP_MS) * STT_SILENCE_RESET_STEP_MS));
    return value > 0 ? `${value} ms` : 'Off';
  }

  function _renderSilenceResetTimeout(sttPolicy) {
    const els = _els();
    const value = _cleanSttPolicy(sttPolicy).silence_reset_timeout_ms;
    if (els.silenceResetSlider) els.silenceResetSlider.value = String(value);
    if (els.silenceResetLabel) els.silenceResetLabel.textContent = _formatSilenceResetTimeout(value);
  }

  function _wakeRuntimeLabel(local) {
    if (local.stt_mode !== STT_MODE_WAKE) return 'Wake to Talk is not selected.';
    if (!_isActiveOwner()) return 'Wake to Talk is selected but this browser is not the Active Browser.';
    return 'Wake to Talk is selected; VAD-backed capture is pending rewrite.';
  }

  function _renderWakeRuntime(local, els = _els()) {
    if (!els.wakeRuntime || !els.wakeRuntimeLabel) return;
    els.wakeRuntime.dataset.state = local.stt_mode === STT_MODE_WAKE && _isActiveOwner() ? 'selected-inactive' : 'disabled';
    els.wakeRuntimeLabel.textContent = _wakeRuntimeLabel(local);
  }

  function _collectWakeSettingsFromDom() {
    const current = getWakeSettings();
    const next = _cleanWakeSettings(current);
    Object.keys(next.instances || {}).forEach(instanceId => {
      const instance = next.instances[instanceId];
      instance.enabled = true;
      instance.matrix_room_id = _instanceValue(instanceId, 'matrix_room_id', instance.matrix_room_id);
      instance.wake_word = _instanceValue(instanceId, 'wake_word', instance.wake_word);
      instance.auto_execute_silence_ms = Number(_instanceValue(instanceId, 'auto_execute_silence_ms', instance.auto_execute_silence_ms));
      instance.execute_cancel_ms = Number(_instanceValue(instanceId, 'execute_cancel_ms', instance.execute_cancel_ms));
      instance.commands = {
        pause: _instanceValue(instanceId, 'commands.pause', instance.commands?.pause || 'pause-dictation'),
        execute: _instanceValue(instanceId, 'commands.execute', instance.commands?.execute || 'execute'),
        resume: _instanceValue(instanceId, 'commands.resume', instance.commands?.resume || 'resume-dictation'),
        cancel: _instanceValue(instanceId, 'commands.cancel', instance.commands?.cancel || 'cancel-dictation'),
      };
    });
    return _cleanWakeSettings(next);
  }

  function _scheduleWakeSettingsSave() {
    if (_wakeSaveTimer) window.clearTimeout(_wakeSaveTimer);
    _wakeSaveTimer = window.setTimeout(() => {
      _wakeSaveTimer = null;
      saveWakeSettings(_collectWakeSettingsFromDom()).catch(error => _setStatus(error.message || String(error)));
    }, 450);
  }

  function _render() {
    const els = _els();
    if (!els.modal) {
      _syncExternalVoiceState();
      return;
    }
    const local = _localState();
    const cue = _cueState();
    const policy = _policyState();
    const wakeSettings = getWakeSettings();
    const active = _serverState.active || null;
    const ownsActivation = _isActiveOwner();

    if (els.browserLabel) els.browserLabel.textContent = local.browser_label;
    if (els.browserMeta) {
      els.browserMeta.textContent = `Active Browser: ${_activeBrowserLabel(active)}`;
    }
    if (els.sttRealtime) els.sttRealtime.checked = local.stt_mode === STT_MODE_REALTIME;
    if (els.sttPush) els.sttPush.checked = local.stt_mode === STT_MODE_PUSH;
    if (els.sttWake) els.sttWake.checked = local.stt_mode === STT_MODE_WAKE;
    if (els.sttNoise) {
      els.sttNoise.checked = local.stt_noise_reduction_enabled;
    }
    if (els.sttNoiseLevel) {
      els.sttNoiseLevel.value = String(local.stt_noise_reduction_level_db);
      els.sttNoiseLevel.disabled = !local.stt_noise_reduction_enabled;
    }
    if (els.sttNoiseLevelLabel) {
      els.sttNoiseLevelLabel.textContent = `${local.stt_noise_reduction_level_db.toFixed(1)} dB`;
    }
    if (els.tts) els.tts.checked = local.tts_enabled;
    const sttIssue = _componentIssue('stt');
    const noiseIssue = _componentIssue('noise_reduction');
    const ttsIssue = _componentIssue('tts');
    _setIssue(els.sttRealtimeIssue, local.stt_mode === STT_MODE_REALTIME ? sttIssue : '');
    _setIssue(els.sttPushIssue, local.stt_mode === STT_MODE_PUSH || !local.stt_mode ? sttIssue : '');
    _setIssue(els.sttWakeIssue, local.stt_mode === STT_MODE_WAKE ? sttIssue : '');
    _setIssue(els.sttNoiseIssue, noiseIssue);
    _setIssue(els.ttsIssue, ttsIssue);
    _setLed(
      els.sttRealtimeLed,
      _capabilityLed(
        local.stt_mode === STT_MODE_REALTIME,
        local.stt_mode === STT_MODE_REALTIME ? sttIssue : '',
        _ownsActiveSttMode(STT_MODE_REALTIME)
      ),
      Boolean(local.stt_mode === STT_MODE_REALTIME && sttIssue)
    );
    _setLed(
      els.sttPushLed,
      _capabilityLed(
        local.stt_mode === STT_MODE_PUSH,
        local.stt_mode === STT_MODE_PUSH ? sttIssue : '',
        _ownsActiveSttMode(STT_MODE_PUSH)
      ),
      Boolean(local.stt_mode === STT_MODE_PUSH && sttIssue)
    );
    _setLed(
      els.sttWakeLed,
      _capabilityLed(
        local.stt_mode === STT_MODE_WAKE,
        local.stt_mode === STT_MODE_WAKE ? sttIssue : '',
        _ownsActiveSttMode(STT_MODE_WAKE)
      ),
      Boolean(local.stt_mode === STT_MODE_WAKE && sttIssue)
    );
    _setLed(
      els.sttNoiseLed,
      _capabilityLed(local.stt_noise_reduction_enabled, local.stt_noise_reduction_enabled ? noiseIssue : ''),
      Boolean(local.stt_noise_reduction_enabled && noiseIssue)
    );
    _setLed(
      els.ttsLed,
      _capabilityLed(local.tts_enabled, local.tts_enabled ? ttsIssue : ''),
      Boolean(local.tts_enabled && ttsIssue)
    );
    if (els.cueToggle) els.cueToggle.checked = cue.enabled;
    if (els.cueSound) els.cueSound.value = cue.sound;
    if (els.cueRearm) els.cueRearm.value = String(cue.rearm_ms / 1000);
    if (els.cueRearmLabel) els.cueRearmLabel.textContent = `${(cue.rearm_ms / 1000).toFixed(2)}s`;
    if (els.cueTest) els.cueTest.disabled = !cue.sound;
    if (els.modelCodex) els.modelCodex.checked = policy.tts_companion_model_preference === 'codex_spark';
    if (els.modelLocal) els.modelLocal.checked = policy.tts_companion_model_preference === 'local_private';
    _renderVoiceModeTabs(els);
    _renderWakePanels(wakeSettings);
    _renderAggregationTimeout(policy.stt);
    _renderVadResetTimeout(policy.stt);
    _renderSilenceResetTimeout(policy.stt);
    _renderWakeRuntime(local, els);
    if (cue.sound && typeof SoundManager !== 'undefined' && typeof SoundManager.preload === 'function') {
      SoundManager.preload(_assetUrl(cue.sound)).catch(() => {});
    }
    if (els.activate) {
      els.activate.textContent = ownsActivation ? 'Deactivate' : 'Activate';
      els.activate.disabled = false;
    }
    _syncExternalVoiceState();
    _publishVoiceModeChanged();
  }

  function _applyServerState(payload) {
    const next = payload && payload.active !== undefined ? payload : (payload?.payload || {});
    if (!next || next.active === undefined) return;
    const revision = Number(next.revision || 0);
    if (_serverState.revision && revision && revision < _serverState.revision) return;
    _serverState = {
      active: next.active || null,
      policy: _cleanPolicy(next.policy || { tts_companion_model_preference: 'codex_spark' }),
      revision,
      updated_at: Number(next.updated_at || 0),
    };
    _wakeSettings = _cleanWakeSettings(_serverState.policy.wake_to_talk);
    _wakeSettingsLoaded = true;
    _statusLoaded = true;
    _render();
  }

  async function reconcile() {
    try {
      const response = await apiFetch(STATUS_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      _applyServerState(await response.json());
      _syncActiveActivationAfterLocalChange().catch((error) => _setStatus(error.message || String(error)));
      return _serverState;
    } catch (error) {
      _setStatus(`Voice Mode status unavailable: ${error.message || error}`);
      throw error;
    }
  }

  function _modalIsOpen() {
    const modal = _els().modal;
    return Boolean(modal && modal.open && document.visibilityState !== 'hidden');
  }

  function _scheduleDependencyHealthPoll(delayMs) {
    if (_dependencyHealthTimer) window.clearTimeout(_dependencyHealthTimer);
    _dependencyHealthTimer = null;
    if (!_modalIsOpen()) return;
    const ms = Math.max(2000, Math.min(30000, Number(delayMs) || 30000));
    _dependencyHealthTimer = window.setTimeout(() => {
      _dependencyHealthTimer = null;
      refreshDependencyHealth().catch(() => {});
    }, ms);
  }

  async function refreshDependencyHealth(options = {}) {
    if (_dependencyHealthInFlight) return _dependencyHealth;
    _dependencyHealthInFlight = true;
    try {
      const suffix = options.force ? '?force=true' : '';
      const response = await apiFetch(`${DEPENDENCY_HEALTH_URL}${suffix}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      _dependencyHealth = await response.json();
      _render();
      const hasIssue = _dependencyHealth && _dependencyHealth.ok === false;
      const nextSeconds = Number(_dependencyHealth?.next_check_seconds || (hasIssue ? 2 : 30));
      _scheduleDependencyHealthPoll(nextSeconds * 1000);
      return _dependencyHealth;
    } catch (error) {
      _dependencyHealth = {
        ok: false,
        components: {
          stt: { ok: false, issue: 'health check unavailable' },
          noise_reduction: { ok: false, issue: 'health check unavailable' },
          tts: { ok: false, issue: 'health check unavailable' },
        },
        next_check_seconds: 2,
      };
      _render();
      _scheduleDependencyHealthPoll(2000);
      return _dependencyHealth;
    } finally {
      _dependencyHealthInFlight = false;
    }
  }

  async function loadWakeSettings(options = {}) {
    if (_wakeSettingsInFlight && !options.force) return _wakeSettings;
    _wakeSettingsInFlight = true;
    try {
      const response = await apiFetch(WAKE_SETTINGS_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      _wakeSettings = _cleanWakeSettings(payload.wake_to_talk);
      _serverState.policy = {
        ...(_serverState.policy || {}),
        wake_to_talk: _wakeSettings,
        stt: _cleanSttPolicy(payload.stt),
      };
      _wakeSettingsLoaded = true;
      _render();
      window.dispatchEvent(new CustomEvent('blueprints:voice-mode:wake-settings-changed', {
        detail: { wake_settings: _wakeSettings },
      }));
      return _wakeSettings;
    } finally {
      _wakeSettingsInFlight = false;
    }
  }

  async function saveWakeSettings(settings) {
    const next = _cleanWakeSettings(settings);
    _wakeSettings = next;
    _wakeSettingsLoaded = true;
    _setStatus('Saving Wake to Talk settings...');
    const response = await apiFetch(WAKE_SETTINGS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wake_to_talk: next,
        stt: _cleanSttPolicy(_serverState.policy?.stt),
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) throw new Error(payload?.detail || `HTTP ${response.status}`);
    _applyServerState(payload);
    _wakeSettings = _cleanWakeSettings(payload.wake_to_talk || payload.policy?.wake_to_talk);
    _setStatus('Wake to Talk settings saved.');
    window.dispatchEvent(new CustomEvent('blueprints:voice-mode:wake-settings-changed', {
      detail: { wake_settings: _wakeSettings },
    }));
    return _wakeSettings;
  }

  async function saveVadResetTimeout(ms) {
    const currentPolicy = _cleanSttPolicy(_serverState.policy?.stt);
    const nextStt = {
      ...currentPolicy,
      vad_reset_timeout_ms: _cleanSttPolicy({ vad_reset_timeout_ms: ms }).vad_reset_timeout_ms,
    };
    const response = await apiFetch(WAKE_SETTINGS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wake_to_talk: getWakeSettings(),
        stt: nextStt,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) throw new Error(payload?.detail || `HTTP ${response.status}`);
    _applyServerState(payload);
    window.dispatchEvent(new CustomEvent('blueprints:voice-mode:wake-settings-changed', {
      detail: { wake_settings: getWakeSettings(), stt: _cleanSttPolicy(payload.stt || payload.policy?.stt) },
    }));
    return nextStt;
  }

  async function savePreRollFrames(frames) {
    const currentPolicy = _cleanSttPolicy(_serverState.policy?.stt);
    const nextStt = {
      ...currentPolicy,
      pre_roll_frames: _cleanSttPolicy({ pre_roll_frames: frames }).pre_roll_frames,
    };
    const response = await apiFetch(WAKE_SETTINGS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wake_to_talk: getWakeSettings(),
        stt: nextStt,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) throw new Error(payload?.detail || `HTTP ${response.status}`);
    _applyServerState(payload);
    window.dispatchEvent(new CustomEvent('blueprints:voice-mode:wake-settings-changed', {
      detail: { wake_settings: getWakeSettings(), stt: _cleanSttPolicy(payload.stt || payload.policy?.stt) },
    }));
    return nextStt;
  }

  async function saveSileroVadEnabled(enabled) {
    const currentPolicy = _cleanSttPolicy(_serverState.policy?.stt);
    const nextStt = {
      ...currentPolicy,
      silero_vad_enabled: _cleanSttPolicy({ silero_vad_enabled: enabled }).silero_vad_enabled,
    };
    const response = await apiFetch(WAKE_SETTINGS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wake_to_talk: getWakeSettings(),
        stt: nextStt,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) throw new Error(payload?.detail || `HTTP ${response.status}`);
    _applyServerState(payload);
    window.dispatchEvent(new CustomEvent('blueprints:voice-mode:wake-settings-changed', {
      detail: { wake_settings: getWakeSettings(), stt: _cleanSttPolicy(payload.stt || payload.policy?.stt) },
    }));
    return nextStt;
  }

  async function saveVadInterruptTtsEnabled(enabled) {
    const currentPolicy = _cleanSttPolicy(_serverState.policy?.stt);
    const nextStt = {
      ...currentPolicy,
      vad_interrupt_tts_enabled: _cleanSttPolicy({ vad_interrupt_tts_enabled: enabled }).vad_interrupt_tts_enabled,
    };
    const response = await apiFetch(WAKE_SETTINGS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wake_to_talk: getWakeSettings(),
        stt: nextStt,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) throw new Error(payload?.detail || `HTTP ${response.status}`);
    _applyServerState(payload);
    window.dispatchEvent(new CustomEvent('blueprints:voice-mode:wake-settings-changed', {
      detail: { wake_settings: getWakeSettings(), stt: _cleanSttPolicy(payload.stt || payload.policy?.stt) },
    }));
    return nextStt;
  }

  async function saveWordDetectionMatchInterruptTtsEnabled(enabled) {
    const currentPolicy = _cleanSttPolicy(_serverState.policy?.stt);
    const nextStt = {
      ...currentPolicy,
      word_detection_match_interrupt_tts_enabled: _cleanSttPolicy({
        word_detection_match_interrupt_tts_enabled: enabled,
      }).word_detection_match_interrupt_tts_enabled,
    };
    const response = await apiFetch(WAKE_SETTINGS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wake_to_talk: getWakeSettings(),
        stt: nextStt,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) throw new Error(payload?.detail || `HTTP ${response.status}`);
    _applyServerState(payload);
    window.dispatchEvent(new CustomEvent('blueprints:voice-mode:wake-settings-changed', {
      detail: { wake_settings: getWakeSettings(), stt: _cleanSttPolicy(payload.stt || payload.policy?.stt) },
    }));
    return nextStt;
  }

  async function saveWordDetectionPrefixPartialInterruptTtsEnabled(enabled) {
    const currentPolicy = _cleanSttPolicy(_serverState.policy?.stt);
    const next = _cleanSttPolicy({
      ...currentPolicy,
      word_detection_prefix_partial_interrupt_tts_enabled: enabled,
      word_detection_prefix_final_interrupt_tts_enabled: enabled
        ? false
        : currentPolicy.word_detection_prefix_final_interrupt_tts_enabled,
    });
    const response = await apiFetch(WAKE_SETTINGS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wake_to_talk: getWakeSettings(),
        stt: next,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) throw new Error(payload?.detail || `HTTP ${response.status}`);
    _applyServerState(payload);
    window.dispatchEvent(new CustomEvent('blueprints:voice-mode:wake-settings-changed', {
      detail: { wake_settings: getWakeSettings(), stt: _cleanSttPolicy(payload.stt || payload.policy?.stt) },
    }));
    return next;
  }

  async function saveWordDetectionPrefixFinalInterruptTtsEnabled(enabled) {
    const currentPolicy = _cleanSttPolicy(_serverState.policy?.stt);
    const next = _cleanSttPolicy({
      ...currentPolicy,
      word_detection_prefix_partial_interrupt_tts_enabled: enabled
        ? false
        : currentPolicy.word_detection_prefix_partial_interrupt_tts_enabled,
      word_detection_prefix_final_interrupt_tts_enabled: enabled,
    });
    const response = await apiFetch(WAKE_SETTINGS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wake_to_talk: getWakeSettings(),
        stt: next,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) throw new Error(payload?.detail || `HTTP ${response.status}`);
    _applyServerState(payload);
    window.dispatchEvent(new CustomEvent('blueprints:voice-mode:wake-settings-changed', {
      detail: { wake_settings: getWakeSettings(), stt: _cleanSttPolicy(payload.stt || payload.policy?.stt) },
    }));
    return next;
  }

  async function saveWordDetectionPayload0TimeoutMs(value) {
    const currentPolicy = _cleanSttPolicy(_serverState.policy?.stt);
    const nextStt = {
      ...currentPolicy,
      word_detection_payload0_timeout_ms: _cleanSttPolicy({
        word_detection_payload0_timeout_ms: value,
      }).word_detection_payload0_timeout_ms,
    };
    const response = await apiFetch(WAKE_SETTINGS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wake_to_talk: getWakeSettings(),
        stt: nextStt,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) throw new Error(payload?.detail || `HTTP ${response.status}`);
    _applyServerState(payload);
    window.dispatchEvent(new CustomEvent('blueprints:voice-mode:wake-settings-changed', {
      detail: { wake_settings: getWakeSettings(), stt: _cleanSttPolicy(payload.stt || payload.policy?.stt) },
    }));
    return nextStt;
  }

  async function saveAlwaysPreRollEnabled(enabled) {
    const currentPolicy = _cleanSttPolicy(_serverState.policy?.stt);
    const nextStt = {
      ...currentPolicy,
      always_pre_roll_enabled: _cleanSttPolicy({ always_pre_roll_enabled: enabled }).always_pre_roll_enabled,
    };
    const response = await apiFetch(WAKE_SETTINGS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wake_to_talk: getWakeSettings(),
        stt: nextStt,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) throw new Error(payload?.detail || `HTTP ${response.status}`);
    _applyServerState(payload);
    window.dispatchEvent(new CustomEvent('blueprints:voice-mode:wake-settings-changed', {
      detail: { wake_settings: getWakeSettings(), stt: _cleanSttPolicy(payload.stt || payload.policy?.stt) },
    }));
    return nextStt;
  }

  async function saveSilenceResetTimeout(ms) {
    const currentPolicy = _cleanSttPolicy(_serverState.policy?.stt);
    const nextStt = {
      ...currentPolicy,
      silence_reset_timeout_ms: _cleanSttPolicy({ silence_reset_timeout_ms: ms }).silence_reset_timeout_ms,
    };
    const response = await apiFetch(WAKE_SETTINGS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wake_to_talk: getWakeSettings(),
        stt: nextStt,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) throw new Error(payload?.detail || `HTTP ${response.status}`);
    _applyServerState(payload);
    window.dispatchEvent(new CustomEvent('blueprints:voice-mode:wake-settings-changed', {
      detail: { wake_settings: getWakeSettings(), stt: _cleanSttPolicy(payload.stt || payload.policy?.stt) },
    }));
    return nextStt;
  }

  async function loadAggregationTimeout(options = {}) {
    if (_aggregationTimeoutInFlight && !options.force) return _aggregationTimeout;
    _aggregationTimeoutInFlight = true;
    try {
      const response = await apiFetch(AGGREGATION_TIMEOUT_URL, { cache: 'no-store' });
      _aggregationTimeout = await response.json().catch(() => null);
      _render();
      return _aggregationTimeout;
    } finally {
      _aggregationTimeoutInFlight = false;
    }
  }

  async function saveAggregationTimeout(ms) {
    const value = Math.max(50, Math.min(300, Math.round(Number(ms || 80) / 10) * 10));
    const response = await apiFetch(AGGREGATION_TIMEOUT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aggregation_timeout_ms: value }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) throw new Error(payload?.detail || `HTTP ${response.status}`);
    _aggregationTimeout = payload;
    _serverState.policy = {
      ...(_serverState.policy || {}),
      stt: {
        ..._cleanSttPolicy(_serverState.policy?.stt),
        speech_aggregation_timeout_ms: payload.aggregation_timeout_ms,
      },
    };
    _render();
    return payload;
  }

  async function loadWakeRooms(instanceId) {
    const settings = getWakeSettings();
    const instance = settings.instances?.[instanceId];
    const select = _instanceControl(instanceId, 'matrix_room_id');
    if (!instance || !select) return;
    const url = `/api/v1/matrix-chat/rooms?server=${encodeURIComponent(instance.matrix_server || 'tb1')}`;
    try {
      const response = await apiFetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const joined = Array.isArray(payload.joined) ? payload.joined : [];
      const current = instance.matrix_room_id || select.value || '';
      select.innerHTML = '';
      joined.forEach(room => {
        const option = document.createElement('option');
        option.value = room.room_id || '';
        option.textContent = room.name || room.room_id || 'Matrix room';
        select.appendChild(option);
      });
      if (!joined.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No joined rooms';
        select.appendChild(option);
      }
      select.value = current || joined[0]?.room_id || '';
      if (!current && select.value) {
        _scheduleWakeSettingsSave();
      }
    } catch (error) {
      if (!select.options.length) {
        const option = document.createElement('option');
        option.value = instance.matrix_room_id || '';
        option.textContent = instance.matrix_room_id ? 'Configured room' : 'Rooms unavailable';
        select.appendChild(option);
      }
    }
  }

  function loadAllWakeRooms() {
    ['local', 'vps'].forEach(instanceId => {
      loadWakeRooms(instanceId).catch(() => {});
    });
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
    _setStatus('Activating browser...');
    await _post(ACTIVATE_URL, local);
    _setStatus('This browser is now the Active Browser.');
  }

  async function deactivate() {
    _setStatus('Deactivating browser...');
    await _post(DEACTIVATE_URL, _localState());
    _setStatus('This browser is no longer the Active Browser.');
  }

  async function _syncActiveActivationAfterLocalChange() {
    if (!_isActiveOwner() || _activeActivationSyncInFlight) return;
    const local = _localState();
    const active = _serverState.active || {};
    const activeMode = _normalizeSttMode(active.stt_mode, Boolean(active.stt_enabled));
    const activeTts = !!active.tts_enabled;
    if (activeMode === local.stt_mode && activeTts === local.tts_enabled) return;
    _activeActivationSyncInFlight = true;
    try {
      _setStatus('Updating Active Browser state...');
      await _post(ACTIVATE_URL, local);
      _setStatus('Active Browser state updated.');
    } finally {
      _activeActivationSyncInFlight = false;
    }
  }

  function _setLocalToggles({ tts }) {
    if (typeof tts === 'boolean') _setBoolStorage(LS_TTS, tts);
    _render();
    _syncActiveActivationAfterLocalChange().catch((error) => _setStatus(error.message || String(error)));
  }

  function _setSttMode(mode) {
    const next = _setStoredSttMode(mode);
    _render();
    _setStatus(next ? `${_sttModeStatusLabel(next)} enabled for this browser.` : 'STT disabled for this browser.');
    _syncActiveActivationAfterLocalChange().catch((error) => _setStatus(error.message || String(error)));
  }

  function _toggleSttMode(mode, checked) {
    _setSttMode(checked ? mode : STT_MODE_NONE);
  }

  function _setSttNoiseReduction(value) {
    _setBoolStorage(LS_STT_NOISE, value);
    _render();
    _setStatus(value ? 'STT noise reduction enabled for this browser.' : 'STT noise reduction disabled.');
    window.dispatchEvent(new CustomEvent('blueprints:voice-mode:stt-noise-changed', {
      detail: {
        enabled: !!value,
        level_db: sttNoiseReductionLevelDb(),
      },
    }));
  }

  function _setSttNoiseLevelDb(value) {
    const level = _clampNoiseLevelDb(value);
    _setStringStorage(LS_STT_NOISE_LEVEL_DB, String(level));
    _render();
    window.dispatchEvent(new CustomEvent('blueprints:voice-mode:stt-noise-changed', {
      detail: {
        enabled: sttNoiseReductionSettingEnabled(),
        level_db: level,
      },
    }));
  }

  function sttNoiseReductionEnabled() {
    return !!_localState().stt_noise_reduction_enabled;
  }

  function sttNoiseReductionSettingEnabled() {
    return !!_localState().stt_noise_reduction_enabled;
  }

  function sttNoiseReductionLevelDb() {
    return _localState().stt_noise_reduction_level_db;
  }

  function sttAggregationTimeoutMs() {
    const live = Number(_aggregationTimeout?.aggregation_timeout_ms);
    if (Number.isFinite(live)) return Math.max(50, Math.min(300, Math.round(live / 10) * 10));
    const policy = Number(_serverState.policy?.stt?.speech_aggregation_timeout_ms);
    return Number.isFinite(policy) ? Math.max(50, Math.min(300, Math.round(policy / 10) * 10)) : 80;
  }

  function vadResetTimeoutMs() {
    return _cleanSttPolicy(_serverState.policy?.stt).vad_reset_timeout_ms;
  }

  function preRollFrames() {
    return _cleanSttPolicy(_serverState.policy?.stt).pre_roll_frames;
  }

  function sileroVadEnabled() {
    return _cleanSttPolicy(_serverState.policy?.stt).silero_vad_enabled;
  }

  function vadInterruptTtsEnabled() {
    return _cleanSttPolicy(_serverState.policy?.stt).vad_interrupt_tts_enabled;
  }

  function wordDetectionMatchInterruptTtsEnabled() {
    return _cleanSttPolicy(_serverState.policy?.stt).word_detection_match_interrupt_tts_enabled;
  }

  function wordDetectionPrefixPartialInterruptTtsEnabled() {
    return _cleanSttPolicy(_serverState.policy?.stt).word_detection_prefix_partial_interrupt_tts_enabled;
  }

  function wordDetectionPrefixFinalInterruptTtsEnabled() {
    return _cleanSttPolicy(_serverState.policy?.stt).word_detection_prefix_final_interrupt_tts_enabled;
  }

  function wordDetectionPayload0TimeoutMs() {
    return _cleanSttPolicy(_serverState.policy?.stt).word_detection_payload0_timeout_ms;
  }

  function alwaysPreRollEnabled() {
    return _cleanSttPolicy(_serverState.policy?.stt).always_pre_roll_enabled;
  }

  function silenceResetTimeoutMs() {
    return _cleanSttPolicy(_serverState.policy?.stt).silence_reset_timeout_ms;
  }

  function sttMode() {
    return _localState().stt_mode;
  }

  function sttModeEnabled(mode) {
    return _localState().stt_mode === _normalizeSttMode(mode);
  }

  function isActiveOwner() {
    return _isActiveOwner();
  }

  function activeSttMode() {
    return _activeSttMode();
  }

  function ownsActiveSttMode(mode) {
    return _ownsActiveSttMode(mode);
  }

  function getWakeSettings() {
    if (_wakeSettingsLoaded && _wakeSettings) return _cleanWakeSettings(_wakeSettings);
    const policySettings = _serverState.policy?.wake_to_talk;
    if (policySettings) return _cleanWakeSettings(policySettings);
    return _defaultWakeSettings();
  }

  function canUsePushToTalkStt() {
    const local = _localState();
    return Boolean(
      local.stt_mode === STT_MODE_PUSH
      && _ownsActiveSttMode(STT_MODE_PUSH)
    );
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

  async function toggleActive(options = {}) {
    try {
      const requiredMode = _normalizeSttMode(options?.stt_mode || '');
      if (requiredMode && !_ownsActiveSttMode(requiredMode)) await activate();
      else if (_isActiveOwner()) await deactivate();
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
    refreshDependencyHealth({ force: true }).catch(() => {});
    loadWakeSettings().then(loadAllWakeRooms).catch((error) => _setStatus(error.message || String(error)));
    loadAggregationTimeout({ force: true }).catch(() => {});
    if (typeof HubModal !== 'undefined') {
      HubModal.open(els.modal, {
        onOpen: () => {
          _render();
          refreshDependencyHealth({ force: true }).catch(() => {});
          loadWakeSettings().then(loadAllWakeRooms).catch((error) => _setStatus(error.message || String(error)));
          loadAggregationTimeout({ force: true }).catch(() => {});
        },
      });
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
    els.sttRealtime?.addEventListener('change', () => _toggleSttMode(STT_MODE_REALTIME, els.sttRealtime.checked));
    els.sttPush?.addEventListener('change', () => _toggleSttMode(STT_MODE_PUSH, els.sttPush.checked));
    els.sttWake?.addEventListener('change', () => _toggleSttMode(STT_MODE_WAKE, els.sttWake.checked));
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
    els.tabGeneral?.addEventListener('click', () => _setVoiceModeTab('general'));
    els.tabLocal?.addEventListener('click', () => _setVoiceModeTab('local'));
    els.tabVps?.addEventListener('click', () => _setVoiceModeTab('vps'));
    els.aggSlider?.addEventListener('input', () => {
      if (els.aggLabel) els.aggLabel.textContent = `${els.aggSlider.value} ms`;
    });
    els.aggSlider?.addEventListener('change', () => {
      saveAggregationTimeout(els.aggSlider.value).catch((error) => _setStatus(error.message || String(error)));
    });
    els.vadResetSlider?.addEventListener('input', () => {
      if (els.vadResetLabel) els.vadResetLabel.textContent = _formatVadResetTimeout(els.vadResetSlider.value);
    });
    els.vadResetSlider?.addEventListener('change', () => {
      saveVadResetTimeout(els.vadResetSlider.value).catch((error) => _setStatus(error.message || String(error)));
    });
    els.silenceResetSlider?.addEventListener('input', () => {
      if (els.silenceResetLabel) els.silenceResetLabel.textContent = _formatSilenceResetTimeout(els.silenceResetSlider.value);
    });
    els.silenceResetSlider?.addEventListener('change', () => {
      saveSilenceResetTimeout(els.silenceResetSlider.value).catch((error) => _setStatus(error.message || String(error)));
    });
    document.querySelectorAll('[data-wake-instance][data-wake-key]').forEach(control => {
      control.addEventListener('input', () => {
        const outputKey = control.dataset.wakeKey;
        const instanceId = control.dataset.wakeInstance;
        const output = document.querySelector(`[data-wake-instance="${instanceId}"][data-wake-output="${outputKey}"]`);
        if (output) {
          if (outputKey === 'auto_execute_silence_ms' || outputKey === 'execute_cancel_ms') output.textContent = Number(control.value) > 0 ? `${control.value} ms` : 'Off';
          else output.textContent = `${control.value} ms`;
        }
        _scheduleWakeSettingsSave();
      });
      control.addEventListener('change', () => {
        _scheduleWakeSettingsSave();
      });
    });

    document.addEventListener('blueprints:event', (event) => {
      if (event.detail?.event_type === 'voice.mode.changed') {
        _applyServerState(event.detail.payload || {});
      }
    });
    window.addEventListener('focus', () => {
      reconcile().catch(() => {});
      if (_modalIsOpen()) refreshDependencyHealth().catch(() => {});
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        reconcile().catch(() => {});
        if (_modalIsOpen()) refreshDependencyHealth().catch(() => {});
      } else if (_dependencyHealthTimer) {
        window.clearTimeout(_dependencyHealthTimer);
        _dependencyHealthTimer = null;
      }
    });
    els.modal.addEventListener('close', () => {
      if (_dependencyHealthTimer) window.clearTimeout(_dependencyHealthTimer);
      _dependencyHealthTimer = null;
    });
    reconcile().catch(() => {});
    loadWakeSettings().then(loadAllWakeRooms).catch(() => {});
    _render();
  }

  document.addEventListener('DOMContentLoaded', _wire);

  return {
    open,
    toggleActive,
    reconcile,
    canSpeakHermesUtterance,
    sttNoiseReductionEnabled,
    sttNoiseReductionSettingEnabled,
    sttNoiseReductionLevelDb,
    sttAggregationTimeoutMs,
    vadResetTimeoutMs,
    preRollFrames,
    sileroVadEnabled,
    vadInterruptTtsEnabled,
    wordDetectionMatchInterruptTtsEnabled,
    wordDetectionPrefixPartialInterruptTtsEnabled,
    wordDetectionPrefixFinalInterruptTtsEnabled,
    wordDetectionPayload0TimeoutMs,
    alwaysPreRollEnabled,
    silenceResetTimeoutMs,
    sttMode,
    sttModeEnabled,
    canUsePushToTalkStt,
    isActiveOwner,
    activeSttMode,
    ownsActiveSttMode,
    getWakeSettings,
    loadWakeSettings,
    saveWakeSettings,
    loadAggregationTimeout,
    saveAggregationTimeout,
    saveVadResetTimeout,
    savePreRollFrames,
    saveSileroVadEnabled,
    saveVadInterruptTtsEnabled,
    saveWordDetectionMatchInterruptTtsEnabled,
    saveWordDetectionPrefixPartialInterruptTtsEnabled,
    saveWordDetectionPrefixFinalInterruptTtsEnabled,
    saveWordDetectionPayload0TimeoutMs,
    saveAlwaysPreRollEnabled,
    saveSilenceResetTimeout,
    setSttMode: _setSttMode,
    setSttNoiseReductionEnabled: _setSttNoiseReduction,
    setSttNoiseReductionLevelDb: _setSttNoiseLevelDb,
    maybePlayAnnouncementCue,
    getLocalState: _localState,
    getBrowserId: _browserId,
    getBrowserLabel: _browserLabel,
    getTabId: _tabId,
  };
})();

window.BlueprintsVoiceMode = BlueprintsVoiceMode;
