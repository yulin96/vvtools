import { net, protocol } from 'electron'
import { existsSync } from 'fs'
import { extname } from 'path'
import { pathToFileURL } from 'url'
import { randomUUID } from 'crypto'
import { FONT_EXTENSIONS } from '../../shared/constants'

const SCHEME = 'vvtools-font'
const previewFiles = new Map<string, string>()

export function registerFontPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    }
  ])
}

export function registerFontPreviewProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    const token = url.pathname.slice(1)
    const path = url.hostname === 'preview' ? previewFiles.get(token) : undefined
    if (!path || !existsSync(path) || !FONT_EXTENSIONS.has(extname(path).toLowerCase())) {
      return new Response('字体预览已失效', { status: 404 })
    }
    const response = await net.fetch(pathToFileURL(path).href)
    const headers = new Headers(response.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Cache-Control', 'no-store')
    return new Response(response.body, { status: response.status, headers })
  })
}

export function createFontPreviewUrl(path: string): string {
  previewFiles.clear()
  const token = randomUUID()
  previewFiles.set(token, path)
  return `${SCHEME}://preview/${token}`
}

export function clearFontPreview(): void {
  previewFiles.clear()
}
