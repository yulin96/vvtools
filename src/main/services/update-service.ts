import { app, BrowserWindow, shell } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateInfo } from 'electron-updater'
import { IPC_CHANNELS } from '../../shared/constants'
import type { UpdateState } from '../../shared/types'

const { autoUpdater } = electronUpdater
const RELEASES_URL = 'https://github.com/yulin96/vvtools/releases/latest'

export function normalizeUpdateReleaseNotes(info: UpdateInfo): string | undefined {
  if (typeof info.releaseNotes === 'string') return info.releaseNotes.trim() || undefined
  if (!Array.isArray(info.releaseNotes)) return undefined
  const notes = info.releaseNotes
    .map((release) => release.note?.trim())
    .filter((note): note is string => Boolean(note))
    .join('\n\n')
  return notes || undefined
}

export class UpdateService {
  private state: UpdateState = { status: 'idle' }
  private initialized = false

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  initialize(): void {
    if (this.initialized || !app.isPackaged) return
    this.initialized = true

    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('checking-for-update', () => this.setState({ status: 'checking' }))
    autoUpdater.on('update-available', (info) => {
      this.setState({
        status: 'available',
        version: info.version,
        releaseNotes: normalizeUpdateReleaseNotes(info)
      })
    })
    autoUpdater.on('update-not-available', (info) =>
      this.setState({ status: 'not-available', version: info.version })
    )
    autoUpdater.on('download-progress', (progress) =>
      this.setState({
        status: 'downloading',
        version: this.state.version,
        percent: Math.round(progress.percent),
        releaseNotes: this.state.releaseNotes
      })
    )
    autoUpdater.on('update-downloaded', (info) =>
      this.setState({
        status: 'downloaded',
        version: info.version,
        percent: 100,
        releaseNotes: normalizeUpdateReleaseNotes(info) ?? this.state.releaseNotes
      })
    )
    autoUpdater.on('error', (error) => this.setError(error))

    setTimeout(() => {
      void this.check().catch((error) => console.error('自动检查更新失败', error))
    }, 5000)
  }

  getState(): UpdateState {
    return this.state
  }

  async check(): Promise<UpdateState> {
    if (!app.isPackaged) return { status: 'unsupported' }
    if (this.state.status === 'checking' || this.state.status === 'downloading') return this.state
    await autoUpdater.checkForUpdates()
    return this.state
  }

  async download(): Promise<void> {
    if (!app.isPackaged || this.state.status !== 'available') return
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      this.setError(error)
    }
  }

  install(): void {
    if (this.state.status === 'downloaded') autoUpdater.quitAndInstall(false, true)
  }

  async openReleasePage(): Promise<void> {
    await shell.openExternal(RELEASES_URL)
  }

  private setError(error: unknown): void {
    this.setState({
      status: 'error',
      version: this.state.version,
      releaseNotes: this.state.releaseNotes,
      message: error instanceof Error ? error.message : String(error)
    })
  }

  private setState(state: UpdateState): void {
    this.state = state
    const window = this.getWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.updatesChanged, state)
    }
  }
}
