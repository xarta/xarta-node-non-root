// synthesis-menu.js — Split-dropdown navigation for the Synthesis group
// xarta-node Blueprints GUI
//
// Thin wrapper around createHubMenu() (hub-menu.js).
// Contains only the Synthesis-specific config, defaultMenu, and function registrations.
//
// localStorage key: 'blueprintsSynthesisMenuConfig'
//
// Note: 'manual-links-rendered' and 'manual-links-table' are pseudo-tab IDs.
// switchTab() intercepts them to show #tab-manual-links and call manualLinksShowView().
//
// No inline event handlers — all event wiring via addEventListener.

'use strict';

const SynthesisMenuConfig = createHubMenu({
    storageKey:      'blueprintsSynthesisMenuConfig',
    group:           'synthesis',
    toggleId:        'synthesisMenuToggle',
    tabsId:          'synthesisHubTabs',
    currentLabelId:  'synthesisCurrentTabLabel',
    saveButtonId:    'synthesisMenuSaveButton',
    resetButtonId:   'synthesisMenuResetButton',
    editorListId:    'synthesisMenuEditorList',
    notificationId:  'synthesisMenuSaveNotification',
    resetConfirmMsg: 'Reset synthesis navbar to default layout?',
    // Mobile: the layout/context button is pinned outside the hamburger menu
    mobilePinnedId:  'synthesis-layout',
    pinnedTabsId:    'synthesisHubTabsPinned',
    defaultMenu: [
        { id: 'manual-links',          label: 'Manual',    icon: HIEROGLYPHS.ropeCoil,   pageLabel: 'Manual Links',          parent: null,              order: 0 },
        { id: 'manual-links-rendered', label: 'Rendered',  icon: HIEROGLYPHS.khaHorizon, pageLabel: 'Manual Links',          parent: 'manual-links',    order: 0 },
        { id: 'manual-links-table',    label: 'Table',     icon: HIEROGLYPHS.cartouche,  pageLabel: 'Manual Links (Table)',  parent: 'manual-links',    order: 1 },
        { id: 'services',              label: 'Services',  icon: HIEROGLYPHS.sekhem,     pageLabel: 'Services',              parent: null,              order: 1 },
        { id: 'machines',              label: 'Machines',  icon: HIEROGLYPHS.nemesCrown, pageLabel: 'Machines',              parent: null,              order: 2 },
        { id: 'synthesis-layout',      label: '☰',         icon: HIEROGLYPHS.kheper,     pageLabel: 'Navbar Layout',         parent: null,              order: 3 },

        // ── Services page function items ──────────────────────────────────
        { id: 'svc-fn-add',     label: 'Add service', icon: HIEROGLYPHS.sekhem,     fn: 'svc.add',     activeOn: ['services'], parent: 'synthesis-layout', order: 0 },
        { id: 'svc-fn-refresh', label: 'Refresh',     icon: HIEROGLYPHS.nefer,      fn: 'svc.refresh', activeOn: ['services'], parent: 'synthesis-layout', order: 1 },
        { id: 'svc-fn-cols',    label: 'Columns',     icon: HIEROGLYPHS.khaHorizon, fn: 'svc.columns', activeOn: ['services'], parent: 'synthesis-layout', order: 2 },
        { id: 'svc-fn-scroll',  label: 'Horizontal Scroll', icon: 'icons/ui/table-columns-blue.svg', fn: 'svc.scroll', activeOn: ['services'], parent: 'synthesis-layout', order: 3 },

        // ── Machines page function items ──────────────────────────────────
        { id: 'mch-fn-refresh', label: 'Refresh',     icon: HIEROGLYPHS.nefer,      fn: 'mch.refresh', activeOn: ['machines'], parent: 'synthesis-layout', order: 0 },
        { id: 'mch-fn-cols',    label: 'Columns',     icon: HIEROGLYPHS.khaHorizon, fn: 'mch.columns', activeOn: ['machines'], parent: 'synthesis-layout', order: 1 },
        { id: 'mch-fn-scroll',  label: 'Horizontal Scroll', icon: 'icons/ui/table-columns-blue.svg', fn: 'mch.scroll', activeOn: ['machines'], parent: 'synthesis-layout', order: 2 },

        // ── Manual Links (table view) function items ──────────────────────
        { id: 'ml-fn-add',      label: 'Add link',     icon: HIEROGLYPHS.ropeCoil, fn: 'ml.add',      activeOn: ['manual-links-table'], parent: 'synthesis-layout', order: 0 },
        { id: 'ml-fn-refresh',  label: 'Refresh',      icon: HIEROGLYPHS.nefer,    fn: 'ml.refresh',  activeOn: ['manual-links-table'], parent: 'synthesis-layout', order: 1 },
        { id: 'ml-fn-cols',     label: 'Columns',      icon: HIEROGLYPHS.khaHorizon, fn: 'ml.columns', activeOn: ['manual-links-table'], parent: 'synthesis-layout', order: 2 },
        { id: 'ml-fn-scroll',   label: 'Horizontal Scroll', icon: 'icons/ui/table-columns-blue.svg', fn: 'ml.scroll', activeOn: ['manual-links-table'], parent: 'synthesis-layout', order: 3 },
        { id: 'ml-fn-grp-none', label: 'Group: None',  icon: 'icons/ui/minus-box-blue.svg',    fn: 'ml.grpNone',  activeOn: ['manual-links-table'], parent: 'synthesis-layout', order: 4 },
        { id: 'ml-fn-grp-grp',  label: 'Group: Group', icon: 'icons/ui/group-folder-blue.svg', fn: 'ml.grpGroup', activeOn: ['manual-links-table'], parent: 'synthesis-layout', order: 5 },
        { id: 'ml-fn-grp-host', label: 'Group: Host',  icon: 'icons/ui/monitor-blue.svg',      fn: 'ml.grpHost',  activeOn: ['manual-links-table'], parent: 'synthesis-layout', order: 6 },
    ],
});

function _synthesisToggleHorizontalScroll(getController, rerender) {
    const controller = typeof getController === 'function' ? getController() : null;
    if (!controller || typeof controller.toggleHorizontalScroll !== 'function') return;
    controller.toggleHorizontalScroll();
    if (typeof rerender === 'function') rerender();
}

function _synthesisHorizontalScrollLabel(label, getController) {
    const controller = typeof getController === 'function' ? getController() : null;
    const enabled = !!(controller && typeof controller.isHorizontalScrollEnabled === 'function' && controller.isHorizontalScrollEnabled());
    return `${label}: ${enabled ? 'On' : 'Off'}`;
}

// ── Function registrations ───────────────────────────────────────────────────
// synthesis-menu.js loads after services.js, machines.js, and manual-links.js
// so all referenced globals are in scope.

SynthesisMenuConfig.registerFunctions({
    'svc.add':      () => openAddModal(),
    'svc.refresh':  () => loadServices(),
    'svc.columns':  () => svcOpenColsModal(),
    'svc.scroll':   () => _synthesisToggleHorizontalScroll(() => _ensureServicesTablePrefs(), () => renderServices()),
    'mch.refresh':  () => loadMachines(),
    'mch.columns':  () => mchOpenColsModal(),
    'mch.scroll':   () => _synthesisToggleHorizontalScroll(() => _ensureMachinesTablePrefs(), () => renderMachines()),
    'ml.add':       () => openManualLinkModal(null),
    'ml.refresh':   () => loadManualLinks(),
    'ml.columns':   () => mlOpenColsModal(),
    'ml.scroll':    () => _synthesisToggleHorizontalScroll(() => _ensureManualLinksTablePrefs(), () => renderManualLinksTable()),
    'ml.grpNone':   () => mlSetGroupBy('none'),
    'ml.grpGroup':  () => mlSetGroupBy('group'),
    'ml.grpHost':   () => mlSetGroupBy('host'),
});

SynthesisMenuConfig.registerLabelGetters({
    'svc-fn-scroll': () => _synthesisHorizontalScrollLabel('Horizontal Scroll', () => _ensureServicesTablePrefs()),
    'mch-fn-scroll': () => _synthesisHorizontalScrollLabel('Horizontal Scroll', () => _ensureMachinesTablePrefs()),
    'ml-fn-scroll':  () => _synthesisHorizontalScrollLabel('Horizontal Scroll', () => _ensureManualLinksTablePrefs()),
});
