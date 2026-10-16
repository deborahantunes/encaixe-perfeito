import { describe, expect, it } from 'vitest'
import { EVENT_LEVELS, fmtTime } from '../src/game/event'
import { LEVELS } from '../src/game/data'

describe('modo evento', () => {
  it('formata o tempo em m:ss', () => {
    expect(fmtTime(0)).toBe('0:00')
    expect(fmtTime(9_999)).toBe('0:09')
    expect(fmtTime(83_400)).toBe('1:23')
    expect(fmtTime(605_000)).toBe('10:05')
  })
  it('joga as fases 1, 2 e 3 em ordem', () => {
    expect(EVENT_LEVELS.map(i => LEVELS[i].id)).toEqual([1, 2, 3])
  })
})
