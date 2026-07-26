import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  AppSettings,
  CreateTasksRequest,
  ImageInputFile,
  MediaTask,
  RuntimeCapabilities,
  TaskKind
} from '../../../shared/types'

interface TaskSubmissionResult {
  handledPaths: string[]
}

function serializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export const useAppStore = defineStore('app', () => {
  const tasks = ref<MediaTask[]>([])
  const settings = ref<AppSettings | null>(null)
  const capabilities = ref<RuntimeCapabilities | null>(null)
  const errorMessage = ref('')
  const pendingImageInputs = ref<ImageInputFile[]>([])
  const pendingVideoPaths = ref<string[]>([])
  const pendingAudioPaths = ref<string[]>([])
  const currentBatchTaskIds = ref<Record<TaskKind, string[]>>({
    image: [],
    video: [],
    audio: []
  })
  let unsubscribe: (() => void) | null = null

  const activeCount = computed(
    () => tasks.value.filter((task) => ['pending', 'processing'].includes(task.status)).length
  )
  const currentBatchTasks = computed<Record<TaskKind, MediaTask[]>>(() => {
    const tasksById = new Map(tasks.value.map((task) => [task.id, task]))
    return {
      image: currentBatchTaskIds.value.image.flatMap((id) => {
        const task = tasksById.get(id)
        return task ? [task] : []
      }),
      video: currentBatchTaskIds.value.video.flatMap((id) => {
        const task = tasksById.get(id)
        return task ? [task] : []
      }),
      audio: currentBatchTaskIds.value.audio.flatMap((id) => {
        const task = tasksById.get(id)
        return task ? [task] : []
      })
    }
  })

  function appendCurrentBatchTasks(nextTasks: MediaTask[]): void {
    for (const kind of ['image', 'video', 'audio'] as const) {
      const ids = nextTasks.filter((task) => task.kind === kind).map((task) => task.id)
      if (ids.length === 0) continue
      currentBatchTaskIds.value[kind] = [...new Set([...currentBatchTaskIds.value[kind], ...ids])]
    }
  }

  function prepareCurrentBatch(kind: TaskKind): void {
    const currentTasks = currentBatchTasks.value[kind]
    if (
      currentTasks.length > 0 &&
      currentTasks.every((task) => !['pending', 'processing'].includes(task.status))
    ) {
      currentBatchTaskIds.value[kind] = []
    }
  }

  async function initialize(): Promise<void> {
    try {
      const [initialTasks, initialSettings] = await Promise.all([
        window.api.getTasks(),
        window.api.getSettings()
      ])
      tasks.value = initialTasks
      appendCurrentBatchTasks(
        initialTasks.filter((task) => ['pending', 'processing'].includes(task.status))
      )
      settings.value = initialSettings
      unsubscribe?.()
      unsubscribe = window.api.onTasksChanged((nextTasks) => (tasks.value = nextTasks))
      void refreshCapabilities()
    } catch (error) {
      reportError(error)
    }
  }

  async function refreshCapabilities(): Promise<void> {
    try {
      capabilities.value = await window.api.getCapabilities()
    } catch (error) {
      reportError(error)
    }
  }

  async function submitTasks(request: CreateTasksRequest): Promise<TaskSubmissionResult | null> {
    try {
      const inspectedRequest = serializable(request)
      const inspections = await window.api.inspectTasks(inspectedRequest)
      const handled = inspections.filter((item) => item.valid || item.skipped)
      const rejected = inspections.filter((item) => !item.valid && !item.skipped)
      if (handled.length === 0) {
        errorMessage.value =
          rejected.length === 1
            ? (rejected[0].error ?? '文件无法处理')
            : `${rejected.length} 个文件无法处理，请检查源文件和输出设置`
        return null
      }

      const sourceReplacementCount = handled.filter(
        (item) => item.valid && item.replacesSource
      ).length
      if (
        sourceReplacementCount > 0 &&
        !(await window.api.confirmSourceReplacement(sourceReplacementCount))
      ) {
        return null
      }

      const handledPaths = handled.map((item) => item.sourcePath)
      const handledPathSet = new Set(handledPaths)
      const inputMetadata = handled.map((item) => ({
        path: item.sourcePath,
        width: item.outputWidth ?? item.width,
        height: item.outputHeight ?? item.height
      }))
      const submission: CreateTasksRequest =
        inspectedRequest.kind === 'image'
          ? {
              ...inspectedRequest,
              sources: inspectedRequest.sources.filter((source) => handledPathSet.has(source.path)),
              inputMetadata
            }
          : {
              ...inspectedRequest,
              sourcePaths: inspectedRequest.sourcePaths.filter((path) => handledPathSet.has(path)),
              inputMetadata: inspectedRequest.kind === 'video' ? inputMetadata : undefined
            }

      const createdTasks = await window.api.createTasks(serializable(submission))
      const createdIds = new Set(createdTasks.map((task) => task.id))
      tasks.value = [...tasks.value.filter((task) => !createdIds.has(task.id)), ...createdTasks]
      appendCurrentBatchTasks(createdTasks)
      if (rejected.length > 0) {
        errorMessage.value = `${rejected.length} 个文件未加入任务：${rejected[0].error ?? '文件无法处理'}`
      }
      return { handledPaths }
    } catch (error) {
      reportError(error)
      return null
    }
  }

  async function updateSettings(input: Partial<AppSettings>): Promise<void> {
    try {
      settings.value = await window.api.updateSettings(serializable(input))
    } catch (error) {
      reportError(error)
    }
  }

  async function cancelTask(id: string): Promise<void> {
    try {
      await window.api.cancelTask(id)
    } catch (error) {
      reportError(error)
    }
  }

  async function retryTask(id: string): Promise<void> {
    try {
      const task = await window.api.retryTask(id)
      if (task) {
        tasks.value = [...tasks.value.filter((item) => item.id !== task.id), task]
        appendCurrentBatchTasks([task])
      }
    } catch (error) {
      reportError(error)
    }
  }

  async function openTaskOutput(id: string): Promise<void> {
    try {
      await window.api.openTaskOutput(id)
    } catch (error) {
      reportError(error)
    }
  }

  async function openOutputDirectory(): Promise<void> {
    try {
      await window.api.openOutputDirectory()
    } catch (error) {
      reportError(error)
    }
  }

  function reportError(error: unknown): void {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }

  return {
    tasks,
    settings,
    capabilities,
    errorMessage,
    pendingImageInputs,
    pendingVideoPaths,
    pendingAudioPaths,
    currentBatchTasks,
    prepareCurrentBatch,
    activeCount,
    initialize,
    refreshCapabilities,
    submitTasks,
    updateSettings,
    cancelTask,
    retryTask,
    openTaskOutput,
    openOutputDirectory
  }
})
