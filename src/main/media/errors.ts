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
