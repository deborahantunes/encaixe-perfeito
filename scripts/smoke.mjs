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

// Tutorial: demo -> grab -> drop -> strong dock -> one natural visit -> win.
await page.evaluate(() => { const g = window.__game.game; g.startLevel(0) })
await page.waitForFunction(() => window.__game.game.tutStep === 1, null, { timeout: 90000 }).catch(() => fail('tutorial demo did not finish'))
await page.evaluate(() => { const g = window.__game.game; g.debugDock('cometa') })
await page.waitForFunction(() => window.__game.game.isWon, null, { timeout: 90000 }).catch(() => fail('tutorial not won'))
// Level 1 & 2: a blocker must turn away two natural molecules.
for (const [lv, id] of [[1, 'folha'], [2, 'escudo']]) {
  await page.evaluate(([lv, id]) => { const g = window.__game.game; g.startLevel(lv); g.debugDock(id) }, [lv, id])
  await page.waitForFunction(() => window.__game.game.isWon, null, { timeout: 90000 }).catch(() => fail(`level ${lv} not won`))
}
// Level 3: selective agonist.
await page.evaluate(() => { const g = window.__game.game; g.startLevel(3); g.debugDock('trevo', 1) })
await page.waitForFunction(() => window.__game.game.isWon, null, { timeout: 30000 }).catch(() => fail('level 3 not won'))
// Wrong drug must not win.
await page.evaluate(() => { const g = window.__game.game; g.startLevel(3); g.debugDock('cometa', 1) })
await page.waitForTimeout(8000)
if (await page.evaluate(() => window.__game.game.isWon)) fail('non-selective Cometa should not win level 3')
await page.evaluate(() => window.__game.game.startLevel(4))
await page.waitForTimeout(500)
await page.screenshot({ path: '/tmp/smoke.png' })
if (errors.length) fail('page errors')
console.log('SMOKE OK')
await browser.close()
