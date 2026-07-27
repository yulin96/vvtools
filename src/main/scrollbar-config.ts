interface ChromiumCommandLine {
  appendSwitch(switchName: string, value?: string): void
}

export function configureOverlayScrollbars(
  commandLine: ChromiumCommandLine,
  platform: NodeJS.Platform
): void {
  const features =
    platform === 'darwin' ? 'OverlayScrollbar' : 'OverlayScrollbar,FluentOverlayScrollbar'
  commandLine.appendSwitch('enable-features', features)
}
