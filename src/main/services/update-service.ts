import { app, BrowserWindow, net, shell } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateInfo } from 'electron-updater'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../../shared/constants'
import type { UpdateState } from '../../shared/types'

const { autoUpdater } = electronUpdater
interface ReleaseManifest {
  version: string
  releaseNotes?: string
  downloads: {
    arm64: string
    x64: string
  }
}

interface UpdateConfig {
  baseUrl: string
}

export function normalizeUpdateReleaseNotes(info: UpdateInfo): string | undefined {
  if (typeof info.releaseNotes === 'string') return info.releaseNotes.trim() || undefined
  if (!Array.isArray(info.releaseNotes)) return undefined
  const notes = info.releaseNotes
    .map((release) => release.note?.trim())
    .filter((note): note is string => Boolean(note))
    .join('\n\n')
  return notes || undefined
}

function parseVersion(version: string): number[] | undefined {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const candidateParts = parseVersion(candidate)
  const currentParts = parseVersion(current)
  if (!candidateParts || !currentParts) return false
  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] === currentParts[index]) continue
    return candidateParts[index] > currentParts[index]
  }
  return false
}

function isHttpsUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('https://')
}

function isReleaseManifest(value: unknown, baseUrl: string): value is ReleaseManifest {
  if (!value || typeof value !== 'object') return false
  const manifest = value as Partial<ReleaseManifest>
  return (
    typeof manifest.version === 'string' &&
    (manifest.releaseNotes === undefined || typeof manifest.releaseNotes === 'string') &&
    Boolean(manifest.downloads) &&
    isHttpsUrl(manifest.downloads?.arm64) &&
    manifest.downloads.arm64.startsWith(`${baseUrl}/mac-arm64/`) &&
    isHttpsUrl(manifest.downloads?.x64) &&
    manifest.downloads.x64.startsWith(`${baseUrl}/mac-x64/`)
  )
}

export class UpdateService {
  private state: UpdateState = { status: 'idle' }
  private initialized = false
  private releaseUrl = ''

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  initialize(): void {
    if (this.initialized || !app.isPackaged) return
    this.initialized = true

    if (process.platform !== 'darwin') {
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
      autoUpdater.on('error', (error) => this.setState({ status: 'error', message: error.message }))
    }

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
    if (process.platform === 'darwin') return this.checkMacUpdate()
    await autoUpdater.checkForUpdates()
    return this.state
  }

  async download(): Promise<void> {
    if (process.platform === 'darwin') throw new Error('macOS 更新需要前往 GitHub 下载')
    if (!app.isPackaged || this.state.status !== 'available') return
    await autoUpdater.downloadUpdate()
  }

  install(): void {
    if (process.platform === 'darwin') throw new Error('macOS 更新需要手动安装')
    if (this.state.status === 'downloaded') autoUpdater.quitAndInstall(false, true)
  }

  async openReleasePage(): Promise<void> {
    if (!this.releaseUrl) throw new Error('当前版本没有可用的下载地址')
    await shell.openExternal(this.releaseUrl)
  }

  private async checkMacUpdate(): Promise<UpdateState> {
    this.setState({ status: 'checking' })
    try {
      const baseUrl = await this.getUpdateBaseUrl()
      const response = await net.fetch(`${baseUrl}/latest.json`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`更新服务返回 HTTP ${response.status}`)
      const value: unknown = await response.json()
      if (!isReleaseManifest(value, baseUrl)) throw new Error('更新清单格式无效')
      this.releaseUrl = value.downloads[process.arch === 'x64' ? 'x64' : 'arm64']
      this.setState(
        isNewerVersion(value.version, app.getVersion())
          ? {
              status: 'available',
              version: value.version,
              releaseNotes: value.releaseNotes?.trim() || undefined
            }
          : { status: 'not-available', version: app.getVersion() }
      )
    } catch (error) {
      this.setState({
        status: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
    return this.state
  }

  private async getUpdateBaseUrl(): Promise<string> {
    const content = await readFile(join(process.resourcesPath, 'update-config.json'), 'utf8')
    const value: unknown = JSON.parse(content)
    if (!value || typeof value !== 'object') throw new Error('更新配置格式无效')
    const baseUrl = (value as Partial<UpdateConfig>).baseUrl
    if (!isHttpsUrl(baseUrl)) throw new Error('更新地址必须使用 HTTPS')
    return baseUrl.replace(/\/+$/u, '')
  }

  private setState(state: UpdateState): void {
    this.state = state
    const window = this.getWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.updatesChanged, state)
    }
  }
}
