const assert = require('assert');
const WakeToTalkState = require('../js/wake-to-talk-state.js');

const { STATES, TIMERS } = WakeToTalkState;

function makeMachine(config = {}) {
  const actions = [];
  const machine = WakeToTalkState.createMachine(config, {
    onAction(action) {
      actions.push(action);
    },
  });
  return { machine, actions };
}

function arm(machine, streamEpoch = 1) {
  machine.dispatch('activationChanged', { stt_mode: 'wake_to_talk', activated: true });
  machine.dispatch('micReady', { stream_epoch: streamEpoch, audio_frame: 0 });
  assert.strictEqual(machine.getState(), STATES.ARMED_IDLE);
}

function say(machine, text, frame, utteranceId, phase = 'final', streamEpoch = 1) {
  machine.dispatch('speechHypothesis', {
    phase,
    text,
    normalized_text: WakeToTalkState.normalizeText(text),
    utterance_id: utteranceId,
    stream_epoch: streamEpoch,
    audio_start_frame: Math.max(0, frame - 1),
    audio_end_frame: frame,
  });
}

function wake(machine, frame = 10, utteranceId = 'wake') {
  say(machine, 'Computer', frame, utteranceId);
  assert.strictEqual(machine.getState(), STATES.WAKE_CANDIDATE);
  const sessionId = machine.getSessionId();
  machine.dispatch('timerElapsed', { timer: TIMERS.TIMER_POST_WAKE, session_id: sessionId, audio_frame: frame });
  assert.strictEqual(machine.getState(), STATES.WAKE_CONFIRMED_WAITING_SPEECH);
  return sessionId;
}

function executes(actions) {
  return actions.filter(action => action.type === 'execute');
}

{
  const classifier = WakeToTalkState.createSttEventClassifier({ stream_epoch: 7, reuse_window_frames: 40 });
  const partial = classifier.classify({ type: 'partial', text: 'what is three' }, { audio_end_frame: 100 });
  const final = classifier.classify({ type: 'final', text: 'what is three times five' }, { audio_end_frame: 108 });
  const replay = classifier.classify({ type: 'final', text: 'what is three times five' }, { audio_end_frame: 112 });
  assert.strictEqual(partial.utterance_id, final.utterance_id);
  assert.strictEqual(replay.utterance_id, final.utterance_id);
  assert.strictEqual(final.stream_epoch, 7);
}

{
  const { machine } = makeMachine();
  machine.dispatch('activationChanged', { stt_mode: 'wake_to_talk', activated: false });
  assert.strictEqual(machine.getState(), STATES.SELECTED_INACTIVE);
  machine.dispatch('activationChanged', { stt_mode: 'wake_to_talk', activated: true });
  assert.strictEqual(machine.getState(), STATES.PERMISSION_PENDING);
  machine.dispatch('micReady', { stream_epoch: 1, audio_frame: 0 });
  assert.strictEqual(machine.getState(), STATES.ARMED_IDLE);
}

{
  const { machine } = makeMachine();
  machine.dispatch('activationChanged', { stt_mode: '', activated: true });
  assert.strictEqual(machine.getState(), STATES.DISABLED);
  machine.dispatch('micReady', { stream_epoch: 1, audio_frame: 0 });
  assert.strictEqual(machine.getState(), STATES.DISABLED);
}

{
  const { machine } = makeMachine();
  arm(machine);
  machine.dispatch('activationChanged', { stt_mode: '', activated: true });
  assert.strictEqual(machine.getState(), STATES.DISABLED);
  machine.dispatch('micReady', { stream_epoch: 2, audio_frame: 0 });
  assert.strictEqual(machine.getState(), STATES.DISABLED);
}

{
  const { machine } = makeMachine();
  arm(machine);
  machine.dispatch('activationChanged', { stt_mode: 'wake_to_talk', activated: false });
  assert.strictEqual(machine.getState(), STATES.SELECTED_INACTIVE);
  machine.dispatch('micReady', { stream_epoch: 2, audio_frame: 0 });
  assert.strictEqual(machine.getState(), STATES.SELECTED_INACTIVE);
}

{
  const { machine } = makeMachine();
  machine.dispatch('activationChanged', {
    stt_mode: 'wake_to_talk',
    activated: true,
    blocked_reason: 'Select a Matrix room for local or vps.',
  });
  assert.strictEqual(machine.getState(), STATES.BLOCKED);
  say(machine, 'Computer', 10, 'blocked-wake');
  assert.strictEqual(machine.getState(), STATES.BLOCKED);
  machine.dispatch('activationChanged', { stt_mode: 'wake_to_talk', activated: true });
  assert.strictEqual(machine.getState(), STATES.PERMISSION_PENDING);
}

{
  const { machine, actions } = makeMachine({ instances: { local: { matrix_room_id: '!bridge:test' } } });
  arm(machine);
  wake(machine);
  assert(actions.some(action => action.type === 'resetStt' && action.reason === 'wake_confirmed_waiting_speech'));
  say(machine, 'what is three times five', 20, 'dict-1');
  assert.strictEqual(machine.getState(), STATES.CAPTURING);
  assert.strictEqual(machine.getTranscript(), 'what is three times five');
  machine.dispatch('manualExecute', { session_id: machine.getSessionId() });
  assert.strictEqual(machine.getState(), STATES.EXECUTING);
  assert.deepStrictEqual(machine.getQueues().message_queue, []);
  machine.dispatch('manualExecute', { session_id: machine.getSessionId() });
  assert.strictEqual(executes(actions).length, 1);
  assert.strictEqual(executes(actions)[0].body, 'hermes: what is three times five');
  assert.strictEqual(machine.getFrozenSendSnapshot().body, 'hermes: what is three times five');
}

{
  const { machine, actions } = makeMachine({ instances: { local: { matrix_room_id: '!bridge:test' } } });
  arm(machine);
  wake(machine);
  say(machine, 'diagnose the vad boundary', 20, 'dict-vad');
  assert.strictEqual(machine.getState(), STATES.CAPTURING);
  machine.dispatch('vadTimeout', { timeout_ms: 900, audio_frame: 25 });
  assert.strictEqual(machine.getState(), STATES.CAPTURING);
  assert.strictEqual(machine.getTranscript(), 'diagnose the vad boundary');
  const reset = actions.find(action => action.type === 'resetStt' && action.reason === 'vad_timeout');
  assert(reset);
  assert.strictEqual(reset.timeout_ms, 900);
}

{
  const { machine, actions } = makeMachine({ instances: { local: { matrix_room_id: '!bridge:test' } } });
  arm(machine);
  wake(machine);
  say(machine, 'diagnose the silence boundary', 20, 'dict-silence');
  assert.strictEqual(machine.getState(), STATES.CAPTURING);
  machine.dispatch('silenceTimeout', { timeout_ms: 2100, audio_frame: 32 });
  assert.strictEqual(machine.getState(), STATES.CAPTURING);
  assert.strictEqual(machine.getTranscript(), 'diagnose the silence boundary');
  const reset = actions.find(action => action.type === 'resetStt' && action.reason === 'silence_timeout');
  assert(reset);
  assert.strictEqual(reset.timeout_ms, 2100);
}

{
  const { machine, actions } = makeMachine({ instances: { local: { matrix_room_id: '!bridge:test' } } });
  arm(machine);
  machine.dispatch('vadSpeechStart', { audio_frame: 8 });
  assert.strictEqual(machine.getState(), STATES.ARMED_IDLE);
  const reset = actions.find(action => action.type === 'resetStt' && action.reason === 'vad_speech_start');
  assert(reset);
  assert.strictEqual(reset.audio_frame, 8);
}

{
  const { machine } = makeMachine();
  arm(machine);
  say(machine, 'Computer', 10, 'wake-partial', 'partial');
  assert.strictEqual(machine.getState(), STATES.WAKE_CANDIDATE);
}

{
  const { machine, actions } = makeMachine();
  arm(machine);
  wake(machine);
  say(machine, 'something disposable', 20, 'dict-1');
  say(machine, 'Computer cancel-dictation', 30, 'cmd-cancel');
  assert.strictEqual(machine.getState(), STATES.ARMED_IDLE);
  assert.strictEqual(machine.getTranscript(), '');
  assert.deepStrictEqual(machine.getQueues().message_queue, []);
  assert.strictEqual(executes(actions).length, 0);
}

{
  const { machine, actions } = makeMachine();
  arm(machine);
  wake(machine);
  say(machine, 'run backup', 20, 'dict-1');
  say(machine, 'Computer pause-dictation', 30, 'cmd-pause');
  assert.strictEqual(machine.getState(), STATES.PAUSED);
  assert.strictEqual(machine.getTranscript(), 'run backup');
  say(machine, 'Computer resume-dictation', 40, 'cmd-resume');
  assert.strictEqual(machine.getState(), STATES.CAPTURING);
  assert.strictEqual(machine.getTranscript(), 'run backup');
  say(machine, 'Computer execute', 50, 'cmd-execute');
  assert.strictEqual(machine.getState(), STATES.EXECUTING);
  assert.strictEqual(executes(actions)[0].body, 'hermes: run backup');
}

{
  const { machine, actions } = makeMachine();
  arm(machine);
  wake(machine);
  say(machine, 'Computer pause-dictation', 20, 'cmd-pause');
  assert.strictEqual(machine.getState(), STATES.PAUSED);
  assert.strictEqual(machine.getTranscript(), '');
  say(machine, 'Computer cancel-dictation', 30, 'cmd-cancel');
  assert.strictEqual(machine.getState(), STATES.ARMED_IDLE);
  assert.strictEqual(executes(actions).length, 0);
}

{
  const { machine, actions } = makeMachine();
  arm(machine);
  wake(machine);
  say(machine, 'the word computer belongs in this message', 20, 'dict-1');
  assert.strictEqual(machine.getTranscript(), 'the word computer belongs in this message');
  say(machine, 'Computer execute', 30, 'cmd-execute');
  assert.strictEqual(executes(actions)[0].body, 'hermes: the word computer belongs in this message');
}

{
  const { machine, actions } = makeMachine({
    instances: { local: { auto_execute_silence_ms: 600, matrix_room_id: '!bridge:test' } },
  });
  arm(machine);
  wake(machine);
  say(machine, 'what is three', 20, 'dict-cumulative', 'partial');
  say(machine, 'what is three times five', 21, 'dict-cumulative', 'final');
  assert.strictEqual(machine.getTranscript(), 'what is three times five');
  say(machine, 'what is three times five', 22, 'dict-cumulative', 'final');
  assert.strictEqual(machine.getTranscript(), 'what is three times five');
  machine.dispatch('timerElapsed', { timer: TIMERS.TIMER_AUTO_EXECUTE, session_id: machine.getSessionId() });
  assert.strictEqual(executes(actions).length, 1);
  assert.strictEqual(executes(actions)[0].body, 'hermes: what is three times five');
}

{
  const { machine, actions } = makeMachine({ instances: { local: { auto_execute_silence_ms: 600 } } });
  arm(machine);
  wake(machine);
  say(machine, 'are you okay', 20, 'dict-1');
  const oldSession = machine.getSessionId();
  machine.dispatch('timerElapsed', { timer: TIMERS.TIMER_AUTO_EXECUTE, session_id: oldSession - 1 });
  assert.strictEqual(executes(actions).length, 0);
  assert.strictEqual(machine.getState(), STATES.CAPTURING);
  machine.dispatch('timerElapsed', { timer: TIMERS.TIMER_AUTO_EXECUTE, session_id: oldSession });
  assert.strictEqual(executes(actions).length, 1);
}

{
  const { machine, actions } = makeMachine({ instances: { local: { auto_execute_silence_ms: 600 } } });
  arm(machine);
  wake(machine);
  say(machine, 'are you okay', 20, 'dict-1');
  machine.dispatch('timerElapsed', { timer: TIMERS.TIMER_AUTO_EXECUTE, session_id: machine.getSessionId() });
  const send = machine.getActiveSend();
  machine.dispatch('sendSucceeded', { session_id: send.session_id + 1, send_id: send.send_id });
  assert.strictEqual(machine.getState(), STATES.EXECUTING);
  machine.dispatch('sendSucceeded', { session_id: send.session_id, send_id: send.send_id + 1 });
  assert.strictEqual(machine.getState(), STATES.EXECUTING);
  machine.dispatch('sendSucceeded', send);
  assert.strictEqual(machine.getState(), STATES.SENT_FEEDBACK);
  say(machine, 'Computer are you okay', 25, 'stale-after-send');
  assert.strictEqual(machine.getState(), STATES.SENT_FEEDBACK);
  assert.strictEqual(executes(actions).length, 1);
}

{
  const { machine, actions } = makeMachine({ instances: { local: { auto_execute_silence_ms: 600 } } });
  arm(machine);
  wake(machine);
  say(machine, 'echo test', 20, 'dict-1');
  machine.dispatch('timerElapsed', { timer: TIMERS.TIMER_AUTO_EXECUTE, session_id: machine.getSessionId() });
  const send = machine.getActiveSend();
  machine.dispatch('sendSucceeded', send);
  machine.dispatch('timerElapsed', { timer: TIMERS.TIMER_SENT_FEEDBACK, session_id: send.session_id, audio_frame: 20 });
  assert.strictEqual(machine.getState(), STATES.ARMED_IDLE);
  say(machine, 'Computer', 20, 'old-wake');
  assert.strictEqual(machine.getState(), STATES.ARMED_IDLE);
  say(machine, 'Computer', 30, 'fresh-wake');
  assert.strictEqual(machine.getState(), STATES.WAKE_CANDIDATE);
  machine.dispatch('timerElapsed', { timer: TIMERS.TIMER_POST_WAKE, session_id: machine.getSessionId(), audio_frame: 30 });
  say(machine, 'echo test', 40, 'dict-2');
  machine.dispatch('timerElapsed', { timer: TIMERS.TIMER_AUTO_EXECUTE, session_id: machine.getSessionId() });
  assert.strictEqual(executes(actions).length, 2);
  assert.strictEqual(executes(actions)[0].body, 'hermes: echo test');
  assert.strictEqual(executes(actions)[1].body, 'hermes: echo test');
}

{
  const { machine, actions } = makeMachine();
  arm(machine);
  wake(machine);
  say(machine, 'do not send this', 20, 'dict-1');
  machine.dispatch('activationChanged', { stt_mode: 'wake_to_talk', activated: false });
  assert.strictEqual(machine.getState(), STATES.SELECTED_INACTIVE);
  assert.deepStrictEqual(machine.getQueues().message_queue, []);
  assert.strictEqual(executes(actions).length, 0);
}

{
  const { machine, actions } = makeMachine({ instances: { local: { auto_execute_silence_ms: 600 } } });
  arm(machine);
  wake(machine);
  say(machine, 'what is three times five', 20, 'dict-1');
  machine.dispatch('timerElapsed', { timer: TIMERS.TIMER_AUTO_EXECUTE, session_id: machine.getSessionId() });
  assert.strictEqual(executes(actions).length, 1);
  assert.strictEqual(machine.getFrozenSendSnapshot().body, 'hermes: what is three times five');
  assert.deepStrictEqual(machine.getQueues().message_queue, []);
}

{
  const { machine, actions } = makeMachine();
  arm(machine);
  wake(machine);
  say(machine, 'what is three times five', 20, 'dict-1');
  say(machine, 'Computer', 30, 'cmd-wake');
  assert.strictEqual(machine.getState(), STATES.COMMAND_CANDIDATE);
  assert.strictEqual(machine.getTranscript(), 'what is three times five');
  say(machine, 'execute', 31, 'cmd-word');
  assert.strictEqual(machine.getState(), STATES.EXECUTING);
  assert.strictEqual(executes(actions)[0].body, 'hermes: what is three times five');
}

{
  const { machine, actions } = makeMachine();
  arm(machine);
  wake(machine);
  say(machine, 'what is three times five', 20, 'dict-1');
  say(machine, 'Computer X', 30, 'cmd-noise', 'partial');
  assert.strictEqual(machine.getState(), STATES.COMMAND_CANDIDATE);
  say(machine, 'Computer X', 40, 'cmd-noise', 'final');
  assert.strictEqual(machine.getState(), STATES.CAPTURING);
  machine.dispatch('manualExecute', { session_id: machine.getSessionId() });
  assert.strictEqual(executes(actions).length, 1);
  assert.ok(!executes(actions)[0].body.toLowerCase().includes('execute'));
}

{
  const { machine, actions } = makeMachine();
  arm(machine);
  wake(machine);
  say(machine, 'keep this', 20, 'dict-1');
  say(machine, 'Computer pause dictate', 30, 'cmd-imprecise');
  assert.strictEqual(machine.getState(), STATES.CAPTURING);
  assert.strictEqual(machine.getTranscript(), 'keep this Computer pause dictate');
  machine.dispatch('manualExecute', { session_id: machine.getSessionId() });
  assert.strictEqual(executes(actions)[0].body, 'hermes: keep this Computer pause dictate');
}

{
  const { machine, actions } = makeMachine();
  arm(machine);
  wake(machine);
  say(machine, 'keep this', 20, 'dict-1');
  say(machine, 'Computer pause dictate', 30, 'cmd-partial', 'partial');
  assert.strictEqual(machine.getState(), STATES.COMMAND_CANDIDATE);
  assert.strictEqual(machine.getTranscript(), 'keep this');
  say(machine, 'Computer pause dictation', 40, 'cmd-partial', 'final');
  assert.strictEqual(machine.getState(), STATES.PAUSED);
  assert.strictEqual(machine.getTranscript(), 'keep this');
  say(machine, 'Computer execute', 50, 'cmd-execute');
  assert.strictEqual(executes(actions)[0].body, 'hermes: keep this');
}

{
  const config = WakeToTalkState.mergedConfig({});
  assert.strictEqual(
    WakeToTalkState.sanitizeTranscript('Computer run backup Computer execute', config.instances.local),
    'hermes: run backup'
  );
  assert.strictEqual(
    WakeToTalkState.sanitizeTranscript('Mini Me check status mini-me execute', config.instances.vps),
    'hermes-vps: check status'
  );
  assert.strictEqual(
    WakeToTalkState.formatSendBody('computer should remain here', config.instances.local),
    'hermes: computer should remain here'
  );
}

console.log('wake-to-talk-state FIFO/FSM tests passed');
