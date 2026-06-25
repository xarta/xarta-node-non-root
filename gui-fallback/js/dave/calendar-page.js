// Dave Calendar page - year/month calendar over shared personal_events.

'use strict';

const CalendarPage = (() => {
  const YEAR_START_STORAGE_KEY = 'blueprints.calendar.yearStartMonth';
  const VIEW_STORAGE_KEY = 'blueprints.calendar.view';
  const CONTENT_VIEW_STORAGE_KEY = 'blueprints.calendar.contentView';
  const EVENT_TAG_SURFACE = 'calendar-event';
  const EVENT_REQUIRED_TAGS = ['calendar'];
  const SEARCH_TAG_SURFACE = 'calendar-search';
  const UPCOMING_WIDE_BATCH_SIZE = 200;
  const UPCOMING_WIDE_MAX_EVENTS = 2000;
  const UPCOMING_WIDE_YEARS = 10;
  const MONTH_NAMES = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const CONTENT_VIEWS = [
    { id: 'calendar', label: 'Year / Month Calendar' },
    { id: 'filters', label: 'Filters' },
    { id: 'filter-settings', label: 'Filter Settings' },
    { id: 'selected', label: 'Selected Range Visible Items' },
    { id: 'milestones', label: 'All-Day And Milestones' },
    { id: 'search', label: 'Search And Review' },
    { id: 'new-event', label: 'New Calendar Event' },
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'provenance', label: 'Provenance' },
  ];
  const CONTENT_VIEW_IDS = CONTENT_VIEWS.map(view => view.id);
  const INLINE_CONTENT_VIEW_IDS = ['calendar', 'filters', 'filter-settings'];
  const MODAL_CONTENT_VIEW_IDS = ['selected', 'milestones', 'search', 'new-event', 'upcoming', 'provenance'];
  const DAY_DOUBLE_TAP_MS = 280;
  const DAY_DOUBLE_TAP_PX = 24;
  const DAY_LONG_PRESS_MS = 560;
  const DAY_MOVE_TOLERANCE_PX = 12;
  const MONTH_EVENT_TITLE_LIMIT = 22;
  const MONTH_DESKTOP_EVENT_LIMIT = 3;
  const MONTH_MOBILE_MARKER_SLOTS = 4;
  const MONTH_MARKER_GENERIC_TOKENS = new Set([
    'calendar',
    'calendar-event',
    'all-day',
    'timed',
    'tasks',
    'task',
    'kanban',
    'imports',
    'import',
    'sources',
    'source',
  ]);

  const state = {
    loaded: false,
    loading: false,
    loadRequestId: 0,
    loadedRangeStart: '',
    loadedRangeEnd: '',
    data: null,
    error: '',
    date: localDateString(new Date()),
    view: readStoredView(),
    contentView: readStoredContentView(),
    mode: 'day',
    manualRangeStart: null,
    manualRangeEnd: null,
    yearStartMonth: readStoredYearStartMonth(),
    sourceFilter: 'all',
    selection: null,
    lastWrite: null,
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
  };

  let contentViewMenuHost = null;
  let contentViewMenuPointerHandler = null;
  let contentViewMenuKeyHandler = null;
  let contentViewMenuFitHandler = null;
  let dateRangeDrag = null;
  let suppressSelectDayClick = false;
  let suppressSelectDayClickUntil = 0;
  let pendingEventTapTimer = null;
  let lastEventTap = null;

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

  function readStoredView() {
    try {
      return localStorage.getItem(VIEW_STORAGE_KEY) === 'month' ? 'month' : 'year';
    } catch (_) {
      return 'year';
    }
  }

  function normalizeContentView(value) {
    return CONTENT_VIEW_IDS.includes(value) ? value : 'calendar';
  }

  function normalizeInlineContentView(value) {
    return INLINE_CONTENT_VIEW_IDS.includes(value) ? value : 'calendar';
  }

  function readStoredContentView() {
    try {
      return normalizeInlineContentView(localStorage.getItem(CONTENT_VIEW_STORAGE_KEY));
    } catch (_) {
      return 'calendar';
    }
  }

  function readStoredYearStartMonth() {
    try {
      const raw = Number(localStorage.getItem(YEAR_START_STORAGE_KEY));
      if (Number.isInteger(raw) && raw >= 0 && raw <= 11) return raw;
    } catch (_) {
      // Local storage can be unavailable in hardened browser contexts.
    }
    return 0;
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

  function addMonths(date, deltaMonths) {
    return new Date(date.getFullYear(), date.getMonth() + deltaMonths, 1);
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

  function shiftMonthKeepingDay(dateText, deltaMonths) {
    const date = parseLocalDate(dateText);
    const first = new Date(date.getFullYear(), date.getMonth() + deltaMonths, 1);
    const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    first.setDate(Math.min(date.getDate(), lastDay));
    return localDateString(first);
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

  function monthStartDate(dateText = state.date) {
    const date = parseLocalDate(dateText);
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function monthEndDate(dateText = state.date) {
    const date = parseLocalDate(dateText);
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }

  function monthGridStartDate(dateText = state.date) {
    return startOfWeek(monthStartDate(dateText));
  }

  function monthGridEndDate(dateText = state.date) {
    return endOfWeek(monthEndDate(dateText));
  }

  function yearRangeStartDate(dateText = state.date) {
    const date = parseLocalDate(dateText);
    let year = date.getFullYear();
    if (date.getMonth() < state.yearStartMonth) year -= 1;
    return new Date(year, state.yearStartMonth, 1);
  }

  function yearRangeEndDate(dateText = state.date) {
    return addDays(addMonths(yearRangeStartDate(dateText), 12), -1);
  }

  function rangeStart() {
    return localDateString(state.view === 'year' ? yearRangeStartDate() : monthGridStartDate());
  }

  function rangeEnd() {
    return localDateString(state.view === 'year' ? yearRangeEndDate() : monthGridEndDate());
  }

  function hasManualRange() {
    return state.mode === 'range' && state.manualRangeStart && state.manualRangeEnd;
  }

  function orderedDateRange(startText, endText) {
    const start = localDateString(parseLocalDate(startText));
    const end = localDateString(parseLocalDate(endText || startText));
    return start <= end ? { start, end } : { start: end, end: start };
  }

  function clearManualRange(nextMode = null) {
    state.manualRangeStart = null;
    state.manualRangeEnd = null;
    if (nextMode) state.mode = nextMode;
    else if (state.mode === 'range') state.mode = 'day';
  }

  function setManualRange(startText, endText) {
    const range = orderedDateRange(startText, endText);
    state.mode = 'range';
    state.manualRangeStart = range.start;
    state.manualRangeEnd = range.end;
    state.date = range.start;
    state.selection = null;
    syncCreateDate(true);
    render();
  }

  function detailRangeStart() {
    if (hasManualRange()) return state.manualRangeStart;
    if (state.mode === 'week') return localDateString(startOfWeek(parseLocalDate(state.date)));
    return state.date;
  }

  function detailRangeEnd() {
    if (hasManualRange()) return state.manualRangeEnd;
    if (state.mode === 'week') return localDateString(endOfWeek(parseLocalDate(state.date)));
    return state.date;
  }

  function monthLabel(dateText = state.date, options = { month: 'long', year: 'numeric' }) {
    return parseLocalDate(dateText).toLocaleDateString('en-GB', options);
  }

  function rangeLabel() {
    if (state.view === 'month') return monthLabel(state.date, { month: 'long', year: 'numeric' });
    const start = yearRangeStartDate();
    const end = yearRangeEndDate();
    if (state.yearStartMonth === 0 && start.getFullYear() === end.getFullYear()) {
      return String(start.getFullYear());
    }
    return `${monthLabel(localDateString(start), { month: 'short', year: 'numeric' })} to ${monthLabel(localDateString(end), { month: 'short', year: 'numeric' })}`;
  }

  function detailRangeLabel() {
    if (hasManualRange()) {
      if (detailRangeStart() === detailRangeEnd()) {
        return monthLabel(detailRangeStart(), { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
      }
      return `${monthLabel(detailRangeStart(), { day: '2-digit', month: 'short', year: 'numeric' })} to ${monthLabel(detailRangeEnd(), { day: '2-digit', month: 'short', year: 'numeric' })}`;
    }
    if (state.mode === 'week') {
      return `${monthLabel(detailRangeStart(), { day: '2-digit', month: 'short', year: 'numeric' })} to ${monthLabel(detailRangeEnd(), { day: '2-digit', month: 'short', year: 'numeric' })}`;
    }
    return monthLabel(state.date, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  }

  function filterLabel(value) {
    if (value === 'custom' && window.PersonalFilters?.selectedLabel) return window.PersonalFilters.selectedLabel('calendar');
    if (window.PersonalFilters?.getSelectedIds) {
      const selected = window.PersonalFilters.getSelectedIds('calendar');
      if (selected.length) return window.PersonalFilters.selectedLabel('calendar');
    }
    if (value === 'calendar') return 'calendar';
    if (value === 'tasks') return 'tasks and reminders';
    if (value === 'kanban') return 'kanban';
    if (value === 'imports') return 'imports';
    if (value === 'sources') return 'source records';
    if (value === 'git') return 'GitHub activity';
    return 'all sources';
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
    if (clean === 'empty' || clean === 'pending_review') return 'warn';
    if (clean === 'source_unavailable' || clean === 'error' || clean === 'blocked') return 'err';
    return 'unknown';
  }

  function sourceType(event) {
    return event?.source?.type || event?.source_type || '';
  }

  function eventTags(event) {
    return Array.isArray(event?.tags) ? event.tags.map(tag => String(tag).toLowerCase()) : [];
  }

  function normalizeFilterId(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function isCalendarEvent(event) {
    const tags = eventTags(event);
    return sourceType(event) === 'manual-calendar' || tags.includes('calendar');
  }

  function eventEditability(event) {
    if (!event?.event_id) {
      return { editable: false, reason: 'No editable event is selected.' };
    }
    return { editable: true, reason: '' };
  }

  function stripFrontmatter(md) {
    if (window.BlueprintsMarkdown?.stripFrontmatter) return window.BlueprintsMarkdown.stripFrontmatter(md);
    return String(md || '').replace(/^---\s*\n[\s\S]*?\n---\s*(\n|$)/, '');
  }

  function renderMarkdown(md) {
    if (window.BlueprintsMarkdown?.render) return window.BlueprintsMarkdown.render(md);
    const clean = stripFrontmatter(md).trim();
    if (!clean) return '<p class="calendar-markdown-empty">No event content.</p>';
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
    rows = 2,
    maxlength = 2000,
    event = null,
    disabled = false,
    previewClass = '',
  } = {}) {
    const safeTextareaId = String(textareaId || 'calendar-body').replace(/[^a-zA-Z0-9_-]/g, '-');
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
          documentType: 'calendar-event',
          documentId: event?.event_id || safeTextareaId,
          localDate: event?.local_date || state.date || '',
        },
      });
    }
    return `
      <div class="calendar-field calendar-field--wide calendar-field--notes calendar-markdown-field">
        <div class="calendar-field__label-row">
          <span>${escHtml(label)}</span>
          <button class="calendar-markdown-toggle" type="button" data-calendar-action="toggle-markdown-preview" data-calendar-markdown-prefix="${escHtml(safeTextareaId.replace(/-body$/, ''))}"${disabled ? ' disabled' : ''}>Preview</button>
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
    return sourceType(event) === 'interests-ingestion' || relatedImports.length > 0;
  }

  function isGitLike(event) {
    const tags = eventTags(event);
    return sourceType(event) === 'git' || tags.includes('github');
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
    if (isCalendarEvent(event)) return 'calendar';
    return 'source';
  }

  function matchesFilter(event) {
    if (window.PersonalFilters?.getSelectedIds && window.PersonalFilters?.matchesRecord) {
      const selected = window.PersonalFilters.getSelectedIds('calendar');
      if (selected.length) return window.PersonalFilters.matchesRecord(event, 'calendar');
    }
    if (state.sourceFilter === 'calendar') return isCalendarEvent(event);
    if (state.sourceFilter === 'tasks') return isTaskLike(event);
    if (state.sourceFilter === 'kanban') return isWorkLike(event);
    if (state.sourceFilter === 'imports') return isImportLike(event);
    if (state.sourceFilter === 'sources') return !isCalendarEvent(event);
    if (state.sourceFilter === 'git') return isGitLike(event);
    return true;
  }

  function eventStartDate(event) {
    if (event?.local_date) return event.local_date;
    if (event?.start_at) {
      const date = new Date(event.start_at);
      if (!Number.isNaN(date.getTime())) return localDateString(date);
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

  function eventTime(event) {
    if (isAllDay(event)) return 'All day';
    const meta = calendarMeta(event);
    if (meta.local_start_time) {
      return meta.local_end_time ? `${meta.local_start_time}-${meta.local_end_time}` : meta.local_start_time;
    }
    if (!event?.start_at) return '';
    const date = new Date(event.start_at);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
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

  function clearPendingEventPreview() {
    if (!pendingEventTapTimer) return;
    window.clearTimeout(pendingEventTapTimer);
    pendingEventTapTimer = null;
  }

  function handleEventActivation(row, event, options = {}) {
    if (!row?.event_id) return false;
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
    const x = Number.isFinite(event.clientX) ? event.clientX : 0;
    const y = Number.isFinite(event.clientY) ? event.clientY : 0;
    const previous = lastEventTap;
    const isDouble = event.detail >= 2
      || (previous
        && previous.id === row.event_id
        && now - previous.time <= 320
        && Math.hypot(x - previous.x, y - previous.y) <= DAY_DOUBLE_TAP_PX);
    clearPendingEventPreview();
    state.selection = {
      key: selectionKey(options.type || 'event', Number.isFinite(Number(options.index)) ? Number(options.index) : -1),
      type: options.type || 'event',
      index: Number.isFinite(Number(options.index)) ? Number(options.index) : -1,
      label: rowLabel(row),
      row,
    };
    applySelectionStyles();
    renderMeta();
    if (isDouble) {
      lastEventTap = null;
      event.preventDefault();
      editSelected();
      return true;
    }
    lastEventTap = { id: row.event_id, time: now, x, y };
    pendingEventTapTimer = window.setTimeout(() => {
      pendingEventTapTimer = null;
      lastEventTap = null;
      openEventPreview(row);
    }, 280);
    return true;
  }

  function handleSelectableEventActivation(selectable, event) {
    const type = selectable.dataset.calendarSelectType;
    const index = selectable.dataset.calendarSelectIndex;
    const rows = rowsForType(type);
    const row = rows[Number(index)];
    if (!row) return false;
    return handleEventActivation(row, event, { type, index: Number(index) });
  }

  function selectionKey(type, index) {
    return `${type}:${index}`;
  }

  function selectionAttrs(type, index) {
    return `data-calendar-select-type="${escHtml(type)}" data-calendar-select-index="${escHtml(index)}" tabindex="0"`;
  }

  function applySelectionStyles() {
    document.querySelectorAll('[data-calendar-selected="true"]').forEach(node => {
      node.removeAttribute('data-calendar-selected');
    });
    if (!state.selection) return;
    document.querySelectorAll('[data-calendar-select-type]').forEach(node => {
      if (selectionKey(node.dataset.calendarSelectType, node.dataset.calendarSelectIndex) === state.selection.key) {
        node.setAttribute('data-calendar-selected', 'true');
      }
    });
  }

  function rowLabel(row) {
    return row?.title || row?.event_id || 'calendar event';
  }

  function groupEvents() {
    const rows = eventsInRange(detailRangeStart(), detailRangeEnd());
    const timed = rows.filter(event => !isAllDay(event));
    const allDay = rows.filter(isAllDay);
    const nowParts = londonNowParts();
    const upcoming = state.upcomingWide
      ? (state.upcomingWideLoading ? [] : state.upcomingWideItems)
      : rows.filter(event => isUpcomingEvent(event, nowParts)).sort(compareEvents).slice(0, 16);
    return { timed, allDay, upcoming };
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

  async function generateDaySummary() {
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
          source_surface: 'calendar-page',
          request_id: `calendar-day-summary-${Date.now()}`,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(responseErrorMessage(data, resp.status));
      if (requestId !== state.daySummaryRequestId) return false;
      state.daySummary = data.day || null;
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

  function activeCalendarRange() {
    if (hasManualRange()) {
      return { start: state.manualRangeStart, end: state.manualRangeEnd };
    }
    if (state.mode === 'week') {
      return {
        start: localDateString(startOfWeek(parseLocalDate(state.date))),
        end: localDateString(endOfWeek(parseLocalDate(state.date))),
      };
    }
    return null;
  }

  function dayClass(dateText, currentMonth, options = {}) {
    const classes = ['calendar-day'];
    const date = parseLocalDate(dateText);
    const isOutside = date.getMonth() !== currentMonth;
    const activeRange = activeCalendarRange();
    const hasActiveRange = Boolean(activeRange);
    const isInRange = hasActiveRange && dateText >= activeRange.start && dateText <= activeRange.end;
    const isRangeEdge = isInRange && (dateText === activeRange.start || dateText === activeRange.end);
    const showRange = isInRange && (!isOutside || options.rangeOutsideDays !== false);
    const showSelected = !hasActiveRange
      && dateText === state.date
      && (!isOutside || options.selectedOutsideDays !== false);
    if (isOutside) classes.push('calendar-day--outside');
    if (dateText === localDateString(new Date()) && (!hasActiveRange || (showRange && isRangeEdge))) {
      classes.push('calendar-day--today');
    }
    if (showRange) {
      classes.push('calendar-day--range');
      if (isRangeEdge) classes.push('calendar-day--range-edge');
    } else if (showSelected) {
      classes.push('calendar-day--selected');
    }
    if (options.hasMetaGroup) classes.push('calendar-day--meta');
    return classes.join(' ');
  }

  function dayMetaGroup(events) {
    if (!events.length || !window.PersonalFilters?.bestMetaGroupForRecords) return null;
    return window.PersonalFilters.bestMetaGroupForRecords(events, 'calendar');
  }

  function dayMetaAttrs(metaGroup) {
    if (!metaGroup?.id || !metaGroup?.color) return '';
    const color = window.PersonalFilters?.metaGroupColor
      ? window.PersonalFilters.metaGroupColor(metaGroup.id)
      : metaGroup.color;
    return ` style="--calendar-day-meta-color: ${escHtml(color)};" data-calendar-meta-group="${escHtml(metaGroup.id)}"`;
  }

  function selectedCalendarFilterIds() {
    return window.PersonalFilters?.getSelectedIds
      ? window.PersonalFilters.getSelectedIds('calendar').map(normalizeFilterId).filter(Boolean)
      : [];
  }

  function recordFilterTokens(event) {
    const tokens = new Set();
    if (window.PersonalFilters?.recordTokens) {
      window.PersonalFilters.recordTokens(event).forEach(token => {
        const clean = normalizeFilterId(token);
        if (clean) tokens.add(clean);
      });
    }
    eventTags(event).forEach(tag => {
      const clean = normalizeFilterId(tag);
      if (clean) tokens.add(clean);
    });
    const category = normalizeFilterId(eventCategory(event));
    if (category) tokens.add(category);
    return Array.from(tokens);
  }

  function markerTokenSortValue(token, event, selected, actualTags) {
    const selectedIndex = selected.indexOf(token);
    const actualIndex = actualTags.indexOf(token);
    const generic = MONTH_MARKER_GENERIC_TOKENS.has(token) || token === normalizeFilterId(event?.kind);
    const specificity = (token.match(/-/g) || []).length;
    return {
      selectedIndex,
      bucket: selectedIndex >= 0 ? 0 : (actualIndex >= 0 ? 1 : 2) + (generic ? 1 : 0),
      specificity,
      length: token.length,
      actualIndex: actualIndex >= 0 ? actualIndex : 9999,
    };
  }

  function compareMarkerTokens(a, b, event, selected, actualTags) {
    const left = markerTokenSortValue(a, event, selected, actualTags);
    const right = markerTokenSortValue(b, event, selected, actualTags);
    if (left.bucket !== right.bucket) return left.bucket - right.bucket;
    if (left.selectedIndex !== right.selectedIndex && left.selectedIndex >= 0 && right.selectedIndex >= 0) {
      return left.selectedIndex - right.selectedIndex;
    }
    if (left.specificity !== right.specificity) return right.specificity - left.specificity;
    if (left.length !== right.length) return right.length - left.length;
    if (left.actualIndex !== right.actualIndex) return left.actualIndex - right.actualIndex;
    return a.localeCompare(b);
  }

  function monthEventMarker(event) {
    const selected = selectedCalendarFilterIds();
    const actualTags = eventTags(event).map(normalizeFilterId).filter(Boolean);
    const tokens = recordFilterTokens(event);
    const selectedMatches = selected.filter(id => tokens.includes(id));
    const candidates = Array.from(new Set([
      ...selectedMatches,
      ...actualTags,
      ...tokens,
    ])).filter(Boolean);
    const markerId = (candidates.sort((a, b) => compareMarkerTokens(a, b, event, selected, actualTags))[0])
      || normalizeFilterId(eventCategory(event))
      || 'calendar';
    const presentation = window.PersonalFilters?.filterPresentation
      ? window.PersonalFilters.filterPresentation(markerId)
      : null;
    return {
      id: presentation?.id || markerId,
      label: presentation?.label || markerId,
      color: presentation?.colorValue || '',
      shape: presentation?.shape || 'circle',
      fill: presentation?.fill || 'filled',
      selectedRank: selected.indexOf(markerId),
    };
  }

  function monthEventMarkerHtml(marker) {
    const colorStyle = marker.color ? ` style="--calendar-event-marker-color: ${escHtml(marker.color)};"` : '';
    return `<span class="calendar-event-marker" data-shape="${escHtml(marker.shape)}" data-fill="${escHtml(marker.fill)}"${colorStyle} aria-hidden="true"></span>`;
  }

  function monthEventExcerpt(event) {
    const title = String(event?.title || event?.kind || 'Event').replace(/\s+/g, ' ').trim();
    return title.length > MONTH_EVENT_TITLE_LIMIT
      ? title.slice(0, MONTH_EVENT_TITLE_LIMIT).trimEnd()
      : title;
  }

  function monthEventChipHtml(event) {
    const marker = monthEventMarker(event);
    return `
      <span class="calendar-event-chip calendar-event-chip--${escHtml(eventCategory(event))}">
        ${monthEventMarkerHtml(marker)}
        <span class="calendar-event-chip__title">${escHtml(monthEventExcerpt(event))}</span>
      </span>
    `;
  }

  function mobileMarkerGroups(events) {
    const groups = new Map();
    events.forEach(event => {
      const marker = monthEventMarker(event);
      const key = [marker.id, marker.shape, marker.fill, marker.color].join('\u0000');
      const group = groups.get(key) || { marker, count: 0 };
      group.count += 1;
      groups.set(key, group);
    });
    return Array.from(groups.values()).sort((a, b) => {
      const aSelected = a.marker.selectedRank >= 0 ? a.marker.selectedRank : 9999;
      const bSelected = b.marker.selectedRank >= 0 ? b.marker.selectedRank : 9999;
      return (aSelected - bSelected)
        || (b.count - a.count)
        || String(a.marker.label || a.marker.id).localeCompare(String(b.marker.label || b.marker.id));
    });
  }

  function mobileMarkerGroupHtml(group) {
    if (group.count > 2) {
      return `<span class="calendar-event-mobile-group">${monthEventMarkerHtml(group.marker)}<span class="calendar-event-mobile-count">x${escHtml(group.count)}</span></span>`;
    }
    return Array.from({ length: group.count }, () => monthEventMarkerHtml(group.marker)).join('');
  }

  function mobileEventSummary(events) {
    const groups = mobileMarkerGroups(events);
    let slots = 0;
    let shown = 0;
    const html = [];
    for (const group of groups) {
      const cost = group.count > 2 ? 2 : group.count;
      if (slots + cost > MONTH_MOBILE_MARKER_SLOTS) break;
      slots += cost;
      shown += group.count;
      html.push(mobileMarkerGroupHtml(group));
    }
    const more = Math.max(0, events.length - shown);
    if (more) html.push(`<span class="calendar-event-mobile-more">+${escHtml(more)}</span>`);
    return html.join('');
  }

  function dayEventSummary(events, compact = false) {
    if (!events.length) return '';
    if (compact) return '';
    const chips = events.slice(0, MONTH_DESKTOP_EVENT_LIMIT).map(monthEventChipHtml).join('');
    const more = events.length > MONTH_DESKTOP_EVENT_LIMIT ? `<span class="calendar-event-more">+${events.length - MONTH_DESKTOP_EVENT_LIMIT}</span>` : '';
    return `<span class="calendar-event-stack calendar-event-stack--desktop">${chips}${more}</span><span class="calendar-event-stack calendar-event-stack--mobile">${mobileEventSummary(events)}</span>`;
  }

  function compactEventText(event) {
    const text = String(event?.body || event?.body_excerpt || event?.summary || event?.status || '').trim();
    if (!text) return '';
    if (text.length <= 280) return text;
    return `${text.slice(0, 277).trimEnd()}...`;
  }

  function dayHubViewHtml(dateText) {
    const rows = eventsInRange(dateText, dateText);
    const label = monthLabel(dateText, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    const body = rows.length
      ? rows.map(event => {
        const tags = eventTags(event).slice(0, 8);
        const text = compactEventText(event);
        return `
          <article class="calendar-day-hub-event calendar-day-hub-event--${escHtml(eventCategory(event))}">
            <div class="calendar-day-hub-event__head">
              <span class="calendar-day-hub-event__time">${escHtml(eventTime(event) || 'Event')}</span>
              <span class="calendar-day-hub-event__title">${escHtml(event.title || event.kind || event.event_id || 'Untitled event')}</span>
            </div>
            ${text ? `<div class="calendar-day-hub-event__body">${escHtml(text)}</div>` : ''}
            <div class="calendar-day-hub-event__meta">
              <span>${escHtml(sourceType(event) || event.kind || 'source')}</span>
              ${tags.map(tag => `<span>${escHtml(tag)}</span>`).join('')}
            </div>
          </article>
        `;
      }).join('')
      : '<div class="calendar-empty">No visible events for this day.</div>';
    return `
      <section class="calendar-day-hub-view" data-calendar-day-hub-date="${escHtml(dateText)}">
        <div class="calendar-day-hub-view__meta">${escHtml(label)} - ${rows.length} visible event${rows.length === 1 ? '' : 's'}</div>
        <div class="calendar-day-hub-view__list">${body}</div>
      </section>
    `;
  }

  function openDayHubView(dateText) {
    const cleanDate = localDateString(parseLocalDate(dateText));
    return showActionModal(
      monthLabel(cleanDate, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }),
      dayHubViewHtml(cleanDate),
      '',
      { contentView: 'day-hub-view' },
    );
  }

  function monthGridDates(monthDate) {
    const start = startOfWeek(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1));
    return Array.from({ length: 42 }, (_, index) => addDays(start, index));
  }

  function monthCard(monthDate, dateEvents) {
    const monthDateText = localDateString(monthDate);
    const month = monthDate.getMonth();
    const days = monthGridDates(monthDate).map(date => {
      const dateText = localDateString(date);
      const events = dateEvents.get(dateText) || [];
      const metaGroup = dayMetaGroup(events);
      return `
        <button class="${dayClass(dateText, month, { rangeOutsideDays: false, selectedOutsideDays: false, hasMetaGroup: Boolean(metaGroup) })} calendar-mini-day" type="button"
                data-calendar-action="select-day" data-calendar-date="${escHtml(dateText)}"
                aria-label="${escHtml(monthLabel(dateText, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }))}"${dayMetaAttrs(metaGroup)}>
          <span class="calendar-day-number">${date.getDate()}</span>
          <span class="calendar-mini-day__events">${dayEventSummary(events, true)}</span>
        </button>
      `;
    }).join('');
    return `
      <article class="calendar-month-card">
        <button class="calendar-month-card__title" type="button" data-calendar-action="open-month" data-calendar-date="${escHtml(monthDateText)}">
          <span>${escHtml(`${MONTH_NAMES[month]} ${monthDate.getFullYear()}`)}</span>
        </button>
        <div class="calendar-weekday-row calendar-weekday-row--mini">
          ${WEEKDAY_LABELS.map(label => `<span>${escHtml(label)}</span>`).join('')}
        </div>
        <div class="calendar-mini-grid">${days}</div>
      </article>
    `;
  }

  function renderYearView() {
    const dateEvents = eventsByDate();
    const start = yearRangeStartDate();
    const months = Array.from({ length: 12 }, (_, index) => addMonths(start, index));
    return `<div class="calendar-year-grid">${months.map(month => monthCard(month, dateEvents)).join('')}</div>`;
  }

  function renderMonthView() {
    const dateEvents = eventsByDate();
    const currentMonth = parseLocalDate(state.date).getMonth();
    const days = monthGridDates(monthStartDate()).map(date => {
      const dateText = localDateString(date);
      const events = dateEvents.get(dateText) || [];
      const metaGroup = dayMetaGroup(events);
      return `
        <button class="${dayClass(dateText, currentMonth, { hasMetaGroup: Boolean(metaGroup) })} calendar-month-day" type="button"
                data-calendar-action="select-day" data-calendar-date="${escHtml(dateText)}"
                aria-label="${escHtml(monthLabel(dateText, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }))}"${dayMetaAttrs(metaGroup)}>
          <span class="calendar-day-number">${date.getDate()}</span>
          <span class="calendar-month-day__events">${dayEventSummary(events)}</span>
        </button>
      `;
    }).join('');
    return `
      <div class="calendar-month-board">
        <div class="calendar-weekday-row">${WEEKDAY_LABELS.map(label => `<span>${escHtml(label)}</span>`).join('')}</div>
        <div class="calendar-month-grid">${days}</div>
      </div>
    `;
  }

  function renderCalendarView() {
    const heading = el('calendar-view-heading');
    const pill = el('calendar-range-pill');
    const root = el('calendar-view-root');
    if (heading) heading.textContent = state.view === 'year' ? 'Year View' : 'Month View';
    if (pill) {
      pill.hidden = state.view === 'year';
      pill.textContent = state.view === 'year' ? '' : rangeLabel();
    }
    if (!root) return;
    root.dataset.calendarView = state.view;
    root.innerHTML = state.view === 'year' ? renderYearView() : renderMonthView();
    window.BlueprintsLocalShade?.refresh?.();
  }

  function listHtml(rows, type, empty) {
    return rows.length
      ? rows.map((event, index) => eventRow(event, index, type)).join('')
      : `<div class="calendar-empty">${escHtml(empty)}</div>`;
  }

  function renderRefreshState() {
    document.querySelectorAll('[data-calendar-action="refresh"], [data-calendar-view-trigger]').forEach(btn => {
      btn.classList.toggle('is-refreshing', Boolean(state.loading));
      btn.setAttribute('aria-busy', state.loading ? 'true' : 'false');
    });
  }

  function renderContentPanels() {
    document.querySelectorAll('section[data-calendar-content-view]').forEach(panel => {
      panel.hidden = panel.dataset.calendarContentView !== state.contentView;
    });
  }

  function renderContentViewTrigger() {
    document.querySelectorAll('[data-calendar-view-trigger]').forEach(btn => {
      const label = contentViewLabel();
      btn.dataset.calendarCurrentContentView = state.contentView;
      btn.setAttribute('aria-label', `View: ${label}. Tap for next view, double tap to choose, long press to refresh.`);
      btn.setAttribute('aria-expanded', contentViewMenuHost ? 'true' : 'false');
      btn.title = `View: ${label}`;
    });
  }

  function renderStatus() {
    const strip = el('calendar-status-strip');
    const status = state.loading
      ? (state.data ? 'refreshing' : 'loading')
      : (state.error ? 'error' : (state.data ? 'ready' : 'empty'));
    const tone = state.loading ? 'warn' : statusTone(status);
    if (strip) {
      const label = status === 'ready' ? '' : status;
      strip.dataset.calendarStatus = status;
      strip.setAttribute('aria-label', `${status} ${rangeLabel()}`);
      strip.innerHTML = `
        <span class="calendar-status-dot calendar-status-dot--${tone}" aria-hidden="true"></span>
        ${label ? `<span class="calendar-status-strip__label">${escHtml(label)}</span>` : ''}
        <span class="calendar-status-strip__range">${escHtml(rangeLabel())}</span>
      `;
    }
    renderRefreshState();
  }

  function renderMeta() {
    syncSharedFilterState();
    const meta = el('calendar-meta');
    if (meta) {
      const count = visibleEvents().length;
      const content = state.contentView === 'calendar' ? '' : ` - ${contentViewLabel()}`;
      meta.textContent = `${rangeLabel()} - ${state.view} view${content} - ${count} visible event${count === 1 ? '' : 's'}`;
    }
    const dateInput = el('calendar-date-input');
    if (dateInput) dateInput.value = state.date;
    syncCreateDate();
    renderEventTagSummaries();
    const yearStart = el('calendar-year-start');
    if (yearStart) yearStart.value = String(state.yearStartMonth);
    const filter = el('calendar-filter-strip');
    if (filter) {
      const selected = state.selection ? ` - selected ${state.selection.label}` : '';
      if (window.PersonalFilters?.summaryHtml) {
        filter.innerHTML = `${window.PersonalFilters.summaryHtml('calendar')}${selected ? `<span class="calendar-filter-strip__selection">${escHtml(selected)}</span>` : ''}`;
      } else {
        filter.textContent = `Filter: ${filterLabel(state.sourceFilter)}${selected}`;
      }
      filter.dataset.personalFilterOpen = 'calendar';
    }
    document.querySelectorAll('[data-calendar-view-button]').forEach(btn => {
      btn.dataset.active = btn.dataset.calendarViewButton === state.view ? 'true' : 'false';
    });
    document.querySelectorAll('[data-calendar-mode-button]').forEach(btn => {
      btn.dataset.active = btn.dataset.calendarModeButton === state.mode ? 'true' : 'false';
    });
    renderContentPanels();
    renderContentViewTrigger();
    refreshOpenContentViewModal();
    if (window.PersonalFilters?.renderAll) window.PersonalFilters.renderAll();
  }

  function eventRow(event, index, type) {
    const source = sourceType(event) || event.kind || 'source';
    const datePart = state.mode !== 'day' ? `${monthLabel(eventStartDate(event), { weekday: 'short', day: '2-digit', month: 'short' })} - ` : '';
    const ref = event.source?.ref || (Array.isArray(event.file_refs) ? event.file_refs[0] : '') || event.event_id || '';
    const todoLink = todoLinkHtml(event);
    return `
      <div class="calendar-agenda-row calendar-agenda-row--${escHtml(eventCategory(event))}" ${selectionAttrs(type, index)}>
        <div class="calendar-agenda-time">${escHtml(eventTime(event))}</div>
        <div class="calendar-agenda-main">
          <div class="calendar-agenda-title">${escHtml(event.title || event.kind || event.event_id)}</div>
          <div class="calendar-agenda-meta">${escHtml(datePart + (event.body_excerpt || event.status || ''))}</div>
          <div class="calendar-agenda-meta calendar-agenda-meta--links">${escHtml(ref)}${todoLink}</div>
        </div>
        <span class="calendar-agenda-source">${escHtml(source)}</span>
      </div>
    `;
  }

  function renderList(id, rows, type, empty) {
    const target = el(id);
    if (!target) return;
    target.innerHTML = listHtml(rows, type, empty);
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
      <div class="calendar-day-summary">
        <div class="calendar-day-summary__head">
          <span class="calendar-day-summary__title">Day Summary</span>
          <span class="calendar-day-summary__meta">
            <span class="calendar-day-summary__date">${escHtml(label)}</span>
            <button class="calendar-command-btn calendar-day-summary__generate" type="button" data-calendar-action="generate-day-summary"${state.daySummaryLoading ? ' disabled' : ''}>${state.daySummaryLoading ? 'Generating' : 'Generate'}</button>
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
        <input class="hub-checkbox__input" type="checkbox" data-calendar-upcoming-next-years${state.upcomingWide ? ' checked' : ''}${state.upcomingWideLoading ? ' disabled' : ''} />
        <span class="hub-checkbox__box" aria-hidden="true"></span>
        <span class="hub-checkbox__label">Next ${UPCOMING_WIDE_YEARS} years</span>
      </label>
    `;
  }

  function syncUpcomingControls() {
    document.querySelectorAll('[data-calendar-upcoming-next-years]').forEach(control => {
      control.checked = state.upcomingWide;
      control.disabled = state.upcomingWideLoading;
    });
  }

  function renderSelectedSummary(rows) {
    const target = el('calendar-selected-summary');
    if (!target) return;
    target.innerHTML = selectedSummaryHtml(rows);
  }

  function renderAgenda() {
    const rows = groupEvents();
    const selectedRows = rows.timed.concat(rows.allDay).sort(compareEvents);
    const count = el('calendar-agenda-count');
    if (count) count.textContent = String(selectedRows.length);
    const upcomingCount = el('calendar-upcoming-count');
    if (upcomingCount) upcomingCount.textContent = String(rows.upcoming.length);
    renderSelectedSummary(rows);
    renderList('calendar-agenda-list', selectedRows, 'selected', 'No visible items for this range.');
    const allDayTarget = el('calendar-all-day-list');
    if (allDayTarget) {
      allDayTarget.innerHTML = `${daySummaryHtml()}${listHtml(rows.allDay, 'all-day', 'No all-day items or milestones for this range.')}`;
    }
    renderList('calendar-upcoming-list', rows.upcoming, 'upcoming', upcomingEmptyMessage());
    syncUpcomingControls();
  }

  function provenanceRows() {
    const params = new URLSearchParams({
      date_start: rangeStart(),
      date_end: rangeEnd(),
      limit: '200',
    });
    return [
      ['Events API', `/api/v1/personal/events?${params.toString()}`, 'shared read path'],
      ['Write API', '/api/v1/personal/calendar/events', 'manual-calendar source'],
      ['Calendar range', `${state.view} / ${rangeLabel()}`, `year starts ${MONTH_NAMES[state.yearStartMonth]}`],
      ['Selected range', detailRangeLabel(), `${state.mode} detail`],
      ['Legacy page id', 'tab-calender', 'calendar route alias maps here'],
      ['Mode/filter', `${state.mode} / ${state.sourceFilter}`, 'client projection'],
    ];
  }

  function provenanceRowsHtml() {
    return provenanceRows().map(([title, path, meta]) => `
      <div class="calendar-provenance-row">
        <div class="calendar-provenance-main">
          <div class="calendar-provenance-title">${escHtml(title)}</div>
          <div class="calendar-provenance-meta">${escHtml(path)}</div>
          <div class="calendar-provenance-meta">${escHtml(meta)}</div>
        </div>
      </div>
    `).join('');
  }

  function renderProvenance() {
    const target = el('calendar-provenance');
    if (!target) return;
    target.innerHTML = provenanceRowsHtml();
  }

  function render() {
    renderStatus();
    renderMeta();
    renderCalendarView();
    renderAgenda();
    renderProvenance();
    applySelectionStyles();
    if (window.BodyShade && typeof window.BodyShade.scheduleSizeFillTable === 'function') {
      window.BodyShade.scheduleSizeFillTable();
    }
  }

  function renderError(message) {
    const strip = el('calendar-status-strip');
    if (strip) {
      strip.innerHTML = `
        <span class="calendar-status-dot calendar-status-dot--err" aria-hidden="true"></span>
        <span>${escHtml(message)}</span>
      `;
    }
    const meta = el('calendar-meta');
    if (meta) meta.textContent = 'Calendar refresh failed';
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
    state.selection = null;
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
    state.selection = null;
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
    const requestRangeStart = rangeStart();
    const requestRangeEnd = rangeEnd();
    if (
      state.loaded
      && !options.force
      && state.loadedRangeStart === requestRangeStart
      && state.loadedRangeEnd === requestRangeEnd
    ) return state.data;
    const requestId = state.loadRequestId + 1;
    state.loadRequestId = requestId;
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
          date_start: requestRangeStart,
          date_end: requestRangeEnd,
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
      if (requestId !== state.loadRequestId) return state.data;
      state.data = data;
      state.loadedRangeStart = requestRangeStart;
      state.loadedRangeEnd = requestRangeEnd;
      if (window.PersonalFilters?.invalidateSurface) {
        window.PersonalFilters.invalidateSurface('calendar');
        window.PersonalFilters.invalidateSurface(EVENT_TAG_SURFACE);
        window.PersonalFilters.invalidateSurface(SEARCH_TAG_SURFACE);
      }
      state.loaded = true;
      return data;
    } catch (error) {
      if (requestId !== state.loadRequestId) return state.data;
      state.error = error.message || String(error);
      return null;
    } finally {
      if (requestId === state.loadRequestId) {
        state.loading = false;
        render();
      }
    }
  }

  function setDate(dateText) {
    state.date = localDateString(parseLocalDate(dateText));
    state.loaded = false;
    state.selection = null;
    clearManualRange();
    syncCreateDate();
    syncSearchRange(true);
    return load({ force: true });
  }

  function selectDay(dateText, drillDown = false) {
    state.date = localDateString(parseLocalDate(dateText));
    state.selection = null;
    clearManualRange(state.mode === 'range' ? 'day' : null);
    syncCreateDate();
    syncSearchRange(true);
    if (drillDown) {
      state.view = 'month';
      state.contentView = 'calendar';
      writeStoredValue(VIEW_STORAGE_KEY, state.view);
      writeStoredValue(CONTENT_VIEW_STORAGE_KEY, state.contentView);
      state.loaded = false;
      return load({ force: true });
    }
    if (state.view === 'year') {
      setManualRange(state.date, state.date);
      return Promise.resolve(state.data);
    }
    render();
    return Promise.resolve(state.data);
  }

  function openMonth(dateText) {
    state.date = localDateString(parseLocalDate(dateText));
    state.view = 'month';
    state.contentView = 'calendar';
    state.loaded = false;
    state.selection = null;
    clearManualRange();
    syncCreateDate();
    syncSearchRange(true);
    writeStoredValue(VIEW_STORAGE_KEY, state.view);
    writeStoredValue(CONTENT_VIEW_STORAGE_KEY, state.contentView);
    return load({ force: true });
  }

  function setView(view) {
    state.view = view === 'month' ? 'month' : 'year';
    state.contentView = 'calendar';
    state.loaded = false;
    state.selection = null;
    clearManualRange();
    syncSearchRange(true);
    writeStoredValue(VIEW_STORAGE_KEY, state.view);
    writeStoredValue(CONTENT_VIEW_STORAGE_KEY, state.contentView);
    return load({ force: true });
  }

  function setMode(mode) {
    clearManualRange(mode === 'week' ? 'week' : 'day');
    state.mode = mode === 'week' ? 'week' : 'day';
    state.selection = null;
    syncSearchRange(true);
    render();
    return state.mode;
  }

  function setYearStartMonth(value) {
    const next = Number(value);
    state.yearStartMonth = Number.isInteger(next) && next >= 0 && next <= 11 ? next : 0;
    state.loaded = false;
    state.selection = null;
    writeStoredValue(YEAR_START_STORAGE_KEY, state.yearStartMonth);
    return load({ force: true });
  }

  function setSourceFilter(filter) {
    const clean = ['all', 'calendar', 'tasks', 'kanban', 'imports', 'sources', 'git'].includes(filter) ? filter : 'all';
    state.sourceFilter = clean;
    if (window.PersonalFilters?.setSelectedIds) {
      window.PersonalFilters.setSelectedIds('calendar', clean === 'all' ? [] : [clean === 'git' ? 'github' : clean]);
    }
    state.selection = null;
    render();
    return state.sourceFilter;
  }

  function syncSharedFilterState() {
    if (!window.PersonalFilters?.getSelectedIds) return;
    const selected = window.PersonalFilters.getSelectedIds('calendar');
    if (!selected.length) {
      state.sourceFilter = 'all';
      return;
    }
    if (selected.length === 1 && ['calendar', 'tasks', 'kanban', 'imports', 'sources', 'github'].includes(selected[0])) {
      state.sourceFilter = selected[0] === 'github' ? 'git' : selected[0];
      return;
    }
    state.sourceFilter = 'custom';
  }

  function openFilterModal(tab = 'filters') {
    const cleanTab = tab === 'settings' || tab === 'filter-settings' ? 'settings' : 'filters';
    closeContentViewMenu();
    if (window.PersonalFilters?.openModal) return window.PersonalFilters.openModal('calendar', cleanTab);
    return setContentView(cleanTab === 'settings' ? 'filter-settings' : 'filters');
  }

  function setContentView(view) {
    const previous = state.contentView;
    state.contentView = normalizeInlineContentView(view);
    if (state.contentView === 'filter-settings' && previous !== state.contentView) {
      window.PersonalFilters?.resetSettingsOrder?.('calendar');
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
    state.contentView = 'calendar';
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
    host.className = 'hub-tab-dropdown open calendar-view-menu';
    host.dataset.calendarViewMenu = '1';
    const menu = document.createElement('div');
    menu.className = 'hub-dropdown-menu calendar-view-menu__menu';
    CONTENT_VIEWS.forEach(view => {
      const btn = document.createElement('button');
      btn.className = 'hub-dropdown-item';
      btn.type = 'button';
      btn.dataset.calendarContentTarget = view.id;
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
      if (event.target.closest && event.target.closest('[data-calendar-view-trigger]')) return;
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

  function previous() {
    if (state.view === 'year') {
      state.date = localDateString(addMonths(yearRangeStartDate(), -12));
    } else {
      state.date = shiftMonthKeepingDay(state.date, -1);
    }
    state.loaded = false;
    state.selection = null;
    clearManualRange();
    syncCreateDate();
    syncSearchRange(true);
    return load({ force: true });
  }

  function next() {
    if (state.view === 'year') {
      state.date = localDateString(addMonths(yearRangeStartDate(), 12));
    } else {
      state.date = shiftMonthKeepingDay(state.date, 1);
    }
    state.loaded = false;
    state.selection = null;
    clearManualRange();
    syncCreateDate();
    syncSearchRange(true);
    return load({ force: true });
  }

  function today() {
    return setDate(localDateString(new Date()));
  }

  function eventDefaultStartDate() {
    return hasManualRange() ? state.manualRangeStart : state.date;
  }

  function eventDefaultEndDate() {
    return hasManualRange() ? state.manualRangeEnd : eventDefaultStartDate();
  }

  function syncCreateDate(force = false) {
    const startDate = eventDefaultStartDate();
    const endDate = eventDefaultEndDate();
    document.querySelectorAll('[data-calendar-event-date]').forEach(input => {
      if (force || !input.value) input.value = startDate;
    });
    document.querySelectorAll('[data-calendar-event-end-date]').forEach(input => {
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
      window.BlueprintsPersonalSearch.syncRange('calendar', { force });
    }
  }

  function eventTagsSummaryHtml() {
    if (window.PersonalFilters?.summaryHtml) {
      return window.PersonalFilters.summaryHtml(EVENT_TAG_SURFACE, { prefix: 'Tags:' });
    }
    return '<span class="personal-filter-summary"><span class="personal-filter-summary__label">Tags:</span><span class="personal-filter-summary__empty">Calendar</span></span>';
  }

  function renderEventTagSummaries() {
    document.querySelectorAll('[data-calendar-event-tags-strip]').forEach(strip => {
      strip.innerHTML = eventTagsSummaryHtml();
      strip.dataset.personalFilterOpen = EVENT_TAG_SURFACE;
      strip.dataset.personalFilterTab = 'filters';
    });
  }

  function eventTagIds() {
    const selected = window.PersonalFilters?.getSelectedIds
      ? window.PersonalFilters.getSelectedIds(EVENT_TAG_SURFACE)
      : [];
    return Array.from(new Set([...(selected || []), ...EVENT_REQUIRED_TAGS]));
  }

  function embeddedEventFormHtml(prefix) {
    const safePrefix = String(prefix || 'calendar-panel-event').replace(/[^a-zA-Z0-9_-]/g, '-');
    const defaultStartDate = eventDefaultStartDate();
    const defaultEndDate = eventDefaultEndDate();
    const valueFor = (key, fallback = '') => String(el(`${safePrefix}-${key}`)?.value || fallback);
    const allDay = !!el(`${safePrefix}-all-day`)?.checked;
    const disabled = allDay ? ' disabled' : '';
    return `
      <section class="calendar-quick-event calendar-quick-event--embedded" aria-label="New Event">
        <div class="calendar-form-grid calendar-event-form-grid">
          <label class="calendar-field calendar-field--wide" for="${escHtml(safePrefix)}-title">
            <span>Title</span>
            <input id="${escHtml(safePrefix)}-title" type="text" maxlength="180" autocomplete="off" value="${escHtml(valueFor('title'))}" />
          </label>
          <label class="calendar-field" for="${escHtml(safePrefix)}-date">
            <span>Start date</span>
            <input id="${escHtml(safePrefix)}-date" type="date" data-calendar-event-date value="${escHtml(valueFor('date', defaultStartDate))}" />
          </label>
          <label class="calendar-field" for="${escHtml(safePrefix)}-end-date">
            <span>End date</span>
            <input id="${escHtml(safePrefix)}-end-date" type="date" data-calendar-event-end-date value="${escHtml(valueFor('end-date', valueFor('date', defaultEndDate)))}" />
          </label>
          <label class="calendar-field" for="${escHtml(safePrefix)}-start">
            <span>Start</span>
            <input id="${escHtml(safePrefix)}-start" type="time" value="${escHtml(valueFor('start'))}"${disabled} />
          </label>
          <label class="calendar-field" for="${escHtml(safePrefix)}-end">
            <span>End</span>
            <input id="${escHtml(safePrefix)}-end" type="time" value="${escHtml(valueFor('end'))}"${disabled} />
          </label>
          <div class="calendar-event-options-row">
            <label class="calendar-check hub-checkbox" for="${escHtml(safePrefix)}-all-day">
              <input id="${escHtml(safePrefix)}-all-day" class="hub-checkbox__input" type="checkbox" data-calendar-event-all-day="${escHtml(safePrefix)}"${allDay ? ' checked' : ''} />
              <span class="hub-checkbox__box" aria-hidden="true"></span>
              <span class="hub-checkbox__label">All day</span>
            </label>
            <div class="calendar-filter-strip calendar-event-tags-strip" role="button" tabindex="0" data-calendar-event-tags-strip data-personal-filter-open="${escHtml(EVENT_TAG_SURFACE)}" data-personal-filter-tab="filters">${eventTagsSummaryHtml()}</div>
          </div>
          ${richMarkdownFieldHtml({
            textareaId: `${safePrefix}-body`,
            previewId: `${safePrefix}-body-preview`,
            label: 'Notes',
            value: valueFor('body'),
            rows: 2,
            maxlength: 2000,
            event: { event_id: safePrefix, local_date: valueFor('date', defaultStartDate) },
          })}
        </div>
        <div class="calendar-quick-event__footer">
          <span id="${escHtml(safePrefix)}-status" class="calendar-entry-status"></span>
          <button class="calendar-command-btn" type="button" data-calendar-action="submit-event" data-calendar-event-prefix="${escHtml(safePrefix)}">Save Event</button>
        </div>
      </section>
    `;
  }

  function embeddedEventPrefixForHost(host) {
    if (host?.id === 'calendar-filter-inline-panel') return 'calendar-inline-event';
    if (host?.closest?.('#ultrawide-sidecar-body')) return 'calendar-sidecar-event';
    return 'calendar-panel-event';
  }

  function embeddedSearchHtml(host) {
    const instance = host?.dataset?.calendarModalHost === '1'
      ? 'calendar-modal-search'
      : (host?.id === 'calendar-filter-inline-panel'
      ? 'calendar-inline-search'
      : (host?.closest?.('#ultrawide-sidecar-body') ? 'calendar-sidecar-search' : 'calendar-panel-search'));
    window.setTimeout(() => {
      if (window.BlueprintsPersonalSearch?.init) window.BlueprintsPersonalSearch.init();
    }, 0);
    return `<div class="personal-search-strip personal-search-strip--embedded" data-personal-search-surface="calendar" data-personal-search-instance="${escHtml(instance)}"></div>`;
  }

  function embeddedSelectedHtml(options = {}) {
    const rows = groupEvents();
    const selectedRows = rows.timed.concat(rows.allDay).sort(compareEvents);
    const head = options.modal
      ? ''
      : `<div class="calendar-section-head">
          <h3>Selected Range Visible Items</h3>
          <span class="calendar-pill">${escHtml(selectedRows.length)}</span>
        </div>`;
    return `
      <section class="calendar-band calendar-band--embedded-selected" aria-label="Selected Range Visible Items">
        ${head}
        <div class="calendar-selected-summary">${selectedSummaryHtml(rows)}</div>
        <div class="calendar-agenda-list">${listHtml(selectedRows, 'selected', 'No visible items for this range.')}</div>
      </section>
    `;
  }

  function embeddedMilestonesHtml(options = {}) {
    const rows = groupEvents();
    const head = options.modal
      ? ''
      : `<div class="calendar-section-head">
          <h3>All-Day And Milestones</h3>
          <span class="calendar-pill">${escHtml(rows.allDay.length)}</span>
        </div>`;
    return `
      <section class="calendar-band calendar-band--embedded-milestones" aria-label="All-Day And Milestones">
        ${head}
        ${daySummaryHtml()}
        <div class="calendar-agenda-list">${listHtml(rows.allDay, 'all-day', 'No all-day items or milestones for this range.')}</div>
      </section>
    `;
  }

  function embeddedUpcomingHtml(options = {}) {
    const rows = groupEvents();
    const head = options.modal
      ? ''
      : `<div class="calendar-section-head">
          <div class="calendar-section-head__cluster">
            <h3>Upcoming</h3>
            ${upcomingScopeHtml()}
            <span class="calendar-pill">${escHtml(rows.upcoming.length)}</span>
          </div>
        </div>`;
    return `
      <section class="calendar-band calendar-band--embedded-upcoming" aria-label="Upcoming">
        ${head}
        <div class="calendar-agenda-list">${listHtml(rows.upcoming, 'upcoming', upcomingEmptyMessage())}</div>
      </section>
    `;
  }

  function embeddedProvenanceHtml(options = {}) {
    const head = options.modal
      ? ''
      : `<div class="calendar-section-head">
          <h3>Provenance</h3>
        </div>`;
    return `
      <section class="calendar-band calendar-band--embedded-provenance" aria-label="Provenance">
        ${head}
        <div class="calendar-provenance-list">${provenanceRowsHtml()}</div>
      </section>
    `;
  }

  function contentViewModalToolsHtml(view) {
    const rows = groupEvents();
    if (view === 'selected') {
      const selectedRows = rows.timed.concat(rows.allDay);
      return `<span class="calendar-pill">${escHtml(selectedRows.length)}</span>`;
    }
    if (view === 'milestones') {
      return `<span class="calendar-pill">${escHtml(rows.allDay.length)}</span>`;
    }
    if (view === 'upcoming') {
      return `${upcomingScopeHtml()}<span class="calendar-pill">${escHtml(rows.upcoming.length)}</span>`;
    }
    return '';
  }

  function contentViewModalHtml(view) {
    if (view === 'selected') return embeddedSelectedHtml({ modal: true });
    if (view === 'milestones') return embeddedMilestonesHtml({ modal: true });
    if (view === 'search') return embeddedSearchHtml({ dataset: { calendarModalHost: '1' } });
    if (view === 'new-event') return embeddedEventFormHtml('calendar-modal-event');
    if (view === 'upcoming') return embeddedUpcomingHtml({ modal: true });
    if (view === 'provenance') return embeddedProvenanceHtml({ modal: true });
    return '';
  }

  function prepareContentViewModal(view) {
    if (view === 'new-event') {
      syncCreateDate(hasManualRange());
      renderEventTagSummaries();
      setAllDayControls('calendar-modal-event');
      window.setTimeout(() => el('calendar-modal-event-title')?.focus(), 0);
    }
    if (view === 'upcoming') syncUpcomingControls();
    if (view === 'search' && window.BlueprintsPersonalSearch?.init) {
      syncSearchRange(hasManualRange());
      window.setTimeout(() => window.BlueprintsPersonalSearch.init(), 0);
    }
  }

  function refreshOpenContentViewModal() {
    const modal = el('calendar-action-modal');
    const body = el('calendar-action-modal-body');
    const tools = el('calendar-action-modal-tools');
    const view = modal?.open ? modal.dataset.calendarActionModalView : '';
    if (!body || !MODAL_CONTENT_VIEW_IDS.includes(view)) return;
    if (tools) {
      tools.innerHTML = contentViewModalToolsHtml(view);
      tools.hidden = !tools.innerHTML.trim();
    }
    if (view === 'new-event' || view === 'search') {
      if (view === 'new-event') {
        syncCreateDate(hasManualRange());
        renderEventTagSummaries();
      }
      if (view === 'search') syncSearchRange(hasManualRange());
      return;
    }
    body.innerHTML = contentViewModalHtml(view);
    prepareContentViewModal(view);
  }

  function openContentViewModal(view) {
    const cleanView = normalizeContentView(view);
    closeContentViewMenu();
    if (cleanView === 'calendar') return setContentView('calendar');
    if (cleanView === 'filters') return openFilterModal('filters');
    if (cleanView === 'filter-settings') return openFilterModal('settings');
    if (!MODAL_CONTENT_VIEW_IDS.includes(cleanView)) return false;
    const shown = showActionModal(contentViewLabel(cleanView), contentViewModalHtml(cleanView), '', {
      contentView: cleanView,
      headerToolsHtml: contentViewModalToolsHtml(cleanView),
    });
    if (shown) prepareContentViewModal(cleanView);
    return shown;
  }

  function closeActionModal() {
    const modal = el('calendar-action-modal');
    const body = el('calendar-action-modal-body');
    const tools = el('calendar-action-modal-tools');
    if (!modal) return;
    if (typeof HubModal !== 'undefined') HubModal.close(modal);
    else if (typeof modal.close === 'function') modal.close();
    modal.classList.remove('calendar-action-modal--content');
    delete modal.dataset.calendarActionModalView;
    if (body) body.innerHTML = '';
    if (tools) {
      tools.innerHTML = '';
      tools.hidden = true;
    }
  }

  function showActionModal(title, html, status = '', options = {}) {
    const modal = el('calendar-action-modal');
    const titleEl = el('calendar-action-modal-title');
    const body = el('calendar-action-modal-body');
    const tools = el('calendar-action-modal-tools');
    const statusEl = el('calendar-action-modal-status');
    if (!modal || !body) return false;
    const contentView = options.contentView || '';
    modal.classList.toggle('calendar-action-modal--content', Boolean(contentView));
    if (contentView) modal.dataset.calendarActionModalView = contentView;
    else delete modal.dataset.calendarActionModalView;
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

  function kvHtml(items) {
    return `<dl class="calendar-action-kv">${items.map(([key, value]) => `
      <dt>${escHtml(key)}</dt><dd>${escHtml(value ?? '')}</dd>
    `).join('')}</dl>`;
  }

  function eventPreviewTitle(event) {
    return event?.title || event?.kind || 'Calendar Event';
  }

  function eventPreviewBody(event) {
    return event?.content_projection || event?.body_excerpt || '';
  }

  function eventPreviewMeta(event) {
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

	  function eventPreviewToolsHtml(event) {
	    if (!eventEditability(event).editable) return '';
	    return `
	      <button class="calendar-action-icon-btn table-icon-btn table-icon-btn--edit" type="button" data-calendar-modal-action="edit-event-content" title="Edit content" aria-label="Edit content"></button>
	    `;
	  }

  function eventPreviewHtml(event, options = {}) {
    const editability = eventEditability(event);
    const body = eventPreviewBody(event);
    if (options.editing && editability.editable) {
      return `
        <section class="calendar-entry-preview" data-calendar-event-preview-id="${escHtml(event.event_id || '')}">
          <div class="calendar-entry-preview__meta">${escHtml(eventPreviewMeta(event))}${todoLinkHtml(event)}</div>
          <div class="calendar-entry-preview-editor">
            ${richMarkdownFieldHtml({
              textareaId: 'calendar-event-preview-editor',
              previewId: 'calendar-event-preview-editor-preview',
              label: 'Content',
              value: body,
              rows: 14,
              maxlength: 4000,
              event,
              previewClass: 'calendar-entry-preview-editor__markdown',
            })}
            <div class="calendar-entry-preview-editor__footer">
              <span id="calendar-event-preview-status" class="calendar-entry-status"></span>
              <button class="calendar-command-btn" type="button" data-calendar-modal-action="save-event-content">Save Content</button>
            </div>
          </div>
        </section>
      `;
    }
    return `
      <section class="calendar-entry-preview" data-calendar-event-preview-id="${escHtml(event?.event_id || '')}">
        <div class="calendar-entry-preview__meta">${escHtml(eventPreviewMeta(event))}${todoLinkHtml(event)}</div>
        <div class="calendar-markdown-preview calendar-entry-preview__body">${renderMarkdown(body)}</div>
        ${editability.editable ? '' : `<p class="calendar-entry-preview__notice">${escHtml(editability.reason)}</p>`}
      </section>
    `;
  }

  function openEventPreview(event) {
    if (!event?.event_id) return false;
    return showActionModal(eventPreviewTitle(event), eventPreviewHtml(event), '', {
      contentView: 'event-preview',
      headerToolsHtml: eventPreviewToolsHtml(event),
    });
  }

  function openSelectedEventContentEditor() {
    const event = state.selection?.row;
    if (!event?.event_id || !eventEditability(event).editable) return false;
    return showActionModal(eventPreviewTitle(event), eventPreviewHtml(event, { editing: true }), '', {
      contentView: 'event-preview',
    });
  }

  function calendarPayloadForContentEdit(event, bodyText) {
    const meta = calendarMeta(event);
    const runId = `ui-calendar-content-edit-${Date.now()}`;
    return {
      title: event?.title || 'Untitled',
      body: bodyText.trim(),
      local_date: eventStartDate(event),
      start_time: isAllDay(event) ? null : meta.local_start_time || null,
      end_time: isAllDay(event) ? null : meta.local_end_time || null,
      all_day: isAllDay(event),
      tags: eventTags(event),
      actor: 'blueprints-ui',
      source_surface: 'calendar-page',
      request_id: runId,
      run_id: runId,
    };
  }

  async function saveSelectedEventContent() {
    const event = state.selection?.row;
    const status = el('calendar-event-preview-status');
    const editability = eventEditability(event);
    if (!editability.editable || !event?.event_id) {
      if (status) status.textContent = editability.reason || 'Event cannot be edited.';
      return false;
    }
    const payload = calendarPayloadForContentEdit(event, String(el('calendar-event-preview-editor')?.value || ''));
    if (status) status.textContent = 'Saving content...';
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const resp = await fetcher(`/api/v1/personal/calendar/events/${encodeURIComponent(event.event_id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      if (status) status.textContent = responseErrorMessage(data, resp.status);
      return false;
    }
    state.lastWrite = data;
    state.date = data.event?.local_date || payload.local_date || state.date;
    state.loaded = false;
    await load({ force: true });
	    const saved = data.event || event;
	    state.selection = { key: 'event:-1', type: 'event', index: -1, label: rowLabel(saved), row: saved };
	    applySelectionStyles();
	    renderMeta();
	    return showActionModal(eventPreviewTitle(saved), eventPreviewHtml(saved), 'Saved content.', {
	      contentView: 'event-preview',
	      headerToolsHtml: eventPreviewToolsHtml(saved),
	    });
  }

  function toggleMarkdownPreview(target, actionRoot = document) {
    const button = target?.nodeType === 1
      ? target
      : (actionRoot.querySelector?.(`[data-calendar-markdown-prefix="${target}"]`) || document.querySelector(`[data-calendar-markdown-prefix="${target}"]`));
    const prefix = button?.dataset?.calendarMarkdownPrefix || String(target || 'calendar-event');
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

  function toggleEventContentPreview(button) {
    const editorId = button?.dataset?.calendarPreviewEditor || 'calendar-event-preview-editor';
    const previewId = button?.dataset?.calendarPreviewOutput || 'calendar-event-preview-editor-preview';
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

  function eachDateText(startText, endText) {
    const range = orderedDateRange(startText, endText);
    const dates = [];
    for (let date = parseLocalDate(range.start); localDateString(date) <= range.end; date = addDays(date, 1)) {
      dates.push(localDateString(date));
    }
    return dates;
  }

  function eventPayloadsFromForm(prefix = 'calendar-event') {
    const allDay = !!el(`${prefix}-all-day`)?.checked;
    const startDate = String(el(`${prefix}-date`)?.value || state.date).trim();
    const endDate = String(el(`${prefix}-end-date`)?.value || startDate || state.date).trim();
    const dates = eachDateText(startDate, endDate);
    const runId = dates.length > 1 ? `ui-calendar-range-${Date.now()}` : `ui-calendar-${Date.now()}`;
    const base = {
      title: String(el(`${prefix}-title`)?.value || '').trim(),
      body: String(el(`${prefix}-body`)?.value || '').trim(),
      start_time: allDay ? null : String(el(`${prefix}-start`)?.value || '').trim() || null,
      end_time: allDay ? null : String(el(`${prefix}-end`)?.value || '').trim() || null,
      all_day: allDay,
      tags: eventTagIds(),
      actor: 'blueprints-ui',
      source_surface: 'calendar-page',
    };
    return dates.map((localDate, index) => ({
      ...base,
      local_date: localDate,
      request_id: dates.length > 1 ? `${runId}-${index + 1}` : runId,
      run_id: runId,
    }));
  }

  function eventPayloadFromForm(prefix = 'calendar-event') {
    return eventPayloadsFromForm(prefix)[0] || {};
  }

  function setAllDayControls(prefix = 'calendar-event') {
    const allDay = !!el(`${prefix}-all-day`)?.checked;
    ['start', 'end'].forEach(key => {
      const input = el(`${prefix}-${key}`);
      if (input) input.disabled = allDay;
    });
  }

  async function submitEvent(prefix = 'calendar-event') {
    const status = el(prefix === 'calendar-event' ? 'calendar-entry-status' : `${prefix}-status`);
    const payloads = eventPayloadsFromForm(prefix);
    const firstPayload = payloads[0];
    if (!firstPayload?.title) {
      if (status) status.textContent = 'Event title is required.';
      return false;
    }
    if (!payloads.length) {
      if (status) status.textContent = 'A valid event date is required.';
      return false;
    }
    if (status) status.textContent = payloads.length > 1 ? `Saving ${payloads.length} events...` : 'Saving event...';
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const saved = [];
    for (const payload of payloads) {
      const resp = await fetcher('/api/v1/personal/calendar/events', {
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
    if (endDate) endDate.value = el(`${prefix}-date`)?.value || eventDefaultStartDate();
    if (status) {
      status.textContent = saved.length > 1
        ? `Saved ${saved.length} events`
        : `Saved ${saved[0]?.event?.event_id || ''}`;
    }
    state.lastWrite = saved[saved.length - 1];
    state.date = saved[0]?.event?.local_date || firstPayload.local_date || state.date;
    state.view = 'month';
    state.contentView = 'calendar';
    state.loaded = false;
    clearManualRange();
    writeStoredValue(VIEW_STORAGE_KEY, state.view);
    writeStoredValue(CONTENT_VIEW_STORAGE_KEY, state.contentView);
    await load({ force: true });
    return true;
  }

  function dateButtonFromPoint(event) {
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
    const node = document.elementFromPoint(event.clientX, event.clientY);
    return node?.closest?.('[data-calendar-action="select-day"][data-calendar-date]') || null;
  }

  function eventNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  function suppressSelectDayInteractions(durationMs = 220) {
    suppressSelectDayClick = true;
    suppressSelectDayClickUntil = eventNow() + durationMs;
    window.setTimeout(() => {
      if (eventNow() >= suppressSelectDayClickUntil) suppressSelectDayClick = false;
    }, durationMs + 30);
  }

  function shouldSuppressSelectDayInteraction(event) {
    if (!suppressSelectDayClick && eventNow() >= suppressSelectDayClickUntil) return false;
    if (eventNow() >= suppressSelectDayClickUntil) {
      suppressSelectDayClick = false;
      return false;
    }
    event.preventDefault();
    return true;
  }

  function removeDateRangeDragListeners() {
    document.removeEventListener('pointermove', updateDateRangeDrag, false);
    document.removeEventListener('pointerup', finishDateRangeDrag, false);
    document.removeEventListener('pointercancel', cancelDateRangeDrag, false);
  }

  function beginDateRangeDrag(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const btn = event.target.closest('[data-calendar-action="select-day"][data-calendar-date]');
    if (!btn?.dataset?.calendarDate) return;
    dateRangeDrag = {
      pointerId: event.pointerId,
      start: btn.dataset.calendarDate,
      current: btn.dataset.calendarDate,
      moved: false,
    };
    document.addEventListener('pointermove', updateDateRangeDrag, { passive: false });
    document.addEventListener('pointerup', finishDateRangeDrag, { passive: false });
    document.addEventListener('pointercancel', cancelDateRangeDrag, { passive: true });
  }

  function updateDateRangeDrag(event) {
    if (!dateRangeDrag || event.pointerId !== dateRangeDrag.pointerId) return;
    const btn = dateButtonFromPoint(event);
    const dateText = btn?.dataset?.calendarDate;
    if (!dateText || dateText === dateRangeDrag.current) return;
    dateRangeDrag.current = dateText;
    if (dateText !== dateRangeDrag.start) {
      dateRangeDrag.moved = true;
      setManualRange(dateRangeDrag.start, dateText);
      event.preventDefault();
    }
  }

  function finishDateRangeDrag(event) {
    if (!dateRangeDrag || event.pointerId !== dateRangeDrag.pointerId) return;
    const drag = dateRangeDrag;
    dateRangeDrag = null;
    removeDateRangeDragListeners();
    if (!drag.moved) {
      return;
    }
    suppressSelectDayInteractions(180);
    setManualRange(drag.start, drag.current);
    event.preventDefault();
  }

  function cancelDateRangeDrag(event) {
    if (!dateRangeDrag || event.pointerId !== dateRangeDrag.pointerId) return;
    dateRangeDrag = null;
    removeDateRangeDragListeners();
  }

  function editSelected() {
    const event = state.selection?.row;
    if (!event) {
      return showActionModal('Edit Calendar Event', '<p>Select a Calendar event before editing.</p>');
    }
    const meta = calendarMeta(event);
    const allDay = !!meta.all_day;
    const html = `
      ${kvHtml([
        ['Event', event.event_id || ''],
        ['Source', sourceType(event) || ''],
      ])}
      <div class="calendar-form-grid">
        <label class="calendar-field calendar-field--wide" for="calendar-edit-title">
          <span>Title</span>
          <input id="calendar-edit-title" type="text" maxlength="180" value="${escHtml(event.title || '')}" />
        </label>
        <label class="calendar-field" for="calendar-edit-date">
          <span>Date</span>
          <input id="calendar-edit-date" type="date" value="${escHtml(event.local_date || state.date)}" />
        </label>
        <label class="calendar-field" for="calendar-edit-start">
          <span>Start</span>
          <input id="calendar-edit-start" type="time" value="${escHtml(meta.local_start_time || '')}" ${allDay ? 'disabled' : ''} />
        </label>
        <label class="calendar-field" for="calendar-edit-end">
          <span>End</span>
          <input id="calendar-edit-end" type="time" value="${escHtml(meta.local_end_time || '')}" ${allDay ? 'disabled' : ''} />
        </label>
        <label class="calendar-check hub-checkbox" for="calendar-edit-all-day">
          <input id="calendar-edit-all-day" class="hub-checkbox__input" type="checkbox" ${allDay ? 'checked' : ''} />
          <span class="hub-checkbox__box" aria-hidden="true"></span>
          <span class="hub-checkbox__label">All day</span>
        </label>
        ${richMarkdownFieldHtml({
          textareaId: 'calendar-edit-body',
          previewId: 'calendar-edit-body-preview',
          label: 'Notes',
          value: event.content_projection || event.body_excerpt || '',
          rows: 2,
          maxlength: 2000,
          event,
        })}
      </div>
      <div class="calendar-modal-actions">
        <button class="calendar-command-btn calendar-command-btn--danger" type="button" data-calendar-modal-action="delete-event">Delete</button>
        <button class="calendar-command-btn" type="button" data-calendar-modal-action="submit-edit">Save Edit</button>
      </div>
    `;
    return showActionModal('Edit Calendar Event', html);
  }

  async function submitEdit() {
    const event = state.selection?.row;
    if (!event?.event_id) return false;
    const payload = eventPayloadFromForm('calendar-edit');
    if (!payload.title) {
      showActionModal('Edit Calendar Event', '<p>Event title is required.</p>');
      return false;
    }
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const resp = await fetcher(`/api/v1/personal/calendar/events/${encodeURIComponent(event.event_id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      showActionModal('Edit Calendar Event', `<p>${escHtml(responseErrorMessage(data, resp.status))}</p>`);
      return false;
    }
    state.lastWrite = data;
    state.date = data.event?.local_date || state.date;
    state.view = 'month';
    state.contentView = 'calendar';
    state.loaded = false;
    writeStoredValue(VIEW_STORAGE_KEY, state.view);
    writeStoredValue(CONTENT_VIEW_STORAGE_KEY, state.contentView);
    await load({ force: true });
    return showActionModal('Edit Calendar Event', kvHtml([
      ['Event', data.event?.event_id || event.event_id],
      ['Title', data.event?.title || payload.title],
      ['Audit', data.audit?.audit_id || ''],
    ]), 'Calendar event updated.');
  }

  async function deleteSelectedEvent() {
    const event = state.selection?.row;
    const editability = eventEditability(event);
    if (!event?.event_id) return showActionModal('Delete Calendar Event', '<p>Select a Calendar event before deleting.</p>');
    if (!editability.editable) {
      return showActionModal('Delete Calendar Event', kvHtml([
        ['Event', event.event_id || ''],
        ['State', editability.reason],
      ]));
    }
    const confirmed = await HubDialogs.confirmDelete({
      title: 'Delete Calendar Event',
      message: `Delete "${event.title || event.event_id}"?`,
      detail: 'This removes the manually owned Calendar event from shared personal events.',
      confirmText: 'Delete Event',
    });
    if (!confirmed) return false;
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const resp = await fetcher(`/api/v1/personal/calendar/events/${encodeURIComponent(event.event_id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actor: 'blueprints-ui',
        source_surface: 'calendar-page',
        request_id: `ui-calendar-delete-${Date.now()}`,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return showActionModal('Delete Calendar Event', `<p>${escHtml(responseErrorMessage(data, resp.status))}</p>`);
    }
    state.lastWrite = data;
    state.selection = null;
    state.loaded = false;
    await load({ force: true });
    return showActionModal('Delete Calendar Event', kvHtml([
      ['Event', data.event_id || event.event_id],
      ['Title', data.deleted_event?.title || event.title || ''],
      ['Audit', data.audit?.audit_id || ''],
    ]), 'Calendar event deleted.');
  }

  function openSource() {
    const event = state.selection?.row;
    if (!event) {
      return showActionModal('Calendar Source', '<p>Select a calendar row before opening source detail.</p>');
    }
    return showActionModal('Calendar Source', `${kvHtml([
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
    return showActionModal('Calendar State', kvHtml([
      ['View', state.view],
      ['Range', rangeLabel()],
      ['Detail range', detailRangeLabel()],
      ['Year starts', MONTH_NAMES[state.yearStartMonth]],
      ['Filter', filterLabel(state.sourceFilter)],
      ['Visible events', visibleEvents().length],
      ['Read path', '/api/v1/personal/events'],
    ]));
  }

  function linkDiary() {
    const targetDate = state.selection?.row?.local_date || state.date;
    return openDiaryWeek(targetDate);
  }

  function openDiaryWeek(dateText = state.date) {
    const targetDate = localDateString(parseLocalDate(dateText));
    if (typeof switchGroup === 'function') switchGroup('dave');
    if (typeof switchTab === 'function') switchTab('diary');
    if (typeof DaveMenuConfig !== 'undefined') DaveMenuConfig.updateActiveTab('diary');
    if (window.BlueprintsDiaryPage?.openWeek) window.BlueprintsDiaryPage.openWeek(targetDate);
    else if (window.BlueprintsDiaryPage?.setDate) window.BlueprintsDiaryPage.setDate(targetDate);
    return true;
  }

  async function createTask() {
    const event = state.selection?.row;
    const title = event ? `Task: ${rowLabel(event)}` : `Task: ${state.date}`;
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const resp = await fetcher('/api/v1/personal/calendar/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        body: event ? `Created from calendar event ${event.event_id || ''}` : 'Created from Calendar page',
        local_date: event?.local_date || state.date,
        all_day: true,
        kind: 'task',
        tags: ['calendar-task'],
        actor: 'blueprints-ui',
        source_surface: 'calendar-page',
        request_id: `ui-calendar-task-${Date.now()}`,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      showActionModal('Create Calendar Task', `<p>${escHtml(responseErrorMessage(data, resp.status))}</p>`);
      return false;
    }
    state.lastWrite = data;
    state.loaded = false;
    await load({ force: true });
    return showActionModal('Create Calendar Task', kvHtml([
      ['Task', data.event?.event_id || ''],
      ['Date', data.event?.local_date || state.date],
      ['Audit', data.audit?.audit_id || ''],
    ]), 'Task event created in shared personal events.');
  }

  async function linkKanbanItem() {
    const event = state.selection?.row;
    if (!event) {
      return showActionModal('Link Kanban', '<p>Select a calendar row before linking a Kanban item.</p>');
    }
    return showActionModal('Link Kanban', `${kvHtml([
      ['Event', event.event_id || ''],
      ['Current links', (event.related?.kanban_items || []).join(', ') || 'none'],
    ])}
      <label class="calendar-field" for="calendar-kanban-link-input">
        <span>Kanban ref</span>
        <input id="calendar-kanban-link-input" type="text" autocomplete="off" />
      </label>
      <button class="calendar-command-btn" type="button" data-calendar-modal-action="submit-kanban-link">Link Kanban</button>`);
  }

  async function submitKanbanLink() {
    const event = state.selection?.row;
    const input = el('calendar-kanban-link-input');
    const kanbanRef = String(input?.value || '').trim();
    if (!event?.event_id || !kanbanRef) return false;
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const resp = await fetcher(`/api/v1/personal/events/${encodeURIComponent(event.event_id)}/kanban-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kanban_item_ref: kanbanRef,
        actor: 'blueprints-ui',
        source_surface: 'calendar-page',
        request_id: `ui-calendar-kanban-link-${Date.now()}`,
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
    state.data = second;
    if (window.PersonalFilters?.invalidateSurface) {
      window.PersonalFilters.invalidateSurface('calendar');
      window.PersonalFilters.invalidateSurface(EVENT_TAG_SURFACE);
      window.PersonalFilters.invalidateSurface(SEARCH_TAG_SURFACE);
    }
    state.loaded = true;
    render();
    return showActionModal('Calendar Safe Checks', kvHtml([
      ['Read route', '/api/v1/personal/events'],
      ['View', state.view],
      ['Range', rangeLabel()],
      ['Count stable', (first.items || []).length === (second.items || []).length ? 'yes' : 'no'],
      ['Filter', filterLabel(state.sourceFilter)],
    ]), 'No write command was run.');
  }

  const CalendarDayGestureMachine = (() => {
    let machineState = 'IDLE';
    let pendingTapTimer = null;
    let pendingTapContext = null;
    let longPressTimer = null;
    let pressContext = null;
    let ignoreClicksUntil = 0;
    let lastDoubleAt = 0;
    const transitions = {
      IDLE: {
        pointerDown: { next: 'PRESSING', actions: ['startLongPressTimer'] },
        click: { next: 'TAP_PENDING', actions: ['startTapTimer'] },
        doubleTap: { next: 'DOUBLE_HANDLED', actions: ['clearTapTimer', 'openDoubleTarget'] },
        longPressTimeout: { next: 'IDLE', actions: ['markLongPress', 'clearTapTimer', 'openYearDayView'] },
      },
      TAP_PENDING: {
        pointerDown: { next: 'PRESSING', actions: ['startLongPressTimer'] },
        click: { next: 'TAP_PENDING', actions: ['startTapTimer'] },
        doubleTap: { next: 'DOUBLE_HANDLED', actions: ['clearTapTimer', 'openDoubleTarget'] },
        tapTimeout: { next: 'IDLE', actions: ['selectPendingDay'] },
        longPressTimeout: { next: 'IDLE', actions: ['markLongPress', 'clearTapTimer', 'openYearDayView'] },
      },
      PRESSING: {
        pointerMove: { next: 'PRESSING', actions: ['cancelLongPressIfMoved'] },
        pointerUp: { next: 'IDLE', actions: ['clearLongPressTimer'] },
        pointerCancel: { next: 'IDLE', actions: ['clearLongPressTimer'] },
        longPressTimeout: { next: 'IDLE', actions: ['markLongPress', 'clearTapTimer', 'openYearDayView'] },
      },
      DOUBLE_HANDLED: {
        click: { next: 'IDLE', actions: ['clearClickSuppressTimer'] },
        pointerDown: { next: 'PRESSING', actions: ['startLongPressTimer'] },
      },
    };

    function isGestureState() {
      return machineState === 'TAP_PENDING' || machineState === 'PRESSING';
    }

    function syncState() {
      if (!isGestureState()) machineState = 'IDLE';
    }

    function contextTime(context) {
      return Number.isFinite(context?.time) ? context.time : eventNow();
    }

    function isSameTap(context, pending) {
      if (!context?.date || !pending?.date) return false;
      if (context.date !== pending.date || context.view !== pending.view) return false;
      const elapsed = contextTime(context) - contextTime(pending);
      const moved = Math.hypot((context.x || 0) - (pending.x || 0), (context.y || 0) - (pending.y || 0));
      return elapsed <= DAY_DOUBLE_TAP_MS && moved <= DAY_DOUBLE_TAP_PX;
    }

    function clearTapTimer() {
      if (pendingTapTimer) window.clearTimeout(pendingTapTimer);
      pendingTapTimer = null;
    }

    function clearTapContext() {
      pendingTapContext = null;
    }

    function startTapTimer(context) {
      clearTapTimer();
      pendingTapContext = context;
      pendingTapTimer = window.setTimeout(() => {
        dispatch('tapTimeout', pendingTapContext);
      }, DAY_DOUBLE_TAP_MS);
    }

    function clearLongPressTimer() {
      if (longPressTimer) window.clearTimeout(longPressTimer);
      longPressTimer = null;
      pressContext = null;
    }

    function startLongPressTimer(context) {
      clearLongPressTimer();
      pressContext = {
        ...context,
        startX: context?.x || 0,
        startY: context?.y || 0,
      };
      longPressTimer = window.setTimeout(() => {
        dispatch('longPressTimeout', pressContext);
      }, DAY_LONG_PRESS_MS);
    }

    function cancelLongPressIfMoved(context) {
      if (!longPressTimer || !pressContext) return;
      const moved = Math.hypot((context?.x || 0) - pressContext.startX, (context?.y || 0) - pressContext.startY);
      if (moved > DAY_MOVE_TOLERANCE_PX) clearLongPressTimer();
    }

    function noteDoubleTap() {
      const now = eventNow();
      if (now - lastDoubleAt < 80) return false;
      lastDoubleAt = now;
      return true;
    }

    function openDoubleTarget(context) {
      const dateText = context?.date;
      if (!dateText) return;
      if (context.view === 'year') openMonth(dateText);
      else if (context.view === 'month') openDiaryWeek(dateText);
    }

    function selectPendingDay(context) {
      if (!context?.date) return;
      selectDay(context.date);
      clearTapContext();
    }

    function openYearDayView(context) {
      if (context?.view !== 'year' || !context?.date) return;
      openDayHubView(context.date);
    }

    function runAction(action, context) {
      if (action === 'startTapTimer') {
        startTapTimer(context);
        return;
      }
      if (action === 'clearTapTimer') {
        clearTapTimer();
        clearTapContext();
        return;
      }
      if (action === 'startLongPressTimer') {
        startLongPressTimer(context);
        return;
      }
      if (action === 'clearLongPressTimer') {
        clearLongPressTimer();
        return;
      }
      if (action === 'cancelLongPressIfMoved') {
        cancelLongPressIfMoved(context);
        return;
      }
      if (action === 'markLongPress') {
        ignoreClicksUntil = eventNow() + 700;
        clearLongPressTimer();
        return;
      }
      if (action === 'clearClickSuppressTimer') {
        ignoreClicksUntil = 0;
        return;
      }
      if (action === 'selectPendingDay') selectPendingDay(context);
      if (action === 'openDoubleTarget') openDoubleTarget(context);
      if (action === 'openYearDayView') openYearDayView(context);
    }

    function eventContext(anchor, event, dateText = '') {
      return {
        anchor,
        date: localDateString(parseLocalDate(dateText || anchor?.dataset?.calendarDate || state.date)),
        view: state.view,
        detail: Number(event?.detail || 0),
        pointerId: event?.pointerId,
        time: eventNow(),
        x: Number.isFinite(event?.clientX) ? event.clientX : 0,
        y: Number.isFinite(event?.clientY) ? event.clientY : 0,
      };
    }

    function dispatch(input, context = {}) {
      if (input === 'click' && eventNow() < ignoreClicksUntil) return machineState;
      if (input === 'click' && (context.detail >= 2 || isSameTap(context, pendingTapContext))) {
        input = 'doubleTap';
      }
      if (input === 'doubleTap' && !noteDoubleTap()) return machineState;
      if (!isGestureState()) syncState();
      const transition = transitions[machineState]?.[input];
      if (!transition) return machineState;
      machineState = transition.next;
      transition.actions.forEach(action => runAction(action, context));
      if (!isGestureState() && machineState !== 'DOUBLE_HANDLED') syncState();
      return machineState;
    }

    return {
      dispatch,
      eventContext,
      getState() {
        if (!isGestureState()) syncState();
        return machineState;
      },
    };
  })();

  const CalendarContentViewMachine = (() => {
    const doubleTapMs = 280;
    const doubleTapPx = 24;
    const longPressMs = 560;
    const moveTolerance = 12;
    let machineState = 'IDLE';
    let pendingTapTimer = null;
    let pendingTapContext = null;
    let longPressTimer = null;
    let pressContext = null;
    let ignoreClicksUntil = 0;
    let lastDoubleAt = 0;
    const transitions = {
      IDLE: {
        pointerDown: { next: 'PRESSING', actions: ['startLongPressTimer'] },
        click: { next: 'TAP_PENDING', actions: ['startTapTimer'] },
        doubleTap: { next: 'MENU_OPEN', actions: ['clearTapTimer', 'openMenu'] },
        longPressTimeout: { next: 'IDLE', actions: ['markLongPress', 'clearTapTimer', 'resetRefresh'] },
      },
      TAP_PENDING: {
        pointerDown: { next: 'PRESSING', actions: ['startLongPressTimer'] },
        click: { next: 'TAP_PENDING', actions: ['startTapTimer'] },
        doubleTap: { next: 'MENU_OPEN', actions: ['clearTapTimer', 'openMenu'] },
        tapTimeout: { next: 'IDLE', actions: ['cycleView', 'clearTapContext'] },
        longPressTimeout: { next: 'IDLE', actions: ['markLongPress', 'clearTapTimer', 'resetRefresh'] },
      },
      PRESSING: {
        pointerMove: { next: 'PRESSING', actions: ['cancelLongPressIfMoved'] },
        pointerUp: { next: 'IDLE', actions: ['clearLongPressTimer'] },
        pointerCancel: { next: 'IDLE', actions: ['clearLongPressTimer'] },
        longPressTimeout: { next: 'IDLE', actions: ['markLongPress', 'clearTapTimer', 'resetRefresh'] },
      },
      MENU_OPEN: {
        pointerDown: { next: 'MENU_PRESSING', actions: ['startLongPressTimer'] },
        click: { next: 'MENU_TAP_PENDING', actions: ['startTapTimer'] },
        doubleTap: { next: 'IDLE', actions: ['clearTapTimer', 'closeMenu'] },
        longPressTimeout: { next: 'IDLE', actions: ['markLongPress', 'clearTapTimer', 'closeMenu', 'resetRefresh'] },
      },
      MENU_TAP_PENDING: {
        pointerDown: { next: 'MENU_PRESSING', actions: ['startLongPressTimer'] },
        click: { next: 'MENU_TAP_PENDING', actions: ['startTapTimer'] },
        doubleTap: { next: 'IDLE', actions: ['clearTapTimer', 'closeMenu'] },
        tapTimeout: { next: 'IDLE', actions: ['closeMenu', 'clearTapContext'] },
        longPressTimeout: { next: 'IDLE', actions: ['markLongPress', 'clearTapTimer', 'closeMenu', 'resetRefresh'] },
      },
      MENU_PRESSING: {
        pointerMove: { next: 'MENU_PRESSING', actions: ['cancelLongPressIfMoved'] },
        pointerUp: { next: 'MENU_OPEN', actions: ['clearLongPressTimer'] },
        pointerCancel: { next: 'MENU_OPEN', actions: ['clearLongPressTimer'] },
        longPressTimeout: { next: 'IDLE', actions: ['markLongPress', 'clearTapTimer', 'closeMenu', 'resetRefresh'] },
      },
    };

    function isGestureState() {
      return machineState === 'TAP_PENDING'
        || machineState === 'PRESSING'
        || machineState === 'MENU_TAP_PENDING'
        || machineState === 'MENU_PRESSING';
    }

    function syncState() {
      machineState = contentViewMenuHost ? 'MENU_OPEN' : 'IDLE';
    }

    function contextTime(context) {
      return Number.isFinite(context?.time) ? context.time : eventNow();
    }

    function isSameTap(context, pending) {
      if (!context?.anchor || !pending?.anchor) return false;
      if (context.anchor !== pending.anchor) return false;
      const elapsed = contextTime(context) - contextTime(pending);
      const moved = Math.hypot((context.x || 0) - (pending.x || 0), (context.y || 0) - (pending.y || 0));
      return elapsed <= doubleTapMs && moved <= doubleTapPx;
    }

    function clearTapTimer() {
      if (pendingTapTimer) window.clearTimeout(pendingTapTimer);
      pendingTapTimer = null;
    }

    function clearTapContext() {
      pendingTapContext = null;
    }

    function startTapTimer(context) {
      clearTapTimer();
      pendingTapContext = context;
      pendingTapTimer = window.setTimeout(() => {
        dispatch('tapTimeout', pendingTapContext);
      }, doubleTapMs);
    }

    function clearLongPressTimer() {
      if (longPressTimer) window.clearTimeout(longPressTimer);
      longPressTimer = null;
      pressContext = null;
    }

    function startLongPressTimer(context) {
      clearLongPressTimer();
      pressContext = {
        ...context,
        startX: context?.x || 0,
        startY: context?.y || 0,
      };
      longPressTimer = window.setTimeout(() => {
        dispatch('longPressTimeout', pressContext);
      }, longPressMs);
    }

    function cancelLongPressIfMoved(context) {
      if (!longPressTimer || !pressContext) return;
      const moved = Math.hypot((context?.x || 0) - pressContext.startX, (context?.y || 0) - pressContext.startY);
      if (moved > moveTolerance) clearLongPressTimer();
    }

    function noteDoubleTap() {
      const now = eventNow();
      if (now - lastDoubleAt < 80) return false;
      lastDoubleAt = now;
      return true;
    }

    function runAction(action, context) {
      const anchor = context?.anchor;
      if (action === 'startTapTimer') {
        startTapTimer(context);
        return;
      }
      if (action === 'clearTapTimer') {
        clearTapTimer();
        clearTapContext();
        return;
      }
      if (action === 'clearTapContext') {
        clearTapContext();
        return;
      }
      if (action === 'startLongPressTimer') {
        startLongPressTimer(context);
        return;
      }
      if (action === 'clearLongPressTimer') {
        clearLongPressTimer();
        return;
      }
      if (action === 'cancelLongPressIfMoved') {
        cancelLongPressIfMoved(context);
        return;
      }
      if (action === 'markLongPress') {
        ignoreClicksUntil = eventNow() + 700;
        clearLongPressTimer();
        return;
      }
      if (action === 'cycleView') cycleContentView();
      if (action === 'openMenu') openContentViewMenu(anchor);
      if (action === 'closeMenu') closeContentViewMenu();
      if (action === 'resetRefresh') resetContentViewAndRefresh();
    }

    function gestureContext(anchor, event) {
      return {
        anchor,
        detail: Number(event?.detail || 0),
        time: eventNow(),
        x: Number.isFinite(event?.clientX) ? event.clientX : 0,
        y: Number.isFinite(event?.clientY) ? event.clientY : 0,
      };
    }

    function dispatch(input, context = {}) {
      if (input === 'click' && eventNow() < ignoreClicksUntil) return machineState;
      if (input === 'click' && (context.detail >= 2 || isSameTap(context, pendingTapContext))) {
        input = 'doubleTap';
      }
      if (input === 'doubleTap' && !noteDoubleTap()) return machineState;
      if (!isGestureState()) syncState();
      const transition = transitions[machineState]?.[input];
      if (!transition) return machineState;
      machineState = transition.next;
      transition.actions.forEach(action => runAction(action, context));
      if (!isGestureState()) syncState();
      return machineState;
    }

    return {
      dispatch,
      eventContext: gestureContext,
      getState() {
        if (!isGestureState()) syncState();
        return machineState;
      },
    };
  })();

  function bindContentViewTrigger(btn) {
    if (!btn || btn.dataset.calendarViewTriggerBound === '1') return;
    btn.dataset.calendarViewTriggerBound = '1';

    btn.addEventListener('pointerdown', event => {
      if (event.button !== undefined && event.button !== 0) return;
      CalendarContentViewMachine.dispatch('pointerDown', CalendarContentViewMachine.eventContext(btn, event));
    });

    btn.addEventListener('pointermove', event => {
      CalendarContentViewMachine.dispatch('pointerMove', CalendarContentViewMachine.eventContext(btn, event));
    });

    ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => {
      btn.addEventListener(type, event => {
        CalendarContentViewMachine.dispatch(type === 'pointerup' ? 'pointerUp' : 'pointerCancel', CalendarContentViewMachine.eventContext(btn, event));
      });
    });

    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      CalendarContentViewMachine.dispatch('click', CalendarContentViewMachine.eventContext(btn, event));
    });

    btn.addEventListener('dblclick', event => {
      event.preventDefault();
      event.stopPropagation();
      CalendarContentViewMachine.dispatch('doubleTap', CalendarContentViewMachine.eventContext(btn, event));
    });
  }

  function bind() {
    const root = document.querySelector('[data-calendar-page]');
    if (!root || root.dataset.calendarBound === '1') return;
    root.dataset.calendarBound = '1';
    if (window.PersonalFilters?.registerSurface) {
      window.PersonalFilters.registerSurface('calendar', {
        getRecords: () => state.data?.items || [],
        extraTabs: [
          { id: 'selected', label: 'Selected' },
          { id: 'milestones', label: 'Day' },
          { id: 'search', label: 'Search' },
          { id: 'new-event', label: 'New Event' },
          { id: 'upcoming', label: 'Upcoming' },
          { id: 'provenance', label: 'Provenance' },
        ],
        renderTab: (tab, host) => {
          if (tab === 'selected') return embeddedSelectedHtml(host);
          if (tab === 'milestones') return embeddedMilestonesHtml(host);
          if (tab === 'search') return embeddedSearchHtml(host);
          if (tab === 'new-event') return embeddedEventFormHtml(embeddedEventPrefixForHost(host));
          if (tab === 'upcoming') return embeddedUpcomingHtml(host);
          if (tab === 'provenance') return embeddedProvenanceHtml(host);
          return '';
        },
        onChange: () => {
          syncSharedFilterState();
          state.selection = null;
          render();
        },
      });
      window.PersonalFilters.registerSurface(EVENT_TAG_SURFACE, {
        getRecords: () => state.data?.items || [],
        defaultSelectedIds: EVENT_REQUIRED_TAGS,
        requiredSelectedIds: EVENT_REQUIRED_TAGS,
        summaryPrefix: 'Tags:',
        activePrefix: 'Selected',
        emptyLabel: 'Calendar',
        showClear: false,
        onChange: () => {
          renderEventTagSummaries();
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
      window.BlueprintsPersonalSearch.registerSurface('calendar', {
        filterSurface: SEARCH_TAG_SURFACE,
        rangeControls: true,
        getRange: searchDefaultRange,
      });
    }
    syncCreateDate();
    renderEventTagSummaries();
    window.addEventListener('personal-filters:registry', () => {
      if (window.PersonalFilters?.invalidateSurface) {
        window.PersonalFilters.invalidateSurface('calendar');
        window.PersonalFilters.invalidateSurface(EVENT_TAG_SURFACE);
        window.PersonalFilters.invalidateSurface(SEARCH_TAG_SURFACE);
      }
      render();
    });
    root.addEventListener('pointerdown', event => {
      const btn = event.target.closest('[data-calendar-action="select-day"][data-calendar-date]');
      if (btn && (event.button === undefined || event.button === 0)) {
        try {
          if (Number.isFinite(event.pointerId) && typeof btn.setPointerCapture === 'function') btn.setPointerCapture(event.pointerId);
        } catch (_) {}
        CalendarDayGestureMachine.dispatch('pointerDown', CalendarDayGestureMachine.eventContext(btn, event));
      }
      beginDateRangeDrag(event);
    });
    root.addEventListener('pointermove', event => {
      const btn = event.target.closest('[data-calendar-action="select-day"][data-calendar-date]');
      if (!btn) return;
      CalendarDayGestureMachine.dispatch('pointerMove', CalendarDayGestureMachine.eventContext(btn, event));
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => {
      root.addEventListener(type, event => {
        const btn = event.target.closest('[data-calendar-action="select-day"][data-calendar-date]');
        if (!btn) return;
        CalendarDayGestureMachine.dispatch(type === 'pointerup' ? 'pointerUp' : 'pointerCancel', CalendarDayGestureMachine.eventContext(btn, event));
      });
    });
    root.addEventListener('click', event => {
      const todoLink = event.target.closest('[data-personal-todo-link]');
      if (todoLink) {
        event.preventDefault();
        event.stopPropagation();
        openTodoLink(todoLink.dataset.personalTodoLink);
        return;
      }
      const selectable = event.target.closest('[data-calendar-select-type]');
      if (selectable) {
        if (handleSelectableEventActivation(selectable, event)) return;
        setSelection(selectable.dataset.calendarSelectType, selectable.dataset.calendarSelectIndex);
      }
      const btn = event.target.closest('[data-calendar-action]');
      if (!btn) return;
      const action = btn.dataset.calendarAction;
      if (action === 'previous') previous();
      if (action === 'today') today();
      if (action === 'next') next();
      if (action === 'refresh') load({ force: true });
      if (action === 'generate-day-summary') generateDaySummary();
      if (action === 'view-year') setView('year');
      if (action === 'view-month') setView('month');
      if (action === 'mode-day') setMode('day');
      if (action === 'mode-week') setMode('week');
      if (action === 'select-day') {
        if (shouldSuppressSelectDayInteraction(event)) return;
        event.preventDefault();
        CalendarDayGestureMachine.dispatch('click', CalendarDayGestureMachine.eventContext(btn, event));
        return;
      }
      if (action === 'open-month') openMonth(btn.dataset.calendarDate);
      if (action === 'toggle-markdown-preview') toggleMarkdownPreview(btn, root);
      if (action === 'submit-event') submitEvent(btn.dataset.calendarEventPrefix || 'calendar-event');
    });
    root.addEventListener('dblclick', event => {
      const btn = event.target.closest('[data-calendar-action="select-day"][data-calendar-date]');
      if (!btn) return;
      if (shouldSuppressSelectDayInteraction(event)) return;
      event.preventDefault();
      CalendarDayGestureMachine.dispatch('doubleTap', CalendarDayGestureMachine.eventContext(btn, event));
    });
	    document.addEventListener('click', event => {
	      const btn = event.target.closest('[data-calendar-action="submit-event"]');
	      if (!btn || root.contains(btn)) return;
	      event.preventDefault();
	      submitEvent(btn.dataset.calendarEventPrefix || 'calendar-event');
	    });
	    document.addEventListener('click', event => {
	      const btn = event.target.closest('[data-calendar-action="toggle-markdown-preview"]');
	      if (!btn || root.contains(btn)) return;
	      event.preventDefault();
		      toggleMarkdownPreview(btn, document);
	    });
	    document.addEventListener('change', event => {
      const dateControl = event.target.closest('[data-calendar-event-date]');
      if (dateControl) {
        const prefix = dateControl.id.replace(/-date$/, '');
        const endDate = el(`${prefix}-end-date`);
        if (endDate && (!endDate.value || endDate.value < dateControl.value)) endDate.value = dateControl.value;
      }
      const upcomingControl = event.target.closest('[data-calendar-upcoming-next-years]');
      if (upcomingControl) {
        setUpcomingWide(upcomingControl.checked);
        return;
      }
      const control = event.target.closest('[data-calendar-event-all-day]');
      if (!control) return;
      setAllDayControls(control.dataset.calendarEventAllDay || 'calendar-event');
    });
    root.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const selectable = event.target.closest('[data-calendar-select-type]');
      if (!selectable) return;
      event.preventDefault();
      setSelection(selectable.dataset.calendarSelectType, selectable.dataset.calendarSelectIndex);
    });
    const dateInput = el('calendar-date-input');
    if (dateInput) {
      dateInput.value = state.date;
      dateInput.addEventListener('change', event => {
        if (event.target.value) setDate(event.target.value);
      });
    }
    const yearStart = el('calendar-year-start');
    if (yearStart) {
      yearStart.value = String(state.yearStartMonth);
      yearStart.addEventListener('change', event => setYearStartMonth(event.target.value));
    }
    const eventDate = el('calendar-event-date');
    if (eventDate) eventDate.value = eventDefaultStartDate();
    const eventEndDate = el('calendar-event-end-date');
    if (eventEndDate) eventEndDate.value = eventDefaultEndDate();
    const allDay = el('calendar-event-all-day');
    if (allDay) allDay.addEventListener('change', () => setAllDayControls('calendar-event'));
    document.querySelectorAll('[data-calendar-view-trigger]').forEach(bindContentViewTrigger);
	    ['calendar-action-modal-close', 'calendar-action-modal-footer-close'].forEach(id => {
	      const btn = el(id);
	      if (btn) btn.addEventListener('click', closeActionModal);
	    });
	    const modalTools = el('calendar-action-modal-tools');
	    if (modalTools) {
	      modalTools.addEventListener('click', event => {
	        const btn = event.target.closest('[data-calendar-modal-action]');
	        if (!btn) return;
	        event.preventDefault();
	        event.stopPropagation();
	        if (btn.dataset.calendarModalAction === 'edit-event-content') openSelectedEventContentEditor();
	      });
	    }
	    const modalBody = el('calendar-action-modal-body');
	    if (modalBody) {
	      modalBody.addEventListener('click', event => {
        const todoLink = event.target.closest('[data-personal-todo-link]');
        if (todoLink) {
          event.preventDefault();
          event.stopPropagation();
          openTodoLink(todoLink.dataset.personalTodoLink);
          return;
        }
        const summaryBtn = event.target.closest('[data-calendar-action="generate-day-summary"]');
        if (summaryBtn) {
          generateDaySummary();
          return;
        }
	        const btn = event.target.closest('[data-calendar-modal-action]');
	        if (!btn) return;
	        if (btn.dataset.calendarModalAction === 'submit-edit') submitEdit();
	        if (btn.dataset.calendarModalAction === 'delete-event') deleteSelectedEvent();
		        if (btn.dataset.calendarModalAction === 'submit-kanban-link') submitKanbanLink();
		        if (btn.dataset.calendarModalAction === 'edit-event-content') openSelectedEventContentEditor();
		        if (btn.dataset.calendarModalAction === 'save-event-content') saveSelectedEventContent();
		        if (btn.dataset.calendarModalAction === 'toggle-markdown-preview') toggleMarkdownPreview(btn, modalBody);
		        if (btn.dataset.calendarModalAction === 'toggle-event-content-preview') toggleEventContentPreview(btn);
	      });
      modalBody.addEventListener('change', event => {
        if (event.target?.id === 'calendar-edit-all-day') setAllDayControls('calendar-edit');
      });
    }
    setAllDayControls('calendar-event');
  }

  function snapshot() {
    const items = state.data?.items || [];
    return {
      loaded: state.loaded,
      loading: state.loading,
      status: state.error ? 'error' : (state.loaded ? 'ready' : ''),
      local_date: state.date,
      range_start: rangeStart(),
      range_end: rangeEnd(),
      range_label: rangeLabel(),
      view: state.view,
      content_view: state.contentView,
      content_view_label: contentViewLabel(),
      mode: state.mode,
      selected_range_start: hasManualRange() ? state.manualRangeStart : '',
      selected_range_end: hasManualRange() ? state.manualRangeEnd : '',
      year_start_month: state.yearStartMonth,
      source_filter: state.sourceFilter,
      selected_filters: window.PersonalFilters?.getSelectedIds ? window.PersonalFilters.getSelectedIds('calendar') : [],
      new_event_tags: eventTagIds(),
      upcoming_next_years: state.upcomingWide,
      upcoming_loading: state.upcomingWideLoading,
      upcoming_error: state.upcomingWideError,
      upcoming_count: groupEvents().upcoming.length,
      event_count: visibleEvents().length,
      total_count: items.length,
      manual_calendar_count: items.filter(isCalendarEvent).length,
      selection_type: state.selection?.type || '',
      selection_label: state.selection?.label || '',
      last_write_event_id: state.lastWrite?.event?.event_id || '',
      error: state.error,
    };
  }

  bind();

  return {
    load,
    refresh: () => load({ force: true }),
    setDate,
    previous,
    next,
    today,
    viewYear: () => setView('year'),
    viewMonth: () => setView('month'),
    toggleContentView: cycleContentView,
    setContentView,
    showContentView: openContentViewModal,
    showFilters: () => openFilterModal('filters'),
    showFilterSettings: () => openFilterModal('settings'),
    showSelected: () => openContentViewModal('selected'),
    showMilestones: () => openContentViewModal('milestones'),
    showSearch: () => openContentViewModal('search'),
    showUpcoming: () => openContentViewModal('upcoming'),
    showProvenance: () => openContentViewModal('provenance'),
    modeDay: () => setMode('day'),
    modeWeek: () => setMode('week'),
    filterAll: () => setSourceFilter('all'),
    filterCalendar: () => setSourceFilter('calendar'),
    filterTasks: () => setSourceFilter('tasks'),
    filterKanban: () => setSourceFilter('kanban'),
    filterImports: () => setSourceFilter('imports'),
    filterSources: () => setSourceFilter('sources'),
    filterGit: () => setSourceFilter('git'),
    newEvent: () => openContentViewModal('new-event'),
    submitEvent,
    editSelected,
    openSource,
    linkDiary,
    createTask,
    linkKanbanItem,
    explainSelection,
    safeChecks,
    snapshot,
  };
})();

window.BlueprintsCalendarPage = CalendarPage;

if (typeof DaveMenuConfig !== 'undefined') {
  DaveMenuConfig.registerFunctions({
    'calendar.refresh': () => CalendarPage.refresh(),
    'calendar.toggleContentView': () => CalendarPage.toggleContentView(),
    'calendar.showFilters': () => CalendarPage.showFilters(),
    'calendar.showFilterSettings': () => CalendarPage.showFilterSettings(),
    'calendar.showSelected': () => CalendarPage.showSelected(),
    'calendar.showMilestones': () => CalendarPage.showMilestones(),
    'calendar.showSearch': () => CalendarPage.showSearch(),
    'calendar.showUpcoming': () => CalendarPage.showUpcoming(),
    'calendar.showProvenance': () => CalendarPage.showProvenance(),
    'calendar.previous': () => CalendarPage.previous(),
    'calendar.next': () => CalendarPage.next(),
    'calendar.today': () => CalendarPage.today(),
    'calendar.viewYear': () => CalendarPage.viewYear(),
    'calendar.viewMonth': () => CalendarPage.viewMonth(),
    'calendar.modeDay': () => CalendarPage.modeDay(),
    'calendar.modeWeek': () => CalendarPage.modeWeek(),
    'calendar.filterAll': () => CalendarPage.filterAll(),
    'calendar.filterCalendar': () => CalendarPage.filterCalendar(),
    'calendar.filterTasks': () => CalendarPage.filterTasks(),
    'calendar.filterKanban': () => CalendarPage.filterKanban(),
    'calendar.filterImports': () => CalendarPage.filterImports(),
    'calendar.filterSources': () => CalendarPage.filterSources(),
    'calendar.filterGit': () => CalendarPage.filterGit(),
    'calendar.newEvent': () => CalendarPage.newEvent(),
    'calendar.editSelected': () => CalendarPage.editSelected(),
    'calendar.openSource': () => CalendarPage.openSource(),
    'calendar.linkDiary': () => CalendarPage.linkDiary(),
    'calendar.createTask': () => CalendarPage.createTask(),
    'calendar.linkKanbanItem': () => CalendarPage.linkKanbanItem(),
    'calendar.explainSelection': () => CalendarPage.explainSelection(),
    'calendar.safeChecks': () => CalendarPage.safeChecks(),
  });
}
