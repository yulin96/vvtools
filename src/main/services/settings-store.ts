import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, join } from 'path'
import type {
  AppSettings,
  AppSettingsPatch,
  AudioOptions,
  CommonSettings,
  FontOptions,
  PdfOptions,
  VideoOptions
} from '../../shared/types'
import {
  DEFAULT_AUDIO_OPTIONS,
  DEFAULT_CONCURRENCY_SETTINGS,
  DEFAULT_FONT_OPTIONS,
  DEFAULT_IMAGE_OPTIONS,
  DEFAULT_PDF_OPTIONS,
  DEFAULT_VIDEO_OPTIONS
} from '../../shared/constants'
import { normalizeConcurrencySettings } from './task-concurrency'

export class SettingsStore {
  private readonly path: string
  private settings: AppSettings

  constructor(userDataPath: string, downloadsPath: string) {
    this.path = join(userDataPath, 'settings.json')
    const defaults: AppSettings = {
      common: {
        concurrency: structuredClone(DEFAULT_CONCURRENCY_SETTINGS),
        closeBehavior: 'ask',
        outputMode: 'custom',
        outputDirectory: join(downloadsPath, 'VVTools'),
        outputSuffix: '_c',
        outputNameTemplate: '{name}{suffix}',
        outputConflictPolicy: 'rename'
      },
      image: {
        lastOptions: { ...DEFAULT_IMAGE_OPTIONS }
      },
      video: {
        lastOptions: { ...DEFAULT_VIDEO_OPTIONS }
      },
      audio: {
        lastOptions: { ...DEFAULT_AUDIO_OPTIONS }
      },
      pdf: {
        lastOptions: { ...DEFAULT_PDF_OPTIONS }
      },
      font: {
        lastOptions: { ...DEFAULT_FONT_OPTIONS }
      }
    }
    this.settings = this.read(defaults)
  }

  get(): AppSettings {
    return structuredClone(this.settings)
  }

  update(input: AppSettingsPatch): AppSettings {
    const common = input.common
    const imageOptions = input.image?.lastOptions
    this.settings = {
      common: {
        concurrency: normalizeConcurrencySettings(
          common?.concurrency,
          this.settings.common.concurrency
        ),
        closeBehavior: normalizeCloseBehavior(
          common?.closeBehavior ?? this.settings.common.closeBehavior
        ),
        outputMode:
          common?.outputMode === 'source' || common?.outputMode === 'custom'
            ? common.outputMode
            : this.settings.common.outputMode,
        outputDirectory:
          typeof common?.outputDirectory === 'string' && common.outputDirectory.trim()
            ? common.outputDirectory
            : this.settings.common.outputDirectory,
        outputSuffix:
          typeof common?.outputSuffix === 'string'
            ? common.outputSuffix
            : this.settings.common.outputSuffix,
        outputNameTemplate:
          typeof common?.outputNameTemplate === 'string'
            ? common.outputNameTemplate
            : this.settings.common.outputNameTemplate,
        outputConflictPolicy:
          common?.outputConflictPolicy === 'rename' ||
          common?.outputConflictPolicy === 'overwrite' ||
          common?.outputConflictPolicy === 'skip'
            ? common.outputConflictPolicy
            : this.settings.common.outputConflictPolicy
      },
      image: {
        lastOptions: imageOptions
          ? {
              ...this.settings.image.lastOptions,
              ...imageOptions,
              quality: Math.min(100, Math.max(1, imageOptions.quality))
            }
          : this.settings.image.lastOptions
      },
      video: {
        lastOptions: input.video?.lastOptions
          ? { ...this.settings.video.lastOptions, ...input.video.lastOptions }
          : this.settings.video.lastOptions
      },
      audio: {
        lastOptions: input.audio?.lastOptions
          ? { ...this.settings.audio.lastOptions, ...input.audio.lastOptions }
          : this.settings.audio.lastOptions
      },
      pdf: {
        lastOptions: input.pdf?.lastOptions
          ? { ...this.settings.pdf.lastOptions, ...input.pdf.lastOptions }
          : this.settings.pdf.lastOptions
      },
      font: {
        lastOptions: input.font?.lastOptions
          ? { ...this.settings.font.lastOptions, ...input.font.lastOptions }
          : this.settings.font.lastOptions
      }
    }
    this.persist()
    return this.get()
  }

  private read(defaults: AppSettings): AppSettings {
    try {
      const saved = JSON.parse(readFileSync(this.path, 'utf8')) as unknown
      return migrateSettings(saved, defaults)
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

type LegacyVideoOptions = Omit<Partial<VideoOptions>, 'codec' | 'frameRate'> & {
  codec?: VideoOptions['codec'] | 'copy'
  frameRate?: VideoOptions['frameRate'] | '25'
}

function migrateSettings(value: unknown, defaults: AppSettings): AppSettings {
  if (!isRecord(value)) return defaults
  const common = isRecord(value.common) ? value.common : value
  const image = isNamespacedSettings(value.image) ? value.image : undefined
  const video = isNamespacedSettings(value.video) ? value.video : undefined
  const audio = isNamespacedSettings(value.audio) ? value.audio : undefined
  const pdf = isNamespacedSettings(value.pdf) ? value.pdf : undefined
  const font = isNamespacedSettings(value.font) ? value.font : undefined

  return {
    common: migrateCommonSettings(common, defaults.common),
    image: {
      lastOptions: {
        ...defaults.image.lastOptions,
        ...asRecord(image?.lastOptions ?? value.image)
      }
    },
    video: {
      lastOptions: migrateVideoOptions(
        asRecord(video?.lastOptions ?? value.video) as LegacyVideoOptions,
        defaults.video.lastOptions
      )
    },
    audio: {
      lastOptions: {
        ...defaults.audio.lastOptions,
        ...(asRecord(audio?.lastOptions ?? value.audio) as Partial<AudioOptions>)
      }
    },
    pdf: {
      lastOptions: {
        ...defaults.pdf.lastOptions,
        ...(asRecord(pdf?.lastOptions ?? value.pdf) as Partial<PdfOptions>)
      }
    },
    font: {
      lastOptions: migrateFontOptions(
        asRecord(font?.lastOptions ?? value.font) as Partial<FontOptions>,
        defaults.font.lastOptions
      )
    }
  }
}

function migrateFontOptions(value: Partial<FontOptions>, fallback: FontOptions): FontOptions {
  const migrated = { ...fallback, ...value }
  if (
    value.subsetMode === undefined &&
    (value.subsetText?.trim() || value.subsetTextFile?.trim())
  ) {
    migrated.subsetMode = 'custom'
  }
  return migrated
}

function migrateCommonSettings(
  value: Record<string, unknown>,
  fallback: CommonSettings
): CommonSettings {
  return {
    concurrency: normalizeConcurrencySettings(value.concurrency, fallback.concurrency),
    closeBehavior: normalizeCloseBehavior(value.closeBehavior ?? fallback.closeBehavior),
    outputMode:
      value.outputMode === 'source' || value.outputMode === 'custom'
        ? value.outputMode
        : fallback.outputMode,
    outputDirectory:
      typeof value.outputDirectory === 'string' && isAbsolute(value.outputDirectory)
        ? value.outputDirectory
        : fallback.outputDirectory,
    outputSuffix:
      typeof value.outputSuffix === 'string' ? value.outputSuffix : fallback.outputSuffix,
    outputNameTemplate:
      typeof value.outputNameTemplate === 'string'
        ? value.outputNameTemplate
        : fallback.outputNameTemplate,
    outputConflictPolicy:
      value.outputConflictPolicy === 'rename' ||
      value.outputConflictPolicy === 'overwrite' ||
      value.outputConflictPolicy === 'skip'
        ? value.outputConflictPolicy
        : fallback.outputConflictPolicy
  }
}

function migrateVideoOptions(
  value: LegacyVideoOptions | undefined,
  fallback: VideoOptions
): VideoOptions {
  const legacyCopy = value?.codec === 'copy'
  const legacyFrameRate = value?.frameRate === '25'
  const frameRate: VideoOptions['frameRate'] =
    value?.frameRate === '25' ? 'custom' : (value?.frameRate ?? fallback.frameRate)
  return {
    ...fallback,
    ...value,
    format: legacyCopy ? 'source' : (value?.format ?? fallback.format),
    codec: value?.codec === 'copy' ? 'source' : (value?.codec ?? fallback.codec),
    frameRate,
    customFrameRate: legacyFrameRate ? 25 : (value?.customFrameRate ?? fallback.customFrameRate)
  }
}

function normalizeCloseBehavior(value: unknown): CommonSettings['closeBehavior'] {
  return value === 'ask' || value === 'minimizeToTray' || value === 'quit' ? value : 'ask'
}

function isNamespacedSettings(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && 'lastOptions' in value
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
