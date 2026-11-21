import { open } from 'node:fs/promises'
import type { FontFormatSupport } from '../../shared/types'

function nativeFormat(signature: string): 'ttf' | 'otf' {
  if (signature === 'OTTO') return 'otf'
  if (signature === '\x00\x01\x00\x00' || signature === 'true') return 'ttf'
  throw new Error('无法识别字体轮廓格式')
}

export async function readFontFormatSupport(
  sourcePath: string,
  indexes?: number[]
): Promise<FontFormatSupport> {
  const file = await open(sourcePath, 'r')
  try {
    const read = async (position: number, length: number): Promise<Buffer> => {
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await file.read(buffer, 0, length, position)
      if (bytesRead !== length) throw new Error('字体文件头不完整')
      return buffer
    }
    const header = await read(0, 12)
    const signature = header.toString('latin1', 0, 4)
    if (signature !== 'ttcf') {
      const wrapped = signature === 'wOFF' || signature === 'wOF2'
      const native = nativeFormat(wrapped ? header.toString('latin1', 4, 8) : signature)
      return { collection: false, formats: [native, 'woff', 'woff2'] }
    }

    const count = header.readUInt32BE(8)
    const { size } = await file.stat()
    if (!count || 12 + 4 * count > size) throw new Error('字体集合目录不完整')
    const selected = indexes?.length ? new Set(indexes) : undefined
    if (indexes?.some((index) => index >= count))
      throw new Error(`字体编号不存在：最多只有 ${count} 个字体`)
    const native = new Set<'ttf' | 'otf'>()
    for (let index = 0; index < count; index += 256) {
      const offsets = await read(12 + 4 * index, Math.min(256, count - index) * 4)
      for (let offset = 0; offset < offsets.length; offset += 4) {
        if (selected && !selected.has(index + offset / 4)) continue
        const face = await read(offsets.readUInt32BE(offset), 4)
        native.add(nativeFormat(face.toString('latin1')))
        if (native.size > 1) return { collection: true, formats: ['woff', 'woff2'] }
      }
    }
    return { collection: true, formats: [...native, 'woff', 'woff2'] }
  } finally {
    await file.close()
  }
}
