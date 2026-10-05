import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { normalizeDesktopSettings } from '../shared/desktop-settings'
import { applicationMenuTemplate } from './application-menu'

function fixture(
  isMac = true,
  development = false,
  hasResult = false
): {
  actions: Pick<
    Parameters<typeof applicationMenuTemplate>[0],
    'isMac' | 'development' | 'hasResult' | 'quickActions'
  > &
    Record<
      'openFiles' | 'navigate' | 'showWindow' | 'showResult' | 'openHelp' | 'quit',
      Mock<(...args: unknown[]) => void>
    >
  menu: MenuItemConstructorOptions[]
} {
  const actions = {
    isMac,
    development,
    hasResult,
    quickActions: normalizeDesktopSettings(undefined).actions,
    openFiles: vi.fn(),
    navigate: vi.fn(),
    showWindow: vi.fn(),
    showResult: vi.fn(),
    openHelp: vi.fn(),
    quit: vi.fn()
  }
  return { actions, menu: applicationMenuTemplate(actions) }
}

function submenu(menu: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] {
  const items = menu.find((item) => item.label === label)?.submenu
  expect(Array.isArray(items)).toBe(true)
  return items as MenuItemConstructorOptions[]
}

function click(item: MenuItemConstructorOptions | undefined): void {
  expect(item?.click).toBeTypeOf('function')
  item!.click!(undefined as never, undefined, undefined as never)
}

describe('native application menu', () => {
  it('uses the macOS application menu with standard editing roles and guarded quit', () => {
    const { menu, actions } = fixture()
    expect(menu.map((item) => item.label)).toEqual([
      'VVTools',
      '文件',
      '编辑',
      '视图',
      '窗口',
      '帮助'
    ])
    const appMenu = submenu(menu, 'VVTools')
    const settings = appMenu.find((item) => item.label === '设置…')!
    expect(settings.accelerator).toBe('CmdOrCtrl+,')
    click(settings)
    expect(actions.navigate).toHaveBeenCalledExactlyOnceWith('/settings')
    expect(appMenu.filter((item) => item.role).map((item) => item.role)).toEqual([
      'about',
      'services',
      'hide',
      'hideOthers',
      'unhide'
    ])
    const quit = appMenu.find((item) => item.label === '退出 VVTools')!
    expect(quit.role).toBeUndefined()
    expect(quit.accelerator).toBe('CmdOrCtrl+Q')
    click(quit)
    expect(actions.quit).toHaveBeenCalledOnce()
    expect(
      submenu(menu, '编辑')
        .filter((item) => item.role)
        .map((item) => item.role)
    ).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])
  })

  it('opens files and follows saved quick-action names, enabled state, and order', () => {
    const { actions } = fixture()
    actions.quickActions.reverse()
    actions.quickActions[0].name = '网站导出'
    const menu = applicationMenuTemplate(actions)
    const file = submenu(menu, '文件')
    const open = file.find((item) => item.label === '添加文件…')!
    expect(open.accelerator).toBe('CmdOrCtrl+O')
    click(open)
    expect(actions.openFiles).toHaveBeenCalledExactlyOnceWith('open')
    const quick = submenu(file, '快捷处理')
    expect(quick.filter((item) => item.type !== 'separator').map((item) => item.label)).toEqual([
      '网站导出…',
      '压缩为分享图…',
      '管理快捷动作…'
    ])
    click(quick[0])
    expect(actions.openFiles).toHaveBeenLastCalledWith('image-web')
    click(quick.at(-1))
    expect(actions.navigate).toHaveBeenCalledExactlyOnceWith('/settings', 'desktop-integration')
    expect(file.find((item) => item.label === '查看快捷处理结果')?.enabled).toBe(false)
    actions.quickActions.forEach((action) => {
      action.enabled = false
    })
    const disabled = submenu(submenu(applicationMenuTemplate(actions), '文件'), '快捷处理')
    expect(disabled.map((item) => item.label)).toEqual(['管理快捷动作…'])
  })

  it('switches all seven workspaces with unique shortcuts and keeps developer commands out of release menus', () => {
    const { menu, actions } = fixture()
    const view = submenu(menu, '视图')
    expect(view.slice(0, 7).map((item) => [item.label, item.accelerator])).toEqual([
      ['图片处理', 'CmdOrCtrl+1'],
      ['视频处理', 'CmdOrCtrl+2'],
      ['视频雪碧图', 'CmdOrCtrl+3'],
      ['音频处理', 'CmdOrCtrl+4'],
      ['PDF 处理', 'CmdOrCtrl+5'],
      ['字体处理', 'CmdOrCtrl+6'],
      ['批量重命名', 'CmdOrCtrl+7']
    ])
    for (const item of view.slice(0, 7)) click(item)
    expect(actions.navigate.mock.calls).toEqual([
      ['/image'],
      ['/video'],
      ['/sprite'],
      ['/audio'],
      ['/pdf'],
      ['/font'],
      ['/rename']
    ])
    expect(view.some((item) => item.role === 'reload' || item.role === 'toggleDevTools')).toBe(
      false
    )
    expect(
      submenu(fixture(true, true).menu, '视图')
        .filter((item) => item.role)
        .map((item) => item.role)
    ).toContain('toggleDevTools')
  })

  it('places Windows settings and quit under File and enables the latest result when available', () => {
    const { menu, actions } = fixture(false, false, true)
    expect(menu.map((item) => item.label)).toEqual(['文件', '编辑', '视图', '窗口', '帮助'])
    const file = submenu(menu, '文件')
    click(file.find((item) => item.label === '设置…'))
    expect(actions.navigate).toHaveBeenCalledExactlyOnceWith('/settings')
    const result = file.find((item) => item.label === '查看快捷处理结果')!
    expect(result.enabled).toBe(true)
    click(result)
    expect(actions.showResult).toHaveBeenCalledOnce()
    click(file.find((item) => item.label === '退出 VVTools'))
    expect(actions.quit).toHaveBeenCalledOnce()
    click(submenu(menu, '窗口').find((item) => item.label === '显示主窗口'))
    expect(actions.showWindow).toHaveBeenCalledOnce()
    expect(submenu(menu, '帮助').find((item) => item.role === 'about')?.label).toBe('关于 VVTools')
  })
})
