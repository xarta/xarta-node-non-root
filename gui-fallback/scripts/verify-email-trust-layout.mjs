import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const playwrightModule = process.env.PLAYWRIGHT_MODULE || '/srv/playwright-control/node_modules/playwright';
const { chromium } = require(playwrightModule);

const BASE_URL = process.env.BLUEPRINTS_EMAIL_URL || '';
const API_SECRET = process.env.BLUEPRINTS_API_SECRET || '';
const SCREENSHOT_DIR = process.env.BLUEPRINTS_LAYOUT_SCREENSHOT_DIR || '/data/output';
const TICK_COUNT = Number(process.env.BLUEPRINTS_LAYOUT_TICKS || 8);
const TICK_MS = Number(process.env.BLUEPRINTS_LAYOUT_TICK_MS || 250);

const VIEWPORTS = [
  { name: 'desktop-portrait-active', width: 1034, height: 1810, surface: 'bottom' },
  { name: 'desktop-portrait-1007', width: 1007, height: 1500, surface: 'bottom' },
  { name: 'desktop-portrait-breakpoint-high', width: 821, height: 1180, surface: 'bottom' },
  { name: 'mobile-modal-breakpoint-low', width: 820, height: 1180, surface: 'modal' },
  { name: 'mobile-modal-phone', width: 411, height: 891, surface: 'modal' },
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function measure(page, label, surface) {
  return page.evaluate(({ label, surface }) => {
    const selector = surface === 'modal'
      ? '#email-secondary-modal-body .email-trusted-add'
      : '#email-secondary-bottom-body .email-trusted-add';
    const form = document.querySelector(selector);
    const input = form?.querySelector('input');
    const button = form?.querySelector('button');
    const rect = node => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      const round = value => Math.round(Number(value || 0) * 100) / 100;
      return {
        x: round(r.x),
        y: round(r.y),
        width: round(r.width),
        height: round(r.height),
        top: round(r.top),
        right: round(r.right),
        bottom: round(r.bottom),
        left: round(r.left),
      };
    };
    const formRect = rect(form);
    const inputRect = rect(input);
    const buttonRect = rect(button);
    const formStyle = form ? getComputedStyle(form) : null;
    const buttonStyle = button ? getComputedStyle(button) : null;
    const sameRow = !!(inputRect && buttonRect && Math.abs(inputRect.top - buttonRect.top) <= 2);
    const buttonDropped = !!(inputRect && buttonRect && buttonRect.top > inputRect.bottom - 2);
    const inputOverflowsForm = !!(formRect && inputRect && inputRect.right > formRect.right + 1);
    const buttonOverflowsForm = !!(formRect && buttonRect && buttonRect.right > formRect.right + 1);
    const snapshot = window.BlueprintsEmailPage?.snapshot?.() || {};
    const snapshotLayout = snapshot.trusted_add_layout || null;
    return {
      label,
      surface,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
      frontend: window.BLUEPRINTS_FRONTEND_VERSION || null,
      secondary_tab: snapshot.secondary_tab || '',
      trusted_sender_count: snapshot.trusted_sender_count ?? null,
      form: formRect,
      input: inputRect,
      button: buttonRect,
      form_display: formStyle?.display || '',
      form_columns: formStyle?.gridTemplateColumns || '',
      button_display: buttonStyle?.display || '',
      button_width: buttonRect?.width || 0,
      same_row: sameRow,
      button_dropped: buttonDropped,
      input_overflows_form: inputOverflowsForm,
      button_overflows_form: buttonOverflowsForm,
      snapshot_same_row: snapshotLayout?.same_row ?? null,
      snapshot_button_dropped: snapshotLayout?.button_dropped ?? null,
      snapshot_input_overflows_form: snapshotLayout?.input_overflows_form ?? null,
      snapshot_button_overflows_form: snapshotLayout?.button_overflows_form ?? null,
      snapshot_active_surface: snapshotLayout?.active_surface || '',
    };
  }, { label, surface });
}

async function openTrustSurface(page, targetSurface) {
  await page.waitForSelector('#tab-email.active', { timeout: 30000 });
  await page.waitForFunction(() => window.BlueprintsEmailPage?.snapshot?.().loaded === true, {
    timeout: 45000,
  }).catch(() => {});

  if (targetSurface === 'modal') {
    await page.click('[data-email-action="browse-folders"]');
    await page.waitForSelector('#email-secondary-modal[open], #email-secondary-modal.hub-modal--open', {
      timeout: 30000,
    }).catch(() => {});
    await page.click('#email-secondary-modal [data-email-secondary-tab="trusted"]');
    await page.waitForSelector('#email-secondary-modal-body .email-trusted-add', { timeout: 30000 });
    return;
  }

  await page.waitForSelector('.email-secondary-under-panel [data-email-secondary-tab="trusted"]', {
    timeout: 30000,
  });
  await page.click('.email-secondary-under-panel [data-email-secondary-tab="trusted"]');
  await page.waitForSelector('#email-secondary-bottom-body .email-trusted-add', { timeout: 30000 });
}

async function runViewport(browser, config) {
  const context = await browser.newContext({
    viewport: { width: config.width, height: config.height },
    ignoreHTTPSErrors: false,
  });
  if (API_SECRET) {
    await context.addInitScript(secret => {
      window.localStorage.setItem('blueprints_api_secret', secret);
    }, API_SECRET);
  }
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await openTrustSurface(page, config.surface);

  const samples = [];
  samples.push(await measure(page, 'after-open', config.surface));
  for (let index = 0; index < TICK_COUNT; index += 1) {
    await sleep(TICK_MS);
    samples.push(await measure(page, `tick-${index + 1}`, config.surface));
  }
  await page.setViewportSize({ width: config.width, height: config.height });
  await sleep(TICK_MS);
  samples.push(await measure(page, 'after-same-size-resize', config.surface));

  const failures = samples.filter(sample => (
    !sample.same_row
    || sample.button_dropped
    || sample.input_overflows_form
    || sample.button_overflows_form
    || sample.snapshot_same_row === false
    || sample.snapshot_button_dropped === true
    || sample.snapshot_input_overflows_form === true
    || sample.snapshot_button_overflows_form === true
  ));
  const screenshotPath = path.join(SCREENSHOT_DIR, `email-trust-layout-${config.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await context.close();
  return {
    ...config,
    ok: failures.length === 0,
    failure_count: failures.length,
    screenshot_path: screenshotPath,
    samples,
    failures,
  };
}

async function main() {
  if (!API_SECRET) {
    throw new Error('BLUEPRINTS_API_SECRET is required for the deployed Email page guard.');
  }
  if (!BASE_URL) {
    throw new Error('BLUEPRINTS_EMAIL_URL is required for the deployed Email page guard.');
  }
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const results = [];
    for (const viewport of VIEWPORTS) {
      results.push(await runViewport(browser, viewport));
    }
    const failures = results.flatMap(result => result.failures.map(failure => ({
      viewport: result.name,
      ...failure,
    })));
    const report = {
      ok: failures.length === 0,
      url: BASE_URL,
      viewport_count: results.length,
      failures,
      results,
    };
    console.log(JSON.stringify(report, null, 2));
    if (failures.length) process.exitCode = 2;
  } finally {
    await browser.close();
  }
}

await main();
