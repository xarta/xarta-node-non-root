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
  /function\s+kanbanItemIdFromShareRef\(value\)[\s\S]*xarta-kanban:[\s\S]*kanban_items:/,
  'Kanban link forms must accept pasted xarta-kanban share codes and legacy kanban_items refs.',
);
assert.match(
  kanbanJs,
  /function\s+kanbanGraphRefFromShareRef\(value\)[\s\S]*kanban_items:\$\{itemId\}/,
  'Kanban blocker forms must normalize pasted share codes into graph refs.',
);
assert.match(
  kanbanJs,
  /function\s+renderEditorMarkdown\(md,[\s\S]*BlueprintsRichMarkdown\?\.render[\s\S]*renderMarkdown\(md,\s*emptyText\)/,
  'Kanban rich editor preview sync must prefer the Rich Markdown renderer over the generic docs renderer.',
);
assert.match(
  kanbanJs,
  /function\s+refreshDetailFieldPreview\(field,\s*value\)[\s\S]*preview\.innerHTML\s*=\s*renderEditorMarkdown\(value/,
  'Kanban mirrored detail previews must keep rich-doc image URLs renderable during edits.',
);
assert.match(
  kanbanJs,
  /reviewBody:\s*detail\?\.review_document\?\.body\s*\|\|\s*''/,
  'Kanban item detail drafts must include the optional Review rich document body.',
);
assert.match(
  kanbanJs,
  /fieldName === 'reviewBody'\s*\?\s*'item-review'/,
  'Kanban Review markdown fields must use the item-review rich-doc document type.',
);
assert.match(
  kanbanJs,
  /id:\s*'discussion'[\s\S]*id:\s*'review'[\s\S]*label:\s*'Review'/,
  'Kanban item detail must render the Review tab immediately after Discussion.',
);
assert.match(
  kanbanJs,
  /data-kanban-detail-action="save-review-doc"[\s\S]*\/kanban\/items\/\$\{encodeURIComponent\(cleanItemId\)\}\/review/,
  'Kanban Review tab must save through the item review document API.',
);
assert.match(
  kanbanJs,
  /data-kanban-card-action="share"/,
  'Kanban lane cards must expose a share action for item codes.',
);
assert.match(
  kanbanJs,
  /function\s+openScoped\(kind,[\s\S]*loadScoped\(config\.kind,\s*itemId,\s*scope,\s*view\)[\s\S]*writeRouteState\(state\.currentParentId,\s*'',\s*\{[\s\S]*kind:\s*config\.kind[\s\S]*view:\s*data\.view\s*\|\|\s*view/,
  'Issue and ToDo rollup trace views must load and route the scoped list.',
);
assert.match(
  kanbanJs,
  /kanbanPill === 'issues'[\s\S]*openScoped\('issues',\s*itemId,\s*\{\s*scope:\s*'descendants',\s*view:\s*'flat'\s*\}\)[\s\S]*kanbanPill === 'todos'[\s\S]*openScoped\('todos',\s*itemId,\s*\{\s*scope:\s*'descendants',\s*view:\s*'flat'\s*\}\)/,
  'Ancestor Issues and ToDos rollup pills must open the full descendant trace list.',
);
assert.match(
  kanbanJs,
  /function\s+cardShareKind\(item\)[\s\S]*type === 'issue'[\s\S]*'issue'[\s\S]*'item'/,
  'Kanban lane card share actions must copy issue codes only for Issue cards and item codes otherwise.',
);
assert.match(
  kanbanJs,
  /function\s+leafMetricsFor\(rollup,[\s\S]*function\s+leafMetricsPillHtml\([\s\S]*kanban-pill-btn--multi/,
  'Kanban SubItems and Issues rollup pills must render active, blocked, and done leaf metrics.',
);
assert.match(
  kanbanJs,
  /function\s+pillHtml\(kind,[\s\S]*kanban-pill-btn--single-metric[\s\S]*pillMetricChip\(count,\s*tone,\s*countLabel\)/,
  'Kanban ToDos rollup must use the same square metric badge layout as other rollups.',
);
assert.match(
  kanbanCss,
  /\.kanban-pill-metrics\s*\{[\s\S]*display:\s*inline-flex[\s\S]*\.kanban-pill-metric\[data-tone="err"\]/,
  'Kanban multi-metric rollup chips must have compact stable styling and red blocker emphasis.',
);
assert.match(
  kanbanCss,
  /\.kanban-pill-btn\s*\{[\s\S]*max-width:\s*100%[\s\S]*overflow:\s*hidden/,
  'Kanban rollup buttons must clip inside narrow cards instead of overflowing.',
);
assert.match(
  kanbanCss,
  /\.kanban-card\s*\{[\s\S]*max-width:\s*100%/,
  'Kanban cards must not grow wider than squeezed lanes.',
);
assert.match(
  kanbanCss,
  /\.kanban-rollup-row\s*\{[\s\S]*min-width:\s*0[\s\S]*width:\s*100%[\s\S]*max-width:\s*100%/,
  'Kanban rollup rows must not force narrow cards wider than their lane.',
);
assert.match(
  kanbanCss,
  /\.kanban-pill-btn--multi\s*\{[\s\S]*position:\s*relative[\s\S]*padding-right:\s*clamp\(/,
  'Kanban multi-metric rollup labels must reserve clipped space behind the badge cluster.',
);
assert.match(
  kanbanCss,
  /\.kanban-pill-btn\s*\{[\s\S]*align-items:\s*center[\s\S]*text-align:\s*left/,
  'Kanban rollup pill labels must share a left-aligned baseline.',
);
assert.match(
  kanbanCss,
  /\.kanban-pill-metrics\s*\{[\s\S]*position:\s*absolute[\s\S]*right:\s*6px[\s\S]*max-width:\s*calc\(100% - 12px\)[\s\S]*overflow:\s*hidden/,
  'Kanban multi-metric badge clusters must stay in front and clip within the pill.',
);
assert.match(
  kanbanCss,
  /\.kanban-pill-btn--single-metric \.kanban-pill-metrics\s*\{[\s\S]*width:\s*min\(var\(--kanban-pill-metric-rail\),\s*calc\(100% - 12px\)\)/,
  'Kanban one-chip ToDos metric rail must align with the three-chip rollup rail.',
);
assert.match(
  kanbanCss,
  /\.kanban-pill-metric\s*\{[\s\S]*width:\s*var\(--kanban-pill-metric-size\)[\s\S]*height:\s*var\(--kanban-pill-metric-size\)[\s\S]*border-radius:\s*5px/,
  'Kanban multi-metric badges must render as compact square chips.',
);
assert.match(
  kanbanCss,
  /\.kanban-pill-btn > span:first-child\s*\{[\s\S]*min-width:\s*0[\s\S]*text-overflow:\s*ellipsis/,
  'Kanban simple rollup labels must shrink before their count badge overflows.',
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
  /const\s+TodoRefreshGestureMachine\s*=\s*\(\(\)\s*=>[\s\S]*longPressTimeout[\s\S]*CLICK_SUPPRESSED[\s\S]*toggleTestEntries[\s\S]*data-todo-action="refresh"[\s\S]*TodoRefreshGestureMachine\.dispatch\('pointerDown'/,
  'The ToDo refresh button must dispatch into the long-press test-entry toggle state machine.',
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
