import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateTasksRequest } from '../../../shared/types'
import { DEFAULT_IMAGE_OPTIONS } from '../../../shared/constants'
import { useAppStore, type TaskSubmissionResult } from '../stores/app'
import { useTaskSubmission } from './useTaskSubmission'

const request: CreateTasksRequest = {
  kind: 'image',
  sources: [{ path: '/tmp/accepted.png', relativeDirectory: '' }],
  outputMode: 'source',
  outputDirectory: '/tmp',
  outputSuffix: '',
  options: { ...DEFAULT_IMAGE_OPTIONS }
}

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.restoreAllMocks())

describe('workspace submission cleanup', () => {
  it('blocks duplicate submissions and removes only accepted paths from the latest pending list', async () => {
    let resolve!: (result: TaskSubmissionResult) => void
    const result = new Promise<TaskSubmissionResult>((done) => (resolve = done))
    const submitTasks = vi.spyOn(useAppStore(), 'submitTasks').mockReturnValue(result)
    const pending = ref(['/tmp/accepted.png', '/tmp/skipped.png'])
    const { starting, submit } = useTaskSubmission(pending, (path) => path)

    const submission = submit(request)
    expect(starting.value).toBe(true)
    await submit(request)
    expect(submitTasks).toHaveBeenCalledExactlyOnceWith(request)
    pending.value.push('/tmp/added.png')
    resolve({ handledPaths: ['/tmp/accepted.png'], handledBatchItemIds: [] })
    await submission

    expect(pending.value).toEqual(['/tmp/skipped.png', '/tmp/added.png'])
    expect(starting.value).toBe(false)
  })

  it('uses stable font IDs even when multiple rows share a source path', async () => {
    vi.spyOn(useAppStore(), 'submitTasks').mockResolvedValue({
      handledPaths: ['/tmp/font.ttf'],
      handledBatchItemIds: ['woff-row']
    })
    const pending = ref([
      { id: 'woff-row', path: '/tmp/font.ttf' },
      { id: 'otf-row', path: '/tmp/font.ttf' }
    ])
    const { submit } = useTaskSubmission(pending, (item) => item.id, 'handledBatchItemIds')

    await submit(request)

    expect(pending.value).toEqual([{ id: 'otf-row', path: '/tmp/font.ttf' }])
  })

  it.each([null, { handledPaths: [], handledBatchItemIds: [] }])(
    'keeps pending items and unlocks when no inputs were handled: %j',
    async (result) => {
      vi.spyOn(useAppStore(), 'submitTasks').mockResolvedValue(result)
      const pending = ref(['/tmp/accepted.png', '/tmp/skipped.png'])
      const { starting, submit } = useTaskSubmission(pending, (path) => path)

      await submit(request)

      expect(pending.value).toEqual(['/tmp/accepted.png', '/tmp/skipped.png'])
      expect(starting.value).toBe(false)
    }
  )

  it('unlocks after an unexpected rejection and allows another submission', async () => {
    const submitTasks = vi
      .spyOn(useAppStore(), 'submitTasks')
      .mockRejectedValueOnce(new Error('submission rejected'))
      .mockResolvedValueOnce({ handledPaths: ['/tmp/accepted.png'], handledBatchItemIds: [] })
    const pending = ref(['/tmp/accepted.png'])
    const { starting, submit } = useTaskSubmission(pending, (path) => path)

    await expect(submit(request)).rejects.toThrow('submission rejected')
    expect(starting.value).toBe(false)
    expect(pending.value).toEqual(['/tmp/accepted.png'])
    await submit(request)
    expect(submitTasks).toHaveBeenCalledTimes(2)
    expect(starting.value).toBe(false)
    expect(pending.value).toEqual([])
  })
})
