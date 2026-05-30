// vad-dev.js - isolated VAD/STT development surface.

'use strict';

const VadDevModal = (() => {
  const DEV_STATUS_URL = '/api/v1/voice-mode/dev-status';
  const STT_WS_URL = '/api/v1/voice-mode/stt/ws';
  const SAMPLE_RATE = 16000;
  const AUDIO_BUFFER_SIZE = 4096;
  const WINDOW_MS = 10000;
  const POLL_MS = 500;
  const DEV_COMMAND_EVENT_TYPE = 'voice.mode.dev.command';
  const DEV_COMMAND_MAX_SEEN = 200;
  const DEV_STATUS_MIN_MS = 500;
  const VAD_TEST_DELAY_FRAMES = 0;
  const VAD_TEST_ABSOLUTE_FLOOR = 0.0012;
  const VAD_TEST_ENTER_DELTA_DB = 5.5;
  const VAD_TEST_EXIT_DELTA_DB = 2.5;
  const VAD_TEST_STRONG_DELTA_DB = 8.5;
  const VAD_TEST_CONFIRM_FRAMES = 2;
  const VAD_TEST_CONFIRM_MIN_MS = 80;
  const VAD_TEST_RELEASE_FRAMES = 2;
  const VAD_TEST_EXIT_HANGOVER_MS = 180;
  const VAD_TEST_NOISE_MIN = 0.00035;
  const VAD_TEST_NOISE_MAX = 0.08;
  const VAD_TEST_NOISE_DOWN_ALPHA = 0.92;
  const VAD_TEST_NOISE_UP_ALPHA = 0.996;
  const VAD_TEST_NOISE_UP_CAP_RATIO = 1.18;
  const VAD_TEST_BASELINE_HOLDOFF_MS = 650;
  const NOISE_THRESHOLD_DEFAULT_DB = -40;
  const NOISE_THRESHOLD_MIN_DB = -80;
  const NOISE_THRESHOLD_MAX_DB = 0;
  const NOISE_THRESHOLD_STEP_DB = 2;
  const AUTO_PRE_ROLL_LOOKBACK_FRAMES = 1;
  const AUTO_PRE_ROLL_BUFFER_MS = 3200;
  const AUTO_PRE_ROLL_BUFFER_MAX_FRAMES = 96;
  const VAD_RESET_TIMEOUT_MAX_MS = 2000;
  const DETECTOR_ENERGY = 'energy_delta';
  const DETECTOR_SILERO = 'silero_vad';
  const SILERO_MODEL = 'v5';
  const SILERO_POSITIVE_THRESHOLD = 0.3;
  const SILERO_NEGATIVE_THRESHOLD = 0.25;
  const SILERO_REDEMPTION_MS = 900;
  const SILERO_MIN_SPEECH_MS = 250;
  const SILERO_PRE_SPEECH_PAD_MS = 160;
  const SILERO_VAD_ASSET_BASE = '/fallback-ui/vendor/vad-web/';
  const SILERO_ONNX_WASM_BASE = '/fallback-ui/vendor/onnxruntime-web/';
  const SILERO_ORT_SCRIPT = '/fallback-ui/vendor/onnxruntime-web/ort.wasm.min.js';
  const SILERO_VAD_SCRIPT = '/fallback-ui/vendor/vad-web/bundle.min.js';
  const SURFACE = 'vad_dev';

  const MODE_MANUAL = 'manual';
  const MODE_VAD = 'vad';
  const MODE_REARM = 'vad_rearm';
  const MODES = [MODE_MANUAL, MODE_VAD, MODE_REARM];

  const MODE_CONFIG = {
    [MODE_MANUAL]: {
      label: 'Manual STT probe',
      session: 'manual-probe',
      statusOff: 'VAD bypass is off.',
      states: ['MANUAL_STT_OFF', 'MANUAL_STT_READY', 'MANUAL_STT_RECORDING', 'MANUAL_STT_FINALIZING'],
    },
    [MODE_VAD]: {
      label: 'VAD STT probe',
      session: 'vad-probe',
      statusOff: 'VAD STT probe is off.',
      states: ['VAD_STT_OFF', 'VAD_STT_READY', 'VAD_STT_ARMED', 'VAD_STT_OPENING', 'VAD_STT_RECORDING', 'VAD_STT_FINALIZING'],
    },
    [MODE_REARM]: {
      label: 'VAD ReArm STT probe',
      session: 'vad-rearm-probe',
      statusOff: 'VAD ReArm STT probe is off.',
      states: ['VAD_REARM_STT_OFF', 'VAD_REARM_STT_READY', 'VAD_REARM_STT_ARMED', 'VAD_REARM_STT_OPENING', 'VAD_REARM_STT_RECORDING', 'VAD_REARM_STT_FINALIZING'],
    },
  };

  const state = {
    bound: false,
    open: false,
    pollTimer: null,
    timeline: null,
    timelinePromise: null,
    selectedMode: MODE_MANUAL,
    sileroEnabled: false,
    autoPreRollEnabled: false,
    noiseThresholdDb: NOISE_THRESHOLD_DEFAULT_DB,
    sileroScriptPromises: {},
    devCommandIds: [],
    devStatusLastAt: 0,
    devStatusSignature: '',
    devStatusSending: false,
    probes: {
      [MODE_MANUAL]: createProbe(MODE_MANUAL),
      [MODE_VAD]: createProbe(MODE_VAD),
      [MODE_REARM]: createProbe(MODE_REARM),
    },
  };

  const els = {};

  function createPreRollState() {
    return {
      frameId: 0,
      lastCapturedFrameId: 0,
      buffer: [],
      bufferMs: 0,
      lastSentFrameId: 0,
      vadDetectionFrameId: null,
      startFrameId: null,
      selectedFrameIds: [],
      selectedFrameRange: '',
      selectedFrames: 0,
      audioMs: 0,
      fallbackReason: 'not_requested',
      sentFrameIds: [],
      sentFrameRange: '',
      active: false,
      applied: false,
      reason: 'disabled',
      lookbackFrames: AUTO_PRE_ROLL_LOOKBACK_FRAMES,
    };
  }

  function createSileroState() {
    return {
      instance: null,
      loading: false,
      ready: false,
      listening: false,
      error: '',
      model: SILERO_MODEL,
      isSpeechProbability: null,
      notSpeechProbability: null,
      positiveThreshold: SILERO_POSITIVE_THRESHOLD,
      negativeThreshold: SILERO_NEGATIVE_THRESHOLD,
      redemptionMs: SILERO_REDEMPTION_MS,
      minSpeechMs: SILERO_MIN_SPEECH_MS,
      preSpeechPadMs: SILERO_PRE_SPEECH_PAD_MS,
      frameCount: 0,
      lastFrameAt: 0,
      lastSpeechStartAt: 0,
      lastSpeechRealStartAt: 0,
      lastSpeechEndAt: 0,
      misfires: 0,
    };
  }

  function createVadState() {
    return {
      speaking: false,
      candidateActive: false,
      candidateConfirmed: false,
      candidateStartedAt: 0,
      candidateFrames: 0,
      quietFrames: 0,
      speechSeenSinceReset: false,
      lastVoiceAt: 0,
      lastResetAt: 0,
      lastEnergy: 0,
      lastEnergyDb: -80,
      energyDeltaDb: 0,
      noiseFloorDb: -80,
      noiseFloor: 0,
      noiseEstimate: 0,
      noiseEstimateDb: -80,
      noiseEstimateState: 'unavailable',
      noiseThresholdDb: NOISE_THRESHOLD_DEFAULT_DB,
      noiseThresholdExceeded: false,
      noiseThresholdColor: 'green',
      noiseHoldUntil: 0,
      lastNoiseEstimateAt: 0,
      enterThreshold: 0,
      exitThreshold: 0,
      strongEnterThreshold: 0,
      enterDeltaDb: VAD_TEST_ENTER_DELTA_DB,
      exitDeltaDb: VAD_TEST_EXIT_DELTA_DB,
      strongDeltaDb: VAD_TEST_STRONG_DELTA_DB,
      baselinePaused: false,
      lastAutoStopAt: 0,
    };
  }

  function createProbe(mode) {
    const config = MODE_CONFIG[mode] || MODE_CONFIG[MODE_MANUAL];
    return {
      mode,
      enabled: false,
      recording: false,
      finalizing: false,
      starting: false,
      vadRecordEnabled: false,
      vadStopEnabled: false,
      ws: null,
      stream: null,
      audioContext: null,
      sourceNode: null,
      processorNode: null,
      startedAt: 0,
      bytesSent: 0,
      framesSent: 0,
      transcript: '',
      status: config.statusOff,
      events: [],
      actions: [],
      samples: [],
      lastLevel: 0,
      delayFrames: [],
      pendingFrames: [],
      preRoll: createPreRollState(),
      segmentId: 0,
      autoRearmPending: false,
      autoRearmSegmentId: 0,
      finalWaitDeadlineAt: 0,
      finalWaitTimeoutMs: 0,
      vad: createVadState(),
      silero: createSileroState(),
    };
  }

  function el(id) {
    return document.getElementById(id);
  }

  function api(url, options = {}) {
    const fn = typeof apiFetch === 'function' ? apiFetch : fetch;
    return fn(url, options);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function frontendAssetVersion() {
    return cleanText(window.BLUEPRINTS_FRONTEND_VERSION?.asset_version || '');
  }

  function cacheBustUrl(src) {
    const version = frontendAssetVersion();
    if (!version) return src;
    const separator = src.includes('?') ? '&' : '?';
    return `${src}${separator}v=${encodeURIComponent(version)}`;
  }

  function loadScriptOnce(key, src, readyCheck) {
    if (typeof readyCheck === 'function' && readyCheck()) return Promise.resolve();
    if (state.sileroScriptPromises[key]) return state.sileroScriptPromises[key];
    state.sileroScriptPromises[key] = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = cacheBustUrl(src);
      script.async = true;
      script.onload = () => {
        if (typeof readyCheck === 'function' && !readyCheck()) {
          reject(new Error(`Loaded ${src}, but expected browser global was not available`));
          return;
        }
        resolve();
      };
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    }).catch(error => {
      delete state.sileroScriptPromises[key];
      throw error;
    });
    return state.sileroScriptPromises[key];
  }

  async function loadSileroLibrary() {
    await loadScriptOnce('ort-wasm', SILERO_ORT_SCRIPT, () => !!window.ort?.InferenceSession);
    await loadScriptOnce('vad-web', SILERO_VAD_SCRIPT, () => !!window.vad?.MicVAD);
  }

  function text(value, fallback = '--') {
    const out = String(value ?? '').trim();
    return out || fallback;
  }

  function setText(node, value, fallback = '--') {
    if (node) node.textContent = text(value, fallback);
  }

  function cleanText(value) {
    return String(value ?? '').trim();
  }

  function cleanCommandText(value) {
    return cleanText(value).toLowerCase().replace(/[-\s]+/g, '_');
  }

  function voiceMode() {
    return window.BlueprintsVoiceMode || null;
  }

  function probe(mode) {
    return state.probes[mode] || state.probes[MODE_MANUAL];
  }

  function selectedVadDetector() {
    return state.sileroEnabled ? DETECTOR_SILERO : DETECTOR_ENERGY;
  }

  function detectorForMode(mode) {
    return mode === MODE_MANUAL ? 'bypassed' : selectedVadDetector();
  }

  function sileroAvailable() {
    return !!window.vad?.MicVAD && !!window.ort?.InferenceSession;
  }

  function modeConfig(mode) {
    return MODE_CONFIG[mode] || MODE_CONFIG[MODE_MANUAL];
  }

  function modeFromInput(value) {
    const clean = cleanCommandText(value || state.selectedMode || MODE_MANUAL);
    if (clean === 'rearm' || clean === 'vad_rearm') return MODE_REARM;
    if (clean === MODE_VAD) return MODE_VAD;
    return MODE_MANUAL;
  }

  function status(message) {
    setText(els.status, message, '');
  }

  function setProbeStatus(mode, message) {
    const target = probe(mode);
    target.status = message || '';
    if (mode === MODE_MANUAL) setText(els.testStatus, target.status, '');
    else if (mode === MODE_VAD) setText(els.vadTestStatus, target.status, '');
    else if (mode === MODE_REARM) setText(els.rearmTestStatus, target.status, '');
  }

  function formatDb(level) {
    const safe = Math.max(0.0001, Math.min(1, Number(level) || 0));
    return `${Math.max(-80, 20 * Math.log10(safe)).toFixed(1)} dB`;
  }

  function linearToDb(value) {
    const safe = Math.max(0.000001, Math.min(1, Number(value) || 0));
    return Math.max(-80, 20 * Math.log10(safe));
  }

  function clampNoiseThresholdDb(value) {
    const numeric = Number(value);
    const safe = Number.isFinite(numeric) ? numeric : NOISE_THRESHOLD_DEFAULT_DB;
    const stepped = Math.round(safe / NOISE_THRESHOLD_STEP_DB) * NOISE_THRESHOLD_STEP_DB;
    return Math.max(NOISE_THRESHOLD_MIN_DB, Math.min(NOISE_THRESHOLD_MAX_DB, stepped));
  }

  function noiseThresholdDb() {
    const fromControl = els.noiseThreshold ? Number(els.noiseThreshold.value) : state.noiseThresholdDb;
    state.noiseThresholdDb = clampNoiseThresholdDb(fromControl);
    return state.noiseThresholdDb;
  }

  function compactFrameIds(ids) {
    const clean = (Array.isArray(ids) ? ids : [])
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
    if (!clean.length) return '';
    const first = clean[0];
    const last = clean[clean.length - 1];
    const contiguous = clean.every((value, index) => index === 0 || value === clean[index - 1] + 1);
    if (clean.length === 1) return String(first);
    return contiguous ? `${first}-${last}` : clean.join(',');
  }

  function formatVadResetTimeout(ms) {
    const value = Math.max(0, Math.min(VAD_RESET_TIMEOUT_MAX_MS, Math.round(Number(ms || 0) / 50) * 50));
    return value > 0 ? `${value} ms` : 'Off';
  }

  function renderRangeLabels() {
    const level = Number(els.noiseLevel?.value || 6);
    const threshold = noiseThresholdDb();
    setText(els.noiseLevelLabel, `${level.toFixed(1)} dB`);
    setText(els.aggregationLabel, `${Number(els.aggregation?.value || 80)} ms`);
    setText(els.vadResetLabel, formatVadResetTimeout(els.vadReset?.value));
    if (els.noiseThreshold) els.noiseThreshold.value = String(threshold);
    setText(els.noiseThresholdLabel, `${threshold.toFixed(0)} dB`);
    refreshNoiseControlStates();
  }

  function voiceNoiseEnabled() {
    const vm = voiceMode();
    if (typeof vm?.sttNoiseReductionSettingEnabled === 'function') return vm.sttNoiseReductionSettingEnabled();
    if (typeof vm?.sttNoiseReductionEnabled === 'function') return !!vm.sttNoiseReductionEnabled();
    return false;
  }

  function voiceNoiseLevelDb() {
    const level = Number(voiceMode()?.sttNoiseReductionLevelDb?.());
    return Number.isFinite(level) ? Math.max(0, Math.min(12, level)) : 6;
  }

  function renderSharedControls() {
    const vm = voiceMode();
    if (els.noiseToggle) els.noiseToggle.checked = voiceNoiseEnabled();
    if (els.sileroToggle) els.sileroToggle.checked = !!state.sileroEnabled;
    if (els.autoPreRollToggle) els.autoPreRollToggle.checked = !!state.autoPreRollEnabled;
    if (els.noiseThreshold) els.noiseThreshold.value = String(noiseThresholdDb());
    if (els.noiseLevel) els.noiseLevel.value = String(voiceNoiseLevelDb());
    const aggregation = Number(vm?.sttAggregationTimeoutMs?.());
    if (Number.isFinite(aggregation) && els.aggregation) els.aggregation.value = String(aggregation);
    const vadReset = Number(vm?.vadResetTimeoutMs?.());
    if (Number.isFinite(vadReset) && els.vadReset) {
      els.vadReset.value = String(Math.max(0, Math.min(VAD_RESET_TIMEOUT_MAX_MS, Math.round(vadReset / 50) * 50)));
    }
    renderRangeLabels();
  }

  async function loadSharedControls() {
    renderSharedControls();
    const vm = voiceMode();
    try {
      const agg = await vm?.loadAggregationTimeout?.({ force: true });
      const value = Number(agg?.aggregation_timeout_ms || agg?.stt?.speech_aggregation_timeout_ms || vm?.sttAggregationTimeoutMs?.() || 80);
      if (Number.isFinite(value) && els.aggregation) els.aggregation.value = String(value);
    } catch (_) {}
    renderSharedControls();
  }

  function applyNoiseThresholdStatus(mode = currentMode()) {
    mode = modeFromInput(mode);
    const vad = probe(mode).vad;
    const thresholdDb = noiseThresholdDb();
    const estimateDb = Number(vad.noiseEstimateDb ?? vad.noiseFloorDb ?? -80);
    const available = mode !== MODE_MANUAL
      && vad.noiseEstimateState !== 'unavailable'
      && Number.isFinite(estimateDb);
    const exceeded = !!(available && estimateDb > thresholdDb);
    const color = exceeded ? 'red' : 'green';
    vad.noiseThresholdDb = thresholdDb;
    vad.noiseThresholdExceeded = exceeded;
    vad.noiseThresholdColor = color;
    return {
      noise_floor_db: available ? estimateDb : -80,
      noise_estimate_db: available ? estimateDb : -80,
      noise_estimate_state: available ? vad.noiseEstimateState : 'unavailable',
      noise_threshold_db: thresholdDb,
      noise_threshold_exceeded: exceeded,
      noise_threshold_color: color,
      noise_threshold_available: available,
    };
  }

  function autoPreRollStatus(mode = currentMode()) {
    const noise = applyNoiseThresholdStatus(mode);
    if (!state.autoPreRollEnabled) {
      return {
        auto_pre_roll_enabled: false,
        auto_pre_roll_active: false,
        auto_pre_roll_reason: 'disabled',
      };
    }
    if (!noise.noise_threshold_available) {
      return {
        auto_pre_roll_enabled: true,
        auto_pre_roll_active: false,
        auto_pre_roll_reason: 'noise_estimate_unavailable',
      };
    }
    if (!noise.noise_threshold_exceeded) {
      return {
        auto_pre_roll_enabled: true,
        auto_pre_roll_active: false,
        auto_pre_roll_reason: 'noise_threshold_green',
      };
    }
    return {
      auto_pre_roll_enabled: true,
      auto_pre_roll_active: true,
      auto_pre_roll_reason: 'noise_threshold_exceeded',
    };
  }

  function refreshNoiseControlStates(mode = currentMode()) {
    const noise = applyNoiseThresholdStatus(mode);
    const auto = autoPreRollStatus(mode);
    if (els.noiseThresholdWrap) els.noiseThresholdWrap.dataset.state = noise.noise_threshold_color;
    if (els.autoPreRollWrap) {
      els.autoPreRollWrap.classList.toggle('is-active', !!auto.auto_pre_roll_active);
    }
  }

  function firstServerId() {
    const settings = voiceMode()?.getWakeSettings?.();
    return settings?.instances?.local?.matrix_server || 'tb1';
  }

  async function probeWebsocketUrl() {
    const url = new URL(STT_WS_URL, window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('server', firstServerId());
    if (voiceNoiseEnabled()) {
      url.searchParams.set('noise_reduction', '1');
      url.searchParams.set('atten_lim_db', String(voiceNoiseLevelDb()));
    } else {
      url.searchParams.set('noise_reduction', '0');
    }
    const secret = localStorage.getItem(typeof _LS_SECRET_KEY === 'string' ? _LS_SECRET_KEY : 'blueprints_api_secret') || '';
    const token = typeof _computeApiToken === 'function'
      ? await _computeApiToken(secret, `${url.pathname}${url.search}`)
      : '';
    if (token) url.searchParams.set('token', token);
    return url.toString();
  }

  function downsampleFloat32(input, inputRate, outputRate = SAMPLE_RATE) {
    if (!input?.length) return null;
    if (!Number.isFinite(inputRate) || inputRate <= 0 || inputRate === outputRate) {
      return new Float32Array(input);
    }
    const ratio = inputRate / outputRate;
    const outputLength = Math.max(1, Math.floor(input.length / ratio));
    const output = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i += 1) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      let count = 0;
      for (let j = start; j < end; j += 1) {
        sum += input[j];
        count += 1;
      }
      output[i] = count ? sum / count : input[Math.min(start, input.length - 1)] || 0;
    }
    return output;
  }

  function audioFeatures(input) {
    if (!input?.length) return { rms: 0, peak: 0, level: 0, vadEnergy: 0 };
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < input.length; i += 1) {
      const value = Math.abs(input[i] || 0);
      sum += value * value;
      if (value > peak) peak = value;
    }
    const rms = Math.sqrt(sum / input.length);
    const level = Math.min(1, Math.max(0, (rms * 16) + (peak * 0.16)));
    return { rms, peak, level, vadEnergy: rms + (peak * 0.15) };
  }

  function waitForSocketOpen(socket) {
    return new Promise((resolve, reject) => {
      if (socket.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('STT connection timed out'));
      }, 6000);
      const cleanup = () => {
        window.clearTimeout(timer);
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('error', onError);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('STT connection failed'));
      };
      socket.addEventListener('open', onOpen);
      socket.addEventListener('error', onError);
    });
  }

  function pushAction(mode, type, detail = {}) {
    const target = probe(mode);
    target.actions.push({
      at_ms: Date.now(),
      type,
      ...(mode === MODE_REARM ? { segment_id: Number(target.segmentId || 0) } : {}),
      ...detail,
    });
    target.actions = target.actions.slice(mode === MODE_REARM ? -160 : -120);
  }

  function pushEvent(mode, type, textValue, detail = {}) {
    const target = probe(mode);
    const clean = cleanSttTranscript(textValue);
    target.events.push({
      at_ms: Date.now(),
      type,
      text: clean,
      text_length: clean.length,
      ...(mode === MODE_REARM ? { segment_id: Number(target.segmentId || 0) } : {}),
      audio_frames_sent: target.framesSent,
      ...detail,
    });
    target.events = target.events.slice(-160);
  }

  function cleanSttTranscript(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function sttPayloadDisplayText(payload) {
    if (!payload || typeof payload !== 'object') return '';
    const direct = payload.transcript
      ?? payload.full_text
      ?? payload.display_text
      ?? payload.result_text
      ?? payload.text
      ?? payload.partial
      ?? payload.final;
    if (direct != null) return cleanSttTranscript(direct);
    const result = payload.result && typeof payload.result === 'object' ? payload.result : null;
    if (result?.transcript != null) return cleanSttTranscript(result.transcript);
    if (result?.text != null) return cleanSttTranscript(result.text);
    const alternatives = Array.isArray(payload.alternatives) ? payload.alternatives : [];
    if (alternatives[0]?.transcript != null) return cleanSttTranscript(alternatives[0].transcript);
    if (alternatives[0]?.text != null) return cleanSttTranscript(alternatives[0].text);
    return '';
  }

  function closeSocket(mode) {
    const target = probe(mode);
    if (target.ws) {
      try { target.ws.close(); } catch (_) {}
      target.ws = null;
    }
  }

  function cleanupAudio(mode) {
    const target = probe(mode);
    if (target.processorNode) {
      try { target.processorNode.disconnect(); } catch (_) {}
      target.processorNode.onaudioprocess = null;
      target.processorNode = null;
    }
    if (target.sourceNode) {
      try { target.sourceNode.disconnect(); } catch (_) {}
      target.sourceNode = null;
    }
    if (target.audioContext) {
      try { void target.audioContext.close(); } catch (_) {}
      target.audioContext = null;
    }
    if (target.stream) {
      target.stream.getTracks().forEach(track => track.stop());
      target.stream = null;
    }
  }

  function resetSileroMetrics(mode, options = {}) {
    const silero = probe(mode).silero;
    silero.frameCount = 0;
    silero.lastFrameAt = 0;
    silero.lastSpeechStartAt = 0;
    silero.lastSpeechRealStartAt = 0;
    silero.lastSpeechEndAt = 0;
    silero.misfires = 0;
    silero.listening = !!silero.instance?.listening;
    if (options.clearProbabilities) {
      silero.isSpeechProbability = null;
      silero.notSpeechProbability = null;
    }
    if (options.clearError) silero.error = '';
  }

  function disposeSilero(mode, reason = 'dispose') {
    const target = probe(mode);
    const silero = target.silero;
    const instance = silero.instance;
    silero.instance = null;
    silero.loading = false;
    silero.ready = false;
    silero.listening = false;
    if (reason !== 'preserve_error') silero.error = '';
    resetSileroMetrics(mode, { clearProbabilities: true });
    if (!instance) return;
    Promise.resolve()
      .then(() => {
        if (typeof instance.destroy === 'function') return instance.destroy();
        if (typeof instance.pause === 'function') return instance.pause();
        return null;
      })
      .catch(error => {
        silero.error = error.message || String(error);
      });
  }

  function sileroStatusValue(mode) {
    const silero = probe(mode).silero;
    if (!state.sileroEnabled) return 'off';
    if (silero.error) return 'error';
    if (silero.loading) return 'loading';
    if (silero.ready) return 'ready';
    return sileroAvailable() ? 'loaded' : 'idle';
  }

  function resetVad(mode, now = Date.now(), options = {}) {
    const vad = probe(mode).vad;
    vad.speaking = false;
    vad.candidateActive = false;
    vad.candidateConfirmed = false;
    vad.candidateStartedAt = 0;
    vad.candidateFrames = 0;
    vad.quietFrames = 0;
    vad.speechSeenSinceReset = false;
    vad.lastVoiceAt = 0;
    vad.lastResetAt = now;
    vad.lastEnergy = 0;
    vad.lastEnergyDb = -80;
    vad.energyDeltaDb = 0;
    vad.baselinePaused = false;
    if (options.resetNoiseFloor) {
      vad.noiseFloor = 0;
      vad.noiseFloorDb = -80;
      vad.noiseEstimate = 0;
      vad.noiseEstimateDb = -80;
      vad.noiseEstimateState = 'unavailable';
      vad.noiseThresholdDb = noiseThresholdDb();
      vad.noiseThresholdExceeded = false;
      vad.noiseThresholdColor = 'green';
      vad.noiseHoldUntil = 0;
      vad.lastNoiseEstimateAt = 0;
      vad.enterThreshold = 0;
      vad.exitThreshold = 0;
      vad.strongEnterThreshold = 0;
    }
    if (options.resetSilero) resetSileroMetrics(mode, { clearProbabilities: true, clearError: !!options.clearSileroError });
  }

  function markSileroCandidate(mode, now = Date.now(), detail = {}) {
    const target = probe(mode);
    const vad = target.vad;
    if (!vad.candidateActive) {
      vad.candidateActive = true;
      vad.candidateConfirmed = false;
      vad.candidateStartedAt = now;
      vad.candidateFrames = 0;
      vad.quietFrames = 0;
      pushAction(mode, 'sileroCandidateStart', {
        detector: DETECTOR_SILERO,
        audio_frame: target.preRoll?.lastCapturedFrameId || null,
        ...detail,
      });
    }
    vad.candidateFrames += 1;
    vad.quietFrames = 0;
  }

  function confirmSileroSpeech(mode, reason = 'speech_real_start', now = Date.now()) {
    const target = probe(mode);
    const vad = target.vad;
    const speechStarted = !vad.speaking;
    vad.candidateActive = true;
    vad.candidateConfirmed = true;
    vad.speaking = true;
    vad.speechSeenSinceReset = true;
    vad.lastVoiceAt = now;
    if (!vad.candidateStartedAt) vad.candidateStartedAt = now;
    if (speechStarted) {
      pushAction(mode, 'sileroSpeechConfirmed', {
        detector: DETECTOR_SILERO,
        reason,
        positive_threshold: SILERO_POSITIVE_THRESHOLD,
        negative_threshold: SILERO_NEGATIVE_THRESHOLD,
        speech_probability: probe(mode).silero.isSpeechProbability,
      });
    }
    if (speechStarted && target.vadRecordEnabled && !target.recording && !target.finalizing && !target.starting) {
      setProbeStatus(mode, 'Silero VAD Record triggered; opening STT.');
      void startRecording(mode, {
        reason: 'silero_vad_record',
        vad_detection_frame_id: target.preRoll?.lastCapturedFrameId || null,
      });
    }
  }

  function updateSileroStop(mode, now = Date.now()) {
    const target = probe(mode);
    const vad = target.vad;
    const timeoutMs = vadResetTimeoutMs();
    if (
      target.vadStopEnabled
      && target.recording
      && timeoutMs > 0
      && vad.speechSeenSinceReset
      && !vad.speaking
      && vad.lastVoiceAt
      && now - vad.lastVoiceAt >= timeoutMs
      && now - vad.lastResetAt > 250
    ) {
      vad.lastAutoStopAt = now;
      stopRecording(mode, 'silero_vad_stop');
    }
  }

  function onSileroFrame(mode, probabilities) {
    const target = probe(mode);
    if (!state.sileroEnabled || !target.enabled) return;
    const silero = target.silero;
    const vad = target.vad;
    const now = Date.now();
    const isSpeech = Number(probabilities?.isSpeech);
    const notSpeech = Number(probabilities?.notSpeech);
    silero.frameCount += 1;
    silero.lastFrameAt = now;
    silero.isSpeechProbability = Number.isFinite(isSpeech) ? Math.max(0, Math.min(1, isSpeech)) : null;
    silero.notSpeechProbability = Number.isFinite(notSpeech) ? Math.max(0, Math.min(1, notSpeech)) : null;
    vad.lastEnergy = 0;
    vad.lastEnergyDb = -80;
    vad.energyDeltaDb = 0;
    vad.enterThreshold = SILERO_POSITIVE_THRESHOLD;
    vad.exitThreshold = SILERO_NEGATIVE_THRESHOLD;
    vad.strongEnterThreshold = SILERO_POSITIVE_THRESHOLD;
    vad.enterDeltaDb = SILERO_POSITIVE_THRESHOLD;
    vad.exitDeltaDb = SILERO_NEGATIVE_THRESHOLD;
    vad.strongDeltaDb = SILERO_POSITIVE_THRESHOLD;
    vad.baselinePaused = !!(vad.candidateActive || vad.speaking || target.recording || target.finalizing || target.starting);
    if (silero.isSpeechProbability != null && silero.isSpeechProbability >= SILERO_POSITIVE_THRESHOLD) {
      markSileroCandidate(mode, now, {
        speech_probability: Number(silero.isSpeechProbability.toFixed(3)),
        not_speech_probability: silero.notSpeechProbability == null ? null : Number(silero.notSpeechProbability.toFixed(3)),
      });
      if (vad.speaking) vad.lastVoiceAt = now;
    }
    updateSileroStop(mode, now);
  }

  function onSileroSpeechStart(mode) {
    if (!state.sileroEnabled || !probe(mode).enabled) return;
    const now = Date.now();
    const silero = probe(mode).silero;
    silero.lastSpeechStartAt = now;
    markSileroCandidate(mode, now, {
      reason: 'speech_start',
      speech_probability: silero.isSpeechProbability,
    });
  }

  function onSileroSpeechRealStart(mode) {
    if (!state.sileroEnabled || !probe(mode).enabled) return;
    const silero = probe(mode).silero;
    const now = Date.now();
    silero.lastSpeechRealStartAt = now;
    confirmSileroSpeech(mode, 'speech_real_start', now);
  }

  function onSileroSpeechEnd(mode, audio) {
    const target = probe(mode);
    if (!state.sileroEnabled || !target.enabled) return;
    const vad = target.vad;
    const silero = target.silero;
    const now = Date.now();
    silero.lastSpeechEndAt = now;
    vad.speaking = false;
    vad.candidateActive = false;
    vad.candidateConfirmed = false;
    vad.quietFrames = 0;
    vad.lastVoiceAt = now;
    pushAction(mode, 'sileroSpeechEnd', {
      detector: DETECTOR_SILERO,
      audio_samples: Number(audio?.length || 0),
      timeout_ms: vadResetTimeoutMs(),
    });
    updateSileroStop(mode, now);
  }

  function onSileroMisfire(mode) {
    const target = probe(mode);
    if (!state.sileroEnabled || !target.enabled) return;
    const vad = target.vad;
    const silero = target.silero;
    silero.misfires += 1;
    vad.speaking = false;
    vad.candidateActive = false;
    vad.candidateConfirmed = false;
    vad.quietFrames = 0;
    pushAction(mode, 'sileroMisfire', {
      detector: DETECTOR_SILERO,
      speech_probability: silero.isSpeechProbability,
      misfires: silero.misfires,
    });
  }

  async function ensureSileroForMode(mode, reason = 'ensure') {
    mode = modeFromInput(mode);
    if (mode === MODE_MANUAL || !state.sileroEnabled) return false;
    const target = probe(mode);
    const silero = target.silero;
    if (!target.enabled || !target.stream || !target.audioContext) return false;
    if (silero.instance && silero.ready) {
      if (!silero.instance.listening) {
        await silero.instance.start();
        silero.listening = !!silero.instance.listening;
      }
      return true;
    }
    if (silero.loading) return false;
    silero.loading = true;
    silero.ready = false;
    silero.error = '';
    resetVad(mode, Date.now(), { resetSilero: true });
    pushAction(mode, 'sileroLoad', { detector: DETECTOR_SILERO, model: SILERO_MODEL, reason });
    setProbeStatus(mode, 'Silero VAD loading.');
    renderProbeUi(mode);
    poll({ force: true });
    let micVad = null;
    try {
      await loadSileroLibrary();
      if (!state.sileroEnabled || !target.enabled || !target.stream || !target.audioContext) {
        silero.loading = false;
        return false;
      }
      micVad = await window.vad.MicVAD.new({
        model: SILERO_MODEL,
        baseAssetPath: SILERO_VAD_ASSET_BASE,
        onnxWASMBasePath: SILERO_ONNX_WASM_BASE,
        positiveSpeechThreshold: SILERO_POSITIVE_THRESHOLD,
        negativeSpeechThreshold: SILERO_NEGATIVE_THRESHOLD,
        redemptionMs: SILERO_REDEMPTION_MS,
        minSpeechMs: SILERO_MIN_SPEECH_MS,
        preSpeechPadMs: SILERO_PRE_SPEECH_PAD_MS,
        submitUserSpeechOnPause: false,
        startOnLoad: false,
        processorType: 'auto',
        audioContext: target.audioContext,
        getStream: async () => target.stream,
        pauseStream: async stream => stream,
        resumeStream: async () => target.stream,
        onFrameProcessed: probabilities => onSileroFrame(mode, probabilities),
        onSpeechStart: () => onSileroSpeechStart(mode),
        onSpeechRealStart: () => onSileroSpeechRealStart(mode),
        onSpeechEnd: audio => onSileroSpeechEnd(mode, audio),
        onVADMisfire: () => onSileroMisfire(mode),
      });
      await micVad.start();
      silero.instance = micVad;
      silero.loading = false;
      silero.ready = true;
      silero.listening = !!micVad.listening;
      silero.error = '';
      pushAction(mode, 'sileroReady', {
        detector: DETECTOR_SILERO,
        model: SILERO_MODEL,
        processor: 'auto',
      });
      setProbeStatus(mode, 'Silero VAD ready. Speak to test the model detector.');
      renderProbeUi(mode);
      poll({ force: true });
      return true;
    } catch (error) {
      if (micVad && !silero.instance) {
        Promise.resolve()
          .then(() => (typeof micVad.destroy === 'function' ? micVad.destroy() : micVad.pause?.()))
          .catch(() => {});
      }
      disposeSilero(mode, 'preserve_error');
      silero.loading = false;
      silero.ready = false;
      silero.listening = false;
      silero.error = error.message || String(error);
      pushAction(mode, 'sileroError', {
        detector: DETECTOR_SILERO,
        error: silero.error,
      });
      setProbeStatus(mode, `Silero VAD failed: ${silero.error}`);
      renderProbeUi(mode);
      poll({ force: true });
      return false;
    }
  }

  function vadResetTimeoutMs() {
    const fromControl = Number(els.vadReset?.value || 0);
    return Number.isFinite(fromControl) ? Math.max(0, fromControl) : 0;
  }

  function rearmFinalTimeoutMs() {
    return vadResetTimeoutMs();
  }

  function clearRearmAutoState() {
    const target = probe(MODE_REARM);
    target.autoRearmPending = false;
    target.autoRearmSegmentId = 0;
    target.finalWaitDeadlineAt = 0;
    target.finalWaitTimeoutMs = 0;
  }

  function addSample(mode, features, frame = null) {
    const target = probe(mode);
    const level = Math.max(0, Math.min(1, Number(features.level) || 0));
    target.lastLevel = level;
    const now = Date.now();
    target.samples.push({
      at: now,
      frame_id: frame?.frame_id || null,
      level,
      rms: Math.max(0, Number(features.rms) || 0),
      peak: Math.max(0, Number(features.peak) || 0),
      vad_energy: mode === MODE_MANUAL ? 0 : Math.max(0, Number(features.vadEnergy) || 0),
      fsm_state: probeFsm(mode),
    });
    target.samples = target.samples.filter(sample => sample.at >= now - WINDOW_MS - 1000);
  }

  function resetPreRollSegment(mode, options = {}) {
    const preRoll = probe(mode).preRoll || createPreRollState();
    probe(mode).preRoll = preRoll;
    preRoll.lastSentFrameId = 0;
    if (options.clearProof) {
      preRoll.vadDetectionFrameId = null;
      preRoll.startFrameId = null;
      preRoll.selectedFrameIds = [];
      preRoll.selectedFrameRange = '';
      preRoll.selectedFrames = 0;
      preRoll.audioMs = 0;
      preRoll.fallbackReason = 'not_requested';
      preRoll.sentFrameIds = [];
      preRoll.sentFrameRange = '';
      preRoll.active = false;
      preRoll.applied = false;
      preRoll.reason = 'disabled';
    }
  }

  function resetPreRollBuffer(mode) {
    const target = probe(mode);
    target.preRoll = createPreRollState();
    target.delayFrames = [];
    target.pendingFrames = [];
  }

  function trimPreRollBuffer(preRoll) {
    preRoll.bufferMs = preRoll.buffer.reduce((sum, frame) => sum + (Number(frame.duration_ms) || 0), 0);
    while (
      preRoll.buffer.length > AUTO_PRE_ROLL_BUFFER_MAX_FRAMES
      || (preRoll.buffer.length > 1 && preRoll.bufferMs > AUTO_PRE_ROLL_BUFFER_MS)
    ) {
      const removed = preRoll.buffer.shift();
      preRoll.bufferMs -= Number(removed?.duration_ms || 0);
    }
    preRoll.bufferMs = Math.max(0, preRoll.bufferMs);
  }

  function captureAudioFrame(mode, input, audioContext, features, now = Date.now()) {
    const target = probe(mode);
    const pcm = downsampleFloat32(input, audioContext.sampleRate);
    if (!pcm?.byteLength) return null;
    const preRoll = target.preRoll || createPreRollState();
    target.preRoll = preRoll;
    preRoll.frameId += 1;
    preRoll.lastCapturedFrameId = preRoll.frameId;
    const frame = {
      frame_id: preRoll.frameId,
      at_ms: now,
      duration_ms: input?.length && audioContext.sampleRate
        ? (input.length / audioContext.sampleRate) * 1000
        : 0,
      byte_length: pcm.byteLength,
      rms: Math.max(0, Number(features?.rms) || 0),
      peak: Math.max(0, Number(features?.peak) || 0),
      vad_energy: Math.max(0, Number(features?.vadEnergy) || 0),
      energy_db: linearToDb(features?.vadEnergy || 0),
      pcm,
    };
    preRoll.buffer.push(frame);
    trimPreRollBuffer(preRoll);
    return frame;
  }

  function updateNoiseEstimate(mode, features, now = Date.now()) {
    if (mode === MODE_MANUAL) return;
    const target = probe(mode);
    const vad = target.vad;
    const energy = Math.max(0, Number(features?.vadEnergy) || 0);
    const currentEstimate = Math.max(VAD_TEST_NOISE_MIN, Math.min(VAD_TEST_NOISE_MAX, Number(vad.noiseEstimate || vad.noiseFloor || 0)));
    const hasEstimate = !!(vad.noiseEstimate || vad.noiseFloor);
    let estimate = hasEstimate
      ? currentEstimate
      : Math.max(VAD_TEST_NOISE_MIN, Math.min(VAD_TEST_NOISE_MAX, energy || 0.002));
    const detectorBusy = !!(
      vad.candidateActive
      || vad.speaking
      || target.recording
      || target.finalizing
      || target.starting
      || (vad.lastVoiceAt && now - vad.lastVoiceAt < VAD_TEST_BASELINE_HOLDOFF_MS)
      || (vad.noiseHoldUntil && now < vad.noiseHoldUntil)
    );
    const canMeasure = !!target.enabled && !detectorBusy;
    if (canMeasure) {
      const limitedEnergy = energy > estimate
        ? Math.min(energy, estimate * VAD_TEST_NOISE_UP_CAP_RATIO)
        : energy;
      const alpha = limitedEnergy < estimate ? VAD_TEST_NOISE_DOWN_ALPHA : VAD_TEST_NOISE_UP_ALPHA;
      estimate = Math.max(
        VAD_TEST_NOISE_MIN,
        Math.min(VAD_TEST_NOISE_MAX, (estimate * alpha) + (limitedEnergy * (1 - alpha))),
      );
      vad.noiseEstimateState = 'idle_measuring';
      vad.lastNoiseEstimateAt = now;
    } else {
      vad.noiseEstimateState = hasEstimate ? 'frozen_during_speech' : 'unavailable';
    }
    vad.noiseEstimate = estimate;
    vad.noiseEstimateDb = linearToDb(estimate);
    vad.noiseFloor = estimate;
    vad.noiseFloorDb = vad.noiseEstimateDb;
    vad.baselinePaused = !canMeasure;
    applyNoiseThresholdStatus(mode);
  }

  function updateVad(mode, features, now = Date.now(), frame = null) {
    if (mode === MODE_MANUAL) return;
    const target = probe(mode);
    const vad = target.vad;
    const energy = Number(features?.vadEnergy || 0);
    if (!vad.noiseFloor) {
      vad.noiseFloor = Math.max(VAD_TEST_NOISE_MIN, Math.min(VAD_TEST_NOISE_MAX, energy || 0.002));
    }
    const noiseFloor = Math.max(VAD_TEST_NOISE_MIN, Math.min(VAD_TEST_NOISE_MAX, vad.noiseFloor));
    const energyDb = linearToDb(energy);
    const noiseFloorDb = linearToDb(noiseFloor);
    const deltaDb = Math.max(-30, Math.min(60, energyDb - noiseFloorDb));
    const enterThreshold = Math.max(VAD_TEST_ABSOLUTE_FLOOR, noiseFloor * Math.pow(10, VAD_TEST_ENTER_DELTA_DB / 20));
    const exitThreshold = Math.max(VAD_TEST_ABSOLUTE_FLOOR * 0.65, noiseFloor * Math.pow(10, VAD_TEST_EXIT_DELTA_DB / 20));
    const strongEnterThreshold = Math.max(VAD_TEST_ABSOLUTE_FLOOR, noiseFloor * Math.pow(10, VAD_TEST_STRONG_DELTA_DB / 20));
    const aboveAbsoluteFloor = energy >= VAD_TEST_ABSOLUTE_FLOOR;
    const candidateFrame = aboveAbsoluteFloor && deltaDb >= VAD_TEST_ENTER_DELTA_DB;
    const sustainingFrame = energy >= (VAD_TEST_ABSOLUTE_FLOOR * 0.65) && deltaDb >= VAD_TEST_EXIT_DELTA_DB;
    const strongFrame = aboveAbsoluteFloor && deltaDb >= VAD_TEST_STRONG_DELTA_DB;
    vad.lastEnergy = energy;
    vad.lastEnergyDb = energyDb;
    vad.energyDeltaDb = deltaDb;
    vad.noiseFloorDb = noiseFloorDb;
    vad.enterThreshold = enterThreshold;
    vad.exitThreshold = exitThreshold;
    vad.strongEnterThreshold = strongEnterThreshold;
    vad.enterDeltaDb = VAD_TEST_ENTER_DELTA_DB;
    vad.exitDeltaDb = VAD_TEST_EXIT_DELTA_DB;
    vad.strongDeltaDb = VAD_TEST_STRONG_DELTA_DB;

    if (candidateFrame) {
      if (!vad.candidateActive) {
        vad.candidateActive = true;
        vad.candidateConfirmed = false;
        vad.candidateStartedAt = now;
        vad.candidateFrames = 0;
        vad.quietFrames = 0;
        pushAction(mode, 'vadCandidateStart', {
          audio_frame: frame?.frame_id || target.preRoll?.lastCapturedFrameId || null,
          delay_frames: VAD_TEST_DELAY_FRAMES,
          delta_db: Number(deltaDb.toFixed(1)),
          noise_floor_db: Number(noiseFloorDb.toFixed(1)),
        });
      }
      vad.candidateFrames += 1;
      vad.quietFrames = 0;
    } else if (vad.candidateActive && sustainingFrame) {
      vad.quietFrames = 0;
    } else if (vad.candidateActive) {
      vad.quietFrames += 1;
      if (!vad.speaking && vad.quietFrames >= VAD_TEST_RELEASE_FRAMES) {
        vad.candidateActive = false;
        vad.candidateConfirmed = false;
        vad.candidateStartedAt = 0;
        vad.candidateFrames = 0;
      }
    }

    const candidateAgeMs = vad.candidateStartedAt ? Math.max(0, now - vad.candidateStartedAt) : 0;
    const candidatePersisted = vad.candidateFrames >= VAD_TEST_CONFIRM_FRAMES || candidateAgeMs >= VAD_TEST_CONFIRM_MIN_MS;
    const metricFloor = Math.max(VAD_TEST_NOISE_MIN, Math.min(VAD_TEST_NOISE_MAX, vad.noiseFloor));
    vad.noiseFloorDb = linearToDb(metricFloor);
    vad.enterThreshold = Math.max(VAD_TEST_ABSOLUTE_FLOOR, metricFloor * Math.pow(10, VAD_TEST_ENTER_DELTA_DB / 20));
    vad.exitThreshold = Math.max(VAD_TEST_ABSOLUTE_FLOOR * 0.65, metricFloor * Math.pow(10, VAD_TEST_EXIT_DELTA_DB / 20));
    vad.strongEnterThreshold = Math.max(VAD_TEST_ABSOLUTE_FLOOR, metricFloor * Math.pow(10, VAD_TEST_STRONG_DELTA_DB / 20));

    if (vad.candidateActive && !vad.candidateConfirmed && candidatePersisted && (strongFrame || vad.candidateFrames >= VAD_TEST_CONFIRM_FRAMES)) {
      const speechStarted = !vad.speaking;
      vad.candidateConfirmed = true;
      vad.speaking = true;
      vad.speechSeenSinceReset = true;
      vad.lastVoiceAt = now;
      pushAction(mode, 'vadCandidateConfirmed', {
        start_threshold: strongFrame ? 'delta_strong_confirmed' : 'delta_persistent_confirmed',
        enter_delta_db: VAD_TEST_ENTER_DELTA_DB,
        strong_delta_db: VAD_TEST_STRONG_DELTA_DB,
        candidate_age_ms: candidateAgeMs,
        candidate_frames: vad.candidateFrames,
        delta_db: Number(deltaDb.toFixed(1)),
      });
      if (speechStarted && target.vadRecordEnabled && !target.recording && !target.finalizing && !target.starting) {
        setProbeStatus(mode, 'VAD Record triggered; opening STT.');
        void startRecording(mode, {
          reason: 'vad_record',
          vad_detection_frame_id: frame?.frame_id || target.preRoll?.lastCapturedFrameId || null,
        });
      }
    } else if (vad.speaking && sustainingFrame) {
      vad.lastVoiceAt = now;
    } else if (vad.speaking && now - vad.lastVoiceAt > VAD_TEST_EXIT_HANGOVER_MS) {
      vad.speaking = false;
    }

    const timeoutMs = vadResetTimeoutMs();
    if (
      target.vadStopEnabled
      && target.recording
      && timeoutMs > 0
      && vad.speechSeenSinceReset
      && !vad.speaking
      && vad.lastVoiceAt
      && now - vad.lastVoiceAt >= timeoutMs
      && now - vad.lastResetAt > 250
    ) {
      vad.lastAutoStopAt = now;
      stopRecording(mode, 'vad_stop');
    }
  }

  function preRollReadiness(mode, detectionFrameId = null) {
    mode = modeFromInput(mode);
    const target = probe(mode);
    const auto = autoPreRollStatus(mode);
    if (!auto.auto_pre_roll_active) return { ...auto, apply: false, reason: auto.auto_pre_roll_reason };
    if (mode === MODE_MANUAL) return { ...auto, apply: false, reason: 'manual_mode' };
    if (!target.enabled) return { ...auto, apply: false, reason: 'test_mode_off' };
    if (!target.vadRecordEnabled) return { ...auto, apply: false, reason: 'vad_record_not_armed' };
    if (!Number(detectionFrameId || 0)) return { ...auto, apply: false, reason: 'no_detection_frame' };
    if (!target.preRoll?.buffer?.length) return { ...auto, apply: false, reason: 'no_pre_roll_frames' };
    return { ...auto, apply: true, reason: 'noise_threshold_exceeded' };
  }

  function preparePreRollForRecording(mode, options = {}) {
    mode = modeFromInput(mode);
    const target = probe(mode);
    const preRoll = target.preRoll || createPreRollState();
    target.preRoll = preRoll;
    resetPreRollSegment(mode, { clearProof: true });
    if (mode === MODE_MANUAL) return;
    const detectionFrameId = Number(options.vad_detection_frame_id || preRoll.lastCapturedFrameId || 0);
    preRoll.vadDetectionFrameId = detectionFrameId || null;
    const readiness = preRollReadiness(mode, detectionFrameId);
    preRoll.active = !!readiness.auto_pre_roll_active;
    preRoll.reason = readiness.reason;
    if (!readiness.apply) {
      preRoll.fallbackReason = readiness.reason;
      return;
    }
    const buffer = preRoll.buffer;
    const oldest = Number(buffer[0]?.frame_id || 0);
    const latest = Number(buffer[buffer.length - 1]?.frame_id || 0);
    let startFrameId = detectionFrameId - AUTO_PRE_ROLL_LOOKBACK_FRAMES;
    let fallbackReason = '';
    if (!oldest || !latest) {
      preRoll.reason = 'no_pre_roll_frames';
      preRoll.fallbackReason = 'no_pre_roll_frames';
      return;
    }
    if (startFrameId < 1) {
      startFrameId = detectionFrameId;
      fallbackReason = 'previous_frame_unavailable';
    } else if (startFrameId < oldest) {
      startFrameId = oldest;
      fallbackReason = detectionFrameId <= oldest ? 'previous_frame_unavailable' : 'previous_frame_rolled_out';
    }
    if (startFrameId > latest) {
      startFrameId = latest;
      fallbackReason = 'detection_frame_not_in_buffer';
    }
    preRoll.startFrameId = startFrameId;
    preRoll.fallbackReason = fallbackReason;
    preRoll.applied = true;
    pushAction(mode, 'autoPreRollSelect', {
      applied: true,
      reason: preRoll.reason,
      lookback_frames: AUTO_PRE_ROLL_LOOKBACK_FRAMES,
      vad_detection_frame_id: detectionFrameId,
      pre_roll_start_frame_id: startFrameId,
      fallback_reason: fallbackReason,
      buffer_frames: buffer.length,
    });
  }

  function collectPreRollFramesForRecording(mode) {
    const target = probe(mode);
    const preRoll = target.preRoll || createPreRollState();
    target.preRoll = preRoll;
    if (!preRoll.applied || !preRoll.startFrameId) return [];
    const frames = preRoll.buffer
      .filter(frame => Number(frame.frame_id) >= Number(preRoll.startFrameId))
      .sort((a, b) => Number(a.frame_id) - Number(b.frame_id));
    if (!frames.length) {
      preRoll.fallbackReason = preRoll.fallbackReason || 'selected_frames_unavailable';
      preRoll.applied = false;
      return [];
    }
    preRoll.selectedFrameIds = frames.map(frame => Number(frame.frame_id));
    preRoll.selectedFrameRange = compactFrameIds(preRoll.selectedFrameIds);
    preRoll.selectedFrames = frames.length;
    preRoll.audioMs = frames.reduce((sum, frame) => sum + (Number(frame.duration_ms) || 0), 0);
    return frames;
  }

  function preRollSnapshot(mode) {
    const preRoll = probe(mode).preRoll || createPreRollState();
    const auto = autoPreRollStatus(mode);
    return {
      auto_pre_roll_enabled: auto.auto_pre_roll_enabled,
      auto_pre_roll_active: auto.auto_pre_roll_active,
      auto_pre_roll_reason: auto.auto_pre_roll_reason,
      pre_roll_lookback_frames: AUTO_PRE_ROLL_LOOKBACK_FRAMES,
      pre_roll_buffer_frames: preRoll.buffer.length,
      pre_roll_buffer_ms: Math.round(preRoll.bufferMs || 0),
      pre_roll_selected_frames: preRoll.selectedFrames || 0,
      pre_roll_audio_ms: Math.round(preRoll.audioMs || 0),
      pre_roll_start_frame_id: preRoll.startFrameId,
      vad_detection_frame_id: preRoll.vadDetectionFrameId,
      pre_roll_fallback_reason: preRoll.fallbackReason || '',
      pre_roll_sent_frame_ids: preRoll.sentFrameRange || compactFrameIds(preRoll.sentFrameIds),
      pre_roll_sent_frame_range: preRoll.sentFrameRange || compactFrameIds(preRoll.sentFrameIds),
      pre_roll_selected_frame_ids: preRoll.selectedFrameRange || compactFrameIds(preRoll.selectedFrameIds),
      pre_roll_selected_frame_range: preRoll.selectedFrameRange || compactFrameIds(preRoll.selectedFrameIds),
      pre_roll_applied: !!preRoll.applied,
    };
  }

  function sendPcm(mode, pcm, source = 'stream', metadata = {}) {
    const target = probe(mode);
    if (!pcm?.byteLength || target.ws?.readyState !== WebSocket.OPEN) return false;
    try {
      target.ws.send(pcm.buffer);
      target.bytesSent += pcm.byteLength;
      target.framesSent += 1;
      const capturedFrameId = Number(metadata.frameId || 0);
      if (mode !== MODE_MANUAL && capturedFrameId) {
        const preRoll = target.preRoll || createPreRollState();
        target.preRoll = preRoll;
        preRoll.lastSentFrameId = Math.max(Number(preRoll.lastSentFrameId || 0), capturedFrameId);
        preRoll.sentFrameIds.push(capturedFrameId);
        preRoll.sentFrameIds = preRoll.sentFrameIds.slice(-80);
        preRoll.sentFrameRange = compactFrameIds(preRoll.sentFrameIds);
      }
      if (source !== 'stream') {
        pushAction(mode, mode === MODE_REARM ? 'rearmProbeFrame' : 'vadProbeFrame', {
          source,
          audio_frame: target.framesSent,
          captured_frame_id: capturedFrameId || null,
        });
      }
      return true;
    } catch (error) {
      pushAction(mode, mode === MODE_REARM ? 'rearmProbeError' : 'vadProbeError', { error: error.message || String(error) });
      return false;
    }
  }

  function sendAudioFrame(mode, frame, source = 'stream') {
    if (!frame?.pcm?.byteLength) return false;
    const preRoll = probe(mode).preRoll || createPreRollState();
    if (mode !== MODE_MANUAL && source === 'stream' && Number(frame.frame_id || 0) <= Number(preRoll.lastSentFrameId || 0)) {
      return false;
    }
    return sendPcm(mode, frame.pcm, source, {
      frameId: frame.frame_id,
      frameDurationMs: frame.duration_ms,
    });
  }

  async function handleProbeMessage(mode, event) {
    const target = probe(mode);
    let payload = {};
    try {
      payload = JSON.parse(event.data || '{}');
    } catch (_) {
      return;
    }
    if (payload.type === 'partial') {
      const rawValue = cleanSttTranscript(payload.text ?? payload.partial ?? payload.transcript ?? payload.result_text ?? '');
      const displayValue = sttPayloadDisplayText(payload) || rawValue || target.transcript;
      pushEvent(mode, 'partial', displayValue, {
        detail: displayValue ? '' : 'empty partial',
        raw_text: rawValue,
        display_text: displayValue,
      });
      if (displayValue) target.transcript = displayValue;
      renderProbeUi(mode);
      poll({ force: true });
      return;
    }
    if (payload.type === 'final') {
      const rawValue = cleanSttTranscript(payload.text ?? payload.final ?? payload.transcript ?? payload.result_text ?? '');
      const value = sttPayloadDisplayText(payload) || rawValue || target.transcript;
      target.transcript = value;
      pushEvent(mode, 'final', value, {
        detail: mode === MODE_MANUAL ? 'manual stop final' : (mode === MODE_REARM ? 'rearm probe final' : 'vad probe final'),
        raw_text: rawValue,
        display_text: value,
      });
      pushAction(mode, mode === MODE_MANUAL ? 'manualFinal' : (mode === MODE_REARM ? 'rearmProbeFinal' : 'vadProbeFinal'), { text: value, raw_text: rawValue });
      target.recording = false;
      target.finalizing = false;
      target.starting = false;
      closeSocket(mode);
      resetVad(mode);
      if (mode === MODE_REARM && armRearmAfterSegment('final')) return;
      setProbeStatus(mode, value ? 'Transcript ready.' : 'No transcript returned.');
      renderProbeUi(mode);
      poll({ force: true });
      return;
    }
    if (payload.type === 'error') {
      const detail = payload.detail || 'unknown error';
      pushEvent(mode, 'error', '', { detail });
      pushAction(mode, mode === MODE_MANUAL ? 'manualError' : (mode === MODE_REARM ? 'rearmProbeError' : 'vadProbeError'), { error: detail });
      target.recording = false;
      target.finalizing = false;
      target.starting = false;
      if (mode === MODE_REARM) clearRearmAutoState();
      closeSocket(mode);
      setProbeStatus(mode, `STT failed: ${detail}`);
      renderProbeUi(mode);
      poll({ force: true });
    }
  }

  function processAudioFrame(mode, event, audioContext) {
    const target = probe(mode);
    const output = event.outputBuffer?.getChannelData?.(0);
    if (output) output.fill(0);
    const input = event.inputBuffer.getChannelData(0);
    const now = Date.now();
    const features = audioFeatures(input);
    const frame = captureAudioFrame(mode, input, audioContext, features, now);
    addSample(mode, features, frame);
    if (mode !== MODE_MANUAL && (target.vadRecordEnabled || target.vadStopEnabled)) {
      if (selectedVadDetector() === DETECTOR_SILERO) updateSileroStop(mode, now);
      else updateVad(mode, features, now, frame);
    }
    if (mode !== MODE_MANUAL) updateNoiseEstimate(mode, features, now);
    if (!target.recording || target.ws?.readyState !== WebSocket.OPEN) return;
    sendAudioFrame(mode, frame, 'stream');
  }

  async function enableProbeMode(mode) {
    mode = modeFromInput(mode);
    const target = probe(mode);
    if (target.enabled) return;
    MODES.filter(item => item !== mode).forEach(disableProbeMode);
    selectMode(mode);
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!navigator.mediaDevices?.getUserMedia || typeof WebSocket === 'undefined' || !AudioContextCtor) {
      setProbeStatus(mode, `${modeConfig(mode).label} is unavailable in this browser.`);
      renderProbeUi(mode);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const audioContext = new AudioContextCtor();
      await audioContext.resume?.();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(AUDIO_BUFFER_SIZE, 1, 1);
      target.stream = stream;
      target.audioContext = audioContext;
      target.sourceNode = source;
      target.processorNode = processor;
      target.enabled = true;
      target.recording = false;
      target.finalizing = false;
      target.starting = false;
      target.startedAt = 0;
      target.delayFrames = [];
      target.pendingFrames = [];
      resetPreRollBuffer(mode);
      if (mode === MODE_REARM) {
        target.transcript = '';
        target.events = [];
        target.actions = [];
        target.samples = [];
        target.segmentId = 0;
        clearRearmAutoState();
      }
      resetVad(mode, Date.now(), { resetNoiseFloor: true, resetSilero: true });
      processor.onaudioprocess = audioEvent => processAudioFrame(mode, audioEvent, audioContext);
      source.connect(processor);
      processor.connect(audioContext.destination);
      pushAction(mode, mode === MODE_MANUAL ? 'manualTestMode' : (mode === MODE_REARM ? 'rearmTestMode' : 'vadTestMode'), { reason: 'enabled' });
      setProbeStatus(mode, mode === MODE_MANUAL
        ? 'VAD bypass test mode enabled. Mic is live; press Record to stream.'
        : `${modeConfig(mode).label.replace(' probe', '')} test mode enabled. Mic is live.`);
      if (mode !== MODE_MANUAL && state.sileroEnabled) await ensureSileroForMode(mode, 'test_enable');
      renderProbeUi(mode);
      poll({ force: true });
    } catch (error) {
      cleanupAudio(mode);
      target.enabled = false;
      setProbeStatus(mode, `Test mode unavailable: ${error.message || error}`);
      renderProbeUi(mode);
      poll({ force: true });
    }
  }

  function disableProbeMode(mode) {
    mode = modeFromInput(mode);
    const target = probe(mode);
    const wasTouched = target.enabled || target.ws || target.actions.length || target.events.length;
    closeSocket(mode);
    disposeSilero(mode);
    cleanupAudio(mode);
    target.enabled = false;
    target.recording = false;
    target.finalizing = false;
    target.starting = false;
    target.vadRecordEnabled = false;
    target.vadStopEnabled = false;
    target.startedAt = 0;
    target.bytesSent = 0;
    target.framesSent = 0;
    target.delayFrames = [];
    target.pendingFrames = [];
    resetPreRollBuffer(mode);
    if (mode === MODE_REARM) clearRearmAutoState();
    resetVad(mode, Date.now(), { resetNoiseFloor: true, resetSilero: true, clearSileroError: true });
    if (wasTouched) {
      pushAction(mode, mode === MODE_MANUAL ? 'manualTestMode' : (mode === MODE_REARM ? 'rearmTestMode' : 'vadTestMode'), { reason: 'disabled' });
    }
    setProbeStatus(mode, modeConfig(mode).statusOff);
    renderProbeUi(mode);
    poll({ force: true });
  }

  async function startRecording(mode, options = {}) {
    mode = modeFromInput(mode);
    const target = probe(mode);
    if (target.recording || target.finalizing || target.starting) return;
    if (!target.enabled) await enableProbeMode(mode);
    if (!target.enabled) return;
    selectMode(mode);
    closeSocket(mode);
    target.bytesSent = 0;
    target.framesSent = 0;
    target.transcript = '';
    target.events = [];
    if (mode === MODE_REARM) {
      target.segmentId = Number(target.segmentId || 0) + 1;
      clearRearmAutoState();
    }
    target.pendingFrames = [];
    preparePreRollForRecording(mode, options);
    target.starting = mode !== MODE_MANUAL;
    renderProbeUi(mode);
    poll({ force: true });
    try {
      const ws = new WebSocket(await probeWebsocketUrl());
      ws.binaryType = 'arraybuffer';
      target.ws = ws;
      ws.addEventListener('message', event => { void handleProbeMessage(mode, event); });
      ws.addEventListener('close', () => {
        if (!target.recording && !target.finalizing && !target.starting) return;
        target.recording = false;
        target.finalizing = false;
        target.starting = false;
        target.ws = null;
        if (mode === MODE_REARM) clearRearmAutoState();
        pushAction(mode, mode === MODE_MANUAL ? 'manualError' : (mode === MODE_REARM ? 'rearmProbeError' : 'vadProbeError'), { error: 'socket closed before final transcript' });
        setProbeStatus(mode, 'STT connection closed before final transcript.');
        renderProbeUi(mode);
        poll({ force: true });
      });
      await waitForSocketOpen(ws);
      target.startedAt = Date.now();
      target.recording = true;
      target.finalizing = false;
      target.starting = false;
      const queued = collectPreRollFramesForRecording(mode);
      queued.forEach(frame => sendAudioFrame(mode, frame, 'pre_roll'));
      const preRoll = preRollSnapshot(mode);
      pushAction(mode, mode === MODE_MANUAL ? 'manualRecordStart' : (mode === MODE_REARM ? 'rearmProbeRecordStart' : 'vadProbeRecordStart'), {
        route: STT_WS_URL,
        reason: options.reason || 'manual_record',
        vad: detectorForMode(mode),
        vad_record_enabled: !!target.vadRecordEnabled,
        noise_reduction_enabled: voiceNoiseEnabled(),
        noise_level_db: voiceNoiseLevelDb(),
        pre_roll_frames: queued.length,
        pre_roll_audio_ms: preRoll.pre_roll_audio_ms,
        pre_roll_start_frame_id: preRoll.pre_roll_start_frame_id,
        vad_detection_frame_id: preRoll.vad_detection_frame_id,
        pre_roll_fallback_reason: preRoll.pre_roll_fallback_reason,
        pre_roll_sent_frame_ids: preRoll.pre_roll_sent_frame_ids,
      });
      const vadLabel = selectedVadDetector() === DETECTOR_SILERO ? 'Silero VAD test' : 'isolated energy VAD test';
      setProbeStatus(mode, voiceNoiseEnabled()
        ? `Recording with noise reduction; ${mode === MODE_MANUAL ? 'VAD bypassed.' : vadLabel}.`
        : `Recording without noise reduction; ${mode === MODE_MANUAL ? 'VAD bypassed.' : vadLabel}.`);
      renderProbeUi(mode);
      poll({ force: true });
    } catch (error) {
      closeSocket(mode);
      target.recording = false;
      target.finalizing = false;
      target.starting = false;
      pushAction(mode, mode === MODE_MANUAL ? 'manualError' : (mode === MODE_REARM ? 'rearmProbeError' : 'vadProbeError'), { error: error.message || String(error) });
      setProbeStatus(mode, `Recording unavailable: ${error.message || error}`);
      renderProbeUi(mode);
      poll({ force: true });
    }
  }

  function stopRecording(mode, reason = 'manual_stop') {
    mode = modeFromInput(mode);
    const target = probe(mode);
    if (!target.recording || !target.ws) {
      if (mode !== MODE_MANUAL && (target.starting || target.vadRecordEnabled)) {
        closeSocket(mode);
        target.starting = false;
        target.recording = false;
        target.finalizing = false;
        target.vadRecordEnabled = false;
        resetPreRollSegment(mode);
        if (mode === MODE_REARM) clearRearmAutoState();
        pushAction(mode, mode === MODE_REARM ? 'rearmProbeRecordStop' : 'vadProbeRecordStop', {
          reason: 'cancel_armed_record',
          audio_bytes: target.bytesSent,
          audio_frames: target.framesSent,
        });
        setProbeStatus(mode, 'VAD Record stopped.');
        renderProbeUi(mode);
        poll({ force: true });
      }
      return;
    }
    target.recording = false;
    target.finalizing = true;
    if (mode !== MODE_MANUAL) resetPreRollSegment(mode);
    if (mode !== MODE_MANUAL) target.vadRecordEnabled = false;
    const vad = target.vad || {};
    const now = Date.now();
    const detectorStop = reason === 'vad_stop' || reason === 'silero_vad_stop';
    const shouldAutoRearm = mode === MODE_REARM && detectorStop && target.vadStopEnabled;
    const speechAge = vad.lastVoiceAt ? Math.max(0, now - vad.lastVoiceAt) : null;
    const recordingMs = target.startedAt ? Math.max(0, now - target.startedAt) : null;
    pushAction(mode, mode === MODE_MANUAL ? 'manualRecordStop' : (mode === MODE_REARM ? 'rearmProbeRecordStop' : 'vadProbeRecordStop'), {
      reason,
      audio_bytes: target.bytesSent,
      audio_frames: target.framesSent,
      speech_age_ms: speechAge,
      recording_ms: recordingMs,
      timeout_ms: vadResetTimeoutMs(),
      ...(mode === MODE_REARM ? { final_wait_timeout_ms: rearmFinalTimeoutMs(), auto_rearm: shouldAutoRearm } : {}),
    });
    if (target.ws.readyState === WebSocket.OPEN) {
      const endPayload = {
        type: 'end',
        audio_bytes: target.bytesSent,
        audio_frames: target.framesSent,
      };
      if (reason !== 'manual_stop') endPayload.reason = reason;
      target.ws.send(JSON.stringify(endPayload));
      if (mode === MODE_REARM && shouldAutoRearm) {
        const finalTimeoutMs = rearmFinalTimeoutMs();
        target.autoRearmPending = true;
        target.autoRearmSegmentId = Number(target.segmentId || 0);
        target.finalWaitTimeoutMs = finalTimeoutMs;
        target.finalWaitDeadlineAt = finalTimeoutMs > 0 ? now + finalTimeoutMs : 0;
      } else if (mode === MODE_REARM) {
        clearRearmAutoState();
      }
      if (detectorStop) {
        if (mode === MODE_REARM) {
          const finalTimeoutMs = rearmFinalTimeoutMs();
          setProbeStatus(mode, finalTimeoutMs > 0
            ? `VAD Stop sent end after ${Math.round(recordingMs || 0)} ms / ${target.framesSent} frames; waiting ${formatVadResetTimeout(finalTimeoutMs)} for final before re-arm.`
            : `VAD Stop sent end after ${Math.round(recordingMs || 0)} ms / ${target.framesSent} frames; waiting for final with timeout off.`);
        } else {
          setProbeStatus(mode, `VAD Stop sent end after ${Math.round(recordingMs || 0)} ms / ${target.framesSent} frames.`);
        }
      } else {
        setProbeStatus(mode, 'Finalizing transcript.');
      }
    } else {
      target.finalizing = false;
      closeSocket(mode);
      if (mode === MODE_REARM) clearRearmAutoState();
      setProbeStatus(mode, 'STT connection was not ready.');
    }
    renderProbeUi(mode);
    poll({ force: true });
  }

  function clearProbe(mode) {
    mode = modeFromInput(mode);
    const target = probe(mode);
    if (target.recording || target.finalizing || target.starting) return;
    target.transcript = '';
    target.events = [];
    target.actions = [];
    target.samples = [];
    target.bytesSent = 0;
    target.framesSent = 0;
    target.pendingFrames = [];
    resetPreRollBuffer(mode);
    if (mode === MODE_REARM) clearRearmAutoState();
    resetVad(mode, Date.now(), { resetNoiseFloor: true, resetSilero: true });
    setProbeStatus(mode, target.enabled
      ? (mode === MODE_MANUAL ? 'VAD bypass test mode enabled. Mic is live; press Record to stream.' : `${modeConfig(mode).label.replace(' probe', '')} test mode enabled. Mic is live.`)
      : modeConfig(mode).statusOff);
    renderProbeUi(mode);
    poll({ force: true });
  }

  async function toggleVadRecordMode(mode, nextValue = null) {
    mode = modeFromInput(mode);
    if (mode === MODE_MANUAL) return;
    const target = probe(mode);
    if (!target.enabled) return;
    target.vadRecordEnabled = nextValue == null ? !target.vadRecordEnabled : !!nextValue;
    resetVad(mode);
    pushAction(mode, 'vadRecordMode', { enabled: target.vadRecordEnabled, detector: selectedVadDetector() });
    setProbeStatus(mode, target.vadRecordEnabled
      ? `${selectedVadDetector() === DETECTOR_SILERO ? 'Silero VAD' : 'Energy VAD'} Record enabled. Speak to auto-record.`
      : 'VAD Record disabled.');
    renderProbeUi(mode);
    poll({ force: true });
    if (target.vadRecordEnabled && selectedVadDetector() === DETECTOR_SILERO) await ensureSileroForMode(mode, 'vad_record_enabled');
  }

  async function toggleVadStopMode(mode, nextValue = null) {
    mode = modeFromInput(mode);
    if (mode === MODE_MANUAL) return;
    const target = probe(mode);
    if (!target.enabled) return;
    target.vadStopEnabled = nextValue == null ? !target.vadStopEnabled : !!nextValue;
    pushAction(mode, 'vadStopMode', { enabled: target.vadStopEnabled, detector: selectedVadDetector(), timeout_ms: vadResetTimeoutMs() });
    setProbeStatus(mode, target.vadStopEnabled
      ? `${selectedVadDetector() === DETECTOR_SILERO ? 'Silero VAD' : 'Energy VAD'} Stop enabled. Silence will send Stop.`
      : 'VAD Stop disabled.');
    renderProbeUi(mode);
    poll({ force: true });
    if (target.vadStopEnabled && selectedVadDetector() === DETECTOR_SILERO) await ensureSileroForMode(mode, 'vad_stop_enabled');
  }

  function armRearmAfterSegment(reason) {
    const target = probe(MODE_REARM);
    if (!target.enabled || !target.vadStopEnabled) return false;
    if (target.recording || target.finalizing || target.starting) return false;
    target.vadRecordEnabled = true;
    clearRearmAutoState();
    resetVad(MODE_REARM, Date.now());
    pushAction(MODE_REARM, 'vadRecordMode', {
      enabled: true,
      reason,
      auto_rearm: true,
    });
    setProbeStatus(MODE_REARM, reason === 'final_timeout'
      ? 'VAD Record auto re-armed after final timeout. Speak for the next segment.'
      : 'VAD Record auto re-armed after final transcript. Speak for the next segment.');
    renderProbeUi(MODE_REARM);
    poll({ force: true });
    return true;
  }

  function maybeRearmAfterFinalTimeout(now = Date.now()) {
    const target = probe(MODE_REARM);
    if (!target.autoRearmPending) return false;
    const deadline = Number(target.finalWaitDeadlineAt || 0);
    if (!deadline || now < deadline) return false;
    pushAction(MODE_REARM, 'rearmProbeFinalTimeout', {
      wait_ms: target.finalWaitTimeoutMs,
      reason: 'final_timeout',
      waited_from: 'stt_end',
      segment_id: target.autoRearmSegmentId,
    });
    target.recording = false;
    target.finalizing = false;
    target.starting = false;
    closeSocket(MODE_REARM);
    return armRearmAfterSegment('final_timeout');
  }

  function probeFsm(mode) {
    const target = probe(mode);
    if (mode === MODE_MANUAL) {
      if (!target.enabled) return 'MANUAL_STT_OFF';
      if (target.recording) return 'MANUAL_STT_RECORDING';
      if (target.finalizing) return 'MANUAL_STT_FINALIZING';
      return 'MANUAL_STT_READY';
    }
    const prefix = mode === MODE_REARM ? 'VAD_REARM_STT' : 'VAD_STT';
    if (!target.enabled) return `${prefix}_OFF`;
    if (target.recording) return `${prefix}_RECORDING`;
    if (target.finalizing) return `${prefix}_FINALIZING`;
    if (target.starting) return `${prefix}_OPENING`;
    if (target.vadRecordEnabled || target.vadStopEnabled) return `${prefix}_ARMED`;
    return `${prefix}_READY`;
  }

  function actionColor(mode, action) {
    const type = action?.type || '';
    if (type === 'manualRecordStart' || type === 'manualFinal') return '#22c55e';
    if (type === 'manualRecordStop') return '#fbbf24';
    if (type === 'manualTestMode') return '#38bdf8';
    if (type === 'manualError') return '#f87171';
    if (type === 'vadProbeRecordStart' || type === 'vadProbeFinal' || type === 'rearmProbeRecordStart' || type === 'rearmProbeFinal' || type === 'vadCandidateConfirmed' || type === 'sileroReady' || type === 'sileroSpeechConfirmed') return '#22c55e';
    if (type === 'vadProbeRecordStop' || type === 'rearmProbeRecordStop' || type === 'vadStopMode' || type === 'sileroSpeechEnd') return '#fbbf24';
    if (type === 'autoPreRollSelect') return action.applied ? '#22c55e' : '#fbbf24';
    if (type === 'autoPreRollMode') return action.enabled ? '#22c55e' : '#aebfca';
    if (type === 'vadRecordMode' || type === 'vadDetectorMode' || type === 'vadTestMode' || type === 'rearmTestMode' || type === 'vadCandidateStart' || type === 'sileroLoad' || type === 'sileroCandidateStart') return '#38bdf8';
    if (type === 'vadProbeError' || type === 'rearmProbeError' || type === 'rearmProbeFinalTimeout' || type === 'sileroError' || type === 'sileroMisfire') return '#f87171';
    if (mode === MODE_REARM && type === 'controlState') return action.disabled ? 'rgba(148,168,179,0.72)' : (action.pressed ? '#38bdf8' : '#aebfca');
    return '#aebfca';
  }

  function actionLabel(action) {
    if (!action || typeof action !== 'object') return '';
    if (action.type === 'manualTestMode' || action.type === 'vadTestMode' || action.type === 'rearmTestMode') return `test ${action.reason || ''}`.trim();
    if (action.type === 'manualRecordStart') return 'Record manual';
    if (action.type === 'manualRecordStop') return 'Stop manual';
    if (action.type === 'manualFinal') return 'final transcript';
    if (action.type === 'manualError') return `error ${action.error || ''}`.trim();
    if (action.type === 'vadRecordMode' && action.auto_rearm) return `VAD Record auto rearmed ${action.reason || ''}`.trim();
    if (action.type === 'vadRecordMode') return `VAD Record ${action.enabled ? 'on' : 'off'}`;
    if (action.type === 'vadDetectorMode') return `detector ${action.detector || ''}`.trim();
    if (action.type === 'vadStopMode') return `VAD Stop ${action.enabled ? 'on' : 'off'}`;
    if (action.type === 'vadCandidateStart') return 'VAD candidate';
    if (action.type === 'vadCandidateConfirmed') return 'VAD strong';
    if (action.type === 'autoPreRollSelect') return action.applied ? 'pre-roll selected' : `pre-roll ${action.reason || 'skipped'}`;
    if (action.type === 'autoPreRollMode') return `pre-roll ${action.enabled ? 'on' : 'off'}`;
    if (action.type === 'sileroLoad') return 'Silero loading';
    if (action.type === 'sileroReady') return 'Silero ready';
    if (action.type === 'sileroCandidateStart') return 'Silero candidate';
    if (action.type === 'sileroSpeechConfirmed') return 'Silero speech';
    if (action.type === 'sileroSpeechEnd') return 'Silero quiet';
    if (action.type === 'sileroMisfire') return 'Silero misfire';
    if (action.type === 'sileroError') return `Silero error ${action.error || ''}`.trim();
    if (action.type === 'vadProbeRecordStart' || action.type === 'rearmProbeRecordStart') return `Record ${action.reason || 'start'}`;
    if (action.type === 'vadProbeRecordStop' || action.type === 'rearmProbeRecordStop') return `Stop ${action.reason || 'stop'}`;
    if (action.type === 'vadProbeFinal' || action.type === 'rearmProbeFinal') return 'final transcript';
    if (action.type === 'rearmProbeFinalTimeout') return `final timeout ${action.wait_ms || ''} ms`.trim();
    if (action.type === 'vadProbeError' || action.type === 'rearmProbeError') return `error ${action.error || ''}`.trim();
    return action.type || 'event';
  }

  function transcriptSpan(mode, now = Date.now()) {
    const target = probe(mode);
    const segmentId = Number(target.segmentId || 0);
    const textEvents = target.events.filter(evt => (
      (evt.type === 'partial' || evt.type === 'final')
      && (mode !== MODE_REARM || Number(evt.segment_id || 0) === segmentId)
      && cleanSttTranscript(evt.display_text || evt.text || '')
    ));
    if (!textEvents.length) return null;
    const first = textEvents.find(evt => evt.type === 'partial') || textEvents[0];
    const finalEvent = [...textEvents].reverse().find(evt => evt.type === 'final');
    const latest = textEvents[textEvents.length - 1];
    let statusValue = 'partial';
    let endAt = now;
    if (finalEvent) {
      statusValue = 'final';
      endAt = Number(finalEvent.at_ms || now);
    } else if (mode === MODE_REARM) {
      const stopAction = [...target.actions].reverse()
        .find(action => (
          action.type === 'rearmProbeRecordStop'
          && Number(action.segment_id || 0) === segmentId
          && Number(action.at_ms || 0) >= Number(first.at_ms || 0)
        ));
      const finalTimeoutMs = Number(stopAction?.final_wait_timeout_ms ?? rearmFinalTimeoutMs());
      if (!target.recording && finalTimeoutMs > 0 && stopAction?.at_ms && now - Number(stopAction.at_ms) >= finalTimeoutMs) {
        statusValue = 'timeout';
        endAt = Number(stopAction.at_ms) + finalTimeoutMs;
      }
    }
    const color = statusValue === 'final' ? '#22c55e' : (statusValue === 'timeout' ? '#f87171' : '#38bdf8');
    return {
      atMs: Number(first.at_ms || now),
      endMs: Math.max(Number(first.at_ms || now) + 80, endAt),
      text: latest.display_text || target.transcript || latest.text || '',
      status: statusValue,
      color,
      background: statusValue === 'final'
        ? 'rgba(5,46,22,0.97)'
        : (statusValue === 'timeout' ? 'rgba(69,10,10,0.97)' : 'rgba(7,24,39,0.97)'),
      border: statusValue === 'final'
        ? 'rgba(74,222,128,0.86)'
        : (statusValue === 'timeout' ? 'rgba(248,113,113,0.86)' : 'rgba(56,189,248,0.82)'),
    };
  }

  function controlsSnapshot() {
    const detector = selectedVadDetector();
    const thresholdDb = noiseThresholdDb();
    return {
      noise_reduction_enabled: !!els.noiseToggle?.checked,
      noise_level_db: Number(els.noiseLevel?.value || 6),
      speech_aggregation_timeout_ms: Number(els.aggregation?.value || 80),
      vad_reset_timeout_ms: Number(els.vadReset?.value || 0),
      auto_pre_roll_enabled: !!state.autoPreRollEnabled,
      noise_threshold_db: thresholdDb,
      detector,
      vad_detector: detector,
      silero_enabled: !!state.sileroEnabled,
      silero_model: SILERO_MODEL,
    };
  }

  function probePublic(mode) {
    const target = probe(mode);
    const silero = target.silero || createSileroState();
    const preRoll = mode === MODE_MANUAL ? {} : preRollSnapshot(mode);
    return {
      enabled: !!target.enabled,
      recording: !!target.recording,
      finalizing: !!target.finalizing,
      starting: !!target.starting,
      vad_record_enabled: !!target.vadRecordEnabled,
      vad_stop_enabled: !!target.vadStopEnabled,
      transcript: target.transcript || '',
      status: target.status || '',
      bytes_sent: target.bytesSent || 0,
      frames_sent: target.framesSent || 0,
      events_count: target.events.length,
      actions_count: target.actions.length,
      fsm_state: probeFsm(mode),
      detector: detectorForMode(mode),
      ...preRoll,
      silero: {
        enabled: mode !== MODE_MANUAL && !!state.sileroEnabled,
        loading: !!silero.loading,
        ready: !!silero.ready,
        listening: !!silero.listening,
        error: silero.error || '',
        model: silero.model || SILERO_MODEL,
        is_speech_probability: silero.isSpeechProbability,
        not_speech_probability: silero.notSpeechProbability,
      },
    };
  }

  function snapshotForMode(mode = currentMode()) {
    mode = modeFromInput(mode);
    const target = probe(mode);
    const config = modeConfig(mode);
    const now = Date.now();
    const start = now - WINDOW_MS;
    const fsm = probeFsm(mode);
    const vad = target.vad || {};
    const silero = target.silero || createSileroState();
    const detector = detectorForMode(mode);
    const sileroEnabled = mode !== MODE_MANUAL && !!state.sileroEnabled;
    const vadEnabled = mode !== MODE_MANUAL && !!(target.vadRecordEnabled || target.vadStopEnabled);
    const vadSpeech = !!vad.speaking;
    const vadStage = vad.candidateConfirmed ? 'strong' : (vad.candidateActive ? 'candidate' : 'idle');
    const span = transcriptSpan(mode, now);
    const noiseStatus = applyNoiseThresholdStatus(mode);
    const preRoll = preRollSnapshot(mode);
    const controls = controlsSnapshot();
    const timeoutMarkerExists = mode === MODE_REARM && target.actions.some(action => (
      action.type === 'rearmProbeFinalTimeout'
      && Number(action.segment_id || 0) === Number(target.segmentId || 0)
    ));
    return {
      fsm_state: fsm,
      reason: target.enabled ? `${config.label}; isolated browser VAD/STT probe.` : config.statusOff,
      session_id: target.enabled ? config.session : '',
      active_instance_id: 'voice-mode-stt',
      detector,
      silero_enabled: sileroEnabled,
      silero_model: silero.model || SILERO_MODEL,
      silero_loading: !!silero.loading,
      silero_ready: !!silero.ready,
      silero_error: silero.error || '',
      silero_is_speech_probability: silero.isSpeechProbability,
      silero_not_speech_probability: silero.notSpeechProbability,
      silero_positive_threshold: Number(silero.positiveThreshold || SILERO_POSITIVE_THRESHOLD),
      silero_negative_threshold: Number(silero.negativeThreshold || SILERO_NEGATIVE_THRESHOLD),
      audio_frames_sent: target.framesSent,
      noise_floor_db: noiseStatus.noise_floor_db,
      noise_estimate_db: noiseStatus.noise_estimate_db,
      noise_estimate_state: noiseStatus.noise_estimate_state,
      noise_threshold_db: noiseStatus.noise_threshold_db,
      noise_threshold_exceeded: noiseStatus.noise_threshold_exceeded,
      noise_threshold_color: noiseStatus.noise_threshold_color,
      ...preRoll,
      transcript: target.transcript,
      recent_stt_events: target.events,
      recent_actions: target.actions,
      vad_speech_start_reset_armed: mode !== MODE_MANUAL ? !!target.vadRecordEnabled : false,
      vad: {
        detector,
        speaking: mode === MODE_MANUAL ? !!target.recording : !!vad.speaking,
        candidate_active: !!vad.candidateActive,
        candidate_confirmed: !!vad.candidateConfirmed,
        candidate_age_ms: vad.candidateStartedAt ? Math.max(0, now - vad.candidateStartedAt) : 0,
        candidate_frames: Number(vad.candidateFrames || 0),
        quiet_frames: Number(vad.quietFrames || 0),
        speech_seen_since_reset: mode === MODE_MANUAL ? !!target.recording : !!vad.speechSeenSinceReset,
        last_voice_age_ms: vad.lastVoiceAt ? Math.max(0, now - vad.lastVoiceAt) : (target.recording ? Math.max(0, now - (target.startedAt || now)) : null),
        silence_age_ms: mode !== MODE_MANUAL && !vad.speaking && vad.lastVoiceAt ? Math.max(0, now - vad.lastVoiceAt) : (target.recording ? 0 : null),
        reset_timeout_ms: mode === MODE_MANUAL ? 0 : vadResetTimeoutMs(),
        noise_floor: Number(vad.noiseFloor || 0),
        noise_floor_db: noiseStatus.noise_floor_db,
        noise_estimate_db: noiseStatus.noise_estimate_db,
        noise_estimate_state: noiseStatus.noise_estimate_state,
        noise_threshold_db: noiseStatus.noise_threshold_db,
        noise_threshold_exceeded: noiseStatus.noise_threshold_exceeded,
        noise_threshold_color: noiseStatus.noise_threshold_color,
        enter_threshold: Number(vad.enterThreshold || 0),
        exit_threshold: Number(vad.exitThreshold || 0),
        strong_enter_threshold: Number(vad.strongEnterThreshold || 0),
        enter_delta_db: Number(vad.enterDeltaDb || VAD_TEST_ENTER_DELTA_DB),
        exit_delta_db: Number(vad.exitDeltaDb || VAD_TEST_EXIT_DELTA_DB),
        strong_delta_db: Number(vad.strongDeltaDb || VAD_TEST_STRONG_DELTA_DB),
        energy: Number(vad.lastEnergy || 0),
        energy_db: Number(vad.lastEnergyDb || -80),
        energy_delta_db: Number(vad.energyDeltaDb || 0),
        baseline_paused: !!vad.baselinePaused,
        silero_enabled: sileroEnabled,
        silero_model: silero.model || SILERO_MODEL,
        silero_loading: !!silero.loading,
        silero_ready: !!silero.ready,
        silero_listening: !!silero.listening,
        silero_error: silero.error || '',
        silero_is_speech_probability: silero.isSpeechProbability,
        silero_not_speech_probability: silero.notSpeechProbability,
        silero_positive_threshold: Number(silero.positiveThreshold || SILERO_POSITIVE_THRESHOLD),
        silero_negative_threshold: Number(silero.negativeThreshold || SILERO_NEGATIVE_THRESHOLD),
      },
      active_send: {
        route: STT_WS_URL,
        vad: detector,
        vad_record_enabled: !!target.vadRecordEnabled,
        vad_stop_enabled: !!target.vadStopEnabled,
        noise_reduction_enabled: controls.noise_reduction_enabled,
        noise_level_db: controls.noise_level_db,
        recording: !!target.recording,
        finalizing: !!target.finalizing,
        bytes_sent: target.bytesSent,
        frames_sent: target.framesSent,
        ...preRoll,
      },
      controls,
      modes: {
        [MODE_MANUAL]: probePublic(MODE_MANUAL),
        [MODE_VAD]: probePublic(MODE_VAD),
        [MODE_REARM]: probePublic(MODE_REARM),
      },
      metrics: [
        { label: 'FSM', value: fsm },
        { label: 'Session', value: target.enabled ? config.session : '--' },
        { label: 'Instance', value: 'voice-mode-stt' },
        { label: 'Frames', value: String(target.framesSent || 0) },
        { label: 'Debug age', value: 'live' },
        { label: 'Level', value: formatDb(target.lastLevel || 0) },
        { label: 'Detector', value: detector },
        { label: 'Noise', value: mode === MODE_MANUAL || noiseStatus.noise_estimate_state === 'unavailable' ? '--' : `${Number(noiseStatus.noise_estimate_db || -80).toFixed(1)} dB` },
        { label: 'Delta', value: mode === MODE_MANUAL || detector === DETECTOR_SILERO ? '--' : `${Number(vad.energyDeltaDb || 0).toFixed(1)} dB` },
        { label: 'Threshold', value: mode === MODE_MANUAL ? '--' : `${noiseStatus.noise_threshold_color} ${Number(noiseStatus.noise_threshold_db).toFixed(0)} dB` },
        { label: 'Pre-roll', value: mode === MODE_MANUAL ? '--' : (preRoll.auto_pre_roll_active ? `on ${preRoll.pre_roll_buffer_frames}f` : preRoll.auto_pre_roll_reason) },
        { label: 'Silero', value: mode === MODE_MANUAL ? '--' : sileroStatusValue(mode) },
        { label: 'Speech P', value: mode === MODE_MANUAL || silero.isSpeechProbability == null ? '--' : Number(silero.isSpeechProbability).toFixed(3) },
        { label: 'Candidate', value: mode === MODE_MANUAL ? '--' : `${vadStage}${vad.candidateFrames ? `/${vad.candidateFrames}` : ''}` },
      ],
      source: `${config.label} | ${STT_WS_URL} | ${target.status || 'ready'}`,
      activeState: fsm,
      states: config.states,
      timeline: {
        startMs: start,
        endMs: now,
        samples: target.samples,
        markers: [
          ...target.actions.map((action, index) => ({
            atMs: action.at_ms,
            label: actionLabel(action),
            color: actionColor(mode, action),
            lane: index % 4,
          })),
          ...(mode === MODE_REARM && span?.status === 'timeout' && !timeoutMarkerExists ? [{
            atMs: span.endMs,
            label: 'VAD Stop final timeout',
            color: '#f87171',
            lane: 0,
          }] : []),
        ],
        text: [],
        transcriptSpan: span,
        statuses: statusPills(mode, vadEnabled, vadSpeech, vadStage),
        startLabel: '10s',
        endLabel: 'now',
      },
    };
  }

  function statusPills(mode, vadEnabled, vadSpeech, vadStage) {
    const target = probe(mode);
    if (mode === MODE_MANUAL) {
      return [{
        label: `VAD bypass | STT ${target.recording ? 'recording' : (target.finalizing ? 'finalizing' : 'idle')} | ${target.bytesSent || 0} bytes`,
        background: target.recording ? 'rgba(5,46,22,0.9)' : 'rgba(16,24,38,0.9)',
        border: target.recording ? 'rgba(74,222,128,0.72)' : 'rgba(91,156,246,0.42)',
        color: '#f1f7fa',
        maxWidth: 340,
      }];
    }
    const detector = selectedVadDetector();
    const silero = target.silero || createSileroState();
    const preRoll = preRollSnapshot(mode);
    const pills = [
      {
        label: `${detector === DETECTOR_SILERO ? 'Silero VAD' : 'Energy VAD'} ${vadEnabled ? 'enabled' : 'off'} | ${vadSpeech ? 'speech' : 'quiet'} | ${vadStage} | record ${target.vadRecordEnabled ? 'on' : 'off'} | stop ${target.vadStopEnabled ? 'on' : 'off'}`,
        background: vadEnabled ? (vadSpeech ? 'rgba(21,128,61,0.34)' : 'rgba(7,24,39,0.94)') : 'rgba(16,24,38,0.9)',
        border: vadEnabled ? (vadSpeech ? 'rgba(34,197,94,0.7)' : 'rgba(56,189,248,0.58)') : 'rgba(148,168,179,0.42)',
        color: '#f1f7fa',
        maxWidth: 470,
      },
      {
        label: `STT ${target.recording ? 'recording' : (target.finalizing ? 'finalizing' : (target.starting ? 'opening' : 'idle'))} | ${target.bytesSent || 0} bytes`,
        background: target.recording ? 'rgba(5,46,22,0.9)' : 'rgba(16,24,38,0.9)',
        border: target.recording ? 'rgba(74,222,128,0.72)' : 'rgba(91,156,246,0.42)',
        color: '#f1f7fa',
        maxWidth: 280,
      },
    ];
    if (preRoll.auto_pre_roll_enabled) {
      pills.push({
        label: `Pre-roll ${preRoll.auto_pre_roll_active ? 'active' : 'idle'} | ${preRoll.pre_roll_buffer_frames} frames | ${preRoll.auto_pre_roll_reason}`,
        background: preRoll.auto_pre_roll_active ? 'rgba(5,46,22,0.82)' : 'rgba(16,24,38,0.9)',
        border: preRoll.auto_pre_roll_active ? 'rgba(74,222,128,0.68)' : 'rgba(148,168,179,0.42)',
        color: '#f1f7fa',
        maxWidth: 430,
      });
    }
    if (detector === DETECTOR_SILERO) {
      pills.splice(1, 0, {
        label: `Silero ${sileroStatusValue(mode)} | p ${silero.isSpeechProbability == null ? '--' : Number(silero.isSpeechProbability).toFixed(3)} | model ${silero.model || SILERO_MODEL}`,
        background: silero.error ? 'rgba(69,10,10,0.92)' : (silero.ready ? 'rgba(5,46,22,0.82)' : 'rgba(7,24,39,0.94)'),
        border: silero.error ? 'rgba(248,113,113,0.75)' : (silero.ready ? 'rgba(74,222,128,0.68)' : 'rgba(56,189,248,0.58)'),
        color: '#f1f7fa',
        maxWidth: 340,
      });
    }
    return pills;
  }

  function currentMode() {
    const active = MODES.find(mode => {
      const target = probe(mode);
      return target.enabled || target.recording || target.finalizing || target.starting;
    });
    return active || state.selectedMode || MODE_MANUAL;
  }

  function setTimelineSnapshot(snapshot) {
    if (state.timeline) {
      state.timeline.setSnapshot?.(snapshot);
      return;
    }
    void mountTimeline().then(view => view?.setSnapshot?.(snapshot));
  }

  function renderTimeline() {
    const snapshot = snapshotForMode(currentMode());
    setTimelineSnapshot(snapshot);
    return snapshot;
  }

  function reportDevStatus(snapshot, mode, options = {}) {
    const vm = voiceMode();
    const browserId = cleanText(vm?.getBrowserId?.());
    if (!browserId) return;
    const signature = JSON.stringify({
      surface: SURFACE,
      mode,
      status: probe(mode).status,
      transcript: probe(mode).transcript,
      fsm: snapshot?.fsm_state || '',
      frames: snapshot?.audio_frames_sent || 0,
      controls: snapshot?.controls || {},
      modes: snapshot?.modes || {},
      actions: Array.isArray(snapshot?.recent_actions) ? snapshot.recent_actions.length : 0,
      events: Array.isArray(snapshot?.recent_stt_events) ? snapshot.recent_stt_events.length : 0,
      vad: snapshot?.vad || {},
      pre_roll: {
        buffer_frames: snapshot?.pre_roll_buffer_frames || 0,
        buffer_ms: snapshot?.pre_roll_buffer_ms || 0,
        selected_frames: snapshot?.pre_roll_selected_frames || 0,
        sent: snapshot?.pre_roll_sent_frame_ids || '',
        detection: snapshot?.vad_detection_frame_id || null,
      },
    });
    const now = Date.now();
    if (!options.force && signature === state.devStatusSignature && now - state.devStatusLastAt < 2500) return;
    if (!options.force && now - state.devStatusLastAt < DEV_STATUS_MIN_MS) return;
    if (state.devStatusSending) return;
    state.devStatusSignature = signature;
    state.devStatusLastAt = now;
    state.devStatusSending = true;
    api(DEV_STATUS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        surface: SURFACE,
        browser_id: browserId,
        browser_label: vm?.getBrowserLabel?.() || (navigator.platform ? `Browser on ${navigator.platform}` : 'Blueprints browser'),
        tab_id: vm?.getTabId?.() || '',
        mode,
        source: modeConfig(mode).label,
        status: probe(mode).status || '',
        transcript: probe(mode).transcript || '',
        snapshot,
        client_now_ms: now,
      }),
    }).catch(() => {}).finally(() => {
      state.devStatusSending = false;
    });
  }

  function poll(options = {}) {
    maybeRearmAfterFinalTimeout();
    const mode = currentMode();
    const snapshot = renderTimeline();
    refreshNoiseControlStates(mode);
    reportDevStatus(snapshot, mode, options);
  }

  function renderProbeUi(mode) {
    mode = modeFromInput(mode);
    const target = probe(mode);
    if (mode === MODE_MANUAL) {
      if (els.testMode) {
        els.testMode.setAttribute('aria-pressed', target.enabled ? 'true' : 'false');
        els.testMode.textContent = target.enabled ? 'Disable test mode' : 'Enable test mode';
      }
      if (els.testRecord) els.testRecord.disabled = !target.enabled || target.recording || target.finalizing;
      if (els.testStop) els.testStop.disabled = !target.recording;
      if (els.testClear) els.testClear.disabled = target.recording || target.finalizing;
      setProbeStatus(mode, target.status);
      if (els.transcript) els.transcript.textContent = target.transcript || '';
      return;
    }
    const prefix = mode === MODE_REARM ? 'rearm' : 'vad';
    const testMode = els[`${prefix}TestMode`];
    const recordToggle = els[`${prefix}RecordToggle`];
    const stopToggle = els[`${prefix}StopToggle`];
    const testRecord = els[`${prefix}TestRecord`];
    const testStop = els[`${prefix}TestStop`];
    const testClear = els[`${prefix}TestClear`];
    const transcript = els[`${prefix}Transcript`];
    if (testMode) {
      testMode.setAttribute('aria-pressed', target.enabled ? 'true' : 'false');
      testMode.textContent = target.enabled ? 'Disable test mode' : 'Enable test mode';
    }
    if (recordToggle) {
      recordToggle.disabled = !target.enabled || target.finalizing;
      recordToggle.setAttribute('aria-pressed', target.vadRecordEnabled ? 'true' : 'false');
      recordToggle.textContent = target.recording
        ? 'VAD Recording'
        : (target.starting ? 'VAD Opening' : (target.vadRecordEnabled ? 'VAD Record Armed' : 'Enable VAD Record'));
    }
    if (stopToggle) {
      stopToggle.disabled = !target.enabled || target.finalizing;
      stopToggle.setAttribute('aria-pressed', target.vadStopEnabled ? 'true' : 'false');
      stopToggle.textContent = target.vadStopEnabled ? 'VAD Stop Armed' : 'Enable VAD Stop';
    }
    if (testRecord) testRecord.disabled = !target.enabled || target.vadRecordEnabled || target.recording || target.finalizing || target.starting;
    if (testStop) testStop.disabled = !target.recording && !target.starting && !target.vadRecordEnabled;
    if (testClear) testClear.disabled = target.recording || target.finalizing || target.starting;
    setProbeStatus(mode, target.status);
    if (transcript) transcript.textContent = target.transcript || '';
  }

  function renderAllProbeUi() {
    MODES.forEach(renderProbeUi);
  }

  function selectMode(mode) {
    mode = modeFromInput(mode);
    state.selectedMode = mode;
    const radio = mode === MODE_MANUAL
      ? els.tabManual
      : (mode === MODE_VAD ? els.tabVad : els.tabRearm);
    if (radio) radio.checked = true;
  }

  function rememberDevCommand(commandId) {
    const id = cleanText(commandId);
    if (!id) return false;
    if (state.devCommandIds.includes(id)) return false;
    state.devCommandIds.push(id);
    if (state.devCommandIds.length > DEV_COMMAND_MAX_SEEN) {
      state.devCommandIds = state.devCommandIds.slice(-DEV_COMMAND_MAX_SEEN);
    }
    return true;
  }

  function localTabId() {
    return cleanText(voiceMode()?.getTabId?.());
  }

  function shouldAcceptDevCommand(payload) {
    const surface = cleanCommandText(payload?.surface || payload?.target_surface || payload?.dev_surface);
    if (surface !== SURFACE) return false;
    const targetBrowserId = cleanText(payload?.target_browser_id || payload?.browser_id);
    const browserId = cleanText(voiceMode()?.getBrowserId?.());
    if (targetBrowserId && browserId && targetBrowserId !== browserId) return false;
    const targetTabId = cleanText(payload?.target_tab_id || payload?.tab_id);
    const tabId = localTabId();
    if (targetTabId && tabId && targetTabId !== tabId) return false;
    const createdAt = Number(payload?.created_at || 0);
    const maxAgeSeconds = Math.max(5, Math.min(300, Number(payload?.max_age_seconds || 60)));
    if (Number.isFinite(createdAt) && createdAt > 0) {
      const ageMs = Date.now() - (createdAt * 1000);
      if (ageMs > maxAgeSeconds * 1000) return false;
    }
    return true;
  }

  function payloadBool(payload, fallback = true) {
    if (payload?.enabled != null) return !!payload.enabled;
    if (payload?.value != null) return !['0', 'false', 'off', 'no'].includes(String(payload.value).trim().toLowerCase());
    return fallback;
  }

  function payloadNumber(payload, ...keys) {
    for (const key of keys) {
      const value = Number(payload?.[key]);
      if (Number.isFinite(value)) return value;
    }
    const value = Number(payload?.value);
    return Number.isFinite(value) ? value : null;
  }

  async function setSileroVadEnabled(enabled, options = {}) {
    const next = !!enabled;
    if (state.sileroEnabled === next) {
      renderSharedControls();
    } else {
      state.sileroEnabled = next;
      MODES.filter(mode => mode !== MODE_MANUAL).forEach(mode => {
        resetVad(mode, Date.now(), { resetNoiseFloor: !next, resetSilero: true });
        if (!next) disposeSilero(mode);
      });
      renderSharedControls();
    }
    const mode = currentMode();
    if (mode !== MODE_MANUAL) {
      pushAction(mode, 'vadDetectorMode', {
        detector: selectedVadDetector(),
        silero_enabled: state.sileroEnabled,
        reason: options.reason || 'set_silero_vad',
      });
      if (state.sileroEnabled) {
        const target = probe(mode);
        setProbeStatus(mode, target.enabled
          ? 'Silero VAD selected; loading detector.'
          : 'Silero VAD selected; enable test mode to load the detector.');
        if (target.enabled) await ensureSileroForMode(mode, options.reason || 'set_silero_vad');
      } else {
        setProbeStatus(mode, 'Energy VAD selected.');
      }
    } else {
      status(state.sileroEnabled ? 'Silero VAD selected for VAD modes.' : 'Energy VAD selected for VAD modes.');
    }
    renderAllProbeUi();
    poll({ force: true });
  }

  async function setVadDetector(value) {
    const clean = cleanCommandText(value);
    if (clean === DETECTOR_SILERO || clean === 'silero' || clean === 'silero_vad') {
      await setSileroVadEnabled(true, { reason: 'set_vad_detector' });
      return true;
    }
    if (clean === DETECTOR_ENERGY || clean === 'energy' || clean === 'browser_energy' || clean === 'energy_vad') {
      await setSileroVadEnabled(false, { reason: 'set_vad_detector' });
      return true;
    }
    return false;
  }

  function setAutoPreRollEnabled(enabled, options = {}) {
    state.autoPreRollEnabled = !!enabled;
    renderSharedControls();
    const mode = currentMode();
    if (mode !== MODE_MANUAL) {
      pushAction(mode, 'autoPreRollMode', {
        enabled: state.autoPreRollEnabled,
        reason: options.reason || 'set_auto_pre_roll',
        noise_threshold_db: noiseThresholdDb(),
      });
    }
    poll({ force: true });
  }

  function setNoiseThreshold(value) {
    state.noiseThresholdDb = clampNoiseThresholdDb(value);
    if (els.noiseThreshold) els.noiseThreshold.value = String(state.noiseThresholdDb);
    renderRangeLabels();
    poll({ force: true });
  }

  async function runSettingsCommand(action, payload) {
    const vm = voiceMode();
    if (action === 'set_auto_pre_roll') {
      setAutoPreRollEnabled(payloadBool(payload, true), { reason: 'remote_command' });
      return true;
    }
    if (action === 'set_noise_threshold' || action === 'set_noise_threshold_db') {
      const threshold = payloadNumber(payload, 'noise_threshold_db', 'threshold_db');
      if (threshold != null) setNoiseThreshold(threshold);
      return true;
    }
    if (action === 'set_silero_vad') {
      await setSileroVadEnabled(payloadBool(payload, true), { reason: 'remote_command' });
      return true;
    }
    if (action === 'set_vad_detector') {
      return setVadDetector(payload?.value ?? payload?.detector ?? payload?.vad_detector);
    }
    if (action === 'set_noise_reduction') {
      vm?.setSttNoiseReductionEnabled?.(payloadBool(payload, true));
      renderSharedControls();
      poll({ force: true });
      return true;
    }
    if (action === 'set_noise_level' || action === 'set_noise_level_db') {
      const level = payloadNumber(payload, 'level_db', 'noise_level_db');
      if (level != null) {
        vm?.setSttNoiseReductionLevelDb?.(Math.max(0, Math.min(12, level)));
      }
      renderSharedControls();
      poll({ force: true });
      return true;
    }
    if (action === 'set_aggregation_timeout') {
      const value = payloadNumber(payload, 'aggregation_timeout_ms', 'speech_aggregation_timeout_ms');
      if (value != null) await vm?.saveAggregationTimeout?.(value);
      renderSharedControls();
      poll({ force: true });
      return true;
    }
    if (action === 'set_vad_reset_timeout') {
      const value = payloadNumber(payload, 'vad_reset_timeout_ms', 'reset_timeout_ms');
      if (value != null) await vm?.saveVadResetTimeout?.(value);
      renderSharedControls();
      poll({ force: true });
      return true;
    }
    return false;
  }

  async function runVadDevCommand(payload) {
    if (!shouldAcceptDevCommand(payload)) return;
    if (!rememberDevCommand(cleanText(payload?.command_id))) return;
    if (payload?.open_modal && !state.open) open();
    const mode = modeFromInput(payload?.mode);
    const action = cleanCommandText(payload?.action);
    if (await runSettingsCommand(action, payload)) return;
    selectMode(mode);
    if (action === 'enable_test') await enableProbeMode(mode);
    else if (action === 'disable_test') disableProbeMode(mode);
    else if (action === 'record') await startRecording(mode, { reason: 'remote_command' });
    else if (action === 'stop') stopRecording(mode, 'remote_command');
    else if (action === 'clear') clearProbe(mode);
    else if (action === 'enable_vad_record') await toggleVadRecordMode(mode, true);
    else if (action === 'disable_vad_record') await toggleVadRecordMode(mode, false);
    else if (action === 'toggle_vad_record') await toggleVadRecordMode(mode);
    else if (action === 'enable_vad_stop') await toggleVadStopMode(mode, true);
    else if (action === 'disable_vad_stop') await toggleVadStopMode(mode, false);
    else if (action === 'toggle_vad_stop') await toggleVadStopMode(mode);
    else setProbeStatus(mode, `Remote command ignored: ${action || 'blank'}.`);
    poll({ force: true });
  }

  function onVadDevCommandEvent(event) {
    const appEvent = event?.detail || {};
    if (appEvent.event_type !== DEV_COMMAND_EVENT_TYPE) return;
    void runVadDevCommand(appEvent.payload || {});
  }

  function automationSnapshot() {
    const mode = currentMode();
    return {
      surface: SURFACE,
      open: !!state.open,
      selected_mode: state.selectedMode,
      current_mode: mode,
      controls: controlsSnapshot(),
      modes: {
        [MODE_MANUAL]: probePublic(MODE_MANUAL),
        [MODE_VAD]: probePublic(MODE_VAD),
        [MODE_REARM]: probePublic(MODE_REARM),
      },
      snapshot: snapshotForMode(mode),
    };
  }

  function mountTimeline() {
    bind();
    if (state.timeline) {
      state.timeline.scheduleRender?.();
      return Promise.resolve(state.timeline);
    }
    if (state.timelinePromise) return state.timelinePromise;
    const module = window.BlueprintsVoiceTimelineModule;
    if (!els.timeline || typeof module?.create !== 'function') return Promise.resolve(null);
    state.timelinePromise = module.create(els.timeline)
      .then(view => {
        state.timeline = view;
        view?.clear?.();
        view?.scheduleRender?.();
        return view;
      })
      .finally(() => {
        state.timelinePromise = null;
      });
    return state.timelinePromise;
  }

  function start() {
    if (state.open) return;
    state.open = true;
    loadSharedControls().catch(error => status(error.message || String(error)));
    void mountTimeline().then(() => poll({ force: true }));
    state.pollTimer = window.setInterval(poll, POLL_MS);
    renderAllProbeUi();
    poll({ force: true });
  }

  function stop() {
    state.open = false;
    if (state.pollTimer) window.clearInterval(state.pollTimer);
    state.pollTimer = null;
    MODES.forEach(mode => {
      const target = probe(mode);
      if (target.enabled || target.ws) disableProbeMode(mode);
    });
  }

  function open() {
    bind();
    if (!els.modal) return false;
    renderSharedControls();
    if (window.HubModal?.open) {
      HubModal.open(els.modal, { onOpen: start, onClose: stop });
    } else if (typeof els.modal.showModal === 'function') {
      els.modal.showModal();
      start();
    }
    return true;
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    els.modal = el('vad-dev-modal');
    els.timeline = el('vad-dev-timeline-module');
    els.status = el('vad-dev-status');
    els.noiseToggle = el('vad-dev-noise-toggle');
    els.sileroToggle = el('vad-dev-silero-toggle');
    els.autoPreRollWrap = el('vad-dev-auto-pre-roll-wrap');
    els.autoPreRollToggle = el('vad-dev-auto-pre-roll-toggle');
    els.noiseLevel = el('vad-dev-noise-level');
    els.noiseLevelLabel = el('vad-dev-noise-level-label');
    els.aggregation = el('vad-dev-aggregation-timeout');
    els.aggregationLabel = el('vad-dev-aggregation-label');
    els.vadReset = el('vad-dev-vad-reset-timeout');
    els.vadResetLabel = el('vad-dev-vad-reset-label');
    els.noiseThresholdWrap = el('vad-dev-noise-threshold-wrap');
    els.noiseThreshold = el('vad-dev-noise-threshold');
    els.noiseThresholdLabel = el('vad-dev-noise-threshold-label');
    els.tabManual = el('vad-dev-test-tab-manual');
    els.tabVad = el('vad-dev-test-tab-vad');
    els.tabRearm = el('vad-dev-test-tab-rearm');
    els.testMode = el('vad-dev-test-mode');
    els.testRecord = el('vad-dev-test-record');
    els.testStop = el('vad-dev-test-stop');
    els.testClear = el('vad-dev-test-clear');
    els.testStatus = el('vad-dev-test-status');
    els.transcript = el('vad-dev-transcript');
    els.vadTestMode = el('vad-dev-vad-test-mode');
    els.vadRecordToggle = el('vad-dev-vad-test-record-vad');
    els.vadStopToggle = el('vad-dev-vad-test-stop-vad');
    els.vadTestRecord = el('vad-dev-vad-test-record');
    els.vadTestStop = el('vad-dev-vad-test-stop');
    els.vadTestClear = el('vad-dev-vad-test-clear');
    els.vadTestStatus = el('vad-dev-vad-test-status');
    els.vadTranscript = el('vad-dev-vad-transcript');
    els.rearmTestMode = el('vad-dev-rearm-test-mode');
    els.rearmRecordToggle = el('vad-dev-rearm-test-record-vad');
    els.rearmStopToggle = el('vad-dev-rearm-test-stop-vad');
    els.rearmTestRecord = el('vad-dev-rearm-test-record');
    els.rearmTestStop = el('vad-dev-rearm-test-stop');
    els.rearmTestClear = el('vad-dev-rearm-test-clear');
    els.rearmTestStatus = el('vad-dev-rearm-test-status');
    els.rearmTranscript = el('vad-dev-rearm-transcript');

    els.tabManual?.addEventListener('change', () => { if (els.tabManual.checked) { state.selectedMode = MODE_MANUAL; poll({ force: true }); } });
    els.tabVad?.addEventListener('change', () => { if (els.tabVad.checked) { state.selectedMode = MODE_VAD; poll({ force: true }); } });
    els.tabRearm?.addEventListener('change', () => { if (els.tabRearm.checked) { state.selectedMode = MODE_REARM; poll({ force: true }); } });
    els.testMode?.addEventListener('click', () => { if (probe(MODE_MANUAL).enabled) disableProbeMode(MODE_MANUAL); else void enableProbeMode(MODE_MANUAL); });
    els.testRecord?.addEventListener('click', () => { void startRecording(MODE_MANUAL); });
    els.testStop?.addEventListener('click', () => stopRecording(MODE_MANUAL));
    els.testClear?.addEventListener('click', () => clearProbe(MODE_MANUAL));
    els.vadTestMode?.addEventListener('click', () => { if (probe(MODE_VAD).enabled) disableProbeMode(MODE_VAD); else void enableProbeMode(MODE_VAD); });
    els.vadRecordToggle?.addEventListener('click', () => { void toggleVadRecordMode(MODE_VAD); });
    els.vadStopToggle?.addEventListener('click', () => { void toggleVadStopMode(MODE_VAD); });
    els.vadTestRecord?.addEventListener('click', () => { void startRecording(MODE_VAD, { reason: 'manual_record' }); });
    els.vadTestStop?.addEventListener('click', () => stopRecording(MODE_VAD, 'manual_stop'));
    els.vadTestClear?.addEventListener('click', () => clearProbe(MODE_VAD));
    els.rearmTestMode?.addEventListener('click', () => { if (probe(MODE_REARM).enabled) disableProbeMode(MODE_REARM); else void enableProbeMode(MODE_REARM); });
    els.rearmRecordToggle?.addEventListener('click', () => { void toggleVadRecordMode(MODE_REARM); });
    els.rearmStopToggle?.addEventListener('click', () => { void toggleVadStopMode(MODE_REARM); });
    els.rearmTestRecord?.addEventListener('click', () => { void startRecording(MODE_REARM, { reason: 'manual_record' }); });
    els.rearmTestStop?.addEventListener('click', () => stopRecording(MODE_REARM, 'manual_stop'));
    els.rearmTestClear?.addEventListener('click', () => clearProbe(MODE_REARM));
    els.noiseToggle?.addEventListener('change', () => {
      voiceMode()?.setSttNoiseReductionEnabled?.(els.noiseToggle.checked);
      renderSharedControls();
      poll({ force: true });
    });
    els.sileroToggle?.addEventListener('change', () => {
      void setSileroVadEnabled(els.sileroToggle.checked, { reason: 'ui_toggle' });
    });
    els.autoPreRollToggle?.addEventListener('change', () => {
      setAutoPreRollEnabled(els.autoPreRollToggle.checked, { reason: 'ui_toggle' });
    });
    els.noiseLevel?.addEventListener('input', () => {
      const level = Number(els.noiseLevel.value || 6);
      setText(els.noiseLevelLabel, `${level.toFixed(1)} dB`);
      voiceMode()?.setSttNoiseReductionLevelDb?.(level);
      poll({ force: true });
    });
    els.noiseThreshold?.addEventListener('input', () => {
      state.noiseThresholdDb = clampNoiseThresholdDb(els.noiseThreshold.value);
      renderRangeLabels();
      poll({ force: true });
    });
    els.aggregation?.addEventListener('input', renderRangeLabels);
    els.aggregation?.addEventListener('change', () => {
      voiceMode()?.saveAggregationTimeout?.(els.aggregation.value)
        ?.then(() => status('Speech aggregation saved.'))
        ?.catch(error => status(`Aggregation save failed: ${error.message || error}`));
      poll({ force: true });
    });
    els.vadReset?.addEventListener('input', () => {
      renderRangeLabels();
      poll({ force: true });
    });
    els.vadReset?.addEventListener('change', () => {
      voiceMode()?.saveVadResetTimeout?.(els.vadReset.value)
        ?.then(() => status('VAD reset timeout saved.'))
        ?.catch(error => status(`VAD reset save failed: ${error.message || error}`));
      poll({ force: true });
    });
    window.addEventListener('blueprints:voice-mode:changed', renderSharedControls);
    window.addEventListener('blueprints:voice-mode:stt-noise-changed', renderSharedControls);
    window.addEventListener('blueprints:voice-mode:wake-settings-changed', renderSharedControls);
    document.addEventListener('blueprints:event', onVadDevCommandEvent);
    els.modal?.addEventListener('close', stop);
    renderSharedControls();
    renderAllProbeUi();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }

  return {
    automationSnapshot,
    mountTimeline,
    open,
    start,
    stop,
    timeline: () => state.timeline,
  };
})();

window.VadDevModal = VadDevModal;
