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

  function voiceNoiseEnabled() {
    if (typeof window.BlueprintsVoiceMode?.sttNoiseReductionSettingEnabled === 'function') {
      return window.BlueprintsVoiceMode.sttNoiseReductionSettingEnabled();
    }
    return !!window.BlueprintsVoiceMode?.sttNoiseReductionEnabled?.();
  }

  function renderNoiseControls() {
    const enabled = voiceNoiseEnabled();
    const level = clampNoiseLevel(window.BlueprintsVoiceMode?.sttNoiseReductionLevelDb?.() ?? 6);
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

  function setAudioUrl(kind, blob) {
    if (audioUrls[kind]) URL.revokeObjectURL(audioUrls[kind]);
    audioUrls[kind] = URL.createObjectURL(blob);
    if (!audioEls[kind]) audioEls[kind] = new Audio();
    audioEls[kind].src = audioUrls[kind];
    updatePlaybackButtons(kind, true);
  }

  function updatePlaybackButtons(kind, enabled) {
    document.querySelectorAll(`[data-audio-kind="${kind}"]`).forEach(button => {
      button.disabled = !enabled || state.recording || state.finalizing;
    });
  }

  function refreshPlaybackButtons() {
    updatePlaybackButtons('raw', !!audioUrls.raw);
    updatePlaybackButtons('enhanced', !!audioUrls.enhanced);
  }

  function playback(kind, action) {
    const audio = audioEls[kind];
    if (!audio) return;
    if (action === 'play') audio.play().catch(error => setStatus(`Playback failed: ${error.message}`));
    if (action === 'pause') audio.pause();
    if (action === 'reset') {
      audio.pause();
      audio.currentTime = 0;
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
    setRecordingUi(false, false);
    clearMetrics();
    state.rawChunks = [];
    state.enhancedChunks = [];
    state.transcript = '';
    await clearAudio('raw').catch(() => {});
    await clearAudio('enhanced').catch(() => {});
    setStatus('');
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
      window.BlueprintsVoiceMode?.setSttNoiseReductionEnabled?.(event.target.checked);
      renderNoiseControls();
    });
    el('stt-noise-level')?.addEventListener('input', event => {
      window.BlueprintsVoiceMode?.setSttNoiseLevelDb?.(event.target.value);
      renderNoiseControls();
    });
    el('stt-noise-record')?.addEventListener('click', () => { void startRecording(); });
    el('stt-noise-stop')?.addEventListener('click', () => { void stopRecording(); });
    el('stt-noise-clear')?.addEventListener('click', () => { void resetAll(); });
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
