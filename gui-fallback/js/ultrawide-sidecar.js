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
    title: 'ultrawide-sidecar-title',
    body: 'ultrawide-sidecar-body',
    menuZone: 'menu-zone'
  };

  var _menuResizeObserver = null;

  function _el(id) {
    return document.getElementById(id);
  }

  function _hasSidecarDom() {
    return !!(_el(IDS.sidecar) && _el(IDS.body));
  }

  function _isNode(v) {
    return !!(v && typeof v === 'object' && typeof v.nodeType === 'number');
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

  if (_hasSidecarDom()) {
    _initMenuZoneTracking();
  } else {
    window.addEventListener('DOMContentLoaded', function () {
      if (_hasSidecarDom()) _initMenuZoneTracking();
    }, { once: true });
  }
})();
