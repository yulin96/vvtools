import type { MediaTask } from '../../shared/types'

export function ffmpegInputThreads(task: MediaTask): string[] {
  if (!task.processingThreads) return []
  const threads = String(task.processingThreads)
  return ['-threads', threads, '-filter_threads', threads, '-filter_complex_threads', threads]
}
