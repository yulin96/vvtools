import { rmSync, statSync } from 'fs'
import { extname } from 'path'
import sharp, { type Sharp } from 'sharp'
import type { ImageFormat, ImageOptions, MediaTask } from '../../shared/types'
import { MediaProcessError, TaskCancelledError } from './errors'
import { createTaskCommand } from './ffmpeg-runtime'

function sourceFormat(sourcePath: string): Exclude<ImageFormat, 'original'> {
  const extension = extname(sourcePath).toLowerCase()
  if (extension === '.png') return 'png'
  if (extension === '.webp') return 'webp'
  return 'jpeg'
}

export function configureImagePipeline(
  pipeline: Sharp,
  options: ImageOptions,
  sourcePath: string
): Sharp {
  const format = options.format === 'original' ? sourceFormat(sourcePath) : options.format
  const rotated = pipeline.rotate()
  if (format === 'png') {
    return rotated.png({ compressionLevel: 9, palette: true, quality: options.quality })
  }
  if (format === 'webp') return rotated.webp({ quality: options.quality, effort: 4 })
  return rotated.jpeg({ quality: options.quality, mozjpeg: true })
}

export async function processImage(task: MediaTask, signal: AbortSignal): Promise<number> {
  if (signal.aborted) throw new TaskCancelledError()
  const options = task.options as ImageOptions
  const command = createTaskCommand('sharp', [
    task.sourcePath,
    '--format',
    options.format,
    '--quality',
    String(options.quality),
    '--output',
    task.outputPath
  ])

  try {
    const pipeline = configureImagePipeline(
      sharp(task.sourcePath, { failOn: 'error' }),
      options,
      task.sourcePath
    )
    await pipeline.toFile(task.outputPath)
    if (signal.aborted) {
      rmSync(task.outputPath, { force: true })
      throw new TaskCancelledError()
    }
    return statSync(task.outputPath).size
  } catch (error) {
    rmSync(task.outputPath, { force: true })
    if (error instanceof TaskCancelledError) throw error
    throw new MediaProcessError('图片处理失败，请确认文件格式有效', {
      command,
      stderrTail: error instanceof Error ? error.message : String(error)
    })
  }
}
