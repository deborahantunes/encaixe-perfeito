/**
 * "Modo evento" (fila de visitantes): the headset waits on a lobby, each visitor presses COMEÇAR and plays the
 * first N stages of one difficulty in a row; at the end the total time is shown and the next game starts by itself.
 * Staff choose difficulty and number of stages on the start screen, on the lobby, or with the URL:
 * ?evento=N (N stages; 0 = off) and ?nivel=facil|padrao|especialista (default Fácil).
 */
import { TIERS, stagesOf, type Tier } from './data'

export type EventSetting = { tier: Tier; count: number }

const KEY = 'encaixe-evento-v2'
const OLD_KEY = 'encaixe-evento'
const BEST_KEY = 'encaixe-evento-recorde'

export const isTier = (v: unknown): v is Tier => typeof v === 'string' && (TIERS as string[]).includes(v)

/** Clamps the number of stages to what the difficulty has (at least 1). */
export function normalizeEvent(s: EventSetting): EventSetting {
  const max = stagesOf(s.tier).length
  return { tier: s.tier, count: Math.max(1, Math.min(max, Math.floor(s.count) || max)) }
}

/** Event mode setting of this device, or null when event mode is off. */
export function readEventSetting(): EventSetting | null {
  let saved: EventSetting | null = null
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as EventSetting | null
    if (raw && isTier(raw.tier)) saved = normalizeEvent(raw)
    else {
      // Older versions stored just the number of stages (Fácil).
      const n = Number(localStorage.getItem(OLD_KEY) ?? 0)
      if (n > 0) saved = normalizeEvent({ tier: 'facil', count: n })
    }
  } catch { /* ignore */ }
  try {
    const q = new URLSearchParams(location.search)
    const ev = q.get('evento')
    const nv = q.get('nivel')
    if (ev !== null || nv !== null) {
      const n = Number(ev ?? saved?.count ?? 0)
      const tier = isTier(nv) ? nv : saved?.tier ?? 'facil'
      const next = ev !== null && n === 0 ? null : normalizeEvent({ tier, count: n || stagesOf(tier).length })
      saveEventSetting(next)
      return next
    }
  } catch { /* ignore */ }
  return saved
}

export function saveEventSetting(s: EventSetting | null): void {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY)
    localStorage.removeItem(OLD_KEY)
  } catch { /* ignore */ }
}

/** Last setting used, even while event mode is off (so turning it back on restores it). */
export function lastEventSetting(): EventSetting {
  try {
    const raw = JSON.parse(localStorage.getItem(`${KEY}-last`) ?? 'null') as EventSetting | null
    if (raw && isTier(raw.tier)) return normalizeEvent(raw)
  } catch { /* ignore */ }
  return { tier: 'facil', count: stagesOf('facil').length }
}

export function rememberEventSetting(s: EventSetting): void {
  try { localStorage.setItem(`${KEY}-last`, JSON.stringify(s)) } catch { /* ignore */ }
}

/** 83_400 ms -> "1:23". */
export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

const bestKey = (s: EventSetting) => `${today()}:${s.tier}:${s.count}`

/** Best total time of today on this device for this setting (ms), or 0. */
export function bestToday(s: EventSetting): number {
  try {
    const all = JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Record<string, number>
    return all[bestKey(s)] ?? 0
  } catch { return 0 }
}

/** Saves a finished run; returns true if it is a new best of the day. */
export function saveBest(s: EventSetting, ms: number): boolean {
  const prev = bestToday(s)
  if (prev && prev <= ms) return false
  try {
    const all = JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Record<string, number>
    for (const k of Object.keys(all)) if (!k.startsWith(today())) delete all[k]
    all[bestKey(s)] = ms
    localStorage.setItem(BEST_KEY, JSON.stringify(all))
  } catch { /* ignore */ }
  return true
}
