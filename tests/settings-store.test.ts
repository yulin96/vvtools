import { mkdtempSync, rmSync, writeFileSync } from 'fs'
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
        outputSuffix: '',
        outputNameTemplate: '{name}{suffix}',
        outputConflictPolicy: 'rename',
        completionNotification: true,
        completionSound: false,
        completionAction: 'none',
        closeBehavior: 'ask',
        concurrency: {
          mode: 'auto',
          custom: { image: 8, video: 1, audio: 2 }
        }
      }
    })
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
        outputSuffix: '-compressed',
        outputNameTemplate: '{name}_{preset}_{date}',
        outputConflictPolicy: 'skip',
        completionNotification: false,
        completionSound: true,
        completionAction: 'openOutput'
      },
      image: {
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
        lastOptions: {
          format: 'flac',
          bitrateKbps: 256,
          channels: 'stereo',
          normalizeLoudness: true
        }
      }
    })

    expect(new SettingsStore(root, downloads).get()).toMatchObject({
      common: {
        outputMode: 'source',
        closeBehavior: 'minimizeToTray',
        outputNameTemplate: '{name}_{preset}_{date}',
        outputConflictPolicy: 'skip',
        completionNotification: false,
        completionSound: true,
        completionAction: 'openOutput',
        outputSuffix: '-compressed'
      },
      image: {
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
        lastOptions: {
          format: 'flac',
          bitrateKbps: 256,
          channels: 'stereo',
          normalizeLoudness: true
        }
      }
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

  it('resolves automatic concurrency by media type', () => {
    expect(resolveTaskConcurrency(DEFAULT_CONCURRENCY_SETTINGS, 10)).toEqual({
      image: 8,
      video: 1,
      audio: 2,
      pdf: 1,
      font: 1
    })
    expect(resolveTaskConcurrency(DEFAULT_CONCURRENCY_SETTINGS, 2)).toEqual({
      image: 2,
      video: 1,
      audio: 1,
      pdf: 1,
      font: 1
    })
  })
})
