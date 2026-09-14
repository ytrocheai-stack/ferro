import { describe, expect, it } from 'vitest'
import type { LoggedSet, Workout } from '../db/types'
import { muscleActivity, frequencyOpacity } from './muscleActivity'

const now = new Date(2026, 8, 12, 18).getTime()
const targets = new Map([
  ['bench', 'pectorals'],
  ['fly', 'pectorals'],
  ['curl', 'biceps'],
  ['cardio', 'cardiovascular system'],
  ['unknown-target', 'not-a-muscle'],
] )
function session(day: number, hour = 10, exerciseId = 'bench', sets: LoggedSet[] = [{ completed: true, type: 'normal', weightKg: 30, reps: 10 }]): Workout {
  return { id: `${day}-${hour}-${exerciseId}`, name: 'Entreno', startedAt: new Date(2026, 8, day, hour).getTime(), endedAt: new Date(2026, 8, day, hour + 1).getTime(), volumeKg: 0, totalSets: sets.length, prs: [], exercises: [{ exerciseId, restSec: 90, sets }] }
}

describe('actividad muscular', () => {
  it('cuenta días distintos, sin duplicar ejercicios ni sesiones del mismo día', () => {
    const result = muscleActivity([session(12), session(12, 12, 'fly'), session(11), session(11, 12, 'curl')], targets, now)
    expect(result.frequency.chest).toBe(2)
    expect(result.sets.chest).toBe(3)
    expect(result.frequency.biceps).toBe(1)
  })
  it('incluye los límites exactos de hoy y hace seis días, excluyendo futuro y fechas antiguas', () => {
    const result = muscleActivity([session(6, 0), session(5, 23), session(12, 18), session(12, 19), session(13)], targets, now)
    expect(result.frequency.chest).toBe(2)
    expect(result.sets.chest).toBe(2)
  })
  it('omite calentamientos y pendientes, y da precedencia a executedSets incluso si está vacío', () => {
    const warmup = session(12, 10, 'bench', [{ completed: true, type: 'warmup', weightKg: 30, reps: 10 }])
    const pending = session(11, 10, 'bench', [{ completed: false, type: 'normal', weightKg: 30, reps: 10 }])
    const executed = session(10, 10, 'bench', [
      { completed: true, type: 'normal', weightKg: 30, reps: 10 },
      { completed: true, type: 'normal', weightKg: 30, reps: 10 },
    ])
    executed.exercises[0].executedSets = [{ completed: true, type: 'normal', weightKg: 30, reps: 10 }]
    const emptyExecuted = session(9, 10, 'bench', [{ completed: true, type: 'normal', weightKg: 30, reps: 10 }])
    emptyExecuted.exercises[0].executedSets = []

    const result = muscleActivity([warmup, pending, executed, emptyExecuted], targets, now)
    expect(result.frequency.chest).toBe(1)
    expect(result.sets.chest).toBe(1)
  })
  it('clasifica solo por el target principal conocido e ignora cardio y objetivos desconocidos', () => {
    const result = muscleActivity([session(12, 10, 'cardio'), session(11, 10, 'unknown-target')], targets, now)
    expect(Object.values(result.frequency).every(value => value === 0)).toBe(true)
    expect(Object.values(result.sets).every(value => value === 0)).toBe(true)
  })
  it('mantiene una escala absoluta y creciente de azul, con cero neutro', () => {
    expect(frequencyOpacity(0)).toBe(0)
    expect(frequencyOpacity(-1)).toBe(0)
    expect(frequencyOpacity(1)).toBeCloseTo(0.3543, 4)
    expect(frequencyOpacity(1)).toBeLessThan(frequencyOpacity(2))
    expect(frequencyOpacity(2)).toBeLessThan(frequencyOpacity(7))
    expect(frequencyOpacity(7)).toBe(0.8)
    expect(frequencyOpacity(Number.NaN)).toBe(0)
    expect(frequencyOpacity(100)).toBe(frequencyOpacity(7))
  })
})
