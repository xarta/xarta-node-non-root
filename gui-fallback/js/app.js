let _selectorOriginMenuGroup = 'synthesis';
const SPECIAL_UI_MODE_S25_STARGATE_TOUCH_NAV = 's25-stargate-touch-nav';

function _isS25StargateOriginMenuMode() {
  if (!window.matchMedia) return false;
  if (!window.matchMedia('(max-width: 600px)').matches) return false;
  if (!window.matchMedia('(orientation: portrait)').matches) return false;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches
    || window.matchMedia('(any-pointer: coarse)').matches;
  const hasTouch = (typeof navigator !== 'undefined' && Number(navigator.maxTouchPoints) > 0)
    || ('ontouchstart' in window);
  return coarsePointer || hasTouch;
}

// Returns true when the device is a phone-sized form factor (portrait OR landscape).
// Uses the shorter screen dimension so landscape phones (e.g. S25 Ultra ~412px short side)
// are still detected.  Threshold of 500px covers phones but excludes tablets and desktops.
function _isMobileFormFactor() {
  if (!window.matchMedia) return false;
  const hasTouch = window.matchMedia('(pointer: coarse)').matches
    || window.matchMedia('(any-pointer: coarse)').matches
    || (typeof navigator !== 'undefined' && Number(navigator.maxTouchPoints) > 0);
  if (!hasTouch) return false;
  const shortSide = Math.min(window.screen.width, window.screen.height);
  return shortSide <= 500;
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

const _originDefaultTtsMessages = {
  tap: '',
  double_tap: 'Origin double tap has no assigned action. Awaiting assignment.',
  long_press: 'Origin long press has no assigned action. Awaiting assignment.',
};

function _originEventHasAssignedAction(eventKind) {
  const menu = _getActiveGroupMenuConfig();
  if (!menu) return false;

  if (eventKind === 'double_tap') {
    return !!_getActiveGroupLayoutTabId();
  }

  if (eventKind === 'tap') {
    return typeof menu.openPrimaryMenuAt === 'function';
  }

  if (eventKind === 'long_press') {
    // Long-press is only "assigned" when context fn items exist for the
    // currently active tab context. openContextMenuAt() may exist even when
    // it would render no actions.
    if (typeof menu._contextMenuFunctionItems === 'function') {
      const activeId = typeof menu._activeTabId === 'function' ? menu._activeTabId() : null;
      const items = menu._contextMenuFunctionItems(activeId);
      return Array.isArray(items) && items.length > 0;
    }
    return false;
  }

  return false;
}

async function _runOriginDefaultTts(eventKind) {
  if (typeof BlueprintsTtsClient === 'undefined') return;
  const messageOverride = _originDefaultTtsMessages[eventKind] || '';
  try {
    await BlueprintsTtsClient.speak({
      text: messageOverride || undefined,
      interrupt: true,
      mode: 'stream',
      eventKind,
      fallbackKind: 'negative',
    });
  } catch (_) {
    // UI fallback should stay silent if wrapper call fails.
  }
}

function _handleOriginPrimaryMenu(payload) {
  if (!_originEventHasAssignedAction('tap')) {
    _runOriginDefaultTts('tap');
    return;
  }
  if (typeof OriginMenuStateMachine !== 'undefined') {
    OriginMenuStateMachine.dispatch('tap', payload && payload.button);
  }
}

function _handleOriginLayoutPage(payload) {
  if (!_originEventHasAssignedAction('double_tap')) {
    _runOriginDefaultTts('double_tap');
    return;
  }
  if (typeof OriginMenuStateMachine !== 'undefined') {
    OriginMenuStateMachine.dispatch('doubleTap', payload && payload.button);
  }
}

function _handleOriginContextMenu(payload) {
  if (!_originEventHasAssignedAction('long_press')) {
    _runOriginDefaultTts('long_press');
    return;
  }
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
  switchGroup,
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
  // Hide all group wrappers first, then show only the active one.
  // This is required for SPA navigation (switchGroup called without a page reload)
  // because the early-return paths below would otherwise leave a previously-shown
  // wrapper visible when switching away from it.
  const synthesisWrapper = document.getElementById('synthesisMenuWrapper');
  const probesWrapper    = document.getElementById('probesMenuWrapper');
  const settingsWrapper  = document.getElementById('settingsMenuWrapper');
  if (synthesisWrapper) synthesisWrapper.style.display = 'none';
  if (probesWrapper)    probesWrapper.style.display    = 'none';
  if (settingsWrapper)  settingsWrapper.style.display  = 'none';
  if (group === 'synthesis') {
    if (synthesisWrapper) synthesisWrapper.style.display = '';
    SynthesisMenuConfig.showGroup();
    switchTab('manual-links');
    manualLinksShowView(_manualLinksView);
    SynthesisMenuConfig.updateActiveTab('manual-links-' + _manualLinksView);
    return;
  }
  if (group === 'probes') {
    if (probesWrapper) probesWrapper.style.display = '';
    ProbesMenuConfig.showGroup();
    switchTab('pfsense-dns');
    ProbesMenuConfig.updateActiveTab('pfsense-dns');
    return;
  }
  if (group === 'settings') {
    if (settingsWrapper) settingsWrapper.style.display = '';
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
  if (tab === 'manual-links-tree')     { switchTab('manual-links'); manualLinksShowView('tree');     return; }
  if (tab === 'manual-links-pretext')  { switchTab('manual-links'); manualLinksShowView('pretext');  return; }
  if (tab === 'settings'       && !_settings.length)      loadSettings();
  if (tab === 'settings')                                  { initSoundToggle(); initVolumeSlider(); initTtsSettingsPanel(); }
  if (tab === 'keys')                                      loadKeys();
  if (tab === 'certs')                                     loadCerts();
  if (tab === 'docs' && !_docsAll.length)                  loadDocs();
  if (tab === 'docs-list') { if (!_docsAll.length) loadDocs(); else _docsRenderList(); }
  if (tab === 'docs-images')                               openDocImagesModal();
  if (tab === 'ai-providers' && !_aiProviders.length)      loadAiProviders();
  if (tab === 'nav-items'    && !_navItems.length)         loadNavItems();
  if (tab === 'form-controls' && !_fcItems.length)         loadFormControls();
  if (tab === 'embed-menu'      && !_embedMenuItems.length)   loadEmbedMenuItems();
  if (tab === 'embed-menu-grid') { if (!_embedMenuItems.length) loadEmbedMenuItems(); else renderEmGrid(); }
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

function _applySemanticFontRoleClasses() {
  if (typeof document === 'undefined') return;

  // Most live status labels follow the *-status id convention.
  document.querySelectorAll('[id$="-status"]').forEach((el) => {
    el.classList.add('bp-font-role-status-meta');
  });

  // Error surfaces commonly use .error-msg or *-error ids.
  document.querySelectorAll('.error-msg, [id$="-error"]').forEach((el) => {
    el.classList.add('bp-font-role-status-fail');
  });
}

/* ── Bootstrap ────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  _applySemanticFontRoleClasses();
  if (!localStorage.getItem(_LS_SECRET_KEY)) { openApiKeyModal(); }
  if (typeof SoundManager !== 'undefined') SoundManager.init();
  if (typeof FormControlManager !== 'undefined') { FormControlManager.init(); FormControlManager.load(); }
  if (typeof HubModal !== 'undefined') HubModal.init();
  const _urlGroup = new URLSearchParams(window.location.search).get('group');
  const _urlTab = new URLSearchParams(window.location.search).get('tab');
  if (_urlGroup && ['synthesis', 'probes', 'settings'].includes(_urlGroup)) switchGroup(_urlGroup);
  if (_urlTab) {
    switchTab(_urlTab);
    if (_urlGroup === 'synthesis' && typeof SynthesisMenuConfig !== 'undefined') SynthesisMenuConfig.updateActiveTab(_urlTab);
    if (_urlGroup === 'probes' && typeof ProbesMenuConfig !== 'undefined') ProbesMenuConfig.updateActiveTab(_urlTab);
    if (_urlGroup === 'settings' && typeof SettingsMenuConfig !== 'undefined') SettingsMenuConfig.updateActiveTab(_urlTab);
  }
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
  // On mobile form factor, open the clock on every fresh page load / web app launch.
  // Only fires when no ?tab= or ?group= URL param is directing to a specific page.
  // Tab navigation inside the SPA never reloads the page so this never interferes.
  if (!_urlTab && !_urlGroup && _isMobileFormFactor()) {
    window.setTimeout(() => {
      if (typeof window.openClockOverlay === 'function') window.openClockOverlay();
    }, 0);
  }
  // Re-show the clock when the user returns to the app from another app / screen lock.
  // visibilitychange only fires on OS-level focus changes (never from in-app interactions
  // like dismissing the clock overlay), so this is safe.  Guard avoids resetting the
  // overlay when the user returns without having dismissed it first.
  if (_isMobileFormFactor()) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const overlayEl = document.getElementById('clock-overlay');
      if (overlayEl && overlayEl.classList.contains('is-active')) return; // already showing
      if (typeof window.openClockOverlay === 'function') window.openClockOverlay();
    });
  }
});
