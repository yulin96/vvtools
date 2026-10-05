import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { readFile } from 'fs/promises'
import { basename, dirname, extname, isAbsolute, join, normalize } from 'path'
import type {
  AppSettings,
  AppSettingsPatch,
  DesktopIntegrationState,
  DesktopNavigation,
  PdfOptions,
  RuntimeCapabilities,
  TaskProgressUpdate,
  TaskStateUpdate,
  TaskKind
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
import { inspectFontFile, saveEditedFontFile, validateFontEditValues } from './media/font-inspector'
import { collectImageInputs } from './media/image-inputs'
import { inspectImageMetadata } from './media/image-metadata'
import { inspectTasks } from './media/preflight'
import { SettingsStore } from './services/settings-store'
import { inspectRenameFiles, inspectRenamePlan, renameFiles } from './services/file-renamer'
import { TaskQueue } from './services/task-queue'
import { resolveTaskConcurrency } from './services/task-concurrency'
import { UpdateService } from './services/update-service'
import {
  sanitizeRenameRequests,
  sanitizeSettings,
  validateCreateRequest,
  validateSourcePath
} from './ipc-validation'

function assertTrusted(event: IpcMainInvokeEvent, window: BrowserWindow): void {
  if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('拒绝来自未知页面的请求')
  }
}

export interface DesktopIpc {
  updateSettings: (input: AppSettingsPatch) => Promise<AppSettings>
  integrationState: () => Promise<DesktopIntegrationState>
  repairIntegration: () => Promise<DesktopIntegrationState>
  openSystemSettings: () => Promise<void>
  getNavigation: () => DesktopNavigation | null
  acknowledgeNavigation: (id: string) => void
}

export function registerIpc(
  getWindow: () => BrowserWindow | null,
  queue: TaskQueue,
  settings: SettingsStore,
  updates: UpdateService,
  desktop?: DesktopIpc
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
  const activeFilePaths = (): Set<string> =>
    new Set(
      queue
        .list()
        .filter((task) => task.status === 'pending' || task.status === 'processing')
        .flatMap((task) => [task.sourcePath, task.outputPath, ...(task.outputPaths ?? [])])
    )

  handle(IPC_CHANNELS.selectFiles, async (event, kind: TaskKind) => {
    assertTrusted(event, window())
    if (!['video', 'sprite', 'image', 'audio', 'pdf', 'font'].includes(kind)) {
      throw new Error('文件类型无效')
    }
    const result = await dialog.showOpenDialog(window(), {
      properties: ['openFile', 'multiSelections'],
      filters:
        kind === 'video' || kind === 'sprite'
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

  handle(IPC_CHANNELS.selectFontForInspection, async (event) => {
    assertTrusted(event, window())
    const result = await dialog.showOpenDialog(window(), {
      properties: ['openFile'],
      filters: [{ name: '字体文件', extensions: [...FONT_EXTENSIONS].map((item) => item.slice(1)) }]
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle(IPC_CHANNELS.selectRenameFiles, async (event) => {
    assertTrusted(event, window())
    const result = await dialog.showOpenDialog(window(), {
      properties: ['openFile', 'multiSelections']
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

  handle(IPC_CHANNELS.inspectImageInput, (event, path: string) => {
    assertTrusted(event, window())
    validateSourcePath(path, 'image')
    return inspectImageMetadata(path)
  })

  handle(IPC_CHANNELS.inspectFont, (event, path: string) => {
    assertTrusted(event, window())
    validateSourcePath(path, 'font')
    return inspectFontFile(path)
  })

  handle(IPC_CHANNELS.saveEditedFont, async (event, path: string, input: unknown) => {
    assertTrusted(event, window())
    validateSourcePath(path, 'font')
    if (activeFilePaths().has(path)) throw new Error('该字体正在被任务使用，暂时无法另存编辑结果')
    const edits = validateFontEditValues(input)
    const extension = extname(path).toLowerCase()
    const result = await dialog.showSaveDialog(window(), {
      defaultPath: join(dirname(path), `${basename(path, extension)}-edited${extension}`),
      filters: [{ name: extension.slice(1).toUpperCase(), extensions: [extension.slice(1)] }]
    })
    if (result.canceled || !result.filePath) return null
    const outputPath = result.filePath
    if (!isAbsolute(outputPath) || extname(outputPath).toLowerCase() !== extension) {
      throw new Error(`编辑后的字体必须另存为 ${extension.toUpperCase()} 文件`)
    }
    if (normalize(outputPath) === normalize(path)) throw new Error('不能覆盖当前打开的源字体')
    if (existsSync(outputPath)) throw new Error('目标文件已存在，请使用新的文件名')
    await saveEditedFontFile(path, outputPath, edits)
    return { outputPath }
  })

  handle(IPC_CHANNELS.inspectRenameFiles, (event, input: unknown) => {
    assertTrusted(event, window())
    if (!Array.isArray(input) || input.length > 500) throw new Error('批量重命名文件列表无效')
    const paths = input.map((path) => {
      if (typeof path !== 'string' || !isAbsolute(path) || path.length > 8192) {
        throw new Error('批量重命名文件路径无效')
      }
      return path
    })
    return inspectRenameFiles(paths)
  })

  handle(IPC_CHANNELS.inspectRenamePlan, (event, input: unknown) => {
    assertTrusted(event, window())
    return inspectRenamePlan(sanitizeRenameRequests(input), { blockedPaths: activeFilePaths() })
  })

  handle(IPC_CHANNELS.renameFiles, (event, input: unknown) => {
    assertTrusted(event, window())
    return renameFiles(sanitizeRenameRequests(input), { blockedPaths: activeFilePaths() })
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
    const activeTasks = queue
      .list()
      .filter((task) => task.status === 'pending' || task.status === 'processing')
    return inspectTasks(
      validateCreateRequest(request),
      new Set(activeTasks.map((task) => task.outputPath)),
      new Set(activeTasks.map((task) => task.sourcePath))
    )
  })
  handle(IPC_CHANNELS.getTasks, (event) => {
    assertTrusted(event, window())
    return queue.snapshot()
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
    if (
      existsSync(task.outputPath) &&
      ((task.kind === 'pdf' && (task.options as PdfOptions).operation === 'toImage') ||
        task.kind === 'sprite')
    ) {
      const error = await shell.openPath(task.outputPath)
      if (error) throw new Error(error)
    } else if (existsSync(task.outputPath)) shell.showItemInFolder(task.outputPath)
    else {
      const error = await shell.openPath(dirname(task.outputPath))
      if (error) throw new Error(error)
    }
  })
  handle(IPC_CHANNELS.getSettings, (event) => {
    assertTrusted(event, window())
    return settings.get()
  })
  handle(IPC_CHANNELS.getSettingsRecoveryNotice, (event) => {
    assertTrusted(event, window())
    return settings.getRecoveryNotice()
  })
  handle(IPC_CHANNELS.updateSettings, (event, input: unknown) => {
    assertTrusted(event, window())
    const patch = sanitizeSettings(input)
    const apply = (updated: AppSettings): AppSettings => {
      queue.setConcurrency(resolveTaskConcurrency(updated.common.concurrency))
      return updated
    }
    return desktop ? desktop.updateSettings(patch).then(apply) : apply(settings.update(patch))
  })
  const desktopRuntime = (): DesktopIpc => {
    if (!desktop) throw new Error('系统集成不可用')
    return desktop
  }
  handle(IPC_CHANNELS.getDesktopIntegration, (event) => {
    assertTrusted(event, window())
    return desktopRuntime().integrationState()
  })
  handle(IPC_CHANNELS.repairDesktopIntegration, (event) => {
    assertTrusted(event, window())
    return desktopRuntime().repairIntegration()
  })
  handle(IPC_CHANNELS.openDesktopSystemSettings, (event) => {
    assertTrusted(event, window())
    return desktopRuntime().openSystemSettings()
  })
  handle(IPC_CHANNELS.getDesktopNavigation, (event) => {
    assertTrusted(event, window())
    return desktopRuntime().getNavigation()
  })
  handle(IPC_CHANNELS.acknowledgeDesktopNavigation, (event, id: unknown) => {
    assertTrusted(event, window())
    if (typeof id !== 'string' || id.length > 100) throw new Error('导航请求无效')
    desktopRuntime().acknowledgeNavigation(id)
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
  handle(IPC_CHANNELS.setWindowTheme, (event, theme: unknown) => {
    assertTrusted(event, window())
    if (theme !== 'light' && theme !== 'dark') throw new Error('窗口主题无效')
    if (process.platform !== 'win32') return
    window().setTitleBarOverlay(
      theme === 'dark'
        ? { color: '#101116', symbolColor: '#f3f1f8', height: 36 }
        : { color: '#ffffff', symbolColor: '#1c1b27', height: 36 }
    )
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
  handle(IPC_CHANNELS.openSourcePage, (event) => {
    assertTrusted(event, window())
    return shell.openExternal('https://github.com/yulin96/vvtools')
  })

  const notify = (update: TaskStateUpdate): void => {
    const current = getWindow()
    if (current && !current.isDestroyed())
      current.webContents.send(IPC_CHANNELS.tasksChanged, update)
  }
  queue.on('changed', notify)
  const notifyProgress = (update: TaskProgressUpdate): void => {
    const current = getWindow()
    if (current && !current.isDestroyed())
      current.webContents.send(IPC_CHANNELS.taskProgressChanged, update)
  }
  queue.on('progress', notifyProgress)

  return () => {
    queue.off('changed', notify)
    queue.off('progress', notifyProgress)
    for (const channel of Object.values(IPC_CHANNELS)) {
      if (
        channel !== IPC_CHANNELS.tasksChanged &&
        channel !== IPC_CHANNELS.taskProgressChanged &&
        channel !== IPC_CHANNELS.desktopNavigation &&
        channel !== IPC_CHANNELS.updatesChanged
      ) {
        ipcMain.removeHandler(channel)
      }
    }
  }
}
