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

const MCP_TEST_URLS = [
  'https://example.com',
  'https://www.bbc.co.uk',
  'https://venturebeat.com',
  'https://www.marktechpost.com',
];

// State
let _mcpCurrentServer = null;
let _mcpCurrentResults = [];

function _mcpServerTestConfig(serverKey) {
  if (serverKey === 'scrapling_mcp') {
    return {
      queryLabel: 'URL to fetch',
      queryPlaceholder: 'Enter a full URL to fetch via Scrapling',
      runLabel: '&#9654; Fetch URL',
      queryValue: MCP_TEST_URLS[0] || 'https://example.com',
      querySuggestions: MCP_TEST_URLS,
      categoryEnabled: false,
      toolName: `${serverKey}-get`,
      buildArguments(query) {
        return {
          url: query,
          extraction_type: 'markdown',
          main_content_only: true,
        };
      },
    };
  }

  return {
    queryLabel: 'Test query',
    queryPlaceholder: 'Select or type a search query',
    runLabel: '&#9654; Run Search',
    queryValue: MCP_TEST_QUERIES[0] || '',
    querySuggestions: MCP_TEST_QUERIES,
    categoryEnabled: true,
    toolName: `${serverKey}-web_search`,
    buildArguments(query, category) {
      return {
        query,
        num_results: 5,
        ...(category ? { category } : {}),
      };
    },
  };
}

function _mcpServerQueryGuidance(serverKey) {
  if (serverKey === 'scrapling_mcp') {
    return 'Enter a full URL. This calls Scrapling\'s direct get tool via the local MCP path; no model provider call is involved.';
  }
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
    // Still load the direct-local sections independently of LiteLLM
    await _crawl4aiLoadSection();
    await _scraplingLoadSection();
    return;
  }

  if (!data.litellm_present) {
    els.absent.style.display = '';
    // Still load the direct-local sections independently of LiteLLM
    await _crawl4aiLoadSection();
    await _scraplingLoadSection();
    return;
  }

  els.present.style.display = '';
  _mcpRenderServerList(data.servers || []);
  await _crawl4aiLoadSection();
  await _scraplingLoadSection();
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

  const config = _mcpServerTestConfig(serverKey);
  const queryLabel = document.querySelector('label[for="mcp-test-query-input"]');
  const categoryLabel = document.querySelector('label[for="mcp-test-category-input"]');
  const categoryField = els.categoryInput?.closest('.field');
  const categoryGuidance = document.getElementById('mcp-test-category-guidance');

  if (els.testTitle) els.testTitle.textContent = `Test: ${serverKey}`;
  if (els.modelBadge) { els.modelBadge.textContent = 'Checking…'; els.modelBadge.className = 'badge'; }
  if (els.runStatus) els.runStatus.textContent = '';
  if (els.guardStatus) { els.guardStatus.textContent = ''; els.guardStatus.style.display = 'none'; }
  if (els.queryGuidance) {
    const guidance = _mcpServerQueryGuidance(serverKey);
    els.queryGuidance.textContent = guidance;
    els.queryGuidance.style.display = guidance ? '' : 'none';
  }
  if (queryLabel) queryLabel.textContent = config.queryLabel;
  if (els.queryInput) {
    els.queryInput.value = config.queryValue;
    els.queryInput.placeholder = config.queryPlaceholder;
  }
  if (els.runBtn) els.runBtn.innerHTML = config.runLabel;
  if (els.categoryInput) els.categoryInput.value = '';
  if (categoryField) categoryField.style.display = config.categoryEnabled ? '' : 'none';
  if (categoryLabel) categoryLabel.textContent = config.categoryEnabled ? 'Category (optional)' : 'Category';
  if (categoryGuidance) {
    categoryGuidance.textContent = config.categoryEnabled
      ? 'Passed as arguments.category to the MCP tool. Use this to narrow the search domain. Example: news for current events, images for image-heavy results, or leave blank for the default behavior.'
      : 'This server test uses direct URL fetches, so category is not used.';
  }
  if (els.queryPicker) els.queryPicker.style.display = 'none';
  if (els.categoryPicker) els.categoryPicker.style.display = 'none';
  if (els.queryPickerBtn) els.queryPickerBtn.setAttribute('aria-expanded', 'false');
  if (els.categoryPickerBtn) els.categoryPickerBtn.setAttribute('aria-expanded', 'false');
  if (els.resultsWrap) els.resultsWrap.style.display = 'none';
  if (els.resultsList) els.resultsList.innerHTML = '';

  _mcpRenderPresetPicker(els.queryPicker, config.querySuggestions || MCP_TEST_QUERIES, (value) => {
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

  const serverKey = _mcpCurrentServer.key;
  const config = _mcpServerTestConfig(serverKey);
  const rawQuery = (els.queryInput?.value || '').trim() || config.queryValue;
  const query = serverKey === 'scrapling_mcp' && rawQuery && !/^https?:\/\//i.test(rawQuery)
    ? `https://${rawQuery}`
    : rawQuery;
  const category = (els.categoryInput?.value || '').trim();

  if (els.runStatus) els.runStatus.textContent = 'Running…';
  if (els.resultsList) els.resultsList.innerHTML = '';
  if (els.resultsWrap) els.resultsWrap.style.display = 'none';

  const body = {
    server_name: serverKey,
    tool_name:   config.toolName,
    arguments:   config.buildArguments(query, category),
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

  // Parse the plain-text results returned by the MCP tool.
  // SearXNG returns structured text blocks; Scrapling returns fetched page content.
  let results = _mcpParseTextResults(data.text || '');
  if (!results.length && (data.text || '').trim()) {
    results = [{
      title: serverKey === 'scrapling_mcp' ? (query || 'Fetched page') : 'Raw response',
      url: serverKey === 'scrapling_mcp' ? query : '',
      snippet: (data.text || '').trim().slice(0, 240),
    }];
  }

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

// ── Scrapling section ─────────────────────────────────────────────────────────

let _scraplingLastMarkdown = '';

async function _scraplingLoadSection() {
  const card = document.getElementById('scrapling-card');
  if (!card) return;

  card.innerHTML = '<div style="font-size:12px;color:var(--text-dim);padding:6px 0">Checking Scrapling&hellip;</div>';

  let data;
  try {
    const r = await apiFetch('/api/v1/scrapling/health');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data = await r.json();
  } catch (e) {
    card.innerHTML = _scraplingRenderCard({ reachable: false, error: e.message });
    return;
  }

  card.innerHTML = _scraplingRenderCard(data);
}

function _scraplingRenderCard(data) {
  const reachable = data.reachable === true;
  const mcpUrl = data.mcp_url || `${data.url || 'http://localhost:18000'}/mcp`;
  const statusBadge = reachable
    ? '<span class="badge badge--green" style="margin-left:6px">Online</span>'
    : '<span class="badge badge--red" style="margin-left:6px">Offline</span>';
  const version = data.version ? ` v${esc(data.version)}` : '';
  const errorNote = !reachable && data.error
    ? `<div style="font-size:11px;color:var(--accent-warn);margin-top:4px">${esc(data.error)}</div>`
    : '';

  return `
    <div class="card" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div style="min-width:0">
        <div style="font-weight:700;font-size:13px;margin-bottom:3px">scrapling${statusBadge}</div>
        <div style="font-size:11px;color:var(--text-dim);word-break:break-all">${esc(mcpUrl)}</div>
        <div style="font-size:12px;color:var(--text-dim);margin-top:4px">MCP-first targeted scraper with standard, browser-backed, and stealth fetch tools.${version} Direct local service.</div>
        <div style="font-size:11px;color:var(--text-dim);margin-top:3px">transport: <code>http</code> &nbsp;&middot;&nbsp; tools: get, fetch, stealthy_fetch, bulk_fetch</div>
        ${errorNote}
      </div>
      <button type="button" class="secondary scrapling-test-open-btn" style="flex-shrink:0;font-size:12px"${reachable ? '' : ' disabled'}>&#9654; Test</button>
    </div>
  `;
}

function _scraplingOpenTestModal() {
  const modal = document.getElementById('scrapling-test-modal');
  if (!modal) return;

  const healthBadge = document.getElementById('scrapling-test-health-badge');
  const urlInput = document.getElementById('scrapling-test-url-input');
  const urlPicker = document.getElementById('scrapling-test-url-picker');
  const urlPickerBtn = document.getElementById('scrapling-test-url-picker-btn');
  const toolSelect = document.getElementById('scrapling-test-tool-select');
  const runStatus = document.getElementById('scrapling-test-run-status');
  const resultWrap = document.getElementById('scrapling-test-result-wrap');
  const resultPre = document.getElementById('scrapling-test-result-pre');
  const resultStats = document.getElementById('scrapling-test-result-stats');
  const mcpStatus = document.getElementById('scrapling-test-mcp-status');
  const mcpWrap = document.getElementById('scrapling-test-mcp-wrap');

  if (healthBadge) { healthBadge.textContent = 'Checking…'; healthBadge.className = 'badge'; }
  if (urlInput) urlInput.value = MCP_TEST_URLS[0] || 'https://example.com';
  if (urlPicker) urlPicker.style.display = 'none';
  if (urlPickerBtn) urlPickerBtn.setAttribute('aria-expanded', 'false');
  if (toolSelect) toolSelect.value = 'get';
  if (runStatus) runStatus.textContent = '';
  if (resultWrap) resultWrap.style.display = 'none';
  if (resultPre) resultPre.textContent = '';
  if (resultStats) resultStats.textContent = '';
  if (mcpStatus) mcpStatus.textContent = '';
  if (mcpWrap) mcpWrap.style.display = 'none';
  _scraplingLastMarkdown = '';

  _mcpRenderPresetPicker(urlPicker, MCP_TEST_URLS, (value) => {
    if (urlInput) urlInput.value = value;
    _mcpClosePresetPicker(urlPicker, urlPickerBtn);
  });

  modal.showModal();
  _scraplingCheckHealth();
}

async function _scraplingCheckHealth() {
  const badge = document.getElementById('scrapling-test-health-badge');
  if (!badge) return;
  try {
    const r = await apiFetch('/api/v1/scrapling/health');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (data.reachable) {
      const ver = data.version ? ` — v${data.version}` : '';
      badge.textContent = `OK${ver}`;
      badge.className = 'badge badge--green';
    } else {
      badge.textContent = `Unreachable: ${data.error || 'unknown'}`;
      badge.className = 'badge badge--red';
    }
  } catch (e) {
    badge.textContent = `Error: ${e.message}`;
    badge.className = 'badge badge--red';
  }
}

async function _scraplingRunFetch() {
  const urlInput = document.getElementById('scrapling-test-url-input');
  const toolSelect = document.getElementById('scrapling-test-tool-select');
  const btn = document.getElementById('scrapling-test-run-btn');
  const status = document.getElementById('scrapling-test-run-status');
  const wrap = document.getElementById('scrapling-test-result-wrap');
  const pre = document.getElementById('scrapling-test-result-pre');
  const stats = document.getElementById('scrapling-test-result-stats');

  let url = (urlInput?.value || '').trim() || MCP_TEST_URLS[0];
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  const toolName = toolSelect?.value || 'get';

  if (status) status.textContent = `Running ${toolName}…`;
  if (wrap) wrap.style.display = 'none';
  if (pre) pre.textContent = '';
  if (stats) stats.textContent = '';
  if (btn) btn.disabled = true;

  let data;
  try {
    const r = await apiFetch('/api/v1/scrapling/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, tool_name: toolName }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => `HTTP ${r.status}`);
      throw new Error(err.length > 120 ? err.slice(0, 120) + '…' : err);
    }
    data = await r.json();
  } catch (e) {
    if (status) status.textContent = `Error: ${e.message}`;
    if (btn) btn.disabled = false;
    return;
  }

  if (btn) btn.disabled = false;
  if (status) status.textContent = data.ok ? 'Done' : 'Tool returned an error';

  const md = data.markdown || data.raw_text || '';
  _scraplingLastMarkdown = md;
  if (pre) pre.textContent = md || '(no content returned)';
  if (stats) stats.textContent = `${(data.markdown_len || md.length).toLocaleString()} chars via ${toolName} from ${data.url || url}`;
  if (wrap) wrap.style.display = '';
}

async function _scraplingRunMcpTools() {
  const btn = document.getElementById('scrapling-test-mcp-btn');
  const status = document.getElementById('scrapling-test-mcp-status');
  const wrap = document.getElementById('scrapling-test-mcp-wrap');
  const list = document.getElementById('scrapling-test-mcp-list');

  if (status) status.textContent = 'Fetching…';
  if (wrap) wrap.style.display = 'none';
  if (btn) btn.disabled = true;

  let data;
  try {
    const r = await apiFetch('/api/v1/scrapling/mcp-tools');
    if (!r.ok) {
      const err = await r.text().catch(() => `HTTP ${r.status}`);
      throw new Error(err.length > 120 ? err.slice(0, 120) + '…' : err);
    }
    data = await r.json();
  } catch (e) {
    if (status) status.textContent = `Error: ${e.message}`;
    if (btn) btn.disabled = false;
    return;
  }

  if (btn) btn.disabled = false;

  const tools = data.tools || [];
  if (status) status.textContent = `${tools.length} tool${tools.length !== 1 ? 's' : ''} found`;
  if (list) {
    if (!tools.length) {
      list.innerHTML = '<div style="font-size:12px;color:var(--text-dim)">No tools returned.</div>';
    } else {
      list.innerHTML = tools.map((t) =>
        `<div style="padding:5px 8px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius)">` +
        `<span style="font-weight:700;font-size:12px">${esc(t.name)}</span>` +
        (t.description ? `<span style="font-size:11px;color:var(--text-dim);margin-left:8px">${esc(t.description)}</span>` : '') +
        `</div>`
      ).join('');
    }
  }
  if (wrap) wrap.style.display = '';
}

// ── Crawl4AI preset URLs ──────────────────────────────────────────────────────

const CRAWL4AI_TEST_URLS = [
  'https://www.bbc.co.uk',
  'https://venturebeat.com',
  'https://www.marktechpost.com',
  'https://example.com',
];

let _crawl4aiLastScreenshotB64 = '';
let _crawl4aiLastPdfB64 = '';

// ── Crawl4AI section ──────────────────────────────────────────────────────────

async function _crawl4aiLoadSection() {
  const card = document.getElementById('crawl4ai-card');
  if (!card) return;

  card.innerHTML = '<div style="font-size:12px;color:var(--text-dim);padding:6px 0">Checking Crawl4AI&hellip;</div>';

  let data;
  try {
    const r = await apiFetch('/api/v1/crawl4ai/health');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data = await r.json();
  } catch (e) {
    card.innerHTML = _crawl4aiRenderCard({ reachable: false, error: e.message });
    return;
  }

  card.innerHTML = _crawl4aiRenderCard(data);
}

function _crawl4aiRenderCard(data) {
  const reachable = data.reachable === true;
  const url = data.url || 'http://localhost:11235';
  const statusBadge = reachable
    ? '<span class="badge badge--green" style="margin-left:6px">Online</span>'
    : `<span class="badge badge--red" style="margin-left:6px">Offline</span>`;
  const version = data.version ? ` v${esc(data.version)}` : '';
  const errorNote = !reachable && data.error
    ? `<div style="font-size:11px;color:var(--accent-warn);margin-top:4px">${esc(data.error)}</div>`
    : '';

  return `
    <div class="card" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div style="min-width:0">
        <div style="font-weight:700;font-size:13px;margin-bottom:3px">crawl4ai${statusBadge}</div>
        <div style="font-size:11px;color:var(--text-dim);word-break:break-all">${esc(url)}/mcp/sse</div>
        <div style="font-size:12px;color:var(--text-dim);margin-top:4px">Headless-browser web crawler with MCP${version}. Not part of the LiteLLM stack — direct local service.</div>
        <div style="font-size:11px;color:var(--text-dim);margin-top:3px">transport: <code>sse</code> &nbsp;&middot;&nbsp; tools: md, html, screenshot, pdf, crawl, ask</div>
        ${errorNote}
      </div>
      <button type="button" class="secondary crawl4ai-test-open-btn" style="flex-shrink:0;font-size:12px"${reachable ? '' : ' disabled'}>&#9654; Test</button>
    </div>
  `;
}

// ── Crawl4AI Test Modal ───────────────────────────────────────────────────────

function _crawl4aiOpenTestModal() {
  const modal = document.getElementById('crawl4ai-test-modal');
  if (!modal) return;

  const healthBadge = document.getElementById('crawl4ai-test-health-badge');
  const urlInput    = document.getElementById('crawl4ai-test-url-input');
  const urlPicker   = document.getElementById('crawl4ai-test-url-picker');
  const urlPickerBtn = document.getElementById('crawl4ai-test-url-picker-btn');
  const runStatus   = document.getElementById('crawl4ai-test-run-status');
  const resultWrap  = document.getElementById('crawl4ai-test-result-wrap');
  const resultPre   = document.getElementById('crawl4ai-test-result-pre');
  const resultStats = document.getElementById('crawl4ai-test-result-stats');

  if (healthBadge) { healthBadge.textContent = 'Checking\u2026'; healthBadge.className = 'badge'; }
  if (urlInput) urlInput.value = CRAWL4AI_TEST_URLS[0] || '';
  if (urlPicker) urlPicker.style.display = 'none';
  if (urlPickerBtn) urlPickerBtn.setAttribute('aria-expanded', 'false');
  if (runStatus) runStatus.textContent = '';
  if (resultWrap) resultWrap.style.display = 'none';
  if (resultPre) resultPre.textContent = '';
  if (resultStats) resultStats.textContent = '';

  // Reset screenshot section
  const ssStatus = document.getElementById('crawl4ai-test-screenshot-status');
  const ssWrap   = document.getElementById('crawl4ai-test-screenshot-wrap');
  const ssImg    = document.getElementById('crawl4ai-test-screenshot-img');
  if (ssStatus) ssStatus.textContent = '';
  if (ssWrap) ssWrap.style.display = 'none';
  if (ssImg) ssImg.src = '';

  // Reset PDF section
  const pdfStatus = document.getElementById('crawl4ai-test-pdf-status');
  const pdfResult = document.getElementById('crawl4ai-test-pdf-result');
  const dlPdfBtn  = document.getElementById('crawl4ai-test-download-pdf-btn');
  if (pdfStatus) pdfStatus.textContent = '';
  if (pdfResult) { pdfResult.style.display = 'none'; pdfResult.textContent = ''; }
  if (dlPdfBtn) dlPdfBtn.style.display = 'none';
  _crawl4aiLastScreenshotB64 = '';
  _crawl4aiLastPdfB64 = '';

  // Reset MCP schema section
  const mcpStatus = document.getElementById('crawl4ai-test-mcp-status');
  const mcpWrap   = document.getElementById('crawl4ai-test-mcp-wrap');
  if (mcpStatus) mcpStatus.textContent = '';
  if (mcpWrap) mcpWrap.style.display = 'none';

  _mcpRenderPresetPicker(urlPicker, CRAWL4AI_TEST_URLS, (value) => {
    if (urlInput) urlInput.value = value;
    _mcpClosePresetPicker(urlPicker, urlPickerBtn);
  });

  modal.showModal();
  _crawl4aiCheckHealth();
}

async function _crawl4aiCheckHealth() {
  const badge = document.getElementById('crawl4ai-test-health-badge');
  if (!badge) return;
  try {
    const r = await apiFetch('/api/v1/crawl4ai/health');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (data.reachable) {
      const ver = data.version ? ` — v${data.version}` : '';
      badge.textContent = `OK${ver}`;
      badge.className = 'badge badge--green';
    } else {
      badge.textContent = `Unreachable: ${data.error || 'unknown'}`;
      badge.className = 'badge badge--red';
    }
  } catch (e) {
    badge.textContent = `Error: ${e.message}`;
    badge.className = 'badge badge--red';
  }
}

async function _crawl4aiRunCrawl() {
  const urlInput  = document.getElementById('crawl4ai-test-url-input');
  const runBtn    = document.getElementById('crawl4ai-test-run-btn');
  const runStatus = document.getElementById('crawl4ai-test-run-status');
  const resultWrap = document.getElementById('crawl4ai-test-result-wrap');
  const resultPre  = document.getElementById('crawl4ai-test-result-pre');
  const resultStats = document.getElementById('crawl4ai-test-result-stats');

  const url = (urlInput?.value || '').trim() || CRAWL4AI_TEST_URLS[0];
  const acceptCookies = document.getElementById('crawl4ai-accept-cookies-chk')?.checked !== false;

  if (runStatus) runStatus.textContent = 'Crawling… (headless browser, may take 15–30 s)';
  if (resultWrap) resultWrap.style.display = 'none';
  if (resultPre) resultPre.textContent = '';
  if (resultStats) resultStats.textContent = '';
  if (runBtn) runBtn.disabled = true;

  let data;
  try {
    const r = await apiFetch('/api/v1/crawl4ai/crawl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, accept_cookies: acceptCookies }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => `HTTP ${r.status}`);
      throw new Error(err.length > 120 ? err.slice(0, 120) + '…' : err);
    }
    data = await r.json();
  } catch (e) {
    if (runStatus) runStatus.textContent = `Error: ${e.message}`;
    if (runBtn) runBtn.disabled = false;
    return;
  }

  if (runBtn) runBtn.disabled = false;

  const ok = data.ok !== false;
  if (runStatus) runStatus.textContent = ok ? 'Done' : 'Crawl returned an error';

  const md = data.markdown || '';
  const mdLen = data.markdown_len || md.length;

  if (resultPre) resultPre.textContent = md || '(no markdown returned)';
  if (resultStats) {
    resultStats.textContent = `${mdLen.toLocaleString()} chars extracted from ${data.url || url}`;
  }
  if (resultWrap) resultWrap.style.display = '';
}

// ── Crawl4AI Screenshot Test ─────────────────────────────────────────────────

async function _crawl4aiRunScreenshot() {
  const urlInput  = document.getElementById('crawl4ai-test-url-input');
  const btn       = document.getElementById('crawl4ai-test-screenshot-btn');
  const status    = document.getElementById('crawl4ai-test-screenshot-status');
  const wrap      = document.getElementById('crawl4ai-test-screenshot-wrap');
  const img       = document.getElementById('crawl4ai-test-screenshot-img');
  const stats     = document.getElementById('crawl4ai-test-screenshot-stats');

  const url = (urlInput?.value || '').trim() || CRAWL4AI_TEST_URLS[0];
  if (status) status.textContent = 'Capturing\u2026 (may take 10\u201320\u00a0s)';
  if (wrap) wrap.style.display = 'none';
  if (btn) btn.disabled = true;

  let data;
  try {
    const r = await apiFetch('/api/v1/crawl4ai/screenshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => `HTTP ${r.status}`);
      throw new Error(err.length > 120 ? err.slice(0, 120) + '\u2026' : err);
    }
    data = await r.json();
  } catch (e) {
    if (status) status.textContent = `Error: ${e.message}`;
    if (btn) btn.disabled = false;
    return;
  }

  if (btn) btn.disabled = false;

  if (!data.ok || !data.screenshot_b64) {
    if (status) status.textContent = 'No screenshot data returned';
    return;
  }

  const kb = Math.round(data.size_bytes / 1024);
  if (status) status.textContent = `Done \u2014 ${kb}\u00a0KB PNG`;
  if (img) img.src = `data:image/png;base64,${data.screenshot_b64}`;
  if (stats) stats.textContent = `${data.size_bytes.toLocaleString()} bytes decoded from ${data.url || url}`;
  _crawl4aiLastScreenshotB64 = data.screenshot_b64;
  if (wrap) wrap.style.display = '';
}

// ── Crawl4AI PDF Test ────────────────────────────────────────────────────────

async function _crawl4aiRunPdf() {
  const urlInput = document.getElementById('crawl4ai-test-url-input');
  const btn      = document.getElementById('crawl4ai-test-pdf-btn');
  const status   = document.getElementById('crawl4ai-test-pdf-status');
  const result   = document.getElementById('crawl4ai-test-pdf-result');

  const url = (urlInput?.value || '').trim() || CRAWL4AI_TEST_URLS[0];
  if (status) status.textContent = 'Generating\u2026 (may take 10\u201320\u00a0s)';
  if (result) result.style.display = 'none';
  if (btn) btn.disabled = true;

  let data;
  try {
    const r = await apiFetch('/api/v1/crawl4ai/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => `HTTP ${r.status}`);
      throw new Error(err.length > 120 ? err.slice(0, 120) + '\u2026' : err);
    }
    data = await r.json();
  } catch (e) {
    if (status) status.textContent = `Error: ${e.message}`;
    if (btn) btn.disabled = false;
    return;
  }

  if (btn) btn.disabled = false;

  if (!data.ok) {
    if (status) status.textContent = 'PDF generation failed';
    return;
  }

  const kb = Math.round(data.size_bytes / 1024);
  if (status) status.textContent = `Done \u2014 ${kb}\u00a0KB`;
  if (result) {
    result.textContent = `PDF generated: ${data.size_bytes.toLocaleString()} bytes for ${data.url || url}`;
    result.style.display = '';
  }
  _crawl4aiLastPdfB64 = data.pdf_b64 || '';
  const dlPdfBtn = document.getElementById('crawl4ai-test-download-pdf-btn');
  if (dlPdfBtn) dlPdfBtn.style.display = _crawl4aiLastPdfB64 ? '' : 'none';
}

// ── Crawl4AI MCP Schema Test ─────────────────────────────────────────────────

async function _crawl4aiRunMcpSchema() {
  const btn    = document.getElementById('crawl4ai-test-mcp-btn');
  const status = document.getElementById('crawl4ai-test-mcp-status');
  const wrap   = document.getElementById('crawl4ai-test-mcp-wrap');
  const list   = document.getElementById('crawl4ai-test-mcp-list');

  if (status) status.textContent = 'Fetching\u2026';
  if (wrap) wrap.style.display = 'none';
  if (btn) btn.disabled = true;

  let data;
  try {
    const r = await apiFetch('/api/v1/crawl4ai/mcp-schema');
    if (!r.ok) {
      const err = await r.text().catch(() => `HTTP ${r.status}`);
      throw new Error(err.length > 120 ? err.slice(0, 120) + '\u2026' : err);
    }
    data = await r.json();
  } catch (e) {
    if (status) status.textContent = `Error: ${e.message}`;
    if (btn) btn.disabled = false;
    return;
  }

  if (btn) btn.disabled = false;

  const tools = data.tools || [];
  if (status) status.textContent = `${tools.length} tool${tools.length !== 1 ? 's' : ''} found`;

  if (list) {
    if (!tools.length) {
      list.innerHTML = '<div style="font-size:12px;color:var(--text-dim)">No tools listed in schema.</div>';
    } else {
      list.innerHTML = tools.map((t) =>
        `<div style="padding:5px 8px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius)">` +
        `<span style="font-weight:700;font-size:12px">${esc(t.name)}</span>` +
        (t.description ? `<span style="font-size:11px;color:var(--text-dim);margin-left:8px">${esc(t.description)}</span>` : '') +
        `</div>`
      ).join('');
    }
  }
  if (wrap) wrap.style.display = '';
}


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

  // Crawl4AI [Test] button (delegated on crawl4ai-card)
  const crawl4aiCard = document.getElementById('crawl4ai-card');
  if (crawl4aiCard) {
    crawl4aiCard.addEventListener('click', (e) => {
      const btn = e.target.closest('.crawl4ai-test-open-btn');
      if (btn && !btn.disabled) _crawl4aiOpenTestModal();
    });
  }

  // Scrapling [Test] button (delegated on scrapling-card)
  const scraplingCard = document.getElementById('scrapling-card');
  if (scraplingCard) {
    scraplingCard.addEventListener('click', (e) => {
      const btn = e.target.closest('.scrapling-test-open-btn');
      if (btn && !btn.disabled) _scraplingOpenTestModal();
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

  // Crawl4AI modal controls
  const crawl4aiUrlPickerBtn = document.getElementById('crawl4ai-test-url-picker-btn');
  const crawl4aiUrlPicker    = document.getElementById('crawl4ai-test-url-picker');
  if (crawl4aiUrlPickerBtn && crawl4aiUrlPicker) {
    crawl4aiUrlPickerBtn.addEventListener('click', () => _mcpTogglePresetPicker(crawl4aiUrlPicker, crawl4aiUrlPickerBtn));
  }

  const crawl4aiRunBtn = document.getElementById('crawl4ai-test-run-btn');
  if (crawl4aiRunBtn) crawl4aiRunBtn.addEventListener('click', _crawl4aiRunCrawl);

  const crawl4aiScreenshotBtn = document.getElementById('crawl4ai-test-screenshot-btn');
  if (crawl4aiScreenshotBtn) crawl4aiScreenshotBtn.addEventListener('click', _crawl4aiRunScreenshot);

  const crawl4aiPdfBtn = document.getElementById('crawl4ai-test-pdf-btn');
  if (crawl4aiPdfBtn) crawl4aiPdfBtn.addEventListener('click', _crawl4aiRunPdf);

  const crawl4aiMcpBtn = document.getElementById('crawl4ai-test-mcp-btn');
  if (crawl4aiMcpBtn) crawl4aiMcpBtn.addEventListener('click', _crawl4aiRunMcpSchema);

  const scraplingUrlPickerBtn = document.getElementById('scrapling-test-url-picker-btn');
  const scraplingUrlPicker = document.getElementById('scrapling-test-url-picker');
  if (scraplingUrlPickerBtn && scraplingUrlPicker) {
    scraplingUrlPickerBtn.addEventListener('click', () => _mcpTogglePresetPicker(scraplingUrlPicker, scraplingUrlPickerBtn));
  }

  const scraplingRunBtn = document.getElementById('scrapling-test-run-btn');
  if (scraplingRunBtn) scraplingRunBtn.addEventListener('click', _scraplingRunFetch);

  const scraplingMcpBtn = document.getElementById('scrapling-test-mcp-btn');
  if (scraplingMcpBtn) scraplingMcpBtn.addEventListener('click', _scraplingRunMcpTools);

  const crawl4aiCopyBtn = document.getElementById('crawl4ai-test-copy-btn');
  if (crawl4aiCopyBtn) {
    crawl4aiCopyBtn.addEventListener('click', () => {
      const pre = document.getElementById('crawl4ai-test-result-pre');
      if (pre && navigator.clipboard) {
        navigator.clipboard.writeText(pre.textContent).then(() => {
          crawl4aiCopyBtn.textContent = '\u2713 Copied';
          setTimeout(() => { crawl4aiCopyBtn.innerHTML = '&#128203; Copy'; }, 1500);
        }).catch(() => {});
      }
    });
  }

  const crawl4aiDlMdBtn = document.getElementById('crawl4ai-test-download-md-btn');
  if (crawl4aiDlMdBtn) {
    crawl4aiDlMdBtn.addEventListener('click', () => {
      const pre = document.getElementById('crawl4ai-test-result-pre');
      if (!pre || !pre.textContent) return;
      const blob = new Blob([pre.textContent], { type: 'text/markdown' });
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = 'crawl4ai-extract.md';
      a.click();
      URL.revokeObjectURL(objUrl);
    });
  }

  const crawl4aiDlPngBtn = document.getElementById('crawl4ai-test-download-png-btn');
  if (crawl4aiDlPngBtn) {
    crawl4aiDlPngBtn.addEventListener('click', () => {
      if (!_crawl4aiLastScreenshotB64) return;
      const a = document.createElement('a');
      a.href = `data:image/png;base64,${_crawl4aiLastScreenshotB64}`;
      a.download = 'crawl4ai-screenshot.png';
      a.click();
    });
  }

  const crawl4aiDlPdfBtn = document.getElementById('crawl4ai-test-download-pdf-btn');
  if (crawl4aiDlPdfBtn) {
    crawl4aiDlPdfBtn.addEventListener('click', () => {
      if (!_crawl4aiLastPdfB64) return;
      const a = document.createElement('a');
      a.href = `data:application/pdf;base64,${_crawl4aiLastPdfB64}`;
      a.download = 'crawl4ai-page.pdf';
      a.click();
    });
  }

  const scraplingCopyBtn = document.getElementById('scrapling-test-copy-btn');
  if (scraplingCopyBtn) {
    scraplingCopyBtn.addEventListener('click', () => {
      const pre = document.getElementById('scrapling-test-result-pre');
      if (pre && navigator.clipboard) {
        navigator.clipboard.writeText(pre.textContent).then(() => {
          scraplingCopyBtn.textContent = '✓ Copied';
          setTimeout(() => { scraplingCopyBtn.innerHTML = '&#128203; Copy'; }, 1500);
        }).catch(() => {});
      }
    });
  }

  const scraplingDlMdBtn = document.getElementById('scrapling-test-download-md-btn');
  if (scraplingDlMdBtn) {
    scraplingDlMdBtn.addEventListener('click', () => {
      if (!_scraplingLastMarkdown) return;
      const blob = new Blob([_scraplingLastMarkdown], { type: 'text/markdown' });
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = 'scrapling-extract.md';
      a.click();
      URL.revokeObjectURL(objUrl);
    });
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
    // Close crawl4ai URL picker on outside click
    const c4Picker = document.getElementById('crawl4ai-test-url-picker');
    const c4Btn    = document.getElementById('crawl4ai-test-url-picker-btn');
    if (c4Picker && c4Btn && !c4Picker.contains(e.target) && e.target !== c4Btn) {
      _mcpClosePresetPicker(c4Picker, c4Btn);
    }

    // Close scrapling URL picker on outside click
    const sPicker = document.getElementById('scrapling-test-url-picker');
    const sBtn    = document.getElementById('scrapling-test-url-picker-btn');
    if (sPicker && sBtn && !sPicker.contains(e.target) && e.target !== sBtn) {
      _mcpClosePresetPicker(sPicker, sBtn);
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
