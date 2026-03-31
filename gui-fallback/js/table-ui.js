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
    return 'desktop';
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

  function ensureLayoutState(state, layoutKey) {
    if (!state.layouts) state.layouts = {};
    if (!state.layouts[layoutKey]) {
      state.layouts[layoutKey] = { hidden: null, widths: {} };
    }
    if (!state.layouts[layoutKey].widths) state.layouts[layoutKey].widths = {};
    return state.layouts[layoutKey];
  }

  function createTablePrefs(cfg) {
    var state = readJson(cfg.storageKey, null);
    var currentLayout = getLayoutKey();
    var listeners = [];
    var resizeTimer = null;

    if (!state || typeof state !== 'object') {
      state = { layouts: {} };
      if (cfg.legacyHiddenKey) {
        var legacyHidden = readJson(cfg.legacyHiddenKey, null);
        if (Array.isArray(legacyHidden)) {
          ensureLayoutState(state, currentLayout).hidden = legacyHidden.slice();
        }
      }
      writeJson(cfg.storageKey, state);
    }

    function persist() {
      writeJson(cfg.storageKey, state);
    }

    function getLayoutState(layoutKey) {
      return ensureLayoutState(state, layoutKey || currentLayout);
    }

    function syncColumns(columns) {
      var known = new Set(columns || []);
      Object.keys(state.layouts || {}).forEach(function (layoutKey) {
        var layout = getLayoutState(layoutKey);
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

    function applyWidths(tableEl) {
      if (!tableEl) return;
      tableEl.querySelectorAll('thead th[data-col]').forEach(function (th) {
        var width = getWidth(th.dataset.col);
        th.style.width = width ? width + 'px' : th.style.width || '';
      });
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
      applyWidths(tableEl);
      bindColumnResize(tableEl, { minWidth: options.minWidth || minWidth });
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
        var nextLayout = getLayoutKey();
        if (nextLayout === currentLayout) return;
        currentLayout = nextLayout;
        listeners.forEach(function (listener) { listener(nextLayout); });
      }, 120);
    }

    window.addEventListener('resize', handleResize, { passive: true });
    window.addEventListener('orientationchange', handleResize, { passive: true });

    return {
      getLayoutKey: getLayoutKey,
      isCompactLayout: isCompactLayout,
      syncColumns: syncColumns,
      getHiddenSet: getHiddenSet,
      setHiddenSet: setHiddenSet,
      getWidth: getWidth,
      setWidth: setWidth,
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
      rebuildHead: rebuildHead,
      render: render,
      openColumns: openColumns,
      applyColumns: applyColumns,
      onLayoutChange: onLayoutChange,
      syncColumns: syncColumns,
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
    var btn = e.target.closest('[data-action-id]');
    if (!btn) return;
    var action = _ROW_ACTIONS.get(btn.dataset.actionId);
    if (typeof action !== 'function') return;
    HubModal.close(document.getElementById('table-row-actions-modal'));
    window.setTimeout(function () { action(); }, 0);
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

  window.TableRowActions = {
    isCompact: isCompactActions,
    shouldCollapse: shouldCollapseActions,
    open: openRowActions,
  };
}());