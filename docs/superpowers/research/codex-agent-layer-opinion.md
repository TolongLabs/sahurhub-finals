## 1. Recommended Architecture

Use an **A-derived hybrid: a local deterministic Agent Kernel with streaming inline action tags, plus a classic tool loop only for observation-dependent tools such as `inspect_camera`**. One Bun process should own the scheduler, task/escalation state machine, ordered event queue, tool policy, and Qwen adapters; scheduler ticks and user turns enter the same kernel, so the character can initiate actions without a user message. Qwen streams short speech containing tags such as `<|emotion:smug|>` and `<|drum:3|>`; the existing parser removes them from speech and emits validated events without another model call. This preserves A’s latency advantage while fixing raw A’s main weakness: tags are intentions, not unrestricted actuator commands. B is too slow as the default because every fast physical action would add a model round trip; retain it only when Qwen must reason over a tool result. C is a valuable voice transport but not the agent architecture itself, and its unverified long-lived cloud session is too fragile to be the only path. The strongest judge-visible moment should be an **unprompted scheduler tick causing the character to wake, change expression, drum, and escalate**, not merely a fast chatbot reply.

## 2. Latency Budget Table

Engineering estimates below are from the end of speech to audible playback. They assume a 6–8 second utterance, a pre-warmed client, a response capped at 25–35 spoken words, and TTS beginning after the first 6–12-word clause.

| Stage                                     | Chained: Typical / Planning P95 | Realtime: Typical / Planning P95 | Notes                                                                                           |
| ----------------------------------------- | ------------------------------: | -------------------------------: | ----------------------------------------------------------------------------------------------- |
| Phone audio finalization and upload to Pi |                    150 / 350 ms |                     120 / 300 ms | Audio should stream during speech; only final flush remains                                     |
| ASR                                       |                  850 / 1,800 ms |                     180 / 450 ms | Realtime figure is residual endpointing/recognition after speech; it is fused with the session  |
| LLM TTFT                                  |                  450 / 1,000 ms |                     300 / 800 ms | Stable cached prompt prefix and pre-warming are assumed                                         |
| Tag parsing, validation, and dispatch     |                       5 / 20 ms |                        5 / 20 ms | Local and non-blocking; no model round trip                                                     |
| TTS first byte                            |                1,100 / 2,200 ms |                     350 / 750 ms | Chained figure includes accumulating the first speakable clause; realtime is fused voice output |
| Playback prebuffer and start              |                    120 / 250 ms |                     100 / 200 ms | Keep the audio buffer around 80–150 ms                                                          |
| **Total**                                 |            **2,675 / 5,620 ms** |             **1,055 / 2,520 ms** | Both pass 7 seconds under expected conditions                                                   |

The realtime stage allocations are conceptual because ASR, reasoning, and synthesis overlap inside one session. Camera inspection is deliberately excluded: the first call speaks an in-persona filler clause, while camera capture and the observation-dependent second call run asynchronously.

Enforce the latency requirement locally:

- At 4.5 seconds, if Qwen text exists but cloud TTS has not started, switch that text to browser WebSpeech.
- At 6.5 seconds, if no usable model text exists, play a short local in-persona failure line and continue recovery.
- Cancel generation and TTS on barge-in to stop both latency and billing.

That makes the 10-second requirement enforceable even though no cloud service can provide a hard venue-network guarantee.

## 3. Cost Estimate Vs RM50

The supplied documents contain model IDs but no current DashScope tariffs. These are therefore conservative planning allowances—not claimed vendor prices. Assumption: 6–8 seconds of user audio, 25–35 spoken output words, a small cached prompt, and no retry.

| Path                      | Models                                                  | Planning Cost Per Turn | Turns From RM50 | Conservative Turns From RM40 |
| ------------------------- | ------------------------------------------------------- | ---------------------: | --------------: | ---------------------------: |
| Chained primary           | `qwen3-asr-flash` + `qwen3.6-flash` + `qwen3-tts-flash` |            RM0.01–0.04 |     1,250–5,000 |  1,000 at the upper estimate |
| Chained with realtime TTS | Above, with `qwen3-tts-flash-realtime`                  |            RM0.02–0.06 |       833–2,500 |    666 at the upper estimate |
| HTTP omni                 | `qwen3.5-omni-plus`                                     |            RM0.03–0.08 |       625–1,667 |    500 at the upper estimate |
| Full realtime             | `qwen3.5-omni-plus-realtime`                            |            RM0.05–0.15 |       333–1,000 |    266 at the upper estimate |
| Camera observation        | Omni vision second call                                 |        Add RM0.02–0.05 |   Use sparingly |                            — |

A realistic development-and-demo burn is approximately **RM25–32**:

- 200 chained development turns at the conservative ceiling: RM8
- 50 realtime spike/rehearsal turns: RM7.50
- 20 camera inspections: approximately RM1
- 30 worst-case realtime demo/rehearsal turns: RM4.50
- Retries, malformed outputs, and billing variance: RM4–11

Reserve at least RM10 and set account-side alerts at RM25 and RM40. Response-length limits, prefix caching, barge-in cancellation, and disabling automatic retries matter more than text-token optimization.

## 4. Chained Vs Realtime Verdict

**Primary finals path: chained.** Its estimated 2.7-second typical and 5.6-second planning-P95 latency already meet the presentation requirement, while stateless HTTP calls are easier to debug, rehearse, and restore over a hostile hotspot. It also provides clean access to the text stream, which is essential for stripping action tags before TTS.

Use this ladder:

1. **Rebuild baseline:** `qwen3-asr-flash` → streaming `qwen3.6-flash` → `qwen3-tts-flash`.
2. **Low-risk upgrade:** swap only TTS to `qwen3-tts-flash-realtime`.
3. **Full-speed upgrade:** use `qwen3.5-omni-plus-realtime` only after it passes the API spike, while retaining the same Agent Kernel and event contract.
4. **First downgrade:** chained reasoning with browser WebSpeech instead of cloud TTS.
5. **Second downgrade:** typed/remote-button input → `qwen3.6-flash` → WebSpeech.
6. **Last-resort stage continuity:** deterministic scheduler, local drum/expression tools, and a small set of in-persona failure lines.

Do not implement `qwen3.5-omni-plus` HTTP as a third production adapter unless the spike proves that it replaces the chained trio with lower complexity and a P95 below five seconds. Adapter proliferation is a bigger finals risk than model optionality.

For the poster, name the model actually demonstrated: use **Qwen3.5-Omni** only if realtime passes the promotion gate; otherwise name **Qwen3.6-Flash** as the central reasoning brain.

## 5. Prompt Substrate

Adopt the SolarSim structure, substantially shortened:

- **L0 — Language and protocol lock:** spoken language, permitted tag grammar, never vocalize tag syntax.
- **L1 — Persona and response cap:** confidently wrong, affectionate sahur-style roast, one short setup and one punchline, maximum 25–35 spoken words.
- **L2 — Agent rules and tool policy:** available capabilities, when tool requests are appropriate, and prohibition on inventing tool results.
- **L3 — Static device knowledge:** character premise, tool descriptions, action limits, and a few canonical examples. Keep byte-identical and prefix-cacheable.
- **L4 — Volatile state last:** current task, deadline, escalation level, next wake time, scheduler trigger, recent actions, and tool result. Hard-cap this layer to roughly 500–800 tokens.

The server—not the prompt—owns truth. A minimal state snapshot should hold the task, status, escalation level `0..2`, `nextWakeAt`, and last action IDs. All user turns, scheduler ticks, and tool results pass through one serialized event queue. Kawan’s `0→1→2` ladder controls tone, but the state machine validates every increment, clamp, snooze, and reset.

Resolve the JSON/tag conflict by choosing **inline tags as the model-generation format**. Streaming JSON delays safe speech until enough of the object has arrived, makes partial recovery harder, and is poorly suited to interleaving actions with spoken timing. Reuse Kawan’s `{say, emotion, escalate}` as the normalized internal and final wire summary after parsing—not as raw model output.

For example:

```text
<|emotion:smug|>Wake up. Your terrible plan has summoned the drum council.<|drum:3|><|escalate|>
```

The parser produces spoken text immediately, an emotion event, a bounded drum request, and an escalation request. After local validation, the turn summary becomes:

```json
{
  "say": "Wake up. Your terrible plan has summoned the drum council.",
  "emotion": "smug",
  "escalate": 2
}
```

Other physical actions travel as ordered `AgentEvent`s rather than being added to that JSON contract. Parse tags at token time, but synchronize drums and other theatrical effects to the preceding audio playback boundary; immediate execution can otherwise occur seconds before the corresponding words are heard.

## 6. Top 3 Risks + Mitigations; What To Spike First

| Risk                                                          | Consequence                                 | Mitigation                                                                                                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Realtime endpoint, region, SDK, or cloud WebSocket fails      | Dead air or no demo                         | Make chained HTTP the rehearsed baseline; pre-warm at boot; retain captured audio for failover; use 4.5/6.5-second local fallbacks; use the phone hotspot                              |
| Tags are malformed, spoken aloud, duplicated, or unsafe       | Broken bit or uncontrolled physical actions | Strict allowlist grammar; strip tags before TTS; bounded arguments; per-turn deduplication; rate-limit drums; validate state transitions; queue playback-synchronized effects          |
| Multi-path architecture and camera consume the rebuild window | Working parts but no integrated prototype   | One Agent Kernel, one `VoiceBackend` interface, two production backends maximum, no database or external queue; keep camera asynchronous and removable without affecting the core demo |

**First API-key spike:** run the voice-path probe before persona tuning or UI integration.

Use 20 identical prerecorded 6–8-second utterances per candidate path and record:

- Model/voice availability for the actual account and region.
- End-of-speech-to-first-audio P50 and P95.
- Exact billed units and RM-equivalent cost per turn.
- Whether realtime transcript/control events arrive early enough for tags.
- Whether any tag syntax leaks into realtime-generated audio.
- Session reconnect time after a forced hotspot interruption.
- Chained recovery after individual ASR, LLM, and TTS failures.

Promote full realtime only if it achieves **P95 ≤2.5 seconds**, reconnects within **2 seconds**, never vocalizes tags in the tagged trials, and costs **≤RM0.15 per normal turn**. Require the chained path to achieve **P95 ≤6 seconds**. Otherwise keep chained primary without further debate.

## 7. Disagreements

- **Classic tool calling is not inherently “deeper” agent behavior.** Initiative, owned state, policy-controlled tools, and observation-driven follow-ups establish agency; unnecessary model loops merely add latency.
- **Physical actions should not execute blindly at raw token time.** Parse immediately, but validate state-changing actions and synchronize theatrical effects to actual audio playback.
- **Full realtime is a transport upgrade, not the architectural foundation.** Direct voice output may make tag suppression and action ordering harder, and this must be demonstrated rather than assumed.
- **A hard 10-second cloud SLA is not credible on a hostile venue network.** The system can only guarantee it through a local audible fallback.
- **`inspect_camera` should not sit on the core turn’s critical path.** It is the one justified asynchronous tool loop; if the finals rebuild slips, remove camera while preserving scheduler initiative, state, drum, expression, escalation, and wake scheduling.
