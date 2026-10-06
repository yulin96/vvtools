import { mkdtemp, rename, rm } from 'fs/promises'
import { basename, dirname, join } from 'path'
import type { MediaTask } from '../../shared/types'
import workerPath from './image-worker?modulePath'
import { MediaProcessPool } from './process-pool'
import { TaskCancelledError } from './errors'

export const imageProcesses = new MediaProcessPool(workerPath, 16)

export async function processImage(
  task: MediaTask,
  signal: AbortSignal,
  onProgress: (progress: number) => void = () => undefined
): Promise<number> {
  if (signal.aborted) throw new TaskCancelledError()
  const workingDirectory = await mkdtemp(join(dirname(task.outputPath), '.vvtools-image-'))
  const outputPath = join(workingDirectory, basename(task.outputPath))
  try {
    const outputSize = await imageProcesses.run<number>({ ...task, outputPath }, signal, onProgress)
    if (signal.aborted) throw new TaskCancelledError()
    await rename(outputPath, task.outputPath)
    if (signal.aborted) {
      await rm(task.outputPath, { force: true })
      throw new TaskCancelledError()
    }
    return outputSize
  } finally {
    await rm(workingDirectory, { recursive: true, force: true })
  }
}
