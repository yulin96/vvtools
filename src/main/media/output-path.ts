import { existsSync } from 'fs'
import { extname, join, parse } from 'path'
import type { ImageFormat, TaskKind, VideoFormat } from '../../shared/types'

const IMAGE_EXTENSIONS: Record<Exclude<ImageFormat, 'original'>, string> = {
  jpeg: '.jpg',
  png: '.png',
  webp: '.webp'
}

export function getOutputExtension(
  kind: TaskKind,
  sourcePath: string,
  imageFormat?: ImageFormat,
  videoFormat?: VideoFormat
): string {
  if (kind === 'video') return `.${videoFormat || 'mp4'}`
  if (imageFormat && imageFormat !== 'original') return IMAGE_EXTENSIONS[imageFormat]
  const extension = extname(sourcePath).toLowerCase()
  return extension === '.jpeg' ? '.jpg' : extension
}

export function createAvailableOutputPath(
  sourcePath: string,
  outputDirectory: string,
  extension: string,
  reservedPaths: Set<string>
): string {
  const baseName = parse(sourcePath).name
  let index = 0

  while (true) {
    const suffix = index === 0 ? '_compressed' : `_compressed_${index}`
    const candidate = join(outputDirectory, `${baseName}${suffix}${extension}`)
    if (!existsSync(candidate) && !reservedPaths.has(candidate)) {
      reservedPaths.add(candidate)
      return candidate
    }
    index += 1
  }
}
