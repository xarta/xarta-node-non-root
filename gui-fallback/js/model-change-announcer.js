// model-change-announcer.js — Responds to Blueprints push-notification events
// for AI model changes and alias test outcomes.
//
// Receives events via the 'blueprints:event' DOM CustomEvent dispatched by
// events-stream.js.  For each handled event type it:
//   1. Enqueues a toast notification
//   2. Optionally speaks the announcement through BlueprintsTtsClient
//
// ── Announcement FSM ────────────────────────────────────────────────────────
//
// Four explicit states serialize TTS output and implement debounce for
// grouped model changes:
//
//   IDLE         — nothing pending; ready to accept events
//   COLLECTING   — debounce window open; model.changed events accumulate in
//                  the stash; other events still go to the queue
//   ANNOUNCING   — TTS + toast in progress; new model.changed events stash;
//                  other events queue
//   COOLING_DOWN — brief pause after each announcement
//
// Valid transitions:
//   IDLE         → COLLECTING    (first model.changed while idle)
//   IDLE         → ANNOUNCING    (immediate event: alias tests etc.)
//   COLLECTING   → ANNOUNCING    (debounce timer fires → merge stash → drain)
//   ANNOUNCING   → COOLING_DOWN  (TTS done)
//   COOLING_DOWN → COLLECTING    (stashed model.changed pending)
//   COOLING_DOWN → ANNOUNCING    (queue has items, stash empty)
//   COOLING_DOWN → IDLE          (nothing pending)
//
// A model.changed event that arrives while ANNOUNCING is stashed; when the
// announcement completes COOLING_DOWN → _drainQueue detects the stash and
// re-enters COLLECTING for a new debounce pass.
//
// ── Catch-up replay ─────────────────────────────────────────────────────────
//
// When the SSE stream connects, the announcer fetches recent Blueprints events
// and queues any model.changed events that arrived while the browser was
// disconnected (since localStorage 'model.change.last_announced_ts').
// Replay is skipped if the last announcement was very recent (< 30 s) to avoid
// re-speaking on brief connectivity blips.
//
// ── Mute control ─────────────────────────────────────────────────────────────
//
// localStorage key 'events.tts.muted' = 'true' silences TTS for this browser.
// Toasts still appear when muted.

'use strict';

const BlueprintsModelChangeAnnouncer = (() => {

  // ── FSM States ─────────────────────────────────────────────────────────────

  const ASTATE = Object.freeze({
    IDLE:         'IDLE',
    COLLECTING:   'COLLECTING',
    ANNOUNCING:   'ANNOUNCING',
    COOLING_DOWN: 'COOLING_DOWN',
  });

  const _VALID_TRANSITIONS = {
    [ASTATE.IDLE]:         new Set([ASTATE.COLLECTING, ASTATE.ANNOUNCING]),
    [ASTATE.COLLECTING]:   new Set([ASTATE.ANNOUNCING]),
    [ASTATE.ANNOUNCING]:   new Set([ASTATE.COOLING_DOWN]),
    [ASTATE.COOLING_DOWN]: new Set([ASTATE.COLLECTING, ASTATE.ANNOUNCING, ASTATE.IDLE]),
  };

  // ── Tuning parameters ──────────────────────────────────────────────────────

  const _DEBOUNCE_MS     = 2200;  // debounce window for model.changed grouping
  const _COOLDOWN_MS     = 800;   // ms pause between consecutive announcements
  const _TOAST_DURATION  = 7000;  // ms before toast auto-dismiss
  const _TOAST_MAX       = 4;     // max simultaneous toasts
  const _REPLAY_LOOKBACK = 900;   // seconds: replay window on SSE connect (15 min)
  const _REPLAY_DELAY_MS = 4500;  // ms after SSE connect before running replay
  const _NOTIFIER_SPEECH_FRESHNESS_SECONDS = 180;
  const _HERMES_SPEECH_FRESHNESS_SECONDS = 180;

  // ── Module state ──────────────────────────────────────────────────────────

  let _astate        = ASTATE.IDLE;
  let _debounceTimer = null;
  let _cooldownTimer = null;
  const _stash       = [];  // model.changed events pending debounce merge
  const _queue       = [];  // [{ text, toastOpts }] ready-to-speak items
  const _priorityQueue = [];  // interrupting Hermes speech; bypasses normal announcements
  let _currentItem = null;
  let _normalQueuePaused = false;
  let _normalQueuePausedAt = 0;
  let _ttsOffModal = null;
  let _ttsOffModalTimer = null;
  let _ttsOffModalRemoveTimer = null;

  // Dedup: prevent speaking the same event_id twice (replay overlap guard).
  const _seenIds     = new Set();
  let _speechSequence = 0;
  let _lastSpeechState = {
    sequence: 0,
    status: 'idle',
    at: Date.now(),
  };

  // ── FSM core ───────────────────────────────────────────────────────────────

  function _can(to) {
    return (_VALID_TRANSITIONS[_astate] || new Set()).has(to);
  }

  function _transition(to, reason) {
    if (!_can(to)) {
      console.warn(
        `[model-change-announcer] FSM blocked: ${_astate} → ${to}` +
        (reason ? ` (${reason})` : '')
      );
      return false;
    }
    _astate = to;
    return true;
  }

  // ── Speech text builders ───────────────────────────────────────────────────

  /** "hosted_vllm/Qwen3-14B:latest" → "Qwen3-14B" */
  function _shortenModel(name) {
    return String(name || '').replace(/^[a-z_-]+\//i, '').split(':')[0];
  }

  /** Merge a list of model.changed events into one speech string.
   *  The latest value per role wins when the same role appears in multiple events. */
  function _speechForModelEvents(events) {
    const roleOrder = ['primary', 'embeddings', 'reranker', 'vision', 'tts'];
    const roleLabel = {
      primary:    'primary local model',
      embeddings: 'embeddings model',
      reranker:   'reranker model',
      vision:     'vision model',
      tts:        'T T S model',
    };
    const roleMap = {};
    for (const evt of events) {
      const sel = (evt.payload || {}).selected || {};
      for (const role of roleOrder) {
        if (sel[role] && sel[role].model_name) roleMap[role] = sel[role].model_name;
      }
    }
    const parts = roleOrder
      .filter(r => roleMap[r])
      .map(r => `${roleLabel[r]} is now ${_shortenModel(roleMap[r])}`);

    if (parts.length === 0) return 'Information. Local model aliases have been updated.';
    return `Information. Local model change. ${parts.join('. ')}.`;
  }

  function _speechForAliasTests(failed) {
    return failed
      ? 'Warning. Local alias tests failed after sync. Check the diagnostics page.'
      : 'Information. Local alias tests completed successfully.';
  }

  function _speechForLocalLlmOffline() {
    return 'Warning. Local Large Language Model is offline.';
  }

  function _speechForMemoryWarning(evt) {
    return String(evt?.payload?.speech || evt?.message || 'Warning. Xarta node RAM usage is high.');
  }

  function _speechForPublicExposure(evt, recovered) {
    if (evt?.payload?.speech) return String(evt.payload.speech);
    return recovered
      ? 'Information. Public exposure guard has recovered.'
      : 'Warning. Public exposure guard found a private service exposure problem.';
  }

  function _eventSeverity(evt) {
    if (typeof BlueprintsNotifierDnd !== 'undefined' && BlueprintsNotifierDnd.eventSeverity) {
      return BlueprintsNotifierDnd.eventSeverity(evt);
    }
    const raw = String(evt?.payload?.notifier_level || evt?.severity || 'information').toLowerCase();
    if (raw === 'warn') return 'warning';
    if (raw === 'info') return 'information';
    if (raw === 'critical') return 'error';
    return ['debug', 'information', 'warning', 'error'].includes(raw) ? raw : 'information';
  }

  function _hasExplicitImportance(evt) {
    if (typeof BlueprintsNotifierDnd !== 'undefined' && BlueprintsNotifierDnd.explicitImportance) {
      return Boolean(BlueprintsNotifierDnd.explicitImportance(evt));
    }
    const raw = evt?.payload?.importance || evt?.importance || '';
    return ['low_importance', 'neutral', 'urgent1', 'urgent2', 'danger1', 'danger2'].includes(raw);
  }

  function _isDanger2(evt) {
    const explicit = typeof BlueprintsNotifierDnd !== 'undefined' && BlueprintsNotifierDnd.explicitImportance
      ? BlueprintsNotifierDnd.explicitImportance(evt)
      : (evt?.payload?.importance || evt?.importance || '');
    return explicit === 'danger2';
  }

  function _isFreshNotifierSpeech(evt) {
    if (!evt?.payload?.notifier_event_id) return true;
    const createdAt = Number(evt.created_at || 0);
    if (!Number.isFinite(createdAt) || createdAt <= 0) return true;
    return (Date.now() / 1000) - createdAt <= _NOTIFIER_SPEECH_FRESHNESS_SECONDS;
  }

  function _isFreshHermesSpeech(evt) {
    if (evt?.event_type !== 'tts.utterance.requested') return true;
    const createdAt = Number(evt?.payload?.created_at || evt?.created_at || 0);
    if (!Number.isFinite(createdAt) || createdAt <= 0) return false;
    return (Date.now() / 1000) - createdAt <= _HERMES_SPEECH_FRESHNESS_SECONDS;
  }

  function _genericSpeechForEvent(evt) {
    if (evt?.payload?.speech) return String(evt.payload.speech);
    const severity = _eventSeverity(evt);
    const lead = severity === 'debug'
      ? 'Debug'
      : severity === 'information'
        ? 'Information'
        : severity === 'warning'
          ? 'Warning'
          : 'Error';
    const body = evt?.message || evt?.title || evt?.event_type || 'System notification';
    return `${lead}. ${body}`;
  }

  function _speechPolicyEvent(evt, unknownEventType = false) {
    const payload = { ...(evt?.payload || {}) };
    if (unknownEventType) payload.unknown_event_type = true;
    return { ...(evt || {}), unknown_event_type: unknownEventType, payload };
  }

  // ── Queue drain ────────────────────────────────────────────────────────────

  /** Central drain function.  Called after every state completion (cooldown done,
   *  or from IDLE when a new item arrives). */
  function _drainQueue() {
    if (_priorityQueue.length > 0) {
      const item = _priorityQueue.shift();
      const skipReason = _speechSkipReason(item);
      if (skipReason) {
        _emitSpeechSkipped(skipReason, item, { queue: 'priority' });
        _drainQueue();
        return;
      }
      if (!_transition(ASTATE.ANNOUNCING, 'priority drain')) {
        _priorityQueue.unshift(item);
        return;
      }

      _currentItem = item;
      void _showToastForEvent(item.toastOpts, item.event, item.toastCategory);
      _speak(item.text, item).finally(() => _afterAnnouncing(item));
      return;
    }

    _resumeNormalQueueAfterPriority();

    // Stash has priority: if any model.changed events accumulated since the last
    // announcement, flush them into a merged queue item.
    if (_stash.length > 0) {
      _dispatchDebounced();
      return;
    }

    if (_queue.length === 0) {
      if (_astate !== ASTATE.IDLE) _transition(ASTATE.IDLE, 'queue empty');
      return;
    }

    const item = _queue.shift();
    const skipReason = _speechSkipReason(item);
    if (skipReason) {
      _emitSpeechSkipped(skipReason, item, { queue: 'normal' });
      _drainQueue();
      return;
    }
    if (!_transition(ASTATE.ANNOUNCING, 'drain')) {
      _queue.unshift(item);  // guard: transition blocked (unexpected state)
      return;
    }

    if (item.__queuedForPriorityResume) {
      item.__queuedForPriorityResume = false;
      item.__priorityInterrupted = false;
      _recordSpeechState('resuming', item, { reason: 'hermes_priority_drained' });
    }
    _currentItem = item;
    void _showToastForEvent(item.toastOpts, item.event, item.toastCategory);
    _speak(item.text, item).finally(() => _afterAnnouncing(item));
  }

  /** Called after TTS completes (or fails).  Transitions through COOLING_DOWN
   *  then schedules the next drain. */
  function _afterAnnouncing(item) {
    if (item && item.isModelChange) _recordAnnounced();
    if (_currentItem === item) _currentItem = null;
    if (_transition(ASTATE.COOLING_DOWN, 'TTS done')) {
      _cooldownTimer = setTimeout(() => {
        _cooldownTimer = null;
        _drainQueue();
      }, (_priorityQueue.length > 0 || (item?.hermesUtterance && _normalQueuePaused)) ? 0 : _COOLDOWN_MS);
    } else {
      // Defensive: couldn't reach COOLING_DOWN — attempt drain from wherever we are.
      _drainQueue();
    }
  }

  // ── Debounce ───────────────────────────────────────────────────────────────

  /** Start or extend the debounce window.  Each new model.changed event resets
   *  the timer so rapid back-to-back switches produce a single announcement. */
  function _startOrExtendDebounce() {
    if (_debounceTimer) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      _debounceTimer = null;
      _dispatchDebounced();
    }, _DEBOUNCE_MS);
  }

  /** Merge all stashed events into one announcement, push to FRONT of queue,
   *  then drain.  Records the event as announced so replay won't re-speak it. */
  function _dispatchDebounced() {
    if (_stash.length === 0) { _drainQueue(); return; }

    const events = _stash.splice(0);  // consume entire stash
    if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }

    const lastEvt  = events[events.length - 1];
    const modeId   = (lastEvt && lastEvt.payload && lastEvt.payload.mode_id) || '';

    _queue.unshift({
      text: _speechForModelEvents(events),
      toastOpts: {
        title:    'Local Model Changed' + (modeId ? ` — ${modeId}` : ''),
        message:  (lastEvt && lastEvt.message) || `${events.length} model change(s)`,
        severity: 'info',
      },
      event: lastEvt || {},
      toastCategory: 'model_alias',
      isModelChange: true,  // flag: record timestamp after speaking
    });

    // Drain will now handle the transition and speaking.
    _drainQueue();
  }

  // ── TTS ────────────────────────────────────────────────────────────────────

  function _isMuted() {
    return localStorage.getItem('events.tts.muted') === 'true';
  }

  function _previewText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  }

  function _errorMessage(error) {
    return String(error?.message || error || '').slice(0, 240);
  }

  function _eventSummary(evt = {}) {
    const payload = evt.payload && typeof evt.payload === 'object' ? evt.payload : {};
    return {
      event_id: String(evt.event_id || ''),
      event_type: String(evt.event_type || ''),
      source: String(evt.source || payload.source || ''),
      agent_id: String(payload.agent_id || ''),
      utterance_id: String(payload.utterance_id || ''),
      client_id: String(payload.client_id || ''),
      created_at: Number(payload.created_at || evt.created_at || 0),
    };
  }

  function _recordSpeechState(status, item = {}, extra = {}) {
    const detail = {
      sequence: ++_speechSequence,
      status,
      at: Date.now(),
      announcer_state: _astate,
      queue_length: _queue.length,
      priority_queue_length: _priorityQueue.length,
      stash_length: _stash.length,
      muted: _isMuted(),
      hermes_utterance: !!item.hermesUtterance,
      title: item.toastOpts?.title || '',
      text_preview: _previewText(item.text),
      event: _eventSummary(item.event || {}),
      ...extra,
    };
    _lastSpeechState = detail;
    try {
      document.dispatchEvent(new CustomEvent('blueprints:notification-speech-state', {
        detail,
        bubbles: false,
      }));
    } catch (_) {}
    return detail;
  }

  function _emitSpeechSuppressed(reason, item = {}, extra = {}) {
    _recordSpeechState('suppressed', item, { reason, ...(extra || {}) });
    try {
      document.dispatchEvent(new CustomEvent('blueprints:notification-speech-suppressed', {
        detail: {
          reason,
          event: item.event || {},
          title: item.toastOpts?.title || '',
          ...(extra || {}),
        },
        bubbles: false,
      }));
    } catch (_) {}
  }

  function _emitSpeechSkipped(reason, item = {}, extra = {}) {
    _recordSpeechState('skipped', item, { reason, ...(extra || {}) });
    try {
      document.dispatchEvent(new CustomEvent('blueprints:notification-speech-skipped', {
        detail: {
          reason,
          event: item.event || {},
          title: item.toastOpts?.title || '',
          ...(extra || {}),
        },
        bubbles: false,
      }));
    } catch (_) {}
  }

  function _clampTtsOffText(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= 520) return text;
    return `${text.slice(0, 517).trim()}...`;
  }

  function _ensureTtsOffModal() {
    if (_ttsOffModal?.isConnected) return _ttsOffModal;
    const modal = document.createElement('div');
    modal.id = 'bp-tts-off-modal';
    modal.className = 'bp-tts-off-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-live', 'polite');
    modal.setAttribute('aria-label', 'TTS is off on this browser');

    const panel = document.createElement('div');
    panel.className = 'bp-tts-off-modal__panel';

    const title = document.createElement('strong');
    title.className = 'bp-tts-off-modal__title';
    title.textContent = 'TTS is off on this browser';

    const message = document.createElement('p');
    message.className = 'bp-tts-off-modal__message';

    panel.appendChild(title);
    panel.appendChild(message);
    modal.appendChild(panel);
    document.body.appendChild(modal);
    _ttsOffModal = modal;
    return modal;
  }

  function _hideTtsOffModal() {
    const modal = _ttsOffModal;
    if (!modal?.isConnected) return;
    modal.classList.remove('bp-tts-off-modal--visible');
    modal.classList.add('bp-tts-off-modal--leaving');
    _ttsOffModalRemoveTimer = window.setTimeout(() => {
      modal.remove();
      if (_ttsOffModal === modal) _ttsOffModal = null;
    }, 420);
  }

  function _showTtsOffModal(item = {}) {
    try {
      const evt = item.event || {};
      const payload = evt.payload || {};
      const text = _clampTtsOffText(item.text || payload.text || evt.message || 'Hermes sent a spoken response.');
      if (_ttsOffModalTimer) window.clearTimeout(_ttsOffModalTimer);
      if (_ttsOffModalRemoveTimer) window.clearTimeout(_ttsOffModalRemoveTimer);
      const modal = _ensureTtsOffModal();
      const message = modal.querySelector('.bp-tts-off-modal__message');
      if (message) message.textContent = text;
      modal.classList.remove('bp-tts-off-modal--leaving');
      requestAnimationFrame(() => modal.classList.add('bp-tts-off-modal--visible'));
      _ttsOffModalTimer = window.setTimeout(_hideTtsOffModal, 5000);
    } catch (_) {}
  }

  function _itemPriority(item = {}) {
    const payload = item.event?.payload || {};
    const raw = payload.priority ?? payload.metadata?.tts_priority;
    const parsed = Number(raw);
    if (raw !== undefined && raw !== null && raw !== '' && Number.isFinite(parsed)) return parsed;
    const source = String(payload.source || item.event?.source || '').toLowerCase();
    const agentId = String(payload.agent_id || '').toLowerCase();
    if (source === 'hermes-stt' || agentId === 'hermes-stt') return 100;
    if (source.startsWith('hermes') || agentId.startsWith('hermes')) return 90;
    return 0;
  }

  function _itemQueuePolicy(item = {}) {
    const payload = item.event?.payload || {};
    return String(payload.queue_policy || payload.metadata?.tts_queue_policy || '').toLowerCase();
  }

  function _isHermesPriorityUtterance(item) {
    return _isHermesUtterance(item)
      && (_itemPriority(item) >= 90 || _itemQueuePolicy(item) === 'hermes_priority_stream');
  }

  function _speechSkipReason(item = {}) {
    const evt = item.event || {};
    if (!String(item.text || '').trim()) return 'empty_speech_text';
    if (!_isFreshNotifierSpeech(evt)) return 'stale_notifier_replay';
    if (!_isFreshHermesSpeech(evt)) return 'stale_hermes_utterance_replay';
    return '';
  }

  function _pauseNormalQueueForPriority(item = {}, reason = 'hermes_priority') {
    if (_normalQueuePaused) return;
    _normalQueuePaused = true;
    _normalQueuePausedAt = Date.now();
    _recordSpeechState('paused', item, {
      reason,
      paused_queue_length: _queue.length,
      paused_stash_length: _stash.length,
      active_item: _eventSummary(_currentItem?.event || {}),
    });
  }

  function _resumeNormalQueueAfterPriority(reason = 'hermes_priority_drained') {
    if (!_normalQueuePaused) return;
    const pausedForMs = _normalQueuePausedAt ? Date.now() - _normalQueuePausedAt : 0;
    _normalQueuePaused = false;
    _normalQueuePausedAt = 0;
    _recordSpeechState('resumed', {}, {
      reason,
      paused_for_ms: pausedForMs,
      resumed_queue_length: _queue.length,
      resumed_stash_length: _stash.length,
    });
  }

  function _queueInterruptedItemForResume(item, interruptingItem) {
    if (!item || item.hermesUtterance || item.__queuedForPriorityResume) return false;
    item.__priorityInterrupted = true;
    item.__queuedForPriorityResume = true;
    _queue.unshift(item);
    _recordSpeechState('interrupted', item, {
      reason: 'hermes_priority_interrupt',
      resume_queued: true,
      interrupted_by: _eventSummary(interruptingItem?.event || {}),
    });
    return true;
  }

  async function _speak(text, item = {}) {
    const evt = item.event || {};
    _recordSpeechState('received', item);
    const testBroadcast = evt?.payload?.frontend_contract === 'notification-tests-modal'
      && evt?.payload?.test_broadcast_speech === true;
    if (_isMuted()) {
      _emitSpeechSuppressed('browser_tts_muted', item);
      return;
    }
    if (!_isFreshNotifierSpeech(evt)) {
      _emitSpeechSkipped('stale_notifier_replay', item);
      return;
    }
    if (!_isFreshHermesSpeech(evt)) {
      _emitSpeechSkipped('stale_hermes_utterance_replay', item);
      return;
    }
    if (item.hermesUtterance
        && typeof BlueprintsVoiceMode !== 'undefined'
        && typeof BlueprintsVoiceMode.canSpeakHermesUtterance === 'function'
        && !await BlueprintsVoiceMode.canSpeakHermesUtterance()) {
      void _showTtsOffModal(item);
      _emitSpeechSuppressed('voice_mode_not_active_tts_browser', item);
      return;
    }
    if (typeof BlueprintsNotifierDnd !== 'undefined') {
      await BlueprintsNotifierDnd.loadConfig();
      if (item.hermesUtterance) {
        const shouldBroadcast = evt?.payload?.target?.dedupe === 'broadcast';
        if (!shouldBroadcast && !await BlueprintsNotifierDnd.claimSpeech(evt)) {
          _emitSpeechSuppressed('speech_claim_denied', item);
          return;
        }
        item.volume = Number.isFinite(Number(evt?.payload?.volume))
          ? Number(evt.payload.volume)
          : undefined;
      } else {
        if (!BlueprintsNotifierDnd.shouldSpeak(evt)) {
          _emitSpeechSuppressed('dnd_policy_suppressed', item);
          return;
        }
        if (!testBroadcast && !await BlueprintsNotifierDnd.claimSpeech(evt)) {
          _emitSpeechSuppressed('speech_claim_denied', item);
          return;
        }
        item.volume = BlueprintsNotifierDnd.ttsVolume(evt);
      }
    }
    if (typeof BlueprintsTtsClient === 'undefined') {
      _emitSpeechSuppressed('tts_client_unavailable', item);
      return;
    }
    if (typeof BlueprintsTtsClient.speak !== 'function') {
      _emitSpeechSuppressed('tts_speak_unavailable', item);
      return;
    }
    try {
      if (item.hermesUtterance) {
        const payload = evt?.payload || {};
        if (typeof BlueprintsVoiceMode !== 'undefined'
            && typeof BlueprintsVoiceMode.maybePlayAnnouncementCue === 'function') {
          const cueStartedAt = performance.now();
          const cueResult = await BlueprintsVoiceMode.maybePlayAnnouncementCue(evt);
          console.info('[tts-timing]', {
            label: 'hermes.conversation',
            stage: 'cue-offset-complete',
            played: !!cueResult,
            cue: cueResult || null,
            elapsedMs: Math.round(performance.now() - cueStartedAt),
          });
        }
        _recordSpeechState('speaking', item);
        const result = await BlueprintsTtsClient.speak({
          text,
          voice: typeof payload.voice === 'string' && payload.voice ? payload.voice : undefined,
          clientId: typeof payload.client_id === 'string' ? payload.client_id : undefined,
          utteranceId: typeof payload.utterance_id === 'string' ? payload.utterance_id : undefined,
          eventId: typeof evt.event_id === 'string' ? evt.event_id : undefined,
          interrupt: typeof payload.interrupt === 'boolean' ? payload.interrupt : false,
          mode: typeof payload.mode === 'string' ? payload.mode : 'stream',
          format: typeof payload.format === 'string' ? payload.format : 'wav',
          timeoutMs: Number.isFinite(Number(payload.timeout_ms)) ? Number(payload.timeout_ms) : 120000,
          allowFallback: typeof payload.allow_fallback === 'boolean' ? payload.allow_fallback : false,
          fallbackKind: 'neutral',
          eventKind: 'hermes.conversation',
          sanitizeText: payload.sanitize_text !== false,
          transformProfile: typeof payload.transform_profile === 'string' ? payload.transform_profile : 'conversation',
          allowLlmSanitizer: payload.allow_llm_sanitizer === true,
          volume: item.volume,
          volumeGain: Number.isFinite(Number(payload.volume_gain)) ? Number(payload.volume_gain) : undefined,
          debugTiming: true,
          timingLabel: 'hermes.conversation',
        });
        if (item.__priorityInterrupted) {
          _recordSpeechState('interrupted', item, { reason: 'hermes_priority_interrupt' });
          return;
        }
        _recordSpeechState('completed', item, {
          engine: result?.engine || '',
          playback_sequence: Number(result?.playback_sequence || 0),
        });
        return;
      }
      _recordSpeechState('speaking', item);
      const result = await BlueprintsTtsClient.speak({
        text,
        eventId: typeof evt.event_id === 'string' ? evt.event_id : undefined,
        interrupt: false,
        mode: 'stream',
        fallbackKind: 'neutral',
        eventKind: 'notification',
        volume: item.volume,
      });
      if (item.__priorityInterrupted) {
        _recordSpeechState('interrupted', item, { reason: 'hermes_priority_interrupt' });
        return;
      }
      _recordSpeechState('completed', item, {
        engine: result?.engine || '',
        playback_sequence: Number(result?.playback_sequence || 0),
      });
    } catch (e) {
      if (item.__priorityInterrupted) {
        _recordSpeechState('interrupted', item, {
          reason: 'hermes_priority_interrupt',
          error: _errorMessage(e),
        });
        return;
      }
      console.warn('[model-change-announcer] TTS error (non-fatal):', e);
      _recordSpeechState('error', item, { error: _errorMessage(e) });
      _emitSpeechSuppressed('tts_error', item, { error: _errorMessage(e) });
    }
  }

  // ── Toast ──────────────────────────────────────────────────────────────────

  function _container() {
    let el = document.getElementById('bp-event-toasts');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'bp-event-toasts';
    el.setAttribute('role', 'log');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', 'System notifications');
    document.body.appendChild(el);
    return el;
  }

  function _toastCategoryForEvent(evt, fallback = 'unknown_other') {
    if (typeof BlueprintsNotifierDnd !== 'undefined' && BlueprintsNotifierDnd.toastCategoryForEvent) {
      return BlueprintsNotifierDnd.toastCategoryForEvent(evt);
    }
    return fallback;
  }

  function _normalizeToastCategory(category) {
    if (typeof BlueprintsNotifierDnd !== 'undefined' && BlueprintsNotifierDnd.normalizeToastCategory) {
      return BlueprintsNotifierDnd.normalizeToastCategory(category);
    }
    const value = String(category || '');
    return value || 'unknown_other';
  }

  async function _showToastForEvent(toastOpts = {}, event = {}, category = null) {
    const toastCategory = _normalizeToastCategory(category || toastOpts.category || _toastCategoryForEvent(event));
    try {
      if (typeof BlueprintsNotifierDnd !== 'undefined') {
        const config = await BlueprintsNotifierDnd.loadConfig();
        if (!BlueprintsNotifierDnd.shouldShowToast(event || {}, toastCategory, config)) return;
      }
    } catch (error) {
      console.warn('[model-change-announcer] toast policy check failed:', error);
    }
    _showToast({ ...toastOpts, category: toastCategory });
  }

  function _showToast({ title, message, severity, category }) {
    const container = _container();
    while (container.children.length >= _TOAST_MAX) {
      container.removeChild(container.firstChild);
    }

    const toast   = document.createElement('div');
    toast.className = `bp-event-toast bp-event-toast--${severity || 'info'}`;
    toast.setAttribute('role', 'status');
    if (category) toast.dataset.toastCategory = category;

    const iconEl  = document.createElement('span');
    iconEl.className = 'bp-event-toast__icon';
    iconEl.setAttribute('aria-hidden', 'true');

    const bodyEl  = document.createElement('div');
    bodyEl.className = 'bp-event-toast__body';

    const titleEl = document.createElement('strong');
    titleEl.className = 'bp-event-toast__title';
    titleEl.textContent = title || '';

    const msgEl   = document.createElement('span');
    msgEl.className = 'bp-event-toast__msg';
    msgEl.textContent = message || '';

    const closeEl = document.createElement('button');
    closeEl.className = 'bp-event-toast__close';
    closeEl.setAttribute('aria-label', 'Dismiss');
    closeEl.type = 'button';
    closeEl.textContent = '\u2715';

    bodyEl.appendChild(titleEl);
    bodyEl.appendChild(msgEl);
    toast.appendChild(iconEl);
    toast.appendChild(bodyEl);
    toast.appendChild(closeEl);

    closeEl.addEventListener('click', () => _dismiss(toast));
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('bp-event-toast--visible'));
    setTimeout(() => _dismiss(toast), _TOAST_DURATION);
  }

  function _dismiss(toast) {
    if (!toast.parentNode) return;
    toast.classList.remove('bp-event-toast--visible');
    toast.classList.add('bp-event-toast--leaving');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 600);
  }

  // ── Event routing ──────────────────────────────────────────────────────────

  function _handle(evt) {
    if (!evt || !evt.event_type) return;

    // Global dedup: don't speak an event we have already dispatched this session
    // (protects against replay overlap on reconnect).
    const eid = evt.event_id;
    if (eid) {
      if (_seenIds.has(eid)) return;
      _seenIds.add(eid);
      if (_seenIds.size > 200) {
        _seenIds.delete(_seenIds.values().next().value);
      }
    }

    switch (evt.event_type) {

      case 'model.changed': {
        _stash.push(evt);
        if (_astate === ASTATE.IDLE) {
          _transition(ASTATE.COLLECTING, 'first model.changed');
          _startOrExtendDebounce();
        } else if (_astate === ASTATE.COLLECTING) {
          // Extend the debounce window — more changes may be arriving.
          _startOrExtendDebounce();
        }
        // ANNOUNCING | COOLING_DOWN: stash only; debounce fires after _afterAnnouncing.
        break;
      }

      case 'alias.tests.completed':
        _pushAndDrain(
          _speechForAliasTests(false),
          { title: 'Alias Tests Passed', message: evt.message || '', severity: 'info' },
          evt,
          { toastCategory: 'model_alias' }
        );
        break;

      case 'alias.tests.failed':
        _pushAndDrain(
          _speechForAliasTests(true),
          { title: 'Alias Tests Failed', message: evt.message || '', severity: 'error' },
          evt,
          { toastCategory: 'model_alias' }
        );
        break;

      case 'local.llm.offline':
        _pushAndDrain(
          _speechForLocalLlmOffline(),
          {
            title: evt.title || 'Local LLM Offline',
            message: evt.message || 'Local Large Language Model is offline.',
            severity: evt.severity || 'error',
          },
          evt,
          { toastCategory: 'system_health' }
        );
        break;

      case 'system.memory.warning':
        _pushAndDrain(
          _speechForMemoryWarning(evt),
          {
            title: evt.title || 'RAM Warning',
            message: evt.message || '',
            severity: evt.severity || 'warn',
          },
          evt,
          { toastCategory: 'system_health' }
        );
        break;

      case 'security.public_exposure.warning':
        _pushAndDrain(
          _speechForPublicExposure(evt, false),
          {
            title: evt.title || 'Public Exposure Guard Failed',
            message: evt.message || '',
            severity: evt.severity || 'error',
          },
          evt,
          { toastCategory: 'security' }
        );
        break;

      case 'security.public_exposure.recovered':
        _pushAndDrain(
          _speechForPublicExposure(evt, true),
          {
            title: evt.title || 'Public Exposure Guard Recovered',
            message: evt.message || '',
            severity: evt.severity || 'info',
          },
          evt,
          { toastCategory: 'security' }
        );
        break;

      case 'tts.utterance.requested': {
        const payload = evt.payload || {};
        const text = String(payload.text || '').trim();
        _pushAndDrain(
          text || evt.message || 'Hermes speech.',
          {
            title: evt.title || 'Hermes Speech',
            message: payload.agent_id ? `Agent: ${payload.agent_id}` : (evt.message || ''),
            severity: evt.severity || 'info',
          },
          evt,
          { hermesUtterance: true, toastCategory: 'hermes_speech' }
        );
        break;
      }

      case 'voice.mode.changed':
        void _showToastForEvent({
          title: evt.title || 'Active Browser State',
          message: evt.message || 'Active Browser state changed.',
          severity: evt.severity || 'info',
        }, evt, 'active_browser_state');
        break;

      case 'blueprints.active_browser.command':
      case 'voice.mode.dev.command': {
        const payload = evt.payload || {};
        const action = payload.action || payload.command || payload.mode || '';
        void _showToastForEvent({
          title: evt.title || 'Active Browser Command',
          message: evt.message || (action ? `Action: ${action}` : ''),
          severity: evt.severity || 'info',
        }, evt, 'active_browser_commands');
        break;
      }

      case 'matrix.chat.sync':
        break;

      default:
        // Unknown event type: always toast. Warnings/errors, and any event with
        // explicit importance, can speak through the DND policy.
        {
          const unknownEvt = _speechPolicyEvent(evt, true);
          const severity = _eventSeverity(unknownEvt);
          const maySpeak = !unknownEvt.payload?.suppress_speech
            && !_isDanger2(unknownEvt)
            && (_hasExplicitImportance(unknownEvt) || severity === 'warning' || severity === 'error');
          if (maySpeak) {
            _pushAndDrain(
              _genericSpeechForEvent(unknownEvt),
              {
                title: evt.title || evt.event_type,
                message: evt.message || '',
                severity: evt.severity || 'info',
              },
              unknownEvt,
              { toastCategory: _toastCategoryForEvent(unknownEvt) }
            );
            break;
          }
        }
        void _showToastForEvent({
          title:    evt.title    || evt.event_type,
          message:  evt.message  || '',
          severity: evt.severity || 'info',
        }, evt, _toastCategoryForEvent(evt));
        break;
    }
  }

  function _isHermesUtterance(item) {
    return !!item?.hermesUtterance;
  }

  function _isInterruptingHermesUtterance(item) {
    return !!(_isHermesUtterance(item) && item?.event?.payload?.interrupt === true);
  }

  function _prioritizeHermesUtterance(item) {
    if (!_isHermesPriorityUtterance(item)) return false;

    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }
    if (_cooldownTimer) {
      clearTimeout(_cooldownTimer);
      _cooldownTimer = null;
    }
    _priorityQueue.push(item);
    const interrupting = _isInterruptingHermesUtterance(item);
    _pauseNormalQueueForPriority(item, interrupting ? 'hermes_interrupt' : 'hermes_priority');
    _recordSpeechState('priority_queued', item, {
      reason: interrupting ? 'hermes_interrupt' : 'hermes_priority',
      priority: _itemPriority(item),
      queue_policy: _itemQueuePolicy(item),
    });

    if (_astate === ASTATE.IDLE || _astate === ASTATE.COOLING_DOWN || _astate === ASTATE.COLLECTING) {
      _astate = ASTATE.IDLE;
      _drainQueue();
      return true;
    }

    const lowerPriorityActive = _currentItem && !_isHermesPriorityUtterance(_currentItem);
    if ((interrupting || lowerPriorityActive)
        && _astate === ASTATE.ANNOUNCING
        && typeof BlueprintsTtsClient !== 'undefined'
        && typeof BlueprintsTtsClient.stop === 'function') {
      _queueInterruptedItemForResume(_currentItem, item);
      void BlueprintsTtsClient.stop();
    }
    return true;
  }

  /** Push an item directly to the announcement queue (no debounce) and drain
   *  if the machine is currently idle. */
  function _pushAndDrain(text, toastOpts, event = null, extra = {}) {
    const evt = event || {};
    const toastCategory = _normalizeToastCategory(
      extra.toastCategory || toastOpts?.category || _toastCategoryForEvent(evt)
    );
    const item = { text, toastOpts, event: evt, ...(extra || {}), toastCategory };
    if (_prioritizeHermesUtterance(item)) return;
    _queue.push(item);
    _recordSpeechState('queued', item);
    if (_astate === ASTATE.IDLE) _drainQueue();
    // Otherwise the item will be picked up when the current announcement finishes.
  }

  // ── Catch-up replay ────────────────────────────────────────────────────────

  let _replayScheduled = false;

  function _scheduleReplay() {
    if (_replayScheduled) return;
    _replayScheduled = true;
    setTimeout(async () => {
      _replayScheduled = false;
      await _replayMissedEvents();
    }, _REPLAY_DELAY_MS);
  }

  async function _replayMissedEvents() {
    const lastTs = parseFloat(localStorage.getItem('model.change.last_announced_ts') || '0');
    const nowSec = Date.now() / 1000;

    // Skip if we announced very recently — this is just a brief SSE reconnect.
    if (lastTs > 0 && nowSec - lastTs < 30) return;

    let events;
    try {
      const resp = await apiFetch('/api/v1/events/recent?limit=30');
      if (!resp.ok) return;
      const raw = await resp.json();
      events = Array.isArray(raw) ? raw : [];
    } catch {
      return;
    }

    const cutoff = Math.max(lastTs, nowSec - _REPLAY_LOOKBACK);
    const missed = events
      .filter(e =>
        e.event_type === 'model.changed' &&
        typeof e.created_at === 'number' &&
        e.created_at > cutoff &&
        !(e.event_id && _seenIds.has(e.event_id))
      )
      .sort((a, b) => a.created_at - b.created_at);

    if (missed.length === 0) return;

    for (const e of missed) {
      if (e.event_id) _seenIds.add(e.event_id);
    }

    const count  = missed.length;
    const speech = _speechForModelEvents(missed.map(e => ({ payload: e.payload || {} })));
    _pushAndDrain(speech, {
      title:    count === 1 ? 'Model Changed (while offline)' : `${count} Model Changes (while offline)`,
      message:  missed[missed.length - 1].message || 'Local model aliases updated.',
      severity: 'info',
    }, missed[missed.length - 1] || {});
    _recordAnnounced();
  }

  function _recordAnnounced() {
    localStorage.setItem('model.change.last_announced_ts', String(Date.now() / 1000));
  }

  // ── Wire DOM listeners ─────────────────────────────────────────────────────

  document.addEventListener('blueprints:event', (domEvt) => {
    if (domEvt.detail) _handle(domEvt.detail);
  });

  document.addEventListener('blueprints:stream:state', (domEvt) => {
    if (domEvt.detail && domEvt.detail.state === 'CONNECTED') {
      _scheduleReplay();
    }
  });

  // ── Public API ─────────────────────────────────────────────────────────────

  return Object.freeze({

    /** Suppress TTS for this browser session.  Toasts still appear. */
    setMuted(muted) {
      localStorage.setItem('events.tts.muted', muted ? 'true' : 'false');
    },

    /** @returns {boolean} Whether TTS is currently muted. */
    isMuted() { return _isMuted(); },

    /** @returns {string} Current FSM state. */
    getState() { return _astate; },

    /** @returns {number} Items waiting in the announcement queue. */
    getQueueLength() { return _queue.length; },

    /** @returns {number} Model-change events sitting in the debounce stash. */
    getStashLength() { return _stash.length; },

    getRuntimeState() {
      return {
        state: _astate,
        queue_length: _queue.length,
        priority_queue_length: _priorityQueue.length,
        stash_length: _stash.length,
        normal_queue_paused: _normalQueuePaused,
        normal_queue_paused_for_ms: _normalQueuePausedAt ? Date.now() - _normalQueuePausedAt : 0,
        current_item: _currentItem ? _eventSummary(_currentItem.event || {}) : null,
        muted: _isMuted(),
        last_speech: _lastSpeechState,
      };
    },

    /**
     * Directly announce text + optional toast.  Bypasses the debounce path.
     * Safe to call from test code or ad-hoc operator notices.
     */
    announce(text, toastOpts) {
      _pushAndDrain(
        text || 'Notice',
        toastOpts || { title: 'Notice', message: String(text || ''), severity: 'info' }
      );
    },

    /**
     * Record that a model-change announcement was just made.
     * Updates the replay-staleness marker in localStorage.
     */
    recordAnnounced() { _recordAnnounced(); },

  });

})();

window.BlueprintsModelChangeAnnouncer = BlueprintsModelChangeAnnouncer;
