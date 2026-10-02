import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_STATES, createAudioBus } from './audioBus.js';

test('single-stream enforcement: a new claim stops the previous producer', () => {
  const bus = createAudioBus();
  const stopped = [];
  bus.claim({ id: 'radio', label: 'WXYZ', stop: () => stopped.push('radio') });
  bus.claim({ id: 'atc', label: 'KMYR TWR', stop: () => stopped.push('atc') });
  assert.deepEqual(stopped, ['radio']);
  assert.equal(bus.getState().owner.id, 'atc');
});

test('re-claiming by the same producer does not stop it', () => {
  const bus = createAudioBus();
  let stops = 0;
  bus.claim({ id: 'radio', stop: () => stops++ });
  bus.claim({ id: 'radio', label: 'next station', stop: () => stops++ });
  assert.equal(stops, 0);
  assert.equal(bus.getState().owner.label, 'next station');
});

test('release only frees the bus for its holder', () => {
  const bus = createAudioBus();
  bus.claim({ id: 'atc', stop() {} });
  assert.equal(bus.release('radio'), false);
  assert.equal(bus.getState().owner.id, 'atc');
  assert.equal(bus.release('atc'), true);
  assert.equal(bus.getState().owner, null);
});

test('a producer stopped by a new claim may release without disturbing the new owner', () => {
  const bus = createAudioBus();
  bus.claim({ id: 'radio', stop: () => bus.release('radio') });
  bus.claim({ id: 'atc', stop() {} });
  assert.equal(bus.getState().owner.id, 'atc');
});

test('stopAll, volume, mute and subscriptions', () => {
  const bus = createAudioBus();
  const seen = [];
  const unsubscribe = bus.subscribe((s) => seen.push(s));
  let stopped = false;
  bus.claim({ id: 'radio', stop: () => (stopped = true) });
  bus.stopAll();
  assert.equal(stopped, true);
  assert.equal(bus.setVolume(1.7), 1);
  assert.equal(bus.setVolume(-1), 0);
  assert.equal(bus.setMuted(true), true);
  unsubscribe();
  bus.setMuted(false);
  assert.equal(seen.at(-1).muted, true, 'no events after unsubscribe');
  assert.equal(seen[0].owner, null, 'subscribe reports the current state first');
});

test('a claim without a stop function is rejected', () => {
  assert.throws(() => createAudioBus().claim({ id: 'x' }), TypeError);
});

test('audio state names match the spec', () => {
  assert.deepEqual(Object.values(AUDIO_STATES), [
    'LIVE AUDIO',
    'NO AUDIO SOURCE',
    'EXTERNAL SOURCE',
    'USER SOURCE',
    'CONNECTING',
    'STREAM ERROR',
  ]);
});
