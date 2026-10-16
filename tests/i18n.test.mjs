import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHEM_LABEL, LEVELS, MOLECULES, SIZE_LABEL, TARGETS } from '../src/game/data'
import { FIT_TITLE } from '../src/game/rules'
import en from '../src/i18n/en.json'
import es from '../src/i18n/es.json'

/** Every Portuguese key the game can show: t('...') calls in the code + the data tables. */
function collectKeys() {
  const keys = new Set()
  const walk = (dir) => readdirSync(dir, { withFileTypes: true })
    .flatMap(d => d.isDirectory() ? walk(join(dir, d.name)) : d.name.endsWith('.ts') ? [join(dir, d.name)] : [])
  for (const f of walk('src')) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/\btr?\('((?:[^'\\]|\\.)*)'/g)) keys.add(m[1].replace(/\\'/g, "'"))
  }
  for (const m of Object.values(MOLECULES)) { keys.add(m.name); keys.add(m.about) }
  for (const x of Object.values(TARGETS)) for (const k of [x.name, x.short, x.role, x.effect, x.word]) keys.add(k)
  for (const l of LEVELS) for (const k of [l.title, l.intro, l.goal, l.learned]) if (k) keys.add(k)
  for (const k of [...Object.values(CHEM_LABEL), ...SIZE_LABEL, ...Object.values(FIT_TITLE)]) keys.add(k)
  return [...keys].sort()
}

const holes = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',')

describe('traduções', () => {
  const keys = collectKeys()
  if (process.env.I18N_DUMP) writeFileSync(process.env.I18N_DUMP, JSON.stringify(keys, null, 2))
  for (const [name, table] of [['en', en], ['es', es]]) {
    it(`${name}: todas as frases do jogo estão traduzidas`, () => {
      const missing = keys.filter(k => !(k in table))
      expect(missing).toEqual([])
    })
    it(`${name}: marcadores {…} preservados`, () => {
      for (const k of keys) if (k in table) expect(holes(table[k]), k).toBe(holes(k))
    })
  }
})
