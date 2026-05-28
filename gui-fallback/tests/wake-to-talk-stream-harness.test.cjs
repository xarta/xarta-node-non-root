const assert = require('assert');
const WakeToTalkState = require('../js/wake-to-talk-state.js');

const { STATES, TIMERS } = WakeToTalkState;

function createHarness(config = {}) {
  const actions = [];
  const machine = WakeToTalkState.createMachine(config, { onAction: action => actions.push(action) });
  const classifier = WakeToTalkState.createSttEventClassifier({ stream_epoch: 1, reuse_window_frames: 40 });
  let frame = 0;
  machine.dispatch('activationChanged', { stt_mode: 'wake_to_talk', activated: true });
  machine.dispatch('micReady', { stream_epoch: 1, audio_frame: 0 });

  function send(text, utteranceId = '', phase = 'final', frameStep = 10) {
    frame += frameStep;
    const event = classifier.classify(
      { type: phase, phase, text, utterance_id: utteranceId },
      { stream_epoch: 1, audio_end_frame: frame }
    );
    machine.dispatch('speechHypothesis', event);
  }

  function timer(timerName) {
    machine.dispatch('timerElapsed', { timer: timerName, session_id: machine.getSessionId(), audio_frame: frame });
  }

  function confirmWake(text = 'Computer') {
    send(text, `wake-${frame + 10}`);
    assert.strictEqual(machine.getState(), STATES.WAKE_CANDIDATE);
    timer(TIMERS.TIMER_POST_WAKE);
    assert.strictEqual(machine.getState(), STATES.WAKE_CONFIRMED_WAITING_SPEECH);
  }

  return {
    machine,
    actions,
    send,
    timer,
    confirmWake,
    executes: () => actions.filter(action => action.type === 'execute'),
  };
}

{
  const h = createHarness({ instances: { local: { auto_execute_silence_ms: 600 } } });
  h.confirmWake();
  h.send('what is three times five', 'dict-auto');
  h.timer(TIMERS.TIMER_AUTO_EXECUTE);
  assert.strictEqual(h.executes().length, 1);
  assert.strictEqual(h.executes()[0].body, 'hermes: what is three times five');
  assert.deepStrictEqual(h.machine.getQueues().message_queue, []);
}

{
  const h = createHarness();
  h.confirmWake();
  h.send('what is three times five', 'dict-command');
  h.send('Computer execute', 'cmd-execute');
  assert.strictEqual(h.executes().length, 1);
  assert.strictEqual(h.executes()[0].body, 'hermes: what is three times five');
  assert.strictEqual(h.machine.getFrozenSendSnapshot().body, 'hermes: what is three times five');
}

{
  const h = createHarness();
  h.confirmWake();
  h.send('start this message', 'dict-pause-1');
  h.send('Computer pause-dictation', 'cmd-pause');
  assert.strictEqual(h.machine.getState(), STATES.PAUSED);
  h.send('this should not enter while paused', 'dict-paused-drop');
  assert.strictEqual(h.machine.getTranscript(), 'start this message');
  h.send('Computer resume-dictation', 'cmd-resume');
  assert.strictEqual(h.machine.getState(), STATES.CAPTURING);
  h.send('and finish it', 'dict-pause-2');
  h.send('Computer execute', 'cmd-execute');
  assert.strictEqual(h.executes()[0].body, 'hermes: start this message and finish it');
}

{
  const h = createHarness();
  h.confirmWake();
  h.send('throw this away', 'dict-cancel');
  h.send('Computer cancel-dictation', 'cmd-cancel');
  assert.strictEqual(h.machine.getState(), STATES.ARMED_IDLE);
  assert.deepStrictEqual(h.machine.getQueues().message_queue, []);
  assert.strictEqual(h.executes().length, 0);
}

{
  const h = createHarness({ instances: { local: { auto_execute_silence_ms: 600 } } });
  h.confirmWake();
  h.send('what is three', 'dict-cumulative', 'partial');
  h.send('what is three times five', 'dict-cumulative', 'final');
  h.send('what is three times five', 'dict-cumulative', 'final');
  assert.strictEqual(h.machine.getTranscript(), 'what is three times five');
  h.timer(TIMERS.TIMER_AUTO_EXECUTE);
  assert.strictEqual(h.executes().length, 1);
}

{
  const h = createHarness({ instances: { local: { auto_execute_silence_ms: 600 } } });
  h.confirmWake();
  h.send('repeatable phrase', 'dict-repeat-1');
  h.timer(TIMERS.TIMER_AUTO_EXECUTE);
  const firstSend = h.machine.getActiveSend();
  h.machine.dispatch('sendSucceeded', firstSend);
  h.timer(TIMERS.TIMER_SENT_FEEDBACK);
  h.confirmWake();
  h.send('repeatable phrase', 'dict-repeat-2');
  h.timer(TIMERS.TIMER_AUTO_EXECUTE);
  assert.strictEqual(h.executes().length, 2);
  assert.strictEqual(h.executes()[0].body, 'hermes: repeatable phrase');
  assert.strictEqual(h.executes()[1].body, 'hermes: repeatable phrase');
}

console.log('wake-to-talk simulated STT stream harness tests passed');
