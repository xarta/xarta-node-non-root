// wake-dev.js - diagnostic surface for the Wake-to-Talk FSM and queues.

'use strict';

const WakeDevModal = (() => {
  const DEBUG_URL = '/api/v1/voice-mode/wake-debug';
  const ROOMS_URL = '/api/v1/matrix-chat/rooms?server=tb1';
  const STT_WS_URL = '/api/v1/voice-mode/stt/ws';
  const SAMPLE_RATE = 16000;
  const AUDIO_BUFFER_SIZE = 4096;
  const WINDOW_MS = 10000;
  const POLL_MS = 500;
  const DRAW_MS = 250;
  const VAD_TEST_DELAY_FRAMES = 0;
  const VAD_TEST_ABSOLUTE_FLOOR = 0.0012;
  const VAD_TEST_STRONG_MULTIPLIER = 5;
  const VAD_TEST_EXIT_HANGOVER_MS = 180;
  const REARM_FINAL_TIMEOUT_MS = 2000;
  const REARM_OUTPUT_STATES = [
    'VAD_REARM_STT_OFF',
    'VAD_REARM_STT_READY',
    'VAD_REARM_STT_ARMED',
    'VAD_REARM_STT_OPENING',
    'VAD_REARM_STT_RECORDING',
    'VAD_REARM_STT_FINALIZING',
  ];

  const state = {
    open: false,
    pollTimer: null,
    apiTimer: null,
    drawTimer: null,
    saveTimer: null,
    samples: [],
    runtime: {},
    snapshot: null,
    apiDebug: null,
    apiAgeSeconds: null,
    lastLevel: 0,
    lastRenderAt: 0,
    settingsLoaded: false,
    timelinePaused: false,
    pausedAt: 0,
    pausedSamples: [],
    pausedSnapshot: null,
    probe: {
      enabled: false,
      recording: false,
      finalizing: false,
      ws: null,
      stream: null,
      audioContext: null,
      sourceNode: null,
      processorNode: null,
      startedAt: 0,
      bytesSent: 0,
      framesSent: 0,
      transcript: '',
      status: 'VAD bypass is off.',
      events: [],
      actions: [],
      restoreWakeOnDisable: false,
    },
    vadProbe: {
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
      status: 'VAD STT probe is off.',
      events: [],
      actions: [],
      restoreWakeOnDisable: false,
      delayFrames: [],
      pendingFrames: [],
      vad: {
        speaking: false,
        candidateActive: false,
        candidateConfirmed: false,
        speechSeenSinceReset: false,
        lastVoiceAt: 0,
        lastResetAt: 0,
        lastEnergy: 0,
        noiseFloor: 0,
        enterThreshold: 0,
        exitThreshold: 0,
        strongEnterThreshold: 0,
        lastAutoRecordAt: 0,
        lastAutoStopAt: 0,
      },
    },
    rearmProbe: {
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
      status: 'VAD ReArm STT probe is off.',
      events: [],
      actions: [],
      samples: [],
      lastLevel: 0,
      outputTouched: false,
      uiStateSignature: '',
      restoreWakeOnDisable: false,
      delayFrames: [],
      pendingFrames: [],
      vad: {
        speaking: false,
        candidateActive: false,
        candidateConfirmed: false,
        speechSeenSinceReset: false,
        lastVoiceAt: 0,
        lastResetAt: 0,
        lastEnergy: 0,
        noiseFloor: 0,
        enterThreshold: 0,
        exitThreshold: 0,
        strongEnterThreshold: 0,
        lastAutoRecordAt: 0,
        lastAutoStopAt: 0,
      },
    },
    outputView: null,
  };

  const els = {};

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

  function text(value, fallback = '--') {
    const out = String(value ?? '').trim();
    return out || fallback;
  }

  function setText(node, value, fallback = '--') {
    if (node) node.textContent = text(value, fallback);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDb(level) {
    const safe = Math.max(0.0001, Math.min(1, Number(level) || 0));
    return `${Math.max(-80, 20 * Math.log10(safe)).toFixed(1)} dB`;
  }

  function formatAge(seconds) {
    const n = Number(seconds);
    if (!Number.isFinite(n)) return '--';
    return n < 10 ? `${n.toFixed(1)}s` : `${Math.round(n)}s`;
  }

  function status(message) {
    setText(els.status, message, '');
  }

  function probeStatus(message) {
    state.probe.status = message || '';
    setText(els.testStatus, state.probe.status, '');
  }

  function vadProbeStatus(message) {
    state.vadProbe.status = message || '';
    setText(els.vadTestStatus, state.vadProbe.status, '');
  }

  function rearmProbeStatus(message) {
    state.rearmProbe.status = message || '';
    setText(els.rearmTestStatus, state.rearmProbe.status, '');
  }

  function voiceMode() {
    return window.BlueprintsVoiceMode || null;
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

  function firstServerId() {
    return localInstance().matrix_server || 'tb1';
  }

  function setWakeMode(enabled) {
    const vm = voiceMode();
    if (typeof vm?.setSttMode === 'function') {
      vm.setSttMode(enabled ? 'wake_to_talk' : '');
      return;
    }
    const toggle = el('voice-mode-stt-wake-toggle');
    if (toggle) {
      toggle.checked = !!enabled;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function toggleActive() {
    const vm = voiceMode();
    if (typeof vm?.toggleActive === 'function') {
      vm.toggleActive({ stt_mode: 'wake_to_talk' }).catch(error => status(error.message || String(error)));
      return;
    }
    el('voice-mode-activate-btn')?.click();
  }

  function renderControlState() {
    const vm = voiceMode();
    if (!vm) return;
    const wake = vm.sttMode?.() === 'wake_to_talk';
    const activeBrowser = vm.isActiveOwner?.() === true;
    if (els.wakeToggle) els.wakeToggle.checked = wake;
    if (els.noiseToggle) els.noiseToggle.checked = vm.sttNoiseReductionSettingEnabled?.() === true;
    const level = Number(vm.sttNoiseReductionLevelDb?.());
    if (Number.isFinite(level)) {
      if (els.noiseLevel) els.noiseLevel.value = String(level);
      setText(els.noiseLevelLabel, `${level.toFixed(1)} dB`);
    }
    setText(
      els.browserMeta,
      activeBrowser && wake
        ? 'This browser is activated and Wake to Talk is selected.'
        : (wake
          ? 'Wake to Talk is selected but this browser is not activated.'
          : (activeBrowser ? 'This browser is activated; Wake to Talk is not selected.' : 'Wake to Talk is not selected.'))
    );
    if (els.activate) els.activate.textContent = activeBrowser ? 'Deactivate' : 'Activate';
  }

  function localWakeSettings() {
    const settings = clone(voiceMode()?.getWakeSettings?.() || window.WakeToTalkState?.mergedConfig?.({}) || {});
    if (!settings.instances) settings.instances = {};
    if (!settings.instances.local) settings.instances.local = {};
    if (!settings.instances.local.commands) settings.instances.local.commands = {};
    return settings;
  }

  function localInstance() {
    return localWakeSettings().instances.local || {};
  }

  function setInputValue(node, value) {
    if (!node) return;
    node.value = value == null ? '' : String(value);
  }

  function renderRangeLabels() {
    setText(els.postWakeLabel, `${Number(els.postWake?.value || 0)} ms`);
    setText(els.initialCancelLabel, `${Number(els.initialCancel?.value || 0)} ms`);
    setText(els.pauseResetLabel, `${Number(els.pauseReset?.value || 0)}s`);
    const autoExecute = Number(els.autoExecute?.value || 0);
    setText(els.autoExecuteLabel, autoExecute > 0 ? `${autoExecute} ms` : 'Off');
    setText(els.aggregationLabel, `${Number(els.aggregation?.value || 80)} ms`);
    setText(els.vadResetLabel, formatVadResetTimeout(els.vadReset?.value));
    setText(els.silenceResetLabel, formatSilenceResetTimeout(els.silenceReset?.value));
  }

  function formatVadResetTimeout(ms) {
    const value = Math.max(0, Math.min(500, Math.round(Number(ms || 0) / 50) * 50));
    return value > 0 ? `${value} ms` : 'Off';
  }

  function formatSilenceResetTimeout(ms) {
    const value = Math.max(0, Math.min(3000, Math.round(Number(ms || 0) / 300) * 300));
    return value > 0 ? `${value} ms` : 'Off';
  }

  function renderWakeSettings(settings) {
    const instance = (settings || localWakeSettings()).instances?.local || {};
    setInputValue(els.wakeWord, instance.wake_word || 'Computer');
    setInputValue(els.postWake, Number(instance.post_wake_pause_ms ?? 500));
    setInputValue(els.initialCancel, Number(instance.initial_silence_cancel_ms ?? 1000));
    setInputValue(els.pauseReset, Number(instance.pause_reset_seconds ?? 30));
    setInputValue(els.autoExecute, Number(instance.auto_execute_silence_ms ?? 0));
    setInputValue(els.pauseCommand, instance.commands?.pause || 'pause-dictation');
    setInputValue(els.resumeCommand, instance.commands?.resume || 'resume-dictation');
    setInputValue(els.executeCommand, instance.commands?.execute || 'execute');
    setInputValue(els.cancelCommand, instance.commands?.cancel || 'cancel-dictation');
    renderRangeLabels();
  }

  async function loadRooms(currentRoomId = '') {
    if (!els.matrixRoom) return;
    try {
      const response = await api(ROOMS_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const joined = Array.isArray(payload.joined) ? payload.joined : [];
      els.matrixRoom.innerHTML = '';
      joined.forEach(room => {
        const option = document.createElement('option');
        option.value = room.room_id || '';
        option.textContent = room.name || room.room_id || 'Matrix room';
        els.matrixRoom.appendChild(option);
      });
      if (!joined.length) {
        const option = document.createElement('option');
        option.value = currentRoomId || '';
        option.textContent = currentRoomId ? 'Configured room' : 'No joined rooms';
        els.matrixRoom.appendChild(option);
      }
      els.matrixRoom.value = currentRoomId || joined[0]?.room_id || '';
    } catch (error) {
      els.matrixRoom.innerHTML = '';
      const option = document.createElement('option');
      option.value = currentRoomId || '';
      option.textContent = currentRoomId ? 'Configured room' : 'Rooms unavailable';
      els.matrixRoom.appendChild(option);
    }
  }

  async function loadControls() {
    const vm = voiceMode();
    renderControlState();
    try {
      const settings = await vm?.loadWakeSettings?.({ force: true });
      const clean = settings || localWakeSettings();
      renderWakeSettings(clean);
      await loadRooms(clean.instances?.local?.matrix_room_id || '');
      state.settingsLoaded = true;
    } catch (error) {
      renderWakeSettings(localWakeSettings());
      await loadRooms(localInstance().matrix_room_id || '');
      status(`Wake settings unavailable: ${error.message || error}`);
    }
    try {
      const agg = await vm?.loadAggregationTimeout?.({ force: true });
      const value = Number(agg?.aggregation_timeout_ms || agg?.stt?.speech_aggregation_timeout_ms || 80);
      if (Number.isFinite(value) && els.aggregation) els.aggregation.value = String(value);
      const vadReset = Number(vm?.vadResetTimeoutMs?.() ?? 300);
      if (Number.isFinite(vadReset) && els.vadReset) {
        els.vadReset.value = String(Math.max(0, Math.min(500, Math.round(vadReset / 50) * 50)));
      }
      const silenceReset = Number(vm?.silenceResetTimeoutMs?.() ?? 2100);
      if (Number.isFinite(silenceReset) && els.silenceReset) {
        els.silenceReset.value = String(Math.max(0, Math.min(3000, Math.round(silenceReset / 300) * 300)));
      }
      renderRangeLabels();
    } catch (_) {
      renderRangeLabels();
    }
  }

  function collectWakeSettings() {
    const next = localWakeSettings();
    const instance = next.instances.local;
    instance.enabled = true;
    instance.matrix_server = 'tb1';
    instance.matrix_room_id = els.matrixRoom?.value || '';
    instance.wake_word = els.wakeWord?.value || 'Computer';
    instance.post_wake_pause_ms = Number(els.postWake?.value || 500);
    instance.initial_silence_cancel_ms = Number(els.initialCancel?.value || 1000);
    instance.pause_reset_seconds = Number(els.pauseReset?.value || 30);
    instance.auto_execute_silence_ms = Number(els.autoExecute?.value || 0);
    instance.commands = {
      ...(instance.commands || {}),
      pause: els.pauseCommand?.value || 'pause-dictation',
      resume: els.resumeCommand?.value || 'resume-dictation',
      execute: els.executeCommand?.value || 'execute',
      cancel: els.cancelCommand?.value || 'cancel-dictation',
    };
    return next;
  }

  function scheduleWakeSave() {
    renderRangeLabels();
    if (state.saveTimer) window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(() => {
      state.saveTimer = null;
      const vm = voiceMode();
      if (typeof vm?.saveWakeSettings !== 'function') return;
      vm.saveWakeSettings(collectWakeSettings())
        .then(() => status('Wake Dev local settings saved.'))
        .catch(error => status(`Save failed: ${error.message || error}`));
    }, 450);
  }

  async function fetchApiDebug() {
    try {
      const response = await api(DEBUG_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      state.apiDebug = payload?.debug || null;
      state.apiAgeSeconds = payload?.age_seconds;
    } catch (_) {
      state.apiDebug = null;
      state.apiAgeSeconds = null;
    }
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

  function waitForSocketOpen(socket) {
    return new Promise((resolve, reject) => {
      if (socket.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('Manual STT connection timed out'));
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
        reject(new Error('Manual STT connection failed'));
      };
      socket.addEventListener('open', onOpen);
      socket.addEventListener('error', onError);
    });
  }

  function pushProbeAction(type, detail = {}) {
    state.probe.actions.push({
      at_ms: Date.now(),
      type,
      ...detail,
    });
    state.probe.actions = state.probe.actions.slice(-120);
  }

  function pushProbeEvent(type, textValue, detail = {}) {
    const clean = String(textValue || '').trim();
    state.probe.events.push({
      at_ms: Date.now(),
      type,
      text: clean,
      text_length: clean.length,
      audio_frames_sent: state.probe.framesSent,
      ...detail,
    });
    state.probe.events = state.probe.events.slice(-160);
  }

  function pushVadProbeAction(type, detail = {}) {
    state.vadProbe.actions.push({
      at_ms: Date.now(),
      type,
      ...detail,
    });
    state.vadProbe.actions = state.vadProbe.actions.slice(-120);
  }

  function pushVadProbeEvent(type, textValue, detail = {}) {
    const clean = String(textValue || '').trim();
    state.vadProbe.events.push({
      at_ms: Date.now(),
      type,
      text: clean,
      text_length: clean.length,
      audio_frames_sent: state.vadProbe.framesSent,
      ...detail,
    });
    state.vadProbe.events = state.vadProbe.events.slice(-160);
  }

  function touchRearmOutput() {
    state.rearmProbe.outputTouched = true;
  }

  function pushRearmProbeAction(type, detail = {}) {
    touchRearmOutput();
    state.rearmProbe.actions.push({
      at_ms: Date.now(),
      type,
      ...detail,
    });
    state.rearmProbe.actions = state.rearmProbe.actions.slice(-160);
  }

  function pushRearmProbeEvent(type, textValue, detail = {}) {
    const clean = String(textValue || '').trim();
    touchRearmOutput();
    state.rearmProbe.events.push({
      at_ms: Date.now(),
      type,
      text: clean,
      text_length: clean.length,
      audio_frames_sent: state.rearmProbe.framesSent,
      ...detail,
    });
    state.rearmProbe.events = state.rearmProbe.events.slice(-160);
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

  function mergeTranscriptProgress(previousValue, nextValue, phase = 'partial') {
    const previous = cleanSttTranscript(previousValue);
    const next = cleanSttTranscript(nextValue);
    if (!next) return previous;
    if (!previous) return next;
    const previousLower = previous.toLowerCase();
    const nextLower = next.toLowerCase();
    if (nextLower === previousLower) return previous;
    if (nextLower.startsWith(previousLower)) return next;
    if (previousLower.endsWith(nextLower) || previousLower.includes(nextLower)) return previous;
    if (phase === 'final' && previous.length > next.length * 1.25) return previous;

    const maxOverlap = Math.min(previous.length, next.length);
    for (let size = maxOverlap; size >= 8; size -= 1) {
      if (previousLower.slice(-size) === nextLower.slice(0, size)) {
        return cleanSttTranscript(`${previous}${next.slice(size)}`);
      }
    }

    const previousWords = previous.split(/\s+/);
    const nextWords = next.split(/\s+/);
    const wordOverlap = Math.min(previousWords.length, nextWords.length, 8);
    for (let size = wordOverlap; size >= 1; size -= 1) {
      const left = previousWords.slice(-size).join(' ').toLowerCase();
      const right = nextWords.slice(0, size).join(' ').toLowerCase();
      if (left === right) {
        return cleanSttTranscript([...previousWords, ...nextWords.slice(size)].join(' '));
      }
    }

    const sharedStart = previousWords[0]?.toLowerCase() && previousWords[0].toLowerCase() === nextWords[0]?.toLowerCase();
    if (sharedStart && next.length >= previous.length * 0.8) return next.length >= previous.length ? next : previous;
    return cleanSttTranscript(`${previous} ${next}`);
  }

  function buttonSnapshot(control, node) {
    if (!node) return null;
    return {
      control,
      text: node.textContent || control,
      disabled: !!node.disabled,
      pressed: node.getAttribute('aria-pressed') === 'true',
    };
  }

  function rearmButtonLabel(item) {
    const stateText = [
      item.pressed ? 'pressed' : 'unpressed',
      item.disabled ? 'disabled' : 'enabled',
    ].join(', ');
    return `${item.control}: ${stateText}`;
  }

  function recordRearmButtonStates(items) {
    if (!state.rearmProbe.outputTouched) return;
    const list = items.filter(Boolean);
    const signature = JSON.stringify(list.map(item => [item.control, item.disabled, item.pressed, item.text]));
    if (signature === state.rearmProbe.uiStateSignature) return;
    state.rearmProbe.uiStateSignature = signature;
    list.forEach(item => {
      pushRearmProbeAction('controlState', {
        control: item.control,
        label: rearmButtonLabel(item),
        button_text: item.text,
        disabled: item.disabled,
        pressed: item.pressed,
      });
    });
  }

  function renderProbeUi() {
    if (els.testMode) {
      els.testMode.setAttribute('aria-pressed', state.probe.enabled ? 'true' : 'false');
      els.testMode.textContent = state.probe.enabled ? 'Disable test mode' : 'Enable test mode';
    }
    if (els.testRecord) els.testRecord.disabled = !state.probe.enabled || state.probe.recording || state.probe.finalizing;
    if (els.testStop) els.testStop.disabled = !state.probe.recording;
    if (els.testClear) els.testClear.disabled = state.probe.recording || state.probe.finalizing;
    probeStatus(state.probe.status);
  }

  function renderVadProbeUi() {
    if (els.vadTestMode) {
      els.vadTestMode.setAttribute('aria-pressed', state.vadProbe.enabled ? 'true' : 'false');
      els.vadTestMode.textContent = state.vadProbe.enabled ? 'Disable test mode' : 'Enable test mode';
    }
    if (els.vadRecordToggle) {
      els.vadRecordToggle.disabled = !state.vadProbe.enabled || state.vadProbe.finalizing;
      els.vadRecordToggle.setAttribute('aria-pressed', state.vadProbe.vadRecordEnabled ? 'true' : 'false');
      els.vadRecordToggle.textContent = state.vadProbe.recording
        ? 'VAD Recording'
        : (state.vadProbe.starting ? 'VAD Opening' : (state.vadProbe.vadRecordEnabled ? 'VAD Record Armed' : 'Enable VAD Record'));
    }
    if (els.vadStopToggle) {
      els.vadStopToggle.disabled = !state.vadProbe.enabled || state.vadProbe.finalizing;
      els.vadStopToggle.setAttribute('aria-pressed', state.vadProbe.vadStopEnabled ? 'true' : 'false');
      els.vadStopToggle.textContent = state.vadProbe.vadStopEnabled ? 'VAD Stop Armed' : 'Enable VAD Stop';
    }
    if (els.vadTestRecord) els.vadTestRecord.disabled = !state.vadProbe.enabled || state.vadProbe.vadRecordEnabled || state.vadProbe.recording || state.vadProbe.finalizing || state.vadProbe.starting;
    if (els.vadTestStop) els.vadTestStop.disabled = !state.vadProbe.recording && !state.vadProbe.starting && !state.vadProbe.vadRecordEnabled;
    if (els.vadTestClear) els.vadTestClear.disabled = state.vadProbe.recording || state.vadProbe.finalizing || state.vadProbe.starting;
    vadProbeStatus(state.vadProbe.status);
    if (els.vadTranscript) els.vadTranscript.textContent = state.vadProbe.transcript || '';
  }

  function renderRearmProbeUi() {
    if (els.rearmTestMode) {
      els.rearmTestMode.setAttribute('aria-pressed', state.rearmProbe.enabled ? 'true' : 'false');
      els.rearmTestMode.textContent = state.rearmProbe.enabled ? 'Disable test mode' : 'Enable test mode';
    }
    if (els.rearmRecordToggle) {
      els.rearmRecordToggle.disabled = !state.rearmProbe.enabled || state.rearmProbe.finalizing;
      els.rearmRecordToggle.setAttribute('aria-pressed', state.rearmProbe.vadRecordEnabled ? 'true' : 'false');
      els.rearmRecordToggle.textContent = state.rearmProbe.recording
        ? 'VAD Recording'
        : (state.rearmProbe.starting ? 'VAD Opening' : (state.rearmProbe.vadRecordEnabled ? 'VAD Record Armed' : 'Enable VAD Record'));
    }
    if (els.rearmStopToggle) {
      els.rearmStopToggle.disabled = !state.rearmProbe.enabled || state.rearmProbe.finalizing;
      els.rearmStopToggle.setAttribute('aria-pressed', state.rearmProbe.vadStopEnabled ? 'true' : 'false');
      els.rearmStopToggle.textContent = state.rearmProbe.vadStopEnabled ? 'VAD Stop Armed' : 'Enable VAD Stop';
    }
    if (els.rearmTestRecord) els.rearmTestRecord.disabled = !state.rearmProbe.enabled || state.rearmProbe.vadRecordEnabled || state.rearmProbe.recording || state.rearmProbe.finalizing || state.rearmProbe.starting;
    if (els.rearmTestStop) els.rearmTestStop.disabled = !state.rearmProbe.recording && !state.rearmProbe.starting && !state.rearmProbe.vadRecordEnabled;
    if (els.rearmTestClear) els.rearmTestClear.disabled = state.rearmProbe.recording || state.rearmProbe.finalizing || state.rearmProbe.starting;
    rearmProbeStatus(state.rearmProbe.status);
    if (els.rearmTranscript) els.rearmTranscript.textContent = state.rearmProbe.transcript || '';
    recordRearmButtonStates([
      buttonSnapshot('Enable test mode', els.rearmTestMode),
      buttonSnapshot('Enable VAD Record', els.rearmRecordToggle),
      buttonSnapshot('Enable VAD Stop', els.rearmStopToggle),
      buttonSnapshot('Record', els.rearmTestRecord),
      buttonSnapshot('Stop', els.rearmTestStop),
      buttonSnapshot('Clear', els.rearmTestClear),
    ]);
    renderRearmOutput();
  }

  function addProbeSample(features) {
    state.lastLevel = Math.max(0, Math.min(1, Number(features.level) || 0));
    if (state.timelinePaused) return;
    const now = Date.now();
    state.samples.push({
      at: now,
      level: state.lastLevel,
      rms: Math.max(0, Number(features.rms) || 0),
      peak: Math.max(0, Number(features.peak) || 0),
      vad_energy: 0,
      fsm_state: state.probe.recording ? 'MANUAL_STT_RECORDING' : 'MANUAL_STT_READY',
    });
    state.samples = state.samples.filter(sample => sample.at >= now - WINDOW_MS - 1000);
  }

  function addVadProbeSample(features) {
    state.lastLevel = Math.max(0, Math.min(1, Number(features.level) || 0));
    if (state.timelinePaused) return;
    const now = Date.now();
    state.samples.push({
      at: now,
      level: state.lastLevel,
      rms: Math.max(0, Number(features.rms) || 0),
      peak: Math.max(0, Number(features.peak) || 0),
      vad_energy: Math.max(0, Number(features.vadEnergy) || 0),
      fsm_state: state.vadProbe.recording
        ? 'VAD_STT_RECORDING'
        : (state.vadProbe.vadRecordEnabled || state.vadProbe.vadStopEnabled ? 'VAD_STT_ARMED' : 'VAD_STT_READY'),
    });
    state.samples = state.samples.filter(sample => sample.at >= now - WINDOW_MS - 1000);
  }

  function addRearmProbeSample(features) {
    const level = Math.max(0, Math.min(1, Number(features.level) || 0));
    state.rearmProbe.lastLevel = level;
    touchRearmOutput();
    const now = Date.now();
    state.rearmProbe.samples.push({
      at: now,
      level,
      rms: Math.max(0, Number(features.rms) || 0),
      peak: Math.max(0, Number(features.peak) || 0),
      vad_energy: Math.max(0, Number(features.vadEnergy) || 0),
      fsm_state: state.rearmProbe.recording
        ? 'VAD_REARM_STT_RECORDING'
        : (state.rearmProbe.vadRecordEnabled || state.rearmProbe.vadStopEnabled ? 'VAD_REARM_STT_ARMED' : 'VAD_REARM_STT_READY'),
    });
    state.rearmProbe.samples = state.rearmProbe.samples.filter(sample => sample.at >= now - WINDOW_MS - 1000);
  }

  function closeProbeSocket() {
    if (state.probe.ws) {
      try { state.probe.ws.close(); } catch (_) {}
      state.probe.ws = null;
    }
  }

  function closeVadProbeSocket() {
    if (state.vadProbe.ws) {
      try { state.vadProbe.ws.close(); } catch (_) {}
      state.vadProbe.ws = null;
    }
  }

  function closeRearmProbeSocket() {
    if (state.rearmProbe.ws) {
      try { state.rearmProbe.ws.close(); } catch (_) {}
      state.rearmProbe.ws = null;
    }
  }

  function cleanupProbeAudio() {
    if (state.probe.processorNode) {
      try { state.probe.processorNode.disconnect(); } catch (_) {}
      state.probe.processorNode.onaudioprocess = null;
      state.probe.processorNode = null;
    }
    if (state.probe.sourceNode) {
      try { state.probe.sourceNode.disconnect(); } catch (_) {}
      state.probe.sourceNode = null;
    }
    if (state.probe.audioContext) {
      try { void state.probe.audioContext.close(); } catch (_) {}
      state.probe.audioContext = null;
    }
    if (state.probe.stream) {
      state.probe.stream.getTracks().forEach(track => track.stop());
      state.probe.stream = null;
    }
  }

  function cleanupVadProbeAudio() {
    if (state.vadProbe.processorNode) {
      try { state.vadProbe.processorNode.disconnect(); } catch (_) {}
      state.vadProbe.processorNode.onaudioprocess = null;
      state.vadProbe.processorNode = null;
    }
    if (state.vadProbe.sourceNode) {
      try { state.vadProbe.sourceNode.disconnect(); } catch (_) {}
      state.vadProbe.sourceNode = null;
    }
    if (state.vadProbe.audioContext) {
      try { void state.vadProbe.audioContext.close(); } catch (_) {}
      state.vadProbe.audioContext = null;
    }
    if (state.vadProbe.stream) {
      state.vadProbe.stream.getTracks().forEach(track => track.stop());
      state.vadProbe.stream = null;
    }
  }

  function cleanupRearmProbeAudio() {
    if (state.rearmProbe.processorNode) {
      try { state.rearmProbe.processorNode.disconnect(); } catch (_) {}
      state.rearmProbe.processorNode.onaudioprocess = null;
      state.rearmProbe.processorNode = null;
    }
    if (state.rearmProbe.sourceNode) {
      try { state.rearmProbe.sourceNode.disconnect(); } catch (_) {}
      state.rearmProbe.sourceNode = null;
    }
    if (state.rearmProbe.audioContext) {
      try { void state.rearmProbe.audioContext.close(); } catch (_) {}
      state.rearmProbe.audioContext = null;
    }
    if (state.rearmProbe.stream) {
      state.rearmProbe.stream.getTracks().forEach(track => track.stop());
      state.rearmProbe.stream = null;
    }
  }

  function restoreWakeController() {
    const sync = window.WakeToTalkController?.sync;
    if (typeof sync === 'function') sync().catch(() => {});
  }

  function manualSnapshot() {
    const now = Date.now();
    const fsm = state.probe.recording
      ? 'MANUAL_STT_RECORDING'
      : (state.probe.finalizing ? 'MANUAL_STT_FINALIZING' : 'MANUAL_STT_READY');
    return {
      fsm_state: state.probe.enabled ? fsm : 'MANUAL_STT_OFF',
      reason: state.probe.enabled ? 'VAD bypass manual STT probe.' : 'Manual STT probe is off.',
      session_id: state.probe.enabled ? 'manual-probe' : '',
      active_instance_id: 'voice-mode-stt',
      audio_frames_sent: state.probe.framesSent,
      transcript: state.probe.transcript,
      recent_stt_events: state.probe.events,
      recent_actions: state.probe.actions,
      vad_speech_start_reset_armed: false,
      vad: {
        speaking: !!state.probe.recording,
        speech_seen_since_reset: !!state.probe.recording,
        last_voice_age_ms: state.probe.recording ? Math.max(0, now - (state.probe.startedAt || now)) : null,
        silence_age_ms: state.probe.recording ? 0 : null,
        reset_timeout_ms: 0,
        silence_reset_timeout_ms: 0,
      },
      queues: {
        raw_input_queue: [],
        pending_command_items: [],
        message_queue: [],
      },
      active_send: {
        route: STT_WS_URL,
        vad: 'bypassed',
        recording: state.probe.recording,
        finalizing: state.probe.finalizing,
        bytes_sent: state.probe.bytesSent,
        frames_sent: state.probe.framesSent,
      },
    };
  }

  function vadProbeResetTimeoutMs() {
    const fromControl = Number(els.vadReset?.value || 0);
    return Number.isFinite(fromControl) ? Math.max(0, fromControl) : 0;
  }

  function resetVadProbeVad(now = Date.now()) {
    const vad = state.vadProbe.vad;
    vad.speaking = false;
    vad.candidateActive = false;
    vad.candidateConfirmed = false;
    vad.speechSeenSinceReset = false;
    vad.lastVoiceAt = 0;
    vad.lastResetAt = now;
    vad.lastEnergy = 0;
  }

  function updateVadProbe(features, now = Date.now()) {
    const vad = state.vadProbe.vad;
    const energy = Number(features?.vadEnergy || 0);
    if (!vad.noiseFloor) {
      vad.noiseFloor = Math.max(0.0005, Math.min(0.02, energy || 0.002));
    }
    const enterThreshold = Math.max(VAD_TEST_ABSOLUTE_FLOOR, (vad.noiseFloor * 4.0) + 0.00045);
    const exitThreshold = Math.max(VAD_TEST_ABSOLUTE_FLOOR * 0.65, (vad.noiseFloor * 2.2) + 0.00025);
    const strongEnterThreshold = enterThreshold * VAD_TEST_STRONG_MULTIPLIER;
    const level = Number(features?.level || 0);
    const speechNow = energy >= enterThreshold || level >= 0.035;
    const strongSpeechNow = energy >= strongEnterThreshold || level >= (0.035 * VAD_TEST_STRONG_MULTIPLIER);
    const speechStarted = speechNow && !vad.speaking;
    vad.lastEnergy = energy;
    vad.enterThreshold = enterThreshold;
    vad.exitThreshold = exitThreshold;
    vad.strongEnterThreshold = strongEnterThreshold;

    if (speechNow) {
      vad.speaking = true;
      vad.speechSeenSinceReset = true;
      vad.lastVoiceAt = now;
    } else if (vad.speaking && now - vad.lastVoiceAt > VAD_TEST_EXIT_HANGOVER_MS) {
      vad.speaking = false;
    }
    if (!vad.speaking && energy < exitThreshold) {
      vad.noiseFloor = (vad.noiseFloor * 0.985) + (energy * 0.015);
    }
    if (speechStarted) {
      vad.candidateActive = true;
      vad.candidateConfirmed = false;
      pushVadProbeAction('vadCandidateStart', {
        audio_frame: state.vadProbe.framesSent,
        delay_frames: VAD_TEST_DELAY_FRAMES,
      });
      if (state.vadProbe.vadRecordEnabled && !state.vadProbe.recording && !state.vadProbe.finalizing && !state.vadProbe.starting) {
        vadProbeStatus('VAD Record triggered; opening STT.');
        void startVadProbeRecording({ reason: 'vad_record' });
      }
    }
    if (vad.candidateActive && !vad.candidateConfirmed && strongSpeechNow) {
      vad.candidateConfirmed = true;
      pushVadProbeAction('vadCandidateConfirmed', {
        start_threshold: 'strong_confirmed',
        strong_multiplier: VAD_TEST_STRONG_MULTIPLIER,
      });
    }
    const timeoutMs = vadProbeResetTimeoutMs();
    if (
      state.vadProbe.vadStopEnabled
      && state.vadProbe.recording
      && timeoutMs > 0
      && vad.speechSeenSinceReset
      && !vad.speaking
      && vad.lastVoiceAt
      && now - vad.lastVoiceAt >= timeoutMs
      && now - vad.lastResetAt > 250
    ) {
      vad.lastAutoStopAt = now;
      stopVadProbeRecording('vad_stop');
    }
  }

  function vadProbeSnapshot() {
    const now = Date.now();
    const fsm = state.vadProbe.recording
      ? 'VAD_STT_RECORDING'
      : (state.vadProbe.finalizing ? 'VAD_STT_FINALIZING' : (state.vadProbe.starting ? 'VAD_STT_OPENING' : 'VAD_STT_READY'));
    const vad = state.vadProbe.vad;
    return {
      fsm_state: state.vadProbe.enabled ? fsm : 'VAD_STT_OFF',
      reason: state.vadProbe.enabled ? 'Isolated VAD STT probe; live Wake VAD bypassed.' : 'VAD STT probe is off.',
      session_id: state.vadProbe.enabled ? 'vad-probe' : '',
      active_instance_id: 'voice-mode-stt',
      audio_frames_sent: state.vadProbe.framesSent,
      transcript: state.vadProbe.transcript,
      recent_stt_events: state.vadProbe.events,
      recent_actions: state.vadProbe.actions,
      vad_speech_start_reset_armed: !!state.vadProbe.vadRecordEnabled,
      vad: {
        speaking: !!vad.speaking,
        candidate_active: !!vad.candidateActive,
        candidate_confirmed: !!vad.candidateConfirmed,
        speech_seen_since_reset: !!vad.speechSeenSinceReset,
        last_voice_age_ms: vad.lastVoiceAt ? Math.max(0, now - vad.lastVoiceAt) : null,
        silence_age_ms: vad.speaking ? 0 : (vad.lastVoiceAt ? Math.max(0, now - vad.lastVoiceAt) : null),
        reset_timeout_ms: vadProbeResetTimeoutMs(),
        noise_floor: Number(vad.noiseFloor || 0),
        enter_threshold: Number(vad.enterThreshold || 0),
        exit_threshold: Number(vad.exitThreshold || 0),
        strong_enter_threshold: Number(vad.strongEnterThreshold || 0),
        energy: Number(vad.lastEnergy || 0),
      },
      queues: {
        raw_input_queue: [],
        pending_command_items: [],
        message_queue: [],
      },
      active_send: {
        route: STT_WS_URL,
        vad: 'isolated-test',
        vad_record_enabled: !!state.vadProbe.vadRecordEnabled,
        vad_stop_enabled: !!state.vadProbe.vadStopEnabled,
        recording: state.vadProbe.recording,
        finalizing: state.vadProbe.finalizing,
        bytes_sent: state.vadProbe.bytesSent,
        frames_sent: state.vadProbe.framesSent,
      },
    };
  }

  function rearmProbeResetTimeoutMs() {
    return vadProbeResetTimeoutMs();
  }

  function resetRearmProbeVad(now = Date.now()) {
    const vad = state.rearmProbe.vad;
    vad.speaking = false;
    vad.candidateActive = false;
    vad.candidateConfirmed = false;
    vad.speechSeenSinceReset = false;
    vad.lastVoiceAt = 0;
    vad.lastResetAt = now;
    vad.lastEnergy = 0;
  }

  function updateRearmProbe(features, now = Date.now()) {
    const vad = state.rearmProbe.vad;
    const energy = Number(features?.vadEnergy || 0);
    if (!vad.noiseFloor) {
      vad.noiseFloor = Math.max(0.0005, Math.min(0.02, energy || 0.002));
    }
    const enterThreshold = Math.max(VAD_TEST_ABSOLUTE_FLOOR, (vad.noiseFloor * 4.0) + 0.00045);
    const exitThreshold = Math.max(VAD_TEST_ABSOLUTE_FLOOR * 0.65, (vad.noiseFloor * 2.2) + 0.00025);
    const strongEnterThreshold = enterThreshold * VAD_TEST_STRONG_MULTIPLIER;
    const level = Number(features?.level || 0);
    const speechNow = energy >= enterThreshold || level >= 0.035;
    const strongSpeechNow = energy >= strongEnterThreshold || level >= (0.035 * VAD_TEST_STRONG_MULTIPLIER);
    const speechStarted = speechNow && !vad.speaking;
    vad.lastEnergy = energy;
    vad.enterThreshold = enterThreshold;
    vad.exitThreshold = exitThreshold;
    vad.strongEnterThreshold = strongEnterThreshold;

    if (speechNow) {
      vad.speaking = true;
      vad.speechSeenSinceReset = true;
      vad.lastVoiceAt = now;
    } else if (vad.speaking && now - vad.lastVoiceAt > VAD_TEST_EXIT_HANGOVER_MS) {
      vad.speaking = false;
    }
    if (!vad.speaking && energy < exitThreshold) {
      vad.noiseFloor = (vad.noiseFloor * 0.985) + (energy * 0.015);
    }
    if (speechStarted) {
      vad.candidateActive = true;
      vad.candidateConfirmed = false;
      pushRearmProbeAction('vadCandidateStart', {
        audio_frame: state.rearmProbe.framesSent,
        delay_frames: VAD_TEST_DELAY_FRAMES,
      });
      if (state.rearmProbe.vadRecordEnabled && !state.rearmProbe.recording && !state.rearmProbe.finalizing && !state.rearmProbe.starting) {
        rearmProbeStatus('VAD Record triggered; opening STT.');
        void startRearmProbeRecording({ reason: 'vad_record' });
      }
    }
    if (vad.candidateActive && !vad.candidateConfirmed && strongSpeechNow) {
      vad.candidateConfirmed = true;
      pushRearmProbeAction('vadCandidateConfirmed', {
        start_threshold: 'strong_confirmed',
        strong_multiplier: VAD_TEST_STRONG_MULTIPLIER,
      });
    }
    const timeoutMs = rearmProbeResetTimeoutMs();
    if (
      state.rearmProbe.vadStopEnabled
      && state.rearmProbe.recording
      && timeoutMs > 0
      && vad.speechSeenSinceReset
      && !vad.speaking
      && vad.lastVoiceAt
      && now - vad.lastVoiceAt >= timeoutMs
      && now - vad.lastResetAt > 250
    ) {
      vad.lastAutoStopAt = now;
      stopRearmProbeRecording('vad_stop');
    }
  }

  function rearmProbeFsm() {
    if (!state.rearmProbe.enabled) return 'VAD_REARM_STT_OFF';
    if (state.rearmProbe.recording) return 'VAD_REARM_STT_RECORDING';
    if (state.rearmProbe.finalizing) return 'VAD_REARM_STT_FINALIZING';
    if (state.rearmProbe.starting) return 'VAD_REARM_STT_OPENING';
    if (state.rearmProbe.vadRecordEnabled || state.rearmProbe.vadStopEnabled) return 'VAD_REARM_STT_ARMED';
    return 'VAD_REARM_STT_READY';
  }

  function rearmMarkerColor(action) {
    if (action?.type === 'controlState') {
      if (action.disabled) return 'rgba(148,168,179,0.72)';
      return action.pressed ? '#38bdf8' : '#aebfca';
    }
    if (action?.type === 'rearmProbeRecordStart' || action?.type === 'rearmProbeFinal' || action?.type === 'vadCandidateConfirmed') return '#22c55e';
    if (action?.type === 'rearmProbeRecordStop' || action?.type === 'vadStopMode') return '#fbbf24';
    if (action?.type === 'vadRecordMode' || action?.type === 'rearmTestMode' || action?.type === 'vadCandidateStart') return '#38bdf8';
    if (action?.type === 'rearmProbeError') return '#f87171';
    return '#aebfca';
  }

  function rearmActionLabel(action) {
    if (!action || typeof action !== 'object') return '';
    if (action.type === 'controlState') return action.label || action.control || 'control';
    if (action.type === 'rearmTestMode') return `test ${action.reason || ''}`.trim();
    if (action.type === 'vadRecordMode') return `VAD Record ${action.enabled ? 'on' : 'off'}`;
    if (action.type === 'vadStopMode') return `VAD Stop ${action.enabled ? 'on' : 'off'}`;
    if (action.type === 'vadCandidateStart') return 'VAD candidate';
    if (action.type === 'vadCandidateConfirmed') return 'VAD strong';
    if (action.type === 'rearmProbeRecordStart') return `Record ${action.reason || 'start'}`;
    if (action.type === 'rearmProbeRecordStop') return `Stop ${action.reason || 'stop'}`;
    if (action.type === 'rearmProbeFinal') return 'final transcript';
    if (action.type === 'rearmProbeError') return `error ${action.error || ''}`.trim();
    return action.type || 'event';
  }

  function ensureOutputView() {
    if (state.outputView) return state.outputView;
    const module = window.BlueprintsWakeDevOutputView;
    if (typeof module?.mountDocument === 'function') {
      state.outputView = module.mountDocument(document);
    } else if (typeof module?.createOutputView === 'function' && els.outputView) {
      state.outputView = module.createOutputView(els.outputView);
    }
    return state.outputView;
  }

  function rearmTranscriptSpan(now = Date.now()) {
    const textEvents = state.rearmProbe.events
      .filter(evt => (evt.type === 'partial' || evt.type === 'final') && String(evt.display_text || evt.text || '').trim());
    if (!textEvents.length) return null;
    const first = textEvents.find(evt => evt.type === 'partial') || textEvents[0];
    const finalEvent = textEvents.find(evt => evt.type === 'final');
    const latest = textEvents[textEvents.length - 1];
    const stopAction = [...state.rearmProbe.actions].reverse()
      .find(action => action.type === 'rearmProbeRecordStop');
    let statusValue = 'partial';
    let endAt = now;
    if (finalEvent) {
      statusValue = 'final';
      endAt = Number(finalEvent.at_ms || now);
    } else if (stopAction?.at_ms && now - Number(stopAction.at_ms) >= REARM_FINAL_TIMEOUT_MS) {
      statusValue = 'timeout';
      endAt = Number(stopAction.at_ms) + REARM_FINAL_TIMEOUT_MS;
    }
    const color = statusValue === 'final' ? '#22c55e' : (statusValue === 'timeout' ? '#f87171' : '#38bdf8');
    return {
      atMs: Number(first.at_ms || now),
      endMs: Math.max(Number(first.at_ms || now) + 80, endAt),
      text: latest.display_text || state.rearmProbe.transcript || latest.text || '',
      status: statusValue,
      color,
      background: statusValue === 'final'
        ? 'rgba(5,46,22,0.97)'
        : (statusValue === 'timeout' ? 'rgba(69,10,10,0.97)' : 'rgba(7,24,39,0.97)'),
      border: statusValue === 'final'
        ? 'rgba(74,222,128,0.86)'
        : (statusValue === 'timeout' ? 'rgba(248,113,113,0.86)' : 'rgba(56,189,248,0.82)'),
      timeoutSource: stopAction?.reason === 'vad_stop' ? 'VAD Stop' : 'Stop',
    };
  }

  function rearmOutputSnapshot() {
    const now = Date.now();
    const start = now - WINDOW_MS;
    const fsm = rearmProbeFsm();
    const transcriptSpan = rearmTranscriptSpan(now);
    const vad = state.rearmProbe.vad || {};
    const vadEnabled = !!(state.rearmProbe.vadRecordEnabled || state.rearmProbe.vadStopEnabled);
    const vadSpeech = !!vad.speaking;
    const vadStage = vad.candidateConfirmed ? 'strong' : (vad.candidateActive ? 'candidate' : 'idle');
    const statusBackground = vadEnabled ? (vadSpeech ? 'rgba(21,128,61,0.34)' : 'rgba(7,24,39,0.94)') : 'rgba(16,24,38,0.9)';
    const statusBorder = vadEnabled ? (vadSpeech ? 'rgba(34,197,94,0.7)' : 'rgba(56,189,248,0.58)') : 'rgba(148,168,179,0.42)';
    return {
      metrics: [
        { label: 'FSM', value: fsm },
        { label: 'Session', value: state.rearmProbe.enabled ? 'vad-rearm-probe' : '--' },
        { label: 'Instance', value: 'voice-mode-stt' },
        { label: 'Frames', value: String(state.rearmProbe.framesSent || 0) },
        { label: 'Debug age', value: 'live' },
        { label: 'Level', value: formatDb(state.rearmProbe.lastLevel || 0) },
      ],
      source: `VAD ReArm STT probe | ${STT_WS_URL} | ${state.rearmProbe.status || 'ready'}`,
      activeState: fsm,
      states: REARM_OUTPUT_STATES,
      transcript: state.rearmProbe.transcript || '',
      timeline: {
        startMs: start,
        endMs: now,
        samples: state.rearmProbe.samples,
        markers: [
          ...state.rearmProbe.actions.map((action, index) => ({
            atMs: action.at_ms,
            label: rearmActionLabel(action),
            color: rearmMarkerColor(action),
            lane: index % 4,
          })),
          ...(transcriptSpan?.status === 'timeout' ? [{
            atMs: transcriptSpan.endMs,
            label: `${transcriptSpan.timeoutSource || 'Stop'} final timeout`,
            color: '#f87171',
            lane: 0,
          }] : []),
        ],
        text: [],
        transcriptSpan,
        statuses: [
          {
            label: `VAD ${vadEnabled ? 'enabled' : 'off'} | ${vadSpeech ? 'speech' : 'quiet'} | ${vadStage} | record ${state.rearmProbe.vadRecordEnabled ? 'on' : 'off'} | stop ${state.rearmProbe.vadStopEnabled ? 'on' : 'off'}`,
            background: statusBackground,
            border: statusBorder,
            color: '#f1f7fa',
            maxWidth: 420,
          },
          {
            label: `STT ${state.rearmProbe.recording ? 'recording' : (state.rearmProbe.finalizing ? 'finalizing' : (state.rearmProbe.starting ? 'opening' : 'idle'))} | ${state.rearmProbe.bytesSent || 0} bytes`,
            background: state.rearmProbe.recording ? 'rgba(5,46,22,0.9)' : 'rgba(16,24,38,0.9)',
            border: state.rearmProbe.recording ? 'rgba(74,222,128,0.72)' : 'rgba(91,156,246,0.42)',
            color: '#f1f7fa',
            maxWidth: 280,
          },
        ],
        startLabel: '10s',
        endLabel: 'now',
      },
    };
  }

  function renderRearmOutput() {
    if (!state.rearmProbe.outputTouched) return;
    ensureOutputView()?.setSnapshot(rearmOutputSnapshot());
  }

  function currentSnapshot() {
    if (state.probe.enabled) {
      return { snapshot: manualSnapshot(), source: 'manual STT probe' };
    }
    if (state.vadProbe.enabled) {
      return { snapshot: vadProbeSnapshot(), source: 'VAD STT probe' };
    }
    const local = window.WakeToTalkController?.getDebugSnapshot?.();
    if (local) {
      return { snapshot: local, source: 'local controller' };
    }
    if (state.apiDebug) return { snapshot: state.apiDebug, source: 'wake-debug API' };
    return { snapshot: {}, source: 'waiting' };
  }

  async function handleProbeMessage(event) {
    let payload = {};
    try {
      payload = JSON.parse(event.data || '{}');
    } catch (_) {
      return;
    }
    if (payload.type === 'partial') {
      const value = String(payload.text || '').trim();
      pushProbeEvent('partial', value, { detail: value ? '' : 'empty partial' });
      if (value) state.probe.transcript = value;
      poll();
      drawWaveform();
      return;
    }
    if (payload.type === 'final') {
      const value = String(payload.text || state.probe.transcript || '').trim();
      state.probe.transcript = value;
      pushProbeEvent('final', value, { detail: 'manual stop final' });
      pushProbeAction('manualFinal', { text: value });
      state.probe.recording = false;
      state.probe.finalizing = false;
      closeProbeSocket();
      probeStatus(value ? 'Transcript ready.' : 'No transcript returned.');
      renderProbeUi();
      poll();
      drawWaveform();
      return;
    }
    if (payload.type === 'error') {
      const detail = payload.detail || 'unknown error';
      pushProbeEvent('error', '', { detail });
      pushProbeAction('manualError', { error: detail });
      state.probe.recording = false;
      state.probe.finalizing = false;
      closeProbeSocket();
      probeStatus(`STT failed: ${detail}`);
      renderProbeUi();
      poll();
      drawWaveform();
    }
  }

  async function handleVadProbeMessage(event) {
    let payload = {};
    try {
      payload = JSON.parse(event.data || '{}');
    } catch (_) {
      return;
    }
    if (payload.type === 'partial') {
      const value = String(payload.text || '').trim();
      pushVadProbeEvent('partial', value, { detail: value ? '' : 'empty partial' });
      if (value) state.vadProbe.transcript = value;
      renderVadProbeUi();
      poll();
      drawWaveform();
      return;
    }
    if (payload.type === 'final') {
      const value = String(payload.text || state.vadProbe.transcript || '').trim();
      state.vadProbe.transcript = value;
      pushVadProbeEvent('final', value, { detail: 'vad probe final' });
      pushVadProbeAction('vadProbeFinal', { text: value });
      state.vadProbe.recording = false;
      state.vadProbe.finalizing = false;
      state.vadProbe.starting = false;
      closeVadProbeSocket();
      resetVadProbeVad();
      vadProbeStatus(value ? 'Transcript ready.' : 'No transcript returned.');
      renderVadProbeUi();
      poll();
      drawWaveform();
      return;
    }
    if (payload.type === 'error') {
      const detail = payload.detail || 'unknown error';
      pushVadProbeEvent('error', '', { detail });
      pushVadProbeAction('vadProbeError', { error: detail });
      state.vadProbe.recording = false;
      state.vadProbe.finalizing = false;
      state.vadProbe.starting = false;
      closeVadProbeSocket();
      vadProbeStatus(`STT failed: ${detail}`);
      renderVadProbeUi();
      poll();
      drawWaveform();
    }
  }

  async function handleRearmProbeMessage(event) {
    let payload = {};
    try {
      payload = JSON.parse(event.data || '{}');
    } catch (_) {
      return;
    }
    if (payload.type === 'partial') {
      const rawValue = cleanSttTranscript(payload.text ?? payload.partial ?? payload.transcript ?? payload.result_text ?? '');
      const displayValue = mergeTranscriptProgress(state.rearmProbe.transcript, sttPayloadDisplayText(payload), 'partial');
      pushRearmProbeEvent('partial', displayValue, {
        detail: displayValue ? '' : 'empty partial',
        raw_text: rawValue,
        display_text: displayValue,
      });
      if (displayValue) state.rearmProbe.transcript = displayValue;
      renderRearmProbeUi();
      poll();
      return;
    }
    if (payload.type === 'final') {
      const rawValue = cleanSttTranscript(payload.text ?? payload.final ?? payload.transcript ?? payload.result_text ?? '');
      const value = mergeTranscriptProgress(state.rearmProbe.transcript, sttPayloadDisplayText(payload) || rawValue, 'final');
      state.rearmProbe.transcript = value;
      pushRearmProbeEvent('final', value, {
        detail: 'rearm probe final',
        raw_text: rawValue,
        display_text: value,
      });
      pushRearmProbeAction('rearmProbeFinal', { text: value, raw_text: rawValue });
      state.rearmProbe.recording = false;
      state.rearmProbe.finalizing = false;
      state.rearmProbe.starting = false;
      closeRearmProbeSocket();
      resetRearmProbeVad();
      rearmProbeStatus(value ? 'Transcript ready.' : 'No transcript returned.');
      renderRearmProbeUi();
      poll();
      return;
    }
    if (payload.type === 'error') {
      const detail = payload.detail || 'unknown error';
      pushRearmProbeEvent('error', '', { detail });
      pushRearmProbeAction('rearmProbeError', { error: detail });
      state.rearmProbe.recording = false;
      state.rearmProbe.finalizing = false;
      state.rearmProbe.starting = false;
      closeRearmProbeSocket();
      rearmProbeStatus(`STT failed: ${detail}`);
      renderRearmProbeUi();
      poll();
    }
  }

  async function enableProbeMode() {
    if (state.probe.enabled) return;
    if (state.vadProbe.enabled) disableVadProbeMode();
    if (state.rearmProbe.enabled) disableRearmProbeMode();
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!navigator.mediaDevices?.getUserMedia || typeof WebSocket === 'undefined' || !AudioContextCtor) {
      probeStatus('Manual STT probe is unavailable in this browser.');
      renderProbeUi();
      return;
    }
    try {
      const wakeController = window.WakeToTalkController;
      state.probe.restoreWakeOnDisable = wakeController?.isRunning?.() === true;
      if (state.probe.restoreWakeOnDisable) {
        wakeController.stop?.('manual-stt-test-mode');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const audioContext = new AudioContextCtor();
      await audioContext.resume?.();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(AUDIO_BUFFER_SIZE, 1, 1);
      state.probe.stream = stream;
      state.probe.audioContext = audioContext;
      state.probe.sourceNode = source;
      state.probe.processorNode = processor;
      state.probe.enabled = true;
      state.probe.recording = false;
      state.probe.finalizing = false;
      state.probe.startedAt = 0;
      processor.onaudioprocess = event => {
        const output = event.outputBuffer?.getChannelData?.(0);
        if (output) output.fill(0);
        const input = event.inputBuffer.getChannelData(0);
        const features = audioFeatures(input);
        addProbeSample(features);
        if (!state.probe.recording || state.probe.ws?.readyState !== WebSocket.OPEN) return;
        const pcm = downsampleFloat32(input, audioContext.sampleRate);
        if (!pcm?.byteLength) return;
        state.probe.bytesSent += pcm.byteLength;
        state.probe.framesSent += 1;
        state.probe.ws.send(pcm.buffer);
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
      pushProbeAction('manualTestMode', { reason: 'enabled' });
      probeStatus(state.probe.restoreWakeOnDisable
        ? 'VAD bypass test mode enabled. Wake controller paused; mic is live.'
        : 'VAD bypass test mode enabled. Mic is live; press Record to stream.');
      renderProbeUi();
      poll();
    } catch (error) {
      cleanupProbeAudio();
      state.probe.enabled = false;
      if (state.probe.restoreWakeOnDisable) {
        state.probe.restoreWakeOnDisable = false;
        restoreWakeController();
      }
      probeStatus(`Test mode unavailable: ${error.message || error}`);
      renderProbeUi();
    }
  }

  async function enableVadProbeMode() {
    if (state.vadProbe.enabled) return;
    if (state.probe.enabled) disableProbeMode();
    if (state.rearmProbe.enabled) disableRearmProbeMode();
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!navigator.mediaDevices?.getUserMedia || typeof WebSocket === 'undefined' || !AudioContextCtor) {
      vadProbeStatus('VAD STT probe is unavailable in this browser.');
      renderVadProbeUi();
      return;
    }
    try {
      const wakeController = window.WakeToTalkController;
      state.vadProbe.restoreWakeOnDisable = wakeController?.isRunning?.() === true;
      if (state.vadProbe.restoreWakeOnDisable) {
        wakeController.stop?.('vad-stt-test-mode');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const audioContext = new AudioContextCtor();
      await audioContext.resume?.();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(AUDIO_BUFFER_SIZE, 1, 1);
      state.vadProbe.stream = stream;
      state.vadProbe.audioContext = audioContext;
      state.vadProbe.sourceNode = source;
      state.vadProbe.processorNode = processor;
      state.vadProbe.enabled = true;
      state.vadProbe.recording = false;
      state.vadProbe.finalizing = false;
      state.vadProbe.starting = false;
      state.vadProbe.startedAt = 0;
      state.vadProbe.delayFrames = [];
      state.vadProbe.pendingFrames = [];
      resetVadProbeVad(Date.now());
      processor.onaudioprocess = event => {
        const output = event.outputBuffer?.getChannelData?.(0);
        if (output) output.fill(0);
        const input = event.inputBuffer.getChannelData(0);
        const features = audioFeatures(input);
        addVadProbeSample(features);
        if (state.vadProbe.vadRecordEnabled || state.vadProbe.vadStopEnabled) {
          updateVadProbe(features, Date.now());
        }
        if (!state.vadProbe.recording || state.vadProbe.ws?.readyState !== WebSocket.OPEN) return;
        const pcm = downsampleFloat32(input, audioContext.sampleRate);
        if (!pcm?.byteLength) return;
        if (VAD_TEST_DELAY_FRAMES > 0) {
          state.vadProbe.delayFrames.push(pcm);
          while (state.vadProbe.delayFrames.length > VAD_TEST_DELAY_FRAMES) state.vadProbe.delayFrames.shift();
        }
        sendVadProbePcm(pcm, 'stream');
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
      pushVadProbeAction('vadTestMode', { reason: 'enabled' });
      vadProbeStatus(state.vadProbe.restoreWakeOnDisable
        ? 'VAD STT test mode enabled. Wake controller paused; mic is live.'
        : 'VAD STT test mode enabled. Mic is live.');
      renderVadProbeUi();
      poll();
    } catch (error) {
      cleanupVadProbeAudio();
      state.vadProbe.enabled = false;
      if (state.vadProbe.restoreWakeOnDisable) {
        state.vadProbe.restoreWakeOnDisable = false;
        restoreWakeController();
      }
      vadProbeStatus(`VAD test mode unavailable: ${error.message || error}`);
      renderVadProbeUi();
    }
  }

  async function enableRearmProbeMode() {
    if (state.rearmProbe.enabled) return;
    if (state.probe.enabled) disableProbeMode();
    if (state.vadProbe.enabled) disableVadProbeMode();
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!navigator.mediaDevices?.getUserMedia || typeof WebSocket === 'undefined' || !AudioContextCtor) {
      touchRearmOutput();
      rearmProbeStatus('VAD ReArm STT probe is unavailable in this browser.');
      renderRearmProbeUi();
      return;
    }
    try {
      const wakeController = window.WakeToTalkController;
      state.rearmProbe.restoreWakeOnDisable = wakeController?.isRunning?.() === true;
      if (state.rearmProbe.restoreWakeOnDisable) {
        wakeController.stop?.('vad-rearm-stt-test-mode');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const audioContext = new AudioContextCtor();
      await audioContext.resume?.();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(AUDIO_BUFFER_SIZE, 1, 1);
      state.rearmProbe.stream = stream;
      state.rearmProbe.audioContext = audioContext;
      state.rearmProbe.sourceNode = source;
      state.rearmProbe.processorNode = processor;
      state.rearmProbe.enabled = true;
      state.rearmProbe.recording = false;
      state.rearmProbe.finalizing = false;
      state.rearmProbe.starting = false;
      state.rearmProbe.startedAt = 0;
      state.rearmProbe.delayFrames = [];
      state.rearmProbe.pendingFrames = [];
      state.rearmProbe.samples = [];
      resetRearmProbeVad(Date.now());
      processor.onaudioprocess = event => {
        const output = event.outputBuffer?.getChannelData?.(0);
        if (output) output.fill(0);
        const input = event.inputBuffer.getChannelData(0);
        const features = audioFeatures(input);
        addRearmProbeSample(features);
        if (state.rearmProbe.vadRecordEnabled || state.rearmProbe.vadStopEnabled) {
          updateRearmProbe(features, Date.now());
        }
        if (!state.rearmProbe.recording || state.rearmProbe.ws?.readyState !== WebSocket.OPEN) return;
        const pcm = downsampleFloat32(input, audioContext.sampleRate);
        if (!pcm?.byteLength) return;
        if (VAD_TEST_DELAY_FRAMES > 0) {
          state.rearmProbe.delayFrames.push(pcm);
          while (state.rearmProbe.delayFrames.length > VAD_TEST_DELAY_FRAMES) state.rearmProbe.delayFrames.shift();
        }
        sendRearmProbePcm(pcm, 'stream');
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
      pushRearmProbeAction('rearmTestMode', { reason: 'enabled' });
      rearmProbeStatus(state.rearmProbe.restoreWakeOnDisable
        ? 'VAD ReArm STT test mode enabled. Wake controller paused; mic is live.'
        : 'VAD ReArm STT test mode enabled. Mic is live.');
      renderRearmProbeUi();
      poll();
    } catch (error) {
      cleanupRearmProbeAudio();
      state.rearmProbe.enabled = false;
      if (state.rearmProbe.restoreWakeOnDisable) {
        state.rearmProbe.restoreWakeOnDisable = false;
        restoreWakeController();
      }
      touchRearmOutput();
      rearmProbeStatus(`VAD ReArm test mode unavailable: ${error.message || error}`);
      renderRearmProbeUi();
    }
  }

  function disableProbeMode() {
    const restoreWake = state.probe.restoreWakeOnDisable;
    closeProbeSocket();
    cleanupProbeAudio();
    state.probe.enabled = false;
    state.probe.recording = false;
    state.probe.finalizing = false;
    state.probe.restoreWakeOnDisable = false;
    state.probe.startedAt = 0;
    state.probe.bytesSent = 0;
    state.probe.framesSent = 0;
    pushProbeAction('manualTestMode', { reason: 'disabled' });
    probeStatus('VAD bypass is off.');
    renderProbeUi();
    poll();
    drawWaveform();
    if (restoreWake) {
      restoreWakeController();
    }
  }

  function disableVadProbeMode() {
    const restoreWake = state.vadProbe.restoreWakeOnDisable;
    closeVadProbeSocket();
    cleanupVadProbeAudio();
    state.vadProbe.enabled = false;
    state.vadProbe.recording = false;
    state.vadProbe.finalizing = false;
    state.vadProbe.starting = false;
    state.vadProbe.vadRecordEnabled = false;
    state.vadProbe.vadStopEnabled = false;
    state.vadProbe.restoreWakeOnDisable = false;
    state.vadProbe.startedAt = 0;
    state.vadProbe.bytesSent = 0;
    state.vadProbe.framesSent = 0;
    state.vadProbe.delayFrames = [];
    state.vadProbe.pendingFrames = [];
    resetVadProbeVad();
    pushVadProbeAction('vadTestMode', { reason: 'disabled' });
    vadProbeStatus('VAD STT probe is off.');
    renderVadProbeUi();
    poll();
    drawWaveform();
    if (restoreWake) {
      restoreWakeController();
    }
  }

  function disableRearmProbeMode() {
    const restoreWake = state.rearmProbe.restoreWakeOnDisable;
    closeRearmProbeSocket();
    cleanupRearmProbeAudio();
    state.rearmProbe.enabled = false;
    state.rearmProbe.recording = false;
    state.rearmProbe.finalizing = false;
    state.rearmProbe.starting = false;
    state.rearmProbe.vadRecordEnabled = false;
    state.rearmProbe.vadStopEnabled = false;
    state.rearmProbe.restoreWakeOnDisable = false;
    state.rearmProbe.startedAt = 0;
    state.rearmProbe.bytesSent = 0;
    state.rearmProbe.framesSent = 0;
    state.rearmProbe.delayFrames = [];
    state.rearmProbe.pendingFrames = [];
    resetRearmProbeVad();
    pushRearmProbeAction('rearmTestMode', { reason: 'disabled' });
    rearmProbeStatus('VAD ReArm STT probe is off.');
    renderRearmProbeUi();
    poll();
    if (restoreWake) {
      restoreWakeController();
    }
  }

  async function startProbeRecording() {
    if (state.probe.recording || state.probe.finalizing) return;
    if (!state.probe.enabled) await enableProbeMode();
    if (!state.probe.enabled) return;
    closeProbeSocket();
    state.probe.bytesSent = 0;
    state.probe.framesSent = 0;
    state.probe.transcript = '';
    state.probe.events = [];
    try {
      const ws = new WebSocket(await probeWebsocketUrl());
      ws.binaryType = 'arraybuffer';
      state.probe.ws = ws;
      ws.addEventListener('message', event => { void handleProbeMessage(event); });
      ws.addEventListener('close', () => {
        if (!state.probe.recording && !state.probe.finalizing) return;
        state.probe.recording = false;
        state.probe.finalizing = false;
        state.probe.ws = null;
        pushProbeAction('manualError', { error: 'socket closed before final transcript' });
        probeStatus('STT connection closed before final transcript.');
        renderProbeUi();
        poll();
      });
      await waitForSocketOpen(ws);
      state.probe.startedAt = Date.now();
      state.probe.recording = true;
      state.probe.finalizing = false;
      pushProbeAction('manualRecordStart', { route: STT_WS_URL, vad: 'bypassed' });
      probeStatus(voiceNoiseEnabled() ? 'Recording with noise reduction; VAD bypassed.' : 'Recording without noise reduction; VAD bypassed.');
      renderProbeUi();
      poll();
    } catch (error) {
      closeProbeSocket();
      state.probe.recording = false;
      state.probe.finalizing = false;
      pushProbeAction('manualError', { error: error.message || String(error) });
      probeStatus(`Recording unavailable: ${error.message || error}`);
      renderProbeUi();
      poll();
    }
  }

  function sendVadProbePcm(pcm, source = 'stream') {
    if (!pcm?.byteLength || state.vadProbe.ws?.readyState !== WebSocket.OPEN) return false;
    try {
      state.vadProbe.ws.send(pcm.buffer);
      state.vadProbe.bytesSent += pcm.byteLength;
      state.vadProbe.framesSent += 1;
      if (source !== 'stream') {
        pushVadProbeAction('vadProbeFrame', { source, audio_frame: state.vadProbe.framesSent });
      }
      return true;
    } catch (error) {
      pushVadProbeAction('vadProbeError', { error: error.message || String(error) });
      return false;
    }
  }

  async function startVadProbeRecording(options = {}) {
    if (state.vadProbe.recording || state.vadProbe.finalizing || state.vadProbe.starting) return;
    if (!state.vadProbe.enabled) await enableVadProbeMode();
    if (!state.vadProbe.enabled) return;
    closeVadProbeSocket();
    state.vadProbe.bytesSent = 0;
    state.vadProbe.framesSent = 0;
    state.vadProbe.transcript = '';
    state.vadProbe.events = [];
    state.vadProbe.pendingFrames = [];
    state.vadProbe.starting = true;
    try {
      const ws = new WebSocket(await probeWebsocketUrl());
      ws.binaryType = 'arraybuffer';
      state.vadProbe.ws = ws;
      ws.addEventListener('message', event => { void handleVadProbeMessage(event); });
      ws.addEventListener('close', () => {
        if (!state.vadProbe.recording && !state.vadProbe.finalizing && !state.vadProbe.starting) return;
        state.vadProbe.recording = false;
        state.vadProbe.finalizing = false;
        state.vadProbe.starting = false;
        state.vadProbe.ws = null;
        pushVadProbeAction('vadProbeError', { error: 'socket closed before final transcript' });
        vadProbeStatus('STT connection closed before final transcript.');
        renderVadProbeUi();
        poll();
      });
      await waitForSocketOpen(ws);
      state.vadProbe.startedAt = Date.now();
      state.vadProbe.recording = true;
      state.vadProbe.finalizing = false;
      state.vadProbe.starting = false;
      const queued = state.vadProbe.pendingFrames.splice(0);
      queued.forEach(frame => sendVadProbePcm(frame, 'pre_roll'));
      pushVadProbeAction('vadProbeRecordStart', {
        route: STT_WS_URL,
        reason: options.reason || 'manual_record',
        vad_record_enabled: !!state.vadProbe.vadRecordEnabled,
        pre_roll_frames: queued.length,
      });
      vadProbeStatus(voiceNoiseEnabled()
        ? 'Recording with noise reduction; isolated VAD test.'
        : 'Recording without noise reduction; isolated VAD test.');
      renderVadProbeUi();
      poll();
    } catch (error) {
      closeVadProbeSocket();
      state.vadProbe.recording = false;
      state.vadProbe.finalizing = false;
      state.vadProbe.starting = false;
      pushVadProbeAction('vadProbeError', { error: error.message || String(error) });
      vadProbeStatus(`Recording unavailable: ${error.message || error}`);
      renderVadProbeUi();
      poll();
    }
  }

  function sendRearmProbePcm(pcm, source = 'stream') {
    if (!pcm?.byteLength || state.rearmProbe.ws?.readyState !== WebSocket.OPEN) return false;
    try {
      state.rearmProbe.ws.send(pcm.buffer);
      state.rearmProbe.bytesSent += pcm.byteLength;
      state.rearmProbe.framesSent += 1;
      if (source !== 'stream') {
        pushRearmProbeAction('rearmProbeFrame', { source, audio_frame: state.rearmProbe.framesSent });
      }
      return true;
    } catch (error) {
      pushRearmProbeAction('rearmProbeError', { error: error.message || String(error) });
      return false;
    }
  }

  async function startRearmProbeRecording(options = {}) {
    if (state.rearmProbe.recording || state.rearmProbe.finalizing || state.rearmProbe.starting) return;
    if (!state.rearmProbe.enabled) await enableRearmProbeMode();
    if (!state.rearmProbe.enabled) return;
    closeRearmProbeSocket();
    state.rearmProbe.bytesSent = 0;
    state.rearmProbe.framesSent = 0;
    state.rearmProbe.transcript = '';
    state.rearmProbe.events = [];
    state.rearmProbe.pendingFrames = [];
    state.rearmProbe.starting = true;
    renderRearmProbeUi();
    poll();
    try {
      const ws = new WebSocket(await probeWebsocketUrl());
      ws.binaryType = 'arraybuffer';
      state.rearmProbe.ws = ws;
      ws.addEventListener('message', event => { void handleRearmProbeMessage(event); });
      ws.addEventListener('close', () => {
        if (!state.rearmProbe.recording && !state.rearmProbe.finalizing && !state.rearmProbe.starting) return;
        state.rearmProbe.recording = false;
        state.rearmProbe.finalizing = false;
        state.rearmProbe.starting = false;
        state.rearmProbe.ws = null;
        pushRearmProbeAction('rearmProbeError', { error: 'socket closed before final transcript' });
        rearmProbeStatus('STT connection closed before final transcript.');
        renderRearmProbeUi();
        poll();
      });
      await waitForSocketOpen(ws);
      state.rearmProbe.startedAt = Date.now();
      state.rearmProbe.recording = true;
      state.rearmProbe.finalizing = false;
      state.rearmProbe.starting = false;
      const queued = state.rearmProbe.pendingFrames.splice(0);
      queued.forEach(frame => sendRearmProbePcm(frame, 'pre_roll'));
      pushRearmProbeAction('rearmProbeRecordStart', {
        route: STT_WS_URL,
        reason: options.reason || 'manual_record',
        vad_record_enabled: !!state.rearmProbe.vadRecordEnabled,
        pre_roll_frames: queued.length,
      });
      rearmProbeStatus(voiceNoiseEnabled()
        ? 'Recording with noise reduction; isolated VAD ReArm test.'
        : 'Recording without noise reduction; isolated VAD ReArm test.');
      renderRearmProbeUi();
      poll();
    } catch (error) {
      closeRearmProbeSocket();
      state.rearmProbe.recording = false;
      state.rearmProbe.finalizing = false;
      state.rearmProbe.starting = false;
      pushRearmProbeAction('rearmProbeError', { error: error.message || String(error) });
      rearmProbeStatus(`Recording unavailable: ${error.message || error}`);
      renderRearmProbeUi();
      poll();
    }
  }

  function stopProbeRecording() {
    if (!state.probe.recording || !state.probe.ws) return;
    state.probe.recording = false;
    state.probe.finalizing = true;
    pushProbeAction('manualRecordStop', {
      audio_bytes: state.probe.bytesSent,
      audio_frames: state.probe.framesSent,
    });
    if (state.probe.ws.readyState === WebSocket.OPEN) {
      state.probe.ws.send(JSON.stringify({
        type: 'end',
        audio_bytes: state.probe.bytesSent,
        audio_frames: state.probe.framesSent,
      }));
      probeStatus('Finalizing transcript.');
    } else {
      state.probe.finalizing = false;
      closeProbeSocket();
      probeStatus('STT connection was not ready.');
    }
    renderProbeUi();
    poll();
    drawWaveform();
  }

  function stopVadProbeRecording(reason = 'manual_stop') {
    if (!state.vadProbe.recording || !state.vadProbe.ws) {
      if (state.vadProbe.starting || state.vadProbe.vadRecordEnabled) {
        closeVadProbeSocket();
        state.vadProbe.starting = false;
        state.vadProbe.recording = false;
        state.vadProbe.finalizing = false;
        state.vadProbe.vadRecordEnabled = false;
        pushVadProbeAction('vadProbeRecordStop', { reason: 'cancel_armed_record', audio_bytes: state.vadProbe.bytesSent, audio_frames: state.vadProbe.framesSent });
        vadProbeStatus('VAD Record stopped.');
        renderVadProbeUi();
        poll();
        drawWaveform();
      }
      return;
    }
    state.vadProbe.recording = false;
    state.vadProbe.finalizing = true;
    state.vadProbe.vadRecordEnabled = false;
    const vad = state.vadProbe.vad || {};
    const now = Date.now();
    const speechAge = vad.lastVoiceAt ? Math.max(0, now - vad.lastVoiceAt) : null;
    const recordingMs = state.vadProbe.startedAt ? Math.max(0, now - state.vadProbe.startedAt) : null;
    pushVadProbeAction('vadProbeRecordStop', {
      reason,
      audio_bytes: state.vadProbe.bytesSent,
      audio_frames: state.vadProbe.framesSent,
      speech_age_ms: speechAge,
      recording_ms: recordingMs,
      timeout_ms: vadProbeResetTimeoutMs(),
    });
    if (state.vadProbe.ws.readyState === WebSocket.OPEN) {
      const endPayload = {
        type: 'end',
        audio_bytes: state.vadProbe.bytesSent,
        audio_frames: state.vadProbe.framesSent,
      };
      if (reason !== 'manual_stop') endPayload.reason = reason;
      state.vadProbe.ws.send(JSON.stringify(endPayload));
      vadProbeStatus(reason === 'vad_stop'
        ? `VAD Stop sent end after ${Math.round(recordingMs || 0)} ms / ${state.vadProbe.framesSent} frames.`
        : 'Finalizing transcript.');
    } else {
      state.vadProbe.finalizing = false;
      closeVadProbeSocket();
      vadProbeStatus('STT connection was not ready.');
    }
    renderVadProbeUi();
    poll();
    drawWaveform();
  }

  function stopRearmProbeRecording(reason = 'manual_stop') {
    if (!state.rearmProbe.recording || !state.rearmProbe.ws) {
      if (state.rearmProbe.starting || state.rearmProbe.vadRecordEnabled) {
        closeRearmProbeSocket();
        state.rearmProbe.starting = false;
        state.rearmProbe.recording = false;
        state.rearmProbe.finalizing = false;
        state.rearmProbe.vadRecordEnabled = false;
        pushRearmProbeAction('rearmProbeRecordStop', { reason: 'cancel_armed_record', audio_bytes: state.rearmProbe.bytesSent, audio_frames: state.rearmProbe.framesSent });
        rearmProbeStatus('VAD Record stopped.');
        renderRearmProbeUi();
        poll();
      }
      return;
    }
    state.rearmProbe.recording = false;
    state.rearmProbe.finalizing = true;
    state.rearmProbe.vadRecordEnabled = false;
    const vad = state.rearmProbe.vad || {};
    const now = Date.now();
    const speechAge = vad.lastVoiceAt ? Math.max(0, now - vad.lastVoiceAt) : null;
    const recordingMs = state.rearmProbe.startedAt ? Math.max(0, now - state.rearmProbe.startedAt) : null;
    pushRearmProbeAction('rearmProbeRecordStop', {
      reason,
      audio_bytes: state.rearmProbe.bytesSent,
      audio_frames: state.rearmProbe.framesSent,
      speech_age_ms: speechAge,
      recording_ms: recordingMs,
      timeout_ms: rearmProbeResetTimeoutMs(),
    });
    if (state.rearmProbe.ws.readyState === WebSocket.OPEN) {
      const endPayload = {
        type: 'end',
        audio_bytes: state.rearmProbe.bytesSent,
        audio_frames: state.rearmProbe.framesSent,
      };
      if (reason !== 'manual_stop') endPayload.reason = reason;
      state.rearmProbe.ws.send(JSON.stringify(endPayload));
      rearmProbeStatus(reason === 'vad_stop'
        ? `VAD Stop sent end after ${Math.round(recordingMs || 0)} ms / ${state.rearmProbe.framesSent} frames.`
        : 'Finalizing transcript.');
    } else {
      state.rearmProbe.finalizing = false;
      closeRearmProbeSocket();
      rearmProbeStatus('STT connection was not ready.');
    }
    renderRearmProbeUi();
    poll();
  }

  function clearProbe() {
    if (state.probe.recording || state.probe.finalizing) return;
    state.probe.transcript = '';
    state.probe.events = [];
    state.probe.actions = [];
    state.probe.bytesSent = 0;
    state.probe.framesSent = 0;
    probeStatus(state.probe.enabled ? 'VAD bypass test mode enabled. Mic is live; press Record to stream.' : 'VAD bypass is off.');
    renderProbeUi();
    poll();
    drawWaveform();
  }

  function clearVadProbe() {
    if (state.vadProbe.recording || state.vadProbe.finalizing || state.vadProbe.starting) return;
    state.vadProbe.transcript = '';
    state.vadProbe.events = [];
    state.vadProbe.actions = [];
    state.vadProbe.bytesSent = 0;
    state.vadProbe.framesSent = 0;
    state.vadProbe.pendingFrames = [];
    resetVadProbeVad();
    vadProbeStatus(state.vadProbe.enabled ? 'VAD STT test mode enabled. Mic is live.' : 'VAD STT probe is off.');
    renderVadProbeUi();
    poll();
    drawWaveform();
  }

  function clearRearmProbe() {
    if (state.rearmProbe.recording || state.rearmProbe.finalizing || state.rearmProbe.starting) return;
    state.rearmProbe.transcript = '';
    state.rearmProbe.events = [];
    state.rearmProbe.actions = [];
    state.rearmProbe.samples = [];
    state.rearmProbe.bytesSent = 0;
    state.rearmProbe.framesSent = 0;
    state.rearmProbe.pendingFrames = [];
    state.rearmProbe.uiStateSignature = '';
    resetRearmProbeVad();
    pushRearmProbeAction('controlState', {
      control: 'Clear',
      label: 'Clear: pressed',
      button_text: 'Clear',
      disabled: false,
      pressed: true,
    });
    rearmProbeStatus(state.rearmProbe.enabled ? 'VAD ReArm STT test mode enabled. Mic is live.' : 'VAD ReArm STT probe is off.');
    renderRearmProbeUi();
    poll();
  }

  function toggleVadRecordMode() {
    if (!state.vadProbe.enabled) return;
    state.vadProbe.vadRecordEnabled = !state.vadProbe.vadRecordEnabled;
    resetVadProbeVad();
    pushVadProbeAction('vadRecordMode', { enabled: state.vadProbe.vadRecordEnabled });
    vadProbeStatus(state.vadProbe.vadRecordEnabled ? 'VAD Record enabled. Speak to auto-record.' : 'VAD Record disabled.');
    renderVadProbeUi();
    poll();
  }

  function toggleRearmRecordMode() {
    if (!state.rearmProbe.enabled) return;
    state.rearmProbe.vadRecordEnabled = !state.rearmProbe.vadRecordEnabled;
    resetRearmProbeVad();
    pushRearmProbeAction('vadRecordMode', { enabled: state.rearmProbe.vadRecordEnabled });
    rearmProbeStatus(state.rearmProbe.vadRecordEnabled ? 'VAD Record enabled. Speak to auto-record.' : 'VAD Record disabled.');
    renderRearmProbeUi();
    poll();
  }

  function toggleRearmStopMode() {
    if (!state.rearmProbe.enabled) return;
    state.rearmProbe.vadStopEnabled = !state.rearmProbe.vadStopEnabled;
    pushRearmProbeAction('vadStopMode', { enabled: state.rearmProbe.vadStopEnabled, timeout_ms: rearmProbeResetTimeoutMs() });
    rearmProbeStatus(state.rearmProbe.vadStopEnabled ? 'VAD Stop enabled. Silence will send Stop.' : 'VAD Stop disabled.');
    renderRearmProbeUi();
    poll();
  }

  function toggleVadStopMode() {
    if (!state.vadProbe.enabled) return;
    state.vadProbe.vadStopEnabled = !state.vadProbe.vadStopEnabled;
    pushVadProbeAction('vadStopMode', { enabled: state.vadProbe.vadStopEnabled, timeout_ms: vadProbeResetTimeoutMs() });
    vadProbeStatus(state.vadProbe.vadStopEnabled ? 'VAD Stop enabled. Silence will send Stop.' : 'VAD Stop disabled.');
    renderVadProbeUi();
    poll();
  }

  function itemSummary(item) {
    if (!item || typeof item !== 'object') return String(item || '');
    const textValue = item.text || item.body || item.normalized_text || '';
    const meta = [
      item.phase,
      item.utterance_id ? `utt ${item.utterance_id}` : '',
      Number.isFinite(Number(item.audio_end_frame)) ? `frame ${item.audio_end_frame}` : '',
    ].filter(Boolean).join(' | ');
    return `${textValue || JSON.stringify(item)}${meta ? ` (${meta})` : ''}`;
  }

  function renderList(node, items, emptyText) {
    if (!node) return;
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      node.innerHTML = `<div class="wake-dev-pill"><span>${escapeHtml(emptyText)}</span></div>`;
      return;
    }
    node.innerHTML = list.map(item => (
      `<div class="wake-dev-pill"><span>${escapeHtml(itemSummary(item))}</span></div>`
    )).join('');
  }

  function actionDetail(action) {
    if (!action || typeof action !== 'object') return '';
    if (action.type === 'stateChanged') return `${action.next_state || ''}${action.reason ? ` (${action.reason})` : ''}`;
    if (action.type === 'wakeMatched') return `${action.instance_id || ''} ${action.wake_word || ''}`.trim();
    if (action.type === 'wakeRejected') return `${action.reason || ''}${action.text ? `: ${action.text}` : ''}${action.level ? ` level ${Number(action.level).toFixed(3)}` : ''}`;
    if (action.type === 'inputQueued' || action.type === 'messageQueued') return action.text || '';
    if (action.type === 'commandMatched') return `${action.command || ''} via ${action.phrase || ''}`.trim();
    if (action.type === 'execute') return `${action.reason || 'send'} -> ${action.body || ''}`;
    if (action.type === 'resetStt') return `${action.reason || 'stt_reset'}${action.timeout_ms ? ` after ${action.timeout_ms} ms` : ''}`;
    if (action.type === 'sendSkipped') return action.reason || '';
    if (action.type === 'startTimer') return `${action.timer || ''} ${action.ms || 0} ms`;
    if (action.type === 'clearTimer') return action.timer || '';
    if (action.type === 'controllerStopped') return action.reason || '';
    if (action.type === 'manualTestMode') return action.reason || '';
    if (action.type === 'manualRecordStart') return `${action.route || STT_WS_URL} (${action.vad || 'vad bypassed'})`;
    if (action.type === 'manualRecordStop') return `${action.audio_frames || 0} frames, ${action.audio_bytes || 0} bytes`;
    if (action.type === 'manualFinal') return action.text || '';
    if (action.type === 'manualError') return action.error || '';
    if (action.type === 'vadTestMode') return action.reason || '';
    if (action.type === 'vadRecordMode' || action.type === 'vadStopMode') return action.enabled ? 'enabled' : 'disabled';
    if (action.type === 'vadCandidateStart') return `${action.delay_frames || 0} pre-roll frames`;
    if (action.type === 'vadCandidateConfirmed') return action.start_threshold || 'confirmed';
    if (action.type === 'vadProbeRecordStart') return `${action.reason || 'record'}; ${action.pre_roll_frames || 0} pre-roll frames`;
    if (action.type === 'vadProbeRecordStop') {
      const timing = Number.isFinite(Number(action.recording_ms)) ? `, ${Math.round(Number(action.recording_ms))} ms` : '';
      const quiet = Number.isFinite(Number(action.speech_age_ms)) ? `, quiet ${Math.round(Number(action.speech_age_ms))}/${action.timeout_ms || 0} ms` : '';
      return `${action.reason || 'stop'}; ${action.audio_frames || 0} frames, ${action.audio_bytes || 0} bytes${timing}${quiet}`;
    }
    if (action.type === 'vadProbeFinal') return action.text || '';
    if (action.type === 'vadProbeError') return action.error || '';
    if (action.error) return action.error;
    return JSON.stringify(action);
  }

  function renderActions(actions) {
    if (!els.actionLog) return;
    const list = Array.isArray(actions) ? actions.slice(-80).reverse() : [];
    if (!list.length) {
      els.actionLog.innerHTML = '<div class="wake-dev-action"><span>No FSM actions yet.</span></div>';
      return;
    }
    els.actionLog.innerHTML = list.map(action => {
      const at = action.at_ms ? new Date(action.at_ms).toLocaleTimeString() : '';
      return `<div class="wake-dev-action"><strong>${escapeHtml(action.type || 'action')}</strong><span>${escapeHtml(actionDetail(action))}</span><span>${escapeHtml(at)}</span></div>`;
    }).join('');
  }

  function renderSttEvents(events) {
    if (!els.sttEvents) return;
    const list = Array.isArray(events) ? events.slice(-80).reverse() : [];
    if (!list.length) {
      els.sttEvents.innerHTML = '<div class="wake-dev-pill"><span>No STT payloads yet.</span></div>';
      return;
    }
    els.sttEvents.innerHTML = list.map(evt => {
      const words = evt.text ? escapeHtml(evt.text) : '<span>(empty partial)</span>';
      const detail = [
        evt.type || '',
        Number.isFinite(Number(evt.text_length)) ? `${evt.text_length} chars` : '',
        Number.isFinite(Number(evt.audio_frames_sent)) ? `frame ${evt.audio_frames_sent}` : '',
        evt.detail || '',
        evt.keys ? `keys ${evt.keys}` : '',
      ].filter(Boolean).join(' | ');
      return `<div class="wake-dev-pill"><strong>${words}</strong><span>${escapeHtml(detail)}</span></div>`;
    }).join('');
  }

  function renderStates(activeState) {
    if (!els.states) return;
    const values = Object.values(window.WakeToTalkState?.STATES || {});
    if (activeState && !values.includes(activeState)) values.push(activeState);
    els.states.innerHTML = values.map(value => {
      const active = value === activeState ? ' is-active' : '';
      return `<span class="wake-dev-state${active}">${escapeHtml(value)}</span>`;
    }).join('');
  }

  function fsmStatusText(fsm, reason) {
    const stateName = String(fsm || '').toUpperCase();
    const detail = String(reason || '').trim();
    if (stateName === 'DISABLED') return detail || 'Wake to Talk is off.';
    if (stateName === 'SELECTED_INACTIVE') return detail || 'Wake to Talk is selected but this browser is not activated.';
    if (stateName === 'BLOCKED') return detail || 'Wake to Talk is blocked.';
    if (stateName === 'PERMISSION_PENDING') return detail || 'Wake to Talk is requesting the microphone.';
    if (stateName === 'ARMED_IDLE') return detail || 'Wake to Talk is armed.';
    if (stateName) return detail || `Wake to Talk state: ${stateName}.`;
    return detail;
  }

  function renderSnapshot(snapshot, source) {
    state.snapshot = snapshot;
    const fsm = snapshot.fsm_state || state.runtime.state || '';
    const reason = snapshot.reason || state.runtime.reason || '';
    const level = Number(state.lastLevel || state.runtime.level || 0);
    setText(els.fsmState, fsm || '--');
    setText(els.session, snapshot.session_id || '--');
    setText(els.instance, snapshot.active_instance_id || '--');
    setText(els.frames, snapshot.audio_frames_sent || 0);
    setText(els.db, formatDb(level));
    const vad = snapshot.vad || {};
    const vadState = vad.speaking ? 'speech' : 'silence';
    const vadDetail = Number.isFinite(Number(vad.silence_age_ms)) && Number(vad.silence_reset_timeout_ms) > 0
      ? ` | quiet ${Math.round(Number(vad.silence_age_ms))}/${Number(vad.silence_reset_timeout_ms)} ms`
      : '';
    const vadStage = vad.candidate_confirmed ? ' | VAD strong' : (vad.candidate_active ? ' | VAD candidate' : '');
    const vadArmed = snapshot.vad_speech_start_reset_armed === false ? ' | reset gated' : ' | reset armed';
    const sourceText = source === 'manual STT probe'
      ? `manual STT probe | ${STT_WS_URL} | VAD bypass`
      : (source === 'VAD STT probe'
        ? `VAD STT probe | ${STT_WS_URL} | isolated VAD ${vadState}${vadDetail}${vadStage}`
        : `${source === 'local controller' ? 'local controller snapshot + STT websocket stream' : source} | VAD ${vadState}${vadDetail}${vadStage}${vadArmed}`);
    setText(els.debugSource, sourceText);
    setText(els.age, (source === 'local controller' || source === 'manual STT probe' || source === 'VAD STT probe') ? 'live' : formatAge(state.apiAgeSeconds));
    renderStates(fsm);
    status(fsmStatusText(fsm, reason));
    renderSttEvents(snapshot.recent_stt_events || []);
    if (source !== 'VAD STT probe') setText(els.transcript, snapshot.transcript || '', '');
    renderVadProbeUi();
    setText(els.inputQueue, String((snapshot.queues?.raw_input_queue || snapshot.queues?.input_queue || []).length), '0');
    setText(els.pendingQueue, String((snapshot.queues?.pending_command_items || []).length), '0');
    setText(els.messageQueue, String((snapshot.queues?.message_queue || []).length), '0');
    const send = snapshot.frozen_send_snapshot && Object.keys(snapshot.frozen_send_snapshot).length
      ? snapshot.frozen_send_snapshot
      : snapshot.active_send || {};
    if (els.sendSnapshot) els.sendSnapshot.textContent = JSON.stringify(send || {}, null, 2);
    renderActions(snapshot.recent_actions || []);
  }

  function poll() {
    const current = currentSnapshot();
    renderSnapshot(current.snapshot, current.source);
    renderRearmOutput();
    renderControlState();
  }

  function onRuntime(event) {
    const detail = event.detail || {};
    state.runtime = { ...state.runtime, ...detail };
    if (state.probe.enabled || state.vadProbe.enabled) return;
    const level = Math.max(0, Math.min(1, Number(detail.level) || 0));
    state.lastLevel = level;
    if (state.timelinePaused) return;
    const now = Date.now();
    state.samples.push({
      at: now,
      level,
      rms: Math.max(0, Number(detail.audio_rms) || 0),
      peak: Math.max(0, Number(detail.audio_peak) || 0),
      vad_energy: Math.max(0, Number(detail.vad_energy) || 0),
      fsm_state: detail.state || '',
    });
    state.samples = state.samples.filter(sample => sample.at >= now - WINDOW_MS - 1000);
  }

  function toggleTimelinePause() {
    state.timelinePaused = !state.timelinePaused;
    if (state.timelinePaused) {
      state.pausedAt = Date.now();
      state.pausedSamples = state.samples.slice();
      state.pausedSnapshot = clone(state.snapshot || {});
    } else {
      state.pausedAt = 0;
      state.pausedSamples = [];
      state.pausedSnapshot = null;
    }
    if (els.pauseTimeline) {
      els.pauseTimeline.setAttribute('aria-pressed', state.timelinePaused ? 'true' : 'false');
      els.pauseTimeline.textContent = state.timelinePaused ? 'Resume' : 'Pause';
      els.pauseTimeline.title = state.timelinePaused ? 'Resume timeline' : 'Pause timeline';
    }
    drawWaveform();
  }

  function eventColor(type) {
    if (type === 'wakeMatched') return '#22c55e';
    if (type === 'wakeRejected' || type === 'sendFailed' || type === 'micError') return '#f87171';
    if (type === 'resetStt') return '#c084fc';
    if (type === 'commandMatched' || type === 'execute') return '#fbbf24';
    if (type === 'messageQueued' || type === 'inputQueued') return '#60a5fa';
    if (type === 'stateChanged') return '#5b9cf6';
    if (type === 'manualRecordStart' || type === 'manualFinal') return '#22c55e';
    if (type === 'manualRecordStop') return '#fbbf24';
    if (type === 'manualTestMode') return '#38bdf8';
    if (type === 'manualError') return '#f87171';
    if (type === 'vadProbeRecordStart' || type === 'vadProbeFinal' || type === 'vadCandidateConfirmed') return '#22c55e';
    if (type === 'vadProbeRecordStop' || type === 'vadStopMode') return '#fbbf24';
    if (type === 'vadRecordMode' || type === 'vadTestMode' || type === 'vadCandidateStart') return '#38bdf8';
    if (type === 'vadProbeError') return '#f87171';
    return '#aebfca';
  }

  function clipCanvasText(ctx, value, maxWidth) {
    const textValue = String(value || '').replace(/\s+/g, ' ').trim();
    if (!textValue || ctx.measureText(textValue).width <= maxWidth) return textValue;
    let clipped = textValue;
    while (clipped.length > 1 && ctx.measureText(`${clipped}...`).width > maxWidth) {
      clipped = clipped.slice(0, -1);
    }
    return `${clipped.trim()}...`;
  }

  function drawPill(ctx, label, x, y, options = {}) {
    const textValue = clipCanvasText(ctx, label, options.maxWidth || 180);
    if (!textValue) return 0;
    const padX = 7;
    const h = options.height || 18;
    const w = Math.min((options.maxWidth || 180) + (padX * 2), ctx.measureText(textValue).width + (padX * 2));
    const left = Math.max(4, Math.min(options.canvasWidth - w - 4, x));
    ctx.fillStyle = options.background || 'rgba(16, 24, 38, 0.9)';
    ctx.strokeStyle = options.border || 'rgba(91,156,246,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(left, y, w, h, 6);
    } else {
      ctx.rect(left, y, w, h);
    }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = options.color || '#dce8ed';
    ctx.fillText(textValue, left + padX, y + 13);
    return w;
  }

  function sttText(evt) {
    return String(evt?.text || '').replace(/\s+/g, ' ').trim();
  }

  function drawSttTimeline(ctx, start, windowMs, w, graphH, h, snapshot = state.snapshot) {
    const events = Array.isArray(snapshot?.recent_stt_events)
      ? snapshot.recent_stt_events.filter(evt => Number(evt.at_ms) >= start)
      : [];
    const laneTop = graphH + 30;
    ctx.fillStyle = 'rgba(174,191,202,0.72)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText('STT payloads', 6, laneTop - 6);
    if (!events.length) {
      ctx.fillStyle = 'rgba(174,191,202,0.55)';
      ctx.fillText('no STT payloads in view', 82, laneTop - 6);
      return;
    }

    let emptyCount = 0;
    const labels = [];
    events.forEach(evt => {
      const at = Number(evt.at_ms);
      if (!Number.isFinite(at)) return;
      const x = ((at - start) / windowMs) * w;
      const words = sttText(evt);
      const isFinal = evt.type === 'final';
      const color = isFinal ? '#22c55e' : (words ? '#38bdf8' : 'rgba(148,168,179,0.42)');
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, laneTop);
      ctx.lineTo(x, h - 24);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, laneTop + 4, words ? 3 : 1.8, 0, Math.PI * 2);
      ctx.fill();
      if (!words) {
        emptyCount += 1;
        return;
      }
      labels.push({ x, words, isFinal });
    });

    let textCount = 0;
    let lastText = '';
    let lastLabelX = -999;
    labels.forEach(label => {
      const normalized = label.words.toLowerCase();
      const isFinal = label.isFinal;
      const x = label.x;
      if (normalized === lastText && !isFinal) return;
      if (x - lastLabelX < 92 && !isFinal) return;
      textCount += 1;
      lastText = normalized;
      const prefix = isFinal ? 'final: ' : 'partial: ';
      ctx.font = '11px system-ui, sans-serif';
      drawPill(ctx, `${prefix}${label.words}`, x + 4, laneTop + (isFinal ? 25 : 3), {
        canvasWidth: w,
        maxWidth: isFinal ? 340 : 300,
        height: 20,
        background: isFinal ? 'rgba(5, 46, 22, 0.97)' : 'rgba(7, 24, 39, 0.97)',
        border: isFinal ? 'rgba(74,222,128,0.82)' : 'rgba(56,189,248,0.78)',
        color: '#f1f7fa',
      });
      lastLabelX = x;
    });

    if (!textCount && emptyCount) {
      ctx.fillStyle = 'rgba(174,191,202,0.68)';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(`${emptyCount} empty partials; no recognized text in this 10s window`, 82, laneTop - 6);
    }
  }

  function drawWaveform() {
    if (!state.open || !els.canvas) return;
    const canvas = els.canvas;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(320, Math.round(rect.width * dpr));
    const height = Math.max(180, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    const w = width / dpr;
    const h = height / dpr;
    const graphH = h - 104;
    const now = state.timelinePaused && state.pausedAt ? state.pausedAt : Date.now();
    const start = now - WINDOW_MS;
    const samples = state.timelinePaused ? state.pausedSamples : state.samples;
    const snapshot = state.timelinePaused && state.pausedSnapshot ? state.pausedSnapshot : state.snapshot;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(91,156,246,0.16)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i += 1) {
      const x = (w * i) / 10;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, graphH);
      ctx.stroke();
    }
    [-60, -40, -20, 0].forEach(db => {
      const y = graphH - ((db + 80) / 80) * graphH;
      ctx.strokeStyle = db === -20 ? 'rgba(251,191,36,0.22)' : 'rgba(255,255,255,0.09)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(174,191,202,0.78)';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(`${db} dB`, 8, Math.max(12, y - 4));
    });
    const visible = samples.filter(sample => sample.at >= start);
    if (visible.length) {
      ctx.strokeStyle = '#5b9cf6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      visible.forEach((sample, index) => {
        const x = ((sample.at - start) / WINDOW_MS) * w;
        const rms = Number.isFinite(Number(sample.rms)) ? Math.max(0.0001, Number(sample.rms)) : Math.max(0.0001, Number(sample.level) || 0.0001);
        const db = Math.max(-80, Math.min(0, 20 * Math.log10(rms)));
        const y = graphH - ((db + 80) / 80) * graphH;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.fillStyle = 'rgba(91,156,246,0.12)';
      ctx.lineTo(w, graphH);
      ctx.lineTo(((visible[0].at - start) / WINDOW_MS) * w, graphH);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(248,113,113,0.9)';
      visible.forEach(sample => {
        if (Number(sample.peak) < 0.98) return;
        const x = ((sample.at - start) / WINDOW_MS) * w;
        ctx.fillRect(x - 1, 1, 2, 9);
      });
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.moveTo(0, graphH + 0.5);
    ctx.lineTo(w, graphH + 0.5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(174,191,202,0.8)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('10s', 6, h - 8);
    ctx.fillText(state.timelinePaused ? 'paused' : 'now', w - (state.timelinePaused ? 48 : 30), h - 8);

    const vad = snapshot?.vad || {};
    if (Number.isFinite(Number(vad.silence_reset_timeout_ms)) || Number.isFinite(Number(vad.reset_timeout_ms))) {
      const silenceText = Number.isFinite(Number(vad.silence_age_ms)) && Number(vad.silence_reset_timeout_ms) > 0
        ? ` quiet ${Math.round(Number(vad.silence_age_ms))}/${Number(vad.silence_reset_timeout_ms)} ms`
        : '';
      const voiceText = Number.isFinite(Number(vad.last_voice_age_ms)) && Number(vad.reset_timeout_ms) > 0
        ? ` voice ${Math.round(Number(vad.last_voice_age_ms))}/${Number(vad.reset_timeout_ms)} ms`
        : '';
      const stageText = vad.candidate_confirmed ? ' strong' : (vad.candidate_active ? ' candidate' : '');
      const armText = snapshot?.vad_speech_start_reset_armed === false ? ' gated' : ' armed';
      ctx.font = '11px system-ui, sans-serif';
      drawPill(ctx, `VAD ${vad.speaking ? 'speech' : 'quiet'}${stageText}${armText}${silenceText}${voiceText}`, w - 315, 8, {
        canvasWidth: w,
        maxWidth: 300,
        background: vad.speaking ? 'rgba(21, 128, 61, 0.28)' : 'rgba(16, 24, 38, 0.9)',
        border: vad.speaking ? 'rgba(34,197,94,0.62)' : 'rgba(192,132,252,0.5)',
        color: '#f1f7fa',
      });
    }

    const actions = Array.isArray(snapshot?.recent_actions) ? snapshot.recent_actions : [];
    let lastLabelX = -999;
    actions.filter(action => action.at_ms >= start).forEach(action => {
      const x = ((action.at_ms - start) / WINDOW_MS) * w;
      const color = eventColor(action.type);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, graphH + 5);
      ctx.lineTo(x, graphH + 28);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, graphH + 10, 3, 0, Math.PI * 2);
      ctx.fill();
      if (x - lastLabelX > 74) {
        const label = action.type === 'stateChanged'
          ? (action.next_state || action.type)
          : action.type === 'resetStt'
            ? `STT reset: ${action.reason || 'reset'}`
          : action.type === 'micError'
            ? `input/STT error: ${action.error || action.detail || ''}`
            : action.type;
        ctx.fillStyle = '#dce8ed';
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText(String(label || '').slice(0, 18), Math.min(w - 110, x + 4), graphH + 30);
        lastLabelX = x;
      }
    });
    drawSttTimeline(ctx, start, WINDOW_MS, w, graphH, h, snapshot);
    ctx.restore();
  }

  function start() {
    if (state.open) return;
    state.open = true;
    loadControls().catch(error => status(error.message || String(error)));
    if (!window.WakeToTalkController?.getDebugSnapshot) {
      fetchApiDebug().then(poll).catch(() => {});
      state.apiTimer = window.setInterval(() => {
        fetchApiDebug().then(poll).catch(() => {});
      }, 2500);
    }
    state.pollTimer = window.setInterval(poll, POLL_MS);
    state.drawTimer = window.setInterval(drawWaveform, DRAW_MS);
    poll();
    drawWaveform();
  }

  function stop() {
    state.open = false;
    if (state.pollTimer) window.clearInterval(state.pollTimer);
    if (state.apiTimer) window.clearInterval(state.apiTimer);
    if (state.drawTimer) window.clearInterval(state.drawTimer);
    if (state.saveTimer) window.clearTimeout(state.saveTimer);
    state.pollTimer = null;
    state.apiTimer = null;
    state.drawTimer = null;
    state.saveTimer = null;
    if (state.timelinePaused) toggleTimelinePause();
    if (state.probe.enabled || state.probe.ws) disableProbeMode();
    if (state.vadProbe.enabled || state.vadProbe.ws) disableVadProbeMode();
    if (state.rearmProbe.enabled || state.rearmProbe.ws) disableRearmProbeMode();
  }

  function open() {
    if (!els.modal) return;
    renderControlState();
    const vm = voiceMode();
    if (typeof vm?.reconcile === 'function') {
      vm.reconcile().then(renderControlState).catch(() => {});
    }
    if (typeof HubModal !== 'undefined') {
      HubModal.open(els.modal, { onOpen: start, onClose: stop });
    } else if (typeof els.modal.showModal === 'function') {
      els.modal.showModal();
      start();
    }
  }

  function bind() {
    els.modal = el('wake-dev-modal');
    if (!els.modal) return;
    els.browserMeta = el('wake-dev-browser-meta');
    els.activate = el('wake-dev-activate-btn');
    els.wakeToggle = el('wake-dev-stt-wake-toggle');
    els.noiseToggle = el('wake-dev-noise-toggle');
    els.noiseLevel = el('wake-dev-noise-level');
    els.noiseLevelLabel = el('wake-dev-noise-level-label');
    els.aggregation = el('wake-dev-aggregation-timeout');
    els.aggregationLabel = el('wake-dev-aggregation-label');
    els.vadReset = el('wake-dev-vad-reset-timeout');
    els.vadResetLabel = el('wake-dev-vad-reset-label');
    els.silenceReset = el('wake-dev-silence-reset-timeout');
    els.silenceResetLabel = el('wake-dev-silence-reset-label');
    els.testMode = el('wake-dev-test-mode');
    els.testRecord = el('wake-dev-test-record');
    els.testStop = el('wake-dev-test-stop');
    els.testClear = el('wake-dev-test-clear');
    els.testStatus = el('wake-dev-test-status');
    els.vadTestMode = el('wake-dev-vad-test-mode');
    els.vadRecordToggle = el('wake-dev-vad-test-record-vad');
    els.vadStopToggle = el('wake-dev-vad-test-stop-vad');
    els.vadTestRecord = el('wake-dev-vad-test-record');
    els.vadTestStop = el('wake-dev-vad-test-stop');
    els.vadTestClear = el('wake-dev-vad-test-clear');
    els.vadTestStatus = el('wake-dev-vad-test-status');
    els.vadTranscript = el('wake-dev-vad-transcript');
    els.rearmTestMode = el('wake-dev-rearm-test-mode');
    els.rearmRecordToggle = el('wake-dev-rearm-test-record-vad');
    els.rearmStopToggle = el('wake-dev-rearm-test-stop-vad');
    els.rearmTestRecord = el('wake-dev-rearm-test-record');
    els.rearmTestStop = el('wake-dev-rearm-test-stop');
    els.rearmTestClear = el('wake-dev-rearm-test-clear');
    els.rearmTestStatus = el('wake-dev-rearm-test-status');
    els.rearmTranscript = el('wake-dev-rearm-transcript');
    els.outputView = el('wake-dev-output-view');
    els.wakeWord = el('wake-dev-wake-word');
    els.matrixRoom = el('wake-dev-matrix-room');
    els.postWake = el('wake-dev-post-wake');
    els.postWakeLabel = el('wake-dev-post-wake-label');
    els.initialCancel = el('wake-dev-initial-cancel');
    els.initialCancelLabel = el('wake-dev-initial-cancel-label');
    els.pauseReset = el('wake-dev-pause-reset');
    els.pauseResetLabel = el('wake-dev-pause-reset-label');
    els.autoExecute = el('wake-dev-auto-execute');
    els.autoExecuteLabel = el('wake-dev-auto-execute-label');
    els.pauseCommand = el('wake-dev-pause-command');
    els.resumeCommand = el('wake-dev-resume-command');
    els.executeCommand = el('wake-dev-execute-command');
    els.cancelCommand = el('wake-dev-cancel-command');
    els.status = el('wake-dev-status');
    els.fsmState = el('wake-dev-fsm-state');
    els.session = el('wake-dev-session');
    els.instance = el('wake-dev-instance');
    els.frames = el('wake-dev-frames');
    els.age = el('wake-dev-age');
    els.db = el('wake-dev-db');
    els.debugSource = el('wake-dev-debug-source');
    els.pauseTimeline = el('wake-dev-pause-timeline');
    els.canvas = el('wake-dev-wave-canvas');
    els.states = el('wake-dev-states');
    els.sttEvents = el('wake-dev-stt-events');
    els.transcript = el('wake-dev-transcript');
    els.inputQueue = el('wake-dev-input-queue');
    els.pendingQueue = el('wake-dev-pending-queue');
    els.messageQueue = el('wake-dev-message-queue');
    els.sendSnapshot = el('wake-dev-send-snapshot');
    els.actionLog = el('wake-dev-action-log');

    els.activate?.addEventListener('click', toggleActive);
    els.pauseTimeline?.addEventListener('click', toggleTimelinePause);
    els.testMode?.addEventListener('click', () => {
      if (state.probe.enabled) disableProbeMode();
      else void enableProbeMode();
    });
    els.testRecord?.addEventListener('click', () => { void startProbeRecording(); });
    els.testStop?.addEventListener('click', stopProbeRecording);
    els.testClear?.addEventListener('click', clearProbe);
    els.vadTestMode?.addEventListener('click', () => {
      if (state.vadProbe.enabled) disableVadProbeMode();
      else void enableVadProbeMode();
    });
    els.vadRecordToggle?.addEventListener('click', toggleVadRecordMode);
    els.vadStopToggle?.addEventListener('click', toggleVadStopMode);
    els.vadTestRecord?.addEventListener('click', () => { void startVadProbeRecording({ reason: 'manual_record' }); });
    els.vadTestStop?.addEventListener('click', () => stopVadProbeRecording('manual_stop'));
    els.vadTestClear?.addEventListener('click', clearVadProbe);
    els.rearmTestMode?.addEventListener('click', () => {
      if (state.rearmProbe.enabled) disableRearmProbeMode();
      else void enableRearmProbeMode();
    });
    els.rearmRecordToggle?.addEventListener('click', toggleRearmRecordMode);
    els.rearmStopToggle?.addEventListener('click', toggleRearmStopMode);
    els.rearmTestRecord?.addEventListener('click', () => { void startRearmProbeRecording({ reason: 'manual_record' }); });
    els.rearmTestStop?.addEventListener('click', () => stopRearmProbeRecording('manual_stop'));
    els.rearmTestClear?.addEventListener('click', clearRearmProbe);
    els.wakeToggle?.addEventListener('change', () => {
      setWakeMode(els.wakeToggle.checked);
      status(els.wakeToggle.checked ? 'Wake to Talk selected. Activate this browser to run it.' : 'Wake to Talk deselected.');
      window.setTimeout(renderControlState, 50);
    });
    els.noiseToggle?.addEventListener('change', () => {
      voiceMode()?.setSttNoiseReductionEnabled?.(els.noiseToggle.checked);
      renderControlState();
    });
    els.noiseLevel?.addEventListener('input', () => {
      const level = Number(els.noiseLevel.value || 6);
      setText(els.noiseLevelLabel, `${level.toFixed(1)} dB`);
      voiceMode()?.setSttNoiseLevelDb?.(level);
    });
    els.aggregation?.addEventListener('input', renderRangeLabels);
    els.aggregation?.addEventListener('change', () => {
      voiceMode()?.saveAggregationTimeout?.(els.aggregation.value)
        ?.then(() => status('Speech aggregation saved.'))
        ?.catch(error => status(`Aggregation save failed: ${error.message || error}`));
    });
    els.vadReset?.addEventListener('input', renderRangeLabels);
    els.vadReset?.addEventListener('change', () => {
      voiceMode()?.saveVadResetTimeout?.(els.vadReset.value)
        ?.then(() => status('VAD reset timeout saved.'))
        ?.catch(error => status(`VAD reset save failed: ${error.message || error}`));
    });
    els.silenceReset?.addEventListener('input', renderRangeLabels);
    els.silenceReset?.addEventListener('change', () => {
      voiceMode()?.saveSilenceResetTimeout?.(els.silenceReset.value)
        ?.then(() => status('Silence reset interval saved.'))
        ?.catch(error => status(`Silence reset save failed: ${error.message || error}`));
    });
    [
      els.wakeWord,
      els.matrixRoom,
      els.postWake,
      els.initialCancel,
      els.pauseReset,
      els.autoExecute,
      els.pauseCommand,
      els.resumeCommand,
      els.executeCommand,
      els.cancelCommand,
    ].forEach(control => {
      control?.addEventListener('input', scheduleWakeSave);
      control?.addEventListener('change', scheduleWakeSave);
    });
    window.addEventListener('blueprints:voice-mode:wake-runtime', onRuntime);
    window.addEventListener('blueprints:voice-mode:changed', () => {
      renderControlState();
    });
    window.addEventListener('blueprints:voice-mode:wake-settings-changed', (event) => {
      if (!state.open) return;
      const settings = event.detail?.wake_settings;
      if (settings) {
        renderWakeSettings(settings);
        loadRooms(settings.instances?.local?.matrix_room_id || '').catch(() => {});
      }
    });
    els.modal.addEventListener('close', stop);
    renderStates('');
    renderProbeUi();
    renderRearmProbeUi();
    ensureOutputView();
    renderControlState();
  }

  document.addEventListener('DOMContentLoaded', bind);

  return {
    open,
    start,
    stop,
  };
})();

window.WakeDevModal = WakeDevModal;
