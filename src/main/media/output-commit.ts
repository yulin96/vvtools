import { isReplaceableOutputDirectory } from './output-directory'
import { lstatSync, renameSync } from 'fs'
import { join, parse } from 'path'

export function createStagingOutputPath(
  outputPath: string,
  taskId: string,
  directory = false
): string {
  const parsed = parse(outputPath)
  return join(parsed.dir, `.vvtools-${taskId}.tmp${directory ? '' : parsed.ext}`)
}

export async function commitStagedOutput(
  stagingPath: string,
  outputPath: string,
  overwrite: boolean,
  moveToTrash: (path: string) => Promise<void>
): Promise<void> {
  const staged = lstatSync(stagingPath, { throwIfNoEntry: false })
  if (!staged) throw new Error('处理器未生成临时输出文件')
  const existing = lstatSync(outputPath, { throwIfNoEntry: false })
  if (!existing) {
    renameSync(stagingPath, outputPath)
    return
  }
  if (!overwrite) throw new Error('输出文件在处理期间已存在，未执行覆盖')

  if (existing.isDirectory() !== staged.isDirectory())
    throw new Error('目标文件与目录类型不同，已保留现有内容')

  if (existing.isDirectory() && !isReplaceableOutputDirectory(outputPath))
    throw new Error('无法确认是 VVTools 输出目录，已保留现有内容')

  try {
    await moveToTrash(outputPath)
  } catch (error) {
    throw new Error(`无法将已有输出移入回收站：${outputPath}`, { cause: error })
  }

  try {
    renameSync(stagingPath, outputPath)
  } catch (error) {
    throw new Error(`已有输出已移入回收站，但新文件写入失败：${outputPath}`, {
      cause: error
    })
  }
}
