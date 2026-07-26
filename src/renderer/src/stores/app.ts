import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  AppSettings,
  CreateTasksRequest,
  ImageInputFile,
  MediaTask,
  RuntimeCapabilities
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
  const queuePaused = ref(false)
  const errorMessage = ref('')
  const pendingImageInputs = ref<ImageInputFile[]>([])
  const pendingVideoPaths = ref<string[]>([])
  const pendingAudioPaths = ref<string[]>([])
  let unsubscribe: (() => void) | null = null

  const activeCount = computed(
    () => tasks.value.filter((task) => ['pending', 'processing'].includes(task.status)).length
  )

  async function initialize(): Promise<void> {
    try {
      const [initialTasks, initialSettings, initialQueuePaused] = await Promise.all([
        window.api.getTasks(),
        window.api.getSettings(),
        window.api.getQueuePaused()
      ])
      tasks.value = initialTasks
      settings.value = initialSettings
      queuePaused.value = initialQueuePaused
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

      await window.api.createTasks(serializable(submission))
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
      await window.api.retryTask(id)
    } catch (error) {
      reportError(error)
    }
  }

  async function retryFailedTasks(): Promise<void> {
    try {
      await window.api.retryFailedTasks()
    } catch (error) {
      reportError(error)
    }
  }

  async function clearFinishedTasks(): Promise<void> {
    try {
      await window.api.clearFinishedTasks()
    } catch (error) {
      reportError(error)
    }
  }

  async function cancelPendingTasks(): Promise<void> {
    try {
      await window.api.cancelPendingTasks()
    } catch (error) {
      reportError(error)
    }
  }

  async function setQueuePaused(paused: boolean): Promise<void> {
    try {
      queuePaused.value = await window.api.setQueuePaused(paused)
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
    queuePaused,
    errorMessage,
    pendingImageInputs,
    pendingVideoPaths,
    pendingAudioPaths,
    activeCount,
    initialize,
    refreshCapabilities,
    submitTasks,
    updateSettings,
    cancelTask,
    retryTask,
    retryFailedTasks,
    clearFinishedTasks,
    cancelPendingTasks,
    setQueuePaused,
    openTaskOutput,
    openOutputDirectory
  }
})
