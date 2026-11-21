import { pathKey } from '../../../shared/path-key'
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

export function batchSpaceSavings(
  tasks: MediaTask[],
  platform: string
): {
  sourceSize: number
  outputSize: number
  difference: number
  percentage: number
} | null {
  const sources = new Map<string, number>()
  const outputs = new Map<string, { size: number; completedAt: string }>()
  for (const task of tasks) {
    if (task.status !== 'completed' || task.outputSize === undefined) continue
    const source = pathKey(task.sourcePath, platform)
    if (!sources.has(source)) sources.set(source, task.sourceSize)
    // Grouped exports are committed as a unit. Their size already sums the actual files.
    const output = pathKey(task.outputPath, platform)
    const previous = outputs.get(output)
    const completedAt = task.completedAt ?? ''
    if (!previous || previous.completedAt <= completedAt)
      outputs.set(output, { size: task.outputSize, completedAt })
  }
  if (!outputs.size) return null
  const sourceSize = [...sources.values()].reduce((sum, size) => sum + size, 0)
  const outputSize = [...outputs.values()].reduce((sum, output) => sum + output.size, 0)
  const difference = sourceSize - outputSize
  return {
    sourceSize,
    outputSize,
    difference,
    percentage: sourceSize ? (Math.abs(difference) / sourceSize) * 100 : 0
  }
}
