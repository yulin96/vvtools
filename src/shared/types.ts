export type TaskKind = 'video' | 'image'
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'

export type VideoQuality = 'high' | 'balanced' | 'small'
export type VideoResolution = 'source' | '1080p' | '720p'
export type ImageFormat = 'original' | 'jpeg' | 'png' | 'webp'

export interface VideoOptions {
  quality: VideoQuality
  resolution: VideoResolution
}

export interface ImageOptions {
  quality: number
  format: ImageFormat
}

export interface AppSettings {
  concurrency: number
  outputDirectory: string
  video: VideoOptions
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
  failure?: TaskFailure
}

export type CreateTasksRequest =
  | {
      kind: 'video'
      sourcePaths: string[]
      outputDirectory: string
      options: VideoOptions
    }
  | {
      kind: 'image'
      sourcePaths: string[]
      outputDirectory: string
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
  createTasks: (request: CreateTasksRequest) => Promise<MediaTask[]>
  getTasks: () => Promise<MediaTask[]>
  cancelTask: (taskId: string) => Promise<boolean>
  retryTask: (taskId: string) => Promise<MediaTask | null>
  openTaskOutput: (taskId: string) => Promise<void>
  getSettings: () => Promise<AppSettings>
  updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>
  getCapabilities: () => Promise<RuntimeCapabilities>
  onTasksChanged: (callback: (tasks: MediaTask[]) => void) => () => void
}
