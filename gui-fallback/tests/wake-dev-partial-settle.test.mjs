import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const WAKE_DEV_JS = new URL('../js/wake-dev.js', import.meta.url);

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function baseSettings(overrides = {}) {
  return {
    instances: {
      local: {
        enabled: true,
        label: 'hermes-local',
        matrix_server: 'tb1',
        matrix_room_id: '',
        wake_word: 'Computer',
        wake_aliases: ['computer'],
        hermes_prefix: 'hermes: ',
        auto_execute_silence_ms: 0,
        execute_cancel_ms: 0,
        partial_settle_ms: 0,
        commands: {
          pause: 'pause-dictation',
          execute: 'execute',
          resume: 'resume-dictation',
          cancel: 'cancel-dictation',
        },
        ...(overrides.local || {}),
      },
      vps: {
        enabled: true,
        label: 'hermes-VPS',
        matrix_server: 'vps',
        matrix_room_id: '',
        wake_word: 'Mini-Me',
        wake_aliases: ['mini me', 'minime', 'mini-me'],
        hermes_prefix: 'hermes-vps: ',
        auto_execute_silence_ms: 0,
        execute_cancel_ms: 0,
        partial_settle_ms: 0,
        commands: {
          pause: 'pause-dictation',
          execute: 'execute',
          resume: 'resume-dictation',
          cancel: 'cancel-dictation',
        },
        ...(overrides.vps || {}),
      },
    },
  };
}

async function createHarness(settingsOverrides = {}) {
  const source = await readFile(WAKE_DEV_JS, 'utf8');
  const settings = baseSettings(settingsOverrides);
  const fetchCalls = [];
  let updateCounter = 0;
  const runtime = {
    desired: true,
    running: true,
    starting: false,
    status: 'Wake runtime test harness.',
    candidates: {},
    instances: {
      local: { enabled: true },
      vps: { enabled: true },
    },
  };
  const documentStub = {
    readyState: 'complete',
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const context = {
    console,
    Date,
    JSON,
    Math,
    Number,
    Promise,
    RegExp,
    Set,
    String,
    clearInterval,
    clearTimeout,
    setInterval,
    setTimeout,
    encodeURIComponent,
    navigator: { platform: 'node' },
    document: documentStub,
    HubModal: undefined,
  };
  context.window = context;
  context.CSS = { escape: value => String(value) };
  context.apiFetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    fetchCalls.push({ url, options, body });
    return {
      ok: true,
      status: 200,
      json: async () => {
        if (String(url).includes('/wake-stt')) {
          return { event_id: `$wake-${fetchCalls.length}`, body: body?.text || '' };
        }
        return { ok: true };
      },
    };
  };
  context.BlueprintsVoiceMode = {
    getWakeSettings: () => clone(settings),
    sttMode: () => 'wake_to_talk',
    activeSttMode: () => 'wake_to_talk',
    isActiveOwner: () => true,
    getBrowserId: () => 'browser-test',
    getBrowserLabel: () => 'Browser test',
    getTabId: () => 'tab-test',
    getLocalState: () => ({ browser_label: 'Browser test', stt_mode: 'wake_to_talk' }),
  };
  context.VadDevModal = {
    getWakeRuntimeSnapshot: () => clone(runtime),
  };
  context.addEventListener = () => {};
  context.dispatchEvent = () => {};
  context.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  };

  vm.runInNewContext(source, context, { filename: WAKE_DEV_JS.pathname });

  function setCandidate(instanceId, sourceName, text) {
    updateCounter += 1;
    const candidate = {
      source: sourceName,
      source_label: sourceName,
      text,
      visible: true,
      tone: sourceName === 'payload1' ? 'amber' : 'green',
      last_updated_at_ms: Date.now(),
      updates: updateCounter,
    };
    runtime.candidates[instanceId] = candidate;
    runtime.instances[instanceId] = {
      enabled: true,
      awaiting_payload: false,
      candidate,
    };
    return context.WakeDevModal.automationSnapshot();
  }

  function snapshot() {
    return context.WakeDevModal.automationSnapshot();
  }

  function matrixSends() {
    return fetchCalls.filter(call => String(call.url).includes('/wake-stt'));
  }

  return { context, fetchCalls, matrixSends, setCandidate, settings, snapshot };
}

async function testPartialOffDoesNotStage() {
  const harness = await createHarness({ local: { partial_settle_ms: 0 } });
  let snapshot = harness.setCandidate('local', 'payload1', 'What time is it?');
  let local = snapshot.instances.local;
  assert.equal(local.partial_settle_enabled, false);
  assert.equal(local.latest_partial_candidate_text, 'What time is it?');
  assert.equal(local.viable_candidate_text, '');

  await sleep(360);
  snapshot = harness.snapshot();
  local = snapshot.instances.local;
  assert.equal(local.partial_settle_remaining_ms, 0);
  assert.equal(local.viable_candidate_text, '');
}

async function testPartialRestartPromotesNewestOnly() {
  const harness = await createHarness({ local: { partial_settle_ms: 300 } });
  harness.setCandidate('local', 'payload1', 'First partial');
  await sleep(160);
  let snapshot = harness.setCandidate('local', 'payload1', 'Second partial');
  assert.equal(snapshot.instances.local.viable_candidate_text, '');

  await sleep(180);
  snapshot = harness.snapshot();
  assert.equal(snapshot.instances.local.viable_candidate_text, '');

  await sleep(190);
  snapshot = harness.snapshot();
  const local = snapshot.instances.local;
  assert.equal(local.viable_candidate_text, 'Second partial');
  assert.equal(local.viable_candidate_source, 'payload1');
  assert.equal(local.viable_candidate_finality, 'settled_partial');
  assert.equal(local.last_settled_partial_revision, local.viable_candidate_revision);
}

async function testFinalCancelsPendingPartial() {
  const harness = await createHarness({ local: { partial_settle_ms: 300 } });
  harness.setCandidate('local', 'payload1', 'Partial version');
  await sleep(100);
  let snapshot = harness.setCandidate('local', 'payload2', 'Final version');
  let local = snapshot.instances.local;
  assert.equal(local.viable_candidate_text, 'Final version');
  assert.equal(local.viable_candidate_finality, 'final');
  assert.equal(local.partial_settle_remaining_ms, 0);
  assert.equal(local.latest_partial_candidate_text, '');

  await sleep(360);
  snapshot = harness.snapshot();
  local = snapshot.instances.local;
  assert.equal(local.viable_candidate_text, 'Final version');
  assert.equal(local.viable_candidate_source, 'payload2');
}

async function testSettledPartialCommandThenFinalDoesNotSendTwice() {
  const harness = await createHarness({
    local: {
      matrix_room_id: '!wake:test',
      partial_settle_ms: 300,
    },
  });
  harness.setCandidate('local', 'payload1', 'What time is it Computer execute');
  await sleep(380);
  let snapshot = harness.snapshot();
  let local = snapshot.instances.local;
  assert.equal(harness.matrixSends().length, 1);
  assert.equal(local.last_command_candidate_source, 'payload1');
  assert.equal(local.last_command_candidate_finality, 'settled_partial');
  assert.equal(local.last_send_status, 'sent');

  harness.setCandidate('local', 'payload2', 'What time is it Computer execute');
  await sleep(80);
  snapshot = harness.snapshot();
  local = snapshot.instances.local;
  assert.equal(harness.matrixSends().length, 1);
  assert.equal(local.last_command.status, 'Duplicate command candidate ignored.');
}

await testPartialOffDoesNotStage();
await testPartialRestartPromotesNewestOnly();
await testFinalCancelsPendingPartial();
await testSettledPartialCommandThenFinalDoesNotSendTwice();

console.log('wake-dev partial settle tests passed');
