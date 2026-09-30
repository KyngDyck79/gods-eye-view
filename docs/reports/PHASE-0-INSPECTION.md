# Phase 0 — Inspection Report and Plan

**Product:** God's Eye View (created by Rod Smith)
**Spec:** GODS-EYE-VIEW-SPEC v2.0 (read from `~/Documents/GODS-EYE-VIEW-SPEC.md`)
**Inspected:** September 29, 2026, at commit `e7707d9` on `main`
**Code changes made:** none. This file is the only thing added.

---

## Summary for Rod

This repository is **not** an empty starter. It is a large, working, well-tested open-source app
(about 200,000 lines, 5,370 automated tests) that already does much of what the spec asks: 3D globe,
live aircraft, ships, satellites, earthquakes, weather radar, cyclones, traffic cameras, radio, a
cockpit view, and voice control.

The spec was written as though this were a smaller app. Several spec instructions **conflict with how
this app already works**. Those need your decision before Phase 1 (see
[Decisions needed](#decisions-needed-before-phase-1)). The most important:

1. **Architecture.** The spec asks for a separate TypeScript "gateway" server on port 8787. This app
   already has a gateway, built into its dev server on port 4173 and written in JavaScript. I recommend
   **extending the existing one** rather than building a second.
2. **Fake data.** Street traffic shows a *simulation* when there's no TomTom key or TomTom has no data
   (labeled "SIMULATED"). Your spec forbids this.
3. **Voice sends audio off the Mac.** Current voice control streams your microphone to OpenAI. The
   spec wants local speech recognition by default.

Health check (run during this inspection, output went to a temp folder, not the repo):

| Check | Result |
|---|---|
| `npm test` | 5,369 pass, 0 fail, 1 skipped |
| `npm run format:check` | pass (1,128 files) |
| `npm run check:boundaries` | pass |
| `vite build` | pass (warning: some bundles are over 1.5 MB) |
| `npm audit` | **0 vulnerabilities** (203 packages) |
| Lint | **no linter configured** (only Prettier formatting) |
| Typecheck | **not applicable**: the project is JavaScript, with no TypeScript |

---

## 1. Stack

| Item | Finding |
|---|---|
| Language | JavaScript (ES modules). No TypeScript anywhere. |
| Framework | None (no React or Vue). Plain DOM modules with HTML templates expanded at build time (`build/application-html.js`, `src/ui/templates`). |
| Build | Vite 6.4.3 with `vite-plugin-cesium` (`vite.config.js` → `server/standalone/vite.config.js` → `build/vite.js`). |
| Package manager | npm 11 (`package-lock.json`). |
| Node | `engines`: `>=24.14.0 <25 \|\| >=26 <27`. This Mac has **v24.21.0**. (The spec says Node 20+; the repo requires 24.) |
| Launcher | Pinokio (`pinokio/start.js` → `node scripts/pinokio-start.mjs`), plus `scripts/dev-fresh.sh` and `dev-secure.sh`. |
| CI | `.github/workflows/ci.yml`: doctor → format:check → check:boundaries → layer-token:check → test → build. |

**Scripts**

| Script | Command | Notes |
|---|---|---|
| `dev` | `vite` | Starts the app **and** all server-side proxies (they are Vite plugins). |
| `build` | `vite build` | Static browser bundle only. |
| `preview` | `vite preview` | Serves the build. Most proxies also run here, but the key-setup endpoint deliberately does not. |
| `test` | `node scripts/run-unit-tests.mjs` | Node's built-in test runner (`*.test.mjs` next to the code). |
| `lint` | **missing** | |
| `start` | **missing** | The spec requires `npm run start`. |
| Others | `doctor`, `format`, `format:check`, `check:boundaries`, `layer-token:check`, `test:track`, `qa:*`, `opensky:import` | |

## 2. Map engine

- **CesiumJS 1.138.0** (1.145.0 is available). No MapLibre, Leaflet or deck.gl.
- **Map stacks** (`src/maps/catalog.js`, URL `map=`):

  | id | Source | Needs |
  |---|---|---|
  | `photoreal` (default) | Google Photorealistic 3D Tiles | Google key, or Cesium ion token |
  | `bing-aerial`, `bing-labels` | Bing via Cesium ion | ion token |
  | `esri-imagery` | Esri World Imagery (`services.arcgisonline.com`) | none, "Powered by Esri" attribution |
  | `osm` | `tile.openstreetmap.org` | none, also the automatic failure fallback |

  Also: OpenFreeMap vector tiles (`tiles.openfreemap.org`) for OSM-backed features.
- **Terrain:** keyless Re:Earth/Mapterhorn quantized mesh (`terrain.reearth.land`, CC BY 4.0) with a
  retry policy; Cesium World Terrain when an ion token is set.
- **Tokens:** `GOOGLE_MAPS_API_KEY` and `CESIUM_ION_TOKEN` are injected into the browser bundle through
  Vite `define` (`build/vite.js`), by design and as documented in `.env.example`. **Neither is set in
  your `.env` today**, so the app starts on keyless Esri imagery.

## 3. URL state (deep links)

All in the hash, versioned `v=2` (`src/sharelink.js`, `src/data/layerState.js`). Every one must keep working.

| Param | Controls |
|---|---|
| `v` | Format version (`2`) |
| `lat`, `lon`, `alt`, `heading`, `pitch`, `roll` | Camera |
| `style` | Visual style: `normal`, `crt`, `nvg`, `flir`, `anime`, `noir`, `snow` |
| `sp` | Per-style parameters (token-encoded, e.g. pixelation, gain, grain) |
| `bloom`, `bi`, `bv` | Bloom on/off, intensity, bloom algorithm version |
| `sharpen`, `si` | Sharpen on/off, intensity |
| `hud`, `hv` | HUD variant (`tactical`, `operator`, `minimal`, `cyber`) and visibility |
| `dm`, `dd`, `da`, `kf`, `ko` | Detection overlay: mode, density, allocation, fade %, outside opacity % |
| `cr` | Celestial ring |
| `sc`, `scf`, `sce` | Scope mask: on, feather %, terminus % |
| `map` | Map stack (table above) |
| `l` | Enabled layers, dot-separated one-char tokens (below) |
| `lo` | Layer options, `owner.option.value`, joined by `_` |
| `ui` | Panel open/pinned state. Panel tokens: `c` control, `l` location bar, `d` data, `v` CCTV, `i` recent imagery, `r` radio, `s` scene, `g` global context, `p` post-process toggles, `m` parameter sliders |
| `at` | Share creation timestamp |

**Layer tokens** (ledger `src/data/layerStateTokenReservations.json`, which CI guards; new tokens come
from `npm run layer-token:next`):
`a` AIS vessels · `p` ALPR cameras · `h` Bhote Koshi 2026 · `z` Bhote Koshi locator · `b` bikeshare ·
`c` CCTV · `n` directions · `e` earthquakes · `2` fire perimeters · `f` flights · `q` dams ·
`d` datacenters · `w` FIRMS fires · `m` military aircraft · `g` military awareness ·
`i` military installations · `r` radio · `1` recent imagery · `x` rocket launches · `s` satellites ·
`u` submarine cables · `t` traffic · `j` transit · `y` cyclones · `l` lightning · `v` radar ·
`o` satellite clouds · `k` wind.

**Conflict to note:** the spec's example new parameter `mode=cockpit` is fine, but the layer token
`l` is already taken by lightning. New spec layers (METAR stations, NWS alerts, airports, and so on)
must take unused tokens from the ledger tool.

## 4. Visual modes

- **Styles** (`src/styles/`): normal, retro/CRT, surveillance/NVG, thermal/FLIR, anime, noir, snow.
  Each has tunable parameters.
- **Post-processing:** bloom (two versions), sharpen, scope mask, celestial ring, cyber sonar
  (`src/cyberSonar*.js`), cockpit cloud effects.
- **HUD layouts:** tactical (default), operator, minimal, cyber (`src/hudLayouts.js`), plus a
  detection-box overlay and locality readouts.
- A render governor (`src/renderGovernor.js`) already switches Cesium into `requestRenderMode` when idle.

## 5. Aircraft system

| Aspect | Finding |
|---|---|
| Primary source | **OpenSky** `/api/states/all?extended=1`, **worldwide** (no bounding box), 4 credits per call (`server/providers/aircraft/opensky.js`). |
| Fallback | **ADSB.lol** point query `/v2/lat/{lat}/lon/{lon}/dist/250`, around the view, cached 12 s. Also `/v2/mil` for the military layer. |
| Enrichment | `api.adsbdb.com` (callsign → route, hex → aircraft), disk-cached permanently, max 4 in flight and 5 per second. |
| Tracks | OpenSky `/tracks/all` and ADSB.lol `/data/traces/` for the selected aircraft. |
| Local receivers | Browser WebUSB RTL-SDR ADS-B decoding, and `LOCAL_RECEIVER_FEEDS` (dump1090/readsb/dump978 `aircraft.json`). See `docs/LOCAL-RECEIVERS.md`. |
| Polling | The client polls every **30 s**. The server has an adaptive cache from 9 s to 300 s, driven by `X-Rate-Limit-Remaining`, plus 429 cooldown and serve-stale. |
| Auth | `OPENSKY_AUTH_MODE` = `oauth` (default) / `auto` / `basic` / `anon`. OAuth client-credentials with coalesced token refresh is implemented. **Basic mode is dead code:** OpenSky retired username/password auth on March 18, 2026. Your `.env` has OAuth client credentials set. |
| Rendering | Cesium **`BillboardCollection`** (primitives, not entities) with icon rotation by track, class silhouettes, a military amber tint, optional 3D models, and a 400-point trail for tracked aircraft. |
| Motion | **Render-behind interpolation:** the fleet is drawn at *now − 30 s*, so it moves between two real fixes and never extrapolates. That is more honest than the spec's dead reckoning, but it means displayed positions are about 30 s old. |
| Removal | After 3 missed polls, or 1 for likely-landed aircraft. |
| Airplanes.live | Not used. |

## 6. Radio and audio

- **Public radio:** Radio Browser directory through `/api/radio` (mirror rotation, 45 min cache, HTTPS
  streams only), with a globe layer of stations and a tuner UI with tuning static (a UI sound effect,
  not presented as a station).
- **Browser SDR:** WebUSB RTL-SDR (`@jtarrio/webrtlsdr`) in a Web Worker. Modes are **FM broadcast
  (87.5–108 MHz)** and **ADS-B 1090**. **No AM airband (118–137 MHz)**, so no ATC reception.
- **Not present:** LiveATC links, Icecast/user stream URLs, KiwiSDR/WebSDR, an ATC frequency list,
  or a single global AudioBus as the spec describes (the radio layer owns its own playback).

## 7. Traffic cameras (CCTV)

- **Agencies:** Austin TPW, Caltrans (districts 4, 7, 11, 3), Transport for London, Ontario 511,
  Fintraffic, DriveBC, TxDOT (AUS, SAT), Tallinn, Tarktee (Estonia), Warendorf (Germany), Live Traffic
  NSW, Calgary, DelDOT. Also configurable source packs in `config/cctv_sources.*.json`.
- **South Carolina / Grand Strand:** **none.**
- **Feed types:** still image, MJPEG, MP4, HLS (hls.js), WebM. At most 2 live-video sessions at once.
- **Refresh:** still images use per-provider cadence (3–10 min; the default is 5 min, clamped 1–20 min).
  Frames are proxied through `/api/cctv` (the upstream URL is never taken from the client).
- **Fallbacks:** when video fails, a labeled still, Street View (Google key) or a placeholder frame is
  shown. These are labeled as not live.
- **Missing vs spec:** FPS cap selector, measured source rate display, ETag/Last-Modified use (not found).

## 8. Other features and integrations

| Area | Existing |
|---|---|
| Weather | NOAA **nowCOAST**: MRMS CONUS radar reflectivity, NLDN/GLD360 **lightning density**, global IR satellite. ECMWF/Open-Meteo **wind** (forecast). **NHC** cyclones (CurrentStorms.json, cones, 7-day outlook). NASA **FIRMS** fires (key). NIFC fire perimeters. |
| Earth | USGS earthquakes (`all_day.geojson` only). |
| Space | CelesTrak (TLE format, 6 h cache), SGP4 with satellite.js **on the main thread**. Launch Library 2 rocket launches. |
| Marine | AISStream WebSocket held by the server and relayed (`/api/ais-live`), with a silence watchdog. Needs `AISSTREAM_API_KEY` (not set). |
| Transit | GTFS/GTFS-RT proxy. **Agency feeds are hard-coded** in `src/data/transitFeeds.js` (MBTA, Metro Transit, HSL, Entur, OVapi, Translink, and others). |
| Traffic flow | TomTom flow tiles through `/api/tomtom` (key set) with a 6,000/day budget. **Keyless or unmatched roads use a simulation** (see Known issues). |
| Places | Nominatim `/api/geocode`, Photon, Google Places (optional), OSRM routing, Overpass (public Overpass off by default since #648). |
| Cockpit | Full cockpit mode (`src/ui/cockpit*.js`, ~3,000 lines): altitude and heading instruments, briefing, tracking camera, local conditions. **No** nearest runway, METAR/TAF, ATC frequency or ATC audio. |
| Voice | **OpenAI Realtime over WebRTC** (`src/voice/`). Browser mic uses the **default input device only** (no device picker), with echo cancellation, noise suppression and AGC. A server mints short-lived client secrets. A tool/action schema drives the map. Cost estimator. |
| AI | OpenAI only (`OPENAI_API_KEY`, `OPENAI_HUD_SUMMARY_MODEL`). No provider-agnostic `AIProvider`. |
| Director | Scene documents, camera paths, data packs, sharing (`docs/DIRECTOR*.md`). |
| Settings | In-app **Provider Settings / "POWER UP"** panel writes keys to `.env` (localhost only, owner-only file permissions, never returned to the browser). |
| Other layers | Military aircraft and installations, ALPR cameras, datacenters, dams, submarine cables, bikeshare (GBFS), recent imagery, directions. |

## 9. Dependencies

**Runtime:** cesium 1.138.0, hls.js, satellite.js 6.0.2, @jtarrio/webrtlsdr, @jtarrio/signals, @mapbox/vector-tile, pbf, mgrs, egm96-universal, @meri-imperiumi/eccodes-wasm.
**Dev:** vite 6.4.3, vite-plugin-cesium, prettier 3.9.6, puppeteer, sharp, ws.

`npm audit`: **0 vulnerabilities**. Outdated:

| Package | Current | Latest | Note |
|---|---|---|---|
| cesium | 1.138.0 | 1.145.0 | minor; worth updating in Phase 8 with a visual check |
| vite | 6.4.3 | 8.3.1 | two majors behind; do **not** upgrade during feature work |
| satellite.js | 6.0.2 | 7.1.0 | major; check API before upgrading |
| mgrs, puppeteer, sharp, ws, prettier | patch/minor | | low risk |

## 10. Environment variables

**Read today** (see `.env.example` for full comments): `GOOGLE_MAPS_API_KEY`\*, `GOOGLE_MAPS_SERVER_API_KEY`,
`CESIUM_ION_TOKEN`\*, `OPENAI_API_KEY`, `OPENAI_REALTIME_*`, `OPENAI_HUD_SUMMARY_MODEL`,
`OPENSKY_AUTH_MODE`, `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET`, `OPENSKY_CREDENTIALS_FILE`,
`OPENSKY_USERNAME`/`PASSWORD` (dead), `LL2_API_TOKEN`, `FIRMS_MAP_KEY`, `AISSTREAM_API_KEY`,
`AISSTREAM_*`, `VITE_AIS_LIVE_*` (non-secret), `LOCAL_RECEIVER_FEEDS`, `TOMTOM_API_KEY`,
`TOMTOM_DAILY_TILE_BUDGET`, `CCTV_*`, `OVERPASS_UPSTREAMS`, `GEV_RATELIMIT_*`, `PORT` (4173), `HOST`.

\* Sent to the browser by design.

**Your `.env`** contains only `OPENAI_API_KEY`, `TOMTOM_API_KEY`, `OPENSKY_CLIENT_ID` and
`OPENSKY_CLIENT_SECRET`. All four are **server-side only**. **No secret is currently exposed to the
browser.** `.gitignore` covers `.env` and every `.env.*` except `.env.example`, which satisfies Part 5.
The dev server binds to localhost by default and blocks `.env` files from being served.

**Naming differences from the spec** (the spec's names vs existing ones): `GEV_PORT=8787` vs `PORT=4173`;
`VITE_CESIUM_ION_TOKEN` vs `CESIUM_ION_TOKEN`; the Settings panel writes `.env`, not `.env.local`.
I recommend keeping the existing names so current installs and the Pinokio launcher keep working.

## 11. Origin and license

- **Upstream:** `github.com/bilawalsidhu/gods-eye-view` (git `origin`), by **Bilawal Sidhu**, with
  community contributors. It is very active: this checkout is at PR #821.
- **License:** MIT, "Copyright (c) 2026 Bilawal Sidhu". The **LICENSE file must stay unchanged**
  (Part 0.8). `THIRD_PARTY_NOTICES.md` lists the Apache-2.0 SDR packages.
- `package.json` has `"author": "Bilawal Sidhu"` and upstream URLs, which is where rebranding applies.
- There is **no `CLAUDE.md`** in this repo. The file you asked me to read does not exist here.
- There is an **older second copy** at `~/pinokio/api/gods-eye-view.git` (September 16, PR #626). I did
  not use it.

## 12. Known issues (now)

From `docs/KNOWN-ISSUES.md` plus this inspection:

1. **Simulated traffic (conflicts with Part 0.2).** Without TomTom data, roads show animated
   "simulated" white dots with hard-coded per-road speeds, labeled SIMULATED.
2. **OpenSky credit burn.** The worldwide `/states/all` call costs 4 credits each time, so after a few
   hours the adaptive cache slows updates to 90–300 s. The ADSB.lol fallback covers only a 250 nm circle.
3. **Aircraft positions lag about 30 s** by design (render-behind interpolation).
4. **OpenSky Basic auth code still present** but no longer works upstream.
5. Street traffic is slow and uneven in dense cities. The CCTV panel can look "missing" (it starts collapsed).
6. Aircraft height datum: grounded aircraft float low for 1–2 polls at newly visited airports.
7. Weather: radar is CONUS-only; lightning is a 15-minute density grid (not strikes); cyclones cover NOAA basins only; wind is a forecast.
8. Live camera video: max 2 sessions; no RTMP, encrypted or fMP4 HLS.
9. Satellite passes ignore weather and orbital-element age.
10. Build produces bundles over 1.5 MB (`names-*.js` is 3.9 MB).
11. **No lint and no typecheck exist,** so the spec's per-gate "lint → typecheck" steps currently have nothing to run.

---

## Spec coverage at a glance

| Spec item | Status |
|---|---|
| Gateway: secrets, OAuth, AIS relay, shared caching | **Exists** (Vite middleware) |
| `/api/health`, `/api/providers`, SSE/WS fan-out, per-provider budget manager | Missing (partial budgets exist for OpenSky and TomTom) |
| Provider contract / metadata / usage mode | Missing |
| ADSB.lol primary, tiled viewport | Partial (fallback only, single 250 nm circle) |
| OpenSky OAuth | **Exists** |
| Route enrichment (adsbdb) | **Exists**, but routes are not labeled "PLAUSIBLE" and have no sanity check |
| OurAirports, runways, frequencies, frequency engine | Missing |
| AWC METAR/TAF/SIGMET/PIREP | Missing |
| NWS alerts, Open-Meteo, NHC | NHC exists; NWS missing; Open-Meteo used for wind only |
| Radar | nowCOAST MRMS (not IEM or RainViewer) |
| GIBS satellite | Credited, but the satellite-clouds layer uses nowCOAST |
| Lightning | **Exists** (nowCOAST) — the spec says "unsourced" |
| USGS, EONET | USGS day feed only; EONET missing |
| CelesTrak and satellite.js | Exists (TLE, main thread, 6 h cache) |
| AIS | **Exists** |
| Transit config file | Hard-coded feeds |
| Traffic cameras | **Exists** (13 agencies, none in SC); FPS cap and measured-rate display missing |
| Overpass facilities | Overpass infrastructure exists; hospitals and shelters layers missing |
| Nominatim search | **Exists** |
| ATC audio, LiveATC, USER SDR, AudioBus | Missing |
| Cockpit | **Exists**; missing runway, frequency, METAR and ATC audio |
| Alerts engine | Missing |
| Universal search index | Place search exists; no object index |
| GOD tier 1 (offline parser) | Missing |
| GOD tier 2 (LLM tools) | Exists as OpenAI Realtime voice tools |
| Local whisper STT, device picker, TTS phrasing | Missing |
| Diagnostics / attribution panel | Attribution/credits exist; diagnostics partial |
| Mobile layout | Not assessed in depth; limited responsive CSS found |

---

## Decisions needed before Phase 1

Reply with your choice for each (for example, "1A, 2A, 3B, 4A, 5A, 6A, 7A").

1. **Gateway architecture.**
   **A (recommended):** extend the existing server middleware (`server/providers/`, JavaScript) and
   add a standalone Node entry so `npm run start` works without Vite.
   **B:** build the spec's separate TypeScript/Fastify gateway on port 8787 and migrate proxies into it.
   That means rewriting about 4,300 lines of working, tested server code, which is contrary to Part 0.4.
2. **TypeScript / typecheck gate.**
   **A (recommended):** add JSDoc-based `tsc --checkJs` on *new* modules only, and add ESLint.
   **B:** skip the typecheck step; run lint, test and build only.
3. **Simulated street traffic.**
   **A:** remove the simulation entirely; roads without real flow show nothing.
   **B (recommended):** turn it off by default and show "Road speeds: no source configured"; keep the
   code behind a clearly labeled setting.
4. **Lightning.** The existing layer uses NOAA nowCOAST lightning *density*, a public NOAA product
   derived from Vaisala data. The spec says there is no source.
   **A (recommended):** keep it, labeled as density and not strikes, after verifying NOAA's
   redistribution terms in Phase 4.
   **B:** remove it per the spec.
5. **Radar.**
   **A (recommended):** keep nowCOAST MRMS as the US source (official NOAA, already working) and add
   RainViewer (zoom ≤ 7) for outside the US.
   **B:** replace it with IEM per the spec.
6. **Voice.**
   **A (recommended):** add local whisper.cpp as the default speech path and keep OpenAI Realtime as an
   opt-in that is clearly marked "audio goes to OpenAI".
   **B:** remove OpenAI Realtime.
7. **Upstream.** This fork will diverge heavily from Bilawal Sidhu's active project.
   **A (recommended):** work on `feature/gev-v2` and stop pulling upstream changes into it after this
   point, except deliberate cherry-picks.
   **B:** keep merging upstream regularly. Expect frequent conflicts.

---

## Implementation plan by phase

"Reuse" means keep as is. "Extend" means add to it. "Replace" is listed only with a reason.

### Phase 1 — Gateway and live aircraft
- **Extend** `server/providers/common/` with a provider registry (`ProviderMeta`, status), a budget
  manager (token bucket, credit ledger, backoff with jitter, circuit breaker, in-flight dedupe; the
  existing `coalesceProxyRequest` and OpenSky governor become its first users), `GEV_USAGE_MODE`,
  `/api/health` and `/api/providers`.
- **Add** a standalone server entry and `npm run start`; add `concurrently` only if needed.
- **Extend** aircraft: make ADSB.lol primary with viewport tiling and dedupe by hex; make OpenSky
  (OAuth only) the fallback with a bounding box instead of worldwide; **remove Basic auth mode**
  (reason: retired upstream, cannot work).
- **Reuse** the flights `BillboardCollection` renderer and records.
- **Keep** render-behind interpolation, and add a source-and-age line plus an "observed at" position in
  the detail panel.
- **Add** OurAirports ingest to `data/cache/ourairports/` with a kdbush index.
- **Extend** search with an airport and live-object index.
- **Extend** the Provider Settings panel into diagnostics v1.
- **Add** `CREDITS.md` and Rod Smith branding in About, footer and metadata; `LICENSE` untouched.

### Phase 2 — Cockpit, frequencies, aviation weather
- **Extend** the existing cockpit (`src/ui/cockpit*.js`) with a nearest-runway panel, frequency panel
  and METAR/TAF. No replacement.
- **Add** the frequency engine (pure module, scenario-table tests) and the AWC cache-file provider with
  a METAR decoder.
- **Add** the AudioBus. The radio layer's playback will be routed through it (extend, not replace).

### Phase 3 — ATC audio, traffic, cameras
- **Add** audio source providers (USER URL, USER SDR/Icecast, LiveATC external link).
- **Extend** CCTV with the FPS-cap selector, measured-rate readout, ETag/Last-Modified, and a
  `config/traffic-agencies.json` layer. Research SCDOT/511SC terms.
- **Reuse** all 13 existing agencies.
- **Apply** decision 3 to traffic.

### Phase 4 — Earth, radar, severe weather, satellites
- **Extend** USGS (hour, day and week feeds, filters).
- **Add** EONET, NWS alerts with polygons, and RainViewer (zoom ≤ 7).
- **Reuse** nowCOAST radar and NHC (per decision 5).
- **Extend** satellites: OMM JSON, 2-hour fetch limit, and **move SGP4 into a Web Worker** (reason: it
  currently runs on the main thread, against Part 4.29).
- **Add** the alerts engine.

### Phase 5 — Marine, transit, facilities
- **Reuse** the AIS relay; add bbox resubscribe and message age.
- **Extend** transit: move the hard-coded `src/data/transitFeeds.js` into
  `config/transit-agencies.json` (reason: Part 3 requires configurable agencies), keeping existing
  agencies as documented examples.
- **Add** Overpass facility layers using the existing cache and transport.

### Phase 6 — Voice
- **Add** a microphone device picker (BlackHole preselected), level meter, test-mic, push-to-talk, a
  whisper.cpp provider and a Web Speech fallback, plus a TTS phrasing module.
- **Reuse** the OpenAI Realtime path as an optional tier (per decision 6).

### Phase 7 — GOD assistant
- **Add** the tier-1 deterministic parser.
- **Extend** the existing voice action schemas (`src/voice/actionSchemas.js`, `gevActions.js`) as the
  tool layer, and put an `AIProvider` interface in front of OpenAI.
- **Add** the debug drawer and the exact "not available" phrase.

### Phase 8 — Performance, testing, mobile, polish
- Soak and fps measurements, a mobile layout, recorded fixtures, a Playwright smoke test (puppeteer is
  already present), a Cesium minor update, and the final docs (README, SETUP, API-KEYS, DATA-SOURCES,
  VOICE-SETUP, SDR-SETUP, TROUBLESHOOTING, CREDITS, CHANGELOG).
- Note: `DATA_SOURCES.md` (underscore) already exists at about 73 KB. I will extend it rather than
  create a second `DATA-SOURCES.md`, unless you prefer the spec's name.

---

**STOP.** No code has been changed. Waiting for Rod to reply **GO**, along with the decision choices above.
