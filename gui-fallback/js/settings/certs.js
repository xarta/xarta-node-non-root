/* ── Certs ──────────────────────────────────────────────────────────────── */
const _CERT_COLS = ['label', 'env_var', 'path', 'present', 'details', '_actions'];
const _CERT_FIELD_META = {
  label: { label: 'Name', sortKey: 'label' },
  env_var: { label: 'Env Var', sortKey: 'env_var' },
  path: { label: 'Path', sortKey: 'path' },
  present: { label: 'Status', sortKey: 'present' },
  details: { label: 'Details', sortKey: 'details' },
  _actions: { label: 'Action' },
};

let _certs = [];
let _certsDir = '';
let _certsTableView = null;

function _ensureCertsTableView() {
  if (_certsTableView || typeof TableView === 'undefined') return _certsTableView;
  _certsTableView = TableView.create({
    storageKey: 'certs-status-table-prefs',
    columns: _CERT_COLS,
    meta: _CERT_FIELD_META,
    getTable: () => document.getElementById('certs-status-table'),
    fallbackColumn: 'label',
    minWidth: 40,
    getDefaultWidth: col => {
      if (col === 'path') return 280;
      if (col === 'env_var') return 150;
      if (col === 'present') return 110;
      if (col === '_actions') return 62;
      return null;
    },
    sort: {
      storageKey: 'certs-status-table-sort',
      defaultKey: 'label',
      defaultDir: 1,
    },
    onSortChange: () => {
      renderCertsTable();
      _ensureCertsLayoutController()?.scheduleLayoutSave();
    },
    onColumnResizeEnd: () => {
      _ensureCertsLayoutController()?.scheduleLayoutSave();
    },
  });
  return _certsTableView;
}

let _certsLayoutController = null;

function _certsColumnSeed(col) {
  const types = { label: 'TEXT', env_var: 'TEXT', path: 'TEXT', present: 'INTEGER', details: 'TEXT' };
  const lengths = { label: 36, env_var: 32, path: 60, present: 6, details: 80 };
  return {
    sqlite_column: (col === 'details' || col.startsWith('_')) ? null : col,
    data_type: types[col] || null,
    sample_max_length: lengths[col] || null,
    min_width_px: col === '_actions' ? 40 : 40,
    max_width_px: col === '_actions' ? 62 : 900,
    width_px: _ensureCertsTableView()?.prefs?.getWidth(col) || null,
  };
}

function _ensureCertsLayoutController() {
  if (_certsLayoutController || typeof TableBucketLayouts === 'undefined') return _certsLayoutController;
  _certsLayoutController = TableBucketLayouts.create({
    getTable: () => document.getElementById('certs-status-table'),
    getView: () => _ensureCertsTableView(),
    getColumns: () => _CERT_COLS,
    getMeta: col => _CERT_FIELD_META[col],
    getDefaultWidth: col => {
      if (col === 'path') return 280;
      if (col === 'env_var') return 150;
      if (col === 'present') return 110;
      if (col === '_actions') return 62;
      return null;
    },
    getColumnSeed: col => _certsColumnSeed(col),
    render: () => renderCertsTable(),
    surfaceLabel: 'Certificates',
    layoutContextTitle: 'Certificates Layout Context',
  });
  return _certsLayoutController;
}

async function toggleCertsHorizontalScroll() {
  const controller = _ensureCertsLayoutController();
  if (!controller) return;
  await controller.toggleHorizontalScroll();
}

async function openCertsLayoutContextModal() {
  const controller = _ensureCertsLayoutController();
  if (!controller) return;
  await controller.openLayoutContextModal();
}

function _certsVisibleCols() {
  return _ensureCertsTableView()?.getVisibleCols() || ['label'];
}

function _certSortValue(cert, sortKey) {
  switch (sortKey) {
    case 'label':
      return cert.label || '';
    case 'env_var':
      return cert.env_var || '';
    case 'path':
      return cert.path || '';
    case 'present':
      return cert.present ? 1 : 0;
    case 'details':
      return cert.kind === 'key'
        ? 'private key'
        : [cert.cn || '', cert.expires || '', cert.is_ca ? 'ca' : ''].join(' ');
    default:
      return '';
  }
}

function _certExpiryStyle(days) {
  if (days === null || days === undefined) return '';
  if (days < 0) return 'color:var(--err);font-weight:600';
  if (days < 7) return 'color:var(--err)';
  if (days < 30) return 'color:#e8a82a';
  return 'color:var(--ok)';
}

function _certExpiryLabel(expires, days) {
  if (!expires) return '';
  const suffix = days !== null && days !== undefined
    ? (days < 0 ? ` (expired ${Math.abs(days)}d ago)` : ` (${days}d)`)
    : '';
  return expires + suffix;
}

function _certLabelCell(cert) {
  return `<td style="font-weight:600">${esc(cert.label || '—')}</td>`;
}

function _certEnvVarCell(cert) {
  return `<td style="font-family:monospace;font-size:11px;color:var(--text-dim)">${esc(cert.env_var || '—')}</td>`;
}

function _certPathCell(cert) {
  const pathNote = cert.path_source === 'default'
    ? ` <span title="Env var ${esc(cert.env_var || '')} not set — using default path" style="color:var(--text-dim);font-size:10px">(default)</span>`
    : '';
  return `<td><span class="table-cell-clamp" style="font-family:monospace;font-size:11px;color:var(--text-dim);line-height:1.3">${esc(cert.path || '—')}${pathNote}</span></td>`;
}

function _certStatusCell(cert) {
  return `<td>${cert.present
    ? '<span style="color:var(--ok)">&#10003; present</span>'
    : '<span style="color:var(--err)">&#10007; missing</span>'}</td>`;
}

function _certDetailsCell(cert) {
  if (cert.kind === 'key') {
    return '<td><span style="color:var(--text-dim);font-size:12px">private key</span></td>';
  }
  if (!(cert.cn || cert.expires)) return '<td></td>';
  const cnPart = cert.cn ? `<span class="table-cell-clip"><span class="table-cell-clip__text" style="font-family:monospace;font-size:11px">${esc(cert.cn)}</span></span>` : '';
  const expPart = cert.expires
    ? `<span style="${_certExpiryStyle(cert.expires_days)};font-size:11px">Exp: ${esc(_certExpiryLabel(cert.expires, cert.expires_days))}</span>`
    : '';
  const caPart = cert.is_ca ? `<span style="color:var(--text-dim);font-size:11px"> [CA]</span>` : '';
  return `<td>${[cnPart, expPart + caPart].filter(Boolean).join('<br>')}</td>`;
}

function _certActionsCell(cert) {
  return `<td class="table-action-cell" style="white-space:nowrap"><div class="table-inline-actions"><button class="secondary table-icon-btn table-icon-btn--save" type="button" title="Upload PEM content" aria-label="Upload PEM content" data-cert-id="${esc(cert.id || '')}" data-cert-label="${esc(cert.label || '')}" data-cert-kind="${esc(cert.kind || '')}"></button></div></td>`;
}

function openCertsColsModal() {
  const view = _ensureCertsTableView();
  if (!view) return;
  view.openColumns(
    document.getElementById('certs-cols-modal-list'),
    document.getElementById('certs-cols-modal'),
    col => _CERT_FIELD_META[col].label
  );
}

function _applyCertsColsModal() {
  const view = _ensureCertsTableView();
  if (!view) return;
  const modal = document.getElementById('certs-cols-modal');
  view.applyColumns(modal, () => {
    renderCertsTable();
    HubModal.close(modal);
    _ensureCertsLayoutController()?.scheduleLayoutSave();
  });
}

async function loadCerts() {
  const tbody = document.getElementById('certs-status-tbody');
  const err   = document.getElementById('certs-status-error');
  err.hidden  = true;
  tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Loading…</td></tr>';
  try {
    const r = await apiFetch('/api/v1/certs/status');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    _certs = Array.isArray(data.certs) ? data.certs : [];
    _certsDir = data.certs_dir || '';
    renderCertsTable();
  } catch (e) {
    err.textContent = `Failed to load cert status: ${e.message}`;
    err.hidden = false;
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">—</td></tr>';
  }
}

function renderCertsTable() {
  const tbody = document.getElementById('certs-status-tbody');
  const dirEl = document.getElementById('certs-dir-hint');
  const view = _ensureCertsTableView();
  const visibleCols = _certsVisibleCols();
  if (dirEl) dirEl.textContent = _certsDir || '(not configured)';

  if (!_certs.length) {
    view?.render(() => {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${Math.max(1, visibleCols.length)}">No certificate slots configured.</td></tr>`;
    });
    return;
  }

  const groups = { caddy: [], mtls: [] };
  _certs.forEach(c => (groups[c.group] || groups.caddy).push(c));

  const GROUP_LABELS = { caddy: 'Caddy TLS', mtls: 'mTLS Sync' };
  let html = '';

  for (const [groupKey, groupCerts] of Object.entries(groups)) {
    if (!groupCerts.length) continue;
    html += `<tr style="background:var(--bg)">
      <td colspan="${Math.max(1, visibleCols.length)}" style="font-size:11px;font-weight:700;text-transform:uppercase;
        letter-spacing:.6px;color:var(--text-dim);padding:6px 8px;border-bottom:1px solid var(--border)">
        ${esc(GROUP_LABELS[groupKey] || groupKey)}
      </td></tr>`;

    const rows = view?.sorter ? view.sorter.sortRows(groupCerts, _certSortValue) : groupCerts;
    rows.forEach(c => {
      html += `<tr>${visibleCols.map(col => {
        switch (col) {
          case 'label':
            return _certLabelCell(c);
          case 'env_var':
            return _certEnvVarCell(c);
          case 'path':
            return _certPathCell(c);
          case 'present':
            return _certStatusCell(c);
          case 'details':
            return _certDetailsCell(c);
          case '_actions':
            return _certActionsCell(c);
          default:
            return '';
        }
      }).join('')}</tr>`;
    });
  }

  view?.render(() => {
    tbody.innerHTML = html;
  });
}

/* ── Upload modal ───────────────────────────────────────────────────────── */
function openCertUpload(id, label, kind) {
  document.getElementById('certs-upload-id').value   = id;
  const badgeEl = document.getElementById('certs-upload-badge');
  document.getElementById('certs-upload-title').textContent = `Upload: ${label}`;
  document.getElementById('certs-upload-pem').value  = '';
  document.getElementById('certs-upload-result').textContent = '';
  document.getElementById('certs-upload-result').style.color = '';
  document.getElementById('certs-upload-btn').disabled = false;

  if (badgeEl) {
    badgeEl.textContent = kind === 'key' ? 'KEY' : (kind === 'ca' ? 'CA' : 'CERT');
  }

  const hints = {
    ca:   'Paste the CA certificate PEM (-----BEGIN CERTIFICATE-----). ' +
          'It will be installed into the system trust store automatically.',
    cert: 'Paste the certificate PEM (-----BEGIN CERTIFICATE-----). ' +
          'Do not include private key material here.',
    key:  'Paste the private key PEM (-----BEGIN ... PRIVATE KEY-----). ' +
          'A corresponding certificate must be uploaded to the matching cert slot.',
  };
  document.getElementById('certs-upload-hint').textContent = hints[kind] || '';

  HubModal.open(document.getElementById('certs-upload-modal'));
  setTimeout(() => document.getElementById('certs-upload-pem').focus(), 50);
}

function closeCertUpload() {
  HubModal.close(document.getElementById('certs-upload-modal'));
}

/* File-from-disk loader — reads the file and fills the textarea */
function certLoadFile() {
  const fi = document.getElementById('certs-file-input');
  fi.value = '';
  fi.onchange = function () {
    const file = fi.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      document.getElementById('certs-upload-pem').value = e.target.result;
    };
    reader.onerror = function () {
      document.getElementById('certs-upload-result').textContent = 'Failed to read file.';
      document.getElementById('certs-upload-result').style.color = 'var(--err)';
    };
    reader.readAsText(file);
  };
  fi.click();
}

async function submitCertUpload() {
  const id       = document.getElementById('certs-upload-id').value;
  const pem      = document.getElementById('certs-upload-pem').value.trim();
  const resultEl = document.getElementById('certs-upload-result');
  const btn      = document.getElementById('certs-upload-btn');

  if (!pem) {
    resultEl.textContent = 'Nothing to upload — paste PEM content or load a file first.';
    resultEl.style.color = 'var(--err)';
    return;
  }

  btn.disabled = true;
  resultEl.textContent = 'Uploading…';
  resultEl.style.color = 'var(--text-dim)';

  try {
    const r = await apiFetch('/api/v1/certs/upload', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, pem }),
    });
    const data = await r.json();

    if (!r.ok || data.status === 'failed') {
      resultEl.textContent = `Failed: ${data.detail || data.status}`;
      resultEl.style.color = 'var(--err)';
    } else {
      let msg = `Uploaded successfully.`;
      if (data.ca_installed) msg += ` CA: ${data.ca_installed}.`;
      resultEl.textContent = msg;
      resultEl.style.color = 'var(--ok)';
      loadCerts();
      setTimeout(() => HubModal.close(document.getElementById('certs-upload-modal')), 1200);
    }
  } catch (e) {
    resultEl.textContent = `Error: ${e.message}`;
    resultEl.style.color = 'var(--err)';
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  _ensureCertsTableView();
  _ensureCertsLayoutController()?.init();
  document.getElementById('certs-cols-modal-apply')?.addEventListener('click', _applyCertsColsModal);
  // Table event delegation — Upload buttons
  document.getElementById('certs-status-tbody')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-cert-id]');
    if (btn) openCertUpload(btn.dataset.certId, btn.dataset.certLabel, btn.dataset.certKind);
  });

  // Modal buttons
  document.getElementById('certs-upload-btn')?.addEventListener('click', submitCertUpload);
  document.getElementById('certs-load-file-btn')?.addEventListener('click', certLoadFile);
  _certsTableView?.onLayoutChange(() => {
    renderCertsTable();
  });
});
