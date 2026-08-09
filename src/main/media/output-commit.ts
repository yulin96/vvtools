import { existsSync, renameSync } from 'fs'
import { join, parse } from 'path'

export function createStagingOutputPath(outputPath: string, taskId: string): string {
  const parsed = parse(outputPath)
  return join(parsed.dir, `.${parsed.name}.vvtools-${taskId}.tmp${parsed.ext}`)
}

export async function commitStagedOutput(
  stagingPath: string,
  outputPath: string,
  overwrite: boolean,
  moveToTrash: (path: string) => Promise<void>
): Promise<void> {
  if (!existsSync(stagingPath)) throw new Error('处理器未生成临时输出文件')
  if (!existsSync(outputPath)) {
    renameSync(stagingPath, outputPath)
    return
  }
  if (!overwrite) throw new Error('输出文件在处理期间已存在，未执行覆盖')

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
