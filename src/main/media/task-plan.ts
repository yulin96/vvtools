import { dirname, join } from 'path'
import type {
  CreateTasksRequest,
  FontConversionSubsetPreset,
  FontFormat,
  FontInstance,
  MediaInputMetadata
} from '../../shared/types'
import {
  getOutputExtension,
  resolveOutputPath,
  resolvePdfImageOutput,
  resolveSpriteOutput,
  type ResolvedPdfImageOutput
} from './output-path'

export interface TaskSource {
  path: string
  relativeDirectory: string
  batchItemId?: string
  fontOutputFormat?: FontFormat
  fontSubsetPreset?: FontConversionSubsetPreset
}

interface TaskUnit {
  fontIndex?: number
  fontInstance?: FontInstance
}

export interface PlannedTaskOutput extends TaskUnit {
  outputPath: string
  outputPaths?: string[]
  pageNumbers?: number[]
}

interface SourceOutputPlan {
  outputPath: string
  outputPaths: string[]
  units: PlannedTaskOutput[]
  skipped: boolean
  skippedReason?: string
}

export function taskSources(request: CreateTasksRequest): TaskSource[] {
  if (request.kind === 'image') {
    return request.sources.map((source, index) => ({
      ...source,
      batchItemId: request.batchItemIds?.[index]
    }))
  }
  if (request.kind === 'font') {
    return request.sources.map((source, index) => ({
      path: source.path,
      relativeDirectory: '',
      batchItemId: request.batchItemIds?.[index],
      fontOutputFormat: source.outputFormat,
      fontSubsetPreset: source.subsetPreset
    }))
  }
  return request.sourcePaths.map((path, index) => ({
    path,
    relativeDirectory: '',
    batchItemId: request.batchItemIds?.[index]
  }))
}

export function taskOutputDirectory(request: CreateTasksRequest, source: TaskSource): string {
  if (request.outputMode === 'source') return dirname(source.path)
  if (request.kind === 'image' && request.options.preserveStructure && source.relativeDirectory) {
    return join(request.outputDirectory, source.relativeDirectory)
  }
  return request.outputDirectory
}

export function planSourceOutputs(
  request: CreateTasksRequest,
  source: TaskSource,
  metadata: Omit<MediaInputMetadata, 'path'> | undefined,
  existingReservedPaths: ReadonlySet<string>,
  protectedSourcePaths: ReadonlySet<string>
): SourceOutputPlan {
  const reservedPaths = new Set(existingReservedPaths)
  const outputOptions = {
    sourcePath: source.path,
    outputDirectory: taskOutputDirectory(request, source),
    reservedPaths,
    protectedSourcePaths,
    outputSuffix: request.outputSuffix,
    nameTemplate: request.outputNameTemplate,
    conflictPolicy: request.outputConflictPolicy,
    presetName: request.presetName,
    width: metadata?.width,
    height: metadata?.height
  }
  if (
    request.kind === 'sprite' ||
    (request.kind === 'pdf' && request.options.operation === 'toImage')
  ) {
    let output: ResolvedPdfImageOutput
    let pageNumbers: number[] | undefined
    if (request.kind === 'sprite') {
      output = resolveSpriteOutput({
        ...outputOptions,
        imageFormat: request.options.imageFormat,
        sheetCount: metadata?.sheetCount ?? 1
      })
    } else {
      pageNumbers = pdfPageNumbers(request, metadata)
      output = resolvePdfImageOutput({
        ...outputOptions,
        imageFormat: request.options.imageFormat,
        pageNumbers
      })
    }
    return {
      outputPath: output.directory.path,
      outputPaths: output.paths,
      units: output.directory.skipped
        ? []
        : [
            {
              outputPath: output.directory.path,
              outputPaths: output.paths,
              ...(pageNumbers ? { pageNumbers } : {})
            }
          ],
      skipped: output.directory.skipped,
      skippedReason: output.directory.skipped ? '输出文件夹已存在，当前冲突策略为跳过' : undefined
    }
  }

  const extension = getOutputExtension(
    request.kind,
    source.path,
    request.kind === 'image' ? request.options.format : undefined,
    request.kind === 'video' ? request.options.format : undefined,
    request.kind === 'audio' ? request.options.format : undefined,
    undefined,
    request.kind === 'font' ? (source.fontOutputFormat ?? request.options.outputFormat) : undefined
  )
  const units: PlannedTaskOutput[] = []
  for (const unit of expandTaskUnits(request, metadata)) {
    const output = resolveOutputPath({
      ...outputOptions,
      extension,
      index: unit.fontIndex === undefined ? undefined : unit.fontIndex + 1,
      instance: unit.fontInstance?.name
    })
    if (output.skipped) {
      return {
        outputPath: output.path,
        outputPaths: [...units.map((item) => item.outputPath), output.path],
        units: [],
        skipped: true,
        skippedReason: '输出文件已存在，当前冲突策略为跳过'
      }
    }
    units.push({ ...unit, outputPath: output.path })
  }
  const outputPaths = units.map((unit) => unit.outputPath)
  return { outputPath: outputPaths[0] ?? '', outputPaths, units, skipped: false }
}

function expandTaskUnits(
  request: CreateTasksRequest,
  metadata: Omit<MediaInputMetadata, 'path'> | undefined
): TaskUnit[] {
  if (request.kind !== 'font') return [{}]
  if (request.options.operation === 'splitCollection') {
    const indexes =
      request.fontIndexes ?? (metadata?.fontCount ? range(0, metadata.fontCount - 1) : undefined)
    if (!indexes || indexes.length === 0) throw new Error('无法确定字体集合数量，请重新检查文件')
    return indexes.map((fontIndex) => ({ fontIndex }))
  }
  if (request.options.operation === 'variableStatic') {
    const instances = request.fontInstances ?? metadata?.fontInstances
    if (!instances || instances.length === 0)
      throw new Error('无法确定可变字体实例，请重新检查文件')
    return instances.map((fontInstance) => ({ fontInstance }))
  }
  return [{}]
}

function pdfPageNumbers(
  request: Extract<CreateTasksRequest, { kind: 'pdf' }>,
  metadata: Omit<MediaInputMetadata, 'path'> | undefined
): number[] {
  const pages =
    request.pageNumbers ?? (metadata?.pageCount ? range(1, metadata.pageCount) : undefined)
  if (!pages || pages.length === 0) throw new Error('无法确定 PDF 页面数量，请重新检查文件')
  return pages
}

function range(start: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index)
}
