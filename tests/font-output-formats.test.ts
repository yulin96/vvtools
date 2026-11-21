import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { it, expect } from 'vitest'
import { readFontFormatSupport } from '../src/main/media/font-output-formats'

it('reads native and web flavors by content and intersects formats for mixed collections', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vvtools-format-'))
  const path = join(directory, 'misnamed.otf')
  try {
    for (const wrapper of ['', 'wOFF', 'wOF2']) {
      for (const [signature, native] of [
        ['OTTO', 'otf'],
        ['\x00\x01\x00\x00', 'ttf']
      ]) {
        const header = Buffer.alloc(12)
        header.write(wrapper + signature, 'latin1')
        await writeFile(path, header)
        expect(await readFontFormatSupport(path)).toEqual({
          collection: false,
          formats: [native, 'woff', 'woff2']
        })
      }
    }
    const collection = Buffer.alloc(32)
    collection.write('ttcf')
    collection.writeUInt32BE(2, 8)
    collection.writeUInt32BE(20, 12)
    collection.writeUInt32BE(24, 16)
    collection.write('OTTOOTTO', 20)
    await writeFile(path, collection)
    expect((await readFontFormatSupport(path)).formats).toEqual(['otf', 'woff', 'woff2'])
    collection.writeUInt32BE(0x10000, 24)
    await writeFile(path, collection)
    expect(await readFontFormatSupport(path)).toEqual({
      collection: true,
      formats: ['woff', 'woff2']
    })
    expect((await readFontFormatSupport(path, [1])).formats).toEqual(['ttf', 'woff', 'woff2'])
    await expect(readFontFormatSupport(path, [2])).rejects.toThrow('编号不存在')
    await writeFile(path, collection.subarray(0, 16))
    await expect(readFontFormatSupport(path)).rejects.toThrow('不完整')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
