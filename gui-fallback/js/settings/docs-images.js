// ── Docs Images ──────────────────────────────────────────────────────────────
// _docsImgCache and _docsImgBlobUrl() are defined in docs.js (global scope)

let _docImagesAll = [];
let _docImagesFilter = 'all';
let _docImagesTagFilter = '';
let _docImagesNameFilter = '';
let _docImagesDateFilter = 'any';
let _docImagesSort = 'newest';
let _docImagesView = 'medium';
let _docImagesPage = 0;
let _docImgDescTimers = {};
let _docImgDeleteTarget = null;
let _docImgResizeTimer = null;
const _DOC_IMG_VIEW_LS_KEY = 'blueprintsDocsImagesView';

function _docImgRequestFillResize() {
  if (window.BodyShade && typeof window.BodyShade.scheduleSizeFillTable === 'function') {
    window.BodyShade.scheduleSizeFillTable();
  }
}

function _getDocImgPagerEl() {
  return document.getElementById('doc-img-pagination');
}

function openDocImagesModal() {
  _loadDocImagesViewPref();
  _syncDocImageControls();
  _loadDocImages();
}

async function _loadDocImages() {
  const list = document.getElementById('doc-images-list');
  const summary = document.getElementById('doc-img-results-summary');
  const pager = _getDocImgPagerEl();
  if (list) {
    list.innerHTML = '<div class="doc-img-empty">Loading images…</div>';
  }
  if (summary) {
    summary.textContent = 'Loading images…';
  }
  if (pager) {
    pager.innerHTML = '';
    pager.hidden = true;
  }
  _docImgRequestFillResize();

  const url = _docImagesFilter === 'unused'
    ? '/api/v1/doc-images?unused=true'
    : '/api/v1/doc-images';

  try {
    const r = await apiFetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _docImagesAll = await r.json();
  } catch (e) {
    _docImagesAll = [];
    if (list) {
      list.innerHTML = `<div class="doc-img-empty">Failed to load images: ${esc(e.message)}</div>`;
    }
    if (summary) {
      summary.textContent = 'Image loading failed';
    }
    _refreshDocImgTagSelect();
    _docImgRequestFillResize();
    return;
  }

  _renderDocImagesList();
}

function _docImagesSetFilter(value) {
  if (_docImagesFilter === value) return;
  _docImagesFilter = value;
  _docImagesPage = 0;
  _syncDocImageControls();
  _loadDocImages();
}

function _docImagesSetTagFilter(tag) {
  _docImagesTagFilter = tag;
  _docImagesPage = 0;
  _renderDocImagesList();
}

function _docImagesSetNameFilter(value) {
  _docImagesNameFilter = value.trim().toLowerCase();
  _docImagesPage = 0;
  _renderDocImagesList();
}

function _docImagesSetDateFilter(value) {
  _docImagesDateFilter = value;
  _docImagesPage = 0;
  _renderDocImagesList();
}

function _docImagesSetSort(value) {
  _docImagesSort = value;
  _docImagesPage = 0;
  _renderDocImagesList();
}

function _docImagesSetView(value) {
  _docImagesView = value;
  _docImagesPage = 0;
  try { localStorage.setItem(_DOC_IMG_VIEW_LS_KEY, value); } catch {}
  _syncDocImageControls();
  _renderDocImagesList();
}

function _loadDocImagesViewPref() {
  try {
    const saved = localStorage.getItem(_DOC_IMG_VIEW_LS_KEY);
    if (saved && ['detail', 'small', 'medium', 'large'].includes(saved)) {
      _docImagesView = saved;
    }
  } catch {}
}

function _syncDocImageControls() {
  const search = document.getElementById('doc-img-search');
  const usage = document.getElementById('doc-img-usage-filter');
  const tag = document.getElementById('doc-img-tag-filter');
  const date = document.getElementById('doc-img-date-filter');
  const sort = document.getElementById('doc-img-sort');
  const view = document.getElementById('doc-img-view');
  if (search) search.value = _docImagesNameFilter;
  if (usage) usage.value = _docImagesFilter;
  if (tag) tag.value = _docImagesTagFilter;
  if (date) date.value = _docImagesDateFilter;
  if (sort) sort.value = _docImagesSort;
  if (view) view.value = _docImagesView;
}

function _getAllTags() {
  const set = new Set();
  _docImagesAll.forEach(img => {
    if (Array.isArray(img.tags)) img.tags.forEach(tag => tag && set.add(tag));
  });
  return [...set].sort((a, b) => a.localeCompare(b));
}

function _refreshDocImgTagSelect() {
  const tagSel = document.getElementById('doc-img-tag-filter');
  if (!tagSel) return;

  const allTags = _getAllTags();
  if (_docImagesTagFilter && !allTags.includes(_docImagesTagFilter)) {
    _docImagesTagFilter = '';
  }

  const current = _docImagesTagFilter;
  tagSel.innerHTML = '<option value="">All tags</option>';
  allTags.forEach(tag => {
    const opt = document.createElement('option');
    opt.value = tag;
    opt.textContent = tag;
    if (tag === current) opt.selected = true;
    tagSel.appendChild(opt);
  });
}

function _getDocImagePageSize() {
  if (_docImagesView === 'large') {
    if (window.innerWidth <= 768) return 6;
    return 8;
  }
  if (_docImagesView === 'detail') {
    if (window.innerWidth <= 768) return 8;
    return 10;
  }
  if (_docImagesView === 'small') {
    if (window.innerWidth <= 640) return 10;
    if (window.innerWidth <= 1100) return 15;
    return 24;
  }
  if (window.innerWidth <= 640) return 8;
  if (window.innerWidth <= 1100) return 12;
  return 18;
}

function _matchesDocImgSearch(img) {
  if (!_docImagesNameFilter) return true;
  const haystack = [
    img.filename || '',
    img.description || '',
    Array.isArray(img.tags) ? img.tags.join(' ') : '',
  ].join(' ').toLowerCase();
  return haystack.includes(_docImagesNameFilter);
}

function _matchesDocImgDate(img) {
  if (_docImagesDateFilter === 'any') return true;
  if (!img.created_at) return false;

  const created = new Date(img.created_at);
  if (Number.isNaN(created.getTime())) return false;

  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (_docImagesDateFilter === 'today') {
    return created >= startToday;
  }
  if (_docImagesDateFilter === 'year') {
    return created.getFullYear() === now.getFullYear();
  }

  const days = _docImagesDateFilter === '7d' ? 7
    : _docImagesDateFilter === '30d' ? 30
    : _docImagesDateFilter === '90d' ? 90
    : 0;
  if (!days) return true;
  const cutoff = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));
  return created >= cutoff;
}

function _sortDocImages(items) {
  items.sort((a, b) => {
    const aName = (a.filename || '').toLowerCase();
    const bName = (b.filename || '').toLowerCase();
    const aSize = a.file_size || 0;
    const bSize = b.file_size || 0;
    const aTime = a.created_at ? Date.parse(a.created_at) || 0 : 0;
    const bTime = b.created_at ? Date.parse(b.created_at) || 0 : 0;

    switch (_docImagesSort) {
      case 'oldest':
        return aTime - bTime || aName.localeCompare(bName);
      case 'name-asc':
        return aName.localeCompare(bName);
      case 'name-desc':
        return bName.localeCompare(aName);
      case 'size-asc':
        return aSize - bSize || aName.localeCompare(bName);
      case 'size-desc':
        return bSize - aSize || aName.localeCompare(bName);
      case 'newest':
      default:
        return bTime - aTime || aName.localeCompare(bName);
    }
  });
  return items;
}

function _getFilteredDocImages() {
  const items = _docImagesAll.filter(img => {
    if (_docImagesTagFilter && !(Array.isArray(img.tags) && img.tags.includes(_docImagesTagFilter))) return false;
    if (!_matchesDocImgSearch(img)) return false;
    if (!_matchesDocImgDate(img)) return false;
    return true;
  });
  return _sortDocImages(items);
}

function _renderDocImagesList() {
  const list = document.getElementById('doc-images-list');
  const summary = document.getElementById('doc-img-results-summary');
  const pager = _getDocImgPagerEl();
  if (!list) return;

  _refreshDocImgTagSelect();

  const items = _getFilteredDocImages();
  const totalCount = _docImagesAll.length;
  const pageSize = _getDocImagePageSize();
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  if (_docImagesPage >= totalPages) _docImagesPage = totalPages - 1;

  if (summary) {
    const scopeLabel = _docImagesFilter === 'unused' ? 'unused images' : 'images';
    const filterLabel = items.length === totalCount
      ? `${totalCount} ${scopeLabel}`
      : `${items.length} shown of ${totalCount} ${scopeLabel}`;
    summary.textContent = `${filterLabel} • page ${_docImagesPage + 1} of ${totalPages}`;
  }

  list.innerHTML = '';

  if (!items.length) {
    list.innerHTML = '<div class="doc-img-empty">No images match the current filters.</div>';
    _renderDocImgPager(0);
    return;
  }

  const start = _docImagesPage * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  const grid = document.createElement('div');
  grid.className = `doc-img-grid doc-img-grid--${_docImagesView}`;
  pageItems.forEach(img => grid.appendChild(_buildImgCard(img)));
  list.appendChild(grid);

  if (pager) {
    _renderDocImgPager(totalPages);
  }
}

function _buildImgCard(img) {
  const isBrowseOnlyView = _docImagesView === 'small';
  const showTagSuggestions = _docImagesView === 'detail';
  const card = document.createElement('article');
  card.className = 'doc-img-card';
  card.id = `doc-img-row-${img.image_id}`;

  const previewLink = document.createElement('a');
  previewLink.className = 'doc-img-preview-link';
  previewLink.href = `/api/v1/doc-images/${img.image_id}/file`;
  previewLink.target = '_blank';
  previewLink.rel = 'noopener noreferrer';

  const thumb = document.createElement('img');
  thumb.className = 'doc-img-preview';
  thumb.alt = img.description || img.filename;
  _loadThumb(img.image_id, thumb);
  previewLink.appendChild(thumb);

  const body = document.createElement('div');
  body.className = 'doc-img-card-body';

  const head = document.createElement('div');
  head.className = 'doc-img-card-head';
  const filename = document.createElement('div');
  filename.className = 'doc-img-filename';
  filename.textContent = img.filename;
  const meta = document.createElement('div');
  meta.className = 'doc-img-meta';
  meta.textContent = `${_fmtBytes(img.file_size || 0)}${img.created_at ? ` • ${_fmtDate(img.created_at)}` : ''}`;
  head.appendChild(filename);
  head.appendChild(meta);

  const descField = document.createElement('div');
  descField.className = `doc-img-field${isBrowseOnlyView ? ' doc-img-field--compact' : ''}`;
  if (isBrowseOnlyView) {
    const descText = document.createElement('div');
    descText.className = 'doc-img-compact-text';
    descText.textContent = (img.description || '').trim() || 'No description';
    if (!(img.description || '').trim()) descText.classList.add('is-empty');
    descField.appendChild(descText);
  } else {
    const descLabel = document.createElement('label');
    descLabel.textContent = 'Description';
    const descInput = document.createElement('textarea');
    descInput.className = 'doc-img-input doc-img-input--textarea';
    descInput.rows = 1;
    descInput.placeholder = 'Description';
    descInput.value = img.description || '';
    _docImgAutoSizeField(descInput);
    descInput.addEventListener('input', () => {
      _docImgAutoSizeField(descInput);
      clearTimeout(_docImgDescTimers[img.image_id]);
      _docImgDescTimers[img.image_id] = setTimeout(
        () => _saveDocImgDesc(img.image_id, descInput.value),
        700
      );
    });
    descField.appendChild(descLabel);
    descField.appendChild(descInput);
  }

  const tagsField = document.createElement('div');
  const knownTags = _getAllTags();
  tagsField.className = `doc-img-field${isBrowseOnlyView ? ' doc-img-field--compact' : ''}`;
  if (isBrowseOnlyView) {
    const staticTags = document.createElement('div');
    staticTags.className = 'doc-img-static-tags';
    const tags = Array.isArray(img.tags) ? img.tags : [];
    if (tags.length) {
      tags.forEach(tag => {
        const pill = document.createElement('span');
        pill.className = 'doc-img-static-tag';
        pill.textContent = tag;
        staticTags.appendChild(pill);
      });
    } else {
      const empty = document.createElement('span');
      empty.className = 'doc-img-static-tag is-empty';
      empty.textContent = 'No tags';
      staticTags.appendChild(empty);
    }
    tagsField.appendChild(staticTags);
  } else {
    const tagsLabel = document.createElement('label');
    tagsLabel.textContent = 'Tags';
    const tagsInput = document.createElement('input');
    tagsInput.className = 'doc-img-input';
    tagsInput.type = 'text';
    tagsInput.placeholder = 'comma, separated, tags';
    tagsInput.value = Array.isArray(img.tags) ? img.tags.join(', ') : '';
    tagsInput.addEventListener('input', () => {
      clearTimeout(_docImgDescTimers[`tags_${img.image_id}`]);
      _docImgDescTimers[`tags_${img.image_id}`] = setTimeout(
        () => _saveDocImgTags(img.image_id, tagsInput.value),
        700
      );
    });
    tagsField.appendChild(tagsLabel);
    tagsField.appendChild(tagsInput);

    if (showTagSuggestions && knownTags.length) {
      const pills = document.createElement('div');
      pills.className = 'doc-img-tag-pills';
      knownTags.forEach(tag => {
        const pill = document.createElement('button');
        pill.className = 'secondary doc-img-tag-pill';
        pill.type = 'button';
        pill.textContent = tag;
        pill.addEventListener('click', () => {
          const current = tagsInput.value.split(',').map(t => t.trim()).filter(Boolean);
          if (current.includes(tag)) return;
          current.push(tag);
          tagsInput.value = current.join(', ');
          clearTimeout(_docImgDescTimers[`tags_${img.image_id}`]);
          _docImgDescTimers[`tags_${img.image_id}`] = setTimeout(
            () => _saveDocImgTags(img.image_id, tagsInput.value),
            50
          );
        });
        pills.appendChild(pill);
      });
      tagsField.appendChild(pills);
    }
  }

  const snippetWrap = document.createElement('div');
  snippetWrap.className = 'doc-img-snippet';
  const snippetCode = document.createElement('code');
  snippetCode.className = 'doc-img-snippet-code bp-font-role-docs-markdown';
  const markdownSnippet = _docImgMarkdownSnippet(img);
  snippetCode.textContent = markdownSnippet;
  snippetCode.title = markdownSnippet;
  snippetWrap.appendChild(snippetCode);

  const actions = document.createElement('div');
  actions.className = 'doc-img-actions';
  const actionsLeft = document.createElement('div');
  actionsLeft.className = 'doc-img-actions-left';
  const actionsRight = document.createElement('div');
  actionsRight.className = 'doc-img-actions-right';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'secondary doc-img-copy-btn';
  copyBtn.type = 'button';
  copyBtn.textContent = 'Copy Markdown';
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(markdownSnippet).then(() => {
      copyBtn.textContent = 'Copied';
      setTimeout(() => {
        copyBtn.textContent = 'Copy Markdown';
      }, 1400);
    }).catch(() => {
      copyBtn.textContent = 'Copy failed';
      setTimeout(() => {
        copyBtn.textContent = 'Copy Markdown';
      }, 1400);
    });
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'danger doc-img-delete-btn';
  deleteBtn.type = 'button';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => _openDocImgDeleteModal(img));

  actionsLeft.appendChild(copyBtn);
  actionsRight.appendChild(deleteBtn);
  actions.appendChild(actionsLeft);
  actions.appendChild(actionsRight);

  body.appendChild(head);
  body.appendChild(descField);
  body.appendChild(tagsField);
  body.appendChild(snippetWrap);
  body.appendChild(actions);

  card.appendChild(previewLink);
  card.appendChild(body);
  return card;
}

function _renderDocImgPager(totalPages) {
  const pager = _getDocImgPagerEl();
  if (!pager) return;

  pager.innerHTML = '';
  pager.hidden = totalPages <= 1;
  if (pager.hidden) {
    _docImgRequestFillResize();
    return;
  }

  const prevBtn = document.createElement('button');
  prevBtn.className = 'secondary';
  prevBtn.type = 'button';
  prevBtn.textContent = 'Prev';
  prevBtn.disabled = _docImagesPage === 0;
  prevBtn.addEventListener('click', () => {
    if (_docImagesPage === 0) return;
    _docImagesPage -= 1;
    _renderDocImagesList();
  });

  const info = document.createElement('span');
  info.className = 'doc-img-pager-info';
  info.textContent = `Page ${_docImagesPage + 1} of ${totalPages}`;

  const nextBtn = document.createElement('button');
  nextBtn.className = 'secondary';
  nextBtn.type = 'button';
  nextBtn.textContent = 'Next';
  nextBtn.disabled = _docImagesPage >= totalPages - 1;
  nextBtn.addEventListener('click', () => {
    if (_docImagesPage >= totalPages - 1) return;
    _docImagesPage += 1;
    _renderDocImagesList();
  });

  pager.appendChild(prevBtn);
  pager.appendChild(info);
  pager.appendChild(nextBtn);
  _docImgRequestFillResize();
}

async function _loadThumb(imageId, imgEl) {
  const url = await _docsImgBlobUrl(imageId);
  if (url) imgEl.src = url;
}

function _openDocImgDeleteModal(img) {
  _docImgDeleteTarget = img;
  const msg = document.getElementById('doc-img-delete-message');
  const err = document.getElementById('doc-img-delete-error');
  const recordBtn = document.getElementById('doc-img-delete-record-btn');
  const fileBtn = document.getElementById('doc-img-delete-file-btn');
  if (msg) msg.textContent = `Delete "${img.filename}" from the image library?`;
  if (err) err.textContent = '';
  if (recordBtn) recordBtn.disabled = false;
  if (fileBtn) fileBtn.disabled = false;
  HubModal.open(document.getElementById('doc-img-delete-modal'));
}

async function _submitDocImgDelete(deleteFile) {
  if (!_docImgDeleteTarget) return;
  const err = document.getElementById('doc-img-delete-error');
  const recordBtn = document.getElementById('doc-img-delete-record-btn');
  const fileBtn = document.getElementById('doc-img-delete-file-btn');
  if (err) err.textContent = '';
  if (recordBtn) recordBtn.disabled = true;
  if (fileBtn) fileBtn.disabled = true;

  try {
    const img = _docImgDeleteTarget;
    const url = deleteFile
      ? `/api/v1/doc-images/${img.image_id}?delete_file=true`
      : `/api/v1/doc-images/${img.image_id}`;
    const r = await apiFetch(url, { method: 'DELETE' });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.detail || `HTTP ${r.status}`);
    }

    if (deleteFile && _docsImgCache[img.image_id]) {
      URL.revokeObjectURL(_docsImgCache[img.image_id]);
      delete _docsImgCache[img.image_id];
    }

    _docImagesAll = _docImagesAll.filter(item => item.image_id !== img.image_id);
    HubModal.close(document.getElementById('doc-img-delete-modal'));
    _docImgDeleteTarget = null;
    _renderDocImagesList();
  } catch (e) {
    if (err) err.textContent = `Error: ${e.message}`;
  } finally {
    if (recordBtn) recordBtn.disabled = false;
    if (fileBtn) fileBtn.disabled = false;
  }
}

async function _saveDocImgDesc(imageId, description) {
  const img = _docImagesAll.find(item => item.image_id === imageId);
  if (img) img.description = description;
  await apiFetch(`/api/v1/doc-images/${imageId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
}

async function _saveDocImgTags(imageId, tagsStr) {
  const tags = tagsStr.split(',').map(tag => tag.trim()).filter(Boolean);
  const img = _docImagesAll.find(item => item.image_id === imageId);
  if (img) img.tags = tags;
  await apiFetch(`/api/v1/doc-images/${imageId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags }),
  });
  _refreshDocImgTagSelect();
}

async function submitDocImageUpload() {
  const fileInput = document.getElementById('doc-img-upload-file');
  const descInput = document.getElementById('doc-img-upload-desc');
  const statusEl = document.getElementById('doc-img-upload-status');
  if (!fileInput || !statusEl || !descInput) return;

  const description = descInput.value.trim();
  if (!fileInput.files.length) {
    statusEl.textContent = 'Select an image file first.';
    return;
  }

  const fd = new FormData();
  fd.append('file', fileInput.files[0]);
  fd.append('description', description);
  statusEl.textContent = 'Uploading…';

  try {
    const r = await apiFetch('/api/v1/doc-images', { method: 'POST', body: fd });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${r.status}`);
    }

    const newImg = await r.json();
    fileInput.value = '';
    descInput.value = '';
    _docImagesAll.unshift(newImg);
    _docImagesPage = 0;
    const mdSnip = _docImgMarkdownSnippet(newImg);
    navigator.clipboard.writeText(mdSnip).catch(() => {});
    statusEl.textContent = 'Uploaded. Markdown copied to clipboard.';
    _renderDocImagesList();
    setTimeout(() => {
      if (statusEl.textContent === 'Uploaded. Markdown copied to clipboard.') {
        statusEl.textContent = '';
      }
    }, 3000);
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
  }
}

function _docImgMarkdownSnippet(img) {
  return `![${img.filename}](/api/v1/doc-images/${img.image_id}/file)`;
}

function _docImgAutoSizeField(el) {
  if (!el) return;
  el.style.height = 'auto';
  const nextHeight = Math.min(Math.max(el.scrollHeight, 34), 180);
  el.style.height = `${nextHeight}px`;
}

function _fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function _fmtDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 10);
}

document.addEventListener('DOMContentLoaded', () => {
  _loadDocImagesViewPref();
  _syncDocImageControls();

  const uploadBtn = document.getElementById('doc-img-upload-btn');
  if (uploadBtn) uploadBtn.addEventListener('click', submitDocImageUpload);

  const search = document.getElementById('doc-img-search');
  const usage = document.getElementById('doc-img-usage-filter');
  const tag = document.getElementById('doc-img-tag-filter');
  const date = document.getElementById('doc-img-date-filter');
  const sort = document.getElementById('doc-img-sort');
  const view = document.getElementById('doc-img-view');

  if (search) search.addEventListener('input', e => _docImagesSetNameFilter(e.target.value));
  if (usage) usage.addEventListener('change', e => _docImagesSetFilter(e.target.value));
  if (tag) tag.addEventListener('change', e => _docImagesSetTagFilter(e.target.value));
  if (date) date.addEventListener('change', e => _docImagesSetDateFilter(e.target.value));
  if (sort) sort.addEventListener('change', e => _docImagesSetSort(e.target.value));
  if (view) view.addEventListener('change', e => _docImagesSetView(e.target.value));

  if (typeof HubSelect !== 'undefined') {
    HubSelect.init('doc-img-usage-filter');
    HubSelect.init('doc-img-tag-filter');
    HubSelect.init('doc-img-date-filter');
    HubSelect.init('doc-img-sort');
    HubSelect.init('doc-img-view');
  }

  if (typeof ResponsiveLayout !== 'undefined') {
    ResponsiveLayout.registerTabControls('docs-images', 'pg-ctrl-docs-images');
  }

  const recordBtn = document.getElementById('doc-img-delete-record-btn');
  const fileBtn = document.getElementById('doc-img-delete-file-btn');
  if (recordBtn) recordBtn.addEventListener('click', () => _submitDocImgDelete(false));
  if (fileBtn) fileBtn.addEventListener('click', () => _submitDocImgDelete(true));

  const deleteModal = document.getElementById('doc-img-delete-modal');
  if (deleteModal) {
    deleteModal.addEventListener('close', () => {
      _docImgDeleteTarget = null;
      const err = document.getElementById('doc-img-delete-error');
      if (err) err.textContent = '';
    });
  }

  window.addEventListener('resize', () => {
    clearTimeout(_docImgResizeTimer);
    _docImgResizeTimer = setTimeout(() => {
      if (document.getElementById('tab-docs-images')?.classList.contains('active')) {
        _renderDocImagesList();
      }
    }, 120);
  });
});
