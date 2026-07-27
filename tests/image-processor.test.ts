import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp, { type Metadata } from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import type { MediaTask } from '../src/shared/types'
import { processImage } from '../src/main/media/image-processor'
import { DEFAULT_IMAGE_OPTIONS } from '../src/shared/constants'

const directories: string[] = []

async function readMetadata(path: string): Promise<Metadata> {
  const image = sharp(path)
  try {
    return await image.metadata()
  } finally {
    image.destroy()
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('image processor', () => {
  it('converts an image to WebP without loading the file into renderer memory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-image-'))
    directories.push(root)
    const sourcePath = join(root, 'source.png')
    const outputPath = join(root, 'source_processed.webp')
    await sharp({ create: { width: 40, height: 30, channels: 4, background: '#76bfd1' } })
      .png()
      .toFile(sourcePath)
    const task: MediaTask = {
      id: 'image',
      kind: 'image',
      sourcePath,
      outputPath,
      status: 'processing',
      progress: null,
      options: {
        ...DEFAULT_IMAGE_OPTIONS,
        format: 'webp',
        quality: 75,
        resizeMode: 'percentage',
        percentage: 50
      },
      sourceSize: 1,
      createdAt: new Date(0).toISOString()
    }
    expect(await processImage(task, new AbortController().signal)).toBeGreaterThan(0)
    expect(await readMetadata(outputPath)).toMatchObject({
      format: 'webp',
      width: 20,
      height: 15
    })
  })

  it('converts an image to AVIF', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-image-'))
    directories.push(root)
    const sourcePath = join(root, 'source.png')
    const outputPath = join(root, 'source_processed.avif')
    await sharp({ create: { width: 40, height: 30, channels: 4, background: '#76bfd1' } })
      .png()
      .toFile(sourcePath)
    const task: MediaTask = {
      id: 'image-avif',
      kind: 'image',
      sourcePath,
      outputPath,
      status: 'processing',
      progress: null,
      options: {
        ...DEFAULT_IMAGE_OPTIONS,
        format: 'avif',
        quality: 75
      },
      sourceSize: 1,
      createdAt: new Date(0).toISOString()
    }

    expect(await processImage(task, new AbortController().signal)).toBeGreaterThan(0)
    expect(await readMetadata(outputPath)).toMatchObject({
      format: 'heif',
      compression: 'av1',
      width: 40,
      height: 30
    })
  })

  it('keeps target-size output under the requested limit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-image-'))
    directories.push(root)
    const sourcePath = join(root, 'source.png')
    const outputPath = join(root, 'source_processed.jpg')
    await sharp({ create: { width: 400, height: 300, channels: 3, background: '#76bfd1' } })
      .png()
      .toFile(sourcePath)
    const task: MediaTask = {
      id: 'target-size',
      kind: 'image',
      sourcePath,
      outputPath,
      status: 'processing',
      progress: 0,
      options: {
        ...DEFAULT_IMAGE_OPTIONS,
        format: 'jpeg',
        compressionMode: 'targetSize',
        targetSizeKb: 10
      },
      sourceSize: 1,
      createdAt: new Date(0).toISOString()
    }
    expect(await processImage(task, new AbortController().signal)).toBeLessThanOrEqual(10 * 1024)
  })

  it.each([
    { mode: 'strip' as const, keepsExif: false, keepsIcc: false },
    { mode: 'colorProfile' as const, keepsExif: false, keepsIcc: true },
    { mode: 'all' as const, keepsExif: true, keepsIcc: true }
  ])('applies the $mode metadata policy', async ({ mode, keepsExif, keepsIcc }) => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-image-metadata-'))
    directories.push(root)
    const sourcePath = join(root, 'source.jpg')
    const outputPath = join(root, `${mode}.jpg`)
    await sharp({ create: { width: 24, height: 16, channels: 3, background: '#76bfd1' } })
      .withExif({ IFD0: { Make: 'VVTools Camera' } })
      .withIccProfile('p3')
      .jpeg()
      .toFile(sourcePath)
    const task: MediaTask = {
      id: mode,
      kind: 'image',
      sourcePath,
      outputPath,
      status: 'processing',
      progress: 0,
      options: { ...DEFAULT_IMAGE_OPTIONS, format: 'jpeg', metadataMode: mode },
      sourceSize: 1,
      createdAt: new Date(0).toISOString()
    }

    await processImage(task, new AbortController().signal)
    const metadata = await readMetadata(outputPath)
    expect(Boolean(metadata.exif)).toBe(keepsExif)
    expect(Boolean(metadata.icc)).toBe(keepsIcc)
  })
})
