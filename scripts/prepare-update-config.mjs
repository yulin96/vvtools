import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const baseUrl = process.env.VVTOOLS_UPDATE_BASE_URL?.replace(/\/+$/u, '')
if (!baseUrl || !baseUrl.startsWith('https://')) {
  throw new Error('VVTOOLS_UPDATE_BASE_URL 必须是 HTTPS 地址')
}

const directory = resolve(process.cwd(), '.release')
await mkdir(directory, { recursive: true })
await writeFile(
  resolve(directory, 'update-config.json'),
  `${JSON.stringify({ baseUrl }, null, 2)}\n`,
  'utf8'
)
