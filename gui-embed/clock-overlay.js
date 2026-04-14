/**
 * clock-overlay.js — Full-screen retro flip clock overlay.
 *
 * Opens an iframe showing embed/clock.html. The transparent dismiss layer
 * (above the iframe) captures any tap and closes the overlay.
 *
 * Grace period: dismiss events within OPEN_GRACE_MS of opening are ignored.
 * Without this, the tap that opens the clock also immediately closes it —
 * the browser synthesises a click at the tap position which lands on the
 * dismiss layer after the overlay appears.
 *
 * Future notification modals: append to #clock-overlay__notifications (z-index 2).
 * Set pointer-events: auto on the element; call window.closeClockOverlay() to dismiss.
 *
 * Exposed globals:
 *   window.openClockOverlay(clockSrc)  — show the clock (clockSrc optional override)
 *   window.closeClockOverlay()         — hide the clock
 */
(function () {
  'use strict';

  // Cache-bust token generated once at module init.
  // Ensures the browser re-fetches clock.html after each page reload, preventing
  // stale cached versions (e.g. from font trials) from persisting in the HTTP cache.
  var _CLOCK_BUST = '?_cb=' + Date.now();

  // Ignore dismiss events this many ms after open — prevents the opening tap
  // from immediately dismissing the overlay.
  var OPEN_GRACE_MS = 450;

  var _overlay      = null;
  var _frame        = null;
  var _dismiss      = null;
  var _frameLoaded  = false;
  var _openedAt     = 0;  // timestamp of last open call

  function _ensureRefs() {
    if (!_overlay) _overlay = document.getElementById('clock-overlay');
    if (!_frame)   _frame   = document.getElementById('clock-overlay__frame');
    if (!_dismiss) _dismiss = document.getElementById('clock-overlay__dismiss');
  }

  function _close() {
    if (Date.now() - _openedAt < OPEN_GRACE_MS) return; // grace period guard
    _ensureRefs();
    if (!_overlay) return;
    _overlay.classList.remove('is-active');
    document.documentElement.style.overflow = '';
    document.documentElement.style.touchAction = '';
  }

  function openClockOverlay(clockSrc) {
    _ensureRefs();
    if (!_overlay) return;

    // Lazy-load the iframe on first open; subsequent opens reuse the live frame.
    if (!_frameLoaded && _frame) {
      _frame.src = clockSrc || ('embed/clock.html' + _CLOCK_BUST);
      _frameLoaded = true;
    }

    _openedAt = Date.now();
    _overlay.classList.add('is-active');
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.touchAction = 'none';
  }

  // Wire dismiss layer once DOM is ready.
  document.addEventListener('DOMContentLoaded', function () {
    _ensureRefs();
    if (!_dismiss) return;
    _wireDismiss();
  });

  function _wireDismiss() {
    _dismiss.addEventListener('click', _close);

    // touchend with preventDefault to avoid the 300ms tap-delay on mobile.
    _dismiss.addEventListener('touchend', function (e) {
      e.preventDefault();
      _close();
    }, { passive: false });

    // Keyboard dismiss for accessibility.
    _dismiss.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        _close();
      }
    });
  }

  window.openClockOverlay  = openClockOverlay;
  window.closeClockOverlay = _close;
}());
