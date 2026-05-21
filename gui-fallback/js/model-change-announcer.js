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

  // ── Module state ──────────────────────────────────────────────────────────

  let _astate        = ASTATE.IDLE;
  let _debounceTimer = null;
  let _cooldownTimer = null;
  const _stash       = [];  // model.changed events pending debounce merge
  const _queue       = [];  // [{ text, toastOpts }] ready-to-speak items

  // Dedup: prevent speaking the same event_id twice (replay overlap guard).
  const _seenIds     = new Set();

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
    // Stash has priority: if any model.changed events accumulated since the last
    // announcement, flush them into a merged queue item.
    if (_stash.length > 0) {
      _dispatchDebounced();
      return;
    }

    if (_queue.length === 0) {
      _transition(ASTATE.IDLE, 'queue empty');
      return;
    }

    const item = _queue.shift();
    if (!_transition(ASTATE.ANNOUNCING, 'drain')) {
      _queue.unshift(item);  // guard: transition blocked (unexpected state)
      return;
    }

    _showToast(item.toastOpts);
    _speak(item.text, item).finally(() => _afterAnnouncing(item));
  }

  /** Called after TTS completes (or fails).  Transitions through COOLING_DOWN
   *  then schedules the next drain. */
  function _afterAnnouncing(item) {
    if (item && item.isModelChange) _recordAnnounced();
    if (_transition(ASTATE.COOLING_DOWN, 'TTS done')) {
      _cooldownTimer = setTimeout(() => {
        _cooldownTimer = null;
        _drainQueue();
      }, _COOLDOWN_MS);
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
      isModelChange: true,  // flag: record timestamp after speaking
    });

    // Drain will now handle the transition and speaking.
    _drainQueue();
  }

  // ── TTS ────────────────────────────────────────────────────────────────────

  function _isMuted() {
    return localStorage.getItem('events.tts.muted') === 'true';
  }

  function _emitSpeechSuppressed(reason, item = {}) {
    try {
      document.dispatchEvent(new CustomEvent('blueprints:notification-speech-suppressed', {
        detail: {
          reason,
          event: item.event || {},
          title: item.toastOpts?.title || '',
        },
        bubbles: false,
      }));
    } catch (_) {}
  }

  async function _speak(text, item = {}) {
    const evt = item.event || {};
    const testBroadcast = evt?.payload?.frontend_contract === 'notification-tests-modal'
      && evt?.payload?.test_broadcast_speech === true;
    if (_isMuted()) {
      _emitSpeechSuppressed('browser_tts_muted', item);
      return;
    }
    if (!_isFreshNotifierSpeech(evt)) {
      _emitSpeechSuppressed('stale_notifier_replay', item);
      return;
    }
    if (typeof BlueprintsNotifierDnd !== 'undefined') {
      await BlueprintsNotifierDnd.loadConfig();
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
    if (typeof BlueprintsTtsClient === 'undefined') {
      _emitSpeechSuppressed('tts_client_unavailable', item);
      return;
    }
    if (typeof BlueprintsTtsClient.speak !== 'function') {
      _emitSpeechSuppressed('tts_speak_unavailable', item);
      return;
    }
    try {
      await BlueprintsTtsClient.speak({
        text,
        interrupt: false,
        fallbackKind: 'neutral',
        eventKind: 'notification',
        volume: item.volume,
      });
    } catch (e) {
      console.warn('[model-change-announcer] TTS error (non-fatal):', e);
      _emitSpeechSuppressed('tts_error', item);
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

  function _showToast({ title, message, severity }) {
    const container = _container();
    while (container.children.length >= _TOAST_MAX) {
      container.removeChild(container.firstChild);
    }

    const toast   = document.createElement('div');
    toast.className = `bp-event-toast bp-event-toast--${severity || 'info'}`;
    toast.setAttribute('role', 'status');

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
          evt
        );
        break;

      case 'alias.tests.failed':
        _pushAndDrain(
          _speechForAliasTests(true),
          { title: 'Alias Tests Failed', message: evt.message || '', severity: 'error' },
          evt
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
          evt
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
          evt
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
          evt
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
          evt
        );
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
              unknownEvt
            );
            break;
          }
        }
        _showToast({
          title:    evt.title    || evt.event_type,
          message:  evt.message  || '',
          severity: evt.severity || 'info',
        });
        break;
    }
  }

  /** Push an item directly to the announcement queue (no debounce) and drain
   *  if the machine is currently idle. */
  function _pushAndDrain(text, toastOpts, event = null) {
    _queue.push({ text, toastOpts, event: event || {} });
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
