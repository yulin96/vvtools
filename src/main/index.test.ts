import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindowConstructorOptions, MenuItemConstructorOptions } from 'electron'
import type { DesktopIpc } from './ipc'
import type { DesktopActionRequest } from '../shared/types'
import type { DesktopResult } from './services/desktop-actions'
import type { SettingsStore } from './services/settings-store'
import type { TaskQueue } from './services/task-queue'

const runtime = vi.hoisted(() => ({
  root: '',
  events: new Map<string, (...args: unknown[]) => void>(),
  windows: [] as Array<{
    emit: (name: string, ...args: unknown[]) => boolean
    hide: ReturnType<typeof vi.fn>
    show: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
    restore: ReturnType<typeof vi.fn>
  }>,
  windowOptions: [] as BrowserWindowConstructorOptions[],
  dev: false,
  dockIcon: vi.fn(),
  aboutOptions: vi.fn(),
  queue: null as TaskQueue | null,
  settings: null as SettingsStore | null,
  desktop: null as DesktopIpc | null,
  tray: vi.fn(),
  menu: vi.fn<(menu: MenuItemConstructorOptions[]) => void>(),
  openDialog: vi.fn(async () => ({ canceled: true, filePaths: [] as string[] })),
  messageBox: vi
    .fn<(options: unknown) => Promise<{ response: number }>>()
    .mockResolvedValue({ response: 1 }),
  quit: vi.fn(),
  enqueue: vi.fn<(request: DesktopActionRequest) => Promise<void>>().mockResolvedValue(undefined),
  reportError: vi.fn(),
  result: vi.fn<() => DesktopResult | null>(() => null),
  syncIntegration: vi.fn(async () => undefined)
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('events')
  class Window extends EventEmitter {
    visible = false
    webContents = Object.assign(new EventEmitter(), {
      send: vi.fn(),
      isLoading: () => false,
      setWindowOpenHandler: vi.fn()
    })
    constructor(options: BrowserWindowConstructorOptions) {
      super()
      runtime.windows.push(this)
      runtime.windowOptions.push(options)
    }
    isDestroyed(): boolean {
      return false
    }
    isMinimized(): boolean {
      return true
    }
    isVisible(): boolean {
      return this.visible
    }
    loadFile = vi.fn()
    loadURL = vi.fn()
    setTitleBarOverlay = vi.fn()
    show = vi.fn(() => {
      this.visible = true
      this.emit('show')
    })
    hide = vi.fn(() => {
      this.visible = false
      this.emit('hide')
    })
    focus = vi.fn()
    restore = vi.fn()
    maximize = vi.fn()
    getNormalBounds = (): { x: number; y: number; width: number; height: number } => ({
      x: 0,
      y: 0,
      width: 1280,
      height: 800
    })
    isMaximized = (): boolean => false
  }
  runtime.tray.mockImplementation(function () {
    return { setToolTip: vi.fn(), setContextMenu: vi.fn(), destroy: vi.fn() }
  })
  return {
    app: {
      setName: vi.fn(),
      setAboutPanelOptions: runtime.aboutOptions,
      dock: { setIcon: runtime.dockIcon },
      commandLine: { appendSwitch: vi.fn() },
      requestSingleInstanceLock: () => true,
      on: (event: string, callback: (...args: unknown[]) => void) =>
        runtime.events.set(event, callback),
      whenReady: () => Promise.resolve(),
      isReady: () => true,
      isPackaged: false,
      getPath: (name: string) => join(runtime.root, name),
      getAppPath: () => runtime.root,
      quit: runtime.quit
    },
    BrowserWindow: Window,
    Tray: runtime.tray,
    Menu: { buildFromTemplate: (items: unknown) => items, setApplicationMenu: runtime.menu },
    screen: {
      getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })
    },
    dialog: { showMessageBox: runtime.messageBox, showOpenDialog: runtime.openDialog },
    shell: { trashItem: vi.fn(), openExternal: vi.fn(), openPath: vi.fn() },
    Notification: { isSupported: () => false }
  }
})
vi.mock('@electron-toolkit/utils', () => ({
  is: {
    get dev() {
      return runtime.dev
    }
  },
  electronApp: { setAppUserModelId: vi.fn() },
  optimizer: { watchWindowShortcuts: vi.fn() }
}))
vi.mock('./ipc', () => ({
  registerIpc: (
    _window: unknown,
    queue: TaskQueue,
    settings: SettingsStore,
    _updates: unknown,
    desktop: DesktopIpc
  ) => {
    runtime.queue = queue
    runtime.settings = settings
    runtime.desktop = desktop
    return vi.fn()
  }
}))
vi.mock('./services/desktop-actions', () => ({
  DesktopActions: class {
    result = runtime.result
    enqueue = runtime.enqueue
    reportError = runtime.reportError
    showResult = vi.fn()
    dispose = vi.fn()
  }
}))
vi.mock('./services/desktop-integration', () => ({
  DesktopIntegration: class {
    sync = runtime.syncIntegration
    state = vi.fn(async () => ({ status: 'unavailable' }))
  }
}))
vi.mock('./services/update-service', () => ({
  UpdateService: class {
    initialize = vi.fn()
  }
}))
vi.mock('./media/audio-processor', () => ({ processAudio: vi.fn() }))
vi.mock('./media/font-processor', () => ({ processFont: vi.fn() }))
vi.mock('./media/image-processor', () => ({ processImage: vi.fn() }))
vi.mock('./media/pdf-processor', () => ({ processPdf: vi.fn(), shutdownPdfProcesses: vi.fn() }))
vi.mock('./media/video-processor', () => ({ processVideo: vi.fn() }))
vi.mock('./media/sprite-processor', () => ({ processSprite: vi.fn() }))
vi.mock('./media/font-preview-protocol', () => ({
  registerFontPreviewScheme: vi.fn(),
  registerFontPreviewProtocol: vi.fn(),
  clearFontPreview: vi.fn()
}))

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const originalArgv = process.argv
const originalThreadpoolSize = process.env.UV_THREADPOOL_SIZE
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  runtime.result.mockReturnValue(null)
  runtime.events.clear()
  runtime.windows.length = 0
  runtime.windowOptions.length = 0
  runtime.dev = false
  runtime.queue = null
  runtime.settings = null
  runtime.desktop = null
  runtime.root = mkdtempSync(join(tmpdir(), 'vvtools-main-'))
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
  process.argv = ['vvtools']
})
afterEach(() => {
  runtime.events.get('before-quit')?.()
  Object.defineProperty(process, 'platform', platform)
  process.argv = originalArgv
  if (originalThreadpoolSize === undefined) delete process.env.UV_THREADPOOL_SIZE
  else process.env.UV_THREADPOOL_SIZE = originalThreadpoolSize
  rmSync(runtime.root, { recursive: true, force: true })
  vi.restoreAllMocks()
})
async function start(): Promise<void> {
  await import('./index')
  await vi.waitFor(() => expect(runtime.desktop).not.toBeNull())
}

describe('desktop lifecycle orchestration', () => {
  it('never creates a Windows tray or its queue listener, including background close and second launch', async () => {
    await start()
    expect(runtime.windows).toHaveLength(1)
    expect(runtime.windowOptions[0].icon).toEqual(expect.stringContaining('icon.ico'))
    expect(runtime.aboutOptions).toHaveBeenCalledExactlyOnceWith({
      applicationName: 'VVTools',
      iconPath: expect.stringContaining('resources/icon.png')
    })
    expect(runtime.dockIcon).not.toHaveBeenCalled()
    expect(runtime.queue!.listenerCount('changed')).toBe(0)
    runtime.settings!.update({ common: { closeBehavior: 'minimizeToTray' } })
    vi.spyOn(runtime.queue!, 'activeCount').mockReturnValue(1)
    const preventDefault = vi.fn()
    const window = runtime.windows[0]
    window.emit('close', { preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(window.hide).toHaveBeenCalledOnce()
    runtime.events.get('second-instance')!({}, ['vvtools'], '', { argv: ['vvtools'] })
    expect(runtime.windows).toHaveLength(1)
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    expect(runtime.tray).not.toHaveBeenCalled()
    expect(runtime.quit).not.toHaveBeenCalled()
  })
  it('installs the macOS application menu without a tray or menu-only state listeners', async () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' })
    await start()
    expect(runtime.tray).not.toHaveBeenCalled()
    expect(runtime.menu).toHaveBeenCalledOnce()
    expect(runtime.menu.mock.calls[0][0].map((item) => item.label)).toEqual([
      'VVTools',
      '文件',
      '编辑',
      '视图',
      '窗口',
      '帮助'
    ])
    expect(runtime.queue!.listenerCount('changed')).toBe(0)
    expect(runtime.dockIcon).not.toHaveBeenCalled()
  })

  it('uses the padded macOS PNG for the development Dock icon without overriding the packaged ICNS', async () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' })
    runtime.dev = true
    await start()
    expect(runtime.dockIcon).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('icon-mac.png')
    )
    expect(runtime.windowOptions[0].icon).toEqual(expect.stringContaining('resources/icon.png'))
    expect(runtime.tray).not.toHaveBeenCalled()
  })
  it('starts file-manager launches without a renderer and forwards ordered data to the existing instance', async () => {
    process.argv = [
      'vvtools',
      '--vvtools-action=open',
      '--',
      '/tmp/first.png',
      '/tmp/中文 second.png'
    ]
    await start()
    await vi.waitFor(() => expect(runtime.enqueue).toHaveBeenCalledOnce())
    expect(runtime.windows).toHaveLength(0)
    expect(runtime.enqueue.mock.calls[0][0]).toMatchObject({
      actionId: 'open',
      paths: ['/tmp/first.png', '/tmp/中文 second.png']
    })
    const forwarded = ['vvtools', '--vvtools-action=open', '--', '/tmp/next & third.png']
    runtime.events.get('second-instance')!({}, ['reordered'], '', { argv: forwarded })
    await vi.waitFor(() => expect(runtime.enqueue).toHaveBeenCalledTimes(2))
    expect(runtime.enqueue.mock.calls[1][0]).toMatchObject({
      actionId: 'open',
      paths: ['/tmp/next & third.png']
    })
    expect(runtime.windows).toHaveLength(0)
    expect(runtime.tray).not.toHaveBeenCalled()
  })
  it('preserves persisted settings and restores the prior entry when integration changes fail', async () => {
    await start()
    runtime.settings!.update({ common: { closeBehavior: 'ask' } })
    const previous = runtime.settings!.get()
    runtime.syncIntegration.mockRejectedValueOnce(new Error('registration failed'))
    await expect(
      runtime.desktop!.updateSettings({
        desktop: { contextMenuEnabled: true },
        common: { closeBehavior: 'quit' }
      })
    ).rejects.toThrow('registration failed')
    expect(runtime.settings!.get()).toEqual(previous)
    expect(runtime.syncIntegration.mock.calls).toEqual([
      [expect.objectContaining({ contextMenuEnabled: true })],
      [previous.desktop]
    ])
    await expect(
      runtime.desktop!.updateSettings({ common: { closeBehavior: 'minimizeToTray' } })
    ).resolves.toMatchObject({ common: { closeBehavior: 'minimizeToTray' } })
    expect(runtime.tray).not.toHaveBeenCalled()
  })
  it('keeps a Windows request alive if its window closes during preparation', async () => {
    await start()
    runtime.settings!.update({ common: { closeBehavior: 'minimizeToTray' } })
    let finish!: () => void
    const preparing = new Promise<void>((resolve) => {
      finish = resolve
    })
    runtime.enqueue.mockImplementationOnce(() => preparing)
    runtime.events.get('second-instance')!({}, [], '', {
      argv: ['vvtools', '--vvtools-action=open', '--', '/tmp/photo.png']
    })
    await vi.waitFor(() => expect(runtime.enqueue).toHaveBeenCalledOnce())
    const preventDefault = vi.fn()
    runtime.windows[0].emit('close', { preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(runtime.windows[0].hide).toHaveBeenCalledOnce()
    runtime.events.get('window-all-closed')!()
    expect(runtime.quit).not.toHaveBeenCalled()
    expect(runtime.tray).not.toHaveBeenCalled()
    finish()
    await preparing
  })
  it('reveals skipped inputs once on a normal Windows launch even without a notification click', async () => {
    await start()
    runtime.result.mockReturnValue({
      requestId: 'request',
      name: '分享图',
      successful: 0,
      skipped: 1,
      failed: 0,
      notice: '输出已存在',
      pendingPaths: ['/tmp/skipped.png']
    })
    runtime.events.get('second-instance')!({}, ['vvtools'], '', { argv: ['vvtools'] })
    const navigation = runtime.desktop!.getNavigation()!
    expect(navigation).toMatchObject({
      path: '/image',
      paths: ['/tmp/skipped.png'],
      notice: '输出已存在',
      preserveBatch: true
    })
    runtime.desktop!.acknowledgeNavigation(navigation.id)
    runtime.events.get('second-instance')!({}, ['vvtools'], '', { argv: ['vvtools'] })
    expect(runtime.desktop!.getNavigation()).toBeNull()
    expect(runtime.tray).not.toHaveBeenCalled()
  })

  it('reopens a macOS window from the application menu after its last window closes without creating a tray', async () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' })
    await start()
    runtime.windows[0].emit('closed')
    const windowMenu = runtime.menu.mock.calls[0][0].find((item) => item.label === '窗口')!
      .submenu as MenuItemConstructorOptions[]
    const show = windowMenu.find((item) => item.label === '显示主窗口')!
    show.click!(undefined as never, undefined, undefined as never)
    expect(runtime.windows).toHaveLength(2)
    expect(runtime.windows[1].show).toHaveBeenCalledOnce()
    expect(runtime.windows[1].focus).toHaveBeenCalledOnce()
    expect(runtime.menu).toHaveBeenCalledOnce()
    expect(runtime.tray).not.toHaveBeenCalled()
  })

  it('routes workspace and settings menu commands through the acknowledged navigation bridge', async () => {
    await start()
    const menu = runtime.menu.mock.calls[0][0]
    const view = menu.find((item) => item.label === '视图')!.submenu as MenuItemConstructorOptions[]
    view.find((item) => item.label === '视频雪碧图')!.click!(
      undefined as never,
      undefined,
      undefined as never
    )
    const navigation = runtime.desktop!.getNavigation()!
    expect(navigation).toMatchObject({ path: '/sprite' })
    runtime.desktop!.acknowledgeNavigation(navigation.id)
    const file = menu.find((item) => item.label === '文件')!.submenu as MenuItemConstructorOptions[]
    const quick = file.find((item) => item.label === '快捷处理')!
      .submenu as MenuItemConstructorOptions[]
    quick.find((item) => item.label === '管理快捷动作…')!.click!(
      undefined as never,
      undefined,
      undefined as never
    )
    expect(runtime.desktop!.getNavigation()).toMatchObject({
      path: '/settings',
      section: 'desktop-integration'
    })
    expect(runtime.tray).not.toHaveBeenCalled()
  })

  it('keeps menu-submitted image preparation alive and confirms quitting while it is pending', async () => {
    await start()
    runtime.settings!.update({ common: { closeBehavior: 'minimizeToTray' } })
    let finish!: () => void
    const preparing = new Promise<void>((resolve) => {
      finish = resolve
    })
    runtime.enqueue.mockImplementationOnce(() => preparing)
    runtime.openDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/photo.png'] })
    const menu = runtime.menu.mock.calls[0][0]
    const file = menu.find((item) => item.label === '文件')!.submenu as MenuItemConstructorOptions[]
    const quick = file.find((item) => item.label === '快捷处理')!
      .submenu as MenuItemConstructorOptions[]
    quick[0].click!(undefined as never, undefined, undefined as never)
    await vi.waitFor(() => expect(runtime.enqueue).toHaveBeenCalledOnce())
    expect(runtime.enqueue.mock.calls[0][0]).toMatchObject({
      actionId: 'image-share',
      paths: ['/tmp/photo.png']
    })
    const preventDefault = vi.fn()
    runtime.windows[0].emit('close', { preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(runtime.windows[0].hide).toHaveBeenCalledOnce()
    file.find((item) => item.label === '退出 VVTools')!.click!(
      undefined as never,
      undefined,
      undefined as never
    )
    await vi.waitFor(() => expect(runtime.messageBox).toHaveBeenCalledOnce())
    expect(runtime.messageBox.mock.calls[0][0]).toMatchObject({
      message: '快捷任务正在准备',
      cancelId: 1
    })
    expect(runtime.quit).not.toHaveBeenCalled()
    expect(runtime.tray).not.toHaveBeenCalled()
    finish()
    await preparing
  })
})
