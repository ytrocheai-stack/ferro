import { describe, expect, it } from 'vitest'
import { localDateKey } from './useLocalDateKey'

describe('localDateKey', () => {
  it('usa el día local y no el UTC', () => {
    expect(localDateKey(new Date(2026, 7, 8, 23, 59))).toBe('2026-08-08')
  })
})
