// Kanban board page - recursive work-management board over /personal/work APIs.

'use strict';

const KanbanBoardPage = (() => {
  const state = {
    loaded: false,
    loading: false,
    error: '',
    config: null,
    board: null,
    rollups: {},
    selection: null,
    currentParentId: '',
    parentStack: [],
    cardFsm: {
      state: 'idle',
      selectedItemId: '',
      pendingItemId: '',
      lastEvent: '',
    },
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

  async function requestJson(path, options = {}) {
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const resp = await fetcher(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    if (!resp.ok) {
      let detail = resp.statusText || 'request failed';
      try {
        const payload = await resp.json();
        detail = payload.detail || payload.error || detail;
      } catch (_) {
        // Keep the HTTP status text if response JSON is unavailable.
      }
      throw new Error(detail);
    }
    return resp.json();
  }

  function boardItems() {
    return (state.board?.columns || []).flatMap(column => column.items || []);
  }

  function findItem(itemId) {
    return boardItems().find(item => item.item_id === itemId) || null;
  }

  function stateRows() {
    return state.config?.states || state.board?.columns?.map(column => column.state) || [];
  }

  function priorityRows() {
    return state.config?.priorities || [];
  }

  function priorityLabel(priorityId) {
    const row = priorityRows().find(priority => priority.priority_id === priorityId);
    return row ? row.label : (priorityId || 'Priority');
  }

  function stateLabel(stateId) {
    const row = stateRows().find(itemState => itemState.state_id === stateId);
    return row ? row.label : (stateId || 'State');
  }

  function statusTone(status) {
    const clean = String(status || '').toLowerCase();
    if (clean === 'ready' || clean === 'ok' || clean === 'open') return 'ok';
    if (clean === 'active' || clean === 'pending') return 'warn';
    if (clean === 'blocked' || clean === 'error') return 'err';
    return 'unknown';
  }

  function setFsm(nextState, eventName, itemId = '') {
    state.cardFsm = {
      state: nextState,
      selectedItemId: nextState === 'selected' ? itemId : state.cardFsm.selectedItemId,
      pendingItemId: nextState === 'pendingMove' ? itemId : '',
      lastEvent: eventName,
    };
  }

  function renderStatus(message = '') {
    const strip = el('kanban-status-strip');
    if (!strip) return;
    const status = state.error ? 'error' : (state.loading ? 'pending' : (state.loaded ? 'ready' : 'empty'));
    strip.innerHTML = `
      <span class="kanban-status-dot kanban-status-dot--${statusTone(status)}" aria-hidden="true"></span>
      <span>${escHtml(message || state.error || status)}</span>
      <span>${escHtml(state.currentParentId ? 'child board' : 'root board')}</span>
    `;
  }

  function renderMeta() {
    const rows = boardItems();
    const meta = el('kanban-meta');
    if (meta) {
      const parent = state.board?.parent;
      meta.textContent = parent
        ? `${parent.title || parent.item_id} - ${rows.length} child item${rows.length === 1 ? '' : 's'}`
        : `Root board - ${rows.length} item${rows.length === 1 ? '' : 's'}`;
    }
    const crumb = el('kanban-breadcrumb');
    if (crumb) {
      const parent = state.board?.parent;
      crumb.textContent = parent ? `Root / ${parent.title || parent.item_id}` : 'Root board';
    }
  }

  function metric(value, label) {
    return `<div class="kanban-metric"><div class="kanban-metric__value">${escHtml(value)}</div><div class="kanban-metric__label">${escHtml(label)}</div></div>`;
  }

  function renderMetrics() {
    const target = el('kanban-metrics');
    if (!target) return;
    const rollup = state.board?.rollup || {};
    const items = rollup.items || {};
    target.innerHTML = [
      metric(boardItems().length, 'visible cards'),
      metric(items.total || 0, 'scoped items'),
      metric(rollup.issues?.open || 0, 'open issues'),
      metric(rollup.todos?.open || 0, 'open todos'),
    ].join('');
  }

  function rollupFor(item) {
    return state.rollups[item.item_id] || {
      items: { total: 1, by_state: {}, by_status: {} },
      issues: { open: 0 },
      todos: { open: 0 },
      blockers: { open: 0 },
      depth_limit: 12,
    };
  }

  function subitemsTone(rollup) {
    const total = Number(rollup?.items?.total || 0);
    const issues = Number(rollup?.issues?.open || 0);
    const blocked = Number(rollup?.blockers?.open || 0) + Number(rollup?.items?.by_status?.blocked || 0);
    const active = Number(rollup?.items?.by_status?.active || 0) + Number(rollup?.items?.by_status?.open || 0);
    if (issues || blocked) return 'err';
    if (total <= 1) return 'empty';
    if (active) return 'warn';
    return 'ok';
  }

  function pillHtml(kind, label, count, tone, itemId) {
    return `<button class="kanban-pill-btn" type="button" data-kanban-pill="${kind}" data-kanban-item-id="${escHtml(itemId)}" data-tone="${escHtml(tone)}">
      <span>${escHtml(label)}</span><strong>${escHtml(count)}</strong>
    </button>`;
  }

  function rollupRows(item) {
    const rollup = rollupFor(item);
    const subitems = Math.max(0, Number(rollup.items?.total || 1) - 1);
    const issues = Number(rollup.issues?.open || 0);
    const todos = Number(rollup.todos?.open || 0);
    return `
      <div class="kanban-rollups">
        <div class="kanban-rollup-row">
          ${pillHtml('subitems', 'SubItems', subitems, subitemsTone(rollup), item.item_id)}
          <button class="kanban-add-btn" type="button" data-kanban-card-action="add-child" data-kanban-item-id="${escHtml(item.item_id)}" title="Add child item" aria-label="Add child item"></button>
        </div>
        <div class="kanban-rollup-row">
          ${pillHtml('issues', 'Issues', issues, issues ? 'err' : 'empty', item.item_id)}
          <button class="kanban-add-btn" type="button" data-kanban-card-action="add-issue" data-kanban-item-id="${escHtml(item.item_id)}" title="Add issue" aria-label="Add issue"></button>
        </div>
        <div class="kanban-rollup-row">
          ${pillHtml('todos', 'ToDos', todos, todos ? 'info' : 'empty', item.item_id)}
          <button class="kanban-add-btn" type="button" data-kanban-card-action="add-todo" data-kanban-item-id="${escHtml(item.item_id)}" title="Add todo" aria-label="Add todo"></button>
        </div>
      </div>
    `;
  }

  function cardHtml(item) {
    const pending = state.cardFsm.pendingItemId === item.item_id;
    const selected = state.selection?.item?.item_id === item.item_id;
    return `
      <article class="kanban-card" data-kanban-item-id="${escHtml(item.item_id)}" tabindex="0" data-selected="${selected ? 'true' : 'false'}" data-pending="${pending ? 'true' : 'false'}">
        <div class="kanban-card__head">
          <div class="kanban-card__title">${escHtml(item.title || item.item_id)}</div>
        </div>
        <div class="kanban-card__meta">
          <span class="kanban-state-pill" data-state="${escHtml(item.state_id || '')}">${escHtml(stateLabel(item.state_id))}</span>
          <span class="kanban-priority-pill" data-priority="${escHtml(item.priority_id || '')}">${escHtml(priorityLabel(item.priority_id))}</span>
          <span class="kanban-pill">d${escHtml(item.depth ?? 0)}</span>
        </div>
        <div class="kanban-card__body">${escHtml(item.body_excerpt || '')}</div>
        ${rollupRows(item)}
        <div class="kanban-card__actions" aria-label="Card actions">
          <button class="kanban-card-btn kanban-card-btn--left" type="button" data-kanban-card-action="move-left" data-kanban-item-id="${escHtml(item.item_id)}" title="Move left" aria-label="Move left"></button>
          <button class="kanban-card-btn kanban-card-btn--right" type="button" data-kanban-card-action="move-right" data-kanban-item-id="${escHtml(item.item_id)}" title="Move right" aria-label="Move right"></button>
          <button class="kanban-card-btn kanban-card-btn--child" type="button" data-kanban-card-action="open-child-board" data-kanban-item-id="${escHtml(item.item_id)}" title="Open child board" aria-label="Open child board"></button>
          <button class="kanban-card-btn kanban-card-btn--archive" type="button" data-kanban-card-action="archive" data-kanban-item-id="${escHtml(item.item_id)}" title="Archive item" aria-label="Archive item"></button>
        </div>
      </article>
    `;
  }

  function renderBoard() {
    const shell = el('kanban-board-shell');
    if (!shell) return;
    const columns = state.board?.columns || [];
    shell.innerHTML = columns.length
      ? columns.map(column => `
        <section class="kanban-column" data-kanban-state-id="${escHtml(column.state.state_id)}">
          <div class="kanban-column__head">
            <div class="kanban-column__title">${escHtml(column.state.label || column.state.state_id)}</div>
            <span class="kanban-column__count">${escHtml((column.items || []).length)}</span>
            <button class="kanban-add-btn" type="button" data-kanban-action="add-item-state" data-kanban-state-id="${escHtml(column.state.state_id)}" title="Add item" aria-label="Add item"></button>
          </div>
          <div class="kanban-column__cards">
            ${(column.items || []).length ? column.items.map(cardHtml).join('') : '<div class="kanban-empty">No cards in this state.</div>'}
          </div>
        </section>
      `).join('')
      : '<div class="kanban-empty">No Kanban states loaded.</div>';
  }

  function detailRow(title, meta, body = '') {
    return `
      <div class="kanban-detail-row">
        <div class="kanban-detail-title">${escHtml(title)}</div>
        <div class="kanban-detail-meta">${escHtml(meta || '')}</div>
        ${body ? `<div class="kanban-detail-meta">${escHtml(body)}</div>` : ''}
      </div>
    `;
  }

  function renderSelection() {
    const detail = el('kanban-selection-detail');
    const pill = el('kanban-selection-pill');
    if (pill) pill.textContent = state.selection?.item?.item_id ? 'Selected' : 'None';
    if (!detail) return;
    const item = state.selection?.item;
    if (!item) {
      detail.innerHTML = '<div class="kanban-empty">Select a card to inspect state, rollups, and provenance.</div>';
      return;
    }
    const rollup = rollupFor(item);
    detail.innerHTML = [
      detailRow(item.title || item.item_id, `${stateLabel(item.state_id)} - ${priorityLabel(item.priority_id)}`, item.body_excerpt || ''),
      detailRow('Rollup', `${rollup.items?.total || 0} scoped items`, `${rollup.issues?.open || 0} open issues - ${rollup.todos?.open || 0} open todos`),
      detailRow('Vector', item.vector?.index_key || '', item.search?.metadata?.vector?.index || ''),
      detailRow('Source', item.source?.ref || '', item.promoted_from_ref || ''),
    ].join('');
  }

  function renderProvenance() {
    const target = el('kanban-provenance');
    if (!target) return;
    target.innerHTML = [
      detailRow('Board API', state.currentParentId ? `/api/v1/personal/work/items/${state.currentParentId}/board` : '/api/v1/personal/work/board', 'DB-canonical work_items'),
      detailRow('Config API', '/api/v1/personal/work/config', `${stateRows().length} states - ${priorityRows().length} priorities`),
      detailRow('FSM', state.cardFsm.state, state.cardFsm.lastEvent),
      detailRow('Depth Limit', String(state.board?.rollup?.depth_limit || 12), state.currentParentId || 'root'),
    ].join('');
  }

  function renderAll() {
    renderStatus();
    renderMeta();
    renderMetrics();
    renderBoard();
    renderSelection();
    renderProvenance();
  }

  async function loadRollups(items) {
    const entries = await Promise.all(items.slice(0, 40).map(async item => {
      try {
        const payload = await requestJson(`/api/v1/personal/work/items/${encodeURIComponent(item.item_id)}/rollup`);
        return [item.item_id, payload.rollup || {}];
      } catch (_) {
        return [item.item_id, null];
      }
    }));
    state.rollups = Object.fromEntries(entries.filter(([, value]) => value));
  }

  async function load(options = {}) {
    if (state.loading && !options.force) return;
    state.loading = true;
    state.error = '';
    renderStatus('loading');
    try {
      if (!state.config || options.forceConfig) {
        state.config = await requestJson('/api/v1/personal/work/config');
      }
      const path = state.currentParentId
        ? `/api/v1/personal/work/items/${encodeURIComponent(state.currentParentId)}/board`
        : '/api/v1/personal/work/board';
      const payload = await requestJson(path);
      state.board = payload.board || {};
      state.loaded = true;
      await loadRollups(boardItems());
      renderAll();
    } catch (error) {
      state.error = error.message || String(error);
      renderStatus(state.error);
    } finally {
      state.loading = false;
      renderStatus();
    }
  }

  function priorityOptions(selected = 'medium') {
    return priorityRows().map(priority => `<option value="${escHtml(priority.priority_id)}" ${priority.priority_id === selected ? 'selected' : ''}>${escHtml(priority.label)}</option>`).join('');
  }

  function openDialog(title, bodyHtml, options = {}) {
    if (options.id) {
      const existing = document.getElementById(options.id);
      if (existing?.tagName === 'DIALOG') {
        if (existing.open && typeof HubModal !== 'undefined') HubModal.close(existing);
        else if (existing.open && typeof existing.close === 'function') existing.close();
        existing.remove();
      }
    }
    const host = document.createElement('div');
    const dialogId = options.id ? ` id="${escHtml(options.id)}"` : '';
    host.innerHTML = `<dialog${dialogId} class="hub-modal hub-dialog" data-tone="${escHtml(options.tone || 'info')}" style="width:${escHtml(options.width || 'min(720px,95vw)')}">
      <div class="hub-modal-header">
        <h2 class="hub-modal-title">
          <span class="hub-dialog-badge">${escHtml(options.badge || 'KAN')}</span>
          <span class="hub-dialog-title-text">${escHtml(title)}</span>
        </h2>
        <button class="hub-modal-close hub-dialog-close" type="button" aria-label="Close">&#10005;</button>
      </div>
      <div class="hub-modal-body">${bodyHtml}</div>
    </dialog>`;
    const dialog = host.firstElementChild;
    document.body.appendChild(dialog);
    if (typeof HubModal !== 'undefined') {
      HubModal.init(document.body);
      HubModal.open(dialog, { onClose: () => dialog.remove() });
    } else if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    }
    return dialog;
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof HubModal !== 'undefined') HubModal.close(dialog);
    else if (dialog.open) dialog.close();
    if (!dialog.open) dialog.remove();
  }

  function itemFormHtml(titleValue = '', bodyValue = '', priorityId = 'medium') {
    return `
      <div class="kanban-modal-form">
        <label class="kanban-field" for="kanban-modal-title">
          <span>Title</span>
          <input id="kanban-modal-title" type="text" maxlength="180" value="${escHtml(titleValue)}" />
        </label>
        <label class="kanban-field" for="kanban-modal-priority">
          <span>Priority</span>
          <select id="kanban-modal-priority">${priorityOptions(priorityId)}</select>
        </label>
        <label class="kanban-field" for="kanban-modal-body">
          <span>Description</span>
          <textarea id="kanban-modal-body" maxlength="4000">${escHtml(bodyValue)}</textarea>
        </label>
        <div class="kanban-modal-actions">
          <button class="kanban-command-btn" type="button" data-kanban-modal-action="cancel">Cancel</button>
          <button class="kanban-command-btn" type="button" data-kanban-modal-action="submit">Save Item</button>
        </div>
      </div>`;
  }

  async function openItemForm({ parentItemId = state.currentParentId, stateId = 'todo', title = '', childOfSelection = false } = {}) {
    const dialog = openDialog(childOfSelection ? 'New Child Item' : 'New Work Item', itemFormHtml(title), {
      badge: 'ITEM',
      id: childOfSelection ? 'kanban-child-item-modal' : 'kanban-item-modal',
    });
    const titleInput = dialog.querySelector('#kanban-modal-title');
    const bodyInput = dialog.querySelector('#kanban-modal-body');
    const priorityInput = dialog.querySelector('#kanban-modal-priority');
    if (titleInput) titleInput.focus();
    dialog.addEventListener('click', async event => {
      const action = event.target?.dataset?.kanbanModalAction;
      if (!action) return;
      if (action === 'cancel') {
        closeDialog(dialog);
        return;
      }
      const cleanTitle = String(titleInput?.value || '').trim();
      if (!cleanTitle) {
        await HubDialogs.alert({ title: 'Kanban', message: 'Title is required.', tone: 'warning' });
        return;
      }
      const payload = {
        parent_item_id: parentItemId || null,
        title: cleanTitle,
        body: bodyInput?.value || '',
        state_id: stateId,
        priority_id: priorityInput?.value || 'medium',
        actor: 'blueprints-ui',
        source_surface: 'kanban-page',
        request_id: `ui-kanban-item-${Date.now()}`,
      };
      const resp = await requestJson('/api/v1/personal/work/items', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      state.lastWrite = resp;
      closeDialog(dialog);
      await load({ force: true });
      setSelection(resp.item?.item_id);
    });
  }

  async function openLeafForm(kind, itemId) {
    const label = kind === 'issue' ? 'Issue' : 'ToDo';
    const dialog = openDialog(`New ${label}`, `
      <div class="kanban-modal-form">
        <label class="kanban-field" for="kanban-leaf-title"><span>Title</span><input id="kanban-leaf-title" type="text" maxlength="180" /></label>
        <label class="kanban-field" for="kanban-leaf-body"><span>Details</span><textarea id="kanban-leaf-body" maxlength="4000"></textarea></label>
        <div class="kanban-modal-actions">
          <button class="kanban-command-btn" type="button" data-kanban-modal-action="cancel">Cancel</button>
          <button class="kanban-command-btn" type="button" data-kanban-modal-action="submit">Save ${label}</button>
        </div>
      </div>`, {
      badge: kind === 'issue' ? 'ISS' : 'TODO',
      id: kind === 'issue' ? 'kanban-issue-modal' : 'kanban-todo-modal',
    });
    const titleInput = dialog.querySelector('#kanban-leaf-title');
    const bodyInput = dialog.querySelector('#kanban-leaf-body');
    if (titleInput) titleInput.focus();
    dialog.addEventListener('click', async event => {
      const action = event.target?.dataset?.kanbanModalAction;
      if (!action) return;
      if (action === 'cancel') {
        closeDialog(dialog);
        return;
      }
      const cleanTitle = String(titleInput?.value || '').trim();
      if (!cleanTitle) {
        await HubDialogs.alert({ title: 'Kanban', message: 'Title is required.', tone: 'warning' });
        return;
      }
      const endpoint = kind === 'issue' ? '/api/v1/personal/work/issues' : '/api/v1/personal/work/todos';
      const payload = {
        item_id: itemId,
        title: cleanTitle,
        body: bodyInput?.value || '',
        actor: 'blueprints-ui',
        source_surface: 'kanban-page',
        request_id: `ui-kanban-${kind}-${Date.now()}`,
      };
      state.lastWrite = await requestJson(endpoint, { method: 'POST', body: JSON.stringify(payload) });
      closeDialog(dialog);
      await load({ force: true });
      setSelection(itemId);
    });
  }

  async function setSelection(itemId, { openDetail = false } = {}) {
    const item = findItem(itemId);
    if (!item) return;
    state.selection = { item };
    setFsm('selected', 'select', itemId);
    renderAll();
    if (openDetail) await openItemDetail(itemId);
  }

  async function openItemDetail(itemId = state.selection?.item?.item_id) {
    if (!itemId) {
      await HubDialogs.alert({ title: 'Kanban', message: 'Select a card first.', tone: 'warning' });
      return false;
    }
    const detail = await requestJson(`/api/v1/personal/work/items/${encodeURIComponent(itemId)}`);
    const item = detail.item || {};
    const issueHtml = (detail.issues || []).map(issue => detailRow(issue.title, issue.status, issue.body_excerpt)).join('');
    const todoHtml = (detail.todos || []).map(todo => detailRow(todo.title, todo.status, todo.body_excerpt)).join('');
    openDialog(item.title || item.item_id, `
      <div class="kanban-detail-list">
        ${detailRow('State', `${stateLabel(item.state_id)} - ${priorityLabel(item.priority_id)}`, item.body_excerpt || '')}
        ${detailRow('Rollup', `${detail.rollup?.items?.total || 0} items`, `${detail.rollup?.issues?.open || 0} issues - ${detail.rollup?.todos?.open || 0} todos`)}
        ${detailRow('Vector', item.vector?.index_key || '', item.search?.metadata?.vector?.index || '')}
        <div class="kanban-section-head"><h3>Issues</h3><span class="kanban-pill">${(detail.issues || []).length}</span></div>
        ${issueHtml || '<div class="kanban-empty">No issues in this scope.</div>'}
        <div class="kanban-section-head"><h3>ToDos</h3><span class="kanban-pill">${(detail.todos || []).length}</span></div>
        ${todoHtml || '<div class="kanban-empty">No todos in this scope.</div>'}
      </div>`, { badge: 'ITEM', id: 'kanban-detail-modal', width: 'min(820px,96vw)' });
    return true;
  }

  async function openScoped(kind, itemId = state.selection?.item?.item_id) {
    if (!itemId) return false;
    const detail = await requestJson(`/api/v1/personal/work/items/${encodeURIComponent(itemId)}`);
    const rows = kind === 'issues' ? (detail.issues || []) : (detail.todos || []);
    const label = kind === 'issues' ? 'Issues' : 'ToDos';
    openDialog(label, `
      <div class="kanban-detail-list">
        ${rows.length ? rows.map(row => detailRow(row.title, row.status, row.body_excerpt || row.source_ref || row.related_task_id || '')).join('') : `<div class="kanban-empty">No ${label.toLowerCase()} in this scope.</div>`}
      </div>`, {
      badge: kind === 'issues' ? 'ISS' : 'TODO',
      id: kind === 'issues' ? 'kanban-issues-modal' : 'kanban-todos-modal',
    });
    return true;
  }

  async function openChildBoard(itemId = state.selection?.item?.item_id) {
    if (!itemId) return false;
    const item = findItem(itemId) || state.selection?.item;
    state.parentStack.push({ item_id: state.currentParentId, label: state.board?.parent?.title || 'Root' });
    state.currentParentId = itemId;
    state.selection = item ? { item } : null;
    setFsm('idle', 'openChildBoard', itemId);
    await load({ force: true });
    return true;
  }

  async function openRootBoard() {
    state.currentParentId = '';
    state.parentStack = [];
    state.selection = null;
    setFsm('idle', 'openRootBoard');
    await load({ force: true });
    return true;
  }

  function siblingState(item, direction) {
    const rows = stateRows();
    const index = rows.findIndex(row => row.state_id === item.state_id);
    const target = rows[index + direction];
    return target ? target.state_id : '';
  }

  async function moveSelected(direction) {
    const item = state.selection?.item;
    if (!item) {
      await HubDialogs.alert({ title: 'Kanban', message: 'Select a card first.', tone: 'warning' });
      return false;
    }
    const targetState = siblingState(item, direction);
    if (!targetState) return false;
    await moveItem(item.item_id, targetState);
    return true;
  }

  async function moveItem(itemId, targetState) {
    const item = findItem(itemId);
    if (!item || !targetState) return false;
    setFsm('pendingMove', 'move', itemId);
    renderAll();
    try {
      const resp = await requestJson(`/api/v1/personal/work/items/${encodeURIComponent(itemId)}/move`, {
        method: 'POST',
        body: JSON.stringify({
          parent_item_id: state.currentParentId || null,
          state_id: targetState,
          sort_order: item.sort_order || 0,
          actor: 'blueprints-ui',
          source_surface: 'kanban-page',
          request_id: `ui-kanban-move-${Date.now()}`,
        }),
      });
      state.lastWrite = resp;
      setFsm('selected', 'moveAccepted', itemId);
      await load({ force: true });
      setSelection(itemId);
      return true;
    } catch (error) {
      setFsm('selected', 'moveRejected', itemId);
      state.error = error.message || String(error);
      renderAll();
      await HubDialogs.alert({ title: 'Move rejected', message: state.error, tone: 'danger' });
      return false;
    }
  }

  async function archiveSelected() {
    const item = state.selection?.item;
    if (!item) {
      await HubDialogs.alert({ title: 'Kanban', message: 'Select a card first.', tone: 'warning' });
      return false;
    }
    const ok = await HubDialogs.confirm({
      title: 'Archive Work Item',
      message: item.title || item.item_id,
      confirmText: 'Archive',
      tone: 'warning',
    });
    if (!ok) return false;
    const resp = await requestJson(`/api/v1/personal/work/items/${encodeURIComponent(item.item_id)}/archive`, {
      method: 'POST',
      body: JSON.stringify({
        actor: 'blueprints-ui',
        source_surface: 'kanban-page',
        request_id: `ui-kanban-archive-${Date.now()}`,
      }),
    });
    state.lastWrite = resp;
    state.selection = null;
    setFsm('idle', 'archiveAccepted');
    await load({ force: true });
    return true;
  }

  async function safeChecks() {
    openDialog('Kanban Safe Checks', `
      <div class="kanban-detail-list">
        ${detailRow('Board API', state.currentParentId ? 'child board' : 'root board', state.loaded ? 'ready' : 'not loaded')}
        ${detailRow('Columns', String(state.board?.columns?.length || 0), 'configured states')}
        ${detailRow('Selection', state.selection?.item?.item_id || 'none', state.cardFsm.state)}
        ${detailRow('Body Shade', document.querySelector('#tab-kanban .body-shade-handle') ? 'present' : 'missing', 'managed-scroll tab')}
      </div>`, { badge: 'SAFE', id: 'kanban-safe-checks-modal' });
    return true;
  }

  function handleCardAction(action, itemId, stateId = '') {
    if (action === 'add-child') return openItemForm({ parentItemId: itemId, stateId: 'todo', childOfSelection: true });
    if (action === 'add-issue') return openLeafForm('issue', itemId);
    if (action === 'add-todo') return openLeafForm('todo', itemId);
    if (action === 'open-child-board') return openChildBoard(itemId);
    if (action === 'move-left') {
      setSelection(itemId);
      return moveSelected(-1);
    }
    if (action === 'move-right') {
      setSelection(itemId);
      return moveSelected(1);
    }
    if (action === 'archive') {
      setSelection(itemId);
      return archiveSelected();
    }
    if (action === 'add-item-state') return openItemForm({ parentItemId: state.currentParentId, stateId });
    return false;
  }

  function bind() {
    const root = document.querySelector('[data-kanban-board]');
    if (!root || root.dataset.kanbanBound === '1') return;
    root.dataset.kanbanBound = '1';
    root.addEventListener('click', event => {
      const button = event.target.closest('[data-kanban-action]');
      if (button) {
        const action = button.dataset.kanbanAction;
        if (action === 'refresh') load({ force: true });
        if (action === 'root-board') openRootBoard();
        if (action === 'new-root-item') openItemForm({ parentItemId: state.currentParentId });
        if (action === 'add-item-state') handleCardAction('add-item-state', '', button.dataset.kanbanStateId || 'todo');
        return;
      }
      const cardButton = event.target.closest('[data-kanban-card-action]');
      if (cardButton) {
        event.stopPropagation();
        handleCardAction(cardButton.dataset.kanbanCardAction, cardButton.dataset.kanbanItemId || '');
        return;
      }
      const pill = event.target.closest('[data-kanban-pill]');
      if (pill) {
        event.stopPropagation();
        const itemId = pill.dataset.kanbanItemId || '';
        if (pill.dataset.kanbanPill === 'subitems') openChildBoard(itemId);
        if (pill.dataset.kanbanPill === 'issues') openScoped('issues', itemId);
        if (pill.dataset.kanbanPill === 'todos') openScoped('todos', itemId);
        return;
      }
      const card = event.target.closest('[data-kanban-item-id]');
      if (card) setSelection(card.dataset.kanbanItemId, { openDetail: true });
    });
    root.addEventListener('keydown', event => {
      const card = event.target.closest('[data-kanban-item-id]');
      if (!card) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setSelection(card.dataset.kanbanItemId, { openDetail: true });
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setSelection(card.dataset.kanbanItemId);
        moveSelected(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setSelection(card.dataset.kanbanItemId);
        moveSelected(1);
      }
    });
  }

  function snapshot() {
    const items = boardItems();
    return {
      loaded: state.loaded,
      loading: state.loading,
      status: state.error ? 'error' : (state.loaded ? 'ready' : ''),
      current_parent_id: state.currentParentId,
      column_count: state.board?.columns?.length || 0,
      item_count: items.length,
      selected_item_id: state.selection?.item?.item_id || '',
      selected_state: state.selection?.item?.state_id || '',
      last_write_item_id: state.lastWrite?.item?.item_id || '',
      card_fsm: { ...state.cardFsm },
      rollup_total: state.board?.rollup?.items?.total || 0,
      issue_count: state.board?.rollup?.issues?.open || 0,
      todo_count: state.board?.rollup?.todos?.open || 0,
      error: state.error,
    };
  }

  bind();

  return {
    load,
    refresh: () => load({ force: true }),
    newRootItem: () => openItemForm({ parentItemId: state.currentParentId }),
    openRootBoard,
    openSelectedChildBoard: () => openChildBoard(),
    openSelectedDetail: () => openItemDetail(),
    addChildToSelected: () => openItemForm({ parentItemId: state.selection?.item?.item_id, childOfSelection: true }),
    addIssueToSelected: () => state.selection?.item?.item_id ? openLeafForm('issue', state.selection.item.item_id) : false,
    addTodoToSelected: () => state.selection?.item?.item_id ? openLeafForm('todo', state.selection.item.item_id) : false,
    moveSelectedLeft: () => moveSelected(-1),
    moveSelectedRight: () => moveSelected(1),
    archiveSelected,
    safeChecks,
    snapshot,
  };
})();

window.BlueprintsKanbanBoardPage = KanbanBoardPage;

if (typeof KanbanMenuConfig !== 'undefined') {
  KanbanMenuConfig.registerFunctions({
    'kanban.refresh': () => KanbanBoardPage.refresh(),
    'kanban.newRootItem': () => KanbanBoardPage.newRootItem(),
    'kanban.openRootBoard': () => KanbanBoardPage.openRootBoard(),
    'kanban.openChildBoard': () => KanbanBoardPage.openSelectedChildBoard(),
    'kanban.openDetail': () => KanbanBoardPage.openSelectedDetail(),
    'kanban.addChild': () => KanbanBoardPage.addChildToSelected(),
    'kanban.addIssue': () => KanbanBoardPage.addIssueToSelected(),
    'kanban.addTodo': () => KanbanBoardPage.addTodoToSelected(),
    'kanban.moveLeft': () => KanbanBoardPage.moveSelectedLeft(),
    'kanban.moveRight': () => KanbanBoardPage.moveSelectedRight(),
    'kanban.archive': () => KanbanBoardPage.archiveSelected(),
    'kanban.safeChecks': () => KanbanBoardPage.safeChecks(),
  });
}
