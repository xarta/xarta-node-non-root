// stt-noise-tests.js - Blueprints STT and DeepFilterNet test modal.

'use strict';

const SttNoiseTests = (() => {
  const DB_NAME = 'blueprints-stt-noise-tests';
  const DB_VERSION = 1;
  const STORE = 'audio';
  const SAMPLE_RATE = 16000;
  const SERVER_STORAGE_KEY = 'blueprintsMatrixChatServer';
  const DEFAULT_SERVER = 'tb1';
  const API_SECRET_KEY = 'blueprints_api_secret';
  const LS_STT_NOISE = 'blueprints.voice.stt_noise_reduction_enabled';
  const LS_STT_NOISE_LEVEL_DB = 'blueprints.voice.stt_noise_reduction_level_db';
  const STREAM_CHECK_MAGIC = 0x51545358;
  const STREAM_CHECK_FRAMES = 100;
  const STREAM_CHECK_INTERVAL_MS = 100;
  const STREAM_CHECK_SAMPLES = 1600;
  const PASSAGES = [
    {
      id: 'harvard-sentences',
      name: 'Harvard sentences',
      text: 'The birch canoe slid on the smooth planks. Glue the sheet to the dark blue background. It is easy to tell the depth of a well. These days a chicken leg is a rare dish. Rice is often served in round bowls. The juice of lemons makes fine punch. The box was thrown beside the parked truck. The hogs were fed chopped corn and garbage. Four hours of steady work faced us.',
    },
    {
      id: 'technical-streaming',
      name: 'Technical streaming',
      text: 'The speech model uses cache aware streaming for low latency inference. It processes audio at sixteen kilohertz sample rate and returns transcriptions in real time. Smaller chunks provide faster responses but can slightly increase word error rates. The streaming architecture maintains context across chunks so conversational applications can stay responsive.',
    },
    {
      id: 'conversation-service',
      name: 'Service call',
      text: 'Hello, I would like to schedule an appointment for tomorrow afternoon please. I am calling about the service request I submitted last week regarding the heating system. The technician was supposed to visit yesterday, but nobody arrived. I waited at home all morning and tried calling several times. Could you please reschedule for this week?',
    },
    {
      id: 'quick-pangram',
      name: 'Quick check',
      text: 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.',
    },
  ];

  let dbPromise = null;
  let initDone = false;
  let audioUrls = { raw: '', enhanced: '' };
  let audioEls = { raw: null, enhanced: null };
  const state = {
    recording: false,
    finalizing: false,
    ws: null,
    stream: null,
    audioContext: null,
    sourceNode: null,
    processorNode: null,
    startedAt: 0,
    bytesSent: 0,
    framesSent: 0,
    rawChunks: [],
    enhancedChunks: [],
    transcript: '',
    timing: null,
    streamCheck: null,
  };

  function el(id) {
    return document.getElementById(id);
  }

  function savedServerId() {
    try {
      const value = localStorage.getItem(SERVER_STORAGE_KEY);
      return value === 'vps' ? 'vps' : DEFAULT_SERVER;
    } catch (_) {
      return DEFAULT_SERVER;
    }
  }

  function selectedPassage() {
    const id = el('stt-noise-passage')?.value || PASSAGES[0].id;
    return PASSAGES.find(passage => passage.id === id) || PASSAGES[0];
  }

  function setStatus(message) {
    const status = el('stt-noise-status');
    if (status) status.textContent = message || '';
  }

  function clampNoiseLevel(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 6;
    return Math.round(Math.max(0, Math.min(12, parsed)) * 2) / 2;
  }

  function storedNoiseSettingEnabled() {
    try {
      return localStorage.getItem(LS_STT_NOISE) === 'true';
    } catch (_) {
      return false;
    }
  }

  function storedNoiseLevelDb() {
    try {
      return clampNoiseLevel(localStorage.getItem(LS_STT_NOISE_LEVEL_DB) ?? 6);
    } catch (_) {
      return 6;
    }
  }

  function voiceNoiseEnabled() {
    if (typeof window.BlueprintsVoiceMode?.sttNoiseReductionSettingEnabled === 'function') {
      return window.BlueprintsVoiceMode.sttNoiseReductionSettingEnabled();
    }
    if (typeof window.BlueprintsVoiceMode?.sttNoiseReductionEnabled === 'function') {
      return !!window.BlueprintsVoiceMode.sttNoiseReductionEnabled();
    }
    return storedNoiseSettingEnabled();
  }

  function voiceNoiseLevelDb() {
    if (typeof window.BlueprintsVoiceMode?.sttNoiseReductionLevelDb === 'function') {
      return clampNoiseLevel(window.BlueprintsVoiceMode.sttNoiseReductionLevelDb());
    }
    return storedNoiseLevelDb();
  }

  function setVoiceNoiseEnabled(value) {
    if (typeof window.BlueprintsVoiceMode?.setSttNoiseReductionEnabled === 'function') {
      window.BlueprintsVoiceMode.setSttNoiseReductionEnabled(value);
      return;
    }
    try {
      localStorage.setItem(LS_STT_NOISE, value ? 'true' : 'false');
      window.dispatchEvent(new CustomEvent('blueprints:voice-mode:stt-noise-changed', {
        detail: {
          enabled: !!value,
          level_db: voiceNoiseLevelDb(),
        },
      }));
    } catch (_) {}
  }

  function setVoiceNoiseLevelDb(value) {
    const level = clampNoiseLevel(value);
    if (typeof window.BlueprintsVoiceMode?.setSttNoiseReductionLevelDb === 'function') {
      window.BlueprintsVoiceMode.setSttNoiseReductionLevelDb(level);
      return level;
    }
    if (typeof window.BlueprintsVoiceMode?.setSttNoiseLevelDb === 'function') {
      window.BlueprintsVoiceMode.setSttNoiseLevelDb(level);
      return level;
    }
    try {
      localStorage.setItem(LS_STT_NOISE_LEVEL_DB, String(level));
      window.dispatchEvent(new CustomEvent('blueprints:voice-mode:stt-noise-changed', {
        detail: {
          enabled: voiceNoiseEnabled(),
          level_db: level,
        },
      }));
    } catch (_) {}
    return level;
  }

  function renderNoiseControls() {
    const enabled = voiceNoiseEnabled();
    const level = voiceNoiseLevelDb();
    const toggle = el('stt-noise-enabled');
    const slider = el('stt-noise-level');
    const label = el('stt-noise-level-label');
    if (toggle) toggle.checked = enabled;
    if (slider) {
      slider.value = String(level);
      slider.disabled = !enabled || state.recording || state.finalizing;
    }
    if (label) label.textContent = `${level.toFixed(1)} dB`;
  }

  function renderPassage() {
    const select = el('stt-noise-passage');
    const reference = el('stt-noise-reference');
    if (select && !select.options.length) {
      PASSAGES.forEach(passage => {
        const option = document.createElement('option');
        option.value = passage.id;
        option.textContent = passage.name;
        select.appendChild(option);
      });
    }
    if (reference) reference.textContent = selectedPassage().text;
  }

  function clearMetrics() {
    ['wer', 'words', 'subs', 'ins', 'del', 'latency'].forEach(key => {
      const node = el(`stt-noise-${key}`);
      if (node) node.textContent = '--';
    });
    const transcript = el('stt-noise-transcript');
    const alignment = el('stt-noise-alignment');
    if (transcript) transcript.textContent = '';
    if (alignment) alignment.textContent = '';
  }

  function setRecordingUi(recording, finalizing = false) {
    state.recording = recording;
    state.finalizing = finalizing;
    const record = el('stt-noise-record');
    const stop = el('stt-noise-stop');
    const clear = el('stt-noise-clear');
    if (record) record.disabled = recording || finalizing;
    if (stop) stop.disabled = !recording;
    if (clear) clear.disabled = recording || finalizing;
    const streamCheck = el('stt-stream-check-run');
    if (streamCheck && !state.streamCheck?.running) streamCheck.disabled = recording || finalizing;
    renderNoiseControls();
    refreshPlaybackButtons();
  }

  function normalizeWords(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  function calculateWer(reference, hypothesis) {
    const ref = normalizeWords(reference);
    const hyp = normalizeWords(hypothesis);
    const rows = ref.length + 1;
    const cols = hyp.length + 1;
    const d = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (let i = 0; i < rows; i += 1) d[i][0] = i;
    for (let j = 0; j < cols; j += 1) d[0][j] = j;
    for (let i = 1; i < rows; i += 1) {
      for (let j = 1; j < cols; j += 1) {
        const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      }
    }
    let i = ref.length;
    let j = hyp.length;
    let substitutions = 0;
    let insertions = 0;
    let deletions = 0;
    const alignment = [];
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && ref[i - 1] === hyp[j - 1] && d[i][j] === d[i - 1][j - 1]) {
        alignment.unshift({ op: 'ok', ref: ref[i - 1], hyp: hyp[j - 1] });
        i -= 1;
        j -= 1;
      } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) {
        substitutions += 1;
        alignment.unshift({ op: 'sub', ref: ref[i - 1], hyp: hyp[j - 1] });
        i -= 1;
        j -= 1;
      } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
        deletions += 1;
        alignment.unshift({ op: 'del', ref: ref[i - 1], hyp: '' });
        i -= 1;
      } else {
        insertions += 1;
        alignment.unshift({ op: 'ins', ref: '', hyp: hyp[j - 1] });
        j -= 1;
      }
    }
    const errors = substitutions + insertions + deletions;
    return {
      wer: ref.length ? (errors / ref.length) * 100 : 0,
      words: ref.length,
      substitutions,
      insertions,
      deletions,
      alignment,
    };
  }

  function renderWer(transcriptText) {
    const result = calculateWer(selectedPassage().text, transcriptText);
    el('stt-noise-wer').textContent = `${result.wer.toFixed(1)}%`;
    el('stt-noise-words').textContent = String(result.words);
    el('stt-noise-subs').textContent = String(result.substitutions);
    el('stt-noise-ins').textContent = String(result.insertions);
    el('stt-noise-del').textContent = String(result.deletions);
    const alignment = el('stt-noise-alignment');
    if (alignment) {
      alignment.textContent = '';
      result.alignment.slice(0, 220).forEach(item => {
        const span = document.createElement('span');
        span.className = 'stt-noise-alignment-token';
        span.dataset.op = item.op;
        span.textContent = item.op === 'ok' ? item.ref : `${item.ref || '[none]'} -> ${item.hyp || '[none]'}`;
        alignment.appendChild(span);
      });
    }
  }

  function updateTiming(payload = {}) {
    const timing = payload.timing || {};
    const elapsed = Number(timing.elapsed_ms);
    const filter = timing.filter || {};
    const filterAvg = Number(filter.avg_ms);
    const audioBytes = Number(timing.audio_bytes);
    const audioFrames = Number(timing.audio_frames);
    const audioSamples = Number.isFinite(audioBytes) ? audioBytes / 4 : 0;
    const audioDurationMs = audioSamples > 0 ? (audioSamples / SAMPLE_RATE) * 1000 : 0;
    const chunkAvgMs = audioFrames > 0 ? audioDurationMs / audioFrames : 0;
    const latency = el('stt-noise-latency');
    if (latency) {
      latency.textContent = '';
      const lines = [];
      if (Number.isFinite(elapsed)) {
        lines.push(`Elapsed ${elapsed >= 10000 ? `${(elapsed / 1000).toFixed(1)}s` : `${Math.round(elapsed)}ms`}`);
      }
      lines.push(Number.isFinite(filterAvg) ? `Filter avg ${filterAvg.toFixed(1)}ms` : 'Filter off');
      if (chunkAvgMs > 0) lines.push(`Chunk avg ${chunkAvgMs.toFixed(1)}ms`);
      if (!lines.length) lines.push('--');
      lines.forEach(line => {
        const item = document.createElement('span');
        item.textContent = line;
        latency.appendChild(item);
      });
    }
  }

  function downsampleFloat32(input, inputRate, outputRate = SAMPLE_RATE) {
    if (!input?.length) return null;
    if (!Number.isFinite(inputRate) || inputRate <= 0 || inputRate === outputRate) {
      return new Float32Array(input);
    }
    const ratio = inputRate / outputRate;
    const outputLength = Math.max(1, Math.floor(input.length / ratio));
    const output = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i += 1) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      let count = 0;
      for (let j = start; j < end; j += 1) {
        sum += input[j];
        count += 1;
      }
      output[i] = count ? sum / count : input[Math.min(start, input.length - 1)] || 0;
    }
    return output;
  }

  function concatFloat32(chunks) {
    const arrays = chunks.map(chunk => chunk instanceof Float32Array ? chunk : new Float32Array(chunk));
    const length = arrays.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Float32Array(length);
    let offset = 0;
    arrays.forEach(chunk => {
      out.set(chunk, offset);
      offset += chunk.length;
    });
    return out;
  }

  function encodeWav(samples, sampleRate = SAMPLE_RATE) {
    const bytesPerSample = 2;
    const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
    const view = new DataView(buffer);
    const writeString = (offset, value) => {
      for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * bytesPerSample, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * bytesPerSample, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i += 1) {
      const value = Math.max(-1, Math.min(1, samples[i] || 0));
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
      offset += 2;
    }
    return new Blob([view], { type: 'audio/wav' });
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'));
    });
    return dbPromise;
  }

  async function putAudio(kind, blob) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ kind, blob, created_at: Date.now() }, kind);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Audio storage failed'));
    });
    setAudioUrl(kind, blob);
  }

  async function clearAudio(kind) {
    const db = await openDb().catch(() => null);
    if (db) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(kind);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Audio clear failed'));
      });
    }
    if (audioUrls[kind]) URL.revokeObjectURL(audioUrls[kind]);
    audioUrls[kind] = '';
    if (audioEls[kind]) {
      audioEls[kind].pause();
      audioEls[kind].src = '';
    }
    updatePlaybackButtons(kind, false);
  }

  function ensureAudio(kind) {
    if (!audioEls[kind]) {
      const audio = new Audio();
      ['play', 'pause', 'ended', 'emptied'].forEach(eventName => {
        audio.addEventListener(eventName, () => updatePlaybackToggle(kind));
      });
      audioEls[kind] = audio;
    }
    return audioEls[kind];
  }

  function setAudioUrl(kind, blob) {
    if (audioUrls[kind]) URL.revokeObjectURL(audioUrls[kind]);
    audioUrls[kind] = URL.createObjectURL(blob);
    const audio = ensureAudio(kind);
    audio.src = audioUrls[kind];
    updatePlaybackButtons(kind, true);
  }

  function updatePlaybackToggle(kind) {
    const button = document.querySelector(`[data-audio-action="toggle"][data-audio-kind="${kind}"]`);
    const audio = audioEls[kind];
    if (!button || !audio) return;
    button.textContent = !audio.paused && !audio.ended ? 'Pause' : 'Play';
  }

  function updatePlaybackButtons(kind, enabled) {
    document.querySelectorAll(`[data-audio-kind="${kind}"]`).forEach(button => {
      button.disabled = !enabled || state.recording || state.finalizing;
    });
    updatePlaybackToggle(kind);
  }

  function refreshPlaybackButtons() {
    updatePlaybackButtons('raw', !!audioUrls.raw);
    updatePlaybackButtons('enhanced', !!audioUrls.enhanced);
  }

  function playback(kind, action) {
    const audio = audioEls[kind];
    if (!audio) return;
    if (action === 'toggle') {
      if (audio.paused || audio.ended) {
        audio.play().catch(error => {
          updatePlaybackToggle(kind);
          setStatus(`Playback failed: ${error.message}`);
        });
      } else {
        audio.pause();
      }
      updatePlaybackToggle(kind);
    }
    if (action === 'play') audio.play().catch(error => setStatus(`Playback failed: ${error.message}`));
    if (action === 'pause') audio.pause();
    if (action === 'reset') {
      audio.pause();
      audio.currentTime = 0;
      updatePlaybackToggle(kind);
    }
    if (action === 'clear') void clearAudio(kind);
  }

  async function websocketUrl() {
    const url = new URL('/api/v1/matrix-chat/stt/noise-test/ws', window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('server', savedServerId());
    if (voiceNoiseEnabled()) {
      url.searchParams.set('noise_reduction', '1');
      url.searchParams.set('atten_lim_db', String(clampNoiseLevel(el('stt-noise-level')?.value ?? 6)));
    } else {
      url.searchParams.set('noise_reduction', '0');
    }
    const secret = localStorage.getItem(API_SECRET_KEY) || '';
    const token = typeof _computeApiToken === 'function'
      ? await _computeApiToken(secret, `${url.pathname}${url.search}`)
      : '';
    if (token) url.searchParams.set('token', token);
    return url.toString();
  }

  async function streamQualityWebsocketUrl() {
    const url = new URL('/api/v1/matrix-chat/stt/noise-test/stream-quality/ws', window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('server', savedServerId());
    const secret = localStorage.getItem(API_SECRET_KEY) || '';
    const token = typeof _computeApiToken === 'function'
      ? await _computeApiToken(secret, `${url.pathname}${url.search}`)
      : '';
    if (token) url.searchParams.set('token', token);
    return url.toString();
  }

  function waitForSocketOpen(socket) {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('STT connection timed out'));
      }, 6000);
      const done = () => {
        window.clearTimeout(timer);
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('error', onError);
      };
      const onOpen = () => {
        done();
        resolve();
      };
      const onError = () => {
        done();
        reject(new Error('STT connection failed'));
      };
      socket.addEventListener('open', onOpen);
      socket.addEventListener('error', onError);
    });
  }

  function waitForStreamSocketOpen(socket) {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error('Stream quality connection timed out'));
      }, 6000);
      const done = () => {
        window.clearTimeout(timer);
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('error', onError);
      };
      const onOpen = () => {
        done();
        resolve();
      };
      const onError = () => {
        done();
        reject(new Error('Stream quality connection failed'));
      };
      socket.addEventListener('open', onOpen);
      socket.addEventListener('error', onError);
    });
  }

  function fnv1a(bytes) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i += 1) {
      hash ^= bytes[i];
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  function makeStreamCheckFrame(seq) {
    const bytes = 16 + STREAM_CHECK_SAMPLES * 4;
    const buffer = new ArrayBuffer(bytes);
    const view = new DataView(buffer);
    const samples = new Float32Array(buffer, 16, STREAM_CHECK_SAMPLES);
    let seed = ((seq + 1) * 2654435761) >>> 0;
    for (let index = 0; index < samples.length; index += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = (((seed >>> 8) & 0xffffff) / 0xffffff) * 2 - 1;
      const phase = (seq * STREAM_CHECK_SAMPLES + index) * 0.013;
      samples[index] = Math.sin(phase) * 0.38 + noise * 0.015;
    }
    const hash = fnv1a(new Uint8Array(buffer, 16));
    view.setUint32(0, STREAM_CHECK_MAGIC, true);
    view.setUint32(4, seq, true);
    view.setUint32(8, STREAM_CHECK_SAMPLES, true);
    view.setUint32(12, hash, true);
    return { buffer, hash, bytes };
  }

  function resetStreamCheckUi() {
    const quality = el('stt-stream-check-quality');
    const status = el('stt-stream-check-status');
    const detail = el('stt-stream-check-detail');
    const button = el('stt-stream-check-run');
    if (quality) quality.textContent = '--';
    if (status) status.textContent = 'Idle.';
    if (detail) detail.textContent = '';
    if (button) {
      button.textContent = 'Run 10s check';
      button.disabled = state.recording || state.finalizing;
    }
  }

  function summarizeStreamCheck(check, final = false) {
    const sent = check.sent;
    const expectedSeen = check.correct + check.corrupt;
    const missing = Math.max(0, sent - expectedSeen);
    const orderedCorrect = Math.max(0, check.correct - check.outOfOrder);
    const qualityPct = sent ? (orderedCorrect / sent) * 100 : 0;
    const avgRtt = check.rtts.length
      ? check.rtts.reduce((sum, value) => sum + value, 0) / check.rtts.length
      : 0;
    const maxRtt = check.rtts.length ? Math.max(...check.rtts) : 0;
    const quality = el('stt-stream-check-quality');
    const status = el('stt-stream-check-status');
    const detail = el('stt-stream-check-detail');
    if (quality) quality.textContent = sent ? `${qualityPct.toFixed(2)}%` : '--';
    if (status) {
      status.textContent = check.running
        ? `Running ${sent}/${STREAM_CHECK_FRAMES} frames${check.mode ? ` via ${check.mode}` : ''}.`
        : final ? 'Stream check complete.' : 'Stream check stopped.';
    }
    if (detail) {
      const degradation = missing || check.corrupt || check.outOfOrder || check.duplicates || check.unexpected;
      const verdict = !final
        ? ''
        : degradation
          ? 'Audio discontinuities are plausible on this path.'
          : 'No byte-level stream damage detected on this run.';
      detail.textContent = [
        `Returned ${check.received}/${sent}; missing ${missing}; corrupt ${check.corrupt}; out-of-order ${check.outOfOrder}; duplicate ${check.duplicates}.`,
        check.rtts.length ? `RTT avg ${avgRtt.toFixed(1)} ms, max ${maxRtt.toFixed(1)} ms.` : '',
        verdict,
      ].filter(Boolean).join(' ');
    }
  }

  function finishStreamCheck(reason = 'complete') {
    const check = state.streamCheck;
    if (!check) return;
    check.running = false;
    if (check.timer) window.clearInterval(check.timer);
    if (check.finalTimer) window.clearTimeout(check.finalTimer);
    const button = el('stt-stream-check-run');
    if (button) {
      button.textContent = 'Run 10s check';
      button.disabled = state.recording || state.finalizing;
    }
    if (check.ws && check.ws.readyState === WebSocket.OPEN) {
      try { check.ws.close(); } catch (_) {}
    }
    if (reason !== 'error') summarizeStreamCheck(check, reason === 'complete');
  }

  function stopStreamCheck() {
    const check = state.streamCheck;
    if (!check?.running) return;
    try {
      if (check.ws?.readyState === WebSocket.OPEN) {
        check.ws.send(JSON.stringify({
          type: 'end',
          sent_frames: check.sent,
          sent_bytes: check.sentBytes,
        }));
      }
    } catch (_) {}
    finishStreamCheck('stopped');
  }

  function handleStreamCheckBytes(data) {
    const check = state.streamCheck;
    if (!check) return;
    const buffer = data instanceof ArrayBuffer ? data : data.buffer;
    if (!buffer || buffer.byteLength < 16) {
      check.unexpected += 1;
      summarizeStreamCheck(check);
      return;
    }
    const view = new DataView(buffer);
    const magic = view.getUint32(0, true);
    const seq = view.getUint32(4, true);
    const samples = view.getUint32(8, true);
    const hash = view.getUint32(12, true);
    const expected = check.expected.get(seq);
    check.received += 1;
    if (magic !== STREAM_CHECK_MAGIC || samples !== STREAM_CHECK_SAMPLES || !expected) {
      check.unexpected += 1;
      summarizeStreamCheck(check);
      return;
    }
    if (check.seen.has(seq)) {
      check.duplicates += 1;
      summarizeStreamCheck(check);
      return;
    }
    check.seen.add(seq);
    const actualHash = fnv1a(new Uint8Array(buffer, 16));
    if (buffer.byteLength !== expected.bytes || hash !== expected.hash || actualHash !== expected.hash) {
      check.corrupt += 1;
    } else {
      check.correct += 1;
      if (seq <= check.lastSeq) check.outOfOrder += 1;
      check.lastSeq = Math.max(check.lastSeq, seq);
    }
    check.rtts.push(performance.now() - expected.sentAt);
    summarizeStreamCheck(check);
  }

  function handleStreamCheckMessage(event) {
    const check = state.streamCheck;
    if (!check) return;
    if (event.data instanceof ArrayBuffer) {
      handleStreamCheckBytes(event.data);
      return;
    }
    let payload = {};
    try {
      payload = JSON.parse(event.data || '{}');
    } catch (_) {
      return;
    }
    if (payload.type === 'config') {
      check.mode = payload.mode === 'mirror_ws' ? 'mirror' : 'unknown path';
      summarizeStreamCheck(check);
      return;
    }
    if (payload.type === 'final') {
      finishStreamCheck('complete');
      return;
    }
    if (payload.type === 'error') {
      const status = el('stt-stream-check-status');
      if (status) status.textContent = `Stream check failed: ${payload.detail || 'unknown error'}`;
      finishStreamCheck('error');
    }
  }

  async function startStreamCheck() {
    if (state.recording || state.finalizing) {
      setStatus('Stop recording before running the stream quality check.');
      return;
    }
    if (state.streamCheck?.running) {
      stopStreamCheck();
      return;
    }
    const check = {
      running: true,
      ws: null,
      timer: null,
      finalTimer: null,
      expected: new Map(),
      seen: new Set(),
      sent: 0,
      sentBytes: 0,
      received: 0,
      correct: 0,
      corrupt: 0,
      duplicates: 0,
      outOfOrder: 0,
      unexpected: 0,
      lastSeq: -1,
      rtts: [],
      mode: '',
    };
    state.streamCheck = check;
    const button = el('stt-stream-check-run');
    if (button) {
      button.textContent = 'Stop check';
      button.disabled = false;
    }
    summarizeStreamCheck(check);
    try {
      const ws = new WebSocket(await streamQualityWebsocketUrl());
      ws.binaryType = 'arraybuffer';
      check.ws = ws;
      ws.addEventListener('message', handleStreamCheckMessage);
      ws.addEventListener('close', () => {
        if (check.running) finishStreamCheck(check.sent >= STREAM_CHECK_FRAMES ? 'complete' : 'stopped');
      });
      await waitForStreamSocketOpen(ws);
      ws.send(JSON.stringify({
        type: 'start',
        frames: STREAM_CHECK_FRAMES,
        interval_ms: STREAM_CHECK_INTERVAL_MS,
        samples_per_frame: STREAM_CHECK_SAMPLES,
      }));
      const sendFrame = () => {
        if (!check.running || ws.readyState !== WebSocket.OPEN) return;
        if (check.sent >= STREAM_CHECK_FRAMES) {
          window.clearInterval(check.timer);
          check.timer = null;
          ws.send(JSON.stringify({
            type: 'end',
            sent_frames: check.sent,
            sent_bytes: check.sentBytes,
          }));
          check.finalTimer = window.setTimeout(() => finishStreamCheck('complete'), 2500);
          return;
        }
        const seq = check.sent;
        const frame = makeStreamCheckFrame(seq);
        check.expected.set(seq, {
          hash: frame.hash,
          bytes: frame.bytes,
          sentAt: performance.now(),
        });
        ws.send(frame.buffer);
        check.sent += 1;
        check.sentBytes += frame.bytes;
        summarizeStreamCheck(check);
      };
      sendFrame();
      check.timer = window.setInterval(sendFrame, STREAM_CHECK_INTERVAL_MS);
    } catch (error) {
      const status = el('stt-stream-check-status');
      if (status) status.textContent = `Stream check failed: ${error.message || error}`;
      finishStreamCheck('error');
    }
  }

  async function handleSocketMessage(event) {
    if (event.data instanceof ArrayBuffer) {
      state.enhancedChunks.push(event.data);
      return;
    }
    let payload = {};
    try {
      payload = JSON.parse(event.data || '{}');
    } catch (_) {
      return;
    }
    if (payload.type === 'partial') {
      const text = String(payload.text || '').trim();
      if (text) {
        state.transcript = text;
        const node = el('stt-noise-transcript');
        if (node) node.textContent = text;
      }
      return;
    }
    if (payload.type === 'final') {
      state.transcript = String(payload.text || state.transcript || '').trim();
      const transcript = el('stt-noise-transcript');
      if (transcript) transcript.textContent = state.transcript;
      renderWer(state.transcript);
      updateTiming(payload);
      if (state.enhancedChunks.length) {
        await putAudio('enhanced', encodeWav(concatFloat32(state.enhancedChunks))).catch(() => {
          setStatus('Transcript ready. Enhanced playback storage failed.');
        });
      }
      cleanup({ closeSocket: true });
      setRecordingUi(false, false);
      setStatus(state.transcript ? 'Transcript ready.' : 'No transcript returned.');
      return;
    }
    if (payload.type === 'error') {
      if (state.transcript) renderWer(state.transcript);
      if (state.enhancedChunks.length) {
        await putAudio('enhanced', encodeWav(concatFloat32(state.enhancedChunks))).catch(() => {});
      }
      cleanup({ closeSocket: true });
      setRecordingUi(false, false);
      setStatus(`STT failed: ${payload.detail || 'unknown error'}`);
    }
  }

  async function startRecording() {
    if (state.recording || state.finalizing) return;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!navigator.mediaDevices?.getUserMedia || typeof WebSocket === 'undefined' || !AudioContextCtor) {
      setStatus('Microphone streaming is unavailable in this browser.');
      return;
    }
    cleanup({ closeSocket: true });
    clearMetrics();
    state.rawChunks = [];
    state.enhancedChunks = [];
    state.bytesSent = 0;
    state.framesSent = 0;
    state.transcript = '';
    try {
      await clearAudio('enhanced');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const ws = new WebSocket(await websocketUrl());
      ws.binaryType = 'arraybuffer';
      state.ws = ws;
      ws.addEventListener('message', event => { void handleSocketMessage(event); });
      ws.addEventListener('close', () => {
        if (state.recording || state.finalizing) {
          cleanup({ closeSocket: false });
          setRecordingUi(false, false);
          setStatus('STT connection closed before final transcript.');
        }
      });
      await waitForSocketOpen(ws);

      const audioContext = new AudioContextCtor();
      await audioContext.resume?.();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      state.stream = stream;
      state.audioContext = audioContext;
      state.sourceNode = source;
      state.processorNode = processor;
      state.startedAt = Date.now();
      setRecordingUi(true, false);
      processor.onaudioprocess = event => {
        const output = event.outputBuffer?.getChannelData?.(0);
        if (output) output.fill(0);
        if (!state.recording || state.ws?.readyState !== WebSocket.OPEN) return;
        const pcm = downsampleFloat32(event.inputBuffer.getChannelData(0), audioContext.sampleRate);
        if (pcm?.byteLength) {
          state.rawChunks.push(new Float32Array(pcm));
          state.bytesSent += pcm.byteLength;
          state.framesSent += 1;
          state.ws.send(pcm.buffer);
        }
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
      setStatus(voiceNoiseEnabled() ? 'Recording with noise reduction.' : 'Recording without noise reduction.');
    } catch (error) {
      cleanup({ closeSocket: true });
      setRecordingUi(false, false);
      setStatus(`Recording unavailable: ${error.message || error}`);
    }
  }

  async function stopRecording() {
    if (!state.recording || !state.ws) return;
    state.recording = false;
    setRecordingUi(false, true);
    if (state.processorNode) {
      try { state.processorNode.disconnect(); } catch (_) {}
    }
    if (state.sourceNode) {
      try { state.sourceNode.disconnect(); } catch (_) {}
    }
    if (state.stream) {
      state.stream.getTracks().forEach(track => track.stop());
      state.stream = null;
    }
    if (state.rawChunks.length) {
      await putAudio('raw', encodeWav(concatFloat32(state.rawChunks))).catch(() => {
        setStatus('Raw playback storage failed.');
      });
    }
    if (state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({
        type: 'end',
        audio_bytes: state.bytesSent,
        audio_frames: state.framesSent,
      }));
      setStatus('Finalizing transcript.');
    } else {
      cleanup({ closeSocket: true });
      setRecordingUi(false, false);
      setStatus('STT connection was not ready.');
    }
  }

  function cleanup(options = {}) {
    const closeSocket = options.closeSocket !== false;
    if (state.processorNode) {
      try { state.processorNode.disconnect(); } catch (_) {}
      state.processorNode.onaudioprocess = null;
      state.processorNode = null;
    }
    if (state.sourceNode) {
      try { state.sourceNode.disconnect(); } catch (_) {}
      state.sourceNode = null;
    }
    if (state.audioContext) {
      try { void state.audioContext.close(); } catch (_) {}
      state.audioContext = null;
    }
    if (state.stream) {
      state.stream.getTracks().forEach(track => track.stop());
      state.stream = null;
    }
    if (closeSocket && state.ws) {
      try { state.ws.close(); } catch (_) {}
      state.ws = null;
    }
    state.recording = false;
    state.finalizing = false;
    refreshPlaybackButtons();
  }

  async function resetAll() {
    cleanup({ closeSocket: true });
    stopStreamCheck();
    setRecordingUi(false, false);
    clearMetrics();
    state.rawChunks = [];
    state.enhancedChunks = [];
    state.transcript = '';
    await clearAudio('raw').catch(() => {});
    await clearAudio('enhanced').catch(() => {});
    setStatus('');
    resetStreamCheckUi();
  }

  function wire() {
    if (initDone) return;
    initDone = true;
    renderPassage();
    renderNoiseControls();
    el('stt-noise-passage')?.addEventListener('change', () => {
      renderPassage();
      if (state.transcript) renderWer(state.transcript);
    });
    el('stt-noise-enabled')?.addEventListener('change', event => {
      setVoiceNoiseEnabled(event.target.checked);
      renderNoiseControls();
    });
    const noiseLevel = el('stt-noise-level');
    const updateNoiseLevel = event => {
      setVoiceNoiseLevelDb(event.target.value);
      renderNoiseControls();
    };
    noiseLevel?.addEventListener('input', updateNoiseLevel);
    noiseLevel?.addEventListener('change', updateNoiseLevel);
    el('stt-noise-record')?.addEventListener('click', () => { void startRecording(); });
    el('stt-noise-stop')?.addEventListener('click', () => { void stopRecording(); });
    el('stt-noise-clear')?.addEventListener('click', () => { void resetAll(); });
    el('stt-stream-check-run')?.addEventListener('click', () => { void startStreamCheck(); });
    document.querySelectorAll('[data-audio-action][data-audio-kind]').forEach(button => {
      button.addEventListener('click', () => playback(button.dataset.audioKind, button.dataset.audioAction));
    });
    window.addEventListener('blueprints:voice-mode:stt-noise-changed', renderNoiseControls);
  }

  function open() {
    wire();
    renderPassage();
    renderNoiseControls();
    const modal = el('stt-noise-tests-modal');
    if (!modal) return;
    if (typeof HubModal !== 'undefined') {
      HubModal.open(modal, { onOpen: () => { renderNoiseControls(); } });
    } else if (typeof modal.showModal === 'function') {
      modal.showModal();
    }
  }

  document.addEventListener('DOMContentLoaded', wire);

  return {
    open,
  };
})();

window.SttNoiseTests = SttNoiseTests;
