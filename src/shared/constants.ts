import type { ImageOptions, VideoOptions, VideoPreset } from './types'

export const DEFAULT_VIDEO_OPTIONS: VideoOptions = {
  quality: 'balanced',
  resolution: 'source',
  format: 'mp4',
  codec: 'h264',
  rateControl: 'quality',
  bitrateMbps: 6,
  frameRate: 'source',
  audioMode: 'aac',
  audioBitrateKbps: 128
}

export const DEFAULT_VIDEO_PRESETS: VideoPreset[] = [
  {
    id: 'keep-original',
    name: '保持原始',
    options: {
      ...DEFAULT_VIDEO_OPTIONS,
      format: 'source',
      codec: 'source',
      resolution: 'source',
      frameRate: 'source',
      audioMode: 'copy'
    }
  },
  {
    id: 'low-quality',
    name: '低质量',
    options: {
      ...DEFAULT_VIDEO_OPTIONS,
      quality: 'small',
      resolution: '720p',
      audioBitrateKbps: 96
    }
  },
  {
    id: 'medium-quality',
    name: '中质量',
    options: {
      ...DEFAULT_VIDEO_OPTIONS,
      resolution: '1080p'
    }
  },
  {
    id: 'high-quality',
    name: '高质量',
    options: {
      ...DEFAULT_VIDEO_OPTIONS,
      quality: 'high',
      audioBitrateKbps: 192
    }
  }
]

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
  openOutputDirectory: 'directory:open-output',
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
