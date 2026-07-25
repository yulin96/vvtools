import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsStore } from '../src/main/services/settings-store'
import { DEFAULT_VIDEO_OPTIONS } from '../src/shared/constants'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('SettingsStore', () => {
  it('provides and persists editable video presets', () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-settings-'))
    directories.push(root)
    const store = new SettingsStore(root, join(root, 'downloads'))

    expect(store.get().outputDirectory).toBe(join(root, 'downloads', 'VVTools'))
    expect(store.get()).toMatchObject({
      outputMode: 'custom',
      outputSuffix: '',
      historyRetentionDays: 30
    })
    expect(store.get().image).toMatchObject({
      compressionMode: 'quality',
      resizeMode: 'source',
      preserveStructure: true
    })

    expect(store.get().videoPresets.map((preset) => preset.name)).toEqual([
      '保持原始',
      '低质量',
      '中质量',
      '高质量'
    ])

    const presets = store.get().videoPresets
    presets[0] = { ...presets[0], name: '快速封装' }
    store.update({ videoPresets: presets })

    const saved = JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8'))
    expect(saved.videoPresets[0].name).toBe('快速封装')
    expect(new SettingsStore(root, join(root, 'downloads')).get().videoPresets[0].name).toBe(
      '快速封装'
    )
  })

  it('persists edited processing settings', () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-settings-'))
    directories.push(root)
    const downloads = join(root, 'downloads')
    const store = new SettingsStore(root, downloads)

    store.update({
      outputMode: 'source',
      historyRetentionDays: 90,
      outputSuffix: '-compressed',
      image: {
        ...store.get().image,
        compressionMode: 'targetSize',
        targetSizeKb: 512,
        resizeMode: 'percentage',
        percentage: 75,
        format: 'webp',
        preserveStructure: false,
        allowEnlargement: true
      }
    })

    expect(new SettingsStore(root, downloads).get()).toMatchObject({
      outputMode: 'source',
      historyRetentionDays: 90,
      outputSuffix: '-compressed',
      image: {
        compressionMode: 'targetSize',
        targetSizeKb: 512,
        resizeMode: 'percentage',
        percentage: 75,
        format: 'webp',
        preserveStructure: false,
        allowEnlargement: true
      }
    })
  })

  it('migrates the former copy-stream preset to keep-original semantics', () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-settings-'))
    directories.push(root)
    writeFileSync(
      join(root, 'settings.json'),
      JSON.stringify({
        videoOutputMode: 'source',
        video: { ...DEFAULT_VIDEO_OPTIONS, codec: 'copy' },
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
    expect(settings.video).toMatchObject({ codec: 'source', format: 'source' })
    expect(settings.videoPresets[0]).toMatchObject({
      id: 'keep-original',
      name: '保持原始',
      options: { codec: 'source', format: 'source' }
    })
  })
})
