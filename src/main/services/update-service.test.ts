import { EventEmitter } from 'events'
import type { BrowserWindow } from 'electron'
import type { UpdateInfo } from 'electron-updater'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app, shell } from 'electron'
import electronUpdater from 'electron-updater'
import { IPC_CHANNELS } from '../../shared/constants'
import { UpdateService } from './update-service'

vi.mock('electron', () => ({
  app: { isPackaged: true },
  shell: { openExternal: vi.fn(async () => undefined) }
}))
vi.mock('electron-updater', async () => {
  const { EventEmitter } = await import('events')
  return {
    default: {
      autoUpdater: Object.assign(new EventEmitter(), {
        autoDownload: true,
        autoInstallOnAppQuit: true,
        checkForUpdates: vi.fn(),
        downloadUpdate: vi.fn(async () => []),
        quitAndInstall: vi.fn()
      })
    }
  }
})
const updater = electronUpdater.autoUpdater as typeof electronUpdater.autoUpdater & EventEmitter
const info = { version: '0.1.0', releaseNotes: '  新版本说明  ' } as UpdateInfo
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  updater.removeAllListeners()
  Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })
})
afterEach(() => {
  updater.removeAllListeners()
  vi.useRealTimers()
})

describe('GitHub update flow', () => {
  it.each(['win32', 'linux'] as const)(
    'preserves download and installation on %s',
    async (platform) => {
      const send = vi.fn()
      const window = { isDestroyed: () => false, webContents: { send } } as unknown as BrowserWindow
      const service = new UpdateService(() => window, platform)
      service.initialize()
      expect(updater.autoDownload).toBe(false)
      expect(updater.autoInstallOnAppQuit).toBe(true)
      updater.emit('checking-for-update')
      updater.emit('update-available', info)
      expect(service.getState()).toEqual({
        status: 'available',
        version: '0.1.0',
        releaseNotes: '新版本说明',
        manualInstall: false
      })
      expect(send).toHaveBeenLastCalledWith(IPC_CHANNELS.updatesChanged, service.getState())
      await service.download()
      expect(updater.downloadUpdate).toHaveBeenCalledOnce()
      updater.emit('download-progress', { percent: 42.8 })
      expect(service.getState()).toMatchObject({
        status: 'downloading',
        percent: 43,
        releaseNotes: '新版本说明'
      })
      updater.emit('update-downloaded', info)
      service.install()
      expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
      expect(shell.openExternal).not.toHaveBeenCalled()
    }
  )

  it.each(['arm64', 'x64'] as const)(
    'opens the exact macOS %s DMG without invoking unsigned automatic installation',
    async (architecture) => {
      const service = new UpdateService(() => null, 'darwin', architecture)
      service.initialize()
      expect(updater.autoInstallOnAppQuit).toBe(false)
      updater.emit('update-available', info)
      await service.download()
      expect(shell.openExternal).toHaveBeenCalledWith(
        `https://github.com/yulin96/vvtools/releases/download/v0.1.0/vvtools-0.1.0-${architecture}.dmg`
      )
      expect(service.getState()).toMatchObject({ status: 'available', manualInstall: true })
      updater.emit('update-downloaded', info)
      service.install()
      expect(updater.downloadUpdate).not.toHaveBeenCalled()
      expect(updater.quitAndInstall).not.toHaveBeenCalled()
    }
  )

  it('preserves a macOS open error and provides the GitHub release fallback', async () => {
    const service = new UpdateService(() => null, 'darwin')
    service.initialize()
    updater.emit('update-available', info)
    vi.mocked(shell.openExternal).mockRejectedValueOnce(new Error('browser unavailable'))
    await service.download()
    expect(service.getState()).toEqual({
      status: 'error',
      version: '0.1.0',
      manualInstall: true,
      message: 'browser unavailable',
      releaseNotes: '新版本说明'
    })
    await service.openReleasePage()
    expect(shell.openExternal).toHaveBeenLastCalledWith(
      'https://github.com/yulin96/vvtools/releases/latest'
    )
  })

  it('does not access updates in development or download before a version is available', async () => {
    Object.defineProperty(app, 'isPackaged', { value: false, configurable: true })
    const service = new UpdateService(() => null)
    service.initialize()
    expect(await service.check()).toEqual({ status: 'unsupported' })
    await service.download()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    expect(shell.openExternal).not.toHaveBeenCalled()
  })
})
