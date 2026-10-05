import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeDesktopSettings } from '../../shared/desktop-settings'
import {
  DesktopIntegration,
  macWorkflow,
  SHELL_CLSID,
  windowsRegistration,
  type DesktopIntegrationOptions
} from './desktop-integration'

const roots: string[] = []
async function fixture(
  platform: DesktopIntegrationOptions['platform']
): Promise<DesktopIntegrationOptions> {
  const root = await mkdtemp(join(tmpdir(), 'vvtools-integration-'))
  roots.push(root)
  return {
    platform,
    packaged: true,
    executable: "/Applications/VVTools & 'Test.app/Contents/MacOS/VVTools",
    home: root,
    resources: join(root, 'resources'),
    userData: join(root, 'user-data'),
    requests: join(root, 'user-data', 'desktop-requests')
  }
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
describe('desktop integration artifacts', () => {
  it('registers only per-user owned keys and a grouped multi-selection command', () => {
    const settings = normalizeDesktopSettings(undefined)
    settings.actions.reverse()
    settings.actions[0].name = 'Web "图片"'
    settings.actions[1].enabled = false
    const registry = windowsRegistration(
      settings,
      'C:\\Apps\\VVTools\\vvtools.exe',
      'C:\\Apps\\VVTools\\shell.dll',
      'C:\\Users\\user\\requests'
    )
    expect(registry).not.toContain('HKEY_LOCAL_MACHINE')
    expect(registry).toContain(
      '[HKEY_CURRENT_USER\\Software\\Classes\\CLSID\\' + SHELL_CLSID + '\\InProcServer32]'
    )
    expect(registry).toContain('"ActionOrder"="image-web,image-share"')
    expect(registry).toContain('"image-share-enabled"=dword:00000000')
    expect(registry).toContain('"image-web-name"="Web \\"图片\\""')
    expect(registry).toContain('"Executable"="C:\\\\Apps\\\\VVTools\\\\vvtools.exe"')
    expect(registry).toContain('"MultiSelectModel"="Player"')
    expect(registry).toContain('SystemFileAssociations\\.woff2\\shell\\VVTools')
    const removal = windowsRegistration(settings, '', '', '', true)
    expect(removal).toContain(
      '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.png\\shell\\VVTools]'
    )
    expect(removal).not.toContain('"Executable"=')
  })
  it('writes Finder workflows, detects changes, and removes only its own bundles', async () => {
    const options = await fixture('darwin')
    const manager = new DesktopIntegration(options, vi.fn())
    const settings = normalizeDesktopSettings({ contextMenuEnabled: true })
    const unrelated = join(options.home, 'Library', 'Services', 'MyAction.workflow')
    await mkdir(unrelated, { recursive: true })
    await writeFile(join(unrelated, 'keep'), 'mine')
    await manager.sync(settings)
    expect(await manager.state(settings)).toMatchObject({ platform: 'darwin', status: 'installed' })
    const directory = join(
      options.home,
      'Library',
      'Services',
      'VVTools-image-share.workflow',
      'Contents'
    )
    const info = await readFile(join(directory, 'Info.plist'), 'utf8')
    const document = await readFile(join(directory, 'Resources', 'document.wflow'), 'utf8')
    expect(info).toContain('<key>NSSendFileTypes</key><array><string>public.image</string></array>')
    expect(document).toContain('<key>AMAccepts</key>')
    expect(document).toContain('<key>inputMethod</key><integer>1</integer>')
    expect(document).toContain('--vvtools-action=image-share')
    expect(document).toContain('-- &quot;$@&quot;')
    await writeFile(join(directory, 'Resources', 'document.wflow'), 'changed')
    expect(await manager.state(settings)).toMatchObject({ status: 'needs-repair' })
    settings.actions[0].enabled = false
    await manager.sync(settings)
    await expect(readFile(join(directory, 'Info.plist'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await manager.state(settings)).toMatchObject({ status: 'installed' })
    settings.contextMenuEnabled = false
    await manager.sync(settings)
    expect(await manager.state(settings)).toMatchObject({ status: 'not-installed' })
    await expect(readFile(join(unrelated, 'keep'), 'utf8')).resolves.toBe('mine')
  })
  it('imports a UTF-16 registry artifact through argument arrays and cleans up after failure', async () => {
    const options = await fixture('win32')
    await mkdir(join(options.resources, 'shell'), { recursive: true })
    await writeFile(join(options.resources, 'shell', 'vvtools-shell.dll'), 'native fixture')
    const command = vi.fn(async (executable: string, args: string[]) => {
      expect(executable).toBe('reg.exe')
      expect(args[0]).toBe('import')
      expect(await readFile(args[1], 'utf16le')).toContain(
        '\ufeffWindows Registry Editor Version 5.00'
      )
      throw new Error('permission denied')
    })
    const manager = new DesktopIntegration(options, command)
    await expect(
      manager.sync(normalizeDesktopSettings({ contextMenuEnabled: true }))
    ).rejects.toThrow('permission denied')
    await expect(readFile(join(options.userData, 'desktop-integration.reg'))).rejects.toMatchObject(
      { code: 'ENOENT' }
    )
    expect(command).toHaveBeenCalledOnce()
  })
  it('does not modify system integration in development and reports its availability', async () => {
    const options = { ...(await fixture('darwin')), packaged: false }
    const command = vi.fn()
    const manager = new DesktopIntegration(options, command)
    const settings = normalizeDesktopSettings(undefined)
    await manager.sync(settings)
    expect(await manager.state(settings)).toMatchObject({ status: 'unavailable' })
    settings.contextMenuEnabled = true
    await expect(manager.sync(settings)).rejects.toThrow('安装版')
    expect(command).not.toHaveBeenCalled()
  })
  it('scopes the open action to files and escapes workflow labels and executable paths', () => {
    const workflow = macWorkflow(
      'open',
      'VVTools & Files',
      "/Applications/Test's App.app/Contents/MacOS/VVTools"
    )
    expect(workflow.info).toContain('VVTools &amp; Files')
    expect(workflow.info).toContain('<string>public.data</string>')
    expect(workflow.document).toContain("Test'")
    expect(workflow.document).toContain(
      '<key>serviceInputTypeIdentifier</key><string>com.apple.Automator.fileSystemObject</string>'
    )
  })
})
