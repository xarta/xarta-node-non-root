// Kanban board page - recursive Kanban board over /personal/kanban APIs.

'use strict';

const KanbanBoardPage = (() => {
  const CONTENT_VIEW_STORAGE_KEY = 'blueprints.kanban.contentView.v1';
  const CONTENT_VIEW_IDS = ['board', 'search', 'selection', 'backups', 'automation', 'provenance'];
  const CONTENT_VIEW_LABELS = {
    board: 'Board',
    search: 'Search',
    selection: 'Selection',
    backups: 'Backups',
    automation: 'Automation',
    provenance: 'Provenance',
  };
  const LANE_WIDTH_STORAGE_PREFIX = 'blueprints.kanbanLaneWidth.v1';
  const LANE_WIDTH_MIN = 112;
  const LANE_WIDTH_MAX = 560;
  const LANE_WIDTH_STEP = 18;
  const REFRESH_LONG_PRESS_MS = 700;
  const CARD_DRAG_START_PX = 6;
  const CARD_DRAG_EDGE_PX = 22;
  const CARD_SHARE_CLICK_DELAY_MS = 220;
  const NEW_ITEM_TAG_SURFACE = 'kanban-new-item';
  const EDIT_ITEM_TAG_SURFACE = 'kanban-edit-item';
  const ITEM_REQUIRED_TAGS = ['kanban'];
  let laneRestoreTimer = null;
  let refreshLongPressTimer = null;
  let refreshLongPressButton = null;
  let refreshSuppressClickUntil = 0;
  let cardShareClickTimer = null;
  const cardDrag = {
    pointerId: null,
    itemId: '',
    startX: 0,
    startY: 0,
    active: false,
    sourceButton: null,
    ghost: null,
    target: { kind: '' },
    suppressClickUntil: 0,
    moveListener: null,
    endListener: null,
  };

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
    backups: {
      loading: false,
      error: '',
      data: null,
      lastResult: null,
      busyAction: '',
      applyingFilename: '',
    },
    automationStatus: {
      loading: false,
      error: '',
      data: null,
      lastLoadedAt: 0,
      lastResult: null,
      busyAction: '',
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
    lastExternalRefresh: null,
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

  function cleanStrictKanbanItemId(value) {
    const text = String(value || '').trim();
    return /^[a-zA-Z0-9_.:-]{1,180}$/.test(text) ? cleanRouteId(text) : '';
  }

  function stripFrontmatter(md) {
    if (window.BlueprintsMarkdown?.stripFrontmatter) return window.BlueprintsMarkdown.stripFrontmatter(md);
    return String(md || '').replace(/^---\s*\n[\s\S]*?\n---\s*(\n|$)/, '');
  }

  function renderMarkdown(md, emptyText = 'No description.') {
    if (window.BlueprintsMarkdown?.render) return window.BlueprintsMarkdown.render(md, { emptyText });
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

  function renderEditorMarkdown(md, emptyText = 'No content.') {
    if (window.BlueprintsRichMarkdown?.render) {
      return window.BlueprintsRichMarkdown.render(md, { emptyText });
    }
    return renderMarkdown(md, emptyText);
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
    if (!selectedHidden && selectedId && visibleIds.has(selectedId)) {
      const boardItem = findItem(selectedId);
      if (boardItem) state.selection = { item: boardItem };
    }
    if (!detailHidden && detailId && visibleIds.has(detailId)) {
      const boardItem = findItem(detailId);
      const draftWasDirty = detailDraftDirty();
      if (boardItem && state.detail?.item) {
        state.detail = { ...state.detail, item: { ...state.detail.item, ...boardItem } };
        if (!draftWasDirty) state.detailDraft = detailDraftFromDetail(state.detail);
      }
    }
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
      item?.goal_flag ? 'goal' : '',
      item?.automation_excluded ? 'automation-excluded' : '',
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
        type: item.source?.type || 'kanban',
      },
      related: {
        ...(item.related || {}),
        kanban_items: [item.item_id],
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

  function goalFlagCheckboxHtml(id, checked = false, attrs = '') {
    const safeId = String(id || 'kanban-goal-flag').replace(/[^a-zA-Z0-9_-]/g, '-');
    return `<label class="hub-checkbox kanban-goal-flag" for="${escHtml(safeId)}">
      <input id="${escHtml(safeId)}" class="hub-checkbox__input" type="checkbox" ${checked ? 'checked' : ''} ${attrs}>
      <span class="hub-checkbox__box" aria-hidden="true"></span>
      <span class="hub-checkbox__label">Goal</span>
    </label>`;
  }

  function automationExcludedCheckboxHtml(id, checked = false, attrs = '') {
    const safeId = String(id || 'kanban-automation-excluded').replace(/[^a-zA-Z0-9_-]/g, '-');
    return `<label class="hub-checkbox kanban-automation-excluded-flag" for="${escHtml(safeId)}">
      <input id="${escHtml(safeId)}" class="hub-checkbox__input" type="checkbox" ${checked ? 'checked' : ''} ${attrs}>
      <span class="hub-checkbox__box" aria-hidden="true"></span>
      <span class="hub-checkbox__label">Skip Automation</span>
    </label>`;
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

  function itemType(item) {
    return String(item?.item_type || 'item').toLowerCase();
  }

  function isTypedLeafCard(item) {
    return itemType(item) === 'issue';
  }

  function itemTypeLabel(item) {
    const type = itemType(item);
    if (type === 'issue') return 'Issue';
    return 'Item';
  }

  function cardShareKind(item) {
    const type = itemType(item);
    return type === 'issue' ? 'issue' : 'item';
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
        sourcePrefix: 'kanban_items',
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
      sourcePrefix: 'kanban_items',
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
    return requestJson(`/api/v1/personal/kanban/items/${encodeURIComponent(itemId)}`);
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
    const itemId = state.detail?.item?.item_id || '';
    const context = options.context || {
      domain: 'kanban',
      documentType: options.fieldName === 'detailBody'
        ? 'item-detail'
        : (options.fieldName === 'reviewBody' ? 'item-review' : 'item-body'),
      documentId: itemId || safeId,
      itemId,
    };
    const textareaAttrs = { ...(options.textareaAttrs || {}) };
    if (options.fieldName) textareaAttrs['data-kanban-detail-field'] = options.fieldName;
    const attrsHtml = attrs => Object.entries(attrs || {})
      .filter(([, attrValue]) => attrValue !== false && attrValue != null)
      .map(([attrKey, attrValue]) => ` ${attrKey}="${escHtml(attrValue === true ? '' : attrValue)}"`)
      .join('');
    if (window.BlueprintsRichMarkdown?.fieldHtml) {
      return window.BlueprintsRichMarkdown.fieldHtml({
        textareaId: safeId,
        previewId: `${safeId}-preview`,
        label: label || 'Description',
        value,
        rows: options.rows || 5,
        maxlength: options.maxlength || 4000,
        previewDefault,
        hideLabel,
        emptyText,
        wrapperClass: 'kanban-field kanban-field--markdown calendar-markdown-field',
        textareaAttrs,
        context,
      });
    }
    return `
      <div class="kanban-field kanban-field--markdown calendar-markdown-field">
        <div class="calendar-field__label-row${hideLabel ? ' calendar-field__label-row--actions-only' : ''}">
          <span class="${hideLabel ? 'kanban-visually-hidden' : ''}">${escHtml(label || 'Description')}</span>
          <button class="calendar-markdown-toggle" type="button" data-kanban-detail-action="toggle-markdown-preview" data-kanban-markdown-prefix="${escHtml(safeId)}">${previewDefault ? 'Edit' : 'Preview'}</button>
        </div>
        <textarea id="${escHtml(safeId)}" maxlength="${escHtml(options.maxlength || 4000)}"${attrsHtml(textareaAttrs)}${previewDefault ? ' hidden' : ''}>${escHtml(value)}</textarea>
        <div id="${escHtml(safeId)}-preview" class="calendar-markdown-preview"${previewDefault ? '' : ' hidden'}>${previewDefault ? renderMarkdown(value || '', emptyText) : ''}</div>
      </div>
    `;
  }

  function shareKindLabel(kind) {
    const clean = String(kind || '').toLowerCase();
    if (clean === 'issue' || clean === 'issues') return 'issue';
    if (clean === 'todo' || clean === 'todos') return 'todo';
    return 'item';
  }

  function shareCode(kind, id) {
    const cleanId = String(id || '').trim();
    return cleanId ? `xarta-kanban:${shareKindLabel(kind)}:${cleanId}` : '';
  }

  function kanbanItemIdFromShareRef(value) {
    const clean = String(value || '').trim();
    if (!clean) return '';
    if (clean.startsWith('xarta-kanban:')) {
      const parts = clean.split(':');
      if (parts.length >= 3 && ['item', 'issue', 'todo'].includes(parts[1])) {
        return parts.slice(2).join(':').trim();
      }
    }
    if (clean.startsWith('kanban_items:')) return clean.slice('kanban_items:'.length).trim();
    return clean;
  }

  function kanbanGraphRefFromShareRef(value) {
    const clean = String(value || '').trim();
    const itemId = kanbanItemIdFromShareRef(clean);
    if (!itemId) return '';
    if (clean.startsWith('xarta-kanban:') || clean.startsWith('kanban_items:')) {
      return `kanban_items:${itemId}`;
    }
    return clean;
  }

  async function writeClipboardText(text) {
    if (!text) return false;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.left = '-1000px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand?.('copy');
    textarea.remove();
    if (!ok) throw new Error('clipboard unavailable');
    return true;
  }

  async function copyShareCode(kind, id, options = {}) {
    const code = shareCode(kind, id);
    if (!code) return false;
    await writeClipboardText(code);
    await HubDialogs.alert({
      title: 'Share Code Copied',
      message: code,
      details: options.title ? [String(options.title)] : [],
      tone: 'success',
      autoCloseMs: 1800,
    });
    return true;
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

  function pillMetricChip(value, tone, label) {
    return `<strong class="kanban-pill-metric" data-tone="${escHtml(tone)}" title="${escHtml(label)}" aria-label="${escHtml(label)}">${escHtml(value)}</strong>`;
  }

  function pillHtml(kind, label, count, tone, itemId) {
    const countLabel = `${count} open ${label}`;
    return `<button class="kanban-pill-btn kanban-pill-btn--multi kanban-pill-btn--single-metric" type="button" data-kanban-pill="${kind}" data-kanban-item-id="${escHtml(itemId)}" data-tone="${escHtml(tone)}" title="${escHtml(`${label}: ${countLabel}`)}">
      <span class="kanban-pill-label">${escHtml(label)}</span>
      <span class="kanban-pill-metrics kanban-pill-metrics--single">
        ${pillMetricChip(count, tone, countLabel)}
      </span>
    </button>`;
  }

  function leafMetricsFor(rollup, group, fallbackActive = 0) {
    const raw = rollup?.[group]?.leaf_metrics || {};
    const hasMetrics = Object.prototype.hasOwnProperty.call(raw, 'active')
      || Object.prototype.hasOwnProperty.call(raw, 'blocked')
      || Object.prototype.hasOwnProperty.call(raw, 'done');
    return {
      total: Number(raw.total || (hasMetrics ? 0 : fallbackActive)),
      active: Number(raw.active || (hasMetrics ? 0 : fallbackActive)),
      activeDoing: Number(raw.active_doing || 0),
      blocked: Number(raw.blocked || 0),
      done: Number(raw.done || 0),
    };
  }

  function leafMetricsTone(metrics, blockedCount) {
    const active = Number(metrics.active || 0);
    const done = Number(metrics.done || 0);
    const blocked = Number(blockedCount || 0);
    if (blocked > 0) return 'err';
    if (Number(metrics.activeDoing || 0) > 0) return 'warn';
    if (active > 0) return 'info';
    if (done > 0) return 'ok';
    return 'empty';
  }

  function leafMetricChip(value, tone, label) {
    return pillMetricChip(value, tone, label);
  }

  function leafMetricsPillHtml(kind, label, metrics, itemId, options = {}) {
    const blockedCount = Number(options.blockedCount ?? metrics.blocked ?? 0);
    const tone = leafMetricsTone(metrics, blockedCount);
    const activeLabel = `${metrics.active || 0} backlog, todo, or doing leaf ${Number(metrics.active || 0) === 1 ? 'item' : 'items'}`;
    const blockedLabel = `${blockedCount} blocked leaf ${blockedCount === 1 ? 'item' : 'items'}`;
    const doneLabel = `${metrics.done || 0} done leaf ${Number(metrics.done || 0) === 1 ? 'item' : 'items'}`;
    return `<button class="kanban-pill-btn kanban-pill-btn--multi" type="button" data-kanban-pill="${kind}" data-kanban-item-id="${escHtml(itemId)}" data-tone="${escHtml(tone)}" title="${escHtml(`${label}: ${activeLabel}, ${blockedLabel}, ${doneLabel}`)}">
      <span class="kanban-pill-label">${escHtml(label)}</span>
      <span class="kanban-pill-metrics">
        ${leafMetricChip(metrics.active || 0, Number(metrics.activeDoing || 0) > 0 ? 'warn' : (Number(metrics.active || 0) > 0 ? 'info' : 'empty'), activeLabel)}
        ${leafMetricChip(blockedCount, blockedCount > 0 ? 'err' : 'empty', blockedLabel)}
        ${leafMetricChip(metrics.done || 0, Number(metrics.done || 0) > 0 ? 'ok' : 'empty', doneLabel)}
      </span>
    </button>`;
  }

  function rollupRows(item) {
    if (isTypedLeafCard(item)) return '';
    const rollup = rollupFor(item);
    const subitems = Math.max(0, Number(rollup.items?.total || 1) - 1);
    const issues = Number(rollup.issues?.open || 0);
    const todos = Number(rollup.todos?.open || 0);
    const itemLeafMetrics = leafMetricsFor(rollup, 'items', subitems);
    const issueLeafMetrics = leafMetricsFor(rollup, 'issues', issues);
    return `
      <div class="kanban-rollups">
        <div class="kanban-rollup-row">
          ${leafMetricsPillHtml('subitems', 'SubItems', itemLeafMetrics, item.item_id)}
          <button class="kanban-add-btn" type="button" data-kanban-card-action="add-child" data-kanban-item-id="${escHtml(item.item_id)}" title="Add child item" aria-label="Add child item"></button>
        </div>
        <div class="kanban-rollup-row">
          ${leafMetricsPillHtml('issues', 'Issues', issueLeafMetrics, item.item_id)}
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
    const typedLeaf = isTypedLeafCard(item);
    const type = itemType(item);
    return `
      <article class="kanban-card" data-kanban-item-id="${escHtml(item.item_id)}" data-kanban-item-type="${escHtml(type)}" tabindex="0" data-selected="${selected ? 'true' : 'false'}" data-pending="${pending ? 'true' : 'false'}" data-kanban-route-target="${routeTarget ? 'true' : 'false'}">
        <div class="kanban-card__head">
          <div class="kanban-card__title">${escHtml(item.title || item.item_id)}</div>
          <button class="kanban-card-btn kanban-card-btn--share kanban-card__share" type="button" data-kanban-card-action="share" data-kanban-item-id="${escHtml(item.item_id)}" title="Copy share code" aria-label="Copy share code"></button>
        </div>
        <div class="kanban-card__meta">
          ${typedLeaf ? `<span class="kanban-type-pill" data-item-type="${escHtml(type)}">${escHtml(itemTypeLabel(item))}</span>` : ''}
          ${item.goal_flag ? '<span class="kanban-goal-pill">Goal</span>' : ''}
          ${item.automation_excluded ? '<span class="kanban-automation-excluded-pill">Automation Off</span>' : ''}
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
          ${typedLeaf ? '' : `<button class="kanban-card-btn kanban-card-btn--child" type="button" data-kanban-card-action="open-child-board" data-kanban-item-id="${escHtml(item.item_id)}" title="Open child board" aria-label="Open child board"></button>`}
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

  function columnForState(stateId) {
    const cleanStateId = String(stateId || '');
    return (state.board?.columns || []).find(column => (column.state?.state_id || '') === cleanStateId) || null;
  }

  function visibleItemsForState(stateId) {
    return visibleColumnItems(columnForState(stateId));
  }

  function cardElementForItem(itemId) {
    const cleanItemId = String(itemId || '');
    if (!cleanItemId) return null;
    return Array.from(document.querySelectorAll('#tab-kanban .kanban-card[data-kanban-item-id]'))
      .find(node => node.dataset.kanbanItemId === cleanItemId) || null;
  }

  function clearCardDragHighlights() {
    document.querySelectorAll('#tab-kanban [data-kanban-drop-target]').forEach(node => {
      node.removeAttribute('data-kanban-drop-target');
    });
    document.querySelectorAll('#tab-kanban [data-kanban-drag-source]').forEach(node => {
      node.removeAttribute('data-kanban-drag-source');
    });
  }

  function cardDragTargetLabel(target = cardDrag.target) {
    if (target.kind === 'lane') return `Drop to move to ${stateLabel(target.stateId)}.`;
    if (target.kind === 'child') return 'Drop to make this a child item.';
    if (target.kind === 'order') return `Drop to move ${target.before ? 'above' : 'below'} this card.`;
    return 'Drag over a lane, card, or between-card edge.';
  }

  function sameCardDragTarget(a = {}, b = {}) {
    return String(a.kind || '') === String(b.kind || '')
      && String(a.itemId || '') === String(b.itemId || '')
      && String(a.stateId || '') === String(b.stateId || '')
      && String(a.parentItemId || '') === String(b.parentItemId || '')
      && Boolean(a.before) === Boolean(b.before);
  }

  function setCardDragTarget(target) {
    const nextTarget = target?.kind ? target : { kind: '' };
    if (sameCardDragTarget(cardDrag.target, nextTarget)) return;
    cardDrag.target = nextTarget;
    clearCardDragHighlights();
    cardElementForItem(cardDrag.itemId)?.setAttribute('data-kanban-drag-source', 'true');
    if (nextTarget.kind === 'lane') {
      document
        .querySelector(`#tab-kanban .kanban-column[data-kanban-state-id="${cssEscape(nextTarget.stateId)}"]`)
        ?.setAttribute('data-kanban-drop-target', 'lane');
    } else if (nextTarget.kind === 'child') {
      cardElementForItem(nextTarget.parentItemId)?.setAttribute('data-kanban-drop-target', 'child');
    } else if (nextTarget.kind === 'order') {
      cardElementForItem(nextTarget.itemId)
        ?.setAttribute('data-kanban-drop-target', nextTarget.before ? 'order-before' : 'order-after');
    }
    renderStatus(cardDragTargetLabel(nextTarget));
  }

  function ensureCardDragGhost() {
    if (cardDrag.ghost) return cardDrag.ghost;
    const source = findItem(cardDrag.itemId);
    const ghost = document.createElement('div');
    ghost.className = 'kanban-card-drag-ghost';
    ghost.textContent = source?.title || source?.item_id || 'Kanban card';
    document.body.appendChild(ghost);
    cardDrag.ghost = ghost;
    return ghost;
  }

  function positionCardDragGhost(clientX, clientY) {
    const ghost = ensureCardDragGhost();
    ghost.style.transform = `translate(${Math.round(clientX + 14)}px, ${Math.round(clientY + 14)}px)`;
  }

  function removeCardDragGhost() {
    cardDrag.ghost?.remove?.();
    cardDrag.ghost = null;
  }

  function orderDropTargetForCard(source, target, cardElement, clientY) {
    if (!source || !target || !cardElement) return null;
    const sameLane = (source.parent_item_id || '') === (target.parent_item_id || '')
      && String(source.state_id || '') === String(target.state_id || '')
      && String(source.priority_id || '') === String(target.priority_id || '');
    if (!sameLane) return null;
    const rect = cardElement.getBoundingClientRect();
    const edgeHeight = Math.min(Math.max(CARD_DRAG_EDGE_PX, rect.height * 0.28), rect.height / 2);
    if (clientY <= rect.top + edgeHeight) {
      return { kind: 'order', itemId: target.item_id, before: true };
    }
    if (clientY >= rect.bottom - edgeHeight) {
      return { kind: 'order', itemId: target.item_id, before: false };
    }
    return null;
  }

  function cardDragTargetFromPoint(clientX, clientY) {
    const source = findItem(cardDrag.itemId);
    if (!source) return { kind: '' };
    const element = document.elementFromPoint(clientX, clientY);
    const cardElement = element?.closest?.('.kanban-card[data-kanban-item-id]');
    if (cardElement) {
      const targetId = cardElement.dataset.kanbanItemId || '';
      const target = findItem(targetId);
      if (target && target.item_id !== source.item_id) {
        const orderTarget = orderDropTargetForCard(source, target, cardElement, clientY);
        if (orderTarget) return orderTarget;
        if (!isTypedLeafCard(target)) {
          return { kind: 'child', parentItemId: target.item_id, stateId: source.state_id || 'todo' };
        }
      }
    }
    const column = element?.closest?.('.kanban-column[data-kanban-state-id]');
    const stateId = column?.dataset?.kanbanStateId || '';
    if (stateId && stateId !== source.state_id) {
      return { kind: 'lane', stateId, parentItemId: state.currentParentId || '' };
    }
    return { kind: '' };
  }

  function startCardDrag(event) {
    cardDrag.active = true;
    document.body.classList.add('is-dragging-kanban-card');
    cardElementForItem(cardDrag.itemId)?.setAttribute('data-kanban-drag-source', 'true');
    positionCardDragGhost(event.clientX, event.clientY);
    setCardDragTarget(cardDragTargetFromPoint(event.clientX, event.clientY));
  }

  function resetCardDrag() {
    document.body.classList.remove('is-dragging-kanban-card');
    clearCardDragHighlights();
    removeCardDragGhost();
    cardDrag.pointerId = null;
    cardDrag.itemId = '';
    cardDrag.startX = 0;
    cardDrag.startY = 0;
    cardDrag.active = false;
    cardDrag.sourceButton = null;
    cardDrag.target = { kind: '' };
    cardDrag.moveListener = null;
    cardDrag.endListener = null;
  }

  async function orderItemToDropTarget(itemId, targetItemId, beforeTarget) {
    const source = findItem(itemId);
    const target = findItem(targetItemId);
    if (!source || !target) return false;
    const rows = visibleItemsForState(source.state_id).filter(item => (
      (item.parent_item_id || '') === (source.parent_item_id || '')
      && String(item.priority_id || '') === String(source.priority_id || '')
    ));
    const ids = rows.map(item => item.item_id);
    const fromIndex = ids.indexOf(itemId);
    const targetIndex = ids.indexOf(targetItemId);
    if (fromIndex < 0 || targetIndex < 0 || itemId === targetItemId) return false;
    ids.splice(fromIndex, 1);
    const adjustedTargetIndex = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
    const insertIndex = Math.max(0, Math.min(
      beforeTarget ? adjustedTargetIndex : adjustedTargetIndex + 1,
      ids.length,
    ));
    ids.splice(insertIndex, 0, itemId);
    const toIndex = ids.indexOf(itemId);
    const steps = toIndex - fromIndex;
    if (!steps) return false;
    const direction = steps < 0 ? 'up' : 'down';
    setFsm('pendingMove', `drag-order-${direction}`, itemId);
    renderAll();
    try {
      for (let index = 0; index < Math.abs(steps); index += 1) {
        await requestJson(`/api/v1/personal/kanban/items/${encodeURIComponent(itemId)}/order`, {
          method: 'POST',
          body: JSON.stringify({
            direction,
            actor: 'blueprints-ui',
            source_surface: 'kanban-page',
            request_id: `ui-kanban-drag-order-${direction}-${Date.now()}-${index}`,
          }),
        });
      }
      setFsm('selected', 'dragOrderAccepted', itemId);
      await load({ force: true });
      if (findItem(itemId)) await setSelection(itemId);
      return true;
    } catch (error) {
      setFsm('selected', 'dragOrderRejected', itemId);
      state.error = error.message || String(error);
      renderAll();
      await HubDialogs.alert({ title: 'Order rejected', message: state.error, tone: 'danger' });
      return false;
    }
  }

  async function applyCardDragTarget(target) {
    if (!target?.kind || !cardDrag.itemId) return false;
    const item = findItem(cardDrag.itemId);
    if (!item) return false;
    if (target.kind === 'order') {
      return orderItemToDropTarget(item.item_id, target.itemId, Boolean(target.before));
    }
    if (target.kind === 'child') {
      return moveItem(item.item_id, item.state_id || 'todo', {
        parentItemId: target.parentItemId,
        requestKind: 'drag-child',
      });
    }
    if (target.kind === 'lane') {
      return moveItem(item.item_id, target.stateId, {
        parentItemId: target.parentItemId || null,
        requestKind: 'drag-lane',
      });
    }
    return false;
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

  function scopedDocumentType(config) {
    return config.kind === 'issues' ? 'issue' : 'todo';
  }

  function scopedBreadcrumbText(data) {
    const rows = Array.isArray(data?.breadcrumbs) ? data.breadcrumbs : [];
    return ['Root board', ...rows.map(item => item.title || item.item_id)].join(' / ');
  }

  function scopedRowHtml(record, config) {
    const id = scopedRecordId(record, config);
    const scope = record.scope || {};
    const priority = record.priority_id || record.severity_id || 'medium';
    const bodyId = `kanban-scoped-${config.kind}-${id}-body`.replace(/[^a-zA-Z0-9_-]/g, '-');
    return `
      <article class="kanban-scoped-row" data-kanban-scoped-row="${escHtml(config.kind)}" data-kanban-scoped-id="${escHtml(id)}" data-kanban-scoped-item-id="${escHtml(record.item_id || '')}" data-kanban-scoped-parent-id="${escHtml(record.parent_item_id || '')}">
        <div class="kanban-scoped-row__main">
          <div class="kanban-detail-meta">${escHtml(scope.title || record.item_id || '')} - ${escHtml(scope.relation || 'local')} - d${escHtml(scope.depth_offset ?? 0)}</div>
          <label class="kanban-field kanban-scoped-title-field">
            <span class="kanban-visually-hidden">${escHtml(config.singular)} title</span>
            <input type="text" maxlength="180" value="${escHtml(record.title || id)}" data-kanban-scoped-field="title" aria-label="${escHtml(config.singular)} title" />
          </label>
          ${markdownFieldHtml(bodyId, 'Details', record.body_excerpt || '', {
            previewDefault: true,
            hideLabel: true,
            rows: 7,
            maxlength: 120000,
            emptyText: 'No details.',
            textareaAttrs: { 'data-kanban-scoped-field': 'body' },
            context: {
              domain: 'kanban',
              documentType: scopedDocumentType(config),
              documentId: id,
              itemId: id,
            },
          })}
          ${record.source_ref || record.related_task_id ? `<div class="kanban-detail-meta">${escHtml(record.source_ref || record.related_task_id || '')}</div>` : ''}
        </div>
        <div class="kanban-scoped-row__controls">
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
            <button class="kanban-command-btn" type="button" data-kanban-scoped-row-action="remove">Remove</button>
            <button class="kanban-icon-btn kanban-icon-btn--share kanban-scoped-share-btn" type="button" data-kanban-scoped-row-action="share" title="Copy share code" aria-label="Copy share code"></button>
          </div>
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
              <h3>${escHtml(group.item?.title || group.item?.item_id || 'Kanban item')}</h3>
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
      detailRow(item.title || item.item_id, `${stateLabel(item.state_id)} - ${priorityLabel(item.priority_id)}${item.goal_flag ? ' - Goal' : ''}`, markdownPreviewHtml(item.body_excerpt || '', 'kanban-detail-body', 'No description.', true), { bodyHtml: true }),
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
      detailRow('Board API', state.currentParentId ? `/api/v1/personal/kanban/items/${state.currentParentId}/board` : '/api/v1/personal/kanban/board', 'DB-canonical kanban_items'),
      detailRow('Config API', '/api/v1/personal/kanban/config', `${stateRows().length} states - ${priorityRows().length} priorities`),
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
    const goalChecked = Boolean(el(`${safePrefix}-goal-flag`)?.checked);
    const automationExcludedChecked = Boolean(el(`${safePrefix}-automation-excluded`)?.checked);
    return `
      <section class="calendar-quick-event calendar-quick-event--embedded kanban-inline-item" aria-label="New Item">
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
            ${goalFlagCheckboxHtml(`${safePrefix}-goal-flag`, goalChecked)}
            ${automationExcludedCheckboxHtml(`${safePrefix}-automation-excluded`, automationExcludedChecked)}
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

  function backupEntries() {
    return Array.isArray(state.backups.data?.backups) ? state.backups.data.backups : [];
  }

  function formatBackupBytes(value) {
    const bytes = Number(value) || 0;
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
  }

  function formatBackupDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function backupKindLabel(value) {
    if (value === 'pre-import') return 'Pre-import';
    if (value === 'manual') return 'Manual';
    return value ? String(value) : 'Backup';
  }

  function backupRowCount(entry) {
    const counts = entry?.table_counts || {};
    return Number(counts.kanban_items || 0);
  }

  function backupBusyFor(filename = '') {
    if (state.backups.loading) return true;
    if (state.backups.busyAction && state.backups.busyAction !== 'apply') return true;
    if (state.backups.applyingFilename) return state.backups.applyingFilename !== filename || !!filename;
    return false;
  }

  function backupResultHtml() {
    const result = state.backups.lastResult;
    if (!result) return '';
    const tone = result.tone || (result.ok === false ? 'err' : 'ok');
    const payload = result.payload || {};
    const lines = [];
    if (payload.filename) lines.push(`File: ${payload.filename}`);
    if (payload.backup?.filename) lines.push(`File: ${payload.backup.filename}`);
    if (payload.pre_import_backup) lines.push(`Pre-import: ${payload.pre_import_backup}`);
    if (typeof payload.applied === 'boolean') lines.push(`Applied: ${payload.applied ? 'yes' : 'no'}`);
    if (typeof payload.restored_files === 'boolean') lines.push(`Files restored: ${payload.restored_files ? 'yes' : 'no'}`);
    if (typeof payload.gen_before !== 'undefined' && typeof payload.gen_after !== 'undefined') {
      lines.push(`Generation: ${payload.gen_before} -> ${payload.gen_after}`);
    }
    if (Array.isArray(payload.warnings) && payload.warnings.length) {
      lines.push(`Warnings: ${payload.warnings.join('; ')}`);
    }
    return `<div class="kanban-backup-result" data-tone="${escHtml(tone)}" role="status">
      <strong>${escHtml(result.message || 'Backup action completed.')}</strong>
      ${lines.length ? `<span>${escHtml(lines.join(' · '))}</span>` : ''}
    </div>`;
  }

  function backupDownloadUrl(filename) {
    return `/api/v1/personal/kanban/backups/${encodeURIComponent(filename)}`;
  }

  function downloadBackupFromPanel(filename) {
    const clean = String(filename || '');
    if (!clean) return null;
    const link = document.createElement('a');
    link.href = backupDownloadUrl(clean);
    link.download = clean;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setBackupResult('Backup download started.', { filename: clean }, { tone: 'ok' });
    refreshBackupPanels();
    return true;
  }

  function openBackupRowActions(filename) {
    const clean = String(filename || '');
    if (!clean) return false;
    if (!window.TableRowActions?.open) {
      setBackupResult('Backup action menu unavailable.', { ok: false, filename: clean }, { tone: 'err' });
      return false;
    }
    window.TableRowActions.open({
      title: 'Backup actions',
      subtitle: clean,
      actions: [
        {
          label: 'Download',
          detail: 'Save this backup package.',
          onClick: () => downloadBackupFromPanel(clean),
        },
        {
          label: 'Validate',
          detail: 'Check backup metadata and bundled files.',
          onClick: () => validateBackupFromPanel(clean),
        },
        {
          label: 'Dry Run',
          detail: 'Preview the import without applying changes.',
          onClick: () => dryRunImportBackupFromPanel(clean),
        },
        {
          label: 'Import',
          detail: 'Restore from this backup after confirmation.',
          tone: 'danger',
          onClick: () => applyImportBackupFromPanel(clean),
        },
      ],
    });
    return true;
  }

  function backupTableHtml() {
    const rows = backupEntries();
    if (state.backups.loading && !rows.length) {
      return '<div class="kanban-empty">Loading backups...</div>';
    }
    if (state.backups.error) {
      return `<div class="kanban-empty kanban-backup-error">${escHtml(state.backups.error)}</div>`;
    }
    if (!rows.length) {
      return '<div class="kanban-empty">No Kanban backups found.</div>';
    }
    const busyAction = state.backups.busyAction;
    return `<div class="kanban-backups-table" role="table" aria-label="Kanban import/export backups">
      <div class="kanban-backup-row kanban-backup-row--head" role="row">
        <span class="kanban-backup-head-cell" role="columnheader">Backup</span>
        <span class="kanban-backup-head-cell" role="columnheader">Kind</span>
        <span class="kanban-backup-head-cell kanban-backup-head-cell--metric" role="columnheader">Items</span>
        <span class="kanban-backup-head-cell kanban-backup-head-cell--metric" role="columnheader">Files</span>
        <span class="kanban-backup-head-cell kanban-backup-head-cell--metric" role="columnheader">Size</span>
        <span class="kanban-backup-head-cell kanban-backup-head-cell--actions" role="columnheader">Actions</span>
      </div>
      ${rows.map(entry => {
        const filename = String(entry.filename || '');
        const downloadUrl = backupDownloadUrl(filename);
        const disabled = backupBusyFor(filename) ? ' disabled' : '';
        const applying = state.backups.applyingFilename === filename;
        const hash = String(entry.sha256 || '');
        return `<article class="kanban-backup-row" role="row" data-kanban-backup-file="${escHtml(filename)}">
          <div class="kanban-backup-file" role="cell">
            <strong title="${escHtml(filename)}">${escHtml(filename)}</strong>
            <span>${escHtml(formatBackupDate(entry.created_at))}${hash ? ` · ${escHtml(hash.slice(0, 12))}` : ''}</span>
          </div>
          <span class="kanban-backup-cell" role="cell" data-label="Kind">${escHtml(backupKindLabel(entry.kind))}</span>
          <span class="kanban-backup-cell kanban-backup-metric" role="cell" data-label="Items">${escHtml(String(backupRowCount(entry)))}</span>
          <span class="kanban-backup-cell kanban-backup-metric" role="cell" data-label="Files">${escHtml(String(entry.file_count ?? ''))}</span>
          <span class="kanban-backup-cell kanban-backup-metric" role="cell" data-label="Size">${escHtml(formatBackupBytes(entry.size_bytes))}</span>
          <div class="kanban-backup-actions" role="cell" data-label="Actions">
            <div class="kanban-backup-actions-inline">
              <a class="kanban-command-btn kanban-backup-download" href="${downloadUrl}" download="${escHtml(filename)}">Download</a>
              <button class="kanban-command-btn" type="button" data-kanban-backup-action="validate" data-kanban-backup-file="${escHtml(filename)}"${disabled}>Validate</button>
              <button class="kanban-command-btn" type="button" data-kanban-backup-action="dry-run" data-kanban-backup-file="${escHtml(filename)}"${disabled}>Dry Run</button>
              <button class="kanban-command-btn kanban-command-btn--danger" type="button" data-kanban-backup-action="apply" data-kanban-backup-file="${escHtml(filename)}"${disabled}>${applying || (busyAction === 'apply' && applying) ? 'Importing...' : 'Import'}</button>
            </div>
            <button class="kanban-command-btn table-row-action-trigger kanban-backup-actions-trigger" type="button" data-kanban-backup-row-actions="${escHtml(filename)}" aria-label="Backup actions for ${escHtml(filename)}" title="Backup actions"${disabled}>⋮</button>
          </div>
        </article>`;
      }).join('')}
    </div>`;
  }

  function embeddedBackupsHtml() {
    if (!state.backups.data && !state.backups.loading && !state.backups.error) {
      setTimeout(() => loadBackupsPanel({ force: true }), 0);
    }
    const data = state.backups.data || {};
    const busy = state.backups.loading || !!state.backups.busyAction;
    const backupDir = data.backup_dir ? `<span title="${escHtml(data.backup_dir)}">Backups: ${escHtml(data.backup_dir)}</span>` : '';
    const kanbanRoot = data.kanban_root ? `<span title="${escHtml(data.kanban_root)}">Files: ${escHtml(data.kanban_root)}</span>` : '';
    return `<section class="calendar-band kanban-band kanban-backups-panel" aria-label="Kanban Import/Export/Backups">
      <div class="calendar-section-head kanban-section-head">
        <h3>Backups</h3>
        <div class="kanban-backups-toolbar">
          <button class="kanban-command-btn" type="button" data-kanban-backup-action="refresh"${busy ? ' disabled' : ''}>Refresh</button>
          <button class="kanban-command-btn" type="button" data-kanban-backup-action="create"${busy ? ' disabled' : ''}>Export Backup</button>
        </div>
      </div>
      ${(backupDir || kanbanRoot) ? `<div class="kanban-backup-paths">${backupDir}${kanbanRoot}</div>` : ''}
      ${state.backups.loading ? '<div class="kanban-backup-result" data-tone="info" role="status"><strong>Loading backups...</strong></div>' : ''}
      ${backupResultHtml()}
      ${backupTableHtml()}
    </section>`;
  }

  function refreshBackupModal() {
    const body = document.querySelector('#kanban-backups-modal [data-kanban-backups-modal-body]');
    if (!body) return;
    body.innerHTML = embeddedBackupsHtml();
  }

  function openBackupsModal() {
    const dialog = openDialog('Kanban Import/Export/Backups', `<div data-kanban-backups-modal-body>${embeddedBackupsHtml()}</div>`, {
      badge: 'BKP',
      id: 'kanban-backups-modal',
      width: 'min(1560px, calc(100vw - 28px))',
    });
    dialog.addEventListener('click', event => {
      const rowActionsButton = event.target.closest('[data-kanban-backup-row-actions]');
      if (rowActionsButton) {
        event.preventDefault();
        event.stopPropagation();
        openBackupRowActions(rowActionsButton.dataset.kanbanBackupRowActions || '');
        return;
      }
      const backupButton = event.target.closest('[data-kanban-backup-action]');
      if (!backupButton) return;
      event.preventDefault();
      event.stopPropagation();
      const result = handleBackupAction(backupButton);
      refreshBackupModal();
      if (result && typeof result.finally === 'function') {
        result.finally(() => refreshBackupModal());
      }
    });
    return dialog;
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

  function refreshBackupPanels() {
    if (!window.PersonalFilters?.activateTab) return;
    document.querySelectorAll('[data-personal-filter-host][data-personal-filter-surface="kanban"]').forEach(host => {
      if (host.dataset.personalFilterTab !== 'backups') return;
      if (!hostIsVisible(host)) return;
      window.PersonalFilters.activateTab('kanban', 'backups', { host, visibleOnly: false });
    });
  }

  async function loadBackupsPanel(options = {}) {
    if (state.backups.loading && !options.force) return state.backups.data;
    state.backups.loading = true;
    state.backups.error = '';
    refreshBackupPanels();
    try {
      state.backups.data = await requestJson('/api/v1/personal/kanban/backups');
      return state.backups.data;
    } catch (err) {
      state.backups.error = err?.message || String(err);
      return null;
    } finally {
      state.backups.loading = false;
      refreshBackupPanels();
      refreshBackupModal();
    }
  }

  function setBackupResult(message, payload = {}, options = {}) {
    state.backups.lastResult = {
      message,
      payload,
      tone: options.tone || (payload?.ok === false ? 'err' : 'ok'),
      ok: payload?.ok !== false,
    };
    refreshBackupModal();
  }

  async function createBackupFromPanel() {
    state.backups.busyAction = 'create';
    setBackupResult('Creating Kanban backup...', {}, { tone: 'info' });
    refreshBackupPanels();
    try {
      const payload = await requestJson('/api/v1/personal/kanban/backups?kind=manual', { method: 'POST' });
      setBackupResult('Backup created.', payload);
      await loadBackupsPanel({ force: true });
      return payload;
    } catch (err) {
      state.backups.error = err?.message || String(err);
      setBackupResult('Backup failed.', { ok: false, error: state.backups.error }, { tone: 'err' });
      return null;
    } finally {
      state.backups.busyAction = '';
      refreshBackupPanels();
    }
  }

  async function validateBackupFromPanel(filename) {
    const clean = String(filename || '');
    if (!clean) return null;
    state.backups.busyAction = 'validate';
    setBackupResult(`Validating ${clean}...`, {}, { tone: 'info' });
    refreshBackupPanels();
    try {
      const payload = await requestJson(`/api/v1/personal/kanban/backups/${encodeURIComponent(clean)}/validate`);
      setBackupResult(payload.ok ? 'Backup package validated.' : 'Backup package validated with warnings.', payload, { tone: payload.ok ? 'ok' : 'warn' });
      return payload;
    } catch (err) {
      const message = err?.message || String(err);
      setBackupResult('Validation failed.', { ok: false, filename: clean, error: message }, { tone: 'err' });
      return null;
    } finally {
      state.backups.busyAction = '';
      refreshBackupPanels();
    }
  }

  async function dryRunImportBackupFromPanel(filename) {
    const clean = String(filename || '');
    if (!clean) return null;
    state.backups.busyAction = 'dry-run';
    setBackupResult(`Dry-running ${clean}...`, {}, { tone: 'info' });
    refreshBackupPanels();
    try {
      const payload = await requestJson(`/api/v1/personal/kanban/backups/${encodeURIComponent(clean)}/import?apply=false&restore_files=true&backup_before_import=true`, { method: 'POST' });
      setBackupResult(payload.ok ? 'Import dry run completed.' : 'Import dry run returned warnings.', payload, { tone: payload.ok ? 'ok' : 'warn' });
      return payload;
    } catch (err) {
      const message = err?.message || String(err);
      setBackupResult('Import dry run failed.', { ok: false, filename: clean, error: message }, { tone: 'err' });
      return null;
    } finally {
      state.backups.busyAction = '';
      refreshBackupPanels();
    }
  }

  async function applyImportBackupFromPanel(filename) {
    const clean = String(filename || '');
    if (!clean) return null;
    const ok = await HubDialogs.confirm({
      title: 'Import Kanban Backup',
      message: `Import "${clean}"? This restores Kanban rows and file-backed Kanban documents from the backup package. A pre-import backup will be created first.`,
      confirmText: 'Import Backup',
      tone: 'danger',
    });
    if (!ok) return null;
    state.backups.busyAction = 'apply';
    state.backups.applyingFilename = clean;
    setBackupResult(`Importing ${clean}...`, {}, { tone: 'info' });
    refreshBackupPanels();
    try {
      const payload = await requestJson(`/api/v1/personal/kanban/backups/${encodeURIComponent(clean)}/import?apply=true&restore_files=true&backup_before_import=true`, { method: 'POST' });
      setBackupResult('Backup imported.', payload);
      state.detail = null;
      state.detailDraft = null;
      state.selection = null;
      await load({ force: true, forceConfig: true, skipRouteDetail: true, skipRouteScoped: true });
      await loadBackupsPanel({ force: true });
      return payload;
    } catch (err) {
      const message = err?.message || String(err);
      setBackupResult('Backup import failed.', { ok: false, filename: clean, error: message }, { tone: 'err' });
      return null;
    } finally {
      state.backups.busyAction = '';
      state.backups.applyingFilename = '';
      refreshBackupPanels();
    }
  }

  async function openBackupsPanel() {
    const activated = activateKanbanPanelTab('backups');
    if (!activated) openBackupsModal();
    await loadBackupsPanel({ force: true });
    refreshBackupModal();
    return true;
  }

  function handleBackupAction(button) {
    const action = button?.dataset?.kanbanBackupAction || '';
    const filename = button?.dataset?.kanbanBackupFile || '';
    if (action === 'refresh') return loadBackupsPanel({ force: true });
    if (action === 'create') return createBackupFromPanel();
    if (action === 'validate') return validateBackupFromPanel(filename);
    if (action === 'dry-run') return dryRunImportBackupFromPanel(filename);
    if (action === 'apply') return applyImportBackupFromPanel(filename);
    return null;
  }

  function automationRecentDecisions() {
    const decisions = state.automationStatus.data?.decisions?.recent;
    return Array.isArray(decisions) ? decisions : [];
  }

  function automationReviewScheduler() {
    const scheduler = state.automationStatus.data?.review_processor?.scheduler;
    return scheduler && typeof scheduler === 'object' ? scheduler : {};
  }

  function automationPreprocessingScheduler() {
    const scheduler = state.automationStatus.data?.preprocessing?.scheduler;
    return scheduler && typeof scheduler === 'object' ? scheduler : {};
  }

  function automationReviewMarkers() {
    const schedulerMarkers = automationReviewScheduler().recent_markers;
    if (Array.isArray(schedulerMarkers) && schedulerMarkers.length) return schedulerMarkers;
    const directMarkers = state.automationStatus.data?.review_processor?.review_markers;
    return Array.isArray(directMarkers) ? directMarkers : [];
  }

  function automationPreprocessingMarkers() {
    const schedulerMarkers = automationPreprocessingScheduler().recent_markers;
    if (Array.isArray(schedulerMarkers) && schedulerMarkers.length) return schedulerMarkers;
    const directMarkers = state.automationStatus.data?.preprocessing?.markers;
    return Array.isArray(directMarkers) ? directMarkers : [];
  }

  function automationFailureAggregates() {
    const combined = state.automationStatus.data?.failures?.aggregates;
    if (Array.isArray(combined) && combined.length) return combined;
    return [
      ...(Array.isArray(automationReviewScheduler().failure_aggregates) ? automationReviewScheduler().failure_aggregates : []),
      ...(Array.isArray(automationPreprocessingScheduler().failure_aggregates) ? automationPreprocessingScheduler().failure_aggregates : []),
    ];
  }

  function automationFailureEvents() {
    const combined = state.automationStatus.data?.failures?.recent_events;
    if (Array.isArray(combined) && combined.length) return combined;
    return [
      ...(Array.isArray(automationReviewScheduler().failure_events) ? automationReviewScheduler().failure_events : []),
      ...(Array.isArray(automationPreprocessingScheduler().failure_events) ? automationPreprocessingScheduler().failure_events : []),
    ];
  }

  function automationMetricHtml(label, value, meta = '', tone = '') {
    return `<div class="kanban-automation-metric${tone ? ` kanban-automation-metric--${escHtml(tone)}` : ''}">
      <span>${escHtml(label)}</span>
      <strong>${escHtml(value ?? '')}</strong>
      ${meta ? `<em>${escHtml(meta)}</em>` : ''}
    </div>`;
  }

  function automationStatusPayloadSummary(payload) {
    if (!payload || typeof payload !== 'object') return '';
    if ('queued_count' in payload) {
      return `scanned ${Number(payload.scanned_count || 0)} · eligible ${Number(payload.eligible_review_count || 0)} · queued ${Number(payload.queued_count || 0)}`;
    }
    if ('requeued_count' in payload) {
      return `requeued ${Number(payload.requeued_count || 0)} · timeouts ${Number(payload.scheduler?.timeout_count || 0)}`;
    }
    if ('processed_count' in payload) {
      return `eligible ${Number(payload.eligible_marker_count || 0)} · processed ${Number(payload.processed_count || 0)}`;
    }
    return '';
  }

  function setAutomationStatusResult(message, payload = {}, options = {}) {
    state.automationStatus.lastResult = {
      message,
      detail: options.detail || automationStatusPayloadSummary(payload),
      tone: options.tone || 'info',
      at: Date.now(),
    };
  }

  function automationStatusResultHtml() {
    const result = state.automationStatus.lastResult;
    if (!result?.message) return '';
    return `<div class="kanban-backup-result" data-tone="${escHtml(result.tone || 'info')}" role="status">
      <strong>${escHtml(result.message)}</strong>
      ${result.detail ? `<span>${escHtml(result.detail)}</span>` : ''}
    </div>`;
  }

  function automationMarkerDisplayStatus(marker) {
    const status = String(marker?.status || '').toLowerCase();
    const retryState = String(marker?.retry_state || '').toLowerCase();
    if (retryState === 'retry_waiting') return 'retry waiting';
    if (retryState === 'retry_due') return 'retry due';
    const expiresAt = marker?.processing_expires_at || '';
    const expiry = expiresAt ? Date.parse(expiresAt) : NaN;
    if (status === 'processing' && Number.isFinite(expiry) && expiry <= Date.now()) return 'timed-out';
    if (status === 'queued') return 'pending';
    if (status === 'processing') return 'running';
    return status || 'unknown';
  }

  function automationMarkerTimingHtml(marker) {
    const parts = [
      marker.document_updated_at ? `review ${formatBackupDate(marker.document_updated_at)}` : '',
      marker.queued_at ? `queued ${formatBackupDate(marker.queued_at)}` : '',
      marker.processing_started_at ? `started ${formatBackupDate(marker.processing_started_at)}` : '',
      marker.processing_expires_at ? `expires ${formatBackupDate(marker.processing_expires_at)}` : '',
      marker.next_retry_at ? `retry ${formatBackupDate(marker.next_retry_at)}` : '',
      marker.processed_at ? `processed ${formatBackupDate(marker.processed_at)}` : '',
      marker.superseded_at ? `superseded ${formatBackupDate(marker.superseded_at)}` : '',
    ].filter(Boolean);
    return parts.map(part => `<span>${escHtml(part)}</span>`).join('');
  }

  function automationMarkerContextHtml(marker) {
    const error = marker.last_error || '';
    const errorClass = marker.last_error_class || '';
    const decision = marker.decision_id || '';
    const hash = marker.document_source_hash || marker.processed_source_hash || '';
    if (error) return `<span>${escHtml(errorClass ? `${errorClass}: ${error}` : error)}</span>`;
    if (decision) return `<span>${escHtml(decision)}</span>`;
    if (hash) return `<span>${escHtml(hash.slice(0, 19))}</span>`;
    return '<span>no marker note</span>';
  }

  function automationReviewMarkersHtml() {
    const scheduler = automationReviewScheduler();
    const preprocessingScheduler = automationPreprocessingScheduler();
    const byStatus = scheduler.by_status && typeof scheduler.by_status === 'object' ? scheduler.by_status : {};
    const preprocessingByStatus = preprocessingScheduler.by_status && typeof preprocessingScheduler.by_status === 'object' ? preprocessingScheduler.by_status : {};
    const markers = [...automationReviewMarkers(), ...automationPreprocessingMarkers()];
    const queueLength = Number(scheduler.queue_length ?? state.automationStatus.data?.review_processor?.queue_length ?? 0);
    const preprocessingQueueLength = Number(preprocessingScheduler.queue_length ?? state.automationStatus.data?.preprocessing?.queue_length ?? 0);
    const counts = [
      ['Pending', queueLength],
      ['Preprocess', preprocessingQueueLength],
      ['Running', Number(scheduler.active_count || byStatus.processing || 0)],
      ['Timed out', Number(scheduler.timeout_count || 0)],
      ['Retry waiting', Number(scheduler.retry_waiting_count || 0) + Number(preprocessingScheduler.retry_waiting_count || 0)],
      ['Retry due', Number(scheduler.retry_due_count || 0) + Number(preprocessingScheduler.retry_due_count || 0)],
      ['Cancelled', Number(byStatus.cancelled || 0) + Number(preprocessingByStatus.cancelled || 0)],
      ['Processed', Number(byStatus.processed || 0) + Number(preprocessingByStatus.processed || 0)],
      ['Failed', Number(byStatus.failed || 0) + Number(preprocessingByStatus.failed || 0)],
      ['Skipped', Number(byStatus.skipped || 0) + Number(preprocessingByStatus.skipped || 0)],
      ['Superseded', Number(scheduler.superseded_count || 0)],
    ];
    const chips = counts.map(([label, value]) => (
      `<span class="kanban-automation-queue-chip"><strong>${escHtml(String(value))}</strong>${escHtml(label)}</span>`
    )).join('');
    const rows = markers.map(marker => (
      `<article class="kanban-automation-marker" role="row" data-kanban-review-marker-id="${escHtml(marker.marker_id || '')}" data-status="${escHtml(marker.status || '')}">
        <div class="kanban-automation-marker-title" role="cell">
          <strong>${escHtml(marker.item_id || marker.marker_id || 'Review marker')}</strong>
          <span>${escHtml(marker.processor_kind || 'review')} · ${escHtml(marker.document_type || 'review')} · ${escHtml(marker.provider_mode || 'cloud-first')}</span>
        </div>
        <div class="kanban-automation-marker-status" role="cell">
          <strong>${escHtml(automationMarkerDisplayStatus(marker))}</strong>
          <span>${escHtml(marker.status || '')}</span>
        </div>
        <span role="cell">${escHtml(String(marker.attempt_count ?? 0))}</span>
        <div class="kanban-automation-marker-time" role="cell">${automationMarkerTimingHtml(marker)}</div>
        <div class="kanban-automation-marker-note" role="cell">${automationMarkerContextHtml(marker)}</div>
      </article>`
    )).join('');
    return `<div class="kanban-automation-section-head">Automation Markers</div>
      <div class="kanban-automation-queue-summary" aria-label="Automation queue counts">${chips}</div>
      <div class="kanban-automation-markers" role="table" aria-label="Automation markers">
        <div class="kanban-automation-marker kanban-automation-marker--head" role="row">
          <span role="columnheader">Item</span>
          <span role="columnheader">State</span>
          <span role="columnheader">Attempts</span>
          <span role="columnheader">Timing</span>
          <span role="columnheader">Note</span>
        </div>
        ${rows || '<div class="kanban-empty">No automation markers recorded.</div>'}
      </div>`;
  }

  function automationFailureAggregatesHtml() {
    const failures = automationFailureAggregates();
    const events = automationFailureEvents();
    const repeated = failures.filter(row => Number(row.attempt_count || 0) > 1).length;
    const waiting = failures.filter(row => row.retry_waiting).length;
    const historical = failures.filter(row => {
      const state = String(row.retry_state || row.marker_status || row.status || '').toLowerCase();
      return !row.retry_waiting && state !== 'retry_due' && state !== 'failed';
    }).length;
    const chips = [
      ['Active waiting', waiting],
      ['Repeated groups', repeated],
      ['Historical groups', historical],
      ['History events', events.length],
      ['Visible groups', failures.length],
    ].map(([label, value]) => (
      `<span class="kanban-automation-queue-chip"><strong>${escHtml(String(value))}</strong>${escHtml(label)}</span>`
    )).join('');
    const rows = failures.map(row => {
      const item = row.item_title || row.item_ref || row.item_id || row.marker_id || 'Automation failure';
      const lastError = row.last_error || row.error_message || '';
      const rawState = String(row.retry_state || row.marker_status || row.status || '').toLowerCase();
      const retryState = row.retry_waiting
        ? 'retry-waiting'
        : ((rawState && rawState !== 'failed' && rawState !== 'retry_due') ? 'historical' : (rawState || 'historical'));
      return `<article class="kanban-automation-failure" role="row" data-kanban-failure-marker-id="${escHtml(row.marker_id || '')}" data-retry-state="${escHtml(retryState)}">
        <div class="kanban-automation-marker-title" role="cell">
          <strong>${escHtml(item)}</strong>
          <span>${escHtml(row.item_ref || row.item_id || '')}</span>
        </div>
        <div class="kanban-automation-marker-status" role="cell">
          <strong>${escHtml(row.processor_kind || '')}</strong>
          <span>${escHtml(retryState)}</span>
        </div>
        <span role="cell">${escHtml(String(row.attempt_count ?? row.attempt_number ?? 0))}</span>
        <div class="kanban-automation-marker-time" role="cell">
          ${row.last_failed_at ? `<span>failed ${escHtml(formatBackupDate(row.last_failed_at))}</span>` : ''}
          ${row.next_retry_at ? `<span>retry ${escHtml(formatBackupDate(row.next_retry_at))}</span>` : ''}
        </div>
        <div class="kanban-automation-marker-note" role="cell">
          <span>${escHtml(row.error_class ? `${row.error_class}: ${lastError}` : lastError)}</span>
        </div>
      </article>`;
    }).join('');
    return `<div class="kanban-automation-section-head">Retry Failure History</div>
      <div class="kanban-automation-queue-summary" aria-label="Automation failure counts">${chips}</div>
      <div class="kanban-automation-failures" role="table" aria-label="Automation repeated failures">
        <div class="kanban-automation-failure kanban-automation-marker--head" role="row">
          <span role="columnheader">Item</span>
          <span role="columnheader">Processor</span>
          <span role="columnheader">Attempts</span>
          <span role="columnheader">Retry</span>
          <span role="columnheader">Last Error</span>
        </div>
        ${rows || '<div class="kanban-empty">No retryable automation failures recorded.</div>'}
      </div>`;
  }

  function automationOutputContractHtml() {
    const contract = state.automationStatus.data?.output_contract || {};
    const outputTypes = Array.isArray(contract.output_types) ? contract.output_types : [];
    if (!contract.schema && !outputTypes.length) return '';
    const provider = contract.provider_mode || {};
    const gate = provider.local_processing_gate || '';
    const typesHtml = outputTypes.map(output => {
      const label = output.label || output.type || output.decision_type || '';
      return `<span class="kanban-automation-contract-type">${escHtml(label)}</span>`;
    }).join('');
    return `<div class="kanban-automation-contract">
      <div class="kanban-automation-contract-main">
        <span>Output Contract</span>
        <strong>${escHtml(contract.status || 'active')}</strong>
        <em>${escHtml(contract.schema || '')}</em>
      </div>
      ${typesHtml ? `<div class="kanban-automation-contract-types" aria-label="Review Processor output types">${typesHtml}</div>` : ''}
      ${gate ? `<div class="kanban-automation-contract-gate">${escHtml(gate)}</div>` : ''}
    </div>`;
  }

  function automationProcessingPolicyHtml() {
    const policy = state.automationStatus.data?.processing_policy || {};
    if (!policy.schema) return '';
    const local = policy.local_processing || {};
    const appliesTo = Array.isArray(policy.applies_to) ? policy.applies_to : [];
    const appliesHtml = appliesTo.map(entry => (
      `<span class="kanban-automation-policy-chip">${escHtml(String(entry).replace(/_/g, ' '))}</span>`
    )).join('');
    const switchState = local.automatic_switch === false ? 'No automatic switch' : 'Explicit switch required';
    return `<div class="kanban-automation-policy">
      <div class="kanban-automation-policy-main">
        <span>Processing Policy</span>
        <strong>${escHtml(policy.active_mode || 'cloud-first')}</strong>
        <em>${escHtml(policy.schema || '')}</em>
      </div>
      ${appliesHtml ? `<div class="kanban-automation-policy-chips" aria-label="Policy applies to">${appliesHtml}</div>` : ''}
      <div class="kanban-automation-policy-gate">
        <span>${escHtml(local.state || 'planned-gated')}</span>
        <span>${escHtml(local.gate || 'structured-job-packets-required')}</span>
        <span>${escHtml(switchState)}</span>
      </div>
    </div>`;
  }

  function automationDecisionRowsHtml() {
    const rows = automationRecentDecisions();
    if (state.automationStatus.loading && !rows.length) {
      return '<div class="kanban-empty">Loading automation status...</div>';
    }
    if (state.automationStatus.error) {
      return `<div class="kanban-empty kanban-backup-error">${escHtml(state.automationStatus.error)}</div>`;
    }
    if (!rows.length) {
      return '<div class="kanban-empty">No Review Processor decisions recorded.</div>';
    }
    return `<div class="kanban-automation-decisions" role="table" aria-label="Recent Review Processor decisions">
      <div class="kanban-automation-decision kanban-automation-decision--head" role="row">
        <span role="columnheader">Decision</span>
        <span role="columnheader">Status</span>
        <span role="columnheader">Commits</span>
        <span role="columnheader">Updated</span>
      </div>
      ${rows.map(row => {
        const commitCount = Number(row.commit_count || row.commit_link_ids?.length || 0);
        const confidence = row.confidence ? ` · ${row.confidence}` : '';
        return `<article class="kanban-automation-decision" role="row" data-kanban-decision-id="${escHtml(row.decision_id || '')}">
          <div class="kanban-automation-decision-title" role="cell">
            <strong>${escHtml(row.title || row.summary || row.decision_id || 'Decision')}</strong>
            <span>${escHtml(row.summary || row.rationale || row.decision_type || '')}${escHtml(confidence)}</span>
          </div>
          <span role="cell">${escHtml(row.status || 'recorded')}</span>
          <span role="cell">${escHtml(String(commitCount))}</span>
          <span role="cell">${escHtml(formatBackupDate(row.updated_at || row.created_at))}</span>
        </article>`;
      }).join('')}
    </div>`;
  }

  function embeddedAutomationStatusHtml() {
    if (!state.automationStatus.data && !state.automationStatus.loading && !state.automationStatus.error) {
      setTimeout(() => loadAutomationStatusPanel({ force: true }), 0);
    }
    const data = state.automationStatus.data || {};
    const processor = data.review_processor || {};
    const decisions = data.decisions || {};
    const health = data.commit_link_health || {};
    const provider = data.provider_mode || {};
    const idleWorker = data.idle_worker || {};
    const pre = data.preprocessing || {};
    const exclusions = data.automation_exclusions || {};
    const outputContract = data.output_contract || {};
    const processingPolicy = data.processing_policy || {};
    const scheduler = automationReviewScheduler();
    const outputTypeCount = Array.isArray(outputContract.output_types) ? outputContract.output_types.length : 0;
    const queueLength = Number(scheduler.queue_length ?? processor.queue_length ?? 0);
    const activeCount = Number(scheduler.active_count || 0);
    const timeoutCount = Number(scheduler.timeout_count || 0);
    const failures = automationFailureAggregates();
    const failureEvents = automationFailureEvents();
    const failureCount = Number(data.failures?.event_count ?? failureEvents.length ?? 0);
    const repeatedFailureCount = Number(data.failures?.repeated_failure_count ?? failures.filter(row => Number(row.attempt_count || 0) > 1).length);
    const retryWaitingCount = Number(data.failures?.retry_waiting_count ?? failures.filter(row => row.retry_waiting).length);
    const preprocessingScheduler = automationPreprocessingScheduler();
    const retryDueCount = Number(scheduler.retry_due_count || 0) + Number(preprocessingScheduler.retry_due_count || 0);
    const decisionCount = Number(decisions.count ?? decisions.total ?? 0);
    const exclusionCount = Number(exclusions.count ?? 0);
    const healthDecisionCount = Number(health.decision_count ?? health.decisions ?? 0);
    const activeItem = processor.active_item_id || 'none';
    const healthOk = health.ok !== false;
    const busy = state.automationStatus.loading;
    const scanBusy = state.automationStatus.busyAction === 'scan-reviews';
    const requeueBusy = state.automationStatus.busyAction === 'requeue-timeouts';
    const tickBusy = state.automationStatus.busyAction === 'run-idle-tick';
    const loadedAt = state.automationStatus.lastLoadedAt ? formatBackupDate(state.automationStatus.lastLoadedAt) : '';
    const workerNodeLoaded = !!(idleWorker.schema || idleWorker.current_node_id || idleWorker.owner_node_id);
    const workerNodeState = workerNodeLoaded
      ? (idleWorker.runs_on_this_node ? 'active here' : 'standby')
      : 'not loaded';
    const workerNodeDetail = workerNodeLoaded
      ? `owner ${idleWorker.owner_node_id || 'unknown'} · this ${idleWorker.current_node_id || 'unknown'}`
      : '';
    const workerNodeTone = workerNodeLoaded ? (idleWorker.effective_enabled === false ? 'warn' : 'ok') : 'info';
    return `<section class="calendar-band kanban-band kanban-automation-panel" aria-label="Kanban Automation Status">
      <div class="calendar-section-head kanban-section-head">
        <h3>Automation Status</h3>
        <div class="kanban-backups-toolbar kanban-automation-controls">
          <button class="kanban-command-btn" type="button" data-kanban-automation-action="scan-reviews"${busy ? ' disabled' : ''}>${scanBusy ? 'Scanning...' : 'Scan Review Docs'}</button>
          <button class="kanban-command-btn" type="button" data-kanban-automation-action="run-idle-tick"${busy ? ' disabled' : ''}>${tickBusy ? 'Running...' : 'Run Due Work'}</button>
          <button class="kanban-command-btn" type="button" data-kanban-automation-action="requeue-timeouts"${busy ? ' disabled' : ''}>${requeueBusy ? 'Requeueing...' : 'Requeue Timeouts'}</button>
          <button class="kanban-command-btn" type="button" data-kanban-automation-action="refresh"${busy ? ' disabled' : ''}>Refresh</button>
        </div>
      </div>
      <div class="kanban-automation-grid">
        ${automationMetricHtml('Review Processor', processor.status || 'not loaded', `queue ${queueLength} · active ${activeItem}`, queueLength ? 'warn' : 'ok')}
        ${automationMetricHtml('Queue Work', `${queueLength} pending`, `running ${activeCount} · timed out ${timeoutCount}`, timeoutCount ? 'warn' : (queueLength ? 'info' : 'ok'))}
        ${automationMetricHtml('Active Retries', `${retryWaitingCount} waiting`, `due ${retryDueCount} · repeated ${repeatedFailureCount} · history ${failureCount} events`, (retryWaitingCount || retryDueCount) ? 'warn' : (failureCount ? 'info' : 'ok'))}
        ${automationMetricHtml('Worker Node', workerNodeState, workerNodeDetail, workerNodeTone)}
        ${automationMetricHtml('Provider', provider.active || 'cloud-first', provider.planned || provider.local_processing || 'local later', 'info')}
        ${automationMetricHtml('Decisions', String(decisionCount), `recent ${automationRecentDecisions().length}`, decisionCount ? 'ok' : 'info')}
        ${automationMetricHtml('Commit Links', healthOk ? 'ok' : 'needs review', `${health.decisions_with_commits ?? 0}/${healthDecisionCount} with commits`, healthOk ? 'ok' : 'warn')}
        ${automationMetricHtml('Hook Failures', String(health.hook_failure_count ?? 0), `${health.missing_commit_link_count ?? 0} missing commit links`, Number(health.hook_failure_count || health.missing_commit_link_count || 0) ? 'warn' : 'ok')}
        ${automationMetricHtml('Preprocessing', pre.status || 'contract-pending', pre.job_packet_contract || '', pre.status === 'ready' ? 'ok' : 'info')}
        ${automationMetricHtml('Excluded Branches', String(exclusionCount), `${(exclusions.recent_items || []).length} visible`, exclusionCount ? 'info' : 'ok')}
        ${automationMetricHtml('Output Contract', outputContract.status || 'not loaded', `${outputTypeCount} output types`, outputContract.status === 'active' ? 'ok' : 'info')}
        ${automationMetricHtml('Policy', processingPolicy.active_mode || 'cloud-first', processingPolicy.local_processing?.gate || provider.local_processing_gate || '', 'info')}
      </div>
      ${loadedAt ? `<div class="kanban-backup-paths"><span>Loaded: ${escHtml(loadedAt)}</span></div>` : ''}
      ${state.automationStatus.loading ? '<div class="kanban-backup-result" data-tone="info" role="status"><strong>Loading automation status...</strong></div>' : ''}
      ${automationStatusResultHtml()}
      ${automationReviewMarkersHtml()}
      ${automationFailureAggregatesHtml()}
      ${automationProcessingPolicyHtml()}
      ${automationOutputContractHtml()}
      <div class="kanban-automation-section-head">Recent Decisions</div>
      ${automationDecisionRowsHtml()}
    </section>`;
  }

  function refreshAutomationStatusModal() {
    const body = document.querySelector('#kanban-automation-status-modal [data-kanban-automation-modal-body]');
    if (!body) return;
    body.innerHTML = embeddedAutomationStatusHtml();
  }

  function refreshAutomationStatusPanels() {
    if (!window.PersonalFilters?.activateTab) return;
    document.querySelectorAll('[data-personal-filter-host][data-personal-filter-surface="kanban"]').forEach(host => {
      if (host.dataset.personalFilterTab !== 'automation') return;
      if (!hostIsVisible(host)) return;
      window.PersonalFilters.activateTab('kanban', 'automation', { host, visibleOnly: false });
    });
  }

  async function loadAutomationStatusPanel(options = {}) {
    if (state.automationStatus.loading && !options.force) return state.automationStatus.data;
    state.automationStatus.loading = true;
    state.automationStatus.error = '';
    refreshAutomationStatusPanels();
    try {
      state.automationStatus.data = await requestJson('/api/v1/personal/kanban/automation/status');
      state.automationStatus.lastLoadedAt = Date.now();
      return state.automationStatus.data;
    } catch (err) {
      state.automationStatus.error = err?.message || String(err);
      return null;
    } finally {
      state.automationStatus.loading = false;
      refreshAutomationStatusPanels();
      refreshAutomationStatusModal();
    }
  }

  function openAutomationStatusModal() {
    const dialog = openDialog('Kanban Automation Status', `<div data-kanban-automation-modal-body>${embeddedAutomationStatusHtml()}</div>`, {
      badge: 'AUTO',
      id: 'kanban-automation-status-modal',
      width: 'min(1220px, calc(100vw - 28px))',
    });
    dialog.addEventListener('click', event => {
      const button = event.target.closest('[data-kanban-automation-action]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      const result = handleAutomationStatusAction(button);
      refreshAutomationStatusModal();
      if (result && typeof result.finally === 'function') {
        result.finally(() => refreshAutomationStatusModal());
      }
    });
    return dialog;
  }

  async function openAutomationStatusPanel() {
    const activated = activateKanbanPanelTab('automation');
    if (!activated) openAutomationStatusModal();
    await loadAutomationStatusPanel({ force: true });
    refreshAutomationStatusModal();
    return true;
  }

  function handleAutomationStatusAction(button) {
    const action = button?.dataset?.kanbanAutomationAction || '';
    if (action === 'refresh') return loadAutomationStatusPanel({ force: true });
    if (action === 'scan-reviews') return runAutomationStatusControl('scan-reviews');
    if (action === 'requeue-timeouts') return runAutomationStatusControl('requeue-timeouts');
    if (action === 'run-idle-tick') return runAutomationStatusControl('run-idle-tick');
    return null;
  }

  async function runAutomationStatusControl(action) {
    if (state.automationStatus.busyAction) return null;
    const requestId = `kanban-automation-${action}-${Date.now()}`;
    const body = {
      actor: 'blueprints-ui',
      source_surface: 'kanban-automation-status',
      request_id: requestId,
      run_id: requestId,
      metadata: {
        action,
        surface: 'kanban-automation-status',
      },
    };
    let path = '';
    if (action === 'scan-reviews') {
      path = '/api/v1/personal/kanban/automation/review-processor/idle-scan';
      body.max_items = 150;
      setAutomationStatusResult('Scanning Review documents...', {}, { tone: 'info' });
    } else if (action === 'requeue-timeouts') {
      path = '/api/v1/personal/kanban/automation/review-processor/requeue-timeouts';
      setAutomationStatusResult('Requeueing timed-out Review work...', {}, { tone: 'info' });
    } else if (action === 'run-idle-tick') {
      path = '/api/v1/personal/kanban/automation/idle-worker/tick';
      body.max_scan_items = 150;
      body.max_process_items = 5;
      body.holder_id = 'kanban-automation-status';
      setAutomationStatusResult('Running due automation work...', {}, { tone: 'info' });
    } else {
      return null;
    }
    state.automationStatus.busyAction = action;
    state.automationStatus.loading = true;
    state.automationStatus.error = '';
    refreshAutomationStatusPanels();
    refreshAutomationStatusModal();
    try {
      const payload = await requestJson(path, { method: 'POST', body: JSON.stringify(body) });
      if (action === 'scan-reviews') {
        setAutomationStatusResult('Review scan complete.', payload, { tone: payload.queued_count ? 'ok' : 'info' });
      } else if (action === 'run-idle-tick') {
        setAutomationStatusResult('Due automation run complete.', payload, { tone: payload.processed_count ? 'ok' : 'info' });
      } else {
        setAutomationStatusResult('Timeout requeue complete.', payload, { tone: payload.requeued_count ? 'ok' : 'info' });
      }
      await loadAutomationStatusPanel({ force: true });
      return payload;
    } catch (err) {
      const message = err?.message || String(err);
      const failedLabel = action === 'scan-reviews'
        ? 'Review scan failed.'
        : (action === 'run-idle-tick' ? 'Due automation run failed.' : 'Timeout requeue failed.');
      setAutomationStatusResult(failedLabel, {}, {
        detail: message,
        tone: 'err',
      });
      return null;
    } finally {
      state.automationStatus.loading = false;
      state.automationStatus.busyAction = '';
      refreshAutomationStatusPanels();
      refreshAutomationStatusModal();
    }
  }

  function refreshActiveDetailPanels() {
    if (!window.PersonalFilters?.activateTab) return;
    document.querySelectorAll('[data-personal-filter-host][data-personal-filter-surface="kanban"]').forEach(host => {
      if (host.dataset.personalFilterTab !== 'edit-item') return;
      if (!hostIsVisible(host)) return;
      syncDetailDraftFromScope(host);
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
        const payload = await requestJson(`/api/v1/personal/kanban/items/${encodeURIComponent(item.item_id)}/rollup`);
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
        state.config = await requestJson('/api/v1/personal/kanban/config');
        applyPreferences(state.config);
      }
      const path = state.currentParentId
        ? `/api/v1/personal/kanban/items/${encodeURIComponent(state.currentParentId)}/board`
        : '/api/v1/personal/kanban/board';
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
      const payload = await requestJson('/api/v1/personal/kanban/preferences', {
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

  function itemFormHtml(titleValue = '', bodyValue = '', priorityId = 'medium', depthInfo = null, goalFlag = false, automationExcluded = false) {
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
          ${goalFlagCheckboxHtml('kanban-modal-goal-flag', goalFlag)}
          ${automationExcludedCheckboxHtml('kanban-modal-automation-excluded', automationExcluded)}
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
    const dialog = openDialog(childOfSelection ? 'New Child Item' : 'New Item', itemFormHtml(title, '', 'medium', depthInfo), {
      badge: 'ITEM',
      id: childOfSelection ? 'kanban-child-item-modal' : 'kanban-item-modal',
    });
    const titleInput = dialog.querySelector('#kanban-modal-title');
    const bodyInput = dialog.querySelector('#kanban-modal-body');
    const priorityInput = dialog.querySelector('#kanban-modal-priority');
    const goalFlagInput = dialog.querySelector('#kanban-modal-goal-flag');
    const automationExcludedInput = dialog.querySelector('#kanban-modal-automation-excluded');
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
        goal_flag: Boolean(goalFlagInput?.checked),
        automation_excluded: Boolean(automationExcludedInput?.checked),
        tags: itemTagIds(NEW_ITEM_TAG_SURFACE),
        actor: 'blueprints-ui',
        source_surface: 'kanban-page',
        request_id: `ui-kanban-item-${Date.now()}`,
      };
      const resp = await requestJson('/api/v1/personal/kanban/items', {
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
    const goalFlagInput = el(`${prefix}-goal-flag`);
    const automationExcludedInput = el(`${prefix}-automation-excluded`);
    const status = el(`${prefix}-status`);
    const cleanTitle = String(titleInput?.value || '').trim();
    if (!cleanTitle) {
      if (status) status.textContent = 'Title is required.';
      return false;
    }
    if (status) status.textContent = 'Saving item...';
    const resp = await requestJson('/api/v1/personal/kanban/items', {
      method: 'POST',
      body: JSON.stringify({
        parent_item_id: state.currentParentId || null,
        title: cleanTitle,
        body: bodyInput?.value || '',
        state_id: 'todo',
        priority_id: priorityInput?.value || 'medium',
        goal_flag: Boolean(goalFlagInput?.checked),
        automation_excluded: Boolean(automationExcludedInput?.checked),
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
    if (goalFlagInput) goalFlagInput.checked = false;
    if (automationExcludedInput) automationExcludedInput.checked = false;
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
      const endpoint = kind === 'issue' ? '/api/v1/personal/kanban/issues' : '/api/v1/personal/kanban/todos';
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
      goalFlag: Boolean(item.goal_flag),
      automationExcluded: Boolean(item.automation_excluded),
      tags: itemTagIds(EDIT_ITEM_TAG_SURFACE, item.tags || []),
      body: item.body_excerpt || '',
      detailBody: detail?.detail_document?.body || '',
      reviewBody: detail?.review_document?.body || '',
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
    if (key === 'goalFlag') return Boolean(draft?.goalFlag);
    if (key === 'automationExcluded') return Boolean(draft?.automationExcluded);
    return draft ? String(draft[key] ?? '') : '';
  }

  function updateDetailDraftFromField(field) {
    if (!field?.dataset?.kanbanDetailField) return false;
    const draft = ensureDetailDraft();
    if (!draft) return false;
    const key = field.dataset.kanbanDetailField;
    return updateDetailDraftValue(key, field.type === 'checkbox' ? Boolean(field.checked) : field.value);
  }

  function updateDetailDraftValue(key, value) {
    const draft = ensureDetailDraft();
    if (!draft) return false;
    if (String(key || '').startsWith('discussion:')) {
      const discussionId = String(key).slice('discussion:'.length);
      draft.discussions = draft.discussions || {};
      draft.discussions[discussionId] = value;
      return true;
    }
    if (!Object.prototype.hasOwnProperty.call(draft, key)) return false;
    if (key === 'goalFlag' || key === 'automationExcluded') {
      draft[key] = value === true || value === 'true' || value === 1 || value === '1';
      return true;
    }
    draft[key] = value;
    return true;
  }

  function detailDraftDirty() {
    if (!state.detailDraft?.itemId) return false;
    const baseline = detailDraftFromDetail(state.detail || {});
    if (!baseline.itemId || baseline.itemId !== state.detailDraft.itemId) return true;
    return JSON.stringify(state.detailDraft) !== JSON.stringify(baseline);
  }

  function kanbanFocusedField() {
    const active = document.activeElement;
    if (!active || active === document.body || !active.closest) return false;
    const editingField = active.matches?.('input, textarea, select, [contenteditable="true"]');
    if (!editingField) return false;
    return !!active.closest('[data-kanban-board], #kanban-filter-inline-panel, #ultrawide-sidecar-body, dialog[id^="kanban-"]');
  }

  function openKanbanEditorDialog() {
    return Array.from(document.querySelectorAll('dialog[id^="kanban-"]')).some(dialog => dialog.open);
  }

  function externalRefreshSkipReason() {
    if (state.loading) return 'loading';
    if (document.body?.classList?.contains('is-dragging-kanban-card')) return 'card-drag';
    if (document.body?.classList?.contains('is-resizing-kanban-lane')) return 'lane-resize';
    if (state.scoped.open || el('kanban-scoped-modal')?.open) return 'scoped-modal';
    if (openKanbanEditorDialog()) return 'dialog';
    if (state.discussionEditMode) return 'discussion-edit';
    if (detailDraftDirty()) return 'draft-dirty';
    if (kanbanFocusedField()) return 'field-focus';
    return '';
  }

  async function externalRefresh(options = {}) {
    const reason = externalRefreshSkipReason();
    if (reason) {
      state.lastExternalRefresh = {
        skipped: true,
        reason,
        itemId: String(options.itemId || ''),
        parentItemId: String(options.parentItemId || ''),
        stateId: String(options.stateId || ''),
        at: Date.now(),
      };
      return false;
    }
    await load({ force: true, skipRouteDetail: true, skipRouteScoped: true });
    state.lastExternalRefresh = {
      skipped: false,
      reason: '',
      itemId: String(options.itemId || ''),
      parentItemId: String(options.parentItemId || ''),
      stateId: String(options.stateId || ''),
      at: Date.now(),
    };
    return true;
  }

  function refreshDetailFieldPreview(field, value) {
    if (!field) return;
    const previewId = field.dataset?.rmePreviewId || (field.id ? `${field.id}-preview` : '');
    const preview = previewId ? el(previewId) : field.closest?.('.calendar-markdown-field')?.querySelector?.('.calendar-markdown-preview');
    if (!preview || preview.hidden) return;
    const shell = field.closest?.('[data-rme-field-shell]');
    preview.innerHTML = renderEditorMarkdown(value, shell?.dataset?.rmeEmptyText || 'No content.');
  }

  function syncDetailDraftFieldByKey(key, sourceField = null) {
    if (!key || !state.detailDraft) return;
    const value = detailDraftValue(key);
    document.querySelectorAll(`[data-kanban-detail-field="${key}"]`).forEach(field => {
      if (field !== sourceField && field.type === 'checkbox') field.checked = Boolean(value);
      else if (field !== sourceField && 'value' in field) field.value = value;
      refreshDetailFieldPreview(field, value);
    });
  }

  function syncDetailDraftFields(sourceField) {
    syncDetailDraftFieldByKey(sourceField?.dataset?.kanbanDetailField || '', sourceField);
  }

  function syncDetailDraftFromScope(scope) {
    scope?.querySelectorAll?.('[data-kanban-detail-field]').forEach(updateDetailDraftFromField);
  }

  function syncOpenDetailDraftSurfaces() {
    const activeWorkspace = document.activeElement?.closest?.('.kanban-detail-workspace');
    if (activeWorkspace) syncDetailDraftFromScope(activeWorkspace);
    document.querySelectorAll('.kanban-detail-workspace').forEach(workspace => {
      if (workspace === activeWorkspace) return;
      if (!hostIsVisible(workspace) && !workspace.closest?.('dialog[open]')) return;
      syncDetailDraftFromScope(workspace);
    });
  }

  function handleRichMarkdownDraft(event) {
    const detail = event?.detail || {};
    const context = detail.context || {};
    if (context.domain !== 'kanban') return;
    const key = detail.fieldName || '';
    if (!key) return;
    const draft = ensureDetailDraft();
    if (!draft) return;
    const contextItem = context.item_id || context.itemId || '';
    if (contextItem && draft.itemId && contextItem !== draft.itemId) return;
    if (!updateDetailDraftValue(key, String(detail.value || ''))) return;
    syncDetailDraftFieldByKey(key, detail.targetId ? el(detail.targetId) : null);
  }

  function detailItemAvailable() {
    return Boolean(state.detail?.item?.item_id);
  }

  function countBadge(count) {
    const value = Number(count || 0);
    return `<span class="kanban-detail-count">${escHtml(value)}</span>`;
  }

  function itemAiDecisionRows(detail) {
    const rows = detail?.ai_decisions || detail?.decisions;
    return Array.isArray(rows) ? rows : [];
  }

  function itemAiDecisionCount(detail) {
    const explicit = Number(detail?.ai_decision_count ?? detail?.decision_count ?? detail?.counts?.decisions);
    return Number.isFinite(explicit) ? explicit : itemAiDecisionRows(detail).length;
  }

  function itemAiDecisionHealth(detail) {
    const health = detail?.ai_decision_commit_link_health || detail?.commit_link_health || {};
    return health && typeof health === 'object' ? health : {};
  }

  function aiDecisionMetricHtml(label, value, meta = '', tone = '') {
    return `<div class="kanban-ai-decision-metric${tone ? ` kanban-ai-decision-metric--${escHtml(tone)}` : ''}">
      <span>${escHtml(label)}</span>
      <strong>${escHtml(value ?? '')}</strong>
      ${meta ? `<em>${escHtml(meta)}</em>` : ''}
    </div>`;
  }

  function aiDecisionTextBlock(label, value) {
    const text = String(value || '').trim();
    if (!text) return '';
    return `<div class="kanban-ai-decision-text">
      <span>${escHtml(label)}</span>
      <p>${escHtml(text)}</p>
    </div>`;
  }

  function aiDecisionRefsHtml(label, refs) {
    const list = Array.isArray(refs) ? refs.filter(Boolean).slice(0, 12) : [];
    if (!list.length) return '';
    return `<div class="kanban-ai-decision-refs" aria-label="${escHtml(label)}">
      <span>${escHtml(label)}</span>
      <div>${list.map(ref => `<code>${escHtml(ref)}</code>`).join('')}</div>
    </div>`;
  }

  function aiDecisionCommitsHtml(decision) {
    const commits = Array.isArray(decision?.commits) ? decision.commits : [];
    const commitIds = Array.isArray(decision?.commit_link_ids) ? decision.commit_link_ids : [];
    const commitCount = Number(decision?.commit_count ?? commits.length ?? commitIds.length ?? 0);
    if (!commits.length && !commitIds.length && !commitCount) {
      return `<div class="kanban-ai-decision-commits" data-tone="warn"><span>Commit Links</span><strong>none recorded</strong></div>`;
    }
    const commitRows = commits.slice(0, 4).map(commit => {
      const label = commit.message_subject || commit.short_sha || commit.sha || commit.commit_link_id || 'Commit';
      const meta = [commit.repo_full_name || '', commit.short_sha || String(commit.sha || '').slice(0, 7)].filter(Boolean).join(' · ');
      const href = String(commit.html_url || '').trim();
      const title = href
        ? `<a href="${escHtml(href)}" target="_blank" rel="noopener noreferrer">${escHtml(label)}</a>`
        : `<strong>${escHtml(label)}</strong>`;
      return `<li>${title}${meta ? `<span>${escHtml(meta)}</span>` : ''}</li>`;
    }).join('');
    const fallbackIds = !commitRows && commitIds.length
      ? commitIds.slice(0, 6).map(id => `<code>${escHtml(id)}</code>`).join('')
      : '';
    return `<div class="kanban-ai-decision-commits" data-tone="ok">
      <span>Commit Links</span>
      <strong>${escHtml(String(commitCount || commits.length || commitIds.length))} attached</strong>
      ${commitRows ? `<ul>${commitRows}</ul>` : `<div class="kanban-ai-decision-commit-ids">${fallbackIds}</div>`}
    </div>`;
  }

  function aiDecisionCardHtml(decision) {
    const status = decision?.status || 'recorded';
    const provider = decision?.provider_mode || 'provider unknown';
    const confidence = decision?.confidence || '';
    const updated = formatBackupDate(decision?.updated_at || decision?.created_at);
    return `<article class="kanban-ai-decision-card" data-kanban-ai-decision-id="${escHtml(decision?.decision_id || '')}">
      <div class="kanban-ai-decision-card__head">
        <div>
          <strong>${escHtml(decision?.title || decision?.summary || decision?.decision_id || 'AI Decision')}</strong>
          <span>${escHtml(decision?.decision_type || decision?.processor_kind || '')}</span>
        </div>
        <div class="kanban-ai-decision-chips" aria-label="AI decision status">
          <span>${escHtml(status)}</span>
          <span>${escHtml(provider)}</span>
          ${confidence ? `<span>${escHtml(confidence)}</span>` : ''}
          ${updated ? `<span>${escHtml(updated)}</span>` : ''}
        </div>
      </div>
      ${aiDecisionTextBlock('Summary', decision?.summary)}
      ${aiDecisionTextBlock('Rationale', decision?.rationale)}
      ${aiDecisionTextBlock('Uncertainty', decision?.uncertainty)}
      ${aiDecisionRefsHtml('Affected Refs', decision?.affected_refs)}
      ${aiDecisionRefsHtml('Proof Refs', decision?.proof_refs)}
      ${aiDecisionCommitsHtml(decision)}
    </article>`;
  }

  function aiDecisionsSectionHtml(detail) {
    const rows = itemAiDecisionRows(detail);
    const count = itemAiDecisionCount(detail);
    const health = itemAiDecisionHealth(detail);
    const healthDecisionCount = Number(health.decision_count ?? count ?? 0);
    const healthOk = health.ok !== false;
    const missingCount = Number(health.missing_commit_link_count || 0);
    const hookFailures = Number(health.hook_failure_count || 0);
    const healthTone = !healthDecisionCount ? 'info' : (healthOk ? 'ok' : 'warn');
    const error = String(detail?.ai_decision_error || '').trim();
    return `<div class="kanban-ai-decisions">
      <div class="kanban-ai-decision-summary">
        ${aiDecisionMetricHtml('AI Decisions', String(count), 'card-scoped ledger rows', count ? 'ok' : 'info')}
        ${aiDecisionMetricHtml('Commit Link Health', healthOk ? 'ok' : 'needs review', `${health.decisions_with_commits ?? 0}/${healthDecisionCount} with commits`, healthTone)}
        ${aiDecisionMetricHtml('Link Gaps', String(missingCount + hookFailures), `${missingCount} missing · ${hookFailures} hook failures`, missingCount || hookFailures ? 'warn' : 'ok')}
      </div>
      ${error ? `<div class="kanban-empty kanban-backup-error">AI Decisions could not be loaded: ${escHtml(error)}</div>` : ''}
      ${!error && !rows.length ? '<div class="kanban-empty">No AI Decisions recorded for this card.</div>' : ''}
      ${rows.map(aiDecisionCardHtml).join('')}
    </div>`;
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

  function reviewDocumentSectionHtml(detail) {
    const draft = ensureDetailDraft(detail) || detailDraftFromDetail(detail);
    return `
      <div class="kanban-detail-doc kanban-review-doc">
        ${markdownFieldHtml('kanban-item-review-doc', 'Review', draft.reviewBody || '', {
          detail: true,
          fieldName: 'reviewBody',
          previewDefault: true,
          maxlength: 120000,
          emptyText: 'No review notes yet.',
        })}
        <div class="kanban-modal-actions kanban-modal-actions--compact">
          <span class="kanban-detail-save-status" data-kanban-review-document-status></span>
          <button class="kanban-command-btn" type="button" data-kanban-detail-action="save-review-doc">Save Review</button>
        </div>
      </div>`;
  }

  function discussionBodyHtml(id, fieldName, value = '', { editMode = false, newEntry = false } = {}) {
    const safeId = String(id || 'kanban-discussion').replace(/[^a-zA-Z0-9_-]/g, '-');
    const itemId = state.detail?.item?.item_id || '';
    const discussionId = String(fieldName || '').startsWith('discussion:')
      ? String(fieldName).slice('discussion:'.length)
      : '';
    if (window.BlueprintsRichMarkdown?.fieldHtml) {
      return window.BlueprintsRichMarkdown.fieldHtml({
        textareaId: safeId,
        previewId: `${safeId}-preview`,
        label: newEntry ? 'New discussion' : 'Discussion entry',
        value,
        rows: newEntry ? 6 : 8,
        maxlength: 120000,
        previewDefault: !editMode && !newEntry,
        emptyText: 'No discussion text.',
        wrapperClass: 'kanban-field kanban-field--markdown calendar-markdown-field kanban-discussion-field',
        textareaClass: 'kanban-discussion-textarea',
        previewClass: 'kanban-discussion-preview',
        textareaAttrs: {
          'data-kanban-detail-field': fieldName,
          'aria-label': newEntry ? 'New discussion' : 'Discussion entry',
        },
        context: {
          domain: 'kanban',
          documentType: 'discussion',
          documentId: discussionId || `${itemId || 'item'}-new-discussion`,
          itemId,
          discussionId,
        },
      });
    }
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
    const reviewCount = detail?.counts?.review ?? (String(detail?.review_document?.body || '').trim() ? 1 : 0);
    const decisionCount = itemAiDecisionCount(detail);
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
        id: 'review',
        label: 'Review',
        count: reviewCount,
        html: reviewDocumentSectionHtml(detail),
      },
      {
        id: 'ai-decisions',
        label: 'AI Decisions',
        count: decisionCount,
        html: aiDecisionsSectionHtml(detail),
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
            ${goalFlagCheckboxHtml(`${prefix}-goal-flag-input`, Boolean(draft.goalFlag), 'data-kanban-detail-field="goalFlag"')}
            ${automationExcludedCheckboxHtml(`${prefix}-automation-excluded-input`, Boolean(draft.automationExcluded), 'data-kanban-detail-field="automationExcluded"')}
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
            <button class="kanban-icon-btn kanban-icon-btn--share kanban-detail-share-btn" type="button" data-kanban-detail-action="share" title="Copy share code" aria-label="Copy share code"></button>
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
    const resp = await requestJson(`/api/v1/personal/kanban/items/${encodeURIComponent(cleanItemId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: cleanTitle,
        body: draft.body || '',
        state_id: draft.stateId || 'todo',
        priority_id: draft.priorityId || 'medium',
        goal_flag: Boolean(draft.goalFlag),
        automation_excluded: Boolean(draft.automationExcluded),
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
    const resp = await requestJson(`/api/v1/personal/kanban/items/${encodeURIComponent(cleanItemId)}/detail`, {
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

  async function saveReviewDocument(itemId = state.detail?.item?.item_id, options = {}) {
    if (options.scope) syncDetailDraftFromScope(options.scope);
    const draft = ensureDetailDraft();
    const cleanItemId = itemId || draft?.itemId || '';
    const status = options.statusEl || null;
    if (!cleanItemId || !draft) return false;
    if (status) status.textContent = 'Saving review...';
    const resp = await requestJson(`/api/v1/personal/kanban/items/${encodeURIComponent(cleanItemId)}/review`, {
      method: 'PUT',
      body: JSON.stringify({
        body: draft.reviewBody || '',
        actor: 'blueprints-ui',
        source_surface: 'kanban-detail',
        request_id: `ui-kanban-review-doc-${Date.now()}`,
      }),
    });
    state.lastWrite = resp;
    if (status) status.textContent = 'Review saved.';
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
      state.lastWrite = await requestJson(`/api/v1/personal/kanban/discussions/${encodeURIComponent(discussionId)}`, {
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
      state.lastWrite = await requestJson(`/api/v1/personal/kanban/items/${encodeURIComponent(cleanItemId)}/discussions`, {
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
      state.lastWrite = await requestJson(`/api/v1/personal/kanban/discussions/${encodeURIComponent(discussionId)}`, {
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
        <label class="kanban-field" for="kanban-link-target"><span>Target Share Code / Item ID</span><input id="kanban-link-target" type="text" maxlength="220" /></label>
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
      const targetItemId = kanbanItemIdFromShareRef(targetInput?.value);
      if (!targetItemId) {
        await HubDialogs.alert({ title: 'Kanban', message: 'Target share code or item id is required.', tone: 'warning' });
        return;
      }
      state.lastWrite = await requestJson(`/api/v1/personal/kanban/items/${encodeURIComponent(itemId)}/links`, {
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
        <label class="kanban-field" for="kanban-blocker-ref"><span>Blocked By Share Code / Ref</span><input id="kanban-blocker-ref" type="text" maxlength="260" /></label>
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
      state.lastWrite = await requestJson('/api/v1/personal/kanban/blockers', {
        method: 'POST',
        body: JSON.stringify({
          item_id: itemId,
          title: cleanTitle,
          body: bodyInput?.value || '',
          blocked_by_ref: kanbanGraphRefFromShareRef(refInput?.value),
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

  async function loadItemDecisionLedger(itemId) {
    const cleanItemId = cleanRouteId(itemId);
    if (!cleanItemId) {
      return {
        ai_decisions: [],
        ai_decision_count: 0,
        ai_decision_commit_link_health: {},
        ai_decision_error: '',
      };
    }
    try {
      const payload = await requestJson(`/api/v1/personal/kanban/items/${encodeURIComponent(cleanItemId)}/decisions?limit=50`);
      const rows = Array.isArray(payload?.decisions) ? payload.decisions : [];
      return {
        ai_decisions: rows,
        ai_decision_count: Number(payload?.count ?? rows.length ?? 0),
        ai_decision_commit_link_health: payload?.commit_link_health || {},
        ai_decision_error: '',
      };
    } catch (err) {
      return {
        ai_decisions: [],
        ai_decision_count: 0,
        ai_decision_commit_link_health: {},
        ai_decision_error: err?.message || String(err),
      };
    }
  }

  async function loadItemDetail(itemId = state.selection?.item?.item_id, options = {}) {
    itemId = itemId || selectFirstItemIfNeeded();
    if (!itemId) {
      await HubDialogs.alert({ title: 'Kanban', message: 'Select a card first.', tone: 'warning' });
      return null;
    }
    const detail = await requestJson(`/api/v1/personal/kanban/items/${encodeURIComponent(itemId)}`);
    const item = detail.item || {};
    if (itemHiddenByPreference(item)) {
      clearDetailSelectionState('hiddenDetailSuppressed');
      renderAll();
      return null;
    }
    Object.assign(detail, await loadItemDecisionLedger(item.item_id || itemId));
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

  function kanbanItemIdFromSearchResult(result = {}) {
    const page = result.page_ref || {};
    const direct = page.item_id || result.item_id || result.record_id || '';
    const cleanDirect = cleanRouteId(direct);
    if (cleanDirect) return cleanDirect;
    const refs = [
      result.document_id,
      result.source_ref,
      ...(Array.isArray(result.source_refs) ? result.source_refs : []),
    ].filter(Boolean);
    for (const ref of refs) {
      const text = String(ref || '');
      const xartaMatch = text.match(/xarta-kanban:item:([a-zA-Z0-9_.:-]+)/);
      if (xartaMatch?.[1]) return cleanRouteId(xartaMatch[1]);
      const kanbanMatch = text.match(/(?:^|[/:\s])(kanban-[a-zA-Z0-9_.:-]+)/);
      if (kanbanMatch?.[1]) return cleanRouteId(kanbanMatch[1]);
    }
    return '';
  }

  function kanbanItemIdFromLinkText(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const shareCode = text.match(/^xarta-kanban:item:([a-zA-Z0-9_.:-]+)$/);
    if (shareCode?.[1]) return cleanStrictKanbanItemId(shareCode[1]);
    const internalLink = text.match(/^blueprints:\/\/kanban\/items\/([^/?#]+)(?:[?#].*)?$/i);
    if (internalLink?.[1]) {
      try {
        return cleanStrictKanbanItemId(decodeURIComponent(internalLink[1]));
      } catch (_) {
        return cleanStrictKanbanItemId(internalLink[1]);
      }
    }
    const bareItemId = cleanStrictKanbanItemId(text);
    if (bareItemId === text) return bareItemId;
    try {
      const url = new URL(text, window.location?.href || document.baseURI);
      const isFallback = /\/fallback-ui\/?$/.test(url.pathname || '');
      const isKanbanRoute = (url.searchParams.get('group') || '') === 'kanban'
        || (url.searchParams.get('tab') || '') === 'kanban';
      if (!isFallback || !isKanbanRoute) return '';
      return cleanStrictKanbanItemId(url.searchParams.get('detail_item_id') || url.searchParams.get('work_item_id'));
    } catch (_) {
      return '';
    }
  }

  async function openKanbanLinkFromText(value) {
    const itemId = kanbanItemIdFromLinkText(value);
    if (!itemId) return false;
    return openItemById(itemId);
  }

  async function loadScoped(kind, itemId, scope = 'descendants', view = 'grouped') {
    const config = scopedKindConfig(kind);
    const params = new URLSearchParams({ scope, view });
    return requestJson(`/api/v1/personal/kanban/items/${encodeURIComponent(itemId)}/${config.endpoint}?${params.toString()}`);
  }

  async function openFirstScopedCard(kind, itemId = state.selection?.item?.item_id) {
    if (!itemId) return false;
    const config = scopedKindConfig(kind);
    const data = await loadScoped(config.kind, itemId, 'descendants', 'flat');
    const rows = Array.isArray(data?.items) ? data.items : [];
    const first = rows.find(row => scopedRecordId(row, config));
    const firstCardId = first?.item_id || scopedRecordId(first, config);
    if (!firstCardId) return false;
    await navigateToBoard(first?.parent_item_id || data?.item?.item_id || '');
    await setSelection(firstCardId, { routeTarget: true });
    return true;
  }

  async function saveScopedRecord(config, record, row, statusOverride = '') {
    const id = scopedRecordId(record, config);
    const status = statusOverride || row.querySelector('[data-kanban-scoped-field="status"]')?.value || record.status || 'open';
    const priority = row.querySelector('[data-kanban-scoped-field="priority"]')?.value || record.priority_id || record.severity_id || 'medium';
    const title = String(row.querySelector('[data-kanban-scoped-field="title"]')?.value || record.title || id).trim();
    const body = row.querySelector('[data-kanban-scoped-field="body"]')?.value ?? record.body_excerpt ?? '';
    const parentItemId = record.parent_item_id || record.scope?.item_id || state.scoped.itemId || state.currentParentId || '';
    const payload = {
      item_id: parentItemId,
      title: title || id,
      body,
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
    const resp = await requestJson(`/api/v1/personal/kanban/${config.endpoint}/${encodeURIComponent(id)}`, {
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
    const resp = await requestJson('/api/v1/personal/kanban/promote', {
      method: 'POST',
      body: JSON.stringify({
        source_ref: `${config.sourcePrefix}:${id}`,
        title: record.title || id,
        body: record.body_excerpt || '',
        parent_item_id: record.parent_item_id || record.scope?.item_id || state.scoped.itemId || state.currentParentId || null,
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
      width: '100vw',
      onClose: () => {
        state.scoped.open = false;
        writeRouteState(state.currentParentId, '');
        renderAll();
      },
    });
    dialog.addEventListener('click', async event => {
      const markdownToggle = event.target.closest('[data-kanban-detail-action="toggle-markdown-preview"]');
      if (markdownToggle) {
        event.preventDefault();
        toggleMarkdownPreview(markdownToggle, dialog);
        return;
      }
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
      } else if (action === 'share') {
        await copyShareCode(config.kind === 'issues' ? 'issue' : 'todo', scopedRecordId(record, config), { title: record.title || '' });
        return;
      } else if (action === 'remove') {
        const ok = await HubDialogs.confirm({
          title: `Remove ${config.singular}`,
          message: record.title || scopedRecordId(record, config),
          confirmText: 'Remove',
          tone: 'warning',
        });
        if (!ok) return;
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

  async function moveItem(itemId, targetState, options = {}) {
    const item = findItem(itemId);
    if (!item || !targetState) return false;
    const parentItemId = Object.prototype.hasOwnProperty.call(options, 'parentItemId')
      ? options.parentItemId
      : (state.currentParentId || null);
    const requestKind = options.requestKind || 'move';
    setFsm('pendingMove', requestKind, itemId);
    renderAll();
    try {
      const resp = await requestJson(`/api/v1/personal/kanban/items/${encodeURIComponent(itemId)}/move`, {
        method: 'POST',
        body: JSON.stringify({
          parent_item_id: parentItemId || null,
          state_id: targetState,
          sort_order: item.sort_order || 0,
          actor: 'blueprints-ui',
          source_surface: 'kanban-page',
          request_id: `ui-kanban-${requestKind}-${Date.now()}`,
        }),
      });
      state.lastWrite = resp;
      setFsm('selected', `${requestKind}Accepted`, itemId);
      await load({ force: true });
      if (findItem(itemId)) await setSelection(itemId);
      return true;
    } catch (error) {
      setFsm('selected', `${requestKind}Rejected`, itemId);
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
      const resp = await requestJson(`/api/v1/personal/kanban/items/${encodeURIComponent(itemId)}/order`, {
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
    const resp = await requestJson(`/api/v1/personal/kanban/items/${encodeURIComponent(item.item_id)}/archive`, {
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

  function cancelPendingCardShareClick() {
    if (cardShareClickTimer) window.clearTimeout(cardShareClickTimer);
    cardShareClickTimer = null;
  }

  function scheduleCardShareClick(itemId) {
    cancelPendingCardShareClick();
    cardShareClickTimer = window.setTimeout(() => {
      cardShareClickTimer = null;
      handleCardAction('share', itemId);
    }, CARD_SHARE_CLICK_DELAY_MS);
  }

  async function promoteItemUp(itemId) {
    const item = findItem(itemId);
    if (!item) return false;
    const parentId = item.parent_item_id || state.currentParentId || '';
    if (!parentId) {
      await HubDialogs.alert({ title: 'Kanban', message: 'This card is already on the root board.', tone: 'warning' });
      return false;
    }
    const parentDetail = await detailForItem(parentId);
    const parentItem = parentDetail?.item || null;
    const nextParentId = parentItem?.parent_item_id || '';
    const destination = nextParentId
      ? ((parentDetail?.breadcrumbs || []).find(row => row.item_id === nextParentId)?.title || nextParentId)
      : 'Root board';
    const ok = await HubDialogs.confirm({
      title: 'Promote Kanban Card',
      message: `Move "${item.title || item.item_id}" up to ${destination}?`,
      confirmText: 'Promote',
      tone: 'warning',
    });
    if (!ok) return false;
    const moved = await moveItem(item.item_id, item.state_id || 'todo', {
      parentItemId: nextParentId || null,
      requestKind: 'promote',
    });
    if (moved) {
      await navigateToBoard(nextParentId || '');
      await setSelection(item.item_id);
    }
    return moved;
  }

  async function runStep18ProofWrite() {
    await load({ force: true });
    const stamp = Date.now();
    const parentResp = await requestJson('/api/v1/personal/kanban/items', {
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
    const childResp = await requestJson('/api/v1/personal/kanban/items', {
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
    const linkResp = await requestJson(`/api/v1/personal/kanban/items/${encodeURIComponent(parentId)}/links`, {
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
    const blockerResp = await requestJson('/api/v1/personal/kanban/blockers', {
      method: 'POST',
      body: JSON.stringify({
        blocker_id: `blocker-step18-${stamp}`,
        item_id: parentId,
        title: `Step 18 Active Browser blocker ${stamp}`,
        body: 'Blocker proof row for the item detail blocker panel.',
        blocked_by_ref: `kanban_items:${childResp.item?.item_id || ''}`,
        actor: 'active-browser',
        source_surface: 'kanban-active-browser-proof',
        request_id: `active-browser-step18-blocker-${stamp}`,
      }),
    });
    const updatedResp = await requestJson(`/api/v1/personal/kanban/items/${encodeURIComponent(parentId)}`, {
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
    const parentResp = await requestJson('/api/v1/personal/kanban/items', {
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
    const childResp = await requestJson('/api/v1/personal/kanban/items', {
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
    const grandchildResp = await requestJson('/api/v1/personal/kanban/items', {
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
    const localIssueResp = await requestJson('/api/v1/personal/kanban/issues', {
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
    const childIssueResp = await requestJson('/api/v1/personal/kanban/issues', {
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
    const updatedIssueResp = await requestJson(`/api/v1/personal/kanban/issues/${encodeURIComponent(childIssueResp.issue?.issue_id || '')}`, {
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
    const todoResp = await requestJson('/api/v1/personal/kanban/todos', {
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
    const updatedTodoResp = await requestJson(`/api/v1/personal/kanban/todos/${encodeURIComponent(todoResp.todo?.todo_id || '')}`, {
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
    const promotedIssueResp = await requestJson('/api/v1/personal/kanban/promote', {
      method: 'POST',
      body: JSON.stringify({
        source_ref: `kanban_items:${updatedIssueResp.issue?.issue_id || childIssueResp.issue?.issue_id}`,
        title: `Promoted Step 19 issue ${stamp}`,
        parent_item_id: childId,
        priority_id: 'critical',
        actor: 'active-browser',
        source_surface: 'kanban-active-browser-proof',
        request_id: `active-browser-step19-promote-issue-${stamp}`,
      }),
    });
    const promotedTodoResp = await requestJson('/api/v1/personal/kanban/promote', {
      method: 'POST',
      body: JSON.stringify({
        source_ref: `kanban_items:${updatedTodoResp.todo?.todo_id || todoResp.todo?.todo_id}`,
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
          { id: 'backups', label: 'Backups' },
          { id: 'automation', label: 'Automation' },
          { id: 'provenance', label: 'Provenance' },
        ],
        renderTab: (tab, host) => {
          if (tab === 'selected') return embeddedSelectedHtml(host);
          if (tab === 'search') return embeddedSearchHtml(host);
          if (tab === 'new-item') return embeddedItemFormHtml(host?.id === 'kanban-filter-inline-panel' ? 'kanban-inline-item' : 'kanban-panel-item');
          if (tab === 'edit-item') return embeddedItemDetailHtml(host);
          if (tab === 'backups') return embeddedBackupsHtml(host);
          if (tab === 'automation') return embeddedAutomationStatusHtml(host);
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
        openResult: result => {
          const itemId = kanbanItemIdFromSearchResult(result);
          if (!itemId) return false;
          if (typeof KanbanMenuConfig !== 'undefined') KanbanMenuConfig.showGroup();
          if (typeof switchTab === 'function') switchTab('kanban');
          if (typeof KanbanMenuConfig !== 'undefined') KanbanMenuConfig.updateActiveTab('kanban');
          return openItemById(itemId);
        },
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
    if (action === 'share') {
      const item = findItem(itemId) || state.selection?.item || state.detail?.item || {};
      return copyShareCode(cardShareKind(item), itemId, { title: item.title || '' });
    }
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
    syncDetailDraftFromScope(body);
    body.innerHTML = itemDetailHtml(state.detail, {
      prefix: 'kanban-modal-detail',
      layout: isCompactDetailLayout() ? 'accordion' : 'tabs',
    });
    return true;
  }

  function refreshDetailSurfaces() {
    syncOpenDetailDraftSurfaces();
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
    if (action === 'share') {
      const detailItem = state.detail?.item || state.selection?.item || {};
      await copyShareCode(cardShareKind(detailItem), itemId, { title: detailItem.title || '' });
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
    if (action === 'save-review-doc') {
      await saveReviewDocument(itemId, {
        scope: workspace,
        statusEl: workspace.querySelector?.('[data-kanban-review-document-status]') || null,
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

  function beginCardShareDrag(event, button) {
    if (!button || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const itemId = button.dataset.kanbanItemId || '';
    if (!findItem(itemId)) return;
    cardDrag.pointerId = event.pointerId;
    cardDrag.itemId = itemId;
    cardDrag.startX = event.clientX;
    cardDrag.startY = event.clientY;
    cardDrag.active = false;
    cardDrag.sourceButton = button;
    cardDrag.target = { kind: '' };
    button.setPointerCapture?.(event.pointerId);

    cardDrag.moveListener = moveEvent => {
      if (moveEvent.pointerId !== cardDrag.pointerId) return;
      const dx = moveEvent.clientX - cardDrag.startX;
      const dy = moveEvent.clientY - cardDrag.startY;
      if (!cardDrag.active && Math.hypot(dx, dy) >= CARD_DRAG_START_PX) {
        cancelPendingCardShareClick();
        startCardDrag(moveEvent);
      }
      if (!cardDrag.active) return;
      moveEvent.preventDefault();
      positionCardDragGhost(moveEvent.clientX, moveEvent.clientY);
      setCardDragTarget(cardDragTargetFromPoint(moveEvent.clientX, moveEvent.clientY));
    };

    cardDrag.endListener = async endEvent => {
      if (endEvent.pointerId !== cardDrag.pointerId) return;
      const wasActive = cardDrag.active;
      const target = { ...cardDrag.target };
      window.removeEventListener('pointermove', cardDrag.moveListener);
      window.removeEventListener('pointerup', cardDrag.endListener);
      window.removeEventListener('pointercancel', cardDrag.endListener);
      try {
        button.releasePointerCapture?.(event.pointerId);
      } catch (_) {
        // Pointer capture can already be gone after browser-level cancellation.
      }
      if (wasActive) {
        endEvent.preventDefault();
        cardDrag.suppressClickUntil = Date.now() + 650;
      }
      try {
        if (wasActive && endEvent.type !== 'pointercancel' && target.kind) {
          await applyCardDragTarget(target);
        } else if (wasActive) {
          renderStatus('Drag cancelled.');
        }
      } finally {
        resetCardDrag();
      }
    };

    window.addEventListener('pointermove', cardDrag.moveListener);
    window.addEventListener('pointerup', cardDrag.endListener);
    window.addEventListener('pointercancel', cardDrag.endListener);
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
      const dragButton = event.target.closest('[data-kanban-card-action="share"]');
      if (dragButton) beginCardShareDrag(event, dragButton);
    });
    root.addEventListener('pointerup', () => cancelRefreshLongPress('pointerup'));
    root.addEventListener('pointercancel', () => cancelRefreshLongPress('pointercancel'));
    el('kanban-board-shell')?.addEventListener('scroll', resetBoardVerticalOffset, { passive: true });
    root.addEventListener('input', handleDetailFieldEvent);
    root.addEventListener('change', handleDetailFieldEvent);
    root.addEventListener('click', async event => {
      if (event.target.closest('[data-kanban-lane-width-handle]')) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const backupButton = event.target.closest('[data-kanban-backup-action]');
      if (backupButton) {
        event.preventDefault();
        event.stopPropagation();
        handleBackupAction(backupButton);
        return;
      }
      const backupRowActionsButton = event.target.closest('[data-kanban-backup-row-actions]');
      if (backupRowActionsButton) {
        event.preventDefault();
        event.stopPropagation();
        openBackupRowActions(backupRowActionsButton.dataset.kanbanBackupRowActions || '');
        return;
      }
      const automationButton = event.target.closest('[data-kanban-automation-action]');
      if (automationButton) {
        event.preventDefault();
        event.stopPropagation();
        handleAutomationStatusAction(automationButton);
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
        if (action === 'backups') openBackupsPanel();
        if (action === 'automation-status') openAutomationStatusPanel();
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
        event.preventDefault();
        event.stopPropagation();
        const action = cardButton.dataset.kanbanCardAction || '';
        const itemId = cardButton.dataset.kanbanItemId || '';
        if (action === 'share') {
          if (Date.now() < cardDrag.suppressClickUntil || event.detail > 1) return;
          scheduleCardShareClick(itemId);
          return;
        }
        handleCardAction(action, itemId);
        return;
      }
      const pill = event.target.closest('[data-kanban-pill]');
      if (pill) {
        event.stopPropagation();
        const itemId = pill.dataset.kanbanItemId || '';
        if (pill.dataset.kanbanPill === 'subitems') openChildBoard(itemId);
        if (pill.dataset.kanbanPill === 'issues') await openFirstScopedCard('issues', itemId);
        if (pill.dataset.kanbanPill === 'todos') await openFirstScopedCard('todos', itemId);
        return;
      }
      const card = event.target.closest('[data-kanban-item-id]');
      if (card) setSelection(card.dataset.kanbanItemId, { openDetail: true });
    });
    root.addEventListener('dblclick', event => {
      const cardButton = event.target.closest('[data-kanban-card-action="share"]');
      if (!cardButton) return;
      event.preventDefault();
      event.stopPropagation();
      cancelPendingCardShareClick();
      promoteItemUp(cardButton.dataset.kanbanItemId || '');
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
      const btn = event.target.closest('[data-kanban-backup-action]');
      if (!btn || root.contains(btn)) return;
      event.preventDefault();
      handleBackupAction(btn);
    });
    document.addEventListener('click', event => {
      const btn = event.target.closest('[data-kanban-backup-row-actions]');
      if (!btn || root.contains(btn)) return;
      event.preventDefault();
      openBackupRowActions(btn.dataset.kanbanBackupRowActions || '');
    });
    document.addEventListener('click', event => {
      const btn = event.target.closest('[data-kanban-automation-action]');
      if (!btn || root.contains(btn)) return;
      event.preventDefault();
      handleAutomationStatusAction(btn);
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
    document.addEventListener('blueprints:rich-markdown-draft', handleRichMarkdownDraft);
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
      detail_panel_open: !!state.detailPanelOpen,
      detail_item_id: detail.item?.item_id || '',
      detail_state: detail.item?.state_id || '',
      editing: !!externalRefreshSkipReason(),
      draft_dirty: detailDraftDirty(),
      external_refresh_skipped: !!state.lastExternalRefresh?.skipped,
      external_refresh_skipped_reason: state.lastExternalRefresh?.reason || '',
      depth_remaining: detail.remaining_depth ?? state.board?.remaining_depth ?? 0,
      child_count: detail.counts?.children ?? (detail.children || []).length ?? 0,
      link_count: detail.counts?.links ?? (detail.links || []).length ?? 0,
      blocker_count: detail.counts?.blockers ?? (detail.blockers || []).length ?? 0,
      review_count: detail.counts?.review ?? (String(detail.review_document?.body || '').trim() ? 1 : 0),
      ai_decision_count: itemAiDecisionCount(detail),
      ai_decision_commit_link_health_ok: itemAiDecisionHealth(detail).ok !== false,
      ai_decision_error: detail.ai_decision_error || '',
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
      backups_loaded: !!state.backups.data,
      backup_count: backupEntries().length,
      backups_loading: !!state.backups.loading,
      backups_error: state.backups.error || '',
      backup_busy_action: state.backups.busyAction || '',
      backup_importing_filename: state.backups.applyingFilename || '',
      backup_last_result: state.backups.lastResult?.message || '',
      automation_status_loaded: !!state.automationStatus.data,
      automation_status_loading: !!state.automationStatus.loading,
      automation_status_error: state.automationStatus.error || '',
      automation_recent_decisions: automationRecentDecisions().length,
      automation_review_processor_status: state.automationStatus.data?.review_processor?.status || '',
      automation_review_queue_length: Number(
        automationReviewScheduler().queue_length ?? state.automationStatus.data?.review_processor?.queue_length ?? 0
      ),
      automation_review_active_count: Number(automationReviewScheduler().active_count || 0),
      automation_review_timeout_count: Number(automationReviewScheduler().timeout_count || 0),
      automation_review_superseded_count: Number(automationReviewScheduler().superseded_count || 0),
      automation_review_marker_count: automationReviewMarkers().length,
      automation_failure_event_count: Number(state.automationStatus.data?.failures?.event_count || 0),
      automation_repeated_failure_count: Number(state.automationStatus.data?.failures?.repeated_failure_count || 0),
      automation_retry_waiting_count: Number(state.automationStatus.data?.failures?.retry_waiting_count || 0),
      automation_retry_due_count: Number(automationReviewScheduler().retry_due_count || 0)
        + Number(automationPreprocessingScheduler().retry_due_count || 0),
      automation_failure_group_count: automationFailureAggregates().length,
      automation_idle_worker_current_node: state.automationStatus.data?.idle_worker?.current_node_id || '',
      automation_idle_worker_owner_node: state.automationStatus.data?.idle_worker?.owner_node_id || '',
      automation_idle_worker_runs_on_this_node:
        state.automationStatus.data?.idle_worker?.runs_on_this_node === true,
      automation_idle_worker_effective_enabled:
        state.automationStatus.data?.idle_worker?.effective_enabled === true,
      automation_busy_action: state.automationStatus.busyAction || '',
      automation_last_result: state.automationStatus.lastResult?.message || '',
      automation_commit_link_health_ok: state.automationStatus.data?.commit_link_health?.ok !== false,
      automation_output_contract_schema: state.automationStatus.data?.output_contract?.schema || '',
      automation_output_contract_types: Array.isArray(state.automationStatus.data?.output_contract?.output_types)
        ? state.automationStatus.data.output_contract.output_types.length
        : 0,
      automation_processing_policy_schema: state.automationStatus.data?.processing_policy?.schema || '',
      automation_processing_policy_active_mode: state.automationStatus.data?.processing_policy?.active_mode || '',
      automation_processing_policy_local_gate:
        state.automationStatus.data?.processing_policy?.local_processing?.gate || '',
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
    openKanbanLinkFromText,
    itemRouteUrl,
    openBackupsPanel,
    openAutomationStatusPanel,
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
    externalRefresh,
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
    'kanban.backups': () => KanbanBoardPage.openBackupsPanel(),
    'kanban.automationStatus': () => KanbanBoardPage.openAutomationStatusPanel(),
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
