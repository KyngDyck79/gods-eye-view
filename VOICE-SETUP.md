# Voice setup: Galaxy S23 Ultra microphone → God's Eye View

You speak into your **Galaxy S23 Ultra**. Its microphone is streamed over
Wi-Fi to your Mac mini by **AudioRelay**, which plays it into **BlackHole 2ch**,
a virtual device. God's Eye View listens to BlackHole 2ch. Speech is turned
into text by **whisper.cpp** running on your Mac, so your audio never leaves
it.

```
Galaxy S23 Ultra → AudioRelay (phone: Server → Microphone) → Wi-Fi
→ AudioRelay on Mac (Player → output device: BlackHole 2ch)
→ BlackHole 2ch (appears as an input device)
→ God's Eye View (microphone: BlackHole 2ch)
→ local speech server (whisper.cpp) → GOD
```

AndroidMic is not needed.

## One-time setup

For each command, paste it into **Terminal** and press **Return**.

1. **Install BlackHole 2ch.**

   ```bash
   brew install blackhole-2ch
   ```

   You can also use the installer from <https://existential.audio/blackhole/>.
   If BlackHole 2ch doesn't appear in the steps below, restart the Mac.
2. **Install AudioRelay on the Mac and on the phone.** On the Mac:

   ```bash
   brew install --cask audiorelay
   ```

   (or download it from <https://www.audiorelay.net>). On the S23 Ultra,
   install **AudioRelay** from Google Play. If macOS asks to install Rosetta
   when AudioRelay first opens, click **Install**.
3. **Put the phone and the Mac on the same Wi-Fi network.**
4. **On the phone:** open AudioRelay → **Server** tab → under *Sources*, tap
   **Microphone** → allow microphone permission.
5. **On the Mac:** open AudioRelay → **Player** tab → set the output device to
   **BlackHole 2ch** → click your phone in the server list.
6. **Keep the Mac's sound output on your speakers or headphones, not
   BlackHole.** Otherwise GOD hears its own replies. Check under System
   Settings → Sound → Output. The Voice settings panel also warns you if the
   output is BlackHole.
7. **Allow the browser to use the microphone:** System Settings → Privacy &
   Security → Microphone → turn on **Google Chrome** (or Safari).
8. **Build the local speech server.** This takes a few minutes and downloads
   the English speech model (about 150 MB):

   ```bash
   brew install cmake
   ```

   ```bash
   cd ~/gods-eye-view
   ```

   ```bash
   npm run speech:setup
   ```

   Homebrew's own `whisper-cpp` package leaves the server out, so this
   script builds it from the official source into `~/whisper.cpp`.
9. **Tell the app where the speech server is.** Open your settings file:

   ```bash
   open -e .env
   ```

   Add this line at the bottom, then save (**Command + S**) and close the
   window:

   ```
   WHISPER_SERVER_URL=http://127.0.0.1:8178
   ```

## Every time you want voice

1. **Start the speech server.** Open a new Terminal window with
   **Command + N**, then run:

   ```bash
   cd ~/gods-eye-view
   ```

   ```bash
   npm run speech
   ```

   Leave that window open.
2. **Start the app** in another Terminal window, as usual:

   ```bash
   npm run dev
   ```

3. **Connect the phone.** In AudioRelay on the phone, make sure *Microphone*
   is streaming. On the Mac, AudioRelay's **Player** should be connected, with
   output **BlackHole 2ch**.
4. **Pick the microphone.** In God's Eye View, click **SET** on the voice
   control at the bottom center. This opens **Voice Settings**.
   1. Under *Microphone*, choose **BlackHole 2ch**. It is preselected once
      the browser has microphone permission; click **ALLOW MICROPHONE TO
      LIST DEVICES** the first time.
   2. Click **TEST MICROPHONE** and speak into the phone. **The meter must
      move.** Your 3 seconds play back, with the peak level.
5. **Only if you chose the Web Speech engine:** set System Settings → Sound →
   Input → **BlackHole 2ch**. That engine listens to the macOS default input,
   and the browser may send audio to its maker's servers.
6. **Check it's online.** *Speech server* in Voice Settings reads **●
   ONLINE**, and **SYSTEM** (bottom right) lists *Local speech server* as
   ONLINE.
7. **Talk.** Click the mic button to turn voice on. Then **hold Space** (or
   hold **HOLD TO TALK**) and speak, and let go to send. A red **● LISTENING**
   shows at the top of the screen whenever audio is being captured. Your
   words appear as `HEARD: "…"`.

## From your phone (Android or iPhone)

Phone browsers only allow the microphone on **https** pages. `http://192.168…`
is not enough. Tailscale gives your Mac a private https address:

1. Install Tailscale on the Mac, open it from Applications, and sign in:

   ```bash
   brew install --cask tailscale-app
   ```

2. Install **Tailscale** on the phone (Play Store or App Store) and sign in
   with the **same** account. Turn it on.
3. In a browser, open <https://login.tailscale.com/admin/dns> and turn on
   **HTTPS Certificates** (MagicDNS must be on too).
4. Give the app an https address. This keeps working after restarts:

   ```bash
   /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=443 localhost:4173
   ```

   It prints your address, like `https://mac-mini.tail1234.ts.net`.
5. Tell the app the phone is yours. Add this line to `.env` with your
   Tailscale login (shown in the Tailscale menu-bar icon), then restart the
   app with `npm run dev`:

   ```
   GEV_OWNER_LOGINS=you@example.com
   ```

6. On the phone, open that https address. Tap **MORE → VOICE SETTINGS**,
   then **ALLOW MICROPHONE TO LIST DEVICES**, and allow it. Run **TEST
   MICROPHONE**: the meter must move.
7. Choose the **Engine**:
   - **Local speech server**: needs `npm run speech` running on the Mac
     (setup above). The audio goes only from your phone to your Mac, over
     Tailscale's encrypted connection.
   - **Browser speech recognition**: works right away, with nothing on the
     Mac. Google processes the audio.

   Reload the page after changing the engine.
8. Turn **Voice response** on to hear GOD's answers through the phone.

Then tap **VOICE** (bottom center) to turn voice on. With the local engine,
**hold** VOICE while you talk and let go to send. With browser speech, just
talk. GOD answers out loud.

Friends you share the Mac with can open the https address too, but voice and
AI answer only your login.

## Voice Settings reference

| Setting | What it does |
|---|---|
| Engine | **Local speech server** (default; audio stays on the Mac), **Browser speech recognition** (Web Speech), or **OpenAI Realtime** (opt-in; audio goes to OpenAI; needs `OPENAI_API_KEY`). Takes effect after you reload the page. |
| Microphone | Any input device. BlackHole 2ch is chosen automatically when present. |
| Input level / Show level | Live meter from the selected microphone. |
| Test microphone | Records 3 seconds on this Mac, plays it back and shows the peak level. Nothing is uploaded or saved. |
| Noise suppression | The browser's noise suppression, on or off. |
| Voice activation | Listens continuously and sends each spoken phrase when you pause. Speech is detected on this Mac. |
| Push to talk | Hold Space, or hold **HOLD TO TALK**. |
| Wake phrase | Off by default. When on, only phrases that start with it (e.g. "hey god, track Delta 45") are acted on. Checked on this Mac. |
| Voice response, volume, speed, voice | Spoken replies use your Mac's own voices. No paid service. |
| Flight levels | Says "flight level three four zero" instead of "thirty-four thousand feet" above 18,000 ft. |

## Troubleshooting

| Problem | Fix |
|---|---|
| **The meter doesn't move** | In AudioRelay on the Mac, check the Player is connected and its output is **BlackHole 2ch**. On the phone, check *Microphone* is streaming and not muted. In Voice Settings, check the microphone is **BlackHole 2ch**. |
| **The phone isn't listed in AudioRelay on the Mac** | Put both on the same Wi-Fi (not a guest network). Turn off VPNs. Reopen AudioRelay on both. Allow AudioRelay through the macOS firewall if asked. |
| **Echo, or GOD answers itself** | Set System Settings → Sound → Output to your speakers or headphones, never BlackHole. Headphones are best. The app also mutes capture while GOD is speaking. |
| **High latency** | Keep the phone and Mac close to the router. In AudioRelay, choose a lower-latency / smaller buffer setting. For speed, `base.en` beats `small.en`. |
| **"MICROPHONE UNAVAILABLE — permission denied"** | Click the padlock / site settings in the address bar → Microphone → Allow. Also check System Settings → Privacy & Security → Microphone → Chrome is on. Then reload. |
| **"MICROPHONE UNAVAILABLE — the selected microphone is not connected"** | BlackHole isn't installed or was removed. Reinstall it (step 1 of setup) and restart the Mac. |
| **"Speech server not answering"** | Start it with `npm run speech` and leave that window open. |
| **"SPEECH SERVER NOT SET UP"** | Add `WHISPER_SERVER_URL=http://127.0.0.1:8178` to `.env` (setup step 9) and restart the app. |
| **"WHISPER_SERVER_URL must be on this Mac"** | The address must start with `http://127.0.0.1:` or `http://localhost:`. Other computers are refused so audio stays on this Mac. |
| **"The speech server is not built yet"** | Run `npm run speech:setup` first. |
