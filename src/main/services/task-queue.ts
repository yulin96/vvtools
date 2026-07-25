import { randomUUID } from 'crypto'
import { mkdirSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { EventEmitter } from 'events'
import type {
  CreateTasksRequest,
  ImageOptions,
  MediaTask,
  TaskFailure,
  VideoOptions
} from '../../shared/types'
import { FailureLogService } from './failure-log'
import { MediaProcessError, TaskCancelledError } from '../media/errors'
import { createAvailableOutputPath, getOutputExtension } from '../media/output-path'
import { TaskHistoryStore } from './task-history-store'

export type TaskRunner = (
  task: MediaTask,
  signal: AbortSignal,
  onProgress: (progress: number) => void
) => Promise<number>

export class TaskQueue extends EventEmitter {
  private readonly tasks = new Map<string, MediaTask>()
  private readonly running = new Map<string, AbortController>()
  private readonly reservedPaths = new Set<string>()

  constructor(
    private concurrency: number,
    private readonly runner: TaskRunner,
    private readonly failureLogs: FailureLogService,
    private readonly historyStore?: TaskHistoryStore,
    private historyRetentionDays = 30
  ) {
    super()
    this.restore()
  }

  list(): MediaTask[] {
    return structuredClone([...this.tasks.values()])
  }

  create(request: CreateTasksRequest): MediaTask[] {
    const sources =
      request.kind === 'video'
        ? request.sourcePaths.map((path) => ({ path, relativeDirectory: '' }))
        : request.sources
    const created = sources.map((source) => {
      const sourcePath = source.path
      const outputDirectory =
        request.outputMode === 'source'
          ? dirname(sourcePath)
          : request.kind === 'image' &&
              request.options.preserveStructure &&
              source.relativeDirectory
            ? join(request.outputDirectory, source.relativeDirectory)
            : request.outputDirectory
      mkdirSync(outputDirectory, { recursive: true })
      const extension = getOutputExtension(
        request.kind,
        sourcePath,
        request.kind === 'image' ? request.options.format : undefined,
        request.kind === 'video' ? request.options.format : undefined
      )
      const task: MediaTask = {
        id: randomUUID(),
        kind: request.kind,
        sourcePath,
        outputPath: createAvailableOutputPath(
          sourcePath,
          outputDirectory,
          extension,
          this.reservedPaths,
          request.outputSuffix
        ),
        status: 'pending',
        progress: 0,
        options: structuredClone(request.options),
        outputSuffix: request.outputSuffix,
        sourceSize: statSync(sourcePath).size,
        createdAt: new Date().toISOString()
      }
      this.tasks.set(task.id, task)
      return structuredClone(task)
    })
    this.changed()
    this.persist()
    this.dispatch()
    return created
  }

  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task || !['pending', 'processing'].includes(task.status)) return false
    if (task.status === 'pending') {
      task.status = 'cancelled'
      task.completedAt = new Date().toISOString()
      this.changed()
      this.persist()
      this.dispatch()
      return true
    }
    this.running.get(taskId)?.abort()
    return true
  }

  retry(taskId: string): MediaTask | null {
    const original = this.tasks.get(taskId)
    if (!original || !['failed', 'interrupted'].includes(original.status)) return null
    const request: CreateTasksRequest =
      original.kind === 'video'
        ? {
            kind: 'video',
            sourcePaths: [original.sourcePath],
            outputMode: 'custom',
            outputDirectory: dirname(original.outputPath),
            outputSuffix: original.outputSuffix ?? '',
            options: structuredClone(original.options) as VideoOptions
          }
        : {
            kind: 'image',
            sources: [{ path: original.sourcePath, relativeDirectory: '' }],
            outputMode: 'custom',
            outputDirectory: dirname(original.outputPath),
            outputSuffix: original.outputSuffix ?? '',
            options: structuredClone(original.options) as ImageOptions
          }
    const task = this.create(request)[0]
    const stored = this.tasks.get(task.id)
    if (stored) stored.retryOf = original.id
    this.changed()
    this.persist()
    return stored ? structuredClone(stored) : null
  }

  retryFailed(): MediaTask[] {
    const retryableIds = [...this.tasks.values()]
      .filter((task) => ['failed', 'interrupted'].includes(task.status))
      .map((task) => task.id)
    return retryableIds
      .map((taskId) => this.retry(taskId))
      .filter((task): task is MediaTask => task !== null)
  }

  clearCompleted(): number {
    let removed = 0
    for (const [taskId, task] of this.tasks) {
      if (task.status !== 'completed') continue
      this.tasks.delete(taskId)
      removed += 1
    }
    if (removed > 0) {
      this.persist()
      this.changed()
    }
    return removed
  }

  setConcurrency(value: number): void {
    this.concurrency = value
    this.dispatch()
  }

  setHistoryRetentionDays(value: number): void {
    this.historyRetentionDays = value
    if (this.pruneExpired()) {
      this.persist()
      this.changed()
    }
  }

  shutdown(): void {
    for (const controller of this.running.values()) controller.abort()
    for (const task of this.tasks.values()) {
      if (task.status === 'pending') {
        task.status = 'cancelled'
        task.completedAt = new Date().toISOString()
      }
    }
    this.persist()
  }

  private dispatch(): void {
    while (this.running.size < this.concurrency) {
      const task = [...this.tasks.values()].find((item) => item.status === 'pending')
      if (!task) return
      void this.run(task)
    }
  }

  private async run(task: MediaTask): Promise<void> {
    const controller = new AbortController()
    this.running.set(task.id, controller)
    task.status = 'processing'
    task.progress = 0
    task.startedAt = new Date().toISOString()
    this.changed()
    this.persist()

    try {
      task.outputSize = await this.runner(task, controller.signal, (progress) => {
        task.progress = progress
        this.changed()
      })
      task.status = 'completed'
      task.progress = 100
    } catch (error) {
      if (error instanceof TaskCancelledError || controller.signal.aborted) {
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
      task.completedAt = new Date().toISOString()
      this.running.delete(task.id)
      this.persist()
      this.changed()
      this.dispatch()
    }
  }

  private changed(): void {
    this.emit('changed', this.list())
  }

  private restore(): void {
    if (!this.historyStore) return
    const restoredAt = new Date().toISOString()
    for (const restored of this.historyStore.read()) {
      const task = structuredClone(restored)
      if (task.status === 'pending' || task.status === 'processing') {
        task.status = 'interrupted'
        task.progress = null
        task.completedAt = restoredAt
        task.failure = { message: '应用上次退出时任务尚未完成，可重新执行' }
      }
      this.tasks.set(task.id, task)
      this.reservedPaths.add(task.outputPath)
    }
    if (this.pruneExpired()) this.persist()
    else this.historyStore.write(this.list())
  }

  private pruneExpired(): boolean {
    const cutoff = Date.now() - this.historyRetentionDays * 24 * 60 * 60 * 1000
    let removed = false
    for (const [taskId, task] of this.tasks) {
      if (task.status === 'pending' || task.status === 'processing') continue
      const timestamp = Date.parse(task.completedAt ?? task.createdAt)
      if (Number.isFinite(timestamp) && timestamp < cutoff) {
        this.tasks.delete(taskId)
        removed = true
      }
    }
    return removed
  }

  private persist(): void {
    this.historyStore?.write(this.list())
  }
}
