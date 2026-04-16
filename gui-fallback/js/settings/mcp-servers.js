// mcp-servers.js — MCP Servers settings tab
// Lists node-local LiteLLM MCP servers fetched live from the stack.
// For each server, provides a [Test] button that opens a hub-modal with:
//   - Model availability check
//   - Query dropdown (30 test queries)
//   - [Run Search] button → streams tool-call results
//   - Listbox of results; click → stacked JSON detail modal

'use strict';

/* global apiFetch, esc */

// ── Test queries (hardcoded — these are the test inputs, not dynamic content) ──
const MCP_TEST_QUERIES = [
  'London weather',
  'Latest news in AI and machine learning',
  'Python FastAPI tutorial 2025',
  'Docker compose networking best practices',
  'LiteLLM MCP server configuration',
  'SearXNG self-hosted search engine setup',
  'Proxmox VE cluster configuration guide',
  'Tailscale VPN configuration',
  'Caddy reverse proxy configuration',
  'SQLite full-text search performance',
  'FastMCP SSE server Python example',
  'Debian 12 network configuration',
  'Linux container LXC vs Docker comparison',
  'Open source home lab monitoring tools',
  'Self-hosted password manager comparison',
  'GitHub Copilot CLI setup guide',
  'Prompt injection attack techniques',
  'LLM guardrail implementation patterns',
  'Vector database comparison 2025',
  'Embeddings model performance benchmarks',
  'Ollama local AI model deployment',
  'Syncthing mesh network configuration',
  'pfSense firewall rules best practices',
  'Kubernetes vs Nomad comparison',
  'Rust vs Go performance comparison',
  'TypeScript interface vs type alias',
  'CSS container queries browser support',
  'WebAssembly use cases 2025',
  'Service mesh observability tools',
  'Open telemetry collector configuration',
];

const MCP_TEST_CATEGORIES = [
  'general',
  'news',
  'images',
  'videos',
  'music',
  'it',
  'science',
  'files',
  'social media',
];

// State
let _mcpCurrentServer = null;
let _mcpCurrentResults = [];

function _mcpServerQueryGuidance(serverKey) {
  if (serverKey !== 'searxng_web_search') return '';
  return 'Use concise search phrases, not conversational prompts. Example: use "London weather" instead of "What is the current weather in London?". The optional category field is sent as arguments.category when you want to narrow the search domain.';
}

// ── DOM Helpers ───────────────────────────────────────────────────────────────

function _mcpEls() {
  return {
    absent:       document.getElementById('mcp-stack-absent'),
    present:      document.getElementById('mcp-stack-present'),
    list:         document.getElementById('mcp-servers-list'),
    error:        document.getElementById('mcp-servers-error'),
    testModal:    document.getElementById('mcp-test-modal'),
    testTitle:    document.getElementById('mcp-test-modal-title'),
    modelBadge:   document.getElementById('mcp-test-model-badge'),
    queryInput:   document.getElementById('mcp-test-query-input'),
    queryPickerBtn: document.getElementById('mcp-test-query-picker-btn'),
    queryPicker:  document.getElementById('mcp-test-query-picker'),
    runBtn:       document.getElementById('mcp-test-run-btn'),
    runStatus:    document.getElementById('mcp-test-run-status'),
    guardStatus:  document.getElementById('mcp-test-guardrail-status'),
    queryGuidance: document.getElementById('mcp-test-query-guidance'),
    categoryInput: document.getElementById('mcp-test-category-input'),
    categoryPickerBtn: document.getElementById('mcp-test-category-picker-btn'),
    categoryPicker: document.getElementById('mcp-test-category-picker'),
    resultsWrap:  document.getElementById('mcp-test-results-wrap'),
    resultsList:  document.getElementById('mcp-test-results-list'),
    detailModal:  document.getElementById('mcp-result-detail-modal'),
    detailPre:    document.getElementById('mcp-result-detail-pre'),
    copyBtn:      document.getElementById('mcp-result-copy-btn'),
  };
}

// ── Load tab ──────────────────────────────────────────────────────────────────

async function _mcpLoadTab() {
  const els = _mcpEls();
  if (!els.absent || !els.present) return;

  els.absent.style.display = 'none';
  els.present.style.display = 'none';
  if (els.error) { els.error.hidden = true; els.error.textContent = ''; }

  let data;
  try {
    const r = await apiFetch('/api/v1/litellm/mcp-servers');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data = await r.json();
  } catch (e) {
    if (els.error) { els.error.textContent = `Failed to check LiteLLM stack: ${e.message}`; els.error.hidden = false; }
    return;
  }

  if (!data.litellm_present) {
    els.absent.style.display = '';
    return;
  }

  els.present.style.display = '';
  _mcpRenderServerList(data.servers || []);
}

function _mcpRenderServerList(servers) {
  const els = _mcpEls();
  if (!els.list) return;
  if (!servers.length) {
    els.list.innerHTML = '<p style="font-size:12px;color:var(--text-dim)">No MCP servers configured in the LiteLLM stack.</p>';
    return;
  }
  els.list.innerHTML = servers.map(s => `
    <div class="card" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap" data-server-key="${esc(s.server_key)}">
      <div style="min-width:0">
        <div style="font-weight:700;font-size:13px;margin-bottom:3px">${esc(s.server_key)}</div>
        <div style="font-size:11px;color:var(--text-dim);word-break:break-all">${esc(s.url)}</div>
        ${s.description ? `<div style="font-size:12px;color:var(--text-dim);margin-top:4px">${esc(s.description)}</div>` : ''}
        ${_mcpServerQueryGuidance(s.server_key) ? `<div style="font-size:11px;color:var(--text-dim);margin-top:6px">${esc(_mcpServerQueryGuidance(s.server_key))}</div>` : ''}
        <div style="font-size:11px;color:var(--text-dim);margin-top:3px">transport: <code>${esc(s.transport)}</code></div>
      </div>
      <button type="button" class="secondary mcp-test-open-btn" data-server-key="${esc(s.server_key)}" data-server-url="${esc(s.url)}" style="flex-shrink:0;font-size:12px">&#9654; Test</button>
    </div>
  `).join('');
}

// ── Test Modal ────────────────────────────────────────────────────────────────

function _mcpOpenTestModal(serverKey, serverUrl) {
  const els = _mcpEls();
  if (!els.testModal) return;
  _mcpCurrentServer = { key: serverKey, url: serverUrl };
  _mcpCurrentResults = [];

  if (els.testTitle) els.testTitle.textContent = `Test: ${serverKey}`;
  if (els.modelBadge) { els.modelBadge.textContent = 'Checking…'; els.modelBadge.className = 'badge'; }
  if (els.runStatus) els.runStatus.textContent = '';
  if (els.guardStatus) { els.guardStatus.textContent = ''; els.guardStatus.style.display = 'none'; }
  if (els.queryGuidance) {
    const guidance = _mcpServerQueryGuidance(serverKey);
    els.queryGuidance.textContent = guidance;
    els.queryGuidance.style.display = guidance ? '' : 'none';
  }
  if (els.queryInput) els.queryInput.value = MCP_TEST_QUERIES[0] || '';
  if (els.categoryInput) els.categoryInput.value = '';
  if (els.queryPicker) els.queryPicker.style.display = 'none';
  if (els.categoryPicker) els.categoryPicker.style.display = 'none';
  if (els.queryPickerBtn) els.queryPickerBtn.setAttribute('aria-expanded', 'false');
  if (els.categoryPickerBtn) els.categoryPickerBtn.setAttribute('aria-expanded', 'false');
  if (els.resultsWrap) els.resultsWrap.style.display = 'none';
  if (els.resultsList) els.resultsList.innerHTML = '';

  _mcpRenderPresetPicker(els.queryPicker, MCP_TEST_QUERIES, (value) => {
    if (els.queryInput) els.queryInput.value = value;
    _mcpClosePresetPicker(els.queryPicker, els.queryPickerBtn);
  });
  _mcpRenderPresetPicker(els.categoryPicker, MCP_TEST_CATEGORIES, (value) => {
    if (els.categoryInput) els.categoryInput.value = value;
    _mcpClosePresetPicker(els.categoryPicker, els.categoryPickerBtn);
  });

  els.testModal.showModal();
  _mcpCheckModelAvailability();
}

function _mcpRenderPresetPicker(container, values, onPick) {
  if (!container) return;
  container.innerHTML = values.map((value) =>
    `<button type="button" class="mcp-picker-item" data-value="${esc(value)}" style="display:block;width:100%;text-align:left;background:transparent;border:0;border-bottom:1px solid var(--border);padding:8px 10px;color:var(--text);cursor:pointer;font-size:12px">${esc(value)}</button>`
  ).join('');
  container.querySelectorAll('.mcp-picker-item').forEach((button) => {
    button.addEventListener('click', () => onPick(button.dataset.value || ''));
  });
}

function _mcpTogglePresetPicker(container, button) {
  if (!container || !button) return;
  const willOpen = container.style.display === 'none' || !container.style.display;
  container.style.display = willOpen ? 'block' : 'none';
  button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
}

function _mcpClosePresetPicker(container, button) {
  if (container) container.style.display = 'none';
  if (button) button.setAttribute('aria-expanded', 'false');
}

async function _mcpCheckModelAvailability() {
  // Renamed label in HTML is now "MCP endpoint".
  // We probe /mcp/ directly via tools/list — if it responds, the MCP gateway is up.
  // This is what actually matters for MCP tool calls (not model endpoint counts).
  const els = _mcpEls();
  if (!els.modelBadge) return;
  try {
    const r = await apiFetch('/api/v1/litellm/mcp-tools-list', { method: 'POST' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (data.litellm_present === false) {
      els.modelBadge.textContent = 'Stack offline';
      els.modelBadge.className = 'badge badge--red';
    } else if (data.error) {
      els.modelBadge.textContent = `Error: ${data.error}`;
      els.modelBadge.className = 'badge badge--red';
    } else {
      const tools = data.tools || [];
      if (tools.length > 0) {
        const names = tools.map(t => t.name || t).join(', ');
        els.modelBadge.textContent = `OK — ${tools.length} tool${tools.length !== 1 ? 's' : ''}: ${names}`;
        els.modelBadge.className = 'badge badge--green';
      } else {
        els.modelBadge.textContent = 'OK — no tools listed';
        els.modelBadge.className = 'badge badge--warn';
      }
    }
  } catch (e) {
    els.modelBadge.textContent = `Error: ${e.message}`;
    els.modelBadge.className = 'badge badge--red';
  }
}

async function _mcpRunSearch() {
  const els = _mcpEls();
  if (!_mcpCurrentServer) return;

  const query = (els.queryInput?.value || '').trim() || MCP_TEST_QUERIES[0];
  const category = (els.categoryInput?.value || '').trim();

  if (els.runStatus) els.runStatus.textContent = 'Running…';
  if (els.resultsList) els.resultsList.innerHTML = '';
  if (els.resultsWrap) els.resultsWrap.style.display = 'none';

  // Use the direct MCP JSON-RPC tool-call endpoint.
  // Tool names from LiteLLM's /mcp/tools/list follow the convention
  // "<server_name>-<tool_function>", e.g. "searxng_web_search-web_search".
  // We derive the tool name by appending "-web_search" as the known suffix.
  const serverKey = _mcpCurrentServer.key;
  const toolName  = `${serverKey}-web_search`;

  const body = {
    server_name: serverKey,
    tool_name:   toolName,
    arguments:   {
      query,
      num_results: 5,
      ...(category ? { category } : {}),
    },
  };

  let data;
  try {
    const r = await apiFetch('/api/v1/litellm/mcp-tool-call', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data = await r.json();
  } catch (e) {
    if (els.runStatus) els.runStatus.textContent = `Error: ${e.message}`;
    return;
  }

  const status = data.ok === false ? 'Error from MCP server' : 'Done';
  if (els.runStatus) els.runStatus.textContent = status;
  if (els.guardStatus) {
    const guards = data._guardrails_on_path || [];
    if (guards.length) {
      const summary = guards.map((guard) => `${guard.name} (${guard.mode}${guard.default_on ? ', default_on' : ''})`).join(', ');
      els.guardStatus.textContent = `Guardrails on this MCP path: ${summary}`;
      els.guardStatus.style.display = '';
    } else {
      els.guardStatus.textContent = 'Guardrails on this MCP path: none reported';
      els.guardStatus.style.display = '';
    }
  }

  // Parse the plain-text results returned by the searxng MCP tool
  const results = _mcpParseTextResults(data.text || '');
  _mcpCurrentResults = results.length
    ? results.map((result) => ({
        ...result,
        _request: data._request || null,
        _via: data._via || null,
        _guardrails_on_path: data._guardrails_on_path || [],
        _raw: data,
      }))
    : [{ title: 'Raw response', _raw: data, _request: data._request || null, _via: data._via || null, _guardrails_on_path: data._guardrails_on_path || [] }];

  if (els.resultsWrap) els.resultsWrap.style.display = '';
  if (els.resultsList) {
    if (!_mcpCurrentResults.length) {
      els.resultsList.innerHTML = '<div style="padding:8px 10px;font-size:12px;color:var(--text-dim)">No results returned.</div>';
    } else {
      els.resultsList.innerHTML = _mcpCurrentResults.map((r, i) =>
        `<div class="mcp-result-row" data-idx="${i}" style="padding:7px 10px;cursor:pointer;border-bottom:1px solid var(--border);font-size:12px;display:flex;gap:8px;align-items:flex-start" tabindex="0">
          <span style="flex:1;min-width:0"><strong style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.title || '(no title)')}</strong><span style="color:var(--text-dim);font-size:11px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.url || r.link || '')}</span></span>
        </div>`
      ).join('');
    }
  }
}

/**
 * Parse the plain-text block returned by the searxng MCP tool.
 * Format:
 *   1. **Title**
 *      URL: https://...
 *      Snippet text...
 *
 *   2. **Another Title**
 *   ...
 */
function _mcpParseTextResults(text) {
  const results = [];
  if (!text) return results;
  const blocks = text.split(/\n\s*\n/).filter(Boolean);
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    let title = '', url = '', snippet = '';
    for (const line of lines) {
      const titleMatch = line.match(/^\d+\.\s+\*\*(.+)\*\*$/);
      if (titleMatch) { title = titleMatch[1]; continue; }
      const urlMatch = line.match(/^URL:\s+(https?:\/\/\S+)/);
      if (urlMatch) { url = urlMatch[1]; continue; }
      if (!title && line.match(/^\*\*(.+)\*\*$/)) { title = line.replace(/^\*\*|\*\*$/g, ''); continue; }
      if (line && !snippet) { snippet = line; }
    }
    if (title || url) results.push({ title: title || url, url, snippet });
  }
  return results;
}

function _mcpOpenResultDetail(idx) {
  const els = _mcpEls();
  const result = _mcpCurrentResults[idx];
  if (!result || !els.detailModal) return;
  if (els.detailPre) {
    const detail = {
      title: result.title || '',
      url: result.url || '',
      snippet: result.snippet || '',
      _request: result._request || null,
      _via: result._via || null,
      _guardrails_on_path: result._guardrails_on_path || [],
      _raw: result._raw || null,
    };
    els.detailPre.textContent = JSON.stringify(detail, null, 2);
  }
  els.detailModal.showModal();
}

// ── Event Wiring ──────────────────────────────────────────────────────────────

function _mcpWireEvents() {
  // Tab loading now triggered by switchTab() in app.js.
  // DOMContentLoaded fallback handles the case where the tab is pre-active on page load.

  // Delegated: [Test] button on server cards
  const listEl = document.getElementById('mcp-servers-list');
  if (listEl) {
    listEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.mcp-test-open-btn');
      if (btn) _mcpOpenTestModal(btn.dataset.serverKey, btn.dataset.serverUrl);
    });
  }

  // Run Search button
  const runBtn = document.getElementById('mcp-test-run-btn');
  if (runBtn) runBtn.addEventListener('click', _mcpRunSearch);

  const queryPickerBtn = document.getElementById('mcp-test-query-picker-btn');
  const queryPicker = document.getElementById('mcp-test-query-picker');
  if (queryPickerBtn && queryPicker) {
    queryPickerBtn.addEventListener('click', () => _mcpTogglePresetPicker(queryPicker, queryPickerBtn));
  }

  const categoryPickerBtn = document.getElementById('mcp-test-category-picker-btn');
  const categoryPicker = document.getElementById('mcp-test-category-picker');
  if (categoryPickerBtn && categoryPicker) {
    categoryPickerBtn.addEventListener('click', () => _mcpTogglePresetPicker(categoryPicker, categoryPickerBtn));
  }

  const queryInput = document.getElementById('mcp-test-query-input');
  if (queryInput) {
    queryInput.placeholder = 'Select or type a search query';
  }

  document.addEventListener('click', (e) => {
    const els = _mcpEls();
    if (els.queryPicker && els.queryPickerBtn && !els.queryPicker.contains(e.target) && e.target !== els.queryPickerBtn) {
      _mcpClosePresetPicker(els.queryPicker, els.queryPickerBtn);
    }
    if (els.categoryPicker && els.categoryPickerBtn && !els.categoryPicker.contains(e.target) && e.target !== els.categoryPickerBtn) {
      _mcpClosePresetPicker(els.categoryPicker, els.categoryPickerBtn);
    }
  });

  // Results list click → detail modal
  const resultsList = document.getElementById('mcp-test-results-list');
  if (resultsList) {
    resultsList.addEventListener('click', (e) => {
      const row = e.target.closest('.mcp-result-row');
      if (row) _mcpOpenResultDetail(parseInt(row.dataset.idx, 10));
    });
    resultsList.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const row = e.target.closest('.mcp-result-row');
        if (row) { e.preventDefault(); _mcpOpenResultDetail(parseInt(row.dataset.idx, 10)); }
      }
    });
  }

  // Copy button in detail modal
  const copyBtn = document.getElementById('mcp-result-copy-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const pre = document.getElementById('mcp-result-detail-pre');
      if (pre && navigator.clipboard) {
        navigator.clipboard.writeText(pre.textContent).then(() => {
          copyBtn.textContent = '✓ Copied';
          setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 1500);
        }).catch(() => {});
      }
    });
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  _mcpWireEvents();
  // Load immediately if the tab is already visible (edge case on page load)
  const section = document.getElementById('tab-mcp-servers');
  if (section && section.classList.contains('active')) _mcpLoadTab();
});
