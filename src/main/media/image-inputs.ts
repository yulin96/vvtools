import { opendir, stat } from 'fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative } from 'path'
import type { ImageInputFile } from '../../shared/types'
import { IMAGE_EXTENSIONS } from '../../shared/constants'

const MAX_IMAGE_INPUTS = 500

export async function collectImageInputs(inputPaths: string[]): Promise<ImageInputFile[]> {
  if (!Array.isArray(inputPaths) || inputPaths.length === 0) return []
  const inputs: ImageInputFile[] = []
  const seen = new Set<string>()
  let scannedEntries = 0

  const addFile = (path: string, relativeDirectory: string): void => {
    if (!IMAGE_EXTENSIONS.has(extname(path).toLowerCase()) || seen.has(path)) return
    if (inputs.length >= MAX_IMAGE_INPUTS) throw new Error('单次最多添加 500 张图片')
    seen.add(path)
    inputs.push({ path, relativeDirectory })
  }

  const walk = async (directory: string, rootParent: string): Promise<void> => {
    const entries = await opendir(directory)
    for await (const entry of entries) {
      scannedEntries += 1
      if (scannedEntries % 128 === 0) await new Promise<void>((resolve) => setImmediate(resolve))
      if (entry.isSymbolicLink()) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path, rootParent)
      else if (entry.isFile()) addFile(path, dirname(relative(rootParent, path)))
    }
  }

  for (const path of inputPaths) {
    if (typeof path !== 'string' || !isAbsolute(path)) {
      throw new Error(`文件或目录不存在：${path}`)
    }
    let stats: Awaited<ReturnType<typeof stat>>
    try {
      stats = await stat(path)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') throw new Error(`文件或目录不存在：${path}`)
      throw error
    }
    if (stats.isDirectory()) await walk(path, dirname(path))
    else if (stats.isFile()) addFile(path, '')
  }

  return inputs.sort((left, right) =>
    `${left.relativeDirectory}/${basename(left.path)}`.localeCompare(
      `${right.relativeDirectory}/${basename(right.path)}`
    )
  )
}
