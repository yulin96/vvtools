import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

if (process.platform === 'win32') {
  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      fileURLToPath(new URL('./stage-desktop-shell.ps1', import.meta.url))
    ],
    { stdio: 'inherit' }
  )
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
