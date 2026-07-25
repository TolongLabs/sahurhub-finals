# T4 Spike Notes — Qwen Live Availability + Realtime Promotion Gate

Run 2026-07-15 against this account's real `DASHSCOPE_API_KEY`, on a
**dedicated/personal MaaS gateway** (`ws-4m8noeuxh5w6mqih.ap-southeast-1.maas.aliyuncs.com`),
**not** the documented `dashscope-intl.aliyuncs.com` endpoint. Every finding
below is gateway-specific until re-verified against the documented endpoint
(flagged where behavior might plausibly differ).

## 1. Availability Matrix

| Model                        | Leg                     |   Reachable?    | Works as documented?                                                                                                                        |
| ---------------------------- | ----------------------- | :-------------: | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `qwen3.6-flash`              | chat (OpenAI-compat)    |       Yes       | Yes — `chat_template_kwargs.enable_thinking:false` fully suppresses `reasoning_content`                                                     |
| `qwen3-tts-flash`            | TTS (native multimodal) |       Yes       | Partially — works, but returns an **OSS URL**, not inline base64 `data` (gotcha #1)                                                         |
| `qwen3-asr-flash`            | ASR (native multimodal) |       Yes       | Partially — works, but `message.content` is an **array of parts**, not a string (gotcha #2)                                                 |
| `qwen3.5-omni-plus`          | HTTP text-in/audio-out  | Yes (text only) | **No** — audio modality accepted + billed, but never returns audio bytes (gotcha #3)                                                        |
| `qwen3.5-omni-plus-realtime` | realtime WS             |       Yes       | Mostly — full OpenAI-Realtime-shaped protocol works, but **tag syntax leaks into the spoken transcript** (gotcha #4, the gate-relevant one) |

## 2. Latency Tables

### Leg 2 — Chat (`qwen3.6-flash`, streamed, 10 calls)

| Metric                       | Value     |
| ---------------------------- | --------- |
| TTFT P50                     | 365 ms    |
| TTFT P95                     | 533 ms    |
| `reasoning_content` leaked   | No (0/10) |
| Literal `<think>` tag leaked | No (0/10) |

### Leg 3 — TTS (`qwen3-tts-flash`, 3 phrases, ~35–49 chars each)

| Metric                  | Value                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| Candidate voices probed | `Ethan`, `Dylan`, `Chelsie` — **all 3 valid**                                                       |
| Voice picked            | **`Ethan`** (male, described in account docs as an energetic/sunny voice — best Sahur fit of the 3) |
| Avg first-byte latency  | 753 ms (640 / 885 / 735 ms)                                                                         |
| Total characters billed | 127 / 10,000 free-tier budget                                                                       |

### Leg 4 — ASR (`qwen3-asr-flash`, closed loop on the 3 TTS wavs)

| Metric                  | Value                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| Avg latency             | 665 ms                                                                                         |
| Total seconds billed    | 7 / 16,000 free-tier budget                                                                    |
| Exact-match transcripts | 2/3                                                                                            |
| Near-miss               | 1/3 — "sahur" transcribed as "Our" (uncommon/loanword risk for ASR, worth a persona-copy note) |

### Leg 5 — Omni HTTP (`qwen3.5-omni-plus`, 1 non-streaming + 1 streaming call)

| Metric                              | Value                                                  |
| ----------------------------------- | ------------------------------------------------------ |
| Non-streaming latency               | 1,607 ms (text arrived; no audio)                      |
| Streaming first `delta.audio` chunk | 897 ms (chunk present, but never carries a `data` key) |
| Usable audio bytes returned         | **No**, in either mode                                 |

### Leg 6 — Realtime (`qwen3.5-omni-plus-realtime`, WS, 5 turns reusing the TTS wavs as input speech)

| Metric                                                                      | Value                            | vs. gate                             |
| --------------------------------------------------------------------------- | -------------------------------- | ------------------------------------ |
| Initial connect (WS open → `session.created`)                               | 205 ms                           | —                                    |
| First-audio-out P50                                                         | 1,024 ms                         | ≤ 2.5 s → **PASS**                   |
| First-audio-out P95                                                         | 1,130 ms                         | ≤ 2.5 s → **PASS**                   |
| Reconnect after a 5 s idle gap                                              | 61 ms                            | ≤ 2 s → **PASS (with caveat below)** |
| Tag-grammar syntax vocalized (present in `response.audio_transcript.delta`) | **3 of 5 turns (60%)**           | none allowed → **FAIL**              |
| Cost per turn                                                               | Not directly measurable (see §4) | ≤ RM0.15/turn → **inconclusive**     |

Per-turn transcript samples (leaked ones bolded):

1. "I am already wide awake and ready to seize the last delicious moments of Sahur with you!" — clean
2. **"`<|emotion:smug|>` Perfect, because nothing wakes up a neighborhood faster than the glorious rhythm of the Drum Council!"** — leaked
3. **"`<|escalate|>` I am diving into this meal right now before that knock turns into a thunderous boom!"** — leaked
4. "Jump out of bed this instant and grab a quick bite before the clock strikes!" — clean
5. **"`<|emotion:smug|>` Excellent, because the Drum Council is exactly who we need to blast everyone awake right now!"** — leaked

**Reconnect caveat:** the 61 ms figure is a clean WS close + fresh `session.created`, not a true forced mid-flight network kill — this spike's tooling has no way to simulate an actual severed TCP connection (no hotspot to physically interrupt). Treat 61 ms as a best-case lower bound, not proof the 2 s ceiling holds under a real hostile-hotspot drop.

## 3. Promotion Gate Verdict (Codex opinion §6 thresholds)

| Criterion                            | Threshold     | Result                                                                                                                                               | Verdict                                                                                   |
| ------------------------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Realtime P95 first-audio             | ≤ 2.5 s       | 1,130 ms                                                                                                                                             | **PASS**                                                                                  |
| Realtime reconnect                   | ≤ 2 s         | 61 ms (caveat: graceful, not forced-kill)                                                                                                            | **PASS, weakly verified**                                                                 |
| No tag vocalization in tagged trials | 0 leaks       | 3/5 leaked                                                                                                                                           | **FAIL**                                                                                  |
| Cost                                 | ≤ RM0.15/turn | Not directly measurable this account (see §4)                                                                                                        | **Inconclusive**                                                                          |
| Chained fallback P95                 | ≤ 6 s         | Not separately re-measured this spike (chained legs 2–4 individually sum to well under 2 s serial; full closed-loop chain not timed end-to-end here) | **Not directly measured — recommend a quick follow-up chained-loop timing before finals** |

**Realtime fails the tag-vocalization criterion outright.** Per docs/trd.md §2.2's rule, a strict reading demotes realtime to fallback and promotes chained to rehearsed primary. **Per this task's explicit instruction, this FAIL does not auto-demote realtime** — the PO already chose realtime-primary independent of the gate (`docs/decisions.md`) — this is reported for the humans to weigh, not resolved unilaterally here.

**Why this matters architecturally, not just as a prompt-tuning miss:** the chained path can cleanly strip tags from text _before_ it reaches TTS (a pure text-domain operation, already implemented in `qwen-chained-backend.ts`/kernel). The realtime path generates audio and its transcript **jointly, in one pass** — there is no text-before-TTS boundary to intercept. A stronger system prompt might reduce the leak rate below 60%, but nothing observed here suggests it can be driven to a hard 0%, and the sample (5 turns) is too small to bound the true rate tightly either way. Codex's original risk assessment (§6, "tags are malformed, spoken aloud... uncontrolled physical actions") is directly confirmed by this data, not merely theoretical.

**Possible mitigation to flag for humans (not decided here):** keep the realtime path fully tag-free — drive expression/reminder actions on the realtime path through the Realtime API's structured function/tool-calling channel (a separate JSON side-channel most Realtime-style APIs expose) instead of inline text tags, and reserve the inline-tag grammar for the chained/text paths only. This needs its own follow-up spike; not attempted here to stay inside this task's scope and quota budget.

## 4. Quota / Cost Burned

| Resource                  | Burned                                                                                                    | Budget                                                             | Headroom                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------- |
| Chat/omni/realtime tokens | Low thousands (10 chat calls + 1 control + 2 omni calls + 6 realtime turns, each capped to a short reply) | 1,000,000 (per model)                                              | Effectively unlimited at this scale         |
| TTS characters            | 127                                                                                                       | 3,000 (this spike's self-imposed cap) / 10,000 (account free tier) | 96% headroom against this spike's own cap   |
| ASR seconds               | 7                                                                                                         | 200 (this spike's self-imposed cap) / 16,000 (account free tier)   | 96.5% headroom against this spike's own cap |

**RM cost:** not directly obtainable from any response payload — every `usage` object returned token/character/second counts, never a currency figure. **Billing alerts at RM25/RM40 could not be configured from this task** — that is a Model Studio **console** (GUI) action outside this spike's tool access (no browser automation available here); flagged as an outstanding action item for whoever holds the console login (the PO, per `docs/trd.md` §4 — "Registered by the PO after Gate 1").

## 5. Gotchas Found

1. **TTS response shape mismatch.** `qwen3-tts-flash` returns `output.audio.url` (an OSS-hosted, expiring `.wav` link) with `output.audio.data` as an **empty string**, not inline base64 `data` as `qwen-chained-backend.ts`'s `synthesize()` currently assumes. The `audio_format`/`sample_rate` request parameters also appear to be ignored (the URL always serves a WAV, regardless of the requested `pcm`/`24000` params). **Production code (`src/server/llm/qwen-chained-backend.ts`) will silently produce zero audio chunks on this gateway** — `synthesize()`'s `if (!b64) return` triggers on every call, since `b64` is always `""`. This is out of this task's file scope to fix (scope is base-URL wiring only) — flagged for a follow-up task.
2. **ASR response shape mismatch.** `qwen3-asr-flash`'s `message.content` comes back as an **array of parts** (`[{ text: "..." }]`), not a plain string. `qwen-chained-backend.ts`'s `transcribe()` currently does `body.output?.choices?.[0]?.message?.content ?? ''`, which will return the **array object itself** (truthy, so the `?? ''` fallback never triggers), not the transcribed text. Also out of file scope to fix here — flagged for a follow-up task.
3. **Omni HTTP (`qwen3.5-omni-plus`) never delivers audio on this gateway.** Both streaming and non-streaming requests with `modalities:["text","audio"]` + `audio:{voice,format}` are accepted (200 OK) and **bill `audio_tokens`** in `usage`, but no response ever carries usable audio bytes — non-streaming has no `message.audio` field at all; streaming `delta.audio` chunks only ever carry an empty `transcript`, never a `data` key. Either this gateway doesn't fully support Omni's audio-output feature over this endpoint, or the request shape needs a parameter this spike didn't discover (no live documentation access during this task — see caveat below). Treat rung 2 of the fallback ladder as **currently non-functional on this gateway** until re-verified.
4. **Realtime tag vocalization (the gate-relevant finding, §3 above).** 3 of 5 turns echoed literal `<|...|>` tag syntax into the spoken transcript.
5. **Thinking-mode suppression works as coded.** No `reasoning_content` or `<think>` leakage across 11 chat calls with `chat_template_kwargs.enable_thinking:false` — the production code's suppression method is correct for this gateway, contrary to a plausible worry going in (the user's sanity call before this spike had seen `reasoning_content` — that was almost certainly a call made _without_ the suppression flag; this spike confirms the flag genuinely fixes it).
6. **Sample size and generality caveat.** All numbers above come from a single gateway, single account, single point in time (2026-07-15), and small sample sizes (5–11 calls per leg) per the ≤50k-token/≤3k-char/≤200s budget this task set. Treat P95s and the 60% tag-leak rate as directional, not statistically tight — especially the realtime tag-leak rate, which came from only 5 trials.
7. **No live documentation access during this task.** The realtime WS protocol (event names, auth-via-headers, `session.update`/`input_audio_buffer.append`/`response.create`) was reverse-engineered empirically against the live gateway (this repo's coding agent had no web-search/doc-fetch tool available), not confirmed against Alibaba's published Realtime API reference. It worked as tried on the first attempt, but edge-case event names/fields may differ from what's implemented in `spikes/qwen-probe/realtime-probe.ts`.

## 6. Recommended Primary Path

**Chained stays the safer rehearsed primary on pure gate-correctness grounds** (clean tag stripping is a solved, text-domain problem there) — but this is exactly the PO's already-made, informed tradeoff (`docs/decisions.md`, "own hotspot, verified-cheap, showier"), not a call this report is making. What this spike adds is **hard evidence the realtime tag-leak risk is real and measured at ~60% in a small sample**, not hypothetical — worth weighing against the showmanship gain before finals.

Two concrete asks for the humans, independent of the primary-path decision:

- **Fix-before-demo:** `qwen-chained-backend.ts`'s `synthesize()` and `transcribe()` need the response-shape fixes in gotchas #1–#2 above, or the chained fallback ladder is currently non-functional end-to-end on this gateway despite each individual leg (chat/TTS/ASR) working correctly in isolation. This is the single highest-priority follow-up — the fully-built rehearsed fallback the PO is relying on will not actually produce or hear audio today.
- **Investigate-before-relying:** rung 2 (`qwen3.5-omni-plus` HTTP) is currently a dead end for audio on this gateway (gotcha #3) — if it's meant to stay in the fallback ladder, it needs its own follow-up probe with different request parameters, or should be treated as effectively removed from the ladder until proven otherwise.

**Poster-name residual (Open Questions, plan.md T4/T14):** at least one Omni endpoint (realtime) does return real audio and clears the latency+reconnect gate criteria, so **"Qwen3.5-Omni" holds** as the poster name per A4 — the failing criterion (tag vocalization) is a behavioral gap, not an availability failure, and doesn't trigger the both-Omni-endpoints-fail fallback naming rule in the Open Questions note.
