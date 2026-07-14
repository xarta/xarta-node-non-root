import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = '/workspace';
const settingsJs = readFileSync(
  `${root}/gui-fallback/js/kanban/kanban-model-settings.js`,
  'utf8',
);
const filtersJs = readFileSync(
  `${root}/gui-fallback/js/dave/personal-filters.js`,
  'utf8',
);
const boardJs = readFileSync(
  `${root}/gui-fallback/js/kanban/kanban-board.js`,
  'utf8',
);
const selectorJs = readFileSync(
  `${root}/gui-embed/blueprints-node-selector.js`,
  'utf8',
);

assert.match(
  settingsJs,
  /const\s+API_ROOT\s*=\s*'\/api\/v1\/personal\/kanban\/automation\/model-routing\/settings'/,
  'Kanban Settings must use the server-owned processor routing API.',
);
assert.match(
  settingsJs,
  /const\s+KINDS\s*=\s*\['preprocessing',\s*'review',\s*'blocker'\]/,
  'Settings must render all three first-class Kanban processor priority lists.',
);
assert.match(
  settingsJs,
  /blocker:\s*'Blocker Processor processing'/,
  'The third list must be visibly named Blocker Processor.',
);
assert.match(
  settingsJs,
  /body:\s*JSON\.stringify\(\{[\s\S]*route_ids:[\s\S]*expected_revision:[\s\S]*reset,[\s\S]*actor:/,
  'Saves must submit only the ordered opaque route ids plus stale-write and audit fields.',
);
assert.doesNotMatch(
  settingsJs,
  /JSON\.stringify\(\{[\s\S]{0,500}(provider|model_id|endpoint|credential|api_key)\s*:/,
  'Browser save payloads must not accept provider, model, endpoint, or credential authority.',
);
assert.match(
  settingsJs,
  /function\s+moveRoute\([\s\S]*function\s+dropRoute\([\s\S]*Alt\+↑\s*\/\s*Alt\+↓/,
  'The priority lists must support buttons, keyboard ordering, and drag/drop.',
);
assert.match(
  settingsJs,
  /addEventListener\('keydown'[\s\S]*event\.altKey[\s\S]*ArrowUp[\s\S]*ArrowDown/,
  'Keyboard reordering must remain wired through delegated events.',
);
assert.match(
  settingsJs,
  /addEventListener\('dragstart'[\s\S]*addEventListener\('dragover'[\s\S]*addEventListener\('drop'[\s\S]*addEventListener\('dragend'/,
  'Drag/drop must expose a complete bounded lifecycle.',
);
assert.match(
  settingsJs,
  /const\s+rows\s*=\s*new\s+Map[\s\S]*rows\.get\(routeId\)[\s\S]*container\.appendChild\(row\)/,
  'Passive refresh must reuse route row DOM nodes instead of remounting the form.',
);
assert.match(
  settingsJs,
  /options\.preserveDrafts[\s\S]*current\?\.dirty[\s\S]*next\.draftIds\s*=\s*\[\.\.\.current\.draftIds\]/,
  'Availability refresh must preserve dirty operator ordering.',
);
assert.match(
  settingsJs,
  /restoreFocus[\s\S]*activeElement\.isConnected[\s\S]*focus\(\{\s*preventScroll:\s*true\s*\}\)/,
  'Refresh must preserve focus without forcing scroll movement.',
);
assert.match(
  filtersJs,
  /kanban-settings[\s\S]*KanbanModelSettings\?\.bind/,
  'Normal modal and responsive Personal filter hosts must bind Kanban Settings.',
);
assert.match(
  boardJs,
  /id:\s*'kanban-settings',[\s\S]*KanbanModelSettings\?\.renderTab/,
  'Kanban sidecar tabs must render the shared Settings component.',
);
assert.match(
  selectorJs,
  /'kanban-settings':[\s\S]*activateTab\('kanban',\s*'kanban-settings'[\s\S]*openModal\?\.\('kanban',\s*'kanban-settings'/,
  'Active Browser automation must open the same sidecar/modal Settings surface as the UI.',
);
