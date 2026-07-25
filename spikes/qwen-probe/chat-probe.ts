// Leg 2 — chat TTFT + enable_thinking suppression check, qwen3.6-flash.
// Streams 10 short identical-shape calls over the OpenAI-compatible
// /chat/completions endpoint and measures end-of-request -> first-token
// latency. Also checks whether any `reasoning_content` delta or a literal
// <think> tag leaks through with our current suppression method
// (chat_template_kwargs.enable_thinking=false, matching the production
// qwen-chained-backend.ts code) so T4 can report the gotcha honestly.

import { COMPATIBLE_URL, MODELS, authHeaders, percentile } from './config.ts'

interface ChatDelta {
  choices?: [{ delta?: { content?: string; reasoning_content?: string } }]
}

async function oneCall(suppressVariant: 'chat_template_kwargs' | 'top_level' | 'none') {
  const start = performance.now()
  const body: Record<string, unknown> = {
    model: MODELS.chat,
    stream: true,
    max_tokens: 40,
    messages: [
      { role: 'system', content: 'You are a terse assistant. Reply in one short sentence.' },
      { role: 'user', content: 'Remind me to sleep before sahur in one short sentence.' }
    ]
  }
  if (suppressVariant === 'chat_template_kwargs') body.chat_template_kwargs = { enable_thinking: false }
  if (suppressVariant === 'top_level') body.enable_thinking = false

  const res = await fetch(`${COMPATIBLE_URL}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body)
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    return { ok: false as const, status: res.status, text: text.slice(0, 500) }
  }

  let firstTokenMs: number | undefined
  let sawReasoning = false
  let sawThinkTag = false
  let full = ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const payload = line.replace(/^data:\s*/, '').trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const parsed = JSON.parse(payload) as ChatDelta
        const delta = parsed.choices?.[0]?.delta
        if (delta?.reasoning_content) sawReasoning = true
        if (delta?.content) {
          if (firstTokenMs === undefined) firstTokenMs = performance.now() - start
          full += delta.content
          if (full.includes('<think>')) sawThinkTag = true
        }
      } catch {
        // keepalive line
      }
    }
  }
  return { ok: true as const, firstTokenMs: firstTokenMs ?? Number.NaN, sawReasoning, sawThinkTag, full }
}

async function main() {
  console.log(`[chat-probe] model=${MODELS.chat} suppression variant: chat_template_kwargs (production code)`)
  const ttfts: number[] = []
  let anyReasoning = false
  let anyThinkTag = false
  let firstSample: string | undefined
  for (let i = 0; i < 10; i++) {
    const r = await oneCall('chat_template_kwargs')
    if (!r.ok) {
      console.log(`  call ${i + 1}: FAILED status=${r.status} body=${r.text}`)
      continue
    }
    ttfts.push(r.firstTokenMs)
    anyReasoning ||= r.sawReasoning
    anyThinkTag ||= r.sawThinkTag
    if (!firstSample) firstSample = r.full
    console.log(`  call ${i + 1}: TTFT=${r.firstTokenMs.toFixed(0)}ms reasoning_content=${r.sawReasoning}`)
  }
  ttfts.sort((a, b) => a - b)
  console.log(`[chat-probe] sample reply: ${JSON.stringify(firstSample)}`)
  console.log(`[chat-probe] P50=${percentile(ttfts, 50).toFixed(0)}ms P95=${percentile(ttfts, 95).toFixed(0)}ms`)
  console.log(`[chat-probe] any reasoning_content leaked: ${anyReasoning}; any literal <think> tag: ${anyThinkTag}`)

  // One control call with the alternate (top-level enable_thinking) variant,
  // to check whether it's a better/different suppression method.
  const alt = await oneCall('top_level')
  if (alt.ok) {
    console.log(
      `[chat-probe] control (top-level enable_thinking=false): reasoning_content=${alt.sawReasoning} reply=${JSON.stringify(alt.full)}`
    )
  } else {
    console.log(`[chat-probe] control (top-level enable_thinking=false): FAILED status=${alt.status} ${alt.text}`)
  }
}

main().catch((err) => {
  console.error('[chat-probe] fatal', err)
  process.exit(1)
})
