import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  AppSettings,
  CreateTasksRequest,
  MediaTask,
  RuntimeCapabilities
} from '../../../shared/types'

export const useAppStore = defineStore('app', () => {
  const tasks = ref<MediaTask[]>([])
  const settings = ref<AppSettings | null>(null)
  const capabilities = ref<RuntimeCapabilities | null>(null)
  const errorMessage = ref('')
  let unsubscribe: (() => void) | null = null

  const activeCount = computed(
    () => tasks.value.filter((task) => ['pending', 'processing'].includes(task.status)).length
  )

  async function initialize(): Promise<void> {
    try {
      const [initialTasks, initialSettings] = await Promise.all([
        window.api.getTasks(),
        window.api.getSettings()
      ])
      tasks.value = initialTasks
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

  async function createTasks(request: CreateTasksRequest): Promise<void> {
    try {
      await window.api.createTasks(request)
    } catch (error) {
      reportError(error)
    }
  }

  async function updateSettings(input: Partial<AppSettings>): Promise<void> {
    try {
      settings.value = await window.api.updateSettings(input)
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

  async function openTaskOutput(id: string): Promise<void> {
    try {
      await window.api.openTaskOutput(id)
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
    activeCount,
    initialize,
    refreshCapabilities,
    createTasks,
    updateSettings,
    cancelTask,
    retryTask,
    openTaskOutput
  }
})
