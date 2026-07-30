<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { FolderPlus, Images, Play, Plus, SlidersHorizontal, UploadCloud } from '@lucide/vue'
import type {
  CreateTasksRequest,
  ImageCompressionMode,
  ImageFormat,
  ImageInputFile,
  ImageMetadataMode,
  ImageOptions,
  ImageResizeMode
} from '../../../shared/types'
import { useAppStore } from '../stores/app'
import { fileName } from '../lib/utils'
import Button from '../components/ui/Button.vue'
import CurrentBatchTable from '../components/CurrentBatchTable.vue'
import OutputLocationControls from '../components/OutputLocationControls.vue'
import OutputConflictPolicyField from '../components/OutputConflictPolicyField.vue'
import OutputSuffixField from '../components/OutputSuffixField.vue'
import SourceOverwriteWarning from '../components/SourceOverwriteWarning.vue'
import ToggleSwitch from '../components/ui/ToggleSwitch.vue'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import AdvancedSettingsPanel from '../components/ui/AdvancedSettingsPanel.vue'
import AnimatedChevron from '../components/ui/AnimatedChevron.vue'
import DropFollowEffect from '../components/ui/DropFollowEffect.vue'

const store = useAppStore()
const configExpanded = ref(false)
const dragging = ref(false)
const starting = ref(false)
const pendingInputs = computed<ImageInputFile[]>({
  get: () => store.pendingImageInputs,
  set: (value) => (store.pendingImageInputs = value)
})
const compressionModeOptions = [
  { value: 'quality', label: '质量' },
  { value: 'targetSize', label: '目标大小' }
]
const resizeModeOptions = [
  { value: 'source', label: '原始' },
  { value: 'width', label: '宽度' },
  { value: 'height', label: '高度' },
  { value: 'percentage', label: '百分比' }
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
    label: '仅保留色彩',
    title: '尽可能保留色彩配置（推荐）',
    ariaLabel: '仅保留色彩配置，推荐'
  },
  {
    value: 'strip',
    label: '全部移除',
    title: '移除全部元数据',
    ariaLabel: '移除全部元数据'
  },
  {
    value: 'all',
    label: '尽量全部保留',
    title: '尽可能保留全部元数据',
    ariaLabel: '尽可能保留全部元数据'
  }
]

const imageTasks = computed(() => store.currentBatchTasks.image)
const pendingTableItems = computed(() =>
  pendingInputs.value.map((input) => ({
    path: input.path,
    label: inputLabel(input)
  }))
)
const formatLabel = computed(() => {
  const format = store.settings?.image.format
  return format === 'original' ? '保持原格式' : (format?.toUpperCase() ?? '')
})
const compressionLabel = computed(() => {
  const image = store.settings?.image
  if (!image) return ''
  return image.compressionMode === 'quality'
    ? `质量 ${image.quality}`
    : `不超过 ${image.targetSizeKb} KB`
})
const resizeLabel = computed(() => {
  const image = store.settings?.image
  if (!image || image.resizeMode === 'source') return '原始尺寸'
  if (image.resizeMode === 'width') return `宽 ${image.width}px`
  if (image.resizeMode === 'height') return `高 ${image.height}px`
  return `${image.percentage}%`
})
const activePresetId = computed(() => {
  if (!store.settings) return 'custom'
  return (
    store.settings.imagePresets.find((preset) =>
      imageOptionsEqual(preset.options, store.settings!.image)
    )?.id ?? 'custom'
  )
})
const activePresetName = computed(
  () =>
    store.settings?.imagePresets.find((preset) => preset.id === activePresetId.value)?.name ??
    '自定义'
)

function imageOptionsEqual(left: ImageOptions, right: ImageOptions): boolean {
  return (
    left.compressionMode === right.compressionMode &&
    left.quality === right.quality &&
    left.targetSizeKb === right.targetSizeKb &&
    left.resizeMode === right.resizeMode &&
    left.width === right.width &&
    left.height === right.height &&
    left.percentage === right.percentage &&
    left.allowEnlargement === right.allowEnlargement &&
    left.format === right.format &&
    left.preserveStructure === right.preserveStructure &&
    left.metadataMode === right.metadataMode
  )
}

function applyPreset(event: Event): void {
  if (!store.settings) return
  const id = (event.target as HTMLSelectElement).value
  const preset = store.settings.imagePresets.find((item) => item.id === id)
  if (preset) void store.updateSettings({ image: { ...preset.options } })
}

function updateImage(patch: Partial<ImageOptions>): void {
  if (!store.settings) return
  void store.updateSettings({ image: { ...store.settings.image, ...patch } })
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
  for (const input of inputs) combined.set(input.path, input)
  if (combined.size > 500) {
    store.errorMessage = '单次最多添加 500 张图片'
    return
  }
  pendingInputs.value = [...combined.values()]
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
    sources: pendingInputs.value.map((input) => ({ ...input })),
    outputMode: settings.outputMode,
    outputDirectory: settings.outputDirectory,
    outputSuffix: settings.outputSuffix,
    outputNameTemplate: settings.outputNameTemplate,
    outputConflictPolicy: settings.outputConflictPolicy,
    presetName: activePresetName.value,
    options: { ...settings.image }
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
          <span class="shrink-0 text-sm font-semibold">图片设置</span>
          <Button
            class="config-expand-toggle"
            variant="ghost"
            size="sm"
            :aria-expanded="configExpanded"
            aria-controls="image-advanced-settings"
            @click="configExpanded = !configExpanded"
          >
            {{ configExpanded ? '收起设置' : '高级设置' }}
            <AnimatedChevron :expanded="configExpanded" />
          </Button>
          <span class="truncate text-xs text-muted-foreground">
            {{ formatLabel }} · {{ compressionLabel }} · {{ resizeLabel }}
          </span>
        </div>
        <div class="video-config-actions">
          <label class="preset-picker">
            <span class="sr-only">图片预设</span>
            <select :value="activePresetId" aria-label="图片预设" @change="applyPreset">
              <option v-if="activePresetId === 'custom'" value="custom" disabled>
                预设：自定义参数
              </option>
              <option
                v-for="preset in store.settings.imagePresets"
                :key="preset.id"
                :value="preset.id"
              >
                预设：{{ preset.name }}
              </option>
            </select>
          </label>
          <OutputLocationControls />
          <SourceOverwriteWarning />
          <Button :disabled="pendingInputs.length === 0 || starting" @click="startProcessing">
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
          <div class="config-group-fields">
            <SegmentedControl
              label="压缩模式"
              :model-value="store.settings.image.compressionMode"
              :options="compressionModeOptions"
              @update:model-value="updateImage({ compressionMode: $event as ImageCompressionMode })"
            />
            <label class="compact-field">
              <span>{{
                store.settings.image.compressionMode === 'quality' ? '图片质量' : '目标大小'
              }}</span>
              <div class="number-field">
                <input
                  v-if="store.settings.image.compressionMode === 'quality'"
                  :value="store.settings.image.quality"
                  type="number"
                  min="1"
                  max="100"
                  @change="
                    updateImage({ quality: Number(($event.target as HTMLInputElement).value) })
                  "
                />
                <input
                  v-else
                  :value="store.settings.image.targetSizeKb"
                  type="number"
                  min="1"
                  max="100000"
                  @change="
                    updateImage({ targetSizeKb: Number(($event.target as HTMLInputElement).value) })
                  "
                />
                <span>{{
                  store.settings.image.compressionMode === 'quality' ? '/ 100' : 'KB'
                }}</span>
              </div>
            </label>
          </div>
        </fieldset>

        <fieldset class="config-group">
          <legend class="sr-only">尺寸</legend>
          <div class="config-group-fields">
            <SegmentedControl
              label="调整方式"
              :model-value="store.settings.image.resizeMode"
              :options="resizeModeOptions"
              @update:model-value="updateImage({ resizeMode: $event as ImageResizeMode })"
            />
            <label
              class="compact-field"
              :class="{ 'opacity-45': store.settings.image.resizeMode === 'source' }"
            >
              <span>尺寸参数</span>
              <div class="number-field">
                <input
                  v-if="store.settings.image.resizeMode === 'width'"
                  :value="store.settings.image.width"
                  type="number"
                  min="1"
                  max="32768"
                  @change="
                    updateImage({ width: Number(($event.target as HTMLInputElement).value) })
                  "
                />
                <input
                  v-else-if="store.settings.image.resizeMode === 'height'"
                  :value="store.settings.image.height"
                  type="number"
                  min="1"
                  max="32768"
                  @change="
                    updateImage({ height: Number(($event.target as HTMLInputElement).value) })
                  "
                />
                <input
                  v-else-if="store.settings.image.resizeMode === 'percentage'"
                  :value="store.settings.image.percentage"
                  type="number"
                  min="1"
                  max="1000"
                  @change="
                    updateImage({ percentage: Number(($event.target as HTMLInputElement).value) })
                  "
                />
                <input v-else value="无需设置" disabled />
                <span v-if="['width', 'height'].includes(store.settings.image.resizeMode)">px</span>
                <span v-else-if="store.settings.image.resizeMode === 'percentage'">%</span>
              </div>
            </label>
          </div>
        </fieldset>

        <fieldset class="config-group">
          <legend class="sr-only">输出</legend>
          <div class="config-group-fields config-group-fields-single">
            <SegmentedControl
              label="输出格式"
              :model-value="store.settings.image.format"
              :options="imageFormatOptions"
              @update:model-value="updateImage({ format: $event as ImageFormat })"
            />
          </div>
        </fieldset>
      </div>

      <AdvancedSettingsPanel
        id="image-advanced-settings"
        :open="configExpanded"
        class="video-config-expanded image-config-expanded"
      >
        <fieldset class="config-group">
          <legend class="sr-only">输出文件</legend>
          <div class="config-group-fields">
            <OutputSuffixField />
            <OutputConflictPolicyField />
          </div>
        </fieldset>
        <fieldset class="config-group">
          <legend class="sr-only">缩放行为</legend>
          <div class="config-group-fields">
            <ToggleSwitch
              label="较小图片"
              :model-value="store.settings.image.allowEnlargement"
              enabled-text="允许放大"
              disabled-text="不放大"
              @update:model-value="updateImage({ allowEnlargement: $event })"
            />
            <ToggleSwitch
              label="目录结构"
              :model-value="store.settings.image.preserveStructure"
              enabled-text="保留层级"
              disabled-text="合并输出"
              @update:model-value="updateImage({ preserveStructure: $event })"
            />
          </div>
        </fieldset>
        <fieldset class="config-group">
          <legend class="sr-only">元数据</legend>
          <div class="config-group-fields config-group-fields-single">
            <SegmentedControl
              label="元数据"
              :model-value="store.settings.image.metadataMode"
              :options="metadataModeOptions"
              @update:model-value="updateImage({ metadataMode: $event as ImageMetadataMode })"
            />
          </div>
        </fieldset>
      </AdvancedSettingsPanel>
    </section>

    <div class="video-workspace-content" @click="configExpanded = false">
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
