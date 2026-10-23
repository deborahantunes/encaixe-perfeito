// End-to-end test of the "Desafio em grupo" room server: a host, two headsets, two rounds, judging and podium.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { PERMS } from '../src/game/rules'
import { judge } from '../src/game/challenges'
import { LEVEL_BY_ID } from '../src/game/data'
import { buildShared } from '../scripts/build-shared.mjs'

const MARKER = 'encaixe-desafio-v1'
let proc
let port

beforeAll(async () => {
  proc = spawn(process.execPath, ['server/server.mjs'], { env: { ...process.env, PORT: '0', COUNTDOWN_MS: '150', RESULTS_MS: '250' }, stdio: ['ignore', 'pipe', 'inherit'] })
  port = await new Promise((resolve, reject) => {
    proc.stdout.on('data', d => { try { resolve(JSON.parse(String(d).split('\n')[0]).port) } catch { /* wait */ } })
    proc.on('exit', code => reject(new Error(`server exited ${code}`)))
  })
})
afterAll(() => proc?.kill())

/** A tiny client that records every message and can wait for one matching a predicate. */
function connect(q) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?${new URLSearchParams({ build: MARKER, ...q })}`)
  const log = []
  const waiters = []
  ws.on('message', d => {
    const m = JSON.parse(String(d))
    log.push(m)
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m) }
  })
  const c = {
    ws, log,
    send: m => ws.send(JSON.stringify(m)),
    wait: (pred, ms = 4000) => new Promise((resolve, reject) => {
      const hit = log.find(pred)
      if (hit) { log.splice(log.indexOf(hit), 1); resolve(hit); return }
      const w = { pred: m => { if (pred(m)) { log.splice(log.indexOf(m), 1); return true } return false }, resolve }
      waiters.push(w)
      setTimeout(() => reject(new Error('timeout waiting for message')), ms)
    }),
    state: pred => c.wait(m => m.type === 'state' && pred(m)),
  }
  return new Promise(res => ws.on('open', () => res(c)))
}

const solution = id => {
  const lv = LEVEL_BY_ID.get(id)
  for (const m of lv.tray) for (const p of PERMS) if (judge(lv, m, p).ok) return { mol: m, perm: p }
  throw new Error('no solution')
}
const wrongPerm = (id, mol) => PERMS.find(p => !judge(LEVEL_BY_ID.get(id), mol, p).ok)

describe('servidor do Desafio em grupo', () => {
  it('o servidor usa as mesmas regras do jogo (server/shared atualizado)', async () => {
    const fresh = await buildShared('server/shared/challenges.mjs', false)
    expect(readFileSync('server/shared/challenges.mjs', 'utf8')).toBe(fresh)
  })

  it('sala completa: times, nível, rodadas, pontos e pódio', async () => {
    const host = await connect({ role: 'host' })
    const welcome = await host.wait(m => m.type === 'welcome')
    const room = welcome.room
    expect(room).toMatch(/^\d{4}$/)

    const a = await connect({ role: 'player', room })
    await a.wait(m => m.type === 'welcome' && m.team === -1)
    // A headset still choosing its color already sees the room (which colors are free).
    expect((await a.state(() => true)).teams.every(x => !x.claimed)).toBe(true)
    a.send({ type: 'pick', team: 0 })
    const wa = await a.wait(m => m.type === 'welcome' && m.team === 0)
    const b = await connect({ role: 'player', room })
    b.send({ type: 'pick', team: 1 })
    await b.wait(m => m.type === 'welcome' && m.team === 1)
    const c = await connect({ role: 'player', room })
    c.send({ type: 'pick', team: 0 })
    expect((await c.wait(m => m.type === 'error')).code).toBe('team_taken')
    c.ws.close()

    host.send({ type: 'rename', team: 0, name: 'Turma <A>' })
    host.send({ type: 'config', tier: 'padrao', count: 2 })
    const cfg = await host.state(s => s.tier === 'padrao' && s.totalRounds === 2 && s.teams[0].name === 'Turma A')
    expect(cfg.levels).toEqual([11, 12])

    host.send({ type: 'start' })
    let s = await a.state(x => x.phase === 'round' && x.round === 0)
    expect(s.levelId).toBe(11)

    // Round 1: A misses once, then both solve.
    const s1 = solution(11)
    a.send({ type: 'attempt', aid: 1, round: 0, mol: s1.mol, perm: wrongPerm(11, s1.mol) })
    const miss = await a.wait(m => m.type === 'judged' && m.aid === 1)
    expect(miss).toMatchObject({ ok: false, wrong: 1 })
    a.send({ type: 'attempt', aid: 1, round: 0, mol: s1.mol, perm: s1.perm })
    expect((await a.wait(m => m.type === 'judged' && m.aid === 1)).duplicate).toBe(true)
    a.send({ type: 'attempt', aid: 2, round: 0, mol: s1.mol, perm: s1.perm })
    const hitA = await a.wait(m => m.type === 'judged' && m.aid === 2)
    expect(hitA.ok).toBe(true)
    expect(hitA.points).toBeLessThan(250 - 50 + 1) // no first-try bonus
    b.send({ type: 'attempt', aid: 1, round: 0, mol: s1.mol, perm: s1.perm })
    const hitB = await b.wait(m => m.type === 'judged' && m.aid === 1)
    expect(hitB.ok).toBe(true)
    expect(hitB.points).toBeGreaterThan(hitA.points)
    expect((await host.wait(m => m.type === 'event' && m.team === 0 && m.ok)).points).toBe(hitA.points)

    // Everyone solved: results, then round 2 by itself.
    await host.state(x => x.phase === 'results' && x.round === 0)
    s = await a.state(x => x.phase === 'round' && x.round === 1)
    expect(s.levelId).toBe(12)

    // Poses reach the teacher screen.
    a.send({ type: 'pose', held: 'escudo', mols: [{ id: 'escudo', p: [0, 1.2, -0.5], q: [0, 0, 0, 1], s: 'held' }] })
    expect((await host.wait(m => m.type === 'pose')).mols[0].id).toBe('escudo')

    // Headset drops and comes back with its resume token: same team, same points.
    a.ws.close()
    const a2 = await connect({ role: 'player', room, resume: wa.resume })
    const back = await a2.wait(m => m.type === 'welcome')
    expect(back.team).toBe(0)
    const s2 = solution(12)
    a2.send({ type: 'attempt', aid: back.lastAid + 1, round: 1, mol: s2.mol, perm: s2.perm })
    expect((await a2.wait(m => m.type === 'judged')).ok).toBe(true)

    // Teacher ends the round (B did not solve), results, then podium.
    host.send({ type: 'next' })
    await host.state(x => x.phase === 'results' && x.round === 1)
    const pod = await host.state(x => x.phase === 'podium')
    const [ta, tb] = pod.teams
    expect(ta.score).toBe(hitA.points + ta.history[1])
    expect(tb.score).toBe(hitB.points)
    expect(tb.totalMs).toBeGreaterThan(ta.totalMs - 1)
    expect(ta.score).toBeGreaterThan(tb.score)

    // Unknown room code.
    const lost = await connect({ role: 'player', room: room === '9999' ? '9998' : '9999' })
    expect((await lost.wait(m => m.type === 'error')).code).toBe('no_room')
    for (const x of [host, a2, b]) x.ws.close()
  }, 20000)
})
