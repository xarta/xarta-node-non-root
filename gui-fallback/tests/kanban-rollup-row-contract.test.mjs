import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const kanbanBoardJs = fs.readFileSync(path.resolve(here, '../js/kanban/kanban-board.js'), 'utf8');

function functionSlice(source, fnName) {
  const fnStart = source.indexOf(`function ${fnName}`);
  assert.notEqual(fnStart, -1, `${fnName} must exist.`);
  const nextFn = source.indexOf('\n  function ', fnStart + 1);
  return source.slice(fnStart, nextFn === -1 ? source.length : nextFn);
}

const leafMetricsPillHtml = functionSlice(kanbanBoardJs, 'leafMetricsPillHtml');
const rollupRows = functionSlice(kanbanBoardJs, 'rollupRows');

assert.doesNotMatch(
  leafMetricsPillHtml,
  /blocker/i,
  'Leaf metric chips must describe descendant leaf item state only; kanban_blockers rows must not be folded into SubItems, Issues, or ToDos.',
);
assert.match(
  leafMetricsPillHtml,
  /const\s+blockedCount\s*=\s*Number\(options\.blockedCount\s*\?\?\s*metrics\.blocked\s*\?\?\s*0\)/,
  'The middle SubItems/Issues chip must remain the blocked descendant leaf count.',
);
assert.match(
  leafMetricsPillHtml,
  /leafMetricChip\(blockedCount,\s*blockedCount\s*>\s*0\s*\?\s*'err'\s*:\s*'empty',\s*blockedLabel\)/,
  'The middle SubItems/Issues chip must keep rendering blocked descendant leaf counts.',
);

assert.equal(
  (rollupRows.match(/class="kanban-rollup-row"/g) || []).length,
  3,
  'Kanban cards must keep exactly three rollup rows: SubItems, Issues, and ToDos.',
);

assert.match(
  rollupRows,
  /const\s+subitems\s*=\s*Math\.max\(0,\s*Number\(rollup\.items\?\.total\s*\|\|\s*1\)\s*-\s*1\)/,
  'SubItems active count must derive from scoped item descendants, not blockers.',
);
assert.match(
  rollupRows,
  /const\s+issues\s*=\s*Number\(rollup\.issues\?\.open\s*\|\|\s*0\)/,
  'Issues row must derive from rollup.issues.open.',
);
assert.match(
  rollupRows,
  /const\s+todos\s*=\s*Number\(rollup\.todos\?\.open\s*\|\|\s*0\)/,
  'ToDos row must derive from rollup.todos.open.',
);
assert.match(
  rollupRows,
  /leafMetricsFor\(rollup,\s*'items',\s*subitems\)/,
  'SubItems row must use item leaf metrics, including blocked descendant leaves.',
);
assert.match(
  rollupRows,
  /leafMetricsFor\(rollup,\s*'issues',\s*issues\)/,
  'Issues row must use issue leaf metrics.',
);
assert.match(
  rollupRows,
  /leafMetricsPillHtml\('subitems',\s*'SubItems',\s*itemLeafMetrics,\s*item\.item_id\)/,
  'SubItems row must not pass a blockedCount override.',
);
assert.match(
  rollupRows,
  /leafMetricsPillHtml\('issues',\s*'Issues',\s*issueLeafMetrics,\s*item\.item_id\)/,
  'Issues row must not pass a blockedCount override.',
);
assert.match(
  rollupRows,
  /pillHtml\('todos',\s*'ToDos',\s*todos,\s*todos\s*\?\s*'info'\s*:\s*'empty',\s*item\.item_id\)/,
  'ToDos row must use the ToDos open count.',
);

assert.doesNotMatch(
  rollupRows,
  /rollup\.blockers|blockers\?\.open|blockedCount|SubItems[\s\S]*blocker|data-kanban-pill="\$\{kind\}"[\s\S]*Blockers/i,
  'Card rollup rows must not read or render kanban_blockers rows; blocker detail belongs to the existing Blockers surface.',
);
assert.doesNotMatch(
  rollupRows,
  /['"`]blockers['"`]|['"`]Blockers['"`]/,
  'Do not add a Blockers card rollup row without explicit operator authorization.',
);
