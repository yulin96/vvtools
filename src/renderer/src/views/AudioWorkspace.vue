<script setup lang="ts">
import { computed } from 'vue'
import { Play, Plus, FolderInput } from '@lucide/vue'
import { AudioWorkspaceIcon } from '../lib/workspace-icons'
import type {
  AudioChannels,
  AudioFormat,
  AudioOptions,
  CreateTasksRequest
} from '../../../shared/types'
import { useAppStore } from '../stores/app'
import Button from '../components/ui/Button.vue'
import OutputLocationControls from '../components/OutputLocationControls.vue'
import OutputSuffixField from '../components/OutputSuffixField.vue'
import SourceOverwriteWarning from '../components/SourceOverwriteWarning.vue'
import CurrentBatchTable from '../components/CurrentBatchTable.vue'
import ToggleSwitch from '../components/ui/ToggleSwitch.vue'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import DropFollowEffect from '../components/ui/DropFollowEffect.vue'
import { useWorkspaceDrop } from '../composables/useWorkspaceDrop'
import { useTaskSubmission } from '../composables/useTaskSubmission'
import { settledBatchSourceItems } from '../lib/batch-sources'

const store = useAppStore()
const pendingPaths = computed<string[]>({
  get: () => store.pendingAudioPaths,
  set: (value) => (store.pendingAudioPaths = value)
})
const { starting, submit } = useTaskSubmission(pendingPaths, (path) => path)
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
const audioStartItems = computed(() => {
  if (pendingPaths.value.length > 0) {
    return pendingPaths.value.map((path) => ({ path, batchItemId: path }))
  }
  return settledBatchSourceItems(audioTasks.value)
})
const pendingTableItems = computed(() => pendingPaths.value.map((path) => ({ path })))
const formatLabel = computed(() => store.settings?.audio.lastOptions.format.toUpperCase() ?? '')
const bitrateLabel = computed(() => {
  const audio = store.settings?.audio.lastOptions
  if (!audio) return ''
  return ['wav', 'flac'].includes(audio.format) ? '无损编码' : `${audio.bitrateKbps} kbps`
})

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
  if (!store.settings || audioStartItems.value.length === 0 || starting.value) return
  const settings = store.settings
  const startItems = audioStartItems.value
  const request: CreateTasksRequest = {
    kind: 'audio',
    sourcePaths: startItems.map((item) => item.path),
    batchItemIds: startItems.map((item) => item.batchItemId),
    outputMode: settings.common.outputMode,
    outputDirectory: settings.common.outputDirectory,
    outputSuffix: settings.audio.outputSuffix,
    outputNameTemplate: settings.common.outputNameTemplate,
    outputConflictPolicy: settings.common.outputConflictPolicy,
    presetName: '音频处理',
    options: { ...settings.audio.lastOptions }
  }
  await submit(request)
}

const dragging = useWorkspaceDrop(stageFiles, { path: '/audio', receivePaths: stageFiles })
</script>

<template>
  <div class="video-drop-workspace" :class="{ 'video-drop-workspace-active': dragging }">
    <DropFollowEffect :active="dragging" />
    <section v-if="store.settings" class="video-config-panel" aria-label="音频处理设置">
      <div class="video-config-heading">
        <div class="config-heading-main">
          <span class="config-summary truncate text-xs text-muted-foreground">
            {{ formatLabel }} · {{ bitrateLabel }}
          </span>
        </div>
        <div class="video-config-actions">
          <OutputLocationControls />
          <div class="start-processing-actions">
            <SourceOverwriteWarning />
            <Button
              size="sm"
              :disabled="audioStartItems.length === 0 || starting"
              @click="startProcessing"
            >
              <Play class="size-4" />
              {{
                starting
                  ? '正在开始…'
                  : `开始处理${audioStartItems.length ? ` (${audioStartItems.length})` : ''}`
              }}
            </Button>
          </div>
        </div>
      </div>

      <div class="image-config-primary">
        <fieldset class="config-group">
          <legend class="sr-only">格式与质量</legend>
          <div class="config-group-fields">
            <SegmentedControl
              label="输出格式"
              :model-value="store.settings.audio.lastOptions.format"
              :options="audioFormatOptions"
              @update:model-value="updateAudio({ format: $event as AudioFormat })"
            />
            <label
              class="compact-field"
              :class="{
                'opacity-45': ['wav', 'flac'].includes(store.settings.audio.lastOptions.format)
              }"
            >
              <span>音频码率</span>
              <select
                :value="store.settings.audio.lastOptions.bitrateKbps"
                :disabled="['wav', 'flac'].includes(store.settings.audio.lastOptions.format)"
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
              label="输出声道"
              :model-value="store.settings.audio.lastOptions.channels"
              :options="channelOptions"
              @update:model-value="updateAudio({ channels: $event as AudioChannels })"
            />
            <ToggleSwitch
              label="统一音量"
              :model-value="store.settings.audio.lastOptions.normalizeLoudness"
              enabled-text="已开启"
              disabled-text="已关闭"
              @update:model-value="updateAudio({ normalizeLoudness: $event })"
            />
          </div>
        </fieldset>

        <fieldset class="config-group">
          <legend class="sr-only">输出命名</legend>
          <div class="config-group-fields config-group-fields-single">
            <OutputSuffixField kind="audio" />
          </div>
        </fieldset>
      </div>
    </section>

    <div class="video-workspace-content workspace-scroll-content">
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
          <FolderInput v-if="dragging" class="size-8" />
          <AudioWorkspaceIcon v-else class="size-8" />
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
