/**
 * Microphone samples → 16 kHz mono 16-bit WAV, the format the whisper.cpp
 * server accepts without ffmpeg. Pure: runs in the browser and in node:test.
 */

export const WHISPER_SAMPLE_RATE = 16_000;

/**
 * Linear-interpolation resample of mono float samples.
 * @param {Float32Array} input
 * @param {number} fromRate
 * @param {number} [toRate]
 * @returns {Float32Array}
 */
export function resample(input, fromRate, toRate = WHISPER_SAMPLE_RATE) {
  if (!(fromRate > 0) || fromRate === toRate) return Float32Array.from(input);
  const ratio = fromRate / toRate;
  const length = Math.max(0, Math.floor(input.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const t = pos - i0;
    out[i] = input[i0] * (1 - t) + input[i1] * t;
  }
  return out;
}

/** Join captured chunks into one buffer. */
export function concatChunks(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * @param {Float32Array} samples Mono samples in [-1, 1] at `sampleRate`.
 * @param {number} sampleRate
 * @returns {Uint8Array} A complete RIFF/WAVE file, PCM 16-bit, 16 kHz, mono.
 */
export function encodeWav(samples, sampleRate) {
  const pcm = resample(samples, sampleRate, WHISPER_SAMPLE_RATE);
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1)
      view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, WHISPER_SAMPLE_RATE, true);
  view.setUint32(28, WHISPER_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i += 1) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/** Peak absolute level of a buffer, 0–1. */
export function peakLevel(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  return peak;
}

/** Root-mean-square level of a buffer, 0–1. */
export function rmsLevel(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}
