const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WakeToTalkState = require('../js/wake-to-talk-state.js');

const { STT_SEGMENT_STATES, STATES, TIMERS } = WakeToTalkState;

function makeFrame(id, bytes = 8) {
  return {
    pcm: { byteLength: bytes, id },
    byteLength: bytes,
    audio_frame: id,
  };
}

function createSegmentHarness() {
  const actions = [];
  const controller = WakeToTalkState.createSttSegmentController({
    pre_roll_frames: 2,
    final_timeout_ms: 3200,
    onAction: action => actions.push(action),
  });
  return { controller, actions };
}

function actionTypes(actions, type) {
  return actions.filter(action => action.type === type);
}

{
  const h = createSegmentHarness();
  h.controller.dispatch('micFrame', makeFrame(1));
  h.controller.dispatch('micFrame', makeFrame(2));
  h.controller.dispatch('vadCandidateStart');
  h.controller.dispatch('vadSpeechStart');
  const open = actionTypes(h.actions, 'openSttSegment')[0];
  assert(open, 'speech start opens one STT segment');
  h.controller.dispatch('micFrame', makeFrame(3));
  h.controller.dispatch('socketOpen', { segment_id: open.segment_id });
  h.controller.dispatch('micFrame', makeFrame(4));
  h.controller.dispatch('vadSpeechEnd', { reason: 'vad_timeout' });
  h.controller.dispatch('sttFinal', { text: 'Peter Piper' });

  assert.strictEqual(actionTypes(h.actions, 'openSttSegment').length, 1);
  assert.strictEqual(actionTypes(h.actions, 'sendEnd').length, 1);
  assert.strictEqual(actionTypes(h.actions, 'emitUtteranceFinal').length, 1);
  assert.strictEqual(actionTypes(h.actions, 'emitUtteranceFinal')[0].text, 'Peter Piper');
  assert.deepStrictEqual(actionTypes(h.actions, 'sendPcmFrame').map(action => action.audio_frame), [1, 2, 3, 4]);
  assert.strictEqual(h.controller.getState(), STT_SEGMENT_STATES.IDLE);
}

{
  const h = createSegmentHarness();
  h.controller.dispatch('micFrame', makeFrame(1));
  h.controller.dispatch('micFrame', makeFrame(2));
  h.controller.dispatch('vadCandidateStart');
  h.controller.dispatch('micFrame', makeFrame(3));
  h.controller.dispatch('micFrame', makeFrame(4));
  h.controller.dispatch('vadSpeechStart');
  const open = actionTypes(h.actions, 'openSttSegment')[0];
  h.controller.dispatch('socketOpen', { segment_id: open.segment_id });
  h.controller.dispatch('vadSpeechEnd', { reason: 'vad_timeout' });
  assert.deepStrictEqual(
    actionTypes(h.actions, 'sendPcmFrame').map(action => action.audio_frame),
    [3, 4],
    'candidate buffering should preserve the latest 1-2 frames before strong confirmation'
  );
}

{
  const h = createSegmentHarness();
  ['Computer', 'what is three'].forEach((text, index) => {
    const base = (index * 10) + 1;
    h.controller.dispatch('micFrame', makeFrame(base));
    h.controller.dispatch('micFrame', makeFrame(base + 1));
    h.controller.dispatch('vadCandidateStart');
    h.controller.dispatch('vadSpeechStart');
    const open = actionTypes(h.actions, 'openSttSegment').at(-1);
    h.controller.dispatch('socketOpen', { segment_id: open.segment_id });
    h.controller.dispatch('vadSpeechEnd', { reason: 'vad_timeout' });
    h.controller.dispatch('sttFinal', { text });
  });
  assert.strictEqual(actionTypes(h.actions, 'openSttSegment').length, 2);
  assert.strictEqual(actionTypes(h.actions, 'sendEnd').length, 2);
  assert.deepStrictEqual(actionTypes(h.actions, 'emitUtteranceFinal').map(action => action.text), ['Computer', 'what is three']);
  assert.strictEqual(h.controller.getState(), STT_SEGMENT_STATES.IDLE);
}

{
  const h = createSegmentHarness();
  h.controller.dispatch('micFrame', makeFrame(1));
  h.controller.dispatch('vadCandidateStart');
  h.controller.dispatch('micFrame', makeFrame(2));
  h.controller.dispatch('vadCandidateReject', { reason: 'weak_candidate' });
  assert.strictEqual(actionTypes(h.actions, 'openSttSegment').length, 0);
  assert.strictEqual(actionTypes(h.actions, 'sendEnd').length, 0);
  assert.strictEqual(h.controller.getState(), STT_SEGMENT_STATES.IDLE);
}

{
  const h = createSegmentHarness();
  h.controller.dispatch('micFrame', makeFrame(1));
  h.controller.dispatch('micFrame', makeFrame(2));
  h.controller.dispatch('vadCandidateStart');
  h.controller.dispatch('vadSpeechStart');
  const open = actionTypes(h.actions, 'openSttSegment')[0];
  h.controller.dispatch('socketOpen', { segment_id: open.segment_id });
  h.controller.dispatch('vadSpeechEnd', { reason: 'vad_timeout' });
  h.controller.dispatch('segmentTimeout', { segment_id: open.segment_id, reason: 'final_timeout' });
  assert.strictEqual(actionTypes(h.actions, 'sendEnd').length, 1);
  assert.strictEqual(actionTypes(h.actions, 'emitUtteranceFinal').length, 0);
  assert.strictEqual(actionTypes(h.actions, 'closeSegment').length, 1);
  assert.strictEqual(h.controller.getState(), STT_SEGMENT_STATES.IDLE);
}

{
  const source = fs.readFileSync(path.join(__dirname, '../js/wake-dev.js'), 'utf8');
  assert(
    source.includes("wakeController.stop?.('manual-stt-test-mode')"),
    'manual STT test mode must pause live Wake before opening its own STT session'
  );
  assert(
    source.includes('restoreWakeController();'),
    'manual STT test mode must restore live Wake after disabling the probe'
  );
}

{
  const { controller, actions } = createSegmentHarness();
  const machineActions = [];
  const machine = WakeToTalkState.createMachine(
    { instances: { local: { matrix_room_id: '!bridge:test' } } },
    { onAction: action => machineActions.push(action) }
  );
  const classifier = WakeToTalkState.createSttEventClassifier({ stream_epoch: 1 });
  let frame = 0;

  machine.dispatch('activationChanged', { stt_mode: 'wake_to_talk', activated: true });
  machine.dispatch('micReady', { stream_epoch: 1, audio_frame: 0 });

  function utterance(text) {
    frame += 10;
    controller.dispatch('micFrame', makeFrame(frame - 1));
    controller.dispatch('micFrame', makeFrame(frame));
    controller.dispatch('vadCandidateStart');
    controller.dispatch('vadSpeechStart');
    const open = actionTypes(actions, 'openSttSegment').at(-1);
    controller.dispatch('socketOpen', { segment_id: open.segment_id });
    controller.dispatch('vadSpeechEnd', { reason: 'vad_timeout' });
    controller.dispatch('sttFinal', { text });
    const final = actionTypes(actions, 'emitUtteranceFinal').at(-1);
    const event = classifier.classify(
      { type: 'final', text: final.text, utterance_id: final.segment_id },
      { stream_epoch: 1, audio_end_frame: frame }
    );
    machine.dispatch('speechHypothesis', event);
  }

  utterance('Computer');
  assert.strictEqual(machine.getState(), STATES.WAKE_CANDIDATE);
  machine.dispatch('timerElapsed', { timer: TIMERS.TIMER_POST_WAKE, session_id: machine.getSessionId(), audio_frame: frame });
  assert.strictEqual(machine.getState(), STATES.WAKE_CONFIRMED_WAITING_SPEECH);
  utterance('Peter Piper picked a peck');
  assert.strictEqual(machine.getState(), STATES.CAPTURING);
  utterance('Computer execute');
  const sends = machineActions.filter(action => action.type === 'execute');
  assert.strictEqual(sends.length, 1);
  assert.strictEqual(sends[0].body, 'hermes: Peter Piper picked a peck');
}

console.log('wake-to-talk STT segment controller tests passed');
