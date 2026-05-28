// wake-to-talk.js — global Wake to Talk microphone/STT controller.

'use strict';

const WakeToTalkController = (() => {
  const TAB_ID = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const AUDIO_SAMPLE_RATE = 16000;
  const AUDIO_BUFFER_SIZE = 4096;
  const SPEECH_LEVEL_THRESHOLD = 0.035;
  const CONTROL_CHANNEL = 'blueprints.voice.wake-to-talk';
  const STT_RECONNECT_MIN_DELAY_MS = 500;
  const STT_RECONNECT_MAX_DELAY_MS = 5000;
  const STT_RESET_FINAL_GRACE_MS = 3200;
  const STT_DELAY_FRAMES = 2;
  const VAD_STRONG_ENTER_MULTIPLIER = 5;
  const VAD_ABSOLUTE_FLOOR = 0.0012;
  const VAD_EXIT_HANGOVER_MS = 180;
  const DEBUG_SNAPSHOT_URL = '/api/v1/voice-mode/wake-debug';

  const state = {
    initialized: false,
    running: false,
    starting: false,
    settings: null,
    machine: null,
    timers: new Map(),
    ws: null,
    activeSegmentId: '',
    audioContext: null,
    sourceNode: null,
    processorNode: null,
    stream: null,
    audioBytesSent: 0,
    audioFramesSent: 0,
    audioFramesCaptured: 0,
    lastSpeechAt: 0,
    channel: null,
    peerActiveUntil: 0,
    runtimeReason: '',
    sttConnecting: null,
    sttReconnectTimer: null,
    sttReconnectAttempts: 0,
    sttResetRequested: false,
    sttResetTimer: null,
    sttResetPendingReason: '',
    sttReconnectOnClose: false,
    sttSpeechStartResetPending: false,
    startDelayedStreamOnOpen: false,
    sttSegmentActive: false,
    segmentController: null,
    segmentFinalTimer: null,
    vadSpeechStartResetArmed: true,
    audioDelayBuffer: [],
    audioCandidateBuffer: [],
    streamEpoch: 0,
    sttClassifier: null,
    vad: {
      noiseFloor: 0,
      speaking: false,
      speechSeenSinceReset: false,
      lastVoiceAt: 0,
      lastResetAt: 0,
      lastEnergy: 0,
      enterThreshold: 0,
      exitThreshold: 0,
      strongEnterThreshold: 0,
      strongSpeechSeen: false,
      candidateActive: false,
      candidateConfirmed: false,
      lastTimeoutReason: '',
    },
    activationCheckTimer: null,
    lastAction: null,
    recentActions: [],
    recentSttEvents: [],
    debugReportTimer: null,
    debugHeartbeatTimer: null,
    lastDebugReportAt: 0,
    lastAudioFeatures: { rms: 0, peak: 0, vadEnergy: 0, level: 0 },
  };

  function publishRuntime(fsmState = state.machine?.getState?.() || '', level = 0, reason = state.runtimeReason) {
    const activeSelectedWake = window.BlueprintsVoiceMode?.ownsActiveSttMode?.('wake_to_talk') === true;
    window.dispatchEvent(new CustomEvent('blueprints:voice-mode:wake-runtime', {
      detail: {
        state: fsmState || '',
        reason: reason || '',
        running: state.running,
        starting: state.starting,
        level: Math.max(0, Math.min(1, Number(level) || 0)),
        audio_rms: Number(state.lastAudioFeatures?.rms || 0),
        audio_peak: Number(state.lastAudioFeatures?.peak || 0),
        vad_energy: Number(state.lastAudioFeatures?.vadEnergy || 0),
        stt_mode: window.BlueprintsVoiceMode?.sttMode?.() || '',
        active_owner: window.BlueprintsVoiceMode?.isActiveOwner?.() === true,
        active_selected_wake: activeSelectedWake,
        room_ready: activeWakeInstances().some(([, instance]) => instance.matrix_room_id),
      },
    }));
  }

  function settingsIndicatorTargets() {
    return Array.from(document.querySelectorAll('.bp-ns-action-btn[data-action="settings"]'));
  }

  function setSettingsIndicatorState(normalizedState) {
    document.querySelectorAll('.wake-to-talk-target').forEach(el => {
      el.classList.remove('wake-to-talk-target');
      delete el.dataset.wakeState;
    });
    settingsIndicatorTargets().forEach(button => {
      if (!button) return;
      if (normalizedState) {
        button.classList.add('wake-to-talk-target');
        button.dataset.wakeState = normalizedState;
      }
    });
  }

  function setVisual(fsmState, level = 0, reason = '') {
    const root = document.documentElement;
    const normalized = String(fsmState || '').toLowerCase().replace(/_/g, '-');
    if (normalized && normalized !== 'disabled' && normalized !== 'selected-inactive') {
      root.dataset.wakeToTalkState = normalized;
    } else {
      delete root.dataset.wakeToTalkState;
    }
    setSettingsIndicatorState(normalized && normalized !== 'disabled' && normalized !== 'selected-inactive' ? normalized : '');
    root.style.setProperty('--wake-to-talk-level', Math.max(0, Math.min(1, Number(level) || 0)).toFixed(3));
    if (reason) state.runtimeReason = reason;
    publishRuntime(fsmState, level);
  }

  function timerKey(name, sessionId = '') {
    return `${name}:${sessionId || 0}`;
  }

  function clearTimer(name, sessionId = '') {
    const key = timerKey(name, sessionId);
    const timer = state.timers.get(key);
    if (timer) window.clearTimeout(timer);
    state.timers.delete(key);
  }

  function clearTimerName(name) {
    Array.from(state.timers.keys()).forEach(key => {
      if (key === timerKey(name, 0) || key.startsWith(`${name}:`)) {
        const timer = state.timers.get(key);
        if (timer) window.clearTimeout(timer);
        state.timers.delete(key);
      }
    });
  }

  function startTimer(name, ms, sessionId = '') {
    clearTimerName(name);
    const key = timerKey(name, sessionId);
    state.timers.set(key, window.setTimeout(() => {
      state.timers.delete(key);
      state.machine?.dispatch('timerElapsed', { timer: name, session_id: sessionId });
    }, Math.max(0, Number(ms) || 0)));
  }

  function clearAllTimers() {
    Array.from(state.timers.keys()).forEach(key => {
      const timer = state.timers.get(key);
      if (timer) window.clearTimeout(timer);
      state.timers.delete(key);
    });
  }

  function clearActivationCheckTimer() {
    if (state.activationCheckTimer) window.clearInterval(state.activationCheckTimer);
    state.activationCheckTimer = null;
  }

  function startActivationCheckTimer() {
    clearActivationCheckTimer();
    state.activationCheckTimer = window.setInterval(() => {
      verifyAuthoritativeActivation().catch(() => {});
    }, 4000);
  }

  async function verifyAuthoritativeActivation() {
    if (typeof window.BlueprintsVoiceMode?.reconcile !== 'function') return true;
    const serverState = await window.BlueprintsVoiceMode.reconcile();
    const active = serverState?.active || null;
    const browserId = window.BlueprintsVoiceMode?.getBrowserId?.() || '';
    if (!active || active.browser_id !== browserId) {
      state.runtimeReason = active ? 'Another browser is activated for Voice Mode.' : 'Voice Mode is not activated.';
      state.machine?.dispatch('activationChanged', { stt_mode: 'wake_to_talk', activated: false });
      stop('activation-lost');
      return false;
    }
    if (window.BlueprintsVoiceMode?.ownsActiveSttMode?.('wake_to_talk') !== true) {
      state.runtimeReason = window.BlueprintsVoiceMode?.isActiveOwner?.() === true
        ? 'Wake to Talk is not selected.'
        : 'This browser is not activated for Voice Mode.';
      state.machine?.dispatch('activationChanged', { stt_mode: window.BlueprintsVoiceMode?.sttMode?.() || '', activated: false });
      stop('wake-activation-inactive');
      return false;
    }
    return true;
  }

  function apiJson(url, options = {}) {
    return apiFetch(url, options).then(async response => {
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false) throw new Error(payload?.detail || `HTTP ${response.status}`);
      return payload;
    });
  }

  function debugSnapshot() {
    return {
      browser_id: window.BlueprintsVoiceMode?.getBrowserId?.() || '',
      browser_label: document.title || 'Blueprints browser',
      tab_id: TAB_ID,
      running: state.running,
      starting: state.starting,
      reason: state.runtimeReason || '',
      fsm_state: state.machine?.getState?.() || '',
      session_id: state.machine?.getSessionId?.() || 0,
      active_instance_id: state.machine?.getActiveInstanceId?.() || '',
      active_send: state.machine?.getActiveSend?.() || {},
      queues: state.machine?.getQueues?.() || { input_queue: [], message_queue: [] },
      transcript: state.machine?.getTranscript?.() || '',
      frozen_send_snapshot: state.machine?.getFrozenSendSnapshot?.() || {},
      command_diagnostics: state.machine?.getCommandDiagnostics?.() || {},
      last_action: state.lastAction || {},
      recent_actions: state.recentActions.slice(-40),
      recent_stt_events: state.recentSttEvents.slice(-160),
      stream_epoch: state.streamEpoch,
      audio_frames_sent: state.audioFramesSent,
      audio_frames_captured: state.audioFramesCaptured,
      stt_reset_pending_reason: state.sttResetPendingReason || '',
      stt_speech_start_reset_pending: !!state.sttSpeechStartResetPending,
      vad_speech_start_reset_armed: !!state.vadSpeechStartResetArmed,
      audio_delay_frames: state.audioDelayBuffer.length,
      audio_candidate_frames: state.audioCandidateBuffer.length,
      stt_delay_frames: STT_DELAY_FRAMES,
      stt_segment_active: !!state.sttSegmentActive,
      stt_segment: state.segmentController?.getDebugSnapshot?.() || {},
      audio_features: {
        rms: Number(state.lastAudioFeatures?.rms || 0),
        peak: Number(state.lastAudioFeatures?.peak || 0),
        vad_energy: Number(state.lastAudioFeatures?.vadEnergy || 0),
        display_level: Number(state.lastAudioFeatures?.level || 0),
      },
      vad: {
        speaking: !!state.vad.speaking,
        speech_seen_since_reset: !!state.vad.speechSeenSinceReset,
        last_voice_age_ms: state.vad.lastVoiceAt ? Math.max(0, Date.now() - state.vad.lastVoiceAt) : null,
        reset_age_ms: state.vad.lastResetAt ? Math.max(0, Date.now() - state.vad.lastResetAt) : null,
        silence_age_ms: state.vad.speaking ? 0 : Math.max(0, Date.now() - (state.vad.lastVoiceAt || state.vad.lastResetAt || Date.now())),
        energy: Number(state.vad.lastEnergy || 0),
        noise_floor: Number(state.vad.noiseFloor || 0),
        enter_threshold: Number(state.vad.enterThreshold || 0),
        exit_threshold: Number(state.vad.exitThreshold || 0),
        strong_enter_threshold: Number(state.vad.strongEnterThreshold || 0),
        strong_multiplier: VAD_STRONG_ENTER_MULTIPLIER,
        strong_speech_seen: !!state.vad.strongSpeechSeen,
        candidate_active: !!state.vad.candidateActive,
        candidate_confirmed: !!state.vad.candidateConfirmed,
        reset_timeout_ms: vadResetTimeoutMs(),
        silence_reset_timeout_ms: 0,
        last_timeout_reason: state.vad.lastTimeoutReason || '',
      },
      client_now_ms: Date.now(),
    };
  }

  function clippedText(value, limit = 240) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > limit ? `${text.slice(0, limit)}...` : text;
  }

  function sttPayloadText(payload) {
    if (!payload || typeof payload !== 'object') return '';
    const direct = payload.text ?? payload.transcript ?? payload.partial ?? payload.final ?? payload.result_text;
    if (direct != null) return String(direct || '');
    const result = payload.result && typeof payload.result === 'object' ? payload.result : null;
    if (result?.text != null) return String(result.text || '');
    const alternatives = Array.isArray(payload.alternatives) ? payload.alternatives : [];
    if (alternatives[0]?.text != null) return String(alternatives[0].text || '');
    return '';
  }

  function pushRecent(key, item, limit = 40) {
    const list = state[key];
    if (!Array.isArray(list)) return;
    list.push({ at_ms: Date.now(), ...item });
    while (list.length > limit) list.shift();
  }

  function reportWakeDebug(action = null, force = false) {
    if (action) {
      if (!['sttPayload', 'sendPcmFrame'].includes(action.type)) state.lastAction = action;
      if (!['heartbeat', 'sttPayload', 'sendPcmFrame'].includes(action.type)) pushRecent('recentActions', action);
    }
    if (!window.BlueprintsVoiceMode?.getBrowserId) return;
    const elapsed = Date.now() - state.lastDebugReportAt;
    const send = () => {
      if (state.debugReportTimer) window.clearTimeout(state.debugReportTimer);
      state.debugReportTimer = null;
      state.lastDebugReportAt = Date.now();
      apiJson(DEBUG_SNAPSHOT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(debugSnapshot()),
      }).catch(() => {});
    };
    if (force || elapsed >= 250) {
      send();
    } else if (!state.debugReportTimer) {
      state.debugReportTimer = window.setTimeout(send, Math.max(50, 250 - elapsed));
    }
  }

  function startDebugHeartbeat() {
    if (state.debugHeartbeatTimer) window.clearInterval(state.debugHeartbeatTimer);
    state.debugHeartbeatTimer = window.setInterval(() => {
      if (state.running || state.starting) {
        reportWakeDebug({ type: 'heartbeat' }, true);
      }
    }, 1000);
  }

  function clearDebugHeartbeat() {
    if (state.debugHeartbeatTimer) window.clearInterval(state.debugHeartbeatTimer);
    state.debugHeartbeatTimer = null;
  }

  function activeWakeInstances() {
    const settings = window.BlueprintsVoiceMode?.getWakeSettings?.() || state.settings || {};
    const instances = settings?.instances || settings?.wake_to_talk?.instances || {};
    return Object.entries(instances);
  }

  function firstServerId() {
    return activeWakeInstances()[0]?.[1]?.matrix_server || 'tb1';
  }

  async function sttWebSocketUrl() {
    const url = new URL('/api/v1/voice-mode/stt/ws', window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('server', firstServerId());
    if (window.BlueprintsVoiceMode?.sttNoiseReductionEnabled?.()) {
      url.searchParams.set('noise_reduction', '1');
      const levelDb = window.BlueprintsVoiceMode?.sttNoiseReductionLevelDb?.();
      if (Number.isFinite(levelDb)) url.searchParams.set('atten_lim_db', String(levelDb));
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
        reject(new Error('Wake STT connection timed out'));
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
        reject(new Error('Wake STT connection failed'));
      };
      socket.addEventListener('open', onOpen);
      socket.addEventListener('error', onError);
    });
  }

  function downsampleFloat32(input, inputRate, outputRate = AUDIO_SAMPLE_RATE) {
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

  function pushAudioDelayFrame(pcm) {
    if (!pcm?.byteLength) return;
    state.audioDelayBuffer.push(pcm);
    while (state.audioDelayBuffer.length > STT_DELAY_FRAMES) state.audioDelayBuffer.shift();
  }

  function sendPcmFrame(ws, pcm, delayed = false) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !pcm?.byteLength) return false;
    try {
      state.audioBytesSent += pcm.byteLength;
      state.audioFramesSent += 1;
      ws.send(pcm.buffer);
      if (delayed) state.lastSpeechAt = Date.now();
      return true;
    } catch (_) {
      return false;
    }
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

  function vadResetTimeoutMs() {
    return Number(window.BlueprintsVoiceMode?.vadResetTimeoutMs?.() || 0) || 0;
  }

  function resetVadCandidate(notifySegment = true) {
    if (notifySegment) state.segmentController?.dispatch?.('vadCandidateReject', { reason: 'candidate_reset' });
    state.vad.candidateActive = false;
    state.vad.candidateConfirmed = false;
    state.vad.strongSpeechSeen = false;
    state.audioCandidateBuffer = [];
  }

  function startVadCandidate() {
    state.vad.candidateActive = true;
    state.vad.candidateConfirmed = false;
    state.vad.strongSpeechSeen = false;
    state.audioCandidateBuffer = state.audioDelayBuffer.slice(-STT_DELAY_FRAMES);
    state.segmentController?.dispatch?.('vadCandidateStart', { reason: 'vad_candidate_start' });
  }

  function rearmVadSpeechStartReset() {
    state.vadSpeechStartResetArmed = true;
    resetVadCandidate(false);
  }

  function resetVadState(now = Date.now()) {
    state.vad.speaking = false;
    state.vad.speechSeenSinceReset = false;
    state.vad.lastVoiceAt = 0;
    state.vad.lastResetAt = now;
    resetVadCandidate(false);
  }

  function updateVad(features, now = Date.now()) {
    const timeoutMs = vadResetTimeoutMs();
    const energy = Number(features?.vadEnergy || 0);
    if (!state.vad.noiseFloor) {
      state.vad.noiseFloor = Math.max(0.0005, Math.min(0.02, energy || 0.002));
    }
    const enterThreshold = Math.max(VAD_ABSOLUTE_FLOOR, (state.vad.noiseFloor * 4.0) + 0.00045);
    const exitThreshold = Math.max(VAD_ABSOLUTE_FLOOR * 0.65, (state.vad.noiseFloor * 2.2) + 0.00025);
    const strongEnterThreshold = enterThreshold * VAD_STRONG_ENTER_MULTIPLIER;
    const strongLevelThreshold = SPEECH_LEVEL_THRESHOLD * VAD_STRONG_ENTER_MULTIPLIER;
    const level = Number(features?.level || 0);
    const speechNow = energy >= enterThreshold || level >= SPEECH_LEVEL_THRESHOLD;
    const strongSpeechNow = energy >= strongEnterThreshold || level >= strongLevelThreshold;
    const speechStarted = speechNow && !state.vad.speaking;
    state.vad.lastEnergy = energy;
    state.vad.enterThreshold = enterThreshold;
    state.vad.exitThreshold = exitThreshold;
    state.vad.strongEnterThreshold = strongEnterThreshold;

    if (speechNow) {
      state.vad.speaking = true;
      state.vad.speechSeenSinceReset = true;
      state.vad.lastVoiceAt = now;
    } else if (state.vad.speaking && now - state.vad.lastVoiceAt > VAD_EXIT_HANGOVER_MS) {
      state.vad.speaking = false;
    }

    if (!state.vad.speaking && energy < exitThreshold) {
      state.vad.noiseFloor = (state.vad.noiseFloor * 0.985) + (energy * 0.015);
    }

    if (speechStarted) {
      startVadCandidate();
    }

    if (state.vad.candidateActive && !state.vad.candidateConfirmed && strongSpeechNow) {
      state.vad.candidateConfirmed = true;
      state.vad.strongSpeechSeen = true;
    }

    if (
      state.vad.candidateConfirmed
      && state.vadSpeechStartResetArmed
      && !state.sttSpeechStartResetPending
      && !state.sttResetPendingReason
    ) {
      state.vadSpeechStartResetArmed = false;
      state.sttSpeechStartResetPending = true;
      state.segmentController?.dispatch?.('vadSpeechStart', {
        reason: 'vad_speech_start',
        audio_frame: state.audioFramesCaptured,
        delay_frames: STT_DELAY_FRAMES,
        queued_frames: state.audioCandidateBuffer.length,
        start_threshold: 'strong_confirmed',
        strong_multiplier: VAD_STRONG_ENTER_MULTIPLIER,
        at: now,
      });
      reportWakeDebug({
        type: 'vadSpeechStart',
        reason: 'vad_speech_start',
        delay_frames: STT_DELAY_FRAMES,
        queued_frames: state.audioCandidateBuffer.length,
        start_threshold: 'strong_confirmed',
        strong_multiplier: VAD_STRONG_ENTER_MULTIPLIER,
      }, true);
      return;
    }

    if (
      timeoutMs > 0
      && state.vad.candidateActive
      && !state.vad.candidateConfirmed
      && ['IDLE', 'CANDIDATE'].includes(state.segmentController?.getState?.() || '')
      && !state.vad.speaking
      && state.vad.lastVoiceAt
      && now - state.vad.lastVoiceAt >= timeoutMs
    ) {
      state.segmentController?.dispatch?.('vadCandidateReject', { reason: 'weak_candidate_timeout' });
      resetVadCandidate(false);
    }

    if (
      timeoutMs > 0
      && ['OPENING', 'STREAMING'].includes(state.segmentController?.getState?.() || '')
      && state.vad.speechSeenSinceReset
      && !state.vad.speaking
      && state.vad.lastVoiceAt
      && now - state.vad.lastVoiceAt >= timeoutMs
      && now - state.vad.lastResetAt > 250
    ) {
      state.vad.lastTimeoutReason = 'vad_timeout';
      state.segmentController?.dispatch?.('vadSpeechEnd', {
        reason: 'vad_timeout',
        timeout_ms: timeoutMs,
        audio_frame: state.audioFramesCaptured,
        delay_frames: STT_DELAY_FRAMES,
        queued_frames: state.audioCandidateBuffer.length,
        at: now,
      });
      state.vad.speaking = false;
      state.vad.speechSeenSinceReset = false;
      state.vad.lastResetAt = now;
      resetVadCandidate(false);
      reportWakeDebug({
        type: 'vadSpeechEnd',
        reason: 'vad_timeout',
        timeout_ms: timeoutMs,
      }, true);
      return;
    }
  }

  function audioInputLevel(input) {
    return audioFeatures(input).level || 0;
  }

  async function sendMatrixExecute(action) {
    if (!action.matrix_room_id) throw new Error(`No Matrix room selected for ${action.instance_id}`);
    const url = new URL(`/api/v1/matrix-chat/rooms/${encodeURIComponent(action.matrix_room_id)}/messages`, window.location.origin);
    url.searchParams.set('server', action.matrix_server || 'tb1');
    await apiJson(`${url.pathname}${url.search}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: action.body }),
    });
  }

  function clearSttReconnectTimer() {
    if (state.sttReconnectTimer) window.clearTimeout(state.sttReconnectTimer);
    state.sttReconnectTimer = null;
  }

  function clearSttResetTimer() {
    if (state.sttResetTimer) window.clearTimeout(state.sttResetTimer);
    state.sttResetTimer = null;
  }

  function clearSegmentFinalTimer() {
    if (state.segmentFinalTimer) window.clearTimeout(state.segmentFinalTimer);
    state.segmentFinalTimer = null;
  }

  function handleSegmentAction(action) {
    if (!action) return;
    reportWakeDebug(action, ['openSttSegment', 'sendEnd', 'emitUtteranceFinal', 'closeSegment'].includes(action.type));
    if (action.type === 'segmentStateChanged') {
      const next = action.next_state || action.segment_state || '';
      state.sttSegmentActive = next === 'STREAMING';
      state.sttSpeechStartResetPending = next === 'OPENING';
      if (next === 'IDLE') {
        state.vadSpeechStartResetArmed = true;
        state.sttSpeechStartResetPending = false;
        state.sttSegmentActive = false;
      }
      return;
    }
    if (action.type === 'openSttSegment') {
      state.activeSegmentId = action.segment_id || '';
      state.sttSpeechStartResetPending = true;
      state.sttSegmentActive = false;
      if (state.ws && state.ws.readyState !== WebSocket.CLOSED && state.ws.readyState !== WebSocket.CLOSING) {
        state.sttResetRequested = true;
        try { state.ws.close(4000, 'new-segment'); } catch (_) {}
      }
      connectSttSocket(action.segment_id).catch(error => {
        state.runtimeReason = error.message || String(error);
        state.segmentController?.dispatch?.('segmentTimeout', {
          segment_id: action.segment_id,
          reason: 'socket_open_failed',
        });
      });
      return;
    }
    if (action.type === 'sendPcmFrame') {
      if (action.segment_id !== state.activeSegmentId) return;
      sendPcmFrame(state.ws, action.frame?.pcm, action.source === 'pre_roll');
      return;
    }
    if (action.type === 'sendEnd') {
      if (action.segment_id !== state.activeSegmentId || state.ws?.readyState !== WebSocket.OPEN) {
        state.segmentController?.dispatch?.('segmentTimeout', {
          segment_id: action.segment_id,
          reason: 'socket_not_open_on_end',
        });
        return;
      }
      state.sttSegmentActive = false;
      state.sttSpeechStartResetPending = false;
      try {
        state.ws.send(JSON.stringify({
          type: 'end',
          reason: action.reason || 'vad_timeout',
          audio_frames: action.audio_frames,
          audio_bytes: action.audio_bytes,
        }));
      } catch (_) {
        state.segmentController?.dispatch?.('segmentTimeout', {
          segment_id: action.segment_id,
          reason: 'end_send_failed',
        });
      }
      return;
    }
    if (action.type === 'startFinalTimer') {
      clearSegmentFinalTimer();
      state.segmentFinalTimer = window.setTimeout(() => {
        state.segmentFinalTimer = null;
        state.segmentController?.dispatch?.('segmentTimeout', {
          segment_id: action.segment_id,
          reason: action.reason || 'final_timeout',
        });
      }, Math.max(0, Number(action.ms || STT_RESET_FINAL_GRACE_MS) || STT_RESET_FINAL_GRACE_MS));
      return;
    }
    if (action.type === 'clearFinalTimer') {
      clearSegmentFinalTimer();
      return;
    }
    if (action.type === 'sttPartial') {
      const event = state.sttClassifier?.classify?.(
        {
          ...(action.raw || {}),
          type: 'partial',
          text: action.text || '',
          utterance_id: action.segment_id,
          audio_end_frame: state.audioFramesCaptured,
        },
        {
          stream_epoch: state.streamEpoch,
          audio_end_frame: state.audioFramesCaptured,
        }
      );
      if (event) state.machine?.dispatch('speechHypothesis', event);
      return;
    }
    if (action.type === 'emitUtteranceFinal') {
      const event = state.sttClassifier?.classify?.(
        {
          ...(action.raw || {}),
          type: 'final',
          text: action.text || '',
          utterance_id: action.segment_id,
          audio_end_frame: state.audioFramesCaptured,
        },
        {
          stream_epoch: state.streamEpoch,
          audio_end_frame: state.audioFramesCaptured,
        }
      );
      if (event) state.machine?.dispatch('speechHypothesis', event);
      return;
    }
    if (action.type === 'closeSegment') {
      if (action.segment_id === state.activeSegmentId) {
        state.activeSegmentId = '';
        state.sttResetRequested = true;
        if (state.ws && state.ws.readyState !== WebSocket.CLOSED && state.ws.readyState !== WebSocket.CLOSING) {
          try { state.ws.close(4000, action.reason || 'segment-closed'); } catch (_) {}
        }
      }
    }
  }

  function scheduleSttReconnect(reason = 'stt-closed', delayOverrideMs = null) {
    if (!state.running || state.sttReconnectTimer || state.sttConnecting) return;
    state.runtimeReason = reason;
    const delay = Number.isFinite(Number(delayOverrideMs))
      ? Math.max(0, Number(delayOverrideMs))
      : Math.min(
        STT_RECONNECT_MAX_DELAY_MS,
        STT_RECONNECT_MIN_DELAY_MS * (2 ** Math.min(4, state.sttReconnectAttempts))
      );
    if (!Number.isFinite(Number(delayOverrideMs))) state.sttReconnectAttempts += 1;
    state.sttReconnectTimer = window.setTimeout(() => {
      state.sttReconnectTimer = null;
      connectSttSocket().catch(error => {
        state.runtimeReason = error.message || String(error);
        if (state.running) scheduleSttReconnect('stt-reconnect-failed');
      });
    }, delay);
  }

  function connectSttSocket(segmentId = '') {
    if (state.ws?.readyState === WebSocket.OPEN) return Promise.resolve(state.ws);
    if (state.ws?.readyState === WebSocket.CONNECTING && state.sttConnecting) return state.sttConnecting;
    if (state.sttConnecting) return state.sttConnecting;
    state.sttConnecting = (async () => {
      clearSttReconnectTimer();
      const ws = new WebSocket(await sttWebSocketUrl());
      state.ws = ws;
      state.activeSegmentId = segmentId || state.activeSegmentId || '';
      const socketSegmentId = state.activeSegmentId;
      ws.binaryType = 'arraybuffer';
      ws.addEventListener('message', handleSttMessage);
      ws.addEventListener('close', () => {
        const resetRequested = state.sttResetRequested;
        const closedSegmentId = socketSegmentId;
        state.sttResetRequested = false;
        state.sttReconnectOnClose = false;
        state.sttSpeechStartResetPending = false;
        state.sttSegmentActive = false;
        if (state.ws === ws) {
          state.ws = null;
          state.activeSegmentId = '';
        }
        if (state.running && !resetRequested && closedSegmentId) {
          state.segmentController?.dispatch?.('segmentTimeout', {
            segment_id: closedSegmentId,
            reason: 'socket_closed',
          });
        }
      });
      await waitForSocketOpen(ws);
      state.runtimeReason = '';
      state.sttReconnectAttempts = 0;
      state.segmentController?.dispatch?.('socketOpen', { segment_id: segmentId || state.activeSegmentId });
      return ws;
    })();
    return state.sttConnecting.finally(() => {
      state.sttConnecting = null;
    });
  }

  function resetSttStream(reason = 'stt-reset') {
    const now = Date.now();
    resetVadState(now);
    state.segmentController?.dispatch?.(reason === 'wake_confirmed_waiting_speech' ? 'wakeConfirmed' : 'reset', { reason });
    state.sttClassifier?.reset?.(state.streamEpoch);
    state.sttResetPendingReason = '';
    state.sttSpeechStartResetPending = false;
    state.startDelayedStreamOnOpen = false;
    state.sttSegmentActive = false;
    state.vadSpeechStartResetArmed = true;
    reportWakeDebug({ type: 'sttReset', reason }, true);
    const ws = state.ws;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      state.sttResetRequested = true;
      state.sttReconnectOnClose = false;
      try { ws.close(4000, reason); } catch (_) {}
    }
  }

  function finishSttReset(reason = state.sttResetPendingReason || 'stt-reset') {
    clearSttResetTimer();
    state.sttResetPendingReason = '';
    state.sttClassifier?.reset?.(state.streamEpoch);
    state.sttSegmentActive = false;
    rearmVadSpeechStartReset();
    state.segmentController?.dispatch?.('reset', { reason });
    reportWakeDebug({ type: 'sttReset', reason }, true);
    const ws = state.ws;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      state.sttResetRequested = true;
      state.sttReconnectOnClose = false;
      try { ws.close(4000, reason); } catch (_) {}
    }
  }

  function handleAction(action) {
    if (!action) return;
    reportWakeDebug(action);
    if (action.type === 'stateChanged') {
      setVisual(action.next_state);
      broadcastActive();
    } else if (action.type === 'startTimer') {
      startTimer(action.timer, action.ms, action.session_id);
    } else if (action.type === 'clearTimer') {
      clearTimerName(action.timer);
    } else if (action.type === 'execute') {
      sendMatrixExecute(action)
        .then(() => state.machine?.dispatch('sendSucceeded', { session_id: action.session_id, send_id: action.send_id }))
        .catch(error => state.machine?.dispatch('sendFailed', {
          session_id: action.session_id,
          send_id: action.send_id,
          error: error.message || String(error),
        }));
    } else if (action.type === 'resetStt') {
      resetSttStream(action.reason || 'fsm_reset');
    }
  }

  function buildMachine() {
    const wakeSettings = window.BlueprintsVoiceMode?.getWakeSettings?.() || {};
    state.settings = wakeSettings;
    state.machine = WakeToTalkState.createMachine(wakeSettings, { onAction: handleAction });
    state.streamEpoch += 1;
    state.sttClassifier = WakeToTalkState.createSttEventClassifier({ stream_epoch: state.streamEpoch });
    state.segmentController = WakeToTalkState.createSttSegmentController({
      pre_roll_frames: STT_DELAY_FRAMES,
      final_timeout_ms: STT_RESET_FINAL_GRACE_MS,
      onAction: handleSegmentAction,
    });
    reportWakeDebug({ type: 'machineBuilt' }, true);
  }

  function ensureMachine() {
    if (!state.machine) buildMachine();
    return state.machine;
  }

  function syncMachineSelection(overrides = {}) {
    const machine = ensureMachine();
    const sttMode = Object.prototype.hasOwnProperty.call(overrides, 'stt_mode')
      ? overrides.stt_mode
      : (window.BlueprintsVoiceMode?.sttMode?.() || '');
    const activated = Object.prototype.hasOwnProperty.call(overrides, 'activated')
      ? overrides.activated
      : (window.BlueprintsVoiceMode?.ownsActiveSttMode?.('wake_to_talk') === true);
    machine?.dispatch('activationChanged', {
      stt_mode: sttMode,
      activated,
      blocked_reason: overrides.blocked_reason || '',
    });
    return machine?.getState?.() || '';
  }

  function handleSttMessage(event) {
    let payload = {};
    try {
      payload = JSON.parse(event.data || '{}');
    } catch (_) {
      return;
    }
    const text = sttPayloadText(payload);
    if (text && payload.text == null) payload.text = text;
    pushRecent('recentSttEvents', {
      type: payload.type || '',
      text: clippedText(text),
      text_length: String(text || '').length,
      final_requested: payload.final_requested === true,
      stream_epoch: state.streamEpoch,
      audio_frames_sent: state.audioFramesSent,
      detail: clippedText(payload.detail || payload.reason || payload.raw || '', 160),
      keys: Object.keys(payload).slice(0, 16).join(','),
    }, 160);
    reportWakeDebug({ type: 'sttPayload', payload_type: payload.type || '' });
    if (payload.type === 'partial' && payload.text) {
      state.segmentController?.dispatch?.('sttPartial', { text, raw: payload });
    } else if (payload.type === 'final') {
      state.segmentController?.dispatch?.('sttFinal', { text, raw: payload });
    } else if (payload.type === 'error') {
      state.machine?.dispatch('micError', { detail: payload.detail || 'STT error' });
      if (state.activeSegmentId) {
        state.segmentController?.dispatch?.('segmentTimeout', {
          segment_id: state.activeSegmentId,
          reason: payload.detail || 'stt_error',
        });
      }
    }
  }

  function peerIsActive() {
    return Date.now() < state.peerActiveUntil;
  }

  function broadcastActive() {
    if (!state.channel || !state.running) return;
    state.channel.postMessage({
      type: 'active',
      tab_id: TAB_ID,
      state: state.machine?.getState?.() || '',
      until: Date.now() + 2500,
    });
  }

  function setupChannel() {
    if (state.channel || typeof BroadcastChannel === 'undefined') return;
    state.channel = new BroadcastChannel(CONTROL_CHANNEL);
    state.channel.addEventListener('message', event => {
      const msg = event.data || {};
      if (msg.tab_id === TAB_ID) return;
      if (msg.type === 'active') {
        state.peerActiveUntil = Math.max(state.peerActiveUntil, Number(msg.until) || Date.now() + 2500);
        if (state.running && msg.tab_id < TAB_ID) {
          stop('peer-active');
        }
      }
    });
    window.setInterval(broadcastActive, 1200);
  }

  function shouldRun() {
    if (document.visibilityState === 'hidden') return { ok: false, reason: 'Page hidden.' };
    if (window.BlueprintsVoiceMode?.sttMode?.() !== 'wake_to_talk') return { ok: false, reason: 'Wake to Talk is not selected.' };
    if (window.BlueprintsVoiceMode?.isActiveOwner?.() !== true) return { ok: false, reason: 'Wake to Talk is selected but this browser is not activated for Voice Mode.' };
    if (!window.WakeToTalkState) return { ok: false, reason: 'Wake to Talk state machine is unavailable.' };
    if (!navigator.mediaDevices?.getUserMedia) return { ok: false, reason: 'Browser microphone capture is unavailable.' };
    if (typeof WebSocket === 'undefined') return { ok: false, reason: 'Browser websocket support is unavailable.' };
    if (!activeWakeInstances().some(([, instance]) => instance.matrix_room_id)) return { ok: false, reason: 'Select a Matrix room for local or vps.' };
    if (peerIsActive()) return { ok: false, reason: 'Another tab is holding Wake to Talk.' };
    return { ok: true, reason: 'Arming microphone.' };
  }

  async function start() {
    const readiness = shouldRun();
    if (state.running || state.starting) {
      publishRuntime();
      return;
    }
    if (!readiness.ok) {
      state.runtimeReason = readiness.reason;
      publishRuntime('', 0, readiness.reason);
      return;
    }
    if (typeof window.BlueprintsVoiceMode?.reconcile === 'function') {
      const serverState = await window.BlueprintsVoiceMode.reconcile();
      const active = serverState?.active || null;
      const browserId = window.BlueprintsVoiceMode?.getBrowserId?.() || '';
      if (!active || active.browser_id !== browserId || window.BlueprintsVoiceMode?.ownsActiveSttMode?.('wake_to_talk') !== true) {
        state.runtimeReason = active && active.browser_id !== browserId
          ? 'Another browser is activated for Voice Mode.'
          : (window.BlueprintsVoiceMode?.sttMode?.() === 'wake_to_talk'
            ? 'This browser is not activated for Voice Mode.'
            : 'Wake to Talk is not selected.');
        publishRuntime('', 0, state.runtimeReason);
        return;
      }
    }
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    state.starting = true;
    setVisual('PERMISSION_PENDING', 0, readiness.reason);
    buildMachine();
    state.machine.dispatch('activationChanged', {
      stt_mode: window.BlueprintsVoiceMode?.sttMode?.() || '',
      activated: window.BlueprintsVoiceMode?.ownsActiveSttMode?.('wake_to_talk') === true,
    });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContextCtor();
      await audioContext.resume?.();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(AUDIO_BUFFER_SIZE, 1, 1);
      state.stream = stream;
      state.audioContext = audioContext;
      state.sourceNode = source;
      state.processorNode = processor;
      state.audioBytesSent = 0;
      state.audioFramesSent = 0;
      state.audioFramesCaptured = 0;
      state.audioDelayBuffer = [];
      state.audioCandidateBuffer = [];
      state.sttSpeechStartResetPending = false;
      state.startDelayedStreamOnOpen = false;
      state.sttSegmentActive = false;
      state.vadSpeechStartResetArmed = true;
      state.lastSpeechAt = Date.now();
      resetVadState(state.lastSpeechAt);
      state.running = true;
      state.starting = false;
      state.runtimeReason = '';
      state.machine.dispatch('micReady', { stream_epoch: state.streamEpoch, audio_frame: 0 });
      reportWakeDebug({ type: 'controllerStarted' }, true);
      startDebugHeartbeat();
      startActivationCheckTimer();
      processor.onaudioprocess = event => {
        const output = event.outputBuffer?.getChannelData?.(0);
        if (output) output.fill(0);
        if (!state.running) return;
        const input = event.inputBuffer.getChannelData(0);
        const features = audioFeatures(input);
        state.lastAudioFeatures = features;
        const level = features.level;
        setVisual(state.machine?.getState?.(), level);
        state.machine?.dispatch('audioLevel', { level, at: Date.now() });
        if (level > SPEECH_LEVEL_THRESHOLD) state.lastSpeechAt = Date.now();
        const pcm = downsampleFloat32(input, audioContext.sampleRate, AUDIO_SAMPLE_RATE);
        state.audioFramesCaptured += 1;
        pushAudioDelayFrame(pcm);
        state.segmentController?.dispatch?.('micFrame', {
          pcm,
          byteLength: pcm?.byteLength || 0,
          audio_frame: state.audioFramesCaptured,
          at: Date.now(),
        });
        updateVad(features, Date.now());
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
      broadcastActive();
    } catch (error) {
      state.starting = false;
      stop('start-failed');
      state.runtimeReason = error.message || String(error);
      state.machine?.dispatch('micError', { detail: state.runtimeReason });
    }
  }

  function stop(_reason = 'stop') {
    clearAllTimers();
    clearSttReconnectTimer();
    clearSttResetTimer();
    clearSegmentFinalTimer();
    clearActivationCheckTimer();
    state.running = false;
    state.starting = false;
    if (state.processorNode) {
      try { state.processorNode.disconnect(); } catch (_) {}
      state.processorNode.onaudioprocess = null;
      state.processorNode = null;
    }
    if (state.sourceNode) {
      try { state.sourceNode.disconnect(); } catch (_) {}
      state.sourceNode = null;
    }
    if (state.audioContext) {
      try { void state.audioContext.close(); } catch (_) {}
      state.audioContext = null;
    }
    if (state.stream) {
      state.stream.getTracks().forEach(track => track.stop());
      state.stream = null;
    }
    if (state.ws) {
      try { state.ws.close(); } catch (_) {}
      state.ws = null;
    }
    state.sttConnecting = null;
    state.activeSegmentId = '';
    state.sttReconnectAttempts = 0;
    state.sttResetPendingReason = '';
    state.sttSpeechStartResetPending = false;
    state.startDelayedStreamOnOpen = false;
    state.sttSegmentActive = false;
    state.segmentController?.dispatch?.('activationLost', { reason: _reason });
    state.vadSpeechStartResetArmed = true;
    state.audioDelayBuffer = [];
    state.audioCandidateBuffer = [];
    setVisual(state.machine?.getState?.() || '', 0, _reason);
    reportWakeDebug({ type: 'controllerStopped', reason: _reason }, true);
    clearDebugHeartbeat();
  }

  async function sync() {
    const readiness = shouldRun();
    if (readiness.ok) {
      await start();
    } else if (state.running || state.starting) {
      state.runtimeReason = readiness.reason;
      syncMachineSelection({
        stt_mode: window.BlueprintsVoiceMode?.sttMode?.() || '',
        activated: false,
      });
      stop('sync-disabled');
    } else {
      state.runtimeReason = readiness.reason;
      const fsmState = syncMachineSelection({
        stt_mode: window.BlueprintsVoiceMode?.sttMode?.() || '',
        activated: window.BlueprintsVoiceMode?.ownsActiveSttMode?.('wake_to_talk') === true && readiness.reason !== 'Page hidden.',
        blocked_reason: readiness.reason,
      });
      setVisual(fsmState, 0, readiness.reason);
      reportWakeDebug({ type: 'controllerStopped', reason: readiness.reason }, true);
    }
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    setupChannel();
    window.addEventListener('blueprints:voice-mode:changed', () => sync().catch(() => {}));
    window.addEventListener('blueprints:voice-mode:wake-settings-changed', () => sync().catch(() => {}));
    window.addEventListener('blueprints:voice-mode:stt-noise-changed', () => {
      if (state.running) {
        stop('noise-setting-changed');
        sync().catch(() => {});
      }
    });
    document.addEventListener('visibilitychange', () => sync().catch(() => {}));
    window.addEventListener('focus', () => sync().catch(() => {}));
    if (document.body && typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => {
        const current = document.documentElement.dataset.wakeToTalkState || '';
        if (current) setSettingsIndicatorState(current);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    window.addEventListener('beforeunload', () => stop('unload'));
    window.setTimeout(() => sync().catch(() => {}), 800);
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    init,
    sync,
    start,
    stop,
    isRunning: () => state.running,
    getState: () => state.machine?.getState?.() || '',
    getDebugSnapshot: debugSnapshot,
  };
})();

window.WakeToTalkController = WakeToTalkController;
