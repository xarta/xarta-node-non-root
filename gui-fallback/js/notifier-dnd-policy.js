// notifier-dnd-policy.js - browser-side view of node-local notification policy.

'use strict';

const BlueprintsNotifierDnd = (() => {
  const CONFIG_URL = '/api/v1/notifier-dnd/config';
  const HEARTBEAT_URL = '/api/v1/notifier-dnd/listeners/heartbeat';
  const SPEECH_CLAIM_URL = '/api/v1/notifier-dnd/speech-claim';
  const LISTENER_PREFIX = 'blueprints.notifierDnd.listener.';
  const DESKTOP_LEADER_KEY = 'blueprints.notifierDnd.desktopLeader';
  const LISTENER_TTL_MS = 20000;
  const LISTENER_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const IMPORTANCE_RANK = Object.freeze({
    low_importance: 0,
    neutral: 1,
    urgent1: 2,
    urgent2: 3,
    danger1: 4,
    danger2: 5,
  });
  const MODE_MIN = Object.freeze({
    debug: 'low_importance',
    default: 'neutral',
    scheduled_dnd_01: 'urgent1',
    scheduled_dnd_02: 'urgent2',
    manual_dnd_1: 'urgent2',
    manual_dnd_2: 'danger2',
  });
  const DEFAULT_CONFIG = Object.freeze({
    version: 1,
    mode: 'default',
    manual_timeout_minutes: 60,
    manual_until: null,
    minimum_speak_importance: 'neutral',
    quiet_volume: 0.35,
    normal_volume: 0.85,
    debug_volume: 0.60,
    schedules: [
      { enabled: false, start: '22:00', end: '00:00', mode: 'scheduled_dnd_01' },
      { enabled: false, start: '00:00', end: '07:00', mode: 'scheduled_dnd_02' },
    ],
    listener_policy: {
      phone_wins: true,
      desktop_one_per_os_ip: true,
      android_listener_future: true,
      cloud_tts_fallback_future: true,
    },
    danger_policy: {
      danger2_alarm_planned: true,
      alarm_sound_enabled: true,
      alarm_sound_path: null,
      danger_alarm_volume: 1.0,
    },
    notes: '',
  });

  let _config = { ...DEFAULT_CONFIG };
  let _loadedAt = 0;

  function deviceKind() {
    return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '') ? 'phone' : 'desktop';
  }

  function osKey() {
    const ua = navigator.userAgent || '';
    if (/Android/i.test(ua)) return 'android';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Windows/i.test(ua)) return 'windows';
    if (/Mac OS X|Macintosh/i.test(ua)) return 'macos';
    if (/Linux/i.test(ua)) return 'linux';
    return 'unknown';
  }

  function mergeConfig(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    return {
      ...DEFAULT_CONFIG,
      ...data,
      listener_policy: { ...DEFAULT_CONFIG.listener_policy, ...(data.listener_policy || {}) },
      danger_policy: { ...DEFAULT_CONFIG.danger_policy, ...(data.danger_policy || {}) },
      schedules: Array.isArray(data.schedules) ? data.schedules : DEFAULT_CONFIG.schedules,
    };
  }

  async function loadConfig(options = {}) {
    const now = Date.now();
    if (!options.force && _loadedAt && now - _loadedAt < 30000) return _config;
    try {
      const response = await apiFetch(CONFIG_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      _config = mergeConfig(await response.json());
      _loadedAt = now;
    } catch (error) {
      console.warn('[notifier-dnd] config load failed:', error);
      _config = mergeConfig(_config);
    }
    return _config;
  }

  async function saveConfig(nextConfig) {
    const response = await apiFetch(CONFIG_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mergeConfig(nextConfig)),
    });
    if (!response.ok) throw new Error(await response.text() || `HTTP ${response.status}`);
    _config = mergeConfig(await response.json());
    _loadedAt = Date.now();
    return _config;
  }

  function timeToMinutes(value) {
    const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function scheduleActive(schedule, now = new Date()) {
    if (!schedule?.enabled) return false;
    const start = timeToMinutes(schedule.start);
    const end = timeToMinutes(schedule.end);
    if (start === null || end === null || start === end) return false;
    const current = now.getHours() * 60 + now.getMinutes();
    return start < end ? current >= start && current < end : current >= start || current < end;
  }

  function activeMode(config = _config) {
    const nowSec = Date.now() / 1000;
    if (
      (config.mode === 'manual_dnd_1' || config.mode === 'manual_dnd_2') &&
      (!config.manual_until || Number(config.manual_until) > nowSec)
    ) {
      return config.mode;
    }
    const now = new Date();
    const activeSchedules = (config.schedules || []).filter(schedule => scheduleActive(schedule, now));
    if (activeSchedules.length) return activeSchedules[activeSchedules.length - 1].mode;
    if (config.mode === 'debug') return 'debug';
    if (config.mode === 'scheduled_dnd_01' || config.mode === 'scheduled_dnd_02') return config.mode;
    return 'default';
  }

  function eventImportance(evt) {
    const raw = evt?.payload?.importance || evt?.data?.importance || evt?.importance || 'neutral';
    return Object.prototype.hasOwnProperty.call(IMPORTANCE_RANK, raw) ? raw : 'neutral';
  }

  function shouldSpeak(evt, config = _config) {
    const required = MODE_MIN[activeMode(config)] || config.minimum_speak_importance || 'neutral';
    return IMPORTANCE_RANK[eventImportance(evt)] >= IMPORTANCE_RANK[required];
  }

  function ttsVolume(evt, config = _config) {
    const mode = activeMode(config);
    if (mode === 'debug') return Number(config.debug_volume ?? 0.60);
    if (mode === 'default') return Number(config.normal_volume ?? 0.85);
    return Number(config.quiet_volume ?? 0.35);
  }

  function listenerEntries() {
    const now = Date.now();
    const entries = [];
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(LISTENER_PREFIX)) continue;
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        if (now - Number(data.ts || 0) <= LISTENER_TTL_MS) entries.push(data);
      }
    } catch (_) {}
    return entries;
  }

  function listenerPayload(extra = {}) {
    return {
      listener_id: LISTENER_ID,
      kind: deviceKind(),
      os_key: osKey(),
      ...extra,
    };
  }

  function heartbeatLocal() {
    try {
      localStorage.setItem(`${LISTENER_PREFIX}${LISTENER_ID}`, JSON.stringify({
        id: LISTENER_ID,
        kind: deviceKind(),
        ts: Date.now(),
      }));
    } catch (_) {}
  }

  async function heartbeat() {
    heartbeatLocal();
    try {
      await apiFetch(HEARTBEAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(listenerPayload()),
      });
    } catch (_) {}
  }

  function claimSpeechLocal(evt, config = _config) {
    heartbeatLocal();
    const kind = deviceKind();
    const policy = config.listener_policy || {};
    if (kind !== 'phone' && policy.phone_wins !== false) {
      if (listenerEntries().some(item => item.kind === 'phone' && item.id !== LISTENER_ID)) return false;
    }
    if (kind === 'desktop' && policy.desktop_one_per_os_ip !== false) {
      const now = Date.now();
      try {
        const leader = JSON.parse(localStorage.getItem(DESKTOP_LEADER_KEY) || '{}');
        if (leader.id && leader.id !== LISTENER_ID && now - Number(leader.ts || 0) <= LISTENER_TTL_MS) return false;
        localStorage.setItem(DESKTOP_LEADER_KEY, JSON.stringify({
          id: LISTENER_ID,
          ts: now,
          event_id: evt?.event_id || '',
        }));
      } catch (_) {}
    }
    return true;
  }

  async function claimSpeech(evt, config = _config) {
    heartbeatLocal();
    try {
      const response = await apiFetch(SPEECH_CLAIM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(listenerPayload({
          event_id: evt?.event_id || evt?.id || '',
        })),
      });
      if (response.ok) {
        const result = await response.json();
        return result.allowed !== false;
      }
    } catch (_) {}
    return claimSpeechLocal(evt, config);
  }

  heartbeat();
  window.setInterval(() => { heartbeat(); }, 5000);
  loadConfig();

  return Object.freeze({
    importanceRank: IMPORTANCE_RANK,
    modeMinimums: MODE_MIN,
    loadConfig,
    saveConfig,
    getConfig: () => _config,
    activeMode,
    shouldSpeak,
    ttsVolume,
    claimSpeech,
    eventImportance,
  });
})();

window.BlueprintsNotifierDnd = BlueprintsNotifierDnd;
