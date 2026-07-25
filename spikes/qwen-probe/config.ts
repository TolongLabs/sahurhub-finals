// T4 spike config. Throwaway — env-driven so the probe never hardcodes the
// account's real gateway host or key. Bun auto-loads the repo-root
// .env.local, which carries DASHSCOPE_API_KEY (never printed/logged here).
//
// QWEN_BASE_URL / QWEN_WS_HOST are NOT set in the committed .env.local —
// this account uses a dedicated/personal MaaS gateway, not the documented
// dashscope-intl endpoint, so the default below (not dashscope-intl) is
// this spike's own fallback, overridable via env for a future differently
// provisioned account. This does NOT change qwen-chained-backend.ts's
// production default, which stays dashscope-intl per docs/trd.md §2/§4.

const DEFAULT_GATEWAY_HOST = 'ws-4m8noeuxh5w6mqih.ap-southeast-1.maas.aliyuncs.com'

export const WS_HOST = process.env.QWEN_WS_HOST ?? DEFAULT_GATEWAY_HOST
export const BASE_URL = process.env.QWEN_BASE_URL ?? `https://${DEFAULT_GATEWAY_HOST}`

export const API_KEY = process.env.DASHSCOPE_API_KEY
if (!API_KEY) {
  throw new Error('DASHSCOPE_API_KEY is not set — copy .env.example to .env.local and fill it in')
}

export const COMPATIBLE_URL = `${BASE_URL}/compatible-mode/v1`
export const NATIVE_URL = `${BASE_URL}/api/v1`
export const MULTIMODAL_URL = `${NATIVE_URL}/services/aigc/multimodal-generation/generation`
export const REALTIME_WS_URL = `wss://${WS_HOST}/api-ws/v1/realtime`

export const MODELS = {
  chat: process.env.QWEN_CHAT_MODEL ?? 'qwen3.6-flash',
  tts: process.env.QWEN_TTS_MODEL ?? 'qwen3-tts-flash',
  asr: process.env.QWEN_ASR_MODEL ?? 'qwen3-asr-flash',
  omniHttp: process.env.QWEN_OMNI_HTTP_MODEL ?? 'qwen3.5-omni-plus',
  realtime: process.env.QWEN_REALTIME_MODEL ?? 'qwen3.5-omni-plus-realtime'
} as const

export function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
}

export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return Number.NaN
  const idx = Math.min(sortedAsc.length - 1, Math.ceil((p / 100) * sortedAsc.length) - 1)
  return sortedAsc[Math.max(0, idx)]
}
