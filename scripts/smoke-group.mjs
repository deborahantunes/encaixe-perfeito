// Group-challenge smoke test: room server + teacher screen + two "headsets" (browser tabs), a full 2-round game.
//   node scripts/smoke-group.mjs [game url]   (default: dev server on :3000; starts server/server.mjs on :8790)
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const url = (process.argv[2] ?? 'http://127.0.0.1:3000/').replace(/\/?$/, '/')
const shots = process.env.SHOTS ?? '/tmp'
const server = spawn(process.execPath, ['server/server.mjs'], { env: { ...process.env, PORT: '8790', COUNTDOWN_MS: '1500', RESULTS_MS: '2500' }, stdio: 'inherit' })
server.on('exit', code => { if (code) { console.error('room server exited (port 8790 busy?)'); process.exit(1) } })
await new Promise(r => setTimeout(r, 600))
// One browser per screen, like separate devices (a background tab would pause its animation loop).
const browsers = []
const errors = []
const closeAll = () => Promise.all(browsers.map(b => b.close()))
const fail = async msg => { console.error('GROUP SMOKE FAIL:', msg, errors); await closeAll(); server.kill(); process.exit(1) }
const open = async (path, viewport = { width: 1280, height: 800 }) => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  browsers.push(browser)
  const page = await browser.newPage({ viewport })
  page.setDefaultTimeout(90000)
  page.on('pageerror', e => errors.push(`${path}: ${e}`))
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(`${path}: ${m.text()}`) })
  await page.goto(url + path)
  return page
}

// Teacher screen: create the room.
const placar = await open('placar.html', { width: 1600, height: 900 })
await placar.waitForSelector('[data-act="create"]:not([disabled])', { timeout: 30000 })
await placar.screenshot({ path: `${shots}/placar-0-inicio.png` })
await placar.click('[data-act="create"]')
await placar.waitForSelector('.join .code', { timeout: 15000 })
const code = (await placar.textContent('.join .code')).trim()
if (!/^\d{4}$/.test(code)) await fail(`bad room code ${code}`)

// Two headsets join with ?sala= and pick colors.
const players = []
for (let i = 0; i < 2; i++) {
  const p = await open(`?sala=${code}`)
  await p.waitForFunction(() => window.__game?.game.room)
  await p.click('[data-act="flat"]')
  await p.waitForFunction(() => window.__game.game.room.state)
  if (i === 0) await p.screenshot({ path: `${shots}/oculos-1-cores.png` })
  await p.evaluate(i => window.__game.game.room.pick(i), i)
  await p.waitForFunction(i => window.__game.game.room.team === i, i)
  players.push(p)
}
await players[0].waitForTimeout(500)
await players[0].screenshot({ path: `${shots}/oculos-2-aguardando.png` })

// Teacher: Padrão, 2 challenges, rename team 1, start.
await placar.click('[data-tier="padrao"]')
await placar.waitForSelector('[data-count="2"]')
await placar.click('[data-count="2"]')
await placar.fill('[data-rename="0"]', 'Turma da Manhã')
await placar.press('[data-rename="0"]', 'Enter')
await placar.waitForFunction(() => document.querySelector('[data-count="2"]')?.classList.contains('on'))
await placar.waitForTimeout(400)
await placar.screenshot({ path: `${shots}/placar-1-sala.png` })
await placar.click('[data-act="start"]')

// Round 1 (Trave a tripsina): headset 0 solves at once; headset 1 misses, then solves.
await placar.waitForSelector('.count-down', { timeout: 5000 })
await placar.screenshot({ path: `${shots}/placar-2-contagem.png` })
for (const p of players) await p.waitForFunction(() => window.__game.game.mode === 'level' && window.__game.game.level?.id === 11, null, { timeout: 10000 })
await players[0].evaluate(() => window.__game.game.debugDock('cometa'))
await players[1].evaluate(() => window.__game.game.debugDock('gota'))
// The teacher's live view mirrors the docked molecule (pose relay).
await placar.waitForFunction(() => {
  const e = window.__placar.view()?.teams[0].mols.get('cometa')
  return e && e.obj.position.distanceTo({ x: 0, y: 1.3, z: -0.72 }) < 0.03
}, null, { timeout: 30000 }).catch(() => fail('live view did not show the docked molecule'))
await placar.screenshot({ path: `${shots}/placar-3-rodada.png` })
await players[0].screenshot({ path: `${shots}/oculos-3-rodada.png` })
await players[1].waitForFunction(() => window.__game.game.mols.find(m => m.def.id === 'gota')?.state === 'tray', null, { timeout: 8000 })
await players[1].evaluate(() => window.__game.game.debugDock('cometa'))
await placar.waitForSelector('.results', { timeout: 8000 })
await placar.screenshot({ path: `${shots}/placar-4-resultado.png` })
await players[1].waitForTimeout(300)
await players[1].screenshot({ path: `${shots}/oculos-4-resultado.png` })

// Round 2 (Bloqueie o receptor): only headset 1 solves; the teacher ends the round.
for (const p of players) await p.waitForFunction(() => window.__game.game.mode === 'level' && window.__game.game.level?.id === 12, null, { timeout: 10000 })
await players[1].evaluate(() => window.__game.game.debugDock('escudo'))
await players[1].waitForFunction(() => window.__game.game.isWon, null, { timeout: 8000 })
await placar.waitForTimeout(600)
await placar.click('[data-act="next"]')
await placar.waitForSelector('.podium', { timeout: 10000 })
await placar.waitForTimeout(500)
await placar.screenshot({ path: `${shots}/placar-5-podio.png` })
await players[0].waitForFunction(() => window.__game.game.room.state.phase === 'podium')
await players[0].waitForTimeout(500)
await players[0].screenshot({ path: `${shots}/oculos-5-podio.png` })

const final = await placar.evaluate(() => [...document.querySelectorAll('.rank .row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()))
console.log(final.join('\n'))
const st = await players[0].evaluate(() => window.__game.game.room.state.teams.slice(0, 2).map(t => ({ name: t.name, score: t.score })))
if (st[0].name !== 'Turma da Manhã') await fail('rename did not reach the headsets')
if (!(st[1].score > st[0].score)) await fail(`expected team 2 ahead: ${JSON.stringify(st)}`)
if (errors.length) await fail('page errors')
console.log('GROUP SMOKE OK')
await closeAll()
server.kill()
