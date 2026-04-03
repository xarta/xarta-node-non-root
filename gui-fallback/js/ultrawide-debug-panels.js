/* ================================================================
   ultrawide-debug-panels.js

   Utility-space panel host with one initial panel:
   - pfSense DNS IP column resize debugger (table 08, column ip_address)

   Design goals:
   - self-contained and easy to extend with more panel registrations
   - no dependency on app internals beyond public DOM/apiFetch hooks
   - freeze/reset controls
   ================================================================ */
(function () {
  'use strict';

  var PANEL_HOST_ID = 'uw-debug-panel-host';
  var PANEL_CTRL_ID = 'uw-debug-panel-ctrl';
  var PANEL_ENABLE_ID = 'uw-debug-enable';
  var PANEL_NAV_ID = 'uw-debug-panel-nav';
  var PANEL_BODY_ID = 'uw-debug-panel-body';
  var STORAGE_KEY = 'uwDebugPanels.activePanel';

  var panels = [];
  var panelMap = Object.create(null);
  var activePanelId = null;
  var activePanelInstance = null;
  var debugEnabled = false;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function panelById(id) {
    return panelMap[id] || null;
  }

  function readActivePanelId() {
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function writeActivePanelId(id) {
    try {
      localStorage.setItem(STORAGE_KEY, String(id || ''));
    } catch (_) {}
  }

  function getPanelBodyEl() {
    return document.getElementById(PANEL_BODY_ID);
  }

  function getPanelCtrlEl() {
    return document.getElementById(PANEL_CTRL_ID);
  }

  function getEnableBtnEl() {
    return document.getElementById(PANEL_ENABLE_ID);
  }

  function getPanelNavEl() {
    return document.getElementById(PANEL_NAV_ID);
  }

  function renderNav() {
    var nav = getPanelNavEl();
    if (!nav) return;
    nav.innerHTML = panels.map(function (panel) {
      var active = panel.id === activePanelId ? ' is-active' : '';
      return '<button type="button" class="uw-debug-nav-btn' + active + '" data-uw-debug-panel="' + esc(panel.id) + '">'
        + esc(panel.title) + '</button>';
    }).join('');
  }

  function unmountActivePanel() {
    if (activePanelInstance && typeof activePanelInstance.unmount === 'function') {
      activePanelInstance.unmount();
    }
    activePanelInstance = null;
    var body = getPanelBodyEl();
    if (body) body.innerHTML = '';
  }

  function renderHostState() {
    var ctrl = getPanelCtrlEl();
    var nav = getPanelNavEl();
    var body = getPanelBodyEl();
    var btn = getEnableBtnEl();
    if (!ctrl || !nav || !body || !btn) return;

    btn.textContent = debugEnabled ? 'Disable Debug' : 'Enable Debug';
    btn.classList.toggle('is-frozen', debugEnabled);

    if (!debugEnabled) {
      unmountActivePanel();
      nav.style.display = 'none';
      body.innerHTML = '<div class="uw-debug-empty">Debug panels are disabled. Click Enable Debug to mount hooks and start capture.</div>';
      return;
    }

    nav.style.display = '';
    activatePanel(activePanelId || (panels[0] && panels[0].id) || null);
  }

  function activatePanel(id) {
    var panel = panelById(id);
    if (!panel) return;
    activePanelId = panel.id;
    writeActivePanelId(activePanelId);
    renderNav();
    if (!debugEnabled) return;

    if (activePanelInstance && activePanelInstance.id === panel.id) return;
    unmountActivePanel();

    var body = getPanelBodyEl();
    if (!body) return;
    activePanelInstance = panel;
    panel.mount(body);
  }

  function registerPanel(panel) {
    if (!panel || !panel.id || typeof panel.mount !== 'function') return;
    if (panelMap[panel.id]) return;
    panels.push(panel);
    panelMap[panel.id] = panel;
  }

  function initHost() {
    if (typeof window.UltrawideSidecar === 'undefined' || !window.UltrawideSidecar) return false;

    window.UltrawideSidecar.setTitle('Ultrawide utility panels');
    window.UltrawideSidecar.setHTML(
      '<div id="' + PANEL_HOST_ID + '" class="uw-debug-host">'
      + '  <div id="' + PANEL_CTRL_ID + '" class="uw-debug-controls">'
      + '    <button type="button" class="uw-debug-btn" id="' + PANEL_ENABLE_ID + '">Enable Debug</button>'
      + '  </div>'
      + '  <div id="' + PANEL_NAV_ID + '" class="uw-debug-nav"></div>'
      + '  <div id="' + PANEL_BODY_ID + '" class="uw-debug-body"></div>'
      + '</div>'
    );

    var nav = getPanelNavEl();
    if (nav) {
      nav.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-uw-debug-panel]');
        if (!btn) return;
        activatePanel(btn.getAttribute('data-uw-debug-panel'));
      });
    }

    var enableBtn = getEnableBtnEl();
    if (enableBtn) {
      enableBtn.addEventListener('click', function () {
        debugEnabled = !debugEnabled;
        renderHostState();
      });
    }

    var remembered = readActivePanelId();
    activePanelId = panelById(remembered) ? remembered : (panels[0] && panels[0].id) || null;
    renderNav();
    renderHostState();

    return true;
  }

  function createPfSenseColumnPanel() {
    var TARGET_TABLE_CODE = '08';
    var TARGET_COLUMN_KEY = 'ip_address';

    var state = {
      freeze: false,
      manualCaptureIndex: 0,
      captures: [],
      live: {
        widthPx: null,
        pointerX: null,
        handleX: null,
        deltaX: null,
        lastStage: 'idle',
        minWidth: null,
        maxWidth: null,
        lastTs: null,
      },
      shadeDown: {
        bucket: '--',
        resolveKey: '',
        resolveWidth: null,
        puts: [],
      },
      shadeUp: {
        bucket: '--',
        resolveKey: '',
        resolveWidth: null,
        puts: [],
      },
      _bound: false,
      _raf: null,
      _mounted: false,
      _apiWrapped: false,
      _apiOriginal: null,
    };

    function targetFromShade(shadeUp) {
      return shadeUp ? state.shadeUp : state.shadeDown;
    }

    function findIpHeader() {
      var table = document.getElementById('dns-table');
      if (!table) return null;
      return table.querySelector('thead th[data-col="' + TARGET_COLUMN_KEY + '"]');
    }

    function measureNow() {
      var th = findIpHeader();
      if (!th) {
        state.live.widthPx = null;
        state.live.handleX = null;
        return;
      }
      var rect = th.getBoundingClientRect();
      state.live.widthPx = Math.round(rect.width || 0);
      state.live.handleX = Math.round(rect.right || 0);
    }

    function parseJsonSafe(raw) {
      try {
        return raw ? JSON.parse(raw) : null;
      } catch (_) {
        return null;
      }
    }

    function extractIpColumn(layoutData) {
      if (!layoutData || !Array.isArray(layoutData.columns)) return null;
      return layoutData.columns.find(function (col) {
        return col && col.column_key === TARGET_COLUMN_KEY;
      }) || null;
    }

    function isFiniteNumber(value) {
      return typeof value === 'number' && Number.isFinite(value);
    }

    function toFiniteNumber(value) {
      if (isFiniteNumber(value)) return value;
      if (typeof value === 'string' && value.trim() !== '') {
        var parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    }

    function currentDrift() {
      if (state.live.pointerX == null || state.live.handleX == null) return null;
      return Math.round(state.live.handleX - state.live.pointerX);
    }

    function addCapture(type, meta) {
      if (state.freeze) return;
      var payload = meta || {};
      var bucketGuess = String(payload.bucket || '').toUpperCase();
      if (!bucketGuess) {
        bucketGuess = payload.shadeUp ? (state.shadeUp.bucket || '--') : (state.shadeDown.bucket || '--');
      }
      var capture = {
        seq: state.captures.length + 1,
        ts: Date.now(),
        type: type,
        label: payload.label || type,
        shade: payload.shadeUp ? 'up' : 'down',
        bucket: bucketGuess || '--',
        layoutKey: payload.layoutKey || '',
        widthPx: toFiniteNumber(payload.widthPx) != null ? toFiniteNumber(payload.widthPx) : state.live.widthPx,
        minWidth: toFiniteNumber(payload.minWidth) != null ? toFiniteNumber(payload.minWidth) : state.live.minWidth,
        maxWidth: toFiniteNumber(payload.maxWidth) != null ? toFiniteNumber(payload.maxWidth) : state.live.maxWidth,
        pointerX: toFiniteNumber(payload.pointerX) != null ? toFiniteNumber(payload.pointerX) : state.live.pointerX,
        handleX: toFiniteNumber(payload.handleX) != null ? toFiniteNumber(payload.handleX) : state.live.handleX,
        deltaX: toFiniteNumber(payload.deltaX) != null ? toFiniteNumber(payload.deltaX) : state.live.deltaX,
        drift: toFiniteNumber(payload.drift) != null ? toFiniteNumber(payload.drift) : currentDrift(),
        flags: payload.flags || null,
      };
      state.captures.unshift(capture);
      if (state.captures.length > 120) state.captures.length = 120;
    }

    function recordResolve(payload) {
      if (!payload || String(payload.table_code || '').toUpperCase() !== TARGET_TABLE_CODE) return;
      var layoutData = payload.layout_data || {};
      var ipCol = extractIpColumn(layoutData);
      var shadeUp = !!(layoutData.bucket_flags && layoutData.bucket_flags.shade_up);
      var target = targetFromShade(shadeUp);
      target.resolveKey = String(payload.layout_key || '');
      target.bucket = String(payload.bucket_code || String(target.resolveKey).slice(-2) || '--').toUpperCase();
      target.resolveWidth = ipCol && Number.isFinite(Number(ipCol.width_px)) ? Number(ipCol.width_px) : null;
      if (ipCol) {
        state.live.minWidth = Number.isFinite(Number(ipCol.min_width_px)) ? Number(ipCol.min_width_px) : state.live.minWidth;
        state.live.maxWidth = Number.isFinite(Number(ipCol.max_width_px)) ? Number(ipCol.max_width_px) : state.live.maxWidth;
      }
      addCapture('resolve', {
        label: 'resolve-' + (shadeUp ? 'up' : 'down'),
        shadeUp: shadeUp,
        bucket: target.bucket,
        layoutKey: target.resolveKey,
        widthPx: target.resolveWidth,
        minWidth: ipCol ? ipCol.min_width_px : null,
        maxWidth: ipCol ? ipCol.max_width_px : null,
        flags: layoutData.bucket_flags || null,
      });
    }

    function recordPut(info) {
      if (!info || String(info.tableCode || '').toUpperCase() !== TARGET_TABLE_CODE) return;
      var layoutData = info.layoutData || {};
      var ipCol = extractIpColumn(layoutData);
      if (!ipCol) return;
      var shadeUp = !!(layoutData.bucket_flags && layoutData.bucket_flags.shade_up);
      var target = targetFromShade(shadeUp);
      var bucket = String(info.layoutKey || '').slice(-2).toUpperCase() || '--';
      target.bucket = bucket;
      target.puts.unshift({
        ts: Date.now(),
        layoutKey: String(info.layoutKey || ''),
        bucket: bucket,
        flags: layoutData.bucket_flags || {},
        minWidth: Number.isFinite(Number(ipCol.min_width_px)) ? Number(ipCol.min_width_px) : null,
        maxWidth: Number.isFinite(Number(ipCol.max_width_px)) ? Number(ipCol.max_width_px) : null,
        widthPx: Number.isFinite(Number(ipCol.width_px)) ? Number(ipCol.width_px) : null,
      });
      if (target.puts.length > 40) target.puts.length = 40;
      state.live.minWidth = target.puts[0].minWidth;
      state.live.maxWidth = target.puts[0].maxWidth;

      addCapture('put', {
        label: 'put-' + (shadeUp ? 'up' : 'down'),
        shadeUp: shadeUp,
        bucket: bucket,
        layoutKey: String(info.layoutKey || ''),
        widthPx: ipCol.width_px,
        minWidth: ipCol.min_width_px,
        maxWidth: ipCol.max_width_px,
        flags: layoutData.bucket_flags || null,
      });
    }

    function onResizeDebug(ev) {
      var detail = ev && ev.detail ? ev.detail : null;
      if (!detail) return;
      if (String(detail.tableCode || '').toUpperCase() !== TARGET_TABLE_CODE) return;
      if (detail.columnKey !== TARGET_COLUMN_KEY) return;
      if (state.freeze) return;
      state.live.lastStage = detail.stage || state.live.lastStage;
      state.live.lastTs = detail.ts || Date.now();
      if (toFiniteNumber(detail.pointerX) != null) state.live.pointerX = toFiniteNumber(detail.pointerX);
      if (toFiniteNumber(detail.thRight) != null) state.live.handleX = toFiniteNumber(detail.thRight);
      if (toFiniteNumber(detail.deltaX) != null) state.live.deltaX = toFiniteNumber(detail.deltaX);
      if (toFiniteNumber(detail.nextWidth) != null) state.live.widthPx = toFiniteNumber(detail.nextWidth);
      if (toFiniteNumber(detail.finalWidth) != null) state.live.widthPx = toFiniteNumber(detail.finalWidth);
      if (toFiniteNumber(detail.minWidth) != null) state.live.minWidth = toFiniteNumber(detail.minWidth);
      if (toFiniteNumber(detail.maxWidth) != null) state.live.maxWidth = toFiniteNumber(detail.maxWidth);

      if (detail.stage === 'pointerup-drag') {
        addCapture('drag-end', {
          label: 'drag-end',
          shadeUp: !!detail.shadeUp,
          bucket: detail.shadeUp ? state.shadeUp.bucket : state.shadeDown.bucket,
          widthPx: detail.finalWidth,
          minWidth: detail.minWidth,
          maxWidth: detail.maxWidth,
          pointerX: detail.pointerX,
          handleX: detail.thRight,
          deltaX: detail.deltaX,
          drift: currentDrift(),
        });
      }

      render();
    }

    function onResetClick() {
      state.freeze = false;
      state.manualCaptureIndex = 0;
      state.captures = [];
      state.shadeDown = { bucket: '--', resolveKey: '', resolveWidth: null, puts: [] };
      state.shadeUp = { bucket: '--', resolveKey: '', resolveWidth: null, puts: [] };
      state.live.pointerX = null;
      state.live.deltaX = null;
      state.live.lastStage = 'reset';
      state.live.lastTs = Date.now();
      measureNow();
      render();
    }

    function onFreezeClick() {
      state.freeze = !state.freeze;
      render();
    }

    function onCaptureClick() {
      measureNow();
      addCapture('manual', {
        label: 'capture-' + String(state.manualCaptureIndex),
        shadeUp: !!(document.body && document.body.classList.contains('shade-is-up')),
      });
      state.manualCaptureIndex += 1;
      render();
    }

    function onCopyClick() {
      var payload = {
        generated_at: new Date().toISOString(),
        live: state.live,
        shade_down: state.shadeDown,
        shade_up: state.shadeUp,
        captures: state.captures,
      };
      var text = JSON.stringify(payload, null, 2);
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).catch(function () {});
      }
    }

    function fmt(v) {
      return v == null ? '—' : String(v);
    }

    function fmtTime(ts) {
      if (!ts) return '—';
      var d = new Date(ts);
      return d.toLocaleTimeString();
    }

    function renderPutRows(list) {
      if (!list.length) {
        return '<tr><td colspan="7" class="uw-debug-empty">No captured PUT payloads yet.</td></tr>';
      }
      return list.map(function (item) {
        return '<tr>'
          + '<td>' + esc(fmtTime(item.ts)) + '</td>'
          + '<td>' + esc(item.layoutKey) + '</td>'
          + '<td>' + esc(item.bucket) + '</td>'
          + '<td>' + esc(JSON.stringify(item.flags || {})) + '</td>'
          + '<td>' + esc(fmt(item.minWidth)) + '</td>'
          + '<td>' + esc(fmt(item.maxWidth)) + '</td>'
          + '<td>' + esc(fmt(item.widthPx)) + '</td>'
          + '</tr>';
      }).join('');
    }

    function renderCaptureRows(list) {
      if (!list.length) {
        return '<tr><td colspan="13" class="uw-debug-empty">No captures yet. Use Capture for initial state; drag/resolve/put will auto-capture.</td></tr>';
      }
      return list.map(function (item) {
        return '<tr>'
          + '<td>' + esc(fmt(item.seq)) + '</td>'
          + '<td>' + esc(fmtTime(item.ts)) + '</td>'
          + '<td>' + esc(item.label) + '</td>'
          + '<td>' + esc(item.shade) + '</td>'
          + '<td>' + esc(item.bucket) + '</td>'
          + '<td>' + esc(item.layoutKey || '—') + '</td>'
          + '<td>' + esc(fmt(item.widthPx)) + '</td>'
          + '<td>' + esc(fmt(item.pointerX)) + '</td>'
          + '<td>' + esc(fmt(item.handleX)) + '</td>'
          + '<td>' + esc(fmt(item.drift)) + '</td>'
          + '<td>' + esc(fmt(item.deltaX)) + '</td>'
          + '<td>' + esc(fmt(item.minWidth)) + '</td>'
          + '<td>' + esc(fmt(item.maxWidth)) + '</td>'
          + '</tr>';
      }).join('');
    }

    function renderShadeSection(label, section, shadeClass) {
      return '<section class="uw-debug-section ' + shadeClass + '">'
        + '<div class="uw-debug-section-label">' + esc(label) + '</div>'
        + '<div class="uw-debug-pill-row">'
        + '  <span class="uw-debug-pill">Bucket ' + esc(section.bucket || '--') + '</span>'
        + '  <span class="uw-debug-pill">Resolve key ' + esc(section.resolveKey || '—') + '</span>'
        + '  <span class="uw-debug-pill">Resolve ip ' + esc(fmt(section.resolveWidth)) + '</span>'
        + '</div>'
        + '<div class="uw-debug-table-wrap">'
        + '  <table class="uw-debug-table">'
        + '    <thead><tr><th>Time</th><th>Layout key</th><th>Bucket</th><th>Flags</th><th>Min</th><th>Max</th><th>width_px</th></tr></thead>'
        + '    <tbody>' + renderPutRows(section.puts) + '</tbody>'
        + '  </table>'
        + '</div>'
        + '</section>';
    }

    function render() {
      if (!state._mounted) return;
      var root = document.getElementById('uw-debug-pfsense-root');
      if (!root) return;
      var drift = currentDrift();

      root.innerHTML = ''
        + '<div class="uw-debug-controls">'
        + '  <button type="button" class="uw-debug-btn" id="uw-debug-reset">Reset</button>'
        + '  <button type="button" class="uw-debug-btn ' + (state.freeze ? 'is-frozen' : '') + '" id="uw-debug-freeze">'
        + (state.freeze ? 'Unfreeze' : 'Freeze') + '</button>'
        + '  <button type="button" class="uw-debug-btn" id="uw-debug-capture">Capture</button>'
        + '  <button type="button" class="uw-debug-btn" id="uw-debug-copy">Copy JSON</button>'
        + '  <span class="uw-debug-pill">Target 08 / ip_address</span>'
        + '  <span class="uw-debug-pill">Stage ' + esc(state.live.lastStage) + '</span>'
        + '  <span class="uw-debug-pill">Updated ' + esc(fmtTime(state.live.lastTs)) + '</span>'
        + '</div>'
        + '<section class="uw-debug-live">'
        + '  <div class="uw-debug-section-label">Live Metrics</div>'
        + '  <div class="uw-debug-grid">'
        + '    <div><span>ip width</span><strong>' + esc(fmt(state.live.widthPx)) + '</strong></div>'
        + '    <div><span>pointerX</span><strong>' + esc(fmt(state.live.pointerX)) + '</strong></div>'
        + '    <div><span>handleX</span><strong>' + esc(fmt(state.live.handleX)) + '</strong></div>'
        + '    <div><span>drift</span><strong>' + esc(fmt(drift)) + '</strong></div>'
        + '    <div><span>deltaX</span><strong>' + esc(fmt(state.live.deltaX)) + '</strong></div>'
        + '    <div><span>min/max</span><strong>' + esc(fmt(state.live.minWidth)) + ' / ' + esc(fmt(state.live.maxWidth)) + '</strong></div>'
        + '  </div>'
        + '</section>'
        + renderShadeSection('Body Shade Down', state.shadeDown, 'is-shade-down')
        + renderShadeSection('Body Shade Up', state.shadeUp, 'is-shade-up')
        + '<section class="uw-debug-section uw-debug-capture-log">'
        + '  <div class="uw-debug-section-label">Capture Trace</div>'
        + '  <div class="uw-debug-table-wrap uw-debug-table-wrap--compact">'
        + '    <table class="uw-debug-table uw-debug-table--compact">'
        + '      <thead><tr><th>#</th><th>Time</th><th>Event</th><th>Shade</th><th>Bucket</th><th>Key</th><th>ip</th><th>ptr</th><th>hdl</th><th>drift</th><th>dx</th><th>min</th><th>max</th></tr></thead>'
        + '      <tbody>' + renderCaptureRows(state.captures) + '</tbody>'
        + '    </table>'
        + '  </div>'
        + '</section>';

      var resetBtn = document.getElementById('uw-debug-reset');
      var freezeBtn = document.getElementById('uw-debug-freeze');
      var captureBtn = document.getElementById('uw-debug-capture');
      var copyBtn = document.getElementById('uw-debug-copy');
      if (resetBtn) resetBtn.addEventListener('click', onResetClick);
      if (freezeBtn) freezeBtn.addEventListener('click', onFreezeClick);
      if (captureBtn) captureBtn.addEventListener('click', onCaptureClick);
      if (copyBtn) copyBtn.addEventListener('click', onCopyClick);
    }

    function loopMeasure() {
      if (!state._mounted) return;
      if (!state.freeze) {
        measureNow();
        render();
      }
      state._raf = window.setTimeout(loopMeasure, 180);
    }

    function tableCodeFromLayoutKey(layoutKey) {
      var key = String(layoutKey || '').toUpperCase();
      if (!/^[0-9A-F]{8}$/.test(key)) return '';
      return key.slice(4, 6);
    }

    function attachApiCapture() {
      if (state._apiWrapped) return;
      if (typeof window.apiFetch !== 'function') return;
      state._apiOriginal = window.apiFetch;
      window.apiFetch = async function (url, options) {
        var opts = options || {};
        var method = String((opts.method || 'GET')).toUpperCase();
        var urlText = String(url || '');
        var requestBody = method === 'PUT' || method === 'POST' ? parseJsonSafe(opts.body) : null;

        var response = await state._apiOriginal.apply(this, arguments);

        if (!state._mounted || state.freeze) return response;

        if (/\/api\/v1\/table-layouts\/resolve$/.test(urlText) && method === 'POST') {
          try {
            var resolveJson = await response.clone().json();
            if (resolveJson && String(resolveJson.table_code || '').toUpperCase() === TARGET_TABLE_CODE) {
              recordResolve(resolveJson);
              render();
            }
          } catch (_) {}
        }

        if (/\/api\/v1\/table-layouts\/[A-Fa-f0-9]{8}$/.test(urlText) && method === 'PUT') {
          var layoutKey = urlText.split('/').pop() || '';
          var tableCode = tableCodeFromLayoutKey(layoutKey);
          var layoutData = requestBody && requestBody.layout_data ? requestBody.layout_data : null;
          if (layoutData && tableCode === TARGET_TABLE_CODE) {
            recordPut({
              tableCode: tableCode,
              layoutKey: layoutKey.toUpperCase(),
              layoutData: layoutData,
            });
            render();
          }
        }

        return response;
      };
      state._apiWrapped = true;
    }

    function detachApiCapture() {
      if (!state._apiWrapped) return;
      if (state._apiOriginal) {
        window.apiFetch = state._apiOriginal;
      }
      state._apiWrapped = false;
      state._apiOriginal = null;
    }

    return {
      id: 'pfsense-column-resize',
      title: 'pfSense Column Resize',
      mount: function (el) {
        state._mounted = true;
        el.innerHTML = '<div id="uw-debug-pfsense-root" class="uw-debug-panel"></div>';

        if (!state._bound) {
          state._bound = true;
          window.addEventListener('bp:column-resize-debug', onResizeDebug);
        }
        attachApiCapture();

        onResetClick();
        if (state._raf) clearTimeout(state._raf);
        loopMeasure();
      },
      unmount: function () {
        state._mounted = false;
        state.freeze = false;
        if (state._raf) {
          clearTimeout(state._raf);
          state._raf = null;
        }
        if (state._bound) {
          window.removeEventListener('bp:column-resize-debug', onResizeDebug);
          state._bound = false;
        }
        detachApiCapture();
      },
    };
  }

  function init() {
    registerPanel(createPfSenseColumnPanel());
    initHost();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
