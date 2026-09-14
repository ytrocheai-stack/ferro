import { describe, expect, it } from 'vitest'
import { nutritionDateForMode } from './nutritionDate'

describe('nutrition date mode', () => {
  it('follows the current day after midnight/background refresh', () => {
    expect(nutritionDateForMode('2026-09-13', '2026-09-14', true)).toBe('2026-09-14')
  })

  it('keeps historical dates pinned', () => {
    expect(nutritionDateForMode('2026-09-13', '2026-09-14', false)).toBe('2026-09-13')
  })
})
