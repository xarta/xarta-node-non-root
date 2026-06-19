import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bodyShadeJs = fs.readFileSync(path.resolve(here, '../js/body-shade.js'), 'utf8');
const bodyShadeCss = fs.readFileSync(path.resolve(here, '../css/body-shade.css'), 'utf8');
const activeBrowserObserver = fs.readFileSync(
  path.resolve(here, '../js/active-browser-observer.js'),
  'utf8',
);

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
