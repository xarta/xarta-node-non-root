/* ── Services ─────────────────────────────────────────────────────────── */
const _SVC_COLS = ['service_id', 'name', 'host_machine', 'project_status', 'tags', 'links', 'description'];
const _SVC_FIELD_META = {
  service_id: {
    label: 'ID',
    sortKey: 'service_id',
    defaultWidth: 150,
    render: s => `<td><code style="font-size:12px;color:var(--text-dim)">${esc(s.service_id || '')}</code></td>`,
  },
  name: {
    label: 'Name',
    sortKey: 'name',
    defaultWidth: 220,
    render: s => {
      const links = Array.isArray(s.links) ? s.links : [];
      const primaryUrl = links.length ? (links[0].url || links[0].href || '') : '';
      const name = s.name || '—';
      return primaryUrl
        ? `<td><a class="name-link" href="${esc(primaryUrl)}" target="_blank" rel="noopener"><strong>${esc(name)}</strong></a></td>`
        : `<td><strong>${esc(name)}</strong></td>`;
    },
  },
  host_machine: {
    label: 'Host / LXC',
    sortKey: 'host_machine',
    defaultWidth: 190,
    render: s => `<td>${esc(s.host_machine || '')}${s.vm_or_lxc ? ' / ' + esc(s.vm_or_lxc) : ''}</td>`,
  },
  project_status: {
    label: 'Status',
    sortKey: 'project_status',
    defaultWidth: 100,
    render: s => `<td><span class="status-${(s.project_status || '').replace(/[^a-z]/g, '')}">${esc(s.project_status || '')}</span></td>`,
  },
  tags: {
    label: 'Tags',
    sortKey: 'tags',
    defaultWidth: 180,
    render: s => `<td>${(s.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</td>`,
  },
  links: {
    label: 'Links',
    sortKey: 'links',
    defaultWidth: 76,
    render: s => {
      const linkBadges = (s.links || []).map(l => {
        const href = l.url || l.href || '#';
        const label = l.label || l.name || href;
        return `<a class="link-badge" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>`;
      }).join('');
      return `<td>${linkBadges || '<span style="color:var(--text-dim)">—</span>'}</td>`;
    },
  },
  description: {
    label: 'Description',
    sortKey: 'description',
    defaultWidth: 260,
    render: s => `<td style="color:var(--text-dim);font-size:13px">${esc(s.description || '')}</td>`,
  },
};

let _svcFilterTimer = null;
let _svcTableView = null;
let _svcLayoutController = null;

function _ensureServicesTableView() {
  if (_svcTableView || typeof TableView === 'undefined') return _svcTableView;
  _svcTableView = TableView.create({
    storageKey: 'services-table-prefs',
    columns: _SVC_COLS,
    meta: _SVC_FIELD_META,
    getTable: () => document.getElementById('services-table'),
    getDefaultWidth: col => (_SVC_FIELD_META[col] || {}).defaultWidth || null,
    minWidth: 40,
    sort: {
      storageKey: 'services-table-sort',
    },
    onSortChange: () => {
      renderServices();
      _ensureServicesLayoutController()?.scheduleLayoutSave();
    },
    onColumnResizeEnd: () => {
      _ensureServicesLayoutController()?.scheduleLayoutSave();
    },
  });
  return _svcTableView;
}

function _svcVisibleCols() {
  const view = _ensureServicesTableView();
  return view ? view.getVisibleCols() : _SVC_COLS;
}

function _svcColumnSeed(col) {
  switch (col) {
    case 'service_id':
      return { sqlite_column: 'service_id', data_type: 'TEXT', sample_max_length: 32, min_width_px: 100, max_width_px: 320 };
    case 'name':
      return { sqlite_column: 'name', data_type: 'TEXT', sample_max_length: 32, min_width_px: 140, max_width_px: 520 };
    case 'host_machine':
      return { sqlite_column: 'host_machine', data_type: 'TEXT', sample_max_length: 28, min_width_px: 120, max_width_px: 420 };
    case 'project_status':
      return { sqlite_column: 'project_status', data_type: 'TEXT', sample_max_length: 16, min_width_px: 96, max_width_px: 220 };
    case 'tags':
      return { sqlite_column: 'tags', data_type: 'TEXT', sample_max_length: 32, min_width_px: 120, max_width_px: 520 };
    case 'links':
      return { sqlite_column: 'links', data_type: 'TEXT', sample_max_length: 16, min_width_px: 50, max_width_px: 360 };
    case 'description':
      return { sqlite_column: 'description', data_type: 'TEXT', sample_max_length: 80, min_width_px: 160, max_width_px: 1400 };
    default:
      return {};
  }
}

function _ensureServicesLayoutController() {
  if (_svcLayoutController || typeof TableBucketLayouts === 'undefined') return _svcLayoutController;
  _svcLayoutController = TableBucketLayouts.create({
    getTable: () => document.getElementById('services-table'),
    getView: () => _ensureServicesTableView(),
    getColumns: () => _SVC_COLS,
    getMeta: col => _SVC_FIELD_META[col],
    getDefaultWidth: col => (_SVC_FIELD_META[col] || {}).defaultWidth || null,
    getColumnSeed: col => _svcColumnSeed(col),
    render: () => renderServices(),
    surfaceLabel: 'Services',
    layoutContextTitle: 'Services Layout Context',
  });
  return _svcLayoutController;
}

function _svcSortValue(service, sortKey) {
  switch (sortKey) {
    case 'service_id':
      return service.service_id || '';
    case 'name':
      return service.name || '';
    case 'host_machine':
      return (service.host_machine || '') + ' ' + (service.vm_or_lxc || '');
    case 'project_status':
      return service.project_status || '';
    case 'tags':
      return (service.tags || []).join(' ');
    case 'links':
      return (service.links || []).map(link => link.label || link.name || link.url || link.href || '').join(' ');
    case 'description':
      return service.description || '';
    default:
      return '';
  }
}

function _svcRebuildThead() {
  const view = _ensureServicesTableView();
  view?.rebuildHead();
}

function _svcRenderSharedTable(renderBody) {
  const view = _ensureServicesTableView();
  if (!view) return;
  view.render(renderBody);
}

function svcOpenColsModal() {
  const view = _ensureServicesTableView();
  if (!view) return;
  view.openColumns(
    document.getElementById('svc-cols-modal-list'),
    document.getElementById('svc-cols-modal')
  );
}

function _svcApplyColsModal() {
  const view = _ensureServicesTableView();
  if (!view) return;
  const modal = document.getElementById('svc-cols-modal');
  view.applyColumns(modal, () => {
    renderServices();
    HubModal.close(modal);
    _ensureServicesLayoutController()?.scheduleLayoutSave();
  });
}

async function toggleServicesHorizontalScroll() {
  const controller = _ensureServicesLayoutController();
  if (!controller) return;
  await controller.toggleHorizontalScroll();
}

async function openServicesLayoutContextModal() {
  const controller = _ensureServicesLayoutController();
  if (!controller) return;
  await controller.openLayoutContextModal();
}

document.addEventListener('DOMContentLoaded', () => {
  _ensureServicesTableView();
  _ensureServicesLayoutController()?.init();
  document.getElementById('add-modal-save-btn')?.addEventListener('click', submitAddService);
  document.getElementById('svc-cols-modal-apply')?.addEventListener('click', _svcApplyColsModal);

  const svcSearch = document.getElementById('search-input');
  if (svcSearch) {
    svcSearch.addEventListener('input', () => {
      clearTimeout(_svcFilterTimer);
      _svcFilterTimer = setTimeout(renderServices, 250);
    });
  }
  if (typeof ResponsiveLayout !== 'undefined') {
    ResponsiveLayout.registerTabControls('services', 'pg-ctrl-services');
  }
});
async function loadServices() {
  const err = document.getElementById('services-error');
  err.hidden = true;
  try {
    const r = await apiFetch('/api/v1/services');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _services = await r.json();
    renderServices();
  } catch (e) {
    err.textContent = `Failed to load services: ${e.message}`;
    err.hidden = false;
  }
}

function renderServices() {
  const view = _ensureServicesTableView();
  const q = (document.getElementById('search-input').value || '').toLowerCase();
  const tbody = document.getElementById('services-tbody');
  let visible = _services.filter(s =>
    !q || s.name.toLowerCase().includes(q) ||
    (s.description || '').toLowerCase().includes(q) ||
    (s.service_id || '').toLowerCase().includes(q) ||
    (s.vm_or_lxc || '').toLowerCase().includes(q)
  );
  visible = view?.sorter ? view.sorter.sortRows(visible, _svcSortValue) : visible;
  if (!visible.length) {
    _svcRenderSharedTable(() => {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${Math.max(1, _svcVisibleCols().length)}">${_services.length ? 'No matching services.' : 'No services — add one above.'}</td></tr>`;
    });
    return;
  }
  _svcRenderSharedTable(() => {
    tbody.innerHTML = visible.map(s => `<tr>${_svcVisibleCols().map(col => _SVC_FIELD_META[col].render(s)).join('')}</tr>`).join('');
  });
}

/* ── Add service modal ────────────────────────────────────────────────── */
function openAddModal() {
  ['m-id','m-name','m-host','m-lxc','m-desc','m-url'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('modal-error').textContent = '';
  HubModal.open(document.getElementById('add-modal'));
}

async function submitAddService() {
  const id   = document.getElementById('m-id').value.trim();
  const name = document.getElementById('m-name').value.trim();
  const err  = document.getElementById('modal-error');
  if (!id || !name) { err.textContent = 'ID and Name are required'; return; }
  try {
    const r = await apiFetch('/api/v1/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        service_id:    id,
        name,
        host_machine:  document.getElementById('m-host').value.trim() || null,
        vm_or_lxc:     document.getElementById('m-lxc').value.trim()  || null,
        description:   document.getElementById('m-desc').value.trim() || null,
        project_status: 'deployed',
        links: (() => {
          const u = document.getElementById('m-url').value.trim();
          return u ? [{ label: 'Open', url: u }] : null;
        })(),
      }),
    });
    if (!r.ok) { const t=await r.text(); throw new Error(t); }
    HubModal.close(document.getElementById('add-modal'));
    await loadServices();
  } catch (e) {
    err.textContent = `Error: ${e.message}`;
  }
}
