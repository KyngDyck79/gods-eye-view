# Phase 7 — GOD assistant

**Date:** September 30, 2026 · **Branch:** `feature/gev-v2`

## "Done when" check

| Requirement | Result |
|---|---|
| Every 4.19 example command works from real data | **Met.** Each was run live in the app on September 30, 2026; results are below. |
| The "not available" phrase is verified | **Met.** Unit test: a tier-2 turn whose tools return nothing produces exactly "That information is not currently available from the connected data sources." Live: with no AI key, a free-form question returns exactly "AI assistant not configured — add an AI key in Settings → AI." |

### Live results (tier 1, no AI key)

| Command | GOD's answer (abridged) |
|---|---|
| nearest airport (Myrtle Beach) | Myrtle Beach International Airport (KMYR), 2.1 nm south-west. Source: OurAirports. |
| weather here | KMYR (2 nm from the map center), observed 17 minutes ago: wind 120° at 7 kt, visibility 10+ SM, no ceiling, 28.3 °C … VFR. No NWS alerts in effect at this point. |
| weather at KMYR | KMYR (at Myrtle Beach International Airport), observed 19 minutes ago: … |
| show severe weather | Weather warnings on. No NWS warning areas in view (US only), updated 15 seconds ago. |
| which ATC frequency (nothing tracked) | No aircraft is tracked, so here is the nearest airport, KMYR: Tower 128.45, Ground 120.3, Approach 119.2, ATIS 123.925 (OurAirports). |
| track UAL130 | Tracking UAL130 · 37000 ft · 560 kt · position 41 seconds ago |
| what's that plane | Same fields. Spoken as: "That's United one three zero, at thirty-seven thousand feet, as of forty-one seconds ago." |
| which ATC frequency (tracking UAL130) | At 37,000 ft, above FL180 … → En-route (Center) frequency not in dataset. This is honest: OurAirports has no Center frequencies. |
| open cockpit | Cockpit open. |
| show hospitals near Myrtle Beach | Showing Emergency Facilities (OSM) near Myrtle Beach, South Carolina, United States. |
| cameras near KMYR | No traffic cameras within 50 km of Myrtle Beach International Airport (KMYR) in the connected camera sources. The nearest camera in the app is US 13 @ DE 24, 621 km away. |
| cameras near Austin | 484 cameras within 50 km of Austin. Showing CONGRESS AVE / 11TH ST (0.2 km). |
| open ATC source | Played the user receiver saved in this browser; your own sources rank first. With only LiveATC available, it opens LiveATC's page in a new tab (unit-tested). |
| toggle earthquakes (twice) | Earthquakes (24h) on. / Earthquakes (24h) off. |

## Found and fixed while testing

- **"cameras near KMYR" used to fly to an Austin camera about 1,700 km away**
  and call it nearby. It now checks within 50 km first and reports the
  distance to the nearest camera.
- **"nearest airport" returned a hospital heliport** in Austin. It is now
  limited to large, medium and small airports.
- **"show hospitals near Charleston" failed** because both public Overpass
  instances were unavailable: overpass-api.de refuses this network (406), and
  VK Maps timed out with 504. The layer can't turn on without data, and GOD
  now gives the layer's own reason: "FACILITY DATA TEMPORARILY UNAVAILABLE".
  For a reliable source, set `OVERPASS_UPSTREAMS` to an instance you run or
  pay for.

## Built

| Module | What it is |
|---|---|
| `src/god/parser.js` | Tier-1 parser |
| `src/god/god.js` | Handlers, the tier-2 loop and the system rules |
| `src/god/tools.js` | Context: view center and box, tracked aircraft, active layers, open alerts. Also the 16 spec tools. |
| `src/ui/godPanel.js` | Console and debug drawer |
| `server/providers/ai/index.js` | Provider-agnostic AIProvider for the Anthropic Messages API and OpenAI Chat Completions. The key stays on the server; the route answers this Mac only; budget of 20 turns per minute and 500 per day. |

Voice and the console share one action runner.

## Not verified live

- **Tier 2 against a real AI provider**, because no `AI_API_KEY` is set. The
  request and response formats for both providers are unit-tested, including
  sending tool results back to the model and keeping the key out of every
  reply.

## Gate results

| Step | Result |
|---|---|
| `npm run lint` | Pass (0 errors; 491 inherited warnings) |
| `npm run typecheck` | Pass |
| `npm test` | Pass: 5,541 tests (5,540 pass, 1 skipped) |
| `npm run check:boundaries` | Pass |
| `npm run format:check` | Pass |
| `npm run build` | Pass |
