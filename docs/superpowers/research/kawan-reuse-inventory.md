# Kawan Reuse Inventory — 2026-07-15

> Kawan (`~/CS/chutes/chutes-hack/dev`) — "skeptical accountability companion" (Chutes Hack Malaysia 2026): one commitment + deadline, demands real evidence (GitHub/file/screenshot judged by vision model), Live2D avatar reacts, scheduled check-ins, escalation, witness-email stakes. Backend Python/FastAPI (wrong stack — reference for logic only); frontend React 18 + TS (TS pieces drop in).

## Top Lifts for SahurHub (effort at rebuild time)

1. **Escalation-tone prompt ladder + JSON contract** (`backend/app/prompts.py` — `checkin_system()`, `CHECKIN_SCHEMA`): one LLM call returns `{say, emotion, escalate}`; escalation int 0→1→2 = gentle → direct → blunt. Rewrite the wellness primer into the sahur/roast bit. **~15 min. Highest leverage — this IS the escalating wake-up-call engine.**
2. **Amplitude lip-sync loop** (`frontend/src/zone2/live2d/Live2DStage.ts` `speak()` L122–170): AnalyserNode → 85–255 Hz peak → mouth param each rAF. Avatar-agnostic — retarget to sprite mouth frames. Plus `speakText()` L200–266: WebSpeech fallback = talking character with zero TTS infra. **~20–30 min.**
3. **Scheduler timing + status state machine** (`backend/app/scheduler.py` cadence/midpoint-nudge/win-back = 25% of remaining window clamped 30min–6h; `backend/app/state.py` status machine; `backend/app/pipeline.py` L162–164 escalation counter: reset on evidence, `min(2, +1)` on silence; L205–218 "2 silent ticks → lapsed"). Port to a small Bun timer module. **~30–40 min.**
4. **WS envelope + hub contract** (`backend/app/ws.py` ~40-line per-user hub; `frontend/src/timeline/useWorkspaceSocket.ts` "WS = live signal, refetch on push"; payload `{type, say, emotion, escalation}`). Rewrite in Bun native WS; **add auto-reconnect** (Kawan omits it). **~20 min.**
5. **Qwen/Chutes JSON-mode gotchas** (`backend/app/chutes.py`): reasoning models need `response_format: json_object` + `chat_template_kwargs: {enable_thinking: false}` + schema pinned in-prompt (strict json_schema mode → xgrammar blowup); port `_extract_json()` (strips <think>/fences, balanced-brace scan) to TS verbatim. **~10 min reading saves ~45 min debugging.**

## Also Useful

- `backend/app/personas.py` — persona-as-preset pattern (tone fragment + avatar + voice + model routing); the roast persona is one preset in this shape.
- `frontend/src/zone2/keyEvents.ts` — pure-TS status→key-event mapper (~90 lines, drops into Bun/TS as-is); maps onto normal call → louder call → roast.
- `frontend/src/zone2/live2d/modelRegistry.ts` — emotion→expression `Record<Emotion, string>` table pattern; swap Live2D names for sprite frames.
- `frontend/src/zone2/voice/useVoice.ts` + `personaVoices.ts` — server-TTS-else-WebSpeech seam, per-persona pitch/rate (~50 lines each).
- Feature-UX patterns: grace windows, streaks, win-back nudge, "no mark-as-done button".

## Not Reusable

Live2D/PixiJS rendering, Python/FastAPI backend as code, evidence-verification subsystem, auth/billing (Chutes OAuth), email/WebPush/Telegram notify stack, analytics/achievements.
