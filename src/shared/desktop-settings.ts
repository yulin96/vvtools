import { DEFAULT_IMAGE_OPTIONS, DEFAULT_IMAGE_PRESETS } from './constants'
import type { DesktopSettings, ImageOptions } from './types'

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  contextMenuEnabled: false,
  notifyOnComplete: true,
  revealOnComplete: false,
  actions: [
    {
      id: 'image-share',
      name: '压缩为分享图',
      enabled: true,
      options: { ...DEFAULT_IMAGE_OPTIONS, ...DEFAULT_IMAGE_PRESETS[1].options },
      outputMode: 'source',
      outputDirectory: '',
      outputSuffix: '_share',
      outputConflictPolicy: 'rename'
    },
    {
      id: 'image-web',
      name: '转换为网站图片',
      enabled: true,
      options: { ...DEFAULT_IMAGE_OPTIONS, ...DEFAULT_IMAGE_PRESETS[0].options },
      outputMode: 'source',
      outputDirectory: '',
      outputSuffix: '_web',
      outputConflictPolicy: 'rename'
    }
  ]
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function normalizeDesktopSettings(
  value: unknown,
  fallback = DEFAULT_DESKTOP_SETTINGS
): DesktopSettings {
  const saved = record(value)
  const actions = Array.isArray(saved.actions) ? saved.actions : fallback.actions
  const ids = new Set<string>()
  const normalized = actions.flatMap((input) => {
    const action = record(input)
    const original = fallback.actions.find((item) => item.id === action.id)
    if (!original || ids.has(original.id)) return []
    ids.add(original.id)
    const options = record(action.options)
    const nextOptions = { ...original.options }
    const enums = {
      compressionMode: ['quality', 'targetSize'],
      resizeMode: ['source', 'width', 'height', 'percentage'],
      format: ['original', 'jpeg', 'png', 'webp'],
      metadataMode: ['strip', 'colorProfile', 'all']
    }
    const ranges = {
      quality: [1, 100],
      targetSizeKb: [1, 100_000],
      width: [1, 32_768],
      height: [1, 32_768],
      percentage: [1, 1000]
    }
    for (const key of Object.keys(nextOptions) as Array<keyof ImageOptions>) {
      const next = options[key]
      const choices = enums[key as keyof typeof enums]
      const range = ranges[key as keyof typeof ranges]
      if (
        (choices && typeof next === 'string' && choices.includes(next)) ||
        (range &&
          typeof next === 'number' &&
          Number.isInteger(next) &&
          next >= range[0] &&
          next <= range[1]) ||
        (typeof nextOptions[key] === 'boolean' && typeof next === 'boolean')
      )
        Object.assign(nextOptions, { [key]: next })
    }
    return [
      {
        ...original,
        name:
          typeof action.name === 'string' &&
          action.name.trim() &&
          ![...action.name].some((character) => character.charCodeAt(0) < 32)
            ? action.name.trim().slice(0, 40)
            : original.name,
        enabled: typeof action.enabled === 'boolean' ? action.enabled : original.enabled,
        options: nextOptions,
        outputMode:
          action.outputMode === 'custom' || action.outputMode === 'source'
            ? action.outputMode
            : original.outputMode,
        outputDirectory:
          typeof action.outputDirectory === 'string'
            ? action.outputDirectory
            : original.outputDirectory,
        outputSuffix:
          typeof action.outputSuffix === 'string' &&
          ![...action.outputSuffix].some(
            (character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character)
          )
            ? action.outputSuffix.trim().replace(/\.+$/u, '').slice(0, 50)
            : original.outputSuffix,
        outputConflictPolicy:
          action.outputConflictPolicy === 'skip' || action.outputConflictPolicy === 'rename'
            ? action.outputConflictPolicy
            : original.outputConflictPolicy
      }
    ]
  })
  for (const action of fallback.actions)
    if (!ids.has(action.id)) normalized.push(structuredClone(action))
  return {
    contextMenuEnabled:
      typeof saved.contextMenuEnabled === 'boolean'
        ? saved.contextMenuEnabled
        : fallback.contextMenuEnabled,
    notifyOnComplete:
      typeof saved.notifyOnComplete === 'boolean'
        ? saved.notifyOnComplete
        : fallback.notifyOnComplete,
    revealOnComplete:
      typeof saved.revealOnComplete === 'boolean'
        ? saved.revealOnComplete
        : fallback.revealOnComplete,
    actions: normalized
  }
}
