import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import type { MediaTask } from '../src/shared/types'
import { processImage } from '../src/main/media/image-processor'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('image processor', () => {
  it('converts an image to WebP without loading the file into renderer memory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-image-'))
    directories.push(root)
    const sourcePath = join(root, 'source.png')
    const outputPath = join(root, 'source_compressed.webp')
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
      options: { format: 'webp', quality: 75 },
      sourceSize: 1,
      createdAt: new Date(0).toISOString()
    }
    expect(await processImage(task, new AbortController().signal)).toBeGreaterThan(0)
    expect((await sharp(outputPath).metadata()).format).toBe('webp')
  })
})
