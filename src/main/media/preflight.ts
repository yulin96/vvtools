import { accessSync, constants, existsSync, statSync } from 'fs'
import { dirname, join } from 'path'
import type {
  CreateTasksRequest,
  FontFormat,
  FontInstance,
  ImageOptions,
  MediaInspection,
  VideoOptions
} from '../../shared/types'
import {
  getOutputExtension,
  resolveOutputPath,
  resolvePdfImageOutput,
  resolveSpriteOutput
} from './output-path'
import { getVideoResolutionBounds, probeVideo } from './video-processor'
import { createSpritePlan } from './sprite-processor'
import { probeAudio } from './audio-processor'
import { probeFont } from './font-processor'
import { inspectImageMetadata } from './image-metadata'
import { probePdf } from './pdf-processor'

interface InspectionSource {
  path: string
  relativeDirectory: string
  fontOutputFormat?: FontFormat
}

export async function inspectTasks(
  request: CreateTasksRequest,
  existingReservedPaths: ReadonlySet<string> = new Set()
): Promise<MediaInspection[]> {
  const sources: InspectionSource[] =
    request.kind === 'image'
      ? request.sources
      : request.kind === 'font'
        ? request.sources.map((source) => ({
            path: source.path,
            relativeDirectory: '',
            fontOutputFormat: source.outputFormat
          }))
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
      if (request.kind === 'sprite') {
        const probe = await probeVideo(source.path, new AbortController().signal)
        const plan = createSpritePlan(request.options, probe)
        return {
          sourcePath: source.path,
          outputPath: '',
          valid: true,
          sourceSize,
          format: probe.format,
          width: probe.width,
          height: probe.height,
          outputWidth: plan.sheetWidth,
          outputHeight: plan.sheetHeight,
          duration: probe.duration,
          frameCount: plan.frameCount,
          sheetCount: plan.sheetCount,
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
      if (request.kind === 'pdf') {
        const probe = await probePdf(source.path, new AbortController().signal)
        if (request.pageNumbers?.some((page) => page > probe.pageCount)) {
          throw new Error(`PDF 页面不存在：最多只有 ${probe.pageCount} 页`)
        }
        const outputScale = request.options.dpi / 72
        return {
          sourcePath: source.path,
          outputPath: '',
          valid: true,
          sourceSize,
          format: 'pdf',
          width: probe.width,
          height: probe.height,
          outputWidth:
            request.options.operation === 'toImage'
              ? Math.max(1, Math.round(probe.width * outputScale))
              : probe.width,
          outputHeight:
            request.options.operation === 'toImage'
              ? Math.max(1, Math.round(probe.height * outputScale))
              : probe.height,
          pageCount: probe.pageCount
        }
      }
      if (request.kind === 'font') {
        const probe = await probeFont(source.path, request.options, new AbortController().signal)
        if (request.options.operation === 'variableStatic' && probe.fontInstances.length === 0) {
          throw new Error('字体文件不包含可变字体轴')
        }
        if (
          request.options.operation === 'splitCollection' &&
          request.fontIndexes?.some((index) => index >= probe.fontCount)
        ) {
          throw new Error(`字体编号不存在：最多只有 ${probe.fontCount} 个字体`)
        }
        return {
          sourcePath: source.path,
          outputPath: '',
          valid: true,
          sourceSize,
          format: probe.format,
          fontCount: probe.fontCount,
          fontInstances: probe.fontInstances
        }
      }

      const metadata = await inspectImageMetadata(source.path, sourceSize)
      const { width, height } = metadata
      const outputDimensions = expectedImageDimensions(request.options, width, height)
      return {
        sourcePath: source.path,
        outputPath: '',
        valid: true,
        sourceSize: metadata.sourceSize,
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
    if (!inspection.valid) return inspection
    if (request.kind === 'sprite') {
      const output = resolveSpriteOutput({
        sourcePath: source.path,
        outputDirectory: outputDirectoryFor(request, source),
        imageFormat: request.options.imageFormat,
        sheetCount: inspection.sheetCount ?? 1,
        reservedPaths,
        outputSuffix: request.outputSuffix,
        nameTemplate: request.outputNameTemplate,
        conflictPolicy: request.outputConflictPolicy,
        presetName: request.presetName,
        width: inspection.outputWidth,
        height: inspection.outputHeight
      })
      if (output.directory.skipped) {
        return {
          ...inspection,
          outputPath: output.directory.path,
          outputPaths: [],
          valid: false,
          skipped: true,
          error: '输出文件夹已存在，当前冲突策略为跳过'
        }
      }
      return { ...inspection, outputPath: output.directory.path, outputPaths: output.paths }
    }
    if (request.kind === 'pdf' && request.options.operation === 'toImage') {
      const pageNumbers = request.pageNumbers ?? range(1, inspection.pageCount ?? 0)
      const output = resolvePdfImageOutput({
        sourcePath: source.path,
        outputDirectory: outputDirectoryFor(request, source),
        imageFormat: request.options.imageFormat,
        pageNumbers,
        reservedPaths,
        outputSuffix: request.outputSuffix,
        nameTemplate: request.outputNameTemplate,
        conflictPolicy: request.outputConflictPolicy,
        presetName: request.presetName,
        width: inspection.outputWidth ?? inspection.width,
        height: inspection.outputHeight ?? inspection.height
      })
      if (output.directory.skipped) {
        return {
          ...inspection,
          outputPath: output.directory.path,
          outputPaths: [],
          valid: false,
          skipped: true,
          error: '输出文件夹已存在，当前冲突策略为跳过'
        }
      }
      return {
        ...inspection,
        outputPath: output.directory.path,
        outputPaths: output.paths
      }
    }
    const outputPaths: string[] = []
    const claimedPaths: string[] = []
    const units = inspectionUnits(request, inspection)
    const extension = getOutputExtension(
      request.kind,
      source.path,
      request.kind === 'image' ? request.options.format : undefined,
      request.kind === 'video' ? request.options.format : undefined,
      request.kind === 'audio' ? request.options.format : undefined,
      request.kind === 'pdf' && request.options.operation === 'toImage'
        ? request.options.imageFormat
        : undefined,
      request.kind === 'font'
        ? (source.fontOutputFormat ?? request.options.outputFormat)
        : undefined
    )
    for (const unit of units) {
      const output = resolveOutputPath({
        sourcePath: source.path,
        outputDirectory: outputDirectoryFor(request, source),
        extension,
        reservedPaths,
        outputSuffix: request.outputSuffix,
        nameTemplate: request.outputNameTemplate,
        conflictPolicy: request.outputConflictPolicy,
        presetName: request.presetName,
        width: inspection.outputWidth ?? inspection.width,
        height: inspection.outputHeight ?? inspection.height,
        page: unit.pageNumber,
        index: unit.fontIndex === undefined ? undefined : unit.fontIndex + 1,
        instance: unit.fontInstance?.name
      })
      outputPaths.push(output.path)
      if (!output.skipped) claimedPaths.push(output.path)
      if (output.skipped) {
        for (const path of claimedPaths) reservedPaths.delete(path)
        return {
          ...inspection,
          outputPath: output.path,
          outputPaths,
          valid: false,
          skipped: true,
          error: '输出文件已存在，当前冲突策略为跳过'
        }
      }
    }
    return {
      ...inspection,
      outputPath: outputPaths[0] ?? '',
      outputPaths
    }
  })
}

interface TaskUnit {
  pageNumber?: number
  fontIndex?: number
  fontInstance?: FontInstance
}

function inspectionUnits(request: CreateTasksRequest, inspection: MediaInspection): TaskUnit[] {
  if (request.kind === 'pdf') {
    if (request.options.operation !== 'toImage') return [{}]
    const pages = request.pageNumbers ?? range(1, inspection.pageCount ?? 0)
    return pages.map((pageNumber) => ({ pageNumber }))
  }
  if (request.kind !== 'font') return [{}]
  if (request.options.operation === 'splitCollection') {
    const indexes = request.fontIndexes ?? range(0, (inspection.fontCount ?? 0) - 1)
    return indexes.map((fontIndex) => ({ fontIndex }))
  }
  if (request.options.operation === 'variableStatic') {
    const instances = request.fontInstances ?? inspection.fontInstances ?? []
    return instances.map((fontInstance) => ({ fontInstance }))
  }
  return [{}]
}

function range(start: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index)
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
  const bounds = getVideoResolutionBounds(options)
  if (!width || !height || !bounds) return { width, height }
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
