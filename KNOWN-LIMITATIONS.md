# Known limitations

An honest list of what is missing, disabled or unverified as of September 30,
2026, and what would turn each one on. The app never fills these gaps with
made-up data.

## Not met or not verified

| Item | Status | What would fix it |
|---|---|---|
| **UI never freezes > 100 ms with 5,000 aircraft** (spec 4.29) | **Not met.** In a synthetic 5,000-aircraft test the frame rate passed (54 fps average), but each 5,000-contact poll blocks the page for 105–250 ms while the flight layer ingests it. Real views near the Grand Strand carry about 100 aircraft. | Move flight ingestion into a Web Worker, or split it across frames. Details: [docs/PERFORMANCE.md](docs/PERFORMANCE.md). |
| **Voice with your Galaxy S23 Ultra** | Built. Not tested on your hardware: BlackHole 2ch and AudioRelay aren't installed yet, and the test browser blocks microphones. | Follow [VOICE-SETUP.md](VOICE-SETUP.md). |
| **Local speech server** | Tested with a labeled stand-in only; the real whisper.cpp server isn't built on this Mac. | `npm run speech:setup` |
| **GOD's AI tier** | Unit-tested only; no `AI_API_KEY` is set. | Add `AI_API_KEY` ([API-KEYS.md](API-KEYS.md)). |
| **LiveATC link** | LiveATC blocks scripted requests, so I couldn't open it from here. | Click **LISTEN ON EXTERNAL SOURCE** once to confirm. |
| **Phone layout** | Checked at 375 × 812 in Chrome's phone emulation, not on a real iPhone or Android phone. | Open `http://<your Mac's IP>:4173` from a phone on the same Wi-Fi. This needs the dev server started with `--host`. |

## Data that isn't available

| Item | Why | What would turn it on |
|---|---|---|
| South Carolina traffic cameras (511SC / SCDOT) | 511SC forbids display without SCDOT's written permission. | Written permission from SCDOT. |
| Coast RTA (Myrtle Beach) buses | No public GTFS-Realtime feed in the Mobility Database. | Coast RTA publishing one; then add it to `config/transit-agencies.json`. |
| Ships | Needs a key. | `AISSTREAM_API_KEY` |
| Traffic incidents and real road speeds | Needs a key. | `TOMTOM_API_KEY` |
| En-route (Center) ATC frequencies | Not in OurAirports; GOD says so. | A licensed ARTCC frequency source. |
| Emergency facilities, road shapes, installations, ALPR (OpenStreetMap) | Public Overpass servers are unreliable from this network: overpass-api.de returns 406, and VK Maps sometimes times out (504). Cached areas (7 days) keep working. | Set `OVERPASS_UPSTREAMS` to an Overpass instance you run or pay for. |
| Zone-only NWS alerts on the map | They have no polygon; drawing them needs NWS zone shapes. They still appear in "weather here". | Fetching zone geometry. |
| Airspace layer | Optional in the spec; no verified download source was wired. | Verify FAA airspace data and add a layer. |
| Global radar (RainViewer), NASA GIBS layers | Not added; US radar (NOAA MRMS) and satellite clouds (nowCOAST) already work. | A later pass. |

## Features built differently or left out

| Item | Status |
|---|---|
| Universal search with categories (spec 4.18) | Not built as a separate index. Place search works (location bar), and GOD finds aircraft by callsign, airports by code, and places by name. |
| One Settings page with every section (spec 4.24) | Settings are split by area: **POWER UP** (keys), **SET** on the voice control (voice), **ALERTS → Rules** (alerts), **SYSTEM** (provider status). |
| Earthquake magnitude and radius filters on the Earthquakes layer | These filters are in the ALERTS rules. The layer shows the USGS past-day M2.5+ feed. |
| Separate storm list panel | NWS alerts appear in ALERTS and in "show severe weather". There's no separate list. |
| AIS per-region resubscription | The relay subscribes worldwide (or to `AISSTREAM_BOUNDING_BOXES`). Resubscribing on pans would reconnect aisstream's one-connection-per-key socket. |
| Satellite math in a Web Worker | It still runs on the main thread (existing code). |
| Whisper in the browser (WebGPU) | Not built; the local server is faster on the M2. |
| Camera wall disabled on phones | The app has no separate camera wall. Camera thumbnails on the map remain when the Cameras layer is on. |
