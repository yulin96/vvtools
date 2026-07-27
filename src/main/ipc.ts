import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { existsSync, mkdirSync, statSync } from 'fs'
import { readFile } from 'fs/promises'
import { dirname, extname, isAbsolute, join, normalize, sep } from 'path'
import type {
  AppSettings,
  AudioOptions,
  CreateTasksRequest,
  ImageFormat,
  ImageOptions,
  ImagePreset,
  RuntimeCapabilities,
  TaskKind,
  VideoOptions,
  VideoPreset,
  VideoQuality,
  VideoResolution
} from '../shared/types'
import {
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  IPC_CHANNELS,
  VIDEO_EXTENSIONS
} from '../shared/constants'
import { extractVersionReleaseNotes } from '../shared/release-notes.mjs'
import { getRuntimeCapabilities } from './media/ffmpeg-runtime'
import { collectImageInputs } from './media/image-inputs'
import { inspectTasks } from './media/preflight'
import { SettingsStore, clampConcurrency } from './services/settings-store'
import { TaskQueue } from './services/task-queue'
import { UpdateService } from './services/update-service'

const VIDEO_QUALITIES = new Set<VideoQuality>(['high', 'balanced', 'small'])
const VIDEO_RESOLUTIONS = new Set<VideoResolution>(['source', '1080p', '720p'])
const VIDEO_FORMATS = new Set(['source', 'mp4', 'mov', 'mkv'])
const VIDEO_CODECS = new Set(['source', 'h264', 'h265'])
const VIDEO_RATE_CONTROLS = new Set(['quality', 'bitrate'])
const VIDEO_FRAME_RATES = new Set(['source', '24', '25', '30', '60'])
const VIDEO_AUDIO_MODES = new Set(['aac', 'copy', 'none'])
const IMAGE_FORMATS = new Set<ImageFormat>(['original', 'jpeg', 'png', 'webp', 'avif'])

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
  const extensions =
    kind === 'video'
      ? VIDEO_EXTENSIONS
      : kind === 'audio'
        ? new Set([...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS])
        : IMAGE_EXTENSIONS
  if (!extensions.has(extname(path).toLowerCase())) throw new Error(`不支持的文件格式：${path}`)
}

function validateCreateRequest(value: unknown): CreateTasksRequest {
  if (!value || typeof value !== 'object') throw new Error('任务参数无效')
  const request = value as CreateTasksRequest
  if (!['video', 'image', 'audio'].includes(request.kind)) throw new Error('任务类型无效')
  if (!['source', 'custom'].includes(request.outputMode)) throw new Error('输出位置参数无效')
  if (
    request.outputMode === 'custom' &&
    (!request.outputDirectory || !isAbsolute(request.outputDirectory))
  ) {
    throw new Error('输出目录无效')
  }
  request.outputSuffix = sanitizeOutputSuffix(request.outputSuffix)
  request.outputNameTemplate = sanitizeOutputNameTemplate(
    request.outputNameTemplate ?? '{name}{suffix}'
  )
  request.outputConflictPolicy = request.outputConflictPolicy ?? 'rename'
  if (!['rename', 'overwrite', 'skip'].includes(request.outputConflictPolicy)) {
    throw new Error('输出冲突策略无效')
  }
  request.presetName = sanitizePresetName(request.presetName)

  if (request.kind === 'video') {
    if (!Array.isArray(request.sourcePaths) || request.sourcePaths.length === 0) {
      throw new Error('请至少选择一个视频文件')
    }
    if (request.sourcePaths.length > 500) throw new Error('单次最多添加 500 个文件')
    request.sourcePaths.forEach((path) => validateSourcePath(path, 'video'))
    validateVideoOptions(request.options, '视频任务参数无效')
  } else if (request.kind === 'image') {
    if (!Array.isArray(request.sources) || request.sources.length === 0) {
      throw new Error('请至少选择一张图片')
    }
    if (request.sources.length > 500) throw new Error('单次最多添加 500 张图片')
    for (const source of request.sources) {
      if (!source || typeof source !== 'object') throw new Error('图片来源参数无效')
      validateSourcePath(source.path, 'image')
      validateRelativeDirectory(source.relativeDirectory)
    }
    validateImageOptions(request.options, '图片任务参数无效')
  } else {
    if (!Array.isArray(request.sourcePaths) || request.sourcePaths.length === 0) {
      throw new Error('请至少选择一个音频或视频文件')
    }
    if (request.sourcePaths.length > 500) throw new Error('单次最多添加 500 个文件')
    request.sourcePaths.forEach((path) => validateSourcePath(path, 'audio'))
    validateAudioOptions(request.options, '音频任务参数无效')
  }
  request.inputMetadata = sanitizeInputMetadata(
    request.inputMetadata,
    new Set(
      request.kind === 'image' ? request.sources.map((source) => source.path) : request.sourcePaths
    )
  )
  return structuredClone(request)
}

function sanitizeOutputSuffix(value: unknown): string {
  if (typeof value !== 'string') throw new Error('文件名后缀无效')
  const suffix = value.trim()
  const invalidCharacter = [...suffix].some(
    (character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character)
  )
  if (suffix.length > 50 || suffix.endsWith('.') || invalidCharacter) {
    throw new Error('文件名后缀不能超过 50 个字符，且不能包含文件名非法字符')
  }
  return suffix
}

function sanitizeOutputNameTemplate(value: unknown): string {
  if (typeof value !== 'string') throw new Error('输出命名模板无效')
  const template = value.trim()
  const literals = template.replace(/\{(?:name|suffix|preset|width|height|date)\}/gu, '')
  const invalidLiteral = [...literals].some(
    (character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*{}'.includes(character)
  )
  if (!template || template.length > 100 || !template.includes('{name}') || invalidLiteral) {
    throw new Error('输出命名模板必须包含 {name}，长度不能超过 100，且只能使用受支持的变量')
  }
  return template
}

function sanitizePresetName(value: unknown): string {
  if (value === undefined) return '自定义'
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 30) {
    throw new Error('输出预设名称无效')
  }
  return value.trim()
}

function sanitizeInputMetadata(
  value: unknown,
  sourcePaths: ReadonlySet<string>
): CreateTasksRequest['inputMetadata'] {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > sourcePaths.size) {
    throw new Error('媒体尺寸信息无效')
  }
  const paths = new Set<string>()
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('媒体尺寸信息无效')
    const metadata = item as { path?: unknown; width?: unknown; height?: unknown }
    if (
      typeof metadata.path !== 'string' ||
      !sourcePaths.has(metadata.path) ||
      paths.has(metadata.path)
    ) {
      throw new Error('媒体尺寸信息与源文件不匹配')
    }
    for (const dimension of [metadata.width, metadata.height]) {
      if (
        dimension !== undefined &&
        (!Number.isInteger(dimension) ||
          (dimension as number) < 1 ||
          (dimension as number) > 32_768)
      ) {
        throw new Error('媒体尺寸信息无效')
      }
    }
    paths.add(metadata.path)
    return {
      path: metadata.path,
      width: metadata.width as number | undefined,
      height: metadata.height as number | undefined
    }
  })
}

function validateRelativeDirectory(value: string): void {
  if (typeof value !== 'string' || isAbsolute(value)) throw new Error('图片相对目录无效')
  const normalized = normalize(value)
  if (normalized === '..' || normalized.startsWith(`..${sep}`)) {
    throw new Error('图片相对目录无效')
  }
}

function validateVideoOptions(options: VideoOptions, message: string): void {
  if (
    !options ||
    !['auto', 'software', 'hardware'].includes(options.encoderMode) ||
    !VIDEO_QUALITIES.has(options.quality) ||
    !VIDEO_RESOLUTIONS.has(options.resolution) ||
    !VIDEO_FORMATS.has(options.format) ||
    !VIDEO_CODECS.has(options.codec) ||
    !VIDEO_RATE_CONTROLS.has(options.rateControl) ||
    !Number.isFinite(options.bitrateMbps) ||
    options.bitrateMbps < 0.5 ||
    options.bitrateMbps > 100 ||
    !VIDEO_FRAME_RATES.has(options.frameRate) ||
    !VIDEO_AUDIO_MODES.has(options.audioMode) ||
    ![96, 128, 192, 256].includes(options.audioBitrateKbps)
  ) {
    throw new Error(message)
  }
}

function validateImageOptions(options: ImageOptions, message: string): void {
  if (
    !options ||
    !['quality', 'targetSize'].includes(options.compressionMode) ||
    !Number.isInteger(options.quality) ||
    options.quality < 1 ||
    options.quality > 100 ||
    !Number.isInteger(options.targetSizeKb) ||
    options.targetSizeKb < 1 ||
    options.targetSizeKb > 100_000 ||
    !['source', 'width', 'height', 'percentage'].includes(options.resizeMode) ||
    !Number.isInteger(options.width) ||
    options.width < 1 ||
    options.width > 32_768 ||
    !Number.isInteger(options.height) ||
    options.height < 1 ||
    options.height > 32_768 ||
    !Number.isInteger(options.percentage) ||
    options.percentage < 1 ||
    options.percentage > 1000 ||
    typeof options.allowEnlargement !== 'boolean' ||
    typeof options.preserveStructure !== 'boolean' ||
    !['strip', 'colorProfile', 'all'].includes(options.metadataMode) ||
    !IMAGE_FORMATS.has(options.format)
  ) {
    throw new Error(message)
  }
}

function validateAudioOptions(options: AudioOptions, message: string): void {
  if (
    !options ||
    !['mp3', 'm4a', 'wav', 'flac'].includes(options.format) ||
    ![96, 128, 192, 256, 320].includes(options.bitrateKbps) ||
    !['source', 'mono', 'stereo'].includes(options.channels) ||
    typeof options.normalizeLoudness !== 'boolean'
  ) {
    throw new Error(message)
  }
}

function validateVideoPresets(value: unknown): VideoPreset[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new Error('视频预设数量必须在 1–20 个之间')
  }
  const ids = new Set<string>()
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('视频预设参数无效')
    const preset = item as VideoPreset
    const name = typeof preset.name === 'string' ? preset.name.trim() : ''
    if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(preset.id) || ids.has(preset.id)) {
      throw new Error('视频预设标识无效或重复')
    }
    if (!name || name.length > 30) throw new Error('视频预设名称必须是 1–30 个字符')
    validateVideoOptions(preset.options, `视频预设“${name}”的参数无效`)
    ids.add(preset.id)
    return { id: preset.id, name, options: structuredClone(preset.options) }
  })
}

function validateImagePresets(value: unknown): ImagePreset[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new Error('图片预设数量必须在 1–20 个之间')
  }
  const ids = new Set<string>()
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('图片预设参数无效')
    const preset = item as ImagePreset
    const name = typeof preset.name === 'string' ? preset.name.trim() : ''
    if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(preset.id) || ids.has(preset.id)) {
      throw new Error('图片预设标识无效或重复')
    }
    if (!name || name.length > 30) throw new Error('图片预设名称必须是 1–30 个字符')
    validateImageOptions(preset.options, `图片预设“${name}”的参数无效`)
    ids.add(preset.id)
    return { id: preset.id, name, options: structuredClone(preset.options) }
  })
}

function sanitizeSettings(input: unknown): Partial<AppSettings> {
  if (!input || typeof input !== 'object') throw new Error('设置参数无效')
  const value = input as Partial<AppSettings>
  const result: Partial<AppSettings> = {}
  if (value.concurrency !== undefined) result.concurrency = clampConcurrency(value.concurrency)
  if (value.closeBehavior !== undefined) {
    if (!['ask', 'minimizeToTray', 'quit'].includes(value.closeBehavior)) {
      throw new Error('关闭窗口行为参数无效')
    }
    result.closeBehavior = value.closeBehavior
  }
  if (value.outputMode !== undefined) {
    if (!['source', 'custom'].includes(value.outputMode)) throw new Error('输出位置参数无效')
    result.outputMode = value.outputMode
  }
  if (value.outputDirectory !== undefined) {
    if (typeof value.outputDirectory !== 'string' || !isAbsolute(value.outputDirectory)) {
      throw new Error('输出目录无效')
    }
    result.outputDirectory = value.outputDirectory
  }
  if (value.outputSuffix !== undefined) {
    result.outputSuffix = sanitizeOutputSuffix(value.outputSuffix)
  }
  if (value.outputNameTemplate !== undefined) {
    result.outputNameTemplate = sanitizeOutputNameTemplate(value.outputNameTemplate)
  }
  if (value.outputConflictPolicy !== undefined) {
    if (!['rename', 'overwrite', 'skip'].includes(value.outputConflictPolicy)) {
      throw new Error('输出冲突策略无效')
    }
    result.outputConflictPolicy = value.outputConflictPolicy
  }
  if (value.completionNotification !== undefined) {
    if (typeof value.completionNotification !== 'boolean') throw new Error('完成通知参数无效')
    result.completionNotification = value.completionNotification
  }
  if (value.completionSound !== undefined) {
    if (typeof value.completionSound !== 'boolean') throw new Error('完成提示音参数无效')
    result.completionSound = value.completionSound
  }
  if (value.completionAction !== undefined) {
    if (!['none', 'openOutput'].includes(value.completionAction)) {
      throw new Error('完成后操作参数无效')
    }
    result.completionAction = value.completionAction
  }
  if (value.video) {
    validateVideoOptions(value.video, '视频默认参数无效')
    result.video = structuredClone(value.video)
  }
  if (value.videoPresets !== undefined) {
    result.videoPresets = validateVideoPresets(value.videoPresets)
  }
  if (value.image) {
    validateImageOptions(value.image, '图片默认参数无效')
    result.image = structuredClone(value.image)
  }
  if (value.imagePresets !== undefined) {
    result.imagePresets = validateImagePresets(value.imagePresets)
  }
  if (value.audio) {
    validateAudioOptions(value.audio, '音频默认参数无效')
    result.audio = structuredClone(value.audio)
  }
  return result
}

export function registerIpc(
  getWindow: () => BrowserWindow | null,
  queue: TaskQueue,
  settings: SettingsStore,
  updates: UpdateService
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

  handle(IPC_CHANNELS.windowMinimize, (event) => {
    const current = window()
    assertTrusted(event, current)
    current.minimize()
  })
  handle(IPC_CHANNELS.windowToggleMaximize, (event) => {
    const current = window()
    assertTrusted(event, current)
    if (current.isMaximized()) current.unmaximize()
    else current.maximize()
    return current.isMaximized()
  })
  handle(IPC_CHANNELS.windowIsMaximized, (event) => {
    const current = window()
    assertTrusted(event, current)
    return current.isMaximized()
  })
  handle(IPC_CHANNELS.windowClose, (event) => {
    const current = window()
    assertTrusted(event, current)
    current.close()
  })

  handle(IPC_CHANNELS.selectFiles, async (event, kind: TaskKind) => {
    assertTrusted(event, window())
    if (!['video', 'image', 'audio'].includes(kind)) throw new Error('文件类型无效')
    const result = await dialog.showOpenDialog(window(), {
      properties: ['openFile', 'multiSelections'],
      filters:
        kind === 'video'
          ? [{ name: '视频文件', extensions: [...VIDEO_EXTENSIONS].map((item) => item.slice(1)) }]
          : kind === 'audio'
            ? [
                {
                  name: '音频和视频文件',
                  extensions: [...new Set([...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS])].map((item) =>
                    item.slice(1)
                  )
                }
              ]
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

  handle(IPC_CHANNELS.selectImageDirectory, async (event) => {
    assertTrusted(event, window())
    const result = await dialog.showOpenDialog(window(), { properties: ['openDirectory'] })
    return result.canceled ? [] : collectImageInputs(result.filePaths)
  })

  handle(IPC_CHANNELS.expandImageInputs, (event, paths: string[]) => {
    assertTrusted(event, window())
    return collectImageInputs(paths)
  })

  handle(IPC_CHANNELS.openOutputDirectory, async (event) => {
    assertTrusted(event, window())
    const outputDirectory = settings.get().outputDirectory
    mkdirSync(outputDirectory, { recursive: true })
    const error = await shell.openPath(outputDirectory)
    if (error) throw new Error(error)
  })
  handle(IPC_CHANNELS.confirmSourceReplacement, async (event, count: number) => {
    assertTrusted(event, window())
    if (!Number.isInteger(count) || count < 1) throw new Error('待替换源文件数量无效')
    const result = await dialog.showMessageBox(window(), {
      type: 'warning',
      title: '确认替换源文件',
      message: `将替换 ${count} 个源文件`,
      detail: 'VVTools 会先生成临时文件，处理成功后才替换源文件；处理失败或取消不会修改原文件。',
      buttons: ['取消', '继续处理'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    return result.response === 1
  })

  handle(IPC_CHANNELS.createTasks, (event, request: unknown) => {
    assertTrusted(event, window())
    return queue.create(validateCreateRequest(request))
  })
  handle(IPC_CHANNELS.inspectTasks, (event, request: unknown) => {
    assertTrusted(event, window())
    const activeOutputPaths = queue
      .list()
      .filter((task) => task.status === 'pending' || task.status === 'processing')
      .map((task) => task.outputPath)
    return inspectTasks(validateCreateRequest(request), new Set(activeOutputPaths))
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
  handle(IPC_CHANNELS.getVersion, (event) => {
    assertTrusted(event, window())
    return app.getVersion()
  })
  handle(IPC_CHANNELS.getReleaseNotes, async (event) => {
    assertTrusted(event, window())
    const path = app.isPackaged
      ? join(process.resourcesPath, 'release-notes.md')
      : join(app.getAppPath(), 'release-notes.md')
    try {
      const content = (await readFile(path, 'utf8')).trim()
      if (app.isPackaged) return content
      const releaseNotes = extractVersionReleaseNotes(content, app.getVersion())
      if (releaseNotes === undefined) {
        console.error(`更新日志中缺少 v${app.getVersion()} 版本`)
        return ''
      }
      return releaseNotes
    } catch (error) {
      console.error('读取更新日志失败', error)
      return ''
    }
  })
  handle(IPC_CHANNELS.getUpdateState, (event) => {
    assertTrusted(event, window())
    return updates.getState()
  })
  handle(IPC_CHANNELS.checkForUpdates, (event) => {
    assertTrusted(event, window())
    return updates.check()
  })
  handle(IPC_CHANNELS.downloadUpdate, (event) => {
    assertTrusted(event, window())
    return updates.download()
  })
  handle(IPC_CHANNELS.installUpdate, (event) => {
    assertTrusted(event, window())
    return updates.install()
  })
  handle(IPC_CHANNELS.openReleasePage, (event) => {
    assertTrusted(event, window())
    return updates.openReleasePage()
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
      if (channel !== IPC_CHANNELS.tasksChanged && channel !== IPC_CHANNELS.updatesChanged) {
        ipcMain.removeHandler(channel)
      }
    }
  }
}
