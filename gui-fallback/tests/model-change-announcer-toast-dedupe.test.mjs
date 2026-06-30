import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const MODEL_CHANGE_ANNOUNCER_JS = new URL('../js/model-change-announcer.js', import.meta.url);

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

class TestElement {
  constructor(tagName) {
    this.tagName = String(tagName || '').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.textContent = '';
    this._listeners = new Map();
    const classes = new Set();
    this.classList = {
      add: (...items) => items.forEach(item => classes.add(String(item))),
      remove: (...items) => items.forEach(item => classes.delete(String(item))),
      contains: item => classes.has(String(item)),
    };
  }

  get firstChild() {
    return this.children[0] || null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') this.id = String(value);
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  addEventListener(type, fn) {
    const list = this._listeners.get(type) || [];
    list.push(fn);
    this._listeners.set(type, list);
  }

  querySelector() {
    return null;
  }
}

function createDocument() {
  const listeners = new Map();
  const body = new TestElement('body');

  function findById(node, id) {
    if (!node) return null;
    if (node.id === id) return node;
    for (const child of node.children || []) {
      const found = findById(child, id);
      if (found) return found;
    }
    return null;
  }

  return {
    body,
    createElement(tagName) {
      return new TestElement(tagName);
    },
    getElementById(id) {
      return findById(body, id);
    },
    addEventListener(type, fn) {
      const list = listeners.get(type) || [];
      list.push(fn);
      listeners.set(type, list);
    },
    dispatchEvent(event) {
      for (const fn of listeners.get(event.type) || []) fn(event);
      return true;
    },
  };
}

async function createHarness(options = {}) {
  const source = await readFile(MODEL_CHANGE_ANNOUNCER_JS, 'utf8');
  const document = createDocument();
  const setTimeoutUnref = (fn, ms, ...args) => {
    const timer = setTimeout(fn, ms, ...args);
    timer.unref?.();
    return timer;
  };
  const context = {
    console,
    Array,
    Date,
    JSON,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    Map,
    document,
    localStorage: createStorage(),
    clearTimeout,
    setTimeout: setTimeoutUnref,
    requestAnimationFrame(fn) {
      fn();
      return 1;
    },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
  };
  if (options.asyncToastPolicy) {
    context.BlueprintsNotifierDnd = {
      async loadConfig() {
        await Promise.resolve();
        return {};
      },
      shouldShowToast() {
        return true;
      },
      normalizeToastCategory(category) {
        return String(category || 'unknown_other');
      },
      toastCategoryForEvent() {
        return 'unknown_other';
      },
    };
  }
  context.window = context;
  vm.runInNewContext(source, context, { filename: MODEL_CHANGE_ANNOUNCER_JS.pathname });
  return context;
}

function toastCount(context) {
  return context.document.getElementById('bp-event-toasts')?.children.length || 0;
}

function dispatchOffline(context, eventId) {
  context.document.dispatchEvent(new context.CustomEvent('blueprints:event', {
    detail: {
      event_id: eventId,
      event_type: 'local.llm.offline',
      title: 'Local LLM Offline',
      message: 'Local Large Language Model is offline.',
      severity: 'error',
      created_at: Date.now() / 1000,
      payload: {},
    },
  }));
}

function dispatchWarning(context, eventId, eventType) {
  context.document.dispatchEvent(new context.CustomEvent('blueprints:event', {
    detail: {
      event_id: eventId,
      event_type: eventType,
      title: 'Shared Warning',
      message: 'This warning body is identical.',
      severity: 'warning',
      created_at: Date.now() / 1000,
      payload: {},
    },
  }));
}

function dispatchDirectWarning(context, eventId) {
  context.document.dispatchEvent(new context.CustomEvent('blueprints:event', {
    detail: {
      event_id: eventId,
      event_type: 'blueprints.active_browser.command',
      title: 'Direct Warning',
      message: 'Async policy should not allow duplicates.',
      severity: 'warning',
      created_at: Date.now() / 1000,
      payload: { action: 'refresh' },
    },
  }));
}

function dispatchKeyedWarning(context, eventId, message) {
  context.document.dispatchEvent(new context.CustomEvent('blueprints:event', {
    detail: {
      event_id: eventId,
      event_type: 'security.public_exposure.warning',
      title: 'Public Exposure Guard Failed',
      message,
      severity: 'error',
      created_at: Date.now() / 1000,
      payload: {
        notification_key: 'security.public_exposure.warning',
      },
    },
  }));
}

async function testIdenticalOfflineWarningsDedupeAcrossEventIds() {
  const context = await createHarness();
  dispatchOffline(context, 'offline-1');
  dispatchOffline(context, 'offline-2');

  assert.equal(
    toastCount(context),
    1,
    'Distinct local.llm.offline event IDs with identical content must render one visible toast.',
  );
  assert.equal(
    context.BlueprintsModelChangeAnnouncer.getQueueLength(),
    0,
    'Duplicate offline warning must not remain queued after the first toast is visible.',
  );

  await Promise.resolve();
  await Promise.resolve();
  dispatchOffline(context, 'offline-3');

  assert.equal(
    toastCount(context),
    1,
    'Recently shown identical local.llm.offline warnings must remain suppressed during reconnect bursts.',
  );
}

async function testIdenticalWarningsDedupeAcrossEventTypes() {
  const context = await createHarness();
  dispatchWarning(context, 'warning-1', 'custom.warning.one');
  dispatchWarning(context, 'warning-2', 'custom.warning.two');

  assert.equal(
    toastCount(context),
    1,
    'Distinct warning event types with identical visible warning content must render one toast.',
  );
  assert.equal(
    context.BlueprintsModelChangeAnnouncer.getQueueLength(),
    0,
    'Duplicate visible warning content must not stay queued under a different event type.',
  );
}

async function testDirectWarningDedupeWhilePolicyLoads() {
  const context = await createHarness({ asyncToastPolicy: true });
  dispatchDirectWarning(context, 'direct-1');
  dispatchDirectWarning(context, 'direct-2');

  assert.equal(
    toastCount(context),
    0,
    'Async toast policy should keep the first direct warning pending before render.',
  );

  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(
    toastCount(context),
    1,
    'Direct warning toasts with identical content must dedupe even while toast policy is loading.',
  );
}

async function testExplicitNotificationKeyDedupeBeatsChangingText() {
  const context = await createHarness();
  dispatchKeyedWarning(context, 'keyed-1', 'Public exposure guard failed: 1 issue.');
  dispatchKeyedWarning(context, 'keyed-2', 'Public exposure guard failed: 2 issues.');

  assert.equal(
    toastCount(context),
    1,
    'A stable notification_key must dedupe the same warning identity even when occurrence text changes.',
  );
  assert.equal(
    context.BlueprintsModelChangeAnnouncer.getQueueLength(),
    0,
    'Duplicate notification_key warnings must not remain queued.',
  );
}

await testIdenticalOfflineWarningsDedupeAcrossEventIds();
await testIdenticalWarningsDedupeAcrossEventTypes();
await testDirectWarningDedupeWhilePolicyLoads();
await testExplicitNotificationKeyDedupeBeatsChangingText();

console.log('model-change-announcer toast dedupe tests passed');
