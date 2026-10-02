# Setup and launch

God's Eye View runs on your Mac mini. A small server on the Mac holds your
keys and talks to the data providers. You use the app in **Google Chrome** at
`http://localhost:4173`.

For each command below, paste it into **Terminal** (Spotlight: press
**Command + Space**, type `Terminal`, press **Return**) and press **Return**.

## First time only

1. **Check the tools.** This should print `v24` or later:

   ```bash
   node --version
   ```

   If it says `command not found` or a lower number, install Node from
   <https://nodejs.org> (choose the 24 LTS installer), then open a new
   Terminal window. If `git` is missing, macOS offers to install it the
   first time you use it; click **Install**.

2. **Get the code.** Your copy lives at `~/gods-eye-view`. If it isn't there
   yet:

   ```bash
   git clone https://github.com/KyngDyck79/gods-eye-view.git ~/gods-eye-view
   ```

3. **Install the app's parts:**

   ```bash
   cd ~/gods-eye-view
   ```

   ```bash
   npm ci
   ```

4. **Check everything is ready.** The doctor tells you exactly what, if
   anything, to fix:

   ```bash
   npm run doctor
   ```

5. **Create your settings file** (only if `.env` doesn't exist yet):

   ```bash
   cp -n .env.example .env
   ```

   Then add your keys; see [API-KEYS.md](API-KEYS.md). The easiest way is
   the **POWER UP** button inside the app.

## Every time: start the app

```bash
cd ~/gods-eye-view
```

```bash
npm run dev
```

Then open **http://localhost:4173** in Chrome. Leave the Terminal window
open while you use the app. To stop, click that Terminal window and press
**Control + C**.

For voice, also start the speech server in a second Terminal window (see
[VOICE-SETUP.md](VOICE-SETUP.md)):

```bash
cd ~/gods-eye-view && npm run speech
```

## Updating to the newest version

```bash
cd ~/gods-eye-view
```

```bash
git pull
```

```bash
npm ci
```

Then start the app as usual.

## Where things are

| What | Where |
|---|---|
| Your keys and settings | `~/gods-eye-view/.env` (never shared; not in git) |
| Your transit agencies | `~/gods-eye-view/config/transit-agencies.json` ([docs/TRANSIT-AGENCIES.md](docs/TRANSIT-AGENCIES.md)) |
| Cached map data | `~/gods-eye-view/.gev-cache/` (safe to delete) |
| Your ATC sources, alert rules, voice settings | In Chrome's storage for this site only |

## Other guides

- [API-KEYS.md](API-KEYS.md): which keys unlock what, and where to get them
- [VOICE-SETUP.md](VOICE-SETUP.md): your Galaxy S23 Ultra as the microphone
- [SDR-SETUP.md](SDR-SETUP.md): your own live ATC receiver
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md): when something doesn't work
- [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md): what isn't available, and why
- [DATA_SOURCES.md](DATA_SOURCES.md): every data provider, its license and limits
