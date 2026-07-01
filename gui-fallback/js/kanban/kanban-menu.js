// kanban-menu.js - Split-dropdown navigation for the Kanban group
// xarta-node Blueprints GUI
//
// Thin wrapper around createHubMenu() (hub-menu.js).

'use strict';

const KanbanActionIcons = {
    refresh: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22M13 3a9 9 0 1 0 8.95 10h-2.02A7 7 0 1 1 12 5a6.97 6.97 0 0 1 4.24 1.43L13 10h8V2l-3.33 3.33A8.97 8.97 0 0 0 13 3z%22/%3E%3C/svg%3E',
    newItem: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z%22/%3E%3C/svg%3E',
    board: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z%22/%3E%3C/svg%3E',
    up: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22m7.4 14.6 4.6-4.6 4.6 4.6L18 13.2l-6-6-6 6 1.4 1.4zM5 19h14v-2H5v2z%22/%3E%3C/svg%3E',
    detail: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22M6 2h8l5 5v15H6V2zm7 1.5V8h4.5L13 3.5zM8 12h8v2H8v-2zm0 4h8v2H8v-2z%22/%3E%3C/svg%3E',
    orderUp: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22m12 7 7 7-1.4 1.4L12 9.8l-5.6 5.6L5 14l7-7z%22/%3E%3C/svg%3E',
    orderDown: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22m12 17-7-7 1.4-1.4 5.6 5.6 5.6-5.6L19 10l-7 7z%22/%3E%3C/svg%3E',
    left: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22m15.5 5-7 7 7 7 1.4-1.4L11.3 12l5.6-5.6L15.5 5z%22/%3E%3C/svg%3E',
    right: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22m8.5 19 7-7-7-7-1.4 1.4 5.6 5.6-5.6 5.6L8.5 19z%22/%3E%3C/svg%3E',
    archive: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22M4 4h16v5H4V4zm2 7h12v9H6v-9zm3 2v2h6v-2H9zM6 6v1h12V6H6z%22/%3E%3C/svg%3E',
    backup: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22M5 3h11l3 3v15H5V3zm2 2v5h9V7.2L13.8 5H7zm0 14h10v-6H7v6zm2-4h6v2H9v-2z%22/%3E%3C/svg%3E',
    automation: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22M4 19h16v2H4v-2zm2-8h3v6H6v-6zm5-5h3v11h-3V6zm5 8h3v3h-3v-3zM8.2 8.4 7 7.2 12 2l3.2 3.2L19.1 1 20.5 2.4l-5.3 5.4L12 4.6 8.2 8.4z%22/%3E%3C/svg%3E',
    shield: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3zm-1 14-4-4 1.4-1.4 2.6 2.6 5.6-5.6L18 9l-7 7z%22/%3E%3C/svg%3E',
    issue: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z%22/%3E%3C/svg%3E',
    todo: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22m9 16.2-3.5-3.5L4 14.2 9 19 20.5 7.5 19 6z%22/%3E%3C/svg%3E',
    search: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22black%22 d=%22M10 4a6 6 0 0 1 4.74 9.67l4.3 4.3-1.42 1.42-4.3-4.3A6 6 0 1 1 10 4zm0 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8z%22/%3E%3C/svg%3E',
};

function flashKanbanClipboardInvalid(button) {
    if (!button) return;
    (button._kanbanInvalidTimers || []).forEach(timer => window.clearTimeout(timer));
    button._kanbanInvalidTimers = [];
    button.classList.remove('is-invalid-fading');
    button.classList.add('is-invalid');
    button._kanbanInvalidTimers.push(window.setTimeout(() => {
        button.classList.add('is-invalid-fading');
    }, 2000));
    button._kanbanInvalidTimers.push(window.setTimeout(() => {
        button.classList.remove('is-invalid', 'is-invalid-fading');
        button._kanbanInvalidTimers = [];
    }, 3000));
}

async function openKanbanClipboardLink(button, context) {
    try {
        const text = await navigator.clipboard?.readText?.();
        const opener = window.BlueprintsKanbanBoardPage?.openKanbanLinkFromText;
        const opened = typeof opener === 'function' ? await opener(text) : false;
        if (opened) {
            if (context && typeof context.playItemSound === 'function') {
                context.playItemSound('kanban-open-clipboard-link');
            }
            if (context && typeof context.closeContextMenu === 'function') {
                context.closeContextMenu();
            }
            return;
        }
    } catch (_) {}
    flashKanbanClipboardInvalid(button);
}

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
    syncDefaultItemText: true,
    contextMenuColumns(activeId, items) {
        if (activeId !== 'kanban') return null;
        const byId = new Map((items || []).map(item => [item.id, item]));
        const groupedIds = [
            [
                'kanban-root-board',
                'kanban-up-board',
                'kanban-child-board',
                'kanban-detail',
                'kanban-move-left',
                'kanban-move-right',
                'kanban-order-up',
                'kanban-order-down',
            ],
            [
                'kanban-new-item',
                'kanban-add-child',
                'kanban-add-issue',
                'kanban-add-todo',
                'kanban-scoped-issues',
                'kanban-scoped-todos',
                'kanban-archive',
            ],
            [
                'kanban-refresh',
                'kanban-automation-status',
                'kanban-postgres',
                'kanban-safe-checks',
                'kanban-toggle-tests',
                'kanban-step18-proof',
                'kanban-step19-proof',
            ],
        ];
        const columns = groupedIds.map(ids => ids.map(id => byId.get(id)).filter(Boolean));
        columns[0].unshift({
            id: 'kanban-open-clipboard-link',
            label: 'Paste Kanban link',
            icon: KanbanActionIcons.search,
            contextMenuControl: 'kanban-clipboard-link',
        });
        const used = new Set(columns.flat().map(item => item.id));
        const leftovers = (items || []).filter(item => !used.has(item.id));
        if (leftovers.length) columns[columns.length - 1].push(...leftovers);
        return columns;
    },
    renderContextMenuItem(item, context) {
        if (!item || item.contextMenuControl !== 'kanban-clipboard-link') return null;
        const button = document.createElement('button');
        button.className = 'hub-context-link-opener';
        button.type = 'button';
        button.dataset.contextControl = item.contextMenuControl;
        button.setAttribute('aria-label', 'Open Kanban link from clipboard');
        button.innerHTML = `
            ${context.iconHtml(item.id, item.icon)}
            <span class="hub-context-link-opener__placeholder">${context.displayLabel(item)}</span>
        `;
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            openKanbanClipboardLink(button, context);
        });
        return button;
    },
    defaultMenu: [
        { id: 'kanban',        label: 'Kanban', icon: 'icons/ui/kanban-blue.svg', pageLabel: 'Kanban',        parent: null, order: 0 },
        { id: 'kanban-layout', label: '☰',      icon: 'icons/hieroglyphs/kheper-gold.svg', pageLabel: 'Navbar Layout', parent: null, order: 1 },
        { id: 'kanban-new-item', label: 'New Item', icon: KanbanActionIcons.newItem, pageLabel: 'New Kanban Item', parent: 'kanban-layout', order: 0, fn: 'kanban.newRootItem', activeOn: ['kanban'] },
        { id: 'kanban-refresh', label: 'Refresh', icon: KanbanActionIcons.refresh, pageLabel: 'Refresh Kanban', parent: 'kanban-layout', order: 1, fn: 'kanban.refresh', activeOn: ['kanban'] },
        { id: 'kanban-toggle-tests', label: 'Test Entries', icon: KanbanActionIcons.shield, pageLabel: 'Toggle Test Entries', parent: 'kanban-layout', order: 2, fn: 'kanban.toggleTestEntries', activeOn: ['kanban'] },
        { id: 'kanban-root-board', label: 'Open Root', icon: KanbanActionIcons.board, pageLabel: 'Open Root Board', parent: 'kanban-layout', order: 3, fn: 'kanban.openRootBoard', activeOn: ['kanban'] },
        { id: 'kanban-up-board', label: 'Open Parent', icon: KanbanActionIcons.up, pageLabel: 'Open Parent Board', parent: 'kanban-layout', order: 4, fn: 'kanban.openUpBoard', activeOn: ['kanban'] },
        { id: 'kanban-child-board', label: 'Open Child', icon: KanbanActionIcons.board, pageLabel: 'Open Selected Child Board', parent: 'kanban-layout', order: 5, fn: 'kanban.openChildBoard', activeOn: ['kanban'] },
        { id: 'kanban-detail', label: 'Open Detail', icon: KanbanActionIcons.detail, pageLabel: 'Open Selected Item Detail', parent: 'kanban-layout', order: 6, fn: 'kanban.openDetail', activeOn: ['kanban'] },
        { id: 'kanban-add-child', label: 'New Child', icon: KanbanActionIcons.newItem, pageLabel: 'New Child Item', parent: 'kanban-layout', order: 7, fn: 'kanban.addChild', activeOn: ['kanban'] },
        { id: 'kanban-add-issue', label: 'New Issue', icon: KanbanActionIcons.issue, pageLabel: 'New Issue For Item', parent: 'kanban-layout', order: 8, fn: 'kanban.addIssue', activeOn: ['kanban'] },
        { id: 'kanban-add-todo', label: 'New ToDo', icon: KanbanActionIcons.todo, pageLabel: 'New ToDo For Item', parent: 'kanban-layout', order: 9, fn: 'kanban.addTodo', activeOn: ['kanban'] },
        { id: 'kanban-scoped-issues', label: 'Show Issues', icon: KanbanActionIcons.issue, pageLabel: 'Show Selected Scoped Issues', parent: 'kanban-layout', order: 10, fn: 'kanban.scopedIssues', activeOn: ['kanban'] },
        { id: 'kanban-scoped-todos', label: 'Show ToDos', icon: KanbanActionIcons.todo, pageLabel: 'Show Selected Scoped ToDos', parent: 'kanban-layout', order: 11, fn: 'kanban.scopedTodos', activeOn: ['kanban'] },
        { id: 'kanban-order-up', label: 'Order Up', icon: KanbanActionIcons.orderUp, pageLabel: 'Move Selected Higher', parent: 'kanban-layout', order: 12, fn: 'kanban.orderUp', activeOn: ['kanban'] },
        { id: 'kanban-order-down', label: 'Order Down', icon: KanbanActionIcons.orderDown, pageLabel: 'Move Selected Lower', parent: 'kanban-layout', order: 13, fn: 'kanban.orderDown', activeOn: ['kanban'] },
        { id: 'kanban-move-left', label: 'Move Left', icon: KanbanActionIcons.left, pageLabel: 'Move Selected Left', parent: 'kanban-layout', order: 14, fn: 'kanban.moveLeft', activeOn: ['kanban'] },
        { id: 'kanban-move-right', label: 'Move Right', icon: KanbanActionIcons.right, pageLabel: 'Move Selected Right', parent: 'kanban-layout', order: 15, fn: 'kanban.moveRight', activeOn: ['kanban'] },
        { id: 'kanban-archive', label: 'Archive', icon: KanbanActionIcons.archive, pageLabel: 'Archive Selected Item', parent: 'kanban-layout', order: 16, fn: 'kanban.archive', activeOn: ['kanban'] },
        { id: 'kanban-postgres', label: 'Postgres', icon: KanbanActionIcons.backup, pageLabel: 'Kanban Postgres', parent: 'kanban-layout', order: 17, fn: 'kanban.postgres', activeOn: ['kanban'] },
        { id: 'kanban-automation-status', label: 'Automation Status', icon: KanbanActionIcons.automation, pageLabel: 'Kanban Automation Status', parent: 'kanban-layout', order: 18, fn: 'kanban.automationStatus', activeOn: ['kanban'] },
        { id: 'kanban-step18-proof', label: 'Write Detail Proof', icon: KanbanActionIcons.shield, pageLabel: 'Write Child And Detail Proof', parent: 'kanban-layout', order: 19, fn: 'kanban.step18ProofWrite', activeOn: ['kanban'] },
        { id: 'kanban-step19-proof', label: 'Write Scoped Proof', icon: KanbanActionIcons.shield, pageLabel: 'Write Scoped Issue And ToDo Proof', parent: 'kanban-layout', order: 20, fn: 'kanban.step19ProofWrite', activeOn: ['kanban'] },
        { id: 'kanban-safe-checks', label: 'Safe Checks', icon: KanbanActionIcons.shield, pageLabel: 'Kanban Safe Checks', parent: 'kanban-layout', order: 21, fn: 'kanban.safeChecks', activeOn: ['kanban'] },
    ],
});
