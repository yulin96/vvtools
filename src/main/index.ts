import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, dialog, Menu, screen, shell, Tray } from 'electron'
import { availableParallelism } from 'os'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'
import { processAudio } from './media/audio-processor'
import { processFont } from './media/font-processor'
import { processImage } from './media/image-processor'
import { processPdf, shutdownPdfProcesses } from './media/pdf-processor'
import { processVideo } from './media/video-processor'
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

let mainWindow: BrowserWindow | null = null
let queue: TaskQueue | null = null
let settingsStore: SettingsStore | null = null
let windowStateStore: WindowStateStore | null = null
let tray: Tray | null = null
let unregisterIpc: (() => void) | null = null
let isQuitting = false
let closeDialogOpen = false
const updates = new UpdateService(() => mainWindow)
const defaultWindowSize = { width: 1280, height: 800 }
const minimumWindowSize = { width: 1040, height: 680 }
const windowsTitleBarOverlay = {
  color: '#f5f5f9',
  symbolColor: '#1c1b27',
  height: 36
}

app.setName('VVTools')
configureOverlayScrollbars(app.commandLine, process.platform)

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
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      navigateOnDragDrop: false
    }
  })
  mainWindow = window

  window.on('ready-to-show', () => {
    if (storedState?.maximized) window.maximize()
    window.show()
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
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
    if (isQuitting || activeTaskCount() === 0) {
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
  return (
    queue?.list().filter((task) => task.status === 'pending' || task.status === 'processing')
      .length ?? 0
  )
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  mainWindow?.show()
  mainWindow?.focus()
}

function ensureTray(): void {
  if (tray) return
  tray = new Tray(icon)
  tray.setToolTip('VVTools')
  tray.on('click', showMainWindow)
  updateTrayMenu()
}

function updateTrayMenu(): void {
  if (!tray) return
  const count = activeTaskCount()
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: count > 0 ? `${count} 个任务处理中` : '当前没有处理中的任务', enabled: false },
      { type: 'separator' },
      { label: '显示 VVTools', click: showMainWindow },
      { label: '退出', click: quitApplication }
    ])
  )
}

function handleQueueChanged(): void {
  updateTrayMenu()
}

function continueInBackground(): void {
  ensureTray()
  mainWindow?.hide()
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
      message: `还有 ${count} 个任务尚未完成`,
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
  electronApp.setAppUserModelId('com.vvtools.app')

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
        : task.kind === 'audio'
          ? processAudio(task, signal, onProgress, failureLogs)
          : task.kind === 'pdf'
            ? processPdf(task, signal, onProgress)
            : task.kind === 'font'
              ? processFont(task, signal, onProgress)
              : processImage(task, signal, onProgress),
    failureLogs
  )
  queue.on('changed', handleQueueChanged)
  unregisterIpc = registerIpc(() => mainWindow, queue, settings, updates)

  createWindow()
  updates.initialize()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
  queue?.shutdown()
  shutdownPdfProcesses()
  unregisterIpc?.()
  tray?.destroy()
  tray = null
})
