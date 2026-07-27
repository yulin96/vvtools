import { describe, expect, it, vi } from 'vitest'
import { configureOverlayScrollbars } from '../src/main/scrollbar-config'

describe('overlay scrollbar startup configuration', () => {
  it('forces native overlay scrollbars in the VVTools Chromium process on macOS', () => {
    const appendSwitch = vi.fn()

    configureOverlayScrollbars({ appendSwitch }, 'darwin')

    expect(appendSwitch).toHaveBeenCalledOnce()
    expect(appendSwitch).toHaveBeenCalledWith('enable-features', 'OverlayScrollbar')
  })

  it.each(['win32', 'linux'] as const)(
    'keeps Fluent overlay scrollbars enabled on %s',
    (platform) => {
      const appendSwitch = vi.fn()

      configureOverlayScrollbars({ appendSwitch }, platform)

      expect(appendSwitch).toHaveBeenCalledOnce()
      expect(appendSwitch).toHaveBeenCalledWith(
        'enable-features',
        'OverlayScrollbar,FluentOverlayScrollbar'
      )
    }
  )
})
