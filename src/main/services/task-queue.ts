import { randomUUID } from 'crypto'
import { mkdirSync, rmSync, statSync } from 'fs'
import { basename, dirname, join } from 'path'
import { EventEmitter } from 'events'
import type {
  AudioOptions,
  CreateTasksRequest,
  FontFormat,
  FontConversionSubsetPreset,
  FontInstance,
  FontOptions,
  ImageOptions,
  MediaInputMetadata,
  MediaTask,
  TaskProgressUpdate,
  PdfOptions,
  TaskConcurrencyLimits,
  TaskFailure,
  VideoOptions
} from '../../shared/types'
import { FailureLogService } from './failure-log'
import { MediaProcessError, TaskCancelledError, TaskSkippedError } from '../media/errors'
import { getOutputExtension, resolveOutputPath, resolvePdfImageOutput } from '../media/output-path'
import { commitStagedOutput, createStagingOutputPath } from '../media/output-commit'

export type TaskRunner = (
  task: MediaTask,
  signal: AbortSignal,
  onProgress: (progress: number) => void
) => Promise<number>

interface TaskUnit {
  pageNumber?: number
  fontIndex?: number
  fontInstance?: FontInstance
}

interface TaskSource {
  path: string
  relativeDirectory: string
  fontOutputFormat?: FontFormat
  fontSubsetPreset?: FontConversionSubsetPreset
}

export class TaskQueue extends EventEmitter {
  private readonly tasks = new Map<string, MediaTask>()
  private readonly running = new Map<string, AbortController>()
  private readonly reservedPaths = new Set<string>()
  private readonly lastProgressNotifications = new Map<string, { at: number; progress: number }>()

  constructor(
    private concurrency: TaskConcurrencyLimits,
    private readonly runner: TaskRunner,
    private readonly failureLogs: FailureLogService
  ) {
    super()
  }

  list(): MediaTask[] {
    return structuredClone([...this.tasks.values()])
  }

  create(request: CreateTasksRequest): MediaTask[] {
    return this.createInternal(request, true)
  }

  private createInternal(request: CreateTasksRequest, replaceSettledBatch: boolean): MediaTask[] {
    const discardedTaskIds = replaceSettledBatch ? this.settledBatchTaskIds(request.kind) : []
    const stagedTasks = new Map<string, MediaTask>()
    const stagedReservedPaths = new Set(this.reservedPaths)
    for (const taskId of discardedTaskIds) {
      const task = this.tasks.get(taskId)
      if (task) stagedReservedPaths.delete(task.outputPath)
    }
    const sources: TaskSource[] =
      request.kind === 'image'
        ? request.sources
        : request.kind === 'font'
          ? request.sources.map((source) => ({
              path: source.path,
              relativeDirectory: '',
              fontOutputFormat: source.outputFormat,
              fontSubsetPreset: source.subsetPreset
            }))
          : request.sourcePaths.map((path) => ({ path, relativeDirectory: '' }))
    const metadata = new Map(request.inputMetadata?.map((item) => [item.path, item]))
    const created = sources.flatMap((source) => {
      const sourcePath = source.path
      const sourceMetadata = metadata.get(sourcePath)
      const outputDirectory =
        request.outputMode === 'source'
          ? dirname(sourcePath)
          : request.kind === 'image' &&
              request.options.preserveStructure &&
              source.relativeDirectory
            ? join(request.outputDirectory, source.relativeDirectory)
            : request.outputDirectory
      if (request.kind === 'pdf' && request.options.operation === 'toImage') {
        mkdirSync(outputDirectory, { recursive: true })
        const pageNumbers = pdfPageNumbers(request, sourceMetadata)
        const output = resolvePdfImageOutput({
          sourcePath,
          outputDirectory,
          imageFormat: request.options.imageFormat,
          pageNumbers,
          reservedPaths: stagedReservedPaths,
          outputSuffix: request.outputSuffix,
          nameTemplate: request.outputNameTemplate,
          conflictPolicy: request.outputConflictPolicy,
          presetName: request.presetName,
          width: sourceMetadata?.width,
          height: sourceMetadata?.height
        })
        if (output.directory.skipped) return []
        const task: MediaTask = {
          id: randomUUID(),
          kind: 'pdf',
          sourcePath,
          outputPath: output.directory.path,
          outputPaths: output.paths,
          pageNumbers,
          status: 'pending',
          progress: 0,
          options: structuredClone(request.options),
          outputSuffix: request.outputSuffix,
          outputNameTemplate: request.outputNameTemplate,
          outputConflictPolicy: request.outputConflictPolicy,
          presetName: request.presetName,
          sourceWidth: sourceMetadata?.width,
          sourceHeight: sourceMetadata?.height,
          sourceSize: statSync(sourcePath).size,
          createdAt: new Date().toISOString()
        }
        stagedTasks.set(task.id, task)
        return [structuredClone(task)]
      }
      const units = expandTaskUnits(request, sourceMetadata)
      const sourceTaskIds: string[] = []
      const sourceReservedPaths: string[] = []
      let skippedSource = false
      const sourceCreated = units.flatMap((unit) => {
        mkdirSync(outputDirectory, { recursive: true })
        const extension = getOutputExtension(
          request.kind,
          sourcePath,
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
        const output = resolveOutputPath({
          sourcePath,
          outputDirectory,
          extension,
          reservedPaths: stagedReservedPaths,
          outputSuffix: request.outputSuffix,
          nameTemplate: request.outputNameTemplate,
          conflictPolicy: request.outputConflictPolicy,
          presetName: request.presetName,
          width: sourceMetadata?.width,
          height: sourceMetadata?.height,
          page: unit.pageNumber,
          index: unit.fontIndex === undefined ? undefined : unit.fontIndex + 1,
          instance: unit.fontInstance?.name
        })
        if (output.skipped) {
          skippedSource = true
          for (const taskId of sourceTaskIds) stagedTasks.delete(taskId)
          for (const path of sourceReservedPaths) stagedReservedPaths.delete(path)
          return []
        }
        const task: MediaTask = {
          id: randomUUID(),
          kind: request.kind,
          sourcePath,
          outputPath: output.path,
          status: 'pending',
          progress: 0,
          options:
            request.kind === 'font'
              ? fontOptionsForSource(request.options, source)
              : structuredClone(request.options),
          outputSuffix: request.outputSuffix,
          outputNameTemplate: request.outputNameTemplate,
          outputConflictPolicy: request.outputConflictPolicy,
          presetName: request.presetName,
          sourceWidth: sourceMetadata?.width,
          sourceHeight: sourceMetadata?.height,
          pageNumber: unit.pageNumber,
          fontIndex: unit.fontIndex,
          fontInstance: unit.fontInstance ? structuredClone(unit.fontInstance) : undefined,
          sourceSize: statSync(sourcePath).size,
          createdAt: new Date().toISOString()
        }
        stagedTasks.set(task.id, task)
        sourceTaskIds.push(task.id)
        sourceReservedPaths.push(output.path)
        return [structuredClone(task)]
      })
      return skippedSource ? [] : sourceCreated
    })
    for (const taskId of discardedTaskIds) this.tasks.delete(taskId)
    for (const task of stagedTasks.values()) this.tasks.set(task.id, task)
    this.reservedPaths.clear()
    for (const path of stagedReservedPaths) this.reservedPaths.add(path)
    this.changed()
    this.dispatch()
    return created.flatMap((createdTask) => {
      const latest = stagedTasks.get(createdTask.id)
      return latest ? [structuredClone(latest)] : []
    })
  }

  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task || !['pending', 'processing'].includes(task.status)) return false
    if (task.status === 'pending') {
      task.status = 'cancelled'
      task.completedAt = new Date().toISOString()
      this.reservedPaths.delete(task.outputPath)
      this.changed()
      this.dispatch()
      return true
    }
    this.running.get(taskId)?.abort()
    return true
  }

  retry(taskId: string): MediaTask | null {
    const original = this.tasks.get(taskId)
    if (!original || original.status !== 'failed') return null
    const request: CreateTasksRequest =
      original.kind === 'video'
        ? {
            kind: 'video',
            sourcePaths: [original.sourcePath],
            outputMode: 'custom',
            outputDirectory: dirname(original.outputPath),
            outputSuffix: original.outputSuffix ?? '',
            outputNameTemplate: original.outputNameTemplate,
            outputConflictPolicy: original.outputConflictPolicy,
            presetName: original.presetName,
            inputMetadata: [
              {
                path: original.sourcePath,
                width: original.sourceWidth,
                height: original.sourceHeight
              }
            ],
            options: structuredClone(original.options) as VideoOptions
          }
        : original.kind === 'image'
          ? {
              kind: 'image',
              sources: [{ path: original.sourcePath, relativeDirectory: '' }],
              outputMode: 'custom',
              outputDirectory: dirname(original.outputPath),
              outputSuffix: original.outputSuffix ?? '',
              outputNameTemplate: original.outputNameTemplate,
              outputConflictPolicy: original.outputConflictPolicy,
              presetName: original.presetName,
              inputMetadata: [
                {
                  path: original.sourcePath,
                  width: original.sourceWidth,
                  height: original.sourceHeight
                }
              ],
              options: structuredClone(original.options) as ImageOptions
            }
          : original.kind === 'audio'
            ? {
                kind: 'audio',
                sourcePaths: [original.sourcePath],
                outputMode: 'custom',
                outputDirectory: dirname(original.outputPath),
                outputSuffix: original.outputSuffix ?? '',
                outputNameTemplate: original.outputNameTemplate,
                outputConflictPolicy: original.outputConflictPolicy,
                presetName: original.presetName,
                options: structuredClone(original.options) as AudioOptions
              }
            : original.kind === 'pdf'
              ? {
                  kind: 'pdf',
                  sourcePaths: [original.sourcePath],
                  outputMode: 'custom',
                  outputDirectory: dirname(original.outputPath),
                  outputSuffix: original.outputSuffix ?? '',
                  outputNameTemplate: original.outputNameTemplate,
                  outputConflictPolicy: original.outputConflictPolicy,
                  presetName: original.presetName,
                  inputMetadata: [
                    {
                      path: original.sourcePath,
                      width: original.sourceWidth,
                      height: original.sourceHeight,
                      pageCount:
                        original.pageNumbers?.length && original.pageNumbers.length > 0
                          ? Math.max(...original.pageNumbers)
                          : (original.pageNumber ?? 1)
                    }
                  ],
                  pageNumbers:
                    original.pageNumbers ??
                    (original.pageNumber === undefined ? undefined : [original.pageNumber]),
                  options: structuredClone(original.options) as PdfOptions
                }
              : {
                  kind: 'font',
                  sources: [
                    {
                      path: original.sourcePath,
                      outputFormat: (original.options as FontOptions).outputFormat
                    }
                  ],
                  outputMode: 'custom',
                  outputDirectory: dirname(original.outputPath),
                  outputSuffix: original.outputSuffix ?? '',
                  outputNameTemplate: original.outputNameTemplate,
                  outputConflictPolicy: original.outputConflictPolicy,
                  presetName: original.presetName,
                  inputMetadata: [
                    {
                      path: original.sourcePath,
                      fontCount: original.fontIndex === undefined ? 1 : original.fontIndex + 1,
                      fontInstances: original.fontInstance ? [original.fontInstance] : undefined
                    }
                  ],
                  fontIndexes: original.fontIndex === undefined ? undefined : [original.fontIndex],
                  fontInstances: original.fontInstance ? [original.fontInstance] : undefined,
                  options: structuredClone(original.options) as FontOptions
                }
    const task = this.createInternal(request, false)[0]
    if (!task) return null
    const stored = this.tasks.get(task.id)
    if (stored) stored.retryOf = original.id
    this.changed()
    return stored ? structuredClone(stored) : null
  }

  setConcurrency(value: TaskConcurrencyLimits): void {
    this.concurrency = structuredClone(value)
    this.dispatch()
  }

  shutdown(): void {
    for (const controller of this.running.values()) controller.abort()
  }

  private dispatch(): void {
    while (true) {
      const task = [...this.tasks.values()].find(
        (item) =>
          item.status === 'pending' && this.runningCount(item.kind) < this.concurrency[item.kind]
      )
      if (!task) return
      void this.run(task)
    }
  }

  private runningCount(kind: MediaTask['kind']): number {
    let count = 0
    for (const taskId of this.running.keys()) {
      if (this.tasks.get(taskId)?.kind === kind) count += 1
    }
    return count
  }

  private async run(task: MediaTask): Promise<void> {
    const controller = new AbortController()
    const stagingPath = createStagingOutputPath(task.outputPath, task.id)
    const processingTask = structuredClone(task)
    processingTask.outputPath = stagingPath
    if (task.outputPaths?.length) {
      processingTask.outputPaths = task.outputPaths.map((path) => join(stagingPath, basename(path)))
    }
    this.running.set(task.id, controller)
    task.status = 'processing'
    task.progress = 0
    task.startedAt = new Date().toISOString()
    this.changed()

    try {
      const outputSize = await this.runner(processingTask, controller.signal, (progress) => {
        task.progress = progress
        this.progressChanged(task)
      })
      if (controller.signal.aborted) throw new TaskCancelledError()
      commitStagedOutput(
        stagingPath,
        task.outputPath,
        !task.outputPaths?.length && task.outputConflictPolicy === 'overwrite'
      )
      task.outputSize = outputSize
      task.status = 'completed'
      task.progress = 100
    } catch (error) {
      if (error instanceof TaskSkippedError) {
        task.status = 'skipped'
        task.progress = 100
        task.outputSize = error.outputSize
        task.skippedReason = error.message
      } else if (error instanceof TaskCancelledError || controller.signal.aborted) {
        task.status = 'cancelled'
        task.progress = null
      } else {
        task.status = 'failed'
        const failure: TaskFailure =
          error instanceof MediaProcessError
            ? { message: error.message, ...error.details }
            : { message: error instanceof Error ? error.message : String(error) }
        failure.logPath = this.failureLogs.writeFailure(task, failure)
        task.failure = failure
      }
    } finally {
      rmSync(stagingPath, { recursive: true, force: true })
      task.completedAt = new Date().toISOString()
      this.running.delete(task.id)
      this.lastProgressNotifications.delete(task.id)
      this.reservedPaths.delete(task.outputPath)
      this.changed()
      this.dispatch()
    }
  }

  private changed(): void {
    this.emit('changed', this.list())
  }

  private progressChanged(task: MediaTask): void {
    if (typeof task.progress !== 'number') return
    const progress = Math.min(100, Math.max(0, Math.round(task.progress)))
    task.progress = progress
    const now = Date.now()
    const previous = this.lastProgressNotifications.get(task.id)
    if (previous?.progress === progress || (previous && now - previous.at < 150)) return
    this.lastProgressNotifications.set(task.id, { at: now, progress })
    const update: TaskProgressUpdate = { id: task.id, progress }
    this.emit('progress', update)
  }

  private settledBatchTaskIds(kind: MediaTask['kind']): string[] {
    const hasActiveBatch = [...this.tasks.values()].some(
      (task) => task.kind === kind && (task.status === 'pending' || task.status === 'processing')
    )
    if (hasActiveBatch) return []
    return [...this.tasks.entries()].flatMap(([taskId, task]) =>
      task.kind === kind ? [taskId] : []
    )
  }
}

function expandTaskUnits(
  request: CreateTasksRequest,
  metadata: MediaInputMetadata | undefined
): TaskUnit[] {
  if (request.kind === 'pdf') {
    if (request.options.operation !== 'toImage') return [{}]
    const pages =
      request.pageNumbers ?? (metadata?.pageCount ? range(1, metadata.pageCount) : undefined)
    if (!pages || pages.length === 0) throw new Error('无法确定 PDF 页面数量，请重新检查文件')
    return pages.map((pageNumber) => ({ pageNumber }))
  }
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
  metadata: MediaInputMetadata | undefined
): number[] {
  const pages =
    request.pageNumbers ?? (metadata?.pageCount ? range(1, metadata.pageCount) : undefined)
  if (!pages || pages.length === 0) throw new Error('无法确定 PDF 页面数量，请重新检查文件')
  return pages
}

function range(start: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index)
}

function fontOptionsForSource(options: FontOptions, source: TaskSource): FontOptions {
  const result = {
    ...structuredClone(options),
    outputFormat: source.fontOutputFormat ?? options.outputFormat
  }
  const preset = source.fontSubsetPreset
  if (!preset || preset === 'none' || options.operation !== 'convert') return result
  return {
    ...result,
    operation: 'subset',
    subsetMode: preset === 'latin' ? 'latin' : 'chinese',
    subsetChineseLevel: preset === 'latin' ? result.subsetChineseLevel : preset,
    subsetIncludeLatin: true,
    subsetExtraText: '',
    subsetText: '',
    subsetTextFile: ''
  }
}
