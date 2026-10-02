# Phase 4 — Earth, radar, severe weather, satellites, alerts

**Date:** September 30, 2026 · **Branch:** `feature/gev-v2`
Rod asked to finish all remaining phases without stopping at each gate.

## Gate results

| Step | Result |
|---|---|
| `npm run lint` | Pass (0 errors; 491 inherited warnings) |
| `npm run typecheck` | Pass |
| `npm test` | Pass: 5,504 tests (5,503 pass, 1 skipped, 0 failures) |
| `npm run check:boundaries` | Pass |
| `npm run layer-token:check -- --base-ref origin/main` | Pass: 28 published, 3 new |
| `npm run format:check` | Pass |
| `npm run build` | Pass |

## "Done when" check

| Requirement | Result |
|---|---|
| Radar loop shows timestamps | **Met by the existing app.** The Weather panel's history clock plays the radar loop and shows each frame's UTC time. Kept as is (decision 5A). |
| Warning polygons render | **Met.** Weather Warnings (NWS) drew 4 real flood-warning areas near St. Joseph, MO, in the NWS flood-warning color. The share link gained token `3`. |
| ISS track appears | **Met by the existing app.** The Satellites layer draws the ISS orbit path by default and predicts passes. |
| Alert feed works | **Met.** The ALERTS feed showed a real, timestamped alert ("ADSB.lol is offline · Timed out"), later marked cleared when ADSB.lol recovered. The squawk, NWS, earthquake and de-duplication rules are covered by 6 unit tests. There were no tornado or thunderstorm warnings to observe live. |

## Built

- **NWS provider**
  - National active alerts fetched at most every 90 s, with a User-Agent that includes your contact.
  - View queries return polygon alerts.
  - Point queries use NWS's own zone-aware lookup.
  - Official hazard colors from weather.gov/help-map.
  - Tests use a recorded fixture.
- **EONET provider and layer.** Tests use a recorded fixture.
- **USGS route** for the alerts engine.
- **Alerts engine** (`src/alerts/engine.js`)
  - Neutral wording for squawks, and codes are noted as possibly set in error.
  - Voice readout at most once per alert.
- **ALERTS feed UI.** Per-rule ON and VOICE switches, and earthquake magnitude and radius settings, remembered in this browser.

## Deferred, and why

| Item | Why |
|---|---|
| RainViewer global radar (≤ zoom 7) | The US radar already works (NOAA MRMS). Adding a second radar renderer means extending the weather layer's tile pipeline; left for a later pass. |
| NASA GIBS satellite layers | The existing satellite-cloud layer (NOAA nowCOAST) covers the need. |
| Earthquake feed and filter controls on the existing layer | That layer still shows the past-day M2.5+ feed. Magnitude and radius filtering is in the alerts rules. |
| Storm list panel sorted by severity and proximity | NWS alerts come back most-severe first and appear in the ALERTS feed, but there is no separate storm list panel yet. |
| Zone-only NWS alerts on the map | They need zone outlines, which aren't fetched. They are included in point lookups. |
| A saved "home location" for alerts | Alerts use the current view. A home location comes with Settings later. |
| Satellites via OMM JSON in a Web Worker | The existing satellites code works (TLE, main thread). Moving propagation into a worker is part of the Phase 8 performance work. |

## Rod's 5-minute check

1. Restart the app (**Control + C**, then `npm run dev`).
2. **Data Layers → Weather → Weather Warnings (NWS)**, then pan to any
   highlighted area in the US.
3. **Data Layers → Events → Natural Events**. Wildfire and storm markers appear.
4. Click **ALERTS** (top right). Open **Rules** to switch rules and voice on
   or off.
