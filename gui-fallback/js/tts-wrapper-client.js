// tts-wrapper-client.js — client helper for /api/v1/tts wrapper endpoints.

'use strict';

const BlueprintsTtsClient = (() => {
  let _activeSpeechAudio = null;
  let _activeStream = null;
  let _activeSpeakAbortController = null;
  let _playbackSequence = 0;
  let _lastPlayback = {
    sequence: 0,
    status: 'idle',
    at: Date.now(),
  };

  function _previewText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  }

  function _errorMessage(error) {
    return String(error?.message || error || '').slice(0, 240);
  }

  function _publishPlayback(status, opts = {}, details = {}) {
    const detail = {
      sequence: ++_playbackSequence,
      status,
      at: Date.now(),
      event_kind: String(opts.eventKind || opts.event_kind || ''),
      timing_label: String(opts.timingLabel || opts.timing_label || ''),
      utterance_id: String(opts.utteranceId || opts.utterance_id || ''),
      event_id: String(opts.eventId || opts.event_id || ''),
      client_id: String(opts.clientId || opts.client_id || ''),
      text_preview: _previewText(opts.text),
      text_length: String(opts.text || '').length,
      ...details,
    };
    _lastPlayback = detail;
    try {
      document.dispatchEvent(new CustomEvent('blueprints:tts-playback', {
        detail,
        bubbles: false,
      }));
    } catch (_) {}
    return detail;
  }

  function getPlaybackState() {
    return {
      ..._lastPlayback,
      active_audio: _activeSpeechAudio ? {
        paused: !!_activeSpeechAudio.paused,
        ended: !!_activeSpeechAudio.ended,
        current_time: Number(_activeSpeechAudio.currentTime || 0),
        duration: Number(_activeSpeechAudio.duration || 0),
        volume: Number(_activeSpeechAudio.volume || 0),
      } : null,
      active_stream: _activeStream ? {
        stopped: !!_activeStream.stopped,
        paused: !!_activeStream.paused,
        audio_context_state: _activeStream.audioCtx?.state || '',
      } : null,
    };
  }

  function _audioElementClock(audio) {
    return {
      current_time: Number(audio?.currentTime || 0),
      duration: Number(audio?.duration || 0),
      paused: !!audio?.paused,
      ended: !!audio?.ended,
      volume: Number(audio?.volume || 0),
    };
  }

  function _clamp01(value, fallback) {
    const parsed = parseFloat(value);
    if (Number.isNaN(parsed)) return fallback;
    return Math.max(0, Math.min(1, parsed));
  }

  function _clampTtsVolume(value, fallback) {
    const parsed = parseFloat(value);
    if (Number.isNaN(parsed)) return fallback;
    return Math.max(0, Math.min(3, parsed));
  }

  function _playbackVolume(value) {
    return Math.max(0, Math.min(1, Number(value)));
  }

  function _volumeGain(value) {
    return Math.max(1, Math.min(3, Number(value)));
  }

  function getTtsVolume() {
    return _clampTtsVolume(localStorage.getItem('tts.volume') ?? '0.85', 0.85);
  }

  function getTtsPlaybackVolume() {
    return _playbackVolume(getTtsVolume());
  }

  function getTtsVolumeGain() {
    return _volumeGain(getTtsVolume());
  }

  function setTtsVolume(value) {
    const volume = _clampTtsVolume(value, 0.85);
    localStorage.setItem('tts.volume', String(volume));
    if (_activeSpeechAudio) _activeSpeechAudio.volume = _playbackVolume(volume);
    if (_activeStream?.gainNode) _activeStream.gainNode.gain.value = _playbackVolume(volume);
    return volume;
  }

  function getTtsFallbackVolume() {
    return _clamp01(localStorage.getItem('tts.fallback.volume') ?? '0.70', 0.70);
  }

  function setTtsFallbackVolume(value) {
    const volume = _clamp01(value, 0.70);
    localStorage.setItem('tts.fallback.volume', String(volume));
    return volume;
  }

  function _overrideVolume(value) {
    if (value === null || value === undefined || value === '') return null;
    return _clamp01(value, null);
  }

  function _stopAudioElement(audioEl) {
    if (!audioEl) return;
    try {
      audioEl.pause();
      audioEl.currentTime = 0;
    } catch (_) {}
  }

  async function _stopActiveStream() {
    if (!_activeStream) return;
    try {
      _activeStream.stopped = true;
      _activeStream.abortController?.abort();
      if (_activeStream.audioCtx && _activeStream.audioCtx.state !== 'closed') {
        await _activeStream.audioCtx.close();
      }
    } catch (_) {}
    _activeStream = null;
  }

  async function stop() {
    try {
      _activeSpeakAbortController?.abort();
    } catch (_) {}
    _activeSpeakAbortController = null;
    _stopAudioElement(_activeSpeechAudio);
    _activeSpeechAudio = null;
    await _stopActiveStream();

    try {
      await apiFetch('/api/v1/tts/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch (_) {}
  }

  async function pause() {
    if (_activeStream?.audioCtx && _activeStream.audioCtx.state === 'running') {
      await _activeStream.audioCtx.suspend();
      _activeStream.paused = true;
      return { ok: true, paused: true, kind: 'stream' };
    }
    if (_activeSpeechAudio && !_activeSpeechAudio.paused) {
      _activeSpeechAudio.pause();
      return { ok: true, paused: true, kind: 'audio' };
    }
    return { ok: false, paused: false };
  }

  async function resume() {
    if (_activeStream?.audioCtx && _activeStream.audioCtx.state === 'suspended') {
      await _activeStream.audioCtx.resume();
      _activeStream.paused = false;
      return { ok: true, resumed: true, kind: 'stream' };
    }
    if (_activeSpeechAudio && _activeSpeechAudio.paused) {
      await _activeSpeechAudio.play();
      return { ok: true, resumed: true, kind: 'audio' };
    }
    return { ok: false, resumed: false };
  }

  async function _playAudioBlob(blob, engine, volumeOverride = null, telemetry = {}) {
    if (!blob || !blob.size) {
      throw new Error('Wrapper returned empty audio payload.');
    }
    _stopAudioElement(_activeSpeechAudio);
    const blobUrl = URL.createObjectURL(blob);
    const audio = new Audio(blobUrl);
    const useFallbackVolume = String(engine || '').toLowerCase() === 'sound_fallback';
    audio.volume = volumeOverride ?? (useFallbackVolume ? getTtsFallbackVolume() : getTtsPlaybackVolume());
    _activeSpeechAudio = audio;
    _publishPlayback('blob-created', telemetry, {
      engine,
      media_kind: 'audio_element',
      bytes: blob.size,
      volume: audio.volume,
    });

    audio.addEventListener('ended', () => {
      _publishPlayback('ended', telemetry, {
        engine,
        media_kind: 'audio_element',
        ..._audioElementClock(audio),
      });
      URL.revokeObjectURL(blobUrl);
      if (_activeSpeechAudio === audio) _activeSpeechAudio = null;
    }, { once: true });

    audio.addEventListener('error', () => {
      const code = audio.error?.code ? `media error ${audio.error.code}` : 'audio element error';
      _publishPlayback('error', telemetry, {
        engine,
        media_kind: 'audio_element',
        error: code,
      });
      URL.revokeObjectURL(blobUrl);
      if (_activeSpeechAudio === audio) _activeSpeechAudio = null;
    }, { once: true });

    _publishPlayback('play-starting', telemetry, {
      engine,
      media_kind: 'audio_element',
      volume: audio.volume,
    });
    try {
      const playStartedAt = performance.now();
      const initialTime = Number(audio.currentTime || 0);
      await audio.play();
      _publishPlayback('playing', telemetry, {
        engine,
        media_kind: 'audio_element',
        ..._audioElementClock(audio),
      });
      window.setTimeout(() => {
        if (_activeSpeechAudio !== audio || audio.paused || audio.ended) return;
        const currentTime = Number(audio.currentTime || 0);
        const progressedBy = currentTime - initialTime;
        const elapsedMs = Math.round(performance.now() - playStartedAt);
        if (progressedBy < 0.12) {
          _publishPlayback('stalled', telemetry, {
            engine,
            media_kind: 'audio_element',
            elapsed_ms: elapsedMs,
            progressed_by_seconds: Number(progressedBy.toFixed(3)),
            ..._audioElementClock(audio),
          });
          return;
        }
        _publishPlayback('progress', telemetry, {
          engine,
          media_kind: 'audio_element',
          elapsed_ms: elapsedMs,
          progressed_by_seconds: Number(progressedBy.toFixed(3)),
          ..._audioElementClock(audio),
        });
      }, 1500);
      window.setTimeout(() => {
        if (_activeSpeechAudio !== audio || audio.paused || audio.ended) return;
        const currentTime = Number(audio.currentTime || 0);
        const progressedBy = currentTime - initialTime;
        const elapsedMs = Math.round(performance.now() - playStartedAt);
        if (progressedBy < 0.5) {
          _publishPlayback('stalled', telemetry, {
            engine,
            media_kind: 'audio_element',
            elapsed_ms: elapsedMs,
            progressed_by_seconds: Number(progressedBy.toFixed(3)),
            ..._audioElementClock(audio),
          });
        }
      }, 3000);
    } catch (error) {
      _publishPlayback('error', telemetry, {
        engine,
        media_kind: 'audio_element',
        error: _errorMessage(error),
      });
      throw error;
    }
  }

  function _ttsTimingHeaders(response) {
    const header = (name) => response.headers.get(`x-blueprints-tts-timing-${name}`) || '0';
    return {
      totalPrestreamMs: Number(header('total-prestream-ms')) || 0,
      sanitizerMs: Number(header('sanitizer-ms')) || 0,
      probeMs: Number(header('probe-ms')) || 0,
      upstreamHeadersMs: Number(header('upstream-headers-ms')) || 0,
    };
  }

  function _logTiming(opts, stage, details) {
    if (!opts?.debugTiming) return;
    const label = opts.timingLabel || opts.eventKind || 'tts';
    const payload = Object.assign({ label, stage }, details || {});
    try {
      console.info('[tts-timing]', payload);
    } catch (_) {}
    try {
      document.dispatchEvent(new CustomEvent('blueprints:tts-timing', { detail: payload }));
    } catch (_) {}
  }

  async function _streamWavResponse(response, engine, abortController, volumeOverride = null, timing = null) {
    const reader = response.body?.getReader?.();
    if (!reader) {
      throw new Error('Streaming response reader is not available.');
    }

    const sampleRate = 24000;
    const WAV_HEADER_BYTES = 44;
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
    _publishPlayback('audio-context-created', timing || {}, {
      engine,
      media_kind: 'audio_context',
      audio_context_state: audioCtx.state || '',
    });
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
      _publishPlayback('audio-context-resumed', timing || {}, {
        engine,
        media_kind: 'audio_context',
        audio_context_state: audioCtx.state || '',
      });
    }
    if (audioCtx.state !== 'running') {
      const message = `Browser AudioContext is ${audioCtx.state || 'unknown'} after resume.`;
      _publishPlayback('error', timing || {}, {
        engine,
        media_kind: 'audio_context',
        audio_context_state: audioCtx.state || '',
        error: message,
      });
      throw new Error(message);
    }

    const streamState = {
      stopped: false,
      paused: false,
      audioCtx,
      abortController,
    };
    _activeStream = streamState;

    const useFallbackVolume = String(engine || '').toLowerCase() === 'sound_fallback';
    const gainNode = audioCtx.createGain();
    streamState.gainNode = gainNode;
    gainNode.gain.value = volumeOverride ?? (useFallbackVolume ? getTtsFallbackVolume() : getTtsPlaybackVolume());
    gainNode.connect(audioCtx.destination);

    let nextStartTime = audioCtx.currentTime + 0.08;
    let headerBytesRemaining = WAV_HEADER_BYTES;
    let leftover = null;
    let sawFirstNetworkChunk = false;
    let sawFirstPcm = false;

    try {
      while (!streamState.stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || !value.length) continue;
        if (!sawFirstNetworkChunk) {
          sawFirstNetworkChunk = true;
          _logTiming(timing, 'first-network-chunk', {
            elapsedMs: Math.round(performance.now() - timing.startedAt),
            bytes: value.length,
          });
        }

        let chunk = value;

        if (headerBytesRemaining > 0) {
          if (chunk.length <= headerBytesRemaining) {
            headerBytesRemaining -= chunk.length;
            continue;
          }
          chunk = chunk.slice(headerBytesRemaining);
          headerBytesRemaining = 0;
        }

        let pcmData;
        if (leftover) {
          const merged = new Uint8Array(leftover.length + chunk.length);
          merged.set(leftover);
          merged.set(chunk, leftover.length);
          pcmData = merged;
          leftover = null;
        } else {
          pcmData = chunk;
        }

        if (pcmData.length % 2 === 1) {
          leftover = pcmData.slice(pcmData.length - 1);
          pcmData = pcmData.slice(0, pcmData.length - 1);
        }
        if (!pcmData.length) continue;
        if (!sawFirstPcm) {
          sawFirstPcm = true;
          _logTiming(timing, 'first-pcm', {
            elapsedMs: Math.round(performance.now() - timing.startedAt),
            bytes: pcmData.length,
          });
          _publishPlayback('playing', timing || {}, {
            engine,
            media_kind: 'audio_context',
            audio_context_state: audioCtx.state || '',
            bytes: pcmData.length,
          });
        }

        const sampleCount = pcmData.length / 2;
        const audioBuffer = audioCtx.createBuffer(1, sampleCount, sampleRate);
        const out = audioBuffer.getChannelData(0);
        for (let i = 0; i < sampleCount; i += 1) {
          const lo = pcmData[i * 2];
          const hi = pcmData[i * 2 + 1];
          let int16 = (hi << 8) | lo;
          if (int16 & 0x8000) int16 -= 0x10000;
          out[i] = int16 / 32768;
        }

        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(gainNode);
        const startAt = Math.max(nextStartTime, audioCtx.currentTime + 0.01);
        source.start(startAt);
        nextStartTime = startAt + audioBuffer.duration;
      }
    } finally {
      if (streamState.stopped) {
        try { await reader.cancel(); } catch (_) {}
      }
      if (_activeStream === streamState) {
        try {
          while (!streamState.stopped && streamState.paused && audioCtx.state === 'suspended') {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          if (!streamState.stopped && audioCtx.state !== 'closed') {
            const tailMs = Math.max(0, Math.round((nextStartTime - audioCtx.currentTime + 0.05) * 1000));
            if (tailMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, tailMs));
            }
          }
          if (audioCtx.state !== 'closed') await audioCtx.close();
          _publishPlayback(streamState.stopped ? 'stopped' : 'ended', timing || {}, {
            engine,
            media_kind: 'audio_context',
            audio_context_state: audioCtx.state || '',
          });
        } catch (_) {}
        _activeStream = null;
      }
    }
  }

  async function speak(opts = {}) {
    const startedAt = performance.now();
    const payload = {
      text: typeof opts.text === 'string' ? opts.text : undefined,
      voice: typeof opts.voice === 'string' ? opts.voice : undefined,
      client_id: typeof opts.clientId === 'string' ? opts.clientId : undefined,
      interrupt: typeof opts.interrupt === 'boolean' ? opts.interrupt : true,
      mode: typeof opts.mode === 'string' ? opts.mode : undefined,
      format: typeof opts.format === 'string' ? opts.format : undefined,
      timeout_ms: Number.isFinite(Number(opts.timeoutMs)) ? Number(opts.timeoutMs) : undefined,
      allow_fallback: typeof opts.allowFallback === 'boolean' ? opts.allowFallback : undefined,
      event_kind: typeof opts.eventKind === 'string' ? opts.eventKind : undefined,
      fallback_kind: typeof opts.fallbackKind === 'string' ? opts.fallbackKind : undefined,
      sanitize_text: typeof opts.sanitizeText === 'boolean' ? opts.sanitizeText : undefined,
      transform_profile: typeof opts.transformProfile === 'string' ? opts.transformProfile : undefined,
      allow_llm_sanitizer: typeof opts.allowLlmSanitizer === 'boolean' ? opts.allowLlmSanitizer : undefined,
      volume_gain: Number.isFinite(Number(opts.volumeGain)) ? Number(opts.volumeGain) : getTtsVolumeGain(),
    };
    const volumeOverride = _overrideVolume(opts.volume);
    _publishPlayback('requested', opts, {
      interrupt: payload.interrupt,
      mode: payload.mode || '',
      format: payload.format || '',
      volume: volumeOverride,
      volume_gain: payload.volume_gain,
    });

    if (payload.interrupt) {
      try {
        _activeSpeakAbortController?.abort();
      } catch (_) {}
      _activeSpeakAbortController = null;
      _stopAudioElement(_activeSpeechAudio);
      _activeSpeechAudio = null;
    }

    const abortController = new AbortController();
    _activeSpeakAbortController = abortController;
    let response;
    try {
      response = await apiFetch('/api/v1/tts/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });
    } catch (error) {
      _publishPlayback('error', opts, {
        stage: 'request',
        error: _errorMessage(error),
      });
      throw error;
    } finally {
      if (_activeSpeakAbortController === abortController) _activeSpeakAbortController = null;
    }
    _logTiming(opts, 'response-headers', {
      elapsedMs: Math.round(performance.now() - startedAt),
      backend: _ttsTimingHeaders(response),
    });
    _publishPlayback('response', opts, {
      http_status: Number(response.status || 0),
      content_type: response.headers.get('content-type') || '',
    });

    if (!response.ok) {
      const detail = await response.text();
      _publishPlayback('error', opts, {
        http_status: Number(response.status || 0),
        error: detail || `HTTP ${response.status}`,
      });
      throw new Error(detail || `HTTP ${response.status}`);
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.startsWith('audio/')) {
      const engine = response.headers.get('x-blueprints-tts-engine') || 'pockettts_stream';
      const isStreamMode = String(opts.mode || '').toLowerCase() === 'stream';
      const isWav = contentType.includes('wav');
      const isFallbackAudio = String(engine).toLowerCase() === 'sound_fallback';
      if (isStreamMode && isWav && !isFallbackAudio && response.body && response.body.getReader) {
        await _stopActiveStream();
        await _streamWavResponse(
          response,
          engine,
          abortController,
          volumeOverride,
          Object.assign({ startedAt }, opts)
        );
      } else {
        const blob = await response.blob();
        if (!blob.size) {
          throw new Error('Wrapper returned empty audio payload.');
        }
        await _playAudioBlob(blob, engine, volumeOverride, opts);
      }
      return { ok: true, engine, playback_sequence: _lastPlayback.sequence };
    }

    let responsePayload = null;
    try {
      responsePayload = await response.json();
    } catch (_) {
      throw new Error(`Wrapper returned unsupported content-type: ${contentType || 'unknown'}`);
    }
    if (responsePayload && responsePayload.ok === false && responsePayload.detail) {
      throw new Error(String(responsePayload.detail));
    }
    return responsePayload;
  }

  async function synthesize(opts = {}) {
    const payload = {
      text: typeof opts.text === 'string' ? opts.text : undefined,
      voice: typeof opts.voice === 'string' ? opts.voice : undefined,
      client_id: typeof opts.clientId === 'string' ? opts.clientId : undefined,
      interrupt: typeof opts.interrupt === 'boolean' ? opts.interrupt : false,
      mode: typeof opts.mode === 'string' ? opts.mode : 'batch',
      format: typeof opts.format === 'string' ? opts.format : 'mp3',
      timeout_ms: Number.isFinite(Number(opts.timeoutMs)) ? Number(opts.timeoutMs) : 360000,
      allow_fallback: typeof opts.allowFallback === 'boolean' ? opts.allowFallback : false,
      event_kind: typeof opts.eventKind === 'string' ? opts.eventKind : undefined,
      fallback_kind: typeof opts.fallbackKind === 'string' ? opts.fallbackKind : undefined,
      sanitize_text: typeof opts.sanitizeText === 'boolean' ? opts.sanitizeText : undefined,
      transform_profile: typeof opts.transformProfile === 'string' ? opts.transformProfile : undefined,
      allow_llm_sanitizer: typeof opts.allowLlmSanitizer === 'boolean' ? opts.allowLlmSanitizer : undefined,
      volume_gain: Number.isFinite(Number(opts.volumeGain)) ? Number(opts.volumeGain) : getTtsVolumeGain(),
    };

    const response = await apiFetch('/api/v1/tts/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `HTTP ${response.status}`);
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('audio/')) {
      let responsePayload = null;
      try {
        responsePayload = await response.json();
      } catch (_) {}
      throw new Error(responsePayload?.detail || `Wrapper returned unsupported content-type: ${contentType || 'unknown'}`);
    }

    const blob = await response.blob();
    if (!blob.size) throw new Error('Wrapper returned empty audio payload.');
    const engine = response.headers.get('x-blueprints-tts-engine') || 'pockettts_batch';
    if (String(engine).toLowerCase() === 'sound_fallback') {
      throw new Error('TTS returned fallback audio instead of generated speech.');
    }
    return {
      ok: true,
      blob,
      contentType,
      engine,
    };
  }

  return {
    speak,
    synthesize,
    stop,
    pause,
    resume,
    setTtsVolume,
    getTtsVolume,
    getTtsPlaybackVolume,
    getTtsVolumeGain,
    setTtsFallbackVolume,
    getTtsFallbackVolume,
    getPlaybackState,
  };
})();

window.BlueprintsTtsClient = BlueprintsTtsClient;
