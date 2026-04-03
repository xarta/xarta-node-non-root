/* ================================================================
   ultrawide-sidecar.js — small utility API for the right-side panel

   Exposes window.UltrawideSidecar with flexible content methods:
     - isVisible()
     - setTitle(text)
     - clear()
     - setText(text)
     - setHTML(html)
     - appendText(text)
     - appendHTML(html)
     - appendNode(node)

   Also tracks #menu-zone height and writes --menu-zone-h to :root so
   CSS can position the sidecar below the menu in shade-down mode.
   ================================================================ */
(function () {
  'use strict';

  var ROOT = document.documentElement;
  var IDS = {
    sidecar: 'ultrawide-sidecar',
    splitter: 'ultrawide-splitter',
    title: 'ultrawide-sidecar-title',
    body: 'ultrawide-sidecar-body',
    menuZone: 'menu-zone'
  };

  var _menuResizeObserver = null;
  var _mediaQuery = null;
  var _drag = null;

  var SPLIT_STORE_KEY = 'blueprintsUltrawideSplitV1';
  var SPLIT_BUCKET = 'ultrawide-short';
  var DEFAULT_MAIN_WIDTH = 1920;
  var MIN_MAIN_WIDTH = 1280;
  var MIN_SIDECAR_WIDTH = 320;
  var DEFAULT_GAP = 10;
  var DEFAULT_MAIN_PAD = 16;

  function _el(id) {
    return document.getElementById(id);
  }

  function _hasSidecarDom() {
    return !!(_el(IDS.sidecar) && _el(IDS.body));
  }

  function _isNode(v) {
    return !!(v && typeof v === 'object' && typeof v.nodeType === 'number');
  }

  function _numFromCssVar(varName, fallback) {
    var raw = window.getComputedStyle(ROOT).getPropertyValue(varName) || '';
    var n = parseFloat(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  function _isUltrawideShortActive() {
    if (!_mediaQuery || typeof _mediaQuery.matches !== 'boolean') return false;
    return _mediaQuery.matches;
  }

  function _readStoredMainWidth() {
    try {
      var raw = localStorage.getItem(SPLIT_STORE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      var bucket = parsed[SPLIT_BUCKET];
      return Number.isFinite(bucket) ? bucket : null;
    } catch (_err) {
      return null;
    }
  }

  function _writeStoredMainWidth(mainWidth) {
    try {
      var existing = {};
      var raw = localStorage.getItem(SPLIT_STORE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') existing = parsed;
      }
      existing[SPLIT_BUCKET] = mainWidth;
      localStorage.setItem(SPLIT_STORE_KEY, JSON.stringify(existing));
    } catch (_err) {
      // localStorage may be unavailable in hardened browser settings.
    }
  }

  function _splitLimits() {
    var vw = Math.max(0, Math.floor(window.innerWidth || 0));
    var gap = _numFromCssVar('--ultrawide-gap', DEFAULT_GAP);
    var pad = _numFromCssVar('--ultrawide-main-pad-x', DEFAULT_MAIN_PAD);
    var maxFromSidecar = vw + pad - (2 * gap) - MIN_SIDECAR_WIDTH;
    return {
      min: MIN_MAIN_WIDTH,
      max: Math.max(MIN_MAIN_WIDTH, Math.floor(maxFromSidecar)),
      pad: pad
    };
  }

  function _clampMainWidth(px) {
    var lim = _splitLimits();
    var n = Math.round(px);
    if (!Number.isFinite(n)) n = DEFAULT_MAIN_WIDTH;
    if (n < lim.min) n = lim.min;
    if (n > lim.max) n = lim.max;
    return n;
  }

  function _applyMainWidth(px, persist) {
    var mainWidth = _clampMainWidth(px);
    var pad = _splitLimits().pad;
    ROOT.style.setProperty('--ultrawide-main-width', mainWidth + 'px');
    ROOT.style.setProperty('--ultrawide-divider-left', (mainWidth - pad) + 'px');
    if (persist) _writeStoredMainWidth(mainWidth);
  }

  function _applyInitialSplitWidth() {
    var stored = _readStoredMainWidth();
    _applyMainWidth(stored == null ? DEFAULT_MAIN_WIDTH : stored, false);
  }

  function _setMenuZoneHeightVar() {
    var menu = _el(IDS.menuZone);
    if (!menu) return;
    var h = Math.max(0, Math.ceil(menu.getBoundingClientRect().height));
    ROOT.style.setProperty('--menu-zone-h', h + 'px');
  }

  function _initMenuZoneTracking() {
    _setMenuZoneHeightVar();

    if (window.ResizeObserver) {
      var menu = _el(IDS.menuZone);
      if (menu) {
        _menuResizeObserver = new ResizeObserver(_setMenuZoneHeightVar);
        _menuResizeObserver.observe(menu);
      }
    }

    window.addEventListener('resize', _setMenuZoneHeightVar);
    window.addEventListener('orientationchange', _setMenuZoneHeightVar);
    setTimeout(_setMenuZoneHeightVar, 180);
    setTimeout(_setMenuZoneHeightVar, 500);
  }

  function _endSplitterDrag(shouldPersist) {
    if (!_drag) return;
    var splitter = _el(IDS.splitter);
    if (splitter && _drag.pointerId != null && splitter.releasePointerCapture) {
      try {
        splitter.releasePointerCapture(_drag.pointerId);
      } catch (_err) {
        // ignore
      }
    }
    document.body.classList.remove('is-dragging-ultrawide-splitter');
    if (_drag.onMove) window.removeEventListener('pointermove', _drag.onMove);
    if (_drag.onUp) {
      window.removeEventListener('pointerup', _drag.onUp);
      window.removeEventListener('pointercancel', _drag.onUp);
    }
    if (shouldPersist && _drag.mainWidth != null) {
      _applyMainWidth(_drag.mainWidth, true);
    }
    _drag = null;
  }

  function _initSplitterDrag() {
    var splitter = _el(IDS.splitter);
    if (!splitter) return;

    splitter.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (!_isUltrawideShortActive()) return;
      e.preventDefault();

      var lim = _splitLimits();
      var next = _clampMainWidth(e.clientX + lim.pad);
      _applyMainWidth(next, false);

      _drag = {
        pointerId: e.pointerId,
        mainWidth: next,
        onMove: null,
        onUp: null
      };

      if (splitter.setPointerCapture) {
        try {
          splitter.setPointerCapture(e.pointerId);
        } catch (_err) {
          // ignore
        }
      }

      document.body.classList.add('is-dragging-ultrawide-splitter');

      _drag.onMove = function (moveEvt) {
        if (!_drag) return;
        var limits = _splitLimits();
        var mainWidth = _clampMainWidth(moveEvt.clientX + limits.pad);
        _drag.mainWidth = mainWidth;
        _applyMainWidth(mainWidth, false);
      };

      _drag.onUp = function () {
        _endSplitterDrag(true);
      };

      window.addEventListener('pointermove', _drag.onMove);
      window.addEventListener('pointerup', _drag.onUp);
      window.addEventListener('pointercancel', _drag.onUp);
    });
  }

  function _initSplitPersistence() {
    _mediaQuery = window.matchMedia('(min-width: 2400px) and (max-height: 1280px)');

    _applyInitialSplitWidth();

    var handleMq = function () {
      _endSplitterDrag(false);
      _applyInitialSplitWidth();
    };

    if (typeof _mediaQuery.addEventListener === 'function') {
      _mediaQuery.addEventListener('change', handleMq);
    } else if (typeof _mediaQuery.addListener === 'function') {
      _mediaQuery.addListener(handleMq);
    }

    window.addEventListener('resize', function () {
      if (!_isUltrawideShortActive()) return;
      _applyInitialSplitWidth();
    });

    _initSplitterDrag();
  }

  var UltrawideSidecar = {
    isVisible: function () {
      var sidecar = _el(IDS.sidecar);
      if (!sidecar) return false;
      return window.getComputedStyle(sidecar).display !== 'none';
    },

    setTitle: function (text) {
      var title = _el(IDS.title);
      if (!title) return false;
      title.textContent = String(text == null ? '' : text);
      return true;
    },

    clear: function () {
      var body = _el(IDS.body);
      if (!body) return false;
      body.textContent = '';
      return true;
    },

    setText: function (text) {
      var body = _el(IDS.body);
      if (!body) return false;
      body.textContent = String(text == null ? '' : text);
      return true;
    },

    setHTML: function (html) {
      var body = _el(IDS.body);
      if (!body) return false;
      body.innerHTML = String(html == null ? '' : html);
      return true;
    },

    appendText: function (text) {
      var body = _el(IDS.body);
      if (!body) return false;
      body.appendChild(document.createTextNode(String(text == null ? '' : text)));
      return true;
    },

    appendHTML: function (html) {
      var body = _el(IDS.body);
      if (!body) return false;
      body.insertAdjacentHTML('beforeend', String(html == null ? '' : html));
      return true;
    },

    appendNode: function (node) {
      var body = _el(IDS.body);
      if (!body || !_isNode(node)) return false;
      body.appendChild(node);
      return true;
    }
  };

  window.UltrawideSidecar = UltrawideSidecar;

  _initSplitPersistence();

  if (_hasSidecarDom()) {
    _initMenuZoneTracking();
  } else {
    window.addEventListener('DOMContentLoaded', function () {
      if (_hasSidecarDom()) _initMenuZoneTracking();
    }, { once: true });
  }
})();
