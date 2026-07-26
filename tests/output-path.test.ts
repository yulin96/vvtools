import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createAvailableOutputPath,
  getOutputExtension,
  renderOutputBaseName,
  resolveOutputPath
} from '../src/main/media/output-path'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('output paths', () => {
  it('uses the requested output format', () => {
    expect(getOutputExtension('video', '/tmp/a.mov')).toBe('.mp4')
    expect(getOutputExtension('video', '/tmp/a.mov', undefined, 'source')).toBe('.mov')
    expect(getOutputExtension('video', '/tmp/a.mov', undefined, 'mkv')).toBe('.mkv')
    expect(getOutputExtension('image', '/tmp/a.jpeg', 'original')).toBe('.jpg')
    expect(getOutputExtension('image', '/tmp/a.png', 'webp')).toBe('.webp')
    expect(getOutputExtension('audio', '/tmp/a.wav', undefined, undefined, 'flac')).toBe('.flac')
  })

  it('never overwrites existing or reserved outputs', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vvtools-output-'))
    directories.push(directory)
    writeFileSync(join(directory, 'clip.mp4'), '')
    const reserved = new Set<string>()
    const first = createAvailableOutputPath('/input/clip.mov', directory, '.mp4', reserved)
    const second = createAvailableOutputPath('/input/clip.mov', directory, '.mp4', reserved)
    expect(first).toBe(join(directory, 'clip_1.mp4'))
    expect(second).toBe(join(directory, 'clip_2.mp4'))
    expect(
      createAvailableOutputPath('/input/photo.jpg', directory, '.webp', reserved, '_optimized')
    ).toBe(join(directory, 'photo_optimized.webp'))
  })

  it('renders supported naming variables and can skip conflicts', () => {
    expect(
      renderOutputBaseName('/input/photo.jpg', '{name}{suffix}', {
        outputSuffix: '_compressed'
      })
    ).toBe('photo_compressed')
    expect(
      renderOutputBaseName('/input/photo.jpg', '{name}_{width}x{height}_{preset}_{date}', {
        width: 1920,
        height: 1080,
        presetName: '网站/图片',
        date: new Date(2026, 6, 25)
      })
    ).toBe('photo_1920x1080_网站_图片_20260725')

    const directory = mkdtempSync(join(tmpdir(), 'vvtools-output-'))
    directories.push(directory)
    writeFileSync(join(directory, 'photo.jpg'), 'existing')
    expect(
      resolveOutputPath({
        sourcePath: '/input/photo.jpg',
        outputDirectory: directory,
        extension: '.jpg',
        reservedPaths: new Set(),
        conflictPolicy: 'skip'
      })
    ).toEqual({ path: join(directory, 'photo.jpg'), skipped: true })
  })
})
