import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { importHevyCsv, importHevyFile, importHevyPayload, undoImport } from './hevyImport'

const MINIMAL_HEVY_XLSX =
  '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'

const bytesFromBase64 = (value: string) => Uint8Array.from(Buffer.from(value, 'base64'))

beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
})

describe('Hevy file import', () => {
  it('reads an XLSX workbook and maps Hevy names to the GIF dataset without creating customs', async () => {
    const file = new File([bytesFromBase64(MINIMAL_HEVY_XLSX)], 'hevy.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const result = await importHevyFile(file)

    expect(result.source).toBe('hevy-csv')
    expect(result.counts.workout).toBe(1)
    expect(result.counts.exercise).toBeUndefined()
    expect(await db.customExercises.count()).toBe(0)
    await expect(db.workouts.get('hevy-workout-19 ago 2026, 20:16-Upper')).resolves.toMatchObject({
      exercises: [expect.objectContaining({ exerciseId: '0025' })],
    })
  })

  it('explains that a binary Excel-like file is invalid instead of exposing ZIP bytes', async () => {
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])], 'hevy.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    await expect(importHevyFile(file)).rejects.toThrow(/Excel|XLSX|válido|corrupto/i)
    await expect(importHevyFile(file)).rejects.not.toThrow(/PK|Content_Types|workbook.xml/i)
  })

  it('rejects an unmapped exercise before writing any part of the batch', async () => {
    const csv = [
      'title,start_time,end_time,exercise_title,set_index,set_type,weight_kg,reps',
      'Upper,"19 ago 2026, 20:16","19 ago 2026, 21:02",Movimiento inventado,0,normal,20,10',
    ].join('\n')

    await expect(importHevyCsv(csv)).rejects.toThrow(/Movimiento inventado/)
    expect(await db.workouts.count()).toBe(0)
    expect(await db.importBatches.count()).toBe(0)
  })

  it('ignores unused API templates that are outside the workout history', async () => {
    const result = await importHevyPayload({
      templates: [{ id: 'unused', title: 'Movimiento inventado' }],
      workouts: [{
        id: 'used',
        title: 'Upper',
        start_time: '2026-08-19T20:16:00Z',
        end_time: '2026-08-19T21:02:00Z',
        exercises: [{ exercise_template_id: '25', title: 'Press de Banca (Barra)', sets: [{ type: 'normal', weight_kg: 80, reps: 8 }] }],
      }],
    }, 'hevy-api')
    expect(result.counts.workout).toBe(1)
  })

  it('restores the previous records when undoing an idempotent reimport', async () => {
    const csv = [
      'workout_id,workout_title,start_time,end_time,exercise_template_id,exercise_title,set_type,weight_kg,reps',
      'same,Upper,2026-08-19T20:16:00Z,2026-08-19T21:02:00Z,25,Press de Banca (Barra),normal,80,8',
    ].join('\n')

    await importHevyCsv(csv)
    const second = await importHevyCsv(csv)
    await undoImport(second.batchId)

    expect(await db.workouts.count()).toBe(1)
    expect(await db.customExercises.count()).toBe(0)
  })

  it('refuses to undo after an imported record has been edited', async () => {
    const csv = [
      'workout_id,workout_title,start_time,end_time,exercise_template_id,exercise_title,set_type,weight_kg,reps',
      'edited,Upper,2026-08-19T20:16:00Z,2026-08-19T21:02:00Z,25,Press de Banca (Barra),normal,80,8',
    ].join('\n')

    const first = await importHevyCsv(csv)
    await db.workouts.update('hevy-workout-edited', { name: 'Editado por el usuario' })
    await expect(undoImport(first.batchId)).rejects.toThrow(/modificado después/)
    await expect(db.workouts.get('hevy-workout-edited')).resolves.toMatchObject({ name: 'Editado por el usuario' })
  })
})
