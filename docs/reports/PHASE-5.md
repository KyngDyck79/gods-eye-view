# Phase 5 — Marine, transit, emergency facilities

**Date:** September 30, 2026 · **Branch:** `feature/gev-v2`

## Gate results

| Step | Result |
|---|---|
| `npm run lint` | Pass (0 errors; 491 inherited warnings) |
| `npm run typecheck` | Pass |
| `npm test` | Pass: 5,513 tests (5,512 pass, 1 skipped, 0 failures) |
| `npm run check:boundaries` | Pass |
| `npm run layer-token:check -- --base-ref origin/main` | Pass: 28 published, 4 new |
| `npm run format:check` | Pass |
| `npm run build` | Pass |

## "Done when" check

| Requirement | Result |
|---|---|
| Vessels appear with message age, or MARINE shows NEEDS KEY | **Met: NEEDS KEY.** No `AISSTREAM_API_KEY` is set, so `/api/providers` reports `aisstream NEEDS_KEY "AISSTREAM.IO NEEDS API KEY"` and the SYSTEM panel lists it. The key box in the app (paste AISSTREAM_API_KEY) is unchanged. With a key, every vessel card shows `POS: hh:mm:ssZ · AGE …` (unit-tested). |
| One test transit agency is documented | **Met.** WMATA Metrobus, in `config/transit-agencies.example.json` and `docs/TRANSIT-AGENCIES.md`. Checked live: the address answers 401 without a key and accepts the `api_key` header. Its terms were read and permit this use. A unit test confirms the example parses once `TRANSIT_KEY_WMATA` is set, and that the key never appears in the browser catalog. |

## Built

- **Emergency facilities**
  - The gateway (`server/providers/facilities/`) and the layer
    (`src/layers/emergencyFacilities/`) are new.
  - Live over Myrtle Beach: 8 fire stations, 4 police locations and South
    Strand Medical Center.
    - The first load took 15 s.
    - After that, the same area loads from the 7-day disk cache in about 1 ms.
- **Public Overpass instances**
  - overpass-api.de refused every request from this network, even its status
    page, with HTTP 406.
  - The layer falls back to VK Maps, which the OSM wiki lists as a public
    instance with "no requests limitations".
  - Set `FACILITIES_PUBLIC_OVERPASS=0` to use only your own `OVERPASS_UPSTREAMS`.
- **Transit config**
  - A config parser rejects, with a reason:
    - bad ids and non-https addresses;
    - keys placed in the address;
    - key variables not named `TRANSIT_KEY_…`;
    - forbidden header names;
    - duplicate ids.
  - A missing key reads `NEEDS KEY: add TRANSIT_KEY_WMATA=your-key to .env`.
  - Built-in feeds can't be overridden from config.
- **Marine**
  - Provider-register entry for aisstream.io.
  - Honest position age on vessel cards.

## Kept, not rewritten

- **The existing AIS relay.** It already holds the single aisstream socket on
  the server, watches for silence and backs off. It subscribes to the whole
  world by default, and `AISSTREAM_BOUNDING_BOXES` narrows it. Spec 3's
  "resubscribe per region on large pans" was **not** added: every
  resubscription reconnects aisstream's one-connection-per-key socket, and
  the relay's watchdog is built around keeping that connection stable.
- **The seven built-in transit feeds.** They stay in `src/data/transitFeeds.js`
  with their license passages. Config adds to them; it doesn't replace them.

## Deferred, and why

| Item | Why |
|---|---|
| Airspace layer | Optional in the spec ("if licensed data is available"). FAA airspace shapes are public, but I did not verify a stable download address and layer format in this pass, so nothing was wired. |
| Myrtle Beach (Coast RTA) transit | It is not in the Mobility Database catalog, so there is no public GTFS-Realtime feed to add. |
| Ports layer | Not in the Phase 5 scope list. OSM harbour tags could reuse the facilities gateway later. |

## Rod's 5-minute check

1. Restart the app (**Control + C**, then `npm run dev`).
2. Fly to Myrtle Beach. Open **Data Layers → Infrastructure → Emergency
   Facilities (OSM)**. Colored dots appear: red for hospitals, orange for fire,
   blue for police, white for ambulance, green for shelters. Click one for its
   name, phone and OSM link.
3. Click **SYSTEM** (bottom right). **aisstream.io** reads NEEDS KEY. To
   see ships, get a free key at <https://aisstream.io> and paste it into the
   AISSTREAM_API_KEY box in the app.
4. Optional: add WMATA by following `docs/TRANSIT-AGENCIES.md`.
