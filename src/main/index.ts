import {
  app,
  shell,
  BrowserWindow,
  dialog,
  Menu,
  Notification,
  systemPreferences,
  Tray
} from 'electron'
import { dirname, join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { FailureLogService } from './services/failure-log'
import { SettingsStore } from './services/settings-store'
import { TaskQueue } from './services/task-queue'
import { TaskHistoryStore } from './services/task-history-store'
import { processVideo } from './media/video-processor'
import { processImage } from './media/image-processor'
import { processAudio } from './media/audio-processor'
import { registerIpc } from './ipc'
import type { MediaTask } from '../shared/types'
import { batchSummaryText, summarizeBatch } from './services/completion'

let mainWindow: BrowserWindow | null = null
let queue: TaskQueue | null = null
let settingsStore: SettingsStore | null = null
let tray: Tray | null = null
let unregisterIpc: (() => void) | null = null
let isQuitting = false
let closeDialogOpen = false
let batchWasActive = false
const batchTaskIds = new Set<string>()

app.setName('VVTools')
if (process.platform === 'darwin') {
  // 强制本应用使用悬浮滚动条，不受系统"显示滚动条"偏好影响
  systemPreferences.setUserDefault('AppleShowScrollBars', 'string', 'WhenScrolling')
} else {
  app.commandLine.appendSwitch('enable-features', 'OverlayScrollbar,FluentOverlayScrollbar')
}

function createWindow(): void {
  const window = new BrowserWindow({
    title: 'VVTools',
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    frame: false,
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
    if (isQuitting || activeTaskCount() === 0) return
    event.preventDefault()
    const behavior = settingsStore?.get().closeBehavior ?? 'ask'
    if (behavior === 'minimizeToTray') {
      continueInBackground()
    } else if (behavior === 'quit') {
      quitApplication()
    } else {
      void confirmActiveTaskClose()
    }
  })
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

function handleQueueChanged(tasks: MediaTask[]): void {
  updateTrayMenu()
  const activeTasks = tasks.filter(
    (task) => task.status === 'pending' || task.status === 'processing'
  )
  if (activeTasks.length > 0) {
    batchWasActive = true
    for (const task of activeTasks) batchTaskIds.add(task.id)
    return
  }
  if (!batchWasActive) return

  const batchTasks = tasks.filter((task) => batchTaskIds.has(task.id))
  batchWasActive = false
  batchTaskIds.clear()
  if (batchTasks.length > 0) void reportBatchCompleted(batchTasks)
}

async function reportBatchCompleted(tasks: MediaTask[]): Promise<void> {
  const settings = settingsStore?.get()
  if (!settings) return
  const summary = summarizeBatch(tasks)
  if (settings.completionNotification && Notification.isSupported()) {
    const notification = new Notification({
      title: '媒体任务处理完成',
      body: batchSummaryText(summary),
      silent: !settings.completionSound,
      icon
    })
    notification.on('click', showMainWindow)
    notification.show()
  }

  if (settings.completionAction !== 'openOutput') return
  const completedOutputs = tasks
    .filter((task) => task.status === 'completed')
    .map((task) => task.outputPath)
  const outputDirectories = new Set(completedOutputs.map(dirname))
  if (outputDirectories.size === 1) {
    const error = await shell.openPath([...outputDirectories][0])
    if (error) dialog.showErrorBox('无法打开输出位置', error)
    return
  }
  const lastOutput = completedOutputs.at(-1)
  if (lastOutput) shell.showItemInFolder(lastOutput)
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
  const failureLogs = new FailureLogService(app.getPath('userData'))
  queue = new TaskQueue(
    settings.get().concurrency,
    (task, signal, onProgress) =>
      task.kind === 'video'
        ? processVideo(task, signal, onProgress, failureLogs)
        : task.kind === 'audio'
          ? processAudio(task, signal, onProgress, failureLogs)
          : processImage(task, signal, onProgress),
    failureLogs,
    new TaskHistoryStore(app.getPath('userData')),
    settings.get().historyRetentionDays
  )
  queue.on('changed', handleQueueChanged)
  unregisterIpc = registerIpc(() => mainWindow, queue, settings)

  createWindow()

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
  unregisterIpc?.()
  tray?.destroy()
  tray = null
})
