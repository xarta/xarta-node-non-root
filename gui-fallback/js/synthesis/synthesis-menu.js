// synthesis-menu.js — Split-dropdown navigation for the Synthesis group
// xarta-node Blueprints GUI
//
// Thin wrapper around createHubMenu() (hub-menu.js).
// Contains only the Synthesis-specific config, defaultMenu, and function registrations.
//
// localStorage key: 'blueprintsSynthesisMenuConfig'
//
// Note: 'manual-links-rendered', 'manual-links-grid', 'manual-links-table',
// and dynamic 'manual-links-page:<category_id>' entries are pseudo-tab IDs.
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
        { id: 'splash-screens',        label: 'Splash Screens', icon: HIEROGLYPHS.starDuat, pageLabel: 'Splash Screens',     parent: null,              order: -1 },
        { id: 'splash-dont-panic-3',   label: "Don't Panic", icon: HIEROGLYPHS.starDuat, pageLabel: "Don't Panic",       parent: 'splash-screens',  order: 0 },
        { id: 'manual-links',          label: 'Manual',    icon: HIEROGLYPHS.eyeOfHorus, pageLabel: 'Manual Links',          parent: null,              order: 1, defaultTargetFn: 'ml.defaultTarget' },
        { id: 'manual-links-table',    label: 'Table',     icon: HIEROGLYPHS.cartouche,  pageLabel: 'Manual Links (Table)',  parent: 'manual-links',    order: 0 },
        { id: 'manual-links-rendered', label: 'Rendered',  icon: HIEROGLYPHS.khaHorizon, pageLabel: 'Manual Links - Rendered', parent: 'manual-links',    order: 1 },
        { id: 'manual-links-grid',     label: 'Interface', icon: HIEROGLYPHS.eyeOfHorus, pageLabel: 'Manual Links - Interface', parent: 'manual-links',    order: 2 },
        { id: 'services',              label: 'Services',  icon: HIEROGLYPHS.sekhem,     pageLabel: 'Services',              parent: null,              order: 2 },
        { id: 'machines',              label: 'Machines',  icon: HIEROGLYPHS.nemesCrown, pageLabel: 'Machines',              parent: null,              order: 3 },
        { id: 'synthesis-layout',      label: '☰',         icon: HIEROGLYPHS.kheper,     pageLabel: 'Navbar Layout',         parent: null,              order: 4 },

        // ── Splash screen function items ──────────────────────────────────
        { id: 'splash-fn-set-default', label: 'Set as default', icon: HIEROGLYPHS.starDuat, fn: 'splash.setDefault', activeOn: ['splash-dont-panic-3'], parent: 'synthesis-layout', order: 0 },
        { id: 'splash-fn-debug',       label: 'Debug On', icon: HIEROGLYPHS.eyeOfHorus, fn: 'splash.debugTelemetry', activeOn: ['splash-dont-panic-3'], parent: 'synthesis-layout', order: 1 },

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

        // ── Manual Links function items ───────────────────────────────────
        { id: 'ml-fn-add',      label: 'Add link',     icon: HIEROGLYPHS.eyeOfHorus, fn: 'ml.add',      activeOn: ['manual-links-grid', 'manual-links-table'], parent: 'synthesis-layout', order: 0 },
        { id: 'ml-fn-add-category', label: 'Add Category', icon: HIEROGLYPHS.eyeOfHorus, fn: 'ml.addCategory', activeOn: ['manual-links-grid'], parent: 'synthesis-layout', order: 1 },
        { id: 'ml-fn-refresh',  label: 'Refresh',      icon: HIEROGLYPHS.nefer,    fn: 'ml.refresh',  activeOn: ['manual-links', 'manual-links-rendered', 'manual-links-grid', 'manual-links-table'], parent: 'synthesis-layout', order: 2 },
        { id: 'ml-fn-set-default', label: 'Set as default', icon: HIEROGLYPHS.starDuat, fn: 'ml.setDefault', activeOn: ['manual-links', 'manual-links-rendered', 'manual-links-grid', 'manual-links-table'], parent: 'synthesis-layout', order: 3 },
        { id: 'ml-fn-grid-autofit', label: 'Auto Fit Interface', icon: 'icons/ui/table-columns-blue.svg', fn: 'ml.gridAutoFit', activeOn: ['manual-links-grid'], parent: 'synthesis-layout', order: 4 },
        { id: 'ml-fn-grid-debug', label: 'Debug Cells: Off', icon: HIEROGLYPHS.eyeOfHorus, fn: 'ml.gridDebug', activeOn: ['manual-links-grid'], parent: 'synthesis-layout', order: 5 },
        { id: 'ml-fn-demote-page', label: 'Demote', icon: HIEROGLYPHS.kheper, fn: 'ml.demotePage', activeOn: [], parent: 'synthesis-layout', order: 6 },
        { id: 'ml-fn-cols',     label: 'Columns',      icon: HIEROGLYPHS.khaHorizon, fn: 'ml.columns', activeOn: ['manual-links-table'], parent: 'synthesis-layout', order: 6 },
        { id: 'ml-fn-scroll',   label: 'Horiz Scroll: Is Off', icon: 'icons/ui/table-columns-blue.svg', fn: 'ml.scroll', activeOn: ['manual-links-table'], parent: 'synthesis-layout', order: 7 },
        { id: 'ml-fn-autofit',  label: 'Auto Fit Widths', icon: 'icons/ui/table-columns-blue.svg', fn: 'ml.autoFit', activeOn: ['manual-links-table'], parent: 'synthesis-layout', order: 8 },
        { id: 'ml-fn-context',  label: 'Layout Context', icon: HIEROGLYPHS.eyeOfHorus, fn: 'ml.context', activeOn: ['manual-links-table'], parent: 'synthesis-layout', order: 9 },
        { id: 'ml-fn-grp-none', label: 'Group: None',  icon: 'icons/ui/minus-box-blue.svg',    fn: 'ml.grpNone',  activeOn: ['manual-links-table'], parent: 'synthesis-layout', order: 8 },
        { id: 'ml-fn-grp-grp',  label: 'Group: Placement', icon: 'icons/ui/group-folder-blue.svg', fn: 'ml.grpGroup', activeOn: ['manual-links-table'], parent: 'synthesis-layout', order: 9 },
        { id: 'ml-fn-grp-host', label: 'Group: Host',  icon: 'icons/ui/monitor-blue.svg',      fn: 'ml.grpHost',  activeOn: ['manual-links-table'], parent: 'synthesis-layout', order: 10 },
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

const _SYNTHESIS_MANUAL_DYNAMIC_PREFIX = 'manual-links-page:';
const _SYNTHESIS_MANUAL_RETIRED_PAGE_IDS = new Set(['manual-links-tree', 'manual-links-pretext']);
let _synthesisManualLastPageCategories = [];

function _synthesisManualPageId(categoryId) {
    return _SYNTHESIS_MANUAL_DYNAMIC_PREFIX + categoryId;
}

function _synthesisManualGridContextIds(pageItems) {
    return ['manual-links-grid', ...pageItems.map(item => item.id)];
}

function _synthesisManualPageCategoryLabel(cat) {
    return cat?.page_label || cat?.label || 'Interface Page';
}

function syncSynthesisManualLinksPageMenu(pageCategories) {
    _synthesisManualLastPageCategories = Array.isArray(pageCategories) ? pageCategories : [];
    const pages = (Array.isArray(pageCategories) ? pageCategories : [])
        .filter(cat => cat && cat.category_id)
        .sort((a, b) => {
            const ao = Number(a.page_sort_order ?? a.sort_order ?? 0);
            const bo = Number(b.page_sort_order ?? b.sort_order ?? 0);
            if (ao !== bo) return ao - bo;
            return (a.page_label || a.label || '').localeCompare(b.page_label || b.label || '');
        })
        .map((cat, index) => ({
            id: _synthesisManualPageId(cat.category_id),
            label: _synthesisManualPageCategoryLabel(cat),
            icon: cat.icon || HIEROGLYPHS.eyeOfHorus,
            pageLabel: `Manual Links - ${_synthesisManualPageCategoryLabel(cat)}`,
            parent: 'manual-links',
            order: 10 + index,
            manualLinksPageCategoryId: cat.category_id,
        }));

    const dynamicIds = new Set(pages.map(item => item.id));
    const keepItem = item => item
        && !_SYNTHESIS_MANUAL_RETIRED_PAGE_IDS.has(item.id)
        && (!String(item.id || '').startsWith(_SYNTHESIS_MANUAL_DYNAMIC_PREFIX) || dynamicIds.has(item.id));

    const syncItems = (items) => {
        const retained = (items || []).filter(keepItem);
        pages.forEach(page => {
            const existing = retained.find(item => item.id === page.id);
            if (existing) Object.assign(existing, page);
            else retained.push({ ...page });
        });
        return retained;
    };

    SynthesisMenuConfig.defaultMenu = syncItems(SynthesisMenuConfig.defaultMenu);
    SynthesisMenuConfig.currentMenu = syncItems(SynthesisMenuConfig.currentMenu);

    const dynamicPageIds = pages.map(item => item.id);
    const gridContextIds = _synthesisManualGridContextIds(pages);
    const refreshContextIds = ['manual-links', 'manual-links-rendered', 'manual-links-grid', 'manual-links-table', ...dynamicPageIds];
    const setActiveOn = (id, activeOn) => {
        [SynthesisMenuConfig.defaultMenu, SynthesisMenuConfig.currentMenu].forEach(items => {
            const item = (items || []).find(entry => entry.id === id);
            if (item) item.activeOn = [...activeOn];
        });
    };
    setActiveOn('ml-fn-add', ['manual-links-grid', 'manual-links-table', ...dynamicPageIds]);
    setActiveOn('ml-fn-add-category', gridContextIds);
    setActiveOn('ml-fn-refresh', refreshContextIds);
    setActiveOn('ml-fn-set-default', refreshContextIds);
    setActiveOn('ml-fn-grid-autofit', gridContextIds);
    setActiveOn('ml-fn-grid-debug', gridContextIds);
    setActiveOn('ml-fn-demote-page', dynamicPageIds);

    if (SynthesisMenuConfig._initialized) {
        SynthesisMenuConfig.renderNavbar(SynthesisMenuConfig._activeId);
        SynthesisMenuConfig.renderEditor();
        SynthesisMenuConfig.updateActiveTab(SynthesisMenuConfig._activeId);
    }
}
window.syncSynthesisManualLinksPageMenu = syncSynthesisManualLinksPageMenu;
syncSynthesisManualLinksPageMenu([]);

const _synthesisOriginalShowGroup = SynthesisMenuConfig.showGroup.bind(SynthesisMenuConfig);
SynthesisMenuConfig.showGroup = function showSynthesisGroupWithManualPageSync() {
    const result = _synthesisOriginalShowGroup();
    syncSynthesisManualLinksPageMenu(_synthesisManualLastPageCategories);
    return result;
};

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
    'ml.addCategory': () => openManualLinkCategoryModal(),
    'ml.refresh':   () => loadManualLinks(),
    'ml.columns':   () => mlOpenColsModal(),
    'ml.context':   () => openManualLinksLayoutContextModal(),
    'ml.scroll':    () => toggleManualLinksHorizontalScroll(),
    'ml.autoFit':   () => _synthesisAutoFitLayout(() => _ensureManualLinksLayoutController()),
    'ml.gridAutoFit': () => BlueprintsManualLinks.autoFitInterface(),
    'ml.gridDebug': () => BlueprintsManualLinks.toggleDebugCells(),
    'ml.demotePage': () => BlueprintsManualLinks.demoteActivePage(),
    'ml.grpNone':   () => mlSetGroupBy('none'),
    'ml.grpGroup':  () => mlSetGroupBy('group'),
    'ml.grpHost':   () => mlSetGroupBy('host'),
    'ml.defaultTarget': () => BlueprintsManualLinks.getDefaultTabId(),
    'ml.setDefault': () => BlueprintsManualLinks.setActiveAsDefault(),
    'splash.setDefault': () => BlueprintsSplashScreens.setActiveAsDefault(),
    'splash.debugTelemetry': () => BlueprintsSplashScreens.toggleDebugTelemetry(),
});

SynthesisMenuConfig.registerLabelGetters({
    'svc-fn-scroll': () => _synthesisHorizontalScrollLabel('Horiz Scroll', () => _ensureServicesLayoutController()),
    'mch-fn-scroll': () => _synthesisHorizontalScrollLabel('Horiz Scroll', () => _ensureMachinesLayoutController()),
    'ml-fn-scroll':  () => _synthesisHorizontalScrollLabel('Horiz Scroll', () => _ensureManualLinksLayoutController()),
    'ml-fn-grid-debug': () => `Debug Cells: ${BlueprintsManualLinks.debugCellsEnabled() ? 'On' : 'Off'}`,
    'splash-fn-debug': () => BlueprintsSplashScreens.debugTelemetryLabel(),
});

SynthesisMenuConfig.registerVisibilityGetters({
    'ml-fn-page-1': () => false,
    'ml-fn-page-2': () => false,
    'ml-fn-page-3': () => false,
});
