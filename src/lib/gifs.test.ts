import { describe, expect, it } from 'vitest'
import type { Exercise } from '../data/exercises'
import { gifCacheStatus } from './gifs'

function exercise(id: string, gif: string | null, custom = false): Exercise {
  return {
    id,
    name: id,
    bodyPart: 'upper body',
    equipment: 'barbell',
    target: 'pectorals',
    muscleGroup: 'chest',
    secondaryMuscles: [],
    image: null,
    gif,
    steps: [],
    custom,
  }
}

describe('gifCacheStatus', () => {
  it('marca la biblioteca completa solo cuando cada GIF del catálogo está almacenado', () => {
    const catalog = [
      exercise('bench', 'videos/bench.gif'),
      exercise('row', 'videos/row.gif'),
      exercise('custom', null, true),
    ]

    expect(gifCacheStatus(catalog, ['/ferro/videos/bench.gif', '/ferro/videos/row.gif'])).toEqual({
      cached: 2,
      total: 2,
      complete: true,
    })
  })

  it('ignora entradas antiguas o ajenas que estén en la misma caché', () => {
    const catalog = [exercise('bench', 'videos/bench.gif'), exercise('row', 'videos/row.gif')]

    expect(
      gifCacheStatus(catalog, ['/ferro/videos/bench.gif', '/ferro/videos/old.gif', '/other.png']),
    ).toEqual({ cached: 1, total: 2, complete: false })
  })
})
