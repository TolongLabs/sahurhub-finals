# SahurHub — Inception Ideadump (organized)

> Captured 2026-07-15 from PO (Adam) at the start of the inception phase. Team: Adam (software / visible MVP / aesthetics) + Chaos (hardware). Raw input organized by the PM; feeds deep research → hackathon-idea-generator → hackathon-idea-scoring → Gate 1.

## Goal

Enter the finals (community votes on the 1080×1080 poster, deadline 19 Jul 23:59 MYT) → win 1st place at the Physical Final (25 Jul, 2-hour on-site rebuild). Brief understanding **confirmed**: build the most deliberately useless product that nonetheless functions — maximum absurdity, but a Qwen model must do real, demonstrable work.

## Product Vision (working)

A **desktop IoT companion device** in the spirit of the **Divoom Ditoo** (retro-cute tabletop speaker with an expressive pixel screen): a physical "brainrot personal assistant" named **SahurHub**. Core identity: personal assistant; feature set deliberately TBD until concept locks.

## Hardware (fixed assets — Chaos)

| Asset   | Detail                                                                                      |
| ------- | ------------------------------------------------------------------------------------------- |
| Compute | Raspberry Pi 5, 8 GB                                                                        |
| Display | LCD ~480×360 px (exact model TBC; likely the one in techeonics.com's RPi LCD setup article) |
| Inputs  | Mic, vision (camera), buttons — **not** physical peripherals initially                      |

## Software Approach (Adam)

- **Remote-control input model:** a simple companion **webapp** (phone) proxies mic / camera / button inputs to the device — avoids wiring physical peripherals.
- Adam owns the visible MVP: aesthetics, character, UI.

## Brainrot Integration Ideas

- **Persona inspiration:** Tesla Grok "Unhinged" mode — chaotic/unfiltered assistant energy (explore further precedents).
- **Character spectrum (depth TBD):** Italian brainrot (Tung Tung Tung Sahur + AI buddies: Tralalero Tralala, Bombardiro Crocodilo, …) ⟷ latest Instagram Reels / bilibili wave (e.g. 凑企鹅 — research). KnowYourMeme suggested as discovery source.

## Character Rendering (known constraint)

- VTuber-grade Live2D models are **not obtainable** → options floated: custom models in **Three.js**, or (ambitious) **Blender via Claude MCP**.

## Reuse

- Recycle code/ideas from **LLaMaDesu!** (`~/CS/LLaMaDesu`) — inventory in progress.

## Open Questions (carried to research / Gate 1)

1. Exact LCD model + driver path.
2. Which Qwen model(s) — chat / STT / vision / TTS / omni? Poster must name the model verbatim.
3. Character choice + copyright/content-rule safety (AI-generated meme characters, ownership unclear).
4. What "personal assistant features" survive the 2-hour rebuild budget.
5. What counts as "pre-built" for the on-site rule (pre-flashed SD card? pre-written code?) — may need organizer clarification.
