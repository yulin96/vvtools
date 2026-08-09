import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CreateTasksRequest, MediaTask, VVToolsApi } from '../src/shared/types'
import { DEFAULT_FONT_OPTIONS, DEFAULT_IMAGE_OPTIONS } from '../src/shared/constants'
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
    store.pendingFontItems = [{ id: 'font-row-1', path: '/tmp/source.ttf', outputFormat: 'woff2' }]

    const sameStore = useAppStore()
    expect(sameStore.pendingImageInputs).toEqual([
      { path: '/tmp/source.png', relativeDirectory: 'album' }
    ])
    expect(sameStore.pendingVideoPaths).toEqual(['/tmp/source.mp4'])
    expect(sameStore.pendingAudioPaths).toEqual(['/tmp/source.mp3'])
    expect(sameStore.pendingFontItems).toEqual([
      { id: 'font-row-1', path: '/tmp/source.ttf', outputFormat: 'woff2' }
    ])
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

  it('preserves duplicate font sources with per-row formats and omits empty instances', async () => {
    const sourcePath = '/tmp/source.ttf'
    const createTasks = vi.fn(async (request: CreateTasksRequest) =>
      request.kind === 'font'
        ? request.sources.map((source, index) => ({
            id: `font-task-${index}`,
            kind: 'font' as const,
            sourcePath: source.path,
            outputPath: `/tmp/source.${source.outputFormat}`,
            status: 'pending' as const,
            progress: 0,
            options: { ...request.options, outputFormat: source.outputFormat },
            sourceSize: 10,
            createdAt: new Date().toISOString()
          }))
        : []
    )
    const api = {
      inspectTasks: vi.fn(async () => [
        {
          sourcePath,
          outputPath: '/tmp/source.woff',
          valid: true,
          sourceSize: 10,
          format: 'TTF',
          fontCount: 1,
          fontInstances: []
        },
        {
          sourcePath,
          outputPath: '/tmp/source.woff2',
          valid: true,
          sourceSize: 10,
          format: 'TTF',
          fontCount: 1,
          fontInstances: []
        }
      ]),
      createTasks
    } as unknown as VVToolsApi
    vi.stubGlobal('window', { api })
    setActivePinia(createPinia())

    const store = useAppStore()
    const result = await store.submitTasks({
      kind: 'font',
      sources: [
        { path: sourcePath, outputFormat: 'woff' },
        { path: sourcePath, outputFormat: 'woff2' }
      ],
      outputMode: 'custom',
      outputDirectory: '/tmp',
      outputSuffix: '',
      options: { ...DEFAULT_FONT_OPTIONS, operation: 'convert' }
    })

    expect(result).toEqual({ handledPaths: [sourcePath, sourcePath] })
    expect(createTasks).toHaveBeenCalledOnce()
    expect(createTasks.mock.calls[0][0]).toMatchObject({
      kind: 'font',
      sources: [
        { path: sourcePath, outputFormat: 'woff' },
        { path: sourcePath, outputFormat: 'woff2' }
      ],
      inputMetadata: [{ path: sourcePath, fontCount: 1 }]
    })
    expect(store.currentBatchTasks.font).toHaveLength(2)
  })

  it('keeps skipped conflicts in the pending list contract', async () => {
    const createTasks = vi.fn()
    const api = {
      inspectTasks: vi.fn(async () => [
        {
          sourcePath: '/tmp/source.png',
          outputPath: '/tmp/source_processed.png',
          valid: false,
          skipped: true,
          sourceSize: 10,
          error: '输出文件已存在，当前冲突策略为跳过'
        }
      ]),
      createTasks
    } as unknown as VVToolsApi
    vi.stubGlobal('window', { api })
    setActivePinia(createPinia())

    const store = useAppStore()
    const result = await store.submitTasks({
      kind: 'image',
      sources: [{ path: '/tmp/source.png', relativeDirectory: '' }],
      outputMode: 'custom',
      outputDirectory: '/tmp',
      outputSuffix: '_processed',
      outputConflictPolicy: 'skip',
      options: { ...DEFAULT_IMAGE_OPTIONS }
    })

    expect(result).toEqual({ handledPaths: [] })
    expect(createTasks).not.toHaveBeenCalled()
    expect(store.errorMessage).toContain('已保留在待处理列表')
  })

  it('removes Electron IPC details from errors shown to users', async () => {
    const api = {
      inspectTasks: vi.fn(async () => {
        throw new Error(
          "Error invoking remote method 'tasks:inspect': Error: 请输入需要保留的字符，或选择 TXT 文本文件"
        )
      })
    } as unknown as VVToolsApi
    vi.stubGlobal('window', { api })
    setActivePinia(createPinia())

    const store = useAppStore()
    const result = await store.submitTasks({
      kind: 'font',
      sources: [{ path: '/tmp/source.ttf', outputFormat: 'woff2' }],
      outputMode: 'custom',
      outputDirectory: '/tmp',
      outputSuffix: '',
      options: { ...DEFAULT_FONT_OPTIONS, operation: 'subset' }
    })

    expect(result).toBeNull()
    expect(store.errorMessage).toBe('请输入需要保留的字符，或选择 TXT 文本文件')
  })
})
