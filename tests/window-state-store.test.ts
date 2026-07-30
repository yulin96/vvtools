import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { restoreWindowBounds, WindowStateStore } from '../src/main/services/window-state-store'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('WindowStateStore', () => {
  it('persists normal bounds and maximized state', () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-window-state-'))
    directories.push(root)
    const store = new WindowStateStore(root)

    store.save({
      getNormalBounds: () => ({ x: 80, y: 60, width: 1280, height: 800 }),
      isMaximized: () => true
    })

    expect(store.load()).toEqual({
      bounds: { x: 80, y: 60, width: 1280, height: 800 },
      maximized: true
    })
  })

  it('rejects malformed persisted state', () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-window-state-'))
    directories.push(root)
    writeFileSync(join(root, 'window-state.json'), JSON.stringify({ maximized: false }))

    expect(() => new WindowStateStore(root).load()).toThrow('窗口状态配置文件格式不正确')
  })
})

describe('restoreWindowBounds', () => {
  const primaryWorkArea = { x: 0, y: 0, width: 1440, height: 900 }
  const minimum = { width: 1040, height: 680 }

  it('keeps visible bounds inside their current display', () => {
    expect(
      restoreWindowBounds(
        { x: 1300, y: 760, width: 1200, height: 780 },
        [primaryWorkArea],
        primaryWorkArea,
        minimum
      )
    ).toEqual({ x: 240, y: 120, width: 1200, height: 780 })
  })

  it('centers bounds on the primary display when the previous display is unavailable', () => {
    expect(
      restoreWindowBounds(
        { x: 2000, y: 100, width: 1200, height: 800 },
        [primaryWorkArea],
        primaryWorkArea,
        minimum
      )
    ).toEqual({ x: 120, y: 50, width: 1200, height: 800 })
  })
})
