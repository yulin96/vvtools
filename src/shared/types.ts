export type TaskKind = 'video' | 'image' | 'audio'
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'

export type VideoQuality = 'high' | 'balanced' | 'small'
export type VideoResolution = 'source' | '1080p' | '720p'
export type VideoFormat = 'source' | 'mp4' | 'mov' | 'mkv'
export type VideoCodec = 'source' | 'h264' | 'h265'
export type VideoRateControl = 'quality' | 'bitrate'
export type VideoFrameRate = 'source' | '24' | '25' | '30' | '60'
export type VideoAudioMode = 'aac' | 'copy' | 'none'
export type VideoEncoderMode = 'auto' | 'software' | 'hardware'
export type ImageFormat = 'original' | 'jpeg' | 'png' | 'webp' | 'avif'
export type ImageCompressionMode = 'quality' | 'targetSize'
export type ImageResizeMode = 'source' | 'width' | 'height' | 'percentage'
export type ImageMetadataMode = 'strip' | 'colorProfile' | 'all'
export type OutputMode = 'source' | 'custom'
export type CloseBehavior = 'ask' | 'minimizeToTray' | 'quit'
export type OutputConflictPolicy = 'rename' | 'overwrite' | 'skip'
export type CompletionAction = 'none' | 'openOutput'
export type AudioFormat = 'mp3' | 'm4a' | 'wav' | 'flac'
export type AudioChannels = 'source' | 'mono' | 'stereo'
export type ConcurrencyMode = 'auto' | 'custom'

export interface TaskConcurrencyLimits {
  image: number
  video: number
  audio: number
}

export interface ConcurrencySettings {
  mode: ConcurrencyMode
  custom: TaskConcurrencyLimits
}

export interface VideoOptions {
  encoderMode: VideoEncoderMode
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
  metadataMode: ImageMetadataMode
}

export type ImagePresetOptions = Pick<
  ImageOptions,
  | 'compressionMode'
  | 'quality'
  | 'targetSizeKb'
  | 'resizeMode'
  | 'width'
  | 'height'
  | 'percentage'
  | 'format'
>

export interface ImagePreset {
  id: string
  name: string
  options: ImagePresetOptions
}

export interface AudioOptions {
  format: AudioFormat
  bitrateKbps: number
  channels: AudioChannels
  normalizeLoudness: boolean
}

export interface ImageInputFile {
  path: string
  relativeDirectory: string
}

export interface CommonSettings {
  concurrency: ConcurrencySettings
  closeBehavior: CloseBehavior
  outputMode: OutputMode
  outputDirectory: string
  outputSuffix: string
  outputNameTemplate: string
  outputConflictPolicy: OutputConflictPolicy
  completionNotification: boolean
  completionSound: boolean
  completionAction: CompletionAction
}

export interface ImageSettings {
  lastOptions: ImageOptions
  presets: ImagePreset[]
}

export interface VideoSettings {
  lastOptions: VideoOptions
  presets: VideoPreset[]
}

export interface AudioSettings {
  lastOptions: AudioOptions
}

export interface AppSettings {
  common: CommonSettings
  image: ImageSettings
  video: VideoSettings
  audio: AudioSettings
}

export interface AppSettingsPatch {
  common?: Partial<CommonSettings>
  image?: {
    lastOptions?: ImageOptions
    presets?: ImagePreset[]
  }
  video?: {
    lastOptions?: VideoOptions
    presets?: VideoPreset[]
  }
  audio?: {
    lastOptions?: AudioOptions
  }
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
  options: VideoOptions | ImageOptions | AudioOptions
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
  audioCodec?: string
  channels?: number
  sampleRate?: number
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
  | {
      kind: 'audio'
      sourcePaths: string[]
      outputMode: OutputMode
      outputDirectory: string
      outputSuffix: string
      outputNameTemplate?: string
      outputConflictPolicy?: OutputConflictPolicy
      presetName?: string
      inputMetadata?: MediaInputMetadata[]
      options: AudioOptions
    }

export interface RuntimeCapabilities {
  ffmpeg: { available: boolean; version?: string; error?: string }
  ffprobe: { available: boolean; version?: string; error?: string }
  sharp: { available: boolean; version?: string; error?: string }
  hardwareVideo: { available: boolean; encoders: string[]; version?: string; error?: string }
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'
  | 'unsupported'

export interface UpdateState {
  status: UpdateStatus
  version?: string
  percent?: number
  message?: string
  releaseNotes?: string
}

export interface VVToolsApi {
  platform: 'darwin' | 'win32' | 'linux'
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
  openTaskOutput: (taskId: string) => Promise<void>
  getSettings: () => Promise<AppSettings>
  updateSettings: (settings: AppSettingsPatch) => Promise<AppSettings>
  getCapabilities: () => Promise<RuntimeCapabilities>
  getVersion: () => Promise<string>
  getReleaseNotes: () => Promise<string>
  getUpdateState: () => Promise<UpdateState>
  checkForUpdates: () => Promise<UpdateState>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  openReleasePage: () => Promise<void>
  onTasksChanged: (callback: (tasks: MediaTask[]) => void) => () => void
  onUpdateChanged: (callback: (state: UpdateState) => void) => () => void
}
