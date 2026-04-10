/* ── Bookmarks (browser-links) ───────────────────────────────────────── */

// ── Known-field renderers and metadata ───────────────────────────────────
// Only fields with special rendering logic need an entry here.
// Any field that arrives from the API and is NOT listed gets a plain-text
// fallback renderer automatically — that is what makes this data-driven.
const _BM_FIELD_META = {
  _icon:       { label: 'Icon',        sortKey: null,
                 render: b => `<td style="text-align:center;width:30px">${b._item_type === 'visit' ? '&#128065;' : '&#128278;'}</td>` },
  title:       { label: 'Title',       sortKey: 'title',
                 render: b => `<td><a class="table-cell-link" href="${esc(b.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent)"><span class="table-cell-clamp">${esc(b.title || b.url)}</span></a></td>` },
  url:         { label: 'URL',         sortKey: 'url',
                 render: b => `<td style="font-size:11px;color:var(--text-dim);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(b.url)}">${_bmTruncUrl(b.url)}</td>` },
  tags:        { label: 'Tags',        sortKey: 'tags',
                 render: b => `<td style="font-size:11px">${(b.tags||[]).map(t=>_bmTagPill(t)).join(' ')}</td>` },
  description: { label: 'Description', sortKey: 'description',
                 render: b => `<td style="font-size:12px;color:var(--text-dim);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.description||b.notes||'')}</td>` },
  notes:       { label: 'Notes',       sortKey: null,
                 render: b => `<td style="font-size:12px;color:var(--text-dim);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.notes||'')}</td>` },
  source:      { label: 'Source',      sortKey: 'source',
                 render: b => `<td style="font-size:11px;color:var(--text-dim)">${esc(b.source||'')}</td>` },
  created_at:  { label: 'Saved',       sortKey: 'created_at',
                 render: b => `<td style="font-size:11px;color:var(--text-dim);white-space:nowrap">${_bmFmtDate(b.created_at||b.visited_at||'')}</td>` },
  updated_at:  { label: 'Updated',     sortKey: 'updated_at',
                 render: b => `<td style="font-size:11px;color:var(--text-dim);white-space:nowrap">${_bmFmtDate(b.updated_at||'')}</td>` },
  folder:      { label: 'Folder',      sortKey: null,
                 render: b => `<td style="font-size:11px;color:var(--text-dim)">${esc(b.folder||'')}</td>` },
  favicon_url: { label: 'Favicon',     sortKey: null,
                 render: b => b.favicon_url ? `<td><img src="${esc(b.favicon_url)}" style="width:16px;height:16px;vertical-align:middle" loading="lazy" /></td>` : '<td></td>' },
  archived:    { label: 'Archived',    sortKey: null,
                 render: b => `<td style="font-size:11px;color:var(--text-dim)">${b.archived ? 'Yes' : ''}</td>` },
  // ── Search transparency fields (hidden by default; appear only in search results) ──
  score_sources: { label: 'Sources',      sortKey: null,
                   render: b => {
                     const srcs = b.score_sources || [];
                     const pills = {
                       bookmark_keyword: ['KW-BM', '#d97706'],
                       visit_keyword:    ['KW-V',  '#b45309'],
                       bookmark_vector:  ['VEC-BM','#2563eb'],
                       visit_vector:     ['VEC-V', '#7c3aed'],
                     };
                     const html = srcs.map(s => {
                       const [label, color] = pills[s] || [s, '#6b7280'];
                       return `<span style="font-size:10px;padding:1px 5px;border-radius:9px;background:${color};color:#fff;white-space:nowrap">${label}</span>`;
                     }).join(' ');
                     return `<td><span class="bm-score-cell" data-metric="score_sources" style="cursor:pointer" title="Click to analyse score">${html}</span></td>`;
                   } },
  rrf_score:     { label: 'RRF Score',    sortKey: 'rrf_score',
                   description: 'Reciprocal Rank Fusion score — combines keyword and vector signals into a single relevance score. Higher is better. Typical range 0.001–0.066.',
                   render: b => {
                     const v = b.rrf_score;
                     return `<td><span class="bm-score-cell" data-metric="rrf_score" style="cursor:pointer;font-size:11px;font-variant-numeric:tabular-nums;color:var(--text-dim)" title="Click to analyse score">${v != null ? v.toFixed(5) : ''}</span></td>`;
                   } },
  kw_tier:       { label: 'KW Tier',      sortKey: 'kw_tier',
                   description: 'Keyword match tier — how strongly the query matched via keywords. Lower tier = stronger match. Tier 0 = exact phrase in title/URL (best); Tier 7 = document-level only (weakest). Null = pure vector match with no keyword signal.',
                   render: b => {
                     const tier = b.kw_tier;
                     if (tier == null) return '<td></td>';
                     const labels = ['Phrase in title','Phrase in URL','All tokens cross-field','Phrase in tags','Token in title','Token in URL','Token in tags','Document only'];
                     const colors = ['#059669','#059669','#16a34a','#ca8a04','#ca8a04','#ea580c','#ea580c','#6b7280'];
                     return `<td><span class="bm-score-cell" data-metric="kw_tier" style="cursor:pointer;font-size:11px;white-space:nowrap;color:${colors[tier]||'#6b7280'}" title="${labels[tier]||''} — Click to analyse">${tier} – ${labels[tier]||'?'}</span></td>`;
                   } },
  cosine_distance:{ label: 'Cos Dist',    sortKey: 'cosine_distance',
                   description: 'Cosine distance between the query embedding and the document embedding. Lower = more similar. Under 0.3 (shown in green) is a strong vector match. Over 0.6 is weak. Note: this is distance not similarity — lower is better.',
                   render: b => {
                     const v = b.cosine_distance;
                     if (v == null) return '<td></td>';
                     const color = v < 0.3 ? '#059669' : v < 0.6 ? '#ca8a04' : '#6b7280';
                     return `<td><span class="bm-score-cell" data-metric="cosine_distance" style="cursor:pointer;font-size:11px;font-variant-numeric:tabular-nums;color:${color}" title="Click to analyse score">${v.toFixed(4)}</span></td>`;
                   } },
  reranker_rank: { label: 'Reranker',     sortKey: 'reranker_rank',
                   render: b => {
                     const v = b.reranker_rank;
                     return `<td><span class="bm-score-cell" data-metric="reranker_rank" style="cursor:pointer;font-size:11px;color:var(--text-dim)" title="Click to analyse score">${v != null ? '#' + v : ''}</span></td>`;
                   } },
  exact_tier:    { label: 'Exact Tier',   sortKey: 'exact_tier',
                   render: b => {
                     const tier = b.exact_tier;
                     if (tier == null) return '<td></td>';
                     const labels = ['Phrase in title/URL','All tokens cross-field','Token in title/URL','Tags only','Pure embedding'];
                     const colors = ['#059669','#16a34a','#ca8a04','#ea580c','#6b7280'];
                     return `<td><span class="bm-score-cell" data-metric="exact_tier" style="cursor:pointer;font-size:11px;white-space:nowrap;color:${colors[tier]||'#6b7280'}" title="${labels[tier]||''} — Click to analyse">${tier} – ${labels[tier]||'?'}</span></td>`;
                   } },
  _actions:    { label: 'Actions',     sortKey: null,
                 render: b => _bmRenderBookmarkActionsCell(b) },
};

// Fields never shown as columns (used internally for operations)
const _BM_EXCLUDE_COLS = new Set(['bookmark_id', '_item_type']);

// Fields hidden by default on first visit (user can show via Columns modal)
const _BM_DEFAULT_HIDDEN = ['notes', 'folder', 'favicon_url', 'updated_at', 'archived',
  'score_sources', 'rrf_score', 'kw_tier', 'cosine_distance', 'reranker_rank', 'exact_tier'];

// ── Phase 1: Static browse column seed ───────────────────────────────────
// Browse mode has a stable, known column set. Dynamic detection still runs
// as a merge-into-seed safety net, but the static seed is the primary source.
const _BM_BROWSE_SEED_COLS = [
  '_icon', 'title', 'url', 'tags', 'description', 'notes',
  'source', 'created_at', 'updated_at', 'folder', 'favicon_url',
  'archived', '_actions'
];

function _bmBrowseColumnSeed(col) {
  const seeds = {
    _icon:        { data_type: 'icon',    sample_max_length: 1,   min_width_px: 30,  max_width_px: 30,  width_px: 30 },
    title:        { data_type: 'text',    sample_max_length: 120, min_width_px: 120, max_width_px: 600, width_px: 250,
                    sqlite_column: 'title' },
    url:          { data_type: 'url',     sample_max_length: 200, min_width_px: 100, max_width_px: 400, width_px: 180,
                    sqlite_column: 'url' },
    tags:         { data_type: 'text[]',  sample_max_length: 60,  min_width_px: 80,  max_width_px: 300, width_px: 120,
                    sqlite_column: 'tags' },
    description:  { data_type: 'text',    sample_max_length: 200, min_width_px: 100, max_width_px: 400, width_px: 180,
                    sqlite_column: 'description' },
    notes:        { data_type: 'text',    sample_max_length: 200, min_width_px: 100, max_width_px: 400, width_px: 180,
                    sqlite_column: 'notes' },
    source:       { data_type: 'text',    sample_max_length: 20,  min_width_px: 60,  max_width_px: 120, width_px: 80,
                    sqlite_column: 'source' },
    created_at:   { data_type: 'datetime',sample_max_length: 19,  min_width_px: 80,  max_width_px: 160, width_px: 100,
                    sqlite_column: 'created_at' },
    updated_at:   { data_type: 'datetime',sample_max_length: 19,  min_width_px: 80,  max_width_px: 160, width_px: 100,
                    sqlite_column: 'updated_at' },
    folder:       { data_type: 'text',    sample_max_length: 80,  min_width_px: 80,  max_width_px: 200, width_px: 120,
                    sqlite_column: 'folder' },
    favicon_url:  { data_type: 'url',     sample_max_length: 200, min_width_px: 30,  max_width_px: 60,  width_px: 40,
                    sqlite_column: 'favicon_url' },
    archived:     { data_type: 'boolean', sample_max_length: 3,   min_width_px: 50,  max_width_px: 80,  width_px: 60,
                    sqlite_column: 'archived' },
    _actions:     { data_type: 'actions', sample_max_length: 0,   min_width_px: 48,  max_width_px: 110, width_px: 110 },
  };
  return seeds[col] || null;
}

// ── Phase 3: Static search column seed ───────────────────────────────────
// Search mode has a known base set plus scoring transparency columns.
// Dynamic detection still runs as a merge-into-seed safety net.
const _BM_SEARCH_SEED_COLS = [
  '_icon', 'title', 'url', 'tags', 'description', 'notes',
  'source', 'created_at', 'updated_at', 'folder', 'favicon_url',
  'archived',
  // scoring transparency — search-only
  'score_sources', 'rrf_score', 'kw_tier', 'cosine_distance',
  'reranker_rank', 'exact_tier',
  '_actions'
];

function _bmSearchColumnSeed(col) {
  const seeds = {
    _icon:            { data_type: 'icon',    sample_max_length: 1,   min_width_px: 30,  max_width_px: 30,  width_px: 30 },
    title:            { data_type: 'text',    sample_max_length: 120, min_width_px: 120, max_width_px: 600, width_px: 250,
                        sqlite_column: 'title' },
    url:              { data_type: 'url',     sample_max_length: 200, min_width_px: 100, max_width_px: 400, width_px: 180,
                        sqlite_column: 'url' },
    tags:             { data_type: 'text[]',  sample_max_length: 60,  min_width_px: 80,  max_width_px: 300, width_px: 120,
                        sqlite_column: 'tags' },
    description:      { data_type: 'text',    sample_max_length: 200, min_width_px: 100, max_width_px: 400, width_px: 180,
                        sqlite_column: 'description' },
    notes:            { data_type: 'text',    sample_max_length: 200, min_width_px: 100, max_width_px: 400, width_px: 180,
                        sqlite_column: 'notes' },
    source:           { data_type: 'text',    sample_max_length: 20,  min_width_px: 60,  max_width_px: 120, width_px: 80,
                        sqlite_column: 'source' },
    created_at:       { data_type: 'datetime',sample_max_length: 19,  min_width_px: 80,  max_width_px: 160, width_px: 100,
                        sqlite_column: 'created_at' },
    updated_at:       { data_type: 'datetime',sample_max_length: 19,  min_width_px: 80,  max_width_px: 160, width_px: 100,
                        sqlite_column: 'updated_at' },
    folder:           { data_type: 'text',    sample_max_length: 80,  min_width_px: 80,  max_width_px: 200, width_px: 120,
                        sqlite_column: 'folder' },
    favicon_url:      { data_type: 'url',     sample_max_length: 200, min_width_px: 30,  max_width_px: 60,  width_px: 40,
                        sqlite_column: 'favicon_url' },
    archived:         { data_type: 'boolean', sample_max_length: 3,   min_width_px: 50,  max_width_px: 80,  width_px: 60,
                        sqlite_column: 'archived' },
    score_sources:    { data_type: 'text',    sample_max_length: 60,  min_width_px: 80,  max_width_px: 200, width_px: 120,
                        sqlite_column: 'score_sources' },
    rrf_score:        { data_type: 'number',  sample_max_length: 10,  min_width_px: 60,  max_width_px: 120, width_px: 80,
                        sqlite_column: 'rrf_score' },
    kw_tier:          { data_type: 'number',  sample_max_length: 6,   min_width_px: 50,  max_width_px: 100, width_px: 70,
                        sqlite_column: 'kw_tier' },
    cosine_distance:  { data_type: 'number',  sample_max_length: 10,  min_width_px: 60,  max_width_px: 120, width_px: 80,
                        sqlite_column: 'cosine_distance' },
    reranker_rank:    { data_type: 'number',  sample_max_length: 6,   min_width_px: 50,  max_width_px: 100, width_px: 70,
                        sqlite_column: 'reranker_rank' },
    exact_tier:       { data_type: 'number',  sample_max_length: 6,   min_width_px: 50,  max_width_px: 100, width_px: 70,
                        sqlite_column: 'exact_tier' },
    _actions:         { data_type: 'actions', sample_max_length: 0,   min_width_px: 48,  max_width_px: 110, width_px: 110 },
  };
  return seeds[col] || null;
}

// Convert a snake_case key to a human label (fallback for unknown fields)
function _bmFieldLabel(key) {
  const m = _BM_FIELD_META[key];
  if (m) return m.label;
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const _BM_ACTION_INLINE_WIDTH = 110;
const _BM_ACTION_COMPACT_WIDTH = 48;
const _VIS_ACTION_INLINE_WIDTH = 90;
const _VIS_ACTION_COMPACT_WIDTH = 48;

function _bmCompactRowActions() {
  const browseView = _ensureBmBrowseTableView();
  const searchView = _ensureBmSearchTableView();
  return typeof TableRowActions !== 'undefined' && TableRowActions.shouldCollapse({
    view: _bmSearchActive ? searchView : browseView,
    prefs: _bmSearchActive
      ? [searchView?.prefs].filter(Boolean)
      : [browseView?.prefs, searchView?.prefs].filter(Boolean),
    getTable: () => document.getElementById('bm-table'),
    columnKey: '_actions',
    requiredWidth: _BM_ACTION_INLINE_WIDTH,
    defaultWidth: _BM_ACTION_INLINE_WIDTH,
  });
}

function _bmActionCellWidth() {
  return _bmCompactRowActions() ? _BM_ACTION_COMPACT_WIDTH : _BM_ACTION_INLINE_WIDTH;
}

function _visCompactRowActions() {
  return !!(_visTableView && typeof TableRowActions !== 'undefined' && TableRowActions.shouldCollapse({
    view: _visTableView,
    getTable: () => document.getElementById('vis-table'),
    columnKey: '_actions',
    requiredWidth: _VIS_ACTION_INLINE_WIDTH,
    defaultWidth: _VIS_ACTION_INLINE_WIDTH,
  }));
}

function _visActionCellWidth() {
  return _visCompactRowActions() ? _VIS_ACTION_COMPACT_WIDTH : _VIS_ACTION_INLINE_WIDTH;
}

function _bmBookmarkActionButtons(b) {
  const archBtn = b.archived
    ? `<button class="secondary table-icon-btn table-icon-btn--restore" type="button" title="Restore from archive" aria-label="Restore bookmark" data-bm-archive-id="${esc(b.bookmark_id)}" data-bm-archive-state="1"></button>`
    : `<button class="secondary table-icon-btn table-icon-btn--archive" type="button" title="Archive bookmark" aria-label="Archive bookmark" data-bm-archive-id="${esc(b.bookmark_id)}" data-bm-archive-state="0"></button>`;
  return `<button class="secondary table-icon-btn table-icon-btn--edit" type="button" title="Edit bookmark" aria-label="Edit bookmark" data-bm-edit-id="${esc(b.bookmark_id)}"></button>${archBtn}
    <button class="secondary table-icon-btn table-icon-btn--delete" type="button" title="Delete bookmark" aria-label="Delete bookmark" data-bm-delete-id="${esc(b.bookmark_id)}" data-bm-delete-title="${esc(b.title||b.url)}"></button>`;
}

function _bmRenderBookmarkActionsCell(b) {
  if (b._item_type === 'visit') return '<td></td>';
  if (_bmCompactRowActions()) {
    return `<td class="table-action-cell table-action-cell--compact" style="width:${_bmActionCellWidth()}px">
      <button class="table-row-action-trigger secondary" type="button" title="Bookmark actions" data-bm-row-actions="${esc(b.bookmark_id)}">&#8942;</button>
    </td>`;
  }
  return `<td class="table-action-cell" style="white-space:nowrap">
    <div class="table-inline-actions">${_bmBookmarkActionButtons(b)}</div>
  </td>`;
}

let _bmSearchTimer = null;      // server SeekDB search debounce
let _bmRenderTimer = null;      // client-side filter render debounce
let _bmSearchActive = false;
let _bmExcludedTags = new Set(); // tags excluded from embeddings — also skipped in client-side keyword filter
let _bmColResizeDone = false;
let _bmAllTags = [];
let _bmTagCounts = {};       // {tag -> {active, archived}}
let _bmCurrentExclTags = []; // source of truth; kept in sync with server
let _bmLastSearchResults = []; // cached for re-render on column toggle
let _bmDisplayedSearchRows = []; // current filtered/sorted search rows shown in the table
const _BM_SHOW_ARCHIVED_KEY = 'bookmarks.show-archived';

function _bmReadShowArchived() {
  try {
    return localStorage.getItem(_BM_SHOW_ARCHIVED_KEY) === '1';
  } catch (_) {
    return false;
  }
}

function _bmWriteShowArchived(next) {
  try {
    localStorage.setItem(_BM_SHOW_ARCHIVED_KEY, next ? '1' : '0');
  } catch (_) {}
}

let _bmShowArchived = _bmReadShowArchived();

function isBookmarksShowArchived() {
  return !!_bmShowArchived;
}

function toggleBookmarksShowArchived() {
  _bmShowArchived = !_bmShowArchived;
  _bmWriteShowArchived(_bmShowArchived);
  loadBookmarks();
  if (typeof ProbesMenuConfig !== 'undefined') ProbesMenuConfig.updateActiveTab('bookmarks-main');
}

// ── Pagination state ─────────────────────────────────────────────────────
// Visual-only pagination: full _bookmarks array is always loaded; only the
// rendered slice changes.  All client-side filter/sort/search still operates
// on the complete dataset — only the table render is sliced.
const _BM_PAGE_SIZE_OPTIONS = [25, 50, 75, 100, 250, 1000, 2000, 5000, 10000];
const _BM_PAGER = TablePager.create({
  pagerId: 'bm-pagination',
  pageSizeOptions: _BM_PAGE_SIZE_OPTIONS,
  defaultPageSize: 100,
  storageKey: 'bm-pagination-prefs',
  stateScope: () => _bmModeKey(),
  defaultEnabled: true,
  onChange: function () {
    renderBookmarks({ keepPage: true });
  },
});

// Dynamic column lists — derived from actual API response keys, not hardcoded.
// Browse and search results intentionally keep separate column state because
// search adds transparency fields and can include visit-shaped rows.
let _bmDynColsByMode = {
  browse: [],
  search: [],
};

// ── Phase 2: Browse TableView + bucket controller ────────────────────────
// Browse mode uses the shared TableView + TableBucketLayouts system (code 14).
// Search mode stays on raw TablePrefs + TableSort untouched.
let _bmBrowseTableView = null;
let _bmBrowseLayoutController = null;

function _bmBrowseDefaultWidth(col) {
  if (col === '_actions') return _bmActionCellWidth();
  return _bmBrowseColumnSeed(col)?.width_px ?? null;
}

function _ensureBmBrowseTableView() {
  if (_bmBrowseTableView || typeof TableView === 'undefined') return _bmBrowseTableView;
  _bmBrowseTableView = TableView.create({
    storageKey: 'bm-table-prefs',
    legacyHiddenKey: 'bm-hidden-cols',
    defaultHidden: _BM_DEFAULT_HIDDEN,
    columns: _BM_BROWSE_SEED_COLS,
    getColumns: () => _bmDynColsByMode.browse.length ? _bmDynColsByMode.browse : _BM_BROWSE_SEED_COLS,
    meta: Object.fromEntries(
      _BM_BROWSE_SEED_COLS.map(k => [k, {
        label: _bmFieldLabel(k),
        sortKey: _BM_FIELD_META[k]?.sortKey ?? null,
        description: _BM_FIELD_META[k]?.description ?? null,
      }])
    ),
    getMeta: k => ({
      label: _bmFieldLabel(k),
      sortKey: _BM_FIELD_META[k]?.sortKey ?? null,
      description: _BM_FIELD_META[k]?.description ?? null,
    }),
    getTable: () => document.querySelector('#bm-main-view table'),
    getDefaultWidth: col => _bmBrowseDefaultWidth(col),
    minWidth: 40,
    sort: {
      defaultKey: 'created_at',
      defaultDir: -1,
      storageKey: 'bookmarks-table-sort',
    },
    onSortChange: () => {
      renderBookmarks();
      _ensureBmBrowseLayoutController()?.scheduleLayoutSave();
    },
    onColumnResizeEnd: (col, width) => {
      _ensureBmBrowseLayoutController()?.scheduleLayoutSave();
    },
  });
  return _bmBrowseTableView;
}

function _ensureBmBrowseLayoutController() {
  if (_bmBrowseLayoutController || typeof TableBucketLayouts === 'undefined') return _bmBrowseLayoutController;
  const view = _ensureBmBrowseTableView();
  _bmBrowseLayoutController = TableBucketLayouts.create({
    getTable: () => document.querySelector('#bm-main-view table'),
    getView: () => view,
    getColumns: () => _bmDynColsByMode.browse.length ? _bmDynColsByMode.browse : _BM_BROWSE_SEED_COLS,
    getMeta: col => ({
      label: _bmFieldLabel(col),
      sortKey: _BM_FIELD_META[col]?.sortKey ?? null
    }),
    getDefaultWidth: col => _bmBrowseDefaultWidth(col),
    getColumnSeed: (col, meta, index, ctx) => _bmBrowseColumnSeed(col),
    render: () => renderBookmarks({ keepPage: true }),
    surfaceLabel: 'Bookmarks',
    tableCode: '14',
    tableName: 'bookmarks',
  });
  return _bmBrowseLayoutController;
}

async function toggleBmBrowseHorizontalScroll() {
  const controller = _ensureBmBrowseLayoutController();
  if (!controller) return;
  await controller.toggleHorizontalScroll();
}

async function openBmBrowseLayoutContextModal() {
  const controller = _ensureBmBrowseLayoutController();
  if (!controller) return;
  await controller.openLayoutContextModal();
}

// ── Phase 3: Search TableView + bucket controller ────────────────────────
// Search mode uses the shared TableView + TableBucketLayouts system (code 19).
let _bmSearchTableView = null;
let _bmSearchLayoutController = null;

function _bmSearchDefaultWidth(col) {
  if (col === '_actions') return _bmActionCellWidth();
  return _bmSearchColumnSeed(col)?.width_px ?? null;
}

function _ensureBmSearchTableView() {
  if (_bmSearchTableView || typeof TableView === 'undefined') return _bmSearchTableView;
  _bmSearchTableView = TableView.create({
    storageKey: 'bm-search-table-prefs',
    defaultHidden: _BM_DEFAULT_HIDDEN,
    columns: _BM_SEARCH_SEED_COLS,
    getColumns: () => _bmDynColsByMode.search.length ? _bmDynColsByMode.search : _BM_SEARCH_SEED_COLS,
    meta: Object.fromEntries(
      _BM_SEARCH_SEED_COLS.map(k => [k, {
        label: _bmFieldLabel(k),
        sortKey: _BM_FIELD_META[k]?.sortKey ?? null,
        description: _BM_FIELD_META[k]?.description ?? null,
      }])
    ),
    getMeta: k => ({
      label: _bmFieldLabel(k),
      sortKey: _BM_FIELD_META[k]?.sortKey ?? null,
      description: _BM_FIELD_META[k]?.description ?? null,
    }),
    getTable: () => document.querySelector('#bm-main-view table'),
    getDefaultWidth: col => _bmSearchDefaultWidth(col),
    minWidth: 40,
    sort: {
      defaultKey: 'kw_tier',
      defaultDir: 1,
      storageKey: 'bookmarks-search-table-sort',
    },
    onSortChange: () => {
      if (_bmSearchActive) _renderBmSearchResults(_bmLastSearchResults);
      _ensureBmSearchLayoutController()?.scheduleLayoutSave();
    },
    onColumnResizeEnd: (col, width) => {
      _ensureBmSearchLayoutController()?.scheduleLayoutSave();
    },
  });
  return _bmSearchTableView;
}

function _ensureBmSearchLayoutController() {
  if (_bmSearchLayoutController || typeof TableBucketLayouts === 'undefined') return _bmSearchLayoutController;
  const view = _ensureBmSearchTableView();
  _bmSearchLayoutController = TableBucketLayouts.create({
    getTable: () => document.querySelector('#bm-main-view table'),
    getView: () => view,
    getColumns: () => _bmDynColsByMode.search.length ? _bmDynColsByMode.search : _BM_SEARCH_SEED_COLS,
    getMeta: col => ({
      label: _bmFieldLabel(col),
      sortKey: _BM_FIELD_META[col]?.sortKey ?? null
    }),
    getDefaultWidth: col => _bmSearchDefaultWidth(col),
    getColumnSeed: (col, meta, index, ctx) => _bmSearchColumnSeed(col),
    render: () => { if (_bmSearchActive) _renderBmSearchResults(_bmLastSearchResults); },
    surfaceLabel: 'Bookmarks Search',
    tableCode: '19',
    tableName: 'bookmarks-search',
  });
  return _bmSearchLayoutController;
}

// ── Mode-aware h-scroll and layout context toggles ───────────────────────
async function toggleBmHorizontalScroll() {
  const controller = _bmSearchActive
    ? _ensureBmSearchLayoutController()
    : _ensureBmBrowseLayoutController();
  if (!controller) return;
  await controller.toggleHorizontalScroll();
}

async function openBmLayoutContextModal() {
  const controller = _bmSearchActive
    ? _ensureBmSearchLayoutController()
    : _ensureBmBrowseLayoutController();
  if (!controller) return;
  await controller.openLayoutContextModal();
}

function _bmModeKey(forceSearch) {
  const isSearch = typeof forceSearch === 'boolean' ? forceSearch : _bmSearchActive;
  return isSearch ? 'search' : 'browse';
}

function _bmCurrentDynCols() {
  return _bmDynColsByMode[_bmModeKey()];
}

function _bmCurrentTablePrefs() {
  return _bmSearchActive
    ? (_ensureBmSearchTableView()?.prefs || null)
    : (_ensureBmBrowseTableView()?.prefs || null);
}

function _bmCurrentTableSort() {
  return _bmSearchActive
    ? (_ensureBmSearchTableView()?.sorter || null)
    : (_ensureBmBrowseTableView()?.sorter || null);
}

function _bmSetSearchActive(active) {
  _bmSearchActive = active;
  _bmHiddenCols = _bmCurrentTablePrefs().getHiddenSet(_bmCurrentDynCols());
  if (!active) _bmDisplayedSearchRows = [];
  const btn = document.getElementById('bm-explain-sort-btn');
  if (btn) btn.disabled = !active;
}

let _bmHiddenCols = new Set();

// Called after each API load or search render — derives column list from the
// current row shape for the active logical view. Browse and search keep
// separate remembered column sets because search can expose extra fields.
// _icon and _actions are synthetic (not from API): always first and last.
//
// Browse mode: merges API keys into the static _BM_BROWSE_SEED_COLS seed.
// Any unexpected API field is appended after the seed columns.
// Search mode: fully dynamic detection (unchanged from legacy behavior).
function _bmDetectCols(rows) {
  const modeKey = _bmModeKey();
  const apiKeys = [];
  const apiKeySet = new Set();
  (rows || []).forEach(row => {
    Object.keys(row || {}).forEach(key => {
      if (_BM_EXCLUDE_COLS.has(key) || apiKeySet.has(key)) return;
      apiKeySet.add(key);
      apiKeys.push(key);
    });
  });

  if (modeKey === 'browse') {
    // Static seed is primary; append any unexpected API fields after the seed
    const seedSet = new Set(_BM_BROWSE_SEED_COLS);
    const extras = apiKeys.filter(k => !seedSet.has(k) && k !== '_icon' && k !== '_actions');
    _bmDynColsByMode.browse = [..._BM_BROWSE_SEED_COLS];
    if (extras.length) {
      // Insert extras before _actions (last element)
      const actionsIdx = _bmDynColsByMode.browse.indexOf('_actions');
      _bmDynColsByMode.browse.splice(actionsIdx, 0, ...extras);
    }
  } else {
    // Search: seed-merge with preserveMissing for scoring transparency columns.
    // Static seed defines order; any extra API fields are appended before _actions.
    // Previously-seen columns are preserved even if absent from the current response
    // (scoring columns vary by query but should remain visible once discovered).
    const seedSet = new Set(_BM_SEARCH_SEED_COLS);
    const existing = _bmDynColsByMode.search.filter(k => k !== '_icon' && k !== '_actions');
    const existingSet = new Set(existing);
    // API extras not in seed and not already known
    const extras = apiKeys.filter(k => !seedSet.has(k) && !existingSet.has(k) && k !== '_icon' && k !== '_actions');
    // Previously discovered non-seed columns
    const prevExtras = existing.filter(k => !seedSet.has(k));
    // Build: seed minus synthetics, then prev non-seed extras, then new extras
    const seedBody = _BM_SEARCH_SEED_COLS.filter(k => k !== '_icon' && k !== '_actions');
    _bmDynColsByMode.search = [
      '_icon',
      ...seedBody,
      ...prevExtras,
      ...extras,
      '_actions',
    ];
  }

  const prefs = _bmCurrentTablePrefs();
  prefs.syncColumns(_bmDynColsByMode[modeKey]);
  _bmHiddenCols = prefs.getHiddenSet(_bmDynColsByMode[modeKey]);
}

function _bmVisibleDataCols() {
  return _bmCurrentDynCols().filter(k => !_bmHiddenCols.has(k));
}

function _bmColCount() { return _bmVisibleDataCols().length; }

function _bmSortValue(item, sortKey) {
  switch (sortKey) {
    case 'tags':
      return item.tags || [];
    case 'rrf_score':
      // Higher = better; sort DESC. Null → sort last in DESC.
      return item.rrf_score == null ? Number.NEGATIVE_INFINITY : Number(item.rrf_score);
    case 'kw_tier':
      // Lower tier = better keyword match; sort ASC (0 = phrase in title = best).
      // Null = pure vector hit with no keyword match; sorts after tier 7.
      // rrf_score (max ~0.06) is woven in as a fractional tiebreaker: within
      // the same tier, higher RRF ranks first.  Integer tier steps of 1 are
      // large enough that subtracting a small RRF value never crosses a tier boundary.
      return (item.kw_tier == null ? 99 : Number(item.kw_tier)) - (item.rrf_score ?? 0);
    case 'cosine_distance':
    case 'reranker_rank':
    case 'exact_tier':
      // Lower = better for all three; null = no match → sort last in ASC.
      return item[sortKey] == null ? Number.POSITIVE_INFINITY : Number(item[sortKey]);
    default:
      return item[sortKey];
  }
}

function _bmRebuildThead() {
  // Both modes delegate to their respective TableView's rebuildHead
  if (_bmSearchActive) {
    const view = _ensureBmSearchTableView();
    if (view) { view.rebuildHead(); _bmColResizeDone = false; return; }
  } else {
    const view = _ensureBmBrowseTableView();
    if (view) { view.rebuildHead(); return; }
  }
}

function _bmRenderDataTds(b) {
  return _bmVisibleDataCols().map(key => {
    const meta = _BM_FIELD_META[key];
    if (meta) return meta.render(b);
    // Unknown field — plain text fallback; this is the data-driven path
    const val = b[key];
    const text = val == null ? '' : (Array.isArray(val) ? val.join(', ') : String(val));
    return `<td class="table-cell-clip" title="${esc(text)}"><span class="table-cell-clip__text">${esc(text)}</span></td>`;
  }).join('');
}

function _bmBuildBookmarkRow(b) {
  const archiveStyle = b.archived ? 'opacity:0.55' : '';
  const row = { ...b, _item_type: 'bookmark' };
  return `<tr style="${archiveStyle}">${_bmRenderDataTds(row)}</tr>`;
}

function _bmBuildSearchRow(r, scoreIdx) {
  const isBookmark = r.item_type !== 'visit';
  const b = { ...r, bookmark_id: r.id, _item_type: r.item_type || 'bookmark' };
  if (!isBookmark && r.visited_at && !b.created_at) b.created_at = r.visited_at;
  const idxAttr = scoreIdx != null ? ` data-score-idx="${scoreIdx}"` : '';
  return `<tr${idxAttr}>${_bmRenderDataTds(b)}</tr>`;
}

// ── Column visibility modal ──────────────────────────────────────────────
// Modal list is built from the active view's detected columns.
// No column names are hardcoded here.
function _bmOpenColsModal() {
  // Both modes use their respective TableView column chooser
  const view = _bmSearchActive ? _ensureBmSearchTableView() : _ensureBmBrowseTableView();
  if (view) {
    view.openColumns(
      document.getElementById('bm-cols-modal-list'),
      document.getElementById('bm-cols-modal'),
      _bmFieldLabel
    );
    return;
  }
}

function _bmApplyColsModal() {
  // Both modes use their respective TableView applyColumns with scheduleLayoutSave
  const view = _bmSearchActive ? _ensureBmSearchTableView() : _ensureBmBrowseTableView();
  const controller = _bmSearchActive ? _ensureBmSearchLayoutController() : _ensureBmBrowseLayoutController();
  if (view) {
    const modal = document.getElementById('bm-cols-modal');
    view.applyColumns(modal, () => {
      _bmHiddenCols = view.getHiddenSet();
      if (_bmSearchActive) {
        _renderBmSearchResults(_bmLastSearchResults);
      } else {
        renderBookmarks({ keepPage: true });
      }
      HubModal.close(modal);
      controller?.scheduleLayoutSave();
    });
    return;
  }
}

async function _bmDownloadExtension(btn) {
  const orig = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Downloading…'; }
  try {
    const r = await apiFetch('/api/v1/bookmarks/extension-download');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'blueprints-bookmarks-extension.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    await HubDialogs.alertError({
      title: 'Download failed',
      message: `Download failed: ${e.message}`,
    });
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
}

// ── Load / Refresh ──────────────────────────────────────────────────────

async function loadBookmarks() {
  const err = document.getElementById('bm-error');
  err.hidden = true;
  const archived = _bmShowArchived ? 1 : 0;
  try {
    const limit = parseInt(getFrontendSetting('bm_fetch_limit', 50000), 10);
    const r = await apiFetch(`/api/v1/bookmarks?archived=${archived}&limit=${limit}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _bookmarks = await r.json();
    _bmSetSearchActive(false);
    _bmDetectCols(_bookmarks);  // derive column list from actual API response keys
    document.getElementById('bm-search-status').hidden = true;
    await Promise.all([_loadBookmarkTags(), _loadExcludedTags()]);
    renderBookmarks();
  } catch (e) {
    err.textContent = `Failed to load bookmarks: ${e.message}`;
    err.hidden = false;
  }
}

async function _loadBookmarkTags() {
  try {
    const r = await apiFetch('/api/v1/bookmarks/tags');
    if (!r.ok) return;
    const tags = await r.json();
    const sel = document.getElementById('bm-tag-filter');
    const prev = sel.value;
    sel.innerHTML = '<option value="">All tags</option>' +
      tags.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    sel.value = prev;
  } catch (_) {}
}

async function _loadExcludedTags() {
  try {
    const r = await apiFetch('/api/v1/bookmarks/embedding-config');
    if (!r.ok) return;
    const cfg = await r.json();
    _bmExcludedTags = new Set((cfg.excluded_tags || []).map(t => t.toLowerCase()));
  } catch (_) {}
}

// ── Search ──────────────────────────────────────────────────────────────

function _bmSearchDebounce() {
  clearTimeout(_bmSearchTimer);
  clearTimeout(_bmRenderTimer);
  const q = (document.getElementById('bm-search').value || '').trim();
  if (!q) {
    _bmSetSearchActive(false);
    document.getElementById('bm-search-status').hidden = true;
    renderBookmarks();
    return;
  }
  // Debounce client-side filter (250ms) — fast enough to feel responsive,
  // slow enough to avoid rebuilding the full table on every keystroke.
  _bmRenderTimer = setTimeout(() => {
    _bmSetSearchActive(false);
    renderBookmarks();
  }, 250);
  // Debounce server SeekDB search (600ms) — fires after typing pauses.
  _bmSearchTimer = setTimeout(() => _runBmSearch(q), 600);
}

async function _runBmSearch(q) {
  try {
    const r = await apiFetch(`/api/v1/bookmarks/search?q=${encodeURIComponent(q)}&limit=50`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const status = document.getElementById('bm-search-status');
    if (data.count > 0) {
      _bmSetSearchActive(true);
      status.textContent = `SeekDB: ${data.count} result${data.count === 1 ? '' : 's'} for "${q}"`;
      status.hidden = false;
      // Reset to compound-relevance sort on every fresh search (kw_tier ASC
      // with rrf_score as tiebreaker — see _bmSortValue for compound logic).
      _ensureBmSearchTableView()?.sorter?.setState('kw_tier', 1);
      _renderBmSearchResults(data.results);
    } else {
      // SeekDB has no results (likely not yet indexed) — keep client-side filter
      _bmSetSearchActive(false);
      status.textContent = `SeekDB: 0 results for "${q}"`;
      status.hidden = false;
    }
  } catch (e) {
    // SeekDB unavailable — client-side filter already showing, suppress error
    _bmSetSearchActive(false);
  }
}

function _renderBmSearchResults(results) {
  _bmLastSearchResults = results;
  // Search results replace the paginated browse view — hide the pager entirely.
  _BM_PAGER.hide();
  const tagFilter = document.getElementById('bm-tag-filter')?.value || '';
  _bmDetectCols(results);
  const sorter = _bmCurrentTableSort();
  let rows = tagFilter ? results.filter(r => (r.tags || []).includes(tagFilter)) : results;
  rows = sorter.sortRows(rows, _bmSortValue);
  _bmDisplayedSearchRows = rows.slice();
  const tbody = document.getElementById('bm-tbody');
  const status = document.getElementById('bm-search-status');
  if (!rows.length) {
    _bmRenderSharedTable(() => {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${_bmColCount()}">No results found.</td></tr>`;
    });
    if (status) { status.textContent = '0 results'; status.hidden = false; }
    return;
  }
  _bmColResizeDone = false;
  _bmRenderSharedTable(() => {
    tbody.innerHTML = rows.map((r, i) => _bmBuildSearchRow(r, i)).join('');
  });
  if (status) { status.textContent = rows.length + ' result' + (rows.length === 1 ? '' : 's') + (tagFilter ? ` (tag: ${tagFilter})` : ''); status.hidden = false; }
}

// ── Render table (local filter, no SeekDB) ──────────────────────────────
// opts.keepPage — if true, stay on the current page instead of resetting to 1.
// Pass keepPage=true when only the column visibility or a single row changed;
// leave it false (default) for filter/sort/load changes so the user always
// sees results from the start.

function renderBookmarks(opts = {}) {
  if (_bmSearchActive) return;
  if (!opts.keepPage) _BM_PAGER.resetPage();
  const q = (document.getElementById('bm-search')?.value || '').toLowerCase();
  const tagFilter = document.getElementById('bm-tag-filter')?.value || '';
  let rows = _bookmarks;
  if (q) {
    rows = rows.filter(b =>
      (b.title || '').toLowerCase().includes(q) ||
      (b.url || '').toLowerCase().includes(q) ||
      (b.description || '').toLowerCase().includes(q) ||
      (b.notes || '').toLowerCase().includes(q) ||
      (b.tags || []).some(t => !_bmExcludedTags.has(t.toLowerCase()) && t.toLowerCase().includes(q))
    );
  }
  if (tagFilter) {
    rows = rows.filter(b => (b.tags || []).includes(tagFilter));
  }
  rows = _bmCurrentTableSort().sortRows(rows, _bmSortValue);
  const pageData = _BM_PAGER.getSlice(rows);
  const totalRows = pageData.totalItems;
  const pageRows = pageData.items;
  const tbody = document.getElementById('bm-tbody');
  const status = document.getElementById('bm-search-status');
  if (pageData.enabled && pageData.paged) {
    status.textContent = `${totalRows} bookmark${totalRows === 1 ? '' : 's'} (showing ${pageData.from}-${pageData.to})`;
  } else {
    status.textContent = totalRows + ' bookmark' + (totalRows === 1 ? '' : 's');
  }
  status.hidden = false;
  _bmColResizeDone = false;
  if (!pageRows.length) {
    _bmRenderSharedTable(() => {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${_bmColCount()}">No bookmarks found.</td></tr>`;
    });
    _BM_PAGER.render(totalRows);
    return;
  }
  _bmRenderSharedTable(() => {
    tbody.innerHTML = pageRows.map(b => _bmBuildBookmarkRow(b)).join('');
  });
  _BM_PAGER.render(totalRows);
}

function _bmIsPaginationEnabled() {
  return _BM_PAGER.isEnabled();
}

function _bmTogglePagination() {
  _BM_PAGER.toggleEnabled();
  if (typeof ProbesMenuConfig !== 'undefined') ProbesMenuConfig.updateActiveTab();
}
// ── Visits ──────────────────────────────────────────────────────────────

// ── Visit column metadata ────────────────────────────────────────────────
const _VIS_FIELD_META = {
  title:       { label: 'Title',       render: v => `<td><a href="${esc(v.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">${esc(v.title || v.url || '')}</a></td>` },
  url:         { label: 'URL',         render: v => `<td style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(v.url)}"><a class="table-cell-link" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--text-dim)">${_bmTruncUrl(v.url)}</a></td>` },
  domain:      { label: 'Domain',      render: v => `<td style="font-size:11px;color:var(--text-dim)">${esc(v.domain || '')}</td>` },
  source:      { label: 'Source',      render: v => `<td style="font-size:11px;color:var(--text-dim)">${esc(v.source || '')}</td>` },
  dwell_seconds:{ label: 'Dwell',      render: v => `<td style="font-size:11px;color:var(--text-dim)">${v.dwell_seconds ? v.dwell_seconds + 's' : '—'}</td>` },
  visit_count: { label: 'Times',       render: v => `<td style="font-size:11px;text-align:center">${v.visit_count > 1 ? `<span style="font-weight:600;color:var(--accent)">${v.visit_count}</span>` : `<span style="color:var(--text-dim)">1</span>`}</td>` },
  visited_at:  { label: 'Visited',     render: v => `<td style="font-size:11px;color:var(--text-dim);white-space:nowrap">${_bmFmtDate(v.visited_at || '')}</td>` },
  _actions:    { label: 'Actions',     render: v => _visRenderVisitActionsCell(v) },
};

const _VIS_ALL_COLS    = ['title', 'url', 'domain', 'source', 'dwell_seconds', 'visit_count', 'visited_at', '_actions'];
const _VIS_DEFAULT_HIDDEN = ['domain'];
// sortKey: the field name to sort on (null = not sortable)
const _VIS_SORT_KEYS = { title: 'title', url: 'url', domain: 'domain', source: 'source',
  dwell_seconds: 'dwell_seconds', visit_count: 'visit_count', visited_at: 'visited_at' };

let _visTableView = null;
let _visLastSortKey = 'visited_at';

function _visDefaultWidth(col) {
  if (col === '_actions') return _visActionCellWidth();
  if (col === 'visit_count') return 50;
  return null;
}

function _ensureVisitsTableView() {
  if (_visTableView || typeof TableView === 'undefined') return _visTableView;
  _visTableView = TableView.create({
    storageKey: 'vis-table-prefs',
    legacyHiddenKey: 'vis-hidden-cols',
    defaultHidden: _VIS_DEFAULT_HIDDEN,
    columns: _VIS_ALL_COLS,
    meta: Object.fromEntries(_VIS_ALL_COLS.map(col => [col, {
      label: _VIS_FIELD_META[col]?.label ?? col,
      sortKey: _VIS_SORT_KEYS[col] || null,
    }])),
    getTable: () => document.getElementById('vis-table'),
    getDefaultWidth: col => _visDefaultWidth(col),
    getHeaderStyle: col => (col === 'visit_count' ? 'text-align:center' : ''),
    minWidth: 40,
    sort: {
      defaultKey: 'visited_at',
      defaultDir: -1,
      storageKey: 'visit-history-table-sort',
    },
    onSortChange: nextState => {
      _visHandleSortChange(nextState);
      _ensureVisitsLayoutController()?.scheduleLayoutSave();
    },
    onColumnResizeEnd: () => {
      _ensureVisitsLayoutController()?.scheduleLayoutSave();
    },
  });
  _visLastSortKey = _visTableView.sorter?.getState?.().key || 'visited_at';
  return _visTableView;
}

function _visGetSortState() {
  return _ensureVisitsTableView()?.sorter?.getState?.() || { key: 'visited_at', dir: -1 };
}

// Visual-only pagination for visits — same pattern as bookmarks
const _VIS_PAGE_SIZE_OPTIONS = [25, 50, 75, 100, 250, 1000];
const _VIS_PAGER = TablePager.create({
  pagerId: 'vis-pagination',
  pageSizeOptions: _VIS_PAGE_SIZE_OPTIONS,
  defaultPageSize: 100,
  storageKey: 'vis-pagination-prefs',
  stateScope: function () {
    var state = _visGetSortState();
    return state.key === 'url' || state.key === 'domain' ? 'grouped' : 'rows';
  },
  defaultEnabled: true,
  onChange: function () {
    renderVisits({ keepPage: true });
  },
});

// Domain grouping — active when sorted by url or domain
let _visExpandedDomains = new Set(); // domains currently expanded in group mode

function _visColCount() {
  return _ensureVisitsTableView()?.getVisibleCols()?.length || 1;
}

let _visitsLayoutController = null;

function _visColumnSeed(col) {
  const types = { title: 'TEXT', url: 'TEXT', domain: 'TEXT', source: 'TEXT', dwell_seconds: 'REAL', visit_count: 'INTEGER', visited_at: 'TEXT' };
  const lengths = { title: 80, url: 120, domain: 48, source: 16, dwell_seconds: 8, visit_count: 8, visited_at: 19 };
  return {
    sqlite_column: col.startsWith('_') ? null : col,
    data_type: types[col] || null,
    sample_max_length: lengths[col] || null,
    min_width_px: col === '_actions' ? _VIS_ACTION_COMPACT_WIDTH : 40,
    max_width_px: col === '_actions' ? _VIS_ACTION_INLINE_WIDTH : 900,
    width_px: _ensureVisitsTableView()?.prefs?.getWidth(col) || _visDefaultWidth(col),
  };
}

function _ensureVisitsLayoutController() {
  if (_visitsLayoutController || typeof TableBucketLayouts === 'undefined') return _visitsLayoutController;
  _visitsLayoutController = TableBucketLayouts.create({
    getTable: () => document.getElementById('vis-table'),
    getView: () => _ensureVisitsTableView(),
    getColumns: () => _VIS_ALL_COLS,
    getMeta: col => ({ label: _VIS_FIELD_META[col]?.label ?? col, sortKey: _VIS_SORT_KEYS[col] || null }),
    getDefaultWidth: col => _visDefaultWidth(col),
    getColumnSeed: col => _visColumnSeed(col),
    render: () => renderVisits(),
    surfaceLabel: 'Visit History',
    layoutContextTitle: 'Visit History Layout Context',
  });
  return _visitsLayoutController;
}

async function toggleVisitsHorizontalScroll() {
  const controller = _ensureVisitsLayoutController();
  if (!controller) return;
  await controller.toggleHorizontalScroll();
}

async function openVisitsLayoutContextModal() {
  const controller = _ensureVisitsLayoutController();
  if (!controller) return;
  await controller.openLayoutContextModal();
}

function _visSortValue(visit, sortKey) {
  switch (sortKey) {
    case 'dwell_seconds':
      return visit.dwell_seconds == null ? Number.NEGATIVE_INFINITY : Number(visit.dwell_seconds);
    case 'visit_count':
      return visit.visit_count == null ? 0 : Number(visit.visit_count);
    case 'visited_at':
      return visit.visited_at || '';
    default:
      return visit[sortKey];
  }
}

function _visHandleSortChange(nextState) {
  const prevKey = _visLastSortKey;
  const wasGroupMode = prevKey === 'url' || prevKey === 'domain';
  const nextKey = nextState?.key || null;
  const nowGroupMode = nextKey === 'url' || nextKey === 'domain';
  _visLastSortKey = nextKey;
  if (!wasGroupMode && nowGroupMode) _visExpandedDomains = new Set();
  renderVisits();
}

// Return the hostname (stripped of www.) for a URL string
function _visDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch (_) { return ''; }
}

// Return the first path segment of a URL, e.g. '/docs', or '/' for root
function _visFirstSlug(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts.length ? '/' + parts[0] : '/';
  } catch (_) { return '/'; }
}

function _visOpenColsModal() {
  const view = _ensureVisitsTableView();
  if (!view) return;
  view.openColumns(
    document.getElementById('vis-cols-modal-list'),
    document.getElementById('vis-cols-modal'),
    k => _VIS_FIELD_META[k]?.label ?? k
  );
}

function _visApplyColsModal() {
  const view = _ensureVisitsTableView();
  if (!view) return;
  const modal = document.getElementById('vis-cols-modal');
  view.applyColumns(modal, () => {
    renderVisits({ keepPage: true });
    HubModal.close(modal);
    _ensureVisitsLayoutController()?.scheduleLayoutSave();
  });
}

async function loadVisits() {
  const err = document.getElementById('bm-error');
  err.hidden = true;
  try {
    const r = await apiFetch('/api/v1/bookmarks/visits?limit=1000');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _bmVisits = await r.json();
    renderVisits();
  } catch (e) {
    err.textContent = `Failed to load visits: ${e.message}`;
    err.hidden = false;
  }
}

function renderVisits(opts = {}) {
  if (!opts.keepPage) _VIS_PAGER.resetPage();
  const q = (document.getElementById('bm-visit-search')?.value || '').toLowerCase();
  const savedFilter = document.getElementById('bm-visit-saved-filter')?.value || 'all';
  const view = _ensureVisitsTableView();
  let rows = _bmVisits;
  if (q) {
    rows = rows.filter(v =>
      (v.title || '').toLowerCase().includes(q) ||
      (v.url || '').toLowerCase().includes(q) ||
      (v.domain || '').toLowerCase().includes(q)
    );
  }
  if (savedFilter === 'saved') rows = rows.filter(v => v.bookmark_id);
  if (savedFilter === 'unsaved') rows = rows.filter(v => !v.bookmark_id);
  rows = view?.sorter ? view.sorter.sortRows(rows, _visSortValue) : rows;

  const visSortState = _visGetSortState();
  const groupMode = visSortState.key === 'url' || visSortState.key === 'domain';
  const expandBtn = document.getElementById('vis-expand-all-btn');
  const collapseBtn = document.getElementById('vis-collapse-all-btn');
  if (expandBtn) expandBtn.hidden = !groupMode;
  if (collapseBtn) collapseBtn.hidden = !groupMode;

  const cols = view?.getVisibleCols() || ['title'];
  const tbody = document.getElementById('bm-visits-tbody');
  const status = document.getElementById('vis-status');

  if (!groupMode) {
    const pageData = _VIS_PAGER.getSlice(rows);
    const total = pageData.totalItems;
    const pageRows = pageData.items;
    if (status) {
      if (pageData.enabled && pageData.paged) {
        status.textContent = `${total} visit${total === 1 ? '' : 's'} (showing ${pageData.from}-${pageData.to})`;
      } else {
        status.textContent = `${total} visit${total === 1 ? '' : 's'}`;
      }
      status.hidden = false;
    }
    if (!pageRows.length) {
      view?.render(() => {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="${cols.length}">No visit history.</td></tr>`;
      });
      _VIS_PAGER.render(total);
      return;
    }
    const expandColspan = cols.length;
    view?.render(() => {
      tbody.innerHTML = pageRows.map(v => {
        const expandId = `ve-${esc(v.visit_id)}`;
        const tds = cols.map(k => (_VIS_FIELD_META[k]?.render ?? (v => `<td>${esc(String(v[k] ?? ''))}</td>`))(v)).join('');
        return `<tr>${tds}</tr>
        <tr id="${expandId}" style="display:none">
          <td colspan="${expandColspan}" style="padding:0 0 6px 18px">
            <div id="${expandId}-body" style="font-size:11px;color:var(--text-dim)">Loading&hellip;</div>
          </td>
        </tr>`;
      }).join('');
    });
    _VIS_PAGER.render(total);
    return;
  }

  const domainOrder = [];
  const domainGroups = new Map();
  for (const v of rows) {
    const domain = v.domain || _visDomain(v.url || '') || '(unknown)';
    if (!domainGroups.has(domain)) {
      domainGroups.set(domain, []);
      domainOrder.push(domain);
    }
    domainGroups.get(domain).push(v);
  }

  const items = [];
  for (const domain of domainOrder) {
    const visits = domainGroups.get(domain);
    const expanded = _visExpandedDomains.has(domain);
    const totalVisitCount = visits.reduce((sum, v) => sum + (v.visit_count || 1), 0);
    items.push({ type: 'domain-header', domain, urlCount: visits.length, totalVisitCount, expanded });
    if (expanded) {
      const slugSet = new Set(visits.map(v => _visFirstSlug(v.url || '')));
      const hasMultipleSlugs = slugSet.size > 1;
      let lastSlug = null;
      for (const v of visits) {
        const slug = _visFirstSlug(v.url || '');
        if (hasMultipleSlugs && slug !== lastSlug) {
          items.push({ type: 'slug-header', slug });
          lastSlug = slug;
        }
        items.push({ type: 'visit', v });
      }
    }
  }

  const pageData = _VIS_PAGER.getSlice(items);
  const totalItems = pageData.totalItems;
  const pageItems = pageData.items;

  if (status) {
    const totalDomains = domainOrder.length;
    const totalVisits = rows.reduce((sum, v) => sum + (v.visit_count || 1), 0);
    const totalUrls = rows.length;
    const expandedCount = [..._visExpandedDomains].filter(d => domainGroups.has(d)).length;
    let statusText = `${totalVisits} visit${totalVisits === 1 ? '' : 's'} (${totalUrls} URL${totalUrls === 1 ? '' : 's'}) across ${totalDomains} domain${totalDomains === 1 ? '' : 's'}`;
    if (expandedCount) statusText += ` (${expandedCount} expanded)`;
    if (pageData.enabled && pageData.paged) {
      statusText += ` - rows ${pageData.from}-${pageData.to} of ${totalItems}`;
    }
    status.textContent = statusText;
    status.hidden = false;
  }

  if (!pageItems.length) {
    view?.render(() => {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${cols.length}">No visit history.</td></tr>`;
    });
    _VIS_PAGER.render(totalItems);
    return;
  }

  const expandColspan = cols.length;
  let html = '';
  for (const item of pageItems) {
    if (item.type === 'domain-header') {
      const chevron = item.expanded ? '&#9660;' : '&#9658;';
      html += `<tr class="vis-group-header" onclick="_visToggleDomain('${esc(item.domain)}')"
        style="cursor:pointer;background:rgba(0,0,0,0.25)">
        <td colspan="${expandColspan}" style="padding:7px 10px;font-weight:600;font-size:12px;user-select:none">
          <span style="color:var(--text-dim);margin-right:6px;font-size:11px">${chevron}</span>
          <span style="color:var(--accent)">${esc(item.domain)}</span>
          <span style="color:var(--text-dim);font-weight:400;margin-left:8px;font-size:11px">${item.totalVisitCount} visit${item.totalVisitCount === 1 ? '' : 's'}</span>
          ${item.urlCount > 1 ? `<span style="color:var(--text-dim);font-weight:400;font-size:10px;margin-left:5px">(${item.urlCount} URLs)</span>` : ''}
        </td>
      </tr>`;
    } else if (item.type === 'slug-header') {
      html += `<tr class="vis-slug-header">
        <td colspan="${expandColspan}" style="padding:3px 10px 3px 28px;font-size:11px;color:var(--text-dim);border-top:1px solid rgba(255,255,255,0.06);background:rgba(0,0,0,0.12);font-style:italic">${esc(item.slug)}</td>
      </tr>`;
    } else {
      const v = item.v;
      const expandId = `ve-${esc(v.visit_id)}`;
      const tds = cols.map(k => (_VIS_FIELD_META[k]?.render ?? (v => `<td>${esc(String(v[k] ?? ''))}</td>`))(v)).join('');
      html += `<tr>${tds}</tr>
      <tr id="${expandId}" style="display:none">
        <td colspan="${expandColspan}" style="padding:0 0 6px 18px">
          <div id="${expandId}-body" style="font-size:11px;color:var(--text-dim)">Loading&hellip;</div>
        </td>
      </tr>`;
    }
  }
  view?.render(() => {
    tbody.innerHTML = html;
  });
  _VIS_PAGER.render(totalItems);
}

function _visRenderVisitActionsCell(v) {
  const actions = [];
  if (!v.bookmark_id) {
    actions.push(`<button class="secondary table-icon-btn table-icon-btn--save" type="button" title="Save as bookmark" aria-label="Save as bookmark" data-vis-save-url="${esc(v.url)}" data-vis-save-title="${esc(v.title || '')}"></button>`);
  }
  if (v.visit_count > 1) {
    const expandId = `ve-${esc(v.visit_id)}`;
    actions.push(`<button class="secondary table-icon-btn table-icon-btn--history" type="button" title="Show individual visit times" aria-label="Show individual visit times" data-vis-expand-url="${esc(v.normalized_url)}" data-vis-expand-id="${expandId}"></button>`);
  }
  if (!actions.length) return '<td></td>';
  if (_visCompactRowActions()) {
    return `<td class="table-action-cell table-action-cell--compact" style="width:${_VIS_ACTION_COMPACT_WIDTH}px">
      <button class="table-row-action-trigger secondary" type="button" title="Visit actions" data-vis-row-actions="${esc(v.visit_id)}">&#8942;</button>
    </td>`;
  }
  return `<td class="table-action-cell" style="white-space:nowrap"><div class="table-inline-actions">${actions.join(' ')}</div></td>`;
}

function _bmOpenBookmarkRowActions(bookmarkId) {
  if (typeof TableRowActions === 'undefined') return;
  const item = _bookmarks.find(b => String(b.bookmark_id) === String(bookmarkId));
  if (!item) return;
  TableRowActions.open({
    title: item.title || item.url || 'Bookmark actions',
    subtitle: item.url || '',
    actions: [
      { label: 'Edit bookmark', detail: 'Open the bookmark editor', onClick: () => openBookmarkModal(bookmarkId) },
      {
        label: item.archived ? 'Restore bookmark' : 'Archive bookmark',
        detail: item.archived ? 'Move this bookmark back into the active set' : 'Hide this bookmark from the active set',
        onClick: () => archiveBookmark(bookmarkId, !!item.archived),
      },
      {
        label: 'Delete bookmark',
        detail: 'Remove this bookmark permanently',
        tone: 'danger',
        onClick: () => deleteBookmark(bookmarkId, item.title || item.url),
      },
    ],
  });
}

function _visOpenRowActions(visitId) {
  if (typeof TableRowActions === 'undefined') return;
  const visit = _bmVisits.find(v => String(v.visit_id) === String(visitId));
  if (!visit) return;
  const actions = [];
  if (!visit.bookmark_id) {
    actions.push({
      label: 'Save as bookmark',
      detail: 'Create a bookmark from this visit',
      onClick: () => promoteVisitToBookmark(visit.url, visit.title || ''),
    });
  }
  if (visit.visit_count > 1) {
    const expandId = `ve-${visit.visit_id}`;
    actions.push({
      label: 'Show visit events',
      detail: 'Expand the grouped visit timestamps for this URL',
      onClick: () => _bmToggleVisitEvents(visit.normalized_url, expandId),
    });
  }
  if (!actions.length) return;
  TableRowActions.open({
    title: visit.title || visit.url || 'Visit actions',
    subtitle: visit.url || '',
    actions,
  });
}

// Toggle a single domain group open/closed
function _visToggleDomain(domain) {
  if (_visExpandedDomains.has(domain)) {
    _visExpandedDomains.delete(domain);
  } else {
    _visExpandedDomains.add(domain);
  }
  renderVisits({ keepPage: true });
}

// Expand or collapse all domain groups
function _visSetAllDomains(expanded) {
  if (expanded) {
    _visExpandedDomains = new Set(
      _bmVisits.map(v => v.domain || _visDomain(v.url || '') || '(unknown)')
    );
  } else {
    _visExpandedDomains = new Set();
  }
  _VIS_PAGER.resetPage();
  renderVisits({ keepPage: true });
}

function _visIsPaginationEnabled() {
  return _VIS_PAGER.isEnabled();
}

function _visTogglePagination() {
  _VIS_PAGER.toggleEnabled();
  if (typeof ProbesMenuConfig !== 'undefined') ProbesMenuConfig.updateActiveTab();
}

async function _bmToggleVisitEvents(normalizedUrl, rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;
  const body = document.getElementById(rowId + '-body');
  if (row.style.display !== 'none') { row.style.display = 'none'; return; }
  row.style.display = '';
  if (body.dataset.loaded) return;
  const fmtDateTime = iso => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    } catch (_) { return iso; }
  };
  try {
    const r = await apiFetch('/api/v1/bookmarks/visit-events?normalized_url=' + encodeURIComponent(normalizedUrl));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const events = await r.json();
    body.dataset.loaded = '1';
    if (!events.length) { body.textContent = 'No events recorded.'; return; }
    body.innerHTML = '<table style="border-collapse:collapse;width:100%"><thead><tr>'
      + '<th style="text-align:left;padding:2px 8px;color:var(--text-dim);font-weight:600">Date / Time</th>'
      + '<th style="text-align:left;padding:2px 8px;color:var(--text-dim);font-weight:600">Dwell</th>'
      + '</tr></thead><tbody>'
      + events.map(e => {
          const d = e.dwell_seconds ? `${e.dwell_seconds}s` : '—';
          return `<tr><td style="padding:2px 8px">${esc(fmtDateTime(e.visited_at))}</td><td style="padding:2px 8px">${d}</td></tr>`;
        }).join('')
      + '</tbody></table>';
  } catch(err) {
    body.textContent = `Failed: ${err.message}`;
  }
}

function _bmToggleVisits() {
  switchTab('bookmarks-history');
  if (typeof ProbesMenuConfig !== 'undefined') ProbesMenuConfig.updateActiveTab('bookmarks-history');
  loadVisits();
}

function _bmToggleSetup() {
  switchTab('bookmarks-setup');
  if (typeof ProbesMenuConfig !== 'undefined') ProbesMenuConfig.updateActiveTab('bookmarks-setup');
  _bmPopulateExtUrls();
}

function _bmHandleResultsTableClick(e) {
  const cell = e.target.closest('.bm-score-cell');
  if (cell) {
    _bmOpenScoreModal(cell);
    return;
  }

  const editBtn = e.target.closest('[data-bm-edit-id]');
  if (editBtn) {
    openBookmarkModal(editBtn.dataset.bmEditId);
    return;
  }

  const archiveBtn = e.target.closest('[data-bm-archive-id]');
  if (archiveBtn) {
    archiveBookmark(archiveBtn.dataset.bmArchiveId, archiveBtn.dataset.bmArchiveState === '1');
    return;
  }

  const deleteBtn = e.target.closest('[data-bm-delete-id]');
  if (deleteBtn) {
    deleteBookmark(deleteBtn.dataset.bmDeleteId, deleteBtn.dataset.bmDeleteTitle || '');
    return;
  }

  const bmActionsBtn = e.target.closest('[data-bm-row-actions]');
  if (bmActionsBtn) {
    _bmOpenBookmarkRowActions(bmActionsBtn.dataset.bmRowActions);
    return;
  }

  const visSaveBtn = e.target.closest('[data-vis-save-url]');
  if (visSaveBtn) {
    promoteVisitToBookmark(visSaveBtn.dataset.visSaveUrl || '', visSaveBtn.dataset.visSaveTitle || '');
    return;
  }

  const visExpandBtn = e.target.closest('[data-vis-expand-url]');
  if (visExpandBtn) {
    _bmToggleVisitEvents(visExpandBtn.dataset.visExpandUrl || '', visExpandBtn.dataset.visExpandId || '');
    return;
  }

  const visActionsBtn = e.target.closest('[data-vis-row-actions]');
  if (visActionsBtn) {
    _visOpenRowActions(visActionsBtn.dataset.visRowActions);
  }
}

let _bmReindexPollTimer = null;

function _bmToggleEmbedCfg() {
  switchTab('bookmarks-embeddings');
  if (typeof ProbesMenuConfig !== 'undefined') ProbesMenuConfig.updateActiveTab('bookmarks-embeddings');
  _bmLoadEmbedCfg();
}

async function _bmLoadEmbedCfg() {
  try {
    const r = await apiFetch('/api/v1/bookmarks/embedding-config');
    if (!r.ok) return;
    const cfg = await r.json();
    _bmRenderExclTags(cfg.excluded_tags || []);
    _bmCurrentExclTags = cfg.excluded_tags || [];
    const thr = document.getElementById('bm-domain-threshold');
    if (thr) thr.value = cfg.domain_threshold ?? 3;
    const analyzeStatus = document.getElementById('bm-analyze-status');
    if (analyzeStatus && cfg.rare_domains_count != null)
      analyzeStatus.textContent = `${cfg.rare_domains_count} rare domains stored`;
  } catch (_) {}
  // Populate tag datalist from the full tag list
  _bmPopulateExclTagDatalist();
  // Also check if reindex is already running (survives page refresh)
  _bmPollReindexProgress();
}

// ── Embedding config panel ────────────────────────────────────────────────────

async function _bmPopulateExclTagDatalist() {
  try {
    const r = await apiFetch('/api/v1/bookmarks/tags-with-counts');
    if (!r.ok) return;
    const rows = await r.json(); // [{tag, active, archived}, ...]
    _bmTagCounts = {};
    _bmAllTags = rows.map(row => {
      _bmTagCounts[row.tag] = { active: row.active, archived: row.archived };
      return row.tag;
    });
  } catch (_) {}
}

function _bmOpenExclTagModal() {
  const modal = document.getElementById('bm-excl-tag-modal');
  if (!modal) return;
  document.getElementById('bm-excl-modal-search').value = '';
  document.getElementById('bm-excl-modal-status').textContent = '';
  const excluded = new Set(_bmCurrentExclTags);
  _bmRenderExclTagModalList(excluded, '');
  _bmUpdateExclModalCount();
  HubModal.open(modal);
  document.getElementById('bm-excl-modal-search').focus();
}

function _bmRenderExclTagModalList(excluded, filter) {
  const container = document.getElementById('bm-excl-modal-list');
  if (!container) return;
  const f = filter.toLowerCase().trim();
  // Union: all known tags + any excluded tags that have no bookmarks (orphans)
  const allKnown = new Set(_bmAllTags);
  const combined = [..._bmAllTags];
  for (const t of excluded) { if (!allKnown.has(t)) combined.unshift(t); }
  const visible = f ? combined.filter(t => t.includes(f)) : combined;
  // Excluded tags sorted to top, then alpha
  visible.sort((a, b) => {
    const ae = excluded.has(a), be = excluded.has(b);
    if (ae !== be) return ae ? -1 : 1;
    return a.localeCompare(b);
  });
  container.innerHTML = visible.map(tag => {
    const checked = excluded.has(tag) ? 'checked' : '';
    const c = _bmTagCounts[tag] || { active: 0, archived: 0 };
    const activeTxt = `<span class="bm-tc-active" title="active">${c.active}</span>`;
    const archTxt   = `<span class="bm-tc-arch"   title="archived">${c.archived}</span>`;
    return `<label class="hub-checkbox hub-checkbox--row"><input class="hub-checkbox__input" type="checkbox" data-tag="${esc(tag)}" ${checked} /><span class="hub-checkbox__box" aria-hidden="true"></span><span class="bm-tc-name">${esc(tag)}</span><span class="bm-tc-counts">${activeTxt}${archTxt}</span></label>`;
  }).join('');
}

function _bmGetExclTagModalSelected() {
  return Array.from(
    document.querySelectorAll('#bm-excl-modal-list input[type=checkbox]:checked')
  ).map(cb => cb.dataset.tag);
}

function _bmUpdateExclModalCount() {
  const checked = document.querySelectorAll('#bm-excl-modal-list input[type=checkbox]:checked').length;
  const total   = document.querySelectorAll('#bm-excl-modal-list input[type=checkbox]').length;
  const el = document.getElementById('bm-excl-modal-count');
  if (el) el.textContent = `${checked} excluded • ${total} shown`;
}

function _bmRenderExclTags(tags) {
  const list = document.getElementById('bm-excl-tag-list');
  if (!list) return;
  list.innerHTML = '';
  (tags || []).forEach(tag => {
    const chip = document.createElement('span');
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:2px 8px;font-size:12px';
    chip.dataset.tag = tag;
    chip.innerHTML = `${esc(tag)} <button data-remove-tag="${esc(tag)}" style="background:none;border:none;cursor:pointer;font-size:13px;line-height:1;padding:0;color:var(--text-dim)">&#10005;</button>`;
    list.appendChild(chip);
  });
}

function _bmGetExclTags() {
  const list = document.getElementById('bm-excl-tag-list');
  if (!list) return [];
  return Array.from(list.querySelectorAll('[data-tag]')).map(el => el.dataset.tag);
}

function _bmInitEmbedPanel() {
  // bm-embed-panel is now a permanent section (tab-bookmarks-embeddings).
  // No close button — close btn wiring is no longer needed.
  // Wire the remaining interactive controls.

  // Bookmark modal Save button
  document.getElementById('bm-modal-save-btn')?.addEventListener('click', saveBookmark);

  // Open tag exclusion modal
  document.getElementById('bm-excl-tag-edit-btn')?.addEventListener('click', () => {
    if (!_bmAllTags.length) {
      _bmPopulateExclTagDatalist().then(() => _bmOpenExclTagModal());
    } else {
      _bmOpenExclTagModal();
    }
  });

  // Remove tag chip via event delegation
  document.getElementById('bm-excl-tag-list')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-remove-tag]');
    if (!btn) return;
    _bmCurrentExclTags = _bmCurrentExclTags.filter(t => t !== btn.dataset.removeTag);
    _bmRenderExclTags(_bmCurrentExclTags);
  });

  // Save excluded tags (chip-level; updates server + state)
  document.getElementById('bm-excl-tag-save-btn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('bm-excl-tag-status');
    statusEl.textContent = 'Saving…';
    try {
      const r = await apiFetch('/api/v1/bookmarks/embedding-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excluded_tags: _bmCurrentExclTags }),
      });
      statusEl.textContent = r.ok ? '✓ Saved' : `Error ${r.status}`;
    } catch (e) {
      statusEl.textContent = `Error: ${e.message}`;
    }
    setTimeout(() => { statusEl.textContent = ''; }, 3000);
  });

  // Modal: filter input re-renders list preserving checked state
  document.getElementById('bm-excl-modal-list')?.addEventListener('change', _bmUpdateExclModalCount);
  document.getElementById('bm-excl-modal-search')?.addEventListener('input', e => {
    const selected = new Set(_bmGetExclTagModalSelected());
    _bmRenderExclTagModalList(selected, e.target.value);
    _bmUpdateExclModalCount();
  });

  // Modal: Apply & Save
  document.getElementById('bm-excl-modal-apply-btn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('bm-excl-modal-status');
    const applyBtn = document.getElementById('bm-excl-modal-apply-btn');
    applyBtn.disabled = true;
    statusEl.textContent = 'Saving…';
    const tags = _bmGetExclTagModalSelected();
    try {
      const r = await apiFetch('/api/v1/bookmarks/embedding-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excluded_tags: tags }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      _bmCurrentExclTags = tags;
      _bmRenderExclTags(tags);
      HubModal.close(document.getElementById('bm-excl-tag-modal'));
    } catch (e) {
      statusEl.textContent = `Error: ${e.message}`;
      applyBtn.disabled = false;
    }
  });

  // Restore apply button state when modal closes (ESC or cancel)
  document.getElementById('bm-excl-tag-modal')?.addEventListener('close', () => {
    const applyBtn = document.getElementById('bm-excl-modal-apply-btn');
    if (applyBtn) { applyBtn.disabled = false; }
    document.getElementById('bm-excl-modal-status').textContent = '';
  });

  // Analyse domains
  document.getElementById('bm-analyze-domains-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('bm-analyze-domains-btn');
    const statusEl = document.getElementById('bm-analyze-status');
    const threshold = parseInt(document.getElementById('bm-domain-threshold')?.value || '3', 10);
    btn.disabled = true;
    statusEl.textContent = 'Analysing…';
    try {
      // Save threshold first
      await apiFetch('/api/v1/bookmarks/embedding-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain_threshold: threshold }),
      });
      const r = await apiFetch('/api/v1/bookmarks/analyze-domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain_threshold: threshold }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      statusEl.textContent = `✓ ${data.rare_domains_count} rare domains found (threshold ≤${data.threshold})`;
    } catch (e) {
      statusEl.textContent = `Error: ${e.message}`;
    } finally {
      btn.disabled = false;
    }
  });

  // Reindex all
  document.getElementById('bm-reindex-btn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('bm-reindex-status');
    statusEl.textContent = 'Starting…';
    try {
      const r = await apiFetch('/api/v1/bookmarks/reindex', { method: 'POST' });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${r.status}`);
      }
      statusEl.textContent = 'Running…';
      _bmPollReindexProgress();
    } catch (e) {
      statusEl.textContent = `Error: ${e.message}`;
    }
  });
}

function _bmPollReindexProgress() {
  if (_bmReindexPollTimer) return; // already polling
  _bmReindexPollTimer = setInterval(_bmCheckReindexProgress, 1500);
  _bmCheckReindexProgress();
}

async function _bmCheckReindexProgress() {
  try {
    const r = await apiFetch('/api/v1/bookmarks/reindex-progress');
    if (!r.ok) return;
    const state = await r.json();
    const wrap = document.getElementById('bm-reindex-progress-wrap');
    const bar = document.getElementById('bm-reindex-progress-bar');
    const label = document.getElementById('bm-reindex-progress-label');
    const statusEl = document.getElementById('bm-reindex-status');
    const btn = document.getElementById('bm-reindex-btn');

    if (state.running || state.total > 0) {
      if (wrap) wrap.style.display = '';
      const pct = state.total > 0 ? Math.round((state.done / state.total) * 100) : 0;
      if (bar) bar.style.width = `${pct}%`;
      if (label) label.textContent = `${state.done} / ${state.total} (${pct}%)`;
      if (btn) btn.disabled = state.running;
      if (state.running) {
        if (statusEl) statusEl.textContent = 'Running…';
      } else {
        // Completed
        if (statusEl) {
          statusEl.textContent = state.error
            ? `✗ Failed: ${state.error}`
            : `✓ Done — ${state.done} bookmarks re-embedded`;
          statusEl.style.color = state.error ? 'var(--err)' : 'var(--ok,#4caf50)';
        }
        if (label) label.textContent = state.error ? '' : `${state.done} / ${state.total} (100%)`;
        if (btn) btn.disabled = false;
        clearInterval(_bmReindexPollTimer);
        _bmReindexPollTimer = null;
      }
    } else {
      // Not running, nothing to show
      clearInterval(_bmReindexPollTimer);
      _bmReindexPollTimer = null;
    }
  } catch (_) {
    clearInterval(_bmReindexPollTimer);
    _bmReindexPollTimer = null;
  }
}

async function _bmPopulateExtUrls() {
  const loadingEl = document.getElementById('bm-ext-url-loading');
  const urlsEl    = document.getElementById('bm-ext-urls');
  if (!urlsEl || urlsEl.dataset.loaded) return;

  // Always include the URL the browser is currently using — it's working by definition
  const urls = [{ label: 'This page (current network)', url: window.location.origin }];

  // Also fetch peer nodes to show Tailscale URL if available
  try {
    const r = await apiFetch('/api/v1/nodes/self');
    if (r.ok) {
      const self = await r.json();
      if (self.tailnet_hostname) {
        const tsUrl = `https://${self.tailnet_hostname}`;
        if (tsUrl !== window.location.origin) {
          urls.push({ label: 'Tailscale', url: tsUrl });
        }
      }
      if (self.primary_hostname) {
        const lanUrl = `https://${self.primary_hostname}`;
        if (!urls.some(u => u.url === lanUrl)) {
          urls.push({ label: 'LAN hostname', url: lanUrl });
        }
      }
    }
  } catch (_) { /* non-fatal */ }

  const rows = urls.map(u =>
    `<div style="display:flex;align-items:center;gap:8px;margin-top:3px">` +
    `<span style="color:var(--text-dim);min-width:160px">${esc(u.label)}:</span>` +
    `<code style="background:rgba(255,255,255,.07);padding:2px 7px;border-radius:3px;user-select:all;cursor:text">${esc(u.url)}</code>` +
    `</div>`
  ).join('');

  if (loadingEl) loadingEl.style.display = 'none';
  urlsEl.innerHTML = rows;
  urlsEl.style.display = '';
  urlsEl.dataset.loaded = '1';
}

function promoteVisitToBookmark(url, title) {
  openBookmarkModal(null);
  document.getElementById('bm-modal-url').value = url || '';
  document.getElementById('bm-modal-title-input').value = title || '';
}

// ── Add / Edit modal ────────────────────────────────────────────────────

async function openBookmarkModal(id) {
  const modal = document.getElementById('bm-modal');
  const badge = document.getElementById('bm-modal-badge');
  document.getElementById('bm-modal-id').value = id || '';
  if (badge) badge.textContent = id ? 'EDIT' : 'ADD';
  document.getElementById('bm-modal-heading').textContent = id ? 'Edit bookmark' : 'Add bookmark';
  document.getElementById('bm-modal-error').textContent = '';
  if (id) {
    try {
      const r = await apiFetch(`/api/v1/bookmarks/${id}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const b = await r.json();
      document.getElementById('bm-modal-url').value         = b.url || '';
      document.getElementById('bm-modal-title-input').value = b.title || '';
      document.getElementById('bm-modal-desc').value        = b.description || '';
      document.getElementById('bm-modal-tags').value        = (b.tags || []).join(', ');
      document.getElementById('bm-modal-folder').value      = b.folder || '';
      document.getElementById('bm-modal-notes').value       = b.notes || '';
      document.getElementById('bm-modal-archived').checked  = b.archived || false;
    } catch (e) {
      document.getElementById('bm-modal-error').textContent = `Failed to load: ${e.message}`;
    }
  } else {
    document.getElementById('bm-modal-url').value         = '';
    document.getElementById('bm-modal-title-input').value = '';
    document.getElementById('bm-modal-desc').value        = '';
    document.getElementById('bm-modal-tags').value        = '';
    document.getElementById('bm-modal-folder').value      = '';
    document.getElementById('bm-modal-notes').value       = '';
    document.getElementById('bm-modal-archived').checked  = false;
  }
  HubModal.open(modal);
}

async function saveBookmark() {
  const id    = document.getElementById('bm-modal-id').value;
  const url   = document.getElementById('bm-modal-url').value.trim();
  const errEl = document.getElementById('bm-modal-error');
  errEl.textContent = '';
  if (!url) { errEl.textContent = 'URL is required.'; return; }

  const body = {
    url,
    title:       document.getElementById('bm-modal-title-input').value.trim() || null,
    description: document.getElementById('bm-modal-desc').value.trim() || null,
    tags:        document.getElementById('bm-modal-tags').value.split(',').map(t => t.trim()).filter(Boolean),
    folder:      document.getElementById('bm-modal-folder').value.trim() || null,
    notes:       document.getElementById('bm-modal-notes').value.trim() || null,
    source:      id ? undefined : 'manual',
    archived:    document.getElementById('bm-modal-archived').checked,
  };
  if (body.source === undefined) delete body.source;

  try {
    const r = id
      ? await apiFetch(`/api/v1/bookmarks/${id}`,
          { method: 'PUT',  headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) })
      : await apiFetch('/api/v1/bookmarks',
          { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || `HTTP ${r.status}`); }
    HubModal.close(document.getElementById('bm-modal'));
    await loadBookmarks();
  } catch (e) {
    errEl.textContent = `Save failed: ${e.message}`;
  }
}

async function deleteBookmark(id, title) {
  const ok = await HubDialogs.confirmDelete({
    title: 'Delete bookmark?',
    message: `Delete bookmark "${title}"?`,
    detail: 'This removes the bookmark from Blueprints and the browser-links store.',
  });
  if (!ok) return;
  try {
    const r = await apiFetch(`/api/v1/bookmarks/${id}`, { method: 'DELETE' });
    if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`);
    _bookmarks = _bookmarks.filter(b => b.bookmark_id !== id);
    renderBookmarks({ keepPage: true }); // stay on current page after deleting one row
  } catch (e) {
    const err = document.getElementById('bm-error');
    err.textContent = `Delete failed: ${e.message}`;
    err.hidden = false;
    await HubDialogs.alertError({
      title: 'Delete failed',
      message: `Failed to delete bookmark: ${e.message}`,
    });
  }
}

// ── Archive / restore bookmark ──────────────────────────────────────────

async function archiveBookmark(id, currentArchived) {
  try {
    const r = await apiFetch(`/api/v1/bookmarks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: !currentArchived }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await loadBookmarks();
  } catch (e) {
    const err = document.getElementById('bm-error');
    err.textContent = `Archive failed: ${e.message}`;
    err.hidden = false;
  }
}

// ── Sort helpers ────────────────────────────────────────────────────────

// ── Column resize ───────────────────────────────────────────────────────

function _bmRenderSharedTable(renderBody) {
  // Both modes delegate to their respective TableView's render
  const view = _bmSearchActive ? _ensureBmSearchTableView() : _ensureBmBrowseTableView();
  if (view) {
    view.render(() => {
      renderBody();
      _bmColResizeDone = true;
    });
    return;
  }
}

// ── Auto-archive dead links ─────────────────────────────────────────────

async function _bmAutoArchiveDead(btn) {
  const panel = document.getElementById('bm-deadlink-panel');
  const statusEl = document.getElementById('bm-deadlink-status');
  const resultsEl = document.getElementById('bm-deadlink-results');
  const total = _bookmarks.length;
  statusEl.textContent = `Checking ${total} bookmark${total === 1 ? '' : 's'} for dead links\u2026 (may take a minute)`;
  statusEl.style.color = 'var(--text-dim)';
  resultsEl.textContent = '';
  panel.style.display = '';
  // btn may be null when called from the navbar menu rather than the toolbar button
  if (btn) btn.disabled = true;
  const orig = btn ? btn.textContent : '';
  if (btn) btn.textContent = '\u27F3 Checking\u2026';
  try {
    const r = await apiFetch('/api/v1/bookmarks/check-dead-links', { method: 'POST' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    statusEl.textContent = `Done \u2014 checked ${data.checked}`;
    statusEl.style.color = 'var(--text)';
    if (data.archived > 0) {
      resultsEl.innerHTML = ` \u00B7 <span style="color:var(--warn)">${data.archived} dead link${data.archived === 1 ? '' : 's'} archived</span>`;
      if (data.errors > 0) resultsEl.innerHTML += ` \u00B7 <span style="color:var(--text-dim)">${data.errors} error${data.errors === 1 ? '' : 's'}</span>`;
      await loadBookmarks();
    } else {
      resultsEl.innerHTML = ` \u00B7 <span style="color:var(--ok)">no dead links found</span>`;
      if (data.errors > 0) resultsEl.innerHTML += ` \u00B7 <span style="color:var(--text-dim)">${data.errors} error${data.errors === 1 ? '' : 's'}</span>`;
    }
  } catch (e) {
    statusEl.textContent = `Check failed: ${e.message}`;
    statusEl.style.color = 'var(--err)';
    resultsEl.textContent = '';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
}

// ── HTML Import (client-side parse + POST to /api/v1/bookmarks/import) ──

async function importBookmarksFile(input) {
  const file = input.files[0];
  if (!file) return;
  const statusEl = document.getElementById('bm-import-status');
  statusEl.textContent = `Parsing ${esc(file.name)}…`;
  statusEl.style.color = 'var(--text-dim)';
  statusEl.hidden = false;
  input.value = '';  // reset so same file can be re-selected

  try {
    const html = await file.text();
    const bookmarks = _parseNetscapeBookmarks(html);
    if (!bookmarks.length) {
      statusEl.textContent = 'No bookmarks found in file.';
      statusEl.style.color = 'var(--warn)';
      return;
    }
    statusEl.textContent = `Importing ${bookmarks.length} bookmarks…`;
    const r = await apiFetch('/api/v1/bookmarks/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookmarks, skip_duplicates: true }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); const det = d.detail; const msg = Array.isArray(det) ? `Validation error: ${det[0]?.msg || JSON.stringify(det[0])} (and ${det.length - 1} more)` : det || `HTTP ${r.status}`; throw new Error(msg); }
    const result = await r.json();
    statusEl.textContent = `Done — imported ${result.imported}, skipped ${result.skipped_duplicates} duplicates.`;
    statusEl.style.color = 'var(--ok)';
    await loadBookmarks();
  } catch (e) {
    statusEl.textContent = `Import failed: ${e.message}`;
    statusEl.style.color = 'var(--err)';
  }
}

// Parse Netscape bookmark HTML format (used by Edge, Chrome, Firefox)
function _parseNetscapeBookmarks(html) {
  const bookmarks = [];
  const folderStack = [];
  let pendingFolder = null;
  // Match DL enter/exit, H3 folder headings, and A bookmark links
  const re = /<DL[^>]*>|<\/DL[^>]*>|<H3[^>]*>([\s\S]*?)<\/H3>|<A\s([^>]+)>([\s\S]*?)<\/A>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const full = m[0];
    if (/^<DL/i.test(full)) {
      folderStack.push(pendingFolder || '');
      pendingFolder = null;
      continue;
    }
    if (/^<\/DL/i.test(full)) {
      folderStack.pop();
      continue;
    }
    if (/^<H3/i.test(full)) {
      pendingFolder = _bmStripHtml(m[1] || '');
      continue;
    }
    if (/^<A\s/i.test(full)) {
      const attrs = m[2] || '';
      const text  = m[3] || '';
      const hrefM = /HREF="([^"]+)"/i.exec(attrs);
      if (!hrefM) continue;
      const url = hrefM[1];
      if (!url || /^(javascript:|about:)/i.test(url)) continue;
      const title = _bmStripHtml(text) || url;
      const folderParts = folderStack.filter(Boolean);
      const folder = folderParts.join('/') || null;
      const tags = folderParts
        .map(f => f.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
        .filter(Boolean);
      bookmarks.push({ url, title, folder: folder ?? '', tags, description: '', notes: '', favicon_url: '', source: 'import' });
    }
  }
  return bookmarks;
}

function _bmStripHtml(html) {
  return (html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();
}

// ── Utilities ────────────────────────────────────────────────────────────

function _bmTagPill(tag) {
  return `<span style="display:inline-block;background:rgba(99,102,241,.18);color:#a5b4fc;border:1px solid rgba(99,102,241,.3);border-radius:3px;padding:0 5px;font-size:10px;margin:1px">${esc(tag)}</span>`;
}

function _bmTruncUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname + u.search;
    const trunc = path.length > 40 ? path.slice(0, 38) + '\u2026' : path;
    return esc(u.host + trunc);
  } catch (_) {
    return esc((url || '').slice(0, 50));
  }
}

function _bmFmtDate(iso) {
  if (!iso) return '\u2014';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (_) {
    return iso;
  }
}

// ── Score analysis modal ─────────────────────────────────────────────────

const _BM_SCORE_METRICS = ['score_sources', 'rrf_score', 'kw_tier', 'cosine_distance', 'reranker_rank', 'exact_tier'];

const _BM_METRIC_LABELS = {
  score_sources:    'Score Sources',
  rrf_score:        'RRF Score',
  kw_tier:          'Keyword Tier',
  cosine_distance:  'Cosine Distance',
  reranker_rank:    'Reranker Rank',
  exact_tier:       'Exact Tier',
};

// Stored context for the currently-open overview modal — used by drill-down delegation.
let _bmScoreCtx = { query: '', result: null };

// Called when any .bm-score-cell is clicked (event-delegated from bm-tbody).
function _bmOpenScoreModal(cell) {
  const tr = cell.closest('tr[data-score-idx]');
  if (!tr) return;
  const idx = parseInt(tr.dataset.scoreIdx, 10);
  const result = _bmDisplayedSearchRows[idx];
  if (!result) return;
  const query = (document.getElementById('bm-search')?.value || '').trim();
  _bmScoreCtx = { query, result };
  const title = result.title || result.url || 'result';
  document.getElementById('bm-score-modal-subtitle').textContent = `"${title.slice(0, 70)}"`;
  const body = document.getElementById('bm-score-modal-body');
  body.innerHTML = _bmScoreLoadingHtml();
  HubModal.open(document.getElementById('bm-score-modal'));
  _bmFetchScoreExplain(query, result, null, body);
}

// Called when a per-metric drill-down link is clicked inside the overview modal.
// Uses _bmScoreCtx so no inline JSON is needed.
function _bmOpenScoreDetailModal(metric) {
  const { query, result } = _bmScoreCtx;
  if (!result) return;
  const label = _BM_METRIC_LABELS[metric] || metric;
  document.getElementById('bm-score-detail-subtitle').textContent = label;
  const body = document.getElementById('bm-score-detail-body');
  body.innerHTML = _bmScoreLoadingHtml();
  HubModal.open(document.getElementById('bm-score-detail-modal'));
  _bmFetchScoreExplain(query, result, metric, body);
}

function _bmScoreLoadingHtml() {
  return `<div style="display:flex;align-items:center;gap:10px;color:var(--text-dim);padding:20px 0">
    <span style="font-size:18px;animation:spin 1s linear infinite;display:inline-block">&#8635;</span>
    <span>Asking LLM…</span>
  </div>`;
}

async function _bmFetchScoreExplain(query, result, focus, bodyEl) {
  try {
    const r = await apiFetch('/api/v1/bookmarks/score-explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, result, focus }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const md = data.explanation || '(No response)';
    let html = typeof _mdToHtml === 'function' ? _mdToHtml(md) : `<pre style="white-space:pre-wrap">${esc(md)}</pre>`;
    if (!focus) {
      // Drill-down links use data-metric and event delegation — no inline JSON
      const metricLinksHtml = _BM_SCORE_METRICS
        .filter(m => result[m] != null)
        .map(m => {
          const label = _BM_METRIC_LABELS[m] || m;
          const val = Array.isArray(result[m]) ? result[m].join(', ') : String(result[m]);
          return `<a href="#" class="bm-score-drill" data-metric="${esc(m)}"
                     style="display:inline-flex;align-items:center;gap:4px;color:var(--accent);font-size:12px;text-decoration:underline;white-space:nowrap"
                  >&#128270; ${esc(label)} <span style="color:var(--text-dim);font-size:11px">(${esc(val.slice(0,30))})</span></a>`;
        }).join('');
      if (metricLinksHtml) {
        html += `<div style="margin-top:24px;padding-top:14px;border-top:1px solid var(--border)">
          <div style="font-size:12px;font-weight:600;color:var(--text-dim);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Drill into a metric</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px">${metricLinksHtml}</div>
        </div>`;
      }
    }
    bodyEl.innerHTML = html;
  } catch (e) {
    bodyEl.innerHTML = `<p style="color:var(--err)">Error: ${esc(e.message)}</p>`;
  }
}

// Event delegation: score cells in results table + drill-down links in overview modal
document.addEventListener('DOMContentLoaded', () => {
  _ensureVisitsLayoutController()?.init();
  _ensureBmBrowseLayoutController()?.init();
  _ensureBmSearchLayoutController()?.init();
  _bmShowArchived = _bmReadShowArchived();
  // Wire the search/filter controls that now live in #pg-ctrl-bookmarks-main
  // (moved from the tab-panel toolbar into the menu-zone page-controls slot).
  const bmSearch   = document.getElementById('bm-search');
  const bmTagFilt  = document.getElementById('bm-tag-filter');
  if (bmSearch)   bmSearch.addEventListener('input', _bmSearchDebounce);
  if (bmTagFilt)  bmTagFilt.addEventListener('change', () => {
    _bmSearchActive ? _renderBmSearchResults(_bmLastSearchResults) : renderBookmarks();
  });

  // Replace native tag-filter select with custom fixed-popup dropdown.
  // Must come AFTER the change listener above so the listener is already
  // registered when HubSelect fires synthetic change events.
  if (typeof HubSelect !== 'undefined') {
    HubSelect.init('bm-tag-filter');
  }

  // Register with responsive layout so controls show/hide on tab switch
  if (typeof ResponsiveLayout !== 'undefined') {
    ResponsiveLayout.registerTabControls('bookmarks-main', 'pg-ctrl-bookmarks-main');
  }

  _ensureBmBrowseTableView()?.onLayoutChange(() => {
    if (_bmModeKey() !== 'browse') return;
    _bmHiddenCols = _ensureBmBrowseTableView().getHiddenSet();
    renderBookmarks({ keepPage: true });
  });

  _ensureBmSearchTableView()?.onLayoutChange(() => {
    if (_bmModeKey() !== 'search') return;
    _bmHiddenCols = _ensureBmSearchTableView().getHiddenSet();
    _bmRebuildThead();
    if (_bmSearchActive) _renderBmSearchResults(_bmLastSearchResults);
  });

  document.getElementById('bm-cols-modal-apply')?.addEventListener('click', _bmApplyColsModal);
  document.getElementById('vis-cols-modal-apply')?.addEventListener('click', _visApplyColsModal);

  document.getElementById('bm-tbody')?.addEventListener('click', _bmHandleResultsTableClick);
  document.getElementById('bm-visits-tbody')?.addEventListener('click', _bmHandleResultsTableClick);
  document.getElementById('bm-score-modal-body')?.addEventListener('click', e => {
    const link = e.target.closest('.bm-score-drill');
    if (link) {
      e.preventDefault();
      _bmOpenScoreDetailModal(link.dataset.metric);
    }
  });

  // Visit History controls (now in #pg-ctrl-bookmarks-history)
  let _visFilterTimer = null;
  const visSearch   = document.getElementById('bm-visit-search');
  const visSaved    = document.getElementById('bm-visit-saved-filter');
  const visExpand   = document.getElementById('vis-expand-all-btn');
  const visCollapse = document.getElementById('vis-collapse-all-btn');
  if (visSearch)   visSearch.addEventListener('input', () => {
    clearTimeout(_visFilterTimer);
    _visFilterTimer = setTimeout(renderVisits, 250);
  });
  if (visSaved)    visSaved.addEventListener('change', renderVisits);
  if (visExpand)   visExpand.addEventListener('click', () => _visSetAllDomains(true));
  if (visCollapse) visCollapse.addEventListener('click', () => _visSetAllDomains(false));
  if (typeof ResponsiveLayout !== 'undefined') {
    ResponsiveLayout.registerTabControls('bookmarks-history', 'pg-ctrl-bookmarks-history');
  }

  _ensureVisitsTableView();
  _visTableView?.onLayoutChange(() => {
    renderVisits({ keepPage: true });
  });

  // Long-press on scoring column headers → column info modal
  (function () {
    const LONG_PRESS_MS = 500;
    const MOVE_THRESHOLD = 6;
    let _lpTimer = null;
    let _lpStart = null;
    const table = document.getElementById('bm-table');
    if (!table) return;
    table.addEventListener('pointerdown', e => {
      const th = e.target.closest('th[data-col]');
      if (!th) return;
      const col = th.dataset.col;
      if (!_BM_COL_INFO_CONTENT[col]) return;
      _lpStart = { x: e.clientX, y: e.clientY };
      _lpTimer = setTimeout(() => {
        _lpTimer = null;
        _bmOpenColInfoModal(col);
      }, LONG_PRESS_MS);
    });
    table.addEventListener('pointermove', e => {
      if (!_lpTimer || !_lpStart) return;
      const dx = e.clientX - _lpStart.x;
      const dy = e.clientY - _lpStart.y;
      if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) {
        clearTimeout(_lpTimer);
        _lpTimer = null;
      }
    });
    const cancelLp = () => { if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; } };
    table.addEventListener('pointerup', cancelLp);
    table.addEventListener('pointercancel', cancelLp);
  })();
});

// ── Column info modal (long-press on scoring column headers) ────────────

const _BM_COL_INFO_CONTENT = {
  rrf_score: {
    title: 'RRF Score',
    body: `<p><strong>Reciprocal Rank Fusion (RRF) Score</strong></p>
<p>Combines the keyword search rank and the vector search rank into a single relevance score using the RRF formula:</p>
<p style="font-family:monospace;background:var(--bg-ctrl);padding:6px 10px;border-radius:4px">score = 1/(k + rank_kw) + 1/(k + rank_vec)</p>
<p>where <em>k</em> is typically 60.</p>
<ul>
  <li><strong>Higher is better.</strong> A score of 0.066 is the theoretical maximum (ranked 1st in both keyword and vector).</li>
  <li>Typical range: <strong>0.001 – 0.066</strong></li>
  <li>Results with no keyword match will have a lower RRF score even if the vector match is strong.</li>
</ul>`,
  },
  kw_tier: {
    title: 'KW Tier',
    body: `<p><strong>Keyword Match Tier</strong></p>
<p>How strongly the query matched via keyword search. <strong>Lower tier = stronger match.</strong></p>
<ul>
  <li><strong>Tier 0</strong> — Exact phrase in title or URL (best)</li>
  <li><strong>Tier 1</strong> — All query tokens in title or URL</li>
  <li><strong>Tier 2</strong> — Partial token match in title or URL</li>
  <li><strong>Tier 3</strong> — Exact phrase in description or tags</li>
  <li><strong>Tier 4</strong> — All tokens in description or tags</li>
  <li><strong>Tier 5</strong> — Partial match in description or tags</li>
  <li><strong>Tier 6</strong> — Weak keyword signal (e.g. domain only)</li>
  <li><strong>Tier 7</strong> — Document-level match only (weakest keyword hit)</li>
  <li><strong>—</strong> (null) — Pure vector match with no keyword signal at all</li>
</ul>
<p>When sorted by KW Tier, results within the same tier are ordered by RRF Score as a tiebreaker.</p>`,
  },
  cosine_distance: {
    title: 'Cos Dist',
    body: `<p><strong>Cosine Distance</strong></p>
<p>The distance between the query's embedding vector and the document's embedding vector in semantic space. <strong>Lower = more similar.</strong></p>
<p>This is distance, not similarity — it is the opposite of cosine similarity:</p>
<p style="font-family:monospace;background:var(--bg-ctrl);padding:6px 10px;border-radius:4px">distance = 1 − cosine_similarity</p>
<ul>
  <li><strong style="color:var(--ok, green)">Under 0.30</strong> — Strong vector match (shown in green)</li>
  <li><strong>0.30 – 0.50</strong> — Moderate match</li>
  <li><strong style="color:var(--warn, orange)">0.50 – 0.60</strong> — Weak match</li>
  <li><strong style="color:var(--err, red)">Over 0.60</strong> — Poor semantic similarity</li>
</ul>
<p>A low cosine distance means the document content is semantically close to the query, even if no keywords overlap.</p>`,
  },
};

function _bmOpenColInfoModal(col) {
  const info = _BM_COL_INFO_CONTENT[col];
  if (!info) return;
  document.getElementById('bm-col-info-title').textContent = info.title;
  document.getElementById('bm-col-info-body').innerHTML = info.body;
  HubModal.open(document.getElementById('bm-col-info-modal'));
}

// ── Sort explanation modal ───────────────────────────────────────────────

async function _bmOpenSortExplainModal() {
  if (!_bmSearchActive || !_bmDisplayedSearchRows.length) return;
  const query = (document.getElementById('bm-search')?.value || '').trim();
  const top = _bmDisplayedSearchRows.slice(0, 20);
  const searchSortState = _ensureBmSearchTableView()?.getSortState() || { key: null, dir: -1 };
  const subtitle = document.getElementById('bm-sort-explain-subtitle');
  subtitle.textContent = `"${query}" — top ${top.length} results`;
  const body = document.getElementById('bm-sort-explain-body');
  body.innerHTML = _bmScoreLoadingHtml();
  HubModal.open(document.getElementById('bm-sort-explain-modal'));
  try {
    const r = await apiFetch('/api/v1/bookmarks/sort-explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        results: top,
        sort_col: searchSortState.key || 'compound',
        sort_dir: searchSortState.key ? (searchSortState.dir === -1 ? 'desc' : 'asc') : 'desc',
      }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const md = data.explanation || '(No response)';
    body.innerHTML = typeof _mdToHtml === 'function' ? _mdToHtml(md) : `<pre style="white-space:pre-wrap">${esc(md)}</pre>`;
  } catch (e) {
    body.innerHTML = `<p style="color:var(--err)">Error: ${esc(e.message)}</p>`;
  }
}
