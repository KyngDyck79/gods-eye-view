/**
 * Local voice-activity detection by energy with hysteresis. Nothing leaves
 * the browser: this only decides when an utterance starts and ends so the
 * captured audio can be sent to the local speech server.
 */

/**
 * @param {{ threshold?: number, startMs?: number, endSilenceMs?: number, maxMs?: number }} [options]
 */
export function createVad({
  threshold = 0.02,
  startMs = 200,
  endSilenceMs = 800,
  maxMs = 15_000,
} = {}) {
  let speaking = false;
  let aboveMs = 0;
  let silentMs = 0;
  let utteranceMs = 0;
  return {
    /**
     * Feed one frame's RMS level.
     * @param {number} rms
     * @param {number} frameMs
     * @returns {'start'|'end'|null}
     */
    push(rms, frameMs) {
      const loud = rms >= threshold;
      if (!speaking) {
        aboveMs = loud ? aboveMs + frameMs : 0;
        if (aboveMs >= startMs) {
          speaking = true;
          silentMs = 0;
          utteranceMs = aboveMs;
          return 'start';
        }
        return null;
      }
      utteranceMs += frameMs;
      silentMs = loud ? 0 : silentMs + frameMs;
      if (silentMs >= endSilenceMs || utteranceMs >= maxMs) {
        speaking = false;
        aboveMs = 0;
        return 'end';
      }
      return null;
    },
    get speaking() {
      return speaking;
    },
    reset() {
      speaking = false;
      aboveMs = 0;
      silentMs = 0;
      utteranceMs = 0;
    },
  };
}
