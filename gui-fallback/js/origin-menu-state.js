// origin-menu-state.js — finite state machine for the origin button menu system.
//
// ── States ────────────────────────────────────────────────────────────────────
//   IDLE     — no floating menu is open
//   PRIMARY  — the primary (nav) floating menu is open
//   CONTEXT  — the context (function shortcut) floating menu is open
//
// ── Inputs ────────────────────────────────────────────────────────────────────
//   tap        — single confirmed tap/click on the origin button
//   doubleTap  — double tap/click on the origin button
//   longPress  — long press on the origin button
//
// ── Transition table ──────────────────────────────────────────────────────────
//   IDLE    + tap       → PRIMARY  [openPrimary]
//   IDLE    + doubleTap → IDLE     [goToLayout]
//   IDLE    + longPress → CONTEXT  [openContext]
//   PRIMARY + tap       → IDLE     [closePrimary]
//   PRIMARY + doubleTap → IDLE     [closePrimary, goToLayout]
//   PRIMARY + longPress → CONTEXT  [closePrimary, openContext]
//   CONTEXT + tap       → IDLE     [closeContext]
//   CONTEXT + doubleTap → IDLE     [closeContext, goToLayout]
//   CONTEXT + longPress → IDLE     [closeContext]
//
// ── Self-healing ──────────────────────────────────────────────────────────────
//   State is re-derived from live DOM at the start of every dispatch() call.
//   If a menu was closed externally (Escape, clicking elsewhere, menu-item click)
//   the machine silently syncs to IDLE before applying the transition.  No
//   notification callbacks or suppression flags are needed.
//
// ── Separation of concerns ────────────────────────────────────────────────────
//   Input detection (tap vs doubleTap vs longPress from raw pointer/click events)
//   lives entirely in blueprints-node-selector.js.
//   DOM open/close operations live in hub-menu.js.
//   This file owns only state and transition logic.
// ─────────────────────────────────────────────────────────────────────────────

/* global SynthesisMenuConfig, ProbesMenuConfig, SettingsMenuConfig */

const OriginMenuStateMachine = (function () {
    'use strict';

    const STATES = Object.freeze({ IDLE: 'IDLE', PRIMARY: 'PRIMARY', CONTEXT: 'CONTEXT' });

    // Transition table: TRANSITIONS[currentState][event] = { next, actions[] }
    const TRANSITIONS = {
        IDLE: {
            tap:       { next: 'PRIMARY', actions: ['openPrimary'] },
            doubleTap: { next: 'IDLE',    actions: ['goToLayout']  },
            longPress: { next: 'CONTEXT', actions: ['openContext'] },
        },
        PRIMARY: {
            tap:       { next: 'IDLE',    actions: ['closePrimary']               },
            doubleTap: { next: 'IDLE',    actions: ['closePrimary', 'goToLayout'] },
            longPress: { next: 'CONTEXT', actions: ['closePrimary', 'openContext'] },
        },
        CONTEXT: {
            tap:       { next: 'IDLE', actions: ['closeContext']               },
            doubleTap: { next: 'IDLE', actions: ['closeContext', 'goToLayout'] },
            longPress: { next: 'IDLE', actions: ['closeContext']               },
        },
    };

    let _state = 'IDLE';
    let _getMenu = null;       // () → active hub-menu config object
    let _onGoToLayout = null;  // () → navigate to the layout/pinned tab

    // ── State sync ────────────────────────────────────────────────────────────
    // Re-derive state from live DOM so the machine is resilient to menus being
    // closed by external interactions (clicking elsewhere, Escape, item click).
    function _syncState() {
        const menu = _getMenu && _getMenu();
        if (!menu) { _state = 'IDLE'; return; }
        if (typeof menu.isContextMenuOpen === 'function' && menu.isContextMenuOpen()) {
            _state = 'CONTEXT'; return;
        }
        if (typeof menu.isPrimaryMenuOpen === 'function' && menu.isPrimaryMenuOpen()) {
            _state = 'PRIMARY'; return;
        }
        _state = 'IDLE';
    }

    // ── Actions ───────────────────────────────────────────────────────────────
    function _executeAction(action, btn) {
        const menu = _getMenu && _getMenu();
        if (!menu) return;
        switch (action) {
            case 'openPrimary':
                if (btn && typeof menu.openPrimaryMenuAt === 'function') {
                    menu.openPrimaryMenuAt(btn);
                }
                break;
            case 'closePrimary':
                // closeAnchoredMenus closes both; safe to call even if only one is open.
                if (typeof menu.closeAnchoredMenus === 'function') menu.closeAnchoredMenus();
                break;
            case 'openContext':
                if (btn && typeof menu.openContextMenuAt === 'function') {
                    menu.openContextMenuAt(btn);
                }
                break;
            case 'closeContext':
                if (typeof menu.closeContextMenu === 'function') menu.closeContextMenu();
                break;
            case 'goToLayout':
                if (typeof _onGoToLayout === 'function') _onGoToLayout();
                break;
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    // dispatch(event, btn)
    //   event — 'tap' | 'doubleTap' | 'longPress'
    //   btn   — the origin button DOM element (for menu positioning)
    function dispatch(event, btn) {
        _syncState();  // always re-derive from DOM first
        const t = TRANSITIONS[_state] && TRANSITIONS[_state][event];
        if (!t) {
            // No registered transition — ignore silently (valid no-op for unknown events)
            return;
        }
        const prev = _state;
        _state = t.next;
        t.actions.forEach(a => _executeAction(a, btn));
    }

    // configure(opts) — call once during app init (DOMContentLoaded)
    //   opts.getMenu      — function returning the active hub-menu config
    //   opts.onGoToLayout — function to navigate to the layout/pinned tab
    function configure(opts) {
        if (opts && typeof opts.getMenu === 'function')      _getMenu = opts.getMenu;
        if (opts && typeof opts.onGoToLayout === 'function') _onGoToLayout = opts.onGoToLayout;
    }

    // getState() — returns current state (after syncing from DOM)
    function getState() {
        _syncState();
        return _state;
    }

    return { dispatch, configure, getState, STATES };
})();
