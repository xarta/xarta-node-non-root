// Dave ToDo page - task/action view over personal tasks and shared events.

'use strict';

const TodoPage = (() => {
  const CONTENT_VIEW_STORAGE_KEY = 'blueprints.todo.contentView.v1';
  const CONTENT_VIEW_IDS = ['tasks', 'search', 'new-task', 'edit-task', 'sources', 'provenance'];
  const CONTENT_VIEW_LABELS = {
    tasks: 'Tasks',
    search: 'Search',
    'new-task': 'New task',
    'edit-task': 'Edit task',
    sources: 'Sources',
    provenance: 'Provenance',
  };

  function normalizeContentView(value) {
    const clean = String(value || '').trim();
    return CONTENT_VIEW_IDS.includes(clean) ? clean : 'tasks';
  }

  function readStoredContentView() {
    try {
      return normalizeContentView(localStorage.getItem(CONTENT_VIEW_STORAGE_KEY));
    } catch (_) {
      return 'tasks';
    }
  }

  const state = {
    loaded: false,
    loading: false,
    data: null,
    error: '',
    mode: 'today',
    contentView: readStoredContentView(),
    selection: null,
    routeTaskRef: '',
    routeHighlightRef: '',
    lastWrite: null,
  };

  const modes = ['today', 'personal', 'work', 'blocked', 'review', 'done'];

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

  function modeLabel(mode) {
    const labels = {
      today: 'Today',
      personal: 'Personal',
      work: 'Work',
      blocked: 'Blocked',
      review: 'Review',
      done: 'Done',
    };
    return labels[mode] || 'Today';
  }

  function contentViewLabel(view) {
    return CONTENT_VIEW_LABELS[normalizeContentView(view)] || 'Tasks';
  }

  function splitRefs(value) {
    return String(value || '')
      .split(/[,\s]+/)
      .map(item => item.trim())
      .filter(Boolean)
      .filter((item, index, array) => array.indexOf(item) === index);
  }

  function routeParams() {
    try {
      return new URLSearchParams(window.location.search || '');
    } catch (_) {
      return new URLSearchParams('');
    }
  }

  function cleanTaskRef(value) {
    return String(value || '').trim().replace(/[^a-zA-Z0-9_.:-]+/g, '-').slice(0, 180);
  }

  function routeTaskRef() {
    const params = routeParams();
    return cleanTaskRef(
      params.get('todo_task_id')
      || params.get('todo_ref')
      || params.get('todo_event_id')
      || params.get('task_id')
      || ''
    );
  }

  function writeRouteTaskRef(taskRef, options = {}) {
    if (!window.history || !window.location) return;
    const clean = cleanTaskRef(taskRef);
    const url = new URL(window.location.href);
    url.searchParams.set('group', 'dave');
    url.searchParams.set('tab', 'todo');
    ['todo_task_id', 'todo_ref', 'todo_event_id', 'task_id'].forEach(key => {
      url.searchParams.delete(key);
    });
    if (clean) url.searchParams.set('todo_task_id', clean);
    const method = options.push ? 'pushState' : 'replaceState';
    window.history[method](window.history.state, '', url);
  }

  function taskRouteUrl(taskRef) {
    const clean = cleanTaskRef(taskRef);
    if (!clean || !window.location) return '';
    const url = new URL(window.location.href);
    url.searchParams.set('group', 'dave');
    url.searchParams.set('tab', 'todo');
    url.searchParams.set('todo_task_id', clean);
    return `${url.pathname}${url.search}${url.hash || ''}`;
  }

  function cleanWorkRef(value) {
    return String(value || '').trim().replace(/[^a-zA-Z0-9_.:-]+/g, '-').slice(0, 180);
  }

  function workRouteUrl(workRef) {
    const clean = cleanWorkRef(workRef);
    if (!clean || !window.location) return '';
    if (window.BlueprintsKanbanBoardPage?.itemRouteUrl) return window.BlueprintsKanbanBoardPage.itemRouteUrl(clean);
    const url = new URL(window.location.href);
    url.searchParams.set('group', 'kanban');
    url.searchParams.set('tab', 'kanban');
    url.searchParams.set('detail_item_id', clean);
    return `${url.pathname}${url.search}${url.hash || ''}`;
  }

  function workLinkHtml(workRef) {
    const clean = cleanWorkRef(workRef);
    const href = workRouteUrl(clean);
    if (!clean || !href) return '';
    return `<a class="todo-related-link todo-related-link--work" href="${escHtml(href)}" data-todo-work-link="${escHtml(clean)}">${escHtml(clean)}</a>`;
  }

  function openWorkLink(workRef) {
    const clean = cleanWorkRef(workRef);
    if (!clean) return false;
    if (typeof switchGroup === 'function') switchGroup('kanban');
    if (typeof switchTab === 'function') switchTab('kanban');
    if (window.KanbanMenuConfig?.updateActiveTab) window.KanbanMenuConfig.updateActiveTab('kanban');
    if (window.BlueprintsKanbanBoardPage?.openItemById) return window.BlueprintsKanbanBoardPage.openItemById(clean);
    window.location.href = workRouteUrl(clean);
    return true;
  }

  function sourceType(task) {
    return task?.source?.type || '';
  }

  function sourceAuthority(task) {
    return task?.source?.authority || '';
  }

  function canWriteTask(task) {
    return sourceAuthority(task) === 'task' && sourceType(task) === 'manual-task';
  }

  function editTaskAvailable() {
    return Boolean(state.selection?.row && canWriteTask(state.selection.row));
  }

  function rawTaskRows() {
    return state.data?.items || [];
  }

  function taskFilterRecord(row) {
    const tags = [
      'task',
      'tasks',
      row?.mode,
      row?.status,
      sourceType(row),
      sourceAuthority(row),
      ...(row?.related?.work_items?.length ? ['work'] : []),
    ].filter(Boolean);
    return {
      ...row,
      kind: 'task',
      tags,
    };
  }

  function taskRows() {
    const rows = rawTaskRows();
    if (!window.PersonalFilters?.matchesRecord) return rows;
    return rows.filter(row => window.PersonalFilters.matchesRecord(taskFilterRecord(row), 'todo'));
  }

  function taskCandidateRefs(row) {
    const refs = [
      row?.task_id,
      row?.event_id,
      row?.source?.ref,
      ...(row?.related?.tasks || []),
    ].filter(Boolean).map(value => String(value).trim()).filter(Boolean);
    if (row?.task_id) refs.push(`personal_time_tasks:${row.task_id}`);
    if (row?.event_id) refs.push(`personal_events:${row.event_id}`);
    return refs.filter((value, index, array) => array.indexOf(value) === index);
  }

  function taskMatchesRef(row, taskRef) {
    const clean = cleanTaskRef(taskRef);
    if (!clean) return false;
    const candidates = taskCandidateRefs(row).flatMap(value => {
      const text = String(value || '').trim();
      const tail = text.includes(':') ? text.split(':').pop() : '';
      return tail ? [text, tail] : [text];
    });
    return candidates.some(value => value === clean);
  }

  function findTaskIndexByRef(taskRef) {
    return taskRows().findIndex(row => taskMatchesRef(row, taskRef));
  }

  function taskLabel(row) {
    return row?.title || row?.task_id || 'task';
  }

  function stripFrontmatter(md) {
    if (window.BlueprintsMarkdown?.stripFrontmatter) return window.BlueprintsMarkdown.stripFrontmatter(md);
    return String(md || '').replace(/^---\s*\n[\s\S]*?\n---\s*(\n|$)/, '');
  }

  function renderMarkdown(md, emptyText = 'No task content.') {
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

  function markdownPreviewHtml(body, className = '', emptyText = 'No task content.', showEmpty = false) {
    const clean = stripFrontmatter(body).trim();
    if (!clean && !showEmpty) return '';
    const classes = ['calendar-markdown-preview', className].filter(Boolean).join(' ');
    return `<div class="${escHtml(classes)}">${renderMarkdown(clean, emptyText)}</div>`;
  }

  function taskTime(row) {
    if (!row?.due_at) return row?.local_date || '';
    const meta = row?.provenance?.task || {};
    if (meta.due_time) return `${row.local_date || ''} ${meta.due_time}`.trim();
    const date = new Date(row.due_at);
    if (Number.isNaN(date.getTime())) return row.local_date || '';
    return `${row.local_date || ''} ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`.trim();
  }

  function statusTone(status) {
    const clean = String(status || '').toLowerCase();
    if (clean === 'open' || clean === 'ready' || clean === 'ok') return 'ok';
    if (clean === 'pending_review') return 'warn';
    if (clean === 'blocked' || clean === 'error') return 'err';
    return 'unknown';
  }

  function metric(value, label) {
    return `<div class="todo-metric"><span class="todo-metric__value">${escHtml(value)}</span><span class="todo-metric__label">${escHtml(label)}</span></div>`;
  }

  function markdownFieldHtml(prefix, label, value = '', options = {}) {
    const safePrefix = String(prefix || 'todo-task').replace(/[^a-zA-Z0-9_-]/g, '-');
    const actionAttr = options.modal
      ? 'data-todo-modal-action="toggle-markdown-preview"'
      : 'data-todo-action="toggle-markdown-preview"';
    return `
      <div class="todo-field todo-field--wide todo-field--notes calendar-markdown-field">
        <div class="calendar-field__label-row">
          <span>${escHtml(label || 'Notes')}</span>
          <button class="calendar-markdown-toggle" type="button" ${actionAttr} data-todo-markdown-prefix="${escHtml(safePrefix)}">Preview</button>
        </div>
        <textarea id="${escHtml(safePrefix)}-body" rows="${escHtml(options.rows || 2)}" maxlength="${escHtml(options.maxlength || 2000)}">${escHtml(value)}</textarea>
        <div id="${escHtml(safePrefix)}-body-preview" class="calendar-markdown-preview" hidden></div>
      </div>
    `;
  }

  function kvHtml(items) {
    return `<dl class="todo-action-kv">${items.map(([key, value]) => `
      <dt>${escHtml(key)}</dt><dd>${escHtml(value ?? '')}</dd>
    `).join('')}</dl>`;
  }

  function setSelection(index, options = {}) {
    const idx = Number(index);
    const row = taskRows()[idx];
    if (!row) return;
    if (options.routeTargetRef) state.routeHighlightRef = cleanTaskRef(options.routeTargetRef);
    else if (!options.preserveRouteTarget) state.routeHighlightRef = '';
    state.selection = {
      index: idx,
      key: String(row.task_id || row.event_id || idx),
      label: taskLabel(row),
      row,
    };
    renderSelection();
    applySelectionStyles();
    refreshActiveEditTaskPanels();
  }

  function applySelectionStyles() {
    document.querySelectorAll('[data-todo-selected="true"]').forEach(node => {
      node.removeAttribute('data-todo-selected');
    });
    document.querySelectorAll('[data-todo-route-target="true"]').forEach(node => {
      node.removeAttribute('data-todo-route-target');
    });
    if (!state.selection) return;
    document.querySelectorAll('.todo-task-row[data-todo-index]').forEach(node => {
      if (Number(node.dataset.todoIndex) === state.selection.index) {
        node.setAttribute('data-todo-selected', 'true');
        if (state.routeHighlightRef && taskMatchesRef(state.selection.row, state.routeHighlightRef)) {
          node.setAttribute('data-todo-route-target', 'true');
        }
      }
    });
  }

  function scrollSelectionIntoView(options = {}) {
    if (!state.selection) return;
    window.requestAnimationFrame(() => {
      const row = document.querySelector(`.todo-task-row[data-todo-index="${state.selection.index}"]`);
      row?.scrollIntoView?.({
        block: options.center ? 'center' : 'nearest',
        inline: 'nearest',
      });
    });
  }

  function selectTaskRef(taskRef, options = {}) {
    const index = findTaskIndexByRef(taskRef);
    if (index < 0) return false;
    setSelection(index, { routeTargetRef: options.routeTarget ? taskRef : '', preserveRouteTarget: !options.routeTarget });
    scrollSelectionIntoView({ center: !!options.routeTarget });
    return true;
  }

  async function applyRouteTaskSelection(options = {}) {
    const clean = cleanTaskRef(state.routeTaskRef || routeTaskRef());
    if (!clean) return false;
    state.routeTaskRef = clean;
    if (selectTaskRef(clean, { routeTarget: true })) return true;
    if (options.searchModes === false) return false;
    for (const mode of modes) {
      if (mode === state.mode) continue;
      state.mode = mode;
      state.loaded = false;
      await load({ force: true, skipRouteSearch: true });
      if (selectTaskRef(clean, { routeTarget: true })) {
        renderMeta();
        return true;
      }
    }
    return false;
  }

  function renderStatus() {
    const strip = el('todo-status-strip');
    if (!strip) return;
    const status = state.error ? 'error' : (state.loaded ? 'ready' : 'empty');
    const tone = statusTone(status);
    strip.innerHTML = `
      <span class="todo-status-dot todo-status-dot--${tone}" aria-hidden="true"></span>
      <span>${escHtml(status)}</span>
      <span>${escHtml(modeLabel(state.mode))}</span>
    `;
  }

  function renderMeta() {
    const rows = taskRows();
    const meta = el('todo-meta');
    if (meta) meta.textContent = `${modeLabel(state.mode)} - ${rows.length} visible task${rows.length === 1 ? '' : 's'}`;
    const filter = el('todo-filter-strip');
    if (filter) {
      filter.innerHTML = window.PersonalFilters?.summaryHtml
        ? window.PersonalFilters.summaryHtml('todo', { prefix: 'Filter:', emptyLabel: 'all tasks' })
        : 'Filter: all tasks';
    }
    document.querySelectorAll('[data-todo-mode-button]').forEach(btn => {
      btn.dataset.active = btn.dataset.todoModeButton === state.mode ? 'true' : 'false';
    });
  }

  function renderContentPanels() {
    document.querySelectorAll('[data-todo-content-view]').forEach(panel => {
      panel.hidden = panel.dataset.todoContentView !== state.contentView;
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

  function renderMetrics() {
    const target = el('todo-metrics');
    if (!target) return;
    const counts = state.data?.counts?.modes || {};
    target.innerHTML = [
      metric(taskRows().length, 'visible'),
      metric(counts.today || 0, 'today'),
      metric(counts.personal || 0, 'personal'),
      metric(counts.work || 0, 'work'),
      metric(counts.blocked || 0, 'blocked'),
      metric(counts.done || 0, 'done'),
    ].join('');
  }

  function taskRowHtml(row, index) {
    const status = row.status || 'open';
    const refs = row.related?.work_items || [];
    const writable = canWriteTask(row);
    return `
      <article class="todo-task-row" data-todo-index="${index}" tabindex="0">
        <div class="todo-task-main">
          <div class="todo-task-title">${escHtml(taskLabel(row))}</div>
          <div class="todo-task-meta">${escHtml(taskTime(row) || 'no due time')} - ${escHtml(sourceType(row) || 'unknown')} - ${escHtml(row.mode || '')}</div>
          ${markdownPreviewHtml(row.body_excerpt || '', 'todo-task-body', 'No task content.')}
          ${refs.length ? `<div class="todo-task-meta todo-task-meta--links">work ${refs.map(workLinkHtml).join(' ')}</div>` : ''}
        </div>
        <span class="todo-task-status todo-task-status--${escHtml(status)}">${escHtml(status)}</span>
        <span class="todo-task-source">${escHtml(row.source?.authority || 'source')}</span>
        <div class="todo-row-actions" aria-label="Task actions">
          <button class="todo-row-btn todo-row-btn--complete" type="button" data-todo-row-action="complete" data-todo-index="${index}" title="Complete task" aria-label="Complete task" ${writable ? '' : 'disabled'}></button>
          <button class="todo-row-btn todo-row-btn--edit" type="button" data-todo-row-action="edit" data-todo-index="${index}" title="Edit task" aria-label="Edit task" ${writable ? '' : 'disabled'}></button>
          <button class="todo-row-btn todo-row-btn--archive" type="button" data-todo-row-action="archive" data-todo-index="${index}" title="Archive task" aria-label="Archive task" ${writable ? '' : 'disabled'}></button>
        </div>
      </article>
    `;
  }

  function renderTasks() {
    const list = el('todo-task-list');
    if (!list) return;
    const rows = taskRows();
    list.innerHTML = rows.length
      ? rows.map(taskRowHtml).join('')
      : '<div class="todo-empty">No tasks in this mode.</div>';
  }

  function detailRow(title, meta, body = '', options = {}) {
    return `
      <div class="todo-detail-row">
        <div class="todo-detail-main">
          <div class="todo-detail-title">${escHtml(title)}</div>
          <div class="todo-detail-meta">${escHtml(meta || '')}</div>
          ${body ? `<div class="todo-detail-meta${options.bodyHtml ? ' todo-detail-meta--markdown' : ''}">${options.bodyHtml ? body : escHtml(body)}</div>` : ''}
        </div>
      </div>
    `;
  }

  function renderSelection() {
    const detail = el('todo-selection-detail');
    if (!detail) return;
    detail.innerHTML = selectionDetailHtml();
  }

  function selectionDetailHtml() {
    const row = state.selection?.row;
    if (!row) {
      return '<div class="todo-empty">Select a task to inspect actions and provenance.</div>';
    }
    return [
      detailRow(row.title || row.task_id, `${row.status || ''} - ${row.mode || ''}`, markdownPreviewHtml(row.body_excerpt || '', 'todo-detail-body', 'No task content.', true), { bodyHtml: true }),
      detailRow('Due', taskTime(row) || 'none', row.timezone || ''),
      detailRow('Source', `${sourceType(row)} - ${row.source?.authority || ''}`, row.source?.ref || ''),
      detailRow('Work Links', (row.related?.work_items || []).join(', ') || 'none'),
    ].join('');
  }

  function renderSources() {
    const target = el('todo-source-list');
    if (!target) return;
    target.innerHTML = sourcesHtml();
  }

  function sourcesHtml() {
    const counts = state.data?.counts?.sources || {};
    const rows = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
    return rows.length
      ? rows.map(([source, count]) => detailRow(source, `${count} task${count === 1 ? '' : 's'}`)).join('')
      : '<div class="todo-empty">No source counts yet.</div>';
  }

  function renderProvenance() {
    const target = el('todo-provenance');
    if (!target) return;
    target.innerHTML = provenanceHtml();
  }

  function provenanceHtml() {
    return [
      detailRow('Task API', `/api/v1/personal/tasks?mode=${state.mode}`, 'shared task response'),
      detailRow('Write API', '/api/v1/personal/tasks', 'manual-task source with durable files'),
      detailRow('Calendar Projection', 'personal_events kind=task', 'due tasks render in Calendar'),
      detailRow('Mode', modeLabel(state.mode), `${taskRows().length} visible rows`),
    ].join('');
  }

  function embeddedSelectedHtml(options = {}) {
    const head = options.modal
      ? ''
      : `<div class="calendar-section-head todo-section-head">
          <h3>Selected Task</h3>
          <span class="todo-pill">${escHtml(state.selection ? 'Selected' : 'None')}</span>
        </div>`;
    return `<section class="calendar-band todo-band todo-band--embedded-selected" aria-label="Selected Task">
      ${head}
      <div class="todo-detail-list">${selectionDetailHtml()}</div>
    </section>`;
  }

  function embeddedSourcesHtml(options = {}) {
    const head = options.modal
      ? ''
      : `<div class="calendar-section-head todo-section-head"><h3>Sources</h3></div>`;
    return `<section class="calendar-band todo-band todo-band--embedded-sources" aria-label="Sources">
      ${head}
      <div class="todo-detail-list">${sourcesHtml()}</div>
    </section>`;
  }

  function embeddedProvenanceHtml(options = {}) {
    const head = options.modal
      ? ''
      : `<div class="calendar-section-head todo-section-head"><h3>Provenance</h3></div>`;
    return `<section class="calendar-band todo-band todo-band--embedded-provenance" aria-label="Provenance">
      ${head}
      <div class="todo-detail-list">${provenanceHtml()}</div>
    </section>`;
  }

  function embeddedSearchHtml(host) {
    const instance = host?.id === 'todo-filter-inline-panel'
      ? 'todo-inline-search'
      : (host?.closest?.('#ultrawide-sidecar-body') ? 'todo-sidecar-search' : 'todo-panel-search');
    window.setTimeout(() => {
      if (window.BlueprintsPersonalSearch?.init) window.BlueprintsPersonalSearch.init();
    }, 0);
    return `<div class="personal-search-strip personal-search-strip--embedded" data-personal-search-surface="todo" data-personal-search-instance="${escHtml(instance)}"></div>`;
  }

  function embeddedTaskFormHtml(prefix = 'todo-inline-task', options = {}) {
    const safePrefix = String(prefix || 'todo-inline-task').replace(/[^a-zA-Z0-9_-]/g, '-');
    const valueFor = (key, fallback = '') => String(el(`${safePrefix}-${key}`)?.value || fallback);
    const actionAttr = options.modal ? 'data-todo-modal-action="submit-task"' : 'data-todo-action="submit-task"';
    return `
      <section class="calendar-quick-event calendar-quick-event--embedded todo-quick-task todo-quick-task--embedded" aria-label="New Task">
        <div class="todo-form-grid">
          <label class="todo-field todo-field--wide" for="${escHtml(safePrefix)}-title">
            <span>Title</span>
            <input id="${escHtml(safePrefix)}-title" type="text" maxlength="180" autocomplete="off" value="${escHtml(valueFor('title'))}" />
          </label>
          <label class="todo-field" for="${escHtml(safePrefix)}-date">
            <span>Due</span>
            <input id="${escHtml(safePrefix)}-date" type="date" value="${escHtml(valueFor('date', localDateString(new Date())))}" />
          </label>
          <label class="todo-field" for="${escHtml(safePrefix)}-time">
            <span>Time</span>
            <input id="${escHtml(safePrefix)}-time" type="time" value="${escHtml(valueFor('time'))}" />
          </label>
          <label class="todo-field" for="${escHtml(safePrefix)}-mode">
            <span>Mode</span>
            <select id="${escHtml(safePrefix)}-mode">
              <option value="personal" ${valueFor('mode', state.mode) === 'personal' ? 'selected' : ''}>Personal</option>
              <option value="work" ${valueFor('mode', state.mode) === 'work' ? 'selected' : ''}>Work</option>
              <option value="review" ${valueFor('mode', state.mode) === 'review' ? 'selected' : ''}>Review</option>
            </select>
          </label>
          <label class="todo-field" for="${escHtml(safePrefix)}-priority">
            <span>Priority</span>
            <select id="${escHtml(safePrefix)}-priority">
              <option value="" ${valueFor('priority') ? '' : 'selected'}>Normal</option>
              <option value="high" ${valueFor('priority') === 'high' ? 'selected' : ''}>High</option>
              <option value="medium" ${valueFor('priority') === 'medium' ? 'selected' : ''}>Medium</option>
              <option value="low" ${valueFor('priority') === 'low' ? 'selected' : ''}>Low</option>
            </select>
          </label>
          ${markdownFieldHtml(safePrefix, 'Notes', valueFor('body'), { modal: !!options.modal })}
          <label class="todo-field todo-field--wide" for="${escHtml(safePrefix)}-work">
            <span>Work refs</span>
            <input id="${escHtml(safePrefix)}-work" type="text" autocomplete="off" value="${escHtml(valueFor('work'))}" />
          </label>
        </div>
        <div class="todo-quick-task__footer">
          <span id="${escHtml(safePrefix)}-status" class="todo-entry-status"></span>
          <button class="todo-command-btn" type="button" ${actionAttr} data-todo-task-prefix="${escHtml(safePrefix)}">Save Task</button>
        </div>
      </section>
    `;
  }

  function embeddedEditTaskFormHtml(prefix = 'todo-inline-edit-task', options = {}) {
    const safePrefix = String(prefix || 'todo-inline-edit-task').replace(/[^a-zA-Z0-9_-]/g, '-');
    const task = state.selection?.row;
    const writable = Boolean(task && canWriteTask(task));
    const disabledAttr = writable ? '' : ' disabled';
    const meta = task?.provenance?.task || {};
    const existingForm = Array.from(document.querySelectorAll('[data-todo-editing-task-id]'))
      .find(form => form.dataset.todoEditingTaskId === String(task?.task_id || ''));
    const preserveExisting = Boolean(task?.task_id && existingForm?.contains(el(`${safePrefix}-title`)));
    const valueFor = (key, fallback = '') => {
      const field = preserveExisting ? el(`${safePrefix}-${key}`) : null;
      return String(field ? field.value : fallback);
    };
    const actionAttr = options.modal ? 'data-todo-modal-action="submit-edit"' : 'data-todo-action="submit-edit"';
    const reason = task
      ? (writable ? '' : 'This task is source-owned and cannot be edited here.')
      : 'Select a manual task before editing.';
    return `
      <section class="calendar-quick-event calendar-quick-event--embedded todo-quick-task todo-quick-task--embedded todo-edit-task" aria-label="Edit Task"${task?.task_id ? ` data-todo-editing-task-id="${escHtml(task.task_id)}"` : ''}>
        <dl class="todo-edit-task__meta">
          <dt>Task</dt><dd>${escHtml(task?.task_id || 'No task selected')}</dd>
          <dt>Source</dt><dd>${escHtml(sourceType(task) || 'none')}</dd>
        </dl>
        <div class="todo-form-grid todo-edit-task__grid">
          <label class="todo-field todo-field--title" for="${escHtml(safePrefix)}-title">
            <span>Title</span>
            <input id="${escHtml(safePrefix)}-title" type="text" maxlength="180" autocomplete="off" value="${escHtml(valueFor('title', task?.title || ''))}"${disabledAttr} />
          </label>
          <label class="todo-field" for="${escHtml(safePrefix)}-date">
            <span>Due</span>
            <input id="${escHtml(safePrefix)}-date" type="date" value="${escHtml(valueFor('date', task?.local_date || localDateString(new Date())))}"${disabledAttr} />
          </label>
          <label class="todo-field" for="${escHtml(safePrefix)}-time">
            <span>Time</span>
            <input id="${escHtml(safePrefix)}-time" type="time" value="${escHtml(valueFor('time', meta.due_time || ''))}"${disabledAttr} />
          </label>
          <label class="todo-field" for="${escHtml(safePrefix)}-mode">
            <span>Mode</span>
            <select id="${escHtml(safePrefix)}-mode"${disabledAttr}>
              <option value="personal" ${valueFor('mode', task?.mode || state.mode) === 'personal' ? 'selected' : ''}>Personal</option>
              <option value="work" ${valueFor('mode', task?.mode || state.mode) === 'work' ? 'selected' : ''}>Work</option>
              <option value="review" ${valueFor('mode', task?.mode || state.mode) === 'review' ? 'selected' : ''}>Review</option>
            </select>
          </label>
          <label class="todo-field" for="${escHtml(safePrefix)}-priority">
            <span>Priority</span>
            <select id="${escHtml(safePrefix)}-priority"${disabledAttr}>
              <option value="" ${valueFor('priority', task?.priority || '') ? '' : 'selected'}>Normal</option>
              <option value="high" ${valueFor('priority', task?.priority || '') === 'high' ? 'selected' : ''}>High</option>
              <option value="medium" ${valueFor('priority', task?.priority || '') === 'medium' ? 'selected' : ''}>Medium</option>
              <option value="low" ${valueFor('priority', task?.priority || '') === 'low' ? 'selected' : ''}>Low</option>
            </select>
          </label>
          ${markdownFieldHtml(safePrefix, 'Notes', valueFor('body', task?.body_excerpt || ''), { modal: !!options.modal, rows: options.modal ? 4 : 3 })}
          <label class="todo-field todo-field--work" for="${escHtml(safePrefix)}-work">
            <span>Work refs</span>
            <input id="${escHtml(safePrefix)}-work" type="text" autocomplete="off" value="${escHtml(valueFor('work', (task?.related?.work_items || []).join(' ')))}"${disabledAttr} />
          </label>
        </div>
        <div class="todo-quick-task__footer todo-edit-task__footer">
          <span id="${escHtml(safePrefix)}-status" class="todo-entry-status">${escHtml(reason)}</span>
          <button class="todo-command-btn" type="button" ${actionAttr} data-todo-task-prefix="${escHtml(safePrefix)}"${writable ? '' : ' disabled'}>Save Task</button>
        </div>
      </section>
    `;
  }

  function renderError(message) {
    const strip = el('todo-status-strip');
    if (strip) {
      strip.innerHTML = `
        <span class="todo-status-dot todo-status-dot--err" aria-hidden="true"></span>
        <span>${escHtml(message)}</span>
      `;
    }
    const meta = el('todo-meta');
    if (meta) meta.textContent = 'ToDo refresh failed';
  }

  function render() {
    renderStatus();
    renderMeta();
    renderContentPanels();
    renderMetrics();
    renderTasks();
    renderSelection();
    renderSources();
    renderProvenance();
    applySelectionStyles();
    if (window.PersonalFilters?.renderAll) window.PersonalFilters.renderAll();
    if (window.BodyShade && typeof window.BodyShade.scheduleSizeFillTable === 'function') {
      window.BodyShade.scheduleSizeFillTable();
    }
  }

  async function load(options = {}) {
    if (state.loading) {
      await new Promise(resolve => {
        let attempts = 0;
        const poll = () => {
          attempts += 1;
          if (!state.loading || attempts > 100) resolve();
          else window.setTimeout(poll, 50);
        };
        poll();
      });
      if (state.loaded && !options.force) {
        if (!options.skipRouteSearch) await applyRouteTaskSelection({ searchModes: true });
        return state.data;
      }
    }
    if (state.loaded && !options.force) {
      if (!options.skipRouteSearch) await applyRouteTaskSelection({ searchModes: true });
      return state.data;
    }
    state.loading = true;
    state.error = '';
    try {
      const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
      const params = new URLSearchParams({ mode: state.mode, limit: '200' });
      const resp = await fetcher(`/api/v1/personal/tasks?${params.toString()}`);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.detail || `HTTP ${resp.status}`);
      state.data = data;
      state.loaded = true;
      state.selection = null;
      render();
      if (!options.skipRouteSearch) {
        state.loading = false;
        await applyRouteTaskSelection({ searchModes: true });
      }
      return data;
    } catch (error) {
      state.error = error.message || String(error);
      renderError(state.error);
      return null;
    } finally {
      state.loading = false;
    }
  }

  function setMode(mode) {
    state.mode = modes.includes(mode) ? mode : 'today';
    setContentView('tasks', { render: false });
    state.loaded = false;
    state.selection = null;
    state.routeTaskRef = '';
    state.routeHighlightRef = '';
    writeRouteTaskRef('');
    return load({ force: true });
  }

  function closeActionModal() {
    const modal = el('todo-action-modal');
    if (!modal) return;
    if (typeof HubModal !== 'undefined') HubModal.close(modal);
    else if (typeof modal.close === 'function') modal.close();
  }

  function showActionModal(title, html, status = '', options = {}) {
    const modal = el('todo-action-modal');
    const titleEl = el('todo-action-modal-title');
    const body = el('todo-action-modal-body');
    const statusEl = el('todo-action-modal-status');
    if (!modal || !body) return false;
    modal.classList.toggle('todo-action-modal--viewport', Boolean(options.viewport));
    if (options.contentView) modal.dataset.todoActionModalView = options.contentView;
    else delete modal.dataset.todoActionModalView;
    if (titleEl) titleEl.textContent = title;
    body.innerHTML = html;
    if (statusEl) statusEl.textContent = status;
    if (typeof HubModal !== 'undefined') HubModal.open(modal);
    else if (typeof modal.showModal === 'function' && !modal.open) modal.showModal();
    return true;
  }

  function toggleMarkdownPreview(target, actionRoot = document) {
    const button = target?.nodeType === 1
      ? target
      : (actionRoot.querySelector?.(`[data-todo-markdown-prefix="${target}"]`) || document.querySelector(`[data-todo-markdown-prefix="${target}"]`));
    const prefix = button?.dataset?.todoMarkdownPrefix || String(target || 'todo-task');
    const field = button?.closest?.('.calendar-markdown-field');
    const body = field?.querySelector?.('textarea') || el(`${prefix}-body`);
    const preview = field?.querySelector?.('.calendar-markdown-preview') || el(`${prefix}-body-preview`);
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

  function setQuickDefaults(prefix = 'todo-inline-task') {
    const date = el(`${prefix}-date`);
    if (date && !date.value) date.value = localDateString(new Date());
    const mode = el(`${prefix}-mode`);
    if (mode && ['personal', 'work', 'review'].includes(state.mode)) mode.value = state.mode;
  }

  function todoPanelHostVisible(host) {
    return hostIsVisible(host);
  }

  function activateTodoPanelTab(tabId) {
    if (!window.PersonalFilters?.activateTab) return false;
    const hosts = [
      el('todo-filter-inline-panel'),
      document.querySelector('#ultrawide-sidecar-body [data-personal-filter-host][data-personal-filter-surface="todo"]'),
    ].filter(Boolean);
    for (const host of hosts) {
      if (!todoPanelHostVisible(host)) continue;
      if (window.PersonalFilters.activateTab('todo', tabId, { host, visibleOnly: true })) return true;
    }
    return false;
  }

  function editPrefixForHost(host) {
    if (host?.id === 'todo-filter-inline-panel') return 'todo-inline-edit-task';
    if (host?.closest?.('#ultrawide-sidecar-body')) return 'todo-sidecar-edit-task';
    return 'todo-panel-edit-task';
  }

  function refreshActiveEditTaskPanels() {
    if (!window.PersonalFilters?.activateTab) return;
    document.querySelectorAll('[data-personal-filter-host][data-personal-filter-surface="todo"]').forEach(host => {
      if (host.dataset.personalFilterTab !== 'edit-task') return;
      if (!hostIsVisible(host)) return;
      window.PersonalFilters.activateTab('todo', 'edit-task', { host, visibleOnly: false });
    });
  }

  function taskPayloadFromForm(prefix = 'todo-task') {
    return {
      title: String(el(`${prefix}-title`)?.value || '').trim(),
      body: String(el(`${prefix}-body`)?.value || '').trim(),
      mode: String(el(`${prefix}-mode`)?.value || 'personal').trim(),
      priority: String(el(`${prefix}-priority`)?.value || '').trim() || null,
      due_date: String(el(`${prefix}-date`)?.value || '').trim() || null,
      due_time: String(el(`${prefix}-time`)?.value || '').trim() || null,
      related_work_items: splitRefs(el(`${prefix}-work`)?.value || ''),
      actor: 'blueprints-ui',
      source_surface: 'todo-page',
      request_id: `ui-todo-${Date.now()}`,
    };
  }

  async function submitTask(prefix = 'todo-inline-task') {
    const status = el(`${prefix}-status`) || el('todo-entry-status');
    const payload = taskPayloadFromForm(prefix);
    if (!payload.title) {
      if (status) status.textContent = 'Task title is required.';
      return false;
    }
    if (status) status.textContent = 'Saving task...';
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const resp = await fetcher('/api/v1/personal/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      if (status) status.textContent = data.detail || `HTTP ${resp.status}`;
      return false;
    }
    ['title', 'body', 'time', 'work'].forEach(key => {
      const field = el(`${prefix}-${key}`);
      if (field) field.value = '';
    });
    if (status) status.textContent = `Saved ${data.task?.task_id || ''}`;
    state.lastWrite = data;
    state.loaded = false;
    await load({ force: true });
    setQuickDefaults(prefix);
    if (prefix === 'todo-modal-task') closeActionModal();
    return true;
  }

  function editSelected() {
    const task = state.selection?.row;
    if (!task) return showActionModal('Edit Task', '<p>Select a task before editing.</p>');
    if (!canWriteTask(task)) {
      return showActionModal('Edit Task', kvHtml([
        ['Task', task.task_id || ''],
        ['Source', sourceType(task) || ''],
        ['State', 'source-owned'],
      ]));
    }
    if (activateTodoPanelTab('edit-task')) {
      ['todo-inline-edit-task', 'todo-sidecar-edit-task', 'todo-panel-edit-task'].forEach(prefix => {
        if (el(`${prefix}-title`)) window.setTimeout(() => el(`${prefix}-title`)?.focus(), 0);
      });
      return true;
    }
    showActionModal('Edit Task', embeddedEditTaskFormHtml('todo-modal-edit-task', { modal: true }), '', {
      contentView: 'edit-task',
      viewport: true,
    });
    window.requestAnimationFrame(() => el('todo-modal-edit-task-title')?.focus());
    return true;
  }

  async function submitEdit(prefix = 'todo-edit') {
    const task = state.selection?.row;
    if (!task?.task_id || !canWriteTask(task)) return false;
    const status = el(`${prefix}-status`) || el('todo-action-modal-status');
    const payload = taskPayloadFromForm(prefix);
    if (!payload.title) {
      if (status) status.textContent = 'Task title is required.';
      else showActionModal('Edit Task', '<p>Task title is required.</p>');
      return false;
    }
    if (status) status.textContent = 'Saving task...';
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const resp = await fetcher(`/api/v1/personal/tasks/${encodeURIComponent(task.task_id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      if (status) status.textContent = data.detail || `HTTP ${resp.status}`;
      else showActionModal('Edit Task', `<p>${escHtml(data.detail || `HTTP ${resp.status}`)}</p>`);
      return false;
    }
    const taskRef = data.task?.task_id || task.task_id;
    state.lastWrite = data;
    state.loaded = false;
    await load({ force: true });
    selectTaskRef(taskRef);
    if (window.PersonalFilters?.renderAll) window.PersonalFilters.renderAll();
    if (prefix === 'todo-modal-edit-task') {
      closeActionModal();
      return showActionModal('Edit Task', kvHtml([
        ['Task', data.task?.task_id || task.task_id],
        ['Title', data.task?.title || payload.title],
        ['Audit', data.audit?.audit_id || ''],
      ]), 'Task updated.');
    }
    const afterStatus = el(`${prefix}-status`);
    if (afterStatus) afterStatus.textContent = 'Task updated.';
    return true;
  }

  async function runTaskAction(action) {
    const task = state.selection?.row;
    if (!task) return showActionModal('Task Action', '<p>Select a task first.</p>');
    if (!canWriteTask(task)) {
      return showActionModal('Task Action', kvHtml([
        ['Task', task.task_id || ''],
        ['Source', sourceType(task) || ''],
        ['State', 'source-owned'],
      ]));
    }
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const resp = await fetcher(`/api/v1/personal/tasks/${encodeURIComponent(task.task_id)}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actor: 'blueprints-ui',
        source_surface: 'todo-page',
        request_id: `ui-todo-${action}-${Date.now()}`,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return showActionModal('Task Action', `<p>${escHtml(data.detail || `HTTP ${resp.status}`)}</p>`);
    state.lastWrite = data;
    state.loaded = false;
    await load({ force: true });
    return showActionModal('Task Action', kvHtml([
      ['Task', data.task?.task_id || task.task_id],
      ['Status', data.task?.status || action],
      ['Audit', data.audit?.audit_id || ''],
    ]), `Task ${action === 'complete' ? 'completed' : 'archived'}.`);
  }

  function openSource() {
    const task = state.selection?.row;
    if (!task) return showActionModal('Task Source', '<p>Select a task before opening source detail.</p>');
    return showActionModal('Task Source', `${kvHtml([
      ['Task', task.task_id || ''],
      ['Event', task.event_id || ''],
      ['Source', sourceType(task) || ''],
      ['Ref', task.source?.ref || ''],
      ['Status', task.status || ''],
    ])}<pre style="white-space:pre-wrap;overflow-wrap:anywhere;margin:0">${escHtml(JSON.stringify(task.provenance || {}, null, 2))}</pre>`);
  }

  function linkWorkItem() {
    const task = state.selection?.row;
    if (!task) return showActionModal('Connect Work', '<p>Select a task before linking work.</p>');
    return showActionModal('Connect Work', `${kvHtml([
      ['Task', task.task_id || ''],
      ['Current links', (task.related?.work_items || []).join(', ') || 'none'],
    ])}
      <label class="todo-field" for="todo-work-link-input">
        <span>Work ref</span>
        <input id="todo-work-link-input" type="text" autocomplete="off" />
      </label>
      <button class="todo-command-btn" type="button" data-todo-modal-action="submit-work-link">Connect Work</button>`);
  }

  async function submitWorkLink() {
    const task = state.selection?.row;
    const workRef = String(el('todo-work-link-input')?.value || '').trim();
    if (!task || !workRef) return false;
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    let resp;
    if (canWriteTask(task)) {
      const payload = {
        title: task.title,
        body: task.body_excerpt || '',
        mode: 'work',
        priority: task.priority || null,
        due_date: task.local_date || null,
        due_time: task.provenance?.task?.due_time || null,
        related_work_items: [...(task.related?.work_items || []), workRef],
        actor: 'blueprints-ui',
        source_surface: 'todo-page',
        request_id: `ui-todo-work-link-${Date.now()}`,
      };
      resp = await fetcher(`/api/v1/personal/tasks/${encodeURIComponent(task.task_id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      resp = await fetcher(`/api/v1/personal/events/${encodeURIComponent(task.event_id || task.task_id)}/work-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_item_ref: workRef,
          actor: 'blueprints-ui',
          source_surface: 'todo-page',
          request_id: `ui-todo-event-work-link-${Date.now()}`,
        }),
      });
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return showActionModal('Connect Work', `<p>${escHtml(data.detail || `HTTP ${resp.status}`)}</p>`);
    state.lastWrite = data;
    state.loaded = false;
    await load({ force: true });
    return showActionModal('Connect Work', kvHtml([
      ['Task', task.task_id || ''],
      ['Work ref', workRef],
      ['Audit', data.audit?.audit_id || ''],
    ]), 'Work link recorded.');
  }

  function explainSelection() {
    const task = state.selection?.row;
    if (task) return openSource();
    return showActionModal('ToDo State', kvHtml([
      ['Mode', modeLabel(state.mode)],
      ['Visible tasks', taskRows().length],
      ['Read path', '/api/v1/personal/tasks'],
      ['Write path', '/api/v1/personal/tasks'],
    ]));
  }

  async function safeChecks() {
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const params = new URLSearchParams({ mode: state.mode, limit: '200' });
    const first = await fetcher(`/api/v1/personal/tasks?${params.toString()}`).then(resp => resp.json());
    const second = await fetcher(`/api/v1/personal/tasks?${params.toString()}`).then(resp => resp.json());
    state.data = second;
    state.loaded = true;
    render();
    return showActionModal('ToDo Safe Checks', kvHtml([
      ['Read route', '/api/v1/personal/tasks'],
      ['Mode', modeLabel(state.mode)],
      ['Count stable', (first.items || []).length === (second.items || []).length ? 'yes' : 'no'],
      ['Visible tasks', (second.items || []).length],
    ]), 'No write command was run.');
  }

  async function openTask(taskRef) {
    const clean = cleanTaskRef(taskRef);
    if (!clean) return false;
    state.routeTaskRef = clean;
    setContentView('tasks', { render: false });
    writeRouteTaskRef(clean, { push: true });
    if (typeof switchGroup === 'function') switchGroup('dave');
    if (typeof switchTab === 'function') switchTab('todo');
    if (window.DaveMenuConfig?.updateActiveTab) window.DaveMenuConfig.updateActiveTab('todo');
    await load({ force: !state.loaded });
    return applyRouteTaskSelection({ searchModes: true });
  }

  function registerSharedPanels() {
    if (window.PersonalFilters?.registerSurface) {
      window.PersonalFilters.registerSurface('todo', {
        getRecords: () => rawTaskRows().map(taskFilterRecord),
        summaryPrefix: 'Filter:',
        activePrefix: 'Filter',
        emptyLabel: 'all tasks',
        clearLabel: 'All tasks',
        extraTabs: [
          { id: 'selected', label: 'Selected' },
          { id: 'search', label: 'Search' },
          { id: 'new-task', label: 'New Task' },
          { id: 'edit-task', label: 'Edit Task', disabled: () => !editTaskAvailable() },
          { id: 'sources', label: 'Sources' },
          { id: 'provenance', label: 'Provenance' },
        ],
        renderTab: (tab, host) => {
          if (tab === 'selected') return embeddedSelectedHtml(host);
          if (tab === 'search') return embeddedSearchHtml(host);
          if (tab === 'new-task') return embeddedTaskFormHtml(host?.id === 'todo-filter-inline-panel' ? 'todo-inline-task' : 'todo-panel-task');
          if (tab === 'edit-task') return embeddedEditTaskFormHtml(editPrefixForHost(host));
          if (tab === 'sources') return embeddedSourcesHtml(host);
          if (tab === 'provenance') return embeddedProvenanceHtml(host);
          return '';
        },
        onChange: () => {
          state.selection = null;
          render();
        },
      });
      window.PersonalFilters.registerSurface('todo-search', {
        getRecords: () => rawTaskRows().map(taskFilterRecord),
        summaryPrefix: 'Filter:',
        activePrefix: 'Filter',
        emptyLabel: 'all entries',
        clearLabel: 'All entries',
      });
    }
    if (window.BlueprintsPersonalSearch?.registerSurface) {
      window.BlueprintsPersonalSearch.registerSurface('todo', {
        filterSurface: 'todo-search',
        rangeControls: true,
      });
    }
  }

  function bind() {
    const root = document.querySelector('[data-todo-page]');
    if (!root || root.dataset.todoBound === '1') return;
    root.dataset.todoBound = '1';
    registerSharedPanels();
    setQuickDefaults();
    root.addEventListener('click', event => {
      const workLink = event.target.closest('[data-todo-work-link]');
      if (workLink) {
        event.preventDefault();
        event.stopPropagation();
        openWorkLink(workLink.dataset.todoWorkLink);
        return;
      }
      const rowAction = event.target.closest('[data-todo-row-action]');
      if (rowAction) {
        event.stopPropagation();
        setSelection(rowAction.dataset.todoIndex);
        if (rowAction.dataset.todoRowAction === 'complete') runTaskAction('complete');
        if (rowAction.dataset.todoRowAction === 'edit') editSelected();
        if (rowAction.dataset.todoRowAction === 'archive') runTaskAction('archive');
        return;
      }
      const selectable = event.target.closest('[data-todo-index]');
      if (selectable) setSelection(selectable.dataset.todoIndex);
      const modeButton = event.target.closest('[data-todo-mode-button]');
      if (modeButton) setMode(modeButton.dataset.todoModeButton);
      const btn = event.target.closest('[data-todo-action]');
      if (!btn) return;
      const action = btn.dataset.todoAction;
      if (action && action.startsWith('view-')) {
        setContentView(action.slice(5));
        return;
      }
      if (action === 'new-task') newTask();
      if (action === 'refresh') load({ force: true });
      if (action === 'submit-task') submitTask(btn.dataset.todoTaskPrefix || 'todo-inline-task');
      if (action === 'submit-edit') submitEdit(btn.dataset.todoTaskPrefix || 'todo-inline-edit-task');
      if (action === 'toggle-markdown-preview') toggleMarkdownPreview(btn, root);
    });
    root.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const selectable = event.target.closest('[data-todo-index]');
      if (!selectable) return;
      event.preventDefault();
      setSelection(selectable.dataset.todoIndex);
    });
    document.addEventListener('click', event => {
      const btn = event.target.closest('[data-todo-action="submit-task"]');
      if (!btn || root.contains(btn)) return;
      submitTask(btn.dataset.todoTaskPrefix || 'todo-panel-task');
    });
    document.addEventListener('click', event => {
      const btn = event.target.closest('[data-todo-action="submit-edit"]');
      if (!btn || root.contains(btn)) return;
      submitEdit(btn.dataset.todoTaskPrefix || 'todo-panel-edit-task');
    });
    document.addEventListener('click', event => {
      const btn = event.target.closest('[data-todo-action="toggle-markdown-preview"]');
      if (!btn || root.contains(btn)) return;
      event.preventDefault();
      toggleMarkdownPreview(btn, document);
    });
    ['todo-action-modal-close', 'todo-action-modal-footer-close'].forEach(id => {
      const btn = el(id);
      if (btn) btn.addEventListener('click', closeActionModal);
    });
    const modalBody = el('todo-action-modal-body');
    if (modalBody) {
      modalBody.addEventListener('click', event => {
        const btn = event.target.closest('[data-todo-modal-action]');
        if (!btn) return;
        if (btn.dataset.todoModalAction === 'submit-edit') submitEdit(btn.dataset.todoTaskPrefix || 'todo-modal-edit-task');
        if (btn.dataset.todoModalAction === 'submit-work-link') submitWorkLink();
        if (btn.dataset.todoModalAction === 'submit-task') submitTask(btn.dataset.todoTaskPrefix || 'todo-modal-task');
        if (btn.dataset.todoModalAction === 'toggle-markdown-preview') toggleMarkdownPreview(btn, modalBody);
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

  function newTask() {
    const host = el('todo-filter-inline-panel');
    if (hostIsVisible(host) && window.PersonalFilters?.activateTab) {
      window.PersonalFilters.activateTab('todo', 'new-task', { host, visibleOnly: false });
      setQuickDefaults('todo-inline-task');
      window.requestAnimationFrame(() => el('todo-inline-task-title')?.focus());
      return true;
    }
    showActionModal('New Task', embeddedTaskFormHtml('todo-modal-task', { modal: true }));
    setQuickDefaults('todo-modal-task');
    window.requestAnimationFrame(() => el('todo-modal-task-title')?.focus());
    return true;
  }

  function snapshot() {
    const rows = taskRows();
    return {
      loaded: state.loaded,
      loading: state.loading,
      status: state.error ? 'error' : (state.loaded ? 'ready' : ''),
      mode: state.mode,
      content_view: state.contentView,
      task_count: rows.length,
      total_count: state.data?.counts?.total || rows.length,
      open_count: rows.filter(row => row.status === 'open').length,
      blocked_count: rows.filter(row => row.status === 'blocked').length,
      done_count: rows.filter(row => ['done', 'archived'].includes(row.status)).length,
      source_counts: state.data?.counts?.sources || {},
      selection_status: state.selection?.row?.status || '',
      selection_label: state.selection?.label || '',
      route_task_ref: state.routeTaskRef || '',
      route_highlight_ref: state.routeHighlightRef || '',
      last_write_task_id: state.lastWrite?.task?.task_id || '',
      error: state.error,
    };
  }

  bind();

  return {
    load,
    refresh: () => load({ force: true }),
    newTask,
    setContentView,
    showTasks: () => setContentView('tasks'),
    showSearch: () => setContentView('search'),
    showSources: () => setContentView('sources'),
    showProvenance: () => setContentView('provenance'),
    submitTask,
    modeToday: () => setMode('today'),
    modePersonal: () => setMode('personal'),
    modeWork: () => setMode('work'),
    modeBlocked: () => setMode('blocked'),
    modeReview: () => setMode('review'),
    modeDone: () => setMode('done'),
    editSelected,
    completeSelected: () => runTaskAction('complete'),
    archiveSelected: () => runTaskAction('archive'),
    openSource,
    linkWorkItem,
    promoteToWork: linkWorkItem,
    explainSelection,
    safeChecks,
    openTask,
    taskRouteUrl,
    snapshot,
  };
})();

window.BlueprintsTodoPage = TodoPage;

if (typeof DaveMenuConfig !== 'undefined') {
  DaveMenuConfig.registerFunctions({
    'todo.refresh': () => TodoPage.refresh(),
    'todo.newTask': () => TodoPage.newTask(),
    'todo.showTasks': () => TodoPage.showTasks(),
    'todo.showSearch': () => TodoPage.showSearch(),
    'todo.showSources': () => TodoPage.showSources(),
    'todo.showProvenance': () => TodoPage.showProvenance(),
    'todo.modeToday': () => TodoPage.modeToday(),
    'todo.modePersonal': () => TodoPage.modePersonal(),
    'todo.modeWork': () => TodoPage.modeWork(),
    'todo.modeBlocked': () => TodoPage.modeBlocked(),
    'todo.modeReview': () => TodoPage.modeReview(),
    'todo.modeDone': () => TodoPage.modeDone(),
    'todo.editSelected': () => TodoPage.editSelected(),
    'todo.completeSelected': () => TodoPage.completeSelected(),
    'todo.archiveSelected': () => TodoPage.archiveSelected(),
    'todo.openSource': () => TodoPage.openSource(),
    'todo.linkWorkItem': () => TodoPage.linkWorkItem(),
    'todo.promoteToWork': () => TodoPage.promoteToWork(),
    'todo.explainSelection': () => TodoPage.explainSelection(),
    'todo.safeChecks': () => TodoPage.safeChecks(),
  });
}
