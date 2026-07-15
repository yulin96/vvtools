import { createWriteStream, mkdirSync, rmSync, writeFileSync, type WriteStream } from 'fs'
import { join } from 'path'
import type { MediaTask, TaskCommand, TaskFailure } from '../../shared/types'

export interface TaskLogWriter {
  path: string
  stream: WriteStream
  appendTail: (text: string) => void
  getTail: () => string
  discard: () => void
}

export class FailureLogService {
  private readonly directory: string

  constructor(userDataPath: string) {
    this.directory = join(userDataPath, 'logs', 'tasks')
    mkdirSync(this.directory, { recursive: true })
  }

  create(task: MediaTask, command: TaskCommand): TaskLogWriter {
    const path = join(this.directory, `${task.id}.log`)
    const stream = createWriteStream(path, { flags: 'w' })
    stream.write(
      [
        `时间: ${new Date().toISOString()}`,
        `源文件: ${task.sourcePath}`,
        `输出文件: ${task.outputPath}`,
        `命令: ${command.display}`,
        '',
        '错误日志:'
      ].join('\n') + '\n'
    )
    let tail = ''

    return {
      path,
      stream,
      appendTail(text: string) {
        tail = (tail + text).slice(-20_000)
      },
      getTail: () => tail.trim(),
      discard() {
        stream.end(() => rmSync(path, { force: true }))
      }
    }
  }

  writeFailure(task: MediaTask, failure: TaskFailure): string {
    const path = failure.logPath || join(this.directory, `${task.id}.log`)
    if (!failure.logPath) {
      const content = [
        `时间: ${new Date().toISOString()}`,
        `源文件: ${task.sourcePath}`,
        `输出文件: ${task.outputPath}`,
        `错误: ${failure.message}`,
        failure.command ? `命令: ${failure.command.display}` : '',
        failure.stderrTail ? `\n错误日志:\n${failure.stderrTail}` : ''
      ]
        .filter(Boolean)
        .join('\n')
      writeFileSync(path, content, 'utf8')
    }
    return path
  }
}
