import { createWriteStream, mkdirSync, rmSync, writeFileSync, type WriteStream } from 'fs'
import { join } from 'path'
import type { MediaTask, TaskCommand, TaskFailure } from '../../shared/types'

export interface TaskLogWriter {
  path: string | undefined
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
    let writeError = ''
    const recordError = (error: unknown): void => {
      writeError = `日志保存失败：${error instanceof Error ? error.message : String(error)}`
    }
    stream.on('error', recordError)
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
      get path() {
        return writeError ? undefined : path
      },
      stream,
      appendTail(text: string) {
        tail = (tail + text).slice(-20_000)
      },
      getTail: () => [tail.trim(), writeError].filter(Boolean).join('\n'),
      discard() {
        stream.end(() => {
          try {
            rmSync(path, { force: true })
          } catch (error) {
            recordError(error)
          }
        })
      }
    }
  }

  writeFailure(task: MediaTask, failure: TaskFailure): string | undefined {
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
      try {
        mkdirSync(this.directory, { recursive: true })
        writeFileSync(path, content, 'utf8')
      } catch (error) {
        failure.stderrTail = [
          failure.stderrTail,
          `日志保存失败：${error instanceof Error ? error.message : String(error)}`
        ]
          .filter(Boolean)
          .join('\n')
        return undefined
      }
    }
    return path
  }
}
