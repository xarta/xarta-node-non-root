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
    defaultWidth: 220,
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
let _svcTablePrefs = null;
let _svcHiddenCols = new Set();
let _svcTableSort = null;

function _ensureServicesTablePrefs() {
  if (_svcTablePrefs || typeof TablePrefs === 'undefined') return _svcTablePrefs;
  _svcTablePrefs = TablePrefs.create({
    storageKey: 'services-table-prefs',
    defaultHidden: [],
    minWidth: 40,
  });
  _svcTablePrefs.syncColumns(_SVC_COLS);
  _svcHiddenCols = _svcTablePrefs.getHiddenSet(_SVC_COLS);
  return _svcTablePrefs;
}

function _svcVisibleCols() {
  return _SVC_COLS.filter(col => !_svcHiddenCols.has(col));
}

function _ensureServicesTableSort() {
  if (_svcTableSort || typeof TableSort === 'undefined') return _svcTableSort;
  _svcTableSort = TableSort.create({
    storageKey: 'services-table-sort',
  });
  return _svcTableSort;
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
  const table = document.getElementById('services-table');
  if (!table) return;
  const tr = table.querySelector('thead tr');
  if (!tr) return;
  const prefs = _ensureServicesTablePrefs();
  const sorter = _ensureServicesTableSort();
  tr.innerHTML = _svcVisibleCols().map(col => {
    const meta = _SVC_FIELD_META[col];
    const width = prefs ? prefs.getWidth(col) : null;
    const styleParts = [];
    if (width) styleParts.push(`width:${width}px`);
    else if (meta.defaultWidth) styleParts.push(`width:${meta.defaultWidth}px`);
    const style = styleParts.length ? ` style="${styleParts.join(';')}"` : '';
    const sortAttrs = meta.sortKey ? ` data-sort-key="${meta.sortKey}"` : '';
    const classAttr = meta.sortKey ? ' class="table-th-sort"' : '';
    const labelHtml = sorter && meta.sortKey ? sorter.renderLabel(meta.label, meta.sortKey) : meta.label;
    return `<th data-col="${col}"${sortAttrs}${classAttr}${style}>${labelHtml}</th>`;
  }).join('');
}

function _svcRenderSharedTable(renderBody) {
  const prefs = _ensureServicesTablePrefs();
  if (!prefs) {
    _svcRebuildThead();
    renderBody();
    return;
  }
  prefs.renderTable({
    getTable: () => document.getElementById('services-table'),
    rebuildHead: _svcRebuildThead,
    renderBody,
    minWidth: 40,
    afterBind: tableEl => {
      const sorter = _ensureServicesTableSort();
      sorter?.bind(tableEl, renderServices);
      sorter?.syncIndicators(tableEl);
    },
  });
}

function svcOpenColsModal() {
  const prefs = _ensureServicesTablePrefs();
  if (!prefs) return;
  const list = document.getElementById('svc-cols-modal-list');
  TablePrefs.renderColumnChooser(list, _SVC_COLS, _svcHiddenCols, col => _SVC_FIELD_META[col].label);
  HubModal.open(document.getElementById('svc-cols-modal'));
}

function _svcApplyColsModal() {
  const prefs = _ensureServicesTablePrefs();
  if (!prefs) return;
  const modal = document.getElementById('svc-cols-modal');
  const newHidden = TablePrefs.readHiddenFromChooser(modal, new Set(_svcHiddenCols));
  prefs.setHiddenSet(newHidden);
  _svcHiddenCols = prefs.getHiddenSet(_SVC_COLS);
  _svcRebuildThead();
  renderServices();
  HubModal.close(modal);
}

document.addEventListener('DOMContentLoaded', () => {
  _ensureServicesTablePrefs();
  document.getElementById('add-modal-save-btn')?.addEventListener('click', submitAddService);
  document.getElementById('svc-cols-modal-apply')?.addEventListener('click', _svcApplyColsModal);

  const svcSearch = document.getElementById('search-input');
  if (svcSearch) {
    svcSearch.addEventListener('input', () => {
      clearTimeout(_svcFilterTimer);
      _svcFilterTimer = setTimeout(renderServices, 250);
    });
  }
  _svcTablePrefs?.onLayoutChange(() => {
    _svcHiddenCols = _svcTablePrefs.getHiddenSet(_SVC_COLS);
    _svcRebuildThead();
    renderServices();
  });
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
  _ensureServicesTablePrefs();
  const sorter = _ensureServicesTableSort();
  const q = (document.getElementById('search-input').value || '').toLowerCase();
  const tbody = document.getElementById('services-tbody');
  let visible = _services.filter(s =>
    !q || s.name.toLowerCase().includes(q) ||
    (s.description || '').toLowerCase().includes(q) ||
    (s.service_id || '').toLowerCase().includes(q) ||
    (s.vm_or_lxc || '').toLowerCase().includes(q)
  );
  visible = sorter ? sorter.sortRows(visible, _svcSortValue) : visible;
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
