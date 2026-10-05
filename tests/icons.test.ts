import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'vvtools-icons-'))
  const source = join(root, 'source.png')
  await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#6f51e7' } })
    .png()
    .toFile(source)
  const generated = spawnSync(process.execPath, [resolve('scripts/generate-icons.mjs'), source], {
    cwd: root,
    encoding: 'utf8'
  })
  expect(generated.error).toBeUndefined()
  expect(generated.status, generated.stderr).toBe(0)
})

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})

async function opaqueBounds(path: string): Promise<number[]> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const bounds = [info.width, info.height, -1, -1]
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] < 128) continue
      bounds[0] = Math.min(bounds[0], x)
      bounds[1] = Math.min(bounds[1], y)
      bounds[2] = Math.max(bounds[2], x)
      bounds[3] = Math.max(bounds[3], y)
    }
  }
  expect(data[3]).toBe(0)
  const center = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4
  expect([...data.subarray(center, center + 4)]).toEqual([111, 81, 231, 255])
  return bounds
}

describe('application icon export contracts', () => {
  it('keeps native transparent padding separate from the unpadded UI badge', async () => {
    expect(await opaqueBounds(join(root, 'build/icon-source.png'))).toEqual([100, 100, 923, 923])
    expect(await opaqueBounds(join(root, 'build/icon-windows.png'))).toEqual([64, 64, 959, 959])
    expect(await opaqueBounds(join(root, 'resources/logo.png'))).toEqual([0, 0, 255, 255])
    for (const [path, size] of [
      ['build/logo-source.png', 1024],
      ['build/icon.png', 512],
      ['resources/icon.png', 512],
      ['resources/icon-mac.png', 512],
      ['resources/logo.png', 256]
    ] as const) {
      expect(await sharp(join(root, path)).metadata()).toMatchObject({
        width: size,
        height: size,
        format: 'png'
      })
    }
    expect(await opaqueBounds(join(root, 'resources/icon-mac.png'))).toEqual([50, 50, 461, 461])
  })

  it('embeds distinct 32-bit ICO frames for common Windows DPI scales with transparent corners', async () => {
    const ico = await readFile(join(root, 'build/icon.ico'))
    expect(ico.readUInt16LE(0)).toBe(0)
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBe(10)
    const sizes: number[] = []
    for (let index = 0; index < 10; index++) {
      const entry = 6 + index * 16
      const size = ico[entry] || 256
      const height = ico[entry + 1] || 256
      const bytes = ico.readUInt32LE(entry + 8)
      const offset = ico.readUInt32LE(entry + 12)
      sizes.push(size)
      expect(height).toBe(size)
      expect(ico.readUInt16LE(entry + 6)).toBe(32)
      expect(offset + bytes).toBeLessThanOrEqual(ico.length)
      expect(ico.readUInt32LE(offset)).toBe(40)
      expect(ico.readInt32LE(offset + 4)).toBe(size)
      expect(ico.readInt32LE(offset + 8)).toBe(size * 2)
      const pixels = offset + 40
      const alphaAt = (x: number, y: number): number =>
        ico[pixels + ((size - y - 1) * size + x) * 4 + 3]
      for (const [x, y] of [
        [0, 0],
        [size - 1, 0],
        [0, size - 1],
        [size - 1, size - 1]
      ])
        expect(alphaAt(x, y)).toBe(0)
      expect(alphaAt(size / 2, size / 2)).toBe(255)
    }
    expect(sizes).toEqual([16, 20, 24, 32, 40, 48, 64, 96, 128, 256])
  })

  it('round-trips the full macOS ordinary and Retina iconset on the native host', async () => {
    const path = join(root, 'build/icon.icns')
    if (process.platform !== 'darwin') {
      expect(existsSync(path)).toBe(false)
      return
    }
    const icns = await readFile(path)
    expect(icns.toString('ascii', 0, 4)).toBe('icns')
    expect(icns.readUInt32BE(4)).toBe(icns.length)
    const decoded = join(root, 'decoded.iconset')
    const result = spawnSync('iconutil', ['-c', 'iconset', '-o', decoded, path], {
      encoding: 'utf8'
    })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    for (const [name, size] of [
      ['icon_16x16.png', 16],
      ['icon_16x16@2x.png', 32],
      ['icon_32x32.png', 32],
      ['icon_32x32@2x.png', 64],
      ['icon_128x128.png', 128],
      ['icon_128x128@2x.png', 256],
      ['icon_256x256.png', 256],
      ['icon_256x256@2x.png', 512],
      ['icon_512x512.png', 512],
      ['icon_512x512@2x.png', 1024]
    ] as const) {
      expect(await sharp(join(decoded, name)).metadata()).toMatchObject({
        width: size,
        height: size,
        hasAlpha: true
      })
    }
  })
})
