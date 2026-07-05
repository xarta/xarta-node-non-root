import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const kanbanBoardJs = fs.readFileSync(path.resolve(here, '../js/kanban/kanban-board.js'), 'utf8');

function functionSlice(source, fnName) {
  const match = new RegExp(`(^|\\n)  (?:async\\s+)?function ${fnName}\\(`).exec(source);
  assert.notEqual(match, null, `${fnName} must exist.`);
  const fnStart = match.index + match[1].length;
  const nextMatch = /\n  (?:async\s+)?function /.exec(source.slice(fnStart + 1));
  const nextFn = nextMatch ? fnStart + 1 + nextMatch.index : -1;
  return source.slice(fnStart, nextFn === -1 ? source.length : nextFn);
}

const loadRollups = functionSlice(kanbanBoardJs, 'loadRollups');
const load = functionSlice(kanbanBoardJs, 'load');

assert.match(
  loadRollups,
  /items\.slice\(0,\s*200\)/,
  'Kanban visible rollup loading must keep the existing 200-card safety cap.',
);
assert.match(
  loadRollups,
  /new URLSearchParams\(\)/,
  'Kanban visible rollup loading must build a single batch query.',
);
assert.match(
  loadRollups,
  /params\.append\('item_id',\s*item\.item_id\)/,
  'Kanban visible rollup loading must send repeated item_id query values.',
);
assert.match(
  loadRollups,
  /\/api\/v1\/personal\/kanban\/rollups\?\$\{params\.toString\(\)\}/,
  'Kanban visible rollup loading must prefer the batch rollups endpoint.',
);
assert.doesNotMatch(
  kanbanBoardJs,
  /function\s+loadSingleRollups\(/,
  'Kanban visible rollup loading must not keep a per-card rollup fallback.',
);
assert.doesNotMatch(
  loadRollups,
  /\/api\/v1\/personal\/kanban\/items\/\$\{encodeURIComponent\(item\.item_id\)\}\/rollup/,
  'Kanban visible rollup loading must not fan out to single-card rollup requests.',
);
assert.match(
  loadRollups,
  /catch\s*\([^)]*\)\s*\{[\s\S]*nextRollups\s*=\s*\{\};[\s\S]*\}/,
  'Kanban visible rollup batch failure must leave rollups empty without per-card retries.',
);
assert.match(
  load,
  /const\s+rollupToken\s*=\s*\+\+state\.rollupLoadToken/,
  'Kanban board loads must version async rollup hydration so stale rollups cannot repaint newer boards.',
);
assert.match(
  load,
  /void\s+loadRollups\(rollupItems,\s*rollupToken\)\.then/,
  'Kanban board loads must render the board before async rollup hydration completes.',
);
assert.doesNotMatch(
  load,
  /await\s+loadRollups/,
  'Kanban board loads must not block first paint on visible-card rollup hydration.',
);
