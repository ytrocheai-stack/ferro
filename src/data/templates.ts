import type { RoutineExercise } from '../db/types'

export interface RoutineTemplate {
  name: string
  exercises: Omit<RoutineExercise, 'restSec'>[]
}

export interface ProgramTemplate {
  id: string
  name: string
  daysPerWeek: number
  description: string
  routines: RoutineTemplate[]
}

const ex = (exerciseId: string, plannedSets = 3, repRangeMin = 8, repRangeMax = 12): Omit<RoutineExercise, 'restSec'> => ({
  exerciseId,
  plannedSets,
  repRangeMin,
  repRangeMax,
})

/** IDs verificados contra public/data/exercises.json (dataset hasaneyldrm). */
export const PROGRAM_TEMPLATES: ProgramTemplate[] = [
  {
    id: 'ppl',
    name: 'Push / Pull / Legs',
    daysPerWeek: 6,
    description: 'Empuje, tirón y pierna en 6 días — máximo volumen semanal, ideal con experiencia previa.',
    routines: [
      {
        name: 'Push (Pecho, Hombro, Tríceps)',
        exercises: [
          ex('0025', 4, 6, 10),
          ex('0314', 3),
          ex('0091', 3, 6, 10),
          ex('0334', 3, 12, 15),
          ex('0241', 3, 10, 15),
        ],
      },
      {
        name: 'Pull (Espalda, Bíceps)',
        exercises: [
          ex('0652', 4, 6, 10),
          ex('0027', 3, 8, 10),
          ex('0180', 3),
          ex('0203', 3, 12, 15),
          ex('0031', 3, 10, 12),
          ex('0313', 2, 10, 12),
        ],
      },
      {
        name: 'Legs (Pierna completa)',
        exercises: [
          ex('0026', 4, 6, 10),
          ex('0085', 3, 8, 10),
          ex('0585', 3, 12, 15),
          ex('0586', 3, 10, 12),
          ex('0088', 4, 12, 15),
        ],
      },
    ],
  },
  {
    id: 'upper-lower',
    name: 'Torso / Pierna',
    daysPerWeek: 4,
    description: 'Dos días de torso y dos de pierna — buen equilibrio entre volumen y recuperación.',
    routines: [
      {
        name: 'Torso A',
        exercises: [ex('0025', 4, 6, 10), ex('0027', 3, 8, 10), ex('0091', 3, 6, 10), ex('0652', 3), ex('0031', 2, 10, 12), ex('0241', 2, 10, 15)],
      },
      {
        name: 'Pierna A',
        exercises: [ex('0026', 4, 6, 10), ex('0085', 3, 8, 10), ex('0585', 3, 12, 15), ex('0586', 3, 10, 12), ex('0088', 3, 12, 15)],
      },
      {
        name: 'Torso B',
        exercises: [ex('0314', 3), ex('0180', 3), ex('0405', 3, 8, 10), ex('0334', 3, 12, 15), ex('0313', 2, 10, 12), ex('0030', 2, 8, 10)],
      },
      {
        name: 'Pierna B',
        exercises: [ex('0032', 3, 5, 8), ex('1760', 3), ex('0582', 3, 10, 12), ex('0088', 3, 12, 15), ex('0212', 3, 12, 15)],
      },
    ],
  },
  {
    id: 'full-body',
    name: 'Full-body',
    daysPerWeek: 3,
    description: 'Cuerpo completo 3 días no consecutivos — eficiente y recomendado para empezar.',
    routines: [
      {
        name: 'Full-body A',
        exercises: [ex('0026', 3, 6, 10), ex('0025', 3, 8, 10), ex('0027', 3, 8, 10), ex('0334', 2, 12, 15), ex('0464', 3, 30, 45)],
      },
      {
        name: 'Full-body B',
        exercises: [ex('0032', 3, 5, 8), ex('0091', 3, 6, 10), ex('0652', 3), ex('0031', 2, 10, 12), ex('0212', 3, 12, 15)],
      },
      {
        name: 'Full-body C',
        exercises: [ex('1760', 3), ex('0314', 3), ex('0180', 3), ex('0313', 2, 10, 12), ex('0088', 3, 12, 15)],
      },
    ],
  },
  {
    id: 'bro-split',
    name: 'Bro split',
    daysPerWeek: 5,
    description: 'Un grupo muscular por día — mucho volumen por sesión, popular para estética.',
    routines: [
      {
        name: 'Pecho',
        exercises: [ex('0025', 4, 6, 10), ex('0314', 3), ex('0251', 3, 8, 12), ex('0241', 3, 10, 15)],
      },
      {
        name: 'Espalda',
        exercises: [ex('0652', 4, 6, 10), ex('0027', 3, 8, 10), ex('0180', 3), ex('0203', 3, 12, 15)],
      },
      {
        name: 'Hombro',
        exercises: [ex('0091', 4, 6, 10), ex('0334', 3, 12, 15), ex('0406', 3, 12, 15)],
      },
      {
        name: 'Brazo',
        exercises: [ex('0031', 3, 10, 12), ex('0313', 3, 10, 12), ex('0030', 3, 8, 10), ex('0241', 2, 10, 15)],
      },
      {
        name: 'Pierna',
        exercises: [ex('0026', 4, 6, 10), ex('0085', 3, 8, 10), ex('0585', 3, 12, 15), ex('0586', 3, 10, 12), ex('0088', 4, 12, 15)],
      },
    ],
  },
]
