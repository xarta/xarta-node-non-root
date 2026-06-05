import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cssDir = path.resolve(here, '../css');

function readCss(file) {
  return fs.readFileSync(path.join(cssDir, file), 'utf8');
}

function rules(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  const pattern = /([^{}]+)\{([^{}]+)\}/gm;
  let match;
  while ((match = pattern.exec(withoutComments)) !== null) {
    found.push({
      selectors: match[1].split(',').map(selector => selector.trim()),
      body: match[2],
    });
  }
  return found;
}

function ruleFor(css, selector) {
  const match = rules(css).find(rule => rule.selectors.includes(selector));
  assert.ok(match, `expected rule for ${selector}`);
  return match.body;
}

function combinedRulesFor(css, selector) {
  const bodies = rules(css)
    .filter(rule => rule.selectors.includes(selector))
    .map(rule => rule.body);
  assert.ok(bodies.length, `expected at least one rule for ${selector}`);
  return bodies.join('\n');
}

function assertSelectAffordance(file, selector) {
  const css = readCss(file);
  const rule = combinedRulesFor(css, selector);
  assert.match(rule, /background-image\s*:\s*url\(/, `${selector} must keep a visible chevron`);
  assert.match(rule, /appearance\s*:\s*none/, `${selector} should own native appearance reset`);
  assert.match(rule, /padding-right\s*:/, `${selector} needs room for the chevron`);
}

function assertNoBackgroundShorthand(file, selector) {
  const css = readCss(file);
  const rule = ruleFor(css, selector);
  assert.doesNotMatch(
    rule,
    /(?:^|[;\n\r])\s*background\s*:/,
    `${selector} must use background-color, not background shorthand, so it does not erase the chevron`
  );
}

assertNoBackgroundShorthand('voice-mode.css', '.voice-mode-form-grid select');
assertSelectAffordance('voice-mode.css', '.voice-mode-form-grid select');
assertSelectAffordance('wake-dev.css', '.wake-dev-form select');
assertSelectAffordance('hub-modal.css', '.hub-modal-body select');
assertSelectAffordance('hub-controls.css', 'select.hub-ctrl');

console.log('select chevron CSS tests passed');
