// wake-queue-dev.js - read-only Wake-to-Talk queue/FSM observer.

'use strict';

const WakeQueueDev = (() => {
  const STREAM_URL = '/api/v1/voice-mode/wake-debug/stream';
  const SNAPSHOT_URL = '/api/v1/voice-mode/wake-debug';
  const FALLBACK_POLL_MS = 5000;

  const state = {
    open: false,
    eventSource: null,
    pollTimer: null,
    reconnectTimer: null,
    reconnectMs: 1500,
    lastPayload: null,
    streamConnected: false,
    fallbackActive: false,
    streamError: '',
    forceTimeSyncNext: false,
  };

  const els = {};

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setText(node, value, fallback = '--') {
    if (!node) return;
    const text = String(value ?? '').trim();
    node.textContent = text || fallback;
  }

  function formatAge(seconds) {
    const n = Number(seconds);
    if (!Number.isFinite(n)) return '--';
    return n < 10 ? `${n.toFixed(1)}s` : `${Math.round(n)}s`;
  }

  function transportLabel() {
    if (state.streamConnected) return 'wake-debug SSE stream';
    if (state.fallbackActive) {
      return state.streamError
        ? `SSE retrying: ${state.streamError}`
        : 'SSE retrying with snapshot fallback';
    }
    return 'SSE connecting';
  }

  function renderTransport() {
    setText(els.source, transportLabel());
  }

  function itemTitle(item) {
    if (!item || typeof item !== 'object') return String(item || '');
    return item.text || item.body || item.normalized_text || JSON.stringify(item);
  }

  function itemMeta(item) {
    if (!item || typeof item !== 'object') return '';
    return [
      item.normalized_text ? `norm: ${item.normalized_text}` : '',
      item.phase || '',
      item.utterance_id ? `utt ${item.utterance_id}` : '',
      Number.isFinite(Number(item.audio_end_frame)) ? `frame ${item.audio_end_frame}` : '',
      Number.isFinite(Number(item.committed_at_frame)) ? `committed ${item.committed_at_frame}` : '',
    ].filter(Boolean).join(' | ');
  }

  function renderItems(node, items, emptyText) {
    if (!node) return;
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      node.innerHTML = `<div class="wake-queue-item"><span>${escapeHtml(emptyText)}</span></div>`;
      return;
    }
    node.innerHTML = list.map(item => (
      `<div class="wake-queue-item"><strong>${escapeHtml(itemTitle(item))}</strong><span>${escapeHtml(itemMeta(item))}</span></div>`
    )).join('');
  }

  function kvRows(rows) {
    return rows.map(([key, value]) => (
      `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value == null || value === '' ? '--' : value)}</dd>`
    )).join('');
  }

  function renderKv(node, rows) {
    if (!node) return;
    node.innerHTML = kvRows(rows);
  }

  function actionDetail(action) {
    if (!action || typeof action !== 'object') return '';
    if (action.type === 'stateChanged') return `${action.next_state || ''}${action.reason ? ` (${action.reason})` : ''}`;
    if (action.type === 'wakeMatched') return `${action.instance_id || ''} ${action.wake_word || ''}`.trim();
    if (action.type === 'wakeRejected') return `${action.reason || ''}${action.text ? `: ${action.text}` : ''}`;
    if (action.type === 'inputQueued' || action.type === 'messageQueued') return action.text || '';
    if (action.type === 'commandMatched') return `${action.command || ''} via ${action.phrase || ''}`.trim();
    if (action.type === 'execute') return `${action.reason || 'send'} -> ${action.body || ''}`;
    if (action.type === 'sendSkipped') return action.reason || '';
    if (action.type === 'staleSpeechIgnored' || action.type === 'staleTimerIgnored' || action.type === 'staleSendIgnored') return JSON.stringify(action);
    return action.error || action.reason || JSON.stringify(action);
  }

  function renderActions(actions) {
    const relevant = new Set([
      'stateChanged',
      'wakeMatched',
      'wakeRejected',
      'inputQueued',
      'messageQueued',
      'commandMatched',
      'execute',
      'sendSkipped',
      'staleSpeechIgnored',
      'staleTimerIgnored',
      'staleSendIgnored',
      'controllerStarted',
      'controllerStopped',
      'machineBuilt',
    ]);
    const list = (Array.isArray(actions) ? actions : [])
      .filter(action => relevant.has(action?.type))
      .slice(-80)
      .reverse();
    if (!list.length) {
      renderItems(els.actions, [], 'No queue-related FSM actions yet.');
      return;
    }
    els.actions.innerHTML = list.map(action => {
      const at = action.at_ms ? new Date(action.at_ms).toLocaleTimeString() : '';
      return `<div class="wake-queue-item"><strong>${escapeHtml(action.type || 'action')}</strong><span>${escapeHtml(actionDetail(action))}</span><span>${escapeHtml(at)}</span></div>`;
    }).join('');
  }

  function renderStt(events) {
    const list = (Array.isArray(events) ? events : []).slice(-80).reverse();
    if (!list.length) {
      renderItems(els.stt, [], 'No STT payloads yet.');
      return;
    }
    els.stt.innerHTML = list.map(evt => {
      const title = evt.text || '(empty partial)';
      const detail = [
        evt.type || '',
        Number.isFinite(Number(evt.text_length)) ? `${evt.text_length} chars` : '',
        Number.isFinite(Number(evt.audio_frames_sent)) ? `frame ${evt.audio_frames_sent}` : '',
        evt.final_requested === true ? 'final requested' : '',
        evt.detail || '',
      ].filter(Boolean).join(' | ');
      return `<div class="wake-queue-item"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;
    }).join('');
  }

  function renderSnapshot(payload) {
    state.lastPayload = payload;
    const debug = payload?.debug || {};
    const queues = debug.queues || {};
    const diagnostics = debug.command_diagnostics || {};
    const command = diagnostics.last_command_check || {};
    const wake = diagnostics.last_wake_check || {};
    const active = payload?.active || {};
    const reporter = debug.browser_label || debug.browser_id || '';
    const activeLabel = active.browser_label || active.browser_id || '';

    renderTransport();
    setText(els.age, formatAge(payload?.age_seconds));
    setText(els.activeBrowser, activeLabel);
    setText(els.reporter, reporter || (payload?.has_debug ? 'unnamed reporter' : 'no active report'));
    setText(els.fsm, debug.fsm_state || '');
    setText(els.session, debug.session_id || '');

    renderItems(els.input, queues.raw_input_queue || queues.input_queue || [], 'Input queue empty.');
    renderItems(els.pending, queues.pending_command_items || [], 'Pending command queue empty.');
    renderItems(els.message, queues.message_queue || [], 'Message queue empty.');

    renderKv(els.command, [
      ['State', diagnostics.command_candidate_state ? 'candidate active' : 'not candidate'],
      ['Stage', command.stage || ''],
      ['Reason', command.reason || ''],
      ['Fired', command.fired === true ? 'yes' : command.matched ? 'matched but held' : 'no'],
      ['Command', command.command || ''],
      ['Phrase', command.phrase || ''],
      ['Wake word', command.wake_word || wake.wake_word || ''],
      ['Text', command.text || ''],
      ['Normalized', command.normalized_text || ''],
      ['Wake check', wake.reason || ''],
    ]);

    renderKv(els.normalized, [
      ['Input', diagnostics.normalized_input_text || ''],
      ['Pending', diagnostics.normalized_pending_command_text || ''],
      ['Messages', diagnostics.normalized_message_text || ''],
      ['Transcript', debug.transcript || ''],
      ['Pending raw', diagnostics.pending_command_text || ''],
      ['Input raw', diagnostics.input_queue_text || ''],
      ['Message raw', diagnostics.message_queue_text || ''],
    ]);

    renderKv(els.aliases, [
      ['Instance', diagnostics.active_instance_id || debug.active_instance_id || ''],
      ['Aliases', Array.isArray(command.wake_aliases) ? command.wake_aliases.join(', ') : ''],
      ['Pause', command.commands?.pause || ''],
      ['Resume', command.commands?.resume || ''],
      ['Execute', command.commands?.execute || ''],
      ['Cancel', command.commands?.cancel || ''],
    ]);

    renderStt(debug.recent_stt_events || []);
    renderActions(debug.recent_actions || []);
  }

  async function streamUrl() {
    const secret = localStorage.getItem(typeof _LS_SECRET_KEY === 'string' ? _LS_SECRET_KEY : 'blueprints_api_secret') || '';
    const forceTimeSync = state.forceTimeSyncNext;
    state.forceTimeSyncNext = false;
    const token = secret && typeof _computeApiToken === 'function'
      ? await _computeApiToken(secret, STREAM_URL, { forceTimeSync })
      : '';
    const params = new URLSearchParams();
    if (token) params.set('token', token);
    const qs = params.toString();
    return `${STREAM_URL}${qs ? `?${qs}` : ''}`;
  }

  async function pollOnce() {
    try {
      const fn = typeof apiFetch === 'function' ? apiFetch : fetch;
      const response = await fn(SNAPSHOT_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      renderSnapshot(await response.json());
    } catch (error) {
      state.streamError = `snapshot HTTP failed: ${error.message || error}`;
      renderTransport();
    }
  }

  function startFallbackPolling() {
    if (state.pollTimer) return;
    state.fallbackActive = true;
    renderTransport();
    pollOnce().catch(() => {});
    state.pollTimer = window.setInterval(() => pollOnce().catch(() => {}), FALLBACK_POLL_MS);
  }

  function stopFallbackPolling() {
    if (state.pollTimer) window.clearInterval(state.pollTimer);
    state.pollTimer = null;
    state.fallbackActive = false;
    renderTransport();
  }

  function scheduleReconnect() {
    if (!state.open || state.reconnectTimer) return;
    const delay = state.reconnectMs;
    state.reconnectMs = Math.min(30000, Math.round(state.reconnectMs * 1.7));
    state.reconnectTimer = window.setTimeout(() => {
      state.reconnectTimer = null;
      connectStream().catch(() => startFallbackPolling());
    }, delay);
  }

  async function connectStream() {
    if (!state.open || typeof EventSource === 'undefined') {
      state.streamError = typeof EventSource === 'undefined' ? 'EventSource unavailable' : '';
      startFallbackPolling();
      return;
    }
    if (state.eventSource) state.eventSource.close();
    state.streamConnected = false;
    state.streamError = '';
    renderTransport();
    const es = new EventSource(await streamUrl());
    state.eventSource = es;
    es.onopen = () => {
      if (state.eventSource !== es) return;
      state.streamConnected = true;
      state.streamError = '';
      state.reconnectMs = 1500;
      stopFallbackPolling();
      renderTransport();
    };
    es.addEventListener('wake-debug', event => {
      if (state.eventSource !== es) return;
      try {
        renderSnapshot(JSON.parse(event.data || '{}'));
      } catch (_) {}
    });
    es.onmessage = event => {
      if (state.eventSource !== es) return;
      try {
        renderSnapshot(JSON.parse(event.data || '{}'));
      } catch (_) {}
    };
    es.onerror = () => {
      if (state.eventSource !== es) return;
      es.close();
      state.eventSource = null;
      state.streamConnected = false;
      state.forceTimeSyncNext = true;
      state.streamError = 'auth token or stream retrying';
      renderTransport();
      startFallbackPolling();
      scheduleReconnect();
    };
  }

  function start() {
    if (state.open) return;
    state.open = true;
    renderTransport();
    connectStream().catch(() => startFallbackPolling());
    pollOnce().catch(() => {});
  }

  function stop() {
    state.open = false;
    if (state.eventSource) state.eventSource.close();
    if (state.reconnectTimer) window.clearTimeout(state.reconnectTimer);
    stopFallbackPolling();
    state.eventSource = null;
    state.reconnectTimer = null;
    state.reconnectMs = 1500;
    state.streamConnected = false;
    state.fallbackActive = false;
    state.streamError = '';
  }

  function open() {
    if (!els.modal) return;
    if (typeof HubModal !== 'undefined') {
      HubModal.open(els.modal, { onOpen: start, onClose: stop });
    } else if (typeof els.modal.showModal === 'function') {
      els.modal.showModal();
      start();
    }
  }

  function bind() {
    els.modal = el('wake-queue-modal');
    if (!els.modal) return;
    els.source = el('wake-queue-source');
    els.age = el('wake-queue-age');
    els.activeBrowser = el('wake-queue-active-browser');
    els.reporter = el('wake-queue-reporter');
    els.fsm = el('wake-queue-fsm');
    els.session = el('wake-queue-session');
    els.input = el('wake-queue-input');
    els.pending = el('wake-queue-pending');
    els.message = el('wake-queue-message');
    els.command = el('wake-queue-command');
    els.normalized = el('wake-queue-normalized');
    els.aliases = el('wake-queue-aliases');
    els.stt = el('wake-queue-stt');
    els.actions = el('wake-queue-actions');
    els.modal.addEventListener('close', stop);
  }

  document.addEventListener('DOMContentLoaded', bind);

  return { open, start, stop };
})();

window.WakeQueueDev = WakeQueueDev;
