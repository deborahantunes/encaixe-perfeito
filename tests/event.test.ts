import { describe, expect, it } from 'vitest'
import { fmtTime, normalizeEvent } from '../src/game/event'
import { stagesOf } from '../src/game/data'

describe('modo evento', () => {
  it('formata o tempo em m:ss', () => {
    expect(fmtTime(0)).toBe('0:00')
    expect(fmtTime(9_999)).toBe('0:09')
    expect(fmtTime(83_400)).toBe('1:23')
    expect(fmtTime(605_000)).toBe('10:05')
  })
  it('número de fases fica entre 1 e o total do nível', () => {
    expect(normalizeEvent({ tier: 'facil', count: 9 }).count).toBe(stagesOf('facil').length)
    expect(normalizeEvent({ tier: 'padrao', count: 0 }).count).toBe(stagesOf('padrao').length)
    expect(normalizeEvent({ tier: 'especialista', count: 2 })).toEqual({ tier: 'especialista', count: 2 })
  })
})
