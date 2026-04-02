(function () {
  'use strict';

  var _ROW_ACTION_SEQ = 0;
  var _ROW_ACTIONS = new Map();

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function getLayoutKey() {
    var width = window.innerWidth || document.documentElement.clientWidth || 0;
    var isPortrait = window.matchMedia('(orientation: portrait)').matches;
    if (width <= 600) return isPortrait ? 'mobile-portrait' : 'mobile-landscape';
    if (width <= 900) return isPortrait ? 'tablet-portrait' : 'tablet-landscape';
    if (!isPortrait && width >= 1600) return 'desktop-widescreen';
    return isPortrait ? 'desktop-portrait' : 'desktop-landscape';
  }

  function isShadeUp() {
    return !!(document.body && document.body.classList.contains('shade-is-up'));
  }

  function getPrefsBaseLayoutKey() {
    return getLayoutKey() + '|' + (isShadeUp() ? 'shade-up' : 'shade-down');
  }

  function parseBaseLayoutKey(layoutKey) {
    var raw = String(layoutKey || '');
    var parts = raw.split('|');
    return {
      viewportKey: parts[0] || getLayoutKey(),
      shadeKey: parts[1] === 'shade-up' ? 'shade-up' : 'shade-down',
    };
  }

  function getLegacyLayoutKeys(layoutKey) {
    var parsed = parseBaseLayoutKey(layoutKey);
    var viewportKey = parsed.viewportKey;
    var legacy = [];
    legacy.push(viewportKey);
    if (viewportKey.indexOf('desktop-') === 0 || viewportKey === 'desktop-widescreen') {
      legacy.push('desktop');
    }
    return legacy.filter(function (key, index, arr) {
      return key && arr.indexOf(key) === index;
    });
  }

  function getShadeSiblingLayoutKey(layoutKey) {
    var parsed = parseBaseLayoutKey(layoutKey);
    return parsed.viewportKey + '|' + (parsed.shadeKey === 'shade-up' ? 'shade-down' : 'shade-up');
  }

  function cloneLayoutState(source) {
    if (!source || typeof source !== 'object') return null;
    return {
      hidden: Array.isArray(source.hidden) ? source.hidden.slice() : null,
      widths: source.widths && typeof source.widths === 'object' ? Object.assign({}, source.widths) : {},
      allowHorizontalScroll: Object.prototype.hasOwnProperty.call(source, 'allowHorizontalScroll') ? source.allowHorizontalScroll : null,
      pendingHorizontalClamp: !!source.pendingHorizontalClamp,
    };
  }

  function isCompactLayout() {
    return window.matchMedia('(max-width: 768px)').matches
      || window.matchMedia('(pointer: coarse)').matches;
  }

  function isCoarsePointer() {
    return window.matchMedia('(pointer: coarse)').matches;
  }

  function enableResizeHandlePeek(tableEl) {
    if (!tableEl || tableEl.dataset.resizePeekBound === '1') return;
    tableEl.dataset.resizePeekBound = '1';

    var hideTimer = null;

    function showHandles() {
      tableEl.classList.add('table-resize-handles-visible');
    }

    function scheduleHide(delayMs) {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () {
        tableEl.classList.remove('table-resize-handles-visible');
      }, delayMs);
    }

    function revealTemporarily() {
      if (!isCoarsePointer()) return;
      showHandles();
      scheduleHide(3000);
    }

    tableEl.addEventListener('pointerdown', function (e) {
      var th = e.target.closest('thead th[data-col]');
      if (!th || !tableEl.contains(th)) return;
      revealTemporarily();
    }, { passive: true });

    tableEl.addEventListener('pointerup', function () {
      if (!isCoarsePointer()) return;
      scheduleHide(3000);
    }, { passive: true });

    tableEl.addEventListener('pointercancel', function () {
      if (!isCoarsePointer()) return;
      scheduleHide(3000);
    }, { passive: true });

    tableEl.addEventListener('pointerleave', function () {
      if (!isCoarsePointer()) return;
      scheduleHide(3000);
    }, { passive: true });

    if (typeof window.matchMedia === 'function') {
      var coarseMq = window.matchMedia('(pointer: coarse)');
      var syncPointerMode = function () {
        clearTimeout(hideTimer);
        if (coarseMq.matches) tableEl.classList.remove('table-resize-handles-visible');
        else tableEl.classList.add('table-resize-handles-visible');
      };
      syncPointerMode();
      if (typeof coarseMq.addEventListener === 'function') {
        coarseMq.addEventListener('change', syncPointerMode);
      } else if (typeof coarseMq.addListener === 'function') {
        coarseMq.addListener(syncPointerMode);
      }
    }
  }

  function ensureLayoutState(state, layoutKey, fallbackKeys) {
    if (!state.layouts) state.layouts = {};
    if (!state.layouts[layoutKey]) {
      var seededState = null;
      (fallbackKeys || []).some(function (fallbackKey) {
        if (!fallbackKey || !state.layouts[fallbackKey]) return false;
        seededState = cloneLayoutState(state.layouts[fallbackKey]);
        return !!seededState;
      });
      state.layouts[layoutKey] = seededState || {
        hidden: null,
        widths: {},
        allowHorizontalScroll: null,
        pendingHorizontalClamp: false,
      };
    }
    if (!state.layouts[layoutKey].widths) state.layouts[layoutKey].widths = {};
    if (!Object.prototype.hasOwnProperty.call(state.layouts[layoutKey], 'allowHorizontalScroll')) {
      state.layouts[layoutKey].allowHorizontalScroll = null;
    }
    if (!Object.prototype.hasOwnProperty.call(state.layouts[layoutKey], 'pendingHorizontalClamp')) {
      state.layouts[layoutKey].pendingHorizontalClamp = false;
    }
    return state.layouts[layoutKey];
  }

  function createTablePrefs(cfg) {
    var state = readJson(cfg.storageKey, null);
    var currentLayout = getPrefsBaseLayoutKey();
    var listeners = [];
    var resizeTimer = null;

    if (!state || typeof state !== 'object') {
      state = { layouts: {} };
      if (cfg.legacyHiddenKey) {
        var legacyHidden = readJson(cfg.legacyHiddenKey, null);
        if (Array.isArray(legacyHidden)) {
          ensureLayoutState(state, currentLayout, getLegacyLayoutKeys(currentLayout)).hidden = legacyHidden.slice();
        }
      }
      writeJson(cfg.storageKey, state);
    }

    function persist() {
      writeJson(cfg.storageKey, state);
    }

    function getActualLayoutState(layoutKey) {
      var resolvedLayout = layoutKey || currentLayout;
      return ensureLayoutState(state, resolvedLayout, getLegacyLayoutKeys(resolvedLayout));
    }

    function isHorizontalScrollEnabledForLayout(layoutKey) {
      var resolvedLayout = layoutKey || currentLayout;
      var layout = getActualLayoutState(resolvedLayout);
      if (layout.allowHorizontalScroll === true) return true;
      if (layout.allowHorizontalScroll === false) return false;
      var siblingLayout = state.layouts && state.layouts[getShadeSiblingLayoutKey(resolvedLayout)];
      if (siblingLayout && siblingLayout.allowHorizontalScroll === true) return true;
      if (siblingLayout && siblingLayout.allowHorizontalScroll === false) return false;
      return !!cfg.defaultHorizontalScroll;
    }

    function syncShadeTransitionScrollPreference(fromLayoutKey, toLayoutKey) {
      var fromParsed = parseBaseLayoutKey(fromLayoutKey);
      var toParsed = parseBaseLayoutKey(toLayoutKey);
      if (fromParsed.viewportKey !== toParsed.viewportKey) return false;
      if (fromParsed.shadeKey === toParsed.shadeKey) return false;

      var fromLayout = state.layouts && state.layouts[fromLayoutKey];
      if (!fromLayout || (fromLayout.allowHorizontalScroll !== true && fromLayout.allowHorizontalScroll !== false)) {
        return false;
      }

      var toLayout = getActualLayoutState(toLayoutKey);
      toLayout.allowHorizontalScroll = fromLayout.allowHorizontalScroll;
      toLayout.pendingHorizontalClamp = false;
      persist();
      return true;
    }

    function getEffectiveLayoutKey(layoutKey) {
      var actualLayoutKey = layoutKey || currentLayout;
      return actualLayoutKey + '|' + (isHorizontalScrollEnabledForLayout(actualLayoutKey) ? 'scroll-x' : 'fit');
    }

    function getLayoutState(layoutKey) {
      var resolvedLayout = layoutKey || currentLayout;
      var effectiveLayoutKey = getEffectiveLayoutKey(resolvedLayout);
      var fallbackKeys = getLegacyLayoutKeys(resolvedLayout);
      var siblingKey = effectiveLayoutKey.endsWith('|scroll-x')
        ? effectiveLayoutKey.replace(/\|scroll-x$/, '|fit')
        : effectiveLayoutKey.replace(/\|fit$/, '|scroll-x');
      fallbackKeys.unshift(siblingKey);
      if (isHorizontalScrollEnabledForLayout(resolvedLayout) && parseBaseLayoutKey(resolvedLayout).viewportKey.indexOf('desktop') !== 0) {
        fallbackKeys = fallbackKeys.concat(['desktop']);
      }
      return ensureLayoutState(state, effectiveLayoutKey, fallbackKeys);
    }

    function syncColumns(columns) {
      var known = new Set(columns || []);
      Object.keys(state.layouts || {}).forEach(function (layoutKey) {
        var layout = getActualLayoutState(layoutKey);
        if (Array.isArray(layout.hidden)) {
          layout.hidden = layout.hidden.filter(function (col) { return known.has(col); });
        }
        Object.keys(layout.widths || {}).forEach(function (col) {
          if (!known.has(col)) delete layout.widths[col];
        });
      });
      persist();
    }

    function getHiddenSet(columns) {
      var available = new Set(columns || []);
      var layout = getLayoutState();
      if (Array.isArray(layout.hidden)) {
        return new Set(layout.hidden.filter(function (col) { return available.has(col); }));
      }
      return new Set((cfg.defaultHidden || []).filter(function (col) { return available.has(col); }));
    }

    function setHiddenSet(hiddenSet) {
      var layout = getLayoutState();
      layout.hidden = Array.from(hiddenSet || []);
      persist();
    }

    function getWidth(column) {
      var width = Number(getLayoutState().widths[column]);
      return Number.isFinite(width) && width > 0 ? width : null;
    }

    function setWidth(column, width) {
      var next = Math.round(width);
      if (!Number.isFinite(next) || next <= 0) return;
      getLayoutState().widths[column] = next;
      persist();
    }

    function isHorizontalScrollEnabled() {
      return isHorizontalScrollEnabledForLayout();
    }

    function hasPendingHorizontalClamp() {
      return !!getActualLayoutState().pendingHorizontalClamp;
    }

    function clearPendingHorizontalClamp() {
      var layout = getActualLayoutState();
      if (!layout.pendingHorizontalClamp) return;
      layout.pendingHorizontalClamp = false;
      persist();
    }

    function updateScrollWidth(tableEl) {
      if (!tableEl) return;
      if (!isHorizontalScrollEnabled()) {
        tableEl.style.removeProperty('--table-scroll-width');
        return;
      }
      var totalWidth = 0;
      tableEl.querySelectorAll('thead th[data-col]').forEach(function (th) {
        var explicit = parseFloat(th.style.width || '0');
        var measured = th.getBoundingClientRect().width || 0;
        totalWidth += explicit > 0 ? explicit : measured;
      });
      if (totalWidth > 0) {
        tableEl.style.setProperty('--table-scroll-width', Math.ceil(totalWidth) + 'px');
      }
    }

    function clampOverwideColumns(tableEl) {
      if (!tableEl) return false;
      var viewportWidth = Math.max(
        window.innerWidth || 0,
        document.documentElement ? document.documentElement.clientWidth : 0
      );
      if (!viewportWidth) return false;
      var maxWidth = Math.max(40, Math.floor(viewportWidth * 0.98));
      var changed = false;
      tableEl.querySelectorAll('thead th[data-col]').forEach(function (th) {
        var width = Math.round(th.getBoundingClientRect().width || 0);
        if (!Number.isFinite(width) || width <= viewportWidth) return;
        setWidth(th.dataset.col, maxWidth);
        changed = true;
      });
      if (changed) applyWidths(tableEl);
      return changed;
    }

    function setHorizontalScrollEnabled(enabled) {
      var layout = getActualLayoutState();
      layout.allowHorizontalScroll = !!enabled;
      layout.pendingHorizontalClamp = !!enabled;
      persist();
      return isHorizontalScrollEnabled();
    }

    function toggleHorizontalScroll() {
      return setHorizontalScrollEnabled(!isHorizontalScrollEnabled());
    }

    function applyWidths(tableEl) {
      if (!tableEl) return;
      tableEl.querySelectorAll('thead th[data-col]').forEach(function (th) {
        var width = getWidth(th.dataset.col);
        th.style.width = width ? width + 'px' : th.style.width || '';
      });
      updateScrollWidth(tableEl);
    }

    function bindColumnResize(tableEl, options) {
      if (!tableEl) return;
      var minWidth = (options && options.minWidth) || cfg.minWidth || 40;
      enableResizeHandlePeek(tableEl);
      tableEl.querySelectorAll('thead th[data-col]').forEach(function (th) {
        if (th.querySelector('.table-col-resize')) return;
        var resizer = document.createElement('div');
        resizer.className = 'table-col-resize';
        resizer.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
        });
        resizer.addEventListener('pointerdown', function (e) {
          if (e.button !== undefined && e.button !== 0) return;
          if (e.isPrimary === false) return;
          e.preventDefault();
          e.stopPropagation();

          var startX = e.clientX;
          var startW = th.getBoundingClientRect().width;
          var pointerId = e.pointerId;
          var didDrag = false;
          tableEl.classList.add('table-resize-handles-visible');
          tableEl.dataset.colResizeDragging = '1';
          resizer.classList.add('dragging');
          document.body.classList.add('table-col-resizing');
          if (typeof resizer.setPointerCapture === 'function') {
            try { resizer.setPointerCapture(e.pointerId); } catch (_) {}
          }

          function onMove(ev) {
            if (ev.isPrimary === false) return;
            if (typeof ev.preventDefault === 'function') ev.preventDefault();
            var nextW = Math.max(minWidth, Math.round(startW + (ev.clientX - startX)));
            if (Math.abs(ev.clientX - startX) > 2) didDrag = true;
            th.style.width = nextW + 'px';
          }

          function onUp() {
            delete tableEl.dataset.colResizeDragging;
            if (didDrag) {
              tableEl.dataset.colResizeSuppressUntil = String(Date.now() + 700);
            }
            resizer.classList.remove('dragging');
            document.body.classList.remove('table-col-resizing');
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            resizer.removeEventListener('lostpointercapture', onUp);
            if (typeof resizer.releasePointerCapture === 'function') {
              try { resizer.releasePointerCapture(pointerId); } catch (_) {}
            }
            if (isCoarsePointer()) {
              window.setTimeout(function () {
                tableEl.classList.remove('table-resize-handles-visible');
              }, 3000);
            }
            setWidth(th.dataset.col, th.getBoundingClientRect().width);
            updateScrollWidth(tableEl);
            if (options && typeof options.onResizeEnd === 'function') {
              options.onResizeEnd(th.dataset.col, getWidth(th.dataset.col));
            }
          }

          document.addEventListener('pointermove', onMove, { passive: false });
          document.addEventListener('pointerup', onUp);
          document.addEventListener('pointercancel', onUp);
          resizer.addEventListener('lostpointercapture', onUp);
        });
        th.appendChild(resizer);
      });
    }

    function renderTable(options) {
      options = options || {};
      var tableEl = options.tableEl;
      if (!tableEl && typeof options.getTable === 'function') {
        tableEl = options.getTable();
      }
      if (typeof options.rebuildHead === 'function') {
        options.rebuildHead();
      }
      if (!tableEl && typeof options.getTable === 'function') {
        tableEl = options.getTable();
      }
      if (typeof options.renderBody === 'function') {
        options.renderBody();
      }
      if (!tableEl && typeof options.getTable === 'function') {
        tableEl = options.getTable();
      }
      if (!tableEl) return;
      tableEl.classList.add('table-shared-ui');
      tableEl.classList.toggle('table-shared-ui--scroll-x', isHorizontalScrollEnabled());
      applyWidths(tableEl);
      if (isHorizontalScrollEnabled() && hasPendingHorizontalClamp()) {
        clampOverwideColumns(tableEl);
        clearPendingHorizontalClamp();
      }
      updateScrollWidth(tableEl);
      bindColumnResize(tableEl, {
        minWidth: options.minWidth || minWidth,
        onResizeEnd: options.onResizeEnd,
      });
      if (typeof options.afterBind === 'function') {
        options.afterBind(tableEl);
      }
    }

    function onLayoutChange(listener) {
      if (typeof listener !== 'function') return function () {};
      listeners.push(listener);
      return function () {
        listeners = listeners.filter(function (fn) { return fn !== listener; });
      };
    }

    function handleResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        var nextLayout = getPrefsBaseLayoutKey();
        if (nextLayout === currentLayout) return;
        syncShadeTransitionScrollPreference(currentLayout, nextLayout);
        currentLayout = nextLayout;
        listeners.forEach(function (listener) { listener(nextLayout); });
      }, 120);
    }

    window.addEventListener('resize', handleResize, { passive: true });
    window.addEventListener('orientationchange', handleResize, { passive: true });
    document.addEventListener('bodyshadechange', handleResize, { passive: true });

    return {
      getLayoutKey: getLayoutKey,
      isCompactLayout: isCompactLayout,
      syncColumns: syncColumns,
      getHiddenSet: getHiddenSet,
      setHiddenSet: setHiddenSet,
      getWidth: getWidth,
      setWidth: setWidth,
      getEffectiveLayoutKey: getEffectiveLayoutKey,
      isHorizontalScrollEnabled: isHorizontalScrollEnabled,
      setHorizontalScrollEnabled: setHorizontalScrollEnabled,
      toggleHorizontalScroll: toggleHorizontalScroll,
      applyWidths: applyWidths,
      bindColumnResize: bindColumnResize,
      renderTable: renderTable,
      onLayoutChange: onLayoutChange,
    };
  }

  function renderColumnChooser(listEl, columns, hiddenSet, getLabel) {
    if (!listEl) return;
    listEl.innerHTML = (columns || []).map(function (column) {
      var label = typeof getLabel === 'function' ? getLabel(column) : column;
      var checked = hiddenSet && hiddenSet.has(column) ? '' : 'checked';
      return '<label class="hub-checkbox hub-checkbox--row" style="font-size:13px">'
        + '<input class="hub-checkbox__input" type="checkbox" data-col="' + column + '" ' + checked + ' />'
        + '<span class="hub-checkbox__box" aria-hidden="true"></span>'
        + '<span class="hub-checkbox__label">' + label + '</span>'
        + '</label>';
    }).join('');
  }

  function readHiddenFromChooser(rootEl, baseHiddenSet) {
    var nextHidden = new Set(baseHiddenSet || []);
    if (!rootEl) return nextHidden;
    rootEl.querySelectorAll('input[data-col]').forEach(function (checkbox) {
      if (checkbox.checked) nextHidden.delete(checkbox.dataset.col);
      else nextHidden.add(checkbox.dataset.col);
    });
    return nextHidden;
  }

  function normalizeSortValue(value) {
    if (value == null) return '';
    if (Array.isArray(value)) {
      return value.map(function (item) { return normalizeSortValue(item); }).join(' ');
    }
    if (typeof value === 'number') return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return String(value).toLowerCase();
  }

  function compareSortValues(left, right) {
    var a = normalizeSortValue(left);
    var b = normalizeSortValue(right);
    if (typeof a === 'number' && typeof b === 'number') {
      return a - b;
    }
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  function ensureSortLayoutState(state, layoutKey, defaultKey, defaultDir) {
    if (!state.layouts) state.layouts = {};
    if (!state.layouts[layoutKey]) {
      state.layouts[layoutKey] = {
        key: defaultKey || null,
        dir: defaultKey ? defaultDir : 0,
      };
    }
    if (!state.layouts[layoutKey].key) {
      state.layouts[layoutKey].key = null;
      state.layouts[layoutKey].dir = 0;
    } else if (state.layouts[layoutKey].dir !== 1 && state.layouts[layoutKey].dir !== -1) {
      state.layouts[layoutKey].dir = defaultDir;
    }
    return state.layouts[layoutKey];
  }

  function createTableSort(cfg) {
    cfg = cfg || {};
    var defaultDir = cfg.defaultDir === -1 ? -1 : 1;
    var defaultKey = cfg.defaultKey || null;
    var storageKey = cfg.storageKey || null;
    var persistedState = storageKey ? readJson(storageKey, null) : null;
    var sortKey = defaultKey;
    var sortDir = defaultKey ? defaultDir : 0;

    if (storageKey && (!persistedState || typeof persistedState !== 'object')) {
      persistedState = { layouts: {} };
      writeJson(storageKey, persistedState);
    }

    function persist() {
      if (!storageKey) return;
      writeJson(storageKey, persistedState);
    }

    function getActiveState() {
      if (!storageKey) {
        return {
          key: sortKey,
          dir: sortKey ? sortDir : 0,
        };
      }
      return ensureSortLayoutState(persistedState, getLayoutKey(), defaultKey, defaultDir);
    }

    function getState() {
      var active = getActiveState();
      return {
        key: active.key,
        dir: active.key ? active.dir : 0,
      };
    }

    function toggle(nextKey) {
      var active = getActiveState();
      if (!nextKey) return getState();
      if (active.key === nextKey) {
        active.dir = active.dir === 1 ? -1 : 1;
      } else {
        active.key = nextKey;
        active.dir = defaultDir;
      }
      if (!storageKey) {
        sortKey = active.key;
        sortDir = active.key ? active.dir : 0;
      } else {
        persist();
      }
      return getState();
    }

    function setState(nextKey, nextDir) {
      var active = getActiveState();
      if (!nextKey) {
        active.key = null;
        active.dir = 0;
      } else {
        active.key = nextKey;
        active.dir = nextDir === -1 ? -1 : 1;
      }
      if (!storageKey) {
        sortKey = active.key;
        sortDir = active.dir;
      } else {
        persist();
      }
      return getState();
    }

    function renderLabel(label, key) {
      var activeState = getActiveState();
      var active = activeState.key === key;
      var arrow = active ? (activeState.dir === 1 ? '&#9650;' : '&#9660;') : '&#x21C5;';
      return String(label || '')
        + '<span class="table-sort-arrow' + (active ? ' active' : '') + '" data-sort-arrow="' + key + '">' + arrow + '</span>';
    }

    function syncIndicators(tableEl) {
      if (!tableEl) return;
      var activeState = getActiveState();
      tableEl.querySelectorAll('thead th[data-sort-key]').forEach(function (th) {
        var isActive = th.dataset.sortKey === activeState.key;
        th.classList.add('table-th-sort');
        th.setAttribute('aria-sort', isActive ? (activeState.dir === 1 ? 'ascending' : 'descending') : 'none');
        var arrow = th.querySelector('[data-sort-arrow]');
        if (!arrow) return;
        arrow.classList.toggle('active', isActive);
        arrow.innerHTML = isActive ? (activeState.dir === 1 ? '&#9650;' : '&#9660;') : '&#x21C5;';
      });
    }

    function bind(tableEl, onChange) {
      if (!tableEl || tableEl.dataset.tableSortBound === '1') {
        syncIndicators(tableEl);
        return;
      }
      tableEl.dataset.tableSortBound = '1';
      tableEl.addEventListener('click', function (e) {
        if (tableEl.dataset.colResizeDragging === '1') return;
        var suppressUntil = Number(tableEl.dataset.colResizeSuppressUntil || 0);
        if (suppressUntil && Date.now() < suppressUntil) return;
        var th = e.target.closest('thead th[data-sort-key]');
        if (!th || !tableEl.contains(th)) return;
        toggle(th.dataset.sortKey);
        syncIndicators(tableEl);
        if (typeof onChange === 'function') {
          onChange(getState());
        }
      });
      syncIndicators(tableEl);
    }

    function sortRows(rows, getValue) {
      var next = Array.isArray(rows) ? rows.slice() : [];
      var activeState = getActiveState();
      if (!activeState.key || typeof getValue !== 'function') return next;
      next.sort(function (left, right) {
        return compareSortValues(getValue(left, activeState.key), getValue(right, activeState.key)) * activeState.dir;
      });
      return next;
    }

    return {
      getState: getState,
      toggle: toggle,
      setState: setState,
      bind: bind,
      syncIndicators: syncIndicators,
      renderLabel: renderLabel,
      sortRows: sortRows,
    };
  }

  function createTableView(cfg) {
    cfg = cfg || {};
    var columns = Array.isArray(cfg.columns) ? cfg.columns.slice() : [];
    var fallbackColumn = cfg.fallbackColumn || columns[0] || null;
    var prefs = createTablePrefs({
      storageKey: cfg.storageKey,
      legacyHiddenKey: cfg.legacyHiddenKey,
      defaultHidden: cfg.defaultHidden || [],
      minWidth: cfg.minWidth || 40,
    });
    var sorter = cfg.sort ? createTableSort(cfg.sort) : null;
    var hiddenCols = new Set();

    function getColumns() {
      var next = typeof cfg.getColumns === 'function' ? cfg.getColumns() : columns;
      return Array.isArray(next) ? next.slice() : [];
    }

    function syncColumns() {
      var nextCols = getColumns();
      prefs.syncColumns(nextCols);
      hiddenCols = prefs.getHiddenSet(nextCols);
      return nextCols;
    }

    function getHiddenSet() {
      syncColumns();
      return new Set(hiddenCols);
    }

    function getVisibleCols() {
      var nextCols = syncColumns();
      var visible = nextCols.filter(function (col) { return !hiddenCols.has(col); });
      if (visible.length) return visible;
      if (fallbackColumn) return [fallbackColumn];
      return nextCols.length ? [nextCols[0]] : [];
    }

    function getMeta(col) {
      if (typeof cfg.getMeta === 'function') return cfg.getMeta(col);
      if (cfg.meta && cfg.meta[col]) return cfg.meta[col];
      return { label: col };
    }

    function rebuildHead() {
      var table = typeof cfg.getTable === 'function' ? cfg.getTable() : null;
      if (!table) return;
      var tr = table.querySelector('thead tr');
      if (!tr) return;
      tr.innerHTML = getVisibleCols().map(function (col) {
        var meta = getMeta(col) || { label: col };
        var width = prefs.getWidth(col);
        var styleParts = [];
        if (width) {
          styleParts.push('width:' + width + 'px');
        } else if (typeof cfg.getDefaultWidth === 'function') {
          var defaultWidth = cfg.getDefaultWidth(col);
          if (defaultWidth) styleParts.push('width:' + defaultWidth + 'px');
        }
        if (typeof cfg.getHeaderStyle === 'function') {
          var extraStyle = cfg.getHeaderStyle(col, width, meta);
          if (extraStyle) styleParts.push(extraStyle);
        }
        var style = styleParts.length ? ' style="' + styleParts.join(';') + '"' : '';
        var sortAttrs = meta.sortKey ? ' data-sort-key="' + meta.sortKey + '"' : '';
        var classAttr = meta.sortKey ? ' class="table-th-sort"' : '';
        var labelHtml = sorter && meta.sortKey ? sorter.renderLabel(meta.label, meta.sortKey) : meta.label;
        return '<th data-col="' + col + '"' + sortAttrs + classAttr + style + '>' + labelHtml + '</th>';
      }).join('');
    }

    function render(renderBody) {
      prefs.renderTable({
        getTable: cfg.getTable,
        rebuildHead: rebuildHead,
        renderBody: renderBody,
        minWidth: cfg.minWidth || 40,
        onResizeEnd: cfg.onColumnResizeEnd,
        afterBind: function (tableEl) {
          if (sorter) {
            sorter.bind(tableEl, cfg.onSortChange);
            sorter.syncIndicators(tableEl);
          }
          if (typeof cfg.afterBind === 'function') {
            cfg.afterBind(tableEl);
          }
        },
      });
    }

    function openColumns(listEl, modalEl, getLabel) {
      renderColumnChooser(listEl, getColumns(), hiddenCols, getLabel || function (col) {
        var meta = getMeta(col) || { label: col };
        return meta.label || col;
      });
      if (modalEl && typeof HubModal !== 'undefined') {
        HubModal.open(modalEl);
      }
    }

    function applyColumns(rootEl, afterApply) {
      var newHidden = readHiddenFromChooser(rootEl, new Set(hiddenCols));
      prefs.setHiddenSet(newHidden);
      syncColumns();
      rebuildHead();
      if (typeof afterApply === 'function') afterApply();
    }

    function onLayoutChange(listener) {
      return prefs.onLayoutChange(function () {
        syncColumns();
        if (typeof listener === 'function') listener();
      });
    }

    syncColumns();

    return {
      prefs: prefs,
      sorter: sorter,
      getHiddenSet: getHiddenSet,
      getVisibleCols: getVisibleCols,
      getSortState: function () {
        return sorter ? sorter.getState() : { key: null, dir: 0 };
      },
      setSortState: function (nextKey, nextDir) {
        return sorter ? sorter.setState(nextKey, nextDir) : { key: null, dir: 0 };
      },
      rebuildHead: rebuildHead,
      render: render,
      isHorizontalScrollEnabled: function () {
        return prefs.isHorizontalScrollEnabled();
      },
      setHorizontalScrollEnabled: function (enabled) {
        return prefs.setHorizontalScrollEnabled(enabled);
      },
      toggleHorizontalScroll: function () {
        return prefs.toggleHorizontalScroll();
      },
      openColumns: openColumns,
      applyColumns: applyColumns,
      onLayoutChange: onLayoutChange,
      syncColumns: syncColumns,
    };
  }

  function createBucketLayoutController(cfg) {
    cfg = cfg || {};
    var layoutKey = '';
    var layoutAppliedSignature = '';
    var layoutSaveTimer = null;
    var applyingRemoteLayout = false;
    var layoutRequestSeq = 0;
    var layoutChangeUnsub = null;
    var boundLayoutChange = false;
    var reservedCode = cfg.reservedCode || '00';
    var userCode = cfg.userCode || '00';
    var saveDelayMs = Number(cfg.saveDelayMs || 300);

    function getView() {
      return typeof cfg.getView === 'function' ? cfg.getView() : null;
    }

    function getTable() {
      return typeof cfg.getTable === 'function' ? cfg.getTable() : null;
    }

    function getColumns() {
      var columns = typeof cfg.getColumns === 'function' ? cfg.getColumns() : [];
      return Array.isArray(columns) ? columns.slice() : [];
    }

    function getMeta(columnKey) {
      if (typeof cfg.getMeta === 'function') return cfg.getMeta(columnKey) || { label: columnKey };
      return { label: columnKey };
    }

    function getTableCode() {
      var tableEl = getTable();
      return (tableEl && tableEl.dataset && tableEl.dataset.layoutTableCode) || cfg.tableCode || '';
    }

    function getTableName() {
      var tableEl = getTable();
      return (tableEl && tableEl.dataset && tableEl.dataset.layoutTableName) || cfg.tableName || '';
    }

    function getSurfaceLabel() {
      return cfg.surfaceLabel || getTableName() || 'Table';
    }

    function getLayoutContextTitle() {
      return cfg.layoutContextTitle || (getSurfaceLabel() + ' Layout Context');
    }

    function getViewportBits() {
      var width = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0;
      var portrait = window.matchMedia('(orientation: portrait)').matches;
      var view = getView();
      return {
        shade_up: !!(document.body && document.body.classList.contains('shade-is-up')),
        horizontal_scroll: !!(view && typeof view.isHorizontalScrollEnabled === 'function' && view.isHorizontalScrollEnabled()),
        mobile: width <= 600,
        portrait: portrait,
        wide: !portrait && width >= 1600,
      };
    }

    function getDefaultWidth(columnKey, meta) {
      if (typeof cfg.getDefaultWidth === 'function') return cfg.getDefaultWidth(columnKey, meta);
      return meta && meta.defaultWidth ? meta.defaultWidth : null;
    }

    function getColumnSeed(columnKey, index, sortState, hiddenSet) {
      var meta = getMeta(columnKey) || { label: columnKey };
      var view = getView();
      var extra = typeof cfg.getColumnSeed === 'function'
        ? (cfg.getColumnSeed(columnKey, meta, index, {
            view: view,
            table: getTable(),
            columns: getColumns(),
            sortState: sortState || { key: null, dir: 0 },
            hiddenSet: hiddenSet || new Set(),
          }) || {})
        : {};
      var isActions = columnKey && columnKey.charAt(0) === '_';
      var width = view && view.prefs && typeof view.prefs.getWidth === 'function'
        ? view.prefs.getWidth(columnKey)
        : null;
      if (!width && extra.width_px) width = extra.width_px;
      if (!width) width = getDefaultWidth(columnKey, meta);
      return {
        column_key: columnKey,
        display_name: extra.display_name || meta.label || columnKey,
        sqlite_column: Object.prototype.hasOwnProperty.call(extra, 'sqlite_column') ? extra.sqlite_column : (isActions ? null : columnKey),
        width_px: width || undefined,
        min_width_px: extra.min_width_px || 40,
        max_width_px: extra.max_width_px || 900,
        position: Object.prototype.hasOwnProperty.call(extra, 'position') ? extra.position : index,
        sort_direction: extra.sort_direction || null,
        sort_priority: Object.prototype.hasOwnProperty.call(extra, 'sort_priority') ? extra.sort_priority : null,
        hidden: Object.prototype.hasOwnProperty.call(extra, 'hidden') ? !!extra.hidden : !!(hiddenSet && hiddenSet.has(columnKey)),
        data_type: extra.data_type || null,
        sample_max_length: Object.prototype.hasOwnProperty.call(extra, 'sample_max_length') ? extra.sample_max_length : null,
      };
    }

    function buildLayoutPayload() {
      var view = getView();
      if (!view) return null;
      var hiddenSet = typeof view.getHiddenSet === 'function' ? view.getHiddenSet() : new Set();
      var sortState = typeof view.getSortState === 'function' ? view.getSortState() : { key: null, dir: 0 };
      var columns = getColumns().map(function (columnKey, index) {
        var meta = getMeta(columnKey) || { label: columnKey };
        var seed = getColumnSeed(columnKey, index, sortState, hiddenSet);
        var isActiveSort = !!(meta.sortKey && sortState.key === meta.sortKey);
        seed.hidden = hiddenSet.has(columnKey);
        seed.sort_direction = isActiveSort ? (sortState.dir === -1 ? 'desc' : 'asc') : null;
        seed.sort_priority = isActiveSort ? 0 : null;
        seed.position = index;
        return seed;
      });
      return {
        version: 1,
        seed_origin: 'manual',
        algorithm_version: 'v1',
        bucket_flags: getViewportBits(),
        columns: columns,
      };
    }

    function layoutSignature(layoutData) {
      try {
        return JSON.stringify(layoutData || {});
      } catch (_) {
        return '';
      }
    }

    function applyRemoteLayout(layoutData) {
      var view = getView();
      if (!view || !layoutData || !Array.isArray(layoutData.columns)) return;
      var hidden = new Set();
      var sortMatch = null;
      applyingRemoteLayout = true;
      try {
        layoutData.columns.forEach(function (column) {
          if (!column || !column.column_key) return;
          if (column.hidden) hidden.add(column.column_key);
          if (column.width_px && view.prefs && typeof view.prefs.setWidth === 'function') {
            view.prefs.setWidth(column.column_key, column.width_px);
          }
          if (!column.sort_direction) return;
          var meta = getMeta(column.column_key) || null;
          var priority = Number.isFinite(Number(column.sort_priority)) ? Number(column.sort_priority) : 0;
          if (!sortMatch || priority < sortMatch.priority) {
            sortMatch = {
              key: (meta && meta.sortKey) || column.column_key,
              dir: column.sort_direction === 'desc' ? -1 : 1,
              priority: priority,
            };
          }
        });
        if (view.prefs && typeof view.prefs.setHiddenSet === 'function') {
          view.prefs.setHiddenSet(hidden);
        }
        if (typeof view.setSortState === 'function') {
          view.setSortState(sortMatch ? sortMatch.key : null, sortMatch ? sortMatch.dir : 1);
        }
      } finally {
        applyingRemoteLayout = false;
      }
    }

    function buildResolveBody(bucketBits) {
      var view = getView();
      var hiddenSet = view && typeof view.getHiddenSet === 'function' ? view.getHiddenSet() : new Set();
      var sortState = view && typeof view.getSortState === 'function' ? view.getSortState() : { key: null, dir: 0 };
      return {
        reserved_code: reservedCode,
        user_code: userCode,
        table_code: getTableCode(),
        table_name: getTableName(),
        bucket_bits: bucketBits || getViewportBits(),
        columns: getColumns().map(function (columnKey, index) {
          var meta = getMeta(columnKey) || { label: columnKey };
          var seed = getColumnSeed(columnKey, index, sortState, hiddenSet);
          var isActiveSort = !!(meta.sortKey && sortState.key === meta.sortKey);
          seed.hidden = hiddenSet.has(columnKey);
          seed.sort_direction = isActiveSort ? (sortState.dir === -1 ? 'desc' : 'asc') : null;
          seed.sort_priority = isActiveSort ? 0 : null;
          return seed;
        }),
      };
    }

    async function resolveRemoteLayout(options) {
      options = options || {};
      var view = getView();
      if (!view || typeof apiFetch !== 'function') return null;
      var requestId = ++layoutRequestSeq;
      try {
        var response = await apiFetch('/api/v1/table-layouts/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildResolveBody(options.bucketBits)),
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        var payload = await response.json();
        if (requestId !== layoutRequestSeq) return null;
        layoutKey = payload.layout_key || '';
        var nextSignature = layoutSignature(payload.layout_data);
        if (nextSignature && nextSignature !== layoutAppliedSignature) {
          applyRemoteLayout(payload.layout_data);
          layoutAppliedSignature = nextSignature;
          if (options.rerender !== false && typeof cfg.render === 'function') {
            cfg.render();
          }
        }
        return payload;
      } catch (error) {
        console.warn(getSurfaceLabel() + ' table layout resolve failed:', error);
        return null;
      }
    }

    function scheduleLayoutSave() {
      if (applyingRemoteLayout) return;
      clearTimeout(layoutSaveTimer);
      layoutSaveTimer = window.setTimeout(function () {
        persistLayout().catch(function (error) {
          console.warn(getSurfaceLabel() + ' table layout save failed:', error);
        });
      }, saveDelayMs);
    }

    async function persistLayout() {
      var view = getView();
      if (!view || typeof apiFetch !== 'function') return;
      if (!layoutKey) {
        var resolved = await resolveRemoteLayout({ rerender: false });
        if (!(resolved && resolved.layout_key)) return;
      }
      var layoutData = buildLayoutPayload();
      if (!layoutData) return;
      var nextSignature = layoutSignature(layoutData);
      if (nextSignature === layoutAppliedSignature) return;
      var response = await apiFetch('/api/v1/table-layouts/' + encodeURIComponent(layoutKey), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout_data: layoutData }),
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var payload = await response.json();
      layoutKey = payload.layout_key || layoutKey;
      layoutAppliedSignature = layoutSignature(payload.layout_data);
    }

    async function toggleHorizontalScroll() {
      var view = getView();
      if (!view || typeof view.toggleHorizontalScroll !== 'function') return;
      view.toggleHorizontalScroll();
      // resolveRemoteLayout only calls cfg.render() when the returned layout
      // signature differs from the last applied one.  After a scroll toggle the
      // CSS class (table-shared-ui--scroll-x) must always be updated, so we
      // suppress the conditional render inside resolve and call it ourselves.
      await resolveRemoteLayout({ rerender: false });
      if (typeof cfg.render === 'function') cfg.render();
    }

    async function openLayoutContextModal() {
      if (typeof TableLayoutInspector === 'undefined' || typeof apiFetch !== 'function') return;
      if (!layoutKey) {
        await resolveRemoteLayout({ rerender: false });
      }
      try {
        var loadEntries = async function () {
          var query = new URLSearchParams({
            table_code: getTableCode(),
            user_code: userCode,
          });
          var response = await apiFetch('/api/v1/table-layouts?' + query.toString());
          if (!response.ok) throw new Error('HTTP ' + response.status);
          var rows = await response.json();
          return {
            activeKey: layoutKey,
            subtitle: rows.length + ' saved bucket' + (rows.length === 1 ? '' : 's') + ' for ' + getTableName(),
            entries: rows.map(function (row) {
              var isActive = row.layout_key === layoutKey;
              return {
                layoutKey: row.layout_key,
                reservedCode: row.reserved_code,
                userCode: row.user_code,
                tableCode: row.table_code,
                bucketCode: row.bucket_code,
                layoutData: row.layout_data || {},
                title: 'Bucket ' + row.bucket_code,
                subtitle: row.layout_key,
                hint: isActive
                  ? 'Active layout for the current ' + getSurfaceLabel() + ' viewport'
                  : 'Saved sibling layout for another ' + getSurfaceLabel() + ' context',
              };
            }),
          };
        };
        var initialState = await loadEntries();
        TableLayoutInspector.open({
          title: getLayoutContextTitle(),
          subtitle: initialState.subtitle,
          activeKey: initialState.activeKey,
          reloadEntries: loadEntries,
          onGenerate: async function (bucketFlags) {
            var response = await apiFetch('/api/v1/table-layouts/resolve', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(buildResolveBody(bucketFlags)),
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
          },
          onDelete: async function (entry) {
            var confirmed = await HubDialogs.confirmDelete({
              title: 'Delete layout bucket?',
              message: 'Delete ' + getSurfaceLabel() + ' layout bucket ' + entry.bucketCode + '?',
              detail: 'This removes the saved layout row so it can be regenerated later if needed.',
            });
            if (!confirmed) return false;
            var response = await apiFetch('/api/v1/table-layouts/' + encodeURIComponent(entry.layoutKey), {
              method: 'DELETE',
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
          },
          onSaveColumns: async function (entry, nextLayoutData) {
            var response = await apiFetch('/api/v1/table-layouts/' + encodeURIComponent(entry.layoutKey), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ layout_data: nextLayoutData }),
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            var payload = await response.json();
            var savedLayout = payload.layout_data || nextLayoutData;
            if (payload.layout_key === layoutKey) {
              applyRemoteLayout(savedLayout);
              layoutAppliedSignature = layoutSignature(savedLayout);
              if (typeof cfg.render === 'function') cfg.render();
            }
            return { layoutData: savedLayout };
          },
          entries: initialState.entries,
        });
      } catch (error) {
        if (window.HubDialogs && typeof HubDialogs.alertError === 'function') {
          await HubDialogs.alertError({
            title: 'Layout context unavailable',
            message: 'Failed to load ' + getSurfaceLabel() + ' layout context: ' + error.message,
          });
        }
      }
    }

    function bindLayoutChange() {
      var view = getView();
      if (!view || typeof view.onLayoutChange !== 'function') return function () {};
      if (boundLayoutChange) return layoutChangeUnsub || function () {};
      boundLayoutChange = true;
      layoutChangeUnsub = view.onLayoutChange(function () {
        resolveRemoteLayout({ rerender: true });
      });
      return layoutChangeUnsub;
    }

    function init() {
      bindLayoutChange();
      resolveRemoteLayout({ rerender: false });
    }

    return {
      getLayoutKey: function () {
        return layoutKey;
      },
      getTableCode: getTableCode,
      getTableName: getTableName,
      getSurfaceLabel: getSurfaceLabel,
      getViewportBits: getViewportBits,
      buildLayoutPayload: buildLayoutPayload,
      resolveRemoteLayout: resolveRemoteLayout,
      scheduleLayoutSave: scheduleLayoutSave,
      persistLayout: persistLayout,
      toggleHorizontalScroll: toggleHorizontalScroll,
      openLayoutContextModal: openLayoutContextModal,
      bindLayoutChange: bindLayoutChange,
      init: init,
      isHorizontalScrollEnabled: function () {
        var view = getView();
        return !!(view && typeof view.isHorizontalScrollEnabled === 'function' && view.isHorizontalScrollEnabled());
      },
    };
  }

  function isCompactActions() {
    return isCompactLayout();
  }

  function shouldCollapseActions(opts) {
    opts = opts || {};
    var requiredWidth = Number(opts.requiredWidth || 0);
    var availableWidth = Number(opts.availableWidth);
    var prefs = opts.prefs || (opts.view && opts.view.prefs) || null;
    var columnKey = opts.columnKey || '_actions';
    var tableEl = opts.tableEl || (typeof opts.getTable === 'function' ? opts.getTable() : null);

    if ((!Number.isFinite(availableWidth) || availableWidth <= 0) && prefs) {
      var prefList = Array.isArray(prefs) ? prefs : [prefs];
      prefList.forEach(function (pref) {
        if (!pref || typeof pref.getWidth !== 'function') return;
        var width = Number(pref.getWidth(columnKey));
        if (Number.isFinite(width) && width > 0) {
          availableWidth = Math.max(Number.isFinite(availableWidth) ? availableWidth : 0, width);
        }
      });
    }

    if ((!Number.isFinite(availableWidth) || availableWidth <= 0) && tableEl) {
      var headerCell = tableEl.querySelector('thead th[data-col="' + columnKey + '"]');
      if (headerCell) {
        var measuredWidth = headerCell.getBoundingClientRect().width;
        if (Number.isFinite(measuredWidth) && measuredWidth > 0) {
          availableWidth = measuredWidth;
        }
      }
    }
    if ((!Number.isFinite(availableWidth) || availableWidth <= 0) && Number.isFinite(Number(opts.defaultWidth))) {
      availableWidth = Number(opts.defaultWidth);
    }
    if (Number.isFinite(requiredWidth) && requiredWidth > 0 && Number.isFinite(availableWidth) && availableWidth > 0) {
      return availableWidth < requiredWidth;
    }
    return isCompactLayout();
  }

  var _TABLE_LAYOUT_CONTEXT_ENTRIES = new Map();
  var _TABLE_LAYOUT_CONTEXT_SEQ = 0;
  var _TABLE_LAYOUT_FLAG_DEFS = [
    { key: 'shade_up', label: 'Shade Up', bit: 0 },
    { key: 'horizontal_scroll', label: 'Horizontal Scroll', bit: 1 },
    { key: 'mobile', label: 'Mobile', bit: 2 },
    { key: 'portrait', label: 'Portrait', bit: 3 },
    { key: 'wide', label: 'Wide', bit: 4 },
  ];
  var _TABLE_LAYOUT_CONTEXT_STATE = {
    options: null,
    entries: [],
    activeEntryId: null,
    saving: false,
    filters: {},
    busy: false,
  };

  function _escapeLayoutText(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _layoutDetailValue(value) {
    if (value == null || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value);
  }

  function _layoutFlagChips(layoutData) {
    var flags = _normalizeLayoutFlags(layoutData && layoutData.bucket_flags);
    var chips = [];
    _TABLE_LAYOUT_FLAG_DEFS.forEach(function (def) {
      if (!flags[def.key]) return;
      chips.push(def.label.toLowerCase());
    });
    return chips;
  }

  function _normalizeLayoutFlags(flags) {
    var normalized = {};
    _TABLE_LAYOUT_FLAG_DEFS.forEach(function (def) {
      normalized[def.key] = !!(flags && flags[def.key]);
    });
    return normalized;
  }

  function _hasActiveLayoutFilters(filters) {
    return _TABLE_LAYOUT_FLAG_DEFS.some(function (def) {
      return !!(filters && filters[def.key]);
    });
  }

  function _bucketCodeFromFilters(filters) {
    var value = 0;
    _TABLE_LAYOUT_FLAG_DEFS.forEach(function (def) {
      if (filters && filters[def.key]) value |= (1 << def.bit);
    });
    return value.toString(16).toUpperCase().padStart(2, '0');
  }

  function _entryMatchesLayoutFilters(entry, filters) {
    var activeFilters = _normalizeLayoutFlags(filters);
    if (!_hasActiveLayoutFilters(activeFilters)) return true;
    var flags = _normalizeLayoutFlags(entry && entry.layoutData && entry.layoutData.bucket_flags);
    return _TABLE_LAYOUT_FLAG_DEFS.every(function (def) {
      return !activeFilters[def.key] || flags[def.key];
    });
  }

  function _findExactLayoutEntry(entries, filters) {
    var targetBucketCode = _bucketCodeFromFilters(filters);
    return (entries || []).find(function (entry) {
      var bucketCode = String(entry && entry.bucketCode || '').toUpperCase();
      var layoutKey = String(entry && entry.layoutKey || '').toUpperCase();
      return bucketCode === targetBucketCode || layoutKey.slice(-2) === targetBucketCode;
    }) || null;
  }

  function _layoutBucketAdvisory(filters) {
    var normalized = _normalizeLayoutFlags(filters);
    var reasons = [];
    if (normalized.wide && normalized.mobile) reasons.push('Wide + mobile is unusual');
    if (normalized.wide && normalized.portrait) reasons.push('Wide + portrait is unusual');
    return {
      inadvisable: reasons.length > 0,
      message: reasons[0] || 'Expected bucket selection',
    };
  }

  function _renderLayoutDetail(entry) {
    var layoutData = (entry && entry.layoutData) || {};
    var columns = Array.isArray(layoutData.columns) ? layoutData.columns : [];
    var chips = _layoutFlagChips(layoutData).map(function (label) {
      return '<span class="table-layout-context-chip">' + _escapeLayoutText(label) + '</span>';
    }).join('');
    var overview = [
      ['Layout key', entry.layoutKey || ''],
      ['Reserved', entry.reservedCode || ''],
      ['User', entry.userCode || ''],
      ['Table', entry.tableCode || ''],
      ['Bucket', entry.bucketCode || ''],
      ['Columns', columns.length],
      ['Seed origin', layoutData.seed_origin || ''],
      ['Algorithm', layoutData.algorithm_version || ''],
    ].map(function (pair) {
      return '<div class="table-layout-detail-card"><dt>' + _escapeLayoutText(pair[0]) + '</dt><dd>' + _escapeLayoutText(_layoutDetailValue(pair[1])) + '</dd></div>';
    }).join('');
    var columnCards = columns.map(function (column) {
      return '' +
        '<article class="table-layout-detail-column">' +
          '<h4 class="table-layout-detail-column__title">' + _escapeLayoutText(column.display_name || column.column_key || 'Column') + '</h4>' +
          '<dl>' +
            '<dt>Key</dt><dd>' + _escapeLayoutText(_layoutDetailValue(column.column_key)) + '</dd>' +
            '<dt>SQLite</dt><dd>' + _escapeLayoutText(_layoutDetailValue(column.sqlite_column)) + '</dd>' +
            '<dt>Width</dt><dd>' + _escapeLayoutText(_layoutDetailValue(column.width_px)) + '</dd>' +
            '<dt>Position</dt><dd>' + _escapeLayoutText(_layoutDetailValue(column.position)) + '</dd>' +
            '<dt>Sort</dt><dd>' + _escapeLayoutText(_layoutDetailValue(column.sort_direction)) + '</dd>' +
            '<dt>Priority</dt><dd>' + _escapeLayoutText(_layoutDetailValue(column.sort_priority)) + '</dd>' +
            '<dt>Hidden</dt><dd>' + _escapeLayoutText(_layoutDetailValue(column.hidden)) + '</dd>' +
          '</dl>' +
        '</article>';
    }).join('');
    return '' +
      '<div class="table-layout-detail">' +
        '<section class="table-layout-detail-section">' +
          '<div class="table-layout-detail-grid">' + overview + '</div>' +
        '</section>' +
        '<section class="table-layout-detail-section">' +
          '<h3>Bucket Flags</h3>' +
          '<div class="table-layout-context-entry__meta">' + (chips || '<span class="table-layout-context-entry__hint">No active flags for this bucket.</span>') + '</div>' +
        '</section>' +
        '<section class="table-layout-detail-section">' +
          '<h3>Columns</h3>' +
          '<div class="table-layout-detail-columns">' + (columnCards || '<div class="table-layout-context-entry__hint">No column data saved.</div>') + '</div>' +
        '</section>' +
      '</div>';
  }

  function _openLayoutContextDetail(entry) {
    var dialog = document.getElementById('table-layout-context-detail-modal');
    var titleEl = document.getElementById('table-layout-context-detail-title');
    var subtitleEl = document.getElementById('table-layout-context-detail-subtitle');
    var bodyEl = document.getElementById('table-layout-context-detail-body');
    if (!dialog || !titleEl || !subtitleEl || !bodyEl || !entry) return;
    titleEl.textContent = entry.title || entry.layoutKey || 'Layout Detail';
    subtitleEl.textContent = entry.subtitle || '';
    subtitleEl.hidden = !subtitleEl.textContent;
    bodyEl.innerHTML = _renderLayoutDetail(entry);
    HubModal.open(dialog, {
      onClose: function () {
        bodyEl.innerHTML = '';
      },
    });
  }

  function _cloneLayoutData(layoutData) {
    try {
      return JSON.parse(JSON.stringify(layoutData || {}));
    } catch (_) {
      return { columns: [] };
    }
  }

  function _openLayoutContextColumns(entryId) {
    var entry = _TABLE_LAYOUT_CONTEXT_ENTRIES.get(entryId);
    var dialog = document.getElementById('table-layout-context-columns-modal');
    var titleEl = document.getElementById('table-layout-context-columns-title');
    var subtitleEl = document.getElementById('table-layout-context-columns-subtitle');
    var listEl = document.getElementById('table-layout-context-columns-list');
    var errEl = document.getElementById('table-layout-context-columns-error');
    if (!entry || !dialog || !titleEl || !subtitleEl || !listEl || !errEl) return;
    var columns = Array.isArray((entry.layoutData || {}).columns) ? entry.layoutData.columns : [];
    var hiddenSet = new Set(columns.filter(function (column) {
      return !!(column && column.hidden && column.column_key);
    }).map(function (column) {
      return column.column_key;
    }));

    _TABLE_LAYOUT_CONTEXT_STATE.activeEntryId = entryId;
    errEl.textContent = '';
    titleEl.textContent = (entry.title || entry.layoutKey || 'Layout') + ' Columns';
    subtitleEl.textContent = entry.subtitle || '';
    subtitleEl.hidden = !subtitleEl.textContent;

    renderColumnChooser(listEl, columns.map(function (column) {
      return column.column_key;
    }), hiddenSet, function (columnKey) {
      var match = columns.find(function (column) { return column.column_key === columnKey; });
      return (match && (match.display_name || match.column_key)) || columnKey;
    });

    HubModal.open(dialog, {
      onClose: function () {
        _TABLE_LAYOUT_CONTEXT_STATE.activeEntryId = null;
        _TABLE_LAYOUT_CONTEXT_STATE.saving = false;
        errEl.textContent = '';
        listEl.innerHTML = '';
      },
    });
  }

  async function _applyLayoutContextColumns() {
    var entryId = _TABLE_LAYOUT_CONTEXT_STATE.activeEntryId;
    var entry = _TABLE_LAYOUT_CONTEXT_ENTRIES.get(entryId);
    var options = _TABLE_LAYOUT_CONTEXT_STATE.options || {};
    var dialog = document.getElementById('table-layout-context-columns-modal');
    var listEl = document.getElementById('table-layout-context-columns-list');
    var errEl = document.getElementById('table-layout-context-columns-error');
    var applyBtn = document.getElementById('table-layout-context-columns-apply');
    if (!entry || !dialog || !listEl || !errEl || typeof options.onSaveColumns !== 'function') return;
    if (_TABLE_LAYOUT_CONTEXT_STATE.saving) return;

    var baseLayout = _cloneLayoutData(entry.layoutData);
    var columns = Array.isArray(baseLayout.columns) ? baseLayout.columns : [];
    var currentHidden = new Set(columns.filter(function (column) {
      return !!(column && column.hidden && column.column_key);
    }).map(function (column) {
      return column.column_key;
    }));
    var nextHidden = readHiddenFromChooser(listEl, currentHidden);
    columns.forEach(function (column) {
      if (!column || !column.column_key) return;
      column.hidden = nextHidden.has(column.column_key);
    });
    baseLayout.columns = columns;

    _TABLE_LAYOUT_CONTEXT_STATE.saving = true;
    errEl.textContent = '';
    if (applyBtn) applyBtn.disabled = true;
    try {
      var result = await options.onSaveColumns(entry, baseLayout);
      if (result && typeof result === 'object') {
        entry.layoutData = result.layoutData || result.layout_data || result;
        if (result.title) entry.title = result.title;
        if (result.subtitle) entry.subtitle = result.subtitle;
        if (result.hint) entry.hint = result.hint;
      } else {
        entry.layoutData = baseLayout;
      }
      HubModal.close(dialog);
    } catch (error) {
      errEl.textContent = error && error.message ? error.message : 'Failed to save layout columns.';
    } finally {
      _TABLE_LAYOUT_CONTEXT_STATE.saving = false;
      if (applyBtn) applyBtn.disabled = false;
    }
  }

  async function _refreshLayoutContextEntries() {
    var options = _TABLE_LAYOUT_CONTEXT_STATE.options || {};
    if (typeof options.reloadEntries !== 'function') return;
    var refreshed = await options.reloadEntries();
    if (Array.isArray(refreshed)) {
      _TABLE_LAYOUT_CONTEXT_STATE.entries = refreshed;
    } else if (refreshed && typeof refreshed === 'object') {
      _TABLE_LAYOUT_CONTEXT_STATE.entries = Array.isArray(refreshed.entries) ? refreshed.entries : [];
      if (typeof refreshed.activeKey === 'string') options.activeKey = refreshed.activeKey;
      if (typeof refreshed.subtitle === 'string') options.subtitle = refreshed.subtitle;
    }
    _renderLayoutContext();
  }

  async function _generateLayoutContextEntry() {
    var options = _TABLE_LAYOUT_CONTEXT_STATE.options || {};
    if (_TABLE_LAYOUT_CONTEXT_STATE.busy || typeof options.onGenerate !== 'function') return;
    _TABLE_LAYOUT_CONTEXT_STATE.busy = true;
    var generateBtn = document.getElementById('table-layout-context-generate');
    if (generateBtn) generateBtn.disabled = true;
    try {
      var result = await options.onGenerate(_normalizeLayoutFlags(_TABLE_LAYOUT_CONTEXT_STATE.filters), _bucketCodeFromFilters(_TABLE_LAYOUT_CONTEXT_STATE.filters));
      if (result !== false) {
        await _refreshLayoutContextEntries();
      }
    } catch (error) {
      if (window.HubDialogs && typeof HubDialogs.alertError === 'function') {
        await HubDialogs.alertError({
          title: 'Bucket generation failed',
          message: error && error.message ? error.message : 'Failed to generate the requested layout bucket.',
        });
      }
    } finally {
      _TABLE_LAYOUT_CONTEXT_STATE.busy = false;
      if (generateBtn) generateBtn.disabled = false;
    }
  }

  async function _deleteLayoutContextEntry(entryId) {
    var entry = _TABLE_LAYOUT_CONTEXT_ENTRIES.get(entryId);
    var options = _TABLE_LAYOUT_CONTEXT_STATE.options || {};
    if (!entry || _TABLE_LAYOUT_CONTEXT_STATE.busy || typeof options.onDelete !== 'function') return;
    _TABLE_LAYOUT_CONTEXT_STATE.busy = true;
    try {
      var result = await options.onDelete(entry);
      if (result !== false) {
        await _refreshLayoutContextEntries();
      }
    } catch (error) {
      if (window.HubDialogs && typeof HubDialogs.alertError === 'function') {
        await HubDialogs.alertError({
          title: 'Bucket delete failed',
          message: error && error.message ? error.message : 'Failed to delete the selected layout bucket.',
        });
      }
    } finally {
      _TABLE_LAYOUT_CONTEXT_STATE.busy = false;
    }
  }

  function _renderLayoutContext() {
    var options = _TABLE_LAYOUT_CONTEXT_STATE.options || {};
    var titleEl = document.getElementById('table-layout-context-title');
    var subtitleEl = document.getElementById('table-layout-context-subtitle');
    var listEl = document.getElementById('table-layout-context-list');
    var filtersEl = document.getElementById('table-layout-context-filters');
    var targetEl = document.getElementById('table-layout-context-target');
    var generateBtn = document.getElementById('table-layout-context-generate');
    var emptyEl = document.getElementById('table-layout-context-empty');
    if (!titleEl || !subtitleEl || !listEl || !filtersEl || !targetEl || !generateBtn || !emptyEl) return;

    var entries = Array.isArray(_TABLE_LAYOUT_CONTEXT_STATE.entries) ? _TABLE_LAYOUT_CONTEXT_STATE.entries : [];
    var filters = _normalizeLayoutFlags(_TABLE_LAYOUT_CONTEXT_STATE.filters);
    var advisory = _layoutBucketAdvisory(filters);
    var bucketCode = _bucketCodeFromFilters(filters);
    var filteredEntries = entries.filter(function (entry) {
      return _entryMatchesLayoutFilters(entry, filters);
    });
    var exactEntry = _findExactLayoutEntry(entries, filters);

    titleEl.textContent = options.title || 'Table Layout Context';
    subtitleEl.textContent = options.subtitle || '';
    subtitleEl.hidden = !subtitleEl.textContent;

    filtersEl.innerHTML = _TABLE_LAYOUT_FLAG_DEFS.map(function (def) {
      return '<button type="button" class="table-layout-context-filter' + (filters[def.key] ? ' is-active' : '') + '" data-layout-context-filter="' + def.key + '">' + _escapeLayoutText(def.label) + '</button>';
    }).join('');

    targetEl.innerHTML = '' +
      '<span class="table-layout-context-chip">target bucket ' + _escapeLayoutText(bucketCode) + '</span>' +
      '<span class="table-layout-context-chip">' + _escapeLayoutText(advisory.message) + '</span>';

    generateBtn.hidden = !!exactEntry || typeof options.onGenerate !== 'function';
    generateBtn.textContent = 'Generate ' + bucketCode;
    generateBtn.classList.toggle('is-safe', !advisory.inadvisable);
    generateBtn.classList.toggle('is-caution', advisory.inadvisable);

    emptyEl.hidden = filteredEntries.length > 0;
    emptyEl.textContent = _hasActiveLayoutFilters(filters)
      ? 'No saved buckets match the selected flags.'
      : (entries.length ? '' : 'No saved layouts were found for this table.');

    listEl.innerHTML = '';
    _TABLE_LAYOUT_CONTEXT_ENTRIES.clear();

    filteredEntries.forEach(function (entry) {
      var id = 'table-layout-context-' + (++_TABLE_LAYOUT_CONTEXT_SEQ);
      _TABLE_LAYOUT_CONTEXT_ENTRIES.set(id, entry);
      var card = document.createElement('article');
      card.className = 'table-layout-context-entry';
      if (options.activeKey && entry.layoutKey === options.activeKey) card.classList.add('is-active');

      var chips = _layoutFlagChips(entry.layoutData).map(function (label) {
        return '<span class="table-layout-context-chip">' + _escapeLayoutText(label) + '</span>';
      }).join('');
      var deleteHtml = '';
      if (typeof options.onDelete === 'function' && (!options.activeKey || entry.layoutKey !== options.activeKey)) {
        deleteHtml = '<button type="button" class="secondary table-icon-btn table-icon-btn--delete table-layout-context-entry__delete" title="Delete layout bucket" aria-label="Delete layout bucket" data-layout-context-open="delete" data-layout-context-id="' + _escapeLayoutText(id) + '"></button>';
      }

      card.innerHTML = '' +
        '<div class="table-layout-context-entry__surface" role="button" tabindex="0" data-layout-context-open="detail" data-layout-context-id="' + _escapeLayoutText(id) + '">' +
          '<div class="table-layout-context-entry__top">' +
            '<span class="table-layout-context-entry__title">' + _escapeLayoutText(entry.title || entry.layoutKey || 'Layout') + '</span>' +
            '<div class="table-layout-context-entry__top-actions">' +
              '<div class="table-layout-context-entry__actions">' +
                '<button type="button" class="table-layout-context-entry__action" data-layout-context-open="detail" data-layout-context-id="' + _escapeLayoutText(id) + '">Details</button>' +
                '<button type="button" class="table-layout-context-entry__action" data-layout-context-open="columns" data-layout-context-id="' + _escapeLayoutText(id) + '">Columns</button>' +
                deleteHtml +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="table-layout-context-entry__meta">' +
            '<span class="table-layout-context-entry__badge">' + _escapeLayoutText(entry.layoutKey || '') + '</span>' +
            '<span class="table-layout-context-chip">bucket ' + _escapeLayoutText(entry.bucketCode || '') + '</span>' +
            '<span class="table-layout-context-chip">' + _escapeLayoutText(String(((entry.layoutData || {}).columns || []).length)) + ' columns</span>' +
            (chips ? chips : '') +
          '</div>' +
          '<div class="table-layout-context-entry__hint">' + _escapeLayoutText(entry.hint || 'Open structured layout detail') + '</div>' +
        '</div>';
      listEl.appendChild(card);
    });
  }

  function openLayoutContext(opts) {
    var dialog = document.getElementById('table-layout-context-modal');
    if (!dialog || !opts) return;

    _TABLE_LAYOUT_CONTEXT_STATE.options = opts;
    _TABLE_LAYOUT_CONTEXT_STATE.entries = Array.isArray(opts.entries) ? opts.entries : [];
    _TABLE_LAYOUT_CONTEXT_STATE.activeEntryId = null;
    _TABLE_LAYOUT_CONTEXT_STATE.filters = _normalizeLayoutFlags(opts.initialFilters);
    _TABLE_LAYOUT_CONTEXT_STATE.busy = false;
    _renderLayoutContext();

    HubModal.open(dialog, {
      onClose: function () {
        _TABLE_LAYOUT_CONTEXT_ENTRIES.clear();
        _TABLE_LAYOUT_CONTEXT_STATE.options = null;
        _TABLE_LAYOUT_CONTEXT_STATE.entries = [];
        _TABLE_LAYOUT_CONTEXT_STATE.activeEntryId = null;
        _TABLE_LAYOUT_CONTEXT_STATE.filters = {};
        _TABLE_LAYOUT_CONTEXT_STATE.busy = false;
        var listEl = document.getElementById('table-layout-context-list');
        var emptyEl = document.getElementById('table-layout-context-empty');
        if (listEl) listEl.innerHTML = '';
        if (emptyEl) emptyEl.hidden = true;
      },
    });
  }

  function openRowActions(opts) {
    var dialog = document.getElementById('table-row-actions-modal');
    if (!dialog || !opts) return;
    var titleEl = document.getElementById('table-row-actions-title');
    var subtitleEl = document.getElementById('table-row-actions-subtitle');
    var listEl = document.getElementById('table-row-actions-list');
    if (!titleEl || !subtitleEl || !listEl) return;

    titleEl.textContent = opts.title || 'Row actions';
    subtitleEl.textContent = opts.subtitle || '';
    subtitleEl.hidden = !subtitleEl.textContent;
    listEl.innerHTML = '';
    _ROW_ACTIONS.clear();

    (opts.actions || []).forEach(function (action) {
      var id = 'row-action-' + (++_ROW_ACTION_SEQ);
      _ROW_ACTIONS.set(id, action.onClick);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'table-row-actions-btn';
      if (action.tone) btn.classList.add('is-' + action.tone);
      btn.dataset.actionId = id;
      var labelEl = document.createElement('span');
      labelEl.className = 'table-row-actions-btn__label';
      labelEl.textContent = action.label || 'Action';
      btn.appendChild(labelEl);
      if (action.detail) {
        var detailEl = document.createElement('span');
        detailEl.className = 'table-row-actions-btn__detail';
        detailEl.textContent = action.detail;
        btn.appendChild(detailEl);
      }
      listEl.appendChild(btn);
    });

    HubModal.open(dialog, {
      onClose: function () {
        _ROW_ACTIONS.clear();
        listEl.innerHTML = '';
      },
    });
  }

  document.addEventListener('click', function (e) {
    var filterBtn = e.target.closest('[data-layout-context-filter]');
    if (filterBtn) {
      var filterKey = filterBtn.dataset.layoutContextFilter;
      if (filterKey) {
        _TABLE_LAYOUT_CONTEXT_STATE.filters[filterKey] = !_TABLE_LAYOUT_CONTEXT_STATE.filters[filterKey];
        _renderLayoutContext();
      }
      return;
    }
    var layoutBtn = e.target.closest('[data-layout-context-open][data-layout-context-id]');
    if (layoutBtn) {
      var layoutEntry = _TABLE_LAYOUT_CONTEXT_ENTRIES.get(layoutBtn.dataset.layoutContextId);
      if (!layoutEntry) return;
      if (layoutBtn.dataset.layoutContextOpen === 'delete') {
        _deleteLayoutContextEntry(layoutBtn.dataset.layoutContextId);
      } else if (layoutBtn.dataset.layoutContextOpen === 'columns') {
        _openLayoutContextColumns(layoutBtn.dataset.layoutContextId);
      } else {
        _openLayoutContextDetail(layoutEntry);
      }
      return;
    }
    var btn = e.target.closest('[data-action-id]');
    if (!btn) return;
    var action = _ROW_ACTIONS.get(btn.dataset.actionId);
    if (typeof action !== 'function') return;
    HubModal.close(document.getElementById('table-row-actions-modal'));
    window.setTimeout(function () { action(); }, 0);
  });

  document.addEventListener('DOMContentLoaded', function () {
    var applyBtn = document.getElementById('table-layout-context-columns-apply');
    var generateBtn = document.getElementById('table-layout-context-generate');
    if (applyBtn && !applyBtn.dataset.boundLayoutContextColumns) {
      applyBtn.dataset.boundLayoutContextColumns = '1';
      applyBtn.addEventListener('click', function () {
        _applyLayoutContextColumns();
      });
    }
    if (generateBtn && !generateBtn.dataset.boundLayoutContextGenerate) {
      generateBtn.dataset.boundLayoutContextGenerate = '1';
      generateBtn.addEventListener('click', function () {
        _generateLayoutContextEntry();
      });
    }
  });

  window.TablePrefs = {
    create: createTablePrefs,
    getLayoutKey: getLayoutKey,
    isCompactLayout: isCompactLayout,
    renderColumnChooser: renderColumnChooser,
    readHiddenFromChooser: readHiddenFromChooser,
  };

  window.TableSort = {
    create: createTableSort,
  };

  window.TableView = {
    create: createTableView,
  };

  window.TableBucketLayouts = {
    create: createBucketLayoutController,
  };

  window.TableRowActions = {
    isCompact: isCompactActions,
    shouldCollapse: shouldCollapseActions,
    open: openRowActions,
  };

  window.TableLayoutInspector = {
    open: openLayoutContext,
  };
}());