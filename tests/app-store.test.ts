import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CreateTasksRequest, MediaTask, VVToolsApi } from '../src/shared/types'
import { DEFAULT_IMAGE_OPTIONS } from '../src/shared/constants'
import { useAppStore } from '../src/renderer/src/stores/app'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('app store task submission', () => {
  it('keeps staged files in the shared store across workspace consumers', () => {
    setActivePinia(createPinia())
    const store = useAppStore()
    store.pendingImageInputs = [{ path: '/tmp/source.png', relativeDirectory: 'album' }]
    store.pendingVideoPaths = ['/tmp/source.mp4']
    store.pendingAudioPaths = ['/tmp/source.mp3']

    const sameStore = useAppStore()
    expect(sameStore.pendingImageInputs).toEqual([
      { path: '/tmp/source.png', relativeDirectory: 'album' }
    ])
    expect(sameStore.pendingVideoPaths).toEqual(['/tmp/source.mp4'])
    expect(sameStore.pendingAudioPaths).toEqual(['/tmp/source.mp3'])
  })

  it('converts reactive task requests to IPC-cloneable data before submission', async () => {
    const createdTask: MediaTask = {
      id: 'image-task-1',
      kind: 'image',
      sourcePath: '/tmp/source.png',
      outputPath: '/tmp/source_processed.png',
      status: 'pending',
      progress: 0,
      options: { ...DEFAULT_IMAGE_OPTIONS },
      sourceSize: 10,
      sourceWidth: 16,
      sourceHeight: 9,
      createdAt: new Date().toISOString()
    }
    const createTasks = vi.fn(async (request: CreateTasksRequest) => {
      expect(() => structuredClone(request)).not.toThrow()
      return [createdTask]
    })
    const api = {
      inspectTasks: vi.fn(async () => [
        {
          sourcePath: '/tmp/source.png',
          outputPath: '/tmp/source_processed.png',
          valid: true,
          sourceSize: 10,
          width: 16,
          height: 9,
          outputWidth: 16,
          outputHeight: 9
        }
      ]),
      createTasks
    } as unknown as VVToolsApi
    vi.stubGlobal('window', { api })
    setActivePinia(createPinia())

    const request = reactive<CreateTasksRequest>({
      kind: 'image',
      sources: [{ path: '/tmp/source.png', relativeDirectory: '' }],
      outputMode: 'custom',
      outputDirectory: '/tmp',
      outputSuffix: '_processed',
      options: { ...DEFAULT_IMAGE_OPTIONS }
    })

    const store = useAppStore()
    const result = await store.submitTasks(request)

    expect(result).toEqual({ handledPaths: ['/tmp/source.png'] })
    expect(store.currentBatchTasks.image).toEqual([createdTask])
    store.tasks[0].status = 'completed'
    store.prepareCurrentBatch('image')
    expect(store.currentBatchTasks.image).toEqual([])
    expect(createTasks).toHaveBeenCalledOnce()
    expect(createTasks.mock.calls[0][0]).toMatchObject({
      kind: 'image',
      inputMetadata: [{ path: '/tmp/source.png', width: 16, height: 9 }]
    })
  })
})
