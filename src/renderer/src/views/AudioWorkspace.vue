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
import OutputConflictPolicyField from '../components/OutputConflictPolicyField.vue'
import OutputSuffixField from '../components/OutputSuffixField.vue'
import SourceOverwriteWarning from '../components/SourceOverwriteWarning.vue'
import CurrentBatchTable from '../components/CurrentBatchTable.vue'
import ToggleSwitch from '../components/ui/ToggleSwitch.vue'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import AdvancedSettingsPanel from '../components/ui/AdvancedSettingsPanel.vue'
import AnimatedChevron from '../components/ui/AnimatedChevron.vue'
import DropFollowEffect from '../components/ui/DropFollowEffect.vue'

const store = useAppStore()
const configExpanded = ref(false)
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
  { value: 'source', label: '原始' },
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
const formatLabel = computed(() => store.settings?.audio.format.toUpperCase() ?? '')
const bitrateLabel = computed(() => {
  const audio = store.settings?.audio
  if (!audio) return ''
  return ['wav', 'flac'].includes(audio.format) ? '无损编码' : `${audio.bitrateKbps} kbps`
})

function updateAudio(patch: Partial<AudioOptions>): void {
  if (!store.settings) return
  void store.updateSettings({ audio: { ...store.settings.audio, ...patch } })
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
    outputMode: settings.outputMode,
    outputDirectory: settings.outputDirectory,
    outputSuffix: settings.outputSuffix,
    outputNameTemplate: settings.outputNameTemplate,
    outputConflictPolicy: settings.outputConflictPolicy,
    presetName: '音频处理',
    options: { ...settings.audio }
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
    <section v-if="store.settings" class="video-config-panel" aria-label="音频处理设置">
      <div class="video-config-heading">
        <div class="config-heading-main">
          <SlidersHorizontal class="size-4 shrink-0 text-signal-strong" />
          <span class="shrink-0 text-sm font-semibold">音频设置</span>
          <Button
            class="config-expand-toggle"
            variant="ghost"
            size="sm"
            :aria-expanded="configExpanded"
            aria-controls="audio-advanced-settings"
            @click="configExpanded = !configExpanded"
          >
            {{ configExpanded ? '收起设置' : '高级设置' }}
            <AnimatedChevron :expanded="configExpanded" />
          </Button>
          <span class="truncate text-xs text-muted-foreground">
            {{ formatLabel }} · {{ bitrateLabel }}
          </span>
        </div>
        <div class="video-config-actions">
          <OutputLocationControls />
          <SourceOverwriteWarning />
          <Button :disabled="pendingPaths.length === 0 || starting" @click="startProcessing">
            <Play class="size-4" />
            {{
              starting
                ? '正在开始…'
                : `开始处理${pendingPaths.length ? ` (${pendingPaths.length})` : ''}`
            }}
          </Button>
        </div>
      </div>

      <div class="image-config-primary">
        <fieldset class="config-group">
          <legend class="sr-only">格式与质量</legend>
          <div class="config-group-fields">
            <SegmentedControl
              label="输出格式"
              :model-value="store.settings.audio.format"
              :options="audioFormatOptions"
              @update:model-value="updateAudio({ format: $event as AudioFormat })"
            />
            <label
              class="compact-field"
              :class="{ 'opacity-45': ['wav', 'flac'].includes(store.settings.audio.format) }"
            >
              <span>音频码率</span>
              <select
                :value="store.settings.audio.bitrateKbps"
                :disabled="['wav', 'flac'].includes(store.settings.audio.format)"
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
          </div>
        </fieldset>

        <fieldset class="config-group">
          <legend class="sr-only">声道与响度</legend>
          <div class="config-group-fields">
            <SegmentedControl
              label="声道"
              :model-value="store.settings.audio.channels"
              :options="channelOptions"
              @update:model-value="updateAudio({ channels: $event as AudioChannels })"
            />
            <ToggleSwitch
              label="响度标准化"
              :model-value="store.settings.audio.normalizeLoudness"
              enabled-text="已开启"
              disabled-text="已关闭"
              @update:model-value="updateAudio({ normalizeLoudness: $event })"
            />
          </div>
        </fieldset>
      </div>

      <AdvancedSettingsPanel
        id="audio-advanced-settings"
        :open="configExpanded"
        class="video-config-expanded"
      >
        <fieldset class="config-group">
          <legend class="sr-only">输出文件</legend>
          <div class="config-group-fields config-group-fields-single">
            <OutputSuffixField />
          </div>
        </fieldset>
        <fieldset class="config-group">
          <legend class="sr-only">同名文件</legend>
          <div class="config-group-fields config-group-fields-single">
            <OutputConflictPolicyField />
          </div>
        </fieldset>
      </AdvancedSettingsPanel>
    </section>

    <div class="video-workspace-content" @click="configExpanded = false">
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
        <p class="text-lg font-semibold">
          {{ dragging ? '松开即可添加文件' : '拖入音频或视频文件' }}
        </p>
        <p class="mt-1 text-sm text-muted-foreground">
          支持常见音频格式，也可以直接从 MP4、MOV、MKV 等视频中提取音轨。
        </p>
        <Button class="mt-5" @click="chooseFiles">选择音频或视频</Button>
      </div>
    </div>
  </div>
</template>
