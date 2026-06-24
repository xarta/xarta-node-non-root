import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync('/workspace/gui-fallback/js/app.js', 'utf8');
const kanbanSource = readFileSync('/workspace/gui-fallback/js/kanban/kanban-board.js', 'utf8');

assert.match(
  appSource,
  /_parseBlueprintsInternalHref\(href\)[\s\S]*blueprints:\\\/\\\/kanban\\\/items\\\//,
  'App shell must parse blueprints://kanban/items/<item_id> links.',
);

assert.match(
  appSource,
  /a\[href\^="blueprints:\/\/"\][\s\S]*preventDefault\(\)[\s\S]*_routeBlueprintsInternalHref\(href\)/,
  'App shell must intercept Blueprints internal anchors instead of letting the browser navigate an unknown scheme.',
);

assert.match(
  appSource,
  /switchTab\('kanban'\)[\s\S]*BlueprintsKanbanBoardPage\.openItemById\(parsed\.itemId\)/,
  'Blueprints Kanban links must switch to Kanban and open the target item by id.',
);

assert.match(
  kanbanSource,
  /async function openItemById\(itemId\)[\s\S]*routeDetailItemId[\s\S]*openItemDetail\(cleanItemId(?:,\s*\{[\s\S]*?routeTarget[\s\S]*?\})?\)/,
  'Kanban page must expose a direct item-id opener for internal links.',
);

assert.match(
  kanbanSource,
  /function itemRouteUrl\(itemId\)[\s\S]*group', 'kanban'[\s\S]*detail_item_id/,
  'Kanban page must expose a durable URL route for work item detail links.',
);
