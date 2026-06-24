import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = '/workspace/gui-fallback';
const indexHtml = readFileSync(`${root}/index.html`, 'utf8');
const kanbanJs = readFileSync(`${root}/js/kanban/kanban-board.js`, 'utf8');
const kanbanCss = readFileSync(`${root}/css/kanban-board.css`, 'utf8');
const todoJs = readFileSync(`${root}/js/dave/todo-page.js`, 'utf8');
const richMarkdownJs = readFileSync(`${root}/js/rich-markdown-editor.js`, 'utf8');
const richMarkdownCss = readFileSync(`${root}/css/rich-markdown-editor.css`, 'utf8');

assert.match(
  kanbanJs,
  /function\s+shareCode\(kind,\s*id\)[\s\S]*xarta-kanban:\$\{shareKindLabel\(kind\)\}:\$\{cleanId\}/,
  'Kanban cards must copy canonical xarta-kanban share codes.',
);
assert.match(
  kanbanJs,
  /data-kanban-card-action="share"/,
  'Kanban lane cards must expose a share action for item codes.',
);
assert.match(
  kanbanJs,
  /copyShareCode\('item'/,
  'Kanban lane card share actions must copy item codes.',
);
assert.match(
  kanbanJs,
  /data-kanban-detail-action="share"/,
  'Kanban item detail must expose a share action.',
);
assert.match(
  kanbanJs,
  /data-kanban-scoped-row-action="share"/,
  'Scoped issue/todo rows must expose share actions.',
);
assert.match(
  kanbanJs,
  /data-kanban-scoped-row-action="remove"[\s\S]*statusOverride[\s\S]*archived/,
  'Scoped issue/todo rows must support remove/archive from the fullscreen modal.',
);
assert.match(
  kanbanJs,
  /data-kanban-scoped-field="title"[\s\S]*data-kanban-scoped-field="body"/,
  'Scoped issue/todo rows must expose editable rich document title and body fields.',
);
assert.match(
  kanbanCss,
  /dialog\.hub-modal#kanban-scoped-modal[\s\S]*position:\s*fixed[\s\S]*width:\s*100vw[\s\S]*height:\s*100dvh/,
  'Scoped issue/todo modal must be fullscreen with viewport height.',
);
assert.match(
  kanbanCss,
  /\.kanban-scoped-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(210px,\s*280px\)/,
  'Scoped issue/todo rows must give the rich document editor most of the horizontal space.',
);

assert.match(
  todoJs,
  /Legacy API mode "work" means Kanban-backed tasks/,
  'ToDo code must document that legacy mode=work is Kanban, not a user job-work tag.',
);
assert.match(
  todoJs,
  /xarta-kanban:todo:\$\{todoId\}/,
  'Kanban-backed ToDo rows must copy canonical todo share codes.',
);
assert.match(
  todoJs,
  /REFRESH_LONG_PRESS_MS\s*=\s*700/,
  'The ToDo refresh button must keep the Kanban-style long-press timing.',
);
assert.match(
  todoJs,
  /data-todo-action="refresh"[\s\S]*startRefreshLongPress/,
  'The ToDo refresh button must start the long-press proof-row toggle state machine.',
);
assert.match(
  todoJs,
  /\/api\/v1\/personal\/work\/preferences[\s\S]*show_test_entries/,
  'The ToDo proof-row toggle must persist through Kanban work preferences.',
);
assert.match(
  readFileSync(`${root}/css/dave-todo.css`, 'utf8'),
  /\.todo-icon-btn--refresh\[data-todo-test-entries="hidden"\]/,
  'The ToDo refresh button must visibly reflect hidden proof rows.',
);
assert.match(
  indexHtml,
  /data-todo-mode-button="work">Kanban<\/button>/,
  'The ToDo internal work mode button must be labelled Kanban.',
);
assert.doesNotMatch(
  indexHtml,
  /data-todo-mode-button="work">Work<\/button>/,
  'The ToDo internal work mode button must not reintroduce human-visible Work.',
);

assert.match(
  richMarkdownJs,
  /document\.addEventListener\('paste'[\s\S]*forcePng:\s*true/,
  'Rich Markdown must support pasted clipboard images and force them through PNG upload.',
);
assert.match(
  richMarkdownJs,
  /function\s+uploadAndInsertPicture[\s\S]*state\.inFlightUploads[\s\S]*insertAtActiveField\(markdown,\s*\{\s*dedupeKey:/,
  'Rich Markdown image upload must centralize upload/insert and guard duplicate insertion.',
);
assert.match(
  richMarkdownJs,
  /function\s+imageFileToPng[\s\S]*createImageBitmap[\s\S]*canvasBlob/,
  'Rich Markdown pasted image conversion must draw valid clipboard images to PNG.',
);
assert.match(
  indexHtml,
  /id="rich-markdown-picture-name"/,
  'Picture picker must expose an editable image name before saving.',
);
assert.match(
  richMarkdownCss,
  /\.rich-md-picture-toolbar\s*\{[\s\S]*grid-template-columns:\s*minmax\(150px,\s*1fr\)\s+minmax\(150px,\s*1fr\)\s+auto/,
  'Picture picker toolbar must leave room for name, filter, and upload controls.',
);
