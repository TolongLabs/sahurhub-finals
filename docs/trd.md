# SahurHub — Technical Requirements Document (TRD)

> The canonical shipped architecture contract for [prd.md](prd.md). Rules source of truth: [project-requirements.md](project-requirements.md). On conflict, the newest entry in [decisions.md](decisions.md) wins.
>
> **Status:** refreshed against `main` on 17 July 2026. T13 on-panel fps and T16 rebuild timings are the only marked items.
>
> **Do Not Create `docs/architecture.md`** — architecture lives here.

---

## Contents

1. [Constraints That Drive The Design](#1-constraints-that-drive-the-design)
2. [Qwen Model Selection](#2-qwen-model-selection)
3. [Stack And Architecture](#3-stack-and-architecture)
4. [Qwen Access And Credentials](#4-qwen-access-and-credentials)
5. [The 2-Hour Rebuild Plan (Finals)](#5-the-2-hour-rebuild-plan-finals)
6. [Poster Production Pipeline](#6-poster-production-pipeline)

---

## 1. Constraints That Drive The Design

- **Qwen is load-bearing.** Qwen performs the central ASR, reply, task-capture, TTS, title, and image-description work.
- **The prototype must be reproducible in two hours on-site.** Use a small Bun/TypeScript surface, minimal dependencies, and procedural assets.
- **The prelim deliverable is the poster.** The working prototype substantiates its Qwen-integration claim and rehearses the final demo.
- **Content compliance is non-negotiable.** All shipped assets and behavior remain within [project-requirements.md](project-requirements.md).

## 2. Qwen Model Selection

**Poster model name:** **Qwen3.6-Flash**, with Qwen3-ASR-Flash and Qwen3-TTS-Flash as supporting pipeline copy.

### 2.1 Production Path And Fallbacks

| Rung | Path                                                    | Role                                                                        |
| ---- | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1    | `qwen3-asr-flash` → `qwen3.6-flash` → `qwen3-tts-flash` | Production chained path: ASR, streamed reply/tag generation, clean-text TTS |
| 2    | Browser `speechSynthesis`                               | Used when reply text arrived but cloud TTS did not begin in time            |
| 3    | Canned in-character line plus deterministic scheduler   | Keeps the device responsive when no model text arrives                      |

The task classifier remains **single-call**: Qwen3.6-Flash emits the conversational reply and any task tags in the same streamed generation. It is not a second classifier request. A separate small Qwen request is used only to generate a conversation title after the first exchange.

### 2.2 Measured Development-Machine Latencies

The following are **development-machine measurements** from the 15 July T4 probe against the personal MaaS gateway. They are gateway- and sample-specific, not venue or Pi measurements.

| Leg                    | Measurement          | Result              |
| ---------------------- | -------------------- | ------------------- |
| Chat, `qwen3.6-flash`  | TTFT P50 / P95       | **365 ms / 533 ms** |
| TTS, `qwen3-tts-flash` | First-byte average   | **753 ms**          |
| ASR, `qwen3-asr-flash` | Average              | **665 ms**          |
| Realtime experiment    | First-audio P95      | **1,130 ms**        |
| Realtime experiment    | Tag syntax vocalized | **3/5 turns**       |

The chained path is production because it strips tags in the text domain before TTS. Realtime is an experiment only until actions use a non-speech control channel; the HTTP omni experiment produced no usable audio bytes on this gateway. `Ethan` is Sahur's selected stock TTS voice.

### 2.3 Local Latency Enforcement

- At **4.5 s**, if reply text exists but cloud TTS has not begun, clients receive the WebSpeech-fallback notice.
- At **6.5 s**, if no usable text exists, the orchestrator emits a short canned in-character failure line.
- `interrupt` aborts in-flight generation and TTS.
- Qwen thinking output is disabled for the chat and title requests.

### 2.4 Gateway Compatibility

`QWEN_BASE_URL` can override the default endpoint for the personal gateway. The chained backend handles the observed gateway shapes: TTS audio may arrive through `output.audio.url`, ASR content may be an array of text parts, and TTS requires the selected `voice` parameter.

---

## 3. Stack And Architecture

**One Bun/TypeScript process.** It runs a plain HTTP kiosk listener, an mkcert-backed HTTPS phone listener, the shared `/ws` endpoint on both listeners, `GET /info`, `POST /upload`, kiosk files, and the built remote app at `/phone/`. Process-level `unhandledRejection` and `uncaughtException` guards log failures instead of silently losing them.

### 3.1 Source Layout And Builds

```
src/
  server/
    index.ts                 # Dual listeners, HTTP routes, WS session wiring
    kernel/                  # Task lifecycle, tags, scheduler, ordered queue
    persona/                 # Character registry and five-layer prompt compiler
    llm/                     # VoiceBackend implementations
    db/                      # bun:sqlite schema and DAO
  shared/
    protocol.ts              # Client/server wire contract
    ws-client.ts             # Shared reconnecting client
  kiosk/
    main.ts, renderer.ts, model/  # Sole Three.js kiosk renderer and model
apps/
  remote/                    # Bun workspace: Vite + React remote application
characters/
  <id>/character.json, bible.md
scripts/
  setup.sh, setup-pi.sh, dev-kiosk.sh
spikes/
  qwen-probe/, https-mic/
```

The root uses Bun workspaces (`apps/*`). `bun run build:remote` builds the `/phone/` bundle; `bun run build:kiosk` bundles the kiosk with `--public-path=/dist/`.

`bun run dev:kiosk` opens a **480×320 desktop Chromium correctness preview**. It validates layout and animation shape only; it does not establish Pi GPU performance, SPI refresh, colour, scaling, or on-panel fps.

### 3.2 Sessions, Conversations, And Persistence

`bun:sqlite` is native, zero-dependency persistence. Startup creates the schema, scrubs tag-shaped artifacts from stored message content, then rebuilds scheduler timers for still-active tasks.

| Table           | Shipped Fields And Purpose                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `conversations` | `{id, title, created_at}` for the remote sidebar                                                |
| `messages`      | `{id, conversation_id, role, content, kind, ts}` for each conversation thread                   |
| `tasks`         | `{task_id, task_name, duration, status, escalation, conversation_id, next_wake_at, created_at}` |
| `settings`      | Persisted active conversation, selected character, and audio sink                               |

The session has one active conversation shared by connected clients. `hello` hydrates a client with conversation list, active conversation, task list, message history, active/listed characters, and audio-sink state. Conversation create, switch, delete, reset, and editable titles are WS operations; each task and message event is scoped with `conversationId`.

### 3.3 Input, Task Capture, And Lifecycle

Text and audio inputs carry `source: 'phone' | 'device'` through the input-adapter seam. The ordered turn queue serializes user turns and scheduler ticks; device microphone and wake-word hardware remain outside the MVP, while the kiosk exposes a flag-gated device-input affordance.

On an empty conversation, Sahur sends a cold-start line that gauges the user's task intent. During ordinary conversation, the same reply generation can emit `<|task:NAME|MINUTES|>`; malformed or out-of-bounds tags are stripped and ignored. A captured task is scoped to the active conversation and is scheduled from its duration.

| Lifecycle                   | Kernel Behavior                                                        |
| --------------------------- | ---------------------------------------------------------------------- |
| `pending`                   | First duration interval elapses                                        |
| `reminding`                 | Reminder emitted; next wake is one task duration later                 |
| `escalated` level 1, then 2 | Each ignored follow-up advances one level and re-arms for one duration |
| `missed`                    | A third ignored state ends the task and clears its wake time           |
| `done` / `dismissed`        | Terminal manual actions that cancel scheduling                         |

The model can auto-complete an active task with `<|task_done:REFERENCE|>`. Resolution is exact task id, then a unique id prefix of at least four characters, then an unambiguous task-name match. The remote Tasks island also provides explicit **done** and **discard** actions.

### 3.4 Tags, Prompt, And Orchestration

The tag grammar is streaming text, not JSON mode. Supported kinds are `emotion`, `remind`, `escalate`, `task`, `task_done`, and `schedule`. The parser tolerates malformed tag-shaped output by removing it from visible text, holds a trailing partial tag across streamed chunks, bounds arguments, and deduplicates events per turn. Effects carry an immediate or audio-boundary playback cue.

The five-layer prompt is stable-to-volatile:

| Layer | Content                                                                                                  | Cacheability          |
| ----- | -------------------------------------------------------------------------------------------------------- | --------------------- |
| L0    | Language and exact tag grammar                                                                           | Shared, stable        |
| L1    | Selected character identity, voice, and comedy; 25–35 spoken-word cap                                    | Per character, stable |
| L2    | Agent rules and tag/tool policy                                                                          | Shared, stable        |
| L3    | Character do/don't guidance and lore                                                                     | Per character, stable |
| L4    | Active task list with `[shortid]`, escalation, next wake, trigger, actions/tool result, and recent turns | Recomputed last       |

L4 is character-capped at roughly 500–800 tokens and pulls only recent turns from the **active conversation**. It sanitizes tag artifacts before prompt inclusion.

After the first user/assistant exchange, title generation runs fire-and-forget in a separate small Qwen request. Its JSON-object instruction uses the instance form `{"title":"your title here"}`, accepts a short title only, trims it to 60 characters, pushes a `title` event, and logs failures without delaying the turn.

The orchestrator strips and normalizes output before persistence and TTS. Text upload and vision failures use the same crash-hardened asynchronous path: errors are logged and an in-character fallback message is persisted and broadcast.

### 3.5 Character And Kiosk Rendering

Each `characters/<id>/` bundle contains `character.json` (identity, stock voice seam, model parameters, action mappings, escalation flavor) and `bible.md` (identity, voice, comedy, do/don't guidance, lore). Sahur is the only built character; the registry, picker, prompt, and model seams support additional presets.

**Three.js is the sole kiosk renderer.** There is no alternate renderer path. If WebGL mounting fails, the kiosk shows **RENDERER ERROR — check GPU/WebGL** rather than changing renderers. The renderer consumes the shared event vocabulary, amplitude-driven mouth channel, and audio-boundary actions.

Sahur is a procedural primitive-composition model in `src/kiosk/model`: a wooden-log body, sculpted face, mouth-center jaw pivots, expression poses, and an escalating baton-knock animation. The character-agnostic renderer API is `setExpression`, `setMouth`, `playAction`, `setSpeaking`, and `dispose`.

**T13 On-Panel FPS:** **MARKED placeholder — measured sustained Three.js fps on the Pi5 SPI panel.** This is informational scene-tuning evidence, not a renderer-selection gate.

### 3.6 Remote Application And Wire Contract

The remote application is Vite + React with a hand-rolled CSS token system. It uses `html[data-theme]` light/dark tokens, a localStorage-backed no-flash theme script, self-hosted Fredoka, and a minimal custom markdown parser/renderer that creates React elements without `dangerouslySetInnerHTML`.

The UI has a 720px chat column, a bottom composer, and edge drawers for conversations and tasks. The task island shows live status, countdowns from `nextWakeAt`, escalation, done/discard controls, and a lifecycle tooltip.

`src/shared/protocol.ts` is the sole wire contract.

| Direction       | Shipped Messages                                                                                                                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client → Server | `hello`, `text`, `audio_end`, binary audio frames, `interrupt`, `audio_sink`, conversation CRUD, `reset`, `character_select`, `escalate`, `task_action`, `title_edit`, `camera_stub`                                 |
| Server → Client | Transcript, tokens, avatar, PCM16LE TTS chunks, status, error, notice, done, reply, ordered agent events, conversation list/active state, title, task list, message/history, character active/list, audio-sink state |

`task_list` includes status, escalation, and `nextWakeAt`. `task_action` accepts `done` or `discard`. `audio_sink` keeps exactly one playback target active — Phone or Device — while the kiosk still receives envelope/amplitude data for lip-sync. Every conversation-dependent event carries `conversationId`.

### 3.7 Upload, Vision, And Discovery

`POST /upload` accepts multipart field `file` only. Server validation limits uploads to 5 MB, returns **413** for oversize files and **415** for unsupported type/extension, and allows `.txt`/`.md` text and `.png`/`.jpg`/`.jpeg`/`.webp` images. Text is capped at 4,000 characters before entering active-conversation context. Images are persisted then sent to the asynchronous vision lane; failure returns an in-character fallback without crashing the server.

`GET /info` returns a phone URL using the detected LAN IP, the `sahurhub.local` mDNS URL, and HTTPS port. The kiosk displays the IP URL as the primary phone target. Avahi publishes mDNS; mkcert certificates cover localhost, LAN IP, and `sahurhub.local`, so both remote routes are valid on the hotspot.

---

## 4. Qwen Access And Credentials

**Account:** Alibaba Cloud Model Studio, International/Singapore. `DASHSCOPE_API_KEY` is in `.env.local` and never committed. The central model pins are:

```ini
QWEN_CHAT_MODEL=qwen3.6-flash
QWEN_ASR_MODEL=qwen3-asr-flash
QWEN_TTS_MODEL=qwen3-tts-flash
QWEN_BASE_URL=
```

`scripts/setup.sh` preserves an existing `.env.local`, otherwise copies `.env.example`, installs dependencies, builds both browser applications, and creates a development certificate when mkcert is available. Billing-alert configuration remains an account-console responsibility.

---

## 5. The 2-Hour Rebuild Plan (Finals)

The prototype is built during prelims, then regenerated on-site from the prepared TRD prompt pack while hardware is configured. The supported operating-system pin is **Raspberry Pi OS Bookworm 64-bit (Desktop)**; the server/webapp portion is Debian-family best effort.

1. Boot the prepared Pi 5 SD card, or flash Bookworm 64-bit under the no-preflashed-SD branch.
2. Regenerate the Bun server, full Vite/React remote app, protocol, kernel, prompt compiler, character bundle, and Three.js model from the prompt pack.
3. Run `sudo ./scripts/setup-pi.sh`, the idempotent provisioning backbone. It installs Bun, mkcert, Avahi, dependencies, both builds, optional hotspot profile, `sahurhub.service`, and Bookworm labwc Chromium kiosk autostart.
4. Confirm `/boot/firmware/config.txt` contains `dtoverlay=piscreen,drm,speed=18000000,rotate=90` (hardware-confirmed 24 Jul: stock `piscreen.dtbo` drives this ILI9486 panel; `waveshare35a` does not exist in stock Bookworm; `rotate=90` = upright portrait); reboot. Do not use LCD-show on Pi 5/Bookworm.
5. Join the phone hotspot, trust the local HTTPS certificate on the phone, and use the IP URL as the primary remote route with `sahurhub.local` as mDNS alternative.
6. Smoke-test text, push-to-talk, task capture and completion, reminder tick, device/phone audio sink, upload, and the kiosk renderer.

The team runs regeneration and hardware work in parallel. A private reference repository is retained for recovery; fresh on-site history demonstrates the rebuild.

**T16 Rebuild Timings:** **MARKED placeholder — stopwatch timings for steps 1–6 under both SD-card branches.**

For end-to-end operational detail, use [runbook.md](runbook.md).

---

## 6. Poster Production Pipeline

**Status: shipped and submitted 17 July 2026.** The 1080×1080 poster is externally image-generated and refined outside this repository. The repository does not contain an HTML compositor or screenshot-export pipeline for the poster.

Manual compliance review verifies:

- exact 1080×1080 PNG or JPG output;
- a legible, unaltered Qwen logo;
- the legible model name **Qwen3.6-Flash**;
- compliance with [project-requirements.md](project-requirements.md) format and content rules.

Official unaltered logo assets remain in `assets/poster/logo/` as the reference standard.
