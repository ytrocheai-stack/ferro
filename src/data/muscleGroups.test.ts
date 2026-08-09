import { describe, expect, it } from 'vitest'
import { classifyMuscleDose } from './muscleGroups'

describe('classifyMuscleDose', () => {
  it('clasifica cero, bajo, óptimo y alto con el rango propio del músculo', () => {
    expect(classifyMuscleDose('abs', 0)).toBe('none')
    expect(classifyMuscleDose('abs', 3)).toBe('low')
    expect(classifyMuscleDose('abs', 6)).toBe('optimal')
    expect(classifyMuscleDose('abs', 16)).toBe('optimal')
    expect(classifyMuscleDose('abs', 17)).toBe('high')
  })
})
