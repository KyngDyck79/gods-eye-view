/**
 * Speech-to-text engines for local voice.
 *  - whisper: POST 16 kHz WAV to the gateway, which forwards to whisper.cpp
 *    on this Mac.
 *  - Web Speech: the browser's recognizer. The browser may send audio to its
 *    vendor, and it listens to the system default input, not the picker.
 */

export async function getSpeechServerStatus(
  fetchImpl = (i, n) => globalThis.fetch(i, n),
) {
  try {
    const response = await fetchImpl('/api/stt/status', { cache: 'no-store' });
    return await response.json();
  } catch {
    return {
      configured: false,
      online: false,
      message: 'The app server is not answering',
    };
  }
}

/**
 * @param {Uint8Array} wav
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal }} [options]
 * @returns {Promise<string>}
 */
export async function transcribeLocally(
  wav,
  { fetchImpl = (i, n) => globalThis.fetch(i, n), signal } = {},
) {
  const response = await fetchImpl('/api/stt/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: /** @type {any} */ (wav),
    signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || 'SPEECH SERVER UNAVAILABLE');
  return String(body.text || '');
}

export const WEB_SPEECH_NOTICE =
  'Browser speech recognition may send your audio to the browser maker’s servers, and it listens to the macOS default input — set System Settings → Sound → Input to BlackHole 2ch.';

/** Web Speech recognizer, or null when the browser has none. */
export function createWebSpeechRecognizer(win = globalThis) {
  const Impl =
    /** @type {any} */ (win).SpeechRecognition ||
    /** @type {any} */ (win).webkitSpeechRecognition;
  if (!Impl) return null;
  let recognition = null;
  let stopped = true;
  return {
    /** Continuous recognition; calls onText for each final phrase. */
    start({ onText, onError, onActive }) {
      stopped = false;
      recognition = new Impl();
      recognition.lang = 'en-US';
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const r = event.results[i];
          if (r.isFinal) onText(String(r[0]?.transcript || '').trim());
        }
      };
      recognition.onerror = (event) =>
        onError?.(event?.error || 'speech error');
      recognition.onstart = () => onActive?.(true);
      recognition.onend = () => {
        onActive?.(false);
        if (!stopped) {
          try {
            recognition.start();
          } catch {
            /* already restarting */
          }
        }
      };
      recognition.start();
    },
    stop() {
      stopped = true;
      try {
        recognition?.stop();
      } catch {
        /* not running */
      }
      recognition = null;
    },
  };
}
