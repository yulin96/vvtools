import type { RenameFileInfo, RenameSettings, RenameSortField } from '../../../shared/types'

export interface RenamePreviewRow {
  file: RenameFileInfo
  position: number
  targetName: string
  changed: boolean
  error?: string
}

const INVALID_FILENAME_CHARACTERS = /[<>:"/\\|?*]/u
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function sortValue(file: RenameFileInfo, field: RenameSortField): string | number {
  if (field === 'size') return file.size
  if (field === 'createdAt') return Date.parse(file.createdAt)
  if (field === 'modifiedAt') return Date.parse(file.modifiedAt)
  if (field === 'extension') return file.extension
  return file.name
}

export function sortRenameFiles(
  files: RenameFileInfo[],
  settings: Pick<RenameSettings, 'sortField' | 'sortDirection'>
): RenameFileInfo[] {
  const direction = settings.sortDirection === 'asc' ? 1 : -1
  return files
    .map((file, index) => ({ file, index }))
    .sort((left, right) => {
      const leftValue = sortValue(left.file, settings.sortField)
      const rightValue = sortValue(right.file, settings.sortField)
      const comparison =
        typeof leftValue === 'number' && typeof rightValue === 'number'
          ? leftValue - rightValue
          : collator.compare(String(leftValue), String(rightValue))
      return comparison === 0 ? left.index - right.index : comparison * direction
    })
    .map(({ file }) => file)
}

function applyCase(value: string, mode: RenameSettings['caseMode']): string {
  if (mode === 'lower') return value.toLocaleLowerCase()
  if (mode === 'upper') return value.toLocaleUpperCase()
  if (mode === 'title') {
    return value.replace(/[\p{L}\p{N}]+/gu, (word) => {
      const [first = '', ...rest] = [...word]
      return `${first.toLocaleUpperCase()}${rest.join('').toLocaleLowerCase()}`
    })
  }
  return value
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatDate(value: string, format: RenameSettings['dateFormat']): string {
  const date = new Date(value)
  const datePart =
    format === 'YYYY-MM-DD'
      ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      : `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  return format === 'YYYYMMDD-HHmmss'
    ? `${datePart}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
    : datePart
}

function targetStem(file: RenameFileInfo, settings: RenameSettings, position: number): string {
  if (settings.mode === 'sequence') return String(position)

  let base = settings.baseMode === 'custom' ? settings.customName : file.stem
  if (settings.findText) base = base.split(settings.findText).join(settings.replaceText)
  base = applyCase(base, settings.caseMode)
  let result = `${settings.prefix}${base}${settings.suffix}`
  const prefixParts: string[] = []
  const suffixParts: string[] = []
  if (settings.dateSource !== 'none') {
    const date = formatDate(file[settings.dateSource], settings.dateFormat)
    ;(settings.datePosition === 'prefix' ? prefixParts : suffixParts).push(date)
  }
  if (settings.sequenceEnabled) {
    const sequence = settings.sequenceStart + (position - 1) * settings.sequenceStep
    const number = String(sequence).padStart(settings.sequencePadding, '0')
    ;(settings.sequencePosition === 'prefix' ? prefixParts : suffixParts).push(number)
  }
  if (prefixParts.length > 0)
    result = `${prefixParts.join(settings.separator)}${settings.separator}${result}`
  if (suffixParts.length > 0)
    result = `${result}${settings.separator}${suffixParts.join(settings.separator)}`
  return result
}

function filenameError(name: string): string | undefined {
  if (!name) return '新名称不能为空'
  if (
    INVALID_FILENAME_CHARACTERS.test(name) ||
    [...name].some((character) => character.codePointAt(0)! <= 31) ||
    name.endsWith('.') ||
    name.endsWith(' ') ||
    WINDOWS_RESERVED_NAME.test(name)
  ) {
    return '包含系统不支持的字符或保留名称'
  }
  if (new TextEncoder().encode(name).length > 255) return '名称超过 255 字节'
  return undefined
}

function directory(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index < 0 ? '' : path.slice(0, index)
}

export function buildRenamePreview(
  files: RenameFileInfo[],
  settings: RenameSettings,
  platform: 'darwin' | 'win32' | 'linux'
): RenamePreviewRow[] {
  const rows = sortRenameFiles(files, settings).map((file, index): RenamePreviewRow => {
    const targetName = `${targetStem(file, settings, index + 1)}${file.extension}`
    return {
      file,
      position: index + 1,
      targetName,
      changed: targetName !== file.name,
      error: filenameError(targetName)
    }
  })
  const names = new Map<string, number>()
  for (const row of rows) {
    const path = `${directory(row.file.path)}/${row.targetName}`.normalize('NFC')
    const key = platform === 'linux' ? path : path.toLocaleLowerCase('en-US')
    names.set(key, (names.get(key) ?? 0) + 1)
  }
  for (const row of rows) {
    const path = `${directory(row.file.path)}/${row.targetName}`.normalize('NFC')
    const key = platform === 'linux' ? path : path.toLocaleLowerCase('en-US')
    if ((names.get(key) ?? 0) > 1) row.error = '新名称与批次中的其他文件重复'
  }
  return rows
}
