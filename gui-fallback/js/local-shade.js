// Local resizable shade handles for page-internal split panes.

'use strict';

const BlueprintsLocalShade = (() => {
  const STORAGE_PREFIX = 'blueprints.localShade.v1';
  const HANDLE_SELECTOR = '[data-local-shade-handle]';
  const DEFAULT_MIN = 240;
  const DEFAULT_MAIN_MIN = 280;
  const DEFAULT_MAX_RATIO = 0.58;
  const STEP = 16;
  const boundHandles = new WeakSet();
  let refreshTimer = null;
  let patchedSwitchTab = false;

  function viewportSignature() {
    const width = Math.round(window.innerWidth || document.documentElement.clientWidth || window.visualViewport?.width || 0);
    const height = Math.round(window.innerHeight || document.documentElement.clientHeight || window.visualViewport?.height || 0);
    const deviceClass = width >= 821 ? 'desktop' : (width <= 600 ? 'phone' : 'tablet');
    const orientation = height >= width ? 'portrait' : 'landscape';
    return `${deviceClass}.${orientation}.${width}x${height}`;
  }

  function storageKey(handle) {
    const key = String(handle.dataset.localShadeKey || 'split').replace(/[^a-zA-Z0-9_.:-]+/g, '-');
    return `${STORAGE_PREFIX}.${key}.${viewportSignature()}`;
  }

  function numberAttr(handle, name, fallback) {
    const raw = Number(handle.dataset[name] || '');
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  }

  function mediaMatches(handle) {
    const query = String(handle.dataset.localShadeMedia || '').trim();
    if (!query || !window.matchMedia) return true;
    return window.matchMedia(query).matches;
  }

  function contextFor(handle) {
    const scopeSelector = String(handle.dataset.localShadeScope || '').trim();
    const panelSelector = String(handle.dataset.localShadePanel || '').trim();
    const varName = String(handle.dataset.localShadeVar || '').trim();
    if (!scopeSelector || !panelSelector || !varName) return null;
    const scope = document.querySelector(scopeSelector);
    const panel = document.querySelector(panelSelector);
    if (!scope || !panel) return null;
    return { scope, panel, varName };
  }

  function boundsFor(handle, ctx) {
    const min = numberAttr(handle, 'localShadeMin', DEFAULT_MIN);
    const mainMin = numberAttr(handle, 'localShadeMainMin', DEFAULT_MAIN_MIN);
    const maxRatio = numberAttr(handle, 'localShadeMaxRatio', DEFAULT_MAX_RATIO);
    const scopeHeight = ctx.scope.getBoundingClientRect().height || window.innerHeight || 0;
    if (scopeHeight <= 0) return { min, max: Math.max(min, min) };
    const maxByMain = scopeHeight - mainMin;
    const maxByRatio = scopeHeight * maxRatio;
    const max = Math.max(min, Math.min(maxByMain, maxByRatio));
    return { min, max };
  }

  function clampHeight(handle, ctx, value) {
    const { min, max } = boundsFor(handle, ctx);
    const next = Math.round(Number(value) || 0);
    return Math.min(max, Math.max(min, next || min));
  }

  function currentHeight(handle, ctx) {
    const fromVar = parseFloat(getComputedStyle(ctx.scope).getPropertyValue(ctx.varName));
    if (Number.isFinite(fromVar) && fromVar > 0) return clampHeight(handle, ctx, fromVar);
    const panelHeight = ctx.panel.getBoundingClientRect().height;
    if (Number.isFinite(panelHeight) && panelHeight > 0) return clampHeight(handle, ctx, panelHeight);
    return clampHeight(handle, ctx, numberAttr(handle, 'localShadeDefault', 320));
  }

  function updateAria(handle, height) {
    const ctx = contextFor(handle);
    if (!ctx) return;
    const { min, max } = boundsFor(handle, ctx);
    handle.setAttribute('aria-valuemin', String(Math.round(min)));
    handle.setAttribute('aria-valuemax', String(Math.round(max)));
    handle.setAttribute('aria-valuenow', String(Math.round(height)));
    handle.setAttribute('aria-valuetext', `${Math.round(height)} pixels`);
  }

  function setHeight(handle, value, persist = true) {
    if (!mediaMatches(handle)) return;
    const ctx = contextFor(handle);
    if (!ctx) return;
    const height = clampHeight(handle, ctx, value);
    ctx.scope.style.setProperty(ctx.varName, `${height}px`);
    updateAria(handle, height);
    if (persist) {
      try {
        localStorage.setItem(storageKey(handle), String(height));
      } catch (_) {
        // Local layout memory is optional.
      }
    }
  }

  function restoreHandle(handle) {
    const ctx = contextFor(handle);
    if (!ctx) return;
    if (!mediaMatches(handle)) {
      ctx.scope.style.removeProperty(ctx.varName);
      return;
    }
    try {
      const stored = Number(localStorage.getItem(storageKey(handle)) || '');
      if (Number.isFinite(stored) && stored > 0) {
        setHeight(handle, stored, false);
      } else {
        ctx.scope.style.removeProperty(ctx.varName);
        updateAria(handle, currentHeight(handle, ctx));
      }
    } catch (_) {
      ctx.scope.style.removeProperty(ctx.varName);
      updateAria(handle, currentHeight(handle, ctx));
    }
  }

  function bindHandle(handle) {
    if (!handle || boundHandles.has(handle)) return;
    boundHandles.add(handle);
    handle.setAttribute('role', handle.getAttribute('role') || 'separator');
    handle.setAttribute('aria-orientation', handle.getAttribute('aria-orientation') || 'horizontal');
    if (!handle.hasAttribute('tabindex')) handle.setAttribute('tabindex', '0');

    handle.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (!mediaMatches(handle)) return;
      const ctx = contextFor(handle);
      if (!ctx) return;
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = currentHeight(handle, ctx);
      handle.classList.add('is-grabbing');
      handle.setPointerCapture?.(event.pointerId);

      const onMove = moveEvent => {
        moveEvent.preventDefault();
        setHeight(handle, startHeight + (startY - moveEvent.clientY), false);
      };
      const onEnd = () => {
        handle.classList.remove('is-grabbing');
        const finalCtx = contextFor(handle);
        if (finalCtx) setHeight(handle, currentHeight(handle, finalCtx), true);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    });

    handle.addEventListener('keydown', event => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      if (!mediaMatches(handle)) return;
      const ctx = contextFor(handle);
      if (!ctx) return;
      event.preventDefault();
      const current = currentHeight(handle, ctx);
      const { min, max } = boundsFor(handle, ctx);
      if (event.key === 'ArrowUp') setHeight(handle, current + STEP);
      if (event.key === 'ArrowDown') setHeight(handle, current - STEP);
      if (event.key === 'Home') setHeight(handle, min);
      if (event.key === 'End') setHeight(handle, max);
    });
  }

  function refreshAll() {
    document.querySelectorAll(HANDLE_SELECTOR).forEach(handle => {
      bindHandle(handle);
      restoreHandle(handle);
    });
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refreshAll, 80);
    [220, 520].forEach(delay => window.setTimeout(refreshAll, delay));
  }

  function patchSwitchTab() {
    if (patchedSwitchTab || typeof window.switchTab !== 'function') return;
    patchedSwitchTab = true;
    const original = window.switchTab;
    window.switchTab = function localShadeSwitchTabPatch() {
      const result = original.apply(this, arguments);
      scheduleRefresh();
      return result;
    };
  }

  function init() {
    refreshAll();
    patchSwitchTab();
    window.addEventListener('resize', scheduleRefresh, { passive: true });
    window.addEventListener('orientationchange', scheduleRefresh, { passive: true });
    document.addEventListener('bodyshadechange', scheduleRefresh);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', scheduleRefresh, { passive: true });
    }
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();

  return {
    refresh: scheduleRefresh,
    storageKey,
    viewportSignature,
  };
})();

window.BlueprintsLocalShade = BlueprintsLocalShade;
