// settings-menu.js — Split-dropdown navigation for the Settings group
// xarta-node Blueprints GUI
//
// Thin wrapper around createHubMenu() (hub-menu.js).
// Contains only the Settings-specific config, defaultMenu, and function registrations.
//
// localStorage key: 'blueprintsSettingsMenuConfig'
//
// Default groupings:
//   🗄 PVE Hosts  [▼ 🤝 Nodes, Local Dockge, VPS Dockge, 841 Dockge]
//   SSH Terminal [▼ target sessions from /api/v1/ssh-terminal/targets]
//   Agents        [▼ Hermes Local, Hermes VPS]
//   🔧 App Config [▼ 🗺 Manual ARP, 🤖 AI Providers]
//   🗝 Keys       [▼ 🔒 Certs]
//   📄 Docs       [▼ 📋 Doc List, 🖼️ Images, 🩺 Self Diagnostic]
//   ☰  (layout editor — standalone)
//
// No inline event handlers — all event wiring via addEventListener.

'use strict';

const SettingsMenuConfig = createHubMenu({
    storageKey:      'blueprintsSettingsMenuConfig',
    group:           'settings',
    toggleId:        'settingsMenuToggle',
    tabsId:          'settingsHubTabs',
    currentLabelId:  'settingsCurrentTabLabel',
    saveButtonId:    'settingsMenuSaveButton',
    resetButtonId:   'settingsMenuResetButton',
    editorListId:    'settingsMenuEditorList',
    notificationId:  'settingsMenuSaveNotification',
    resetConfirmMsg: 'Reset settings navbar to default layout?',
    // Mobile: the layout/context button is pinned outside the hamburger menu
    mobilePinnedId:  'settings-layout',
    pinnedTabsId:    'settingsHubTabsPinned',
    defaultMenu: [
        { id: 'pve-hosts',       label: 'PVE Hosts',      icon: 'icons/ui/proxmox-blue.svg', pageLabel: 'PVE Hosts',       parent: null,        order: 0 },
        { id: 'nodes',           label: 'Nodes',          icon: HIEROGLYPHS.crookFlail, pageLabel: 'Fleet Nodes',     parent: 'pve-hosts', order: 0 },
        { id: 'local-dockge',    label: 'Local Dockge',   icon: HIEROGLYPHS.pyramid,    pageLabel: 'Local Dockge',    parent: 'pve-hosts', order: 1 },
        { id: 'vps-dockge',      label: 'VPS Dockge',     icon: HIEROGLYPHS.naosShrine, pageLabel: 'VPS Dockge',      parent: 'pve-hosts', order: 2 },
        { id: 'lxc841-dockge',   label: '841 Dockge',     icon: HIEROGLYPHS.pyramid,    pageLabel: '841 Dockge',      parent: 'pve-hosts', order: 3 },
        { id: 'ssh-terminal',    label: 'SSH Terminal',   icon: HIEROGLYPHS.khaHorizon, pageLabel: 'SSH Terminal',    parent: null,        order: 1 },
        { id: 'agent-pages',     label: 'Agents',         icon: HIEROGLYPHS.falcon,     pageLabel: 'Agent Pages',     parent: null,        order: 2 },
        { id: 'hermes-local',    label: 'Hermes Local',   icon: HIEROGLYPHS.khaHorizon, pageLabel: 'Hermes Local',    parent: 'agent-pages', order: 0 },
        { id: 'hermes-vps',      label: 'Hermes VPS',     icon: HIEROGLYPHS.falcon,     pageLabel: 'Hermes VPS',      parent: 'agent-pages', order: 1 },
        { id: 'matrix-chat',     label: 'Chat',           icon: HIEROGLYPHS.papyrus,    pageLabel: 'Chat',            parent: 'agent-pages', order: 2 },
        { id: 'matrix-chat-admin', label: 'Chat Admin',   icon: HIEROGLYPHS.eyeOfHorus, pageLabel: 'Chat Admin',      parent: 'agent-pages', order: 3 },
        { id: 'settings',        label: 'App Config',     icon: HIEROGLYPHS.djedPillar, pageLabel: 'App Config',      parent: null,        order: 3 },
        { id: 'arp-manual',      label: 'Manual ARP',     icon: HIEROGLYPHS.obelisk,    pageLabel: 'Manual ARP',      parent: 'settings',  order: 0 },
        { id: 'ai-providers',    label: 'AI Providers',   icon: HIEROGLYPHS.falcon,     pageLabel: 'AI Providers',    parent: 'settings',  order: 1 },
        { id: 'mcp-servers',     label: 'MCP Servers',    icon: HIEROGLYPHS.nileWaves,  pageLabel: 'MCP Servers',     parent: 'settings',  order: 2 },
        { id: 'prompt-injection',label: 'Prompt Injection',icon: HIEROGLYPHS.tjet,      pageLabel: 'Prompt Injection',parent: 'settings',  order: 3 },
        { id: 'nav-items',       label: 'Nav Items',      icon: HIEROGLYPHS.naosShrine, pageLabel: 'Nav Items',       parent: 'settings',  order: 4 },
        { id: 'form-controls',   label: 'Form Controls',  icon: HIEROGLYPHS.adze,       pageLabel: 'Form Controls',   parent: 'settings',  order: 5 },
        { id: 'embed-menu',      label: 'Embed Menu',     icon: HIEROGLYPHS.kheper,     pageLabel: 'Embed Menu',      parent: 'settings',  order: 6 },
        { id: 'embed-menu-grid', label: 'Embed Menu Grid', icon: HIEROGLYPHS.cartouche,  pageLabel: 'Embed Menu Grid', parent: 'settings',  order: 7 },
        { id: 'keys',            label: 'Keys',           icon: HIEROGLYPHS.ankh,       pageLabel: 'SSH Keys',        parent: null,        order: 4 },
        { id: 'certs',           label: 'Certs',          icon: HIEROGLYPHS.shen,       pageLabel: 'Certificates',    parent: 'keys',      order: 0 },
        { id: 'docs',            label: 'Docs',           icon: HIEROGLYPHS.papyrus,    pageLabel: 'Docs',            parent: null,        order: 5 },
        { id: 'docs-list',       label: 'Doc List',       icon: HIEROGLYPHS.papyrus,    pageLabel: 'Doc List',        parent: 'docs',      order: 0 },
        { id: 'docs-images',     label: 'Images',         icon: HIEROGLYPHS.lotus,      pageLabel: 'Doc Images',      parent: 'docs',      order: 1 },
        { id: 'self-diag',       label: 'Self Diagnostic',icon: HIEROGLYPHS.eyeOfHorus, pageLabel: 'Self Diagnostic', parent: 'docs',      order: 2 },
        { id: 'settings-layout', label: '☰',              icon: HIEROGLYPHS.kheper,     pageLabel: 'Navbar Layout',   parent: null,        order: 6 },

        // ── PVE Hosts page function items ─────────────────────────────────
        { id: 'pveh-fn-refresh', label: 'Refresh',          icon: HIEROGLYPHS.nefer,      fn: 'pveh.refresh', activeOn: ['pve-hosts'],    parent: 'settings-layout', order: 0 },
        { id: 'pveh-fn-scan',    label: 'Scan for Proxmox', icon: HIEROGLYPHS.wasScepter, fn: 'pveh.scan',    activeOn: ['pve-hosts'],    parent: 'settings-layout', order: 1 },
        { id: 'pveh-fn-cols',    label: 'Columns',          icon: HIEROGLYPHS.khaHorizon, fn: 'pveh.columns', activeOn: ['pve-hosts'],    parent: 'settings-layout', order: 2 },
        { id: 'pveh-fn-scroll',  label: 'Horiz Scroll: Is Off', icon: 'icons/ui/table-columns-blue.svg', fn: 'pveh.scroll', activeOn: ['pve-hosts'], parent: 'settings-layout', order: 3 },
        { id: 'pveh-fn-autofit', label: 'Auto Fit Widths',  icon: 'icons/ui/table-columns-blue.svg', fn: 'pveh.autoFit', activeOn: ['pve-hosts'], parent: 'settings-layout', order: 4 },
        { id: 'pveh-fn-context', label: 'Layout Context',   icon: HIEROGLYPHS.eyeOfHorus, fn: 'pveh.context', activeOn: ['pve-hosts'],    parent: 'settings-layout', order: 5 },

        // ── Fleet Nodes page function items ───────────────────────────────
        { id: 'nod-fn-refresh',  label: 'Refresh',          icon: HIEROGLYPHS.nefer,      fn: 'nod.refresh',  activeOn: ['nodes'],        parent: 'settings-layout', order: 0 },
        { id: 'nod-fn-cols',     label: 'Columns',          icon: HIEROGLYPHS.khaHorizon, fn: 'nod.columns',  activeOn: ['nodes'],        parent: 'settings-layout', order: 1 },
        { id: 'nod-fn-bkpcols',  label: 'Backup Columns',   icon: HIEROGLYPHS.khaHorizon, fn: 'nod.backupColumns', activeOn: ['nodes'],   parent: 'settings-layout', order: 2 },
        { id: 'nod-fn-update',   label: 'Fleet Update',     icon: HIEROGLYPHS.crookFlail, fn: 'nod.update',   activeOn: ['nodes'],        parent: 'settings-layout', order: 3 },
        { id: 'nod-fn-scroll',   label: 'Horiz Scroll: Is Off', icon: 'icons/ui/table-columns-blue.svg', fn: 'nod.scroll', activeOn: ['nodes'], parent: 'settings-layout', order: 4 },
        { id: 'nod-fn-autofit',  label: 'Auto Fit Widths',  icon: 'icons/ui/table-columns-blue.svg', fn: 'nod.autoFit', activeOn: ['nodes'], parent: 'settings-layout', order: 5 },
        { id: 'nod-fn-context',  label: 'Layout Context',   icon: HIEROGLYPHS.eyeOfHorus, fn: 'nod.context',  activeOn: ['nodes'],        parent: 'settings-layout', order: 6 },
        { id: 'bkp-fn-context',  label: 'Backup Layout Context', icon: HIEROGLYPHS.eyeOfHorus, fn: 'bkp.context', activeOn: ['nodes'],   parent: 'settings-layout', order: 7 },

        // ── App Config page function items ────────────────────────────────
        { id: 'cfg-fn-add',      label: 'Add setting',      icon: HIEROGLYPHS.djedPillar, fn: 'cfg.add',      activeOn: ['settings'],     parent: 'settings-layout', order: 0 },
        { id: 'cfg-fn-refresh',  label: 'Refresh',          icon: HIEROGLYPHS.nefer,      fn: 'cfg.refresh',  activeOn: ['settings'],     parent: 'settings-layout', order: 1 },
        { id: 'cfg-fn-cols',     label: 'Columns',          icon: HIEROGLYPHS.khaHorizon, fn: 'cfg.columns',  activeOn: ['settings'],     parent: 'settings-layout', order: 2 },
        { id: 'cfg-fn-cache',    label: 'Refresh UI',       icon: HIEROGLYPHS.nefer,      fn: 'cfg.cache',    activeOn: ['settings'],     parent: 'settings-layout', order: 3 },
        { id: 'cfg-fn-scroll',   label: 'Horiz Scroll: Is Off', icon: 'icons/ui/table-columns-blue.svg', fn: 'cfg.scroll', activeOn: ['settings'], parent: 'settings-layout', order: 4 },
        { id: 'cfg-fn-autofit',  label: 'Auto Fit Widths',  icon: 'icons/ui/table-columns-blue.svg', fn: 'cfg.autoFit', activeOn: ['settings'], parent: 'settings-layout', order: 5 },
        { id: 'cfg-fn-context',  label: 'Layout Context',   icon: HIEROGLYPHS.eyeOfHorus, fn: 'cfg.context',  activeOn: ['settings'],     parent: 'settings-layout', order: 6 },

        // ── Local Dockge page function items ─────────────────────────────
        { id: 'ldg-fn-refresh',  label: 'Refresh',          icon: HIEROGLYPHS.nefer,      fn: 'ldg.refresh',  activeOn: ['local-dockge'], parent: 'settings-layout', order: 0 },
        { id: 'vdg-fn-refresh',  label: 'Refresh',          icon: HIEROGLYPHS.nefer,      fn: 'vdg.refresh',  activeOn: ['vps-dockge'], parent: 'settings-layout', order: 0 },
        { id: 'l841-fn-refresh', label: 'Refresh',          icon: HIEROGLYPHS.nefer,      fn: 'l841.refresh', activeOn: ['lxc841-dockge'], parent: 'settings-layout', order: 0 },
        { id: 'ssh-fn-agent',    label: 'Agent',             icon: HIEROGLYPHS.khaHorizon, fn: 'ssh.agent', activeOn: ['ssh-terminal'], parent: 'settings-layout', order: 0 },
        { id: 'ssh-fn-setup',    label: 'Setup',             icon: HIEROGLYPHS.djedPillar, fn: 'ssh.setup', activeOn: ['ssh-terminal'], parent: 'settings-layout', order: 1 },
        { id: 'ssh-fn-disconnect', label: 'Disconnect',      icon: HIEROGLYPHS.tjet,       fn: 'ssh.disconnect', activeOn: ['ssh-terminal'], parent: 'settings-layout', order: 2 },
        { id: 'ssh-fn-fullscreen', label: 'Full Screen',     icon: HIEROGLYPHS.khaHorizon, fn: 'ssh.fullscreen', activeOn: ['ssh-terminal'], parent: 'settings-layout', order: 3 },
        { id: 'ssh-fn-lock',     label: 'Lock',              icon: HIEROGLYPHS.shen,       fn: 'ssh.lock', activeOn: ['ssh-terminal'], parent: 'settings-layout', order: 4 },

        // ── Agent Pages function items ────────────────────────────────────
        { id: 'agent-fn-refresh', label: 'Refresh Page',      icon: HIEROGLYPHS.nefer,      fn: 'agent.refresh', activeOn: ['hermes-local', 'hermes-vps'], parent: 'settings-layout', order: 0 },
        { id: 'agent-fn-open',    label: 'Open Dashboard',    icon: HIEROGLYPHS.khaHorizon, fn: 'agent.open',    activeOn: ['hermes-local', 'hermes-vps'], parent: 'settings-layout', order: 1 },
        { id: 'agent-fn-terminal',label: 'Container Shell',   icon: HIEROGLYPHS.ankh,       fn: 'agent.terminal',activeOn: ['hermes-local', 'hermes-vps'], parent: 'settings-layout', order: 2 },
        { id: 'agent-fn-tui',     label: 'Agent TUI',         icon: HIEROGLYPHS.falcon,     fn: 'agent.tui',     activeOn: ['hermes-local', 'hermes-vps'], parent: 'settings-layout', order: 3 },
        { id: 'agent-fn-setup',   label: 'Setup',             icon: HIEROGLYPHS.djedPillar, fn: 'agent.setup',   activeOn: ['hermes-local', 'hermes-vps'], parent: 'settings-layout', order: 4 },
        { id: 'chat-fn-refresh',  label: 'Refresh Chat',      icon: HIEROGLYPHS.nefer,      fn: 'chat.refresh',  activeOn: ['matrix-chat'], parent: 'settings-layout', order: 0 },
        { id: 'chat-fn-mention',  label: 'Mention Hermes',    icon: HIEROGLYPHS.falcon,     fn: 'chat.mention',  activeOn: ['matrix-chat'], parent: 'settings-layout', order: 1 },
        { id: 'chat-fn-send',     label: 'Send Message',      icon: HIEROGLYPHS.khaHorizon, fn: 'chat.send',     activeOn: ['matrix-chat'], parent: 'settings-layout', order: 2 },
        { id: 'chat-fn-voice-mode', label: 'Voice Mode',       icon: 'icons/ui/microphone-blue.svg', fn: 'chat.voiceMode', activeOn: ['matrix-chat'], parent: 'settings-layout', order: 3 },
        { id: 'chat-fn-noise-tests', label: 'Noise Tests',     icon: 'icons/ui/microphone-blue.svg', fn: 'chat.noiseTests', activeOn: ['matrix-chat'], parent: 'settings-layout', order: 4 },
        { id: 'chat-fn-vad-dev', label: 'VAD Dev',             icon: 'icons/ui/microphone-blue.svg', fn: 'chat.vadDev', activeOn: ['matrix-chat'], parent: 'settings-layout', order: 5 },
        { id: 'chat-fn-wake-dev', label: 'Wake Dev',           icon: 'icons/ui/microphone-blue.svg', fn: 'chat.wakeDev', activeOn: ['matrix-chat'], parent: 'settings-layout', order: 6 },
        { id: 'chat-fn-notifier', label: 'Notification Controls', icon: HIEROGLYPHS.shen,    fn: 'chat.notifier', activeOn: ['matrix-chat'], parent: 'settings-layout', order: 7 },
        { id: 'chat-fn-notifier-tests', label: 'Notification Tests', icon: HIEROGLYPHS.eyeOfHorus, fn: 'chat.notifierTests', activeOn: ['matrix-chat'], parent: 'settings-layout', order: 8 },
        { id: 'chat-admin-fn-refresh', label: 'Refresh Admin', icon: HIEROGLYPHS.nefer,     fn: 'chatAdmin.refresh', activeOn: ['matrix-chat-admin'], parent: 'settings-layout', order: 0 },

        // ── Manual ARP page function items ────────────────────────────────
        { id: 'arp-fn-add',      label: 'Add entry',        icon: HIEROGLYPHS.obelisk,    fn: 'arp.add',      activeOn: ['arp-manual'],   parent: 'settings-layout', order: 0 },
        { id: 'arp-fn-refresh',  label: 'Refresh',          icon: HIEROGLYPHS.nefer,      fn: 'arp.refresh',  activeOn: ['arp-manual'],   parent: 'settings-layout', order: 1 },
        { id: 'arp-fn-cols',     label: 'Columns',          icon: HIEROGLYPHS.khaHorizon, fn: 'arp.columns',  activeOn: ['arp-manual'],   parent: 'settings-layout', order: 2 },
        { id: 'arp-fn-scroll',   label: 'Horiz Scroll: Is Off', icon: 'icons/ui/table-columns-blue.svg', fn: 'arp.scroll', activeOn: ['arp-manual'], parent: 'settings-layout', order: 3 },
        { id: 'arp-fn-autofit',  label: 'Auto Fit Widths',  icon: 'icons/ui/table-columns-blue.svg', fn: 'arp.autoFit', activeOn: ['arp-manual'], parent: 'settings-layout', order: 4 },
        { id: 'arp-fn-context',  label: 'Layout Context',   icon: HIEROGLYPHS.eyeOfHorus, fn: 'arp.context',  activeOn: ['arp-manual'],   parent: 'settings-layout', order: 5 },

        // ── AI Providers page function items ──────────────────────────────
        { id: 'ai-fn-addprov',   label: 'Add provider',     icon: HIEROGLYPHS.falcon,     fn: 'ai.addProv',      activeOn: ['ai-providers'], parent: 'settings-layout', order: 0 },
        { id: 'ai-fn-refresh',   label: 'Refresh',          icon: HIEROGLYPHS.nefer,      fn: 'ai.refresh',      activeOn: ['ai-providers'], parent: 'settings-layout', order: 1 },
        { id: 'ai-fn-addassign', label: 'Add assignment',   icon: HIEROGLYPHS.falcon,     fn: 'ai.addAssign',    activeOn: ['ai-providers'], parent: 'settings-layout', order: 2 },
        { id: 'ai-fn-provcols',  label: 'Provider columns', icon: HIEROGLYPHS.khaHorizon, fn: 'ai.providerCols', activeOn: ['ai-providers'], parent: 'settings-layout', order: 3 },
        { id: 'ai-fn-assigncols',label: 'Assignment columns', icon: HIEROGLYPHS.khaHorizon, fn: 'ai.assignCols', activeOn: ['ai-providers'], parent: 'settings-layout', order: 4 },
        { id: 'ai-fn-provscroll', label: 'Provider Scroll: Is Off', icon: 'icons/ui/table-columns-blue.svg', fn: 'ai.providerScroll', activeOn: ['ai-providers'], parent: 'settings-layout', order: 5 },
        { id: 'ai-fn-assignscroll', label: 'Assignment Scroll: Is Off', icon: 'icons/ui/table-columns-blue.svg', fn: 'ai.assignScroll', activeOn: ['ai-providers'], parent: 'settings-layout', order: 6 },
        { id: 'ai-fn-autofit',  label: 'Auto Fit Widths', icon: 'icons/ui/table-columns-blue.svg', fn: 'ai.autoFit', activeOn: ['ai-providers'], parent: 'settings-layout', order: 7 },
        { id: 'ai-fn-provcontext',  label: 'Provider Context',  icon: HIEROGLYPHS.eyeOfHorus, fn: 'ai.providerContext',  activeOn: ['ai-providers'], parent: 'settings-layout', order: 8 },
        { id: 'ai-fn-assigncontext', label: 'Assignment Context', icon: HIEROGLYPHS.eyeOfHorus, fn: 'ai.assignContext',  activeOn: ['ai-providers'], parent: 'settings-layout', order: 9 },

        // ── Docs page function items ───────────────────────────────────────
        { id: 'doc-fn-reload',   label: 'Reload',           icon: HIEROGLYPHS.nefer,      fn: 'doc.reload',   activeOn: ['docs'],         parent: 'settings-layout', order: 0 },
        { id: 'doc-fn-search',   label: 'Search',           icon: HIEROGLYPHS.eyeOfHorus, fn: 'doc.search',   activeOn: ['docs'],         parent: 'settings-layout', order: 1 },
        { id: 'doc-fn-new',      label: 'New Doc',          icon: HIEROGLYPHS.papyrus,    fn: 'doc.new',      activeOn: ['docs'],         parent: 'settings-layout', order: 2 },
        { id: 'doc-fn-add',      label: 'Add Existing',     icon: 'icons/ui/group-folder-blue.svg', fn: 'doc.add', activeOn: ['docs'], parent: 'settings-layout', order: 3 },
        { id: 'doc-fn-preview',  label: 'Edit / Preview',   icon: HIEROGLYPHS.khaHorizon, fn: 'doc.preview',  activeOn: ['docs'],         parent: 'settings-layout', order: 4 },
        { id: 'doc-fn-frontmatter', label: 'Frontmatter: Hidden', icon: HIEROGLYPHS.eyeOfHorus, fn: 'doc.frontmatter', activeOn: ['docs'], parent: 'settings-layout', order: 5 },
        { id: 'doc-fn-save',     label: 'Save',             icon: HIEROGLYPHS.tjet,       fn: 'doc.save',     activeOn: ['docs'],         parent: 'settings-layout', order: 6 },
        { id: 'doc-fn-meta',     label: 'Meta',             icon: HIEROGLYPHS.papyrus,    fn: 'doc.meta',     activeOn: ['docs'],         parent: 'settings-layout', order: 7 },
        { id: 'doc-fn-delete',   label: 'Delete',           icon: 'icons/ui/trash-blue.svg', fn: 'doc.delete', activeOn: ['docs'], parent: 'settings-layout', order: 8 },

        // ── Doc List page function items ───────────────────────────────────
        { id: 'dlist-fn-addgrp', label: 'Add Group',        icon: HIEROGLYPHS.papyrus,    fn: 'dlist.addGrp', activeOn: ['docs-list'],    parent: 'settings-layout', order: 0 },

        // ── Self Diagnostic page function items ────────────────────────────
        { id: 'diag-fn-run',     label: 'Run Diagnostics',  icon: HIEROGLYPHS.wasScepter, fn: 'diag.run',     activeOn: ['self-diag'],    parent: 'settings-layout', order: 0 },
        { id: 'diag-fn-buckets', label: 'Bucket Probe (quick)', icon: 'icons/ui/table-columns-blue.svg', fn: 'diag.bucketQuick', activeOn: ['self-diag'], parent: 'settings-layout', order: 1 },

        // ── SSH Keys page function items ─────────────────────────────────
        { id: 'key-fn-refresh',  label: 'Refresh',           icon: HIEROGLYPHS.nefer,      fn: 'key.refresh',  activeOn: ['keys'],         parent: 'settings-layout', order: 0 },
        { id: 'key-fn-cols',     label: 'Columns',           icon: HIEROGLYPHS.khaHorizon, fn: 'key.columns',  activeOn: ['keys'],         parent: 'settings-layout', order: 1 },
        { id: 'key-fn-scroll',   label: 'Horiz Scroll: Is Off', icon: 'icons/ui/table-columns-blue.svg', fn: 'key.scroll', activeOn: ['keys'], parent: 'settings-layout', order: 2 },
        { id: 'key-fn-autofit',  label: 'Auto Fit Widths',   icon: 'icons/ui/table-columns-blue.svg', fn: 'key.autoFit', activeOn: ['keys'], parent: 'settings-layout', order: 3 },
        { id: 'key-fn-context',  label: 'Layout Context',    icon: HIEROGLYPHS.eyeOfHorus, fn: 'key.context',  activeOn: ['keys'],         parent: 'settings-layout', order: 4 },

        // ── Certificates page function items ─────────────────────────────
        { id: 'cert-fn-refresh', label: 'Refresh',           icon: HIEROGLYPHS.nefer,      fn: 'cert.refresh', activeOn: ['certs'],        parent: 'settings-layout', order: 0 },
        { id: 'cert-fn-cols',    label: 'Columns',           icon: HIEROGLYPHS.khaHorizon, fn: 'cert.columns', activeOn: ['certs'],        parent: 'settings-layout', order: 1 },
        { id: 'cert-fn-scroll',  label: 'Horiz Scroll: Is Off', icon: 'icons/ui/table-columns-blue.svg', fn: 'cert.scroll', activeOn: ['certs'], parent: 'settings-layout', order: 2 },
        { id: 'cert-fn-autofit', label: 'Auto Fit Widths',   icon: 'icons/ui/table-columns-blue.svg', fn: 'cert.autoFit', activeOn: ['certs'], parent: 'settings-layout', order: 3 },
        { id: 'cert-fn-context', label: 'Layout Context',    icon: HIEROGLYPHS.eyeOfHorus, fn: 'cert.context', activeOn: ['certs'],        parent: 'settings-layout', order: 4 },

        // ── Nav Items page function items ──────────────────────────────────
        { id: 'ni-fn-refresh',   label: 'Refresh',           icon: HIEROGLYPHS.nefer,      fn: 'ni.refresh',   activeOn: ['nav-items'], parent: 'settings-layout', order: 0 },
        { id: 'ni-fn-cols',      label: 'Columns',           icon: HIEROGLYPHS.khaHorizon, fn: 'ni.columns',   activeOn: ['nav-items'], parent: 'settings-layout', order: 1 },
        { id: 'ni-fn-explore-icons', label: 'Explore Icons', icon: 'icons/ui/group-folder-blue.svg', fn: 'ni.exploreIcons', activeOn: ['nav-items'], parent: 'settings-layout', order: 2 },
        { id: 'ni-fn-explore-sounds', label: 'Explore Sounds', icon: 'icons/ui/group-folder-blue.svg', fn: 'ni.exploreSounds', activeOn: ['nav-items'], parent: 'settings-layout', order: 3 },
        { id: 'ni-fn-scroll',    label: 'Horiz Scroll: Is Off', icon: 'icons/ui/table-columns-blue.svg', fn: 'ni.scroll', activeOn: ['nav-items'], parent: 'settings-layout', order: 4 },
        { id: 'ni-fn-autofit',   label: 'Auto Fit Widths',   icon: 'icons/ui/table-columns-blue.svg', fn: 'ni.autoFit', activeOn: ['nav-items'], parent: 'settings-layout', order: 5 },
        { id: 'ni-fn-context',   label: 'Layout Context',    icon: HIEROGLYPHS.eyeOfHorus, fn: 'ni.context',   activeOn: ['nav-items'], parent: 'settings-layout', order: 6 },
        // ── Form Controls page function items ────────────────────────────────
        { id: 'fc-fn-refresh',   label: 'Refresh',           icon: HIEROGLYPHS.nefer,      fn: 'fc.refresh',   activeOn: ['form-controls'], parent: 'settings-layout', order: 0 },
        { id: 'fc-fn-add',       label: 'Add Key',           icon: 'icons/ui/plus-blue.svg', fn: 'fc.add',     activeOn: ['form-controls'], parent: 'settings-layout', order: 1 },
        { id: 'fc-fn-cols',      label: 'Columns',           icon: HIEROGLYPHS.khaHorizon, fn: 'fc.columns',   activeOn: ['form-controls'], parent: 'settings-layout', order: 2 },
        { id: 'fc-fn-explore-icons', label: 'Explore Icons', icon: 'icons/ui/group-folder-blue.svg', fn: 'fc.exploreIcons', activeOn: ['form-controls'], parent: 'settings-layout', order: 3 },
        { id: 'fc-fn-explore-sounds', label: 'Explore Sounds', icon: 'icons/ui/group-folder-blue.svg', fn: 'fc.exploreSounds', activeOn: ['form-controls'], parent: 'settings-layout', order: 4 },
        { id: 'fc-fn-scroll',    label: 'Horiz Scroll: Is Off', icon: 'icons/ui/table-columns-blue.svg', fn: 'fc.scroll', activeOn: ['form-controls'], parent: 'settings-layout', order: 5 },
        { id: 'fc-fn-autofit',   label: 'Auto Fit Widths',   icon: 'icons/ui/table-columns-blue.svg', fn: 'fc.autoFit', activeOn: ['form-controls'], parent: 'settings-layout', order: 6 },
        { id: 'fc-fn-context',   label: 'Layout Context',    icon: HIEROGLYPHS.eyeOfHorus, fn: 'fc.context',   activeOn: ['form-controls'], parent: 'settings-layout', order: 7 },

        // ── Embed Menu page function items ─────────────────────────────────
        { id: 'em-fn-refresh',   label: 'Refresh',           icon: HIEROGLYPHS.nefer,      fn: 'em.refresh',      activeOn: ['embed-menu'], parent: 'settings-layout', order: 0 },
        { id: 'em-fn-cols',      label: 'Columns',           icon: HIEROGLYPHS.khaHorizon, fn: 'em.columns',      activeOn: ['embed-menu'], parent: 'settings-layout', order: 1 },
        { id: 'em-fn-explore-icons', label: 'Explore Icons', icon: 'icons/ui/group-folder-blue.svg', fn: 'em.exploreIcons', activeOn: ['embed-menu'], parent: 'settings-layout', order: 2 },
        { id: 'em-fn-explore-sounds', label: 'Explore Sounds', icon: 'icons/ui/group-folder-blue.svg', fn: 'em.exploreSounds', activeOn: ['embed-menu'], parent: 'settings-layout', order: 3 },
        { id: 'em-fn-autofit',   label: 'Auto Fit Widths',   icon: 'icons/ui/table-columns-blue.svg', fn: 'em.autoFit', activeOn: ['embed-menu'], parent: 'settings-layout', order: 4 },
        { id: 'em-fn-context',   label: 'Layout Context',    icon: HIEROGLYPHS.eyeOfHorus, fn: 'em.context',      activeOn: ['embed-menu'], parent: 'settings-layout', order: 5 },

        // ── Embed Menu Grid page function items ───────────────────────────
        { id: 'emg-fn-refresh',  label: 'Refresh',           icon: HIEROGLYPHS.nefer,      fn: 'em.refresh',      activeOn: ['embed-menu-grid'], parent: 'settings-layout', order: 0 },
        { id: 'emg-fn-explore-icons',  label: 'Explore Icons',  icon: 'icons/ui/group-folder-blue.svg', fn: 'em.exploreIcons',  activeOn: ['embed-menu-grid'], parent: 'settings-layout', order: 1 },
        { id: 'emg-fn-explore-sounds', label: 'Explore Sounds', icon: 'icons/ui/group-folder-blue.svg', fn: 'em.exploreSounds', activeOn: ['embed-menu-grid'], parent: 'settings-layout', order: 2 },
    ],
});

// Browser-layout migration for Dockge pages under PVE Hosts. Existing saved
// menus preserve user-edited parent/order fields and can miss new defaults.
(function migrateLocalDockgePlacement() {
    const migrationKey = 'blueprintsSettingsMenuDockgePveMigration20260514';
    const originalLoadConfig = SettingsMenuConfig.loadConfig.bind(SettingsMenuConfig);
    SettingsMenuConfig.loadConfig = function loadConfigWithLocalDockgeMigration() {
        originalLoadConfig();
        if (localStorage.getItem(migrationKey) === '1') return;
        const item = this.currentMenu.find(entry => entry.id === 'local-dockge');
        if (item) {
            item.parent = 'pve-hosts';
            item.order = 1;
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.currentMenu));
        }
        if (!this.currentMenu.some(entry => entry.id === 'vps-dockge')) {
            const def = this.defaultMenu.find(entry => entry.id === 'vps-dockge');
            if (def) this.currentMenu.push({ ...def });
        }
        if (!this.currentMenu.some(entry => entry.id === 'vdg-fn-refresh')) {
            const def = this.defaultMenu.find(entry => entry.id === 'vdg-fn-refresh');
            if (def) this.currentMenu.push({ ...def });
        }
        if (!this.currentMenu.some(entry => entry.id === 'ssh-terminal')) {
            const def = this.defaultMenu.find(entry => entry.id === 'ssh-terminal');
            if (def) this.currentMenu.push({ ...def });
        }
        const vpsItem = this.currentMenu.find(entry => entry.id === 'vps-dockge');
        if (vpsItem) {
            vpsItem.parent = 'pve-hosts';
            vpsItem.order = 2;
        }
        const terminalItem = this.currentMenu.find(entry => entry.id === 'ssh-terminal');
        if (terminalItem) {
            terminalItem.parent = null;
            terminalItem.order = 1;
            terminalItem.label = 'SSH Terminal';
            terminalItem.pageLabel = 'SSH Terminal';
        }
        const agentItem = this.currentMenu.find(entry => entry.id === 'agent-pages');
        if (agentItem) {
            agentItem.parent = null;
            agentItem.order = 2;
        }
        const hermesItem = this.currentMenu.find(entry => entry.id === 'hermes-local');
        if (hermesItem) {
            hermesItem.parent = 'agent-pages';
            hermesItem.order = 0;
        }
        const hermesVpsItem = this.currentMenu.find(entry => entry.id === 'hermes-vps');
        if (hermesVpsItem) {
            hermesVpsItem.parent = 'agent-pages';
            hermesVpsItem.order = 1;
        }
        const settingsItem = this.currentMenu.find(entry => entry.id === 'settings');
        if (settingsItem && !settingsItem.parent) settingsItem.order = 3;
        const keysItem = this.currentMenu.find(entry => entry.id === 'keys');
        if (keysItem && !keysItem.parent) keysItem.order = 4;
        const docsItem = this.currentMenu.find(entry => entry.id === 'docs');
        if (docsItem && !docsItem.parent) docsItem.order = 5;
        const layoutItem = this.currentMenu.find(entry => entry.id === 'settings-layout');
        if (layoutItem && !layoutItem.parent) layoutItem.order = 6;
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.currentMenu));
        localStorage.setItem(migrationKey, '1');
    };
})();

(function migrateLxc841DockgeMenuItem() {
    const migrationKey = 'blueprintsSettingsMenuLxc841Dockge20260526';
    const originalLoadConfig = SettingsMenuConfig.loadConfig.bind(SettingsMenuConfig);
    SettingsMenuConfig.loadConfig = function loadConfigWithLxc841DockgeMigration() {
        originalLoadConfig();
        if (localStorage.getItem(migrationKey) === '1') return;
        for (const id of ['lxc841-dockge', 'l841-fn-refresh']) {
            if (!this.currentMenu.some(entry => entry.id === id)) {
                const def = this.defaultMenu.find(entry => entry.id === id);
                if (def) this.currentMenu.push({ ...def });
            }
        }
        const item = this.currentMenu.find(entry => entry.id === 'lxc841-dockge');
        if (item) {
            item.parent = 'pve-hosts';
            item.order = 3;
            item.label = '841 Dockge';
            item.pageLabel = '841 Dockge';
        }
        const fn = this.currentMenu.find(entry => entry.id === 'l841-fn-refresh');
        if (fn) {
            fn.parent = 'settings-layout';
            fn.order = 0;
            fn.activeOn = ['lxc841-dockge'];
        }
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.currentMenu));
        localStorage.setItem(migrationKey, '1');
    };
})();

(function migrateChatNotifierTestsMenuItem() {
    const migrationKey = 'blueprintsSettingsMenuChatNotifierTests20260521';
    const originalLoadConfig = SettingsMenuConfig.loadConfig.bind(SettingsMenuConfig);
    SettingsMenuConfig.loadConfig = function loadConfigWithNotifierTestsMigration() {
        originalLoadConfig();
        if (localStorage.getItem(migrationKey) === '1') return;
        const def = this.defaultMenu.find(entry => entry.id === 'chat-fn-notifier-tests');
        if (def && !this.currentMenu.some(entry => entry.id === def.id)) {
            this.currentMenu.push({ ...def });
        }
        const controls = this.currentMenu.find(entry => entry.id === 'chat-fn-notifier');
        const tests = this.currentMenu.find(entry => entry.id === 'chat-fn-notifier-tests');
        if (controls) controls.order = 3;
        if (tests) {
            tests.parent = 'settings-layout';
            tests.order = 4;
            tests.activeOn = ['matrix-chat'];
        }
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.currentMenu));
        localStorage.setItem(migrationKey, '1');
    };
})();

(function migrateChatVoiceModeMenuItem() {
    const migrationKey = 'blueprintsSettingsMenuChatVoiceMode20260526';
    const originalLoadConfig = SettingsMenuConfig.loadConfig.bind(SettingsMenuConfig);
    SettingsMenuConfig.loadConfig = function loadConfigWithChatVoiceModeMigration() {
        originalLoadConfig();
        if (localStorage.getItem(migrationKey) === '1') return;
        ['chat-fn-voice-mode', 'chat-fn-notifier', 'chat-fn-notifier-tests'].forEach(id => {
            const def = this.defaultMenu.find(entry => entry.id === id);
            if (!def) return;
            const existing = this.currentMenu.find(entry => entry.id === id);
            if (existing) {
                existing.label = def.label;
                existing.icon = def.icon;
                existing.parent = def.parent;
                existing.order = def.order;
                existing.fn = def.fn;
                existing.activeOn = def.activeOn;
            } else {
                this.currentMenu.push({ ...def });
            }
        });
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.currentMenu));
        localStorage.setItem(migrationKey, '1');
    };
})();

(function migrateChatNoiseTestsMenuItem() {
    const migrationKey = 'blueprintsSettingsMenuChatNoiseTests20260526';
    const originalLoadConfig = SettingsMenuConfig.loadConfig.bind(SettingsMenuConfig);
    SettingsMenuConfig.loadConfig = function loadConfigWithChatNoiseTestsMigration() {
        originalLoadConfig();
        if (localStorage.getItem(migrationKey) === '1') return;
        ['chat-fn-voice-mode', 'chat-fn-noise-tests', 'chat-fn-notifier', 'chat-fn-notifier-tests'].forEach(id => {
            const def = this.defaultMenu.find(entry => entry.id === id);
            if (!def) return;
            const existing = this.currentMenu.find(entry => entry.id === id);
            if (existing) {
                existing.label = def.label;
                existing.icon = def.icon;
                existing.parent = def.parent;
                existing.order = def.order;
                existing.fn = def.fn;
                existing.activeOn = def.activeOn;
            } else {
                this.currentMenu.push({ ...def });
            }
        });
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.currentMenu));
        localStorage.setItem(migrationKey, '1');
    };
})();

(function migrateChatVadDevMenuItem() {
    const migrationKey = 'blueprintsSettingsMenuChatVadDev20260530';
    const originalLoadConfig = SettingsMenuConfig.loadConfig.bind(SettingsMenuConfig);
    SettingsMenuConfig.loadConfig = function loadConfigWithChatVadDevMigration() {
        originalLoadConfig();
        if (localStorage.getItem(migrationKey) === '1') return;
        [
            'chat-fn-voice-mode',
            'chat-fn-noise-tests',
            'chat-fn-vad-dev',
            'chat-fn-wake-dev',
            'chat-fn-notifier',
            'chat-fn-notifier-tests',
        ].forEach(id => {
            const def = this.defaultMenu.find(entry => entry.id === id);
            if (!def) return;
            const existing = this.currentMenu.find(entry => entry.id === id);
            if (existing) {
                existing.label = def.label;
                existing.icon = def.icon;
                existing.parent = def.parent;
                existing.order = def.order;
                existing.fn = def.fn;
                existing.activeOn = def.activeOn;
            } else {
                this.currentMenu.push({ ...def });
            }
        });
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.currentMenu));
        localStorage.setItem(migrationKey, '1');
    };
})();

(function migrateSshTerminalTopLevelMenu() {
    const migrationKey = 'blueprintsSettingsMenuSshTerminalTopLevel20260514';
    const originalLoadConfig = SettingsMenuConfig.loadConfig.bind(SettingsMenuConfig);
    SettingsMenuConfig.loadConfig = function loadConfigWithSshTerminalTopLevelMigration() {
        originalLoadConfig();
        if (localStorage.getItem(migrationKey) === '1') return;
        const removeIds = new Set(['ssh-fn-local-hermes', 'ssh-fn-local-hermes-setup', 'ssh-fn-connect']);
        this.currentMenu = this.currentMenu.filter(entry => !removeIds.has(entry.id) && !entry.id.startsWith('ssh-target-'));
        ['ssh-terminal', 'ssh-fn-agent', 'ssh-fn-setup', 'ssh-fn-disconnect', 'ssh-fn-fullscreen', 'ssh-fn-lock'].forEach(id => {
            const def = this.defaultMenu.find(entry => entry.id === id);
            if (!def) return;
            const existing = this.currentMenu.find(entry => entry.id === id);
            if (existing) {
                existing.label = def.label;
                existing.icon = def.icon;
                existing.pageLabel = def.pageLabel;
                existing.parent = def.parent;
                existing.order = def.order;
                if (def.fn !== undefined) existing.fn = def.fn; else delete existing.fn;
                if (def.activeOn !== undefined) existing.activeOn = def.activeOn; else delete existing.activeOn;
            } else {
                this.currentMenu.push({ ...def });
            }
        });
        [
            ['agent-pages', 2],
            ['settings', 3],
            ['keys', 4],
            ['docs', 5],
            ['settings-layout', 6],
        ].forEach(([id, order]) => {
            const item = this.currentMenu.find(entry => entry.id === id && !entry.parent);
            if (item) item.order = order;
        });
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.currentMenu));
        localStorage.setItem(migrationKey, '1');
    };
})();

(function migrateAgentPagesMenuPlacement() {
    const migrationKey = 'blueprintsSettingsMenuAgentPages20260516';
    const originalLoadConfig = SettingsMenuConfig.loadConfig.bind(SettingsMenuConfig);
    SettingsMenuConfig.loadConfig = function loadConfigWithAgentPagesPlacement() {
        originalLoadConfig();
        if (localStorage.getItem(migrationKey) === '1') return;
        [
            'agent-pages',
            'hermes-local',
            'hermes-vps',
            'agent-fn-refresh',
            'agent-fn-open',
            'agent-fn-terminal',
            'agent-fn-tui',
            'agent-fn-setup',
        ].forEach(id => {
            const def = this.defaultMenu.find(entry => entry.id === id);
            if (!def) return;
            const existing = this.currentMenu.find(entry => entry.id === id);
            if (existing) {
                existing.label = def.label;
                existing.icon = def.icon;
                existing.pageLabel = def.pageLabel;
                existing.parent = def.parent;
                existing.order = def.order;
                if (def.fn !== undefined) existing.fn = def.fn; else delete existing.fn;
                if (def.activeOn !== undefined) existing.activeOn = def.activeOn; else delete existing.activeOn;
            } else {
                this.currentMenu.push({ ...def });
            }
        });
        [
            ['pve-hosts', 0],
            ['ssh-terminal', 1],
            ['agent-pages', 2],
            ['settings', 3],
            ['keys', 4],
            ['docs', 5],
            ['settings-layout', 6],
        ].forEach(([id, order]) => {
            const item = this.currentMenu.find(entry => entry.id === id);
            if (item) {
                item.parent = null;
                item.order = order;
            }
        });
        const hermesItem = this.currentMenu.find(entry => entry.id === 'hermes-local');
        if (hermesItem) {
            hermesItem.parent = 'agent-pages';
            hermesItem.order = 0;
        }
        const hermesVpsItem = this.currentMenu.find(entry => entry.id === 'hermes-vps');
        if (hermesVpsItem) {
            hermesVpsItem.parent = 'agent-pages';
            hermesVpsItem.order = 1;
        }
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.currentMenu));
        localStorage.setItem(migrationKey, '1');
    };
})();

(function migrateHermesVpsAgentPage() {
    const migrationKey = 'blueprintsSettingsMenuHermesVpsAgentPage20260517';
    const originalLoadConfig = SettingsMenuConfig.loadConfig.bind(SettingsMenuConfig);
    SettingsMenuConfig.loadConfig = function loadConfigWithHermesVpsAgentPage() {
        originalLoadConfig();
        if (localStorage.getItem(migrationKey) === '1') return;
        [
            'agent-pages',
            'hermes-local',
            'hermes-vps',
            'agent-fn-refresh',
            'agent-fn-open',
            'agent-fn-terminal',
            'agent-fn-tui',
            'agent-fn-setup',
        ].forEach(id => {
            const def = this.defaultMenu.find(entry => entry.id === id);
            if (!def) return;
            const existing = this.currentMenu.find(entry => entry.id === id);
            if (existing) {
                existing.label = def.label;
                existing.icon = def.icon;
                existing.pageLabel = def.pageLabel;
                existing.parent = def.parent;
                existing.order = def.order;
                if (def.fn !== undefined) existing.fn = def.fn; else delete existing.fn;
                if (def.activeOn !== undefined) existing.activeOn = def.activeOn; else delete existing.activeOn;
            } else {
                this.currentMenu.push({ ...def });
            }
        });
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.currentMenu));
        localStorage.setItem(migrationKey, '1');
    };
})();

(function migrateMatrixChatAdminAgentPage() {
    const migrationKey = 'blueprintsSettingsMenuMatrixChatAdmin20260519';
    const originalLoadConfig = SettingsMenuConfig.loadConfig.bind(SettingsMenuConfig);
    SettingsMenuConfig.loadConfig = function loadConfigWithMatrixChatAdminPage() {
        originalLoadConfig();
        if (localStorage.getItem(migrationKey) === '1') return;
        ['agent-pages', 'matrix-chat', 'matrix-chat-admin', 'chat-admin-fn-refresh'].forEach(id => {
            const def = this.defaultMenu.find(entry => entry.id === id);
            if (!def) return;
            const existing = this.currentMenu.find(entry => entry.id === id);
            if (existing) {
                existing.label = def.label;
                existing.icon = def.icon;
                existing.pageLabel = def.pageLabel;
                existing.parent = def.parent;
                existing.order = def.order;
                if (def.fn !== undefined) existing.fn = def.fn; else delete existing.fn;
                if (def.activeOn !== undefined) existing.activeOn = def.activeOn; else delete existing.activeOn;
            } else {
                this.currentMenu.push({ ...def });
            }
        });
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.currentMenu));
        localStorage.setItem(migrationKey, '1');
    };
})();

(function migrateMatrixChatNotifierDndFunctionItem() {
    const migrationKey = 'blueprintsSettingsMenuMatrixChatNotifierDnd20260521';
    const originalLoadConfig = SettingsMenuConfig.loadConfig.bind(SettingsMenuConfig);
    SettingsMenuConfig.loadConfig = function loadConfigWithMatrixChatNotifierDnd() {
        originalLoadConfig();
        if (localStorage.getItem(migrationKey) === '1') return;
        const def = this.defaultMenu.find(entry => entry.id === 'chat-fn-notifier');
        if (!def) return;
        const existing = this.currentMenu.find(entry => entry.id === def.id);
        if (existing) {
            existing.label = def.label;
            existing.icon = def.icon;
            existing.parent = def.parent;
            existing.order = def.order;
            existing.fn = def.fn;
            existing.activeOn = def.activeOn;
        } else {
            this.currentMenu.push({ ...def });
        }
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.currentMenu));
        localStorage.setItem(migrationKey, '1');
    };
})();

function _settingsSshTargetMenuItemId(targetId) {
    return `ssh-target-${String(targetId || '').replace(/[^a-zA-Z0-9_.-]/g, '-')}`;
}

function _settingsSyncSshTerminalTargetMenu(targets) {
    if (typeof SettingsMenuConfig === 'undefined') return;
    const menu = SettingsMenuConfig;
    if (!Array.isArray(menu.currentMenu)) return;

    const visibleTargets = (Array.isArray(targets) ? targets : [])
        .filter(target => target && target.show_in_menu !== false)
        .slice()
        .sort((a, b) => {
            const ao = Number.isFinite(a.menu_order) ? a.menu_order : 100;
            const bo = Number.isFinite(b.menu_order) ? b.menu_order : 100;
            if (ao !== bo) return ao - bo;
            return String(a.label || a.target_id || '').localeCompare(String(b.label || b.target_id || ''));
        });

    menu.currentMenu = menu.currentMenu.filter(entry => !String(entry.id || '').startsWith('ssh-target-'));
    visibleTargets.forEach((target, index) => {
        const targetId = String(target.target_id || '').trim();
        if (!targetId) return;
        const itemId = _settingsSshTargetMenuItemId(targetId);
        const label = `${target.label || targetId}${target.enabled ? '' : ' (pending)'}`;
        menu.currentMenu.push({
            id: itemId,
            label,
            icon: ['ssh', 'vps-dockge-ssh'].includes(target.kind) ? HIEROGLYPHS.ankh : HIEROGLYPHS.khaHorizon,
            pageLabel: target.label || targetId,
            parent: 'ssh-terminal',
            order: Number.isFinite(target.menu_order) ? target.menu_order : index,
            sshTargetId: targetId,
            sshTargetEnabled: target.enabled !== false,
        });
    });
    menu.updateActiveTab(menu._activeId || undefined);
}

window._settingsSyncSshTerminalTargetMenu = _settingsSyncSshTerminalTargetMenu;

async function _settingsLoadSshTerminalTargetMenu() {
    if (typeof apiFetch !== 'function') return;
    const response = await apiFetch('/api/v1/ssh-terminal/targets');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const targets = await response.json();
    _settingsSyncSshTerminalTargetMenu(targets);
}

(function loadSshTargetsWhenSettingsMenuOpens() {
    let loaded = false;
    const originalShowGroup = SettingsMenuConfig.showGroup.bind(SettingsMenuConfig);
    SettingsMenuConfig.showGroup = function showGroupWithSshTargets() {
        originalShowGroup();
        if (loaded) return;
        loaded = true;
        _settingsLoadSshTerminalTargetMenu().catch(error => {
            loaded = false;
            console.warn('[SettingsMenu] Unable to load SSH terminal targets:', error);
        });
    };
})();

(function migrateSshTerminalLegacyFunctionItems() {
    const originalLoadConfig = SettingsMenuConfig.loadConfig.bind(SettingsMenuConfig);
    SettingsMenuConfig.loadConfig = function loadConfigWithSshTerminalLegacyCleanup() {
        originalLoadConfig();
        const before = this.currentMenu.length;
        this.currentMenu = this.currentMenu.filter(entry => (
            !['ssh-fn-local-hermes', 'ssh-fn-local-hermes-setup', 'ssh-fn-connect'].includes(entry.id)
        ));
        ['ssh-fn-agent', 'ssh-fn-setup', 'ssh-fn-disconnect', 'ssh-fn-fullscreen', 'ssh-fn-lock'].forEach(id => {
            const def = this.defaultMenu.find(entry => entry.id === id);
            if (!def) return;
            const existing = this.currentMenu.find(entry => entry.id === id);
            if (existing) {
                existing.parent = def.parent;
                existing.order = def.order;
                existing.activeOn = def.activeOn;
                existing.fn = def.fn;
            } else {
                this.currentMenu.push({ ...def });
            }
        });
        if (this.currentMenu.length !== before) {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.currentMenu));
        }
    };
})();

(function migrateSshTerminalFunctionItems() {
    const migrationKey = 'blueprintsSettingsMenuSshTerminalFunctions20260514';
    const originalLoadConfig = SettingsMenuConfig.loadConfig.bind(SettingsMenuConfig);
    SettingsMenuConfig.loadConfig = function loadConfigWithSshTerminalFunctionMigration() {
        originalLoadConfig();
        if (localStorage.getItem(migrationKey) === '1') return;
        ['ssh-fn-agent', 'ssh-fn-setup', 'ssh-fn-disconnect', 'ssh-fn-fullscreen', 'ssh-fn-lock'].forEach(id => {
            if (this.currentMenu.some(entry => entry.id === id)) return;
            const def = this.defaultMenu.find(entry => entry.id === id);
            if (def) this.currentMenu.push({ ...def });
        });
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.currentMenu));
        localStorage.setItem(migrationKey, '1');
    };
})();

(function migrateSshTerminalSetupFunctionItem() {
    const migrationKey = 'blueprintsSettingsMenuSshTerminalSetupFunction20260514';
    const originalLoadConfig = SettingsMenuConfig.loadConfig.bind(SettingsMenuConfig);
    SettingsMenuConfig.loadConfig = function loadConfigWithSshTerminalSetupFunctionMigration() {
        originalLoadConfig();
        if (localStorage.getItem(migrationKey) === '1') return;
        ['ssh-fn-agent', 'ssh-fn-setup', 'ssh-fn-disconnect', 'ssh-fn-fullscreen', 'ssh-fn-lock'].forEach(id => {
            const def = this.defaultMenu.find(entry => entry.id === id);
            if (!def) return;
            const existing = this.currentMenu.find(entry => entry.id === id);
            if (existing) {
                existing.parent = def.parent;
                existing.order = def.order;
                existing.activeOn = def.activeOn;
            } else {
                this.currentMenu.push({ ...def });
            }
        });
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.currentMenu));
        localStorage.setItem(migrationKey, '1');
    };
})();

function _settingsToggleHorizontalScroll(getController, rerender) {
    const controller = typeof getController === 'function' ? getController() : null;
    if (!controller || typeof controller.toggleHorizontalScroll !== 'function') return;
    controller.toggleHorizontalScroll();
    if (typeof rerender === 'function') rerender();
}

function _settingsToggleHorizontalScrollMany(getControllers, rerender) {
    const controllers = typeof getControllers === 'function' ? getControllers() : [];
    const first = Array.isArray(controllers) ? controllers.find(controller => controller && typeof controller.toggleHorizontalScroll === 'function') : null;
    if (!first) return;
    const nextEnabled = !first.isHorizontalScrollEnabled();
    controllers.forEach(controller => {
        if (!controller || typeof controller.setHorizontalScrollEnabled !== 'function') return;
        controller.setHorizontalScrollEnabled(nextEnabled);
    });
    if (typeof rerender === 'function') rerender();
}

async function _settingsAutoFitLayout(getController) {
    const controller = typeof getController === 'function' ? getController() : null;
    if (!controller) return null;
    if (typeof controller.autoFitLayout !== 'function') return null;
    return controller.autoFitLayout({ percentile: 1 });
}

async function _settingsAutoFitLayouts(getControllers) {
    const controllers = typeof getControllers === 'function' ? getControllers() : [];
    if (!Array.isArray(controllers)) return [];
    const measurements = [];
    for (const controller of controllers) {
        if (!controller) continue;
        const measurement = await _settingsAutoFitLayout(() => controller);
        if (measurement) measurements.push(measurement);
    }
    return measurements;
}

function _settingsHorizontalScrollLabel(label, getController) {
    const controller = typeof getController === 'function' ? getController() : null;
    const enabled = !!(controller && typeof controller.isHorizontalScrollEnabled === 'function' && controller.isHorizontalScrollEnabled());
    return `${label}: ${enabled ? 'Is On' : 'Is Off'}`;
}

function _fleetUpdateModalEls() {
    return {
        dialog:     document.getElementById('fleet-update-modal'),
        badge:      document.getElementById('fleet-update-modal-badge'),
        title:      document.getElementById('fleet-update-modal-title'),
        status:     document.getElementById('fleet-update-modal-status'),
        log:        document.getElementById('fleet-update-modal-log'),
        error:      document.getElementById('fleet-update-modal-error'),
        closeBtn:   document.getElementById('fleet-update-modal-close-btn'),
        confirmBtn: document.getElementById('fleet-update-modal-confirm'),
        closeBtns:  Array.from(document.querySelectorAll('#fleet-update-modal .hub-modal-close')),
    };
}

const _FLEET_UPDATE_DELAY_MS = 10000;
const _FLEET_UPDATE_MAX_ATTEMPTS = 3;

function _fleetUpdateFailureText(failure) {
    return `${failure.nodeId}: ${failure.message}`;
}

function _fleetUpdateIsTransientErrorMessage(message) {
    const text = String(message || '').toLowerCase();
    return text.includes('http 502')
        || text.includes('http 503')
        || text.includes('failed to fetch')
        || text.includes('networkerror')
        || text.includes('timed out')
        || text.includes('timeout')
        || text.includes('abort');
}

function _fleetUpdateCanSkipRequeue(stage, failures) {
    return !!stage.restartExpected && failures.length > 0 && failures.every(failure => failure.transient === true);
}

function _fleetUpdateAppendLog(message, tone) {
    const { log } = _fleetUpdateModalEls();
    if (!log) return;
    const line = document.createElement('div');
    line.textContent = message;
    if (tone === 'ok') line.style.color = 'var(--ok,#3fb950)';
    else if (tone === 'err') line.style.color = 'var(--err,#f85149)';
    else if (tone === 'warn') line.style.color = 'var(--warn,#e6a817)';
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
}

function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function _repoLabel(repoKey) {
    return {
        outer: 'Root public repo',
        non_root: 'Non-root public repo',
        inner: 'Private repo',
    }[repoKey] || repoKey;
}

async function _fetchFleetNodesForUpdate() {
    const r = await apiFetch('/api/v1/nodes');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const nodes = await r.json();
    return nodes.filter(node => node.fleet_peer !== false);
}

async function _fetchExpectedRepoVersions() {
    const r = await apiFetch('/health/repos');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
}

async function _fetchNodeRepoVersions(nodeId) {
    const r = await apiFetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/repo-versions`, {
        signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
}

async function _checkFleetUpdatePreflight(nodes) {
    const findings = [];
    await Promise.all(nodes.map(async node => {
        try {
            const versions = await _fetchNodeRepoVersions(node.node_id);
            for (const repoKey of ['outer', 'non_root', 'inner']) {
                const repo = versions[repoKey] || {};
                if (!repo.exists) continue;
                if (repo.dirty) {
                    findings.push(`${node.node_id}: ${_repoLabel(repoKey)} dirty at ${repo.commit || 'unknown'}${repo.branch ? ` (${repo.branch})` : ''}`);
                }
                if (repo.upstream_tracked === false) {
                    findings.push(`${node.node_id}: ${_repoLabel(repoKey)} has no upstream tracking branch${repo.branch ? ` (${repo.branch})` : ''}`);
                }
                if (typeof repo.ahead === 'number' && repo.ahead > 0) {
                    findings.push(
                        `${node.node_id}: ${_repoLabel(repoKey)} has ${repo.ahead} unpushed commit${repo.ahead === 1 ? '' : 's'} ahead of ${repo.upstream || 'upstream'}${repo.branch ? ` (${repo.branch})` : ''}`
                    );
                }
            }
        } catch (e) {
            findings.push(`${node.node_id}: unable to inspect repo state (${e.message})`);
        }
    }));
    return findings;
}

async function _verifyFleetRepoStage(nodes, expectedVersions, repoKey, label) {
    const checks = await Promise.all(nodes.map(async node => {
        try {
            const versions = await _fetchNodeRepoVersions(node.node_id);
            const repo = versions[repoKey] || {};
            if (!repo.exists) {
                return {
                    nodeId: node.node_id,
                    transient: false,
                    message: `${label} repo missing`,
                };
            }
            if (repo.dirty) {
                return {
                    nodeId: node.node_id,
                    transient: false,
                    message: `${label} repo dirty at ${repo.commit || 'unknown'}`,
                };
            }
            if ((repo.commit || '') !== (expectedVersions[repoKey]?.commit || '')) {
                return {
                    nodeId: node.node_id,
                    transient: false,
                    message: `${label} commit ${repo.commit || 'unknown'} != expected ${expectedVersions[repoKey]?.commit || 'unknown'}`,
                };
            }
            return null;
        } catch (e) {
            return {
                nodeId: node.node_id,
                transient: _fleetUpdateIsTransientErrorMessage(e.message),
                message: e.message,
            };
        }
    }));
    return checks.filter(Boolean);
}

async function _runFleetUpdateStage(nodes, expectedVersions, stage) {
    const { status } = _fleetUpdateModalEls();
    if (status) {
        status.textContent = `Queueing ${stage.label} update...`;
        status.style.color = 'var(--text-dim)';
    }
    _fleetUpdateAppendLog(`Queueing ${stage.label}.`, '');

    const queueResp = await apiFetch('/api/v1/sync/git-pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: stage.scope }),
    });
    if (!queueResp.ok) throw new Error(`${stage.label}: HTTP ${queueResp.status}`);

    // Fast path: if all nodes already match expected commit, skip settle delay.
    const immediateFailures = await _verifyFleetRepoStage(nodes, expectedVersions, stage.repoKey, stage.label);
    if (!immediateFailures.length) {
        _fleetUpdateAppendLog(`${stage.label}: already converged; no settle wait needed.`, 'ok');
        return;
    }

    _fleetUpdateAppendLog(`${stage.label}: ${immediateFailures.length} node check(s) still pending commit convergence.`, 'warn');
    _fleetUpdateAppendLog(`${stage.label}: changes still propagating, waiting ${Math.round((stage.settleMs || _FLEET_UPDATE_DELAY_MS) / 1000)}s for fleet to settle.`, '');

    for (let attempt = 1; attempt <= (stage.maxAttempts || _FLEET_UPDATE_MAX_ATTEMPTS); attempt += 1) {
        await _sleep(stage.settleMs || _FLEET_UPDATE_DELAY_MS);
        const failures = await _verifyFleetRepoStage(nodes, expectedVersions, stage.repoKey, stage.label);
        if (!failures.length) {
            if (attempt === 1) {
                _fleetUpdateAppendLog(`${stage.label}: converged after one settle window at ${expectedVersions[stage.repoKey]?.commit || 'unknown'}.`, 'ok');
            } else {
                _fleetUpdateAppendLog(`${stage.label}: verified after attempt ${attempt} at ${expectedVersions[stage.repoKey]?.commit || 'unknown'}.`, 'ok');
            }
            return;
        }

        if (attempt >= (stage.maxAttempts || _FLEET_UPDATE_MAX_ATTEMPTS)) {
            throw new Error(`${stage.label} failed after ${attempt} attempts:\n${failures.map(_fleetUpdateFailureText).join('\n')}`);
        }

        _fleetUpdateAppendLog(`${stage.label}: verification attempt ${attempt} failed, retrying (${attempt + 1}/${stage.maxAttempts || _FLEET_UPDATE_MAX_ATTEMPTS}).`, 'warn');
        failures.forEach(failure => _fleetUpdateAppendLog(`  ${_fleetUpdateFailureText(failure)}`, 'warn'));

        if (_fleetUpdateCanSkipRequeue(stage, failures)) {
            _fleetUpdateAppendLog(`${stage.label}: verification is seeing transient restart-time errors, so skipping requeue and waiting again.`, 'warn');
            continue;
        }

        let retryResp;
        try {
            retryResp = await apiFetch('/api/v1/sync/git-pull', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scope: stage.scope }),
            });
        } catch (e) {
            if (stage.restartExpected && _fleetUpdateIsTransientErrorMessage(e.message)) {
                _fleetUpdateAppendLog(`${stage.label}: requeue hit a transient restart-time error (${e.message}); waiting again without failing.`, 'warn');
                continue;
            }
            throw e;
        }
        if (!retryResp.ok) {
            if (stage.restartExpected && _fleetUpdateIsTransientErrorMessage(`HTTP ${retryResp.status}`)) {
                _fleetUpdateAppendLog(`${stage.label}: requeue returned transient HTTP ${retryResp.status}; waiting again without failing.`, 'warn');
                continue;
            }
            throw new Error(`${stage.label} retry ${attempt + 1}: HTTP ${retryResp.status}`);
        }

        _fleetUpdateAppendLog(`${stage.label}: retry queued. Waiting ${Math.round((stage.settleMs || _FLEET_UPDATE_DELAY_MS) / 1000)}s again.`, '');
    }
}

function _resetFleetUpdateModal() {
    const { dialog, badge, title, status, log, error, closeBtn, confirmBtn, closeBtns } = _fleetUpdateModalEls();
    if (dialog) dialog.dataset.busy = '0';
    if (dialog) dialog.dataset.tone = 'warning';
    if (badge) badge.textContent = 'SYNC';
    if (title) title.textContent = 'Trigger Fleet Update';
    if (status) {
        status.textContent = '';
        status.style.color = 'var(--text-dim)';
    }
    if (log) log.innerHTML = '';
    if (error) error.textContent = '';
    if (closeBtn) closeBtn.textContent = 'Cancel';
    if (confirmBtn) confirmBtn.disabled = false;
    closeBtns.forEach(btn => { btn.disabled = false; });
}

function openFleetUpdateModal() {
    const { dialog } = _fleetUpdateModalEls();
    if (!dialog) return;
    _resetFleetUpdateModal();
    HubModal.open(dialog, { onClose: _resetFleetUpdateModal });
}

async function submitFleetUpdate() {
    const { dialog, status, error, closeBtn, confirmBtn, closeBtns } = _fleetUpdateModalEls();
    if (!dialog || dialog.dataset.busy === '1') return;

    const stages = [
        { scope: 'outer', repoKey: 'outer', label: 'Root public repo' },
        { scope: 'non_root', repoKey: 'non_root', label: 'Non-root public repo' },
        { scope: 'inner', repoKey: 'inner', label: 'Private repo', settleMs: 20000, maxAttempts: 6, restartExpected: true },
    ];

    dialog.dataset.busy = '1';
    if (error) error.textContent = '';
    if (status) {
        status.textContent = 'Preparing staged fleet update...';
        status.style.color = 'var(--text-dim)';
    }
    if (confirmBtn) confirmBtn.disabled = true;
    closeBtns.forEach(btn => { btn.disabled = true; });

    try {
        _fleetUpdateAppendLog('Collecting expected commit versions from this node.', '');
        const [nodes, expectedVersions] = await Promise.all([
            _fetchFleetNodesForUpdate(),
            _fetchExpectedRepoVersions(),
        ]);

        if (status) status.textContent = 'Running preflight repo checks...';
        _fleetUpdateAppendLog('Running preflight repo checks (dirty + upstream divergence) across all fleet nodes.', '');
        const preflightFindings = await _checkFleetUpdatePreflight(nodes);
        if (preflightFindings.length) {
            preflightFindings.forEach(line => _fleetUpdateAppendLog(`  ${line}`, 'err'));
            throw new Error(`preflight blocked by dirty, unpushed, or unreadable repos:\n${preflightFindings.join('\n')}`);
        }
        _fleetUpdateAppendLog('Preflight passed: repos are clean and no unpushed commits were detected.', 'ok');

        for (const stage of stages) {
            await _runFleetUpdateStage(nodes, expectedVersions, stage);
        }

        if (status) {
            status.textContent = 'Fleet update completed successfully.';
            status.style.color = 'var(--ok,#3fb950)';
        }
        _fleetUpdateAppendLog('All three repos match the coordinator commit on all fleet nodes.', 'ok');
        if (closeBtn) closeBtn.textContent = 'CLOSE';
        closeBtns.forEach(btn => { btn.disabled = false; });
        loadNodes();
    } catch (e) {
        dialog.dataset.busy = '0';
        if (error) error.textContent = `Fleet update failed: ${e.message}`;
        if (status) {
            status.textContent = 'Fleet update failed.';
            status.style.color = 'var(--err,#f85149)';
        }
        _fleetUpdateAppendLog(`Fleet update failed: ${e.message}`, 'err');
        closeBtns.forEach(btn => { btn.disabled = false; });
        if (confirmBtn) confirmBtn.disabled = false;
        return;
    }

    dialog.dataset.busy = '0';
    if (confirmBtn) confirmBtn.disabled = true;
}

const _fleetUpdateConfirmBtn = document.getElementById('fleet-update-modal-confirm');
if (_fleetUpdateConfirmBtn && !_fleetUpdateConfirmBtn.dataset.bound) {
    _fleetUpdateConfirmBtn.addEventListener('click', submitFleetUpdate);
    _fleetUpdateConfirmBtn.dataset.bound = '1';
}

// ── Function registrations ───────────────────────────────────────────────────
// settings-menu.js loads after all settings page scripts so all referenced
// globals are in scope.

SettingsMenuConfig.registerFunctions({
    // PVE Hosts
    'pveh.refresh': () => loadPveHosts(),
    'pveh.scan':    () => scanPveHosts(),
    'pveh.columns': () => _pveOpenColsModal(),
    'pveh.scroll':  () => togglePveHostsHorizontalScroll(),
    'pveh.autoFit': () => _settingsAutoFitLayout(() => _ensurePveHostsLayoutController()),
    'pveh.context': () => openPveHostsLayoutContextModal(),

    // Fleet Nodes
    'nod.refresh':  () => loadNodes(),
    'nod.columns':  () => openNodesColsModal(),
    'nod.backupColumns': () => openBackupsColsModal(),
    'nod.update':   () => openFleetUpdateModal(),
    'nod.scroll':   async () => {
        const nodesCtrl = _ensureNodesLayoutController();
        const bkpCtrl   = _ensureBackupsLayoutController();
        if (nodesCtrl) await nodesCtrl.toggleHorizontalScroll();
        if (bkpCtrl) {
            const nowEnabled = !!(nodesCtrl?.isHorizontalScrollEnabled?.());
            if (typeof bkpCtrl.setHorizontalScrollEnabled === 'function') {
                bkpCtrl.setHorizontalScrollEnabled(nowEnabled);
            }
            await bkpCtrl.resolveRemoteLayout?.({ rerender: true, forceApply: true });
        }
    },
    'nod.autoFit': async () => autoFitNodesHorizontalLayout(),
    'nod.context':  () => openNodesLayoutContextModal(),
    'bkp.context':  () => openBackupsLayoutContextModal(),

    // App Config
    'cfg.add':      () => openAddSettingModal(),
    'cfg.refresh':  () => loadSettings(),
    'cfg.columns':  () => openSettingsColsModal(),
    'cfg.cache':    () => forceRefreshUiAssets(),
    'cfg.scroll':   () => toggleSettingsHorizontalScroll(),
    'cfg.autoFit':  () => _settingsAutoFitLayout(() => _ensureSettingsLayoutController()),
    'cfg.context':  () => openSettingsLayoutContextModal(),

    // Local Dockge
    'ldg.refresh':  () => loadLocalDockgeStacks(),
    'vdg.refresh':  () => loadVpsDockgeStacks(),
    'l841.refresh': () => loadLxc841DockgeStacks(),
    'ssh.agent': () => window._sshTerminalOpenHermesAgent?.(),
    'ssh.setup': () => window._sshTerminalOpenHermesSetup?.(),
    'ssh.disconnect': () => window._sshTerminalDisconnect?.(),
    'ssh.fullscreen': () => window._sshTerminalToggleFullscreen?.(),
    'ssh.lock': () => window._sshTerminalToggleLock?.(),

    // Agent Pages
    'agent.refresh':  () => window._agentPagesRefreshHermes?.(),
    'agent.open':     () => window._agentPagesOpenHermes?.(),
    'agent.terminal': () => window._agentPagesOpenTerminal?.('terminal'),
    'agent.tui':      () => window._agentPagesOpenTerminal?.('tui'),
    'agent.setup':    () => window._agentPagesOpenTerminal?.('setup'),
    'chat.refresh':   () => window.MatrixChat?.refresh?.(),
    'chat.mention':   () => window.MatrixChat?.insertHermesMention?.(),
    'chat.send':      () => window.MatrixChat?.sendMessage?.(),
    'chat.voiceMode': () => window.BlueprintsVoiceMode?.open?.(),
    'chat.noiseTests': () => window.SttNoiseTests?.open?.(),
    'chat.vadDev':    () => window.VadDevModal?.open?.(),
    'chat.wakeDev':   () => window.WakeDevModal?.open?.(),
    'chat.notifier':  () => window.MatrixChat?.openNotifierDnd?.(),
    'chat.notifierTests': () => window.MatrixChat?.openNotifierTests?.(),
    'chatAdmin.refresh': () => window.MatrixChatAdmin?.refresh?.(),

    // Manual ARP
    'arp.add':      () => addArpManualEntry(),
    'arp.refresh':  () => loadArpManual(),
    'arp.columns':  () => _openArpManualColsModal(),
    'arp.context':  () => openArpManualLayoutContextModal(),
    'arp.scroll':   () => toggleArpManualHorizontalScroll(),
    'arp.autoFit':  () => _settingsAutoFitLayout(() => _ensureArpManualLayoutController()),

    // AI Providers
    'ai.addProv':         () => openAiProviderModal(null),
    'ai.refresh':         () => loadAiProviders(),
    'ai.addAssign':       () => openAiAssignmentModal(null),
    'ai.providerCols':    () => _openAiProviderColsModal(),
    'ai.assignCols':      () => _openAiAssignmentColsModal(),
    'ai.providerScroll':  () => toggleAiProvidersHorizontalScroll(),
    'ai.assignScroll':    () => toggleAiAssignmentsHorizontalScroll(),
    'ai.autoFit':         () => _settingsAutoFitLayouts(() => [
        _ensureAiProvidersLayoutController(),
        _ensureAiAssignmentsLayoutController(),
    ]),
    'ai.providerContext': () => openAiProvidersLayoutContextModal(),
    'ai.assignContext':   () => openAiAssignmentsLayoutContextModal(),

    // Docs
    'doc.reload':         () => docsRefreshContent(),
    'doc.search':         () => openDocsFolderSearchModal(),
    'doc.searchExpand':   () => docsSearchExpandAll(),
    'doc.searchCollapse': () => docsSearchCollapseAll(),
    'doc.new':            () => openNewDocModal(),
    'doc.add':            () => openAddDocModal(),
    'doc.preview':        () => docsTogglePreview(),
    'doc.frontmatter':    () => docsToggleFrontmatterPreview(),
    'doc.save':           () => docsSave(),
    'doc.meta':           () => openEditDocModal(),
    'doc.delete':         () => openDeleteDocModal(),

    // Doc List
    'dlist.addGrp': () => docsListAddGroup(),

    // Self Diagnostic
    'diag.run':     () => runSelfDiag(),
    'diag.bucketQuick': async () => {
        await runSelfDiag();
        const quickBtn = document.getElementById('bp-bucket-probe-quick-btn');
        if (quickBtn) quickBtn.click();
    },

    // SSH Keys
    'key.refresh':  () => loadKeys(),
    'key.columns':  () => openKeysColsModal(),
    'key.scroll':   () => toggleKeysHorizontalScroll(),
    'key.autoFit':  () => _settingsAutoFitLayout(() => _ensureKeysLayoutController()),
    'key.context':  () => openKeysLayoutContextModal(),

    // Certificates
    'cert.refresh': () => loadCerts(),
    'cert.columns': () => openCertsColsModal(),
    'cert.scroll':  () => toggleCertsHorizontalScroll(),
    'cert.autoFit': () => _settingsAutoFitLayout(() => _ensureCertsLayoutController()),
    'cert.context': () => openCertsLayoutContextModal(),

    // Nav Items
    'ni.refresh':   () => loadNavItems(),
    'ni.columns':   () => _openNiColsModal(),
    'ni.exploreIcons': () => openNiExploreIcons(),
    'ni.exploreSounds': () => openNiExploreSounds(),
    'ni.scroll':    () => toggleNiHorizontalScroll(),
    'ni.autoFit':   () => _settingsAutoFitLayout(() => _ensureNiLayoutController()),
    'ni.context':   () => openNiLayoutContextModal(),

    // Form Controls
    'fc.refresh':   () => loadFormControls(),
    'fc.add':       () => _fcAddNew(),
    'fc.columns':   () => _openFcColsModal(),
    'fc.exploreIcons': () => openFcExploreIcons(),
    'fc.exploreSounds': () => openFcExploreSounds(),
    'fc.scroll':    () => toggleFcHorizontalScroll(),
    'fc.autoFit':   () => _settingsAutoFitLayout(() => _ensureFcLayoutController()),
    'fc.context':   () => openFcLayoutContextModal(),

    // Embed Menu
    'em.refresh':   () => loadEmbedMenuItems(),
    'em.columns':   () => _openEmColsModal(),
    'em.exploreIcons': () => openEmExploreIcons(),
    'em.exploreSounds': () => openEmExploreSounds(),
    'em.autoFit':   () => _settingsAutoFitLayout(() => _ensureEmLayoutController()),
    'em.context':   () => openEmLayoutContextModal(),
});

SettingsMenuConfig.registerLabelGetters({
    'doc-fn-search': () => 'Search',
    'doc-fn-frontmatter': () => docsFrontmatterToggleLabel(),
    'ssh-fn-fullscreen': () => window._sshTerminalFullscreenLabel?.() || 'Full Screen',
    'ssh-fn-lock': () => window._sshTerminalLockLabel?.() || 'Lock',
});

SettingsMenuConfig.registerVisibilityGetters({
    'doc-fn-expand-search': () => false,
    'doc-fn-collapse-search': () => false,
    'ssh-fn-agent': () => !!window._sshTerminalCurrentTargetIsHermes?.(),
    'ssh-fn-setup': () => !!window._sshTerminalCurrentTargetIsHermes?.(),
    'ssh-fn-disconnect': () => true,
    'ssh-fn-lock': () => true,
});

SettingsMenuConfig.registerLabelGetters({
    'pveh-fn-scroll':      () => _settingsHorizontalScrollLabel('Horiz Scroll', () => _ensurePveHostsLayoutController()),
    'nod-fn-scroll':       () => _settingsHorizontalScrollLabel('Horiz Scroll', () => _ensureNodesLayoutController()),
    'cfg-fn-scroll':       () => _settingsHorizontalScrollLabel('Horiz Scroll', () => _ensureSettingsLayoutController()),
    'arp-fn-scroll':       () => _settingsHorizontalScrollLabel('Horiz Scroll', () => _ensureArpManualLayoutController()),
    'ai-fn-provscroll':    () => _settingsHorizontalScrollLabel('Provider Scroll', () => _ensureAiProvidersLayoutController()),
    'ai-fn-assignscroll':  () => _settingsHorizontalScrollLabel('Assignment Scroll', () => _ensureAiAssignmentsLayoutController()),
    'key-fn-scroll':       () => _settingsHorizontalScrollLabel('Horiz Scroll', () => _ensureKeysLayoutController()),
    'cert-fn-scroll':      () => _settingsHorizontalScrollLabel('Horiz Scroll', () => _ensureCertsLayoutController()),
    'ni-fn-scroll':        () => _settingsHorizontalScrollLabel('Horiz Scroll', () => _ensureNiLayoutController()),
    'fc-fn-scroll':        () => _settingsHorizontalScrollLabel('Horiz Scroll', () => _ensureFcLayoutController()),
});
