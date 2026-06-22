// Shared Personal tag/filter picker and presentation settings.

'use strict';

const PersonalFilters = (() => {
  const SETTINGS_KEY = 'blueprints.personalFilters.settings.v1';
  const CUSTOM_KEY = 'blueprints.personalFilters.custom.v1';
  const SELECTION_PREFIX = 'blueprints.personalFilters.selection.';
  const PRETEXT_IMPORT_VERSION = '2026-06-22-filter-shapes';
  const CHIP_FONT = '700 13px Segoe UI, system-ui, sans-serif';
  const CHIP_LINE_HEIGHT = 16;
  const BADGE_FONT = '800 11px Segoe UI, system-ui, sans-serif';
  const BADGE_HEIGHT = 18;
  const BADGE_PAD_X = 10;
  const BADGE_LABEL_GAP = 2;
  const BUILTIN_IDS = new Set(['calendar', 'tasks', 'work', 'imports', 'sources', 'holiday', 'personal-holiday', 'national-holiday', 'all-day', 'blocked', 'review', 'uncategorized']);

  const COLORS = [
    ['red', '#ef4444'],
    ['yellow', '#eab308'],
    ['pink', '#ec4899'],
    ['green', '#22c55e'],
    ['purple', '#a855f7'],
    ['orange', '#f97316'],
    ['blue', '#5b9cf6'],
    ['brown', '#9a6b43'],
    ['white', '#f8fafc'],
    ['black', '#020617'],
    ['grey', '#94a3b8'],
    ['gold', '#d9aa32'],
  ];
  const SHAPES = ['circle', 'square', 'triangle', 'star', 'pentagon', 'rectangle', 'rhombus', 'semicircle', 'crescent'];
  const FILLS = ['filled', 'outline'];

  const DEFAULTS = {
    calendar: { label: 'Calendar', color: 'blue', shape: 'circle', fill: 'outline' },
    tasks: { label: 'Tasks', color: 'green', shape: 'square', fill: 'outline' },
    work: { label: 'Work', color: 'gold', shape: 'rectangle', fill: 'outline' },
    imports: { label: 'Imports', color: 'purple', shape: 'rhombus', fill: 'outline' },
    sources: { label: 'Source imports', color: 'grey', shape: 'pentagon', fill: 'outline' },
    holiday: { label: 'Holiday', color: 'orange', shape: 'star', fill: 'filled' },
    'personal-holiday': { label: 'Personal holiday', color: 'pink', shape: 'circle', fill: 'filled' },
    'national-holiday': { label: 'National holiday', color: 'red', shape: 'star', fill: 'outline' },
    'all-day': { label: 'All day', color: 'white', shape: 'semicircle', fill: 'outline' },
    blocked: { label: 'Blocked', color: 'red', shape: 'triangle', fill: 'outline' },
    review: { label: 'Review', color: 'yellow', shape: 'crescent', fill: 'outline' },
    uncategorized: { label: 'Uncategorized', color: 'grey', shape: 'square', fill: 'outline' },
  };

  const state = {
    settings: readJson(SETTINGS_KEY, {}),
    custom: readJson(CUSTOM_KEY, []),
    selected: new Map(),
    adapters: new Map(),
    pretext: null,
    pretextLoadPromise: null,
    pretextLoadFailed: false,
    textWidthCache: new Map(),
    settingsOrderByHost: new WeakMap(),
  };

  function escHtml(value) {
    if (typeof esc === 'function') return esc(value);
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
      // Browser-local preferences are optional.
    }
  }

  function normalizeId(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'uncategorized';
  }

  function titleCase(id) {
    return String(id || '')
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function colorValue(color) {
    const found = COLORS.find(([id]) => id === color);
    return found ? found[1] : '#5b9cf6';
  }

  function loadPretext() {
    if (state.pretext) return Promise.resolve(state.pretext);
    if (state.pretextLoadFailed) return Promise.resolve(null);
    if (!state.pretextLoadPromise) {
      state.pretextLoadPromise = import(`/fallback-ui/vendor/pretext/layout.js?v=${PRETEXT_IMPORT_VERSION}`)
        .then(mod => {
          if (!mod || typeof mod.prepare !== 'function' || typeof mod.measureNaturalWidth !== 'function') {
            throw new Error('Pretext layout module did not expose prepare/measureNaturalWidth.');
          }
          state.pretext = mod;
          state.textWidthCache.clear();
          renderAll();
          return mod;
        })
        .catch(err => {
          state.pretextLoadFailed = true;
          console.error('Failed to load Personal filter pretext module', err);
          return null;
        });
    }
    return state.pretextLoadPromise;
  }

  function canvasMeasureTextWidth(text, font = CHIP_FONT) {
    if (!state.canvasContext && typeof document !== 'undefined' && document.createElement) {
      const canvas = document.createElement('canvas');
      state.canvasContext = canvas.getContext('2d');
    }
    const ctx = state.canvasContext;
    if (!ctx) return String(text || '').length * 7.2;
    ctx.font = font;
    return ctx.measureText(String(text || '')).width;
  }

  function measureTextWidth(text, font = CHIP_FONT) {
    const value = String(text || '').trim();
    if (!value) return 0;
    const cacheKey = `${font}\u0000${value}`;
    if (state.textWidthCache.has(cacheKey)) return state.textWidthCache.get(cacheKey);
    let width = 0;
    if (state.pretext) {
      const prepared = state.pretext.prepare(value, font);
      width = state.pretext.measureNaturalWidth(prepared);
    } else {
      width = canvasMeasureTextWidth(value, font);
      loadPretext();
    }
    const clean = Math.max(1, Math.ceil(width));
    state.textWidthCache.set(cacheKey, clean);
    return clean;
  }

  function shapeSizeFromLayout(shape, textWidth, textHeight) {
    let width = Math.ceil(textWidth + 24);
    let height = Math.ceil(textHeight + 18);
    if (shape === 'circle') {
      width = height = Math.ceil(Math.max(textWidth + 22, textHeight + 18));
    } else if (shape === 'square') {
      width = height = Math.ceil(Math.max(textWidth + 14, textHeight + 14));
    } else if (shape === 'rectangle') {
      width = Math.ceil(textWidth + 28);
      height = Math.ceil(textHeight + 18);
    } else if (shape === 'semicircle') {
      width = Math.ceil(Math.max(textWidth + 22, (textHeight + 12) * 2));
      height = Math.ceil((width / 2) + 3);
    } else if (shape === 'crescent') {
      width = Math.ceil(textWidth + 34);
      height = Math.ceil(Math.max(38, textHeight + 22));
    } else if (shape === 'triangle') {
      const lowerTextMargin = 8;
      width = Math.ceil(Math.max(
        textWidth + 10 + ((textHeight + lowerTextMargin) / 0.866),
        (textHeight + lowerTextMargin) / 0.56,
        textHeight * 1.65,
      ));
      height = Math.ceil(width * 0.866);
    } else if (shape === 'star') {
      width = height = Math.ceil(Math.max((textWidth + 8) / 0.58, (textHeight + 10) / 0.43, textHeight * 2.3));
    } else if (shape === 'pentagon') {
      width = Math.ceil(Math.max((textWidth + 8) / 0.72, (textHeight + 8) / 0.55, textHeight * 2));
      height = Math.ceil(width * 0.98);
    } else if (shape === 'rhombus') {
      width = Math.ceil(Math.max((textWidth + 14) / 0.74, (textHeight + 8) / 0.42, textHeight * 2.2));
      height = Math.ceil(Math.max(textHeight + 16, width * 0.56));
    }
    return { width, height };
  }

  function candidateLineSets(words, maxLines) {
    const clean = words.map(word => String(word || '').trim()).filter(Boolean);
    if (clean.length <= 1 || maxLines <= 1) return [[clean.join(' ')]];
    const candidates = [[clean.join(' ')]];
    for (let i = 1; i < clean.length; i += 1) {
      candidates.push([clean.slice(0, i).join(' '), clean.slice(i).join(' ')]);
    }
    if (maxLines >= 3 && clean.length >= 3) {
      for (let i = 1; i < clean.length - 1; i += 1) {
        for (let j = i + 1; j < clean.length; j += 1) {
          candidates.push([
            clean.slice(0, i).join(' '),
            clean.slice(i, j).join(' '),
            clean.slice(j).join(' '),
          ]);
        }
      }
    }
    return candidates;
  }

  function maxLinesForShape(shape, words, naturalWidth) {
    if (words.length <= 1) return 1;
    if (shape === 'semicircle') return naturalWidth > 170 ? 2 : 1;
    if (shape === 'rectangle') return naturalWidth > 180 ? 2 : 1;
    if (shape === 'crescent') return naturalWidth > 160 ? 2 : 1;
    if (shape === 'triangle' || shape === 'rhombus') return 2;
    if (shape === 'circle' || shape === 'square' || shape === 'star' || shape === 'pentagon') return Math.min(3, words.length);
    return 2;
  }

  function labelLayout(setting) {
    const label = String(setting.label || '').trim() || 'Uncategorized';
    const shape = setting.shape || 'circle';
    const words = label.split(/\s+/).filter(Boolean);
    const naturalWidth = measureTextWidth(label);
    const maxLines = maxLinesForShape(shape, words, naturalWidth);
    let best = null;
    candidateLineSets(words, maxLines).forEach(lines => {
      const lineWidths = lines.map(line => measureTextWidth(line));
      const textWidth = Math.max(...lineWidths, 1);
      const textHeight = (lines.length * CHIP_LINE_HEIGHT) + Math.max(0, lines.length - 1) * 2;
      const size = shapeSizeFromLayout(shape, textWidth, textHeight);
      const score = (size.width * size.height) + (size.height * 2) + (lines.length * 7);
      if (!best || score < best.score || (score === best.score && lines.length > best.lines.length)) {
        best = { lines, textWidth, textHeight, size, score };
      }
    });
    return best || {
      lines: [label],
      textWidth: naturalWidth,
      textHeight: CHIP_LINE_HEIGHT,
      size: shapeSizeFromLayout(shape, naturalWidth, CHIP_LINE_HEIGHT),
      score: 0,
    };
  }

  function shapeMetrics(setting) {
    const layout = labelLayout(setting);
    const shape = setting.shape || 'circle';
    const { width, height } = layout.size;
    return {
      width: Math.max(1, width),
      height: Math.max(1, height),
      textWidth: layout.textWidth,
      textHeight: layout.textHeight,
      lines: layout.lines,
      lineCount: layout.lines.length,
      shape,
      sortHeight: Math.max(1, height),
    };
  }

  function rectsOverlap(a, b) {
    return Math.min(a.right, b.right) > Math.max(a.left, b.left)
      && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
  }

  function expandedRect(rect, gap) {
    return {
      left: rect.left - gap,
      top: rect.top - gap,
      right: rect.right + gap,
      bottom: rect.bottom + gap,
    };
  }

  function labelRectForMetrics(metrics) {
    const left = (metrics.width - metrics.textWidth) / 2;
    let top = (metrics.height - metrics.textHeight) / 2;
    if (metrics.shape === 'triangle') top = metrics.height - metrics.textHeight - 10;
    else if (metrics.shape === 'semicircle') top = metrics.height - metrics.textHeight - 8;
    return {
      left,
      top,
      right: left + metrics.textWidth,
      bottom: top + metrics.textHeight,
    };
  }

  function badgeMetrics(count) {
    if (!Number.isFinite(count)) return null;
    const label = String(count);
    const width = Math.max(20, Math.ceil(measureTextWidth(label, BADGE_FONT) + BADGE_PAD_X));
    return { label, width, height: BADGE_HEIGHT };
  }

  function baseBadgeAnchor(metrics, badge) {
    const w = metrics.width;
    const h = metrics.height;
    const bw = badge.width;
    const bh = badge.height;
    if (metrics.shape === 'triangle') return { left: (w * 0.68) - (bw / 2), top: (h * 0.48) - (bh / 2) };
    if (metrics.shape === 'star') return { left: w - (bw * 0.72), top: (h * 0.33) - (bh / 2) };
    if (metrics.shape === 'pentagon') return { left: w - (bw * 0.74), top: (h * 0.28) - (bh / 2) };
    if (metrics.shape === 'rhombus') return { left: w - (bw * 0.65), top: (h - bh) / 2 };
    if (metrics.shape === 'semicircle') return { left: w - (bw * 0.35), top: 2 };
    return { left: w - (bw * 0.42), top: Math.max(2, h * 0.13) };
  }

  function badgePosition(metrics, count) {
    const badge = badgeMetrics(count);
    if (!badge) return { left: 0, top: 0, width: 0, height: BADGE_HEIGHT };
    const label = expandedRect(labelRectForMetrics(metrics), BADGE_LABEL_GAP);
    const base = baseBadgeAnchor(metrics, badge);
    const candidates = [
      base,
      { left: label.right + BADGE_LABEL_GAP, top: base.top },
      { left: metrics.width - (badge.width * 0.36), top: base.top },
      { left: label.left - BADGE_LABEL_GAP - badge.width, top: base.top },
      { left: base.left, top: Math.max(1, label.top - BADGE_LABEL_GAP - badge.height) },
      { left: base.left, top: label.bottom + BADGE_LABEL_GAP },
    ];
    let best = null;
    candidates.forEach(candidate => {
      const rect = {
        left: candidate.left,
        top: candidate.top,
        right: candidate.left + badge.width,
        bottom: candidate.top + badge.height,
      };
      const overlap = rectsOverlap(rect, label)
        ? (Math.min(rect.right, label.right) - Math.max(rect.left, label.left))
          * (Math.min(rect.bottom, label.bottom) - Math.max(rect.top, label.top))
        : 0;
      const outside = Math.max(0, -rect.left) + Math.max(0, rect.right - metrics.width)
        + Math.max(0, -rect.top) + Math.max(0, rect.bottom - metrics.height);
      const drift = Math.abs(candidate.left - base.left) + Math.abs(candidate.top - base.top);
      const score = (overlap * 1000) + (outside * 2) + drift;
      if (!best || score < best.score) best = { ...candidate, ...badge, score };
    });
    return {
      left: Math.round(best.left),
      top: Math.round(best.top),
      width: Math.round(best.width),
      height: Math.round(best.height),
    };
  }

  function badgeMargins(metrics, badge) {
    if (!badge || !badge.width) return { left: 0, right: 0, top: 0, bottom: 0 };
    const politeGap = 4;
    const left = Math.max(0, -badge.left);
    const right = Math.max(0, badge.left + badge.width - metrics.width);
    const top = Math.max(0, -badge.top);
    const bottom = Math.max(0, badge.top + badge.height - metrics.height);
    return {
      left: left ? Math.ceil(left + politeGap) : 0,
      right: right ? Math.ceil(right + politeGap) : 0,
      top: top ? Math.ceil(top + politeGap) : 0,
      bottom: bottom ? Math.ceil(bottom + politeGap) : 0,
    };
  }

  function chipStyle(setting, metrics = shapeMetrics(setting), options = {}) {
    const badge = badgePosition(metrics, options.count);
    const margins = badgeMargins(metrics, badge);
    return [
      `--pf-color:${escHtml(colorValue(setting.color))}`,
      `--pf-chip-width:${metrics.width}px`,
      `--pf-chip-height:${metrics.height}px`,
      `--pf-chip-text-width:${Math.ceil(metrics.textWidth)}px`,
      `--pf-chip-text-height:${Math.ceil(metrics.textHeight)}px`,
      `--pf-chip-lines:${metrics.lineCount}`,
      `--pf-count-badge-left:${badge.left}px`,
      `--pf-count-badge-top:${badge.top}px`,
      `--pf-count-badge-width:${badge.width}px`,
      `--pf-count-badge-height:${badge.height}px`,
      `--pf-chip-margin-left:${margins.left}px`,
      `--pf-chip-margin-right:${margins.right}px`,
      `--pf-chip-margin-top:${margins.top}px`,
      `--pf-chip-margin-bottom:${margins.bottom}px`,
    ].join(';');
  }

  function chipLabelHtml(metrics) {
    return `<span class="personal-filter-chip__label" data-lines="${escHtml(metrics.lineCount)}">
      ${metrics.lines.map(line => `<span class="personal-filter-chip__label-line">${escHtml(line)}</span>`).join('')}
    </span>`;
  }

  function countBadgeHtml(count) {
    return Number.isFinite(count) ? `<span class="personal-filter-count-badge">${count}</span>` : '';
  }

  function cleanSetting(id, setting = {}) {
    const fallback = DEFAULTS[id] || {};
    const color = COLORS.some(([value]) => value === setting.color) ? setting.color : (fallback.color || 'blue');
    const shape = SHAPES.includes(setting.shape) ? setting.shape : (fallback.shape || 'circle');
    const fill = FILLS.includes(setting.fill) ? setting.fill : (fallback.fill || 'outline');
    return {
      label: String(setting.label || fallback.label || titleCase(id)),
      color,
      shape,
      fill,
      custom: Boolean(setting.custom || fallback.custom),
    };
  }

  function settingFor(id) {
    return cleanSetting(id, state.settings[id] || DEFAULTS[id] || {});
  }

  function saveSettings() {
    writeJson(SETTINGS_KEY, state.settings);
    writeJson(CUSTOM_KEY, state.custom);
  }

  function readSelected(surface) {
    const key = `${SELECTION_PREFIX}${surface}`;
    const stored = readJson(key, []);
    return Array.isArray(stored) ? stored.map(normalizeId).filter(id => id && id !== 'all') : [];
  }

  function writeSelected(surface, ids) {
    const clean = unique(ids.map(normalizeId).filter(id => id && id !== 'all'));
    state.selected.set(surface, clean);
    writeJson(`${SELECTION_PREFIX}${surface}`, clean);
    return clean;
  }

  function unique(values) {
    return Array.from(new Set(values));
  }

  function sourceType(record) {
    return record?.source?.type || record?.source_type || '';
  }

  function recordTags(record) {
    const tags = Array.isArray(record?.tags)
      ? record.tags.map(tag => normalizeId(tag)).filter(Boolean)
      : [];
    return tags.length ? tags : ['uncategorized'];
  }

  function isCalendarRecord(record) {
    const tags = recordTags(record);
    return sourceType(record) === 'manual-calendar' || tags.includes('calendar');
  }

  function isTaskRecord(record) {
    const kind = String(record?.kind || '').toLowerCase();
    const relatedTasks = record?.related?.tasks || [];
    const tags = recordTags(record);
    return ['todo', 'task', 'reminder'].includes(kind) || relatedTasks.length > 0 || tags.includes('task') || tags.includes('tasks') || tags.includes('calendar-task');
  }

  function isWorkRecord(record) {
    const relatedWork = record?.related?.work_items || [];
    const tags = recordTags(record);
    return sourceType(record) === 'work-management' || relatedWork.length > 0 || tags.includes('work');
  }

  function isImportRecord(record) {
    const relatedImports = record?.related?.import_batches || [];
    const type = sourceType(record);
    const tags = recordTags(record);
    return ['interests-ingestion', 'git'].includes(type) || relatedImports.length > 0 || tags.includes('imports') || tags.includes('import');
  }

  function isReviewRecord(record) {
    const status = String(record?.status || '').toLowerCase();
    const provenanceState = String(record?.provenance_state || record?.provenance?.state || '').toLowerCase();
    return status === 'pending_review' || provenanceState === 'needs_review';
  }

  function isBlockedRecord(record) {
    return String(record?.status || '').toLowerCase() === 'blocked';
  }

  function isAllDayRecord(record) {
    const meta = record?.provenance?.calendar || {};
    const tags = recordTags(record);
    return meta.all_day === true || tags.includes('all-day') || (!meta.local_start_time && !record?.start_at);
  }

  function recordTokens(record) {
    const tags = recordTags(record);
    const tokens = new Set(tags);
    if (isCalendarRecord(record)) tokens.add('calendar');
    if (isTaskRecord(record)) {
      tokens.add('tasks');
      tokens.add('task');
    }
    if (isWorkRecord(record)) tokens.add('work');
    if (isImportRecord(record)) {
      tokens.add('imports');
      tokens.add('import');
    }
    if (!isCalendarRecord(record)) tokens.add('sources');
    if (isBlockedRecord(record)) tokens.add('blocked');
    if (isReviewRecord(record)) tokens.add('review');
    if (isAllDayRecord(record)) tokens.add('all-day');
    if (tags.includes('holiday') || tags.includes('personal-holiday') || tags.includes('national-holiday')) tokens.add('holiday');
    return tokens;
  }

  function recordsFor(surface) {
    const adapter = state.adapters.get(surface);
    if (!adapter || typeof adapter.getRecords !== 'function') return [];
    const records = adapter.getRecords();
    return Array.isArray(records) ? records : [];
  }

  function allFilterIds(surface) {
    const ids = new Set(Object.keys(DEFAULTS));
    state.custom.forEach(id => ids.add(normalizeId(id)));
    recordsFor(surface).forEach(record => {
      recordTokens(record).forEach(token => ids.add(normalizeId(token)));
    });
    return Array.from(ids).filter(Boolean).sort((a, b) => settingFor(a).label.localeCompare(settingFor(b).label));
  }

  function sortedFilterIds(surface) {
    return allFilterIds(surface).sort((a, b) => {
      const aMetrics = shapeMetrics(settingFor(a));
      const bMetrics = shapeMetrics(settingFor(b));
      return (aMetrics.sortHeight - bMetrics.sortHeight)
        || (aMetrics.width - bMetrics.width)
        || settingFor(a).label.localeCompare(settingFor(b).label);
    });
  }

  function resetSettingsOrderForHost(host) {
    if (host) state.settingsOrderByHost.delete(host);
  }

  function resetSettingsOrder(surface = '') {
    document.querySelectorAll('[data-personal-filter-host]').forEach(host => {
      if (!surface || (host.dataset.personalFilterSurface || 'calendar') === surface) {
        resetSettingsOrderForHost(host);
      }
    });
  }

  function settingsFilterIds(surface, host) {
    if (!host) return sortedFilterIds(surface);
    const fresh = sortedFilterIds(surface);
    const existing = state.settingsOrderByHost.get(host);
    if (!existing || existing.surface !== surface) {
      state.settingsOrderByHost.set(host, { surface, ids: fresh });
      return fresh;
    }
    const freshSet = new Set(fresh);
    const kept = existing.ids.filter(id => freshSet.has(id));
    const keptSet = new Set(kept);
    const added = fresh.filter(id => !keptSet.has(id));
    const ids = kept.concat(added);
    state.settingsOrderByHost.set(host, { surface, ids });
    return ids;
  }

  function countFor(surface, id) {
    const token = normalizeId(id);
    return recordsFor(surface).filter(record => recordTokens(record).has(token)).length;
  }

  function getSelectedIds(surface) {
    if (!state.selected.has(surface)) state.selected.set(surface, readSelected(surface));
    return state.selected.get(surface) || [];
  }

  function setSelectedIds(surface, ids) {
    const clean = writeSelected(surface, ids);
    emitChange(surface, 'selection');
    renderAll();
    return clean;
  }

  function matchesRecord(record, surface = 'calendar') {
    const selected = getSelectedIds(surface);
    if (!selected.length) return true;
    const tokens = recordTokens(record);
    return selected.some(id => tokens.has(normalizeId(id)));
  }

  function selectedLabel(surface) {
    const selected = getSelectedIds(surface);
    if (!selected.length) return 'all sources';
    return selected.map(id => settingFor(id).label).join(' + ');
  }

  function chipHtml(id, options = {}) {
    const setting = settingFor(id);
    const hasCount = Number.isFinite(options.count);
    const metrics = shapeMetrics(setting);
    const selected = options.selected ? ' is-selected' : '';
    return `<span class="personal-filter-chip${hasCount ? ' has-count' : ''}${selected}" data-shape="${escHtml(setting.shape)}" data-fill="${escHtml(setting.fill)}" style="${chipStyle(setting, metrics, { count: options.count })}">
      ${chipLabelHtml(metrics)}
      ${countBadgeHtml(options.count)}
    </span>`;
  }

  function summaryHtml(surface, options = {}) {
    const selected = getSelectedIds(surface);
    const prefix = options.prefix || 'Filter:';
    if (!selected.length) {
      return `<span class="personal-filter-summary"><span class="personal-filter-summary__label">${escHtml(prefix)}</span><span class="personal-filter-summary__empty">all sources</span></span>`;
    }
    return `<span class="personal-filter-summary">
      <span class="personal-filter-summary__label">${escHtml(prefix)}</span>
      ${selected.map(id => chipHtml(id, { selected: true })).join('')}
    </span>`;
  }

  function filtersBodyHtml(surface) {
    const selected = new Set(getSelectedIds(surface));
    const ids = sortedFilterIds(surface);
    const allSourcesSetting = { label: 'All sources', color: 'blue', shape: 'circle', fill: 'outline' };
    const allSourcesMetrics = shapeMetrics(allSourcesSetting);
    return `<div class="personal-filter-picker">
      <div class="personal-filter-summary">${summaryHtml(surface, { prefix: 'Active' })}</div>
      <div class="personal-filter-grid" role="listbox" aria-multiselectable="true">
        <button class="personal-filter-chip${selected.size ? '' : ' is-selected'}" type="button" data-personal-filter-clear="${escHtml(surface)}" data-shape="circle" data-fill="outline" style="${chipStyle(allSourcesSetting, allSourcesMetrics)}">
          ${chipLabelHtml(allSourcesMetrics)}
        </button>
        ${ids.map(id => {
          const setting = settingFor(id);
          const count = countFor(surface, id);
          const metrics = shapeMetrics(setting);
          const isSelected = selected.has(id);
          return `<button class="personal-filter-chip has-count${isSelected ? ' is-selected' : ''}" type="button" role="option" aria-selected="${isSelected ? 'true' : 'false'}" data-personal-filter-toggle="${escHtml(id)}" data-personal-filter-surface="${escHtml(surface)}" data-shape="${escHtml(setting.shape)}" data-fill="${escHtml(setting.fill)}" style="${chipStyle(setting, metrics, { count })}">
            ${chipLabelHtml(metrics)}
            ${countBadgeHtml(count)}
          </button>`;
        }).join('')}
      </div>
    </div>`;
  }

  function colorOptions(selected) {
    return COLORS.map(([id]) => `<option value="${escHtml(id)}"${id === selected ? ' selected' : ''}>${escHtml(titleCase(id))}</option>`).join('');
  }

  function shapeOptions(selected) {
    return SHAPES.map(id => `<option value="${escHtml(id)}"${id === selected ? ' selected' : ''}>${escHtml(titleCase(id))}</option>`).join('');
  }

  function fillOptions(selected) {
    return FILLS.map(id => `<option value="${escHtml(id)}"${id === selected ? ' selected' : ''}>${escHtml(id === 'filled' ? 'Filled' : 'Outline')}</option>`).join('');
  }

  function settingsBodyHtml(surface, host) {
    const ids = settingsFilterIds(surface, host);
    return `<div class="personal-filter-settings">
      <div class="personal-filter-settings__new">
        <label class="personal-filter-field">
          <span>Tag</span>
          <input type="text" data-personal-filter-new-name="${escHtml(surface)}" maxlength="48" autocomplete="off" aria-label="Tag" />
        </label>
        <button class="personal-filter-command" type="button" data-personal-filter-add="${escHtml(surface)}">Add Tag</button>
      </div>
      <div class="personal-filter-settings__rows">
        ${ids.map(id => {
          const setting = settingFor(id);
          const count = countFor(surface, id);
          const isCore = BUILTIN_IDS.has(id);
          return `<article class="personal-filter-settings-row" data-personal-filter-setting-row="${escHtml(id)}" data-personal-filter-surface="${escHtml(surface)}">
            <div class="personal-filter-settings__preview">${chipHtml(id, { selected: getSelectedIds(surface).includes(id) })}</div>
            <label class="personal-filter-field">
              <span>Name</span>
              <input type="text" data-personal-filter-setting="label" value="${escHtml(setting.label)}" maxlength="48" aria-label="Name" ${isCore ? 'readonly' : ''} />
            </label>
            <div class="personal-filter-settings__controls">
              <label class="personal-filter-field">
                <span>Colour</span>
                <select data-personal-filter-setting="color" aria-label="Colour">${colorOptions(setting.color)}</select>
              </label>
              <label class="personal-filter-field">
                <span>Shape</span>
                <select data-personal-filter-setting="shape" aria-label="Shape">${shapeOptions(setting.shape)}</select>
              </label>
              <label class="personal-filter-field">
                <span>Fill</span>
                <select data-personal-filter-setting="fill" aria-label="Fill">${fillOptions(setting.fill)}</select>
              </label>
            </div>
            <div class="personal-filter-settings__actions">
              <button class="personal-filter-command" type="button" data-personal-filter-remove="${escHtml(id)}" ${id === 'uncategorized' || isCore ? 'disabled' : ''}>Remove (${count})</button>
            </div>
          </article>`;
        }).join('')}
      </div>
    </div>`;
  }

  function renderHost(host) {
    if (!host) return;
    const surface = host.dataset.personalFilterSurface || 'calendar';
    const layout = host.dataset.personalFilterLayout || 'tabs';
    let active = host.dataset.personalFilterTab || 'filters';
    if (layout === 'filters') active = 'filters';
    if (layout === 'settings') active = 'settings';
    if (active !== 'settings') resetSettingsOrderForHost(host);
    const framed = host.dataset.personalFilterFramed === 'false' ? '' : ' personal-filter-panel--framed';
    const tabs = layout === 'tabs'
      ? `<div class="personal-filter-panel__tabs" role="tablist">
          <button class="personal-filter-tab" type="button" role="tab" aria-selected="${active === 'filters' ? 'true' : 'false'}" data-personal-filter-tab="filters">Filters</button>
          <button class="personal-filter-tab" type="button" role="tab" aria-selected="${active === 'settings' ? 'true' : 'false'}" data-personal-filter-tab="settings">Filter Settings</button>
        </div>`
      : '';
    host.innerHTML = `<div class="personal-filter-panel${framed}" data-personal-filter-panel="${escHtml(surface)}">
      ${tabs}
      <div class="personal-filter-panel__body">${active === 'settings' ? settingsBodyHtml(surface, host) : filtersBodyHtml(surface)}</div>
    </div>`;
    wireHost(host);
    bindHostControls(host);
  }

  function renderAll() {
    document.querySelectorAll('[data-personal-filter-host]').forEach(renderHost);
    document.querySelectorAll('[data-personal-filter-summary-for]').forEach(node => {
      const surface = node.dataset.personalFilterSummaryFor || 'calendar';
      node.innerHTML = summaryHtml(surface);
    });
  }

  function emitChange(surface, reason) {
    const adapter = state.adapters.get(surface);
    if (adapter && typeof adapter.onChange === 'function') adapter.onChange({ reason });
    window.dispatchEvent(new CustomEvent('personal-filters:change', {
      detail: { surface, reason, selectedIds: getSelectedIds(surface) },
    }));
  }

  function registerSurface(surface, adapter = {}) {
    state.adapters.set(surface, adapter);
    if (!state.selected.has(surface)) state.selected.set(surface, readSelected(surface));
    renderAll();
  }

  function toggleFilter(surface, id) {
    const clean = normalizeId(id);
    const selected = new Set(getSelectedIds(surface));
    if (selected.has(clean)) selected.delete(clean);
    else selected.add(clean);
    setSelectedIds(surface, Array.from(selected));
  }

  function updateSetting(row, key, value) {
    const id = row?.dataset?.personalFilterSettingRow;
    if (!id) return;
    const current = cleanSetting(id, state.settings[id] || DEFAULTS[id] || {});
    if (key === 'label') current.label = String(value || '').trim() || titleCase(id);
    if (key === 'color') current.color = COLORS.some(([color]) => color === value) ? value : current.color;
    if (key === 'shape') current.shape = SHAPES.includes(value) ? value : current.shape;
    if (key === 'fill') current.fill = FILLS.includes(value) ? value : current.fill;
    current.custom = state.custom.includes(id) || current.custom;
    state.settings[id] = current;
    saveSettings();
    emitChange(row.dataset.personalFilterSurface || 'calendar', 'settings');
    renderAll();
  }

  function addTag(surface, input) {
    const label = String(input?.value || '').trim();
    if (!label) return;
    const id = normalizeId(label);
    if (!state.custom.includes(id) && !BUILTIN_IDS.has(id)) state.custom.push(id);
    state.settings[id] = cleanSetting(id, {
      label,
      color: 'gold',
      shape: 'circle',
      fill: 'outline',
      custom: true,
    });
    if (input) input.value = '';
    saveSettings();
    emitChange(surface, 'settings');
    renderAll();
  }

  async function removeTag(surface, id) {
    const clean = normalizeId(id);
    if (clean === 'uncategorized' || BUILTIN_IDS.has(clean)) return false;
    const count = countFor(surface, clean);
    if (count > 0 && typeof HubDialogs !== 'undefined' && typeof HubDialogs.confirm === 'function') {
      const ok = await HubDialogs.confirm({
        tone: 'warning',
        badge: 'WARN',
        title: 'Remove Tag Setting',
        message: `${settingFor(clean).label} is used by ${count} visible record${count === 1 ? '' : 's'}. Remove the presentation setting?`,
        confirmText: 'Remove Setting',
        cancelText: 'Cancel',
      });
      if (!ok) return false;
    }
    delete state.settings[clean];
    state.custom = state.custom.filter(item => item !== clean);
    for (const key of state.selected.keys()) {
      writeSelected(key, getSelectedIds(key).filter(item => item !== clean));
    }
    saveSettings();
    emitChange(surface, 'settings');
    renderAll();
    return true;
  }

  function openModal(surface = 'calendar', tab = 'filters') {
    const modal = document.getElementById('personal-filter-modal');
    const root = document.getElementById('personal-filter-modal-root');
    const title = document.getElementById('personal-filter-modal-title-text');
    if (!modal || !root) return false;
    root.dataset.personalFilterSurface = surface;
    root.dataset.personalFilterLayout = 'tabs';
    root.dataset.personalFilterTab = tab === 'settings' ? 'settings' : 'filters';
    resetSettingsOrderForHost(root);
    if (title) title.textContent = tab === 'settings' ? 'Filter Settings' : 'Filters';
    renderHost(root);
    if (typeof HubModal !== 'undefined') HubModal.open(modal);
    else if (typeof modal.showModal === 'function' && !modal.open) modal.showModal();
    return true;
  }

  function pageSurfaceFromState(page) {
    const tab = String(page?.tab || '');
    if (tab === 'calender' || tab === 'calendar') return 'calendar';
    if (['diary', 'todo', 'kanban'].includes(tab)) return tab;
    return '';
  }

  function syncUltrawideSidecar(page) {
    if (!window.UltrawideSidecar || typeof window.UltrawideSidecar.isVisible !== 'function') return false;
    if (!window.UltrawideSidecar.isVisible()) return false;
    const current = page || (window.BlueprintsPageState?.current ? window.BlueprintsPageState.current() : null);
    const surface = pageSurfaceFromState(current);
    if (!surface) return false;
    const title = `${surface === 'todo' ? 'ToDo' : titleCase(surface)} Filters`;
    window.UltrawideSidecar.setTitle(title);
    window.UltrawideSidecar.setHTML(`<div class="personal-filter-sidecar-host" data-personal-filter-host data-personal-filter-surface="${escHtml(surface)}" data-personal-filter-layout="tabs" data-personal-filter-framed="false"></div>`);
    renderHost(document.querySelector('#ultrawide-sidecar-body [data-personal-filter-host]'));
    return true;
  }

  function isInside(host, node) {
    return Boolean(node && host && host.contains(node));
  }

  function bindHostControls(host) {
    host.querySelectorAll('[data-personal-filter-tab]').forEach(tab => {
      tab.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const nextTab = tab.dataset.personalFilterTab === 'settings' ? 'settings' : 'filters';
        if (host.dataset.personalFilterTab !== nextTab) resetSettingsOrderForHost(host);
        host.dataset.personalFilterTab = nextTab;
        renderHost(host);
      }, true);
    });
    host.querySelectorAll('[data-personal-filter-clear]').forEach(clear => {
      clear.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        setSelectedIds(clear.dataset.personalFilterClear || host.dataset.personalFilterSurface || 'calendar', []);
      }, true);
    });
    host.querySelectorAll('[data-personal-filter-toggle]').forEach(toggle => {
      toggle.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        toggleFilter(toggle.dataset.personalFilterSurface || host.dataset.personalFilterSurface || 'calendar', toggle.dataset.personalFilterToggle);
      }, true);
    });
    host.querySelectorAll('[data-personal-filter-add]').forEach(add => {
      add.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const surface = add.dataset.personalFilterAdd || host.dataset.personalFilterSurface || 'calendar';
        const input = host.querySelector(`[data-personal-filter-new-name="${cssEscape(surface)}"]`);
        addTag(surface, input);
      }, true);
    });
    host.querySelectorAll('[data-personal-filter-remove]').forEach(remove => {
      remove.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const row = remove.closest('[data-personal-filter-setting-row]');
        removeTag(row?.dataset?.personalFilterSurface || host.dataset.personalFilterSurface || 'calendar', remove.dataset.personalFilterRemove);
      }, true);
    });
  }

  function handleHostChange(event) {
    const host = event.currentTarget;
    const field = event.target.closest('[data-personal-filter-setting]');
    if (!isInside(host, field)) return;
    updateSetting(field.closest('[data-personal-filter-setting-row]'), field.dataset.personalFilterSetting, field.value);
  }

  function wireHost(host) {
    if (!host || host.dataset.personalFilterWired === '1') return;
    host.dataset.personalFilterWired = '1';
    host.addEventListener('change', handleHostChange);
  }

  function bind() {
    if (document.documentElement.dataset.personalFiltersBound === '1') return;
    document.documentElement.dataset.personalFiltersBound = '1';
    document.addEventListener('click', event => {
      const trigger = event.target.closest('[data-personal-filter-open]');
      if (trigger) {
        event.preventDefault();
        openModal(trigger.dataset.personalFilterOpen || 'calendar', trigger.dataset.personalFilterTab || 'filters');
        return;
      }
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const trigger = event.target.closest('[data-personal-filter-open]');
      if (!trigger) return;
      event.preventDefault();
      openModal(trigger.dataset.personalFilterOpen || 'calendar', trigger.dataset.personalFilterTab || 'filters');
    });
    document.addEventListener('blueprints:page-state-changed', event => {
      syncUltrawideSidecar(event.detail?.page);
    });
    window.addEventListener('resize', () => syncUltrawideSidecar(), { passive: true });
    window.setTimeout(() => syncUltrawideSidecar(), 250);
    window.setTimeout(() => syncUltrawideSidecar(), 900);
    loadPretext();
    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }

  return {
    registerSurface,
    getSelectedIds,
    setSelectedIds,
    matchesRecord,
    summaryHtml,
    selectedLabel,
    openModal,
    renderAll,
    resetSettingsOrder,
    recordTokens,
    syncUltrawideSidecar,
    colors: () => COLORS.slice(),
    shapes: () => SHAPES.slice(),
  };
})();

window.PersonalFilters = PersonalFilters;
