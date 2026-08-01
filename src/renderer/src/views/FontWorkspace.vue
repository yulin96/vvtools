<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { FileType, Play, Plus, SlidersHorizontal, UploadCloud } from '@lucide/vue'
import type {
  CreateTasksRequest,
  FontFormat,
  FontOperation,
  FontOptions
} from '../../../shared/types'
import { useAppStore } from '../stores/app'
import Button from '../components/ui/Button.vue'
import CurrentBatchTable from '../components/CurrentBatchTable.vue'
import DropFollowEffect from '../components/ui/DropFollowEffect.vue'
import OutputLocationControls from '../components/OutputLocationControls.vue'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import SourceOverwriteWarning from '../components/SourceOverwriteWarning.vue'

const store = useAppStore()
const dragging = ref(false)
const starting = ref(false)
const pendingPaths = computed<string[]>({
  get: () => store.pendingFontPaths,
  set: (value) => (store.pendingFontPaths = value)
})
const fontTasks = computed(() => store.currentBatchTasks.font)
const pendingTableItems = computed(() => pendingPaths.value.map((path) => ({ path })))
const mode = ref<FontOperation>('convert')
const modeOptions = [
  { value: 'convert', label: '字体转换' },
  { value: 'splitCollection', label: '字体拆分' },
  { value: 'variableStatic', label: '可变字体' },
  { value: 'subset', label: '字体压缩' }
]
const formatOptions = [
  { value: 'ttf', label: 'TTF' },
  { value: 'otf', label: 'OTF' },
  { value: 'woff', label: 'WOFF' },
  { value: 'woff2', label: 'WOFF2' }
]
const variableModeOptions = [
  { value: 'named', label: '命名实例' },
  { value: 'default', label: '默认实例' }
]
const supportedExtensions = new Set(['ttf', 'otf', 'woff', 'woff2', 'ttc', 'otc'])

const operation = computed(() => store.settings?.font.lastOptions.operation ?? mode.value)
const summary = computed(() => {
  const options = store.settings?.font.lastOptions
  if (!options) return ''
  return `${options.outputFormat.toUpperCase()} · ${modeOptions.find((item) => item.value === options.operation)?.label ?? ''}`
})
const emptyStateCopy = computed(() => {
  if (operation.value === 'splitCollection') {
    return {
      title: '拖入需要拆分的字体集合',
      description: '将 TTC 或 OTC 集合中的每个字体分别输出为独立文件。'
    }
  }
  if (operation.value === 'variableStatic') {
    return {
      title: '拖入需要静态化的可变字体',
      description: '按命名实例或默认实例，将可变字体导出为普通静态字体。'
    }
  }
  if (operation.value === 'subset') {
    return {
      title: '拖入需要压缩的字体',
      description: '仅保留输入文本或 TXT 文件包含的字符，减少字体文件体积。'
    }
  }
  return {
    title: '拖入需要转换格式的字体',
    description: '在 TTF、OTF、WOFF 和 WOFF2 之间转换字体格式。'
  }
})

function updateFont(patch: Partial<FontOptions>): void {
  if (!store.settings) return
  void store.updateSettings({
    font: { lastOptions: { ...store.settings.font.lastOptions, ...patch } }
  })
}

function setMode(value: FontOperation): void {
  mode.value = value
  updateFont({ operation: value })
}

function stageFiles(paths: string[]): void {
  const supported = paths.filter((path) =>
    supportedExtensions.has(path.split('.').pop()?.toLowerCase() || '')
  )
  if (supported.length === 0 && paths.length > 0) {
    store.errorMessage = '没有可导入的字体文件'
    return
  }
  if (pendingPaths.value.length === 0) store.prepareCurrentBatch('font')
  const combined = [...new Set([...pendingPaths.value, ...supported])]
  if (combined.length > 500) {
    store.errorMessage = '单次最多添加 500 个文件'
    return
  }
  pendingPaths.value = combined
}

async function chooseFiles(): Promise<void> {
  try {
    stageFiles(await window.api.selectFiles('font'))
  } catch (error) {
    store.errorMessage = error instanceof Error ? error.message : String(error)
  }
}

async function chooseTextFile(): Promise<void> {
  try {
    const path = await window.api.selectTextFile()
    if (path) updateFont({ subsetTextFile: path, subsetText: '' })
  } catch (error) {
    store.errorMessage = error instanceof Error ? error.message : String(error)
  }
}

function withVariable(template: string, variable: '{index}' | '{instance}'): string {
  return template.includes(variable)
    ? template
    : `${template}-${variable === '{index}' ? 'font-{index}' : '{instance}'}`
}

async function startProcessing(): Promise<void> {
  if (!store.settings || pendingPaths.value.length === 0 || starting.value) return
  const settings = store.settings
  const selectedOperation = operation.value
  const options = { ...settings.font.lastOptions, operation: selectedOperation }
  const request: CreateTasksRequest = {
    kind: 'font',
    sourcePaths: [...pendingPaths.value],
    outputMode: settings.common.outputMode,
    outputDirectory: settings.common.outputDirectory,
    outputSuffix: settings.common.outputSuffix,
    outputNameTemplate:
      selectedOperation === 'splitCollection'
        ? withVariable(settings.common.outputNameTemplate, '{index}')
        : selectedOperation === 'variableStatic'
          ? withVariable(settings.common.outputNameTemplate, '{instance}')
          : settings.common.outputNameTemplate,
    outputConflictPolicy: settings.common.outputConflictPolicy,
    presetName: modeOptions.find((item) => item.value === selectedOperation)?.label ?? '字体处理',
    options
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
    <section v-if="store.settings" class="video-config-panel" aria-label="字体处理设置">
      <div class="video-config-heading">
        <div class="config-heading-main">
          <SlidersHorizontal class="size-4 shrink-0 text-signal-strong" />
          <span class="shrink-0 text-sm font-semibold">字体处理</span>
          <span class="config-summary truncate text-xs text-muted-foreground">{{ summary }}</span>
        </div>
        <div class="video-config-actions">
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

      <div class="workflow-mode-row">
        <SegmentedControl
          class="workflow-mode-control font-operation-segments"
          label="字体处理方式"
          :model-value="operation"
          :options="modeOptions"
          hide-label
          @update:model-value="setMode($event as FontOperation)"
        />
      </div>

      <div class="image-config-primary font-config-primary">
        <fieldset class="config-group">
          <legend class="sr-only">输出格式</legend>
          <div class="config-group-fields">
            <SegmentedControl
              label="输出格式"
              :model-value="store.settings.font.lastOptions.outputFormat"
              :options="formatOptions"
              @update:model-value="updateFont({ outputFormat: $event as FontFormat })"
            />
            <SegmentedControl
              v-if="operation === 'variableStatic'"
              label="实例"
              :model-value="store.settings.font.lastOptions.variableInstanceMode"
              :options="variableModeOptions"
              @update:model-value="
                updateFont({ variableInstanceMode: $event as 'named' | 'default' })
              "
            />
          </div>
        </fieldset>

        <fieldset v-if="operation === 'subset'" class="config-group">
          <legend class="sr-only">字体子集文本</legend>
          <div class="font-subset-fields">
            <label class="font-subset-textarea">
              <span>保留字符</span>
              <textarea
                :value="store.settings.font.lastOptions.subsetText"
                rows="2"
                placeholder="直接输入字符，或选择 TXT 文本文件"
                @change="
                  updateFont({
                    subsetText: ($event.target as HTMLTextAreaElement).value,
                    subsetTextFile: ''
                  })
                "
              />
            </label>
            <Button variant="secondary" size="sm" @click="chooseTextFile">选择 TXT 文件</Button>
            <span
              v-if="store.settings.font.lastOptions.subsetTextFile"
              class="truncate text-xs text-muted-foreground"
            >
              {{ store.settings.font.lastOptions.subsetTextFile }}
            </span>
          </div>
        </fieldset>
      </div>
    </section>

    <div class="video-workspace-content">
      <CurrentBatchTable
        v-if="pendingPaths.length || fontTasks.length"
        kind="font"
        :pending-items="pendingTableItems"
        :tasks="fontTasks"
        @remove-pending="pendingPaths = pendingPaths.filter((item) => item !== $event)"
      >
        <template #actions>
          <div class="flex items-center gap-1">
            <Button variant="secondary" size="sm" @click="chooseFiles">
              <Plus class="size-3.5" />添加字体
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
          <FileType v-else class="size-8" />
        </div>
        <p class="text-lg font-semibold">
          {{ dragging ? '松开即可添加字体' : emptyStateCopy.title }}
        </p>
        <p class="mt-1 text-sm text-muted-foreground">{{ emptyStateCopy.description }}</p>
        <Button class="mt-5" @click="chooseFiles">选择字体文件</Button>
      </div>
    </div>
  </div>
</template>
