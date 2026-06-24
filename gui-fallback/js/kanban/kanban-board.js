// Kanban board page - recursive work-management board over /personal/work APIs.

'use strict';

const KanbanBoardPage = (() => {
  const CONTENT_VIEW_STORAGE_KEY = 'blueprints.kanban.contentView.v1';
  const CONTENT_VIEW_IDS = ['board', 'search', 'selection', 'provenance'];
  const CONTENT_VIEW_LABELS = {
    board: 'Board',
    search: 'Search',
    selection: 'Selection',
    provenance: 'Provenance',
  };
  const LANE_WIDTH_STORAGE_PREFIX = 'blueprints.kanbanLaneWidth.v1';
  const LANE_WIDTH_MIN = 112;
  const LANE_WIDTH_MAX = 560;
  const LANE_WIDTH_STEP = 18;
  const REFRESH_LONG_PRESS_MS = 700;
  const NEW_ITEM_TAG_SURFACE = 'kanban-new-item';
  const EDIT_ITEM_TAG_SURFACE = 'kanban-edit-item';
  const ITEM_REQUIRED_TAGS = ['kanban'];
  let laneRestoreTimer = null;
  let refreshLongPressTimer = null;
  let refreshLongPressButton = null;
  let refreshSuppressClickUntil = 0;

  function normalizeContentView(value) {
    const clean = String(value || '').trim();
    return CONTENT_VIEW_IDS.includes(clean) ? clean : 'board';
  }

  function readStoredContentView() {
    try {
      return normalizeContentView(localStorage.getItem(CONTENT_VIEW_STORAGE_KEY));
    } catch (_) {
      return 'board';
    }
  }

  const state = {
    loaded: false,
    loading: false,
    error: '',
    contentView: readStoredContentView(),
    config: null,
    preferences: {
      show_test_entries: true,
    },
    board: null,
    detail: null,
    detailDraft: null,
    detailModalOpen: false,
    detailPanelOpen: false,
    detailSection: 'detail',
    discussionEditMode: false,
    scoped: {
      open: false,
      kind: '',
      itemId: '',
      scope: 'descendants',
      view: 'grouped',
      data: null,
    },
    routeApplied: false,
    routeDetailItemId: '',
    routeHighlightItemId: '',
    routeScoped: null,
    rollups: {},
    selection: null,
    currentParentId: '',
    parentStack: [],
    cardFsm: {
      state: 'idle',
      selectedItemId: '',
      pendingItemId: '',
      lastEvent: '',
    },
    refreshFsm: {
      state: 'idle',
      lastEvent: '',
      showTestEntries: true,
    },
    lastWrite: null,
  };

  const escHtml = typeof esc === 'function'
    ? esc
    : value => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[ch]));

  const cssEscape = value => {
    if (window.CSS?.escape) return window.CSS.escape(String(value ?? ''));
    return String(value ?? '').replace(/["\\\]\[]/g, '\\$&');
  };

  function el(id) {
    return document.getElementById(id);
  }

  function routeParams() {
    try {
      return new URLSearchParams(window.location.search || '');
    } catch (_) {
      return new URLSearchParams('');
    }
  }

  function cleanRouteId(value) {
    return String(value || '').trim().replace(/[^a-zA-Z0-9_.:-]+/g, '-').slice(0, 180);
  }

  function stripFrontmatter(md) {
    if (window.BlueprintsMarkdown?.stripFrontmatter) return window.BlueprintsMarkdown.stripFrontmatter(md);
    return String(md || '').replace(/^---\s*\n[\s\S]*?\n---\s*(\n|$)/, '');
  }

  function renderMarkdown(md, emptyText = 'No description.') {
    if (window.BlueprintsMarkdown?.render) return window.BlueprintsMarkdown.render(md);
    const clean = stripFrontmatter(md).trim();
    if (!clean) return `<p class="calendar-markdown-empty">${escHtml(emptyText)}</p>`;
    return clean.split(/\n/).map(line => {
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        const level = Math.min(6, heading[1].length);
        return `<h${level}>${escHtml(heading[2])}</h${level}>`;
      }
      const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
      if (bullet) return `<ul><li>${escHtml(bullet[1])}</li></ul>`;
      if (!line.trim()) return '<div class="calendar-markdown-gap"></div>';
      return `<p>${escHtml(line)}</p>`;
    }).join('');
  }

  function markdownPreviewHtml(body, className = '', emptyText = 'No description.', showEmpty = false) {
    const clean = stripFrontmatter(body).trim();
    if (!clean && !showEmpty) return '';
    const classes = ['calendar-markdown-preview', className].filter(Boolean).join(' ');
    return `<div class="${escHtml(classes)}">${renderMarkdown(clean, emptyText)}</div>`;
  }

  function laneViewportSignature() {
    if (window.BlueprintsLocalShade?.viewportSignature) return window.BlueprintsLocalShade.viewportSignature();
    const width = Math.round(window.innerWidth || document.documentElement.clientWidth || window.visualViewport?.width || 0);
    const height = Math.round(window.innerHeight || document.documentElement.clientHeight || window.visualViewport?.height || 0);
    const deviceClass = width >= 821 ? 'desktop' : (width <= 600 ? 'phone' : 'tablet');
    const orientation = height >= width ? 'portrait' : 'landscape';
    return `${deviceClass}.${orientation}.${width}x${height}`;
  }

  function laneStorageKey(stateId) {
    const key = String(stateId || 'lane').replace(/[^a-zA-Z0-9_.:-]+/g, '-');
    return `${LANE_WIDTH_STORAGE_PREFIX}.${key}.${laneViewportSignature()}`;
  }

  function clampLaneWidth(value) {
    const next = Math.round(Number(value) || 0);
    return Math.min(LANE_WIDTH_MAX, Math.max(LANE_WIDTH_MIN, next || LANE_WIDTH_MIN));
  }

  function readLaneWidth(stateId) {
    try {
      const stored = Number(localStorage.getItem(laneStorageKey(stateId)) || '');
      return Number.isFinite(stored) && stored > 0 ? clampLaneWidth(stored) : null;
    } catch (_) {
      return null;
    }
  }

  function saveLaneWidth(stateId, width) {
    try {
      localStorage.setItem(laneStorageKey(stateId), String(clampLaneWidth(width)));
    } catch (_) {
      // Lane width memory is optional.
    }
  }

  function laneWidthAttrs(stateId) {
    const width = readLaneWidth(stateId);
    return width
      ? ` data-kanban-lane-resized="true" style="--kanban-lane-width:${width}px"`
      : '';
  }

  function applyLaneWidth(column, width, persist = false) {
    if (!column) return null;
    const stateId = column.dataset.kanbanStateId || '';
    const next = clampLaneWidth(width);
    column.dataset.kanbanLaneResized = 'true';
    column.style.setProperty('--kanban-lane-width', `${next}px`);
    const handle = column.querySelector('[data-kanban-lane-width-handle]');
    if (handle) {
      handle.setAttribute('aria-valuemin', String(LANE_WIDTH_MIN));
      handle.setAttribute('aria-valuemax', String(LANE_WIDTH_MAX));
      handle.setAttribute('aria-valuenow', String(next));
      handle.setAttribute('aria-valuetext', `${next} pixels`);
    }
    if (persist) saveLaneWidth(stateId, next);
    return next;
  }

  function restoreLaneWidths() {
    document.querySelectorAll('#tab-kanban .kanban-column[data-kanban-state-id]').forEach(column => {
      const width = readLaneWidth(column.dataset.kanbanStateId || '');
      if (width) {
        applyLaneWidth(column, width, false);
      } else {
        column.removeAttribute('data-kanban-lane-resized');
        column.style.removeProperty('--kanban-lane-width');
        const handle = column.querySelector('[data-kanban-lane-width-handle]');
        if (handle) {
          handle.setAttribute('aria-valuemin', String(LANE_WIDTH_MIN));
          handle.setAttribute('aria-valuemax', String(LANE_WIDTH_MAX));
          handle.removeAttribute('aria-valuenow');
          handle.removeAttribute('aria-valuetext');
        }
      }
    });
  }

  function resetBoardVerticalOffset() {
    const shell = el('kanban-board-shell');
    if (shell && shell.scrollTop !== 0) shell.scrollTop = 0;
  }

  function scheduleLaneRestore() {
    window.clearTimeout(laneRestoreTimer);
    laneRestoreTimer = window.setTimeout(() => {
      restoreLaneWidths();
      resetBoardVerticalOffset();
    }, 90);
    [260, 560].forEach(delay => window.setTimeout(() => {
      restoreLaneWidths();
      resetBoardVerticalOffset();
    }, delay));
  }

  function applyInitialRouteState() {
    if (state.routeApplied) return;
    state.routeApplied = true;
    const params = routeParams();
    const parentItemId = cleanRouteId(params.get('parent_item_id') || params.get('work_parent_id'));
    const detailItemId = cleanRouteId(params.get('detail_item_id') || params.get('work_item_id'));
    const scopedKind = String(params.get('scoped_kind') || '').trim().toLowerCase();
    const scopedItemId = cleanRouteId(params.get('scoped_item_id'));
    const scopedScope = String(params.get('scoped_scope') || 'descendants').trim().toLowerCase();
    const scopedView = String(params.get('scoped_view') || 'grouped').trim().toLowerCase();
    if (parentItemId) state.currentParentId = parentItemId;
    if (detailItemId) {
      state.routeDetailItemId = detailItemId;
      state.routeHighlightItemId = detailItemId;
    }
    if (scopedItemId && ['issues', 'issue', 'todos', 'todo'].includes(scopedKind)) {
      state.routeScoped = {
        kind: scopedKind,
        itemId: scopedItemId,
        scope: scopedScope === 'local' ? 'local' : 'descendants',
        view: scopedView === 'flat' ? 'flat' : 'grouped',
      };
    }
  }

  function writeRouteState(parentItemId = state.currentParentId, detailItemId = '', scoped = null) {
    if (!window.history || !window.location) return;
    const url = new URL(window.location.href);
    url.searchParams.set('group', 'kanban');
    url.searchParams.set('tab', 'kanban');
    const parent = cleanRouteId(parentItemId);
    const detail = cleanRouteId(detailItemId);
    if (parent) url.searchParams.set('parent_item_id', parent);
    else url.searchParams.delete('parent_item_id');
    if (detail) url.searchParams.set('detail_item_id', detail);
    else url.searchParams.delete('detail_item_id');
    if (scoped?.kind && scoped?.itemId) {
      url.searchParams.set('scoped_kind', scoped.kind);
      url.searchParams.set('scoped_item_id', scoped.itemId);
      url.searchParams.set('scoped_scope', scoped.scope || 'descendants');
      url.searchParams.set('scoped_view', scoped.view || 'grouped');
    } else {
      url.searchParams.delete('scoped_kind');
      url.searchParams.delete('scoped_item_id');
      url.searchParams.delete('scoped_scope');
      url.searchParams.delete('scoped_view');
    }
    window.history.replaceState(window.history.state, '', url);
  }

  async function requestJson(path, options = {}) {
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const resp = await fetcher(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    if (!resp.ok) {
      let detail = resp.statusText || 'request failed';
      try {
        const payload = await resp.json();
        detail = payload.detail || payload.error || detail;
      } catch (_) {
        // Keep the HTTP status text if response JSON is unavailable.
      }
      throw new Error(detail);
    }
    return resp.json();
  }

  function cleanTagList(value) {
    const raw = Array.isArray(value)
      ? value
      : String(value || '').split(/[,\n]+/);
    const tags = [];
    raw.forEach(entry => {
      const tag = String(entry || '').trim();
      if (tag && !tags.includes(tag)) tags.push(tag);
    });
    return tags;
  }

  function applyPreferences(payload) {
    const preferences = payload?.preferences || payload || {};
    if (typeof preferences.show_test_entries === 'boolean') {
      state.preferences.show_test_entries = preferences.show_test_entries;
      state.refreshFsm.showTestEntries = preferences.show_test_entries;
    }
  }

  function showTestEntries() {
    return state.preferences?.show_test_entries !== false;
  }

  function hiddenTestEntryCount() {
    return Number(state.board?.hidden_test_items ?? state.board?.test_entries?.hidden ?? 0);
  }

  function itemHasAgentWorkingOutTag(item) {
    return Array.isArray(item?.tags) && item.tags.includes('agent-working-out');
  }

  function itemHiddenByPreference(item) {
    return !showTestEntries() && itemHasAgentWorkingOutTag(item);
  }

  function clearDetailSelectionState(eventName = 'hiddenSelectionCleared') {
    state.selection = null;
    state.detail = null;
    state.detailDraft = null;
    state.detailPanelOpen = false;
    state.detailModalOpen = false;
    state.routeDetailItemId = '';
    state.routeHighlightItemId = '';
    setFsm('idle', eventName);
    const dialog = el('kanban-detail-modal');
    if (dialog?.open) closeDialog(dialog);
    writeRouteState(state.currentParentId, '');
  }

  function reconcileVisibleBoardState() {
    const visibleIds = new Set(rawBoardItems().map(item => item.item_id).filter(Boolean));
    const selectedId = state.selection?.item?.item_id || '';
    const detailId = state.detail?.item?.item_id || '';
    const selectedHidden = selectedId && (!visibleIds.has(selectedId) || itemHiddenByPreference(state.selection?.item));
    const detailHidden = detailId && (!visibleIds.has(detailId) || itemHiddenByPreference(state.detail?.item));
    if (selectedHidden || detailHidden) clearDetailSelectionState('hiddenSelectionCleared');
  }

  function setRefreshFsm(nextState, eventName = '') {
    state.refreshFsm = {
      state: nextState,
      lastEvent: eventName,
      showTestEntries: showTestEntries(),
    };
  }

  function rawBoardItems() {
    return (state.board?.columns || []).flatMap(column => column.items || []);
  }

  function itemFilterRecord(item) {
    const rollup = state.rollups[item.item_id] || {};
    const tags = [
      ...(Array.isArray(item?.tags) ? item.tags : []),
      'kanban',
      'task',
      item?.state_id,
      item?.priority_id,
      item?.source?.type,
      item?.status,
      Number(rollup.issues?.open || 0) ? 'issues' : '',
      Number(rollup.todos?.open || 0) ? 'tasks' : '',
      Number(rollup.blockers?.open || 0) ? 'blocked' : '',
    ].filter(Boolean).filter((tag, index, rows) => rows.indexOf(tag) === index);
    return {
      ...item,
      kind: 'task',
      tags,
      source: {
        ...(item.source || {}),
        type: item.source?.type || 'work-management',
      },
      related: {
        ...(item.related || {}),
        work_items: [item.item_id],
      },
    };
  }

  function boardItems() {
    const rows = rawBoardItems();
    if (!window.PersonalFilters?.matchesRecord) return rows;
    return rows.filter(item => window.PersonalFilters.matchesRecord(itemFilterRecord(item), 'kanban'));
  }

  function itemTagIds(surface = NEW_ITEM_TAG_SURFACE, fallbackTags = []) {
    const selected = window.PersonalFilters?.getSelectedIds
      ? window.PersonalFilters.getSelectedIds(surface)
      : cleanTagList(fallbackTags);
    return Array.from(new Set([...(selected || []), ...ITEM_REQUIRED_TAGS]));
  }

  function itemTagsSummaryHtml(surface = NEW_ITEM_TAG_SURFACE) {
    if (window.PersonalFilters?.summaryHtml) {
      return window.PersonalFilters.summaryHtml(surface, { prefix: 'Tags:', alwaysShowClear: true });
    }
    return '<span class="personal-filter-summary"><span class="personal-filter-summary__label">Tags:</span><span class="personal-filter-summary__empty">Kanban</span></span>';
  }

  function renderItemTagSummaries() {
    document.querySelectorAll('[data-kanban-item-tags-strip]').forEach(strip => {
      const surface = strip.dataset.kanbanItemTagsSurface || NEW_ITEM_TAG_SURFACE;
      strip.innerHTML = itemTagsSummaryHtml(surface);
      strip.dataset.personalFilterOpen = surface;
      strip.dataset.personalFilterTab = 'filters';
    });
  }

  function syncEditItemTagsFromDetail(detail = state.detail) {
    if (!window.PersonalFilters?.setSelectedIds) return;
    const tags = cleanTagList(detail?.item?.tags || []);
    window.PersonalFilters.setSelectedIds(EDIT_ITEM_TAG_SURFACE, Array.from(new Set([...tags, ...ITEM_REQUIRED_TAGS])));
  }

  function syncEditItemDraftTagsFromSurface() {
    const draft = ensureDetailDraft();
    if (!draft) return [];
    draft.tags = itemTagIds(EDIT_ITEM_TAG_SURFACE, draft.tags || []);
    return draft.tags;
  }

  function findItem(itemId) {
    return rawBoardItems().find(item => item.item_id === itemId) || null;
  }

  function stateRows() {
    return state.config?.states || state.board?.columns?.map(column => column.state) || [];
  }

  function priorityRows() {
    return state.config?.priorities || [];
  }

  function priorityLabel(priorityId) {
    const row = priorityRows().find(priority => priority.priority_id === priorityId);
    return row ? row.label : (priorityId || 'Priority');
  }

  function stateLabel(stateId) {
    const row = stateRows().find(itemState => itemState.state_id === stateId);
    return row ? row.label : (stateId || 'State');
  }

  function scopedKindConfig(kind) {
    const clean = String(kind || '').toLowerCase();
    if (clean === 'issue' || clean === 'issues') {
      return {
        kind: 'issues',
        singular: 'Issue',
        plural: 'Issues',
        badge: 'ISS',
        endpoint: 'issues',
        sourcePrefix: 'work_issues',
        idKey: 'issue_id',
        priorityLabel: 'Severity',
        createKind: 'issue',
      };
    }
    return {
      kind: 'todos',
      singular: 'ToDo',
      plural: 'ToDos',
      badge: 'TODO',
      endpoint: 'todos',
      sourcePrefix: 'work_todos',
      idKey: 'todo_id',
      priorityLabel: 'Priority',
      createKind: 'todo',
    };
  }

  function leafStatusOptions(selected = 'open') {
    const statuses = ['open', 'active', 'blocked', 'pending_review', 'done', 'closed', 'archived', 'promoted'];
    return statuses.map(status => `<option value="${escHtml(status)}" ${status === selected ? 'selected' : ''}>${escHtml(status.replace(/_/g, ' '))}</option>`).join('');
  }

  function statusTone(status) {
    const clean = String(status || '').toLowerCase();
    if (clean === 'ready' || clean === 'ok' || clean === 'open') return 'ok';
    if (clean === 'active' || clean === 'pending') return 'warn';
    if (clean === 'blocked' || clean === 'error') return 'err';
    return 'unknown';
  }

  function contentViewLabel(view) {
    return CONTENT_VIEW_LABELS[normalizeContentView(view)] || 'Board';
  }

  function setFsm(nextState, eventName, itemId = '') {
    state.cardFsm = {
      state: nextState,
      selectedItemId: nextState === 'selected' ? itemId : state.cardFsm.selectedItemId,
      pendingItemId: nextState === 'pendingMove' ? itemId : '',
      itemId: itemId || state.cardFsm.itemId || '',
      lastEvent: eventName,
    };
  }

  function currentBreadcrumbs() {
    const rows = state.board?.breadcrumbs;
    return Array.isArray(rows) ? rows : [];
  }

  function depthLimit() {
    return Number(state.config?.depth_limit || state.board?.depth_limit || state.board?.rollup?.depth_limit || 12);
  }

  function remainingDepthForItem(item) {
    if (!item) return depthLimit();
    return Math.max(0, depthLimit() - Number(item.depth || 0));
  }

  async function detailForItem(itemId) {
    if (!itemId) return null;
    if (state.detail?.item?.item_id === itemId) return state.detail;
    return requestJson(`/api/v1/personal/work/items/${encodeURIComponent(itemId)}`);
  }

  async function childCreateDepthInfo(parentItemId) {
    if (!parentItemId) {
      return { allowed: true, remaining: depthLimit(), label: 'Root board' };
    }
    const localItem = findItem(parentItemId)
      || (state.board?.parent?.item_id === parentItemId ? state.board.parent : null)
      || (state.detail?.item?.item_id === parentItemId ? state.detail.item : null);
    const detail = localItem ? null : await detailForItem(parentItemId);
    const item = localItem || detail?.item || null;
    const remaining = detail?.remaining_depth ?? remainingDepthForItem(item);
    return {
      allowed: Number(remaining) > 0,
      remaining: Number(remaining),
      label: item?.title || parentItemId,
    };
  }

  function renderStatus(message = '') {
    const strip = el('kanban-status-strip');
    const status = state.error ? 'error' : (state.loading ? 'pending' : (state.loaded ? 'ready' : 'empty'));
    if (strip) {
      const hidden = hiddenTestEntryCount();
      const testLine = showTestEntries() || !hidden ? '' : `<span>${escHtml(`${hidden} test hidden`)}</span>`;
      strip.innerHTML = `
        <span class="kanban-status-dot kanban-status-dot--${statusTone(status)}" aria-hidden="true"></span>
        <span>${escHtml(message || state.error || status)}</span>
        <span>${escHtml(state.currentParentId ? 'child board' : 'root board')}</span>
        ${testLine}
      `;
    }
    const title = showTestEntries()
      ? 'Refresh board. Long press to hide test entries.'
      : 'Refresh board. Long press to show test entries.';
    document.querySelectorAll('[data-kanban-action="refresh"]').forEach(button => {
      button.title = title;
      button.setAttribute('aria-label', title);
      button.dataset.kanbanTestEntries = showTestEntries() ? 'shown' : 'hidden';
    });
  }

  function renderMeta() {
    const rows = boardItems();
    const meta = el('kanban-meta');
    if (meta) {
      const parent = state.board?.parent;
      meta.textContent = parent
        ? `${parent.title || parent.item_id} - ${rows.length} child item${rows.length === 1 ? '' : 's'}`
        : `Root board - ${rows.length} item${rows.length === 1 ? '' : 's'}`;
    }
    const crumb = el('kanban-breadcrumb');
    if (crumb) {
      const breadcrumbs = currentBreadcrumbs();
      const entries = [
        { item_id: '', title: 'Root board' },
        ...breadcrumbs.map(item => ({ item_id: item.item_id, title: item.title || item.item_id })),
      ];
      crumb.innerHTML = entries.map((entry, index) => {
        const isCurrent = index === entries.length - 1;
        const button = `<button class="kanban-breadcrumb__button" type="button" data-kanban-breadcrumb="${escHtml(entry.item_id)}" ${isCurrent ? 'disabled' : ''}>${escHtml(entry.title)}</button>`;
        return `${index ? '<span class="kanban-breadcrumb__sep">/</span>' : ''}${button}`;
      }).join('');
    }
    const filter = el('kanban-filter-strip');
    if (filter) {
      filter.innerHTML = window.PersonalFilters?.summaryHtml
        ? window.PersonalFilters.summaryHtml('kanban', { prefix: 'Filter:', emptyLabel: 'all cards' })
        : 'Filter: all cards';
    }
  }

  function renderContentPanels() {
    document.querySelectorAll('[data-kanban-content-view]').forEach(panel => {
      panel.hidden = panel.dataset.kanbanContentView !== state.contentView;
    });
  }

  function setContentView(view, options = {}) {
    state.contentView = normalizeContentView(view);
    try {
      localStorage.setItem(CONTENT_VIEW_STORAGE_KEY, state.contentView);
    } catch (_) {
      // Browser-local preferences are optional.
    }
    if (options.render !== false) {
      renderContentPanels();
      renderMeta();
    }
    return true;
  }

  function metric(value, label) {
    return `<div class="kanban-metric"><span class="kanban-metric__value">${escHtml(value)}</span><span class="kanban-metric__label">${escHtml(label)}</span></div>`;
  }

  function markdownFieldHtml(id, label, value = '', options = {}) {
    const safeId = String(id || 'kanban-body').replace(/[^a-zA-Z0-9_-]/g, '-');
    const previewDefault = Boolean(options.previewDefault);
    const hideLabel = Boolean(options.hideLabel);
    const emptyText = options.emptyText || `No ${String(label || 'description').toLowerCase()}.`;
    const actionAttr = options.detail
      ? 'data-kanban-detail-action="toggle-markdown-preview"'
      : (options.inline
        ? 'data-kanban-action="toggle-markdown-preview"'
        : 'data-kanban-modal-action="toggle-markdown-preview"');
    const fieldAttr = options.fieldName
      ? ` data-kanban-detail-field="${escHtml(options.fieldName)}"`
      : '';
    return `
      <div class="kanban-field kanban-field--markdown calendar-markdown-field">
        <div class="calendar-field__label-row${hideLabel ? ' calendar-field__label-row--actions-only' : ''}">
          <span class="${hideLabel ? 'kanban-visually-hidden' : ''}">${escHtml(label || 'Description')}</span>
          <button class="calendar-markdown-toggle" type="button" ${actionAttr} data-kanban-markdown-prefix="${escHtml(safeId)}">${previewDefault ? 'Edit' : 'Preview'}</button>
        </div>
        <textarea id="${escHtml(safeId)}" maxlength="${escHtml(options.maxlength || 4000)}"${fieldAttr}${previewDefault ? ' hidden' : ''}>${escHtml(value)}</textarea>
        <div id="${escHtml(safeId)}-preview" class="calendar-markdown-preview"${previewDefault ? '' : ' hidden'}>${previewDefault ? renderMarkdown(value || '', emptyText) : ''}</div>
      </div>
    `;
  }

  function metricShortcutActions() {
    return `
      <div class="kanban-metric-actions" aria-label="Board shortcuts">
        <button class="kanban-icon-btn kanban-icon-btn--up kanban-metric-action" type="button" data-kanban-action="up-board" title="Up board" aria-label="Up board"></button>
        <button class="kanban-icon-btn kanban-icon-btn--root kanban-metric-action kanban-metric-action--desktop-extra" type="button" data-kanban-action="root-board" title="Root board" aria-label="Root board"></button>
        <button class="kanban-icon-btn kanban-icon-btn--new kanban-metric-action kanban-metric-action--desktop-extra" type="button" data-kanban-action="new-root-item" title="New item" aria-label="New item"></button>
      </div>
    `;
  }

  function renderMetrics() {
    const target = el('kanban-metrics');
    if (!target) return;
    const rollup = state.board?.rollup || {};
    const items = rollup.items || {};
    target.innerHTML = [
      metric(boardItems().length, 'visible cards'),
      metric(items.total || 0, 'scoped items'),
      metric(rollup.issues?.open || 0, 'open issues'),
      metric(rollup.todos?.open || 0, 'open todos'),
      metric(state.board?.remaining_depth ?? depthLimit(), 'depth remaining'),
      metricShortcutActions(),
    ].join('');
  }

  function rollupFor(item) {
    return state.rollups[item.item_id] || {
      items: { total: 1, by_state: {}, by_status: {} },
      issues: { open: 0 },
      todos: { open: 0 },
      blockers: { open: 0 },
      depth_limit: 12,
    };
  }

  function subitemsTone(rollup) {
    const total = Number(rollup?.items?.total || 0);
    const issues = Number(rollup?.issues?.open || 0);
    const blocked = Number(rollup?.blockers?.open || 0) + Number(rollup?.items?.by_status?.blocked || 0);
    const active = Number(rollup?.items?.by_status?.active || 0) + Number(rollup?.items?.by_status?.open || 0);
    if (issues || blocked) return 'err';
    if (total <= 1) return 'empty';
    if (active) return 'warn';
    return 'ok';
  }

  function pillHtml(kind, label, count, tone, itemId) {
    return `<button class="kanban-pill-btn" type="button" data-kanban-pill="${kind}" data-kanban-item-id="${escHtml(itemId)}" data-tone="${escHtml(tone)}">
      <span>${escHtml(label)}</span><strong>${escHtml(count)}</strong>
    </button>`;
  }

  function rollupRows(item) {
    const rollup = rollupFor(item);
    const subitems = Math.max(0, Number(rollup.items?.total || 1) - 1);
    const issues = Number(rollup.issues?.open || 0);
    const todos = Number(rollup.todos?.open || 0);
    return `
      <div class="kanban-rollups">
        <div class="kanban-rollup-row">
          ${pillHtml('subitems', 'SubItems', subitems, subitemsTone(rollup), item.item_id)}
          <button class="kanban-add-btn" type="button" data-kanban-card-action="add-child" data-kanban-item-id="${escHtml(item.item_id)}" title="Add child item" aria-label="Add child item"></button>
        </div>
        <div class="kanban-rollup-row">
          ${pillHtml('issues', 'Issues', issues, issues ? 'err' : 'empty', item.item_id)}
          <button class="kanban-add-btn" type="button" data-kanban-card-action="add-issue" data-kanban-item-id="${escHtml(item.item_id)}" title="Add issue" aria-label="Add issue"></button>
        </div>
        <div class="kanban-rollup-row">
          ${pillHtml('todos', 'ToDos', todos, todos ? 'info' : 'empty', item.item_id)}
          <button class="kanban-add-btn" type="button" data-kanban-card-action="add-todo" data-kanban-item-id="${escHtml(item.item_id)}" title="Add todo" aria-label="Add todo"></button>
        </div>
      </div>
    `;
  }

  function cardHtml(item) {
    const pending = state.cardFsm.pendingItemId === item.item_id;
    const selected = state.selection?.item?.item_id === item.item_id;
    const routeTarget = state.routeHighlightItemId && item.item_id === state.routeHighlightItemId;
    return `
      <article class="kanban-card" data-kanban-item-id="${escHtml(item.item_id)}" tabindex="0" data-selected="${selected ? 'true' : 'false'}" data-pending="${pending ? 'true' : 'false'}" data-kanban-route-target="${routeTarget ? 'true' : 'false'}">
        <div class="kanban-card__head">
          <div class="kanban-card__title">${escHtml(item.title || item.item_id)}</div>
        </div>
        <div class="kanban-card__meta">
          <span class="kanban-state-pill" data-state="${escHtml(item.state_id || '')}">${escHtml(stateLabel(item.state_id))}</span>
          <span class="kanban-priority-pill" data-priority="${escHtml(item.priority_id || '')}">${escHtml(priorityLabel(item.priority_id))}</span>
          <span class="kanban-pill">d${escHtml(item.depth ?? 0)}</span>
        </div>
        ${markdownPreviewHtml(item.body_excerpt || '', 'kanban-card__body kanban-card__body--markdown', 'No description.')}
        ${rollupRows(item)}
        <div class="kanban-card__actions" aria-label="Card actions">
          <button class="kanban-card-btn kanban-card-btn--up" type="button" data-kanban-card-action="order-up" data-kanban-item-id="${escHtml(item.item_id)}" title="Move higher in lane" aria-label="Move higher in lane"></button>
          <button class="kanban-card-btn kanban-card-btn--down" type="button" data-kanban-card-action="order-down" data-kanban-item-id="${escHtml(item.item_id)}" title="Move lower in lane" aria-label="Move lower in lane"></button>
          <button class="kanban-card-btn kanban-card-btn--left" type="button" data-kanban-card-action="move-left" data-kanban-item-id="${escHtml(item.item_id)}" title="Move left" aria-label="Move left"></button>
          <button class="kanban-card-btn kanban-card-btn--right" type="button" data-kanban-card-action="move-right" data-kanban-item-id="${escHtml(item.item_id)}" title="Move right" aria-label="Move right"></button>
          <button class="kanban-card-btn kanban-card-btn--detail" type="button" data-kanban-card-action="open-detail" data-kanban-item-id="${escHtml(item.item_id)}" title="Item detail" aria-label="Item detail"></button>
          <button class="kanban-card-btn kanban-card-btn--child" type="button" data-kanban-card-action="open-child-board" data-kanban-item-id="${escHtml(item.item_id)}" title="Open child board" aria-label="Open child board"></button>
          <button class="kanban-card-btn kanban-card-btn--archive" type="button" data-kanban-card-action="archive" data-kanban-item-id="${escHtml(item.item_id)}" title="Archive item" aria-label="Archive item"></button>
        </div>
      </article>
    `;
  }

  function visibleColumnItems(column) {
    const items = column?.items || [];
    if (!window.PersonalFilters?.matchesRecord) return items;
    return items.filter(item => window.PersonalFilters.matchesRecord(itemFilterRecord(item), 'kanban'));
  }

  function renderBoard() {
    const shell = el('kanban-board-shell');
    if (!shell) return;
    const columns = state.board?.columns || [];
    shell.innerHTML = columns.length
      ? columns.map(column => {
        const items = visibleColumnItems(column);
        const stateId = column.state.state_id || '';
        const label = column.state.label || stateId;
        return `
        <section class="kanban-column" data-kanban-state-id="${escHtml(stateId)}"${laneWidthAttrs(stateId)}>
          <div class="kanban-column__head">
            <div class="kanban-column__title">${escHtml(label)}</div>
            <span class="kanban-column__count">${escHtml(items.length)}</span>
            <button class="kanban-add-btn" type="button" data-kanban-action="add-item-state" data-kanban-state-id="${escHtml(stateId)}" title="Add item" aria-label="Add item"></button>
          </div>
          <div class="kanban-column__cards">
            ${items.length ? items.map(cardHtml).join('') : '<div class="kanban-empty">No cards in this state.</div>'}
          </div>
          <button class="kanban-lane-width-handle" type="button" data-kanban-lane-width-handle data-kanban-state-id="${escHtml(stateId)}" title="Resize lane" aria-label="Resize ${escHtml(label)} lane" role="separator" aria-orientation="vertical"></button>
        </section>
      `;
      }).join('')
      : '<div class="kanban-empty">No Kanban states loaded.</div>';
    restoreLaneWidths();
    resetBoardVerticalOffset();
    window.requestAnimationFrame(resetBoardVerticalOffset);
  }

  function detailRow(title, meta, body = '', options = {}) {
    return `
      <div class="kanban-detail-row">
        <div class="kanban-detail-title">${escHtml(title)}</div>
        <div class="kanban-detail-meta">${escHtml(meta || '')}</div>
        ${body ? `<div class="kanban-detail-meta${options.bodyHtml ? ' kanban-detail-meta--markdown' : ''}">${options.bodyHtml ? body : escHtml(body)}</div>` : ''}
      </div>
    `;
  }

  function scopedRecordId(record, config) {
    return String(record?.[config.idKey] || '');
  }

  function findScopedRecord(kind, id) {
    const config = scopedKindConfig(kind);
    const rows = state.scoped?.data?.items || [];
    return rows.find(row => scopedRecordId(row, config) === id) || null;
  }

  function scopedBreadcrumbText(data) {
    const rows = Array.isArray(data?.breadcrumbs) ? data.breadcrumbs : [];
    return ['Root board', ...rows.map(item => item.title || item.item_id)].join(' / ');
  }

  function scopedRowHtml(record, config) {
    const id = scopedRecordId(record, config);
    const scope = record.scope || {};
    const priority = record.priority_id || record.severity_id || 'medium';
    return `
      <article class="kanban-scoped-row" data-kanban-scoped-row="${escHtml(config.kind)}" data-kanban-scoped-id="${escHtml(id)}" data-kanban-scoped-item-id="${escHtml(record.item_id || '')}">
        <div class="kanban-scoped-row__main">
          <div class="kanban-detail-title">${escHtml(record.title || id)}</div>
          <div class="kanban-detail-meta">${escHtml(scope.title || record.item_id || '')} - ${escHtml(scope.relation || 'local')} - d${escHtml(scope.depth_offset ?? 0)}</div>
          ${record.body_excerpt
            ? markdownPreviewHtml(record.body_excerpt, 'kanban-scoped-row__body', 'No details.')
            : `<div class="kanban-detail-meta">${escHtml(record.source_ref || record.related_task_id || '')}</div>`}
        </div>
        <label class="kanban-field kanban-field--compact">
          <span>Status</span>
          <select data-kanban-scoped-field="status">${leafStatusOptions(record.status || 'open')}</select>
        </label>
        <label class="kanban-field kanban-field--compact">
          <span>${escHtml(config.priorityLabel)}</span>
          <select data-kanban-scoped-field="priority">${priorityOptions(priority)}</select>
        </label>
        <div class="kanban-scoped-row__actions">
          <button class="kanban-command-btn" type="button" data-kanban-scoped-row-action="save">Save</button>
          <button class="kanban-command-btn" type="button" data-kanban-scoped-row-action="promote">Promote</button>
          <button class="kanban-command-btn" type="button" data-kanban-scoped-row-action="archive">Archive</button>
        </div>
      </article>
    `;
  }

  function scopedRowsHtml(data, config) {
    const rows = data?.items || [];
    if (!rows.length) return `<div class="kanban-empty">No ${config.plural.toLowerCase()} in this scope.</div>`;
    if ((data?.view || '') === 'grouped' || (data?.view || '') === 'tree') {
      const groups = data.groups || [];
      return groups.map(group => {
        const groupRows = group[config.kind] || [];
        return `
          <section class="kanban-band kanban-scoped-group">
            <div class="kanban-section-head">
              <h3>${escHtml(group.item?.title || group.item?.item_id || 'Work item')}</h3>
              <span class="kanban-pill">${escHtml(groupRows.length)}</span>
            </div>
            <div class="kanban-detail-meta">${escHtml(group.scope?.relation || 'local')} - depth offset ${escHtml(group.scope?.depth_offset ?? 0)}</div>
            <div class="kanban-detail-list">
              ${groupRows.length ? groupRows.map(row => scopedRowHtml(row, config)).join('') : `<div class="kanban-empty">No ${config.plural.toLowerCase()} on this item.</div>`}
            </div>
          </section>
        `;
      }).join('');
    }
    return rows.map(row => scopedRowHtml(row, config)).join('');
  }

  function scopedModalHtml(data, config) {
    const scope = data?.scope || state.scoped.scope || 'descendants';
    const view = data?.view || state.scoped.view || 'grouped';
    const counts = data?.counts || {};
    return `
      <div class="kanban-scoped-modal">
        <div class="kanban-detail-list">
          ${detailRow(data?.item?.title || state.scoped.itemId, `${counts.total || 0} ${config.plural.toLowerCase()} - ${counts.scope_items || 0} scoped item${counts.scope_items === 1 ? '' : 's'}`, scopedBreadcrumbText(data))}
        </div>
        <div class="kanban-scoped-toolbar" aria-label="${escHtml(config.plural)} scope controls">
          <button class="kanban-command-btn" type="button" data-active="${scope === 'local' ? 'true' : 'false'}" data-kanban-scoped-action="scope-local">Local</button>
          <button class="kanban-command-btn" type="button" data-active="${scope === 'descendants' ? 'true' : 'false'}" data-kanban-scoped-action="scope-descendants">Descendants</button>
          <button class="kanban-command-btn" type="button" data-active="${view === 'flat' ? 'true' : 'false'}" data-kanban-scoped-action="view-flat">Flat</button>
          <button class="kanban-command-btn" type="button" data-active="${view !== 'flat' ? 'true' : 'false'}" data-kanban-scoped-action="view-grouped">Grouped</button>
          <button class="kanban-command-btn" type="button" data-kanban-scoped-action="create">New ${escHtml(config.singular)}</button>
        </div>
        <div class="kanban-detail-list kanban-scoped-list">
          ${scopedRowsHtml(data, config)}
        </div>
      </div>
    `;
  }

  function renderSelection() {
    const detail = el('kanban-selection-detail');
    const pill = el('kanban-selection-pill');
    if (pill) pill.textContent = state.selection?.item?.item_id ? 'Selected' : 'None';
    if (!detail) return;
    detail.innerHTML = selectionDetailHtml();
  }

  function selectionDetailHtml() {
    const item = state.selection?.item;
    if (!item) {
      return '<div class="kanban-empty">Select a card to inspect state, rollups, and provenance.</div>';
    }
    const rollup = rollupFor(item);
    return [
      detailRow(item.title || item.item_id, `${stateLabel(item.state_id)} - ${priorityLabel(item.priority_id)}`, markdownPreviewHtml(item.body_excerpt || '', 'kanban-detail-body', 'No description.', true), { bodyHtml: true }),
      detailRow('Rollup', `${rollup.items?.total || 0} scoped items`, `${rollup.issues?.open || 0} open issues - ${rollup.todos?.open || 0} open todos`),
      detailRow('Vector', item.vector?.index_key || '', item.search?.metadata?.vector?.index || ''),
      detailRow('Source', item.source?.ref || '', item.promoted_from_ref || ''),
    ].join('');
  }

  function renderProvenance() {
    const target = el('kanban-provenance');
    if (!target) return;
    target.innerHTML = provenanceHtml();
  }

  function provenanceHtml() {
    return [
      detailRow('Board API', state.currentParentId ? `/api/v1/personal/work/items/${state.currentParentId}/board` : '/api/v1/personal/work/board', 'DB-canonical work_items'),
      detailRow('Config API', '/api/v1/personal/work/config', `${stateRows().length} states - ${priorityRows().length} priorities`),
      detailRow('FSM', state.cardFsm.state, state.cardFsm.lastEvent),
      detailRow('Depth Limit', String(state.board?.rollup?.depth_limit || 12), state.currentParentId || 'root'),
    ].join('');
  }

  function embeddedSelectedHtml(options = {}) {
    const head = options.modal
      ? ''
      : `<div class="calendar-section-head kanban-section-head">
          <h3>Selected Card</h3>
          <span class="kanban-pill">${escHtml(state.selection?.item?.item_id ? 'Selected' : 'None')}</span>
        </div>`;
    return `<section class="calendar-band kanban-band kanban-band--embedded-selected" aria-label="Selected Card">
      ${head}
      <div class="kanban-detail-list">${selectionDetailHtml()}</div>
    </section>`;
  }

  function embeddedSearchHtml(host) {
    const instance = host?.id === 'kanban-filter-inline-panel'
      ? 'kanban-inline-search'
      : (host?.closest?.('#ultrawide-sidecar-body') ? 'kanban-sidecar-search' : 'kanban-panel-search');
    window.setTimeout(() => {
      if (window.BlueprintsPersonalSearch?.init) window.BlueprintsPersonalSearch.init();
    }, 0);
    return `<div class="personal-search-strip personal-search-strip--embedded" data-personal-search-surface="kanban" data-personal-search-instance="${escHtml(instance)}"></div>`;
  }

  function embeddedItemFormHtml(prefix = 'kanban-inline-item') {
    const safePrefix = String(prefix || 'kanban-inline-item').replace(/[^a-zA-Z0-9_-]/g, '-');
    const valueFor = (key, fallback = '') => String(el(`${safePrefix}-${key}`)?.value || fallback);
    return `
      <section class="calendar-quick-event calendar-quick-event--embedded kanban-inline-item" aria-label="New Work Item">
        <div class="kanban-modal-form kanban-inline-item__form">
          <div class="kanban-item-primary-row">
            <label class="kanban-field kanban-field--title" for="${escHtml(safePrefix)}-title">
              <span>Title</span>
              <input id="${escHtml(safePrefix)}-title" type="text" maxlength="180" value="${escHtml(valueFor('title'))}" />
            </label>
            <label class="kanban-field kanban-field--priority" for="${escHtml(safePrefix)}-priority">
              <span>Priority</span>
              <select id="${escHtml(safePrefix)}-priority">${priorityOptions(valueFor('priority', 'medium'))}</select>
            </label>
            <div class="calendar-filter-strip calendar-event-tags-strip kanban-item-tags-strip" role="button" tabindex="0" data-kanban-item-tags-strip data-kanban-item-tags-surface="${escHtml(NEW_ITEM_TAG_SURFACE)}" data-personal-filter-open="${escHtml(NEW_ITEM_TAG_SURFACE)}" data-personal-filter-tab="filters">${itemTagsSummaryHtml(NEW_ITEM_TAG_SURFACE)}</div>
          </div>
          ${markdownFieldHtml(`${safePrefix}-body`, 'Description', valueFor('body'), { inline: true })}
          <div class="kanban-modal-actions">
            <span id="${escHtml(safePrefix)}-status" class="kanban-detail-meta"></span>
            <button class="kanban-command-btn" type="button" data-kanban-action="submit-inline-item" data-kanban-item-prefix="${escHtml(safePrefix)}">Save Item</button>
          </div>
        </div>
      </section>`;
  }

  function embeddedProvenanceHtml(options = {}) {
    const head = options.modal
      ? ''
      : `<div class="calendar-section-head kanban-section-head"><h3>Provenance</h3></div>`;
    return `<section class="calendar-band kanban-band kanban-band--embedded-provenance" aria-label="Provenance">
      ${head}
      <div class="kanban-detail-list">${provenanceHtml()}</div>
    </section>`;
  }

  function detailPrefixForHost(host) {
    if (host?.id === 'kanban-filter-inline-panel') return 'kanban-inline-detail';
    if (host?.closest?.('#ultrawide-sidecar-body')) return 'kanban-sidecar-detail';
    return 'kanban-panel-detail';
  }

  function embeddedItemDetailHtml(host) {
    if (!state.detail?.item?.item_id) {
      return '<div class="kanban-empty">Select a card to edit item details.</div>';
    }
    return itemDetailHtml(state.detail, {
      prefix: detailPrefixForHost(host),
      panel: true,
      layout: isCompactDetailLayout() ? 'accordion' : 'tabs',
    });
  }

  function activateKanbanPanelTab(tabId) {
    if (!window.PersonalFilters?.activateTab) return false;
    if (typeof window.PersonalFilters.syncUltrawideSidecar === 'function') {
      window.PersonalFilters.syncUltrawideSidecar();
    }
    const hosts = [
      el('kanban-filter-inline-panel'),
      document.querySelector('#ultrawide-sidecar-body [data-personal-filter-host][data-personal-filter-surface="kanban"]'),
    ].filter(Boolean);
    for (const host of hosts) {
      if (!hostIsVisible(host)) continue;
      if (window.PersonalFilters.activateTab('kanban', tabId, { host, visibleOnly: true })) return true;
    }
    return false;
  }

  function refreshActiveDetailPanels() {
    if (!window.PersonalFilters?.activateTab) return;
    document.querySelectorAll('[data-personal-filter-host][data-personal-filter-surface="kanban"]').forEach(host => {
      if (host.dataset.personalFilterTab !== 'edit-item') return;
      if (!hostIsVisible(host)) return;
      window.PersonalFilters.activateTab('kanban', 'edit-item', { host, visibleOnly: false });
    });
  }

  function renderAll() {
    renderStatus();
    renderMeta();
    renderContentPanels();
    renderMetrics();
    renderBoard();
    renderSelection();
    renderProvenance();
    if (window.PersonalFilters?.renderAll) window.PersonalFilters.renderAll();
    renderItemTagSummaries();
  }

  async function loadRollups(items) {
    const entries = await Promise.all(items.slice(0, 40).map(async item => {
      try {
        const payload = await requestJson(`/api/v1/personal/work/items/${encodeURIComponent(item.item_id)}/rollup`);
        return [item.item_id, payload.rollup || {}];
      } catch (_) {
        return [item.item_id, null];
      }
    }));
    state.rollups = Object.fromEntries(entries.filter(([, value]) => value));
  }

  async function load(options = {}) {
    if (state.loading && !options.force) return;
    state.loading = true;
    state.error = '';
    renderStatus('loading');
    try {
      applyInitialRouteState();
      if (!state.config || options.forceConfig) {
        state.config = await requestJson('/api/v1/personal/work/config');
        applyPreferences(state.config);
      }
      const path = state.currentParentId
        ? `/api/v1/personal/work/items/${encodeURIComponent(state.currentParentId)}/board`
        : '/api/v1/personal/work/board';
      const payload = await requestJson(path);
      state.board = payload.board || {};
      applyPreferences(state.board);
      state.loaded = true;
      await loadRollups(rawBoardItems());
      reconcileVisibleBoardState();
      if (window.PersonalFilters?.invalidateSurface) {
        ['kanban', 'kanban-search', NEW_ITEM_TAG_SURFACE, EDIT_ITEM_TAG_SURFACE].forEach(surface => {
          window.PersonalFilters.invalidateSurface(surface);
        });
      }
      renderAll();
      if (state.routeDetailItemId && !state.detailModalOpen && !state.detailPanelOpen && !options.skipRouteDetail) {
        await openItemDetail(state.routeDetailItemId, { routeTarget: true });
      }
      if (state.routeScoped?.itemId && !state.scoped.open && !options.skipRouteScoped) {
        const scoped = state.routeScoped;
        state.routeScoped = null;
        await openScoped(scoped.kind, scoped.itemId, {
          scope: scoped.scope,
          view: scoped.view,
        });
      }
    } catch (error) {
      state.error = error.message || String(error);
      renderStatus(state.error);
    } finally {
      state.loading = false;
      renderStatus();
    }
  }

  async function setTestEntriesVisible(show, options = {}) {
    const nextValue = Boolean(show);
    setRefreshFsm('saving', nextValue ? 'show-test-entries' : 'hide-test-entries');
    renderStatus(nextValue ? 'showing tests' : 'hiding tests');
    try {
      const payload = await requestJson('/api/v1/personal/work/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          show_test_entries: nextValue,
          actor: options.actor || 'blueprints-ui',
          source_surface: options.source_surface || 'kanban-page',
          request_id: options.request_id || `ui-kanban-test-entries-${Date.now()}`,
        }),
      });
      applyPreferences(payload);
      setRefreshFsm('idle', 'saved-test-entry-visibility');
      await load({ force: true, forceConfig: true });
      return true;
    } catch (error) {
      state.error = error.message || String(error);
      setRefreshFsm('error', 'test-entry-visibility-error');
      renderStatus(state.error);
      return false;
    }
  }

  function toggleTestEntriesVisibility(options = {}) {
    return setTestEntriesVisible(!showTestEntries(), options);
  }

  function priorityOptions(selected = 'medium') {
    return priorityRows().map(priority => `<option value="${escHtml(priority.priority_id)}" ${priority.priority_id === selected ? 'selected' : ''}>${escHtml(priority.label)}</option>`).join('');
  }

  function stateOptions(selected = 'todo') {
    return stateRows().map(row => `<option value="${escHtml(row.state_id)}" ${row.state_id === selected ? 'selected' : ''}>${escHtml(row.label || row.state_id)}</option>`).join('');
  }

  function openDialog(title, bodyHtml, options = {}) {
    if (options.id) {
      const existing = document.getElementById(options.id);
      if (existing?.tagName === 'DIALOG') {
        if (existing.open && typeof HubModal !== 'undefined') HubModal.close(existing);
        else if (existing.open && typeof existing.close === 'function') existing.close();
        existing.remove();
      }
    }
    const host = document.createElement('div');
    const dialogId = options.id ? ` id="${escHtml(options.id)}"` : '';
    host.innerHTML = `<dialog${dialogId} class="hub-modal hub-dialog" data-tone="${escHtml(options.tone || 'info')}" style="width:${escHtml(options.width || 'min(720px,95vw)')}">
      <div class="hub-modal-header">
        <h2 class="hub-modal-title">
          <span class="hub-dialog-badge">${escHtml(options.badge || 'KAN')}</span>
          <span class="hub-dialog-title-text">${escHtml(title)}</span>
        </h2>
        <button class="hub-modal-close hub-dialog-close" type="button" aria-label="Close">&#10005;</button>
      </div>
      <div class="hub-modal-body">${bodyHtml}</div>
    </dialog>`;
    const dialog = host.firstElementChild;
    document.body.appendChild(dialog);
    const onClose = typeof options.onClose === 'function' ? options.onClose : null;
    let closeHandled = false;
    const handleClose = () => {
      if (closeHandled) return;
      closeHandled = true;
      if (onClose) onClose();
      if (dialog.isConnected) dialog.remove();
    };
    dialog.addEventListener('close', handleClose, { once: true });
    if (typeof HubModal !== 'undefined') {
      HubModal.init(document.body);
      HubModal.open(dialog, { onClose: handleClose });
    } else if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    }
    return dialog;
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof HubModal !== 'undefined') HubModal.close(dialog);
    else if (dialog.open) dialog.close();
    if (!dialog.open) dialog.remove();
  }

  function toggleMarkdownPreview(target, actionRoot = document) {
    const button = target?.nodeType === 1
      ? target
      : (actionRoot.querySelector?.(`[data-kanban-markdown-prefix="${target}"]`) || document.querySelector(`[data-kanban-markdown-prefix="${target}"]`));
    const prefix = button?.dataset?.kanbanMarkdownPrefix || String(target || 'kanban-body');
    const field = button?.closest?.('.calendar-markdown-field');
    const body = field?.querySelector?.('textarea') || el(prefix);
    const preview = field?.querySelector?.('.calendar-markdown-preview') || el(`${prefix}-preview`);
    if (!body || !preview) return false;
    const showing = !preview.hidden;
    if (showing) {
      preview.hidden = true;
      body.hidden = false;
      if (button) button.textContent = 'Preview';
      body.focus?.();
      return true;
    }
    preview.innerHTML = renderMarkdown(body.value);
    preview.hidden = false;
    body.hidden = true;
    if (button) button.textContent = 'Edit';
    return true;
  }

  function itemFormHtml(titleValue = '', bodyValue = '', priorityId = 'medium', depthInfo = null) {
    const depthLine = depthInfo
      ? `<div class="kanban-depth-note" data-depth-remaining="${escHtml(depthInfo.remaining)}">Parent: ${escHtml(depthInfo.label)} - remaining child depth ${escHtml(depthInfo.remaining)}</div>`
      : '';
    return `
      <div class="kanban-modal-form">
        ${depthLine}
        <div class="kanban-item-primary-row">
          <label class="kanban-field kanban-field--title" for="kanban-modal-title">
            <span>Title</span>
            <input id="kanban-modal-title" type="text" maxlength="180" value="${escHtml(titleValue)}" />
          </label>
          <label class="kanban-field kanban-field--priority" for="kanban-modal-priority">
            <span>Priority</span>
            <select id="kanban-modal-priority">${priorityOptions(priorityId)}</select>
          </label>
          <div class="calendar-filter-strip calendar-event-tags-strip kanban-item-tags-strip" role="button" tabindex="0" data-kanban-item-tags-strip data-kanban-item-tags-surface="${escHtml(NEW_ITEM_TAG_SURFACE)}" data-personal-filter-open="${escHtml(NEW_ITEM_TAG_SURFACE)}" data-personal-filter-tab="filters">${itemTagsSummaryHtml(NEW_ITEM_TAG_SURFACE)}</div>
        </div>
        ${markdownFieldHtml('kanban-modal-body', 'Description', bodyValue)}
        <div class="kanban-modal-actions">
          <button class="kanban-command-btn" type="button" data-kanban-modal-action="cancel">Cancel</button>
          <button class="kanban-command-btn" type="button" data-kanban-modal-action="submit">Save Item</button>
        </div>
      </div>`;
  }

  async function openItemForm({ parentItemId = state.currentParentId, stateId = 'todo', title = '', childOfSelection = false } = {}) {
    const depthInfo = await childCreateDepthInfo(parentItemId);
    if (!depthInfo.allowed) {
      await HubDialogs.alert({
        title: 'Depth Limit',
        message: `${depthInfo.label} has no remaining child depth.`,
        tone: 'warning',
      });
      return false;
    }
    const dialog = openDialog(childOfSelection ? 'New Child Item' : 'New Work Item', itemFormHtml(title, '', 'medium', depthInfo), {
      badge: 'ITEM',
      id: childOfSelection ? 'kanban-child-item-modal' : 'kanban-item-modal',
    });
    const titleInput = dialog.querySelector('#kanban-modal-title');
    const bodyInput = dialog.querySelector('#kanban-modal-body');
    const priorityInput = dialog.querySelector('#kanban-modal-priority');
    if (titleInput) titleInput.focus();
    renderItemTagSummaries();
    dialog.addEventListener('click', async event => {
      const action = event.target?.dataset?.kanbanModalAction;
      if (!action) return;
      if (action === 'toggle-markdown-preview') {
        toggleMarkdownPreview(event.target, dialog);
        return;
      }
      if (action === 'cancel') {
        closeDialog(dialog);
        return;
      }
      const cleanTitle = String(titleInput?.value || '').trim();
      if (!cleanTitle) {
        await HubDialogs.alert({ title: 'Kanban', message: 'Title is required.', tone: 'warning' });
        return;
      }
      const payload = {
        parent_item_id: parentItemId || null,
        title: cleanTitle,
        body: bodyInput?.value || '',
        state_id: stateId,
        priority_id: priorityInput?.value || 'medium',
        tags: itemTagIds(NEW_ITEM_TAG_SURFACE),
        actor: 'blueprints-ui',
        source_surface: 'kanban-page',
        request_id: `ui-kanban-item-${Date.now()}`,
      };
      const resp = await requestJson('/api/v1/personal/work/items', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      state.lastWrite = resp;
      closeDialog(dialog);
      await load({ force: true });
      setSelection(resp.item?.item_id);
    });
  }

  async function submitInlineItem(prefix = 'kanban-inline-item') {
    const titleInput = el(`${prefix}-title`);
    const bodyInput = el(`${prefix}-body`);
    const priorityInput = el(`${prefix}-priority`);
    const status = el(`${prefix}-status`);
    const cleanTitle = String(titleInput?.value || '').trim();
    if (!cleanTitle) {
      if (status) status.textContent = 'Title is required.';
      return false;
    }
    if (status) status.textContent = 'Saving item...';
    const resp = await requestJson('/api/v1/personal/work/items', {
      method: 'POST',
      body: JSON.stringify({
        parent_item_id: state.currentParentId || null,
        title: cleanTitle,
        body: bodyInput?.value || '',
        state_id: 'todo',
        priority_id: priorityInput?.value || 'medium',
        tags: itemTagIds(NEW_ITEM_TAG_SURFACE),
        actor: 'blueprints-ui',
        source_surface: 'kanban-inline-panel',
        request_id: `ui-kanban-inline-item-${Date.now()}`,
      }),
    });
    state.lastWrite = resp;
    if (status) status.textContent = `Saved ${resp.item?.item_id || ''}`;
    if (titleInput) titleInput.value = '';
    if (bodyInput) bodyInput.value = '';
    await load({ force: true });
    if (resp.item?.item_id) setSelection(resp.item.item_id);
    return true;
  }

  async function openLeafForm(kind, itemId) {
    const label = kind === 'issue' ? 'Issue' : 'ToDo';
    const dialog = openDialog(`New ${label}`, `
      <div class="kanban-modal-form">
        <label class="kanban-field" for="kanban-leaf-title"><span>Title</span><input id="kanban-leaf-title" type="text" maxlength="180" /></label>
        ${markdownFieldHtml('kanban-leaf-body', 'Details', '')}
        <div class="kanban-modal-actions">
          <button class="kanban-command-btn" type="button" data-kanban-modal-action="cancel">Cancel</button>
          <button class="kanban-command-btn" type="button" data-kanban-modal-action="submit">Save ${label}</button>
        </div>
      </div>`, {
      badge: kind === 'issue' ? 'ISS' : 'TODO',
      id: kind === 'issue' ? 'kanban-issue-modal' : 'kanban-todo-modal',
    });
    const titleInput = dialog.querySelector('#kanban-leaf-title');
    const bodyInput = dialog.querySelector('#kanban-leaf-body');
    if (titleInput) titleInput.focus();
    dialog.addEventListener('click', async event => {
      const action = event.target?.dataset?.kanbanModalAction;
      if (!action) return;
      if (action === 'toggle-markdown-preview') {
        toggleMarkdownPreview(event.target, dialog);
        return;
      }
      if (action === 'cancel') {
        closeDialog(dialog);
        return;
      }
      const cleanTitle = String(titleInput?.value || '').trim();
      if (!cleanTitle) {
        await HubDialogs.alert({ title: 'Kanban', message: 'Title is required.', tone: 'warning' });
        return;
      }
      const endpoint = kind === 'issue' ? '/api/v1/personal/work/issues' : '/api/v1/personal/work/todos';
      const payload = {
        item_id: itemId,
        title: cleanTitle,
        body: bodyInput?.value || '',
        actor: 'blueprints-ui',
        source_surface: 'kanban-page',
        request_id: `ui-kanban-${kind}-${Date.now()}`,
      };
      state.lastWrite = await requestJson(endpoint, { method: 'POST', body: JSON.stringify(payload) });
      closeDialog(dialog);
      await load({ force: true });
      setSelection(itemId);
    });
  }

  function scrollSelectionIntoView(options = {}) {
    const itemId = state.selection?.item?.item_id || '';
    if (!itemId) return;
    window.requestAnimationFrame(() => {
      const card = Array.from(document.querySelectorAll('#tab-kanban [data-kanban-item-id]'))
        .find(node => node.dataset.kanbanItemId === itemId && node.classList?.contains('kanban-card'));
      card?.scrollIntoView?.({
        block: options.center ? 'center' : 'nearest',
        inline: options.center ? 'center' : 'nearest',
      });
    });
  }

  async function setSelection(itemId, { openDetail = false, routeTarget = false, preserveRouteTarget = false } = {}) {
    const item = findItem(itemId);
    if (!item) return;
    if (routeTarget) state.routeHighlightItemId = item.item_id;
    else if (!preserveRouteTarget) state.routeHighlightItemId = '';
    state.selection = { item };
    setFsm('selected', 'select', itemId);
    renderAll();
    scrollSelectionIntoView({ center: routeTarget });
    if (openDetail) await openItemDetail(itemId);
  }

  function selectFirstItemIfNeeded() {
    if (state.selection?.item?.item_id) return state.selection.item.item_id;
    const first = boardItems()[0];
    if (!first) return '';
    state.selection = { item: first };
    setFsm('selected', 'selectFirst', first.item_id);
    renderAll();
    return first.item_id;
  }

  function compactJson(value) {
    if (!value || typeof value !== 'object') return '';
    const text = JSON.stringify(value);
    return text === '{}' ? '' : text;
  }

  function detailCollectionRows(rows, emptyText, rowMapper) {
    const list = Array.isArray(rows) ? rows : [];
    return list.length
      ? list.map(rowMapper).join('')
      : `<div class="kanban-empty">${escHtml(emptyText)}</div>`;
  }

  function detailBreadcrumbText(detail) {
    const rows = Array.isArray(detail?.breadcrumbs) ? detail.breadcrumbs : [];
    return ['Root board', ...rows.map(item => item.title || item.item_id)].join(' / ');
  }

  function detailDraftFromDetail(detail) {
    const item = detail?.item || {};
    const discussions = {};
    (detail?.discussions || []).forEach(row => {
      if (row?.discussion_id) discussions[row.discussion_id] = row.body || row.body_excerpt || '';
    });
    return {
      itemId: item.item_id || '',
      title: item.title || '',
      stateId: item.state_id || 'todo',
      priorityId: item.priority_id || 'medium',
      tags: itemTagIds(EDIT_ITEM_TAG_SURFACE, item.tags || []),
      body: item.body_excerpt || '',
      detailBody: detail?.detail_document?.body || '',
      newDiscussionBody: '',
      discussions,
    };
  }

  function ensureDetailDraft(detail = state.detail) {
    const next = detailDraftFromDetail(detail);
    if (!next.itemId) return null;
    if (!state.detailDraft || state.detailDraft.itemId !== next.itemId) {
      state.detailDraft = next;
    }
    return state.detailDraft;
  }

  function detailDraftValue(key, detail = state.detail) {
    const draft = ensureDetailDraft(detail);
    if (draft && String(key || '').startsWith('discussion:')) {
      return String(draft.discussions?.[String(key).slice('discussion:'.length)] ?? '');
    }
    return draft ? String(draft[key] ?? '') : '';
  }

  function updateDetailDraftFromField(field) {
    if (!field?.dataset?.kanbanDetailField) return false;
    const draft = ensureDetailDraft();
    if (!draft) return false;
    const key = field.dataset.kanbanDetailField;
    if (String(key || '').startsWith('discussion:')) {
      const discussionId = String(key).slice('discussion:'.length);
      draft.discussions = draft.discussions || {};
      draft.discussions[discussionId] = field.value;
      return true;
    }
    if (!Object.prototype.hasOwnProperty.call(draft, key)) return false;
    draft[key] = field.value;
    return true;
  }

  function syncDetailDraftFields(sourceField) {
    const key = sourceField?.dataset?.kanbanDetailField || '';
    if (!key || !state.detailDraft) return;
    document.querySelectorAll(`[data-kanban-detail-field="${key}"]`).forEach(field => {
      if (field === sourceField) return;
      if ('value' in field) field.value = detailDraftValue(key);
    });
  }

  function syncDetailDraftFromScope(scope) {
    scope?.querySelectorAll?.('[data-kanban-detail-field]').forEach(updateDetailDraftFromField);
  }

  function detailItemAvailable() {
    return Boolean(state.detail?.item?.item_id);
  }

  function countBadge(count) {
    const value = Number(count || 0);
    return `<span class="kanban-detail-count">${escHtml(value)}</span>`;
  }

  function detailSectionRowsHtml(detail) {
    const item = detail?.item || {};
    const parentLabel = item.parent_item_id || 'root';
    return `
      <div class="kanban-detail-list">
        ${detailRow('Parent', parentLabel, detailBreadcrumbText(detail))}
        ${detailRow('Depth', `${item.depth || 0} of ${detail.depth_limit || depthLimit()}`, `${detail.remaining_depth ?? remainingDepthForItem(item)} remaining child levels`)}
        ${detailRow('Rollup', `${detail.rollup?.items?.total || 0} scoped items`, `${detail.rollup?.issues?.open || 0} open issues - ${detail.rollup?.todos?.open || 0} open todos - ${detail.rollup?.blockers?.open || 0} blockers`)}
      </div>`;
  }

  function detailDocumentSectionHtml(detail) {
    const draft = ensureDetailDraft(detail) || detailDraftFromDetail(detail);
    return `
      <div class="kanban-detail-doc">
        ${markdownFieldHtml('kanban-item-detail-doc', 'Detail', draft.detailBody || '', {
          detail: true,
          fieldName: 'detailBody',
          previewDefault: true,
          maxlength: 120000,
          emptyText: 'No detail yet.',
        })}
        <div class="kanban-modal-actions kanban-modal-actions--compact">
          <span class="kanban-detail-save-status" data-kanban-detail-document-status></span>
          <button class="kanban-command-btn" type="button" data-kanban-detail-action="save-detail-doc">Save Detail</button>
        </div>
      </div>`;
  }

  function discussionBodyHtml(id, fieldName, value = '', { editMode = false, newEntry = false } = {}) {
    const safeId = String(id || 'kanban-discussion').replace(/[^a-zA-Z0-9_-]/g, '-');
    const hiddenPreview = editMode || newEntry;
    const hiddenEditor = !editMode && !newEntry;
    return `
      <textarea
        id="${escHtml(safeId)}"
        class="kanban-discussion-textarea"
        maxlength="120000"
        data-kanban-detail-field="${escHtml(fieldName)}"
        aria-label="${escHtml(newEntry ? 'New discussion' : 'Discussion entry')}"
        ${hiddenEditor ? 'hidden' : ''}
      >${escHtml(value)}</textarea>
      <div
        id="${escHtml(safeId)}-preview"
        class="calendar-markdown-preview kanban-discussion-preview"
        ${hiddenPreview ? 'hidden' : ''}
      >${renderMarkdown(value || '', 'No discussion text.')}</div>`;
  }

  function discussionSectionHtml(detail) {
    const draft = ensureDetailDraft(detail) || detailDraftFromDetail(detail);
    const discussions = Array.isArray(detail?.discussions) ? detail.discussions : [];
    const editMode = Boolean(state.discussionEditMode);
    const rows = discussions.length
      ? discussions.map(row => {
          const discussionId = row.discussion_id || '';
          const fieldName = `discussion:${discussionId}`;
          return `
            <article class="kanban-discussion-card" data-kanban-discussion-id="${escHtml(discussionId)}">
              ${editMode ? `<label class="hub-checkbox kanban-discussion-delete-check" title="Mark for delete"><input class="hub-checkbox__input" type="checkbox" data-kanban-discussion-delete="${escHtml(discussionId)}" aria-label="Mark discussion for delete" /><span class="hub-checkbox__box" aria-hidden="true"></span><span class="hub-checkbox__label">Delete</span></label>` : ''}
              ${discussionBodyHtml(`kanban-discussion-${discussionId}`, fieldName, detailDraftValue(fieldName), { editMode })}
            </article>`;
        }).join('')
      : `<div class="kanban-empty">No discussion entries.</div>`;
    return `
      <div class="kanban-detail-list kanban-discussion-list">
        <section class="kanban-discussion-card kanban-discussion-card--new">
          ${discussionBodyHtml('kanban-discussion-new', 'newDiscussionBody', draft.newDiscussionBody || '', { newEntry: true })}
        </section>
        <div class="kanban-modal-actions kanban-modal-actions--compact kanban-discussion-actions">
          <span class="kanban-detail-save-status" data-kanban-discussion-batch-status></span>
          <button class="kanban-command-btn" type="button" data-kanban-detail-action="edit-discussions">${editMode ? 'Preview' : 'Edit'}</button>
          <button class="kanban-command-btn" type="button" data-kanban-detail-action="save-discussions">Save</button>
          <button class="kanban-command-btn kanban-command-btn--danger" type="button" data-kanban-detail-action="delete-discussions" ${editMode && discussions.length ? '' : 'disabled'}>Delete</button>
        </div>
        <section class="kanban-discussion-entries">
          ${rows}
        </section>
      </div>`;
  }

  function itemDetailSections(detail) {
    const children = detail?.children || [];
    const links = detail?.links || [];
    const blockers = detail?.blockers || [];
    const issues = detail?.issues || [];
    const todos = detail?.todos || [];
    const discussions = detail?.discussions || [];
    return [
      {
        id: 'detail',
        label: 'Detail',
        html: detailDocumentSectionHtml(detail),
      },
      {
        id: 'discussion',
        label: 'Discussion',
        count: discussions.length,
        html: discussionSectionHtml(detail),
      },
      {
        id: 'info',
        label: 'Info',
        html: detailSectionRowsHtml(detail),
      },
      {
        id: 'children',
        label: 'Children',
        count: detail?.counts?.children ?? children.length,
        html: `<div class="kanban-detail-list">
          ${detailCollectionRows(children, 'No direct child items.', child => detailRow(child.title || child.item_id, `${stateLabel(child.state_id)} - ${priorityLabel(child.priority_id)}`, markdownPreviewHtml(child.body_excerpt || '', 'kanban-detail-body', 'No description.'), { bodyHtml: true }))}
        </div>`,
      },
      {
        id: 'links',
        label: 'Links',
        count: detail?.counts?.links ?? links.length,
        html: `<div class="kanban-detail-list">
          ${detailCollectionRows(links, 'No item links.', link => detailRow(link.link_type || 'related', `${link.source_item_id || ''} -> ${link.target_item_id || ''}`, compactJson(link.metadata)))}
        </div>`,
      },
      {
        id: 'blockers',
        label: 'Blockers',
        count: detail?.counts?.blockers ?? blockers.length,
        html: `<div class="kanban-detail-list">
          ${detailCollectionRows(blockers, 'No blockers recorded.', blocker => detailRow(blocker.title || blocker.blocker_id, `${blocker.status || 'open'} - ${blocker.blocked_by_ref || 'no source ref'}`, markdownPreviewHtml(blocker.body_excerpt || '', 'kanban-detail-body', 'No details.'), { bodyHtml: true }))}
        </div>`,
      },
      {
        id: 'issues',
        label: 'Issues',
        count: issues.length,
        html: `<div class="kanban-detail-list">
          ${detailCollectionRows(issues, 'No issues in this scope.', issue => detailRow(issue.title, `issue - ${issue.status}`, issue.body_excerpt ? markdownPreviewHtml(issue.body_excerpt, 'kanban-detail-body', 'No details.') : (issue.source_ref || ''), { bodyHtml: !!issue.body_excerpt }))}
        </div>`,
      },
      {
        id: 'todos',
        label: 'Todos',
        count: todos.length,
        html: `<div class="kanban-detail-list">
          ${detailCollectionRows(todos, 'No todos in this scope.', todo => detailRow(todo.title, `todo - ${todo.status}`, todo.body_excerpt ? markdownPreviewHtml(todo.body_excerpt, 'kanban-detail-body', 'No details.') : (todo.related_task_id || ''), { bodyHtml: !!todo.body_excerpt }))}
        </div>`,
      },
      {
        id: 'history',
        label: 'History',
        count: (detail?.audit || []).length,
        html: `<div class="kanban-detail-list">
          ${detailCollectionRows(detail?.audit || [], 'No audit history.', row => detailRow(row.action || row.audit_id, `${row.actor || ''} - ${row.created_at || ''}`, compactJson(row.metadata)))}
        </div>`,
      },
    ];
  }

  function normalizedDetailSection(sections) {
    const active = String(state.detailSection || 'detail');
    return sections.some(section => section.id === active) ? active : (sections[0]?.id || 'detail');
  }

  function isCompactDetailLayout() {
    return Boolean(window.matchMedia?.('(max-width: 820px)').matches);
  }

  function detailSectionsHtml(detail, options = {}) {
    const sections = itemDetailSections(detail);
    const active = normalizedDetailSection(sections);
    const layout = options.layout || (isCompactDetailLayout() ? 'accordion' : 'tabs');
    if (layout === 'accordion') {
      return `<div class="kanban-detail-related kanban-detail-related--accordion" data-layout="accordion">
        ${sections.map(section => `<details class="kanban-detail-accordion" ${section.id === active ? 'open' : ''}>
          <summary>${escHtml(section.label)}${section.count == null ? '' : countBadge(section.count)}</summary>
          <div class="kanban-detail-accordion__body">${section.html}</div>
        </details>`).join('')}
      </div>`;
    }
    const activeSection = sections.find(section => section.id === active) || sections[0];
    return `<div class="kanban-detail-related kanban-detail-related--tabs" data-layout="tabs">
      <div class="kanban-detail-tabs" role="tablist" aria-label="Item details">
        ${sections.map(section => `<button class="kanban-detail-tab" type="button" role="tab" aria-selected="${section.id === active ? 'true' : 'false'}" data-kanban-detail-action="section" data-kanban-detail-section="${escHtml(section.id)}">
          <span>${escHtml(section.label)}</span>${section.count == null ? '' : countBadge(section.count)}
        </button>`).join('')}
      </div>
      <div class="kanban-detail-section" role="tabpanel">${activeSection.html}</div>
    </div>`;
  }

  function itemDetailHtml(detail, options = {}) {
    const item = detail.item || {};
    const prefix = String(options.prefix || 'kanban-detail').replace(/[^a-zA-Z0-9_-]/g, '-');
    const draft = ensureDetailDraft(detail) || detailDraftFromDetail(detail);
    const primaryGridClass = `kanban-detail-primary-grid${options.panel ? ' kanban-detail-primary-grid--panel' : ''}`;
    return `
      <div class="kanban-detail-workspace" data-kanban-detail-item-id="${escHtml(item.item_id || '')}">
        <div class="kanban-modal-form kanban-detail-edit-form">
          <div class="${primaryGridClass}">
            <label class="kanban-field kanban-field--title" for="${escHtml(prefix)}-title-input">
              <span class="kanban-visually-hidden">Title</span>
              <input id="${escHtml(prefix)}-title-input" type="text" maxlength="180" value="${escHtml(draft.title || '')}" data-kanban-detail-field="title" aria-label="Title" />
            </label>
            <label class="kanban-field kanban-field--state" for="${escHtml(prefix)}-state-input">
              <span class="kanban-visually-hidden">State</span>
              <select id="${escHtml(prefix)}-state-input" data-kanban-detail-field="stateId" aria-label="State">${stateOptions(draft.stateId || item.state_id || 'todo')}</select>
            </label>
            <label class="kanban-field kanban-field--priority" for="${escHtml(prefix)}-priority-input">
              <span class="kanban-visually-hidden">Priority</span>
              <select id="${escHtml(prefix)}-priority-input" data-kanban-detail-field="priorityId" aria-label="Priority">${priorityOptions(draft.priorityId || item.priority_id || 'medium')}</select>
            </label>
            ${options.panel ? '<button class="kanban-icon-btn kanban-icon-btn--fullscreen kanban-detail-fullscreen-btn" type="button" data-kanban-detail-action="fullscreen" title="Full screen" aria-label="Open item full screen"></button>' : ''}
          </div>
          <div class="calendar-filter-strip calendar-event-tags-strip kanban-item-tags-strip kanban-detail-tags-field" role="button" tabindex="0" data-kanban-item-tags-strip data-kanban-item-tags-surface="${escHtml(EDIT_ITEM_TAG_SURFACE)}" data-personal-filter-open="${escHtml(EDIT_ITEM_TAG_SURFACE)}" data-personal-filter-tab="filters">${itemTagsSummaryHtml(EDIT_ITEM_TAG_SURFACE)}</div>
          ${markdownFieldHtml(`${prefix}-body-input`, 'Description', draft.body || '', { detail: true, fieldName: 'body', hideLabel: true })}
          <div class="kanban-modal-actions">
            <span class="kanban-detail-save-status" data-kanban-detail-status></span>
            <button class="kanban-command-btn" type="button" data-kanban-detail-action="save">Save Changes</button>
            <button class="kanban-command-btn" type="button" data-kanban-detail-action="child-board">Child Board</button>
            <button class="kanban-command-btn" type="button" data-kanban-detail-action="add-child">Add Child</button>
            <button class="kanban-command-btn" type="button" data-kanban-detail-action="add-link">Add Link</button>
            <button class="kanban-command-btn" type="button" data-kanban-detail-action="add-blocker">Add Blocker</button>
          </div>
        </div>
        ${detailSectionsHtml(detail, options)}
      </div>`;
  }

  async function saveDetail(itemId = state.detail?.item?.item_id, options = {}) {
    if (options.scope) syncDetailDraftFromScope(options.scope);
    syncEditItemDraftTagsFromSurface();
    const draft = ensureDetailDraft();
    const cleanItemId = itemId || draft?.itemId || '';
    if (!cleanItemId || !draft) return false;
    const cleanTitle = String(draft.title || '').trim();
    const status = options.statusEl || null;
    if (!cleanTitle) {
      if (status) status.textContent = 'Title is required.';
      await HubDialogs.alert({ title: 'Kanban', message: 'Title is required.', tone: 'warning' });
      return false;
    }
    if (status) status.textContent = 'Saving item...';
    const resp = await requestJson(`/api/v1/personal/work/items/${encodeURIComponent(cleanItemId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: cleanTitle,
        body: draft.body || '',
        state_id: draft.stateId || 'todo',
        priority_id: draft.priorityId || 'medium',
        tags: cleanTagList(draft.tags || []),
        actor: 'blueprints-ui',
        source_surface: 'kanban-detail',
        request_id: `ui-kanban-detail-${Date.now()}`,
      }),
    });
    state.lastWrite = resp;
    if (status) status.textContent = 'Item updated.';
    await load({ force: true, skipRouteDetail: true, skipRouteScoped: true });
    await loadItemDetail(resp.item?.item_id || cleanItemId, { preserveRouteTarget: true });
    if (options.closeModal) closeDialog(el('kanban-detail-modal'));
    return true;
  }

  async function saveDetailDocument(itemId = state.detail?.item?.item_id, options = {}) {
    if (options.scope) syncDetailDraftFromScope(options.scope);
    const draft = ensureDetailDraft();
    const cleanItemId = itemId || draft?.itemId || '';
    const status = options.statusEl || null;
    if (!cleanItemId || !draft) return false;
    if (status) status.textContent = 'Saving detail...';
    const resp = await requestJson(`/api/v1/personal/work/items/${encodeURIComponent(cleanItemId)}/detail`, {
      method: 'PUT',
      body: JSON.stringify({
        body: draft.detailBody || '',
        actor: 'blueprints-ui',
        source_surface: 'kanban-detail',
        request_id: `ui-kanban-detail-doc-${Date.now()}`,
      }),
    });
    state.lastWrite = resp;
    if (status) status.textContent = 'Detail saved.';
    await loadItemDetail(cleanItemId, { preserveRouteTarget: true });
    refreshDetailSurfaces();
    return true;
  }

  async function saveDiscussions(itemId = state.detail?.item?.item_id, options = {}) {
    if (options.scope) syncDetailDraftFromScope(options.scope);
    const draft = ensureDetailDraft();
    const cleanItemId = itemId || draft?.itemId || '';
    const status = options.statusEl || null;
    if (!cleanItemId || !draft) return false;
    const discussions = Array.isArray(state.detail?.discussions) ? state.detail.discussions : [];
    const changed = discussions.filter(row => {
      const discussionId = row?.discussion_id || '';
      if (!discussionId) return false;
      const nextBody = draft.discussions?.[discussionId] ?? '';
      const currentBody = row.body || row.body_excerpt || '';
      return nextBody !== currentBody;
    });
    const newBody = String(draft.newDiscussionBody || '');
    if (!changed.length && !newBody.trim()) {
      if (status) status.textContent = 'No discussion changes.';
      return true;
    }
    if (status) status.textContent = 'Saving discussions...';
    for (const row of changed) {
      const discussionId = row.discussion_id || '';
      state.lastWrite = await requestJson(`/api/v1/personal/work/discussions/${encodeURIComponent(discussionId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          body: draft.discussions?.[discussionId] ?? '',
          actor: 'blueprints-ui',
          source_surface: 'kanban-detail',
          request_id: `ui-kanban-discussion-save-${Date.now()}-${discussionId}`,
        }),
      });
    }
    if (newBody.trim()) {
      state.lastWrite = await requestJson(`/api/v1/personal/work/items/${encodeURIComponent(cleanItemId)}/discussions`, {
        method: 'POST',
        body: JSON.stringify({
          body: newBody,
          actor: 'blueprints-ui',
          source_surface: 'kanban-detail',
          request_id: `ui-kanban-discussion-${Date.now()}`,
        }),
      });
    }
    state.discussionEditMode = false;
    await loadItemDetail(cleanItemId, { preserveRouteTarget: true });
    state.detailDraft = detailDraftFromDetail(state.detail);
    if (status) status.textContent = 'Discussions saved.';
    refreshDetailSurfaces();
    return true;
  }

  async function deleteMarkedDiscussions(options = {}) {
    const scope = options.scope || document;
    const status = options.statusEl || null;
    const discussionIds = Array.from(scope.querySelectorAll?.('[data-kanban-discussion-delete]:checked') || [])
      .map(node => String(node.dataset.kanbanDiscussionDelete || '').trim())
      .filter(Boolean);
    if (!discussionIds.length) {
      if (status) status.textContent = 'Mark entries to delete.';
      await HubDialogs.alert({ title: 'Kanban', message: 'Mark one or more discussion entries to delete.', tone: 'warning' });
      return false;
    }
    const ok = await HubDialogs.confirmDelete({
      title: 'Delete Discussions',
      message: `Delete ${discussionIds.length} discussion ${discussionIds.length === 1 ? 'entry' : 'entries'}?`,
      details: discussionIds,
    });
    if (!ok) return false;
    if (status) status.textContent = 'Deleting discussions...';
    let itemId = state.detail?.item?.item_id || state.detailDraft?.itemId || '';
    for (const discussionId of discussionIds) {
      state.lastWrite = await requestJson(`/api/v1/personal/work/discussions/${encodeURIComponent(discussionId)}`, {
        method: 'DELETE',
        body: JSON.stringify({
          actor: 'blueprints-ui',
          source_surface: 'kanban-detail',
          request_id: `ui-kanban-discussion-delete-${Date.now()}-${discussionId}`,
        }),
      });
      itemId = state.lastWrite?.deleted_discussion?.item_id || itemId;
    }
    state.discussionEditMode = false;
    await loadItemDetail(itemId, { preserveRouteTarget: true });
    state.detailDraft = detailDraftFromDetail(state.detail);
    if (status) status.textContent = 'Discussions deleted.';
    refreshDetailSurfaces();
    return true;
  }

  async function openLinkForm(itemId) {
    const dialog = openDialog('Add Item Link', `
      <div class="kanban-modal-form">
        <label class="kanban-field" for="kanban-link-target"><span>Target Item ID</span><input id="kanban-link-target" type="text" maxlength="180" /></label>
        <label class="kanban-field" for="kanban-link-type"><span>Link Type</span><select id="kanban-link-type">
          <option value="related">Related</option>
          <option value="depends_on">Depends On</option>
          <option value="blocks">Blocks</option>
          <option value="references">References</option>
        </select></label>
        <div class="kanban-modal-actions">
          <button class="kanban-command-btn" type="button" data-kanban-modal-action="cancel">Cancel</button>
          <button class="kanban-command-btn" type="button" data-kanban-modal-action="submit">Save Link</button>
        </div>
      </div>`, { badge: 'LINK', id: 'kanban-link-modal' });
    const targetInput = dialog.querySelector('#kanban-link-target');
    const typeInput = dialog.querySelector('#kanban-link-type');
    if (targetInput) targetInput.focus();
    dialog.addEventListener('click', async event => {
      const action = event.target?.dataset?.kanbanModalAction;
      if (!action) return;
      if (action === 'cancel') {
        closeDialog(dialog);
        return;
      }
      const targetItemId = String(targetInput?.value || '').trim();
      if (!targetItemId) {
        await HubDialogs.alert({ title: 'Kanban', message: 'Target item id is required.', tone: 'warning' });
        return;
      }
      state.lastWrite = await requestJson(`/api/v1/personal/work/items/${encodeURIComponent(itemId)}/links`, {
        method: 'POST',
        body: JSON.stringify({
          target_item_id: targetItemId,
          link_type: typeInput?.value || 'related',
          metadata: { source: 'kanban-detail' },
          actor: 'blueprints-ui',
          source_surface: 'kanban-detail',
          request_id: `ui-kanban-link-${Date.now()}`,
        }),
      });
      closeDialog(dialog);
      await load({ force: true });
      await openItemDetail(itemId);
    });
  }

  async function openBlockerForm(itemId) {
    const dialog = openDialog('Add Blocker', `
      <div class="kanban-modal-form">
        <label class="kanban-field" for="kanban-blocker-title"><span>Title</span><input id="kanban-blocker-title" type="text" maxlength="180" /></label>
        <label class="kanban-field" for="kanban-blocker-ref"><span>Blocked By Ref</span><input id="kanban-blocker-ref" type="text" maxlength="220" /></label>
        ${markdownFieldHtml('kanban-blocker-body', 'Details', '')}
        <div class="kanban-modal-actions">
          <button class="kanban-command-btn" type="button" data-kanban-modal-action="cancel">Cancel</button>
          <button class="kanban-command-btn" type="button" data-kanban-modal-action="submit">Save Blocker</button>
        </div>
      </div>`, { badge: 'BLK', id: 'kanban-blocker-modal' });
    const titleInput = dialog.querySelector('#kanban-blocker-title');
    const refInput = dialog.querySelector('#kanban-blocker-ref');
    const bodyInput = dialog.querySelector('#kanban-blocker-body');
    if (titleInput) titleInput.focus();
    dialog.addEventListener('click', async event => {
      const action = event.target?.dataset?.kanbanModalAction;
      if (!action) return;
      if (action === 'toggle-markdown-preview') {
        toggleMarkdownPreview(event.target, dialog);
        return;
      }
      if (action === 'cancel') {
        closeDialog(dialog);
        return;
      }
      const cleanTitle = String(titleInput?.value || '').trim();
      if (!cleanTitle) {
        await HubDialogs.alert({ title: 'Kanban', message: 'Blocker title is required.', tone: 'warning' });
        return;
      }
      state.lastWrite = await requestJson('/api/v1/personal/work/blockers', {
        method: 'POST',
        body: JSON.stringify({
          item_id: itemId,
          title: cleanTitle,
          body: bodyInput?.value || '',
          blocked_by_ref: refInput?.value || '',
          actor: 'blueprints-ui',
          source_surface: 'kanban-detail',
          request_id: `ui-kanban-blocker-${Date.now()}`,
        }),
      });
      closeDialog(dialog);
      await load({ force: true });
      await openItemDetail(itemId);
    });
  }

  async function loadItemDetail(itemId = state.selection?.item?.item_id, options = {}) {
    itemId = itemId || selectFirstItemIfNeeded();
    if (!itemId) {
      await HubDialogs.alert({ title: 'Kanban', message: 'Select a card first.', tone: 'warning' });
      return null;
    }
    const detail = await requestJson(`/api/v1/personal/work/items/${encodeURIComponent(itemId)}`);
    const item = detail.item || {};
    if (itemHiddenByPreference(item)) {
      clearDetailSelectionState('hiddenDetailSuppressed');
      renderAll();
      return null;
    }
    if (item.item_id) {
      const targetParentId = item.parent_item_id || '';
      if ((state.currentParentId || '') !== targetParentId) {
        state.currentParentId = targetParentId;
        state.routeDetailItemId = item.item_id;
        if (options.routeTarget) state.routeHighlightItemId = item.item_id;
        writeRouteState(state.currentParentId, item.item_id);
        await load({ force: true, skipRouteDetail: true, skipRouteScoped: true });
      }
    }
    state.detail = detail;
    ensureDetailDraft(detail);
    syncEditItemTagsFromDetail(detail);
    state.routeDetailItemId = item.item_id || itemId;
    if (item.item_id) {
      const boardItem = findItem(item.item_id);
      if (options.routeTarget) state.routeHighlightItemId = item.item_id;
      else if (!options.preserveRouteTarget) state.routeHighlightItemId = '';
      state.selection = { item: boardItem || item };
      setFsm('selected', 'openDetail', item.item_id);
    }
    writeRouteState(state.currentParentId, state.routeDetailItemId);
    renderAll();
    scrollSelectionIntoView({ center: !!options.routeTarget });
    return detail;
  }

  async function openItemDetailModal(itemId = state.detail?.item?.item_id, options = {}) {
    const detail = options.detail || await loadItemDetail(itemId, options);
    if (!detail?.item?.item_id) return false;
    const item = detail.item || {};
    state.detailModalOpen = true;
    renderAll();
    const dialog = openDialog('Edit Item', itemDetailHtml(detail, {
      prefix: 'kanban-modal-detail',
      layout: isCompactDetailLayout() ? 'accordion' : 'tabs',
    }), {
      badge: 'ITEM',
      id: 'kanban-detail-modal',
      width: '100vw',
      onClose: () => {
        state.detailModalOpen = false;
        if (!state.detailPanelOpen) {
          state.routeDetailItemId = '';
          writeRouteState(state.currentParentId, '');
        }
        renderAll();
      },
    });
    if (options.routeTarget) dialog.setAttribute('data-kanban-route-target', 'true');
    window.requestAnimationFrame(() => dialog.querySelector('[data-kanban-detail-field="title"]')?.focus());
    return true;
  }

  async function openItemDetail(itemId = state.selection?.item?.item_id, options = {}) {
    const detail = await loadItemDetail(itemId, options);
    if (!detail?.item?.item_id) return false;
    if (!options.forceModal && activateKanbanPanelTab('edit-item')) {
      state.detailPanelOpen = true;
      window.requestAnimationFrame(() => {
        document.querySelector('[data-personal-filter-host][data-personal-filter-surface="kanban"] [data-kanban-detail-field="title"]')?.focus();
      });
      return true;
    }
    return openItemDetailModal(detail.item.item_id, { ...options, detail });
  }

  async function openItemById(itemId) {
    const cleanItemId = cleanRouteId(itemId);
    if (!cleanItemId) return false;
    state.routeDetailItemId = cleanItemId;
    state.routeHighlightItemId = cleanItemId;
    writeRouteState(state.currentParentId, cleanItemId);
    if (!state.loaded) {
      await load({ force: false });
      return state.detail?.item?.item_id === cleanItemId || state.routeDetailItemId === cleanItemId;
    }
    return openItemDetail(cleanItemId, { routeTarget: true });
  }

  function itemRouteUrl(itemId) {
    const cleanItemId = cleanRouteId(itemId);
    if (!cleanItemId || !window.location) return '';
    const url = new URL(window.location.href);
    url.searchParams.set('group', 'kanban');
    url.searchParams.set('tab', 'kanban');
    url.searchParams.set('detail_item_id', cleanItemId);
    url.searchParams.delete('parent_item_id');
    url.searchParams.delete('scoped_kind');
    url.searchParams.delete('scoped_item_id');
    url.searchParams.delete('scoped_scope');
    url.searchParams.delete('scoped_view');
    return `${url.pathname}${url.search}${url.hash || ''}`;
  }

  async function loadScoped(kind, itemId, scope = 'descendants', view = 'grouped') {
    const config = scopedKindConfig(kind);
    const params = new URLSearchParams({ scope, view });
    return requestJson(`/api/v1/personal/work/items/${encodeURIComponent(itemId)}/${config.endpoint}?${params.toString()}`);
  }

  async function saveScopedRecord(config, record, row, statusOverride = '') {
    const id = scopedRecordId(record, config);
    const status = statusOverride || row.querySelector('[data-kanban-scoped-field="status"]')?.value || record.status || 'open';
    const priority = row.querySelector('[data-kanban-scoped-field="priority"]')?.value || record.priority_id || record.severity_id || 'medium';
    const payload = {
      item_id: record.item_id,
      title: record.title || id,
      body: record.body_excerpt || '',
      status,
      priority_id: priority,
      actor: 'blueprints-ui',
      source_surface: 'kanban-scoped',
      request_id: `ui-kanban-scoped-${config.kind}-${Date.now()}`,
    };
    if (config.kind === 'issues') {
      payload.severity_id = priority;
      payload.source_ref = record.source_ref || '';
      payload.related_task_id = record.related_task_id || '';
    } else {
      payload.due_at = record.due_at || null;
      payload.related_task_id = record.related_task_id || '';
    }
    const resp = await requestJson(`/api/v1/personal/work/${config.endpoint}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    state.lastWrite = {
      ...state.lastWrite,
      [config.kind === 'issues' ? 'issue' : 'todo']: resp[config.kind === 'issues' ? 'issue' : 'todo'],
    };
    return resp;
  }

  async function promoteScopedRecord(config, record) {
    const id = scopedRecordId(record, config);
    const resp = await requestJson('/api/v1/personal/work/promote', {
      method: 'POST',
      body: JSON.stringify({
        source_ref: `${config.sourcePrefix}:${id}`,
        title: record.title || id,
        body: record.body_excerpt || '',
        parent_item_id: record.item_id || state.scoped.itemId || state.currentParentId || null,
        state_id: 'todo',
        priority_id: record.priority_id || record.severity_id || 'medium',
        actor: 'blueprints-ui',
        source_surface: 'kanban-scoped',
        request_id: `ui-kanban-scoped-promote-${Date.now()}`,
      }),
    });
    state.lastWrite = {
      ...state.lastWrite,
      item: resp.item,
      promoted_item_id: resp.item?.item_id || '',
    };
    return resp;
  }

  async function openScoped(kind, itemId = state.selection?.item?.item_id, options = {}) {
    if (!itemId) return false;
    const config = scopedKindConfig(kind);
    const scope = options.scope || state.scoped.scope || 'descendants';
    const view = options.view || state.scoped.view || 'grouped';
    const data = await loadScoped(config.kind, itemId, scope, view);
    state.scoped = {
      open: true,
      kind: config.kind,
      itemId,
      scope: data.scope || scope,
      view: data.view || view,
      data,
    };
    writeRouteState(state.currentParentId, '', {
      kind: config.kind,
      itemId,
      scope: data.scope || scope,
      view: data.view || view,
    });
    const dialog = openDialog(`${config.plural} Scope`, scopedModalHtml(data, config), {
      badge: config.badge,
      id: 'kanban-scoped-modal',
      width: 'min(980px,96vw)',
      onClose: () => {
        state.scoped.open = false;
        writeRouteState(state.currentParentId, '');
        renderAll();
      },
    });
    dialog.addEventListener('click', async event => {
      const scopedAction = event.target.closest('[data-kanban-scoped-action]');
      if (scopedAction) {
        const action = scopedAction.dataset.kanbanScopedAction;
        if (action === 'create') {
          closeDialog(dialog);
          await openLeafForm(config.createKind, itemId);
          return;
        }
        const nextScope = action === 'scope-local'
          ? 'local'
          : (action === 'scope-descendants' ? 'descendants' : state.scoped.scope);
        const nextView = action === 'view-flat'
          ? 'flat'
          : (action === 'view-grouped' ? 'grouped' : state.scoped.view);
        closeDialog(dialog);
        await openScoped(config.kind, itemId, { scope: nextScope, view: nextView });
        return;
      }
      const rowAction = event.target.closest('[data-kanban-scoped-row-action]');
      if (!rowAction) return;
      const row = rowAction.closest('[data-kanban-scoped-row]');
      const record = findScopedRecord(config.kind, row?.dataset?.kanbanScopedId || '');
      if (!record || !row) return;
      const action = rowAction.dataset.kanbanScopedRowAction;
      if (action === 'save') {
        await saveScopedRecord(config, record, row);
      } else if (action === 'archive') {
        await saveScopedRecord(config, record, row, 'archived');
      } else if (action === 'promote') {
        await promoteScopedRecord(config, record);
      }
      closeDialog(dialog);
      await load({ force: true });
      await openScoped(config.kind, itemId, { scope: state.scoped.scope, view: state.scoped.view });
    });
    renderAll();
    return true;
  }

  async function openChildBoard(itemId = state.selection?.item?.item_id) {
    if (!itemId) return false;
    const item = findItem(itemId) || state.selection?.item || state.detail?.item;
    state.parentStack.push({ item_id: state.currentParentId, label: state.board?.parent?.title || 'Root' });
    state.currentParentId = itemId;
    state.selection = item ? { item } : null;
    state.detail = null;
    state.detailModalOpen = false;
    state.routeDetailItemId = '';
    state.routeHighlightItemId = '';
    writeRouteState(itemId, '');
    setFsm('idle', 'openChildBoard', itemId);
    await load({ force: true });
    return true;
  }

  async function navigateToBoard(parentItemId = '') {
    state.currentParentId = parentItemId || '';
    state.selection = null;
    state.detail = null;
    state.detailModalOpen = false;
    state.routeDetailItemId = '';
    state.routeHighlightItemId = '';
    writeRouteState(state.currentParentId, '');
    setFsm('idle', parentItemId ? 'openBreadcrumbBoard' : 'openRootBoard', parentItemId || '');
    await load({ force: true });
    return true;
  }

  async function openUpBoard() {
    if (!state.currentParentId) return openRootBoard();
    const crumbs = currentBreadcrumbs();
    if (crumbs.length <= 1) return openRootBoard();
    const parent = crumbs[crumbs.length - 2];
    return navigateToBoard(parent?.item_id || '');
  }

  async function openRootBoard() {
    state.parentStack = [];
    return navigateToBoard('');
  }

  function siblingState(item, direction) {
    const rows = stateRows();
    const index = rows.findIndex(row => row.state_id === item.state_id);
    const target = rows[index + direction];
    return target ? target.state_id : '';
  }

  async function moveSelected(direction) {
    const item = state.selection?.item;
    if (!item) {
      await HubDialogs.alert({ title: 'Kanban', message: 'Select a card first.', tone: 'warning' });
      return false;
    }
    const targetState = siblingState(item, direction);
    if (!targetState) return false;
    await moveItem(item.item_id, targetState);
    return true;
  }

  async function moveItem(itemId, targetState) {
    const item = findItem(itemId);
    if (!item || !targetState) return false;
    setFsm('pendingMove', 'move', itemId);
    renderAll();
    try {
      const resp = await requestJson(`/api/v1/personal/work/items/${encodeURIComponent(itemId)}/move`, {
        method: 'POST',
        body: JSON.stringify({
          parent_item_id: state.currentParentId || null,
          state_id: targetState,
          sort_order: item.sort_order || 0,
          actor: 'blueprints-ui',
          source_surface: 'kanban-page',
          request_id: `ui-kanban-move-${Date.now()}`,
        }),
      });
      state.lastWrite = resp;
      setFsm('selected', 'moveAccepted', itemId);
      await load({ force: true });
      setSelection(itemId);
      return true;
    } catch (error) {
      setFsm('selected', 'moveRejected', itemId);
      state.error = error.message || String(error);
      renderAll();
      await HubDialogs.alert({ title: 'Move rejected', message: state.error, tone: 'danger' });
      return false;
    }
  }

  async function orderItem(itemId, direction) {
    const cleanDirection = direction === 'up' ? 'up' : 'down';
    const item = findItem(itemId);
    if (!item) return false;
    setFsm('pendingMove', `order-${cleanDirection}`, itemId);
    renderAll();
    try {
      const resp = await requestJson(`/api/v1/personal/work/items/${encodeURIComponent(itemId)}/order`, {
        method: 'POST',
        body: JSON.stringify({
          direction: cleanDirection,
          actor: 'blueprints-ui',
          source_surface: 'kanban-page',
          request_id: `ui-kanban-order-${cleanDirection}-${Date.now()}`,
        }),
      });
      state.lastWrite = resp;
      setFsm('selected', 'orderAccepted', itemId);
      await load({ force: true });
      setSelection(itemId);
      return true;
    } catch (error) {
      setFsm('selected', 'orderRejected', itemId);
      state.error = error.message || String(error);
      renderAll();
      await HubDialogs.alert({ title: 'Order rejected', message: state.error, tone: 'danger' });
      return false;
    }
  }

  async function archiveSelected() {
    const item = state.selection?.item;
    if (!item) {
      await HubDialogs.alert({ title: 'Kanban', message: 'Select a card first.', tone: 'warning' });
      return false;
    }
    const ok = await HubDialogs.confirm({
      title: 'Archive Work Item',
      message: item.title || item.item_id,
      confirmText: 'Archive',
      tone: 'warning',
    });
    if (!ok) return false;
    const resp = await requestJson(`/api/v1/personal/work/items/${encodeURIComponent(item.item_id)}/archive`, {
      method: 'POST',
      body: JSON.stringify({
        actor: 'blueprints-ui',
        source_surface: 'kanban-page',
        request_id: `ui-kanban-archive-${Date.now()}`,
      }),
    });
    state.lastWrite = resp;
    state.selection = null;
    setFsm('idle', 'archiveAccepted');
    await load({ force: true });
    return true;
  }

  async function runStep18ProofWrite() {
    await load({ force: true });
    const stamp = Date.now();
    const parentResp = await requestJson('/api/v1/personal/work/items', {
      method: 'POST',
      body: JSON.stringify({
        item_id: `work-step18-parent-${stamp}`,
        parent_item_id: null,
        title: `Step 18 Active Browser parent ${stamp}`,
        body: 'Active Browser proof parent for child board and detail edit.',
        state_id: 'todo',
        priority_id: 'medium',
        tags: ['proof', 'step-18'],
        actor: 'active-browser',
        source_surface: 'kanban-active-browser-proof',
        request_id: `active-browser-step18-parent-${stamp}`,
      }),
    });
    const parentId = parentResp.item?.item_id;
    const childResp = await requestJson('/api/v1/personal/work/items', {
      method: 'POST',
      body: JSON.stringify({
        item_id: `work-step18-child-${stamp}`,
        parent_item_id: parentId,
        title: `Step 18 Active Browser child ${stamp}`,
        body: 'Direct child proof item created through Kanban automation.',
        state_id: 'todo',
        priority_id: 'high',
        tags: ['proof', 'step-18', 'child'],
        actor: 'active-browser',
        source_surface: 'kanban-active-browser-proof',
        request_id: `active-browser-step18-child-${stamp}`,
      }),
    });
    const linkResp = await requestJson(`/api/v1/personal/work/items/${encodeURIComponent(parentId)}/links`, {
      method: 'POST',
      body: JSON.stringify({
        target_item_id: childResp.item?.item_id,
        link_type: 'related',
        metadata: { proof_step: 18, source: 'active-browser' },
        actor: 'active-browser',
        source_surface: 'kanban-active-browser-proof',
        request_id: `active-browser-step18-link-${stamp}`,
      }),
    });
    const blockerResp = await requestJson('/api/v1/personal/work/blockers', {
      method: 'POST',
      body: JSON.stringify({
        blocker_id: `blocker-step18-${stamp}`,
        item_id: parentId,
        title: `Step 18 Active Browser blocker ${stamp}`,
        body: 'Blocker proof row for the item detail blocker panel.',
        blocked_by_ref: `work_items:${childResp.item?.item_id || ''}`,
        actor: 'active-browser',
        source_surface: 'kanban-active-browser-proof',
        request_id: `active-browser-step18-blocker-${stamp}`,
      }),
    });
    const updatedResp = await requestJson(`/api/v1/personal/work/items/${encodeURIComponent(parentId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: `Step 18 Active Browser parent edited ${stamp}`,
        body: 'Detail edit proof completed through Kanban automation.',
        state_id: 'doing',
        priority_id: 'high',
        actor: 'active-browser',
        source_surface: 'kanban-active-browser-proof',
        request_id: `active-browser-step18-edit-${stamp}`,
      }),
    });
    state.lastWrite = {
      ...updatedResp,
      link: linkResp.link,
      blocker: blockerResp.blocker,
      child_item: childResp.item,
    };
    await load({ force: true });
    setSelection(updatedResp.item?.item_id || parentId);
    await openItemDetail(updatedResp.item?.item_id || parentId);
    return true;
  }

  async function runStep19ProofWrite() {
    await load({ force: true });
    const stamp = Date.now();
    const parentResp = await requestJson('/api/v1/personal/work/items', {
      method: 'POST',
      body: JSON.stringify({
        item_id: `work-step19-parent-${stamp}`,
        parent_item_id: null,
        title: `Step 19 Active Browser parent ${stamp}`,
        body: 'Scoped issue and todo proof parent.',
        state_id: 'todo',
        priority_id: 'medium',
        tags: ['proof', 'step-19'],
        actor: 'active-browser',
        source_surface: 'kanban-active-browser-proof',
        request_id: `active-browser-step19-parent-${stamp}`,
      }),
    });
    const parentId = parentResp.item?.item_id;
    const childResp = await requestJson('/api/v1/personal/work/items', {
      method: 'POST',
      body: JSON.stringify({
        item_id: `work-step19-child-${stamp}`,
        parent_item_id: parentId,
        title: `Step 19 Active Browser child ${stamp}`,
        body: 'First nested item for scoped filters.',
        state_id: 'doing',
        priority_id: 'high',
        tags: ['proof', 'step-19', 'child'],
        actor: 'active-browser',
        source_surface: 'kanban-active-browser-proof',
        request_id: `active-browser-step19-child-${stamp}`,
      }),
    });
    const childId = childResp.item?.item_id;
    const grandchildResp = await requestJson('/api/v1/personal/work/items', {
      method: 'POST',
      body: JSON.stringify({
        item_id: `work-step19-grandchild-${stamp}`,
        parent_item_id: childId,
        title: `Step 19 Active Browser grandchild ${stamp}`,
        body: 'Second nested item for scoped filters.',
        state_id: 'blocked',
        priority_id: 'critical',
        tags: ['proof', 'step-19', 'grandchild'],
        actor: 'active-browser',
        source_surface: 'kanban-active-browser-proof',
        request_id: `active-browser-step19-grandchild-${stamp}`,
      }),
    });
    const grandchildId = grandchildResp.item?.item_id;
    const localIssueResp = await requestJson('/api/v1/personal/work/issues', {
      method: 'POST',
      body: JSON.stringify({
        issue_id: `issue-step19-local-${stamp}`,
        item_id: parentId,
        title: `Step 19 local issue ${stamp}`,
        body: 'Local scoped issue proof.',
        severity_id: 'medium',
        actor: 'active-browser',
        source_surface: 'kanban-active-browser-proof',
        request_id: `active-browser-step19-local-issue-${stamp}`,
      }),
    });
    const childIssueResp = await requestJson('/api/v1/personal/work/issues', {
      method: 'POST',
      body: JSON.stringify({
        issue_id: `issue-step19-child-${stamp}`,
        item_id: childId,
        title: `Step 19 child issue ${stamp}`,
        body: 'Descendant scoped issue proof.',
        severity_id: 'high',
        actor: 'active-browser',
        source_surface: 'kanban-active-browser-proof',
        request_id: `active-browser-step19-child-issue-${stamp}`,
      }),
    });
    const updatedIssueResp = await requestJson(`/api/v1/personal/work/issues/${encodeURIComponent(childIssueResp.issue?.issue_id || '')}`, {
      method: 'PATCH',
      body: JSON.stringify({
        item_id: childId,
        title: childIssueResp.issue?.title || `Step 19 child issue ${stamp}`,
        body: 'Descendant scoped issue proof updated before promotion.',
        status: 'blocked',
        severity_id: 'critical',
        actor: 'active-browser',
        source_surface: 'kanban-active-browser-proof',
        request_id: `active-browser-step19-child-issue-update-${stamp}`,
      }),
    });
    const todoResp = await requestJson('/api/v1/personal/work/todos', {
      method: 'POST',
      body: JSON.stringify({
        todo_id: `todo-step19-grandchild-${stamp}`,
        item_id: grandchildId,
        title: `Step 19 grandchild todo ${stamp}`,
        body: 'Two-level scoped todo proof.',
        priority_id: 'high',
        related_task_id: `task-step19-${stamp}`,
        actor: 'active-browser',
        source_surface: 'kanban-active-browser-proof',
        request_id: `active-browser-step19-grandchild-todo-${stamp}`,
      }),
    });
    const updatedTodoResp = await requestJson(`/api/v1/personal/work/todos/${encodeURIComponent(todoResp.todo?.todo_id || '')}`, {
      method: 'PATCH',
      body: JSON.stringify({
        item_id: grandchildId,
        title: todoResp.todo?.title || `Step 19 grandchild todo ${stamp}`,
        body: 'Two-level scoped todo proof updated before promotion.',
        status: 'active',
        priority_id: 'critical',
        related_task_id: `task-step19-${stamp}`,
        actor: 'active-browser',
        source_surface: 'kanban-active-browser-proof',
        request_id: `active-browser-step19-grandchild-todo-update-${stamp}`,
      }),
    });
    const promotedIssueResp = await requestJson('/api/v1/personal/work/promote', {
      method: 'POST',
      body: JSON.stringify({
        source_ref: `work_issues:${updatedIssueResp.issue?.issue_id || childIssueResp.issue?.issue_id}`,
        title: `Promoted Step 19 issue ${stamp}`,
        parent_item_id: childId,
        priority_id: 'critical',
        actor: 'active-browser',
        source_surface: 'kanban-active-browser-proof',
        request_id: `active-browser-step19-promote-issue-${stamp}`,
      }),
    });
    const promotedTodoResp = await requestJson('/api/v1/personal/work/promote', {
      method: 'POST',
      body: JSON.stringify({
        source_ref: `work_todos:${updatedTodoResp.todo?.todo_id || todoResp.todo?.todo_id}`,
        title: `Promoted Step 19 todo ${stamp}`,
        parent_item_id: grandchildId,
        priority_id: 'high',
        actor: 'active-browser',
        source_surface: 'kanban-active-browser-proof',
        request_id: `active-browser-step19-promote-todo-${stamp}`,
      }),
    });
    state.lastWrite = {
      item: promotedTodoResp.item || promotedIssueResp.item || parentResp.item,
      issue: updatedIssueResp.issue || childIssueResp.issue || localIssueResp.issue,
      todo: updatedTodoResp.todo || todoResp.todo,
      source_item: parentResp.item,
      child_item: childResp.item,
      grandchild_item: grandchildResp.item,
      promoted_issue_item: promotedIssueResp.item,
      promoted_todo_item: promotedTodoResp.item,
    };
    state.currentParentId = '';
    state.routeDetailItemId = '';
    writeRouteState('', '');
    await load({ force: true });
    setSelection(parentId);
    await openScoped('issues', parentId, { scope: 'descendants', view: 'grouped' });
    return true;
  }

  async function safeChecks() {
    openDialog('Kanban Safe Checks', `
      <div class="kanban-detail-list">
        ${detailRow('Board API', state.currentParentId ? 'child board' : 'root board', state.loaded ? 'ready' : 'not loaded')}
        ${detailRow('Columns', String(state.board?.columns?.length || 0), 'configured states')}
        ${detailRow('Breadcrumbs', String(currentBreadcrumbs().length), currentBreadcrumbs().map(item => item.title || item.item_id).join(' / ') || 'root')}
        ${detailRow('Depth Remaining', String(state.board?.remaining_depth ?? depthLimit()), state.currentParentId || 'root')}
        ${detailRow('Selection', state.selection?.item?.item_id || 'none', state.cardFsm.state)}
        ${detailRow('Detail', state.detail?.item?.item_id || 'none', state.detailModalOpen ? 'open' : 'closed')}
        ${detailRow('Test Entries', showTestEntries() ? 'shown' : 'hidden', `${hiddenTestEntryCount()} hidden - ${state.refreshFsm.state}`)}
        ${detailRow('Body Shade', document.querySelector('#tab-kanban .body-shade-handle') ? 'present' : 'missing', 'managed-scroll tab')}
      </div>`, { badge: 'SAFE', id: 'kanban-safe-checks-modal' });
    return true;
  }

  function registerSharedPanels() {
    if (window.PersonalFilters?.registerSurface) {
      window.PersonalFilters.registerSurface('kanban', {
        getRecords: () => rawBoardItems().map(itemFilterRecord),
        summaryPrefix: 'Filter:',
        activePrefix: 'Filter',
        emptyLabel: 'all cards',
        clearLabel: 'All cards',
        extraTabs: [
          { id: 'selected', label: 'Selected' },
          { id: 'search', label: 'Search' },
          { id: 'new-item', label: 'New Item' },
          { id: 'edit-item', label: 'Edit Item', disabled: () => !detailItemAvailable() },
          { id: 'provenance', label: 'Provenance' },
        ],
        renderTab: (tab, host) => {
          if (tab === 'selected') return embeddedSelectedHtml(host);
          if (tab === 'search') return embeddedSearchHtml(host);
          if (tab === 'new-item') return embeddedItemFormHtml(host?.id === 'kanban-filter-inline-panel' ? 'kanban-inline-item' : 'kanban-panel-item');
          if (tab === 'edit-item') return embeddedItemDetailHtml(host);
          if (tab === 'provenance') return embeddedProvenanceHtml(host);
          return '';
        },
        onChange: () => {
          state.selection = null;
          renderAll();
        },
      });
      window.PersonalFilters.registerSurface('kanban-search', {
        getRecords: () => rawBoardItems().map(itemFilterRecord),
        summaryPrefix: 'Filter:',
        activePrefix: 'Filter',
        emptyLabel: 'all entries',
        clearLabel: 'All entries',
      });
      window.PersonalFilters.registerSurface(NEW_ITEM_TAG_SURFACE, {
        getRecords: () => rawBoardItems().map(itemFilterRecord),
        defaultSelectedIds: ITEM_REQUIRED_TAGS,
        requiredSelectedIds: ITEM_REQUIRED_TAGS,
        summaryPrefix: 'Tags:',
        activePrefix: 'Selected',
        emptyLabel: 'Kanban',
        onChange: () => {
          renderItemTagSummaries();
        },
      });
      window.PersonalFilters.registerSurface(EDIT_ITEM_TAG_SURFACE, {
        getRecords: () => rawBoardItems().map(itemFilterRecord),
        defaultSelectedIds: ITEM_REQUIRED_TAGS,
        requiredSelectedIds: ITEM_REQUIRED_TAGS,
        summaryPrefix: 'Tags:',
        activePrefix: 'Selected',
        emptyLabel: 'Kanban',
        onChange: () => {
          syncEditItemDraftTagsFromSurface();
          renderItemTagSummaries();
        },
      });
    }
    if (window.BlueprintsPersonalSearch?.registerSurface) {
      window.BlueprintsPersonalSearch.registerSurface('kanban', {
        filterSurface: 'kanban-search',
        rangeControls: true,
      });
    }
  }

  function hostIsVisible(node) {
    if (!node || !node.isConnected) return false;
    const style = window.getComputedStyle ? window.getComputedStyle(node) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    const rect = typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null;
    return !rect || (rect.width > 0 && rect.height > 0);
  }

  function newRootItem() {
    const host = el('kanban-filter-inline-panel');
    if (hostIsVisible(host) && window.PersonalFilters?.activateTab) {
      window.PersonalFilters.activateTab('kanban', 'new-item', { host, visibleOnly: false });
      window.requestAnimationFrame(() => el('kanban-inline-item-title')?.focus());
      return true;
    }
    return openItemForm({ parentItemId: state.currentParentId });
  }

  function handleCardAction(action, itemId, stateId = '') {
    if (action === 'add-child') return openItemForm({ parentItemId: itemId, stateId: 'todo', childOfSelection: true });
    if (action === 'add-issue') return openLeafForm('issue', itemId);
    if (action === 'add-todo') return openLeafForm('todo', itemId);
    if (action === 'open-detail') {
      setSelection(itemId);
      return openItemDetail(itemId);
    }
    if (action === 'open-child-board') return openChildBoard(itemId);
    if (action === 'order-up') {
      setSelection(itemId);
      return orderItem(itemId, 'up');
    }
    if (action === 'order-down') {
      setSelection(itemId);
      return orderItem(itemId, 'down');
    }
    if (action === 'move-left') {
      setSelection(itemId);
      return moveSelected(-1);
    }
    if (action === 'move-right') {
      setSelection(itemId);
      return moveSelected(1);
    }
    if (action === 'archive') {
      setSelection(itemId);
      return archiveSelected();
    }
    if (action === 'add-item-state') return openItemForm({ parentItemId: state.currentParentId, stateId });
    return false;
  }

  function closeDetailModalIfOpen() {
    const dialog = el('kanban-detail-modal');
    if (dialog?.open) closeDialog(dialog);
  }

  function renderOpenDetailModal() {
    const dialog = el('kanban-detail-modal');
    const body = dialog?.querySelector?.('.hub-modal-body');
    if (!dialog?.open || !body || !state.detail?.item?.item_id) return false;
    body.innerHTML = itemDetailHtml(state.detail, {
      prefix: 'kanban-modal-detail',
      layout: isCompactDetailLayout() ? 'accordion' : 'tabs',
    });
    return true;
  }

  function refreshDetailSurfaces() {
    refreshActiveDetailPanels();
    renderOpenDetailModal();
    scheduleDetailLayoutRefresh();
  }

  function scheduleDetailLayoutRefresh() {
    window.requestAnimationFrame(() => {
      document.querySelectorAll('.kanban-detail-section').forEach(section => {
        section.style.minHeight = '';
      });
      window.dispatchEvent(new Event('resize'));
    });
  }

  function cancelRefreshLongPress(eventName = 'cancel') {
    if (refreshLongPressTimer) {
      window.clearTimeout(refreshLongPressTimer);
      refreshLongPressTimer = null;
    }
    if (refreshLongPressButton) {
      refreshLongPressButton.classList.remove('is-long-pressing');
      refreshLongPressButton = null;
    }
    if (state.refreshFsm.state === 'pressing') setRefreshFsm('idle', eventName);
  }

  function startRefreshLongPress(event, button) {
    if (!button || (event.pointerType === 'mouse' && event.button !== 0)) return;
    cancelRefreshLongPress('restart');
    refreshLongPressButton = button;
    refreshLongPressButton.classList.add('is-long-pressing');
    setRefreshFsm('pressing', 'pointerdown');
    button.setPointerCapture?.(event.pointerId);
    refreshLongPressTimer = window.setTimeout(async () => {
      refreshLongPressTimer = null;
      refreshSuppressClickUntil = Date.now() + 900;
      if (refreshLongPressButton) {
        refreshLongPressButton.classList.remove('is-long-pressing');
        refreshLongPressButton = null;
      }
      await toggleTestEntriesVisibility({
        source_surface: 'kanban-refresh-long-press',
      });
    }, REFRESH_LONG_PRESS_MS);
  }

  async function handleDetailAction(button) {
    const action = button?.dataset?.kanbanDetailAction || '';
    if (!action) return false;
    const workspace = button.closest?.('.kanban-detail-workspace') || el('kanban-detail-modal') || document;
    const itemId = workspace?.dataset?.kanbanDetailItemId || state.detail?.item?.item_id || state.selection?.item?.item_id || '';
    if (action === 'toggle-markdown-preview') {
      toggleMarkdownPreview(button, workspace);
      return true;
    }
    if (action === 'section') {
      syncDetailDraftFromScope(workspace);
      state.detailSection = button.dataset.kanbanDetailSection || 'info';
      refreshDetailSurfaces();
      scheduleDetailLayoutRefresh();
      return true;
    }
    if (action === 'fullscreen') {
      syncDetailDraftFromScope(workspace);
      await openItemDetailModal(itemId, { forceModal: true, preserveRouteTarget: true });
      return true;
    }
    if (action === 'save') {
      await saveDetail(itemId, {
        scope: workspace,
        statusEl: workspace.querySelector?.('[data-kanban-detail-status]') || null,
      });
      refreshDetailSurfaces();
      return true;
    }
    if (action === 'save-detail-doc') {
      await saveDetailDocument(itemId, {
        scope: workspace,
        statusEl: workspace.querySelector?.('[data-kanban-detail-document-status]') || null,
      });
      return true;
    }
    if (action === 'edit-discussions') {
      syncDetailDraftFromScope(workspace);
      state.discussionEditMode = !state.discussionEditMode;
      refreshDetailSurfaces();
      return true;
    }
    if (action === 'save-discussions') {
      await saveDiscussions(itemId, {
        scope: workspace,
        statusEl: workspace.querySelector?.('[data-kanban-discussion-batch-status]') || null,
      });
      return true;
    }
    if (action === 'delete-discussions') {
      await deleteMarkedDiscussions({
        scope: workspace,
        statusEl: workspace.querySelector?.('[data-kanban-discussion-batch-status]') || null,
      });
      return true;
    }
    if (!itemId) return false;
    if (action === 'child-board') {
      closeDetailModalIfOpen();
      await openChildBoard(itemId);
      return true;
    }
    if (action === 'add-child') {
      closeDetailModalIfOpen();
      await openItemForm({ parentItemId: itemId, childOfSelection: true });
      return true;
    }
    if (action === 'add-link') {
      closeDetailModalIfOpen();
      await openLinkForm(itemId);
      return true;
    }
    if (action === 'add-blocker') {
      closeDetailModalIfOpen();
      await openBlockerForm(itemId);
      return true;
    }
    return false;
  }

  function handleDetailFieldEvent(event) {
    const field = event.target?.closest?.('[data-kanban-detail-field]');
    if (!field) return;
    if (!updateDetailDraftFromField(field)) return;
    syncDetailDraftFields(field);
  }

  function startLaneResize(event, handle) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const column = handle.closest('.kanban-column');
    if (!column) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = column.getBoundingClientRect().width || readLaneWidth(column.dataset.kanbanStateId) || 236;
    handle.classList.add('is-grabbing');
    document.body.classList.add('is-resizing-kanban-lane');
    handle.setPointerCapture?.(event.pointerId);

    const onMove = moveEvent => {
      moveEvent.preventDefault();
      applyLaneWidth(column, startWidth + (moveEvent.clientX - startX), false);
    };
    const onEnd = () => {
      handle.classList.remove('is-grabbing');
      document.body.classList.remove('is-resizing-kanban-lane');
      applyLaneWidth(column, column.getBoundingClientRect().width, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  }

  function handleLaneWidthKeydown(event, handle) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return false;
    const column = handle.closest('.kanban-column');
    if (!column) return false;
    event.preventDefault();
    event.stopPropagation();
    const current = column.getBoundingClientRect().width || readLaneWidth(column.dataset.kanbanStateId) || 236;
    if (event.key === 'ArrowLeft') applyLaneWidth(column, current - LANE_WIDTH_STEP, true);
    if (event.key === 'ArrowRight') applyLaneWidth(column, current + LANE_WIDTH_STEP, true);
    if (event.key === 'Home') applyLaneWidth(column, LANE_WIDTH_MIN, true);
    if (event.key === 'End') applyLaneWidth(column, LANE_WIDTH_MAX, true);
    return true;
  }

  function bind() {
    const root = document.querySelector('[data-kanban-board]');
    if (!root || root.dataset.kanbanBound === '1') return;
    root.dataset.kanbanBound = '1';
    registerSharedPanels();
    root.addEventListener('pointerdown', event => {
      const refreshButton = event.target.closest('[data-kanban-action="refresh"]');
      if (refreshButton) startRefreshLongPress(event, refreshButton);
      const handle = event.target.closest('[data-kanban-lane-width-handle]');
      if (handle) startLaneResize(event, handle);
    });
    root.addEventListener('pointerup', () => cancelRefreshLongPress('pointerup'));
    root.addEventListener('pointercancel', () => cancelRefreshLongPress('pointercancel'));
    el('kanban-board-shell')?.addEventListener('scroll', resetBoardVerticalOffset, { passive: true });
    root.addEventListener('input', handleDetailFieldEvent);
    root.addEventListener('change', handleDetailFieldEvent);
    root.addEventListener('click', event => {
      if (event.target.closest('[data-kanban-lane-width-handle]')) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const button = event.target.closest('[data-kanban-action]');
      if (button) {
        const action = button.dataset.kanbanAction;
        if (action === 'refresh') {
          event.preventDefault();
          cancelRefreshLongPress('click');
          if (Date.now() >= refreshSuppressClickUntil) load({ force: true });
        }
        if (action === 'up-board') openUpBoard();
        if (action === 'root-board') openRootBoard();
        if (action === 'new-root-item') newRootItem();
        if (action === 'add-item-state') handleCardAction('add-item-state', '', button.dataset.kanbanStateId || 'todo');
        if (action === 'submit-inline-item') submitInlineItem(button.dataset.kanbanItemPrefix || 'kanban-inline-item');
        if (action === 'toggle-markdown-preview') toggleMarkdownPreview(button, root);
        return;
      }
      const detailButton = event.target.closest('[data-kanban-detail-action]');
      if (detailButton) {
        event.preventDefault();
        event.stopPropagation();
        handleDetailAction(detailButton);
        return;
      }
      const breadcrumb = event.target.closest('[data-kanban-breadcrumb]');
      if (breadcrumb) {
        navigateToBoard(breadcrumb.dataset.kanbanBreadcrumb || '');
        return;
      }
      const cardButton = event.target.closest('[data-kanban-card-action]');
      if (cardButton) {
        event.stopPropagation();
        handleCardAction(cardButton.dataset.kanbanCardAction, cardButton.dataset.kanbanItemId || '');
        return;
      }
      const pill = event.target.closest('[data-kanban-pill]');
      if (pill) {
        event.stopPropagation();
        const itemId = pill.dataset.kanbanItemId || '';
        if (pill.dataset.kanbanPill === 'subitems') openChildBoard(itemId);
        if (pill.dataset.kanbanPill === 'issues') openScoped('issues', itemId);
        if (pill.dataset.kanbanPill === 'todos') openScoped('todos', itemId);
        return;
      }
      const card = event.target.closest('[data-kanban-item-id]');
      if (card) setSelection(card.dataset.kanbanItemId, { openDetail: true });
    });
    root.addEventListener('keydown', event => {
      const handle = event.target.closest('[data-kanban-lane-width-handle]');
      if (handle && handleLaneWidthKeydown(event, handle)) return;
      const card = event.target.closest('[data-kanban-item-id]');
      if (!card) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setSelection(card.dataset.kanbanItemId, { openDetail: true });
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setSelection(card.dataset.kanbanItemId);
        moveSelected(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setSelection(card.dataset.kanbanItemId);
        moveSelected(1);
      }
    });
    document.addEventListener('click', event => {
      const btn = event.target.closest('[data-kanban-action="submit-inline-item"]');
      if (!btn || root.contains(btn)) return;
      submitInlineItem(btn.dataset.kanbanItemPrefix || 'kanban-panel-item');
    });
    document.addEventListener('click', event => {
      const btn = event.target.closest('[data-kanban-action="toggle-markdown-preview"]');
      if (!btn || root.contains(btn)) return;
      event.preventDefault();
      toggleMarkdownPreview(btn, document);
    });
    document.addEventListener('click', event => {
      const btn = event.target.closest('[data-kanban-detail-action]');
      if (!btn || root.contains(btn)) return;
      event.preventDefault();
      handleDetailAction(btn);
    });
    document.addEventListener('input', event => {
      const field = event.target?.closest?.('[data-kanban-detail-field]');
      if (!field || root.contains(field)) return;
      handleDetailFieldEvent(event);
    });
    document.addEventListener('change', event => {
      const field = event.target?.closest?.('[data-kanban-detail-field]');
      if (!field || root.contains(field)) return;
      handleDetailFieldEvent(event);
    });
    window.addEventListener('resize', scheduleLaneRestore, { passive: true });
    window.addEventListener('orientationchange', scheduleLaneRestore, { passive: true });
    document.addEventListener('bodyshadechange', scheduleLaneRestore);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', scheduleLaneRestore, { passive: true });
    }
  }

  function snapshot() {
    const items = boardItems();
    const breadcrumbs = currentBreadcrumbs();
    const detail = state.detail || {};
    return {
      loaded: state.loaded,
      loading: state.loading,
      status: state.error ? 'error' : (state.loaded ? 'ready' : ''),
      current_parent_id: state.currentParentId,
      breadcrumb_depth: breadcrumbs.length,
      breadcrumb_labels: ['Root board', ...breadcrumbs.map(item => item.title || item.item_id)],
      column_count: state.board?.columns?.length || 0,
      item_count: items.length,
      selected_item_id: state.selection?.item?.item_id || '',
      selected_state: state.selection?.item?.state_id || '',
      route_detail_item_id: state.routeDetailItemId || '',
      route_highlight_item_id: state.routeHighlightItemId || '',
      detail_open: !!state.detailModalOpen,
      detail_item_id: detail.item?.item_id || '',
      detail_state: detail.item?.state_id || '',
      depth_remaining: detail.remaining_depth ?? state.board?.remaining_depth ?? 0,
      child_count: detail.counts?.children ?? (detail.children || []).length ?? 0,
      link_count: detail.counts?.links ?? (detail.links || []).length ?? 0,
      blocker_count: detail.counts?.blockers ?? (detail.blockers || []).length ?? 0,
      scoped_open: !!state.scoped.open,
      scoped_kind: state.scoped.kind || '',
      scoped_scope: state.scoped.scope || '',
      scoped_view: state.scoped.view || '',
      scoped_item_id: state.scoped.itemId || '',
      scoped_count: state.scoped.data?.counts?.total || 0,
      scoped_group_count: (state.scoped.data?.groups || []).length,
      last_write_item_id: state.lastWrite?.item?.item_id || '',
      last_write_issue_id: state.lastWrite?.issue?.issue_id || '',
      last_write_todo_id: state.lastWrite?.todo?.todo_id || '',
      last_promoted_issue_item_id: state.lastWrite?.promoted_issue_item?.item_id || '',
      last_promoted_todo_item_id: state.lastWrite?.promoted_todo_item?.item_id || '',
      last_write_link_id: state.lastWrite?.link?.link_id || '',
      last_write_blocker_id: state.lastWrite?.blocker?.blocker_id || '',
      card_fsm: { ...state.cardFsm },
      refresh_fsm: { ...state.refreshFsm },
      show_test_entries: showTestEntries(),
      hidden_test_entries: hiddenTestEntryCount(),
      rollup_total: state.board?.rollup?.items?.total || 0,
      issue_count: state.board?.rollup?.issues?.open || 0,
      todo_count: state.board?.rollup?.todos?.open || 0,
      error: state.error,
    };
  }

  bind();

  return {
    load,
    refresh: () => load({ force: true }),
    newRootItem,
    openRootBoard,
    openUpBoard,
    openSelectedChildBoard: () => openChildBoard(),
    openSelectedDetail: () => openItemDetail(),
    openItemById,
    itemRouteUrl,
    addChildToSelected: () => openItemForm({ parentItemId: state.selection?.item?.item_id, childOfSelection: true }),
    addIssueToSelected: () => state.selection?.item?.item_id ? openLeafForm('issue', state.selection.item.item_id) : false,
    addTodoToSelected: () => state.selection?.item?.item_id ? openLeafForm('todo', state.selection.item.item_id) : false,
    orderSelectedUp: () => state.selection?.item?.item_id ? orderItem(state.selection.item.item_id, 'up') : false,
    orderSelectedDown: () => state.selection?.item?.item_id ? orderItem(state.selection.item.item_id, 'down') : false,
    moveSelectedLeft: () => moveSelected(-1),
    moveSelectedRight: () => moveSelected(1),
    archiveSelected,
    setTestEntriesVisible,
    showTestEntries: () => setTestEntriesVisible(true, { source_surface: 'kanban-automation' }),
    hideTestEntries: () => setTestEntriesVisible(false, { source_surface: 'kanban-automation' }),
    toggleTestEntriesVisibility,
    runStep18ProofWrite,
    runStep19ProofWrite,
    openScopedIssues: () => openScoped('issues'),
    openScopedTodos: () => openScoped('todos'),
    safeChecks,
    snapshot,
  };
})();

window.BlueprintsKanbanBoardPage = KanbanBoardPage;

if (typeof KanbanMenuConfig !== 'undefined') {
  KanbanMenuConfig.registerFunctions({
    'kanban.refresh': () => KanbanBoardPage.refresh(),
    'kanban.newRootItem': () => KanbanBoardPage.newRootItem(),
    'kanban.openRootBoard': () => KanbanBoardPage.openRootBoard(),
    'kanban.openUpBoard': () => KanbanBoardPage.openUpBoard(),
    'kanban.openChildBoard': () => KanbanBoardPage.openSelectedChildBoard(),
    'kanban.openDetail': () => KanbanBoardPage.openSelectedDetail(),
    'kanban.addChild': () => KanbanBoardPage.addChildToSelected(),
    'kanban.addIssue': () => KanbanBoardPage.addIssueToSelected(),
    'kanban.addTodo': () => KanbanBoardPage.addTodoToSelected(),
    'kanban.orderUp': () => KanbanBoardPage.orderSelectedUp(),
    'kanban.orderDown': () => KanbanBoardPage.orderSelectedDown(),
    'kanban.moveLeft': () => KanbanBoardPage.moveSelectedLeft(),
    'kanban.moveRight': () => KanbanBoardPage.moveSelectedRight(),
    'kanban.archive': () => KanbanBoardPage.archiveSelected(),
    'kanban.toggleTestEntries': () => KanbanBoardPage.toggleTestEntriesVisibility({ source_surface: 'kanban-menu' }),
    'kanban.showTestEntries': () => KanbanBoardPage.showTestEntries(),
    'kanban.hideTestEntries': () => KanbanBoardPage.hideTestEntries(),
    'kanban.step18ProofWrite': () => KanbanBoardPage.runStep18ProofWrite(),
    'kanban.step19ProofWrite': () => KanbanBoardPage.runStep19ProofWrite(),
    'kanban.scopedIssues': () => KanbanBoardPage.openScopedIssues(),
    'kanban.scopedTodos': () => KanbanBoardPage.openScopedTodos(),
    'kanban.safeChecks': () => KanbanBoardPage.safeChecks(),
  });
}
