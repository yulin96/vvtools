import { describe, expect, it } from 'vitest'
import { taskProgressText, taskProgressValue } from '../src/renderer/src/lib/task-progress'

describe('task progress presentation', () => {
  it('shows dispatched and completed progress values', () => {
    expect(taskProgressValue({ status: 'processing', progress: 10 })).toBe(10)
    expect(taskProgressText({ status: 'processing', progress: 10 })).toBe('10%')
    expect(taskProgressValue({ status: 'completed', progress: 99 })).toBe(100)
    expect(taskProgressText({ status: 'completed', progress: 99 })).toBe('100%')
  })

  it('clears the progress bar after cancellation', () => {
    expect(taskProgressValue({ status: 'cancelled', progress: null })).toBe(0)
    expect(taskProgressText({ status: 'cancelled', progress: null })).toBe('—')
  })
})
