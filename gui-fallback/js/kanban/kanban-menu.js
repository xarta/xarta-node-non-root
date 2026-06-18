// kanban-menu.js — Split-dropdown navigation for the Kanban work-management group
// xarta-node Blueprints GUI
//
// Thin wrapper around createHubMenu() (hub-menu.js).

'use strict';

const KanbanMenuConfig = createHubMenu({
    storageKey:      'blueprintsKanbanMenuConfig',
    group:           'kanban',
    toggleId:        'kanbanMenuToggle',
    tabsId:          'kanbanHubTabs',
    currentLabelId:  'kanbanCurrentTabLabel',
    saveButtonId:    'kanbanMenuSaveButton',
    resetButtonId:   'kanbanMenuResetButton',
    editorListId:    'kanbanMenuEditorList',
    notificationId:  'kanbanMenuSaveNotification',
    resetConfirmMsg: 'Reset Kanban navbar to default layout?',
    mobilePinnedId:  'kanban-layout',
    pinnedTabsId:    'kanbanHubTabsPinned',
    defaultMenu: [
        { id: 'kanban',        label: 'Kanban', icon: 'icons/ui/kanban-blue.svg', pageLabel: 'Kanban',        parent: null, order: 0 },
        { id: 'kanban-layout', label: '☰',      icon: 'icons/hieroglyphs/kheper-gold.svg', pageLabel: 'Navbar Layout', parent: null, order: 1 },
    ],
});
