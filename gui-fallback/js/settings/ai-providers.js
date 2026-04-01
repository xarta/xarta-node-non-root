/* ── AI Providers + Project Assignments ─────────────────────────────── */

const _AI_ACTION_INLINE_WIDTH = 90;
const _AI_ACTION_COMPACT_WIDTH = 48;

const _AI_PROVIDER_COLS = ['model_type', 'name', 'model_name', 'dimensions', 'enabled', 'notes', '_actions'];
const _AI_PROVIDER_FIELD_META = {
  model_type: { label: 'Type', sortKey: 'model_type', render: provider => `<td title="${esc(provider.model_type || '')}">${_typeIcon(provider.model_type)} ${esc(provider.model_type || 'unknown')}</td>` },
  name: { label: 'Name', sortKey: 'name', render: provider => `<td><strong>${esc(provider.name || '—')}</strong></td>` },
  model_name: { label: 'Model', sortKey: 'model_name', render: provider => `<td><code>${esc(provider.model_name || '—')}</code></td>` },
  dimensions: { label: 'Dims', sortKey: 'dimensions', render: provider => `<td style="text-align:right">${provider.dimensions ?? '—'}</td>` },
  enabled: { label: 'Enabled', sortKey: 'enabled', render: provider => `<td style="text-align:center">${provider.enabled ? '&#9989;' : '&#10060;'}</td>` },
  notes: { label: 'Notes', sortKey: 'notes', render: provider => `<td style="color:var(--text-dim);font-size:12px">${esc(provider.notes || '')}</td>` },
  _actions: { label: 'Actions', render: provider => _renderAiProviderActionsCell(provider) },
};

const _AI_ASSIGNMENT_COLS = ['project_name', 'role', 'provider_id', 'priority', 'enabled', '_actions'];
const _AI_ASSIGNMENT_FIELD_META = {
  project_name: { label: 'Project', sortKey: 'project_name', render: assignment => `<td><strong>${esc(assignment.project_name || '—')}</strong></td>` },
  role: { label: 'Role', sortKey: 'role', render: assignment => `<td>${_typeIcon(assignment.role)} ${esc(assignment.role || '—')}</td>` },
  provider_id: { label: 'Provider', sortKey: 'provider', render: assignment => `<td>${_renderAiAssignmentProviderCell(assignment)}</td>` },
  priority: { label: 'Priority', sortKey: 'priority', render: assignment => `<td style="text-align:right">${assignment.priority ?? 0}</td>` },
  enabled: { label: 'Enabled', sortKey: 'enabled', render: assignment => `<td style="text-align:center">${assignment.enabled ? '&#9989;' : '&#10060;'}</td>` },
  _actions: { label: 'Actions', render: assignment => _renderAiAssignmentActionsCell(assignment) },
};

let _editingAiProviderId = null;
let _editingAiAssignmentId = null;
let _aiProvidersTableView = null;
let _aiAssignmentsTableView = null;

function _providerModalEls() {
  return {
    dialog: document.getElementById('ai-provider-modal'),
    badge: document.getElementById('ai-provider-modal-badge'),
    title: document.getElementById('ai-provider-modal-title'),
    saveBtn: document.getElementById('ai-provider-modal-save-btn'),
    name: document.getElementById('aip-name'),
    baseUrl: document.getElementById('aip-url'),
    apiKey: document.getElementById('aip-key'),
    modelName: document.getElementById('aip-model'),
    modelType: document.getElementById('aip-type'),
    dimensions: document.getElementById('aip-dims'),
    options: document.getElementById('aip-opts'),
    notes: document.getElementById('aip-notes'),
    enabled: document.getElementById('aip-enabled'),
    error: document.getElementById('aip-error'),
  };
}

function _assignmentModalEls() {
  return {
    dialog: document.getElementById('ai-assignment-modal'),
    badge: document.getElementById('ai-assignment-modal-badge'),
    title: document.getElementById('ai-assignment-modal-title'),
    saveBtn: document.getElementById('ai-assignment-modal-save-btn'),
    project: document.getElementById('aia-project'),
    role: document.getElementById('aia-role'),
    provider: document.getElementById('aia-provider'),
    priority: document.getElementById('aia-priority'),
    enabled: document.getElementById('aia-enabled'),
    error: document.getElementById('aia-error'),
  };
}

function _setAiModalError(el, message) {
  if (el) el.textContent = message || '';
}

async function loadAiProviders() {
  const err = document.getElementById('ai-providers-error');
  if (err) err.hidden = true;
  try {
    const [rp, ra] = await Promise.all([
      apiFetch('/api/v1/ai-providers'),
      apiFetch('/api/v1/ai-project-assignments'),
    ]);
    if (!rp.ok) throw new Error(`Providers HTTP ${rp.status}`);
    if (!ra.ok) throw new Error(`Assignments HTTP ${ra.status}`);
    _aiProviders   = await rp.json();
    _aiAssignments = await ra.json();
    renderAiProviders();
    renderAiAssignments();
  } catch (e) {
    if (err) { err.textContent = `Failed to load AI providers: ${e.message}`; err.hidden = false; }
  }
}

function _typeIcon(type) {
  if (type === 'llm')       return '&#129504;';  // brain
  if (type === 'embedding') return '&#128203;';  // clipboard
  if (type === 'reranker')  return '&#128270;';  // magnifier
  return '&#129302;';
}

function _aiProviderById(providerId) {
  return _aiProviders.find(provider => provider.provider_id === providerId) || null;
}

function _aiAssignmentById(assignmentId) {
  return _aiAssignments.find(assignment => assignment.assignment_id === assignmentId) || null;
}

function _aiProviderCompactActions() {
  if (!_aiProvidersTableView || typeof TableRowActions === 'undefined') return false;
  return TableRowActions.shouldCollapse({
    view: _aiProvidersTableView,
    getTable: () => document.getElementById('ai-providers-table'),
    columnKey: '_actions',
    requiredWidth: _AI_ACTION_INLINE_WIDTH,
    defaultWidth: _AI_ACTION_INLINE_WIDTH,
  });
}

function _aiAssignmentCompactActions() {
  if (!_aiAssignmentsTableView || typeof TableRowActions === 'undefined') return false;
  return TableRowActions.shouldCollapse({
    view: _aiAssignmentsTableView,
    getTable: () => document.getElementById('ai-assignments-table'),
    columnKey: '_actions',
    requiredWidth: _AI_ACTION_INLINE_WIDTH,
    defaultWidth: _AI_ACTION_INLINE_WIDTH,
  });
}

function _aiActionCellWidth(isCompact) {
  return isCompact ? _AI_ACTION_COMPACT_WIDTH : _AI_ACTION_INLINE_WIDTH;
}

function _renderAiProviderActionButtons(provider) {
  return `<button class="secondary table-icon-btn table-icon-btn--edit" type="button" title="Edit AI provider" aria-label="Edit AI provider" data-ai-provider-edit="${provider.provider_id}"></button>
    <button class="secondary table-icon-btn table-icon-btn--delete" type="button" title="Delete AI provider" aria-label="Delete AI provider" data-ai-provider-delete="${provider.provider_id}"></button>`;
}

function _renderAiAssignmentActionButtons(assignment) {
  return `<button class="secondary table-icon-btn table-icon-btn--edit" type="button" title="Edit project assignment" aria-label="Edit project assignment" data-ai-assignment-edit="${assignment.assignment_id}"></button>
    <button class="secondary table-icon-btn table-icon-btn--delete" type="button" title="Delete project assignment" aria-label="Delete project assignment" data-ai-assignment-delete="${assignment.assignment_id}"></button>`;
}

function _renderAiProviderActionsCell(provider) {
  const compact = _aiProviderCompactActions();
  if (compact) {
    return `<td class="table-action-cell table-action-cell--compact" style="width:${_aiActionCellWidth(true)}px">
      <button class="table-row-action-trigger secondary" type="button" title="AI provider actions" aria-label="AI provider actions" data-ai-provider-actions="${provider.provider_id}">&#8942;</button>
    </td>`;
  }
  return `<td class="table-action-cell" style="white-space:nowrap"><div class="table-inline-actions">${_renderAiProviderActionButtons(provider)}</div></td>`;
}

function _renderAiAssignmentActionsCell(assignment) {
  const compact = _aiAssignmentCompactActions();
  if (compact) {
    return `<td class="table-action-cell table-action-cell--compact" style="width:${_aiActionCellWidth(true)}px">
      <button class="table-row-action-trigger secondary" type="button" title="Project assignment actions" aria-label="Project assignment actions" data-ai-assignment-actions="${assignment.assignment_id}">&#8942;</button>
    </td>`;
  }
  return `<td class="table-action-cell" style="white-space:nowrap"><div class="table-inline-actions">${_renderAiAssignmentActionButtons(assignment)}</div></td>`;
}

function _renderAiAssignmentProviderCell(assignment) {
  const provider = _aiProviderById(assignment.provider_id);
  if (!provider) return `<code>${esc((assignment.provider_id || '').slice(0, 8) || '—')}</code>`;
  return `${esc(provider.model_name || '—')} <span style="color:var(--text-dim);font-size:11px">(${esc(provider.name || '—')})</span>`;
}

function _aiProviderSortValue(provider, sortKey) {
  switch (sortKey) {
    case 'model_type':
      return provider.model_type || '';
    case 'name':
      return provider.name || '';
    case 'model_name':
      return provider.model_name || '';
    case 'dimensions':
      return provider.dimensions == null ? -1 : Number(provider.dimensions);
    case 'enabled':
      return provider.enabled ? 1 : 0;
    case 'notes':
      return provider.notes || '';
    default:
      return '';
  }
}

function _aiAssignmentSortValue(assignment, sortKey) {
  switch (sortKey) {
    case 'project_name':
      return assignment.project_name || '';
    case 'role':
      return assignment.role || '';
    case 'provider': {
      const provider = _aiProviderById(assignment.provider_id);
      return provider ? `${provider.model_name || ''} ${provider.name || ''}` : assignment.provider_id || '';
    }
    case 'priority':
      return Number(assignment.priority || 0);
    case 'enabled':
      return assignment.enabled ? 1 : 0;
    default:
      return '';
  }
}

function _ensureAiProvidersTableView() {
  if (_aiProvidersTableView || typeof TableView === 'undefined') return _aiProvidersTableView;
  _aiProvidersTableView = TableView.create({
    storageKey: 'ai-providers-table-prefs',
    columns: _AI_PROVIDER_COLS,
    meta: _AI_PROVIDER_FIELD_META,
    getTable: () => document.getElementById('ai-providers-table'),
    getDefaultWidth: col => (col === '_actions' ? _aiActionCellWidth(_aiProviderCompactActions()) : null),
    minWidth: 40,
    sort: {
      storageKey: 'ai-providers-table-sort',
    },
    onSortChange: () => renderAiProviders(),
  });
  return _aiProvidersTableView;
}

function _ensureAiAssignmentsTableView() {
  if (_aiAssignmentsTableView || typeof TableView === 'undefined') return _aiAssignmentsTableView;
  _aiAssignmentsTableView = TableView.create({
    storageKey: 'ai-assignments-table-prefs',
    columns: _AI_ASSIGNMENT_COLS,
    meta: _AI_ASSIGNMENT_FIELD_META,
    getTable: () => document.getElementById('ai-assignments-table'),
    getDefaultWidth: col => (col === '_actions' ? _aiActionCellWidth(_aiAssignmentCompactActions()) : null),
    minWidth: 40,
    sort: {
      storageKey: 'ai-assignments-table-sort',
    },
    onSortChange: () => renderAiAssignments(),
  });
  return _aiAssignmentsTableView;
}

function _openAiProviderColsModal() {
  const view = _ensureAiProvidersTableView();
  if (!view) return;
  view.openColumns(
    document.getElementById('ai-providers-cols-modal-list'),
    document.getElementById('ai-providers-cols-modal')
  );
}

function _applyAiProviderColsModal() {
  const view = _ensureAiProvidersTableView();
  if (!view) return;
  const modal = document.getElementById('ai-providers-cols-modal');
  view.applyColumns(modal, () => {
    renderAiProviders();
    HubModal.close(modal);
  });
}

function _openAiAssignmentColsModal() {
  const view = _ensureAiAssignmentsTableView();
  if (!view) return;
  view.openColumns(
    document.getElementById('ai-assignments-cols-modal-list'),
    document.getElementById('ai-assignments-cols-modal')
  );
}

function _applyAiAssignmentColsModal() {
  const view = _ensureAiAssignmentsTableView();
  if (!view) return;
  const modal = document.getElementById('ai-assignments-cols-modal');
  view.applyColumns(modal, () => {
    renderAiAssignments();
    HubModal.close(modal);
  });
}

function renderAiProviders() {
  const tbody = document.getElementById('ai-providers-tbody');
  if (!tbody) return;
  const view = _ensureAiProvidersTableView();
  const visibleCols = view ? view.getVisibleCols() : _AI_PROVIDER_COLS;
  if (!_aiProviders.length) {
    view?.render(() => {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${Math.max(1, visibleCols.length)}">No providers yet — click "+ Add provider" to add one.</td></tr>`;
    });
    return;
  }
  const rows = view?.sorter ? view.sorter.sortRows(_aiProviders, _aiProviderSortValue) : _aiProviders;
  view?.render(() => {
    tbody.innerHTML = rows.map(provider => `<tr>${visibleCols.map(col => _AI_PROVIDER_FIELD_META[col].render(provider)).join('')}</tr>`).join('');
  });
}

function renderAiAssignments() {
  const tbody = document.getElementById('ai-assignments-tbody');
  if (!tbody) return;
  const view = _ensureAiAssignmentsTableView();
  const visibleCols = view ? view.getVisibleCols() : _AI_ASSIGNMENT_COLS;
  if (!_aiAssignments.length) {
    view?.render(() => {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${Math.max(1, visibleCols.length)}">No assignments yet.</td></tr>`;
    });
    return;
  }
  const rows = view?.sorter ? view.sorter.sortRows(_aiAssignments, _aiAssignmentSortValue) : _aiAssignments;
  view?.render(() => {
    tbody.innerHTML = rows.map(assignment => `<tr>${visibleCols.map(col => _AI_ASSIGNMENT_FIELD_META[col].render(assignment)).join('')}</tr>`).join('');
  });
}

/* ── Provider modal ─────────────────────────────────────────────────── */

function openAiProviderModal(provider_id) {
  const modal = _providerModalEls();
  const existing = provider_id ? _aiProviders.find(p => p.provider_id === provider_id) : null;
  _editingAiProviderId = existing ? existing.provider_id : null;
  if (modal.badge) modal.badge.textContent = existing ? 'EDIT' : 'ADD';
  modal.title.textContent = `${existing ? 'Edit' : 'Add'} AI Provider`;
  modal.saveBtn.textContent = 'Save';
  modal.name.value = existing?.name || '';
  modal.baseUrl.value = existing?.base_url || '';
  modal.apiKey.value = existing?.api_key || '';
  modal.modelName.value = existing?.model_name || '';
  modal.modelType.value = existing?.model_type || 'llm';
  modal.dimensions.value = existing?.dimensions ?? '';
  modal.options.value = existing?.options || '{"verify_tls":false}';
  modal.notes.value = existing?.notes || '';
  modal.enabled.checked = !existing || !!existing.enabled;
  _setAiModalError(modal.error, '');
  HubModal.open(modal.dialog, {
    onOpen: () => modal.name.focus(),
    onClose: () => _setAiModalError(modal.error, ''),
  });
}

async function submitAiProviderModal() {
  const modal = _providerModalEls();
  const provider_id = _editingAiProviderId;
  const name = modal.name.value.trim();
  const base_url = modal.baseUrl.value.trim();
  const api_key = modal.apiKey.value.trim();
  const model_name = modal.modelName.value.trim();
  const model_type = modal.modelType.value;
  const dims_raw = modal.dimensions.value.trim();
  const options = modal.options.value.trim();
  const notes = modal.notes.value.trim();
  const enabled = modal.enabled.checked;

  if (!name || !base_url || !model_name) {
    _setAiModalError(modal.error, 'Name, base URL, and model name are required.');
    return;
  }
  _setAiModalError(modal.error, '');
  const body = { name, base_url, api_key, model_name, model_type, enabled,
    dimensions: dims_raw ? parseInt(dims_raw, 10) : null,
    options: options || null,
    notes: notes || null,
  };
  try {
    const r = await apiFetch(
      provider_id ? `/api/v1/ai-providers/${encodeURIComponent(provider_id)}` : '/api/v1/ai-providers',
      { method: provider_id ? 'PUT' : 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) }
    );
    if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
    HubModal.close(modal.dialog);
    _aiProviders = [];
    await loadAiProviders();
  } catch (e) {
    _setAiModalError(modal.error, `Save failed: ${e.message}`);
  }
}

function _openAiProviderRowActions(providerId) {
  if (typeof TableRowActions === 'undefined') return;
  const provider = _aiProviderById(providerId);
  if (!provider) return;
  TableRowActions.open({
    title: provider.name || 'AI provider actions',
    subtitle: provider.model_name || '',
    actions: [
      {
        label: 'Edit provider',
        detail: 'Update connection details, model alias, or notes',
        onClick: () => openAiProviderModal(providerId),
      },
      {
        label: 'Delete provider',
        detail: 'Remove this provider from Blueprints',
        tone: 'danger',
        onClick: () => deleteAiProvider(providerId),
      },
    ],
  });
}

async function deleteAiProvider(provider_id) {
  const provider = _aiProviderById(provider_id);
  const name = provider?.name || provider_id;
  const ok = await HubDialogs.confirmDelete({
    title: 'Delete AI provider?',
    message: `Delete provider "${name}"?`,
    detail: 'Any project assignments using this provider will be orphaned.',
  });
  if (!ok) return;
  try {
    const r = await apiFetch(`/api/v1/ai-providers/${encodeURIComponent(provider_id)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
    _aiProviders = _aiProviders.filter(p => p.provider_id !== provider_id);
    renderAiProviders();
    _aiAssignments = _aiAssignments.filter(a => a.provider_id !== provider_id);
    renderAiAssignments();
  } catch (e) {
    await HubDialogs.alertError({
      title: 'Delete failed',
      message: `Failed to delete provider: ${e.message}`,
    });
  }
}

/* ── Assignment modal ───────────────────────────────────────────────── */

function openAiAssignmentModal(assignment_id) {
  const modal = _assignmentModalEls();
  const existing = assignment_id ? _aiAssignments.find(a => a.assignment_id === assignment_id) : null;
  _editingAiAssignmentId = existing ? existing.assignment_id : null;
  if (modal.badge) modal.badge.textContent = existing ? 'EDIT' : 'ADD';
  modal.title.textContent = `${existing ? 'Edit' : 'Add'} Project Assignment`;
  modal.saveBtn.textContent = 'Save';
  modal.provider.innerHTML = _aiProviders.map(p =>
    `<option value="${esc(p.provider_id)}">${esc(p.model_name)} — ${esc(p.name)}</option>`
  ).join('');
  modal.project.value = existing?.project_name || '';
  modal.role.value = existing?.role || 'embedding';
  modal.provider.value = existing?.provider_id || (_aiProviders[0]?.provider_id || '');
  modal.priority.value = existing?.priority ?? 0;
  modal.enabled.checked = !existing || !!existing.enabled;
  _setAiModalError(modal.error, '');
  HubModal.open(modal.dialog, {
    onOpen: () => modal.project.focus(),
    onClose: () => _setAiModalError(modal.error, ''),
  });
}

async function submitAiAssignmentModal() {
  const modal = _assignmentModalEls();
  const assignment_id = _editingAiAssignmentId;
  const project_name = modal.project.value.trim();
  const role = modal.role.value;
  const provider_id = modal.provider.value;
  const priority = parseInt(modal.priority.value, 10) || 0;
  const enabled = modal.enabled.checked;

  if (!project_name) { _setAiModalError(modal.error, 'Project name is required.'); return; }
  if (!provider_id)  { _setAiModalError(modal.error, 'Select a provider.'); return; }

  _setAiModalError(modal.error, '');
  const body = { project_name, role, provider_id, priority, enabled };
  try {
    const r = await apiFetch(
      assignment_id ? `/api/v1/ai-project-assignments/${encodeURIComponent(assignment_id)}` : '/api/v1/ai-project-assignments',
      { method: assignment_id ? 'PUT' : 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) }
    );
    if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
    HubModal.close(modal.dialog);
    _aiAssignments = [];
    await loadAiProviders();
  } catch (e) {
    _setAiModalError(modal.error, `Save failed: ${e.message}`);
  }
}

function _openAiAssignmentRowActions(assignmentId) {
  if (typeof TableRowActions === 'undefined') return;
  const assignment = _aiAssignmentById(assignmentId);
  if (!assignment) return;
  TableRowActions.open({
    title: assignment.project_name || 'Project assignment actions',
    subtitle: assignment.role || '',
    actions: [
      {
        label: 'Edit assignment',
        detail: 'Change the provider, role, or priority',
        onClick: () => openAiAssignmentModal(assignmentId),
      },
      {
        label: 'Delete assignment',
        detail: 'Remove this assignment from Blueprints',
        tone: 'danger',
        onClick: () => deleteAiAssignment(assignmentId),
      },
    ],
  });
}

async function deleteAiAssignment(assignment_id) {
  const assignment = _aiAssignmentById(assignment_id);
  const project = assignment?.project_name || assignment_id;
  const role = assignment?.role || 'assignment';
  const ok = await HubDialogs.confirmDelete({
    title: 'Delete project assignment?',
    message: `Remove ${role} assignment for project "${project}"?`,
    detail: 'This removes the assignment from Blueprints.',
  });
  if (!ok) return;
  try {
    const r = await apiFetch(`/api/v1/ai-project-assignments/${encodeURIComponent(assignment_id)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
    _aiAssignments = _aiAssignments.filter(a => a.assignment_id !== assignment_id);
    renderAiAssignments();
  } catch (e) {
    await HubDialogs.alertError({
      title: 'Delete failed',
      message: `Failed to delete assignment: ${e.message}`,
    });
  }
}

(function initAiProviderModalActions() {
  const providerModal = _providerModalEls();
  const assignmentModal = _assignmentModalEls();
  if (providerModal.saveBtn && !providerModal.saveBtn.dataset.aiProviderWired) {
    providerModal.saveBtn.dataset.aiProviderWired = '1';
    providerModal.saveBtn.addEventListener('click', () => { void submitAiProviderModal(); });
  }
  if (assignmentModal.saveBtn && !assignmentModal.saveBtn.dataset.aiAssignmentWired) {
    assignmentModal.saveBtn.dataset.aiAssignmentWired = '1';
    assignmentModal.saveBtn.addEventListener('click', () => { void submitAiAssignmentModal(); });
  }
})();

document.addEventListener('DOMContentLoaded', () => {
  _ensureAiProvidersTableView();
  _ensureAiAssignmentsTableView();

  _aiProvidersTableView?.onLayoutChange(() => {
    renderAiProviders();
  });
  _aiAssignmentsTableView?.onLayoutChange(() => {
    renderAiAssignments();
  });

  document.getElementById('ai-providers-tbody')?.addEventListener('click', e => {
    const editBtn = e.target.closest('[data-ai-provider-edit]');
    const deleteBtn = e.target.closest('[data-ai-provider-delete]');
    const actionsBtn = e.target.closest('[data-ai-provider-actions]');
    if (editBtn) openAiProviderModal(editBtn.dataset.aiProviderEdit);
    if (deleteBtn) void deleteAiProvider(deleteBtn.dataset.aiProviderDelete);
    if (actionsBtn) _openAiProviderRowActions(actionsBtn.dataset.aiProviderActions);
  });

  document.getElementById('ai-assignments-tbody')?.addEventListener('click', e => {
    const editBtn = e.target.closest('[data-ai-assignment-edit]');
    const deleteBtn = e.target.closest('[data-ai-assignment-delete]');
    const actionsBtn = e.target.closest('[data-ai-assignment-actions]');
    if (editBtn) openAiAssignmentModal(editBtn.dataset.aiAssignmentEdit);
    if (deleteBtn) void deleteAiAssignment(deleteBtn.dataset.aiAssignmentDelete);
    if (actionsBtn) _openAiAssignmentRowActions(actionsBtn.dataset.aiAssignmentActions);
  });

  document.getElementById('ai-providers-cols-modal-apply')?.addEventListener('click', _applyAiProviderColsModal);
  document.getElementById('ai-assignments-cols-modal-apply')?.addEventListener('click', _applyAiAssignmentColsModal);
});
