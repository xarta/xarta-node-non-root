import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bodyShadeJs = fs.readFileSync(path.resolve(here, '../js/body-shade.js'), 'utf8');
const bodyShadeCss = fs.readFileSync(path.resolve(here, '../css/body-shade.css'), 'utf8');
const hubMenuJs = fs.readFileSync(path.resolve(here, '../js/hub-menu.js'), 'utf8');
const menuActionOrderJs = fs.readFileSync(path.resolve(here, '../js/menu-action-order.js'), 'utf8');
const indexHtml = fs.readFileSync(path.resolve(here, '../index.html'), 'utf8');
const daveCalendarCss = fs.readFileSync(path.resolve(here, '../css/dave-calendar.css'), 'utf8');
const daveDiaryCss = fs.readFileSync(path.resolve(here, '../css/dave-diary.css'), 'utf8');
const daveTodoCss = fs.readFileSync(path.resolve(here, '../css/dave-todo.css'), 'utf8');
const daveImportsCss = fs.readFileSync(path.resolve(here, '../css/dave-imports.css'), 'utf8');
const personalFiltersCss = fs.readFileSync(path.resolve(here, '../css/personal-filters.css'), 'utf8');
const kanbanBoardCss = fs.readFileSync(path.resolve(here, '../css/kanban-board.css'), 'utf8');
const daveCalendarJs = fs.readFileSync(path.resolve(here, '../js/dave/calendar-page.js'), 'utf8');
const personalFiltersJs = fs.readFileSync(path.resolve(here, '../js/dave/personal-filters.js'), 'utf8');
const daveMenuJs = fs.readFileSync(path.resolve(here, '../js/dave/dave-menu.js'), 'utf8');
const kanbanMenuJs = fs.readFileSync(path.resolve(here, '../js/kanban/kanban-menu.js'), 'utf8');
const activeBrowserObserver = fs.readFileSync(
  path.resolve(here, '../js/active-browser-observer.js'),
  'utf8',
);

function tabSlice(tabId) {
  const tabStart = indexHtml.indexOf(`<section id="${tabId}"`);
  assert.notEqual(tabStart, -1, `${tabId} must exist in index.html.`);
  const nextSection = indexHtml.indexOf('\n  <section id="', tabStart + 1);
  const nextDialog = indexHtml.indexOf('\n  <dialog', tabStart + 1);
  const candidates = [nextSection, nextDialog].filter((value) => value !== -1);
  const tabEnd = candidates.length ? Math.min(...candidates) : indexHtml.length;
  return indexHtml.slice(tabStart, tabEnd);
}

function functionSlice(source, fnName) {
  const fnStart = source.indexOf(`function ${fnName}`);
  assert.notEqual(fnStart, -1, `${fnName} must exist.`);
  const nextFn = source.indexOf('\n  function ', fnStart + 1);
  return source.slice(fnStart, nextFn === -1 ? source.length : nextFn);
}

assert.match(
  bodyShadeJs,
  /function\s+setScrollStateClass\s*\([^)]*\)[\s\S]*document\.documentElement\.classList\.toggle/,
  'Body Shade must mirror scroll-lock state classes onto <html>.',
);
assert.match(
  bodyShadeJs,
  /setScrollStateClass\('has-managed-scroll-tab',\s*shouldLockBody\)/,
  'Managed-scroll tabs must lock root scroll through the shared state helper.',
);
{
  const sizeManagedScrollShell = functionSlice(bodyShadeJs, 'sizeManagedScrollShell');
  assert.match(
    sizeManagedScrollShell,
    /var\s+panelTop\s*=\s*panel\.getBoundingClientRect\(\)\.top/,
    'Managed-scroll shell sizing must use the real transformed panel top.',
  );
  assert.doesNotMatch(
    sizeManagedScrollShell,
    /panelTop\s*=\s*Math\.max\(0,\s*panel\.getBoundingClientRect\(\)\.top\)/,
    'Managed-scroll shell sizing must not clamp panel top to zero while shade is up.',
  );
  assert.match(
    sizeManagedScrollShell,
    /panel\.style\.height\s*=\s*panelHeight\s*\+\s*'px'/,
    'Managed-scroll active panels must get an exact measured height.',
  );
  assert.match(
    sizeManagedScrollShell,
    /panel\.style\.overflowY\s*=\s*'hidden'/,
    'Managed-scroll active panels must not become a second vertical scroll owner.',
  );
  assert.match(
    sizeManagedScrollShell,
    /shell\.style\.overflowX\s*=\s*'hidden'/,
    'Managed-scroll shells must suppress horizontal overflow explicitly.',
  );
  assert.match(
    sizeManagedScrollShell,
    /shell\.style\.overflowY\s*=\s*'auto'/,
    'Managed-scroll shells must remain the sole vertical scroll owner.',
  );
  assert.doesNotMatch(
    sizeManagedScrollShell,
    /shell\.style\.overflow\s*=\s*'auto'/,
    'Managed-scroll shell sizing must not use overflow:auto shorthand.',
  );
  const snapDown = functionSlice(bodyShadeJs, 'snapDown');
  assert.match(
    snapDown,
    /requestAnimationFrame\([^)]*function\s*\(\)\s*\{[\s\S]*sizeActivePane\(\)/,
    'Instant snap-down must remeasure active panes after dropping raised managed-scroll height.',
  );
  assert.match(
    snapDown,
    /setTimeout\(sizeActivePane,\s*TRANSITION\s*\+\s*50\)/,
    'Animated snap-down must remeasure active panes after the shade transition settles.',
  );
}
for (const tabId of ['tab-diary', 'tab-calender', 'tab-todo', 'tab-imports', 'tab-kanban']) {
  assert.ok(
    bodyShadeJs.includes(`'${tabId}'`),
    `${tabId} must stay in the managed-scroll resync page set.`,
  );
}
for (const [tabId, surface] of [
  ['tab-diary', 'diary'],
  ['tab-calender', 'calendar'],
  ['tab-todo', 'todo'],
  ['tab-imports', 'imports'],
  ['tab-kanban', 'kanban'],
]) {
  const tabHtml = tabSlice(tabId);
  const handleStart = tabHtml.indexOf('class="body-shade-handle"');
  const shellStart = tabHtml.indexOf('<div class="tab-scroll-shell">');
  const searchStart = tabHtml.indexOf(`data-personal-search-surface="${surface}"`);
  assert.ok(
    handleStart !== -1 && shellStart > handleStart,
    `${surface} Body Shade handle must sit before the managed scroll shell.`,
  );
  assert.ok(
    shellStart !== -1 && searchStart > shellStart,
    `${surface} search strip must stay inside the managed scroll shell.`,
  );
}
for (const { tabId, surface, liftId, tabKey, titleClass, css } of [
  {
    tabId: 'tab-diary',
    surface: 'diary',
    liftId: 's25-lift-diary',
    tabKey: 'diary',
    titleClass: 'diary-page__title-block',
    css: daveDiaryCss,
  },
  {
    tabId: 'tab-calender',
    surface: 'calendar',
    liftId: 's25-lift-calender',
    tabKey: 'calender',
    titleClass: 'calendar-page__title-block',
    css: daveCalendarCss,
  },
  {
    tabId: 'tab-todo',
    surface: 'todo',
    liftId: 's25-lift-todo',
    tabKey: 'todo',
    titleClass: 'todo-page__title-block',
    css: daveTodoCss,
  },
  {
    tabId: 'tab-imports',
    surface: 'imports',
    liftId: 's25-lift-imports',
    tabKey: 'imports',
    titleClass: 'imports-dashboard__title-block',
    css: daveImportsCss,
  },
  {
    tabId: 'tab-kanban',
    surface: 'kanban',
    liftId: 's25-lift-kanban',
    tabKey: 'kanban',
    titleClass: 'kanban-page__title-block',
    css: kanbanBoardCss,
  },
]) {
  const tabHtml = tabSlice(tabId);
  const liftNeedle = `id="${liftId}" class="s25-lift-block ${titleClass}" data-for-tab="${tabKey}"`;
  const liftStart = tabHtml.indexOf(liftNeedle);
  const handleStart = tabHtml.indexOf('class="body-shade-handle"');
  assert.notEqual(liftStart, -1, `${surface} must wrap title/meta in the S25 lift block.`);
  assert.ok(
    handleStart > liftStart,
    `${surface} S25 lift block must stay before the Body Shade handle.`,
  );
  assert.match(
    css,
    new RegExp(`#page-controls-slot-s25\\s+#${liftId}\\b`),
    `${surface} CSS must style the lifted S25 title block.`,
  );
  assert.match(
    css,
    new RegExp(`#page-controls-slot-s25\\s+#${liftId}\\s+h2\\b`),
    `${surface} CSS must size the lifted S25 title heading.`,
  );
}
assert.doesNotMatch(
  daveCalendarCss,
  /(?:#s25-lift-calender|\.calendar-page__title-block)[^{]*\{[^}]*letter-spacing\s*:\s*(?:0|normal|initial|unset)\b/i,
  'Calendar lifted S25 title must keep the intentional inherited letter-spacing treatment.',
);
for (const { surface, css, titleClass } of [
  { surface: 'diary', css: daveDiaryCss, titleClass: 'diary-page__title-block' },
  { surface: 'calendar', css: daveCalendarCss, titleClass: 'calendar-page__title-block' },
  { surface: 'todo', css: daveTodoCss, titleClass: 'todo-page__title-block' },
  { surface: 'imports', css: daveImportsCss, titleClass: 'imports-dashboard__title-block' },
  { surface: 'kanban', css: kanbanBoardCss, titleClass: 'kanban-page__title-block' },
]) {
  assert.match(
    css,
    new RegExp(`@media\\s*\\(min-width:\\s*821px\\)\\s*\\{[\\s\\S]*\\.${titleClass}\\s*\\{[\\s\\S]*display:\\s*none`),
    `${surface} desktop view must hide the redundant page title while preserving mobile S25 title lift.`,
  );
}
{
  const tabHtml = tabSlice('tab-calender');
  const statusStart = tabHtml.indexOf('id="calendar-status-strip"');
  const navStart = tabHtml.indexOf('class="calendar-nav-actions"');
  const filterStart = tabHtml.indexOf('id="calendar-filter-strip"');
  assert.ok(
    statusStart !== -1 && navStart > statusStart,
    'Calendar status/range pill must sit to the left of the Today/nav/refresh buttons.',
  );
  assert.ok(
    filterStart > navStart,
    'Calendar filter pill must stay in the control grid after the header action row.',
  );
  assert.doesNotMatch(tabHtml, /calendar-status-row/, 'Calendar must not drift back to the old split status row.');
  assert.doesNotMatch(tabHtml, /calendar-view-heading/, 'Calendar must not repeat a visible Year/Month View title.');
  assert.doesNotMatch(tabHtml, /calendar-range-pill/, 'Calendar must not repeat the range in a body heading pill.');
  assert.ok(
    tabHtml.includes('id="calendar-filter-inline-panel"') && tabHtml.includes('data-personal-filter-layout="tabs"'),
    'Calendar view must keep the under-calendar shared filter tab panel.',
  );
  assert.ok(
    tabHtml.includes('data-calendar-content-view="filters"') && tabHtml.includes('data-calendar-content-view="filter-settings"'),
    'Calendar FSM content views must include Filters and Filter Settings.',
  );
}
assert.match(
  daveCalendarCss,
  /\.calendar-control-strip\s*\{[\s\S]*display:\s*flex[\s\S]*flex-wrap:\s*wrap/,
  'Calendar desktop controls must use a wrapping row so the filter can join when it fits.',
);
assert.match(
  daveCalendarCss,
  /\.calendar-filter-strip\s*\{[\s\S]*flex:\s*999\s*1\s*max-content[\s\S]*min-width:\s*min\(100%,\s*max-content\)/,
  'Calendar filter strip must stay inline only while its content fits, then wrap to a full row.',
);
assert.match(
  daveCalendarCss,
  /@media\s*\(max-width:\s*820px\)\s*\{[\s\S]*\.calendar-control-strip\s*\{[\s\S]*display:\s*grid[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)[\s\S]*\.calendar-filter-strip\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1[\s\S]*min-width:\s*0/,
  'Calendar compact controls must keep the filter on its own full-width row.',
);
assert.match(
  daveCalendarCss,
  /\.calendar-status-strip\s*\{[\s\S]*flex:\s*0\s*1\s*auto[\s\S]*width:\s*max-content/,
  'Calendar desktop range pill must size to its content beside the navigation buttons.',
);
assert.match(
  daveCalendarCss,
  /@media\s*\(min-width:\s*821px\)\s*and\s*\(orientation:\s*portrait\)\s*\{[\s\S]*\.calendar-filter-under-panel\s*\{[\s\S]*display:\s*block/,
  'Calendar under-calendar filter tab panel must be limited to desktop portrait.',
);
assert.ok(
  indexHtml.includes('css/personal-filters.css') && indexHtml.includes('js/dave/personal-filters.js'),
  'Shared Personal filter component assets must be loaded before page modules use them.',
);
assert.match(
  indexHtml,
  /id="personal-filter-modal"[\s\S]*id="personal-filter-modal-root"[\s\S]*data-personal-filter-layout="tabs"/,
  'Shared Personal filter modal must remain a tabbed HubModal host.',
);
assert.match(
  daveCalendarJs,
  /id:\s*'filters'[\s\S]*id:\s*'filter-settings'/,
  'Calendar content view FSM must include Filters and Filter Settings.',
);
assert.match(
  daveCalendarJs,
  /PersonalFilters\.registerSurface\('calendar'[\s\S]*getRecords:\s*\(\)\s*=>\s*state\.data\?\.items\s*\|\|\s*\[\]/,
  'Calendar must register its records with the shared Personal filter component.',
);
assert.match(
  personalFiltersJs,
  /const\s+PersonalFilters\s*=[\s\S]*matchesRecord[\s\S]*openModal/,
  'Shared Personal filter module must expose record matching and modal opening.',
);
assert.match(
  personalFiltersJs,
  /document\.addEventListener\('click'[\s\S]*\},\s*true\);/,
  'Shared Personal filter chip clicks must be delegated in capture phase so HubModal internals cannot swallow them.',
);
assert.match(
  personalFiltersJs,
  /function\s+bindHostControls[\s\S]*data-personal-filter-toggle[\s\S]*toggle\.addEventListener\('click'[\s\S]*toggleFilter[\s\S]*\},\s*true\)/,
  'Rendered Personal filter chips must own direct capture-phase click handling inside HubModal bodies.',
);
assert.match(
  personalFiltersCss,
  /\.personal-filter-chip\.is-selected\s*\{[\s\S]*border-color:\s*#d9aa32[\s\S]*box-shadow:/,
  'Selected filter chips must keep the gold glow/border state.',
);
assert.match(
  personalFiltersCss,
  /dialog\.hub-modal\.personal-filter-modal\s*\{[\s\S]*width:\s*100vw[\s\S]*height:\s*100dvh[\s\S]*margin:\s*0[\s\S]*border-radius:\s*0[\s\S]*overflow:\s*hidden/,
  'Shared Personal filter modal must use the whole viewport.',
);
assert.doesNotMatch(
  personalFiltersCss + personalFiltersJs,
  /personal-filter-chip__shape/,
  'Personal filter shapes must be the whole chip, not a small shape inside a pill.',
);
assert.doesNotMatch(
  personalFiltersCss,
  /\.personal-filter-chip\[data-shape="(?:triangle|star|pentagon|rhombus)"\]\s*\{[^}]*min-height:/,
  'Symbolic Personal filter chips must be text-measured, not fixed with shape min-heights.',
);
assert.match(
  personalFiltersJs,
  /vendor\/pretext\/layout\.js[\s\S]*measureNaturalWidth[\s\S]*function\s+shapeMetrics/,
  'Personal filter chip sizing must use the existing pretext text-measurement path.',
);
assert.match(
  personalFiltersJs,
  /function\s+sortedFilterIds[\s\S]*?aMetrics\.sortHeight\s*-\s*bMetrics\.sortHeight/,
  'Personal filter options must order by measured chip height so taller shapes are later.',
);
assert.match(
  personalFiltersCss,
  /\.personal-filter-chip\s*\{[\s\S]*width:\s*var\(--pf-chip-width[\s\S]*height:\s*var\(--pf-chip-height/,
  'Personal filter chips must use measured width/height CSS variables.',
);
assert.match(
  personalFiltersJs,
  /function\s+candidateLineSets[\s\S]*function\s+maxLinesForShape[\s\S]*function\s+labelLayout/,
  'Personal filter labels must choose measured word wrapping by shape instead of relying on browser wrapping.',
);
assert.match(
  personalFiltersCss,
  /\.personal-filter-chip__label[\s\S]*flex-direction:\s*column[\s\S]*\.personal-filter-chip__label-line/,
  'Personal filter wrapped labels must render as explicit stacked lines.',
);
assert.match(
  personalFiltersJs,
  /shape\s*===\s*'triangle'[\s\S]*lowerTextMargin[\s\S]*width\s*=\s*Math\.ceil\(Math\.max/,
  'Triangle filter chips must size around lower-placed text where the triangle is wider.',
);
assert.match(
  personalFiltersCss,
  /\.personal-filter-chip\[data-shape="triangle"\]\s+\.personal-filter-chip__label\s*\{[\s\S]*bottom:\s*10px/,
  'Triangle filter labels must sit nearer the bottom of the shape where there is width for text.',
);
assert.match(
  personalFiltersJs,
  /function\s+countBadgeHtml[\s\S]*personal-filter-count-badge/,
  'Personal filter assignment counts must render as their own badge, not inline text in the label.',
);
assert.doesNotMatch(
  personalFiltersJs,
  /sizeWithBadgeRoom|withCount|includeCounts/,
  'Personal filter count badges must not participate in chip sizing or filter ordering.',
);
assert.match(
  personalFiltersJs,
  /const\s+BADGE_FONT[\s\S]*function\s+badgeMetrics[\s\S]*measureTextWidth\(label,\s*BADGE_FONT\)[\s\S]*function\s+badgePosition/,
  'Personal filter count badge placement must use measured badge text width.',
);
assert.match(
  personalFiltersJs,
  /function\s+badgeMargins[\s\S]*badge\.left\s*\+\s*badge\.width\s*-\s*metrics\.width[\s\S]*--pf-chip-margin-right/,
  'Personal filter chip spacing must account for count badge overflow.',
);
assert.match(
  personalFiltersCss,
  /\.personal-filter-chip\s*\{[\s\S]*margin:\s*var\(--pf-chip-margin-top/,
  'Personal filter chips must apply measured badge overflow margins.',
);
assert.match(
  personalFiltersJs,
  /shape\s*===\s*'square'[\s\S]*textWidth\s*\+\s*14[\s\S]*shape\s*===\s*'triangle'[\s\S]*textWidth\s*\+\s*10[\s\S]*shape\s*===\s*'star'[\s\S]*\/\s*0\.58[\s\S]*shape\s*===\s*'pentagon'[\s\S]*\/\s*0\.72/,
  'Square, triangle, and pentagon filter chips must stay tighter while stars keep enough room.',
);
assert.doesNotMatch(
  personalFiltersJs,
  /class="personal-filter-count"/,
  'Personal filter assignment counts must not reuse the old inline count class.',
);
assert.match(
  personalFiltersCss,
  /\.personal-filter-count-badge\s*\{[\s\S]*position:\s*absolute[\s\S]*left:\s*var\(--pf-count-badge-left[\s\S]*width:\s*var\(--pf-count-badge-width[\s\S]*border:\s*1px\s+solid\s+rgba\(255,\s*255,\s*255,\s*\.92\)[\s\S]*background:\s*#020617[\s\S]*font-size:\s*11px/,
  'Personal filter count badges must be compact high-contrast overlays.',
);
assert.match(
  personalFiltersCss,
  /\.personal-filter-chip\s*\{[\s\S]*overflow:\s*visible[\s\S]*\.personal-filter-chip\[data-shape="triangle"\]::before[\s\S]*clip-path:\s*var\(--pf-shape-clip\)/,
  'Personal filter polygon chips must draw the shape in pseudo-elements so badges are not clipped.',
);
assert.match(
  personalFiltersJs,
  /function\s+syncUltrawideSidecar[\s\S]*BlueprintsPageState\.current\(\)[\s\S]*data-personal-filter-layout="tabs"/,
  'Personal filter tabs must populate the ultrawide sidecar for Calendar/Diary/ToDo/Kanban pages.',
);
assert.match(
  daveCalendarJs,
  /status\s*===\s*'ready'\s*\?\s*''\s*:\s*status/,
  'Calendar ready status must suppress the word "ready" while keeping warning/error/loading labels available.',
);
assert.match(
  hubMenuJs,
  /contentBottom\s*=\s*rect\.top\s*\+\s*Math\.max\(rect\.height,\s*menu\.scrollHeight\s*\|\|\s*0\)/,
  'Shared hub-menu dropdown fitting must consider overflowing item content, not only the clipped menu rect.',
);
assert.match(
  menuActionOrderJs,
  /key:\s*'view-switch'[\s\S]*rank:\s*0[\s\S]*\^view\$/,
  'Function-menu ordering must keep View actions intentionally before Refresh.',
);
assert.match(
  menuActionOrderJs,
  /key:\s*'mode-switch'[\s\S]*rank:\s*65[\s\S]*\^mode\\b/,
  'Function-menu ordering must map Mode actions without stealing the top-level View rule.',
);
assert.match(
  daveMenuJs,
  /id:\s*'calendar-view-cycle'[\s\S]*label:\s*'View'[\s\S]*fn:\s*'calendar\.toggleContentView'/,
  'Calendar context menu must expose a top-level View function item.',
);
assert.match(
  daveCalendarCss,
  /\.calendar-day-number\s*\{[\s\S]*width:\s*2ch[\s\S]*text-align:\s*right/,
  'Calendar day numbers must right-align single digits with the unit column of two-digit days.',
);
assert.match(
  daveCalendarCss,
  /\[data-calendar-content-view\]\[hidden\]\s*\{[\s\S]*display:\s*none\s*!important/,
  'Calendar content panels must be mutually hidden by content-view state.',
);
assert.match(
  daveCalendarJs,
  /querySelectorAll\('section\[data-calendar-content-view\]'\)/,
  'Calendar content-view rendering must target only section panels, not the FSM view button.',
);
assert.match(
  daveCalendarJs,
  /calendarCurrentContentView\s*=\s*state\.contentView/,
  'Calendar FSM button must expose its current view with a distinct runtime dataset key.',
);
{
  const tabHtml = tabSlice('tab-calender');
  assert.match(
    tabHtml,
    /data-calendar-view-trigger/,
    'Calendar header must use the existing refresh icon button as the view trigger.',
  );
  for (const view of ['calendar', 'selected', 'milestones', 'search', 'new-event', 'upcoming', 'provenance']) {
    assert.match(
      tabHtml,
      new RegExp(`data-calendar-content-view="${view}"`),
      `Calendar must keep the ${view} content panel.`,
    );
  }
}
for (const label of [
  'Year / Month Calendar',
  'Selected Range Visible Items',
  'All-Day And Milestones',
  'Search And Review',
  'New Calendar Event',
  'Upcoming',
  'Provenance',
]) {
  assert.ok(daveCalendarJs.includes(`label: '${label}'`), `Calendar view menu must include "${label}".`);
}
assert.match(
  daveCalendarJs,
  /const\s+CalendarContentViewMachine\s*=\s*\(\(\)\s*=>[\s\S]*transitions\s*=\s*\{[\s\S]*doubleTap[\s\S]*openMenu[\s\S]*longPress[\s\S]*resetRefresh/,
  'Calendar view trigger must use an explicit FSM for tap, double-tap, and long-press.',
);
assert.match(
  daveCalendarJs,
  /'calendar\.toggleContentView':\s*\(\)\s*=>\s*CalendarPage\.toggleContentView\(\)/,
  'Calendar View context action must call the same content-view cycle path.',
);
for (const [tabId, surface, formNeedle] of [
  ['tab-diary', 'diary', 'class="diary-quick-entry"'],
  ['tab-calender', 'calendar', 'class="calendar-quick-event"'],
  ['tab-todo', 'todo', 'class="todo-quick-task"'],
]) {
  const tabHtml = tabSlice(tabId);
  const handleStart = tabHtml.indexOf('class="body-shade-handle"');
  const shellStart = tabHtml.indexOf('<div class="tab-scroll-shell">');
  const shellEnd = tabHtml.indexOf('</div><!-- /tab-scroll-shell -->', shellStart);
  const formStart = tabHtml.indexOf(formNeedle);
  assert.ok(
    handleStart !== -1 && shellStart > handleStart,
    `${surface} Body Shade handle must be visible before bulky content begins.`,
  );
  assert.ok(
    formStart > shellStart && formStart < shellEnd,
    `${surface} compose form must stay inside the managed scroll shell.`,
  );
}
assert.match(
  indexHtml,
  /css\/personal-search\.css/,
  'Shared Personal search CSS must be loaded.',
);
assert.match(
  indexHtml,
  /js\/dave\/personal-search\.js/,
  'Shared Personal search JS must be loaded.',
);
assert.match(
  activeBrowserObserver,
  /DIAGNOSTIC_SOURCES = new Set\(\['gpu_activity_sound', 'personal_search', 'personal_graph'\]\)/,
  'Active Browser diagnostics must expose the shared Personal search and graph state.',
);
assert.match(
  activeBrowserObserver,
  /surfaces\.personal_search = personalSearchSnapshot/,
  'Active Browser automation state must include the shared Personal search snapshot.',
);
assert.match(
  activeBrowserObserver,
  /surfaces\.personal_graph = personalGraphSnapshot/,
  'Active Browser automation state must include the shared Personal graph snapshot.',
);
assert.match(
  indexHtml,
  /id="personal-graph-modal"/,
  'Personal graph links must open in a HubModal dialog.',
);
assert.match(
  indexHtml,
  /class="hub-modal hub-dialog personal-graph-modal"/,
  'Personal graph links must use the shared HubModal and HubDialogs house style.',
);
assert.match(
  fs.readFileSync(path.resolve(here, '../js/dave/personal-search.js'), 'utf8'),
  /BlueprintsPersonalGraphLinks/,
  'Shared Personal search UI must expose graph-link automation state.',
);
assert.match(
  hubMenuJs,
  /syncDefaultItemText/,
  'Shared menu engine must support canonical shipped action labels over stale saved layouts.',
);
assert.doesNotMatch(
  hubMenuJs,
  /(^|[^\.\w])(alert|confirm|prompt)\s*\(/m,
  'Shared menu engine must fail closed instead of using native alert/confirm/prompt fallbacks.',
);
assert.match(
  daveMenuJs,
  /syncDefaultItemText:\s*true/,
  'Dave menu must sync shipped action labels over stale saved layout state.',
);
assert.match(
  kanbanMenuJs,
  /syncDefaultItemText:\s*true/,
  'Kanban menu must sync shipped action labels over stale saved layout state.',
);
for (const label of [
  'Generate Summary',
  'Open Day Folder',
  'Open Source',
  'Link Work',
  'Mode Year',
  'Mode Month',
  'Mode Day',
  'Mode Week',
  'Mode Today',
  'Mode Work',
  'Promote To Work',
  'Open Artifacts',
  'Show Blockers',
]) {
  assert.ok(daveMenuJs.includes(`label: '${label}'`), `Dave menu must keep shared label "${label}".`);
}
for (const oldLabel of ['Run Summary', 'Browse Folder', 'Browse Ledger', 'Connect Work']) {
  assert.ok(!daveMenuJs.includes(`label: '${oldLabel}'`), `Dave menu must not drift back to "${oldLabel}".`);
}
for (const label of [
  'Open Root',
  'Open Parent',
  'Open Child',
  'Open Detail',
  'New Child',
  'New Issue',
  'New ToDo',
  'Show Issues',
  'Show ToDos',
  'Write Detail Proof',
  'Write Scoped Proof',
]) {
  assert.ok(kanbanMenuJs.includes(`label: '${label}'`), `Kanban menu must keep shared label "${label}".`);
}
for (const oldLabel of ['Root Board', 'Up Board', 'Child Board', 'Detail', 'Add Child', 'Scoped Issues']) {
  assert.ok(!kanbanMenuJs.includes(`label: '${oldLabel}'`), `Kanban menu must not drift back to "${oldLabel}".`);
}
assert.doesNotMatch(
  bodyShadeJs,
  /document\.body\.classList\.(?:add|remove|toggle)\('(?:shade-is-up|has-fill-tab|has-managed-scroll-tab)'/,
  'Body Shade scroll-lock classes must not be body-only mutations.',
);

assert.match(
  bodyShadeCss,
  /html\.has-managed-scroll-tab[\s\S]*overflow:\s*hidden/,
  'Managed-scroll tabs must hide overflow on <html> without relying on :has().',
);
assert.match(
  bodyShadeCss,
  /body\.has-managed-scroll-tab\s+main\s*\{[\s\S]*padding-bottom:\s*0/,
  'Managed-scroll tabs must remove the global main bottom gutter that creates document scroll.',
);
assert.doesNotMatch(
  bodyShadeCss,
  /body\.has-managed-scroll-tab\s+main\s*\{[^}]*overflow:\s*hidden/,
  'Managed-scroll tabs must not make main a scroll container; that breaks sticky split-menu placement.',
);
assert.match(
  bodyShadeCss,
  /body\.has-managed-scroll-tab\s+\.tab-panel--managed-scroll\.active\s*\{[\s\S]*margin-bottom:\s*0/,
  'Managed-scroll active panels must not inherit the global section bottom gutter.',
);

assert.match(
  activeBrowserObserver,
  /function\s+_layoutState\s*\(/,
  'Active Browser reports must include layout metrics.',
);
assert.match(
  activeBrowserObserver,
  /html_has_managed_scroll_tab/,
  'Active Browser layout metrics must expose html managed-scroll lock state.',
);
assert.match(
  activeBrowserObserver,
  /panel_left_delta_from_menu/,
  'Active Browser layout metrics must expose page/menu alignment deltas.',
);
assert.match(
  activeBrowserObserver,
  /scrollbar_active/,
  'Active Browser layout metrics must expose managed shell scrollbar state.',
);
