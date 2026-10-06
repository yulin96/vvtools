import type { TaskCommand } from '../../shared/types'

export class TaskCancelledError extends Error {
  constructor() {
    super('任务已取消')
    this.name = 'TaskCancelledError'
  }
}

export class TaskSkippedError extends Error {
  constructor(
    message: string,
    readonly outputSize?: number
  ) {
    super(message)
    this.name = 'TaskSkippedError'
  }
}

export class MediaProcessError extends Error {
  constructor(
    message: string,
    readonly details: {
      exitCode?: number
      command?: TaskCommand
      stderrTail?: string
      logPath?: string
    } = {}
  ) {
    super(message)
    this.name = 'MediaProcessError'
  }
}

export interface ProcessFailure {
  name?: string
  error?: string
  details?: MediaProcessError['details']
  outputSize?: number
}

export function processFailure(error: unknown): ProcessFailure {
  return {
    name: error instanceof Error ? error.name : 'Error',
    error: error instanceof Error ? error.message : String(error),
    details: error instanceof MediaProcessError ? error.details : undefined,
    outputSize: error instanceof TaskSkippedError ? error.outputSize : undefined
  }
}

export function restoreProcessFailure(failure: ProcessFailure): Error {
  const message = failure.error || '后台处理失败'
  if (failure.name === 'TaskSkippedError') return new TaskSkippedError(message, failure.outputSize)
  if (failure.name === 'TaskCancelledError') return new TaskCancelledError()
  if (failure.name === 'MediaProcessError') return new MediaProcessError(message, failure.details)
  return new Error(message)
}
