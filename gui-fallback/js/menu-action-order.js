// menu-action-order.js — shared sorting for function-item dropdown menus
// Applies consistent ordering for repeated actions across Synthesis/Probes/Settings.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MenuActionOrder = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const RULES = [
    { key: 'refresh', rank: 10, patterns: [/\brefresh\b/, /\breload\b/, /refresh ui/] },
    { key: 'run-probe', rank: 20, patterns: [/\bscan\b/, /\bprobe\b/, /\bsweep\b/, /\brebuild\b/, /\brun\b/, /\bsteps\b/, /fleet update/] },
    { key: 'add-create-import', rank: 30, patterns: [/\badd\b/, /\bnew\b/, /\bcreate\b/, /\bimport\b/, /download extension/] },
    { key: 'edit-preview', rank: 40, patterns: [/\bedit\b/, /\bpreview\b/] },
    { key: 'save', rank: 50, patterns: [/\bsave\b/] },
    { key: 'meta', rank: 55, patterns: [/\bmeta\b/] },
    { key: 'columns', rank: 60, patterns: [/\bcolumns\b/] },
    { key: 'pagination', rank: 62, patterns: [/\bpagination\b/] },
    { key: 'explore-browse', rank: 63, patterns: [/\bexplore\b/, /\bbrowse\b/] },
    { key: 'grouping', rank: 64, patterns: [/\bgroup:\b/, /\bgroup\b/] },
    { key: 'page-switch', rank: 65, patterns: [/\bpage\s*\d+\b/, /\bsub\s*page\b/, /\bview\s*\d+\b/] },
    { key: 'horiz-scroll', rank: 66, patterns: [/horiz\s*scroll/, /scroll:\s*is\s*(on|off)/, /\bscroll\b/] },
    { key: 'visibility-filter', rank: 68, patterns: [/\bhide inactive\b/, /\bshow inactive\b/, /\binactive\b/, /\bhide obsolete\b/, /\bshow obsolete\b/, /\bobsolete\b/, /\bshow archived\b/, /\bshow active\b/, /\barchived\b/] },
    { key: 'expand-all', rank: 70, patterns: [/\bexpand all\b/] },
    { key: 'collapse-all', rank: 72, patterns: [/\bcollapse all\b/] },
    { key: 'layout-context', rank: 80, patterns: [/\bcontext\b/] },
    { key: 'explain', rank: 85, patterns: [/\bexplain\b/] },
    { key: 'dead-links', rank: 86, patterns: [/dead\s*links?/] },
    { key: 'delete', rank: 95, patterns: [/\bdelete\b/] },
  ];

  function _normalizeLabel(label) {
    return String(label || '')
      .replace(/:\s*is\s*(on|off)\b/ig, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function _matchRule(normalizedLabel, id) {
    const idNorm = String(id || '').toLowerCase();
    for (const rule of RULES) {
      for (const pattern of rule.patterns) {
        if (pattern.test(normalizedLabel) || pattern.test(idNorm)) {
          return rule;
        }
      }
    }
    return null;
  }

  function getSortMeta(item, getLabel) {
    const label = (typeof getLabel === 'function' ? getLabel(item) : (item && item.label) || '') || '';
    const id = (item && item.id) || '';
    const normalizedLabel = _normalizeLabel(label);
    const rule = _matchRule(normalizedLabel, id);
    return {
      id,
      label,
      normalizedLabel,
      matched: !!rule,
      ruleKey: rule ? rule.key : 'unmapped',
      rank: rule ? rule.rank : 900,
    };
  }

  function sortItems(items, getLabel) {
    return (items || []).slice().sort((a, b) => {
      const ma = getSortMeta(a, getLabel);
      const mb = getSortMeta(b, getLabel);
      if (ma.rank !== mb.rank) return ma.rank - mb.rank;
      if (ma.normalizedLabel !== mb.normalizedLabel) return ma.normalizedLabel.localeCompare(mb.normalizedLabel);
      const ao = Number.isFinite(a.order) ? a.order : 0;
      const bo = Number.isFinite(b.order) ? b.order : 0;
      if (ao !== bo) return ao - bo;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  }

  function findUnmapped(items, getLabel, menuName) {
    return (items || [])
      .map(item => ({
        menuName: menuName || '',
        activeOn: Array.isArray(item.activeOn) ? item.activeOn.slice() : [],
        item,
        meta: getSortMeta(item, getLabel),
      }))
      .filter(entry => !entry.meta.matched)
      .sort((a, b) => {
        if (a.meta.normalizedLabel !== b.meta.normalizedLabel) return a.meta.normalizedLabel.localeCompare(b.meta.normalizedLabel);
        return String(a.meta.id || '').localeCompare(String(b.meta.id || ''));
      });
  }

  return {
    RULES,
    getSortMeta,
    sortItems,
    findUnmapped,
  };
});
