import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bodyShadeJs = fs.readFileSync(path.resolve(here, '../js/body-shade.js'), 'utf8');
const bodyShadeCss = fs.readFileSync(path.resolve(here, '../css/body-shade.css'), 'utf8');
const hubMenuJs = fs.readFileSync(path.resolve(here, '../js/hub-menu.js'), 'utf8');
const indexHtml = fs.readFileSync(path.resolve(here, '../index.html'), 'utf8');
const daveCalendarCss = fs.readFileSync(path.resolve(here, '../css/dave-calendar.css'), 'utf8');
const daveDiaryCss = fs.readFileSync(path.resolve(here, '../css/dave-diary.css'), 'utf8');
const daveTodoCss = fs.readFileSync(path.resolve(here, '../css/dave-todo.css'), 'utf8');
const daveImportsCss = fs.readFileSync(path.resolve(here, '../css/dave-imports.css'), 'utf8');
const kanbanBoardCss = fs.readFileSync(path.resolve(here, '../css/kanban-board.css'), 'utf8');
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
  /(?:#s25-lift-calender|\.calendar-page__title-block)[\s\S]{0,240}letter-spacing\s*:\s*(?:0|normal|initial|unset)\b/i,
  'Calendar lifted S25 title must keep the intentional inherited letter-spacing treatment.',
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
