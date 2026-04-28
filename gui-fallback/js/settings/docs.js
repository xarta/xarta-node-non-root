/* ── Docs tab ─────────────────────────────────────────────────────────────── */

let _docsAll       = [];   // array of DocOut records
let _docsActiveId  = null; // currently open doc_id
let _docsDirty     = false; // unsaved changes in the textarea
let _docsPreview   = false; // preview mode active for current doc (kept in sync with _docsViewModes)
const _docsViewModes = {}; // doc_id → true (preview) | false (edit); default preview on first open

function _docsSchedulePaneSize() {
  if (window.BodyShade && typeof window.BodyShade.scheduleSizeFillTable === 'function') {
    window.BodyShade.scheduleSizeFillTable();
  }
}

// ── List view state ──────────────────────────────────────────────────────────
let _docsGroups    = [];   // array of DocGroupOut records
let _docsDragId    = null;  // doc_id currently being dragged
let _groupDragId   = null;  // group_id currently being dragged
const _docsExpandedGroups = new Set(); // group key -> expanded in the list view; empty = collapsed by default
let _docsCurrentModalMode = 'new'; // 'new' | 'edit'
let _docsGroupModalMode = 'add'; // 'add' | 'edit'
let _docsEditingGroupId = null;
let _docsEditingGroupName = '';
let _docsFolderTreeExplainTtsState = 'IDLE';
let _docsFolderTreeExplainTtsRunId = 0;
let _docsFolderTreeExplainTtsClickTimer = null;
let _docsFolderTreeExplainTtsLastClickAt = 0;
let _docsFolderTreeExplainTtsText = '';
const _DOCS_FOLDER_TREE_EXPLAIN_TTS_DOUBLE_CLICK_MS = 260;
let _docsFolderTreeRequestSeq = 0;
let _docsFolderTreeStatusCache = null;
const _DOCS_FOLDER_TREE_SEARCH_CACHE_KEY = 'blueprints.docs.folderTree.lastSearch.v1';
let _docsFolderTreeSearchCache = _docsFolderTreeLoadSearchCache();
let _docsFolderTreeState = {
  groupId: null,
  title: 'Docs Folder',
  path: null,
  parentPath: null,
  query: '',
  mode: 'keyword',
  lastTree: null,
  searchResults: null,
  explanation: null,
};

function _docsFolderTreeLoadSearchCache() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(_DOCS_FOLDER_TREE_SEARCH_CACHE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object') return { query: '', mode: 'keyword' };
    const mode = ['keyword', 'vector', 'hybrid'].includes(parsed.mode) ? parsed.mode : 'keyword';
    return { query: String(parsed.query || '').trim(), mode };
  } catch (_) {
    return { query: '', mode: 'keyword' };
  }
}

function _docsFolderTreeSaveSearchCache(query, mode) {
  const cleanQuery = String(query || '').trim();
  const cleanMode = ['keyword', 'vector', 'hybrid'].includes(mode) ? mode : 'keyword';
  _docsFolderTreeSearchCache = { query: cleanQuery, mode: cleanMode };
  try {
    sessionStorage.setItem(_DOCS_FOLDER_TREE_SEARCH_CACHE_KEY, JSON.stringify(_docsFolderTreeSearchCache));
  } catch (_) {
    // Storage can be unavailable in hardened/private browser contexts.
  }
}

// ── Load + Sidebar ───────────────────────────────────────────────────────────

async function _docsLoadGroups() {
  try {
    const r = await apiFetch('/api/v1/doc-groups');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _docsGroups = await r.json();
  } catch (e) {
    console.error('doc-groups: failed to load', e);
    _docsGroups = [];
  }
}

async function loadDocs() {
  if (typeof docsHistInit === 'function') docsHistInit(_docsActiveId);
  await Promise.all([
    apiFetch('/api/v1/docs').then(r => r.ok ? r.json() : []).then(d => { _docsAll = d; }).catch(() => { _docsAll = []; }),
    _docsLoadGroups(),
  ]);
  _docsRenderSidebar();
  // Re-open the active doc if we had one
  if (_docsActiveId && _docsAll.find(d => d.doc_id === _docsActiveId)) {
    _docsShowPane(_docsActiveId);
  } else if (_docsActiveId) {
    // Active doc was deleted — reset
    _docsActiveId = null;
    _docsHidePane();
  }
  // Restore the most recent history doc when opening Docs tab on a fresh UI state.
  if (!_docsActiveId && typeof docsHistCurrent === 'function') {
    const histDocId = docsHistCurrent();
    if (histDocId && _docsAll.find(d => d.doc_id === histDocId)) {
      _docsActiveId = histDocId;
      if (!(histDocId in _docsViewModes)) _docsViewModes[histDocId] = true;
      _docsPreview = _docsViewModes[histDocId];
      _docsRenderSidebar();
      await _docsOpenDoc(histDocId);
    }
  }
  // Refresh list view if it's currently the active tab
  if (document.getElementById('tab-docs-list')?.classList.contains('active')) _docsRenderList();
  _docsUpdateHistoryButtons();
}

function _docsLabelById(docId) {
  const doc = _docsAll.find(d => d.doc_id === docId);
  return doc ? doc.label : null;
}

function _docsUpdateHistoryButtons() {
  const backBtn = document.getElementById('docs-back-btn');
  const fwdBtn = document.getElementById('docs-forward-btn');
  const hint = document.getElementById('docs-history-hint');
  if (!backBtn || !fwdBtn || !hint) return;

  const canBack = typeof docsHistCanBack === 'function' ? docsHistCanBack() : false;
  const canFwd = typeof docsHistCanForward === 'function' ? docsHistCanForward() : false;
  const backId = typeof docsHistPeekBack === 'function' ? docsHistPeekBack() : null;
  const fwdId = typeof docsHistPeekForward === 'function' ? docsHistPeekForward() : null;
  const stats = typeof docsHistStats === 'function' ? docsHistStats() : { back: 0, forward: 0 };

  backBtn.disabled = !canBack;
  fwdBtn.disabled = !canFwd;
  backBtn.title = canBack ? `Back to ${_docsLabelById(backId) || 'previous doc'}` : 'No previous doc in history';
  fwdBtn.title = canFwd ? `Forward to ${_docsLabelById(fwdId) || 'next doc'}` : 'No forward doc in history';

  const parts = [];
  if (canBack) parts.push(`Back: ${_docsLabelById(backId) || 'doc'}`);
  if (canFwd) parts.push(`Forward: ${_docsLabelById(fwdId) || 'doc'}`);
  const countText = `(${stats.back}/${stats.forward})`;
  hint.textContent = parts.length ? `${parts.join(' • ')} ${countText}` : `History idle ${countText}`;
}

function _docsRenderSidebar() {
  const sidebar = document.getElementById('docs-sidebar');
  // Show items tagged with "menu", sorted by sort_order then label
  const menuDocs = _docsAll
    .filter(d => (d.tags || '').split(',').map(t => t.trim()).includes('menu'))
    .sort((a, b) => (a.sort_order - b.sort_order) || a.label.localeCompare(b.label));
  sidebar.innerHTML = '';
  if (!menuDocs.length) {
    sidebar.innerHTML = '<span class="bp-font-role-docs-markdown" style="font-size:12px;color:var(--text-dim)">No docs tagged "menu".</span>';
    return;
  }
  menuDocs.forEach(doc => {
    const btn = document.createElement('button');
    const isActive = doc.doc_id === _docsActiveId;
    btn.className = 'secondary bp-font-role-docs-markdown' + (isActive ? ' active' : '');
    btn.style.cssText = 'padding:4px 12px;font-size:13px;white-space:nowrap';
    if (isActive) {
      btn.style.background = 'var(--accent)';
      btn.style.color = '#fff';
      btn.style.borderColor = 'var(--accent)';
    }
    btn.title = doc.description || doc.label;
    btn.textContent = doc.label;
    btn.onclick = () => docsSelectDoc(doc.doc_id);
    sidebar.appendChild(btn);
  });
}

// ── Selection / auto-save ────────────────────────────────────────────────────

async function docsSelectDoc(docId, opts = {}) {
  const fromHistory = !!opts.fromHistory;
  const force = !!opts.force;
  if (!force && docId === _docsActiveId) {
    _docsUpdateHistoryButtons();
    return true; // already open
  }
  // Auto-save dirty content before switching
  if (_docsDirty && _docsActiveId) {
    await docsSave(true /* silent */);
  }
  _docsActiveId = docId;
  // Default to preview on first open; restore last-used mode on revisits
  if (!(docId in _docsViewModes)) _docsViewModes[docId] = true;
  _docsPreview = _docsViewModes[docId];
  // Body-shade correction for in-tab doc navigation:
  // DOM elements above the handle (_docsRenderSidebar + _docsHidePane) are
  // about to change height. If the shade is held up its stale translateY
  // would leave a gap or push the handle off-screen.
  //
  // Strategy: record whether shade was up, snap it down *instantly*
  // (imperceptible — same paint frame, transition suppressed), let the DOM
  // mutations settle during the fetch, then animate it back up once the new
  // document has rendered. The user sees one smooth upward motion per navigation.
  const wasShadeUp = document.body.classList.contains('shade-is-up');
  if (wasShadeUp && window.BodyShade && typeof window.BodyShade.snapDown === 'function') {
    window.BodyShade.snapDown({ instant: true });
  }
  _docsRenderSidebar();
  const ok = await _docsOpenDoc(docId);
  // Re-raise after render. Only if the load succeeded — on error the shade
  // stays down so the user can see the error message.
  if (wasShadeUp && ok && window.BodyShade && typeof window.BodyShade.snapUp === 'function') {
    window.BodyShade.snapUp();
  }
  if (ok && !fromHistory && typeof docsHistRecordDirect === 'function') {
    docsHistRecordDirect(docId);
  }
  _docsUpdateHistoryButtons();
  return ok;
}

async function _docsOpenDoc(docId) {
  const errEl = document.getElementById('docs-error');
  errEl.hidden = true;
  _docsHidePane();
  try {
    const r = await apiFetch(`/api/v1/docs/${docId}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const doc = await r.json();
    _docsFillPane(doc);
    _docsDirty = false;
    return true;
  } catch (e) {
    errEl.textContent = `Failed to load document: ${e.message}`;
    errEl.hidden = false;
    return false;
  }
}

function docsHighlightTerms(terms) {
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

async function docsHistoryBack() {
  if (!(typeof docsHistStepBack === 'function')) return;
  const target = docsHistStepBack();
  if (!target) {
    _docsUpdateHistoryButtons();
    return;
  }
  const ok = await docsSelectDoc(target, { fromHistory: true, force: true });
  if (!ok && typeof docsHistRemoveDoc === 'function') {
    docsHistRemoveDoc(target);
    _docsUpdateHistoryButtons();
  }
}

async function docsHistoryForward() {
  if (!(typeof docsHistStepForward === 'function')) return;
  const target = docsHistStepForward();
  if (!target) {
    _docsUpdateHistoryButtons();
    return;
  }
  const ok = await docsSelectDoc(target, { fromHistory: true, force: true });
  if (!ok && typeof docsHistRemoveDoc === 'function') {
    docsHistRemoveDoc(target);
    _docsUpdateHistoryButtons();
  }
}

function _docsFillPane(doc) {
  document.getElementById('docs-active-label').textContent = doc.label;
  document.getElementById('docs-active-desc').textContent  = doc.description || '';
  const editor  = document.getElementById('docs-editor');
  const preview = document.getElementById('docs-preview');
  editor.value = doc.content || '';
  document.getElementById('docs-status').hidden = true;
  // Apply stored view mode (default: preview)
  if (_docsPreview) {
    // Render preview immediately
    preview.innerHTML = _mdToHtml(editor.value);
    _docsResolvePrevImgs(preview);
    editor.style.display  = 'none';
    preview.style.display = 'block';
    const pb1 = document.getElementById('docs-preview-btn');
    if (pb1) pb1.textContent = '✏ Edit';
  } else {
    editor.style.display  = 'block';
    preview.style.display = 'none';
    const pb2 = document.getElementById('docs-preview-btn');
    if (pb2) pb2.textContent = '👁 Preview';
  }
  // Track changes
  editor.oninput = () => { _docsDirty = true; };
  _docsSchedulePaneSize();
}

function _docsShowPane(docId) {
  // Just refresh the pane header without re-fetching content
  const doc = _docsAll.find(d => d.doc_id === docId);
  if (!doc) return;
  document.getElementById('docs-active-label').textContent = doc.label;
  document.getElementById('docs-active-desc').textContent  = doc.description || '';
}

function _docsHidePane() {
  document.getElementById('docs-active-label').textContent = '';
  document.getElementById('docs-active-desc').textContent  = '';
  document.getElementById('docs-editor').value = '';
  document.getElementById('docs-preview').innerHTML = '';
  document.getElementById('docs-preview').style.display = 'none';
  document.getElementById('docs-editor').style.display = 'block';
  // Note: do NOT reset _docsPreview here — per-doc view mode is managed by _docsViewModes
  const pb = document.getElementById('docs-preview-btn');
  if (pb) pb.textContent = '👁 Preview';
  // Note: do NOT clear _docsViewModes here — keep per-doc memory across hide/show cycles
  _docsSchedulePaneSize();
}

// ── Save ─────────────────────────────────────────────────────────────────────

async function docsSave(silent = false) {
  if (!_docsActiveId) return;
  const btn    = document.getElementById('docs-save-btn');
  const status = document.getElementById('docs-status');
  const editor = document.getElementById('docs-editor');
  if (btn) btn.disabled = true;
  if (!silent) { status.hidden = true; }
  try {
    const r = await apiFetch(`/api/v1/docs/${_docsActiveId}/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editor.value }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _docsDirty = false;
    if (!silent) {
      status.textContent = '\u2713 Saved';
      status.style.color = 'var(--accent)';
      status.hidden = false;
      setTimeout(() => { status.hidden = true; }, 3000);
    }
  } catch (e) {
    if (!silent) {
      status.textContent = `\u2717 Save failed: ${e.message}`;
      status.style.color = '#f87171';
      status.hidden = false;
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function docsRefreshContent() {
  if (!_docsActiveId) return;
  if (_docsDirty) {
    const ok = await HubDialogs.confirm({
      tone: 'warning',
      badge: 'WARN',
      title: 'Discard unsaved changes?',
      message: 'You have unsaved changes. Discard them and reload from disk?',
      confirmText: 'Discard changes',
      cancelText: 'Keep editing',
    });
    if (!ok) return;
  }
  _docsDirty = false;
  await _docsOpenDoc(_docsActiveId);
}

// ── Image blob URL cache (shared with docs-images.js) ────────────────────────

const _docsImgCache = {};

async function _docsImgBlobUrl(imageId) {
  if (_docsImgCache[imageId]) return _docsImgCache[imageId];
  try {
    const r = await apiFetch(`/api/v1/doc-images/${imageId}/file`);
    if (!r.ok) return null;
    const blob = await r.blob();
    _docsImgCache[imageId] = URL.createObjectURL(blob);
    return _docsImgCache[imageId];
  } catch { return null; }
}

// ── Preview ───────────────────────────────────────────────────────────────────

async function docsTogglePreview() {
  _docsPreview = !_docsPreview;
  // Remember the choice for this doc
  if (_docsActiveId) _docsViewModes[_docsActiveId] = _docsPreview;
  const btn     = document.getElementById('docs-preview-btn');
  const editor  = document.getElementById('docs-editor');
  const preview = document.getElementById('docs-preview');
  if (_docsPreview) {
    await _docsRenderPreview();
    editor.style.display  = 'none';
    preview.style.display = 'block';
    if (btn) btn.textContent = '✏ Edit';
  } else {
    preview.style.display = 'none';
    editor.style.display  = 'block';
    if (btn) btn.textContent = '👁 Preview';
  }
  _docsSchedulePaneSize();
}

async function _docsRenderPreview() {
  const preview = document.getElementById('docs-preview');
  preview.innerHTML = _mdToHtml(document.getElementById('docs-editor').value);
  await _docsResolvePrevImgs(preview);
}

async function _docsResolvePrevImgs(preview) {
  for (const img of preview.querySelectorAll('img[data-doc-img]')) {
    const url = await _docsImgBlobUrl(img.dataset.docImg);
    if (url) img.src = url;
  }
}

// ── New Doc modal ─────────────────────────────────────────────────────────────

function _docsPopulateGroupSelect(currentGroupId, selectId = 'docs-modal-group') {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '<option value="">— Undefined Group —</option>';
  _docsGroups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.group_id;
    opt.textContent = g.name;
    if (g.group_id === currentGroupId) opt.selected = true;
    sel.appendChild(opt);
  });
}

function openNewDocModal() {
  _docsModalMode('new');
  document.getElementById('docs-modal-label').value = '';
  document.getElementById('docs-modal-desc').value  = '';
  document.getElementById('docs-modal-tags').value  = 'menu';
  document.getElementById('docs-modal-path').value  = 'docs/';
  document.getElementById('docs-modal-order').value = String(_docsAll.length * 10);
  document.getElementById('docs-modal-initial').value = '';
  _docsPopulateGroupSelect(null);
  HubModal.open(document.getElementById('docs-modal'));
  setTimeout(() => document.getElementById('docs-modal-label').focus(), 50);
}

// ── Edit doc metadata modal ───────────────────────────────────────────────────

function openEditDocModal() {
  if (!_docsActiveId) return;
  const doc = _docsAll.find(d => d.doc_id === _docsActiveId);
  if (!doc) return;
  _docsModalMode('edit');
  document.getElementById('docs-modal-label').value = doc.label;
  document.getElementById('docs-modal-desc').value  = doc.description || '';
  document.getElementById('docs-modal-tags').value  = doc.tags || '';
  document.getElementById('docs-modal-path').value  = doc.path;
  document.getElementById('docs-modal-order').value = String(doc.sort_order);
  document.getElementById('docs-modal-initial').value = '';
  _docsPopulateGroupSelect(doc.group_id || null);
  HubModal.open(document.getElementById('docs-modal'));
  setTimeout(() => document.getElementById('docs-modal-label').focus(), 50);
}

function _docsModalMode(mode) {
  _docsCurrentModalMode = mode;
  const badge   = document.getElementById('docs-modal-badge');
  const title   = document.getElementById('docs-modal-title');
  const initRow = document.getElementById('docs-modal-init-row');
  const submit  = document.getElementById('docs-modal-submit');
  if (mode === 'new') {
    if (badge) badge.textContent = 'NEW';
    title.textContent     = 'New Document';
    initRow.style.display = '';
    submit.textContent    = 'Create';
  } else {
    if (badge) badge.textContent = 'EDIT';
    title.textContent     = 'Edit Document Metadata';
    initRow.style.display = 'none';
    submit.textContent    = 'Save';
  }
  document.getElementById('docs-modal-error').textContent = '';
}

function _docsResetGroupModal() {
  const input = document.getElementById('docs-group-modal-name');
  const errEl = document.getElementById('docs-group-modal-error');
  const submit = document.getElementById('docs-group-modal-submit');
  if (input) input.value = '';
  if (errEl) errEl.textContent = '';
  if (submit) submit.disabled = false;
}

function _docsOpenGroupModal(mode, groupId = null, currentName = '') {
  const modal = document.getElementById('docs-group-modal');
  const badge = document.getElementById('docs-group-modal-badge');
  const title = document.getElementById('docs-group-modal-title-text');
  const input = document.getElementById('docs-group-modal-name');
  const submit = document.getElementById('docs-group-modal-submit');
  const errEl = document.getElementById('docs-group-modal-error');
  if (!modal || !title || !input || !submit || !errEl) return;

  _docsGroupModalMode = mode;
  _docsEditingGroupId = groupId;
  _docsEditingGroupName = currentName;

  if (badge) badge.textContent = mode === 'add' ? 'ADD' : 'EDIT';
  title.textContent = 'Document Group';
  submit.textContent = mode === 'add' ? 'Create' : 'Save';
  input.value = currentName;
  errEl.textContent = '';
  submit.disabled = false;

  HubModal.open(modal, {
    onOpen: () => {
      input.focus();
      input.select();
    },
    onClose: () => {
      _docsResetGroupModal();
    },
  });
}

async function _docsModalSubmit() {
  const label   = document.getElementById('docs-modal-label').value.trim();
  const desc    = document.getElementById('docs-modal-desc').value.trim();
  const tags    = document.getElementById('docs-modal-tags').value.trim();
  const path    = document.getElementById('docs-modal-path').value.trim();
  const order   = parseInt(document.getElementById('docs-modal-order').value, 10) || 0;
  const initial = document.getElementById('docs-modal-initial').value;
  const groupId = document.getElementById('docs-modal-group')?.value || '';
  const errEl   = document.getElementById('docs-modal-error');
  if (!label) { errEl.textContent = 'Label is required.'; return; }
  if (!path)  { errEl.textContent = 'File path is required.'; return; }
  const submit = document.getElementById('docs-modal-submit');
  submit.disabled = true;
  try {
    const body = { label, description: desc || null, tags: tags || null, path, sort_order: order, group_id: groupId || null };
    if (initial) body.initial_content = initial;
    const r = await apiFetch('/api/v1/docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || `HTTP ${r.status}`); }
    const created = await r.json();
    HubModal.close(document.getElementById('docs-modal'));
    await loadDocs();
    docsSelectDoc(created.doc_id);
  } catch (e) {
    errEl.textContent = `Error: ${e.message}`;
  } finally {
    submit.disabled = false;
  }
}

async function _docsModalSubmitEdit() {
  const label   = document.getElementById('docs-modal-label').value.trim();
  const desc    = document.getElementById('docs-modal-desc').value.trim();
  const tags    = document.getElementById('docs-modal-tags').value.trim();
  const path    = document.getElementById('docs-modal-path').value.trim();
  const order   = parseInt(document.getElementById('docs-modal-order').value, 10) || 0;
  const groupId = document.getElementById('docs-modal-group')?.value ?? '';
  const errEl   = document.getElementById('docs-modal-error');
  if (!label) { errEl.textContent = 'Label is required.'; return; }
  const submit = document.getElementById('docs-modal-submit');
  submit.disabled = true;
  try {
    const r = await apiFetch(`/api/v1/docs/${_docsActiveId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, description: desc || null, tags: tags, path: path || null, sort_order: order, group_id: groupId }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || `HTTP ${r.status}`); }
    HubModal.close(document.getElementById('docs-modal'));
    await loadDocs();
  } catch (e) {
    errEl.textContent = `Error: ${e.message}`;
  } finally {
    submit.disabled = false;
  }
}

// ── Delete confirmation ───────────────────────────────────────────────────────

function openDeleteDocModal() {
  if (!_docsActiveId) return;
  const doc = _docsAll.find(d => d.doc_id === _docsActiveId);
  if (!doc) return;
  document.getElementById('docs-delete-name').textContent = doc.label;
  document.getElementById('docs-delete-path').textContent = doc.path;
  document.getElementById('docs-delete-file-chk').checked = false;
  document.getElementById('docs-delete-error').textContent = '';
  const modal = document.getElementById('docs-delete-modal');
  if (typeof HubModal !== 'undefined' && modal) {
    HubModal.open(modal);
  } else if (modal && !modal.open) {
    modal.showModal();
  }
}

async function submitDeleteDoc() {
  const deletingDocId = _docsActiveId;
  const deleteFile = document.getElementById('docs-delete-file-chk').checked;
  const errEl = document.getElementById('docs-delete-error');
  const btn   = document.getElementById('docs-delete-confirm-btn');
  btn.disabled = true;
  try {
    const url = `/api/v1/docs/${_docsActiveId}${deleteFile ? '?delete_file=true' : ''}`;
    const r = await apiFetch(url, { method: 'DELETE' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const modal = document.getElementById('docs-delete-modal');
    if (typeof HubModal !== 'undefined' && modal) {
      HubModal.close(modal);
    } else if (modal && modal.open) {
      modal.close();
    }
    if (typeof docsHistRemoveDoc === 'function') {
      _docsActiveId = docsHistRemoveDoc(deletingDocId) || null;
    } else {
      _docsActiveId = null;
    }
    _docsHidePane();
    await loadDocs();
  } catch (e) {
    errEl.textContent = `Error: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
}

// ── List view toggle ──────────────────────────────────────────────────────────

// ── List view rendering ───────────────────────────────────────────────────────

function _docsRenderList() {
  const pane = document.getElementById('docs-list-pane');
  if (!pane) return;
  pane.classList.add('bp-font-role-docs-markdown');
  pane.innerHTML = '';

  const container = document.createElement('div');
  container.id = 'docs-list-container';
  container.className = 'bp-font-role-docs-markdown';
  container.style.cssText = 'display:flex;flex-direction:column;gap:10px;flex:1';
  pane.appendChild(container);

  const sortedGroups = [..._docsGroups].sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
  sortedGroups.forEach(g => container.appendChild(_docsRenderGroupBlock(g)));
  container.appendChild(_docsRenderGroupBlock(null)); // Undefined Group always last
}

function _docsRenderGroupBlock(group) {
  const isUndefined = group === null;
  const groupId     = group ? group.group_id : null;
  const groupName   = group ? group.name : 'Undefined Group';
  const groupKey    = groupId || '__undefined__';
  const isExpanded  = _docsExpandedGroups.has(groupKey);

  const block = document.createElement('div');
  block.className = 'docs-group-block bp-font-role-docs-markdown';
  block.dataset.groupId = groupKey;
  block.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden';

  // ── Group header ──
  const groupHdr = document.createElement('div');
  groupHdr.className = 'bp-font-role-docs-markdown';
  groupHdr.setAttribute('role', 'button');
  groupHdr.setAttribute('tabindex', '0');
  groupHdr.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
  groupHdr.style.cssText = 'display:flex;align-items:center;gap:6px;padding:7px 10px;background:var(--bg2,#16161e);border-bottom:1px solid var(--border);font-weight:600;font-size:13px;min-height:34px;cursor:pointer';

  const toggleGroup = () => {
    if (_docsExpandedGroups.has(groupKey)) _docsExpandedGroups.delete(groupKey);
    else _docsExpandedGroups.add(groupKey);
    _docsRenderList();
  };

  groupHdr.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    toggleGroup();
  });
  groupHdr.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('button')) return;
    e.preventDefault();
    toggleGroup();
  });

  if (!isUndefined) {
    groupHdr.draggable = true;
    groupHdr.ondragstart = e => {
      _groupDragId = groupId;
      e.dataTransfer.effectAllowed = 'move';
      block.style.opacity = '0.5';
    };
    groupHdr.ondragend = () => {
      _groupDragId = null;
      block.style.opacity = '';
      document.querySelectorAll('.docs-group-block').forEach(b => b.style.outline = '');
    };
    groupHdr.innerHTML = `
      <span style="color:var(--text-dim);font-size:15px;user-select:none">≡</span>
      <span style="color:var(--text-dim);font-size:11px;min-width:12px;text-align:center;user-select:none">${isExpanded ? '▾' : '▸'}</span>
      <span style="flex:1">${esc(groupName)}</span>
      <button class="secondary table-icon-btn table-icon-btn--folder" type="button" data-docs-action="open-folder" title="Open most common folder" aria-label="Open most common folder for ${esc(groupName)}"></button>
      <button class="secondary table-icon-btn table-icon-btn--edit" type="button" data-docs-action="edit-group" title="Rename group" aria-label="Rename group ${esc(groupName)}"></button>
      <button class="secondary table-icon-btn table-icon-btn--delete" type="button" data-docs-action="delete-group" title="Delete group" aria-label="Delete group ${esc(groupName)}"></button>
    `;
    groupHdr.querySelector('[data-docs-action="open-folder"]')?.addEventListener('click', e => {
      e.stopPropagation();
      docsListOpenGroupFolder(groupId);
    });
    groupHdr.querySelector('[data-docs-action="edit-group"]')?.addEventListener('click', e => {
      e.stopPropagation();
      docsListEditGroup(groupId, groupName);
    });
    groupHdr.querySelector('[data-docs-action="delete-group"]')?.addEventListener('click', e => {
      e.stopPropagation();
      docsListDeleteGroup(groupId, groupName);
    });
  } else {
    groupHdr.innerHTML = `
      <span style="color:var(--text-dim);font-size:15px;user-select:none">≡</span>
      <span style="color:var(--text-dim);font-size:11px;min-width:12px;text-align:center;user-select:none">${isExpanded ? '▾' : '▸'}</span>
      <span style="flex:1;color:var(--text-dim);font-style:italic">${esc(groupName)}</span>
      <button class="secondary table-icon-btn table-icon-btn--folder" type="button" data-docs-action="open-folder" title="Open most common folder" aria-label="Open most common folder for ${esc(groupName)}"></button>
    `;
    groupHdr.querySelector('[data-docs-action="open-folder"]')?.addEventListener('click', e => {
      e.stopPropagation();
      docsListOpenGroupFolder(null);
    });
  }

  // ── Group drag-over (groups reordering) ──
  block.ondragover = e => {
    if (_groupDragId && _groupDragId !== groupId) {
      e.preventDefault();
      block.style.outline = '2px solid var(--accent)';
    } else if (_docsDragId) {
      e.preventDefault();
    }
  };
  block.ondragleave = e => {
    if (!block.contains(e.relatedTarget)) block.style.outline = '';
  };
  block.ondrop = e => {
    e.preventDefault();
    block.style.outline = '';
    if (_groupDragId && _groupDragId !== groupId && !isUndefined) {
      _docsDropGroupBefore(_groupDragId, groupId);
    } else if (_docsDragId) {
      _docsDropDocOnGroup(_docsDragId, groupId);
    }
  };

  block.appendChild(groupHdr);

  // ── Docs list zone ──
  const docsList = document.createElement('div');
  docsList.dataset.groupId = groupKey;
  docsList.style.cssText = 'display:flex;flex-direction:column;min-height:30px';

  const groupDocs = _docsAll
    .filter(d => isUndefined ? !d.group_id : d.group_id === groupId)
    .sort((a, b) => (a.sort_order - b.sort_order) || a.label.localeCompare(b.label));

  if (groupDocs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'bp-font-role-docs-markdown';
    empty.style.cssText = 'padding:8px 14px;font-size:12px;color:var(--text-dim);font-style:italic';
    empty.textContent = 'No documents — drop one here';
    docsList.appendChild(empty);
  } else {
    groupDocs.forEach(doc => docsList.appendChild(_docsRenderDocRow(doc)));
  }

  // Drop on the empty area of the docs zone → move to end of this group
  docsList.ondragover = e => {
    if (_docsDragId) {
      e.preventDefault();
      docsList.style.background = 'rgba(99,102,241,.07)';
    }
  };
  docsList.ondragleave = e => {
    if (!docsList.contains(e.relatedTarget)) docsList.style.background = '';
  };
  docsList.ondrop = e => {
    e.stopPropagation();
    docsList.style.background = '';
    if (_docsDragId) _docsDropDocOnGroup(_docsDragId, groupId);
  };

  if (!isExpanded) {
    docsList.hidden = true;
    docsList.style.display = 'none';
    return block;
  }

  block.appendChild(docsList);
  return block;
}

function _docsRenderDocRow(doc) {
  const row = document.createElement('div');
  row.dataset.docId = doc.doc_id;
  row.draggable = true;
  row.className = 'docs-doc-dropline bp-font-role-docs-markdown';
  row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 10px;border-bottom:1px solid rgba(255,255,255,.04);cursor:default;transition:background .1s';

  row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,.03)'; });
  row.addEventListener('mouseleave', () => { row.style.background = ''; });

  row.ondragstart = e => {
    _docsDragId = doc.doc_id;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => { row.style.opacity = '0.4'; }, 0);
  };
  row.ondragend = () => {
    _docsDragId = null;
    row.style.opacity = '';
    document.querySelectorAll('.docs-doc-dropline').forEach(el => el.style.borderTop = '');
  };
  // Drop before this doc
  row.ondragover = e => {
    if (_docsDragId && _docsDragId !== doc.doc_id) {
      e.preventDefault();
      e.stopPropagation();
      row.style.borderTop = '2px solid var(--accent)';
    }
  };
  row.ondragleave = () => { row.style.borderTop = ''; };
  row.ondrop = e => {
    e.preventDefault();
    e.stopPropagation();
    row.style.borderTop = '';
    if (_docsDragId && _docsDragId !== doc.doc_id) _docsDropDocBeforeDoc(_docsDragId, doc.doc_id);
  };
  row.innerHTML = `
    <span style="color:var(--text-dim);font-size:15px;user-select:none;cursor:grab">≡</span>
    <span class="bp-font-role-docs-markdown" style="flex:1;font-size:13px">${esc(doc.label)}</span>
    ${doc.description ? `<span class="bp-font-role-docs-markdown" style="font-size:11px;color:var(--text-dim);flex:2;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(doc.description)}</span>` : ''}
    <button class="secondary" style="padding:2px 8px;font-size:12px;flex-shrink:0" onclick="docsListCopyLink('${doc.doc_id}')" title="Copy Markdown link" aria-label="Copy Markdown link for ${esc(doc.label)}">🔗 Copy Link</button>
    <button class="secondary table-icon-btn table-icon-btn--delete" type="button" style="flex-shrink:0" onclick="docsListDeleteDoc('${doc.doc_id}')" title="Delete document" aria-label="Delete document ${esc(doc.label)}"></button>
    <button class="secondary" style="padding:2px 8px;font-size:12px;flex-shrink:0" onclick="docsListOpenDoc('${doc.doc_id}')" title="Open document" aria-label="Open document ${esc(doc.label)}">Open</button>
  `;
  return row;
}

// ── List actions ──────────────────────────────────────────────────────────────

function docsListCopyLink(docId) {
  const doc = _docsAll.find(d => d.doc_id === docId);
  if (!doc) return;
  const base = doc.path ? doc.path.split('/').pop() : '';
  const md = `[${doc.label}](${base})`;
  navigator.clipboard.writeText(md).then(() => {
    const status = document.getElementById('docs-status');
    if (status) {
      status.textContent = `\u2713 Copied: ${md}`;
      status.style.color = 'var(--accent)';
      status.hidden = false;
      setTimeout(() => { status.hidden = true; }, 3000);
    }
  });
}

function docsListDeleteDoc(docId) {
  // Route through the existing delete modal — temporarily set active doc
  const prev = _docsActiveId;
  _docsActiveId = docId;
  openDeleteDocModal();
  // If user cancels the modal the active doc may be wrong, so patch the modal's
  // cancel button to restore it
  const modal = document.getElementById('docs-delete-modal');
  const cancelHandler = () => {
    if (_docsActiveId === docId && docId !== prev) _docsActiveId = prev;
    modal.removeEventListener('close', cancelHandler);
  };
  modal.addEventListener('close', cancelHandler);
}

function docsListOpenDoc(docId, opts = {}) {
  switchTab('docs');
  SettingsMenuConfig.updateActiveTab('docs');
  const afterOpen = ok => {
    if (ok && Array.isArray(opts.highlightTerms) && opts.highlightTerms.length) {
      window.setTimeout(() => docsHighlightTerms(opts.highlightTerms), 80);
    }
    return ok;
  };
  if (docId === _docsActiveId) {
    // docsSelectDoc would bail early — force a fresh load instead
    return _docsOpenDoc(docId).then(afterOpen);
  } else {
    return docsSelectDoc(docId).then(afterOpen);
  }
}

async function docsListAddGroup() {
  _docsOpenGroupModal('add');
}

async function docsListEditGroup(groupId, currentName) {
  _docsOpenGroupModal('edit', groupId, currentName);
}

async function _docsSubmitGroupModal() {
  const input = document.getElementById('docs-group-modal-name');
  const errEl = document.getElementById('docs-group-modal-error');
  const submit = document.getElementById('docs-group-modal-submit');
  if (!input || !errEl || !submit) return;

  const name = input.value.trim();
  if (!name) {
    errEl.textContent = 'Group name cannot be empty.';
    input.focus();
    return;
  }

  if (_docsGroupModalMode === 'edit' && name === (_docsEditingGroupName || '').trim()) {
    HubModal.close(document.getElementById('docs-group-modal'));
    return;
  }

  submit.disabled = true;
  errEl.textContent = '';

  try {
    let r;
    if (_docsGroupModalMode === 'add') {
      const maxSort = _docsGroups.length > 0 ? Math.max(..._docsGroups.map(g => g.sort_order)) : -10;
      r = await apiFetch('/api/v1/doc-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, sort_order: maxSort + 10 }),
      });
    } else {
      r = await apiFetch(`/api/v1/doc-groups/${_docsEditingGroupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
    }

    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.detail || `HTTP ${r.status}`);
    }

    HubModal.close(document.getElementById('docs-group-modal'));
    await loadDocs();
  } catch (e) {
    errEl.textContent = `Error: ${e.message}`;
  } finally {
    submit.disabled = false;
  }
}

async function docsListDeleteGroup(groupId, name) {
  const docsInGroup = _docsAll.filter(d => d.group_id === groupId).length;
  const ok = await HubDialogs.confirmDelete({
    title: 'Delete document group?',
    message: `Delete group "${name}"?`,
    detail: docsInGroup > 0
      ? `The ${docsInGroup} document(s) in this group will move to Undefined Group.`
      : 'Only the group will be removed.',
  });
  if (!ok) return;
  try {
    const r = await apiFetch(`/api/v1/doc-groups/${groupId}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await loadDocs();
  } catch (e) {
    await HubDialogs.alertError({
      title: 'Delete failed',
      message: `Failed to delete group: ${e.message}`,
    });
  }
}

async function docsListOpenGroupFolder(groupId, options = {}) {
  const requestSeq = ++_docsFolderTreeRequestSeq;
  const groupName = _docsFolderTreeTitleFor(groupId || null, options);
  const modal = document.getElementById('docs-folder-tree-modal');
  const list = document.getElementById('docs-folder-tree-list');
  const errEl = document.getElementById('docs-folder-tree-error');
  const status = document.getElementById('docs-folder-tree-status');
  const hasQueryOption = Object.prototype.hasOwnProperty.call(options, 'query');
  const hasModeOption = Object.prototype.hasOwnProperty.call(options, 'mode');
  const cached = _docsFolderTreeSearchCache || { query: '', mode: 'keyword' };
  const initialQuery = hasQueryOption ? String(options.query || '').trim() : cached.query;
  const optionMode = hasModeOption ? options.mode : cached.mode;

  _docsFolderTreeState = {
    groupId: groupId || null,
    title: groupName,
    path: null,
    parentPath: null,
    query: initialQuery,
    mode: ['keyword', 'vector', 'hybrid'].includes(optionMode) ? optionMode : 'keyword',
    lastTree: null,
    searchResults: null,
    explanation: null,
  };
  _docsFolderTreeSetSearchForm();
  _docsFolderTreeSetTitle(groupName);
  if (list) list.innerHTML = '<div class="docs-tree-loading">Loading folder...</div>';
  if (errEl) errEl.textContent = '';
  if (status) status.textContent = '';
  _docsFolderTreeClearExplanation();
  _docsFolderTreeRefreshStatusBadge();
  if (modal && typeof HubModal !== 'undefined') {
    HubModal.open(modal, {
      onOpen: () => {
        if (options.focusQuery === false) return;
        const input = document.getElementById('docs-folder-tree-query');
        if (input) {
          input.focus();
          input.select();
        }
      },
    });
  }

  await _docsFolderTreeLoad(null, requestSeq);
}

function _docsFolderTreeSetSearchForm() {
  const query = document.getElementById('docs-folder-tree-query');
  const mode = document.getElementById('docs-folder-tree-mode');
  if (query) query.value = _docsFolderTreeState.query || '';
  if (mode) mode.value = ['keyword', 'vector', 'hybrid'].includes(_docsFolderTreeState.mode)
    ? _docsFolderTreeState.mode
    : 'keyword';
}

function _docsFolderTreeReadSearchForm() {
  _docsFolderTreeState.query = (document.getElementById('docs-folder-tree-query')?.value || '').trim();
  const mode = document.getElementById('docs-folder-tree-mode')?.value || 'keyword';
  _docsFolderTreeState.mode = ['keyword', 'vector', 'hybrid'].includes(mode) ? mode : 'keyword';
  _docsFolderTreeSaveSearchCache(_docsFolderTreeState.query, _docsFolderTreeState.mode);
}

function _docsFolderTreeTitleFor(groupId, options = {}) {
  if (typeof options.title === 'string' && options.title.trim()) return options.title.trim();
  if (groupId) {
    const group = _docsGroups.find(g => g.group_id === groupId);
    if (group?.name) return group.name;
  }
  if (Object.prototype.hasOwnProperty.call(options, 'groupId') && !groupId) return 'Undefined Group';
  return 'Docs Search';
}

function _docsFolderTreeSetTitle(text) {
  const title = document.getElementById('docs-folder-tree-title');
  const value = String(text || '').trim() || 'Docs Search';
  _docsFolderTreeState.title = value;
  if (title) title.textContent = value;
}

function _docsFolderTreeTitleFromPath(path) {
  const clean = String(path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!clean || clean === '.') return 'Docs Search';
  if (clean === 'docs') return 'DOCS';
  const parts = clean.split('/').filter(Boolean);
  const leaf = parts[parts.length - 1] || clean;
  return leaf.replace(/[-_]+/g, ' ').toUpperCase();
}

function _docsFolderTreeScope() {
  const path = String(_docsFolderTreeState.path || '.').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!path || path === '.') {
    return {
      group_id: _docsFolderTreeState.groupId || null,
      folder: null,
      allowed_paths: [],
    };
  }
  const folder = path.endsWith('/') ? path : `${path}/`;
  return {
    group_id: _docsFolderTreeState.groupId || null,
    folder,
    allowed_paths: [folder],
  };
}

function _docsFolderTreeClearExplanation() {
  _docsFolderTreeState.explanation = null;
  _docsFolderTreeExplainTtsText = '';
  const modal = document.getElementById('docs-folder-tree-explain-modal');
  if (modal?.open && typeof HubModal !== 'undefined') HubModal.close(modal);
  else _docsFolderTreeStopExplainTts();
  const text = document.getElementById('docs-folder-tree-explain-text');
  const meta = document.getElementById('docs-folder-tree-explain-meta');
  const sources = document.getElementById('docs-folder-tree-explain-sources');
  const sourcesBtn = document.getElementById('docs-folder-tree-explain-sources-btn');
  const status = document.getElementById('docs-folder-tree-explain-tts-status');
  if (text) text.textContent = '';
  if (meta) meta.textContent = '';
  if (sources) sources.innerHTML = '';
  if (sourcesBtn) sourcesBtn.hidden = true;
  if (status) status.textContent = '';
}

function _docsFolderTreeSearchTerms(result) {
  const terms = Array.isArray(result?.keyword_terms) ? result.keyword_terms : [];
  if (terms.length) return terms;
  return Array.from(new Set((_docsFolderTreeState.query.match(/[A-Za-z0-9._:-]{3,}/g) || [])
    .map(v => v.toLowerCase())))
    .slice(0, 8);
}

function _docsFolderTreeSetExplainTtsState(state = 'IDLE', message = '') {
  const clean = ['IDLE', 'SPEAKING', 'PAUSED'].includes(state) ? state : 'IDLE';
  _docsFolderTreeExplainTtsState = clean;
  const btn = document.getElementById('docs-folder-tree-explain-speaker');
  const status = document.getElementById('docs-folder-tree-explain-tts-status');
  const isSpeaking = clean === 'SPEAKING';
  const isPaused = clean === 'PAUSED';
  if (btn) {
    btn.classList.toggle('is-idle', clean === 'IDLE');
    btn.classList.toggle('is-speaking', isSpeaking);
    btn.classList.toggle('is-paused', isPaused);
    btn.setAttribute('aria-pressed', isSpeaking ? 'true' : 'false');
    const label = isPaused
      ? 'Resume explanation audio'
      : (isSpeaking ? 'Pause explanation audio' : 'Speak explanation');
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }
  if (status) status.textContent = message;
}

function _docsFolderTreeSyncExplainTtsState() {
  const btn = document.getElementById('docs-folder-tree-explain-speaker');
  if (!btn) {
    _docsFolderTreeExplainTtsState = 'IDLE';
    return _docsFolderTreeExplainTtsState;
  }
  if (btn.classList.contains('is-speaking')) _docsFolderTreeExplainTtsState = 'SPEAKING';
  else if (btn.classList.contains('is-paused')) _docsFolderTreeExplainTtsState = 'PAUSED';
  else _docsFolderTreeExplainTtsState = 'IDLE';
  return _docsFolderTreeExplainTtsState;
}

function _docsFolderTreeClearExplainTtsClickTimer() {
  if (!_docsFolderTreeExplainTtsClickTimer) return;
  clearTimeout(_docsFolderTreeExplainTtsClickTimer);
  _docsFolderTreeExplainTtsClickTimer = null;
}

function _docsFolderTreeResetExplainTtsClickClassifier() {
  _docsFolderTreeClearExplainTtsClickTimer();
  _docsFolderTreeExplainTtsLastClickAt = 0;
}

async function _docsFolderTreeStopExplainTtsClient() {
  if (typeof BlueprintsTtsClient !== 'undefined' && typeof BlueprintsTtsClient.stop === 'function') {
    try {
      await BlueprintsTtsClient.stop();
    } catch (e) {
      console.warn('docs folder explain: failed to stop TTS', e);
    }
  }
}

async function _docsFolderTreeStopExplainTts() {
  _docsFolderTreeResetExplainTtsClickClassifier();
  _docsFolderTreeExplainTtsRunId += 1;
  _docsFolderTreeSetExplainTtsState('IDLE', '');
  await _docsFolderTreeStopExplainTtsClient();
}

async function _docsFolderTreePauseExplainTts() {
  if (typeof BlueprintsTtsClient === 'undefined' || typeof BlueprintsTtsClient.pause !== 'function') {
    await _docsFolderTreeStopExplainTts();
    return;
  }
  try {
    const result = await BlueprintsTtsClient.pause();
    if (result?.paused) {
      _docsFolderTreeSetExplainTtsState('PAUSED', '');
      return;
    }
  } catch (e) {
    console.warn('docs folder explain: failed to pause TTS', e);
  }
  await _docsFolderTreeStopExplainTts();
}

async function _docsFolderTreeResumeExplainTts() {
  if (typeof BlueprintsTtsClient === 'undefined' || typeof BlueprintsTtsClient.resume !== 'function') {
    await _docsFolderTreeStopExplainTts();
    return;
  }
  try {
    const result = await BlueprintsTtsClient.resume();
    if (result?.resumed) {
      _docsFolderTreeSetExplainTtsState('SPEAKING', '');
      return;
    }
  } catch (e) {
    console.warn('docs folder explain: failed to resume TTS', e);
  }
  await _docsFolderTreeStopExplainTts();
}

async function _docsFolderTreeStartExplainTts() {
  const text = (_docsFolderTreeExplainTtsText || document.getElementById('docs-folder-tree-explain-text')?.textContent || '').trim();
  if (!text) return;
  if (typeof BlueprintsTtsClient === 'undefined' || typeof BlueprintsTtsClient.speak !== 'function') {
    _docsFolderTreeSetExplainTtsState('IDLE', 'TTS is not available.');
    return;
  }
  const runId = _docsFolderTreeExplainTtsRunId + 1;
  _docsFolderTreeExplainTtsRunId = runId;
  await _docsFolderTreeStopExplainTtsClient();
  if (runId !== _docsFolderTreeExplainTtsRunId) return;
  _docsFolderTreeSetExplainTtsState('SPEAKING', '');
  try {
    await BlueprintsTtsClient.speak({
      text,
      interrupt: true,
      mode: 'stream',
      eventKind: 'docs_explain',
      fallbackKind: 'positive',
      sanitizeText: true,
      transformProfile: 'speech',
    });
  } catch (e) {
    if (e?.name === 'AbortError') {
      if (runId === _docsFolderTreeExplainTtsRunId) _docsFolderTreeSetExplainTtsState('IDLE', '');
      return;
    }
    console.warn('docs folder explain: TTS failed', e);
    const message = e?.message ? `TTS failed: ${e.message}` : 'TTS failed.';
    if (runId === _docsFolderTreeExplainTtsRunId) _docsFolderTreeSetExplainTtsState('IDLE', message);
    return;
  }
  if (runId === _docsFolderTreeExplainTtsRunId) _docsFolderTreeSetExplainTtsState('IDLE', '');
}

const _docsFolderTreeExplainTtsFsm = (() => {
  // Speaker FSM:
  // IDLE + tap -> start; SPEAKING + tap -> pause; PAUSED + tap -> resume.
  // Any state + doubleTap -> stop. Raw click timing is classified outside the FSM.
  const transitions = {
    IDLE: {
      tap: { next: 'SPEAKING', actions: ['start'] },
      doubleTap: { next: 'IDLE', actions: ['stop'] },
    },
    SPEAKING: {
      tap: { next: 'PAUSED', actions: ['pause'] },
      doubleTap: { next: 'IDLE', actions: ['stop'] },
    },
    PAUSED: {
      tap: { next: 'SPEAKING', actions: ['resume'] },
      doubleTap: { next: 'IDLE', actions: ['stop'] },
    },
  };

  async function _executeAction(action) {
    if (action === 'start') return _docsFolderTreeStartExplainTts();
    if (action === 'pause') return _docsFolderTreePauseExplainTts();
    if (action === 'resume') return _docsFolderTreeResumeExplainTts();
    if (action === 'stop') return _docsFolderTreeStopExplainTts();
    return undefined;
  }

  async function dispatch(event) {
    const state = _docsFolderTreeSyncExplainTtsState();
    const transition = transitions[state]?.[event];
    if (!transition) return;
    _docsFolderTreeExplainTtsState = transition.next;
    for (const action of transition.actions) {
      await _executeAction(action);
    }
  }

  function getState() {
    return _docsFolderTreeSyncExplainTtsState();
  }

  return { dispatch, getState };
})();

function _docsFolderTreeExplanationText(display) {
  return String(display?.markdown || display?.answer_markdown || '').trim();
}

function _docsFolderTreeExplanationSources(display) {
  const displaySources = Array.isArray(display?.sources) ? display.sources : [];
  if (displaySources.length) return displaySources;
  const explanation = _docsFolderTreeState.explanation;
  return Array.isArray(explanation?.sources) ? explanation.sources : [];
}

function _docsFolderTreeExplanationSourcesHtml(sources) {
  const items = (Array.isArray(sources) ? sources : []).filter(source => source && typeof source === 'object');
  if (!items.length) return '';
  return `
    <div class="docs-tree-explain-source-title">Sources</div>
    <ol class="docs-tree-explain-source-list">
      ${items.map((source, index) => {
        const label = source.label || source.citation_label || `[S${index + 1}]`;
        const path = source.path || '';
        const title = source.title || path || 'Source';
        const lifecycle = source.lifecycle || 'unknown';
        const sourceType = source.source_type || 'unknown';
        const authority = source.authority || 'unknown';
        const fetched = source.fetched === false ? 'ranked' : 'fetched';
        const openable = _docsFindDocForSourcePath(path) ? '' : ' disabled';
        return `
          <li class="docs-tree-explain-source">
            <span class="docs-tree-explain-source-label">${esc(label)}</span>
            <button class="docs-tree-explain-source-main" type="button" data-source-path="${esc(path)}"${openable}>
              <span class="docs-tree-explain-source-name">${esc(title)}</span>
              <span class="docs-tree-explain-source-path">${esc(path)}</span>
              <span class="docs-tree-explain-source-meta">${esc(`${lifecycle} / ${sourceType} / ${authority} / ${fetched}`)}</span>
            </button>
          </li>
        `;
      }).join('')}
    </ol>
  `;
}

function _docsSourcePathCandidates(path) {
  const clean = String(path || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean) return [];
  const candidates = [clean];
  if (clean.startsWith('docs/')) candidates.push(clean.slice(5));
  else candidates.push(`docs/${clean}`);
  return Array.from(new Set(candidates.map(item => item.toLowerCase())));
}

function _docsFindDocForSourcePath(path) {
  const candidates = _docsSourcePathCandidates(path);
  if (!candidates.length) return null;
  return _docsAll.find(doc => doc.path && candidates.includes(String(doc.path).toLowerCase())) || null;
}

async function _docsFolderTreeOpenSourcesModal() {
  const modal = document.getElementById('docs-folder-tree-sources-modal');
  const body = document.getElementById('docs-folder-tree-explain-sources');
  const display = _docsFolderTreeState.explanation?.display || {};
  const sources = _docsFolderTreeExplanationSources(display);
  if (!modal || !body || !sources.length) return;
  if (!_docsAll.length) await loadDocs();
  body.innerHTML = _docsFolderTreeExplanationSourcesHtml(sources);
  if (typeof HubModal !== 'undefined') HubModal.open(modal);
  else if (typeof modal.showModal === 'function' && !modal.open) modal.showModal();
}

async function _docsFolderTreeOpenSourceDoc(path) {
  if (!_docsAll.length) await loadDocs();
  const doc = _docsFindDocForSourcePath(path);
  if (!doc) return;
  const sourcesModal = document.getElementById('docs-folder-tree-sources-modal');
  const explainModal = document.getElementById('docs-folder-tree-explain-modal');
  const treeModal = document.getElementById('docs-folder-tree-modal');
  if (sourcesModal && typeof HubModal !== 'undefined') HubModal.close(sourcesModal);
  if (explainModal && typeof HubModal !== 'undefined') HubModal.close(explainModal);
  if (treeModal && typeof HubModal !== 'undefined') HubModal.close(treeModal);
  await docsListOpenDoc(doc.doc_id);
}

function _docsFolderTreeOpenExplanationModal() {
  const modal = document.getElementById('docs-folder-tree-explain-modal');
  const title = document.getElementById('docs-folder-tree-explain-title');
  const meta = document.getElementById('docs-folder-tree-explain-meta');
  const text = document.getElementById('docs-folder-tree-explain-text');
  const sourcesBtn = document.getElementById('docs-folder-tree-explain-sources-btn');
  const explanation = _docsFolderTreeState.explanation;
  const display = explanation?.display && typeof explanation.display === 'object' ? explanation.display : null;
  if (!modal || !display) return;
  const sources = _docsFolderTreeExplanationSources(display);
  const sourceCount = Number(display.source_count || sources.length || 0);
  const evidenceCount = Number(display.evidence_count || display.evidence_document_count || 0);
  const markdown = _docsFolderTreeExplanationText(display);
  _docsFolderTreeExplainTtsText = markdown;
  if (title) title.textContent = display.title || 'Docs Search Explanation';
  if (meta) {
    meta.textContent = `${sourceCount} source${sourceCount === 1 ? '' : 's'}; ${evidenceCount} evidence document${evidenceCount === 1 ? '' : 's'}`;
  }
  if (sourcesBtn) sourcesBtn.hidden = !sources.length;
  if (text) text.textContent = markdown || 'No grounded explanation was returned for this query.';
  _docsFolderTreeSetExplainTtsState('IDLE', '');
  if (typeof HubModal !== 'undefined') {
    HubModal.open(modal, { onClose: _docsFolderTreeStopExplainTts });
  } else if (typeof modal.showModal === 'function' && !modal.open) {
    modal.showModal();
  }
}

function _docsFolderTreeHandleExplainSpeakerClick() {
  _docsFolderTreeClearExplainTtsClickTimer();
  const now = Date.now();
  if (
    _docsFolderTreeExplainTtsLastClickAt
    && (now - _docsFolderTreeExplainTtsLastClickAt) <= _DOCS_FOLDER_TREE_EXPLAIN_TTS_DOUBLE_CLICK_MS
  ) {
    _docsFolderTreeExplainTtsLastClickAt = 0;
    _docsFolderTreeExplainTtsFsm.dispatch('doubleTap');
    return;
  }
  _docsFolderTreeExplainTtsLastClickAt = now;
  _docsFolderTreeExplainTtsClickTimer = setTimeout(() => {
    _docsFolderTreeExplainTtsClickTimer = null;
    _docsFolderTreeExplainTtsLastClickAt = 0;
    _docsFolderTreeExplainTtsFsm.dispatch('tap');
  }, _DOCS_FOLDER_TREE_EXPLAIN_TTS_DOUBLE_CLICK_MS);
}

async function _docsFolderTreeHandleExplainSpeakerDoubleClick() {
  _docsFolderTreeResetExplainTtsClickClassifier();
  await _docsFolderTreeExplainTtsFsm.dispatch('doubleTap');
}

function _docsFolderTreeSetStatusPill(status = 'unknown') {
  const pill = document.getElementById('docs-folder-tree-status-pill');
  if (!pill) return;
  const clean = ['green', 'amber', 'red'].includes(status) ? status : 'unknown';
  pill.classList.remove(
    'docs-tree-status-pill--green',
    'docs-tree-status-pill--amber',
    'docs-tree-status-pill--red',
    'docs-tree-status-pill--unknown',
  );
  pill.classList.add(`docs-tree-status-pill--${clean}`);
  pill.textContent = 'STATUS';
  pill.title = clean === 'unknown' ? 'Docs search status' : `Docs search status: ${clean}`;
}

function _docsFolderTreeMetricHtml(label, value) {
  const display = value === null || value === undefined || value === '' ? '-' : String(value);
  return `
    <div class="docs-tree-metric">
      <div class="docs-tree-metric-value">${esc(display)}</div>
      <div class="docs-tree-metric-label">${esc(label)}</div>
    </div>
  `;
}

function _docsFolderTreeStatusHtml(data) {
  const metrics = data?.metrics && typeof data.metrics === 'object' ? data.metrics : {};
  const checks = Array.isArray(data?.checks) ? data.checks : [];
  const status = ['green', 'amber', 'red'].includes(data?.status) ? data.status : 'unknown';
  const checkHtml = checks.map(check => {
    const state = check.status === 'fail' ? 'fail' : (check.status === 'warn' ? 'warn' : 'ok');
    const kind = check.critical ? 'critical' : 'watch';
    return `
      <section class="docs-tree-check docs-tree-check--${esc(state)}">
        <span class="docs-tree-check-dot" aria-hidden="true"></span>
        <div>
          <div class="docs-tree-check-title">
            <span>${esc(check.label || check.name || 'Check')}</span>
            <span class="docs-tree-check-kind">${esc(kind)}</span>
          </div>
          <div class="docs-tree-check-detail">${esc(check.detail || '')}</div>
        </div>
      </section>
    `;
  }).join('');
  return `
    <section class="docs-tree-status-summary docs-tree-status-summary--${esc(status)}">
      <div class="docs-tree-status-summary-head">
        <div class="docs-tree-status-title">${esc(data?.summary || 'Docs search status')}</div>
      </div>
      <p class="docs-tree-status-meta">Corpus and service checks for the local docs retrieval path.</p>
    </section>
    <div class="docs-tree-metric-grid">
      ${_docsFolderTreeMetricHtml('registered docs', metrics.registered_docs)}
      ${_docsFolderTreeMetricHtml('indexed docs', metrics.turbovec_documents)}
      ${_docsFolderTreeMetricHtml('chunks', metrics.turbovec_chunks)}
      ${_docsFolderTreeMetricHtml('edges', metrics.graph_edges)}
      ${_docsFolderTreeMetricHtml('graph nodes', metrics.graph_nodes)}
      ${_docsFolderTreeMetricHtml('headings', metrics.graph_headings)}
      ${_docsFolderTreeMetricHtml('groups', metrics.doc_groups)}
      ${_docsFolderTreeMetricHtml('unknown metadata', metrics.unknown_lifecycle_source_docs)}
    </div>
    <div class="docs-tree-check-list">${checkHtml || '<div class="docs-tree-empty">No checks returned.</div>'}</div>
  `;
}

async function _docsFolderTreeFetchStatus() {
  const r = await apiFetch('/api/v1/docs/search/status');
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
  _docsFolderTreeStatusCache = data;
  _docsFolderTreeSetStatusPill(data.status || 'unknown');
  return data;
}

async function _docsFolderTreeRefreshStatusBadge() {
  try {
    await _docsFolderTreeFetchStatus();
  } catch (e) {
    console.warn('docs search status badge failed', e);
    _docsFolderTreeSetStatusPill('red');
  }
}

async function _docsFolderTreeOpenStatusModal() {
  const modal = document.getElementById('docs-folder-tree-status-modal');
  const body = document.getElementById('docs-folder-tree-status-dashboard');
  const badge = document.getElementById('docs-folder-tree-status-badge');
  if (!modal || !body) return;
  body.innerHTML = '<div class="docs-tree-loading">Loading status...</div>';
  if (typeof HubModal !== 'undefined') HubModal.open(modal);
  else if (typeof modal.showModal === 'function' && !modal.open) modal.showModal();
  try {
    const data = await _docsFolderTreeFetchStatus();
    if (badge) {
      const clean = ['green', 'amber', 'red'].includes(data.status) ? data.status : 'unknown';
      badge.textContent = 'STATUS';
      badge.classList.remove(
        'docs-tree-status-badge--green',
        'docs-tree-status-badge--amber',
        'docs-tree-status-badge--red',
        'docs-tree-status-badge--unknown',
      );
      badge.classList.add(`docs-tree-status-badge--${clean}`);
    }
    body.innerHTML = _docsFolderTreeStatusHtml(data);
  } catch (e) {
    _docsFolderTreeSetStatusPill('red');
    if (badge) {
      badge.textContent = 'STATUS';
      badge.classList.remove(
        'docs-tree-status-badge--green',
        'docs-tree-status-badge--amber',
        'docs-tree-status-badge--red',
        'docs-tree-status-badge--unknown',
      );
      badge.classList.add('docs-tree-status-badge--red');
    }
    body.innerHTML = `<p class="hub-modal-error">Status failed: ${esc(e.message || e)}</p>`;
  }
}

function openDocsFolderSearchModal(options = {}) {
  const activeDoc = _docsAll.find(d => d.doc_id === _docsActiveId) || null;
  const groupId = Object.prototype.hasOwnProperty.call(options, 'groupId')
    ? options.groupId
    : (activeDoc ? activeDoc.group_id || null : null);
  const explicitGroup = Object.prototype.hasOwnProperty.call(options, 'groupId');
  const treeOptions = {
    focusQuery: options.focusQuery !== false,
    title: typeof options.title === 'string' ? options.title : '',
  };
  if (Object.prototype.hasOwnProperty.call(options, 'query')) {
    treeOptions.query = typeof options.query === 'string' ? options.query : '';
  }
  if (Object.prototype.hasOwnProperty.call(options, 'mode')) {
    treeOptions.mode = ['keyword', 'vector', 'hybrid'].includes(options.mode) ? options.mode : 'keyword';
  }
  if (explicitGroup) treeOptions.groupId = groupId;
  docsListOpenGroupFolder(groupId, treeOptions);
}

async function _docsFolderTreeLoad(path, requestSeq = _docsFolderTreeRequestSeq) {
  const list = document.getElementById('docs-folder-tree-list');
  const errEl = document.getElementById('docs-folder-tree-error');
  const status = document.getElementById('docs-folder-tree-status');
  if (list) list.innerHTML = '<div class="docs-tree-loading">Loading folder...</div>';
  if (errEl) errEl.textContent = '';
  if (status) status.textContent = '';

  try {
    const r = await apiFetch('/api/v1/docs/group-folder/tree', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_id: _docsFolderTreeState.groupId || null,
        path: path || null,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
    if (requestSeq !== _docsFolderTreeRequestSeq) return;
    _docsFolderTreeRender(data);
    if (_docsFolderTreeState.query) await _docsFolderTreeRunSearch({ fromNavigation: true, requestSeq });
  } catch (e) {
    if (requestSeq !== _docsFolderTreeRequestSeq) return;
    if (list) list.innerHTML = '';
    if (errEl) errEl.textContent = `Error: ${e.message}`;
  }
}

function _docsFolderTreeRender(data) {
  _docsFolderTreeState.lastTree = data;
  _docsFolderTreeState.searchResults = null;
  _docsFolderTreeClearExplanation();
  _docsFolderTreeState.path = data.relative_folder || '.';
  _docsFolderTreeState.parentPath = data.parent_path || null;

  const pathEl = document.getElementById('docs-folder-tree-path');
  const crumbsEl = document.getElementById('docs-folder-tree-breadcrumbs');
  const list = document.getElementById('docs-folder-tree-list');
  const status = document.getElementById('docs-folder-tree-status');
  const upBtn = document.getElementById('docs-folder-tree-up');

  const currentPath = data.relative_folder || '.';
  _docsFolderTreeSetTitle(_docsFolderTreeTitleFromPath(currentPath));
  const canGoUp = !!data.parent_path && currentPath !== 'docs';
  if (pathEl) {
    pathEl.textContent = currentPath;
    pathEl.hidden = !canGoUp;
  }
  if (upBtn) {
    upBtn.hidden = !canGoUp;
    upBtn.disabled = !canGoUp;
    upBtn.closest('.docs-tree-toolbar')?.classList.toggle('docs-tree-toolbar--no-up', !canGoUp);
  }
  if (status) {
    const entries = Array.isArray(data.entries) ? data.entries.length : 0;
    const docs = Number(data.folder_document_count || 0);
    status.textContent = `${entries} item${entries === 1 ? '' : 's'} in this folder` + (docs ? `; ${docs} document${docs === 1 ? '' : 's'} from this group land here` : '');
  }

  if (crumbsEl) {
    crumbsEl.hidden = !canGoUp;
    const crumbs = (Array.isArray(data.breadcrumbs) ? data.breadcrumbs : [])
      .filter(crumb => (crumb.path || '.') !== '.');
    crumbsEl.innerHTML = crumbs.map(crumb => `
      <button class="docs-tree-crumb bp-font-role-docs-markdown" type="button" data-tree-action="browse" data-path="${esc(crumb.path || '.')}">${esc(crumb.label || '.')}</button>
    `).join('');
  }

  if (!list) return;
  const entries = Array.isArray(data.entries) ? data.entries : [];
  if (!entries.length) {
    list.innerHTML = '<div class="docs-tree-empty">This folder is empty.</div>';
    return;
  }

  list.innerHTML = entries.map(entry => _docsFolderTreeRowHtml(entry)).join('');
}

function _docsFolderTreeNormalizePath(path) {
  return String(path || '').trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '') || '.';
}

function _docsFolderTreeIsInCurrentFolder(path) {
  const current = _docsFolderTreeNormalizePath(_docsFolderTreeState.path || '.');
  const candidate = _docsFolderTreeNormalizePath(path);
  if (!candidate || candidate === '.') return false;
  if (current === '.') return true;
  return candidate === current || candidate.startsWith(`${current}/`);
}

function _docsFolderTreeResultPath(result) {
  return _docsFolderTreeNormalizePath(result?.viewer_path || result?.register_path || result?.doc_path || '');
}

function _docsFolderTreeSearchGroups(results) {
  const seen = new Set();
  const groups = [];
  (Array.isArray(results) ? results : []).forEach(result => {
    if (!result || typeof result !== 'object') return;
    const path = _docsFolderTreeResultPath(result);
    if (!_docsFolderTreeIsInCurrentFolder(path)) return;
    const key = String(result.doc_id || path).toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    groups.push({ result, path });
  });
  return groups.slice(0, 80);
}

function _docsFolderTreeRenderSearchResults(results) {
  const list = document.getElementById('docs-folder-tree-list');
  const status = document.getElementById('docs-folder-tree-status');
  if (!list) return;

  const groups = _docsFolderTreeSearchGroups(results);
  _docsFolderTreeState.searchResults = groups;
  if (!groups.length) {
    list.innerHTML = '<div class="docs-tree-empty">No matching documents in this folder.</div>';
    if (status) status.textContent = `No matches for "${_docsFolderTreeState.query}" under ${_docsFolderTreeState.path || '.'}`;
    return;
  }

  list.innerHTML = groups.map(group => _docsFolderTreeSearchRowHtml(group.result, group.path)).join('');
  if (status) {
    status.textContent = `${groups.length} matching document${groups.length === 1 ? '' : 's'} under ${_docsFolderTreeState.path || '.'}`;
  }
}

function _docsFolderTreeRowHtml(entry) {
  const type = entry.type === 'folder' ? 'folder' : 'file';
  const registered = entry.registered_doc || null;
  const primaryAction = registered ? 'open-doc' : (type === 'folder' ? 'browse' : '');
  const disabled = primaryAction ? '' : ' disabled';
  const title = registered
    ? `Open registered document: ${registered.label || entry.name}`
    : (type === 'folder' ? `Browse ${entry.name}` : 'File is not registered in Docs');
  const docAttrs = registered ? ` data-doc-id="${esc(registered.doc_id)}"` : '';
  const browseButton = type === 'folder' && registered
    ? `<button class="hub-modal-btn secondary" type="button" data-tree-action="browse" data-path="${esc(entry.path)}">Browse</button>`
    : '';
  const badge = registered ? '<span class="docs-tree-badge">Doc</span>' : '';

  return `
    <div class="docs-tree-row" data-path="${esc(entry.path)}" data-type="${esc(type)}">
      <span class="docs-tree-icon docs-tree-icon--${esc(type)}" aria-hidden="true"></span>
      <button class="docs-tree-name bp-font-role-docs-markdown" type="button" data-tree-action="${esc(primaryAction)}" data-path="${esc(entry.path)}"${docAttrs} title="${esc(title)}"${disabled}>${esc(entry.name)}</button>
      <span class="docs-tree-actions">${badge}${browseButton}</span>
    </div>
  `;
}

function _docsFolderTreeSearchRowHtml(result, path) {
  const name = path.split('/').pop() || result.title || path;
  const registered = result.openable && result.doc_id
    ? {
      doc_id: result.doc_id,
      label: result.title || name,
      path: result.viewer_path || path,
    }
    : null;
  const docAttrs = registered ? ` data-doc-id="${esc(registered.doc_id)}"` : '';
  const terms = _docsFolderTreeSearchTerms(result);
  const termsAttr = terms.length ? ` data-highlight-terms="${esc(JSON.stringify(terms))}"` : '';
  const action = registered ? 'open-doc' : '';
  const disabled = registered ? '' : ' disabled';
  const title = registered ? `Open registered document: ${registered.label}` : 'Search result is not registered in Docs';
  const badge = registered ? '<span class="docs-tree-badge">Doc</span>' : '<span class="docs-tree-badge">Found</span>';
  return `
    <div class="docs-tree-row" data-path="${esc(path)}" data-type="file">
      <span class="docs-tree-icon docs-tree-icon--file" aria-hidden="true"></span>
      <span class="docs-tree-label">
        <button class="docs-tree-name bp-font-role-docs-markdown" type="button" data-tree-action="${esc(action)}" data-path="${esc(path)}"${docAttrs}${termsAttr} title="${esc(title)}"${disabled}>${esc(result.title || name)}</button>
        <span class="docs-tree-subpath">${esc(path)}</span>
      </span>
      <span class="docs-tree-actions">${badge}</span>
    </div>
  `;
}

async function _docsFolderTreeRunSearch(opts = {}) {
  const requestSeq = opts.requestSeq || ++_docsFolderTreeRequestSeq;
  _docsFolderTreeReadSearchForm();
  const query = _docsFolderTreeState.query;
  const list = document.getElementById('docs-folder-tree-list');
  const status = document.getElementById('docs-folder-tree-status');
  const errEl = document.getElementById('docs-folder-tree-error');
  const btn = document.getElementById('docs-folder-tree-search-btn');

  if (!query) {
    if (_docsFolderTreeState.lastTree) _docsFolderTreeRender(_docsFolderTreeState.lastTree);
    return;
  }

  if (btn && !opts.fromNavigation) btn.disabled = true;
  if (errEl) errEl.textContent = '';
  _docsFolderTreeClearExplanation();
  if (status) status.textContent = `Searching ${_docsFolderTreeState.mode} under ${_docsFolderTreeState.path || '.'}...`;
  if (list) list.innerHTML = '<div class="docs-tree-loading">Searching...</div>';

  try {
    const r = await apiFetch('/api/v1/docs/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        mode: _docsFolderTreeState.mode,
        top_k: 30,
        rerank: _docsFolderTreeState.mode !== 'keyword',
        ..._docsFolderTreeScope(),
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
    if (requestSeq !== _docsFolderTreeRequestSeq) return;
    _docsFolderTreeRenderSearchResults(Array.isArray(data.results) ? data.results : []);
  } catch (e) {
    if (requestSeq !== _docsFolderTreeRequestSeq) return;
    if (list) list.innerHTML = '';
    if (errEl) errEl.textContent = `Search failed: ${e.message || e}`;
  } finally {
    if (requestSeq === _docsFolderTreeRequestSeq && btn) btn.disabled = false;
  }
}

function _docsFolderTreeClearSearch() {
  ++_docsFolderTreeRequestSeq;
  _docsFolderTreeState.query = '';
  _docsFolderTreeState.mode = 'keyword';
  _docsFolderTreeSaveSearchCache('', 'keyword');
  _docsFolderTreeState.searchResults = null;
  _docsFolderTreeClearExplanation();
  _docsFolderTreeSetSearchForm();
  if (_docsFolderTreeState.lastTree) _docsFolderTreeRender(_docsFolderTreeState.lastTree);
}

async function _docsFolderTreeExplain() {
  _docsFolderTreeReadSearchForm();
  const query = _docsFolderTreeState.query;
  const btn = document.getElementById('docs-folder-tree-explain-btn');
  const status = document.getElementById('docs-folder-tree-status');
  const errEl = document.getElementById('docs-folder-tree-error');
  if (!query) {
    if (errEl) errEl.textContent = 'Enter a search query before asking for an explanation.';
    return;
  }
  if (btn) btn.disabled = true;
  if (errEl) errEl.textContent = '';
  if (status) status.textContent = 'Synthesizing explanation...';
  try {
    const r = await apiFetch('/api/v1/docs/search/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        search_mode: _docsFolderTreeState.mode,
        max_docs: 5,
        max_chars_per_doc: 3000,
        top_k: 12,
        rerank: _docsFolderTreeState.mode !== 'keyword',
        explanation_mode: 'answer',
        ..._docsFolderTreeScope(),
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
    _docsFolderTreeState.explanation = data;
    _docsFolderTreeOpenExplanationModal();
    const display = data.display && typeof data.display === 'object' ? data.display : {};
    if (status) status.textContent = `Explanation ready from ${display.source_count || 0} source${display.source_count === 1 ? '' : 's'}.`;
  } catch (e) {
    if (errEl) errEl.textContent = `Explain failed: ${e.message || e}`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function _docsFolderTreeSyncIndex() {
  const btn = document.getElementById('docs-folder-tree-sync-btn');
  const status = document.getElementById('docs-folder-tree-status');
  const errEl = document.getElementById('docs-folder-tree-error');
  if (btn) btn.disabled = true;
  if (errEl) errEl.textContent = '';
  if (status) status.textContent = 'Updating TurboVec docs index...';
  try {
    const r = await apiFetch('/api/v1/docs/search/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: false }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
    const upstream = data.upstream && typeof data.upstream === 'object' ? data.upstream : {};
    const scanned = upstream.scanned_docs ?? null;
    const docs = upstream.total_docs ?? upstream.documents ?? upstream.docs ?? null;
    const chunks = upstream.total_chunks ?? upstream.chunks ?? null;
    const parts = [];
    if (scanned !== null) parts.push(`${scanned} scanned`);
    if (docs !== null) parts.push(`${docs} docs`);
    if (chunks !== null) parts.push(`${chunks} chunks`);
    if (status) {
      status.textContent = parts.length
        ? `Index update complete: ${parts.join(', ')}`
        : 'Index update complete.';
    }
    if (_docsFolderTreeState.query) await _docsFolderTreeRunSearch();
  } catch (e) {
    if (errEl) errEl.textContent = `Update failed: ${e.message || e}`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function _docsFolderTreeHandleAction(action, btn) {
  if (!action) return;
  if (action === 'browse') {
    const path = btn.dataset.path || '.';
    _docsFolderTreeLoad(path, ++_docsFolderTreeRequestSeq);
    return;
  }
  if (action === 'open-doc') {
    const docId = btn.dataset.docId;
    if (!docId) return;
    let highlightTerms = [];
    try {
      highlightTerms = JSON.parse(btn.dataset.highlightTerms || '[]');
    } catch (_) {
      highlightTerms = [];
    }
    const modal = document.getElementById('docs-folder-tree-modal');
    if (modal && typeof HubModal !== 'undefined') HubModal.close(modal);
    docsListOpenDoc(docId, { highlightTerms });
  }
}

// ── Drag & drop handlers ──────────────────────────────────────────────────────

async function _docsDropDocOnGroup(draggedDocId, targetGroupId) {
  const dragged = _docsAll.find(d => d.doc_id === draggedDocId);
  if (!dragged) return;
  if ((dragged.group_id || null) === targetGroupId) return; // already in this group, no-op (for header drops)
  const groupDocs = _docsAll.filter(d => targetGroupId ? d.group_id === targetGroupId : !d.group_id);
  const maxSort   = groupDocs.length > 0 ? Math.max(...groupDocs.map(d => d.sort_order)) : -10;
  try {
    await apiFetch(`/api/v1/docs/${draggedDocId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sort_order: maxSort + 10, group_id: targetGroupId || '' }),
    });
    await loadDocs();
  } catch (e) { console.error('docs drop on group failed', e); }
}

async function _docsDropDocBeforeDoc(draggedDocId, targetDocId) {
  const dragged = _docsAll.find(d => d.doc_id === draggedDocId);
  const target  = _docsAll.find(d => d.doc_id === targetDocId);
  if (!dragged || !target) return;

  const targetGroupId = target.group_id || null;
  // All docs in target's group except the dragged one, sorted
  const peers = _docsAll
    .filter(d => d.doc_id !== draggedDocId && ((targetGroupId ? d.group_id === targetGroupId : !d.group_id)))
    .sort((a, b) => (a.sort_order - b.sort_order) || a.label.localeCompare(b.label));

  // Insert dragged before target
  const insertIdx = peers.findIndex(d => d.doc_id === targetDocId);
  if (insertIdx === -1) peers.push(dragged);
  else peers.splice(insertIdx, 0, dragged);

  // Assign new sort_orders 0, 10, 20, ...
  const updates = peers.map((d, i) => ({ doc_id: d.doc_id, sort_order: i * 10, group_id: targetGroupId }));
  const changed = updates.filter(u => {
    const orig = _docsAll.find(d => d.doc_id === u.doc_id);
    return !orig || orig.sort_order !== u.sort_order || (orig.group_id || null) !== u.group_id;
  });

  try {
    await Promise.all(changed.map(u => apiFetch(`/api/v1/docs/${u.doc_id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sort_order: u.sort_order, group_id: u.group_id || '' }),
    })));
    await loadDocs();
  } catch (e) { console.error('docs reorder failed', e); }
}

async function _docsDropGroupBefore(draggedGroupId, targetGroupId) {
  const dragged = _docsGroups.find(g => g.group_id === draggedGroupId);
  const target  = _docsGroups.find(g => g.group_id === targetGroupId);
  if (!dragged || !target) return;

  const groups = [..._docsGroups]
    .filter(g => g.group_id !== draggedGroupId)
    .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));

  const insertIdx = groups.findIndex(g => g.group_id === targetGroupId);
  if (insertIdx === -1) groups.push(dragged);
  else groups.splice(insertIdx, 0, dragged);

  const updates = groups.map((g, i) => ({ group_id: g.group_id, sort_order: i * 10 }));
  const changed = updates.filter(u => {
    const orig = _docsGroups.find(g => g.group_id === u.group_id);
    return !orig || orig.sort_order !== u.sort_order;
  });

  try {
    await Promise.all(changed.map(u => apiFetch(`/api/v1/doc-groups/${u.group_id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sort_order: u.sort_order }),
    })));
    await loadDocs();
  } catch (e) { console.error('group reorder failed', e); }
}

// ── Markdown renderer (shared) ────────────────────────────────────────────────

function _mdToHtml(md) {
  // Minimal but functional markdown renderer — no external deps
  const esc2 = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const _isTableRow = s => /^\s*\|.*\|\s*$/.test(s);
  const _isTableSeparator = s => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(s);
  const _tableCells = s => {
    const core = s.trim().replace(/^\|/, '').replace(/\|$/, '');
    return core.split('|').map(c => c.trim());
  };
  const lines = md.split('\n');
  let html = '';
  let inUl = false, inOl = false, inCode = false, codeLang = '', codeBuf = '';
  const closeList = () => {
    if (inUl) { html += '</ul>'; inUl = false; }
    if (inOl) { html += '</ol>'; inOl = false; }
  };
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (!inCode && /^```/.test(line)) {
      closeList();
      inCode = true; codeLang = line.slice(3).trim(); codeBuf = ''; continue;
    }
    if (inCode) {
      if (/^```/.test(line)) {
        const langAttr = codeLang ? ` class="language-${esc2(codeLang)}"` : '';
        html += `<pre class="bp-font-role-docs-markdown" style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;overflow-x:auto;font-size:12.5px;line-height:1.5"><code class="bp-font-role-docs-markdown"${langAttr}>${esc2(codeBuf)}</code></pre>`;
        inCode = false; codeBuf = '';
      } else { codeBuf += line + '\n'; }
      continue;
    }
    const hm = line.match(/^(#{1,6})\s+(.*)/);
    if (hm) {
      closeList();
      const lvl = hm[1].length;
      const sizes   = ['1.6em','1.35em','1.15em','1em','0.95em','0.9em'];
      const margins = ['24px 0 10px','20px 0 8px','16px 0 6px','14px 0 4px','12px 0 4px','10px 0 4px'];
      html += `<h${lvl} class="bp-font-role-docs-markdown" style="font-size:${sizes[lvl-1]};font-weight:700;margin:${margins[lvl-1]};color:var(--text);border-bottom:${lvl<=2?'1px solid var(--border)':'none'};padding-bottom:${lvl<=2?'6px':'0'}">${_inlineMd(hm[2])}</h${lvl}>`;
      continue;
    }
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) {
      closeList();
      html += '<hr style="border:none;border-top:1px solid var(--border);margin:16px 0">';
      continue;
    }
    const ulm = line.match(/^(\s*)[-*+]\s+(.*)/);
    if (ulm) {
      if (!inUl) { closeList(); html += '<ul class="bp-font-role-docs-markdown" style="margin:6px 0 6px 20px;padding:0">'; inUl = true; }
      html += `<li class="bp-font-role-docs-markdown" style="margin:3px 0">${_inlineMd(ulm[2])}</li>`;
      continue;
    }
    const olm = line.match(/^(\s*)\d+\.\s+(.*)/);
    if (olm) {
      if (!inOl) { closeList(); html += '<ol class="bp-font-role-docs-markdown" style="margin:6px 0 6px 20px;padding:0">'; inOl = true; }
      html += `<li class="bp-font-role-docs-markdown" style="margin:3px 0">${_inlineMd(olm[2])}</li>`;
      continue;
    }
    const bqm = line.match(/^>\s*(.*)/);
    if (bqm) {
      closeList();
      html += `<blockquote class="bp-font-role-docs-markdown" style="margin:8px 0;padding:8px 14px;border-left:3px solid var(--accent);background:var(--surface);color:var(--text-dim);font-style:italic">${_inlineMd(bqm[1])}</blockquote>`;
      continue;
    }

    // GFM-style tables
    if (_isTableRow(line) && i + 1 < lines.length && _isTableSeparator(lines[i + 1])) {
      closeList();
      const headerCells = _tableCells(line);
      i += 1; // Skip separator row
      const bodyRows = [];
      while (i + 1 < lines.length && _isTableRow(lines[i + 1])) {
        i += 1;
        bodyRows.push(_tableCells(lines[i]));
      }

      let tableHtml = '<div style="overflow-x:auto;margin:10px 0"><table class="bp-font-role-docs-markdown" style="width:100%;border-collapse:collapse;font-size:13px">';
      tableHtml += '<thead><tr>';
      for (const cell of headerCells) {
        tableHtml += `<th class="bp-font-role-table-header bp-font-role-docs-markdown" style="text-align:left;padding:7px 9px;border:1px solid var(--border);background:var(--bg)">${_inlineMd(cell)}</th>`;
      }
      tableHtml += '</tr></thead><tbody>';
      for (const row of bodyRows) {
        tableHtml += '<tr>';
        for (let c = 0; c < headerCells.length; c++) {
          tableHtml += `<td class="bp-font-role-table-content bp-font-role-docs-markdown" style="padding:7px 9px;border:1px solid var(--border)">${_inlineMd(row[c] || '')}</td>`;
        }
        tableHtml += '</tr>';
      }
      tableHtml += '</tbody></table></div>';
      html += tableHtml;
      continue;
    }

    closeList();
    if (!line.trim()) { html += '<div style="height:8px"></div>'; continue; }
    html += `<p class="bp-font-role-docs-markdown" style="margin:4px 0">${_inlineMd(line)}</p>`;
  }
  if (inCode) html += `<pre class="bp-font-role-docs-markdown" style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;overflow-x:auto"><code class="bp-font-role-docs-markdown">${esc2(codeBuf)}</code></pre>`;
  closeList();
  return html;
}

function _inlineMd(s) {
  // Stash code spans before any other processing so their content is never
  // touched by bold/italic/link regexes, and so HTML-special chars inside them
  // (e.g. `<dialog>`) are escaped correctly instead of injected as raw HTML.
  const stash = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    const idx = stash.length;
    stash.push(`<code class="bp-font-role-docs-markdown" style="background:var(--surface);border:1px solid var(--border);border-radius:3px;padding:1px 5px;font-size:0.88em">${c.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</code>`);
    return `\x00${idx}\x00`;
  });
  // HTML-escape the remaining (non-code) text
  s = s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  s = s
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong class="bp-font-role-docs-markdown"><em class="bp-font-role-docs-markdown">$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="bp-font-role-docs-markdown">$1</strong>')
    // __ bold: only match when not adjacent to a word character (avoids snake__case)
    .replace(/(?<![a-zA-Z0-9])__([^_]+)__(?![a-zA-Z0-9])/g, '<strong class="bp-font-role-docs-markdown">$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em class="bp-font-role-docs-markdown">$1</em>')
    // _ italic: only match when not adjacent to a word character (avoids snake_case)
    .replace(/(?<![a-zA-Z0-9])_([^_\n]+)_(?![a-zA-Z0-9])/g, '<em class="bp-font-role-docs-markdown">$1</em>')
    .replace(/~~([^~]+)~~/g, '<del class="bp-font-role-docs-markdown">$1</del>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
      // Old API format: /api/v1/doc-images/UUID/file (backward compatible)
      let m = src.match(/\/api\/v1\/doc-images\/([a-f0-9-]+)\/file/);
      // New standard format: doc-images/UUID/filename.ext (Obsidian-compatible relative path)
      if (!m) m = src.match(/(?:^|.*\/)doc-images\/([a-f0-9-]+)\//);
      return `<img class="bp-font-role-docs-markdown"${m ? ` data-doc-img="${m[1]}"` : ''} src="${src}" alt="${alt}" style="max-width:100%;border-radius:4px;margin:8px 0;display:block" />`;
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => {
      // Internal doc link: relative .md path that isn't an absolute URL
      const isDocLink = href && !href.match(/^https?:\/\/|^\/\//) && /\.md$/i.test(href);
      if (isDocLink) {
        const safeHref = href.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        return `<a class="bp-font-role-docs-markdown" href="#" onclick="docsOpenByPath('${safeHref}'); return false;" style="color:var(--accent);text-decoration:underline;text-decoration-style:dashed" title="Open: ${href}">${text}</a>`;
      }
      return `<a class="bp-font-role-docs-markdown" href="${href}" style="color:var(--accent);text-decoration:underline" target="_blank" rel="noopener noreferrer">${text}</a>`;
    })
    // Auto-link bare https:// URLs not already inside an HTML attribute value
    .replace(/(?<![="'])https?:\/\/[^\s<>")\]]+/g, url => {
      const m = url.match(/^(.+?)([.,;:!?)]+)$/);
      const href  = m ? m[1] : url;
      const trail = m ? m[2] : '';
      return `<a class="bp-font-role-docs-markdown" href="${href}" style="color:var(--accent);text-decoration:underline" target="_blank" rel="noopener noreferrer">${href}</a>${trail}`;
    });
  // Restore stashed code spans
  s = s.replace(/\x00(\d+)\x00/g, (_, i) => stash[Number(i)]);
  return s;
}

// Navigate to a doc by relative path or basename (called from inline preview links)
function docsOpenByPath(href) {
  // 1. Exact match against stored path (e.g. href already is "docs/security/README.md")
  let doc = _docsAll.find(d => d.path && d.path.toLowerCase() === href.toLowerCase());

  // 2. Resolve relative to the current document's directory (standard markdown behaviour).
  //    e.g. current doc is "docs/security/SECURITY.md", href is "README.md"
  //    → resolves to "docs/security/README.md"
  if (!doc && _docsActiveId) {
    const cur = _docsAll.find(d => d.doc_id === _docsActiveId);
    if (cur && cur.path) {
      const curDir = cur.path.split('/').slice(0, -1).join('/');
      const parts  = (curDir + '/' + href).split('/');
      const resolved = [];
      for (const p of parts) {
        if (p === '..') resolved.pop();
        else if (p !== '.') resolved.push(p);
      }
      const resolvedPath = resolved.join('/');
      doc = _docsAll.find(d => d.path && d.path.toLowerCase() === resolvedPath.toLowerCase());
    }
  }

  // 3. Basename fallback — last resort for unambiguous filenames
  if (!doc) {
    const base = href.split('/').pop().toLowerCase();
    doc = _docsAll.find(d => {
      if (!d.path) return false;
      return d.path.split('/').pop().toLowerCase() === base;
    });
  }
  if (!doc) {
    const status = document.getElementById('docs-status');
    if (status) {
      status.textContent = `\u2717 Doc not found: ${href}`;
      status.style.color = '#f87171';
      status.hidden = false;
      setTimeout(() => { status.hidden = true; }, 4000);
    }
    return;
  }
  if (doc.doc_id === _docsActiveId) {
    _docsOpenDoc(doc.doc_id);
  } else {
    docsSelectDoc(doc.doc_id);
  }
}

// ── Add existing document modal ─────────────────────────────────────────────

let _addDocAllFiles  = []; // all unregistered paths from API
let _addDocFiltered  = []; // currently filtered subset

async function openAddDocModal() {
  // Reset form fields
  document.getElementById('add-doc-filter').value      = '';
  document.getElementById('add-doc-modal-label').value = '';
  document.getElementById('add-doc-modal-desc').value  = '';
  document.getElementById('add-doc-modal-tags').value  = 'menu';
  document.getElementById('add-doc-modal-order').value = String(_docsAll.length * 10);
  document.getElementById('add-doc-modal-error').textContent = '';
  _docsPopulateGroupSelect(null, 'add-doc-modal-group');

  const fileList  = document.getElementById('add-doc-file-list');
  const countEl   = document.getElementById('add-doc-file-count');
  fileList.innerHTML = '<option disabled value="">Loading…</option>';
  countEl.textContent = '';
  _addDocAllFiles = [];
  _addDocFiltered = [];

  HubModal.open(document.getElementById('add-doc-modal'));

  try {
    const r = await apiFetch('/api/v1/docs/unregistered');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _addDocAllFiles = await r.json();
  } catch (e) {
    fileList.innerHTML = '<option disabled value="">Failed to load files</option>';
    document.getElementById('add-doc-modal-error').textContent = `Error loading files: ${e.message}`;
    return;
  }

  _addDocApplyFilter();
  setTimeout(() => document.getElementById('add-doc-filter').focus(), 50);
}

function _addDocApplyFilter() {
  const term = (document.getElementById('add-doc-filter').value || '').toLowerCase();
  _addDocFiltered = _addDocAllFiles.filter(p => !term || p.toLowerCase().includes(term));

  const sel  = document.getElementById('add-doc-file-list');
  const prev = sel.value;
  sel.innerHTML = '';
  _addDocFiltered.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    sel.appendChild(opt);
  });
  if (prev && _addDocFiltered.includes(prev)) sel.value = prev;

  const shown = _addDocFiltered.length;
  const total = _addDocAllFiles.length;
  const countEl = document.getElementById('add-doc-file-count');
  if (total === 0) {
    countEl.textContent = 'No unregistered .md files found.';
  } else if (shown === total) {
    countEl.textContent = `${total} unregistered file${total === 1 ? '' : 's'}`;
  } else {
    countEl.textContent = `${shown} of ${total} files`;
  }
}

function _addDocAutoFillLabel(path) {
  if (!path) return;
  const labelEl = document.getElementById('add-doc-modal-label');
  const basename = path.split('/').pop().replace(/\.[^.]+$/, '');
  labelEl.value = basename.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

async function _addDocSubmit() {
  const fileList = document.getElementById('add-doc-file-list');
  const path     = fileList.value;
  const label    = document.getElementById('add-doc-modal-label').value.trim();
  const desc     = document.getElementById('add-doc-modal-desc').value.trim();
  const tags     = document.getElementById('add-doc-modal-tags').value.trim();
  const order    = parseInt(document.getElementById('add-doc-modal-order').value, 10) || 0;
  const groupId  = document.getElementById('add-doc-modal-group')?.value || '';
  const errEl    = document.getElementById('add-doc-modal-error');

  if (!path)  { errEl.textContent = 'Please select a file from the list.'; return; }
  if (!label) { errEl.textContent = 'Label is required.'; return; }

  const submit = document.getElementById('add-doc-modal-submit');
  submit.disabled = true;
  errEl.textContent = '';
  try {
    // Do NOT send initial_content — we're registering an existing file, not creating one.
    const body = { label, description: desc || null, tags: tags || null, path, sort_order: order, group_id: groupId || null };
    const r = await apiFetch('/api/v1/docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || `HTTP ${r.status}`); }
    const created = await r.json();
    HubModal.close(document.getElementById('add-doc-modal'));
    await loadDocs();
    docsSelectDoc(created.doc_id);
  } catch (e) {
    errEl.textContent = `Error: ${e.message}`;
  } finally {
    submit.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // New / Edit doc modal submit
  const docsSubmitBtn = document.getElementById('docs-modal-submit');
  if (docsSubmitBtn) {
    docsSubmitBtn.addEventListener('click', () => {
      if (_docsCurrentModalMode === 'new') _docsModalSubmit();
      else _docsModalSubmitEdit();
    });
  }

  // Add existing doc modal wiring
  const addDocFilter = document.getElementById('add-doc-filter');
  if (addDocFilter) addDocFilter.addEventListener('input', _addDocApplyFilter);

  const addDocList = document.getElementById('add-doc-file-list');
  if (addDocList) addDocList.addEventListener('change', () => _addDocAutoFillLabel(addDocList.value));

  const addDocSubmit = document.getElementById('add-doc-modal-submit');
  if (addDocSubmit) addDocSubmit.addEventListener('click', _addDocSubmit);

  const docsGroupSubmit = document.getElementById('docs-group-modal-submit');
  if (docsGroupSubmit) docsGroupSubmit.addEventListener('click', _docsSubmitGroupModal);

  const docsGroupInput = document.getElementById('docs-group-modal-name');
  if (docsGroupInput) {
    docsGroupInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        _docsSubmitGroupModal();
      }
    });
  }

  const docsDeleteBtn = document.getElementById('docs-delete-confirm-btn');
  if (docsDeleteBtn) docsDeleteBtn.addEventListener('click', submitDeleteDoc);

  const docsFolderTreeList = document.getElementById('docs-folder-tree-list');
  if (docsFolderTreeList) {
    docsFolderTreeList.addEventListener('click', e => {
      const btn = e.target.closest('[data-tree-action]');
      if (!btn || !docsFolderTreeList.contains(btn)) return;
      _docsFolderTreeHandleAction(btn.dataset.treeAction || '', btn);
    });
  }

  const docsFolderTreeCrumbs = document.getElementById('docs-folder-tree-breadcrumbs');
  if (docsFolderTreeCrumbs) {
    docsFolderTreeCrumbs.addEventListener('click', e => {
      const btn = e.target.closest('[data-tree-action="browse"]');
      if (!btn || !docsFolderTreeCrumbs.contains(btn)) return;
      _docsFolderTreeHandleAction('browse', btn);
    });
  }

  const docsFolderTreeUp = document.getElementById('docs-folder-tree-up');
  if (docsFolderTreeUp) {
    docsFolderTreeUp.addEventListener('click', () => {
      if (_docsFolderTreeState.parentPath) _docsFolderTreeLoad(_docsFolderTreeState.parentPath, ++_docsFolderTreeRequestSeq);
    });
  }

  const docsFolderTreeSearchForm = document.getElementById('docs-folder-tree-search-form');
  if (docsFolderTreeSearchForm) {
    docsFolderTreeSearchForm.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      _docsFolderTreeRunSearch();
    }, true);
    docsFolderTreeSearchForm.addEventListener('submit', e => {
      e.preventDefault();
      e.stopPropagation();
      _docsFolderTreeRunSearch();
    });
  }

  document.getElementById('docs-folder-tree-search-btn')?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    _docsFolderTreeRunSearch();
  });
  document.getElementById('docs-folder-tree-explain-btn')?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    _docsFolderTreeExplain();
  });
  document.getElementById('docs-folder-tree-explain-sources-btn')?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    _docsFolderTreeOpenSourcesModal();
  });
  document.getElementById('docs-folder-tree-explain-sources')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-source-path]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    _docsFolderTreeOpenSourceDoc(btn.dataset.sourcePath || '');
  });
  document.getElementById('docs-folder-tree-status-pill')?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    _docsFolderTreeOpenStatusModal();
  });
  document.getElementById('docs-folder-tree-explain-speaker')?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    _docsFolderTreeHandleExplainSpeakerClick();
  });
  document.getElementById('docs-folder-tree-explain-speaker')?.addEventListener('dblclick', e => {
    e.preventDefault();
    e.stopPropagation();
    _docsFolderTreeHandleExplainSpeakerDoubleClick();
  });
  document.getElementById('docs-folder-tree-clear-btn')?.addEventListener('click', _docsFolderTreeClearSearch);
  document.getElementById('docs-folder-tree-sync-btn')?.addEventListener('click', _docsFolderTreeSyncIndex);
  document.getElementById('docs-folder-tree-mode')?.addEventListener('change', _docsFolderTreeReadSearchForm);
});
