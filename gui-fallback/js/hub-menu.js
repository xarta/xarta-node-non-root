// hub-menu.js — Shared Split-Dropdown Navigation Engine
// xarta-node Blueprints GUI
//
// Factory function that creates a fully-wired menu config object for
// a given Blueprints group (Synthesis, Probes, Settings).
//
// Each group file calls createHubMenu({...}) with its own config and
// defaultMenu, then registers group-specific functions via .registerFunctions().
//
// No inline event handlers — all event wiring via addEventListener.

'use strict';

const NavLayoutDialogs = (() => {
        function _fallbackAlert(message) {
                alert(message);
                return Promise.resolve();
        }

        function _fallbackConfirm(message) {
                return Promise.resolve(confirm(message));
        }

        function _fallbackPrompt(message, value) {
                return Promise.resolve(prompt(message, value));
        }

        function alertDialog(opts) {
            opts = opts || {};
            if (typeof HubDialogs !== 'undefined') {
                return HubDialogs.alert({
                    title: opts.title || 'Layout Notice',
                    message: opts.message || '',
                    detail: opts.detail || '',
                    tone: opts.tone || 'info',
                    badge: opts.badge,
                    confirmText: opts.confirmLabel || 'OK',
                });
            }
            return _fallbackAlert(opts.message || '');
        }

        function confirmDialog(opts) {
            opts = opts || {};
            if (typeof HubDialogs !== 'undefined') {
                return HubDialogs.confirm({
                    title: opts.title || 'Confirm',
                    message: opts.message || '',
                    detail: opts.detail || '',
                    tone: opts.tone || 'info',
                    badge: opts.badge,
                    confirmText: opts.confirmLabel || 'Confirm',
                    cancelText: opts.cancelLabel || 'Cancel',
                });
            }
            return _fallbackConfirm(opts.message || '');
        }

        function promptDialog(opts) {
            opts = opts || {};
            if (typeof HubDialogs !== 'undefined') {
                return HubDialogs.prompt({
                    title: opts.title || 'Edit Label',
                    message: opts.message || '',
                    detail: opts.detail || '',
                    tone: opts.tone || 'info',
                    badge: opts.badge,
                    inputLabel: opts.inputLabel || 'Label',
                    placeholder: opts.placeholder || '',
                    value: opts.value || '',
                    confirmText: opts.confirmLabel || 'Save',
                    cancelText: opts.cancelLabel || 'Cancel',
                    validate: opts.validate,
                        });
            }
            return _fallbackPrompt(opts.message || '', opts.value || '');
        }

        return {
                alert: alertDialog,
                confirm: confirmDialog,
                prompt: promptDialog,
        };
})();

// cfg = {
//   storageKey      : string  — localStorage key (unique per group)
//   toggleId        : string  — hamburger toggle button element ID
//   tabsId          : string  — hub tabs container element ID
//   currentLabelId  : string  — mobile current-tab label element ID
//   saveButtonId    : string  — layout editor Save button ID
//   resetButtonId   : string  — layout editor Reset button ID
//   editorListId    : string  — drag-and-drop editor list container ID
//   notificationId  : string  — toast notification element ID
//   resetConfirmMsg : string  — message shown in the reset confirm dialog
//   defaultMenu     : Array   — default menu item definitions
// }
function createHubMenu(cfg) {
    return {
        STORAGE_KEY: cfg.storageKey,
        _cfg: cfg,
        _initialized: false,

        // Registry of callable functions assignable to menu items.
        // Keys are dot-namespaced strings ('bm.add', 'svc.refresh', etc.).
        // Values are zero-argument functions — never serialised to localStorage.
        _fnRegistry: {},
        _labelGetters: {},
        _visibilityGetters: {},

        registerFunctions(map) {
            Object.assign(this._fnRegistry, map);
        },

        registerLabelGetters(map) {
            Object.assign(this._labelGetters, map);
        },

        registerVisibilityGetters(map) {
            Object.assign(this._visibilityGetters, map);
        },

        defaultMenu: cfg.defaultMenu,
        currentMenu: [],
        _activeId: null,
        _dbItems: {},    // { item_key: nav_items DB row } — loaded from DB, overlays emoji with assets
        _dbSeeded: false, // true once we've attempted seeding this group
        // Last content tab visited before the layout editor was opened.
        // Used to drive fn-item context dimming inside the editor.
        _lastContentId: null,
        draggedItem: null,

        // ── Lifecycle ──────────────────────────────────────────────

        // Called by switchGroup() each time this group becomes active.
        // Full setup on first call; subsequent calls just refresh active state.
        showGroup() {
            if (!this._initialized) {
                this.loadConfig();
                this.renderEditor();
                this.setupDragAndDrop();
                this._initialized = true;

                const toggle = document.getElementById(cfg.toggleId);
                if (toggle) toggle.addEventListener('click', () => this.toggleMenu());

                const saveBtn = document.getElementById(cfg.saveButtonId);
                if (saveBtn) saveBtn.addEventListener('click', () => this.saveConfig(true));

                const resetBtn = document.getElementById(cfg.resetButtonId);
                if (resetBtn) resetBtn.addEventListener('click', () => this.resetConfig());

                this._fitDropdownsHandler = () => this.fitOpenDropdowns();
                window.addEventListener('resize', this._fitDropdownsHandler, { passive: true });
                window.addEventListener('orientationchange', this._fitDropdownsHandler, { passive: true });
                if (window.visualViewport) {
                    window.visualViewport.addEventListener('resize', this._fitDropdownsHandler, { passive: true });
                    window.visualViewport.addEventListener('scroll', this._fitDropdownsHandler, { passive: true });
                }

                // Load DB-driven icons and sounds in background; re-renders navbar when done
                this.loadNavItemsFromDB();
            }
            this.updateActiveTab();
        },

        // ── Persistence ────────────────────────────────────────────

        loadConfig() {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (saved) {
                try {
                    this.currentMenu = JSON.parse(saved);
                    // Upgrade migration: auto-add items missing from older saves, and back-fill new fields
                    this.defaultMenu.forEach(def => {
                        const existing = this.currentMenu.find(m => m.id === def.id);
                        if (!existing) {
                            this.currentMenu.push({ ...def });
                        } else {
                            // Back-fill fields that may be missing from older saved configs
                            if (existing.pageLabel === undefined) existing.pageLabel = def.pageLabel;
                            // fn and activeOn are always developer-controlled — always sync from defaultMenu
                            if (def.fn !== undefined) existing.fn = def.fn; else delete existing.fn;
                            if (def.activeOn !== undefined) existing.activeOn = def.activeOn; else delete existing.activeOn;
                        }
                    });
                } catch (e) {
                    console.error('[HubMenu] Failed to parse saved config:', e);
                    this.currentMenu = JSON.parse(JSON.stringify(this.defaultMenu));
                }
            } else {
                this.currentMenu = JSON.parse(JSON.stringify(this.defaultMenu));
            }
        },

        saveConfig(syncFromDOM = true) {
            if (syncFromDOM) this.updateOrderFromDOM();
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.currentMenu));
            this.renderNavbar();
            this.showSaveNotification();
        },

        async resetConfig() {
            const ok = await NavLayoutDialogs.confirm({
                title: 'Reset Layout?',
                message: cfg.resetConfirmMsg,
                confirmLabel: 'Reset',
                cancelLabel: 'Cancel',
            });
            if (ok) {
                localStorage.removeItem(this.STORAGE_KEY);
                this.currentMenu = JSON.parse(JSON.stringify(this.defaultMenu));
                this.saveConfig(false);
                this.renderEditor();
                this.setupDragAndDrop();
            }
        },

        showSaveNotification() {
            const notif = document.getElementById(cfg.notificationId);
            if (notif) {
                notif.classList.add('show');
                setTimeout(() => notif.classList.remove('show'), 2000);
            }
        },

        // ── DB-driven icon/sound overlay ────────────────────────────

        async loadNavItemsFromDB() {
            if (!cfg.group) return;
            try {
                const resp = await apiFetch(`/api/v1/nav-items?group=${encodeURIComponent(cfg.group)}`);
                if (!resp.ok) return;
                const items = await resp.json();

                // Auto-seed from JS defaults if DB has no items for this group yet
                if (items.length === 0 && !this._dbSeeded) {
                    this._dbSeeded = true;
                    await this._seedDefaultsToDb();
                    return;   // _seedDefaultsToDb will call loadNavItemsFromDB again
                }

                this._dbItems = {};
                for (const dbRow of items) {
                    this._dbItems[dbRow.item_key] = dbRow;
                    // Preload sound assets in the background
                    if (dbRow.sound_asset && typeof SoundManager !== 'undefined') {
                        const ts = dbRow.updated_at ? new Date(dbRow.updated_at).getTime() : 0;
                        SoundManager.preload(`/fallback-ui/assets/${dbRow.sound_asset}?v=${ts}`);
                    }
                }
                // DB is the source of truth for label text — overlay clean labels onto currentMenu
                for (const m of this.currentMenu) {
                    const db = this._dbItems[m.id];
                    if (!db) continue;
                    if (db.label)      m.label     = db.label;
                    if (db.page_label) m.pageLabel = db.page_label;
                }
                // Re-render everything including the hamburger icon, which was rendered before
                // _dbItems was populated. updateActiveTab() re-sets the hamburger icon + label
                // AND calls renderNavbar() for the tab buttons.
                this.updateActiveTab();
            } catch (e) {
                // Silently fall back to emoji-only mode
            }
        },

        async _seedDefaultsToDb() {
            const payload = this.defaultMenu.map(item => ({
                menu_group:  cfg.group,
                item_key:    item.id,
                label:       item.label.replace(item.icon || '', '').trim(),
                page_label:  item.pageLabel || null,
                icon_emoji:  (item.icon && !item.icon.startsWith('icons/') && !item.icon.startsWith('data:')) ? item.icon : null,
                icon_asset:  (item.icon && item.icon.startsWith('icons/'))  ? item.icon : null,
                // data: URLs stored inline in icon_emoji (they are not uploadable file assets)
                // _iconHtml detects 'data:' prefix and renders them as mask-image spans
                sound_asset: null,
                parent_key:  item.parent || null,
                sort_order:  item.order || 0,
                is_fn:       item.fn ? 1 : 0,
                fn_key:      item.fn || null,
                active_on:   item.activeOn ? JSON.stringify(item.activeOn) : null,
            }));
            try {
                await apiFetch('/api/v1/nav-items/seed', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                // Reload now that DB is seeded
                await this.loadNavItemsFromDB();
            } catch (e) {
                // Silently ignore — menu will continue to work with emoji icons
            }
        },

        // Returns a <span class="menu-icon"> (mask-image tinted by currentColor) when an
        // icon_asset is set; also handles data: URLs in icon_emoji (inline SVG); falls back
        // to emoji character or the fallback question-mark span.
        _iconHtml(itemKey, emojiIcon) {
            const db = this._dbItems[itemKey];
            if (db && db.icon_asset) {
                const ts = db.updated_at ? new Date(db.updated_at).getTime() : 0;
                const url = `/fallback-ui/assets/${db.icon_asset}?v=${ts}`;
                return `<span class="menu-icon" style="--_icon-url:url('${url}')" aria-hidden="true"></span>`;
            }
            // When the JS default is an inline HIEROGLYPHS SVG (data: URL), it wins over any
            // stale text emoji left in the DB from the initial seed (e.g. old '↺' or '🔗').
            // If the admin has explicitly stored a data: URL in icon_emoji (via CMS), that
            // is respected instead. For plain-text emoji JS defaults, DB still takes priority.
            let emoji;
            if (emojiIcon && emojiIcon.startsWith('data:')) {
                emoji = (db && db.icon_emoji && db.icon_emoji.startsWith('data:'))
                    ? db.icon_emoji : emojiIcon;
            } else {
                emoji = (db && db.icon_emoji) || emojiIcon;
            }
            if (emoji) {
                // data: URL (inline SVG from HIEROGLYPHS constants) or icons/ path
                if (emoji.startsWith('data:') || emoji.startsWith('icons/')) {
                    const url = emoji.startsWith('data:') ? emoji : `/fallback-ui/assets/${emoji}`;
                    return `<span class="menu-icon" style="--_icon-url:url('${url}')" aria-hidden="true"></span>`;
                }
                return emoji;
            }
            // Nothing defined — show the fallback question-mark icon
            return `<span class="menu-icon" style="--_icon-url:url('/fallback-ui/assets/icons/fallback.svg')" aria-hidden="true"></span>`;
        },

        // Plays the sound assigned to a nav item (no-op if none or sound disabled).
        _playItemSound(itemKey) {
            if (!itemKey) return;
            const db = this._dbItems[itemKey];
            if (db && db.sound_asset && typeof SoundManager !== 'undefined') {
                const ts = db.updated_at ? new Date(db.updated_at).getTime() : 0;
                SoundManager.play(`/fallback-ui/assets/${db.sound_asset}?v=${ts}`);
            }
        },

        _displayLabel(item) {
            const getter = this._labelGetters[item.id];
            if (typeof getter === 'function') {
                const label = getter();
                if (typeof label === 'string' && label.trim()) return label.trim();
            }
            return item.label.replace(item.icon || '', '').trim();
        },

        _navLabel(item) {
            const label = this._displayLabel(item);
            return label === '☰' ? '' : label;
        },

        _isItemVisible(item, activeId) {
            const getter = this._visibilityGetters[item.id];
            if (typeof getter !== 'function') return true;
            try {
                return getter({ item, activeId, menu: this }) !== false;
            } catch (e) {
                console.warn('[HubMenu] visibility getter failed for', item.id, e);
                return true;
            }
        },

        _menuActionOrderApi() {
            if (typeof MenuActionOrder !== 'undefined') return MenuActionOrder;
            if (typeof window !== 'undefined' && window.MenuActionOrder) return window.MenuActionOrder;
            return null;
        },

        _sortFunctionItems(items) {
            const api = this._menuActionOrderApi();
            if (!api || typeof api.sortItems !== 'function') {
                return (items || []).slice().sort((a, b) => a.order - b.order);
            }
            return api.sortItems(items || [], item => this._displayLabel(item));
        },

        getUnmappedFunctionItems() {
            const api = this._menuActionOrderApi();
            if (!api || typeof api.findUnmapped !== 'function') return [];
            const fnItems = (this.currentMenu || []).filter(item => !!item.fn);
            return api.findUnmapped(fnItems, item => this._displayLabel(item), cfg.storageKey || cfg.group || 'menu');
        },

        // ── Data helpers ───────────────────────────────────────────

        getTopLevelItems() {
            return this.currentMenu
                .filter(m => !m.parent)
                .sort((a, b) => a.order - b.order);
        },

        getChildren(parentId) {
            return this.currentMenu
                .filter(m => m.parent === parentId)
                .sort((a, b) => a.order - b.order);
        },

        updateOrderFromDOM() {
            const topItems = document.querySelectorAll(`#${cfg.editorListId} > .menu-editor-item`);
            topItems.forEach((el, idx) => {
                const id = el.dataset.id;
                const item = this.currentMenu.find(m => m.id === id);
                if (item) { item.order = idx; item.parent = null; }

                const children = el.querySelectorAll('.menu-editor-children > .menu-editor-item');
                children.forEach((childEl, childIdx) => {
                    const childId = childEl.dataset.id;
                    const childItem = this.currentMenu.find(m => m.id === childId);
                    if (childItem) { childItem.order = childIdx; childItem.parent = id; }
                });
            });
        },

        // ── Mobile menu ────────────────────────────────────────────

        toggleMenu() {
            const toggle = document.getElementById(cfg.toggleId);
            const tabs   = document.getElementById(cfg.tabsId);
            if (!toggle || !tabs) return;
            const open = tabs.classList.toggle('open');
            toggle.classList.toggle('open', open);
        },

        closeMenu() {
            const toggle = document.getElementById(cfg.toggleId);
            const tabs   = document.getElementById(cfg.tabsId);
            if (toggle) toggle.classList.remove('open');
            if (tabs)   tabs.classList.remove('open');
        },

        _activeTabId() {
            const activePanel = document.querySelector('.tab-panel.active');
            const domActiveId = activePanel ? activePanel.id.replace('tab-', '') : null;
            if (domActiveId) {
                const ownsDomTab = this.defaultMenu.some(item =>
                    (!item.fn && item.id === domActiveId)
                    || (Array.isArray(item.activeOn) && item.activeOn.includes(domActiveId))
                );
                if (ownsDomTab) {
                    this._activeId = domActiveId;
                    return domActiveId;
                }
            }
            if (this._activeId) return this._activeId;
            return domActiveId;
        },

        _contextMenuFunctionItems(activeId) {
            const parentId = cfg.mobilePinnedId;
            if (!parentId) return [];
            const children = this.getChildren(parentId);
            const fnChildren = children.filter(item => !!item.fn);
            const visibleFnChildren = fnChildren.filter(item =>
                (!item.activeOn || (activeId && item.activeOn.includes(activeId)))
                && this._isItemVisible(item, activeId)
            );
            return this._sortFunctionItems(visibleFnChildren);
        },

        _removeFloatingContextMenu() {
            if (this._floatingContextPointerHandler) {
                document.removeEventListener('pointerdown', this._floatingContextPointerHandler, true);
                this._floatingContextPointerHandler = null;
            }
            if (this._floatingContextKeyHandler) {
                document.removeEventListener('keydown', this._floatingContextKeyHandler, true);
                this._floatingContextKeyHandler = null;
            }
            if (this._floatingContextMenuEl && this._floatingContextMenuEl.parentNode) {
                this._floatingContextMenuEl.parentNode.removeChild(this._floatingContextMenuEl);
            }
            this._floatingContextMenuEl = null;
        },

        _markConsumeNextOriginTap() {}, // kept for backward compat — FSM no longer needs this
        _markSuppressNextOriginLongPress() {},
        _markSuppressOriginPrimaryUntil() {},

        _removeFloatingPrimaryMenu() {
            if (this._floatingPrimaryPointerHandler) {
                document.removeEventListener('pointerdown', this._floatingPrimaryPointerHandler, true);
                this._floatingPrimaryPointerHandler = null;
            }
            if (this._floatingPrimaryKeyHandler) {
                document.removeEventListener('keydown', this._floatingPrimaryKeyHandler, true);
                this._floatingPrimaryKeyHandler = null;
            }
            if (this._floatingPrimaryMenuEl && this._floatingPrimaryMenuEl.parentNode) {
                this._floatingPrimaryMenuEl.parentNode.removeChild(this._floatingPrimaryMenuEl);
            }
            this._floatingPrimaryMenuEl = null;
            this._floatingPrimaryAnchorEl = null;
        },

        closeAnchoredMenus() {
            this._removeFloatingContextMenu();
            this._removeFloatingPrimaryMenu();
        },

        isContextMenuOpen() {
            return !!this._floatingContextMenuEl;
        },

        closeContextMenu() {
            this._removeFloatingContextMenu();
        },

        consumeNextOriginTap()           { return false; }, // no-op — FSM owns this now
        consumeNextOriginLongPress()      { return false; },
        consumeOriginPrimarySuppression() { return false; },

        isPrimaryMenuOpen() {
            return !!this._floatingPrimaryMenuEl;
        },

        _positionFloatingMenuHost(host, menu, anchorEl) {
            const anchorRect = anchorEl.getBoundingClientRect();
            const viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
            const viewportH = this._getViewportHeight();
            const top = Math.max(8, Math.round(anchorRect.bottom + 6));
            host.style.left = '8px';
            host.style.top = top + 'px';

            const menuRect = menu.getBoundingClientRect();
            if (viewportW > 0 && menuRect.width > 0) {
                const anchorCenter = anchorRect.left + (anchorRect.width / 2);
                const desiredLeft = Math.round(anchorCenter - (menuRect.width / 2));
                const maxLeft = Math.max(8, Math.floor(viewportW - menuRect.width - 8));
                host.style.left = Math.min(Math.max(8, desiredLeft), maxLeft) + 'px';
            }
            if (viewportH > 0 && menuRect.height > 0) {
                const maxTop = Math.max(8, Math.floor(viewportH - menuRect.height - 8));
                host.style.top = Math.min(top, maxTop) + 'px';
            }
            this._fitDropdownMenu(menu);
        },

        _primaryMenuTargetId(item, activeMember, navChildren) {
            if (activeMember) return activeMember.id;
            if (document.getElementById('tab-' + item.id)) return item.id;
            return navChildren[0]?.id || item.id;
        },

        _navigatePrimaryMenuTarget(targetId) {
            if (!targetId) return;
            this._playItemSound(targetId);
            switchTab(targetId);
            this.updateActiveTab(targetId);
            this.closeMenu();
            this.closeAnchoredMenus();
        },

        openPrimaryMenuAt(anchorEl) {
            if (!anchorEl || typeof anchorEl.getBoundingClientRect !== 'function') return false;
            const topItems = this.getTopLevelItems().filter(item => item.id !== cfg.mobilePinnedId);
            if (!topItems.length) {
                this._removeFloatingPrimaryMenu();
                return false;
            }

            this.closeDropdowns();
            this._removeFloatingContextMenu();
            this._removeFloatingPrimaryMenu();

            const activeId = this._activeTabId();
            const host = document.createElement('div');
            host.className = 'hub-primary-menu-floating';
            host.dataset.hubPrimaryMenu = '1';
            host.style.position = 'fixed';
            host.style.zIndex = '12000';

            const menu = document.createElement('div');
            menu.className = 'hub-primary-menu-floating__menu';

            topItems.forEach(item => {
                const navChildren = this.getChildren(item.id).filter(child => !child.fn);
                const allNavGroup = [item, ...navChildren];
                const activeMember = activeId ? allNavGroup.find(member => member.id === activeId) : null;
                const dropdownNavItems = navChildren.length > 0
                    ? (activeMember ? allNavGroup.filter(member => member.id !== activeMember.id) : navChildren)
                    : [];
                const isActive = !!activeMember || activeId === item.id;
                const labelSource = activeMember || item;
                const row = document.createElement('div');
                row.className = 'hub-primary-menu-row';

                if (dropdownNavItems.length > 0) {
                    const split = document.createElement('div');
                    split.className = 'hub-primary-menu-split';

                    const labelBtn = document.createElement('button');
                    labelBtn.className = 'hub-dropdown-item hub-primary-menu-label' + (isActive ? ' active' : '');
                    labelBtn.type = 'button';
                    labelBtn.innerHTML = this._iconHtml(labelSource.id, labelSource.icon) + '\u00a0' + (labelSource.pageLabel || this._displayLabel(labelSource));
                    labelBtn.addEventListener('click', (event) => {
                        event.stopPropagation();
                        this._navigatePrimaryMenuTarget(this._primaryMenuTargetId(item, activeMember, navChildren));
                    });

                    const caretBtn = document.createElement('button');
                    caretBtn.className = 'hub-primary-menu-caret';
                    caretBtn.type = 'button';
                    caretBtn.setAttribute('aria-label', 'Toggle submenu');
                    caretBtn.innerHTML = '<span class="menu-editor-icon menu-editor-icon--chevron-down" aria-hidden="true"></span>';

                    const submenu = document.createElement('div');
                    submenu.className = 'hub-primary-menu-submenu';
                    dropdownNavItems.forEach(child => {
                        const childBtn = document.createElement('button');
                        childBtn.className = 'hub-dropdown-item';
                        childBtn.type = 'button';
                        childBtn.innerHTML = this._iconHtml(child.id, child.icon) + '\u00a0' + this._displayLabel(child);
                        childBtn.addEventListener('click', (event) => {
                            event.stopPropagation();
                            const childPanel = document.getElementById('tab-' + child.id);
                            const childChildren = this.getChildren(child.id);
                            const targetId = childPanel ? child.id : (childChildren[0]?.id || child.id);
                            this._navigatePrimaryMenuTarget(targetId);
                        });
                        submenu.appendChild(childBtn);
                    });

                    caretBtn.addEventListener('click', (event) => {
                        event.stopPropagation();
                        const willOpen = !row.classList.contains('open');
                        menu.querySelectorAll('.hub-primary-menu-row.open').forEach(other => {
                            if (other !== row) other.classList.remove('open');
                        });
                        row.classList.toggle('open', willOpen);
                        requestAnimationFrame(() => this._positionFloatingMenuHost(host, menu, anchorEl));
                    });

                    split.appendChild(labelBtn);
                    split.appendChild(caretBtn);
                    row.appendChild(split);
                    row.appendChild(submenu);
                } else if (item.fn && this._isItemVisible(item, activeId)) {
                    const fnBtn = document.createElement('button');
                    fnBtn.className = 'hub-dropdown-item hub-primary-menu-label' + (isActive ? ' active' : '');
                    fnBtn.type = 'button';
                    fnBtn.innerHTML = this._iconHtml(item.id, item.icon) + '\u00a0' + this._displayLabel(item);
                    fnBtn.addEventListener('click', (event) => {
                        event.stopPropagation();
                        this._playItemSound(item.id);
                        const fn = this._fnRegistry[item.fn];
                        if (typeof fn === 'function') fn();
                        else console.warn('[HubMenu] No function registered for:', item.fn);
                        window.setTimeout(() => this.updateActiveTab(this._activeId), 0);
                        this.closeAnchoredMenus();
                    });
                    row.appendChild(fnBtn);
                } else {
                    const btn = document.createElement('button');
                    btn.className = 'hub-dropdown-item hub-primary-menu-label' + (isActive ? ' active' : '');
                    btn.type = 'button';
                    btn.innerHTML = this._iconHtml(item.id, item.icon) + '\u00a0' + (item.pageLabel || this._displayLabel(item));
                    btn.addEventListener('click', (event) => {
                        event.stopPropagation();
                        this._navigatePrimaryMenuTarget(item.id);
                    });
                    row.appendChild(btn);
                }

                menu.appendChild(row);
            });

            host.appendChild(menu);
            document.body.appendChild(host);
            this._floatingPrimaryMenuEl = host;
            this._floatingPrimaryAnchorEl = anchorEl;
            this._positionFloatingMenuHost(host, menu, anchorEl);

            this._floatingPrimaryPointerHandler = (event) => {
                if (!this._floatingPrimaryMenuEl) return;
                if (this._floatingPrimaryMenuEl.contains(event.target)) return;
                // Use closest() rather than anchorEl.contains() so a re-rendered origin
                // button (new DOM element) is still recognised as the same anchor.
                if (event.target && event.target.closest &&
                        event.target.closest('[data-action="origin"]')) return;
                this._removeFloatingPrimaryMenu();
            };
            this._floatingPrimaryKeyHandler = (event) => {
                if (event.key === 'Escape') this._removeFloatingPrimaryMenu();
            };
            window.setTimeout(() => {
                if (!this._floatingPrimaryMenuEl) return;
                document.addEventListener('pointerdown', this._floatingPrimaryPointerHandler, true);
                document.addEventListener('keydown', this._floatingPrimaryKeyHandler, true);
            }, 0);

            return true;
        },

        togglePrimaryMenuAt(anchorEl) {
            if (this._floatingPrimaryMenuEl && this._floatingPrimaryAnchorEl === anchorEl) {
                this._removeFloatingPrimaryMenu();
                return false;
            }
            return this.openPrimaryMenuAt(anchorEl);
        },

        openContextMenuAt(anchorEl) {
            if (!anchorEl || typeof anchorEl.getBoundingClientRect !== 'function') return false;
            // A renderActionButtons() call during the long-press window can detach the
            // origin button element before this fires.  When the passed element is no longer
            // in the document, swap in the live element so positioning works correctly.
            if (anchorEl.isConnected === false) {
                const liveEl = document.querySelector('[data-action="origin"]');
                if (liveEl) anchorEl = liveEl;
            }
            const activeId = this._activeTabId();
            const fnItems = this._contextMenuFunctionItems(activeId);
            if (!fnItems.length) {
                this._removeFloatingContextMenu();
                return false;
            }

            this.closeDropdowns();
            this._removeFloatingPrimaryMenu();

            const host = document.createElement('div');
            host.className = 'hub-tab-dropdown open hub-context-menu-floating';
            host.dataset.hubContextMenu = '1';
            host.style.position = 'fixed';
            host.style.zIndex = '12000';

            const menu = document.createElement('div');
            menu.className = 'hub-dropdown-menu hub-context-menu-floating__menu';
            menu.style.position = 'absolute';
            menu.style.top = '0';
            menu.style.left = '0';
            menu.style.marginTop = '0';

            fnItems.forEach(item => {
                const btn = document.createElement('button');
                btn.className = 'hub-dropdown-item hub-dropdown-fn';
                btn.type = 'button';
                btn.dataset.fn = item.fn;
                btn.dataset.itemKey = item.id;
                btn.innerHTML = this._iconHtml(item.id, item.icon) + '\u00a0' + this._displayLabel(item);
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._playItemSound(item.id);
                    const fn = this._fnRegistry[item.fn];
                    if (typeof fn === 'function') fn();
                    else console.warn('[HubMenu] No function registered for:', item.fn);
                    this._removeFloatingContextMenu();
                    window.setTimeout(() => this.updateActiveTab(this._activeId), 0);
                });
                menu.appendChild(btn);
            });

            host.appendChild(menu);
            document.body.appendChild(host);
            this._floatingContextMenuEl = host;

            this._positionFloatingMenuHost(host, menu, anchorEl);

            this._floatingContextPointerHandler = (event) => {
                if (!this._floatingContextMenuEl) return;
                if (this._floatingContextMenuEl.contains(event.target)) return;
                // Use closest() rather than anchorEl.contains() so a re-rendered origin
                // button (new DOM element) still triggers the suppress flags.
                const isOriginTap = !!(event.target && event.target.closest &&
                    event.target.closest('[data-action="origin"]'));
                if (isOriginTap) return; // state machine handles origin-button taps
                this._removeFloatingContextMenu();
            };
            this._floatingContextKeyHandler = (event) => {
                if (event.key === 'Escape') this._removeFloatingContextMenu();
            };
            window.setTimeout(() => {
                if (!this._floatingContextMenuEl) return;
                document.addEventListener('pointerdown', this._floatingContextPointerHandler, true);
                document.addEventListener('keydown', this._floatingContextKeyHandler, true);
            }, 0);

            return true;
        },

        // ── Navbar rendering ───────────────────────────────────────

        renderNavbar(activeId) {
            if (activeId === undefined) activeId = this._activeId;
            const navbar = document.getElementById(cfg.tabsId);
            if (!navbar) return;
            navbar.innerHTML = '';

            // Pinned item: rendered outside the hamburger dropdown, always visible on mobile.
            const pinnedNavbar = cfg.pinnedTabsId ? document.getElementById(cfg.pinnedTabsId) : null;
            if (pinnedNavbar) pinnedNavbar.innerHTML = '';

            this.getTopLevelItems().forEach(item => {
                // Route pinned item to its own container; all others to the regular navbar.
                const isPinned = cfg.mobilePinnedId && item.id === cfg.mobilePinnedId;
                const target = isPinned ? pinnedNavbar : navbar;
                if (!target) return;

                const children     = this.getChildren(item.id);
                const navChildren  = children.filter(c => !c.fn);
                const fnChildren   = children.filter(c => !!c.fn);

                // Function children filtered by activeOn context — only appear
                // in the dropdown when the specified tab is currently active.
                const visibleFnChildren = fnChildren.filter(c =>
                    (!c.activeOn || (activeId && c.activeOn.includes(activeId)))
                    && this._isItemVisible(c, activeId)
                );
                const sortedFnChildren = this._sortFunctionItems(visibleFnChildren);

                // Active group detection considers only tab-navigation children.
                const allNavGroup  = [item, ...navChildren];
                const activeMember = activeId ? allNavGroup.find(m => m.id === activeId) : null;
                const isGroupActive = !!activeMember;

                // Nav items shown in the dropdown (may exclude the active member).
                const dropdownNavItems = navChildren.length > 0
                    ? (isGroupActive
                        ? allNavGroup.filter(m => m.id !== activeMember.id)
                        : navChildren)
                    : [];

                // Combine visible nav and fn items — fn items come after nav items.
                const allDropdownItems = [...dropdownNavItems, ...sortedFnChildren];

                const activeLabel = activeMember ? (activeMember.pageLabel || this._navLabel(activeMember)) : '';
                const itemLabel = this._navLabel(item);
                const labelText = isGroupActive
                    ? this._iconHtml(activeMember.id, activeMember.icon) + (activeLabel ? ('\u00a0' + activeLabel) : '')
                    : this._iconHtml(item.id, item.icon) + (itemLabel ? ('\u00a0' + itemLabel) : '');

                if (allDropdownItems.length > 0) {
                    // ── Split-button with dropdown ────────────────────────────
                    const hasSeparator = dropdownNavItems.length > 0 && sortedFnChildren.length > 0;
                    const navHtml  = dropdownNavItems.map(c =>
                        `<button class="hub-dropdown-item" data-tab="${c.id}">${this._iconHtml(c.id, c.icon)}\u00a0${this._displayLabel(c)}</button>`
                    ).join('');
                    const sepHtml  = hasSeparator ? '<hr class="hub-dropdown-separator">' : '';
                    const fnHtml   = sortedFnChildren.map(c =>
                        `<button class="hub-dropdown-item hub-dropdown-fn" data-fn="${c.fn}" data-item-key="${c.id}">${this._iconHtml(c.id, c.icon)}\u00a0${this._displayLabel(c)}</button>`
                    ).join('');

                    const isActive = isGroupActive || (activeId === item.id);
                    const dropdown = document.createElement('div');
                    dropdown.className = 'hub-tab-dropdown';
                    dropdown.innerHTML = `
                        <div class="hub-tab-split">
                            <button class="hub-tab hub-tab-label${isActive ? ' active' : ''}" data-tab="${item.id}">${labelText}</button>
                            <button class="hub-tab-caret" data-fc-key="nav.dropdown-open" aria-label="Toggle submenu"><span class="menu-editor-icon menu-editor-icon--chevron-down" aria-hidden="true"></span></button>
                        </div>
                        <div class="hub-dropdown-menu">
                            ${navHtml}${sepHtml}${fnHtml}
                        </div>
                    `;

                    // Label click: navigate to own tab or first nav child
                    dropdown.querySelector('.hub-tab-label').addEventListener('click', (e) => {
                        e.stopPropagation();
                        const targetId = isGroupActive
                            ? activeMember.id
                            : (document.getElementById('tab-' + item.id) ? item.id : navChildren[0]?.id);
                        if (targetId) {
                            this._playItemSound(targetId);
                            switchTab(targetId);
                            this.updateActiveTab(targetId);
                            this.closeMenu();
                            this.closeDropdowns();
                        }
                    });

                    // Caret → toggle submenu open/close
                    dropdown.querySelector('.hub-tab-caret').addEventListener('click', (e) => {
                        e.stopPropagation();
                        const wasOpen = dropdown.classList.contains('open');
                        this.closeDropdowns();
                        if (!wasOpen) {
                            dropdown.classList.add('open');
                            requestAnimationFrame(() => this.fitOpenDropdowns());
                        }
                    });

                    // Nav dropdown items → navigate (resolve missing panels to first child)
                    dropdown.querySelectorAll('.hub-dropdown-item:not(.hub-dropdown-fn)').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const destId = btn.dataset.tab;
                            this._playItemSound(destId);
                            const panel = document.getElementById('tab-' + destId);
                            const destChildren = this.getChildren(destId);
                            const targetId = panel ? destId : (destChildren[0]?.id || destId);
                            switchTab(targetId);
                            this.updateActiveTab(targetId);
                            this.closeMenu();
                            this.closeDropdowns();
                        });
                    });

                    // Fn dropdown items → call registered function
                    dropdown.querySelectorAll('.hub-dropdown-fn').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            this._playItemSound(btn.dataset.itemKey);
                            const fn = this._fnRegistry[btn.dataset.fn];
                            if (typeof fn === 'function') fn();
                            else console.warn('[HubMenu] No function registered for:', btn.dataset.fn);
                            window.setTimeout(() => this.updateActiveTab(this._activeId), 0);
                            this.closeMenu();
                            this.closeDropdowns();
                        });
                    });

                    target.appendChild(dropdown);

                } else if (item.fn && this._isItemVisible(item, activeId)) {
                    // ── Top-level function button (promoted fn item) ──────────
                    const btn = document.createElement('button');
                    btn.className = 'hub-tab';
                    const itemLabel = this._navLabel(item);
                    btn.innerHTML = this._iconHtml(item.id, item.icon) + (itemLabel ? ('\u00a0' + itemLabel) : '');
                    btn.addEventListener('click', () => {
                        this._playItemSound(item.id);
                        const fn = this._fnRegistry[item.fn];
                        if (typeof fn === 'function') fn();
                        else console.warn('[HubMenu] No function registered for:', item.fn);
                        window.setTimeout(() => this.updateActiveTab(this._activeId), 0);
                        this.closeMenu();
                    });
                    target.appendChild(btn);

                } else {
                    // ── Standalone tab button ─────────────────────────────────
                    const btn = document.createElement('button');
                    btn.className = 'hub-tab';
                    btn.dataset.tab = item.id;
                    const itemLabel = this._navLabel(item);
                    btn.innerHTML = this._iconHtml(item.id, item.icon) + (itemLabel ? ('\u00a0' + itemLabel) : '');
                    if (isGroupActive) btn.classList.add('active');
                    btn.addEventListener('click', () => {
                        this._playItemSound(item.id);
                        switchTab(item.id);
                        this.updateActiveTab(item.id);
                        this.closeMenu();
                    });
                    target.appendChild(btn);
                }
            });

            // Close dropdowns on outside click
            document.removeEventListener('click', this._closeHandler);
            this._closeHandler = () => this.closeDropdowns(false);
            document.addEventListener('click', this._closeHandler);
        },

        closeDropdowns(includeFloating) {
            if (includeFloating !== false) this._removeFloatingContextMenu();
            const sel = `#${cfg.tabsId} .hub-tab-dropdown.open`;
            const pinnedSel = cfg.pinnedTabsId ? `, #${cfg.pinnedTabsId} .hub-tab-dropdown.open` : '';
            document.querySelectorAll(sel + pinnedSel)
                .forEach(d => {
                    this._resetDropdownMenuFit(d.querySelector('.hub-dropdown-menu'));
                    d.classList.remove('open');
                });
        },

        _getViewportHeight() {
            if (window.visualViewport && Number.isFinite(window.visualViewport.height) && window.visualViewport.height > 0) {
                return window.visualViewport.height;
            }
            return window.innerHeight || document.documentElement.clientHeight || 0;
        },

        _resetDropdownMenuFit(menu) {
            if (!menu) return;
            menu.classList.remove('hub-dropdown-menu--clipped');
            menu.style.removeProperty('max-height');
            menu.style.removeProperty('overflow-y');
            menu.style.removeProperty('overflow-x');
        },

        _fitDropdownMenu(menu) {
            if (!menu) return;
            this._resetDropdownMenuFit(menu);
            const viewportHeight = this._getViewportHeight();
            if (!viewportHeight) return;
            const rect = menu.getBoundingClientRect();
            const bottomPad = 8;
            const available = Math.floor(viewportHeight - rect.top - bottomPad);
            if (rect.bottom <= viewportHeight - bottomPad || available <= 0) return;
            menu.classList.add('hub-dropdown-menu--clipped');
            menu.style.maxHeight = Math.max(120, available) + 'px';
            menu.style.overflowY = 'auto';
            menu.style.overflowX = 'hidden';
        },

        fitOpenDropdowns() {
            const sel = `#${cfg.tabsId} .hub-tab-dropdown.open .hub-dropdown-menu`;
            const pinnedSel = cfg.pinnedTabsId ? `, #${cfg.pinnedTabsId} .hub-tab-dropdown.open .hub-dropdown-menu` : '';
            document.querySelectorAll(sel + pinnedSel).forEach(menu => this._fitDropdownMenu(menu));
        },

        // Update active visual state. Accepts an explicit tabId or derives from DOM.
        updateActiveTab(activeId) {
            if (!activeId) {
                const activePanel = document.querySelector('.tab-panel.active');
                if (activePanel) activeId = activePanel.id.replace('tab-', '');
            }
            if (activeId) this._activeId = activeId;

            // Track the last *content* page (not the layout editor itself) so that
            // fn-item context badges stay meaningful while the editor is open.
            const isLayoutEditorItem = this.defaultMenu.some(
                m => m.parent === activeId && m.fn !== undefined
            );
            if (activeId && !isLayoutEditorItem) this._lastContentId = activeId;

            // Update mobile hamburger label
            const labelEl = document.getElementById(cfg.currentLabelId);
            if (labelEl && activeId) {
                const item = this.currentMenu.find(m => m.id === activeId);
                if (item) {
                    // Strip any embedded emoji from the label text the same way renderNavbar does
                    labelEl.textContent = item.pageLabel || item.label.replace(item.icon || '', '').trim();
                    const toggle = document.getElementById(cfg.toggleId);
                    if (toggle) {
                        const iconEl = toggle.querySelector('.hamburger-icon');
                        if (iconEl) iconEl.innerHTML = this._iconHtml(item.id, item.icon);
                    }
                }
            }

            // Re-render navbar with active state baked in
            this.renderNavbar(activeId || this._activeId);
            // Re-render editor so fn item context badges update as the active tab changes.
            // renderEditor is cheap; setupDragAndDrop re-wires listeners on the fresh DOM.
            this.renderEditor();
            this.setupDragAndDrop();
        },

        // ── Editor rendering ───────────────────────────────────────

        renderEditor() {
            const container = document.getElementById(cfg.editorListId);
            if (!container) return;
            container.innerHTML = '';
            this.getTopLevelItems().forEach(item => container.appendChild(this.createEditorItem(item)));
        },

        createEditorItem(item) {
            const div = document.createElement('div');
            div.className = 'menu-editor-item';
            div.dataset.id = item.id;
            div.draggable = true;

            const children = this.getChildren(item.id);
            const hasChildren = children.length > 0;
            const topItems = this.getTopLevelItems();
            const topIndex = topItems.findIndex(entry => entry.id === item.id);
            const canMoveTopUp = topIndex > 0;
            const canMoveTopDown = topIndex !== -1 && topIndex < topItems.length - 1;
            const canNestUnderPrevious = topIndex > 0 && !hasChildren;

            div.innerHTML = `
                <div class="menu-item-header">
                    <span class="drag-handle">⋮⋮</span>
                    <span class="menu-item-icon">${this._iconHtml(item.id, item.icon)}</span>
                    <span class="menu-item-label">${this._displayLabel(item)}</span>
                    ${hasChildren ? '<span class="has-children-badge" title="' + children.length + ' nested items"><span class="menu-editor-icon menu-editor-icon--chevron-down" aria-hidden="true"></span>' + children.length + '</span>' : ''}
                    <span class="menu-item-page-label" title="Page label (shown when active)">→ ${item.pageLabel || '—'}</span>
                    <div class="menu-item-actions">
                        <button type="button" class="btn-move-item" data-id="${item.id}" data-dir="up" title="Move up" aria-label="Move up"${canMoveTopUp ? '' : ' disabled'}><span class="menu-editor-icon menu-editor-icon--move-up" aria-hidden="true"></span></button>
                        <button type="button" class="btn-move-item" data-id="${item.id}" data-dir="down" title="Move down" aria-label="Move down"${canMoveTopDown ? '' : ' disabled'}><span class="menu-editor-icon menu-editor-icon--move-down" aria-hidden="true"></span></button>
                        <button type="button" class="btn-nest-prev" data-id="${item.id}" title="Nest under previous item" aria-label="Nest under previous item"${canNestUnderPrevious ? '' : ' disabled'}><span class="menu-editor-icon menu-editor-icon--nest" aria-hidden="true"></span></button>
                        <button type="button" class="btn-edit-item" data-id="${item.id}" title="Edit nav label" aria-label="Edit nav label"><span class="menu-editor-icon menu-editor-icon--edit-label" aria-hidden="true"></span></button>
                        <button type="button" class="btn-edit-page-label" data-id="${item.id}" title="Edit page label" aria-label="Edit page label"><span class="menu-editor-icon menu-editor-icon--page-label" aria-hidden="true"></span></button>
                    </div>
                </div>
                <div class="menu-editor-children" data-parent="${item.id}">
                    ${children.map(child => {
                        const isFn = !!child.fn;
                        const defItem = this.defaultMenu.find(m => m.id === child.id);
                        const fnKey = defItem?.fn || child.fn || '';
                        const activeOnArr = (isFn && defItem?.activeOn) ? defItem.activeOn : null;

                        // Context resolution for the editor:
                        // ─ When the layout editor tab itself is active (item.id === _activeId),
                        //   use _lastContentId (last visited content page) for context, so that
                        //   fn items for the previous page stay green and others remain dimmed.
                        // ─ If no content page has been visited yet (_lastContentId is null),
                        //   fall back to neutral mode (no dimming — can't know context yet).
                        // ─ Otherwise, match _activeId directly against the item's activeOn list.
                        const isLayoutEditor = this._activeId === item.id;
                        const contextId = isLayoutEditor ? this._lastContentId : this._activeId;
                        const isInContext = !activeOnArr
                            || (isLayoutEditor && !this._lastContentId)
                            || Boolean(contextId && activeOnArr.includes(contextId));

                        const tabList = activeOnArr ? activeOnArr.join(' / ') : '';
                        const badgeTitle = isInContext
                            ? `Active — visible in dropdown now`
                            : `Inactive — visible in dropdown only when on: ${tabList}`;
                        const contextBadgeHtml = activeOnArr
                            ? `<span class="menu-fn-context-badge${isInContext && contextId ? ' is-active' : ''}" title="${badgeTitle}">● ${tabList}</span>`
                            : '';

                        const rightColHtml = isFn
                            ? `<span class="menu-fn-badge" title="Function — ${fnKey}"><span class="menu-editor-icon menu-editor-icon--function" aria-hidden="true"></span>${fnKey}</span>${contextBadgeHtml}`
                            : `<span class="menu-item-page-label" title="Page label">→ ${child.pageLabel || '—'}</span>`;
                        const editPageBtnHtml = isFn ? ''
                            : `<button type="button" class="btn-edit-page-label" data-id="${child.id}" title="Edit page label" aria-label="Edit page label"><span class="menu-editor-icon menu-editor-icon--page-label" aria-hidden="true"></span></button>`;
                        const inactiveClass = (isFn && !isInContext) ? ' menu-editor-fn-child--inactive' : '';
                        const childIndex = children.findIndex(entry => entry.id === child.id);
                        const canMoveChildUp = childIndex > 0;
                        const canMoveChildDown = childIndex < children.length - 1;
                        return `
                        <div class="menu-editor-item menu-editor-child${isFn ? ' menu-editor-fn-child' : ''}${inactiveClass}" data-id="${child.id}" draggable="true">
                            <div class="menu-item-header">
                                <span class="drag-handle">⋮⋮</span>
                                <span class="menu-item-icon">${this._iconHtml(child.id, child.icon)}</span>
                                <span class="menu-item-label">${this._displayLabel(child)}</span>
                                ${rightColHtml}
                                <div class="menu-item-actions">
                                    <button type="button" class="btn-move-item" data-id="${child.id}" data-dir="up" title="Move up" aria-label="Move up"${canMoveChildUp ? '' : ' disabled'}><span class="menu-editor-icon menu-editor-icon--move-up" aria-hidden="true"></span></button>
                                    <button type="button" class="btn-move-item" data-id="${child.id}" data-dir="down" title="Move down" aria-label="Move down"${canMoveChildDown ? '' : ' disabled'}><span class="menu-editor-icon menu-editor-icon--move-down" aria-hidden="true"></span></button>
                                    ${editPageBtnHtml}
                                    <button type="button" class="btn-promote-item" data-id="${child.id}" title="Promote to top level" aria-label="Promote to top level"><span class="menu-editor-icon menu-editor-icon--promote" aria-hidden="true"></span></button>
                                </div>
                            </div>
                        </div>`;
                    }).join('')}
                    <div class="drop-zone-child" data-parent="${item.id}">
                        <span>Drop here to nest as submenu item</span>
                    </div>
                </div>
            `;

            // Wire buttons (no inline handlers — CSP-safe)
            div.querySelector('.btn-edit-item').addEventListener('click', () => this.editItem(item.id));
            div.querySelectorAll('.btn-edit-page-label').forEach(btn => {
                btn.addEventListener('click', () => this.editPageLabel(btn.dataset.id));
            });
            div.querySelectorAll('.btn-promote-item').forEach(btn => {
                btn.addEventListener('click', () => this.promoteItem(btn.dataset.id));
            });
            div.querySelectorAll('.btn-move-item').forEach(btn => {
                btn.addEventListener('click', () => this.moveItem(btn.dataset.id, btn.dataset.dir === 'up' ? -1 : 1));
            });
            div.querySelectorAll('.btn-nest-prev').forEach(btn => {
                btn.addEventListener('click', () => this.nestUnderPrevious(btn.dataset.id));
            });

            return div;
        },

        async editItem(id) {
            const item = this.currentMenu.find(m => m.id === id);
            if (!item) return;
            const newLabel = await NavLayoutDialogs.prompt({
                title: 'Rename Nav Label',
                message: 'Enter the label shown in the navbar and layout editor. The icon stays separate.',
                inputLabel: 'Nav label',
                placeholder: 'Label',
                value: item.label.replace(item.icon, '').trim(),
                confirmLabel: 'Save',
            });
            if (newLabel !== null && newLabel.trim()) {
                item.label = item.icon + ' ' + newLabel.trim();
                this.saveConfig(false);
                this.renderEditor();
                this.setupDragAndDrop();
            }
        },

        async editPageLabel(id) {
            const item = this.currentMenu.find(m => m.id === id);
            if (!item) return;
            const current = item.pageLabel || item.label.replace(item.icon, '').trim();
            const newLabel = await NavLayoutDialogs.prompt({
                title: 'Rename Active Tab Label',
                message: 'Enter the label shown in the highlighted split-button when this page is active.',
                inputLabel: 'Active label',
                placeholder: 'Active label',
                value: current,
                confirmLabel: 'Save',
            });
            if (newLabel !== null && newLabel.trim()) {
                item.pageLabel = newLabel.trim();
                this.saveConfig(false);
                this.renderEditor();
                this.setupDragAndDrop();
            }
        },

        promoteItem(id) {
            const item = this.currentMenu.find(m => m.id === id);
            if (item) {
                item.parent = null;
                item.order = this.getTopLevelItems().length;
                this.saveConfig(false);
                this.renderEditor();
                this.setupDragAndDrop();
            }
        },

        moveItem(id, delta) {
            const item = this.currentMenu.find(m => m.id === id);
            if (!item || !delta) return;
            const siblings = item.parent ? this.getChildren(item.parent) : this.getTopLevelItems();
            const idx = siblings.findIndex(entry => entry.id === id);
            const swap = siblings[idx + delta];
            if (idx === -1 || !swap) return;

            const nextOrder = item.order;
            item.order = swap.order;
            swap.order = nextOrder;
            this.saveConfig(false);
            this.renderEditor();
            this.setupDragAndDrop();
        },

        nestUnderPrevious(id) {
            const item = this.currentMenu.find(m => m.id === id);
            if (!item || item.parent) return;
            if (this.getChildren(id).length > 0) {
                NavLayoutDialogs.alert({
                    title: 'Cannot Nest Item',
                    message: 'Items that already have sub-items must stay top-level. Promote or rehome their children first.',
                });
                return;
            }

            const topItems = this.getTopLevelItems();
            const idx = topItems.findIndex(entry => entry.id === id);
            if (idx <= 0) return;
            const parent = topItems[idx - 1];
            item.parent = parent.id;
            item.order = this.getChildren(parent.id).length;
            this.saveConfig(false);
            this.renderEditor();
            this.setupDragAndDrop();
        },

        // ── Drag & Drop ────────────────────────────────────────────

        setupDragAndDrop() {
            const container = document.getElementById(cfg.editorListId);
            if (!container) return;

            // Replace node to remove all stale event listeners
            const fresh = container.cloneNode(true);
            container.parentNode.replaceChild(fresh, container);

            // Re-wire edit/promote buttons on the cloned tree
            fresh.querySelectorAll('.btn-edit-item').forEach(btn => {
                btn.addEventListener('click', () => this.editItem(btn.dataset.id));
            });
            fresh.querySelectorAll('.btn-edit-page-label').forEach(btn => {
                btn.addEventListener('click', () => this.editPageLabel(btn.dataset.id));
            });
            fresh.querySelectorAll('.btn-promote-item').forEach(btn => {
                btn.addEventListener('click', () => this.promoteItem(btn.dataset.id));
            });
            fresh.querySelectorAll('.btn-move-item').forEach(btn => {
                btn.addEventListener('click', () => this.moveItem(btn.dataset.id, btn.dataset.dir === 'up' ? -1 : 1));
            });
            fresh.querySelectorAll('.btn-nest-prev').forEach(btn => {
                btn.addEventListener('click', () => this.nestUnderPrevious(btn.dataset.id));
            });

            fresh.addEventListener('dragstart', (e) => {
                const item = e.target.closest('.menu-editor-item');
                if (item) {
                    this.draggedItem = item;
                    item.classList.add('dragging');
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', item.dataset.id);
                }
            });

            fresh.addEventListener('dragend', () => {
                if (this.draggedItem) {
                    this.draggedItem.classList.remove('dragging');
                    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
                    this.draggedItem = null;
                }
            });

            fresh.addEventListener('dragover', (e) => {
                e.preventDefault();
                const target = e.target.closest('.menu-editor-item, .drop-zone-child');
                if (target && target !== this.draggedItem) {
                    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
                    target.classList.add('drag-over');
                }
            });

            fresh.addEventListener('dragleave', (e) => {
                const target = e.target.closest('.menu-editor-item, .drop-zone-child');
                if (target) target.classList.remove('drag-over');
            });

            fresh.addEventListener('drop', (e) => {
                e.preventDefault();
                if (!this.draggedItem) return;

                const dropZone   = e.target.closest('.drop-zone-child');
                const targetItem = e.target.closest('.menu-editor-item');

                if (dropZone) {
                    // Drop into a sub-menu zone
                    const parentId  = dropZone.dataset.parent;
                    const draggedId = this.draggedItem.dataset.id;
                    if (parentId === draggedId) return;
                    if (this.getChildren(draggedId).length > 0) {
                        NavLayoutDialogs.alert({
                            title: 'Cannot Nest Item',
                            message: 'Items that already have sub-items must stay top-level. Promote or rehome their children first.',
                        });
                        return;
                    }
                    const item = this.currentMenu.find(m => m.id === draggedId);
                    if (item) {
                        item.parent = parentId;
                        item.order  = this.getChildren(parentId).length;
                        this.saveConfig(false);
                        this.renderEditor();
                        this.setupDragAndDrop();
                    }

                } else if (targetItem && targetItem !== this.draggedItem) {
                    const draggedIsChild = this.draggedItem.classList.contains('menu-editor-child');
                    const targetIsChild  = targetItem.classList.contains('menu-editor-child');

                    if (draggedIsChild && targetIsChild) {
                        // Reorder children within same parent
                        const draggedParent = this.draggedItem.closest('.menu-editor-children');
                        const targetParent  = targetItem.closest('.menu-editor-children');
                        if (draggedParent && targetParent && draggedParent === targetParent) {
                            const items = Array.from(draggedParent.querySelectorAll(':scope > .menu-editor-item'));
                            const draggedIdx = items.indexOf(this.draggedItem);
                            const targetIdx  = items.indexOf(targetItem);
                            if (draggedIdx !== -1 && targetIdx !== -1) {
                                if (draggedIdx < targetIdx) targetItem.after(this.draggedItem);
                                else                         targetItem.before(this.draggedItem);
                                this.saveConfig(true);
                            }
                        }
                    } else if (!draggedIsChild && !targetIsChild) {
                        // Reorder top-level items
                        const list  = document.getElementById(cfg.editorListId);
                        const items = Array.from(list.querySelectorAll(':scope > .menu-editor-item'));
                        const draggedIdx = items.indexOf(this.draggedItem);
                        const targetIdx  = items.indexOf(targetItem);
                        if (draggedIdx !== -1 && targetIdx !== -1) {
                            if (draggedIdx < targetIdx) targetItem.after(this.draggedItem);
                            else                         targetItem.before(this.draggedItem);
                            this.saveConfig(true);
                        }
                    }
                }

                document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            });
        },
    };
}

// ── menu-icon spans use CSS mask-image; no load-error handler needed.
// Missing assets simply render transparent (background-color still applies,
// but the mask has no shape → invisible).  The fallback span is baked into
// _iconHtml() so no runtime recovery is required.
