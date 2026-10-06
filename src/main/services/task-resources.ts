import { availableParallelism, totalmem } from 'os'
import type { ImageOptions, MediaTask, VideoOptions } from '../../shared/types'

export interface TaskResourceBudget {
  cpu: number
  memoryBytes: number
}

export interface TaskResources extends TaskResourceBudget {
  threads: number
}

const MIB = 1024 * 1024

export function deviceTaskBudget(
  processors = availableParallelism(),
  memory = totalmem()
): TaskResourceBudget {
  return {
    cpu: Math.max(1, Math.floor(processors * 0.8)),
    memoryBytes: Math.max(256 * MIB, Math.min(4096 * MIB, Math.floor(memory * 0.25)))
  }
}

export function taskResources(
  task: MediaTask,
  budget: TaskResourceBudget,
  parallelJobs: number
): TaskResources {
  let threads = Math.max(1, Math.floor(budget.cpu / Math.max(1, parallelJobs)))
  let cpu = threads
  const outputPixels = (task.sourceWidth ?? 0) * (task.sourceHeight ?? 0)
  const inputPixels =
    (task.inputWidth ?? task.sourceWidth ?? 0) * (task.inputHeight ?? task.sourceHeight ?? 0)
  let memoryBytes = 64 * MIB
  if (task.kind === 'image') {
    memoryBytes += inputPixels * 4 + outputPixels * 8
    if ((task.options as ImageOptions).format === 'avif') cpu = Math.max(4, cpu)
  } else if (task.kind === 'video') {
    const options = task.options as VideoOptions
    const copiesVideo =
      options.codec === 'source' &&
      options.resolution === 'source' &&
      options.frameRate === 'source'
    if (copiesVideo) threads = cpu = 1
    else memoryBytes += inputPixels * 64 + outputPixels * 8
  } else if (task.kind === 'sprite') {
    memoryBytes += inputPixels * 64 + outputPixels * 12
  } else if (task.kind === 'pdf') {
    threads = cpu = Math.min(2, threads)
    memoryBytes += 192 * MIB + task.sourceSize * 8 + outputPixels * 16
  } else if (task.kind === 'font') {
    threads = cpu = 1
    memoryBytes += 128 * MIB + task.sourceSize * 12
  } else {
    threads = cpu = 1
  }
  return {
    cpu: Math.min(budget.cpu, cpu),
    threads,
    // An unusually large input can still run, but must reserve the whole budget.
    memoryBytes: Math.min(budget.memoryBytes, memoryBytes)
  }
}
