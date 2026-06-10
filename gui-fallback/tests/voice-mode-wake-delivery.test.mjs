import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const VOICE_MODE_JS = new URL('../js/voice-mode.js', import.meta.url);

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

async function createHarness() {
  const source = await readFile(VOICE_MODE_JS, 'utf8');
  const fetchCalls = [];
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
    document: documentStub,
    navigator: { platform: 'node' },
    localStorage: createStorage(),
    sessionStorage: createStorage(),
    apiFetch: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      fetchCalls.push({ url, options, body });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          wake_to_talk: body?.wake_to_talk,
          policy: { wake_to_talk: body?.wake_to_talk },
          stt: {},
        }),
      };
    },
    addEventListener() {},
    dispatchEvent() {},
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: VOICE_MODE_JS.pathname });
  return { context, fetchCalls };
}

async function testDirectDeliverySurvivesVoiceModeSave() {
  const { context, fetchCalls } = await createHarness();
  await context.BlueprintsVoiceMode.saveWakeSettings({
    instances: {
      local: {
        enabled: true,
        label: 'hermes-local',
        matrix_server: 'tb1',
        matrix_room_id: '!bridge:test',
        wake_word: 'Computer',
        wake_aliases: ['computer'],
        hermes_prefix: 'hermes: ',
        delivery_mode: 'direct_local',
        direct_available: true,
        direct_enabled: true,
        direct_route_enabled: true,
        direct_status: 'enabled',
        direct_requested: true,
        auto_execute_silence_ms: 900,
        execute_cancel_ms: 3000,
        partial_settle_ms: 2100,
        commands: {
          pause: 'pause-dictation',
          execute: 'execute',
          resume: 'resume-dictation',
          cancel: 'cancel-dictation',
        },
      },
      vps: {
        enabled: true,
        label: 'hermes-VPS',
        matrix_server: 'vps',
        matrix_room_id: '!shared:test',
        wake_word: 'David',
        delivery_mode: 'direct_vps',
        direct_available: true,
        direct_enabled: true,
        direct_route_enabled: true,
        direct_requested: true,
        commands: {},
      },
    },
  });

  const save = fetchCalls.find(call => String(call.url).includes('/wake-settings'));
  assert.ok(save, 'expected a wake-settings save');
  const local = save.body.wake_to_talk.instances.local;
  const vps = save.body.wake_to_talk.instances.vps;
  assert.equal(local.delivery_mode, 'direct_local');
  assert.equal(local.direct_enabled, true);
  assert.equal(local.direct_requested, true);
  assert.equal(local.direct_route_enabled, true);
  assert.equal(vps.delivery_mode, 'direct_vps');
  assert.equal(vps.direct_enabled, true);
  assert.equal(vps.direct_requested, true);
  assert.equal(vps.direct_route_enabled, true);
}

async function testDirectDeliveryRollsBackWhenGateUnavailable() {
  const { context, fetchCalls } = await createHarness();
  await context.BlueprintsVoiceMode.saveWakeSettings({
    instances: {
      local: {
        matrix_room_id: '!bridge:test',
        wake_word: 'Computer',
        delivery_mode: 'direct_local',
        direct_available: true,
        direct_route_enabled: false,
        direct_enabled: true,
        commands: {},
      },
    },
  });
  const save = fetchCalls.find(call => String(call.url).includes('/wake-settings'));
  const local = save.body.wake_to_talk.instances.local;
  assert.equal(local.delivery_mode, 'matrix');
  assert.equal(local.direct_enabled, false);
  assert.equal(local.direct_requested, true);
  assert.equal(local.direct_route_enabled, false);
}

await testDirectDeliverySurvivesVoiceModeSave();
await testDirectDeliveryRollsBackWhenGateUnavailable();

console.log('voice-mode wake delivery tests passed');
