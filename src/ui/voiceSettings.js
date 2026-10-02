/**
 * VOICE SETTINGS panel (GODS-EYE-VIEW-SPEC v2, 4.20–4.21): engine, microphone
 * picker (BlackHole 2ch preselected), live input level, noise suppression,
 * voice activation, push to talk, wake phrase, a local 3-second microphone
 * test, spoken-reply settings, and the feedback-loop warning. Opened from the
 * SET button on the voice control. Nothing recorded here leaves the browser.
 */

import { describeAircraft } from '../voice/local/aviationSpeech.js';
import { listAudioDevices, openMicrophone } from '../voice/local/mic.js';
import {
  ENGINE_OPENAI,
  ENGINE_WEB_SPEECH,
  VOICE_ENGINES,
  outputIsBlackHole,
  pickMicrophone,
  readVoiceSettings,
  writeVoiceSettings,
} from '../voice/local/settings.js';
import {
  WEB_SPEECH_NOTICE,
  getSpeechServerStatus,
} from '../voice/local/stt.js';
import { listeningIndicator } from '../voice/local/localSession.js';
import { listVoices, speak } from '../voice/local/tts.js';
import { concatChunks, peakLevel } from '../voice/local/wav.js';

const TEST_MS = 3000;

/** @param {{ documentRef?: Document, signal?: AbortSignal }} [options] */
export function initVoiceSettings({
  documentRef = globalThis.document,
  signal,
} = {}) {
  if (!documentRef?.body || documentRef.getElementById('voice-settings-panel'))
    return null;
  const doc = documentRef;
  const win = doc.defaultView || globalThis;
  const panel = doc.createElement('section');
  panel.id = 'voice-settings-panel';
  panel.className = 'system-status-panel voice-settings-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Voice settings');
  panel.innerHTML = `
    <header class="system-status-header">
      <strong>VOICE SETTINGS</strong>
      <button type="button" class="system-status-close" data-vs-close aria-label="Close voice settings">✕</button>
    </header>
    <div class="voice-settings-body">
      <label class="vs-row"><span>ENGINE</span><select data-vs="engine"></select></label>
      <p class="vs-note" data-vs-engine-note></p>
      <p class="vs-status" data-vs-server></p>
      <label class="vs-row"><span>MICROPHONE</span><select data-vs="deviceId"></select></label>
      <button type="button" class="scene-btn" data-vs-allow hidden>ALLOW MICROPHONE TO LIST DEVICES</button>
      <div class="vs-row"><span>INPUT LEVEL</span><div class="vs-meter" role="meter" aria-label="Input level" aria-valuemin="0" aria-valuemax="100"><i data-vs-meter></i></div></div>
      <div class="vs-buttons">
        <button type="button" class="scene-btn" data-vs-monitor>SHOW LEVEL</button>
        <button type="button" class="scene-btn" data-vs-test>TEST MICROPHONE</button>
      </div>
      <p class="vs-status" data-vs-test-result></p>
      <label class="vs-check"><input type="checkbox" data-vs="noiseSuppression"> Noise suppression</label>
      <label class="vs-check"><input type="checkbox" data-vs="voiceActivation"> Voice activation (listen continuously, detect speech locally)</label>
      <label class="vs-check"><input type="checkbox" data-vs="pushToTalk"> Push to talk (hold Space, or HOLD TO TALK)</label>
      <label class="vs-check"><input type="checkbox" data-vs="wakeEnabled"> Wake phrase</label>
      <label class="vs-row"><span>PHRASE</span><input type="text" data-vs="wakePhrase" maxlength="40"></label>
      <p class="vs-note">Language: English. The wake phrase is checked on this Mac only.</p>
      <p class="vs-warning" data-vs-feedback hidden>Your Mac's sound output is BlackHole 2ch, so GOD would hear its own replies. Set System Settings → Sound → Output to your speakers or headphones.</p>
      <h4>SPOKEN REPLIES</h4>
      <label class="vs-check"><input type="checkbox" data-vs="ttsEnabled"> Voice response</label>
      <label class="vs-row"><span>VOLUME</span><input type="range" min="0" max="1" step="0.05" data-vs="ttsVolume"></label>
      <label class="vs-row"><span>SPEED</span><input type="range" min="0.5" max="2" step="0.05" data-vs="ttsRate"></label>
      <label class="vs-row"><span>VOICE</span><select data-vs="ttsVoice"></select></label>
      <label class="vs-check"><input type="checkbox" data-vs="flightLevels"> Say flight levels above 18,000 ft</label>
      <button type="button" class="scene-btn" data-vs-say>TEST VOICE</button>
      <p class="vs-note">Audio is captured only while ● LISTENING shows, goes only to the speech server on this Mac, and is never saved.</p>
    </div>`;
  doc.body.appendChild(panel);
  const $ = (sel) => panel.querySelector(sel);
  const field = (name) => panel.querySelector(`[data-vs="${name}"]`);
  const meterBar = $('[data-vs-meter]');
  const meter = $('.vs-meter');
  const indicator = listeningIndicator(doc);
  let settings = readVoiceSettings();
  let preview = null;
  let meterFrame = 0;
  let testing = false;

  const save = () => {
    settings = writeVoiceSettings(settings);
  };

  function engineNote() {
    const note = $('[data-vs-engine-note]');
    note.textContent =
      settings.engine === ENGINE_WEB_SPEECH
        ? WEB_SPEECH_NOTICE
        : settings.engine === ENGINE_OPENAI
          ? 'OpenAI Realtime sends your voice to OpenAI and needs OPENAI_API_KEY. Opt-in only.'
          : 'Default. Needs the local speech server running (VOICE-SETUP.md).';
    note.textContent +=
      ' Changing the engine applies after you reload the page.';
  }

  async function refreshServer() {
    const el = $('[data-vs-server]');
    el.textContent = 'Speech server: checking…';
    const s = await getSpeechServerStatus();
    el.textContent = s.online
      ? 'Speech server: ● ONLINE (on this Mac)'
      : `Speech server: ${s.configured ? 'NOT ANSWERING' : 'NOT SET UP'} — ${s.message || ''}`;
    el.dataset.state = s.online ? 'ok' : 'bad';
  }

  async function refreshDevices() {
    const devices = await listAudioDevices().catch(() => []);
    const inputs = devices.filter((d) => d.kind === 'audioinput');
    const select = field('deviceId');
    select.textContent = '';
    const unlabeled = inputs.every((d) => !d.label);
    $('[data-vs-allow]').hidden = !unlabeled;
    const chosen = pickMicrophone(devices, settings);
    for (const d of inputs) {
      const opt = doc.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || 'Microphone (allow access to see names)';
      select.append(opt);
    }
    if (chosen) {
      select.value = chosen.deviceId;
      if (
        !unlabeled &&
        (settings.deviceId !== chosen.deviceId ||
          settings.deviceLabel !== chosen.label)
      ) {
        settings.deviceId = chosen.deviceId;
        settings.deviceLabel = chosen.label;
        save();
      }
    }
    $('[data-vs-feedback]').hidden = !outputIsBlackHole(devices);
  }

  function refreshVoices() {
    const select = field('ttsVoice');
    const voices = listVoices(win);
    select.textContent = '';
    const def = doc.createElement('option');
    def.value = '';
    def.textContent = 'System default';
    select.append(def);
    for (const v of voices) {
      const opt = doc.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang}${v.local ? ', on this Mac' : ''})`;
      select.append(opt);
    }
    select.value = settings.ttsVoice;
  }

  function fill() {
    const engine = field('engine');
    if (!engine.options.length)
      for (const [id, label] of Object.entries(VOICE_ENGINES)) {
        const opt = doc.createElement('option');
        opt.value = id;
        opt.textContent = label;
        engine.append(opt);
      }
    engine.value = settings.engine;
    for (const key of [
      'noiseSuppression',
      'voiceActivation',
      'pushToTalk',
      'wakeEnabled',
      'ttsEnabled',
      'flightLevels',
    ])
      field(key).checked = settings[key];
    field('wakePhrase').value = settings.wakePhrase;
    field('ttsVolume').value = String(settings.ttsVolume);
    field('ttsRate').value = String(settings.ttsRate);
    engineNote();
  }

  async function stopPreview() {
    cancelAnimationFrame(meterFrame);
    const p = preview;
    preview = null;
    indicator.set(false);
    meterBar.style.width = '0%';
    $('[data-vs-monitor]').textContent = 'SHOW LEVEL';
    await p?.close();
  }

  async function startPreview() {
    await stopPreview();
    try {
      preview = await openMicrophone({
        deviceId: settings.deviceId,
        noiseSuppression: settings.noiseSuppression,
      });
    } catch (error) {
      $('[data-vs-test-result]').textContent = error.message;
      return null;
    }
    indicator.set(true);
    $('[data-vs-monitor]').textContent = 'STOP LEVEL';
    const tick = () => {
      if (!preview) return;
      const { peak } = preview.level();
      const pct = Math.min(100, Math.round(peak * 140));
      meterBar.style.width = `${pct}%`;
      meter.setAttribute('aria-valuenow', String(pct));
      meterFrame = requestAnimationFrame(tick);
    };
    tick();
    void refreshDevices();
    return preview;
  }

  async function testMicrophone() {
    if (testing) return;
    testing = true;
    const result = $('[data-vs-test-result]');
    const mic = preview || (await startPreview());
    if (!mic) {
      testing = false;
      return;
    }
    mic.setCapturing(true);
    const chunks = [];
    const off = mic.onFrame((frame) => chunks.push(frame));
    result.textContent = 'Recording 3 seconds — speak now…';
    await new Promise((r) => setTimeout(r, TEST_MS));
    off();
    const samples = concatChunks(chunks);
    const peak = peakLevel(samples);
    await stopPreview();
    result.textContent = `Peak level ${Math.round(peak * 100)}%${peak < 0.02 ? ' — nothing heard. Check AudioRelay is connected and playing into BlackHole 2ch.' : ''}. Playing it back…`;
    try {
      const ctx = new (win.AudioContext || win.webkitAudioContext)();
      const buffer = ctx.createBuffer(1, samples.length, mic.sampleRate);
      buffer.copyToChannel(samples, 0);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.onended = () => void ctx.close();
      src.start();
    } catch {
      /* playback is a courtesy */
    }
    testing = false;
  }

  panel.addEventListener('change', (event) => {
    const el = /** @type {HTMLInputElement} */ (event.target);
    const key = el?.dataset?.vs;
    if (!key) return;
    if (el.type === 'checkbox') settings[key] = el.checked;
    else if (el.type === 'range') settings[key] = Number(el.value);
    else settings[key] = el.value;
    if (key === 'deviceId')
      settings.deviceLabel = el.selectedOptions?.[0]?.textContent || '';
    save();
    if (key === 'engine') engineNote();
    if (key === 'deviceId' || key === 'noiseSuppression')
      if (preview) void startPreview();
  });
  $('[data-vs-allow]').addEventListener('click', () => void startPreview());
  $('[data-vs-monitor]').addEventListener(
    'click',
    () => void (preview ? stopPreview() : startPreview()),
  );
  $('[data-vs-test]').addEventListener('click', () => void testMicrophone());
  $('[data-vs-say]').addEventListener(
    'click',
    () =>
      void speak(
        describeAircraft(
          {
            callsign: 'AAL123',
            typeName: 'Boeing 737-800',
            altitudeFt: 34000,
            ageSec: 8,
          },
          settings,
        ),
        { ...settings, ttsEnabled: true },
        { win },
      ),
  );

  function open() {
    settings = readVoiceSettings();
    fill();
    refreshVoices();
    panel.hidden = false;
    void refreshDevices();
    void refreshServer();
  }
  function close() {
    panel.hidden = true;
    void stopPreview();
  }
  const onDocClick = (event) => {
    const target = /** @type {Element} */ (event.target);
    if (target?.closest?.('#gev-voice-settings-btn')) {
      event.stopPropagation();
      if (panel.hidden) open();
      else close();
    } else if (target?.closest?.('[data-vs-close]')) close();
  };
  const onKey = (event) => {
    if (event.key === 'Escape' && !panel.hidden) close();
  };
  doc.addEventListener('click', onDocClick, true);
  doc.addEventListener('keydown', onKey);
  win.speechSynthesis?.addEventListener?.('voiceschanged', refreshVoices);
  signal?.addEventListener(
    'abort',
    () => {
      close();
      doc.removeEventListener('click', onDocClick, true);
      doc.removeEventListener('keydown', onKey);
      panel.remove();
    },
    { once: true },
  );
  return { open, close };
}
