import { dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { existsSync, statSync } from 'fs'
import { dirname, extname, isAbsolute } from 'path'
import type {
  AppSettings,
  CreateTasksRequest,
  ImageFormat,
  RuntimeCapabilities,
  TaskKind,
  VideoQuality,
  VideoResolution
} from '../shared/types'
import { IMAGE_EXTENSIONS, IPC_CHANNELS, VIDEO_EXTENSIONS } from '../shared/constants'
import { getRuntimeCapabilities } from './media/ffmpeg-runtime'
import { SettingsStore, clampConcurrency } from './services/settings-store'
import { TaskQueue } from './services/task-queue'

const VIDEO_QUALITIES = new Set<VideoQuality>(['high', 'balanced', 'small'])
const VIDEO_RESOLUTIONS = new Set<VideoResolution>(['source', '1080p', '720p'])
const VIDEO_FORMATS = new Set(['mp4', 'mov', 'mkv'])
const VIDEO_CODECS = new Set(['h264', 'h265'])
const VIDEO_RATE_CONTROLS = new Set(['quality', 'bitrate'])
const VIDEO_FRAME_RATES = new Set(['source', '24', '25', '30', '60'])
const VIDEO_AUDIO_MODES = new Set(['aac', 'copy', 'none'])
const IMAGE_FORMATS = new Set<ImageFormat>(['original', 'jpeg', 'png', 'webp'])

function assertTrusted(event: IpcMainInvokeEvent, window: BrowserWindow): void {
  if (event.sender !== window.webContents) throw new Error('拒绝来自未知页面的请求')
}

function validateSourcePath(path: string, kind: TaskKind): void {
  if (
    typeof path !== 'string' ||
    !isAbsolute(path) ||
    !existsSync(path) ||
    !statSync(path).isFile()
  ) {
    throw new Error(`文件不存在或不可访问：${path}`)
  }
  const extensions = kind === 'video' ? VIDEO_EXTENSIONS : IMAGE_EXTENSIONS
  if (!extensions.has(extname(path).toLowerCase())) throw new Error(`不支持的文件格式：${path}`)
}

function validateCreateRequest(value: unknown): CreateTasksRequest {
  if (!value || typeof value !== 'object') throw new Error('任务参数无效')
  const request = value as CreateTasksRequest
  if (!['video', 'image'].includes(request.kind)) throw new Error('任务类型无效')
  if (!Array.isArray(request.sourcePaths) || request.sourcePaths.length === 0) {
    throw new Error('请至少选择一个文件')
  }
  if (request.sourcePaths.length > 500) throw new Error('单次最多添加 500 个文件')
  if (request.kind === 'image' || (request.kind === 'video' && request.outputMode === 'custom')) {
    if (!request.outputDirectory || !isAbsolute(request.outputDirectory)) {
      throw new Error('输出目录无效')
    }
  }
  request.sourcePaths.forEach((path) => validateSourcePath(path, request.kind))

  if (request.kind === 'video') {
    if (!VIDEO_QUALITIES.has(request.options.quality)) throw new Error('视频质量参数无效')
    if (!VIDEO_RESOLUTIONS.has(request.options.resolution)) throw new Error('视频分辨率参数无效')
    if (!['source', 'custom'].includes(request.outputMode)) throw new Error('输出位置参数无效')
    if (!VIDEO_FORMATS.has(request.options.format)) throw new Error('视频格式参数无效')
    if (!VIDEO_CODECS.has(request.options.codec)) throw new Error('视频编码参数无效')
    if (!VIDEO_RATE_CONTROLS.has(request.options.rateControl)) throw new Error('码率模式参数无效')
    if (
      !Number.isFinite(request.options.bitrateMbps) ||
      request.options.bitrateMbps < 0.5 ||
      request.options.bitrateMbps > 100
    ) {
      throw new Error('视频码率必须在 0.5–100 Mbps 之间')
    }
    if (!VIDEO_FRAME_RATES.has(request.options.frameRate)) throw new Error('帧率参数无效')
    if (!VIDEO_AUDIO_MODES.has(request.options.audioMode)) throw new Error('音频模式参数无效')
    if (![96, 128, 192, 256].includes(request.options.audioBitrateKbps)) {
      throw new Error('音频码率参数无效')
    }
  } else {
    if (
      !Number.isInteger(request.options.quality) ||
      request.options.quality < 1 ||
      request.options.quality > 100
    ) {
      throw new Error('图片质量必须是 1–100 的整数')
    }
    if (!IMAGE_FORMATS.has(request.options.format)) throw new Error('图片输出格式无效')
  }
  return structuredClone(request)
}

function sanitizeSettings(input: unknown): Partial<AppSettings> {
  if (!input || typeof input !== 'object') throw new Error('设置参数无效')
  const value = input as Partial<AppSettings>
  const result: Partial<AppSettings> = {}
  if (value.concurrency !== undefined) result.concurrency = clampConcurrency(value.concurrency)
  if (value.outputDirectory !== undefined) {
    if (typeof value.outputDirectory !== 'string' || !isAbsolute(value.outputDirectory)) {
      throw new Error('输出目录无效')
    }
    result.outputDirectory = value.outputDirectory
  }
  if (value.videoOutputMode !== undefined) {
    if (!['source', 'custom'].includes(value.videoOutputMode)) throw new Error('输出位置参数无效')
    result.videoOutputMode = value.videoOutputMode
  }
  if (value.video) {
    if (
      !VIDEO_QUALITIES.has(value.video.quality) ||
      !VIDEO_RESOLUTIONS.has(value.video.resolution) ||
      !VIDEO_FORMATS.has(value.video.format) ||
      !VIDEO_CODECS.has(value.video.codec) ||
      !VIDEO_RATE_CONTROLS.has(value.video.rateControl) ||
      !Number.isFinite(value.video.bitrateMbps) ||
      value.video.bitrateMbps < 0.5 ||
      value.video.bitrateMbps > 100 ||
      !VIDEO_FRAME_RATES.has(value.video.frameRate) ||
      !VIDEO_AUDIO_MODES.has(value.video.audioMode) ||
      ![96, 128, 192, 256].includes(value.video.audioBitrateKbps)
    ) {
      throw new Error('视频默认参数无效')
    }
    result.video = structuredClone(value.video)
  }
  if (value.image) {
    if (
      !Number.isInteger(value.image.quality) ||
      value.image.quality < 1 ||
      value.image.quality > 100 ||
      !IMAGE_FORMATS.has(value.image.format)
    ) {
      throw new Error('图片默认参数无效')
    }
    result.image = structuredClone(value.image)
  }
  return result
}

export function registerIpc(
  getWindow: () => BrowserWindow | null,
  queue: TaskQueue,
  settings: SettingsStore
): () => void {
  const window = (): BrowserWindow => {
    const current = getWindow()
    if (!current || current.isDestroyed()) throw new Error('主窗口不可用')
    return current
  }
  const handle = <T extends unknown[]>(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: T) => unknown
  ): void => ipcMain.handle(channel, listener)

  handle(IPC_CHANNELS.selectFiles, async (event, kind: TaskKind) => {
    assertTrusted(event, window())
    if (!['video', 'image'].includes(kind)) throw new Error('文件类型无效')
    const result = await dialog.showOpenDialog(window(), {
      properties: ['openFile', 'multiSelections'],
      filters:
        kind === 'video'
          ? [{ name: '视频文件', extensions: [...VIDEO_EXTENSIONS].map((item) => item.slice(1)) }]
          : [{ name: '图片文件', extensions: [...IMAGE_EXTENSIONS].map((item) => item.slice(1)) }]
    })
    return result.canceled ? [] : result.filePaths
  })

  handle(IPC_CHANNELS.selectOutputDirectory, async (event, current?: string) => {
    assertTrusted(event, window())
    const result = await dialog.showOpenDialog(window(), {
      defaultPath: current && isAbsolute(current) ? current : settings.get().outputDirectory,
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  handle(IPC_CHANNELS.createTasks, (event, request: unknown) => {
    assertTrusted(event, window())
    return queue.create(validateCreateRequest(request))
  })
  handle(IPC_CHANNELS.getTasks, (event) => {
    assertTrusted(event, window())
    return queue.list()
  })
  handle(IPC_CHANNELS.cancelTask, (event, taskId: string) => {
    assertTrusted(event, window())
    return queue.cancel(taskId)
  })
  handle(IPC_CHANNELS.retryTask, (event, taskId: string) => {
    assertTrusted(event, window())
    return queue.retry(taskId)
  })
  handle(IPC_CHANNELS.openTaskOutput, async (event, taskId: string) => {
    assertTrusted(event, window())
    const task = queue.list().find((item) => item.id === taskId)
    if (!task) throw new Error('任务不存在')
    if (existsSync(task.outputPath)) shell.showItemInFolder(task.outputPath)
    else {
      const error = await shell.openPath(dirname(task.outputPath))
      if (error) throw new Error(error)
    }
  })
  handle(IPC_CHANNELS.getSettings, (event) => {
    assertTrusted(event, window())
    return settings.get()
  })
  handle(IPC_CHANNELS.updateSettings, (event, input: unknown) => {
    assertTrusted(event, window())
    const updated = settings.update(sanitizeSettings(input))
    queue.setConcurrency(updated.concurrency)
    return updated
  })
  handle(IPC_CHANNELS.getCapabilities, async (event): Promise<RuntimeCapabilities> => {
    assertTrusted(event, window())
    return getRuntimeCapabilities()
  })

  const notify = (tasks: ReturnType<TaskQueue['list']>): void => {
    const current = getWindow()
    if (current && !current.isDestroyed())
      current.webContents.send(IPC_CHANNELS.tasksChanged, tasks)
  }
  queue.on('changed', notify)

  return () => {
    queue.off('changed', notify)
    for (const channel of Object.values(IPC_CHANNELS)) {
      if (channel !== IPC_CHANNELS.tasksChanged) ipcMain.removeHandler(channel)
    }
  }
}
