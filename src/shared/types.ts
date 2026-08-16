export type TaskKind = 'video' | 'sprite' | 'image' | 'audio' | 'pdf' | 'font'
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'skipped' | 'failed' | 'cancelled'

export type VideoQuality = 'high' | 'balanced' | 'small'
export type VideoResolution = 'source' | '1080p' | '720p' | 'custom'
export type VideoFormat = 'source' | 'mp4' | 'mov' | 'mkv' | 'avi'
export type VideoCodec = 'source' | 'h264' | 'h265' | 'mpeg4'
export type VideoRateControl = 'quality' | 'bitrate'
export type VideoFrameRate = 'source' | '24' | '30' | '60' | 'custom'
export type VideoAudioMode = 'aac' | 'copy' | 'none'
export type VideoEncoderMode = 'auto' | 'software' | 'hardware'
export type SpriteSamplingMode = 'interval' | 'count' | 'frame'
export type SpriteExportMode = 'single' | 'batch'
export type SpriteImageFormat = 'png' | 'jpeg' | 'webp'
export type ImageFormat = 'original' | 'jpeg' | 'png' | 'webp' | 'avif'
export type ImageCompressionMode = 'quality' | 'targetSize'
export type ImageResizeMode = 'source' | 'width' | 'height' | 'percentage'
export type ImageMetadataMode = 'strip' | 'colorProfile' | 'all'
export type OutputMode = 'source' | 'custom'
export type CloseBehavior = 'ask' | 'minimizeToTray' | 'quit'
export type OutputConflictPolicy = 'rename' | 'overwrite' | 'skip'
export type AudioFormat = 'mp3' | 'm4a' | 'wav' | 'flac'
export type AudioChannels = 'source' | 'mono' | 'stereo'
export type PdfOperation = 'compress' | 'toImage'
export type PdfCompressionMode = 'lossless' | 'lossy'
export type PdfImageFormat = 'png' | 'jpeg' | 'webp'
export type FontOperation = 'convert' | 'splitCollection' | 'variableStatic' | 'subset'
export type FontFormat = 'ttf' | 'otf' | 'woff' | 'woff2'
export type FontVariableInstanceMode = 'named' | 'default'
export type FontSubsetMode = 'latin' | 'chinese' | 'custom'
export type FontSubsetChineseLevel = '3500' | '6500' | '8105'
export type FontConversionSubsetPreset = 'none' | 'latin' | FontSubsetChineseLevel
export type ConcurrencyMode = 'auto' | 'custom'

export interface TaskConcurrencyLimits {
  image: number
  video: number
  sprite: number
  audio: number
  pdf: number
  font: number
}

export interface ConcurrencySettings {
  mode: ConcurrencyMode
  custom: TaskConcurrencyLimits
}

export interface VideoOptions {
  encoderMode: VideoEncoderMode
  quality: VideoQuality
  resolution: VideoResolution
  customResolutionHeight: number
  format: VideoFormat
  codec: VideoCodec
  rateControl: VideoRateControl
  bitrateMbps: number
  frameRate: VideoFrameRate
  customFrameRate: number
  audioMode: VideoAudioMode
  audioBitrateKbps: number
}

export interface SpriteOptions {
  samplingMode: SpriteSamplingMode
  intervalSeconds: number
  frameCount: number
  frameStep: number
  startTimeSeconds: number
  endTimeSeconds: number
  frameWidth: number
  columns: number
  exportMode: SpriteExportMode
  framesPerSheet: number
  padding: number
  margin: number
  backgroundColor: string
  imageFormat: SpriteImageFormat
  quality: number
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

export interface PdfOptions {
  operation: PdfOperation
  compressionMode: PdfCompressionMode
  compressionDpi: number
  compressionQuality: number
  imageFormat: PdfImageFormat
  dpi: number
  imageQuality: number
}

export interface FontInstance {
  name: string
  axes: Record<string, number>
}

export interface FontOptions {
  operation: FontOperation
  outputFormat: FontFormat
  variableInstanceMode: FontVariableInstanceMode
  subsetMode: FontSubsetMode
  subsetChineseLevel: FontSubsetChineseLevel
  subsetIncludeLatin: boolean
  subsetExtraText?: string
  subsetText?: string
  subsetTextFile?: string
}

export interface ImageInputFile {
  path: string
  relativeDirectory: string
  sourceSize?: number
  width?: number
  height?: number
  metadataStatus?: 'loading' | 'ready' | 'error'
  metadataError?: string
}

export interface ImageSourceMetadata {
  sourceSize: number
  format: string
  width: number
  height: number
}

export interface FontInputFile {
  path: string
  outputFormat: FontFormat
  subsetPreset?: FontConversionSubsetPreset
}

export interface FontInspectionAxis {
  tag: string
  name: string
  min: number
  default: number
  max: number
}

export interface FontInspectionMetrics {
  unitsPerEm: number
  ascent: number
  descent: number
  lineGap: number
  xHeight: number
  capHeight: number
}

export interface FontInspection {
  sourcePath: string
  previewUrl: string
  fileName: string
  fileSize: number
  format: string
  familyName: string
  subfamilyName: string
  fullName: string
  postscriptName: string
  version: string
  fontCount: number
  glyphCount: number
  codePoints: number[]
  metrics: FontInspectionMetrics
  variationAxes: FontInspectionAxis[]
  editable: boolean
  readOnlyReason?: string
}

export interface FontEditValues extends FontInspectionMetrics {
  offsetX: number
  offsetY: number
  scaleX: number
  scaleY: number
  skewX: number
  advanceWidthDelta: number
}

export interface SaveEditedFontResult {
  outputPath: string
}

export interface CommonSettings {
  concurrency: ConcurrencySettings
  closeBehavior: CloseBehavior
  outputMode: OutputMode
  outputDirectory: string
  outputNameTemplate: string
  outputConflictPolicy: OutputConflictPolicy
}

export interface ImageSettings {
  outputSuffix: string
  lastOptions: ImageOptions
}

export interface VideoSettings {
  outputSuffix: string
  lastOptions: VideoOptions
}

export interface SpriteSettings {
  outputSuffix: string
  lastOptions: SpriteOptions
}

export interface AudioSettings {
  outputSuffix: string
  lastOptions: AudioOptions
}

export interface PdfSettings {
  outputSuffix: string
  lastOptions: PdfOptions
}

export interface FontSettings {
  outputSuffix: string
  lastOptions: FontOptions
}

export type RenameBaseMode = 'original' | 'custom'
export type RenameMode = 'sequence' | 'custom'
export type RenameCaseMode = 'unchanged' | 'lower' | 'upper' | 'title'
export type RenameSequencePosition = 'prefix' | 'suffix'
export type RenameDateSource = 'none' | 'createdAt' | 'modifiedAt'
export type RenameDatePosition = 'prefix' | 'suffix'
export type RenameDateFormat = 'YYYYMMDD' | 'YYYY-MM-DD' | 'YYYYMMDD-HHmmss'
export type RenameSortField = 'name' | 'createdAt' | 'modifiedAt' | 'size' | 'extension'
export type RenameSortDirection = 'asc' | 'desc'

export interface RenameSettings {
  mode: RenameMode
  baseMode: RenameBaseMode
  customName: string
  prefix: string
  suffix: string
  findText: string
  replaceText: string
  caseMode: RenameCaseMode
  sequenceEnabled: boolean
  sequencePosition: RenameSequencePosition
  sequenceStart: number
  sequenceStep: number
  sequencePadding: number
  separator: string
  dateSource: RenameDateSource
  datePosition: RenameDatePosition
  dateFormat: RenameDateFormat
  sortField: RenameSortField
  sortDirection: RenameSortDirection
}

export interface RenameFileInfo {
  path: string
  name: string
  stem: string
  extension: string
  size: number
  createdAt: string
  modifiedAt: string
}

export interface RenameRejectedFile {
  path: string
  reason: string
}

export interface InspectRenameFilesResult {
  files: RenameFileInfo[]
  rejected: RenameRejectedFile[]
}

export interface RenameFileRequest {
  sourcePath: string
  targetName: string
}

export interface RenameFileResult {
  sourcePath: string
  targetPath: string
  targetName: string
  renamed: boolean
}

export interface RenamePlanInspection {
  sourcePath: string
  targetPath: string
  valid: boolean
  changed: boolean
  error?: string
}

export interface AppSettings {
  common: CommonSettings
  image: ImageSettings
  video: VideoSettings
  sprite: SpriteSettings
  audio: AudioSettings
  pdf: PdfSettings
  font: FontSettings
  rename: RenameSettings
}

export interface AppSettingsPatch {
  common?: Partial<CommonSettings>
  image?: {
    outputSuffix?: string
    lastOptions?: ImageOptions
  }
  video?: {
    outputSuffix?: string
    lastOptions?: VideoOptions
  }
  sprite?: {
    outputSuffix?: string
    lastOptions?: SpriteOptions
  }
  audio?: {
    outputSuffix?: string
    lastOptions?: AudioOptions
  }
  pdf?: {
    outputSuffix?: string
    lastOptions?: PdfOptions
  }
  font?: {
    outputSuffix?: string
    lastOptions?: FontOptions
  }
  rename?: Partial<RenameSettings>
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
  batchInputId?: string
  batchItemId?: string
  sourcePath: string
  relativeDirectory?: string
  outputPath: string
  status: TaskStatus
  progress: number | null
  options: VideoOptions | SpriteOptions | ImageOptions | AudioOptions | PdfOptions | FontOptions
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
  frameCount?: number
  sourceFrameCount?: number
  pageNumber?: number
  pageNumbers?: number[]
  outputPaths?: string[]
  fontIndex?: number
  fontInstance?: FontInstance
  skippedReason?: string
  failure?: TaskFailure
}

export interface TaskProgressUpdate {
  id: string
  progress: number | null
}

export interface MediaInspection {
  sourcePath: string
  outputPath: string
  outputPaths?: string[]
  valid: boolean
  skipped?: boolean
  sourceSize: number
  format?: string
  width?: number
  height?: number
  outputWidth?: number
  outputHeight?: number
  duration?: number
  frameCount?: number
  sourceFrameCount?: number
  sheetCount?: number
  videoCodec?: string
  audioCodec?: string
  channels?: number
  sampleRate?: number
  pageCount?: number
  fontCount?: number
  fontInstances?: FontInstance[]
  error?: string
}

export interface MediaInputMetadata {
  path: string
  width?: number
  height?: number
  frameCount?: number
  sourceFrameCount?: number
  sheetCount?: number
  pageCount?: number
  fontCount?: number
  fontInstances?: FontInstance[]
}

export type CreateTasksRequest =
  | {
      kind: 'video'
      sourcePaths: string[]
      batchItemIds?: string[]
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
      kind: 'sprite'
      sourcePaths: string[]
      batchItemIds?: string[]
      outputMode: OutputMode
      outputDirectory: string
      outputSuffix: string
      outputNameTemplate?: string
      outputConflictPolicy?: OutputConflictPolicy
      presetName?: string
      inputMetadata?: MediaInputMetadata[]
      options: SpriteOptions
    }
  | {
      kind: 'image'
      sources: ImageInputFile[]
      batchItemIds?: string[]
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
      batchItemIds?: string[]
      outputMode: OutputMode
      outputDirectory: string
      outputSuffix: string
      outputNameTemplate?: string
      outputConflictPolicy?: OutputConflictPolicy
      presetName?: string
      inputMetadata?: MediaInputMetadata[]
      options: AudioOptions
    }
  | {
      kind: 'pdf'
      sourcePaths: string[]
      batchItemIds?: string[]
      outputMode: OutputMode
      outputDirectory: string
      outputSuffix: string
      outputNameTemplate?: string
      outputConflictPolicy?: OutputConflictPolicy
      presetName?: string
      inputMetadata?: MediaInputMetadata[]
      pageNumbers?: number[]
      options: PdfOptions
    }
  | {
      kind: 'font'
      sources: FontInputFile[]
      batchItemIds?: string[]
      outputMode: OutputMode
      outputDirectory: string
      outputSuffix: string
      outputNameTemplate?: string
      outputConflictPolicy?: OutputConflictPolicy
      presetName?: string
      inputMetadata?: MediaInputMetadata[]
      fontIndexes?: number[]
      fontInstances?: FontInstance[]
      options: FontOptions
    }

export interface RuntimeCapabilities {
  ffmpeg: { available: boolean; version?: string; error?: string }
  ffprobe: { available: boolean; version?: string; error?: string }
  sharp: { available: boolean; version?: string; error?: string }
  hardwareVideo: { available: boolean; encoders: string[]; version?: string; error?: string }
  pdfium: { available: boolean; version?: string; error?: string }
  qpdf: { available: boolean; version?: string; error?: string }
  fonttools: { available: boolean; version?: string; error?: string }
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
  selectFontForInspection: () => Promise<string | null>
  selectTextFile: () => Promise<string | null>
  selectRenameFiles: () => Promise<string[]>
  getDroppedFilePath: (file: File) => string
  selectOutputDirectory: (current?: string) => Promise<string | null>
  selectImageDirectory: () => Promise<ImageInputFile[]>
  expandImageInputs: (paths: string[]) => Promise<ImageInputFile[]>
  inspectImageInput: (path: string) => Promise<ImageSourceMetadata>
  inspectFont: (path: string) => Promise<FontInspection>
  saveEditedFont: (path: string, edits: FontEditValues) => Promise<SaveEditedFontResult | null>
  inspectRenameFiles: (paths: string[]) => Promise<InspectRenameFilesResult>
  inspectRenamePlan: (items: RenameFileRequest[]) => Promise<RenamePlanInspection[]>
  renameFiles: (items: RenameFileRequest[]) => Promise<RenameFileResult[]>
  openOutputDirectory: () => Promise<void>
  createTasks: (request: CreateTasksRequest) => Promise<MediaTask[]>
  inspectTasks: (request: CreateTasksRequest) => Promise<MediaInspection[]>
  getTasks: () => Promise<MediaTask[]>
  cancelTask: (taskId: string) => Promise<boolean>
  retryTask: (taskId: string) => Promise<MediaTask | null>
  openTaskOutput: (taskId: string) => Promise<void>
  getSettings: () => Promise<AppSettings>
  getSettingsRecoveryNotice: () => Promise<string | null>
  updateSettings: (settings: AppSettingsPatch) => Promise<AppSettings>
  getCapabilities: () => Promise<RuntimeCapabilities>
  getVersion: () => Promise<string>
  getReleaseNotes: () => Promise<string>
  setWindowTheme: (theme: 'light' | 'dark') => Promise<void>
  getUpdateState: () => Promise<UpdateState>
  checkForUpdates: () => Promise<UpdateState>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  openReleasePage: () => Promise<void>
  openSourcePage: () => Promise<void>
  onTasksChanged: (callback: (tasks: MediaTask[]) => void) => () => void
  onTaskProgressChanged: (callback: (update: TaskProgressUpdate) => void) => () => void
  onUpdateChanged: (callback: (state: UpdateState) => void) => () => void
}
