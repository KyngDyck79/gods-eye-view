/**
 * Browser microphone capture for local voice (GODS-EYE-VIEW-SPEC v2, 4.20).
 * Opens the chosen input (BlackHole 2ch for Rod's phone mic), measures level
 * with an AnalyserNode, and hands raw frames to listeners. Nothing is stored
 * or uploaded here.
 */

import { peakLevel, rmsLevel } from './wav.js';

export const MICROPHONE_UNAVAILABLE = 'MICROPHONE UNAVAILABLE';

/** A plain reason for a getUserMedia failure. */
export function microphoneErrorMessage(error) {
  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return `${MICROPHONE_UNAVAILABLE} — permission denied. Allow the microphone for this site (and for the browser in System Settings → Privacy & Security → Microphone).`;
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return `${MICROPHONE_UNAVAILABLE} — the selected microphone is not connected. Check AudioRelay and BlackHole 2ch.`;
  if (name === 'NotReadableError')
    return `${MICROPHONE_UNAVAILABLE} — another app is using the microphone.`;
  return `${MICROPHONE_UNAVAILABLE}${error?.message ? ` — ${error.message}` : ''}`;
}

/** Input and output devices; labels appear once permission is granted. */
export async function listAudioDevices(
  mediaDevices = globalThis.navigator?.mediaDevices,
) {
  if (!mediaDevices?.enumerateDevices) return [];
  const all = await mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === 'audioinput' || d.kind === 'audiooutput')
    .map((d) => ({ deviceId: d.deviceId, kind: d.kind, label: d.label || '' }));
}

/**
 * @param {{ deviceId?: string, noiseSuppression?: boolean, mediaDevices?: MediaDevices, AudioContextImpl?: typeof AudioContext }} [options]
 */
export async function openMicrophone({
  deviceId = '',
  noiseSuppression = true,
  mediaDevices = globalThis.navigator?.mediaDevices,
  AudioContextImpl = globalThis.AudioContext ||
    /** @type {any} */ (globalThis).webkitAudioContext,
} = {}) {
  if (!mediaDevices?.getUserMedia || !AudioContextImpl)
    throw new Error(
      `${MICROPHONE_UNAVAILABLE} — this browser cannot capture audio`,
    );
  let stream;
  try {
    stream = await mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        noiseSuppression,
        echoCancellation: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
  } catch (error) {
    throw new Error(microphoneErrorMessage(error));
  }
  const track = stream.getAudioTracks()[0];
  const context = new AudioContextImpl();
  if (context.state === 'suspended') await context.resume().catch(() => {});
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  // ScriptProcessor is deprecated but works in Chrome and Safari without a
  // separate worklet file; frames are small and processing is trivial.
  const processor = context.createScriptProcessor(2048, 1, 1);
  const sink = context.createGain();
  sink.gain.value = 0;
  source.connect(processor);
  processor.connect(sink);
  sink.connect(context.destination);
  const listeners = new Set();
  const frameMs = (2048 / context.sampleRate) * 1000;
  processor.onaudioprocess = (event) => {
    if (!track.enabled) return;
    const data = new Float32Array(event.inputBuffer.getChannelData(0));
    for (const fn of listeners) fn(data, frameMs);
  };
  const scratch = new Float32Array(analyser.fftSize);
  let ended = false;
  track.addEventListener?.('ended', () => {
    ended = true;
  });
  return {
    label: track.label || 'Microphone',
    deviceId: track.getSettings?.().deviceId || deviceId,
    sampleRate: context.sampleRate,
    get ended() {
      return ended;
    },
    /** Current level, 0–1. */
    level() {
      analyser.getFloatTimeDomainData(scratch);
      return { rms: rmsLevel(scratch), peak: peakLevel(scratch) };
    },
    /** Capture on/off without closing the device (push to talk, speaking guard). */
    setCapturing(on) {
      track.enabled = Boolean(on);
    },
    get capturing() {
      return track.enabled && !ended;
    },
    onFrame(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async close() {
      listeners.clear();
      processor.onaudioprocess = null;
      for (const t of stream.getTracks()) t.stop();
      await context.close().catch(() => {});
    },
  };
}
