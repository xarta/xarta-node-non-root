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
const activeBrowserObserverJs = fs.readFileSync(path.join(root, 'js/active-browser-observer.js'), 'utf8');
const daveMenuJs = fs.readFileSync(path.join(root, 'js/dave/dave-menu.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const emailJs = fs.readFileSync(path.join(root, 'js/dave/email-page.js'), 'utf8');
const serviceWorkerJs = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

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
  assert.match(tabHtml, /data-email-secondary-tab="cache"[\s\S]*>Cache</, 'The bottom toolbar must expose the Cache tab.');
  assert.match(tabHtml, /data-email-view-button="plain"[\s\S]*data-email-view-button="html"[\s\S]*data-email-view-button="markdown"[\s\S]*data-email-view-button="raw"/, 'Message view tabs must expose Plain, HTML, Markdown, then Raw.');
  assert.match(indexHtml, /id="email-secondary-modal"/, 'Mobile and fallback folder actions must use a HubModal.');
  assert.match(indexHtml, /data-email-folder-controls-host="modal"/, 'Folder modal must expose toolbar-level folder controls.');
  assert.match(indexHtml, /id="email-secondary-modal"[\s\S]*data-email-secondary-tab="security"[\s\S]*>Security</, 'Folder/check modal must also expose the Security tab.');
  assert.match(indexHtml, /id="email-secondary-modal"[\s\S]*data-email-secondary-tab="cache"[\s\S]*>Cache</, 'Folder/check modal must also expose the Cache tab.');
  assert.match(tabHtml, /data-email-secondary-tab="trusted"[\s\S]*>Trusted</, 'The bottom toolbar must expose the Trusted tab.');
  assert.match(indexHtml, /id="email-secondary-modal"[\s\S]*data-email-secondary-tab="trusted"[\s\S]*>Trusted</, 'Folder/check modal must also expose the Trusted tab.');
  assert.match(tabHtml, /data-email-secondary-tab="trusted"[\s\S]*>Trusted<[\s\S]*data-email-search-mode-dropdown[\s\S]*data-email-secondary-tab="search"[\s\S]*Search: Simple[\s\S]*data-email-search-mode-option="simple"[\s\S]*data-email-search-mode-option="advanced"/, 'The bottom toolbar must expose Search as a Simple/Advanced split dropdown directly after Trusted.');
  assert.match(indexHtml, /id="email-secondary-modal"[\s\S]*data-email-secondary-tab="trusted"[\s\S]*>Trusted<[\s\S]*data-email-search-mode-dropdown[\s\S]*data-email-secondary-tab="search"[\s\S]*Search: Simple[\s\S]*data-email-search-mode-option="simple"[\s\S]*data-email-search-mode-option="advanced"/, 'Folder/check modal must expose Search as a Simple/Advanced split dropdown directly after Trusted.');
  assert.match(tabHtml, /data-email-list-toggle/, 'Message list collapse toggle must remain in the message header.');
});

test('PIM Email viewport rules match Dave and Kanban precedent', () => {
  assert.match(bodyShadeJs, /'tab-email'/, 'Body Shade resync must include Email.');
  assert.match(bodyShadeCss, /#tab-email\.active\s*>\s*\.tab-scroll-shell/, 'Body Shade CSS must include Email shell constraints.');
  assert.match(
    emailCss,
    /@media\s*\(min-width:\s*821px\)[\s\S]*\.email-page__title-block h2\s*\{[\s\S]*display:\s*none/,
    'Desktop Email must hide only the page title text.',
  );
  assert.doesNotMatch(
    emailCss,
    /@media\s*\(min-width:\s*821px\)[\s\S]*\.email-page__title-block\s*\{[\s\S]*display:\s*none/,
    'Desktop Email must keep the mailbox/open-folder meta line visible.',
  );
  assert.match(emailCss, /--email-status-strip-size:\s*32px/, 'Email status/security strip must keep the compact shared size.');
  assert.match(
    emailCss,
    /--email-action-size:\s*var\(--email-status-strip-size\)/,
    'Email action buttons must derive from the compact strip size, not the other way round.',
  );
  assert.match(emailCss, /--email-action-icon-size:\s*20px/, 'Email action icons must stay prominent inside the compact button outline.');
  assert.match(
    emailCss,
    /@media\s*\(min-width:\s*821px\)[\s\S]*\.email-page__header\s*\{[\s\S]*justify-content:\s*space-between/,
    'Desktop Email header must keep the meta line on the left and actions on the right.',
  );
  assert.match(
    emailCss,
    /\.email-status-strip\s*\{[\s\S]*min-height:\s*var\(--email-status-strip-size\)/,
    'Email status/security strip height must keep its compact natural size.',
  );
  assert.match(
    emailCss,
    /\.email-folder-chip\s*\{[\s\S]*min-height:\s*32px/,
    'Email folder chip must match the message view tab button height.',
  );
  assert.match(
    emailCss,
    /\.email-page__actions\s*>\s*\.email-icon-btn\s*\{[\s\S]*width:\s*var\(--email-action-size\)[\s\S]*height:\s*var\(--email-action-size\)/,
    'Email browse/refresh buttons must match the strip beside them.',
  );
  assert.match(
    emailCss,
    /\.email-icon-btn::before,\s*[\r\n]+\.email-row-btn::before\s*\{[\s\S]*display:\s*block[\s\S]*flex:\s*0\s+0\s+17px/,
    'Email masked icon pseudo-elements must be block-level and resist flex shrink.',
  );
  assert.match(
    emailCss,
    /\.email-page__actions\s*>\s*\.email-icon-btn::before\s*\{[\s\S]*flex:\s*0\s+0\s+var\(--email-action-icon-size\)[\s\S]*width:\s*var\(--email-action-icon-size\)[\s\S]*min-width:\s*var\(--email-action-icon-size\)[\s\S]*height:\s*var\(--email-action-icon-size\)/,
    'Email top action icons must scale with the button outline without flex-shrinking.',
  );
  assert.match(
    emailCss,
    /\.email-icon-btn--folders::before[\s\S]*M3 6a2 2 0 0 1 2-2h5l2 2h7/,
    'Email Browse Folders must reuse the shared filled folder glyph.',
  );
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
  assert.match(appJs, /email:\s*typeof window\.BlueprintsEmailPage\?\.snapshot === 'function'/, 'Active Browser automation reports must include Email snapshot state.');
  assert.match(activeBrowserObserverJs, /const emailSnapshot = typeof window\.BlueprintsEmailPage\?\.snapshot === 'function'/, 'Active Browser observer reports must normalize Email snapshot state.');
  assert.match(activeBrowserObserverJs, /surfaces\.email = emailSnapshot/, 'Active Browser observer must preserve Email surface details in raw reports.');
  assert.match(activeBrowserObserverJs, /message_context_menu_open: !!email\.message_context_menu_open/, 'Active Browser stable keys must notice Email context menu state changes.');
  assert.match(emailJs, /\/local\/health/, 'Email UI must read lightweight local PIM health.');
  assert.match(emailJs, /\/local\/folders/, 'Email UI must list virtual local folders.');
  assert.match(emailJs, /function searchEndpoint\(\)[\s\S]*\/local\/search/, 'Email Search must call the local PIM search endpoint.');
  assert.match(emailJs, /SEARCH_FIELDS = \[[\s\S]*\['from', 'From'\][\s\S]*\['recipients', 'Recipients'\][\s\S]*\['subject', 'Subject'\][\s\S]*\['content', 'Body'\][\s\S]*\['image', 'Images'\][\s\S]*\['sent_at', 'Sent date'\][\s\S]*\['received_at', 'Received date'\]/, 'Email Search must expose production field targeting.');
  assert.match(emailJs, /SEARCH_MODE_OPTIONS = \[[\s\S]*\['simple', 'Simple'\][\s\S]*\['advanced', 'Advanced'\]/, 'Email Search must define simple and advanced modes.');
  assert.match(emailJs, /function searchTabDropdownHtml\([\s\S]*data-email-search-mode-dropdown[\s\S]*data-email-search-mode-option/, 'Email Search mode must live in the secondary split dropdown.');
  assert.match(emailJs, /function setSearchMode\(mode\)/, 'Email Search dropdown options must switch modes through a dedicated setter.');
  assert.match(emailJs, /function syncSearchModeControls\(\)/, 'Email Search mode dropdowns must update visible panels without stale mode labels.');
  assert.doesNotMatch(emailJs, /role="radiogroup" aria-label="Search mode"/, 'Email Search must not keep the old in-panel Simple/Advanced radio group.');
  assert.match(emailJs, /function captureSearchFocus\(\)/, 'Email Search must snapshot focused controls before secondary panel rerenders.');
  assert.match(emailJs, /function restoreSearchFocus\(snapshot\)/, 'Email Search must restore focused controls after background rerenders.');
  assert.match(emailJs, /readSearchForm\(form\);[\s\S]*rootId/, 'Email Search focus snapshots must persist typed values before replacing form DOM.');
  assert.match(emailJs, /searchDateFieldHtml\('received-from', 'Received from'/, 'Email Search received-from date input must have a visible label.');
  assert.match(emailJs, /searchDateFieldHtml\('sent-to', 'Sent to'/, 'Email Search sent-to date input must have a visible label.');
  assert.match(emailJs, /class="email-search-toolbar"[\s\S]*class="email-search-simple"[\s\S]*data-email-search-query[\s\S]*class="email-search-submit"/, 'Simple Email Search must put the query input on the same row as the submit button.');
  assert.match(emailJs, /class="email-search-filter-column"[\s\S]*searchDateFieldHtml\('received-from'[\s\S]*searchDateFieldHtml\('received-to'[\s\S]*class="email-search-filter-column"[\s\S]*searchDateFieldHtml\('sent-from'[\s\S]*searchDateFieldHtml\('sent-to'[\s\S]*email-search-filter-column--source[\s\S]*>Folder<[\s\S]*data-email-search-folder[\s\S]*>Options<[\s\S]*data-email-search-toggle="hybrid"[\s\S]*data-email-search-toggle="rerank"/, 'Email Search filters must render as received, sent, and aligned source/options two-row columns.');
  assert.match(emailJs, /data-email-search-clear-date/, 'Email Search date fields must expose a clear-date button.');
  assert.match(emailJs, /const searchClearDate = target\.closest\?\.\('\[data-email-search-clear-date\]'\)/, 'Email Search clear-date buttons must be handled without submitting the form.');
  assert.match(emailJs, /data-email-search-term-operator[\s\S]*<option value="AND"[\s\S]*<option value="OR"/, 'Advanced Email Search rows must support AND/OR composition.');
  assert.match(emailJs, /data-email-search-toggle="hybrid"[\s\S]*data-email-search-toggle="rerank"/, 'Email Search must expose hybrid and rerank toggles.');
  assert.match(emailJs, /state\.readSource = 'search'/, 'Email Search results must replace the message list source.');
  assert.match(emailJs, /if \(state\.readSource === 'search'\) return loadMoreSearch\(\)/, 'Email Search pagination must use the search endpoint.');
  assert.match(emailJs, /search_elapsed_ms/, 'Email automation snapshot must expose search timing.');
  assert.match(emailJs, /search_total/, 'Email automation snapshot must expose search result totals.');
  assert.match(emailCss, /\.email-search-panel/, 'Email Search controls must have compact panel styling.');
  assert.match(emailCss, /\.email-search-tab-dropdown\[data-active="true"\][\s\S]*\.email-folder-tab/, 'Email Search dropdown must share active tab styling.');
  assert.match(emailCss, /\.email-search-toolbar\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*560px\)\s+auto/, 'Simple Email Search toolbar must reserve a shorter query field beside the submit button.');
  assert.match(emailCss, /\.email-search-filters\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/, 'Email Search filters must use three equal desktop columns.');
  assert.match(emailCss, /\.email-search-filter-column\s*\{[\s\S]*display:\s*grid/, 'Email Search filter columns must stack their two rows.');
  assert.match(emailCss, /\.email-search-date-field,\s*[\r\n]+\.email-search-filter-field\s*\{[\s\S]*display:\s*grid/, 'Email Search source/options rows must share the date field label rhythm.');
  assert.match(emailCss, /\.email-search-date-field > span,\s*[\r\n]+\.email-search-filter-field > span\s*\{[\s\S]*font-size:\s*10px/, 'Email Search date and source/options labels must share compact stacked field styling.');
  assert.match(emailCss, /\.email-search-date-control\s*\{[\s\S]*position:\s*relative/, 'Email Search date controls must have room for an in-field clear button.');
  assert.match(emailCss, /\.email-search-clear-date::before[\s\S]*mask-image/, 'Email Search date clear buttons must use an icon glyph, not visible text.');
  assert.match(emailCss, /\.email-search-simple\[hidden\],[\s\S]*\.email-search-advanced\[hidden\]\s*\{[\s\S]*display:\s*none/, 'Email Search hidden mode panels must stay hidden despite grid display rules.');
  assert.match(emailCss, /\.email-search-row\s*\{[\s\S]*grid-template-columns/, 'Advanced Email Search rows must use stable grid tracks.');
  assert.match(emailCss, /@media\s*\(max-width:\s*820px\)[\s\S]*\.email-search-toolbar,[\s\S]*\.email-search-row,[\s\S]*\.email-search-filters\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/, 'Email Search controls must collapse cleanly on mobile.');
  assert.match(emailJs, /function localCorpusAvailable\(/, 'Email UI must keep local corpus as the integrated page mode.');
  assert.match(emailJs, /\/local\/folder-messages/, 'Email UI must list local folder messages.');
  assert.match(emailJs, /MESSAGE_LIST_LIMIT = 100/, 'Email UI must request the last 100 local messages.');
  assert.doesNotMatch(emailJs, /limit=30/, 'Email UI must not regress to the old 30-message list.');
  assert.match(emailJs, /folderMessagesEndpoint\(selectedFolder\)/, 'Email UI must list the selected folder messages on load.');
  assert.match(emailJs, /folderMessagesEndpoint\(clean\)/, 'Email UI must list any clicked folder.');
  assert.doesNotMatch(emailJs, /\$\{API_ROOT\}\/status/, 'Email UI must not block initial local DB listing on heavyweight status.');
  assert.doesNotMatch(emailJs, /\$\{API_ROOT\}\/folders/, 'Email UI must not list live IMAP folders.');
  assert.doesNotMatch(emailJs, /\$\{API_ROOT\}\/folder-messages/, 'Email UI must not list live IMAP messages.');
  assert.doesNotMatch(emailJs, /\$\{API_ROOT\}\/messages\/\$\{encodeURIComponent\(uid\)\}/, 'Email UI must not open live IMAP messages.');
  assert.doesNotMatch(emailJs, /live IMAP/, 'Email UI copy must not claim live IMAP as the page source.');
  assert.doesNotMatch(emailJs, /Inbox is the only message listing/, 'Email UI must not keep the old Inbox-only folder restraint.');
  assert.doesNotMatch(emailJs, /Only Inbox message opening/, 'Email UI must open messages from the selected folder.');
  assert.match(emailJs, /\/local\/messages\/\$\{encodeURIComponent\(emailUid\)\}/, 'Email UI must open local corpus messages by email_uid.');
  assert.match(emailJs, /role="tree"/, 'Email folders must render as a tree.');
  assert.match(emailJs, /email-health-heartbeat/, 'Email list heading must expose a compact PIM health heartbeat.');
  assert.match(emailCss, /\.email-health-heartbeat--beating/, 'Healthy active PIM work must animate the compact heartbeat.');
  assert.match(emailJs, /return downloadHealthActivity\(\);/, 'Heartbeat animation must mean active IMAP folder checking, not generic health.');
  assert.doesNotMatch(emailJs, /state\.health\?\.healthy \|\| state\.health\?\.activity \|\| downloadHealthActivity\(\)/, 'Generic health/status/cache activity must not drive the green heartbeat.');
  assert.match(emailJs, /checking IMAP folders/, 'Heartbeat copy must describe active IMAP folder checks.');
  assert.match(emailJs, /data-email-folder-menu-toggle="set"/, 'Folder list must render as a split dropdown tab.');
  assert.match(emailJs, /data-email-folder-menu-toggle="group"/, 'Folder group must render as a split dropdown tab.');
  assert.match(emailJs, /data-email-folder-set-option/, 'Folder list dropdown tab must expose menu options.');
  assert.match(emailJs, /data-email-folder-group-option/, 'Folder group dropdown tab must expose menu options.');
  assert.doesNotMatch(emailJs, /<select[^>]+data-email-folder/, 'Folder controls must not regress to native selects.');
  assert.match(emailCss, /\.email-folder-tab-dropdown/, 'Email folder controls must use dropdown-tab styling.');
  assert.match(emailCss, /\.email-folder-tab-split/, 'Email folder controls must use split tab styling.');
  assert.match(emailJs, /exclusiveFolderGroups/, 'Email folders must be grouped by exclusive initial ranges.');
  assert.match(emailJs, /distributeFolderColumns/, 'Selected folder ranges must distribute roots across columns.');
  assert.match(emailJs, /frame\.setAttribute\('sandbox', 'allow-same-origin'\)/, 'HTML email must allow parent-owned diagnostics without allowing email scripts.');
  assert.doesNotMatch(emailJs, /frame\.setAttribute\('sandbox', 'allow-scripts'\)/, 'HTML email iframe must never allow message scripts.');
  assert.match(emailJs, /img-src \$\{escHtml\(imgSources\)\}/, 'HTML email iframe must limit images to data and same-site proxy sources.');
  assert.doesNotMatch(emailJs, /RICH_VIEW_IDS/, 'HTML and Markdown tabs must not be gated by aggregate security colour.');
  assert.doesNotMatch(emailJs, /requires a green message security result/, 'HTML and Markdown tabs must not be disabled for non-green messages.');
  assert.match(emailJs, /button\.disabled = false/, 'Message view tabs must remain selectable after security checks complete.');
  assert.match(emailJs, /html_security/, 'HTML email safety metadata must be surfaced.');
  assert.match(emailJs, /state\.message\?\.security\?\.aggregate/, 'Email UI must consume backend security aggregate results.');
  assert.match(emailJs, /function defaultMessageView\(/, 'Opening a message must choose a security-aware default view.');
  assert.match(emailJs, /views_available/, 'Message default view must distinguish real HTML/Markdown parts from generated fallbacks.');
  assert.match(emailJs, /state\.view = defaultMessageView\(state\.message\)/, 'Opening a message must use the computed default view.');
  assert.match(emailJs, /SECURITY_PROGRESS_EVENT = 'pim\.email\.security\.progress'/, 'Email security progress must use the shared SSE event stream.');
  assert.match(emailJs, /function renderSecurityProgressStrip\(\)/, 'Opened-message status must render compact security progress segments.');
  assert.match(emailJs, /data-email-security-segment/, 'Security progress segments must be clickable controls.');
  assert.match(indexHtml, /id="email-security-segment-modal"/, 'Security segments must open a HubModal detail view.');
  assert.match(emailJs, /function openSecuritySegmentModal\(/, 'Email UI must render segment-specific security insight.');
  assert.match(emailJs, /security_segment_modal_open/, 'Email automation snapshot must expose the segment modal state.');
  assert.match(emailJs, /prompt_variant/, 'Security segment detail must surface the LLM prompt variant.');
  assert.match(emailJs, /probable_trusted_sender/, 'Security segment detail must surface probable-trusted LLM context.');
  assert.match(emailJs, /function renderOpenedMessageSecurityProgress\(/, 'Completed local-message security progress must render after opening a stored message.');
  assert.doesNotMatch(emailJs, /include_safe_raw=true/, 'Local message reads must use the persisted sanitized raw artifact, not an on-read raw generation flag.');
  assert.match(emailJs, /MESSAGE_WARM_LIMIT = 100/, 'The current 100 rows must be sent for background stack warming.');
  assert.match(emailJs, /MESSAGE_OPEN_CACHE_LIMIT = 240/, 'Opened and prefetched messages must have a bounded browser-side payload cache large enough for the recent and next set.');
  assert.match(emailJs, /MESSAGE_OPEN_PREFETCH_LIMIT = 100/, 'Browser body prefetch must target the currently loaded recent 100.');
  assert.match(emailJs, /MESSAGE_OPEN_PREFETCH_CONCURRENCY = 8/, 'Browser body prefetch must prioritize the recent set without waiting on images.');
  assert.match(emailJs, /MESSAGE_IMAGE_PREFETCH_CONCURRENCY = 2/, 'Browser image prefetch must run behind body prefetch with lower concurrency.');
  assert.match(emailJs, /function pauseMessageOpenPrefetch\(/, 'Opening a message must pause background body prefetch so active images get priority.');
  assert.match(emailJs, /controller\.abort\(\)/, 'Background body prefetch must be abortable when the user opens a message.');
  assert.match(emailJs, /MESSAGE_IMAGE_CACHE_LIMIT = 24/, 'Opened HTML messages must keep a bounded browser-side image cache.');
  assert.match(emailJs, /MESSAGE_IMAGE_CACHE_CONCURRENCY = 4/, 'Opened HTML image cache must warm local images concurrently without flooding the page.');
  assert.match(emailJs, /function ensureMessageImageCache\(/, 'HTML message rendering must preload local images into browser memory.');
  assert.match(emailJs, /htmlWithCachedMessageImages\(value, message\)/, 'HTML frame rendering must use cached local image data when available.');
  assert.match(emailJs, /function appendImageOutcomeDetails\(/, 'HTML message rendering must annotate blocked image placeholders with backend worker outcomes.');
  assert.match(emailJs, /querySelectorAll\('\.email-image-blocked'\)/, 'Every blocked image placeholder must be considered for inline diagnostic decoration.');
  assert.match(emailJs, /function imageOriginalForPlaceholder\(/, 'Blocked image diagnostics must work for wrapped and unwrapped original links.');
  assert.match(emailJs, /no worker outcome row is recorded/, 'Blocked image placeholders must still get inline explanations before worker outcome rows exist.');
  assert.match(emailJs, /email-image-error/, 'Blocked image placeholders must expose the exact image worker error inline.');
  assert.match(emailJs, /function imageOutcomeHoverText\(/, 'Inline image errors must expose a descriptive hover explanation.');
  assert.match(emailJs, /Pillow could not decode/, 'Decode failures must explain the underlying image-library gate.');
  assert.match(emailJs, /error_cause_class/, 'Inline image hover text must surface preserved decoder cause class when available.');
  assert.match(emailJs, /tabindex', '0'/, 'Inline image errors must be keyboard-focusable for hover/title inspection.');
  assert.match(emailJs, /function openImageDiagnosticModal\(/, 'Blocked image diagnostics must open a Hub dialog with full details.');
  assert.match(emailJs, /function imageDetailForPlaceholder\(/, 'Blocked image diagnostics must detect pre-existing server-rendered error pills.');
  assert.match(emailJs, /existingDetail\.textContent = text/, 'Pre-existing image error pills must be upgraded into detailed diagnostic triggers.');
  assert.match(emailJs, /data-email-image-diagnostic/, 'Blocked image diagnostics must carry a structured click payload.');
  assert.match(emailJs, /email-image-diagnostic-trigger/, 'Blocked image placeholders and error pills must be clickable diagnostic triggers.');
  assert.match(emailJs, /connectHtmlFrameImageDiagnostics\(frame\)/, 'HTML email frames must wire parent-owned diagnostic click handling.');
  assert.match(emailJs, /doc\.addEventListener\('click'/, 'Blocked image diagnostics must be clickable inside the HTML frame.');
  assert.match(emailJs, /event\.key !== 'Enter' && event\.key !== ' '/, 'Blocked image diagnostics must support keyboard activation.');
  assert.match(emailJs, /Remote Image Blocked/, 'Blocked image diagnostics must use a clear Hub dialog title.');
  assert.match(emailJs, /Blueprints never loads remote email images directly/, 'Blocked image modal detail must explain the local-safe image policy.');
  assert.match(emailJs, /The remote worker received bytes, but the image transform library could not safely open and decode them/, 'Decode modal detail must explain what the safe decode failure means.');
  assert.match(emailJs, /external_image_derivative_summary/, 'Checks view must summarize per-message external image derivative outcomes.');
  assert.match(emailJs, /Image failure reasons/, 'Checks view must show per-message image failure reasons.');
  assert.match(emailJs, /background:#6f1017/, 'Inline image errors must use the dark red highlighted background.');
  assert.match(emailJs, /color:#fff/, 'Inline image errors must use white foreground text.');
  assert.match(emailJs, /function enqueueMessageOpenPrefetch\(/, 'Recent rows must prefetch sanitized message payloads, not only metadata.');
  assert.match(emailJs, /function pumpMessageImagePrefetch\(/, 'Browser image warming must be queued behind message body prefetch.');
  assert.match(emailJs, /function cacheStatusHtml\(/, 'Email UI must render an operator-visible Cache tab.');
  assert.match(emailJs, /\/local\/cache\/status/, 'Cache tab must read stack/proxy cache status.');
  assert.match(emailJs, /message_open_prefetch_completed/, 'Email automation snapshot must expose message body prefetch completion.');
  assert.match(emailJs, /last_message_timing/, 'Email automation snapshot must expose click-to-body timing.');
  assert.match(emailJs, /service_worker_image_cache_count/, 'Email automation snapshot must expose browser CacheStorage image count.');
  assert.match(emailJs, /function clearBrowserImageStorageCache\(/, 'Force refresh must clear persistent browser image storage for that message.');
  assert.match(emailJs, /BP_PIM_EMAIL_CLEAR_IMAGE_CACHE/, 'Force refresh must notify the service worker to evict stale message images.');
  assert.match(emailJs, /message_image_cache_ready/, 'Email automation snapshot must expose opened-message image cache readiness.');
  assert.match(serviceWorkerJs, /PIM_EMAIL_IMAGE_CACHE/, 'Service worker must keep a dedicated PIM Email image cache.');
  assert.match(serviceWorkerJs, /PIM_EMAIL_IMAGE_PATH = '\/api\/v1\/personal\/email\/local\/images\/'/, 'Service worker cache must be scoped to local PIM image routes.');
  assert.match(serviceWorkerJs, /BP_PIM_EMAIL_CLEAR_IMAGE_CACHE/, 'Service worker must accept message-scoped PIM image cache invalidation.');
  assert.match(emailJs, /security_run_id=\$\{encodeURIComponent\(runId\)\}/, 'Message opening must correlate backend progress events with a client run id.');
  assert.doesNotMatch(emailJs, /Message security \$\{status\}/, 'Opened-message status must not render a textual security colour sentence.');
  assert.doesNotMatch(emailJs, /Security \$\{aggregate\.status\}/, 'Message metadata must not duplicate the visible border colour in text.');
  assert.match(emailJs, /function messageSecurityHtml\(\)/, 'Email UI must render detailed per-message security results.');
  assert.match(emailJs, /authenticationResultsHtml/, 'Security detail must include provider Authentication-Results.');
  assert.match(emailJs, /securityFindingsHtml/, 'Security detail must include individual finding codes.');
  assert.match(emailJs, /\/local\/messages\/\$\{encodeURIComponent\(uid\)\}\/security/, 'Local Security action must refresh missing security by email_uid.');
  assert.match(emailJs, /method:\s*'POST'/, 'Local Security action must use the local POST endpoint.');
  assert.doesNotMatch(emailJs, /\$\{API_ROOT\}\/messages\/\$\{encodeURIComponent\(uid\)\}\/security/, 'Security action must not call the live IMAP UID route.');
  assert.match(emailJs, /Email Security/, 'Security modal title must identify the security panel.');
  assert.match(emailCss, /\.email-message-panel\[data-email-security="red"\]/, 'Red security aggregate must tint the reader border.');
  assert.match(emailCss, /\.email-message-panel\[data-email-security="amber"\]/, 'Amber security aggregate must tint the reader border.');
  assert.match(emailCss, /\.email-message-panel\[data-email-security="green"\]/, 'Green security aggregate must tint the reader border.');
  assert.match(emailCss, /\.email-security-meter__segment\[data-tone="red"\]/, 'Status strip segments must show failed checks.');
  assert.match(emailCss, /\.email-security-meter__segment\[data-tone="amber"\]/, 'Status strip segments must show indeterminate checks.');
  assert.match(emailCss, /\.email-security-meter__segment\[data-tone="green"\]/, 'Status strip segments must show passed checks.');
  assert.match(emailCss, /\.email-security-meter__segment:hover/, 'Clickable security segments must expose pointer/focus affordance.');
  assert.match(emailCss, /@keyframes email-security-segment-pulse/, 'Running security checks must have a compact progress animation.');
  assert.match(emailCss, /\.email-security-finding/, 'Security findings must have readable detail styling.');
  assert.match(emailCss, /\.email-security-pill\[data-tone="red"\]/, 'Security failures must be visually distinct.');
  assert.match(emailJs, /function renderRawMessage\(/, 'Raw message view must have a dedicated renderer.');
  assert.match(emailJs, /function formatPlainMessageText\(/, 'Plain view must compact excessive blank lines before display.');
  assert.match(emailJs, /function renderPlainMessage\(/, 'Plain message view must have a dedicated renderer.');
  assert.match(emailJs, /function renderMarkdownMessage\(/, 'Markdown view must have a dedicated renderer.');
  assert.match(emailJs, /function safeMarkdownHref\(/, 'Markdown rendering must constrain rendered image/link hrefs.');
  assert.match(emailJs, /mailto\|tel/, 'Markdown rendering must keep explicit click-only mail and phone links.');
  assert.match(emailJs, /window\.BlueprintsMarkdown\?\.render/, 'Markdown preview must use the shared Blueprints Markdown renderer.');
  assert.match(emailJs, /function sanitizeEmailMarkdownPreview\(/, 'Email Markdown preview must post-process shared renderer output for email-safe links/images.');
  assert.doesNotMatch(emailJs, /function markdownToHtml\(/, 'Email must not keep a separate table-blind Markdown renderer.');
  assert.match(emailJs, /email-markdown-image/, 'Markdown rendering must preserve local image display.');
  assert.match(emailCss, /\.email-markdown-image/, 'Markdown images must have readable responsive styling.');
  assert.match(emailCss, /\.email-markdown-view\s+\.rich-md-table/, 'Markdown tables must be styled inside the email preview.');
  assert.match(emailCss, /\.email-markdown-raw/, 'Raw Markdown mode must have readable styling.');
  assert.match(emailCss, /\.email-message-content pre\.email-plain-view/, 'Plain view must have readable message-text styling.');
  assert.match(emailJs, /rawSecuritySignals/, 'Raw view must use security findings for line highlighting.');
  assert.match(emailCss, /\.email-raw-line\[data-tone="red"\]/, 'Raw view must style failed security evidence.');
  assert.match(emailCss, /\.email-raw-line\[data-tone="amber"\]/, 'Raw view must style indeterminate security evidence.');
  assert.match(emailCss, /\.email-raw-line\[data-tone="green"\]/, 'Raw view must style passed security evidence.');
  assert.doesNotMatch(emailJs, /delete-message|remove-message|message-delete/i, 'Email UI must not expose message delete capability.');
  assert.doesNotMatch(`${indexHtml}\n${daveMenuJs}\n${emailJs}`, /data-email-action="(?:send|delete)"/, 'Email UI must not expose send/delete actions.');
  assert.doesNotMatch(emailJs, /smtp-self-test/, 'SMTP proof must not be a general UI action.');
});

test('PIM Email message list refreshes only on list data changes', () => {
  const healthStart = emailJs.indexOf('async function refreshHealth');
  const healthEnd = emailJs.indexOf('function ensureHealthPoll', healthStart);
  assert.notEqual(healthStart, -1, 'refreshHealth must exist.');
  const healthSlice = emailJs.slice(healthStart, healthEnd);

  assert.match(emailJs, /function renderMessageListChrome\(/, 'Email UI must split list chrome from list row rendering.');
  assert.doesNotMatch(healthSlice, /renderMessages\(/, 'Health polling must not rebuild message rows.');
  assert.match(healthSlice, /renderMessageListChrome\(\)/, 'Health polling may refresh heartbeat/count chrome.');
  assert.match(emailJs, /function captureMessageListAnchor\(/, 'Explicit list refreshes must capture scroll anchors.');
  assert.match(emailJs, /function restoreMessageListAnchor\(/, 'Explicit list refreshes must restore scroll anchors.');
  assert.match(emailJs, /function syncSelectedMessageRows\(/, 'Opening a message must update row selection without rebuilding the list.');
  assert.match(emailJs, /MESSAGE_PREFETCH_AHEAD = 100/, 'Infinite-scroll prefetch should keep about 100 next rows in view.');
  assert.match(emailJs, /function scheduleMessagePagePrefetch\(/, 'Email UI must prefetch the next metadata page before the scroll boundary.');
  assert.match(emailJs, /takePrefetchedMessagePage\(folder, offset\)/, 'Infinite scroll must consume prefetched metadata before issuing another fetch.');
  assert.match(emailJs, /\/local\/cache\/warm/, 'Email UI must warm sanitized source artifacts through the local cache endpoint.');
  assert.match(emailJs, /function staleHealthErrorVisible\(/, 'Email health polling must detect stale visible stack-unavailable errors.');
  assert.match(emailJs, /Email health restored/, 'Successful silent health polling must clear stale stack-unavailable status.');
  assert.match(emailJs, /function isMessagePayload\(/, 'Force refresh must distinguish a full message object from a status string response.');
  assert.match(emailJs, /isMessagePayload\(data\.message\)/, 'Force refresh must refetch the message detail when the refresh result only includes a status message.');
  assert.match(emailJs, /HEALTH_POLL_MS = 15000/, 'Email health polling must avoid old 5s ambient stack/API polling pressure.');
  assert.match(emailJs, /CACHE_STATUS_POLL_MS = 30000/, 'Email cache-status polling must avoid old 5s ambient status polling pressure.');
  assert.match(emailJs, /state\.secondaryTab === 'cache' \|\| cacheAge >= CACHE_STATUS_POLL_MS/, 'Cache status polling must be eager only while the Cache tab is open.');
  assert.match(emailJs, /message_prefetch_ready/, 'Email automation snapshot must expose metadata prefetch readiness.');
  assert.match(emailJs, /offset=\$\{offset\}/, 'Folder message fetches must support offset pagination.');
  assert.match(emailJs, /function loadMoreMessages\(/, 'Email UI must append the next page near the list bottom.');
});

test('PIM Email folder changes retain message and artifact caches', () => {
  const start = emailJs.indexOf('async function loadFolderMessages');
  const end = emailJs.indexOf('async function loadMoreMessages', start);
  assert.notEqual(start, -1, 'loadFolderMessages must exist.');
  const slice = emailJs.slice(start, end);

  assert.match(slice, /state\.messages = \[\]/, 'Folder changes may reset visible row data.');
  assert.match(slice, /resetMessagePrefetchQueues\(\)/, 'Folder changes may reset list/body prefetch queues.');
  assert.doesNotMatch(slice, /state\.messageOpenCache\.clear\(/, 'Folder changes must not clear opened-message payload cache.');
  assert.doesNotMatch(slice, /state\.messageImageCache\.clear\(/, 'Folder changes must not clear browser image memory cache.');
  assert.doesNotMatch(slice, /clearBrowserImageStorageCache\(/, 'Folder changes must not clear service-worker image cache.');
  assert.doesNotMatch(slice, /invalidateOpenedMessageCache\(/, 'Folder changes must not invalidate message-scoped opened cache entries.');
});

test('PIM Email message context menu is shared by the list toggle and message rows', () => {
  assert.doesNotMatch(bodyShadeJs, /BodyShadeContextMenuHooks/, 'Email message actions must not hook the top Body Shade handle.');
  assert.match(indexHtml, /data-email-list-toggle/, 'The message reader list toggle must exist.');
  assert.match(emailJs, /function installMessageContextToggleFsm\(/, 'The list toggle must own a long-press FSM.');
  assert.match(emailJs, /function installMessageRowContextFsm\(/, 'Message rows must support the same long-press context menu.');
  assert.match(emailJs, /MESSAGE_CONTEXT_LONG_PRESS_MS/, 'The long-press FSM must have built-in timing.');
  assert.match(emailJs, /openMessageContextMenuAt\(button\)/, 'The list toggle FSM must open the message context menu.');
  assert.match(emailJs, /openMessageContextMenuForRow\(row\)/, 'The row FSM must open the shared message context menu.');
  assert.match(emailJs, /emailContextSuppressClick/, 'Long-press context opens must suppress the follow-up click.');
  assert.match(emailJs, /hub-context-menu-floating--columns/, 'The message context menu must use the shared 3-column context-menu layout.');
  assert.match(emailJs, /force-refresh-message/, 'The first message context command must be Force refresh.');
  assert.match(emailJs, /\/local\/messages\/\$\{encodeURIComponent\(uid\)\}\/force-refresh/, 'Force refresh must call the local safe refresh endpoint.');
  assert.match(emailJs, /mark-sender-probable-trusted/, 'The context menu must expose probable-trusted sender marking.');
  assert.match(emailJs, /show-message-uid/, 'The context menu must expose message email_uid copy/show.');
  assert.match(emailJs, /selectedMessageUids:\s*new Set/, 'Message rows must track multi-select state.');
  assert.match(emailJs, /data-email-message-select/, 'Message rows must use checkbox selectors for multi-select.');
  assert.match(emailJs, /class="hub-checkbox email-row-select"/, 'Message row selection must use the shared hub checkbox convention.');
  assert.doesNotMatch(emailJs, /email-row-btn--open/, 'Message row arrow open buttons must be replaced by checkbox selectors.');
  assert.match(emailJs, /copy-selected-message-uids/, 'Multi-message context menus must expose only multi-capable UID copy.');
  assert.match(emailJs, /const multi = targetUids\.length > 1/, 'Context action rendering must branch on multi-selection.');
  assert.match(emailJs, /toggle-original-image-buttons/, 'The message context menu must expose original-button visibility.');
  assert.match(emailJs, /ORIGINAL_IMAGE_BUTTONS_STORAGE_KEY/, 'Original-button visibility must persist locally.');
  assert.match(emailJs, /getItem\(ORIGINAL_IMAGE_BUTTONS_STORAGE_KEY\) === 'true'/, 'Sanitized HTML original buttons must be hidden by default.');
  assert.match(emailJs, /email-image-original \{ display:none !important; \}/, 'The HTML iframe must hide original buttons when toggled off.');
  assert.match(emailJs, /toggle-markdown-preview/, 'The message context menu must expose Markdown raw/preview mode.');
  assert.match(emailJs, /MARKDOWN_PREVIEW_STORAGE_KEY/, 'Markdown raw/preview mode must persist locally.');
  assert.match(emailJs, /render_markdown_preview/, 'Email automation snapshot must expose Markdown raw/preview mode.');
  assert.match(emailJs, /navigator\.clipboard\.writeText/, 'The email_uid command must use the clipboard when available.');
  assert.match(emailJs, /\/local\/messages\/\$\{encodeURIComponent\(uid\)\}\/probable-trusted-sender/, 'Probable-trusted sender action must call the local mark-and-requeue endpoint.');
  assert.match(emailJs, /function waitForProbableTrustedSecurityResult\(/, 'Probable-trusted action must wait for the rechecked LLM result before replacing the opened message.');
  assert.match(emailJs, /messageHasProbableTrustedSecurity/, 'Probable-trusted action must detect the prompt-policy result, not merely the requeue response.');
  assert.match(emailJs, /security LLM complete/, 'Probable-trusted action must tell the operator when the rechecked LLM result has landed.');
  assert.match(
    emailCss,
    /\.email-page__actions\s*>\s*\.email-icon-btn\s*\{[\s\S]*width:\s*var\(--email-action-size\)[\s\S]*height:\s*var\(--email-action-size\)/,
    'Header folder/refresh icon buttons must match the adjacent strip.',
  );
  assert.match(
    emailCss,
    /\.email-page__actions\s*>\s*\.email-icon-btn::before\s*\{[\s\S]*width:\s*var\(--email-action-icon-size\)[\s\S]*height:\s*var\(--email-action-icon-size\)/,
    'Header folder/refresh glyphs must scale with the button outline.',
  );
});

test('PIM Email Trusted tab is stack-backed and editable', () => {
  assert.match(emailJs, /trustedProbableSendersEndpoint/, 'Email UI must centralize the trusted sender API endpoint.');
  assert.match(emailJs, /\/local\/trusted\/probable-senders/, 'Trusted tab must call the local stack-backed probable sender API.');
  assert.match(emailJs, /function trustedSendersHtml\(/, 'Trusted tab must render a panel body.');
  assert.match(emailJs, /data-email-trusted-tab="probable"/, 'Trusted tab must use nested tabs with probable senders first.');
  assert.match(emailJs, /data-email-trusted-add-form/, 'Trusted tab must expose an add form.');
  assert.match(emailJs, /data-email-trusted-remove/, 'Trusted tab must expose sender removal controls.');
  assert.match(emailJs, /refreshTrustedSenders\(\{ silent: true \}\)/, 'Opening Trusted must fetch sender rows without blocking the tab render.');
  assert.match(emailJs, /trusted_sender_count/, 'Email automation snapshot must expose trusted sender count.');
  assert.match(emailJs, /function trustedAddLayoutSnapshot\(/, 'Email automation snapshot must measure trusted add form layout.');
  assert.match(emailJs, /trusted_add_layout:\s*trustedAddLayoutSnapshot\(\)/, 'Email automation snapshot must expose trusted add form layout.');
  assert.match(activeBrowserObserverJs, /trusted_add_layout/, 'Active Browser stable reports must include trusted add form layout.');
  assert.match(emailCss, /\.email-trusted-panel/, 'Trusted panel must have dedicated styling.');
  assert.match(emailCss, /\.email-trusted-row/, 'Trusted sender rows must have dedicated styling.');
  assert.match(
    emailCss,
    /\.email-trusted-add\s*\{[\s\S]*display:\s*flex/,
    'Trusted add form must use flex so the Add button cannot be collapsed into a grid row.',
  );
  assert.match(
    emailCss,
    /\.email-trusted-add\s*>\s*input\[type="email"\]\s*\{[\s\S]*flex:\s*1\s+1\s+0[\s\S]*width:\s*auto/,
    'Trusted add input must override generic modal full-width inputs while leaving room for Add.',
  );
  assert.match(
    emailCss,
    /\.email-modal\s+\.email-trusted-add\s*>\s*input\[type="email"\]/,
    'Trusted add input must outrank the later generic Hub modal input rule.',
  );
  assert.match(
    emailCss,
    /\.email-trusted-add button\s*\{[\s\S]*flex:\s*0\s+0\s+auto[\s\S]*white-space:\s*nowrap/,
    'Trusted add button must keep its intrinsic Add width beside the input.',
  );
  assert.doesNotMatch(
    emailCss,
    /@media\s*\(max-width:\s*820px\)[\s\S]*\.email-trusted-add,\s*\.email-trusted-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    'Trusted add form must not be collapsed with stacked trusted-sender rows.',
  );
});
