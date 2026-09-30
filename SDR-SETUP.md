# SDR setup: your own live ATC audio for KMYR

God's Eye View can play live air-traffic audio from **your own radio receiver**.
This is the one fully legitimate way to hear ATC *inside* the app. LiveATC is only
ever opened in its own tab, never embedded or re-streamed.

The chain looks like this:

```
Airband antenna → RTL-SDR dongle → RTLSDR-Airband (decodes AM)
  → Icecast (serves the audio on your home network)
  → God's Eye View (Settings: SOURCES → USER SDR)
```

Everything stays on your home network. Nothing is uploaded, recorded or shared.

---

## 1. Shopping list

| Item | Why | Notes |
|---|---|---|
| **RTL-SDR v4-class USB dongle** | The receiver | The RTL-SDR Blog V4 is a common choice. |
| **VHF airband antenna** | Air band is 118–137 MHz | A simple airband or discone antenna, mounted high and outdoors, works far better than the stick antenna in the box. |
| **Airband filter** *(optional)* | Blocks strong FM broadcast stations | Helps near FM transmitters. |
| **Airband LNA** *(optional)* | Boosts weak signals | Only if you need more range; too much gain makes things worse. |
| **Raspberry Pi 4 or 5** *(recommended)* | Runs the receiver 24/7 | RTLSDR-Airband's docs list macOS as "not thoroughly tested"; Linux on a Pi is the well-trodden path. |

One dongle hears about **2.56 MHz** of spectrum at once (RTLSDR-Airband's default
sample rate). KMYR's frequencies span 119.2–128.45 MHz, so one dongle can cover a
*group* of them, not all of them. See step 4.

---

## 2. Install RTLSDR-Airband

Follow the project's own install guide. Don't use copies from forums:

- Wiki: <https://github.com/rtl-airband/RTLSDR-Airband/wiki>
- Supported: Linux (including Raspberry Pi), FreeBSD; macOS works but is "not thoroughly tested".
- Install options: build from source ("Local Build") or Docker.

On the Mac, the RTL-SDR driver library is also available from Homebrew:

```bash
brew install librtlsdr
```

---

## 3. Install Icecast

Icecast serves the audio on your network. On the Mac:

```bash
brew install icecast
```

(On a Raspberry Pi, use its package manager, for example `sudo apt install icecast2`.)

In Icecast's configuration file, set **your own** passwords, replacing the example
ones. You'll use the *source* password in step 4.

---

## 4. Configure RTLSDR-Airband for KMYR

Frequencies below are from the OurAirports dataset as used by the app on
2026-09-29. **Frequencies change: check the current FAA Chart Supplement before
relying on them.**

| Facility | MHz |
|---|---|
| Approach / Departure | 119.2 |
| Clearance Delivery | 119.7 |
| Ground | 120.3 |
| ATIS | 123.925 |
| Tower / CTAF | 128.45 |

**One dongle, three channels (Approach/Departure, Clearance, Ground),** centred on
119.75 MHz (all within 2.56 MHz). The syntax follows RTLSDR-Airband's wiki
("Configuring RTLSDR devices", "Configuring channels for multichannel mode",
"Configuring Icecast outputs"):

```
devices:
({
  type = "rtlsdr";
  index = 0;
  gain = 25.0;
  centerfreq = 119.75;
  mode = "multichannel";
  channels:
  (
    {
      freq = 119.2;
      label = "KMYR APP/DEP";
      outputs: ( {
        type = "icecast";
        server = "127.0.0.1";
        port = 8000;
        mountpoint = "kmyr-app.mp3";
        username = "source";
        password = "YOUR-ICECAST-SOURCE-PASSWORD";
      } );
    },
    {
      freq = 119.7;
      label = "KMYR CLNC";
      outputs: ( {
        type = "icecast";
        server = "127.0.0.1";
        port = 8000;
        mountpoint = "kmyr-clnc.mp3";
        username = "source";
        password = "YOUR-ICECAST-SOURCE-PASSWORD";
      } );
    },
    {
      freq = 120.3;
      label = "KMYR GND";
      outputs: ( {
        type = "icecast";
        server = "127.0.0.1";
        port = 8000;
        mountpoint = "kmyr-gnd.mp3";
        username = "source";
        password = "YOUR-ICECAST-SOURCE-PASSWORD";
      } );
    }
  );
});
```

**Tower (128.45) needs a second dongle** (`index = 1`) with `centerfreq = 128.45`
and one channel, or RTLSDR-Airband's *scan* mode. See the wiki's "scan mode" page.

Tune `gain` for your antenna: RTLSDR-Airband suggests 20–40 dB. If you hear
constant hiss, lower the gain or raise the squelch per the wiki.

---

## 5. Add the stream to God's Eye View

1. Find the address of the computer running Icecast. On the Mac: **System
   Settings → Wi-Fi → Details → IP address** (for example `192.168.1.20`). If
   Icecast runs on this same Mac, use `127.0.0.1`.
2. In God's Eye View, open cockpit mode on any aircraft, open the **ATC** page in
   the briefing panel, and click **SOURCES**.
3. Fill in:
   - **Name:** `KMYR Ground (my SDR)`
   - **Stream address:** `http://192.168.1.20:8000/kmyr-gnd.mp3`
   - **Type:** `USER SDR`
   - **Airport:** `KMYR` · **Frequency:** `120.3`
4. Click **ADD SOURCE**. Repeat for each mount.
5. On the ATC page, pick the source and click **LISTEN**.

The status line tells you exactly what's happening:

| Status | Meaning |
|---|---|
| CONNECTING | The app is opening your stream. |
| **LIVE AUDIO** | Audio is playing **and** a transmission was heard in the last 15 s. |
| USER SOURCE · no transmission heard | Playing, but the frequency has been quiet (squelch closed). Normal between calls. |
| STREAM ERROR | The stream couldn't be opened; check that Icecast and RTLSDR-Airband are running. |
| NO AUDIO SOURCE | Nothing is playing. |

Streams on your home network play through the app's local relay, which lets the
app measure real activity. The relay only ever connects to addresses on your own
network, only passes audio, and records nothing.

---

## 6. Keep it on your network

Streams stay on your local network by default. **Before sharing any stream
publicly, check the rules that apply to you.** Rebroadcasting air-traffic audio
is regulated differently from place to place, and some services forbid it.

## Troubleshooting

| Problem | Try |
|---|---|
| STREAM ERROR right away | Open the stream address in a browser on the Mac. If it doesn't play there, the problem is Icecast or RTLSDR-Airband, not the app. |
| Only hiss | Lower `gain`; check the antenna connection; add an FM-blocking airband filter. |
| Never shows LIVE | The frequency may just be quiet, especially late at night. Try Ground during the day. |
| Can't add the source ("must be on your own network") | USER SDR addresses must be `127.0.0.1`, `192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`, `localhost` or a `.local` name. |
