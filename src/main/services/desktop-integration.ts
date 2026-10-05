import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  AUDIO_EXTENSIONS,
  FONT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  PDF_EXTENSIONS,
  VIDEO_EXTENSIONS
} from '../../shared/constants'
import type { DesktopSettings, DesktopIntegrationState } from '../../shared/types'

export const SHELL_CLSID = '{D8E3EB9A-31F4-4795-AD5E-31FEC06F3AA1}'
export const SHELL_REGISTRY_KEY = 'HKEY_CURRENT_USER\\Software\\VVTools\\Shell'
const extensions = [
  ...new Set([
    ...IMAGE_EXTENSIONS,
    ...VIDEO_EXTENSIONS,
    ...AUDIO_EXTENSIONS,
    ...PDF_EXTENSIONS,
    ...FONT_EXTENSIONS
  ])
]
const workflowIds = ['image-share', 'image-web', 'open'] as const

export async function runDesktopCommand(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('系统集成命令超时'))
    }, 15_000)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-64 * 1024)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-64 * 1024)
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || stdout.trim() || '系统集成命令失败'))
    })
  })
}
function regString(value: string): string {
  return '"' + value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"') + '"'
}
function xml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
}
export function shellQuote(value: string): string {
  return "'" + value.replace(/'/gu, "'\\''") + "'"
}
export function macWorkflow(
  actionId: string,
  name: string,
  executable: string
): { info: string; document: string } {
  const script =
    'if [ ! -x ' +
    shellQuote(executable) +
    ' ]; then\n  /usr/bin/osascript -e ' +
    shellQuote(
      'display alert "VVTools 无法启动" message "请重新安装 VVTools，或移除失效的快速操作。"'
    ) +
    '\n  exit 1\nfi\n' +
    shellQuote(executable) +
    ' ' +
    shellQuote('--vvtools-action=' + actionId) +
    ' -- "$@" >/dev/null 2>&1 &\n'
  const header =
    '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0">'
  const fileType = actionId === 'open' ? 'public.data' : 'public.image'
  const inputType =
    actionId === 'open'
      ? 'com.apple.Automator.fileSystemObject'
      : 'com.apple.Automator.fileSystemObject.image'
  return {
    info:
      header +
      '<dict><key>CFBundleIdentifier</key><string>com.vvtools.quickaction.' +
      xml(actionId) +
      '</string><key>CFBundleName</key><string>' +
      xml(name) +
      '</string><key>CFBundlePackageType</key><string>BNDL</string><key>NSServices</key><array><dict><key>NSMenuItem</key><dict><key>default</key><string>' +
      xml(name) +
      '</string></dict><key>NSMessage</key><string>runWorkflowAsService</string><key>NSSendFileTypes</key><array><string>' +
      fileType +
      '</string></array><key>NSReturnTypes</key><array/><key>NSRequiredContext</key><dict><key>NSApplicationIdentifier</key><string>com.apple.finder</string></dict></dict></array></dict></plist>',
    document:
      header +
      '<dict><key>AMApplicationBuild</key><string>523</string><key>AMApplicationVersion</key><string>2.10</string><key>AMDocumentVersion</key><string>2</string><key>actions</key><array><dict><key>action</key><dict><key>ActionBundlePath</key><string>/System/Library/Automator/Run Shell Script.action</string><key>ActionName</key><string>Run Shell Script</string><key>ActionParameters</key><dict><key>COMMAND_STRING</key><string>' +
      xml(script) +
      '</string><key>inputMethod</key><integer>1</integer><key>shell</key><string>/bin/bash</string></dict><key>AMActionVersion</key><string>2.0.3</string><key>AMParameterProperties</key><dict/><key>BundleIdentifier</key><string>com.apple.RunShellScript</string><key>AMAccepts</key><dict><key>Types</key><array><string>com.apple.cocoa.string</string></array><key>Container</key><string>List</string></dict><key>AMProvides</key><dict><key>Types</key><array><string>com.apple.cocoa.string</string></array><key>Container</key><string>List</string></dict></dict></dict></array><key>workflowMetaData</key><dict><key>serviceInputTypeIdentifier</key><string>' +
      inputType +
      '</string><key>serviceOutputTypeIdentifier</key><string>com.apple.Automator.nothing</string><key>serviceApplicationBundleID</key><string>com.apple.finder</string><key>serviceApplicationPath</key><string>/System/Library/CoreServices/Finder.app</string><key>serviceProcessesInput</key><integer>0</integer><key>workflowTypeIdentifier</key><string>com.apple.Automator.servicesMenu</string></dict></dict></plist>'
  }
}
export function windowsRegistration(
  settings: DesktopSettings,
  executable: string,
  dll: string,
  requests: string,
  remove = false
): string {
  const shellKeys = extensions.map(
    (extension) =>
      'HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\' +
      extension +
      '\\shell\\VVTools'
  )
  const classKey = 'HKEY_CURRENT_USER\\Software\\Classes\\CLSID\\' + SHELL_CLSID
  const keys = [SHELL_REGISTRY_KEY, classKey, ...shellKeys]
  let text =
    'Windows Registry Editor Version 5.00\r\n\r\n' +
    keys.map((key) => '[-' + key + ']\r\n').join('\r\n')
  if (remove) return text
  const fingerprint = integrationFingerprint(settings, executable, dll)
  text +=
    '\r\n[' +
    SHELL_REGISTRY_KEY +
    ']\r\n"Executable"=' +
    regString(executable) +
    '\r\n"RequestDirectory"=' +
    regString(requests) +
    '\r\n"Fingerprint"=' +
    regString(fingerprint) +
    '\r\n"ActionOrder"=' +
    regString(settings.actions.map((action) => action.id).join(',')) +
    '\r\n'
  for (const action of settings.actions) {
    text +=
      regString(action.id + '-name') +
      '=' +
      regString(action.name) +
      '\r\n' +
      regString(action.id + '-enabled') +
      '=dword:0000000' +
      Number(action.enabled) +
      '\r\n'
  }
  text +=
    '\r\n[' +
    classKey +
    ']\r\n@="VVTools file actions"\r\n\r\n[' +
    classKey +
    '\\InProcServer32]\r\n@=' +
    regString(dll) +
    '\r\n"ThreadingModel"="Apartment"\r\n'
  for (const key of shellKeys)
    text +=
      '\r\n[' +
      key +
      ']\r\n"MUIVerb"="VVTools"\r\n"ExplorerCommandHandler"=' +
      regString(SHELL_CLSID) +
      '\r\n"MultiSelectModel"="Player"\r\n"Icon"=' +
      regString(executable + ',0') +
      '\r\n'
  return text
}
function integrationFingerprint(
  settings: DesktopSettings,
  executable: string,
  dll: string
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        executable,
        dll,
        settings.actions.map(({ id, name, enabled }) => ({ id, name, enabled }))
      ])
    )
    .digest('hex')
}
export interface DesktopIntegrationOptions {
  platform: DesktopIntegrationState['platform']
  packaged: boolean
  executable: string
  resources: string
  userData: string
  home: string
  requests: string
}
export class DesktopIntegration {
  constructor(
    private readonly options: DesktopIntegrationOptions,
    private readonly command = runDesktopCommand
  ) {}
  private workflowPath(id: string): string {
    return join(this.options.home, 'Library', 'Services', 'VVTools-' + id + '.workflow', 'Contents')
  }
  async sync(settings: DesktopSettings): Promise<void> {
    const { platform, packaged } = this.options
    if (settings.contextMenuEnabled && (!packaged || platform === 'linux'))
      throw new Error(
        platform === 'linux' ? '当前仅支持 Windows 和 macOS 文件右键' : '文件右键需要安装版 VVTools'
      )
    if (!packaged || platform === 'linux') return
    if (platform === 'darwin') {
      for (const id of workflowIds) {
        const action = settings.actions.find((item) => item.id === id)
        const directory = this.workflowPath(id)
        if (!settings.contextMenuEnabled || (action && !action.enabled)) {
          await rm(directory.slice(0, -'/Contents'.length), { recursive: true, force: true })
          continue
        }
        const workflow = macWorkflow(
          id,
          'VVTools · ' + (action?.name ?? '添加到 VVTools'),
          this.options.executable
        )
        await mkdir(join(directory, 'Resources'), { recursive: true })
        await writeFile(join(directory, 'Info.plist'), workflow.info)
        await writeFile(join(directory, 'Resources', 'document.wflow'), workflow.document)
      }
      return
    }
    const dll = join(this.options.resources, 'shell', 'vvtools-shell.dll')
    if (settings.contextMenuEnabled && !(await stat(dll)).isFile())
      throw new Error('Windows 右键组件不可用，请重新安装 VVTools')
    await mkdir(this.options.userData, { recursive: true })
    await mkdir(this.options.requests, { recursive: true })
    const file = join(this.options.userData, 'desktop-integration.reg')
    try {
      await writeFile(
        file,
        '\ufeff' +
          windowsRegistration(
            settings,
            this.options.executable,
            dll,
            this.options.requests,
            !settings.contextMenuEnabled
          ),
        'utf16le'
      )
      await this.command('reg.exe', ['import', file])
    } finally {
      await rm(file, { force: true })
    }
  }
  async state(settings: DesktopSettings): Promise<DesktopIntegrationState> {
    const { platform, packaged } = this.options
    if (!packaged || platform === 'linux')
      return {
        platform,
        status: 'unavailable',
        message:
          platform === 'linux' ? '文件右键目前支持 Windows 和 macOS' : '文件右键在安装版中启用'
      }
    if (platform === 'darwin') {
      let installed = 0
      let matched = true
      for (const id of workflowIds) {
        const action = settings.actions.find((item) => item.id === id)
        const expected = settings.contextMenuEnabled && (!action || action.enabled)
        try {
          const directory = this.workflowPath(id)
          const [info, document] = await Promise.all([
            readFile(join(directory, 'Info.plist'), 'utf8'),
            readFile(join(directory, 'Resources', 'document.wflow'), 'utf8')
          ])
          installed += 1
          const workflow = macWorkflow(
            id,
            'VVTools · ' + (action?.name ?? '添加到 VVTools'),
            this.options.executable
          )
          if (!expected || info !== workflow.info || document !== workflow.document) matched = false
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          if (expected) matched = false
        }
      }
      return {
        platform,
        status:
          installed === 0 && !settings.contextMenuEnabled
            ? 'not-installed'
            : matched
              ? 'installed'
              : 'needs-repair',
        message:
          installed && matched
            ? '快速操作已安装；Finder 未显示时，请在系统设置中启用对应服务'
            : installed === 0 && !settings.contextMenuEnabled
              ? '尚未安装快速操作'
              : '快速操作缺失或与当前设置不一致，请修复入口'
      }
    }
    let registry = ''
    try {
      registry = await this.command('reg.exe', ['query', SHELL_REGISTRY_KEY, '/v', 'Fingerprint'])
    } catch {
      return {
        platform,
        status: settings.contextMenuEnabled ? 'needs-repair' : 'not-installed',
        message: settings.contextMenuEnabled
          ? '未检测到有效入口，请修复入口'
          : '尚未安装文件右键入口'
      }
    }
    const dll = join(this.options.resources, 'shell', 'vvtools-shell.dll')
    let available = true
    try {
      available = (await stat(dll)).isFile()
    } catch {
      available = false
    }
    const matched =
      settings.contextMenuEnabled &&
      available &&
      registry.includes(integrationFingerprint(settings, this.options.executable, dll))
    return {
      platform,
      status: matched ? 'installed' : 'needs-repair',
      message: matched
        ? '经典右键入口已安装；Windows 11 请使用“显示更多选项”'
        : '右键入口与当前安装位置或设置不一致，请修复入口'
    }
  }
}
