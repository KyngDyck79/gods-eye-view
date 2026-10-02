/**
 * AudioBus — one audible stream at a time (GODS-EYE-VIEW-SPEC v2, 4.7/4.8).
 *
 * Every audio producer (RADIO, ATC audio, user streams) claims the bus before
 * it starts playing and releases it when it stops. A claim stops whoever held
 * the bus before, so starting any stream stops the previous one. The bus also
 * owns the shared ATC volume and mute preference.
 *
 * The bus never claims that audio is live: producers report their own state,
 * and the LIVE indicator is decided by the producer from real playback.
 */

/** Audio states shown to the user (spec 3, Audio). */
export const AUDIO_STATES = Object.freeze({
  LIVE: 'LIVE AUDIO',
  NONE: 'NO AUDIO SOURCE',
  EXTERNAL: 'EXTERNAL SOURCE',
  USER: 'USER SOURCE',
  CONNECTING: 'CONNECTING',
  ERROR: 'STREAM ERROR',
});

/**
 * @typedef {object} AudioClaim
 * @property {string} id Stable producer id, e.g. "radio" or "atc".
 * @property {string} [label] What is playing, e.g. a station name.
 * @property {string} [kind] "PUBLIC RADIO", "USER SDR", …
 * @property {() => void} stop Stop this producer's playback.
 */

export function createAudioBus() {
  /** @type {AudioClaim|null} */
  let owner = null;
  let volume = 0.8;
  let muted = false;
  const listeners = new Set();

  function snapshot() {
    return {
      owner: owner
        ? { id: owner.id, label: owner.label || null, kind: owner.kind || null }
        : null,
      volume,
      muted,
    };
  }

  function emit() {
    const state = snapshot();
    for (const listener of listeners) {
      try {
        listener(state);
      } catch (error) {
        console.error('[AudioBus] listener failed', error);
      }
    }
  }

  /**
   * Take the bus. The previous owner (if another producer) is stopped first.
   * @param {AudioClaim} claim
   */
  function claim(claim) {
    if (!claim?.id || typeof claim.stop !== 'function') {
      throw new TypeError('An audio claim needs an id and a stop function');
    }
    const previous = owner;
    owner = { ...claim };
    if (previous && previous.id !== claim.id) {
      try {
        previous.stop();
      } catch (error) {
        console.error(`[AudioBus] stopping ${previous.id} failed`, error);
      }
    }
    emit();
  }

  /** Give the bus up; ignored unless `id` holds it. */
  function release(id) {
    if (owner?.id !== id) return false;
    owner = null;
    emit();
    return true;
  }

  /** Stop whatever is playing. */
  function stopAll() {
    const previous = owner;
    owner = null;
    if (previous) {
      try {
        previous.stop();
      } catch (error) {
        console.error(`[AudioBus] stopping ${previous.id} failed`, error);
      }
    }
    emit();
  }

  function setVolume(next) {
    const value = Number(next);
    if (!Number.isFinite(value)) return volume;
    volume = Math.min(1, Math.max(0, value));
    emit();
    return volume;
  }

  function setMuted(next) {
    muted = Boolean(next);
    emit();
    return muted;
  }

  /** @param {(state: ReturnType<typeof snapshot>) => void} listener */
  function subscribe(listener) {
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  }

  return {
    claim,
    release,
    stopAll,
    setVolume,
    setMuted,
    subscribe,
    getState: snapshot,
  };
}

/** The page's shared bus. */
export const audioBus = createAudioBus();
