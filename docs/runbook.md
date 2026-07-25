# SahurHub Runbook — Build One Yourself

> Everything needed to go from loose parts to a working SahurHub: **assemble → flash → provision → run**.
>
> This runbook is the single source of truth for hardware and deployment. Product scope lives in [prd.md](prd.md); the architecture contract lives in [trd.md](trd.md).

---

## Contents

1. [What You Are Building](#1-what-you-are-building)
2. [Bill Of Materials](#2-bill-of-materials)
3. [Assembling The Hardware](#3-assembling-the-hardware)
4. [Flashing The SD Card](#4-flashing-the-sd-card)
5. [First Boot](#5-first-boot)
6. [Provisioning SahurHub](#6-provisioning-sahurhub)
7. [Adding Your Qwen Key](#7-adding-your-qwen-key)
8. [Reboot And Verify](#8-reboot-and-verify)
9. [Using The Device](#9-using-the-device)
10. [Operating The Service](#10-operating-the-service)
11. [Networking](#11-networking)
12. [Local Development Without A Pi](#12-local-development-without-a-pi)
13. [Troubleshooting](#13-troubleshooting)
14. [What Is Confirmed, And What Is Not](#14-what-is-confirmed-and-what-is-not)

---

## 1. What You Are Building

A palm-sized desk companion. An animated 3D character lives on a small SPI panel attached to a Raspberry Pi 5; you talk to it from your phone over your own hotspot.

| Piece      | Where It Runs                    | What It Does                                                               |
| ---------- | -------------------------------- | -------------------------------------------------------------------------- |
| **Server** | Raspberry Pi, `sahurhub.service` | One Bun process: HTTP for the kiosk, HTTPS for the phone, shared WebSocket |
| **Kiosk**  | Chromium on the Pi's panel       | The Three.js character, connection badge, and phone-URL QR                 |
| **Remote** | Your phone's browser             | Chat, push-to-talk, tasks drawer, settings                                 |
| **Qwen**   | Alibaba Cloud Model Studio       | ASR, reply + tag generation, TTS                                           |

Assembly and flashing are quick; provisioning is mostly unattended, and its length depends on your network — it downloads packages, Bun, mkcert, and the full dependency tree, then builds both browser apps.

### Before You Start

- The Pi needs **internet access** during provisioning (package installs, Bun, mkcert, `bun install`).
- The phone and the Pi must end up on the **same network**. A phone hotspot is the recommended setup — it is portable and does not depend on venue Wi-Fi.
- You do **not** need a Qwen API key to get a working device. Without one, a deterministic mock brain drives the entire UI, kiosk, and scheduler.

---

## 2. Bill Of Materials

| Component                                      | Purpose            | Notes                                                             |
| ---------------------------------------------- | ------------------ | ----------------------------------------------------------------- |
| **Raspberry Pi 5**                             | Device host        | The provisioner targets Pi 5 on Bookworm                          |
| **Official Raspberry Pi 5 PSU (27W USB-C PD)** | Power              | **Not optional** — see the warning below                          |
| **Waveshare 3.5" RPi LCD (A) Rev4.0, SPI**     | Display + touch    | ILI9486 display + XPT2046 touch controller, 480×320 native        |
| **microSD card**                               | Boot media         | 16 GB or larger; the Desktop image plus dependencies is not small |
| **USB speaker**                                | Device-side audio  | Any USB audio output the Pi enumerates                            |
| **A phone**                                    | The remote control | Supplies the hotspot, the microphone, and the browser             |

> [!WARNING]
> **Power is the single most common build failure.** A 45W USB-C PD power bank _without_ a 5V/5A profile will light the red LED but fail to boot once the LCD is attached. Use the official wall PSU, especially for demos.

### Deliberately Not Specified

Two things are genuinely part of a finished build but are **not** prescribed here, because this project has no verified reference design for them:

- **The enclosure.** The unit in the project banner is a custom case. Any box that clears the HAT and exposes the panel works; nothing in the software depends on it.
- **No microphone or camera on the device.** This is a design decision, not an omission — the phone supplies text, push-to-talk audio, and uploads. It is also _why_ the phone listener must be HTTPS: browsers only grant `getUserMedia` in a secure context.

---

## 3. Assembling The Hardware

Assembly is short. The only step with a real failure mode is seating the panel.

### 3.1 Seat The LCD HAT

The Waveshare 3.5" LCD (A) uses a **26-pin socket**, not the full 40-pin header.

1. Power the Pi **off** and unplug it.
2. Align the HAT's 26-pin socket over **pins 1–26**, at the **3.3V/5V end** of the 40-pin header. Pin 1 is the 3.3V pin, at the end nearest the USB-C power connector.
3. Press down evenly until **both rows of pins** are fully engaged.

> [!CAUTION]
> A mis-seated HAT does not merely fail to display — **it prevents the Pi from booting at all**: red LED, no green activity. If you see that symptom later, come back and reseat this connector before debugging anything else.

### 3.2 Connect The Rest

1. Plug the **USB speaker** into any USB port.
2. Insert the **microSD card** once you have flashed it (§4).
3. Connect the **official PSU** last.

Leave the Pi unpowered until the card is flashed.

---

## 4. Flashing The SD Card

**Supported OS: Raspberry Pi OS Bookworm, 64-bit, Desktop.**

This is not a soft preference. The provisioner's display and kiosk steps depend on Bookworm specifics — the `labwc` session for kiosk autostart, and `/boot/firmware/config.txt` for the SPI overlay. The server half of the script is Debian-family best-effort; the panel half is Bookworm-primary.

### 4.1 Write The Image

1. Install [Raspberry Pi Imager](https://www.raspberrypi.com/software/).
2. Choose device **Raspberry Pi 5**.
3. Choose OS **Raspberry Pi OS (64-bit)** — the Desktop image, not Lite. _(Lite has no `labwc` session, so kiosk autostart will not install.)_
4. Choose your microSD card.

### 4.2 Apply OS Customisation

Before writing, open **Edit Settings** and set:

| Setting                   | Value              | Why                                                        |
| ------------------------- | ------------------ | ---------------------------------------------------------- |
| **Hostname**              | `sahurhub`         | The provisioner sets this anyway; setting it now is tidier |
| **Username**              | your choice        | This account will own and run SahurHub                     |
| **Password**              | your choice        | You will need it for `sudo`                                |
| **Wi-Fi SSID / password** | your phone hotspot | Gives the Pi internet access on first boot                 |
| **Locale / keyboard**     | your region        | Saves grief in the terminal later                          |
| **Enable SSH**            | on                 | Lets you work from your laptop instead of the 3.5" panel   |

> Remember the **username** you choose. Every later command runs as that user, and the systemd service is generated to run as them.

Then **write the image** and eject the card.

---

## 5. First Boot

1. Insert the microSD card into the Pi.
2. Attach the panel, speaker, and **official PSU**.
3. Power on and wait for the desktop to appear. Complete any first-login prompts.

### 5.1 Confirm Power Is Clean

```bash
vcgencmd get_throttled
```

`throttled=0x0` means clean. Anything else points at the power supply — revisit §2 before continuing.

### 5.2 Get A Shell

Work over SSH from your laptop; the 3.5" panel is a poor terminal.

```bash
ssh <your-username>@sahurhub.local
```

If mDNS does not resolve (common on Windows/WSL — see §11.3), find the Pi's IP from your hotspot's client list and use that instead.

---

## 6. Provisioning SahurHub

One script does the entire software build. It is **idempotent** — safe to re-run as many times as you like.

### 6.1 Clone And Run

```bash
git clone https://github.com/TolongLabs/SahurHub
cd SahurHub
sudo ./scripts/setup-pi.sh --ssid "<hotspot-name>" --pass "<hotspot-password>"
```

> [!IMPORTANT]
> Run it with **`sudo` from your own user**, not as root and not via `sudo -i`. The script reads `SUDO_USER` to decide who owns the install, and **refuses to run without it**. That user's home is where Bun lands and whose name goes into the systemd unit.

### 6.2 Options

| Flag                    | Purpose                                                |
| ----------------------- | ------------------------------------------------------ |
| `--ssid NAME`           | Hotspot SSID                                           |
| `--pass SECRET`         | Hotspot password                                       |
| `--ip ADDRESS[/PREFIX]` | Static Wi-Fi address; a bare address defaults to `/24` |
| `--dry-run`             | Print every action without changing the device         |
| `-h`, `--help`          | Built-in usage text                                    |

Credentials can also come from `.env.local` instead of flags, via `SAHURHUB_WIFI_SSID`, `SAHURHUB_WIFI_PASS`, and `SAHURHUB_STATIC_IP`.

**Unsure what it will do?** Run `sudo ./scripts/setup-pi.sh --dry-run` first. It prints the full plan and touches nothing.

### 6.3 What It Actually Does

| Stage           | Actions                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Packages**    | Installs `avahi-daemon`, `ca-certificates`, `curl`, `libnss3-tools`, and Chromium (`chromium` or `chromium-browser`)                |
| **Toolchain**   | Installs Bun for your user and symlinks `bun`/`bunx` into `/usr/local/bin`; installs a static `mkcert` binary for your architecture |
| **Trust**       | Runs `mkcert -install` to add the local CA to the Pi's trust store                                                                  |
| **Network**     | Creates a NetworkManager profile named **`SahurHub Phone AP`** with WPA-PSK and autoconnect; applies a static IP if you passed one  |
| **Identity**    | Sets the hostname to `sahurhub` and enables Avahi so `sahurhub.local` resolves                                                      |
| **Certificate** | Mints `cert/cert.pem` + `cert/key.pem` covering `localhost`, `127.0.0.1`, `::1`, the detected LAN IP, and `sahurhub.local`          |
| **Build**       | Runs `bun install`, `bun run build:remote`, and `bun run build:kiosk`                                                               |
| **Service**     | Writes and enables `/etc/systemd/system/sahurhub.service` so the server starts on boot and restarts on failure                      |
| **Kiosk**       | Appends a Chromium `--kiosk` line to `~/.config/labwc/autostart`                                                                    |
| **Panel**       | Appends the SPI display overlay to `/boot/firmware/config.txt`                                                                      |

Re-running detects each of these and skips or updates it rather than duplicating work.

### 6.4 About The Panel Overlay

The script appends exactly this to `/boot/firmware/config.txt`:

```ini
dtoverlay=piscreen,drm,speed=18000000,rotate=90
```

Two hard-won facts behind that one line, both confirmed on real hardware:

- **`waveshare35a,drm` does not exist in stock Bookworm.** Despite the panel being a genuine Waveshare 3.5" Rev4.0, the working overlay is `piscreen,drm`. Earlier project notes referencing `waveshare35a` are superseded.
- **Do not use `goodtft` / `LCD-show`.** Those vendor installer scripts are broken on Pi 5 + Bookworm and will leave you with a non-booting or blank system.

`rotate=90` gives the confirmed **upright portrait** orientation. The kiosk page is resolution-agnostic, so it fills whatever the panel reports.

**This overlay requires a reboot to take effect** (§8).

---

## 7. Adding Your Qwen Key

The provisioner does **not** create `.env.local`. Create it yourself:

```bash
cp .env.example .env.local
nano .env.local
```

| Variable            | Set It To                                                                  |
| ------------------- | -------------------------------------------------------------------------- |
| `DASHSCOPE_API_KEY` | Your Alibaba Cloud Model Studio key. **Leave blank to run the mock brain** |
| `QWEN_CHAT_MODEL`   | `qwen3.6-flash` — reply and tag generation                                 |
| `QWEN_ASR_MODEL`    | `qwen3-asr-flash` — speech to text                                         |
| `QWEN_TTS_MODEL`    | `qwen3-tts-flash` — text to speech                                         |
| `QWEN_VISION_MODEL` | Model for the image-upload lane                                            |

Get a key from **Alibaba Cloud Model Studio** (the International/Singapore region was used for this project).

> [!NOTE]
> `.env.local` is read by systemd as an `EnvironmentFile`, so it must be plain `KEY=value` lines. No shell expansion, no inline comments after a value, no surrounding quotes unless they are part of the value. A malformed line here is the usual cause of an unexpectedly silent mock brain.

Restart to pick up the key:

```bash
sudo systemctl restart sahurhub.service
```

**Cost:** roughly **$0.002** per spoken reply once the free TTS quota is used up.

---

## 8. Reboot And Verify

```bash
sudo reboot
```

The reboot applies the SPI overlay and proves that unattended startup works — which is the thing you actually care about.

After it comes back, walk the checklist:

| #   | Check                     | Command Or Action                      | Expected                                             |
| --- | ------------------------- | -------------------------------------- | ---------------------------------------------------- |
| 1   | Service is up             | `systemctl status sahurhub.service`    | `active (running)`                                   |
| 2   | Panel shows the character | Look at the device                     | The character, an `ONLINE` badge, and a `PHONE:` URL |
| 3   | Logs are clean            | `journalctl -u sahurhub.service -n 50` | No repeating errors                                  |
| 4   | Server answers            | `curl -s http://localhost:8080/info`   | JSON with the phone URL and HTTPS port               |
| 5   | Phone can connect         | Open the URL shown on the panel        | The remote loads (after the cert warning — §9.2)     |

If the panel is blank but the service is running, the overlay is the suspect — see §13.

---

## 9. Using The Device

### 9.1 Joining From Your Phone

The panel displays the phone URL along the bottom. You have two ways in:

- **Scan the QR.** Tap the `PHONE:` badge — or anywhere along the bottom strip — and the kiosk shows a scannable QR of the remote URL. Tap outside the card to dismiss it.
- **Type the URL.** `https://<pi-ip>:8443/phone`, or `https://sahurhub.local:8443/phone`.

> The `/phone` path is required. Plain `/` serves the **kiosk** on both HTTP and HTTPS.

### 9.2 The Certificate Warning Is Expected

The Pi's mkcert root is not trusted by your phone, so the browser will warn on first visit. This is normal for a local device.

| Browser              | Steps                                               |
| -------------------- | --------------------------------------------------- |
| **Chrome (Android)** | **Advanced** → **Proceed to the site**              |
| **Safari (iOS)**     | **Show Details** → **visit this website** → confirm |

Then **grant microphone access** — HTTPS plus permission is what makes push-to-talk work.

### 9.3 What The Remote Can Do

| Capability          | Detail                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Chat and talk**   | Type, or hold-to-talk. Releasing ends the audio turn; interrupt stops an in-flight reply                                         |
| **Automatic tasks** | Tasks are captured from ordinary conversation — there is **no add-task command**. Say a task is done and it closes automatically |
| **Tasks drawer**    | Live countdowns, status, escalation level, plus manual **Done** and **Discard**                                                  |
| **Conversations**   | Create, switch, delete. Titles generate asynchronously after the first exchange and are editable                                 |
| **Uploads**         | Text or images up to **5 MB**. Text enters context; images go through the vision lane                                            |
| **Settings**        | Light/dark theme, phone-vs-device audio output, character selection, server address, history reset                               |

On an empty conversation, the character opens by gauging your TODO intent rather than waiting silently.

### 9.4 The Panel Itself

- Reminders and escalations play the character's action animation, with escalation levels 0 through 2.
- Tapping the character pokes it, and it retaliates.
- Three.js is the **only** renderer. A missing or unusable WebGL context shows `RENDERER ERROR` — fix the browser or GPU environment rather than looking for a fallback renderer.
- `?deviceInput=1` exposes an optional device-input affordance, hidden by default. `?audioSink=kiosk` forces kiosk playback for local diagnosis.

---

## 10. Operating The Service

### 10.1 Everyday Commands

```bash
systemctl status sahurhub.service         # is it running?
sudo systemctl restart sahurhub.service   # after editing .env.local
sudo systemctl stop sahurhub.service      # free the ports for a manual run
journalctl -u sahurhub.service -f         # follow the logs
```

### 10.2 Service Definition

The generated unit at `/etc/systemd/system/sahurhub.service`:

| Property             | Value                                                               |
| -------------------- | ------------------------------------------------------------------- |
| **User**             | The user who ran `sudo ./scripts/setup-pi.sh`                       |
| **WorkingDirectory** | Your clone of the repository                                        |
| **ExecStart**        | `bun run src/server/index.ts`                                       |
| **EnvironmentFile**  | `.env.local` — **optional**, so the service still starts without it |
| **Restart**          | `always`, after 3 seconds                                           |

### 10.3 Updating

```bash
cd ~/SahurHub
git pull
sudo ./scripts/setup-pi.sh
```

Re-running the provisioner rebuilds both browser apps and refreshes the service definition. For a code-only change you can skip the full script:

```bash
bun install && bun run build:remote && bun run build:kiosk
sudo systemctl restart sahurhub.service
```

The server reads `apps/remote/dist` and `src/kiosk/dist` from disk per request, so a rebuild plus a browser refresh is usually enough — no restart needed for asset-only changes.

### 10.4 Ports

| Port   | Protocol | Serves                               |
| ------ | -------- | ------------------------------------ |
| `8080` | HTTP     | Kiosk at `/`, `/ws`, `/info`         |
| `8443` | HTTPS    | Remote at `/phone`, `/ws`, `/upload` |

Override with `PORT` and `HTTPS_PORT` to run parallel instances.

---

## 11. Networking

### 11.1 The Certificate Is Pinned To An IP

This is the most common post-setup surprise.

The certificate covers whatever IP the Pi had **when it was minted**. After joining a different network, the IP changes and the old certificate no longer matches:

```bash
sudo ./scripts/setup-pi.sh   # re-mints the cert for the current IP
sudo reboot
```

The reboot also refreshes the `PHONE:` badge on the panel — currently required, because the kiosk reads discovery data at startup.

### 11.2 Roaming Between Networks

Pre-provision a second network so the Pi connects automatically:

```bash
sudo nmcli connection add type wifi ifname '*' con-name 'Venue Wi-Fi' ssid 'Venue SSID'
sudo nmcli connection modify 'Venue Wi-Fi' wifi-sec.key-mgmt wpa-psk wifi-sec.psk 'venue-password' connection.autoconnect yes
```

Then re-run the provisioner and reboot, per §11.1.

### 11.3 mDNS

Avahi publishes the Pi as `sahurhub.local`, which is normally the friendliest way to reach it. Two caveats:

- **WSL does not resolve mDNS.** `ssh <user>@sahurhub.local` fails there. Resolve the IP from Windows instead, or pin it in `/etc/hosts`:
  ```bash
  powershell.exe -Command "ping -4 -n 1 sahurhub.local"
  ```
- **Always confirm the URL from a second device** on the same network, not only from the Pi itself. Same-network reachability is what remote control and browser microphone access actually require.

### 11.4 Demo Checklist

For anything with an audience, in order:

1. Join the venue hotspot **first**, then boot the Pi.
2. Re-run `sudo ./scripts/setup-pi.sh` once on that network, then reboot.
3. Use **wall power** only.
4. Keep an SSH session tailing `journalctl -u sahurhub.service -f`.
5. Confirm the phone URL from the phone, not from the Pi.
6. If every reply is an identical canned line, the mock brain is active — check `DASHSCOPE_API_KEY`.

---

## 12. Local Development Without A Pi

The whole product runs on a laptop. You lose only the panel and device audio.

### 12.1 Install mkcert

Debian/Ubuntu/WSL2:

```bash
sudo apt update && sudo apt install -y libnss3-tools
curl -JLO https://dl.filippo.io/mkcert/latest?for=linux/amd64
chmod +x mkcert-v*-linux-amd64 && sudo mv mkcert-v*-linux-amd64 /usr/local/bin/mkcert
```

### 12.2 Bootstrap

```bash
git clone https://github.com/TolongLabs/SahurHub
cd SahurHub
./scripts/setup.sh
```

Unlike `setup-pi.sh`, this one **does** scaffold `.env.local` from `.env.example` (without overwriting an existing file). It also runs `bun install`, builds both browser apps, installs the mkcert CA, and — when it detects a LAN IP — mints `cert/` with SANs for `localhost`, loopback, that IP, and `sahurhub.local`.

### 12.3 Run

```bash
bun run dev
```

| Surface    | URL                            | Notes                                                  |
| ---------- | ------------------------------ | ------------------------------------------------------ |
| **Kiosk**  | `http://localhost:8080/`       | Preview at **480×320** in the browser's device toolbar |
| **Remote** | `https://localhost:8443/phone` | The `/phone` path is required                          |

| Command                | Purpose                                        |
| ---------------------- | ---------------------------------------------- |
| `bun run dev`          | Run the server                                 |
| `bun run dev:kiosk`    | Open a local Chromium kiosk preview at 480×320 |
| `bun run dev:remote`   | Vite dev server for the remote app, with HMR   |
| `bun run build:remote` | Build the app served at `/phone`               |
| `bun run build:kiosk`  | Build the kiosk bundle                         |
| `bun test`             | Run tests                                      |
| `bun run typecheck`    | Type-check without emitting                    |
| `bun run lint`         | Biome checks                                   |

Run parallel instances by overriding the ports:

```bash
PORT=8081 HTTPS_PORT=8444 bun run dev
```

> The desktop preview checks **layout and animation correctness only**. It says nothing about on-panel FPS, SPI refresh, colour, or Pi GPU behaviour.

### 12.4 WSL2 Notes

- **WebGL is commonly blocklisted under WSLg**, so `bun run dev:kiosk` shows `RENDERER ERROR`. Use a Windows browser against the forwarded `localhost` instead.
- The WSL mkcert CA is not trusted by Windows. Accept the warning once, or import the CA for clean push-to-talk. In an elevated PowerShell:
  ```powershell
  $caRoot = wsl mkcert -CAROOT
  $caPath = wsl wslpath -w "$caRoot/rootCA.pem"
  certutil -addstore -f ROOT $caPath
  ```

### 12.5 Rebuild Loop

The server reads both `dist` directories from disk per request, so neither rebuild needs a restart:

| Changed        | Do This                                                                                |
| -------------- | -------------------------------------------------------------------------------------- |
| Remote app     | `bun run build:remote`, refresh the `/phone` tab — or use `bun run dev:remote` for HMR |
| Kiosk or model | `bun run build:kiosk`, refresh the kiosk tab                                           |

**One caveat:** if the server started before `apps/remote/dist` ever existed, it serves a placeholder page until restarted. Following the setup order above avoids this.

---

## 13. Troubleshooting

### Hardware And Boot

| Symptom                                       | Fix                                                                                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Red LED, no green activity, no boot           | Reseat the LCD HAT over pins 1–26 at the 3.3V/5V end; make sure **both** rows engage (§3.1)                                        |
| Red LED, will not boot with the LCD attached  | Use the official wall PSU. A 45W bank without a 5V/5A profile cannot carry this load                                               |
| Boots, but behaves erratically                | `vcgencmd get_throttled` — anything other than `0x0` means power                                                                   |
| Panel blank, or not detected as a DRM display | Confirm the overlay line in `/boot/firmware/config.txt`, reboot, and fall back to HDMI if needed. **Never** use `LCD-show` on Pi 5 |

### Service And Model

| Symptom                                       | Fix                                                                                                                           |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Service will not start                        | `journalctl -u sahurhub.service -n 100`. Check that the build succeeded and the working directory is right                    |
| Every reply is the same canned line           | The mock brain is active. Check `DASHSCOPE_API_KEY` in `.env.local`, confirm no malformed lines (§7), then restart            |
| `RENDERER ERROR`, or Three.js is visibly slow | Confirm WebGL and GPU support in the browser. There is no alternate renderer — low FPS on this panel is an accepted trade-off |

### Network And Phone

| Symptom                                      | Fix                                                                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Certificate warning on the phone             | Expected. Accept it via the §9.2 steps, then grant microphone permission                                                                        |
| No microphone prompt appears                 | You must be on the **HTTPS** URL. `getUserMedia` requires a secure context                                                                      |
| `sahurhub.local` or the IP URL will not open | Confirm the Pi joined the network, Avahi is running, the phone is on the same network, and the certificate covers the URL you are using (§11.1) |
| The panel shows a stale phone URL            | Re-run the provisioner and reboot (§11.1)                                                                                                       |
| `ssh <user>@sahurhub.local` fails in WSL     | WSL has no mDNS — resolve the IP from Windows or pin it in `/etc/hosts` (§11.3)                                                                 |

---

## 14. What Is Confirmed, And What Is Not

Being explicit about this, since a runbook that overstates its own certainty is worse than no runbook.

### Confirmed On Real Hardware

- End-to-end provisioning on a Raspberry Pi 5 with Raspberry Pi OS Bookworm 64-bit and a Waveshare 3.5" Rev4.0 panel.
- The overlay `dtoverlay=piscreen,drm,speed=18000000,rotate=90`, including that `waveshare35a,drm` is **absent** from stock Bookworm.
- Upright portrait orientation.
- The live Qwen chained path (ASR → chat → TTS) running on-device.
- Both power failure modes and the HAT-seating boot failure described in §13.

### Not Independently Verified

- **Sustained on-panel FPS.** Three.js is the sole renderer and visible jank on this panel is an accepted trade-off, but no measured figure is recorded.
- **Distributions other than Raspberry Pi OS Bookworm.** The server half of the provisioner is written to be Debian-family portable, but only Bookworm has been exercised. The panel and kiosk steps are Bookworm-specific by design, and the script warns rather than guesses when it cannot detect `labwc` or an apt Chromium package.
- **The enclosure**, which has no reference design here (§2).
