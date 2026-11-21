export function pathKey(path: string, platform: string): string {
  return platform === 'darwin' || platform === 'win32' ? path.normalize('NFC').toLowerCase() : path
}
