// Shared Personal Time Activity search strip.

'use strict';

const BlueprintsPersonalSearch = (() => {
  const state = {
    surfaces: {},
  };

  const surfaceDefaults = {
    diary: { mode: 'personal', recordType: '' },
    calendar: { mode: 'calendar', recordType: 'calendar' },
    todo: { mode: '', recordType: 'task' },
    imports: { mode: 'imports', recordType: 'import' },
    kanban: { mode: 'work', recordType: '' },
  };

  const modeOptions = [
    ['', 'All modes'],
    ['today', 'Today'],
    ['personal', 'Personal'],
    ['calendar', 'Calendar'],
    ['work', 'Work'],
    ['blocked', 'Blocked'],
    ['review', 'Review'],
    ['imports', 'Imports'],
    ['git_activity', 'Git'],
  ];

  const typeOptions = [
    ['', 'All types'],
    ['diary', 'Diary'],
    ['timeline', 'Timeline'],
    ['calendar', 'Calendar'],
    ['task', 'Task'],
    ['import', 'Import'],
    ['work_item', 'Work item'],
    ['work_issue', 'Issue'],
    ['work_todo', 'Work ToDo'],
    ['work_blocker', 'Blocker'],
    ['git', 'Git'],
  ];

  const escHtml = typeof esc === 'function'
    ? esc
    : value => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[ch]));

  function optionHtml(options, selected) {
    return options.map(([value, label]) => `
      <option value="${escHtml(value)}" ${value === selected ? 'selected' : ''}>${escHtml(label)}</option>
    `).join('');
  }

  function surfaceState(surface) {
    const defaults = surfaceDefaults[surface] || { mode: '', recordType: '' };
    if (!state.surfaces[surface]) {
      state.surfaces[surface] = {
        query: '',
        mode: defaults.mode,
        recordType: defaults.recordType,
        loading: false,
        error: '',
        results: [],
        subsystems: {},
      };
    }
    return state.surfaces[surface];
  }

  function setStatus(surface, text, tone = '') {
    const node = document.querySelector(`[data-personal-search-status="${surface}"]`);
    if (!node) return;
    node.textContent = text;
    node.dataset.tone = tone;
  }

  function apiUrl(surface, data) {
    const url = new URL('/api/v1/personal/search', window.location.origin);
    if (data.query) url.searchParams.set('q', data.query);
    if (data.mode) url.searchParams.set('mode', data.mode);
    if (data.recordType) url.searchParams.set('record_type', data.recordType);
    url.searchParams.set('limit', '8');
    url.searchParams.set('include_vector', 'true');
    url.searchParams.set('rerank_results', 'true');
    url.searchParams.set('sync', 'true');
    if (surface === 'diary') {
      const date = document.getElementById('diary-date-input')?.value || '';
      if (date) {
        url.searchParams.set('date_start', date);
        url.searchParams.set('date_end', date);
      }
    }
    if (surface === 'calendar') {
      const date = document.getElementById('calendar-date-input')?.value || '';
      if (date) {
        url.searchParams.set('date_start', date);
        url.searchParams.set('date_end', date);
      }
    }
    return `${url.pathname}${url.search}`;
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
        </div>
      </article>
    `;
  }

  function renderResults(surface) {
    const data = surfaceState(surface);
    const root = document.querySelector(`[data-personal-search-surface="${surface}"]`);
    const results = document.querySelector(`[data-personal-search-results="${surface}"]`);
    if (!root || !results) return;
    root.dataset.searchEmpty = data.results.length ? 'false' : 'true';
    results.innerHTML = data.results.map(resultHtml).join('');
  }

  async function run(surface) {
    const data = surfaceState(surface);
    if (!data.query && !data.mode && !data.recordType) {
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
      const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
      const response = await fetcher(apiUrl(surface, data));
      if (!response.ok) throw new Error(response.statusText || 'search failed');
      const payload = await response.json();
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
      if (window.BodyShade && typeof window.BodyShade.scheduleSizeFillTable === 'function') {
        window.BodyShade.scheduleSizeFillTable();
      }
    }
  }

  function openResult(surface, index) {
    const result = surfaceState(surface).results[Number(index)];
    if (!result) return;
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
    root.innerHTML = `
      <form class="personal-search-form" data-personal-search-form="${escHtml(surface)}">
        <input type="search" data-personal-search-query="${escHtml(surface)}" value="${escHtml(data.query)}" autocomplete="off" spellcheck="false" aria-label="Search personal records" />
        <select data-personal-search-mode="${escHtml(surface)}" aria-label="Search mode">
          ${optionHtml(modeOptions, data.mode)}
        </select>
        <select data-personal-search-type="${escHtml(surface)}" aria-label="Search record type">
          ${optionHtml(typeOptions, data.recordType)}
        </select>
        <button class="personal-search-btn" type="submit" title="Search" aria-label="Search"></button>
      </form>
      <div class="personal-search-status" data-personal-search-status="${escHtml(surface)}">Ready</div>
      <div class="personal-search-results" data-personal-search-results="${escHtml(surface)}"></div>
    `;
    root.addEventListener('submit', event => {
      event.preventDefault();
      run(surface);
    });
    root.addEventListener('change', event => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.matches('[data-personal-search-mode]')) data.mode = target.value;
      if (target.matches('[data-personal-search-type]')) data.recordType = target.value;
      run(surface);
    });
    root.addEventListener('input', event => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches('[data-personal-search-query]')) return;
      data.query = target.value.trim();
      window.clearTimeout(data.timer);
      data.timer = window.setTimeout(() => run(surface), 450);
    });
    root.addEventListener('click', event => {
      const button = event.target.closest?.('[data-personal-search-open]');
      if (!button) return;
      openResult(surface, button.dataset.personalSearchOpen);
    });
  }

  function init() {
    document.querySelectorAll('[data-personal-search-surface]').forEach(renderSurface);
  }

  function snapshot() {
    const surfaces = {};
    for (const [key, value] of Object.entries(state.surfaces)) {
      surfaces[key] = {
        query: value.query,
        mode: value.mode,
        record_type: value.recordType,
        loading: value.loading,
        error: value.error,
        result_count: value.results.length,
        first_result: value.results[0]?.document_id || '',
        subsystems: value.subsystems,
      };
    }
    return { surfaces };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  return {
    init,
    run,
    snapshot,
  };
})();

window.BlueprintsPersonalSearch = BlueprintsPersonalSearch;
