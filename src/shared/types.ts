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
export type CloseBehavior = 'ask' | 'minimizeToTray' | 'quit'
export type OutputConflictPolicy = 'rename' | 'skip'
export type CompletionAction = 'none' | 'openOutput'

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

export interface ImagePreset {
  id: string
  name: string
  options: ImageOptions
}

export interface ImageInputFile {
  path: string
  relativeDirectory: string
}

export interface AppSettings {
  concurrency: number
  historyRetentionDays: number
  closeBehavior: CloseBehavior
  outputMode: OutputMode
  outputDirectory: string
  outputSuffix: string
  outputNameTemplate: string
  outputConflictPolicy: OutputConflictPolicy
  completionNotification: boolean
  completionSound: boolean
  completionAction: CompletionAction
  video: VideoOptions
  videoPresets: VideoPreset[]
  image: ImageOptions
  imagePresets: ImagePreset[]
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
  outputNameTemplate?: string
  outputConflictPolicy?: OutputConflictPolicy
  presetName?: string
  sourceWidth?: number
  sourceHeight?: number
  failure?: TaskFailure
}

export interface MediaInspection {
  sourcePath: string
  outputPath: string
  valid: boolean
  skipped?: boolean
  sourceSize: number
  format?: string
  width?: number
  height?: number
  outputWidth?: number
  outputHeight?: number
  duration?: number
  videoCodec?: string
  error?: string
}

export interface MediaInputMetadata {
  path: string
  width?: number
  height?: number
}

export type CreateTasksRequest =
  | {
      kind: 'video'
      sourcePaths: string[]
      outputMode: OutputMode
      outputDirectory: string
      outputSuffix: string
      outputNameTemplate?: string
      outputConflictPolicy?: OutputConflictPolicy
      presetName?: string
      inputMetadata?: MediaInputMetadata[]
      options: VideoOptions
    }
  | {
      kind: 'image'
      sources: ImageInputFile[]
      outputMode: OutputMode
      outputDirectory: string
      outputSuffix: string
      outputNameTemplate?: string
      outputConflictPolicy?: OutputConflictPolicy
      presetName?: string
      inputMetadata?: MediaInputMetadata[]
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
  inspectTasks: (request: CreateTasksRequest) => Promise<MediaInspection[]>
  getTasks: () => Promise<MediaTask[]>
  cancelTask: (taskId: string) => Promise<boolean>
  retryTask: (taskId: string) => Promise<MediaTask | null>
  retryFailedTasks: () => Promise<MediaTask[]>
  clearFinishedTasks: () => Promise<number>
  cancelPendingTasks: () => Promise<number>
  getQueuePaused: () => Promise<boolean>
  setQueuePaused: (paused: boolean) => Promise<boolean>
  openTaskOutput: (taskId: string) => Promise<void>
  getSettings: () => Promise<AppSettings>
  updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>
  getCapabilities: () => Promise<RuntimeCapabilities>
  onTasksChanged: (callback: (tasks: MediaTask[]) => void) => () => void
}
