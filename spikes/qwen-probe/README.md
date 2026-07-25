# qwen-probe (T4 spike)

Throwaway Bun/TS scripts probing the 5 candidate Qwen paths against this
account's real DashScope-compatible gateway. See `REPORT.md` for the
findings, latency tables, and promotion-gate verdict.

## Running

Requires `DASHSCOPE_API_KEY` in the repo-root `.env.local` (Bun auto-loads
it). This account is provisioned on a dedicated/personal MaaS gateway, not
the documented `dashscope-intl` endpoint — `config.ts` defaults to that
gateway host, overridable via `QWEN_BASE_URL` / `QWEN_WS_HOST` env vars for
a differently provisioned account.

```bash
bun run spikes/qwen-probe/chat-probe.ts        # leg 2 — chat TTFT + thinking suppression
bun run spikes/qwen-probe/tts-probe.ts         # leg 3 — voice pick + synthesis, writes out/*.wav
bun run spikes/qwen-probe/asr-probe.ts         # leg 4 — closed-loop transcription of the TTS wavs
bun run spikes/qwen-probe/omni-http-probe.ts   # leg 5 — text-in/audio-out over HTTP
bun run spikes/qwen-probe/realtime-probe.ts    # leg 6 — realtime WS, feeds the TTS wavs, applies the gate
```

Run `tts-probe.ts` before `asr-probe.ts` / `realtime-probe.ts` — both reuse
`out/phrase-{1,2,3}.wav`.

## Files

- `config.ts` — env-driven base URL / WS host / model IDs / auth headers.
- `wav.ts` — raw PCM16LE -> WAV container encoder (kept for reference; the
  live TTS responses turned out to return a ready-made `.wav` URL instead —
  see `REPORT.md` gotchas — so the probes don't end up calling this).
- `out/` — synthesized `.wav` files from `tts-probe.ts` (gitignored-worthy
  scratch output; harmless to keep for the spike record).

## Quota discipline

Kept deliberately small against the free-tier ceilings: TTS stayed under
~130 characters total (budget was 3k), ASR billed 7 seconds total (budget
200s), and every chat/omni/realtime call used short capped replies (budget
1M tokens each, effectively unlimited at this scale).
