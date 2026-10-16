/**
 * Keeps the last runtime error on the device so problems seen inside the headset can be reported later
 * (shown in small print on the start screen). Never throws.
 */
const KEY = 'encaixe-last-error'
declare const __APP_VERSION__: string
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'

let lastSaved = 0
export function recordError(where: string, err: unknown): void {
  try {
    console.error(`[${where}]`, err)
    const now = Date.now()
    if (now - lastSaved < 2000) return // avoid hammering storage when a per-frame error repeats
    lastSaved = now
    const e = err as { message?: string; stack?: string }
    const msg = `${where}: ${e?.message ?? String(err)}`.slice(0, 300)
    const at = (e?.stack ?? '').split('\n').slice(1, 3).map(s => s.trim()).join(' | ').slice(0, 300)
    localStorage.setItem(KEY, JSON.stringify({ msg, at, version: APP_VERSION, time: new Date().toISOString() }))
  } catch { /* ignore */ }
}

export function lastError(): { msg: string; at: string; version: string; time: string } | null {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null } catch { return null }
}

export function clearError(): void {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}

export function installGlobalErrorLog(): void {
  window.addEventListener('error', e => recordError('erro', e.error ?? e.message))
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason as { name?: string } | undefined
    // Haptic pulses and XR feature probes may reject harmlessly; ignore those.
    if (r?.name === 'NotSupportedError' || r?.name === 'NotAllowedError') return
    recordError('promessa', e.reason)
  })
}
