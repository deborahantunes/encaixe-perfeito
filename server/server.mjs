#!/usr/bin/env node
/**
 * Encaixe Molecular · "Desafio em grupo" room service (protocol encaixe-desafio-v1).
 *
 * The server owns rooms, team seats, rounds, timers, judging and scores. Headsets only send which molecule they
 * dropped and in which orientation; the server re-judges it with the same rules the game uses (shared/challenges.mjs,
 * built from src/game/challenges.ts by `pnpm build:shared`). Molecule poses are relayed to the teacher screen for
 * the live view only.
 *
 *   node server/server.mjs                 (HOST=0.0.0.0 PORT=8790 ALLOWED_ORIGINS=https://deborahantunes.github.io)
 */
import { createServer } from 'node:http'
import { randomBytes, randomInt } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'
import { LEVELS, TEAM_COLORS, TEAM_NAMES, TIERS, challengeList, judge, roundPoints, validPerm } from './shared/challenges.mjs'

export const MARKER = 'encaixe-desafio-v1'
const HOST = process.env.HOST || '127.0.0.1'
const PORT = Number(process.env.PORT || 8790)
const ALLOWED = new Set((process.env.ALLOWED_ORIGINS || 'https://deborahantunes.github.io').split(',').map(s => s.trim()).filter(Boolean))
const ANY_ORIGIN = ALLOWED.has('*') // local development only
const MAX_ROOMS = 64
const MAX_CLIENTS = 256
const MAX_VIEWERS = 6
const MAX_BUFFERED = 128 * 1024
const MSG_PER_SEC = 40
const SEAT_GRACE_MS = 10 * 60_000
const ROOM_IDLE_MS = 45 * 60_000
const COUNTDOWN_MS = Number(process.env.COUNTDOWN_MS || 4000)
const RESULTS_MS = Number(process.env.RESULTS_MS || 10000)
/** Local addresses (dev server, tests) may always connect. */
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
const TEAMS = 4
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) throw new Error('Invalid PORT')

const rooms = new Map()
const token = () => randomBytes(18).toString('base64url')
const now = () => Date.now()

function send(ws, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  if (ws.bufferedAmount > MAX_BUFFERED) { ws.terminate(); return }
  ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload))
}

function cleanName(v) {
  return String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 22)
}

function newCode() {
  for (let i = 0; i < 200; i++) {
    const code = String(randomInt(1000, 10000))
    if (!rooms.has(code)) return code
  }
  return ''
}

class Room {
  constructor(code) {
    this.code = code
    this.hostToken = token()
    this.host = null
    this.viewers = new Set()
    /** Every connected headset, seated or still choosing a color (all of them get the room state). */
    this.players = new Set()
    this.lastActivity = now()
    this.seq = 0
    this.tier = 'facil'
    this.count = 3
    this.list = challengeList(this.tier, this.count)
    this.teams = Array.from({ length: TEAMS }, (_, i) => ({
      name: TEAM_NAMES[i], color: TEAM_COLORS[i], token: '', socket: null, disconnectedAt: 0,
      score: 0, lastAid: 0, rounds: [],
    }))
    this.reset()
  }

  reset() {
    this.phase = 'lobby'
    this.round = -1
    this.startedAt = 0
    this.endsAt = 0
    this.phaseEndsAt = 0
    for (const t of this.teams) { t.score = 0; t.rounds = []; t.lastAid = 0 }
  }

  get challenge() { return this.round >= 0 ? this.list[this.round] ?? null : null }
  /** Round k is over (unsolved rounds then count their full time in the tie-break). */
  finished(k) { return k < this.round || (k === this.round && (this.phase === 'results' || this.phase === 'podium')) }
  claimed() { return this.teams.filter(t => t.token) }
  online(t) { return t.socket?.readyState === WebSocket.OPEN }
  cur(t) {
    if (!t.rounds[this.round]) t.rounds[this.round] = { solved: false, points: 0, wrong: 0, attempts: 0, solvedMs: 0 }
    return t.rounds[this.round]
  }

  snapshot() {
    this.seq += 1
    const ch = this.challenge
    return {
      type: 'state', marker: MARKER, room: this.code, seq: this.seq, serverTime: now(),
      phase: this.phase, round: this.round, totalRounds: this.list.length, levelId: ch?.id ?? null,
      levels: this.list.map(l => l.id), tier: this.tier, count: this.list.length,
      seconds: ch?.seconds ?? 0, startedAt: this.startedAt, endsAt: this.endsAt, phaseEndsAt: this.phaseEndsAt,
      hostOnline: this.online({ socket: this.host }),
      teams: this.teams.map((t, i) => {
        const r = this.round >= 0 ? t.rounds[this.round] : null
        return {
          index: i, name: t.name, color: t.color, claimed: !!t.token, online: this.online(t), score: t.score,
          solved: !!r?.solved, points: r?.points ?? 0, wrong: r?.wrong ?? 0, attempts: r?.attempts ?? 0, solvedMs: r?.solvedMs ?? 0,
          history: t.rounds.map(x => (x ? x.points : 0)),
          totalMs: t.rounds.reduce((sum, x, k) => sum + (!x ? 0 : x.solved ? x.solvedMs : this.finished(k) ? (this.list[k]?.seconds ?? 0) * 1000 : 0), 0),
        }
      }),
    }
  }

  everyone() {
    return [this.host, ...this.viewers, ...this.players].filter(Boolean)
  }

  broadcast() {
    const payload = JSON.stringify(this.snapshot())
    for (const ws of this.everyone()) send(ws, payload)
  }

  toScreens(payload) {
    const s = JSON.stringify(payload)
    send(this.host, s)
    for (const v of this.viewers) send(v, s)
  }

  // ------------------------------------------------------------- seats
  join(ws, role, resume) {
    this.lastActivity = now()
    ws.room = this
    if (role === 'host') {
      if (resume !== this.hostToken) { ws.close(4003, 'not host'); return }
      if (this.host && this.host !== ws) this.host.close(4001, 'host resumed elsewhere')
      this.host = ws
      ws.role = 'host'
      send(ws, { type: 'welcome', marker: MARKER, room: this.code, role: 'host', resume: this.hostToken })
    } else if (role === 'view') {
      if (this.viewers.size >= MAX_VIEWERS) { ws.close(1013, 'room full'); return }
      this.viewers.add(ws)
      ws.role = 'view'
      send(ws, { type: 'welcome', marker: MARKER, room: this.code, role: 'view', resume: '' })
    } else {
      ws.role = 'player'
      ws.team = -1
      this.players.add(ws)
      const i = resume ? this.teams.findIndex(t => t.token && t.token === resume) : -1
      if (i >= 0) this.seat(ws, i, false)
      else send(ws, { type: 'welcome', marker: MARKER, room: this.code, role: 'player', team: -1, resume: '' })
    }
    this.broadcast()
  }

  seat(ws, i, fresh) {
    const t = this.teams[i]
    if (t.socket && t.socket !== ws && t.socket.readyState === WebSocket.OPEN) t.socket.close(4001, 'seat resumed elsewhere')
    if (fresh || !t.token) t.token = token()
    t.socket = ws
    t.disconnectedAt = 0
    ws.team = i
    send(ws, { type: 'welcome', marker: MARKER, room: this.code, role: 'player', team: i, resume: t.token, lastAid: t.lastAid })
  }

  pick(ws, i) {
    if (ws.role !== 'player' || !Number.isInteger(i) || i < 0 || i >= TEAMS) return
    const t = this.teams[i]
    if (ws.team === i) return
    if (this.online(t)) { send(ws, { type: 'error', marker: MARKER, code: 'team_taken', team: i }); return }
    if (ws.team >= 0) { const old = this.teams[ws.team]; if (old.socket === ws) { old.socket = null; old.disconnectedAt = now() } }
    this.seat(ws, i, !t.token)
    this.broadcast()
  }

  leave(ws) {
    this.lastActivity = now()
    if (ws.role === 'host' && this.host === ws) this.host = null
    else if (ws.role === 'view') this.viewers.delete(ws)
    else if (ws.role === 'player') this.players.delete(ws)
    if (ws.role === 'player' && ws.team >= 0) {
      const t = this.teams[ws.team]
      if (t.socket === ws) { t.socket = null; t.disconnectedAt = now() }
    }
    this.broadcast()
  }

  // ------------------------------------------------------------- host commands
  command(ws, msg) {
    if (ws !== this.host) return
    this.lastActivity = now()
    if (msg.type === 'config') {
      if (this.phase !== 'lobby' && this.phase !== 'podium') return
      if (!TIERS.includes(msg.tier)) return
      this.tier = msg.tier
      this.list = challengeList(this.tier, Number(msg.count))
      this.count = this.list.length
      if (this.phase === 'podium') this.reset()
    } else if (msg.type === 'rename') {
      const t = this.teams[msg.team]
      const name = cleanName(msg.name)
      if (t && name) t.name = name
    } else if (msg.type === 'start') {
      if (this.phase !== 'lobby' && this.phase !== 'podium') return
      if (this.claimed().length === 0) { send(ws, { type: 'error', marker: MARKER, code: 'no_teams' }); return }
      if (this.phase === 'podium') this.reset()
      this.beginCountdown(0)
    } else if (msg.type === 'next') {
      if (this.phase === 'round') this.endRound()
      else if (this.phase === 'results' || this.phase === 'countdown') this.phaseEndsAt = 0
      this.tick()
    } else if (msg.type === 'reset') {
      this.reset()
    } else if (msg.type === 'free') {
      const t = this.teams[msg.team]
      if (t) { t.socket?.close(4004, 'team freed'); t.token = ''; t.socket = null }
    } else return
    this.broadcast()
  }

  beginCountdown(round) {
    this.round = round
    this.phase = 'countdown'
    this.phaseEndsAt = now() + COUNTDOWN_MS
    this.startedAt = this.phaseEndsAt
    this.endsAt = this.startedAt + this.challenge.seconds * 1000
    for (const t of this.teams) if (t.token) this.cur(t)
  }

  endRound() {
    this.phase = 'results'
    this.phaseEndsAt = now() + RESULTS_MS
    this.endsAt = Math.min(this.endsAt, now())
  }

  tick() {
    const n = now()
    let changed = false
    if (this.phase === 'countdown' && n >= this.phaseEndsAt) {
      this.phase = 'round'
      this.startedAt = n
      this.endsAt = n + this.challenge.seconds * 1000
      changed = true
    } else if (this.phase === 'round') {
      const playing = this.claimed()
      const allDone = playing.length > 0 && playing.every(t => this.cur(t).solved)
      if (n >= this.endsAt || allDone) { this.endRound(); changed = true }
    } else if (this.phase === 'results' && n >= this.phaseEndsAt) {
      if (this.round + 1 < this.list.length) this.beginCountdown(this.round + 1)
      else { this.phase = 'podium'; this.phaseEndsAt = 0 }
      changed = true
    }
    for (const t of this.teams) {
      // A seat whose headset vanished long ago is freed (its points stay on the board until a reset).
      if (t.token && !this.online(t) && t.disconnectedAt && n - t.disconnectedAt > SEAT_GRACE_MS && this.phase === 'lobby') {
        t.token = ''; changed = true
      }
    }
    if (changed) this.broadcast()
  }

  // ------------------------------------------------------------- play
  attempt(ws, msg) {
    if (ws.role !== 'player' || ws.team < 0) return
    const t = this.teams[ws.team]
    if (t.socket !== ws) return
    const aid = msg.aid
    if (!Number.isSafeInteger(aid) || aid <= 0) return
    if (aid <= t.lastAid) { send(ws, { type: 'judged', aid, duplicate: true }); return }
    const ch = this.challenge
    if (this.phase !== 'round' || msg.round !== this.round || !ch) { t.lastAid = aid; send(ws, { type: 'judged', aid, late: true }); return }
    if (typeof msg.mol !== 'string' || !ch.tray.includes(msg.mol) || !validPerm(msg.perm)) return
    t.lastAid = aid
    const r = this.cur(t)
    if (r.solved) { send(ws, { type: 'judged', aid, ok: true, already: true, points: r.points, total: t.score }); return }
    const j = judge(ch, msg.mol, msg.perm)
    r.attempts += 1
    if (j.ok) {
      r.solved = true
      r.solvedMs = now() - this.startedAt
      r.points = roundPoints(r.solvedMs, ch.seconds, r.wrong)
      t.score += r.points
    } else r.wrong += 1
    send(ws, { type: 'judged', aid, ok: j.ok, fit: j.fit, activates: j.activates, points: r.points, total: t.score, wrong: r.wrong })
    this.toScreens({ type: 'event', team: ws.team, mol: msg.mol, fit: j.fit, activates: j.activates, ok: j.ok, points: r.points })
    this.broadcast()
    this.tick()
  }

  pose(ws, msg) {
    if (ws.role !== 'player' || ws.team < 0 || this.teams[ws.team].socket !== ws) return
    if (!Array.isArray(msg.mols) || msg.mols.length > 8) return
    const mols = []
    for (const m of msg.mols) {
      if (!m || typeof m.id !== 'string' || m.id.length > 16) return
      const nums = [...(m.p ?? []), ...(m.q ?? [])]
      if (nums.length !== 7 || !nums.every(x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 10)) return
      mols.push({ id: m.id, p: m.p, q: m.q, s: typeof m.s === 'string' ? m.s.slice(0, 8) : '' })
    }
    const held = typeof msg.held === 'string' ? msg.held.slice(0, 16) : null
    this.toScreens({ type: 'pose', team: ws.team, round: this.round, held, mols })
  }
}

// ------------------------------------------------------------------ http + ws
const http = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x')
  if (url.pathname.endsWith('/healthz')) {
    // Read by the teacher screen (any origin) to wake the server up before creating a room.
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' })
    res.end(JSON.stringify({ ok: true, marker: MARKER, rooms: rooms.size, uptime: Math.round(process.uptime()) }))
    return
  }
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Encaixe Molecular: servidor do Desafio em grupo funcionando.\n')
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('Not found')
})

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 })
http.on('upgrade', (req, socket, head) => {
  let url
  try { url = new URL(req.url || '/', 'http://x') } catch { socket.destroy(); return }
  const origin = req.headers.origin
  let same = false
  try { same = !!origin && new URL(origin).host === req.headers.host } catch { /* ignore */ }
  if (wss.clients.size >= MAX_CLIENTS || (origin && !same && !ANY_ORIGIN && !ALLOWED.has(origin) && !LOCAL_ORIGIN.test(origin))) { socket.destroy(); return }
  if (!/\/(ws|mp)$/.test(url.pathname) || url.searchParams.get('build') !== MARKER) { socket.destroy(); return }
  const role = url.searchParams.get('role')
  if (!['host', 'player', 'view'].includes(role)) { socket.destroy(); return }
  let code = String(url.searchParams.get('room') || '')
  const resume = String(url.searchParams.get('resume') || '').slice(0, 64)
  let room = /^\d{4}$/.test(code) ? rooms.get(code) : undefined
  if (role === 'host' && !room) {
    if (rooms.size >= MAX_ROOMS) { socket.destroy(); return }
    code = newCode()
    if (!code) { socket.destroy(); return }
    room = new Room(code)
    rooms.set(code, room)
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, room, role, room.hostToken))
    return
  }
  if (!room) {
    // Unknown room: accept and tell the client, so it can show "code not found" instead of retrying forever.
    wss.handleUpgrade(req, socket, head, ws => { send(ws, { type: 'error', marker: MARKER, code: 'no_room' }); ws.close(4404, 'no room') })
    return
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, room, role, resume))
})

wss.on('connection', (ws, room, role, resume) => {
  ws.alive = true
  ws.on('pong', () => { ws.alive = true })
  let windowStart = now()
  let count = 0
  room.join(ws, role, resume)
  ws.on('message', data => {
    if (now() - windowStart >= 1000) { windowStart = now(); count = 0 }
    if (++count > MSG_PER_SEC) { ws.close(1008, 'rate'); return }
    let msg
    try { msg = JSON.parse(data.toString()) } catch { send(ws, { type: 'error', marker: MARKER, code: 'invalid_message' }); return }
    if (!msg || typeof msg.type !== 'string') return
    room.lastActivity = now()
    if (msg.type === 'pick') room.pick(ws, msg.team)
    else if (msg.type === 'attempt') room.attempt(ws, msg)
    else if (msg.type === 'pose') room.pose(ws, msg)
    else if (msg.type === 'ping') send(ws, { type: 'pong', t: msg.t, serverTime: now() })
    else room.command(ws, msg)
  })
  ws.on('close', () => room.leave(ws))
  ws.on('error', () => room.leave(ws))
})

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue }
    ws.alive = false
    ws.ping()
  }
}, 15_000).unref()

setInterval(() => {
  const n = now()
  for (const [code, room] of rooms) {
    room.tick()
    if (room.everyone().length === 0 && n - room.lastActivity > ROOM_IDLE_MS) rooms.delete(code)
  }
}, 250).unref()

// Timers: a light state refresh every 2 s keeps clocks in sync on flaky Wi-Fi.
setInterval(() => { for (const room of rooms.values()) if (room.phase !== 'lobby') room.broadcast() }, 2000).unref()

http.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ marker: MARKER, status: 'listening', host: HOST, port: http.address().port }))
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const ws of wss.clients) ws.close(1012, 'server restart')
    http.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 2000).unref()
  })
}
