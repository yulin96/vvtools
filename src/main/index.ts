import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, dialog, Menu, Notification, screen, shell } from 'electron'
import { randomUUID } from 'crypto'
import { availableParallelism } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { IPC_CHANNELS, IMAGE_EXTENSIONS } from '../shared/constants'
import type { AppSettingsPatch, DesktopActionId, DesktopNavigation } from '../shared/types'
import { DesktopActions, type DesktopResult } from './services/desktop-actions'
import { DesktopIntegration } from './services/desktop-integration'
import { isDesktopLaunch, readDesktopLaunch } from './services/desktop-request'
import { normalizeDesktopSettings } from '../shared/desktop-settings'
import { registerIpc } from './ipc'
import { applicationMenuTemplate } from './application-menu'
import { ApplicationIcons } from './application-icons'
import { processAudio } from './media/audio-processor'
import { processFont } from './media/font-processor'
import {
  clearFontPreview,
  registerFontPreviewProtocol,
  registerFontPreviewScheme
} from './media/font-preview-protocol'
import { processImage } from './media/image-processor'
import { processPdf, shutdownPdfProcesses } from './media/pdf-processor'
import { processVideo } from './media/video-processor'
import { processSprite } from './media/sprite-processor'
import { FailureLogService } from './services/failure-log'
import { SettingsStore } from './services/settings-store'
import { resolveTaskConcurrency } from './services/task-concurrency'
import { TaskQueue } from './services/task-queue'
import { UpdateService } from './services/update-service'
import {
  restoreWindowBounds,
  WindowStateStore,
  type WindowState
} from './services/window-state-store'
import { configureOverlayScrollbars } from './scrollbar-config'

process.env.UV_THREADPOOL_SIZE ??= String(Math.min(16, availableParallelism()))
registerFontPreviewScheme()

let mainWindow: BrowserWindow | null = null
let queue: TaskQueue | null = null
let settingsStore: SettingsStore | null = null
let windowStateStore: WindowStateStore | null = null
let unregisterIpc: (() => void) | null = null
let isQuitting = false
let closeDialogOpen = false
let desktopActions: DesktopActions | null = null
let desktopIntegration: DesktopIntegration | null = null
let desktopReady = false
let showAtStart = !isDesktopLaunch(process.argv)
let launchSerial: Promise<void> = Promise.resolve()
let pendingDesktopLaunches = 0
let settingsSerial: Promise<unknown> = Promise.resolve()
const pendingLaunches: string[][] = isDesktopLaunch(process.argv) ? [process.argv] : []
const pendingNavigation: DesktopNavigation[] = []
let lastRevealedDesktopResult = ''
const updates = new UpdateService(() => mainWindow)
const applicationIcons = new ApplicationIcons(() => mainWindow)
const defaultWindowSize = { width: 1280, height: 800 }
const minimumWindowSize = { width: 1040, height: 680 }
const windowsTitleBarOverlay = {
  color: '#ffffff',
  symbolColor: '#1c1b27',
  height: 36
}

app.setName('VVTools')
configureOverlayScrollbars(app.commandLine, process.platform)
const hasSingleInstanceLock = app.requestSingleInstanceLock({ argv: process.argv })
if (!hasSingleInstanceLock) app.quit()

app.on('second-instance', (_event, argv, _directory, data) => {
  if (!hasSingleInstanceLock) return
  const dataArgv = (data as { argv?: unknown } | null)?.argv
  const forwarded =
    Array.isArray(dataArgv) && dataArgv.every((arg: unknown) => typeof arg === 'string')
      ? (dataArgv as string[])
      : argv
  if (isDesktopLaunch(forwarded)) {
    pendingLaunches.push(forwarded)
    drainDesktopLaunches()
  } else showMainWindow()
})

app.on('open-file', (event, path) => {
  event.preventDefault()
  pendingLaunches.push(['--vvtools-action=open', '--', path])
  drainDesktopLaunches()
})

function isTrustedRendererUrl(url: string): boolean {
  try {
    const candidate = new URL(url)
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      return candidate.origin === new URL(process.env['ELECTRON_RENDERER_URL']).origin
    }
    const expected = new URL(pathToFileURL(join(__dirname, '../renderer/index.html')).href)
    return candidate.protocol === 'file:' && candidate.pathname === expected.pathname
  } catch {
    return false
  }
}

function createWindow(): void {
  let storedState: WindowState | undefined
  try {
    storedState = windowStateStore?.load()
  } catch (error) {
    console.error('读取窗口状态失败，将使用默认窗口状态', error)
  }
  const restoredBounds = restoreWindowBounds(
    storedState?.bounds,
    screen.getAllDisplays().map((display) => display.workArea),
    screen.getPrimaryDisplay().workArea,
    minimumWindowSize
  )
  const window = new BrowserWindow({
    title: 'VVTools',
    ...(restoredBounds ?? defaultWindowSize),
    minWidth: minimumWindowSize.width,
    minHeight: minimumWindowSize.height,
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const }
      : process.platform === 'win32'
        ? { titleBarStyle: 'hidden' as const, titleBarOverlay: windowsTitleBarOverlay }
        : {}),
    show: false,
    autoHideMenuBar: true,
    icon: applicationIcons.windowIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      navigateOnDragDrop: false
    }
  })
  mainWindow = window
  window.webContents.on('did-finish-load', sendDesktopNavigation)

  window.on('ready-to-show', () => {
    if (storedState?.maximized) window.maximize()
    window.show()
  })

  window.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url)
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        void shell.openExternal(url.href).catch((error) => console.error('打开外部链接失败', error))
      }
    } catch {
      console.error('拒绝打开无效的外部链接', details.url)
    }
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  window.on('close', (event) => {
    if (isQuitting || (activeTaskCount() === 0 && pendingDesktopLaunches === 0)) {
      saveWindowState(window)
      return
    }
    event.preventDefault()
    const behavior = settingsStore?.get().common.closeBehavior ?? 'ask'
    if (behavior === 'minimizeToTray') {
      continueInBackground()
    } else if (behavior === 'quit') {
      quitApplication()
    } else {
      void confirmActiveTaskClose()
    }
  })
}

function saveWindowState(window: BrowserWindow): void {
  try {
    windowStateStore?.save(window)
  } catch (error) {
    console.error('保存窗口状态失败', error)
  }
}

function activeTaskCount(): number {
  return queue?.activeCount() ?? 0
}

function showMainWindow(): void {
  if (!app.isReady()) {
    showAtStart = true
    return
  }
  const result = desktopActions?.result()
  if (
    !pendingNavigation.length &&
    result &&
    result.requestId !== lastRevealedDesktopResult &&
    (result.pendingPaths.length || result.notice)
  ) {
    lastRevealedDesktopResult = result.requestId
    pendingNavigation.push({
      id: randomUUID(),
      path: '/image',
      paths: result.pendingPaths,
      notice: result.notice,
      preserveBatch: true
    })
  }
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.show()
  mainWindow?.focus()
  sendDesktopNavigation()
}

function refreshApplicationMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      applicationMenuTemplate({
        isMac: process.platform === 'darwin',
        development: is.dev,
        quickActions: settingsStore?.get().desktop.actions ?? [],
        hasResult: Boolean(desktopActions?.result()),
        openFiles: (actionId) => {
          void selectDesktopFiles(actionId)
        },
        navigate: (path, section) => navigateDesktop({ id: randomUUID(), path, section }),
        showWindow: showMainWindow,
        showResult: () => desktopActions?.showResult(),
        openHelp: () => {
          void shell
            .openExternal('https://github.com/yulin96/vvtools#readme')
            .catch((error) => console.error('打开使用说明失败', error))
        },
        quit: () => {
          void quitFromMenu()
        }
      })
    )
  )
}

function continueInBackground(): void {
  mainWindow?.hide()
}

function sendDesktopNavigation(): void {
  if (
    pendingNavigation[0] &&
    mainWindow &&
    !mainWindow.isDestroyed() &&
    !mainWindow.webContents.isLoading()
  ) {
    mainWindow.webContents.send(IPC_CHANNELS.desktopNavigation, pendingNavigation[0])
  }
}

function navigateDesktop(navigation: DesktopNavigation): void {
  if (navigation.preserveBatch) lastRevealedDesktopResult = navigation.id
  pendingNavigation.push({ ...navigation, id: randomUUID() })
  showMainWindow()
  sendDesktopNavigation()
}

function drainDesktopLaunches(): void {
  if (!desktopReady || !desktopActions) return
  for (const argv of pendingLaunches.splice(0)) {
    pendingDesktopLaunches += 1
    launchSerial = launchSerial
      .then(async () => {
        await settingsSerial
        const request = await readDesktopLaunch(
          argv,
          join(app.getPath('userData'), 'desktop-requests')
        )
        if (request) {
          if (request.actionId !== 'open' && !settingsStore?.get().desktop.contextMenuEnabled)
            throw new Error('文件右键入口已停用，请在设置中启用')
          await desktopActions!.enqueue(request)
        }
      })
      .catch((error: unknown) =>
        desktopActions?.reportError(error instanceof Error ? error.message : String(error))
      )
      .finally(() => {
        pendingDesktopLaunches -= 1
      })
  }
}

async function selectDesktopFiles(actionId: DesktopActionId | 'open'): Promise<void> {
  try {
    const options = {
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      ...(actionId !== 'open'
        ? {
            filters: [
              {
                name: '图片',
                extensions: [...IMAGE_EXTENSIONS].map((extension) => extension.slice(1))
              }
            ]
          }
        : {})
    }
    const selected = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    if (!selected.canceled && selected.filePaths.length) {
      pendingDesktopLaunches += 1
      try {
        await desktopActions?.enqueue({
          version: 1,
          id: randomUUID(),
          actionId,
          paths: selected.filePaths
        })
      } finally {
        pendingDesktopLaunches -= 1
      }
    }
  } catch (error) {
    desktopActions?.reportError(error instanceof Error ? error.message : String(error))
  }
}

function handleDesktopResult(result: DesktopResult): void {
  if (isQuitting) return
  refreshApplicationMenu()
  const settings = settingsStore?.get().desktop
  if (settings?.notifyOnComplete && Notification.isSupported()) {
    const notification = new Notification({
      title: 'VVTools · ' + result.name,
      body:
        '成功 ' +
        result.successful +
        ' · 跳过 ' +
        result.skipped +
        ' · 失败 ' +
        result.failed +
        (result.notice ? '\n' + result.notice.slice(0, 240) : '')
    })
    notification.on('click', () =>
      navigateDesktop({
        id: result.requestId,
        path: '/image',
        paths: result.pendingPaths,
        notice: result.notice,
        preserveBatch: true
      })
    )
    notification.show()
  }
  if (settings?.revealOnComplete) desktopActions?.showResult()
}

async function quitFromMenu(): Promise<void> {
  if (activeTaskCount() || pendingDesktopLaunches) {
    const result = await dialog.showMessageBox({
      type: 'question',
      title: '退出 VVTools',
      message: activeTaskCount()
        ? '还有 ' + activeTaskCount() + ' 个任务尚未完成'
        : '快捷任务正在准备',
      buttons: ['取消任务并退出', '返回'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    })
    if (result.response !== 0) return
  }
  quitApplication()
}

function updateDesktopSettings(input: AppSettingsPatch): Promise<ReturnType<SettingsStore['get']>> {
  const next = settingsSerial.then(async () => {
    const previous = settingsStore!.get()
    const desktop = normalizeDesktopSettings(input.desktop, previous.desktop)
    const registration = (value: typeof desktop): string =>
      JSON.stringify([
        value.contextMenuEnabled,
        value.actions.map(({ id, name, enabled }) => ({ id, name, enabled }))
      ])
    const changed = registration(previous.desktop) !== registration(desktop)
    let updated: ReturnType<SettingsStore['get']>
    try {
      if (changed) await desktopIntegration!.sync(desktop)
      updated = settingsStore!.update(input)
    } catch (error) {
      if (changed) {
        try {
          await desktopIntegration!.sync(previous.desktop)
        } catch (rollback) {
          throw new Error(String(error) + '；入口恢复失败，请在设置中修复：' + String(rollback))
        }
      }
      throw error
    }
    refreshApplicationMenu()
    return updated
  })
  settingsSerial = next.catch(() => undefined)
  return next
}

function quitApplication(): void {
  isQuitting = true
  app.quit()
}

async function confirmActiveTaskClose(): Promise<void> {
  if (closeDialogOpen || !mainWindow) return
  closeDialogOpen = true
  try {
    const count = activeTaskCount()
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: '仍有任务正在处理',
      message: count ? `还有 ${count} 个任务尚未完成` : '快捷任务正在准备',
      detail: '可以让 VVTools 在后台继续处理，或取消任务并退出应用。',
      buttons: ['后台继续', '取消任务并退出', '返回'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    })
    if (result.response === 0) continueInBackground()
    else if (result.response === 1) quitApplication()
  } finally {
    closeDialogOpen = false
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return
  electronApp.setAppUserModelId('com.vvtools.app')
  applicationIcons.start()
  registerFontPreviewProtocol()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const settings = new SettingsStore(app.getPath('userData'), app.getPath('downloads'))
  settingsStore = settings
  windowStateStore = new WindowStateStore(app.getPath('userData'))
  const failureLogs = new FailureLogService(app.getPath('userData'))
  queue = new TaskQueue(
    resolveTaskConcurrency(settings.get().common.concurrency),
    (task, signal, onProgress) =>
      task.kind === 'video'
        ? processVideo(task, signal, onProgress, failureLogs)
        : task.kind === 'sprite'
          ? processSprite(task, signal, onProgress, failureLogs)
          : task.kind === 'audio'
            ? processAudio(task, signal, onProgress, failureLogs)
            : task.kind === 'pdf'
              ? processPdf(task, signal, onProgress)
              : task.kind === 'font'
                ? processFont(task, signal, onProgress)
                : processImage(task, signal, onProgress),
    failureLogs,
    (path) => shell.trashItem(path)
  )
  desktopIntegration = new DesktopIntegration({
    platform: process.platform as 'darwin' | 'win32' | 'linux',
    packaged: app.isPackaged,
    executable: process.execPath,
    resources: process.resourcesPath,
    userData: app.getPath('userData'),
    home: app.getPath('home'),
    requests: join(app.getPath('userData'), 'desktop-requests')
  })
  desktopActions = new DesktopActions(
    queue,
    () => settings.get().desktop,
    handleDesktopResult,
    navigateDesktop
  )
  unregisterIpc = registerIpc(
    () => mainWindow,
    queue,
    settings,
    updates,
    {
      updateSettings: updateDesktopSettings,
      integrationState: () => desktopIntegration!.state(settings.get().desktop),
      repairIntegration: async () => {
        await settingsSerial
        await desktopIntegration!.sync(settings.get().desktop)
        return desktopIntegration!.state(settings.get().desktop)
      },
      openSystemSettings: async () => {
        if (process.platform === 'darwin')
          await shell.openExternal(
            'x-apple.systempreferences:com.apple.preference.keyboard?Services'
          )
        else throw new Error('Windows 无需另行启用系统服务')
      },
      getNavigation: () => pendingNavigation[0] ?? null,
      acknowledgeNavigation: (id) => {
        if (pendingNavigation[0]?.id !== id) return
        pendingNavigation.shift()
        sendDesktopNavigation()
      }
    },
    (theme) => applicationIcons.setTheme(theme)
  )

  if (showAtStart) createWindow()
  refreshApplicationMenu()
  desktopReady = true
  if (settings.get().desktop.contextMenuEnabled) {
    settingsSerial = desktopIntegration
      .sync(settings.get().desktop)
      .catch((error: unknown) => desktopActions?.reportError(String(error)))
  }
  drainDesktopLaunches()
  updates.initialize()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    showMainWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && activeTaskCount() === 0 && pendingDesktopLaunches === 0) {
    app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
  queue?.shutdown()
  shutdownPdfProcesses()
  clearFontPreview()
  unregisterIpc?.()
  applicationIcons.dispose()
  desktopActions?.dispose()
})
