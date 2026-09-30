/**
 * Local speech-to-text through a whisper.cpp server on this Mac
 * (GODS-EYE-VIEW-SPEC v2, "Speech and AI"; decision 6A).
 *
 *   GET  /api/stt/status       — is the speech server configured and answering?
 *   POST /api/stt/transcribe   — body: audio/wav (16 kHz mono); returns { text }
 *
 * whisper.cpp's server takes a multipart `file` at POST /inference and
 * answers { text } with response_format=json (examples/server/README.md).
 * WHISPER_SERVER_URL must point at this Mac (localhost / 127.0.0.1 / ::1), so
 * audio never leaves it. Both routes answer this Mac only, and nothing is
 * written to disk.
 */

import { readRequestBodyCapped } from '../common/request.js';
import { createBudget } from '../gateway/budget.js';
import { PROVIDER_CATALOG } from '../gateway/catalog.js';
import { providerRegistry } from '../gateway/registry.js';

export const STT_MAX_BYTES = 10 * 1024 * 1024; // about 5 minutes of 16 kHz PCM
const TRANSCRIBE_TIMEOUT_MS = 60_000;
const STATUS_TIMEOUT_MS = 2_000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** The configured server, or a reason it can't be used. */
export function resolveWhisperUrl(env = process.env) {
  const raw = String(env.WHISPER_SERVER_URL || '').trim();
  if (!raw) return { url: null, problem: 'WHISPER_SERVER_URL is not set' };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { url: null, problem: 'WHISPER_SERVER_URL is not a valid address' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return { url: null, problem: 'WHISPER_SERVER_URL must start with http://' };
  if (!LOOPBACK_HOSTS.has(url.hostname))
    return {
      url: null,
      problem:
        'WHISPER_SERVER_URL must be on this Mac (http://127.0.0.1:…) so audio stays local',
    };
  return { url, problem: null };
}

/** True for requests from this Mac. */
export function isLocalRequest(req) {
  const addr = String(req?.socket?.remoteAddress || '');
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/** True when the bytes are a RIFF/WAVE file. */
export function looksLikeWav(buf) {
  return (
    buf?.length > 44 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WAVE'
  );
}

/**
 * @param {{ env?: Record<string,string|undefined>, fetchImpl?: typeof fetch, now?: () => number, registry?: typeof providerRegistry }} [options]
 */
export function createWhisperService({
  env = process.env,
  fetchImpl = (input, init) => globalThis.fetch(input, init),
  now = Date.now,
  registry = providerRegistry,
} = {}) {
  const budget = createBudget({ perMinute: 60, now, failureThreshold: 3 });
  const provider = registry.register(PROVIDER_CATALOG['whisper-local'], {
    budget,
    configured: () => Boolean(resolveWhisperUrl(env).url),
  });

  async function status() {
    const { url, problem } = resolveWhisperUrl(env);
    if (!url)
      return {
        status: 200,
        body: { configured: false, online: false, message: problem },
      };
    try {
      const started = now();
      const response = await fetchImpl(new URL('/', url), {
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      });
      response.body?.cancel?.().catch?.(() => {});
      provider.success({ latencyMs: now() - started });
      return {
        status: 200,
        body: { configured: true, online: true, message: null },
      };
    } catch {
      provider.failure(new Error('Speech server not answering'));
      return {
        status: 200,
        body: {
          configured: true,
          online: false,
          message: `Speech server not answering at ${url.host}. Start it (see VOICE-SETUP.md).`,
        },
      };
    }
  }

  /** @param {Buffer} wav */
  async function transcribe(wav) {
    const { url, problem } = resolveWhisperUrl(env);
    if (!url)
      return { status: 503, body: { error: problem, code: 'NOT_CONFIGURED' } };
    if (!looksLikeWav(wav))
      return { status: 400, body: { error: 'Send 16 kHz mono WAV audio' } };
    try {
      const text = await budget.run(`stt:${now()}`, async () => {
        const started = now();
        const form = new FormData();
        form.append(
          'file',
          new Blob([new Uint8Array(wav)], { type: 'audio/wav' }),
          'speech.wav',
        );
        form.append('temperature', '0.0');
        form.append('response_format', 'json');
        const response = await fetchImpl(new URL('/inference', url), {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
        });
        if (!response.ok)
          throw new Error(`Speech server answered ${response.status}`);
        const body = await response.json();
        provider.success({ latencyMs: now() - started });
        return String(body?.text ?? '')
          .replace(/\s+/g, ' ')
          .trim();
      });
      return { status: 200, body: { text, engine: 'whisper.cpp (local)' } };
    } catch (error) {
      provider.failure(error);
      return {
        status: 503,
        body: {
          error: 'SPEECH SERVER UNAVAILABLE',
          detail: error?.message || null,
        },
      };
    }
  }

  return { status, transcribe };
}

/** Vite plugin: mount /api/stt. */
export function whisperProxy(options) {
  let service = null;
  const install = (server) => {
    service ||= createWhisperService(options);
    server.middlewares.use('/api/stt', async (req, res) => {
      const send = (status, body) => {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(body));
      };
      if (!isLocalRequest(req))
        return send(403, { error: 'Speech is available on this Mac only' });
      const path = new URL(req.url || '/', 'http://localhost').pathname;
      try {
        if (req.method === 'GET' && path === '/status') {
          const r = await service.status();
          return send(r.status, r.body);
        }
        if (req.method === 'POST' && path === '/transcribe') {
          const wav = await readRequestBodyCapped(req, STT_MAX_BYTES);
          const r = await service.transcribe(wav);
          return send(r.status, r.body);
        }
        return send(404, { error: 'Not found' });
      } catch (error) {
        if (error?.code === 'BODY_TOO_LARGE')
          return send(413, { error: 'Recording too long' });
        return send(503, { error: 'SPEECH SERVER UNAVAILABLE' });
      }
    });
  };
  return {
    name: 'gev-whisper',
    configureServer: install,
    configurePreviewServer: install,
  };
}
