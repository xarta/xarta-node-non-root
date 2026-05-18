// splash-screens.js — Synthesis splash screen registry and default selection.
// xarta-node Blueprints GUI

'use strict';

const BlueprintsSplashScreens = (() => {
  const DEFAULT_KEY = 'blueprintsDefaultSplashScreen';
  const DEFAULT_ID = 'splash-dont-panic-3';
  const RENDERER_IMPORT_VERSION = '20260516-braille-mono-2';
  const DEBUG_KEY = 'blueprintsDontPanic3DebugTelemetry';

  const SCREENS = {
    'splash-dont-panic-3': {
      label: "Don't Panic",
      mountId: 'dont-panic-renderer-3',
      rendererOptions: { logoMode: 'braille-pretext' },
    },
  };

  let _rendererPromise = null;
  let _dismissPointer = null;
  let _lastTap = { time: 0, x: 0, y: 0 };

  function normalizeId(id) {
    return SCREENS[id] ? id : DEFAULT_ID;
  }

  function getDefault() {
    const current = normalizeId(localStorage.getItem(DEFAULT_KEY) || DEFAULT_ID);
    if (current !== localStorage.getItem(DEFAULT_KEY)) {
      localStorage.setItem(DEFAULT_KEY, current);
    }
    return current;
  }

  function labelFor(id) {
    return SCREENS[normalizeId(id)]?.label || 'Splash Screen';
  }

  function isDebugTelemetryEnabled() {
    return localStorage.getItem(DEBUG_KEY) === '1';
  }

  function debugTelemetryLabel() {
    return isDebugTelemetryEnabled() ? 'Debug Off' : 'Debug On';
  }

  function rendererOptionsFor(screenId) {
    const screen = SCREENS[normalizeId(screenId)];
    const options = { ...(screen?.rendererOptions || {}) };
    if (normalizeId(screenId) === 'splash-dont-panic-3') {
      options.telemetryDebug = isDebugTelemetryEnabled();
      options.telemetryContext = {
        source: 'blueprints-synthesis',
        activeTab: normalizeId(screenId),
        defaultTab: getDefault(),
      };
    }
    return options;
  }

  function updateDefaultBadges() {
    const activeDefault = getDefault();
    document.querySelectorAll('[data-splash-default-for]').forEach((el) => {
      const isDefault = normalizeId(el.getAttribute('data-splash-default-for')) === activeDefault;
      el.hidden = !isDefault;
    });
  }

  function setDefault(id) {
    const nextId = normalizeId(id || DEFAULT_ID);
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

  function toggleDebugTelemetry() {
    const enabled = !isDebugTelemetryEnabled();
    localStorage.setItem(DEBUG_KEY, enabled ? '1' : '0');
    const mount = document.getElementById(SCREENS['splash-dont-panic-3'].mountId);
    const api = mount?.__xartaDontPanicSplash;
    if (api && typeof api.setDebug === 'function') {
      api.setDebug(enabled);
    }
    if (typeof HubDialogs !== 'undefined') {
      HubDialogs.alert({
        title: "Don't Panic Debug",
        message: `Telemetry debug is now ${enabled ? 'on' : 'off'}.`,
        tone: enabled ? 'success' : 'info',
        badge: 'Splash',
      });
    }
    return enabled;
  }

  function loadRenderer() {
    if (!_rendererPromise) {
      _rendererPromise = import(`/splash-renderer/embed.js?v=${RENDERER_IMPORT_VERSION}`)
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
          renderer(mount, rendererOptionsFor(screenId));
          scheduleSplashShadeUp();
        }
      })
      .catch((err) => {
        console.error('Failed to load splash renderer', err);
        mount.dataset.splashMounted = 'false';
      });
  }

  function dismissToManualDefault() {
    if (typeof BlueprintsManualLinks !== 'undefined' && typeof BlueprintsManualLinks.openDefault === 'function') {
      BlueprintsManualLinks.openDefault();
    } else if (typeof switchTab === 'function') {
      switchTab('manual-links-rendered');
    }
  }

  function isSplashEvent(event) {
    if (!(event.target && event.target.closest)) return false;
    if (event.target.closest('.body-shade-handle')) return false;
    return !!event.target.closest('.tab-panel--splash.active .splash-screen');
  }

  function installDismissGestures() {
    document.addEventListener('dblclick', (event) => {
      if (!isSplashEvent(event)) return;
      event.preventDefault();
      dismissToManualDefault();
    });
    document.addEventListener('pointerdown', (event) => {
      if (!isSplashEvent(event)) return;
      _dismissPointer = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        time: Date.now(),
      };
    }, { passive: true });
    document.addEventListener('pointerup', (event) => {
      if (!_dismissPointer || _dismissPointer.pointerId !== event.pointerId) return;
      const dx = event.clientX - _dismissPointer.x;
      const dy = event.clientY - _dismissPointer.y;
      const dist = Math.hypot(dx, dy);
      const now = Date.now();
      const elapsed = now - _dismissPointer.time;
      const isSwipe = dist > 64 && elapsed < 900;
      const isTap = dist < 18 && elapsed < 350;
      const isDoubleTap = isTap
        && now - _lastTap.time < 420
        && Math.hypot(event.clientX - _lastTap.x, event.clientY - _lastTap.y) < 32;
      _dismissPointer = null;
      if (isSwipe || isDoubleTap) {
        event.preventDefault();
        _lastTap = { time: 0, x: 0, y: 0 };
        dismissToManualDefault();
      } else if (isTap) {
        _lastTap = { time: now, x: event.clientX, y: event.clientY };
      }
    });
    document.addEventListener('pointercancel', () => {
      _dismissPointer = null;
    }, { passive: true });
  }

  function init() {
    updateDefaultBadges();
    installDismissGestures();
    initDontPanic(activeSplashId());
  }

  return {
    getDefault,
    isDebugTelemetryEnabled,
    debugTelemetryLabel,
    setDefault,
    setActiveAsDefault,
    toggleDebugTelemetry,
    init,
    initDontPanic,
  };
})();
