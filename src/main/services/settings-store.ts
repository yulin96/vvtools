import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { AppSettings } from '../../shared/types'
import { DEFAULT_IMAGE_OPTIONS, DEFAULT_VIDEO_OPTIONS } from '../../shared/constants'

export class SettingsStore {
  private readonly path: string
  private settings: AppSettings

  constructor(userDataPath: string, downloadsPath: string) {
    this.path = join(userDataPath, 'settings.json')
    const defaults: AppSettings = {
      concurrency: 1,
      outputDirectory: join(downloadsPath, 'VVTools'),
      videoOutputMode: 'source',
      video: { ...DEFAULT_VIDEO_OPTIONS },
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
      outputDirectory:
        typeof input.outputDirectory === 'string' && input.outputDirectory.trim()
          ? input.outputDirectory
          : this.settings.outputDirectory,
      videoOutputMode:
        input.videoOutputMode === 'source' || input.videoOutputMode === 'custom'
          ? input.videoOutputMode
          : this.settings.videoOutputMode,
      video: { ...this.settings.video, ...input.video },
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
      const saved = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<AppSettings>
      return {
        ...defaults,
        ...saved,
        concurrency: clampConcurrency(saved.concurrency ?? defaults.concurrency),
        video: { ...defaults.video, ...saved.video },
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

export function clampConcurrency(value: number): number {
  if (!Number.isInteger(value)) return 1
  return Math.min(4, Math.max(1, value))
}
