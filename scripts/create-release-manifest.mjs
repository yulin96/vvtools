import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const baseUrl = process.env.VVTOOLS_UPDATE_BASE_URL?.replace(/\/+$/u, '')
if (!baseUrl || !baseUrl.startsWith('https://')) {
  throw new Error('VVTOOLS_UPDATE_BASE_URL 必须是 HTTPS 地址')
}
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const releaseNotes = (await readFile(resolve(root, '.release/release-notes.md'), 'utf8')).trim()
const manifest = {
  version: packageJson.version,
  releaseNotes,
  downloads: {
    arm64: `${baseUrl}/mac-arm64/vvtools-${packageJson.version}-arm64.dmg`,
    x64: `${baseUrl}/mac-x64/vvtools-${packageJson.version}-x64.dmg`
  }
}

await writeFile(resolve(root, '.release/latest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
