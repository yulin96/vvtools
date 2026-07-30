import { randomUUID } from 'crypto'
import { mkdirSync, rmSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { EventEmitter } from 'events'
import type {
  CreateTasksRequest,
  AudioOptions,
  ImageOptions,
  MediaTask,
  TaskConcurrencyLimits,
  TaskFailure,
  VideoOptions
} from '../../shared/types'
import { FailureLogService } from './failure-log'
import { MediaProcessError, TaskCancelledError } from '../media/errors'
import { getOutputExtension, resolveOutputPath } from '../media/output-path'
import { commitStagedOutput, createStagingOutputPath } from '../media/output-commit'

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
    this.discardSettledBatch(request.kind)
    const sources =
      request.kind === 'image'
        ? request.sources
        : request.sourcePaths.map((path) => ({ path, relativeDirectory: '' }))
    const metadata = new Map(request.inputMetadata?.map((item) => [item.path, item]))
    const created = sources.flatMap((source) => {
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
        request.kind === 'video' ? request.options.format : undefined,
        request.kind === 'audio' ? request.options.format : undefined
      )
      const dimensions = metadata.get(sourcePath)
      const output = resolveOutputPath({
        sourcePath,
        outputDirectory,
        extension,
        reservedPaths: this.reservedPaths,
        outputSuffix: request.outputSuffix,
        nameTemplate: request.outputNameTemplate,
        conflictPolicy: request.outputConflictPolicy,
        presetName: request.presetName,
        width: dimensions?.width,
        height: dimensions?.height
      })
      if (output.skipped) return []
      const task: MediaTask = {
        id: randomUUID(),
        kind: request.kind,
        sourcePath,
        outputPath: output.path,
        status: 'pending',
        progress: 0,
        options: structuredClone(request.options),
        outputSuffix: request.outputSuffix,
        outputNameTemplate: request.outputNameTemplate,
        outputConflictPolicy: request.outputConflictPolicy,
        presetName: request.presetName,
        sourceWidth: dimensions?.width,
        sourceHeight: dimensions?.height,
        sourceSize: statSync(sourcePath).size,
        createdAt: new Date().toISOString()
      }
      this.tasks.set(task.id, task)
      return [structuredClone(task)]
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
          : {
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
    const task = this.create(request)[0]
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
    this.running.set(task.id, controller)
    task.status = 'processing'
    task.progress = 0
    task.startedAt = new Date().toISOString()
    this.changed()

    try {
      const outputSize = await this.runner(processingTask, controller.signal, (progress) => {
        task.progress = progress
        this.changed()
      })
      if (controller.signal.aborted) throw new TaskCancelledError()
      commitStagedOutput(stagingPath, task.outputPath, task.outputConflictPolicy === 'overwrite')
      task.outputSize = outputSize
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
      rmSync(stagingPath, { force: true })
      task.completedAt = new Date().toISOString()
      this.running.delete(task.id)
      this.reservedPaths.delete(task.outputPath)
      this.changed()
      this.dispatch()
    }
  }

  private changed(): void {
    this.emit('changed', this.list())
  }

  private discardSettledBatch(kind: MediaTask['kind']): void {
    const hasActiveBatch = [...this.tasks.values()].some(
      (task) => task.kind === kind && (task.status === 'pending' || task.status === 'processing')
    )
    if (hasActiveBatch) return

    for (const [taskId, task] of this.tasks) {
      if (task.kind !== kind) continue
      this.tasks.delete(taskId)
      this.reservedPaths.delete(task.outputPath)
    }
  }
}
