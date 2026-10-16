import { describe, expect, it } from 'vitest'
import { LEVELS, MOLECULES, TARGETS, type MoleculeId, type TargetId } from '../src/game/data'
import { bestFit, evaluate, PERMS } from '../src/game/rules'
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
  it('fase 1: só a Cometa trava a tripsina', () => {
    expect(best('cometa', 'tripsina')).toMatchObject({ fit: 'strong', activates: false })
    expect(best('gota', 'tripsina').fit).toBe('slip')
    expect(best('gigante', 'tripsina').fit).toBe('clash')
    expect(best('pluma', 'tripsina').fit).toBe('weak')
    expect(best('substrato', 'tripsina')).toMatchObject({ fit: 'strong', activates: true })
  })
  it('fase 1: a Faísca (−) é repelida pelo Asp189 (−) quando vai na âncora', () => {
    const r = evaluate(MOLECULES.faisca, TARGETS.tripsina, [0, 1, 2])
    expect(r.fit).toBe('repel')
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
    for (const [m, t] of [['cometa', 'tripsina'], ['escudo', 'beta2'], ['trevo', 'trombina']] as const) {
      const r = best(m, t)
      expect(r.slots.every(sl => sl.chem !== 'mismatch'), `${m}:${t}`).toBe(true)
    }
  })
  it('só moléculas naturais ou agonistas ativam', () => {
    const allowed = new Set(['substrato:tripsina', 'substrato:trombina', 'mensageiro:beta2', 'raio:beta2'])
    for (const m of Object.values(MOLECULES)) for (const t of Object.values(TARGETS)) for (const p of PERMS) {
      const r = evaluate(m, t, p)
      if (r.activates) expect(allowed.has(`${m.id}:${t.id}`), `${m.id}:${t.id}`).toBe(true)
    }
  })
  it('cada fase tem uma solução', () => {
    for (const level of LEVELS.filter(l => l.kind === 'block')) {
      expect(level.tray.some(m => { const r = best(m, level.targets[0]); return r.fit === 'strong' && !r.activates })).toBe(true)
    }
    const sel = LEVELS.find(l => l.kind === 'selective')!
    const ok = sel.tray.filter(m => sel.targets.every(t => {
      const r = best(m, t)
      return t === sel.blockTarget ? r.fit === 'strong' && !r.activates : r.fit !== 'strong' && r.fit !== 'weak'
    }))
    expect(ok).toEqual(['trevo'])
  })
  it('as superfícies 3D foram geradas com os mesmos bolsos dos dados', () => {
    for (const t of Object.values(TARGETS)) {
      const p = (PROTEINS as Record<string, { pdb: string; cavities: { size: number; chem: string }[] }>)[t.id]
      expect(p.pdb).toBe(t.pdb)
      expect(p.cavities).toEqual(t.cavities)
    }
  })
})
