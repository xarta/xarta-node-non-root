/**
 * clock-overlay.js — Full-screen retro flip clock overlay.
 *
 * Opens an iframe overlay showing embed/clock.html.
 * The transparent dismiss layer (above the iframe) captures any tap and closes the overlay.
 *
 * Future notification modals can be appended to #clock-overlay__notifications (z-index: 2).
 * They should manage their own pointer-events and call window.closeClockOverlay() if needed.
 *
 * Exposed globals:
 *   window.openClockOverlay()  — show the clock
 *   window.closeClockOverlay() — hide the clock
 */
(function () {
  'use strict';

  let _overlay       = null;
  let _frame         = null;
  let _dismiss       = null;
  let _frameLoaded   = false;

  function _ensureRefs() {
    if (!_overlay) _overlay = document.getElementById('clock-overlay');
    if (!_frame)   _frame   = document.getElementById('clock-overlay__frame');
    if (!_dismiss) _dismiss = document.getElementById('clock-overlay__dismiss');
  }

  function _close() {
    _ensureRefs();
    if (!_overlay) return;
    _overlay.classList.remove('is-active');
    document.documentElement.style.overflow = '';
    document.documentElement.style.touchAction = '';
  }

  function openClockOverlay() {
    _ensureRefs();
    if (!_overlay) return;

    // Lazy-load the iframe on first open; subsequent opens reuse the live frame.
    if (!_frameLoaded && _frame) {
      _frame.src = 'embed/clock.html';
      _frameLoaded = true;
    }

    _overlay.classList.add('is-active');
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.touchAction = 'none';
  }

  // Wire dismiss layer once DOM is ready.
  document.addEventListener('DOMContentLoaded', function () {
    _ensureRefs();
    if (!_dismiss) return;

    _dismiss.addEventListener('click', _close);

    // touchend with preventDefault to avoid the 300ms delay on mobile.
    _dismiss.addEventListener('touchend', function (e) {
      e.preventDefault();
      _close();
    }, { passive: false });

    // Keyboard dismiss (Enter / Space / Escape) for accessibility.
    _dismiss.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        _close();
      }
    });
  });

  window.openClockOverlay  = openClockOverlay;
  window.closeClockOverlay = _close;
}());
