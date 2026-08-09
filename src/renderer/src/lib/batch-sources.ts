import type { MediaTask } from '../../../shared/types'

export interface BatchSourceItem {
  path: string
  batchItemId: string
  relativeDirectory: string
}

export function settledBatchSourceItems(tasks: MediaTask[]): BatchSourceItem[] {
  if (tasks.some((task) => ['pending', 'processing'].includes(task.status))) return []
  const sources = new Map<string, BatchSourceItem>()
  for (const task of tasks) {
    if (sources.has(task.sourcePath)) continue
    sources.set(task.sourcePath, {
      path: task.sourcePath,
      batchItemId: task.batchInputId ?? task.batchItemId ?? task.sourcePath,
      relativeDirectory: task.relativeDirectory ?? ''
    })
  }
  return [...sources.values()]
}
