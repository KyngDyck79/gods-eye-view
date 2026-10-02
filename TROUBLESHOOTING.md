# Troubleshooting

Start with **SYSTEM** (bottom right). It shows every data provider's status,
last success, last error and budget. Most problems show up there first.

## The app won't start

| What you see | Fix |
|---|---|
| `command not found: npm` | Install Node 24 from <https://nodejs.org>, then open a new Terminal window. |
| `Port 4173 is in use` | The app is already running in another Terminal window. Use that one, or press **Control + C** there first. |
| Errors after updating | Run `npm ci`, then `npm run dev` again. |
| Anything else | Run `npm run doctor` and follow what it says. |

## Data

| What you see | Meaning and fix |
|---|---|
| **AIRCRAFT DATA TEMPORARILY UNAVAILABLE** | ADSB.lol and OpenSky both failed. It recovers by itself; SYSTEM shows which one is down. |
| **NEEDS API KEY** on a provider | That source needs a key; see [API-KEYS.md](API-KEYS.md). |
| **RATE LIMITED** | The provider's free budget is used up for now. The app backs off and retries later. |
| **STALE** on a layer | The newest data is older than normal; the provider is slow or down. Old data is never shown as live. |
| **WEATHER DATA TEMPORARILY UNAVAILABLE** | NWS or AviationWeather.gov didn't answer. Try again in a few minutes. |
| **FACILITY DATA TEMPORARILY UNAVAILABLE** | The public OpenStreetMap servers are busy or refusing; see [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md). Areas you've loaded before still work for 7 days. |
| **CAMERA OFFLINE** | That camera's source isn't answering. Try **NEXT**. |
| No cameras near Myrtle Beach | Correct: South Carolina's cameras aren't licensed for this app. |
| A layer won't turn on | Ask GOD "toggle *layer*". It replies with the layer's own error. |

## Voice

See the troubleshooting table in [VOICE-SETUP.md](VOICE-SETUP.md). The
common ones:

| What you see | Fix |
|---|---|
| **MICROPHONE UNAVAILABLE — permission denied** | Allow the microphone in Chrome (padlock in the address bar), and in System Settings → Privacy & Security → Microphone. |
| **Speech server not answering** | Start it with `npm run speech`. |
| The meter doesn't move | In AudioRelay on the Mac, set the output to BlackHole 2ch. In Voice Settings, choose BlackHole 2ch as the microphone. |
| GOD hears itself | Set the Mac's sound output to speakers or headphones, not BlackHole. |

## ATC audio

| What you see | Fix |
|---|---|
| NO SOURCE FOR THIS AIRPORT | Add your receiver under **SOURCES**, or use **LISTEN ON EXTERNAL SOURCE** (LiveATC, opens in a new tab). |
| STREAM ERROR | Your receiver or Icecast isn't running; see [SDR-SETUP.md](SDR-SETUP.md). |
| Plays but never shows LIVE | LIVE appears only when audio is actually heard. Some streams don't allow measuring; the page says so. |

## GOD

| What you see | Meaning |
|---|---|
| "AI assistant not configured — add an AI key in Settings → AI." | Free-form questions need `AI_API_KEY`. The commands still work. |
| "That information is not currently available from the connected data sources." | No connected source has that information. GOD never guesses. |
| "No aircraft is selected." | Click an aircraft first, or say "track" and its callsign. |

## Start fresh

To clear cached map data (safe; it rebuilds), stop the app first, then run:

```bash
cd ~/gods-eye-view && rm -rf .gev-cache node_modules/.vite
```
