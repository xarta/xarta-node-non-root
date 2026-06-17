// gpu-activity-sound.js — looped GPU power activity cues for the fallback UI.
'use strict';

const GpuActivitySound = (() => {
  const GPU_IDS = ['0', '1'];
  const POLL_MS = 750;
  const FADE_SECONDS = 2.0;
  const ENERGY_SECONDS = 9.0;
  const PLAYBACK_LEASE_KEY = 'blueprints.gpuActivitySound.playbackLeader';
  const PLAYBACK_LEASE_MS = 3500;
  const PAGE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const DEFAULTS = {
    '0': {
      label: 'GPU0',
      detail: 'LXC 804 vLLM',
      soundPath: 'sounds/tos_power_room_1.mp3',
      volume: 0.28,
      boostPct: 25,
    },
    '1': {
      label: 'GPU1',
      detail: 'LXC 805 vLLM',
      soundPath: 'sounds/stationaryship1.mp3',
      volume: 0.24,
      boostPct: 20,
    },
  };

  let _ctx = null;
  let _initialized = false;
  let _config = _defaultConfig();
  let _panelWatching = false;
  let _pollTimer = 0;
  let _polling = false;
  let _raf = 0;
  let _buffers = {};
  let _loading = {};
  let _telemetry = {};
  let _ranges = {};
  let _lastMonitorMeta = {};
  let _channels = {};

  function _defaultConfig() {
    const gpus = {};
    GPU_IDS.forEach(id => {
      const def = DEFAULTS[id];
      gpus[id] = {
        enabled: false,
        soundPath: def.soundPath,
        thresholdW: null,
        volume: def.volume,
        boostEnabled: false,
        boostPct: def.boostPct,
      };
    });
    return { masterEnabled: false, gpus };
  }

  function _assetUrl(assetPath) {
    const path = String(assetPath || '').trim();
    if (!path) return '';
    if (/^https?:\/\//i.test(path) || path.startsWith('/')) return path;
    return `/fallback-ui/assets/${path}`;
  }

  function _getCtx() {
    if (!_ctx) {
      try {
        _ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        console.warn('[GpuActivitySound] AudioContext unavailable:', e);
      }
    }
    return _ctx;
  }

  function _resumeCtx() {
    const ctx = _getCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function _setupResumeOnGesture() {
    const handler = () => {
      _resumeCtx();
      document.removeEventListener('click', handler, true);
      document.removeEventListener('keydown', handler, true);
    };
    document.addEventListener('click', handler, true);
    document.addEventListener('keydown', handler, true);
  }

  function _boolSetting(key, fallback = false) {
    if (typeof getFrontendSetting !== 'function') return fallback;
    const raw = String(getFrontendSetting(key, fallback ? 'true' : 'false') || '').toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(raw);
  }

  function _numberSetting(key, fallback, min, max) {
    if (typeof getFrontendSetting !== 'function') return fallback;
    const raw = getFrontendSetting(key, '');
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  }

  function _stringSetting(key, fallback = '') {
    if (typeof getFrontendSetting !== 'function') return fallback;
    const raw = String(getFrontendSetting(key, '') || '').trim();
    return raw || fallback;
  }

  function _readFrontendConfig() {
    const gpus = {};
    GPU_IDS.forEach(id => {
      const prefix = `gpu_activity_sfx.gpu${id}`;
      const def = DEFAULTS[id];
      const threshold = _numberSetting(`${prefix}.threshold_w`, NaN, 0, 10000);
      gpus[id] = {
        enabled: _boolSetting(`${prefix}.enabled`, false),
        soundPath: _stringSetting(`${prefix}.sound_path`, def.soundPath),
        thresholdW: Number.isFinite(threshold) ? threshold : null,
        volume: _numberSetting(`${prefix}.volume`, def.volume, 0, 1),
        boostEnabled: _boolSetting(`${prefix}.integral_boost_enabled`, false),
        boostPct: _numberSetting(`${prefix}.integral_boost_pct`, def.boostPct, 0, 100),
      };
    });
    return {
      masterEnabled: _boolSetting('sound_enabled', false),
      gpus,
    };
  }

  function _cleanGpuConfig(id, raw) {
    const def = DEFAULTS[id];
    const rawThreshold = raw?.thresholdW;
    const hasThreshold = rawThreshold !== null
      && rawThreshold !== undefined
      && String(rawThreshold).trim() !== '';
    const threshold = hasThreshold ? Number(rawThreshold) : NaN;
    return {
      enabled: !!raw?.enabled,
      soundPath: String(raw?.soundPath || def.soundPath || '').trim(),
      thresholdW: Number.isFinite(threshold) ? Math.max(0, threshold) : null,
      volume: Math.max(0, Math.min(1, Number(raw?.volume ?? def.volume))),
      boostEnabled: !!raw?.boostEnabled,
      boostPct: Math.max(0, Math.min(100, Number(raw?.boostPct ?? def.boostPct))),
    };
  }

  function _cleanConfig(raw) {
    const gpus = {};
    GPU_IDS.forEach(id => { gpus[id] = _cleanGpuConfig(id, raw?.gpus?.[id]); });
    return {
      masterEnabled: !!raw?.masterEnabled,
      gpus,
    };
  }

  function _channel(id) {
    if (!_channels[id]) {
      _channels[id] = {
        id,
        source: null,
        gain: null,
        url: '',
        loadingToken: 0,
        currentGain: 0,
        targetGain: 0,
        fadeStartedAt: 0,
        fadeStartGain: 0,
        energy: 0,
        lastSampleAt: 0,
      };
    }
    return _channels[id];
  }

  function _documentVisible() {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
  }

  function _readPlaybackLease() {
    try {
      return JSON.parse(localStorage.getItem(PLAYBACK_LEASE_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function _leaseIsAvailable(now = Date.now()) {
    const lease = _readPlaybackLease();
    if (!lease.id || lease.id === PAGE_ID) return true;
    return now - Number(lease.ts || 0) > PLAYBACK_LEASE_MS;
  }

  function _claimPlaybackLease() {
    if (!_documentVisible()) return false;
    const now = Date.now();
    if (!_leaseIsAvailable(now)) return false;
    try {
      localStorage.setItem(PLAYBACK_LEASE_KEY, JSON.stringify({ id: PAGE_ID, ts: now }));
    } catch (_) {}
    return true;
  }

  function _releasePlaybackLease() {
    try {
      const lease = _readPlaybackLease();
      if (!lease.id || lease.id === PAGE_ID) localStorage.removeItem(PLAYBACK_LEASE_KEY);
    } catch (_) {}
  }

  async function _loadBuffer(url) {
    if (!url) return null;
    const ctx = _getCtx();
    if (!ctx) return null;
    if (_buffers[url]) return _buffers[url];
    if (_loading[url]) return _loading[url];
    _loading[url] = (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const arrayBuffer = await response.arrayBuffer();
        const buffer = await ctx.decodeAudioData(arrayBuffer);
        _buffers[url] = buffer;
        return buffer;
      } catch (_) {
        return null;
      } finally {
        delete _loading[url];
      }
    })();
    return _loading[url];
  }

  function _stopChannel(channel) {
    channel.loadingToken += 1;
    if (channel.source) {
      try { channel.source.onended = null; } catch (_) {}
      try { channel.source.stop(0); } catch (_) {}
      try { channel.source.disconnect(); } catch (_) {}
      channel.source = null;
    }
    if (channel.gain) {
      try { channel.gain.disconnect(); } catch (_) {}
      channel.gain = null;
    }
    channel.url = '';
    channel.currentGain = 0;
    channel.targetGain = 0;
    channel.fadeStartedAt = 0;
    channel.fadeStartGain = 0;
  }

  function _cancelPendingLoop(channel) {
    channel.loadingToken += 1;
  }

  function _hardStopAll() {
    GPU_IDS.forEach(id => _stopChannel(_channel(id)));
    if (_raf) cancelAnimationFrame(_raf);
    _raf = 0;
    _releasePlaybackLease();
  }

  async function _ensureLoop(channel, url) {
    const ctx = _getCtx();
    if (!ctx || !url) return;
    if (channel.source && channel.url === url) return;
    const desiredGain = channel.targetGain;
    _stopChannel(channel);
    channel.targetGain = desiredGain;
    const token = ++channel.loadingToken;
    const buffer = await _loadBuffer(url);
    if (
      !buffer ||
      token !== channel.loadingToken ||
      channel.targetGain <= 0 ||
      !_documentVisible() ||
      !_leaseIsAvailable()
    ) {
      return;
    }
    try {
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      source.loop = true;
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(0);
      channel.source = source;
      channel.gain = gain;
      channel.url = url;
      channel.currentGain = 0;
      channel.fadeStartedAt = performance.now();
      channel.fadeStartGain = 0;
      source.onended = () => {
        if (channel.source !== source) return;
        channel.source = null;
        channel.gain = null;
        channel.url = '';
      };
    } catch (_) {
      _stopChannel(channel);
    }
  }

  function _rangeMaxForGpu(gpu) {
    const candidates = [
      gpu?.enforced_power_limit_w,
      gpu?.power_limit_w,
      gpu?.power_max_limit_w,
      gpu?.power_default_limit_w,
    ].map(Number).filter(Number.isFinite);
    const rawMax = candidates.find(value => value > 0) || 1;
    return Math.max(1, Math.ceil(rawMax / 10) * 10);
  }

  function _ingestMonitor(payload, meta = {}) {
    const monitor = payload?.monitor || payload || {};
    const gpus = Array.isArray(monitor.gpus) ? monitor.gpus : [];
    const now = performance.now();
    gpus.forEach(gpu => {
      const id = String(gpu?.index ?? '');
      if (!GPU_IDS.includes(id)) return;
      const powerW = Number(gpu?.power_draw_w);
      const rangeMaxW = _rangeMaxForGpu(gpu);
      _ranges[id] = {
        minW: 0,
        maxW: rangeMaxW,
        limitW: Number(gpu?.power_limit_w) || rangeMaxW,
        enforcedLimitW: Number(gpu?.enforced_power_limit_w) || null,
      };
      _telemetry[id] = {
        index: Number(gpu?.index),
        name: String(gpu?.name || DEFAULTS[id].label),
        powerW: Number.isFinite(powerW) ? Math.max(0, powerW) : 0,
        timestamp: monitor.timestamp || '',
      };
      _updateEnergy(id, now);
    });
    _lastMonitorMeta = {
      fetchedAt: payload?.fetched_at || meta.fetchedAt || '',
      cached: !!payload?.cached,
      stale: !!payload?.stale,
    };
    _dispatchTelemetry();
    _updateTargets();
  }

  function _thresholdFor(id) {
    const cfgThreshold = _config.gpus[id]?.thresholdW;
    if (Number.isFinite(cfgThreshold)) return cfgThreshold;
    const maxW = _ranges[id]?.maxW;
    if (Number.isFinite(maxW) && maxW > 0) return Math.round(maxW * 0.55);
    return Infinity;
  }

  function _updateEnergy(id, nowMs) {
    const channel = _channel(id);
    const telemetry = _telemetry[id];
    const range = _ranges[id];
    if (!telemetry || !range) return;
    const thresholdW = _thresholdFor(id);
    const maxSpan = Math.max(1, range.maxW - thresholdW);
    const excessRatio = Math.max(0, Math.min(1, (telemetry.powerW - thresholdW) / maxSpan));
    const dt = channel.lastSampleAt ? Math.max(0.05, Math.min(5, (nowMs - channel.lastSampleAt) / 1000)) : 0;
    channel.lastSampleAt = nowMs;
    if (dt <= 0) return;
    const decay = Math.exp(-dt / ENERGY_SECONDS);
    channel.energy = Math.max(0, Math.min(1, (channel.energy * decay) + (excessRatio * (1 - decay))));
  }

  function _effectiveGain(id) {
    const cfg = _config.gpus[id];
    const telemetry = _telemetry[id];
    if (!_config.masterEnabled || !cfg?.enabled || !cfg.soundPath || !telemetry) return 0;
    if (!_documentVisible() || telemetry.powerW < _thresholdFor(id)) return 0;
    if (!_claimPlaybackLease()) return 0;
    const channel = _channel(id);
    const energyShape = Math.log1p(3 * Math.max(0, Math.min(1, channel.energy))) / Math.log1p(3);
    const boost = cfg.boostEnabled ? 1 + ((cfg.boostPct / 100) * energyShape) : 1;
    return Math.max(0, Math.min(2, cfg.volume * boost));
  }

  function _setTargetGain(channel, gain, nowMs) {
    const cleanGain = Math.max(0, Number(gain) || 0);
    if (Math.abs(cleanGain - channel.targetGain) <= 0.001) {
      channel.targetGain = cleanGain;
      return;
    }
    channel.fadeStartedAt = nowMs;
    channel.fadeStartGain = channel.currentGain;
    channel.targetGain = cleanGain;
  }

  function _updateTargets() {
    const now = performance.now();
    GPU_IDS.forEach(id => {
      const channel = _channel(id);
      const gain = _effectiveGain(id);
      _setTargetGain(channel, gain, now);
      if (gain > 0) {
        _resumeCtx();
        void _ensureLoop(channel, _assetUrl(_config.gpus[id]?.soundPath));
      } else {
        _cancelPendingLoop(channel);
      }
    });
    _ensureAnimation();
  }

  function _ensureAnimation() {
    if (_raf) return;
    _raf = requestAnimationFrame(_tick);
  }

  function _tick(now) {
    _raf = 0;
    let keepRunning = false;
    GPU_IDS.forEach(id => {
      const channel = _channel(id);
      if (Math.abs(channel.currentGain - channel.targetGain) > 0.001) {
        if (!channel.fadeStartedAt) {
          channel.fadeStartedAt = now;
          channel.fadeStartGain = channel.currentGain;
        }
        const elapsed = Math.max(0, (now - channel.fadeStartedAt) / 1000);
        const ratio = Math.min(1, elapsed / FADE_SECONDS);
        channel.currentGain = channel.fadeStartGain + ((channel.targetGain - channel.fadeStartGain) * ratio);
        if (ratio >= 1) {
          channel.currentGain = channel.targetGain;
          channel.fadeStartedAt = 0;
          channel.fadeStartGain = channel.currentGain;
        }
      }
      if (Math.abs(channel.currentGain) < 0.001 && channel.targetGain <= 0) {
        channel.currentGain = 0;
      }
      if (channel.gain) {
        try { channel.gain.gain.setValueAtTime(channel.currentGain, _getCtx().currentTime); } catch (_) {}
      }
      if (channel.targetGain <= 0 && channel.currentGain <= 0 && channel.source) {
        _stopChannel(channel);
      }
      if (channel.source || channel.targetGain > 0 || channel.currentGain > 0) keepRunning = true;
    });
    if (!keepRunning) _releasePlaybackLease();
    if (keepRunning) _raf = requestAnimationFrame(_tick);
  }

  async function _pollOnce() {
    if (_polling || typeof apiFetch !== 'function') return;
    _polling = true;
    try {
      const response = await apiFetch('/api/v1/gpu-monitor/local-ai', {
        cache: 'no-store',
        trackActivity: false,
        deferDuringColumnResize: false,
      });
      if (!response.ok) return;
      _ingestMonitor(await response.json());
    } catch (_) {
      _updateTargets();
    } finally {
      _polling = false;
    }
  }

  function _shouldPoll() {
    if (!_documentVisible()) return false;
    if (_panelWatching) return true;
    if (!_config.masterEnabled) return false;
    return GPU_IDS.some(id => {
      const gpu = _config.gpus[id];
      return gpu?.enabled && !!gpu.soundPath;
    });
  }

  function _schedulePoll(delay = POLL_MS) {
    window.clearTimeout(_pollTimer);
    _pollTimer = 0;
    if (!_shouldPoll()) {
      _updateTargets();
      return;
    }
    _pollTimer = window.setTimeout(async () => {
      _pollTimer = 0;
      await _pollOnce();
      _schedulePoll();
    }, delay);
  }

  function _dispatchTelemetry() {
    const detail = getSnapshot();
    window.dispatchEvent(new CustomEvent('blueprints:gpu-activity-sfx-telemetry', { detail }));
  }

  function _handleVisibilityChange() {
    if (!_documentVisible()) {
      window.clearTimeout(_pollTimer);
      _pollTimer = 0;
      _hardStopAll();
      return;
    }
    _schedulePoll(0);
    _updateTargets();
  }

  function _runtimeSnapshot() {
    const now = Date.now();
    const lease = _readPlaybackLease();
    const leaseFresh = !!lease.id && now - Number(lease.ts || 0) <= PLAYBACK_LEASE_MS;
    const gpus = {};
    GPU_IDS.forEach(id => {
      const channel = _channel(id);
      const telemetry = _telemetry[id];
      const thresholdW = _thresholdFor(id);
      gpus[id] = {
        thresholdW,
        powerW: Number(telemetry?.powerW ?? NaN),
        aboveThreshold: !!telemetry && Number(telemetry.powerW) >= thresholdW,
        targetGain: channel.targetGain,
        currentGain: channel.currentGain,
        sourceActive: !!channel.source,
        pendingLoad: channel.loadingToken,
        fading: !!channel.fadeStartedAt,
        energy: channel.energy,
        url: channel.url,
      };
    });
    return {
      pageId: PAGE_ID,
      documentVisible: _documentVisible(),
      playbackLease: {
        owner: lease.id || '',
        fresh: leaseFresh,
        ownedByThisPage: lease.id === PAGE_ID,
        availableToThisPage: _leaseIsAvailable(now),
      },
      gpus,
    };
  }

  function configure(nextConfig) {
    const prior = _config;
    _config = _cleanConfig(nextConfig);
    GPU_IDS.forEach(id => {
      const oldPath = prior.gpus[id]?.soundPath || '';
      const newPath = _config.gpus[id]?.soundPath || '';
      if (oldPath !== newPath) _stopChannel(_channel(id));
    });
    _updateTargets();
    _schedulePoll(0);
    _dispatchTelemetry();
  }

  function reloadFromFrontendSettings() {
    configure(_readFrontendConfig());
  }

  function setPanelWatching(value) {
    _panelWatching = !!value;
    _schedulePoll(0);
  }

  function fetchOnce() {
    return _pollOnce();
  }

  function getSnapshot() {
    return {
      config: JSON.parse(JSON.stringify(_config)),
      telemetry: JSON.parse(JSON.stringify(_telemetry)),
      ranges: JSON.parse(JSON.stringify(_ranges)),
      meta: { ..._lastMonitorMeta },
      defaults: JSON.parse(JSON.stringify(DEFAULTS)),
      runtime: _runtimeSnapshot(),
    };
  }

  function init() {
    if (_initialized) {
      reloadFromFrontendSettings();
      return;
    }
    _initialized = true;
    _setupResumeOnGesture();
    reloadFromFrontendSettings();
    document.addEventListener('visibilitychange', _handleVisibilityChange);
    window.addEventListener('pagehide', () => {
      window.clearTimeout(_pollTimer);
      _hardStopAll();
    });
    window.addEventListener('beforeunload', () => {
      window.clearTimeout(_pollTimer);
      _hardStopAll();
    });
  }

  return {
    init,
    reloadFromFrontendSettings,
    configure,
    setPanelWatching,
    fetchOnce,
    getSnapshot,
    assetUrl: _assetUrl,
  };
})();
