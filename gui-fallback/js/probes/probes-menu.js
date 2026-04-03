// probes-menu.js — Split-dropdown navigation for the Probes group
// xarta-node Blueprints GUI
//
// Thin wrapper around createHubMenu() (hub-menu.js).
// Contains only the Probes-specific config, defaultMenu, and function registrations.
//
// localStorage key: 'blueprintsProbesMenuConfig'
// No inline event handlers — all event wiring via addEventListener.

'use strict';

const ProbesMenuConfig = createHubMenu({
    storageKey:      'blueprintsProbesMenuConfig',
    group:           'probes',
    toggleId:        'probesMenuToggle',
    tabsId:          'probesHubTabs',
    currentLabelId:  'probesCurrentTabLabel',
    saveButtonId:    'probesMenuSaveButton',
    resetButtonId:   'probesMenuResetButton',
    editorListId:    'probesMenuEditorList',
    notificationId:  'probesMenuSaveNotification',
    resetConfirmMsg: 'Reset probes menu to default layout?',
    // Mobile: the layout/context button is pinned outside the hamburger menu
    mobilePinnedId:  'probes-settings',
    pinnedTabsId:    'probesHubTabsPinned',
    defaultMenu: [
        { id: 'pfsense-dns',          label: 'pfSense DNS',    icon: 'icons/ui/pfsense-blue.svg',  pageLabel: 'pfSense DNS',       parent: null,              order: 0 },
        { id: 'proxmox-config',       label: 'Proxmox Config', icon: 'icons/ui/proxmox-blue.svg',  pageLabel: 'Proxmox Config',    parent: null,              order: 1 },
        { id: 'vlans',                label: 'VLANs',            icon: HIEROGLYPHS.nileWaves,  pageLabel: 'VLANs',             parent: 'proxmox-config',  order: 0 },
        { id: 'ssh-targets',          label: 'SSH Targets',      icon: HIEROGLYPHS.doorBolt,   pageLabel: 'SSH Targets',       parent: 'proxmox-config',  order: 1 },
        { id: 'dockge-stacks',        label: 'Dockge Stacks',    icon: HIEROGLYPHS.pyramid,    pageLabel: 'Dockge Stacks',     parent: 'proxmox-config',  order: 2 },
        { id: 'caddy-configs',        label: 'Caddy Configs',    icon: HIEROGLYPHS.solarBoat,  pageLabel: 'Caddy Configs',     parent: 'proxmox-config',  order: 3 },
        { id: 'bookmarks',            label: 'Bookmarks',        icon: HIEROGLYPHS.papyrus,    pageLabel: 'Bookmarks',         parent: null,              order: 2 },
        { id: 'bookmarks-main',       label: 'Main',             icon: HIEROGLYPHS.papyrus,    pageLabel: 'Bookmarks',         parent: 'bookmarks',       order: 0 },
        { id: 'bookmarks-history',    label: 'History',          icon: HIEROGLYPHS.starDuat,   pageLabel: 'Visit History',     parent: 'bookmarks',       order: 1 },
        { id: 'bookmarks-embeddings', label: 'Embeddings',       icon: HIEROGLYPHS.falcon,     pageLabel: 'Embedding Config',  parent: 'bookmarks',       order: 2 },
        { id: 'bookmarks-setup',      label: 'Setup',            icon: HIEROGLYPHS.djedPillar, pageLabel: 'Setup & Import',    parent: 'bookmarks',       order: 3 },
        { id: 'probes-settings',      label: '☰',                icon: HIEROGLYPHS.kheper,     pageLabel: 'Navbar Layout',     parent: null,              order: 3 },

        // ── Bookmarks page function items ─────────────────────────────────
        { id: 'bm-fn-add',    label: 'Add Bookmark', icon: 'icons/ui/plus-blue.svg',          fn: 'bm.add',         activeOn: ['bookmarks-main'], parent: 'probes-settings', order: 0 },
        { id: 'bm-fn-import', label: 'Import HTML',  icon: HIEROGLYPHS.papyrus,                fn: 'bm.import',      activeOn: ['bookmarks-main'], parent: 'probes-settings', order: 1 },
        { id: 'bm-fn-refresh',label: 'Refresh',      icon: HIEROGLYPHS.nefer,                  fn: 'bm.refresh',     activeOn: ['bookmarks-main'], parent: 'probes-settings', order: 2 },
        { id: 'bm-fn-cols',   label: 'Columns',      icon: 'icons/ui/table-columns-blue.svg',  fn: 'bm.cols',        activeOn: ['bookmarks-main'], parent: 'probes-settings', order: 3 },
        { id: 'bm-fn-scroll', label: 'Horiz Scroll: Is Off', icon: 'icons/ui/table-columns-blue.svg', fn: 'bm.scroll', activeOn: ['bookmarks-main'], parent: 'probes-settings', order: 4 },
        { id: 'bm-fn-pagination', label: 'Pagination', icon: 'icons/ui/table-columns-blue.svg', fn: 'bm.pagination', activeOn: ['bookmarks-main'], parent: 'probes-settings', order: 5 },
        { id: 'bm-fn-expl',   label: 'Explain Sort',    icon: HIEROGLYPHS.eyeOfHorus,  fn: 'bm.explainSort', activeOn: ['bookmarks-main'], parent: 'probes-settings', order: 6 },
        { id: 'bm-fn-dead',   label: 'Dead links',      icon: HIEROGLYPHS.shen,        fn: 'bm.deadLinks',   activeOn: ['bookmarks-main'], parent: 'probes-settings', order: 7 },

        // ── pfSense DNS page function items ───────────────────────────────
        { id: 'dns-fn-refresh',  label: 'Refresh',       icon: HIEROGLYPHS.nefer,      fn: 'dns.refresh',    activeOn: ['pfsense-dns'], parent: 'probes-settings', order: 0 },
        { id: 'dns-fn-probe',    label: 'Probe pfSense', icon: HIEROGLYPHS.wasScepter, fn: 'dns.probe',      activeOn: ['pfsense-dns'], parent: 'probes-settings', order: 1 },
        { id: 'dns-fn-sweep',    label: 'Ping Sweep',    icon: HIEROGLYPHS.wasScepter, fn: 'dns.sweep',      activeOn: ['pfsense-dns'], parent: 'probes-settings', order: 2 },
        { id: 'dns-fn-cols',     label: 'Columns',       icon: 'icons/ui/table-columns-blue.svg', fn: 'dns.cols', activeOn: ['pfsense-dns'], parent: 'probes-settings', order: 3 },
        { id: 'dns-fn-scroll',   label: 'Horiz Scroll: Is Off', icon: 'icons/ui/table-columns-blue.svg', fn: 'dns.scroll', activeOn: ['pfsense-dns'], parent: 'probes-settings', order: 4 },
        { id: 'dns-fn-inactive', label: 'Hide inactive', icon: 'icons/ui/arrow-up-blue.svg', fn: 'dns.inactive', activeOn: ['pfsense-dns'], parent: 'probes-settings', order: 5 },
        { id: 'dns-fn-expand',   label: 'Expand all',    icon: 'icons/ui/chevron-down-blue.svg', fn: 'dns.expandAll',  activeOn: ['pfsense-dns'], parent: 'probes-settings', order: 6 },
        { id: 'dns-fn-collapse', label: 'Collapse all',  icon: 'icons/ui/chevron-up-blue.svg',   fn: 'dns.collapseAll',activeOn: ['pfsense-dns'], parent: 'probes-settings', order: 7 },
        { id: 'dns-fn-context',  label: 'Layout Context', icon: HIEROGLYPHS.eyeOfHorus, fn: 'dns.context',  activeOn: ['pfsense-dns'], parent: 'probes-settings', order: 8 },

        // ── Proxmox Config page function items ────────────────────────────
        { id: 'pve-fn-refresh',   label: 'Refresh',     icon: HIEROGLYPHS.nefer,      fn: 'pve.refresh',    activeOn: ['proxmox-config'], parent: 'probes-settings', order: 0 },
        { id: 'pve-fn-fullprobe', label: 'Full Probe',  icon: HIEROGLYPHS.wasScepter, fn: 'pve.fullProbe',  activeOn: ['proxmox-config'], parent: 'probes-settings', order: 1 },
        { id: 'pve-fn-steps',     label: 'Steps',       icon: HIEROGLYPHS.djedPillar, fn: 'pve.steps',      activeOn: ['proxmox-config'], parent: 'probes-settings', order: 2 },
        { id: 'pve-fn-cols',      label: 'Columns',     icon: 'icons/ui/table-columns-blue.svg', fn: 'pve.cols',      activeOn: ['proxmox-config'], parent: 'probes-settings', order: 3 },
        { id: 'pve-fn-scroll',    label: 'Horiz Scroll: Is Off', icon: 'icons/ui/table-columns-blue.svg', fn: 'pve.scroll', activeOn: ['proxmox-config'], parent: 'probes-settings', order: 4 },
        { id: 'pve-fn-expand',    label: 'Expand all',  icon: 'icons/ui/chevron-down-blue.svg',  fn: 'pve.expandAll', activeOn: ['proxmox-config'], parent: 'probes-settings', order: 5 },
        { id: 'pve-fn-collapse',  label: 'Collapse all', icon: 'icons/ui/chevron-up-blue.svg',   fn: 'pve.collapseAll',activeOn: ['proxmox-config'], parent: 'probes-settings', order: 6 },
        { id: 'pve-fn-context',   label: 'Layout Context', icon: HIEROGLYPHS.eyeOfHorus, fn: 'pve.context', activeOn: ['proxmox-config'], parent: 'probes-settings', order: 7 },

        // ── VLANs page function items ──────────────────────────────────────
        { id: 'vlan-fn-refresh',    label: 'Refresh',             icon: HIEROGLYPHS.nefer,      fn: 'vlan.refresh',    activeOn: ['vlans'],             parent: 'probes-settings', order: 0 },
        { id: 'vlan-fn-cols',       label: 'Columns',             icon: 'icons/ui/table-columns-blue.svg', fn: 'vlan.cols', activeOn: ['vlans'], parent: 'probes-settings', order: 1 },
        { id: 'vlan-fn-scroll',     label: 'Horiz Scroll: Is Off',   icon: 'icons/ui/table-columns-blue.svg', fn: 'vlan.scroll', activeOn: ['vlans'], parent: 'probes-settings', order: 2 },
        { id: 'vlan-fn-context',    label: 'Layout Context',      icon: HIEROGLYPHS.eyeOfHorus, fn: 'vlan.context', activeOn: ['vlans'], parent: 'probes-settings', order: 3 },

        // ── SSH Targets page function items ────────────────────────────────
        { id: 'ssh-fn-rebuild',     label: 'Rebuild from config', icon: HIEROGLYPHS.doorBolt,   fn: 'ssh.rebuild',     activeOn: ['ssh-targets'],       parent: 'probes-settings', order: 0 },
        { id: 'ssh-fn-cols',        label: 'Columns',             icon: 'icons/ui/table-columns-blue.svg', fn: 'ssh.cols', activeOn: ['ssh-targets'], parent: 'probes-settings', order: 1 },
        { id: 'ssh-fn-scroll',      label: 'Horiz Scroll: Is Off',   icon: 'icons/ui/table-columns-blue.svg', fn: 'ssh.scroll', activeOn: ['ssh-targets'], parent: 'probes-settings', order: 2 },
        { id: 'ssh-fn-context',     label: 'Layout Context',      icon: HIEROGLYPHS.eyeOfHorus, fn: 'ssh.context', activeOn: ['ssh-targets'], parent: 'probes-settings', order: 3 },

        // ── Dockge Stacks page function items ──────────────────────────────
        { id: 'dockge-fn-refresh',  label: 'Refresh',             icon: HIEROGLYPHS.nefer,      fn: 'dockge.refresh',  activeOn: ['dockge-stacks'],     parent: 'probes-settings', order: 0 },
        { id: 'dockge-fn-probe',    label: 'Probe Dockge',        icon: HIEROGLYPHS.wasScepter, fn: 'dockge.probe',    activeOn: ['dockge-stacks'],     parent: 'probes-settings', order: 1 },
        { id: 'dockge-fn-cols',     label: 'Columns',             icon: 'icons/ui/table-columns-blue.svg', fn: 'dockge.cols',    activeOn: ['dockge-stacks'],     parent: 'probes-settings', order: 2 },
        { id: 'dockge-fn-scroll',   label: 'Horiz Scroll: Is Off',   icon: 'icons/ui/table-columns-blue.svg', fn: 'dockge.scroll',  activeOn: ['dockge-stacks'],     parent: 'probes-settings', order: 3 },
        { id: 'dockge-fn-obsolete', label: 'Hide obsolete',       icon: 'icons/ui/arrow-up-blue.svg', fn: 'dockge.obsolete', activeOn: ['dockge-stacks'], parent: 'probes-settings', order: 4 },
        { id: 'dockge-fn-expand',   label: 'Expand all',          icon: 'icons/ui/chevron-down-blue.svg', fn: 'dockge.expandAll',activeOn: ['dockge-stacks'],     parent: 'probes-settings', order: 5 },
        { id: 'dockge-fn-collapse', label: 'Collapse all',        icon: 'icons/ui/chevron-up-blue.svg',   fn: 'dockge.collapse', activeOn: ['dockge-stacks'],     parent: 'probes-settings', order: 6 },
        { id: 'dockge-fn-context',  label: 'Layout Context',      icon: HIEROGLYPHS.eyeOfHorus, fn: 'dockge.context',  activeOn: ['dockge-stacks'],     parent: 'probes-settings', order: 7 },

        // ── Caddy Configs page function items ──────────────────────────────
        { id: 'caddy-fn-refresh',   label: 'Refresh',             icon: HIEROGLYPHS.nefer,      fn: 'caddy.refresh',   activeOn: ['caddy-configs'],     parent: 'probes-settings', order: 0 },
        { id: 'caddy-fn-probe',     label: 'Probe Caddy',         icon: HIEROGLYPHS.wasScepter, fn: 'caddy.probe',     activeOn: ['caddy-configs'],     parent: 'probes-settings', order: 1 },
        { id: 'caddy-fn-cols',      label: 'Columns',             icon: 'icons/ui/table-columns-blue.svg', fn: 'caddy.cols', activeOn: ['caddy-configs'], parent: 'probes-settings', order: 2 },
        { id: 'caddy-fn-scroll',    label: 'Horiz Scroll: Is Off',   icon: 'icons/ui/table-columns-blue.svg', fn: 'caddy.scroll', activeOn: ['caddy-configs'], parent: 'probes-settings', order: 3 },
        { id: 'caddy-fn-context',   label: 'Layout Context',      icon: HIEROGLYPHS.eyeOfHorus, fn: 'caddy.context',  activeOn: ['caddy-configs'], parent: 'probes-settings', order: 4 },

        // ── Visit History page function items ──────────────────────────────
        { id: 'vis-fn-refresh',     label: 'Refresh',             icon: HIEROGLYPHS.nefer,      fn: 'vis.refresh',     activeOn: ['bookmarks-history'], parent: 'probes-settings', order: 0 },
        { id: 'vis-fn-cols',        label: 'Columns',              icon: 'icons/ui/table-columns-blue.svg', fn: 'vis.cols', activeOn: ['bookmarks-history'], parent: 'probes-settings', order: 1 },
        { id: 'vis-fn-scroll',      label: 'Horiz Scroll: Is Off',    icon: 'icons/ui/table-columns-blue.svg', fn: 'vis.scroll', activeOn: ['bookmarks-history'], parent: 'probes-settings', order: 2 },
        { id: 'vis-fn-pagination',  label: 'Pagination',           icon: 'icons/ui/table-columns-blue.svg', fn: 'vis.pagination', activeOn: ['bookmarks-history'], parent: 'probes-settings', order: 3 },
        { id: 'vis-fn-context',     label: 'Layout Context',       icon: HIEROGLYPHS.eyeOfHorus, fn: 'vis.context', activeOn: ['bookmarks-history'], parent: 'probes-settings', order: 4 },

        // ── Setup & Import page function items ─────────────────────────────
        { id: 'setup-fn-import',    label: 'Import HTML',         icon: HIEROGLYPHS.papyrus,    fn: 'setup.import',    activeOn: ['bookmarks-setup'],   parent: 'probes-settings', order: 0 },
        { id: 'setup-fn-ext',       label: 'Download extension',   icon: 'icons/ui/arrow-down-blue.svg', fn: 'setup.ext', activeOn: ['bookmarks-setup'], parent: 'probes-settings', order: 1 },
    ],
});

function _probesToggleHorizontalScroll(getController, rerender) {
    const controller = typeof getController === 'function' ? getController() : null;
    if (!controller || typeof controller.toggleHorizontalScroll !== 'function') return;
    controller.toggleHorizontalScroll();
    if (typeof rerender === 'function') rerender();
}

function _probesHorizontalScrollLabel(label, getController) {
    const controller = typeof getController === 'function' ? getController() : null;
    const enabled = !!(controller && typeof controller.isHorizontalScrollEnabled === 'function' && controller.isHorizontalScrollEnabled());
    return `${label}: ${enabled ? 'Is On' : 'Is Off'}`;
}

function _probesExpandCollapseVisible(getState, mode) {
    const state = typeof getState === 'function' ? getState() : null;
    const hasExpandable = !!(state && state.hasExpandable);
    if (!hasExpandable) return false;
    const anyExpanded = !!state.anyExpanded;
    const anyCollapsed = !!state.anyCollapsed;
    if (mode === 'expand') return anyCollapsed;
    if (mode === 'collapse') return anyExpanded;
    return true;
}

// ── Function registrations ───────────────────────────────────────────────────
// probes-menu.js loads after bookmarks.js so all referenced globals are in scope.
// To register functions for an additional page, call:
//   ProbesMenuConfig.registerFunctions({ 'ns.key': () => myFunction() })
// from any script loaded after probes-menu.js, or add entries here with a
// matching fn item in defaultMenu above (fn: 'ns.key', activeOn: ['tab-id']).

ProbesMenuConfig.registerFunctions({
    // Bookmarks — Main tab
    'bm.add':         () => openBookmarkModal(null),
    'bm.import':      () => document.getElementById('bm-import-file').click(),
    'bm.refresh':     () => loadBookmarks(),
    'bm.cols':        () => _bmOpenColsModal(),
    'bm.scroll':      () => _probesToggleHorizontalScroll(() => _bmCurrentTablePrefs(), () => renderBookmarks({ keepPage: true })),
    'bm.pagination':  () => _bmTogglePagination(),
    'bm.explainSort': () => {
        if (!_bmSearchActive) {
            const st = document.getElementById('bm-search-status');
            if (st) {
                st.textContent = 'Explain Sort is only available during an active search.';
                st.hidden = false;
                setTimeout(() => { st.hidden = true; }, 3000);
            }
            return;
        }
        _bmOpenSortExplainModal();
    },
    'bm.deadLinks':   () => _bmAutoArchiveDead(null),

    // pfSense DNS
    'dns.refresh':    () => loadPfSenseDns(),
    'dns.probe':      () => probePfSense(),
    'dns.sweep':      () => pingSweep(),
    'dns.cols':       () => _dnsOpenColsModal(),
    'dns.scroll':     () => togglePfSenseDnsHorizontalScroll(),
    'dns.inactive':   () => togglePfSenseDnsHideInactive(),
    'dns.context':   () => openPfSenseDnsLayoutContextModal(),
    'dns.expandAll':  () => setAllDnsGroups(true),
    'dns.collapseAll':() => setAllDnsGroups(false),

    // Proxmox Config
    'pve.refresh':    () => loadProxmoxConfig(),
    'pve.fullProbe':  () => fullProbeProxmox(),
    'pve.steps':      () => togglePveSteps(),
    'pve.cols':       () => _pveOpenConfigColsModal(),
    'pve.scroll':     () => toggleProxmoxConfigHorizontalScroll(),
    'pve.context':   () => openProxmoxConfigLayoutContextModal(),
    'pve.expandAll':  () => setAllNets(true),
    'pve.collapseAll':() => setAllNets(false),

    // VLANs
    'vlan.refresh':   () => loadVlans(),
    'vlan.cols':      () => openVlansColsModal(),
    'vlan.scroll':    () => toggleVlansHorizontalScroll(),
    'vlan.context':  () => openVlansLayoutContextModal(),

    // SSH Targets
    'ssh.rebuild':    () => rebuildSshTargets(),
    'ssh.cols':       () => openSshTargetsColsModal(),
    'ssh.scroll':     () => toggleSshTargetsHorizontalScroll(),
    'ssh.context':   () => openSshTargetsLayoutContextModal(),

    // Dockge Stacks
    'dockge.refresh':    () => loadDockgeStacks(),
    'dockge.probe':      () => probeDockgeStacks(),
    'dockge.cols':       () => openDockgeColsModal(),
    'dockge.scroll':     () => toggleDockgeHorizontalScroll(),
    'dockge.obsolete':   () => toggleDockgeHideObsolete(),
    'dockge.context':  () => openDockgeLayoutContextModal(),
    'dockge.expandAll':  () => setAllDockgeServices(true),
    'dockge.collapse':   () => setAllDockgeServices(false),

    // Caddy Configs
    'caddy.refresh':  () => loadCaddyConfigs(),
    'caddy.probe':    () => probeCaddyConfigs(),
    'caddy.cols':     () => openCaddyColsModal(),
    'caddy.scroll':   () => toggleCaddyHorizontalScroll(),
    'caddy.context':  () => openCaddyLayoutContextModal(),

    // Visit History
    'vis.refresh':    () => loadVisits(),
    'vis.cols':       () => _visOpenColsModal(),
    'vis.scroll':     () => toggleVisitsHorizontalScroll(),
    'vis.context':   () => openVisitsLayoutContextModal(),
    'vis.pagination': () => _visTogglePagination(),

    // Setup & Import
    'setup.import':   () => { const inp = document.getElementById('bm-import-file2'); if (inp) inp.click(); },
    'setup.ext':      () => _bmDownloadExtension(null),
});

ProbesMenuConfig.registerLabelGetters({
    'bm-fn-scroll':      () => _probesHorizontalScrollLabel('Horiz Scroll', () => _bmCurrentTablePrefs()),
    'bm-fn-pagination': () => _bmIsPaginationEnabled() ? 'Pagination: On' : 'Pagination: Off',
    'dns-fn-scroll':     () => _probesHorizontalScrollLabel('Horiz Scroll', () => _ensureDnsLayoutController()),
    'dns-fn-inactive':   () => (typeof isPfSenseDnsHideInactive === 'function' && isPfSenseDnsHideInactive()) ? 'Show inactive' : 'Hide inactive',
    'pve-fn-scroll':     () => _probesHorizontalScrollLabel('Horiz Scroll', () => _ensurePveConfigLayoutController()),
    'vlan-fn-scroll':    () => _probesHorizontalScrollLabel('Horiz Scroll', () => _ensureVlansLayoutController()),
    'ssh-fn-scroll':     () => _probesHorizontalScrollLabel('Horiz Scroll', () => _ensureSshTargetsLayoutController()),
    'dockge-fn-scroll':  () => _probesHorizontalScrollLabel('Horiz Scroll', () => _ensureDockgeLayoutController()),
    'dockge-fn-obsolete': () => (typeof isDockgeHideObsolete === 'function' && isDockgeHideObsolete()) ? 'Show obsolete' : 'Hide obsolete',
    'caddy-fn-scroll':   () => _probesHorizontalScrollLabel('Horiz Scroll', () => _ensureCaddyLayoutController()),
    'vis-fn-scroll':     () => _probesHorizontalScrollLabel('Horiz Scroll', () => _ensureVisitsLayoutController()),
    'vis-fn-pagination': () => _visIsPaginationEnabled() ? 'Pagination: On' : 'Pagination: Off',
});

ProbesMenuConfig.registerVisibilityGetters({
    'dns-fn-expand': () => _probesExpandCollapseVisible(() => (typeof getPfSenseDnsExpansionState === 'function' ? getPfSenseDnsExpansionState() : null), 'expand'),
    'dns-fn-collapse': () => _probesExpandCollapseVisible(() => (typeof getPfSenseDnsExpansionState === 'function' ? getPfSenseDnsExpansionState() : null), 'collapse'),
    'pve-fn-expand': () => _probesExpandCollapseVisible(() => (typeof getProxmoxConfigExpansionState === 'function' ? getProxmoxConfigExpansionState() : null), 'expand'),
    'pve-fn-collapse': () => _probesExpandCollapseVisible(() => (typeof getProxmoxConfigExpansionState === 'function' ? getProxmoxConfigExpansionState() : null), 'collapse'),
    'dockge-fn-expand': () => _probesExpandCollapseVisible(() => (typeof getDockgeExpansionState === 'function' ? getDockgeExpansionState() : null), 'expand'),
    'dockge-fn-collapse': () => _probesExpandCollapseVisible(() => (typeof getDockgeExpansionState === 'function' ? getDockgeExpansionState() : null), 'collapse'),
});
