import { statSync } from 'fs'
import sharp from 'sharp'
import type { ImageSourceMetadata } from '../../shared/types'

export async function inspectImageMetadata(
  path: string,
  knownSourceSize?: number
): Promise<ImageSourceMetadata> {
  const sourceSize = knownSourceSize ?? statSync(path).size
  const metadata = await sharp(path, { failOn: 'error' }).metadata()
  if (!metadata.width || !metadata.height || !metadata.format) {
    throw new Error('无法读取有效的图片信息')
  }
  const rotated = Boolean(
    metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8
  )
  return {
    sourceSize,
    format: metadata.format,
    width: rotated ? metadata.height : metadata.width,
    height: rotated ? metadata.width : metadata.height
  }
}
