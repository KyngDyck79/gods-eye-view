/**
 * ATC stream player on the AudioBus.
 *
 * LIVE is shown only when the audio element is actually playing AND a Web
 * Audio AnalyserNode has heard signal recently (GODS-EYE-VIEW-SPEC v2, 3
 * Audio). Squelched airband is silent between transmissions, so "recently"
 * is a window, and a playing stream with no activity says so instead of
 * claiming LIVE. A stream whose server does not allow measurement (no CORS)
 * can still play, but never shows LIVE.
 */

import { AUDIO_STATES, audioBus as defaultBus } from './audioBus.js';
import { SOURCE_KINDS, isLocalStreamUrl } from './sources.js';

/** Signal heard within this window keeps the indicator LIVE. */
export const ACTIVITY_WINDOW_MS = 15_000;
/** RMS level (full scale = 1) that counts as signal, about −46 dBFS. */
export const ACTIVITY_RMS = 0.005;
const SAMPLE_MS = 250;
const CONNECT_TIMEOUT_MS = 15_000;

/**
 * The indicator for a player state. Pure; the only place LIVE is decided.
 * @param {{ phase: string, analysable: boolean, lastActivityAt: number|null, now: number, error?: string|null }} s
 * @returns {{ state: string, live: boolean, detail: string|null }}
 */
export function audioIndicator({
  phase,
  analysable,
  lastActivityAt,
  now,
  error = null,
}) {
  if (phase === 'connecting')
    return { state: AUDIO_STATES.CONNECTING, live: false, detail: null };
  if (phase === 'error')
    return {
      state: AUDIO_STATES.ERROR,
      live: false,
      detail: error || 'AUDIO SOURCE UNAVAILABLE',
    };
  if (phase !== 'playing')
    return { state: AUDIO_STATES.NONE, live: false, detail: null };
  if (!analysable) {
    return {
      state: AUDIO_STATES.USER,
      live: false,
      detail: 'Playing; this stream does not allow activity measurement',
    };
  }
  const recent =
    Number.isFinite(lastActivityAt) &&
    now - lastActivityAt <= ACTIVITY_WINDOW_MS;
  return recent
    ? { state: AUDIO_STATES.LIVE, live: true, detail: null }
    : {
        state: AUDIO_STATES.USER,
        live: false,
        detail: 'Playing; no transmission heard in the last 15 s',
      };
}

/** Root-mean-square of a block of samples. */
export function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

/** Where the element should load a source from. Local receivers go through the relay. */
export function playbackUrl(source) {
  return source.kind === SOURCE_KINDS.SDR || isLocalStreamUrl(source.url)
    ? `/api/audio/relay?url=${encodeURIComponent(source.url)}`
    : source.url;
}

/**
 * @param {{ bus?: typeof defaultBus, createAudio?: () => HTMLAudioElement, AudioContextImpl?: typeof AudioContext, now?: () => number }} [options]
 */
export function createStreamPlayer({
  bus = defaultBus,
  createAudio = () => new Audio(),
  AudioContextImpl = globalThis.AudioContext || globalThis.webkitAudioContext,
  now = Date.now,
} = {}) {
  let audio = null;
  let context = null;
  let analyser = null;
  let sampler = null;
  let connectTimer = null;
  let generation = 0;
  const listeners = new Set();
  const state = {
    phase: 'idle',
    source: null,
    analysable: false,
    lastActivityAt: null,
    error: null,
  };

  function snapshot() {
    return { ...state, ...audioIndicator({ ...state, now: now() }) };
  }
  function emit() {
    const s = snapshot();
    for (const listener of listeners) listener(s);
  }

  function teardown() {
    clearInterval(sampler);
    clearTimeout(connectTimer);
    sampler = null;
    connectTimer = null;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    audio = null;
    analyser = null;
    context?.close?.().catch?.(() => {});
    context = null;
  }

  function applyBusLevels() {
    if (!audio) return;
    const { volume, muted } = bus.getState();
    audio.volume = volume;
    audio.muted = muted;
  }
  const unsubscribeBus = bus.subscribe(applyBusLevels);

  function attachAnalyser(element) {
    if (!AudioContextImpl) return false;
    try {
      context = new AudioContextImpl();
      const node = context.createMediaElementSource(element);
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      node.connect(analyser);
      analyser.connect(context.destination);
      const block = new Float32Array(analyser.fftSize);
      sampler = setInterval(() => {
        if (!analyser) return;
        analyser.getFloatTimeDomainData(block);
        if (rms(block) >= ACTIVITY_RMS) state.lastActivityAt = now();
        emit();
      }, SAMPLE_MS);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Play a source. Claims the bus, which stops the radio or any other stream.
   * @param {{ id: string, kind: string, label: string, url: string, embeddable: boolean }} source
   */
  async function play(source, { crossOrigin = true } = {}) {
    if (!source?.embeddable)
      throw new Error('This source cannot be played here');
    const mine = ++generation;
    teardown();
    Object.assign(state, {
      phase: 'connecting',
      source,
      analysable: false,
      lastActivityAt: null,
      error: null,
    });
    bus.claim({
      id: 'atc',
      kind: source.kind,
      label: source.label,
      stop: () => stop({ fromBus: true }),
    });
    emit();
    const relayed = playbackUrl(source) !== source.url;
    audio = createAudio();
    // Same-origin (relayed) streams are always measurable; others only if the
    // server sends CORS headers.
    if (!relayed && crossOrigin) audio.crossOrigin = 'anonymous';
    applyBusLevels();
    const element = audio;
    element.addEventListener('playing', () => {
      if (mine !== generation) return;
      clearTimeout(connectTimer);
      state.phase = 'playing';
      emit();
    });
    element.addEventListener('error', () => {
      if (mine !== generation) return;
      // A cross-origin stream without CORS fails with crossOrigin set: retry
      // it plainly — it can play, but activity cannot be measured.
      if (!relayed && crossOrigin && state.phase === 'connecting') {
        void play(source, { crossOrigin: false });
        return;
      }
      fail('AUDIO SOURCE UNAVAILABLE');
    });
    element.addEventListener(
      'ended',
      () => mine === generation && fail('Stream ended'),
    );
    state.analysable = (relayed || crossOrigin) && attachAnalyser(element);
    element.src = playbackUrl(source);
    connectTimer = setTimeout(
      () =>
        mine === generation &&
        state.phase === 'connecting' &&
        fail('AUDIO SOURCE UNAVAILABLE'),
      CONNECT_TIMEOUT_MS,
    );
    try {
      await context?.resume?.();
      await element.play();
    } catch (error) {
      if (mine !== generation) return;
      if (error?.name === 'NotAllowedError')
        fail('Press LISTEN again to allow audio');
      // Other failures arrive through the element's error event.
    }
  }

  function fail(message) {
    teardown();
    state.phase = 'error';
    state.error = message;
    bus.release('atc');
    emit();
  }

  /** Stop playback. `fromBus` means another producer took the bus. */
  function stop({ fromBus = false } = {}) {
    generation += 1;
    teardown();
    Object.assign(state, {
      phase: 'idle',
      analysable: false,
      lastActivityAt: null,
      error: null,
    });
    if (!fromBus) bus.release('atc');
    emit();
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  }

  function destroy() {
    stop();
    unsubscribeBus();
    listeners.clear();
  }

  return { play, stop, subscribe, getState: snapshot, destroy };
}
