/**
 * Local voice session adapter (decision 6A): microphone on this Mac →
 * whisper.cpp (or Web Speech, if chosen) → transcript → GOD commands →
 * spoken reply. Plugs into the same voice button as OpenAI Realtime via the
 * common session contract in ../session.js.
 *
 * Privacy (spec 4.28): audio is only captured while LISTENING is shown,
 * sent only to the local speech server, and never stored.
 */

import { openMicrophone } from './mic.js';
import { readVoiceSettings, stripWakePhrase } from './settings.js';
import {
  WEB_SPEECH_NOTICE,
  createWebSpeechRecognizer,
  getSpeechServerStatus,
  transcribeLocally,
} from './stt.js';
import { speak } from './tts.js';
import { createVad } from './vad.js';
import { concatChunks, encodeWav } from './wav.js';

/** The always-visible capture indicator. */
export function listeningIndicator(doc = globalThis.document) {
  let el = doc?.getElementById?.('gev-listening');
  if (!el && doc?.body) {
    el = doc.createElement('div');
    el.id = 'gev-listening';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.textContent = '● LISTENING';
    el.hidden = true;
    doc.body.appendChild(el);
  }
  return {
    set(on) {
      if (el) el.hidden = !on;
    },
    remove() {
      el?.remove();
    },
  };
}

const MAX_UTTERANCE_MS = 15_000;

/**
 * @param {{ emit: (e: any) => void, ui?: any, handleCommand?: (text: string) => Promise<{ reply?: string|null }|null>, settingsReader?: () => any, fetchImpl?: typeof fetch, doc?: Document, win?: any }} options
 */
export function createLocalVoiceSession({
  emit,
  ui,
  handleCommand = async () => null,
  settingsReader = readVoiceSettings,
  fetchImpl = (i, n) => globalThis.fetch(i, n),
  doc = globalThis.document,
  win = globalThis,
}) {
  let settings = settingsReader();
  let mic = null;
  let recognizer = null;
  let active = false;
  let speaking = false;
  let spaceHeld = false;
  let chunks = [];
  let chunkMs = 0;
  let recording = false;
  let busy = false;
  let removeFrame = null;
  let vad = null;
  const indicator = listeningIndicator(doc);
  /** On-screen push-to-talk (spec 4.20), separate from the on/off button. */
  let pttButton = null;
  function ensurePttButton() {
    if (pttButton || !ui?.root || !doc?.createElement) return;
    pttButton = doc.createElement('button');
    pttButton.type = 'button';
    pttButton.id = 'gev-ptt-button';
    pttButton.textContent = 'HOLD TO TALK';
    pttButton.hidden = true;
    ui.root.appendChild(pttButton);
  }

  const setState = (state, detail) => emit({ type: 'state', state, detail });
  const setSpeaker = (who) => {
    if (ui?.root) ui.root.dataset.speaker = who;
  };
  const armedDetail = () =>
    settings.voiceActivation
      ? 'Listening for speech'
      : 'Hold Space or hold the mic button to talk';

  function refreshIndicator() {
    const capturing =
      active && !speaking && (recognizer ? true : Boolean(mic?.capturing));
    indicator.set(capturing);
  }

  async function reply(text) {
    if (!text) return;
    emit({ type: 'transcript', role: 'assistant', text, final: true });
    speaking = true;
    const wasCapturing = mic?.capturing;
    mic?.setCapturing(false); // feedback-loop guard
    recognizer?.stop();
    refreshIndicator();
    setSpeaker('ai');
    await speak(text, settings, { win });
    speaking = false;
    setSpeaker('idle');
    if (!active) return;
    if (mic && (settings.voiceActivation || wasCapturing))
      mic.setCapturing(settings.voiceActivation);
    if (settings.engine === 'webspeech') startWebSpeech();
    refreshIndicator();
  }

  async function handleTranscript(raw) {
    let text = String(raw || '').trim();
    if (!text || /^\[.*\]$/.test(text) || /^\(.*\)$/.test(text)) {
      setState('listening', 'Nothing understood — try again');
      return;
    }
    if (settings.wakeEnabled) {
      const stripped = stripWakePhrase(text, settings.wakePhrase);
      if (stripped === null) {
        setState('listening', armedDetail());
        return;
      }
      text = stripped;
      if (!text) return;
    }
    emit({ type: 'transcript', role: 'user', text, final: true });
    setState('executing', `HEARD: “${text}”`);
    let result = null;
    try {
      result = await handleCommand(text);
    } catch (error) {
      result = { reply: error?.message || 'That command failed.' };
    }
    if (!active) return;
    setState('listening', result?.reply ? result.reply : `HEARD: “${text}”`);
    await reply(result?.speech || result?.reply || '');
  }

  async function finishUtterance() {
    if (!recording) return;
    recording = false;
    const samples = concatChunks(chunks);
    const ms = chunkMs;
    chunks = [];
    chunkMs = 0;
    if (!settings.voiceActivation) mic?.setCapturing(false);
    refreshIndicator();
    setSpeaker('idle');
    if (ms < 300 || !mic) {
      setState('listening', armedDetail());
      return;
    }
    busy = true;
    setState('executing', 'Transcribing on this Mac…');
    try {
      const text = await transcribeLocally(encodeWav(samples, mic.sampleRate), {
        fetchImpl,
      });
      if (active) await handleTranscript(text);
    } catch (error) {
      if (active)
        setState('listening', `${error.message} — see VOICE-SETUP.md`);
    } finally {
      busy = false;
    }
  }

  function onFrame(frame, frameMs) {
    if (speaking) return;
    if (settings.voiceActivation && vad && !busy) {
      let sum = 0;
      for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
      const event = vad.push(Math.sqrt(sum / frame.length), frameMs);
      if (event === 'start') {
        recording = true;
        chunks = [];
        chunkMs = 0;
        setSpeaker('user');
      }
      if (recording) {
        chunks.push(frame);
        chunkMs += frameMs;
      }
      if (event === 'end') void finishUtterance();
      return;
    }
    if (recording) {
      chunks.push(frame);
      chunkMs += frameMs;
      if (chunkMs >= MAX_UTTERANCE_MS) void finishUtterance();
    }
  }

  function beginTalk() {
    if (!active || !mic || busy || speaking || settings.voiceActivation) return;
    recording = true;
    chunks = [];
    chunkMs = 0;
    mic.setCapturing(true);
    setSpeaker('user');
    setState('listening', 'Listening… release to send');
    refreshIndicator();
  }

  const isTyping = (target) =>
    target &&
    (target.isContentEditable ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  const onKeyDown = (event) => {
    if (event.code !== 'Space' || event.repeat || isTyping(event.target))
      return;
    if (!active || settings.voiceActivation || settings.engine === 'webspeech')
      return;
    event.preventDefault();
    spaceHeld = true;
    beginTalk();
  };
  const onKeyUp = (event) => {
    if (event.code !== 'Space' || !spaceHeld) return;
    event.preventDefault();
    spaceHeld = false;
    void finishUtterance();
  };
  const onPointerDown = () => {
    if (
      active &&
      settings.pushToTalk &&
      !settings.voiceActivation &&
      settings.engine === 'local'
    )
      beginTalk();
  };
  const onPointerUp = () => {
    if (recording && !settings.voiceActivation) void finishUtterance();
  };

  function startWebSpeech() {
    recognizer ||= createWebSpeechRecognizer(win);
    recognizer?.start({
      onText: (text) => void handleTranscript(text),
      onError: (error) =>
        setState('listening', `Browser speech: ${error}. ${WEB_SPEECH_NOTICE}`),
      onActive: () => refreshIndicator(),
    });
  }

  return {
    capabilities: { costControls: false, pushToTalk: true },
    ignoreButtonClick: () => spaceHeld,
    async start() {
      settings = settingsReader();
      if (settings.engine === 'webspeech') {
        if (!createWebSpeechRecognizer(win))
          throw new Error(
            'This browser has no speech recognition. Choose the local speech server in Voice settings.',
          );
        active = true;
        startWebSpeech();
        refreshIndicator();
        setState('listening', WEB_SPEECH_NOTICE);
        return;
      }
      const status = await getSpeechServerStatus(fetchImpl);
      if (!status?.online)
        throw new Error(
          status?.message || 'Speech server not answering — see VOICE-SETUP.md',
        );
      mic = await openMicrophone({
        deviceId: settings.deviceId,
        noiseSuppression: settings.noiseSuppression,
      });
      mic.setCapturing(settings.voiceActivation);
      vad = settings.voiceActivation
        ? createVad({ maxMs: MAX_UTTERANCE_MS })
        : null;
      removeFrame = mic.onFrame(onFrame);
      active = true;
      doc?.addEventListener?.('keydown', onKeyDown, true);
      doc?.addEventListener?.('keyup', onKeyUp, true);
      ensurePttButton();
      if (pttButton) {
        pttButton.hidden = !settings.pushToTalk || settings.voiceActivation;
        pttButton.addEventListener('pointerdown', onPointerDown);
      }
      win?.addEventListener?.('pointerup', onPointerUp);
      refreshIndicator();
      setState('listening', `${mic.label} · ${armedDetail()}`);
    },
    stop() {
      active = false;
      recording = false;
      chunks = [];
      removeFrame?.();
      removeFrame = null;
      recognizer?.stop();
      recognizer = null;
      void mic?.close();
      mic = null;
      doc?.removeEventListener?.('keydown', onKeyDown, true);
      doc?.removeEventListener?.('keyup', onKeyUp, true);
      if (pttButton) {
        pttButton.removeEventListener('pointerdown', onPointerDown);
        pttButton.hidden = true;
      }
      win?.removeEventListener?.('pointerup', onPointerUp);
      indicator.set(false);
      setSpeaker('idle');
    },
    sendText: (text) => void handleTranscript(text),
    sendMapEvent() {},
    bindControls() {},
  };
}
