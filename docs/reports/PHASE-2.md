# Phase 2 — Cockpit, frequencies, aviation weather

**Date:** September 30, 2026 · **Branch:** `feature/gev-v2`

## Gate results

| Step | Command | Result |
|---|---|---|
| Lint | `npm run lint` | Pass: 0 errors (491 inherited warnings, unchanged) |
| Typecheck | `npm run typecheck` | Pass |
| Unit tests | `npm test` | Pass: 5,461 tests (5,460 pass, 1 skipped, 0 failures); 5,420 after Phase 1 |
| Boundaries | `npm run check:boundaries` | Pass |
| Formatting | `npm run format:check` | Pass |
| Build | `npm run build` | Pass |
| Run | dev server on a spare port, real aircraft, checked in a browser | Pass; see below |

## "Done when" check

> Selecting an aircraft near KMYR shows, in cockpit mode, the facility,
> frequency, confidence, reason, and METAR/TAF.

- **Engine, against live data.** For an aircraft 6 nm south of KMYR,
  descending through 2,400 ft AGL and lined up with runway 36, the live
  gateway answered:
  `Descending through 2,400 ft AGL, 6.0 nm south of KMYR, aligned with RWY 36 → Tower 128.45 (HIGH)`.
  It returned KMYR's current METAR (VFR, 7 minutes old) and the KMYR TAF.
- **Cockpit, in the browser.** It was after midnight, so nothing was flying
  near KMYR. I used the nearest real aircraft instead. Examples the ATC page
  showed:
  - **N801KC**, near Camden, SC: KCUB, runway 31, APPROACH 133.4, LOW
    confidence, reason "Level at 5,657 ft AGL, 4.4 nm east of KCUB", METAR
    (VFR, decoded and raw) and the full KCUB TAF.
  - **AAL2008 at FL370**: EN ROUTE (CENTER), frequency "NOT IN DATASET",
    reason "At 37,000 ft, above FL180 → En-route (Center) frequency not in
    dataset". The nearest airport and its weather still show.
- **Rod's own check** (steps below) is best done in the daytime, when there
  is traffic at KMYR.

## What was built

- **Frequency engine** (`server/providers/airports/frequencyEngine.js`,
  `/api/airports/frequency`). It follows spec 4.6 step by step:
  - picks a candidate within 60 nm, preferring the plausible-route
    destination when descending and the origin when climbing;
  - works out the flight phase using height above the airport;
  - checks runway alignment within 10 nm (±15°);
  - returns the facility, frequency, confidence, a plain reason and ATIS.

  All frequencies come from OurAirports, and OurAirports' "A/D" entries count
  as approach and departure. A scenario table covers ground, clearance,
  takeoff, departure, en route, approach, final and a non-towered field (18
  tests).
- **AviationWeather.gov** (`server/providers/aviationWeather/`,
  `/api/avwx/metar|taf|nearest`):
  - uses the official cache files with ETag, never per-station queries;
  - fetches only while someone is looking: METAR at most every 90 s, TAF at
    most every 10 min;
  - decodes METARs into wind, visibility, ceiling (lowest BKN/OVC/VV),
    temperature, dewpoint, altimeter and flight category, and TAFs into
    forecast periods, with the raw text kept;
  - tests run against recorded real files in `tests/fixtures/awc/`, with the
    capture date in the README there.
- **Cockpit ATC page:** a fourth briefing page (tab "ATC"). If the page is
  collapsed, click its expand button. It shows:
  - nearest airport and runway
  - facility, frequency and confidence, labeled ESTIMATE, with the reason
  - ATIS
  - METAR, decoded, raw and with its age; STALE after 90 minutes
  - the TAF
  - ATC AUDIO controls
- **AudioBus** (`src/audio/audioBus.js`). Any audio producer must claim the
  bus to play, and a claim stops the previous one, so only one stream plays
  at a time. Radio now claims and releases it. MUTE and VOLUME on the ATC
  page are the bus's controls.

## Found and fixed during live testing

- **False runway alignment at altitude.** An airliner 14,000 ft above a small
  field was reported as "aligned with RWY 04". Alignment now counts only below
  5,000 ft AGL, and terminal-area guesses from 10,000 ft AGL or higher are LOW.
  A regression test was added.
- **Two AWC file quirks, both verified across the whole file:**
  - the `vert_vis_ft` column is in hundreds of feet despite its name (VV007
    becomes 7);
  - variable wind (`VRB05KT`) is written as direction 0.

  Both are now handled correctly.
- **Briefing panel overflow.** A fourth tab made the panel's content wider
  than its window, clipping the right edge. The panel now has a single
  column that can't outgrow the window.
- **Small fields with no METAR.** The page now shows the nearest reporting
  station's METAR within 30 nm, named, in the form
  "Nearest report, {station} ({distance} nm from {airport}): …". This
  fallback isn't unit-tested yet.

## Disabled or deferred, and why

| Item | Status | Why |
|---|---|---|
| ATC audio playback | Controls present; status reads NO AUDIO SOURCE | Audio sources (your SDR stream, user URLs, the LiveATC link) are Phase 3. LISTEN stays disabled until a source exists. |
| LIVE detection (AnalyserNode) | Phase 3 | Needs a real stream to test against. |
| SIGMET, G-AIRMET, PIREP, CWA | Not yet | Phase 2 scope was METAR/TAF. They belong to the weather work in Phase 4. |
| Center (ARTCC) frequencies | Not available | OurAirports has none. The app says so instead of guessing, as the spec requires. |
| ATC page opening automatically | Not added | It's the fourth page. Auto-cycling shows it every 36 s, or click the ATC tab. |
| Cockpit entry | Unchanged app rule | The existing app only offers cockpit mode when the Flights and Military layers are on and the Contacts context mode is selected. |

## How Rod can check it in 5 minutes

1. **Restart the app so it runs the new code.** In the Terminal window
   running it, press **Control + C**, then run these two commands, pressing
   **Return** after each:

   ```bash
   cd ~/gods-eye-view
   ```

   ```bash
   npm run dev
   ```

2. **Open the Grand Strand** (daytime, when there's traffic):
   `http://localhost:4173/#v=2&lat=33.68&lon=-78.93&alt=60000&heading=0&pitch=-80&roll=0&map=esri-imagery&l=f.m`
3. **Pick an aircraft.** Click one near Myrtle Beach International.
4. **Turn on cockpit mode.** On the right, open **CONTEXT** and click
   **CONTACTS**. Then click the cockpit button that appears.
5. **Open the ATC page.** In the briefing panel (bottom right), click the
   **ATC** tab. You should see KMYR (or the nearest airport), a runway, a
   facility and frequency with confidence and reason, and KMYR's METAR and
   TAF.

## New environment variables

None.

## New data sources

- **AviationWeather.gov** (NOAA/NWS), METAR and TAF cache files. Documented in
  `DATA_SOURCES.md` → "v2 provider register", in `CREDITS.md`, and under
  **SYSTEM** in the app.

**STOP.** Waiting for Rod to reply **GO** for Phase 3 (ATC audio, traffic,
cameras).
