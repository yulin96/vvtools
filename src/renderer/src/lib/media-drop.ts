import {
  AUDIO_EXTENSIONS,
  FONT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  PDF_EXTENSIONS,
  VIDEO_EXTENSIONS
} from '../../../shared/constants'

export type MediaWorkspacePath = '/image' | '/video' | '/audio' | '/pdf' | '/font'

const workspaceExtensions: Array<[MediaWorkspacePath, ReadonlySet<string>]> = [
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

export function queueRoutedDrop(path: MediaWorkspacePath, paths: string[]): void {
  routedDropPaths.set(path, [...(routedDropPaths.get(path) ?? []), ...paths])
}

export function takeRoutedDrop(path: MediaWorkspacePath): string[] {
  const paths = routedDropPaths.get(path) ?? []
  routedDropPaths.delete(path)
  return paths
}
