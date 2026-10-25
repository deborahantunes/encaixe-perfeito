/**
 * "Desafio em grupo" client (protocol encaixe-desafio-v1, see server/server.mjs). Used by the headsets (role
 * "player") and by the teacher screen (role "host"). Reconnects by itself on flaky Wi-Fi and keeps the seat with a
 * resume token, so a headset that drops for a moment comes back to the same team with its points.
 */
import type { Tier } from '../game/data'
import type { FitClass, Perm } from '../game/rules'

export const MARKER = 'encaixe-desafio-v1'
const SERVER_KEY = 'encaixe-servidor'
/** Room server on the internet (see README, "Desafio em grupo"). Can be changed with ?servidor=wss://... */
export const DEFAULT_SERVER = 'wss://encaixe-desafio.onrender.com'

export type Role = 'host' | 'player' | 'view'
export type Phase = 'lobby' | 'countdown' | 'round' | 'results' | 'podium'

export type TeamState = {
  index: number; name: string; color: string; claimed: boolean; online: boolean; score: number
  solved: boolean; points: number; wrong: number; attempts: number; solvedMs: number
  history: number[]; totalMs: number
}

export type RoomState = {
  type: 'state'; room: string; seq: number; serverTime: number
  phase: Phase; round: number; totalRounds: number; levelId: number | null; levels: number[]
  tier: Tier; count: number; seconds: number
  startedAt: number; endsAt: number; phaseEndsAt: number; hostOnline: boolean
  teams: TeamState[]
}

export type Judged = { type: 'judged'; aid: number; ok?: boolean; fit?: FitClass; activates?: boolean; points?: number; total?: number; wrong?: number; late?: boolean; duplicate?: boolean; already?: boolean }
export type RoomEvent = { type: 'event'; team: number; mol: string; fit: FitClass; activates: boolean; ok: boolean; points: number }
export type PoseMol = { id: string; p: [number, number, number]; q: [number, number, number, number]; s: string }
export type PoseMsg = { type: 'pose'; team: number; round: number; held: string | null; mols: PoseMol[] }

export type Status = 'connecting' | 'open' | 'retrying' | 'closed'

/** Server address: ?servidor= (saved on the device), else the local dev server, else the internet server. */
export function serverUrl(): string {
  try {
    const q = new URLSearchParams(location.search).get('servidor')
    if (q && /^wss?:\/\/[^\s]+$/.test(q)) { localStorage.setItem(SERVER_KEY, q); return q.replace(/\/+$/, '') }
    const saved = localStorage.getItem(SERVER_KEY)
    if (saved) return saved
  } catch { /* ignore */ }
  if (typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return `ws://${location.hostname}:8790`
  return DEFAULT_SERVER
}

export function setServerUrl(url: string | null): void {
  try { if (url) localStorage.setItem(SERVER_KEY, url.replace(/\/+$/, '')); else localStorage.removeItem(SERVER_KEY) } catch { /* ignore */ }
}

/** HTTP address of the same server (health check that also wakes a sleeping free-tier server). */
export function httpUrl(ws: string): string {
  return ws.replace(/^ws/, 'http')
}

/** Wakes the server and tells whether it answers (free hosting sleeps when idle; the first call can take ~1 min). */
export async function pingServer(server: string, timeoutMs = 70_000): Promise<boolean> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(`${httpUrl(server)}/healthz`, { cache: 'no-store', signal: ctl.signal })
    return r.ok
  } catch { return false } finally { clearTimeout(timer) }
}

const tokenKey = (role: Role, room: string) => `encaixe-sala:${role}:${room}`

export class RoomClient {
  state: RoomState | null = null
  team = -1
  room: string
  status: Status = 'connecting'
  /** Fatal error code (no_room, ...); the client stops retrying. */
  error = ''
  lastAid = 0
  /** serverTime - Date.now(), smoothed. */
  private offset = 0
  private ws: WebSocket | null = null
  private resume = ''
  private closed = false
  private tries = 0
  /** Failed connection attempts in a row (0 once connected). */
  get failures(): number { return this.tries }
  private pingTimer = 0
  private retryTimer = 0

  onState: (s: RoomState) => void = () => {}
  onJudged: (j: Judged) => void = () => {}
  onEvent: (e: RoomEvent) => void = () => {}
  onPose: (p: PoseMsg) => void = () => {}
  onError: (code: string, msg: Record<string, unknown>) => void = () => {}
  onStatus: (s: Status) => void = () => {}
  onWelcome: (team: number) => void = () => {}

  constructor(readonly server: string, readonly role: Role, room = '') {
    this.room = room
    try { this.resume = room ? sessionStorage.getItem(tokenKey(role, room)) ?? '' : '' } catch { /* ignore */ }
    this.connect()
  }

  /** Current server clock (ms), for countdowns. */
  now(): number { return Date.now() + this.offset }

  send(msg: Record<string, unknown>): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(msg))
    return true
  }

  pick(team: number): void { this.send({ type: 'pick', team }) }

  attempt(round: number, mol: string, perm: Perm): number {
    const aid = ++this.lastAid
    this.send({ type: 'attempt', aid, round, mol, perm })
    return aid
  }

  close(): void {
    this.closed = true
    this.setStatus('closed')
    window.clearInterval(this.pingTimer)
    window.clearTimeout(this.retryTimer)
    try { this.ws?.close(1000, 'bye') } catch { /* ignore */ }
    this.ws = null
  }

  private setStatus(s: Status): void {
    if (s === this.status) return
    this.status = s
    this.onStatus(s)
  }

  private connect(): void {
    if (this.closed) return
    const q = new URLSearchParams({ build: MARKER, role: this.role })
    if (this.room) q.set('room', this.room)
    if (this.resume) q.set('resume', this.resume)
    let ws: WebSocket
    try { ws = new WebSocket(`${this.server}/ws?${q}`) } catch { this.retry(); return }
    this.ws = ws
    ws.onopen = () => {
      this.tries = 0
      this.setStatus('open')
      const ping = () => this.send({ type: 'ping', t: Date.now() })
      ping()
      window.clearInterval(this.pingTimer)
      this.pingTimer = window.setInterval(ping, 5000)
    }
    ws.onmessage = ev => {
      let msg: Record<string, unknown>
      try { msg = JSON.parse(String(ev.data)) } catch { return }
      this.handle(msg)
    }
    ws.onclose = ev => {
      window.clearInterval(this.pingTimer)
      if (this.ws !== ws) return
      this.ws = null
      // 4003 not host / 4404 no room: retrying will not help.
      if (ev.code === 4003 || ev.code === 4404 || this.error) { this.closed = true; this.setStatus('closed'); return }
      if (ev.code === 4004) { this.team = -1; this.resume = ''; this.saveToken() }
      this.retry()
    }
  }

  private retry(): void {
    if (this.closed) return
    this.setStatus('retrying')
    const wait = Math.min(8000, 700 * 2 ** this.tries++)
    window.clearTimeout(this.retryTimer)
    this.retryTimer = window.setTimeout(() => this.connect(), wait)
  }

  private saveToken(): void {
    try {
      if (!this.room) return
      if (this.resume) sessionStorage.setItem(tokenKey(this.role, this.room), this.resume)
      else sessionStorage.removeItem(tokenKey(this.role, this.room))
    } catch { /* ignore */ }
  }

  private handle(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'welcome':
        this.room = String(msg.room ?? this.room)
        this.team = typeof msg.team === 'number' ? msg.team : -1
        if (typeof msg.resume === 'string' && msg.resume) this.resume = msg.resume
        if (typeof msg.lastAid === 'number') this.lastAid = Math.max(this.lastAid, msg.lastAid)
        this.saveToken()
        this.onWelcome(this.team)
        break
      case 'state': {
        const s = msg as unknown as RoomState
        if (this.state && s.seq < this.state.seq && s.serverTime <= this.state.serverTime) return
        this.state = s
        if (this.team >= 0 && !s.teams[this.team]?.claimed) this.team = -1
        this.onState(s)
        break
      }
      case 'pong': {
        const t0 = Number(msg.t)
        const rtt = Date.now() - t0
        if (Number.isFinite(rtt) && rtt >= 0 && rtt < 5000) {
          const off = Number(msg.serverTime) + rtt / 2 - Date.now()
          this.offset = this.offset === 0 ? off : this.offset * 0.7 + off * 0.3
        }
        break
      }
      case 'judged': this.onJudged(msg as unknown as Judged); break
      case 'event': this.onEvent(msg as unknown as RoomEvent); break
      case 'pose': this.onPose(msg as unknown as PoseMsg); break
      case 'error':
        if (msg.code === 'no_room') this.error = 'no_room'
        this.onError(String(msg.code), msg)
        break
    }
  }
}
