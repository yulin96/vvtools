import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const OUTPUT_DIRECTORY_MARKER = '.vvtools-output'

function directorySignature(directory: string): string {
  const names = readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.name !== OUTPUT_DIRECTORY_MARKER && !(entry.isFile() && entry.name === '.DS_Store')
    )
    .map((entry) => (entry.isFile() ? entry.name : '/' + entry.name))
    .sort()
  return 'VVTools/1 ' + createHash('sha256').update(JSON.stringify(names)).digest('hex')
}

export function markOutputDirectory(directory: string): void {
  writeFileSync(join(directory, OUTPUT_DIRECTORY_MARKER), directorySignature(directory), {
    flag: 'wx'
  })
}

export function isReplaceableOutputDirectory(directory: string): boolean {
  if (!lstatSync(directory, { throwIfNoEntry: false })?.isDirectory()) return false
  const marker = join(directory, OUTPUT_DIRECTORY_MARKER)
  try {
    const info = lstatSync(marker, { throwIfNoEntry: false })
    if (!info?.isFile() || info.size !== 'VVTools/1 '.length + 64) return false
    return readFileSync(marker, 'utf8') === directorySignature(directory)
  } catch {
    // An unreadable directory cannot be identified as an earlier export.
    return false
  }
}
