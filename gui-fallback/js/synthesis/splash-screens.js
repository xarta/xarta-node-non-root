// splash-screens.js — Synthesis splash screen registry and default selection.
// xarta-node Blueprints GUI

'use strict';

const BlueprintsSplashScreens = (() => {
  const DEFAULT_KEY = 'blueprintsDefaultSplashScreen';
  const LEGACY_ID = 'splash-dont-panic';
  const FALLBACK_ID = 'splash-dont-panic-2';

  const SCREENS = {
    'splash-dont-panic-1': {
      label: "Don't Panic 1",
      mountId: 'dont-panic-renderer-1',
      rendererOptions: { logoMode: 'braille-system' },
    },
    'splash-dont-panic-2': {
      label: "Don't Panic 2",
      mountId: 'dont-panic-renderer-2',
      rendererOptions: { logoMode: 'svg-dot-runs' },
    },
    'splash-dont-panic-3': {
      label: "Don't Panic 3",
      mountId: 'dont-panic-renderer-3',
      rendererOptions: { logoMode: 'braille-pretext' },
    },
  };

  let _rendererPromise = null;

  function normalizeId(id) {
    if (id === LEGACY_ID) return FALLBACK_ID;
    return SCREENS[id] ? id : FALLBACK_ID;
  }

  function getDefault() {
    const current = normalizeId(localStorage.getItem(DEFAULT_KEY) || FALLBACK_ID);
    if (current !== localStorage.getItem(DEFAULT_KEY)) {
      localStorage.setItem(DEFAULT_KEY, current);
    }
    return current;
  }

  function labelFor(id) {
    return SCREENS[normalizeId(id)]?.label || 'Splash Screen';
  }

  function updateDefaultBadges() {
    const activeDefault = getDefault();
    document.querySelectorAll('[data-splash-default-for]').forEach((el) => {
      const isDefault = normalizeId(el.getAttribute('data-splash-default-for')) === activeDefault;
      el.hidden = !isDefault;
    });
  }

  function setDefault(id) {
    const nextId = normalizeId(id || FALLBACK_ID);
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
    return panel ? normalizeId(panel.id.replace(/^tab-/, '')) : getDefault();
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

  function activeSplashPanel() {
    return document.querySelector('.tab-panel--splash.active[id^="tab-splash-"]');
  }

  function activeMount() {
    const id = activeSplashId();
    const screen = SCREENS[id];
    return screen ? document.getElementById(screen.mountId) : null;
  }

  function raiseShadeForSplash() {
    if (!activeSplashPanel()) return;
    const bodyShade = window.BodyShade;
    if (!bodyShade || typeof bodyShade.snapUp !== 'function') return;
    if (typeof bodyShade.syncActiveHandle === 'function') {
      bodyShade.syncActiveHandle({ reset: false });
    }
    bodyShade.snapUp({ instant: true });
    const mount = activeMount();
    if (mount && mount.__xartaDontPanicSplash && typeof mount.__xartaDontPanicSplash.refresh === 'function') {
      mount.__xartaDontPanicSplash.refresh();
    }
  }

  function scheduleSplashShadeUp() {
    window.requestAnimationFrame(raiseShadeForSplash);
    window.setTimeout(raiseShadeForSplash, 120);
  }

  function initDontPanic(id) {
    const screenId = normalizeId(id || activeSplashId());
    const screen = SCREENS[screenId];
    updateDefaultBadges();
    scheduleSplashShadeUp();
    if (!screen) return;

    const mount = document.getElementById(screen.mountId);
    if (!mount || mount.dataset.splashMounted === 'true') return;
    mount.dataset.splashMounted = 'true';
    loadRenderer()
      .then((mod) => {
        const renderer = mod.mountDontPanicSplash || mod.m || window.XartaSplashRenderer?.mountDontPanicSplash;
        if (typeof renderer === 'function') {
          renderer(mount, screen.rendererOptions || {});
          scheduleSplashShadeUp();
        }
      })
      .catch((err) => {
        console.error('Failed to load splash renderer', err);
        mount.dataset.splashMounted = 'false';
      });
  }

  function init() {
    updateDefaultBadges();
    initDontPanic(activeSplashId());
  }

  return {
    getDefault,
    setDefault,
    setActiveAsDefault,
    init,
    initDontPanic,
  };
})();
