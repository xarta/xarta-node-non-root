import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const SETTINGS_MENU_JS = new URL('../js/settings/settings-menu.js', import.meta.url);

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

function repo({ branch = 'main', upstream = 'origin/main', commit = 'aaaaaaa', dirty = false, ahead = 0 } = {}) {
  return {
    exists: true,
    branch,
    upstream,
    upstream_tracked: upstream !== null,
    ahead,
    behind: 0,
    commit,
    dirty,
  };
}

async function createHarness(versionsByNode) {
  const source = await readFile(SETTINGS_MENU_JS, 'utf8');
  const context = {
    console,
    Array,
    Error,
    JSON,
    Map,
    Object,
    Promise,
    Set,
    String,
    document: {
      getElementById() { return null; },
      querySelectorAll() { return []; },
    },
    window: {
      addEventListener() {},
      dispatchEvent() {},
      BlueprintsAppModeDiag: null,
    },
    localStorage: createStorage(),
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    AbortSignal: {
      timeout() { return {}; },
    },
    HubModal: { open() {} },
    createHubMenu(config) {
      return {
        STORAGE_KEY: config.storageKey,
        defaultMenu: config.defaultMenu,
        currentMenu: [...config.defaultMenu],
        loadConfig() {},
        showGroup() {},
        updateActiveTab() {},
        registerFunctions() {},
        registerLabelGetters() {},
        registerVisibilityGetters() {},
      };
    },
    HIEROGLYPHS: new Proxy({}, { get: () => '' }),
    apiFetch: async (url) => {
      const match = String(url).match(/^\/api\/v1\/nodes\/([^/]+)\/repo-versions$/);
      assert.ok(match, `unexpected apiFetch URL: ${url}`);
      const nodeId = decodeURIComponent(match[1]);
      const payload = versionsByNode[nodeId];
      if (!payload) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => payload };
    },
  };
  context.window.window = context.window;
  vm.runInNewContext(`${source}
this.__fleetUpdateTest = {
  _checkFleetUpdatePreflight,
  _verifyFleetRepoStage,
  _fleetUpdateCanSkipRequeue,
  _fleetUpdateIsTransientErrorMessage,
};`, context, { filename: SETTINGS_MENU_JS.pathname });
  return context.__fleetUpdateTest;
}

async function testBranchMismatchPreflight() {
  const versionsByNode = {
    'coordinator-node': {
      node_id: 'coordinator-node',
      outer: repo({
        branch: 'codex/sync-queue-retention',
        upstream: 'origin/codex/sync-queue-retention',
        commit: 'aaf0911',
      }),
      non_root: repo({ commit: '6f437e9' }),
      inner: repo({ commit: '45e11fc' }),
    },
    'peer-main': {
      node_id: 'peer-main',
      outer: repo({ branch: 'main', upstream: 'origin/main', commit: 'cf3d922' }),
      non_root: repo({ commit: '6f437e9' }),
      inner: repo({ commit: '45e11fc' }),
    },
  };
  const harness = await createHarness(versionsByNode);
  const findings = await harness._checkFleetUpdatePreflight(
    [{ node_id: 'coordinator-node' }, { node_id: 'peer-main' }],
    versionsByNode['coordinator-node'],
  );
  assert.ok(
    findings.some(line => line.includes('coordinator-node: root repo is on `codex/sync-queue-retention`, peers are on `main`; merge/switch coordinator to `main` before Fleet Update.')),
    `expected explicit coordinator branch mismatch finding, got:\n${findings.join('\n')}`,
  );
  assert.ok(
    findings.some(line => line.includes('peer-main: Root public repo branch `main` differs from coordinator `codex/sync-queue-retention`; merge/switch before Fleet Update.')),
    `expected peer/coordinator branch mismatch finding, got:\n${findings.join('\n')}`,
  );
}

async function testTransientAndHardFailures() {
  const versionsByNode = {
    peer: {
      node_id: 'peer',
      outer: repo({
        branch: 'codex/sync-queue-retention',
        upstream: 'origin/codex/sync-queue-retention',
        commit: 'cf3d922',
      }),
    },
  };
  const harness = await createHarness(versionsByNode);
  assert.equal(harness._fleetUpdateIsTransientErrorMessage('HTTP 503'), true);
  assert.equal(harness._fleetUpdateIsTransientErrorMessage('request timed out'), true);
  assert.equal(harness._fleetUpdateIsTransientErrorMessage('Root public repo dirty'), false);
  assert.equal(harness._fleetUpdateCanSkipRequeue({ restartExpected: true }, [{ transient: true }]), true);
  assert.equal(harness._fleetUpdateCanSkipRequeue({ restartExpected: true }, [{ transient: false }]), false);
  assert.equal(harness._fleetUpdateCanSkipRequeue({ restartExpected: false }, [{ transient: true }]), false);

  const failures = await harness._verifyFleetRepoStage(
    [{ node_id: 'peer' }],
    {
      node_id: 'coordinator-node',
      outer: repo({ branch: 'main', upstream: 'origin/main', commit: 'aaf0911' }),
    },
    'outer',
    'Root public repo',
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0].transient, false);
  assert.match(failures[0].message, /branch `codex\/sync-queue-retention` differs from coordinator `main`/);
  assert.match(failures[0].message, /commit cf3d922 cannot converge to expected aaf0911 while the branch differs/);
}

await testBranchMismatchPreflight();
await testTransientAndHardFailures();

console.log('fleet update preflight tests passed');
