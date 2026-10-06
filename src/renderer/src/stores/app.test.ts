import { normalizeDesktopSettings } from '../../../shared/desktop-settings'
import { createPinia, setActivePinia } from 'pinia'
import { computed } from 'vue'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  DEFAULT_AUDIO_OPTIONS,
  DEFAULT_CONCURRENCY_SETTINGS,
  DEFAULT_FONT_OPTIONS,
  DEFAULT_IMAGE_OPTIONS,
  DEFAULT_PDF_OPTIONS,
  DEFAULT_RENAME_SETTINGS,
  DEFAULT_SPRITE_OPTIONS,
  DEFAULT_VIDEO_OPTIONS
} from '../../../shared/constants'
import type {
  AppSettings,
  CreateTasksRequest,
  MediaInspection,
  MediaTask,
  TaskProgressUpdate,
  TaskSnapshot,
  TaskStateUpdate,
  VVToolsApi
} from '../../../shared/types'
import { useAppStore } from './app'

const settings: AppSettings = {
  desktop: normalizeDesktopSettings(undefined),
  common: {
    concurrency: DEFAULT_CONCURRENCY_SETTINGS,
    closeBehavior: 'ask',
    outputMode: 'custom',
    outputDirectory: '/tmp',
    outputNameTemplate: '{name}{suffix}',
    outputConflictPolicy: 'rename'
  },
  image: { outputSuffix: '', lastOptions: DEFAULT_IMAGE_OPTIONS },
  video: { outputSuffix: '', lastOptions: DEFAULT_VIDEO_OPTIONS },
  sprite: { outputSuffix: '', lastOptions: DEFAULT_SPRITE_OPTIONS },
  audio: { outputSuffix: '', lastOptions: DEFAULT_AUDIO_OPTIONS },
  pdf: { outputSuffix: '', lastOptions: DEFAULT_PDF_OPTIONS },
  font: { outputSuffix: '', lastOptions: DEFAULT_FONT_OPTIONS },
  rename: DEFAULT_RENAME_SETTINGS
}

function imageTask(id: string, status: MediaTask['status'] = 'processing'): MediaTask {
  return {
    id,
    kind: 'image',
    batchItemId: `${id}-row`,
    sourcePath: `/tmp/${id}.png`,
    outputPath: `/tmp/${id}_out.png`,
    options: { ...DEFAULT_IMAGE_OPTIONS },
    sourceSize: 10,
    status,
    progress: status === 'completed' ? 100 : 0,
    createdAt: '2026-10-05T00:00:00.000Z'
  }
}

function fixture(snapshot: TaskSnapshot | Promise<TaskSnapshot> = { sequence: 0, tasks: [] }): {
  store: ReturnType<typeof useAppStore>
  api: {
    getTasks: Mock<VVToolsApi['getTasks']>
    inspectTasks: Mock<VVToolsApi['inspectTasks']>
    createTasks: Mock<VVToolsApi['createTasks']>
    retryTask: Mock<VVToolsApi['retryTask']>
  }
  disposeTasks: Mock<() => void>
  disposeProgress: Mock<() => void>
  updateTasks: (update: TaskStateUpdate) => void
  updateProgress: (update: TaskProgressUpdate) => void
} {
  let receiveTasks!: (update: TaskStateUpdate) => void
  let receiveProgress!: (update: TaskProgressUpdate) => void
  const disposeTasks = vi.fn()
  const disposeProgress = vi.fn()
  const api = {
    getTasks: vi.fn(async () => snapshot),
    getSettings: async () => settings,
    getVersion: async () => '0.0.19',
    getReleaseNotes: async () => '',
    getSettingsRecoveryNotice: async () => null,
    getUpdateState: async () => ({ status: 'idle' as const }),
    getCapabilities: async () => ({}),
    onTasksChanged: (callback: typeof receiveTasks) => {
      receiveTasks = callback
      return disposeTasks
    },
    onTaskProgressChanged: (callback: typeof receiveProgress) => {
      receiveProgress = callback
      return disposeProgress
    },
    onUpdateChanged: () => () => {},
    inspectTasks: vi.fn<(request: CreateTasksRequest) => Promise<MediaInspection[]>>(
      async () => []
    ),
    createTasks: vi.fn<(request: CreateTasksRequest) => Promise<MediaTask[]>>(),
    retryTask: vi.fn<(id: string) => Promise<MediaTask | null>>()
  }
  vi.stubGlobal('window', { api })
  setActivePinia(createPinia())
  const store = useAppStore()
  return {
    api,
    store,
    disposeTasks,
    disposeProgress,
    updateTasks: (update: TaskStateUpdate) => receiveTasks(update),
    updateProgress: (update: TaskProgressUpdate) => receiveProgress(update)
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('task state deltas', () => {
  it('updates progress and state in place without rebuilding batch rows', async () => {
    const first = imageTask('first')
    const second = imageTask('second')
    const { store, updateTasks, updateProgress } = fixture({ sequence: 0, tasks: [first, second] })
    try {
      await store.initialize()
      const task = store.tasks[0]
      const taskList = store.tasks
      const batch = store.currentBatchTasks
      const batchRows = batch.image
      const buildRows = vi.fn(() => store.currentBatchTasks.image.map((item) => item.id))
      const rows = computed(buildRows)
      expect(rows.value).toEqual(['first', 'second'])
      for (let sequence = 1; sequence <= 40; sequence += 1) {
        updateProgress({ sequence, id: first.id, progress: sequence })
        expect(rows.value).toEqual(['first', 'second'])
      }
      expect(store.tasks[0]).toBe(task)
      expect(store.tasks).toBe(taskList)
      expect(store.currentBatchTasks).toBe(batch)
      expect(store.currentBatchTasks.image).toBe(batchRows)
      expect(buildRows).toHaveBeenCalledOnce()
      expect(task.progress).toBe(40)
      updateTasks({
        sequence: 41,
        tasks: [{ ...first, status: 'completed', progress: 100 }],
        removedTaskIds: []
      })
      expect(store.tasks[0]).toBe(task)
      expect(store.currentBatchTasks.image).toBe(batchRows)
      expect(rows.value).toEqual(['first', 'second'])
      expect(buildRows).toHaveBeenCalledOnce()
      expect(store.activeCount).toBe(1)
      expect(task.status).toBe('completed')
    } finally {
      store.dispose()
    }
  })

  it('merges changed tasks and removals without disturbing row order or unchanged task identity', async () => {
    const first = imageTask('first')
    const second = imageTask('second')
    const { store, updateTasks, updateProgress } = fixture({ sequence: 0, tasks: [first, second] })
    try {
      await store.initialize()
      expect(store.errorMessage).toBe('')
      const unchanged = store.tasks[1]
      updateTasks({
        sequence: 1,
        tasks: [{ ...first, status: 'completed', progress: 100 }],
        removedTaskIds: []
      })
      expect(store.currentBatchTasks.image.map(({ id, status }) => ({ id, status }))).toEqual([
        { id: 'first', status: 'completed' },
        { id: 'second', status: 'processing' }
      ])
      expect(store.tasks[1]).toBe(unchanged)
      updateProgress({ sequence: 2, id: second.id, progress: 25 })
      updateTasks({ sequence: 1, tasks: [{ ...second, status: 'failed' }], removedTaskIds: [] })
      updateProgress({ sequence: 2, id: second.id, progress: 99 })
      expect(store.tasks[1]).toMatchObject({ status: 'processing', progress: 25 })
      const replacement = { ...imageTask('replacement'), batchItemId: first.batchItemId }
      updateTasks({ sequence: 3, tasks: [replacement], removedTaskIds: [first.id] })
      expect(store.currentBatchTasks.image.map((task) => task.id)).toEqual([
        'replacement',
        'second'
      ])
      expect(store.tasks.map((task) => task.id)).toEqual(['second', 'replacement'])
      expect(store.activeCount).toBe(2)
    } finally {
      store.dispose()
    }
  })

  it('replays only newer updates received while the initial snapshot is loading', async () => {
    const first = imageTask('first')
    const second = imageTask('second')
    const third = imageTask('third')
    let resolveSnapshot!: (snapshot: TaskSnapshot) => void
    const pending = new Promise<TaskSnapshot>((resolve) => (resolveSnapshot = resolve))
    const { store, updateTasks, updateProgress } = fixture(pending)
    try {
      const initializing = store.initialize()
      updateTasks({ sequence: 2, tasks: [{ ...second, status: 'failed' }], removedTaskIds: [] })
      updateTasks({
        sequence: 4,
        tasks: [{ ...first, status: 'completed', progress: 100 }],
        removedTaskIds: []
      })
      updateProgress({ sequence: 5, id: second.id, progress: 66 })
      updateTasks({ sequence: 6, tasks: [third], removedTaskIds: [] })
      resolveSnapshot({ sequence: 3, tasks: [first, second] })
      await initializing
      expect(store.errorMessage).toBe('')
      expect(
        store.currentBatchTasks.image.map(({ id, status, progress }) => ({ id, status, progress }))
      ).toEqual([
        { id: 'first', status: 'completed', progress: 100 },
        { id: 'second', status: 'processing', progress: 66 },
        { id: 'third', status: 'processing', progress: 0 }
      ])
      updateProgress({ sequence: 7, id: third.id, progress: 40 })
      expect(store.currentBatchTasks.image[2].progress).toBe(40)
    } finally {
      store.dispose()
    }
  })

  it('keeps completed event state when create returns an older pending task', async () => {
    const task = imageTask('created', 'pending')
    const { store, api, updateTasks } = fixture()
    api.inspectTasks.mockResolvedValue([
      { sourcePath: task.sourcePath, outputPath: task.outputPath, valid: true, sourceSize: 10 }
    ])
    api.createTasks.mockImplementation(async () => {
      updateTasks({
        sequence: 1,
        tasks: [{ ...task, status: 'completed', progress: 100 }],
        removedTaskIds: []
      })
      return [task]
    })
    try {
      await store.initialize()
      const result = await store.submitTasks({
        kind: 'image',
        sources: [{ path: task.sourcePath, relativeDirectory: '' }],
        batchItemIds: [task.batchItemId!],
        outputMode: 'custom',
        outputDirectory: '/tmp',
        outputSuffix: '',
        options: { ...DEFAULT_IMAGE_OPTIONS }
      })
      expect(result).toEqual({
        handledPaths: [task.sourcePath],
        handledBatchItemIds: [task.batchItemId]
      })
      expect(store.currentBatchTasks.image).toHaveLength(1)
      expect(store.currentBatchTasks.image[0]).toMatchObject({
        id: task.id,
        status: 'completed',
        progress: 100
      })
    } finally {
      store.dispose()
    }
  })

  it('keeps completed retry event state and replaces the failed row only once', async () => {
    const original = imageTask('failed', 'failed')
    const retried = { ...original, id: 'retried', retryOf: original.id, status: 'pending' as const }
    const { store, api, updateTasks } = fixture({
      sequence: 0,
      tasks: [{ ...original, status: 'processing' }]
    })
    api.retryTask.mockImplementation(async () => {
      updateTasks({
        sequence: 2,
        tasks: [{ ...retried, status: 'completed', progress: 100 }],
        removedTaskIds: []
      })
      return retried
    })
    try {
      await store.initialize()
      updateTasks({ sequence: 1, tasks: [original], removedTaskIds: [] })
      await store.retryTask(original.id)
      expect(api.retryTask).toHaveBeenCalledWith(original.id)
      expect(store.currentBatchTasks.image.map(({ id, status }) => ({ id, status }))).toEqual([
        { id: 'retried', status: 'completed' }
      ])
      expect(store.tasks.find((task) => task.id === retried.id)?.progress).toBe(100)
    } finally {
      store.dispose()
    }
  })

  it('unsubscribes buffered task listeners when initialization fails', async () => {
    const { store, api, disposeTasks, disposeProgress } = fixture()
    api.getTasks.mockRejectedValueOnce(new Error('snapshot failed'))
    await store.initialize()
    expect(store.errorMessage).toBe('snapshot failed')
    expect(disposeTasks).toHaveBeenCalledOnce()
    expect(disposeProgress).toHaveBeenCalledOnce()
  })
  it('mirrors settled desktop rows on initial load without exposing unrelated settled tasks', async () => {
    const first = { ...imageTask('native-first', 'completed'), desktopRequestId: 'request' }
    const second = { ...imageTask('native-second', 'failed'), desktopRequestId: 'request' }
    const { store } = fixture({
      sequence: 2,
      tasks: [imageTask('old', 'completed'), first, second]
    })
    try {
      await store.initialize()
      expect(store.currentBatchTasks.image.map((task) => task.id)).toEqual([
        'native-first',
        'native-second'
      ])
      store.stageDesktopFiles({
        id: 'show-result',
        path: '/image',
        paths: ['/tmp/conflict.png', '/tmp/conflict.png'],
        notice: '输出已存在',
        preserveBatch: true
      })
      expect(store.currentBatchTasks.image.map((task) => task.id)).toEqual([
        'native-first',
        'native-second'
      ])
      expect(store.pendingImageInputs).toEqual([
        { path: '/tmp/conflict.png', relativeDirectory: '' }
      ])
      expect(store.errorMessage).toBe('输出已存在')
    } finally {
      store.dispose()
    }
  })

  it('appends external rows to an active batch and replaces settled results only for a new batch', async () => {
    const existing = imageTask('existing')
    const native = { ...imageTask('native'), desktopRequestId: 'request' }
    const { store, updateTasks } = fixture({ sequence: 0, tasks: [existing] })
    try {
      await store.initialize()
      updateTasks({ sequence: 1, tasks: [native], removedTaskIds: [] })
      expect(store.currentBatchTasks.image.map((task) => task.id)).toEqual(['existing', 'native'])
      updateTasks({
        sequence: 2,
        tasks: [
          { ...existing, status: 'completed' },
          { ...native, status: 'completed' }
        ],
        removedTaskIds: []
      })
      expect(store.currentBatchTasks.image.map((task) => task.id)).toEqual(['existing', 'native'])
      const next = { ...imageTask('next'), desktopRequestId: 'next-request' }
      updateTasks({ sequence: 3, tasks: [next], removedTaskIds: ['existing', 'native'] })
      expect(store.currentBatchTasks.image.map((task) => task.id)).toEqual(['next'])
    } finally {
      store.dispose()
    }
  })

  it('keeps other native rows and their order when a settled native row is retried', async () => {
    const original = { ...imageTask('failed', 'failed'), desktopRequestId: 'request' }
    const completed = { ...imageTask('completed', 'completed'), desktopRequestId: 'request' }
    const { store, updateTasks } = fixture({ sequence: 0, tasks: [original, completed] })
    try {
      await store.initialize()
      const retry = {
        ...original,
        id: 'retry',
        retryOf: original.id,
        status: 'processing' as const
      }
      updateTasks({ sequence: 1, tasks: [retry], removedTaskIds: [original.id] })
      expect(store.currentBatchTasks.image.map((task) => task.id)).toEqual(['retry', 'completed'])
    } finally {
      store.dispose()
    }
  })
})
