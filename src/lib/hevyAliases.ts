import { normalize } from './format'

/**
 * Canonical dataset IDs for the names emitted by the Hevy export used by the
 * importer. The primary exercise dataset is the only source with GIF media.
 */
export const HEVY_DATASET_ALIASES: Record<string, string> = {
  'abduccion de caderas': '0597',
  'bayesian curl': '0190',
  'behind the back curl cable': '0190',
  'curl de pierna sentado': '0599',
  'curl de piernas acostado maquina': '0586',
  'curl martillo cable': '0165',
  'curl martillo mancuerna': '0313',
  'curl por detras de la espalda polea': '0190',
  'dominada asistida': '0017',
  'elevacion laterales cable': '0178',
  'extension de pierna': '0585',
  'extension de triceps a un brazo cable': '0231',
  'extension de triceps por encima de la cabeza cable': '0194',
  'overhead triceps extension cable': '0194',
  'jalon al pecho agarre cerrado cable': '0818',
  'jalon al pecho cable': '2330',
  'jalon de dorsales con brazos rectos polea': '0238',
  'jalon de remo a un brazo': '3563',
  'rope straight arm pulldown': '0237',
  'jm press barbell': '0052',
  'mariposa pec deck': '0596',
  'peso muerto mancuerna': '0300',
  'preacher curl barbell': '0070',
  'preacher curl machine': '0592',
  'press de banca barra': '0025',
  'press de banca en declive maquina': '1300',
  'press de banca inclinado mancuerna': '0314',
  'press de banca inclinado maquina smith': '0757',
  'press de hombros sentado maquina': '0603',
  'press de piernas': '0739',
  'press frances barra': '0061',
  'press jm barra': '0052',
  'remo inclinado barra': '0027',
  'remo sentado con cable': '0861',
  'remo sentado maquina': '1350',
  'sentadilla bulgara': '0410',
  'sentadilla hack maquina': '0743',
  'sentadilla maquina smith': '0770',
  'triceps con polea': '0201',
  'vuelos posteriores maquina': '0602',
}

export function hevyExerciseKey(value: string | undefined): string {
  return normalize(value ?? '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function datasetExerciseIdForHevyName(value: string | undefined): string | undefined {
  return HEVY_DATASET_ALIASES[hevyExerciseKey(value)]
}
