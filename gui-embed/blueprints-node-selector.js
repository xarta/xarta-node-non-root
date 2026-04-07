/**
 * blueprints-node-selector.js — dynamic node discovery + configurable nav buttons.
 *
 * Configuration (set window globals BEFORE this script loads):
 *
 *   window.BLUEPRINTS_API_BASE
 *   window.BLUEPRINTS_SEED_NODES
 *   window.BLUEPRINTS_SELECTOR_BUTTONS = {
 *     enabledButtons: ['ui', 'synthesis', 'probes', 'settings', 'api-key', 'cache-mode', 'database-tables', 'database-diagram', 'paging-button'],
 *     side: 'left' | 'right',
 *     pageSize: 4,
 *     nodeSwitchPath: '/ui/' | 'current'
 *   }
 */
(function () {
  'use strict';

  const SCRIPT_SRC = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src)
    ? document.currentScript.src
    : '';
  const SCRIPT_DIR = SCRIPT_SRC.includes('/')
    ? SCRIPT_SRC.slice(0, SCRIPT_SRC.lastIndexOf('/') + 1)
    : '';

  const API_BASE = (
    (typeof window !== 'undefined' && window.BLUEPRINTS_API_BASE) || ''
  ).replace(/\/$/, '');

  const SEEDS = (typeof window !== 'undefined' && window.BLUEPRINTS_SEED_NODES) || [];

  if (typeof window !== 'undefined' && typeof window.openBlueprintsEmbedApiKeyModal !== 'function') {
    const LS_SECRET = 'blueprints_api_secret';
    const MODAL_ID = 'bp-embed-api-key-modal';
    const STYLE_ID = 'bp-embed-api-key-modal-style';

    function ensureApiKeyModal() {
      if (typeof document === 'undefined') return null;

      if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
          #${MODAL_ID} {
            width: min(480px, calc(100vw - 20px));
            max-width: calc(100vw - 20px);
            max-height: calc(100dvh - 20px);
            inset: 0;
            margin: auto;
            padding: 0;
            border: 1px solid rgba(0, 212, 255, 0.24);
            border-radius: 10px;
            color: #e2e6f3;
            background: rgba(10, 12, 20, 0.85);
            box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
          }
          @supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) {
            #${MODAL_ID} {
              background: rgba(10, 12, 20, 0.72);
              backdrop-filter: blur(18px) saturate(160%);
              -webkit-backdrop-filter: blur(18px) saturate(160%);
            }
          }
          #${MODAL_ID}::backdrop {
            background: rgba(0, 0, 0, 0.55);
            backdrop-filter: blur(4px);
            -webkit-backdrop-filter: blur(4px);
          }
          #${MODAL_ID} .bp-auth-modal-header,
          #${MODAL_ID} .bp-auth-modal-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 16px 18px;
            border-bottom: 1px solid rgba(0, 212, 255, 0.12);
          }
          #${MODAL_ID} .bp-auth-modal-footer {
            justify-content: flex-end;
            border-bottom: 0;
            border-top: 1px solid rgba(0, 212, 255, 0.12);
          }
          #${MODAL_ID} .bp-auth-modal-title {
            margin: 0;
            font: 600 16px/1.3 'Segoe UI', system-ui, sans-serif;
            color: #e2e6f3;
          }
          #${MODAL_ID} .bp-auth-modal-body {
            padding: 18px;
          }
          #${MODAL_ID} .bp-auth-copy {
            margin: 0 0 14px;
            color: #7b82a0;
            font: 400 13px/1.7 'Segoe UI', system-ui, sans-serif;
          }
          #${MODAL_ID} .bp-auth-field {
            display: grid;
            gap: 6px;
          }
          #${MODAL_ID} .bp-auth-field-label {
            color: #e2e6f3;
            font: 600 12px/1.4 'Segoe UI', system-ui, sans-serif;
            text-transform: uppercase;
            letter-spacing: 0.06em;
          }
          #${MODAL_ID} .bp-auth-input {
            width: 100%;
            box-sizing: border-box;
            padding: 10px 12px;
            border: 1px solid rgba(0, 212, 255, 0.24);
            border-radius: 8px;
            background: rgba(0, 0, 0, 0.28);
            color: #e2e6f3;
            font: 400 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          }
          #${MODAL_ID} .bp-auth-input:focus {
            outline: none;
            border-color: rgba(0, 212, 255, 0.6);
            box-shadow: 0 0 0 3px rgba(0, 212, 255, 0.14);
          }
          #${MODAL_ID} .bp-auth-error {
            min-height: 1.4em;
            margin: 10px 0 0;
            color: #e05c5c;
            font: 400 12px/1.5 'Segoe UI', system-ui, sans-serif;
          }
          #${MODAL_ID} .bp-auth-btn {
            height: 38px;
            padding: 0 14px;
            border: 1px solid rgba(0, 212, 255, 0.3);
            border-radius: 8px;
            background: rgba(0, 0, 0, 0.28);
            color: #e2e6f3;
            font: 500 13px/1 'Segoe UI', system-ui, sans-serif;
            cursor: pointer;
          }
          #${MODAL_ID} .bp-auth-btn:hover {
            background: rgba(0, 212, 255, 0.08);
            border-color: rgba(0, 212, 255, 0.5);
          }
          #${MODAL_ID} .bp-auth-btn.bp-auth-btn-primary {
            color: #00d4ff;
            border-color: rgba(0, 212, 255, 0.55);
            background: rgba(0, 212, 255, 0.12);
          }
          #${MODAL_ID} .bp-auth-btn.bp-auth-btn-primary:hover {
            background: rgba(0, 212, 255, 0.18);
          }
          @media (max-width: 600px) {
            #${MODAL_ID} {
              width: calc(100vw - 16px);
              max-width: calc(100vw - 16px);
              max-height: calc(100dvh - 16px);
            }
            #${MODAL_ID} .bp-auth-input {
              font-size: 16px;
            }
          }
        `;
        document.head.appendChild(style);
      }

      let dialog = document.getElementById(MODAL_ID);
      if (dialog) return dialog;

      dialog = document.createElement('dialog');
      dialog.id = MODAL_ID;
      dialog.innerHTML = `
        <div class="bp-auth-modal-header">
          <h2 class="bp-auth-modal-title">API Key</h2>
          <button class="bp-auth-btn" type="button" data-role="close">CLOSE</button>
        </div>
        <div class="bp-auth-modal-body">
          <p class="bp-auth-copy">Paste your BLUEPRINTS_API_SECRET from the Blueprints node .env file. It is stored only in this browser's localStorage and never transmitted directly - only a derived time-based token is sent with requests.</p>
          <label class="bp-auth-field">
            <span class="bp-auth-field-label">BLUEPRINTS_API_SECRET</span>
            <input class="bp-auth-input" id="bp-embed-api-key-input" type="password" placeholder="64-char hex secret" autocomplete="new-password" spellcheck="false" autocorrect="off" autocapitalize="off" />
          </label>
          <p class="bp-auth-error" id="bp-embed-api-key-error"></p>
        </div>
        <div class="bp-auth-modal-footer">
          <button class="bp-auth-btn" type="button" data-role="cancel">Cancel</button>
          <button class="bp-auth-btn bp-auth-btn-primary" type="button" data-role="save">Save</button>
        </div>
      `;
      document.body.appendChild(dialog);

      const input = dialog.querySelector('#bp-embed-api-key-input');
      const error = dialog.querySelector('#bp-embed-api-key-error');
      const close = dialog.querySelector('[data-role="close"]');
      const cancel = dialog.querySelector('[data-role="cancel"]');
      const save = dialog.querySelector('[data-role="save"]');

      function finish(result) {
        if (typeof dialog._bpResolve === 'function') {
          const resolve = dialog._bpResolve;
          dialog._bpResolve = null;
          resolve(result);
        }
      }

      function closeDialog(result) {
        dialog._bpResult = result;
        if (dialog.open) dialog.close();
      }

      close.addEventListener('click', () => closeDialog(null));
      cancel.addEventListener('click', () => closeDialog(null));
      save.addEventListener('click', () => {
        const value = input.value.trim();
        if (value) localStorage.setItem(LS_SECRET, value);
        else localStorage.removeItem(LS_SECRET);
        error.textContent = '';
        closeDialog(value || '');
      });
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        save.click();
      });
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) closeDialog(null);
      });
      dialog.addEventListener('close', () => {
        const result = Object.prototype.hasOwnProperty.call(dialog, '_bpResult') ? dialog._bpResult : null;
        delete dialog._bpResult;
        finish(result);
      });

      return dialog;
    }

    window.openBlueprintsEmbedApiKeyModal = function openBlueprintsEmbedApiKeyModal(opts = {}) {
      const dialog = ensureApiKeyModal();
      if (!dialog) return Promise.resolve(null);
      const input = dialog.querySelector('#bp-embed-api-key-input');
      const error = dialog.querySelector('#bp-embed-api-key-error');
      if (!input || !error) return Promise.resolve(null);

      if (dialog.open) dialog.close();
      error.textContent = opts.authFailed ? 'Authentication failed. Check your API secret.' : '';
      input.value = typeof opts.currentValue === 'string'
        ? opts.currentValue
        : (localStorage.getItem(LS_SECRET) || '');

      return new Promise((resolve) => {
        dialog._bpResolve = resolve;
        dialog.showModal();
        requestAnimationFrame(() => {
          input.focus();
          input.select();
        });
      });
    };
  }

  /* ── Internal authenticated fetch ───────────────────────────────────────
   * Uses window.apiFetch when the host page provides it (e.g. full Blueprints
   * GUI), otherwise derives a TOTP token from localStorage itself so the
   * selector works self-contained on any page — no supporting scripts needed.
   * Same HMAC-SHA256 / 5-second window scheme as api.js. */
  async function _authFetch(url, options = {}) {
    if (typeof window !== 'undefined' && typeof window.apiFetch === 'function') {
      return window.apiFetch(url, options);
    }
    let token = '';
    try {
      const secretHex = (typeof localStorage !== 'undefined' && localStorage.getItem('blueprints_api_secret')) || '';
      if (secretHex) {
        const w  = Math.floor(Date.now() / 5000);
        const kb = Uint8Array.from(secretHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
        const mb = new TextEncoder().encode(String(w));
        const k  = await crypto.subtle.importKey('raw', kb, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const s  = await crypto.subtle.sign('HMAC', k, mb);
        token = Array.from(new Uint8Array(s)).map(b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch {}
    return fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), ...(token ? { 'X-API-Token': token } : {}) },
    });
  }

  const FALLBACK_CACHE_PATH = '/api/v1/ui-cache/fallback';
  const LS_APP_MODE_DIAG_VISIBLE = 'bp_app_mode_diag_visible';
  const LS_ORIGIN_VARIANT = 'bp_origin_variant';
  const ORIGIN_BUTTON_ACTION = 'origin';
  // Retained for future reuse: this is the tuned gold S25 cutout glyph path
  // that pre-dates the Stargate experiment. It is not the current stable
  // default, but it remains a valid visual variant on purpose.
  const ORIGIN_VARIANT_STATIC = 'static';
  // Current stable experiment/default: Stargate ring around the cutout.
  const ORIGIN_VARIANT_STARGATE = 'stargate';
  const DEFAULT_ORIGIN_VARIANT = ORIGIN_VARIANT_STARGATE;
  // Temporary deployment override: force the Stargate variant on-device even
  // if localStorage contains an older explicit choice. Keep this comment in
  // place so future sessions understand why resolveOriginVariant() ignores
  // stored state while the experiment is considered the current stable path.
  const FORCED_ORIGIN_VARIANT = ORIGIN_VARIANT_STARGATE;
  const PLACEHOLDER_BUTTON_ACTION = 'placeholder-circle';
  const ORIGIN_BUTTON_TITLE = 'Origin';
  const ORIGIN_LONG_PRESS_MS = 250;
  const ORIGIN_DOUBLE_CLICK_MS = 260;
  const NOOP = () => {};

  let SELECTOR_CFG = {
    enabledButtons: [],
    pages: null,
    enableDbMenuConfig: false,
    showPagingButton: true,
    showOriginButton: true,
    touchRibbonMode: 'auto',
    touchRibbonMaxShortEdge: 920,
    side: 'right',
    pageSize: 3,
    nodeSwitchPath: '/ui/',
  };

  let _originButtonState = {
    title: ORIGIN_BUTTON_TITLE,
    ariaLabel: ORIGIN_BUTTON_TITLE,
    longPressMs: ORIGIN_LONG_PRESS_MS,
    handlers: {
      click: NOOP,
      doubleClick: NOOP,
      longPress: NOOP,
    },
  };

  let _originPressTimer = null;
  let _originClickTimer = null;
  let _originLastClickAt = 0;
  let _originLongPressTriggered = false;
  let _lastOriginPointerType = null;
  let _originVariant = DEFAULT_ORIGIN_VARIANT;

  let _fallbackCacheState = null;
  let _fallbackCacheBusy = false;
  let _ribbonScrollLeft = 0;
  let _dbSelectorPages = null;
  let _dbItemMeta = {};

  function isAppModeDiagVisible() {
    try {
      return localStorage.getItem(LS_APP_MODE_DIAG_VISIBLE) !== '0';
    } catch {
      return true;
    }
  }

  function setAppModeDiagVisible(visible) {
    try {
      localStorage.setItem(LS_APP_MODE_DIAG_VISIBLE, visible ? '1' : '0');
    } catch {}
    window.dispatchEvent(new CustomEvent('bp:app-mode-diag-visibility', {
      detail: { visible: !!visible }
    }));
  }

  function updateDiagChipButtons() {
    if (typeof document === 'undefined') return;
    const buttons = document.querySelectorAll('.bp-ns-action-btn[data-action="diag-chip"]');
    if (!buttons.length) return;
    const visible = isAppModeDiagVisible();
    const title = visible
      ? 'Hide app diagnostics chip'
      : 'Show app diagnostics chip';

    buttons.forEach(btn => {
      btn.dataset.chipVisible = visible ? 'true' : 'false';
      btn.title = title;
      btn.setAttribute('aria-label', title);
      btn.classList.toggle('is-off', !visible);
    });
  }

  function toggleAppModeDiagVisibility() {
    const next = !isAppModeDiagVisible();
    setAppModeDiagVisible(next);
    updateDiagChipButtons();
  }

  function updateCacheModeButtons() {
    if (typeof document === 'undefined') return;
    const buttons = document.querySelectorAll('.bp-ns-action-btn[data-action="cache-mode"]');
    if (!buttons.length) return;

    const mode = _fallbackCacheState && _fallbackCacheState.current_mode === 'development'
      ? 'development'
      : 'production';
    const detail = mode === 'development'
      ? 'Fallback UI cache: DEV no-store'
      : 'Fallback UI cache: production revalidate';
    const action = mode === 'development'
      ? 'Disable fallback dev cache mode'
      : 'Enable fallback dev cache mode';
    const version = _fallbackCacheState && _fallbackCacheState.asset_version
      ? ` (${_fallbackCacheState.asset_version})`
      : '';
    const title = _fallbackCacheBusy
      ? 'Applying fallback cache mode…'
      : `${detail}${version}. ${action}.`;

    buttons.forEach(btn => {
      btn.dataset.cacheMode = mode;
      btn.dataset.busy = _fallbackCacheBusy ? 'true' : 'false';
      btn.title = title;
      btn.setAttribute('aria-label', title);
      btn.disabled = _fallbackCacheBusy;
      btn.classList.toggle('is-busy', _fallbackCacheBusy);
    });
  }

  async function refreshFallbackCacheStatus() {
    const resp = await _authFetch(FALLBACK_CACHE_PATH, { method: 'GET' });
    if (!resp.ok) {
      if (resp.status === 401) {
        updateCacheModeButtons();
        return null;
      }
      throw new Error(`Fallback cache status failed (HTTP ${resp.status})`);
    }
    _fallbackCacheState = await resp.json();
    updateCacheModeButtons();
    return _fallbackCacheState;
  }

  async function toggleFallbackCacheMode() {
    if (_fallbackCacheBusy) return;

    _fallbackCacheBusy = true;
    updateCacheModeButtons();

    try {
      const current = _fallbackCacheState || await refreshFallbackCacheStatus();
      if (!current) {
        if (typeof window.openBlueprintsEmbedApiKeyModal === 'function') {
          window.openBlueprintsEmbedApiKeyModal({
            authFailed: true,
            currentValue: localStorage.getItem('blueprints_api_secret') || ''
          });
        } else {
          window.alert('Set the Blueprints API secret before toggling fallback cache mode.');
        }
        return;
      }

      const nextMode = current.current_mode === 'development' ? 'production' : 'development';
      const resp = await _authFetch(FALLBACK_CACHE_PATH, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: nextMode }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        throw new Error((data && data.detail) || `Fallback cache update failed (HTTP ${resp.status})`);
      }

      _fallbackCacheState = data;
      updateCacheModeButtons();
      window.dispatchEvent(new CustomEvent('bp:fallback-cache-mode-changed', { detail: data }));
    } catch (error) {
      const message = error && error.message ? error.message : 'Fallback cache update failed.';
      window.alert(message);
    } finally {
      _fallbackCacheBusy = false;
      updateCacheModeButtons();
    }
  }

  async function hardRefreshClientAssets() {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(reg => reg.unregister().catch(() => false)));
      }

      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(key => caches.delete(key).catch(() => false)));
      }

      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('_fresh', String(Date.now()));
      window.location.replace(nextUrl.toString());
    } catch (error) {
      const message = error && error.message ? error.message : 'Client refresh failed.';
      window.alert(message);
    }
  }

  function clearOriginPressTimer() {
    if (_originPressTimer) {
      clearTimeout(_originPressTimer);
      _originPressTimer = null;
    }
  }

  function clearOriginClickTimer() {
    if (_originClickTimer) {
      clearTimeout(_originClickTimer);
      _originClickTimer = null;
    }
  }

  function requestSelectorActionRender() {
    if (typeof document === 'undefined') return;
    requestAnimationFrame(() => renderActionButtons());
  }

  function normalizeOriginVariant(variant) {
    return variant === ORIGIN_VARIANT_STARGATE
      ? ORIGIN_VARIANT_STARGATE
      : ORIGIN_VARIANT_STATIC;
  }

  function applyOriginVariantAttributes(variant) {
    if (typeof document === 'undefined') return normalizeOriginVariant(variant);
    const nextVariant = normalizeOriginVariant(variant);
    const root = document.documentElement;
    if (root) {
      root.setAttribute('data-origin-variant', nextVariant);
    }
    if (document.body) {
      document.body.setAttribute('data-origin-variant', nextVariant);
    }
    return nextVariant;
  }

  function readStoredOriginVariant() {
    try {
      const stored = localStorage.getItem(LS_ORIGIN_VARIANT);
      if (stored === ORIGIN_VARIANT_STATIC || stored === ORIGIN_VARIANT_STARGATE) {
        return stored;
      }
      return DEFAULT_ORIGIN_VARIANT;
    } catch {
      return DEFAULT_ORIGIN_VARIANT;
    }
  }

  function resolveOriginVariant() {
    // Precedence is intentionally unusual right now:
    // forced experiment default > stored choice > normal default.
    // This is to keep the S25 path testable from the phone itself without
    // requiring console access to flip localStorage state.
    if (FORCED_ORIGIN_VARIANT === ORIGIN_VARIANT_STATIC || FORCED_ORIGIN_VARIANT === ORIGIN_VARIANT_STARGATE) {
      return FORCED_ORIGIN_VARIANT;
    }
    return readStoredOriginVariant();
  }

  function setOriginVariant(variant) {
    const nextVariant = normalizeOriginVariant(variant);
    try {
      localStorage.setItem(LS_ORIGIN_VARIANT, nextVariant);
    } catch {}
    _originVariant = applyOriginVariantAttributes(nextVariant);
    return _originVariant;
  }

  function clearOriginVariant() {
    try {
      localStorage.removeItem(LS_ORIGIN_VARIANT);
    } catch {}
    _originVariant = applyOriginVariantAttributes(DEFAULT_ORIGIN_VARIANT);
    return _originVariant;
  }

  function refreshOriginVariant() {
    _originVariant = applyOriginVariantAttributes(resolveOriginVariant());
    return _originVariant;
  }

  function normalizeOriginHandlers(handlers = {}) {
    return {
      click: typeof handlers.click === 'function' ? handlers.click : NOOP,
      doubleClick: typeof handlers.doubleClick === 'function' ? handlers.doubleClick : NOOP,
      longPress: typeof handlers.longPress === 'function' ? handlers.longPress : NOOP,
    };
  }

  function invokeOriginHandler(kind, payload) {
    const handler = _originButtonState.handlers[kind] || NOOP;
    try {
      handler({
        type: kind,
        currentNode: getCurrentNode(),
        button: payload.button || null,
        originalEvent: payload.originalEvent || null,
      });
    } catch (error) {
      console.error('Blueprints origin button handler failed:', error);
    }
  }

  function setOriginButtonHandlers(handlers = {}) {
    _originButtonState.handlers = normalizeOriginHandlers(handlers);
    requestSelectorActionRender();
  }

  function clearOriginButtonHandlers() {
    _originButtonState.handlers = normalizeOriginHandlers();
    requestSelectorActionRender();
  }

  function setOriginButtonOptions(options = {}) {
    if (typeof options.title === 'string' && options.title.trim()) {
      _originButtonState.title = options.title.trim();
    }
    if (typeof options.ariaLabel === 'string' && options.ariaLabel.trim()) {
      _originButtonState.ariaLabel = options.ariaLabel.trim();
    }
    if (Number.isFinite(options.longPressMs) && options.longPressMs >= 0) {
      _originButtonState.longPressMs = options.longPressMs;
    }
    requestSelectorActionRender();
  }

  function resetOriginButton() {
    _originButtonState = {
      title: ORIGIN_BUTTON_TITLE,
      ariaLabel: ORIGIN_BUTTON_TITLE,
      longPressMs: ORIGIN_LONG_PRESS_MS,
      handlers: normalizeOriginHandlers(),
    };
    clearOriginPressTimer();
    clearOriginClickTimer();
    _originLastClickAt = 0;
    _originLongPressTriggered = false;
    _lastOriginPointerType = null;
    requestSelectorActionRender();
  }

  function installOriginButtonApi() {
    if (typeof window === 'undefined') return;
    window.BlueprintsSelectorOriginButton = {
      setHandlers: setOriginButtonHandlers,
      clearHandlers: clearOriginButtonHandlers,
      setOptions: setOriginButtonOptions,
      reset: resetOriginButton,
      refresh: requestSelectorActionRender,
    };
  }

  function installOriginVariantApi() {
    if (typeof window === 'undefined') return;
    window.BlueprintsSelectorOriginVariant = {
      VARIANT_STATIC: ORIGIN_VARIANT_STATIC,
      VARIANT_STARGATE: ORIGIN_VARIANT_STARGATE,
      LS_KEY: LS_ORIGIN_VARIANT,
      get variant() {
        return _originVariant;
      },
      setVariant: setOriginVariant,
      clearVariant: clearOriginVariant,
      refresh: refreshOriginVariant,
    };
  }

  function createOriginActionButton() {
    const btn = document.createElement('button');
    btn.className = 'bp-ns-action-btn';
    btn.dataset.action = ORIGIN_BUTTON_ACTION;
    btn.title = _originButtonState.title;
    btn.setAttribute('aria-label', _originButtonState.ariaLabel || _originButtonState.title);
    btn.textContent = '◎';
    return btn;
  }

  function bindOriginButtonInteractions(btn) {
    // Suppress the native browser context menu (long-press on mobile, right-click on
    // desktop) so it never competes with the Blueprints context-menu handler.
    btn.addEventListener('contextmenu', (event) => {
      event.preventDefault();
    });

    btn.addEventListener('pointerdown', (event) => {
      if (event.button && event.button !== 0) return;
      _lastOriginPointerType = event.pointerType || null;
      clearOriginPressTimer();
      _originLongPressTriggered = false;
      _originPressTimer = setTimeout(() => {
        _originPressTimer = null;
        _originLongPressTriggered = true;
        clearOriginClickTimer();
        _originLastClickAt = 0;
        invokeOriginHandler('longPress', { button: btn, originalEvent: event });
      }, Math.max(0, Number(_originButtonState.longPressMs) || ORIGIN_LONG_PRESS_MS));
    });

    ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => {
      btn.addEventListener(type, clearOriginPressTimer);
    });

    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearOriginPressTimer();

      if (_originLongPressTriggered) {
        _originLongPressTriggered = false;
        clearOriginClickTimer();
        _originLastClickAt = 0;
        return;
      }

      // Touch and pen: fire immediately (no 260 ms delay) to eliminate the race
      // between context-menu close on pointerdown and the delayed click dispatch.
      // Double-tap is detected by timestamp comparison instead of the timer approach.
      if (_lastOriginPointerType === 'touch' || _lastOriginPointerType === 'pen') {
        clearOriginClickTimer();
        const now = Date.now();
        if (_originLastClickAt && (now - _originLastClickAt) <= ORIGIN_DOUBLE_CLICK_MS) {
          _originLastClickAt = 0;
          invokeOriginHandler('doubleClick', { button: btn, originalEvent: event });
        } else {
          _originLastClickAt = now;
          invokeOriginHandler('click', { button: btn, originalEvent: event });
        }
        return;
      }

      const now = Date.now();
      if (_originClickTimer && (now - _originLastClickAt) <= ORIGIN_DOUBLE_CLICK_MS) {
        clearOriginClickTimer();
        _originLastClickAt = 0;
        invokeOriginHandler('doubleClick', { button: btn, originalEvent: event });
        return;
      }

      _originLastClickAt = now;
      clearOriginClickTimer();
      _originClickTimer = setTimeout(() => {
        _originClickTimer = null;
        _originLastClickAt = 0;
        invokeOriginHandler('click', { button: btn, originalEvent: event });
      }, ORIGIN_DOUBLE_CLICK_MS);
    });
  }

  _originVariant = applyOriginVariantAttributes(resolveOriginVariant());
  if (typeof document !== 'undefined' && !document.body) {
    document.addEventListener('DOMContentLoaded', () => {
      applyOriginVariantAttributes(_originVariant);
    }, { once: true });
  }

  installOriginButtonApi();
  installOriginVariantApi();

  const BUTTON_DEFS = {
    'fallback-ui':      { icon: '🧰', label: 'Fallback UI',      buildPath: () => '/fallback-ui/' },
    'ui':               { icon: '🏠', label: 'UI',               buildPath: () => '/' },
    'synthesis':        { icon: '📋', label: 'Synthesis',        buildPath: () => '/fallback-ui/' },
    'probes':           { icon: '📡', label: 'Probes',           buildPath: () => '/fallback-ui/?group=probes' },
    'settings':         { icon: '⚙️',  label: 'Settings',         buildPath: () => '/fallback-ui/?group=settings' },
    'database-tables':  { icon: '🗂️', label: 'Database Tables',  buildPath: () => `${getDbBasePath()}/database-tables.html` },
    'database-diagram': { icon: '🕸️', label: 'Database Diagram', buildPath: () => `${getDbBasePath()}/database-diagram.html` },
    'embed-menu':       { icon: '🪲', label: 'Embed Menu',        buildPath: () => '/fallback-ui/?group=settings&tab=embed-menu' },
    'api-key': {
      icon: '🔑', label: 'API Key',
      doAction() {
        if (typeof window.openApiKeyModal === 'function') {
          window.openApiKeyModal();
        } else if (typeof window.openBlueprintsEmbedApiKeyModal === 'function') {
          window.openBlueprintsEmbedApiKeyModal({
            currentValue: localStorage.getItem('blueprints_api_secret') || ''
          });
        }
      },
    },
    'api-key-test': {
      icon: '🗝️', label: 'Test Embedded API Key Modal',
      doAction() {
        if (typeof window.openBlueprintsEmbedApiKeyModal === 'function') {
          window.openBlueprintsEmbedApiKeyModal({
            authFailed: true,
            currentValue: localStorage.getItem('blueprints_api_secret') || ''
          });
        }
      },
    },
    'cache-mode': {
      icon: '♺', label: 'Toggle Fallback Cache Mode',
      doAction() {
        toggleFallbackCacheMode();
      },
    },
    'hard-refresh': {
      icon: '⟳', label: 'Hard Refresh App Assets',
      doAction() {
        hardRefreshClientAssets();
      },
    },
    'diag-chip': {
      icon: '⟐', label: 'Toggle App Diagnostics Chip',
      doAction() {
        toggleAppModeDiagVisibility();
      },
    },
  };

  const LS_NODES = 'bp_nodes_v2';
  const LS_CURRENT = 'bp_current_v2';
  const LS_BUTTON_PAGE = 'bp_button_page_v1';

  const POLL_INTERVAL = 2_000;
  const REQUEST_TIMEOUT = Math.max(400, POLL_INTERVAL - 250);
  const NO_RESPONSE_WINDOW = 10_000;
  const PRUNE_UNSEEN_MS = 48 * 60 * 60 * 1000;
  const HEART_WINDOW_RATIO = 0.95;
  const HEART_STEPS = 20;
  const LIST_REFRESH = 60_000;
  const LS_TTL = 5 * 60_000;

  let _nodes = [];
  let _current = null;
  let _buttonPage = 0;
  let _polling = false;
  let _lastPollTick = 0;
  let _heartTimer = null;
  let _heartToken = 0;

  function lsGet(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
  function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

  function loadButtonPage() {
    const page = lsGet(LS_BUTTON_PAGE);
    _buttonPage = Number.isInteger(page) && page >= 0 ? page : 0;
  }

  function normalizeOrigin(url) {
    if (!url) return '';
    try {
      return new URL(url, window.location.origin).origin;
    } catch {
      return '';
    }
  }

  function nodeMatchesCurrentOrigin(node) {
    if (!node || typeof window === 'undefined') return false;
    const currentOrigin = window.location.origin;
    const candidates = [node.uiUrl, ...(node.altAddresses || [])]
      .map(normalizeOrigin)
      .filter(Boolean);
    return candidates.includes(currentOrigin);
  }

  function syncCurrentToLocation() {
    const match = _nodes.find(nodeMatchesCurrentOrigin);
    if (!match) return false;
    if (_current !== match.id) {
      _current = match.id;
      lsSet(LS_CURRENT, _current);
    }
    return true;
  }

  function saveButtonPage() {
    lsSet(LS_BUTTON_PAGE, _buttonPage);
  }

  function applySelectorConfigFromWindow() {
    const raw = (typeof window !== 'undefined' && window.BLUEPRINTS_SELECTOR_BUTTONS) || {};
    const configuredPageSize = Number.isInteger(raw.pageSize) && raw.pageSize > 0 ? raw.pageSize : 3;
    const rawRibbonMode = typeof raw.touchRibbonMode === 'string' ? raw.touchRibbonMode.trim().toLowerCase() : 'auto';
    const touchRibbonMode = (rawRibbonMode === 'on' || rawRibbonMode === 'off' || rawRibbonMode === 'auto')
      ? rawRibbonMode
      : 'auto';
    const configuredRibbonMaxShortEdge = Number(raw.touchRibbonMaxShortEdge);
    SELECTOR_CFG = {
      enabledButtons: Array.isArray(raw.enabledButtons) ? raw.enabledButtons : [],
      pages: Array.isArray(raw.pages) ? raw.pages : null,
      enableDbMenuConfig: raw.enableDbMenuConfig === true,
      showPagingButton: raw.showPagingButton !== false,
      showOriginButton: raw.showOriginButton !== false,
      touchRibbonMode,
      touchRibbonMaxShortEdge: Number.isFinite(configuredRibbonMaxShortEdge) && configuredRibbonMaxShortEdge > 0
        ? configuredRibbonMaxShortEdge
        : 920,
      side: raw.side === 'left' ? 'left' : 'right',
      pageSize: configuredPageSize,
      nodeSwitchPath: raw.nodeSwitchPath || '/ui/',
    };
    if (typeof raw.originButtonTitle === 'string' && raw.originButtonTitle.trim()) {
      _originButtonState.title = raw.originButtonTitle.trim();
    }
    if (typeof raw.originButtonAriaLabel === 'string' && raw.originButtonAriaLabel.trim()) {
      _originButtonState.ariaLabel = raw.originButtonAriaLabel.trim();
    }
  }

  function tryLoadScript(url) {
    return new Promise(resolve => {
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }

  function _dbAssetBase() {
    const base = (API_BASE || window.location.origin).replace(/\/$/, '');
    return `${base}/fallback-ui/assets/`;
  }

  function _sanitizeDbPages(payload) {
    if (!payload || !Array.isArray(payload.pages)) return null;
    const meta = {};
    const pages = payload.pages
      .map(page => {
        if (!Array.isArray(page)) return [];
        return page.map(item => {
          const key = typeof item === 'string' ? item : (item && item.key);
          if (!key || !BUTTON_DEFS[key]) return null;
          if (item && typeof item === 'object' && (item.icon_asset || item.label)) {
            meta[key] = { icon_asset: item.icon_asset || null, label: item.label || null };
          }
          return key;
        }).filter(Boolean);
      })
      .filter(page => page.length > 0);
    _dbItemMeta = meta;
    return pages.length ? pages : null;
  }

  async function refreshDbSelectorPages() {
    if (!SELECTOR_CFG.enableDbMenuConfig) {
      _dbSelectorPages = null;
      _dbItemMeta = {};
      return;
    }
    try {
      const resp = await _authFetch('/api/v1/embed-menu-items/config', {
        method: 'GET',
        signal: AbortSignal.timeout(6000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const payload = await resp.json();
      const pages = _sanitizeDbPages(payload);
      if (pages) {
        _dbSelectorPages = pages;
        renderActionButtons();
      }
    } catch {
      // Hard fallback by design: keep local/default selector pages.
    }
  }

  async function ensureRibbonFsm() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (window.BlueprintsRibbonFSM && typeof window.BlueprintsRibbonFSM.create === 'function') return;
    if (!SCRIPT_DIR) return;
    await tryLoadScript(`${SCRIPT_DIR}blueprints-ribbon-fsm.js`);
  }

  async function ensureSelectorConfig() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (window.BLUEPRINTS_SELECTOR_BUTTONS) return;
    if (window.__bpSelectorConfigPromise) {
      await window.__bpSelectorConfigPromise;
      return;
    }

    const customUrl = window.BLUEPRINTS_SELECTOR_CONFIG_URL;
    const candidates = customUrl
      ? [customUrl]
      : [
          `${window.location.origin}/ui/db/database-pages.config.js`,
          `${window.location.origin}/fallback-ui/db/database-pages.config.js`,
          SCRIPT_DIR ? `${SCRIPT_DIR}blueprints-node-selector.config.js` : '',
        ].filter(Boolean);

    window.__bpSelectorConfigPromise = (async () => {
      for (const url of candidates) {
        const ok = await tryLoadScript(url);
        if (ok && window.BLUEPRINTS_SELECTOR_BUTTONS) return;
      }
    })();

    await window.__bpSelectorConfigPromise;
  }

  function shouldPauseForColumnResize() {
    if (typeof document === 'undefined' || !document.body) return false;
    if (document.body.classList.contains('table-col-resizing')) return true;
    if (typeof window !== 'undefined' && typeof window.isColumnResizeActive === 'function') {
      return !!window.isColumnResizeActive();
    }
    return false;
  }

  async function refreshNodeList() {
    if (shouldPauseForColumnResize()) return;
    const origin = API_BASE || window.location.origin;

    let selfNode = null;
    try {
      const r = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const h = await r.json();
        const uiUrl = (h.ui_url || origin).replace(/\/$/, '');
        const currentOrigin = normalizeOrigin(origin);
        const altAddresses = currentOrigin && currentOrigin !== normalizeOrigin(uiUrl)
          ? [currentOrigin]
          : [];
        selfNode = {
          id: h.node_id,
          name: h.node_name || h.node_id,
          uiUrl,
          healthUrl: `${origin}/health`,
          altAddresses,
        };
      }
    } catch {}

    let peers = [];
    try {
      const r = await _authFetch(`${origin}/api/v1/nodes`, { signal: AbortSignal.timeout(5000) });
      if (r.ok) peers = await r.json();
    } catch {}

    const fresh = [];
    if (selfNode) fresh.push(selfNode);

    for (const p of peers) {
      const syncAddr = (p.addresses && p.addresses[0]) ? p.addresses[0].replace(/\/$/, '') : null;
      if (!syncAddr) continue;
      if (fresh.find(n => n.id === p.node_id)) continue;

      let uiUrl = p.ui_url ? p.ui_url.replace(/\/$/, '') : null;
      if (!uiUrl) {
        const isSameScheme = syncAddr.startsWith(window.location.protocol);
        if (isSameScheme) {
          try {
            const hResp = await fetch(`${syncAddr}/health`, { signal: AbortSignal.timeout(4000) });
            if (hResp.ok) {
              const hj = await hResp.json();
              if (hj.ui_url) uiUrl = hj.ui_url.replace(/\/$/, '');
            }
          } catch {}
        }
        if (!uiUrl) uiUrl = syncAddr;
      }

      // Alt address: use tailnet_hostname from DB (populated from .nodes.json).
      // Both URLs are HTTPS via Caddy — no raw ports involved.
      const altAddresses = (p.tailnet_hostname && `https://${p.tailnet_hostname}` !== uiUrl)
        ? [`https://${p.tailnet_hostname}`]
        : [];

      fresh.push({
        id: p.node_id,
        name: p.display_name || p.node_id,
        displayOrder: typeof p.display_order === 'number' ? p.display_order : 999,
        uiUrl,
        healthUrl: `${uiUrl}/health`,
        fleetPeer: p.fleet_peer ?? true,
        altAddresses,
      });
    }

    for (const s of SEEDS) {
      if (!fresh.find(n => n.id === s.id)) {
        const nodeUrl = (s.url || '').replace(/\/$/, '');
        fresh.push({
          id: s.id,
          name: s.name,
          uiUrl: nodeUrl,
          healthUrl: `${nodeUrl}/health`,
        });
      }
    }

    if (!fresh.length) return;

    // Sort by display_order (self is always first regardless of its order value)
    const selfId = selfNode && selfNode.id;
    fresh.sort((a, b) => {
      if (a.id === selfId) return -1;
      if (b.id === selfId) return  1;
      const ao = typeof a.displayOrder === 'number' ? a.displayOrder : 999;
      const bo = typeof b.displayOrder === 'number' ? b.displayOrder : 999;
      return ao !== bo ? ao - bo : (a.name || '').localeCompare(b.name || '');
    });

    const byId = Object.fromEntries(_nodes.map(n => [n.id, n]));
    _nodes = fresh.map(n => Object.assign(
      {
        latencyMs: null,
        lastSeenAt: 0,
        lastPolledAt: 0,
        discoveredAt: Date.now(),
      },
      n,
      byId[n.id]
        ? {
            latencyMs: byId[n.id].latencyMs,
            lastSeenAt: byId[n.id].lastSeenAt,
            lastPolledAt: byId[n.id].lastPolledAt,
            discoveredAt: byId[n.id].discoveredAt || Date.now(),
            localMode: byId[n.id].localMode,
            activeHealthUrl: byId[n.id].activeHealthUrl,
          }
        : {},
    ));

    if (!syncCurrentToLocation() && (!_current || !_nodes.find(n => n.id === _current))) {
      _current = (selfNode && selfNode.id) || (_nodes[0] && _nodes[0].id) || null;
    }

    lsSet(LS_NODES, { ts: Date.now(), nodes: _nodes });
    lsSet(LS_CURRENT, _current);
    renderBtn();
    renderActionButtons();
    renderPanel();
  }

  async function pingNode(node) {
    const start = performance.now();
    try {
      const r = await fetch(node.healthUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
      if (r.ok) {
        node.localMode = false;
        node.activeHealthUrl = null;
        return { ok: true, latencyMs: Math.round(performance.now() - start) };
      }
    } catch {}

    // Primary unreachable — try LAN/fallback addresses
    for (const alt of (node.altAddresses || [])) {
      // Skip http:// alts when the page is HTTPS — browser blocks these as mixed content
      if (window.location.protocol === 'https:' && alt.startsWith('http:')) continue;
      const t = performance.now();
      try {
        const r = await fetch(`${alt}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT),
        });
        if (r.ok) {
          node.localMode = true;
          node.activeHealthUrl = `${alt}/health`;
          return { ok: true, latencyMs: Math.round(performance.now() - t) };
        }
      } catch {}
    }

    node.localMode = false;
    node.activeHealthUrl = null;
    return { ok: false, latencyMs: null };
  }

  function pulseHeart() {
    const heart = document.getElementById('bp-ns-heart');
    if (!heart) return;
    if (_heartTimer) {
      clearInterval(_heartTimer);
      _heartTimer = null;
    }
    _heartToken += 1;
    const token = _heartToken;

    const totalMs = Math.max(100, Math.floor(POLL_INTERVAL * HEART_WINDOW_RATIO));
    const stepMs = Math.max(8, Math.floor((totalMs / 2) / HEART_STEPS));
    const totalFrames = HEART_STEPS * 2;
    let frame = 0;

    setHeartIllumination(0);
    heart.classList.remove('stopped');

    _heartTimer = setInterval(() => {
      if (token !== _heartToken) {
        clearInterval(_heartTimer);
        _heartTimer = null;
        return;
      }

      frame += 1;
      let illumination = 0;
      if (frame <= HEART_STEPS) {
        illumination = frame / HEART_STEPS;
      } else {
        illumination = Math.max(0, (totalFrames - frame) / HEART_STEPS);
      }
      setHeartIllumination(illumination);

      if (frame >= totalFrames) {
        clearInterval(_heartTimer);
        _heartTimer = null;
        setHeartIllumination(0);
      }
    }, stepMs);
  }

  function updateHeartDeadman() {
    const heart = document.getElementById('bp-ns-heart');
    if (!heart) return;
    const stalled = !_lastPollTick || (Date.now() - _lastPollTick) > (POLL_INTERVAL * 2.5);
    if (stalled) {
      if (_heartTimer) {
        clearInterval(_heartTimer);
        _heartTimer = null;
      }
      _heartToken += 1;
      setHeartIllumination(0);
      heart.classList.add('stopped');
    } else {
      heart.classList.remove('stopped');
    }
  }

  function setHeartIllumination(value) {
    const heart = document.getElementById('bp-ns-heart');
    if (!heart) return;
    const normalized = Math.min(1, Math.max(0, Number(value) || 0));
    heart.style.setProperty('--bp-heart-illum', normalized.toFixed(3));
  }

  function pickBestCurrent() {
    if (_current && _nodes.find(n => n.id === _current)) return;
    const best = _nodes
      .filter(n => Number.isFinite(n.latencyMs))
      .sort((a, b) => a.latencyMs - b.latencyMs)[0];
    _current = (best && best.id) || (_nodes[0] && _nodes[0].id) || null;
    lsSet(LS_CURRENT, _current);
  }

  function pruneUnseenNodes() {
    const now = Date.now();
    _nodes = _nodes.filter(node => {
      const base = node.lastSeenAt || node.discoveredAt || now;
      return (now - base) <= PRUNE_UNSEEN_MS;
    });
  }

  async function pollNodes() {
    if (_polling || !_nodes.length) return;
    if (shouldPauseForColumnResize()) {
      _lastPollTick = Date.now();
      return;
    }
    _polling = true;
    _lastPollTick = Date.now();
    pulseHeart();

    await Promise.all(_nodes.map(async node => {
      const result = await pingNode(node);
      const now = Date.now();
      node.lastPolledAt = now;
      if (result.ok) {
        node.latencyMs = result.latencyMs;
        node.lastSeenAt = now;
      } else {
        node.latencyMs = null;
      }
    }));

    pruneUnseenNodes();
    pickBestCurrent();

    updateSelectedDot();

    lsSet(LS_NODES, { ts: Date.now(), nodes: _nodes });
    renderBtn();
    renderActionButtons();
    renderPanel();
    _polling = false;
  }

  function updateSelectedDot() {
    const selected = _nodes.find(n => n.id === _current);
    if (!selected || !Number.isFinite(selected.latencyMs)) {
      setDot('down');
      return;
    }
    if (selected.latencyMs < 30) {
      setDot('ok');
      return;
    }
    if (selected.latencyMs <= 60) {
      setDot('checking');
      return;
    }
    setDot('down');
  }

  function init() {
    loadButtonPage();

    const cached = lsGet(LS_NODES);
    if (cached && cached.nodes && (Date.now() - cached.ts) < LS_TTL) {
      _nodes = cached.nodes;
      _current = lsGet(LS_CURRENT) || (_nodes[0] && _nodes[0].id) || null;
      syncCurrentToLocation();
    } else if (SEEDS.length) {
      _nodes = SEEDS.map(s => {
        const nodeUrl = (s.url || '').replace(/\/$/, '');
        return {
          id: s.id,
          name: s.name,
          uiUrl: nodeUrl,
          healthUrl: `${nodeUrl}/health`,
          available: true,
          lastChecked: 0,
        };
      });
      _current = _nodes[0] && _nodes[0].id;
    }

    renderBtn();
    renderActionButtons();
    renderPanel();
    window.addEventListener('bp:embed-menu-config-changed', () => {
      void refreshDbSelectorPages();
    });
    void refreshFallbackCacheStatus().catch(() => {});
    void refreshDbSelectorPages();

    refreshNodeList().then(() => pollNodes());

    setInterval(pollNodes, POLL_INTERVAL);
    setInterval(updateHeartDeadman, 1_000);
    setInterval(refreshNodeList, LIST_REFRESH);
  }

  class BlueprintsNodeSelector extends HTMLElement {
    connectedCallback() {
      this.innerHTML = `
        <div class="bp-node-selector">
          <div class="bp-ns-actions bp-ns-actions-left" id="bp-ns-actions-left"></div>
          <button class="bp-ns-btn" id="bp-ns-toggle" aria-haspopup="true" aria-expanded="false">
            <span class="bp-ns-dot" id="bp-ns-dot"></span>
            <span class="bp-ns-name" id="bp-ns-name">…</span>
            <span class="bp-ns-caret">▾</span>
          </button>
          <div class="bp-ns-actions bp-ns-actions-right" id="bp-ns-actions-right"></div>
          <div class="bp-ns-panel" id="bp-ns-panel">
            <div class="bp-ns-header">Blueprints nodes <span id="bp-ns-heart" class="bp-ns-heart" aria-hidden="true">❤️</span></div>
            <div id="bp-ns-list"></div>
          </div>
        </div>`;

      this.querySelector('#bp-ns-toggle').addEventListener('click', e => {
        e.stopPropagation();
        togglePanel();
      });
      document.addEventListener('click', closePanel);
      Promise.all([ensureRibbonFsm(), ensureSelectorConfig()]).finally(() => {
        applySelectorConfigFromWindow();
        init();
      });
    }
  }

  function renderBtn() {
    const el = document.getElementById('bp-ns-name');
    if (!el) return;
    const node = _nodes.find(n => n.id === _current);
    el.textContent = node ? node.name : 'No node';
  }

  function setDot(state) {
    const el = document.getElementById('bp-ns-dot');
    if (el) el.className = 'bp-ns-dot' + (state === 'ok' ? '' : ` ${state}`);
  }

  function getCurrentNode() {
    return _nodes.find(n => n.id === _current) || null;
  }

  function getNodeSwitchPath() {
    if (SELECTOR_CFG.nodeSwitchPath === 'current') {
      return `${window.location.pathname}${window.location.search}${window.location.hash}`;
    }
    return SELECTOR_CFG.nodeSwitchPath;
  }

  function toAbsoluteUrl(baseUrl, path) {
    const base = String(baseUrl || '').replace(/\/$/, '');
    const rel = String(path || '/').replace(/^\//, '');
    return `${base}/${rel}`;
  }

  function getPreferredBaseUrl(node) {
    if (nodeMatchesCurrentOrigin(node)) return window.location.origin;
    return (node && node.uiUrl) || window.location.origin;
  }

  function getDbBasePath() {
    const pathname = window.location.pathname || '';
    if (pathname === '/fallback-ui' || pathname.startsWith('/fallback-ui/')) return '/fallback-ui/db';
    return '/ui/db';
  }

  function navigateToNodePath(path) {
    const node = getCurrentNode();
    const baseUrl = getPreferredBaseUrl(node);
    window.location.href = toAbsoluteUrl(baseUrl, path);
  }

  function getCurrentAppActionKey() {
    const pathname = window.location.pathname || '';
    if (pathname === '/fallback-ui' || pathname.startsWith('/fallback-ui/')) return 'fallback-ui';
    if (pathname === '/ui' || pathname.startsWith('/ui/')) return 'ui';
    return null;
  }

  function sanitizeSelectorPages(rawPages, maxPerPage) {
    if (!Array.isArray(rawPages)) return [];
    return rawPages
      .map(page => Array.isArray(page)
        ? page.filter(key => BUTTON_DEFS[key]).slice(0, maxPerPage)
        : [])
      .filter(page => page.length > 0);
  }

  function mergeSelectorPages(frontPages, backPages, maxPerPage) {
    const merged = [];
    const seen = new Set();

    function appendPage(page) {
      if (!Array.isArray(page) || !page.length) return;
      const out = [];
      for (const key of page) {
        if (!BUTTON_DEFS[key] || seen.has(key)) continue;
        seen.add(key);
        out.push(key);
        if (out.length >= maxPerPage) break;
      }
      if (out.length) merged.push(out);
    }

    frontPages.forEach(appendPage);
    backPages.forEach(appendPage);
    return merged;
  }

  function getButtonPages() {
    const maxPerPage = Math.max(1, Number(SELECTOR_CFG.pageSize) || 3);
    const currentAppKey = getCurrentAppActionKey();
    const appPages = sanitizeSelectorPages(SELECTOR_CFG.pages, maxPerPage);
    const embedPages = sanitizeSelectorPages(_dbSelectorPages, maxPerPage);
    const mergedPages = mergeSelectorPages(appPages, embedPages, maxPerPage);
    const visiblePages = mergedPages
      .map(page => page.filter(key => key !== currentAppKey))
      .filter(page => page.length > 0);

    if (visiblePages.length) {
      const hasPaging = SELECTOR_CFG.showPagingButton && visiblePages.length > 1;
      return { pages: visiblePages, hasPaging };
    }

    const enabled = SELECTOR_CFG.enabledButtons || [];
    const actions = enabled.filter(key => key !== 'paging-button' && BUTTON_DEFS[key] && key !== currentAppKey);
    if (!actions.length) return { pages: [], hasPaging: false };

    const pages = [];
    for (let i = 0; i < actions.length; i += maxPerPage) {
      pages.push(actions.slice(i, i + maxPerPage));
    }
    const hasPaging = enabled.includes('paging-button') && pages.length > 1 && SELECTOR_CFG.showPagingButton;
    return { pages, hasPaging };
  }

  function getFlatRibbonButtons() {
    const { pages } = getButtonPages();
    if (!pages.length) return [];
    return pages.flatMap(page => page.filter(key => BUTTON_DEFS[key]));
  }

  function shouldUseTouchRibbonMode() {
    if (typeof window === 'undefined') return false;

    const mode = SELECTOR_CFG.touchRibbonMode || 'auto';
    if (mode === 'off') return false;
    if (mode === 'on') return true;

    const matches = (query) => !!(window.matchMedia && window.matchMedia(query).matches);
    const coarsePointer = matches('(pointer: coarse)') || matches('(any-pointer: coarse)');
    const noHover = matches('(hover: none)') || matches('(any-hover: none)');
    const hasTouch =
      (typeof navigator !== 'undefined' && Number(navigator.maxTouchPoints) > 0) ||
      ('ontouchstart' in window) ||
      coarsePointer;
    if (!hasTouch) return false;

    const width = Number(window.innerWidth) || 0;
    const height = Number(window.innerHeight) || 0;
    const shortEdge = Math.min(width || height, height || width);
    const maxShortEdge = Math.max(320, Number(SELECTOR_CFG.touchRibbonMaxShortEdge) || 920);
    const root = (typeof document !== 'undefined' && document.documentElement) ? document.documentElement : null;
    const isS25SpecialMode = !!(root && root.dataset && root.dataset.specialUiMode === 's25-stargate-touch-nav');

    if (isS25SpecialMode && shortEdge > 0 && shortEdge <= maxShortEdge) {
      return true;
    }

    return !!(shortEdge > 0 && shortEdge <= maxShortEdge && (coarsePointer || noHover));
  }

  function renderActionButtonHtml(key) {
    const def = BUTTON_DEFS[key];
    if (!def) return '';
    const meta = _dbItemMeta[key] || {};
    const label = meta.label || def.label;
    let styleAttr = '';
    if (meta.icon_asset) {
      const url = `${_dbAssetBase()}${meta.icon_asset}`;
      styleAttr = ` style="--bp-ns-icon-asset:url('${url}');--bp-ns-icon-filter:none"`;
    }
    return `<button class="bp-ns-action-btn" data-action="${esc(key)}" title="${esc(label)}" aria-label="${esc(label)}"${styleAttr}>${esc(def.icon)}</button>`;
  }

  function measureRibbonViewportWidth(target, slotCount) {
    if (!target || !slotCount || slotCount < 1 || typeof document === 'undefined') {
      return null;
    }

    const probe = document.createElement('div');
    probe.className = 'bp-ns-ribbon-measure';
    probe.setAttribute('aria-hidden', 'true');
    probe.innerHTML = Array.from({ length: slotCount }, () => '<button class="bp-ns-action-btn" type="button" tabindex="-1" aria-hidden="true"></button>').join('');

    target.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();

    if (!Number.isFinite(width) || width <= 0) return null;
    return width;
  }

  function createInternalRibbonFsm(cfg) {
    const dragStartPx = Math.max(2, Number(cfg && cfg.dragStartPx) || 4);
    const onDragStart = (cfg && cfg.onDragStart) || NOOP;
    const onDragMove = (cfg && cfg.onDragMove) || NOOP;
    const onDragEnd = (cfg && cfg.onDragEnd) || NOOP;

    const state = {
      mode: 'IDLE',
      startX: 0,
      movedPx: 0,
    };

    return {
      pointerDown(event) {
        state.mode = 'PRESSING';
        state.startX = Number(event && event.clientX) || 0;
        state.movedPx = 0;
        return { suppressClick: false };
      },

      pointerMove(event) {
        if (state.mode === 'IDLE') return { suppressClick: false };
        const x = Number(event && event.clientX) || 0;
        const deltaX = x - state.startX;
        state.movedPx = Math.max(state.movedPx, Math.abs(deltaX));

        if (state.mode === 'PRESSING' && state.movedPx >= dragStartPx) {
          state.mode = 'DRAGGING';
          onDragStart();
        }

        if (state.mode === 'DRAGGING') {
          onDragMove(deltaX);
          return { suppressClick: true };
        }

        return { suppressClick: false };
      },

      pointerUp() {
        if (state.mode === 'DRAGGING') {
          onDragEnd();
          state.mode = 'IDLE';
          return { suppressClick: true };
        }
        state.mode = 'IDLE';
        return { suppressClick: false };
      },

      pointerCancel() {
        if (state.mode === 'DRAGGING') {
          onDragEnd();
        }
        state.mode = 'IDLE';
        return { suppressClick: true };
      },
    };
  }

  function createRibbonFsm(cfg) {
    if (typeof window !== 'undefined' && window.BlueprintsRibbonFSM && typeof window.BlueprintsRibbonFSM.create === 'function') {
      try {
        return window.BlueprintsRibbonFSM.create(cfg);
      } catch (error) {
        console.warn('BlueprintsRibbonFSM.create failed, using internal fallback:', error);
      }
    }
    return createInternalRibbonFsm(cfg);
  }

  function bindRibbonDragInteractions(viewport) {
    if (!viewport) return;

    const drag = {
      active: false,
      startX: 0,
      startScrollLeft: 0,
      movedPx: 0,
      pointerId: null,
      suppressClick: false,
    };

    const fsm = createRibbonFsm({
      dragStartPx: 4,
      onDragStart: () => {
        viewport.classList.add('is-dragging');
      },
      onDragMove: (deltaX) => {
        viewport.scrollLeft = drag.startScrollLeft - deltaX;
        _ribbonScrollLeft = viewport.scrollLeft;
      },
      onDragEnd: () => {
        viewport.classList.remove('is-dragging');
      },
    });

    viewport.addEventListener('scroll', () => {
      _ribbonScrollLeft = viewport.scrollLeft;
    }, { passive: true });

    function onPointerDown(event) {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      drag.active = true;
      drag.pointerId = event.pointerId;
      drag.startX = event.clientX;
      drag.startScrollLeft = viewport.scrollLeft;
      drag.movedPx = 0;
      drag.suppressClick = false;
      fsm.pointerDown(event);
      if (typeof viewport.setPointerCapture === 'function') {
        try { viewport.setPointerCapture(event.pointerId); } catch {}
      }
    }

    function onPointerMove(event) {
      if (!drag.active) return;
      const result = fsm.pointerMove(event);
      if (result && result.suppressClick) {
        drag.suppressClick = true;
        event.preventDefault();
      }
    }

    function finishDrag(event) {
      if (!drag.active) return;
      if (event && typeof viewport.releasePointerCapture === 'function' && drag.pointerId !== null) {
        try { viewport.releasePointerCapture(drag.pointerId); } catch {}
      }
      drag.active = false;
      drag.pointerId = null;
      if (event && event.type === 'pointercancel') {
        fsm.pointerCancel(event);
      } else {
        const result = fsm.pointerUp(event);
        if (result && result.suppressClick) {
          drag.suppressClick = true;
        }
      }
    }

    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove);
    viewport.addEventListener('pointerup', finishDrag);
    viewport.addEventListener('pointercancel', finishDrag);
    viewport.addEventListener('pointerleave', finishDrag);
    viewport.addEventListener('click', (event) => {
      if (!drag.suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
      drag.suppressClick = false;
    }, true);
  }

  function bindActionButtonInteractions(container, pageCount) {
    if (!container) return;
    container.querySelectorAll('.bp-ns-action-btn').forEach(btn => {
      if (btn.dataset.action === PLACEHOLDER_BUTTON_ACTION) {
        return;
      }
      if (btn.dataset.action === ORIGIN_BUTTON_ACTION) {
        bindOriginButtonInteractions(btn);
        return;
      }
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'paging-button') {
          _buttonPage = (_buttonPage + 1) % pageCount;
          renderActionButtons();
          return;
        }
        const def = BUTTON_DEFS[action];
        if (!def) return;
        if (typeof def.doAction === 'function') { def.doAction(); return; }
        navigateToNodePath(def.buildPath());
      });
    });
  }

  function renderActionButtons() {
    const left = document.getElementById('bp-ns-actions-left');
    const right = document.getElementById('bp-ns-actions-right');
    if (!left || !right) return;

    left.innerHTML = '';
    right.innerHTML = '';
    left.classList.remove('show');
    right.classList.remove('show');
    left.classList.remove('bp-ns-actions-ribbon');
    right.classList.remove('bp-ns-actions-ribbon');
    left.style.removeProperty('--bp-ns-ribbon-slots');
    left.style.removeProperty('--bp-ns-ribbon-width');
    right.style.removeProperty('--bp-ns-ribbon-slots');
    right.style.removeProperty('--bp-ns-ribbon-width');

    const { pages } = getButtonPages();
    const showOriginButton = SELECTOR_CFG.showOriginButton !== false;
    const showPagingButton = SELECTOR_CFG.showPagingButton !== false;
    const useTouchRibbon = shouldUseTouchRibbonMode();
    const pageSlotCount = Math.max(1, Number(SELECTOR_CFG.pageSize) || 3);
    if (!pages.length && !showOriginButton && !showPagingButton) return;

    const pageCount = pages.length || 1;
    const currentPageButtons = pages.length
      ? pages[((_buttonPage % pageCount) + pageCount) % pageCount]
      : [];
    if (pages.length) {
      _buttonPage = ((_buttonPage % pageCount) + pageCount) % pageCount;
      saveButtonPage();
    }

    const target = SELECTOR_CFG.side === 'left' ? left : right;
    target.classList.add('show');

    if (useTouchRibbon) {
      const ribbonButtons = getFlatRibbonButtons();
      if (ribbonButtons.length) {
        target.classList.add('bp-ns-actions-ribbon');
        const ribbonSlots = pageSlotCount + 1;
        target.style.setProperty('--bp-ns-ribbon-slots', String(Math.max(1, ribbonSlots)));
        const measuredWidth = measureRibbonViewportWidth(target, ribbonSlots);
        if (measuredWidth) {
          target.style.setProperty('--bp-ns-ribbon-width', `${measuredWidth}px`);
        }
        const viewport = document.createElement('div');
        viewport.className = 'bp-ns-ribbon-viewport';

        const track = document.createElement('div');
        track.className = 'bp-ns-ribbon-track';
        track.innerHTML = ribbonButtons.map(renderActionButtonHtml).join('');
        viewport.appendChild(track);
        target.appendChild(viewport);
        requestAnimationFrame(() => {
          const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
          viewport.scrollLeft = Math.min(Math.max(0, _ribbonScrollLeft), max);
        });
        bindRibbonDragInteractions(viewport);
      }

      if (showOriginButton) {
        target.appendChild(createOriginActionButton());
      }

      bindActionButtonInteractions(target, pageCount);
      updateCacheModeButtons();
      updateDiagChipButtons();
      return;
    }

    const placeholderCount = Math.max(0, pageSlotCount - currentPageButtons.length);
    const slotButtons = [
      ...Array.from({ length: placeholderCount }, (_, index) => ({ key: PLACEHOLDER_BUTTON_ACTION, placeholderIndex: index })),
      ...currentPageButtons.map(key => ({ key })),
    ];

    target.innerHTML = slotButtons.map(entry => {
      if (entry.key === PLACEHOLDER_BUTTON_ACTION) {
        return `<button class="bp-ns-action-btn bp-ns-action-btn--placeholder" data-action="${PLACEHOLDER_BUTTON_ACTION}" data-placeholder-index="${entry.placeholderIndex}" title="Empty slot" aria-label="Empty slot" aria-hidden="true" disabled tabindex="-1">•</button>`;
      }
      const def = BUTTON_DEFS[entry.key];
      const meta = _dbItemMeta[entry.key] || {};
      const label = meta.label || def.label;
      let styleAttr = '';
      if (meta.icon_asset) {
        const url = `${_dbAssetBase()}${meta.icon_asset}`;
        styleAttr = ` style="--bp-ns-icon-asset:url('${url}');--bp-ns-icon-filter:none"`;
      }
      return `<button class="bp-ns-action-btn" data-action="${esc(entry.key)}" title="${esc(label)}" aria-label="${esc(label)}"${styleAttr}>${esc(def.icon)}</button>`;
    }).join('');

    if (showPagingButton) {
      const nextBtn = document.createElement('button');
      nextBtn.className = 'bp-ns-action-btn';
      nextBtn.dataset.action = 'paging-button';
      nextBtn.title = 'Next Buttons';
      nextBtn.setAttribute('aria-label', 'Next Buttons');
      nextBtn.textContent = '⟳';
      target.appendChild(nextBtn);
    }

    if (showOriginButton) {
      target.appendChild(createOriginActionButton());
    }

    bindActionButtonInteractions(target, pageCount);

    updateCacheModeButtons();
    updateDiagChipButtons();
  }

  function renderPanel() {
    const list = document.getElementById('bp-ns-list');
    if (!list) return;
    if (!_nodes.length) {
      list.innerHTML = '<div class="bp-ns-node bp-ns-node-empty">Discovering nodes…</div>';
      return;
    }

    const now = Date.now();
    list.innerHTML = _nodes.map(n => `
      <div class="bp-ns-node${n.id === _current ? ' active' : ''}"
           data-id="${esc(n.id)}" data-url="${esc(getPreferredBaseUrl(n))}">
        <span class="bp-ns-node-name${n.localMode ? ' bp-ns-node-local' : ''}"${n.fleetPeer === false ? ' style="text-decoration:line-through;opacity:0.55"' : ''}>${esc(n.name)}</span>
        <span class="bp-ns-node-metric ${esc(metricClass(n, now))}${n.localMode ? ' bp-ns-node-local' : ''}"${n.localMode ? ' title="via LAN"' : ''}>${esc(metricText(n, now))}</span>
      </div>`).join('');

    list.querySelectorAll('.bp-ns-node').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        _current = el.dataset.id;
        lsSet(LS_CURRENT, _current);
        closePanel();
        renderBtn();
        renderActionButtons();
        renderPanel();
        window.location.href = toAbsoluteUrl(el.dataset.url, getNodeSwitchPath());
      });
    });
  }

  function togglePanel() {
    const p = document.getElementById('bp-ns-panel');
    if (!p) return;
    const open = p.classList.toggle('open');
    const btn = document.getElementById('bp-ns-toggle');
    if (btn) btn.setAttribute('aria-expanded', String(open));
    if (open) renderPanel();
  }

  function closePanel() {
    const p = document.getElementById('bp-ns-panel');
    if (p) p.classList.remove('open');
  }

  function metricClass(node, now) {
    if (Number.isFinite(node.latencyMs)) {
      if (node.latencyMs < 30) return 'ms-good';
      if (node.latencyMs <= 60) return 'ms-warn';
      return 'ms-bad';
    }
    if (node.lastSeenAt && (now - node.lastSeenAt) > NO_RESPONSE_WINDOW) return 'ms-stale';
    return 'ms-pending';
  }

  function metricText(node, now) {
    if (Number.isFinite(node.latencyMs)) return `${node.latencyMs} ms`;
    if (node.lastSeenAt && (now - node.lastSeenAt) > NO_RESPONSE_WINDOW) {
      return `last seen ${formatAge(now - node.lastSeenAt)}`;
    }
    if (node.lastSeenAt) return `last seen ${formatAge(now - node.lastSeenAt)}`;
    return 'no response';
  }

  function formatAge(ageMs) {
    const totalSeconds = Math.max(0, Math.floor(ageMs / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 60) return `${totalMinutes}m`;
    const totalHours = Math.floor(totalMinutes / 60);
    if (totalHours < 24) return `${totalHours}h`;
    const totalDays = Math.floor(totalHours / 24);
    return `${totalDays}d`;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  if (!customElements.get('blueprints-node-selector')) {
    customElements.define('blueprints-node-selector', BlueprintsNodeSelector);
  }
})();
