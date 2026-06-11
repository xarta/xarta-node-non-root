'use strict';

const BlueprintsAlarmClock = (() => {
  const LOCAL_KEY = 'blueprints.alarm_clock.local.v1';
  const DB_NAME = 'blueprints-alarm-assets';
  const DB_VERSION = 1;
  const DB_STORE = 'assets';
  const SLOT_COUNT = 5;
  const ALARM_LOOP_MAX_SECONDS = 120;
  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  let _local = null;
  let _server = null;
  let _activeScope = 'local';
  let _selected = { local: 0, server: 0 };
  let _serverDirty = false;
  let _serverLoading = false;
  let _serverStatus = '';
  let _localTimer = null;
  let _activeRing = null;
  let _ringPlayback = null;
  let _previewPlayback = null;
  let _sleepPlayback = null;
  let _ttsStopper = null;
  const _snoozes = new Map();

  function _els() {
    return {
      settings: document.getElementById('alarm-settings-modal'),
      ring: document.getElementById('alarm-ring-modal'),
      tabs: document.getElementById('alarm-tabs'),
      list: document.getElementById('alarm-slot-list'),
      editor: document.getElementById('alarm-slot-editor'),
      status: document.getElementById('alarm-settings-status'),
      saveServer: document.getElementById('alarm-save-server'),
      ringTime: document.getElementById('alarm-ring-time'),
      ringDesc: document.getElementById('alarm-ring-description'),
      ringSub: document.getElementById('alarm-ring-subdetail'),
      ringSnooze: document.getElementById('alarm-ring-snooze'),
      ringDismiss: document.getElementById('alarm-ring-dismiss'),
    };
  }

  function _escape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function _cleanText(value, fallback = '', max = 240) {
    const text = String(value ?? fallback).trim();
    return text.slice(0, max);
  }

  function _cleanBool(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return !!value;
    if (typeof value === 'string') return ['1', 'true', 'yes', 'on', 'enabled'].includes(value.trim().toLowerCase());
    return fallback;
  }

  function _cleanInt(value, fallback, min, max, step = 1) {
    let parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) parsed = fallback;
    parsed = Math.max(min, Math.min(max, parsed));
    if (step > 1) parsed = Math.round(parsed / step) * step;
    return Math.max(min, Math.min(max, parsed));
  }

  function _cleanFloat(value, fallback, min, max) {
    let parsed = parseFloat(value);
    if (!Number.isFinite(parsed)) parsed = fallback;
    return Math.max(min, Math.min(max, parsed));
  }

  function _cleanTime(value) {
    const text = _cleanText(value, '07:00', 16);
    const match = text.match(/^(\d{1,2}):(\d{1,2})/);
    if (!match) return '07:00';
    const hour = _cleanInt(match[1], 7, 0, 23);
    const minute = _cleanInt(match[2], 0, 0, 59);
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  function _cleanDays(value) {
    if (!Array.isArray(value)) return [0, 1, 2, 3, 4, 5, 6];
    const days = [];
    value.forEach((item) => {
      const day = _cleanInt(item, -1, -1, 6);
      if (day >= 0 && !days.includes(day)) days.push(day);
    });
    return days.length ? days.sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6];
  }

  function _cleanAssetPath(value) {
    let text = _cleanText(value, '', 512).replace(/\\/g, '/').replace(/^\/+/, '');
    if (text.startsWith('fallback-ui/assets/')) text = text.slice('fallback-ui/assets/'.length);
    if (text.startsWith('assets/')) text = text.slice('assets/'.length);
    if (text.split('/').includes('..')) return '';
    return text;
  }

  function _browserTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (_) {
      return 'UTC';
    }
  }

  function _stampSettingsTimezone(settings) {
    if (!settings || typeof settings !== 'object') return settings;
    settings.timezone = _browserTimezone();
    return settings;
  }

  function _defaultSlot(scope, index) {
    const title = scope === 'server' ? 'Server alarm' : 'Local alarm';
    return {
      slot_id: `${scope}-${index}`,
      enabled: false,
      time: '07:00',
      description: `${title} ${index}`,
      days: [0, 1, 2, 3, 4, 5, 6],
      recurring: true,
      sound_asset_path: '',
      local_asset_key: '',
      local_asset_name: '',
      fade_seconds: 0,
      volume: 0.8,
      loop_seconds: 30,
      snooze_enabled: true,
      snooze_minutes: 9,
      tts_message: '',
      tts_repeat_seconds: 20,
      last_fired_cycle: '',
    };
  }

  function _cleanSlot(rawValue, scope, index) {
    const raw = rawValue && typeof rawValue === 'object' ? rawValue : {};
    const defaults = _defaultSlot(scope, index);
    return {
      slot_id: `${scope}-${index}`,
      enabled: _cleanBool(raw.enabled, defaults.enabled),
      time: _cleanTime(raw.time || defaults.time),
      description: _cleanText(raw.description, defaults.description, 120),
      days: _cleanDays(raw.days),
      recurring: _cleanBool(raw.recurring, defaults.recurring),
      sound_asset_path: _cleanAssetPath(raw.sound_asset_path),
      local_asset_key: _cleanText(raw.local_asset_key, '', 120),
      local_asset_name: _cleanText(raw.local_asset_name, '', 180),
      fade_seconds: _cleanInt(raw.fade_seconds, 0, 0, 300, 5),
      volume: _cleanFloat(raw.volume, 0.8, 0, 1),
      loop_seconds: _cleanInt(raw.loop_seconds, 30, 5, ALARM_LOOP_MAX_SECONDS, 5),
      snooze_enabled: _cleanBool(raw.snooze_enabled, true),
      snooze_minutes: _cleanInt(raw.snooze_minutes, 9, 1, 60),
      tts_message: _cleanText(raw.tts_message, '', 500),
      tts_repeat_seconds: _cleanInt(raw.tts_repeat_seconds, 20, 5, 300, 5),
      last_fired_cycle: _cleanText(raw.last_fired_cycle, '', 100),
    };
  }

  function _cleanSleep(rawValue) {
    const raw = rawValue && typeof rawValue === 'object' ? rawValue : {};
    return {
      enabled: _cleanBool(raw.enabled, false),
      sound_asset_path: _cleanAssetPath(raw.sound_asset_path),
      local_asset_key: _cleanText(raw.local_asset_key, 'alarm-local-sleep', 120) || 'alarm-local-sleep',
      local_asset_name: _cleanText(raw.local_asset_name, '', 180),
      volume: _cleanFloat(raw.volume, 0.45, 0, 1),
    };
  }

  function _defaultSettings(scope) {
    return {
      schema: `xarta.alarm_clock.${scope}.v1`,
      timezone: _browserTimezone(),
      slots: Array.from({ length: SLOT_COUNT }, (_, i) => _defaultSlot(scope, i + 1)),
      sleep: _cleanSleep({}),
      updated_at: Date.now() / 1000,
    };
  }

  function _cleanSettings(value, scope) {
    const raw = value && typeof value === 'object' ? value : {};
    const slotsRaw = Array.isArray(raw.slots) ? raw.slots : [];
    const clean = {
      schema: `xarta.alarm_clock.${scope}.v1`,
      timezone: _cleanText(raw.timezone, _browserTimezone(), 80),
      slots: Array.from({ length: SLOT_COUNT }, (_, i) => _cleanSlot(slotsRaw[i], scope, i + 1)),
      updated_at: Number(raw.updated_at || Date.now() / 1000),
    };
    if (scope === 'local') clean.sleep = _cleanSleep(raw.sleep);
    return clean;
  }

  function _loadLocal() {
    try {
      const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
      _local = _cleanSettings(raw, 'local');
    } catch (_) {
      _local = _defaultSettings('local');
    }
    return _local;
  }

  function _saveLocal() {
    if (!_local) _loadLocal();
    _stampSettingsTimezone(_local);
    _local.updated_at = Date.now() / 1000;
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(_local));
    } catch (error) {
      _setStatus(`Local save failed: ${_cleanText(error?.message || error, '', 120)}`, 'warn');
    }
  }

  function _assetPathUrl(path) {
    const clean = _cleanAssetPath(path);
    if (!clean) return '';
    return `/fallback-ui/assets/${clean.split('/').map(encodeURIComponent).join('/')}`;
  }

  function _openDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    });
  }

  async function _idbGet(key) {
    const db = await _openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const req = tx.objectStore(DB_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error || new Error('IndexedDB get failed'));
      });
    } finally {
      db.close();
    }
  }

  async function _idbPut(record) {
    const db = await _openDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('IndexedDB put failed'));
      });
    } finally {
      db.close();
    }
  }

  async function _storeBlob(key, blob, meta = {}) {
    if (!key || !blob) return;
    await _idbPut({
      key,
      blob,
      name: _cleanText(meta.name, '', 180),
      type: _cleanText(meta.type || blob.type, '', 120),
      asset_path: _cleanAssetPath(meta.assetPath || ''),
      updated_at: Date.now(),
    });
  }

  async function _storeAssetPathOffline(key, path) {
    const url = _assetPathUrl(path);
    if (!key || !url) return;
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`sound fetch HTTP ${resp.status}`);
    const blob = await resp.blob();
    const name = _cleanAssetPath(path).split('/').pop() || 'alarm-sound';
    await _storeBlob(key, blob, { name, type: blob.type, assetPath: path });
  }

  async function _resolveAudioUrl(config) {
    if (config?.local_asset_key) {
      try {
        const record = await _idbGet(config.local_asset_key);
        if (record?.blob) {
          const url = URL.createObjectURL(record.blob);
          return { url, revoke: () => URL.revokeObjectURL(url) };
        }
      } catch (error) {
        console.warn('[alarm-clock] offline sound unavailable:', error);
      }
    }
    const url = _assetPathUrl(config?.sound_asset_path || '');
    return url ? { url, revoke: null } : null;
  }

  function _stopPlayback(playback) {
    if (!playback) return;
    clearInterval(playback.fadeTimer);
    clearTimeout(playback.stopTimer);
    try {
      playback.audio.pause();
      playback.audio.currentTime = 0;
    } catch (_) {}
    try { playback.revoke?.(); } catch (_) {}
  }

  async function _playAudio(config, options = {}) {
    const resolved = await _resolveAudioUrl(config);
    if (!resolved?.url) return null;
    const audio = new Audio(resolved.url);
    const targetVolume = _cleanFloat(config.volume, 0.8, 0, 1);
    const fadeSeconds = options.fade === false ? 0 : _cleanInt(config.fade_seconds, 0, 0, 300, 5);
    audio.loop = options.loop !== false;
    audio.volume = fadeSeconds > 0 ? 0 : targetVolume;
    const playback = { audio, revoke: resolved.revoke, fadeTimer: null, stopTimer: null };
    await audio.play();
    if (fadeSeconds > 0) {
      const started = Date.now();
      playback.fadeTimer = setInterval(() => {
        const ratio = Math.min(1, (Date.now() - started) / (fadeSeconds * 1000));
        audio.volume = targetVolume * ratio;
        if (ratio >= 1) {
          clearInterval(playback.fadeTimer);
          playback.fadeTimer = null;
        }
      }, 250);
    }
    const stopAfterMs = Number(options.stopAfterMs);
    if (Number.isFinite(stopAfterMs) && stopAfterMs > 0) {
      playback.stopTimer = setTimeout(() => {
        _stopPlayback(playback);
        if (_ringPlayback === playback) _ringPlayback = null;
        if (_previewPlayback === playback) _previewPlayback = null;
      }, stopAfterMs);
    }
    return playback;
  }

  function _timeParts(time) {
    const clean = _cleanTime(time);
    return clean.split(':');
  }

  function _flipHtml(time) {
    const [hour, minute] = _timeParts(time);
    return `<div class="alarm-flip" aria-label="${_escape(time)}">
      <div class="alarm-flip-card"><span>${_escape(hour)}</span></div>
      <div class="alarm-flip-card"><span>${_escape(minute)}</span></div>
    </div>`;
  }

  function _formatDays(days) {
    const clean = _cleanDays(days);
    if (clean.length === 7) return 'Every day';
    if (clean.length === 2 && clean.includes(0) && clean.includes(6)) return 'Weekends';
    if (clean.length === 5 && [1, 2, 3, 4, 5].every((day) => clean.includes(day))) return 'Weekdays';
    return clean.map((day) => DAY_LABELS[day]).join(', ');
  }

  function _scheduleLabel(slot) {
    if (!slot?.recurring) return 'One-shot';
    return _formatDays(slot.days);
  }

  function _currentSettings() {
    if (_activeScope === 'server') {
      if (!_server) _server = _defaultSettings('server');
      return _server;
    }
    if (!_local) _loadLocal();
    return _local;
  }

  function _currentSlot() {
    const settings = _currentSettings();
    const index = _selected[_activeScope] || 0;
    return settings.slots[index] || settings.slots[0];
  }

  function _setStatus(message, tone = '') {
    const status = _els().status;
    if (!status) return;
    status.textContent = message || '';
    status.style.color = tone === 'warn' ? 'var(--warn, #f59e0b)' : 'var(--text-dim, #9aa3b2)';
  }

  function _renderTabs() {
    const tabs = _els().tabs;
    if (!tabs) return;
    tabs.querySelectorAll('.alarm-tab').forEach((button) => {
      const active = button.dataset.scope === _activeScope;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function _renderSlotList() {
    const list = _els().list;
    if (!list) return;
    const settings = _currentSettings();
    list.innerHTML = settings.slots.map((slot, index) => {
      const active = index === (_selected[_activeScope] || 0);
      const disabled = !slot.enabled;
      const soundName = slot.local_asset_name || slot.sound_asset_path?.split('/').pop() || 'No sound';
      return `<button class="alarm-slot-button${active ? ' is-active' : ''}" type="button" data-alarm-slot="${index}" aria-disabled="${disabled ? 'true' : 'false'}">
        ${_flipHtml(slot.time)}
        <span class="alarm-slot-meta">
          <span class="alarm-slot-title">${_escape(slot.description || `Alarm ${index + 1}`)}</span>
          <span class="alarm-slot-days">${_escape(_scheduleLabel(slot))}${slot.enabled ? '' : ' / Off'}</span>
          <span class="alarm-slot-days">${_escape(soundName)}</span>
        </span>
      </button>`;
    }).join('');
  }

  function _dayInputs(slot) {
    const days = new Set(_cleanDays(slot.days));
    return DAY_LABELS.map((label, day) => `<label class="hub-checkbox alarm-day">
      <input class="hub-checkbox__input" type="checkbox" data-day="${day}" ${days.has(day) ? 'checked' : ''}>
      <span class="hub-checkbox__box" aria-hidden="true"></span>
      <span class="hub-checkbox__label">${label.slice(0, 3)}</span>
    </label>`).join('');
  }

  function _rangeField(label, field, value, min, max, step, suffix) {
    return `<label class="alarm-field">
      <span>${label}: <output data-output-for="${field}">${_escape(value)}${suffix}</output></span>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${_escape(value)}" data-field="${field}">
    </label>`;
  }

  function _hubCheckbox(label, attrs, checked) {
    return `<label class="hub-checkbox alarm-check-row">
      <input class="hub-checkbox__input" type="checkbox" ${attrs} ${checked ? 'checked' : ''}>
      <span class="hub-checkbox__box" aria-hidden="true"></span>
      <span class="hub-checkbox__label">${_escape(label)}</span>
    </label>`;
  }

  function _renderEditor() {
    const editor = _els().editor;
    if (!editor) return;
    const scope = _activeScope;
    const slot = _currentSlot();
    const soundLabel = slot.local_asset_name || slot.sound_asset_path || 'No sound selected';
    const serverExtra = scope === 'server' ? `
      <label class="alarm-field" style="grid-column:1/-1">
        <span>TTS message</span>
        <textarea data-field="tts_message" rows="3">${_escape(slot.tts_message || '')}</textarea>
      </label>
      ${_rangeField('TTS repeat', 'tts_repeat_seconds', slot.tts_repeat_seconds, 5, 300, 5, 's')}
    ` : '';
    const localFile = scope === 'local' ? `
      <button class="hub-modal-btn secondary" type="button" data-alarm-file-button="slot">Local File</button>
      <input class="alarm-file-input" type="file" accept="audio/*" data-alarm-file="slot" hidden>
    ` : '';
    editor.innerHTML = `
      <div class="alarm-editor-head">
        ${_flipHtml(slot.time)}
        <div class="alarm-editor-summary">
          ${_hubCheckbox('Enabled', 'data-field="enabled"', slot.enabled)}
          ${_hubCheckbox('Recurring', 'data-field="recurring"', slot.recurring)}
          ${_hubCheckbox('Permit snooze', 'data-field="snooze_enabled"', slot.snooze_enabled)}
        </div>
      </div>
      <div class="alarm-field-grid">
        <div class="alarm-primary-fields">
        <label class="alarm-field alarm-time-field">
          <span>Time</span>
          <input type="time" data-field="time" value="${_escape(slot.time)}">
        </label>
        <label class="alarm-field alarm-description-field">
          <span>Description</span>
          <input type="text" data-field="description" value="${_escape(slot.description)}" maxlength="120">
        </label>
        </div>
        ${_rangeField('Volume', 'volume', slot.volume, 0, 1, 0.01, '')}
        ${_rangeField('Fade in', 'fade_seconds', slot.fade_seconds, 0, 300, 5, 's')}
        ${_rangeField('Loop stop', 'loop_seconds', slot.loop_seconds, 5, ALARM_LOOP_MAX_SECONDS, 5, 's')}
        ${_rangeField('Snooze', 'snooze_minutes', slot.snooze_minutes, 1, 60, 1, 'm')}
        ${serverExtra}
      </div>
      <div class="alarm-days">
        <div class="alarm-days-title">Days</div>
        <div class="alarm-day-row">${_dayInputs(slot)}</div>
      </div>
      <div class="alarm-field">
        <span>Sound</span>
        <div class="alarm-audio-controls">
          <button class="hub-modal-btn secondary" type="button" data-alarm-pick="slot">Choose Sound</button>
          <button class="hub-modal-btn secondary" type="button" data-alarm-preview="slot">Preview</button>
          ${localFile}
        </div>
        <span class="alarm-field-note">${_escape(soundLabel)}</span>
      </div>
      ${scope === 'local' ? _sleepPanelHtml() : ''}
    `;
  }

  function _sleepPanelHtml() {
    const sleep = _cleanSleep(_local?.sleep);
    const soundLabel = sleep.local_asset_name || sleep.sound_asset_path || 'No sound selected';
    const playing = !!_sleepPlayback;
    return `<section class="alarm-sleep-panel">
      <div class="alarm-field-grid">
        ${_hubCheckbox('Sleep sound enabled', 'data-sleep-field="enabled"', sleep.enabled)}
        ${_rangeField('Sleep volume', 'sleep.volume', sleep.volume, 0, 1, 0.01, '')}
      </div>
      <div class="alarm-field">
        <span>Sleep sound</span>
        <div class="alarm-audio-controls">
          <button class="hub-modal-btn secondary" type="button" data-alarm-pick="sleep">Choose Sound</button>
          <button class="hub-modal-btn secondary" type="button" data-alarm-file-button="sleep">Local File</button>
          <button class="hub-modal-btn secondary" type="button" data-sleep-toggle>${playing ? 'Stop Loop' : 'Start Loop'}</button>
          <input class="alarm-file-input" type="file" accept="audio/*" data-alarm-file="sleep" hidden>
        </div>
        <span class="alarm-field-note">${_escape(soundLabel)}</span>
      </div>
    </section>`;
  }

  function _renderFooter() {
    const saveServer = _els().saveServer;
    if (saveServer) {
      saveServer.hidden = _activeScope !== 'server';
      saveServer.disabled = _serverLoading;
      saveServer.textContent = _serverDirty ? 'Save Server' : 'Server Saved';
    }
    if (_activeScope === 'server') {
      _setStatus(_serverStatus || (_serverDirty ? 'Server changes pending.' : 'Server settings loaded.'));
    } else {
      _setStatus('Local alarms and sleep sound are stored in this browser.');
    }
  }

  function _render() {
    _renderTabs();
    _renderSlotList();
    _renderEditor();
    _renderFooter();
  }

  async function _loadServerSettings(force = false) {
    if (_serverLoading || (_server && !force)) return;
    _serverLoading = true;
    _serverStatus = 'Loading server alarms...';
    _renderFooter();
    try {
      const resp = await apiFetch('/api/v1/alarms/server-settings');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      _server = _cleanSettings(data.settings, 'server');
      _serverDirty = false;
      _serverStatus = 'Server settings loaded.';
    } catch (error) {
      if (!_server) _server = _defaultSettings('server');
      _serverStatus = `Server alarm API unavailable: ${_cleanText(error?.message || error, '', 120)}`;
    } finally {
      _serverLoading = false;
      if (_activeScope === 'server') _render();
    }
  }

  async function _saveServerSettings() {
    if (!_server) return;
    _stampSettingsTimezone(_server);
    _serverStatus = 'Saving server alarms...';
    _renderFooter();
    try {
      const resp = await apiFetch('/api/v1/alarms/server-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: _server }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      _server = _cleanSettings(data.settings, 'server');
      _serverDirty = false;
      _serverStatus = 'Server settings saved.';
    } catch (error) {
      _serverStatus = `Server save failed: ${_cleanText(error?.message || error, '', 120)}`;
    }
    _render();
  }

  function _markChanged() {
    if (_activeScope === 'local') {
      _saveLocal();
      _renderSlotList();
      _renderFooter();
      return;
    }
    _serverDirty = true;
    _stampSettingsTimezone(_server);
    _renderSlotList();
    _renderFooter();
  }

  function _refreshEditorFlip(time) {
    const flip = document.querySelector('#alarm-slot-editor .alarm-editor-head .alarm-flip');
    if (flip) flip.outerHTML = _flipHtml(time);
  }

  function _updateSlotField(field, value) {
    const slot = _currentSlot();
    if (!slot) return;
    if (field === 'enabled' || field === 'recurring' || field === 'snooze_enabled') {
      slot[field] = !!value;
    } else if (field === 'time') {
      slot.time = _cleanTime(value);
      slot.last_fired_cycle = '';
    } else if (field === 'description') {
      slot.description = _cleanText(value, slot.description, 120);
    } else if (field === 'volume') {
      slot.volume = _cleanFloat(value, slot.volume, 0, 1);
    } else if (field === 'fade_seconds') {
      slot.fade_seconds = _cleanInt(value, slot.fade_seconds, 0, 300, 5);
    } else if (field === 'loop_seconds') {
      slot.loop_seconds = _cleanInt(value, slot.loop_seconds, 5, ALARM_LOOP_MAX_SECONDS, 5);
    } else if (field === 'snooze_minutes') {
      slot.snooze_minutes = _cleanInt(value, slot.snooze_minutes, 1, 60);
    } else if (field === 'tts_message') {
      slot.tts_message = _cleanText(value, '', 500);
    } else if (field === 'tts_repeat_seconds') {
      slot.tts_repeat_seconds = _cleanInt(value, slot.tts_repeat_seconds, 5, 300, 5);
    }
    _markChanged();
    if (field === 'time') _refreshEditorFlip(slot.time);
  }

  function _updateOutput(input) {
    const field = input?.dataset?.field || '';
    const output = document.querySelector(`[data-output-for="${_cssEscape(field)}"]`);
    if (!output) return;
    let suffix = '';
    if (field === 'fade_seconds' || field === 'loop_seconds' || field === 'tts_repeat_seconds') suffix = 's';
    if (field === 'snooze_minutes') suffix = 'm';
    output.textContent = `${input.value}${suffix}`;
  }

  function _updateSleepField(field, value) {
    if (!_local) _loadLocal();
    _local.sleep = _cleanSleep(_local.sleep);
    if (field === 'enabled') _local.sleep.enabled = !!value;
    if (field === 'volume') {
      _local.sleep.volume = _cleanFloat(value, _local.sleep.volume, 0, 1);
      if (_sleepPlayback?.audio) _sleepPlayback.audio.volume = _local.sleep.volume;
    }
    _saveLocal();
    _renderFooter();
  }

  function _updateDays() {
    const slot = _currentSlot();
    if (!slot) return;
    const checked = Array.from(document.querySelectorAll('#alarm-slot-editor [data-day]:checked'))
      .map((input) => _cleanInt(input.dataset.day, -1, -1, 6))
      .filter((day) => day >= 0);
    slot.days = _cleanDays(checked);
    _markChanged();
  }

  async function _chooseSound(kind) {
    if (typeof AssetPicker === 'undefined') {
      _setStatus('Sound picker unavailable.', 'warn');
      return;
    }
    AssetPicker.open({
      kind: 'sound',
      browseUrl: '/api/v1/nav-items/assets?type=sounds',
      title: kind === 'sleep' ? 'Choose Sleep Sound' : 'Choose Alarm Sound',
      emptyMessage: 'No sound assets uploaded yet.',
      onSelect: async (path) => {
        await _assignSound(kind, path);
      },
    });
  }

  async function _assignSound(kind, path) {
    const clean = _cleanAssetPath(path);
    if (!clean) return;
    if (kind === 'sleep') {
      if (!_local) _loadLocal();
      _local.sleep = _cleanSleep(_local.sleep);
      _local.sleep.sound_asset_path = clean;
      _local.sleep.local_asset_key = 'alarm-local-sleep';
      _local.sleep.local_asset_name = clean.split('/').pop() || clean;
      _saveLocal();
      _render();
      try {
        await _storeAssetPathOffline(_local.sleep.local_asset_key, clean);
        _setStatus('Sleep sound copied for offline playback.');
      } catch (error) {
        _setStatus(`Sleep sound selected; offline copy failed: ${_cleanText(error?.message || error, '', 120)}`, 'warn');
      }
      return;
    }
    const slot = _currentSlot();
    slot.sound_asset_path = clean;
    if (_activeScope === 'local') {
      slot.local_asset_key = `alarm-local-${slot.slot_id}`;
      slot.local_asset_name = clean.split('/').pop() || clean;
      _saveLocal();
      _render();
      try {
        await _storeAssetPathOffline(slot.local_asset_key, clean);
        _setStatus('Alarm sound copied for offline playback.');
      } catch (error) {
        _setStatus(`Alarm sound selected; offline copy failed: ${_cleanText(error?.message || error, '', 120)}`, 'warn');
      }
    } else {
      _serverDirty = true;
      _setStatus('Server sound selected. Save server settings to apply.');
      _render();
    }
  }

  async function _assignFile(kind, file) {
    if (!file) return;
    if (kind === 'sleep') {
      if (!_local) _loadLocal();
      _local.sleep = _cleanSleep(_local.sleep);
      _local.sleep.sound_asset_path = '';
      _local.sleep.local_asset_key = 'alarm-local-sleep';
      _local.sleep.local_asset_name = file.name || 'Local sleep sound';
      await _storeBlob(_local.sleep.local_asset_key, file, { name: _local.sleep.local_asset_name, type: file.type });
      _saveLocal();
      _render();
      _setStatus('Sleep sound saved for offline playback.');
      return;
    }
    const slot = _currentSlot();
    if (_activeScope !== 'local') return;
    slot.sound_asset_path = '';
    slot.local_asset_key = `alarm-local-${slot.slot_id}`;
    slot.local_asset_name = file.name || `Alarm ${_selected.local + 1} sound`;
    await _storeBlob(slot.local_asset_key, file, { name: slot.local_asset_name, type: file.type });
    _saveLocal();
    _render();
    _setStatus('Alarm sound saved for offline playback.');
  }

  async function _preview(kind) {
    _stopPlayback(_previewPlayback);
    _previewPlayback = null;
    const config = kind === 'sleep' ? _local?.sleep : _currentSlot();
    if (!config) return;
    try {
      _previewPlayback = await _playAudio({ ...config, fade_seconds: 0 }, { loop: false, fade: false, stopAfterMs: 8000 });
    } catch (error) {
      _setStatus(`Preview failed: ${_cleanText(error?.message || error, '', 120)}`, 'warn');
    }
  }

  async function _toggleSleep() {
    if (_sleepPlayback) {
      _stopPlayback(_sleepPlayback);
      _sleepPlayback = null;
      _renderEditor();
      return;
    }
    if (!_local) _loadLocal();
    try {
      _sleepPlayback = await _playAudio({ ..._local.sleep, fade_seconds: 0 }, { loop: true, fade: false });
      _renderEditor();
    } catch (error) {
      _setStatus(`Sleep sound failed: ${_cleanText(error?.message || error, '', 120)}`, 'warn');
    }
  }

  function _cycleId(slot, date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${slot.slot_id}:${y}-${m}-${d}T${slot.time}`;
  }

  function _tickLocalAlarms() {
    if (!_local) _loadLocal();
    const now = new Date();
    const nowMs = now.getTime();
    const minute = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    for (const [key, entry] of Array.from(_snoozes.entries())) {
      if (nowMs < entry.dueAtMs) continue;
      _snoozes.delete(key);
      void _ring({
        scope: entry.scope,
        slot: entry.slot,
        cycle_id: `${entry.cycle_id || entry.slot.slot_id}:snooze:${entry.dueAtMs}`,
        source: 'snooze',
      });
      return;
    }
    for (const slot of _local.slots) {
      if (!slot.enabled || slot.time !== minute) continue;
      if (!slot.days.includes(now.getDay())) continue;
      const cycle = _cycleId(slot, now);
      if (slot.last_fired_cycle === cycle) continue;
      slot.last_fired_cycle = cycle;
      if (!slot.recurring) slot.enabled = false;
      _saveLocal();
      if (_activeScope === 'local') _render();
      void _ring({ scope: 'local', slot: { ...slot }, cycle_id: cycle, source: 'local_scheduler' });
      return;
    }
  }

  function _startLocalScheduler() {
    if (_localTimer) return;
    _localTimer = setInterval(_tickLocalAlarms, 1000);
    _tickLocalAlarms();
  }

  function _stopActiveRingSound() {
    _stopPlayback(_ringPlayback);
    _ringPlayback = null;
    if (_ttsStopper) {
      _ttsStopper();
      _ttsStopper = null;
    }
    if (typeof window.BlueprintsTtsClient?.stop === 'function') {
      window.BlueprintsTtsClient.stop().catch(() => {});
    }
  }

  function _startTts(slot) {
    const text = _cleanText(slot.tts_message, '', 500);
    if (!text || typeof window.BlueprintsTtsClient?.speak !== 'function') return null;
    const repeatMs = _cleanInt(slot.tts_repeat_seconds, 20, 5, 300, 5) * 1000;
    let stopped = false;
    const speak = () => {
      if (stopped) return;
      window.BlueprintsTtsClient.speak({
        text,
        interrupt: false,
        eventKind: 'alarm',
        timingLabel: 'server-alarm',
      }).catch(() => {});
    };
    speak();
    const timer = setInterval(speak, repeatMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  async function _ring({ scope, slot, cycle_id, source }) {
    const cleanScope = scope === 'server' ? 'server' : 'local';
    const cleanSlot = _cleanSlot(slot, cleanScope, parseInt(String(slot?.slot_id || '').split('-').pop(), 10) || 1);
    _stopActiveRingSound();
    _activeRing = {
      scope: cleanScope,
      slot: cleanSlot,
      cycle_id: _cleanText(cycle_id, `${cleanSlot.slot_id}:${Date.now()}`, 160),
      source: _cleanText(source, cleanScope, 60),
      started_at: Date.now(),
    };
    _renderRing();
    _showToast('Alarm', cleanSlot.description || 'Alarm', 'warning');
    try {
      _ringPlayback = await _playAudio(cleanSlot, {
        loop: true,
        stopAfterMs: _cleanInt(cleanSlot.loop_seconds, 30, 5, ALARM_LOOP_MAX_SECONDS, 5) * 1000,
      });
    } catch (error) {
      _setRingSub(`Sound failed: ${_cleanText(error?.message || error, '', 120)}`);
    }
    if (cleanScope === 'server') _ttsStopper = _startTts(cleanSlot);
    const modal = _els().ring;
    if (modal) {
      if (typeof HubModal !== 'undefined') HubModal.open(modal);
      else if (!modal.open) modal.showModal();
    }
  }

  function _setRingSub(message) {
    const sub = _els().ringSub;
    if (sub) sub.textContent = message || '';
  }

  function _renderRing() {
    const els = _els();
    if (!els.ring || !_activeRing) return;
    const now = new Date();
    const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (els.ringTime) els.ringTime.innerHTML = _flipHtml(nowTime);
    if (els.ringDesc) els.ringDesc.textContent = _activeRing.slot.description || 'Alarm';
    if (els.ringSub) els.ringSub.textContent = `${_activeRing.scope.toUpperCase()} / ${_scheduleLabel(_activeRing.slot)}`;
    if (els.ringSnooze) els.ringSnooze.disabled = !_activeRing.slot.snooze_enabled;
  }

  function _closeRingModal() {
    const modal = _els().ring;
    if (!modal?.open) return;
    if (typeof HubModal !== 'undefined') HubModal.close(modal);
    else modal.close();
  }

  function dismiss(source = 'button') {
    if (!_activeRing) return false;
    const desc = _activeRing.slot.description || 'Alarm';
    _stopActiveRingSound();
    _activeRing = null;
    _closeRingModal();
    _showToast('Alarm dismissed', desc, 'info');
    return true;
  }

  function snooze(source = 'button') {
    if (!_activeRing || !_activeRing.slot.snooze_enabled) return false;
    const ring = _activeRing;
    const minutes = _cleanInt(ring.slot.snooze_minutes, 9, 1, 60);
    _snoozes.set(`${ring.scope}:${ring.slot.slot_id}`, {
      scope: ring.scope,
      slot: { ...ring.slot },
      cycle_id: ring.cycle_id,
      dueAtMs: Date.now() + minutes * 60 * 1000,
      source,
    });
    _stopActiveRingSound();
    _activeRing = null;
    _closeRingModal();
    _showToast('Alarm snoozed', `${ring.slot.description || 'Alarm'} / ${minutes} min`, 'info');
    return true;
  }

  function _showToast(title, message, severity = 'info') {
    let container = document.getElementById('bp-event-toasts');
    if (!container) {
      container = document.createElement('div');
      container.id = 'bp-event-toasts';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `bp-event-toast bp-event-toast--${severity}`;
    toast.setAttribute('role', 'status');
    toast.innerHTML = `<div class="bp-event-toast__body">
      <div class="bp-event-toast__title">${_escape(title)}</div>
      <div class="bp-event-toast__msg">${_escape(message)}</div>
    </div>
    <button class="bp-event-toast__close" type="button" aria-label="Dismiss">x</button>`;
    toast.querySelector('button')?.addEventListener('click', () => toast.remove());
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('bp-event-toast--visible'));
    setTimeout(() => {
      toast.classList.remove('bp-event-toast--visible');
      toast.addEventListener('transitionend', () => toast.remove(), { once: true });
      setTimeout(() => toast.remove(), 500);
    }, 7000);
  }

  function _eventPayload(event) {
    const parsed = event?.detail || event || {};
    return parsed.payload && typeof parsed.payload === 'object' ? parsed.payload : {};
  }

  function _onBlueprintsEvent(event) {
    const parsed = event?.detail || {};
    if (parsed.event_type === 'alarm.ring') {
      const payload = _eventPayload(event);
      void _ring({
        scope: payload.scope || 'server',
        slot: payload.slot || {},
        cycle_id: payload.cycle_id || parsed.event_id,
        source: 'sse',
      });
      return;
    }
    if (parsed.event_type !== 'alarm.control') return;
    applyCommand(_eventPayload(event));
  }

  function applyCommand(payload = {}) {
    const action = _cleanText(payload.action, '', 80).replace(/[-\s]+/g, '_');
    if (action === 'dismiss') {
      dismiss('sse');
      return true;
    }
    if (action === 'snooze') {
      snooze('sse');
      return true;
    }
    if (action === 'open_settings') {
      openSettings({ source: 'sse' });
      return true;
    }
    if (action === 'reset_connectivity_dismissal') {
      resetConnectivityDismissal();
      return true;
    }
    if (action === 'update_local_settings' && payload.settings) {
      setLocalSettings(payload.settings);
      return true;
    }
    if (action === 'update_local_slot' && payload.slot) {
      updateLocalSlot(payload.slot);
      return true;
    }
    if (action === 'update_sleep' && payload.sleep) {
      updateSleep(payload.sleep);
      return true;
    }
    return false;
  }

  function setLocalSettings(settings) {
    _local = _cleanSettings(settings, 'local');
    _saveLocal();
    _render();
    return _local;
  }

  function updateLocalSlot(slotPatch) {
    if (!_local) _loadLocal();
    const raw = slotPatch && typeof slotPatch === 'object' ? slotPatch : {};
    const slotId = _cleanText(raw.slot_id, '', 80);
    const index = Math.max(0, _local.slots.findIndex((slot) => slot.slot_id === slotId));
    const targetIndex = index >= 0 ? index : 0;
    _local.slots[targetIndex] = _cleanSlot({ ..._local.slots[targetIndex], ...raw }, 'local', targetIndex + 1);
    _saveLocal();
    if (_local.slots[targetIndex].sound_asset_path && _local.slots[targetIndex].local_asset_key) {
      _storeAssetPathOffline(_local.slots[targetIndex].local_asset_key, _local.slots[targetIndex].sound_asset_path).catch(() => {});
    }
    _render();
    return _local.slots[targetIndex];
  }

  function updateSleep(sleepPatch) {
    if (!_local) _loadLocal();
    _local.sleep = _cleanSleep({ ..._local.sleep, ...(sleepPatch || {}) });
    _saveLocal();
    if (_local.sleep.sound_asset_path && _local.sleep.local_asset_key) {
      _storeAssetPathOffline(_local.sleep.local_asset_key, _local.sleep.sound_asset_path).catch(() => {});
    }
    _render();
    return _local.sleep;
  }

  function resetConnectivityDismissal() {
    if (typeof window.BlueprintsConnectivity?.resetDiagnosticDismissal === 'function') {
      window.BlueprintsConnectivity.resetDiagnosticDismissal();
      _setStatus('Connection modal dismissal reset.');
      return true;
    }
    try {
      localStorage.removeItem('bp_diag_dismiss_until');
      _setStatus('Connection modal dismissal reset.');
      return true;
    } catch (_) {
      return false;
    }
  }

  function getLocalSettings() {
    if (!_local) _loadLocal();
    return JSON.parse(JSON.stringify(_local));
  }

  function openSettings(options = {}) {
    if (!_local) _loadLocal();
    _render();
    const modal = _els().settings;
    if (modal) {
      if (typeof HubModal !== 'undefined') HubModal.open(modal);
      else if (!modal.open) modal.showModal();
    }
    if (!_server || options.forceServerRefresh) void _loadServerSettings(!!options.forceServerRefresh);
  }

  function _switchScope(scope) {
    _activeScope = scope === 'server' ? 'server' : 'local';
    _render();
    if (_activeScope === 'server') void _loadServerSettings();
  }

  function _wire() {
    const els = _els();
    if (!els.settings || els.settings.dataset.alarmWired === '1') return;
    els.tabs?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-scope]');
      if (button) _switchScope(button.dataset.scope);
    });
    els.list?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-alarm-slot]');
      if (!button) return;
      _selected[_activeScope] = _cleanInt(button.dataset.alarmSlot, 0, 0, SLOT_COUNT - 1);
      _render();
    });
    els.editor?.addEventListener('input', (event) => {
      const target = event.target;
      if (target.matches('[data-field]')) {
        const field = target.dataset.field || '';
        _updateOutput(target);
        if (field.startsWith('sleep.')) {
          _updateSleepField(field.replace('sleep.', ''), target.value);
        } else if (target.type !== 'checkbox') {
          _updateSlotField(field, target.value);
        }
      }
    });
    els.editor?.addEventListener('change', (event) => {
      const target = event.target;
      if (target.matches('.hub-checkbox__input[data-field]')) _updateSlotField(target.dataset.field, target.checked);
      if (target.matches('[data-day]')) _updateDays();
      if (target.matches('.hub-checkbox__input[data-sleep-field]')) _updateSleepField(target.dataset.sleepField, target.checked);
      if (target.matches('[data-alarm-file]')) {
        void _assignFile(target.dataset.alarmFile, target.files?.[0]);
      }
    });
    els.editor?.addEventListener('click', (event) => {
      const pick = event.target.closest('[data-alarm-pick]');
      if (pick) void _chooseSound(pick.dataset.alarmPick);
      const preview = event.target.closest('[data-alarm-preview]');
      if (preview) void _preview(preview.dataset.alarmPreview);
      const sleepToggle = event.target.closest('[data-sleep-toggle]');
      if (sleepToggle) void _toggleSleep();
      const fileButton = event.target.closest('[data-alarm-file-button]');
      if (fileButton) {
        els.editor.querySelector(`[data-alarm-file="${_cssEscape(fileButton.dataset.alarmFileButton)}"]`)?.click();
      }
    });
    document.getElementById('alarm-refresh-server')?.addEventListener('click', () => _loadServerSettings(true));
    document.getElementById('alarm-reset-connectivity-dismissal')?.addEventListener('click', resetConnectivityDismissal);
    els.saveServer?.addEventListener('click', () => _saveServerSettings());
    els.ringSnooze?.addEventListener('click', () => snooze('button'));
    els.ringDismiss?.addEventListener('click', () => dismiss('button'));
    els.ring?.addEventListener('cancel', (event) => event.preventDefault());
    document.addEventListener('blueprints:event', _onBlueprintsEvent);
    els.settings.dataset.alarmWired = '1';
  }

  function init() {
    _loadLocal();
    _wire();
    _render();
    _startLocalScheduler();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  return {
    init,
    openSettings,
    dismiss,
    snooze,
    applyCommand,
    getLocalSettings,
    setLocalSettings,
    updateLocalSlot,
    updateSleep,
    resetConnectivityDismissal,
  };
})();

window.BlueprintsAlarmClock = BlueprintsAlarmClock;
