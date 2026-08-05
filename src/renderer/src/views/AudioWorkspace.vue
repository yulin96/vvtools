<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { FileAudio, Play, Plus, SlidersHorizontal, UploadCloud } from '@lucide/vue'
import type {
  AudioChannels,
  AudioFormat,
  AudioOptions,
  CreateTasksRequest
} from '../../../shared/types'
import { useAppStore } from '../stores/app'
import Button from '../components/ui/Button.vue'
import OutputLocationControls from '../components/OutputLocationControls.vue'
import SourceOverwriteWarning from '../components/SourceOverwriteWarning.vue'
import CurrentBatchTable from '../components/CurrentBatchTable.vue'
import ToggleSwitch from '../components/ui/ToggleSwitch.vue'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import DropFollowEffect from '../components/ui/DropFollowEffect.vue'

const store = useAppStore()
const dragging = ref(false)
const starting = ref(false)
const pendingPaths = computed<string[]>({
  get: () => store.pendingAudioPaths,
  set: (value) => (store.pendingAudioPaths = value)
})
const audioFormatOptions = [
  { value: 'mp3', label: 'MP3' },
  { value: 'm4a', label: 'M4A' },
  { value: 'wav', label: 'WAV' },
  { value: 'flac', label: 'FLAC' }
]
const channelOptions = [
  { value: 'source', label: '不改变' },
  { value: 'mono', label: '单声道' },
  { value: 'stereo', label: '立体声' }
]
const supportedExtensions = new Set([
  'mp3',
  'm4a',
  'aac',
  'wav',
  'flac',
  'ogg',
  'opus',
  'wma',
  'mp4',
  'mov',
  'mkv',
  'avi',
  'webm',
  'm4v',
  'mpeg',
  'mpg'
])

const audioTasks = computed(() => store.currentBatchTasks.audio)
const pendingTableItems = computed(() => pendingPaths.value.map((path) => ({ path })))

function updateAudio(patch: Partial<AudioOptions>): void {
  if (!store.settings) return
  void store.updateSettings({
    audio: {
      lastOptions: { ...store.settings.audio.lastOptions, ...patch }
    }
  })
}

function stageFiles(paths: string[]): void {
  const supported = paths.filter((path) =>
    supportedExtensions.has(path.split('.').pop()?.toLowerCase() || '')
  )
  if (supported.length === 0 && paths.length > 0) {
    store.errorMessage = '没有可导入的音频或视频文件'
    return
  }
  if (pendingPaths.value.length === 0) store.prepareCurrentBatch('audio')
  const combined = [...new Set([...pendingPaths.value, ...supported])]
  if (combined.length > 500) {
    store.errorMessage = '单次最多添加 500 个文件'
    return
  }
  pendingPaths.value = combined
}

async function chooseFiles(): Promise<void> {
  try {
    stageFiles(await window.api.selectFiles('audio'))
  } catch (error) {
    store.errorMessage = error instanceof Error ? error.message : String(error)
  }
}

async function startProcessing(): Promise<void> {
  if (!store.settings || pendingPaths.value.length === 0 || starting.value) return
  const settings = store.settings
  const request: CreateTasksRequest = {
    kind: 'audio',
    sourcePaths: [...pendingPaths.value],
    outputMode: settings.common.outputMode,
    outputDirectory: settings.common.outputDirectory,
    outputSuffix: settings.common.outputSuffix,
    outputNameTemplate: settings.common.outputNameTemplate,
    outputConflictPolicy: settings.common.outputConflictPolicy,
    presetName: '音频处理',
    options: { ...settings.audio.lastOptions }
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
  stageFiles(
    [...(event.dataTransfer?.files || [])].map((file) => window.api.getDroppedFilePath(file))
  )
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
        v-if="pendingPaths.length || audioTasks.length"
        kind="audio"
        :pending-items="pendingTableItems"
        :tasks="audioTasks"
        @remove-pending="pendingPaths = pendingPaths.filter((item) => item !== $event)"
      >
        <template #actions>
          <div class="flex items-center gap-1">
            <Button variant="secondary" size="sm" @click="chooseFiles">
              <Plus class="size-3.5" />添加文件
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
          <FileAudio v-else class="size-8" />
        </div>
        <p class="text-base font-semibold">
          {{ dragging ? '松开即可添加文件' : '拖入音频或视频文件' }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          支持常见音频格式，也可以直接从 MP4、MOV、MKV 等视频中提取音轨
        </p>
        <Button class="mt-5" @click="chooseFiles">选择音频或视频</Button>
      </div>
    </div>

    <!-- Right Sidebar Settings Panel -->
    <section v-if="store.settings" class="video-config-panel" aria-label="音频处理设置">
      <!-- Panel Header -->
      <div class="video-config-heading">
        <div class="config-heading-main">
          <SlidersHorizontal class="size-4 shrink-0 text-signal-strong" />
          <span class="shrink-0 text-sm font-semibold">音频输出设置</span>
        </div>
      </div>

      <!-- Panel Body -->
      <div class="video-config-body">
        <div class="config-section">
          <div class="config-section-title">基础设置</div>

          <div class="space-y-3">
            <label class="compact-field">
              <span>输出格式</span>
              <select
                class="compact-select"
                :value="store.settings.audio.lastOptions.format"
                @change="updateAudio({ format: ($event.target as HTMLSelectElement).value as AudioFormat })"
              >
                <option v-for="opt in audioFormatOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </label>

            <label
              v-if="!['wav', 'flac'].includes(store.settings.audio.lastOptions.format)"
              class="compact-field"
            >
              <span>音频码率</span>
              <select
                class="compact-select"
                :value="store.settings.audio.lastOptions.bitrateKbps"
                @change="
                  updateAudio({
                    bitrateKbps: Number(($event.target as HTMLSelectElement).value)
                  })
                "
              >
                <option :value="96">96 kbps</option>
                <option :value="128">128 kbps</option>
                <option :value="192">192 kbps</option>
                <option :value="256">256 kbps</option>
                <option :value="320">320 kbps</option>
              </select>
            </label>
            <div v-else class="rounded-lg border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground">
              无损格式（无需设置码率）
            </div>

            <label class="compact-field">
              <span>输出声道</span>
              <SegmentedControl
                label="输出声道"
                hide-label
                :model-value="store.settings.audio.lastOptions.channels"
                :options="channelOptions"
                @update:model-value="updateAudio({ channels: $event as AudioChannels })"
              />
            </label>

            <ToggleSwitch
              label="统一音量"
              :model-value="store.settings.audio.lastOptions.normalizeLoudness"
              enabled-text="已开启响度标准化"
              disabled-text="保持原始音量"
              @update:model-value="updateAudio({ normalizeLoudness: $event })"
            />
          </div>
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
