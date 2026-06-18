// Dave Calendar page - agenda over shared personal_events.

'use strict';

const CalendarPage = (() => {
  const state = {
    loaded: false,
    loading: false,
    data: null,
    error: '',
    date: localDateString(new Date()),
    mode: 'day',
    sourceFilter: 'all',
    selection: null,
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

  function el(id) {
    return document.getElementById(id);
  }

  function localDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseLocalDate(dateText) {
    return new Date(`${dateText || state.date}T00:00:00`);
  }

  function shiftDate(dateText, deltaDays) {
    const date = parseLocalDate(dateText);
    date.setDate(date.getDate() + deltaDays);
    return localDateString(date);
  }

  function rangeStart() {
    return state.date;
  }

  function rangeEnd() {
    return state.mode === 'week' ? shiftDate(state.date, 6) : state.date;
  }

  function rangeLabel() {
    if (state.mode === 'week') return `${rangeStart()} to ${rangeEnd()}`;
    return state.date;
  }

  function filterLabel(value) {
    if (value === 'calendar') return 'calendar';
    if (value === 'tasks') return 'tasks and reminders';
    if (value === 'work') return 'work';
    if (value === 'imports') return 'imports';
    if (value === 'sources') return 'source imports';
    return 'all sources';
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

  function isCalendarEvent(event) {
    const tags = Array.isArray(event?.tags) ? event.tags : [];
    return sourceType(event) === 'manual-calendar' || tags.includes('calendar');
  }

  function isTaskLike(event) {
    const kind = String(event?.kind || '');
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

  function matchesFilter(event) {
    if (state.sourceFilter === 'calendar') return isCalendarEvent(event);
    if (state.sourceFilter === 'tasks') return isTaskLike(event);
    if (state.sourceFilter === 'work') return isWorkLike(event);
    if (state.sourceFilter === 'imports') return isImportLike(event);
    if (state.sourceFilter === 'sources') return !isCalendarEvent(event);
    return true;
  }

  function eventStartDate(event) {
    return event?.local_date || state.date;
  }

  function calendarMeta(event) {
    return event?.provenance?.calendar || {};
  }

  function isAllDay(event) {
    const meta = calendarMeta(event);
    const tags = Array.isArray(event?.tags) ? event.tags : [];
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

  function metric(value, label) {
    return `<div class="calendar-metric"><div class="calendar-metric__value">${escHtml(value)}</div><div class="calendar-metric__label">${escHtml(label)}</div></div>`;
  }

  function kvHtml(items) {
    return `<dl class="calendar-action-kv">${items.map(([key, value]) => `
      <dt>${escHtml(key)}</dt><dd>${escHtml(value ?? '')}</dd>
    `).join('')}</dl>`;
  }

  function selectionKey(type, index) {
    return `${type}:${index}`;
  }

  function rowLabel(row) {
    return row?.title || row?.event_id || 'calendar event';
  }

  function visibleEvents() {
    const items = state.data?.items || [];
    return items.filter(matchesFilter);
  }

  function rowsForType(type) {
    const rows = groupEvents();
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

  function groupEvents() {
    const rows = visibleEvents().slice().sort((a, b) => {
      const left = a.start_at || `${eventStartDate(a)}T00:00:00Z`;
      const right = b.start_at || `${eventStartDate(b)}T00:00:00Z`;
      return left.localeCompare(right) || String(a.event_id || '').localeCompare(String(b.event_id || ''));
    });
    const timed = rows.filter(event => !isAllDay(event));
    const allDay = rows.filter(isAllDay);
    return {
      timed,
      allDay,
      upcoming: rows.slice(0, 16),
    };
  }

  function renderStatus() {
    const strip = el('calendar-status-strip');
    if (!strip) return;
    const status = state.error ? 'error' : (state.data ? 'ready' : 'empty');
    const tone = statusTone(status);
    strip.innerHTML = `
      <span class="calendar-status-dot calendar-status-dot--${tone}" aria-hidden="true"></span>
      <span>${escHtml(status)}</span>
      <span>${escHtml(rangeLabel())}</span>
    `;
  }

  function renderMeta() {
    const meta = el('calendar-meta');
    if (meta) {
      const count = visibleEvents().length;
      meta.textContent = `${rangeLabel()} - ${state.mode} - ${count} visible event${count === 1 ? '' : 's'}`;
    }
    const dateInput = el('calendar-date-input');
    if (dateInput) dateInput.value = state.date;
    const eventDate = el('calendar-event-date');
    if (eventDate && !eventDate.value) eventDate.value = state.date;
    const filter = el('calendar-filter-strip');
    if (filter) {
      const selected = state.selection ? ` - selected ${state.selection.label}` : '';
      filter.textContent = `Filter: ${filterLabel(state.sourceFilter)}${selected}`;
    }
    document.querySelectorAll('[data-calendar-mode-button]').forEach(btn => {
      btn.dataset.active = btn.dataset.calendarModeButton === state.mode ? 'true' : 'false';
    });
  }

  function renderMetrics() {
    const target = el('calendar-metrics');
    if (!target) return;
    const rows = groupEvents();
    target.innerHTML = [
      metric(visibleEvents().length, 'visible events'),
      metric(rows.timed.length, 'timed'),
      metric(rows.allDay.length, 'all-day'),
      metric((state.data?.items || []).length, 'range total'),
    ].join('');
  }

  function eventRow(event, index, type) {
    const source = sourceType(event) || event.kind || 'source';
    const datePart = state.mode === 'week' ? `${eventStartDate(event)} - ` : '';
    const ref = event.source?.ref || (Array.isArray(event.file_refs) ? event.file_refs[0] : '') || event.event_id || '';
    return `
      <div class="calendar-agenda-row" ${selectionAttrs(type, index)}>
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

  function renderAgenda() {
    const rows = groupEvents();
    const count = el('calendar-agenda-count');
    if (count) count.textContent = String(rows.timed.length);
    renderList('calendar-agenda-list', rows.timed, 'timed', 'No timed events for this range.');
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
    renderMetrics();
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
    try {
      const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
      const params = new URLSearchParams({
        date_start: rangeStart(),
        date_end: rangeEnd(),
        limit: '200',
      });
      const resp = await fetcher(`/api/v1/personal/events?${params.toString()}`);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.detail || `HTTP ${resp.status}`);
      state.data = data;
      state.loaded = true;
      render();
      return data;
    } catch (error) {
      state.error = error.message || String(error);
      renderError(state.error);
      return null;
    } finally {
      state.loading = false;
    }
  }

  function setDate(dateText) {
    state.date = localDateString(parseLocalDate(dateText));
    state.loaded = false;
    state.selection = null;
    syncCreateDate();
    return load({ force: true });
  }

  function setMode(mode) {
    state.mode = mode === 'week' ? 'week' : 'day';
    state.loaded = false;
    state.selection = null;
    return load({ force: true });
  }

  function setSourceFilter(filter) {
    state.sourceFilter = ['all', 'calendar', 'tasks', 'work', 'imports', 'sources'].includes(filter) ? filter : 'all';
    state.selection = null;
    render();
    return state.sourceFilter;
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
      if (status) status.textContent = data.detail || `HTTP ${resp.status}`;
      return false;
    }
    ['title', 'body', 'start', 'end'].forEach(key => {
      const field = el(`calendar-event-${key}`);
      if (field) field.value = '';
    });
    if (status) status.textContent = `Saved ${data.event?.event_id || ''}`;
    state.lastWrite = data;
    state.date = data.event?.local_date || payload.local_date || state.date;
    state.loaded = false;
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
        <label class="calendar-field calendar-field--wide" for="calendar-edit-body">
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
      showActionModal('Edit Calendar Event', `<p>${escHtml(data.detail || `HTTP ${resp.status}`)}</p>`);
      return false;
    }
    state.lastWrite = data;
    state.date = data.event?.local_date || state.date;
    state.loaded = false;
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
      return showActionModal('Calendar Source', '<p>Select an agenda row before opening source detail.</p>');
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
      ['Range', rangeLabel()],
      ['Mode', state.mode],
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
      showActionModal('Create Calendar Task', `<p>${escHtml(data.detail || `HTTP ${resp.status}`)}</p>`);
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
      return showActionModal('Connect Work', '<p>Select an agenda row before linking a work item.</p>');
    }
    return showActionModal('Connect Work', `${kvHtml([
      ['Event', event.event_id || ''],
      ['Current links', (event.related?.work_items || []).join(', ') || 'none'],
    ])}
      <label class="calendar-field" for="calendar-work-link-input">
        <span>Work ref</span>
        <input id="calendar-work-link-input" type="text" autocomplete="off" />
      </label>
      <button class="calendar-command-btn" type="button" data-calendar-modal-action="submit-work-link">Connect Work</button>`);
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
      showActionModal('Connect Work', `<p>${escHtml(data.detail || `HTTP ${resp.status}`)}</p>`);
      return false;
    }
    await load({ force: true });
    return showActionModal('Connect Work', kvHtml([
      ['Event', data.event?.event_id || event.event_id],
      ['Work ref', workRef],
      ['Audit', data.audit?.audit_id || ''],
    ]), 'Work link recorded.');
  }

  async function safeChecks() {
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const params = new URLSearchParams({ date_start: rangeStart(), date_end: rangeEnd(), limit: '200' });
    const first = await fetcher(`/api/v1/personal/events?${params.toString()}`).then(resp => resp.json());
    const second = await fetcher(`/api/v1/personal/events?${params.toString()}`).then(resp => resp.json());
    state.data = second;
    state.loaded = true;
    render();
    return showActionModal('Calendar Safe Checks', kvHtml([
      ['Read route', '/api/v1/personal/events'],
      ['Range', rangeLabel()],
      ['Count stable', (first.items || []).length === (second.items || []).length ? 'yes' : 'no'],
      ['Mode', state.mode],
      ['Filter', filterLabel(state.sourceFilter)],
    ]), 'No write command was run.');
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
      if (action === 'previous') setDate(shiftDate(state.date, state.mode === 'week' ? -7 : -1));
      if (action === 'today') setDate(localDateString(new Date()));
      if (action === 'next') setDate(shiftDate(state.date, state.mode === 'week' ? 7 : 1));
      if (action === 'refresh') load({ force: true });
      if (action === 'mode-day') setMode('day');
      if (action === 'mode-week') setMode('week');
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
    const eventDate = el('calendar-event-date');
    if (eventDate) eventDate.value = state.date;
    const allDay = el('calendar-event-all-day');
    if (allDay) allDay.addEventListener('change', () => setAllDayControls('calendar-event'));
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
      mode: state.mode,
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
    previous: () => setDate(shiftDate(state.date, state.mode === 'week' ? -7 : -1)),
    next: () => setDate(shiftDate(state.date, state.mode === 'week' ? 7 : 1)),
    today: () => setDate(localDateString(new Date())),
    modeDay: () => setMode('day'),
    modeWeek: () => setMode('week'),
    filterAll: () => setSourceFilter('all'),
    filterCalendar: () => setSourceFilter('calendar'),
    filterTasks: () => setSourceFilter('tasks'),
    filterWork: () => setSourceFilter('work'),
    filterImports: () => setSourceFilter('imports'),
    filterSources: () => setSourceFilter('sources'),
    newEvent: () => {
      const field = el('calendar-event-title');
      if (field) field.focus();
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
    'calendar.previous': () => CalendarPage.previous(),
    'calendar.next': () => CalendarPage.next(),
    'calendar.today': () => CalendarPage.today(),
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
