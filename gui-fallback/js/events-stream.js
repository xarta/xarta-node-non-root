// events-stream.js — Blueprints SSE push-notification client with explicit
// finite state machine lifecycle management.
//
// Responsibilities:
//   - Open an EventSource connection to /api/v1/events/stream
//   - Pass TOTP token via query param (EventSource cannot set headers)
//   - Manage reconnect with exponential back-off
//   - Deduplicate events by event_id to prevent double-dispatch after reconnect
//   - Dispatch parsed events to registered listeners and as DOM CustomEvents
//   - Gate all event delivery through the CONNECTED state
//
// Usage:
//   BlueprintsEventStream.on('model.changed', handler);
//   BlueprintsEventStream.on('*', anyHandler);
//   BlueprintsEventStream.start();
//   // later: BlueprintsEventStream.stop();
//
// Each native CustomEvent ('blueprints:event') carries the parsed event
// object in `event.detail` for components that cannot import this module.

'use strict';

const BlueprintsEventStream = (() => {

  // ── State machine definition ───────────────────────────────────────────────
  // States and their valid successor states.  Any transition not in this map
  // is illegal and logged as a warning (state is unchanged).

  const STATE = Object.freeze({
    DISCONNECTED: 'DISCONNECTED',
    CONNECTING:   'CONNECTING',
    CONNECTED:    'CONNECTED',
    BACKING_OFF:  'BACKING_OFF',
  });

  const _VALID_TRANSITIONS = {
    [STATE.DISCONNECTED]: new Set([STATE.CONNECTING]),
    [STATE.CONNECTING]:   new Set([STATE.CONNECTED, STATE.BACKING_OFF, STATE.DISCONNECTED]),
    [STATE.CONNECTED]:    new Set([STATE.BACKING_OFF, STATE.DISCONNECTED]),
    [STATE.BACKING_OFF]:  new Set([STATE.CONNECTING, STATE.DISCONNECTED]),
  };

  // ── Backoff parameters ─────────────────────────────────────────────────────
  // Initial: 2 s.  Doubles each failed attempt.  Caps at 60 s.
  // If a connection is held for longer than STABLE_MS before failing, the
  // backoff counter is reset (treat it as a new, separate outage).

  const _BACKOFF_INITIAL_MS  = 2_000;
  const _BACKOFF_MAX_MS      = 60_000;
  const _STABLE_MS           = 10_000;

  // ── Dedup window ──────────────────────────────────────────────────────────
  // We keep a rolling Set of the last N event_ids recognised.  After replay
  // on reconnect, the server may resend some events we already dispatched
  // (it replays events from last-seen timestamp inclusive).  The Set prevents
  // handlers from firing twice for the same event.

  const _DEDUP_MAX = 500;

  // ── Module state ──────────────────────────────────────────────────────────

  let _state        = STATE.DISCONNECTED;
  let _es           = null;           // current EventSource instance
  let _backoffMs    = _BACKOFF_INITIAL_MS;
  let _backoffTimer = null;
  let _connectTs    = 0;              // Date.now() when last CONNECTED
  let _lastEventId  = null;           // most recently received event_id
  const _seenIds    = new Set();      // dedup: event_ids dispatched this session
  const _listeners  = new Map();      // eventType → Set<fn>
  const _ANY        = '*';

  // ── Listener helpers ───────────────────────────────────────────────────────

  function _emit(eventType, parsed) {
    const specific = _listeners.get(eventType);
    if (specific) {
      specific.forEach(fn => {
        try { fn(parsed); } catch (e) {
          console.error('[events-stream] listener error for', eventType, e);
        }
      });
    }
    const wildcard = _listeners.get(_ANY);
    if (wildcard) {
      wildcard.forEach(fn => {
        try { fn(parsed); } catch (e) {
          console.error('[events-stream] wildcard listener error', e);
        }
      });
    }
  }

  // ── State machine core ─────────────────────────────────────────────────────

  function _can(to) {
    const valid = _VALID_TRANSITIONS[_state];
    return valid ? valid.has(to) : false;
  }

  function _transition(to, reason) {
    if (!_can(to)) {
      console.warn(`[events-stream] illegal transition ${_state} → ${to}` +
                   (reason ? ` (${reason})` : '') +
                   ' — ignored');
      return false;
    }
    const from = _state;
    _state = to;
    if (typeof console.debug === 'function') {
      console.debug(`[events-stream] ${from} → ${to}` + (reason ? `: ${reason}` : ''));
    }
    return true;
  }

  // ── EventSource lifecycle ──────────────────────────────────────────────────

  async function _buildUrl() {
    const secret = (typeof localStorage !== 'undefined')
      ? (localStorage.getItem('blueprints_api_secret') || '')
      : '';
    let token = '';
    if (secret && typeof _computeApiToken === 'function') {
      // _computeApiToken is defined at global scope in api.js (loaded first).
      token = await _computeApiToken(secret);
    }
    const params = new URLSearchParams();
    if (token)       params.set('token', token);
    if (_lastEventId) params.set('lastEventId', _lastEventId);
    const qs = params.toString();
    return `/api/v1/events/stream${qs ? '?' + qs : ''}`;
  }

  async function _open() {
    // Guard: only open from DISCONNECTED or BACKING_OFF states.
    if (_state !== STATE.DISCONNECTED && _state !== STATE.BACKING_OFF) return;
    if (!_transition(STATE.CONNECTING, 'open attempt')) return;

    let url;
    try {
      url = await _buildUrl();
    } catch (e) {
      console.error('[events-stream] failed to build stream URL', e);
      _transition(STATE.BACKING_OFF, 'URL build error');
      _scheduleReconnect();
      return;
    }

    _es = new EventSource(url);
    _es.onopen    = _onOpen;
    _es.onerror   = _onError;
    _es.onmessage = _onMessage;
  }

  function _onOpen() {
    if (_state !== STATE.CONNECTING) return;
    _connectTs = Date.now();
    _transition(STATE.CONNECTED, 'EventSource open');
    _backoffMs = _BACKOFF_INITIAL_MS;  // successful connect → reset backoff
  }

  function _onError() {
    // Guard: if we were already stopped, ignore stale error callbacks.
    if (_state === STATE.DISCONNECTED) return;

    const wasConnected  = (_state === STATE.CONNECTED);
    const heldMs        = wasConnected ? (Date.now() - _connectTs) : 0;

    // Connection lasted long enough to be considered stable → reset backoff
    // so a brief outage after a long session doesn't start from a long delay.
    if (wasConnected && heldMs > _STABLE_MS) {
      _backoffMs = _BACKOFF_INITIAL_MS;
    }

    _destroyEs();

    if (_transition(STATE.BACKING_OFF, `error from ${wasConnected ? 'CONNECTED' : 'CONNECTING'}`)) {
      _scheduleReconnect();
    }
  }

  function _onMessage(evt) {
    // Only dispatch when properly connected.  Discard anything that arrives
    // in other states (e.g. a delayed message during teardown).
    if (_state !== STATE.CONNECTED) return;

    // Track Last-Event-ID for reconnect (browser also does this, but we
    // want to append it to the URL ourselves each time we reconnect).
    if (evt.lastEventId) _lastEventId = evt.lastEventId;

    let parsed;
    try {
      parsed = JSON.parse(evt.data);
    } catch {
      return;  // non-JSON keepalive or malformed frame — ignore silently
    }

    // Update last event id from the data payload if the header was absent.
    if (parsed && parsed.event_id) _lastEventId = parsed.event_id;

    // Dedup: skip events we already dispatched (e.g. catch-up replay overlap).
    if (parsed.event_id) {
      if (_seenIds.has(parsed.event_id)) return;
      _seenIds.add(parsed.event_id);
      // Trim the dedup set when it grows too large to avoid unbounded memory.
      if (_seenIds.size > _DEDUP_MAX) {
        const oldest = _seenIds.values().next().value;
        _seenIds.delete(oldest);
      }
    }

    const type = parsed.event_type || 'unknown';

    // Dispatch to registered module-level listeners.
    _emit(type, parsed);

    // Also bubble as a DOM CustomEvent so UI components (modals, toast, etc.)
    // can react without importing this module directly.
    document.dispatchEvent(new CustomEvent('blueprints:event', {
      detail: parsed,
      bubbles: false,
    }));
  }

  function _destroyEs() {
    if (!_es) return;
    _es.onopen    = null;
    _es.onerror   = null;
    _es.onmessage = null;
    try { _es.close(); } catch (_) {}
    _es = null;
  }

  function _scheduleReconnect() {
    const delay = _backoffMs;
    _backoffTimer = setTimeout(async () => {
      _backoffTimer = null;
      if (_state === STATE.BACKING_OFF) {
        _backoffMs = Math.min(_backoffMs * 2, _BACKOFF_MAX_MS);
        await _open();
      }
    }, delay);
  }

  function _cancelBackoff() {
    if (_backoffTimer !== null) {
      clearTimeout(_backoffTimer);
      _backoffTimer = null;
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Start the event stream.  No-op if already running.
   */
  function start() {
    if (_state !== STATE.DISCONNECTED) return;
    _open();
  }

  /**
   * Stop the event stream and clean up.  Safe to call multiple times.
   */
  function stop() {
    _cancelBackoff();
    _destroyEs();
    if (_state !== STATE.DISCONNECTED) {
      _state = STATE.DISCONNECTED;
    }
  }

  /** Return the current FSM state string. */
  function getState() { return _state; }

  /**
   * Register a listener for a specific event_type (or '*' for all).
   * The handler receives the parsed event object.
   */
  function on(type, fn) {
    if (typeof fn !== 'function') return;
    if (!_listeners.has(type)) _listeners.set(type, new Set());
    _listeners.get(type).add(fn);
  }

  /**
   * Remove a previously registered listener.
   */
  function off(type, fn) {
    _listeners.get(type)?.delete(fn);
  }

  return Object.freeze({ STATE, start, stop, getState, on, off });

})();

// Auto-start when the page is ready and the user has a stored API secret.
// The stream is useful only when the browser has auth credentials.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('blueprints_api_secret')) {
      BlueprintsEventStream.start();
    }
  });
} else {
  if (localStorage.getItem('blueprints_api_secret')) {
    BlueprintsEventStream.start();
  }
}
