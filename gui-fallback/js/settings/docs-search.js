/* ── Docs search modal ───────────────────────────────────────────────────── */

const _DOCS_SEARCH_LS_KEY = 'bp_docs_search_v1';
let _docsSearchState = {
  query: '',
  mode: 'hybrid',
  top_k: 8,
  rerank: true,
  results: [],
  selectedHandle: null,
  lastError: '',
  searchedAt: null,
};

function _docsSearchEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function _docsSearchLoadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(_DOCS_SEARCH_LS_KEY) || '{}');
    if (raw && typeof raw === 'object') {
      _docsSearchState = {
        ..._docsSearchState,
        query: String(raw.query || ''),
        mode: ['vector', 'hybrid', 'keyword'].includes(raw.mode) ? raw.mode : 'hybrid',
        top_k: Math.min(30, Math.max(1, parseInt(raw.top_k, 10) || 8)),
        rerank: raw.rerank !== false,
        results: Array.isArray(raw.results) ? raw.results.slice(0, 30) : [],
        selectedHandle: raw.selectedHandle || null,
        searchedAt: raw.searchedAt || null,
      };
    }
  } catch {
    localStorage.removeItem(_DOCS_SEARCH_LS_KEY);
  }
}

function _docsSearchSaveState() {
  const saved = {
    query: _docsSearchState.query,
    mode: _docsSearchState.mode,
    top_k: _docsSearchState.top_k,
    rerank: _docsSearchState.rerank,
    results: _docsSearchState.results,
    selectedHandle: _docsSearchState.selectedHandle,
    searchedAt: _docsSearchState.searchedAt,
  };
  localStorage.setItem(_DOCS_SEARCH_LS_KEY, JSON.stringify(saved));
}

function _docsSearchTerms(result) {
  const terms = Array.isArray(result?.keyword_terms) ? result.keyword_terms : [];
  if (terms.length) return terms;
  return Array.from(new Set((_docsSearchState.query.match(/[A-Za-z0-9._:-]{3,}/g) || [])
    .map(v => v.toLowerCase())))
    .slice(0, 8);
}

function _docsSearchSetForm() {
  const q = document.getElementById('docs-search-query');
  const mode = document.getElementById('docs-search-mode');
  const topK = document.getElementById('docs-search-top-k');
  const rerank = document.getElementById('docs-search-rerank');
  if (q) q.value = _docsSearchState.query;
  if (mode) mode.value = _docsSearchState.mode;
  if (topK) topK.value = String(_docsSearchState.top_k);
  if (rerank) rerank.checked = !!_docsSearchState.rerank;
}

function _docsSearchReadForm() {
  _docsSearchState.query = (document.getElementById('docs-search-query')?.value || '').trim();
  _docsSearchState.mode = document.getElementById('docs-search-mode')?.value || 'hybrid';
  _docsSearchState.top_k = Math.min(30, Math.max(1, parseInt(document.getElementById('docs-search-top-k')?.value, 10) || 8));
  _docsSearchState.rerank = !!document.getElementById('docs-search-rerank')?.checked;
}

function openDocsSearchModal() {
  _docsSearchLoadState();
  _docsSearchSetForm();
  _docsSearchRender();
  const modal = document.getElementById('docs-search-modal');
  if (!modal) return;
  HubModal.open(modal, {
    onOpen: () => {
      const input = document.getElementById('docs-search-query');
      if (input) {
        input.focus();
        input.select();
      }
    },
  });
}

function _docsSearchRenderStatus(text, isError = false) {
  const err = document.getElementById('docs-search-error');
  const status = document.getElementById('docs-search-status');
  if (err) err.textContent = isError ? text : '';
  if (status) status.textContent = isError ? '' : text;
}

function _docsSearchRender() {
  const list = document.getElementById('docs-search-results');
  if (!list) return;
  const results = _docsSearchState.results || [];
  if (!results.length) {
    list.innerHTML = `<div class="docs-search-empty">No results yet.</div>`;
    _docsSearchRenderStatus(_docsSearchState.searchedAt ? 'No matches returned.' : '', false);
    return;
  }
  list.innerHTML = results.map((r, idx) => {
    const handle = String(r.handle ?? `${r.doc_path}:${r.chunk_index}:${idx}`);
    const selected = String(_docsSearchState.selectedHandle || '') === handle;
    const sources = Array.isArray(r.match_sources) && r.match_sources.length ? r.match_sources.join('+') : _docsSearchState.mode;
    const score = r.rerank_score ?? r.score ?? r.rrf_score;
    const scoreText = typeof score === 'number' ? score.toFixed(3) : '';
    const path = r.viewer_path || r.register_path || r.doc_path || '';
    const chunk = r.chunk_index !== null && r.chunk_index !== undefined ? `chunk ${r.chunk_index}` : '';
    const disabled = !r.openable;
    const action = r.openable
      ? `<button class="hub-modal-btn" type="button" data-docs-search-action="open" data-handle="${_docsSearchEsc(handle)}">Open</button>`
      : (r.register_path && r.file_exists)
        ? `<button class="hub-modal-btn secondary" type="button" data-docs-search-action="register" data-handle="${_docsSearchEsc(handle)}">Add</button>`
        : `<button class="hub-modal-btn secondary" type="button" disabled>Stale</button>`;
    return `
      <article class="docs-search-result ${selected ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}" data-handle="${_docsSearchEsc(handle)}">
        <div class="docs-search-result-main">
          <div class="docs-search-result-title">
            <span>${_docsSearchEsc(r.title || path || 'Untitled')}</span>
            ${scoreText ? `<span class="docs-search-pill">${_docsSearchEsc(scoreText)}</span>` : ''}
          </div>
          <div class="docs-search-result-path">${_docsSearchEsc(path)}${chunk ? ` · ${_docsSearchEsc(chunk)}` : ''}</div>
          <p class="docs-search-snippet">${_docsSearchEsc(r.snippet || '')}</p>
          <div class="docs-search-meta">
            <span class="docs-search-pill ${r.openable ? 'ok' : ''}">${r.openable ? 'openable' : _docsSearchEsc(r.register_hint || 'not registered')}</span>
            <span class="docs-search-pill">${_docsSearchEsc(sources)}</span>
            ${Array.isArray(r.keyword_terms) && r.keyword_terms.length ? `<span class="docs-search-pill">${_docsSearchEsc(r.keyword_terms.join(', '))}</span>` : ''}
          </div>
        </div>
        <div class="docs-search-actions">
          ${action}
        </div>
      </article>`;
  }).join('');
  _docsSearchRenderStatus(`${results.length} result${results.length === 1 ? '' : 's'}`, false);
}

async function _docsSearchRun() {
  _docsSearchReadForm();
  const q = _docsSearchState.query;
  if (!q) {
    _docsSearchRenderStatus('Enter a search query.', true);
    return;
  }
  const btn = document.getElementById('docs-search-submit');
  if (btn) btn.disabled = true;
  _docsSearchRenderStatus('Searching...', false);
  try {
    const body = {
      query: q,
      mode: _docsSearchState.mode,
      top_k: _docsSearchState.top_k,
      rerank: _docsSearchState.rerank,
    };
    const r = await apiFetch('/api/v1/docs/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
    _docsSearchState.results = Array.isArray(data.results) ? data.results : [];
    _docsSearchState.selectedHandle = _docsSearchState.results[0]?.handle ? String(_docsSearchState.results[0].handle) : null;
    _docsSearchState.searchedAt = new Date().toISOString();
    _docsSearchState.lastError = '';
    _docsSearchSaveState();
    _docsSearchRender();
  } catch (e) {
    _docsSearchState.lastError = e.message || String(e);
    _docsSearchRenderStatus(`Search failed: ${_docsSearchState.lastError}`, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function _docsSearchFindResult(handle) {
  return (_docsSearchState.results || []).find(r => String(r.handle ?? '') === String(handle));
}

async function _docsSearchOpen(handle) {
  const result = _docsSearchFindResult(handle);
  if (!result || !result.openable || !result.doc_id) return;
  _docsSearchState.selectedHandle = String(handle);
  _docsSearchSaveState();
  HubModal.close(document.getElementById('docs-search-modal'));
  if (!_docsAll.find(d => d.doc_id === result.doc_id)) await loadDocs();
  const ok = await docsSelectDoc(result.doc_id);
  if (ok) {
    const terms = _docsSearchTerms(result);
    window.setTimeout(() => _docsSearchHighlightTerms(terms), 80);
  }
}

async function _docsSearchRegister(handle) {
  const result = _docsSearchFindResult(handle);
  if (!result || !result.register_path) return;
  const btn = Array.from(document.querySelectorAll('[data-docs-search-action="register"]'))
    .find(el => String(el.dataset.handle || '') === String(handle));
  if (btn) btn.disabled = true;
  try {
    const body = {
      label: result.title || result.register_path.split('/').pop().replace(/\.[^.]+$/, ''),
      description: result.snippet || null,
      tags: 'menu',
      path: result.register_path,
      sort_order: _docsAll.length * 10,
      group_id: null,
    };
    const r = await apiFetch('/api/v1/docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
    await loadDocs();
    result.doc_registered = true;
    result.doc_id = data.doc_id;
    result.viewer_path = data.path;
    result.openable = true;
    result.register_hint = 'registered';
    _docsSearchSaveState();
    _docsSearchRender();
    await _docsSearchOpen(handle);
  } catch (e) {
    _docsSearchRenderStatus(`Add failed: ${e.message}`, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function _docsSearchHighlightTerms(terms) {
  const preview = document.getElementById('docs-preview');
  if (!preview || preview.style.display === 'none') return;
  const clean = Array.from(new Set((terms || [])
    .map(t => String(t || '').trim())
    .filter(t => t.length >= 3)))
    .slice(0, 8);
  if (!clean.length) return;
  const pattern = new RegExp(`(${clean.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !pattern.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
      pattern.lastIndex = 0;
      if (node.parentElement && ['CODE', 'PRE', 'SCRIPT', 'STYLE', 'MARK'].includes(node.parentElement.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(node => {
    const frag = document.createDocumentFragment();
    let last = 0;
    const text = node.nodeValue;
    text.replace(pattern, (match, _term, offset) => {
      if (offset > last) frag.appendChild(document.createTextNode(text.slice(last, offset)));
      const mark = document.createElement('mark');
      mark.className = 'docs-search-highlight';
      mark.textContent = match;
      frag.appendChild(mark);
      last = offset + match.length;
      return match;
    });
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('docs-search-form');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      _docsSearchRun();
    });
  }
  ['docs-search-mode', 'docs-search-top-k', 'docs-search-rerank'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
      _docsSearchReadForm();
      _docsSearchSaveState();
    });
  });
  const list = document.getElementById('docs-search-results');
  if (list) {
    list.addEventListener('click', e => {
      const actionBtn = e.target.closest('[data-docs-search-action]');
      if (!actionBtn) return;
      const handle = actionBtn.dataset.handle;
      if (actionBtn.dataset.docsSearchAction === 'open') _docsSearchOpen(handle);
      if (actionBtn.dataset.docsSearchAction === 'register') _docsSearchRegister(handle);
    });
  }
});
