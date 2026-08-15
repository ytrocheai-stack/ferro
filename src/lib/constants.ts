import { clock } from './format'

export const REST_OPTIONS = [0, 15, 30, 45, 60, 90, 120, 150, 180, 240, 300]

export function restLabel(sec: number): string {
  return sec === 0 ? 'Sin descanso' : clock(sec)
}

export const APP_VERSION = '1.2.0'

export const DATASET_URL = 'https://github.com/hasaneyldrm/exercises-dataset'
