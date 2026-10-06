import { release } from 'os'
import { describe, expect, it, vi } from 'vitest'
import { getQpdfPath, inspectQpdfRuntime } from './ffmpeg-runtime'
import { MediaProcessError } from './errors'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('os', () => ({ release: vi.fn(() => '23.6.0') }))

describe('qpdf platform requirements', () => {
  it('reports the macOS 15 requirement before launching qpdf on an older macOS', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    try {
      expect(getQpdfPath).toThrow(MediaProcessError)
      await expect(inspectQpdfRuntime()).resolves.toEqual({
        available: false,
        error: 'PDF 无损压缩需要 macOS 15 或更高版本'
      })
      vi.mocked(release).mockReturnValue('24.0.0')
      expect(getQpdfPath()).toContain('qpdf')
    } finally {
      Object.defineProperty(process, 'platform', platform)
      vi.mocked(release).mockReturnValue('23.6.0')
    }
  })
})
