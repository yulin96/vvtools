import { randomUUID } from 'crypto'
import { mkdirSync, rmSync, statSync } from 'fs'
import { basename, dirname, join } from 'path'
import { EventEmitter } from 'events'
import type {
  AudioOptions,
  CreateTasksRequest,
  FontOptions,
  ImageOptions,
  MediaTask,
  TaskProgressUpdate,
  TaskSnapshot,
  TaskStateUpdate,
  PdfOptions,
  TaskConcurrencyLimits,
  TaskFailure,
  SpriteOptions,
  VideoOptions
} from '../../shared/types'
import { FailureLogService } from './failure-log'
import { MediaProcessError, TaskCancelledError, TaskSkippedError } from '../media/errors'
import { getProtectedSourcePaths, outputContainsSourcePath } from '../media/output-path'
import { commitStagedOutput, createStagingOutputPath } from '../media/output-commit'
import {
  planSourceOutputs,
  taskOutputDirectory,
  taskSources,
  type TaskSource
} from '../media/task-plan'

export type TaskRunner = (
  task: MediaTask,
  signal: AbortSignal,
  onProgress: (progress: number) => void
) => Promise<number>

export class TaskQueue extends EventEmitter {
  private readonly tasks = new Map<string, MediaTask>()
  private readonly running = new Map<string, AbortController>()
  private readonly reservedPaths = new Set<string>()
  private readonly lastProgressNotifications = new Map<string, { at: number; progress: number }>()
  private notificationSequence = 0

  constructor(
    private concurrency: TaskConcurrencyLimits,
    private readonly runner: TaskRunner,
    private readonly failureLogs: FailureLogService,
    private readonly moveToTrash: (path: string) => Promise<void> = async () => {
      throw new Error('回收站处理器不可用')
    }
  ) {
    super()
  }

  list(): MediaTask[] {
    return structuredClone([...this.tasks.values()])
  }

  snapshot(): TaskSnapshot {
    return { sequence: this.notificationSequence, tasks: this.list() }
  }

  activeCount(): number {
    let count = 0
    for (const task of this.tasks.values()) {
      if (task.status === 'pending' || task.status === 'processing') count += 1
    }
    return count
  }

  clearSettledBatch(kind: MediaTask['kind']): void {
    const ids = this.settledBatchTaskIds(kind)
    if (!ids.length) return
    for (const id of ids) this.tasks.delete(id)
    this.changed([], ids)
  }

  create(request: CreateTasksRequest, desktopRequestId?: string): MediaTask[] {
    return this.createInternal(request, true, desktopRequestId)
  }

  private createInternal(
    request: CreateTasksRequest,
    replaceSettledBatch: boolean,
    desktopRequestId?: string
  ): MediaTask[] {
    const discardedTaskIds = replaceSettledBatch ? this.settledBatchTaskIds(request.kind) : []
    const stagedTasks = new Map<string, MediaTask>()
    const stagedReservedPaths = new Set(this.reservedPaths)
    for (const taskId of discardedTaskIds) {
      const task = this.tasks.get(taskId)
      if (task) stagedReservedPaths.delete(task.outputPath)
    }
    const sources = taskSources(request)
    const metadata = new Map(request.inputMetadata?.map((item) => [item.path, item]))
    const activeTasks = [...this.tasks.values()].filter(
      (task) => task.status === 'pending' || task.status === 'processing'
    )
    const blockedSource = sources.find((source) =>
      activeTasks.some(
        (task) =>
          task.outputConflictPolicy === 'overwrite' &&
          outputContainsSourcePath(task.outputPath, source.path)
      )
    )
    if (blockedSource) {
      throw new Error(`源文件正在被其他任务覆盖，暂时无法提交：${blockedSource.path}`)
    }
    const activeSourcePaths = new Set(activeTasks.map((task) => task.sourcePath))
    const sourcePaths = sources.map((source) => source.path)
    const created = sources.flatMap((source, sourceIndex) => {
      const sourcePath = source.path
      const sourceMetadata = metadata.get(sourcePath)
      const protectedSourcePaths = getProtectedSourcePaths(
        sourcePaths,
        sourceIndex,
        activeSourcePaths
      )
      mkdirSync(taskOutputDirectory(request, source), { recursive: true })
      const plan = planSourceOutputs(
        request,
        source,
        sourceMetadata,
        stagedReservedPaths,
        protectedSourcePaths
      )
      return plan.units.map((unit, unitIndex) => {
        const task: MediaTask = {
          ...(desktopRequestId ? { desktopRequestId } : {}),
          id: randomUUID(),
          kind: request.kind,
          batchInputId: source.batchItemId,
          batchItemId:
            source.batchItemId === undefined
              ? undefined
              : plan.units.length === 1
                ? source.batchItemId
                : `${source.batchItemId}:${unitIndex + 1}`,
          sourcePath,
          ...(request.kind === 'sprite'
            ? {
                frameCount: sourceMetadata?.frameCount,
                sourceFrameCount: sourceMetadata?.sourceFrameCount
              }
            : { relativeDirectory: source.relativeDirectory }),
          ...unit,
          fontInstance: unit.fontInstance ? structuredClone(unit.fontInstance) : undefined,
          status: 'pending',
          progress: 0,
          options:
            request.kind === 'font'
              ? fontOptionsForSource(request.options, source)
              : request.kind === 'image' && source.outputFormat
                ? { ...structuredClone(request.options), format: source.outputFormat }
                : structuredClone(request.options),
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
        stagedReservedPaths.add(task.outputPath)
        return structuredClone(task)
      })
    })
    for (const taskId of discardedTaskIds) this.tasks.delete(taskId)
    for (const task of stagedTasks.values()) this.tasks.set(task.id, task)
    this.reservedPaths.clear()
    for (const path of stagedReservedPaths) this.reservedPaths.add(path)
    this.changed([...stagedTasks.values()], discardedTaskIds)
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
      this.changed([task])
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
        : original.kind === 'sprite'
          ? {
              kind: 'sprite',
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
                  sheetCount: original.outputPaths?.length ?? 1,
                  frameCount: original.frameCount,
                  sourceFrameCount: original.sourceFrameCount
                }
              ],
              options: structuredClone(original.options) as SpriteOptions
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
                    fontIndexes:
                      original.fontIndex === undefined ? undefined : [original.fontIndex],
                    fontInstances: original.fontInstance ? [original.fontInstance] : undefined,
                    options: structuredClone(original.options) as FontOptions
                  }
    if (original.batchItemId) request.batchItemIds = [original.batchItemId]
    const task = this.createInternal(request, false, original.desktopRequestId)[0]
    if (!task) return null
    const stored = this.tasks.get(task.id)
    if (stored) {
      stored.retryOf = original.id
      stored.batchInputId = original.batchInputId
      stored.batchItemId = original.batchItemId
    }
    if (stored) this.changed([stored])
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
    this.changed([task])

    try {
      const outputSize = await this.runner(processingTask, controller.signal, (progress) => {
        task.progress = progress
        this.progressChanged(task)
      })
      if (controller.signal.aborted) throw new TaskCancelledError()
      await commitStagedOutput(
        stagingPath,
        task.outputPath,
        task.outputConflictPolicy === 'overwrite',
        this.moveToTrash
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
      this.changed([task])
      this.dispatch()
    }
  }

  private changed(tasks: MediaTask[], removedTaskIds: string[] = []): void {
    const update: TaskStateUpdate = {
      sequence: ++this.notificationSequence,
      tasks: structuredClone(tasks),
      removedTaskIds: [...removedTaskIds]
    }
    this.emit('changed', update)
  }

  private progressChanged(task: MediaTask): void {
    if (typeof task.progress !== 'number') return
    const progress = Math.min(100, Math.max(0, Math.round(task.progress)))
    task.progress = progress
    const now = Date.now()
    const previous = this.lastProgressNotifications.get(task.id)
    if (previous?.progress === progress || (previous && now - previous.at < 150)) return
    this.lastProgressNotifications.set(task.id, { at: now, progress })
    const update: TaskProgressUpdate = {
      sequence: ++this.notificationSequence,
      id: task.id,
      progress
    }
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
