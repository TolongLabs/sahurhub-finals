# SolarSim ("Sol") Chatbot Reference — 2026-07-15

> PO's grounded-chatbot structure (`~/CS/solar-layout-generator`, backend/src/services/chat/). Studied as the structural reference for SahurHub's LLM layer. Verdict: the skeleton transfers; the persona/grounding content inverts.

## The Structure

Five-layer system instruction assembled by one pure function (`prompt.ts` `buildSystemInstruction()`), joined in fixed stable→volatile order: L0 language lock (EN/MS/ZH + glossary) → L1 persona + hard word cap ("180 words or fewer", enforced in-prompt not via maxOutputTokens) → L2 six hard rules → L3 static knowledge primer (read once, module-cached, byte-identical every call) → L4 live project digest LAST (volatile; unsaved edits overlay saved state per-field; hard-capped 8000 chars). Regex guardrails run first, pre-SSE, rejection costs zero tokens. Streaming: SSE-over-POST, `flushHeaders()` immediately, `X-Accel-Buffering: no`, one event per model chunk, AbortController wired to client disconnect (stops token billing on barge-in).

## Transfers Well to SahurHub (copy)

- Layered prompt composition with volatile-last ordering → L0 voice/language lock, L1 roast persona + hard utterance cap (shorter = faster TTS), L2 minimal safety rules, L3 static bit/device knowledge, **L4 = escalation state + task digest last** (direct analog of Sol's live digest).
- Stable-prefix ordering — and close Sol's gap: **actually engage prefix caching** (Sol orders for it but never calls a cache API).
- Immediate-flush SSE token forwarding → feed streaming TTS; chunk by sentence/clause server-side before TTS.
- Abort-on-disconnect wiring → barge-in kills model + TTS mid-stream.
- In-prompt output cap; missing-data rendered explicitly ("not yet computed") so the model admits absence.
- Error taxonomy w/ localized messages; digest as single source of truth (for SahurHub: task/escalation state, so roasts reference real state).

## Does NOT Transfer (replace)

- **Retry backoff (2–6s+ exponential, 3 attempts): non-starter vs the 7s/10s latency budget** — need sub-second single retry, hedged request, or instant canned in-persona quip fallback.
- Lazy dual-credential client init (first-call auth discovery) — pre-warm/pin at boot.
- 8000-char digest + full knowledge bible per call — trim hard and/or prefix-cache; token cost hits TTFT.
- Regex injection guardrail — low value for an entertainment persona; false positives hurt the bit.
- Strict grounding/no-promises rules, curated chips, 5s cooldown, React useChat client — content is a full rewrite; reuse server streaming shape only.
