let _selectorOriginMenuGroup = 'synthesis';
const SPECIAL_UI_MODE_S25_STARGATE_TOUCH_NAV = 's25-stargate-touch-nav';

function _isS25StargateOriginMenuMode() {
  const root = document.documentElement;
  if (!root || root.getAttribute('data-device-profile') !== 's25-ultra-oneui-webapk') return false;
  if (root.getAttribute('data-origin-variant') !== 'stargate') return false;
  if (!window.matchMedia) return false;
  if (!window.matchMedia('(max-width: 600px)').matches) return false;
  if (!window.matchMedia('(orientation: portrait)').matches) return false;
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches;
}

function _applySpecialUiModeAttributes() {
  const root = document.documentElement;
  const body = document.body;
  const mode = _isS25StargateOriginMenuMode() ? SPECIAL_UI_MODE_S25_STARGATE_TOUCH_NAV : '';
  if (root) {
    if (mode) root.setAttribute('data-special-ui-mode', mode);
    else root.removeAttribute('data-special-ui-mode');
  }
  if (body) {
    if (mode) body.setAttribute('data-special-ui-mode', mode);
    else body.removeAttribute('data-special-ui-mode');
  }
  if (typeof ResponsiveLayout !== 'undefined' && typeof ResponsiveLayout.syncControlHost === 'function') {
    ResponsiveLayout.syncControlHost();
  }
}

function _installSpecialUiModeTracking() {
  const root = document.documentElement;
  _applySpecialUiModeAttributes();
  window.addEventListener('resize', _applySpecialUiModeAttributes, { passive: true });
  window.addEventListener('orientationchange', _applySpecialUiModeAttributes, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', _applySpecialUiModeAttributes, { passive: true });
  }
  if (root && typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(_applySpecialUiModeAttributes);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-device-profile', 'data-origin-variant'],
    });
  }
}

function _getActiveGroupMenuConfig() {
  if (_selectorOriginMenuGroup === 'probes' && typeof ProbesMenuConfig !== 'undefined') return ProbesMenuConfig;
  if (_selectorOriginMenuGroup === 'settings' && typeof SettingsMenuConfig !== 'undefined') return SettingsMenuConfig;
  if (typeof SynthesisMenuConfig !== 'undefined') return SynthesisMenuConfig;
  return null;
}

function _getActiveGroupLayoutTabId() {
  const menu = _getActiveGroupMenuConfig();
  return menu && menu._cfg ? menu._cfg.mobilePinnedId : null;
}

function _closeActiveOriginMenus() {
  const menu = _getActiveGroupMenuConfig();
  if (menu && typeof menu.closeAnchoredMenus === 'function') menu.closeAnchoredMenus();
}

function _handleOriginPrimaryMenu(payload) {
  if (typeof OriginMenuStateMachine !== 'undefined') {
    OriginMenuStateMachine.dispatch('tap', payload && payload.button);
  }
}

function _handleOriginLayoutPage(payload) {
  if (typeof OriginMenuStateMachine !== 'undefined') {
    OriginMenuStateMachine.dispatch('doubleTap', payload && payload.button);
  }
}

function _handleOriginContextMenu(payload) {
  if (typeof OriginMenuStateMachine !== 'undefined') {
    OriginMenuStateMachine.dispatch('longPress', payload && payload.button);
  }
}

function _installSelectorOriginMenuBridge() {
  if (typeof window === 'undefined' || !window.BlueprintsSelectorOriginButton || typeof window.BlueprintsSelectorOriginButton.setHandlers !== 'function') return;

  if (typeof OriginMenuStateMachine !== 'undefined') {
    OriginMenuStateMachine.configure({
      getMenu: _getActiveGroupMenuConfig,
      onGoToLayout() {
        const menu = _getActiveGroupMenuConfig();
        const layoutTabId = _getActiveGroupLayoutTabId();
        if (!menu || !layoutTabId) return;
        _closeActiveOriginMenus();
        switchTab(layoutTabId);
        menu.updateActiveTab(layoutTabId);
      },
    });
  }

  window.BlueprintsSelectorOriginButton.setHandlers({
    click: _handleOriginPrimaryMenu,
    doubleClick: _handleOriginLayoutPage,
    longPress: _handleOriginContextMenu,
  });
  window.BlueprintsSelectorOriginButton.setOptions({
    title: 'Origin menu controls',
    ariaLabel: 'Open current menu, layout, or context actions',
  });
}

window.BlueprintsHubMenuBridge = {
  get activeGroup() {
    return _selectorOriginMenuGroup;
  },
  getActiveMenuConfig: _getActiveGroupMenuConfig,
  getActiveGroupLayoutTabId: _getActiveGroupLayoutTabId,
  isS25StargateOriginMenuMode: _isS25StargateOriginMenuMode,
  closeAnchoredMenus: _closeActiveOriginMenus,
};

/* ── Group + tab switching ───────────────────────────────────────────── */
function switchGroup(group) {
  _selectorOriginMenuGroup = group;
  _closeActiveOriginMenus();
  _activeGroup = group;
  document.querySelectorAll('.group-tab').forEach(b =>
    b.classList.toggle('active', b.getAttribute('onclick').includes(`'${group}'`)));
  document.querySelectorAll('.table-nav button[data-group]').forEach(b => {
    b.style.display = b.dataset.group === group ? '' : 'none';
  });
  // Show/hide synthesis split-dropdown menu
  const synthesisWrapper = document.getElementById('synthesisMenuWrapper');
  if (synthesisWrapper) synthesisWrapper.style.display = group === 'synthesis' ? '' : 'none';
  if (group === 'synthesis') {
    SynthesisMenuConfig.showGroup();
    switchTab('manual-links');
    manualLinksShowView(_manualLinksView);
    SynthesisMenuConfig.updateActiveTab('manual-links-' + _manualLinksView);
    return;
  }
  // Show/hide probes split-dropdown menu
  const probesWrapper = document.getElementById('probesMenuWrapper');
  if (probesWrapper) probesWrapper.style.display = group === 'probes' ? '' : 'none';
  if (group === 'probes') {
    ProbesMenuConfig.showGroup();
    switchTab('pfsense-dns');
    ProbesMenuConfig.updateActiveTab('pfsense-dns');
    return;
  }
  // Show/hide settings split-dropdown menu
  const settingsWrapper = document.getElementById('settingsMenuWrapper');
  if (settingsWrapper) settingsWrapper.style.display = group === 'settings' ? '' : 'none';
  if (group === 'settings') {
    SettingsMenuConfig.showGroup();
    switchTab('pve-hosts');
    SettingsMenuConfig.updateActiveTab('pve-hosts');
    return;
  }
  const firstBtn = document.querySelector(`.table-nav button[data-group="${group}"]`);
  if (firstBtn) {
    const m = firstBtn.getAttribute('onclick').match(/switchTab\('([^']+)'\)/);
    if (m) switchTab(m[1]);
  }
}

function switchTab(tab) {
  if (typeof SoundManager !== 'undefined') SoundManager.stopPreview();
  document.querySelectorAll('.table-nav button').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const btn = document.querySelector(`.table-nav button[onclick*="'${tab}'"]`);
  if (btn) btn.classList.add('active');
  const panel = document.getElementById(`tab-${tab}`);
  if (panel) panel.classList.add('active');
  // Lazy-load data on first view
  if (tab === 'services'       && !_services.length)      loadServices();
  if (tab === 'machines'       && !_machines.length)      loadMachines();
  if (tab === 'nodes'          && !_nodes.length)         loadNodes();
  if (tab === 'pfsense-dns'    && !_pfsenseDns.length)    loadPfSenseDns();
  if (tab === 'proxmox-config' && !_proxmoxConfig.length) loadProxmoxConfig();
  if (tab === 'dockge-stacks'  && !_dockgeStacks.length)  loadDockgeStacks();
  if (tab === 'caddy-configs'  && !_caddyConfigs.length)  loadCaddyConfigs();
  if (tab === 'pve-hosts'      && !_pveHosts.length)      loadPveHosts();
  if (tab === 'vlans'          && !_vlans.length)         loadVlans();
  if (tab === 'arp-manual'     && !_arpManual.length)     loadArpManual();
  if (tab === 'ssh-targets'    && !_sshTargets.length)    loadSshTargets();
  if (tab === 'manual-links'   && !_manualLinks.length)   loadManualLinks();
  if (tab === 'manual-links-table')    { switchTab('manual-links'); manualLinksShowView('table');    return; }
  if (tab === 'manual-links-rendered') { switchTab('manual-links'); manualLinksShowView('rendered'); return; }
  if (tab === 'settings'       && !_settings.length)      loadSettings();
  if (tab === 'settings')                                  { initSoundToggle(); initVolumeSlider(); }
  if (tab === 'keys')                                      loadKeys();
  if (tab === 'certs')                                     loadCerts();
  if (tab === 'docs' && !_docsAll.length)                  loadDocs();
  if (tab === 'docs-list') { if (!_docsAll.length) loadDocs(); else _docsRenderList(); }
  if (tab === 'docs-images')                               openDocImagesModal();
  if (tab === 'ai-providers' && !_aiProviders.length)      loadAiProviders();
  if (tab === 'nav-items'    && !_navItems.length)         loadNavItems();
  if (tab === 'form-controls' && !_fcItems.length)         loadFormControls();
  if (tab === 'bookmarks-main'  && !_bookmarks.length)  loadBookmarks();
  if (tab === 'bookmarks-history')                       loadVisits();
  if (tab === 'bookmarks-embeddings')                    _bmLoadEmbedCfg();
  if (tab === 'bookmarks'        && !_bookmarks.length)  loadBookmarks();
  if (tab === 'bookmarks') { switchTab('bookmarks-main'); return; }
  // Notify responsive layout so the correct page-controls group is shown/hidden
  if (typeof ResponsiveLayout !== 'undefined') ResponsiveLayout.updateControlsForTab(tab);
  // self-diag: just show the shell — user clicks Run to trigger tests
  // PCT live status polling — only while nodes tab is open
  if (tab === 'nodes') {
    if (!_pctPollInterval) {
      _pctPollInterval = setInterval(() => { if (_nodes.length) enrichNodePctStatus(); }, 5000);
    }
    loadBackups();
  } else {
    if (_pctPollInterval) { clearInterval(_pctPollInterval); _pctPollInterval = null; }
  }
}

/* ── Bootstrap ────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  if (!localStorage.getItem(_LS_SECRET_KEY)) { openApiKeyModal(); }
  if (typeof SoundManager !== 'undefined') SoundManager.init();
  if (typeof FormControlManager !== 'undefined') { FormControlManager.init(); FormControlManager.load(); }
  if (typeof HubModal !== 'undefined') HubModal.init();
  const _urlGroup = new URLSearchParams(window.location.search).get('group');
  if (_urlGroup && ['synthesis', 'probes', 'settings'].includes(_urlGroup)) switchGroup(_urlGroup);
  loadFrontendSettings();
  loadHealth();
  loadManualLinks();
  SynthesisMenuConfig.showGroup();
  SynthesisMenuConfig.updateActiveTab('manual-links-' + _manualLinksView);
  _installSelectorOriginMenuBridge();
  _installSpecialUiModeTracking();
  loadSyncStatus();
  setInterval(() => {
    if (typeof window.isColumnResizeActive === 'function' && window.isColumnResizeActive()) return;
    loadHealth();
  }, 15_000);
  setInterval(() => {
    if (typeof window.isColumnResizeActive === 'function' && window.isColumnResizeActive()) return;
    loadSyncStatus();
  }, 30_000);
  ResponsiveLayout.init();
  window.addEventListener('beforeunload', () => ResponsiveLayout.destroy());
  _bmInitEmbedPanel();
  // Auto-resume progress display if reindex was running before page load
  _bmPollReindexProgress();
});
