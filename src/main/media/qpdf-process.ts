import { spawn } from 'child_process'
import { stat } from 'fs/promises'
import type { MediaTask } from '../../shared/types'
import { MediaProcessError, TaskCancelledError } from './errors'
import { createTaskCommand } from './task-command'

const activeProcesses = new Set<() => void>()

export function shutdownQpdfProcesses(): void {
  for (const cancel of activeProcesses) cancel()
}

export function buildQpdfArgs(task: Pick<MediaTask, 'sourcePath' | 'outputPath'>): string[] {
  return [
    '--stream-data=compress',
    '--recompress-flate',
    '--object-streams=generate',
    '--compression-level=9',
    task.sourcePath,
    task.outputPath
  ]
}

export function isQpdfSuccessExitCode(exitCode: number | null): boolean {
  return exitCode === 0 || exitCode === 3
}

export function runQpdfProcess(
  executable: string,
  task: Pick<MediaTask, 'sourcePath' | 'outputPath'>,
  signal: AbortSignal,
  onProgress: (progress: number) => void
): Promise<number> {
  if (signal.aborted) return Promise.reject(new TaskCancelledError())
  const args = buildQpdfArgs(task)
  const command = createTaskCommand(executable, args)
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true })
    let stderr = ''
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', handleAbort)
      activeProcesses.delete(handleAbort)
      callback()
    }
    const fail = (error: Error, exitCode?: number): void =>
      finish(() =>
        reject(
          new MediaProcessError('PDF 无损压缩失败，请确认文件未损坏或未加密', {
            command,
            exitCode,
            stderrTail: stderr.trim() || error.message
          })
        )
      )
    const handleAbort = (): void => {
      child.kill()
      finish(() => reject(new TaskCancelledError()))
    }
    activeProcesses.add(handleAbort)
    signal.addEventListener('abort', handleAbort, { once: true })
    child.stdout.resume()
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-16_000)
    })
    child.once('error', (error) => fail(error))
    child.once('close', async (code) => {
      if (settled) return
      if (!isQpdfSuccessExitCode(code)) {
        fail(new Error(`qpdf 退出码 ${code ?? '未知'}`), code ?? undefined)
        return
      }
      try {
        const { size } = await stat(task.outputPath)
        if (!size) throw new Error('qpdf 未生成有效的 PDF 输出')
        finish(() => {
          onProgress(100)
          resolve(size)
        })
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)), code ?? undefined)
      }
    })
    if (signal.aborted) handleAbort()
    else onProgress(15)
  })
}
