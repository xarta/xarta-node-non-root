// splash-screens.js — Synthesis splash screen registry and default selection.
// xarta-node Blueprints GUI

'use strict';

const BlueprintsSplashScreens = (() => {
  const DEFAULT_KEY = 'blueprintsDefaultSplashScreen';
  const FALLBACK_ID = 'splash-dont-panic';
  let _rendererPromise = null;

  function getDefault() {
    return localStorage.getItem(DEFAULT_KEY) || FALLBACK_ID;
  }

  function labelFor(id) {
    if (id === 'splash-dont-panic') return "Don't Panic";
    return 'Splash Screen';
  }

  function updateDefaultBadges() {
    const activeDefault = getDefault();
    document.querySelectorAll('[data-splash-default-for]').forEach((el) => {
      const isDefault = el.getAttribute('data-splash-default-for') === activeDefault;
      el.hidden = !isDefault;
    });
  }

  function setDefault(id) {
    const nextId = id || FALLBACK_ID;
    localStorage.setItem(DEFAULT_KEY, nextId);
    updateDefaultBadges();
    if (typeof HubDialogs !== 'undefined') {
      HubDialogs.alert({
        title: 'Default Splash Screen',
        message: `${labelFor(nextId)} is now the first screen for Synthesis.`,
        tone: 'success',
        badge: 'Splash',
      });
    }
    return nextId;
  }

  function activeSplashId() {
    const panel = document.querySelector('.tab-panel.active[id^="tab-splash-"]');
    return panel ? panel.id.replace(/^tab-/, '') : getDefault();
  }

  function setActiveAsDefault() {
    return setDefault(activeSplashId());
  }

  function loadRenderer() {
    if (!_rendererPromise) {
      _rendererPromise = import('/splash-renderer/embed.js')
        .catch((err) => {
          _rendererPromise = null;
          throw err;
        });
    }
    return _rendererPromise;
  }

  function splashPanelIsActive() {
    const panel = document.getElementById('tab-splash-dont-panic');
    return !!(panel && panel.classList.contains('active'));
  }

  function raiseShadeForSplash() {
    if (!splashPanelIsActive()) return;
    const bodyShade = window.BodyShade;
    if (!bodyShade || typeof bodyShade.snapUp !== 'function') return;
    if (typeof bodyShade.syncActiveHandle === 'function') {
      bodyShade.syncActiveHandle({ reset: false });
    }
    bodyShade.snapUp({ instant: true });
    const mount = document.getElementById('dont-panic-renderer');
    if (mount && mount.__xartaDontPanicSplash && typeof mount.__xartaDontPanicSplash.refresh === 'function') {
      mount.__xartaDontPanicSplash.refresh();
    }
  }

  function scheduleSplashShadeUp() {
    window.requestAnimationFrame(raiseShadeForSplash);
    window.setTimeout(raiseShadeForSplash, 120);
  }

  function initDontPanic() {
    updateDefaultBadges();
    const mount = document.getElementById('dont-panic-renderer');
    scheduleSplashShadeUp();
    if (!mount || mount.dataset.splashMounted === 'true') return;
    mount.dataset.splashMounted = 'true';
    loadRenderer()
      .then((mod) => {
        const renderer = mod.mountDontPanicSplash || mod.m || window.XartaSplashRenderer?.mountDontPanicSplash;
        if (typeof renderer === 'function') {
          renderer(mount);
          scheduleSplashShadeUp();
        }
      })
      .catch((err) => {
        console.error('Failed to load splash renderer', err);
        mount.dataset.splashMounted = 'false';
      });
  }

  function init() {
    initDontPanic();
  }

  return {
    getDefault,
    setDefault,
    setActiveAsDefault,
    init,
    initDontPanic,
  };
})();
