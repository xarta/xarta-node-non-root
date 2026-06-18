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
    ],
});
