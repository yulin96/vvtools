import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  AppSettings,
  AppSettingsPatch,
  CreateTasksRequest,
  FontConversionSubsetPreset,
  FontFormat,
  ImageInputFile,
  MediaInspection,
  MediaTask,
  RuntimeCapabilities,
  TaskKind,
  UpdateState
} from '../../../shared/types'

interface TaskSubmissionResult {
  handledPaths: string[]
}

export interface PendingFontItem {
  id: string
  path: string
  outputFormat: FontFormat
  subsetPreset?: FontConversionSubsetPreset
}

function serializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function friendlyErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': Error: /u, '')
}

function submissionNotice(
  skippedCount: number,
  rejected: Pick<MediaInspection, 'error'>[]
): string {
  const parts: string[] = []
  if (skippedCount > 0) {
    parts.push(`${skippedCount} 个文件因输出已存在而未开始，已保留在待处理列表`)
  }
  if (rejected.length === 1) parts.push(rejected[0].error ?? '1 个文件无法处理')
  else if (rejected.length > 1)
    parts.push(`${rejected.length} 个文件无法处理，请检查源文件和输出设置`)
  return parts.join('；') || '没有可处理的文件'
}

export const useAppStore = defineStore('app', () => {
  const tasks = ref<MediaTask[]>([])
  const settings = ref<AppSettings | null>(null)
  const capabilities = ref<RuntimeCapabilities | null>(null)
  const appVersion = ref('')
  const currentReleaseNotes = ref('')
  const updateState = ref<UpdateState>({ status: 'idle' })
  const updateDialog = ref<'available' | 'downloaded' | 'failed' | null>(null)
  const errorMessage = ref('')
  const pendingImageInputs = ref<ImageInputFile[]>([])
  const pendingVideoPaths = ref<string[]>([])
  const pendingAudioPaths = ref<string[]>([])
  const pendingPdfPaths = ref<string[]>([])
  const pendingFontItems = ref<PendingFontItem[]>([])
  const currentBatchTaskIds = ref<Record<TaskKind, string[]>>({
    image: [],
    video: [],
    audio: [],
    pdf: [],
    font: []
  })
  let unsubscribe: (() => void) | null = null
  let unsubscribeProgress: (() => void) | null = null
  let unsubscribeUpdates: (() => void) | null = null
  let promptedAvailableVersion = ''
  let promptedDownloadedVersion = ''
  let promptedFailedVersion = ''

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
      }),
      pdf: currentBatchTaskIds.value.pdf.flatMap((id) => {
        const task = tasksById.get(id)
        return task ? [task] : []
      }),
      font: currentBatchTaskIds.value.font.flatMap((id) => {
        const task = tasksById.get(id)
        return task ? [task] : []
      })
    }
  })
  const updateDescription = computed(() => {
    if (updateState.value.status === 'checking') return '正在检查新版本…'
    if (updateState.value.status === 'available') {
      return `发现新版本 ${updateState.value.version ?? ''}`
    }
    if (updateState.value.status === 'downloading') {
      return `正在下载新版本：${updateState.value.percent ?? 0}%`
    }
    if (updateState.value.status === 'downloaded') {
      return `新版本 ${updateState.value.version ?? ''} 已下载，重启后安装`
    }
    if (updateState.value.status === 'error') {
      if (updateState.value.version) return '自动更新失败，可前往 GitHub 手动下载'
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
    if (updateState.value.status === 'available') return '下载更新'
    if (updateState.value.status === 'downloading') return `${updateState.value.percent ?? 0}%`
    if (updateState.value.status === 'downloaded') return '重启安装'
    if (updateState.value.status === 'error' && updateState.value.version) return '手动下载'
    return '检查更新'
  })

  function appendCurrentBatchTasks(nextTasks: MediaTask[]): void {
    for (const kind of ['image', 'video', 'audio', 'pdf', 'font'] as const) {
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
      const [initialTasks, initialSettings, version, releaseNotes, recoveryNotice] =
        await Promise.all([
          window.api.getTasks(),
          window.api.getSettings(),
          window.api.getVersion(),
          window.api.getReleaseNotes(),
          window.api.getSettingsRecoveryNotice()
        ])
      tasks.value = initialTasks
      appendCurrentBatchTasks(
        initialTasks.filter((task) => ['pending', 'processing'].includes(task.status))
      )
      settings.value = initialSettings
      appVersion.value = version
      currentReleaseNotes.value = releaseNotes
      if (recoveryNotice) errorMessage.value = recoveryNotice
      unsubscribe?.()
      unsubscribe = window.api.onTasksChanged((nextTasks) => (tasks.value = nextTasks))
      unsubscribeProgress?.()
      unsubscribeProgress = window.api.onTaskProgressChanged(({ id, progress }) => {
        const index = tasks.value.findIndex((task) => task.id === id)
        if (index < 0 || tasks.value[index].progress === progress) return
        tasks.value[index] = { ...tasks.value[index], progress }
      })
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
      const processable = inspections.filter((item) => item.valid)
      const skipped = inspections.filter((item) => item.skipped)
      const rejected = inspections.filter((item) => !item.valid && !item.skipped)
      if (processable.length === 0) {
        errorMessage.value = submissionNotice(skipped.length, rejected)
        return { handledPaths: [] }
      }

      const overwritePaths = processable
        .filter((item) => item.overwritesSource)
        .map((item) => item.sourcePath)
      if (
        overwritePaths.length > 0 &&
        !(await window.api.confirmSourceOverwrite([...new Set(overwritePaths)]))
      ) {
        return null
      }

      const inputMetadata = [
        ...new Map(
          processable.map((item) => [
            item.sourcePath,
            {
              path: item.sourcePath,
              width: item.outputWidth ?? item.width,
              height: item.outputHeight ?? item.height,
              pageCount: item.pageCount,
              fontCount: item.fontCount,
              fontInstances: item.fontInstances?.length ? item.fontInstances : undefined
            }
          ])
        ).values()
      ]
      const submission: CreateTasksRequest =
        inspectedRequest.kind === 'image'
          ? {
              ...inspectedRequest,
              sources: inspectedRequest.sources.filter((_, index) => inspections[index]?.valid),
              inputMetadata
            }
          : inspectedRequest.kind === 'font'
            ? {
                ...inspectedRequest,
                sources: inspectedRequest.sources.filter((_, index) => inspections[index]?.valid),
                inputMetadata
              }
            : {
                ...inspectedRequest,
                sourcePaths: inspectedRequest.sourcePaths.filter(
                  (_, index) => inspections[index]?.valid
                ),
                inputMetadata
              }

      const createdTasks = await window.api.createTasks(serializable(submission))
      const handledInspections = processable.filter((inspection) =>
        createdTasks.some(
          (task) =>
            task.sourcePath === inspection.sourcePath &&
            (task.outputPath === inspection.outputPath ||
              inspection.outputPaths?.includes(task.outputPath))
        )
      )
      const handledPaths = handledInspections.map((item) => item.sourcePath)
      const createdIds = new Set(createdTasks.map((task) => task.id))
      tasks.value = [...tasks.value.filter((task) => !createdIds.has(task.id)), ...createdTasks]
      appendCurrentBatchTasks(createdTasks)
      const skippedCount = skipped.length + (processable.length - handledInspections.length)
      if (skippedCount > 0 || rejected.length > 0) {
        errorMessage.value = submissionNotice(skippedCount, rejected)
      }
      return { handledPaths }
    } catch (error) {
      reportError(error)
      return null
    }
  }

  async function updateSettings(input: AppSettingsPatch): Promise<void> {
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
    if (state.status === 'available' && state.version !== promptedAvailableVersion) {
      promptedAvailableVersion = state.version || 'latest'
      updateDialog.value = 'available'
    }
    if (state.status === 'downloaded' && state.version !== promptedDownloadedVersion) {
      promptedDownloadedVersion = state.version || 'latest'
      updateDialog.value = 'downloaded'
    }
    if (state.status === 'error' && state.version && state.version !== promptedFailedVersion) {
      promptedFailedVersion = state.version
      updateDialog.value = 'failed'
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
    if (updateState.value.status === 'error' && updateState.value.version) {
      updateDialog.value = 'failed'
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
        await window.api.downloadUpdate()
      } else if (action === 'downloaded') {
        await window.api.installUpdate()
      } else if (action === 'failed') {
        await window.api.openReleasePage()
      }
    } catch (error) {
      reportError(error)
    }
  }

  function dispose(): void {
    unsubscribe?.()
    unsubscribe = null
    unsubscribeProgress?.()
    unsubscribeProgress = null
    unsubscribeUpdates?.()
    unsubscribeUpdates = null
  }

  function reportError(error: unknown): void {
    errorMessage.value = friendlyErrorMessage(error)
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
    pendingPdfPaths,
    pendingFontItems,
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
