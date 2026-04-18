// model-change-announcer.js — Responds to Blueprints push-notification events
// for AI model changes and alias test outcomes.
//
// Receives events via the 'blueprints:event' DOM CustomEvent dispatched by
// events-stream.js.  For each handled event type it:
//   1. Enqueues a toast notification
//   2. Optionally speaks the announcement through BlueprintsTtsClient
//
// Announcement FSM
// ─────────────────
// An explicit state machine serialises TTS output.  Multiple events arriving
// close together (e.g. primary + embeddings + reranker all changing in a
// single mode switch) are queued and spoken one at a time rather than talking
// over each other or being dropped.
//
//   IDLE         — nothing pending; ready to announce immediately
//   ANNOUNCING   — TTS in progress; new events are queued
//   COOLING_DOWN — brief pause after each announcement
//
// Mute control
// ─────────────
// localStorage key 'events.tts.muted' = 'true' silences TTS for this browser.
// Toasts still appear when muted.  The global TTS wrapper handles the
// system-level TTS-enabled check internally.

'use strict';

const BlueprintsModelChangeAnnouncer = (() => {

  // ── Announcer FSM ──────────────────────────────────────────────────────────

  const ASTATE = Object.freeze({
    IDLE:         'IDLE',
    ANNOUNCING:   'ANNOUNCING',
    COOLING_DOWN: 'COOLING_DOWN',
  });

  const _VALID_TRANSITIONS = {
    [ASTATE.IDLE]:         new Set([ASTATE.ANNOUNCING]),
    [ASTATE.ANNOUNCING]:   new Set([ASTATE.COOLING_DOWN, ASTATE.IDLE]),
    [ASTATE.COOLING_DOWN]: new Set([ASTATE.ANNOUNCING, ASTATE.IDLE]),
  };

  const _COOLDOWN_MS    = 800;   // ms pause between consecutive announcements
  const _TOAST_DURATION = 7000;  // ms before auto-dismiss
  const _TOAST_MAX      = 4;     // max toasts visible simultaneously

  let _astate        = ASTATE.IDLE;
  let _cooldownTimer = null;
  const _queue       = [];       // [{ text, toastOpts }]

  // ── FSM core ───────────────────────────────────────────────────────────────

  function _transition(to) {
    if (!(_VALID_TRANSITIONS[_astate] || new Set()).has(to)) return false;
    _astate = to;
    return true;
  }

  // ── Queue processing ───────────────────────────────────────────────────────

  function _drainQueue() {
    if (_queue.length === 0) {
      _transition(ASTATE.IDLE);
      return;
    }
    const item = _queue.shift();
    if (!_transition(ASTATE.ANNOUNCING)) {
      // Guard: if transition failed (shouldn't happen), put item back.
      _queue.unshift(item);
      return;
    }

    _showToast(item.toastOpts);

    _speak(item.text).finally(() => {
      if (_cooldownTimer) clearTimeout(_cooldownTimer);
      if (_transition(ASTATE.COOLING_DOWN)) {
        _cooldownTimer = setTimeout(() => {
          _cooldownTimer = null;
          _drainQueue();
        }, _COOLDOWN_MS);
      } else {
        // Defensive fallback: reset to IDLE if cooling-down transition failed.
        _astate = ASTATE.IDLE;
      }
    });
  }

  function _enqueue(text, toastOpts) {
    _queue.push({ text, toastOpts });
    if (_astate === ASTATE.IDLE) {
      _drainQueue();
    }
  }

  // ── TTS ────────────────────────────────────────────────────────────────────

  function _isMuted() {
    return localStorage.getItem('events.tts.muted') === 'true';
  }

  async function _speak(text) {
    if (_isMuted()) return;
    if (typeof BlueprintsTtsClient === 'undefined') return;
    if (typeof BlueprintsTtsClient.speak !== 'function') return;
    try {
      await BlueprintsTtsClient.speak(text, { interrupt: false, event_kind: 'notification' });
    } catch (e) {
      console.warn('[model-change-announcer] TTS error (non-fatal)', e);
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

    const toast    = document.createElement('div');
    toast.className = `bp-event-toast bp-event-toast--${severity || 'info'}`;
    toast.setAttribute('role', 'status');

    const iconEl   = document.createElement('span');
    iconEl.className = 'bp-event-toast__icon';
    iconEl.setAttribute('aria-hidden', 'true');

    const bodyEl   = document.createElement('div');
    bodyEl.className = 'bp-event-toast__body';

    const titleEl  = document.createElement('strong');
    titleEl.className = 'bp-event-toast__title';
    titleEl.textContent = title || '';

    const msgEl    = document.createElement('span');
    msgEl.className = 'bp-event-toast__msg';
    msgEl.textContent = message || '';

    const closeEl  = document.createElement('button');
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

  // ── Speech text builders ───────────────────────────────────────────────────

  function _shortenModel(name) {
    // "hosted_vllm/Qwen3-14B:latest" → "Qwen3-14B"
    return String(name || '').replace(/^[a-z_-]+\//i, '').split(':')[0];
  }

  function _speechForModelChanged(evt) {
    const sel        = (evt.payload || {}).selected || {};
    const primary    = sel.primary    && sel.primary.model_name;
    const embeddings = sel.embeddings && sel.embeddings.model_name;
    const reranker   = sel.reranker   && sel.reranker.model_name;

    const parts = [];
    if (primary)    parts.push(`primary local model is now ${_shortenModel(primary)}`);
    if (embeddings) parts.push(`embeddings model is now ${_shortenModel(embeddings)}`);
    if (reranker)   parts.push(`reranker model is now ${_shortenModel(reranker)}`);

    if (parts.length === 0) return 'Information. Local model aliases have been updated.';
    return `Information. Local model change. ${parts.join('. ')}.`;
  }

  function _speechForAliasTests(failed) {
    return failed
      ? 'Warning. Local alias tests failed after sync. Check the blueprints log.'
      : 'Information. Local alias tests completed successfully.';
  }

  // ── Event routing ──────────────────────────────────────────────────────────

  function _handle(evt) {
    if (!evt || !evt.event_type) return;

    switch (evt.event_type) {

      case 'model.changed':
        _enqueue(
          _speechForModelChanged(evt),
          { title: 'Local Model Changed', message: evt.message || '', severity: 'info' }
        );
        break;

      case 'alias.tests.completed':
        _enqueue(
          _speechForAliasTests(false),
          { title: 'Alias Tests Passed', message: evt.message || '', severity: 'info' }
        );
        break;

      case 'alias.tests.failed':
        _enqueue(
          _speechForAliasTests(true),
          { title: 'Alias Tests Failed', message: evt.message || '', severity: 'error' }
        );
        break;

      default:
        // Unknown event type: generic informational toast, no TTS.
        _showToast({
          title:    evt.title    || evt.event_type,
          message:  evt.message  || '',
          severity: evt.severity || 'info',
        });
        break;
    }
  }

  // ── Wire DOM listener ──────────────────────────────────────────────────────
  // events-stream.js dispatches 'blueprints:event' on document for every
  // received event.  Listening here keeps the module self-contained — no
  // external wiring needed.

  document.addEventListener('blueprints:event', function(domEvt) {
    if (domEvt.detail) _handle(domEvt.detail);
  });

  // ── Public API ─────────────────────────────────────────────────────────────

  return Object.freeze({

    /** Suppress TTS announcements for this browser.  Toasts still appear. */
    setMuted(muted) {
      localStorage.setItem('events.tts.muted', muted ? 'true' : 'false');
    },

    /** @returns {boolean} */
    isMuted() { return _isMuted(); },

    /** @returns {string} Current announcer FSM state. */
    getState() { return _astate; },

    /**
     * Directly enqueue a toast + optional TTS for testing or ad-hoc notices.
     * @param {string} text
     * @param {{ title?, message?, severity? }} [toastOpts]
     */
    announce(text, toastOpts) {
      _enqueue(
        text,
        toastOpts || { title: 'Notice', message: text, severity: 'info' }
      );
    },

  });

})();
