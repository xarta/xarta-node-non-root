/* ── AI Providers + Project Assignments ─────────────────────────────── */

const _AI_ACTION_INLINE_WIDTH = 90;
const _AI_ACTION_COMPACT_WIDTH = 48;

function _renderAiBoolCheckboxCell(enabled, label) {
  const state = enabled ? 'checked' : '';
  return `<td style="text-align:center"><label class="hub-checkbox" style="justify-content:center;cursor:default;pointer-events:none;margin:0" aria-label="${esc(label)}">
    <input class="hub-checkbox__input" type="checkbox" ${state} tabindex="-1" aria-hidden="true" />
    <span class="hub-checkbox__box" aria-hidden="true"></span>
  </label></td>`;
}

const _AI_PROVIDER_COLS = ['model_type', 'name', 'model_name', 'dimensions', 'enabled', 'notes', '_actions'];
const _AI_PROVIDER_FIELD_META = {
  model_type: { label: 'Type', sortKey: 'model_type', render: provider => `<td title="${esc(provider.model_type || '')}">${_typeIcon(provider.model_type)} ${esc(provider.model_type || 'unknown')}</td>` },
  name: { label: 'Name', sortKey: 'name', render: provider => `<td><strong>${esc(provider.name || '—')}</strong></td>` },
  model_name: { label: 'Model', sortKey: 'model_name', render: provider => `<td><code>${esc(provider.model_name || '—')}</code></td>` },
  dimensions: { label: 'Dims', sortKey: 'dimensions', render: provider => `<td style="text-align:right">${provider.dimensions ?? '—'}</td>` },
  enabled: { label: 'Enabled', sortKey: 'enabled', render: provider => _renderAiBoolCheckboxCell(Boolean(provider.enabled), 'Provider enabled') },
  notes: { label: 'Notes', sortKey: 'notes', render: provider => `<td style="color:var(--text-dim);font-size:12px">${esc(provider.notes || '')}</td>` },
  _actions: { label: 'Actions', render: provider => _renderAiProviderActionsCell(provider) },
};

const _AI_ASSIGNMENT_COLS = ['project_name', 'role', 'provider_id', 'priority', 'enabled', '_actions'];
const _AI_ASSIGNMENT_FIELD_META = {
  project_name: { label: 'Project', sortKey: 'project_name', render: assignment => `<td><strong>${esc(assignment.project_name || '—')}</strong></td>` },
  role: { label: 'Role', sortKey: 'role', render: assignment => `<td>${_typeIcon(assignment.role)} ${esc(assignment.role || '—')}</td>` },
  provider_id: { label: 'Provider', sortKey: 'provider', render: assignment => `<td>${_renderAiAssignmentProviderCell(assignment)}</td>` },
  priority: { label: 'Priority', sortKey: 'priority', render: assignment => `<td style="text-align:right">${assignment.priority ?? 0}</td>` },
  enabled: { label: 'Enabled', sortKey: 'enabled', render: assignment => _renderAiBoolCheckboxCell(Boolean(assignment.enabled), 'Assignment enabled') },
  _actions: { label: 'Actions', render: assignment => _renderAiAssignmentActionsCell(assignment) },
};

let _editingAiProviderId = null;
let _editingAiAssignmentId = null;
let _aiProvidersTableView = null;
let _aiAssignmentsTableView = null;
let _aiObservability = null;
let _aiObservabilityResults = Object.create(null);
let _aiObservabilityRunningAll = false;
let _aiObservabilitySyncRunning = false;
let _aiObservabilityDbLinkRunning = false;
let _aiObservabilitySyncStatus = { message: '', tone: '' };
let _aiPrivateFallbackAlertTimer = null;
let _aiPrivateFallbackAlerting = false;

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
    await loadAiProviderObservability();
  } catch (e) {
    if (err) { err.textContent = `Failed to load AI providers: ${e.message}`; err.hidden = false; }
    _aiObservability = null;
    renderAiObservabilityPanel();
  }
}

async function loadAiProviderObservability() {
  try {
    const r = await apiFetch('/api/v1/ai-providers/observability');
    if (!r.ok) {
      _aiObservability = null;
      renderAiObservabilityPanel();
      return;
    }
    _aiObservability = await r.json();
  } catch {
    _aiObservability = null;
  }
  renderAiObservabilityPanel();
}

function _typeIcon(type) {
  if (type === 'llm') return '&#129504;';
  if (type === 'embedding') return '&#128203;';
  if (type === 'reranker') return '&#128270;';
  if (type === 'transcription') return '&#127908;';
  if (type === 'tts') return '&#128266;';
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
    onSortChange: () => {
      renderAiProviders();
      _ensureAiProvidersLayoutController()?.scheduleLayoutSave();
    },
    onColumnResizeEnd: () => {
      _ensureAiProvidersLayoutController()?.scheduleLayoutSave();
    },
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
    onSortChange: () => {
      renderAiAssignments();
      _ensureAiAssignmentsLayoutController()?.scheduleLayoutSave();
    },
    onColumnResizeEnd: () => {
      _ensureAiAssignmentsLayoutController()?.scheduleLayoutSave();
    },
  });
  return _aiAssignmentsTableView;
}

let _aiProvidersLayoutController = null;
let _aiAssignmentsLayoutController = null;

function _aiProvidersColumnSeed(col) {
  const types = { model_type: 'TEXT', name: 'TEXT', model_name: 'TEXT', dimensions: 'INTEGER', enabled: 'INTEGER', notes: 'TEXT' };
  const lengths = { model_type: 16, name: 40, model_name: 48, dimensions: 6, enabled: 3, notes: 80 };
  return {
    sqlite_column: col.startsWith('_') ? null : col,
    data_type: types[col] || null,
    sample_max_length: lengths[col] || null,
    min_width_px: col === '_actions' ? _AI_ACTION_COMPACT_WIDTH : 40,
    max_width_px: col === '_actions' ? _AI_ACTION_INLINE_WIDTH : 900,
    width_px: _ensureAiProvidersTableView()?.prefs?.getWidth(col) || null,
  };
}

function _aiAssignmentsColumnSeed(col) {
  const types = { project_name: 'TEXT', role: 'TEXT', provider_id: 'INTEGER', priority: 'INTEGER', enabled: 'INTEGER' };
  const lengths = { project_name: 40, role: 16, provider_id: 6, priority: 4, enabled: 3 };
  return {
    sqlite_column: col.startsWith('_') ? null : col,
    data_type: types[col] || null,
    sample_max_length: lengths[col] || null,
    min_width_px: col === '_actions' ? _AI_ACTION_COMPACT_WIDTH : 40,
    max_width_px: col === '_actions' ? _AI_ACTION_INLINE_WIDTH : 900,
    width_px: _ensureAiAssignmentsTableView()?.prefs?.getWidth(col) || null,
  };
}

function _ensureAiProvidersLayoutController() {
  if (_aiProvidersLayoutController || typeof TableBucketLayouts === 'undefined') return _aiProvidersLayoutController;
  _aiProvidersLayoutController = TableBucketLayouts.create({
    getTable: () => document.getElementById('ai-providers-table'),
    getView: () => _ensureAiProvidersTableView(),
    getColumns: () => _AI_PROVIDER_COLS,
    getMeta: col => _AI_PROVIDER_FIELD_META[col],
    getDefaultWidth: col => (col === '_actions' ? _aiActionCellWidth(_aiProviderCompactActions()) : null),
    getColumnSeed: col => _aiProvidersColumnSeed(col),
    render: () => renderAiProviders(),
    surfaceLabel: 'AI Providers',
    layoutContextTitle: 'AI Providers Layout Context',
  });
  return _aiProvidersLayoutController;
}

function _ensureAiAssignmentsLayoutController() {
  if (_aiAssignmentsLayoutController || typeof TableBucketLayouts === 'undefined') return _aiAssignmentsLayoutController;
  _aiAssignmentsLayoutController = TableBucketLayouts.create({
    getTable: () => document.getElementById('ai-assignments-table'),
    getView: () => _ensureAiAssignmentsTableView(),
    getColumns: () => _AI_ASSIGNMENT_COLS,
    getMeta: col => _AI_ASSIGNMENT_FIELD_META[col],
    getDefaultWidth: col => (col === '_actions' ? _aiActionCellWidth(_aiAssignmentCompactActions()) : null),
    getColumnSeed: col => _aiAssignmentsColumnSeed(col),
    render: () => renderAiAssignments(),
    surfaceLabel: 'AI Assignments',
    layoutContextTitle: 'AI Assignments Layout Context',
  });
  return _aiAssignmentsLayoutController;
}

async function toggleAiProvidersHorizontalScroll() {
  const controller = _ensureAiProvidersLayoutController();
  if (!controller) return;
  await controller.toggleHorizontalScroll();
}

async function toggleAiAssignmentsHorizontalScroll() {
  const controller = _ensureAiAssignmentsLayoutController();
  if (!controller) return;
  await controller.toggleHorizontalScroll();
}

async function openAiProvidersLayoutContextModal() {
  const controller = _ensureAiProvidersLayoutController();
  if (!controller) return;
  await controller.openLayoutContextModal();
}

async function openAiAssignmentsLayoutContextModal() {
  const controller = _ensureAiAssignmentsLayoutController();
  if (!controller) return;
  await controller.openLayoutContextModal();
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
    _ensureAiProvidersLayoutController()?.scheduleLayoutSave();
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
    _ensureAiAssignmentsLayoutController()?.scheduleLayoutSave();
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

function _formatAiProbeDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} s`;
}

function _aiObsSlug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'alias';
}

function _renderAiObservabilityDbRows(item) {
  const rows = Array.isArray(item?.db_rows) ? item.db_rows : [];
  if (!rows.length) return '<span style="color:var(--warn)">Not yet linked to a DB provider row.</span>';
  return rows.map(row => {
    const state = row.enabled ? 'enabled' : 'disabled';
    return `${esc(row.name || 'Provider')} <span style="color:var(--text-dim)">(${esc(row.model_type || 'unknown')}, ${state})</span>`;
  }).join('<br>');
}

function _aiPrivateNameCandidates(item) {
  const names = [item?.alias, item?.configured_model];
  const rows = Array.isArray(item?.db_rows) ? item.db_rows : [];
  rows.forEach(row => names.push(row?.name));
  return names.map(value => String(value || '').trim()).filter(Boolean);
}

function _aiHasPrivateName(item) {
  return _aiPrivateNameCandidates(item).some(value => value.toUpperCase().includes('PRIVATE'));
}

function _aiNonPrivateFallbacks(item) {
  const fallbacks = Array.isArray(item?.fallbacks) ? item.fallbacks.filter(Boolean) : [];
  return fallbacks.filter(value => !String(value || '').toUpperCase().includes('PRIVATE'));
}

function _aiPrivateFallbackViolations(models) {
  return models.filter(item => {
    return _aiHasPrivateName(item) && _aiNonPrivateFallbacks(item).length > 0;
  });
}

function _renderAiPrivateFallbackBadge(item) {
  const fallbacks = _aiNonPrivateFallbacks(item);
  if (!_aiHasPrivateName(item)) return '';
  if (!fallbacks.length) {
    return '<span class="badge" style="background:rgba(70,160,90,.16);border-color:rgba(70,160,90,.45);color:var(--ok)">Private no-fallback OK</span>';
  }
  return '<span class="badge" style="background:rgba(190,70,70,.16);border-color:rgba(190,70,70,.55);color:var(--err)">Private non-private fallback</span>';
}

function _renderAiPrivateFallbackSummary(violations) {
  if (!violations.length) {
    return '<span style="color:var(--ok)">Private fallback check: ok.</span>';
  }
  const aliases = violations.map(item => item.alias || 'unnamed').slice(0, 5).join(', ');
  const suffix = violations.length > 5 ? `, +${violations.length - 5} more` : '';
  return `<span style="color:var(--err)">Private fallback check: ${violations.length} alias${violations.length === 1 ? '' : 'es'} with non-private fallback configured (${esc(aliases)}${suffix}).</span>`;
}

function _renderAiFallbacks(item) {
  const fallbacks = Array.isArray(item?.fallbacks) ? item.fallbacks.filter(Boolean) : [];
  if (!fallbacks.length) return '—';
  if (_aiHasPrivateName(item)) {
    return fallbacks.map(value => {
      const text = esc(value);
      return String(value || '').toUpperCase().includes('PRIVATE')
        ? text
        : `<span style="color:var(--err);font-weight:700">${text}</span>`;
    }).join(' → ');
  }
  return fallbacks.map(esc).join(' → ');
}

function _aiPrivateFallbackAlertKey(item) {
  const alias = String(item?.alias || 'alias').trim();
  const fallbacks = _aiNonPrivateFallbacks(item).map(String).join('|');
  return `${alias}=>${fallbacks}`;
}

function _aiGetAlertedPrivateFallbackKeys() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem('ai.privateFallbackAlertedKeys') || '[]'));
  } catch (_) {
    return new Set();
  }
}

function _aiSaveAlertedPrivateFallbackKeys(keys) {
  try {
    sessionStorage.setItem('ai.privateFallbackAlertedKeys', JSON.stringify(Array.from(keys).slice(-50)));
  } catch (_) { /* best effort */ }
}

async function _speakAiPrivateFallbackAlert(item) {
  if (typeof BlueprintsTtsClient === 'undefined' || typeof BlueprintsTtsClient.speak !== 'function') return;
  const alias = String(item?.alias || 'private alias');
  const fallbacks = _aiNonPrivateFallbacks(item).join(', ');
  try {
    await BlueprintsTtsClient.speak({
      text: `Warning. Private AI provider ${alias} has a non-private fallback configured: ${fallbacks}.`,
      interrupt: true,
      mode: 'stream',
      eventKind: 'ai_private_fallback_violation',
      fallbackKind: 'negative',
    });
  } catch (_) { /* best effort */ }
}

async function _showAiPrivateFallbackAlert(item, totalCount) {
  const alias = String(item?.alias || 'Unknown alias');
  const fallbacks = _aiNonPrivateFallbacks(item);
  const detail = [
    `Alias: ${alias}`,
    `Non-private fallback${fallbacks.length === 1 ? '' : 's'}: ${fallbacks.join(', ') || 'none'}`,
    totalCount > 1 ? `${totalCount - 1} additional PRIVATE alias${totalCount - 1 === 1 ? '' : 'es'} also need attention.` : '',
  ].filter(Boolean).join('\n');
  void _speakAiPrivateFallbackAlert(item);
  if (typeof HubDialogs !== 'undefined' && typeof HubDialogs.alert === 'function') {
    await HubDialogs.alert({
      tone: 'danger',
      badge: 'WARN',
      title: 'Private AI Fallback Detected',
      message: 'A PRIVATE AI provider has a non-private fallback in LiteLLM config.',
      detail,
      confirmText: 'Review',
    });
    return;
  }
  alert(`Private AI fallback detected.\n\n${detail}`);
}

function _maybeAlertAiPrivateFallbackViolation(violations) {
  if (!Array.isArray(violations) || !violations.length || _aiPrivateFallbackAlerting) return;
  const alerted = _aiGetAlertedPrivateFallbackKeys();
  const firstNew = violations.find(item => !alerted.has(_aiPrivateFallbackAlertKey(item)));
  if (!firstNew) return;
  if (_aiPrivateFallbackAlertTimer) window.clearTimeout(_aiPrivateFallbackAlertTimer);
  _aiPrivateFallbackAlertTimer = window.setTimeout(async () => {
    const key = _aiPrivateFallbackAlertKey(firstNew);
    const currentAlerted = _aiGetAlertedPrivateFallbackKeys();
    if (currentAlerted.has(key)) return;
    currentAlerted.add(key);
    _aiSaveAlertedPrivateFallbackKeys(currentAlerted);
    _aiPrivateFallbackAlerting = true;
    try {
      await _showAiPrivateFallbackAlert(firstNew, violations.length);
    } finally {
      _aiPrivateFallbackAlerting = false;
    }
  }, 250);
}

function _renderAiTtsGauge(alias, result) {
  const rawScore = Number(result?.compatibility_score);
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0;
  const tone = score >= 85 ? 'var(--ok)' : (score >= 45 ? 'var(--warn)' : 'var(--err)');
  const label = result?.compatibility_label || (result?.working ? 'Working' : 'Unavailable');
  return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
    <strong style="color:${tone}">${esc(label)}</strong>
    <span title="Compatibility ${score}%" style="display:inline-flex;align-items:center;width:74px;height:10px;border:1px solid var(--border);border-radius:999px;background:rgba(255,255,255,0.05);overflow:hidden;vertical-align:middle;">
      <span style="display:block;height:100%;width:${score}%;background:${tone};"></span>
    </span>
    <span style="font-size:11px;color:var(--text-dim)">${score}%</span>
    <button type="button" class="secondary" data-ai-obs-tts-detail="${esc(alias)}">Details</button>
  </div>`;
}

function _openAiObservabilityTtsDetail(alias) {
  const modal = document.getElementById('ai-tts-compat-modal');
  const titleEl = document.getElementById('ai-tts-compat-title');
  const bodyEl = document.getElementById('ai-tts-compat-body');
  if (!modal || !titleEl || !bodyEl) return;
  const result = _aiObservabilityResults[alias];
  titleEl.textContent = `TTS Compatibility — ${alias}`;
  if (!result) {
    bodyEl.innerHTML = '<p style="margin:0;color:var(--text-dim)">Run the TTS test first to populate the compatibility report.</p>';
    HubModal.open(modal);
    return;
  }
  const checks = Array.isArray(result.checks) ? result.checks : [];
  const summaryBits = [];
  if (result.compatibility_label) summaryBits.push(esc(result.compatibility_label));
  if (result.compatibility_score != null) summaryBits.push(`${Math.round(Number(result.compatibility_score) || 0)}%`);
  if (result.audio_content_type) summaryBits.push(esc(result.audio_content_type));
  if (result.audio_bytes) summaryBits.push(`${esc(String(result.audio_bytes))} bytes`);
  bodyEl.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div style="font-size:13px;line-height:1.45;">
        <strong style="color:${result.ok ? 'var(--ok)' : 'var(--warn)'}">${result.ok ? 'Working' : 'Not working'}</strong>
        <span style="color:var(--text-dim)"> · ${summaryBits.join(' · ') || 'No compatibility summary yet.'}</span>
      </div>
      <div style="font-size:12px;color:var(--text-dim);">${esc(result.detail || 'No detailed summary available.')}</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${checks.length ? checks.map(check => `
          <div style="border:1px solid var(--border);border-radius:var(--radius);padding:8px 10px;background:rgba(255,255,255,0.03);">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
              <strong style="color:${check.ok ? 'var(--ok)' : 'var(--warn)'}">${check.ok ? '✓' : '•'} ${esc(check.name || 'Check')}</strong>
              <span style="font-size:11px;color:var(--text-dim)">${esc(String(check.status ?? '—'))}</span>
            </div>
            <div style="font-size:12px;color:var(--text-dim);margin-top:4px;">${esc(check.detail || '—')}</div>
          </div>
        `).join('') : '<div style="color:var(--text-dim)">No per-check details were returned.</div>'}
      </div>
    </div>`;
  HubModal.open(modal);
}

function _renderAiObservabilityResult(alias) {
  const result = _aiObservabilityResults[alias];
  if (!result) return '<span style="color:var(--text-dim)">No test run yet.</span>';
  const ok = !!result.ok;
  const accent = ok ? 'var(--ok)' : 'var(--err)';
  const parts = [];
  parts.push(`<strong style="color:${accent}">${ok ? 'PASS' : 'FAIL'}</strong>`);
  if (result.elapsed_ms != null) parts.push(_formatAiProbeDuration(result.elapsed_ms));
  if (result.provider_family) parts.push(esc(result.provider_family));
  if (result.observed_model) parts.push(`actual: ${esc(result.observed_model)}`);
  if (result.failover_observed) parts.push('failover observed');
  if (result.preview) parts.push(esc(result.preview));
  if (result.detail) parts.push(esc(result.detail));
  if (result.kind === 'tts') {
    return `${_renderAiTtsGauge(alias, result)}<div style="margin-top:6px">${parts.join(' · ')}</div>`;
  }
  return parts.join(' · ');
}

function _setAiObservabilityActionStatus(message, tone = '') {
  _aiObservabilitySyncStatus = { message: message || '', tone: tone || '' };
  const el = document.getElementById('ai-observability-action-status');
  if (!el) return;
  if (!_aiObservabilitySyncStatus.message) {
    el.hidden = true;
    el.textContent = '';
    el.style.color = 'var(--text-dim)';
    return;
  }
  const palette = {
    ok: 'var(--ok)',
    warn: 'var(--warn)',
    err: 'var(--err)',
  };
  el.hidden = false;
  el.textContent = _aiObservabilitySyncStatus.message;
  el.style.color = palette[_aiObservabilitySyncStatus.tone] || 'var(--text-dim)';
}

function renderAiObservabilityPanel() {
  const panel = document.getElementById('ai-observability-panel');
  const note = document.getElementById('ai-observability-routing-note');
  const summary = document.getElementById('ai-observability-summary');
  const badge = document.getElementById('ai-observability-stack-badge');
  const syncBtn = document.getElementById('ai-observability-sync-now-btn');
  const dbLinkBtn = document.getElementById('ai-observability-db-link-btn');
  const testAllBtn = document.getElementById('ai-observability-test-all-btn');
  const list = document.getElementById('ai-observability-list');
  if (!panel || !note || !summary || !badge || !list || !testAllBtn || !syncBtn || !dbLinkBtn) return;

  const data = _aiObservability;
  if (!data || !data.panel_visible) {
    panel.hidden = true;
    note.hidden = true;
    list.innerHTML = '';
    return;
  }

  panel.hidden = false;
  note.hidden = false;
  const stack = data.stack || {};
  const running = !!stack.running;
  badge.textContent = running ? 'Stack running' : 'Stack present — degraded';
  badge.style.background = running ? 'rgba(70,160,90,.16)' : 'rgba(208,152,55,.16)';
  badge.style.borderColor = running ? 'rgba(70,160,90,.45)' : 'rgba(208,152,55,.45)';
  badge.style.color = running ? 'var(--ok)' : 'var(--warn)';

  const models = Array.isArray(data.models) ? data.models : [];
  const privateFallbackViolations = _aiPrivateFallbackViolations(models);
  const counts = data.counts || {};
  summary.innerHTML = `${esc(`${counts.aliases || 0} local aliases detected; ${counts.db_linked || 0} currently linked to DB provider rows. ${stack.message || ''}`.trim())} ${_renderAiPrivateFallbackSummary(privateFallbackViolations)}`.trim();
  _setAiObservabilityActionStatus(_aiObservabilitySyncStatus.message, _aiObservabilitySyncStatus.tone);

  const runnableCount = models.filter(item => item.supports_test).length;
  const dbLinker = data.db_linker || {};
  syncBtn.disabled = _aiObservabilitySyncRunning;
  syncBtn.textContent = _aiObservabilitySyncRunning ? '⟳ Syncing…' : '⇄ Sync Latest';
  dbLinkBtn.hidden = !dbLinker.available && !dbLinker.candidate_count;
  dbLinkBtn.disabled = !dbLinker.available || _aiObservabilityDbLinkRunning || _aiObservabilitySyncRunning || _aiObservabilityRunningAll;
  dbLinkBtn.textContent = _aiObservabilityDbLinkRunning ? 'Linking…' : `AI DB Link${dbLinker.candidate_count ? ` (${dbLinker.candidate_count})` : ''}`;
  dbLinkBtn.title = dbLinker.reason || 'Create DB provider rows for config-only aliases using local AI JSON proposals.';
  testAllBtn.disabled = !running || !runnableCount || _aiObservabilityRunningAll || _aiObservabilitySyncRunning || _aiObservabilityDbLinkRunning;
  testAllBtn.textContent = _aiObservabilityRunningAll ? 'Testing All…' : '▶ Test All';
  if (!models.length) {
    list.innerHTML = `<div style="padding:10px 12px;border:1px dashed var(--border);border-radius:var(--radius);color:var(--text-dim);font-size:12px;">The local LiteLLM stack is present, but no aliases were found in its current config.</div>`;
    return;
  }

  list.innerHTML = models.map(item => {
    const slug = _aiObsSlug(item.alias);
    const fallbacks = _renderAiFallbacks(item);
    const privateFallbackViolation = _aiNonPrivateFallbacks(item).length > 0 && _aiHasPrivateName(item);
    const apiBase = item.api_base ? esc(item.api_base) : 'default';
    const dbBadge = item.db_bound
      ? '<span class="badge" style="background:rgba(70,160,90,.16);border-color:rgba(70,160,90,.45);color:var(--ok)">DB-linked</span>'
      : '<span class="badge" style="background:rgba(208,152,55,.16);border-color:rgba(208,152,55,.45);color:var(--warn)">Config-only</span>';
    return `<div style="border:1px solid ${privateFallbackViolation ? 'rgba(190,70,70,.72)' : 'var(--border)'};border-radius:var(--radius);padding:10px 12px;background:${privateFallbackViolation ? 'rgba(190,70,70,.10)' : 'rgba(255,255,255,0.02)'};">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <strong>${esc(item.alias || '—')}</strong>
            ${dbBadge}
            ${_renderAiPrivateFallbackBadge(item)}
            <span style="font-size:11px;color:var(--text-dim)">${esc(item.kind || 'unknown')} · ${esc(item.behavior_hint || item.kind || 'unknown')}</span>
          </div>
          <div style="font-size:12px;color:var(--text-dim);margin-top:4px;">Target: ${esc(item.configured_model || '—')} · Provider: ${esc(item.provider_family || 'Configured')} · API base: ${apiBase}</div>
        </div>
        ${item.supports_vision_test
          ? `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
               <button type="button" class="secondary" data-ai-obs-vision-test="${esc(item.alias || '')}">Vision Test</button>
               <button type="button" class="secondary table-icon-btn" title="Vision test image path" data-ai-obs-vision-settings="${esc(item.alias || '')}" style="padding:4px 7px;font-size:13px;line-height:1">⚙</button>
             </div>`
          : item.kind === 'tts'
            ? `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                 <button type="button" class="secondary" data-ai-obs-test="${esc(item.alias || '')}" ${item.supports_test ? '' : 'disabled'}>${item.supports_test ? 'TTS Test' : 'No test yet'}</button>
                 <button type="button" class="secondary" data-ai-obs-tts-detail="${esc(item.alias || '')}">Details</button>
               </div>`
            : `<button type="button" class="secondary" data-ai-obs-test="${esc(item.alias || '')}" ${item.supports_test ? '' : 'disabled'}>${item.supports_test ? 'Test' : 'No test yet'}</button>`
        }
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-top:8px;font-size:12px;">
        <div><strong style="color:var(--text-dim)">Fallbacks</strong><br>${fallbacks}</div>
        <div><strong style="color:var(--text-dim)">Limits</strong><br>${esc(item.limits_text || '—')}</div>
        <div><strong style="color:var(--text-dim)">DB rows</strong><br>${_renderAiObservabilityDbRows(item)}</div>
      </div>
      <div id="ai-obs-result-${slug}" style="margin-top:8px;font-size:12px;color:var(--text-dim);">${_renderAiObservabilityResult(item.alias)}</div>
    </div>`;
  }).join('');
  _maybeAlertAiPrivateFallbackViolation(privateFallbackViolations);
}

async function runAiObservabilityDbLink() {
  if (_aiObservabilityDbLinkRunning) return;
  _aiObservabilityDbLinkRunning = true;
  _setAiObservabilityActionStatus('Asking the local private model for DB-link JSON, then validating the proposed provider rows…');
  renderAiObservabilityPanel();
  try {
    const r = await apiFetch('/api/v1/ai-providers/observability/db-link', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ dry_run: false }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) throw new Error(data.detail || data.error || `HTTP ${r.status}`);
    const applied = Number(data.applied_count || 0);
    const skipped = Array.isArray(data.skipped) ? data.skipped.length : 0;
    _setAiObservabilityActionStatus(
      applied
        ? `DB link complete. Added ${applied} provider row${applied === 1 ? '' : 's'}${skipped ? `; skipped ${skipped}.` : '.'}`
        : `DB link finished; no new rows were needed${skipped ? ` (${skipped} skipped).` : '.'}`,
      applied ? 'ok' : 'warn'
    );
    await loadAiProviders();
  } catch (e) {
    _setAiObservabilityActionStatus(`DB link failed: ${e.message || 'Unknown error.'}`, 'err');
  } finally {
    _aiObservabilityDbLinkRunning = false;
    renderAiObservabilityPanel();
  }
}

async function runAiObservabilitySyncNow() {
  if (_aiObservabilitySyncRunning) return;
  _aiObservabilitySyncRunning = true;
  _setAiObservabilityActionStatus('Querying the latest upstream running-models feed and reconciling the LiteLLM aliases for this node, the secondary isolated LiteLLM surface, and the third isolated LiteLLM surface when they are online and reachable…');
  renderAiObservabilityPanel();
  try {
    const r = await apiFetch('/api/v1/litellm-hook/sync-now', { method: 'POST' });
    const data = await r.json().catch(() => ({}));
    const summary = data.summary || {};

    if (!r.ok && !Object.keys(summary).length) {
      throw new Error(data.error || data.message || data.detail || `HTTP ${r.status}`);
    }

    const syncTargets = data.sync_targets || {};
    const secondaryKey = data.secondary_target_key || 'secondary_surface';
    const secondaryLabel = data.secondary_target_label || 'secondary isolated LiteLLM surface';
    const secondarySync = syncTargets[secondaryKey] || syncTargets.secondary || summary[secondaryKey] || summary.secondary;
    const thirdSurfaceSync = syncTargets.third_surface || null;

    const localChanged = !!summary.applied || !!summary.reloaded || !!syncTargets.local?.changed;
    const localOk = !!summary.verify?.ok && !!summary.alias_smoke?.ok;
    const secondaryOk = !secondarySync || !!secondarySync.ok || !!secondarySync.skipped;
    const remoteOk = !thirdSurfaceSync || !!thirdSurfaceSync.ok || !!thirdSurfaceSync.skipped;
    const overallOk = (!!data.ok && localOk && secondaryOk && remoteOk) || (!Object.keys(summary).length && !!data.ok);

    const localState = localChanged ? 'this node: updated and reloaded' : 'this node: already aligned';
    const secondaryState = secondarySync?.skipped
      ? `${secondaryLabel}: skipped`
      : (secondarySync ? `${secondaryLabel}: ${secondarySync.ok ? 'ok' : 'needs attention'}` : `${secondaryLabel}: not reported`);
    const remoteState = thirdSurfaceSync?.skipped
      ? 'third isolated LiteLLM surface: skipped'
      : (thirdSurfaceSync ? `third isolated LiteLLM surface: ${thirdSurfaceSync.ok ? 'ok' : 'needs attention'}` : 'third isolated LiteLLM surface: not reported');

    _aiObservabilityResults = Object.create(null);
    _setAiObservabilityActionStatus(
      `${overallOk ? 'Sync complete.' : (localOk ? 'Sync finished with warnings.' : 'Local sync needs attention.')} ${localState} · ${secondaryState} · ${remoteState}`,
      overallOk ? 'ok' : (localOk ? 'warn' : 'err')
    );
    await loadAiProviderObservability();
  } catch (e) {
    _setAiObservabilityActionStatus(`Sync request failed: ${e.message || 'Unknown error.'}`, 'err');
  } finally {
    _aiObservabilitySyncRunning = false;
    renderAiObservabilityPanel();
  }
}

async function runAiObservabilityTestAll() {
  const data = _aiObservability;
  const models = Array.isArray(data?.models) ? data.models.filter(item => item.supports_test) : [];
  if (!models.length || _aiObservabilityRunningAll || _aiObservabilitySyncRunning) return;
  _aiObservabilityRunningAll = true;
  renderAiObservabilityPanel();
  try {
    for (const item of models) {
      await runAiObservabilityTest(item.alias);
    }
  } finally {
    _aiObservabilityRunningAll = false;
    renderAiObservabilityPanel();
  }
}

async function runAiObservabilityTest(alias) {
  const escapedAlias = (window.CSS && typeof window.CSS.escape === 'function')
    ? window.CSS.escape(alias)
    : String(alias || '').replace(/"/g, '\\"');
  const button = document.querySelector(`[data-ai-obs-test="${escapedAlias}"]`);
  const resultEl = document.getElementById(`ai-obs-result-${_aiObsSlug(alias)}`);
  if (button) {
    button.disabled = true;
    button.textContent = 'Testing…';
  }
  if (resultEl) resultEl.textContent = 'Running a tiny live probe…';
  try {
    const r = await apiFetch('/api/v1/ai-providers/observability/test', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ alias }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
    _aiObservabilityResults[alias] = data;
  } catch (e) {
    _aiObservabilityResults[alias] = {
      ok: false,
      alias,
      detail: e.message || 'Test failed.',
    };
  } finally {
    renderAiObservabilityPanel();
    if (button) {
      button.disabled = false;
      button.textContent = 'Test';
    }
  }
}

/* ── Vision test ─────────────────────────────────────────────────────── */

async function runAiObservabilityVisionTest(alias) {
  const escapedAlias = (window.CSS && typeof window.CSS.escape === 'function')
    ? window.CSS.escape(alias)
    : String(alias || '').replace(/"/g, '\\"');
  const button = document.querySelector(`[data-ai-obs-vision-test="${escapedAlias}"]`);
  const resultEl = document.getElementById(`ai-obs-result-${_aiObsSlug(alias)}`);
  if (button) {
    button.disabled = true;
    button.textContent = 'Testing…';
  }
  if (resultEl) resultEl.textContent = 'Running vision probe (this may take a moment)…';
  try {
    const r = await apiFetch('/api/v1/ai-providers/observability/vision-test', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ alias }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
    if (data.status === 'vision_image_missing') {
      _aiObservabilityResults[alias] = data;
      renderAiObservabilityPanel();
      openVisionImageSettingsModal(alias);
      return;
    }
    _aiObservabilityResults[alias] = data;
  } catch (e) {
    _aiObservabilityResults[alias] = {
      ok: false,
      alias,
      detail: e.message || 'Vision test failed.',
    };
  } finally {
    renderAiObservabilityPanel();
    const btn = document.querySelector(`[data-ai-obs-vision-test="${escapedAlias}"]`);
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Vision Test';
    }
  }
}

async function openVisionImageSettingsModal(alias) {
  const modal = document.getElementById('ai-vision-image-modal');
  if (!modal) return;
  const input = document.getElementById('ai-vision-image-path');
  const errEl = document.getElementById('ai-vision-image-error');
  if (errEl) errEl.textContent = '';
  // Load current setting value
  if (input) {
    input.value = '';
    try {
      const r = await apiFetch('/api/v1/settings/ai_providers.vision_test_image');
      if (r.ok) {
        const d = await r.json().catch(() => ({}));
        input.value = d.value || '';
      }
    } catch (_) { /* leave blank */ }
  }
  if (typeof modal.showModal === 'function') modal.showModal();
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
  _ensureAiProvidersLayoutController()?.init();
  _ensureAiAssignmentsLayoutController()?.init();

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
  document.getElementById('ai-observability-refresh-btn')?.addEventListener('click', () => { void loadAiProviderObservability(); });
  document.getElementById('ai-observability-sync-now-btn')?.addEventListener('click', () => { void runAiObservabilitySyncNow(); });
  document.getElementById('ai-observability-db-link-btn')?.addEventListener('click', () => { void runAiObservabilityDbLink(); });
  document.getElementById('ai-observability-test-all-btn')?.addEventListener('click', () => { void runAiObservabilityTestAll(); });
  document.getElementById('ai-observability-list')?.addEventListener('click', e => {
    const testBtn = e.target.closest('[data-ai-obs-test]');
    if (testBtn && testBtn.dataset.aiObsTest) {
      void runAiObservabilityTest(testBtn.dataset.aiObsTest);
      return;
    }
    const visionBtn = e.target.closest('[data-ai-obs-vision-test]');
    if (visionBtn && visionBtn.dataset.aiObsVisionTest) {
      void runAiObservabilityVisionTest(visionBtn.dataset.aiObsVisionTest);
      return;
    }
    const settingsBtn = e.target.closest('[data-ai-obs-vision-settings]');
    if (settingsBtn && settingsBtn.dataset.aiObsVisionSettings) {
      void openVisionImageSettingsModal(settingsBtn.dataset.aiObsVisionSettings);
      return;
    }
    const ttsDetailBtn = e.target.closest('[data-ai-obs-tts-detail]');
    if (ttsDetailBtn && ttsDetailBtn.dataset.aiObsTtsDetail) {
      _openAiObservabilityTtsDetail(ttsDetailBtn.dataset.aiObsTtsDetail);
    }
  });

  // Vision image settings modal — save
  document.getElementById('ai-vision-image-save-btn')?.addEventListener('click', async () => {
    const modal = document.getElementById('ai-vision-image-modal');
    const input = document.getElementById('ai-vision-image-path');
    const errEl = document.getElementById('ai-vision-image-error');
    const val = (input?.value || '').trim();
    if (!val) {
      if (errEl) errEl.textContent = 'Path cannot be empty.';
      return;
    }
    if (errEl) errEl.textContent = '';
    try {
      const r = await apiFetch('/api/v1/settings/ai_providers.vision_test_image', {
        method: 'PUT',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ value: val }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        if (errEl) errEl.textContent = d.detail || `HTTP ${r.status}`;
        return;
      }
      if (modal && typeof modal.close === 'function') modal.close();
    } catch (e) {
      if (errEl) errEl.textContent = e.message || 'Save failed.';
    }
  });
});
