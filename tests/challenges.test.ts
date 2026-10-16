import { describe, expect, it } from 'vitest'
import { CHALLENGES, judge, roundPoints } from '../src/game/challenges'
import { PERMS } from '../src/game/rules'

const solutions = (i: number) => CHALLENGES[i].tray.filter(m => PERMS.some(p => judge(CHALLENGES[i], m, p).ok))

describe('desafios em grupo', () => {
  it('cada desafio tem exatamente uma molécula certa', () => {
    expect(CHALLENGES.map((_, i) => solutions(i))).toEqual([['cometa'], ['escudo'], ['raio'], ['trevo'], ['trevo']])
  })
  it('a resposta certa só vale na orientação certa (exceto o seletivo)', () => {
    for (const ch of CHALLENGES.slice(0, 4)) {
      const sol = ch.tray.find(m => PERMS.some(p => judge(ch, m, p).ok))!
      expect(PERMS.filter(p => judge(ch, sol, p).ok).length).toBeLessThan(6)
    }
  })
  it('pontos: rápido e de primeira vale mais; nunca menos que 50', () => {
    expect(roundPoints(0, 90, 0)).toBe(250)
    expect(roundPoints(45000, 90, 0)).toBe(200)
    expect(roundPoints(45000, 90, 2)).toBe(120)
    expect(roundPoints(90000, 90, 9)).toBe(50)
  })
})
