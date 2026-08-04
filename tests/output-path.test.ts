import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createAvailableOutputPath,
  getOutputExtension,
  renderOutputBaseName,
  resolveOutputPath,
  resolvePdfImageOutput
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
    expect(getOutputExtension('video', '/tmp/a.mov', undefined, 'avi')).toBe('.avi')
    expect(getOutputExtension('image', '/tmp/a.jpeg', 'original')).toBe('.jpg')
    expect(getOutputExtension('image', '/tmp/a.png', 'webp')).toBe('.webp')
    expect(getOutputExtension('image', '/tmp/a.png', 'avif')).toBe('.avif')
    expect(getOutputExtension('audio', '/tmp/a.wav', undefined, undefined, 'flac')).toBe('.flac')
    expect(getOutputExtension('pdf', '/tmp/a.pdf', undefined, undefined, undefined, 'webp')).toBe(
      '.webp'
    )
    expect(
      getOutputExtension('font', '/tmp/a.ttc', undefined, undefined, undefined, undefined, 'woff2')
    ).toBe('.woff2')
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
    expect(
      renderOutputBaseName('/input/document.pdf', '{name}-page-{page}-{index}-{instance}', {
        page: 2,
        index: 3,
        instance: 'Regular/Bold'
      })
    ).toBe('document-page-002-3-Regular_Bold')

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
    ).toEqual({
      path: join(directory, 'photo.jpg'),
      skipped: true,
      overwritesExisting: false
    })
    expect(
      resolveOutputPath({
        sourcePath: '/input/photo.jpg',
        outputDirectory: directory,
        extension: '.jpg',
        reservedPaths: new Set(),
        conflictPolicy: 'overwrite'
      })
    ).toEqual({
      path: join(directory, 'photo.jpg'),
      skipped: false,
      overwritesExisting: true
    })
  })

  it('groups PDF page images in a collision-safe source-named folder', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vvtools-output-'))
    directories.push(directory)
    const reservedPaths = new Set<string>()
    const first = resolvePdfImageOutput({
      sourcePath: '/input/document.pdf',
      outputDirectory: directory,
      imageFormat: 'png',
      pageNumbers: [1, 2],
      reservedPaths,
      outputSuffix: '_images',
      nameTemplate: '{name}-page-{page}'
    })
    const second = resolvePdfImageOutput({
      sourcePath: '/input/document.pdf',
      outputDirectory: directory,
      imageFormat: 'png',
      pageNumbers: [1],
      reservedPaths,
      outputSuffix: '_images',
      nameTemplate: '{name}-page-{page}'
    })

    expect(first.directory.path).toBe(join(directory, 'document_images'))
    expect(first.paths).toEqual([
      join(directory, 'document_images', 'document-page-001.png'),
      join(directory, 'document_images', 'document-page-002.png')
    ])
    expect(second.directory.path).toBe(join(directory, 'document_images_1'))

    mkdirSync(join(directory, 'archive'))
    const existingFolder = resolvePdfImageOutput({
      sourcePath: '/input/archive.pdf',
      outputDirectory: directory,
      imageFormat: 'png',
      pageNumbers: [1],
      reservedPaths: new Set(),
      conflictPolicy: 'overwrite'
    })
    expect(existingFolder.directory.path).toBe(join(directory, 'archive_1'))
  })
})
