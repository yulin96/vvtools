<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { FolderPlus, Images, Play, Plus, SlidersHorizontal, UploadCloud } from '@lucide/vue'
import type {
  CreateTasksRequest,
  ImageCompressionMode,
  ImageFormat,
  ImageInputFile,
  ImageOptions,
  ImagePresetOptions,
  ImageResizeMode
} from '../../../shared/types'
import {
  DEFAULT_IMAGE_OPTIONS,
  DEFAULT_IMAGE_PRESETS,
  getImagePresetOptions
} from '../../../shared/constants'
import { useAppStore } from '../stores/app'
import { fileName } from '../lib/utils'
import Button from '../components/ui/Button.vue'
import CurrentBatchTable from '../components/CurrentBatchTable.vue'
import OutputLocationControls from '../components/OutputLocationControls.vue'
import SourceOverwriteWarning from '../components/SourceOverwriteWarning.vue'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import DropFollowEffect from '../components/ui/DropFollowEffect.vue'
import AdvancedSettingsPanel from '../components/ui/AdvancedSettingsPanel.vue'
import AnimatedChevron from '../components/ui/AnimatedChevron.vue'
import ToggleSwitch from '../components/ui/ToggleSwitch.vue'
import { takeRoutedDrop } from '../lib/media-drop'

const store = useAppStore()
const configExpanded = ref(false)
const dragging = ref(false)
const starting = ref(false)
const pendingInputs = computed<ImageInputFile[]>({
  get: () => store.pendingImageInputs,
  set: (value) => (store.pendingImageInputs = value)
})
const compressionModeOptions = [
  { value: 'quality', label: '按画质' },
  { value: 'targetSize', label: '按文件大小' }
]
const resizeModeOptions = [
  { value: 'source', label: '原尺寸', title: '保持原始尺寸', ariaLabel: '保持原始尺寸' },
  { value: 'width', label: '宽度', title: '指定宽度', ariaLabel: '指定宽度' },
  { value: 'height', label: '高度', title: '指定高度', ariaLabel: '指定高度' },
  { value: 'percentage', label: '缩放', title: '按比例缩放', ariaLabel: '按比例缩放' }
]
const imageFormatOptions = [
  { value: 'original', label: '原格式' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' }
]
const metadataModeOptions = [
  {
    value: 'colorProfile',
    label: '保留色彩',
    title: '仅保留色彩配置',
    ariaLabel: '仅保留色彩配置'
  },
  {
    value: 'strip',
    label: '全部移除',
    title: '移除所有附加信息，文件可能更小',
    ariaLabel: '移除所有附加信息，文件可能更小'
  },
  {
    value: 'all',
    label: '全部保留',
    title: '尽量保留所有附加信息',
    ariaLabel: '尽量保留所有附加信息'
  }
]
const imagePresetOptions = [
  { value: 'custom', label: '自定义' },
  ...DEFAULT_IMAGE_PRESETS.map((preset) => ({ value: preset.id, label: preset.name }))
]
const imageTasks = computed(() => store.currentBatchTasks.image)
const pendingTableItems = computed(() =>
  pendingInputs.value.map((input) => ({
    path: input.path,
    label: inputLabel(input),
    sourceSize: input.sourceSize,
    spec: input.width && input.height ? `${input.width} × ${input.height}` : undefined,
    metadataLoading: input.metadataStatus === 'loading',
    metadataError: input.metadataError
  }))
)
const metadataQueue: string[] = []
const queuedMetadataPaths = new Set<string>()
let metadataWorkerCount = 0
const metadataConcurrency = 4
const formatLabel = computed(() => {
  const format = store.settings?.image.lastOptions.format
  return format === 'original' ? '保持原格式' : (format?.toUpperCase() ?? '')
})
const compressionLabel = computed(() => {
  const image = store.settings?.image.lastOptions
  if (!image) return ''
  return image.compressionMode === 'quality'
    ? `质量 ${image.quality}`
    : `不超过 ${image.targetSizeKb} KB`
})
const resizeLabel = computed(() => {
  const image = store.settings?.image.lastOptions
  if (!image || image.resizeMode === 'source') return '原始尺寸'
  if (image.resizeMode === 'width') return `宽 ${image.width}px`
  if (image.resizeMode === 'height') return `高 ${image.height}px`
  return `${image.percentage}%`
})
const activePresetId = computed(() => {
  if (!store.settings) return 'custom'
  return (
    DEFAULT_IMAGE_PRESETS.find((preset) =>
      imageOptionsEqual(preset.options, store.settings!.image.lastOptions)
    )?.id ?? 'custom'
  )
})
const activePresetName = computed(
  () => DEFAULT_IMAGE_PRESETS.find((preset) => preset.id === activePresetId.value)?.name ?? '自定义'
)

function imageOptionsEqual(left: ImagePresetOptions, right: ImageOptions): boolean {
  return (
    left.compressionMode === right.compressionMode &&
    left.quality === right.quality &&
    left.targetSizeKb === right.targetSizeKb &&
    left.resizeMode === right.resizeMode &&
    left.width === right.width &&
    left.height === right.height &&
    left.percentage === right.percentage &&
    left.format === right.format
  )
}

function resizeValueLabel(mode: ImageResizeMode): string {
  if (mode === 'width') return '目标宽度'
  if (mode === 'height') return '目标高度'
  if (mode === 'percentage') return '缩放比例'
  return '目标尺寸'
}

function applyPreset(value: string | number): void {
  if (!store.settings) return
  const id = String(value)
  const options =
    id === 'custom'
      ? getImagePresetOptions(DEFAULT_IMAGE_OPTIONS)
      : DEFAULT_IMAGE_PRESETS.find((preset) => preset.id === id)?.options
  if (options) {
    void store.updateSettings({
      image: {
        lastOptions: { ...store.settings.image.lastOptions, ...options }
      }
    })
  }
}

function updateImage(patch: Partial<ImageOptions>): void {
  if (!store.settings) return
  void store.updateSettings({
    image: {
      lastOptions: { ...store.settings.image.lastOptions, ...patch }
    }
  })
}

function inputLabel(input: ImageInputFile): string {
  return input.relativeDirectory
    ? `${input.relativeDirectory}/${fileName(input.path)}`
    : fileName(input.path)
}

function stageInputs(inputs: ImageInputFile[]): void {
  if (inputs.length === 0) return
  if (pendingInputs.value.length === 0) store.prepareCurrentBatch('image')
  const combined = new Map(pendingInputs.value.map((input) => [input.path, input]))
  const pathsToInspect: string[] = []
  for (const input of inputs) {
    const existing = combined.get(input.path)
    if (existing) continue
    combined.set(input.path, { ...input, metadataStatus: 'loading' })
    pathsToInspect.push(input.path)
  }
  if (combined.size > 500) {
    store.errorMessage = '单次最多添加 500 张图片'
    return
  }
  pendingInputs.value = [...combined.values()]
  queueImageMetadata(pathsToInspect)
}

function queueImageMetadata(paths: string[]): void {
  for (const path of paths) {
    if (queuedMetadataPaths.has(path)) continue
    queuedMetadataPaths.add(path)
    metadataQueue.push(path)
  }
  while (metadataWorkerCount < metadataConcurrency && metadataQueue.length > 0) {
    metadataWorkerCount += 1
    void runMetadataWorker()
  }
}

async function runMetadataWorker(): Promise<void> {
  try {
    while (metadataQueue.length > 0) {
      const path = metadataQueue.shift()
      if (!path) continue
      try {
        const metadata = await window.api.inspectImageInput(path)
        pendingInputs.value = pendingInputs.value.map((input) =>
          input.path === path
            ? { ...input, ...metadata, metadataStatus: 'ready', metadataError: undefined }
            : input
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        pendingInputs.value = pendingInputs.value.map((input) =>
          input.path === path
            ? { ...input, metadataStatus: 'error', metadataError: message }
            : input
        )
      } finally {
        queuedMetadataPaths.delete(path)
      }
    }
  } finally {
    metadataWorkerCount -= 1
    if (metadataQueue.length > 0) queueImageMetadata([])
  }
}

function reportError(error: unknown): void {
  store.errorMessage = error instanceof Error ? error.message : String(error)
}

async function chooseFiles(): Promise<void> {
  try {
    const paths = await window.api.selectFiles('image')
    stageInputs(paths.map((path) => ({ path, relativeDirectory: '' })))
  } catch (error) {
    reportError(error)
  }
}

async function chooseDirectory(): Promise<void> {
  try {
    const inputs = await window.api.selectImageDirectory()
    if (inputs.length === 0) return
    stageInputs(inputs)
  } catch (error) {
    reportError(error)
  }
}

async function startProcessing(): Promise<void> {
  if (!store.settings || pendingInputs.value.length === 0 || starting.value) return
  const settings = store.settings
  const request: CreateTasksRequest = {
    kind: 'image',
    sources: pendingInputs.value.map(({ path, relativeDirectory }) => ({
      path,
      relativeDirectory
    })),
    outputMode: settings.common.outputMode,
    outputDirectory: settings.common.outputDirectory,
    outputSuffix: settings.common.outputSuffix,
    outputNameTemplate: settings.common.outputNameTemplate,
    outputConflictPolicy: settings.common.outputConflictPolicy,
    presetName: activePresetName.value,
    options: { ...settings.image.lastOptions }
  }
  starting.value = true
  try {
    const result = await store.submitTasks(request)
    if (!result) return
    const handledPaths = new Set(result.handledPaths)
    pendingInputs.value = pendingInputs.value.filter((input) => !handledPaths.has(input.path))
  } finally {
    starting.value = false
  }
}

function removePending(path: string): void {
  pendingInputs.value = pendingInputs.value.filter((input) => input.path !== path)
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

async function handleDrop(event: DragEvent): Promise<void> {
  if (!hasFiles(event)) return
  event.preventDefault()
  dragging.value = false
  const paths = [...(event.dataTransfer?.files || [])].map((file) =>
    window.api.getDroppedFilePath(file)
  )
  try {
    const inputs = await window.api.expandImageInputs(paths)
    if (inputs.length === 0 && paths.length > 0) {
      store.errorMessage = '没有可导入的图片文件'
      return
    }
    stageInputs(inputs)
  } catch (error) {
    reportError(error)
  }
}

onMounted(() => {
  window.addEventListener('dragover', handleDragOver, true)
  window.addEventListener('dragleave', handleDragLeave, true)
  window.addEventListener('drop', handleDrop, true)
  const routedPaths = takeRoutedDrop('/image')
  if (routedPaths.length > 0) {
    void window.api.expandImageInputs(routedPaths).then(stageInputs).catch(reportError)
  }
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
    <section v-if="store.settings" class="video-config-panel" aria-label="图片处理设置">
      <div class="video-config-heading">
        <div class="config-heading-main">
          <SlidersHorizontal class="size-4 shrink-0 text-signal-strong" />
          <span class="shrink-0 text-sm font-semibold">图片处理设置</span>
          <Button
            class="config-expand-toggle"
            variant="ghost"
            size="sm"
            :aria-expanded="configExpanded"
            aria-controls="image-advanced-settings"
            @click="configExpanded = !configExpanded"
          >
            {{ configExpanded ? '收起设置' : '更多设置' }}
            <AnimatedChevron :expanded="configExpanded" />
          </Button>
          <span class="config-summary truncate text-xs text-muted-foreground">
            {{ formatLabel }} · {{ compressionLabel }} · {{ resizeLabel }}
          </span>
        </div>
        <div class="video-config-actions">
          <SegmentedControl
            class="preset-segments image-preset-segments"
            label="图片处理方案"
            :model-value="activePresetId"
            :options="imagePresetOptions"
            hide-label
            @update:model-value="applyPreset"
          />
          <OutputLocationControls />
          <SourceOverwriteWarning />
          <Button
            size="sm"
            :disabled="pendingInputs.length === 0 || starting"
            @click="startProcessing"
          >
            <Play class="size-4" />
            {{
              starting
                ? '正在开始…'
                : `开始处理${pendingInputs.length ? ` (${pendingInputs.length})` : ''}`
            }}
          </Button>
        </div>
      </div>

      <div class="image-config-primary">
        <fieldset class="config-group">
          <legend class="sr-only">压缩</legend>
          <div class="config-group-fields config-group-fields-switch-input">
            <SegmentedControl
              label="压缩目标"
              :model-value="store.settings.image.lastOptions.compressionMode"
              :options="compressionModeOptions"
              @update:model-value="updateImage({ compressionMode: $event as ImageCompressionMode })"
            />
            <label class="compact-field">
              <span>{{
                store.settings.image.lastOptions.compressionMode === 'quality'
                  ? '输出画质'
                  : '单张大小上限'
              }}</span>
              <div class="number-field">
                <input
                  v-if="store.settings.image.lastOptions.compressionMode === 'quality'"
                  :value="store.settings.image.lastOptions.quality"
                  type="number"
                  min="1"
                  max="100"
                  @change="
                    updateImage({ quality: Number(($event.target as HTMLInputElement).value) })
                  "
                />
                <input
                  v-else
                  :value="store.settings.image.lastOptions.targetSizeKb"
                  type="number"
                  min="1"
                  max="100000"
                  @change="
                    updateImage({ targetSizeKb: Number(($event.target as HTMLInputElement).value) })
                  "
                />
                <span>{{
                  store.settings.image.lastOptions.compressionMode === 'quality' ? '/ 100' : 'KB'
                }}</span>
              </div>
            </label>
          </div>
        </fieldset>

        <fieldset class="config-group">
          <legend class="sr-only">尺寸</legend>
          <div class="config-group-fields config-group-fields-switch-input">
            <SegmentedControl
              class="image-resize-segments"
              label="图片尺寸"
              :model-value="store.settings.image.lastOptions.resizeMode"
              :options="resizeModeOptions"
              @update:model-value="updateImage({ resizeMode: $event as ImageResizeMode })"
            />
            <label
              class="compact-field"
              :class="{ 'opacity-45': store.settings.image.lastOptions.resizeMode === 'source' }"
            >
              <span>{{ resizeValueLabel(store.settings.image.lastOptions.resizeMode) }}</span>
              <div class="number-field">
                <input
                  v-if="store.settings.image.lastOptions.resizeMode === 'width'"
                  :value="store.settings.image.lastOptions.width"
                  type="number"
                  min="1"
                  max="32768"
                  @change="
                    updateImage({ width: Number(($event.target as HTMLInputElement).value) })
                  "
                />
                <input
                  v-else-if="store.settings.image.lastOptions.resizeMode === 'height'"
                  :value="store.settings.image.lastOptions.height"
                  type="number"
                  min="1"
                  max="32768"
                  @change="
                    updateImage({ height: Number(($event.target as HTMLInputElement).value) })
                  "
                />
                <input
                  v-else-if="store.settings.image.lastOptions.resizeMode === 'percentage'"
                  :value="store.settings.image.lastOptions.percentage"
                  type="number"
                  min="1"
                  max="1000"
                  @change="
                    updateImage({ percentage: Number(($event.target as HTMLInputElement).value) })
                  "
                />
                <input v-else value="无需设置" disabled />
                <span
                  v-if="['width', 'height'].includes(store.settings.image.lastOptions.resizeMode)"
                  >px</span
                >
                <span v-else-if="store.settings.image.lastOptions.resizeMode === 'percentage'"
                  >%</span
                >
              </div>
            </label>
          </div>
        </fieldset>

        <fieldset class="config-group">
          <legend class="sr-only">输出</legend>
          <div class="config-group-fields config-group-fields-single">
            <SegmentedControl
              label="输出格式"
              :model-value="store.settings.image.lastOptions.format"
              :options="imageFormatOptions"
              @update:model-value="updateImage({ format: $event as ImageFormat })"
            />
          </div>
        </fieldset>
      </div>

      <AdvancedSettingsPanel
        id="image-advanced-settings"
        :open="configExpanded"
        class="video-config-expanded"
      >
        <fieldset class="config-group advanced-settings-list image-advanced-settings-list">
          <legend class="sr-only">处理偏好</legend>
          <div class="config-group-fields">
            <SegmentedControl
              label="附加信息（元数据）"
              :model-value="store.settings.image.lastOptions.metadataMode"
              :options="metadataModeOptions"
              @update:model-value="
                updateImage({ metadataMode: $event as ImageOptions['metadataMode'] })
              "
            />
            <ToggleSwitch
              label="文件夹层级"
              :model-value="store.settings.image.lastOptions.preserveStructure"
              enabled-text="保留原文件夹"
              disabled-text="全部放在一起"
              @update:model-value="updateImage({ preserveStructure: $event })"
            />
            <ToggleSwitch
              label="小图是否放大"
              :model-value="store.settings.image.lastOptions.allowEnlargement"
              enabled-text="放大到目标尺寸"
              disabled-text="保持原尺寸"
              @update:model-value="updateImage({ allowEnlargement: $event })"
            />
          </div>
        </fieldset>
      </AdvancedSettingsPanel>
    </section>

    <div class="video-workspace-content workspace-scroll-content" @click="configExpanded = false">
      <CurrentBatchTable
        v-if="pendingInputs.length || imageTasks.length"
        kind="image"
        :pending-items="pendingTableItems"
        :tasks="imageTasks"
        @remove-pending="removePending"
      >
        <template #actions>
          <div class="flex items-center gap-1">
            <Button variant="secondary" size="sm" @click="chooseFiles">
              <Plus class="size-3.5" />添加图片
            </Button>
            <Button variant="secondary" size="sm" @click="chooseDirectory">
              <FolderPlus class="size-3.5" />添加文件夹
            </Button>
            <Button
              v-if="pendingInputs.length"
              variant="ghost"
              size="sm"
              @click="pendingInputs = []"
            >
              清空待处理
            </Button>
          </div>
        </template>
      </CurrentBatchTable>

      <div v-else class="video-drop-prompt" :class="{ 'video-drop-prompt-active': dragging }">
        <div class="video-drop-icon">
          <UploadCloud v-if="dragging" class="size-8" />
          <Images v-else class="size-8" />
        </div>
        <p class="text-lg font-semibold">
          {{ dragging ? '松开即可添加图片或文件夹' : '拖入图片或文件夹' }}
        </p>
        <p class="mt-1 text-sm text-muted-foreground">
          文件会先加入待处理列表，不会立即开始。支持 JPG、PNG、WebP。
        </p>
        <div class="mt-5 flex items-center gap-2">
          <Button @click="chooseFiles">选择图片文件</Button>
          <Button variant="secondary" @click="chooseDirectory">选择文件夹</Button>
        </div>
      </div>
    </div>
  </div>
</template>
