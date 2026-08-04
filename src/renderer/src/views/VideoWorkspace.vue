<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { FileVideo2, Play, Plus, SlidersHorizontal, UploadCloud } from '@lucide/vue'
import type {
  CreateTasksRequest,
  VideoAudioMode,
  VideoCodec,
  VideoEncoderMode,
  VideoFormat,
  VideoFrameRate,
  VideoOptions,
  VideoQuality,
  VideoRateControl,
  VideoResolution
} from '../../../shared/types'
import { DEFAULT_VIDEO_OPTIONS, DEFAULT_VIDEO_PRESETS } from '../../../shared/constants'
import { useAppStore } from '../stores/app'
import Button from '../components/ui/Button.vue'
import CurrentBatchTable from '../components/CurrentBatchTable.vue'
import OutputLocationControls from '../components/OutputLocationControls.vue'
import SourceOverwriteWarning from '../components/SourceOverwriteWarning.vue'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import AdvancedSettingsPanel from '../components/ui/AdvancedSettingsPanel.vue'
import AnimatedChevron from '../components/ui/AnimatedChevron.vue'
import DropFollowEffect from '../components/ui/DropFollowEffect.vue'

const store = useAppStore()
const configExpanded = ref(false)
const dragging = ref(false)
const starting = ref(false)
const customFrameRateInput = ref<HTMLInputElement | null>(null)
const customResolutionHeightInput = ref<HTMLInputElement | null>(null)
const pendingPaths = computed<string[]>({
  get: () => store.pendingVideoPaths,
  set: (value) => (store.pendingVideoPaths = value)
})
const videoExtensions = new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mpeg', 'mpg'])
const videoFormatOptions = [
  { value: 'source', label: '原格式' },
  { value: 'mp4', label: 'MP4' },
  { value: 'mov', label: 'MOV' },
  { value: 'mkv', label: 'MKV' },
  { value: 'avi', label: 'AVI' }
]
const videoCodecOptions = [
  { value: 'source', label: '原编码' },
  { value: 'h264', label: 'H.264', title: '兼容优先', ariaLabel: 'H.264，兼容优先' },
  { value: 'h265', label: 'H.265', title: '更小体积', ariaLabel: 'H.265，更小体积' },
  {
    value: 'mpeg4',
    label: 'MPEG-4',
    title: '适合较旧设备，仅支持 CPU 编码',
    ariaLabel: 'MPEG-4，适合较旧设备，仅支持 CPU 编码'
  }
]
const encoderModeOptions = [
  { value: 'auto', label: '自动', title: '自动检测（推荐）', ariaLabel: '自动检测，推荐' },
  {
    value: 'software',
    label: 'CPU',
    title: 'CPU 编码，兼容优先',
    ariaLabel: 'CPU 编码，兼容优先'
  },
  {
    value: 'hardware',
    label: '硬件',
    title: '硬件编码，速度优先',
    ariaLabel: '硬件编码，速度优先'
  }
]
const resolutionOptions = [
  { value: 'source', label: '原始' },
  { value: '1080p', label: '1080p', title: '最高 1080p', ariaLabel: '最高 1080p' },
  { value: '720p', label: '720p', title: '最高 720p', ariaLabel: '最高 720p' },
  { value: 'custom', label: '自定义', title: '自定义最大高度', ariaLabel: '自定义最大高度' }
]
const frameRateOptions = [
  { value: 'source', label: '原始', title: '保持原始帧率', ariaLabel: '保持原始帧率' },
  { value: '24', label: '24', title: '24 fps', ariaLabel: '24 fps' },
  { value: '30', label: '30', title: '30 fps', ariaLabel: '30 fps' },
  { value: '60', label: '60', title: '60 fps', ariaLabel: '60 fps' },
  { value: 'custom', label: '自定义', title: '自定义输出帧率', ariaLabel: '自定义输出帧率' }
]
const rateControlOptions = [
  { value: 'quality', label: '按画质' },
  { value: 'bitrate', label: '指定码率' }
]
const qualityOptions = [
  { value: 'high', label: '高质量' },
  { value: 'balanced', label: '均衡' },
  { value: 'small', label: '小体积' }
]
const videoPresetOptions = [
  { value: 'custom', label: '自定义' },
  ...DEFAULT_VIDEO_PRESETS.map((preset) => ({ value: preset.id, label: preset.name }))
]

const videoTasks = computed(() => store.currentBatchTasks.video)
const availableEncoderModeOptions = computed(() =>
  store.settings?.video.lastOptions.codec === 'mpeg4'
    ? encoderModeOptions.filter((option) => option.value !== 'hardware')
    : encoderModeOptions
)
const pendingTableItems = computed(() => pendingPaths.value.map((path) => ({ path })))
const copiesSourceVideo = computed(() => {
  const video = store.settings?.video.lastOptions
  return video?.codec === 'source' && video.resolution === 'source' && video.frameRate === 'source'
})
const activePresetId = computed(() => {
  if (!store.settings) return 'custom'
  return (
    DEFAULT_VIDEO_PRESETS.find((preset) =>
      optionsEqual(preset.options, store.settings!.video.lastOptions)
    )?.id ?? 'custom'
  )
})
const activePresetName = computed(
  () => DEFAULT_VIDEO_PRESETS.find((preset) => preset.id === activePresetId.value)?.name ?? '自定义'
)
const qualityLabel = computed(() => {
  if (!store.settings) return ''
  if (copiesSourceVideo.value) return '保持原画面'
  if (store.settings.video.lastOptions.rateControl === 'bitrate') {
    return `${store.settings.video.lastOptions.bitrateMbps} Mbps`
  }
  return { high: '高质量', balanced: '均衡', small: '更小体积' }[
    store.settings.video.lastOptions.quality
  ]
})
const codecLabel = computed(() => {
  const codec = store.settings?.video.lastOptions.codec
  if (codec === 'source') return '保持原编码'
  if (codec === 'h265') return 'H.265'
  return codec === 'mpeg4' ? 'MPEG-4' : 'H.264'
})
const formatLabel = computed(() => {
  const format = store.settings?.video.lastOptions.format
  return format === 'source' ? '保持原格式' : (format?.toUpperCase() ?? '')
})

function optionsEqual(left: VideoOptions, right: VideoOptions): boolean {
  return (
    left.quality === right.quality &&
    left.encoderMode === right.encoderMode &&
    left.resolution === right.resolution &&
    left.customResolutionHeight === right.customResolutionHeight &&
    left.format === right.format &&
    left.codec === right.codec &&
    left.rateControl === right.rateControl &&
    left.bitrateMbps === right.bitrateMbps &&
    left.frameRate === right.frameRate &&
    left.customFrameRate === right.customFrameRate &&
    left.audioMode === right.audioMode &&
    left.audioBitrateKbps === right.audioBitrateKbps
  )
}

function updateVideo(patch: Partial<VideoOptions>): Promise<void> {
  if (!store.settings) return Promise.resolve()
  return store.updateSettings({
    video: {
      lastOptions: { ...store.settings.video.lastOptions, ...patch }
    }
  })
}

async function updateVideoFrameRate(value: string | number): Promise<void> {
  const frameRate = value as VideoFrameRate
  await updateVideo({ frameRate })
  if (frameRate !== 'custom') return

  await nextTick()
  customFrameRateInput.value?.focus()
  customFrameRateInput.value?.select()
}

async function updateVideoResolution(value: string | number): Promise<void> {
  const resolution = value as VideoResolution
  await updateVideo({ resolution })
  if (resolution !== 'custom') return

  await nextTick()
  customResolutionHeightInput.value?.focus()
  customResolutionHeightInput.value?.select()
}

function updateVideoCodec(value: string | number): void {
  const codec = value as VideoCodec
  void updateVideo({
    codec,
    ...(codec === 'mpeg4' && store.settings?.video.lastOptions.encoderMode === 'hardware'
      ? { encoderMode: 'auto' as const }
      : {})
  })
}

function applyPreset(value: string | number): void {
  if (!store.settings) return
  const id = String(value)
  const options =
    id === 'custom'
      ? DEFAULT_VIDEO_OPTIONS
      : DEFAULT_VIDEO_PRESETS.find((preset) => preset.id === id)?.options
  if (options) void store.updateSettings({ video: { lastOptions: { ...options } } })
}

function stageFiles(paths: string[]): void {
  if (paths.length === 0) return
  if (pendingPaths.value.length === 0) store.prepareCurrentBatch('video')
  pendingPaths.value = [...new Set([...pendingPaths.value, ...paths])]
}

async function chooseFiles(): Promise<void> {
  stageFiles(await window.api.selectFiles('video'))
}

async function startProcessing(): Promise<void> {
  if (!store.settings || pendingPaths.value.length === 0 || starting.value) return
  const settings = store.settings
  const request: CreateTasksRequest = {
    kind: 'video',
    sourcePaths: [...pendingPaths.value],
    outputMode: settings.common.outputMode,
    outputDirectory: settings.common.outputDirectory,
    outputSuffix: settings.common.outputSuffix,
    outputNameTemplate: settings.common.outputNameTemplate,
    outputConflictPolicy: settings.common.outputConflictPolicy,
    presetName: activePresetName.value,
    options: { ...settings.video.lastOptions }
  }
  starting.value = true
  try {
    const result = await store.submitTasks(request)
    if (!result) return
    const handledPaths = new Set(result.handledPaths)
    pendingPaths.value = pendingPaths.value.filter((path) => !handledPaths.has(path))
  } finally {
    starting.value = false
  }
}

function removePending(path: string): void {
  pendingPaths.value = pendingPaths.value.filter((item) => item !== path)
}

function hasFiles(event: DragEvent): boolean {
  return [...(event.dataTransfer?.types || [])].includes('Files')
}

function handleDragOver(event: DragEvent): void {
  if (!hasFiles(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  dragging.value = true
}

function handleDragLeave(event: DragEvent): void {
  if (!event.relatedTarget) dragging.value = false
}

function handleDrop(event: DragEvent): void {
  if (!hasFiles(event)) return
  event.preventDefault()
  dragging.value = false
  const files = [...(event.dataTransfer?.files || [])]
  const paths = files
    .map((file) => window.api.getDroppedFilePath(file))
    .filter((path) => videoExtensions.has(path.split('.').pop()?.toLowerCase() || ''))
  if (paths.length === 0 && files.length > 0) {
    store.errorMessage = '没有可导入的视频文件'
    return
  }
  stageFiles(paths)
}

onMounted(() => {
  window.addEventListener('dragover', handleDragOver, true)
  window.addEventListener('dragleave', handleDragLeave, true)
  window.addEventListener('drop', handleDrop, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('dragover', handleDragOver, true)
  window.removeEventListener('dragleave', handleDragLeave, true)
  window.removeEventListener('drop', handleDrop, true)
})
</script>

<template>
  <div class="video-drop-workspace" :class="{ 'video-drop-workspace-active': dragging }">
    <DropFollowEffect :active="dragging" />
    <section v-if="store.settings" class="video-config-panel" aria-label="视频转换设置">
      <div class="video-config-heading">
        <div class="config-heading-main">
          <SlidersHorizontal class="size-4 shrink-0 text-signal-strong" />
          <span class="shrink-0 text-sm font-semibold">视频转换设置</span>
          <Button
            class="config-expand-toggle"
            variant="ghost"
            size="sm"
            :aria-expanded="configExpanded"
            aria-controls="video-advanced-settings"
            @click="configExpanded = !configExpanded"
          >
            {{ configExpanded ? '收起设置' : '更多设置' }}
            <AnimatedChevron :expanded="configExpanded" />
          </Button>
          <span class="config-summary truncate text-xs text-muted-foreground">
            {{ formatLabel }} · {{ codecLabel }} · {{ qualityLabel }}
          </span>
        </div>
        <div class="video-config-actions">
          <SegmentedControl
            class="preset-segments video-preset-segments"
            label="视频处理方案"
            :model-value="activePresetId"
            :options="videoPresetOptions"
            hide-label
            @update:model-value="applyPreset"
          />
          <OutputLocationControls />
          <SourceOverwriteWarning />
          <Button
            size="sm"
            :disabled="pendingPaths.length === 0 || starting"
            @click="startProcessing"
          >
            <Play class="size-4" />
            {{
              starting
                ? '正在开始…'
                : `开始处理${pendingPaths.length ? ` (${pendingPaths.length})` : ''}`
            }}
          </Button>
        </div>
      </div>

      <div class="video-config-primary">
        <fieldset class="config-group">
          <legend class="sr-only">格式与编码</legend>
          <div class="config-group-fields config-group-fields-single">
            <SegmentedControl
              label="输出格式"
              :model-value="store.settings.video.lastOptions.format"
              :options="videoFormatOptions"
              @update:model-value="updateVideo({ format: $event as VideoFormat })"
            />
            <SegmentedControl
              label="视频编码"
              :model-value="store.settings.video.lastOptions.codec"
              :options="videoCodecOptions"
              @update:model-value="updateVideoCodec"
            />
          </div>
        </fieldset>

        <fieldset class="config-group">
          <legend class="sr-only">画面</legend>
          <div class="config-group-fields config-group-fields-single">
            <SegmentedControl
              class="video-frame-rate-segments custom-value-segments"
              :class="{
                'is-expanded': store.settings.video.lastOptions.frameRate === 'custom'
              }"
              label="输出帧率"
              :model-value="store.settings.video.lastOptions.frameRate"
              :options="frameRateOptions"
              @update:model-value="updateVideoFrameRate"
            >
              <template #append>
                <label
                  class="custom-value-append"
                  :aria-hidden="store.settings.video.lastOptions.frameRate !== 'custom'"
                >
                  <span class="sr-only">自定义帧率</span>
                  <input
                    ref="customFrameRateInput"
                    class="custom-value-input"
                    :value="store.settings.video.lastOptions.customFrameRate"
                    :disabled="store.settings.video.lastOptions.frameRate !== 'custom'"
                    aria-label="自定义帧率"
                    type="number"
                    min="1"
                    max="240"
                    step="0.01"
                    @change="
                      updateVideo({
                        customFrameRate: Number(($event.target as HTMLInputElement).value)
                      })
                    "
                  />
                  <span class="custom-value-unit" aria-hidden="true">fps</span>
                </label>
              </template>
            </SegmentedControl>
            <SegmentedControl
              class="custom-value-segments"
              :class="{
                'is-expanded': store.settings.video.lastOptions.resolution === 'custom'
              }"
              label="最大分辨率"
              :model-value="store.settings.video.lastOptions.resolution"
              :options="resolutionOptions"
              @update:model-value="updateVideoResolution"
            >
              <template #append>
                <label
                  class="custom-value-append"
                  :aria-hidden="store.settings.video.lastOptions.resolution !== 'custom'"
                >
                  <span class="sr-only">自定义高度</span>
                  <input
                    ref="customResolutionHeightInput"
                    class="custom-value-input"
                    :value="store.settings.video.lastOptions.customResolutionHeight"
                    :disabled="store.settings.video.lastOptions.resolution !== 'custom'"
                    aria-label="自定义高度"
                    type="number"
                    min="144"
                    max="4320"
                    @change="
                      updateVideo({
                        customResolutionHeight: Number(($event.target as HTMLInputElement).value)
                      })
                    "
                  />
                  <span class="custom-value-unit" aria-hidden="true">px</span>
                </label>
              </template>
            </SegmentedControl>
          </div>
        </fieldset>

        <fieldset class="config-group">
          <legend class="sr-only">压缩</legend>
          <div class="config-group-fields">
            <SegmentedControl
              label="画质控制"
              :model-value="store.settings.video.lastOptions.rateControl"
              :options="rateControlOptions"
              :disabled="copiesSourceVideo"
              :class="{ 'opacity-45': copiesSourceVideo }"
              @update:model-value="updateVideo({ rateControl: $event as VideoRateControl })"
            />
            <div :class="{ 'opacity-45': copiesSourceVideo }">
              <SegmentedControl
                v-if="store.settings.video.lastOptions.rateControl === 'quality'"
                label="输出画质"
                :model-value="store.settings.video.lastOptions.quality"
                :options="qualityOptions"
                :disabled="copiesSourceVideo"
                @update:model-value="updateVideo({ quality: $event as VideoQuality })"
              />
              <label v-else class="compact-field">
                <span>视频码率</span>
                <div class="number-field">
                  <input
                    :value="store.settings.video.lastOptions.bitrateMbps"
                    :disabled="copiesSourceVideo"
                    type="number"
                    min="0.5"
                    max="100"
                    step="0.5"
                    @change="
                      updateVideo({
                        bitrateMbps: Number(($event.target as HTMLInputElement).value)
                      })
                    "
                  /><span>Mbps</span>
                </div>
              </label>
            </div>
          </div>
        </fieldset>
      </div>

      <AdvancedSettingsPanel
        id="video-advanced-settings"
        :open="configExpanded"
        class="video-config-expanded"
      >
        <fieldset class="config-group advanced-settings-list video-advanced-settings-list">
          <legend class="sr-only">编码与音频</legend>
          <div class="config-group-fields">
            <SegmentedControl
              label="编码加速"
              :model-value="store.settings.video.lastOptions.encoderMode"
              :options="availableEncoderModeOptions"
              @update:model-value="updateVideo({ encoderMode: $event as VideoEncoderMode })"
            />
            <label class="compact-field">
              <span>视频中的音频</span>
              <select
                :value="store.settings.video.lastOptions.audioMode"
                @change="
                  updateVideo({
                    audioMode: ($event.target as HTMLSelectElement).value as VideoAudioMode
                  })
                "
              >
                <option value="aac">转为 AAC</option>
                <option value="copy">复制原音频</option>
                <option value="none">移除音频</option>
              </select>
            </label>
            <label
              class="compact-field"
              :class="{ 'opacity-45': store.settings.video.lastOptions.audioMode !== 'aac' }"
            >
              <span>音频码率</span>
              <select
                :value="store.settings.video.lastOptions.audioBitrateKbps"
                :disabled="store.settings.video.lastOptions.audioMode !== 'aac'"
                @change="
                  updateVideo({
                    audioBitrateKbps: Number(($event.target as HTMLSelectElement).value)
                  })
                "
              >
                <option :value="96">96 kbps</option>
                <option :value="128">128 kbps</option>
                <option :value="192">192 kbps</option>
                <option :value="256">256 kbps</option>
              </select>
            </label>
          </div>
        </fieldset>
      </AdvancedSettingsPanel>
    </section>

    <div class="video-workspace-content" @click="configExpanded = false">
      <CurrentBatchTable
        v-if="pendingPaths.length || videoTasks.length"
        kind="video"
        :pending-items="pendingTableItems"
        :tasks="videoTasks"
        @remove-pending="removePending"
      >
        <template #actions>
          <div class="flex items-center gap-1">
            <Button variant="secondary" size="sm" @click="chooseFiles">
              <Plus class="size-3.5" />添加视频
            </Button>
            <Button v-if="pendingPaths.length" variant="ghost" size="sm" @click="pendingPaths = []">
              清空待处理
            </Button>
          </div>
        </template>
      </CurrentBatchTable>

      <div v-else class="video-drop-prompt" :class="{ 'video-drop-prompt-active': dragging }">
        <div class="video-drop-icon">
          <UploadCloud v-if="dragging" class="size-8" />
          <FileVideo2 v-else class="size-8" />
        </div>
        <p class="text-lg font-semibold">{{ dragging ? '松开即可添加视频' : '拖入视频文件' }}</p>
        <p class="mt-1 text-sm text-muted-foreground">
          文件会先加入待处理列表，不会立即开始。支持 MP4、MOV、MKV、AVI、WebM。
        </p>
        <Button class="mt-5" @click="chooseFiles">选择视频文件</Button>
      </div>
    </div>
  </div>
</template>
