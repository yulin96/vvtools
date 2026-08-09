import { randomUUID } from 'crypto'
import { existsSync, lstatSync, renameSync } from 'fs'
import { basename, dirname, extname, isAbsolute, join, parse } from 'path'
import type {
  InspectRenameFilesResult,
  RenameFileInfo,
  RenameFileRequest,
  RenameFileResult,
  RenamePlanInspection
} from '../../shared/types'

const MAX_RENAME_FILES = 500
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu
const PORTABLE_INVALID_CHARACTERS = /[<>:"/\\|?*]/u

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => character.codePointAt(0)! <= 31)
}

function pathKey(path: string, platform: NodeJS.Platform): string {
  const normalized = path.normalize('NFC')
  return platform === 'linux' ? normalized : normalized.toLocaleLowerCase('en-US')
}

function fileInfo(path: string): RenameFileInfo {
  const stats = lstatSync(path)
  if (!stats.isFile()) throw new Error('仅支持普通文件')
  const parts = parse(path)
  return {
    path,
    name: parts.base,
    stem: parts.name,
    extension: parts.ext,
    size: stats.size,
    createdAt: (stats.birthtimeMs > 0 ? stats.birthtime : stats.ctime).toISOString(),
    modifiedAt: stats.mtime.toISOString()
  }
}

export function inspectRenameFiles(paths: string[]): InspectRenameFilesResult {
  const uniquePaths = [...new Set(paths)]
  if (uniquePaths.length > MAX_RENAME_FILES)
    throw new Error(`单次最多添加 ${MAX_RENAME_FILES} 个文件`)
  const result: InspectRenameFilesResult = { files: [], rejected: [] }
  for (const path of uniquePaths) {
    try {
      if (!isAbsolute(path)) throw new Error('文件路径必须是绝对路径')
      result.files.push(fileInfo(path))
    } catch (error) {
      result.rejected.push({
        path,
        reason: error instanceof Error ? error.message : String(error)
      })
    }
  }
  return result
}

function validateTargetName(sourcePath: string, targetName: string): void {
  if (
    !targetName ||
    targetName !== basename(targetName) ||
    targetName === '.' ||
    targetName === '..'
  ) {
    throw new Error(`新名称无效：${targetName || '空名称'}`)
  }
  if (
    PORTABLE_INVALID_CHARACTERS.test(targetName) ||
    containsControlCharacter(targetName) ||
    targetName.endsWith('.') ||
    targetName.endsWith(' ') ||
    WINDOWS_RESERVED_NAME.test(targetName)
  ) {
    throw new Error(`新名称包含系统不支持的字符或保留名称：${targetName}`)
  }
  if (Buffer.byteLength(targetName, 'utf8') > 255) throw new Error(`新名称过长：${targetName}`)
  if (extname(targetName) !== extname(sourcePath))
    throw new Error(`不允许修改文件扩展名：${targetName}`)
}

export function inspectRenamePlan(
  items: RenameFileRequest[],
  options: { blockedPaths?: ReadonlySet<string>; platform?: NodeJS.Platform } = {}
): RenamePlanInspection[] {
  const platform = options.platform ?? process.platform
  const blocked = new Set([...(options.blockedPaths ?? [])].map((path) => pathKey(path, platform)))
  const inspections = items.map((item): RenamePlanInspection => {
    const targetPath = isAbsolute(item.sourcePath)
      ? join(dirname(item.sourcePath), item.targetName)
      : ''
    try {
      if (!isAbsolute(item.sourcePath)) throw new Error('文件路径必须是绝对路径')
      fileInfo(item.sourcePath)
      validateTargetName(item.sourcePath, item.targetName)
      if (blocked.has(pathKey(item.sourcePath, platform))) {
        throw new Error('文件正在被处理，暂时不能重命名')
      }
      if (blocked.has(pathKey(targetPath, platform))) {
        throw new Error('目标名称正在被处理，暂时不能使用')
      }
      return {
        sourcePath: item.sourcePath,
        targetPath,
        valid: true,
        changed: item.sourcePath !== targetPath
      }
    } catch (error) {
      return {
        sourcePath: item.sourcePath,
        targetPath,
        valid: false,
        changed: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })
  const sourceCounts = new Map<string, number>()
  const targetCounts = new Map<string, number>()
  for (const inspection of inspections) {
    if (!inspection.valid) continue
    const sourceKey = pathKey(inspection.sourcePath, platform)
    const targetKey = pathKey(inspection.targetPath, platform)
    sourceCounts.set(sourceKey, (sourceCounts.get(sourceKey) ?? 0) + 1)
    targetCounts.set(targetKey, (targetCounts.get(targetKey) ?? 0) + 1)
  }
  const sourceKeys = new Set(sourceCounts.keys())
  for (const inspection of inspections) {
    if (!inspection.valid) continue
    const sourceKey = pathKey(inspection.sourcePath, platform)
    const targetKey = pathKey(inspection.targetPath, platform)
    if ((sourceCounts.get(sourceKey) ?? 0) > 1) {
      inspection.valid = false
      inspection.error = '文件重复'
    } else if ((targetCounts.get(targetKey) ?? 0) > 1) {
      inspection.valid = false
      inspection.error = '新名称与批次中的其他文件重复'
    } else if (
      inspection.changed &&
      existsSync(inspection.targetPath) &&
      !sourceKeys.has(targetKey)
    ) {
      inspection.valid = false
      inspection.error = '目标文件已存在'
    }
  }
  return inspections
}

function rollback(
  staged: Array<{ sourcePath: string; temporaryPath: string }>,
  committed: Array<{ sourcePath: string; targetPath: string; temporaryPath: string }>
): string[] {
  const failures: string[] = []
  for (const item of [...committed].reverse()) {
    try {
      if (existsSync(item.targetPath)) renameSync(item.targetPath, item.temporaryPath)
    } catch (error) {
      failures.push(`${item.targetPath}：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  for (const item of [...staged].reverse()) {
    try {
      if (existsSync(item.temporaryPath)) {
        if (existsSync(item.sourcePath)) throw new Error('原路径已被占用')
        renameSync(item.temporaryPath, item.sourcePath)
      }
    } catch (error) {
      failures.push(
        `${item.temporaryPath}：${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  return failures
}

export function renameFiles(
  items: RenameFileRequest[],
  options: { blockedPaths?: ReadonlySet<string>; platform?: NodeJS.Platform } = {}
): RenameFileResult[] {
  if (items.length === 0) return []
  if (items.length > MAX_RENAME_FILES) throw new Error(`单次最多重命名 ${MAX_RENAME_FILES} 个文件`)
  const platform = options.platform ?? process.platform
  const blocked = new Set([...(options.blockedPaths ?? [])].map((path) => pathKey(path, platform)))
  const sourceKeys = new Set<string>()
  const targetKeys = new Set<string>()
  const operations = items.map((item) => {
    if (!isAbsolute(item.sourcePath)) throw new Error('文件路径必须是绝对路径')
    fileInfo(item.sourcePath)
    validateTargetName(item.sourcePath, item.targetName)
    const sourceKey = pathKey(item.sourcePath, platform)
    if (sourceKeys.has(sourceKey)) throw new Error(`文件重复：${item.sourcePath}`)
    if (blocked.has(sourceKey))
      throw new Error(`文件正在被处理，暂时不能重命名：${item.sourcePath}`)
    sourceKeys.add(sourceKey)
    const targetPath = join(dirname(item.sourcePath), item.targetName)
    const targetKey = pathKey(targetPath, platform)
    if (blocked.has(targetKey)) throw new Error(`目标名称正在被处理，暂时不能使用：${targetPath}`)
    if (targetKeys.has(targetKey)) throw new Error(`多个文件的新名称重复：${item.targetName}`)
    targetKeys.add(targetKey)
    return { ...item, targetPath, sourceKey, targetKey }
  })

  for (const operation of operations) {
    if (operation.sourcePath === operation.targetPath) continue
    if (existsSync(operation.targetPath) && !sourceKeys.has(operation.targetKey)) {
      throw new Error(`目标文件已存在：${operation.targetPath}`)
    }
  }

  const changed = operations.filter((item) => item.sourcePath !== item.targetPath)
  const staged: Array<{ sourcePath: string; temporaryPath: string }> = []
  const committed: Array<{ sourcePath: string; targetPath: string; temporaryPath: string }> = []
  try {
    for (const operation of changed) {
      let temporaryPath: string
      do {
        temporaryPath = join(dirname(operation.sourcePath), `.vvtools-rename-${randomUUID()}`)
      } while (existsSync(temporaryPath))
      renameSync(operation.sourcePath, temporaryPath)
      staged.push({ sourcePath: operation.sourcePath, temporaryPath })
    }
    for (const [index, operation] of changed.entries()) {
      if (existsSync(operation.targetPath))
        throw new Error(`目标文件已存在：${operation.targetPath}`)
      renameSync(staged[index].temporaryPath, operation.targetPath)
      committed.push({
        sourcePath: operation.sourcePath,
        targetPath: operation.targetPath,
        temporaryPath: staged[index].temporaryPath
      })
    }
  } catch (error) {
    const rollbackFailures = rollback(staged, committed)
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      rollbackFailures.length > 0
        ? `${message}；部分文件回滚失败：${rollbackFailures.join('；')}`
        : `${message}；已恢复原文件名`
    )
  }

  return operations.map((item) => ({
    sourcePath: item.sourcePath,
    targetPath: item.targetPath,
    targetName: item.targetName,
    renamed: item.sourcePath !== item.targetPath
  }))
}
