import { manusGameTuning } from './scripts/manus-tuning/vite.mjs'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
// @ts-expect-error Node types are not installed; this file runs in Node at build time.
import { execSync } from 'node:child_process'
function appVersion(): string {
  const day = new Date().toISOString().slice(0, 10)
  try { return `${day} · ${execSync('git rev-parse --short HEAD').toString().trim()}` } catch { return day }
}

// Relative base keeps production output portable; the Session owns preview HOST/PORT.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', ['HOST', 'PORT'])
  const port = Number(env.PORT ?? 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
  return {
    base: './',
    define: { __APP_VERSION__: JSON.stringify(appVersion()) },
    plugins: [manusGameTuning()],
    server: {
      host: env.HOST ?? '127.0.0.1', port, strictPort: true,
      allowedHosts: ['.manuspre.computer', '.manus.computer', '.manus-asia.computer', '.manuscomputer.ai', '.manusvm.computer', 'localhost', '127.0.0.1'],
    },
    build: {
      target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 4600, sourcemap: false,
      // Two pages: the game (index.html) and the group-challenge teacher screen (placar.html).
      rollupOptions: { input: { main: 'index.html', placar: 'placar.html' } },
    },
    test: { environment: 'node', include: ['tests/**/*.test.{ts,mjs}'] },
  }
})
