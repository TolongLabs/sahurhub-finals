import { afterEach, expect, test } from 'bun:test'
import { uploadFile } from './upload.ts'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('includes the composer text in the upload multipart payload', async () => {
  let requestBody: FormData | undefined
  globalThis.fetch = (async (_input, init) => {
    requestBody = init?.body as FormData
    return Response.json({ id: 'upload-1', name: 'notes.txt', mime: 'text/plain' })
  }) as typeof fetch

  await uploadFile(new File(['notes'], 'notes.txt', { type: 'text/plain' }), 'Read this first')

  expect(requestBody?.get('file')).toBeInstanceOf(File)
  expect(requestBody?.get('text')).toBe('Read this first')
})
