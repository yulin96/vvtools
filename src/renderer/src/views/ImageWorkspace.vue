<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ChevronDown,
  ChevronUp,
  FileImage,
  FolderPlus,
  Images,
  ListTodo,
  Play,
  Plus,
  SlidersHorizontal,
  Trash2,
  UploadCloud,
  X
} from '@lucide/vue'
import type {
  ImageCompressionMode,
  ImageFormat,
  ImageInputFile,
  ImageOptions,
  ImageResizeMode
} from '../../../shared/types'
import { useAppStore } from '../stores/app'
import { fileName } from '../lib/utils'
import Button from '../components/ui/Button.vue'
import TaskTable from '../components/TaskTable.vue'
import OutputControls from '../components/OutputControls.vue'
import OutputSuffixField from '../components/OutputSuffixField.vue'
import ToggleSwitch from '../components/ui/ToggleSwitch.vue'

const store = useAppStore()
const configExpanded = ref(false)
const dragging = ref(false)
const starting = ref(false)
const pendingInputs = ref<ImageInputFile[]>([])

const imageTasks = computed(() => store.tasks.filter((task) => task.kind === 'image').slice(-20))
const activeTaskCount = computed(
  () => imageTasks.value.filter((task) => ['pending', 'processing'].includes(task.status)).length
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
  const inputs = pendingInputs.value.map((input) => ({ ...input }))
  const settings = store.settings
  starting.value = true
  const created = await store.createTasks({
    kind: 'image',
    sources: inputs,
    outputMode: settings.outputMode,
    outputDirectory: settings.outputDirectory,
    outputSuffix: settings.outputSuffix,
    options: { ...settings.image }
  })
  if (created) {
    const startedPaths = new Set(inputs.map((input) => input.path))
    pendingInputs.value = pendingInputs.value.filter((input) => !startedPaths.has(input.path))
  }
  starting.value = false
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
    <section v-if="store.settings" class="video-config-panel" aria-label="图片处理设置">
      <div class="video-config-heading">
        <div class="config-heading-main">
          <SlidersHorizontal class="size-4 shrink-0 text-signal-strong" />
          <span class="shrink-0 text-sm font-semibold">图片设置</span>
          <span v-if="!configExpanded" class="truncate text-xs text-muted-foreground">
            {{ formatLabel }} · {{ compressionLabel }} · {{ resizeLabel }}
          </span>
          <Button
            variant="ghost"
            size="sm"
            :aria-expanded="configExpanded"
            aria-controls="image-advanced-settings"
            @click="configExpanded = !configExpanded"
          >
            {{ configExpanded ? '收起设置' : '高级设置' }}
            <component :is="configExpanded ? ChevronUp : ChevronDown" class="size-3.5" />
          </Button>
        </div>
        <div class="video-config-actions">
          <OutputControls />
          <Button :disabled="pendingInputs.length === 0 || starting" @click="startProcessing">
            <Play class="size-4" />
            {{
              starting
                ? '正在加入…'
                : `开始处理${pendingInputs.length ? ` (${pendingInputs.length})` : ''}`
            }}
          </Button>
        </div>
      </div>

      <div class="image-config-primary">
        <fieldset class="config-group">
          <legend>压缩</legend>
          <div class="config-group-fields">
            <label class="compact-field">
              <span>压缩模式</span>
              <select
                :value="store.settings.image.compressionMode"
                @change="
                  updateImage({
                    compressionMode: ($event.target as HTMLSelectElement)
                      .value as ImageCompressionMode
                  })
                "
              >
                <option value="quality">按图片质量</option>
                <option value="targetSize">按目标大小</option>
              </select>
            </label>
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
          <legend>尺寸</legend>
          <div class="config-group-fields">
            <label class="compact-field">
              <span>调整方式</span>
              <select
                :value="store.settings.image.resizeMode"
                @change="
                  updateImage({
                    resizeMode: ($event.target as HTMLSelectElement).value as ImageResizeMode
                  })
                "
              >
                <option value="source">保持原始尺寸</option>
                <option value="width">指定宽度</option>
                <option value="height">指定高度</option>
                <option value="percentage">按百分比</option>
              </select>
            </label>
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
          <legend>输出</legend>
          <div class="config-group-fields">
            <label class="compact-field">
              <span>输出格式</span>
              <select
                :value="store.settings.image.format"
                @change="
                  updateImage({ format: ($event.target as HTMLSelectElement).value as ImageFormat })
                "
              >
                <option value="original">保持原格式</option>
                <option value="jpeg">JPEG</option>
                <option value="png">PNG</option>
                <option value="webp">WebP</option>
              </select>
            </label>
            <ToggleSwitch
              label="目录结构"
              :model-value="store.settings.image.preserveStructure"
              enabled-text="保留原目录层级"
              disabled-text="合并到输出目录"
              @update:model-value="updateImage({ preserveStructure: $event })"
            />
          </div>
        </fieldset>
      </div>

      <div v-if="configExpanded" id="image-advanced-settings" class="video-config-expanded">
        <fieldset class="config-group">
          <legend>输出文件</legend>
          <div class="config-group-fields config-group-fields-single">
            <OutputSuffixField />
          </div>
        </fieldset>
        <fieldset class="config-group">
          <legend>缩放行为</legend>
          <div class="config-group-fields config-group-fields-single">
            <ToggleSwitch
              label="较小图片"
              :model-value="store.settings.image.allowEnlargement"
              enabled-text="允许放大"
              disabled-text="不放大"
              @update:model-value="updateImage({ allowEnlargement: $event })"
            />
          </div>
        </fieldset>
      </div>
    </section>

    <div class="video-workspace-content">
      <section
        v-if="pendingInputs.length"
        class="pending-file-panel"
        aria-labelledby="image-pending-title"
      >
        <header class="pending-file-header">
          <div>
            <div class="flex items-center gap-2">
              <Images class="size-4 text-signal-strong" />
              <h2 id="image-pending-title">待处理图片</h2>
              <span class="pending-count">{{ pendingInputs.length }}</span>
            </div>
            <p>确认图片参数和输出位置后，点击顶部“开始处理”。</p>
          </div>
          <div class="flex items-center gap-1">
            <Button variant="secondary" size="sm" @click="chooseFiles">
              <Plus class="size-3.5" />添加图片
            </Button>
            <Button variant="secondary" size="sm" @click="chooseDirectory">
              <FolderPlus class="size-3.5" />添加文件夹
            </Button>
            <Button variant="ghost" size="sm" @click="pendingInputs = []">
              <Trash2 class="size-3.5" />清空
            </Button>
          </div>
        </header>
        <ul class="pending-file-list">
          <li v-for="input in pendingInputs" :key="input.path">
            <FileImage class="size-4 shrink-0 text-muted-foreground" />
            <span class="truncate" :title="input.path">{{ inputLabel(input) }}</span>
            <button
              type="button"
              :aria-label="`移除 ${fileName(input.path)}`"
              @click="removePending(input.path)"
            >
              <X class="size-4" />
            </button>
          </li>
        </ul>
      </section>

      <div
        v-else-if="imageTasks.length === 0"
        class="video-drop-prompt"
        :class="{ 'video-drop-prompt-active': dragging }"
      >
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

      <section
        v-if="imageTasks.length"
        class="inline-task-section"
        aria-labelledby="image-tasks-title"
      >
        <header class="inline-task-header">
          <div>
            <div class="flex items-center gap-2">
              <ListTodo class="size-4 text-signal-strong" />
              <h2 id="image-tasks-title">任务进度</h2>
            </div>
            <p>
              {{
                activeTaskCount ? `${activeTaskCount} 个任务正在处理或等待` : '本次任务已处理完毕'
              }}
            </p>
          </div>
          <div v-if="pendingInputs.length === 0" class="flex items-center gap-1">
            <Button variant="secondary" size="sm" @click="chooseFiles">
              <Plus class="size-3.5" />添加图片
            </Button>
            <Button variant="secondary" size="sm" @click="chooseDirectory">
              <FolderPlus class="size-3.5" />添加文件夹
            </Button>
          </div>
        </header>
        <TaskTable :tasks="imageTasks" empty-text="暂无图片任务" />
      </section>
    </div>
  </div>
</template>
