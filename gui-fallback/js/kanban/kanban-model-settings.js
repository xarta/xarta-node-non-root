// Durable, server-allowlisted model priorities for Kanban processors.

'use strict';

const KanbanModelSettings = (() => {
  const API_ROOT = '/api/v1/personal/kanban/automation/model-routing/settings';
  const KINDS = ['preprocessing', 'review', 'blocker'];
  const LABELS = {
    preprocessing: 'Kanban preprocessing',
    review: 'Review Processor processing',
    blocker: 'Blocker Processor processing',
  };
  const state = {
    loaded: false,
    loading: false,
    error: '',
    loadPromise: null,
    lists: new Map(),
    dragging: null,
  };

  function escHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function requestId(action, kind = 'all') {
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    return `kanban-model-settings-${action}-${kind}-${random}`;
  }

  async function api(path, options = {}) {
    const fetcher = typeof apiFetch === 'function' ? apiFetch : fetch;
    const response = await fetcher(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    let data = {};
    try { data = await response.clone().json(); } catch (_) {}
    if (!response.ok) {
      const detail = data?.detail || data?.error || {};
      const error = new Error(
        typeof detail === 'string'
          ? detail
          : (detail?.message || `Model settings API failed with HTTP ${response.status}`),
      );
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  }

  function normalizeSnapshot(snapshot) {
    const routes = Array.isArray(snapshot?.routes) ? snapshot.routes : [];
    const routeById = new Map(routes.map(route => [String(route?.route_id || ''), route]));
    const savedIds = Array.isArray(snapshot?.route_ids)
      ? snapshot.route_ids.map(String).filter(id => routeById.has(id))
      : routes.map(route => String(route?.route_id || '')).filter(Boolean);
    return {
      revision: String(snapshot?.revision || ''),
      stored: Boolean(snapshot?.stored),
      updatedAt: String(snapshot?.updated_at || ''),
      savedIds,
      draftIds: [...savedIds],
      routeById,
      dirty: false,
      saving: false,
      stale: false,
      statusTone: '',
      statusText: '',
    };
  }

  function installPayload(data, options = {}) {
    KINDS.forEach(kind => {
      const snapshot = data?.settings?.[kind];
      if (!snapshot) return;
      const current = state.lists.get(kind);
      const next = normalizeSnapshot(snapshot);
      if (
        options.preserveDrafts
        && current?.dirty
        && current.draftIds.length === next.savedIds.length
        && current.draftIds.every(id => next.routeById.has(id))
      ) {
        next.draftIds = [...current.draftIds];
        next.dirty = dirtyFor(next);
        next.stale = current.revision !== next.revision;
        next.statusTone = next.stale ? 'error' : 'dirty';
        next.statusText = next.stale
          ? 'Availability refreshed, but the saved order changed. Reload before saving; your draft is retained.'
          : 'Availability refreshed; unsaved order retained.';
      }
      state.lists.set(kind, next);
    });
    state.loaded = KINDS.every(kind => state.lists.has(kind));
    state.error = '';
  }

  async function load(options = {}) {
    if (state.loadPromise) return state.loadPromise;
    state.loading = true;
    state.error = '';
    refreshAll();
    state.loadPromise = api(`${API_ROOT}?probe=${options.probe === false ? 'false' : 'true'}`)
      .then(data => {
        installPayload(data, options);
        return data;
      })
      .catch(error => {
        state.error = error?.message || String(error || 'Model priority settings failed to load.');
        throw error;
      })
      .finally(() => {
        state.loading = false;
        state.loadPromise = null;
        refreshAll();
      });
    return state.loadPromise;
  }

  function dirtyFor(list) {
    return Boolean(list) && list.draftIds.join('\n') !== list.savedIds.join('\n');
  }

  function setOrder(kind, order, statusText = 'Priority changed. Save to apply.') {
    const list = state.lists.get(kind);
    if (!list) return;
    const exact = [...order];
    if (exact.length !== list.savedIds.length || new Set(exact).size !== exact.length) return;
    if (!exact.every(id => list.routeById.has(id))) return;
    list.draftIds = exact;
    list.dirty = dirtyFor(list);
    list.stale = false;
    list.statusTone = list.dirty ? 'dirty' : '';
    list.statusText = list.dirty ? statusText : 'Order matches the saved priority list.';
    refreshAll();
  }

  function moveRoute(kind, routeId, delta) {
    const list = state.lists.get(kind);
    if (!list || list.saving) return;
    const from = list.draftIds.indexOf(routeId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= list.draftIds.length) return;
    const order = [...list.draftIds];
    [order[from], order[to]] = [order[to], order[from]];
    setOrder(kind, order);
  }

  function dropRoute(kind, routeId, targetId, after) {
    const list = state.lists.get(kind);
    if (!list || routeId === targetId) return;
    const order = list.draftIds.filter(id => id !== routeId);
    let index = order.indexOf(targetId);
    if (index < 0) return;
    if (after) index += 1;
    order.splice(index, 0, routeId);
    setOrder(kind, order, 'Priority changed by drag and drop. Save to apply.');
  }

  async function save(kind, reset = false) {
    const list = state.lists.get(kind);
    if (!list || list.saving) return;
    list.saving = true;
    list.stale = false;
    list.statusTone = 'loading';
    list.statusText = reset ? 'Resetting to the server default…' : 'Saving priority order…';
    refreshAll();
    try {
      const data = await api(`${API_ROOT}/${encodeURIComponent(kind)}`, {
        method: 'PUT',
        body: JSON.stringify({
          route_ids: reset ? null : [...list.draftIds],
          expected_revision: list.revision,
          reset,
          actor: 'blueprints-ui',
          source_surface: 'kanban-model-settings',
          request_id: requestId(reset ? 'reset' : 'save', kind),
        }),
      });
      const next = normalizeSnapshot(data?.settings || {});
      next.statusTone = 'ok';
      next.statusText = reset ? 'Server default restored.' : 'Priority order saved.';
      state.lists.set(kind, next);
    } catch (error) {
      list.saving = false;
      list.stale = error?.status === 409;
      list.statusTone = 'error';
      list.statusText = list.stale
        ? 'This list changed on the server. Reload before saving; your draft is retained.'
        : (error?.message || 'Save failed.');
    }
    refreshAll();
  }

  function routeRowHtml(kind, routeId, index, count) {
    const list = state.lists.get(kind);
    const route = list?.routeById.get(routeId) || {};
    const available = Boolean(route.available);
    return `<li class="kanban-model-route" draggable="true" tabindex="0" data-kanban-model-route="${escHtml(routeId)}" data-kanban-model-kind="${escHtml(kind)}" aria-label="Priority ${index + 1} of ${count}: ${escHtml(route.label || 'Allowed model route')}">
      <span class="kanban-model-route__rank" data-kanban-model-rank>${index + 1}</span>
      <span class="kanban-model-route__drag" aria-hidden="true">⋮⋮</span>
      <span class="kanban-model-route__copy">
        <strong>${escHtml(route.label || 'Allowed model route')}</strong>
        <span>${escHtml(route.description || '')}</span>
      </span>
      <span class="kanban-model-route__availability is-${available ? 'available' : 'unavailable'}" title="${escHtml(route.availability_classification || '')}">${available ? 'Available' : 'Unavailable'}</span>
      <span class="kanban-model-route__buttons">
        <button type="button" class="personal-filter-command" data-kanban-model-move="up" aria-label="Move ${escHtml(route.label || 'route')} up"${index === 0 ? ' disabled' : ''}>↑</button>
        <button type="button" class="personal-filter-command" data-kanban-model-move="down" aria-label="Move ${escHtml(route.label || 'route')} down"${index === count - 1 ? ' disabled' : ''}>↓</button>
      </span>
    </li>`;
  }

  function listSectionHtml(kind, index) {
    const list = state.lists.get(kind);
    if (!list) return '';
    return `<details class="kanban-model-settings__processor" data-kanban-model-processor="${escHtml(kind)}"${index === 0 ? ' open' : ''}>
      <summary>
        <span>${escHtml(LABELS[kind])}</span>
        <span class="kanban-model-settings__dirty" data-kanban-model-dirty${list.dirty ? '' : ' hidden'}>Unsaved order</span>
      </summary>
      <p class="kanban-model-settings__hint">Requests try these server-owned routes from top to bottom. Drag a row, use the arrow buttons, or press Alt+↑ / Alt+↓.</p>
      <ol class="kanban-model-routes" data-kanban-model-list="${escHtml(kind)}">
        ${list.draftIds.map((id, rowIndex) => routeRowHtml(kind, id, rowIndex, list.draftIds.length)).join('')}
      </ol>
      <div class="kanban-model-settings__actions">
        <button type="button" class="personal-filter-command" data-kanban-model-action="save"${list.dirty && !list.saving && !list.stale ? '' : ' disabled'}>Save</button>
        <button type="button" class="personal-filter-command" data-kanban-model-action="reset"${list.saving ? ' disabled' : ''}>Reset</button>
        <button type="button" class="personal-filter-command" data-kanban-model-action="reload"${list.saving ? ' disabled' : ''}>Reload</button>
        <span class="kanban-model-settings__status is-${escHtml(list.statusTone || 'ready')}" role="status" data-kanban-model-status>${escHtml(list.statusText || (list.stored ? 'Saved server priority list.' : 'Using the server default.'))}</span>
      </div>
    </details>`;
  }

  function bodyHtml() {
    if (state.loading && !state.loaded) return '<div class="personal-filter-empty">Loading Kanban model priorities…</div>';
    if (state.error && !state.loaded) return `<div class="personal-filter-empty">${escHtml(state.error)}</div><button type="button" class="personal-filter-command" data-kanban-model-action="reload-all">Reload</button>`;
    if (!state.loaded) return '<div class="personal-filter-empty">Preparing Kanban model priorities…</div>';
    return KINDS.map(listSectionHtml).join('');
  }

  function renderTab() {
    if (!state.loaded && !state.loadPromise) window.setTimeout(() => load().catch(() => {}), 0);
    return `<section class="kanban-model-settings" data-kanban-model-settings>
      <header class="kanban-model-settings__header">
        <div><h3>Kanban model priorities</h3><p>Separate durable priority lists for preprocessing, Review Processor, and Blocker Processor work.</p></div>
        <button type="button" class="personal-filter-command" data-kanban-model-action="refresh-availability"${state.loading ? ' disabled' : ''}>Refresh availability</button>
      </header>
      <div class="kanban-model-settings__body" data-kanban-model-body>${bodyHtml()}</div>
    </section>`;
  }

  function updateRow(row, kind, routeId, index, count) {
    const list = state.lists.get(kind);
    const route = list?.routeById.get(routeId) || {};
    row.dataset.kanbanModelRoute = routeId;
    row.dataset.kanbanModelKind = kind;
    row.setAttribute('aria-label', `Priority ${index + 1} of ${count}: ${route.label || 'Allowed model route'}`);
    const rank = row.querySelector('[data-kanban-model-rank]');
    if (rank) rank.textContent = String(index + 1);
    const up = row.querySelector('[data-kanban-model-move="up"]');
    const down = row.querySelector('[data-kanban-model-move="down"]');
    if (up) up.disabled = index === 0;
    if (down) down.disabled = index === count - 1;
  }

  function refreshProcessor(root, kind) {
    const list = state.lists.get(kind);
    const section = root.querySelector(`[data-kanban-model-processor="${kind}"]`);
    if (!list || !section) return false;
    const container = section.querySelector(`[data-kanban-model-list="${kind}"]`);
    if (!container) return false;
    const activeElement = document.activeElement;
    const restoreFocus = activeElement instanceof HTMLElement
      && section.contains(activeElement)
      && Boolean(activeElement.closest('[data-kanban-model-route]'));
    const rows = new Map([...container.querySelectorAll('[data-kanban-model-route]')]
      .map(row => [row.dataset.kanbanModelRoute, row]));
    list.draftIds.forEach((routeId, index) => {
      let row = rows.get(routeId);
      if (!row) {
        const template = document.createElement('template');
        template.innerHTML = routeRowHtml(kind, routeId, index, list.draftIds.length).trim();
        row = template.content.firstElementChild;
      }
      updateRow(row, kind, routeId, index, list.draftIds.length);
      container.appendChild(row);
    });
    rows.forEach((row, routeId) => { if (!list.routeById.has(routeId)) row.remove(); });
    const dirty = section.querySelector('[data-kanban-model-dirty]');
    if (dirty) dirty.hidden = !list.dirty;
    const saveButton = section.querySelector('[data-kanban-model-action="save"]');
    if (saveButton) saveButton.disabled = !list.dirty || list.saving || list.stale;
    section.querySelectorAll('[data-kanban-model-action="reset"], [data-kanban-model-action="reload"]')
      .forEach(button => { button.disabled = list.saving; });
    const status = section.querySelector('[data-kanban-model-status]');
    if (status) {
      status.className = `kanban-model-settings__status is-${list.statusTone || 'ready'}`;
      status.textContent = list.statusText || (list.stored ? 'Saved server priority list.' : 'Using the server default.');
    }
    if (restoreFocus && activeElement.isConnected && document.activeElement !== activeElement) {
      activeElement.focus({ preventScroll: true });
    }
    return true;
  }

  function refreshHost(host) {
    const root = host?.querySelector?.('[data-kanban-model-settings]');
    if (!root) return false;
    const body = root.querySelector('[data-kanban-model-body]');
    if (!body) return false;
    if (!state.loaded || !KINDS.every(kind => root.querySelector(`[data-kanban-model-processor="${kind}"]`))) {
      body.innerHTML = bodyHtml();
    }
    KINDS.forEach(kind => refreshProcessor(root, kind));
    const refresh = root.querySelector('[data-kanban-model-action="refresh-availability"]');
    if (refresh) refresh.disabled = state.loading;
    bind(host);
    return true;
  }

  function refreshAll() {
    document.querySelectorAll('[data-personal-filter-host]').forEach(host => refreshHost(host));
  }

  function bind(host) {
    const root = host?.querySelector?.('[data-kanban-model-settings]');
    if (!root || root.dataset.kanbanModelBound === '1') return;
    root.dataset.kanbanModelBound = '1';
    root.addEventListener('click', event => {
      const button = event.target.closest('[data-kanban-model-action], [data-kanban-model-move]');
      if (!button || button.disabled) return;
      event.preventDefault();
      const section = button.closest('[data-kanban-model-processor]');
      const row = button.closest('[data-kanban-model-route]');
      const kind = section?.dataset.kanbanModelProcessor || row?.dataset.kanbanModelKind || '';
      if (button.dataset.kanbanModelMove) {
        moveRoute(kind, row?.dataset.kanbanModelRoute || '', button.dataset.kanbanModelMove === 'up' ? -1 : 1);
      } else if (button.dataset.kanbanModelAction === 'save') {
        save(kind, false);
      } else if (button.dataset.kanbanModelAction === 'reset') {
        save(kind, true);
      } else if (button.dataset.kanbanModelAction === 'refresh-availability') {
        load({ probe: true, preserveDrafts: true }).catch(() => {});
      } else if (['reload', 'reload-all'].includes(button.dataset.kanbanModelAction)) {
        load({ probe: true, preserveDrafts: false }).catch(() => {});
      }
    });
    root.addEventListener('keydown', event => {
      const row = event.target.closest('[data-kanban-model-route]');
      if (!row || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      moveRoute(row.dataset.kanbanModelKind, row.dataset.kanbanModelRoute, event.key === 'ArrowUp' ? -1 : 1);
    });
    root.addEventListener('dragstart', event => {
      const row = event.target.closest('[data-kanban-model-route]');
      if (!row) return;
      state.dragging = { kind: row.dataset.kanbanModelKind, routeId: row.dataset.kanbanModelRoute };
      row.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', row.dataset.kanbanModelRoute);
    });
    root.addEventListener('dragover', event => {
      const row = event.target.closest('[data-kanban-model-route]');
      if (!row || !state.dragging || row.dataset.kanbanModelKind !== state.dragging.kind) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const after = event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
      row.dataset.kanbanDropAfter = after ? '1' : '0';
    });
    root.addEventListener('dragleave', event => {
      event.target.closest('[data-kanban-model-route]')?.removeAttribute('data-kanban-drop-after');
    });
    root.addEventListener('drop', event => {
      const row = event.target.closest('[data-kanban-model-route]');
      if (!row || !state.dragging) return;
      event.preventDefault();
      dropRoute(state.dragging.kind, state.dragging.routeId, row.dataset.kanbanModelRoute, row.dataset.kanbanDropAfter === '1');
      row.removeAttribute('data-kanban-drop-after');
    });
    root.addEventListener('dragend', () => {
      root.querySelectorAll('.is-dragging, [data-kanban-drop-after]').forEach(row => {
        row.classList.remove('is-dragging');
        row.removeAttribute('data-kanban-drop-after');
      });
      state.dragging = null;
    });
  }

  return { renderTab, bind, refreshHost, load };
})();

window.KanbanModelSettings = KanbanModelSettings;
