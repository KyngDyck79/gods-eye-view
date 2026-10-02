import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWhisperService,
  isLocalRequest,
  looksLikeWav,
  resolveWhisperUrl,
} from '../../server/providers/whisper/index.js';
import { createProviderRegistry } from '../../server/providers/gateway/registry.js';
import { encodeWav } from '../voice/local/wav.js';

const wav = Buffer.from(encodeWav(new Float32Array(1600).fill(0.1), 16000));

test('the speech server must be on this Mac', () => {
  assert.match(resolveWhisperUrl({}).problem, /not set/);
  assert.match(resolveWhisperUrl({ WHISPER_SERVER_URL: 'http://192.168.1.20:8080' }).problem, /on this Mac/);
  assert.match(resolveWhisperUrl({ WHISPER_SERVER_URL: 'https://api.example.com' }).problem, /on this Mac/);
  assert.equal(resolveWhisperUrl({ WHISPER_SERVER_URL: 'http://127.0.0.1:8178' }).url.port, '8178');
  assert.ok(resolveWhisperUrl({ WHISPER_SERVER_URL: 'http://localhost:8178' }).url);
  assert.equal(isLocalRequest({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { host: 'localhost:4173' } }), true);
  assert.equal(isLocalRequest({ socket: { remoteAddress: '192.168.1.9' } }), false);
  assert.equal(looksLikeWav(wav), true);
  assert.equal(looksLikeWav(Buffer.from('not audio at all, clearly not a wav file.......')), false);
});

test('audio is sent to /inference as multipart and the text comes back', async () => {
  let seen;
  const svc = createWhisperService({
    env: { WHISPER_SERVER_URL: 'http://127.0.0.1:8178' },
    registry: createProviderRegistry(),
    fetchImpl: async (url, init) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ text: ' track Delta four five \n' }), { status: 200 });
    },
  });
  const r = await svc.transcribe(wav);
  assert.equal(r.status, 200);
  assert.equal(r.body.text, 'track Delta four five');
  assert.equal(seen.url, 'http://127.0.0.1:8178/inference');
  assert.equal(seen.init.method, 'POST');
  const form = seen.init.body;
  assert.equal(form.get('response_format'), 'json');
  assert.equal(form.get('file').type, 'audio/wav');
});

test('not configured, not WAV, or server down are reported plainly', async () => {
  const reg = createProviderRegistry();
  const none = createWhisperService({ env: {}, registry: reg });
  assert.equal((await none.transcribe(wav)).body.code, 'NOT_CONFIGURED');
  assert.equal((await none.status()).body.configured, false);
  const down = createWhisperService({
    env: { WHISPER_SERVER_URL: 'http://127.0.0.1:8178' },
    registry: createProviderRegistry(),
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  assert.equal((await down.transcribe(Buffer.from('x'.repeat(60)))).status, 400);
  const r = await down.transcribe(wav);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'SPEECH SERVER UNAVAILABLE');
  const s = await down.status();
  assert.equal(s.body.online, false);
  assert.match(s.body.message, /VOICE-SETUP/);
});
