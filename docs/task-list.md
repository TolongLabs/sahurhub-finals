# TASK LIST

Shared team TODO board for the Qwen Brainrot Hackathon (prelims: 14–19 Jul 2026).

> **Lane tags:** `[PD]` = product/concept · `[BUILD]` = prototype · `[POSTER]` = poster & submission · `[OPS]` = tooling · votes · logistics.

---

## [PD] Product & Concept

- [x] Lock the deliberately-useless product concept (PRD §1) — 15 Jul: SahurHub, task-reminder AOD companion, character system (Sahur first)
- [x] Pin the exact Qwen model (TRD §2) — 15 Jul, revised post-spike: **Qwen3.6-Flash** central brain (chained `qwen3-asr-flash` → `qwen3.6-flash` → `qwen3-tts-flash` primary; realtime demoted)

## [BUILD] Prototype

- [x] Prototype built + QA-approved + merged (PR #1, 15 Jul): agent kernel, Sahur 3D kiosk, remote webapp, provisioning one-shot — mock-backend verified, 139/139 tests
- [x] **Qwen API key** — 15 Jul: Model Studio Intl/Singapore registered, DashScope key in `.env.local` (billing alerts still optional TODO)
- [x] **T4 spike — live model availability + realtime promotion gate** — 15 Jul: done; verdict = chained-primary (`qwen3-asr-flash` → `qwen3.6-flash` → `qwen3-tts-flash`), realtime demoted (speaks tag syntax); findings in `spikes/qwen-probe/NOTES.md`
- [x] Working Qwen integration live-verified on dev machine — 15 Jul (real PCM audio + sane transcripts through the chained backend); on-hardware demo lands with T13
- [x] **Manual test pass (Owner: Adam):** DONE 17 Jul (2 rounds; all reds fixed + shipped in PR #2) — run the 12-point checklist the PM delivered (kiosk render + sprite fallback, chat/task-capture/cold-start, sidebar, PTT, uploads, settings, unprompted escalation beat, cross-device sync)
- [ ] **T13 — on-hardware integration (Owner: both, after Spike B):** deploy via `sudo ./scripts/setup-pi.sh` on the Pi, full demo loop on the panel, real-phone mic over hotspot, note on-hardware FPS + latencies (backfills TRD placeholders), capture a device money-shot photo/GIF
- [ ] **T16 — regeneration prompt pack + ONE stopwatch rehearsal of the 2h on-site rebuild (TRD §5; full remote app per PO decision)**
- [ ] **STRETCH — additional brainrot characters (Owner: Adam + pipeline, only after T13 + manual test pass are green):** each = a bible bundle (`characters/<id>/character.json` + `bible.md`) + primitive-composition Three.js model + stock TTS voice pick, all through the existing character system (picker/registry already support it). Full pipeline per character (PL plan → Gate 1). Scope guard: max 1–2 extra characters; each adds to the 2h rebuild budget, so they must be cut-safe (demo must work with Sahur alone); candidates from the brainrot roster (e.g. 凑企鹅 / GuguGPT penguin)
- [x] TRD touch-up — DONE 17 Jul (all 13 accumulated drift items absorbed incl. sprite removal + task lifecycle; QA-approved; only T13 fps + T16 timing placeholders remain)
- [ ] **Spike B — SPI LCD boot (Owner: Chaos, needed before 18 Jul):**
  - [ ] Flash **Raspberry Pi OS Bookworm 64-bit** to the Pi 5's SD card
  - [ ] Do **NOT** run the `goodtft/LCD-show` script — it is broken on Pi 5
  - [ ] Instead add the one-line KMS/DRM overlay to `/boot/firmware/config.txt`:
        `dtoverlay=piscreen,drm,speed=18000000,rotate=90`
        (**hardware-confirmed 24 Jul on the real Pi 5:** `waveshare35a.dtbo` does not exist in stock Bookworm — stock `piscreen.dtbo` drives this ILI9486/XPT2046 panel via the DRM ili9486 driver; `rotate=90` gives the upright-portrait orientation the product uses)
  - [ ] Reboot the Pi
  - [ ] Verify the panel comes up as a DRM display under labwc/Wayland
  - [ ] Launch Chromium in kiosk mode on the panel
  - [ ] Report FPS feel (subjective smoothness) + the exact panel model number
  - [ ] HDMI-fallback note: if the SPI panel does not come up as a DRM display, swap to an HDMI screen as the fallback display and note that explicitly in the report — do not lose the spike to a dead panel

- [ ] **Pi bring-up runbook (Owner: Chaos, after/with Spike B — from empty SD card to talking device):**
  - [ ] **Flash** with Raspberry Pi Imager → Raspberry Pi OS **Bookworm 64-bit (Desktop)**; in Imager's OS-customization dialog pre-set: hostname `sahurhub`, enable SSH, your Wi-Fi credentials (home Wi-Fi is fine for dev), locale/keyboard
  - [ ] **Power check:** use the official Pi 5 PSU or any 27W/5A USB-C PD supply — an underpowered Pi 5 crashes under browser+WebGL load and looks like a software bug
  - [ ] Boot, then run the one-shot from the project (this installs EVERYTHING — Bun, mkcert+certs, Avahi, systemd service, Chromium kiosk autostart, SPI overlay):
        `git clone https://github.com/TolongLabs/SahurHub && cd SahurHub && sudo ./scripts/setup-pi.sh`
        (optional flags: `--ssid <hotspot> --pass <pw>` to pre-join Adam's phone hotspot, `--ip <static>` for the demo static IP; script is idempotent — safe to re-run)
  - [ ] **API key:** get `DASHSCOPE_API_KEY` from Adam via a PRIVATE channel (never commit it, never screenshot it) → put it in `SahurHub/.env.local` on the Pi; without it the device still runs on the mock brain (fine for panel/FPS testing)
  - [ ] **Definition of done (verify all four):** ① Sahur renders on the SPI panel after reboot with no keyboard/mouse attached · ② `https://sahurhub.local:8443` (or the Pi's IP) opens the remote app from your phone on the same network (accept the cert warning once) · ③ typing a message in the remote makes Sahur react on the panel · ④ note the FPS feel + any errors in this file
  - [ ] **Do NOT buy/attach mic or camera modules** — MVP proxies all inputs through the phone webapp; the only hardware purchase is the USB speaker (entry below)
  - [ ] For the demo/finals network plan: Pi joins Adam's phone hotspot (not venue Wi-Fi); rehearse that at least once before 25 Jul

## [POSTER] Poster & Submission

- [x] Download official Qwen logo assets — 15 Jul (`assets/poster/logo/`, verified unaltered)
- [x] **Poster generation + refinement** — 16 Jul: final poster committed as `assets/poster/poster-v3-qwen-edited.png` (generated art + official logo overlaid programmatically)
- [x] **Poster compliance check (pass):** exactly 1080×1080 PNG ✓ · official `logo-white.png` composited unaltered ✓ · model name letter-perfect "Qwen3.6-Flash" ✓ · §5 content rules clean ✓ — 16 Jul
- [ ] (Optional) harden with the judge-simulator skill before submitting
- [x] Submitted 17 Jul (ahead of the 19 Jul 23:59 MYT deadline) — now mobilize votes (voting opened 14 Jul 21:00 MYT)

## [OPS] Ops

- [x] Workspace scaffold (pm-workflow, docs, tooling) — 15 Jul
- [ ] **Organizer question — preparation posture (Owner: Chaos, needed before 18 Jul; cross-links `docs/plan.md` A7 / Gate 1):**
  - [ ] Ask in the hackathon channel: "Does a pre-flashed SD card (OS + Bun + system deps only, not our app source) count as 'pre-built work' under the two-hour build-on-site rule (§7)? Is bringing a prepared prompt pack that Claude Code uses to regenerate the app source on-site within the rules?"
  - [ ] Report the organizer's answer **verbatim** here once received:
    > _(pending — paste the organizer's exact reply here)_

- [ ] **USB speaker for finals showmanship (Owner: Chaos, before 20 Jul):** procure or confirm a small USB speaker for the Pi 5 (it has no headphone jack) so device-side TTS can use the Device output target at finals.
