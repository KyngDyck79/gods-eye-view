# Phase 1 — Gateway and live aircraft

**Date:** September 29, 2026 · **Branch:** `feature/gev-v2`
**Decisions applied** (Rod replied "go" without picking, so the recommended
options were used): 1A extend the existing server, 2A lint and typecheck on new
code, 3B, 4A, 5A, 6A, 7A. Only 1A and 2A affect this phase.

## Gate results

| Step | Command | Result |
|---|---|---|
| Lint | `npm run lint` | Pass: 0 errors. 491 warnings, all in inherited code (see below) |
| Typecheck | `npm run typecheck` | Pass |
| Unit tests | `npm test` | Pass: 5,420 tests (5,419 pass, 1 skipped, 0 failures); 5,370 before Phase 1 |
| Boundaries | `npm run check:boundaries` | Pass |
| Formatting | `npm run format:check` | Pass |
| Build | `npm run build` | Pass (existing warning: some bundles are over 1.5 MB) |
| Run | dev server on a spare port, checked in a browser | Pass; see "What works" |

`npm run gate` runs all of these in order.

## What works

Checked live on September 29, 2026 (evening, Eastern time) against the real
services, not only in tests:

- **Live aircraft over the Grand Strand from ADSB.lol.** A regional view costs
  one adsb.lol request. In the browser the Flights layer reported
  `source: ADSB.lol`, `stale: false` and 6–9 aircraft, with registration and
  type (e.g. RPA3579, Republic Airlines, Embraer EMB-175).
- **OpenSky over OAuth2.** A continental-US view went to OpenSky with Rod's API
  client (token refreshed, 6,818 aircraft worldwide). Username/password code
  is removed.
- **Source and age on the aircraft readout.** Tracking an aircraft shows, for
  example:
  `RPA3579 · FL280 · 463 kts · SQK 7070` /
  `Republic Airlines · Embraer EMB-175 LR` / `Route unverified` /
  `ADSB.lol · position 03:16:04Z`.
- **No fake aircraft when offline.** With every source failing, `/api/aircraft`
  answers `AIRCRAFT DATA TEMPORARILY UNAVAILABLE` with no aircraft. Cached
  data is served, marked stale, for at most 5 minutes; after that the map
  clears. Unit tests cover the route and the browser side. A real Wi-Fi-off
  test is left to Rod (steps below), since it can't be done from here.
- **Budgets.** Every gateway provider (ADSB.lol, OpenSky, OurAirports) runs
  under a budget that cannot exceed its per-minute limit or daily credits. A
  200-seed property test checks this. Ten simultaneous tabs cause one
  upstream request per area.
- **OurAirports.** 72,605 airports and 11,008 navaids load in 1.5 s from the
  network (0.7 s from disk afterward). KMYR returns runway 18/36 and its
  frequencies (TWR 128.45, GND 120.3, ATIS 123.925, …) from the dataset.
- **Search v1.** `KMYR` or `MYR` flies to Myrtle Beach International. An
  exact callsign, registration or hex of a loaded aircraft tracks it
  (`N303RG` tracked AAL708). Ordinary place names still geocode as before.
- **Diagnostics v1.** The **SYSTEM** chip (bottom right) shows the worst
  current status. Its dialog lists each provider with status, last success,
  latency, requests and credits used, license, commercial-use terms and the
  required attribution link. Endpoints: `/api/health` and `/api/providers`.
- **Branding.** "CREATED BY ROD SMITH" under the title and on the loading
  screen, an About note in the SYSTEM dialog, author metadata, and
  `CREDITS.md`. `LICENSE` (Bilawal Sidhu's MIT notice) is unchanged.
- **Deep links.** No hash parameter changed. The tracking link `lo=f.t.<hex>`
  still works.

## Disabled, deferred or different from the spec, and why

| Item | Status | Why |
|---|---|---|
| Separate gateway process on port 8787 | Not built | Decision 1A: the existing server middleware is the gateway. `npm run dev` runs everything in one process on port 4173. |
| SSE/WebSocket fan-out to tabs | Not built | Shared caches and in-flight de-duplication already give "10 tabs ≠ 10× upstream traffic" (tested). Push delivery can come later if needed. |
| Poll interval 5–10 s | Kept at 30 s | The flights layer draws positions 30 s behind real time so it can interpolate between two real fixes. That delay equals the poll interval, and changing one without the other brings back the jumping this design fixed. Revisit with care in Phase 8. |
| Dead reckoning | Now capped at 30 s | Was up to 300 s. After 30 s an aircraft holds position, fades, and reads STALE. |
| "N s ago" on the readout | Shown as UTC time | The readout refreshes once per poll, so "4 s ago" would be wrong for most of the 30 s. `position 03:16:04Z` is always true. |
| "EST" tick | Partial | Aircraft coasting through a missed poll already fade to 45% and read STALE. A separate EST mark per aircraft is not added yet. |
| `ADSBLOL_API_KEY` slot | Not added | adsb.lol hasn't published how a key would be sent. Adding a guessed header would break the "no invented endpoints" rule. |
| ADS-B Exchange (RapidAPI) stub | Not built | Optional and paid; can be added when wanted. |
| Map providers in the registry | Not yet | Esri, OSM and Google tiles load in the browser, so the gateway can't observe their status. Their attributions are already on the map. |
| Other existing providers (TomTom, AIS, USGS, CelesTrak, NOAA, …) | Not yet on budgets or the SYSTEM list | Each moves onto the registry in the phase that touches it. |
| Status "IDLE" | Added beyond the spec's six | A provider nobody has asked for yet is neither ONLINE nor OFFLINE. |
| Search type-ahead | Not yet | v1 answers on Enter. A result list with arrow keys comes with universal search. |
| Old `/api/opensky` route | Kept, unused by the app | Retained for existing tooling and tests. It no longer sends passwords. |
| `DATA-SOURCES.md` name | Kept as `DATA_SOURCES.md` | The file already exists (about 73 KB). A v2 provider table in the spec's field format was added to it. |

## Found along the way

- **ADSB.lol rate-limits bursts.** Four requests at once got HTTP 429 with no
  Retry-After. Requests are now one at a time, at least 1.1 s apart.
- **Your OpenSky credits.** The account reported only 656 of 4,000 credits
  left today. The old code fetched the whole world every 30 s. The running
  dev server started this morning is the likely spender, and it keeps doing
  so until restarted with the new code.
- **A latent bug, fixed.** `src/layers/bikeshare/registry.js` used a constant
  it never imported, which would throw for a bikeshare city without a load
  radius.
- **adsbdb route terms.** Route data is credited to David Taylor and Jim Mason
  and "may not be copied, published, or incorporated into other databases"
  without permission. It is displayed only, and the attribution now says so.
- **Lint warnings.** ESLint reports 491 warnings in inherited code, mostly
  unused variables, plus one harmless duplicate object key in
  `src/overlays/worldOverlay.js`. They are left as warnings rather than
  rewriting working modules; a clean-up belongs in Phase 8.

## How Rod can check it in 5 minutes

1. **Restart the app so it runs the new code.** In the Terminal window where
   the app is running, press **Control + C**. Then type these two commands,
   pressing **Return** after each:

   ```bash
   cd ~/gods-eye-view
   ```

   ```bash
   npm run dev
   ```

2. **Open the Grand Strand.** Paste this into Chrome's address bar and press
   **Return**:
   `http://localhost:4173/#v=2&lat=33.65&lon=-78.93&alt=45000&heading=0&pitch=-70&roll=0&map=esri-imagery&l=f`
3. **Check the sources.** Click **SYSTEM** (bottom right). ADSB.lol should
   read **ONLINE** within a minute. Press **Esc** to close.
4. **Track an aircraft.** Click any aircraft icon. The readout should end
   with a line like `ADSB.lol · position 03:16:04Z`.
5. **Search.** Click **LOCATION** (bottom), click the magnifier, type
   `KMYR` and press **Return**. The map flies to Myrtle Beach International.
6. **Offline (optional).** Turn Wi-Fi off. Within a minute the aircraft read
   STALE. In **Data Layers**, the Flights row says
   `AIRCRAFT DATA TEMPORARILY UNAVAILABLE`. After 5 minutes no aircraft
   remain. Turn Wi-Fi back on and they return on the next poll.

## New environment variables

| Variable | Default | Purpose |
|---|---|---|
| `GEV_USAGE_MODE` | `personal` | `commercial` switches off providers whose terms forbid commercial use (OpenSky today). |
| `GEV_CONTACT_EMAIL` | empty | Contact put in the User-Agent for providers that ask who is calling. |

`OPENSKY_AUTH_MODE` now accepts `oauth` or `anon`. The retired `basic` and
`auto` values mean `oauth`.

## New data sources

- **ADSB.lol** (`api.adsb.lol/v2/point/…`): now the primary live-aircraft source.
- **OurAirports** (`davidmegginson.github.io/ourairports-data/`): airports,
  runways, frequencies, navaids. Public domain.

Both are documented in `DATA_SOURCES.md` → "v2 provider register", with doc
links and the date verified.

## Files

- **New:**
  - `server/providers/gateway/` (budget, registry, catalog, status routes)
  - `server/providers/aircraft/viewport.js` and `viewportRoute.js`
  - `server/providers/airports/`
  - `src/search/airportGeocoder.js`
  - `src/ui/systemStatus.js` and `src/ui/styles/system-status.css`
  - `eslint.config.mjs`, `tsconfig.json`, `CREDITS.md`
  - Tests in `src/gateway/`
- **Changed (existing modules extended, none replaced):**
  - flights layer: records, readout, query, ingestion, motion cap
  - live source contract, search chain and location search
  - OpenSky proxy (Basic auth removed)
  - User-Agents for Nominatim, Overpass and CelesTrak
  - setup doctor, templates, `package.json`, `.env.example`, `DATA_SOURCES.md`, `CHANGELOG.md`

**STOP.** Waiting for Rod to reply **GO** for Phase 2 (cockpit, frequencies,
aviation weather).
