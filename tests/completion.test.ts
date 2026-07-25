import { describe, expect, it } from 'vitest'
import { batchSummaryText, summarizeBatch } from '../src/main/services/completion'
import type { MediaTask, TaskStatus } from '../src/shared/types'

function task(status: TaskStatus): MediaTask {
  return { status } as MediaTask
}

describe('completion summary', () => {
  it('reports completed, failed and cancelled task counts', () => {
    const summary = summarizeBatch([
      task('completed'),
      task('completed'),
      task('failed'),
      task('cancelled')
    ])
    expect(summary).toEqual({ total: 4, completed: 2, failed: 1, cancelled: 1 })
    expect(batchSummaryText(summary)).toBe('成功 2，失败 1，取消 1')
  })

  it('omits empty failure and cancellation groups', () => {
    expect(batchSummaryText({ total: 2, completed: 2, failed: 0, cancelled: 0 })).toBe('成功 2')
  })
})
