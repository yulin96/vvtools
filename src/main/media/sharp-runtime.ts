import sharp, { type Metadata } from 'sharp'
import { MediaProcessError } from './errors'

// Cached file loaders can retain Windows handles after a completed operation.
sharp.cache(false)

export async function readStaticImageMetadata(path: string): Promise<Metadata> {
  const metadata = await sharp(path, { failOn: 'error' }).metadata()
  if ((metadata.pages ?? 1) > 1) throw new MediaProcessError('当前不支持动画图片，请选择静态图片')
  return metadata
}

export default sharp
