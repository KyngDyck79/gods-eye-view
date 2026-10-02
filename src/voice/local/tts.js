/**
 * Spoken replies with the browser's speechSynthesis, using macOS local
 * voices (GODS-EYE-VIEW-SPEC v2, 4.21). No paid service.
 */

export function listVoices(win = globalThis) {
  const synth = win.speechSynthesis;
  if (!synth) return [];
  return synth
    .getVoices()
    .filter((v) => /^en/i.test(v.lang))
    .map((v) => ({ name: v.name, lang: v.lang, local: v.localService }));
}

/**
 * Speak text; resolves when finished (or immediately when unavailable).
 * @param {string} text
 * @param {{ ttsEnabled?: boolean, ttsVolume?: number, ttsRate?: number, ttsVoice?: string }} settings
 * @param {{ onStart?: () => void, onEnd?: () => void, win?: any }} [hooks]
 */
export function speak(
  text,
  settings,
  { onStart, onEnd, win = globalThis } = {},
) {
  const synth = win.speechSynthesis;
  if (
    !text ||
    !settings?.ttsEnabled ||
    !synth ||
    typeof win.SpeechSynthesisUtterance !== 'function'
  )
    return Promise.resolve(false);
  return new Promise((resolve) => {
    const u = new win.SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.volume = settings.ttsVolume ?? 1;
    u.rate = settings.ttsRate ?? 1;
    const voice = synth.getVoices().find((v) => v.name === settings.ttsVoice);
    if (voice) u.voice = voice;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onEnd?.();
      resolve(true);
    };
    u.onstart = () => onStart?.();
    u.onend = finish;
    u.onerror = finish;
    onStart?.();
    synth.speak(u);
    // Some voices never fire onend; don't leave capture muted forever.
    setTimeout(finish, Math.min(30_000, 1500 + text.length * 90));
  });
}

export function cancelSpeech(win = globalThis) {
  win.speechSynthesis?.cancel?.();
}
