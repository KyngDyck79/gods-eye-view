# API keys

**The app works without any keys.** Keys add more data sources. They stay on
your Mac, in `~/gods-eye-view/.env`, and are never sent to the browser.

## The easy way: POWER UP

1. Start the app and click **POWER UP** (bottom right).
2. Paste each key into its box. The app writes it to `.env` for you.
3. Restart the app: **Control + C** in its Terminal, then `npm run dev`.

## The manual way

```bash
cd ~/gods-eye-view && open -e .env
```

Add or fill in the line (e.g. `TOMTOM_API_KEY=abc123`), save with
**Command + S**, close the window, and restart the app.

## Keys and what they unlock

| Setting in `.env` | Unlocks | Where to get it | Cost | In POWER UP? |
|---|---|---|---|---|
| `OPENSKY_CLIENT_ID` + `OPENSKY_CLIENT_SECRET` | OpenSky as a backup aircraft feed (ADSB.lol is the free default) | <https://opensky-network.org> → your account → **API client** | Free, 4,000 credits/day | Yes |
| `TOMTOM_API_KEY` | Traffic Incidents layer and real road speeds | <https://developer.tomtom.com> → sign up → *Keys* | Free: 2,500 incident requests/month (the app budgets 80/day) | Yes |
| `AISSTREAM_API_KEY` | Live ships (MARINE shows NEEDS KEY until set) | <https://aisstream.io> → sign in with GitHub → *API Keys* | Free (beta, no SLA) | Yes |
| `FIRMS_MAP_KEY` | NASA active-fire detections | <https://firms.modaps.eosdis.nasa.gov/api/map_key/> | Free | Yes |
| `CESIUM_ION_TOKEN` | Photorealistic 3D (personal, non-commercial) and Bing imagery | <https://ion.cesium.com> → *Access Tokens* | Free tier | Yes |
| `GOOGLE_MAPS_API_KEY` | Google photorealistic 3D tiles and place search | Google Cloud console → Map Tiles API | Metered; free monthly credit | Yes |
| `OPENAI_API_KEY` | OpenAI Realtime voice (opt-in engine) | <https://platform.openai.com/api-keys> | Paid per use | Yes |
| `AI_API_KEY` (+ `AI_PROVIDER`, `AI_MODEL`) | GOD's AI tier for free-form questions. Commands work without it. | Anthropic console or OpenAI platform | Paid per use; the app caps 500 turns/day | No, `.env` only |
| `TRANSIT_KEY_…` | Keyed transit agencies you add in `config/transit-agencies.json` | The agency's developer site; see [docs/TRANSIT-AGENCIES.md](docs/TRANSIT-AGENCIES.md) | Usually free | No, `.env` only |
| `WHISPER_SERVER_URL` | Local speech recognition (set to `http://127.0.0.1:8178`) | Built on your Mac by `npm run speech:setup`; see [VOICE-SETUP.md](VOICE-SETUP.md) | Free | No, `.env` only |
| `GEV_CONTACT_EMAIL` | Your email in the app's identifying User-Agent (NWS and others ask for a contact) | Your own email | — | No, `.env` only |
| `OVERPASS_UPSTREAMS` | A reliable OpenStreetMap server you run or pay for (road shapes, installations, facilities) | Optional | — | No, `.env` only |

### GOD's AI tier, example

Anthropic:

```
AI_PROVIDER=anthropic
AI_API_KEY=your-key
```

`AI_MODEL` defaults to `claude-sonnet-5-5`. For OpenAI, set
`AI_PROVIDER=openai`, `AI_API_KEY=your-key` and `AI_MODEL=` the model you
want.

## Checking your keys

Click **SYSTEM** (bottom right). Each provider shows ● ONLINE, DEGRADED,
RATE LIMITED, OFFLINE, NEEDS KEY or DISABLED, with its last success, last
error and budget use.

## Safety

- Never paste a key into a chat, email or screenshot.
- `.env` is excluded from git, so it never goes to GitHub.
- If a key leaks, delete it on the provider's site and make a new one.
