// prompt-injection.js — Prompt Injection settings tab
// Shows live guardrail status and runs canary-based injection test vectors.

'use strict';

/* global apiFetch, esc */

// ── DOM Helpers ───────────────────────────────────────────────────────────────

function _piEls() {
  return {
    absent:          document.getElementById('pi-stack-absent'),
    present:         document.getElementById('pi-stack-present'),
    guardrailList:   document.getElementById('pi-guardrail-list'),
    guardrailWarn:   document.getElementById('pi-guardrail-warning'),
    runBtn:          document.getElementById('pi-run-tests-btn'),
    testStatus:      document.getElementById('pi-test-status'),
    resultsTable:    document.getElementById('pi-results-table'),
    resultsTbody:    document.getElementById('pi-results-tbody'),
    error:           document.getElementById('pi-error'),
    breachModal:     document.getElementById('pi-breach-info-modal'),
    breachTitle:     document.getElementById('pi-breach-modal-title'),
    breachLoading:   document.getElementById('pi-breach-modal-loading'),
    breachContent:   document.getElementById('pi-breach-modal-content'),
  };
}

// State
let _piTestResults = [];

const _PI_GUARDRAIL_META = {
  'presidio-pii': {
    purpose: 'Uses Microsoft Presidio to mask or block structured sensitive data such as email addresses, phone numbers, and credit-card patterns.',
    forUse: 'Protecting normal model traffic that passes through the node-local LiteLLM gateway on this node.',
    appliesTo: 'The local LiteLLM chat/completions path when a request or response goes through the guarded gateway.',
    notFor: 'It is not a general prompt-injection detector and does not understand every adversarial instruction trick by itself.',
    paths: [
      '/xarta-node/.lone-wolf/stacks/litellm/config.yaml',
      '/xarta-node/.lone-wolf/stacks/litellm/compose.yaml',
    ],
  },
  'presidio-mcp': {
    purpose: 'Extends the Presidio screening posture to the LiteLLM MCP tool path that Blueprints reports for local MCP calls.',
    forUse: 'Keeping structured sensitive data from flowing unchecked when content moves through the node-local MCP protection path.',
    appliesTo: 'LiteLLM MCP traffic on this node, surfaced by the backend around the local /mcp/ JSON-RPC path.',
    notFor: 'It does not replace the Safe Web Research sanitizers and it does not turn arbitrary web pages into trusted data.',
    paths: [
      '/xarta-node/.lone-wolf/stacks/litellm/config.yaml',
      '/root/xarta-node/blueprints-app/app/routes_litellm.py',
    ],
  },
  'custom-injection-guard': {
    purpose: 'Custom Python guardrail that blocks classic instruction-override phrases, system-tag tricks, invisible Unicode characters, and similar signatures before the request reaches the model.',
    forUse: 'Catching common prompt-injection and hidden-text attacks early in the LiteLLM path.',
    appliesTo: 'Requests that traverse the node-local LiteLLM gateway, including the protection path Blueprints reports for MCP-related calls.',
    notFor: 'It is pattern-based rather than a complete semantic judge of every malicious document or every future attack variant.',
    paths: [
      '/xarta-node/.lone-wolf/stacks/litellm/guardrails/injection_guard.py',
      '/xarta-node/.lone-wolf/stacks/litellm/config.yaml',
    ],
  },
  'no-think-pre': {
    purpose: 'Appends /no_think to the last user message so the PRIMARY-LOCAL-NO-THINK alias asks Qwen3 not to emit reasoning blocks.',
    forUse: 'Keeping output cleaner when the no-think local alias is intentionally chosen.',
    appliesTo: 'Only the PRIMARY-LOCAL-NO-THINK model group on this node.',
    notFor: 'It is not a prompt-injection blocker and it does not inspect web content for hostile instructions.',
    paths: [
      '/xarta-node/.lone-wolf/stacks/litellm/guardrails/no_think_transform.py',
      '/xarta-node/.lone-wolf/stacks/litellm/config.yaml',
    ],
  },
  'no-think-post': {
    purpose: 'Strips any <think>...</think> blocks from the response after the model call completes.',
    forUse: 'Response cleanup for the no-think local alias.',
    appliesTo: 'Only the PRIMARY-LOCAL-NO-THINK model group, after the model has already answered.',
    notFor: 'Because it runs in post_call mode, it cannot stop the original request from reaching the model.',
    paths: [
      '/xarta-node/.lone-wolf/stacks/litellm/guardrails/no_think_transform.py',
      '/xarta-node/.lone-wolf/stacks/litellm/config.yaml',
    ],
  },
};

function _piMetaForGuardrail(name) {
  return _PI_GUARDRAIL_META[name] || {
    purpose: 'This guardrail is defined in the local LiteLLM configuration for this node.',
    forUse: 'Making the node-local LiteLLM path more predictable and observable.',
    appliesTo: 'The local gateway path that this page is currently inspecting.',
    notFor: 'See the stack config and local docs for any extra scope-specific behaviour.',
    paths: ['/xarta-node/.lone-wolf/stacks/litellm/config.yaml'],
  };
}

function _piModeExplanation(mode) {
  if (mode === 'pre_call') {
    return 'Runs before the request reaches the model or protected tool path, so this is the blocking position.';
  }
  if (mode === 'post_call') {
    return 'Runs after the model has already answered, so it is useful for cleanup or audit rather than pre-request blocking.';
  }
  if (mode === 'logging_only') {
    return 'Logs detections for operator review but does not block the request.';
  }
  return 'The page is showing the mode exactly as reported by the local LiteLLM configuration.';
}

// ── Load Tab ──────────────────────────────────────────────────────────────────

async function _piLoadTab() {
  const els = _piEls();
  if (!els.absent || !els.present) return;

  els.absent.style.display = 'none';
  els.present.style.display = 'none';
  if (els.error) { els.error.hidden = true; els.error.textContent = ''; }

  // Check stack presence
  let statusData;
  try {
    const r = await apiFetch('/api/v1/litellm/status');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    statusData = await r.json();
  } catch (e) {
    if (els.error) { els.error.textContent = `Failed to check LiteLLM stack: ${e.message}`; els.error.hidden = false; }
    return;
  }

  if (!statusData.present || !statusData.reachable) {
    els.absent.style.display = '';
    return;
  }

  els.present.style.display = '';
  _piLoadGuardrails();
}

async function _piLoadGuardrails() {
  const els = _piEls();
  if (!els.guardrailList) return;

  els.guardrailList.innerHTML = '<span style="font-size:12px;color:var(--text-dim)">Loading&hellip;</span>';

  let data;
  try {
    const r = await apiFetch('/api/v1/litellm/guardrail-status');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data = await r.json();
  } catch (e) {
    els.guardrailList.innerHTML = `<span style="font-size:12px;color:var(--accent-red)">Failed to load guardrails: ${esc(e.message)}</span>`;
    return;
  }

  if (!data.litellm_present) {
    els.guardrailList.innerHTML = '<span style="font-size:12px;color:var(--text-dim)">LiteLLM not reachable.</span>';
    return;
  }

  const guards = data.guardrails || [];
  const hasLoggingOnly = guards.some(g => g.mode === 'logging_only');
  if (els.guardrailWarn) {
    els.guardrailWarn.style.display = hasLoggingOnly ? '' : 'none';
  }

  if (!guards.length) {
    els.guardrailList.innerHTML = '<span style="font-size:12px;color:var(--text-dim)">No guardrails configured.</span>';
    return;
  }

  els.guardrailList.innerHTML = guards.map(g => {
    const meta = _piMetaForGuardrail(g.name);
    const statusColor = g.enforcing
      ? 'var(--accent-green, #3ddc84)'
      : g.mode === 'logging_only'
        ? 'var(--accent-warn, #f5c518)'
        : 'var(--accent-red, #e06c75)';
    const icon = g.enforcing ? '✅' : g.mode === 'logging_only' ? '⚠️' : '❌';
    const badge = g.enforcing ? 'ENFORCING' : g.mode === 'logging_only' ? 'LOGGING ONLY' : g.mode.toUpperCase();
    const pathsHtml = (meta.paths || []).map(path => `
      <div style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;color:var(--text-dim);word-break:break-all">${esc(path)}</div>
    `).join('');

    return `<details style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
      <summary style="display:flex;align-items:center;gap:10px;padding:8px 10px;cursor:pointer">
        <span style="font-size:14px">${icon}</span>
        <span style="font-size:12px;font-weight:600;flex:1">${esc(g.name)}</span>
        <span style="font-size:10px;color:var(--text-dim);border:1px solid var(--border);border-radius:999px;padding:2px 6px">${g.default_on ? 'default_on' : 'manual'}</span>
        <span style="font-size:11px;color:var(--text-dim)">mode: <code>${esc(g.mode)}</code></span>
        <span style="font-size:11px;font-weight:700;color:${statusColor}">[${badge}]</span>
      </summary>
      <div style="padding:10px 12px 12px;border-top:1px solid var(--border);background:rgba(255,255,255,.02)">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">
          <div>
            <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">What it does</div>
            <div style="font-size:12px;line-height:1.5">${esc(meta.purpose)}</div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">What it is for</div>
            <div style="font-size:12px;line-height:1.5">${esc(meta.forUse)}</div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Applies to</div>
            <div style="font-size:12px;line-height:1.5">${esc(meta.appliesTo)}</div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Does not apply to</div>
            <div style="font-size:12px;line-height:1.5">${esc(meta.notFor)}</div>
          </div>
        </div>
        <div style="margin-top:10px">
          <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Verified code / config paths</div>
          ${pathsHtml}
        </div>
        <div style="margin-top:10px;font-size:11px;color:var(--text-dim);line-height:1.5">Mode meaning: ${esc(_piModeExplanation(g.mode))}</div>
      </div>
    </details>`;
  }).join('');
}

// ── Injection Test Runner ─────────────────────────────────────────────────────

async function _piRunTests() {
  const els = _piEls();
  if (!els.runBtn) return;

  els.runBtn.disabled = true;
  if (els.testStatus) els.testStatus.textContent = 'Running tests…';
  if (els.resultsTable) els.resultsTable.style.display = '';
  if (els.resultsTbody) els.resultsTbody.innerHTML = '';
  _piTestResults = [];

  let resp;
  try {
    resp = await fetch('/api/v1/litellm/injection-test', {
      method: 'POST',
      headers: await _piAuthHeaders(),
    });
  } catch (e) {
    if (els.testStatus) els.testStatus.textContent = `Error: ${e.message}`;
    if (els.runBtn) els.runBtn.disabled = false;
    return;
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    if (els.testStatus) els.testStatus.textContent = `Error ${resp.status}: ${txt.slice(0, 100)}`;
    if (els.runBtn) els.runBtn.disabled = false;
    return;
  }

  // Stream NDJSON results
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const result = JSON.parse(trimmed);
        _piTestResults.push(result);
        _piAppendResultRow(result, _piTestResults.length - 1);
      } catch (_) { /* skip malformed line */ }
    }
  }
  // Handle any remaining buffer
  if (buffer.trim()) {
    try {
      const result = JSON.parse(buffer.trim());
      _piTestResults.push(result);
      _piAppendResultRow(result, _piTestResults.length - 1);
    } catch (_) { /* ignore */ }
  }

  const total = _piTestResults.length;
  const breaches = _piTestResults.filter(r => r.status === 'breach').length;
  const blocked = _piTestResults.filter(r => r.status === 'blocked').length;
  if (els.testStatus) {
    els.testStatus.textContent = `Done — ${blocked} blocked, ${breaches} breach${breaches !== 1 ? 'es' : ''}, ${total - blocked - breaches} other`;
  }
  if (els.runBtn) els.runBtn.disabled = false;
}

function _piAppendResultRow(result, idx) {
  const tbody = document.getElementById('pi-results-tbody');
  if (!tbody) return;

  let statusHtml, statusColor;
  switch (result.status) {
    case 'blocked':
      statusHtml = '🛡 BLOCKED';
      statusColor = 'var(--accent-green, #3ddc84)';
      break;
    case 'breach':
      statusHtml = '⚡ BREACH';
      statusColor = 'var(--accent-red, #e06c75)';
      break;
    case 'pass_benign':
      statusHtml = '✅ PASS';
      statusColor = 'var(--accent-green, #3ddc84)';
      break;
    case 'error':
      statusHtml = '⚠ ERROR';
      statusColor = 'var(--accent-warn, #f5c518)';
      break;
    default:
      statusHtml = esc(result.status || '?');
      statusColor = 'var(--text-dim)';
  }

  const moreInfoCell = result.status === 'breach'
    ? `<button type="button" class="secondary pi-more-info-btn" data-idx="${idx}" style="font-size:11px;padding:3px 8px">More Info</button>`
    : '';

  const tr = document.createElement('tr');
  tr.style.borderBottom = '1px solid var(--border)';
  tr.innerHTML = `
    <td style="padding:5px 8px;font-size:12px">${esc(result.name)}</td>
    <td style="padding:5px 8px;font-size:12px;font-weight:700;color:${statusColor}">${statusHtml}</td>
    <td style="padding:5px 8px">${moreInfoCell}</td>
  `;
  tbody.appendChild(tr);
}

// ── Breach Analysis Modal ─────────────────────────────────────────────────────

async function _piOpenBreachInfo(idx) {
  const els = _piEls();
  const result = _piTestResults[idx];
  if (!result || !els.breachModal) return;

  if (els.breachTitle) els.breachTitle.textContent = `Breach Analysis: ${result.name}`;
  if (els.breachLoading) { els.breachLoading.style.display = ''; }
  if (els.breachContent) { els.breachContent.style.display = 'none'; els.breachContent.textContent = ''; }

  els.breachModal.showModal();

  const prompt = `You are a security analyst. The following prompt injection test FAILED to be blocked by a LiteLLM guardrail:

Test name: ${result.name}
Guard mode: pre_call (enforcing)
HTTP response code: ${result.http_code}
Response excerpt: ${result.response_excerpt || '(none)'}

Please explain:
(1) Why this injection technique may have bypassed the guard
(2) What pattern would be needed to catch it
(3) Whether it represents a real risk in a RAG/MCP context`;

  try {
    const r = await apiFetch('/api/v1/litellm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'ZAI-MEDIUM',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 512,
      }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content || '(no response)';
    if (els.breachLoading) els.breachLoading.style.display = 'none';
    if (els.breachContent) { els.breachContent.textContent = content; els.breachContent.style.display = ''; }
  } catch (e) {
    if (els.breachLoading) els.breachLoading.style.display = 'none';
    if (els.breachContent) { els.breachContent.textContent = `Error: ${e.message}`; els.breachContent.style.display = ''; }
  }
}

// ── Auth header helper ────────────────────────────────────────────────────────

async function _piAuthHeaders() {
  // Derive TOTP token the same way apiFetch does — but for raw fetch calls
  // We need the HMAC token for the streaming injection-test POST
  const secretHex = localStorage.getItem('blueprints_api_secret');
  if (!secretHex) return {};
  try {
    const keyBytes = Uint8Array.from(secretHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const msg = new TextEncoder().encode(String(Math.floor(Date.now() / 5000)));
    const sig = await crypto.subtle.sign('HMAC', key, msg);
    const token = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    return { 'X-API-Token': token, 'Content-Type': 'application/json' };
  } catch (_) {
    return {};
  }
}

// ── Event Wiring ──────────────────────────────────────────────────────────────

function _piWireEvents() {
  // Tab loading now triggered by switchTab() in app.js.
  // DOMContentLoaded fallback handles the case where the tab is pre-active on page load.

  const runBtn = document.getElementById('pi-run-tests-btn');
  if (runBtn) runBtn.addEventListener('click', _piRunTests);

  // Delegated: More Info buttons in results table
  const tbody = document.getElementById('pi-results-tbody');
  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('.pi-more-info-btn');
      if (btn) _piOpenBreachInfo(parseInt(btn.dataset.idx, 10));
    });
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  _piWireEvents();
  const section = document.getElementById('tab-prompt-injection');
  if (section && section.classList.contains('active')) _piLoadTab();
});
