import { availableParallelism } from 'os'
import { DEFAULT_CONCURRENCY_SETTINGS } from '../../shared/constants'
import type { ConcurrencySettings, TaskConcurrencyLimits, TaskKind } from '../../shared/types'

const MAXIMUM_CONCURRENCY: TaskConcurrencyLimits = {
  image: 16,
  video: 2,
  audio: 4,
  pdf: 2,
  font: 1
}

export function isConcurrencySettings(value: unknown): value is ConcurrencySettings {
  if (!value || typeof value !== 'object') return false
  const settings = value as Partial<ConcurrencySettings>
  return (
    (settings.mode === 'auto' || settings.mode === 'custom') && isConcurrencyLimits(settings.custom)
  )
}

export function normalizeConcurrencySettings(
  value: unknown,
  fallback: ConcurrencySettings = DEFAULT_CONCURRENCY_SETTINGS
): ConcurrencySettings {
  if (typeof value === 'number') {
    const legacy = clampConcurrency(value, 1, 4)
    return {
      mode: 'custom',
      custom: {
        image: legacy,
        video: Math.min(legacy, MAXIMUM_CONCURRENCY.video),
        audio: legacy,
        pdf: Math.min(legacy, MAXIMUM_CONCURRENCY.pdf),
        font: 1
      }
    }
  }
  return isConcurrencySettings(value) ? structuredClone(value) : structuredClone(fallback)
}

export function resolveTaskConcurrency(
  settings: ConcurrencySettings,
  parallelism = availableParallelism()
): TaskConcurrencyLimits {
  if (settings.mode === 'custom') return structuredClone(settings.custom)
  const processors = Math.max(1, parallelism)
  return {
    image: Math.min(16, processors),
    video: 1,
    audio: Math.min(2, Math.max(1, Math.floor(processors / 4))),
    pdf: 1,
    font: 1
  }
}

export function maximumConcurrency(kind: TaskKind): number {
  return MAXIMUM_CONCURRENCY[kind]
}

function isConcurrencyLimits(value: unknown): value is TaskConcurrencyLimits {
  if (!value || typeof value !== 'object') return false
  const limits = value as Partial<TaskConcurrencyLimits>
  return (['image', 'video', 'audio', 'pdf', 'font'] as const).every((kind) => {
    const limit = limits[kind]
    return (
      typeof limit === 'number' &&
      Number.isInteger(limit) &&
      limit >= 1 &&
      limit <= MAXIMUM_CONCURRENCY[kind]
    )
  })
}

function clampConcurrency(value: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value)) return minimum
  return Math.min(maximum, Math.max(minimum, value))
}
