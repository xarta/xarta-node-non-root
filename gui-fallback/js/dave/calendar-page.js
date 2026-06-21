// Dave Calendar page - year/month calendar over shared personal_events.

'use strict';

const CalendarPage = (() => {
  const YEAR_START_STORAGE_KEY = 'blueprints.calendar.yearStartMonth';
  const VIEW_STORAGE_KEY = 'blueprints.calendar.view';
  const CONTENT_VIEW_STORAGE_KEY = 'blueprints.calendar.contentView';
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
    { id: 'selected', label: 'Selected Range Visible Items' },
    { id: 'milestones', label: 'All-Day And Milestones' },
    { id: 'search', label: 'Search And Review' },
    { id: 'new-event', label: 'New Calendar Event' },
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'provenance', label: 'Provenance' },
  ];
  const CONTENT_VIEW_IDS = CONTENT_VIEWS.map(view => view.id);

  const state = {
    loaded: false,
    loading: false,
    data: null,
    error: '',
    date: localDateString(new Date()),
    view: readStoredView(),
    contentView: readStoredContentView(),
    mode: 'day',
    yearStartMonth: readStoredYearStartMonth(),
    sourceFilter: 'all',
    selection: null,
    lastWrite: null,
  };

  let contentViewMenuHost = null;
  let contentViewMenuPointerHandler = null;
  let contentViewMenuKeyHandler = null;
  let contentViewMenuFitHandler = null;

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

  function readStoredContentView() {
    try {
      return normalizeContentView(localStorage.getItem(CONTENT_VIEW_STORAGE_KEY));
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

  function detailRangeStart() {
    if (state.mode === 'week') return localDateString(startOfWeek(parseLocalDate(state.date)));
    return state.date;
  }

  function detailRangeEnd() {
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
    if (state.mode === 'week') {
      return `${monthLabel(detailRangeStart(), { day: '2-digit', month: 'short', year: 'numeric' })} to ${monthLabel(detailRangeEnd(), { day: '2-digit', month: 'short', year: 'numeric' })}`;
    }
    return monthLabel(state.date, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  }

  function filterLabel(value) {
    if (value === 'calendar') return 'calendar';
    if (value === 'tasks') return 'tasks and reminders';
    if (value === 'work') return 'work';
    if (value === 'imports') return 'imports';
    if (value === 'sources') return 'source imports';
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

  function isCalendarEvent(event) {
    const tags = eventTags(event);
    return sourceType(event) === 'manual-calendar' || tags.includes('calendar');
  }

  function isTaskLike(event) {
    const kind = String(event?.kind || '').toLowerCase();
    const relatedTasks = event?.related?.tasks || [];
    return ['todo', 'task', 'reminder'].includes(kind) || relatedTasks.length > 0;
  }

  function isWorkLike(event) {
    const relatedWork = event?.related?.work_items || [];
    return sourceType(event) === 'work-management' || relatedWork.length > 0;
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
    if (isWorkLike(event)) return 'work';
    if (isImportLike(event)) return 'import';
    if (isCalendarEvent(event)) return 'calendar';
    return 'source';
  }

  function matchesFilter(event) {
    if (state.sourceFilter === 'calendar') return isCalendarEvent(event);
    if (state.sourceFilter === 'tasks') return isTaskLike(event);
    if (state.sourceFilter === 'work') return isWorkLike(event);
    if (state.sourceFilter === 'imports') return isImportLike(event);
    if (state.sourceFilter === 'sources') return !isCalendarEvent(event);
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
    const upcoming = visibleEvents()
      .filter(event => eventStartDate(event) >= state.date)
      .sort(compareEvents)
      .slice(0, 16);
    return { timed, allDay, upcoming };
  }

  function dayClass(dateText, currentMonth) {
    const classes = ['calendar-day'];
    const date = parseLocalDate(dateText);
    if (date.getMonth() !== currentMonth) classes.push('calendar-day--outside');
    if (dateText === localDateString(new Date())) classes.push('calendar-day--today');
    if (dateText === state.date) classes.push('calendar-day--selected');
    return classes.join(' ');
  }

  function dayEventSummary(events, compact = false) {
    if (!events.length) return '';
    const categories = Array.from(new Set(events.map(eventCategory))).slice(0, 4);
    const bars = categories.map(category => `<span class="calendar-event-dot calendar-event-dot--${escHtml(category)}"></span>`).join('');
    if (compact) {
      return `<span class="calendar-day-count">${events.length}</span><span class="calendar-event-dots">${bars}</span>`;
    }
    const chips = events.slice(0, 3).map(event => `
      <span class="calendar-event-chip calendar-event-chip--${escHtml(eventCategory(event))}">${escHtml(event.title || event.kind || 'Event')}</span>
    `).join('');
    const more = events.length > 3 ? `<span class="calendar-event-more">+${events.length - 3}</span>` : '';
    return `<span class="calendar-event-dots">${bars}</span><span class="calendar-event-stack">${chips}${more}</span>`;
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
      return `
        <button class="${dayClass(dateText, month)} calendar-mini-day" type="button"
                data-calendar-action="select-day" data-calendar-date="${escHtml(dateText)}"
                aria-label="${escHtml(monthLabel(dateText, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }))}">
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
      return `
        <button class="${dayClass(dateText, currentMonth)} calendar-month-day" type="button"
                data-calendar-action="select-day" data-calendar-date="${escHtml(dateText)}"
                aria-label="${escHtml(monthLabel(dateText, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }))}">
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
    root.innerHTML = state.view === 'year' ? renderYearView() : renderMonthView();
  }

  function renderRefreshState() {
    document.querySelectorAll('[data-calendar-action="refresh"], [data-calendar-view-trigger]').forEach(btn => {
      btn.classList.toggle('is-refreshing', Boolean(state.loading));
      btn.setAttribute('aria-busy', state.loading ? 'true' : 'false');
    });
  }

  function renderContentPanels() {
    document.querySelectorAll('[data-calendar-content-view]').forEach(panel => {
      panel.hidden = panel.dataset.calendarContentView !== state.contentView;
    });
  }

  function renderContentViewTrigger() {
    document.querySelectorAll('[data-calendar-view-trigger]').forEach(btn => {
      const label = contentViewLabel();
      btn.dataset.calendarContentView = state.contentView;
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
    const meta = el('calendar-meta');
    if (meta) {
      const count = visibleEvents().length;
      const content = state.contentView === 'calendar' ? '' : ` - ${contentViewLabel()}`;
      meta.textContent = `${rangeLabel()} - ${state.view} view${content} - ${count} visible event${count === 1 ? '' : 's'}`;
    }
    const dateInput = el('calendar-date-input');
    if (dateInput) dateInput.value = state.date;
    const eventDate = el('calendar-event-date');
    if (eventDate && !eventDate.value) eventDate.value = state.date;
    const yearStart = el('calendar-year-start');
    if (yearStart) yearStart.value = String(state.yearStartMonth);
    const filter = el('calendar-filter-strip');
    if (filter) {
      const selected = state.selection ? ` - selected ${state.selection.label}` : '';
      filter.textContent = `Filter: ${filterLabel(state.sourceFilter)}${selected}`;
    }
    document.querySelectorAll('[data-calendar-view-button]').forEach(btn => {
      btn.dataset.active = btn.dataset.calendarViewButton === state.view ? 'true' : 'false';
    });
    document.querySelectorAll('[data-calendar-mode-button]').forEach(btn => {
      btn.dataset.active = btn.dataset.calendarModeButton === state.mode ? 'true' : 'false';
    });
    renderContentPanels();
    renderContentViewTrigger();
  }

  function eventRow(event, index, type) {
    const source = sourceType(event) || event.kind || 'source';
    const datePart = state.mode === 'week' ? `${monthLabel(eventStartDate(event), { weekday: 'short', day: '2-digit', month: 'short' })} - ` : '';
    const ref = event.source?.ref || (Array.isArray(event.file_refs) ? event.file_refs[0] : '') || event.event_id || '';
    return `
      <div class="calendar-agenda-row calendar-agenda-row--${escHtml(eventCategory(event))}" ${selectionAttrs(type, index)}>
        <div class="calendar-agenda-time">${escHtml(eventTime(event))}</div>
        <div class="calendar-agenda-main">
          <div class="calendar-agenda-title">${escHtml(event.title || event.kind || event.event_id)}</div>
          <div class="calendar-agenda-meta">${escHtml(datePart + (event.body_excerpt || event.status || ''))}</div>
          <div class="calendar-agenda-meta">${escHtml(ref)}</div>
        </div>
        <span class="calendar-agenda-source">${escHtml(source)}</span>
      </div>
    `;
  }

  function renderList(id, rows, type, empty) {
    const target = el(id);
    if (!target) return;
    target.innerHTML = rows.length
      ? rows.map((event, index) => eventRow(event, index, type)).join('')
      : `<div class="calendar-empty">${escHtml(empty)}</div>`;
  }

  function renderSelectedSummary(rows) {
    const target = el('calendar-selected-summary');
    if (!target) return;
    const total = rows.timed.length + rows.allDay.length;
    target.innerHTML = `
      <div class="calendar-selected-summary__date">${escHtml(detailRangeLabel())}</div>
      <div class="calendar-selected-summary__meta">${escHtml(`${total} visible item${total === 1 ? '' : 's'} - ${filterLabel(state.sourceFilter)}`)}</div>
    `;
  }

  function renderAgenda() {
    const rows = groupEvents();
    const selectedRows = rows.timed.concat(rows.allDay).sort(compareEvents);
    const count = el('calendar-agenda-count');
    if (count) count.textContent = String(selectedRows.length);
    renderSelectedSummary(rows);
    renderList('calendar-agenda-list', selectedRows, 'selected', 'No visible items for this range.');
    renderList('calendar-all-day-list', rows.allDay, 'all-day', 'No all-day items or milestones for this range.');
    renderList('calendar-upcoming-list', rows.upcoming, 'upcoming', 'No upcoming items for this range.');
  }

  function renderProvenance() {
    const target = el('calendar-provenance');
    if (!target) return;
    const params = new URLSearchParams({
      date_start: rangeStart(),
      date_end: rangeEnd(),
      limit: '200',
    });
    const rows = [
      ['Events API', `/api/v1/personal/events?${params.toString()}`, 'shared read path'],
      ['Write API', '/api/v1/personal/calendar/events', 'manual-calendar source'],
      ['Calendar range', `${state.view} / ${rangeLabel()}`, `year starts ${MONTH_NAMES[state.yearStartMonth]}`],
      ['Selected range', detailRangeLabel(), `${state.mode} detail`],
      ['Legacy page id', 'tab-calender', 'calendar route alias maps here'],
      ['Mode/filter', `${state.mode} / ${state.sourceFilter}`, 'client projection'],
    ];
    target.innerHTML = rows.map(([title, path, meta]) => `
      <div class="calendar-provenance-row">
        <div class="calendar-provenance-main">
          <div class="calendar-provenance-title">${escHtml(title)}</div>
          <div class="calendar-provenance-meta">${escHtml(path)}</div>
          <div class="calendar-provenance-meta">${escHtml(meta)}</div>
        </div>
      </div>
    `).join('');
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
      state.loaded = true;
      return data;
    } catch (error) {
      state.error = error.message || String(error);
      return null;
    } finally {
      state.loading = false;
      render();
    }
  }

  function setDate(dateText) {
    state.date = localDateString(parseLocalDate(dateText));
    state.loaded = false;
    state.selection = null;
    syncCreateDate();
    return load({ force: true });
  }

  function selectDay(dateText, drillDown = false) {
    state.date = localDateString(parseLocalDate(dateText));
    state.selection = null;
    syncCreateDate();
    if (drillDown || state.view === 'year') {
      state.view = 'month';
      state.contentView = 'calendar';
      writeStoredValue(VIEW_STORAGE_KEY, state.view);
      writeStoredValue(CONTENT_VIEW_STORAGE_KEY, state.contentView);
      state.loaded = false;
      return load({ force: true });
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
    syncCreateDate();
    writeStoredValue(VIEW_STORAGE_KEY, state.view);
    writeStoredValue(CONTENT_VIEW_STORAGE_KEY, state.contentView);
    return load({ force: true });
  }

  function setView(view) {
    state.view = view === 'month' ? 'month' : 'year';
    state.contentView = 'calendar';
    state.loaded = false;
    state.selection = null;
    writeStoredValue(VIEW_STORAGE_KEY, state.view);
    writeStoredValue(CONTENT_VIEW_STORAGE_KEY, state.contentView);
    return load({ force: true });
  }

  function setMode(mode) {
    state.mode = mode === 'week' ? 'week' : 'day';
    state.selection = null;
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
    state.sourceFilter = ['all', 'calendar', 'tasks', 'work', 'imports', 'sources'].includes(filter) ? filter : 'all';
    state.selection = null;
    render();
    return state.sourceFilter;
  }

  function setContentView(view) {
    state.contentView = normalizeContentView(view);
    writeStoredValue(CONTENT_VIEW_STORAGE_KEY, state.contentView);
    closeContentViewMenu();
    render();
    return state.contentView;
  }

  function cycleContentView() {
    const current = Math.max(0, CONTENT_VIEW_IDS.indexOf(state.contentView));
    return setContentView(CONTENT_VIEW_IDS[(current + 1) % CONTENT_VIEW_IDS.length]);
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
        setContentView(view.id);
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
    syncCreateDate();
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
    syncCreateDate();
    return load({ force: true });
  }

  function today() {
    return setDate(localDateString(new Date()));
  }

  function syncCreateDate() {
    const eventDate = el('calendar-event-date');
    if (eventDate) eventDate.value = state.date;
  }

  function closeActionModal() {
    const modal = el('calendar-action-modal');
    if (!modal) return;
    if (typeof HubModal !== 'undefined') HubModal.close(modal);
    else if (typeof modal.close === 'function') modal.close();
  }

  function showActionModal(title, html, status = '') {
    const modal = el('calendar-action-modal');
    const titleEl = el('calendar-action-modal-title');
    const body = el('calendar-action-modal-body');
    const statusEl = el('calendar-action-modal-status');
    if (!modal || !body) return false;
    if (titleEl) titleEl.textContent = title;
    body.innerHTML = html;
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

  function eventPayloadFromForm(prefix = 'calendar-event') {
    const allDay = !!el(`${prefix}-all-day`)?.checked;
    return {
      title: String(el(`${prefix}-title`)?.value || '').trim(),
      body: String(el(`${prefix}-body`)?.value || '').trim(),
      local_date: String(el(`${prefix}-date`)?.value || state.date).trim(),
      start_time: allDay ? null : String(el(`${prefix}-start`)?.value || '').trim() || null,
      end_time: allDay ? null : String(el(`${prefix}-end`)?.value || '').trim() || null,
      all_day: allDay,
      actor: 'blueprints-ui',
      source_surface: 'calendar-page',
      request_id: `ui-calendar-${Date.now()}`,
    };
  }

  function setAllDayControls(prefix = 'calendar-event') {
    const allDay = !!el(`${prefix}-all-day`)?.checked;
    ['start', 'end'].forEach(key => {
      const input = el(`${prefix}-${key}`);
      if (input) input.disabled = allDay;
    });
  }

  async function submitEvent() {
    const status = el('calendar-entry-status');
    const payload = eventPayloadFromForm('calendar-event');
    if (!payload.title) {
      if (status) status.textContent = 'Event title is required.';
      return false;
    }
    if (status) status.textContent = 'Saving event...';
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const resp = await fetcher('/api/v1/personal/calendar/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      if (status) status.textContent = responseErrorMessage(data, resp.status);
      return false;
    }
    ['title', 'body', 'start', 'end'].forEach(key => {
      const field = el(`calendar-event-${key}`);
      if (field) field.value = '';
    });
    if (status) status.textContent = `Saved ${data.event?.event_id || ''}`;
    state.lastWrite = data;
    state.date = data.event?.local_date || payload.local_date || state.date;
    state.view = 'month';
    state.contentView = 'calendar';
    state.loaded = false;
    writeStoredValue(VIEW_STORAGE_KEY, state.view);
    writeStoredValue(CONTENT_VIEW_STORAGE_KEY, state.contentView);
    await load({ force: true });
    return true;
  }

  function editSelected() {
    const event = state.selection?.row;
    if (!event) {
      return showActionModal('Edit Calendar Event', '<p>Select a Calendar event before editing.</p>');
    }
    if (sourceType(event) !== 'manual-calendar') {
      return showActionModal('Edit Calendar Event', kvHtml([
        ['Event', event.event_id || ''],
        ['Source', sourceType(event) || ''],
        ['State', 'source-owned'],
      ]));
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
        <label class="calendar-field calendar-field--wide calendar-field--notes" for="calendar-edit-body">
          <span>Notes</span>
          <textarea id="calendar-edit-body" rows="2" maxlength="2000">${escHtml(event.content_projection || event.body_excerpt || '')}</textarea>
        </label>
      </div>
      <button class="calendar-command-btn" type="button" data-calendar-modal-action="submit-edit">Save Edit</button>
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
    if (typeof switchGroup === 'function') switchGroup('dave');
    if (typeof switchTab === 'function') switchTab('diary');
    if (typeof DaveMenuConfig !== 'undefined') DaveMenuConfig.updateActiveTab('diary');
    if (window.BlueprintsDiaryPage?.setDate) window.BlueprintsDiaryPage.setDate(targetDate);
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

  async function linkWorkItem() {
    const event = state.selection?.row;
    if (!event) {
      return showActionModal('Link Work', '<p>Select a calendar row before linking a work item.</p>');
    }
    return showActionModal('Link Work', `${kvHtml([
      ['Event', event.event_id || ''],
      ['Current links', (event.related?.work_items || []).join(', ') || 'none'],
    ])}
      <label class="calendar-field" for="calendar-work-link-input">
        <span>Work ref</span>
        <input id="calendar-work-link-input" type="text" autocomplete="off" />
      </label>
      <button class="calendar-command-btn" type="button" data-calendar-modal-action="submit-work-link">Link Work</button>`);
  }

  async function submitWorkLink() {
    const event = state.selection?.row;
    const input = el('calendar-work-link-input');
    const workRef = String(input?.value || '').trim();
    if (!event?.event_id || !workRef) return false;
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const resp = await fetcher(`/api/v1/personal/events/${encodeURIComponent(event.event_id)}/work-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        work_item_ref: workRef,
        actor: 'blueprints-ui',
        source_surface: 'calendar-page',
        request_id: `ui-calendar-work-link-${Date.now()}`,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      showActionModal('Link Work', `<p>${escHtml(responseErrorMessage(data, resp.status))}</p>`);
      return false;
    }
    await load({ force: true });
    return showActionModal('Link Work', kvHtml([
      ['Event', data.event?.event_id || event.event_id],
      ['Work ref', workRef],
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

  const CalendarContentViewMachine = (() => {
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
      getState() {
        syncState();
        return machineState;
      },
    };
  })();

  function bindContentViewTrigger(btn) {
    if (!btn || btn.dataset.calendarViewTriggerBound === '1') return;
    btn.dataset.calendarViewTriggerBound = '1';
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
      CalendarContentViewMachine.dispatch(input, btn);
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
    const root = document.querySelector('[data-calendar-page]');
    if (!root || root.dataset.calendarBound === '1') return;
    root.dataset.calendarBound = '1';
    syncCreateDate();
    root.addEventListener('click', event => {
      const selectable = event.target.closest('[data-calendar-select-type]');
      if (selectable) {
        setSelection(selectable.dataset.calendarSelectType, selectable.dataset.calendarSelectIndex);
      }
      const btn = event.target.closest('[data-calendar-action]');
      if (!btn) return;
      const action = btn.dataset.calendarAction;
      if (action === 'previous') previous();
      if (action === 'today') today();
      if (action === 'next') next();
      if (action === 'refresh') load({ force: true });
      if (action === 'view-year') setView('year');
      if (action === 'view-month') setView('month');
      if (action === 'mode-day') setMode('day');
      if (action === 'mode-week') setMode('week');
      if (action === 'select-day') selectDay(btn.dataset.calendarDate, state.view === 'year');
      if (action === 'open-month') openMonth(btn.dataset.calendarDate);
      if (action === 'submit-event') submitEvent();
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
    if (eventDate) eventDate.value = state.date;
    const allDay = el('calendar-event-all-day');
    if (allDay) allDay.addEventListener('change', () => setAllDayControls('calendar-event'));
    document.querySelectorAll('[data-calendar-view-trigger]').forEach(bindContentViewTrigger);
    ['calendar-action-modal-close', 'calendar-action-modal-footer-close'].forEach(id => {
      const btn = el(id);
      if (btn) btn.addEventListener('click', closeActionModal);
    });
    const modalBody = el('calendar-action-modal-body');
    if (modalBody) {
      modalBody.addEventListener('click', event => {
        const btn = event.target.closest('[data-calendar-modal-action]');
        if (!btn) return;
        if (btn.dataset.calendarModalAction === 'submit-edit') submitEdit();
        if (btn.dataset.calendarModalAction === 'submit-work-link') submitWorkLink();
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
      year_start_month: state.yearStartMonth,
      source_filter: state.sourceFilter,
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
    modeDay: () => setMode('day'),
    modeWeek: () => setMode('week'),
    filterAll: () => setSourceFilter('all'),
    filterCalendar: () => setSourceFilter('calendar'),
    filterTasks: () => setSourceFilter('tasks'),
    filterWork: () => setSourceFilter('work'),
    filterImports: () => setSourceFilter('imports'),
    filterSources: () => setSourceFilter('sources'),
    newEvent: () => {
      setContentView('new-event');
      const field = el('calendar-event-title');
      if (field) {
        field.scrollIntoView({ behavior: 'smooth', block: 'center' });
        field.focus();
      }
      return true;
    },
    submitEvent,
    editSelected,
    openSource,
    linkDiary,
    createTask,
    linkWorkItem,
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
    'calendar.filterWork': () => CalendarPage.filterWork(),
    'calendar.filterImports': () => CalendarPage.filterImports(),
    'calendar.filterSources': () => CalendarPage.filterSources(),
    'calendar.newEvent': () => CalendarPage.newEvent(),
    'calendar.editSelected': () => CalendarPage.editSelected(),
    'calendar.openSource': () => CalendarPage.openSource(),
    'calendar.linkDiary': () => CalendarPage.linkDiary(),
    'calendar.createTask': () => CalendarPage.createTask(),
    'calendar.linkWorkItem': () => CalendarPage.linkWorkItem(),
    'calendar.explainSelection': () => CalendarPage.explainSelection(),
    'calendar.safeChecks': () => CalendarPage.safeChecks(),
  });
}
