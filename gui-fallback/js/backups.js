/* ── Backups ───────────────────────────────────────────────────────────── */

const _BACKUP_COLS = ['filename', 'size_bytes', 'created_at', '_actions'];
const _BACKUP_FIELD_META = {
  filename: { label: 'Filename', sortKey: 'filename' },
  size_bytes: { label: 'Size', sortKey: 'size_bytes' },
  created_at: { label: 'Created', sortKey: 'created_at' },
  _actions: { label: 'Actions' },
};

const _BACKUP_ACTION_INLINE_WIDTH = 102;
const _BACKUP_ACTION_COMPACT_WIDTH = 48;

let _backups = [];
let _backupEmptyMessage = 'Loading…';
let _backupTableView = null;

document.addEventListener('DOMContentLoaded', () => {
  const createBtn = document.getElementById('backup-create-btn');
  if (createBtn && !createBtn.dataset.bound) {
    createBtn.addEventListener('click', () => createBackup(createBtn));
    createBtn.dataset.bound = '1';
  }

  const refreshBtn = document.getElementById('backup-refresh-btn');
  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.addEventListener('click', () => loadBackups());
    refreshBtn.dataset.bound = '1';
  }

  const tbody = document.getElementById('backup-tbody');
  if (tbody && !tbody.dataset.bound) {
    tbody.addEventListener('click', onBackupTableClick);
    tbody.dataset.bound = '1';
  }

  const confirmBtn = document.getElementById('backup-action-modal-confirm');
  if (confirmBtn && !confirmBtn.dataset.bound) {
    confirmBtn.addEventListener('click', submitBackupAction);
    confirmBtn.dataset.bound = '1';
  }

  const colsApplyBtn = document.getElementById('backups-cols-modal-apply');
  if (colsApplyBtn && !colsApplyBtn.dataset.bound) {
    colsApplyBtn.addEventListener('click', _applyBackupsColsModal);
    colsApplyBtn.dataset.bound = '1';
  }

  _ensureBackupsTableView();
  _backupTableView?.onLayoutChange(() => {
    renderBackups();
  });
});

let _pendingBackupAction = null;

function _ensureBackupsTableView() {
  if (_backupTableView || typeof TableView === 'undefined') return _backupTableView;
  _backupTableView = TableView.create({
    storageKey: 'backups-table-prefs',
    columns: _BACKUP_COLS,
    meta: _BACKUP_FIELD_META,
    getTable: () => document.getElementById('backups-table'),
    fallbackColumn: 'filename',
    minWidth: 40,
    getDefaultWidth: col => {
      if (col === '_actions') return _backupActionCellWidth();
      if (col === 'size_bytes') return 90;
      if (col === 'created_at') return 170;
      return null;
    },
    sort: {
      storageKey: 'backups-table-sort',
      defaultKey: 'created_at',
      defaultDir: -1,
    },
    onSortChange: () => {
      renderBackups();
      _ensureBackupsLayoutController()?.scheduleLayoutSave();
    },
    onColumnResizeEnd: () => {
      _ensureBackupsLayoutController()?.scheduleLayoutSave();
    },
  });
  return _backupTableView;
}

let _backupsLayoutController = null;

function _backupsColumnSeed(col) {
  const types = { filename: 'TEXT', size_bytes: 'INTEGER', created_at: 'TEXT' };
  const lengths = { filename: 64, size_bytes: 12, created_at: 19 };
  return {
    sqlite_column: col.startsWith('_') ? null : col,
    data_type: types[col] || null,
    sample_max_length: lengths[col] || null,
    min_width_px: col === '_actions' ? _BACKUP_ACTION_COMPACT_WIDTH : 40,
    max_width_px: col === '_actions' ? _BACKUP_ACTION_INLINE_WIDTH : 900,
    width_px: _ensureBackupsTableView()?.prefs?.getWidth(col) || null,
  };
}

function _ensureBackupsLayoutController() {
  if (_backupsLayoutController || typeof TableBucketLayouts === 'undefined') return _backupsLayoutController;
  _backupsLayoutController = TableBucketLayouts.create({
    getTable: () => document.getElementById('backups-table'),
    getView: () => _ensureBackupsTableView(),
    getColumns: () => _BACKUP_COLS,
    getMeta: col => _BACKUP_FIELD_META[col],
    getDefaultWidth: col => {
      if (col === '_actions') return _backupActionCellWidth();
      if (col === 'size_bytes') return 90;
      if (col === 'created_at') return 170;
      return null;
    },
    getColumnSeed: col => _backupsColumnSeed(col),
    render: () => renderBackups(),
    surfaceLabel: 'Node Backups',
    layoutContextTitle: 'Node Backups Layout Context',
  });
  return _backupsLayoutController;
}

async function toggleBackupsHorizontalScroll() {
  const controller = _ensureBackupsLayoutController();
  if (!controller) return;
  await controller.toggleHorizontalScroll();
}

async function openBackupsLayoutContextModal() {
  const controller = _ensureBackupsLayoutController();
  if (!controller) return;
  await controller.openLayoutContextModal();
}

function _backupVisibleCols() {
  return _ensureBackupsTableView()?.getVisibleCols() || ['filename'];
}

function openBackupsColsModal() {
  const view = _ensureBackupsTableView();
  if (!view) return;
  view.openColumns(
    document.getElementById('backups-cols-modal-list'),
    document.getElementById('backups-cols-modal'),
    col => _BACKUP_FIELD_META[col].label
  );
}

function _applyBackupsColsModal() {
  const view = _ensureBackupsTableView();
  if (!view) return;
  view.applyColumns(document.getElementById('backups-cols-modal'), renderBackups);
  HubModal.close(document.getElementById('backups-cols-modal'));
}

function _backupSortValue(backup, sortKey) {
  switch (sortKey) {
    case 'filename':
      return backup.filename || '';
    case 'size_bytes':
      return Number(backup.size_bytes || 0);
    case 'created_at':
      return backup.created_at || '';
    default:
      return '';
  }
}

function _backupCompactRowActions() {
  const view = _ensureBackupsTableView();
  return typeof TableRowActions !== 'undefined' && TableRowActions.shouldCollapse({
    view,
    getTable: () => document.getElementById('backups-table'),
    columnKey: '_actions',
    requiredWidth: _BACKUP_ACTION_INLINE_WIDTH,
    defaultWidth: _BACKUP_ACTION_INLINE_WIDTH,
  });
}

function _backupActionCellWidth() {
  return _backupCompactRowActions() ? _BACKUP_ACTION_COMPACT_WIDTH : _BACKUP_ACTION_INLINE_WIDTH;
}

function _backupFilenameCell(backup) {
  return `<td><span class="table-cell-clip"><span class="table-cell-clip__text"><code style="font-size:12px">${esc(backup.filename || '—')}</code></span></span></td>`;
}

function _backupSizeCell(backup) {
  const kb = (Number(backup.size_bytes || 0) / 1024).toFixed(1);
  return `<td style="white-space:nowrap">${esc(kb)} KB</td>`;
}

function _backupCreatedCell(backup) {
  const created = backup.created_at || '';
  const ts = created ? created.replace('T', ' ').slice(0, 19) + ' UTC' : '—';
  return `<td style="white-space:nowrap;color:var(--text-dim)">${esc(ts)}</td>`;
}

function _backupInlineActionButtons(backup) {
  const filename = esc(backup.filename || '');
  return `<button class="secondary table-icon-btn table-icon-btn--restore" type="button" title="Restore this backup on this node" aria-label="Restore backup" data-backup-action="restore" data-filename="${filename}"></button>
    <button class="secondary table-icon-btn table-icon-btn--force-restore" type="button" title="Force restore this backup across peers" aria-label="Force restore backup" data-backup-action="force" data-filename="${filename}"></button>
    <button class="secondary table-icon-btn table-icon-btn--delete" type="button" title="Delete this backup archive" aria-label="Delete backup" data-backup-action="delete" data-filename="${filename}"></button>`;
}

function _backupActionsCell(backup) {
  const filename = esc(backup.filename || '');
  if (_backupCompactRowActions()) {
    return `<td class="table-action-cell table-action-cell--compact" style="width:${_backupActionCellWidth()}px">
      <button class="table-row-action-trigger secondary" type="button" title="Backup actions" data-backup-row-actions="${filename}">&#8942;</button>
    </td>`;
  }
  return `<td class="table-action-cell" style="white-space:nowrap"><div class="table-inline-actions">${_backupInlineActionButtons(backup)}</div></td>`;
}

function renderBackups() {
  const tbody = document.getElementById('backup-tbody');
  const view = _ensureBackupsTableView();
  if (!tbody || !view) return;

  if (!_backups.length) {
    view.render(() => {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${Math.max(1, _backupVisibleCols().length)}">${esc(_backupEmptyMessage)}</td></tr>`;
    });
    return;
  }

  const rows = view.sorter ? view.sorter.sortRows(_backups, _backupSortValue) : _backups;
  view.render(() => {
    tbody.innerHTML = rows.map(backup => `<tr>${_backupVisibleCols().map(col => {
      switch (col) {
        case 'filename':
          return _backupFilenameCell(backup);
        case 'size_bytes':
          return _backupSizeCell(backup);
        case 'created_at':
          return _backupCreatedCell(backup);
        case '_actions':
          return _backupActionsCell(backup);
        default:
          return '<td>—</td>';
      }
    }).join('')}</tr>`).join('');
  });
}

function _openBackupRowActions(filename) {
  if (typeof TableRowActions === 'undefined') return;
  const backup = _backups.find(item => String(item.filename) === String(filename));
  if (!backup) return;

  TableRowActions.open({
    title: 'Backup actions',
    subtitle: backup.filename || '',
    actions: [
      {
        label: 'Restore here',
        detail: 'Restore this backup on the current node only',
        onClick: () => openBackupActionModal(backup.filename || '', 'restore'),
      },
      {
        label: 'Force restore fleet-wide',
        detail: 'Restore here, then attempt to overwrite configured peers',
        tone: 'danger',
        onClick: () => openBackupActionModal(backup.filename || '', 'force'),
      },
      {
        label: 'Delete archive',
        detail: 'Permanently remove this backup from this node',
        tone: 'danger',
        onClick: () => openBackupActionModal(backup.filename || '', 'delete'),
      },
    ],
  });
}

function _backupActionModalEls() {
  return {
    dialog: document.getElementById('backup-action-modal'),
    title: document.getElementById('backup-action-modal-title'),
    titleText: document.getElementById('backup-action-modal-title-text'),
    badge: document.getElementById('backup-action-modal-badge'),
    filename: document.getElementById('backup-action-modal-filename'),
    message: document.getElementById('backup-action-modal-message'),
    normalWarn: document.getElementById('backup-action-modal-normal-warn'),
    forceWarn: document.getElementById('backup-action-modal-force-warn'),
    deleteWarn: document.getElementById('backup-action-modal-delete-warn'),
    status: document.getElementById('backup-action-modal-status'),
    result: document.getElementById('backup-action-modal-result'),
    error: document.getElementById('backup-action-modal-error'),
    closeBtn: document.getElementById('backup-action-modal-close-btn'),
    confirmBtn: document.getElementById('backup-action-modal-confirm'),
    closeBtns: Array.from(document.querySelectorAll('#backup-action-modal .hub-modal-close')),
  };
}

function _resetBackupActionModal() {
  const { dialog, titleText, badge, filename, message, normalWarn, forceWarn, deleteWarn, status, result, error, closeBtn, confirmBtn, closeBtns } = _backupActionModalEls();
  if (dialog) dialog.dataset.busy = '0';
  if (dialog) dialog.dataset.completed = '0';
  if (dialog) dialog.dataset.tone = 'info';
  if (titleText) titleText.textContent = 'Backup Action';
  if (badge) badge.hidden = true;
  if (filename) filename.textContent = '';
  if (message) message.textContent = '';
  if (normalWarn) normalWarn.hidden = true;
  if (forceWarn) forceWarn.hidden = true;
  if (deleteWarn) deleteWarn.hidden = true;
  if (status) {
    status.textContent = '';
    status.style.color = 'var(--text-dim)';
  }
  if (result) {
    result.hidden = true;
    result.textContent = '';
    result.className = 'restore-result';
    result.style.whiteSpace = 'pre-wrap';
  }
  if (error) error.textContent = '';
  if (closeBtn) {
    closeBtn.textContent = 'Cancel';
    closeBtn.hidden = false;
    closeBtn.style.display = '';
  }
  if (confirmBtn) {
    confirmBtn.textContent = 'Confirm';
    confirmBtn.disabled = false;
    confirmBtn.hidden = false;
    confirmBtn.classList.remove('danger');
  }
  closeBtns.forEach(btn => { btn.disabled = false; });
  _pendingBackupAction = null;
}

function _finishDeleteBackupActionModal() {
  const { dialog, closeBtn, confirmBtn, closeBtns } = _backupActionModalEls();
  if (dialog) {
    dialog.dataset.busy = '0';
    dialog.dataset.completed = '1';
  }
  if (closeBtn) {
    closeBtn.hidden = true;
    closeBtn.style.display = 'none';
  }
  if (confirmBtn) {
    confirmBtn.hidden = false;
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'CLOSE';
    confirmBtn.classList.remove('danger');
  }
  closeBtns.forEach(closeActionBtn => { closeActionBtn.disabled = false; });
}

function onBackupTableClick(event) {
  const rowActionsBtn = event.target.closest('button[data-backup-row-actions]');
  if (rowActionsBtn) {
    _openBackupRowActions(rowActionsBtn.dataset.backupRowActions || '');
    return;
  }
  const btn = event.target.closest('button[data-backup-action]');
  if (!btn) return;
  openBackupActionModal(btn.dataset.filename || '', btn.dataset.backupAction || '', btn);
}

function openBackupActionModal(filename, action, btn) {
  const { dialog, titleText, badge, filename: filenameEl, message, normalWarn, forceWarn, deleteWarn, closeBtn, confirmBtn } = _backupActionModalEls();
  if (!dialog) return;

  _resetBackupActionModal();
  _pendingBackupAction = { filename, action, btn: btn || null };

  const isForce = action === 'force';
  const isDelete = action === 'delete';

  if (dialog) {
    if (isDelete) dialog.dataset.tone = 'danger';
    else dialog.dataset.tone = 'info';
  }
  if (badge) badge.hidden = !isDelete;
  if (titleText) titleText.textContent = isDelete ? 'Delete Backup' : isForce ? 'Force Restore Backup' : 'Restore Backup';
  if (filenameEl) filenameEl.textContent = filename;
  if (message) {
    message.textContent = isDelete
      ? 'This will permanently remove this backup archive from this node.'
      : isForce
        ? 'This will restore the selected backup on this node, then attempt to overwrite the Blueprints database on all configured peers using the same restored database.'
        : 'This will restore the selected backup on this node only.';
  }
  if (normalWarn) normalWarn.hidden = action !== 'restore';
  if (forceWarn) forceWarn.hidden = !isForce;
  if (deleteWarn) deleteWarn.hidden = !isDelete;
  if (closeBtn) closeBtn.textContent = 'Cancel';
  if (confirmBtn) {
    confirmBtn.textContent = isDelete ? 'Delete' : isForce ? 'Force Restore' : 'Restore';
    confirmBtn.classList.toggle('danger', isDelete || isForce);
  }

  HubModal.open(dialog, { onClose: _resetBackupActionModal });
}

async function loadBackups() {
  const tbody = document.getElementById('backup-tbody');
  const err   = document.getElementById('backup-error');
  err.hidden = true;
  try {
    const r = await apiFetch('/api/v1/backup');
    if (!r.ok) {
      if (r.status === 503) {
        _backups = [];
        _backupEmptyMessage = 'Backups not configured on this node.';
        renderBackups();
        return;
      }
      throw new Error(`HTTP ${r.status}`);
    }
    const d = await r.json();
    _backups = Array.isArray(d.backups) ? d.backups : [];
    _backupEmptyMessage = _backups.length ? 'Loading…' : 'No backups yet — create one above.';
    renderBackups();
  } catch (e) {
    if (tbody) {
      _backups = [];
      _backupEmptyMessage = 'Unable to load backups.';
      renderBackups();
    }
    err.textContent = `Failed to load backups: ${e.message}`;
    err.hidden = false;
  }
}

async function createBackup(btn) {
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Creating…';
  const err = document.getElementById('backup-error');
  err.hidden = true;
  try {
    const r = await apiFetch('/api/v1/backup', { method: 'POST' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    await loadBackups();
    // Flash a brief confirmation
    btn.textContent = '✓ Done';
    setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
  } catch (e) {
    err.textContent = `Backup failed: ${e.message}`;
    err.hidden = false;
    btn.textContent = origText;
    btn.disabled = false;
  }
}

async function submitBackupAction() {
  const pending = _pendingBackupAction;
  const { dialog, status, result, error, closeBtn, confirmBtn, closeBtns } = _backupActionModalEls();
  if (!pending || !dialog || dialog.dataset.busy === '1') return;

  if (dialog.dataset.completed === '1') {
    HubModal.close(dialog);
    return;
  }

  const { filename, action, btn } = pending;
  const isDelete = action === 'delete';
  const isForce = action === 'force';
  const orig = btn ? btn.innerHTML : '';

  dialog.dataset.busy = '1';
  if (error) error.textContent = '';
  if (result) {
    result.hidden = true;
    result.textContent = '';
    result.className = 'restore-result';
  }
  if (status) {
    status.textContent = isDelete ? 'Deleting backup…' : 'Restoring backup…';
    status.style.color = 'var(--text-dim)';
  }
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = isDelete ? 'Deleting…' : 'Restoring…';
  }
  closeBtns.forEach(closeActionBtn => { closeActionBtn.disabled = true; });
  if (btn) {
    btn.disabled = true;
    btn.textContent = '…';
  }

  try {
    if (isDelete) {
      const response = await apiFetch(`/api/v1/backup/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (status) {
        status.textContent = 'Backup deleted.';
        status.style.color = 'var(--ok,#3fb950)';
      }
      _finishDeleteBackupActionModal();
      await loadBackups();
      return;
    }

    const url = `/api/v1/backup/restore/${encodeURIComponent(filename)}${isForce ? '?force=true' : ''}`;
    const response = await apiFetch(url, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);

    let msg = `Restored from ${data.restored_from}. Gen: ${data.gen_before} → ${data.gen_after}.`;
    if (isForce && Array.isArray(data.peer_results) && data.peer_results.length) {
      const lines = data.peer_results.map(result => {
        const target = result.address ? `${result.node_id} via ${result.address}` : result.node_id;
        const detail = result.detail ? ` — ${result.detail}` : '';
        return `${result.ok ? 'OK' : 'FAIL'} ${target}${detail}`;
      });
      msg += `\n\nFleet results:\n${lines.join('\n')}`;
    }
    if (data.warning) msg += `\n${data.warning}`;
    if (result) {
      result.textContent = msg;
      result.className = 'restore-result';
      result.style.whiteSpace = 'pre-wrap';
      result.hidden = false;
    }
    if (status) {
      if (isForce) {
        const attemptedPeers = Array.isArray(data.peer_results) ? data.peer_results.length : 0;
        status.textContent = data.fleet_success === false
          ? 'Force restore completed locally with peer failures.'
          : attemptedPeers
            ? 'Force restore completed across configured peers.'
            : 'Force restore completed locally.';
        status.style.color = data.fleet_success === false ? 'var(--warn,#e6a817)' : 'var(--ok,#3fb950)';
      } else {
        status.textContent = 'Restore completed.';
        status.style.color = 'var(--ok,#3fb950)';
      }
    }
    if (closeBtn) {
      closeBtn.hidden = false;
      closeBtn.textContent = 'CLOSE';
      closeBtn.style.display = '';
    }
    dialog.dataset.completed = '1';
    if (confirmBtn) {
      confirmBtn.hidden = false;
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'CLOSE';
      confirmBtn.classList.remove('danger');
    }
    closeBtns.forEach(closeActionBtn => { closeActionBtn.disabled = false; });
    dialog.dataset.busy = '0';
    setTimeout(() => { loadHealth(); loadSyncStatus(); loadBackups(); }, 500);
  } catch (e) {
    dialog.dataset.busy = '0';
    if (status) status.textContent = '';
    if (error) error.textContent = isDelete ? `Unable to delete backup: ${e.message}` : `Unable to restore backup: ${e.message}`;
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = isDelete ? 'Delete' : isForce ? 'Force Restore' : 'Restore';
    }
    if (closeBtn) {
      closeBtn.hidden = false;
      closeBtn.textContent = 'Cancel';
      closeBtn.style.display = '';
    }
    closeBtns.forEach(closeActionBtn => { closeActionBtn.disabled = false; });
  } finally {
    if (btn) {
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = orig;
      }, 3000);
    }
  }
}
