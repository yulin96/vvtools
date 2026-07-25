import { accessSync, constants, existsSync, statSync } from 'fs'
import { dirname, join } from 'path'
import sharp from 'sharp'
import type {
  CreateTasksRequest,
  ImageOptions,
  MediaInspection,
  VideoOptions
} from '../../shared/types'
import { getOutputExtension, resolveOutputPath } from './output-path'
import { probeVideo } from './video-processor'
import { probeAudio } from './audio-processor'

interface InspectionSource {
  path: string
  relativeDirectory: string
}

export async function inspectTasks(
  request: CreateTasksRequest,
  existingReservedPaths: ReadonlySet<string> = new Set()
): Promise<MediaInspection[]> {
  const sources: InspectionSource[] =
    request.kind === 'image'
      ? request.sources
      : request.sourcePaths.map((path) => ({ path, relativeDirectory: '' }))
  const reservedPaths = new Set(existingReservedPaths)

  const inspections = await mapWithConcurrency(sources, 4, async (source) => {
    try {
      assertOutputDirectoryWritable(outputDirectoryFor(request, source))
      const sourceSize = statSync(source.path).size
      if (request.kind === 'video') {
        const probe = await probeVideo(source.path, new AbortController().signal)
        const outputDimensions = expectedVideoDimensions(request.options, probe.width, probe.height)
        return {
          sourcePath: source.path,
          outputPath: '',
          valid: true,
          sourceSize,
          format: probe.format,
          width: probe.width,
          height: probe.height,
          outputWidth: outputDimensions.width,
          outputHeight: outputDimensions.height,
          duration: probe.duration,
          videoCodec: probe.videoCodec
        }
      }
      if (request.kind === 'audio') {
        const probe = await probeAudio(source.path, new AbortController().signal)
        return {
          sourcePath: source.path,
          outputPath: '',
          valid: true,
          sourceSize,
          format: probe.format,
          duration: probe.duration,
          audioCodec: probe.audioCodec,
          channels: probe.channels,
          sampleRate: probe.sampleRate
        }
      }

      const metadata = await sharp(source.path, { failOn: 'error' }).metadata()
      if (!metadata.width || !metadata.height || !metadata.format) {
        throw new Error('无法读取有效的图片信息')
      }
      const rotated = Boolean(
        metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8
      )
      const width = rotated ? metadata.height : metadata.width
      const height = rotated ? metadata.width : metadata.height
      const outputDimensions = expectedImageDimensions(request.options, width, height)
      return {
        sourcePath: source.path,
        outputPath: '',
        valid: true,
        sourceSize,
        format: metadata.format,
        width,
        height,
        outputWidth: outputDimensions.width,
        outputHeight: outputDimensions.height
      }
    } catch (error) {
      return {
        sourcePath: source.path,
        outputPath: '',
        valid: false,
        sourceSize: safeFileSize(source.path),
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  return inspections.map((inspection, index) => {
    const source = sources[index]
    const output = resolveOutputPath({
      sourcePath: source.path,
      outputDirectory: outputDirectoryFor(request, source),
      extension: getOutputExtension(
        request.kind,
        source.path,
        request.kind === 'image' ? request.options.format : undefined,
        request.kind === 'video' ? request.options.format : undefined,
        request.kind === 'audio' ? request.options.format : undefined
      ),
      reservedPaths,
      outputSuffix: request.outputSuffix,
      nameTemplate: request.outputNameTemplate,
      conflictPolicy: request.outputConflictPolicy,
      presetName: request.presetName,
      width: inspection.outputWidth ?? inspection.width,
      height: inspection.outputHeight ?? inspection.height
    })
    if (output.skipped && inspection.valid) {
      return {
        ...inspection,
        outputPath: output.path,
        valid: false,
        skipped: true,
        error: '输出文件已存在，当前冲突策略为跳过'
      }
    }
    return { ...inspection, outputPath: output.path }
  })
}

function expectedImageDimensions(
  options: ImageOptions,
  width: number,
  height: number
): { width: number; height: number } {
  if (options.resizeMode === 'source') return { width, height }
  if (options.resizeMode === 'width') {
    const outputWidth = options.allowEnlargement ? options.width : Math.min(width, options.width)
    return { width: outputWidth, height: Math.max(1, Math.round((height * outputWidth) / width)) }
  }
  if (options.resizeMode === 'height') {
    const outputHeight = options.allowEnlargement
      ? options.height
      : Math.min(height, options.height)
    return { width: Math.max(1, Math.round((width * outputHeight) / height)), height: outputHeight }
  }
  const percentage = options.allowEnlargement
    ? options.percentage
    : Math.min(options.percentage, 100)
  return {
    width: Math.max(1, Math.round((width * percentage) / 100)),
    height: Math.max(1, Math.round((height * percentage) / 100))
  }
}

function expectedVideoDimensions(
  options: VideoOptions,
  width?: number,
  height?: number
): { width?: number; height?: number } {
  if (!width || !height || options.resolution === 'source') return { width, height }
  const bounds = options.resolution === '1080p' ? [1920, 1080] : [1280, 720]
  const scale = Math.min(1, bounds[0] / width, bounds[1] / height)
  return {
    width: Math.max(2, Math.floor((width * scale) / 2) * 2),
    height: Math.max(2, Math.floor((height * scale) / 2) * 2)
  }
}

function outputDirectoryFor(request: CreateTasksRequest, source: InspectionSource): string {
  if (request.outputMode === 'source') return dirname(source.path)
  if (request.kind === 'image' && request.options.preserveStructure && source.relativeDirectory) {
    return join(request.outputDirectory, source.relativeDirectory)
  }
  return request.outputDirectory
}

function assertOutputDirectoryWritable(outputDirectory: string): void {
  let candidate = outputDirectory
  while (!existsSync(candidate)) {
    const parent = dirname(candidate)
    if (parent === candidate) throw new Error('输出目录不可访问')
    candidate = parent
  }
  if (!statSync(candidate).isDirectory()) throw new Error('输出位置不是目录')
  try {
    accessSync(candidate, constants.W_OK)
  } catch {
    throw new Error('输出目录不可写')
  }
}

function safeFileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(values[index])
    }
  })
  await Promise.all(workers)
  return results
}
