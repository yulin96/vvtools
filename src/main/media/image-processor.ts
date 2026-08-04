import { renameSync, rmSync, statSync } from 'fs'
import { extname } from 'path'
import sharp, { type Metadata, type Sharp } from 'sharp'
import type { ImageFormat, ImageOptions, MediaTask } from '../../shared/types'
import { MediaProcessError, TaskCancelledError, TaskSkippedError } from './errors'
import { createTaskCommand } from './ffmpeg-runtime'

sharp.concurrency(2)

if (process.platform === 'win32') {
  sharp.cache({ files: 0 })
}

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

export function configureImagePipeline(
  pipeline: Sharp,
  options: ImageOptions,
  sourcePath: string,
  metadata: Metadata,
  quality = options.quality
): Sharp {
  const format = options.format === 'original' ? sourceFormat(sourcePath) : options.format
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

  if (options.metadataMode === 'all') {
    transformed = transformed.keepMetadata()
  } else if (options.metadataMode === 'colorProfile') {
    transformed = transformed.keepIccProfile()
  }

  if (format === 'png') {
    return transformed.png({ compressionLevel: 9, palette: true, quality })
  }
  if (format === 'webp') return transformed.webp({ quality, effort: 4 })
  if (format === 'avif') return transformed.avif({ quality, effort: 4 })
  return transformed.jpeg({ quality, mozjpeg: true })
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
  const candidates = new Set<string>()
  let best: { path: string; quality: number } | null = null
  let low = 1
  let high = 100
  let attempts = 0

  try {
    while (low <= high && attempts < 8) {
      if (signal.aborted) throw new TaskCancelledError()
      const quality = Math.floor((low + high) / 2)
      const path = `${task.outputPath}.tmp-${task.id}-${quality}`
      candidates.add(path)
      await configureImagePipeline(
        sharp(task.sourcePath, { failOn: 'error' }),
        options,
        task.sourcePath,
        metadata,
        quality
      ).toFile(path)
      if (signal.aborted) throw new TaskCancelledError()

      const size = statSync(path).size
      attempts += 1
      onProgress(Math.min(90, Math.round((attempts / 8) * 90)))
      if (size <= targetBytes) {
        if (!best || quality > best.quality) best = { path, quality }
        low = quality + 1
      } else {
        high = quality - 1
      }
    }

    if (!best) {
      throw new MediaProcessError(
        `无法压缩到 ${options.targetSizeKb} KB，请降低尺寸或改用 JPEG/WebP/AVIF`,
        { command }
      )
    }
    renameSync(best.path, task.outputPath)
    candidates.delete(best.path)
  } finally {
    for (const path of candidates) rmSync(path, { force: true })
  }
}

export async function processImage(
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
    if (options.compressionMode === 'targetSize') {
      await processToTargetSize(task, options, metadata, signal, onProgress, command)
    } else {
      await configureImagePipeline(
        sharp(task.sourcePath, { failOn: 'error' }),
        options,
        task.sourcePath,
        metadata
      ).toFile(task.outputPath)
    }
    if (signal.aborted) {
      rmSync(task.outputPath, { force: true })
      throw new TaskCancelledError()
    }
    onProgress(100)
    const outputSize = statSync(task.outputPath).size
    if (outputSize > task.sourceSize) {
      throw new TaskSkippedError('转换后文件更大，已跳过且未保存', outputSize)
    }
    return outputSize
  } catch (error) {
    rmSync(task.outputPath, { force: true })
    if (
      error instanceof TaskCancelledError ||
      error instanceof TaskSkippedError ||
      error instanceof MediaProcessError
    ) {
      throw error
    }
    throw new MediaProcessError('图片处理失败，请确认文件格式和参数有效', {
      command,
      stderrTail: error instanceof Error ? error.message : String(error)
    })
  }
}
