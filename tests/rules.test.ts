import { describe, expect, it } from 'vitest'
import { LEVELS, LEVEL_BY_ID, MOLECULES, TARGETS, TIERS, stagesOf, type MoleculeId, type TargetId } from '../src/game/data'
import { armsOf, judge } from '../src/game/challenges'
import { bestFit, evaluate, evaluateTurnOnly, PERMS, permsFor, type Perm } from '../src/game/rules'
import PROTEINS from '../src/game/proteins.json'

const best = (m: MoleculeId, t: TargetId) => bestFit(MOLECULES[m], TARGETS[t])

describe('encaixe didático', () => {
  it('nenhuma molécula usa nome de medicamento real', () => {
    const banned = /ibuprof|aspirin|loratad|salbutam|propranol|paracetam|dipiron|adrenal|histamin|epinef|heparin|varfar/i
    for (const m of Object.values(MOLECULES)) {
      expect(banned.test(m.name + ' ' + m.about), m.id).toBe(false)
    }
    for (const l of LEVELS) expect(banned.test(l.intro + l.goal + l.learned), l.title).toBe(false)
  })
  it('padrão e laboratório: só a Cometa trava a tripsina (com carga)', () => {
    expect(best('cometa', 'tripsina')).toMatchObject({ fit: 'strong', activates: false })
    expect(best('gota', 'tripsina').fit).toBe('slip')
    expect(best('gigante', 'tripsina').fit).toBe('clash')
    expect(best('pluma', 'tripsina').fit).toBe('weak')
    expect(best('substrato', 'tripsina')).toMatchObject({ fit: 'strong', activates: true })
  })
  it('tripsina com carga: a Faísca (−) é repelida pelo Asp189 (−) quando vai na âncora', () => {
    const r = evaluate(MOLECULES.faisca, TARGETS.tripsina, [0, 1, 2])
    expect(r.fit).toBe('repel')
  })
  it('fase 1 (crianças): só a Folha trava, e as outras dão resultados diferentes', () => {
    expect(best('folha', 'tripsina_facil')).toMatchObject({ fit: 'strong', activates: false })
    expect(best('gigante', 'tripsina_facil').fit).toBe('clash')
    expect(best('grao', 'tripsina_facil').fit).toBe('slip')
    expect(best('gota', 'tripsina_facil').fit).toBe('weak')
    expect(best('nuvem', 'tripsina_facil').fit).toBe('weak')
    expect(best('alimento', 'tripsina_facil')).toMatchObject({ fit: 'strong', activates: true })
  })
  it('fase 1 (crianças): a Folha encaixa só GIRANDO, de qualquer lado (nunca precisa virar)', () => {
    const strong = PERMS.filter(p => evaluate(MOLECULES.folha, TARGETS.tripsina_facil, p).fit === 'strong')
    // One rotation (cyclic perm) and one flipped perm both work: whichever face the hand shows, a turn is enough.
    expect(strong.some(p => PERMS.slice(0, 3).includes(p))).toBe(true)
    expect(strong.some(p => PERMS.slice(3).includes(p))).toBe(true)
  })
  it('fácil fase 3: β2 sem cargas; Raio LIGA, Escudo bloqueia', () => {
    const lv = LEVEL_BY_ID.get(3)!
    expect(lv.targets).toEqual(['beta2_facil'])
    expect(best('raio_f', 'beta2_facil')).toMatchObject({ fit: 'strong', activates: true })
    expect(best('mensageiro_f', 'beta2_facil')).toMatchObject({ fit: 'strong', activates: true })
    const ok = lv.tray.filter(m => { const r = best(m, 'beta2_facil'); return r.fit === 'strong' && !r.activates })
    expect(ok).toEqual(['escudo_f'])
  })
  it('nível fácil: a molécula certa encaixa só GIRANDO (de qualquer lado, sem virar)', () => {
    for (const [lv, m] of [[1, 'folha'], [2, 'laco'], [3, 'escudo_f']] as const) {
      const level = LEVEL_BY_ID.get(lv)!
      expect(level.turnOnly, level.title).toBe(true)
      const t = TARGETS[level.targets[0]]
      // Whatever face the hand shows (all 6 orientations), one of the 3 turns docks strongly.
      for (const face of PERMS) {
        const turns: Perm[] = [0, 1, 2].map(k => [face[k], face[(k + 1) % 3], face[(k + 2) % 3]] as Perm)
        expect(turns.some(p => evaluateTurnOnly(MOLECULES[m], t, p).fit === 'strong'), `${m} ${face}`).toBe(true)
      }
    }
  })
  it('nível fácil: girar só não basta para as moléculas erradas', () => {
    for (const lv of stagesOf('facil')) for (const m of lv.tray) {
      if (PERMS.some(p => judge(lv, m, p).ok)) continue
      for (const p of PERMS) expect(judge(lv, m, p).ok, `${lv.id} ${m}`).toBe(false)
    }
  })
  it('fase 2: mensageiro e Raio ativam o β2, Escudo bloqueia', () => {
    expect(best('mensageiro', 'beta2')).toMatchObject({ fit: 'strong', activates: true })
    expect(best('raio', 'beta2')).toMatchObject({ fit: 'strong', activates: true })
    expect(best('escudo', 'beta2')).toMatchObject({ fit: 'strong', activates: false })
  })
  it('fase 3: Trevo é seletiva para a trombina, Cometa não', () => {
    expect(best('trevo', 'trombina')).toMatchObject({ fit: 'strong', activates: false })
    expect(best('trevo', 'tripsina').fit).toBe('clash')
    expect(best('cometa', 'trombina').fit).not.toBe('strong')
    expect(best('cometa', 'tripsina').fit).toBe('strong')
  })
  it('a resposta certa combina cor com cor (sem parte na química errada)', () => {
    for (const [m, t] of [['cometa', 'tripsina'], ['folha', 'tripsina_facil'], ['laco', 'trombina_facil'], ['escudo_f', 'beta2_facil'], ['estrela', 'tripsina_exp'], ['polvo', 'trombina_exp'], ['escudo', 'beta2'], ['trevo', 'trombina']] as const) {
      const r = best(m, t)
      expect(r.slots.every(sl => sl.chem !== 'mismatch'), `${m}:${t}`).toBe(true)
    }
  })
  it('só moléculas naturais ou agonistas ativam', () => {
    // Gota in the easy β2: its water-loving arm fits the switch, but the fit is only weak (a "partial" agonist).
    const allowed = new Set(['substrato:tripsina', 'substrato:trombina', 'mensageiro:beta2', 'raio:beta2',
      'mensageiro_f:beta2_facil', 'raio_f:beta2_facil', 'mensageiro:beta2_facil', 'raio:beta2_facil', 'gota:beta2_facil', 'farol:beta2_exp', 'flor:beta2_exp'])
    for (const m of Object.values(MOLECULES)) for (const t of Object.values(TARGETS)) for (const p of permsFor(t.cavities.length)) {
      if (m.groups.length !== t.cavities.length) continue
      const r = evaluate(m, t, p)
      if (r.activates) expect(m.substrate || allowed.has(`${m.id}:${t.id}`), `${m.id}:${t.id}`).toBe(true)
    }
  })
  it('cada fase tem exatamente UMA molécula certa', () => {
    const sol = (id: number) => { const l = LEVEL_BY_ID.get(id)!; return l.tray.filter(m => permsFor(armsOf(l)).some(p => judge(l, m, p).ok)) }
    expect(stagesOf('facil').map(l => sol(l.id))).toEqual([['folha'], ['laco'], ['escudo_f']])
    expect(stagesOf('padrao').map(l => sol(l.id))).toEqual([['cometa'], ['trevo'], ['escudo']])
    expect(stagesOf('especialista').map(l => sol(l.id))).toEqual([['estrela'], ['polvo'], ['coroa']])
  })
  it('níveis padrão e especialista: a molécula certa precisa da orientação certa (girar E virar)', () => {
    for (const tier of ['padrao', 'especialista'] as const) for (const l of stagesOf(tier)) {
      if (l.kind === 'selective') continue
      expect(l.turnOnly, l.title).toBeFalsy()
      const perms = permsFor(armsOf(l))
      const m = l.tray.find(x => perms.some(p => judge(l, x, p).ok))!
      expect(perms.filter(p => judge(l, m, p).ok).length, l.title).toBeLessThan(perms.length)
    }
  })
  it('nível fácil: as três fases sem nenhuma carga (só formato, óleo e água)', () => {
    const charged = (c: string) => c === 'pos' || c === 'neg'
    for (const id of [1, 2, 3]) {
      const lv = LEVEL_BY_ID.get(id)!
      for (const tg of lv.targets) expect(TARGETS[tg].cavities.some(c => charged(c.chem))).toBe(false)
      for (const m of [...lv.tray, lv.natural!]) expect(MOLECULES[m].groups.some(gr => charged(gr.chem)), m).toBe(false)
    }
  })
  it('especialista: bolsos de 4 e 5 pontos, moléculas com o mesmo número de pontas', () => {
    for (const l of stagesOf('especialista')) {
      const n = armsOf(l)
      expect(n, l.title).toBeGreaterThanOrEqual(4)
      for (const tg of l.targets) expect(TARGETS[tg].cavities.length).toBe(n)
      for (const m of l.tray) expect(MOLECULES[m].groups.length, `${l.id} ${m}`).toBe(n)
      expect(l.tray.length).toBeGreaterThanOrEqual(6)
    }
    // Classic stages keep 3-arm molecules.
    for (const l of LEVELS.filter(x => x.tier !== 'especialista')) for (const m of l.tray) expect(MOLECULES[m].groups.length).toBe(3)
  })
  it('especialista: várias moléculas encaixam forte (a ordem e o tamanho das pontas decidem)', () => {
    const strong = (l: number, tg: TargetId) => LEVEL_BY_ID.get(l)!.tray.filter(m => best(m, tg).fit === 'strong')
    expect(strong(21, 'tripsina_exp').length).toBeGreaterThanOrEqual(3)
    expect(strong(23, 'beta2_exp').length).toBeGreaterThanOrEqual(3)
    // Same arms as the answer, other order around the ring: never strong.
    expect(best('tranca', 'tripsina_exp').fit).not.toBe('strong')
    expect(best('leque', 'beta2_exp').fit).not.toBe('strong')
  })
  it('todos os níveis têm 3 fases', () => {
    for (const tier of TIERS) expect(stagesOf(tier).length, tier).toBe(3)
  })
  it('ids das fases são únicos e todos os níveis têm fases', () => {
    expect(new Set(LEVELS.map(l => l.id)).size).toBe(LEVELS.length)
    for (const tier of TIERS) expect(stagesOf(tier).length).toBeGreaterThanOrEqual(3)
  })
  it('as superfícies 3D foram geradas com os mesmos bolsos dos dados', () => {
    for (const t of Object.values(TARGETS)) {
      const p = (PROTEINS as Record<string, { pdb: string; cavities: { size: number; chem: string }[] }>)[t.id]
      expect(p.pdb).toBe(t.pdb)
      expect(p.cavities).toEqual(t.cavities)
    }
  })
})
