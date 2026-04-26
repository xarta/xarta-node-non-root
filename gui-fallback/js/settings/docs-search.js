/* ── Docs search modal ───────────────────────────────────────────────────── */

const _DOCS_SEARCH_LS_KEY = 'bp_docs_search_v1';
let _docsSearchState = {
  query: '',
  mode: 'hybrid',
  top_k: 8,
  rerank: true,
  results: [],
  expandedDocs: {},
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
        results: Array.isArray(raw.results) ? raw.results.slice(0, 120) : [],
        expandedDocs: raw.expandedDocs && typeof raw.expandedDocs === 'object' ? raw.expandedDocs : {},
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
    expandedDocs: _docsSearchState.expandedDocs,
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

function _docsSearchDocKey(result) {
  const id = result?.doc_id ? `doc:${result.doc_id}` : '';
  const path = result?.viewer_path || result?.register_path || result?.doc_path || '';
  return id || `path:${String(path || '').toLowerCase()}`;
}

function _docsSearchScore(result) {
  return result?.rerank_score ?? result?.score ?? result?.rrf_score ?? result?.vector_score ?? result?.keyword_score;
}

function _docsSearchScoreText(result) {
  const score = _docsSearchScore(result);
  return typeof score === 'number' ? score.toFixed(3) : '';
}

function _docsSearchGroups() {
  const map = new Map();
  const order = [];
  (_docsSearchState.results || []).forEach((result, idx) => {
    if (!result || typeof result !== 'object') return;
    const key = _docsSearchDocKey(result);
    if (!key || key === 'path:') return;
    if (!map.has(key)) {
      const path = result.viewer_path || result.register_path || result.doc_path || '';
      map.set(key, {
        key,
        firstIndex: idx,
        representative: result,
        chunks: [],
        title: result.title || path || 'Untitled',
        path,
      });
      order.push(key);
    }
    const group = map.get(key);
    group.chunks.push({
      ...result,
      _handle: String(result.handle ?? `${result.doc_path}:${result.chunk_index}:${idx}`),
    });
  });
  return order.slice(0, _docsSearchState.top_k).map(key => map.get(key));
}

function _docsSearchChunkMeta(chunk) {
  const parts = [];
  if (chunk.chunk_index !== null && chunk.chunk_index !== undefined) parts.push(`chunk ${chunk.chunk_index}`);
  const score = _docsSearchScoreText(chunk);
  if (score) parts.push(score);
  const sources = Array.isArray(chunk.match_sources) && chunk.match_sources.length ? chunk.match_sources.join('+') : '';
  if (sources) parts.push(sources);
  return parts.join(' · ');
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

function openDocsSearchModal(options = {}) {
  _docsSearchLoadState();
  if (typeof options.query === 'string' && options.query.trim()) {
    _docsSearchState.query = options.query.trim();
  }
  if (['vector', 'hybrid', 'keyword'].includes(options.mode)) {
    _docsSearchState.mode = options.mode;
  }
  _docsSearchSetForm();
  _docsSearchRender();
  const modal = document.getElementById('docs-search-modal');
  if (!modal) return;
  HubModal.open(modal, {
    onOpen: () => {
      if (options.focusQuery === false) return;
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
  const groups = _docsSearchGroups();
  if (!groups.length) {
    list.innerHTML = `<div class="docs-search-empty">No results yet.</div>`;
    _docsSearchRenderStatus(_docsSearchState.searchedAt ? 'No matches returned.' : '', false);
    return;
  }
  list.innerHTML = groups.map(group => {
    const r = group.representative;
    const selected = String(_docsSearchState.selectedHandle || '') === group.key;
    const sources = Array.from(new Set(group.chunks.flatMap(chunk => (
      Array.isArray(chunk.match_sources) && chunk.match_sources.length ? chunk.match_sources : [_docsSearchState.mode]
    )))).join('+');
    const scoreText = _docsSearchScoreText(r);
    const expanded = _docsSearchState.expandedDocs?.[group.key] === true;
    const disabled = !r.openable;
    const action = r.openable
      ? `<button class="hub-modal-btn" type="button" data-docs-search-action="open" data-doc-key="${_docsSearchEsc(group.key)}">Open</button>`
      : (r.register_path && r.file_exists)
        ? `<button class="hub-modal-btn secondary" type="button" data-docs-search-action="register" data-doc-key="${_docsSearchEsc(group.key)}">Add</button>`
        : `<button class="hub-modal-btn secondary" type="button" disabled>Stale</button>`;
    const chunksHtml = expanded ? `
      <div class="docs-search-chunks">
        ${group.chunks.map(chunk => `
          <section class="docs-search-chunk" data-handle="${_docsSearchEsc(chunk._handle)}">
            <div class="docs-search-chunk-title">
              <span>${_docsSearchEsc(_docsSearchChunkMeta(chunk) || 'chunk')}</span>
            </div>
            <p class="docs-search-snippet">${_docsSearchEsc(chunk.snippet || '')}</p>
          </section>
        `).join('')}
      </div>` : '';
    return `
      <article class="docs-search-result docs-search-document ${selected ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''} ${expanded ? 'is-expanded' : 'is-collapsed'}" data-doc-key="${_docsSearchEsc(group.key)}">
        <div class="docs-search-result-main">
          <div class="docs-search-result-title">
            <span>${_docsSearchEsc(group.title)}</span>
            ${scoreText ? `<span class="docs-search-pill">${_docsSearchEsc(scoreText)}</span>` : ''}
          </div>
          <div class="docs-search-result-path">${_docsSearchEsc(group.path)}</div>
          <p class="docs-search-snippet">${_docsSearchEsc(r.snippet || '')}</p>
          <div class="docs-search-meta">
            <span class="docs-search-pill ${r.openable ? 'ok' : ''}">${r.openable ? 'openable' : _docsSearchEsc(r.register_hint || 'not registered')}</span>
            <span class="docs-search-pill">${group.chunks.length} chunk${group.chunks.length === 1 ? '' : 's'}</span>
            <span class="docs-search-pill">${_docsSearchEsc(sources)}</span>
            ${Array.isArray(r.keyword_terms) && r.keyword_terms.length ? `<span class="docs-search-pill">${_docsSearchEsc(r.keyword_terms.join(', '))}</span>` : ''}
          </div>
          ${chunksHtml}
        </div>
        <div class="docs-search-actions">
          <button class="hub-modal-btn secondary" type="button" data-docs-search-action="toggle-doc" data-doc-key="${_docsSearchEsc(group.key)}">${expanded ? 'Collapse' : 'Expand'}</button>
          ${action}
        </div>
      </article>`;
  }).join('');
  _docsSearchRenderStatus(`${groups.length} document${groups.length === 1 ? '' : 's'} from ${results.length} chunk candidate${results.length === 1 ? '' : 's'}`, false);
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
    _docsSearchState.expandedDocs = {};
    const groups = _docsSearchGroups();
    groups.forEach(group => {
      _docsSearchState.expandedDocs[group.key] = false;
    });
    _docsSearchState.selectedHandle = groups[0]?.key || null;
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

function _docsSearchFindGroup(docKey) {
  return _docsSearchGroups().find(group => String(group.key) === String(docKey));
}

async function _docsSearchOpen(docKey) {
  const group = _docsSearchFindGroup(docKey);
  const result = group?.representative;
  if (!result || !result.openable || !result.doc_id) return;
  _docsSearchState.selectedHandle = String(docKey);
  _docsSearchSaveState();
  HubModal.close(document.getElementById('docs-search-modal'));
  if (!_docsAll.find(d => d.doc_id === result.doc_id)) await loadDocs();
  const ok = await docsSelectDoc(result.doc_id);
  if (ok) {
    const terms = _docsSearchTerms(result);
    window.setTimeout(() => _docsSearchHighlightTerms(terms), 80);
  }
}

async function _docsSearchRegister(docKey) {
  const group = _docsSearchFindGroup(docKey);
  const result = group?.representative;
  if (!result || !result.register_path) return;
  const btn = Array.from(document.querySelectorAll('[data-docs-search-action="register"]'))
    .find(el => String(el.dataset.docKey || '') === String(docKey));
  if (btn) btn.disabled = true;
  try {
    const body = {
      label: result.title || result.register_path.split('/').pop().replace(/\.[^.]+$/, ''),
      description: result.snippet || null,
      tags: null,
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
    const newDocKey = `doc:${data.doc_id}`;
    (_docsSearchState.results || []).forEach(item => {
      if (_docsSearchDocKey(item) !== docKey) return;
      item.doc_registered = true;
      item.doc_id = data.doc_id;
      item.viewer_path = data.path;
      item.openable = true;
      item.register_hint = 'registered';
    });
    _docsSearchState.expandedDocs = _docsSearchState.expandedDocs || {};
    _docsSearchState.expandedDocs[newDocKey] = _docsSearchState.expandedDocs[docKey] !== false;
    delete _docsSearchState.expandedDocs[docKey];
    _docsSearchState.selectedHandle = newDocKey;
    _docsSearchSaveState();
    _docsSearchRender();
    await _docsSearchOpen(newDocKey);
  } catch (e) {
    _docsSearchRenderStatus(`Add failed: ${e.message}`, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function _docsSearchToggleDoc(docKey) {
  _docsSearchState.expandedDocs = _docsSearchState.expandedDocs || {};
  _docsSearchState.expandedDocs[docKey] = _docsSearchState.expandedDocs[docKey] !== true;
  _docsSearchSaveState();
  _docsSearchRender();
}

function _docsSearchSetAllExpanded(expanded, openAfter = false) {
  _docsSearchLoadState();
  const groups = _docsSearchGroups();
  _docsSearchState.expandedDocs = {};
  groups.forEach(group => {
    _docsSearchState.expandedDocs[group.key] = !!expanded;
  });
  _docsSearchSaveState();
  const modal = document.getElementById('docs-search-modal');
  if (openAfter && modal && !modal.open) {
    openDocsSearchModal({ focusQuery: false });
  } else {
    _docsSearchRender();
  }
}

function docsSearchExpandAll() {
  _docsSearchSetAllExpanded(true, true);
}

function docsSearchCollapseAll() {
  _docsSearchSetAllExpanded(false, true);
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
      const docKey = actionBtn.dataset.docKey;
      if (actionBtn.dataset.docsSearchAction === 'open') _docsSearchOpen(docKey);
      if (actionBtn.dataset.docsSearchAction === 'register') _docsSearchRegister(docKey);
      if (actionBtn.dataset.docsSearchAction === 'toggle-doc') _docsSearchToggleDoc(docKey);
    });
  }
});
