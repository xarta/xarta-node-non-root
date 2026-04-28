// tts-wrapper-client.js — client helper for /api/v1/tts wrapper endpoints.

'use strict';

const BlueprintsTtsClient = (() => {
  let _activeSpeechAudio = null;
  let _activeStream = null;
  let _activeSpeakAbortController = null;

  function _clamp01(value, fallback) {
    const parsed = parseFloat(value);
    if (Number.isNaN(parsed)) return fallback;
    return Math.max(0, Math.min(1, parsed));
  }

  function getTtsVolume() {
    return _clamp01(localStorage.getItem('tts.volume') ?? '0.85', 0.85);
  }

  function setTtsVolume(value) {
    const volume = _clamp01(value, 0.85);
    localStorage.setItem('tts.volume', String(volume));
    if (_activeSpeechAudio) _activeSpeechAudio.volume = volume;
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

  async function _playAudioBlob(blob, engine) {
    if (!blob || !blob.size) {
      throw new Error('Wrapper returned empty audio payload.');
    }
    _stopAudioElement(_activeSpeechAudio);
    const blobUrl = URL.createObjectURL(blob);
    const audio = new Audio(blobUrl);
    const useFallbackVolume = String(engine || '').toLowerCase() === 'sound_fallback';
    audio.volume = useFallbackVolume ? getTtsFallbackVolume() : getTtsVolume();
    _activeSpeechAudio = audio;

    audio.addEventListener('ended', () => {
      URL.revokeObjectURL(blobUrl);
      if (_activeSpeechAudio === audio) _activeSpeechAudio = null;
    }, { once: true });

    audio.addEventListener('error', () => {
      URL.revokeObjectURL(blobUrl);
      if (_activeSpeechAudio === audio) _activeSpeechAudio = null;
    }, { once: true });

    await audio.play();
  }

  async function _streamWavResponse(response, engine, abortController) {
    const reader = response.body?.getReader?.();
    if (!reader) {
      throw new Error('Streaming response reader is not available.');
    }

    const sampleRate = 24000;
    const WAV_HEADER_BYTES = 44;
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    const streamState = {
      stopped: false,
      paused: false,
      audioCtx,
      abortController,
    };
    _activeStream = streamState;

    const useFallbackVolume = String(engine || '').toLowerCase() === 'sound_fallback';
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = useFallbackVolume ? getTtsFallbackVolume() : getTtsVolume();
    gainNode.connect(audioCtx.destination);

    let nextStartTime = audioCtx.currentTime + 0.08;
    let headerBytesRemaining = WAV_HEADER_BYTES;
    let leftover = null;

    try {
      while (!streamState.stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || !value.length) continue;

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
        } catch (_) {}
        _activeStream = null;
      }
    }
  }

  async function speak(opts = {}) {
    const payload = {
      text: typeof opts.text === 'string' ? opts.text : undefined,
      voice: typeof opts.voice === 'string' ? opts.voice : undefined,
      interrupt: typeof opts.interrupt === 'boolean' ? opts.interrupt : true,
      mode: typeof opts.mode === 'string' ? opts.mode : undefined,
      event_kind: typeof opts.eventKind === 'string' ? opts.eventKind : undefined,
      fallback_kind: typeof opts.fallbackKind === 'string' ? opts.fallbackKind : undefined,
      sanitize_text: typeof opts.sanitizeText === 'boolean' ? opts.sanitizeText : undefined,
      transform_profile: typeof opts.transformProfile === 'string' ? opts.transformProfile : undefined,
    };

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
    } finally {
      if (_activeSpeakAbortController === abortController) _activeSpeakAbortController = null;
    }

    if (!response.ok) {
      const detail = await response.text();
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
          await _streamWavResponse(response, engine, abortController);
      } else {
        const blob = await response.blob();
        if (!blob.size) {
          throw new Error('Wrapper returned empty audio payload.');
        }
        await _playAudioBlob(blob, engine);
      }
      return { ok: true, engine };
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

  return {
    speak,
    stop,
    pause,
    resume,
    setTtsVolume,
    getTtsVolume,
    setTtsFallbackVolume,
    getTtsFallbackVolume,
  };
})();

window.BlueprintsTtsClient = BlueprintsTtsClient;
