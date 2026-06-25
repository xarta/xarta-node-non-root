// Dave Diary page - Week/Day diary view using the Calendar page interaction model.

'use strict';

const DiaryPage = (() => {
  const VIEW_STORAGE_KEY = 'blueprints.diary.view';
  const CONTENT_VIEW_STORAGE_KEY = 'blueprints.diary.contentView';
  const ENTRY_TAG_SURFACE = 'diary-entry';
  const EDIT_TAG_SURFACE = 'diary-edit-entry';
  const ENTRY_REQUIRED_TAGS = ['diary'];
  const SEARCH_TAG_SURFACE = 'diary-search';
  const UPCOMING_WIDE_BATCH_SIZE = 200;
  const UPCOMING_WIDE_MAX_EVENTS = 2000;
  const UPCOMING_WIDE_YEARS = 10;
  const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const CONTENT_VIEWS = [
    { id: 'diary', label: 'Week / Day Diary' },
    { id: 'filters', label: 'Filters' },
    { id: 'filter-settings', label: 'Filter Settings' },
    { id: 'selected', label: 'Selected Range Visible Items' },
    { id: 'day', label: 'All-Day And Milestones' },
    { id: 'search', label: 'Search' },
    { id: 'new-entry', label: 'New Entry' },
    { id: 'edit-entry', label: 'Edit Entry' },
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'provenance', label: 'Provenance' },
  ];
  const CONTENT_VIEW_IDS = CONTENT_VIEWS.map(view => view.id);
  const INLINE_CONTENT_VIEW_IDS = ['diary', 'filters', 'filter-settings'];
  const MODAL_CONTENT_VIEW_IDS = ['selected', 'day', 'search', 'new-entry', 'edit-entry', 'upcoming', 'provenance'];
  const DAY_DOUBLE_TAP_MS = 560;
  const DAY_DOUBLE_TAP_PX = 28;
  const ENTRY_LONG_PRESS_MS = 620;

  const state = {
    loaded: false,
    loading: false,
    data: null,
    error: '',
    date: localDateString(new Date()),
    view: readStoredView(),
    contentView: readStoredContentView(),
    sourceFilter: 'all',
    selection: null,
    lastWrite: null,
    expandedGaps: new Set(),
    upcomingWide: false,
    upcomingWideLoading: false,
    upcomingWideError: '',
    upcomingWideItems: [],
    upcomingWideRequestId: 0,
    daySummaryDate: '',
    daySummary: null,
    daySummaryLoading: false,
    daySummaryError: '',
    daySummaryRequestId: 0,
    entryDraftRange: null,
    selectedEntryId: '',
  };

  let contentViewMenuHost = null;
  let contentViewMenuPointerHandler = null;
  let contentViewMenuKeyHandler = null;
  let contentViewMenuFitHandler = null;
  let lastWeekDayTap = null;
  let lastWeekDayClick = null;
  let suppressWeekDayClick = false;
  let suppressWeekDayClickUntil = 0;
  let pendingEntryTapTimer = null;
  let lastEntryTap = null;
  let lastEntryPointerCandidate = null;
  let entryLongPressTimer = null;
  let entryLongPressCandidate = null;
  let suppressEntryClickUntil = 0;

  const escHtml = typeof esc === 'function'
    ? esc
    : value => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[ch]));

  function el(id) {
    return document.getElementById(id);
  }

  function eventNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  function openPendingEntryTapAsEdit(event) {
    const candidate = lastEntryTap || lastEntryPointerCandidate;
    if (!candidate || eventNow() - candidate.time > DAY_DOUBLE_TAP_MS) return false;
    const row = findEventById(candidate.id);
    if (!row) return false;
    clearPendingEntryPreview();
    lastEntryTap = null;
    lastEntryPointerCandidate = null;
    selectEntryById(entryIdentity(row), { type: 'entry', index: -1, openEdit: false });
    event.preventDefault();
    event.stopPropagation();
    return openEditEntryForSelected();
  }

  function markEntryTapCandidate(btn, event) {
    const row = findEventById(btn?.dataset?.diaryEntryId);
    const id = entryIdentity(row);
    if (!id) return false;
    lastEntryPointerCandidate = {
      id,
      time: eventNow(),
      x: Number.isFinite(event.clientX) ? event.clientX : 0,
      y: Number.isFinite(event.clientY) ? event.clientY : 0,
    };
    return true;
  }

  function handleWeekDayDoubleTap(dateText, event) {
    if (!dateText) return false;
    const now = eventNow();
    const x = Number.isFinite(event.clientX) ? event.clientX : 0;
    const y = Number.isFinite(event.clientY) ? event.clientY : 0;
    const previous = lastWeekDayTap;
    const isDoubleTap = previous
      && previous.date === dateText
      && now - previous.time <= DAY_DOUBLE_TAP_MS
      && Math.hypot(x - previous.x, y - previous.y) <= DAY_DOUBLE_TAP_PX;
    lastWeekDayTap = isDoubleTap ? null : { date: dateText, time: now, x, y };
    if (!isDoubleTap) return false;
    if (openPendingEntryTapAsEdit(event)) {
      suppressWeekDayInteractions(700);
      return true;
    }
    suppressWeekDayInteractions(700);
    setView('day', dateText);
    event.preventDefault();
    return true;
  }

  function suppressWeekDayInteractions(durationMs = 220) {
    suppressWeekDayClick = true;
    suppressWeekDayClickUntil = eventNow() + durationMs;
    window.setTimeout(() => {
      if (eventNow() >= suppressWeekDayClickUntil) suppressWeekDayClick = false;
    }, durationMs + 30);
  }

  function shouldSuppressWeekDayInteraction(event) {
    if (!suppressWeekDayClick && eventNow() >= suppressWeekDayClickUntil) return false;
    if (eventNow() >= suppressWeekDayClickUntil) {
      suppressWeekDayClick = false;
      return false;
    }
    event.preventDefault();
    return true;
  }

  function handleWeekDayClickDoubleTap(dateText, event) {
    if (!dateText) return false;
    const now = eventNow();
    const previous = lastWeekDayClick;
    const isDoubleTap = previous
      && previous.date === dateText
      && now - previous.time <= DAY_DOUBLE_TAP_MS;
    lastWeekDayClick = isDoubleTap ? null : { date: dateText, time: now };
    if (!isDoubleTap) return false;
    if (openPendingEntryTapAsEdit(event)) {
      suppressWeekDayInteractions(700);
      return true;
    }
    setView('day', dateText);
    event.preventDefault();
    return true;
  }

  function readStoredView() {
    try {
      return localStorage.getItem(VIEW_STORAGE_KEY) === 'day' ? 'day' : 'week';
    } catch (_) {
      return 'week';
    }
  }

  function normalizeContentView(value) {
    return CONTENT_VIEW_IDS.includes(value) ? value : 'diary';
  }

  function normalizeInlineContentView(value) {
    return INLINE_CONTENT_VIEW_IDS.includes(value) ? value : 'diary';
  }

  function readStoredContentView() {
    try {
      return normalizeInlineContentView(localStorage.getItem(CONTENT_VIEW_STORAGE_KEY));
    } catch (_) {
      return 'diary';
    }
  }

  function writeStoredValue(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (_) {
      // Browser-local preference persistence is optional.
    }
  }

  function localDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseLocalDate(dateText) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || ''));
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }
    const fallback = new Date();
    fallback.setHours(0, 0, 0, 0);
    return fallback;
  }

  function cloneDate(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, deltaDays) {
    const next = cloneDate(date);
    next.setDate(next.getDate() + deltaDays);
    return next;
  }

  function startOfWeek(date) {
    const next = cloneDate(date);
    const dayFromMonday = (next.getDay() + 6) % 7;
    next.setDate(next.getDate() - dayFromMonday);
    return next;
  }

  function endOfWeek(date) {
    return addDays(startOfWeek(date), 6);
  }

  function dateTimePartsForZone(date, timeZone = 'Europe/London') {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(date).reduce((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = part.value;
        return acc;
      }, {});
      const localDate = `${parts.year}-${parts.month}-${parts.day}`;
      const localTime = `${parts.hour}:${parts.minute}`;
      return { date: localDate, time: localTime, stamp: `${localDate}T${localTime}` };
    } catch (_) {
      const fallback = localDateString(date);
      const localTime = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
      return { date: fallback, time: localTime, stamp: `${fallback}T${localTime}` };
    }
  }

  function londonNowParts() {
    return dateTimePartsForZone(new Date(), 'Europe/London');
  }

  function rangeStart() {
    if (state.view === 'day') return state.date;
    return localDateString(startOfWeek(parseLocalDate(state.date)));
  }

  function rangeEnd() {
    if (state.view === 'day') return state.date;
    return localDateString(endOfWeek(parseLocalDate(state.date)));
  }

  function detailRangeStart() {
    return rangeStart();
  }

  function detailRangeEnd() {
    return rangeEnd();
  }

  function monthLabel(dateText = state.date, options = { month: 'long', year: 'numeric' }) {
    return parseLocalDate(dateText).toLocaleDateString('en-GB', options);
  }

  function rangeLabel() {
    if (state.view === 'day') {
      return monthLabel(state.date, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    }
    return `${monthLabel(rangeStart(), { day: '2-digit', month: 'short', year: 'numeric' })} to ${monthLabel(rangeEnd(), { day: '2-digit', month: 'short', year: 'numeric' })}`;
  }

  function detailRangeLabel() {
    return rangeLabel();
  }

  function contentViewLabel(value = state.contentView) {
    const view = CONTENT_VIEWS.find(item => item.id === value);
    return view ? view.label : CONTENT_VIEWS[0].label;
  }

  function responseErrorMessage(data, status) {
    const detail = data?.detail;
    if (Array.isArray(detail)) {
      return detail.map(item => item?.msg || item?.type || JSON.stringify(item)).join('; ');
    }
    if (detail && typeof detail === 'object') return JSON.stringify(detail);
    return detail || `HTTP ${status}`;
  }

  function statusTone(status) {
    const clean = String(status || '').toLowerCase();
    if (clean === 'ready' || clean === 'ok' || clean === 'open') return 'ok';
    if (clean === 'empty' || clean === 'pending_review' || clean === 'refreshing' || clean === 'loading') return 'warn';
    if (clean === 'source_unavailable' || clean === 'error' || clean === 'blocked') return 'err';
    return 'unknown';
  }

  function sourceType(event) {
    return event?.source?.type || event?.source_type || '';
  }

  function eventTags(event) {
    return Array.isArray(event?.tags) ? event.tags.map(tag => String(tag).toLowerCase()) : [];
  }

  function isDiaryEvent(event) {
    const tags = eventTags(event);
    return sourceType(event) === 'manual-diary' || tags.includes('diary') || sourceType(event) === 'manual';
  }

  function isManualCalendarEvent(event) {
    return sourceType(event) === 'manual-calendar';
  }

  function isDiaryQuickEntry(event) {
    const tags = eventTags(event);
    const kind = String(event?.kind || '').toLowerCase();
    return kind === 'personal-log' || tags.includes('quick-entry');
  }

  function entryEditability(event) {
    if (!event?.event_id) {
      return { editable: false, route: '', reason: 'No editable entry is selected.' };
    }
    if (isManualCalendarEvent(event)) {
      return { editable: true, route: 'calendar', reason: '' };
    }
    if (isDiaryQuickEntry(event)) {
      return { editable: true, route: 'diary', reason: '' };
    }
    const owner = sourceType(event) || event?.kind || 'source';
    return {
      editable: false,
      route: '',
      reason: `Source-owned entry (${owner}); open the source detail to edit upstream.`,
    };
  }

  function stripFrontmatter(md) {
    if (window.BlueprintsMarkdown?.stripFrontmatter) return window.BlueprintsMarkdown.stripFrontmatter(md);
    return String(md || '').replace(/^---\s*\n[\s\S]*?\n---\s*(\n|$)/, '');
  }

  function renderMarkdown(md) {
    if (window.BlueprintsMarkdown?.render) return window.BlueprintsMarkdown.render(md);
    const clean = stripFrontmatter(md).trim();
    if (!clean) return '<p class="calendar-markdown-empty">No entry content.</p>';
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

  function richMarkdownFieldHtml({
    textareaId,
    previewId,
    label = 'Notes',
    value = '',
    rows = 3,
    maxlength = 4000,
    event = null,
    disabled = false,
    previewClass = '',
  } = {}) {
    const safeTextareaId = String(textareaId || 'diary-body').replace(/[^a-zA-Z0-9_-]/g, '-');
    const safePreviewId = String(previewId || `${safeTextareaId}-preview`).replace(/[^a-zA-Z0-9_-]/g, '-');
    if (window.BlueprintsRichMarkdown?.fieldHtml) {
      return window.BlueprintsRichMarkdown.fieldHtml({
        textareaId: safeTextareaId,
        previewId: safePreviewId,
        label,
        value,
        rows,
        maxlength,
        wrapperClass: 'calendar-field calendar-field--wide calendar-field--notes calendar-markdown-field',
        previewClass,
        textareaAttrs: { disabled: Boolean(disabled) },
        context: {
          domain: 'diary',
          documentType: 'diary-entry',
          documentId: entryIdentity(event) || safeTextareaId,
          localDate: event?.local_date || state.date || '',
        },
      });
    }
    return `
      <div class="calendar-field calendar-field--wide calendar-field--notes calendar-markdown-field">
        <div class="calendar-field__label-row">
          <span>${escHtml(label)}</span>
          <button class="calendar-markdown-toggle" type="button" data-diary-action="toggle-markdown-preview" data-diary-markdown-prefix="${escHtml(safeTextareaId.replace(/-body$/, ''))}"${disabled ? ' disabled' : ''}>Preview</button>
        </div>
        <textarea id="${escHtml(safeTextareaId)}" rows="${escHtml(rows)}" maxlength="${escHtml(maxlength)}"${disabled ? ' disabled' : ''}>${escHtml(value)}</textarea>
        <div id="${escHtml(safePreviewId)}" class="calendar-markdown-preview${previewClass ? ` ${escHtml(previewClass)}` : ''}" hidden></div>
      </div>
    `;
  }

  function isTaskLike(event) {
    const kind = String(event?.kind || '').toLowerCase();
    const relatedTasks = event?.related?.tasks || [];
    return ['todo', 'task', 'reminder'].includes(kind) || relatedTasks.length > 0;
  }

  function cleanTodoRef(value) {
    return String(value || '').trim().replace(/[^a-zA-Z0-9_.:-]+/g, '-').slice(0, 180);
  }

  function todoRefForEvent(event) {
    if (!isTaskLike(event)) return '';
    const refs = [
      ...(event?.related?.tasks || []),
      event?.source?.ref,
      event?.event_id,
    ];
    return cleanTodoRef(refs.find(Boolean) || '');
  }

  function todoRouteUrl(taskRef) {
    const clean = cleanTodoRef(taskRef);
    if (!clean || !window.location) return '';
    if (window.BlueprintsTodoPage?.taskRouteUrl) return window.BlueprintsTodoPage.taskRouteUrl(clean);
    const url = new URL(window.location.href);
    url.searchParams.set('group', 'dave');
    url.searchParams.set('tab', 'todo');
    url.searchParams.set('todo_task_id', clean);
    return `${url.pathname}${url.search}${url.hash || ''}`;
  }

  function todoLinkHtml(event) {
    const taskRef = todoRefForEvent(event);
    const href = todoRouteUrl(taskRef);
    if (!taskRef || !href) return '';
    return `<a class="personal-related-link personal-related-link--todo" href="${escHtml(href)}" data-personal-todo-link="${escHtml(taskRef)}">ToDo</a>`;
  }

  function openTodoLink(taskRef) {
    const clean = cleanTodoRef(taskRef);
    if (!clean) return false;
    if (window.BlueprintsTodoPage?.openTask) return window.BlueprintsTodoPage.openTask(clean);
    window.location.href = todoRouteUrl(clean);
    return true;
  }

  function isWorkLike(event) {
    const relatedWork = event?.related?.kanban_items || [];
    return ['kanban', 'manual-kanban'].includes(sourceType(event)) || relatedWork.length > 0;
  }

  function isImportLike(event) {
    const relatedImports = event?.related?.import_batches || [];
    return ['interests-ingestion', 'git'].includes(sourceType(event)) || relatedImports.length > 0;
  }

  function isHolidayLike(event) {
    const tags = eventTags(event);
    return tags.includes('holiday') || tags.includes('personal-holiday') || tags.includes('national-holiday');
  }

  function eventCategory(event) {
    if (isHolidayLike(event)) return 'holiday';
    if (isTaskLike(event)) return 'task';
    if (isWorkLike(event)) return 'kanban';
    if (isImportLike(event)) return 'import';
    if (isDiaryEvent(event)) return 'diary';
    return 'source';
  }

  function matchesFilter(event) {
    if (window.PersonalFilters?.getSelectedIds && window.PersonalFilters?.matchesRecord) {
      const selected = window.PersonalFilters.getSelectedIds('diary');
      if (selected.length) return window.PersonalFilters.matchesRecord(event, 'diary');
    }
    return true;
  }

  function filterLabel(value) {
    if (value === 'custom' && window.PersonalFilters?.selectedLabel) return window.PersonalFilters.selectedLabel('diary');
    if (window.PersonalFilters?.getSelectedIds) {
      const selected = window.PersonalFilters.getSelectedIds('diary');
      if (selected.length && window.PersonalFilters.selectedLabel) return window.PersonalFilters.selectedLabel('diary');
    }
    return 'all sources';
  }

  function eventStartDate(event) {
    if (event?.local_date) return event.local_date;
    if (event?.start_at) {
      const date = new Date(event.start_at);
      if (!Number.isNaN(date.getTime())) return dateTimePartsForZone(date, 'Europe/London').date;
    }
    return state.date;
  }

  function calendarMeta(event) {
    return event?.provenance?.calendar || {};
  }

  function isAllDay(event) {
    const meta = calendarMeta(event);
    const tags = eventTags(event);
    if (meta.all_day === true) return true;
    if (tags.includes('all-day')) return true;
    return !meta.local_start_time && !event?.start_at;
  }

  function eventHour(event) {
    const meta = calendarMeta(event);
    const fromMeta = String(meta.local_start_time || '').slice(0, 2);
    if (/^\d{2}$/.test(fromMeta)) return Number(fromMeta);
    if (event?.start_at) {
      const date = new Date(event.start_at);
      if (!Number.isNaN(date.getTime())) return Number(dateTimePartsForZone(date, 'Europe/London').time.slice(0, 2));
    }
    return null;
  }

  function eventTime(event) {
    if (isAllDay(event)) return 'All day';
    const meta = calendarMeta(event);
    if (meta.local_start_time) {
      return meta.local_end_time ? `${meta.local_start_time}-${meta.local_end_time}` : meta.local_start_time;
    }
    if (!event?.start_at) return '';
    const date = new Date(event.start_at);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  }

  function eventSortKey(event) {
    return `${eventStartDate(event)}T${calendarMeta(event).local_start_time || (isAllDay(event) ? '00:00' : '12:00')}`;
  }

  function compareEvents(a, b) {
    return eventSortKey(a).localeCompare(eventSortKey(b))
      || String(a.title || '').localeCompare(String(b.title || ''))
      || String(a.event_id || '').localeCompare(String(b.event_id || ''));
  }

  function isUpcomingEvent(event, nowParts = londonNowParts()) {
    if (event?.start_at) {
      const start = new Date(event.start_at);
      if (!Number.isNaN(start.getTime())) return start.getTime() >= Date.now();
    }
    const localDate = eventStartDate(event);
    if (!localDate) return false;
    if (localDate > nowParts.date) return true;
    if (localDate < nowParts.date) return false;
    const localStart = calendarMeta(event).local_start_time || '';
    if (!localStart || isAllDay(event)) return true;
    return `${localDate}T${localStart}` >= nowParts.stamp;
  }

  function visibleEvents() {
    const items = state.data?.items || [];
    return items.filter(matchesFilter);
  }

  function eventsInRange(startDate, endDate) {
    return visibleEvents()
      .filter(event => {
        const date = eventStartDate(event);
        return date >= startDate && date <= endDate;
      })
      .sort(compareEvents);
  }

  function eventsByDate() {
    const map = new Map();
    visibleEvents().forEach(event => {
      const key = eventStartDate(event);
      const rows = map.get(key) || [];
      rows.push(event);
      map.set(key, rows);
    });
    map.forEach(rows => rows.sort(compareEvents));
    return map;
  }

  function groupEvents() {
    const rows = eventsInRange(detailRangeStart(), detailRangeEnd());
    const timed = rows.filter(event => !isAllDay(event));
    const allDay = rows.filter(isAllDay);
    const nowParts = londonNowParts();
    const upcoming = state.upcomingWide
      ? (state.upcomingWideLoading ? [] : state.upcomingWideItems.filter(matchesFilter))
      : rows.filter(event => isUpcomingEvent(event, nowParts)).sort(compareEvents).slice(0, 16);
    return { timed, allDay, upcoming };
  }

  function entryIdentity(event) {
    return String(event?.event_id || event?.source?.ref || event?.source_ref || '').trim();
  }

  function findEventById(eventId) {
    const clean = String(eventId || '').trim();
    if (!clean) return null;
    return (state.data?.items || []).find(event => entryIdentity(event) === clean) || null;
  }

  function selectedEntry() {
    return findEventById(state.selectedEntryId) || state.selection?.row || null;
  }

  function editEntryAvailable() {
    return Boolean(selectedEntry());
  }

  function diaryTabHostVisible(host) {
    if (!host || !host.isConnected) return false;
    const style = window.getComputedStyle ? window.getComputedStyle(host) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    const rect = typeof host.getBoundingClientRect === 'function' ? host.getBoundingClientRect() : null;
    return !rect || (rect.width > 0 && rect.height > 0);
  }

  function activateInlineDiaryTab(tabId) {
    if (!window.PersonalFilters?.activateTab) return false;
    const hosts = [
      document.getElementById('diary-filter-inline-panel'),
      document.querySelector('#ultrawide-sidecar-body [data-personal-filter-host][data-personal-filter-surface="diary"]'),
    ].filter(Boolean);
    for (const host of hosts) {
      if (!diaryTabHostVisible(host)) continue;
      if (window.PersonalFilters.activateTab('diary', tabId, { host, visibleOnly: true })) return true;
    }
    return false;
  }

  function activeActionModalView() {
    const modal = el('diary-action-modal');
    return modal?.open ? String(modal.dataset.diaryActionModalView || '') : '';
  }

  function clearSelectedEntry(options = {}) {
    const hadSelection = Boolean(state.selectedEntryId || state.selection);
    state.selectedEntryId = '';
    state.selection = null;
    if (window.PersonalFilters?.setSelectedIds) {
      window.PersonalFilters.setSelectedIds(EDIT_TAG_SURFACE, ENTRY_REQUIRED_TAGS);
    }
    if (options.moveEditToNew !== false) {
      activateInlineDiaryTab('new-entry');
      if (activeActionModalView() === 'edit-entry') {
        openContentViewModal('new-entry');
      }
    }
    return hadSelection;
  }

  function selectEntryById(eventId, options = {}) {
    const row = findEventById(eventId);
    if (!row) return false;
    const cleanId = entryIdentity(row);
    state.selectedEntryId = cleanId;
    state.selection = {
      key: cleanId,
      type: options.type || 'entry',
      index: Number.isFinite(Number(options.index)) ? Number(options.index) : -1,
      label: rowLabel(row),
      row,
    };
    if (window.PersonalFilters?.setSelectedIds) {
      window.PersonalFilters.setSelectedIds(EDIT_TAG_SURFACE, editEntryTagIds(row));
    }
    applySelectionStyles();
    renderMeta();
    if (options.openEdit !== false) openEditEntryForSelected();
    return true;
  }

  function selectionKey(type, index) {
    return `${type}:${index}`;
  }

  function rowLabel(row) {
    return row?.title || row?.event_id || 'diary event';
  }

  function rowsForType(type) {
    const rows = groupEvents();
    if (type === 'selected') return rows.timed.concat(rows.allDay).sort(compareEvents);
    if (type === 'timed') return rows.timed;
    if (type === 'all-day') return rows.allDay;
    if (type === 'upcoming') return rows.upcoming;
    return [];
  }

  function setSelection(type, index) {
    const rows = rowsForType(type);
    const idx = Number(index);
    const row = rows[idx];
    if (!row) return;
    if (entryIdentity(row) && selectEntryById(entryIdentity(row), { type, index: idx, openEdit: false })) return;
    state.selection = {
      key: selectionKey(type, idx),
      type,
      index: idx,
      label: rowLabel(row),
      row,
    };
    applySelectionStyles();
    renderMeta();
  }

  function clearPendingEntryPreview() {
    if (!pendingEntryTapTimer) return;
    window.clearTimeout(pendingEntryTapTimer);
    pendingEntryTapTimer = null;
  }

  function selectEntryForGesture(row, options = {}) {
    return selectEntryById(entryIdentity(row), {
      type: options.type || 'entry',
      index: Number.isFinite(Number(options.index)) ? Number(options.index) : -1,
      openEdit: false,
    });
  }

  function handleEntryActivation(row, event, options = {}) {
    const id = entryIdentity(row);
    if (!id) return false;
    if (eventNow() < suppressEntryClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    const now = eventNow();
    const x = Number.isFinite(event.clientX) ? event.clientX : 0;
    const y = Number.isFinite(event.clientY) ? event.clientY : 0;
    const previous = lastEntryTap;
    const isDouble = event.detail >= 2
      || (previous
        && previous.id === id
        && now - previous.time <= DAY_DOUBLE_TAP_MS
        && Math.hypot(x - previous.x, y - previous.y) <= DAY_DOUBLE_TAP_PX);
    clearPendingEntryPreview();
    if (isDouble) {
      lastEntryTap = null;
      lastEntryPointerCandidate = null;
      event.preventDefault();
      DiaryEntryGestureMachine.dispatch('doubleTap', { row, event, options });
      return true;
    }
    lastEntryTap = { id, time: now, x, y };
    DiaryEntryGestureMachine.dispatch('tap', { row, event, options });
    return true;
  }

  function handleEntryDoubleClick(btn, event) {
    const row = findEventById(btn?.dataset?.diaryEntryId);
    if (!row) return false;
    clearPendingEntryPreview();
    lastEntryTap = null;
    lastEntryPointerCandidate = null;
    selectEntryById(entryIdentity(row), { type: 'entry', index: -1, openEdit: false });
    event.preventDefault();
    event.stopPropagation();
    return openEditEntryForSelected();
  }

  function handleSelectableEntryActivation(selectable, event) {
    const type = selectable.dataset.diarySelectType;
    const index = selectable.dataset.diarySelectIndex;
    const rows = rowsForType(type);
    const row = rows[Number(index)];
    if (!row) return false;
    return handleEntryActivation(row, event, { type, index: Number(index) });
  }

  const DiaryEntryGestureMachine = (() => {
    let machineState = 'IDLE';
    const transitions = {
      IDLE: {
        tap: { next: 'IDLE', actions: ['select'] },
        doubleTap: { next: 'IDLE', actions: ['select', 'edit'] },
        longPress: { next: 'PREVIEW_OPEN', actions: ['select', 'preview'] },
      },
      PREVIEW_OPEN: {
        tap: { next: 'IDLE', actions: ['select'] },
        doubleTap: { next: 'IDLE', actions: ['select', 'edit'] },
        longPress: { next: 'PREVIEW_OPEN', actions: ['select', 'preview'] },
      },
    };

    function syncState() {
      machineState = activeActionModalView() === 'entry-preview' ? 'PREVIEW_OPEN' : 'IDLE';
    }

    function runAction(action, context) {
      const row = context?.row;
      if (!row) return;
      if (action === 'select') selectEntryForGesture(row, context.options || {});
      if (action === 'edit') openEditEntryForSelected();
      if (action === 'preview') openEntryPreview(row);
    }

    return {
      dispatch(input, context = {}) {
        syncState();
        const transition = transitions[machineState]?.[input];
        if (!transition) return machineState;
        machineState = transition.next;
        transition.actions.forEach(action => runAction(action, context));
        syncState();
        return machineState;
      },
    };
  })();

  function clearEntryLongPress() {
    if (entryLongPressTimer) window.clearTimeout(entryLongPressTimer);
    entryLongPressTimer = null;
    entryLongPressCandidate = null;
  }

  function beginEntryLongPress(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const target = event.target.closest('[data-diary-action="select-entry"][data-diary-entry-id], [data-diary-select-type][data-diary-entry-id]');
    if (!target) return;
    const row = findEventById(target.dataset.diaryEntryId);
    if (!row) return;
    clearEntryLongPress();
    entryLongPressCandidate = {
      id: entryIdentity(row),
      x: Number.isFinite(event.clientX) ? event.clientX : 0,
      y: Number.isFinite(event.clientY) ? event.clientY : 0,
      options: {
        type: target.dataset.diarySelectType || 'entry',
        index: Number.isFinite(Number(target.dataset.diarySelectIndex)) ? Number(target.dataset.diarySelectIndex) : -1,
      },
    };
    entryLongPressTimer = window.setTimeout(() => {
      const candidate = entryLongPressCandidate;
      clearEntryLongPress();
      const current = findEventById(candidate?.id) || row;
      suppressEntryClickUntil = eventNow() + 720;
      clearPendingEntryPreview();
      lastEntryTap = null;
      lastEntryPointerCandidate = null;
      DiaryEntryGestureMachine.dispatch('longPress', {
        row: current,
        event,
        options: candidate?.options || {},
      });
    }, ENTRY_LONG_PRESS_MS);
  }

  function moveEntryLongPress(event) {
    if (!entryLongPressTimer || !entryLongPressCandidate) return;
    const x = Number.isFinite(event.clientX) ? event.clientX : 0;
    const y = Number.isFinite(event.clientY) ? event.clientY : 0;
    if (Math.hypot(x - entryLongPressCandidate.x, y - entryLongPressCandidate.y) > DAY_DOUBLE_TAP_PX) {
      clearEntryLongPress();
    }
  }

  function selectionAttrs(type, index) {
    return `data-diary-select-type="${escHtml(type)}" data-diary-select-index="${escHtml(index)}" tabindex="0"`;
  }

  function entryAttrs(event) {
    const id = entryIdentity(event);
    return id ? `data-diary-action="select-entry" data-diary-entry-id="${escHtml(id)}"` : '';
  }

  function applySelectionStyles() {
    document.querySelectorAll('[data-diary-selected="true"]').forEach(node => {
      node.removeAttribute('data-diary-selected');
    });
    if (state.selectedEntryId) {
      document.querySelectorAll('[data-diary-entry-id]').forEach(node => {
        if (node.dataset.diaryEntryId === state.selectedEntryId) {
          node.setAttribute('data-diary-selected', 'true');
        }
      });
    }
    if (!state.selection) return;
    document.querySelectorAll('[data-diary-select-type]').forEach(node => {
      if (
        selectionKey(node.dataset.diarySelectType, node.dataset.diarySelectIndex) === state.selection.key
        || (state.selectedEntryId && node.dataset.diaryEntryId === state.selectedEntryId)
      ) {
        node.setAttribute('data-diary-selected', 'true');
      }
    });
  }

  function daySummaryTargetDate() {
    return detailRangeStart();
  }

  function ensureDaySummary() {
    const targetDate = daySummaryTargetDate();
    if (!targetDate) return;
    if (
      state.daySummaryDate === targetDate
      && (state.daySummary || state.daySummaryLoading || state.daySummaryError)
    ) {
      return;
    }
    fetchDaySummary(targetDate);
  }

  async function fetchDaySummary(dateText) {
    const requestId = state.daySummaryRequestId + 1;
    state.daySummaryRequestId = requestId;
    state.daySummaryDate = dateText;
    state.daySummary = null;
    state.daySummaryError = '';
    state.daySummaryLoading = true;
    try {
      const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
      const params = new URLSearchParams({ date: dateText, source_filter: 'all' });
      const resp = await fetcher(`/api/v1/personal/diary-day?${params.toString()}`);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(responseErrorMessage(data, resp.status));
      if (requestId !== state.daySummaryRequestId) return;
      state.daySummary = data;
    } catch (error) {
      if (requestId !== state.daySummaryRequestId) return;
      state.daySummaryError = error?.message || String(error);
    } finally {
      if (requestId === state.daySummaryRequestId) {
        state.daySummaryLoading = false;
        render();
      }
    }
  }

  async function generateSummary() {
    const dateText = daySummaryTargetDate();
    if (!dateText || state.daySummaryLoading) return false;
    const requestId = state.daySummaryRequestId + 1;
    state.daySummaryRequestId = requestId;
    state.daySummaryDate = dateText;
    state.daySummary = null;
    state.daySummaryError = '';
    state.daySummaryLoading = true;
    render();
    try {
      const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
      const resp = await fetcher('/api/v1/personal/diary-day/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          local_date: dateText,
          actor: 'blueprints-ui',
          source_surface: 'diary-page',
          request_id: `diary-day-summary-${Date.now()}`,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(responseErrorMessage(data, resp.status));
      if (requestId !== state.daySummaryRequestId) return false;
      state.daySummary = data.day || null;
      showActionModal('Generate Summary', kvHtml([
        ['Date', dateText],
        ['File', data.summary?.file_ref || ''],
        ['Source hash', data.summary?.source_hash || ''],
        ['Events', data.summary?.event_count || 0],
        ['Audit', data.audit?.audit_id || ''],
      ]), 'Summary file written.');
      return true;
    } catch (error) {
      if (requestId !== state.daySummaryRequestId) return false;
      state.daySummaryError = error?.message || String(error);
      state.daySummary = null;
      return false;
    } finally {
      if (requestId === state.daySummaryRequestId) {
        state.daySummaryLoading = false;
        render();
      }
    }
  }

  function eventRow(event, index, type) {
    const source = sourceType(event) || event.kind || 'source';
    const datePart = state.view !== 'day' ? `${monthLabel(eventStartDate(event), { weekday: 'short', day: '2-digit', month: 'short' })} - ` : '';
    const ref = event.source?.ref || (Array.isArray(event.file_refs) ? event.file_refs[0] : '') || event.event_id || '';
    const todoLink = todoLinkHtml(event);
    return `
      <div class="calendar-agenda-row diary-agenda-row calendar-agenda-row--${escHtml(eventCategory(event))}" ${selectionAttrs(type, index)} data-diary-entry-id="${escHtml(entryIdentity(event))}">
        <div class="calendar-agenda-time diary-agenda-time">${escHtml(eventTime(event))}</div>
        <div class="calendar-agenda-main diary-agenda-main">
          <div class="calendar-agenda-title diary-agenda-title">${escHtml(event.title || event.kind || event.event_id)}</div>
          <div class="calendar-agenda-meta diary-agenda-meta">${escHtml(datePart + (event.body_excerpt || event.status || ''))}</div>
          <div class="calendar-agenda-meta diary-agenda-meta calendar-agenda-meta--links">${escHtml(ref)}${todoLink}</div>
        </div>
        <span class="calendar-agenda-source diary-agenda-source">${escHtml(source)}</span>
      </div>
    `;
  }

  function listHtml(rows, type, empty) {
    return rows.length
      ? rows.map((event, index) => eventRow(event, index, type)).join('')
      : `<div class="calendar-empty diary-empty">${escHtml(empty)}</div>`;
  }

  function weekEventChip(event) {
    return `
      <button class="diary-week-event diary-week-event--${escHtml(eventCategory(event))}" type="button" ${entryAttrs(event)}>
        <span class="diary-week-event__time">${escHtml(eventTime(event))}</span>
        <span class="diary-week-event__title">${escHtml(event.title || event.kind || event.event_id)}</span>
      </button>
    `;
  }

  function renderWeekView() {
    const dateEvents = eventsByDate();
    const start = startOfWeek(parseLocalDate(state.date));
    const today = localDateString(new Date());
    const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
    return `
      <div class="diary-week-grid">
        ${days.map(date => {
          const dateText = localDateString(date);
          const rows = dateEvents.get(dateText) || [];
          const compactRows = rows.slice(0, 6);
          const more = rows.length > compactRows.length
            ? `<div class="diary-week-event diary-week-event--more">+${escHtml(rows.length - compactRows.length)} more</div>`
            : '';
          return `
            <article class="diary-week-card${dateText === state.date ? ' diary-week-card--selected' : ''}${dateText === today ? ' diary-week-card--today' : ''}">
              <button class="diary-week-card__title" type="button" data-diary-action="select-week-day" data-diary-date="${escHtml(dateText)}">
                <span class="diary-week-card__weekday">${escHtml(monthLabel(dateText, { weekday: 'long' }))}</span>
                <span class="diary-week-card__date">${escHtml(monthLabel(dateText, { day: '2-digit', month: 'short' }))}</span>
              </button>
              <div class="diary-week-card__body">
                ${compactRows.length ? compactRows.map(weekEventChip).join('') + more : '<div class="diary-week-empty">No visible entries.</div>'}
              </div>
            </article>
          `;
        }).join('')}
      </div>
    `;
  }

  function hourLabel(hour) {
    return `${String(hour).padStart(2, '0')}:00`;
  }

  function hourGapKey(startHour, endHour) {
    return `${state.date}:${startHour}-${endHour}`;
  }

  function emptyHourRow(hour) {
    return `
      <button class="diary-hour-row diary-hour-row--empty" type="button" data-diary-action="new-entry-at-hour" data-diary-hour="${escHtml(hour)}">
        <span class="diary-hour-row__time">${escHtml(hourLabel(hour))}</span>
        <span class="diary-hour-row__body">Add entry</span>
      </button>
    `;
  }

  function hourEventRow(hour, rows) {
    return `
      <section class="diary-hour-row diary-hour-row--filled">
        <div class="diary-hour-row__time">${escHtml(hourLabel(hour))}</div>
        <div class="diary-hour-row__body">
          ${rows.map(weekEventChip).join('')}
        </div>
      </section>
    `;
  }

  function hourGapRow(startHour, endHour) {
    const key = hourGapKey(startHour, endHour);
    const until = Math.min(24, endHour + 1);
    return `
      <button class="diary-hour-gap" type="button" data-diary-action="toggle-hour-gap" data-diary-gap="${escHtml(key)}">
        <span>${escHtml(hourLabel(startHour))}</span>
        <span aria-hidden="true">...</span>
        <span>${escHtml(hourLabel(until))}</span>
      </button>
    `;
  }

  function renderDayView() {
    const rows = eventsInRange(state.date, state.date);
    const allDay = rows.filter(isAllDay);
    const timed = rows.filter(event => !isAllDay(event));
    const byHour = new Map();
    timed.forEach(event => {
      const hour = eventHour(event);
      const key = Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 12;
      const bucket = byHour.get(key) || [];
      bucket.push(event);
      byHour.set(key, bucket);
    });
    byHour.forEach(bucket => bucket.sort(compareEvents));
    const hourRows = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const bucket = byHour.get(hour) || [];
      if (bucket.length) {
        hourRows.push(hourEventRow(hour, bucket));
        continue;
      }
      let end = hour;
      while (end + 1 < 24 && !(byHour.get(end + 1) || []).length) end += 1;
      const key = hourGapKey(hour, end);
      if (end > hour && !state.expandedGaps.has(key)) {
        hourRows.push(hourGapRow(hour, end));
      } else {
        for (let expandedHour = hour; expandedHour <= end; expandedHour += 1) {
          hourRows.push(emptyHourRow(expandedHour));
        }
      }
      hour = end;
    }
    return `
      <div class="diary-day-board">
        <div class="diary-day-board__head">
          <div>
            <div class="diary-day-board__date">${escHtml(monthLabel(state.date, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }))}</div>
            <div class="diary-day-board__meta">${escHtml(`${rows.length} visible item${rows.length === 1 ? '' : 's'}`)}</div>
          </div>
          <button class="calendar-command-btn diary-command-btn" type="button" data-diary-action="show-new-entry">New Entry</button>
        </div>
        ${allDay.length ? `
          <section class="diary-day-all-day" aria-label="All-day items">
            <div class="diary-day-all-day__title">All day</div>
            <div class="diary-day-all-day__items">${allDay.map(weekEventChip).join('')}</div>
          </section>
        ` : ''}
        <div class="diary-timeline">${hourRows.join('')}</div>
      </div>
    `;
  }

  function renderDiaryView() {
    const root = el('diary-view-root');
    if (!root) return;
    root.dataset.diaryView = state.view;
    root.innerHTML = state.view === 'day' ? renderDayView() : renderWeekView();
  }

  function selectedSummaryHtml(rows) {
    const total = rows.timed.length + rows.allDay.length;
    return `
      <div class="calendar-selected-summary__date">${escHtml(detailRangeLabel())}</div>
      <div class="calendar-selected-summary__meta">${escHtml(`${total} visible item${total === 1 ? '' : 's'} - ${filterLabel(state.sourceFilter)}`)}</div>
    `;
  }

  function daySummaryHtml() {
    ensureDaySummary();
    const dateText = daySummaryTargetDate();
    const label = monthLabel(dateText, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    let body = 'No summary for this day.';
    if (state.daySummaryLoading) {
      body = 'Loading day summary...';
    } else if (state.daySummaryError) {
      body = `Day summary unavailable: ${state.daySummaryError}`;
    } else {
      const info = state.daySummary?.summary || {};
      if (info.state === 'ready') body = info.excerpt || info.file_ref || 'day-summary.md';
      else if (info.state === 'summary_pending') body = 'Summary pending.';
    }
    return `
      <div class="calendar-day-summary diary-day-summary">
        <div class="calendar-day-summary__head">
          <span class="calendar-day-summary__title">Day Summary</span>
          <span class="calendar-day-summary__meta">
            <span class="calendar-day-summary__date">${escHtml(label)}</span>
            <button class="calendar-command-btn calendar-day-summary__generate" type="button" data-diary-action="generate-summary"${state.daySummaryLoading ? ' disabled' : ''}>${state.daySummaryLoading ? 'Generating' : 'Generate'}</button>
          </span>
        </div>
        <div class="calendar-day-summary__body">${escHtml(body)}</div>
      </div>
    `;
  }

  function upcomingEmptyMessage() {
    if (state.upcomingWideLoading) return `Loading future items for the next ${UPCOMING_WIDE_YEARS} years...`;
    if (state.upcomingWideError) return `Upcoming refresh failed: ${state.upcomingWideError}`;
    if (state.upcomingWide) return `No future items in the next ${UPCOMING_WIDE_YEARS} years.`;
    return 'No future items for this range.';
  }

  function upcomingScopeHtml() {
    return `
      <label class="calendar-check calendar-upcoming-scope hub-checkbox">
        <input class="hub-checkbox__input" type="checkbox" data-diary-upcoming-next-years${state.upcomingWide ? ' checked' : ''}${state.upcomingWideLoading ? ' disabled' : ''} />
        <span class="hub-checkbox__box" aria-hidden="true"></span>
        <span class="hub-checkbox__label">Next ${UPCOMING_WIDE_YEARS} years</span>
      </label>
    `;
  }

  function syncUpcomingControls() {
    document.querySelectorAll('[data-diary-upcoming-next-years]').forEach(control => {
      control.checked = state.upcomingWide;
      control.disabled = state.upcomingWideLoading;
    });
  }

  function renderSelectedSummary(rows) {
    const target = el('diary-selected-summary');
    if (!target) return;
    target.innerHTML = selectedSummaryHtml(rows);
  }

  function renderLists() {
    const rows = groupEvents();
    const selectedRows = rows.timed.concat(rows.allDay).sort(compareEvents);
    const selectedCount = el('diary-selected-count');
    if (selectedCount) selectedCount.textContent = String(selectedRows.length);
    const dayCount = el('diary-day-count');
    if (dayCount) dayCount.textContent = String(rows.allDay.length);
    const upcomingCount = el('diary-upcoming-count');
    if (upcomingCount) upcomingCount.textContent = String(rows.upcoming.length);
    renderSelectedSummary(rows);
    const selectedList = el('diary-selected-list');
    if (selectedList) selectedList.innerHTML = listHtml(selectedRows, 'selected', 'No visible items for this range.');
    const dayList = el('diary-day-list');
    if (dayList) dayList.innerHTML = `${daySummaryHtml()}${listHtml(rows.allDay, 'all-day', 'No all-day items or milestones for this range.')}`;
    const upcomingList = el('diary-upcoming-list');
    if (upcomingList) upcomingList.innerHTML = listHtml(rows.upcoming, 'upcoming', upcomingEmptyMessage());
    syncUpcomingControls();
  }

  function provenanceRows() {
    const summary = state.daySummary || {};
    const files = summary.files || {};
    const params = new URLSearchParams({
      date_start: rangeStart(),
      date_end: rangeEnd(),
      limit: '200',
    });
    return [
      ['Events API', `/api/v1/personal/events?${params.toString()}`, 'shared read path'],
      ['Diary day API', `/api/v1/personal/diary-day?date=${daySummaryTargetDate()}`, 'day summary and source ledger'],
      ['Entry API', '/api/v1/personal/diary-day/entries', 'manual diary entry source'],
      ['Summary API', '/api/v1/personal/diary-day/summary', 'generated day-summary.md'],
      ['Day folder', files.day_folder?.path || '', files.day_folder?.exists ? 'exists' : 'empty'],
      ['Source ledger', files.source_ledger?.path || '', files.source_ledger?.exists ? `${files.source_ledger.source_count || 0} sources` : 'empty'],
      ['Diary range', `${state.view} / ${rangeLabel()}`, 'week starts Monday'],
      ['Mode/filter', `${state.view} / ${state.sourceFilter}`, 'client projection'],
    ];
  }

  function provenanceRowsHtml() {
    return provenanceRows().map(([title, path, meta]) => `
      <div class="calendar-provenance-row diary-provenance-row">
        <div class="calendar-provenance-main diary-provenance-main">
          <div class="calendar-provenance-title diary-provenance-title">${escHtml(title)}</div>
          <div class="calendar-provenance-meta diary-provenance-meta">${escHtml(path)}</div>
          <div class="calendar-provenance-meta diary-provenance-meta">${escHtml(meta)}</div>
        </div>
      </div>
    `).join('');
  }

  function renderProvenance() {
    const target = el('diary-provenance');
    if (!target) return;
    target.innerHTML = provenanceRowsHtml();
  }

  function renderRefreshState() {
    document.querySelectorAll('[data-diary-action="refresh"], [data-diary-view-trigger]').forEach(btn => {
      btn.classList.toggle('is-refreshing', Boolean(state.loading));
      btn.setAttribute('aria-busy', state.loading ? 'true' : 'false');
    });
  }

  function renderContentPanels() {
    document.querySelectorAll('section[data-diary-content-view]').forEach(panel => {
      panel.hidden = panel.dataset.diaryContentView !== state.contentView;
    });
  }

  function renderContentViewTrigger() {
    document.querySelectorAll('[data-diary-view-trigger]').forEach(btn => {
      const label = contentViewLabel();
      btn.dataset.diaryCurrentContentView = state.contentView;
      btn.setAttribute('aria-label', `View: ${label}. Tap for next view, double tap to choose, long press to refresh.`);
      btn.setAttribute('aria-expanded', contentViewMenuHost ? 'true' : 'false');
      btn.title = `View: ${label}`;
    });
  }

  function renderStatus() {
    const strip = el('diary-status-strip');
    const status = state.loading
      ? (state.data ? 'refreshing' : 'loading')
      : (state.error ? 'error' : (state.data ? 'ready' : 'empty'));
    const tone = state.loading ? 'warn' : statusTone(status);
    if (strip) {
      const label = status === 'ready' ? '' : status;
      strip.dataset.diaryStatus = status;
      strip.setAttribute('aria-label', `${status} ${rangeLabel()}`);
      strip.innerHTML = `
        <span class="calendar-status-dot calendar-status-dot--${tone} diary-status-dot diary-status-dot--${tone}" aria-hidden="true"></span>
        ${label ? `<span class="calendar-status-strip__label diary-status-strip__label">${escHtml(label)}</span>` : ''}
        <span class="calendar-status-strip__range diary-status-strip__range">${escHtml(rangeLabel())}</span>
      `;
    }
    renderRefreshState();
  }

  function syncSharedFilterState() {
    if (!window.PersonalFilters?.getSelectedIds) return;
    const selected = window.PersonalFilters.getSelectedIds('diary');
    state.sourceFilter = selected.length ? 'custom' : 'all';
  }

  function renderMeta() {
    syncSharedFilterState();
    const meta = el('diary-meta');
    if (meta) {
      const count = visibleEvents().length;
      const content = state.contentView === 'diary' ? '' : ` - ${contentViewLabel()}`;
      meta.textContent = `${rangeLabel()} - ${state.view} view${content} - ${count} visible entr${count === 1 ? 'y' : 'ies'}`;
    }
    const dateInput = el('diary-date-input');
    if (dateInput) dateInput.value = state.date;
    syncEntryDate();
    renderEntryTagSummaries();
    const filter = el('diary-filter-strip');
    if (filter) {
      const selected = state.selection ? ` - selected ${state.selection.label}` : '';
      if (window.PersonalFilters?.summaryHtml) {
        filter.innerHTML = `${window.PersonalFilters.summaryHtml('diary')}${selected ? `<span class="calendar-filter-strip__selection">${escHtml(selected)}</span>` : ''}`;
      } else {
        filter.textContent = `Filter: ${filterLabel(state.sourceFilter)}${selected}`;
      }
      filter.dataset.personalFilterOpen = 'diary';
    }
    document.querySelectorAll('[data-diary-view-button]').forEach(btn => {
      btn.dataset.active = btn.dataset.diaryViewButton === state.view ? 'true' : 'false';
    });
    document.querySelectorAll('[data-diary-calendar-button]').forEach(btn => {
      btn.dataset.active = 'false';
    });
    renderContentPanels();
    renderContentViewTrigger();
    refreshOpenContentViewModal();
    if (window.PersonalFilters?.renderAll) window.PersonalFilters.renderAll();
  }

  function render() {
    renderStatus();
    renderMeta();
    renderDiaryView();
    renderLists();
    renderProvenance();
    applySelectionStyles();
    if (window.BodyShade && typeof window.BodyShade.scheduleSizeFillTable === 'function') {
      window.BodyShade.scheduleSizeFillTable();
    }
  }

  function renderError(message) {
    const strip = el('diary-status-strip');
    if (strip) {
      strip.innerHTML = `
        <span class="calendar-status-dot calendar-status-dot--err diary-status-dot diary-status-dot--err" aria-hidden="true"></span>
        <span>${escHtml(message)}</span>
      `;
    }
    const meta = el('diary-meta');
    if (meta) meta.textContent = 'Diary refresh failed';
  }

  function automationStatus() {
    if (state.loading) return state.data ? 'refreshing' : 'loading';
    if (state.error) return 'error';
    if (!state.loaded) return '';
    const dayStatus = String(dayPayload().day?.status || '').trim();
    if (dayStatus) return dayStatus;
    return visibleEvents().length ? 'ready' : 'empty';
  }

  function upcomingWideEndDate(startText) {
    const date = parseLocalDate(startText);
    date.setFullYear(date.getFullYear() + UPCOMING_WIDE_YEARS);
    return localDateString(date);
  }

  async function fetchUpcomingWide() {
    const requestId = state.upcomingWideRequestId + 1;
    state.upcomingWideRequestId = requestId;
    state.upcomingWideLoading = true;
    state.upcomingWideError = '';
    clearSelectedEntry();
    render();
    const nowParts = londonNowParts();
    try {
      const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
      const items = [];
      let offset = 0;
      for (let page = 0; items.length < UPCOMING_WIDE_MAX_EVENTS; page += 1) {
        const params = new URLSearchParams({
          date_start: nowParts.date,
          date_end: upcomingWideEndDate(nowParts.date),
          limit: String(UPCOMING_WIDE_BATCH_SIZE),
          offset: String(offset),
        });
        const resp = await fetcher(`/api/v1/personal/events?${params.toString()}`);
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(responseErrorMessage(data, resp.status));
        const pageItems = Array.isArray(data.items) ? data.items : [];
        items.push(...pageItems);
        const pagination = data.pagination || {};
        if (!pagination.has_more || pageItems.length < UPCOMING_WIDE_BATCH_SIZE) break;
        offset += UPCOMING_WIDE_BATCH_SIZE;
      }
      if (requestId !== state.upcomingWideRequestId) return;
      state.upcomingWideItems = items
        .filter(event => isUpcomingEvent(event, nowParts))
        .sort(compareEvents)
        .slice(0, UPCOMING_WIDE_MAX_EVENTS);
    } catch (error) {
      if (requestId !== state.upcomingWideRequestId) return;
      state.upcomingWideError = error?.message || String(error);
      state.upcomingWideItems = [];
    } finally {
      if (requestId === state.upcomingWideRequestId) {
        state.upcomingWideLoading = false;
        render();
      }
    }
  }

  function setUpcomingWide(enabled) {
    const next = Boolean(enabled);
    state.upcomingWide = next;
    clearSelectedEntry();
    if (!next) {
      state.upcomingWideRequestId += 1;
      state.upcomingWideLoading = false;
      state.upcomingWideError = '';
      render();
      return;
    }
    fetchUpcomingWide();
  }

  async function load(options = {}) {
    if (state.loading) return state.data;
    if (state.loaded && !options.force) return state.data;
    state.loading = true;
    state.error = '';
    render();
    try {
      const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
      const limit = 200;
      let offset = 0;
      let merged = null;
      const items = [];
      for (let page = 0; page < 20; page += 1) {
        const params = new URLSearchParams({
          date_start: rangeStart(),
          date_end: rangeEnd(),
          limit: String(limit),
          offset: String(offset),
        });
        const resp = await fetcher(`/api/v1/personal/events?${params.toString()}`);
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(responseErrorMessage(data, resp.status));
        if (!merged) merged = data;
        const pageItems = Array.isArray(data.items) ? data.items : [];
        items.push(...pageItems);
        const pagination = data.pagination || {};
        if (!pagination.has_more || pageItems.length < limit) break;
        offset += limit;
      }
      const data = merged || { items: [], pagination: {}, filters: {} };
      data.items = items;
      data.pagination = {
        ...(data.pagination || {}),
        offset: 0,
        count: items.length,
        has_more: false,
      };
      state.data = data;
      if (state.selectedEntryId && !findEventById(state.selectedEntryId)) clearSelectedEntry();
      if (window.PersonalFilters?.invalidateSurface) {
        window.PersonalFilters.invalidateSurface('diary');
        window.PersonalFilters.invalidateSurface(ENTRY_TAG_SURFACE);
        window.PersonalFilters.invalidateSurface(EDIT_TAG_SURFACE);
        window.PersonalFilters.invalidateSurface(SEARCH_TAG_SURFACE);
      }
      state.loaded = true;
      return data;
    } catch (error) {
      state.error = error.message || String(error);
      renderError(state.error);
      return null;
    } finally {
      state.loading = false;
      render();
    }
  }

  function setDate(dateText, options = {}) {
    state.date = localDateString(parseLocalDate(dateText));
    if (options.view) state.view = options.view === 'day' ? 'day' : 'week';
    state.loaded = false;
    clearSelectedEntry();
    state.entryDraftRange = null;
    state.expandedGaps.clear();
    syncEntryDate(true);
    syncSearchRange(true);
    writeStoredValue(VIEW_STORAGE_KEY, state.view);
    return load({ force: true });
  }

  function setView(view, dateText = null) {
    if (dateText) state.date = localDateString(parseLocalDate(dateText));
    state.view = view === 'day' ? 'day' : 'week';
    state.contentView = 'diary';
    state.loaded = false;
    clearSelectedEntry();
    state.entryDraftRange = null;
    state.expandedGaps.clear();
    syncEntryDate(true);
    syncSearchRange(true);
    writeStoredValue(VIEW_STORAGE_KEY, state.view);
    writeStoredValue(CONTENT_VIEW_STORAGE_KEY, state.contentView);
    return load({ force: true });
  }

  function selectWeekDay(dateText, drillDown = false) {
    state.date = localDateString(parseLocalDate(dateText));
    clearSelectedEntry();
    state.entryDraftRange = null;
    syncEntryDate(true);
    syncSearchRange(true);
    if (drillDown) return setView('day', state.date);
    render();
    return Promise.resolve(state.data);
  }

  function previous() {
    const delta = state.view === 'day' ? -1 : -7;
    return setDate(localDateString(addDays(parseLocalDate(state.date), delta)));
  }

  function next() {
    const delta = state.view === 'day' ? 1 : 7;
    return setDate(localDateString(addDays(parseLocalDate(state.date), delta)));
  }

  function today() {
    return setDate(localDateString(new Date()));
  }

  function goCalendar(view) {
    const targetDate = state.date;
    if (typeof switchGroup === 'function') switchGroup('dave');
    if (typeof switchTab === 'function') switchTab('calender');
    if (typeof DaveMenuConfig !== 'undefined') DaveMenuConfig.updateActiveTab('calender');
    const calendar = window.BlueprintsCalendarPage;
    if (calendar?.setDate) calendar.setDate(targetDate);
    if (view === 'month' && calendar?.viewMonth) calendar.viewMonth();
    else if (calendar?.viewYear) calendar.viewYear();
    return true;
  }

  function entryDefaultDate() {
    return state.entryDraftRange?.startDate || state.date;
  }

  function entryDefaultEndDate() {
    return state.entryDraftRange?.endDate || entryDefaultDate();
  }

  function entryDefaultStartTime() {
    return state.entryDraftRange?.startTime || '';
  }

  function entryDefaultEndTime() {
    return state.entryDraftRange?.endTime || '';
  }

  function orderedDateRange(startText, endText) {
    const start = localDateString(parseLocalDate(startText));
    const end = localDateString(parseLocalDate(endText || startText));
    return start <= end ? { start, end } : { start: end, end: start };
  }

  function eachDateText(startText, endText) {
    const range = orderedDateRange(startText, endText);
    const dates = [];
    for (let date = parseLocalDate(range.start); localDateString(date) <= range.end; date = addDays(date, 1)) {
      dates.push(localDateString(date));
    }
    return dates;
  }

  function hourEntryRange(hour) {
    const startHour = Number(hour);
    if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) return null;
    const startDate = localDateString(parseLocalDate(state.date));
    const endDate = startHour === 23 ? localDateString(addDays(parseLocalDate(startDate), 1)) : startDate;
    const endHour = (startHour + 1) % 24;
    return {
      startDate,
      endDate,
      startTime: hourLabel(startHour),
      endTime: hourLabel(endHour),
    };
  }

  function syncEntryDate(force = false) {
    const startDate = entryDefaultDate();
    const endDate = entryDefaultEndDate();
    document.querySelectorAll('[data-diary-entry-date]').forEach(input => {
      if (force || !input.value) input.value = startDate;
    });
    document.querySelectorAll('[data-diary-entry-end-date]').forEach(input => {
      if (force || !input.value) input.value = endDate;
    });
    syncSearchRange(force);
  }

  function searchDefaultRange() {
    return {
      start: detailRangeStart(),
      end: detailRangeEnd(),
      label: detailRangeLabel(),
    };
  }

  function syncSearchRange(force = false) {
    if (window.BlueprintsPersonalSearch?.syncRange) {
      window.BlueprintsPersonalSearch.syncRange('diary', { force });
    }
  }

  function entryTagsSummaryHtml(surface = ENTRY_TAG_SURFACE) {
    if (window.PersonalFilters?.summaryHtml) {
      return window.PersonalFilters.summaryHtml(surface, { prefix: 'Tags:' });
    }
    return '<span class="personal-filter-summary"><span class="personal-filter-summary__label">Tags:</span><span class="personal-filter-summary__empty">Diary</span></span>';
  }

  function renderEntryTagSummaries() {
    document.querySelectorAll('[data-diary-entry-tags-strip]').forEach(strip => {
      const surface = strip.dataset.diaryEntryTagsSurface || ENTRY_TAG_SURFACE;
      strip.innerHTML = entryTagsSummaryHtml(surface);
      strip.dataset.personalFilterOpen = ENTRY_TAG_SURFACE;
      strip.dataset.personalFilterTab = 'filters';
    });
    document.querySelectorAll('[data-diary-edit-tags-strip]').forEach(strip => {
      strip.innerHTML = entryTagsSummaryHtml(EDIT_TAG_SURFACE);
      strip.dataset.personalFilterOpen = EDIT_TAG_SURFACE;
      strip.dataset.personalFilterTab = 'filters';
    });
  }

  function tagIdsForSurface(surface) {
    const selected = window.PersonalFilters?.getSelectedIds
      ? window.PersonalFilters.getSelectedIds(surface)
      : [];
    return Array.from(new Set([...(selected || []), ...ENTRY_REQUIRED_TAGS]));
  }

  function entryTagIds() {
    return tagIdsForSurface(ENTRY_TAG_SURFACE);
  }

  function editEntryTagIds(event = null) {
    if (window.PersonalFilters?.getSelectedIds && event === null) return tagIdsForSurface(EDIT_TAG_SURFACE);
    const tags = Array.isArray(event?.tags) ? event.tags.map(tag => String(tag).trim()).filter(Boolean) : [];
    return Array.from(new Set([...tags, ...ENTRY_REQUIRED_TAGS]));
  }

  function setAllDayControls(prefix = 'diary-entry') {
    const allDay = !!el(`${prefix}-all-day`)?.checked;
    ['start', 'end'].forEach(key => {
      const input = el(`${prefix}-${key}`);
      if (input) input.disabled = allDay;
    });
    if (!allDay) {
      const start = el(`${prefix}-start`);
      const end = el(`${prefix}-end`);
      const startDate = el(`${prefix}-date`);
      const endDate = el(`${prefix}-end-date`);
      if (start && !start.value) start.value = entryDefaultStartTime();
      if (end && !end.value) end.value = entryDefaultEndTime();
      if (startDate && !startDate.value) startDate.value = entryDefaultDate();
      if (endDate && !endDate.value) endDate.value = entryDefaultEndDate();
    }
  }

  function splitEntryText(event) {
    const projection = String(event?.content_projection || event?.body_excerpt || '').trim();
    const title = String(event?.title || '').trim();
    if (title && projection.startsWith(`${title}\n\n`)) {
      return { title, body: projection.slice(title.length + 2).trim() };
    }
    if (title && projection === title) return { title, body: '' };
    return { title, body: projection };
  }

  function entryFormDefaults(mode) {
    if (mode !== 'edit') {
      return {
        title: '',
        startDate: entryDefaultDate(),
        endDate: entryDefaultEndDate(),
        startTime: '',
        endTime: '',
        allDay: true,
        body: '',
      };
    }
    const event = selectedEntry();
    const text = splitEntryText(event);
    const meta = calendarMeta(event);
    const startDate = eventStartDate(event);
    const endDate = meta.local_end_date || startDate;
    return {
      title: text.title,
      startDate,
      endDate,
      startTime: meta.local_start_time || '',
      endTime: meta.local_end_time || '',
      allDay: isAllDay(event),
      body: text.body,
    };
  }

  function embeddedEntryFormHtml(prefix, options = {}) {
    const safePrefix = String(prefix || 'diary-panel-entry').replace(/[^a-zA-Z0-9_-]/g, '-');
    const mode = options.mode === 'edit' ? 'edit' : 'new';
    const event = mode === 'edit' ? selectedEntry() : null;
    const editability = mode === 'edit' ? entryEditability(event) : { editable: true, route: 'diary', reason: '' };
    const formDisabled = mode === 'edit' && !editability.editable;
    const formDisabledAttr = formDisabled ? ' disabled' : '';
    const defaults = entryFormDefaults(mode);
    const valueFor = (key, fallback = '') => String(el(`${safePrefix}-${key}`)?.value || fallback);
    const allDay = el(`${safePrefix}-all-day`) ? !!el(`${safePrefix}-all-day`)?.checked : defaults.allDay;
    const disabled = (allDay || formDisabled) ? ' disabled' : '';
    const title = mode === 'edit' ? 'Edit Entry' : 'New Entry';
    const tagAttr = formDisabled
      ? 'aria-disabled="true"'
      : (mode === 'edit'
      ? `data-diary-edit-tags-strip data-diary-entry-tags-surface="${escHtml(EDIT_TAG_SURFACE)}" data-personal-filter-open="${escHtml(EDIT_TAG_SURFACE)}"`
      : `data-diary-entry-tags-strip data-diary-entry-tags-surface="${escHtml(ENTRY_TAG_SURFACE)}" data-personal-filter-open="${escHtml(ENTRY_TAG_SURFACE)}"`);
    const tagSummary = entryTagsSummaryHtml(mode === 'edit' ? EDIT_TAG_SURFACE : ENTRY_TAG_SURFACE);
    const action = mode === 'edit' ? 'submit-edit-entry' : 'submit-entry';
    const eventId = mode === 'edit' ? entryIdentity(event) : '';
    return `
      <section class="calendar-quick-event calendar-quick-event--embedded diary-quick-entry diary-quick-entry--embedded" aria-label="${escHtml(title)}"${eventId ? ` data-diary-editing-entry-id="${escHtml(eventId)}"` : ''}>
        <div class="calendar-form-grid calendar-event-form-grid diary-entry-form-grid">
          <label class="calendar-field calendar-field--wide" for="${escHtml(safePrefix)}-title">
            <span>Title</span>
            <input id="${escHtml(safePrefix)}-title" type="text" maxlength="180" autocomplete="off" value="${escHtml(valueFor('title', defaults.title))}"${formDisabledAttr} />
          </label>
          <label class="calendar-field" for="${escHtml(safePrefix)}-date">
            <span>Start date</span>
            <input id="${escHtml(safePrefix)}-date" type="date" data-diary-entry-date value="${escHtml(valueFor('date', defaults.startDate))}"${formDisabledAttr} />
          </label>
          <label class="calendar-field" for="${escHtml(safePrefix)}-end-date">
            <span>End date</span>
            <input id="${escHtml(safePrefix)}-end-date" type="date" data-diary-entry-end-date value="${escHtml(valueFor('end-date', valueFor('date', defaults.endDate)))}"${formDisabledAttr} />
          </label>
          <label class="calendar-field" for="${escHtml(safePrefix)}-start">
            <span>Start</span>
            <input id="${escHtml(safePrefix)}-start" type="time" value="${escHtml(valueFor('start', defaults.startTime))}"${disabled} />
          </label>
          <label class="calendar-field" for="${escHtml(safePrefix)}-end">
            <span>End</span>
            <input id="${escHtml(safePrefix)}-end" type="time" value="${escHtml(valueFor('end', defaults.endTime))}"${disabled} />
          </label>
          <div class="calendar-event-options-row diary-entry-options-row">
            <label class="calendar-check hub-checkbox" for="${escHtml(safePrefix)}-all-day">
              <input id="${escHtml(safePrefix)}-all-day" class="hub-checkbox__input" type="checkbox" data-diary-entry-all-day="${escHtml(safePrefix)}"${allDay ? ' checked' : ''}${formDisabledAttr} />
              <span class="hub-checkbox__box" aria-hidden="true"></span>
              <span class="hub-checkbox__label">All day</span>
            </label>
            <div class="calendar-filter-strip calendar-event-tags-strip diary-entry-tags-strip" role="button" tabindex="0" ${tagAttr} data-personal-filter-tab="filters">${tagSummary}</div>
          </div>
          ${richMarkdownFieldHtml({
            textareaId: `${safePrefix}-body`,
            previewId: `${safePrefix}-body-preview`,
            label: 'Notes',
            value: valueFor('body', defaults.body),
            rows: 3,
            maxlength: 4000,
            event: event || { event_id: safePrefix, local_date: valueFor('date', defaults.startDate) },
            disabled: formDisabled,
          })}
        </div>
        <div class="calendar-quick-event__footer diary-quick-entry__footer">
          <span id="${escHtml(safePrefix)}-status" class="calendar-entry-status diary-entry-status">${formDisabled ? escHtml(editability.reason) : ''}</span>
          <div class="calendar-quick-event__actions diary-quick-entry__actions">
            ${mode === 'edit' ? `<button class="calendar-command-btn diary-command-btn calendar-command-btn--danger diary-command-btn--danger" type="button" data-diary-action="delete-entry" data-diary-entry-prefix="${escHtml(safePrefix)}"${!eventId || formDisabled ? ' disabled' : ''}>Delete</button>` : ''}
            <button class="calendar-command-btn diary-command-btn" type="button" data-diary-action="${escHtml(action)}" data-diary-entry-prefix="${escHtml(safePrefix)}"${mode === 'edit' && (!eventId || formDisabled) ? ' disabled' : ''}>Save Entry</button>
          </div>
        </div>
      </section>
    `;
  }

  function embeddedEntryPrefixForHost(host) {
    if (host?.id === 'diary-filter-inline-panel') return 'diary-inline-entry';
    if (host?.closest?.('#ultrawide-sidecar-body')) return 'diary-sidecar-entry';
    return 'diary-panel-entry';
  }

  function embeddedEditPrefixForHost(host) {
    if (host?.id === 'diary-filter-inline-panel') return 'diary-inline-edit-entry';
    if (host?.closest?.('#ultrawide-sidecar-body')) return 'diary-sidecar-edit-entry';
    return 'diary-panel-edit-entry';
  }

  function embeddedSearchHtml(host) {
    const instance = host?.dataset?.diaryModalHost === '1'
      ? 'diary-modal-search'
      : (host?.id === 'diary-filter-inline-panel'
      ? 'diary-inline-search'
      : (host?.closest?.('#ultrawide-sidecar-body') ? 'diary-sidecar-search' : 'diary-panel-search'));
    window.setTimeout(() => {
      if (window.BlueprintsPersonalSearch?.init) window.BlueprintsPersonalSearch.init();
    }, 0);
    return `<div class="personal-search-strip personal-search-strip--embedded" data-personal-search-surface="diary" data-personal-search-instance="${escHtml(instance)}"></div>`;
  }

  function embeddedSelectedHtml(options = {}) {
    const rows = groupEvents();
    const selectedRows = rows.timed.concat(rows.allDay).sort(compareEvents);
    const head = options.modal
      ? ''
      : `<div class="calendar-section-head diary-section-head">
          <h3>Selected Range Visible Items</h3>
          <span class="calendar-pill diary-pill">${escHtml(selectedRows.length)}</span>
        </div>`;
    return `
      <section class="calendar-band calendar-band--embedded-selected diary-band diary-band--embedded-selected" aria-label="Selected Range Visible Items">
        ${head}
        <div class="calendar-selected-summary diary-selected-summary">${selectedSummaryHtml(rows)}</div>
        <div class="calendar-agenda-list diary-agenda-list">${listHtml(selectedRows, 'selected', 'No visible items for this range.')}</div>
      </section>
    `;
  }

  function embeddedDayHtml(options = {}) {
    const rows = groupEvents();
    const head = options.modal
      ? ''
      : `<div class="calendar-section-head diary-section-head">
          <h3>All-Day And Milestones</h3>
          <span class="calendar-pill diary-pill">${escHtml(rows.allDay.length)}</span>
        </div>`;
    return `
      <section class="calendar-band calendar-band--embedded-milestones diary-band diary-band--embedded-day" aria-label="All-Day And Milestones">
        ${head}
        ${daySummaryHtml()}
        <div class="calendar-agenda-list diary-agenda-list">${listHtml(rows.allDay, 'all-day', 'No all-day items or milestones for this range.')}</div>
      </section>
    `;
  }

  function embeddedUpcomingHtml(options = {}) {
    const rows = groupEvents();
    const head = options.modal
      ? ''
      : `<div class="calendar-section-head diary-section-head">
          <div class="calendar-section-head__cluster">
            <h3>Upcoming</h3>
            ${upcomingScopeHtml()}
            <span class="calendar-pill diary-pill">${escHtml(rows.upcoming.length)}</span>
          </div>
        </div>`;
    return `
      <section class="calendar-band calendar-band--embedded-upcoming diary-band diary-band--embedded-upcoming" aria-label="Upcoming">
        ${head}
        <div class="calendar-agenda-list diary-agenda-list">${listHtml(rows.upcoming, 'upcoming', upcomingEmptyMessage())}</div>
      </section>
    `;
  }

  function embeddedProvenanceHtml(options = {}) {
    const head = options.modal
      ? ''
      : `<div class="calendar-section-head diary-section-head">
          <h3>Provenance</h3>
        </div>`;
    return `
      <section class="calendar-band calendar-band--embedded-provenance diary-band diary-band--embedded-provenance" aria-label="Provenance">
        ${head}
        <div class="calendar-provenance-list diary-provenance-list">${provenanceRowsHtml()}</div>
      </section>
    `;
  }

  function contentViewModalToolsHtml(view) {
    const rows = groupEvents();
    if (view === 'selected') {
      const selectedRows = rows.timed.concat(rows.allDay);
      return `<span class="calendar-pill diary-pill">${escHtml(selectedRows.length)}</span>`;
    }
    if (view === 'day') return `<span class="calendar-pill diary-pill">${escHtml(rows.allDay.length)}</span>`;
    if (view === 'upcoming') return `${upcomingScopeHtml()}<span class="calendar-pill diary-pill">${escHtml(rows.upcoming.length)}</span>`;
    return '';
  }

  function contentViewModalHtml(view) {
    if (view === 'selected') return embeddedSelectedHtml({ modal: true });
    if (view === 'day') return embeddedDayHtml({ modal: true });
    if (view === 'search') return embeddedSearchHtml({ dataset: { diaryModalHost: '1' } });
    if (view === 'new-entry') return embeddedEntryFormHtml('diary-modal-entry');
    if (view === 'edit-entry') return embeddedEntryFormHtml('diary-modal-edit-entry', { mode: 'edit' });
    if (view === 'upcoming') return embeddedUpcomingHtml({ modal: true });
    if (view === 'provenance') return embeddedProvenanceHtml({ modal: true });
    return '';
  }

  function prepareContentViewModal(view) {
    if (view === 'new-entry') {
      syncEntryDate(true);
      renderEntryTagSummaries();
      setAllDayControls('diary-modal-entry');
      window.setTimeout(() => el('diary-modal-entry-title')?.focus(), 0);
    }
    if (view === 'edit-entry') {
      if (!editEntryAvailable()) {
        openContentViewModal('new-entry');
        return;
      }
      renderEntryTagSummaries();
      setAllDayControls('diary-modal-edit-entry');
      window.setTimeout(() => el('diary-modal-edit-entry-title')?.focus(), 0);
    }
    if (view === 'upcoming') syncUpcomingControls();
    if (view === 'search' && window.BlueprintsPersonalSearch?.init) {
      syncSearchRange(true);
      window.setTimeout(() => window.BlueprintsPersonalSearch.init(), 0);
    }
  }

  function refreshOpenContentViewModal() {
    const modal = el('diary-action-modal');
    const body = el('diary-action-modal-body');
    const tools = el('diary-action-modal-tools');
    const view = modal?.open ? modal.dataset.diaryActionModalView : '';
    if (!body || !MODAL_CONTENT_VIEW_IDS.includes(view)) return;
    if (tools) {
      tools.innerHTML = contentViewModalToolsHtml(view);
      tools.hidden = !tools.innerHTML.trim();
    }
    if (view === 'new-entry' || view === 'edit-entry' || view === 'search') {
      if (view === 'new-entry') {
        syncEntryDate(false);
        renderEntryTagSummaries();
      }
      if (view === 'edit-entry') {
        if (!editEntryAvailable()) {
          openContentViewModal('new-entry');
          return;
        }
        renderEntryTagSummaries();
      }
      if (view === 'search') syncSearchRange(false);
      return;
    }
    body.innerHTML = contentViewModalHtml(view);
    prepareContentViewModal(view);
  }

  function closeActionModal() {
    const modal = el('diary-action-modal');
    const body = el('diary-action-modal-body');
    const tools = el('diary-action-modal-tools');
    if (!modal) return;
    if (typeof HubModal !== 'undefined') HubModal.close(modal);
    else if (typeof modal.close === 'function') modal.close();
    modal.classList.remove('calendar-action-modal--content', 'diary-action-modal--content');
    delete modal.dataset.diaryActionModalView;
    if (body) body.innerHTML = '';
    if (tools) {
      tools.innerHTML = '';
      tools.hidden = true;
    }
  }

  function showActionModal(title, html, status = '', options = {}) {
    const modal = el('diary-action-modal');
    const titleEl = el('diary-action-modal-title');
    const body = el('diary-action-modal-body');
    const tools = el('diary-action-modal-tools');
    const statusEl = el('diary-action-modal-status');
    if (!modal || !body) return false;
    const contentView = options.contentView || '';
    modal.classList.toggle('calendar-action-modal--content', Boolean(contentView));
    modal.classList.toggle('diary-action-modal--content', Boolean(contentView));
    if (contentView) modal.dataset.diaryActionModalView = contentView;
    else delete modal.dataset.diaryActionModalView;
    if (titleEl) titleEl.textContent = title;
    body.innerHTML = html;
    if (tools) {
      tools.innerHTML = options.headerToolsHtml || '';
      tools.hidden = !tools.innerHTML.trim();
    }
    if (statusEl) statusEl.textContent = status;
    if (typeof HubModal !== 'undefined') HubModal.open(modal);
    else if (typeof modal.showModal === 'function' && !modal.open) modal.showModal();
    return true;
  }

  function openContentViewModal(view, options = {}) {
    const cleanView = normalizeContentView(view);
    closeContentViewMenu();
    if (cleanView === 'diary') return setContentView('diary');
    if (cleanView === 'filters') return openFilterModal('filters');
    if (cleanView === 'filter-settings') return openFilterModal('settings');
    if (cleanView === 'edit-entry' && !editEntryAvailable()) {
      return openContentViewModal('new-entry');
    }
    if (!MODAL_CONTENT_VIEW_IDS.includes(cleanView)) return false;
    if (cleanView === 'new-entry' && !options.keepEntryDraft) {
      state.entryDraftRange = null;
      syncEntryDate(true);
    }
    const shown = showActionModal(contentViewLabel(cleanView), contentViewModalHtml(cleanView), '', {
      contentView: cleanView,
      headerToolsHtml: contentViewModalToolsHtml(cleanView),
    });
    if (shown) prepareContentViewModal(cleanView);
    return shown;
  }

  function kvHtml(items) {
    return `<dl class="calendar-action-kv diary-action-kv">${items.map(([key, value]) => `
      <dt>${escHtml(key)}</dt><dd>${escHtml(value ?? '')}</dd>
    `).join('')}</dl>`;
  }

  function entryPreviewTitle(event) {
    return splitEntryText(event).title || event?.title || event?.kind || 'Diary Entry';
  }

  function entryPreviewBody(event) {
    const parts = splitEntryText(event);
    return parts.body || event?.body_excerpt || event?.content_projection || '';
  }

  function entryPreviewMeta(event) {
    const meta = calendarMeta(event);
    const date = eventStartDate(event);
    const bits = [
      monthLabel(date, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }),
      eventTime(event),
      sourceType(event) || event?.kind || '',
    ].filter(Boolean);
    if (meta.local_end_date && meta.local_end_date !== date) {
      bits.splice(1, 0, `to ${monthLabel(meta.local_end_date, { day: '2-digit', month: 'long', year: 'numeric' })}`);
    }
    return bits.join(' · ');
  }

	  function entryPreviewToolsHtml(event) {
	    if (!entryEditability(event).editable) return '';
	    return `
	      <button class="calendar-action-icon-btn table-icon-btn table-icon-btn--edit" type="button" data-diary-modal-action="edit-entry-content" title="Edit content" aria-label="Edit content"></button>
	    `;
	  }

  function entryPreviewHtml(event, options = {}) {
    const editability = entryEditability(event);
    const body = entryPreviewBody(event);
    if (options.editing && editability.editable) {
      return `
        <section class="calendar-entry-preview diary-entry-preview" data-diary-entry-preview-id="${escHtml(entryIdentity(event))}">
          <div class="calendar-entry-preview__meta">${escHtml(entryPreviewMeta(event))}${todoLinkHtml(event)}</div>
          <div class="calendar-entry-preview-editor">
            ${richMarkdownFieldHtml({
              textareaId: 'diary-entry-preview-editor',
              previewId: 'diary-entry-preview-editor-preview',
              label: 'Content',
              value: body,
              rows: 14,
              maxlength: 4000,
              event,
              previewClass: 'calendar-entry-preview-editor__markdown',
            })}
            <div class="calendar-entry-preview-editor__footer">
              <span id="diary-entry-preview-status" class="calendar-entry-status diary-entry-status"></span>
              <button class="calendar-command-btn diary-command-btn" type="button" data-diary-modal-action="save-entry-content">Save Content</button>
            </div>
          </div>
        </section>
      `;
    }
    return `
      <section class="calendar-entry-preview diary-entry-preview" data-diary-entry-preview-id="${escHtml(entryIdentity(event))}">
        <div class="calendar-entry-preview__meta">${escHtml(entryPreviewMeta(event))}${todoLinkHtml(event)}</div>
        <div class="calendar-markdown-preview calendar-entry-preview__body">${renderMarkdown(body)}</div>
        ${editability.editable ? '' : `<p class="calendar-entry-preview__notice">${escHtml(editability.reason)}</p>`}
      </section>
    `;
  }

  function openEntryPreview(event) {
    if (!event?.event_id) return false;
    selectEntryById(entryIdentity(event), { openEdit: false });
    return showActionModal(entryPreviewTitle(event), entryPreviewHtml(event), '', {
      contentView: 'entry-preview',
      headerToolsHtml: entryPreviewToolsHtml(event),
    });
  }

  function openSelectedEntryContentEditor() {
    const event = selectedEntry();
    if (!event?.event_id || !entryEditability(event).editable) return false;
    return showActionModal(entryPreviewTitle(event), entryPreviewHtml(event, { editing: true }), '', {
      contentView: 'entry-preview',
    });
  }

  function diaryEditPayloadForContent(event, bodyText) {
    const parts = splitEntryText(event);
    const title = parts.title || event?.title || '';
    const meta = calendarMeta(event);
    const startDate = eventStartDate(event);
    const runId = `ui-diary-content-edit-${Date.now()}`;
    return {
      body: [title, bodyText.trim()].filter(Boolean).join('\n\n'),
      local_date: startDate,
      range_start_date: startDate,
      range_end_date: meta.local_end_date || startDate,
      local_time: isAllDay(event) ? null : meta.local_start_time || null,
      end_time: isAllDay(event) ? null : meta.local_end_time || null,
      all_day: isAllDay(event),
      actor: 'blueprints-ui',
      source_surface: 'diary-page',
      request_id: runId,
      run_id: runId,
      tags: eventTags(event),
    };
  }

  function calendarEditPayloadForContent(event, bodyText) {
    const meta = calendarMeta(event);
    const runId = `ui-diary-calendar-content-edit-${Date.now()}`;
    return {
      title: splitEntryText(event).title || event?.title || 'Untitled',
      body: bodyText.trim(),
      local_date: eventStartDate(event),
      start_time: isAllDay(event) ? null : meta.local_start_time || null,
      end_time: isAllDay(event) ? null : meta.local_end_time || null,
      all_day: isAllDay(event),
      tags: eventTags(event),
      actor: 'blueprints-ui',
      source_surface: 'diary-page',
      request_id: runId,
      run_id: runId,
    };
  }

  async function saveSelectedEntryContent() {
    const event = selectedEntry();
    const status = el('diary-entry-preview-status');
    const editability = entryEditability(event);
    if (!editability.editable || !event?.event_id) {
      if (status) status.textContent = editability.reason || 'Entry cannot be edited.';
      return false;
    }
    const bodyText = String(el('diary-entry-preview-editor')?.value || '').trim();
    if (status) status.textContent = 'Saving content...';
    const route = editability.route === 'calendar'
      ? `/api/v1/personal/calendar/events/${encodeURIComponent(event.event_id)}`
      : `/api/v1/personal/diary-day/entries/${encodeURIComponent(event.event_id)}`;
    const payload = editability.route === 'calendar'
      ? calendarEditPayloadForContent(event, bodyText)
      : diaryEditPayloadForContent(event, bodyText);
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const resp = await fetcher(route, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      if (status) status.textContent = responseErrorMessage(data, resp.status);
      return false;
    }
    if (status) status.textContent = 'Saved content.';
    state.lastWrite = data;
    state.date = data.event?.local_date || payload.local_date || state.date;
    state.selectedEntryId = data.event?.event_id || event.event_id;
    state.loaded = false;
    state.daySummary = data.day || state.daySummary;
    await load({ force: true });
    const saved = selectedEntry() || data.event || event;
    return showActionModal(entryPreviewTitle(saved), entryPreviewHtml(saved), 'Saved content.', {
      contentView: 'entry-preview',
      headerToolsHtml: entryPreviewToolsHtml(saved),
    });
  }

  function toggleMarkdownPreview(target, actionRoot = document) {
    const button = target?.nodeType === 1
      ? target
      : (actionRoot.querySelector?.(`[data-diary-markdown-prefix="${target}"]`) || document.querySelector(`[data-diary-markdown-prefix="${target}"]`));
    const prefix = button?.dataset?.diaryMarkdownPrefix || String(target || 'diary-entry');
    const field = button?.closest?.('.calendar-markdown-field');
    const body = field?.querySelector?.('textarea') || el(`${prefix}-body`);
    const preview = field?.querySelector?.('.calendar-markdown-preview') || el(`${prefix}-body-preview`);
    if (!body || !preview) return false;
    const showing = !preview.hidden;
    if (showing) {
      preview.hidden = true;
      body.hidden = false;
      if (button) button.textContent = 'Preview';
      return true;
    }
    preview.innerHTML = renderMarkdown(body.value);
    preview.hidden = false;
    body.hidden = true;
    if (button) button.textContent = 'Edit';
    return true;
  }

  function toggleEntryContentPreview(button) {
    const editorId = button?.dataset?.diaryPreviewEditor || 'diary-entry-preview-editor';
    const previewId = button?.dataset?.diaryPreviewOutput || 'diary-entry-preview-editor-preview';
    const body = el(editorId);
    const preview = el(previewId);
    if (!body || !preview) return false;
    const showing = !preview.hidden;
    if (showing) {
      preview.hidden = true;
      body.hidden = false;
      if (button) button.textContent = 'Preview';
      body.focus();
      return true;
    }
    preview.innerHTML = renderMarkdown(body.value);
    preview.hidden = false;
    body.hidden = true;
    if (button) button.textContent = 'Edit';
    return true;
  }

  function dayPayload() {
    return state.daySummary || {};
  }

  function showDayFolder() {
    const folder = dayPayload().files?.day_folder || {};
    return showActionModal('Day Folder', kvHtml([
      ['Date', daySummaryTargetDate()],
      ['Path', folder.path || ''],
      ['State', folder.exists ? 'exists' : 'empty'],
    ]));
  }

  function showSourceLedger() {
    const ledger = dayPayload().files?.source_ledger || {};
    const sources = Array.isArray(ledger.sources) ? ledger.sources : [];
    const list = sources.length ? `<ul>${sources.slice(0, 12).map(item => `
      <li>${escHtml(item.source_type || 'source')}: ${escHtml(item.source_ref || item.file_ref || '')}</li>
    `).join('')}</ul>` : '<p>No source ledger entries for this day.</p>';
    return showActionModal('Source Ledger', `${kvHtml([
      ['Path', ledger.path || ''],
      ['State', ledger.exists ? 'exists' : 'empty'],
      ['Sources', ledger.source_count || 0],
    ])}${list}`);
  }

  function openSource() {
    const event = state.selection?.row;
    if (!event) {
      return showActionModal('Diary Source', '<p>Select a Diary row before opening source detail.</p>');
    }
    return showActionModal('Diary Source', `${kvHtml([
      ['Event', event.event_id || ''],
      ['Source', sourceType(event) || ''],
      ['Ref', event.source?.ref || ''],
      ['Kind', event.kind || ''],
      ['Status', event.status || ''],
    ])}<pre style="white-space:pre-wrap;overflow-wrap:anywhere;margin:0">${escHtml(JSON.stringify(event.provenance || {}, null, 2))}</pre>`);
  }

  function explainSelection() {
    const event = state.selection?.row;
    if (event) return openSource();
    return showActionModal('Diary State', kvHtml([
      ['View', state.view],
      ['Range', rangeLabel()],
      ['Filter', filterLabel(state.sourceFilter)],
      ['Visible events', visibleEvents().length],
      ['Read path', '/api/v1/personal/events'],
      ['Diary day', '/api/v1/personal/diary-day'],
    ]));
  }

  async function linkKanbanItem() {
    const event = state.selection?.row;
    if (!event) {
      return showActionModal('Link Kanban', '<p>Select a diary row before linking a Kanban item.</p>');
    }
    return showActionModal('Link Kanban', `${kvHtml([
      ['Event', event.event_id || ''],
      ['Current links', (event.related?.kanban_items || []).join(', ') || 'none'],
    ])}
      <label class="calendar-field" for="diary-kanban-link-input">
        <span>Kanban ref</span>
        <input id="diary-kanban-link-input" type="text" autocomplete="off" />
      </label>
      <button class="calendar-command-btn diary-command-btn" type="button" data-diary-modal-action="submit-kanban-link">Link Kanban</button>`);
  }

  async function submitKanbanLink() {
    const event = state.selection?.row;
    const input = el('diary-kanban-link-input');
    const kanbanRef = String(input?.value || '').trim();
    if (!event?.event_id || !kanbanRef) return false;
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const resp = await fetcher(`/api/v1/personal/events/${encodeURIComponent(event.event_id)}/kanban-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kanban_item_ref: kanbanRef,
        actor: 'blueprints-ui',
        source_surface: 'diary-page',
        request_id: `ui-diary-kanban-link-${Date.now()}`,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      showActionModal('Link Kanban', `<p>${escHtml(responseErrorMessage(data, resp.status))}</p>`);
      return false;
    }
    await load({ force: true });
    return showActionModal('Link Kanban', kvHtml([
      ['Event', data.event?.event_id || event.event_id],
      ['Kanban ref', kanbanRef],
      ['Audit', data.audit?.audit_id || ''],
    ]), 'Work link recorded.');
  }

  async function safeChecks() {
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const params = new URLSearchParams({
      date_start: rangeStart(),
      date_end: rangeEnd(),
      limit: '200',
    });
    const first = await fetcher(`/api/v1/personal/events?${params.toString()}`).then(resp => resp.json());
    const second = await fetcher(`/api/v1/personal/events?${params.toString()}`).then(resp => resp.json());
    const dayParams = new URLSearchParams({ date: daySummaryTargetDate(), source_filter: 'all' });
    const day = await fetcher(`/api/v1/personal/diary-day?${dayParams.toString()}`).then(resp => resp.json());
    state.data = second;
    state.daySummary = day;
    if (window.PersonalFilters?.invalidateSurface) {
      window.PersonalFilters.invalidateSurface('diary');
      window.PersonalFilters.invalidateSurface(ENTRY_TAG_SURFACE);
      window.PersonalFilters.invalidateSurface(EDIT_TAG_SURFACE);
      window.PersonalFilters.invalidateSurface(SEARCH_TAG_SURFACE);
    }
    state.loaded = true;
    render();
    return showActionModal('Diary Safe Checks', kvHtml([
      ['Events route', '/api/v1/personal/events'],
      ['Diary route', '/api/v1/personal/diary-day'],
      ['View', state.view],
      ['Range', rangeLabel()],
      ['Count stable', (first.items || []).length === (second.items || []).length ? 'yes' : 'no'],
      ['Day status', day.status || 'unknown'],
    ]), 'No destructive command was run.');
  }

  function entryPayloadsFromForm(prefix = 'diary-entry') {
    const title = String(el(`${prefix}-title`)?.value || '').trim();
    const body = String(el(`${prefix}-body`)?.value || '').trim();
    const text = [title, body].filter(Boolean).join('\n\n');
    const allDay = !!el(`${prefix}-all-day`)?.checked;
    const startDate = String(el(`${prefix}-date`)?.value || state.date).trim();
    const endDate = String(el(`${prefix}-end-date`)?.value || startDate || state.date).trim();
    const dates = eachDateText(startDate, endDate);
    const runId = dates.length > 1 ? `ui-diary-range-${Date.now()}` : `ui-diary-entry-${Date.now()}`;
    const base = {
      body: text,
      local_time: allDay ? null : String(el(`${prefix}-start`)?.value || '').trim() || null,
      end_time: allDay ? null : String(el(`${prefix}-end`)?.value || '').trim() || null,
      all_day: allDay,
      actor: 'blueprints-ui',
      source_surface: 'diary-page',
      tags: entryTagIds(),
    };
    return dates.map((localDate, index) => ({
      ...base,
      local_date: localDate,
      range_start_date: startDate,
      range_end_date: endDate,
      request_id: dates.length > 1 ? `${runId}-${index + 1}` : runId,
      run_id: runId,
    }));
  }

  function entryPayloadFromForm(prefix = 'diary-entry') {
    return entryPayloadsFromForm(prefix)[0] || {};
  }

  async function submitEntry(prefix = 'diary-entry') {
    const status = el(prefix === 'diary-entry' ? 'diary-entry-status' : `${prefix}-status`);
    const payloads = entryPayloadsFromForm(prefix);
    const firstPayload = payloads[0];
    if (!firstPayload?.body) {
      if (status) status.textContent = 'Entry body is required.';
      return false;
    }
    if (!payloads.length) {
      if (status) status.textContent = 'Entry date is required.';
      return false;
    }
    if (status) status.textContent = payloads.length > 1 ? `Saving ${payloads.length} entries...` : 'Saving entry...';
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const saved = [];
    for (const payload of payloads) {
      const resp = await fetcher('/api/v1/personal/diary-day/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        if (status) status.textContent = `${payload.local_date}: ${responseErrorMessage(data, resp.status)}`;
        return false;
      }
      saved.push(data);
    }
    ['title', 'body', 'start', 'end'].forEach(key => {
      const field = el(`${prefix}-${key}`);
      if (field) field.value = '';
    });
    const endDate = el(`${prefix}-end-date`);
    if (endDate) endDate.value = el(`${prefix}-date`)?.value || entryDefaultDate();
    if (status) {
      status.textContent = saved.length > 1
        ? `Saved ${saved.length} entries`
        : `Saved ${saved[0]?.write?.file_ref || ''}`;
    }
    state.entryDraftRange = null;
    state.lastWrite = saved[saved.length - 1];
    state.date = saved[0]?.event?.local_date || firstPayload.local_date || state.date;
    state.loaded = false;
    state.daySummary = saved[saved.length - 1]?.day || null;
    await load({ force: true });
    return true;
  }

  function prepareEntryForm(prefix, range = null) {
    window.setTimeout(() => {
      const date = el(`${prefix}-date`);
      const endDate = el(`${prefix}-end-date`);
      const time = el(`${prefix}-start`);
      const end = el(`${prefix}-end`);
      const allDay = el(`${prefix}-all-day`);
      if (range) {
        if (date) date.value = range.startDate || state.date;
        if (endDate) endDate.value = range.endDate || date?.value || state.date;
        if (time) time.value = '';
        if (end) end.value = '';
        if (allDay) allDay.checked = true;
      }
      setAllDayControls(prefix);
      el(`${prefix}-title`)?.focus();
    }, 0);
  }

  function openNewEntry(options = {}) {
    if (state.selectedEntryId || state.selection) clearSelectedEntry({ moveEditToNew: false });
    if (!options.keepEntryDraft) state.entryDraftRange = null;
    closeContentViewMenu();
    const openedInline = activateInlineDiaryTab('new-entry');
    if (openedInline) {
      ['diary-inline-entry', 'diary-sidecar-entry', 'diary-panel-entry'].forEach(prefix => {
        if (el(`${prefix}-date`)) prepareEntryForm(prefix, state.entryDraftRange);
      });
      return true;
    }
    const shown = openContentViewModal('new-entry', { keepEntryDraft: options.keepEntryDraft });
    if (shown) prepareEntryForm('diary-modal-entry', state.entryDraftRange);
    return shown;
  }

  function openNewEntryForHour(hour) {
    const range = hourEntryRange(hour);
    state.entryDraftRange = range;
    return openNewEntry({ keepEntryDraft: true });
  }

  function openEditEntryForSelected() {
    if (!editEntryAvailable()) return false;
    closeContentViewMenu();
    const openedInline = activateInlineDiaryTab('edit-entry');
    if (openedInline) {
      ['diary-inline-edit-entry', 'diary-sidecar-edit-entry', 'diary-panel-edit-entry'].forEach(prefix => {
        if (el(`${prefix}-date`)) {
          renderEntryTagSummaries();
          setAllDayControls(prefix);
          window.setTimeout(() => el(`${prefix}-title`)?.focus(), 0);
        }
      });
      return true;
    }
    return openContentViewModal('edit-entry');
  }

  function editPayloadFromForm(prefix = 'diary-edit-entry') {
    const title = String(el(`${prefix}-title`)?.value || '').trim();
    const body = String(el(`${prefix}-body`)?.value || '').trim();
    const text = [title, body].filter(Boolean).join('\n\n');
    const allDay = !!el(`${prefix}-all-day`)?.checked;
    const startDate = String(el(`${prefix}-date`)?.value || state.date).trim();
    const endDate = String(el(`${prefix}-end-date`)?.value || startDate || state.date).trim();
    const runId = `ui-diary-entry-edit-${Date.now()}`;
    return {
      body: text,
      local_date: startDate,
      range_start_date: startDate,
      range_end_date: endDate,
      local_time: allDay ? null : String(el(`${prefix}-start`)?.value || '').trim() || null,
      end_time: allDay ? null : String(el(`${prefix}-end`)?.value || '').trim() || null,
      all_day: allDay,
      actor: 'blueprints-ui',
      source_surface: 'diary-page',
      request_id: runId,
      run_id: runId,
      tags: editEntryTagIds(),
    };
  }

  function calendarEditPayloadFromEntryForm(prefix = 'diary-edit-entry') {
    const allDay = !!el(`${prefix}-all-day`)?.checked;
    const startDate = String(el(`${prefix}-date`)?.value || state.date).trim();
    const runId = `ui-diary-calendar-entry-edit-${Date.now()}`;
    return {
      title: String(el(`${prefix}-title`)?.value || '').trim(),
      body: String(el(`${prefix}-body`)?.value || '').trim(),
      local_date: startDate,
      start_time: allDay ? null : String(el(`${prefix}-start`)?.value || '').trim() || null,
      end_time: allDay ? null : String(el(`${prefix}-end`)?.value || '').trim() || null,
      all_day: allDay,
      actor: 'blueprints-ui',
      source_surface: 'diary-page',
      request_id: runId,
      run_id: runId,
      tags: editEntryTagIds(),
    };
  }

  async function submitEditEntry(prefix = 'diary-edit-entry') {
    const status = el(`${prefix}-status`);
    const event = selectedEntry();
    const editability = entryEditability(event);
    if (!event?.event_id) {
      if (status) status.textContent = 'Select an entry first.';
      clearSelectedEntry();
      return false;
    }
    if (!editability.editable) {
      if (status) status.textContent = editability.reason;
      return false;
    }
    const payload = editability.route === 'calendar'
      ? calendarEditPayloadFromEntryForm(prefix)
      : editPayloadFromForm(prefix);
    if (editability.route === 'calendar' && !payload.title) {
      if (status) status.textContent = 'Entry title is required.';
      return false;
    }
    if (editability.route !== 'calendar' && !payload.body) {
      if (status) status.textContent = 'Entry body is required.';
      return false;
    }
    if (status) status.textContent = 'Saving entry...';
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const route = editability.route === 'calendar'
      ? `/api/v1/personal/calendar/events/${encodeURIComponent(event.event_id)}`
      : `/api/v1/personal/diary-day/entries/${encodeURIComponent(event.event_id)}`;
    const resp = await fetcher(route, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      if (status) status.textContent = responseErrorMessage(data, resp.status);
      return false;
    }
    if (status) status.textContent = 'Saved entry.';
    state.lastWrite = data;
    state.date = data.event?.local_date || payload.local_date || state.date;
    state.selectedEntryId = data.event?.event_id || event.event_id;
    state.loaded = false;
    state.daySummary = data.day || null;
    await load({ force: true });
    return true;
  }

  async function deleteSelectedEntry(prefix = 'diary-edit-entry') {
    const status = el(`${prefix}-status`);
    const event = selectedEntry();
    const editability = entryEditability(event);
    if (!event?.event_id) {
      if (status) status.textContent = 'Select an entry first.';
      clearSelectedEntry();
      return false;
    }
    if (!editability.editable) {
      if (status) status.textContent = editability.reason;
      return false;
    }
    const label = editability.route === 'calendar' ? 'Calendar Entry' : 'Diary Entry';
    const confirmed = await HubDialogs.confirmDelete({
      title: `Delete ${label}`,
      message: `Delete "${event.title || event.event_id}"?`,
      detail: 'This removes the manually owned entry from shared personal events.',
      confirmText: 'Delete Entry',
    });
    if (!confirmed) return false;
    if (status) status.textContent = 'Deleting entry...';
    const route = editability.route === 'calendar'
      ? `/api/v1/personal/calendar/events/${encodeURIComponent(event.event_id)}`
      : `/api/v1/personal/diary-day/entries/${encodeURIComponent(event.event_id)}`;
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const resp = await fetcher(route, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actor: 'blueprints-ui',
        source_surface: 'diary-page',
        request_id: `ui-diary-delete-${Date.now()}`,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      if (status) status.textContent = responseErrorMessage(data, resp.status);
      return false;
    }
    if (status) status.textContent = 'Deleted entry.';
    state.lastWrite = data;
    state.date = data.deleted_event?.local_date || event.local_date || state.date;
    state.loaded = false;
    state.daySummary = data.day || null;
    clearSelectedEntry();
    await load({ force: true });
    return true;
  }

  function toggleHourGap(key) {
    if (!key) return;
    if (state.expandedGaps.has(key)) state.expandedGaps.delete(key);
    else state.expandedGaps.add(key);
    render();
  }

  function openFilterModal(tab = 'filters') {
    const cleanTab = tab === 'settings' || tab === 'filter-settings' ? 'settings' : 'filters';
    closeContentViewMenu();
    if (window.PersonalFilters?.openModal) return window.PersonalFilters.openModal('diary', cleanTab);
    return setContentView(cleanTab === 'settings' ? 'filter-settings' : 'filters');
  }

  function setContentView(view) {
    const previous = state.contentView;
    state.contentView = normalizeInlineContentView(view);
    if (state.contentView === 'filter-settings' && previous !== state.contentView) {
      window.PersonalFilters?.resetSettingsOrder?.('diary');
    }
    writeStoredValue(CONTENT_VIEW_STORAGE_KEY, state.contentView);
    closeContentViewMenu();
    render();
    return state.contentView;
  }

  function cycleContentView() {
    const current = Math.max(0, INLINE_CONTENT_VIEW_IDS.indexOf(state.contentView));
    return setContentView(INLINE_CONTENT_VIEW_IDS[(current + 1) % INLINE_CONTENT_VIEW_IDS.length]);
  }

  function resetContentViewAndRefresh() {
    state.contentView = 'diary';
    writeStoredValue(CONTENT_VIEW_STORAGE_KEY, state.contentView);
    closeContentViewMenu();
    return load({ force: true });
  }

  function viewportHeight() {
    if (window.visualViewport && Number.isFinite(window.visualViewport.height) && window.visualViewport.height > 0) {
      return window.visualViewport.height;
    }
    return window.innerHeight || document.documentElement.clientHeight || 0;
  }

  function fallbackFitDropdownMenu(menu) {
    if (!menu) return;
    menu.classList.remove('hub-dropdown-menu--clipped');
    menu.style.removeProperty('max-height');
    menu.style.removeProperty('overflow-y');
    menu.style.removeProperty('overflow-x');
    const height = viewportHeight();
    if (!height) return;
    const rect = menu.getBoundingClientRect();
    const available = Math.floor(height - rect.top - 8);
    const contentBottom = rect.top + Math.max(rect.height, menu.scrollHeight || 0);
    if (contentBottom <= height - 8 || available <= 0) return;
    menu.classList.add('hub-dropdown-menu--clipped');
    menu.style.maxHeight = Math.max(120, available) + 'px';
    menu.style.overflowY = 'auto';
    menu.style.overflowX = 'hidden';
  }

  function fitContentViewMenu(menu) {
    if (typeof DaveMenuConfig !== 'undefined' && typeof DaveMenuConfig._fitDropdownMenu === 'function') {
      DaveMenuConfig._fitDropdownMenu(menu);
      return;
    }
    fallbackFitDropdownMenu(menu);
  }

  function positionContentViewMenu(anchor, host, menu) {
    if (!anchor || !host || !menu) return;
    const anchorRect = anchor.getBoundingClientRect();
    const viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
    const top = Math.max(8, Math.round(anchorRect.bottom + 6));
    host.style.left = '8px';
    host.style.top = top + 'px';
    const menuRect = menu.getBoundingClientRect();
    if (viewportW > 0 && menuRect.width > 0) {
      const desiredLeft = Math.round(anchorRect.left + (anchorRect.width / 2) - (menuRect.width / 2));
      const maxLeft = Math.max(8, Math.floor(viewportW - menuRect.width - 8));
      host.style.left = Math.min(Math.max(8, desiredLeft), maxLeft) + 'px';
    }
    fitContentViewMenu(menu);
  }

  function closeContentViewMenu() {
    if (contentViewMenuPointerHandler) {
      document.removeEventListener('pointerdown', contentViewMenuPointerHandler, true);
      contentViewMenuPointerHandler = null;
    }
    if (contentViewMenuKeyHandler) {
      document.removeEventListener('keydown', contentViewMenuKeyHandler, true);
      contentViewMenuKeyHandler = null;
    }
    if (contentViewMenuFitHandler) {
      window.removeEventListener('resize', contentViewMenuFitHandler);
      window.removeEventListener('orientationchange', contentViewMenuFitHandler);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', contentViewMenuFitHandler);
        window.visualViewport.removeEventListener('scroll', contentViewMenuFitHandler);
      }
      contentViewMenuFitHandler = null;
    }
    if (contentViewMenuHost && contentViewMenuHost.parentNode) {
      contentViewMenuHost.parentNode.removeChild(contentViewMenuHost);
    }
    contentViewMenuHost = null;
    renderContentViewTrigger();
  }

  function openContentViewMenu(anchor) {
    if (!anchor || typeof anchor.getBoundingClientRect !== 'function') return false;
    closeContentViewMenu();
    const host = document.createElement('div');
    host.className = 'hub-tab-dropdown open calendar-view-menu diary-view-menu';
    host.dataset.diaryViewMenu = '1';
    const menu = document.createElement('div');
    menu.className = 'hub-dropdown-menu calendar-view-menu__menu diary-view-menu__menu';
    CONTENT_VIEWS.forEach(view => {
      const btn = document.createElement('button');
      btn.className = 'hub-dropdown-item';
      btn.type = 'button';
      btn.dataset.diaryContentTarget = view.id;
      btn.setAttribute('aria-current', view.id === state.contentView ? 'true' : 'false');
      btn.textContent = view.label;
      btn.addEventListener('click', event => {
        event.stopPropagation();
        openContentViewModal(view.id);
      });
      menu.appendChild(btn);
    });
    host.appendChild(menu);
    document.body.appendChild(host);
    contentViewMenuHost = host;
    positionContentViewMenu(anchor, host, menu);
    contentViewMenuFitHandler = () => positionContentViewMenu(anchor, host, menu);
    window.addEventListener('resize', contentViewMenuFitHandler, { passive: true });
    window.addEventListener('orientationchange', contentViewMenuFitHandler, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', contentViewMenuFitHandler, { passive: true });
      window.visualViewport.addEventListener('scroll', contentViewMenuFitHandler, { passive: true });
    }
    contentViewMenuPointerHandler = event => {
      if (!contentViewMenuHost) return;
      if (contentViewMenuHost.contains(event.target)) return;
      if (event.target.closest && event.target.closest('[data-diary-view-trigger]')) return;
      closeContentViewMenu();
    };
    contentViewMenuKeyHandler = event => {
      if (event.key === 'Escape') closeContentViewMenu();
    };
    window.setTimeout(() => {
      if (!contentViewMenuHost) return;
      document.addEventListener('pointerdown', contentViewMenuPointerHandler, true);
      document.addEventListener('keydown', contentViewMenuKeyHandler, true);
    }, 0);
    renderContentViewTrigger();
    return true;
  }

  const DiaryContentViewMachine = (() => {
    let machineState = 'IDLE';
    const transitions = {
      IDLE: {
        tap: { next: 'IDLE', actions: ['cycleView'] },
        doubleTap: { next: 'MENU_OPEN', actions: ['openMenu'] },
        longPress: { next: 'IDLE', actions: ['resetRefresh'] },
      },
      MENU_OPEN: {
        tap: { next: 'IDLE', actions: ['closeMenu'] },
        doubleTap: { next: 'IDLE', actions: ['closeMenu'] },
        longPress: { next: 'IDLE', actions: ['closeMenu', 'resetRefresh'] },
      },
    };

    function syncState() {
      machineState = contentViewMenuHost ? 'MENU_OPEN' : 'IDLE';
    }

    function runAction(action, anchor) {
      if (action === 'cycleView') cycleContentView();
      if (action === 'openMenu') openContentViewMenu(anchor);
      if (action === 'closeMenu') closeContentViewMenu();
      if (action === 'resetRefresh') resetContentViewAndRefresh();
    }

    return {
      dispatch(input, anchor) {
        syncState();
        const transition = transitions[machineState]?.[input];
        if (!transition) return machineState;
        machineState = transition.next;
        transition.actions.forEach(action => runAction(action, anchor));
        syncState();
        return machineState;
      },
    };
  })();

  function bindContentViewTrigger(btn) {
    if (!btn || btn.dataset.diaryViewTriggerBound === '1') return;
    btn.dataset.diaryViewTriggerBound = '1';
    const doubleMs = 280;
    const longPressMs = 560;
    const moveTolerance = 12;
    let pendingTapTimer = null;
    let lastTapAt = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    let longPressTimer = null;
    let longPressStartX = 0;
    let longPressStartY = 0;
    let longPressFired = false;
    let ignoreClicksUntil = 0;
    let lastDoubleAt = 0;

    function clearPendingTap() {
      if (!pendingTapTimer) return;
      clearTimeout(pendingTapTimer);
      pendingTapTimer = null;
    }

    function clearLongPress() {
      if (!longPressTimer) return;
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }

    function dispatch(input) {
      DiaryContentViewMachine.dispatch(input, btn);
    }

    btn.addEventListener('pointerdown', event => {
      if (event.button !== undefined && event.button !== 0) return;
      longPressFired = false;
      longPressStartX = event.clientX;
      longPressStartY = event.clientY;
      clearLongPress();
      longPressTimer = window.setTimeout(() => {
        longPressTimer = null;
        longPressFired = true;
        ignoreClicksUntil = Date.now() + 700;
        clearPendingTap();
        dispatch('longPress');
      }, longPressMs);
    });

    btn.addEventListener('pointermove', event => {
      if (!longPressTimer) return;
      const dx = event.clientX - longPressStartX;
      const dy = event.clientY - longPressStartY;
      if (Math.sqrt(dx * dx + dy * dy) > moveTolerance) clearLongPress();
    });

    ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => {
      btn.addEventListener(type, clearLongPress);
    });

    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const now = Date.now();
      if (longPressFired || now < ignoreClicksUntil) {
        longPressFired = false;
        return;
      }
      const dx = event.clientX - lastTapX;
      const dy = event.clientY - lastTapY;
      const moved = Math.sqrt(dx * dx + dy * dy);
      const isDouble = event.detail >= 2 || (lastTapAt && (now - lastTapAt) <= doubleMs && moved <= 24);
      if (isDouble) {
        clearPendingTap();
        lastTapAt = 0;
        lastDoubleAt = now;
        dispatch('doubleTap');
        return;
      }
      lastTapAt = now;
      lastTapX = event.clientX;
      lastTapY = event.clientY;
      clearPendingTap();
      pendingTapTimer = window.setTimeout(() => {
        pendingTapTimer = null;
        lastTapAt = 0;
        dispatch('tap');
      }, doubleMs);
    });

    btn.addEventListener('dblclick', event => {
      event.preventDefault();
      event.stopPropagation();
      clearPendingTap();
      const now = Date.now();
      if (now - lastDoubleAt < 80) return;
      lastDoubleAt = now;
      dispatch('doubleTap');
    });
  }

  function bind() {
    const root = document.querySelector('[data-diary-page]');
    if (!root || root.dataset.diaryBound === '1') return;
    root.dataset.diaryBound = '1';
    if (window.PersonalFilters?.registerSurface) {
      window.PersonalFilters.registerSurface('diary', {
        getRecords: () => state.data?.items || [],
        extraTabs: [
          { id: 'selected', label: 'Selected' },
          { id: 'day', label: 'Day' },
          { id: 'search', label: 'Search' },
          { id: 'new-entry', label: 'New Entry' },
          { id: 'edit-entry', label: 'Edit Entry', disabled: () => !editEntryAvailable() },
          { id: 'upcoming', label: 'Upcoming' },
          { id: 'provenance', label: 'Provenance' },
        ],
        renderTab: (tab, host) => {
          if (tab === 'selected') return embeddedSelectedHtml(host);
          if (tab === 'day') return embeddedDayHtml(host);
          if (tab === 'search') return embeddedSearchHtml(host);
          if (tab === 'new-entry') return embeddedEntryFormHtml(embeddedEntryPrefixForHost(host));
          if (tab === 'edit-entry') return embeddedEntryFormHtml(embeddedEditPrefixForHost(host), { mode: 'edit' });
          if (tab === 'upcoming') return embeddedUpcomingHtml(host);
          if (tab === 'provenance') return embeddedProvenanceHtml(host);
          return '';
        },
        onChange: () => {
          syncSharedFilterState();
          clearSelectedEntry();
          render();
        },
      });
      window.PersonalFilters.registerSurface(ENTRY_TAG_SURFACE, {
        getRecords: () => state.data?.items || [],
        defaultSelectedIds: ENTRY_REQUIRED_TAGS,
        requiredSelectedIds: ENTRY_REQUIRED_TAGS,
        summaryPrefix: 'Tags:',
        activePrefix: 'Selected',
        emptyLabel: 'Diary',
        showClear: false,
        onChange: () => {
          renderEntryTagSummaries();
        },
      });
      window.PersonalFilters.registerSurface(EDIT_TAG_SURFACE, {
        getRecords: () => state.data?.items || [],
        defaultSelectedIds: ENTRY_REQUIRED_TAGS,
        requiredSelectedIds: ENTRY_REQUIRED_TAGS,
        summaryPrefix: 'Tags:',
        activePrefix: 'Selected',
        emptyLabel: 'Diary',
        showClear: false,
        onChange: () => {
          renderEntryTagSummaries();
        },
      });
      window.PersonalFilters.registerSurface(SEARCH_TAG_SURFACE, {
        getRecords: () => state.data?.items || [],
        summaryPrefix: 'Filter:',
        activePrefix: 'Filter',
        emptyLabel: 'all entries',
        clearLabel: 'All entries',
      });
    }
    if (window.BlueprintsPersonalSearch?.registerSurface) {
      window.BlueprintsPersonalSearch.registerSurface('diary', {
        filterSurface: SEARCH_TAG_SURFACE,
        rangeControls: true,
        getRange: searchDefaultRange,
      });
    }
    syncEntryDate(true);
    renderEntryTagSummaries();
    root.addEventListener('pointerdown', beginEntryLongPress);
    root.addEventListener('pointermove', moveEntryLongPress);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => {
      root.addEventListener(type, clearEntryLongPress);
    });
    root.addEventListener('pointerup', event => {
      const entryBtn = event.target.closest('[data-diary-action="select-entry"][data-diary-entry-id]');
      if (entryBtn) markEntryTapCandidate(entryBtn, event);
      const btn = event.target.closest('[data-diary-action="select-week-day"][data-diary-date]');
      if (!btn) return;
      handleWeekDayDoubleTap(btn.dataset.diaryDate, event);
    });
    root.addEventListener('click', event => {
      const todoLink = event.target.closest('[data-personal-todo-link]');
      if (todoLink) {
        event.preventDefault();
        event.stopPropagation();
        openTodoLink(todoLink.dataset.personalTodoLink);
        return;
      }
      const selectable = event.target.closest('[data-diary-select-type]');
      if (selectable) {
        if (handleSelectableEntryActivation(selectable, event)) return;
        setSelection(selectable.dataset.diarySelectType, selectable.dataset.diarySelectIndex);
      }
      const btn = event.target.closest('[data-diary-action]');
      if (!btn) return;
      const action = btn.dataset.diaryAction;
      if (action === 'previous') previous();
      if (action === 'today') today();
      if (action === 'next') next();
      if (action === 'refresh') load({ force: true });
      if (action === 'generate-summary') generateSummary();
      if (action === 'go-calendar-year') goCalendar('year');
      if (action === 'go-calendar-month') goCalendar('month');
      if (action === 'view-week') setView('week');
      if (action === 'view-day') setView('day');
      if (action === 'select-week-day') {
        if (shouldSuppressWeekDayInteraction(event)) return;
        if (event.detail >= 2) {
          lastWeekDayClick = null;
          if (openPendingEntryTapAsEdit(event)) {
            suppressWeekDayInteractions(700);
            return;
          }
          setView('day', btn.dataset.diaryDate);
          return;
        }
        if (handleWeekDayClickDoubleTap(btn.dataset.diaryDate, event)) return;
        selectWeekDay(btn.dataset.diaryDate, event.detail >= 2);
      }
      if (action === 'toggle-hour-gap') toggleHourGap(btn.dataset.diaryGap);
      if (action === 'new-entry-at-hour') openNewEntryForHour(btn.dataset.diaryHour);
      if (action === 'show-new-entry') openNewEntry();
      if (action === 'select-entry') {
        const row = findEventById(btn.dataset.diaryEntryId);
        if (row) handleEntryActivation(row, event);
      }
      if (action === 'toggle-markdown-preview') toggleMarkdownPreview(btn, root);
      if (action === 'submit-entry') submitEntry(btn.dataset.diaryEntryPrefix || 'diary-entry');
      if (action === 'submit-edit-entry') submitEditEntry(btn.dataset.diaryEntryPrefix || 'diary-edit-entry');
      if (action === 'delete-entry') deleteSelectedEntry(btn.dataset.diaryEntryPrefix || 'diary-edit-entry');
    });
    root.addEventListener('dblclick', event => {
      const entryBtn = event.target.closest('[data-diary-action="select-entry"][data-diary-entry-id]');
      if (entryBtn && handleEntryDoubleClick(entryBtn, event)) return;
      const btn = event.target.closest('[data-diary-action="select-week-day"][data-diary-date]');
      if (!btn) return;
      if (shouldSuppressWeekDayInteraction(event)) return;
      event.preventDefault();
      if (openPendingEntryTapAsEdit(event)) return;
      setView('day', btn.dataset.diaryDate);
    });
	    document.addEventListener('click', event => {
	      const btn = event.target.closest('[data-diary-action="submit-entry"]');
	      if (!btn || root.contains(btn)) return;
	      event.preventDefault();
	      submitEntry(btn.dataset.diaryEntryPrefix || 'diary-entry');
	    });
	    document.addEventListener('click', event => {
	      const btn = event.target.closest('[data-diary-action="toggle-markdown-preview"]');
	      if (!btn || root.contains(btn)) return;
	      event.preventDefault();
		      toggleMarkdownPreview(btn, document);
	    });
	    document.addEventListener('click', event => {
	      const btn = event.target.closest('[data-diary-action="submit-edit-entry"]');
	      if (!btn || root.contains(btn)) return;
      event.preventDefault();
      submitEditEntry(btn.dataset.diaryEntryPrefix || 'diary-edit-entry');
    });
	    document.addEventListener('click', event => {
	      const btn = event.target.closest('[data-diary-action="delete-entry"]');
	      if (!btn || root.contains(btn)) return;
      event.preventDefault();
      deleteSelectedEntry(btn.dataset.diaryEntryPrefix || 'diary-edit-entry');
    });
    document.addEventListener('change', event => {
      const upcomingControl = event.target.closest('[data-diary-upcoming-next-years]');
      if (upcomingControl) {
        setUpcomingWide(upcomingControl.checked);
        return;
      }
      const control = event.target.closest('[data-diary-entry-all-day]');
      if (!control) return;
      setAllDayControls(control.dataset.diaryEntryAllDay || 'diary-entry');
    });
    root.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const selectable = event.target.closest('[data-diary-select-type]');
      if (!selectable) return;
      event.preventDefault();
      setSelection(selectable.dataset.diarySelectType, selectable.dataset.diarySelectIndex);
    });
    const dateInput = el('diary-date-input');
    if (dateInput) {
      dateInput.value = state.date;
      dateInput.addEventListener('change', event => {
        if (event.target.value) setDate(event.target.value);
      });
    }
    const entryDate = el('diary-entry-date');
    if (entryDate) entryDate.value = entryDefaultDate();
    const entryEndDate = el('diary-entry-end-date');
    if (entryEndDate) entryEndDate.value = entryDefaultEndDate();
    const allDay = el('diary-entry-all-day');
    if (allDay) {
      allDay.addEventListener('change', () => setAllDayControls('diary-entry'));
      setAllDayControls('diary-entry');
    }
    document.querySelectorAll('[data-diary-view-trigger]').forEach(bindContentViewTrigger);
	    ['diary-action-modal-close', 'diary-action-modal-footer-close'].forEach(id => {
	      const btn = el(id);
	      if (btn) btn.addEventListener('click', closeActionModal);
	    });
	    const modalTools = el('diary-action-modal-tools');
	    if (modalTools) {
	      modalTools.addEventListener('click', event => {
	        const btn = event.target.closest('[data-diary-modal-action]');
	        if (!btn) return;
	        event.preventDefault();
	        event.stopPropagation();
	        if (btn.dataset.diaryModalAction === 'edit-entry-content') openSelectedEntryContentEditor();
	      });
	    }
	    const modalBody = el('diary-action-modal-body');
	    if (modalBody) {
	      modalBody.addEventListener('click', event => {
	        const todoLink = event.target.closest('[data-personal-todo-link]');
	        if (todoLink) {
	          event.preventDefault();
	          event.stopPropagation();
	          openTodoLink(todoLink.dataset.personalTodoLink);
	          return;
	        }
	        const markdownBtn = event.target.closest('[data-diary-action="toggle-markdown-preview"]');
	        if (markdownBtn) {
	          event.preventDefault();
	          event.stopPropagation();
		          toggleMarkdownPreview(markdownBtn, modalBody);
	          return;
	        }
	        const summaryBtn = event.target.closest('[data-diary-action="generate-summary"]');
	        if (summaryBtn) {
	          generateSummary();
          return;
        }
	        const btn = event.target.closest('[data-diary-modal-action]');
	        if (!btn) return;
		        if (btn.dataset.diaryModalAction === 'submit-kanban-link') submitKanbanLink();
		        if (btn.dataset.diaryModalAction === 'edit-entry-content') openSelectedEntryContentEditor();
		        if (btn.dataset.diaryModalAction === 'toggle-entry-content-preview') toggleEntryContentPreview(btn);
		        if (btn.dataset.diaryModalAction === 'save-entry-content') saveSelectedEntryContent();
	      });
      modalBody.addEventListener('change', event => {
        const control = event.target.closest('[data-diary-entry-all-day]');
        if (!control) return;
        setAllDayControls(control.dataset.diaryEntryAllDay || 'diary-entry');
      });
    }
  }

  function snapshot() {
    return {
      loaded: state.loaded,
      loading: state.loading,
      view: state.view,
      content_view: state.contentView,
      local_date: state.date,
      range_start: rangeStart(),
      range_end: rangeEnd(),
      range_label: rangeLabel(),
      visible_count: visibleEvents().length,
      source_filter: state.sourceFilter,
      status: automationStatus(),
      summary_state: state.daySummary?.summary?.state || '',
      ledger_exists: !!state.daySummary?.files?.source_ledger?.exists,
      day_folder_exists: !!state.daySummary?.files?.day_folder?.exists,
      selection_type: state.selection?.type || '',
      selection_label: state.selection?.label || '',
      last_write_file_ref: state.lastWrite?.write?.file_ref || '',
      error: state.error,
    };
  }

  bind();

  return {
    load,
    refresh: () => load({ force: true }),
    setDate,
    openWeek: dateText => setDate(dateText, { view: 'week' }),
    openDay: dateText => setDate(dateText, { view: 'day' }),
    previous,
    next,
    previousDay: previous,
    nextDay: next,
    today,
    viewWeek: () => setView('week'),
    viewDay: () => setView('day'),
    goCalendarYear: () => goCalendar('year'),
    goCalendarMonth: () => goCalendar('month'),
    toggleContentView: cycleContentView,
    showFilters: () => openFilterModal('filters'),
    showFilterSettings: () => openFilterModal('settings'),
    showSelected: () => openContentViewModal('selected'),
    showDay: () => openContentViewModal('day'),
    showSearch: () => openContentViewModal('search'),
    newEntry: () => openNewEntry(),
    editEntry: () => openEditEntryForSelected(),
    showUpcoming: () => openContentViewModal('upcoming'),
    showProvenance: () => openContentViewModal('provenance'),
    submitEntry,
    openDayFolder: showDayFolder,
    openSourceLedger: showSourceLedger,
    openSource,
    filterAll: () => {
      if (window.PersonalFilters?.setSelectedIds) window.PersonalFilters.setSelectedIds('diary', []);
      state.sourceFilter = 'all';
      render();
    },
    filterManual: () => {
      if (window.PersonalFilters?.setSelectedIds) window.PersonalFilters.setSelectedIds('diary', ['manual']);
      state.sourceFilter = 'custom';
      render();
    },
    filterSources: () => {
      if (window.PersonalFilters?.setSelectedIds) window.PersonalFilters.setSelectedIds('diary', ['sources']);
      state.sourceFilter = 'custom';
      render();
    },
    filterGit: () => {
      if (window.PersonalFilters?.setSelectedIds) window.PersonalFilters.setSelectedIds('diary', ['git']);
      state.sourceFilter = 'custom';
      render();
    },
    filterImports: () => {
      if (window.PersonalFilters?.setSelectedIds) window.PersonalFilters.setSelectedIds('diary', ['imports']);
      state.sourceFilter = 'custom';
      render();
    },
    showPinPrivate: () => showActionModal('Pin-Private Items', kvHtml([
      ['Hidden count', state.daySummary?.pin_hidden_count || 0],
      ['Date', daySummaryTargetDate()],
      ['Privacy state', state.daySummary?.pin_hidden_count ? 'hidden by v1 privacy filter' : 'none hidden'],
    ])),
    linkKanbanItem,
    generateSummary,
    explainSelection,
    safeChecks,
    snapshot,
  };
})();

window.BlueprintsDiaryPage = DiaryPage;

if (typeof DaveMenuConfig !== 'undefined') {
  DaveMenuConfig.registerFunctions({
    'diary.refresh': () => DiaryPage.refresh(),
    'diary.previous': () => DiaryPage.previous(),
    'diary.next': () => DiaryPage.next(),
    'diary.previousDay': () => DiaryPage.previousDay(),
    'diary.nextDay': () => DiaryPage.nextDay(),
    'diary.today': () => DiaryPage.today(),
    'diary.toggleContentView': () => DiaryPage.toggleContentView(),
    'diary.showFilters': () => DiaryPage.showFilters(),
    'diary.showFilterSettings': () => DiaryPage.showFilterSettings(),
    'diary.showSelected': () => DiaryPage.showSelected(),
    'diary.showDay': () => DiaryPage.showDay(),
    'diary.showSearch': () => DiaryPage.showSearch(),
    'diary.newEntry': () => DiaryPage.newEntry(),
    'diary.editEntry': () => DiaryPage.editEntry(),
    'diary.showUpcoming': () => DiaryPage.showUpcoming(),
    'diary.showProvenance': () => DiaryPage.showProvenance(),
    'diary.viewWeek': () => DiaryPage.viewWeek(),
    'diary.viewDay': () => DiaryPage.viewDay(),
    'diary.goCalendarYear': () => DiaryPage.goCalendarYear(),
    'diary.goCalendarMonth': () => DiaryPage.goCalendarMonth(),
    'diary.openDayFolder': () => DiaryPage.openDayFolder(),
    'diary.openSourceLedger': () => DiaryPage.openSourceLedger(),
    'diary.openSource': () => DiaryPage.openSource(),
    'diary.filterAll': () => DiaryPage.filterAll(),
    'diary.filterManual': () => DiaryPage.filterManual(),
    'diary.filterSources': () => DiaryPage.filterSources(),
    'diary.filterGit': () => DiaryPage.filterGit(),
    'diary.filterImports': () => DiaryPage.filterImports(),
    'diary.showPinPrivate': () => DiaryPage.showPinPrivate(),
    'diary.linkKanbanItem': () => DiaryPage.linkKanbanItem(),
    'diary.generateSummary': () => DiaryPage.generateSummary(),
    'diary.explainSelection': () => DiaryPage.explainSelection(),
    'diary.safeChecks': () => DiaryPage.safeChecks(),
  });
}
