import { randomUUID } from 'crypto'
import { existsSync, renameSync, rmSync } from 'fs'
import { join, parse } from 'path'

export function createStagingOutputPath(outputPath: string, taskId: string): string {
  const parsed = parse(outputPath)
  return join(parsed.dir, `.${parsed.name}.vvtools-${taskId}.tmp${parsed.ext}`)
}

export function commitStagedOutput(
  stagingPath: string,
  outputPath: string,
  overwrite: boolean
): void {
  if (!existsSync(stagingPath)) throw new Error('处理器未生成临时输出文件')
  if (!existsSync(outputPath)) {
    renameSync(stagingPath, outputPath)
    return
  }
  if (!overwrite) throw new Error('输出文件在处理期间已存在，未执行覆盖')

  try {
    renameSync(stagingPath, outputPath)
    return
  } catch (error) {
    if (process.platform !== 'win32') throw error
  }

  const parsed = parse(outputPath)
  const backupPath = join(parsed.dir, `.${parsed.name}.vvtools-backup-${randomUUID()}${parsed.ext}`)
  renameSync(outputPath, backupPath)
  try {
    renameSync(stagingPath, outputPath)
  } catch (error) {
    try {
      renameSync(backupPath, outputPath)
    } catch (rollbackError) {
      throw new Error(
        `替换输出失败，原文件保留在 ${backupPath}；回滚失败：${String(rollbackError)}`,
        { cause: error }
      )
    }
    throw error
  }

  try {
    rmSync(backupPath, { force: true })
  } catch (error) {
    console.warn(`输出已替换，但无法清理备份文件 ${backupPath}`, error)
  }
}
