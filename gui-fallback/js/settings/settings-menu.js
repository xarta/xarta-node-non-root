// settings-menu.js — Split-dropdown navigation for the Settings group
// xarta-node Blueprints GUI
//
// Thin wrapper around createHubMenu() (hub-menu.js).
// Contains only the Settings-specific config, defaultMenu, and function registrations.
//
// localStorage key: 'blueprintsSettingsMenuConfig'
//
// Default groupings:
//   🗄 PVE Hosts  [▼ 🤝 Nodes]
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
        { id: 'settings',        label: 'App Config',     icon: HIEROGLYPHS.djedPillar, pageLabel: 'App Config',      parent: null,        order: 1 },
        { id: 'arp-manual',      label: 'Manual ARP',     icon: HIEROGLYPHS.obelisk,    pageLabel: 'Manual ARP',      parent: 'settings',  order: 0 },
        { id: 'ai-providers',    label: 'AI Providers',   icon: HIEROGLYPHS.falcon,     pageLabel: 'AI Providers',    parent: 'settings',  order: 1 },
        { id: 'nav-items',       label: 'Nav Items',      icon: HIEROGLYPHS.naosShrine, pageLabel: 'Nav Items',       parent: 'settings',  order: 2 },
        { id: 'form-controls',   label: 'Form Controls',  icon: HIEROGLYPHS.adze,       pageLabel: 'Form Controls',   parent: 'settings',  order: 3 },
        { id: 'keys',            label: 'Keys',           icon: HIEROGLYPHS.ankh,       pageLabel: 'SSH Keys',        parent: null,        order: 2 },
        { id: 'certs',           label: 'Certs',          icon: HIEROGLYPHS.shen,       pageLabel: 'Certificates',    parent: 'keys',      order: 0 },
        { id: 'docs',            label: 'Docs',           icon: HIEROGLYPHS.papyrus,    pageLabel: 'Docs',            parent: null,        order: 3 },
        { id: 'docs-list',       label: 'Doc List',       icon: HIEROGLYPHS.papyrus,    pageLabel: 'Doc List',        parent: 'docs',      order: 0 },
        { id: 'docs-images',     label: 'Images',         icon: HIEROGLYPHS.lotus,      pageLabel: 'Doc Images',      parent: 'docs',      order: 1 },
        { id: 'self-diag',       label: 'Self Diagnostic',icon: HIEROGLYPHS.eyeOfHorus, pageLabel: 'Self Diagnostic', parent: 'docs',      order: 2 },
        { id: 'settings-layout', label: '☰',              icon: HIEROGLYPHS.kheper,     pageLabel: 'Navbar Layout',   parent: null,        order: 4 },

        // ── PVE Hosts page function items ─────────────────────────────────
        { id: 'pveh-fn-refresh', label: 'Refresh',          icon: HIEROGLYPHS.nefer,      fn: 'pveh.refresh', activeOn: ['pve-hosts'],    parent: 'settings-layout', order: 0 },
        { id: 'pveh-fn-scan',    label: 'Scan for Proxmox', icon: HIEROGLYPHS.wasScepter, fn: 'pveh.scan',    activeOn: ['pve-hosts'],    parent: 'settings-layout', order: 1 },
        { id: 'pveh-fn-cols',    label: 'Columns',          icon: HIEROGLYPHS.khaHorizon, fn: 'pveh.columns', activeOn: ['pve-hosts'],    parent: 'settings-layout', order: 2 },

        // ── Fleet Nodes page function items ───────────────────────────────
        { id: 'nod-fn-refresh',  label: 'Refresh',          icon: HIEROGLYPHS.nefer,      fn: 'nod.refresh',  activeOn: ['nodes'],        parent: 'settings-layout', order: 0 },
        { id: 'nod-fn-cols',     label: 'Columns',          icon: HIEROGLYPHS.khaHorizon, fn: 'nod.columns',  activeOn: ['nodes'],        parent: 'settings-layout', order: 1 },
        { id: 'nod-fn-update',   label: 'Fleet Update',     icon: HIEROGLYPHS.crookFlail, fn: 'nod.update',   activeOn: ['nodes'],        parent: 'settings-layout', order: 2 },

        // ── App Config page function items ────────────────────────────────
        { id: 'cfg-fn-add',      label: 'Add setting',      icon: HIEROGLYPHS.djedPillar, fn: 'cfg.add',      activeOn: ['settings'],     parent: 'settings-layout', order: 0 },
        { id: 'cfg-fn-refresh',  label: 'Refresh',          icon: HIEROGLYPHS.nefer,      fn: 'cfg.refresh',  activeOn: ['settings'],     parent: 'settings-layout', order: 1 },
        { id: 'cfg-fn-cols',     label: 'Columns',          icon: HIEROGLYPHS.khaHorizon, fn: 'cfg.columns',  activeOn: ['settings'],     parent: 'settings-layout', order: 2 },
        { id: 'cfg-fn-cache',    label: 'Refresh UI',       icon: HIEROGLYPHS.nefer,      fn: 'cfg.cache',    activeOn: ['settings'],     parent: 'settings-layout', order: 3 },

        // ── Manual ARP page function items ────────────────────────────────
        { id: 'arp-fn-add',      label: 'Add entry',        icon: HIEROGLYPHS.obelisk,    fn: 'arp.add',      activeOn: ['arp-manual'],   parent: 'settings-layout', order: 0 },
        { id: 'arp-fn-refresh',  label: 'Refresh',          icon: HIEROGLYPHS.nefer,      fn: 'arp.refresh',  activeOn: ['arp-manual'],   parent: 'settings-layout', order: 1 },

        // ── AI Providers page function items ──────────────────────────────
        { id: 'ai-fn-addprov',   label: 'Add provider',     icon: HIEROGLYPHS.falcon,     fn: 'ai.addProv',   activeOn: ['ai-providers'], parent: 'settings-layout', order: 0 },
        { id: 'ai-fn-refresh',   label: 'Refresh',          icon: HIEROGLYPHS.nefer,      fn: 'ai.refresh',   activeOn: ['ai-providers'], parent: 'settings-layout', order: 1 },
        { id: 'ai-fn-addassign', label: 'Add assignment',   icon: HIEROGLYPHS.falcon,     fn: 'ai.addAssign', activeOn: ['ai-providers'], parent: 'settings-layout', order: 2 },

        // ── Docs page function items ───────────────────────────────────────
        { id: 'doc-fn-reload',   label: 'Reload',           icon: HIEROGLYPHS.nefer,      fn: 'doc.reload',   activeOn: ['docs'],         parent: 'settings-layout', order: 0 },
        { id: 'doc-fn-new',      label: 'New Doc',          icon: HIEROGLYPHS.papyrus,    fn: 'doc.new',      activeOn: ['docs'],         parent: 'settings-layout', order: 1 },
        { id: 'doc-fn-add',      label: 'Add Existing',     icon: 'icons/ui/group-folder-blue.svg', fn: 'doc.add', activeOn: ['docs'], parent: 'settings-layout', order: 2 },
        { id: 'doc-fn-preview',  label: 'Edit / Preview',   icon: HIEROGLYPHS.khaHorizon, fn: 'doc.preview',  activeOn: ['docs'],         parent: 'settings-layout', order: 3 },
        { id: 'doc-fn-save',     label: 'Save',             icon: HIEROGLYPHS.tjet,       fn: 'doc.save',     activeOn: ['docs'],         parent: 'settings-layout', order: 4 },
        { id: 'doc-fn-meta',     label: 'Meta',             icon: HIEROGLYPHS.papyrus,    fn: 'doc.meta',     activeOn: ['docs'],         parent: 'settings-layout', order: 5 },
        { id: 'doc-fn-delete',   label: 'Delete',           icon: 'icons/ui/trash-blue.svg', fn: 'doc.delete', activeOn: ['docs'], parent: 'settings-layout', order: 6 },

        // ── Doc List page function items ───────────────────────────────────
        { id: 'dlist-fn-addgrp', label: 'Add Group',        icon: HIEROGLYPHS.papyrus,    fn: 'dlist.addGrp', activeOn: ['docs-list'],    parent: 'settings-layout', order: 0 },

        // ── Self Diagnostic page function items ────────────────────────────
        { id: 'diag-fn-run',     label: 'Run Diagnostics',  icon: HIEROGLYPHS.wasScepter, fn: 'diag.run',     activeOn: ['self-diag'],    parent: 'settings-layout', order: 0 },

        // ── Nav Items page function items ──────────────────────────────────
        { id: 'ni-fn-refresh',   label: 'Refresh',           icon: HIEROGLYPHS.nefer,     fn: 'ni.refresh',   activeOn: ['nav-items'],    parent: 'settings-layout', order: 0 },
        // ── Form Controls page function items ────────────────────────────────
        { id: 'fc-fn-refresh',   label: 'Refresh',           icon: HIEROGLYPHS.nefer,               fn: 'fc.refresh', activeOn: ['form-controls'], parent: 'settings-layout', order: 0 },
        { id: 'fc-fn-add',       label: 'Add Key',           icon: 'icons/ui/plus-blue.svg',        fn: 'fc.add',     activeOn: ['form-controls'], parent: 'settings-layout', order: 1 },
    ],
});

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
                return `${node.node_id}: ${label} repo missing`;
            }
            if (repo.dirty) {
                return `${node.node_id}: ${label} repo dirty at ${repo.commit || 'unknown'}`;
            }
            if ((repo.commit || '') !== (expectedVersions[repoKey]?.commit || '')) {
                return `${node.node_id}: ${label} commit ${repo.commit || 'unknown'} != expected ${expectedVersions[repoKey]?.commit || 'unknown'}`;
            }
            return null;
        } catch (e) {
            return `${node.node_id}: ${e.message}`;
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

    _fleetUpdateAppendLog(`${stage.label}: queued. Waiting ${Math.round(_FLEET_UPDATE_DELAY_MS / 1000)}s for fleet to settle.`, '');
    await _sleep(_FLEET_UPDATE_DELAY_MS);

    for (let attempt = 1; attempt <= _FLEET_UPDATE_MAX_ATTEMPTS; attempt += 1) {
        const failures = await _verifyFleetRepoStage(nodes, expectedVersions, stage.repoKey, stage.label);
        if (!failures.length) {
            if (attempt === 1) {
                _fleetUpdateAppendLog(`${stage.label}: all nodes verified at ${expectedVersions[stage.repoKey]?.commit || 'unknown'}.`, 'ok');
            } else {
                _fleetUpdateAppendLog(`${stage.label}: verified after attempt ${attempt} at ${expectedVersions[stage.repoKey]?.commit || 'unknown'}.`, 'ok');
            }
            return;
        }

        if (attempt >= _FLEET_UPDATE_MAX_ATTEMPTS) {
            throw new Error(`${stage.label} failed after ${attempt} attempts:\n${failures.join('\n')}`);
        }

        _fleetUpdateAppendLog(`${stage.label}: verification attempt ${attempt} failed, retrying (${attempt + 1}/${_FLEET_UPDATE_MAX_ATTEMPTS}).`, 'warn');
        failures.forEach(line => _fleetUpdateAppendLog(`  ${line}`, 'warn'));

        const retryResp = await apiFetch('/api/v1/sync/git-pull', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scope: stage.scope }),
        });
        if (!retryResp.ok) throw new Error(`${stage.label} retry ${attempt + 1}: HTTP ${retryResp.status}`);

        _fleetUpdateAppendLog(`${stage.label}: retry queued. Waiting ${Math.round(_FLEET_UPDATE_DELAY_MS / 1000)}s again.`, '');
        await _sleep(_FLEET_UPDATE_DELAY_MS);
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
        { scope: 'inner', repoKey: 'inner', label: 'Private repo' },
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
        _fleetUpdateAppendLog('Running preflight dirty-repo check across all fleet nodes.', '');
        const preflightFindings = await _checkFleetUpdatePreflight(nodes);
        if (preflightFindings.length) {
            preflightFindings.forEach(line => _fleetUpdateAppendLog(`  ${line}`, 'err'));
            throw new Error(`preflight blocked by dirty or unreadable repos:\n${preflightFindings.join('\n')}`);
        }
        _fleetUpdateAppendLog('Preflight passed: no dirty repos detected across the fleet.', 'ok');

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

    // Fleet Nodes
    'nod.refresh':  () => loadNodes(),
    'nod.columns':  () => openNodesColsModal(),
    'nod.update':   () => openFleetUpdateModal(),

    // App Config
    'cfg.add':      () => openAddSettingModal(),
    'cfg.refresh':  () => loadSettings(),
    'cfg.columns':  () => openSettingsColsModal(),
    'cfg.cache':    () => forceRefreshUiAssets(),

    // Manual ARP
    'arp.add':      () => addArpManualEntry(),
    'arp.refresh':  () => loadArpManual(),

    // AI Providers
    'ai.addProv':   () => openAiProviderModal(null),
    'ai.refresh':   () => loadAiProviders(),
    'ai.addAssign': () => openAiAssignmentModal(null),

    // Docs
    'doc.reload':   () => docsRefreshContent(),
    'doc.new':      () => openNewDocModal(),
    'doc.add':      () => openAddDocModal(),
    'doc.preview':  () => docsTogglePreview(),
    'doc.save':     () => docsSave(),
    'doc.meta':     () => openEditDocModal(),
    'doc.delete':   () => openDeleteDocModal(),

    // Doc List
    'dlist.addGrp': () => docsListAddGroup(),

    // Self Diagnostic
    'diag.run':     () => runSelfDiag(),

    // Nav Items
    'ni.refresh':   () => loadNavItems(),

    // Form Controls
    'fc.refresh':   () => loadFormControls(),
    'fc.add':       () => _fcAddNew(),
});
