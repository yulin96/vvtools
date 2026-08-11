<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { FileVideo2, Grid2X2, Play, Plus, SlidersHorizontal, UploadCloud } from '@lucide/vue'
import type {
  CreateTasksRequest,
  SpriteExportMode,
  SpriteImageFormat,
  SpriteOptions,
  SpriteSamplingMode
} from '../../../shared/types'
import { useAppStore } from '../stores/app'
import { settledBatchSourceItems } from '../lib/batch-sources'
import { takeRoutedDrop } from '../lib/media-drop'
import AdvancedSettingsPanel from '../components/ui/AdvancedSettingsPanel.vue'
import AnimatedChevron from '../components/ui/AnimatedChevron.vue'
import Button from '../components/ui/Button.vue'
import CurrentBatchTable from '../components/CurrentBatchTable.vue'
import DropFollowEffect from '../components/ui/DropFollowEffect.vue'
import OutputLocationControls from '../components/OutputLocationControls.vue'
import OutputSuffixField from '../components/OutputSuffixField.vue'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import SourceOverwriteWarning from '../components/SourceOverwriteWarning.vue'

const store = useAppStore()
const configExpanded = ref(false)
const dragging = ref(false)
const starting = ref(false)
const pendingPaths = computed<string[]>({
  get: () => store.pendingSpritePaths,
  set: (value) => (store.pendingSpritePaths = value)
})
const spriteTasks = computed(() => store.currentBatchTasks.sprite)
const startItems = computed(() =>
  pendingPaths.value.length
    ? pendingPaths.value.map((path) => ({ path, batchItemId: path }))
    : settledBatchSourceItems(spriteTasks.value)
)
const pendingTableItems = computed(() => pendingPaths.value.map((path) => ({ path })))
const options = computed(() => store.settings?.sprite.lastOptions)
const samplingOptions = [
  { value: 'interval', label: '按时间间隔' },
  { value: 'count', label: '按总帧数' },
  { value: 'frame', label: '按帧抽取' }
]
const exportOptions = [
  { value: 'batch', label: '分批导出', title: '按指定帧数拆成多张雪碧图' },
  { value: 'single', label: '单张总图', title: '把全部采样帧放进一张图片' }
]
const formatOptions = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' }
]
const videoExtensions = new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mpeg', 'mpg'])
const summary = computed(() => {
  const value = options.value
  if (!value) return ''
  const sampling =
    value.samplingMode === 'interval'
      ? `每 ${value.intervalSeconds} 秒 1 帧`
      : value.samplingMode === 'frame'
        ? value.frameStep === 1
          ? '提取所有帧'
          : `每 ${value.frameStep} 帧取 1 帧（跳过 ${value.frameStep - 1} 帧）`
        : `均匀 ${value.frameCount} 帧`
  const output = value.exportMode === 'batch' ? `每张 ${value.framesPerSheet} 帧` : '单张总图'
  return `${sampling} · ${value.columns} 列 · ${output} · ${value.imageFormat.toUpperCase()}`
})

function updateSprite(patch: Partial<SpriteOptions>): Promise<void> {
  if (!store.settings) return Promise.resolve()
  return store.updateSettings({
    sprite: { lastOptions: { ...store.settings.sprite.lastOptions, ...patch } }
  })
}

function numberValue(event: Event): number {
  return Number((event.target as HTMLInputElement).value)
}

function stageFiles(paths: string[]): void {
  if (!paths.length) return
  const existing = new Set(pendingPaths.value)
  const incoming = [...new Set(paths)].filter((path) => !existing.has(path))
  const accepted = incoming.slice(0, Math.max(0, 500 - pendingPaths.value.length))
  if (accepted.length && !pendingPaths.value.length) store.prepareCurrentBatch('sprite')
  pendingPaths.value = [...pendingPaths.value, ...accepted]
  if (incoming.length > accepted.length) {
    store.errorMessage = `单次最多添加 500 个文件，已忽略 ${incoming.length - accepted.length} 个`
  }
}

async function chooseFiles(): Promise<void> {
  try {
    stageFiles(await window.api.selectFiles('sprite'))
  } catch (error) {
    store.errorMessage = error instanceof Error ? error.message : String(error)
  }
}

async function startProcessing(): Promise<void> {
  if (!store.settings || !startItems.value.length || starting.value) return
  const settings = store.settings
  const items = startItems.value
  const request: CreateTasksRequest = {
    kind: 'sprite',
    sourcePaths: items.map((item) => item.path),
    batchItemIds: items.map((item) => item.batchItemId),
    outputMode: settings.common.outputMode,
    outputDirectory: settings.common.outputDirectory,
    outputSuffix: settings.sprite.outputSuffix,
    outputNameTemplate: settings.common.outputNameTemplate,
    outputConflictPolicy: settings.common.outputConflictPolicy,
    presetName: settings.sprite.lastOptions.exportMode === 'batch' ? '分批雪碧图' : '单张雪碧图',
    options: { ...settings.sprite.lastOptions }
  }
  starting.value = true
  try {
    const result = await store.submitTasks(request)
    if (result) {
      const handled = new Set(result.handledPaths)
      pendingPaths.value = pendingPaths.value.filter((path) => !handled.has(path))
    }
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
  const files = [...(event.dataTransfer?.files || [])]
  const paths = files
    .map((file) => window.api.getDroppedFilePath(file))
    .filter((path) => videoExtensions.has(path.split('.').pop()?.toLowerCase() || ''))
  if (!paths.length && files.length) store.errorMessage = '没有可导入的视频文件'
  else stageFiles(paths)
}

onMounted(() => {
  window.addEventListener('dragover', handleDragOver, true)
  window.addEventListener('dragleave', handleDragLeave, true)
  window.addEventListener('drop', handleDrop, true)
  stageFiles(takeRoutedDrop('/sprite'))
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
    <section v-if="store.settings" class="video-config-panel" aria-label="视频雪碧图设置">
      <div class="video-config-heading">
        <div class="config-heading-main">
          <SlidersHorizontal class="size-4 shrink-0 text-signal-strong" />
          <span class="shrink-0 text-sm font-semibold">视频雪碧图设置</span>
          <Button
            class="config-expand-toggle"
            variant="ghost"
            size="sm"
            :aria-expanded="configExpanded"
            aria-controls="sprite-advanced-settings"
            @click="configExpanded = !configExpanded"
          >
            {{ configExpanded ? '收起设置' : '更多设置' }}
            <AnimatedChevron :expanded="configExpanded" />
          </Button>
          <span class="config-summary truncate text-xs text-muted-foreground">{{ summary }}</span>
        </div>
        <div class="video-config-actions">
          <OutputLocationControls />
          <div class="start-processing-actions">
            <SourceOverwriteWarning />
            <Button size="sm" :disabled="!startItems.length || starting" @click="startProcessing">
              <Play class="size-4" />
              {{
                starting
                  ? '正在开始…'
                  : `开始导出${startItems.length ? ` (${startItems.length})` : ''}`
              }}
            </Button>
          </div>
        </div>
      </div>

      <div class="video-config-primary">
        <fieldset class="config-group">
          <legend class="sr-only">采样方式</legend>
          <div class="config-group-fields">
            <SegmentedControl
              label="采样方式"
              :model-value="options?.samplingMode ?? 'interval'"
              :options="samplingOptions"
              @update:model-value="updateSprite({ samplingMode: $event as SpriteSamplingMode })"
            />
            <label class="compact-field">
              <span>
                {{
                  options?.samplingMode === 'interval'
                    ? '采样间隔'
                    : options?.samplingMode === 'frame'
                      ? '抽帧步长'
                      : '采样总帧数'
                }}
              </span>
              <div class="number-field">
                <input
                  v-if="options?.samplingMode === 'interval'"
                  :value="options.intervalSeconds"
                  type="number"
                  min="0.1"
                  max="3600"
                  step="0.1"
                  @change="updateSprite({ intervalSeconds: numberValue($event) })"
                /><input
                  v-else-if="options?.samplingMode === 'count'"
                  :value="options?.frameCount"
                  type="number"
                  min="1"
                  max="10000"
                  @change="updateSprite({ frameCount: numberValue($event) })"
                /><input
                  v-else
                  :value="options?.frameStep"
                  type="number"
                  min="1"
                  max="10000"
                  @change="updateSprite({ frameStep: numberValue($event) })"
                /><span>{{ options?.samplingMode === 'interval' ? '秒' : '帧' }}</span>
              </div>
              <small v-if="options?.samplingMode === 'frame'" class="compact-field-hint">
                1 = 所有帧；2 = 跳过 1 帧；3 = 跳过 2 帧
              </small>
            </label>
          </div>
        </fieldset>

        <fieldset class="config-group">
          <legend class="sr-only">排版</legend>
          <div class="config-group-fields">
            <label class="compact-field">
              <span>单帧宽度</span>
              <div class="number-field">
                <input
                  :value="options?.frameWidth"
                  type="number"
                  min="32"
                  max="4096"
                  @change="updateSprite({ frameWidth: numberValue($event) })"
                /><span>px</span>
              </div>
            </label>
            <label class="compact-field">
              <span>每行列数</span>
              <div class="number-field">
                <input
                  :value="options?.columns"
                  type="number"
                  min="1"
                  max="100"
                  @change="updateSprite({ columns: numberValue($event) })"
                /><span>列</span>
              </div>
            </label>
          </div>
        </fieldset>

        <fieldset class="config-group">
          <legend class="sr-only">导出</legend>
          <div class="config-group-fields">
            <SegmentedControl
              label="导出方式"
              :model-value="options?.exportMode ?? 'batch'"
              :options="exportOptions"
              @update:model-value="updateSprite({ exportMode: $event as SpriteExportMode })"
            />
            <label class="compact-field" :class="{ 'opacity-45': options?.exportMode !== 'batch' }">
              <span>每张雪碧图容纳</span>
              <div class="number-field">
                <input
                  :value="options?.framesPerSheet"
                  :disabled="options?.exportMode !== 'batch'"
                  type="number"
                  min="1"
                  max="10000"
                  @change="updateSprite({ framesPerSheet: numberValue($event) })"
                /><span>帧</span>
              </div>
            </label>
          </div>
        </fieldset>
      </div>

      <AdvancedSettingsPanel
        id="sprite-advanced-settings"
        :open="configExpanded"
        class="video-config-expanded"
      >
        <fieldset class="config-group advanced-settings-list video-advanced-settings-list">
          <legend class="sr-only">范围与图片</legend>
          <div class="config-group-fields">
            <label class="compact-field"
              ><span>开始时间（0 为开头）</span>
              <div class="number-field">
                <input
                  :value="options?.startTimeSeconds"
                  type="number"
                  min="0"
                  max="864000"
                  step="0.1"
                  @change="updateSprite({ startTimeSeconds: numberValue($event) })"
                /><span>秒</span>
              </div></label
            >
            <label class="compact-field"
              ><span>结束时间（0 为结尾）</span>
              <div class="number-field">
                <input
                  :value="options?.endTimeSeconds"
                  type="number"
                  min="0"
                  max="864000"
                  step="0.1"
                  @change="updateSprite({ endTimeSeconds: numberValue($event) })"
                /><span>秒</span>
              </div></label
            >
            <label class="compact-field"
              ><span>帧间距</span>
              <div class="number-field">
                <input
                  :value="options?.padding"
                  type="number"
                  min="0"
                  max="128"
                  @change="updateSprite({ padding: numberValue($event) })"
                /><span>px</span>
              </div></label
            >
            <label class="compact-field"
              ><span>画布边距</span>
              <div class="number-field">
                <input
                  :value="options?.margin"
                  type="number"
                  min="0"
                  max="256"
                  @change="updateSprite({ margin: numberValue($event) })"
                /><span>px</span>
              </div></label
            >
            <label class="compact-field"
              ><span>背景颜色</span
              ><input
                :value="options?.backgroundColor"
                type="color"
                @change="
                  updateSprite({ backgroundColor: ($event.target as HTMLInputElement).value })
                "
            /></label>
            <SegmentedControl
              label="图片格式"
              :model-value="options?.imageFormat ?? 'png'"
              :options="formatOptions"
              @update:model-value="updateSprite({ imageFormat: $event as SpriteImageFormat })"
            />
            <label class="compact-field" :class="{ 'opacity-45': options?.imageFormat === 'png' }"
              ><span>图片质量</span>
              <div class="number-field">
                <input
                  :value="options?.quality"
                  :disabled="options?.imageFormat === 'png'"
                  type="number"
                  min="1"
                  max="100"
                  @change="updateSprite({ quality: numberValue($event) })"
                /><span>%</span>
              </div></label
            >
            <OutputSuffixField kind="sprite" />
          </div>
        </fieldset>
      </AdvancedSettingsPanel>
    </section>

    <div class="video-workspace-content workspace-scroll-content" @click="configExpanded = false">
      <CurrentBatchTable
        v-if="pendingPaths.length || spriteTasks.length"
        kind="sprite"
        :pending-items="pendingTableItems"
        :tasks="spriteTasks"
        @remove-pending="(path) => (pendingPaths = pendingPaths.filter((item) => item !== path))"
      >
        <template #actions>
          <div class="flex items-center gap-1">
            <Button variant="secondary" size="sm" @click="chooseFiles"
              ><Plus class="size-3.5" />添加视频</Button
            >
            <Button v-if="pendingPaths.length" variant="ghost" size="sm" @click="pendingPaths = []"
              >清空待处理</Button
            >
          </div>
        </template>
      </CurrentBatchTable>
      <div v-else class="video-drop-prompt" :class="{ 'video-drop-prompt-active': dragging }">
        <div class="video-drop-icon">
          <UploadCloud v-if="dragging" class="size-8" /><Grid2X2 v-else class="size-8" />
        </div>
        <p class="text-lg font-semibold">
          {{ dragging ? '松开即可添加视频' : '拖入视频生成雪碧图' }}
        </p>
        <p class="mt-1 text-sm text-muted-foreground">
          支持均匀采样或按时间间隔采样，可导出单张总图或自动分批。
        </p>
        <Button class="mt-5" @click="chooseFiles"><FileVideo2 class="size-4" />选择视频文件</Button>
      </div>
    </div>
  </div>
</template>
