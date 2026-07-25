// Ports Kawan's `_extract_json()` verbatim in spirit (backend/app/chutes.py):
// strip <think>/<reasoning> blocks and markdown fences, then a direct parse,
// then a balanced-brace scan for the first top-level {...}. Reasoning models
// often wrap structured output in noise; this is the only place SahurHub
// parses JSON out of a Qwen response (title generation) — the primary output
// format is tags-in-prose (docs/trd.md §3.4), not JSON.

export class JsonExtractError extends Error {}

export function extractJson(content: string): unknown {
  let cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '')
  cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '')
  cleaned = cleaned.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1').trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    // fall through to the balanced-brace scan
  }

  const start = cleaned.indexOf('{')
  if (start !== -1) {
    let depth = 0
    let inString = false
    let escapeNext = false
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i]
      if (escapeNext) {
        escapeNext = false
        continue
      }
      if (ch === '\\' && inString) {
        escapeNext = true
        continue
      }
      if (ch === '"') {
        inString = !inString
        continue
      }
      if (inString) continue
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          try {
            return JSON.parse(cleaned.slice(start, i + 1))
          } catch {
            break
          }
        }
      }
    }
  }

  throw new JsonExtractError('no valid JSON object found')
}
