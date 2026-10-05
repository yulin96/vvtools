import { randomUUID } from 'crypto'
import { constants } from 'fs'
import { lstat, open, unlink } from 'fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'path'
import type { DesktopActionRequest } from '../../shared/types'

const ACTIONS = new Set(['image-share', 'image-web', 'open'])
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu
export function isDesktopLaunch(argv: string[]): boolean {
  return (
    argv.includes('--vvtools-request') || argv.some((arg) => arg.startsWith('--vvtools-action='))
  )
}
export function validateDesktopRequest(value: unknown): DesktopActionRequest {
  const request = value as Partial<DesktopActionRequest> | null
  if (
    !request ||
    request.version !== 1 ||
    typeof request.id !== 'string' ||
    !UUID.test(request.id) ||
    !ACTIONS.has(String(request.actionId)) ||
    !Array.isArray(request.paths) ||
    request.paths.length < 1 ||
    request.paths.length > 500 ||
    request.paths.some(
      (path) =>
        typeof path !== 'string' || !isAbsolute(path) || path.length > 8192 || path.includes('\0')
    )
  ) {
    throw new Error('快捷处理请求无效：请选择 1–500 个本地文件')
  }
  return {
    version: 1,
    id: request.id,
    actionId: request.actionId!,
    paths: [...new Set(request.paths)]
  }
}
export async function readDesktopLaunch(
  argv: string[],
  requestDirectory: string
): Promise<DesktopActionRequest | null> {
  const index = argv.indexOf('--vvtools-request')
  if (index >= 0) {
    const path = argv[index + 1]
    if (
      !path ||
      !isAbsolute(path) ||
      resolve(dirname(path)) !== resolve(requestDirectory) ||
      !UUID.test(basename(path, '.json')) ||
      !path.endsWith('.json')
    )
      throw new Error('快捷处理请求文件位置无效')
    if (!(await lstat(path)).isFile()) throw new Error('快捷处理请求文件无效')
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const stats = await file.stat()
      if (!stats.isFile() || stats.size > 1024 * 1024) throw new Error('快捷处理请求文件过大或无效')
      return validateDesktopRequest(JSON.parse(await file.readFile('utf8')))
    } finally {
      await file.close()
      await unlink(join(requestDirectory, basename(path)))
    }
  }
  const action = argv.find((arg) => arg.startsWith('--vvtools-action='))
  if (!action) return null
  const separator = argv.indexOf('--')
  if (separator < 0) throw new Error('快捷处理缺少文件列表')
  return validateDesktopRequest({
    version: 1,
    id: randomUUID(),
    actionId: action.slice('--vvtools-action='.length),
    paths: argv.slice(separator + 1)
  })
}
