// Smoke test: node scripts/smoke.mjs [url]  (default: dev server on :3000)
// Boots the game, plays a real mouse pick-and-drop, then checks each level's win path.
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://127.0.0.1:3000/'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', e => errors.push(String(e)))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
const fail = msg => { console.error('SMOKE FAIL:', msg, errors); process.exit(1) }

await page.goto(url)
await page.waitForSelector('[data-act="flat"]')
await page.waitForFunction(() => window.__game)
await page.click('[data-act="flat"]')
await page.evaluate(() => window.__game.game.startLevel(1))
await page.waitForTimeout(1500)
const toScreen = expr => page.evaluate(expr => {
  const g = window.__game.game
  const v = eval(expr).clone().project(g.camera)
  return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight }
}, expr)

// Real mouse: click molecule, rotate with keys, click pocket. Retry with other orientations.
let fit = null
const keys = [[], ['e'], ['e', 'e'], ['f'], ['f', 'e'], ['f', 'e', 'e']]
for (const seq of keys) {
  await page.waitForFunction(() => window.__game.game.mols.find(m => m.def.id === 'folha').state === 'tray')
  const mol = await toScreen("g.mols.find(m => m.def.id === 'folha').obj.position")
  await page.mouse.move(mol.x, mol.y)
  await page.waitForTimeout(150)
  await page.mouse.down(); await page.mouse.up()
  await page.waitForFunction(() => window.__game.game.pointers.mouse.held, null, { timeout: 4000 }).catch(() => {})
  if (await page.evaluate(() => window.__game.game.pointers.mouse.held?.def?.id) !== 'folha') fail('mouse did not pick the molecule')
  for (const k of seq) { await page.keyboard.press(k); await page.waitForTimeout(120) }
  await page.waitForTimeout(900)
  const pocket = await toScreen('g.receptors[0].center')
  await page.mouse.move(pocket.x, pocket.y, { steps: 8 })
  await page.waitForTimeout(900)
  await page.mouse.down(); await page.mouse.up()
  await page.waitForTimeout(2500)
  fit = await page.evaluate(() => window.__game.game.last?.r.fit)
  if (!fit) fail('drop produced no result')
  if (fit === 'strong') break
}
if (fit !== 'strong') fail(`never reached a strong fit, last ${fit}`)

// Every stage of every difficulty: the right molecule wins (blockers also turn away the natural molecule).
const stages = [[1, 'folha'], [2, 'escudo'], [3, 'laco'], [11, 'cometa'], [12, 'escudo'], [13, 'raio'], [14, 'trevo'], [15, 'trevo', 1],
  [21, 'cometa'], [22, 'raio'], [23, 'trevo'], [24, 'trevo', 1]].map(([id, sol, target = 0]) => ({ id, sol, target }))
for (const { id, sol, target } of stages) {
  await page.evaluate(([id, sol, target]) => { const g = window.__game.game; g.startLevel(id); g.debugDock(sol, target) }, [id, sol, target])
  await page.waitForFunction(() => window.__game.game.isWon, null, { timeout: 30000 }).catch(() => fail(`stage ${id} not won with ${sol}`))
}
// Wrong drug must not win the selective stage.
await page.evaluate(() => { const g = window.__game.game; g.startLevel(15); g.debugDock('cometa', 1) })
await page.waitForTimeout(6000)
if (await page.evaluate(() => window.__game.game.isWon)) fail('non-selective Cometa should not win stage 15')
// Best-fit stage: a strong but lower-scoring molecule must not win.
await page.evaluate(() => { const g = window.__game.game; g.startLevel(21); g.debugDock('escudo') })
await page.waitForTimeout(3000)
if (await page.evaluate(() => window.__game.game.isWon)) fail('Escudo (score 94) should not win stage 21')
await page.evaluate(() => window.__game.game.startLevel(90))
await page.waitForTimeout(500)
await page.screenshot({ path: '/tmp/smoke.png' })
if (errors.length) fail('page errors')
console.log('SMOKE OK')
await browser.close()
