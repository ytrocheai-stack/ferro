import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { importHevyCsv, undoImport, parseHevyCsv } from './hevyImport'

beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
})

describe('Hevy import', () => {
  it('groups CSV rows into one workout and preserves warmup/drop set types', () => {
    const parsed = parseHevyCsv([
      'workout_id,workout_title,start_time,end_time,exercise_template_id,exercise_title,set_type,weight_kg,reps',
      'w1,Push,2026-08-01T10:00:00Z,2026-08-01T11:00:00Z,42,Bench Press,warmup,20,10',
      'w1,Push,2026-08-01T10:00:00Z,2026-08-01T11:00:00Z,42,Bench Press,normal,60,8',
      'w1,Push,2026-08-01T10:00:00Z,2026-08-01T11:00:00Z,42,Bench Press,dropset,40,12',
    ].join('\n'))
    expect(parsed.workouts).toHaveLength(1)
    expect(parsed.workouts[0].exercises?.[0].sets?.map((s) => s.type)).toEqual(['warmup', 'normal', 'drop'])
  })

  it('writes an import batch and can undo the imported records', async () => {
    const result = await importHevyCsv([
      'workout_id,workout_title,start_time,end_time,exercise_template_id,exercise_title,set_type,weight_kg,reps',
      'w9,Legs,2026-08-02T10:00:00Z,2026-08-02T11:00:00Z,99,Squat,normal,100,5',
    ].join('\n'))
    expect(await db.workouts.get('hevy-workout-w9')).toMatchObject({ name: 'Legs', volumeKg: 500, totalSets: 1 })
    expect(await db.importBatches.get(result.batchId)).toMatchObject({ status: 'completed', source: 'hevy-csv' })
    await undoImport(result.batchId)
    expect(await db.workouts.get('hevy-workout-w9')).toBeUndefined()
    expect(await db.importBatches.get(result.batchId)).toMatchObject({ status: 'undone' })
  })
})
