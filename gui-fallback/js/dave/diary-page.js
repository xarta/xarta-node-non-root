// Dave Diary page - day view, quick entry, source moments, and provenance.

'use strict';

const DiaryPage = (() => {
  const state = {
    loaded: false,
    loading: false,
    data: null,
    error: '',
    date: localDateString(new Date()),
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

  function shiftDate(dateText, deltaDays) {
    const date = new Date(`${dateText}T00:00:00`);
    date.setDate(date.getDate() + deltaDays);
    return localDateString(date);
  }

  function statusTone(status) {
    const clean = String(status || '').toLowerCase();
    if (clean === 'ready' || clean === 'ok') return 'ok';
    if (clean === 'empty' || clean === 'summary_pending') return 'warn';
    if (clean === 'source_unavailable' || clean === 'error' || clean === 'blocked') return 'err';
    return 'unknown';
  }

  function filterLabel(value) {
    if (value === 'manual') return 'manual entries';
    if (value === 'sources') return 'source imports';
    if (value === 'git') return 'git';
    if (value === 'imports') return 'imports';
    if (value === 'work') return 'work';
    return 'all sources';
  }

  function metric(value, label) {
    return `<div class="diary-metric"><div class="diary-metric__value">${escHtml(value)}</div><div class="diary-metric__label">${escHtml(label)}</div></div>`;
  }

  function kvHtml(items) {
    return `<dl class="diary-action-kv">${items.map(([key, value]) => `
      <dt>${escHtml(key)}</dt><dd>${escHtml(value ?? '')}</dd>
    `).join('')}</dl>`;
  }

  function selectionKey(type, index) {
    return `${type}:${index}`;
  }

  function rowsForType(type) {
    const data = state.data || {};
    if (type === 'moment') return data.source_moments || [];
    if (type === 'action') return data.next_actions || [];
    return [];
  }

  function rowLabel(type, row) {
    if (type === 'moment') return row.title || row.event_id || 'source moment';
    if (type === 'action') return row.title || row.event_id || 'next action';
    return 'diary row';
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
      label: rowLabel(type, row),
      row,
    };
    applySelectionStyles();
  }

  function selectionAttrs(type, index) {
    return `data-diary-select-type="${escHtml(type)}" data-diary-select-index="${escHtml(index)}" tabindex="0"`;
  }

  function applySelectionStyles() {
    document.querySelectorAll('[data-diary-selected="true"]').forEach(node => {
      node.removeAttribute('data-diary-selected');
    });
    if (!state.selection) return;
    document.querySelectorAll('[data-diary-select-type]').forEach(node => {
      if (selectionKey(node.dataset.diarySelectType, node.dataset.diarySelectIndex) === state.selection.key) {
        node.setAttribute('data-diary-selected', 'true');
      }
    });
  }

  function renderStatus(data) {
    const strip = el('diary-status-strip');
    if (!strip) return;
    const tone = statusTone(data.status);
    strip.innerHTML = `
      <span class="diary-status-dot diary-status-dot--${tone}" aria-hidden="true"></span>
      <span>${escHtml(String(data.status || 'unknown').replace(/_/g, ' '))}</span>
      <span>${escHtml(data.local_date || state.date)}</span>
    `;
  }

  function renderMeta(data) {
    const meta = el('diary-day-meta');
    if (meta) {
      const ledger = data.files?.source_ledger || {};
      meta.textContent = `${data.local_date || state.date} - ${data.timezone || ''} - ledger ${ledger.exists ? 'linked' : 'empty'}`;
    }
    const input = el('diary-date-input');
    if (input) input.value = data.local_date || state.date;
    const filter = el('diary-filter-strip');
    if (filter) filter.textContent = `Filter: ${filterLabel(state.sourceFilter)}`;
  }

  function renderMetrics(data) {
    const metrics = el('diary-metrics');
    if (!metrics) return;
    metrics.innerHTML = [
      metric((data.source_moments || []).length, 'source moments'),
      metric((data.next_actions || []).length, 'next actions'),
      metric(data.pin_hidden_count || 0, 'pin-private hidden'),
      metric(data.files?.manifest?.file_count || 0, 'day files'),
    ].join('');
  }

  function renderSummary(data) {
    const summary = el('diary-day-summary');
    if (!summary) return;
    const info = data.summary || {};
    if (info.state === 'ready') {
      summary.innerHTML = `
        <div class="diary-provenance-row">
          <div class="diary-provenance-main">
            <div class="diary-provenance-title">Ready</div>
            <div class="diary-provenance-meta">${escHtml(info.excerpt || info.file_ref || 'day-summary.md')}</div>
          </div>
        </div>
      `;
      return;
    }
    if (info.state === 'summary_pending') {
      summary.innerHTML = '<div class="diary-empty">Summary pending.</div>';
      return;
    }
    summary.innerHTML = '<div class="diary-empty">No summary for this day.</div>';
  }

  function sourceRef(event) {
    const source = event.source || {};
    return source.ref || (Array.isArray(event.file_refs) ? event.file_refs[0] : '') || event.event_id || '';
  }

  function eventRow(event, index, type) {
    const source = event.source || {};
    const ref = sourceRef(event);
    return `
      <div class="${type === 'action' ? 'diary-action-row' : 'diary-moment-row'}" ${selectionAttrs(type, index)}>
        <div class="${type === 'action' ? 'diary-action-main' : 'diary-moment-main'}">
          <div class="${type === 'action' ? 'diary-action-title' : 'diary-moment-title'}">${escHtml(event.title || event.kind || event.event_id)}</div>
          <div class="${type === 'action' ? 'diary-action-meta' : 'diary-moment-meta'}">${escHtml(event.body_excerpt || event.status || '')}</div>
          <div class="${type === 'action' ? 'diary-action-meta' : 'diary-moment-meta'}">${escHtml(ref)}</div>
        </div>
        <span class="diary-moment-source">${escHtml(source.type || event.kind || 'source')}</span>
      </div>
    `;
  }

  function renderMoments(data) {
    const target = el('diary-source-moments');
    const count = el('diary-moments-count');
    const rows = data.source_moments || [];
    if (count) count.textContent = String(rows.length);
    if (!target) return;
    target.innerHTML = rows.length
      ? rows.map((event, index) => eventRow(event, index, 'moment')).join('')
      : '<div class="diary-empty">No source moments for this day.</div>';
  }

  function renderActions(data) {
    const target = el('diary-next-actions');
    const rows = data.next_actions || [];
    if (!target) return;
    target.innerHTML = rows.length
      ? rows.map((event, index) => eventRow(event, index, 'action')).join('')
      : '<div class="diary-empty">No next actions for this day.</div>';
  }

  function renderProvenance(data) {
    const target = el('diary-provenance');
    if (!target) return;
    const files = data.files || {};
    const rows = [
      ['Day folder', files.day_folder?.path || '', files.day_folder?.exists ? 'exists' : 'empty'],
      ['Source ledger', files.source_ledger?.path || '', files.source_ledger?.exists ? `${files.source_ledger.source_count || 0} sources` : 'empty'],
      ['Manifest', files.manifest?.path || '', files.manifest?.exists ? `${files.manifest.file_count || 0} files` : 'empty'],
      ['Events API', data.provenance?.events_endpoint || '', 'projection'],
    ];
    target.innerHTML = rows.map(([title, path, meta]) => `
      <div class="diary-provenance-row">
        <div class="diary-provenance-main">
          <div class="diary-provenance-title">${escHtml(title)}</div>
          <div class="diary-provenance-meta">${escHtml(path)}</div>
          <div class="diary-provenance-meta">${escHtml(meta)}</div>
        </div>
      </div>
    `).join('');
  }

  function renderError(message) {
    const strip = el('diary-status-strip');
    if (strip) {
      strip.innerHTML = `
        <span class="diary-status-dot diary-status-dot--err" aria-hidden="true"></span>
        <span>${escHtml(message)}</span>
      `;
    }
    const meta = el('diary-day-meta');
    if (meta) meta.textContent = 'Diary refresh failed';
  }

  function render(data) {
    renderStatus(data);
    renderMeta(data);
    renderMetrics(data);
    renderSummary(data);
    renderMoments(data);
    renderActions(data);
    renderProvenance(data);
    applySelectionStyles();
    if (window.BodyShade && typeof window.BodyShade.scheduleSizeFillTable === 'function') {
      window.BodyShade.scheduleSizeFillTable();
    }
  }

  async function load(options = {}) {
    if (state.loading) return state.data;
    if (state.loaded && !options.force) return state.data;
    state.loading = true;
    state.error = '';
    try {
      const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
      const params = new URLSearchParams({ date: state.date, source_filter: state.sourceFilter });
      const resp = await fetcher(`/api/v1/personal/diary-day?${params.toString()}`);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.detail || `HTTP ${resp.status}`);
      state.data = data;
      state.loaded = true;
      render(data);
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
    state.date = localDateString(new Date(`${dateText}T00:00:00`));
    state.loaded = false;
    state.selection = null;
    return load({ force: true });
  }

  function setSourceFilter(filter) {
    state.sourceFilter = ['all', 'manual', 'sources', 'git', 'imports', 'work'].includes(filter) ? filter : 'all';
    state.loaded = false;
    return load({ force: true });
  }

  function closeActionModal() {
    const modal = el('diary-action-modal');
    if (!modal) return;
    if (typeof HubModal !== 'undefined') HubModal.close(modal);
    else if (typeof modal.close === 'function') modal.close();
  }

  function showActionModal(title, html, status = '') {
    const modal = el('diary-action-modal');
    const titleEl = el('diary-action-modal-title');
    const body = el('diary-action-modal-body');
    const statusEl = el('diary-action-modal-status');
    if (!modal || !body) return false;
    if (titleEl) titleEl.textContent = title;
    body.innerHTML = html;
    if (statusEl) statusEl.textContent = status;
    if (typeof HubModal !== 'undefined') HubModal.open(modal);
    else if (typeof modal.showModal === 'function' && !modal.open) modal.showModal();
    return true;
  }

  function showDayFolder() {
    const folder = state.data?.files?.day_folder || {};
    return showActionModal('Day Folder', kvHtml([
      ['Date', state.data?.local_date || state.date],
      ['Path', folder.path || ''],
      ['State', folder.exists ? 'exists' : 'empty'],
    ]));
  }

  function showSourceLedger() {
    const ledger = state.data?.files?.source_ledger || {};
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

  function explainSelection() {
    const data = state.data || {};
    if (state.selection?.row) {
      const event = state.selection.row;
      const source = event.source || {};
      return showActionModal(
        `Selected ${state.selection.label}`,
        `${kvHtml([
          ['Event', event.event_id || ''],
          ['Source', source.type || ''],
          ['Ref', sourceRef(event)],
          ['Projection', event.projection_state || ''],
          ['Provenance', event.provenance_state || ''],
        ])}<pre style="white-space:pre-wrap;overflow-wrap:anywhere;margin:0">${escHtml(JSON.stringify(event.provenance || {}, null, 2))}</pre>`
      );
    }
    return showActionModal('Diary Day', kvHtml([
      ['Date', data.local_date || state.date],
      ['Status', data.status || 'unknown'],
      ['Filter', filterLabel(state.sourceFilter)],
      ['Source moments', data.source_moments?.length || 0],
      ['Pin hidden', data.pin_hidden_count || 0],
    ]));
  }

  function showPinPrivate() {
    const data = state.data || {};
    return showActionModal('Pin-Private Items', kvHtml([
      ['Hidden count', data.pin_hidden_count || 0],
      ['Date', data.local_date || state.date],
      ['Visible moments', data.source_moments?.length || 0],
      ['Privacy state', data.pin_hidden_count ? 'hidden by v1 privacy filter' : 'none hidden'],
    ]));
  }

  function linkWorkItem() {
    const event = state.selection?.row;
    if (!event) {
      return showActionModal('Link Work', '<p>Select a source moment before linking a work item.</p>');
    }
    return showActionModal(
      'Link Work',
      `${kvHtml([
        ['Event', event.event_id || ''],
        ['Current links', (event.related?.work_items || []).join(', ') || 'none'],
      ])}
      <label class="diary-date-control" style="width:100%;grid-template-columns:1fr">
        <span>Work ref</span>
        <input id="diary-work-link-input" type="text" autocomplete="off" />
      </label>
      <button class="diary-command-btn" type="button" data-diary-modal-action="submit-work-link">Link Work</button>`
    );
  }

  async function submitWorkLink() {
    const event = state.selection?.row;
    const input = el('diary-work-link-input');
    const workRef = String(input?.value || '').trim();
    if (!event || !event.event_id || !workRef) return false;
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const resp = await fetcher(`/api/v1/personal/events/${encodeURIComponent(event.event_id)}/work-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        work_item_ref: workRef,
        actor: 'blueprints-ui',
        source_surface: 'diary-page',
        request_id: `ui-work-link-${Date.now()}`,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      showActionModal('Link Work', `<p>${escHtml(data.detail || `HTTP ${resp.status}`)}</p>`);
      return false;
    }
    await load({ force: true });
    showActionModal('Link Work', kvHtml([
      ['Event', data.event?.event_id || event.event_id],
      ['Work ref', workRef],
      ['Audit', data.audit?.audit_id || ''],
    ]), 'Work link recorded.');
    return true;
  }

  async function generateSummary() {
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const resp = await fetcher('/api/v1/personal/diary-day/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        local_date: state.date,
        actor: 'blueprints-ui',
        source_surface: 'diary-page',
        request_id: `ui-summary-${Date.now()}`,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      showActionModal('Generate Summary', `<p>${escHtml(data.detail || `HTTP ${resp.status}`)}</p>`);
      return false;
    }
    state.data = data.day;
    state.loaded = true;
    render(data.day);
    return showActionModal('Generate Summary', kvHtml([
      ['File', data.summary?.file_ref || ''],
      ['Source hash', data.summary?.source_hash || ''],
      ['Events', data.summary?.event_count || 0],
      ['Audit', data.audit?.audit_id || ''],
    ]), 'Summary file written.');
  }

  async function submitEntry() {
    const textarea = el('diary-quick-entry-body');
    const status = el('diary-entry-status');
    const text = String(textarea?.value || '').trim();
    if (!text) {
      if (status) status.textContent = 'Entry body is required.';
      return false;
    }
    if (status) status.textContent = 'Saving entry...';
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const resp = await fetcher('/api/v1/personal/diary-day/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: text,
        local_date: state.date,
        actor: 'blueprints-ui',
        source_surface: 'diary-page',
        request_id: `ui-entry-${Date.now()}`,
        tags: ['quick-entry'],
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      if (status) status.textContent = data.detail || `HTTP ${resp.status}`;
      return false;
    }
    if (textarea) textarea.value = '';
    if (status) status.textContent = `Saved ${data.write?.file_ref || ''}`;
    state.lastWrite = data;
    state.data = data.day;
    state.loaded = true;
    render(data.day);
    return true;
  }

  async function safeChecks() {
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const params = new URLSearchParams({ date: state.date, source_filter: state.sourceFilter });
    const first = await fetcher(`/api/v1/personal/diary-day?${params.toString()}`).then(resp => resp.json());
    const second = await fetcher(`/api/v1/personal/diary-day?${params.toString()}`).then(resp => resp.json());
    state.data = second;
    state.loaded = true;
    render(second);
    return showActionModal('Safe Checks', kvHtml([
      ['Read route', '/api/v1/personal/diary-day'],
      ['Date', second.local_date || state.date],
      ['Status stable', first.status === second.status ? 'yes' : 'no'],
      ['Moments stable', (first.source_moments || []).length === (second.source_moments || []).length ? 'yes' : 'no'],
      ['Source ledger', second.files?.source_ledger?.exists ? 'linked' : 'empty'],
    ]), 'No write command was run.');
  }

  function bind() {
    const root = document.querySelector('[data-diary-page]');
    if (!root || root.dataset.diaryBound === '1') return;
    root.dataset.diaryBound = '1';
    root.addEventListener('click', event => {
      const selectable = event.target.closest('[data-diary-select-type]');
      if (selectable) {
        setSelection(selectable.dataset.diarySelectType, selectable.dataset.diarySelectIndex);
      }
      const btn = event.target.closest('[data-diary-action]');
      if (!btn) return;
      const action = btn.dataset.diaryAction;
      if (action === 'previous-day') setDate(shiftDate(state.date, -1));
      if (action === 'today') setDate(localDateString(new Date()));
      if (action === 'next-day') setDate(shiftDate(state.date, 1));
      if (action === 'refresh') load({ force: true });
      if (action === 'submit-entry') submitEntry();
      if (action === 'generate-summary') generateSummary();
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
    ['diary-action-modal-close', 'diary-action-modal-footer-close'].forEach(id => {
      const btn = el(id);
      if (btn) btn.addEventListener('click', closeActionModal);
    });
    const modalBody = el('diary-action-modal-body');
    if (modalBody) {
      modalBody.addEventListener('click', event => {
        const btn = event.target.closest('[data-diary-modal-action]');
        if (!btn) return;
        if (btn.dataset.diaryModalAction === 'submit-work-link') submitWorkLink();
      });
    }
  }

  function snapshot() {
    return {
      loaded: state.loaded,
      loading: state.loading,
      status: state.data?.status || '',
      local_date: state.data?.local_date || state.date,
      source_filter: state.sourceFilter,
      moment_count: state.data?.source_moments?.length || 0,
      next_action_count: state.data?.next_actions?.length || 0,
      pin_hidden_count: state.data?.pin_hidden_count || 0,
      summary_state: state.data?.summary?.state || '',
      ledger_exists: !!state.data?.files?.source_ledger?.exists,
      day_folder_exists: !!state.data?.files?.day_folder?.exists,
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
    previousDay: () => setDate(shiftDate(state.date, -1)),
    nextDay: () => setDate(shiftDate(state.date, 1)),
    today: () => setDate(localDateString(new Date())),
    newEntry: () => {
      const field = el('diary-quick-entry-body');
      if (field) field.focus();
      return true;
    },
    submitEntry,
    openDayFolder: showDayFolder,
    openSourceLedger: showSourceLedger,
    filterAll: () => setSourceFilter('all'),
    filterManual: () => setSourceFilter('manual'),
    filterSources: () => setSourceFilter('sources'),
    filterGit: () => setSourceFilter('git'),
    filterImports: () => setSourceFilter('imports'),
    showPinPrivate,
    linkWorkItem,
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
    'diary.previousDay': () => DiaryPage.previousDay(),
    'diary.nextDay': () => DiaryPage.nextDay(),
    'diary.today': () => DiaryPage.today(),
    'diary.newEntry': () => DiaryPage.newEntry(),
    'diary.openDayFolder': () => DiaryPage.openDayFolder(),
    'diary.openSourceLedger': () => DiaryPage.openSourceLedger(),
    'diary.filterAll': () => DiaryPage.filterAll(),
    'diary.filterManual': () => DiaryPage.filterManual(),
    'diary.filterSources': () => DiaryPage.filterSources(),
    'diary.filterGit': () => DiaryPage.filterGit(),
    'diary.filterImports': () => DiaryPage.filterImports(),
    'diary.showPinPrivate': () => DiaryPage.showPinPrivate(),
    'diary.linkWorkItem': () => DiaryPage.linkWorkItem(),
    'diary.generateSummary': () => DiaryPage.generateSummary(),
    'diary.explainSelection': () => DiaryPage.explainSelection(),
    'diary.safeChecks': () => DiaryPage.safeChecks(),
  });
}
