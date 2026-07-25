import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev-only: the Bun server's /ws endpoint (docs/plan.md T8/T10-prep). Override
// with SAHURHUB_SERVER_PORT if the server isn't on the default port.
const SERVER_PORT = process.env.SAHURHUB_SERVER_PORT ?? '8080'

export default defineConfig({
  base: '/phone/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../../src/shared')
    }
  },
  server: {
    proxy: {
      '/ws': {
        target: `ws://localhost:${SERVER_PORT}`,
        ws: true
      }
    }
  },
  build: {
    outDir: 'dist'
  }
})
