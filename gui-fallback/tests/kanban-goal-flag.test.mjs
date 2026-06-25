import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const kanbanSource = readFileSync('/workspace/gui-fallback/js/kanban/kanban-board.js', 'utf8');

assert.match(
  kanbanSource,
  /function goalFlagCheckboxHtml\(id, checked = false, attrs = ''\)[\s\S]*hub-checkbox[\s\S]*Goal/,
  'Kanban item forms must render an editable goal flag checkbox.',
);

assert.match(
  kanbanSource,
  /goal_flag: Boolean\(goalFlagInput\?\.checked\)/,
  'Kanban item creation payloads must include the goal flag.',
);

assert.match(
  kanbanSource,
  /data-kanban-detail-field="goalFlag"[\s\S]*goal_flag: Boolean\(draft\.goalFlag\)/,
  'Kanban detail edits must bind and PATCH the goal flag.',
);

assert.match(
  kanbanSource,
  /item\?\.goal_flag \? 'goal' : ''[\s\S]*kanban-goal-pill/,
  'Goal items must be filterable and visually marked on cards.',
);
