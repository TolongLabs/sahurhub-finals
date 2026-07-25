import { afterEach, describe, expect, test } from 'bun:test'
import { QwenChainedBackend, resolveQwenBaseUrl } from './qwen-chained-backend.ts'

describe('resolveQwenBaseUrl', () => {
  const originalEnv = process.env.QWEN_BASE_URL

  afterEach(() => {
    process.env.QWEN_BASE_URL = originalEnv
  })

  test('defaults to the documented dashscope-intl root with no override', () => {
    process.env.QWEN_BASE_URL = undefined
    expect(resolveQwenBaseUrl()).toBe('https://dashscope-intl.aliyuncs.com')
  })

  test('an explicit argument wins over QWEN_BASE_URL', () => {
    process.env.QWEN_BASE_URL = 'https://env-gateway.example.com'
    expect(resolveQwenBaseUrl('https://explicit-gateway.example.com')).toBe('https://explicit-gateway.example.com')
  })

  test('falls back to QWEN_BASE_URL when no explicit argument is given', () => {
    process.env.QWEN_BASE_URL = 'https://env-gateway.example.com'
    expect(resolveQwenBaseUrl()).toBe('https://env-gateway.example.com')
  })
})

describe('QwenChainedBackend base URL wiring', () => {
  const originalEnv = process.env.QWEN_BASE_URL
  const originalFetch = globalThis.fetch

  afterEach(() => {
    process.env.QWEN_BASE_URL = originalEnv
    globalThis.fetch = originalFetch
  })

  test('generateTitle calls the documented dashscope-intl endpoint by default', async () => {
    process.env.QWEN_BASE_URL = undefined
    const calls: string[] = []
    let request: Record<string, unknown> | undefined
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input))
      request = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"Poster Deadline Panic"}' } }] }))
    }) as typeof fetch

    const backend = new QwenChainedBackend({ apiKey: 'test-key' })
    const title = await backend.generateTitle('hi', 'hello')

    expect(calls).toEqual(['https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions'])
    expect(title).toBe('Poster Deadline Panic')
    expect(request).toMatchObject({
      response_format: { type: 'json_object' },
      chat_template_kwargs: { enable_thinking: false }
    })
    const messages = request?.messages as Array<{ role?: string; content?: string }>
    expect(messages[0]).toEqual({
      role: 'system',
      content:
        'Give this conversation a short title: under 6 words, no trailing punctuation. Reply with ONLY a JSON object of the form {"title": "your title here"}.'
    })
  })

  test('throws when Qwen echoes the JSON schema instead of returning a title', async () => {
    const echoedSchema = '{"type":"object","properties":{"title":{"type":"string"}},"required":["title"]}'
    globalThis.fetch = (async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify({ choices: [{ message: { content: echoedSchema } }] }))) as typeof fetch

    const backend = new QwenChainedBackend({ apiKey: 'test-key' })

    await expect(backend.generateTitle('hi', 'hello')).rejects.toThrow(
      `title generation returned no title: ${echoedSchema}`
    )
  })

  test('an explicit config.baseUrl overrides QWEN_BASE_URL for both endpoint families', async () => {
    process.env.QWEN_BASE_URL = 'https://env-gateway.example.com'
    const calls: string[] = []
    const inlineB64 = Buffer.from('hi').toString('base64')
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return new Response(JSON.stringify({ output: { audio: { data: inlineB64 } } }))
    }) as typeof fetch

    const backend = new QwenChainedBackend({ apiKey: 'test-key', baseUrl: 'https://explicit-gateway.example.com' })
    const chunks: Uint8Array[] = []
    for await (const chunk of backend.synthesize('hi')) chunks.push(chunk)

    expect(calls).toEqual([
      'https://explicit-gateway.example.com/api/v1/services/aigc/multimodal-generation/generation'
    ])
  })
})

describe('QwenChainedBackend.synthesize response-shape handling (T4 live-spike gotcha #1)', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('uses inline base64 output.audio.data when non-empty', async () => {
    const b64 = Buffer.from('inline-audio-bytes').toString('base64')
    globalThis.fetch = (async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify({ output: { audio: { data: b64, url: '' } } }))) as typeof fetch

    const backend = new QwenChainedBackend({ apiKey: 'test-key' })
    const chunks: Uint8Array[] = []
    for await (const chunk of backend.synthesize('hi')) chunks.push(chunk)

    expect(Buffer.concat(chunks).toString()).toBe('inline-audio-bytes')
  })

  test('fetches output.audio.url when data is an empty string (real gateway shape)', async () => {
    const calls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('multimodal-generation')) {
        return new Response(JSON.stringify({ output: { audio: { data: '', url: 'https://oss.example.com/out.wav' } } }))
      }
      return new Response(new TextEncoder().encode('url-audio-bytes'))
    }) as typeof fetch

    const backend = new QwenChainedBackend({ apiKey: 'test-key' })
    const chunks: Uint8Array[] = []
    for await (const chunk of backend.synthesize('hi')) chunks.push(chunk)

    expect(calls).toEqual([
      'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      'https://oss.example.com/out.wav'
    ])
    expect(Buffer.concat(chunks).toString()).toBe('url-audio-bytes')
  })

  test('throws a loud error when both data and url are absent', async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify({ output: { audio: { data: '' } } }))) as typeof fetch

    const backend = new QwenChainedBackend({ apiKey: 'test-key' })
    await expect(async () => {
      for await (const _chunk of backend.synthesize('hi')) {
        // draining the generator to trigger the throw
      }
    }).toThrow('qwen tts response had no audio data or url')
  })
})

describe('QwenChainedBackend.transcribe response-shape handling (T4 live-spike gotcha #2)', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('returns message.content directly when it is already a string', async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify({ output: { choices: [{ message: { content: 'hello there' } }] } }))) as typeof fetch

    const backend = new QwenChainedBackend({ apiKey: 'test-key' })
    const text = await backend.transcribe(new Uint8Array([1, 2, 3]))

    expect(text).toBe('hello there')
  })

  test('joins message.content parts when it is an array (real gateway shape)', async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL) =>
      new Response(
        JSON.stringify({ output: { choices: [{ message: { content: [{ text: 'hello ' }, { text: 'there' }] } }] } })
      )) as typeof fetch

    const backend = new QwenChainedBackend({ apiKey: 'test-key' })
    const text = await backend.transcribe(new Uint8Array([1, 2, 3]))

    expect(text).toBe('hello there')
  })
})

describe('QwenChainedBackend.describeImage', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('uses the compatible endpoint and vision model with OpenAI image content parts', async () => {
    const calls: string[] = []
    let request: Record<string, unknown> | undefined
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input))
      request = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ choices: [{ message: { content: 'That looks dangerously productive.' } }] }))
    }) as typeof fetch

    const backend = new QwenChainedBackend({ apiKey: 'test-key', visionModel: 'test-vision-model' })
    const description = await backend.describeImage(new Uint8Array([1, 2, 3]), 'image/png', 'Is this enough?')

    expect(calls).toEqual(['https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions'])
    expect(request).toEqual({
      model: 'test-vision-model',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
            {
              type: 'text',
              text: 'React to this image and address the user message in one in-persona sentence. User message: Is this enough?'
            }
          ]
        }
      ]
    })
    expect(description).toBe('That looks dangerously productive.')
  })

  test('includes the Qwen error response body when vision fails', async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL) =>
      new Response('unsupported image payload', { status: 400 })) as typeof fetch

    const backend = new QwenChainedBackend({ apiKey: 'test-key' })
    await expect(backend.describeImage(new Uint8Array([1, 2, 3]), 'image/png')).rejects.toThrow(
      'qwen vision failed: 400: unsupported image payload'
    )
  })
})
