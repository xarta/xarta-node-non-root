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
        { id: 'calender',    label: 'Calender', icon: 'icons/ui/calender-blue.svg', pageLabel: 'Calender',      parent: 'diary', order: 0 },
        { id: 'todo',        label: 'ToDo',     icon: 'icons/ui/todo-blue.svg',     pageLabel: 'ToDo',          parent: 'diary', order: 1 },
        { id: 'imports',     label: 'Imports',  icon: 'icons/ui/imports-blue.svg',  pageLabel: 'Imports',       parent: null,    order: 1 },
        { id: 'dave-layout', label: '☰',        icon: 'icons/hieroglyphs/kheper-gold.svg', pageLabel: 'Navbar Layout', parent: null, order: 2 },
    ],
});
