# Inception Research Synthesis — 2026-07-15

> Condensed from three parallel research passes (LLaMaDesu inventory, brainrot landscape, Pi/Qwen feasibility). Feeds hackathon-idea-generator → hackathon-idea-scoring → Gate 1.

## 1. LLaMaDesu Reuse Inventory (~/CS/LLaMaDesu)

React 19 + Vite SPA / FastAPI + WebSocket backend. **60–70% of load-bearing code liftable:**

| Lift                                                                              | Path                                                            | Value                                  |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------- |
| Qwen streaming client (Ollama + OpenAI-compat SSE, qwen3 think-mode/cutoff fixes) | `backend/app/llm/{base,ollama,openai_compat}.py`                | Crown jewel                            |
| Emotion-tag parser (`<\|emotion:NAME\|>` from token stream → face)                | `backend/app/agent/emotion.py`                                  | LLM drives character face              |
| Turn orchestrator (LLM→emotion→sentence→TTS, barge-in)                            | `backend/app/pipeline/orchestrator.py`                          | Spine; strip memory/HA                 |
| WS wire contract + typed client                                                   | `backend/app/protocol.py`, `frontend/src/ws/client.ts`          | Copy wholesale                         |
| Sprite avatar (~130 LOC, dep-free: breathing/blink/amplitude lip-sync)            | `frontend/src/avatar/sprite.ts`                                 | Solves character rendering             |
| Audio: mic capture → 16kHz WAV; gapless PCM playback w/ amplitude for lip-sync    | `frontend/src/audio/{recorder,player}.ts`                       | Self-contained                         |
| Piper TTS / faster-whisper STT adapters                                           | `backend/app/tts/piper.py`, `backend/app/stt/faster_whisper.py` | Pi-appropriate (if local voice wanted) |
| Expression-sprite-set generator via image API                                     | `backend/app/studio/generator.py`                               | AI-generate character faces            |

**Not reusable:** Live2D/pixi path, sidecar TTS (GPT-SoVITS etc.), Home Assistant/MCP stack, memory store, full App.tsx HUD. **Gap:** zero vision/camera code — Qwen-VL integration is net-new.

## 2. Brainrot Landscape (July 2026)

- **Italian brainrot:** past peak, max recognition (T3 Sahur + Ballerina Cappuccina are Fortnite skins since Apr 2026). T3 Sahur is Indonesian-made, sahur/Ramadan-native → strongest Malaysian recognition. **IP mess:** USPTO trademark filings on the names + active lawsuit (Spyder v. Mementum). AI-generated images ≈ uncopyrightable, but names risky → **original homage character + parody name**.
- **凑企鹅 = Gugu Gaga Penguin:** THE Chinese brainrot of 2026 (1.5B+ Douyin plays since Feb). Usable as _generic_ AI baby penguin (don't trace Endfield design, don't sample BanG Dream audio).
- **Concept-level meme of 2026: "confidently wrong AI"** (Doubao hallucination memes, Neuro-sama roast energy, Grok Unhinged/Bad Rudi). Behavior, not character → zero IP risk. Interaction patterns that land: roast the request; absurd refusals w/ elaborate fake reasons; proud confident wrongness; dramatic overreaction (sax-gets-louder); catchphrase interrupts; maliciously-literal compliance.
- **Garnish:** "six sevennn", saxophone swells, Italian Brainrot World Cup brackets.
- **Content flags:** no trademarked names in branding; no sampled audio; affectionate sahur reference OK, never mock the practice; no NSFW escalation; roasts PG, never political/ethnic/religious.

## 3. Feasibility (Pi 5 + Qwen, July 2026)

- **Display:** techeonics article = 3.5" 480×320 SPI (ILI9486). LCD-show script **broken on Pi5/Bookworm**; use one-line KMS/DRM overlay instead (`dtoverlay=piscreen,drm,...`). SPI caps ~15–25fps → fine for pixel art only. **Prefer DSI panel (zero-driver, 60fps) or HDMI fallback.** Confirm Chaos's exact model.
- **Rendering:** WebGL/Three.js on Pi5 Chromium unreliable (7–10fps regressions). **Canvas/CSS pixel-art sprite + 2–4 mouth frames swapped on TTS amplitude = the pragmatic, Ditoo-authentic choice.** Blender-via-MCP / custom 3D: killed.
- **Qwen menu (Model Studio/DashScope, exact IDs):**
  - Headline: **`qwen3.5-omni-plus-realtime`** — voice-in/voice-out one model, WebSocket/WebRTC, ~1s first-audio, 55 voices. Poster name: **Qwen3.5-Omni**.
  - Fallbacks: `qwen3.5-omni-plus` (HTTP, non-realtime), or chained `qwen3.6-flash` + `qwen3-asr-flash` + `qwen3-tts-flash` (49 character voices) (+2–4s).
  - Vision: `qwen3.7-plus` or omni. Text flagship: `qwen3.7-max`.
  - Risks: region/key menu differences (test early), SDK version floors, hotel Wi-Fi vs WebSockets.
- **Remote-input architecture:** phone browser → WS → single Bun server on Pi (serves phone page + kiosk character page; localhost kiosk needs no HTTPS). **getUserMedia needs HTTPS** → mkcert self-signed + QR code. **Assume venue Wi-Fi hostile → phone hotspot is Plan A**, pre-configured, rehearsed. ~300 LOC total.
- **2h rebuild sinks:** OS flash (30–45min!) > display drivers > network/HTTPS > dep installs > Qwen key surprises. **Open question for organizers: does a pre-flashed SD card count as "pre-built work"?** Prepare golden image AND scripted rebuild, stopwatch-rehearsed.

## Bottom-Line Stack Recommendation

Pi 5 + (DSI/HDMI preferred; SPI OK for pixel-art aesthetic) + Chromium kiosk + Canvas pixel-sprite buddy w/ amplitude lip-sync + Bun WS server + phone webapp (mkcert HTTPS, hotspot) + `qwen3.5-omni-plus-realtime` w/ HTTP + chained fallbacks.
