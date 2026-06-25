import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = '/workspace/gui-fallback';
const indexHtml = readFileSync(`${root}/index.html`, 'utf8');
const kanbanJs = readFileSync(`${root}/js/kanban/kanban-board.js`, 'utf8');
const kanbanCss = readFileSync(`${root}/css/kanban-board.css`, 'utf8');
const todoJs = readFileSync(`${root}/js/dave/todo-page.js`, 'utf8');
const richMarkdownJs = readFileSync(`${root}/js/rich-markdown-editor.js`, 'utf8');
const richMarkdownCss = readFileSync(`${root}/css/rich-markdown-editor.css`, 'utf8');
const activeBrowserJs = readFileSync(`${root}/js/active-browser-observer.js`, 'utf8');

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
  /function\s+openFirstScopedCard\(kind,[\s\S]*loadScoped\(config\.kind,\s*itemId,\s*'descendants',\s*'flat'\)[\s\S]*navigateToBoard\(first\?\.parent_item_id[\s\S]*setSelection\(firstCardId,\s*\{\s*routeTarget:\s*true\s*\}\)/,
  'Issue and ToDo rollup drill-down must open the first matching descendant lane card.',
);
assert.match(
  kanbanJs,
  /kanbanPill === 'issues'[\s\S]*openFirstScopedCard\('issues',\s*itemId\)[\s\S]*kanbanPill === 'todos'[\s\S]*openFirstScopedCard\('todos',\s*itemId\)/,
  'Ancestor Issues and ToDos rollup pills must drill to matching lane cards.',
);
assert.match(
  kanbanJs,
  /function\s+cardShareKind\(item\)[\s\S]*type === 'issue'[\s\S]*'issue'[\s\S]*'item'/,
  'Kanban lane card share actions must copy issue codes only for Issue cards and item codes otherwise.',
);
assert.match(
  kanbanJs,
  /data-kanban-item-type=/,
  'Kanban lane cards must expose typed item card metadata.',
);
assert.match(
  kanbanJs,
  /function\s+externalRefresh\(options\s*=\s*\{\}\)[\s\S]*externalRefreshSkipReason\(\)[\s\S]*load\(\{\s*force:\s*true,\s*skipRouteDetail:\s*true,\s*skipRouteScoped:\s*true\s*\}\)/,
  'Kanban must support guarded external lane refresh commands.',
);
assert.match(
  kanbanJs,
  /function\s+externalRefreshSkipReason\(\)[\s\S]*state\.scoped\.open[\s\S]*detailDraftDirty\(\)[\s\S]*kanbanFocusedField\(\)/,
  'Kanban external refresh must skip while scoped rows, dirty detail drafts, or fields are active.',
);
assert.match(
  kanbanJs,
  /editing:\s*!!externalRefreshSkipReason\(\)[\s\S]*draft_dirty:\s*detailDraftDirty\(\)/,
  'Kanban Active Browser snapshots must report editing and dirty state.',
);
assert.match(
  activeBrowserJs,
  /kanban_lane_update[\s\S]*kanban_external_refresh[\s\S]*_refreshKanbanFromExternalChange/,
  'Active Browser must execute external Kanban refresh commands.',
);
assert.doesNotMatch(
  kanbanJs,
  /New Work Item/,
  'Kanban UI must not label item creation as "New Work Item".',
);
assert.match(
  kanbanJs,
  /kanban-type-pill/,
  'Kanban lane cards must render a compact type badge for typed Issue cards.',
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
  /Kanban mode uses the Kanban task projection/,
  'ToDo code must document that Kanban mode is not the ordinary user tag named work.',
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
  'The ToDo refresh button must start the long-press test-entry toggle state machine.',
);
assert.match(
  todoJs,
  /\/api\/v1\/personal\/kanban\/preferences[\s\S]*show_test_entries/,
  'The ToDo test-entry toggle must persist through Kanban preferences.',
);
assert.match(
  readFileSync(`${root}/css/dave-todo.css`, 'utf8'),
  /\.todo-icon-btn--refresh\[data-todo-test-entries="hidden"\]/,
  'The ToDo refresh button must visibly reflect hidden test entries.',
);
assert.match(
  todoJs,
  /test entries hidden[\s\S]*test entr/,
  'The ToDo page must describe hidden Kanban rows as test entries.',
);
assert.match(
  indexHtml,
  /data-todo-mode-button="kanban">Kanban<\/button>/,
  'The ToDo Kanban mode button must use the Kanban mode id.',
);
assert.doesNotMatch(
  indexHtml,
  /data-todo-mode-button="work"/,
  'The ToDo mode buttons must not reintroduce the old hidden work mode id.',
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
const uploadKeyBlock = richMarkdownJs.match(/const uploadKey = \[[\s\S]*?\]\.join\(':'\);/)?.[0] || '';
assert.match(
  richMarkdownJs,
  /recentUploads:\s*new Map\(\)/,
  'Rich Markdown uploads must remember recently completed upload keys.',
);
assert.match(
  richMarkdownJs,
  /state\.inFlightUploads\.has\(uploadKey\)\s*\|\|\s*recentlyProcessedUpload\(uploadKey\)/,
  'Rich Markdown upload dedupe must block both in-flight and just-finished duplicate uploads.',
);
assert.doesNotMatch(
  uploadKeyBlock,
  /lastModified/,
  'Rich Markdown upload dedupe must not use generated File lastModified timestamps.',
);
assert.match(
  uploadKeyBlock,
  /context\.discussion_id[\s\S]*options\.source[\s\S]*uploadDedupeName\(file,\s*prepared\)[\s\S]*prepared\.size[\s\S]*prepared\.type/,
  'Rich Markdown upload dedupe must use stable context, source, name, size, and type fields.',
);
assert.match(
  richMarkdownJs,
  /function\s+uploadDedupeName[\s\S]*replace\(\s*\/-\\d\{8\}-\\d\{6\}\$\/i/,
  'Rich Markdown upload dedupe must normalize generated timestamp suffixes.',
);
assert.match(
  richMarkdownJs,
  /insertAtActiveField\(markdown,\s*\{\s*dedupeKey:\s*uploadKey\s*\}\);[\s\S]*rememberProcessedUpload\(uploadKey\);/,
  'Rich Markdown insertion dedupe must use the stable upload key and remember it after success.',
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
