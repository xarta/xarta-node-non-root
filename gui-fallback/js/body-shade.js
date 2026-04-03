/* ── Body Shade — pull-up content shade (all screen sizes) ──────────────────
   Self-contained IIFE module. No external dependencies.
   Works on every screen size — touch (mobile) + mouse (desktop).

   Handles live INSIDE tab panels at the data boundary.
   The handle is a child of .body-shade and moves with the shade automatically.
   Only .body-shade receives the --shade-y / translateY transform.

   States:
     down (default)  → shade in normal flow, translateY=0
     dragging        → translateY tracks pointer; transition suppressed
     up              → shade held at translateY(-maxTravel), is-up class applied

  No position:fixed switching. The shade stays in normal document flow.
  For fill sizing, the module measures from scrollY=0 so the handle/fill top
  offsets are stable even after mobile viewport or browser-chrome changes.

   Tab switching:
     window.switchTab is patched at init time (body-shade.js loads before
     app.js, so patch is in place before app.js DOMContentLoaded fires).
──────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var SNAP_VELO  = 250;  // px/s — velocity threshold for fast-flick snap
  var TRANSITION = 300;  // ms — must match CSS transition duration
  var LONG_PRESS_MS = 200;
  var DRAG_ACTIVATE_PX = 3;
  var LONG_PRESS_MOVE_PX = 12;

  var shade;
  var handle    = null;  // active handle (inside currently visible tab panel)
  var shadeY    = 0;     // current translateY (0 = down, negative = up)
  var maxTravel = 0;     // max distance shade can travel upward
  var isUp      = false;
  var _fillTimer = null;
  var _fillSettleTimers = [];

  var dragging      = false;
  var dragMoved     = false;
  var dragStartedUp = false;
  var pendingUpRelease = false;
  var suppressEndDrag = false;
  var startPointerY = 0;
  var startShadeY   = 0;
  var lastPointerY  = 0;
  var lastPointerT  = 0;
  var vel           = 0;   // px/s, EMA (negative = moving up)
  var longPressTimer = null;

  function clearLongPressTimer() {
    if (!longPressTimer) return;
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  function getActiveMenuConfig() {
    var wrappers = [
      { id: 'synthesisMenuWrapper', cfg: function () { return (typeof SynthesisMenuConfig !== 'undefined') ? SynthesisMenuConfig : null; } },
      { id: 'probesMenuWrapper', cfg: function () { return (typeof ProbesMenuConfig !== 'undefined') ? ProbesMenuConfig : null; } },
      { id: 'settingsMenuWrapper', cfg: function () { return (typeof SettingsMenuConfig !== 'undefined') ? SettingsMenuConfig : null; } },
    ];
    for (var i = 0; i < wrappers.length; i += 1) {
      var ref = wrappers[i];
      var el = document.getElementById(ref.id);
      if (!el) continue;
      if (window.getComputedStyle(el).display === 'none') continue;
      var cfg = ref.cfg();
      if (cfg && typeof cfg.openContextMenuAt === 'function') return cfg;
    }
    return null;
  }

  function openContextMenuFromHandle() {
    if (!handle) return false;
    var menu = getActiveMenuConfig();
    if (!menu) return false;
    return !!menu.openContextMenuAt(handle);
  }

  function armLongPress() {
    clearLongPressTimer();
    longPressTimer = setTimeout(function () {
      longPressTimer = null;
      if (!dragging) return;
      var opened = openContextMenuFromHandle();
      if (!opened) return;

      suppressEndDrag = true;
      dragging = false;
      if (handle) handle.classList.remove('is-grabbing');
      shade.classList.remove('is-dragging');

      if (dragStartedUp && !dragMoved) {
        applyTranslate(-maxTravel, true);
        enterUp();
      } else {
        applyTranslate(0, false);
        document.body.classList.remove('shade-is-up');
      }
    }, LONG_PRESS_MS);
  }
  function getShadeBottomClearance() {
    if (window.matchMedia && (window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 768)) {
      return 8;
    }
    return 0;
  }

  function getViewportHeight() {
    if (window.visualViewport && Number.isFinite(window.visualViewport.height) && window.visualViewport.height > 0) {
      return window.visualViewport.height;
    }
    return window.innerHeight || document.documentElement.clientHeight || 0;
  }

  function updateViewportVars() {
    var viewportH = getViewportHeight();
    var bottomClearance = getShadeBottomClearance();
    var shadeUpMaxH = Math.max(50, Math.round(viewportH - 20));
    document.documentElement.style.setProperty('--shade-up-max-h', shadeUpMaxH + 'px');
    document.documentElement.style.setProperty('--shade-bottom-clearance', bottomClearance + 'px');
  }

    /* ── Compute maxTravel for the current handle ───────────────────────────── */
    /* maxTravel = pixels the shade must slide up so the handle reaches the
      top of the viewport (y=0). Measured at scrollY=0 so fill-table sizing and
      handle travel use stable natural-state coordinates. */
  function computeMaxTravel() {
    if (!handle) return 0;
    if (window.scrollY !== 0) window.scrollTo(0, 0);
    return Math.max(0, handle.getBoundingClientRect().top);
  }

  /* ── Apply translateY to shade only (handle rides along as a child) ────── */
  function applyTranslate(y, instant) {
    shadeY = y;
    shade.classList.toggle('is-dragging', instant);
    shade.style.setProperty('--shade-y', y + 'px');
  }

  /* ── Mark shade as held-up (translateY already at -maxTravel) ───────────── */
  function enterUp() {
    isUp = true;
    shade.classList.add('is-up');
    if (handle) handle.classList.add('is-up');
    shade.classList.remove('is-dragging');
    if (handle) handle.classList.remove('is-dragging');
    document.body.classList.add('shade-is-up');
    document.dispatchEvent(new CustomEvent('bodyshadechange', { detail: { isUp: true } }));
    // Shade has settled at top — resize the fill table to the new position.
    sizeActivePane();
  }

  /* ── Release held-up state (shade stays at same translateY visually) ────── */
  function exitUp() {
    shade.classList.remove('is-up');
    if (handle) handle.classList.remove('is-up');
    isUp = false;
    document.body.classList.remove('shade-is-up');
    document.dispatchEvent(new CustomEvent('bodyshadechange', { detail: { isUp: false } }));
    // shadeY and --shade-y are already set to -maxTravel; leave them as-is
    // so when drag resumes the position is continuous.
  }

  /* ── Shared drag start (touch and mouse) ───────────────────────────────── */
  function startDrag(clientY) {
    if (!handle) return false;
    dragMoved = false;
    dragStartedUp = isUp;
    pendingUpRelease = false;
    suppressEndDrag = false;
    if (isUp) {
      // Keep shade-up visuals on initial contact; only release when movement
      // indicates an intentional drag.
      pendingUpRelease = true;
      if (maxTravel <= 0) maxTravel = computeMaxTravel();
      startShadeY = shadeY;   // shadeY == -maxTravel
    } else {
      // Hide header and menu zone immediately on drag-start so fixed/stacked
      // elements don't paint over the shade during the drag animation.
      document.body.classList.add('shade-is-up');
      var prevScrollY = window.scrollY;
      maxTravel   = computeMaxTravel();
      startShadeY = shadeY;
      // If computeMaxTravel scrolled the page to top, the handle jumped in the
      // viewport.  Re-anchor so the first moveDrag delta starts from zero.
      if (prevScrollY !== 0) {
        clientY = handle.getBoundingClientRect().top + handle.offsetHeight / 2;
      }
    }
    dragging      = true;
    startPointerY = clientY;
    lastPointerY  = clientY;
    lastPointerT  = Date.now();
    vel           = 0;
    handle.classList.add('is-grabbing');
    armLongPress();
    return true;
  }

  /* ── Shared drag move ───────────────────────────────────────────────────── */
  function moveDrag(clientY) {
    var delta = clientY - startPointerY;
    var absDelta = Math.abs(delta);
    if (absDelta > LONG_PRESS_MOVE_PX) clearLongPressTimer();
    if (absDelta >= DRAG_ACTIVATE_PX) {
      dragMoved = true;
      clearLongPressTimer();
    }

    if (pendingUpRelease) {
      if (absDelta < DRAG_ACTIVATE_PX) return;
      exitUp();
      pendingUpRelease = false;
      // Re-anchor movement after releasing shade-up so drag starts smoothly.
      startPointerY = clientY;
      lastPointerY = clientY;
      lastPointerT = Date.now();
      startShadeY = shadeY;
      delta = 0;
    }

    var now = Date.now();
    var dt  = now - lastPointerT;
    if (dt > 0) {
      var inst = (clientY - lastPointerY) / (dt / 1000);
      vel = vel * 0.6 + inst * 0.4;
    }
    lastPointerY = clientY;
    lastPointerT = now;
    var newY = Math.min(0, Math.max(-maxTravel, startShadeY + delta));
    applyTranslate(newY, true);
  }

  /* ── Shared drag end ────────────────────────────────────────────────────── */
  function endDrag() {
    clearLongPressTimer();
    if (suppressEndDrag) {
      suppressEndDrag = false;
      return;
    }
    if (!dragging) return;
    dragging = false;
    if (handle) handle.classList.remove('is-grabbing');

    // No real drag happened while shade was up — keep current state unchanged.
    if (pendingUpRelease && !dragMoved) {
      pendingUpRelease = false;
      return;
    }
    pendingUpRelease = false;

    if (maxTravel <= 0) {
      applyTranslate(0, false);
      return;
    }

    var goUp = Math.abs(vel) >= SNAP_VELO
      ? vel < 0
      : shadeY < -(maxTravel * 0.5);

    if (goUp) {
      applyTranslate(-maxTravel, false);
      // After transition completes, lock the up state
      setTimeout(enterUp, TRANSITION);
    } else {
      applyTranslate(0, false);
      // Snap went down — restore header and menu zone.
      document.body.classList.remove('shade-is-up');
      // After the CSS transition settles, resize fill table to restored position.
      setTimeout(sizeActivePane, TRANSITION + 50);
    }
  }

  /* ── Touch handlers ─────────────────────────────────────────────────────── */
  function onTouchStart(e) {
    if (e.touches.length !== 1) return;
    if (e.cancelable) e.preventDefault();
    startDrag(e.touches[0].clientY);
  }

  function onTouchMove(e) {
    if (!dragging || e.touches.length !== 1) return;
    if (e.cancelable) e.preventDefault();
    moveDrag(e.touches[0].clientY);
  }

  function onTouchEnd() { endDrag(); }

  /* ── Mouse handlers (desktop drag) ─────────────────────────────────────── */
  function onMouseDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    if (startDrag(e.clientY)) {
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup',   onMouseUp);
    }
  }

  function onMouseMove(e) {
    if (!dragging) return;
    moveDrag(e.clientY);
  }

  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup',   onMouseUp);
    endDrag();
  }

  /* ── Bind all drag events to a handle element ───────────────────────────── */
  function bindHandle(el) {
    if (!el) return;
    el.addEventListener('touchstart',  onTouchStart, { passive: false });
    el.addEventListener('touchmove',   onTouchMove,  { passive: false });
    el.addEventListener('touchend',    onTouchEnd,   { passive: true });
    el.addEventListener('touchcancel', onTouchEnd,   { passive: true });
    el.addEventListener('mousedown',   onMouseDown);
  }

  /* ── Update active handle when tab switches ─────────────────────────────── */
  function setActiveHandle(tabId) {
    var panel     = document.getElementById('tab-' + tabId);
    var newHandle = panel ? panel.querySelector('.body-shade-handle') : null;
    if (newHandle === handle) return;

    // Snap shade back to down before switching tab context
    if (isUp) {
      exitUp();
    }
    shade.classList.remove('is-dragging');
    applyTranslate(0, false);
    if (handle) handle.classList.remove('is-up', 'is-grabbing', 'is-dragging');

    handle    = newHandle;
    maxTravel = 0;  // will be recomputed on next drag-start
  }

    /* ── Size the fill table in the active panel ───────────────────────────────
      Measure where .table-wrap--fill starts on screen, then set its height to
      fill the remaining viewport minus the pager. This is intentionally re-run
      after tab switches, shade state changes, resize/orientation changes, and
      short follow-up settle delays for mobile viewport stabilization. ── */
  function sizeFillTable() {
    var panel = shade ? shade.querySelector('.tab-panel--fill.active') : null;
    // Only lock page scroll for fill tabs when the handle is already reachable.
    // If intro content pushes the handle below the viewport on short screens,
    // keep normal page scroll available so the user can reach the handle first.
    document.body.classList.toggle('has-fill-tab', shouldLockFillBodyScroll(panel));
    if (!panel) return;
    var fill = panel.querySelector('.table-wrap--fill');
    if (!fill) return;
    var pager = panel.querySelector('.table-pager');
    var pagerH = pager && !pager.hidden ? pager.offsetHeight : 0;
    // getBoundingClientRect gives viewport-relative position.
    // has-fill-tab sets overflow:hidden so scroll is locked at 0 — accurate.
    var top = Math.max(0, fill.getBoundingClientRect().top);
    fill.style.height = Math.max(50, getViewportHeight() - top - pagerH) + 'px';
  }

  function shouldLockFillBodyScroll(panel) {
    if (!panel) return false;
    if (document.body.classList.contains('shade-is-up')) return false;
    if (window.scrollY > 0) return false;
    var panelHandle = panel.querySelector('.body-shade-handle');
    if (!panelHandle) return true;
    return panelHandle.getBoundingClientRect().top <= (getViewportHeight() - 20);
  }

  function sizeDocsPane() {
    var panel = document.getElementById('tab-docs');
    var editor = document.getElementById('docs-editor');
    var preview = document.getElementById('docs-preview');
    if (!panel || !editor || !preview) return;

    var isShadeUp = document.body.classList.contains('shade-is-up');
    if (!panel.classList.contains('active') || (window.innerWidth <= 600 && !isShadeUp)) {
      [editor, preview].forEach(function (el) {
        el.style.height = '';
        el.style.maxHeight = '';
        el.style.minHeight = '';
      });
      return;
    }

    var visible = preview.style.display !== 'none' ? preview : editor;
    var top = visible.getBoundingClientRect().top;
    var height = Math.max(140, getViewportHeight() - top - 20);

    [editor, preview].forEach(function (el) {
      el.style.height = height + 'px';
      el.style.minHeight = height + 'px';
      el.style.maxHeight = height + 'px';
    });
  }

  function sizeShadeUpScrollablePane() {
    var panel = shade ? shade.querySelector('.tab-panel.active') : null;
    if (!panel) return;

    var viewportH = getViewportHeight();
    var isShadeUp = document.body.classList.contains('shade-is-up');

    panel.querySelectorAll('.tab-scroll-shell').forEach(function (shell) {
      if (!isShadeUp) {
        shell.style.maxHeight = '';
        shell.style.overflow = '';
        return;
      }
      var top = shell.getBoundingClientRect().top;
      shell.style.maxHeight = Math.max(50, Math.round(viewportH - top)) + 'px';
      shell.style.overflow = 'auto';
    });

    panel.querySelectorAll('.table-wrap').forEach(function (wrap) {
      if (wrap.classList.contains('table-wrap--fill')) return;

      if (wrap.closest('.tab-scroll-shell')) {
        if (isShadeUp) {
          wrap.style.maxHeight = 'none';
          wrap.style.overflow = 'visible';
        } else {
          wrap.style.maxHeight = '';
          wrap.style.overflow = '';
        }
        return;
      }

      if (!isShadeUp) {
        wrap.style.maxHeight = '';
        return;
      }

      var top = wrap.getBoundingClientRect().top;
      wrap.style.maxHeight = Math.max(50, Math.round(viewportH - top - 20)) + 'px';
    });
  }

  function sizeActivePane() {
    updateViewportVars();
    sizeFillTable();
    sizeDocsPane();
    sizeShadeUpScrollablePane();
  }

  function scheduleSizeFillTable() {
    _fillSettleTimers.forEach(clearTimeout);
    _fillSettleTimers = [];
    clearTimeout(_fillTimer);
    // First pass: near-immediate for normal tab switches.
    _fillTimer = setTimeout(sizeActivePane, 50);

    // Follow-up passes: mobile emulation/orientation changes can settle the
    // visual viewport, menu-zone height, and browser chrome slightly later.
    // Re-measure a few times with short delays so the active fill tab lands on
    // the correct final height without requiring a manual shade drag.
    [180, 360, 700].forEach(function (delay) {
      _fillSettleTimers.push(setTimeout(sizeActivePane, delay));
    });
  }

  /* ─────────────────────────────────────────────────────────────────────── */
  function init() {
    shade = document.getElementById('body-shade');
    if (!shade) return;

    // Track header height and expose as --header-h so .menu-zone can
    // sticky-pin immediately below the header on all screen sizes.
    var siteHeader = document.querySelector('header');
    if (siteHeader && window.ResizeObserver) {
      var updateHeaderH = function () {
        document.documentElement.style.setProperty('--header-h', siteHeader.offsetHeight + 'px');
      };
      updateHeaderH();
      var roHeader = new ResizeObserver(updateHeaderH);
      roHeader.observe(siteHeader);
    }

    // Resize fill table on window resize (e.g. orientation change).
    window.addEventListener('resize', scheduleSizeFillTable);
    window.addEventListener('scroll', scheduleSizeFillTable, { passive: true });
    window.addEventListener('orientationchange', scheduleSizeFillTable);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', scheduleSizeFillTable);
    }

    // Bind drag events to every handle inside the shade
    shade.querySelectorAll('.body-shade-handle').forEach(bindHandle);

    // Set the initially active tab's handle
    var activePanel = shade.querySelector('.tab-panel.active');
    handle = activePanel ? activePanel.querySelector('.body-shade-handle') : null;

    // Initial fill-table sizing (deferred so the page has fully laid out).
    scheduleSizeFillTable();

    // Patch window.switchTab to track handle changes on tab navigation.
    // We query the DOM after the switch rather than using the tab ID, so that
    // alias IDs (e.g. 'manual-links-table' → tab-manual-links) work correctly.
    if (typeof window.switchTab === 'function') {
      var orig = window.switchTab;
      window.switchTab = function (tab) {
        orig.apply(this, arguments);
        // Find whichever panel is now active and adopt its handle
        var activePanel = shade.querySelector('.tab-panel.active');
        var newHandle   = activePanel ? activePanel.querySelector('.body-shade-handle') : null;
        if (newHandle !== handle) {
          if (isUp) exitUp();
          shade.classList.remove('is-dragging');
          applyTranslate(0, false);
          if (handle) handle.classList.remove('is-up', 'is-grabbing', 'is-dragging');
          handle    = newHandle;
          maxTravel = 0;
        }
        // Resize fill table for the newly active panel.
        scheduleSizeFillTable();
      };
    }
  }

  // Snap the shade back to the down position from outside the module.
  // Does NOT change the active handle — shade stays on the same tab panel.
  //
  // opts.instant = true  → suppress the CSS transition so the snap is
  //   imperceptible (same frame). The is-dragging class is removed in the
  //   next animation frame so the transition is re-enabled for the subsequent
  //   snapUp() animation without triggering a spurious downward transition.
  //   Use this when you intend to call snapUp() after new content renders.
  //
  // opts.instant = false (default) → 300ms animated snap down (existing
  //   behaviour — unchanged from before).
  function snapDown(opts) {
    if (!shade) return;
    var instant = !!(opts && opts.instant);
    if (isUp) exitUp();
    if (instant) {
      // Add is-dragging (transition:none) and set --shade-y:0 in the same
      // JS execution so the browser batches them into one instant paint.
      shade.classList.add('is-dragging');
      shade.style.setProperty('--shade-y', '0px');
      shadeY = 0;
      // Remove is-dragging in the NEXT animation frame — not the same
      // execution — so the instant snap is committed before the transition
      // is re-enabled. Without the rAF, all three changes are batched and
      // the browser sees is-dragging=false at paint time → uses transition.
      requestAnimationFrame(function () { shade.classList.remove('is-dragging'); });
    } else {
      applyTranslate(0, false);
    }
    if (handle) handle.classList.remove('is-up', 'is-grabbing', 'is-dragging');
    maxTravel = 0; // force recompute on next drag-start from new settled layout
  }

  // Re-raise the shade to the up position after doc navigation,
  // recomputing maxTravel from the freshly rendered layout.
  // getBoundingClientRect() inside computeMaxTravel() forces a layout
  // recalculation so values are accurate immediately after a DOM update.
  function snapUp() {
    if (!shade || !handle) return;
    if (isUp) return; // already up — nothing to do
    maxTravel = computeMaxTravel();
    if (maxTravel <= 0) return;
    applyTranslate(-maxTravel, false); // animate up via CSS transition (300ms)
    setTimeout(enterUp, TRANSITION);   // lock up state once animation settles
  }

  window.BodyShade = window.BodyShade || {};
  window.BodyShade.sizeFillTable = sizeFillTable;
  window.BodyShade.scheduleSizeFillTable = scheduleSizeFillTable;
  window.BodyShade.sizeActivePane = sizeActivePane;
  window.BodyShade.sizeDocsPane = sizeDocsPane;
  window.BodyShade.snapDown = snapDown;
  window.BodyShade.snapUp = snapUp;

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();

}());
