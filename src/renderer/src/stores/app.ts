import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  AppSettings,
  CreateTasksRequest,
  ImageInputFile,
  MediaTask,
  RuntimeCapabilities,
  TaskKind,
  UpdateState
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
  const appVersion = ref('')
  const currentReleaseNotes = ref('')
  const updateState = ref<UpdateState>({ status: 'idle' })
  const updateDialog = ref<'available' | 'downloaded' | null>(null)
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
  let unsubscribeUpdates: (() => void) | null = null
  let promptedAvailableVersion = ''
  let promptedDownloadedVersion = ''

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
  const updateDescription = computed(() => {
    if (updateState.value.status === 'checking') return '正在检查新版本…'
    if (updateState.value.status === 'available') {
      return window.api.platform === 'darwin'
        ? `发现新版本 ${updateState.value.version ?? ''}，请前往 GitHub 下载`
        : `发现新版本 ${updateState.value.version ?? ''}`
    }
    if (updateState.value.status === 'downloading') {
      return `正在下载新版本：${updateState.value.percent ?? 0}%`
    }
    if (updateState.value.status === 'downloaded') {
      return `新版本 ${updateState.value.version ?? ''} 已下载，重启后安装`
    }
    if (updateState.value.status === 'error') {
      return updateState.value.message
        ? `检查更新失败：${updateState.value.message}`
        : '检查更新失败，请稍后重试'
    }
    if (updateState.value.status === 'unsupported') return '开发模式下不检查更新'
    if (updateState.value.status === 'not-available') return '当前已是最新版本'
    return `当前版本：${appVersion.value || '…'}`
  })
  const updateButtonLabel = computed(() => {
    if (updateState.value.status === 'checking') return '检查中'
    if (updateState.value.status === 'available') {
      return window.api.platform === 'darwin' ? '前往 GitHub' : '下载更新'
    }
    if (updateState.value.status === 'downloading') return `${updateState.value.percent ?? 0}%`
    if (updateState.value.status === 'downloaded') return '重启安装'
    return '检查更新'
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
      const [initialTasks, initialSettings, version, releaseNotes] = await Promise.all([
        window.api.getTasks(),
        window.api.getSettings(),
        window.api.getVersion(),
        window.api.getReleaseNotes()
      ])
      tasks.value = initialTasks
      appendCurrentBatchTasks(
        initialTasks.filter((task) => ['pending', 'processing'].includes(task.status))
      )
      settings.value = initialSettings
      appVersion.value = version
      currentReleaseNotes.value = releaseNotes
      unsubscribe?.()
      unsubscribe = window.api.onTasksChanged((nextTasks) => (tasks.value = nextTasks))
      unsubscribeUpdates?.()
      unsubscribeUpdates = window.api.onUpdateChanged(handleUpdateState)
      handleUpdateState(await window.api.getUpdateState())
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

  function handleUpdateState(state: UpdateState): void {
    updateState.value = state
    if (
      state.status === 'available' &&
      window.api.platform !== 'darwin' &&
      state.version !== promptedAvailableVersion
    ) {
      promptedAvailableVersion = state.version || 'latest'
      updateDialog.value = 'available'
    }
    if (state.status === 'downloaded' && state.version !== promptedDownloadedVersion) {
      promptedDownloadedVersion = state.version || 'latest'
      updateDialog.value = 'downloaded'
    }
  }

  async function requestUpdateAction(): Promise<void> {
    if (updateState.value.status === 'available') {
      updateDialog.value = 'available'
      return
    }
    if (updateState.value.status === 'downloaded') {
      updateDialog.value = 'downloaded'
      return
    }
    if (updateState.value.status === 'checking' || updateState.value.status === 'downloading')
      return
    try {
      handleUpdateState(await window.api.checkForUpdates())
    } catch (error) {
      updateState.value = {
        status: 'error',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async function confirmUpdateAction(): Promise<void> {
    const action = updateDialog.value
    updateDialog.value = null
    try {
      if (action === 'available') {
        if (window.api.platform === 'darwin') await window.api.openReleasePage()
        else await window.api.downloadUpdate()
      } else if (action === 'downloaded') {
        await window.api.installUpdate()
      }
    } catch (error) {
      reportError(error)
    }
  }

  function dispose(): void {
    unsubscribe?.()
    unsubscribe = null
    unsubscribeUpdates?.()
    unsubscribeUpdates = null
  }

  function reportError(error: unknown): void {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }

  return {
    tasks,
    settings,
    capabilities,
    appVersion,
    currentReleaseNotes,
    updateState,
    updateDialog,
    updateDescription,
    updateButtonLabel,
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
    openOutputDirectory,
    requestUpdateAction,
    confirmUpdateAction,
    dispose
  }
})
