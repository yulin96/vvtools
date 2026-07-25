import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  AppSettings,
  CreateTasksRequest,
  MediaInspection,
  MediaTask,
  RuntimeCapabilities
} from '../../../shared/types'

export const useAppStore = defineStore('app', () => {
  const tasks = ref<MediaTask[]>([])
  const settings = ref<AppSettings | null>(null)
  const capabilities = ref<RuntimeCapabilities | null>(null)
  const queuePaused = ref(false)
  const errorMessage = ref('')
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

  async function createTasks(request: CreateTasksRequest): Promise<boolean> {
    try {
      await window.api.createTasks(request)
      return true
    } catch (error) {
      reportError(error)
      return false
    }
  }

  async function inspectTasks(request: CreateTasksRequest): Promise<MediaInspection[] | null> {
    try {
      return await window.api.inspectTasks(request)
    } catch (error) {
      reportError(error)
      return null
    }
  }

  async function updateSettings(input: Partial<AppSettings>): Promise<void> {
    try {
      const serializableInput = JSON.parse(JSON.stringify(input)) as Partial<AppSettings>
      settings.value = await window.api.updateSettings(serializableInput)
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
    activeCount,
    initialize,
    refreshCapabilities,
    createTasks,
    inspectTasks,
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
