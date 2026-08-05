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
const configFrameExpanded = ref(false)
const configAudioExpanded = ref(false)
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
  { value: 'source', label: '保持原格式' },
  { value: 'mp4', label: 'MP4' },
  { value: 'mov', label: 'MOV' },
  { value: 'mkv', label: 'MKV' },
  { value: 'avi', label: 'AVI' }
]
const videoCodecOptions = [
  { value: 'source', label: '保持原编码' },
  { value: 'h264', label: 'H.264 (兼容优先)' },
  { value: 'h265', label: 'H.265 (更小体积)' },
  {
    value: 'mpeg4',
    label: 'MPEG-4 (旧设备兼容)'
  }
]
const encoderModeOptions = [
  { value: 'auto', label: '自动检测 (推荐)' },
  {
    value: 'software',
    label: 'CPU (兼容优先)'
  },
  {
    value: 'hardware',
    label: '硬件加速 (速度优先)'
  }
]
const resolutionOptions = [
  { value: 'source', label: '保持原分辨率' },
  { value: '1080p', label: '1080p (最高)' },
  { value: '720p', label: '720p (最高)' },
  { value: 'custom', label: '自定义高度...' }
]
const frameRateOptions = [
  { value: 'source', label: '保持原帧率' },
  { value: '24', label: '24 fps' },
  { value: '30', label: '30 fps' },
  { value: '60', label: '60 fps' },
  { value: 'custom', label: '自定义帧率...' }
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

    <!-- Left Main Content Area -->
    <div class="video-workspace-content">
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
        <p class="text-base font-semibold">{{ dragging ? '松开即可添加视频' : '拖入视频文件' }}</p>
        <p class="mt-1 text-xs text-muted-foreground">
          支持 MP4、MOV、MKV、AVI、WebM · 添加后不会立即开始
        </p>
        <Button class="mt-5" @click="chooseFiles">选择视频文件</Button>
      </div>
    </div>

    <!-- Right Sidebar Settings Panel -->
    <section v-if="store.settings" class="video-config-panel" aria-label="视频转换设置">
      <!-- Panel Header -->
      <div class="video-config-heading">
        <div class="config-heading-main">
          <SlidersHorizontal class="size-4 shrink-0 text-signal-strong" />
          <span class="shrink-0 text-sm font-semibold">视频转换设置</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-xs text-muted-foreground">预设</span>
          <select
            class="panel-preset-select"
            :value="activePresetId"
            @change="applyPreset(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="opt in videoPresetOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
      </div>

      <!-- Panel Body -->
      <div class="video-config-body">
        <!-- 基础设置 -->
        <div class="config-section">
          <div class="config-section-title">基础设置</div>

          <!-- 输出格式 & 视频编码 -->
          <div class="space-y-3">
            <label class="compact-field">
              <span>输出格式</span>
              <select
                class="compact-select"
                :value="store.settings.video.lastOptions.format"
                @change="updateVideo({ format: ($event.target as HTMLSelectElement).value as VideoFormat })"
              >
                <option v-for="opt in videoFormatOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </label>

            <label class="compact-field">
              <span>视频编码</span>
              <select
                class="compact-select"
                :value="store.settings.video.lastOptions.codec"
                @change="updateVideoCodec(($event.target as HTMLSelectElement).value)"
              >
                <option v-for="opt in videoCodecOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </label>
          </div>

          <!-- 画质控制 -->
          <div class="mt-4 space-y-3">
            <div v-if="copiesSourceVideo" class="rounded-lg border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground">
              保持原画面（不重新编码视频）
            </div>
            <template v-else>
              <label class="compact-field">
                <span>画质控制</span>
                <SegmentedControl
                  label="画质控制"
                  hide-label
                  :model-value="store.settings.video.lastOptions.rateControl"
                  :options="rateControlOptions"
                  @update:model-value="updateVideo({ rateControl: $event as VideoRateControl })"
                />
              </label>

              <div v-if="store.settings.video.lastOptions.rateControl === 'quality'">
                <label class="compact-field">
                  <span>输出画质</span>
                  <SegmentedControl
                    label="输出画质"
                    hide-label
                    :model-value="store.settings.video.lastOptions.quality"
                    :options="qualityOptions"
                    @update:model-value="updateVideo({ quality: $event as VideoQuality })"
                  />
                </label>
              </div>
              <div v-else>
                <label class="compact-field">
                  <span>视频码率 (Mbps)</span>
                  <div class="number-field">
                    <input
                      :value="store.settings.video.lastOptions.bitrateMbps"
                      type="number"
                      min="0.5"
                      max="100"
                      step="0.5"
                      @change="
                        updateVideo({
                          bitrateMbps: Number(($event.target as HTMLInputElement).value)
                        })
                      "
                    />
                    <span>Mbps</span>
                  </div>
                </label>
              </div>
            </template>
          </div>

          <!-- 最大分辨率 -->
          <div class="mt-4 space-y-3">
            <label class="compact-field">
              <span>最大分辨率</span>
              <select
                class="compact-select"
                :value="store.settings.video.lastOptions.resolution"
                @change="updateVideoResolution(($event.target as HTMLSelectElement).value)"
              >
                <option v-for="opt in resolutionOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </label>

            <!-- 自定义分辨率高度 (Only shown if 'custom') -->
            <label v-if="store.settings.video.lastOptions.resolution === 'custom'" class="compact-field">
              <span>自定义最大高度 (px)</span>
              <div class="number-field">
                <input
                  ref="customResolutionHeightInput"
                  :value="store.settings.video.lastOptions.customResolutionHeight"
                  type="number"
                  min="144"
                  max="4320"
                  @change="
                    updateVideo({
                      customResolutionHeight: Number(($event.target as HTMLInputElement).value)
                    })
                  "
                />
                <span>px</span>
              </div>
            </label>
          </div>
        </div>

        <!-- 帧率与编码 Accordion Section -->
        <div class="border-t border-border pt-3">
          <button
            type="button"
            class="config-accordion-trigger"
            :aria-expanded="configFrameExpanded"
            @click="configFrameExpanded = !configFrameExpanded"
          >
            <span>帧率与编码</span>
            <AnimatedChevron :expanded="configFrameExpanded" />
          </button>
          <AdvancedSettingsPanel :open="configFrameExpanded" class="mt-3 space-y-3">
            <label class="compact-field">
              <span>输出帧率</span>
              <select
                class="compact-select"
                :value="store.settings.video.lastOptions.frameRate"
                @change="updateVideoFrameRate(($event.target as HTMLSelectElement).value)"
              >
                <option v-for="opt in frameRateOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </label>

            <label v-if="store.settings.video.lastOptions.frameRate === 'custom'" class="compact-field">
              <span>自定义帧率 (fps)</span>
              <div class="number-field">
                <input
                  ref="customFrameRateInput"
                  :value="store.settings.video.lastOptions.customFrameRate"
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
                <span>fps</span>
              </div>
            </label>

            <label class="compact-field">
              <span>编码加速</span>
              <select
                class="compact-select"
                :value="store.settings.video.lastOptions.encoderMode"
                @change="updateVideo({ encoderMode: ($event.target as HTMLSelectElement).value as VideoEncoderMode })"
              >
                <option v-for="opt in availableEncoderModeOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </label>
          </AdvancedSettingsPanel>
        </div>

        <!-- 音频设置 Accordion Section -->
        <div class="border-t border-border pt-3">
          <button
            type="button"
            class="config-accordion-trigger"
            :aria-expanded="configAudioExpanded"
            @click="configAudioExpanded = !configAudioExpanded"
          >
            <span>音频设置</span>
            <AnimatedChevron :expanded="configAudioExpanded" />
          </button>
          <AdvancedSettingsPanel :open="configAudioExpanded" class="mt-3 space-y-3">
            <label class="compact-field">
              <span>视频中的音频</span>
              <select
                class="compact-select"
                :value="store.settings.video.lastOptions.audioMode"
                @change="
                  updateVideo({
                    audioMode: ($event.target as HTMLSelectElement).value as VideoAudioMode
                  })
                "
              >
                <option value="aac">转换为 AAC</option>
                <option value="copy">复制原音频</option>
                <option value="none">移除音频</option>
              </select>
            </label>

            <label v-if="store.settings.video.lastOptions.audioMode === 'aac'" class="compact-field">
              <span>音频码率</span>
              <select
                class="compact-select"
                :value="store.settings.video.lastOptions.audioBitrateKbps"
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
          </AdvancedSettingsPanel>
        </div>
      </div>

      <!-- Panel Footer -->
      <div class="video-config-footer">
        <div class="flex items-center justify-between gap-2">
          <OutputLocationControls />
          <SourceOverwriteWarning />
        </div>
        <Button
          size="default"
          class="w-full h-10 text-sm font-medium"
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
    </section>
  </div>
</template>
