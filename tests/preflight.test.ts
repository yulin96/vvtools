import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectTasks } from '../src/main/media/preflight'
import { DEFAULT_IMAGE_OPTIONS } from '../src/shared/constants'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('media preflight', () => {
  it('reads image details and previews a collision-safe output path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-preflight-'))
    directories.push(root)
    const source = join(root, 'photo.jpg')
    const output = join(root, 'output')
    mkdirSync(output)
    await sharp({
      create: { width: 16, height: 9, channels: 3, background: '#3388cc' }
    })
      .jpeg()
      .toFile(source)
    writeFileSync(join(output, 'photo.webp'), 'existing')

    const [inspection] = await inspectTasks({
      kind: 'image',
      sources: [{ path: source, relativeDirectory: '' }],
      outputMode: 'custom',
      outputDirectory: output,
      outputSuffix: '',
      options: { ...DEFAULT_IMAGE_OPTIONS, format: 'webp' }
    })

    expect(inspection).toMatchObject({
      valid: true,
      sourcePath: source,
      outputPath: join(output, 'photo_1.webp'),
      format: 'jpeg',
      width: 16,
      height: 9
    })
    expect(inspection.sourceSize).toBeGreaterThan(0)
  })

  it('reports a corrupt image without rejecting the complete batch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-preflight-'))
    directories.push(root)
    const source = join(root, 'broken.jpg')
    writeFileSync(source, 'not an image')

    const [inspection] = await inspectTasks({
      kind: 'image',
      sources: [{ path: source, relativeDirectory: '' }],
      outputMode: 'custom',
      outputDirectory: join(root, 'output'),
      outputSuffix: '',
      options: { ...DEFAULT_IMAGE_OPTIONS }
    })

    expect(inspection.valid).toBe(false)
    expect(inspection.error).toBeTruthy()
  })
})
