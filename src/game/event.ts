/**
 * "Modo evento" (fila de visitantes): the headset waits on a lobby, each visitor presses COMEÇAR and plays
 * 1, 2 or 3 levels in a row; at the end the total time is shown and the lobby is ready for the next person.
 * The number of levels is chosen by the staff on the start screen, on the lobby, or with ?evento=1|2|3 (0 = off).
 */
export type EventPhases = 0 | 1 | 2 | 3

/** LEVELS indices played in event mode, in order (Fase 1, Fase 2, Fase 3). */
export const EVENT_LEVELS = [1, 2, 3] as const

const KEY = 'encaixe-evento'
const BEST_KEY = 'encaixe-evento-recorde'

const valid = (n: number): n is EventPhases => n === 0 || n === 1 || n === 2 || n === 3

export function readEventSetting(): EventPhases {
  try {
    const q = new URLSearchParams(location.search).get('evento')
    if (q !== null) {
      const n = Number(q)
      if (valid(n)) { saveEventSetting(n); return n }
    }
  } catch { /* ignore */ }
  try {
    const n = Number(localStorage.getItem(KEY) ?? 0)
    return valid(n) ? n : 0
  } catch { return 0 }
}

export function saveEventSetting(n: EventPhases): void {
  try { localStorage.setItem(KEY, String(n)) } catch { /* ignore */ }
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

/** Best total time of today on this device for this number of levels (ms), or 0. */
export function bestToday(phases: EventPhases): number {
  try {
    const all = JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Record<string, number>
    return all[`${today()}:${phases}`] ?? 0
  } catch { return 0 }
}

/** Saves a finished run; returns true if it is a new best of the day. */
export function saveBest(phases: EventPhases, ms: number): boolean {
  const prev = bestToday(phases)
  if (prev && prev <= ms) return false
  try {
    const all = JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Record<string, number>
    for (const k of Object.keys(all)) if (!k.startsWith(today())) delete all[k]
    all[`${today()}:${phases}`] = ms
    localStorage.setItem(BEST_KEY, JSON.stringify(all))
  } catch { /* ignore */ }
  return true
}
