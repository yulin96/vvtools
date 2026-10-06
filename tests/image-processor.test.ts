import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'fs'
import { readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp, { type Metadata } from 'sharp'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { ImageOptions, MediaTask } from '../src/shared/types'
import { imageProcesses, processImage } from '../src/main/media/image-processor'
import { MediaProcessError, TaskCancelledError, TaskSkippedError } from '../src/main/media/errors'
import { DEFAULT_IMAGE_OPTIONS } from '../src/shared/constants'

const directories: string[] = []

async function readMetadata(path: string): Promise<Metadata> {
  const image = sharp(await readFile(path))
  try {
    return await image.metadata()
  } finally {
    image.destroy()
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
afterAll(() => imageProcesses.shutdown())

async function noisyFixture(metadata = false): Promise<{ root: string; task: MediaTask }> {
  const root = mkdtempSync(join(tmpdir(), 'vvtools-image-search-'))
  directories.push(root)
  const sourcePath = join(root, 'source.png')
  const channels = metadata ? 4 : 3
  const pixels = Buffer.alloc(160 * 120 * channels)
  let seed = 12345
  for (let index = 0; index < pixels.length; index += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    pixels[index] = seed >>> 24
  }
  let image = sharp(pixels, { raw: { width: 160, height: 120, channels } })
  if (metadata)
    image = image
      .withMetadata({ orientation: 6 })
      .withIccProfile('p3')
      .withExif({ IFD0: { Make: 'VVTools Camera' } })
  await image.png({ compressionLevel: 0 }).toFile(sourcePath)
  return {
    root,
    task: {
      id: 'search',
      kind: 'image',
      sourcePath,
      outputPath: join(root, 'output.jpg'),
      status: 'processing',
      progress: 0,
      sourceSize: statSync(sourcePath).size,
      createdAt: '',
      processingThreads: 2,
      options: {
        ...DEFAULT_IMAGE_OPTIONS,
        format: 'jpeg',
        compressionMode: 'targetSize',
        targetSizeKb: 1,
        resizeMode: 'width',
        width: 80
      }
    }
  }
}

describe('image processor', () => {
  it('searches the best JPEG quality under the limit from one prepared input and cleans up candidates', async () => {
    const { root, task } = await noisyFixture()
    let expected: Buffer | undefined
    let bestQuality = 0
    for (let quality = 1; quality <= 100; quality += 1) {
      const candidate = await sharp(task.sourcePath)
        .rotate()
        .resize({ width: 80, withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer()
      if (candidate.length <= 1024) {
        bestQuality = quality
        expected = candidate
      }
    }
    expect(bestQuality).toBeGreaterThan(1)
    expect(bestQuality).toBeLessThan(100)
    let removedSource = false
    const progress: number[] = []
    const candidateCounts: number[] = []
    const outputSize = await processImage(task, new AbortController().signal, (value) => {
      progress.push(value)
      if (value <= 5 || value >= 100) return
      const directory = readdirSync(root).find((name) => name.startsWith('.vvtools-image-'))!
      const files = readdirSync(join(root, directory))
      candidateCounts.push(files.filter((name) => name.includes('.tmp-')).length)
      if (!removedSource) {
        rmSync(task.sourcePath)
        removedSource = true
      }
    })
    expect(removedSource).toBe(true)
    expect(outputSize).toBe(expected!.length)
    expect(await readFile(task.outputPath)).toEqual(expected)
    expect(progress[0]).toBe(5)
    expect(progress.at(-1)).toBe(100)
    expect(candidateCounts.length).toBeGreaterThan(1)
    expect(candidateCounts.every((count) => count <= 2)).toBe(true)
    expect(readdirSync(root)).toEqual(['output.jpg'])
  })

  it.each(['jpeg', 'png', 'webp', 'avif'] as const)(
    'preserves %s pixels, orientation and metadata through target-size preprocessing',
    async (format) => {
      for (const mode of ['strip', 'colorProfile', 'all'] as const) {
        const { root, task } = await noisyFixture(true)
        task.outputPath = join(root, `output.${format}`)
        task.options = {
          ...(task.options as ImageOptions),
          format,
          targetSizeKb: 128,
          metadataMode: mode
        }
        let reference = sharp(task.sourcePath)
          .rotate()
          .resize({ width: 80, withoutEnlargement: true })
        if (mode === 'all') reference = reference.keepMetadata()
        if (mode === 'colorProfile') reference = reference.keepIccProfile()
        if (format === 'jpeg') reference = reference.jpeg({ quality: 100, mozjpeg: true })
        else if (format === 'png')
          reference = reference.png({ compressionLevel: 9, palette: true, quality: 100 })
        else reference = reference[format]({ quality: 100, effort: 4 })
        const expected = await reference.toBuffer()
        const progress = vi.fn()
        await processImage(task, new AbortController().signal, progress)
        const actual = await readMetadata(task.outputPath)
        const original = await sharp(expected).metadata()
        expect(actual).toMatchObject({ width: 80, height: 107, hasAlpha: format !== 'jpeg' })
        expect(actual.exif).toEqual(original.exif)
        expect(actual.icc).toEqual(original.icc)
        expect(await sharp(task.outputPath).raw().toBuffer()).toEqual(
          await sharp(expected).raw().toBuffer()
        )
        expect(progress.mock.calls.map(([value]) => value)).toEqual([5, 11, 100])
        expect(readdirSync(root)).toEqual([`output.${format}`, 'source.png'])
      }
    }
  )

  it('kills a conversion during target-size search, cleans its directory and accepts another task', async () => {
    const { root, task } = await noisyFixture()
    const original = await readFile(task.sourcePath)
    const controller = new AbortController()
    const progress = vi.fn((value: number) => {
      if (value > 5) controller.abort()
    })
    await expect(processImage(task, controller.signal, progress)).rejects.toBeInstanceOf(
      TaskCancelledError
    )
    expect(progress).toHaveBeenCalledWith(11)
    expect(await readFile(task.sourcePath)).toEqual(original)
    expect(readdirSync(root)).toEqual(['source.png'])
    expect(await processImage(task, new AbortController().signal)).toBeLessThanOrEqual(1024)
    expect(readdirSync(root)).toEqual(['output.jpg', 'source.png'])
  })

  it('preserves the detailed error and removes all files when the size limit is impossible', async () => {
    const { root, task } = await noisyFixture()
    await sharp({ create: { width: 40, height: 30, channels: 3, background: '#76bfd1' } })
      .withExif({ IFD0: { ImageDescription: 'description'.repeat(400) } })
      .png()
      .toFile(task.sourcePath)
    task.sourceSize = statSync(task.sourcePath).size
    task.options = { ...(task.options as ImageOptions), metadataMode: 'all' }
    const error = await processImage(task, new AbortController().signal).catch(
      (reason: unknown) => reason
    )
    expect(error).toBeInstanceOf(MediaProcessError)
    expect(error).toMatchObject({
      message: '无法压缩到 1 KB，请降低尺寸或改用 JPEG/WebP/AVIF',
      details: { command: { executable: 'sharp' } }
    })
    expect(readdirSync(root)).toEqual(['source.png'])
  })

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
      sourceSize: statSync(sourcePath).size,
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
    await sharp({ create: { width: 400, height: 300, channels: 4, background: '#76bfd1' } })
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
      sourceSize: statSync(sourcePath).size,
      createdAt: new Date(0).toISOString()
    }

    expect(await processImage(task, new AbortController().signal)).toBeGreaterThan(0)
    expect(await readMetadata(outputPath)).toMatchObject({
      format: 'heif',
      compression: 'av1',
      width: 400,
      height: 300
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
      sourceSize: statSync(sourcePath).size,
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
    await sharp({ create: { width: 400, height: 300, channels: 3, background: '#76bfd1' } })
      .withExif({ IFD0: { Make: 'VVTools Camera' } })
      .withIccProfile('p3')
      .jpeg({ quality: 100 })
      .toFile(sourcePath)
    const task: MediaTask = {
      id: mode,
      kind: 'image',
      sourcePath,
      outputPath,
      status: 'processing',
      progress: 0,
      options: { ...DEFAULT_IMAGE_OPTIONS, format: 'jpeg', metadataMode: mode },
      sourceSize: statSync(sourcePath).size,
      createdAt: new Date(0).toISOString()
    }

    await processImage(task, new AbortController().signal)
    const metadata = await readMetadata(outputPath)
    expect(Boolean(metadata.exif)).toBe(keepsExif)
    expect(Boolean(metadata.icc)).toBe(keepsIcc)
  })

  it('skips and removes output when conversion makes the image larger', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-image-skip-'))
    directories.push(root)
    const sourcePath = join(root, 'source.png')
    const outputPath = join(root, 'source_processed.avif')
    await sharp({ create: { width: 1, height: 1, channels: 4, background: '#76bfd1' } })
      .png()
      .toFile(sourcePath)
    const task: MediaTask = {
      id: 'image-skip',
      kind: 'image',
      sourcePath,
      outputPath,
      status: 'processing',
      progress: 0,
      options: { ...DEFAULT_IMAGE_OPTIONS, format: 'avif', quality: 100 },
      sourceSize: statSync(sourcePath).size,
      createdAt: new Date(0).toISOString()
    }

    await expect(processImage(task, new AbortController().signal)).rejects.toBeInstanceOf(
      TaskSkippedError
    )
    expect(existsSync(sourcePath)).toBe(true)
    expect(existsSync(outputPath)).toBe(false)
  })
})
