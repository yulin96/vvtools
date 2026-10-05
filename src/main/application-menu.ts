import type { MenuItemConstructorOptions } from 'electron'
import type { DesktopActionId, DesktopNavigation, DesktopQuickAction } from '../shared/types'

interface ApplicationMenuActions {
  isMac: boolean
  development: boolean
  quickActions: DesktopQuickAction[]
  hasResult: boolean
  openFiles: (actionId: DesktopActionId | 'open') => void
  navigate: (path: DesktopNavigation['path'], section?: DesktopNavigation['section']) => void
  showWindow: () => void
  showResult: () => void
  openHelp: () => void
  quit: () => void
}

export function applicationMenuTemplate(
  actions: ApplicationMenuActions
): MenuItemConstructorOptions[] {
  const settings: MenuItemConstructorOptions = {
    label: '设置…',
    accelerator: 'CmdOrCtrl+,',
    click: () => actions.navigate('/settings')
  }
  const quit: MenuItemConstructorOptions = {
    label: '退出 VVTools',
    accelerator: 'CmdOrCtrl+Q',
    click: actions.quit
  }
  const workspaces: Array<[DesktopNavigation['path'], string]> = [
    ['/image', '图片处理'],
    ['/video', '视频处理'],
    ['/sprite', '视频雪碧图'],
    ['/audio', '音频处理'],
    ['/pdf', 'PDF 处理'],
    ['/font', '字体处理'],
    ['/rename', '批量重命名']
  ]
  const quickActions = actions.quickActions
    .filter((action) => action.enabled)
    .map((action) => ({
      label: action.name + '…',
      click: () => actions.openFiles(action.id)
    }))
  return [
    ...(actions.isMac
      ? [
          {
            label: 'VVTools',
            submenu: [
              { role: 'about', label: '关于 VVTools' },
              { type: 'separator' },
              settings,
              { type: 'separator' },
              { role: 'services', label: '服务' },
              { type: 'separator' },
              { role: 'hide', label: '隐藏 VVTools' },
              { role: 'hideOthers', label: '隐藏其他应用' },
              { role: 'unhide', label: '显示所有应用' },
              { type: 'separator' },
              quit
            ]
          } satisfies MenuItemConstructorOptions
        ]
      : []),
    {
      label: '文件',
      submenu: [
        { label: '添加文件…', accelerator: 'CmdOrCtrl+O', click: () => actions.openFiles('open') },
        {
          label: '快捷处理',
          submenu: [
            ...quickActions,
            ...(quickActions.length ? [{ type: 'separator' as const }] : []),
            {
              label: '管理快捷动作…',
              click: () => actions.navigate('/settings', 'desktop-integration')
            }
          ]
        },
        { label: '查看快捷处理结果', enabled: actions.hasResult, click: actions.showResult },
        { type: 'separator' },
        ...(actions.isMac ? [] : [settings, { type: 'separator' as const }]),
        { role: 'close', label: '关闭窗口' },
        ...(actions.isMac ? [] : [{ type: 'separator' as const }, quit])
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        ...workspaces.map(([path, label], index) => ({
          label,
          accelerator: 'CmdOrCtrl+' + (index + 1),
          click: () => actions.navigate(path)
        })),
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
        ...(actions.development
          ? [
              { type: 'separator' as const },
              { role: 'reload' as const, label: '重新加载' },
              { role: 'toggleDevTools' as const, label: '开发者工具' }
            ]
          : [])
      ]
    },
    {
      role: 'windowMenu',
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        ...(actions.isMac ? [{ role: 'zoom' as const, label: '缩放窗口' }] : []),
        { label: '显示主窗口', click: actions.showWindow },
        ...(actions.isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const, label: '全部置于前端' }]
          : [])
      ]
    },
    {
      role: 'help',
      label: '帮助',
      submenu: [
        { label: '使用说明', click: actions.openHelp },
        ...(actions.isMac ? [] : [{ role: 'about' as const, label: '关于 VVTools' }])
      ]
    }
  ]
}
