/* ── AI Providers + Project Assignments ─────────────────────────────── */

let _editingAiProviderId = null;
let _editingAiAssignmentId = null;

function _providerModalEls() {
  return {
    dialog: document.getElementById('ai-provider-modal'),
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

function renderAiProviders() {
  const tbody = document.getElementById('ai-providers-tbody');
  if (!tbody) return;
  if (!_aiProviders.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No providers yet — click "+ Add provider" to add one.</td></tr>';
    return;
  }
  tbody.innerHTML = _aiProviders.map(p => `<tr>
    <td title="${esc(p.model_type)}">${_typeIcon(p.model_type)} ${esc(p.model_type)}</td>
    <td><strong>${esc(p.name)}</strong></td>
    <td><code>${esc(p.model_name)}</code></td>
    <td style="text-align:right">${p.dimensions ?? '—'}</td>
    <td style="text-align:center">${p.enabled ? '&#9989;' : '&#10060;'}</td>
    <td style="color:var(--text-dim);font-size:12px">${esc(p.notes || '')}</td>
    <td style="white-space:nowrap">
      <button class="secondary" style="padding:1px 6px;font-size:11px"
        onclick="openAiProviderModal('${esc(p.provider_id)}')">&#9998; Edit</button>
      <button class="secondary" style="padding:1px 6px;font-size:11px;color:#f87171;border-color:#f87171;margin-left:4px"
        onclick="deleteAiProvider('${esc(p.provider_id)}','${esc(p.name)}')">&#x2715;</button>
    </td>
  </tr>`).join('');
}

function renderAiAssignments() {
  const tbody = document.getElementById('ai-assignments-tbody');
  if (!tbody) return;
  if (!_aiAssignments.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No assignments yet.</td></tr>';
    return;
  }
  const providerMap = Object.fromEntries(_aiProviders.map(p => [p.provider_id, p]));
  tbody.innerHTML = _aiAssignments.map(a => {
    const prov = providerMap[a.provider_id];
    const provLabel = prov ? `${esc(prov.model_name)} <span style="color:var(--text-dim);font-size:11px">(${esc(prov.name)})</span>` : esc(a.provider_id.slice(0,8));
    return `<tr>
      <td><strong>${esc(a.project_name)}</strong></td>
      <td>${_typeIcon(a.role)} ${esc(a.role)}</td>
      <td>${provLabel}</td>
      <td style="text-align:right">${a.priority}</td>
      <td style="text-align:center">${a.enabled ? '&#9989;' : '&#10060;'}</td>
      <td style="white-space:nowrap">
        <button class="secondary" style="padding:1px 6px;font-size:11px"
          onclick="openAiAssignmentModal('${esc(a.assignment_id)}')">&#9998; Edit</button>
        <button class="secondary" style="padding:1px 6px;font-size:11px;color:#f87171;border-color:#f87171;margin-left:4px"
          onclick="deleteAiAssignment('${esc(a.assignment_id)}','${esc(a.project_name)}','${esc(a.role)}')">&#x2715;</button>
      </td>
    </tr>`;
  }).join('');
}

/* ── Provider modal ─────────────────────────────────────────────────── */

function openAiProviderModal(provider_id) {
  const modal = _providerModalEls();
  const existing = provider_id ? _aiProviders.find(p => p.provider_id === provider_id) : null;
  _editingAiProviderId = existing ? existing.provider_id : null;
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

async function deleteAiProvider(provider_id, name) {
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

async function deleteAiAssignment(assignment_id, project, role) {
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
