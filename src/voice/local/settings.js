/**
 * Voice settings (GODS-EYE-VIEW-SPEC v2, 4.20–4.21), kept in this browser
 * only. Pure helpers plus a tiny storage wrapper.
 */

export const VOICE_SETTINGS_KEY = 'godsEyeView.v2.voice';

/** Engine ids. */
export const ENGINE_LOCAL = 'local';
export const ENGINE_WEB_SPEECH = 'webspeech';
export const ENGINE_OPENAI = 'openai';

/** Speech-to-text engines. `local` (whisper.cpp) is the default (decision 6A). */
export const VOICE_ENGINES = Object.freeze({
  local: 'Local speech server (whisper.cpp) — audio stays on this Mac',
  webspeech: 'Browser speech recognition (Web Speech) — see the notice',
  openai: 'OpenAI Realtime (your OpenAI key; audio goes to OpenAI)',
});

export const VOICE_DEFAULTS = Object.freeze({
  engine: 'local',
  deviceId: '',
  deviceLabel: '',
  noiseSuppression: true,
  voiceActivation: false,
  pushToTalk: true,
  wakeEnabled: false,
  wakePhrase: 'hey god',
  ttsEnabled: true,
  ttsVolume: 1,
  ttsVoice: '',
  ttsRate: 1,
  flightLevels: false,
});

/** Settings merged over defaults, with every value type-checked. */
export function normalizeVoiceSettings(raw) {
  /** @type {Record<string, any>} */
  const out = { ...VOICE_DEFAULTS };
  const src = raw && typeof raw === 'object' ? raw : {};
  for (const [key, def] of Object.entries(VOICE_DEFAULTS)) {
    const v = src[key];
    if (typeof def === 'boolean' && typeof v === 'boolean') out[key] = v;
    else if (typeof def === 'string' && typeof v === 'string')
      out[key] = v.slice(0, 200);
    else if (typeof def === 'number' && Number.isFinite(v)) out[key] = v;
  }
  if (!VOICE_ENGINES[out.engine]) out.engine = VOICE_DEFAULTS.engine;
  out.ttsVolume = Math.min(1, Math.max(0, out.ttsVolume));
  out.ttsRate = Math.min(2, Math.max(0.5, out.ttsRate));
  return out;
}

export function readVoiceSettings(storage = globalThis.localStorage) {
  try {
    return normalizeVoiceSettings(
      JSON.parse(storage?.getItem(VOICE_SETTINGS_KEY) || '{}'),
    );
  } catch {
    return normalizeVoiceSettings({});
  }
}

export function writeVoiceSettings(
  settings,
  storage = globalThis.localStorage,
) {
  const clean = normalizeVoiceSettings(settings);
  try {
    storage?.setItem(VOICE_SETTINGS_KEY, JSON.stringify(clean));
  } catch {
    // Kept for this page only.
  }
  return clean;
}

export const BLACKHOLE_PATTERN = /blackhole\s*2ch/i;

/**
 * Microphone to use: the saved one if still present, else BlackHole 2ch
 * (Rod's S23 Ultra via AudioRelay), else the system default.
 * @param {Array<{ deviceId: string, kind: string, label: string }>} devices
 * @param {{ deviceId?: string, deviceLabel?: string }} saved
 */
export function pickMicrophone(devices, saved = {}) {
  const inputs = (devices || []).filter((d) => d.kind === 'audioinput');
  if (!inputs.length) return null;
  return (
    (saved.deviceId && inputs.find((d) => d.deviceId === saved.deviceId)) ||
    (saved.deviceLabel && inputs.find((d) => d.label === saved.deviceLabel)) ||
    inputs.find((d) => BLACKHOLE_PATTERN.test(d.label)) ||
    inputs.find((d) => d.deviceId === 'default') ||
    inputs[0]
  );
}

/**
 * True when the system output looks like BlackHole, so spoken replies would
 * be captured again as input (spec 4.20 feedback-loop guard).
 */
export function outputIsBlackHole(devices) {
  const outputs = (devices || []).filter((d) => d.kind === 'audiooutput');
  const current = outputs.find((d) => d.deviceId === 'default') || outputs[0];
  return Boolean(current && BLACKHOLE_PATTERN.test(current.label));
}

/**
 * Wake-phrase check on the transcript only (detected locally). Returns the
 * command with the phrase removed, or null when it didn't start with it.
 */
export function stripWakePhrase(text, phrase) {
  const t = String(text || '').trim();
  const want = String(phrase || '')
    .toLowerCase()
    .match(/[a-z0-9]+/g);
  if (!want) return t;
  const words = t.split(/\s+/);
  const heard = words
    .slice(0, want.length)
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''));
  if (heard.join(' ') !== want.join(' ')) return null;
  return words
    .slice(want.length)
    .join(' ')
    .replace(/^[\s,.!?]+/, '');
}
