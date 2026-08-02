import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { existsSync, mkdirSync, statSync } from 'fs'
import { readFile } from 'fs/promises'
import { dirname, extname, isAbsolute, join, normalize, sep } from 'path'
import type {
  AppSettings,
  AppSettingsPatch,
  AudioOptions,
  CreateTasksRequest,
  FontOptions,
  ImageFormat,
  ImageOptions,
  PdfOptions,
  RuntimeCapabilities,
  TaskKind,
  VideoOptions,
  VideoQuality,
  VideoResolution
} from '../shared/types'
import {
  AUDIO_EXTENSIONS,
  FONT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  IPC_CHANNELS,
  PDF_EXTENSIONS,
  TEXT_EXTENSIONS,
  VIDEO_EXTENSIONS
} from '../shared/constants'
import { extractVersionReleaseNotes } from '../shared/release-notes.mjs'
import { getRuntimeCapabilities } from './media/ffmpeg-runtime'
import { sanitizeFontInstances } from './media/font-metadata'
import { collectImageInputs } from './media/image-inputs'
import { inspectTasks } from './media/preflight'
import { SettingsStore } from './services/settings-store'
import { TaskQueue } from './services/task-queue'
import { isConcurrencySettings, resolveTaskConcurrency } from './services/task-concurrency'
import { UpdateService } from './services/update-service'

const VIDEO_QUALITIES = new Set<VideoQuality>(['high', 'balanced', 'small'])
const VIDEO_RESOLUTIONS = new Set<VideoResolution>(['source', '1080p', '720p', 'custom'])
const VIDEO_FORMATS = new Set(['source', 'mp4', 'mov', 'mkv', 'avi'])
const VIDEO_CODECS = new Set(['source', 'h264', 'h265', 'mpeg4'])
const VIDEO_RATE_CONTROLS = new Set(['quality', 'bitrate'])
const VIDEO_FRAME_RATES = new Set(['source', '24', '30', '60', 'custom'])
const VIDEO_AUDIO_MODES = new Set(['aac', 'copy', 'none'])
const IMAGE_FORMATS = new Set<ImageFormat>(['original', 'jpeg', 'png', 'webp', 'avif'])
const PDF_OPERATIONS = new Set(['compress', 'toImage'])
const PDF_COMPRESSION_MODES = new Set(['lossless', 'lossy'])
const PDF_IMAGE_FORMATS = new Set(['png', 'jpeg', 'webp'])
const FONT_OPERATIONS = new Set(['convert', 'splitCollection', 'variableStatic', 'subset'])
const FONT_FORMATS = new Set(['ttf', 'otf', 'woff', 'woff2'])
const FONT_INSTANCE_MODES = new Set(['named', 'default'])

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
        : kind === 'image'
          ? IMAGE_EXTENSIONS
          : kind === 'pdf'
            ? PDF_EXTENSIONS
            : FONT_EXTENSIONS
  if (!extensions.has(extname(path).toLowerCase())) throw new Error(`不支持的文件格式：${path}`)
}

function validateCreateRequest(value: unknown): CreateTasksRequest {
  if (!value || typeof value !== 'object') throw new Error('任务参数无效')
  const request = value as CreateTasksRequest
  if (!['video', 'image', 'audio', 'pdf', 'font'].includes(request.kind)) {
    throw new Error('任务类型无效')
  }
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
  } else if (request.kind === 'audio') {
    if (!Array.isArray(request.sourcePaths) || request.sourcePaths.length === 0) {
      throw new Error('请至少选择一个音频或视频文件')
    }
    if (request.sourcePaths.length > 500) throw new Error('单次最多添加 500 个文件')
    request.sourcePaths.forEach((path) => validateSourcePath(path, 'audio'))
    validateAudioOptions(request.options, '音频任务参数无效')
  } else if (request.kind === 'pdf') {
    if (!Array.isArray(request.sourcePaths) || request.sourcePaths.length === 0) {
      throw new Error('请至少选择一个 PDF 文件')
    }
    if (request.sourcePaths.length > 500) throw new Error('单次最多添加 500 个文件')
    request.sourcePaths.forEach((path) => validateSourcePath(path, 'pdf'))
    validatePdfOptions(request.options, 'PDF 任务参数无效')
    request.pageNumbers = sanitizeIndexes(request.pageNumbers, 1, 'PDF 页面编号无效')
  } else {
    if (!Array.isArray(request.sources) || request.sources.length === 0) {
      throw new Error('请至少选择一个字体文件')
    }
    if (request.sources.length > 500) throw new Error('单次最多添加 500 个文件')
    request.sources.forEach((source) => {
      if (!source || typeof source !== 'object' || !FONT_FORMATS.has(source.outputFormat)) {
        throw new Error('字体来源参数无效')
      }
      validateSourcePath(source.path, 'font')
    })
    validateFontOptions(request.options, '字体任务参数无效')
    request.fontIndexes = sanitizeIndexes(request.fontIndexes, 0, '字体编号无效')
    request.fontInstances = sanitizeFontInstances(request.fontInstances)
  }
  const sourcePaths =
    request.kind === 'image' || request.kind === 'font'
      ? request.sources.map((source) => source.path)
      : request.sourcePaths
  request.inputMetadata = sanitizeInputMetadata(request.inputMetadata, new Set(sourcePaths))
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
  if (typeof value !== 'string') throw new Error('文件名规则无效')
  const template = value.trim()
  const literals = template.replace(
    /\{(?:name|suffix|preset|width|height|page|index|instance|date)\}/gu,
    ''
  )
  const invalidLiteral = [...literals].some(
    (character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*{}'.includes(character)
  )
  if (!template || template.length > 100 || !template.includes('{name}') || invalidLiteral) {
    throw new Error('文件名规则必须包含 {name}，长度不能超过 100，且只能使用受支持的变量')
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
    const metadata = item as {
      path?: unknown
      width?: unknown
      height?: unknown
      pageCount?: unknown
      fontCount?: unknown
      fontInstances?: unknown
    }
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
    for (const count of [metadata.pageCount, metadata.fontCount]) {
      if (
        count !== undefined &&
        (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 100_000)
      ) {
        throw new Error('媒体数量信息无效')
      }
    }
    paths.add(metadata.path)
    return {
      path: metadata.path,
      width: metadata.width as number | undefined,
      height: metadata.height as number | undefined,
      pageCount: metadata.pageCount as number | undefined,
      fontCount: metadata.fontCount as number | undefined,
      fontInstances: sanitizeFontInstances(metadata.fontInstances)
    }
  })
}

function sanitizeIndexes(value: unknown, minimum: number, message: string): number[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0 || value.length > 100_000) {
    throw new Error(message)
  }
  const indexes = value.map((item) => {
    if (!Number.isInteger(item) || (item as number) < minimum || (item as number) > 100_000) {
      throw new Error(message)
    }
    return item as number
  })
  return [...new Set(indexes)].sort((left, right) => left - right)
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
    !Number.isInteger(options.customResolutionHeight) ||
    options.customResolutionHeight < 144 ||
    options.customResolutionHeight > 4320 ||
    !VIDEO_FORMATS.has(options.format) ||
    !VIDEO_CODECS.has(options.codec) ||
    !VIDEO_RATE_CONTROLS.has(options.rateControl) ||
    !Number.isFinite(options.bitrateMbps) ||
    options.bitrateMbps < 0.5 ||
    options.bitrateMbps > 100 ||
    !VIDEO_FRAME_RATES.has(options.frameRate) ||
    !Number.isFinite(options.customFrameRate) ||
    options.customFrameRate < 1 ||
    options.customFrameRate > 240 ||
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

function validatePdfOptions(options: PdfOptions, message: string): void {
  if (
    !options ||
    !PDF_OPERATIONS.has(options.operation) ||
    !PDF_COMPRESSION_MODES.has(options.compressionMode) ||
    !Number.isInteger(options.compressionDpi) ||
    options.compressionDpi < 36 ||
    options.compressionDpi > 600 ||
    !Number.isInteger(options.compressionQuality) ||
    options.compressionQuality < 1 ||
    options.compressionQuality > 100 ||
    !PDF_IMAGE_FORMATS.has(options.imageFormat) ||
    !Number.isInteger(options.dpi) ||
    options.dpi < 36 ||
    options.dpi > 600 ||
    !Number.isInteger(options.imageQuality) ||
    options.imageQuality < 1 ||
    options.imageQuality > 100
  ) {
    throw new Error(message)
  }
}

function validateFontOptions(
  options: FontOptions,
  message: string,
  requireSubsetInput = true
): void {
  if (
    !options ||
    !FONT_OPERATIONS.has(options.operation) ||
    !FONT_FORMATS.has(options.outputFormat) ||
    !FONT_INSTANCE_MODES.has(options.variableInstanceMode) ||
    (options.subsetText !== undefined &&
      (typeof options.subsetText !== 'string' || options.subsetText.length > 1_000_000)) ||
    (options.subsetTextFile !== undefined && typeof options.subsetTextFile !== 'string')
  ) {
    throw new Error(message)
  }
  if (options.operation !== 'subset' || !requireSubsetInput) return
  const textFile = options.subsetTextFile?.trim()
  const text = options.subsetText?.trim()
  if (!textFile && !text) throw new Error('请输入需要保留的字符，或选择 TXT 文本文件')
  if (textFile) {
    if (!isAbsolute(textFile) || !existsSync(textFile) || !statSync(textFile).isFile()) {
      throw new Error('字体子集文本文件无效')
    }
    if (!TEXT_EXTENSIONS.has(extname(textFile).toLowerCase())) {
      throw new Error('字体子集文本文件必须是 TXT')
    }
    if (statSync(textFile).size > 10 * 1024 * 1024) throw new Error('字体子集文本文件过大')
  }
}

function sanitizeSettings(input: unknown): AppSettingsPatch {
  if (!isRecord(input)) throw new Error('设置参数无效')
  const result: AppSettingsPatch = {}

  if (input.common !== undefined) {
    if (!isRecord(input.common)) throw new Error('通用设置参数无效')
    const value = input.common
    const common: NonNullable<AppSettingsPatch['common']> = {}
    if (value.concurrency !== undefined) {
      if (!isConcurrencySettings(value.concurrency)) throw new Error('任务并发参数无效')
      common.concurrency = structuredClone(value.concurrency)
    }
    if (value.closeBehavior !== undefined) {
      if (!['ask', 'minimizeToTray', 'quit'].includes(String(value.closeBehavior))) {
        throw new Error('关闭窗口行为参数无效')
      }
      common.closeBehavior = value.closeBehavior as AppSettings['common']['closeBehavior']
    }
    if (value.outputMode !== undefined) {
      if (!['source', 'custom'].includes(String(value.outputMode))) {
        throw new Error('输出位置参数无效')
      }
      common.outputMode = value.outputMode as AppSettings['common']['outputMode']
    }
    if (value.outputDirectory !== undefined) {
      if (typeof value.outputDirectory !== 'string' || !isAbsolute(value.outputDirectory)) {
        throw new Error('输出目录无效')
      }
      common.outputDirectory = value.outputDirectory
    }
    if (value.outputSuffix !== undefined) {
      common.outputSuffix = sanitizeOutputSuffix(value.outputSuffix)
    }
    if (value.outputNameTemplate !== undefined) {
      common.outputNameTemplate = sanitizeOutputNameTemplate(value.outputNameTemplate)
    }
    if (value.outputConflictPolicy !== undefined) {
      if (!['rename', 'overwrite', 'skip'].includes(String(value.outputConflictPolicy))) {
        throw new Error('输出冲突策略无效')
      }
      common.outputConflictPolicy =
        value.outputConflictPolicy as AppSettings['common']['outputConflictPolicy']
    }
    if (value.completionNotification !== undefined) {
      if (typeof value.completionNotification !== 'boolean') {
        throw new Error('完成通知参数无效')
      }
      common.completionNotification = value.completionNotification
    }
    if (value.completionSound !== undefined) {
      if (typeof value.completionSound !== 'boolean') throw new Error('完成提示音参数无效')
      common.completionSound = value.completionSound
    }
    if (value.completionAction !== undefined) {
      if (!['none', 'openOutput'].includes(String(value.completionAction))) {
        throw new Error('完成后操作参数无效')
      }
      common.completionAction = value.completionAction as AppSettings['common']['completionAction']
    }
    result.common = common
  }

  if (input.video !== undefined) {
    if (!isRecord(input.video)) throw new Error('视频设置参数无效')
    const video: NonNullable<AppSettingsPatch['video']> = {}
    if (input.video.lastOptions !== undefined) {
      validateVideoOptions(input.video.lastOptions as VideoOptions, '视频参数无效')
      video.lastOptions = structuredClone(input.video.lastOptions) as VideoOptions
    }
    result.video = video
  }

  if (input.image !== undefined) {
    if (!isRecord(input.image)) throw new Error('图片设置参数无效')
    const image: NonNullable<AppSettingsPatch['image']> = {}
    if (input.image.lastOptions !== undefined) {
      validateImageOptions(input.image.lastOptions as ImageOptions, '图片参数无效')
      image.lastOptions = structuredClone(input.image.lastOptions) as ImageOptions
    }
    result.image = image
  }

  if (input.audio !== undefined) {
    if (!isRecord(input.audio)) throw new Error('音频设置参数无效')
    const audio: NonNullable<AppSettingsPatch['audio']> = {}
    if (input.audio.lastOptions !== undefined) {
      validateAudioOptions(input.audio.lastOptions as AudioOptions, '音频参数无效')
      audio.lastOptions = structuredClone(input.audio.lastOptions) as AudioOptions
    }
    result.audio = audio
  }

  if (input.pdf !== undefined) {
    if (!isRecord(input.pdf)) throw new Error('PDF 设置参数无效')
    const pdf: NonNullable<AppSettingsPatch['pdf']> = {}
    if (input.pdf.lastOptions !== undefined) {
      validatePdfOptions(input.pdf.lastOptions as PdfOptions, 'PDF 参数无效')
      pdf.lastOptions = structuredClone(input.pdf.lastOptions) as PdfOptions
    }
    result.pdf = pdf
  }

  if (input.font !== undefined) {
    if (!isRecord(input.font)) throw new Error('字体设置参数无效')
    const font: NonNullable<AppSettingsPatch['font']> = {}
    if (input.font.lastOptions !== undefined) {
      validateFontOptions(input.font.lastOptions as FontOptions, '字体参数无效', false)
      font.lastOptions = structuredClone(input.font.lastOptions) as FontOptions
    }
    result.font = font
  }

  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
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

  handle(IPC_CHANNELS.selectFiles, async (event, kind: TaskKind) => {
    assertTrusted(event, window())
    if (!['video', 'image', 'audio', 'pdf', 'font'].includes(kind)) {
      throw new Error('文件类型无效')
    }
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
            : kind === 'image'
              ? [
                  {
                    name: '图片文件',
                    extensions: [...IMAGE_EXTENSIONS].map((item) => item.slice(1))
                  }
                ]
              : kind === 'pdf'
                ? [
                    {
                      name: 'PDF 文件',
                      extensions: [...PDF_EXTENSIONS].map((item) => item.slice(1))
                    }
                  ]
                : [
                    {
                      name: '字体文件',
                      extensions: [...FONT_EXTENSIONS].map((item) => item.slice(1))
                    }
                  ]
    })
    return result.canceled ? [] : result.filePaths
  })

  handle(IPC_CHANNELS.selectTextFile, async (event) => {
    assertTrusted(event, window())
    const result = await dialog.showOpenDialog(window(), {
      properties: ['openFile'],
      filters: [{ name: '文本文件', extensions: [...TEXT_EXTENSIONS].map((item) => item.slice(1)) }]
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle(IPC_CHANNELS.selectOutputDirectory, async (event, current?: string) => {
    assertTrusted(event, window())
    const result = await dialog.showOpenDialog(window(), {
      defaultPath: current && isAbsolute(current) ? current : settings.get().common.outputDirectory,
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
    const outputDirectory = settings.get().common.outputDirectory
    mkdirSync(outputDirectory, { recursive: true })
    const error = await shell.openPath(outputDirectory)
    if (error) throw new Error(error)
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
    queue.setConcurrency(resolveTaskConcurrency(updated.common.concurrency))
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
