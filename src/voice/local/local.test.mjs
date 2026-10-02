import test from 'node:test';
import assert from 'node:assert/strict';
import { concatChunks, encodeWav, peakLevel, resample, rmsLevel } from './wav.js';
import { createVad } from './vad.js';
import {
  normalizeVoiceSettings,
  outputIsBlackHole,
  pickMicrophone,
  stripWakePhrase,
} from './settings.js';

test('WAV output is 16 kHz mono 16-bit PCM with a valid header', () => {
  const tone = new Float32Array(48000).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48000));
  const wav = encodeWav(tone, 48000);
  const view = new DataView(wav.buffer);
  const ascii = (o, n) => String.fromCharCode(...wav.slice(o, o + n));
  assert.equal(ascii(0, 4), 'RIFF');
  assert.equal(ascii(8, 4), 'WAVE');
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 16000 * 2);
  assert.equal(wav.length, 44 + 32000);
  assert.ok(Math.abs(view.getInt16(44 + 2 * 9, true)) > 0);
  assert.equal(resample(new Float32Array(10), 16000).length, 10);
  assert.equal(concatChunks([new Float32Array(3), new Float32Array(2)]).length, 5);
  assert.ok(Math.abs(peakLevel(Float32Array.from([0.1, -0.7, 0.3])) - 0.7) < 1e-6);
  assert.ok(Math.abs(rmsLevel(Float32Array.from([0.5, -0.5])) - 0.5) < 1e-9);
});

test('voice activity starts after sustained sound and ends after silence', () => {
  const vad = createVad({ threshold: 0.02, startMs: 200, endSilenceMs: 800 });
  const events = [];
  const feed = (rms, n) => {
    for (let i = 0; i < n; i += 1) {
      const e = vad.push(rms, 100);
      if (e) events.push(e);
    }
  };
  feed(0.001, 5);
  feed(0.05, 1);
  feed(0.001, 1); // a click is not speech
  assert.deepEqual(events, []);
  feed(0.05, 10);
  assert.deepEqual(events, ['start']);
  feed(0.001, 7);
  assert.deepEqual(events, ['start']);
  feed(0.001, 1);
  assert.deepEqual(events, ['start', 'end']);
});

test('BlackHole 2ch is preselected; a saved choice wins', () => {
  const devices = [
    { kind: 'audioinput', deviceId: 'default', label: 'Default - Mac mini Microphone' },
    { kind: 'audioinput', deviceId: 'bh', label: 'BlackHole 2ch (Virtual)' },
    { kind: 'audiooutput', deviceId: 'default', label: 'Default - Mac mini Speakers' },
  ];
  assert.equal(pickMicrophone(devices, {}).deviceId, 'bh');
  assert.equal(pickMicrophone(devices, { deviceId: 'default' }).deviceId, 'default');
  assert.equal(pickMicrophone(devices, { deviceId: 'gone' }).deviceId, 'bh');
  assert.equal(pickMicrophone([], {}), null);
  assert.equal(outputIsBlackHole(devices), false);
  assert.equal(outputIsBlackHole([{ kind: 'audiooutput', deviceId: 'default', label: 'Default - BlackHole 2ch (Virtual)' }]), true);
});

test('settings default to the local engine and are clamped', () => {
  const s = normalizeVoiceSettings({ engine: 'cloud-magic', ttsRate: 9, ttsVolume: -1, pushToTalk: 'yes' });
  assert.equal(s.engine, 'local');
  assert.equal(s.ttsRate, 2);
  assert.equal(s.ttsVolume, 0);
  assert.equal(s.pushToTalk, true);
});

test('wake phrase is matched on the transcript and removed', () => {
  assert.equal(stripWakePhrase('Hey God, track Delta 45', 'hey god'), 'track Delta 45');
  assert.equal(stripWakePhrase('track Delta 45', 'hey god'), null);
  assert.equal(stripWakePhrase('track Delta 45', ''), 'track Delta 45');
});
