import { rename, rm, stat } from 'fs/promises'
import { extname } from 'path'
import type { Metadata, Sharp } from 'sharp'
import sharp from './sharp-runtime'
import type { ImageFormat, ImageOptions, MediaTask } from '../../shared/types'
import { MediaProcessError, TaskCancelledError, TaskSkippedError } from './errors'
import { createTaskCommand } from './task-command'

function sourceFormat(sourcePath: string): Exclude<ImageFormat, 'original'> {
  const extension = extname(sourcePath).toLowerCase()
  if (extension === '.png') return 'png'
  if (extension === '.webp') return 'webp'
  return 'jpeg'
}

function orientedWidth(metadata: Metadata): number | undefined {
  if (!metadata.width || !metadata.height) return metadata.width
  return metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8
    ? metadata.height
    : metadata.width
}

function configureImageTransforms(
  pipeline: Sharp,
  options: ImageOptions,
  metadata: Metadata
): Sharp {
  let transformed = pipeline.rotate()
  const resize = { withoutEnlargement: !options.allowEnlargement }
  if (options.resizeMode === 'width') {
    transformed = transformed.resize({ width: options.width, ...resize })
  } else if (options.resizeMode === 'height') {
    transformed = transformed.resize({ height: options.height, ...resize })
  } else if (options.resizeMode === 'percentage') {
    const width = orientedWidth(metadata)
    if (!width) throw new Error('无法读取图片尺寸')
    transformed = transformed.resize({
      width: Math.max(1, Math.round((width * options.percentage) / 100)),
      ...resize
    })
  }
  return keepImageMetadata(transformed, options)
}

function keepImageMetadata(pipeline: Sharp, options: ImageOptions): Sharp {
  if (options.metadataMode === 'all') return pipeline.keepMetadata()
  if (options.metadataMode === 'colorProfile') return pipeline.keepIccProfile()
  return pipeline
}

function configureImageEncoding(
  pipeline: Sharp,
  options: ImageOptions,
  sourcePath: string,
  quality = options.quality
): Sharp {
  const format = options.format === 'original' ? sourceFormat(sourcePath) : options.format
  if (format === 'png') return pipeline.png({ compressionLevel: 9, palette: true, quality })
  if (format === 'webp') return pipeline.webp({ quality, effort: 4 })
  if (format === 'avif') return pipeline.avif({ quality, effort: 4 })
  return pipeline.jpeg({ quality, mozjpeg: true })
}

async function processToTargetSize(
  task: MediaTask,
  options: ImageOptions,
  metadata: Metadata,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
  command: ReturnType<typeof createTaskCommand>
): Promise<void> {
  const targetBytes = options.targetSizeKb * 1024
  const preparedPath = `${task.outputPath}.prepared.v`
  const candidates = new Set<string>()
  let best: { path: string; quality: number } | null = null
  let low = 1
  let high = 100
  let attempts = 0
  try {
    // Native V keeps lossless pixels and metadata on disk, avoiding repeated transforms.
    await configureImageTransforms(
      sharp(task.sourcePath, { failOn: 'error' }),
      options,
      metadata
    ).toFile(preparedPath)
    while (low <= high && attempts < 8) {
      if (signal.aborted) throw new TaskCancelledError()
      const quality = attempts === 0 ? 100 : Math.floor((low + high) / 2)
      const path = `${task.outputPath}.tmp-${task.id}-${quality}`
      candidates.add(path)
      const output = await configureImageEncoding(
        keepImageMetadata(sharp(preparedPath, { failOn: 'error' }), options),
        options,
        task.sourcePath,
        quality
      ).toFile(path)
      if (signal.aborted) throw new TaskCancelledError()
      attempts += 1
      if (output.size <= targetBytes) {
        if (!best || quality > best.quality) {
          if (best) {
            await rm(best.path, { force: true })
            candidates.delete(best.path)
          }
          best = { path, quality }
        } else {
          await rm(path, { force: true })
          candidates.delete(path)
        }
        low = quality + 1
      } else {
        await rm(path, { force: true })
        candidates.delete(path)
        high = quality - 1
      }
      onProgress(Math.min(90, Math.round((attempts / 8) * 90)))
    }
    if (!best)
      throw new MediaProcessError(
        `无法压缩到 ${options.targetSizeKb} KB，请降低尺寸或改用 JPEG/WebP/AVIF`,
        { command }
      )
    await rename(best.path, task.outputPath)
    candidates.delete(best.path)
  } finally {
    await Promise.all([preparedPath, ...candidates].map((path) => rm(path, { force: true })))
  }
}

export async function processImageCore(
  task: MediaTask,
  signal: AbortSignal,
  onProgress: (progress: number) => void = () => undefined
): Promise<number> {
  if (signal.aborted) throw new TaskCancelledError()
  const options = task.options as ImageOptions
  const command = createTaskCommand('sharp', [
    task.sourcePath,
    '--format',
    options.format,
    '--compression-mode',
    options.compressionMode,
    '--quality',
    String(options.quality),
    '--target-size-kb',
    String(options.targetSizeKb),
    '--resize-mode',
    options.resizeMode,
    '--metadata-mode',
    options.metadataMode,
    '--output',
    task.outputPath
  ])
  try {
    const metadata = await sharp(task.sourcePath, { failOn: 'error' }).metadata()
    onProgress(5)
    if (signal.aborted) throw new TaskCancelledError()
    if (options.compressionMode === 'targetSize') {
      await processToTargetSize(task, options, metadata, signal, onProgress, command)
    } else {
      await configureImageEncoding(
        configureImageTransforms(sharp(task.sourcePath, { failOn: 'error' }), options, metadata),
        options,
        task.sourcePath
      ).toFile(task.outputPath)
    }
    if (signal.aborted) throw new TaskCancelledError()
    onProgress(100)
    const outputSize = (await stat(task.outputPath)).size
    if (outputSize > task.sourceSize)
      throw new TaskSkippedError('转换后文件更大，已跳过且未保存', outputSize)
    return outputSize
  } catch (error) {
    await rm(task.outputPath, { force: true })
    if (
      error instanceof TaskCancelledError ||
      error instanceof TaskSkippedError ||
      error instanceof MediaProcessError
    )
      throw error
    throw new MediaProcessError('图片处理失败，请确认文件格式和参数有效', {
      command,
      stderrTail: error instanceof Error ? error.message : String(error)
    })
  }
}
