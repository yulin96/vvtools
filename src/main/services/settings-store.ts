import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, join } from 'path'
import type { AppSettings, VideoOptions, VideoPreset } from '../../shared/types'
import {
  DEFAULT_IMAGE_OPTIONS,
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
      outputMode: 'custom',
      outputDirectory: join(downloadsPath, 'VVTools'),
      outputSuffix: '',
      video: { ...DEFAULT_VIDEO_OPTIONS },
      videoPresets: structuredClone(DEFAULT_VIDEO_PRESETS),
      image: { ...DEFAULT_IMAGE_OPTIONS }
    }
    this.settings = this.read(defaults)
  }

  get(): AppSettings {
    return structuredClone(this.settings)
  }

  update(input: Partial<AppSettings>): AppSettings {
    this.settings = {
      concurrency: clampConcurrency(input.concurrency ?? this.settings.concurrency),
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
      video: { ...this.settings.video, ...input.video },
      videoPresets: input.videoPresets
        ? structuredClone(input.videoPresets)
        : this.settings.videoPresets,
      image: {
        ...this.settings.image,
        ...input.image,
        quality: Math.min(100, Math.max(1, input.image?.quality ?? this.settings.image.quality))
      }
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
        video: migrateVideoOptions(saved.video, defaults.video),
        videoPresets: migrateVideoPresets(saved.videoPresets, defaults.videoPresets),
        image: { ...defaults.image, ...saved.image }
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

export function clampConcurrency(value: number): number {
  if (!Number.isInteger(value)) return 1
  return Math.min(4, Math.max(1, value))
}
