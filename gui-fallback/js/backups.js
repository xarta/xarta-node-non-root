/* ── Backups ───────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
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
});

let _pendingBackupAction = null;

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
        tbody.innerHTML = '<tr class="empty-row"><td colspan="4">Backups not configured on this node.</td></tr>';
        return;
      }
      throw new Error(`HTTP ${r.status}`);
    }
    const d = await r.json();
    const list = d.backups || [];
    if (!list.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No backups yet — create one above.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(b => {
      const kb = (b.size_bytes / 1024).toFixed(1);
      const ts = (b.created_at || '').replace('T', ' ').slice(0, 19) + ' UTC';
      return `<tr>
        <td><code style="font-size:12px">${esc(b.filename)}</code></td>
        <td style="white-space:nowrap">${esc(kb)} KB</td>
        <td style="white-space:nowrap;color:var(--text-dim)">${esc(ts)}</td>
        <td style="white-space:nowrap">
          <button class="btn-restore secondary" type="button" data-backup-action="restore" data-filename="${esc(b.filename)}">Restore</button>
          <button class="btn-force" type="button" data-backup-action="force" data-filename="${esc(b.filename)}">&#9888; Force restore</button>
          <button class="secondary" type="button" style="color:var(--danger,#f85149)" data-backup-action="delete" data-filename="${esc(b.filename)}">&#10005; Delete</button>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
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
