/**
 * Google Analytics 4 (property "EncaixePerfeito"). Loaded only on the published site, so local development and
 * tests never send data. Offline, the script simply fails to load and track() does nothing.
 */
const MEASUREMENT_ID = 'G-85PTRY5D21'
const HOSTS = ['deborahantunes.github.io']

type Gtag = (...args: unknown[]) => void
let gtag: Gtag | null = null

export function initAnalytics(lang: string): void {
  if (!import.meta.env.PROD || !HOSTS.includes(location.hostname)) return
  const w = window as unknown as { dataLayer: unknown[]; gtag: Gtag }
  w.dataLayer = w.dataLayer || []
  // gtag.js expects the real `arguments` object.
  w.gtag = function () { w.dataLayer.push(arguments) } as Gtag
  gtag = w.gtag
  gtag('js', new Date())
  gtag('config', MEASUREMENT_ID, { game_language: lang })
  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`
  document.head.appendChild(s)
}

/** Custom game event (e.g. play_start, level_complete, event_run_complete). Never throws. */
export function track(name: string, params: Record<string, string | number | boolean> = {}): void {
  try { gtag?.('event', name, params) } catch { /* ignore */ }
}
