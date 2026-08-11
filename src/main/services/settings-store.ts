import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, join } from 'path'
import type {
  AppSettings,
  AppSettingsPatch,
  AudioOptions,
  CommonSettings,
  FontOptions,
  PdfOptions,
  RenameSettings,
  SpriteOptions,
  VideoOptions
} from '../../shared/types'
import {
  DEFAULT_AUDIO_OPTIONS,
  DEFAULT_CONCURRENCY_SETTINGS,
  DEFAULT_FONT_OPTIONS,
  DEFAULT_IMAGE_OPTIONS,
  DEFAULT_PDF_OPTIONS,
  DEFAULT_RENAME_SETTINGS,
  DEFAULT_SPRITE_OPTIONS,
  DEFAULT_VIDEO_OPTIONS
} from '../../shared/constants'
import { normalizeConcurrencySettings } from './task-concurrency'

export class SettingsStore {
  private readonly path: string
  private settings: AppSettings
  private recoveryNotice: string | null = null

  constructor(userDataPath: string, downloadsPath: string) {
    this.path = join(userDataPath, 'settings.json')
    const defaults: AppSettings = {
      common: {
        concurrency: structuredClone(DEFAULT_CONCURRENCY_SETTINGS),
        closeBehavior: 'ask',
        outputMode: 'custom',
        outputDirectory: join(downloadsPath, 'VVTools'),
        outputNameTemplate: '{name}{suffix}',
        outputConflictPolicy: 'rename'
      },
      image: {
        outputSuffix: '_c',
        lastOptions: { ...DEFAULT_IMAGE_OPTIONS }
      },
      video: {
        outputSuffix: '_c',
        lastOptions: { ...DEFAULT_VIDEO_OPTIONS }
      },
      sprite: {
        outputSuffix: '_sprite',
        lastOptions: { ...DEFAULT_SPRITE_OPTIONS }
      },
      audio: {
        outputSuffix: '_c',
        lastOptions: { ...DEFAULT_AUDIO_OPTIONS }
      },
      pdf: {
        outputSuffix: '_c',
        lastOptions: { ...DEFAULT_PDF_OPTIONS }
      },
      font: {
        outputSuffix: '_c',
        lastOptions: { ...DEFAULT_FONT_OPTIONS }
      },
      rename: { ...DEFAULT_RENAME_SETTINGS }
    }
    this.settings = this.read(defaults)
  }

  get(): AppSettings {
    return structuredClone(this.settings)
  }

  getRecoveryNotice(): string | null {
    return this.recoveryNotice
  }

  update(input: AppSettingsPatch): AppSettings {
    const common = input.common
    const imageOptions = input.image?.lastOptions
    const nextSettings: AppSettings = {
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
        outputSuffix:
          typeof input.image?.outputSuffix === 'string'
            ? input.image.outputSuffix
            : this.settings.image.outputSuffix,
        lastOptions: imageOptions
          ? {
              ...this.settings.image.lastOptions,
              ...imageOptions,
              quality: Math.min(100, Math.max(1, imageOptions.quality))
            }
          : this.settings.image.lastOptions
      },
      video: {
        outputSuffix:
          typeof input.video?.outputSuffix === 'string'
            ? input.video.outputSuffix
            : this.settings.video.outputSuffix,
        lastOptions: input.video?.lastOptions
          ? { ...this.settings.video.lastOptions, ...input.video.lastOptions }
          : this.settings.video.lastOptions
      },
      sprite: {
        outputSuffix:
          typeof input.sprite?.outputSuffix === 'string'
            ? input.sprite.outputSuffix
            : this.settings.sprite.outputSuffix,
        lastOptions: input.sprite?.lastOptions
          ? { ...this.settings.sprite.lastOptions, ...input.sprite.lastOptions }
          : this.settings.sprite.lastOptions
      },
      audio: {
        outputSuffix:
          typeof input.audio?.outputSuffix === 'string'
            ? input.audio.outputSuffix
            : this.settings.audio.outputSuffix,
        lastOptions: input.audio?.lastOptions
          ? { ...this.settings.audio.lastOptions, ...input.audio.lastOptions }
          : this.settings.audio.lastOptions
      },
      pdf: {
        outputSuffix:
          typeof input.pdf?.outputSuffix === 'string'
            ? input.pdf.outputSuffix
            : this.settings.pdf.outputSuffix,
        lastOptions: input.pdf?.lastOptions
          ? { ...this.settings.pdf.lastOptions, ...input.pdf.lastOptions }
          : this.settings.pdf.lastOptions
      },
      font: {
        outputSuffix:
          typeof input.font?.outputSuffix === 'string'
            ? input.font.outputSuffix
            : this.settings.font.outputSuffix,
        lastOptions: input.font?.lastOptions
          ? { ...this.settings.font.lastOptions, ...input.font.lastOptions }
          : this.settings.font.lastOptions
      },
      rename: normalizeRenameSettings(input.rename, this.settings.rename)
    }
    this.persist(nextSettings)
    this.settings = nextSettings
    return this.get()
  }

  private read(defaults: AppSettings): AppSettings {
    if (!existsSync(this.path)) return defaults
    let content: string
    try {
      content = readFileSync(this.path, 'utf8')
    } catch (error) {
      console.error('读取设置文件失败，将使用默认设置', error)
      this.recoveryNotice = '无法读取设置文件，已使用默认设置；原设置文件未改动。'
      return defaults
    }
    try {
      const saved = JSON.parse(content) as unknown
      if (!isRecord(saved)) throw new Error('设置文件的根节点必须是对象')
      return migrateSettings(saved, defaults)
    } catch (error) {
      const timestamp = new Date().toISOString().replace(/[:.]/gu, '-')
      const backupPath = `${this.path}.corrupt-${timestamp}.json`
      try {
        renameSync(this.path, backupPath)
        this.recoveryNotice = `设置文件损坏，已恢复默认设置；原文件已备份为 ${backupPath}`
      } catch (backupError) {
        console.error('备份损坏的设置文件失败', backupError)
        this.recoveryNotice = '设置文件损坏，已恢复默认设置；原文件备份失败，请检查文件权限。'
      }
      console.error('解析设置文件失败，将使用默认设置', error)
      return defaults
    }
  }

  private persist(settings: AppSettings): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temporaryPath = `${this.path}.tmp`
    try {
      writeFileSync(temporaryPath, JSON.stringify(settings, null, 2), 'utf8')
      renameSync(temporaryPath, this.path)
    } catch (error) {
      rmSync(temporaryPath, { force: true })
      throw error
    }
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
  const sprite = isNamespacedSettings(value.sprite) ? value.sprite : undefined
  const audio = isNamespacedSettings(value.audio) ? value.audio : undefined
  const pdf = isNamespacedSettings(value.pdf) ? value.pdf : undefined
  const font = isNamespacedSettings(value.font) ? value.font : undefined
  const legacyOutputSuffix =
    typeof common.outputSuffix === 'string' ? common.outputSuffix : undefined

  return {
    common: migrateCommonSettings(common, defaults.common),
    image: {
      outputSuffix: migrateOutputSuffix(image, defaults.image.outputSuffix, legacyOutputSuffix),
      lastOptions: {
        ...defaults.image.lastOptions,
        ...asRecord(image?.lastOptions ?? value.image)
      }
    },
    video: {
      outputSuffix: migrateOutputSuffix(video, defaults.video.outputSuffix, legacyOutputSuffix),
      lastOptions: migrateVideoOptions(
        asRecord(video?.lastOptions ?? value.video) as LegacyVideoOptions,
        defaults.video.lastOptions
      )
    },
    sprite: {
      outputSuffix: migrateOutputSuffix(sprite, defaults.sprite.outputSuffix, legacyOutputSuffix),
      lastOptions: {
        ...defaults.sprite.lastOptions,
        ...(asRecord(sprite?.lastOptions ?? value.sprite) as Partial<SpriteOptions>)
      }
    },
    audio: {
      outputSuffix: migrateOutputSuffix(audio, defaults.audio.outputSuffix, legacyOutputSuffix),
      lastOptions: {
        ...defaults.audio.lastOptions,
        ...(asRecord(audio?.lastOptions ?? value.audio) as Partial<AudioOptions>)
      }
    },
    pdf: {
      outputSuffix: migrateOutputSuffix(pdf, defaults.pdf.outputSuffix, legacyOutputSuffix),
      lastOptions: {
        ...defaults.pdf.lastOptions,
        ...(asRecord(pdf?.lastOptions ?? value.pdf) as Partial<PdfOptions>)
      }
    },
    font: {
      outputSuffix: migrateOutputSuffix(font, defaults.font.outputSuffix, legacyOutputSuffix),
      lastOptions: migrateFontOptions(
        asRecord(font?.lastOptions ?? value.font) as Partial<FontOptions>,
        defaults.font.lastOptions
      )
    },
    rename: normalizeRenameSettings(asRecord(value.rename), defaults.rename)
  }
}

export function normalizeRenameSettings(
  value: Partial<RenameSettings> | undefined,
  fallback: RenameSettings
): RenameSettings {
  const stringValue = (input: unknown, current: string, maxLength = 200): string =>
    typeof input === 'string' ? input.slice(0, maxLength) : current
  const integerValue = (
    input: unknown,
    current: number,
    minimum: number,
    maximum: number
  ): number =>
    typeof input === 'number' && Number.isFinite(input)
      ? Math.min(maximum, Math.max(minimum, Math.trunc(input)))
      : current
  return {
    mode: value?.mode === 'sequence' || value?.mode === 'custom' ? value.mode : fallback.mode,
    baseMode:
      value?.baseMode === 'original' || value?.baseMode === 'custom'
        ? value.baseMode
        : fallback.baseMode,
    customName: stringValue(value?.customName, fallback.customName),
    prefix: stringValue(value?.prefix, fallback.prefix),
    suffix: stringValue(value?.suffix, fallback.suffix),
    findText: stringValue(value?.findText, fallback.findText),
    replaceText: stringValue(value?.replaceText, fallback.replaceText),
    caseMode:
      value?.caseMode === 'unchanged' ||
      value?.caseMode === 'lower' ||
      value?.caseMode === 'upper' ||
      value?.caseMode === 'title'
        ? value.caseMode
        : fallback.caseMode,
    sequenceEnabled:
      typeof value?.sequenceEnabled === 'boolean'
        ? value.sequenceEnabled
        : fallback.sequenceEnabled,
    sequencePosition:
      value?.sequencePosition === 'prefix' || value?.sequencePosition === 'suffix'
        ? value.sequencePosition
        : fallback.sequencePosition,
    sequenceStart: integerValue(value?.sequenceStart, fallback.sequenceStart, 0, 999_999),
    sequenceStep: integerValue(value?.sequenceStep, fallback.sequenceStep, 1, 9_999),
    sequencePadding: integerValue(value?.sequencePadding, fallback.sequencePadding, 1, 8),
    separator: stringValue(value?.separator, fallback.separator, 10),
    dateSource:
      value?.dateSource === 'none' ||
      value?.dateSource === 'createdAt' ||
      value?.dateSource === 'modifiedAt'
        ? value.dateSource
        : fallback.dateSource,
    datePosition:
      value?.datePosition === 'prefix' || value?.datePosition === 'suffix'
        ? value.datePosition
        : fallback.datePosition,
    dateFormat:
      value?.dateFormat === 'YYYYMMDD' ||
      value?.dateFormat === 'YYYY-MM-DD' ||
      value?.dateFormat === 'YYYYMMDD-HHmmss'
        ? value.dateFormat
        : fallback.dateFormat,
    sortField:
      value?.sortField === 'name' ||
      value?.sortField === 'createdAt' ||
      value?.sortField === 'modifiedAt' ||
      value?.sortField === 'size' ||
      value?.sortField === 'extension'
        ? value.sortField
        : fallback.sortField,
    sortDirection:
      value?.sortDirection === 'asc' || value?.sortDirection === 'desc'
        ? value.sortDirection
        : fallback.sortDirection
  }
}

function migrateOutputSuffix(
  settings: Record<string, unknown> | undefined,
  fallback: string,
  legacy: string | undefined
): string {
  if (typeof settings?.outputSuffix === 'string') return settings.outputSuffix
  return legacy ?? fallback
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
  const concurrency = asRecord(value.concurrency)
  const migratedConcurrency =
    (concurrency.mode === 'auto' || concurrency.mode === 'custom') && isRecord(concurrency.custom)
      ? {
          ...concurrency,
          custom: { ...fallback.concurrency.custom, ...concurrency.custom }
        }
      : value.concurrency
  return {
    concurrency: normalizeConcurrencySettings(migratedConcurrency, fallback.concurrency),
    closeBehavior: normalizeCloseBehavior(value.closeBehavior ?? fallback.closeBehavior),
    outputMode:
      value.outputMode === 'source' || value.outputMode === 'custom'
        ? value.outputMode
        : fallback.outputMode,
    outputDirectory:
      typeof value.outputDirectory === 'string' && isAbsolute(value.outputDirectory)
        ? value.outputDirectory
        : fallback.outputDirectory,
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
