<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ChevronDown,
  ChevronUp,
  FileVideo2,
  ListTodo,
  Play,
  Plus,
  SlidersHorizontal,
  Trash2,
  UploadCloud,
  X
} from '@lucide/vue'
import type {
  CreateTasksRequest,
  MediaInspection,
  VideoAudioMode,
  VideoCodec,
  VideoFormat,
  VideoFrameRate,
  VideoOptions,
  VideoQuality,
  VideoRateControl,
  VideoResolution
} from '../../../shared/types'
import { useAppStore } from '../stores/app'
import { fileName } from '../lib/utils'
import Button from '../components/ui/Button.vue'
import TaskTable from '../components/TaskTable.vue'
import OutputControls from '../components/OutputControls.vue'
import OutputSuffixField from '../components/OutputSuffixField.vue'
import PreflightModal from '../components/PreflightModal.vue'

const store = useAppStore()
const configExpanded = ref(false)
const dragging = ref(false)
const starting = ref(false)
const pendingPaths = ref<string[]>([])
const preflightOpen = ref(false)
const inspections = ref<MediaInspection[]>([])
const preparedRequest = ref<CreateTasksRequest | null>(null)
const videoExtensions = new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mpeg', 'mpg'])

const videoTasks = computed(() => store.tasks.filter((task) => task.kind === 'video').slice(-20))
const activeTaskCount = computed(
  () => videoTasks.value.filter((task) => ['pending', 'processing'].includes(task.status)).length
)
const copiesSourceVideo = computed(() => {
  const video = store.settings?.video
  return video?.codec === 'source' && video.resolution === 'source' && video.frameRate === 'source'
})
const activePresetId = computed(() => {
  if (!store.settings) return 'custom'
  return (
    store.settings.videoPresets.find((preset) =>
      optionsEqual(preset.options, store.settings!.video)
    )?.id ?? 'custom'
  )
})
const activePresetName = computed(
  () =>
    store.settings?.videoPresets.find((preset) => preset.id === activePresetId.value)?.name ??
    '自定义'
)
const qualityLabel = computed(() => {
  if (!store.settings) return ''
  if (copiesSourceVideo.value) return '保持原画面'
  if (store.settings.video.rateControl === 'bitrate') {
    return `${store.settings.video.bitrateMbps} Mbps`
  }
  return { high: '高质量', balanced: '均衡', small: '更小体积' }[store.settings.video.quality]
})
const codecLabel = computed(() => {
  const codec = store.settings?.video.codec
  return codec === 'source' ? '保持原编码' : codec === 'h265' ? 'H.265' : 'H.264'
})
const formatLabel = computed(() => {
  const format = store.settings?.video.format
  return format === 'source' ? '保持原格式' : (format?.toUpperCase() ?? '')
})

function optionsEqual(left: VideoOptions, right: VideoOptions): boolean {
  return (
    left.quality === right.quality &&
    left.resolution === right.resolution &&
    left.format === right.format &&
    left.codec === right.codec &&
    left.rateControl === right.rateControl &&
    left.bitrateMbps === right.bitrateMbps &&
    left.frameRate === right.frameRate &&
    left.audioMode === right.audioMode &&
    left.audioBitrateKbps === right.audioBitrateKbps
  )
}

function updateVideo(patch: Partial<VideoOptions>): void {
  if (!store.settings) return
  void store.updateSettings({ video: { ...store.settings.video, ...patch } })
}

function applyPreset(event: Event): void {
  if (!store.settings) return
  const id = (event.target as HTMLSelectElement).value
  const preset = store.settings.videoPresets.find((item) => item.id === id)
  if (preset) void store.updateSettings({ video: { ...preset.options } })
}

function stageFiles(paths: string[]): void {
  if (paths.length === 0) return
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
    outputMode: settings.outputMode,
    outputDirectory: settings.outputDirectory,
    outputSuffix: settings.outputSuffix,
    outputNameTemplate: settings.outputNameTemplate,
    outputConflictPolicy: settings.outputConflictPolicy,
    presetName: activePresetName.value,
    options: { ...settings.video }
  }
  starting.value = true
  const results = await store.inspectTasks(request)
  starting.value = false
  if (!results) return
  preparedRequest.value = request
  inspections.value = results
  preflightOpen.value = true
}

async function confirmProcessing(): Promise<void> {
  const request = preparedRequest.value
  if (!request || request.kind !== 'video') return
  const acceptedPaths = new Set(
    inspections.value.filter((item) => item.valid || item.skipped).map((item) => item.sourcePath)
  )
  preflightOpen.value = false
  const created = await store.createTasks({
    ...request,
    sourcePaths: request.sourcePaths.filter((path) => acceptedPaths.has(path)),
    inputMetadata: inspections.value
      .filter((item) => item.valid || item.skipped)
      .map((item) => ({
        path: item.sourcePath,
        width: item.outputWidth ?? item.width,
        height: item.outputHeight ?? item.height
      }))
  })
  if (created) {
    pendingPaths.value = pendingPaths.value.filter((path) => !acceptedPaths.has(path))
    preparedRequest.value = null
    inspections.value = []
  } else preflightOpen.value = true
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
    <section v-if="store.settings" class="video-config-panel" aria-label="视频转换设置">
      <div class="video-config-heading">
        <div class="config-heading-main">
          <SlidersHorizontal class="size-4 shrink-0 text-signal-strong" />
          <span class="shrink-0 text-sm font-semibold">视频设置</span>
          <span v-if="!configExpanded" class="truncate text-xs text-muted-foreground">
            {{ formatLabel }} · {{ codecLabel }} · {{ qualityLabel }}
          </span>
          <Button
            variant="ghost"
            size="sm"
            :aria-expanded="configExpanded"
            aria-controls="video-advanced-settings"
            @click="configExpanded = !configExpanded"
          >
            {{ configExpanded ? '收起设置' : '高级设置' }}
            <component :is="configExpanded ? ChevronUp : ChevronDown" class="size-3.5" />
          </Button>
        </div>
        <div class="video-config-actions">
          <label class="preset-picker">
            <span class="sr-only">视频预设</span>
            <select :value="activePresetId" aria-label="视频预设" @change="applyPreset">
              <option v-if="activePresetId === 'custom'" value="custom" disabled>
                预设：自定义参数
              </option>
              <option
                v-for="preset in store.settings.videoPresets"
                :key="preset.id"
                :value="preset.id"
              >
                预设：{{ preset.name }}
              </option>
            </select>
          </label>
          <OutputControls />
          <Button :disabled="pendingPaths.length === 0 || starting" @click="startProcessing">
            <Play class="size-4" />
            {{
              starting
                ? '正在检查…'
                : `开始处理${pendingPaths.length ? ` (${pendingPaths.length})` : ''}`
            }}
          </Button>
        </div>
      </div>

      <div class="video-config-primary">
        <fieldset class="config-group">
          <legend>格式与编码</legend>
          <div class="config-group-fields">
            <label class="compact-field">
              <span>格式</span>
              <select
                :value="store.settings.video.format"
                @change="
                  updateVideo({ format: ($event.target as HTMLSelectElement).value as VideoFormat })
                "
              >
                <option value="source">保持原格式</option>
                <option value="mp4">MP4</option>
                <option value="mov">MOV</option>
                <option value="mkv">MKV</option>
              </select>
            </label>
            <label class="compact-field">
              <span>视频编码</span>
              <select
                :value="store.settings.video.codec"
                @change="
                  updateVideo({ codec: ($event.target as HTMLSelectElement).value as VideoCodec })
                "
              >
                <option value="source">保持原编码</option>
                <option value="h264">H.264 · 兼容优先</option>
                <option value="h265">H.265 · 更小体积</option>
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset class="config-group">
          <legend>画面</legend>
          <div class="config-group-fields">
            <label class="compact-field">
              <span>帧率</span>
              <select
                :value="store.settings.video.frameRate"
                @change="
                  updateVideo({
                    frameRate: ($event.target as HTMLSelectElement).value as VideoFrameRate
                  })
                "
              >
                <option value="source">保持原始</option>
                <option value="24">24 fps</option>
                <option value="25">25 fps</option>
                <option value="30">30 fps</option>
                <option value="60">60 fps</option>
              </select>
            </label>
            <label class="compact-field">
              <span>分辨率</span>
              <select
                :value="store.settings.video.resolution"
                @change="
                  updateVideo({
                    resolution: ($event.target as HTMLSelectElement).value as VideoResolution
                  })
                "
              >
                <option value="source">保持原始</option>
                <option value="1080p">最高 1080p</option>
                <option value="720p">最高 720p</option>
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset class="config-group">
          <legend>压缩</legend>
          <div class="config-group-fields">
            <label class="compact-field" :class="{ 'opacity-45': copiesSourceVideo }">
              <span>压缩方式</span>
              <select
                :value="store.settings.video.rateControl"
                :disabled="copiesSourceVideo"
                @change="
                  updateVideo({
                    rateControl: ($event.target as HTMLSelectElement).value as VideoRateControl
                  })
                "
              >
                <option value="quality">按质量</option>
                <option value="bitrate">目标码率</option>
              </select>
            </label>
            <label class="compact-field" :class="{ 'opacity-45': copiesSourceVideo }">
              <span>{{
                store.settings.video.rateControl === 'quality' ? '质量' : '视频码率'
              }}</span>
              <select
                v-if="store.settings.video.rateControl === 'quality'"
                :value="store.settings.video.quality"
                :disabled="copiesSourceVideo"
                @change="
                  updateVideo({
                    quality: ($event.target as HTMLSelectElement).value as VideoQuality
                  })
                "
              >
                <option value="high">高质量</option>
                <option value="balanced">均衡</option>
                <option value="small">更小体积</option>
              </select>
              <div v-else class="number-field">
                <input
                  :value="store.settings.video.bitrateMbps"
                  :disabled="copiesSourceVideo"
                  type="number"
                  min="0.5"
                  max="100"
                  step="0.5"
                  @change="
                    updateVideo({ bitrateMbps: Number(($event.target as HTMLInputElement).value) })
                  "
                /><span>Mbps</span>
              </div>
            </label>
          </div>
        </fieldset>
      </div>

      <div v-if="configExpanded" id="video-advanced-settings" class="video-config-expanded">
        <fieldset class="config-group">
          <legend>输出文件</legend>
          <div class="config-group-fields config-group-fields-single">
            <OutputSuffixField />
          </div>
        </fieldset>
        <fieldset class="config-group">
          <legend>音频</legend>
          <div class="config-group-fields">
            <label class="compact-field">
              <span>处理方式</span>
              <select
                :value="store.settings.video.audioMode"
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
              :class="{ 'opacity-45': store.settings.video.audioMode !== 'aac' }"
            >
              <span>音频码率</span>
              <select
                :value="store.settings.video.audioBitrateKbps"
                :disabled="store.settings.video.audioMode !== 'aac'"
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
      </div>
    </section>

    <div class="video-workspace-content">
      <section
        v-if="pendingPaths.length"
        class="pending-file-panel"
        aria-labelledby="pending-title"
      >
        <header class="pending-file-header">
          <div>
            <div class="flex items-center gap-2">
              <FileVideo2 class="size-4 text-signal-strong" />
              <h2 id="pending-title">待处理文件</h2>
              <span class="pending-count">{{ pendingPaths.length }}</span>
            </div>
            <p>确认预设和输出位置后，点击顶部“开始处理”。</p>
          </div>
          <div class="flex items-center gap-1">
            <Button variant="secondary" size="sm" @click="chooseFiles">
              <Plus class="size-3.5" />继续添加
            </Button>
            <Button variant="ghost" size="sm" @click="pendingPaths = []">
              <Trash2 class="size-3.5" />清空
            </Button>
          </div>
        </header>
        <ul class="pending-file-list">
          <li v-for="path in pendingPaths" :key="path">
            <FileVideo2 class="size-4 shrink-0 text-muted-foreground" />
            <span class="truncate" :title="path">{{ fileName(path) }}</span>
            <button
              type="button"
              :aria-label="`移除 ${fileName(path)}`"
              @click="removePending(path)"
            >
              <X class="size-4" />
            </button>
          </li>
        </ul>
      </section>

      <div
        v-else-if="videoTasks.length === 0"
        class="video-drop-prompt"
        :class="{ 'video-drop-prompt-active': dragging }"
      >
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

      <section v-if="videoTasks.length" class="inline-task-section" aria-labelledby="tasks-title">
        <header class="inline-task-header">
          <div>
            <div class="flex items-center gap-2">
              <ListTodo class="size-4 text-signal-strong" />
              <h2 id="tasks-title">任务进度</h2>
            </div>
            <p>
              {{
                activeTaskCount ? `${activeTaskCount} 个任务正在处理或等待` : '本次任务已处理完毕'
              }}
            </p>
          </div>
          <Button
            v-if="pendingPaths.length === 0"
            variant="secondary"
            size="sm"
            @click="chooseFiles"
          >
            <Plus class="size-3.5" />添加视频
          </Button>
        </header>
        <TaskTable :tasks="videoTasks" empty-text="暂无视频任务" />
      </section>
    </div>
  </div>
  <PreflightModal
    :open="preflightOpen"
    :inspections="inspections"
    @update:open="preflightOpen = $event"
    @confirm="confirmProcessing"
  />
</template>
