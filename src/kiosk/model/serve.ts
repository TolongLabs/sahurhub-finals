// Zero-dep static file server for the T9a dev harness (docs/plan.md T9a
// deliverable 5): serves the repo root so harness.html can load its bundled
// script by relative path and fetch characters/sahur/character.json by
// absolute path. Dev-only — never used by the kiosk/server at runtime.

import { existsSync } from 'node:fs'

const ROOT = `${import.meta.dir}/../../..`
const PORT = Number(process.env.PORT ?? 4174)

Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url)
    let pathname = decodeURIComponent(url.pathname)
    if (pathname === '/') pathname = '/src/kiosk/model/harness.html'
    if (pathname.split('/').some((segment) => segment === '..')) return new Response('Not found', { status: 404 })

    const filePath = `${ROOT}${pathname}`
    if (!existsSync(filePath)) return new Response('Not found', { status: 404 })
    return new Response(Bun.file(filePath))
  }
})

console.log(`[kiosk/model harness] http://localhost:${PORT}/`)
