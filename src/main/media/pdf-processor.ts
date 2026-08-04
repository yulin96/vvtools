import type { MediaTask, PdfOptions } from '../../shared/types'
import { MediaProcessError, TaskCancelledError } from './errors'
import { createTaskCommand } from './ffmpeg-runtime'
import {
  probePdfProcess,
  runPdfProcess,
  shutdownPdfProcesses,
  type PdfProbeResult
} from './pdf-process'

export type PdfProbe = PdfProbeResult

export async function probePdf(sourcePath: string, signal: AbortSignal): Promise<PdfProbe> {
  if (signal.aborted) throw new TaskCancelledError()
  try {
    return await probePdfProcess(sourcePath, signal)
  } catch (error) {
    if (error instanceof TaskCancelledError) throw error
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}

export async function processPdf(
  task: MediaTask,
  signal: AbortSignal,
  onProgress: (progress: number) => void = () => undefined
): Promise<number> {
  if (signal.aborted) throw new TaskCancelledError()
  const options = task.options as PdfOptions
  const command = createTaskCommand('pdf-worker', [
    task.sourcePath,
    options.operation,
    options.operation === 'toImage'
      ? `${options.imageFormat}@${options.dpi}dpi`
      : options.compressionMode === 'lossy'
        ? `lossy@${options.compressionDpi}dpi/q${options.compressionQuality}`
        : 'lossless',
    task.outputPath
  ])

  try {
    return await runPdfProcess(task, signal, onProgress)
  } catch (error) {
    if (error instanceof TaskCancelledError) throw error
    throw new MediaProcessError('PDF 处理失败，请确认文件未损坏或未加密', {
      command,
      stderrTail: error instanceof Error ? error.message : String(error)
    })
  }
}

export function isQpdfSuccessExitCode(exitCode: number): boolean {
  return exitCode === 0 || exitCode === 3
}

export { shutdownPdfProcesses }
