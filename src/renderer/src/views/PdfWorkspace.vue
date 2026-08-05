<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { FileText, Play, Plus, SlidersHorizontal, UploadCloud } from '@lucide/vue'
import type {
  CreateTasksRequest,
  PdfCompressionMode,
  PdfImageFormat,
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
const dragging = ref(false)
const starting = ref(false)
const pendingPaths = computed<string[]>({
  get: () => store.pendingPdfPaths,
  set: (value) => (store.pendingPdfPaths = value)
})
const pdfTasks = computed(() => store.currentBatchTasks.pdf)
const pendingTableItems = computed(() => pendingPaths.value.map((path) => ({ path })))
type PdfWorkspaceMode = 'toImage' | PdfCompressionMode

const operationOptions = [
  { value: 'toImage', label: '转图片' },
  { value: 'lossless', label: '无损压缩' },
  { value: 'lossy', label: '有损压缩' }
]
const imageFormatOptions = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' }
]
const supportedExtensions = new Set(['pdf'])

const workspaceMode = computed<PdfWorkspaceMode>(() => {
  const options = store.settings?.pdf.lastOptions
  if (!options || options.operation === 'toImage') return 'toImage'
  return options.compressionMode
})
const emptyStateCopy = computed(() => {
  if (workspaceMode.value === 'toImage') {
    return {
      title: '拖入需要逐页转图片的 PDF',
      description: '每个页面都会独立导出，可选择 PNG、JPEG 或 WebP。'
    }
  }
  if (workspaceMode.value === 'lossy') {
    return {
      title: '拖入需要缩小体积的 PDF',
      description: '页面将重建为 JPEG 图片，适合图片型 PDF；文字选择和矢量内容不会保留。'
    }
  }
  return {
    title: '拖入需要无损压缩的 PDF',
    description: '重新整理 PDF 内部结构，不降低页面清晰度，也不改变文字和矢量内容。'
  }
})

function updatePdf(patch: Partial<PdfOptions>): void {
  if (!store.settings) return
  void store.updateSettings({
    pdf: { lastOptions: { ...store.settings.pdf.lastOptions, ...patch } }
  })
}

function setWorkspaceMode(value: PdfWorkspaceMode): void {
  if (value === 'toImage') {
    updatePdf({ operation: 'toImage' })
    return
  }
  updatePdf({ operation: 'compress', compressionMode: value })
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
    presetName:
      options.operation === 'toImage'
        ? 'PDF 转图片'
        : options.compressionMode === 'lossy'
          ? 'PDF 有损压缩'
          : 'PDF 无损压缩',
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

    <!-- Left Main Content Area -->
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
        <p class="text-base font-semibold">
          {{ dragging ? '松开即可添加 PDF' : emptyStateCopy.title }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">{{ emptyStateCopy.description }}</p>
        <Button class="mt-5" @click="chooseFiles">选择 PDF 文件</Button>
      </div>
    </div>

    <!-- Right Sidebar Settings Panel -->
    <section v-if="store.settings" class="video-config-panel" aria-label="PDF 处理设置">
      <!-- Panel Header -->
      <div class="video-config-heading">
        <div class="config-heading-main">
          <SlidersHorizontal class="size-4 shrink-0 text-signal-strong" />
          <span class="shrink-0 text-sm font-semibold">PDF 处理设置</span>
        </div>
      </div>

      <!-- Panel Body -->
      <div class="video-config-body">
        <div class="config-section">
          <div class="config-section-title">基础设置</div>

          <div class="space-y-3">
            <label class="compact-field">
              <span>处理方式</span>
              <SegmentedControl
                class="pdf-operation-segments"
                label="PDF 处理方式"
                :model-value="workspaceMode"
                :options="operationOptions"
                hide-label
                @update:model-value="setWorkspaceMode($event as PdfWorkspaceMode)"
              />
            </label>

            <!-- 转图片参数 -->
            <template v-if="store.settings.pdf.lastOptions.operation === 'toImage'">
              <label class="compact-field">
                <span>输出图片格式</span>
                <SegmentedControl
                  label="图片格式"
                  hide-label
                  :model-value="store.settings.pdf.lastOptions.imageFormat"
                  :options="imageFormatOptions"
                  @update:model-value="updatePdf({ imageFormat: $event as PdfImageFormat })"
                />
              </label>

              <label class="compact-field">
                <span>分辨率 (DPI)</span>
                <select
                  class="compact-select"
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

              <label v-if="store.settings.pdf.lastOptions.imageFormat !== 'png'" class="compact-field">
                <span>有损质量 (1 - 100)</span>
                <div class="number-field">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    :value="store.settings.pdf.lastOptions.imageQuality"
                    @change="
                      updatePdf({ imageQuality: Number(($event.target as HTMLInputElement).value) })
                    "
                  />
                  <span>/ 100</span>
                </div>
              </label>
            </template>

            <!-- 有损压缩参数 -->
            <template v-else-if="store.settings.pdf.lastOptions.compressionMode === 'lossy'">
              <label class="compact-field">
                <span>页面分辨率</span>
                <select
                  class="compact-select"
                  :value="store.settings.pdf.lastOptions.compressionDpi"
                  @change="
                    updatePdf({
                      compressionDpi: Number(($event.target as HTMLSelectElement).value)
                    })
                  "
                >
                  <option :value="96">96 DPI</option>
                  <option :value="144">144 DPI</option>
                  <option :value="200">200 DPI</option>
                  <option :value="300">300 DPI</option>
                </select>
              </label>

              <label class="compact-field">
                <span>图片质量</span>
                <div class="number-field">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    :value="store.settings.pdf.lastOptions.compressionQuality"
                    @change="
                      updatePdf({
                        compressionQuality: Number(($event.target as HTMLInputElement).value)
                      })
                    "
                  />
                  <span>/ 100</span>
                </div>
              </label>

              <div class="rounded-lg border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground leading-relaxed">
                页面将重建为 JPEG 图片，适用于图片型 PDF；文字与矢量内容将被栅格化。
              </div>
            </template>

            <!-- 无损压缩说明 -->
            <template v-else>
              <div class="rounded-lg border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground leading-relaxed">
                重新整理 PDF 内部流结构，不改变图像画质与文字矢量属性。
              </div>
            </template>
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
