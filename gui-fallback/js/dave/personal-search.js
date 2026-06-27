// Shared Personal Time Activity search strip.

'use strict';

const BlueprintsPersonalSearch = (() => {
  const state = {
    adapters: {},
    surfaces: {},
    graph: {
      open: false,
      sourceRef: '',
      title: '',
      loading: false,
      error: '',
      links: [],
      sync: null,
    },
  };

  const surfaceDefaults = {
    diary: { restrictToRange: false },
    calendar: { restrictToRange: false },
    todo: { restrictToRange: false },
    imports: { restrictToRange: false },
    kanban: { restrictToRange: false },
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

  function adapterFor(surface) {
    return state.adapters[surface] || {};
  }

  function filterSurfaceFor(surface) {
    return adapterFor(surface).filterSurface || `${surface}-search`;
  }

  function selectedTags(surface) {
    if (!window.PersonalFilters?.getSelectedIds) return [];
    return window.PersonalFilters.getSelectedIds(filterSurfaceFor(surface)) || [];
  }

  function surfaceState(surface) {
    const defaults = surfaceDefaults[surface] || { restrictToRange: false };
    if (!state.surfaces[surface]) {
      state.surfaces[surface] = {
        query: '',
        restrictToRange: Boolean(defaults.restrictToRange),
        rangeStart: '',
        rangeEnd: '',
        timeStart: '',
        timeEnd: '',
        allDay: true,
        loading: false,
        error: '',
        results: [],
        subsystems: {},
      };
    }
    return state.surfaces[surface];
  }

  function setStatus(surface, text, tone = '') {
    document.querySelectorAll(`[data-personal-search-status="${surface}"]`).forEach(node => {
      node.textContent = text;
      node.dataset.tone = tone;
    });
  }

  function fallbackRange(surface) {
    if (surface === 'calendar' && window.BlueprintsCalendarPage?.snapshot) {
      const snapshot = window.BlueprintsCalendarPage.snapshot();
      return {
        start: snapshot.range_start || '',
        end: snapshot.range_end || snapshot.range_start || '',
        label: snapshot.range_label || '',
      };
    }
    if (surface === 'diary') {
      const date = document.getElementById('diary-date-input')?.value || '';
      return { start: date, end: date, label: date };
    }
    return { start: '', end: '', label: '' };
  }

  function rangeFor(surface) {
    const adapter = adapterFor(surface);
    if (typeof adapter.getRange === 'function') {
      const range = adapter.getRange() || {};
      return {
        start: range.start || range.date_start || '',
        end: range.end || range.date_end || range.start || range.date_start || '',
        label: range.label || '',
      };
    }
    return fallbackRange(surface);
  }

  function rangeControlsFor(surface) {
    return Boolean(adapterFor(surface).rangeControls);
  }

  function cleanDate(value) {
    const text = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  }

  function orderedRange(start, end) {
    const cleanStart = cleanDate(start);
    const cleanEnd = cleanDate(end || start);
    if (!cleanStart && !cleanEnd) return { start: '', end: '' };
    if (!cleanStart) return { start: cleanEnd, end: cleanEnd };
    if (!cleanEnd) return { start: cleanStart, end: cleanStart };
    return cleanStart <= cleanEnd
      ? { start: cleanStart, end: cleanEnd }
      : { start: cleanEnd, end: cleanStart };
  }

  function syncRangeInputs(surface) {
    if (!rangeControlsFor(surface)) return;
    const data = surfaceState(surface);
    document.querySelectorAll(`[data-personal-search-surface="${surface}"]`).forEach(root => {
      const start = root.querySelector('[data-personal-search-start-date]');
      const end = root.querySelector('[data-personal-search-end-date]');
      const startTime = root.querySelector('[data-personal-search-start-time]');
      const endTime = root.querySelector('[data-personal-search-end-time]');
      const allDay = root.querySelector('[data-personal-search-all-day]');
      if (start) start.value = data.rangeStart || '';
      if (end) end.value = data.rangeEnd || data.rangeStart || '';
      if (startTime) {
        startTime.value = data.timeStart || '';
        startTime.disabled = data.allDay;
      }
      if (endTime) {
        endTime.value = data.timeEnd || '';
        endTime.disabled = data.allDay;
      }
      if (allDay) allDay.checked = data.allDay !== false;
    });
  }

  function syncRangeFromAdapter(surface, options = {}) {
    if (!rangeControlsFor(surface)) return null;
    const data = surfaceState(surface);
    const force = Boolean(options.force);
    const range = rangeFor(surface);
    const next = orderedRange(range.start, range.end);
    if (force || !data.rangeStart) data.rangeStart = next.start;
    if (force || !data.rangeEnd) data.rangeEnd = next.end || next.start;
    const ordered = orderedRange(data.rangeStart, data.rangeEnd);
    data.rangeStart = ordered.start;
    data.rangeEnd = ordered.end;
    syncRangeInputs(surface);
    return ordered;
  }

  function effectiveRange(surface, data) {
    if (rangeControlsFor(surface)) {
      return orderedRange(data.rangeStart, data.rangeEnd);
    }
    if (!data.restrictToRange) return { start: '', end: '' };
    const range = rangeFor(surface);
    return orderedRange(range.start, range.end);
  }

  function hasEffectiveRange(surface, data) {
    const range = effectiveRange(surface, data);
    return Boolean(range.start || range.end);
  }

  function apiUrl(surface, data, options = {}) {
    const url = new URL('/api/v1/personal/search', window.location.origin);
    if (data.query) url.searchParams.set('q', data.query);
    if (options.tag) url.searchParams.set('tag', options.tag);
    const range = effectiveRange(surface, data);
    if (range.start) url.searchParams.set('date_start', range.start);
    if (range.end) url.searchParams.set('date_end', range.end);
    url.searchParams.set('limit', '40');
    url.searchParams.set('include_vector', 'true');
    url.searchParams.set('rerank_results', 'true');
    url.searchParams.set('sync', options.sync === false ? 'false' : 'true');
    return `${url.pathname}${url.search}`;
  }

  function searchLabel(surface) {
    const tags = selectedTags(surface);
    if (tags.length) return `${tags.length} filter${tags.length === 1 ? '' : 's'}`;
    if (rangeControlsFor(surface)) {
      const range = effectiveRange(surface, surfaceState(surface));
      if (range.start && range.end && range.start !== range.end) return `${range.start} to ${range.end}`;
      if (range.start) return range.start;
    }
    if (surfaceState(surface).restrictToRange) return 'shown period';
    return 'Ready';
  }

  function filterSummaryHtml(surface) {
    const filterSurface = filterSurfaceFor(surface);
    if (window.PersonalFilters?.summaryHtml) {
      return window.PersonalFilters.summaryHtml(filterSurface, { prefix: 'Filter:', emptyLabel: 'all entries' });
    }
    return '<span class="personal-filter-summary"><span class="personal-filter-summary__label">Filter:</span><span class="personal-filter-summary__empty">all entries</span></span>';
  }

  function renderFilterSummaries(surface) {
    document.querySelectorAll(`[data-personal-search-tags-strip="${surface}"]`).forEach(strip => {
      strip.innerHTML = filterSummaryHtml(surface);
      strip.dataset.personalFilterOpen = filterSurfaceFor(surface);
      strip.dataset.personalFilterTab = 'filters';
    });
  }

  function scoreChips(result) {
    const score = result.score || {};
    const components = score.components || {};
    const chips = [];
    for (const source of score.score_sources || []) {
      chips.push(source.replace(/_/g, ' '));
    }
    if (components.vector?.cosine_distance != null) {
      chips.push(`vec ${Number(components.vector.cosine_distance).toFixed(2)}`);
    }
    if (score.reranker_rank) chips.push(`rank ${score.reranker_rank}`);
    return chips.map(label => `<span class="personal-search-chip">${escHtml(label)}</span>`).join('');
  }

  function graphEls() {
    return {
      dialog: document.getElementById('personal-graph-modal'),
      title: document.getElementById('personal-graph-title'),
      source: document.getElementById('personal-graph-source'),
      status: document.getElementById('personal-graph-status'),
      list: document.getElementById('personal-graph-list'),
    };
  }

  function graphLabel(value) {
    return String(value || '').replace(/_/g, ' ');
  }

  function graphUrl(sourceRef) {
    const url = new URL('/api/v1/personal/graph/links', window.location.origin);
    url.searchParams.set('source_ref', sourceRef);
    url.searchParams.set('sync', 'true');
    url.searchParams.set('limit', '80');
    return `${url.pathname}${url.search}`;
  }

  function graphStatusText() {
    const graph = state.graph;
    if (graph.loading) return 'Loading';
    if (graph.error) return graph.error;
    const count = graph.links.length;
    return `${count} link${count === 1 ? '' : 's'}`;
  }

  function graphLinkHtml(link) {
    const source = link.source_ref || '';
    const target = link.target_ref || '';
    const provenance = link.provenance || {};
    const metaParts = [
      graphLabel(link.link_type),
      graphLabel(link.link_state),
      graphLabel(link.risk_level),
    ].filter(Boolean);
    const detailParts = [
      link.title,
      provenance.source_hash ? `hash ${provenance.source_hash}` : '',
      provenance.db_ref ? `db ${provenance.db_ref}` : '',
      provenance.source_ref ? `source ${provenance.source_ref}` : '',
    ].filter(Boolean);
    return `
      <article class="personal-graph-row">
        <div class="personal-graph-row__refs">
          <span>${escHtml(source)}</span>
          <span aria-hidden="true">-&gt;</span>
          <span>${escHtml(target)}</span>
        </div>
        <div class="personal-graph-row__meta">${escHtml(metaParts.join(' / '))}</div>
        <div class="personal-graph-row__detail">${escHtml(detailParts.join(' - '))}</div>
      </article>
    `;
  }

  function renderGraphModal() {
    const graph = state.graph;
    const els = graphEls();
    if (!els.dialog || !els.list) return;
    if (els.title) els.title.textContent = graph.title || 'Graph Links';
    if (els.source) els.source.textContent = graph.sourceRef || '';
    if (els.status) {
      els.status.textContent = graphStatusText();
      els.status.dataset.tone = graph.error ? 'error' : '';
    }
    els.list.innerHTML = graph.links.length
      ? graph.links.map(graphLinkHtml).join('')
      : '<div class="personal-graph-empty">No graph links for this source.</div>';
  }

  function openGraphModal() {
    const { dialog } = graphEls();
    if (!dialog) return false;
    state.graph.open = true;
    renderGraphModal();
    if (typeof HubModal !== 'undefined' && typeof HubModal.open === 'function') {
      HubModal.open(dialog, {
        onClose: () => {
          state.graph.open = false;
        },
      });
      return true;
    }
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
      return true;
    }
    dialog.setAttribute('open', 'open');
    return true;
  }

  async function openGraphLinks(surface, index) {
    const result = surfaceState(surface).results[Number(index)];
    if (!result) return;
    const sourceRef = result.document_id || (result.source_refs || [])[0] || '';
    if (!sourceRef) return;
    state.graph = {
      open: true,
      sourceRef,
      title: result.title || sourceRef,
      loading: true,
      error: '',
      links: [],
      sync: null,
    };
    openGraphModal();
    try {
      const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
      const response = await fetcher(graphUrl(sourceRef));
      if (!response.ok) throw new Error(response.statusText || 'graph links failed');
      const payload = await response.json();
      state.graph.links = Array.isArray(payload.links) ? payload.links : [];
      state.graph.sync = payload.sync || null;
    } catch (error) {
      state.graph.error = error.message || String(error);
      state.graph.links = [];
    } finally {
      state.graph.loading = false;
      renderGraphModal();
    }
  }

  function resultHtml(result, index) {
    const source = result.source || {};
    const page = result.page_ref || {};
    const pageLabel = [page.group, page.tab, page.date || page.item_id].filter(Boolean).join(' / ');
    return `
      <article class="personal-search-row" data-personal-search-result="${index}">
        <div>
          <div class="personal-search-title">${escHtml(result.title || result.document_id)}</div>
          <div class="personal-search-meta">${escHtml(result.record_type || '')} - ${escHtml(source.type || '')} - ${escHtml(pageLabel || result.document_id)}</div>
          <div class="personal-search-body">${escHtml(result.body_excerpt || '')}</div>
        </div>
        <div class="personal-search-score">
          ${scoreChips(result)}
          <button class="personal-search-open" type="button" data-personal-search-open="${index}">Open</button>
          <button class="personal-search-open" type="button" data-personal-graph-open="${index}">Links</button>
        </div>
      </article>
    `;
  }

  function renderResults(surface) {
    const data = surfaceState(surface);
    document.querySelectorAll(`[data-personal-search-surface="${surface}"]`).forEach(root => {
      const results = root.querySelector(`[data-personal-search-results="${surface}"]`);
      if (!results) return;
      root.dataset.searchEmpty = data.results.length ? 'false' : 'true';
      results.innerHTML = data.results.map(resultHtml).join('');
    });
  }

  function mergeSearchPayloads(payloads) {
    const byId = new Map();
    payloads.forEach(payload => {
      (Array.isArray(payload.results) ? payload.results : []).forEach(result => {
        const id = result.document_id || result.record_id || '';
        if (!id || byId.has(id)) return;
        byId.set(id, result);
      });
    });
    return {
      count: byId.size,
      results: Array.from(byId.values()),
      subsystems: {
        ...(payloads[0]?.subsystems || {}),
        tag_pool: {
          status: 'ok',
          candidate_count: byId.size,
          request_count: payloads.length,
        },
      },
    };
  }

  async function fetchSearchPayload(surface, data, options = {}) {
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const response = await fetcher(apiUrl(surface, data, options));
    if (!response.ok) throw new Error(response.statusText || 'search failed');
    return response.json();
  }

  async function fetchSearch(surface, data) {
    const tags = selectedTags(surface);
    if (tags.length <= 1) {
      return fetchSearchPayload(surface, data, { tag: tags[0] || '' });
    }
    const first = await fetchSearchPayload(surface, data, { tag: tags[0], sync: true });
    const rest = await Promise.all(tags.slice(1).map(tag => fetchSearchPayload(surface, data, { tag, sync: false })));
    return mergeSearchPayloads([first, ...rest]);
  }

  async function run(surface) {
    const data = surfaceState(surface);
    if (!data.query && !data.restrictToRange && !selectedTags(surface).length && !hasEffectiveRange(surface, data)) {
      data.results = [];
      data.error = '';
      setStatus(surface, 'Ready');
      renderResults(surface);
      return;
    }
    data.loading = true;
    data.error = '';
    setStatus(surface, 'Searching');
    try {
      const payload = await fetchSearch(surface, data);
      data.results = Array.isArray(payload.results) ? payload.results : [];
      data.subsystems = payload.subsystems || {};
      setStatus(surface, `${payload.count || 0} result${payload.count === 1 ? '' : 's'}`);
    } catch (error) {
      data.results = [];
      data.error = error.message || String(error);
      setStatus(surface, data.error, 'error');
    } finally {
      data.loading = false;
      renderResults(surface);
      renderFilterSummaries(surface);
      if (window.BodyShade && typeof window.BodyShade.scheduleSizeFillTable === 'function') {
        window.BodyShade.scheduleSizeFillTable();
      }
    }
  }

  function calendarRangeFormHtml(surface, data, instance) {
    syncRangeFromAdapter(surface);
    const safeSurface = escHtml(surface);
    const prefix = String(instance || `${surface}-search`).replace(/[^a-zA-Z0-9_-]/g, '-');
    const allDay = data.allDay !== false;
    const disabled = allDay ? ' disabled' : '';
    return `
      <form class="personal-search-form personal-search-form--calendar-range calendar-event-form-grid" data-personal-search-form="${safeSurface}">
        <label class="calendar-field calendar-field--wide" for="${escHtml(prefix)}-query">
          <span>Search</span>
          <input id="${escHtml(prefix)}-query" class="personal-search-query-input" type="search" data-personal-search-query="${safeSurface}" value="${escHtml(data.query)}" autocomplete="off" spellcheck="false" aria-label="Search personal records" />
        </label>
        <label class="calendar-field" for="${escHtml(prefix)}-start-date">
          <span>Start date</span>
          <input id="${escHtml(prefix)}-start-date" type="date" data-personal-search-start-date="${safeSurface}" value="${escHtml(data.rangeStart)}" />
        </label>
        <label class="calendar-field" for="${escHtml(prefix)}-end-date">
          <span>End date</span>
          <input id="${escHtml(prefix)}-end-date" type="date" data-personal-search-end-date="${safeSurface}" value="${escHtml(data.rangeEnd || data.rangeStart)}" />
        </label>
        <label class="calendar-field" for="${escHtml(prefix)}-start-time">
          <span>Start</span>
          <input id="${escHtml(prefix)}-start-time" type="time" data-personal-search-start-time="${safeSurface}" value="${escHtml(data.timeStart)}"${disabled} />
        </label>
        <label class="calendar-field" for="${escHtml(prefix)}-end-time">
          <span>End</span>
          <input id="${escHtml(prefix)}-end-time" type="time" data-personal-search-end-time="${safeSurface}" value="${escHtml(data.timeEnd)}"${disabled} />
        </label>
        <div class="calendar-event-options-row personal-search-options-row">
          <label class="calendar-check hub-checkbox" for="${escHtml(prefix)}-all-day">
            <input id="${escHtml(prefix)}-all-day" class="hub-checkbox__input" type="checkbox" data-personal-search-all-day="${safeSurface}"${allDay ? ' checked' : ''} />
            <span class="hub-checkbox__box" aria-hidden="true"></span>
            <span class="hub-checkbox__label">All day</span>
          </label>
          <div class="calendar-filter-strip calendar-event-tags-strip personal-search-filter-strip personal-search-filter-strip--calendar-range" role="button" tabindex="0" data-personal-search-tags-strip="${safeSurface}" data-personal-filter-open="${escHtml(filterSurfaceFor(surface))}" data-personal-filter-tab="filters">
            ${filterSummaryHtml(surface)}
          </div>
        </div>
        <div class="calendar-quick-event__footer personal-search-form-footer">
          <span class="personal-search-status" data-personal-search-status="${safeSurface}">${escHtml(searchLabel(surface))}</span>
          <button class="calendar-command-btn personal-search-command-btn" type="submit">Search</button>
        </div>
      </form>
      <div class="personal-search-results" data-personal-search-results="${safeSurface}"></div>
    `;
  }

  async function openResult(surface, index) {
    const result = surfaceState(surface).results[Number(index)];
    if (!result) return;
    const adapter = adapterFor(surface);
    if (typeof adapter.openResult === 'function') {
      try {
        const handled = await adapter.openResult(result, {
          surface,
          index: Number(index),
        });
        if (handled !== false) return;
      } catch (error) {
        surfaceState(surface).error = error.message || String(error);
        setStatus(surface, surfaceState(surface).error, 'error');
        return;
      }
    }
    const page = result.page_ref || {};
    const group = page.group || (result.mode === 'work' ? 'kanban' : 'dave');
    const tab = page.tab || (group === 'kanban' ? 'kanban' : 'diary');
    if (typeof switchGroup === 'function') switchGroup(group);
    if (typeof switchTab === 'function') switchTab(tab);
    if (group === 'dave' && window.DaveMenuConfig?.updateActiveTab) {
      window.DaveMenuConfig.updateActiveTab(tab);
    }
    if (group === 'kanban' && window.KanbanMenuConfig?.updateActiveTab) {
      window.KanbanMenuConfig.updateActiveTab(tab);
    }
  }

  function renderSurface(root) {
    const surface = root.dataset.personalSearchSurface;
    const data = surfaceState(surface);
    root.dataset.searchEmpty = 'true';
    if (rangeControlsFor(surface)) {
      root.innerHTML = calendarRangeFormHtml(surface, data, root.dataset.personalSearchInstance);
    } else {
      root.innerHTML = `
      <form class="personal-search-form" data-personal-search-form="${escHtml(surface)}">
        <input type="search" data-personal-search-query="${escHtml(surface)}" value="${escHtml(data.query)}" autocomplete="off" spellcheck="false" aria-label="Search personal records" />
        <div class="personal-search-filter-strip" role="button" tabindex="0" data-personal-search-tags-strip="${escHtml(surface)}" data-personal-filter-open="${escHtml(filterSurfaceFor(surface))}" data-personal-filter-tab="filters">
          ${filterSummaryHtml(surface)}
        </div>
        <label class="personal-search-range hub-checkbox">
          <input class="hub-checkbox__input" type="checkbox" data-personal-search-range="${escHtml(surface)}" ${data.restrictToRange ? 'checked' : ''} />
          <span class="hub-checkbox__box" aria-hidden="true"></span>
          <span class="hub-checkbox__label">Shown period</span>
        </label>
        <button class="personal-search-btn" type="submit" title="Search" aria-label="Search"></button>
      </form>
      <div class="personal-search-status" data-personal-search-status="${escHtml(surface)}">${escHtml(searchLabel(surface))}</div>
      <div class="personal-search-results" data-personal-search-results="${escHtml(surface)}"></div>
      `;
    }
    if (root.dataset.personalSearchWired === '1') {
      renderResults(surface);
      syncRangeInputs(surface);
      return;
    }
    root.dataset.personalSearchWired = '1';
    root.addEventListener('submit', event => {
      event.preventDefault();
      run(surface);
    });
    root.addEventListener('change', event => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.matches('[data-personal-search-range]')) {
        data.restrictToRange = Boolean(target.checked);
        run(surface);
        return;
      }
      if (target.matches('[data-personal-search-start-date]')) {
        data.rangeStart = cleanDate(target.value);
        if (!data.rangeEnd || data.rangeEnd < data.rangeStart) data.rangeEnd = data.rangeStart;
        syncRangeInputs(surface);
        run(surface);
        return;
      }
      if (target.matches('[data-personal-search-end-date]')) {
        data.rangeEnd = cleanDate(target.value);
        if (!data.rangeStart || data.rangeEnd < data.rangeStart) data.rangeStart = data.rangeEnd;
        syncRangeInputs(surface);
        run(surface);
        return;
      }
      if (target.matches('[data-personal-search-start-time]')) {
        data.timeStart = target.value || '';
        return;
      }
      if (target.matches('[data-personal-search-end-time]')) {
        data.timeEnd = target.value || '';
        return;
      }
      if (target.matches('[data-personal-search-all-day]')) {
        data.allDay = Boolean(target.checked);
        syncRangeInputs(surface);
        run(surface);
      }
    });
    root.addEventListener('input', event => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches('[data-personal-search-query]')) return;
      data.query = target.value.trim();
      window.clearTimeout(data.timer);
      data.timer = window.setTimeout(() => run(surface), 450);
    });
    root.addEventListener('click', event => {
      const openButton = event.target.closest?.('[data-personal-search-open]');
      if (openButton) {
        openResult(surface, openButton.dataset.personalSearchOpen);
        return;
      }
      const graphButton = event.target.closest?.('[data-personal-graph-open]');
      if (graphButton) {
        openGraphLinks(surface, graphButton.dataset.personalGraphOpen);
      }
    });
    renderResults(surface);
    syncRangeInputs(surface);
  }

  function init() {
    document.querySelectorAll('[data-personal-search-surface]').forEach(renderSurface);
  }

  function registerSurface(surface, adapter = {}) {
    state.adapters[surface] = adapter;
    syncRangeFromAdapter(surface);
    document.querySelectorAll(`[data-personal-search-surface="${surface}"]`).forEach(renderSurface);
    renderFilterSummaries(surface);
  }

  function surfaceForFilterSurface(filterSurface) {
    const found = Object.entries(state.adapters)
      .find(([, adapter]) => (adapter.filterSurface || '') === filterSurface);
    if (found) return found[0];
    return String(filterSurface || '').endsWith('-search')
      ? String(filterSurface).slice(0, -'-search'.length)
      : '';
  }

  function handlePersonalFilterChange(event) {
    const surface = surfaceForFilterSurface(event.detail?.surface || '');
    if (!surface) return;
    renderFilterSummaries(surface);
    const data = surfaceState(surface);
    if (data.query || data.restrictToRange || selectedTags(surface).length || hasEffectiveRange(surface, data)) run(surface);
    else renderResults(surface);
  }

  function snapshot() {
    const surfaces = {};
    for (const [key, value] of Object.entries(state.surfaces)) {
      surfaces[key] = {
        query: value.query,
        restrict_to_range: value.restrictToRange,
        range_start: value.rangeStart,
        range_end: value.rangeEnd,
        time_start: value.timeStart,
        time_end: value.timeEnd,
        all_day: value.allDay !== false,
        range_controls: rangeControlsFor(key),
        filter_surface: filterSurfaceFor(key),
        selected_tags: selectedTags(key),
        loading: value.loading,
        error: value.error,
        result_count: value.results.length,
        first_result: value.results[0]?.document_id || '',
        subsystems: value.subsystems,
      };
    }
    return {
      surfaces,
      graph: {
        open: state.graph.open,
        source_ref: state.graph.sourceRef,
        title: state.graph.title,
        loading: state.graph.loading,
        error: state.graph.error,
        link_count: state.graph.links.length,
        first_link: state.graph.links[0]?.target_ref || '',
        sync: state.graph.sync,
      },
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
  window.addEventListener('personal-filters:change', handlePersonalFilterChange);

  return {
    init,
    registerSurface,
    syncRange: syncRangeFromAdapter,
    run,
    openGraphLinks,
    snapshot,
  };
})();

window.BlueprintsPersonalSearch = BlueprintsPersonalSearch;
window.BlueprintsPersonalGraphLinks = {
  snapshot: () => (window.BlueprintsPersonalSearch?.snapshot?.().graph || {}),
};
