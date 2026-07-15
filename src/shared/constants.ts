import type { ImageOptions, VideoOptions } from './types'

export const DEFAULT_VIDEO_OPTIONS: VideoOptions = {
  quality: 'balanced',
  resolution: 'source'
}

export const DEFAULT_IMAGE_OPTIONS: ImageOptions = {
  quality: 80,
  format: 'original'
}

export const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.mkv',
  '.avi',
  '.webm',
  '.m4v',
  '.mpeg',
  '.mpg'
])

export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

export const IPC_CHANNELS = {
  selectFiles: 'files:select',
  selectOutputDirectory: 'directory:select-output',
  createTasks: 'tasks:create',
  getTasks: 'tasks:get',
  cancelTask: 'tasks:cancel',
  retryTask: 'tasks:retry',
  openTaskOutput: 'tasks:open-output',
  tasksChanged: 'tasks:changed',
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  getCapabilities: 'runtime:capabilities'
} as const
