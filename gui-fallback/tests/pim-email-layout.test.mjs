import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const emailCss = fs.readFileSync(path.join(root, 'css/dave-email.css'), 'utf8');
const bodyShadeCss = fs.readFileSync(path.join(root, 'css/body-shade.css'), 'utf8');
const bodyShadeJs = fs.readFileSync(path.join(root, 'js/body-shade.js'), 'utf8');
const daveMenuJs = fs.readFileSync(path.join(root, 'js/dave/dave-menu.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const emailJs = fs.readFileSync(path.join(root, 'js/dave/email-page.js'), 'utf8');

function tabSlice(tabId) {
  const start = indexHtml.indexOf(`<section id="${tabId}"`);
  assert.notEqual(start, -1, `${tabId} must exist.`);
  const nextSection = indexHtml.indexOf('\n  <section id="', start + 1);
  const nextDialog = indexHtml.indexOf('\n  <dialog', start + 1);
  const candidates = [nextSection, nextDialog].filter(value => value !== -1);
  const end = candidates.length ? Math.min(...candidates) : indexHtml.length;
  return indexHtml.slice(start, end);
}

test('PIM Email tab follows the Blueprints managed-scroll shell contract', () => {
  const tabHtml = tabSlice('tab-email');
  assert.match(indexHtml, /css\/dave-email\.css\?v=/, 'Email stylesheet must be loaded.');
  assert.match(indexHtml, /js\/dave\/email-page\.js\?v=/, 'Email page script must be loaded.');
  assert.match(tabHtml, /data-email-page/, 'Email page marker must exist.');
  assert.match(tabHtml, /id="s25-lift-email" class="s25-lift-block email-page__title-block" data-for-tab="email"/);
  assert.ok(
    tabHtml.indexOf('class="body-shade-handle"') < tabHtml.indexOf('<div class="tab-scroll-shell">'),
    'Email Body Shade handle must sit before the managed scroll shell.',
  );
  assert.match(tabHtml, /class="email-folders-panel email-main-folders"/, 'Normal desktop must have main-surface folder navigation.');
  assert.match(tabHtml, /class="email-secondary-under-panel"/, 'Desktop portrait must have the bottom secondary panel.');
  assert.match(tabHtml, /data-email-folder-controls-host="main"/, 'Main folder panel must expose toolbar-level folder controls.');
  assert.match(tabHtml, /data-email-folder-controls-host="secondary"/, 'Secondary folder tabs must expose toolbar-level folder controls.');
  assert.doesNotMatch(tabHtml, /data-email-secondary-tab="folders"/, 'The bottom toolbar must replace the Folders tab with the folder dropdown tabs.');
  assert.match(tabHtml, /data-email-secondary-tab="checks"[\s\S]*>Checks</, 'The bottom toolbar must keep the Checks tab.');
  assert.match(tabHtml, /data-email-secondary-tab="security"[\s\S]*>Security</, 'The bottom toolbar must expose the Security tab.');
  assert.match(tabHtml, /data-email-view-button="plain"[\s\S]*data-email-view-button="html"[\s\S]*data-email-view-button="markdown"[\s\S]*data-email-view-button="raw"/, 'Message view tabs must expose Plain, HTML, Markdown, then Raw.');
  assert.match(indexHtml, /id="email-secondary-modal"/, 'Mobile and fallback folder actions must use a HubModal.');
  assert.match(indexHtml, /data-email-folder-controls-host="modal"/, 'Folder modal must expose toolbar-level folder controls.');
  assert.match(indexHtml, /id="email-secondary-modal"[\s\S]*data-email-secondary-tab="security"[\s\S]*>Security</, 'Folder/check modal must also expose the Security tab.');
  assert.match(tabHtml, /data-email-list-toggle/, 'Message list collapse toggle must remain in the message header.');
});

test('PIM Email viewport rules match Dave and Kanban precedent', () => {
  assert.match(bodyShadeJs, /'tab-email'/, 'Body Shade resync must include Email.');
  assert.match(bodyShadeCss, /#tab-email\.active\s*>\s*\.tab-scroll-shell/, 'Body Shade CSS must include Email shell constraints.');
  assert.match(
    emailCss,
    /@media\s*\(min-width:\s*821px\)\s*and\s*\(orientation:\s*portrait\)[\s\S]*#tab-email\.active\s+\.email-main-folders\s*\{[\s\S]*display:\s*none[\s\S]*#tab-email\.active\s+\.email-secondary-under-panel\s*\{[\s\S]*display:\s*grid/,
    'Desktop portrait must move folders into the bottom tabbed section.',
  );
  assert.match(
    emailCss,
    /@media\s*\(min-width:\s*2400px\)\s*and\s*\(max-height:\s*1280px\)[\s\S]*#tab-email\.active\s+\.email-main-folders,[\s\S]*#tab-email\.active\s+\.email-secondary-under-panel,[\s\S]*#tab-email\.active\s+\.email-local-shade-handle\s*\{[\s\S]*display:\s*none/,
    'Ultrawide must suppress desktop main/bottom folder panels for the right sidecar.',
  );
  assert.match(emailCss, /\.email-ultrawide-shell\s*\{[\s\S]*grid-template-columns:\s*42px\s+minmax\(0,\s*1fr\)/);
  assert.match(
    emailCss,
    /#tab-email\.email-list-collapsed\s+\.email-list-panel\s*\{[\s\S]*display:\s*none/,
    'Collapsed list state must hide the message list panel.',
  );
  assert.match(
    emailCss,
    /@media\s*\(max-width:\s*820px\)[\s\S]*\.email-main-folders,[\s\S]*\.email-secondary-under-panel,[\s\S]*\.email-local-shade-handle\s*\{[\s\S]*display:\s*none/,
    'Mobile must use modal/context actions rather than persistent folder panels.',
  );
  assert.match(
    emailCss,
    /@media\s*\(max-height:\s*500px\)\s*and\s*\(max-width:\s*1000px\)[\s\S]*\.email-main-folders,[\s\S]*\.email-secondary-under-panel,[\s\S]*\.email-local-shade-handle\s*\{[\s\S]*display:\s*none/,
    'Mobile landscape must also use modal/context actions rather than persistent folder panels.',
  );
});

test('PIM Email UI is read-only and registered in Dave navigation', () => {
  assert.match(daveMenuJs, /id:\s*'email'[\s\S]*label:\s*'Email'/, 'Dave menu must expose the Email tab.');
  for (const fn of [
    'email.refresh',
    'email.browseFolders',
    'email.viewPlain',
    'email.viewHtml',
    'email.viewMarkdown',
    'email.viewRaw',
    'email.toggleList',
    'email.safeChecks',
    'email.security',
  ]) {
    assert.ok(daveMenuJs.includes(`fn: '${fn}'`) || emailJs.includes(`'${fn}'`), `${fn} must be wired.`);
  }
  assert.match(appJs, /tab === 'email'[\s\S]*BlueprintsEmailPage\.load\(\)/, 'switchTab must lazy-load Email.');
  assert.match(emailJs, /\/status/, 'Email UI must read middleware status.');
  assert.match(emailJs, /\/folders/, 'Email UI must list folders.');
  assert.match(emailJs, /\/folder-messages\?folder=\$\{encodeURIComponent\(selectedFolder\)\}&limit=30/, 'Email UI must list the selected folder messages on load.');
  assert.match(emailJs, /\/folder-messages\?folder=\$\{encodeURIComponent\(clean\)\}&limit=30/, 'Email UI must list any clicked folder.');
  assert.doesNotMatch(emailJs, /Inbox is the only message listing/, 'Email UI must not keep the old Inbox-only folder restraint.');
  assert.doesNotMatch(emailJs, /Only Inbox message opening/, 'Email UI must open messages from the selected folder.');
  assert.match(emailJs, /\/messages\/\$\{encodeURIComponent\(cleanUid\)\}/, 'Email UI must open messages by UID.');
  assert.match(emailJs, /role="tree"/, 'Email folders must render as a tree.');
  assert.match(emailJs, /data-email-folder-menu-toggle="set"/, 'Folder list must render as a split dropdown tab.');
  assert.match(emailJs, /data-email-folder-menu-toggle="group"/, 'Folder group must render as a split dropdown tab.');
  assert.match(emailJs, /data-email-folder-set-option/, 'Folder list dropdown tab must expose menu options.');
  assert.match(emailJs, /data-email-folder-group-option/, 'Folder group dropdown tab must expose menu options.');
  assert.doesNotMatch(emailJs, /<select[^>]+data-email-folder/, 'Folder controls must not regress to native selects.');
  assert.match(emailCss, /\.email-folder-tab-dropdown/, 'Email folder controls must use dropdown-tab styling.');
  assert.match(emailCss, /\.email-folder-tab-split/, 'Email folder controls must use split tab styling.');
  assert.match(emailJs, /exclusiveFolderGroups/, 'Email folders must be grouped by exclusive initial ranges.');
  assert.match(emailJs, /distributeFolderColumns/, 'Selected folder ranges must distribute roots across columns.');
  assert.match(emailJs, /frame\.setAttribute\('sandbox', ''\)/, 'HTML email must render in a no-permissions sandbox frame.');
  assert.match(emailJs, /img-src \$\{escHtml\(imgSources\)\}/, 'HTML email iframe must limit images to data and same-site proxy sources.');
  assert.match(emailJs, /RICH_VIEW_IDS = new Set\(\['html', 'markdown'\]\)/, 'HTML and Markdown must be treated as gated rich views.');
  assert.match(emailJs, /requires a green message security result/, 'Rich views must be gated behind a green security result.');
  assert.match(emailJs, /html_security/, 'HTML email safety metadata must be surfaced.');
  assert.match(emailJs, /state\.message\?\.security\?\.aggregate/, 'Email UI must consume backend security aggregate results.');
  assert.match(emailJs, /state\.view = 'plain'/, 'Opening a message must default the reader back to plain view.');
  assert.match(emailJs, /SECURITY_PROGRESS_EVENT = 'pim\.email\.security\.progress'/, 'Email security progress must use the shared SSE event stream.');
  assert.match(emailJs, /function renderSecurityProgressStrip\(\)/, 'Opened-message status must render compact security progress segments.');
  assert.match(emailJs, /security_run_id=\$\{encodeURIComponent\(runId\)\}/, 'Message opening must correlate backend progress events with a client run id.');
  assert.doesNotMatch(emailJs, /Message security \$\{status\}/, 'Opened-message status must not render a textual security colour sentence.');
  assert.doesNotMatch(emailJs, /Security \$\{aggregate\.status\}/, 'Message metadata must not duplicate the visible border colour in text.');
  assert.match(emailJs, /function messageSecurityHtml\(\)/, 'Email UI must render detailed per-message security results.');
  assert.match(emailJs, /authenticationResultsHtml/, 'Security detail must include provider Authentication-Results.');
  assert.match(emailJs, /securityFindingsHtml/, 'Security detail must include individual finding codes.');
  assert.match(emailJs, /\/messages\/\$\{encodeURIComponent\(uid\)\}\/security/, 'Security action must be able to refresh missing message security details.');
  assert.match(emailJs, /Email Security/, 'Security modal title must identify the security panel.');
  assert.match(emailCss, /\.email-message-panel\[data-email-security="red"\]/, 'Red security aggregate must tint the reader border.');
  assert.match(emailCss, /\.email-message-panel\[data-email-security="amber"\]/, 'Amber security aggregate must tint the reader border.');
  assert.match(emailCss, /\.email-message-panel\[data-email-security="green"\]/, 'Green security aggregate must tint the reader border.');
  assert.match(emailCss, /\.email-security-meter__segment\[data-tone="red"\]/, 'Status strip segments must show failed checks.');
  assert.match(emailCss, /\.email-security-meter__segment\[data-tone="amber"\]/, 'Status strip segments must show indeterminate checks.');
  assert.match(emailCss, /\.email-security-meter__segment\[data-tone="green"\]/, 'Status strip segments must show passed checks.');
  assert.match(emailCss, /@keyframes email-security-segment-pulse/, 'Running security checks must have a compact progress animation.');
  assert.match(emailCss, /\.email-security-finding/, 'Security findings must have readable detail styling.');
  assert.match(emailCss, /\.email-security-pill\[data-tone="red"\]/, 'Security failures must be visually distinct.');
  assert.match(emailJs, /function renderRawMessage\(/, 'Raw message view must have a dedicated renderer.');
  assert.match(emailJs, /function formatPlainMessageText\(/, 'Plain view must compact excessive blank lines before display.');
  assert.match(emailJs, /function renderPlainMessage\(/, 'Plain message view must have a dedicated renderer.');
  assert.match(emailCss, /\.email-message-content pre\.email-plain-view/, 'Plain view must have readable message-text styling.');
  assert.match(emailJs, /rawSecuritySignals/, 'Raw view must use security findings for line highlighting.');
  assert.match(emailCss, /\.email-raw-line\[data-tone="red"\]/, 'Raw view must style failed security evidence.');
  assert.match(emailCss, /\.email-raw-line\[data-tone="amber"\]/, 'Raw view must style indeterminate security evidence.');
  assert.match(emailCss, /\.email-raw-line\[data-tone="green"\]/, 'Raw view must style passed security evidence.');
  assert.doesNotMatch(emailJs, /\bmethod:\s*['"]DELETE['"]/, 'Email UI must not expose delete capability.');
  assert.doesNotMatch(`${indexHtml}\n${daveMenuJs}\n${emailJs}`, /data-email-action="(?:send|delete)"/, 'Email UI must not expose send/delete actions.');
  assert.doesNotMatch(emailJs, /smtp-self-test/, 'SMTP proof must not be a general UI action.');
});
