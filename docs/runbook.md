# SahurHub Raspberry Pi 5 Runbook

## Overview

SahurHub is a deliberately useless but working task-reminder IoT companion. Sahur is the on-panel character: a phone conversation can capture a task from normal language, then Sahur follows up with reminders and escalating knock reactions.

The production Qwen path is chained: `qwen3-asr-flash` → `qwen3.6-flash` → `qwen3-tts-flash`. Speech is transcribed, the reply and task tag are generated, then the clean reply is spoken. Task capture is part of that same chat generation; it does not need an explicit add-task command or a second classifier call.

| Hardware                                           | Purpose                                   |
| -------------------------------------------------- | ----------------------------------------- |
| Raspberry Pi 5                                     | Device host                               |
| Official Pi 5 PSU                                  | Required stable demo power                |
| Genuine Waveshare 3.5-inch RPi LCD (A) Rev4.0, SPI | ILI9486 + XPT2046 panel; upright portrait |
| USB speaker                                        | Device-side audio output                  |
| SD card                                            | Raspberry Pi OS boot media                |
| Phone hotspot                                      | Demo network and phone remote access      |

Do not add a microphone or camera module for the MVP: the phone webapp supplies text, push-to-talk audio, and uploads.

## Flashing The Pi

1. In Raspberry Pi Imager, select **Raspberry Pi OS Bookworm 64-bit (Desktop)** and write it to the SD card.
2. In Imager OS customization, set hostname `sahurhub`, enable SSH, add Wi-Fi credentials, and choose the correct locale and keyboard.
3. Use the official Pi 5 PSU for demos. Boot with the LCD attached, then verify power with `vcgencmd get_throttled` (`0x0` is clean).
4. Boot the Pi, complete any first-login prompts, and use SSH or a local terminal to continue.

### Power And Panel Seating

- A 45W USB-C PD power bank without a 5V/5A profile can show the red LED but fail to boot with the LCD attached. Use wall power only for demos.
- A mis-seated LCD HAT can prevent boot entirely: red LED, no green activity. Seat its 26-pin socket over pins 1–26 at the 3.3V/5V end, with both pin rows engaged.

## One-Shot Provisioning

Clone and provision from the target user's shell:

```bash
git clone https://github.com/TolongLabs/SahurHub
cd SahurHub
sudo ./scripts/setup-pi.sh
```

The supported display path is Raspberry Pi OS Bookworm 64-bit. The server and remote-app provisioning steps are Debian-family best effort; the labwc kiosk and SPI-panel steps are Bookworm-primary.

| Option                    | Use                                                                |
| ------------------------- | ------------------------------------------------------------------ |
| `--ssid <hotspot>`        | Set the phone-hotspot SSID                                         |
| `--pass <password>`       | Set the phone-hotspot password                                     |
| `--ip <address[/prefix]>` | Configure a static Wi-Fi address; a bare address defaults to `/24` |
| `--dry-run`               | Print intended actions without changing the Pi                     |
| `-h`, `--help`            | Show the built-in usage text                                       |

The script may instead read `SAHURHUB_WIFI_SSID`, `SAHURHUB_WIFI_PASS`, and `SAHURHUB_STATIC_IP` from `.env.local`. It is designed to be idempotent: existing packages, Bun, mkcert, the service template, kiosk autostart, Wi-Fi profile, hostname, and matching certificate are detected or updated safely on rerun.

It installs or configures:

- Debian packages: Avahi, CA certificates, curl, NSS trust support, and Chromium when an apt package is available.
- Bun for the invoking non-root user and a static mkcert binary for the machine architecture.
- The local mkcert trust root; an HTTPS certificate covering localhost, the detected/static LAN IP, and `sahurhub.local` when an IP is available.
- An optional NetworkManager phone-hotspot profile, hostname `sahurhub`, and Avahi mDNS.
- `bun install`, the remote-app production build, and `sahurhub.service` so the server starts on boot.
- A Raspberry Pi OS Bookworm labwc autostart entry that opens Chromium kiosk mode at `http://localhost:8080`.

### SPI Panel Overlay

Never run `goodtft/LCD-show` on a Pi 5; the task-list hardware guidance marks it broken.

Stock Bookworm does not contain `dtoverlay=waveshare35a,drm`; firmware silently skips it. Do not install `goodtft/LCD-show` to obtain an overlay.

The confirmed overlay for the Waveshare 3.5-inch RPi LCD (A) Rev4.0 on Pi 5 Bookworm is:

```ini
dtoverlay=piscreen,drm,speed=18000000,rotate=90
```

`piscreen.dtbo` drives the panel's ILI9486 display controller and XPT2046 touch controller. The ILI9486 DRM driver appears as `card-SPI-1`; `ads7846` touch also binds. `rotate=90` is the confirmed upright portrait orientation for the vertically standing case. `rotate=0` renders sideways.

Use only this panel overlay. Reboot, then confirm the panel is a DRM display under labwc/Wayland before launching Chromium.

If the SPI display fails to appear as a DRM display, use an HDMI screen for the demo. Record the fallback; do not block bring-up on a dead panel.

## API Key And Environment

On the Pi, create or edit `SahurHub/.env.local` and set the key received through a private channel:

```ini
DASHSCOPE_API_KEY=<private-key>
```

Never commit, paste into chat, screenshot, or otherwise share `.env.local`. Without `DASHSCOPE_API_KEY`, SahurHub still runs with the mock brain, which is suitable for panel, renderer, and FPS checks but does not exercise the live Qwen chain.

`.env.example` also defines these optional or pinned values:

| Variable                                              | Purpose                                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `QWEN_CHAT_MODEL`, `QWEN_ASR_MODEL`, `QWEN_TTS_MODEL` | Chained model IDs, pinned to the production path                                                |
| `QWEN_REALTIME_MODEL`, `QWEN_OMNI_HTTP_MODEL`         | Experimental model settings; neither is the operating fallback path                             |
| `QWEN_BASE_URL`, `QWEN_WS_HOST`                       | Optional dedicated/personal gateway overrides; leave blank for the documented default endpoints |
| `SAHURHUB_WIFI_SSID`, `SAHURHUB_WIFI_PASS`            | Optional hotspot values read by the Pi provisioner                                              |
| `SAHURHUB_STATIC_IP`                                  | Optional static Wi-Fi address with prefix; omit for DHCP                                        |

`./scripts/setup.sh` copies `.env.example` only when `.env.local` is absent, so it does not overwrite an existing secret file.

## First Boot Verification

After provisioning and a reboot, pass all four checks:

1. Sahur renders on the SPI panel with no keyboard or mouse attached.
2. On a phone connected to the same network, open `https://sahurhub.local:8443/phone` or `https://<pi-ip>:8443/phone` and accept the local certificate warning once.
3. Send a text message from the remote app and confirm Sahur reacts on the panel.
4. Record the subjective FPS feel and any errors in `docs/task-list.md`.

For the panel check, also confirm Chromium launched unattended and Three.js rendered Sahur. WebGL failure shows `RENDERER ERROR`; there is no alternate renderer.

## Interacting With SahurHub

### Kiosk

The panel shows Sahur, a connection state, and a phone URL while idle. It reflects conversation state with expressions: neutral when idle, smug while thinking, and shocked while listening. Audio amplitude drives mouth movement; reply effects and knock actions wait for the audio playback boundary so they land with the words.

Normal reminders and escalations map to Sahur's knock action, with escalation levels from 0 through 2. Three.js is the sole kiosk renderer. A missing or unusable WebGL context shows `RENDERER ERROR`; fix the browser or GPU environment rather than switching renderers.

The optional device-input affordance is hidden by default and can be exposed with `?deviceInput=1`; the MVP interaction path remains the phone remote. `?audioSink=kiosk` forces kiosk playback for local diagnosis.

### Remote Webapp

Open the HTTPS URL shown on the kiosk, or scan a QR code when using the HTTPS-mic spike's printed or `/qr` QR route. The current kiosk implementation renders a URL widget rather than a QR image, so typing the displayed URL is the normal product path.

On a new phone or hotspot session, the browser will warn about the locally issued certificate. This is expected because the Pi's mkcert root is not automatically trusted by the phone:

- Chrome on Android: **Advanced** → **Proceed** to the site.
- Safari on iOS: **Show Details** → **visit this website** → confirm.
- Then grant microphone access; HTTPS is required for browser microphone capture.

The remote supports:

- Chat text and hold-to-talk push-to-talk audio. Releasing the control ends the audio turn; interrupt stops an in-flight turn.
- Automatic task capture from ordinary conversational context. Do not issue a special add-task command: detected tasks appear with their duration, and the scheduler uses that duration for reminders and escalation. Tell Sahur a task is complete to mark it done automatically.
- A Tasks drawer with live countdowns, status and escalation level, plus manual Done and Discard actions.
- A conversation sidebar to create, switch, and delete conversations. Conversation titles are generated asynchronously after the first exchange and may be edited from the top bar.
- Text or image uploads up to 5 MB. Text enters conversation context; images use the vision lane. Both are recorded in conversation history.
- Light and dark themes, plus Settings for phone versus device audio output, character selection, server address, and resetting the active conversation history. Sahur is the only currently built character, although the picker follows the character registry.

On empty conversation history, Sahur opens by gauging the user's TODO intent rather than waiting silently.

## Local Development

### One-Time Bootstrap

Install mkcert first. These are the Debian/Ubuntu commands printed by `./scripts/setup.sh`; they also apply inside WSL2:

```bash
sudo apt update && sudo apt install -y libnss3-tools
curl -JLO https://dl.filippo.io/mkcert/latest?for=linux/amd64
chmod +x mkcert-v*-linux-amd64 && sudo mv mkcert-v*-linux-amd64 /usr/local/bin/mkcert
```

Then bootstrap the repository:

```bash
./scripts/setup.sh
```

The script runs `bun install`, `bun run build:remote`, and `bun run build:kiosk`; installs the mkcert CA; when it detects a LAN IP, creates `cert/` with SANs for `localhost`, loopback addresses, that IP, and `sahurhub.local`; and scaffolds `.env.local` from `.env.example` without replacing an existing file.

### Daily Loop

Start the server:

```bash
bun run dev
```

- Open the kiosk at `http://localhost:8080/`. It is the Three.js Sahur display; use Chrome device toolbar at **480×320** to preview panel framing.
- Open the remote webapp at `https://localhost:8443/phone`. The `/phone` path is required: `/` serves the kiosk on both HTTP and HTTPS.
- If `DASHSCOPE_API_KEY` is absent from `.env.local`, the mock brain is active, which is fine for UI and kiosk work. With the key present, the live chained backend runs; each spoken reply costs about **$0.002** after the free TTS quota.

### WSL2 Browser And Certificate Notes

Windows browsers reach the WSL server through `localhost` forwarding. The WSL mkcert CA is not trusted by Windows, so either accept the warning once or import the CA for clean microphone/getUserMedia push-to-talk. In an elevated Windows PowerShell:

```powershell
$caRoot = wsl mkcert -CAROOT
$caPath = wsl wslpath -w "$caRoot/rootCA.pem"
certutil -addstore -f ROOT $caPath
```

`bun run dev:kiosk` starts local Chromium. Under WSLg, WebGL is commonly blocklisted and Sahur shows `RENDERER ERROR`; use the Windows browser for the kiosk instead. The desktop preview checks correctness only, never FPS, SPI refresh, or Pi GPU behavior.

WSL does not resolve mDNS, so `ssh t010ng@sahurhub.local` fails there. Resolve the Pi IP from Windows instead, or pin it in `/etc/hosts`:

```bash
powershell.exe -Command "ping -4 -n 1 sahurhub.local"
```

### Rebuild And Test Commands

The server reads `apps/remote/dist` and `src/kiosk/dist` from disk for each request. After remote changes, run `bun run build:remote` and refresh the `/phone` tab, or use `bun run dev:remote` for Vite HMR. After kiosk or model changes, run `bun run build:kiosk` and refresh the kiosk tab. Neither path needs a server restart — with one caveat: if the server was started before `apps/remote/dist` ever existed, it serves the placeholder page until restarted (the documented setup order avoids this).

Use `PORT` and `HTTPS_PORT` to run parallel instances or tests, for example:

```bash
PORT=8081 HTTPS_PORT=8444 bun run dev
```

| Command                | Purpose                                             |
| ---------------------- | --------------------------------------------------- |
| `bun run dev`          | Run the Bun server                                  |
| `bun run dev:kiosk`    | Open the 480×320 local Chromium kiosk preview       |
| `bun run dev:remote`   | Run the Vite remote-app development server with HMR |
| `bun run build:remote` | Build the remote app served at `/phone`             |
| `bun run build:kiosk`  | Build the kiosk browser bundle                      |
| `bun test`             | Run tests                                           |
| `bun run typecheck`    | Type-check without emitting files                   |
| `bun run lint`         | Run Biome checks                                    |
| `bun run format`       | Apply Biome and Prettier formatting                 |

## Networking And Demo Plan

- Use Adam's phone hotspot for demos rather than venue Wi-Fi, and rehearse the complete path at least once before finals.
- Join the Pi during provisioning with `--ssid` and `--pass`, or keep hotspot values only in `.env.local`.
- Use `--ip <address[/prefix]>` or `SAHURHUB_STATIC_IP` when a stable demo address is needed. Otherwise the profile uses DHCP.
- Avahi exposes the hostname as `sahurhub.local`; the phone remote is normally `https://sahurhub.local:8443/phone`.
- The certificate covers the IP present when it was minted. After joining a new network, rerun `sudo ./scripts/setup-pi.sh` so its current IP is included before relying on the IP URL.
- Confirm the URL from another device on the hotspot, not only from the Pi. The same-network requirement applies to remote control and browser microphone use.

### Network Roaming

Pre-provision a second Wi-Fi connection for automatic roaming:

```bash
sudo nmcli connection add type wifi ifname '*' con-name 'Venue Wi-Fi' ssid 'Venue SSID'
sudo nmcli connection modify 'Venue Wi-Fi' wifi-sec.key-mgmt wpa-psk wifi-sec.psk 'venue-password' connection.autoconnect yes
```

After switching networks, rerun `sudo ./scripts/setup-pi.sh`, then reboot so the kiosk PHONE badge refreshes. The reboot remains necessary until the `/info` refresh fix ships.

### Demo-Day Checklist

1. Join the venue hotspot first, then boot the Pi.
2. Rerun `sudo ./scripts/setup-pi.sh` once on the venue network.
3. Use wall power only.
4. Keep one SSH session tailing `journalctl -u sahurhub.service -f`.
5. If every reply is the identical canned `Heard you loud and clear...`, the mock brain is active: confirm `DASHSCOPE_API_KEY` loaded from `.env.local`.

## Troubleshooting

| Symptom                                            | Action                                                                                                                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SPI panel is blank or not a DRM display            | Check the single correct overlay, reboot, and use HDMI as the demo fallback. Do not use LCD-show on Pi 5.                                                                                   |
| Red LED but Pi does not boot with the LCD attached | Use the wall PSU; a 45W power bank without 5V/5A cannot boot this load. Check `vcgencmd get_throttled` after boot (`0x0` is clean).                                                         |
| Red LED with no green activity                     | Reseat the LCD HAT socket over pins 1–26 at the 3.3V/5V end; ensure both pin rows engage.                                                                                                   |
| Phone shows a certificate warning                  | Accept the expected local-cert warning using the platform steps above, then grant microphone permission.                                                                                    |
| Phone page has no microphone prompt                | Use the HTTPS remote URL on the same hotspot; `getUserMedia` requires the secure context.                                                                                                   |
| Identical `Heard you loud and clear...` replies    | The mock brain is active. Confirm `DASHSCOPE_API_KEY` loaded from `.env.local`, then restart the service.                                                                                   |
| `RENDERER ERROR` or Three.js is slow               | Confirm browser WebGL and GPU support, then measure and record the on-panel result. There is no alternate renderer; visible low FPS is an accepted hardware risk **(confirm on hardware)**. |
| `sahurhub.local` or IP URL does not open           | Confirm the Pi joined the hotspot, Avahi is running, the phone is on the same network, and the certificate SAN covers the URL being used.                                                   |
| `ssh t010ng@sahurhub.local` fails in WSL           | WSL has no mDNS. Resolve it with `powershell.exe -Command "ping -4 -n 1 sahurhub.local"` or pin the IP in `/etc/hosts`.                                                                     |

## Remaining Hardware Confirmation Gaps

- No on-panel FPS measurement or end-to-end phone-on-hotspot timing is recorded yet; capture both during T13/Spike B.
- The kiosk source currently displays the phone URL but not a QR image. The separate HTTPS-mic spike supplies a QR route for its own test flow.
