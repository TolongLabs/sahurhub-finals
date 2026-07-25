# Spike: mkcert + getUserMedia Phone-Over-Hotspot

De-risks the phone-remote input path (T5, `docs/plan.md`): a phone browser
needs a **secure context** for `getUserMedia`/`MediaRecorder`, served over
self-signed HTTPS from the dev machine or Pi on the same LAN/hotspot.

## What This Proves

- A Bun HTTPS server with an mkcert cert handshakes with a real phone browser.
- The phone can grant mic permission, hold-to-talk record via `MediaRecorder`,
  and stream the audio blob to the server over `wss://`.
- The server writes each recording to `recordings/` and hands back a URL the
  phone can play for verification.
- A console-printed (and `/qr`-served) ASCII QR code gets the phone onto the
  URL without typing it.

## Files

| File          | Purpose                                                             |
| ------------- | ------------------------------------------------------------------- |
| `setup.sh`    | Installs mkcert if missing, generates the LAN cert, `bun install`s  |
| `server.ts`   | Bun HTTPS + WSS server, serves `index.html`, `/qr`, `/recordings/*` |
| `index.html`  | Phone page — hold-to-talk, connection/permission state, playback    |
| `recordings/` | Where received audio blobs land, timestamped                        |

**Dependency:** `qrcode-terminal` (zero transitive deps) — the one justified
dep, scoped to this spike's own `package.json`/`bun.lock` so it never touches
the root project's dependency tree. Prints/serves the console ASCII QR.

## Run It — Dev Machine First

```bash
cd spikes/https-mic
./setup.sh          # installs mkcert if absent, generates cert/, bun install
bun run server.ts    # or: PORT=8443 bun run server.ts
```

The server prints the phone URL and an ASCII QR code to the console, e.g.:

```
Phone URL: https://192.168.1.42:8443
█▄▄▄▄▄▄▄█...
```

Local smoke test (no phone needed):

```bash
curl -sk https://127.0.0.1:8443/          # must return 200 + the HTML page
curl -sk https://127.0.0.1:8443/qr        # must return 200 + ASCII QR text
```

## Run It — Raspberry Pi (Bookworm, arm64)

Same script; the arm64 mkcert install branch in `setup.sh` handles the
different binary URL. Run `./setup.sh` on the Pi itself (not cross-compiled)
so `mkcert -install` trusts the CA in the Pi's own NSS/cert stores — not
strictly required for phone use (see cert-trust steps below), but keeps
`curl -k`-free local testing on the Pi consistent with the dev machine.

```bash
ssh pi@<pi-host>
cd SahurHub/spikes/https-mic
./setup.sh
bun run server.ts
```

## Phone Steps (Exact)

1. Join the phone to the **same hotspot/LAN** as the dev machine or Pi.
2. Scan the console QR code (or open `/qr` in a browser on another device to
   scan it), or type the printed `https://<lan-ip>:8443` URL manually.
3. The phone browser will show a **"Your connection is not private"** /
   self-signed-cert warning — this is expected (mkcert's local CA is only
   trusted on the machine that ran `mkcert -install`, not the phone).
   - **Chrome/Android:** tap "Advanced" → "Proceed to `<ip>` (unsafe)".
   - **Safari/iOS:** tap "Show Details" → "visit this website" → confirm.
4. Tap **"Enable microphone"** and grant the permission prompt. `getUserMedia`
   only succeeds because the page is a secure context (`https://`) — this is
   the exact thing this spike de-risks.
5. Press and hold **"Hold to talk"**, speak, release. The button sends the
   recorded blob over `wss://`; the page's audio player updates with the
   saved recording for playback verification.

## Manual Verification Checklist (Real Hotspot)

Run once on the actual venue setup — Adam's phone hosting the hotspot,
laptop/Pi joined to it (not the other way around):

- [ ] Dev machine/Pi joins Adam's phone hotspot; `./setup.sh` detects the
      correct LAN IP (not a stale/wrong interface — check the printed IP)
- [ ] Server starts, console QR prints, `curl -sk https://<lan-ip>:8443/`
      succeeds **from another device on the hotspot** (not just localhost)
- [ ] A second phone (the actual remote) scans the QR and lands on the page
      without typing the URL
- [ ] Self-signed cert warning appears and is dismissible in ≤2 taps
      (record the exact wording per browser for the on-site runbook)
- [ ] Mic permission prompt appears; granting it flips the pill to "granted"
- [ ] Hold-to-talk captures a short utterance; the WS state pill stays "open"
      throughout
- [ ] The recorded file lands in `recordings/` on the server with a sane
      timestamp and non-zero size
- [ ] The phone's playback `<audio>` element plays back the just-recorded
      clip (round-trip proof, not just upload)
- [ ] Reconnect check: toggle the phone's Wi-Fi off/on — the WS state pill
      shows "closed — retrying…" then recovers to "open" without a page reload
- [ ] (Optional, informs A3) swap `getUserMedia({ audio: true })` for
      `{ video: true, audio: true }` in `index.html` and confirm a camera
      stream also works over the same HTTPS setup

## Notes For TRD §5 (On-Site Regeneration)

- The cert-trust warning is a **fixed, unavoidable step per phone per
  session** unless the phone imports the mkcert root CA (`mkcert -CAROOT`)
  manually — not worth the extra on-site step for a demo.
- `setup.sh` is idempotent: re-running it skips mkcert install if present and
  skips cert generation if `cert/cert.pem` + `cert/key.pem` already exist.
  Delete `spikes/https-mic/cert/` to force regeneration (e.g. after the LAN
  IP changes when switching hotspots).
- `cert/` and `recordings/*` are gitignored (per-machine / runtime artifacts).
