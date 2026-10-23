import { describe, expect, it } from 'vitest'
import { challengeList, judge, roundPoints } from '../src/game/challenges'
import { stagesOf } from '../src/game/data'

describe('desafio em grupo', () => {
  it('as rodadas são as primeiras fases do nível escolhido', () => {
    expect(challengeList('padrao', 3).map(l => l.id)).toEqual([11, 12, 13])
    expect(challengeList('facil', 99).length).toBe(stagesOf('facil').length)
    expect(challengeList('especialista', 0).length).toBe(stagesOf('especialista').length)
    expect(challengeList('facil', 1).map(l => l.id)).toEqual([1])
  })
  it('fácil: a resposta vale de qualquer lado (só girar); padrão: precisa virar certo', () => {
    const f1 = stagesOf('facil')[0]
    expect(judge(f1, 'folha', [0, 1, 2]).ok || judge(f1, 'folha', [0, 2, 1]).ok).toBe(true)
    expect(judge(f1, 'folha', [0, 1, 2]).ok).toBe(judge(f1, 'folha', [0, 2, 1]).ok)
    const p1 = stagesOf('padrao')[0]
    expect([[0, 1, 2], [0, 2, 1]].map(p => judge(p1, 'cometa', p as [number, number, number]).ok)).toContain(false)
  })
  it('pontos: rápido e de primeira vale mais; nunca menos que 50', () => {
    expect(roundPoints(0, 90, 0)).toBe(250)
    expect(roundPoints(45000, 90, 0)).toBe(200)
    expect(roundPoints(45000, 90, 2)).toBe(120)
    expect(roundPoints(90000, 90, 9)).toBe(50)
  })
})
