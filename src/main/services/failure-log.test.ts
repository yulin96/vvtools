import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_IMAGE_OPTIONS } from '../../shared/constants'
import type { MediaTask, TaskFailure } from '../../shared/types'
import { FailureLogService } from './failure-log'

const directories: string[] = []
const task: MediaTask = {
  id: 'failed-task',
  kind: 'image',
  sourcePath: '/tmp/source.jpg',
  outputPath: '/tmp/output.jpg',
  options: { ...DEFAULT_IMAGE_OPTIONS },
  status: 'failed',
  progress: 0,
  sourceSize: 10,
  createdAt: new Date().toISOString()
}

function fixture(): { logs: FailureLogService; directory: string } {
  const root = mkdtempSync(join(tmpdir(), 'vvtools-failure-log-'))
  directories.push(root)
  return { logs: new FailureLogService(root), directory: join(root, 'logs', 'tasks') }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('failure log persistence', () => {
  it('recreates a removed log directory when saving a task failure', () => {
    const { logs, directory } = fixture()
    rmSync(directory, { recursive: true })

    const logPath = logs.writeFailure(task, { message: 'original processing error' })

    expect(logPath).toBe(join(directory, 'failed-task.log'))
    expect(readFileSync(logPath!, 'utf8')).toContain('错误: original processing error')
  })

  it('retains the original diagnostic when the log cannot be saved', () => {
    const { logs, directory } = fixture()
    rmSync(directory, { recursive: true })
    writeFileSync(directory, 'blocks directory')
    const failure: TaskFailure = {
      message: 'original processing error',
      stderrTail: 'decoder error'
    }

    expect(logs.writeFailure(task, failure)).toBeUndefined()
    expect(failure.message).toBe('original processing error')
    expect(failure.stderrTail).toContain('decoder error')
    expect(failure.stderrTail).toContain('日志保存失败')
  })

  it('handles a log stream error and keeps the stderr diagnostic in memory', async () => {
    const { logs, directory } = fixture()
    rmSync(directory, { recursive: true })
    writeFileSync(directory, 'blocks directory')
    const writer = logs.create(task, { executable: 'ffmpeg', args: [], display: 'ffmpeg' })
    writer.appendTail('decoder error')
    await new Promise<void>((resolve) => writer.stream.once('close', resolve))

    expect(writer.path).toBeUndefined()
    expect(writer.getTail()).toContain('decoder error')
    expect(writer.getTail()).toContain('日志保存失败')
    expect(() => writer.discard()).not.toThrow()
  })
})
