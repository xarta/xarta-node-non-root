// Dave ToDo page - task/action view over personal tasks and shared events.

'use strict';

const TodoPage = (() => {
  const state = {
    loaded: false,
    loading: false,
    data: null,
    error: '',
    mode: 'today',
    selection: null,
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

  function splitRefs(value) {
    return String(value || '')
      .split(/[,\s]+/)
      .map(item => item.trim())
      .filter(Boolean)
      .filter((item, index, array) => array.indexOf(item) === index);
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

  function taskRows() {
    return state.data?.items || [];
  }

  function taskLabel(row) {
    return row?.title || row?.task_id || 'task';
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
    return `<div class="todo-metric"><div class="todo-metric__value">${escHtml(value)}</div><div class="todo-metric__label">${escHtml(label)}</div></div>`;
  }

  function kvHtml(items) {
    return `<dl class="todo-action-kv">${items.map(([key, value]) => `
      <dt>${escHtml(key)}</dt><dd>${escHtml(value ?? '')}</dd>
    `).join('')}</dl>`;
  }

  function setSelection(index) {
    const idx = Number(index);
    const row = taskRows()[idx];
    if (!row) return;
    state.selection = {
      index: idx,
      key: String(row.task_id || row.event_id || idx),
      label: taskLabel(row),
      row,
    };
    renderSelection();
    applySelectionStyles();
  }

  function applySelectionStyles() {
    document.querySelectorAll('[data-todo-selected="true"]').forEach(node => {
      node.removeAttribute('data-todo-selected');
    });
    if (!state.selection) return;
    document.querySelectorAll('[data-todo-index]').forEach(node => {
      if (Number(node.dataset.todoIndex) === state.selection.index) {
        node.setAttribute('data-todo-selected', 'true');
      }
    });
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
      const selected = state.selection ? ` - selected ${state.selection.label}` : '';
      filter.textContent = `Mode: ${modeLabel(state.mode)}${selected}`;
    }
    document.querySelectorAll('[data-todo-mode-button]').forEach(btn => {
      btn.dataset.active = btn.dataset.todoModeButton === state.mode ? 'true' : 'false';
    });
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
          <div class="todo-task-meta">${escHtml(row.body_excerpt || '')}</div>
          ${refs.length ? `<div class="todo-task-meta">work: ${escHtml(refs.join(', '))}</div>` : ''}
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
    const count = el('todo-list-count');
    if (!list) return;
    const rows = taskRows();
    if (count) count.textContent = String(rows.length);
    list.innerHTML = rows.length
      ? rows.map(taskRowHtml).join('')
      : '<div class="todo-empty">No tasks in this mode.</div>';
  }

  function detailRow(title, meta, body = '') {
    return `
      <div class="todo-detail-row">
        <div class="todo-detail-main">
          <div class="todo-detail-title">${escHtml(title)}</div>
          <div class="todo-detail-meta">${escHtml(meta || '')}</div>
          ${body ? `<div class="todo-detail-meta">${escHtml(body)}</div>` : ''}
        </div>
      </div>
    `;
  }

  function renderSelection() {
    const detail = el('todo-selection-detail');
    if (!detail) return;
    const row = state.selection?.row;
    if (!row) {
      detail.innerHTML = '<div class="todo-empty">Select a task to inspect actions and provenance.</div>';
      return;
    }
    detail.innerHTML = [
      detailRow(row.title || row.task_id, `${row.status || ''} - ${row.mode || ''}`, row.body_excerpt || ''),
      detailRow('Due', taskTime(row) || 'none', row.timezone || ''),
      detailRow('Source', `${sourceType(row)} - ${row.source?.authority || ''}`, row.source?.ref || ''),
      detailRow('Work Links', (row.related?.work_items || []).join(', ') || 'none'),
    ].join('');
  }

  function renderSources() {
    const target = el('todo-source-list');
    if (!target) return;
    const counts = state.data?.counts?.sources || {};
    const rows = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
    target.innerHTML = rows.length
      ? rows.map(([source, count]) => detailRow(source, `${count} task${count === 1 ? '' : 's'}`)).join('')
      : '<div class="todo-empty">No source counts yet.</div>';
  }

  function renderProvenance() {
    const target = el('todo-provenance');
    if (!target) return;
    target.innerHTML = [
      detailRow('Task API', `/api/v1/personal/tasks?mode=${state.mode}`, 'shared task response'),
      detailRow('Write API', '/api/v1/personal/tasks', 'manual-task source with durable files'),
      detailRow('Calendar Projection', 'personal_events kind=task', 'due tasks render in Calendar'),
      detailRow('Mode', modeLabel(state.mode), `${taskRows().length} visible rows`),
    ].join('');
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
    renderMetrics();
    renderTasks();
    renderSelection();
    renderSources();
    renderProvenance();
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
      const params = new URLSearchParams({ mode: state.mode, limit: '200' });
      const resp = await fetcher(`/api/v1/personal/tasks?${params.toString()}`);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.detail || `HTTP ${resp.status}`);
      state.data = data;
      state.loaded = true;
      state.selection = null;
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

  function setMode(mode) {
    state.mode = modes.includes(mode) ? mode : 'today';
    state.loaded = false;
    state.selection = null;
    return load({ force: true });
  }

  function closeActionModal() {
    const modal = el('todo-action-modal');
    if (!modal) return;
    if (typeof HubModal !== 'undefined') HubModal.close(modal);
    else if (typeof modal.close === 'function') modal.close();
  }

  function showActionModal(title, html, status = '') {
    const modal = el('todo-action-modal');
    const titleEl = el('todo-action-modal-title');
    const body = el('todo-action-modal-body');
    const statusEl = el('todo-action-modal-status');
    if (!modal || !body) return false;
    if (titleEl) titleEl.textContent = title;
    body.innerHTML = html;
    if (statusEl) statusEl.textContent = status;
    if (typeof HubModal !== 'undefined') HubModal.open(modal);
    else if (typeof modal.showModal === 'function' && !modal.open) modal.showModal();
    return true;
  }

  function setQuickDefaults() {
    const date = el('todo-task-date');
    if (date && !date.value) date.value = localDateString(new Date());
    const mode = el('todo-task-mode');
    if (mode && ['personal', 'work', 'review'].includes(state.mode)) mode.value = state.mode;
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

  async function submitTask() {
    const status = el('todo-entry-status');
    const payload = taskPayloadFromForm('todo-task');
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
      const field = el(`todo-task-${key}`);
      if (field) field.value = '';
    });
    if (status) status.textContent = `Saved ${data.task?.task_id || ''}`;
    state.lastWrite = data;
    state.loaded = false;
    await load({ force: true });
    setQuickDefaults();
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
    const meta = task.provenance?.task || {};
    const html = `
      ${kvHtml([
        ['Task', task.task_id || ''],
        ['Source', sourceType(task) || ''],
      ])}
      <div class="todo-form-grid">
        <label class="todo-field todo-field--wide" for="todo-edit-title">
          <span>Title</span>
          <input id="todo-edit-title" type="text" maxlength="180" value="${escHtml(task.title || '')}" />
        </label>
        <label class="todo-field" for="todo-edit-date">
          <span>Due</span>
          <input id="todo-edit-date" type="date" value="${escHtml(task.local_date || localDateString(new Date()))}" />
        </label>
        <label class="todo-field" for="todo-edit-time">
          <span>Time</span>
          <input id="todo-edit-time" type="time" value="${escHtml(meta.due_time || '')}" />
        </label>
        <label class="todo-field" for="todo-edit-mode">
          <span>Mode</span>
          <select id="todo-edit-mode">
            <option value="personal" ${task.mode === 'personal' ? 'selected' : ''}>Personal</option>
            <option value="work" ${task.mode === 'work' ? 'selected' : ''}>Work</option>
            <option value="review" ${task.mode === 'review' ? 'selected' : ''}>Review</option>
          </select>
        </label>
        <label class="todo-field" for="todo-edit-priority">
          <span>Priority</span>
          <select id="todo-edit-priority">
            <option value="" ${task.priority ? '' : 'selected'}>Normal</option>
            <option value="high" ${task.priority === 'high' ? 'selected' : ''}>High</option>
            <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>Medium</option>
            <option value="low" ${task.priority === 'low' ? 'selected' : ''}>Low</option>
          </select>
        </label>
        <label class="todo-field todo-field--wide" for="todo-edit-body">
          <span>Notes</span>
          <textarea id="todo-edit-body" rows="2" maxlength="2000">${escHtml(task.body_excerpt || '')}</textarea>
        </label>
        <label class="todo-field" for="todo-edit-work">
          <span>Work refs</span>
          <input id="todo-edit-work" type="text" value="${escHtml((task.related?.work_items || []).join(' '))}" />
        </label>
      </div>
      <button class="todo-command-btn" type="button" data-todo-modal-action="submit-edit">Save Edit</button>
    `;
    return showActionModal('Edit Task', html);
  }

  async function submitEdit() {
    const task = state.selection?.row;
    if (!task?.task_id || !canWriteTask(task)) return false;
    const payload = taskPayloadFromForm('todo-edit');
    if (!payload.title) return showActionModal('Edit Task', '<p>Task title is required.</p>');
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const resp = await fetcher(`/api/v1/personal/tasks/${encodeURIComponent(task.task_id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return showActionModal('Edit Task', `<p>${escHtml(data.detail || `HTTP ${resp.status}`)}</p>`);
    state.lastWrite = data;
    state.loaded = false;
    await load({ force: true });
    return showActionModal('Edit Task', kvHtml([
      ['Task', data.task?.task_id || task.task_id],
      ['Title', data.task?.title || payload.title],
      ['Audit', data.audit?.audit_id || ''],
    ]), 'Task updated.');
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

  function bind() {
    const root = document.querySelector('[data-todo-page]');
    if (!root || root.dataset.todoBound === '1') return;
    root.dataset.todoBound = '1';
    setQuickDefaults();
    root.addEventListener('click', event => {
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
      if (action === 'new-task') newTask();
      if (action === 'refresh') load({ force: true });
      if (action === 'submit-task') submitTask();
    });
    root.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const selectable = event.target.closest('[data-todo-index]');
      if (!selectable) return;
      event.preventDefault();
      setSelection(selectable.dataset.todoIndex);
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
        if (btn.dataset.todoModalAction === 'submit-edit') submitEdit();
        if (btn.dataset.todoModalAction === 'submit-work-link') submitWorkLink();
      });
    }
  }

  function newTask() {
    setQuickDefaults();
    const field = el('todo-task-title');
    if (field) field.focus();
    return true;
  }

  function snapshot() {
    const rows = taskRows();
    return {
      loaded: state.loaded,
      loading: state.loading,
      status: state.error ? 'error' : (state.loaded ? 'ready' : ''),
      mode: state.mode,
      task_count: rows.length,
      total_count: state.data?.counts?.total || rows.length,
      open_count: rows.filter(row => row.status === 'open').length,
      blocked_count: rows.filter(row => row.status === 'blocked').length,
      done_count: rows.filter(row => ['done', 'archived'].includes(row.status)).length,
      source_counts: state.data?.counts?.sources || {},
      selection_status: state.selection?.row?.status || '',
      selection_label: state.selection?.label || '',
      last_write_task_id: state.lastWrite?.task?.task_id || '',
      error: state.error,
    };
  }

  bind();

  return {
    load,
    refresh: () => load({ force: true }),
    newTask,
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
    snapshot,
  };
})();

window.BlueprintsTodoPage = TodoPage;

if (typeof DaveMenuConfig !== 'undefined') {
  DaveMenuConfig.registerFunctions({
    'todo.refresh': () => TodoPage.refresh(),
    'todo.newTask': () => TodoPage.newTask(),
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
