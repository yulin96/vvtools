import { accessSync, constants, existsSync, statSync } from 'fs'
import { dirname, join } from 'path'
import sharp from 'sharp'
import type { CreateTasksRequest, MediaInspection } from '../../shared/types'
import { createAvailableOutputPath, getOutputExtension } from './output-path'
import { probeVideo } from './video-processor'

interface InspectionSource {
  path: string
  relativeDirectory: string
}

export async function inspectTasks(
  request: CreateTasksRequest,
  existingReservedPaths: ReadonlySet<string> = new Set()
): Promise<MediaInspection[]> {
  const sources: InspectionSource[] =
    request.kind === 'video'
      ? request.sourcePaths.map((path) => ({ path, relativeDirectory: '' }))
      : request.sources
  const reservedPaths = new Set(existingReservedPaths)

  return mapWithConcurrency(sources, 4, async (source) => {
    const outputDirectory =
      request.outputMode === 'source'
        ? dirname(source.path)
        : request.kind === 'image' && request.options.preserveStructure && source.relativeDirectory
          ? join(request.outputDirectory, source.relativeDirectory)
          : request.outputDirectory
    const extension = getOutputExtension(
      request.kind,
      source.path,
      request.kind === 'image' ? request.options.format : undefined,
      request.kind === 'video' ? request.options.format : undefined
    )
    const outputPath = createAvailableOutputPath(
      source.path,
      outputDirectory,
      extension,
      reservedPaths,
      request.outputSuffix
    )

    try {
      assertOutputDirectoryWritable(outputDirectory)
      const sourceSize = statSync(source.path).size
      if (request.kind === 'video') {
        const probe = await probeVideo(source.path, new AbortController().signal)
        return {
          sourcePath: source.path,
          outputPath,
          valid: true,
          sourceSize,
          format: probe.format,
          width: probe.width,
          height: probe.height,
          duration: probe.duration,
          videoCodec: probe.videoCodec
        }
      }

      const metadata = await sharp(source.path, { failOn: 'error' }).metadata()
      if (!metadata.width || !metadata.height || !metadata.format) {
        throw new Error('无法读取有效的图片信息')
      }
      const rotated = Boolean(
        metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8
      )
      return {
        sourcePath: source.path,
        outputPath,
        valid: true,
        sourceSize,
        format: metadata.format,
        width: rotated ? metadata.height : metadata.width,
        height: rotated ? metadata.width : metadata.height
      }
    } catch (error) {
      return {
        sourcePath: source.path,
        outputPath,
        valid: false,
        sourceSize: safeFileSize(source.path),
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })
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
