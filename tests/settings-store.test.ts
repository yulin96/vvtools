import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsStore } from '../src/main/services/settings-store'
import { resolveTaskConcurrency } from '../src/main/services/task-concurrency'
import {
  DEFAULT_CONCURRENCY_SETTINGS,
  DEFAULT_IMAGE_OPTIONS,
  DEFAULT_VIDEO_OPTIONS
} from '../src/shared/constants'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('SettingsStore', () => {
  it('provides processing defaults without editable preset configuration', () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-settings-'))
    directories.push(root)
    const store = new SettingsStore(root, join(root, 'downloads'))

    expect(store.get().common.outputDirectory).toBe(join(root, 'downloads', 'VVTools'))
    expect(store.get()).toMatchObject({
      common: {
        outputMode: 'custom',
        outputNameTemplate: '{name}{suffix}',
        outputConflictPolicy: 'rename',
        closeBehavior: 'ask',
        concurrency: {
          mode: 'auto',
          custom: { image: 16, video: 1, audio: 2 }
        }
      }
    })
    expect({
      image: store.get().image.outputSuffix,
      video: store.get().video.outputSuffix,
      audio: store.get().audio.outputSuffix,
      pdf: store.get().pdf.outputSuffix,
      font: store.get().font.outputSuffix
    }).toEqual({ image: '_c', video: '_c', audio: '_c', pdf: '_c', font: '_c' })
    expect(store.get().common).not.toHaveProperty('outputSuffix')
    expect(store.get().image.lastOptions).toMatchObject({
      compressionMode: 'quality',
      resizeMode: 'source',
      preserveStructure: true,
      metadataMode: 'colorProfile'
    })
    expect(store.get().audio.lastOptions).toEqual({
      format: 'mp3',
      bitrateKbps: 192,
      channels: 'source',
      normalizeLoudness: false
    })
    expect(store.get().pdf.lastOptions).toMatchObject({
      operation: 'toImage',
      compressionMode: 'lossless',
      compressionDpi: 144,
      compressionQuality: 80
    })

    expect(store.get().video.lastOptions.encoderMode).toBe('auto')
    expect(store.get().video.lastOptions.customFrameRate).toBe(30)
    expect(store.get().video.lastOptions.customResolutionHeight).toBe(1080)

    expect(store.get().video).not.toHaveProperty('presets')
    expect(store.get().image).not.toHaveProperty('presets')
    expect(store.get().rename).toMatchObject({
      mode: 'sequence',
      baseMode: 'original',
      sequenceEnabled: true,
      sequenceStart: 1,
      sequencePadding: 3,
      sortField: 'name',
      sortDirection: 'asc'
    })
  })

  it('persists edited processing settings', () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-settings-'))
    directories.push(root)
    const downloads = join(root, 'downloads')
    const store = new SettingsStore(root, downloads)
    const current = store.get()

    store.update({
      common: {
        outputMode: 'source',
        closeBehavior: 'minimizeToTray',
        outputNameTemplate: '{name}_{preset}_{date}',
        outputConflictPolicy: 'skip'
      },
      image: {
        outputSuffix: '-image',
        lastOptions: {
          ...current.image.lastOptions,
          compressionMode: 'targetSize',
          targetSizeKb: 512,
          resizeMode: 'percentage',
          percentage: 75,
          format: 'webp',
          preserveStructure: false,
          allowEnlargement: true,
          metadataMode: 'all'
        }
      },
      audio: {
        outputSuffix: '-audio',
        lastOptions: {
          format: 'flac',
          bitrateKbps: 256,
          channels: 'stereo',
          normalizeLoudness: true
        }
      },
      rename: {
        mode: 'custom',
        baseMode: 'custom',
        customName: '产品图',
        prefix: '项目_',
        sequenceStart: 10,
        sortField: 'modifiedAt',
        sortDirection: 'desc'
      }
    })

    expect(new SettingsStore(root, downloads).get()).toMatchObject({
      common: {
        outputMode: 'source',
        closeBehavior: 'minimizeToTray',
        outputNameTemplate: '{name}_{preset}_{date}',
        outputConflictPolicy: 'skip'
      },
      image: {
        outputSuffix: '-image',
        lastOptions: {
          compressionMode: 'targetSize',
          targetSizeKb: 512,
          resizeMode: 'percentage',
          percentage: 75,
          format: 'webp',
          preserveStructure: false,
          allowEnlargement: true,
          metadataMode: 'all'
        }
      },
      audio: {
        outputSuffix: '-audio',
        lastOptions: {
          format: 'flac',
          bitrateKbps: 256,
          channels: 'stereo',
          normalizeLoudness: true
        }
      },
      rename: {
        mode: 'custom',
        baseMode: 'custom',
        customName: '产品图',
        prefix: '项目_',
        sequenceStart: 10,
        sortField: 'modifiedAt',
        sortDirection: 'desc'
      }
    })
  })

  it('migrates the former global output suffix to every processing workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-settings-'))
    directories.push(root)
    writeFileSync(
      join(root, 'settings.json'),
      JSON.stringify({
        common: {
          outputSuffix: '-legacy'
        }
      })
    )

    const settings = new SettingsStore(root, join(root, 'downloads')).get()

    expect(settings.common).not.toHaveProperty('outputSuffix')
    expect({
      image: settings.image.outputSuffix,
      video: settings.video.outputSuffix,
      audio: settings.audio.outputSuffix,
      pdf: settings.pdf.outputSuffix,
      font: settings.font.outputSuffix
    }).toEqual({
      image: '-legacy',
      video: '-legacy',
      audio: '-legacy',
      pdf: '-legacy',
      font: '-legacy'
    })
  })

  it('migrates former copy-stream options and discards editable presets', () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-settings-'))
    directories.push(root)
    writeFileSync(
      join(root, 'settings.json'),
      JSON.stringify({
        videoOutputMode: 'source',
        video: { ...DEFAULT_VIDEO_OPTIONS, codec: 'copy', frameRate: '25' },
        videoPresets: [
          {
            id: 'copy-stream',
            name: '复制流',
            options: { ...DEFAULT_VIDEO_OPTIONS, codec: 'copy' }
          }
        ]
      })
    )

    const settings = new SettingsStore(root, join(root, 'downloads')).get()
    expect(settings).not.toHaveProperty('videoOutputMode')
    expect(settings.video.lastOptions).toMatchObject({
      codec: 'source',
      format: 'source',
      encoderMode: 'auto',
      frameRate: 'custom',
      customFrameRate: 25
    })
    expect(settings.video).not.toHaveProperty('presets')
  })

  it('migrates former global concurrency and discards editable image presets', () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-settings-'))
    directories.push(root)
    writeFileSync(
      join(root, 'settings.json'),
      JSON.stringify({
        concurrency: 3,
        imagePresets: [
          {
            id: 'image-original',
            name: '原图整理',
            options: DEFAULT_IMAGE_OPTIONS
          },
          {
            id: 'image-thumbnail',
            name: '缩略图',
            options: { ...DEFAULT_IMAGE_OPTIONS, resizeMode: 'width', width: 600 }
          },
          {
            id: 'custom-delivery',
            name: '交付',
            options: { ...DEFAULT_IMAGE_OPTIONS, format: 'png' }
          }
        ]
      })
    )

    const settings = new SettingsStore(root, join(root, 'downloads')).get()
    expect(settings.common.concurrency).toEqual({
      mode: 'custom',
      custom: { image: 3, video: 2, audio: 3, pdf: 2, font: 1 }
    })
    expect(settings.image).not.toHaveProperty('presets')
  })

  it('keeps existing font subset text as a custom character source', () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-settings-'))
    directories.push(root)
    writeFileSync(
      join(root, 'settings.json'),
      JSON.stringify({
        font: {
          lastOptions: {
            operation: 'subset',
            outputFormat: 'woff2',
            variableInstanceMode: 'named',
            subsetText: '原有字符',
            subsetTextFile: ''
          }
        }
      })
    )

    expect(new SettingsStore(root, join(root, 'downloads')).get().font.lastOptions).toMatchObject({
      subsetMode: 'custom',
      subsetText: '原有字符',
      subsetIncludeLatin: true,
      subsetChineseLevel: '3500'
    })
  })

  it('backs up a corrupt settings file and reports recovery', () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-settings-'))
    directories.push(root)
    writeFileSync(join(root, 'settings.json'), '{invalid json')

    const store = new SettingsStore(root, join(root, 'downloads'))

    expect(store.getRecoveryNotice()).toContain('设置文件损坏，已恢复默认设置')
    expect(existsSync(join(root, 'settings.json'))).toBe(false)
    expect(
      readdirSync(root).filter((name) => name.startsWith('settings.json.corrupt-'))
    ).toHaveLength(1)
  })

  it('keeps the previous in-memory settings when persistence fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-settings-'))
    directories.push(root)
    const store = new SettingsStore(root, join(root, 'downloads'))
    const previous = store.get()
    mkdirSync(join(root, 'settings.json'))

    expect(() => store.update({ image: { outputSuffix: '-new' } })).toThrow()
    expect(store.get()).toEqual(previous)
    expect(existsSync(join(root, 'settings.json.tmp'))).toBe(false)
  })

  it('resolves automatic concurrency by media type', () => {
    expect(resolveTaskConcurrency(DEFAULT_CONCURRENCY_SETTINGS, 10)).toEqual({
      image: 10,
      video: 1,
      audio: 2,
      pdf: 1,
      font: 3
    })
    expect(resolveTaskConcurrency(DEFAULT_CONCURRENCY_SETTINGS, 2)).toEqual({
      image: 2,
      video: 1,
      audio: 1,
      pdf: 1,
      font: 1
    })
    expect(resolveTaskConcurrency(DEFAULT_CONCURRENCY_SETTINGS, 16)).toEqual({
      image: 16,
      video: 1,
      audio: 2,
      pdf: 1,
      font: 4
    })
  })
})
