const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WakeToTalkState = require('../js/wake-to-talk-state.js');

const { STATES, TIMERS } = WakeToTalkState;

const LIVE = process.env.WAKE_WAVE_E2E_LIVE === '1' || process.argv.includes('--live');
const TRANSCRIPT_DIR = process.env.WAKE_WAVE_TRANSCRIPT_DIR || '';
const API_BASE = String(process.env.BLUEPRINTS_API_BASE || '').replace(/\/$/, '');
const FIXTURE_DIR = process.env.WAKE_WAVE_FIXTURE_DIR || '/xarta-node/.lone-wolf/state/wake-to-talk-wave-e2e';
const TTS_VOICE = process.env.WAKE_WAVE_TTS_VOICE || 'Majel_1.wav';
const SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = 4096;
const SEND_EXPLICIT_END = process.env.WAKE_WAVE_SEND_END === '1';

const SCENARIOS = [
  {
    name: 'no-wake-no-send',
    parts: [{ text: 'what is three times five' }],
    autoExecute: 600,
    expectSends: 0,
    expectTranscriptLike: 'what is three times five',
  },
  {
    name: 'wake-phrase-autoexecute',
    parts: [{ text: 'Computer' }, { silenceMs: 750 }, { text: 'what is three times five' }],
    autoExecute: 600,
    expectSends: 1,
    expectBodyLike: 'hermes: what is three times five',
  },
  {
    name: 'wake-phrase-spoken-execute',
    parts: [{ text: 'Computer' }, { silenceMs: 750 }, { text: 'what is three times five' }, { silenceMs: 350 }, { text: 'Computer execute' }],
    autoExecute: 0,
    expectSends: 1,
    expectBodyLike: 'hermes: what is three times five',
  },
  {
    name: 'pause-resume-execute',
    parts: [
      { text: 'Computer' },
      { silenceMs: 750 },
      { text: 'start this message' },
      { silenceMs: 350 },
      { text: 'Computer pause dictation' },
      { silenceMs: 350 },
      { text: 'ignored while paused' },
      { silenceMs: 350 },
      { text: 'Computer resume dictation' },
      { silenceMs: 350 },
      { text: 'and finish it' },
      { silenceMs: 350 },
      { text: 'Computer execute' },
    ],
    autoExecute: 0,
    expectSends: 1,
    expectBodyLike: 'hermes: start this message and finish it',
    rejectBodyLike: 'ignored while paused',
  },
  {
    name: 'cancel-clears-no-send',
    parts: [{ text: 'Computer' }, { silenceMs: 750 }, { text: 'throw this away' }, { silenceMs: 350 }, { text: 'Computer cancel dictation' }],
    autoExecute: 0,
    expectSends: 0,
    expectTranscriptLike: 'throw this away',
  },
  {
    name: 'same-phrase-valid-separate-sessions',
    parts: [
      { text: 'Computer' },
      { silenceMs: 750 },
      { text: 'repeatable phrase' },
      { silenceMs: 1100 },
      { text: 'Computer' },
      { silenceMs: 750 },
      { text: 'repeatable phrase' },
    ],
    autoExecute: 600,
    expectSends: 2,
    expectBodyLike: 'hermes: repeatable phrase',
  },
];

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'fixture';
}

function normalize(value) {
  return WakeToTalkState.normalizeText(value)
    .replace(/\bzero\b/g, '0')
    .replace(/\bone\b/g, '1')
    .replace(/\btwo\b/g, '2')
    .replace(/\bthree\b/g, '3')
    .replace(/\bfour\b/g, '4')
    .replace(/\bfive\b/g, '5')
    .replace(/\bsix\b/g, '6')
    .replace(/\bseven\b/g, '7')
    .replace(/\beight\b/g, '8')
    .replace(/\bnine\b/g, '9')
    .replace(/\bten\b/g, '10');
}

function tokenSimilarity(actual, expected) {
  const a = new Set(normalize(actual).split(/\s+/).filter(Boolean));
  const e = normalize(expected).split(/\s+/).filter(Boolean);
  if (!e.length) return 1;
  let matched = 0;
  e.forEach(token => {
    if (a.has(token)) matched += 1;
  });
  return matched / e.length;
}

function assertLike(actual, expected, label) {
  const score = tokenSimilarity(actual, expected);
  assert.ok(score >= 0.65, `${label} similarity ${score.toFixed(2)} below threshold\nexpected-like: ${expected}\nactual: ${actual}`);
}

function writeWav(filePath, samples, sampleRate = SAMPLE_RATE) {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i] || 0));
    buffer.writeInt16LE(Math.round(value * 32767), 44 + (i * 2));
  }
  fs.writeFileSync(filePath, buffer);
}

function readWav(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${filePath} is not a RIFF/WAVE file`);
  }
  let offset = 12;
  let fmt = null;
  let dataOffset = 0;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      dataOffset = body;
      dataSize = size;
    }
    offset = body + size + (size % 2);
  }
  if (!fmt || !dataOffset || !dataSize) throw new Error(`${filePath} missing fmt/data chunks`);
  const frameBytes = (fmt.bitsPerSample / 8) * fmt.channels;
  const frames = Math.floor(dataSize / frameBytes);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let ch = 0; ch < fmt.channels; ch += 1) {
      const sampleOffset = dataOffset + (i * frameBytes) + (ch * fmt.bitsPerSample / 8);
      if (fmt.audioFormat === 3 && fmt.bitsPerSample === 32) {
        sum += buffer.readFloatLE(sampleOffset);
      } else if (fmt.audioFormat === 1 && fmt.bitsPerSample === 16) {
        sum += buffer.readInt16LE(sampleOffset) / 32768;
      } else if (fmt.audioFormat === 1 && fmt.bitsPerSample === 24) {
        const raw = buffer.readIntLE(sampleOffset, 3);
        sum += raw / 8388608;
      } else {
        throw new Error(`${filePath} unsupported WAV format ${fmt.audioFormat}/${fmt.bitsPerSample}`);
      }
    }
    mono[i] = sum / fmt.channels;
  }
  return resample(mono, fmt.sampleRate, SAMPLE_RATE);
}

function resample(input, inputRate, outputRate) {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const output = new Float32Array(Math.max(1, Math.floor(input.length / ratio)));
  for (let i = 0; i < output.length; i += 1) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(input.length - 1, left + 1);
    const frac = pos - left;
    output[i] = (input[left] || 0) * (1 - frac) + (input[right] || 0) * frac;
  }
  return output;
}

function concatFloat32(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Float32Array(total);
  let offset = 0;
  chunks.forEach(chunk => {
    output.set(chunk, offset);
    offset += chunk.length;
  });
  return output;
}

async function synthesizeText(text) {
  const response = await fetch(`${API_BASE}/api/v1/tts/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voice: TTS_VOICE,
      mode: 'batch',
      format: 'wav',
      sanitize_text: false,
      transform_profile: 'none',
      allow_fallback: false,
      client_id: 'wake-wave-e2e',
      timeout_ms: 120000,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`TTS HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function ensurePartWav(text) {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const filePath = path.join(FIXTURE_DIR, `${slug(text)}.wav`);
  if (!fs.existsSync(filePath) || process.env.WAKE_WAVE_REGENERATE === '1') {
    fs.writeFileSync(filePath, await synthesizeText(text));
  }
  return filePath;
}

async function buildScenarioWav(scenario) {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const filePath = path.join(FIXTURE_DIR, `${scenario.name}.wav`);
  if (fs.existsSync(filePath) && process.env.WAKE_WAVE_REGENERATE !== '1') return filePath;
  const chunks = [];
  for (const part of scenario.parts) {
    if (part.silenceMs) {
      chunks.push(new Float32Array(Math.round(SAMPLE_RATE * part.silenceMs / 1000)));
    } else if (part.text) {
      chunks.push(readWav(await ensurePartWav(part.text)));
    }
  }
  writeWav(filePath, concatFloat32(chunks));
  return filePath;
}

function createMachineHarness(scenario) {
  const actions = [];
  const machine = WakeToTalkState.createMachine({
    instances: {
      local: {
        auto_execute_silence_ms: scenario.autoExecute || 0,
        matrix_room_id: '!pre-matrix-snapshot:test',
      },
    },
  }, {
    onAction(action) {
      actions.push(action);
      if (action.type === 'execute') {
        const send = { session_id: action.session_id, send_id: action.send_id };
        machine.dispatch('sendSucceeded', send);
        machine.dispatch('timerElapsed', { timer: TIMERS.TIMER_SENT_FEEDBACK, session_id: action.session_id });
      }
    },
  });
  const classifier = WakeToTalkState.createSttEventClassifier({ stream_epoch: 1, reuse_window_frames: 50 });
  machine.dispatch('activationChanged', { stt_mode: 'wake_to_talk', activated: true });
  machine.dispatch('micReady', { stream_epoch: 1, audio_frame: 0 });
  return { machine, classifier, actions, seenUtterances: new Map() };
}

function newSegmentForHarness(harness, event) {
  const key = `${event.stream_epoch || 1}:${event.utterance_id || 'implicit'}`;
  const normalized = normalize(event.text);
  const previous = harness.seenUtterances.get(key) || '';
  harness.seenUtterances.set(key, normalized);
  if (!previous || previous === normalized) return previous ? '' : event.text;
  const previousWords = previous.split(/\s+/).filter(Boolean);
  const nextWords = normalized.split(/\s+/).filter(Boolean);
  let common = 0;
  while (common < previousWords.length && common < nextWords.length && previousWords[common] === nextWords[common]) {
    common += 1;
  }
  return common > 0 ? String(event.text || '').split(/\s+/).slice(common).join(' ') : event.text;
}

function driveMachineFromStt(harness, payload, frame) {
  if (payload.type !== 'partial' && payload.type !== 'final') return;
  const event = harness.classifier.classify(payload, {
    stream_epoch: 1,
    audio_end_frame: frame,
  });
  const newSegment = newSegmentForHarness(harness, event);
  const activeInstanceId = harness.machine.getActiveInstanceId?.() || 'local';
  const activeInstance = harness.machine.getConfig?.().instances?.[activeInstanceId] || {};
  const eventNorm = normalize(newSegment);
  const wakeAliases = [activeInstance.wake_word, ...(activeInstance.wake_aliases || [])].map(normalize).filter(Boolean);
  const looksLikeFreshWake = wakeAliases.some(alias => eventNorm === alias || eventNorm.startsWith(`${alias} `));
  if (looksLikeFreshWake && harness.machine.getState() === STATES.CAPTURING && harness.machine.getTranscript()) {
    const autoTimer = harness.actions.findLast?.(action => action.type === 'startTimer' && action.timer === TIMERS.TIMER_AUTO_EXECUTE);
    if (autoTimer) {
      harness.machine.dispatch('timerElapsed', { timer: TIMERS.TIMER_AUTO_EXECUTE, session_id: autoTimer.session_id, audio_frame: frame });
    }
  }
  harness.machine.dispatch('speechHypothesis', event);
  const state = harness.machine.getState();
  if (state === STATES.WAKE_CANDIDATE) {
    harness.machine.dispatch('timerElapsed', { timer: TIMERS.TIMER_POST_WAKE, session_id: harness.machine.getSessionId(), audio_frame: frame });
  } else if (state === STATES.CAPTURING && payload.type === 'final') {
    const autoTimer = harness.actions.findLast?.(action => action.type === 'startTimer' && action.timer === TIMERS.TIMER_AUTO_EXECUTE);
    if (autoTimer) {
      harness.machine.dispatch('timerElapsed', { timer: TIMERS.TIMER_AUTO_EXECUTE, session_id: autoTimer.session_id, audio_frame: frame });
    }
  }
}

function flushPendingAutoExecute(harness, frame) {
  if (harness.machine.getState() !== STATES.CAPTURING) return;
  const autoTimer = harness.actions.findLast?.(action => action.type === 'startTimer' && action.timer === TIMERS.TIMER_AUTO_EXECUTE);
  if (autoTimer) {
    harness.machine.dispatch('timerElapsed', { timer: TIMERS.TIMER_AUTO_EXECUTE, session_id: autoTimer.session_id, audio_frame: frame });
  }
}

async function runSttWebsocket(wavPath, harness) {
  const samples = readWav(wavPath);
  const wsUrl = new URL('/api/v1/voice-mode/stt/ws?server=tb1', API_BASE);
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(wsUrl.toString());
  const transcripts = [];
  let frame = 0;
  let doneSending = false;

  await new Promise((resolve, reject) => {
    let settleTimer = null;
    let settled = false;
    const timeout = setTimeout(() => reject(new Error(`STT timeout for ${wavPath}`)), 90000);
    const finish = () => {
      if (settled) return;
      settled = true;
      flushPendingAutoExecute(harness, frame);
      clearTimeout(timeout);
      if (settleTimer) clearTimeout(settleTimer);
      try { ws.close(); } catch (_) {}
      resolve();
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (settleTimer) clearTimeout(settleTimer);
      reject(error);
    };
    const settle = () => {
      if (!doneSending) return;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        finish();
      }, SEND_EXPLICIT_END ? 1000 : 3500);
    };
    ws.addEventListener('open', async () => {
      try {
        for (let offset = 0; offset < samples.length; offset += CHUNK_SAMPLES) {
          const chunk = samples.slice(offset, offset + CHUNK_SAMPLES);
          frame += chunk.length;
          ws.send(chunk.buffer);
          await new Promise(r => setTimeout(r, Math.max(1, Math.round((chunk.length / SAMPLE_RATE) * 1000))));
        }
        doneSending = true;
        if (SEND_EXPLICIT_END) {
          ws.send(JSON.stringify({ type: 'end', audio_frames: Math.ceil(samples.length / CHUNK_SAMPLES), audio_bytes: samples.byteLength }));
        }
        settle();
      } catch (error) {
        fail(error);
      }
    });
    ws.addEventListener('message', event => {
      let payload = {};
      try { payload = JSON.parse(String(event.data || '{}')); } catch (_) { return; }
      if (payload.type === 'partial' || payload.type === 'final') {
        transcripts.push({ type: payload.type, text: payload.text || '' });
        driveMachineFromStt(harness, payload, frame);
        settle();
      }
      if (payload.type === 'final') {
        settle();
      } else if (payload.type === 'error') {
        fail(new Error(payload.detail || 'STT websocket error'));
      }
    });
    ws.addEventListener('error', () => {
      fail(new Error(`WebSocket error for ${wsUrl}`));
    });
    ws.addEventListener('close', () => {
      if (doneSending) finish();
      else fail(new Error(`WebSocket closed before fixture audio finished for ${wavPath}`));
    });
  });
  return transcripts;
}

async function runScenario(scenario) {
  const wavPath = await buildScenarioWav(scenario);
  const harness = createMachineHarness(scenario);
  const transcripts = await runSttWebsocket(wavPath, harness);
  const sends = harness.actions.filter(action => action.type === 'execute');
  assert.strictEqual(sends.length, scenario.expectSends, `${scenario.name} send count\ntranscripts=${JSON.stringify(transcripts)}`);
  if (scenario.expectBodyLike && sends.length) {
    sends.forEach(send => assertLike(send.body, scenario.expectBodyLike, `${scenario.name} body`));
  }
  if (scenario.rejectBodyLike && sends.length) {
    sends.forEach(send => assert.ok(tokenSimilarity(send.body, scenario.rejectBodyLike) < 0.5, `${scenario.name} rejected text leaked: ${send.body}`));
  }
  if (scenario.expectTranscriptLike) {
    const joined = transcripts.map(item => item.text).join(' ');
    assertLike(joined, scenario.expectTranscriptLike, `${scenario.name} STT transcript`);
  }
  console.log(`${scenario.name}: sends=${sends.length} transcripts=${transcripts.map(t => `${t.type}:${t.text}`).join(' | ')}`);
}

async function runTranscriptScenario(scenario) {
  const transcriptPath = path.join(TRANSCRIPT_DIR, `${scenario.name}.json`);
  const payload = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
  const harness = createMachineHarness(scenario);
  const transcripts = Array.isArray(payload.transcripts) ? payload.transcripts : [];
  transcripts.forEach((item, index) => {
    driveMachineFromStt(harness, {
      type: item.type || item.phase || 'final',
      text: item.text || '',
      utterance_id: item.utterance_id || `${scenario.name}-${index}`,
      is_final: (item.type || item.phase) === 'final',
    }, Number(item.audio_end_frame || ((index + 1) * 100)));
  });
  const sends = harness.actions.filter(action => action.type === 'execute');
  assert.strictEqual(sends.length, scenario.expectSends, `${scenario.name} send count\ntranscripts=${JSON.stringify(transcripts)}`);
  if (scenario.expectBodyLike && sends.length) {
    sends.forEach(send => assertLike(send.body, scenario.expectBodyLike, `${scenario.name} body`));
  }
  if (scenario.rejectBodyLike && sends.length) {
    sends.forEach(send => assert.ok(tokenSimilarity(send.body, scenario.rejectBodyLike) < 0.5, `${scenario.name} rejected text leaked: ${send.body}`));
  }
  if (scenario.expectTranscriptLike) {
    const joined = transcripts.map(item => item.text).join(' ');
    assertLike(joined, scenario.expectTranscriptLike, `${scenario.name} STT transcript`);
  }
  console.log(`${scenario.name}: replayed=${transcripts.length} sends=${sends.length}`);
}

async function assertLiveWakeNotActive() {
  if (process.env.WAKE_WAVE_ALLOW_ACTIVE_WAKE === '1') return;
  const response = await fetch(`${API_BASE}/api/v1/voice-mode/status`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(`Could not verify Voice Mode active state before live E2E: HTTP ${response.status}`);
  }
  const active = payload.active || null;
  const activeMode = active && active.stt_enabled ? String(active.stt_mode || '') : '';
  if (activeMode === 'wake_to_talk') {
    throw new Error(
      'Live wake wave E2E requires browser Wake to Talk to be inactive first; ' +
      'the live test opens its own STT websocket and should not compete with the active browser Wake controller. ' +
      'Set WAKE_WAVE_ALLOW_ACTIVE_WAKE=1 only for an intentional contention test.'
    );
  }
}

async function main() {
  if (TRANSCRIPT_DIR) {
    for (const scenario of SCENARIOS) {
      await runTranscriptScenario(scenario);
    }
    console.log('wake-to-talk captured WAV/STT transcript -> FSM snapshot tests passed');
    return;
  }
  if (!LIVE) {
    console.log('wake-to-talk wave E2E tests skipped; set WAKE_WAVE_E2E_LIVE=1 or pass --live to generate TTS WAV fixtures and use live STT.');
    return;
  }
  if (!API_BASE) {
    throw new Error('Set BLUEPRINTS_API_BASE before running live wake-to-talk wave E2E tests.');
  }
  await assertLiveWakeNotActive();
  for (const scenario of SCENARIOS) {
    await runScenario(scenario);
  }
  console.log('wake-to-talk live TTS WAV -> STT -> FSM snapshot tests passed');
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
