import { existsSync, readdirSync, statSync } from 'fs'
import { basename, dirname, extname, isAbsolute, join, relative } from 'path'
import type { ImageInputFile } from '../../shared/types'
import { IMAGE_EXTENSIONS } from '../../shared/constants'

const MAX_IMAGE_INPUTS = 500

export function collectImageInputs(inputPaths: string[]): ImageInputFile[] {
  if (!Array.isArray(inputPaths) || inputPaths.length === 0) return []
  const inputs: ImageInputFile[] = []
  const seen = new Set<string>()

  const addFile = (path: string, relativeDirectory: string): void => {
    if (!IMAGE_EXTENSIONS.has(extname(path).toLowerCase()) || seen.has(path)) return
    if (inputs.length >= MAX_IMAGE_INPUTS) throw new Error('单次最多添加 500 张图片')
    seen.add(path)
    inputs.push({ path, relativeDirectory })
  }

  const walk = (directory: string, rootParent: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path, rootParent)
      else if (entry.isFile()) addFile(path, dirname(relative(rootParent, path)))
    }
  }

  for (const path of inputPaths) {
    if (typeof path !== 'string' || !isAbsolute(path) || !existsSync(path)) {
      throw new Error(`文件或目录不存在：${path}`)
    }
    const stats = statSync(path)
    if (stats.isDirectory()) walk(path, dirname(path))
    else if (stats.isFile()) addFile(path, '')
  }

  return inputs.sort((left, right) =>
    `${left.relativeDirectory}/${basename(left.path)}`.localeCompare(
      `${right.relativeDirectory}/${basename(right.path)}`
    )
  )
}
