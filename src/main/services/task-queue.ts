import { isReplaceableOutputDirectory, markOutputDirectory } from '../media/output-directory'
import { randomUUID } from 'crypto'
import { lstatSync, mkdirSync, rmSync, statSync } from 'fs'
import { basename, dirname, join } from 'path'
import { EventEmitter } from 'events'
import { TASK_KINDS } from '../../shared/types'
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
import { taskResources, type TaskResourceBudget, type TaskResources } from './task-resources'
import { MediaProcessError, TaskCancelledError, TaskSkippedError } from '../media/errors'
import {
  getProtectedSourcePaths,
  outputContainsSourcePath,
  resolveOutputPath
} from '../media/output-path'
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
  private readonly batchSources = new WeakMap<MediaTask, string[]>()
  private stopping = false
  private notificationSequence = 0
  private readonly resources = new Map<string, TaskResources>()
  private nextResourceKind = 0

  constructor(
    private concurrency: TaskConcurrencyLimits,
    private readonly runner: TaskRunner,
    private readonly failureLogs: FailureLogService,
    private readonly moveToTrash: (path: string) => Promise<void> = async () => {
      throw new Error('回收站处理器不可用')
    },
    private readonly resourceBudget?: TaskResourceBudget
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
    const previous = request.continueBatchTaskId
      ? this.tasks.get(request.continueBatchTaskId)
      : undefined
    return this.createInternal(request, previous?.kind !== request.kind, desktopRequestId)
  }

  private createInternal(
    request: CreateTasksRequest,
    replaceSettledBatch: boolean,
    desktopRequestId?: string,
    retryOf?: MediaTask
  ): MediaTask[] {
    if (this.stopping) throw new Error('应用正在退出，无法提交任务')
    const discardedTaskIds = replaceSettledBatch ? this.settledBatchTaskIds(request.kind) : []
    const stagedTasks = new Map<string, MediaTask>()
    const stagedReservedPaths = new Set(this.reservedPaths)
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
    const sourcePaths = [
      ...sources.map((source) => source.path),
      ...(request.excludedSourcePaths ?? [])
    ]
    if (request.continueBatchTaskId) {
      const selected = new Set(sourcePaths)
      for (const task of this.tasks.values()) {
        if (task.kind === request.kind && !selected.has(task.sourcePath)) {
          sourcePaths.push(task.sourcePath)
          selected.add(task.sourcePath)
        }
      }
    }
    sources.forEach((source, sourceIndex) => {
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
      const sourceSize = plan.units.length ? statSync(sourcePath).size : 0
      plan.units.forEach((unit, unitIndex) => {
        const task: MediaTask = {
          ...(desktopRequestId ? { desktopRequestId } : {}),
          id: randomUUID(),
          kind: request.kind,
          retryOf: retryOf?.id,
          batchInputId: retryOf?.batchInputId ?? source.batchItemId,
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
            : { relativeDirectory: retryOf?.relativeDirectory ?? source.relativeDirectory }),
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
          inputWidth: sourceMetadata?.inputWidth,
          inputHeight: sourceMetadata?.inputHeight,
          sourceSize,
          createdAt: new Date().toISOString()
        }
        stagedTasks.set(task.id, task)
        stagedReservedPaths.add(task.outputPath)
        if (sourcePaths.length > 1 && request.outputConflictPolicy === 'overwrite')
          this.batchSources.set(task, sourcePaths)
      })
    })
    if (!stagedTasks.size) return []
    for (const taskId of discardedTaskIds) this.tasks.delete(taskId)
    for (const task of stagedTasks.values()) this.tasks.set(task.id, task)
    this.reservedPaths.clear()
    for (const path of stagedReservedPaths) this.reservedPaths.add(path)
    this.changed([...stagedTasks.values()], discardedTaskIds)
    this.dispatch()
    return structuredClone([...stagedTasks.values()])
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
    const dimensions = {
      path: original.sourcePath,
      width: original.sourceWidth,
      height: original.sourceHeight,
      inputWidth: original.inputWidth,
      inputHeight: original.inputHeight
    }
    const common = {
      outputMode: 'custom' as const,
      outputDirectory: dirname(original.outputPath),
      outputSuffix: original.outputSuffix ?? '',
      outputNameTemplate: original.outputNameTemplate,
      outputConflictPolicy: original.outputConflictPolicy,
      presetName: original.presetName
    }
    const sourcePaths = [original.sourcePath]
    let request: CreateTasksRequest
    switch (original.kind) {
      case 'image':
        request = {
          ...common,
          kind: 'image',
          sources: [{ path: original.sourcePath, relativeDirectory: '' }],
          inputMetadata: [dimensions],
          options: original.options as ImageOptions
        }
        break
      case 'video':
        request = {
          ...common,
          kind: 'video',
          sourcePaths,
          inputMetadata: [dimensions],
          options: original.options as VideoOptions
        }
        break
      case 'audio':
        request = {
          ...common,
          kind: 'audio',
          sourcePaths,
          options: original.options as AudioOptions
        }
        break
      case 'sprite':
        request = {
          ...common,
          kind: 'sprite',
          sourcePaths,
          inputMetadata: [
            {
              ...dimensions,
              sheetCount: original.outputPaths?.length ?? 1,
              frameCount: original.frameCount,
              sourceFrameCount: original.sourceFrameCount
            }
          ],
          options: original.options as SpriteOptions
        }
        break
      case 'pdf': {
        const pages =
          original.pageNumbers ??
          (original.pageNumber === undefined ? undefined : [original.pageNumber])
        request = {
          ...common,
          kind: 'pdf',
          sourcePaths,
          pageNumbers: pages,
          inputMetadata: [
            { ...dimensions, pageCount: pages?.reduce((max, page) => Math.max(max, page), 1) ?? 1 }
          ],
          options: original.options as PdfOptions
        }
        break
      }
      case 'font': {
        const options = original.options as FontOptions
        const fontInstances = original.fontInstance ? [original.fontInstance] : undefined
        request = {
          ...common,
          kind: 'font',
          sources: [{ path: original.sourcePath, outputFormat: options.outputFormat }],
          inputMetadata: [
            { path: original.sourcePath, fontCount: (original.fontIndex ?? 0) + 1, fontInstances }
          ],
          fontIndexes: original.fontIndex === undefined ? undefined : [original.fontIndex],
          fontInstances,
          options
        }
        break
      }
    }
    if (original.batchItemId) request.batchItemIds = [original.batchItemId]
    const batchSources = this.batchSources.get(original)
    if (batchSources) {
      const index = batchSources.indexOf(original.sourcePath)
      request.excludedSourcePaths = batchSources.filter((_, i) => i !== index)
    }
    return this.createInternal(request, false, original.desktopRequestId, original)[0] ?? null
  }

  setConcurrency(value: TaskConcurrencyLimits): void {
    this.concurrency = structuredClone(value)
    this.dispatch()
  }

  shutdown(): void {
    this.stopping = true
    for (const task of this.tasks.values()) {
      if (task.status === 'pending') this.cancel(task.id)
    }
    for (const controller of this.running.values()) controller.abort()
  }

  private dispatch(): void {
    while (!this.stopping) {
      const running = new Map<MediaTask['kind'], number>()
      for (const id of this.running.keys()) {
        const kind = this.tasks.get(id)!.kind
        running.set(kind, (running.get(kind) ?? 0) + 1)
      }
      const next = new Map<MediaTask['kind'], MediaTask>()
      const pending = new Map<MediaTask['kind'], number>()
      for (const task of this.tasks.values()) {
        if (
          task.status !== 'pending' ||
          (running.get(task.kind) ?? 0) >= this.concurrency[task.kind]
        )
          continue
        if (!next.has(task.kind)) next.set(task.kind, task)
        pending.set(task.kind, (pending.get(task.kind) ?? 0) + 1)
      }
      const first = next.values().next().value
      if (!first) return
      if (!this.resourceBudget) {
        void this.run(first)
        continue
      }
      const budget = this.resourceBudget
      let availableCpu = budget.cpu
      let availableMemory = budget.memoryBytes
      for (const allocation of this.resources.values()) {
        availableCpu -= allocation.cpu
        availableMemory -= allocation.memoryBytes
      }
      if (availableCpu < 1) return
      let waitingJobs = 0
      for (const [kind, count] of pending) {
        waitingJobs += Math.min(count, this.concurrency[kind] - (running.get(kind) ?? 0))
      }
      let started = false
      for (let offset = 0; offset < TASK_KINDS.length; offset++) {
        const index = (this.nextResourceKind + offset) % TASK_KINDS.length
        const task = next.get(TASK_KINDS[index])
        if (!task) continue
        const memory = taskResources(task, budget, 1).memoryBytes
        if (memory > availableMemory) continue
        const slots = Math.min(waitingJobs, Math.floor(availableMemory / memory))
        const allocation = taskResources(task, budget, slots, availableCpu)
        if (allocation.cpu > availableCpu) continue
        this.nextResourceKind = (index + 1) % TASK_KINDS.length
        void this.run(task, allocation)
        started = true
        break
      }
      if (!started) return
    }
  }

  private async run(task: MediaTask, allocation?: TaskResources): Promise<void> {
    const controller = new AbortController()
    const stagingPath = createStagingOutputPath(
      task.outputPath,
      task.id,
      Boolean(task.outputPaths?.length)
    )
    const processingTask = structuredClone(task)
    if (allocation) {
      this.resources.set(task.id, allocation)
      processingTask.processingThreads = allocation.threads
    }
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
      if (task.outputPaths?.length) {
        markOutputDirectory(stagingPath)
        if (
          task.outputConflictPolicy === 'overwrite' &&
          lstatSync(task.outputPath, { throwIfNoEntry: false }) &&
          !isReplaceableOutputDirectory(task.outputPath)
        ) {
          const next = resolveOutputPath({
            sourcePath: task.sourcePath,
            outputDirectory: dirname(task.outputPath),
            outputSuffix: task.outputSuffix,
            extension: '',
            reservedPaths: this.reservedPaths
          })
          this.reservedPaths.delete(task.outputPath)
          task.outputPath = next.path
          task.outputPaths = task.outputPaths.map((path) => join(next.path, basename(path)))
        }
      }
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
      try {
        rmSync(stagingPath, { recursive: true, force: true })
      } catch (error) {
        console.error('清理任务临时输出失败', stagingPath, error)
      }
      task.completedAt = new Date().toISOString()
      this.running.delete(task.id)
      this.resources.delete(task.id)
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
