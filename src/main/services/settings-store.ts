import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, join } from 'path'
import type { AppSettings, ImagePreset, VideoOptions, VideoPreset } from '../../shared/types'
import {
  DEFAULT_IMAGE_OPTIONS,
  DEFAULT_IMAGE_PRESETS,
  DEFAULT_AUDIO_OPTIONS,
  DEFAULT_VIDEO_OPTIONS,
  DEFAULT_VIDEO_PRESETS
} from '../../shared/constants'

export class SettingsStore {
  private readonly path: string
  private settings: AppSettings

  constructor(userDataPath: string, downloadsPath: string) {
    this.path = join(userDataPath, 'settings.json')
    const defaults: AppSettings = {
      concurrency: 1,
      closeBehavior: 'ask',
      outputMode: 'custom',
      outputDirectory: join(downloadsPath, 'VVTools'),
      outputSuffix: '',
      outputNameTemplate: '{name}{suffix}',
      outputConflictPolicy: 'rename',
      completionNotification: true,
      completionSound: false,
      completionAction: 'none',
      video: { ...DEFAULT_VIDEO_OPTIONS },
      videoPresets: structuredClone(DEFAULT_VIDEO_PRESETS),
      image: { ...DEFAULT_IMAGE_OPTIONS },
      imagePresets: structuredClone(DEFAULT_IMAGE_PRESETS),
      audio: { ...DEFAULT_AUDIO_OPTIONS }
    }
    this.settings = this.read(defaults)
  }

  get(): AppSettings {
    return structuredClone(this.settings)
  }

  update(input: Partial<AppSettings>): AppSettings {
    this.settings = {
      concurrency: clampConcurrency(input.concurrency ?? this.settings.concurrency),
      closeBehavior: normalizeCloseBehavior(input.closeBehavior ?? this.settings.closeBehavior),
      outputMode:
        input.outputMode === 'source' || input.outputMode === 'custom'
          ? input.outputMode
          : this.settings.outputMode,
      outputDirectory:
        typeof input.outputDirectory === 'string' && input.outputDirectory.trim()
          ? input.outputDirectory
          : this.settings.outputDirectory,
      outputSuffix:
        typeof input.outputSuffix === 'string' ? input.outputSuffix : this.settings.outputSuffix,
      outputNameTemplate:
        typeof input.outputNameTemplate === 'string'
          ? input.outputNameTemplate
          : this.settings.outputNameTemplate,
      outputConflictPolicy:
        input.outputConflictPolicy === 'rename' ||
        input.outputConflictPolicy === 'overwrite' ||
        input.outputConflictPolicy === 'skip'
          ? input.outputConflictPolicy
          : this.settings.outputConflictPolicy,
      completionNotification:
        typeof input.completionNotification === 'boolean'
          ? input.completionNotification
          : this.settings.completionNotification,
      completionSound:
        typeof input.completionSound === 'boolean'
          ? input.completionSound
          : this.settings.completionSound,
      completionAction:
        input.completionAction === 'none' || input.completionAction === 'openOutput'
          ? input.completionAction
          : this.settings.completionAction,
      video: { ...this.settings.video, ...input.video },
      videoPresets: input.videoPresets
        ? structuredClone(input.videoPresets)
        : this.settings.videoPresets,
      image: {
        ...this.settings.image,
        ...input.image,
        quality: Math.min(100, Math.max(1, input.image?.quality ?? this.settings.image.quality))
      },
      imagePresets: input.imagePresets
        ? structuredClone(input.imagePresets)
        : this.settings.imagePresets,
      audio: { ...this.settings.audio, ...input.audio }
    }
    this.persist()
    return this.get()
  }

  private read(defaults: AppSettings): AppSettings {
    try {
      const saved = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<AppSettings> & {
        video?: LegacyVideoOptions
      }
      return {
        concurrency: clampConcurrency(saved.concurrency ?? defaults.concurrency),
        closeBehavior: normalizeCloseBehavior(saved.closeBehavior ?? defaults.closeBehavior),
        outputMode:
          saved.outputMode === 'source' || saved.outputMode === 'custom'
            ? saved.outputMode
            : defaults.outputMode,
        outputDirectory:
          typeof saved.outputDirectory === 'string' && isAbsolute(saved.outputDirectory)
            ? saved.outputDirectory
            : defaults.outputDirectory,
        outputSuffix:
          typeof saved.outputSuffix === 'string' ? saved.outputSuffix : defaults.outputSuffix,
        outputNameTemplate:
          typeof saved.outputNameTemplate === 'string'
            ? saved.outputNameTemplate
            : defaults.outputNameTemplate,
        outputConflictPolicy:
          saved.outputConflictPolicy === 'rename' ||
          saved.outputConflictPolicy === 'overwrite' ||
          saved.outputConflictPolicy === 'skip'
            ? saved.outputConflictPolicy
            : defaults.outputConflictPolicy,
        completionNotification:
          typeof saved.completionNotification === 'boolean'
            ? saved.completionNotification
            : defaults.completionNotification,
        completionSound:
          typeof saved.completionSound === 'boolean'
            ? saved.completionSound
            : defaults.completionSound,
        completionAction:
          saved.completionAction === 'none' || saved.completionAction === 'openOutput'
            ? saved.completionAction
            : defaults.completionAction,
        video: migrateVideoOptions(saved.video, defaults.video),
        videoPresets: migrateVideoPresets(saved.videoPresets, defaults.videoPresets),
        image: { ...defaults.image, ...saved.image },
        imagePresets: migrateImagePresets(saved.imagePresets, defaults.imagePresets),
        audio: { ...defaults.audio, ...saved.audio }
      }
    } catch {
      return defaults
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temporaryPath = `${this.path}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(this.settings, null, 2), 'utf8')
    renameSync(temporaryPath, this.path)
  }
}

type LegacyVideoOptions = Omit<Partial<VideoOptions>, 'codec'> & {
  codec?: VideoOptions['codec'] | 'copy'
}

interface LegacyVideoPreset {
  id: string
  name: string
  options: LegacyVideoOptions
}

function migrateVideoOptions(
  value: LegacyVideoOptions | undefined,
  fallback: VideoOptions,
  keepOriginal = false
): VideoOptions {
  const legacyCopy = value?.codec === 'copy'
  return {
    ...fallback,
    ...value,
    format: keepOriginal || legacyCopy ? 'source' : (value?.format ?? fallback.format),
    codec: value?.codec === 'copy' ? 'source' : (value?.codec ?? fallback.codec)
  }
}

function migrateVideoPresets(value: unknown, defaults: VideoPreset[]): VideoPreset[] {
  if (!isStoredPresetList(value)) return structuredClone(defaults)
  const presets = value.map((preset) => {
    const keepOriginal = preset.id === 'copy-stream'
    return {
      id: keepOriginal ? 'keep-original' : preset.id,
      name: keepOriginal ? '保持原始' : preset.name,
      options: migrateVideoOptions(preset.options, DEFAULT_VIDEO_OPTIONS, keepOriginal)
    }
  })
  return [...new Map(presets.map((preset) => [preset.id, preset])).values()]
}

function isStoredPresetList(value: unknown): value is LegacyVideoPreset[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (preset) =>
        preset &&
        typeof preset === 'object' &&
        typeof preset.id === 'string' &&
        typeof preset.name === 'string' &&
        preset.options &&
        typeof preset.options === 'object'
    )
  )
}

function migrateImagePresets(value: unknown, defaults: ImagePreset[]): ImagePreset[] {
  if (!Array.isArray(value) || value.length === 0) return structuredClone(defaults)
  const presets = value.filter((preset): preset is ImagePreset =>
    Boolean(
      preset &&
      typeof preset === 'object' &&
      typeof preset.id === 'string' &&
      typeof preset.name === 'string' &&
      preset.options &&
      typeof preset.options === 'object'
    )
  )
  return presets.length > 0
    ? presets.map((preset) => ({
        ...structuredClone(preset),
        options: { ...DEFAULT_IMAGE_OPTIONS, ...preset.options }
      }))
    : structuredClone(defaults)
}

export function clampConcurrency(value: number): number {
  if (!Number.isInteger(value)) return 1
  return Math.min(4, Math.max(1, value))
}

function normalizeCloseBehavior(value: unknown): AppSettings['closeBehavior'] {
  return value === 'ask' || value === 'minimizeToTray' || value === 'quit' ? value : 'ask'
}
