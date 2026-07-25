import type { MediaTask } from '../../shared/types'

export interface BatchSummary {
  total: number
  completed: number
  failed: number
  cancelled: number
}

export function summarizeBatch(tasks: MediaTask[]): BatchSummary {
  return {
    total: tasks.length,
    completed: tasks.filter((task) => task.status === 'completed').length,
    failed: tasks.filter((task) => task.status === 'failed').length,
    cancelled: tasks.filter((task) => task.status === 'cancelled').length
  }
}

export function batchSummaryText(summary: BatchSummary): string {
  const parts = [`成功 ${summary.completed}`]
  if (summary.failed > 0) parts.push(`失败 ${summary.failed}`)
  if (summary.cancelled > 0) parts.push(`取消 ${summary.cancelled}`)
  return parts.join('，')
}
