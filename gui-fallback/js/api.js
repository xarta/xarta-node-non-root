/* ── API authentication (TOTP) ──────────────────────────────────────── */
const _LS_SECRET_KEY    = 'blueprints_api_secret';
const _LS_FE_SETTINGS   = 'bp_fe_settings';

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
  } catch (e) {
    return '';
  }
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

function _isColumnResizeActive() {
  return !!(document.body && document.body.classList.contains('table-col-resizing'));
}

async function _waitForColumnResizeToEnd(maxWaitMs = 2500) {
  if (!_isColumnResizeActive()) return;
  await new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (!_isColumnResizeActive() || (Date.now() - startedAt) >= maxWaitMs) {
        clearInterval(timer);
        resolve();
      }
    }, 16);
  });
}

window.isColumnResizeActive = _isColumnResizeActive;

async function apiFetch(url, options = {}) {
  const deferDuringColumnResize = options.deferDuringColumnResize !== false;
  if (deferDuringColumnResize) {
    await _waitForColumnResizeToEnd();
  }
  const secret = localStorage.getItem(_LS_SECRET_KEY) || '';
  const token  = await _computeApiToken(secret);
  const hadToken = !!token;
  const fetchOptions = { ...options };
  delete fetchOptions.deferDuringColumnResize;
  const merged = {
    ...fetchOptions,
    headers: { ...(fetchOptions.headers || {}), ...(token ? { 'X-API-Token': token } : {}) },
  };
  const r = await fetch(url, merged);
  if (r.status === 401) {
    if (!hadToken) {
      openApiKeyModal(false);
      return r;
    }

    const likelyAuthFailure = await _isLikelyTotpAuthFailure(r, true);
    if (!likelyAuthFailure) {
      return r;
    }

    // Retry once before showing auth-failed UI to avoid false alarms on
    // occasional boundary timing and transient 401 responses.
    const retryToken = await _computeApiToken(secret);
    if (retryToken) {
      const retryResp = await fetch(url, {
        ...fetchOptions,
        headers: { ...(fetchOptions.headers || {}), 'X-API-Token': retryToken },
      });
      if (retryResp.status !== 401) return retryResp;
      const retryLikelyAuthFailure = await _isLikelyTotpAuthFailure(retryResp, true);
      if (retryLikelyAuthFailure) openApiKeyModal(true);
      return retryResp;
    }

    openApiKeyModal(true);
  }
  return r;
}

function openApiKeyModal(authFailed = false) {
  const modal = document.getElementById('api-key-modal');
  const input = document.getElementById('api-key-input');
  const errEl = document.getElementById('api-key-modal-error');
  if (!modal || !input || !errEl) return;

  // If already open, do not reset the input value while the user is typing.
  // Only update the error hint and keep focus stable.
  if (modal.open) {
    if (authFailed) errEl.textContent = 'Authentication failed. Check your API secret.';
    requestAnimationFrame(() => input.focus());
    return;
  }

  errEl.textContent = authFailed ? 'Authentication failed. Check your API secret.' : '';
  input.value = localStorage.getItem(_LS_SECRET_KEY) || '';
  if (typeof HubModal !== 'undefined') {
    HubModal.open(modal, {
      onOpen: () => {
        input.focus();
        input.select();
      }
    });
    return;
  }
  if (!modal.open) modal.showModal();
  input.focus();
  input.select();
}

function saveApiKey() {
  const modal = document.getElementById('api-key-modal');
  const input = document.getElementById('api-key-input');
  const errEl = document.getElementById('api-key-modal-error');
  if (!input) return;
  const val = input.value.trim();
  if (val) {
    localStorage.setItem(_LS_SECRET_KEY, val);
  } else {
    localStorage.removeItem(_LS_SECRET_KEY);
  }
  if (errEl) errEl.textContent = '';
  if (typeof HubModal !== 'undefined' && modal) {
    HubModal.close(modal);
  } else if (modal && modal.open) {
    modal.close();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('api-key-input');
  const saveBtn = document.getElementById('api-key-save-btn');
  if (input) {
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      saveApiKey();
    });
  }
  if (saveBtn) saveBtn.addEventListener('click', saveApiKey);
});

/* ── Frontend settings (localStorage cache of fe.* server settings) ─── */

async function loadFrontendSettings() {
  try {
    const r = await apiFetch('/api/v1/settings/frontend-settings');
    if (!r.ok) return;
    const data = await r.json();
    localStorage.setItem(_LS_FE_SETTINGS, JSON.stringify(data));
  } catch (_) {}
}

function getFrontendSetting(key, fallback = null) {
  try {
    const data = JSON.parse(localStorage.getItem(_LS_FE_SETTINGS) || '{}');
    return key in data ? data[key] : fallback;
  } catch (_) { return fallback; }
}

async function refreshFrontendSettingsCache() {
  await loadFrontendSettings();
  const el = document.getElementById('settings-status');
  if (el) {
    el.textContent = 'Client settings cache refreshed';
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 2500);
  }
}
