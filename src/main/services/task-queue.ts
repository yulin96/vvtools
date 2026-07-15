import { randomUUID } from 'crypto'
import { mkdirSync, statSync } from 'fs'
import { dirname } from 'path'
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
    private readonly failureLogs: FailureLogService
  ) {
    super()
  }

  list(): MediaTask[] {
    return structuredClone([...this.tasks.values()])
  }

  create(request: CreateTasksRequest): MediaTask[] {
    const created = request.sourcePaths.map((sourcePath) => {
      const outputDirectory =
        request.kind === 'video' && request.outputMode === 'source'
          ? dirname(sourcePath)
          : request.outputDirectory
      if (!outputDirectory) throw new Error('缺少输出目录')
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
          this.reservedPaths
        ),
        status: 'pending',
        progress: 0,
        options: structuredClone(request.options),
        sourceSize: statSync(sourcePath).size,
        createdAt: new Date().toISOString()
      }
      this.tasks.set(task.id, task)
      return structuredClone(task)
    })
    this.changed()
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
            options: structuredClone(original.options) as VideoOptions
          }
        : {
            kind: 'image',
            sourcePaths: [original.sourcePath],
            outputDirectory: dirname(original.outputPath),
            options: structuredClone(original.options) as ImageOptions
          }
    const task = this.create(request)[0]
    const stored = this.tasks.get(task.id)
    if (stored) stored.retryOf = original.id
    this.changed()
    return stored ? structuredClone(stored) : null
  }

  setConcurrency(value: number): void {
    this.concurrency = value
    this.dispatch()
  }

  shutdown(): void {
    for (const controller of this.running.values()) controller.abort()
    for (const task of this.tasks.values()) {
      if (task.status === 'pending') {
        task.status = 'cancelled'
        task.completedAt = new Date().toISOString()
      }
    }
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
    task.progress = task.kind === 'image' ? null : 0
    task.startedAt = new Date().toISOString()
    this.changed()

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
      this.changed()
      this.dispatch()
    }
  }

  private changed(): void {
    this.emit('changed', this.list())
  }
}
