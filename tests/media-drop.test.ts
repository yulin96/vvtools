import { describe, expect, it } from 'vitest'
import { detectMediaWorkspacePath, workspaceAcceptsDrop } from '../src/renderer/src/lib/media-drop'

describe('media drop routing', () => {
  it('keeps video files on the audio workspace for audio extraction', () => {
    expect(detectMediaWorkspacePath(['/tmp/clip.mp4'])).toBe('/video')
    expect(workspaceAcceptsDrop('/audio', ['/tmp/clip.mp4'])).toBe(true)
  })

  it('does not claim unsupported files for the current workspace', () => {
    expect(workspaceAcceptsDrop('/audio', ['/tmp/document.pdf'])).toBe(false)
  })

  it('keeps every file type on the rename workspace', () => {
    expect(workspaceAcceptsDrop('/rename', ['/tmp/archive.unknown'])).toBe(true)
  })
})
