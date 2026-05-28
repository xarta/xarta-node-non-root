// wake-to-talk-state.js - pure Wake to Talk queue/FSM core.

(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WakeToTalkState = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  const STATES = Object.freeze({
    DISABLED: 'DISABLED',
    SELECTED_INACTIVE: 'SELECTED_INACTIVE',
    BLOCKED: 'BLOCKED',
    PERMISSION_PENDING: 'PERMISSION_PENDING',
    ARMED_IDLE: 'ARMED_IDLE',
    WAKE_CANDIDATE: 'WAKE_CANDIDATE',
    WAKE_CONFIRMED_WAITING_SPEECH: 'WAKE_CONFIRMED_WAITING_SPEECH',
    CAPTURING: 'CAPTURING',
    COMMAND_CANDIDATE: 'COMMAND_CANDIDATE',
    PAUSED: 'PAUSED',
    EXECUTING: 'EXECUTING',
    SENT_FEEDBACK: 'SENT_FEEDBACK',
    ERROR_FEEDBACK: 'ERROR_FEEDBACK',
  });

  const TIMER_POST_WAKE = 'postWakePause';
  const TIMER_INITIAL_CANCEL = 'initialSilenceCancel';
  const TIMER_PAUSE_RESET = 'pauseReset';
  const TIMER_AUTO_EXECUTE = 'autoExecuteSilence';
  const TIMER_SENT_FEEDBACK = 'sentFeedback';
  const TIMER_ERROR_FEEDBACK = 'errorFeedback';
  const SPEECH_LEVEL_THRESHOLD = 0.035;

  const STT_SEGMENT_STATES = Object.freeze({
    IDLE: 'IDLE',
    CANDIDATE: 'CANDIDATE',
    OPENING: 'OPENING',
    STREAMING: 'STREAMING',
    ENDING: 'ENDING',
    FINALIZED: 'FINALIZED',
    RESETTING: 'RESETTING',
  });

  const DEFAULTS = Object.freeze({
    instances: {
      local: {
        enabled: true,
        label: 'local',
        matrix_server: 'tb1',
        matrix_room_id: '',
        wake_word: 'Computer',
        wake_aliases: ['computer'],
        hermes_prefix: 'hermes: ',
        post_wake_pause_ms: 500,
        initial_silence_cancel_ms: 1000,
        pause_reset_seconds: 30,
        auto_execute_silence_ms: 0,
        commands: {
          pause: 'pause-dictation',
          resume: 'resume-dictation',
          execute: 'execute',
          cancel: 'cancel-dictation',
        },
      },
      vps: {
        enabled: true,
        label: 'vps',
        matrix_server: 'vps',
        matrix_room_id: '',
        wake_word: 'Mini-Me',
        wake_aliases: ['mini-me', 'mini me', 'minime'],
        hermes_prefix: 'hermes-vps: ',
        post_wake_pause_ms: 500,
        initial_silence_cancel_ms: 1000,
        pause_reset_seconds: 30,
        auto_execute_silence_ms: 0,
        commands: {
          pause: 'pause-dictation',
          resume: 'resume-dictation',
          execute: 'execute',
          cancel: 'cancel-dictation',
        },
      },
    },
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function phrasePattern(phrase) {
    const words = normalizeText(phrase).split(/\s+/).filter(Boolean).map(escapeRegExp);
    if (!words.length) return null;
    return new RegExp(`\\b${words.join('[\\s\\-]+')}\\b`, 'ig');
  }

  function aliasVariants(instance) {
    const aliases = [];
    const source = [instance?.wake_word, ...(Array.isArray(instance?.wake_aliases) ? instance.wake_aliases : [])];
    source.forEach(value => {
      const clean = normalizeText(value);
      const compact = clean.replace(/\s+/g, '');
      const hyphen = clean.replace(/\s+/g, '-');
      [clean, compact, hyphen].forEach(candidate => {
        if (candidate && !aliases.includes(candidate)) aliases.push(candidate);
      });
    });
    return aliases;
  }

  function mergedConfig(config) {
    const next = clone(DEFAULTS);
    const raw = config && typeof config === 'object' ? config : {};
    const rawInstances = raw.instances && typeof raw.instances === 'object' ? raw.instances : {};
    Object.keys(next.instances).forEach(instanceId => {
      const current = rawInstances[instanceId] && typeof rawInstances[instanceId] === 'object'
        ? rawInstances[instanceId]
        : {};
      next.instances[instanceId] = {
        ...next.instances[instanceId],
        ...current,
        commands: {
          ...next.instances[instanceId].commands,
          ...(current.commands && typeof current.commands === 'object' ? current.commands : {}),
        },
      };
      const prefix = String(next.instances[instanceId].hermes_prefix || '').trim();
      next.instances[instanceId].hermes_prefix = prefix.endsWith(':') ? `${prefix} ` : `${prefix} `;
      next.instances[instanceId].wake_aliases = aliasVariants(next.instances[instanceId]);
    });
    return next;
  }

  function wakeAliasForExactText(text, instance) {
    const normalized = normalizeText(text);
    return aliasVariants(instance).find(alias => normalizeText(alias) === normalized) || '';
  }

  function findWakeMatch(text, config) {
    const normalized = normalizeText(text);
    if (!normalized) return null;
    for (const [instanceId, instance] of Object.entries(config.instances || {})) {
      const exact = wakeAliasForExactText(text, instance);
      if (exact) return { instance_id: instanceId, instance, wake_word: exact };
    }
    return null;
  }

  function leadingWakeAlias(text, instance) {
    const normalized = normalizeText(text);
    if (!normalized || !instance) return '';
    return aliasVariants(instance).find(alias => {
      const aliasText = normalizeText(alias);
      return normalized === aliasText || normalized.startsWith(`${aliasText} `);
    }) || '';
  }

  function findCommandMatch(text, instanceId, config) {
    const instance = config.instances?.[instanceId];
    if (!instance) return null;
    const normalized = normalizeText(text);
    if (!normalized) return null;
    const commands = instance.commands || {};
    for (const alias of aliasVariants(instance)) {
      const aliasText = normalizeText(alias);
      if (!aliasText) continue;
      for (const [type, phrase] of Object.entries(commands)) {
        const commandText = normalizeText(phrase);
        if (!commandText) continue;
        const joinedPattern = phrasePattern(`${aliasText} ${commandText}`);
        if (joinedPattern && joinedPattern.test(normalized)) {
          return { command: type, instance_id: instanceId, phrase, wake_word: alias };
        }
      }
    }
    return null;
  }

  function findCommandPrefixMatch(text, instanceId, config) {
    const instance = config.instances?.[instanceId];
    if (!instance) return null;
    const normalized = normalizeText(text);
    if (!normalized) return null;
    const commands = instance.commands || {};
    for (const alias of aliasVariants(instance)) {
      const aliasText = normalizeText(alias);
      if (!aliasText) continue;
      for (const [type, phrase] of Object.entries(commands)) {
        const target = normalizeText(`${aliasText} ${phrase}`);
        if (target && target.startsWith(normalized)) {
          return { command: type, instance_id: instanceId, phrase, wake_word: alias, prefix: true };
        }
      }
    }
    return null;
  }

  function stripPhrase(value, phrase) {
    const pattern = phrasePattern(phrase);
    return pattern ? String(value || '').replace(pattern, ' ') : String(value || '');
  }

  function stripHermesPrefix(value) {
    return String(value || '').replace(/^\s*(?:hermes-vps|hermes|vps|hv|h)\s*:\s*/i, '');
  }

  function tidyDictation(value) {
    return stripHermesPrefix(value)
      .replace(/^[\s,.;:!?-]+/, '')
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .trim();
  }

  function formatSendBody(drainedText, instance) {
    const clean = tidyDictation(drainedText);
    if (!clean) return '';
    const prefix = String(instance?.hermes_prefix || 'hermes: ');
    if (clean.toLowerCase().startsWith(prefix.trim().toLowerCase())) return clean;
    return `${prefix}${clean}`;
  }

  function sanitizeTranscript(text, instance) {
    let clean = stripHermesPrefix(String(text || ''));
    aliasVariants(instance).forEach(alias => {
      clean = stripPhrase(clean, alias);
    });
    Object.values(instance?.commands || {}).forEach(phrase => {
      clean = stripPhrase(clean, phrase);
    });
    return formatSendBody(clean, instance);
  }

  function createSttEventClassifier(options = {}) {
    let streamEpoch = Number(options.stream_epoch || 1) || 1;
    let utteranceSeq = 0;
    let activeUtteranceId = '';
    let lastFinal = null;
    const reuseWindowFrames = Number(options.reuse_window_frames ?? 80) || 80;

    function nextUtteranceId() {
      utteranceSeq += 1;
      return `stt-${streamEpoch}-${utteranceSeq}`;
    }

    function reset(nextEpoch = streamEpoch + 1) {
      streamEpoch = Number(nextEpoch) || (streamEpoch + 1);
      utteranceSeq = 0;
      activeUtteranceId = '';
      lastFinal = null;
    }

    function classify(raw = {}, frameInfo = {}) {
      const text = String(raw.text || '').trim();
      const phase = raw.type === 'final' || raw.phase === 'final' || raw.is_final === true ? 'final' : 'partial';
      const audioEndFrame = Number(
        raw.audio_end_frame
        ?? raw.audio_frames
        ?? raw.audio_frame
        ?? frameInfo.audio_end_frame
        ?? frameInfo.audio_frame
        ?? 0
      ) || 0;
      let utteranceId = String(raw.utterance_id || raw.utteranceId || '');
      if (!utteranceId && phase === 'partial') {
        if (!activeUtteranceId) activeUtteranceId = nextUtteranceId();
        utteranceId = activeUtteranceId;
      } else if (!utteranceId && activeUtteranceId) {
        utteranceId = activeUtteranceId;
      } else if (!utteranceId && lastFinal?.normalized_text === normalizeText(text)
          && audioEndFrame - lastFinal.audio_end_frame <= reuseWindowFrames) {
        utteranceId = lastFinal.utterance_id;
      } else if (!utteranceId) {
        utteranceId = nextUtteranceId();
      }
      if (phase === 'final') {
        lastFinal = {
          utterance_id: utteranceId,
          normalized_text: normalizeText(text),
          audio_end_frame: audioEndFrame,
        };
        if (activeUtteranceId === utteranceId) activeUtteranceId = '';
      }
      return {
        phase,
        text,
        normalized_text: normalizeText(text),
        utterance_id: utteranceId,
        stream_epoch: Number(raw.stream_epoch ?? frameInfo.stream_epoch ?? streamEpoch) || streamEpoch,
        audio_start_frame: Number(raw.audio_start_frame ?? frameInfo.audio_start_frame ?? audioEndFrame) || 0,
        audio_end_frame: audioEndFrame,
        raw,
      };
    }

    return {
      classify,
      reset,
      getStreamEpoch: () => streamEpoch,
    };
  }

  function createSttSegmentController(options = {}) {
    const preRollFrames = Math.max(0, Number(options.pre_roll_frames ?? 2) || 0);
    const finalTimeoutMs = Math.max(0, Number(options.final_timeout_ms ?? 3200) || 0);
    const onAction = typeof options.onAction === 'function' ? options.onAction : () => {};
    let state = STT_SEGMENT_STATES.IDLE;
    let segmentSeq = 0;
    let frameSeq = 0;
    let active = null;
    let preRoll = [];
    let candidate = [];

    function cloneFrame(frame = {}) {
      frameSeq += 1;
      return {
        pcm: frame.pcm || frame.data || frame,
        byteLength: Number(frame.byteLength ?? frame.pcm?.byteLength ?? frame.data?.byteLength ?? 0) || 0,
        audio_frame: Number(frame.audio_frame ?? frame.frame ?? 0) || 0,
        frame_seq: Number(frame.frame_seq || frame._frame_seq || frameSeq) || frameSeq,
        at: Number(frame.at || 0) || 0,
        pre_roll: frame.pre_roll === true,
      };
    }

    function frameKey(frame = {}) {
      const audioFrame = Number(frame.audio_frame || 0) || 0;
      if (audioFrame) return `f:${audioFrame}`;
      return `s:${Number(frame.frame_seq || 0) || frameSeq}`;
    }

    function rememberPreRoll(frame) {
      if (!frame?.byteLength) return;
      preRoll.push(frame);
      while (preRoll.length > preRollFrames) preRoll.shift();
    }

    function action(type, payload = {}) {
      const output = {
        type,
        segment_state: state,
        segment_id: active?.segment_id || '',
        ...payload,
      };
      onAction(output);
      return output;
    }

    function setState(next, extra = {}) {
      if (state === next && !Object.keys(extra).length) return;
      state = next;
      action('segmentStateChanged', { next_state: state, ...extra });
    }

    function clearActive() {
      active = null;
      candidate = [];
    }

    function resetToIdle(reason = 'reset') {
      if (active?.end_sent) action('clearFinalTimer', { reason });
      clearActive();
      setState(STT_SEGMENT_STATES.IDLE, { reason });
    }

    function appendPendingFrame(frame) {
      if (!active || !frame?.byteLength) return false;
      const key = frameKey(frame);
      if (key && active.pending_keys.has(key)) return false;
      active.pending_keys.add(key);
      active.pending_frames.push(frame);
      return true;
    }

    function sendFrame(frame, source = 'stream') {
      if (!active || !frame?.byteLength) return false;
      active.audio_frames += 1;
      active.audio_bytes += frame.byteLength;
      action('sendPcmFrame', {
        segment_id: active.segment_id,
        frame,
        audio_frame: frame.audio_frame,
        audio_frames: active.audio_frames,
        audio_bytes: active.audio_bytes,
        source,
      });
      return true;
    }

    function flushPendingFrames(source = 'pending') {
      if (!active) return 0;
      let sent = 0;
      while (active.pending_frames.length) {
        const frame = active.pending_frames.shift();
        if (sendFrame(frame, frame.pre_roll ? 'pre_roll' : source)) sent += 1;
      }
      return sent;
    }

    function openSegment(payload = {}) {
      segmentSeq += 1;
      const segmentId = payload.segment_id || `segment-${segmentSeq}`;
      const seeded = candidate.length ? candidate : preRoll;
      active = {
        segment_id: segmentId,
        pending_frames: [],
        pending_keys: new Set(),
        audio_frames: 0,
        audio_bytes: 0,
        end_sent: false,
        end_after_open: false,
        final_emitted: false,
      };
      seeded.forEach(frame => appendPendingFrame({ ...frame, pre_roll: true }));
      if (payload.frame) appendPendingFrame(cloneFrame(payload.frame));
      setState(STT_SEGMENT_STATES.OPENING, {
        reason: payload.reason || 'vad_speech_start',
        queued_frames: active.pending_frames.length,
      });
      action('openSttSegment', {
        segment_id: segmentId,
        queued_frames: active.pending_frames.length,
        pre_roll_frames: preRollFrames,
      });
    }

    function sendEnd(reason = 'vad_timeout') {
      if (!active || active.end_sent) return false;
      active.end_sent = true;
      flushPendingFrames('end_drain');
      action('sendEnd', {
        segment_id: active.segment_id,
        reason,
        audio_frames: active.audio_frames,
        audio_bytes: active.audio_bytes,
        final_timeout_ms: finalTimeoutMs,
      });
      if (finalTimeoutMs > 0) {
        action('startFinalTimer', {
          segment_id: active.segment_id,
          ms: finalTimeoutMs,
          reason,
        });
      }
      setState(STT_SEGMENT_STATES.ENDING, { reason });
      return true;
    }

    function dispatch(input, payload = {}) {
      if (input === 'micFrame') {
        const frame = cloneFrame(payload);
        rememberPreRoll(frame);
        if (state === STT_SEGMENT_STATES.CANDIDATE) {
          candidate = preRoll.map(item => ({ ...item, pre_roll: true }));
        } else if (state === STT_SEGMENT_STATES.OPENING) {
          appendPendingFrame(frame);
        } else if (state === STT_SEGMENT_STATES.STREAMING) {
          sendFrame(frame);
        }
        return null;
      }
      if (input === 'vadCandidateStart') {
        if (state !== STT_SEGMENT_STATES.IDLE) return null;
        candidate = preRoll.map(frame => ({ ...frame, pre_roll: true }));
        setState(STT_SEGMENT_STATES.CANDIDATE, {
          reason: payload.reason || 'vad_candidate_start',
          queued_frames: candidate.length,
        });
        return null;
      }
      if (input === 'vadCandidateReject') {
        if (state === STT_SEGMENT_STATES.CANDIDATE) {
          candidate = [];
          setState(STT_SEGMENT_STATES.IDLE, { reason: payload.reason || 'candidate_rejected' });
        }
        return null;
      }
      if (input === 'vadSpeechStart') {
        if (state === STT_SEGMENT_STATES.OPENING || state === STT_SEGMENT_STATES.STREAMING || state === STT_SEGMENT_STATES.ENDING) {
          return null;
        }
        openSegment(payload);
        return null;
      }
      if (input === 'socketOpen') {
        if (!active || payload.segment_id !== active.segment_id || state !== STT_SEGMENT_STATES.OPENING) return null;
        const sent = flushPendingFrames('open_flush');
        setState(STT_SEGMENT_STATES.STREAMING, { reason: 'socket_open', flushed_frames: sent });
        if (active.end_after_open) sendEnd(active.end_reason || 'vad_timeout');
        return null;
      }
      if (input === 'vadSpeechEnd') {
        if (!active) {
          if (state === STT_SEGMENT_STATES.CANDIDATE) dispatch('vadCandidateReject', { reason: payload.reason || 'candidate_ended' });
          return null;
        }
        if (state === STT_SEGMENT_STATES.OPENING) {
          active.end_after_open = true;
          active.end_reason = payload.reason || 'vad_timeout';
          return null;
        }
        if (state === STT_SEGMENT_STATES.STREAMING) sendEnd(payload.reason || 'vad_timeout');
        return null;
      }
      if (input === 'sttPartial') {
        if (!active) return null;
        action('sttPartial', {
          segment_id: active.segment_id,
          text: String(payload.text || ''),
          raw: payload.raw || payload,
        });
        return null;
      }
      if (input === 'sttFinal') {
        if (!active || active.final_emitted) return null;
        if (state !== STT_SEGMENT_STATES.ENDING) {
          action('sttFinalIgnored', {
            segment_id: active.segment_id,
            reason: 'segment_not_ending',
            text: String(payload.text || ''),
          });
          return null;
        }
        active.final_emitted = true;
        action('clearFinalTimer', { segment_id: active.segment_id, reason: 'final_received' });
        setState(STT_SEGMENT_STATES.FINALIZED, { reason: 'final_received' });
        action('emitUtteranceFinal', {
          segment_id: active.segment_id,
          text: String(payload.text || ''),
          raw: payload.raw || payload,
          audio_frames: active.audio_frames,
          audio_bytes: active.audio_bytes,
        });
        action('closeSegment', { segment_id: active.segment_id, reason: 'final_received' });
        resetToIdle('final_received');
        return null;
      }
      if (input === 'segmentTimeout') {
        if (!active || payload.segment_id !== active.segment_id) return null;
        setState(STT_SEGMENT_STATES.RESETTING, { reason: payload.reason || 'final_timeout' });
        action('closeSegment', { segment_id: active.segment_id, reason: payload.reason || 'final_timeout' });
        resetToIdle(payload.reason || 'final_timeout');
        return null;
      }
      if (input === 'wakeConfirmed' || input === 'reset' || input === 'activationLost' || input === 'modeChanged') {
        if (active) action('closeSegment', { segment_id: active.segment_id, reason: payload.reason || input });
        resetToIdle(payload.reason || input);
        return null;
      }
      return null;
    }

    return {
      dispatch,
      getState: () => state,
      getActiveSegmentId: () => active?.segment_id || '',
      getDebugSnapshot: () => ({
        state,
        segment_id: active?.segment_id || '',
        pre_roll_frames: preRoll.length,
        candidate_frames: candidate.length,
        pending_frames: active?.pending_frames?.length || 0,
        audio_frames: active?.audio_frames || 0,
        audio_bytes: active?.audio_bytes || 0,
        end_sent: active?.end_sent === true,
      }),
    };
  }

  function createMachine(config = {}, options = {}) {
    let cfg = mergedConfig(config);
    let state = STATES.DISABLED;
    let activeInstanceId = '';
    let inputQueue = [];
    let messageQueue = [];
    let pendingCommandItems = [];
    let lastOutput = null;
    let sessionCounter = 0;
    let sessionId = 0;
    let sendCounter = 0;
    let activeSend = null;
    let frozenSendSnapshot = null;
    let lastWakeCheck = null;
    let lastCommandCheck = null;
    let currentFrame = 0;
    let streamEpoch = 0;
    let armedAfterFrame = 0;
    let captureAfterFrame = 0;
    const utterances = new Map();
    const onAction = typeof options.onAction === 'function' ? options.onAction : () => {};

    function action(type, payload = {}) {
      const output = { type, ...payload, state };
      lastOutput = output;
      onAction(output);
      return output;
    }

    function queueText(queue) {
      return queue.map(item => item.text).join(' ').replace(/\s+/g, ' ').trim();
    }

    function statePayload(extra = {}) {
      return {
        next_state: state,
        instance_id: activeInstanceId,
        session_id: sessionId,
        send_id: activeSend?.send_id || 0,
        transcript: queueText(messageQueue),
        input_queue_length: inputQueue.length + pendingCommandItems.length,
        message_queue_length: messageQueue.length,
        ...extra,
      };
    }

    function setState(next, extra = {}) {
      state = next;
      action('stateChanged', statePayload(extra));
    }

    function startTimer(timer, ms) {
      action('startTimer', { timer, ms: Math.max(0, Number(ms) || 0), session_id: sessionId });
    }

    function clearTimer(timer) {
      action('clearTimer', { timer, session_id: sessionId });
    }

    function clearQueues() {
      inputQueue = [];
      messageQueue = [];
      pendingCommandItems = [];
      lastCommandCheck = null;
    }

    function clearSession() {
      clearQueues();
      activeInstanceId = '';
      sessionId = 0;
      activeSend = null;
      frozenSendSnapshot = null;
      captureAfterFrame = 0;
      [TIMER_POST_WAKE, TIMER_INITIAL_CANCEL, TIMER_PAUSE_RESET, TIMER_AUTO_EXECUTE].forEach(clearTimer);
    }

    function returnArmed(extra = {}) {
      clearSession();
      armedAfterFrame = currentFrame;
      setState(STATES.ARMED_IDLE, { armed_after_frame: armedAfterFrame, ...extra });
    }

    function beginSession(match) {
      sessionCounter += 1;
      sessionId = sessionCounter;
      activeInstanceId = match.instance_id;
      clearQueues();
      frozenSendSnapshot = null;
      activeSend = null;
      action('wakeMatched', { ...match, session_id: sessionId });
      setState(STATES.WAKE_CANDIDATE);
      startTimer(TIMER_POST_WAKE, match.instance.post_wake_pause_ms);
    }

    function enqueueInput(text, payload = {}) {
      const normalized = normalizeText(text);
      if (!normalized) return false;
      inputQueue.push({
        text: String(text || '').trim(),
        normalized_text: normalized,
        utterance_id: payload.utterance_id || '',
        stream_epoch: Number(payload.stream_epoch ?? streamEpoch) || 0,
        audio_start_frame: Number(payload.audio_start_frame ?? payload.audio_end_frame ?? currentFrame) || 0,
        audio_end_frame: Number(payload.audio_end_frame ?? currentFrame) || 0,
        phase: payload.phase || '',
      });
      action('inputQueued', { session_id: sessionId, text: String(text || '').trim(), input_queue_length: inputQueue.length });
      return true;
    }

    function enqueueDictationFromText(text, source = {}) {
      const clean = tidyDictation(text);
      if (!normalizeText(clean)) return false;
      messageQueue.push({
        text: clean,
        normalized_text: normalizeText(clean),
        committed_at_frame: Number(source.audio_end_frame ?? currentFrame) || 0,
      });
      action('messageQueued', {
        session_id: sessionId,
        text: clean,
        message_queue_length: messageQueue.length,
      });
      const instance = cfg.instances?.[activeInstanceId];
      if (Number(instance?.auto_execute_silence_ms) > 0) {
        startTimer(TIMER_AUTO_EXECUTE, instance.auto_execute_silence_ms);
      }
      return true;
    }

    function drainMessageQueue() {
      const drained = messageQueue.splice(0, messageQueue.length);
      return queueText(drained);
    }

    function commandPhrase(match) {
      return `${match.wake_word} ${match.phrase}`;
    }

    function dictationRemainderAfterCommand(text, match) {
      return tidyDictation(stripPhrase(text, commandPhrase(match)));
    }

    function trailingTextAfterCommand(text, match) {
      const rawWords = String(text || '').split(/\s+/).filter(Boolean);
      const normalizedWords = normalizeText(text).split(/\s+/).filter(Boolean);
      const commandWords = normalizeText(commandPhrase(match)).split(/\s+/).filter(Boolean);
      if (!rawWords.length || !commandWords.length) return '';
      for (let index = 0; index <= normalizedWords.length - commandWords.length; index += 1) {
        const slice = normalizedWords.slice(index, index + commandWords.length);
        if (slice.join(' ') === commandWords.join(' ')) {
          return rawWords.slice(index + commandWords.length).join(' ');
        }
      }
      return '';
    }

    function commandWithTrailingText(text, match) {
      const trailing = trailingTextAfterCommand(text, match);
      return `${commandPhrase(match)}${trailing ? ` ${trailing}` : ''}`;
    }

    function commandDiagnostic(stage, text, match, reason, extra = {}) {
      const instance = cfg.instances?.[activeInstanceId];
      lastCommandCheck = {
        stage,
        state,
        session_id: sessionId,
        instance_id: activeInstanceId,
        text: String(text || '').trim(),
        normalized_text: normalizeText(text),
        matched: !!match,
        fired: reason === 'command_fired',
        command: match?.command || '',
        phrase: match?.phrase || '',
        wake_word: match?.wake_word || '',
        reason,
        pending_command_text: queueText(pendingCommandItems),
        input_queue_text: queueText(inputQueue),
        commands: clone(instance?.commands || {}),
        wake_aliases: aliasVariants(instance),
        ...extra,
      };
      return match;
    }

    function wakeDiagnostic(stage, text, match, reason, extra = {}) {
      lastWakeCheck = {
        stage,
        state,
        session_id: sessionId,
        text: String(text || '').trim(),
        normalized_text: normalizeText(text),
        matched: !!match,
        instance_id: match?.instance_id || activeInstanceId,
        wake_word: match?.wake_word || '',
        reason,
        ...extra,
      };
      return match;
    }

    function consumeCommand(match, combinedText) {
      commandDiagnostic('consumeCommand', combinedText, match, 'command_fired');
      const instance = cfg.instances?.[activeInstanceId];
      const remainder = dictationRemainderAfterCommand(combinedText, match);
      if (remainder) enqueueDictationFromText(remainder);
      inputQueue = [];
      pendingCommandItems = [];
      action('commandMatched', { ...match, session_id: sessionId });
      if (match.command === 'pause') {
        clearTimer(TIMER_AUTO_EXECUTE);
        setState(STATES.PAUSED);
        startTimer(TIMER_PAUSE_RESET, (Number(instance?.pause_reset_seconds) || 30) * 1000);
      } else if (match.command === 'resume') {
        clearTimer(TIMER_PAUSE_RESET);
        setState(STATES.CAPTURING);
        if (Number(instance?.auto_execute_silence_ms) > 0 && messageQueue.length) {
          startTimer(TIMER_AUTO_EXECUTE, instance.auto_execute_silence_ms);
        }
      } else if (match.command === 'execute') {
        executeTranscript('command');
      } else if (match.command === 'cancel') {
        returnArmed({ reason: 'cancel' });
      }
    }

    function executeTranscript(reason = 'command') {
      if ([STATES.EXECUTING, STATES.SENT_FEEDBACK, STATES.ERROR_FEEDBACK, STATES.DISABLED, STATES.SELECTED_INACTIVE, STATES.BLOCKED, STATES.PERMISSION_PENDING, STATES.ARMED_IDLE, STATES.WAKE_CANDIDATE].includes(state)) {
        return null;
      }
      const instance = cfg.instances?.[activeInstanceId];
      if (!instance) {
        returnArmed({ reason: 'missing_instance' });
        return null;
      }
      inputQueue = [];
      pendingCommandItems = [];
      const drainedText = drainMessageQueue();
      const body = formatSendBody(drainedText, instance);
      if (!body) {
        action('sendSkipped', { reason: 'empty_message_queue', instance_id: activeInstanceId, session_id: sessionId });
        returnArmed({ reason: 'empty_message_queue' });
        return null;
      }
      sendCounter += 1;
      activeSend = { session_id: sessionId, send_id: sendCounter };
      frozenSendSnapshot = {
        session_id: sessionId,
        send_id: sendCounter,
        reason,
        instance_id: activeInstanceId,
        matrix_server: instance.matrix_server,
        matrix_room_id: instance.matrix_room_id,
        body,
      };
      clearTimer(TIMER_AUTO_EXECUTE);
      clearTimer(TIMER_INITIAL_CANCEL);
      clearTimer(TIMER_PAUSE_RESET);
      setState(STATES.EXECUTING, { send_id: sendCounter });
      return action('execute', frozenSendSnapshot);
    }

    function processWaitingSpeech() {
      while (inputQueue.length) {
        const item = inputQueue.shift();
        const combined = item.text;
        const command = findCommandMatch(combined, activeInstanceId, cfg);
        if (command) {
          commandDiagnostic('waitingSpeech', combined, command, 'command_fired');
          consumeCommand(command, combined);
          return;
        }
        commandDiagnostic('waitingSpeech', combined, null, 'no_command_match_dictation_started');
        clearTimer(TIMER_INITIAL_CANCEL);
        enqueueDictationFromText(item.text, item);
        setState(STATES.CAPTURING);
      }
    }

    function processCapturing() {
      while (inputQueue.length) {
        const item = inputQueue.shift();
        const command = findCommandMatch(item.text, activeInstanceId, cfg);
        if (command) {
          commandDiagnostic('capturing', item.text, command, 'command_fired');
          consumeCommand(command, item.text);
          return;
        }
        const instance = cfg.instances?.[activeInstanceId];
        const wakeAlias = instance ? leadingWakeAlias(item.text, instance) : '';
        if (instance && wakeAlias) {
          if (findCommandPrefixMatch(item.text, activeInstanceId, cfg) || item.phase !== 'final') {
            commandDiagnostic('capturing', item.text, null, item.phase !== 'final' ? 'wake_alias_partial_waiting' : 'command_prefix_waiting', { wake_word: wakeAlias });
            pendingCommandItems.push(item);
            clearTimer(TIMER_AUTO_EXECUTE);
            setState(STATES.COMMAND_CANDIDATE);
            return;
          }
          commandDiagnostic('capturing', item.text, null, 'wake_alias_without_command', { wake_word: wakeAlias });
        } else {
          commandDiagnostic('capturing', item.text, null, 'no_command_match_dictation');
        }
        enqueueDictationFromText(item.text, item);
        setState(STATES.CAPTURING);
      }
    }

    function processCommandCandidate() {
      if (!pendingCommandItems.length) return;
      const combinedItems = pendingCommandItems.concat(inputQueue);
      const combinedText = queueText(combinedItems);
      const command = findCommandMatch(combinedText, activeInstanceId, cfg);
      if (command) {
        commandDiagnostic('commandCandidate', combinedText, command, 'command_fired');
        consumeCommand(command, combinedText);
        return;
      }
      const instance = cfg.instances?.[activeInstanceId];
      const heldWake = leadingWakeAlias(queueText(pendingCommandItems), instance);
      const replacementText = heldWake && inputQueue.length ? `${heldWake} ${queueText(inputQueue)}` : '';
      const replacementCommand = replacementText ? findCommandMatch(replacementText, activeInstanceId, cfg) : null;
      if (replacementCommand) {
        commandDiagnostic('commandCandidateReplacement', replacementText, replacementCommand, 'command_fired', { combined_text: combinedText });
        consumeCommand(replacementCommand, replacementText);
        return;
      }
      if (findCommandPrefixMatch(combinedText, activeInstanceId, cfg)) {
        commandDiagnostic('commandCandidate', combinedText, null, 'command_prefix_waiting');
        pendingCommandItems = combinedItems;
        inputQueue = [];
        setState(STATES.COMMAND_CANDIDATE);
        return;
      }
      const latest = combinedItems[combinedItems.length - 1] || {};
      if (latest.phase !== 'final') {
        commandDiagnostic('commandCandidate', combinedText, null, 'partial_candidate_waiting');
        pendingCommandItems = combinedItems;
        inputQueue = [];
        setState(STATES.COMMAND_CANDIDATE);
        return;
      }
      if (!inputQueue.length) return;
      commandDiagnostic('commandCandidate', combinedText, null, 'no_command_match_committed_as_dictation');
      pendingCommandItems = [];
      inputQueue = [];
      enqueueDictationFromText(combinedText, combinedItems[combinedItems.length - 1] || {});
      setState(STATES.CAPTURING);
    }

    function processPaused() {
      if (!inputQueue.length && !pendingCommandItems.length) return;
      const combinedItems = pendingCommandItems.concat(inputQueue);
      const combinedText = queueText(combinedItems);
      const command = findCommandMatch(combinedText, activeInstanceId, cfg);
      const instance = cfg.instances?.[activeInstanceId];
      const heldWake = leadingWakeAlias(queueText(pendingCommandItems), instance);
      const replacementText = heldWake && inputQueue.length ? `${heldWake} ${queueText(inputQueue)}` : '';
      const replacementCommand = replacementText ? findCommandMatch(replacementText, activeInstanceId, cfg) : null;
      inputQueue = [];
      pendingCommandItems = [];
      if (command && ['resume', 'execute', 'cancel'].includes(command.command)) {
        commandDiagnostic('paused', combinedText, command, 'command_fired');
        consumeCommand(command, commandWithTrailingText(combinedText, command));
        return;
      } else if (replacementCommand && ['resume', 'execute', 'cancel'].includes(replacementCommand.command)) {
        commandDiagnostic('pausedReplacement', replacementText, replacementCommand, 'command_fired', { combined_text: combinedText });
        consumeCommand(replacementCommand, commandWithTrailingText(replacementText, replacementCommand));
        return;
      }
      if (findCommandPrefixMatch(combinedText, activeInstanceId, cfg)) {
        commandDiagnostic('paused', combinedText, command || replacementCommand, command ? 'command_disallowed_while_paused' : 'command_prefix_waiting');
        pendingCommandItems = [{ text: combinedText, normalized_text: normalizeText(combinedText) }];
        setState(STATES.PAUSED);
      } else if ((combinedItems[combinedItems.length - 1] || {}).phase !== 'final') {
        commandDiagnostic('paused', combinedText, command || replacementCommand, command ? 'command_disallowed_while_paused' : 'partial_candidate_waiting');
        pendingCommandItems = combinedItems;
        setState(STATES.PAUSED);
      } else {
        commandDiagnostic('paused', combinedText, command || replacementCommand, command ? 'command_disallowed_while_paused' : 'no_command_match_while_paused');
      }
    }

    function processInputQueue() {
      if (state === STATES.ARMED_IDLE) {
        while (inputQueue.length) {
          const item = inputQueue.shift();
          const match = findWakeMatch(item.text, cfg);
          if (match) {
            wakeDiagnostic('armedIdle', item.text, match, 'wake_fired');
            beginSession(match);
            return;
          }
          wakeDiagnostic('armedIdle', item.text, null, 'no_wake_alias_match');
        }
      } else if (state === STATES.WAKE_CONFIRMED_WAITING_SPEECH) {
        processWaitingSpeech();
      } else if (state === STATES.CAPTURING) {
        processCapturing();
      } else if (state === STATES.COMMAND_CANDIDATE) {
        processCommandCandidate();
      } else if (state === STATES.PAUSED) {
        processPaused();
      }
    }

    function splitNewUtteranceText(payload = {}) {
      const text = String(payload.text || payload.raw_text || '').trim();
      const normalized = normalizeText(text);
      if (!normalized) return '';
      const epoch = Number(payload.stream_epoch ?? streamEpoch) || 0;
      const utteranceId = String(payload.utterance_id || payload.id || `${epoch}:implicit:${Number(payload.audio_end_frame ?? currentFrame) || 0}`);
      const key = `${epoch}:${utteranceId}`;
      const previous = utterances.get(key) || { emitted_count: 0, final: false };
      if (previous.final && previous.normalized_text === normalized) return '';
      const rawWords = text.split(/\s+/).filter(Boolean);
      const normalizedWords = normalized.split(/\s+/).filter(Boolean);
      if (!rawWords.length || !normalizedWords.length) return '';
      const phase = payload.phase === 'final' || payload.is_final === true ? 'final' : 'partial';
      const targetCount = phase === 'final'
        ? normalizedWords.length
        : Math.max(0, normalizedWords.length - 1);
      const previousEmittedCount = Number(previous.emitted_count || 0);
      const newText = targetCount > previousEmittedCount
        ? rawWords.slice(previousEmittedCount, targetCount).join(' ')
        : '';
      utterances.set(key, {
        normalized_text: normalized,
        emitted_count: Math.max(previousEmittedCount, targetCount),
        final: phase === 'final',
      });
      return newText;
    }

    function markWakeWordsConsumed(payload = {}, wakeWord = '') {
      const epoch = Number(payload.stream_epoch ?? streamEpoch) || 0;
      const utteranceId = String(payload.utterance_id || payload.id || `${epoch}:implicit:${Number(payload.audio_end_frame ?? currentFrame) || 0}`);
      const key = `${epoch}:${utteranceId}`;
      const existing = utterances.get(key) || {};
      const wakeWordCount = normalizeText(wakeWord).split(/\s+/).filter(Boolean).length || 1;
      utterances.set(key, {
        ...existing,
        normalized_text: normalizeText(payload.text || payload.raw_text || ''),
        emitted_count: Math.max(Number(existing.emitted_count || 0), wakeWordCount),
        final: existing.final === true,
      });
    }

    function isFresh(payload = {}, markerFrame = 0) {
      const epoch = Number(payload.stream_epoch ?? streamEpoch) || 0;
      if (streamEpoch && epoch && epoch !== streamEpoch) return false;
      const endFrame = Number(payload.audio_end_frame ?? currentFrame + 1) || 0;
      return endFrame > markerFrame;
    }

    function textInput(input, payload = {}) {
      if ([STATES.EXECUTING, STATES.SENT_FEEDBACK, STATES.ERROR_FEEDBACK, STATES.DISABLED, STATES.SELECTED_INACTIVE, STATES.BLOCKED, STATES.PERMISSION_PENDING].includes(state)) {
        return null;
      }
      currentFrame = Math.max(currentFrame, Number(payload.audio_end_frame ?? payload.audio_frame ?? currentFrame + 1) || currentFrame + 1);
      const phase = input === 'sttFinal' ? 'final' : input === 'sttPartial' ? 'partial' : payload.phase;
      const enriched = { ...payload, phase };
      const marker = state === STATES.ARMED_IDLE ? armedAfterFrame : captureAfterFrame;
      if (!isFresh(enriched, marker)) {
        action('staleSpeechIgnored', { session_id: sessionId, audio_end_frame: payload.audio_end_frame, marker });
        return null;
      }
      let text = splitNewUtteranceText(enriched);
      if (!text && state === STATES.ARMED_IDLE) {
        const wake = findWakeMatch(String(enriched.text || enriched.raw_text || ''), cfg);
        if (wake) {
          wakeDiagnostic('armedIdleFullUtterance', enriched.text || enriched.raw_text || '', wake, 'wake_fired');
          markWakeWordsConsumed(enriched, wake.wake_word);
          beginSession(wake);
          return wake;
        }
      }
      if (!text) return null;
      if (state === STATES.WAKE_CANDIDATE) {
        action('wakeRejected', { reason: 'speech_before_pause', text, session_id: sessionId });
        returnArmed({ reason: 'speech_before_pause' });
        return null;
      }
      enqueueInput(text, enriched);
      processInputQueue();
      return null;
    }

    function dispatch(input, payload = {}) {
      if (input === 'configure') {
        cfg = mergedConfig(payload.config || payload);
        return null;
      }
      if (input === 'modeChanged' || input === 'activationChanged' || input === 'leaseChanged') {
        const mode = String(payload.mode || payload.stt_mode || '').replace(/-/g, '_');
        const selected = mode === 'wake_to_talk' || payload.wake_selected === true;
        const active = payload.active === true
          || payload.activation_active === true
          || payload.activated === true
          || payload.lease_active === true
          || payload.owns_lease === true;
        if (!selected) {
          clearSession();
          setState(STATES.DISABLED);
        } else if (!active) {
          clearSession();
          setState(STATES.SELECTED_INACTIVE);
        } else if (payload.blocked_reason) {
          clearSession();
          setState(STATES.BLOCKED, { reason: String(payload.blocked_reason || '') });
        } else if (![STATES.ARMED_IDLE, STATES.PERMISSION_PENDING].includes(state)) {
          setState(STATES.PERMISSION_PENDING);
          action('requestMic');
        }
        return null;
      }
      if (input === 'micReady') {
        if (state !== STATES.PERMISSION_PENDING) {
          return null;
        }
        streamEpoch = Number(payload.stream_epoch ?? streamEpoch + 1) || 1;
        currentFrame = Math.max(currentFrame, Number(payload.audio_frame ?? payload.audio_end_frame ?? currentFrame) || currentFrame);
        utterances.clear();
        clearSession();
        armedAfterFrame = currentFrame;
        setState(STATES.ARMED_IDLE, { stream_epoch: streamEpoch, armed_after_frame: armedAfterFrame });
        return null;
      }
      if (input === 'micError') {
        action(input, { error: payload.error || payload.detail || '' });
        clearQueues();
        setState(STATES.ERROR_FEEDBACK);
        startTimer(TIMER_ERROR_FEEDBACK, 2000);
        return null;
      }
      if (input === 'speechHypothesis' || input === 'sttPartial' || input === 'sttFinal') {
        return textInput(input, payload);
      }
      if (input === 'vadSpeechStart' || input === 'vadTimeout' || input === 'silenceTimeout') {
        action('resetStt', {
          reason: payload.reason || (input === 'vadSpeechStart' ? 'vad_speech_start' : (input === 'silenceTimeout' ? 'silence_timeout' : 'vad_timeout')),
          session_id: sessionId,
          timeout_ms: Number(payload.timeout_ms || 0) || 0,
          audio_frame: Number(payload.audio_frame ?? payload.audio_end_frame ?? currentFrame) || 0,
        });
        return null;
      }
      if (input === 'audioLevel' && state === STATES.WAKE_CANDIDATE) {
        const level = Number(payload.level || 0);
        if (level > SPEECH_LEVEL_THRESHOLD) {
          action('wakeRejected', { reason: 'audio_before_pause', level, session_id: sessionId });
          returnArmed({ reason: 'audio_before_pause' });
        }
        return null;
      }
      if (input === 'silenceElapsed' || input === 'timerElapsed') {
        const timer = payload.timer || payload.name;
        const hasSessionId = Object.prototype.hasOwnProperty.call(payload, 'session_id');
        const callbackSession = Number(hasSessionId ? payload.session_id : sessionId) || 0;
        if (hasSessionId && callbackSession !== sessionId) {
          action('staleTimerIgnored', { timer, session_id: callbackSession, current_session_id: sessionId });
          return null;
        }
        if (timer === TIMER_POST_WAKE && state === STATES.WAKE_CANDIDATE) {
          const instance = cfg.instances?.[activeInstanceId];
          captureAfterFrame = Math.max(currentFrame, Number(payload.audio_frame ?? payload.audio_end_frame ?? currentFrame) || currentFrame);
          setState(STATES.WAKE_CONFIRMED_WAITING_SPEECH, { capture_after_frame: captureAfterFrame });
          action('resetStt', { reason: 'wake_confirmed_waiting_speech', session_id: sessionId });
          startTimer(TIMER_INITIAL_CANCEL, instance?.initial_silence_cancel_ms ?? 1000);
        } else if (timer === TIMER_INITIAL_CANCEL && state === STATES.WAKE_CONFIRMED_WAITING_SPEECH) {
          returnArmed({ reason: 'initial_silence_cancel' });
        } else if (timer === TIMER_PAUSE_RESET && state === STATES.PAUSED) {
          returnArmed({ reason: 'pause_reset' });
        } else if (timer === TIMER_AUTO_EXECUTE && state === STATES.CAPTURING) {
          executeTranscript('silence');
        } else if (timer === TIMER_SENT_FEEDBACK && state === STATES.SENT_FEEDBACK) {
          returnArmed({ reason: 'sent_feedback_done' });
        } else if (timer === TIMER_ERROR_FEEDBACK && state === STATES.ERROR_FEEDBACK) {
          returnArmed({ reason: 'error_feedback_done' });
        }
        return null;
      }
      if (input === 'manualExecute') {
        const callbackSession = Number(payload.session_id ?? sessionId) || 0;
        if (sessionId && callbackSession && callbackSession !== sessionId) return null;
        return executeTranscript('manual');
      }
      if (input === 'manualCancel') {
        returnArmed({ reason: 'manual_cancel' });
        return null;
      }
      if (input === 'sendSucceeded' || input === 'sendFailed') {
        const callbackSession = Number(payload.session_id ?? activeSend?.session_id) || 0;
        const callbackSend = Number(payload.send_id ?? activeSend?.send_id) || 0;
        if (!activeSend || callbackSession !== activeSend.session_id || callbackSend !== activeSend.send_id) {
          action('staleSendIgnored', {
            event: input,
            session_id: callbackSession,
            send_id: callbackSend,
            current_session_id: activeSend?.session_id || sessionId,
            current_send_id: activeSend?.send_id || 0,
          });
          return null;
        }
        if (input === 'sendSucceeded') {
          setState(STATES.SENT_FEEDBACK, { send_id: activeSend.send_id });
          startTimer(TIMER_SENT_FEEDBACK, 2000);
        } else {
          action(input, { error: payload.error || payload.detail || '', snapshot: clone(frozenSendSnapshot) });
          setState(STATES.ERROR_FEEDBACK, { send_id: activeSend.send_id });
          startTimer(TIMER_ERROR_FEEDBACK, 2000);
        }
      }
      return null;
    }

    return {
      dispatch,
      getState: () => state,
      getActiveInstanceId: () => activeInstanceId,
      getSessionId: () => sessionId,
      getActiveSend: () => clone(activeSend),
      getTranscript: () => queueText(messageQueue),
      getQueues: () => ({
        input_queue: clone(pendingCommandItems.concat(inputQueue)),
        raw_input_queue: clone(inputQueue),
        pending_command_items: clone(pendingCommandItems),
        message_queue: clone(messageQueue),
      }),
      getCommandDiagnostics: () => ({
        command_candidate_state: state === STATES.COMMAND_CANDIDATE || state === STATES.PAUSED,
        active_instance_id: activeInstanceId,
        normalized_input_text: normalizeText(queueText(inputQueue)),
        normalized_pending_command_text: normalizeText(queueText(pendingCommandItems)),
        normalized_message_text: normalizeText(queueText(messageQueue)),
        pending_command_text: queueText(pendingCommandItems),
        input_queue_text: queueText(inputQueue),
        message_queue_text: queueText(messageQueue),
        last_command_check: clone(lastCommandCheck),
        last_wake_check: clone(lastWakeCheck),
      }),
      getFrozenSendSnapshot: () => clone(frozenSendSnapshot),
      getConfig: () => clone(cfg),
      getLastOutput: () => lastOutput,
    };
  }

  return {
    STATES,
    STT_SEGMENT_STATES,
    TIMERS: {
      TIMER_POST_WAKE,
      TIMER_INITIAL_CANCEL,
      TIMER_PAUSE_RESET,
      TIMER_AUTO_EXECUTE,
      TIMER_SENT_FEEDBACK,
      TIMER_ERROR_FEEDBACK,
    },
    DEFAULTS,
    createMachine,
    normalizeText,
    findWakeMatch,
    findCommandMatch,
    findCommandPrefixMatch,
    sanitizeTranscript,
    formatSendBody,
    createSttEventClassifier,
    createSttSegmentController,
    mergedConfig,
  };
});
