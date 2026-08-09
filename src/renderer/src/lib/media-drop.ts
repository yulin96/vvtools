import {
  AUDIO_EXTENSIONS,
  FONT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  PDF_EXTENSIONS,
  VIDEO_EXTENSIONS
} from '../../../shared/constants'

export type MediaWorkspacePath = '/image' | '/video' | '/audio' | '/pdf' | '/font' | '/rename'

type ProcessingWorkspacePath = Exclude<MediaWorkspacePath, '/rename'>

const workspaceExtensions: Array<[ProcessingWorkspacePath, ReadonlySet<string>]> = [
  ['/image', IMAGE_EXTENSIONS],
  ['/video', VIDEO_EXTENSIONS],
  ['/audio', AUDIO_EXTENSIONS],
  ['/pdf', PDF_EXTENSIONS],
  ['/font', FONT_EXTENSIONS]
]

const routedDropPaths = new Map<MediaWorkspacePath, string[]>()

function fileExtension(path: string): string {
  return path.match(/\.[^./\\]+$/u)?.[0].toLowerCase() ?? ''
}

export function detectMediaWorkspacePath(paths: string[]): MediaWorkspacePath | null {
  const matches = new Set<MediaWorkspacePath>()
  for (const path of paths) {
    const extension = fileExtension(path)
    const match = workspaceExtensions.find(([, extensions]) => extensions.has(extension))
    if (match) matches.add(match[0])
  }
  return matches.size === 1 ? [...matches][0] : null
}

export function workspaceAcceptsDrop(path: MediaWorkspacePath, paths: string[]): boolean {
  if (paths.length === 0) return false
  if (path === '/rename') return true
  const acceptedExtensions =
    path === '/audio'
      ? new Set([...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS])
      : workspaceExtensions.find(([workspacePath]) => workspacePath === path)?.[1]
  return Boolean(
    acceptedExtensions && paths.some((filePath) => acceptedExtensions.has(fileExtension(filePath)))
  )
}

export function queueRoutedDrop(path: MediaWorkspacePath, paths: string[]): void {
  routedDropPaths.set(path, [...(routedDropPaths.get(path) ?? []), ...paths])
}

export function takeRoutedDrop(path: MediaWorkspacePath): string[] {
  const paths = routedDropPaths.get(path) ?? []
  routedDropPaths.delete(path)
  return paths
}
