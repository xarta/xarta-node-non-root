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
  const CANDIDATE_SOURCES = new Set(['payload0', 'payload1', 'payload2']);
  const COMMAND_KINDS = ['execute', 'cancel', 'pause', 'resume'];
  const COMMAND_SEPARATOR_RE = /[\s_-]+/g;
  const COMMAND_TRAILING_PUNCTUATION_RE = '\\s*[.!?]+';
  const SPEECH_COMMAND_VARIANTS = {
    execute: ['executes'],
  };
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
        wake_aliases: ['computer'],
        hermes_prefix: 'hermes: ',
        delivery_mode: 'matrix',
        direct_available: true,
        direct_enabled: false,
        direct_route_enabled: false,
        direct_status: 'disabled',
        direct_requested: false,
        direct_rollback_applied: false,
        direct_rollback_reason: '',
        auto_execute_silence_ms: 0,
        execute_cancel_ms: 0,
        partial_settle_ms: 0,
        commands: { ...DEFAULT_COMMANDS },
      },
      vps: {
        enabled: true,
        label: 'hermes-VPS',
        matrix_server: 'vps',
        matrix_room_id: '',
        wake_word: 'Mini-Me',
        wake_aliases: ['mini me', 'minime', 'mini-me'],
        hermes_prefix: 'hermes-vps: ',
        delivery_mode: 'matrix',
        direct_available: false,
        direct_enabled: false,
        direct_route_enabled: false,
        direct_status: 'not_available',
        direct_requested: false,
        direct_rollback_applied: false,
        direct_rollback_reason: '',
        auto_execute_silence_ms: 0,
        execute_cancel_ms: 0,
        partial_settle_ms: 0,
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
    settingsHydrated: false,
    wakeMemory: {
      local: createWakeMemoryState('local'),
      vps: createWakeMemoryState('vps'),
    },
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

  function splitVariants(value) {
    if (Array.isArray(value)) {
      return value.flatMap(item => splitVariants(item));
    }
    return String(value == null ? '' : value)
      .split(';')
      .map(item => item.trim())
      .filter(Boolean);
  }

  function uniquePush(list, value) {
    const text = String(value || '').trim();
    if (text && !list.includes(text)) list.push(text);
  }

  function wakeAliases(wakeWord, configured) {
    const aliases = [];
    splitVariants(wakeWord).concat(splitVariants(configured)).forEach(value => {
      const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[-_,.]+/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .join(' ');
      if (!normalized) return;
      uniquePush(aliases, normalized);
      uniquePush(aliases, normalized.replace(/\s+/g, ''));
      uniquePush(aliases, normalized.replace(/\s+/g, '-'));
    });
    return aliases.slice(0, 16);
  }

  function cleanHermesPrefix(value, fallback = '') {
    const raw = cleanText(value, fallback).replace(/[\r\n]+/g, ' ');
    const compact = raw.split(/\s+/).filter(Boolean).join(' ');
    if (!compact) return fallback || '';
    const withColon = compact.endsWith(':') ? compact : `${compact.replace(/:+$/, '')}:`;
    return `${withColon} `;
  }

  function cleanBool(value, fallback = false) {
    if (value == null || value === '') return !!fallback;
    return !['0', 'false', 'off', 'no'].includes(String(value).trim().toLowerCase());
  }

  function directModeForInstance(instanceId) {
    return instanceId === 'vps' ? 'direct_vps' : 'direct_local';
  }

  function isDirectMode(value) {
    return value === 'direct_local' || value === 'direct_vps';
  }

  function cleanDeliveryMode(value, instanceId = 'local') {
    const mode = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
    if (['direct', 'direct_hermes', 'hermes_direct', 'hermes_stt'].includes(mode)) {
      return directModeForInstance(instanceId);
    }
    if (isDirectMode(mode)) return mode;
    return 'matrix';
  }

  function canSelectDirect(instanceId, instance) {
    return !!instance?.direct_available && !!instance?.direct_route_enabled;
  }

  function effectiveDeliveryMode(instanceId, instance) {
    return canSelectDirect(instanceId, instance) && isDirectMode(cleanDeliveryMode(instance?.delivery_mode, instanceId))
      ? directModeForInstance(instanceId)
      : 'matrix';
  }

  function routeStateText(instanceId, instance) {
    const mode = effectiveDeliveryMode(instanceId, instance);
    if (mode === 'direct_vps') return 'Direct VPS STT active; Matrix fallback ready.';
    if (mode === 'direct_local') return 'Direct local hermes-stt active; Matrix fallback ready.';
    if (!instance?.direct_available) return 'Matrix route active; direct route unavailable.';
    if (!instance?.direct_route_enabled) return 'Matrix route active; direct route flag off.';
    if (instance?.direct_rollback_reason) return `Matrix route active; ${instance.direct_rollback_reason}.`;
    return 'Matrix route active; direct route available.';
  }

  function cleanInstance(instanceId, value) {
    const defaults = DEFAULT_SETTINGS.instances[instanceId] || DEFAULT_SETTINGS.instances.local;
    const raw = value && typeof value === 'object' ? value : {};
    const rawCommands = raw.commands && typeof raw.commands === 'object' ? raw.commands : {};
    const matrixServer = instanceId === 'vps' ? 'vps' : 'tb1';
    const wakeWord = cleanText(raw.wake_word, defaults.wake_word);
    const directAvailable = cleanBool(raw.direct_available, defaults.direct_available);
    const directRouteEnabled = cleanBool(raw.direct_route_enabled, defaults.direct_route_enabled);
    const requestedDeliveryMode = cleanDeliveryMode(raw.delivery_mode || defaults.delivery_mode, instanceId);
    const deliveryMode = directAvailable && directRouteEnabled && isDirectMode(requestedDeliveryMode)
      ? directModeForInstance(instanceId)
      : 'matrix';
    return {
      enabled: true,
      label: defaults.label,
      matrix_server: matrixServer,
      matrix_room_id: cleanText(raw.matrix_room_id, defaults.matrix_room_id),
      wake_word: wakeWord,
      wake_aliases: wakeAliases(wakeWord, raw.wake_aliases || defaults.wake_aliases),
      hermes_prefix: cleanHermesPrefix(raw.hermes_prefix, defaults.hermes_prefix),
      delivery_mode: deliveryMode,
      direct_available: directAvailable,
      direct_enabled: isDirectMode(deliveryMode) && cleanBool(raw.direct_enabled, isDirectMode(deliveryMode)),
      direct_route_enabled: directRouteEnabled,
      direct_status: cleanText(raw.direct_status, directAvailable ? 'disabled' : 'not_available'),
      direct_requested: isDirectMode(requestedDeliveryMode) || cleanBool(raw.direct_requested),
      direct_rollback_applied: cleanBool(raw.direct_rollback_applied, false),
      direct_rollback_reason: cleanText(raw.direct_rollback_reason, ''),
      auto_execute_silence_ms: cleanStepMs(raw.auto_execute_silence_ms),
      execute_cancel_ms: cleanStepMs(raw.execute_cancel_ms),
      partial_settle_ms: cleanStepMs(raw.partial_settle_ms ?? raw.partial_settle_timeout_ms),
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

  function runtimeSettings() {
    const vmSettings = voiceMode()?.getWakeSettings?.();
    if (!state.settingsHydrated && vmSettings) return cleanSettings(vmSettings);
    return cleanSettings(state.settings || vmSettings || DEFAULT_SETTINGS);
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
    const deliveryControl = control(instanceId, 'delivery_mode');
    if (deliveryControl) {
      const directMode = directModeForInstance(instanceId);
      const directOption = Array.from(deliveryControl.options || []).find(option => isDirectMode(option.value));
      const directSelectable = canSelectDirect(instanceId, instance);
      if (directOption) {
        directOption.value = directMode;
        directOption.disabled = !directSelectable;
        directOption.textContent = instanceId === 'local'
          ? (directSelectable ? 'Direct hermes-stt' : 'Direct hermes-stt unavailable')
          : (directSelectable ? 'Direct VPS STT' : 'Direct VPS STT unavailable');
      }
      deliveryControl.value = effectiveDeliveryMode(instanceId, instance);
      deliveryControl.disabled = !directSelectable;
    }
    setControlValue(instanceId, 'auto_execute_silence_ms', instance.auto_execute_silence_ms);
    setControlValue(instanceId, 'execute_cancel_ms', instance.execute_cancel_ms);
    setControlValue(instanceId, 'partial_settle_ms', instance.partial_settle_ms);
    setControlValue(instanceId, 'commands.pause', instance.commands.pause);
    setControlValue(instanceId, 'commands.execute', instance.commands.execute);
    setControlValue(instanceId, 'commands.resume', instance.commands.resume);
    setControlValue(instanceId, 'commands.cancel', instance.commands.cancel);
    renderDelayOutput(instanceId, 'auto_execute_silence_ms', instance.auto_execute_silence_ms);
    renderDelayOutput(instanceId, 'execute_cancel_ms', instance.execute_cancel_ms);
    renderDelayOutput(instanceId, 'partial_settle_ms', instance.partial_settle_ms);
    const routeState = metric(instanceId, 'route_state');
    if (routeState) routeState.textContent = routeStateText(instanceId, instance);
  }

  function renderSettings(settings, options = {}) {
    const clean = cleanSettings(settings);
    state.settings = clean;
    if (options.authoritative) state.settingsHydrated = true;
    INSTANCE_IDS.forEach(instanceId => {
      const memory = memoryFor(instanceId);
      if (cleanStepMs(clean.instances[instanceId]?.partial_settle_ms) <= 0 && memory.partialTimer) {
        clearPartialSettleTimer(memory, { clearCandidate: true });
        memory.lastStatus = 'Partial settle disabled; pending partial cleared.';
      }
      renderInstance(instanceId, clean.instances[instanceId]);
    });
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

  function renderTimerText(memorySnapshot) {
    const parts = [];
    if (memorySnapshot.partial_settle_remaining_ms > 0) {
      parts.push(`Partial ${Math.ceil(memorySnapshot.partial_settle_remaining_ms / 1000)}s`);
    }
    if (memorySnapshot.auto_execute_remaining_ms > 0) {
      parts.push(`Auto ${Math.ceil(memorySnapshot.auto_execute_remaining_ms / 1000)}s`);
    }
    if (memorySnapshot.execute_cancel_remaining_ms > 0) {
      parts.push(`Cancel ${Math.ceil(memorySnapshot.execute_cancel_remaining_ms / 1000)}s`);
    }
    return parts.length ? parts.join(' / ') : 'Timers idle';
  }

  function renderCandidate(instanceId, runtime) {
    const instance = runtime?.instances?.[instanceId] || {};
    const settingsInstance = runtimeSettings().instances[instanceId] || {};
    const candidate = instance.candidate || runtime?.candidates?.[instanceId] || {};
    const memorySnapshot = wakeMemorySnapshotFor(instanceId);
    const block = els.candidateBlocks?.[instanceId];
    const source = metric(instanceId, 'candidate_source');
    const text = metric(instanceId, 'candidate_text');
    const stateNode = metric(instanceId, 'candidate_state');
    const viableSource = metric(instanceId, 'viable_candidate_source');
    const viableText = metric(instanceId, 'viable_candidate_text');
    const timerState = metric(instanceId, 'timer_state');
    const sendState = metric(instanceId, 'send_state');
    const visible = !!candidate.visible;
    const fading = !!candidate.fading;
    const armed = !!instance.awaiting_payload;
    if (stateNode) {
      stateNode.textContent = candidateStateLabel(candidate, instance);
      if (!visible && !fading && !armed && memorySnapshot.viable_candidate_text) {
        stateNode.textContent = 'Viable staged';
      }
    }
    if (source) {
      source.textContent = candidate.source_label
        || (armed ? 'Wake word matched' : (instance.enabled ? 'No candidate' : 'No wake word'));
    }
    if (text) text.textContent = candidate.text || '';
    if (viableSource) {
      viableSource.textContent = memorySnapshot.viable_candidate_source
        ? `Staged ${memorySnapshot.viable_candidate_source}${memorySnapshot.viable_candidate_finality === 'settled_partial' ? ' settled partial' : ''}`
        : 'No staged candidate';
    }
    if (viableText) viableText.textContent = memorySnapshot.viable_candidate_text || '';
    if (timerState) timerState.textContent = renderTimerText(memorySnapshot);
    if (sendState) {
      const send = memorySnapshot.last_send || {};
      const lastCommand = memorySnapshot.last_command || {};
      const pieces = [];
      if (memorySnapshot.last_status) pieces.push(memorySnapshot.last_status);
      if (send.delivery_mode) pieces.push(isDirectMode(send.delivery_mode) ? 'Direct' : 'Matrix');
      if (send.fallback_reason) pieces.push(`Fallback ${send.fallback_reason}`);
      if (send.rollback_reason) pieces.push(`Rollback ${send.rollback_reason}`);
      if (send.event_id) pieces.push(`Event ${send.event_id}`);
      if (send.diagnostic_scheduled) pieces.push('Diagnostic scheduled');
      if (send.tts_status === 'queued') pieces.push('TTS queued');
      if (send.tts_status === 'error') pieces.push(`TTS error${send.tts_error ? ` ${send.tts_error}` : ''}`);
      if (send.assistant_text) {
        const reply = String(send.assistant_text).replace(/\s+/g, ' ').trim();
        pieces.push(`Reply: ${reply.length > 120 ? `${reply.slice(0, 117)}...` : reply}`);
      }
      if (send.error) pieces.push(send.error);
      if (lastCommand.pending) pieces.push('Pending command behavior');
      sendState.textContent = pieces.join(' | ');
    }
    const routeState = metric(instanceId, 'route_state');
    if (routeState) routeState.textContent = routeStateText(instanceId, settingsInstance);
    if (block) {
      block.dataset.state = visible ? 'active' : (fading ? 'fading' : (armed ? 'armed' : 'idle'));
      block.dataset.tone = candidate.tone || (armed ? 'amber' : 'idle');
      block.dataset.viable = memorySnapshot.viable_candidate_text ? 'true' : 'false';
      block.dataset.sendState = memorySnapshot.last_send_status || 'idle';
    }
  }

  function createWakeMemoryState(instanceId) {
    return {
      instance_id: instanceId,
      incomingSignature: '',
      revisionCounter: 0,
      viable: null,
      latestPartial: null,
      lastSettledPartial: null,
      partialTimer: null,
      partialStartedAt: 0,
      partialDeadlineAt: 0,
      partialRevision: '',
      commandSignature: '',
      commandProcessedAtMs: 0,
      autoTimer: null,
      autoStartedAt: 0,
      autoDeadlineAt: 0,
      autoRevision: '',
      cancelTimer: null,
      cancelStartedAt: 0,
      cancelDeadlineAt: 0,
      cancelRevision: '',
      lastCommand: {
        kind: '',
        status: '',
        candidate_text: '',
        incoming_text: '',
        wake_word: '',
        command_text: '',
        candidate_source: '',
        candidate_finality: '',
        recognized_at_ms: 0,
        pending: false,
      },
      lastSend: {
        state: 'idle',
        status: 'idle',
        room_id: '',
        server: '',
        event_id: '',
        error: '',
        command_source: '',
        candidate_revision: '',
        candidate_text: '',
        sent_at_ms: 0,
        updated_at_ms: 0,
        body: '',
        requested_delivery_mode: 'matrix',
        delivery_mode: 'matrix',
        direct_status: '',
        rollback_reason: '',
        fallback_reason: '',
        diagnostic_scheduled: false,
        tts_status: '',
        tts_event_id: '',
        tts_error: '',
        assistant_text: '',
      },
      lastStatus: 'Idle.',
    };
  }

  function memoryFor(instanceId) {
    if (!state.wakeMemory[instanceId]) {
      state.wakeMemory[instanceId] = createWakeMemoryState(instanceId);
    }
    return state.wakeMemory[instanceId];
  }

  function clearPartialSettleTimer(memory, options = {}) {
    if (!memory) return;
    if (memory.partialTimer) window.clearTimeout(memory.partialTimer);
    memory.partialTimer = null;
    memory.partialStartedAt = 0;
    memory.partialDeadlineAt = 0;
    memory.partialRevision = '';
    if (options.clearCandidate) memory.latestPartial = null;
  }

  function clearWakeMemoryTimers(memory) {
    if (!memory) return;
    clearPartialSettleTimer(memory);
    if (memory.autoTimer) window.clearTimeout(memory.autoTimer);
    if (memory.cancelTimer) window.clearTimeout(memory.cancelTimer);
    memory.autoTimer = null;
    memory.cancelTimer = null;
    memory.autoStartedAt = 0;
    memory.autoDeadlineAt = 0;
    memory.autoRevision = '';
    memory.cancelStartedAt = 0;
    memory.cancelDeadlineAt = 0;
    memory.cancelRevision = '';
  }

  function regexEscape(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normalizeCommandText(value) {
    return String(value == null ? '' : value)
      .trim()
      .toLowerCase()
      .replace(COMMAND_SEPARATOR_RE, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .join(' ');
  }

  function commandPattern(value) {
    const normalized = normalizeCommandText(value);
    if (!normalized) return '';
    return normalized.split(' ').map(regexEscape).join('[\\s_-]+');
  }

  function commandVariantsFor(instance, kind) {
    const variants = [];
    splitVariants(instance?.commands?.[kind] || DEFAULT_COMMANDS[kind]).forEach(value => {
      uniquePush(variants, value);
    });
    if (variants.some(value => normalizeCommandText(value) === normalizeCommandText(DEFAULT_COMMANDS[kind]))) {
      (SPEECH_COMMAND_VARIANTS[kind] || []).forEach(value => uniquePush(variants, value));
    }
    return variants;
  }

  function parseWakeCommandSuffix(instance, text) {
    const incomingText = cleanText(text);
    if (!incomingText) return null;
    const wakeValues = splitVariants(instance?.wake_word).concat(splitVariants(instance?.wake_aliases));
    const wakePatterns = wakeValues
      .map(value => ({ value, pattern: commandPattern(value) }))
      .filter(item => item.pattern);
    if (!wakePatterns.length) return null;

    const matches = [];
    COMMAND_KINDS.forEach(kind => {
      commandVariantsFor(instance, kind).forEach(commandValue => {
        const commandRe = commandPattern(commandValue);
        if (!commandRe) return;
        wakePatterns.forEach(wake => {
          const re = new RegExp(`(?:^|[\\s_-]+)(${wake.pattern})[\\s_-]+(${commandRe})(?:${COMMAND_TRAILING_PUNCTUATION_RE})?\\s*$`, 'i');
          const match = re.exec(incomingText);
          if (!match) return;
          const strippedText = incomingText.slice(0, match.index).trim();
          matches.push({
            kind,
            stripped_text: strippedText,
            command_only: !strippedText,
            wake_word: wake.value,
            command_text: commandValue,
            suffix_text: match[0].trim(),
            score: match[0].length,
          });
        });
      });
    });
    matches.sort((a, b) => b.score - a.score);
    return matches[0] || null;
  }

  function sourceLabelForCandidate(candidate) {
    return candidate?.source_label || candidate?.sourceLabel || candidate?.source || 'Candidate';
  }

  function finalityForSource(source) {
    return source === 'payload1' ? 'settled_partial' : 'final';
  }

  function nextCandidateRevision(memory, instanceId) {
    memory.revisionCounter += 1;
    return `wake-${instanceId}-${Date.now()}-${memory.revisionCounter}`;
  }

  function stageViableCandidate(instanceId, detail, options = {}) {
    const memory = memoryFor(instanceId);
    const now = Date.now();
    clearWakeMemoryTimers(memory);
    const revision = detail.revision || nextCandidateRevision(memory, instanceId);
    const viable = {
      text: cleanText(detail.text),
      source: cleanText(detail.source),
      source_label: detail.source_label || detail.source || 'Candidate',
      finality: detail.finality || finalityForSource(cleanText(detail.source)),
      instance: instanceId,
      revision,
      created_at_ms: now,
      updated_at_ms: now,
      incoming_text: detail.incoming_text || detail.text || '',
      stripped_command: detail.stripped_command || '',
      wake_word: detail.wake_word || '',
    };
    if (!viable.text) return null;
    memory.viable = viable;
    const finalityLabel = viable.finality === 'settled_partial' ? 'settled partial' : 'final';
    memory.lastStatus = `Viable ${finalityLabel} candidate staged from ${viable.source_label}.`;
    if (options.scheduleTimers !== false) scheduleViableCandidateTimers(instanceId, viable);
    renderWakeRuntime();
    reportDevStatus(automationSnapshot(), { force: true });
    return viable;
  }

  function scheduleViableCandidateTimers(instanceId, viable) {
    const memory = memoryFor(instanceId);
    const instance = runtimeSettings().instances[instanceId];
    const autoMs = cleanStepMs(instance?.auto_execute_silence_ms);
    const cancelMs = cleanStepMs(instance?.execute_cancel_ms);
    const now = Date.now();
    if (autoMs > 0) {
      memory.autoStartedAt = now;
      memory.autoDeadlineAt = now + autoMs;
      memory.autoRevision = viable.revision;
      memory.autoTimer = window.setTimeout(() => {
        if (memory.viable?.revision !== viable.revision) return;
        executeViableCandidate(instanceId, 'auto_execute', viable.revision).catch(() => {});
      }, autoMs);
    }
    if (cancelMs > 0) {
      memory.cancelStartedAt = now;
      memory.cancelDeadlineAt = now + cancelMs;
      memory.cancelRevision = viable.revision;
      memory.cancelTimer = window.setTimeout(() => {
        if (memory.viable?.revision !== viable.revision) return;
        clearViableCandidate(instanceId, 'execute_cancel_timer', {
          kind: 'cancel',
          stripped_text: viable.text,
          wake_word: viable.wake_word,
          command_text: 'execute_cancel_ms',
        });
      }, cancelMs);
    }
  }

  function recordCommand(instanceId, command, statusText, pending = false) {
    const memory = memoryFor(instanceId);
    memory.lastCommand = {
      kind: command?.kind || '',
      status: statusText || '',
      candidate_text: command?.stripped_text || '',
      incoming_text: command?.incoming_text || '',
      wake_word: command?.wake_word || '',
      command_text: command?.command_text || '',
      candidate_source: command?.candidate_source || '',
      candidate_finality: command?.candidate_finality || '',
      recognized_at_ms: Date.now(),
      pending: !!pending,
    };
    memory.lastStatus = statusText || memory.lastStatus;
  }

  function commandSignatureFor(instanceId, candidate, command) {
    return JSON.stringify([
      instanceId,
      command?.kind || '',
      normalizeCommandText(command?.stripped_text || ''),
      normalizeCommandText(command?.wake_word || ''),
      normalizeCommandText(command?.command_text || ''),
    ]);
  }

  function rememberCommandCandidate(instanceId, candidate, command) {
    const memory = memoryFor(instanceId);
    const signature = commandSignatureFor(instanceId, candidate, command);
    const now = Date.now();
    if (signature === memory.commandSignature && now - Number(memory.commandProcessedAtMs || 0) < 12000) {
      return false;
    }
    memory.commandSignature = signature;
    memory.commandProcessedAtMs = now;
    return true;
  }

  function clearViableCandidate(instanceId, reason, command = {}) {
    const memory = memoryFor(instanceId);
    clearWakeMemoryTimers(memory);
    const previous = memory.viable;
    memory.viable = null;
    const label = reason === 'execute_cancel_timer'
      ? 'Execute cancel timer cleared the viable candidate.'
      : 'Cancel command cleared the viable candidate.';
    recordCommand(instanceId, {
      ...command,
      kind: command.kind || 'cancel',
      stripped_text: command.stripped_text || previous?.text || '',
    }, label);
    renderWakeRuntime();
    reportDevStatus(automationSnapshot(), { force: true });
  }

  function setSendState(instanceId, patch) {
    const memory = memoryFor(instanceId);
    memory.lastSend = {
      ...memory.lastSend,
      ...patch,
      updated_at_ms: Date.now(),
    };
    if (patch.status) memory.lastStatus = patch.status;
    renderWakeRuntime();
    reportDevStatus(automationSnapshot(), { force: true });
  }

  function deliveryReadback(payload) {
    const delivery = payload?.delivery && typeof payload.delivery === 'object' ? payload.delivery : {};
    const readback = delivery.readback && typeof delivery.readback === 'object' ? delivery.readback : {};
    return { delivery, readback };
  }

  function sentStatusFromDelivery(payload, requestedMode) {
    const { delivery, readback } = deliveryReadback(payload);
    const route = cleanText(delivery.route || readback.delivery_mode || requestedMode, requestedMode);
    if (delivery.ok === false && isDirectMode(route)) {
      const reason = cleanText(delivery.fallback_reason || delivery.status || delivery.direct?.status);
      return reason
        ? `Wake To Talk direct delivery failed: ${reason}.`
        : 'Wake To Talk direct delivery failed.';
    }
    if (route === 'direct_vps') return 'Wake To Talk candidate delivered by direct VPS STT.';
    if (route === 'direct_local') return 'Wake To Talk candidate delivered by direct hermes-stt.';
    if (route === 'matrix_fallback') return 'Wake To Talk candidate used Matrix fallback.';
    if (readback.rollback_reason) return 'Wake To Talk candidate sent through Matrix after direct rollback.';
    return isDirectMode(requestedMode)
      ? 'Wake To Talk candidate sent with Matrix available as a manual option.'
      : 'Wake To Talk candidate sent through Matrix.';
  }

  async function executeViableCandidate(instanceId, commandSource, expectedRevision = '') {
    const memory = memoryFor(instanceId);
    const viable = memory.viable;
    if (!viable || (expectedRevision && viable.revision !== expectedRevision)) {
      const statusText = expectedRevision ? 'Stale viable candidate timer ignored.' : 'No viable candidate to execute.';
      recordCommand(instanceId, { kind: commandSource === 'auto_execute' ? 'auto_execute' : 'execute' }, statusText);
      setSendState(instanceId, { state: 'idle', status: statusText, error: '', command_source: commandSource });
      return null;
    }
    clearWakeMemoryTimers(memory);
    const settings = runtimeSettings();
    const instance = settings.instances[instanceId] || {};
    const roomId = cleanText(instance.matrix_room_id);
    const server = instance.matrix_server || (instanceId === 'vps' ? 'vps' : 'tb1');
    const deliveryMode = effectiveDeliveryMode(instanceId, instance);
    if (!roomId) {
      const statusText = 'No Matrix room configured for Wake To Talk candidate.';
      setSendState(instanceId, {
        state: 'error',
        status: statusText,
        error: statusText,
        server,
        room_id: '',
        command_source: commandSource,
        candidate_revision: viable.revision,
        candidate_text: viable.text,
      });
      return null;
    }

    setSendState(instanceId, {
      state: 'pending',
      status: 'Sending Wake To Talk candidate.',
      error: '',
      server,
      room_id: roomId,
      requested_delivery_mode: deliveryMode,
      delivery_mode: deliveryMode,
      direct_status: instance.direct_status || '',
      rollback_reason: '',
      fallback_reason: '',
      diagnostic_scheduled: false,
      tts_status: '',
      tts_event_id: '',
      tts_error: '',
      assistant_text: '',
      command_source: commandSource,
      candidate_revision: viable.revision,
      candidate_text: viable.text,
      event_id: '',
      body: '',
    });

    try {
      const url = `/api/v1/matrix-chat/rooms/${encodeURIComponent(roomId)}/wake-stt?server=${encodeURIComponent(server)}`;
      const response = await apiFetchCompat(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: viable.text,
          instance: instanceId,
          candidate_source: viable.source,
          command: commandSource,
          wake_word: viable.wake_word || instance.wake_word || '',
          candidate_revision: viable.revision,
          hermes_prefix: instance.hermes_prefix || '',
          delivery_mode: deliveryMode,
          direct_enabled: isDirectMode(deliveryMode),
          direct_diagnostic_enabled: isDirectMode(deliveryMode),
          direct_await_diagnostic: false,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const { delivery, readback } = deliveryReadback(payload);
      const direct = delivery.direct && typeof delivery.direct === 'object' ? delivery.direct : {};
      const tts = delivery.tts && typeof delivery.tts === 'object' ? delivery.tts : {};
      const deliveryOk = delivery.ok !== false;
      if (deliveryOk && memory.viable?.revision === viable.revision) memory.viable = null;
      setSendState(instanceId, {
        state: deliveryOk ? 'sent' : 'error',
        status: sentStatusFromDelivery(payload, deliveryMode),
        error: deliveryOk ? '' : (delivery.fallback_reason || delivery.status || direct.status || 'direct_delivery_failed'),
        server,
        room_id: roomId,
        event_id: payload.event_id || '',
        body: payload.body || '',
        requested_delivery_mode: readback.requested_delivery_mode || deliveryMode,
        delivery_mode: readback.delivery_mode || delivery.route || deliveryMode,
        direct_status: readback.direct_status || delivery.direct?.status || '',
        rollback_reason: readback.rollback_reason || '',
        fallback_reason: delivery.fallback_reason || '',
        diagnostic_scheduled: !!delivery.diagnostic_scheduled,
        tts_status: tts.status || (tts.ok ? 'queued' : (tts.error ? 'error' : '')),
        tts_event_id: tts.event_id || '',
        tts_error: tts.error || '',
        assistant_text: direct.assistant_text || '',
        command_source: commandSource,
        candidate_revision: viable.revision,
        candidate_text: viable.text,
        sent_at_ms: Date.now(),
      });
      return payload;
    } catch (error) {
      setSendState(instanceId, {
        state: 'error',
        status: 'Wake To Talk send failed.',
        error: error.message || String(error),
        server,
        room_id: roomId,
        requested_delivery_mode: deliveryMode,
        delivery_mode: deliveryMode,
        command_source: commandSource,
        candidate_revision: viable.revision,
        candidate_text: viable.text,
      });
      return null;
    }
  }

  function handleIncomingWakeCommand(instanceId, candidate, command) {
    const incomingText = cleanText(candidate?.text);
    const source = cleanText(candidate?.source);
    const sourceLabel = sourceLabelForCandidate(candidate);
    const candidateFinality = candidate?.finality || finalityForSource(source);
    const commandWithIncoming = {
      ...command,
      incoming_text: incomingText,
      candidate_source: source,
      candidate_finality: candidateFinality,
    };
    if (!rememberCommandCandidate(instanceId, { ...candidate, source, text: incomingText }, command)) {
      recordCommand(instanceId, commandWithIncoming, 'Duplicate command candidate ignored.');
      renderWakeRuntime();
      reportDevStatus(automationSnapshot(), { force: true });
      return;
    }
    if (command.kind === 'execute') {
      recordCommand(instanceId, commandWithIncoming, 'Execute command recognized.');
      const viable = command.stripped_text
        ? stageViableCandidate(instanceId, {
            text: command.stripped_text,
            source,
            source_label: sourceLabel,
            finality: candidateFinality,
            revision: candidate.revision || '',
            incoming_text: incomingText,
            stripped_command: command.kind,
            wake_word: command.wake_word,
          }, { scheduleTimers: false })
        : memoryFor(instanceId).viable;
      if (!viable) {
        recordCommand(instanceId, commandWithIncoming, 'No viable candidate to execute.');
        setSendState(instanceId, { state: 'idle', status: 'No viable candidate to execute.', error: '', command_source: 'execute' });
        return;
      }
      executeViableCandidate(instanceId, 'execute', viable.revision).catch(() => {});
      return;
    }
    if (command.kind === 'cancel') {
      clearViableCandidate(instanceId, 'cancel_command', commandWithIncoming);
      return;
    }
    recordCommand(
      instanceId,
      commandWithIncoming,
      `${command.kind === 'pause' ? 'Pause' : 'Resume'} command recognized; dictation handling is pending.`,
      true,
    );
    renderWakeRuntime();
    reportDevStatus(automationSnapshot(), { force: true });
  }

  function cancelPartialSettleForFinal(instanceId) {
    const memory = memoryFor(instanceId);
    if (!memory.partialTimer && !memory.latestPartial) return;
    clearPartialSettleTimer(memory, { clearCandidate: true });
  }

  function rememberLatestPartialCandidate(instanceId, candidate, command) {
    const memory = memoryFor(instanceId);
    const settings = runtimeSettings();
    const instance = settings.instances[instanceId] || {};
    const partialMs = cleanStepMs(instance.partial_settle_ms);
    const now = Date.now();
    const revision = nextCandidateRevision(memory, instanceId);
    clearPartialSettleTimer(memory);
    const partial = {
      text: cleanText(candidate.text),
      source: 'payload1',
      source_label: sourceLabelForCandidate(candidate),
      finality: 'settled_partial',
      instance: instanceId,
      revision,
      incoming_text: cleanText(candidate.text),
      wake_word: instance.wake_word || '',
      command_pending: !!command,
      source_updated_at_ms: Number(candidate.last_updated_at_ms || candidate.updated_at_ms || 0),
      updated_at_ms: now,
    };
    memory.latestPartial = partial;
    if (partialMs <= 0) {
      memory.lastStatus = 'Partial candidate observed; Partial Settle is Off.';
      if (command) {
        recordCommand(instanceId, {
          ...command,
          incoming_text: partial.text,
          candidate_source: 'payload1',
          candidate_finality: '',
        }, 'Partial command candidate observed; Partial Settle is Off.', true);
      }
      renderWakeRuntime();
      reportDevStatus(automationSnapshot(), { force: true });
      return;
    }
    memory.partialStartedAt = now;
    memory.partialDeadlineAt = now + partialMs;
    memory.partialRevision = revision;
    memory.lastStatus = `Partial candidate settling for ${partialMs} ms.`;
    if (command) {
      recordCommand(instanceId, {
        ...command,
        incoming_text: partial.text,
        candidate_source: 'payload1',
        candidate_finality: '',
      }, `Partial command candidate settling for ${partialMs} ms.`, true);
    }
    memory.partialTimer = window.setTimeout(() => {
      promoteSettledPartialCandidate(instanceId, revision);
    }, partialMs);
    renderWakeRuntime();
    reportDevStatus(automationSnapshot(), { force: true });
  }

  function promoteSettledPartialCandidate(instanceId, expectedRevision) {
    const memory = memoryFor(instanceId);
    const partial = memory.latestPartial;
    if (!partial || partial.revision !== expectedRevision) return null;
    clearPartialSettleTimer(memory);
    const settings = runtimeSettings();
    const instance = settings.instances[instanceId] || {};
    const promotedAt = Date.now();
    memory.lastSettledPartial = {
      ...partial,
      promoted_at_ms: promotedAt,
    };
    const command = parseWakeCommandSuffix(instance, partial.text);
    if (command) {
      handleIncomingWakeCommand(instanceId, partial, command);
      return memory.viable;
    }
    return stageViableCandidate(instanceId, {
      text: partial.text,
      source: 'payload1',
      source_label: partial.source_label,
      finality: 'settled_partial',
      revision: partial.revision,
      incoming_text: partial.incoming_text,
      wake_word: partial.wake_word || instance.wake_word || '',
    });
  }

  function processIncomingCandidate(instanceId, candidateInput) {
    const candidate = candidateInput || {};
    const source = cleanText(candidate.source);
    const text = cleanText(candidate.text);
    if (!CANDIDATE_SOURCES.has(source) || !text) return;
    const memory = memoryFor(instanceId);
    const signature = JSON.stringify([
      source,
      text,
      Number(candidate.last_updated_at_ms || candidate.updated_at_ms || 0),
      Number(candidate.updates || 0),
    ]);
    if (signature === memory.incomingSignature) return;
    memory.incomingSignature = signature;
    const settings = runtimeSettings();
    const instance = settings.instances[instanceId] || {};
    const command = parseWakeCommandSuffix(instance, text);
    if (source === 'payload1') {
      rememberLatestPartialCandidate(instanceId, { ...candidate, source, text }, command);
      return;
    }
    cancelPartialSettleForFinal(instanceId);
    if (command) {
      handleIncomingWakeCommand(instanceId, {
        ...candidate,
        source,
        text,
        finality: 'final',
      }, command);
      return;
    }
    stageViableCandidate(instanceId, {
      text,
      source,
      source_label: sourceLabelForCandidate(candidate),
      finality: 'final',
      incoming_text: text,
      wake_word: instance.wake_word || '',
    });
  }

  function syncWakeCandidatesFromRuntime(runtime) {
    INSTANCE_IDS.forEach(instanceId => {
      const instance = runtime?.instances?.[instanceId] || {};
      const candidate = instance.candidate || runtime?.candidates?.[instanceId] || {};
      processIncomingCandidate(instanceId, candidate);
    });
  }

  function wakeMemorySnapshotFor(instanceId) {
    const memory = memoryFor(instanceId);
    const settings = runtimeSettings();
    const instance = settings.instances[instanceId] || {};
    const now = Date.now();
    const viable = memory.viable ? { ...memory.viable } : null;
    const latestPartial = memory.latestPartial ? { ...memory.latestPartial } : null;
    const lastSettledPartial = memory.lastSettledPartial ? { ...memory.lastSettledPartial } : null;
    const partialRemaining = memory.partialDeadlineAt ? Math.max(0, memory.partialDeadlineAt - now) : 0;
    const autoRemaining = memory.autoDeadlineAt ? Math.max(0, memory.autoDeadlineAt - now) : 0;
    const cancelRemaining = memory.cancelDeadlineAt ? Math.max(0, memory.cancelDeadlineAt - now) : 0;
    const partialSettleMs = cleanStepMs(instance.partial_settle_ms);
    return {
      viable_candidate: viable,
      viable_candidate_text: viable?.text || '',
      viable_candidate_source: viable?.source || '',
      viable_candidate_finality: viable?.finality || '',
      viable_candidate_revision: viable?.revision || '',
      viable_candidate_created_at_ms: Number(viable?.created_at_ms || 0),
      viable_candidate_updated_at_ms: Number(viable?.updated_at_ms || 0),
      partial_settle_enabled: partialSettleMs > 0,
      partial_settle_ms: partialSettleMs,
      partial_settle_deadline_at_ms: Number(memory.partialDeadlineAt || 0),
      partial_settle_remaining_ms: partialRemaining,
      partial_settle_revision: memory.partialRevision || '',
      latest_partial_candidate: latestPartial,
      latest_partial_candidate_text: latestPartial?.text || '',
      latest_partial_candidate_updated_at_ms: Number(latestPartial?.updated_at_ms || 0),
      last_settled_partial: lastSettledPartial,
      last_settled_partial_revision: lastSettledPartial?.revision || '',
      last_settled_partial_promoted_at_ms: Number(lastSettledPartial?.promoted_at_ms || 0),
      last_command: { ...memory.lastCommand },
      last_command_kind: memory.lastCommand.kind || '',
      last_command_candidate_text: memory.lastCommand.candidate_text || '',
      last_command_candidate_source: memory.lastCommand.candidate_source || '',
      last_command_candidate_finality: memory.lastCommand.candidate_finality || '',
      auto_execute_enabled: cleanStepMs(instance.auto_execute_silence_ms) > 0,
      auto_execute_deadline_at_ms: Number(memory.autoDeadlineAt || 0),
      auto_execute_remaining_ms: autoRemaining,
      auto_execute_revision: memory.autoRevision || '',
      execute_cancel_enabled: cleanStepMs(instance.execute_cancel_ms) > 0,
      execute_cancel_deadline_at_ms: Number(memory.cancelDeadlineAt || 0),
      execute_cancel_remaining_ms: cancelRemaining,
      execute_cancel_revision: memory.cancelRevision || '',
      last_send: { ...memory.lastSend },
      last_send_status: memory.lastSend.state || 'idle',
      last_send_event_id: memory.lastSend.event_id || '',
      last_send_error: memory.lastSend.error || '',
      last_status: memory.lastStatus || '',
    };
  }

  function wakeMemorySnapshot() {
    const instances = {};
    const viableCandidates = {};
    INSTANCE_IDS.forEach(instanceId => {
      instances[instanceId] = wakeMemorySnapshotFor(instanceId);
      viableCandidates[instanceId] = instances[instanceId].viable_candidate;
    });
    return { instances, viable_candidates: viableCandidates };
  }

  function renderWakeRuntime(runtimeInput) {
    const runtime = runtimeInput || wakeRuntimeSnapshot();
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
      renderSettings(settings || vm?.getWakeSettings?.() || DEFAULT_SETTINGS, { authoritative: true });
      loadAllRooms();
      status('');
    } catch (error) {
      renderSettings(vm?.getWakeSettings?.() || DEFAULT_SETTINGS, { authoritative: true });
      loadAllRooms();
      status(`Wake settings unavailable: ${error.message || error}`);
    }
  }

  function collectSettings() {
    const next = cleanSettings(state.settings || voiceMode()?.getWakeSettings?.() || DEFAULT_SETTINGS);
    INSTANCE_IDS.forEach(instanceId => {
      const instance = next.instances[instanceId];
      instance.wake_word = cleanText(controlValue(instanceId, 'wake_word', instance.wake_word), instance.wake_word);
      instance.wake_aliases = wakeAliases(instance.wake_word, instance.wake_aliases);
      instance.hermes_prefix = cleanHermesPrefix(instance.hermes_prefix, DEFAULT_SETTINGS.instances[instanceId].hermes_prefix);
      instance.matrix_room_id = cleanText(controlValue(instanceId, 'matrix_room_id', instance.matrix_room_id));
      instance.delivery_mode = effectiveDeliveryMode(instanceId, {
        ...instance,
        delivery_mode: controlValue(instanceId, 'delivery_mode', instance.delivery_mode),
      });
      instance.direct_enabled = isDirectMode(instance.delivery_mode);
      instance.direct_requested = instance.direct_enabled;
      instance.auto_execute_silence_ms = cleanStepMs(controlValue(instanceId, 'auto_execute_silence_ms', instance.auto_execute_silence_ms));
      instance.execute_cancel_ms = cleanStepMs(controlValue(instanceId, 'execute_cancel_ms', instance.execute_cancel_ms));
      instance.partial_settle_ms = cleanStepMs(controlValue(instanceId, 'partial_settle_ms', instance.partial_settle_ms));
      instance.commands = {
        pause: cleanText(controlValue(instanceId, 'commands.pause', instance.commands.pause), DEFAULT_COMMANDS.pause),
        execute: cleanText(controlValue(instanceId, 'commands.execute', instance.commands.execute), DEFAULT_COMMANDS.execute),
        resume: cleanText(controlValue(instanceId, 'commands.resume', instance.commands.resume), DEFAULT_COMMANDS.resume),
        cancel: cleanText(controlValue(instanceId, 'commands.cancel', instance.commands.cancel), DEFAULT_COMMANDS.cancel),
      };
      renderDelayOutput(instanceId, 'auto_execute_silence_ms', instance.auto_execute_silence_ms);
      renderDelayOutput(instanceId, 'execute_cancel_ms', instance.execute_cancel_ms);
      renderDelayOutput(instanceId, 'partial_settle_ms', instance.partial_settle_ms);
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
    renderSettings(collectSettings(), { authoritative: true });
    if (state.saveTimer) window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(() => {
      state.saveTimer = null;
      saveSettings()
        .then(settings => {
          renderSettings(settings || voiceMode()?.getWakeSettings?.() || state.settings, { authoritative: true });
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
    const runtime = wakeRuntimeSnapshot();
    syncWakeCandidatesFromRuntime(runtime);
    renderWakeRuntime(runtime);
    const downstream = wakeMemorySnapshot();
    const instances = {};
    INSTANCE_IDS.forEach(instanceId => {
      instances[instanceId] = {
        ...(runtime.instances?.[instanceId] || {}),
        ...(downstream.instances?.[instanceId] || {}),
      };
    });
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
      settings: clone(runtimeSettings()),
      settings_hydrated: state.settingsHydrated,
      runtime,
      candidates: runtime.candidates || {},
      viable_candidates: downstream.viable_candidates || {},
      downstream,
      instances,
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
      viable_candidates: snapshot.viable_candidates,
      downstream: snapshot.downstream,
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
      trackActivity: false,
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
    const runtime = wakeRuntimeSnapshot();
    syncWakeCandidatesFromRuntime(runtime);
    renderWakeRuntime(runtime);
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
      renderSettings(event.detail?.wake_settings || voiceMode()?.getWakeSettings?.() || state.settings, { authoritative: true });
      if (state.open) loadAllRooms();
      renderWakeRuntime();
      poll({ force: true });
    });
    window.addEventListener(WAKE_RUNTIME_EVENT, event => {
      syncWakeCandidatesFromRuntime(event.detail?.snapshot || wakeRuntimeSnapshot());
      renderBrowserState();
      renderWakeRuntime();
      poll({ force: true });
    });
    document.addEventListener('blueprints:event', onWakeDevCommandEvent);
    els.modal.addEventListener('close', stop);
    renderSettings(voiceMode()?.getWakeSettings?.() || DEFAULT_SETTINGS);
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
    getSettings: () => clone(runtimeSettings()),
  };
})();

window.WakeDevModal = WakeDevModal;
