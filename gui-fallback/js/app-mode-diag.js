(function () {
  var LS_APP_MODE_DIAG_VISIBLE = 'bp_app_mode_diag_visible';

  function displayMode() {
    if (window.matchMedia('(display-mode: fullscreen)').matches) return 'fullscreen';
    if (window.matchMedia('(display-mode: standalone)').matches) return 'standalone';
    if (window.matchMedia('(display-mode: minimal-ui)').matches) return 'minimal-ui';
    if (window.matchMedia('(display-mode: browser)').matches) return 'browser';
    return 'unknown';
  }

  function orientationText() {
    var so = screen.orientation && screen.orientation.type;
    if (so) return so;
    return window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape';
  }

  function safeTopPx() {
    var probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;padding-top:env(safe-area-inset-top,0px)';
    document.body.appendChild(probe);
    var value = getComputedStyle(probe).paddingTop || '0px';
    probe.remove();
    return value;
  }

  function refresh() {
    var chip = document.getElementById('app-mode-diag');
    if (!chip) return;
    var profileApi = window.BlueprintsDeviceProfile || null;
    var profileId = profileApi && profileApi.profileId ? profileApi.profileId : 'none';
    var profileSource = profileApi && profileApi.source ? profileApi.source : 'none';
    var vv = window.visualViewport;
    var vw = vv ? Math.round(vv.width) : window.innerWidth;
    var vh = vv ? Math.round(vv.height) : window.innerHeight;
    chip.textContent =
      'profile=' + profileId +
      ' (' + profileSource + ')' +
      ' | ' +
      'mode=' + displayMode() +
      ' | orient=' + orientationText() +
      ' | viewport=' + vw + 'x' + vh +
      ' | safeTop=' + safeTopPx();
  }

  function isVisible() {
    try {
      return localStorage.getItem(LS_APP_MODE_DIAG_VISIBLE) !== '0';
    } catch (_) {
      return true;
    }
  }

  function applyVisibility() {
    var chip = document.getElementById('app-mode-diag');
    if (!chip) return;
    chip.hidden = !isVisible();
  }

  window.addEventListener('resize', refresh, { passive: true });
  window.addEventListener('orientationchange', refresh, { passive: true });
  window.addEventListener('bp:app-mode-diag-visibility', function (e) {
    try {
      if (e && e.detail && typeof e.detail.visible === 'boolean') {
        localStorage.setItem(LS_APP_MODE_DIAG_VISIBLE, e.detail.visible ? '1' : '0');
      }
    } catch (_) {}
    applyVisibility();
    refresh();
  });
  window.addEventListener('storage', function (e) {
    if (e.key !== LS_APP_MODE_DIAG_VISIBLE) return;
    applyVisibility();
    refresh();
  });
  if (screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener('change', refresh);
  }
  document.addEventListener('visibilitychange', function () {
    applyVisibility();
    refresh();
  });
  document.addEventListener('DOMContentLoaded', function () {
    applyVisibility();
    refresh();
  });
  applyVisibility();
  refresh();
})();
