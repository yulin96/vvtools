export type TaskKind = 'video' | 'image'
export type TaskStatus =
  'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export type VideoQuality = 'high' | 'balanced' | 'small'
export type VideoResolution = 'source' | '1080p' | '720p'
export type VideoFormat = 'source' | 'mp4' | 'mov' | 'mkv'
export type VideoCodec = 'source' | 'h264' | 'h265'
export type VideoRateControl = 'quality' | 'bitrate'
export type VideoFrameRate = 'source' | '24' | '25' | '30' | '60'
export type VideoAudioMode = 'aac' | 'copy' | 'none'
export type ImageFormat = 'original' | 'jpeg' | 'png' | 'webp'
export type ImageCompressionMode = 'quality' | 'targetSize'
export type ImageResizeMode = 'source' | 'width' | 'height' | 'percentage'
export type OutputMode = 'source' | 'custom'

export interface VideoOptions {
  quality: VideoQuality
  resolution: VideoResolution
  format: VideoFormat
  codec: VideoCodec
  rateControl: VideoRateControl
  bitrateMbps: number
  frameRate: VideoFrameRate
  audioMode: VideoAudioMode
  audioBitrateKbps: number
}

export interface VideoPreset {
  id: string
  name: string
  options: VideoOptions
}

export interface ImageOptions {
  compressionMode: ImageCompressionMode
  quality: number
  targetSizeKb: number
  resizeMode: ImageResizeMode
  width: number
  height: number
  percentage: number
  allowEnlargement: boolean
  format: ImageFormat
  preserveStructure: boolean
}

export interface ImageInputFile {
  path: string
  relativeDirectory: string
}

export interface AppSettings {
  concurrency: number
  historyRetentionDays: number
  outputMode: OutputMode
  outputDirectory: string
  outputSuffix: string
  video: VideoOptions
  videoPresets: VideoPreset[]
  image: ImageOptions
}

export interface TaskCommand {
  executable: string
  args: string[]
  display: string
}

export interface TaskFailure {
  message: string
  exitCode?: number
  command?: TaskCommand
  stderrTail?: string
  logPath?: string
}

export interface MediaTask {
  id: string
  kind: TaskKind
  sourcePath: string
  outputPath: string
  status: TaskStatus
  progress: number | null
  options: VideoOptions | ImageOptions
  sourceSize: number
  outputSize?: number
  createdAt: string
  startedAt?: string
  completedAt?: string
  retryOf?: string
  outputSuffix?: string
  failure?: TaskFailure
}

export type CreateTasksRequest =
  | {
      kind: 'video'
      sourcePaths: string[]
      outputMode: OutputMode
      outputDirectory: string
      outputSuffix: string
      options: VideoOptions
    }
  | {
      kind: 'image'
      sources: ImageInputFile[]
      outputMode: OutputMode
      outputDirectory: string
      outputSuffix: string
      options: ImageOptions
    }

export interface RuntimeCapabilities {
  ffmpeg: { available: boolean; version?: string; error?: string }
  ffprobe: { available: boolean; version?: string; error?: string }
  sharp: { available: boolean; version?: string; error?: string }
}

export interface VVToolsApi {
  selectFiles: (kind: TaskKind) => Promise<string[]>
  getDroppedFilePath: (file: File) => string
  selectOutputDirectory: (current?: string) => Promise<string | null>
  selectImageDirectory: () => Promise<ImageInputFile[]>
  expandImageInputs: (paths: string[]) => Promise<ImageInputFile[]>
  openOutputDirectory: () => Promise<void>
  createTasks: (request: CreateTasksRequest) => Promise<MediaTask[]>
  getTasks: () => Promise<MediaTask[]>
  cancelTask: (taskId: string) => Promise<boolean>
  retryTask: (taskId: string) => Promise<MediaTask | null>
  retryFailedTasks: () => Promise<MediaTask[]>
  clearCompletedTasks: () => Promise<number>
  openTaskOutput: (taskId: string) => Promise<void>
  getSettings: () => Promise<AppSettings>
  updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>
  getCapabilities: () => Promise<RuntimeCapabilities>
  onTasksChanged: (callback: (tasks: MediaTask[]) => void) => () => void
}
