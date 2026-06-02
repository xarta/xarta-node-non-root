// wake-dev.js - Wake-to-Talk settings surface.

'use strict';

const WakeDevModal = (() => {
  const SURFACE = 'wake_dev';
  const DEV_STATUS_URL = '/api/v1/voice-mode/dev-status';
  const DEV_COMMAND_EVENT_TYPE = 'voice.mode.dev.command';
  const DEV_COMMAND_MAX_SEEN = 200;
  const DEV_STATUS_MIN_MS = 500;
  const POLL_MS = 500;
  const WAKE_RUNTIME_EVENT = 'blueprints:vad-dev:wake-runtime-changed';
  const INSTANCE_IDS = ['local', 'vps'];
  const DEFAULT_COMMANDS = {
    pause: 'pause-dictation',
    execute: 'execute',
    resume: 'resume-dictation',
    cancel: 'cancel-dictation',
  };
  const DEFAULT_SETTINGS = {
    instances: {
      local: {
        enabled: true,
        label: 'hermes-local',
        matrix_server: 'tb1',
        matrix_room_id: '',
        wake_word: 'Computer',
        auto_execute_silence_ms: 0,
        execute_cancel_ms: 0,
        commands: { ...DEFAULT_COMMANDS },
      },
      vps: {
        enabled: true,
        label: 'hermes-VPS',
        matrix_server: 'vps',
        matrix_room_id: '',
        wake_word: 'Mini-Me',
        auto_execute_silence_ms: 0,
        execute_cancel_ms: 0,
        commands: { ...DEFAULT_COMMANDS },
      },
    },
  };

  const state = {
    bound: false,
    open: false,
    saveTimer: null,
    pollTimer: null,
    devCommandIds: [],
    devStatusLastAt: 0,
    devStatusSignature: '',
    devStatusSending: false,
    settings: null,
  };

  const els = {};

  function el(id) {
    return document.getElementById(id);
  }

  function apiFetchCompat(url, options) {
    if (typeof window.apiFetch === 'function') return window.apiFetch(url, options);
    return window.fetch(url, options);
  }

  function voiceMode() {
    return window.BlueprintsVoiceMode || null;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function cleanText(value, fallback = '') {
    const text = String(value == null ? fallback : value).trim();
    return text || fallback;
  }

  function cleanStepMs(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.max(0, Math.min(3000, Math.round(parsed / 300) * 300));
  }

  function cleanInstance(instanceId, value) {
    const defaults = DEFAULT_SETTINGS.instances[instanceId] || DEFAULT_SETTINGS.instances.local;
    const raw = value && typeof value === 'object' ? value : {};
    const rawCommands = raw.commands && typeof raw.commands === 'object' ? raw.commands : {};
    const matrixServer = instanceId === 'vps' ? 'vps' : 'tb1';
    return {
      enabled: true,
      label: defaults.label,
      matrix_server: matrixServer,
      matrix_room_id: cleanText(raw.matrix_room_id, defaults.matrix_room_id),
      wake_word: cleanText(raw.wake_word, defaults.wake_word),
      auto_execute_silence_ms: cleanStepMs(raw.auto_execute_silence_ms),
      execute_cancel_ms: cleanStepMs(raw.execute_cancel_ms),
      commands: {
        pause: cleanText(rawCommands.pause, DEFAULT_COMMANDS.pause),
        execute: cleanText(rawCommands.execute, DEFAULT_COMMANDS.execute),
        resume: cleanText(rawCommands.resume, DEFAULT_COMMANDS.resume),
        cancel: cleanText(rawCommands.cancel, DEFAULT_COMMANDS.cancel),
      },
    };
  }

  function cleanSettings(value) {
    const raw = value && typeof value === 'object' ? value : {};
    const rawInstances = raw.instances && typeof raw.instances === 'object' ? raw.instances : {};
    return {
      instances: {
        local: cleanInstance('local', rawInstances.local),
        vps: cleanInstance('vps', rawInstances.vps),
      },
    };
  }

  function status(message) {
    if (els.status) els.status.textContent = message || '';
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function control(instanceId, key) {
    const escapedInstance = cssEscape(instanceId);
    const escapedKey = cssEscape(key);
    return document.querySelector(`[data-wake-dev-instance="${escapedInstance}"][data-wake-dev-key="${escapedKey}"]`);
  }

  function output(instanceId, key) {
    const escapedInstance = cssEscape(instanceId);
    const escapedKey = cssEscape(key);
    return document.querySelector(`[data-wake-dev-instance="${escapedInstance}"][data-wake-dev-output="${escapedKey}"]`);
  }

  function metric(instanceId, key) {
    const escapedInstance = cssEscape(instanceId);
    const escapedKey = cssEscape(key);
    return document.querySelector(`[data-wake-dev-instance="${escapedInstance}"][data-wake-dev-metric="${escapedKey}"]`);
  }

  function controlValue(instanceId, key, fallback = '') {
    const node = control(instanceId, key);
    return node ? node.value : fallback;
  }

  function setControlValue(instanceId, key, value) {
    const node = control(instanceId, key);
    if (node) node.value = value == null ? '' : String(value);
  }

  function formatDelay(value) {
    const ms = cleanStepMs(value);
    return ms > 0 ? `${ms} ms` : 'Off';
  }

  function renderDelayOutput(instanceId, key, value) {
    const node = output(instanceId, key);
    if (node) node.textContent = formatDelay(value);
  }

  function renderInstance(instanceId, instance) {
    setControlValue(instanceId, 'wake_word', instance.wake_word);
    setControlValue(instanceId, 'matrix_room_id', instance.matrix_room_id);
    setControlValue(instanceId, 'auto_execute_silence_ms', instance.auto_execute_silence_ms);
    setControlValue(instanceId, 'execute_cancel_ms', instance.execute_cancel_ms);
    setControlValue(instanceId, 'commands.pause', instance.commands.pause);
    setControlValue(instanceId, 'commands.execute', instance.commands.execute);
    setControlValue(instanceId, 'commands.resume', instance.commands.resume);
    setControlValue(instanceId, 'commands.cancel', instance.commands.cancel);
    renderDelayOutput(instanceId, 'auto_execute_silence_ms', instance.auto_execute_silence_ms);
    renderDelayOutput(instanceId, 'execute_cancel_ms', instance.execute_cancel_ms);
  }

  function renderSettings(settings) {
    const clean = cleanSettings(settings);
    state.settings = clean;
    INSTANCE_IDS.forEach(instanceId => renderInstance(instanceId, clean.instances[instanceId]));
  }

  function wakeRuntimeSnapshot() {
    if (typeof window.VadDevModal?.getWakeRuntimeSnapshot === 'function') {
      return window.VadDevModal.getWakeRuntimeSnapshot();
    }
    return {
      desired: false,
      running: false,
      starting: false,
      status: 'Wake runtime unavailable.',
      candidates: {},
      instances: {},
    };
  }

  function renderWakeModeToggle(wakeSelected) {
    if (els.wakeMode) els.wakeMode.checked = !!wakeSelected;
  }

  function candidateStateLabel(candidate, instance) {
    if (candidate?.visible) return candidate.source_label || 'Candidate';
    if (candidate?.fading) return 'Fading';
    if (instance?.awaiting_payload) return 'Awaiting payload0';
    return 'Idle';
  }

  function renderCandidate(instanceId, runtime) {
    const instance = runtime?.instances?.[instanceId] || {};
    const candidate = instance.candidate || runtime?.candidates?.[instanceId] || {};
    const block = els.candidateBlocks?.[instanceId];
    const source = metric(instanceId, 'candidate_source');
    const text = metric(instanceId, 'candidate_text');
    const stateNode = metric(instanceId, 'candidate_state');
    const visible = !!candidate.visible;
    const fading = !!candidate.fading;
    const armed = !!instance.awaiting_payload;
    if (stateNode) stateNode.textContent = candidateStateLabel(candidate, instance);
    if (source) {
      source.textContent = candidate.source_label
        || (armed ? 'Wake word matched' : (instance.enabled ? 'No candidate' : 'No wake word'));
    }
    if (text) text.textContent = candidate.text || '';
    if (block) {
      block.dataset.state = visible ? 'active' : (fading ? 'fading' : (armed ? 'armed' : 'idle'));
      block.dataset.tone = candidate.tone || (armed ? 'amber' : 'idle');
    }
  }

  function renderWakeRuntime() {
    const runtime = wakeRuntimeSnapshot();
    INSTANCE_IDS.forEach(instanceId => renderCandidate(instanceId, runtime));
    return runtime;
  }

  function renderBrowserState() {
    const vm = voiceMode();
    const local = vm?.getLocalState?.() || {};
    const active = vm?.isActiveOwner?.() === true;
    const wakeSelected = vm?.sttMode?.() === 'wake_to_talk';
    const runtime = wakeRuntimeSnapshot();
    renderWakeModeToggle(wakeSelected);
    if (els.activate) els.activate.textContent = active ? 'Deactivate' : 'Activate';
    if (!els.browserMeta) return;
    if (active && wakeSelected && runtime.running) {
      els.browserMeta.textContent = 'Active Browser; Wake to Talk is selected and VAD ReArm is armed.';
    } else if (active && wakeSelected && runtime.starting) {
      els.browserMeta.textContent = 'Active Browser; Wake to Talk is starting VAD ReArm.';
    } else if (active && wakeSelected) {
      els.browserMeta.textContent = runtime.status || 'Active Browser; Wake to Talk is selected.';
    } else if (active) {
      els.browserMeta.textContent = 'Active Browser; Wake to Talk is not selected.';
    } else if (wakeSelected) {
      els.browserMeta.textContent = `${local.browser_label || 'This browser'} has Wake to Talk selected but is not Active Browser.`;
    } else {
      els.browserMeta.textContent = 'Wake to Talk is not selected.';
    }
  }

  async function loadRooms(instanceId) {
    const settings = cleanSettings(state.settings);
    const instance = settings.instances[instanceId];
    const select = control(instanceId, 'matrix_room_id');
    if (!select || !instance) return;
    const current = instance.matrix_room_id || select.value || '';
    const url = `/api/v1/matrix-chat/rooms?server=${encodeURIComponent(instance.matrix_server || 'tb1')}`;
    try {
      const response = await apiFetchCompat(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const joined = Array.isArray(payload.joined) ? payload.joined : [];
      select.innerHTML = '';
      joined.forEach(room => {
        const option = document.createElement('option');
        option.value = room.room_id || '';
        option.textContent = room.name || room.room_id || 'Matrix room';
        select.appendChild(option);
      });
      if (current && !joined.some(room => room.room_id === current)) {
        const option = document.createElement('option');
        option.value = current;
        option.textContent = 'Configured room';
        select.appendChild(option);
      }
      if (!select.options.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No joined rooms';
        select.appendChild(option);
      }
      select.value = current || joined[0]?.room_id || '';
    } catch (error) {
      select.innerHTML = '';
      const option = document.createElement('option');
      option.value = current;
      option.textContent = current ? 'Configured room' : 'Rooms unavailable';
      select.appendChild(option);
      select.value = current;
    }
  }

  function loadAllRooms() {
    INSTANCE_IDS.forEach(instanceId => {
      loadRooms(instanceId).catch(() => {});
    });
  }

  async function loadSettings() {
    renderBrowserState();
    const vm = voiceMode();
    try {
      const settings = typeof vm?.loadWakeSettings === 'function'
        ? await vm.loadWakeSettings({ force: true })
        : null;
      renderSettings(settings || vm?.getWakeSettings?.() || DEFAULT_SETTINGS);
      loadAllRooms();
      status('');
    } catch (error) {
      renderSettings(vm?.getWakeSettings?.() || DEFAULT_SETTINGS);
      loadAllRooms();
      status(`Wake settings unavailable: ${error.message || error}`);
    }
  }

  function collectSettings() {
    const next = cleanSettings(state.settings || voiceMode()?.getWakeSettings?.() || DEFAULT_SETTINGS);
    INSTANCE_IDS.forEach(instanceId => {
      const instance = next.instances[instanceId];
      instance.wake_word = cleanText(controlValue(instanceId, 'wake_word', instance.wake_word), instance.wake_word);
      instance.matrix_room_id = cleanText(controlValue(instanceId, 'matrix_room_id', instance.matrix_room_id));
      instance.auto_execute_silence_ms = cleanStepMs(controlValue(instanceId, 'auto_execute_silence_ms', instance.auto_execute_silence_ms));
      instance.execute_cancel_ms = cleanStepMs(controlValue(instanceId, 'execute_cancel_ms', instance.execute_cancel_ms));
      instance.commands = {
        pause: cleanText(controlValue(instanceId, 'commands.pause', instance.commands.pause), DEFAULT_COMMANDS.pause),
        execute: cleanText(controlValue(instanceId, 'commands.execute', instance.commands.execute), DEFAULT_COMMANDS.execute),
        resume: cleanText(controlValue(instanceId, 'commands.resume', instance.commands.resume), DEFAULT_COMMANDS.resume),
        cancel: cleanText(controlValue(instanceId, 'commands.cancel', instance.commands.cancel), DEFAULT_COMMANDS.cancel),
      };
      renderDelayOutput(instanceId, 'auto_execute_silence_ms', instance.auto_execute_silence_ms);
      renderDelayOutput(instanceId, 'execute_cancel_ms', instance.execute_cancel_ms);
    });
    return next;
  }

  async function saveSettings() {
    const vm = voiceMode();
    if (typeof vm?.saveWakeSettings !== 'function') {
      const response = await apiFetchCompat('/api/v1/voice-mode/wake-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wake_to_talk: collectSettings() }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }
    return vm.saveWakeSettings(collectSettings());
  }

  function scheduleSave() {
    renderSettings(collectSettings());
    if (state.saveTimer) window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(() => {
      state.saveTimer = null;
      saveSettings()
        .then(settings => {
          renderSettings(settings || voiceMode()?.getWakeSettings?.() || state.settings);
          status('Wake settings saved.');
        })
        .catch(error => status(`Save failed: ${error.message || error}`));
      }, 450);
  }

  function setWakeToTalkSelected(enabled, options = {}) {
    const vm = voiceMode();
    if (typeof vm?.setSttMode !== 'function') {
      status('Wake-to-Talk mode control is unavailable.');
      renderBrowserState();
      return false;
    }
    const nextMode = enabled ? 'wake_to_talk' : 'push_to_talk';
    vm.setSttMode(nextMode);
    renderBrowserState();
    renderWakeRuntime();
    status(options.status || (enabled ? 'Wake to Talk selected.' : 'Wake to Talk off; Push to Talk selected.'));
    poll({ force: true });
    return true;
  }

  function automationSnapshot() {
    const vm = voiceMode();
    const runtime = renderWakeRuntime();
    return {
      surface: SURFACE,
      open: !!state.open,
      controls: {
        wake_to_talk_enabled: vm?.sttMode?.() === 'wake_to_talk',
        active_browser: vm?.isActiveOwner?.() === true,
        active_owner: vm?.isActiveOwner?.() === true,
        active_stt_mode: vm?.activeSttMode?.() || '',
        stt_mode: vm?.sttMode?.() || '',
      },
      browser: {
        browser_id: vm?.getBrowserId?.() || '',
        browser_label: vm?.getBrowserLabel?.() || '',
        tab_id: vm?.getTabId?.() || '',
        local: vm?.getLocalState?.() || {},
      },
      settings: clone(state.settings || DEFAULT_SETTINGS),
      runtime,
      candidates: runtime.candidates || {},
      instances: runtime.instances || {},
    };
  }

  function reportDevStatus(snapshot, options = {}) {
    const vm = voiceMode();
    const browserId = cleanText(vm?.getBrowserId?.());
    if (!browserId) return;
    const signature = JSON.stringify({
      surface: SURFACE,
      open: snapshot.open,
      controls: snapshot.controls,
      runtime: {
        desired: snapshot.runtime?.desired,
        running: snapshot.runtime?.running,
        starting: snapshot.runtime?.starting,
        status: snapshot.runtime?.status,
        fsm_state: snapshot.runtime?.fsm_state,
      },
      candidates: snapshot.candidates,
      settings: snapshot.settings,
    });
    const now = Date.now();
    if (!options.force && signature === state.devStatusSignature && now - state.devStatusLastAt < 2500) return;
    if (!options.force && now - state.devStatusLastAt < DEV_STATUS_MIN_MS) return;
    if (state.devStatusSending) return;
    state.devStatusSignature = signature;
    state.devStatusLastAt = now;
    state.devStatusSending = true;
    apiFetchCompat(DEV_STATUS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        surface: SURFACE,
        browser_id: browserId,
        browser_label: vm?.getBrowserLabel?.() || (navigator.platform ? `Browser on ${navigator.platform}` : 'Blueprints browser'),
        tab_id: vm?.getTabId?.() || '',
        mode: snapshot.controls?.stt_mode || '',
        source: 'Wake Dev',
        status: snapshot.runtime?.status || '',
        transcript: '',
        snapshot,
        client_now_ms: now,
      }),
    }).catch(() => {}).finally(() => {
      state.devStatusSending = false;
    });
  }

  function poll(options = {}) {
    renderBrowserState();
    renderWakeRuntime();
    reportDevStatus(automationSnapshot(), options);
  }

  function cleanCommandText(value) {
    return cleanText(value).toLowerCase().replace(/[-\s]+/g, '_');
  }

  function rememberDevCommand(commandId) {
    const id = cleanText(commandId);
    if (!id) return false;
    if (state.devCommandIds.includes(id)) return false;
    state.devCommandIds.push(id);
    if (state.devCommandIds.length > DEV_COMMAND_MAX_SEEN) {
      state.devCommandIds = state.devCommandIds.slice(-DEV_COMMAND_MAX_SEEN);
    }
    return true;
  }

  function shouldAcceptDevCommand(payload) {
    const surface = cleanCommandText(payload?.surface || payload?.target_surface || payload?.dev_surface);
    if (surface !== SURFACE) return false;
    const targetBrowserId = cleanText(payload?.target_browser_id || payload?.browser_id);
    const browserId = cleanText(voiceMode()?.getBrowserId?.());
    if (targetBrowserId && browserId && targetBrowserId !== browserId) return false;
    const targetTabId = cleanText(payload?.target_tab_id || payload?.tab_id);
    const tabId = cleanText(voiceMode()?.getTabId?.());
    if (targetTabId && tabId && targetTabId !== tabId) return false;
    const createdAt = Number(payload?.created_at || 0);
    const maxAgeSeconds = Math.max(5, Math.min(300, Number(payload?.max_age_seconds || 60)));
    if (Number.isFinite(createdAt) && createdAt > 0) {
      const ageMs = Date.now() - (createdAt * 1000);
      if (ageMs > maxAgeSeconds * 1000) return false;
    }
    return true;
  }

  function payloadBool(payload, fallback = true, ...preferredKeys) {
    const keys = [...preferredKeys, 'enabled', 'checked', 'wake_to_talk_enabled', 'value'];
    for (const key of keys) {
      if (payload?.[key] == null) continue;
      return !['0', 'false', 'off', 'no'].includes(String(payload[key]).trim().toLowerCase());
    }
    return fallback;
  }

  function runWakeDevCommand(payload) {
    if (!shouldAcceptDevCommand(payload)) return;
    if (!rememberDevCommand(cleanText(payload?.command_id))) return;
    if (payload?.open_modal && !state.open) open();
    const action = cleanCommandText(payload?.action);
    if (action === 'set_wake_to_talk' || action === 'set_wake_to_talk_enabled') {
      setWakeToTalkSelected(payloadBool(payload, true, 'wake_to_talk_enabled'), {
        status: 'Wake-to-Talk mode updated by automation.',
      });
      return;
    }
    if (action === 'set_stt_mode') {
      const mode = cleanCommandText(payload?.value || payload?.stt_mode || '');
      setWakeToTalkSelected(mode === 'wake_to_talk', {
        status: mode === 'wake_to_talk'
          ? 'Wake-to-Talk mode updated by automation.'
          : 'Push-to-Talk mode updated by automation.',
      });
      return;
    }
    status(`Remote command ignored: ${action || 'blank'}.`);
    poll({ force: true });
  }

  function onWakeDevCommandEvent(event) {
    const appEvent = event?.detail || {};
    if (appEvent.event_type !== DEV_COMMAND_EVENT_TYPE) return;
    runWakeDevCommand(appEvent.payload || {});
  }

  function toggleActive() {
    const vm = voiceMode();
    if (typeof vm?.toggleActive !== 'function') {
      status('Active Browser controls are unavailable.');
      return;
    }
    Promise.resolve(vm.toggleActive())
      .then(() => {
        renderBrowserState();
        status(vm.isActiveOwner?.() ? 'This browser is now the Active Browser.' : 'This browser is no longer the Active Browser.');
      })
      .catch(error => status(`Active Browser update failed: ${error.message || error}`));
  }

  function openVadDev() {
    if (typeof window.VadDevModal?.open === 'function') {
      window.VadDevModal.open();
      status('VAD Dev opened.');
    } else {
      status('VAD Dev is unavailable.');
    }
  }

  function open() {
    if (!els.modal) return false;
    state.open = true;
    if (typeof HubModal !== 'undefined' && typeof HubModal.open === 'function') {
      HubModal.open(els.modal, { onOpen: start, onClose: stop });
    } else if (!els.modal.open) {
      els.modal.showModal();
      start();
    }
    return true;
  }

  function start() {
    state.open = true;
    loadSettings().catch(error => status(`Wake settings unavailable: ${error.message || error}`));
    if (state.pollTimer) window.clearInterval(state.pollTimer);
    state.pollTimer = window.setInterval(poll, POLL_MS);
    poll({ force: true });
  }

  function stop() {
    state.open = false;
    if (state.saveTimer) window.clearTimeout(state.saveTimer);
    state.saveTimer = null;
    if (state.pollTimer) window.clearInterval(state.pollTimer);
    state.pollTimer = null;
    poll({ force: true });
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    els.modal = el('wake-dev-modal');
    if (!els.modal) return;
    els.browserMeta = el('wake-dev-browser-meta');
    els.activate = el('wake-dev-activate-btn');
    els.wakeMode = el('wake-dev-wake-mode-toggle');
    els.openVadDev = el('wake-dev-open-vad-dev');
    els.status = el('wake-dev-status');
    els.candidateBlocks = {
      local: el('wake-dev-local-candidate'),
      vps: el('wake-dev-vps-candidate'),
    };

    els.activate?.addEventListener('click', toggleActive);
    els.wakeMode?.addEventListener('change', () => {
      setWakeToTalkSelected(els.wakeMode.checked);
    });
    els.openVadDev?.addEventListener('click', openVadDev);
    document.querySelectorAll('[data-wake-dev-instance][data-wake-dev-key]').forEach(node => {
      node.addEventListener('input', scheduleSave);
      node.addEventListener('change', scheduleSave);
    });
    window.addEventListener('blueprints:voice-mode:changed', () => {
      renderBrowserState();
      renderWakeRuntime();
      if (state.open) loadSettings().catch(() => {});
      poll({ force: true });
    });
    window.addEventListener('blueprints:voice-mode:wake-settings-changed', event => {
      if (!state.open) return;
      renderSettings(event.detail?.wake_settings || voiceMode()?.getWakeSettings?.() || state.settings);
      loadAllRooms();
      renderWakeRuntime();
      poll({ force: true });
    });
    window.addEventListener(WAKE_RUNTIME_EVENT, () => {
      renderBrowserState();
      renderWakeRuntime();
      poll({ force: true });
    });
    document.addEventListener('blueprints:event', onWakeDevCommandEvent);
    els.modal.addEventListener('close', stop);
    renderSettings(DEFAULT_SETTINGS);
    renderBrowserState();
    renderWakeRuntime();
    poll({ force: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }

  return {
    open,
    start,
    stop,
    automationSnapshot,
    getSettings: () => clone(state.settings || DEFAULT_SETTINGS),
  };
})();

window.WakeDevModal = WakeDevModal;
