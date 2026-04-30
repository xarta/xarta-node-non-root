// synthesis-menu.js — Split-dropdown navigation for the Synthesis group
// xarta-node Blueprints GUI
//
// Thin wrapper around createHubMenu() (hub-menu.js).
// Contains only the Synthesis-specific config, defaultMenu, and function registrations.
//
// localStorage key: 'blueprintsSynthesisMenuConfig'
//
// Note: 'manual-links-rendered', 'manual-links-tree', 'manual-links-pretext',
// and 'manual-links-table' are pseudo-tab IDs.
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
        { id: 'manual-links-rendered', label: 'Page 1',    icon: HIEROGLYPHS.khaHorizon, pageLabel: 'Manual Links - Page 1', parent: 'manual-links',    order: 0 },
        { id: 'manual-links-tree',     label: 'Page 2',    icon: HIEROGLYPHS.papyrus,    pageLabel: 'Manual Links - Page 2', parent: 'manual-links',    order: 1 },
        { id: 'manual-links-pretext',  label: 'Page 3',    icon: HIEROGLYPHS.starDuat,   pageLabel: 'Manual Links - Page 3', parent: 'manual-links',    order: 2 },
        { id: 'manual-links-table',    label: 'Table',     icon: HIEROGLYPHS.cartouche,  pageLabel: 'Manual Links (Table)',  parent: 'manual-links',    order: 3 },
        { id: 'services',              label: 'Services',  icon: HIEROGLYPHS.sekhem,     pageLabel: 'Services',              parent: null,              order: 1 },
        { id: 'machines',              label: 'Machines',  icon: HIEROGLYPHS.nemesCrown, pageLabel: 'Machines',              parent: null,              order: 2 },
        { id: 'synthesis-layout',      label: '☰',         icon: HIEROGLYPHS.kheper,     pageLabel: 'Navbar Layout',         parent: null,              order: 3 },

        // ── Services page function items ──────────────────────────────────
        { id: 'svc-fn-add',     label: 'Add service', icon: HIEROGLYPHS.sekhem,     fn: 'svc.add',     activeOn: ['services'], parent: 'synthesis-layout', order: 0 },
        { id: 'svc-fn-refresh', label: 'Refresh',     icon: HIEROGLYPHS.nefer,      fn: 'svc.refresh', activeOn: ['services'], parent: 'synthesis-layout', order: 1 },
        { id: 'svc-fn-cols',    label: 'Columns',     icon: HIEROGLYPHS.khaHorizon, fn: 'svc.columns', activeOn: ['services'], parent: 'synthesis-layout', order: 2 },
        { id: 'svc-fn-scroll',  label: 'Horiz Scroll: Is Off', icon: 'icons/ui/table-columns-blue.svg', fn: 'svc.scroll', activeOn: ['services'], parent: 'synthesis-layout', order: 3 },
        { id: 'svc-fn-autofit', label: 'Auto Fit Widths', icon: 'icons/ui/table-columns-blue.svg', fn: 'svc.autoFit', activeOn: ['services'], parent: 'synthesis-layout', order: 4 },
        { id: 'svc-fn-context', label: 'Layout Context', icon: HIEROGLYPHS.eyeOfHorus, fn: 'svc.context', activeOn: ['services'], parent: 'synthesis-layout', order: 5 },

        // ── Machines page function items ──────────────────────────────────
        { id: 'mch-fn-refresh', label: 'Refresh',     icon: HIEROGLYPHS.nefer,      fn: 'mch.refresh', activeOn: ['machines'], parent: 'synthesis-layout', order: 0 },
        { id: 'mch-fn-cols',    label: 'Columns',     icon: HIEROGLYPHS.khaHorizon, fn: 'mch.columns', activeOn: ['machines'], parent: 'synthesis-layout', order: 1 },
        { id: 'mch-fn-scroll',  label: 'Horiz Scroll: Is Off', icon: 'icons/ui/table-columns-blue.svg', fn: 'mch.scroll', activeOn: ['machines'], parent: 'synthesis-layout', order: 2 },
        { id: 'mch-fn-autofit', label: 'Auto Fit Widths', icon: 'icons/ui/table-columns-blue.svg', fn: 'mch.autoFit', activeOn: ['machines'], parent: 'synthesis-layout', order: 3 },
        { id: 'mch-fn-context', label: 'Layout Context', icon: HIEROGLYPHS.eyeOfHorus, fn: 'mch.context', activeOn: ['machines'], parent: 'synthesis-layout', order: 4 },

        // ── Manual Links (table view) function items ──────────────────────
        { id: 'ml-fn-add',      label: 'Add link',     icon: HIEROGLYPHS.ropeCoil, fn: 'ml.add',      activeOn: ['manual-links-table'], parent: 'synthesis-layout', order: 0 },
        { id: 'ml-fn-refresh',  label: 'Refresh',      icon: HIEROGLYPHS.nefer,    fn: 'ml.refresh',  activeOn: ['manual-links-table'], parent: 'synthesis-layout', order: 1 },
        { id: 'ml-fn-cols',     label: 'Columns',      icon: HIEROGLYPHS.khaHorizon, fn: 'ml.columns', activeOn: ['manual-links-table'], parent: 'synthesis-layout', order: 2 },
        { id: 'ml-fn-scroll',   label: 'Horiz Scroll: Is Off', icon: 'icons/ui/table-columns-blue.svg', fn: 'ml.scroll', activeOn: ['manual-links-table'], parent: 'synthesis-layout', order: 3 },
        { id: 'ml-fn-autofit',  label: 'Auto Fit Widths', icon: 'icons/ui/table-columns-blue.svg', fn: 'ml.autoFit', activeOn: ['manual-links-table'], parent: 'synthesis-layout', order: 4 },
        { id: 'ml-fn-context',  label: 'Layout Context', icon: HIEROGLYPHS.eyeOfHorus, fn: 'ml.context', activeOn: ['manual-links-table'], parent: 'synthesis-layout', order: 5 },
        { id: 'ml-fn-grp-none', label: 'Group: None',  icon: 'icons/ui/minus-box-blue.svg',    fn: 'ml.grpNone',  activeOn: ['manual-links-table'], parent: 'synthesis-layout', order: 6 },
        { id: 'ml-fn-grp-grp',  label: 'Group: Group', icon: 'icons/ui/group-folder-blue.svg', fn: 'ml.grpGroup', activeOn: ['manual-links-table'], parent: 'synthesis-layout', order: 7 },
        { id: 'ml-fn-grp-host', label: 'Group: Host',  icon: 'icons/ui/monitor-blue.svg',      fn: 'ml.grpHost',  activeOn: ['manual-links-table'], parent: 'synthesis-layout', order: 8 },
        { id: 'ml-fn-page-1',   label: 'Page 1',       icon: HIEROGLYPHS.khaHorizon, fn: 'ml.page1', activeOn: ['manual-links', 'manual-links-rendered', 'manual-links-tree', 'manual-links-pretext', 'manual-links-table'], parent: 'synthesis-layout', order: 9 },
        { id: 'ml-fn-page-2',   label: 'Page 2',       icon: HIEROGLYPHS.papyrus,    fn: 'ml.page2', activeOn: ['manual-links', 'manual-links-rendered', 'manual-links-tree', 'manual-links-pretext', 'manual-links-table'], parent: 'synthesis-layout', order: 10 },
        { id: 'ml-fn-page-3',   label: 'Page 3',       icon: HIEROGLYPHS.starDuat,   fn: 'ml.page3', activeOn: ['manual-links', 'manual-links-rendered', 'manual-links-tree', 'manual-links-pretext', 'manual-links-table'], parent: 'synthesis-layout', order: 11 },
    ],
});

function _synthesisHorizontalScrollLabel(label, getController) {
    const controller = typeof getController === 'function' ? getController() : null;
    const enabled = !!(controller && typeof controller.isHorizontalScrollEnabled === 'function' && controller.isHorizontalScrollEnabled());
    return `${label}: ${enabled ? 'Is On' : 'Is Off'}`;
}

async function _synthesisAutoFitLayout(getController) {
    const controller = typeof getController === 'function' ? getController() : null;
    if (!controller) return null;
    if (typeof controller.autoFitLayout !== 'function') return null;
    return controller.autoFitLayout({ percentile: 1 });
}

// ── Function registrations ───────────────────────────────────────────────────
// synthesis-menu.js loads after services.js, machines.js, and manual-links.js
// so all referenced globals are in scope.

SynthesisMenuConfig.registerFunctions({
    'svc.add':      () => openAddModal(),
    'svc.refresh':  () => loadServices(),
    'svc.columns':  () => svcOpenColsModal(),
    'svc.context':  () => openServicesLayoutContextModal(),
    'svc.scroll':   () => toggleServicesHorizontalScroll(),
    'svc.autoFit':  () => _synthesisAutoFitLayout(() => _ensureServicesLayoutController()),
    'mch.refresh':  () => loadMachines(),
    'mch.columns':  () => mchOpenColsModal(),
    'mch.context':  () => openMachinesLayoutContextModal(),
    'mch.scroll':   () => toggleMachinesHorizontalScroll(),
    'mch.autoFit':  () => _synthesisAutoFitLayout(() => _ensureMachinesLayoutController()),
    'ml.add':       () => openManualLinkModal(null),
    'ml.refresh':   () => loadManualLinks(),
    'ml.columns':   () => mlOpenColsModal(),
    'ml.context':   () => openManualLinksLayoutContextModal(),
    'ml.scroll':    () => toggleManualLinksHorizontalScroll(),
    'ml.autoFit':   () => _synthesisAutoFitLayout(() => _ensureManualLinksLayoutController()),
    'ml.grpNone':   () => mlSetGroupBy('none'),
    'ml.grpGroup':  () => mlSetGroupBy('group'),
    'ml.grpHost':   () => mlSetGroupBy('host'),
    'ml.page1':     () => switchTab('manual-links-rendered'),
    'ml.page2':     () => switchTab('manual-links-tree'),
    'ml.page3':     () => switchTab('manual-links-pretext'),
});

SynthesisMenuConfig.registerLabelGetters({
    'svc-fn-scroll': () => _synthesisHorizontalScrollLabel('Horiz Scroll', () => _ensureServicesLayoutController()),
    'mch-fn-scroll': () => _synthesisHorizontalScrollLabel('Horiz Scroll', () => _ensureMachinesLayoutController()),
    'ml-fn-scroll':  () => _synthesisHorizontalScrollLabel('Horiz Scroll', () => _ensureManualLinksLayoutController()),
});
