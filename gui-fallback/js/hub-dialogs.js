'use strict';

const HubDialogs = (() => {

    const _instances = new Map();

    function _fallbackAlert(opts) {
        alert(opts.message || '');
        return Promise.resolve();
    }

    function _fallbackConfirm(opts) {
        return Promise.resolve(confirm(opts.message || ''));
    }

    function _fallbackPrompt(opts) {
        return Promise.resolve(prompt(opts.message || '', opts.value || ''));
    }

    function _buttonClassForTone(tone) {
        if (tone === 'danger') return 'danger';
        if (tone === 'warning') return 'warning';
        if (tone === 'success') return 'ok';
        return '';
    }

    function _badgeForTone(tone, opts) {
        if (opts.badge) return opts.badge;
        if (tone === 'danger') return 'DEL';
        if (tone === 'warning') return 'WARN';
        if (tone === 'success') return 'OK';
        return 'INFO';
    }

    function _detailText(opts) {
        return opts.detail || opts.details || '';
    }

    function _ensure(kind) {
        if (_instances.has(kind)) return _instances.get(kind);
        const host = document.createElement('div');
        host.innerHTML = _markup(kind).trim();
        const dialog = host.firstElementChild;
        document.body.appendChild(dialog);
        if (typeof HubModal !== 'undefined') HubModal.init(document.body);

        const instance = {
            dialog,
            badge: dialog.querySelector('[data-role="badge"]'),
            title: dialog.querySelector('[data-role="title"]'),
            message: dialog.querySelector('[data-role="message"]'),
            detail: dialog.querySelector('[data-role="detail"]'),
            status: dialog.querySelector('[data-role="status"]'),
            inputWrap: dialog.querySelector('[data-role="input-wrap"]'),
            inputLabel: dialog.querySelector('[data-role="input-label"]'),
            input: dialog.querySelector('[data-role="input"]'),
            cancelBtn: dialog.querySelector('[data-role="cancel"]'),
            confirmBtn: dialog.querySelector('[data-role="confirm"]'),
        };

        _instances.set(kind, instance);
        return instance;
    }

    function _markup(kind) {
        const hasInput = kind === 'prompt';
        const footer = kind === 'alert'
            ? `<div class="hub-modal-footer">
        <button class="hub-modal-btn" type="button" data-role="confirm">OK</button>
      </div>`
            : `<div class="hub-modal-footer">
        <button class="hub-modal-btn secondary" type="button" data-role="cancel">Cancel</button>
        <button class="hub-modal-btn" type="button" data-role="confirm">Confirm</button>
      </div>`;
        return `<dialog class="hub-modal hub-dialog" data-kind="${kind}" data-tone="info" style="width:min(560px,95vw)">
      <div class="hub-modal-header">
        <h2 class="hub-modal-title">
          <span class="hub-dialog-badge" data-role="badge">INFO</span>
          <span class="hub-dialog-title-text" data-role="title">Dialog</span>
        </h2>
        <button class="hub-modal-close hub-dialog-close" type="button" aria-label="Close">&#10005;</button>
      </div>
      <div class="hub-modal-body">
        <p class="hub-dialog-message" data-role="message"></p>
        <div class="hub-dialog-detail" data-role="detail" hidden></div>
        <div class="field hub-dialog-input-field" data-role="input-wrap"${hasInput ? '' : ' hidden'}>
          <label data-role="input-label">Value</label>
          <input type="text" data-role="input" />
        </div>
        <div class="hub-modal-error hub-dialog-status" data-role="status"></div>
      </div>
      ${footer}
    </dialog>`;
    }

    function _applyCommon(instance, opts) {
        const tone = opts.tone || 'info';
        instance.dialog.dataset.tone = tone;
        instance.badge.textContent = _badgeForTone(tone, opts);
        instance.title.textContent = opts.title || 'Notice';
        instance.message.textContent = opts.message || '';
        const detail = _detailText(opts);
        instance.detail.textContent = detail;
        instance.detail.hidden = !detail;
        instance.status.textContent = '';
        instance.dialog.style.width = opts.width || 'min(560px,95vw)';
    }

    function alertDialog(opts) {
        opts = opts || {};
        if (typeof document === 'undefined' || typeof HubModal === 'undefined') return _fallbackAlert(opts || {});
        const instance = _ensure('alert');
        _applyCommon(instance, opts);

        return new Promise(resolve => {
            const onConfirm = () => HubModal.close(instance.dialog);
            const onClose = () => {
                instance.confirmBtn.removeEventListener('click', onConfirm);
                resolve();
            };
            instance.confirmBtn.textContent = opts.confirmText || 'OK';
            instance.confirmBtn.className = 'hub-modal-btn';
            const toneClass = _buttonClassForTone(opts.tone || 'info');
            if (toneClass) instance.confirmBtn.classList.add(toneClass);
            instance.confirmBtn.addEventListener('click', onConfirm);
            HubModal.open(instance.dialog, { onClose });
        });
    }

    function confirmDialog(opts) {
        opts = opts || {};
        if (typeof document === 'undefined' || typeof HubModal === 'undefined') return _fallbackConfirm(opts || {});
        const instance = _ensure('confirm');
        _applyCommon(instance, opts);

        return new Promise(resolve => {
            let settled = false;
            const cleanup = () => {
                instance.cancelBtn.removeEventListener('click', onCancel);
                instance.confirmBtn.removeEventListener('click', onConfirm);
            };
            const finish = value => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(value);
            };
            const onCancel = () => {
                finish(false);
                if (instance.dialog.open) HubModal.close(instance.dialog);
            };
            const onConfirm = () => {
                finish(true);
                if (instance.dialog.open) HubModal.close(instance.dialog);
            };
            const onClose = () => finish(false);
            instance.cancelBtn.textContent = opts.cancelText || 'Cancel';
            instance.confirmBtn.textContent = opts.confirmText || 'Confirm';
            instance.confirmBtn.className = 'hub-modal-btn';
            const toneClass = _buttonClassForTone(opts.tone || 'info');
            if (toneClass) instance.confirmBtn.classList.add(toneClass);
            instance.cancelBtn.addEventListener('click', onCancel);
            instance.confirmBtn.addEventListener('click', onConfirm);
            HubModal.open(instance.dialog, { onClose });
        });
    }

    function promptDialog(opts) {
        opts = opts || {};
        if (typeof document === 'undefined' || typeof HubModal === 'undefined') return _fallbackPrompt(opts || {});
        const instance = _ensure('prompt');
        _applyCommon(instance, opts);

        return new Promise(resolve => {
            let settled = false;
            const validate = typeof opts.validate === 'function' ? opts.validate : null;
            const cleanup = () => {
                instance.cancelBtn.removeEventListener('click', onCancel);
                instance.confirmBtn.removeEventListener('click', onConfirm);
                instance.input.removeEventListener('keydown', onKeyDown);
                instance.inputWrap.hidden = true;
                instance.status.textContent = '';
            };
            const finish = value => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(value);
            };
            const onCancel = () => {
                finish(null);
                if (instance.dialog.open) HubModal.close(instance.dialog);
            };
            const onConfirm = () => {
                const value = instance.input.value;
                if (validate) {
                    const result = validate(value);
                    if (typeof result === 'string' && result) {
                        instance.status.textContent = result;
                        instance.input.focus();
                        return;
                    }
                }
                finish(value);
                if (instance.dialog.open) HubModal.close(instance.dialog);
            };
            const onKeyDown = e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    onConfirm();
                }
            };
            const onClose = () => finish(null);
            instance.inputWrap.hidden = false;
            instance.input.type = opts.inputType || 'text';
            instance.inputLabel.textContent = opts.inputLabel || 'Value';
            instance.input.value = opts.value || '';
            instance.input.placeholder = opts.placeholder || '';
            instance.cancelBtn.textContent = opts.cancelText || 'Cancel';
            instance.confirmBtn.textContent = opts.confirmText || 'Save';
            instance.confirmBtn.className = 'hub-modal-btn';
            const toneClass = _buttonClassForTone(opts.tone || 'info');
            if (toneClass) instance.confirmBtn.classList.add(toneClass);
            instance.cancelBtn.addEventListener('click', onCancel);
            instance.confirmBtn.addEventListener('click', onConfirm);
            instance.input.addEventListener('keydown', onKeyDown);
            HubModal.open(instance.dialog, {
                onOpen: () => {
                    instance.input.focus();
                    instance.input.select();
                },
                onClose,
            });
        });
    }

    function confirmDelete(opts) {
        return confirmDialog(Object.assign({
            tone: 'danger',
            badge: 'DEL',
            confirmText: 'Delete',
            cancelText: 'Cancel',
        }, opts || {}));
    }

    function alertError(opts) {
        return alertDialog(Object.assign({
            tone: 'warning',
            badge: 'WARN',
            confirmText: 'OK',
        }, opts || {}));
    }

    return {
        alert: alertDialog,
        confirm: confirmDialog,
        prompt: promptDialog,
        confirmDelete,
        alertError,
    };

})();