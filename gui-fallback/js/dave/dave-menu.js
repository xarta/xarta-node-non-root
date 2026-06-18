// dave-menu.js — Split-dropdown navigation for the Dave personal group
// xarta-node Blueprints GUI
//
// Thin wrapper around createHubMenu() (hub-menu.js).

'use strict';

const DaveMenuConfig = createHubMenu({
    storageKey:      'blueprintsDaveMenuConfig',
    group:           'dave',
    toggleId:        'daveMenuToggle',
    tabsId:          'daveHubTabs',
    currentLabelId:  'daveCurrentTabLabel',
    saveButtonId:    'daveMenuSaveButton',
    resetButtonId:   'daveMenuResetButton',
    editorListId:    'daveMenuEditorList',
    notificationId:  'daveMenuSaveNotification',
    resetConfirmMsg: 'Reset Dave navbar to default layout?',
    mobilePinnedId:  'dave-layout',
    pinnedTabsId:    'daveHubTabsPinned',
    defaultMenu: [
        { id: 'diary',       label: 'Diary',    icon: 'icons/ui/diary-blue.svg',    pageLabel: 'Diary',         parent: null,    order: 0 },
        { id: 'calender',    label: 'Calendar', icon: 'icons/ui/calender-blue.svg', pageLabel: 'Calendar',      parent: 'diary', order: 0 },
        { id: 'todo',        label: 'ToDo',     icon: 'icons/ui/todo-blue.svg',     pageLabel: 'ToDo',          parent: 'diary', order: 1 },
        { id: 'imports',     label: 'Imports',  icon: 'icons/ui/imports-blue.svg',  pageLabel: 'Imports',       parent: null,    order: 1 },
        { id: 'dave-layout', label: '☰',        icon: 'icons/hieroglyphs/kheper-gold.svg', pageLabel: 'Navbar Layout', parent: null, order: 2 },
        { id: 'imports-refresh', label: 'Refresh', icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22M13 3a9 9 0 1 0 8.95 10h-2.02A7 7 0 1 1 12 5a6.97 6.97 0 0 1 4.24 1.43L13 10h8V2l-3.33 3.33A8.97 8.97 0 0 0 13 3z%22/%3E%3C/svg%3E', pageLabel: 'Refresh Imports', parent: 'dave-layout', order: 0, fn: 'imports.refresh', activeOn: ['imports'] },
        { id: 'imports-source-doc', label: 'Open Source', icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22M6 2h8l5 5v15H6V2zm7 1.5V8h4.5L13 3.5zM8 12h8v2H8v-2zm0 4h8v2H8v-2z%22/%3E%3C/svg%3E', pageLabel: 'Open Imports Source', parent: 'dave-layout', order: 1, fn: 'imports.openInterestsDoc', activeOn: ['imports'] },
        { id: 'imports-latest-proof', label: 'Open Proof', icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22M5 3h14v18H5V3zm3 4h8v2H8V7zm0 4h8v2H8v-2zm0 4h5v2H8v-2z%22/%3E%3C/svg%3E', pageLabel: 'Open Latest Proof', parent: 'dave-layout', order: 2, fn: 'imports.openLatestProof', activeOn: ['imports'] },
        { id: 'imports-artifacts', label: 'Artifacts', icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22M4 5h6l2 2h8v12H4V5zm2 4v8h12V9H6z%22/%3E%3C/svg%3E', pageLabel: 'Open Artifacts', parent: 'dave-layout', order: 3, fn: 'imports.openArtifacts', activeOn: ['imports'] },
        { id: 'imports-blockers', label: 'Blockers', icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z%22/%3E%3C/svg%3E', pageLabel: 'Show Blockers', parent: 'dave-layout', order: 4, fn: 'imports.showBlockers', activeOn: ['imports'] },
        { id: 'imports-explain', label: 'Explain', icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22M11 18h2v-2h-2v2zm1-16a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm0-14a3 3 0 0 0-3 3h2a1 1 0 1 1 1 1c-1.1 0-2 .9-2 2v2h2v-2a3 3 0 0 0 0-6z%22/%3E%3C/svg%3E', pageLabel: 'Explain Status', parent: 'dave-layout', order: 5, fn: 'imports.explainStatus', activeOn: ['imports'] },
        { id: 'imports-safe-checks', label: 'Safe Checks', icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3zm-1 14-4-4 1.4-1.4 2.6 2.6 5.6-5.6L18 9l-7 7z%22/%3E%3C/svg%3E', pageLabel: 'Safe Status Checks', parent: 'dave-layout', order: 6, fn: 'imports.safeChecks', activeOn: ['imports'] },
        { id: 'imports-filter-all', label: 'Filter All', icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22M3 5h18v2H3V5zm4 6h10v2H7v-2zm3 6h4v2h-4v-2z%22/%3E%3C/svg%3E', pageLabel: 'Filter All Sources', parent: 'dave-layout', order: 7, fn: 'imports.filterAll', activeOn: ['imports'] },
        { id: 'imports-filter-interests', label: 'Filter Interests', icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22M12 3 2 12h3v8h14v-8h3L12 3zm0 3.7 4 3.6V18H8v-7.7l4-3.6z%22/%3E%3C/svg%3E', pageLabel: 'Filter Interests', parent: 'dave-layout', order: 8, fn: 'imports.filterInterests', activeOn: ['imports'] },
        { id: 'imports-filter-git', label: 'Filter Git', icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22M7 3a3 3 0 0 1 2.8 2H14a3 3 0 1 1 0 2H9.8A3 3 0 0 1 8 8.8v6.4A3 3 0 1 1 6 15.2V8.8A3 3 0 0 1 7 3zm10 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM7 5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm0 12a1 1 0 1 0 0 2 1 1 0 0 0 0-2z%22/%3E%3C/svg%3E', pageLabel: 'Filter Git', parent: 'dave-layout', order: 9, fn: 'imports.filterGit', activeOn: ['imports'] },
    ],
});
