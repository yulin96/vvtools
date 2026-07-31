<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { FileText, Play, Plus, SlidersHorizontal, UploadCloud } from '@lucide/vue'
import type {
  CreateTasksRequest,
  PdfImageFormat,
  PdfOperation,
  PdfOptions
} from '../../../shared/types'
import { useAppStore } from '../stores/app'
import Button from '../components/ui/Button.vue'
import CurrentBatchTable from '../components/CurrentBatchTable.vue'
import DropFollowEffect from '../components/ui/DropFollowEffect.vue'
import OutputLocationControls from '../components/OutputLocationControls.vue'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import SourceOverwriteWarning from '../components/SourceOverwriteWarning.vue'

const store = useAppStore()
const useIntegratedTitlebar = ['darwin', 'win32'].includes(window.api.platform)
const dragging = ref(false)
const starting = ref(false)
const pendingPaths = computed<string[]>({
  get: () => store.pendingPdfPaths,
  set: (value) => (store.pendingPdfPaths = value)
})
const pdfTasks = computed(() => store.currentBatchTasks.pdf)
const pendingTableItems = computed(() => pendingPaths.value.map((path) => ({ path })))
const operationOptions = [
  { value: 'toImage', label: '逐页转图片' },
  { value: 'compress', label: '无损压缩' }
]
const imageFormatOptions = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' }
]
const supportedExtensions = new Set(['pdf'])

const formatLabel = computed(() => {
  const options = store.settings?.pdf.lastOptions
  if (!options) return ''
  return options.operation === 'compress'
    ? '无损压缩'
    : `PDF → ${options.imageFormat.toUpperCase()}`
})

function updatePdf(patch: Partial<PdfOptions>): void {
  if (!store.settings) return
  void store.updateSettings({
    pdf: { lastOptions: { ...store.settings.pdf.lastOptions, ...patch } }
  })
}

function stageFiles(paths: string[]): void {
  const supported = paths.filter((path) =>
    supportedExtensions.has(path.split('.').pop()?.toLowerCase() || '')
  )
  if (supported.length === 0 && paths.length > 0) {
    store.errorMessage = '没有可导入的 PDF 文件'
    return
  }
  if (pendingPaths.value.length === 0) store.prepareCurrentBatch('pdf')
  const combined = [...new Set([...pendingPaths.value, ...supported])]
  if (combined.length > 500) {
    store.errorMessage = '单次最多添加 500 个文件'
    return
  }
  pendingPaths.value = combined
}

async function chooseFiles(): Promise<void> {
  try {
    stageFiles(await window.api.selectFiles('pdf'))
  } catch (error) {
    store.errorMessage = error instanceof Error ? error.message : String(error)
  }
}

function withPageVariable(template: string): string {
  return template.includes('{page}') ? template : `${template}-page-{page}`
}

async function startProcessing(): Promise<void> {
  if (!store.settings || pendingPaths.value.length === 0 || starting.value) return
  const settings = store.settings
  const options = { ...settings.pdf.lastOptions }
  const request: CreateTasksRequest = {
    kind: 'pdf',
    sourcePaths: [...pendingPaths.value],
    outputMode: settings.common.outputMode,
    outputDirectory: settings.common.outputDirectory,
    outputSuffix: settings.common.outputSuffix,
    outputNameTemplate:
      options.operation === 'toImage'
        ? withPageVariable(settings.common.outputNameTemplate)
        : settings.common.outputNameTemplate,
    outputConflictPolicy: settings.common.outputConflictPolicy,
    presetName: options.operation === 'compress' ? 'PDF 无损压缩' : 'PDF 转图片',
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
    <section v-if="store.settings" class="video-config-panel" aria-label="PDF 处理设置">
      <div class="video-config-heading">
        <div class="config-heading-main">
          <SlidersHorizontal class="size-4 shrink-0 text-signal-strong" />
          <span class="shrink-0 text-sm font-semibold">PDF 处理设置</span>
          <span class="config-summary truncate text-xs text-muted-foreground">{{
            formatLabel
          }}</span>
        </div>
        <Teleport to="#media-titlebar-actions" :disabled="!useIntegratedTitlebar">
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
        </Teleport>
      </div>

      <div class="image-config-primary">
        <fieldset class="config-group">
          <legend class="sr-only">PDF 操作</legend>
          <div class="config-group-fields">
            <SegmentedControl
              label="处理方式"
              :model-value="store.settings.pdf.lastOptions.operation"
              :options="operationOptions"
              @update:model-value="updatePdf({ operation: $event as PdfOperation })"
            />
            <SegmentedControl
              v-if="store.settings.pdf.lastOptions.operation === 'toImage'"
              label="图片格式"
              :model-value="store.settings.pdf.lastOptions.imageFormat"
              :options="imageFormatOptions"
              @update:model-value="updatePdf({ imageFormat: $event as PdfImageFormat })"
            />
          </div>
        </fieldset>

        <fieldset
          v-if="store.settings.pdf.lastOptions.operation === 'toImage'"
          class="config-group"
        >
          <legend class="sr-only">图片质量</legend>
          <div class="config-group-fields">
            <label class="compact-field">
              <span>分辨率</span>
              <select
                :value="store.settings.pdf.lastOptions.dpi"
                @change="updatePdf({ dpi: Number(($event.target as HTMLSelectElement).value) })"
              >
                <option :value="72">72 DPI</option>
                <option :value="96">96 DPI</option>
                <option :value="144">144 DPI</option>
                <option :value="200">200 DPI</option>
                <option :value="300">300 DPI</option>
                <option :value="600">600 DPI</option>
              </select>
            </label>
            <label
              class="compact-field"
              :class="{ 'opacity-45': store.settings.pdf.lastOptions.imageFormat === 'png' }"
            >
              <span>有损质量</span>
              <input
                type="number"
                min="1"
                max="100"
                :value="store.settings.pdf.lastOptions.imageQuality"
                :disabled="store.settings.pdf.lastOptions.imageFormat === 'png'"
                @change="
                  updatePdf({ imageQuality: Number(($event.target as HTMLInputElement).value) })
                "
              />
            </label>
          </div>
        </fieldset>
      </div>
    </section>

    <div class="video-workspace-content">
      <CurrentBatchTable
        v-if="pendingPaths.length || pdfTasks.length"
        kind="pdf"
        :pending-items="pendingTableItems"
        :tasks="pdfTasks"
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
          <FileText v-else class="size-8" />
        </div>
        <p class="text-lg font-semibold">{{ dragging ? '松开即可添加 PDF' : '拖入 PDF 文件' }}</p>
        <p class="mt-1 text-sm text-muted-foreground">
          支持 PDF 无损压缩，以及逐页导出为 PNG、JPEG 或 WebP。
        </p>
        <Button class="mt-5" @click="chooseFiles">选择 PDF 文件</Button>
      </div>
    </div>
  </div>
</template>
