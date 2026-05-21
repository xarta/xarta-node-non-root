// notifier-danger2-alert.js - full-screen Danger2 alert flow for notifier-drained SSE events.

'use strict';

const BlueprintsDanger2Alert = (() => {
  const STATE_URL = '/api/v1/notifier-dnd/danger2-state';
  const CANCEL_URL = '/api/v1/notifier-dnd/danger2-cancel';
  const FRESH_SECONDS = 180;
  const POLL_MS = 1500;
  const ALARM_MS = 5000;

  let active = null;
  let pollTimer = null;
  let alarmAudio = null;
  let cancelPrimedUntil = 0;

  function el(id) {
    return document.getElementById(id);
  }

  function payload(evt) {
    return evt?.payload && typeof evt.payload === 'object' ? evt.payload : {};
  }

  function isNotifierDrained(evt) {
    const data = payload(evt);
    return Boolean(data.notifier_event_id && data.notifier_source_node);
  }

  function explicitImportance(evt) {
    if (typeof BlueprintsNotifierDnd !== 'undefined' && BlueprintsNotifierDnd.explicitImportance) {
      return BlueprintsNotifierDnd.explicitImportance(evt);
    }
    return payload(evt).importance || evt?.importance || '';
  }

  function isFresh(evt) {
    const createdAt = Number(evt?.created_at || 0);
    if (!Number.isFinite(createdAt) || createdAt <= 0) return true;
    return (Date.now() / 1000) - createdAt <= FRESH_SECONDS;
  }

  function alertText(evt) {
    const data = payload(evt);
    return String(data.speech || evt?.message || evt?.title || 'Danger two alert.');
  }

  function soundUrl(config) {
    const value = String(config?.danger_policy?.alarm_sound_path || '').trim();
    return value ? `/fallback-ui/assets/${value}` : '';
  }

  function dangerVolume(config) {
    const raw = Number(config?.danger_policy?.danger_alarm_volume ?? 1);
    return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1;
  }

  function setStatus(message, tone = '') {
    const node = el('danger2-alert-status');
    if (!node) return;
    node.textContent = message || '';
    node.dataset.tone = tone || '';
  }

  function setDetails(evt) {
    const title = el('danger2-alert-title');
    const message = el('danger2-alert-message');
    const meta = el('danger2-alert-meta');
    if (title) title.textContent = evt?.title || 'Danger2 Alert';
    if (message) message.textContent = evt?.message || alertText(evt);
    if (meta) {
      const data = payload(evt);
      meta.textContent = [
        data.notifier_event_id ? `notifier ${data.notifier_event_id}` : '',
        data.test_id ? `test ${data.test_id}` : '',
      ].filter(Boolean).join(' | ');
    }
  }

  function openModal(evt) {
    const modal = el('danger2-alert-modal');
    if (!modal) return;
    setDetails(evt);
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    if (typeof modal.showModal === 'function' && !modal.open) {
      try {
        modal.showModal();
      } catch (error) {
        setStatus(`Danger2 alert modal could not enter top layer: ${error.message || error}.`, 'error');
      }
    }
    el('danger2-alert-cancel')?.focus?.();
  }

  function closeModal() {
    const modal = el('danger2-alert-modal');
    if (!modal) return;
    if (typeof modal.close === 'function' && modal.open) {
      try { modal.close(); } catch (_) {}
    }
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
  }

  async function getCancelState() {
    const response = await apiFetch(STATE_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function cancelApplies(cancelState, evt) {
    const cancelledAt = Number(cancelState?.cancelled_at || 0);
    const createdAt = Number(evt?.created_at || 0);
    return cancelledAt > 0 && (!createdAt || cancelledAt >= createdAt);
  }

  function stopAlarmAudio() {
    if (!alarmAudio) return;
    try {
      alarmAudio.pause();
      alarmAudio.currentTime = 0;
    } catch (_) {}
    alarmAudio = null;
  }

  async function stopLocal(reason = 'cancelled') {
    if (!active) return;
    active.cancelled = true;
    stopAlarmAudio();
    try {
      if (typeof BlueprintsTtsClient !== 'undefined') await BlueprintsTtsClient.stop?.();
    } catch (_) {}
    clearPoll();
    setStatus(`Danger2 alert ${reason}.`, 'ok');
    closeModal();
    active = null;
  }

  function clearPoll() {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = null;
  }

  function startPoll() {
    clearPoll();
    pollTimer = window.setInterval(async () => {
      if (!active) {
        clearPoll();
        return;
      }
      try {
        const state = await getCancelState();
        if (cancelApplies(state, active.event)) {
          void stopLocal('cancelled from another listener');
        }
      } catch (_) {}
    }, POLL_MS);
  }

  async function playAlarmSegment(config) {
    const url = soundUrl(config);
    if (!url) {
      setStatus('No Danger2 alarm sound is configured; speaking alert text.', 'warn');
      return;
    }
    stopAlarmAudio();
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = dangerVolume(config);
    alarmAudio = audio;
    try {
      await audio.play();
      setStatus('Playing Danger2 alarm sound.', 'warn');
    } catch (error) {
      setStatus(`Browser blocked alarm autoplay: ${error.message || error}.`, 'error');
      stopAlarmAudio();
      return;
    }
    await new Promise(resolve => window.setTimeout(resolve, ALARM_MS));
    stopAlarmAudio();
  }

  async function speakAlert(config, evt) {
    if (typeof BlueprintsTtsClient === 'undefined') {
      setStatus('TTS client unavailable; alert remains active.', 'error');
      return;
    }
    try {
      setStatus('Speaking Danger2 alert text.', 'warn');
      await BlueprintsTtsClient.speak({
        text: alertText(evt),
        interrupt: true,
        mode: 'stream',
        eventKind: 'danger2',
        fallbackKind: 'danger',
        volume: dangerVolume(config),
        timeoutMs: 120000,
      });
    } catch (error) {
      if (active?.cancelled) return;
      setStatus(`Danger2 TTS failed: ${error.message || error}.`, 'error');
    }
  }

  async function alertLoop(config, evt) {
    while (active && !active.cancelled) {
      await playAlarmSegment(config);
      if (!active || active.cancelled) break;
      await speakAlert(config, evt);
    }
  }

  async function handleEvent(evt) {
    if (!evt || explicitImportance(evt) !== 'danger2') return;
    if (!isNotifierDrained(evt) || !isFresh(evt)) return;
    if (typeof BlueprintsNotifierDnd !== 'undefined') {
      await BlueprintsNotifierDnd.loadConfig();
      if (!BlueprintsNotifierDnd.shouldSpeak(evt)) return;
    }
    const config = typeof BlueprintsNotifierDnd !== 'undefined'
      ? BlueprintsNotifierDnd.getConfig()
      : {};
    try {
      const state = await getCancelState();
      if (cancelApplies(state, evt)) return;
    } catch (_) {}
    if (active) await stopLocal('replaced by a newer Danger2 alert');
    active = { event: evt, cancelled: false };
    openModal(evt);
    setStatus('Danger2 alert armed. Double-click the cancel button to stop all listeners.', 'warn');
    startPoll();
    void alertLoop(config, evt);
  }

  async function cancel(reason = 'operator_cancelled') {
    if (!active) {
      setStatus('No active local Danger2 alert. Recording cancel state anyway.', 'warn');
    }
    const response = await apiFetch(CANCEL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, source: 'blueprints-browser' }),
    });
    if (!response.ok) throw new Error(await response.text() || `HTTP ${response.status}`);
    const result = await response.json();
    await stopLocal('cancelled');
    if (result.notification_submitted === false) {
      setStatus('Danger2 cancelled locally; notifier cancellation notice failed.', 'error');
    }
    return result;
  }

  function handleCancelClick() {
    const now = Date.now();
    if (now > cancelPrimedUntil) {
      cancelPrimedUntil = now + 3000;
      setStatus('Press the cancel button again within 3 seconds to stop Danger2 everywhere.', 'warn');
      return;
    }
    cancelPrimedUntil = 0;
    void cancel('operator_double_click_cancel').catch(error => {
      setStatus(`Cancel failed: ${error.message || error}`, 'error');
    });
  }

  function bind() {
    el('danger2-alert-cancel')?.addEventListener('click', handleCancelClick);
    document.addEventListener('blueprints:event', domEvt => {
      if (domEvt.detail) void handleEvent(domEvt.detail);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }

  return Object.freeze({
    cancel,
    stopLocal,
  });
})();

window.BlueprintsDanger2Alert = BlueprintsDanger2Alert;
