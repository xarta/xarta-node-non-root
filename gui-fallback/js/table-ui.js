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

  function safeHeaderLabelHtml(label) {
    return String(label == null ? '' : label)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
      .replace(/&amp;shy;/g, '&shy;');
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
        if (tableEl.dataset.colResizeDragging === '1') return;
        tableEl.classList.remove('table-resize-handles-visible');
      }, delayMs);
    }
    tableEl._scheduleResizeHandleHide = scheduleHide;

    function revealTemporarily() {
      showHandles();
      scheduleHide(3000);
    }

    tableEl.addEventListener('pointerenter', function () {
      revealTemporarily();
    }, { passive: true });

    tableEl.addEventListener('pointermove', function (e) {
      if (!e.target.closest('thead th[data-col]')) return;
      revealTemporarily();
    }, { passive: true });

    tableEl.addEventListener('pointerdown', function (e) {
      var th = e.target.closest('thead th[data-col]');
      if (!th || !tableEl.contains(th)) return;
      revealTemporarily();
    }, { passive: true });

    tableEl.addEventListener('pointerup', function () {
      scheduleHide(3000);
    }, { passive: true });

    tableEl.addEventListener('pointercancel', function () {
      scheduleHide(3000);
    }, { passive: true });

    tableEl.addEventListener('pointerleave', function () {
      scheduleHide(isCoarsePointer() ? 3000 : 900);
    }, { passive: true });

    if (typeof window.matchMedia === 'function') {
      var coarseMq = window.matchMedia('(pointer: coarse)');
      var syncPointerMode = function () {
        clearTimeout(hideTimer);
        tableEl.classList.remove('table-resize-handles-visible');
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

    function uniqueKeys(keys) {
      var seen = new Set();
      return (keys || []).filter(function (key) {
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    function getDesktopSeedKeys(layoutKey) {
      var parsed = parseBaseLayoutKey(layoutKey || currentLayout);
      var shadeKey = parsed.shadeKey === 'shade-up' ? 'shade-up' : 'shade-down';
      var desktopViewports = ['desktop-landscape', 'desktop-portrait', 'desktop-widescreen', 'desktop'];
      var keys = [];
      desktopViewports.forEach(function (viewport) {
        keys.push(viewport + '|' + shadeKey + '|scroll-x');
        keys.push(viewport + '|' + shadeKey + '|fit');
      });
      desktopViewports.forEach(function (viewport) {
        keys.push(viewport + '|scroll-x');
        keys.push(viewport + '|fit');
        keys.push(viewport);
      });
      return uniqueKeys(keys);
    }

    function copyDesktopSeedIntoHorizontalLayout(layoutKey) {
      var resolvedLayout = layoutKey || currentLayout;
      var parsed = parseBaseLayoutKey(resolvedLayout);
      if (parsed.viewportKey.indexOf('desktop') === 0) return false;

      var targetKey = resolvedLayout + '|scroll-x';
      var targetLayout = ensureLayoutState(state, targetKey, []);
      var sourceLayout = null;
      getDesktopSeedKeys(resolvedLayout).some(function (candidateKey) {
        if (!state.layouts || !state.layouts[candidateKey]) return false;
        sourceLayout = cloneLayoutState(state.layouts[candidateKey]);
        return !!sourceLayout;
      });
      if (!sourceLayout) return false;

      targetLayout.hidden = Array.isArray(sourceLayout.hidden) ? sourceLayout.hidden.slice() : null;
      targetLayout.widths = sourceLayout.widths && typeof sourceLayout.widths === 'object'
        ? Object.assign({}, sourceLayout.widths)
        : {};
      targetLayout.pendingHorizontalClamp = false;
      return true;
    }

    function getLayoutState(layoutKey) {
      var resolvedLayout = layoutKey || currentLayout;
      var effectiveLayoutKey = getEffectiveLayoutKey(resolvedLayout);
      var fallbackKeys = getLegacyLayoutKeys(resolvedLayout);
      var siblingKey = effectiveLayoutKey.endsWith('|scroll-x')
        ? effectiveLayoutKey.replace(/\|scroll-x$/, '|fit')
        : effectiveLayoutKey.replace(/\|fit$/, '|scroll-x');
      fallbackKeys.unshift(siblingKey);
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
      var totalWidth = 0;
      tableEl.querySelectorAll('thead th[data-col]').forEach(function (th) {
        var explicit = parseFloat(th.style.width || '0');
        var measured = th.getBoundingClientRect().width || 0;
        totalWidth += explicit > 0 ? explicit : measured;
      });
      if (totalWidth > 0) {
        var px = Math.ceil(totalWidth) + 'px';
        tableEl.style.setProperty('--table-fit-width', px);
        tableEl.style.setProperty('--table-scroll-width', px);
      } else {
        tableEl.style.removeProperty('--table-fit-width');
        tableEl.style.removeProperty('--table-scroll-width');
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
      layout.pendingHorizontalClamp = false;
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
      var tableCode = (tableEl.dataset && tableEl.dataset.layoutTableCode) || '';

      function emitResizeDebug(stage, payload) {
        if (tableCode !== '08') return;
        if (!payload || payload.columnKey !== 'ip_address') return;
        try {
          window.dispatchEvent(new CustomEvent('bp:column-resize-debug', {
            detail: Object.assign({
              stage: stage,
              tableCode: tableCode,
              shadeUp: !!(document.body && document.body.classList.contains('shade-is-up')),
              ts: Date.now(),
            }, payload),
          }));
        } catch (_) {
          // Debug events are best-effort only.
        }
      }

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
          var startWidth = th.getBoundingClientRect().width || 0;
          var anchorLeft = th.getBoundingClientRect().left || 0;
          var lastAppliedWidth = startWidth;
          var pointerId = e.pointerId;
          var didDrag = false;
          var dragActivated = false;
          var finished = false;
          var prevInlineTableWidth = tableEl.style.width;
          var dragTableBaseWidth = 0;

          emitResizeDebug('pointerdown', {
            columnKey: th.dataset.col,
            pointerId: pointerId,
            pointerX: e.clientX,
            startX: startX,
            startWidth: Math.round(startWidth),
            minWidth: minWidth,
            maxWidth: null,
          });

          function activateDrag() {
            if (dragActivated) return;
            dragActivated = true;
            var frozenTotal = 0;
            // Freeze every column to its current rendered width so neighbours
            // don't shift while we drag.
            tableEl.querySelectorAll('thead th[data-col]').forEach(function (cell) {
              var cellWidth = cell.getBoundingClientRect().width || 0;
              if (cellWidth > 0) cell.style.width = cellWidth + 'px';
              frozenTotal += cellWidth;
            });
            // Keep an explicit table width while dragging. This prevents the
            // browser from shrinking sibling columns as one column grows.
            dragTableBaseWidth = Math.round(frozenTotal > 0 ? frozenTotal : (tableEl.getBoundingClientRect().width || 0));
            if (dragTableBaseWidth > 0) {
              tableEl.style.width = dragTableBaseWidth + 'px';
            }
            tableEl.classList.add('table-resize-handles-visible');
            tableEl.dataset.colResizeDragging = '1';
            resizer.classList.add('dragging');
            document.body.classList.add('table-col-resizing');
          }

          function finishDragSession() {
            if (finished) return;
            finished = true;
            delete tableEl.dataset.colResizeDragging;
            if (dragActivated) {
              tableEl.style.width = prevInlineTableWidth;
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
            if (typeof tableEl._scheduleResizeHandleHide === 'function') {
              tableEl._scheduleResizeHandleHide(3000);
            }
          }

          if (typeof resizer.setPointerCapture === 'function') {
            try { resizer.setPointerCapture(e.pointerId); } catch (_) {}
          }

          function onMove(ev) {
            if (ev.isPrimary === false) return;
            if (ev.pointerId !== pointerId) return;
            if (typeof ev.preventDefault === 'function') ev.preventDefault();
            var deltaX = ev.clientX - startX;
            if (!didDrag && Math.abs(deltaX) <= 2) return;
            if (!dragActivated) {
              activateDrag();
              // Re-anchor after freeze/width-mode changes to avoid first-move
              // offset jumps (especially on coarse/mobile pointers).
              anchorLeft = th.getBoundingClientRect().left || anchorLeft;
            }
            didDrag = true;
            // Anchor to the column's left edge so the divider stays under the pointer.
            var nextW = Math.max(minWidth, Math.round(ev.clientX - anchorLeft));
            if (nextW === lastAppliedWidth) return;
            lastAppliedWidth = nextW;
            th.style.width = nextW + 'px';
            if (dragTableBaseWidth > 0) {
              var nextTableWidth = Math.max(1, Math.round(dragTableBaseWidth + (nextW - startWidth)));
              tableEl.style.width = nextTableWidth + 'px';
            }

            var rect = th.getBoundingClientRect();
            emitResizeDebug('move', {
              columnKey: th.dataset.col,
              pointerId: pointerId,
              pointerX: ev.clientX,
              startX: startX,
              deltaX: Math.round(deltaX),
              nextWidth: nextW,
              renderedWidth: Math.round(rect.width || 0),
              thLeft: Math.round(rect.left || 0),
              thRight: Math.round(rect.right || 0),
              minWidth: minWidth,
              maxWidth: null,
            });
          }

          function onUp(ev) {
            var upX = ev && Number.isFinite(Number(ev.clientX)) ? Number(ev.clientX) : null;
            if (!didDrag) {
              emitResizeDebug('pointerup-no-drag', {
                columnKey: th.dataset.col,
                pointerId: pointerId,
                pointerX: upX,
                finalWidth: Math.round(th.getBoundingClientRect().width || 0),
                minWidth: minWidth,
                maxWidth: null,
              });
              finishDragSession();
              return;
            }
            tableEl.dataset.colResizeSuppressUntil = String(Date.now() + 700);
            // Measure rendered width before restoring table width.
            var finalRect = th.getBoundingClientRect();
            var finalWidth = Math.round(finalRect.width || 0);
            if (finalWidth > 0) {
              setWidth(th.dataset.col, finalWidth);
            }

            emitResizeDebug('pointerup-drag', {
              columnKey: th.dataset.col,
              pointerId: pointerId,
              pointerX: upX,
              finalWidth: finalWidth,
              thLeft: Math.round(finalRect.left || 0),
              thRight: Math.round(finalRect.right || 0),
              minWidth: minWidth,
              maxWidth: null,
            });

            finishDragSession();
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
      if (!tableEl) return;
      if (tableEl.dataset.tableSortBound === '1') {
        // Already bound — swap delegate to this sorter so the existing
        // click handler routes to the correct sorter instance.
        if (tableEl._tableSortDelegate) {
          tableEl._tableSortDelegate.toggle = toggle;
          tableEl._tableSortDelegate.onChange = onChange;
          tableEl._tableSortDelegate.getState = getState;
          tableEl._tableSortDelegate.syncInd = function () { syncIndicators(tableEl); };
        }
        syncIndicators(tableEl);
        return;
      }
      tableEl.dataset.tableSortBound = '1';
      var delegate = {
        toggle: toggle,
        onChange: onChange,
        getState: getState,
        syncInd: function () { syncIndicators(tableEl); },
      };
      tableEl._tableSortDelegate = delegate;
      tableEl.addEventListener('click', function (e) {
        if (tableEl.dataset.colResizeDragging === '1') return;
        var suppressUntil = Number(tableEl.dataset.colResizeSuppressUntil || 0);
        if (suppressUntil && Date.now() < suppressUntil) return;
        var th = e.target.closest('thead th[data-sort-key]');
        if (!th || !tableEl.contains(th)) return;
        var d = tableEl._tableSortDelegate;
        d.toggle(th.dataset.sortKey);
        d.syncInd();
        if (typeof d.onChange === 'function') {
          d.onChange(d.getState());
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
    var headerLabelOverrides = Object.create(null);

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

    function getHeaderLabel(col, meta) {
      if (Object.prototype.hasOwnProperty.call(headerLabelOverrides, col)) {
        return headerLabelOverrides[col];
      }
      return (meta && meta.label) || col;
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
        var titleAttr = meta.description ? ' title="' + meta.description.replace(/"/g, '&quot;') + '"' : '';
        var headerLabel = getHeaderLabel(col, meta);
        var labelHtml = sorter && meta.sortKey ? sorter.renderLabel(headerLabel, meta.sortKey) : headerLabel;
        return '<th data-col="' + col + '"' + sortAttrs + classAttr + titleAttr + style + '>' + labelHtml + '</th>';
      }).join('');
    }

    function setHeaderLabelOverrides(overrides) {
      headerLabelOverrides = Object.create(null);
      Object.keys(overrides || {}).forEach(function (col) {
        var label = overrides[col];
        if (typeof label === 'string' && label) {
          headerLabelOverrides[col] = safeHeaderLabelHtml(label);
        }
      });
      rebuildHead();
    }

    function getHeaderLabelOverride(col) {
      return Object.prototype.hasOwnProperty.call(headerLabelOverrides, col)
        ? headerLabelOverrides[col]
        : null;
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
      setHeaderLabelOverrides: setHeaderLabelOverrides,
      getHeaderLabelOverride: getHeaderLabelOverride,
    };
  }

  function createBucketLayoutController(cfg) {
    cfg = cfg || {};
    var layoutKey = '';
    var layoutAppliedSignature = '';
    var layoutAppliedKey = '';
    var layoutSignaturesByKey = Object.create(null);
    var layoutSaveTimer = null;
    var applyingRemoteLayout = false;
    var layoutRequestSeq = 0;
    var layoutChangeUnsub = null;
    var boundLayoutChange = false;
    var quickActionsEl = null;
    var quickShowTimer = null;
    var quickFadeTimer = null;
    var reservedCode = cfg.reservedCode || '00';
    var userCode = cfg.userCode || '00';
    var saveDelayMs = Number(cfg.saveDelayMs || 300);
    var headerHyphenationCache = Object.create(null);
    var headerHyphenationExamples = [
      { header: 'Pending', header_label: 'Pend-ing', changed: true },
      { header: 'Hostnames', header_label: 'Host-names', changed: true },
      { header: 'Filename', header_label: 'File-name', changed: true },
      { header: 'Status', header_label: 'Status', changed: false },
      { header: 'Commit', header_label: 'Commit', changed: false },
      { header: 'Actions', header_label: 'Actions', changed: false },
    ];

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
      if (cfg.tableCode) return cfg.tableCode;
      var tableEl = getTable();
      return (tableEl && tableEl.dataset && tableEl.dataset.layoutTableCode) || '';
    }

    function getTableName() {
      if (cfg.tableName) return cfg.tableName;
      var tableEl = getTable();
      return (tableEl && tableEl.dataset && tableEl.dataset.layoutTableName) || '';
    }

    function getSurfaceLabel() {
      return cfg.surfaceLabel || getTableName() || 'Table';
    }

    function getLayoutContextTitle() {
      return cfg.layoutContextTitle || (getSurfaceLabel() + ' Layout Context');
    }

    function _currentBucketCode() {
      return String(layoutKey || '').slice(-2).toUpperCase() || '--';
    }

    function _ensureQuickActions() {
      if (cfg.quickLayoutAccess === false) return null;
      if (quickActionsEl && quickActionsEl.isConnected) return quickActionsEl;
      var tableEl = getTable();
      if (!tableEl) return null;
      var wrap = tableEl.closest('.table-wrap') || tableEl.parentElement;
      if (!wrap || !wrap.parentElement) return null;
      var panel = tableEl.closest('.tab-panel');
      var handle = panel ? panel.querySelector('.body-shade-handle') : null;
      var tableCode = getTableCode() || 'unknown';
      var hostEl = (handle && handle.parentElement) ? handle.parentElement : wrap.parentElement;
      hostEl.classList.add('table-layout-quick-host');
      quickActionsEl = hostEl.querySelector('.table-layout-quick-actions[data-layout-quick-table-code="' + tableCode + '"]');
      if (quickActionsEl) {
        _positionQuickActions(quickActionsEl);
        return quickActionsEl;
      }

      quickActionsEl = document.createElement('div');
      quickActionsEl.className = 'table-layout-quick-actions';
      quickActionsEl.dataset.layoutQuickTableCode = tableCode;
      quickActionsEl.innerHTML = ''
        + '<button type="button" class="table-layout-quick-actions__pill" data-layout-quick-open="1">LAYOUT BUCKET --</button>';
      quickActionsEl.querySelector('[data-layout-quick-open="1"]').addEventListener('click', function () {
        openLayoutContextModal();
      });
      if (handle && handle.parentElement) {
        if (handle.nextSibling) handle.parentElement.insertBefore(quickActionsEl, handle.nextSibling);
        else handle.parentElement.appendChild(quickActionsEl);
      } else {
        wrap.parentElement.insertBefore(quickActionsEl, wrap);
      }

      if (handle && !handle.dataset.layoutQuickPulseBound) {
        handle.dataset.layoutQuickPulseBound = '1';
        handle.addEventListener('pointerdown', function () {
          _pulseQuickActions();
        }, { passive: true });
      }
      _positionQuickActions(quickActionsEl);
      return quickActionsEl;
    }

    function _positionQuickActions(el) {
      if (!el) return;
      var tableEl = getTable();
      if (!tableEl) return;
      var panel = tableEl.closest('.tab-panel');
      var handle = panel ? panel.querySelector('.body-shade-handle') : null;
      var topPx = 8;
      if (handle) {
        topPx = Math.max(0, Math.round(handle.offsetTop + handle.offsetHeight + 8));
      }
      el.style.top = topPx + 'px';
    }

    function _clearQuickActionTimers() {
      if (quickShowTimer) {
        clearTimeout(quickShowTimer);
        quickShowTimer = null;
      }
      if (quickFadeTimer) {
        clearTimeout(quickFadeTimer);
        quickFadeTimer = null;
      }
    }

    function _pulseQuickActions() {
      var el = _ensureQuickActions();
      if (!el) return;
      _positionQuickActions(el);
      _clearQuickActionTimers();
      el.classList.add('is-visible');
      el.classList.remove('is-fading-out');
      quickShowTimer = window.setTimeout(function () {
        el.classList.add('is-fading-out');
        quickFadeTimer = window.setTimeout(function () {
          el.classList.remove('is-visible');
          el.classList.remove('is-fading-out');
          quickFadeTimer = null;
        }, 1000);
        quickShowTimer = null;
      }, 1000);
    }

    function _setQuickActionsShadeState(el, isShadeUp) {
      if (!el) return;
      el.classList.toggle('is-shade-up', !!isShadeUp);
    }

    function _syncQuickActionsState() {
      var el = _ensureQuickActions();
      if (!el) return;
      _positionQuickActions(el);
      var pill = el.querySelector('[data-layout-quick-open="1"]');
      if (pill) pill.textContent = 'LAYOUT BUCKET ' + _currentBucketCode();
      _setQuickActionsShadeState(el, !!(document.body && document.body.classList.contains('shade-is-up')));
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
        header_label: view && typeof view.getHeaderLabelOverride === 'function'
          ? view.getHeaderLabelOverride(columnKey)
          : null,
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

    function _rememberSignature(key, signature) {
      if (!key || !signature) return;
      layoutSignaturesByKey[key] = signature;
      layoutAppliedKey = key;
      layoutAppliedSignature = signature;
    }

    function _signatureForKey(key) {
      if (!key) return '';
      return layoutSignaturesByKey[key] || '';
    }

    function applyRemoteLayout(layoutData) {
      var view = getView();
      if (!view || !layoutData || !Array.isArray(layoutData.columns)) return;
      var hidden = new Set();
      var sortMatch = null;
      var headerLabelOverrides = Object.create(null);
      applyingRemoteLayout = true;
      try {
        layoutData.columns.forEach(function (column) {
          if (!column || !column.column_key) return;
          if (column.hidden) hidden.add(column.column_key);
          if (typeof column.header_label === 'string' && column.header_label) {
            headerLabelOverrides[column.column_key] = column.header_label;
          }
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
        if (typeof view.setHeaderLabelOverrides === 'function') {
          view.setHeaderLabelOverrides(headerLabelOverrides);
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
        var previousLayoutKey = layoutKey;
        layoutKey = payload.layout_key || '';
        var keyChanged = layoutKey !== previousLayoutKey;
        var nextSignature = layoutSignature(payload.layout_data);
        if (nextSignature && (nextSignature !== layoutAppliedSignature || keyChanged || options.forceApply)) {
          applyRemoteLayout(payload.layout_data);
          _rememberSignature(layoutKey, nextSignature);
          if (options.rerender !== false && typeof cfg.render === 'function') {
            cfg.render();
          }
        }
        _syncQuickActionsState();
        return payload;
      } catch (error) {
        console.warn(getSurfaceLabel() + ' table layout resolve failed:', error);
        _syncQuickActionsState();
        return null;
      }
    }

    function _afterNextPaint() {
      return new Promise(function (resolve) {
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(resolve);
        });
      });
    }

    function _ensureMeasureHost() {
      var host = document.getElementById('table-layout-measure-host');
      if (host) return host;
      host = document.createElement('div');
      host.id = 'table-layout-measure-host';
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = [
        'position:absolute',
        'left:-10000px',
        'top:-10000px',
        'width:auto',
        'height:auto',
        'visibility:hidden',
        'pointer-events:none',
        'contain:layout style paint',
        'z-index:-1',
      ].join(';');
      document.body.appendChild(host);
      return host;
    }

    function _numberFromPx(value) {
      var n = parseFloat(value || '0');
      return Number.isFinite(n) ? n : 0;
    }

    function _visibleColumnKeys() {
      var tableEl = getTable();
      if (!tableEl) return [];
      return Array.prototype.slice.call(tableEl.querySelectorAll('thead th[data-col]'))
        .map(function (th) { return th.dataset.col || ''; })
        .filter(Boolean);
    }

    function _cellForColumn(row, columnKey, columnIndex, visibleColumnCount) {
      if (!row) return null;
      var keyed = row.querySelector('td[data-col="' + window.CSS.escape(columnKey) + '"]');
      if (keyed) return keyed;
      var cells = Array.prototype.slice.call(row.children).filter(function (cell) {
        return cell && cell.tagName === 'TD';
      });
      var hasColspan = cells.some(function (cell) {
        return Number(cell.getAttribute('colspan') || 1) > 1;
      });
      if (!hasColspan && cells.length >= visibleColumnCount && Number.isFinite(columnIndex)) {
        return cells[columnIndex] || null;
      }
      return null;
    }

    function _copyMeasureStyles(sourceEl, clone) {
      var style = window.getComputedStyle(sourceEl);
      [
        'fontFamily',
        'fontSize',
        'fontStyle',
        'fontWeight',
        'letterSpacing',
        'lineHeight',
        'textTransform',
        'whiteSpace',
        'wordBreak',
        'overflowWrap',
        'paddingTop',
        'paddingRight',
        'paddingBottom',
        'paddingLeft',
        'borderTopWidth',
        'borderRightWidth',
        'borderBottomWidth',
        'borderLeftWidth',
        'borderTopStyle',
        'borderRightStyle',
        'borderBottomStyle',
        'borderLeftStyle',
      ].forEach(function (prop) {
        clone.style[prop] = style[prop];
      });
      clone.style.boxSizing = 'border-box';
    }

    function _normaliseMeasureClone(sourceEl, widthPx, htmlOverride) {
      var clone = document.createElement('div');
      clone.className = sourceEl.className || '';
      clone.innerHTML = typeof htmlOverride === 'string' ? htmlOverride : sourceEl.innerHTML;
      if (sourceEl.dataset && sourceEl.dataset.col) clone.dataset.col = sourceEl.dataset.col;
      clone.querySelectorAll('[id]').forEach(function (el) { el.removeAttribute('id'); });
      _copyMeasureStyles(sourceEl, clone);
      clone.style.position = 'static';
      clone.style.left = 'auto';
      clone.style.top = 'auto';
      clone.style.transform = 'none';
      clone.style.visibility = 'hidden';
      clone.style.overflow = 'visible';
      clone.style.textOverflow = 'clip';
      clone.style.maxWidth = 'none';
      clone.style.minWidth = '0';
      clone.style.height = 'auto';
      clone.style.minHeight = '0';
      clone.style.float = 'none';
      clone.style.contain = 'none';
      if (Number.isFinite(widthPx) && widthPx > 0) {
        clone.style.display = 'block';
        clone.style.width = Math.ceil(widthPx) + 'px';
      } else {
        clone.style.display = 'inline-block';
        clone.style.width = 'max-content';
      }
      return clone;
    }

    function _measureElement(sourceEl, widthPx, host, htmlOverride) {
      if (!sourceEl) return { width: 0, height: 0, scrollWidth: 0 };
      var clone = _normaliseMeasureClone(sourceEl, widthPx, htmlOverride);
      host.appendChild(clone);
      var rect = clone.getBoundingClientRect();
      var result = {
        width: Math.ceil(rect.width || clone.offsetWidth || 0),
        height: Math.ceil(rect.height || clone.offsetHeight || 0),
        scrollWidth: Math.ceil(clone.scrollWidth || rect.width || 0),
      };
      host.removeChild(clone);
      return result;
    }

    function _horizontalPadding(el) {
      if (!el) return 0;
      var style = window.getComputedStyle(el);
      return _numberFromPx(style.paddingLeft) + _numberFromPx(style.paddingRight);
    }

    function _measureActionCellWidth(cell, host, seed) {
      if (!cell) return 0;
      var seedMax = Number(seed && seed.max_width_px);
      if (Number.isFinite(seedMax) && seedMax > 0 && seedMax <= 260) {
        return seedMax;
      }
      var inlineActions = cell.querySelector('.table-inline-actions');
      if (inlineActions) {
        var measured = _measureElement(inlineActions, null, host).width + _horizontalPadding(cell);
        return Math.ceil(measured);
      }
      return _measureElement(cell, null, host).width;
    }

    function _smallestWidthWithoutExtraWrap(sourceEl, options) {
      options = options || {};
      var host = options.host || _ensureMeasureHost();
      var seed = options.seed || {};
      var isActionColumn = !!options.isActionColumn;
      var measureHtml = options.measureHtml;
      if (isActionColumn && sourceEl && sourceEl.tagName === 'TD') {
        return _measureActionCellWidth(sourceEl, host, seed);
      }
      var natural = _measureElement(sourceEl, null, host, measureHtml);
      var naturalWidth = Math.ceil(natural.width || 0);
      if (!naturalWidth) return 0;

      var minWidth = Math.max(1, Math.ceil(Number(seed.min_width_px) || 1));
      var high = Math.max(naturalWidth, minWidth);
      var baseline = _measureElement(sourceEl, high, host, measureHtml).height || natural.height || 0;
      var tolerance = Number(options.wrapTolerancePx || 1);
      var fitsAtWidth = function (widthPx) {
        var measured = _measureElement(sourceEl, widthPx, host, measureHtml);
        return measured.height <= baseline + tolerance
          && measured.scrollWidth <= Math.ceil(widthPx) + tolerance;
      };
      if (fitsAtWidth(minWidth)) return minWidth;

      var low = minWidth;
      while (low < high) {
        var mid = Math.floor((low + high) / 2);
        if (fitsAtWidth(mid)) {
          high = mid;
        } else {
          low = mid + 1;
        }
      }
      return Math.ceil(high);
    }

    function _smallestWidthWithinHeight(sourceEl, maxHeightPx, options) {
      options = options || {};
      var host = options.host || _ensureMeasureHost();
      var seed = options.seed || {};
      var measureHtml = options.measureHtml;
      var natural = _measureElement(sourceEl, null, host, measureHtml);
      var naturalWidth = Math.ceil(natural.width || 0);
      if (!naturalWidth) return 0;

      var minWidth = Math.max(1, Math.ceil(Number(seed.min_width_px) || 1));
      var high = Math.max(naturalWidth, minWidth);
      var tolerance = Number(options.wrapTolerancePx || 1);
      var maxHeight = Math.max(1, Math.ceil(Number(maxHeightPx) || natural.height || 1));
      var fitsAtWidth = function (widthPx) {
        var measured = _measureElement(sourceEl, widthPx, host, measureHtml);
        return measured.height <= maxHeight + tolerance
          && measured.scrollWidth <= Math.ceil(widthPx) + tolerance;
      };
      if (!fitsAtWidth(high)) return high;
      if (fitsAtWidth(minWidth)) return minWidth;

      var low = minWidth;
      while (low < high) {
        var mid = Math.floor((low + high) / 2);
        if (fitsAtWidth(mid)) high = mid;
        else low = mid + 1;
      }
      return Math.ceil(high);
    }

    function _headerAffordanceReserve(headerEl) {
      if (!headerEl) return 0;
      return headerEl.querySelector('.table-sort-arrow') ? 12 : 0;
    }

    function _headerPlainLabel(headerEl) {
      if (!headerEl) return '';
      var clone = headerEl.cloneNode(true);
      clone.querySelectorAll('.table-sort-arrow, .table-col-resize').forEach(function (el) {
        el.remove();
      });
      return (clone.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function _headerMeasureHtml(headerEl, labelHtml) {
      if (!headerEl) return '';
      var clone = headerEl.cloneNode(true);
      clone.querySelectorAll('.table-col-resize').forEach(function (el) { el.remove(); });
      var sortLabel = clone.querySelector('.table-th-sort') || clone;
      var arrow = sortLabel.querySelector('.table-sort-arrow');
      var arrowHtml = arrow ? arrow.outerHTML : '';
      sortLabel.innerHTML = labelHtml + arrowHtml;
      return clone.innerHTML;
    }

    function _safeHeaderLabelHtml(label) {
      return safeHeaderLabelHtml(label);
    }

    function _validHyphenatedHeaderLabel(label, candidate) {
      var source = String(label || '').replace(/[^a-z0-9]+/gi, '').toLowerCase();
      var target = String(candidate || '').replace(/[^a-z0-9]+/gi, '').toLowerCase();
      return !!(source && target && source === target && String(candidate || '').indexOf('<') < 0);
    }

    async function _requestHyphenatedHeaderLabel(label, context) {
      var text = String(label || '').replace(/\s+/g, ' ').trim();
      if (!text || typeof apiFetch !== 'function') return null;
      var cacheKey = [
        getTableName(),
        context && context.columnKey,
        text,
      ].join('|').toLowerCase();
      if (Object.prototype.hasOwnProperty.call(headerHyphenationCache, cacheKey)) {
        return headerHyphenationCache[cacheKey];
      }
      if (!/^[A-Za-z][A-Za-z0-9-]{6,}$/.test(text)) {
        headerHyphenationCache[cacheKey] = null;
        return null;
      }
      var fallback = _deterministicHyphenatedHeaderLabel(text);
      try {
        var response = await apiFetch('/api/v1/table-layouts/hyphenate-header', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            header: text,
            table_name: getTableName(),
            column_key: context && context.columnKey ? context.columnKey : null,
            examples: headerHyphenationExamples,
          }),
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        var payload = await response.json();
        var headerLabel = payload && payload.changed ? String(payload.header_label || '').trim() : '';
        if (headerLabel && _validHyphenatedHeaderLabel(text, headerLabel)) {
          headerHyphenationCache[cacheKey] = _escapeLayoutText(headerLabel);
          return headerHyphenationCache[cacheKey];
        }
      } catch (error) {
        console.warn(getSurfaceLabel() + ' header hyphenation failed:', error);
      }
      headerHyphenationCache[cacheKey] = fallback;
      return fallback;
    }

    async function _wrappedHeaderLabel(label, context) {
      var text = String(label || '').replace(/\s+/g, ' ').trim();
      if (!text) return null;
      var parts = text.split(' ').filter(Boolean);
      if (parts.length > 1) {
        return parts.map(function (part) { return _escapeLayoutText(part); }).join('<br>');
      }
      return _requestHyphenatedHeaderLabel(text, context);
    }

    function _deterministicHyphenatedHeaderLabel(label) {
      var text = String(label || '').replace(/\s+/g, ' ').trim();
      if (!/^[A-Za-z][A-Za-z0-9-]{6,}$/.test(text)) return null;
      var plain = text.replace(/-/g, '');
      var lower = plain.toLowerCase();
      var suffixes = ['names', 'name', 'tion', 'sion', 'ment', 'ness', 'able', 'ible', 'less', 'ship', 'ing'];
      var splitAt = -1;
      suffixes.some(function (suffix) {
        if (!lower.endsWith(suffix)) return false;
        var index = plain.length - suffix.length;
        if (index < 3 || plain.length - index < 3) return false;
        splitAt = index;
        return true;
      });
      if (splitAt < 0) {
        var target = Math.floor(plain.length * 0.58);
        for (var i = target; i >= 3; i -= 1) {
          if (/[aeiouy]/i.test(plain.charAt(i - 1)) && /[bcdfghjklmnpqrstvwxz]/i.test(plain.charAt(i))) {
            splitAt = i;
            break;
          }
        }
      }
      if (splitAt < 3 || plain.length - splitAt < 3) return null;
      return _escapeLayoutText(plain.slice(0, splitAt) + '-' + plain.slice(splitAt));
    }

    function _measureHeaderLineProfile(headerEl, widthPx, host, htmlOverride) {
      if (!headerEl || !Number.isFinite(Number(widthPx)) || Number(widthPx) <= 0) {
        return { lineCount: 0, widestIsLast: false };
      }
      var clone = _normaliseMeasureClone(headerEl, widthPx, htmlOverride);
      host.appendChild(clone);
      clone.querySelectorAll('.table-col-resize, .table-sort-arrow').forEach(function (el) {
        el.remove();
      });
      var sortLabel = clone.querySelector('.table-th-sort') || clone;
      var groups = [];
      var walker = document.createTreeWalker(sortLabel, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
          return /\S/.test(node.nodeValue || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      });
      var node = walker.nextNode();
      while (node) {
        var range = document.createRange();
        range.selectNodeContents(node);
        Array.prototype.slice.call(range.getClientRects()).forEach(function (rect) {
          if (!rect || rect.width <= 0 || rect.height <= 0) return;
          var top = Math.round(rect.top);
          var group = groups.find(function (candidate) {
            return Math.abs(candidate.top - top) <= 2;
          });
          if (!group) {
            group = { top: top, left: rect.left, right: rect.right };
            groups.push(group);
          } else {
            group.left = Math.min(group.left, rect.left);
            group.right = Math.max(group.right, rect.right);
          }
        });
        range.detach();
        node = walker.nextNode();
      }
      host.removeChild(clone);
      groups.sort(function (left, right) { return left.top - right.top; });
      if (!groups.length) return { lineCount: 0, widestIsLast: false };
      var widestIndex = 0;
      groups.forEach(function (group, index) {
        group.width = Math.ceil(group.right - group.left);
        if (group.width >= groups[widestIndex].width) widestIndex = index;
      });
      return {
        lineCount: groups.length,
        widestIsLast: widestIndex === groups.length - 1,
        lines: groups,
      };
    }

    function _headerDominanceBuffer(headerEl, widthPx, rawBodyWidth, host, htmlOverride) {
      var reserve = _headerAffordanceReserve(headerEl);
      if (!reserve || !headerEl || widthPx <= rawBodyWidth) return 0;
      var profile = _measureHeaderLineProfile(headerEl, widthPx, host, htmlOverride);
      if (!profile.lineCount || profile.lineCount <= 1) return reserve;
      return profile.widestIsLast ? reserve * 2 : reserve;
    }

    function _headerHtmlForColumn(headerEl, column) {
      return column && column.headerLabel ? _headerMeasureHtml(headerEl, column.headerLabel) : null;
    }

    function _columnBodyBreathingPx(column, rows, columns) {
      if (!column || column.columnKey.charAt(0) === '_') return 0;
      var hasChip = rows.some(function (row) {
        var cell = _cellForColumn(row, column.columnKey, column.index, columns.length);
        return !!(cell && cell.querySelector('.ip-chip'));
      });
      if (hasChip) return 0;
      if (column.rawBodyWidth >= 80) return 8;
      if (column.rawBodyWidth >= 44) return 4;
      return 2;
    }

    function _polishHeaderSortReserve(headerEl, widthPx, rawBodyWidth, host, htmlOverride) {
      var reserve = _headerAffordanceReserve(headerEl);
      if (!reserve || !headerEl) return 0;
      var profile = _measureHeaderLineProfile(headerEl, widthPx, host, htmlOverride);
      if (!profile.lineCount || profile.lineCount <= 1 || !profile.lines || !profile.lines.length) {
        return 0;
      }
      var widest = profile.lines.reduce(function (max, line) {
        return Math.max(max, Number(line.width) || 0);
      }, 0);
      var last = profile.lines[profile.lines.length - 1];
      var lastWidth = Number(last && last.width) || 0;
      if (!profile.widestIsLast && lastWidth >= widest - reserve) {
        return Math.ceil(reserve * 0.5);
      }
      return 0;
    }

    function _polishMeasuredColumns(measuredColumns, context) {
      context = context || {};
      var rows = context.rows || [];
      var columns = context.columns || [];
      var headerMap = context.headerMap || Object.create(null);
      var host = context.host || _ensureMeasureHost();
      var viewportWidth = Number(context.viewportWidth) || 0;
      var sortState = context.sortState || { key: null, dir: 0 };
      var hiddenSet = context.hiddenSet || new Set();
      var maxGrowPerColumn = Math.max(0, Number(context.maxGrowPerColumn || 14));
      var targetFillRatio = Number(context.targetFillRatio || 0.985);
      var sortableMinWidth = Math.max(0, Number(context.sortableMinWidth || 50));
      var polished = measuredColumns.map(function (column) {
        var seed = getColumnSeed(column.columnKey, column.index, sortState, hiddenSet);
        var headerEl = headerMap[column.columnKey];
        var headerHtml = _headerHtmlForColumn(headerEl, column);
        var isParentheticalHeader = headerEl && /\([^)]+\)/.test(_headerPlainLabel(headerEl));
        var bodyNeed = column.rawBodyWidth + _columnBodyBreathingPx(column, rows, columns);
        var headerNeed = 0;
        if (headerEl) {
          var currentHeader = _measureElement(headerEl, column.width, host, headerHtml);
          headerNeed = _smallestWidthWithinHeight(headerEl, currentHeader.height || 1, {
            host: host,
            seed: seed,
            measureHtml: headerHtml,
            wrapTolerancePx: 1,
          });
          if (!isParentheticalHeader) {
            headerNeed += _polishHeaderSortReserve(headerEl, headerNeed, bodyNeed, host, headerHtml);
          }
        }
        var preferred = Math.max(bodyNeed, headerNeed || 0);
        if (headerEl && headerEl.querySelector('.table-sort-arrow') && column.columnKey.charAt(0) !== '_') {
          preferred = Math.max(preferred, sortableMinWidth);
          if (isParentheticalHeader && bodyNeed < 90) {
            preferred = Math.max(preferred, sortableMinWidth + 23);
          } else {
            preferred += _polishHeaderSortReserve(headerEl, preferred, bodyNeed, host, headerHtml);
          }
        }
        if (column.columnKey.charAt(0) === '_') {
          preferred = Math.max(preferred, column.width);
        }
        var nextWidth = _clampMeasuredWidth(preferred, seed, column.columnKey, viewportWidth);
        if (nextWidth > column.width) {
          nextWidth = Math.min(nextWidth, column.width + maxGrowPerColumn);
        }
        column.polishNeedWidth = Math.ceil(preferred || 0);
        column.polishBeforeWidth = column.width;
        column.width = nextWidth;
        column.polishDelta = column.width - column.polishBeforeWidth;
        return column;
      });

      var targetWidth = viewportWidth > 0 ? Math.floor(viewportWidth * targetFillRatio) : 0;
      var total = polished.reduce(function (sum, column) { return sum + column.width; }, 0);
      if (targetWidth > 0 && total < targetWidth) {
        var remaining = targetWidth - total;
        var recipients = polished.filter(function (column) {
          return column.columnKey.charAt(0) !== '_' && column.rawBodyWidth >= 44;
        }).map(function (column) {
          return {
            column: column,
            cap: Math.max(0, Math.min(maxGrowPerColumn, (Number(column.maxWidth) || 900) - column.width)),
            slack: column.width - (column.polishNeedWidth || column.rawBodyWidth || 0),
          };
        }).filter(function (entry) {
          return entry.cap > 0;
        }).sort(function (left, right) {
          return left.slack - right.slack;
        });
        while (remaining > 0 && recipients.length) {
          var changed = false;
          recipients.forEach(function (entry) {
            if (remaining <= 0 || entry.cap <= 0) return;
            entry.column.width += 1;
            entry.column.polishDelta += 1;
            entry.cap -= 1;
            remaining -= 1;
            changed = true;
          });
          if (!changed) break;
        }
      }
      return polished;
    }

    function _percentile(values, fraction) {
      var sorted = values.filter(function (value) {
        return Number.isFinite(value) && value > 0;
      }).sort(function (a, b) { return a - b; });
      if (!sorted.length) return 0;
      var f = Number.isFinite(Number(fraction)) ? Number(fraction) : 1;
      f = Math.max(0, Math.min(1, f));
      var index = Math.max(0, Math.ceil(sorted.length * f) - 1);
      return sorted[index];
    }

    function _clampMeasuredWidth(width, seed, columnKey, viewportWidth) {
      var minWidth = Math.max(1, Math.ceil(Number(seed && seed.min_width_px) || 40));
      var maxWidth = Math.ceil(Number(seed && seed.max_width_px) || 900);
      if (columnKey && columnKey.charAt(0) === '_' && maxWidth <= 260) {
        minWidth = Math.min(minWidth, maxWidth);
      }
      var mobileCap = Math.max(minWidth, Math.floor((viewportWidth || window.innerWidth || 0) * 0.66));
      var isMobilePortrait = (window.innerWidth || 0) <= 600 && window.matchMedia('(orientation: portrait)').matches;
      var effectiveMax = isMobilePortrait && !(columnKey && columnKey.charAt(0) === '_')
        ? Math.min(maxWidth, Math.max(mobileCap, minWidth))
        : maxWidth;
      return Math.max(minWidth, Math.min(Math.ceil(width || minWidth), effectiveMax));
    }

    async function _measureHorizontalLayout(options) {
      options = options || {};
      var tableEl = getTable();
      var view = getView();
      if (!tableEl || !view) return null;
      var host = _ensureMeasureHost();
      var columns = _visibleColumnKeys();
      var sortState = typeof view.getSortState === 'function' ? view.getSortState() : { key: null, dir: 0 };
      var hiddenSet = typeof view.getHiddenSet === 'function' ? view.getHiddenSet() : new Set();
      var headerMap = Object.create(null);
      Array.prototype.slice.call(tableEl.querySelectorAll('thead th[data-col]')).forEach(function (th) {
        headerMap[th.dataset.col] = th;
      });
      var rows = Array.prototype.slice.call(tableEl.querySelectorAll('tbody tr'));
      var viewportWidth = tableEl.closest('.table-wrap')?.clientWidth || window.innerWidth || 0;
      var percentile = Object.prototype.hasOwnProperty.call(options, 'percentile') ? Number(options.percentile) : 1;
      var rowHeights = rows.map(function (row) {
        return Math.ceil(row.getBoundingClientRect().height || 0);
      }).filter(function (height) { return Number.isFinite(height) && height > 0; });
      var meanRowHeight = rowHeights.length
        ? rowHeights.reduce(function (sum, height) { return sum + height; }, 0) / rowHeights.length
        : 48;
      var maxCompactHeaderHeight = Math.ceil(meanRowHeight * Number(options.headerWrapRowRatio || 1.2));
      var measuredColumns = await Promise.all(columns.map(async function (columnKey, index) {
        var seed = getColumnSeed(columnKey, index, sortState, hiddenSet);
        var isActionColumn = columnKey.charAt(0) === '_';
        var bodyWidths = [];
        var headerEl = headerMap[columnKey];
        var headerWidth = 0;
        var compactHeaderLabel = null;
        var compactHeaderWidth = 0;
        if (headerEl) {
          headerWidth = _smallestWidthWithoutExtraWrap(headerEl, {
            host: host,
            seed: seed,
            wrapTolerancePx: 1,
          }) + _headerAffordanceReserve(headerEl);
        }
        rows.forEach(function (row) {
          var cell = _cellForColumn(row, columnKey, index, columns.length);
          if (!cell) return;
          bodyWidths.push(_smallestWidthWithoutExtraWrap(cell, {
            host: host,
            seed: seed,
            isActionColumn: isActionColumn,
            wrapTolerancePx: 1,
          }));
        });
        var rawBodyWidth = _percentile(bodyWidths, percentile);
        if (rows.some(function (row) {
          var cell = _cellForColumn(row, columnKey, index, columns.length);
          return !!(cell && cell.querySelector('.ip-chip'));
        })) {
          rawBodyWidth += Number(options.chipBreathingPx || 18);
        }
        var rawWidth = Math.max(headerWidth, rawBodyWidth);
        if (headerEl && headerWidth > 0 && rawBodyWidth > 0 && !isActionColumn) {
          compactHeaderWidth = _smallestWidthWithinHeight(headerEl, maxCompactHeaderHeight, {
            host: host,
            seed: seed,
            wrapTolerancePx: 1,
          }) + _headerAffordanceReserve(headerEl);

          var singleWordLabel = _headerPlainLabel(headerEl);
          var narrowDataThreshold = Math.max(headerWidth * 0.3, (Number(seed.min_width_px) || 40) + 12);
          if (rawBodyWidth <= narrowDataThreshold) {
            compactHeaderLabel = await _requestHyphenatedHeaderLabel(singleWordLabel, {
              columnKey: columnKey,
            });
            if (compactHeaderLabel) {
              compactHeaderWidth = _smallestWidthWithinHeight(headerEl, maxCompactHeaderHeight, {
                host: host,
                seed: seed,
                measureHtml: _headerMeasureHtml(headerEl, compactHeaderLabel),
                wrapTolerancePx: 1,
              }) + _headerAffordanceReserve(headerEl);
            }
          }

          var compactRawWidth = Math.max(rawBodyWidth, compactHeaderWidth);
          if (compactRawWidth > 0 && compactRawWidth <= headerWidth * Number(options.headerWrapSavingsRatio || 0.7)) {
            rawWidth = compactRawWidth + _headerDominanceBuffer(
              headerEl,
              compactHeaderWidth,
              rawBodyWidth,
              host,
              compactHeaderLabel ? _headerMeasureHtml(headerEl, compactHeaderLabel) : null
            );
          } else {
            compactHeaderLabel = null;
            rawWidth += _headerDominanceBuffer(headerEl, headerWidth, rawBodyWidth, host, null);
          }
        } else if (headerEl && headerWidth > 0 && !isActionColumn) {
          rawWidth += _headerDominanceBuffer(headerEl, headerWidth, rawBodyWidth, host, null);
        }
        var width = _clampMeasuredWidth(rawWidth, seed, columnKey, viewportWidth);
        return {
          columnKey: columnKey,
          index: index,
          width: width,
          rawWidth: rawWidth,
          rawBodyWidth: rawBodyWidth,
          headerWidth: headerWidth,
          compactHeaderWidth: compactHeaderWidth,
          headerLabel: compactHeaderLabel,
          minWidth: seed.min_width_px,
          maxWidth: seed.max_width_px,
        };
      }));
      var anyHeaderWrapped = measuredColumns.some(function (column) {
        var headerEl = headerMap[column.columnKey];
        if (!headerEl) return false;
        var profile = _measureHeaderLineProfile(
          headerEl,
          column.width,
          host,
          _headerHtmlForColumn(headerEl, column)
        );
        return profile.lineCount > 1;
      });
      if (anyHeaderWrapped) {
        for (var secondPassIndex = 0; secondPassIndex < measuredColumns.length; secondPassIndex += 1) {
          var column = measuredColumns[secondPassIndex];
          var headerEl = headerMap[column.columnKey];
          if (!headerEl || column.columnKey.charAt(0) === '_' || !(column.headerWidth > column.rawBodyWidth)) {
            continue;
          }
          var currentProfile = _measureHeaderLineProfile(
            headerEl,
            column.width,
            host,
            _headerHtmlForColumn(headerEl, column)
          );
          if (currentProfile.lineCount > 1) continue;

          var wrappedLabel = await _wrappedHeaderLabel(_headerPlainLabel(headerEl), {
            columnKey: column.columnKey,
          });
          if (!wrappedLabel) continue;
          var wrappedHtml = _headerMeasureHtml(headerEl, wrappedLabel);
          var wrappedHeaderWidth = _smallestWidthWithinHeight(headerEl, maxCompactHeaderHeight, {
            host: host,
            seed: getColumnSeed(column.columnKey, column.index, sortState, hiddenSet),
            measureHtml: wrappedHtml,
            wrapTolerancePx: 1,
          }) + _headerAffordanceReserve(headerEl);
          var candidateRawWidth = Math.max(column.rawBodyWidth, wrappedHeaderWidth)
            + _headerDominanceBuffer(headerEl, wrappedHeaderWidth, column.rawBodyWidth, host, wrappedHtml);
          var candidateWidth = _clampMeasuredWidth(
            candidateRawWidth,
            getColumnSeed(column.columnKey, column.index, sortState, hiddenSet),
            column.columnKey,
            viewportWidth
          );
          if (candidateWidth <= column.width + Number(options.headerSecondPassTolerancePx || 2)) {
            column.width = candidateWidth;
            column.rawWidth = candidateRawWidth;
            column.compactHeaderWidth = wrappedHeaderWidth;
            column.headerLabel = wrappedLabel;
            column.secondPassHeaderWrap = true;
          }
        }
      }
      measuredColumns = _polishMeasuredColumns(measuredColumns, {
        rows: rows,
        columns: columns,
        headerMap: headerMap,
        host: host,
        viewportWidth: viewportWidth,
        sortState: sortState,
        hiddenSet: hiddenSet,
        maxGrowPerColumn: options.polishMaxGrowPerColumnPx || 14,
        sortableMinWidth: options.polishSortableMinWidthPx || 50,
        targetFillRatio: options.polishTargetFillRatio || 0.985,
      });
      return {
        columns: measuredColumns,
        rowCount: rows.length,
        viewportWidth: viewportWidth,
        tableWidth: measuredColumns.reduce(function (sum, column) { return sum + column.width; }, 0),
        percentile: percentile,
      };
    }

    async function autoFitHorizontalLayout(options) {
      options = options || {};
      var view = getView();
      if (!view) return null;
      if (options.ensureHorizontalScroll !== false
          && typeof view.isHorizontalScrollEnabled === 'function'
          && typeof view.setHorizontalScrollEnabled === 'function'
          && !view.isHorizontalScrollEnabled()) {
        view.setHorizontalScrollEnabled(true);
      }
      if (view.prefs && typeof view.prefs.setHiddenSet === 'function' && options.includeAllColumns !== false) {
        view.prefs.setHiddenSet(new Set());
      }
      await resolveRemoteLayout({ rerender: false, forceApply: true });
      if (view.prefs && typeof view.prefs.setHiddenSet === 'function' && options.includeAllColumns !== false) {
        view.prefs.setHiddenSet(new Set());
      }
      if (typeof cfg.render === 'function') cfg.render();
      await _afterNextPaint();

      headerHyphenationCache = Object.create(null);
      var measurement = await _measureHorizontalLayout(options);
      var layoutData = buildLayoutPayload();
      if (!measurement || !layoutData) return measurement;
      var widthsByColumn = Object.create(null);
      var headerLabelsByColumn = Object.create(null);
      measurement.columns.forEach(function (column) {
        widthsByColumn[column.columnKey] = column.width;
        if (column.headerLabel) headerLabelsByColumn[column.columnKey] = column.headerLabel;
      });
      layoutData.seed_origin = options.seedOrigin || 'browser-measured';
      layoutData.algorithm_version = options.algorithmVersion || 'browser-measured-horizontal-v1';
      layoutData.bucket_flags = getViewportBits();
      layoutData.measurement = {
        row_count: measurement.rowCount,
        viewport_width_px: measurement.viewportWidth,
        table_width_px: measurement.tableWidth,
        percentile: measurement.percentile,
      };
      layoutData.columns.forEach(function (column) {
        if (!column || !column.column_key) return;
        if (Object.prototype.hasOwnProperty.call(widthsByColumn, column.column_key)) {
          column.width_px = widthsByColumn[column.column_key];
        }
        if (Object.prototype.hasOwnProperty.call(headerLabelsByColumn, column.column_key)) {
          column.header_label = headerLabelsByColumn[column.column_key];
        } else {
          delete column.header_label;
        }
        if (options.includeAllColumns !== false) column.hidden = false;
      });

      applyRemoteLayout(layoutData);
      await persistLayout({ layoutData: layoutData });
      if (typeof cfg.render === 'function') cfg.render();
      _syncQuickActionsState();
      return measurement;
    }

    async function autoFitLayout(options) {
      options = Object.assign({}, options || {});
      var view = getView();
      var horizontalScrollEnabled = !!(view
        && typeof view.isHorizontalScrollEnabled === 'function'
        && view.isHorizontalScrollEnabled());
      if (!Object.prototype.hasOwnProperty.call(options, 'ensureHorizontalScroll')) {
        options.ensureHorizontalScroll = horizontalScrollEnabled;
      }
      if (!Object.prototype.hasOwnProperty.call(options, 'includeAllColumns')) {
        options.includeAllColumns = horizontalScrollEnabled;
      }
      return autoFitHorizontalLayout(options);
    }

    function scheduleLayoutSave(options) {
      options = options || {};
      clearTimeout(layoutSaveTimer);
      var requestedLayoutKey = options.layoutKey || layoutKey;
      var requestedLayoutData = options.layoutData || buildLayoutPayload();
      layoutSaveTimer = window.setTimeout(function () {
        if (applyingRemoteLayout) {
          // User edits during a remote apply must be queued, not dropped.
          scheduleLayoutSave({
            layoutKey: requestedLayoutKey,
            layoutData: requestedLayoutData,
          });
          return;
        }
        persistLayout({
          layoutKey: requestedLayoutKey,
          layoutData: requestedLayoutData,
        }).catch(function (error) {
          console.warn(getSurfaceLabel() + ' table layout save failed:', error);
        });
      }, saveDelayMs);
    }

    async function persistLayout(options) {
      options = options || {};
      var view = getView();
      if (!view || typeof apiFetch !== 'function') return;
      var targetLayoutKey = options.layoutKey || layoutKey;
      var layoutData = options.layoutData || null;
      if (!targetLayoutKey) {
        var resolved = await resolveRemoteLayout({ rerender: false });
        if (!(resolved && resolved.layout_key)) return;
        targetLayoutKey = resolved.layout_key;
      }
      if (!layoutData) {
        layoutData = buildLayoutPayload();
      }
      if (!layoutData) return;
      var nextSignature = layoutSignature(layoutData);
      if (nextSignature && nextSignature === _signatureForKey(targetLayoutKey)) return;
      var response = await apiFetch('/api/v1/table-layouts/' + encodeURIComponent(targetLayoutKey), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout_data: layoutData }),
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var payload = await response.json();
      var savedLayoutKey = payload.layout_key || targetLayoutKey;
      var savedSignature = layoutSignature(payload.layout_data);
      _rememberSignature(savedLayoutKey, savedSignature);
      if (!layoutKey || layoutKey === targetLayoutKey) {
        layoutKey = savedLayoutKey;
      }
      _syncQuickActionsState();
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
              _rememberSignature(layoutKey, layoutSignature(savedLayout));
              if (typeof cfg.render === 'function') cfg.render();
            }
            return { layoutData: savedLayout };
          },
          onApplySibling: async function (entry, siblingEntry) {
            var siblingBucket = siblingEntry && siblingEntry.bucketCode ? String(siblingEntry.bucketCode) : 'sibling';
            var confirmed = await HubDialogs.confirm({
              title: 'Reapply from sibling bucket?',
              message: 'Overwrite bucket ' + entry.bucketCode + ' with settings from bucket ' + siblingBucket + '?',
              detail: 'This keeps the target bucket identity and copies widths, hidden columns, and sort data from the sibling.',
              confirmLabel: 'Apply',
            });
            if (!confirmed) return false;

            var nextLayoutData = _cloneLayoutData((siblingEntry && siblingEntry.layoutData) || {});
            nextLayoutData.bucket_flags = _normalizeLayoutFlags(entry && entry.layoutData && entry.layoutData.bucket_flags);
            nextLayoutData.seed_origin = 'sibling-reapply';

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
              _rememberSignature(layoutKey, layoutSignature(savedLayout));
              if (typeof cfg.render === 'function') cfg.render();
            }
            return {
              layoutData: savedLayout,
              hint: 'Reapplied from sibling bucket ' + siblingBucket,
            };
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
        var shadeNow = !!(document.body && document.body.classList.contains('shade-is-up'));
        var activeFlags = _flagsFromBucketCode(String(layoutKey || '').slice(-2));
        if (activeFlags && activeFlags.shade_up !== shadeNow) {
          activeFlags.shade_up = shadeNow;
          resolveRemoteLayout({ rerender: true, bucketBits: activeFlags, forceApply: true });
          return;
        }
        resolveRemoteLayout({ rerender: true, forceApply: true });
      });
      return layoutChangeUnsub;
    }

    function init() {
      bindLayoutChange();
      _syncQuickActionsState();
      document.addEventListener('bodyshadechange', function () {
        _syncQuickActionsState();
        _pulseQuickActions();
      }, { passive: true });
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
      autoFitLayout: autoFitLayout,
      autoFitHorizontalLayout: autoFitHorizontalLayout,
      toggleHorizontalScroll: toggleHorizontalScroll,
      setHorizontalScrollEnabled: function (enabled) {
        var view = getView();
        if (!view || typeof view.setHorizontalScrollEnabled !== 'function') return false;
        return view.setHorizontalScrollEnabled(!!enabled);
      },
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
    filteredEntries: [],
    shadeSiblingByLayoutKey: new Map(),
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

  function _layoutBaseSignature(flags) {
    var normalized = _normalizeLayoutFlags(flags);
    return _TABLE_LAYOUT_FLAG_DEFS.filter(function (def) {
      return def.key !== 'shade_up';
    }).map(function (def) {
      return def.key + ':' + (normalized[def.key] ? '1' : '0');
    }).join('|');
  }

  function _buildShadeSiblingMap(entries) {
    var grouped = new Map();
    (entries || []).forEach(function (entry) {
      if (!entry || !entry.layoutKey) return;
      var flags = _normalizeLayoutFlags(entry.layoutData && entry.layoutData.bucket_flags);
      var signature = _layoutBaseSignature(flags);
      var bucket = grouped.get(signature);
      if (!bucket) {
        bucket = { up: [], down: [] };
        grouped.set(signature, bucket);
      }
      if (flags.shade_up) bucket.up.push(entry);
      else bucket.down.push(entry);
    });

    var siblingByLayoutKey = new Map();
    grouped.forEach(function (bucket) {
      if (!bucket.up.length || !bucket.down.length) return;
      bucket.up.sort(function (left, right) {
        return String(left.layoutKey || '').localeCompare(String(right.layoutKey || ''));
      });
      bucket.down.sort(function (left, right) {
        return String(left.layoutKey || '').localeCompare(String(right.layoutKey || ''));
      });
      bucket.up.forEach(function (upEntry, index) {
        var source = bucket.down[Math.min(index, bucket.down.length - 1)] || null;
        if (source) siblingByLayoutKey.set(String(upEntry.layoutKey || ''), source);
      });
    });
    return siblingByLayoutKey;
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

  function _flagsFromBucketCode(bucketCode) {
    var raw = String(bucketCode || '').replace(/^0x/i, '').toUpperCase();
    if (raw.length === 1) raw = '0' + raw;
    if (!/^[0-9A-F]{2}$/.test(raw)) return null;
    var value = parseInt(raw, 16);
    var flags = {};
    _TABLE_LAYOUT_FLAG_DEFS.forEach(function (def) {
      flags[def.key] = !!(value & (1 << def.bit));
    });
    return flags;
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

  async function _applyLayoutContextSibling(entryId) {
    var entry = _TABLE_LAYOUT_CONTEXT_ENTRIES.get(entryId);
    var options = _TABLE_LAYOUT_CONTEXT_STATE.options || {};
    if (!entry || _TABLE_LAYOUT_CONTEXT_STATE.busy || typeof options.onApplySibling !== 'function') return;
    var sibling = _TABLE_LAYOUT_CONTEXT_STATE.shadeSiblingByLayoutKey.get(String(entry.layoutKey || ''));
    if (!sibling) return;
    _TABLE_LAYOUT_CONTEXT_STATE.busy = true;
    try {
      var result = await options.onApplySibling(entry, sibling);
      if (result !== false) {
        await _refreshLayoutContextEntries();
      }
    } catch (error) {
      if (window.HubDialogs && typeof HubDialogs.alertError === 'function') {
        await HubDialogs.alertError({
          title: 'Sibling apply failed',
          message: error && error.message ? error.message : 'Failed to reapply from sibling bucket.',
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
    var shadeSiblingByLayoutKey = _buildShadeSiblingMap(filteredEntries);
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

    _TABLE_LAYOUT_CONTEXT_STATE.filteredEntries = filteredEntries;
    _TABLE_LAYOUT_CONTEXT_STATE.shadeSiblingByLayoutKey = shadeSiblingByLayoutKey;

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
      var siblingHtml = '';
      var siblingEntry = shadeSiblingByLayoutKey.get(String(entry.layoutKey || ''));
      if (siblingEntry && typeof options.onApplySibling === 'function') {
        siblingHtml = ''
          + '<button type="button" class="table-layout-context-entry__action table-layout-context-entry__action--sibling" '
          + 'title="Reapply from sibling bucket ' + _escapeLayoutText(siblingEntry.bucketCode || '') + '" '
          + 'aria-label="Reapply from sibling bucket" '
          + 'data-layout-context-open="sibling" data-layout-context-id="' + _escapeLayoutText(id) + '">'
          + '<span class="table-layout-context-entry__action-long">FROM SIBLING</span>'
          + '<span class="table-layout-context-entry__action-short">SIBLING</span>'
          + '</button>';
      }

      card.innerHTML = '' +
        '<div class="table-layout-context-entry__surface" role="button" tabindex="0" data-layout-context-open="detail" data-layout-context-id="' + _escapeLayoutText(id) + '">' +
          '<div class="table-layout-context-entry__top">' +
            '<span class="table-layout-context-entry__title">' + _escapeLayoutText(entry.title || entry.layoutKey || 'Layout') + '</span>' +
            '<div class="table-layout-context-entry__top-actions">' +
              '<div class="table-layout-context-entry__actions">' +
                siblingHtml +
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
    _TABLE_LAYOUT_CONTEXT_STATE.filteredEntries = [];
    _TABLE_LAYOUT_CONTEXT_STATE.shadeSiblingByLayoutKey = new Map();
    _TABLE_LAYOUT_CONTEXT_STATE.activeEntryId = null;
    _TABLE_LAYOUT_CONTEXT_STATE.filters = _normalizeLayoutFlags(opts.initialFilters);
    _TABLE_LAYOUT_CONTEXT_STATE.busy = false;
    _renderLayoutContext();

    HubModal.open(dialog, {
      onClose: function () {
        _TABLE_LAYOUT_CONTEXT_ENTRIES.clear();
        _TABLE_LAYOUT_CONTEXT_STATE.options = null;
        _TABLE_LAYOUT_CONTEXT_STATE.entries = [];
        _TABLE_LAYOUT_CONTEXT_STATE.filteredEntries = [];
        _TABLE_LAYOUT_CONTEXT_STATE.shadeSiblingByLayoutKey = new Map();
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
      } else if (layoutBtn.dataset.layoutContextOpen === 'sibling') {
        _applyLayoutContextSibling(layoutBtn.dataset.layoutContextId);
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
