import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { BrowserWindow, Rectangle } from 'electron'

export interface WindowState {
  bounds: Rectangle
  maximized: boolean
}

interface WindowStateSource {
  getNormalBounds: BrowserWindow['getNormalBounds']
  isMaximized: BrowserWindow['isMaximized']
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isWindowState(value: unknown): value is WindowState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const state = value as Partial<WindowState>
  const bounds = state.bounds
  return (
    Boolean(bounds) &&
    isFiniteNumber(bounds?.x) &&
    isFiniteNumber(bounds?.y) &&
    isFiniteNumber(bounds?.width) &&
    isFiniteNumber(bounds?.height) &&
    bounds.width > 0 &&
    bounds.height > 0 &&
    typeof state.maximized === 'boolean'
  )
}

function intersectionArea(first: Rectangle, second: Rectangle): number {
  const width = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x)
  )
  const height = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y)
  )
  return width * height
}

export function restoreWindowBounds(
  stored: Rectangle | undefined,
  workAreas: Rectangle[],
  primaryWorkArea: Rectangle,
  minimum: { width: number; height: number }
): Rectangle | undefined {
  if (!stored) return undefined
  const matchingWorkArea = workAreas
    .map((workArea) => ({ workArea, area: intersectionArea(stored, workArea) }))
    .sort((left, right) => right.area - left.area)[0]
  const hasVisibleArea = Boolean(matchingWorkArea?.area)
  const workArea = hasVisibleArea ? matchingWorkArea.workArea : primaryWorkArea
  const width = Math.min(Math.max(stored.width, minimum.width), workArea.width)
  const height = Math.min(Math.max(stored.height, minimum.height), workArea.height)

  if (!hasVisibleArea) {
    return {
      x: workArea.x + Math.round((workArea.width - width) / 2),
      y: workArea.y + Math.round((workArea.height - height) / 2),
      width,
      height
    }
  }

  return {
    x: Math.min(Math.max(stored.x, workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(stored.y, workArea.y), workArea.y + workArea.height - height),
    width,
    height
  }
}

export class WindowStateStore {
  private readonly path: string

  constructor(userDataPath: string) {
    this.path = join(userDataPath, 'window-state.json')
  }

  load(): WindowState | undefined {
    if (!existsSync(this.path)) return undefined
    const stored = JSON.parse(readFileSync(this.path, 'utf8')) as unknown
    if (!isWindowState(stored)) throw new Error('窗口状态配置文件格式不正确')
    return stored
  }

  save(window: WindowStateSource): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temporaryPath = `${this.path}.tmp`
    const state: WindowState = {
      bounds: window.getNormalBounds(),
      maximized: window.isMaximized()
    }
    writeFileSync(temporaryPath, JSON.stringify(state, null, 2), 'utf8')
    renameSync(temporaryPath, this.path)
  }
}
