import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const selectorSource = readFileSync(
  path.resolve(here, '../embed/blueprints-node-selector.js'),
  'utf8',
);

const functionStart = selectorSource.indexOf('  function shouldUseTouchRibbonMode()');
const functionEnd = selectorSource.indexOf('\n  function renderActionButtonHtml', functionStart);
assert.notEqual(functionStart, -1, 'Selector ribbon mode function must exist.');
assert.notEqual(functionEnd, -1, 'Selector ribbon mode function must have a stable boundary.');

const ribbonModeFactory = new Function(
  'window',
  'navigator',
  'document',
  'SELECTOR_CFG',
  `${selectorSource.slice(functionStart, functionEnd)}
return shouldUseTouchRibbonMode;`,
);

function shouldUseRibbon({
  width,
  height,
  mode = 'auto',
  maxShortEdge,
  maxTouchPoints = 0,
  primaryCoarse = false,
  anyCoarse = false,
  hoverNone = false,
  anyHoverNone = false,
  specialMode = '',
}) {
  const mediaMatches = new Map([
    ['(pointer: coarse)', primaryCoarse],
    ['(any-pointer: coarse)', anyCoarse],
    ['(hover: none)', hoverNone],
    ['(any-hover: none)', anyHoverNone],
  ]);
  const window = {
    innerWidth: width,
    innerHeight: height,
    matchMedia: query => ({ matches: mediaMatches.get(query) === true }),
  };
  const navigator = { maxTouchPoints };
  const document = {
    documentElement: {
      dataset: specialMode ? { specialUiMode: specialMode } : {},
    },
  };
  const config = {
    touchRibbonMode: mode,
    ...(maxShortEdge === undefined ? {} : { touchRibbonMaxShortEdge: maxShortEdge }),
  };
  return ribbonModeFactory(window, navigator, document, config)();
}

assert.equal(
  shouldUseRibbon({
    width: 1920,
    height: 919,
    maxTouchPoints: 10,
    primaryCoarse: false,
    anyCoarse: true,
  }),
  false,
  'Sherlock Chrome/CachyOS must keep paging mode on its hybrid touchscreen viewport.',
);

assert.equal(
  shouldUseRibbon({
    width: 1874,
    height: 968,
    maxTouchPoints: 10,
    primaryCoarse: false,
    anyCoarse: true,
  }),
  false,
  'Sherlock Edge/Windows must keep paging mode.',
);

for (const [label, width, height] of [
  ['S25 portrait', 412, 891],
  ['S25 landscape', 843, 381],
  ['phone boundary', 500, 900],
]) {
  assert.equal(
    shouldUseRibbon({
      width,
      height,
      maxTouchPoints: 10,
      primaryCoarse: true,
      anyCoarse: true,
      hoverNone: true,
      anyHoverNone: true,
    }),
    true,
    `${label} must use touch ribbon mode.`,
  );
}

assert.equal(
  shouldUseRibbon({
    width: 501,
    height: 900,
    maxTouchPoints: 10,
    primaryCoarse: true,
    anyCoarse: true,
    hoverNone: true,
  }),
  false,
  'Auto ribbon mode must stop above the 500px phone short-edge boundary.',
);

assert.equal(
  shouldUseRibbon({
    width: 412,
    height: 891,
  }),
  false,
  'A narrow non-touch browser must keep paging mode.',
);

assert.equal(
  shouldUseRibbon({
    width: 1920,
    height: 919,
    mode: 'on',
  }),
  true,
  'The explicit ribbon-on override must remain available.',
);

assert.equal(
  shouldUseRibbon({
    width: 412,
    height: 891,
    mode: 'off',
    maxTouchPoints: 10,
    primaryCoarse: true,
  }),
  false,
  'The explicit ribbon-off override must remain available.',
);
