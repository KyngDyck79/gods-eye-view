# Adding a transit agency

The Transit layer ships with seven agencies built in: MBTA, CapMetro, Metro
Transit, HSL, OVapi, Entur and TransLink. You add your own in
`config/transit-agencies.json`. It starts empty, and nothing else in the code
needs to change.

An agency needs a **GTFS-Realtime VehiclePositions** feed (a `.pb` address).
Most US agencies list theirs on their "developers" or "open data" page.
<https://mobilitydatabase.org> lists thousands.

Before adding a feed, read the agency's terms and confirm they allow showing
their vehicles in your own app.

## Worked example: Washington, DC Metrobus (WMATA)

Checked September 30, 2026:
- The address below answers "401 missing subscription key" without a key.
- It recognizes a key sent in the `api_key` header.
- WMATA's Transit Data Terms of Use grant a license to use the data "within
  your Application".
- You may not say or imply that WMATA endorses the app.
- Default-tier limits are 10 calls a second and 50,000 a day. The app polls
  about 4 times a minute while the layer is on and you are looking at DC.

1. **Get a free key.** Go to <https://developer.wmata.com>, click **Sign up**,
   confirm your email and sign in. Click **Products → Default Tier →
   Subscribe**. Open **Profile**, click **Show** next to the *Primary key*,
   and copy it.
2. **Put the key in `.env`.** In Terminal:

   ```bash
   cd ~/gods-eye-view
   ```

   ```bash
   open -e .env
   ```

   Add this line at the bottom, paste your key after the `=`, then save
   (**Command + S**) and close the window:

   ```
   TRANSIT_KEY_WMATA=
   ```

3. **Add the agency.** Open the config file:

   ```bash
   open -e config/transit-agencies.json
   ```

   Replace everything in it with the contents of
   `config/transit-agencies.example.json`. Keep the `"agencies": [ … ]` part
   with the WMATA entry. Save and close.
4. **Restart the app.** In the Terminal window running it, press
   **Control + C**, then run:

   ```bash
   npm run dev
   ```

   If the key is missing, Terminal prints
   `[transit] agency #1 (wmata-bus): NEEDS KEY: add TRANSIT_KEY_WMATA=your-key to .env`.
5. **Look.** Fly to Washington, DC. Open **Data Layers → Movement → Transit**.
   Buses appear, credited to WMATA.

## Fields

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Lowercase letters, digits and hyphens, e.g. `coast-rta` |
| `name` | yes | Short name shown in the app |
| `operator`, `region` | no | Longer names for the credit and status line |
| `center` | yes | `{ "lat": …, "lon": … }`, roughly the middle of the service area |
| `loadRadiusKm` | yes | Polls only while the view is within this distance of `center` (1–1000) |
| `vehiclePositionsUrl` | yes | The GTFS-RT VehiclePositions address. Must start with `https://`. |
| `keyHeader` | if keyed | The header name the agency wants the key in, e.g. `api_key`, `x-api-key` |
| `keyEnv` | if keyed | The `.env` variable holding the key. Must start with `TRANSIT_KEY_`. |
| `defaultMode` | no | `bus`, `tram`, `subway`, `rail` or `ferry` (default `bus`) |
| `license`, `attribution` | yes | Copied from the agency's terms. Shown in the app. |
| `licenseUrl` | no | Link to those terms |
| `enabled` | no | `false` switches an entry off without deleting it |

Keys never go in this file and never reach the browser. The server attaches
them.

## Myrtle Beach (Coast RTA)

Coast RTA has a bus-tracking app. As of September 30, 2026, though, it has no
public GTFS-Realtime feed in the Mobility Database catalog
(<https://files.mobilitydatabase.org/feeds_v2.csv>), so it is not added. The
South Carolina agencies listed there with a vehicle-positions feed are CARTA
(Charleston, `mdb-1737`) and Greenlink (Greenville, `tld-2266-vp`). Look up
their current address and terms on mobilitydatabase.org, then add them as
above.
