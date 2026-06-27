import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = '/workspace/gui-fallback';
const kanbanJs = readFileSync(`${root}/js/kanban/kanban-board.js`, 'utf8');
const kanbanCss = readFileSync(`${root}/css/kanban-board.css`, 'utf8');

assert.match(
  kanbanJs,
  /const\s+CARD_DRAG_START_PX\s*=\s*6[\s\S]*const\s+CARD_SHARE_CLICK_DELAY_MS\s*=\s*220/,
  'Kanban card dragging must use a movement threshold and delayed share-click handling.',
);
assert.match(
  kanbanJs,
  /function\s+beginCardShareDrag\(event,\s*button\)[\s\S]*data-kanban-card-action="share"[\s\S]*beginCardShareDrag\(event,\s*dragButton\)/,
  'The existing share button must be the pointer drag anchor for cards.',
);
assert.match(
  kanbanJs,
  /function\s+cardDragTargetFromPoint\(clientX,\s*clientY\)[\s\S]*kind:\s*'child'[\s\S]*kind:\s*'lane'/,
  'Kanban card dragging must support child and lane drop targets.',
);
assert.match(
  kanbanJs,
  /function\s+orderDropTargetForCard\([\s\S]*CARD_DRAG_EDGE_PX[\s\S]*kind:\s*'order'/,
  'Kanban card dragging must support before/after order targets near card edges.',
);
assert.match(
  kanbanJs,
  /async\s+function\s+orderItemToDropTarget\([\s\S]*adjustedTargetIndex[\s\S]*\/order[\s\S]*direction/,
  'Drag reordering must use the existing Kanban order endpoint and adjusted target indexes.',
);
assert.match(
  kanbanJs,
  /async\s+function\s+promoteItemUp\([\s\S]*HubDialogs\.confirm[\s\S]*requestKind:\s*'promote'/,
  'Double-clicking the share drag handle must confirm before promoting a card upward.',
);
assert.match(
  kanbanJs,
  /function\s+externalRefreshSkipReason\(\)[\s\S]*is-dragging-kanban-card[\s\S]*return\s+'card-drag'/,
  'External Kanban refresh must skip while a card drag is active.',
);
assert.match(
  kanbanCss,
  /\.kanban-card-btn--share\s*\{[\s\S]*cursor:\s*grab[\s\S]*touch-action:\s*none/,
  'The share button must expose a grab affordance and touch-safe drag behavior.',
);
assert.match(
  kanbanCss,
  /\.kanban-column\[data-kanban-drop-target="lane"\][\s\S]*\.kanban-card\[data-kanban-drop-target="child"\]/,
  'Lane and child drop targets must have visible styling.',
);
assert.match(
  kanbanCss,
  /\.kanban-card\[data-kanban-drop-target="order-before"\]::before[\s\S]*\.kanban-card\[data-kanban-drop-target="order-after"\]::after/,
  'Order drop targets must render visible before and after insertion rails.',
);
assert.match(
  kanbanCss,
  /\.kanban-card-drag-ghost\s*\{[\s\S]*position:\s*fixed[\s\S]*pointer-events:\s*none/,
  'Kanban card dragging must render a non-interactive drag ghost.',
);
