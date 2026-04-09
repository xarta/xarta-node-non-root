/**
 * blueprints-auth.js — shared TOTP authentication for standalone Blueprints pages.
 *
 * Defines window._computeApiToken and window.apiFetch using the same
 * localStorage secret as the main Blueprints GUI (key: 'blueprints_api_secret').
 *
 * Include this before blueprints-node-selector.js and any JS that calls fetch()
 * on the Blueprints API.  The main index.html defines its own apiFetch (with a
 * full modal UI for 401s) so this file's apiFetch is only installed if
 * window.apiFetch is not already defined.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  const LS_SECRET = 'blueprints_api_secret';

  if (typeof window.openBlueprintsEmbedApiKeyModal !== 'function') {
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
        dialog._bpPromise = null;
      });

      return dialog;
    }

    window.openBlueprintsEmbedApiKeyModal = function openBlueprintsEmbedApiKeyModal(opts = {}) {
      const dialog = ensureApiKeyModal();
      if (!dialog) return Promise.resolve(null);
      const input = dialog.querySelector('#bp-embed-api-key-input');
      const error = dialog.querySelector('#bp-embed-api-key-error');
      if (!input || !error) return Promise.resolve(null);

      // Reuse an already-open modal so repeated 401 triggers do not clear
      // the user's in-progress input.
      if (dialog.open && dialog._bpPromise) {
        if (opts.authFailed) {
          error.textContent = 'Authentication failed. Check your API secret.';
        }
        requestAnimationFrame(() => input.focus());
        return dialog._bpPromise;
      }

      error.textContent = opts.authFailed ? 'Authentication failed. Check your API secret.' : '';
      input.value = typeof opts.currentValue === 'string'
        ? opts.currentValue
        : (localStorage.getItem(LS_SECRET) || '');

      dialog._bpPromise = new Promise((resolve) => {
        dialog._bpResolve = resolve;
        dialog.showModal();
        requestAnimationFrame(() => {
          input.focus();
          input.select();
        });
      });
      return dialog._bpPromise;
    };
  }

  async function _computeApiToken(secretHex) {
    if (!secretHex) return '';
    try {
      const windowNum = Math.floor(Date.now() / 5000);
      const keyBytes  = Uint8Array.from(secretHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
      const msgBytes  = new TextEncoder().encode(String(windowNum));
      const key = await crypto.subtle.importKey(
        'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
      );
      const sig = await crypto.subtle.sign('HMAC', key, msgBytes);
      return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch { return ''; }
  }

  async function _extractAuthDetail(resp) {
    try {
      const cloned = resp.clone();
      const data = await cloned.json().catch(() => null);
      if (typeof data === 'string') return data;
      if (data && typeof data.detail === 'string') return data.detail;
      if (data && typeof data.error === 'string') return data.error;
      if (data && typeof data.message === 'string') return data.message;
      const text = await cloned.text().catch(() => '');
      return typeof text === 'string' ? text : '';
    } catch {
      return '';
    }
  }

  async function _isLikelyTotpAuthFailure(resp, hadToken) {
    if (!resp || resp.status !== 401 || !hadToken) return false;
    const detail = (await _extractAuthDetail(resp)).toLowerCase();
    if (!detail) return false;
    return detail.includes('unauthorized')
      || detail.includes('authentication failed')
      || detail.includes('invalid token')
      || detail.includes('token');
  }

  async function apiFetch(url, options = {}) {
    const secret = localStorage.getItem(LS_SECRET) || '';
    const token  = await _computeApiToken(secret);
    const hadToken = !!token;
    const merged = {
      ...options,
      headers: { ...(options.headers || {}), ...(token ? { 'X-API-Token': token } : {}) },
    };
    const r = await fetch(url, merged);
    if (r.status === 401) {
      if (!hadToken) {
        const enteredNoToken = await window.openBlueprintsEmbedApiKeyModal({ authFailed: false });
        if (enteredNoToken && enteredNoToken.trim()) {
          localStorage.setItem(LS_SECRET, enteredNoToken.trim());
          const token2 = await _computeApiToken(enteredNoToken.trim());
          return fetch(url, {
            ...options,
            headers: { ...(options.headers || {}), ...(token2 ? { 'X-API-Token': token2 } : {}) },
          });
        }
        return r;
      }

      const likelyAuthFailure = await _isLikelyTotpAuthFailure(r, true);
      if (!likelyAuthFailure) return r;

      // Retry once before prompting to avoid false auth-failure alarms.
      const retryToken = await _computeApiToken(secret);
      let promptSourceResp = r;
      if (retryToken) {
        const retryResp = await fetch(url, {
          ...options,
          headers: { ...(options.headers || {}), 'X-API-Token': retryToken },
        });
        if (retryResp.status !== 401) return retryResp;
        const retryLikelyAuthFailure = await _isLikelyTotpAuthFailure(retryResp, true);
        if (!retryLikelyAuthFailure) return retryResp;
        promptSourceResp = retryResp;
      }

      const entered = await window.openBlueprintsEmbedApiKeyModal({ authFailed: true });
      if (entered && entered.trim()) {
        localStorage.setItem(LS_SECRET, entered.trim());
        const token2  = await _computeApiToken(entered.trim());
        const merged2 = {
          ...options,
          headers: { ...(options.headers || {}), ...(token2 ? { 'X-API-Token': token2 } : {}) },
        };
        return fetch(url, merged2);
      }
      return promptSourceResp;
    }
    return r;
  }

  // Always expose _computeApiToken; only set apiFetch if the main GUI hasn't
  window._computeApiToken = _computeApiToken;
  if (!window.apiFetch) window.apiFetch = apiFetch;
})();
