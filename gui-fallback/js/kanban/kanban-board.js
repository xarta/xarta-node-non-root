// Kanban board page - recursive work-management board over /personal/work APIs.

'use strict';

const KanbanBoardPage = (() => {
  const state = {
    loaded: false,
    loading: false,
    error: '',
    config: null,
    board: null,
    detail: null,
    detailModalOpen: false,
    routeApplied: false,
    routeDetailItemId: '',
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

  function routeParams() {
    try {
      return new URLSearchParams(window.location.search || '');
    } catch (_) {
      return new URLSearchParams('');
    }
  }

  function cleanRouteId(value) {
    return String(value || '').trim().replace(/[^a-zA-Z0-9_.:-]+/g, '-').slice(0, 180);
  }

  function applyInitialRouteState() {
    if (state.routeApplied) return;
    state.routeApplied = true;
    const params = routeParams();
    const parentItemId = cleanRouteId(params.get('parent_item_id') || params.get('work_parent_id'));
    const detailItemId = cleanRouteId(params.get('detail_item_id') || params.get('work_item_id'));
    if (parentItemId) state.currentParentId = parentItemId;
    if (detailItemId) state.routeDetailItemId = detailItemId;
  }

  function writeRouteState(parentItemId = state.currentParentId, detailItemId = '') {
    if (!window.history || !window.location) return;
    const url = new URL(window.location.href);
    url.searchParams.set('group', 'kanban');
    url.searchParams.set('tab', 'kanban');
    const parent = cleanRouteId(parentItemId);
    const detail = cleanRouteId(detailItemId);
    if (parent) url.searchParams.set('parent_item_id', parent);
    else url.searchParams.delete('parent_item_id');
    if (detail) url.searchParams.set('detail_item_id', detail);
    else url.searchParams.delete('detail_item_id');
    window.history.replaceState(window.history.state, '', url);
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
      itemId: itemId || state.cardFsm.itemId || '',
      lastEvent: eventName,
    };
  }

  function currentBreadcrumbs() {
    const rows = state.board?.breadcrumbs;
    return Array.isArray(rows) ? rows : [];
  }

  function depthLimit() {
    return Number(state.config?.depth_limit || state.board?.depth_limit || state.board?.rollup?.depth_limit || 12);
  }

  function remainingDepthForItem(item) {
    if (!item) return depthLimit();
    return Math.max(0, depthLimit() - Number(item.depth || 0));
  }

  async function detailForItem(itemId) {
    if (!itemId) return null;
    if (state.detail?.item?.item_id === itemId) return state.detail;
    return requestJson(`/api/v1/personal/work/items/${encodeURIComponent(itemId)}`);
  }

  async function childCreateDepthInfo(parentItemId) {
    if (!parentItemId) {
      return { allowed: true, remaining: depthLimit(), label: 'Root board' };
    }
    const localItem = findItem(parentItemId)
      || (state.board?.parent?.item_id === parentItemId ? state.board.parent : null)
      || (state.detail?.item?.item_id === parentItemId ? state.detail.item : null);
    const detail = localItem ? null : await detailForItem(parentItemId);
    const item = localItem || detail?.item || null;
    const remaining = detail?.remaining_depth ?? remainingDepthForItem(item);
    return {
      allowed: Number(remaining) > 0,
      remaining: Number(remaining),
      label: item?.title || parentItemId,
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
      const breadcrumbs = currentBreadcrumbs();
      const entries = [
        { item_id: '', title: 'Root board' },
        ...breadcrumbs.map(item => ({ item_id: item.item_id, title: item.title || item.item_id })),
      ];
      crumb.innerHTML = entries.map((entry, index) => {
        const isCurrent = index === entries.length - 1;
        const button = `<button class="kanban-breadcrumb__button" type="button" data-kanban-breadcrumb="${escHtml(entry.item_id)}" ${isCurrent ? 'disabled' : ''}>${escHtml(entry.title)}</button>`;
        return `${index ? '<span class="kanban-breadcrumb__sep">/</span>' : ''}${button}`;
      }).join('');
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
      metric(state.board?.remaining_depth ?? depthLimit(), 'depth remaining'),
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
          <button class="kanban-card-btn kanban-card-btn--detail" type="button" data-kanban-card-action="open-detail" data-kanban-item-id="${escHtml(item.item_id)}" title="Item detail" aria-label="Item detail"></button>
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
      applyInitialRouteState();
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
      if (state.routeDetailItemId && !state.detailModalOpen && !options.skipRouteDetail) {
        await openItemDetail(state.routeDetailItemId);
      }
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

  function stateOptions(selected = 'todo') {
    return stateRows().map(row => `<option value="${escHtml(row.state_id)}" ${row.state_id === selected ? 'selected' : ''}>${escHtml(row.label || row.state_id)}</option>`).join('');
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
    const onClose = typeof options.onClose === 'function' ? options.onClose : null;
    let closeHandled = false;
    const handleClose = () => {
      if (closeHandled) return;
      closeHandled = true;
      if (onClose) onClose();
      if (dialog.isConnected) dialog.remove();
    };
    dialog.addEventListener('close', handleClose, { once: true });
    if (typeof HubModal !== 'undefined') {
      HubModal.init(document.body);
      HubModal.open(dialog, { onClose: handleClose });
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

  function itemFormHtml(titleValue = '', bodyValue = '', priorityId = 'medium', depthInfo = null) {
    const depthLine = depthInfo
      ? `<div class="kanban-depth-note" data-depth-remaining="${escHtml(depthInfo.remaining)}">Parent: ${escHtml(depthInfo.label)} - remaining child depth ${escHtml(depthInfo.remaining)}</div>`
      : '';
    return `
      <div class="kanban-modal-form">
        ${depthLine}
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
    const depthInfo = await childCreateDepthInfo(parentItemId);
    if (!depthInfo.allowed) {
      await HubDialogs.alert({
        title: 'Depth Limit',
        message: `${depthInfo.label} has no remaining child depth.`,
        tone: 'warning',
      });
      return false;
    }
    const dialog = openDialog(childOfSelection ? 'New Child Item' : 'New Work Item', itemFormHtml(title, '', 'medium', depthInfo), {
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

  function selectFirstItemIfNeeded() {
    if (state.selection?.item?.item_id) return state.selection.item.item_id;
    const first = boardItems()[0];
    if (!first) return '';
    state.selection = { item: first };
    setFsm('selected', 'selectFirst', first.item_id);
    renderAll();
    return first.item_id;
  }

  function compactJson(value) {
    if (!value || typeof value !== 'object') return '';
    const text = JSON.stringify(value);
    return text === '{}' ? '' : text;
  }

  function detailCollectionRows(rows, emptyText, rowMapper) {
    const list = Array.isArray(rows) ? rows : [];
    return list.length
      ? list.map(rowMapper).join('')
      : `<div class="kanban-empty">${escHtml(emptyText)}</div>`;
  }

  function detailBreadcrumbText(detail) {
    const rows = Array.isArray(detail?.breadcrumbs) ? detail.breadcrumbs : [];
    return ['Root board', ...rows.map(item => item.title || item.item_id)].join(' / ');
  }

  function itemDetailHtml(detail) {
    const item = detail.item || {};
    const parentLabel = item.parent_item_id || 'root';
    return `
      <div class="kanban-detail-modal-grid">
        <div class="kanban-modal-form">
          <label class="kanban-field" for="kanban-detail-title-input">
            <span>Title</span>
            <input id="kanban-detail-title-input" type="text" maxlength="180" value="${escHtml(item.title || '')}" />
          </label>
          <div class="kanban-detail-edit-grid">
            <label class="kanban-field" for="kanban-detail-state-input">
              <span>State</span>
              <select id="kanban-detail-state-input">${stateOptions(item.state_id || 'todo')}</select>
            </label>
            <label class="kanban-field" for="kanban-detail-priority-input">
              <span>Priority</span>
              <select id="kanban-detail-priority-input">${priorityOptions(item.priority_id || 'medium')}</select>
            </label>
          </div>
          <label class="kanban-field" for="kanban-detail-body-input">
            <span>Description</span>
            <textarea id="kanban-detail-body-input" maxlength="4000">${escHtml(item.body_excerpt || '')}</textarea>
          </label>
          <div class="kanban-modal-actions">
            <button class="kanban-command-btn" type="button" data-kanban-detail-action="save">Save Changes</button>
            <button class="kanban-command-btn" type="button" data-kanban-detail-action="child-board">Child Board</button>
            <button class="kanban-command-btn" type="button" data-kanban-detail-action="add-child">Add Child</button>
            <button class="kanban-command-btn" type="button" data-kanban-detail-action="add-link">Add Link</button>
            <button class="kanban-command-btn" type="button" data-kanban-detail-action="add-blocker">Add Blocker</button>
          </div>
        </div>
        <div class="kanban-detail-list">
          ${detailRow('Parent', parentLabel, detailBreadcrumbText(detail))}
          ${detailRow('Depth', `${item.depth || 0} of ${detail.depth_limit || depthLimit()}`, `${detail.remaining_depth ?? remainingDepthForItem(item)} remaining child levels`)}
          ${detailRow('Rollup', `${detail.rollup?.items?.total || 0} scoped items`, `${detail.rollup?.issues?.open || 0} open issues - ${detail.rollup?.todos?.open || 0} open todos - ${detail.rollup?.blockers?.open || 0} blockers`)}
        </div>
        <section class="kanban-band">
          <div class="kanban-section-head"><h3>Direct Children</h3><span class="kanban-pill">${escHtml(detail.counts?.children ?? (detail.children || []).length)}</span></div>
          <div class="kanban-detail-list">
            ${detailCollectionRows(detail.children, 'No direct child items.', child => detailRow(child.title || child.item_id, `${stateLabel(child.state_id)} - ${priorityLabel(child.priority_id)}`, child.body_excerpt || ''))}
          </div>
        </section>
        <section class="kanban-band">
          <div class="kanban-section-head"><h3>Links</h3><span class="kanban-pill">${escHtml(detail.counts?.links ?? (detail.links || []).length)}</span></div>
          <div class="kanban-detail-list">
            ${detailCollectionRows(detail.links, 'No item links.', link => detailRow(link.link_type || 'related', `${link.source_item_id || ''} -> ${link.target_item_id || ''}`, compactJson(link.metadata)))}
          </div>
        </section>
        <section class="kanban-band">
          <div class="kanban-section-head"><h3>Blockers</h3><span class="kanban-pill">${escHtml(detail.counts?.blockers ?? (detail.blockers || []).length)}</span></div>
          <div class="kanban-detail-list">
            ${detailCollectionRows(detail.blockers, 'No blockers recorded.', blocker => detailRow(blocker.title || blocker.blocker_id, `${blocker.status || 'open'} - ${blocker.blocked_by_ref || 'no source ref'}`, blocker.body_excerpt || ''))}
          </div>
        </section>
        <section class="kanban-band">
          <div class="kanban-section-head"><h3>Issues And ToDos</h3><span class="kanban-pill">${escHtml((detail.issues || []).length + (detail.todos || []).length)}</span></div>
          <div class="kanban-detail-list">
            ${detailCollectionRows(detail.issues, 'No issues in this scope.', issue => detailRow(issue.title, `issue - ${issue.status}`, issue.body_excerpt || issue.source_ref || ''))}
            ${detailCollectionRows(detail.todos, 'No todos in this scope.', todo => detailRow(todo.title, `todo - ${todo.status}`, todo.body_excerpt || todo.related_task_id || ''))}
          </div>
        </section>
        <section class="kanban-band">
          <div class="kanban-section-head"><h3>History</h3><span class="kanban-pill">${escHtml((detail.discussions || []).length || (detail.audit || []).length)}</span></div>
          <div class="kanban-detail-list">
            ${(detail.discussions || []).length
              ? detailCollectionRows(detail.discussions, 'No discussion history.', row => detailRow(row.author || row.discussion_id, row.status || 'open', row.body_excerpt || ''))
              : detailCollectionRows(detail.audit, 'No audit history.', row => detailRow(row.action || row.audit_id, `${row.actor || ''} - ${row.created_at || ''}`, compactJson(row.metadata)))}
          </div>
        </section>
      </div>`;
  }

  async function saveDetailFromDialog(dialog, itemId) {
    const titleInput = dialog.querySelector('#kanban-detail-title-input');
    const stateInput = dialog.querySelector('#kanban-detail-state-input');
    const priorityInput = dialog.querySelector('#kanban-detail-priority-input');
    const bodyInput = dialog.querySelector('#kanban-detail-body-input');
    const cleanTitle = String(titleInput?.value || '').trim();
    if (!cleanTitle) {
      await HubDialogs.alert({ title: 'Kanban', message: 'Title is required.', tone: 'warning' });
      return false;
    }
    const resp = await requestJson(`/api/v1/personal/work/items/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: cleanTitle,
        body: bodyInput?.value || '',
        state_id: stateInput?.value || 'todo',
        priority_id: priorityInput?.value || 'medium',
        actor: 'blueprints-ui',
        source_surface: 'kanban-detail',
        request_id: `ui-kanban-detail-${Date.now()}`,
      }),
    });
    state.lastWrite = resp;
    closeDialog(dialog);
    await load({ force: true });
    setSelection(resp.item?.item_id || itemId);
    await openItemDetail(resp.item?.item_id || itemId);
    return true;
  }

  async function openLinkForm(itemId) {
    const dialog = openDialog('Add Item Link', `
      <div class="kanban-modal-form">
        <label class="kanban-field" for="kanban-link-target"><span>Target Item ID</span><input id="kanban-link-target" type="text" maxlength="180" /></label>
        <label class="kanban-field" for="kanban-link-type"><span>Link Type</span><select id="kanban-link-type">
          <option value="related">Related</option>
          <option value="depends_on">Depends On</option>
          <option value="blocks">Blocks</option>
          <option value="references">References</option>
        </select></label>
        <div class="kanban-modal-actions">
          <button class="kanban-command-btn" type="button" data-kanban-modal-action="cancel">Cancel</button>
          <button class="kanban-command-btn" type="button" data-kanban-modal-action="submit">Save Link</button>
        </div>
      </div>`, { badge: 'LINK', id: 'kanban-link-modal' });
    const targetInput = dialog.querySelector('#kanban-link-target');
    const typeInput = dialog.querySelector('#kanban-link-type');
    if (targetInput) targetInput.focus();
    dialog.addEventListener('click', async event => {
      const action = event.target?.dataset?.kanbanModalAction;
      if (!action) return;
      if (action === 'cancel') {
        closeDialog(dialog);
        return;
      }
      const targetItemId = String(targetInput?.value || '').trim();
      if (!targetItemId) {
        await HubDialogs.alert({ title: 'Kanban', message: 'Target item id is required.', tone: 'warning' });
        return;
      }
      state.lastWrite = await requestJson(`/api/v1/personal/work/items/${encodeURIComponent(itemId)}/links`, {
        method: 'POST',
        body: JSON.stringify({
          target_item_id: targetItemId,
          link_type: typeInput?.value || 'related',
          metadata: { source: 'kanban-detail' },
          actor: 'blueprints-ui',
          source_surface: 'kanban-detail',
          request_id: `ui-kanban-link-${Date.now()}`,
        }),
      });
      closeDialog(dialog);
      await load({ force: true });
      await openItemDetail(itemId);
    });
  }

  async function openBlockerForm(itemId) {
    const dialog = openDialog('Add Blocker', `
      <div class="kanban-modal-form">
        <label class="kanban-field" for="kanban-blocker-title"><span>Title</span><input id="kanban-blocker-title" type="text" maxlength="180" /></label>
        <label class="kanban-field" for="kanban-blocker-ref"><span>Blocked By Ref</span><input id="kanban-blocker-ref" type="text" maxlength="220" /></label>
        <label class="kanban-field" for="kanban-blocker-body"><span>Details</span><textarea id="kanban-blocker-body" maxlength="4000"></textarea></label>
        <div class="kanban-modal-actions">
          <button class="kanban-command-btn" type="button" data-kanban-modal-action="cancel">Cancel</button>
          <button class="kanban-command-btn" type="button" data-kanban-modal-action="submit">Save Blocker</button>
        </div>
      </div>`, { badge: 'BLK', id: 'kanban-blocker-modal' });
    const titleInput = dialog.querySelector('#kanban-blocker-title');
    const refInput = dialog.querySelector('#kanban-blocker-ref');
    const bodyInput = dialog.querySelector('#kanban-blocker-body');
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
        await HubDialogs.alert({ title: 'Kanban', message: 'Blocker title is required.', tone: 'warning' });
        return;
      }
      state.lastWrite = await requestJson('/api/v1/personal/work/blockers', {
        method: 'POST',
        body: JSON.stringify({
          item_id: itemId,
          title: cleanTitle,
          body: bodyInput?.value || '',
          blocked_by_ref: refInput?.value || '',
          actor: 'blueprints-ui',
          source_surface: 'kanban-detail',
          request_id: `ui-kanban-blocker-${Date.now()}`,
        }),
      });
      closeDialog(dialog);
      await load({ force: true });
      await openItemDetail(itemId);
    });
  }

  async function openItemDetail(itemId = state.selection?.item?.item_id) {
    itemId = itemId || selectFirstItemIfNeeded();
    if (!itemId) {
      await HubDialogs.alert({ title: 'Kanban', message: 'Select a card first.', tone: 'warning' });
      return false;
    }
    const detail = await requestJson(`/api/v1/personal/work/items/${encodeURIComponent(itemId)}`);
    const item = detail.item || {};
    state.detail = detail;
    state.detailModalOpen = true;
    state.routeDetailItemId = item.item_id || itemId;
    if (item.item_id) {
      const boardItem = findItem(item.item_id);
      state.selection = { item: boardItem || item };
      setFsm('selected', 'openDetail', item.item_id);
    }
    writeRouteState(state.currentParentId, state.routeDetailItemId);
    renderAll();
    const dialog = openDialog(item.title || item.item_id, itemDetailHtml(detail), {
      badge: 'ITEM',
      id: 'kanban-detail-modal',
      width: 'min(900px,96vw)',
      onClose: () => {
        state.detailModalOpen = false;
        state.routeDetailItemId = '';
        writeRouteState(state.currentParentId, '');
        renderAll();
      },
    });
    dialog.addEventListener('click', async event => {
      const action = event.target?.dataset?.kanbanDetailAction;
      if (!action) return;
      if (action === 'save') {
        await saveDetailFromDialog(dialog, item.item_id);
      } else if (action === 'child-board') {
        closeDialog(dialog);
        await openChildBoard(item.item_id);
      } else if (action === 'add-child') {
        closeDialog(dialog);
        await openItemForm({ parentItemId: item.item_id, childOfSelection: true });
      } else if (action === 'add-link') {
        closeDialog(dialog);
        await openLinkForm(item.item_id);
      } else if (action === 'add-blocker') {
        closeDialog(dialog);
        await openBlockerForm(item.item_id);
      }
    });
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
    const item = findItem(itemId) || state.selection?.item || state.detail?.item;
    state.parentStack.push({ item_id: state.currentParentId, label: state.board?.parent?.title || 'Root' });
    state.currentParentId = itemId;
    state.selection = item ? { item } : null;
    state.detail = null;
    state.detailModalOpen = false;
    state.routeDetailItemId = '';
    writeRouteState(itemId, '');
    setFsm('idle', 'openChildBoard', itemId);
    await load({ force: true });
    return true;
  }

  async function navigateToBoard(parentItemId = '') {
    state.currentParentId = parentItemId || '';
    state.selection = null;
    state.detail = null;
    state.detailModalOpen = false;
    state.routeDetailItemId = '';
    writeRouteState(state.currentParentId, '');
    setFsm('idle', parentItemId ? 'openBreadcrumbBoard' : 'openRootBoard', parentItemId || '');
    await load({ force: true });
    return true;
  }

  async function openUpBoard() {
    if (!state.currentParentId) return openRootBoard();
    const crumbs = currentBreadcrumbs();
    if (crumbs.length <= 1) return openRootBoard();
    const parent = crumbs[crumbs.length - 2];
    return navigateToBoard(parent?.item_id || '');
  }

  async function openRootBoard() {
    state.parentStack = [];
    return navigateToBoard('');
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

  async function runStep18ProofWrite() {
    await load({ force: true });
    const stamp = Date.now();
    const parentResp = await requestJson('/api/v1/personal/work/items', {
      method: 'POST',
      body: JSON.stringify({
        item_id: `work-step18-parent-${stamp}`,
        parent_item_id: null,
        title: `Step 18 Active Browser parent ${stamp}`,
        body: 'Active Browser proof parent for child board and detail edit.',
        state_id: 'todo',
        priority_id: 'medium',
        tags: ['proof', 'step-18'],
        actor: 'active-browser',
        source_surface: 'kanban-active-browser-proof',
        request_id: `active-browser-step18-parent-${stamp}`,
      }),
    });
    const parentId = parentResp.item?.item_id;
    const childResp = await requestJson('/api/v1/personal/work/items', {
      method: 'POST',
      body: JSON.stringify({
        item_id: `work-step18-child-${stamp}`,
        parent_item_id: parentId,
        title: `Step 18 Active Browser child ${stamp}`,
        body: 'Direct child proof item created through Kanban automation.',
        state_id: 'todo',
        priority_id: 'high',
        tags: ['proof', 'step-18', 'child'],
        actor: 'active-browser',
        source_surface: 'kanban-active-browser-proof',
        request_id: `active-browser-step18-child-${stamp}`,
      }),
    });
    const linkResp = await requestJson(`/api/v1/personal/work/items/${encodeURIComponent(parentId)}/links`, {
      method: 'POST',
      body: JSON.stringify({
        target_item_id: childResp.item?.item_id,
        link_type: 'related',
        metadata: { proof_step: 18, source: 'active-browser' },
        actor: 'active-browser',
        source_surface: 'kanban-active-browser-proof',
        request_id: `active-browser-step18-link-${stamp}`,
      }),
    });
    const blockerResp = await requestJson('/api/v1/personal/work/blockers', {
      method: 'POST',
      body: JSON.stringify({
        blocker_id: `blocker-step18-${stamp}`,
        item_id: parentId,
        title: `Step 18 Active Browser blocker ${stamp}`,
        body: 'Blocker proof row for the item detail blocker panel.',
        blocked_by_ref: `work_items:${childResp.item?.item_id || ''}`,
        actor: 'active-browser',
        source_surface: 'kanban-active-browser-proof',
        request_id: `active-browser-step18-blocker-${stamp}`,
      }),
    });
    const updatedResp = await requestJson(`/api/v1/personal/work/items/${encodeURIComponent(parentId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: `Step 18 Active Browser parent edited ${stamp}`,
        body: 'Detail edit proof completed through Kanban automation.',
        state_id: 'doing',
        priority_id: 'high',
        actor: 'active-browser',
        source_surface: 'kanban-active-browser-proof',
        request_id: `active-browser-step18-edit-${stamp}`,
      }),
    });
    state.lastWrite = {
      ...updatedResp,
      link: linkResp.link,
      blocker: blockerResp.blocker,
      child_item: childResp.item,
    };
    await load({ force: true });
    setSelection(updatedResp.item?.item_id || parentId);
    await openItemDetail(updatedResp.item?.item_id || parentId);
    return true;
  }

  async function safeChecks() {
    openDialog('Kanban Safe Checks', `
      <div class="kanban-detail-list">
        ${detailRow('Board API', state.currentParentId ? 'child board' : 'root board', state.loaded ? 'ready' : 'not loaded')}
        ${detailRow('Columns', String(state.board?.columns?.length || 0), 'configured states')}
        ${detailRow('Breadcrumbs', String(currentBreadcrumbs().length), currentBreadcrumbs().map(item => item.title || item.item_id).join(' / ') || 'root')}
        ${detailRow('Depth Remaining', String(state.board?.remaining_depth ?? depthLimit()), state.currentParentId || 'root')}
        ${detailRow('Selection', state.selection?.item?.item_id || 'none', state.cardFsm.state)}
        ${detailRow('Detail', state.detail?.item?.item_id || 'none', state.detailModalOpen ? 'open' : 'closed')}
        ${detailRow('Body Shade', document.querySelector('#tab-kanban .body-shade-handle') ? 'present' : 'missing', 'managed-scroll tab')}
      </div>`, { badge: 'SAFE', id: 'kanban-safe-checks-modal' });
    return true;
  }

  function handleCardAction(action, itemId, stateId = '') {
    if (action === 'add-child') return openItemForm({ parentItemId: itemId, stateId: 'todo', childOfSelection: true });
    if (action === 'add-issue') return openLeafForm('issue', itemId);
    if (action === 'add-todo') return openLeafForm('todo', itemId);
    if (action === 'open-detail') {
      setSelection(itemId);
      return openItemDetail(itemId);
    }
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
        if (action === 'up-board') openUpBoard();
        if (action === 'root-board') openRootBoard();
        if (action === 'new-root-item') openItemForm({ parentItemId: state.currentParentId });
        if (action === 'add-item-state') handleCardAction('add-item-state', '', button.dataset.kanbanStateId || 'todo');
        return;
      }
      const breadcrumb = event.target.closest('[data-kanban-breadcrumb]');
      if (breadcrumb) {
        navigateToBoard(breadcrumb.dataset.kanbanBreadcrumb || '');
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
    const breadcrumbs = currentBreadcrumbs();
    const detail = state.detail || {};
    return {
      loaded: state.loaded,
      loading: state.loading,
      status: state.error ? 'error' : (state.loaded ? 'ready' : ''),
      current_parent_id: state.currentParentId,
      breadcrumb_depth: breadcrumbs.length,
      breadcrumb_labels: ['Root board', ...breadcrumbs.map(item => item.title || item.item_id)],
      column_count: state.board?.columns?.length || 0,
      item_count: items.length,
      selected_item_id: state.selection?.item?.item_id || '',
      selected_state: state.selection?.item?.state_id || '',
      detail_open: !!state.detailModalOpen,
      detail_item_id: detail.item?.item_id || '',
      detail_state: detail.item?.state_id || '',
      depth_remaining: detail.remaining_depth ?? state.board?.remaining_depth ?? 0,
      child_count: detail.counts?.children ?? (detail.children || []).length ?? 0,
      link_count: detail.counts?.links ?? (detail.links || []).length ?? 0,
      blocker_count: detail.counts?.blockers ?? (detail.blockers || []).length ?? 0,
      last_write_item_id: state.lastWrite?.item?.item_id || '',
      last_write_link_id: state.lastWrite?.link?.link_id || '',
      last_write_blocker_id: state.lastWrite?.blocker?.blocker_id || '',
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
    openUpBoard,
    openSelectedChildBoard: () => openChildBoard(),
    openSelectedDetail: () => openItemDetail(),
    addChildToSelected: () => openItemForm({ parentItemId: state.selection?.item?.item_id, childOfSelection: true }),
    addIssueToSelected: () => state.selection?.item?.item_id ? openLeafForm('issue', state.selection.item.item_id) : false,
    addTodoToSelected: () => state.selection?.item?.item_id ? openLeafForm('todo', state.selection.item.item_id) : false,
    moveSelectedLeft: () => moveSelected(-1),
    moveSelectedRight: () => moveSelected(1),
    archiveSelected,
    runStep18ProofWrite,
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
    'kanban.openUpBoard': () => KanbanBoardPage.openUpBoard(),
    'kanban.openChildBoard': () => KanbanBoardPage.openSelectedChildBoard(),
    'kanban.openDetail': () => KanbanBoardPage.openSelectedDetail(),
    'kanban.addChild': () => KanbanBoardPage.addChildToSelected(),
    'kanban.addIssue': () => KanbanBoardPage.addIssueToSelected(),
    'kanban.addTodo': () => KanbanBoardPage.addTodoToSelected(),
    'kanban.moveLeft': () => KanbanBoardPage.moveSelectedLeft(),
    'kanban.moveRight': () => KanbanBoardPage.moveSelectedRight(),
    'kanban.archive': () => KanbanBoardPage.archiveSelected(),
    'kanban.step18ProofWrite': () => KanbanBoardPage.runStep18ProofWrite(),
    'kanban.safeChecks': () => KanbanBoardPage.safeChecks(),
  });
}
