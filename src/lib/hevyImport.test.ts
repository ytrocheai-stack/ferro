import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { importHevyCsv, undoImport, parseHevyCsv } from './hevyImport'

beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
})

describe('Hevy import', () => {
  it('lee el CSV real de Hevy sin workout_id, conserva campos y ordena por set_index', () => {
    const parsed = parseHevyCsv([
      '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"',
      '"Pierna","19 ago 2026, 20:16","19 ago 2026, 21:02","Nota del entreno","Sentadilla Hack (Máquina)","2","Baja controlado, sin rebote", "1","normal","80","8","1.5","","",',
      '"Pierna","19 ago 2026, 20:16","19 ago 2026, 21:02","Nota del entreno","Sentadilla Hack (Máquina)","2","Baja controlado, sin rebote", "0","warmup","40","10","","30","6",',
    ].join('\n'))

    expect(parsed.workouts).toHaveLength(1)
    expect(parsed.workouts[0]).toMatchObject({
      title: 'Pierna',
      description: 'Nota del entreno',
    })
    expect(parsed.workouts[0].exercises?.[0]).toMatchObject({
      title: 'Sentadilla Hack (Máquina)',
      supersets_id: 2,
      notes: 'Baja controlado, sin rebote',
    })
    expect(parsed.workouts[0].exercises?.[0].sets).toEqual([
      expect.objectContaining({ index: 0, type: 'warmup', distance_meters: undefined, duration_seconds: 30, rpe: 6 }),
      expect.objectContaining({ index: 1, type: 'normal', distance_meters: 1500, duration_seconds: undefined, rpe: undefined }),
    ])
  })

  it('interpreta meses españoles al importar sin sustituir la fecha por ahora', async () => {
    const result = await importHevyCsv([
      'title,start_time,end_time,exercise_title,set_index,set_type,weight_kg,reps',
      'Upper,"19 ago 2026, 20:16","19 ago 2026, 21:02",bayesian curl,0,normal,20,10',
    ].join('\n'))
    const workout = await db.workouts.get('hevy-workout-19 ago 2026, 20:16-Upper')

    expect(result.unclassifiedExercises).toEqual([])
    expect(workout?.startedAt).toBe(new Date(2026, 7, 19, 20, 16).getTime())
    expect(Math.abs((workout?.startedAt ?? 0) - Date.now())).toBeGreaterThan(60_000)
  })

  it('acepta abreviaturas de enero, agosto y diciembre del exportador', () => {
    const parsed = parseHevyCsv([
      'title,start_time,end_time,exercise_title,set_index,set_type,weight_kg,reps',
      'Enero,19 ene 2026,19 ene 2026,Sentadilla Hack (Máquina),0,normal,20,10',
      'Agosto,19 ago 2026,19 ago 2026,Sentadilla Hack (Máquina),0,normal,20,10',
      'Diciembre,19 dic 2026,19 dic 2026,Sentadilla Hack (Máquina),0,normal,20,10',
    ].join('\n'))

    expect(parsed.workouts).toHaveLength(3)
  })

  it('bloquea atómicamente los ejercicios que no puede vincular', async () => {
    await expect(importHevyCsv([
      'title,start_time,end_time,exercise_title,set_index,set_type,weight_kg,reps',
      'Upper,2026-08-19T20:16:00Z,2026-08-19T21:02:00Z,Ejercicio desconocido,0,normal,20,10',
    ].join('\n'))).rejects.toThrow(/No se pudieron vincular.*Ejercicio desconocido/)
    expect(await db.workouts.count()).toBe(0)
    expect(await db.customExercises.count()).toBe(0)
  })

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
      'w9,Legs,2026-08-02T10:00:00Z,2026-08-02T11:00:00Z,99,Sentadilla Hack (Máquina),normal,100,5',
    ].join('\n'))
    expect(await db.workouts.get('hevy-workout-w9')).toMatchObject({ name: 'Legs', volumeKg: 500, totalSets: 1 })
    expect(await db.importBatches.get(result.batchId)).toMatchObject({ status: 'completed', source: 'hevy-csv' })
    await undoImport(result.batchId)
    expect(await db.workouts.get('hevy-workout-w9')).toBeUndefined()
    expect(await db.importBatches.get(result.batchId)).toMatchObject({ status: 'undone' })
  })
})
