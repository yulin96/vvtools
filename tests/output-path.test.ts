import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAvailableOutputPath, getOutputExtension } from '../src/main/media/output-path'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('output paths', () => {
  it('uses the requested output format', () => {
    expect(getOutputExtension('video', '/tmp/a.mov')).toBe('.mp4')
    expect(getOutputExtension('video', '/tmp/a.mov', undefined, 'mkv')).toBe('.mkv')
    expect(getOutputExtension('image', '/tmp/a.jpeg', 'original')).toBe('.jpg')
    expect(getOutputExtension('image', '/tmp/a.png', 'webp')).toBe('.webp')
  })

  it('never overwrites existing or reserved outputs', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vvtools-output-'))
    directories.push(directory)
    writeFileSync(join(directory, 'clip_compressed.mp4'), '')
    const reserved = new Set<string>()
    const first = createAvailableOutputPath('/input/clip.mov', directory, '.mp4', reserved)
    const second = createAvailableOutputPath('/input/clip.mov', directory, '.mp4', reserved)
    expect(first).toBe(join(directory, 'clip_compressed_1.mp4'))
    expect(second).toBe(join(directory, 'clip_compressed_2.mp4'))
  })
})
