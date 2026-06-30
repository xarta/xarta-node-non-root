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
  assert.match(indexHtml, /id="email-secondary-modal"/, 'Mobile and fallback folder actions must use a HubModal.');
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
    'email.safeChecks',
  ]) {
    assert.ok(daveMenuJs.includes(`fn: '${fn}'`) || emailJs.includes(`'${fn}'`), `${fn} must be wired.`);
  }
  assert.match(appJs, /tab === 'email'[\s\S]*BlueprintsEmailPage\.load\(\)/, 'switchTab must lazy-load Email.');
  assert.match(emailJs, /\/status/, 'Email UI must read middleware status.');
  assert.match(emailJs, /\/folders/, 'Email UI must list folders.');
  assert.match(emailJs, /\/inbox\?limit=30/, 'Email UI must list Inbox messages.');
  assert.match(emailJs, /\/messages\/\$\{encodeURIComponent\(cleanUid\)\}/, 'Email UI must open messages by UID.');
  assert.doesNotMatch(emailJs, /\bmethod:\s*['"]DELETE['"]/, 'Email UI must not expose delete capability.');
  assert.doesNotMatch(`${indexHtml}\n${daveMenuJs}\n${emailJs}`, /data-email-action="(?:send|delete)"/, 'Email UI must not expose send/delete actions.');
  assert.doesNotMatch(emailJs, /smtp-self-test/, 'SMTP proof must not be a general UI action.');
});
