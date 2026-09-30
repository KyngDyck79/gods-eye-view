# Phase 6 — Voice

**Date:** September 30, 2026 · **Branch:** `feature/gev-v2`

## Gate results

See the gate table at the end of this report.

## "Done when" check

| Requirement | Result |
|---|---|
| Rod speaks into the S23 | **Needs Rod.** BlackHole 2ch and AudioRelay aren't installed on the Mac yet, and my test browser blocks microphones. `VOICE-SETUP.md` has the exact steps. |
| The meter moves | **Built; Rod to confirm.** The meter reads the selected microphone through an AnalyserNode (**SHOW LEVEL** / **TEST MICROPHONE**). In my test browser the microphone is blocked, and the panel correctly shows `MICROPHONE UNAVAILABLE — permission denied. …` instead of a fake level. |
| A transcript appears | **Met with a stand-in.** The gateway turned a WAV made in the browser's format into a multipart upload to `POST /inference`, exactly as whisper.cpp's server expects. A local stand-in server (test only, clearly labeled) confirmed it received a valid WAV with `response_format=json`, and the text came back through `/api/stt/transcribe`. The real whisper.cpp server wasn't built here: it needs a download and build on your Mac (`npm run speech:setup`). |
| The audio stays local | **Met.** `WHISPER_SERVER_URL` must be `127.0.0.1` / `localhost` / `::1`; anything else is refused (unit-tested). `/api/stt` answers this Mac only. Audio is held in memory for one utterance and never written. ● LISTENING shows whenever capture is on, and capture is muted while GOD speaks. |

## Built

- **Gateway:** `server/providers/whisper/`. It reports status, transcribes,
  answers this Mac only, caps uploads at 10 MB, checks for WAV, and shows as
  *Local speech server* in SYSTEM. When not set up it reads `SPEECH SERVER
  NOT SET UP — add WHISPER_SERVER_URL`.
- **Browser, in `src/voice/local/`:**

  | File | Does |
  |---|---|
  | `mic.js` | Device list, capture, level, clear failure messages |
  | `wav.js` | 16 kHz mono PCM WAV encoder |
  | `vad.js` | Energy-based speech detection with hysteresis |
  | `stt.js` | Local and Web Speech engines |
  | `tts.js` | macOS voices through speechSynthesis |
  | `aviationSpeech.js` | Phrasing, e.g. "That's American one two three, a Boeing 737-800, at thirty-four thousand feet, as of eight seconds ago." |
  | `settings.js` | Saved settings; BlackHole preselect |
  | `localSession.js` | Plugs into the existing voice button's session contract, so OpenAI Realtime stays available unchanged as an opt-in engine |

- **Voice Settings panel:** `src/ui/voiceSettings.js`.
- **Scripts:** `npm run speech:setup` and `npm run speech`. Homebrew's
  whisper-cpp package is built with `-DWHISPER_BUILD_SERVER=OFF`, so it can't
  provide the server.

## Not done, and why

| Item | Why |
|---|---|
| In-browser Whisper (transformers.js / WebGPU) | Optional in the spec. It needs a model download of 75 MB or more into the browser. The local server covers the same need faster on the M2. |
| Real-hardware test | Needs your phone, AudioRelay and BlackHole. See the check below. |

## Rod's check

Follow `VOICE-SETUP.md`: the one-time setup, then "Every time you want
voice". The pass is:
1. The meter moves when you speak into the phone.
2. **● LISTENING** shows while you hold Space.
3. `HEARD: "…"` shows your words.

## Gate table

| Step | Result |
|---|---|
| `npm run lint` | Pass (0 errors; 491 inherited warnings) |
| `npm run typecheck` | Pass |
| `npm test` | Pass: 5,524 tests (5,523 pass, 1 skipped) |
| `npm run check:boundaries` | Pass |
| `npm run format:check` | Pass |
| `npm run build` | Pass |
