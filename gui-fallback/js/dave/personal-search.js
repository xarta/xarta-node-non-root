// Shared Personal Time Activity search strip.

'use strict';

const BlueprintsPersonalSearch = (() => {
  const state = {
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

  return {
    init,
    run,
    openGraphLinks,
    snapshot,
  };
})();

window.BlueprintsPersonalSearch = BlueprintsPersonalSearch;
window.BlueprintsPersonalGraphLinks = {
  snapshot: () => (window.BlueprintsPersonalSearch?.snapshot?.().graph || {}),
};
