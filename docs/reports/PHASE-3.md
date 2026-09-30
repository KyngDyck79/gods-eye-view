# Phase 3 — ATC audio, traffic, cameras

**Date:** September 30, 2026 · **Branch:** `feature/gev-v2`

## Gate results

| Step | Command | Result |
|---|---|---|
| Lint | `npm run lint` | Pass: 0 errors (491 inherited warnings, unchanged) |
| Typecheck | `npm run typecheck` | Pass |
| Unit tests | `npm test` | Pass: 5,491 tests (5,490 pass, 1 skipped, 0 failures); 5,461 after Phase 2 |
| Boundaries | `npm run check:boundaries` | Pass |
| Layer tokens | `npm run layer-token:check -- --base-ref origin/main` | Pass: 28 published, 1 new |
| Formatting | `npm run format:check` | Pass |
| Build | `npm run build` | Pass |
| Run | dev server on a spare port, checked in a browser | Pass; see below |

## "Done when" check

| Requirement | Result |
|---|---|
| A user stream plays, and shows LIVE only when it is truly live | **Met.** A stand-in receiver (a local Icecast-style server playing a spoken ATC phrase) was added through the new SOURCES dialog and played from the cockpit ATC page through the local relay. Status went CONNECTING → **LIVE AUDIO** only once speech was heard. With a "squelch" stream (one call, then 25 s of quiet), it went LIVE at 5.9 s and dropped to "USER SOURCE · no transmission heard" at 26 s. |
| LiveATC opens externally | **Met, one check left for Rod.** The ATC page shows **LISTEN ON EXTERNAL SOURCE · LiveATC · {airport} ↗**, which opens `https://www.liveatc.net/search/?icao={airport}` in a new tab. LiveATC blocks scripted requests, so I could not load that page from here. Please click it once to confirm. LiveATC stream addresses are refused as sources. |
| Cameras show their true cadence | **Partly met.** The camera viewer shows a "Source:" line and never shows the viewer's own cap as the camera's rate. Live video shows measured frames per second (unit-tested; no live-video camera is in the current packs). Still images show the measured interval between real changes. Over 9 minutes, two London cameras changed about once each, so the line correctly read "measuring how often it changes…" (a rate needs two changes). Conditional requests worked: 13 of 18 checks came back "not modified" and were not re-downloaded. |

## What was built

- **ATC audio**
  - *Your audio sources* dialog (the **SOURCES** button on the ATC page): USER SDR and USER URL entries, kept in this browser only.
  - The source list is ranked for the airport and frequency (spec 4.7's `getSources`), with LiveATC last as an external link.
  - The **stream player** (`src/audio/streamPlayer.js`) sits on the AudioBus, so starting ATC stops the radio and vice versa. LIVE is decided in one place, from real playback plus a Web Audio analyser.
  - The **local relay** (`/api/audio/relay`) serves only loopback, private-network, `localhost` or `.local` hosts. Names are pinned to their resolved addresses. It follows no redirects, passes audio only, sends no CORS headers, allows at most 2 streams and records nothing.
  - Streams from elsewhere play directly. If their server doesn't allow measurement, they play but never show LIVE, and the page says why.
- **Traffic** (decision 3B)
  - Simulated dots are off by default, with or without a TomTom key. The row reads "Road speeds: no source configured — add a TomTom key", or "LIVE … Unmatched hidden" with a key.
  - A labeled chip, **SIMULATION OFF / SIMULATED DOTS ON**, brings the simulation back, and every status line then says SIMULATED.
- **Traffic Incidents layer** (Movement group, share-link token `0`)
  - Comes from TomTom Incident Details v5 with your key, server-side only.
  - Budgeted at 80 requests per UTC day, inside TomTom's free 2,500 per month.
  - Each area is cached for 5 minutes, and views over 10,000 km² are asked to zoom in rather than spending requests.
  - Live over the Grand Strand: 36 incidents, including lane closures on US-501 between Elm St and Veterans Hwy.
- **Cameras**
  - FPS cap selector (AUTO / 5 / 10 / 15), which limits redraws only and is remembered in this browser.
  - A measured "Source:" line.
  - Conditional still-image requests (ETag / Last-Modified).
  - Unreachable cameras show CAMERA OFFLINE.
- **SDR-SETUP.md.** The shopping list, then RTLSDR-Airband and Icecast. The configuration follows the RTLSDR-Airband wiki. A KMYR example puts three frequencies (119.2, 119.7, 120.3) on one dongle and notes that Tower 128.45 needs a second dongle or scan mode. It ends with adding the stream in the app and troubleshooting.

## Found along the way

- **South Carolina cameras are not wired in.** 511SC has no developer program, and its disclaimer forbids displaying its content "without the express written permission of SCDOT" (<https://www.511sc.org/static/disclaimer.html>). To pursue it, ask SCDOT for written permission; the SCDOT contact page is on scdot.org.
- **A 304 bug in my own change, caught by a test.** The camera proxy's redirect helper treated "304 Not Modified" as a redirect. Fixed.
- **Temporary ADSB.lol outage overnight.** During testing, ADSB.lol failed enough times in a row that its circuit breaker opened. The app fell back to OpenSky and SYSTEM showed ADSB.lol as OFFLINE. The breaker's test request later succeeded and it recovered by itself. The cause wasn't captured (most likely timeouts or rate limits).
- **Microphone prompt and "VOICE SYSTEM ERROR".** The existing OpenAI voice feature asked for the microphone, which the test browser blocks. None of the new audio code uses the microphone. Your S23 Ultra microphone routing (AudioRelay → BlackHole 2ch) is Phase 6.
- **Test-file quirk.** Chrome would not start a stream made purely of digital silence. Real receiver streams carry audio frames even when quiet, so this should not affect them.

## Disabled or deferred, and why

| Item | Status | Why |
|---|---|---|
| USER SOURCES category in the RADIO panel | Not yet | Your sources play from the cockpit ATC page. The radio panel category belongs with the Phase 8 radio polish. |
| KiwiSDR / WebSDR links | Not added | HF only (0–30 MHz), so no use for VHF airband near KMYR. Can be added for oceanic HF. |
| `config/traffic-agencies.json` | Not created | The existing 13 camera agencies are configured in code with per-pack switches in `.env`. No new agency qualified (SC excluded, above). |
| Real-time road speeds without TomTom | Not available | No verified free source. The layer says so instead of inventing speeds. |
| Measured HLS frame rate in the browser | Unit-tested only | No live-video camera exists in the current packs. |

## How Rod can check it in 5 minutes

1. **Restart the app so it runs the new code.** In the Terminal window running
   it, press **Control + C**, then run these two commands, pressing **Return**
   after each:

   ```bash
   cd ~/gods-eye-view
   ```

   ```bash
   npm run dev
   ```

2. **Traffic incidents.** Open
   `http://localhost:4173/#v=2&lat=33.72&lon=-78.93&alt=40000&heading=0&pitch=-89&roll=0&map=esri-imagery`.
   Open **Data Layers**, and under **Movement** click **Traffic Incidents**.
   Colored markers appear on the Grand Strand.
3. **Street Traffic.** In the same group, click **Street Traffic**. The row
   says LIVE with TomTom, and the chip reads **SIMULATION OFF**.
4. **LiveATC link.** Open cockpit mode on any aircraft (see the Phase 2
   steps), open the **ATC** tab, and click **LISTEN ON EXTERNAL SOURCE**.
   LiveATC's page for that airport opens in a new tab.
5. **Camera cadence.** Open **Cameras**, pick a camera, and look for the
   **FPS CAP** selector and the **Source:** line under it.

## New environment variables

None. Traffic incidents use your existing `TOMTOM_API_KEY`.

## New data sources

- **TomTom Traffic Incidents** (your key).
- **LiveATC.net**, as an external link only.

Both are in `DATA_SOURCES.md` → "v2 provider register" and `CREDITS.md`.

**STOP.** Waiting for Rod to reply **GO** for Phase 4 (earthquakes, radar,
severe weather, satellites, alerts engine).
