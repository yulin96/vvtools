import { app, nativeTheme, type BrowserWindow } from 'electron'
import type { ThemeMode } from '../shared/types'
import icon from '../../resources/icon.png?asset'
import darkIcon from '../../resources/icon-dark.png?asset'
import macIcon from '../../resources/icon-mac.png?asset'
import darkMacIcon from '../../resources/icon-mac-dark.png?asset'
import windowsIcon from '../../build/icon.ico?asset'
import darkWindowsIcon from '../../build/icon-dark.ico?asset'

const appearances = {
  light: { icon, macIcon, windowsIcon },
  dark: { icon: darkIcon, macIcon: darkMacIcon, windowsIcon: darkWindowsIcon }
}

export class ApplicationIcons {
  private mode: ThemeMode = 'system'
  private appliedIcon: string | undefined

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  private appearance(): (typeof appearances)['light'] {
    const dark = this.mode === 'system' ? nativeTheme.shouldUseDarkColors : this.mode === 'dark'
    return appearances[dark ? 'dark' : 'light']
  }

  windowIcon(): string {
    const appearance = this.appearance()
    return process.platform === 'win32' ? appearance.windowsIcon : appearance.icon
  }

  private readonly update = (): void => {
    const appearance = this.appearance()
    if (appearance.icon === this.appliedIcon) return
    app.setAboutPanelOptions({ applicationName: 'VVTools', iconPath: appearance.icon })
    if (process.platform === 'darwin') app.dock?.setIcon(appearance.macIcon)
    else {
      const window = this.getWindow()
      if (window && !window.isDestroyed()) window.setIcon(this.windowIcon())
    }
    this.appliedIcon = appearance.icon
  }

  start(): void {
    this.update()
    nativeTheme.on('updated', this.update)
  }

  setTheme(mode: ThemeMode): void {
    this.mode = mode
    this.update()
  }

  dispose(): void {
    nativeTheme.off('updated', this.update)
  }
}
