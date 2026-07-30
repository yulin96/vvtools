import type {
  AudioOptions,
  ConcurrencySettings,
  ImageOptions,
  ImagePreset,
  ImagePresetOptions,
  VideoOptions,
  VideoPreset
} from './types'

export const DEFAULT_CONCURRENCY_SETTINGS: ConcurrencySettings = {
  mode: 'auto',
  custom: {
    image: 8,
    video: 1,
    audio: 2
  }
}

export const DEFAULT_VIDEO_OPTIONS: VideoOptions = {
  encoderMode: 'auto',
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
  compressionMode: 'quality',
  quality: 90,
  targetSizeKb: 500,
  resizeMode: 'source',
  width: 1920,
  height: 1080,
  percentage: 100,
  allowEnlargement: false,
  format: 'original',
  preserveStructure: true,
  metadataMode: 'colorProfile'
}

export function getImagePresetOptions(options: ImageOptions): ImagePresetOptions {
  return {
    compressionMode: options.compressionMode,
    quality: options.quality,
    targetSizeKb: options.targetSizeKb,
    resizeMode: options.resizeMode,
    width: options.width,
    height: options.height,
    percentage: options.percentage,
    format: options.format
  }
}

export const DEFAULT_IMAGE_PRESETS: ImagePreset[] = [
  {
    id: 'image-original',
    name: '原图整理',
    options: {
      ...getImagePresetOptions(DEFAULT_IMAGE_OPTIONS),
      quality: 90
    }
  },
  {
    id: 'image-web',
    name: '网站图片',
    options: {
      ...getImagePresetOptions(DEFAULT_IMAGE_OPTIONS),
      quality: 90,
      format: 'webp'
    }
  },
  {
    id: 'image-share',
    name: '分享图',
    options: {
      ...getImagePresetOptions(DEFAULT_IMAGE_OPTIONS),
      quality: 80,
      resizeMode: 'width',
      width: 300,
      format: 'jpeg'
    }
  }
]

export const DEFAULT_AUDIO_OPTIONS: AudioOptions = {
  format: 'mp3',
  bitrateKbps: 192,
  channels: 'source',
  normalizeLoudness: false
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
export const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.m4a',
  '.aac',
  '.wav',
  '.flac',
  '.ogg',
  '.opus',
  '.wma'
])

export const IPC_CHANNELS = {
  selectFiles: 'files:select',
  selectOutputDirectory: 'directory:select-output',
  selectImageDirectory: 'directory:select-images',
  expandImageInputs: 'images:expand-inputs',
  openOutputDirectory: 'directory:open-output',
  createTasks: 'tasks:create',
  inspectTasks: 'tasks:inspect',
  getTasks: 'tasks:get',
  cancelTask: 'tasks:cancel',
  retryTask: 'tasks:retry',
  openTaskOutput: 'tasks:open-output',
  tasksChanged: 'tasks:changed',
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  getCapabilities: 'runtime:capabilities',
  getVersion: 'system:version',
  getReleaseNotes: 'system:release-notes',
  getUpdateState: 'updates:get-state',
  checkForUpdates: 'updates:check',
  downloadUpdate: 'updates:download',
  installUpdate: 'updates:install',
  openReleasePage: 'updates:open-release-page',
  updatesChanged: 'updates:changed'
} as const
