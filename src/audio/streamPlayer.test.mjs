import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioBus } from './audioBus.js';
import {
  ACTIVITY_WINDOW_MS,
  audioIndicator,
  createStreamPlayer,
  playbackUrl,
  rms,
} from './streamPlayer.js';
import {
  SOURCE_KINDS,
  createAudioSourceStore,
  getAudioSources,
  isLocalStreamUrl,
  liveAtcSearchUrl,
  normalizeUserSource,
} from './sources.js';

test('LIVE only when playing AND activity was heard recently', () => {
  const now = 100_000;
  const base = { analysable: true, now };
  assert.equal(audioIndicator({ ...base, phase: 'idle', lastActivityAt: null }).state, 'NO AUDIO SOURCE');
  assert.equal(audioIndicator({ ...base, phase: 'connecting', lastActivityAt: null }).state, 'CONNECTING');
  assert.equal(audioIndicator({ ...base, phase: 'playing', lastActivityAt: now - 2_000 }).state, 'LIVE AUDIO');
  const quiet = audioIndicator({ ...base, phase: 'playing', lastActivityAt: now - ACTIVITY_WINDOW_MS - 1 });
  assert.equal(quiet.state, 'USER SOURCE');
  assert.equal(quiet.live, false);
  assert.match(quiet.detail, /no transmission heard/);
  const never = audioIndicator({ ...base, phase: 'playing', lastActivityAt: null });
  assert.equal(never.live, false, 'playing silence is not live');
  const opaque = audioIndicator({ phase: 'playing', analysable: false, lastActivityAt: now, now });
  assert.equal(opaque.live, false, 'an unmeasurable stream never claims LIVE');
  assert.equal(audioIndicator({ ...base, phase: 'error', lastActivityAt: null }).state, 'STREAM ERROR');
});

test('rms', () => {
  assert.equal(rms(new Float32Array(4)), 0);
  assert.ok(Math.abs(rms(Float32Array.from([0.5, -0.5, 0.5, -0.5])) - 0.5) < 1e-9);
});

test('local receivers play through the relay; other streams play directly', () => {
  assert.equal(
    playbackUrl({ kind: SOURCE_KINDS.SDR, url: 'http://192.168.1.20:8000/kmyr' }),
    '/api/audio/relay?url=http%3A%2F%2F192.168.1.20%3A8000%2Fkmyr',
  );
  assert.equal(playbackUrl({ kind: SOURCE_KINDS.URL, url: 'https://radio.example/stream' }), 'https://radio.example/stream');
  assert.equal(isLocalStreamUrl('http://airband.local:8000/x'), true);
  assert.equal(isLocalStreamUrl('https://radio.example/x'), false);
});

test('user sources: validation, LiveATC is never embeddable, SDR must be local', () => {
  assert.throws(() => normalizeUserSource({ url: 'not a url' }), /full stream address/);
  assert.throws(() => normalizeUserSource({ url: 'https://s1.liveatc.net/kmyr' }), /LiveATC streams cannot be embedded/);
  assert.throws(() => normalizeUserSource({ url: 'https://radio.example/x', kind: SOURCE_KINDS.SDR }), /your own network/);
  const sdr = normalizeUserSource({ label: 'Garage SDR', url: 'http://192.168.1.20:8000/kmyr', kind: SOURCE_KINDS.SDR, airportIcao: 'kmyr', frequencyMHz: '128.45' });
  assert.equal(sdr.airportIcao, 'KMYR');
  assert.equal(sdr.frequencyMHz, 128.45);
  assert.equal(liveAtcSearchUrl('kmyr'), 'https://www.liveatc.net/search/?icao=KMYR');
});

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) };
}

test('sources are ranked for the airport and frequency, with LiveATC last as a link', () => {
  const store = createAudioSourceStore({ storage: memoryStorage() });
  store.add({ label: 'Any SDR', url: 'http://192.168.1.21:8000/all', kind: SOURCE_KINDS.SDR });
  store.add({ label: 'KMYR GND', url: 'http://192.168.1.20:8000/gnd', kind: SOURCE_KINDS.SDR, airportIcao: 'KMYR', frequencyMHz: 120.3 });
  store.add({ label: 'KMYR TWR', url: 'http://192.168.1.20:8000/twr', kind: SOURCE_KINDS.SDR, airportIcao: 'KMYR', frequencyMHz: 128.45 });
  store.add({ label: 'KCHS', url: 'http://192.168.1.20:8000/chs', kind: SOURCE_KINDS.SDR, airportIcao: 'KCHS' });
  const sources = getAudioSources(store, { airportIcao: 'KMYR', frequencyMHz: 128.45 });
  assert.deepEqual(sources.map((s) => s.label), ['KMYR TWR', 'KMYR GND', 'Any SDR', 'LiveATC · KMYR']);
  const external = sources.at(-1);
  assert.equal(external.kind, 'EXTERNAL LINK');
  assert.equal(external.embeddable, false);
  assert.equal(getAudioSources(store, {}).length, 1, 'no airport: only unassigned sources, no LiveATC link');
});

test('the store survives unusable storage and reloads saved sources', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const store = createAudioSourceStore({ storage: broken });
  store.add({ url: 'https://radio.example/x' });
  assert.equal(store.list().length, 1);
  const storage = memoryStorage();
  createAudioSourceStore({ storage }).add({ url: 'https://radio.example/y', label: 'Y' });
  assert.equal(createAudioSourceStore({ storage }).list()[0].label, 'Y');
});

/** Minimal fakes for HTMLAudioElement and Web Audio. */
function fakes({ level = 0 } = {}) {
  const elements = [];
  class FakeAudio {
    constructor() {
      this.listeners = {};
      this.crossOrigin = null;
      elements.push(this);
    }
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    }
    fire(type) {
      for (const fn of this.listeners[type] || []) fn();
    }
    async play() {}
    pause() {}
    removeAttribute() {}
    load() {}
  }
  class FakeContext {
    createMediaElementSource() {
      return { connect() {} };
    }
    createAnalyser() {
      return {
        fftSize: 8,
        connect() {},
        getFloatTimeDomainData(block) {
          block.fill(level.value ?? level);
        },
      };
    }
    get destination() {
      return {};
    }
    async resume() {}
    async close() {}
  }
  return { elements, createAudio: () => new FakeAudio(), AudioContextImpl: FakeContext };
}

const SDR = { id: 'a', kind: SOURCE_KINDS.SDR, label: 'KMYR TWR', url: 'http://192.168.1.20:8000/twr', embeddable: true };

test('playing a source takes the bus (stopping the radio) and turns LIVE only on heard signal', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
  const bus = createAudioBus();
  let radioStopped = false;
  bus.claim({ id: 'radio', stop: () => (radioStopped = true) });
  const level = { value: 0 };
  const f = fakes({ level });
  const player = createStreamPlayer({ bus, createAudio: f.createAudio, AudioContextImpl: f.AudioContextImpl, now: () => Date.now() });
  const seen = [];
  player.subscribe((s) => seen.push(s.state));
  await player.play(SDR);
  assert.equal(radioStopped, true, 'single-stream enforcement');
  assert.equal(bus.getState().owner.id, 'atc');
  assert.equal(f.elements[0].src, '/api/audio/relay?url=http%3A%2F%2F192.168.1.20%3A8000%2Ftwr');
  assert.equal(player.getState().state, 'CONNECTING');
  f.elements[0].fire('playing');
  t.mock.timers.tick(500);
  assert.equal(player.getState().state, 'USER SOURCE', 'playing but silent is not LIVE');
  level.value = 0.2;
  t.mock.timers.tick(250);
  assert.equal(player.getState().state, 'LIVE AUDIO');
  level.value = 0;
  t.mock.timers.tick(ACTIVITY_WINDOW_MS + 500);
  assert.equal(player.getState().state, 'USER SOURCE');
  player.stop();
  assert.equal(player.getState().state, 'NO AUDIO SOURCE');
  assert.equal(bus.getState().owner, null);
  assert.ok(seen.includes('LIVE AUDIO'));
  player.destroy();
});

test('a stream error shows STREAM ERROR and frees the bus; radio taking the bus stops ATC', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const bus = createAudioBus();
  const f = fakes();
  const player = createStreamPlayer({ bus, createAudio: f.createAudio, AudioContextImpl: f.AudioContextImpl });
  await player.play(SDR);
  f.elements[0].fire('error');
  assert.equal(player.getState().state, 'STREAM ERROR');
  assert.equal(bus.getState().owner, null);
  await player.play(SDR);
  f.elements[1].fire('playing');
  bus.claim({ id: 'radio', stop() {} });
  assert.equal(player.getState().state, 'NO AUDIO SOURCE', 'radio took over, ATC stopped');
  player.destroy();
});

test('a direct stream without CORS is retried plainly and never shows LIVE', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const f = fakes({ level: 0.3 });
  const player = createStreamPlayer({ bus: createAudioBus(), createAudio: f.createAudio, AudioContextImpl: f.AudioContextImpl });
  await player.play({ id: 'u', kind: SOURCE_KINDS.URL, label: 'x', url: 'https://radio.example/s', embeddable: true });
  assert.equal(f.elements[0].crossOrigin, 'anonymous');
  f.elements[0].fire('error');
  assert.equal(f.elements[1].crossOrigin, null);
  f.elements[1].fire('playing');
  t.mock.timers.tick(1000);
  const state = player.getState();
  assert.equal(state.analysable, false);
  assert.equal(state.live, false);
  assert.match(state.detail, /does not allow activity measurement/);
  player.destroy();
});

test('LiveATC (external link) can never be played in the app', async () => {
  const player = createStreamPlayer({ bus: createAudioBus(), createAudio: fakes().createAudio, AudioContextImpl: null });
  await assert.rejects(player.play({ kind: 'EXTERNAL LINK', embeddable: false, url: 'https://www.liveatc.net/search/?icao=KMYR' }));
  player.destroy();
});
