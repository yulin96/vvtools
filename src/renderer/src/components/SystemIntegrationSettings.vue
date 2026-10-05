<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowDown, ArrowUp, FolderOpen, PanelsTopLeft, Pencil, RefreshCw } from '@lucide/vue'
import type {
  DesktopIntegrationState,
  DesktopQuickAction,
  DesktopSettings
} from '../../../shared/types'
import { DEFAULT_DESKTOP_SETTINGS } from '../../../shared/desktop-settings'
import { useAppStore } from '../stores/app'
import Button from './ui/Button.vue'
import SegmentedControl from './ui/SegmentedControl.vue'
import ToggleSwitch from './ui/ToggleSwitch.vue'

const store = useAppStore()
const isMac = window.api.platform === 'darwin'
const desktop = computed(() => store.settings!.desktop)
const state = ref<DesktopIntegrationState | null>(null)
const busy = ref(false)
const draft = ref<DesktopQuickAction | null>(null)
const formatOptions = [
  { value: 'jpeg', label: 'JPEG' },
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WebP' },
  { value: 'original', label: '原格式' }
]
const resizeOptions = [
  { value: 'source', label: '保持尺寸' },
  { value: 'width', label: '指定宽度' },
  { value: 'height', label: '指定高度' },
  { value: 'percentage', label: '按比例' }
]

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
async function refreshState(): Promise<void> {
  try {
    state.value = await window.api.getDesktopIntegration()
  } catch (error) {
    store.reportError(error)
  }
}
async function save(patch: Partial<DesktopSettings>): Promise<boolean> {
  if (busy.value) return false
  busy.value = true
  try {
    store.settings = await window.api.updateSettings({ desktop: clone(patch) })
    await refreshState()
    return true
  } catch (error) {
    store.reportError(error)
    return false
  } finally {
    busy.value = false
  }
}
async function repair(): Promise<void> {
  busy.value = true
  try {
    state.value = await window.api.repairDesktopIntegration()
  } catch (error) {
    store.reportError(error)
    await refreshState()
  } finally {
    busy.value = false
  }
}
function edit(action: DesktopQuickAction): void {
  draft.value = clone(action)
}
function summary(action: DesktopQuickAction): string {
  const options = action.options
  const compression =
    options.compressionMode === 'targetSize'
      ? '目标 ' + options.targetSizeKb + ' KB'
      : '质量 ' + options.quality
  const resize =
    options.resizeMode === 'width'
      ? '宽 ' + options.width + ' px'
      : options.resizeMode === 'height'
        ? '高 ' + options.height + ' px'
        : options.resizeMode === 'percentage'
          ? options.percentage + '%'
          : '保持尺寸'
  return (
    (options.format === 'original' ? '原格式' : options.format.toUpperCase()) +
    ' · ' +
    compression +
    ' · ' +
    resize
  )
}
function enable(action: DesktopQuickAction, enabled: boolean): void {
  void save({
    actions: desktop.value.actions.map((item) =>
      item.id === action.id ? { ...clone(item), enabled } : clone(item)
    )
  })
}
function move(index: number, offset: number): void {
  const actions = clone(desktop.value.actions)
  const [action] = actions.splice(index, 1)
  actions.splice(index + offset, 0, action)
  void save({ actions })
}
async function saveDraft(): Promise<void> {
  if (!draft.value) return
  const action = clone(draft.value)
  if (
    await save({
      actions: desktop.value.actions.map((item) => (item.id === action.id ? action : clone(item)))
    })
  )
    draft.value = null
}
function resetDraft(): void {
  draft.value = clone(
    DEFAULT_DESKTOP_SETTINGS.actions.find((action) => action.id === draft.value?.id)!
  )
}
function copyImageOptions(): void {
  if (draft.value) draft.value.options = clone(store.settings!.image.lastOptions)
}
async function chooseDirectory(): Promise<void> {
  try {
    const directory = await window.api.selectOutputDirectory(draft.value?.outputDirectory)
    if (directory && draft.value) draft.value.outputDirectory = directory
  } catch (error) {
    store.reportError(error)
  }
}
function openSystemSettings(): void {
  void window.api.openDesktopSystemSettings().catch(store.reportError)
}

onMounted(refreshState)
</script>

<template>
  <section id="desktop-integration" class="settings-card settings-card-stack scroll-mt-5">
    <div class="settings-card-title">
      <PanelsTopLeft class="size-4" />
      <div>
        <h2>系统入口与快捷动作</h2>
        <p>应用菜单和文件右键共用快捷动作，按固定参数处理并保留原文件。</p>
      </div>
    </div>
    <fieldset :disabled="busy" class="grid w-full min-w-0 gap-5">
      <fieldset
        :disabled="state?.status === 'unavailable'"
        class="flex flex-wrap items-center justify-between gap-4"
      >
        <ToggleSwitch
          :label="isMac ? 'Finder 快速操作' : '文件右键菜单'"
          :model-value="desktop.contextMenuEnabled"
          enabled-text="已启用"
          disabled-text="未启用"
          @update:model-value="save({ contextMenuEnabled: $event })"
        />
        <Button
          v-if="state?.status === 'needs-repair' || desktop.contextMenuEnabled"
          variant="secondary"
          size="sm"
          @click="repair"
        >
          <RefreshCw class="size-3.5" /> 修复入口
        </Button>
      </fieldset>
      <p class="text-xs text-muted-foreground" role="status">
        {{ state?.message ?? '正在检查系统入口…' }}
      </p>
      <Button
        v-if="isMac && desktop.contextMenuEnabled"
        class="w-fit"
        variant="secondary"
        size="sm"
        @click="openSystemSettings"
      >
        打开系统服务设置
      </Button>

      <div class="divide-y divide-border border-y border-border">
        <div
          v-for="(action, index) in desktop.actions"
          :key="action.id"
          class="flex flex-wrap items-center gap-x-4 gap-y-3 py-4"
        >
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium">{{ action.name }}</p>
            <p class="mt-1 text-xs text-muted-foreground">{{ summary(action) }}</p>
          </div>
          <ToggleSwitch
            :label="action.name"
            class="[&>span]:sr-only"
            :model-value="action.enabled"
            enabled-text="启用"
            disabled-text="停用"
            @update:model-value="enable(action, $event)"
          />
          <div class="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              :disabled="index === 0"
              :aria-label="'上移' + action.name"
              @click="move(index, -1)"
            >
              <ArrowUp class="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              :disabled="index === desktop.actions.length - 1"
              :aria-label="'下移' + action.name"
              @click="move(index, 1)"
            >
              <ArrowDown class="size-3.5" />
            </Button>
            <Button variant="secondary" size="sm" @click="edit(action)">
              <Pencil class="size-3.5" /> 编辑
            </Button>
          </div>
        </div>
      </div>

      <form v-if="draft" class="grid gap-4" @submit.prevent="saveDraft">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h3 class="text-sm font-medium">编辑 {{ draft.name }}</h3>
          <div class="flex gap-2">
            <Button type="button" variant="ghost" size="sm" @click="copyImageOptions"
              >复制当前图片参数</Button
            >
            <Button type="button" variant="ghost" size="sm" @click="resetDraft">恢复默认</Button>
          </div>
        </div>
        <label class="field-label">
          <span>动作名称</span>
          <input v-model="draft.name" required maxlength="40" />
        </label>
        <SegmentedControl
          label="图片格式"
          :model-value="draft.options.format"
          :options="formatOptions"
          @update:model-value="
            draft.options.format = $event as DesktopQuickAction['options']['format']
          "
        />
        <SegmentedControl
          label="压缩方式"
          :model-value="draft.options.compressionMode"
          :options="[
            { value: 'quality', label: '指定质量' },
            { value: 'targetSize', label: '目标大小' }
          ]"
          @update:model-value="
            draft.options.compressionMode =
              $event as DesktopQuickAction['options']['compressionMode']
          "
        />
        <label v-if="draft.options.compressionMode === 'quality'" class="field-label">
          <span>质量（1–100）</span>
          <input v-model.number="draft.options.quality" type="number" min="1" max="100" required />
        </label>
        <label v-else class="field-label">
          <span>目标大小（KB）</span>
          <input
            v-model.number="draft.options.targetSizeKb"
            type="number"
            min="1"
            max="100000"
            required
          />
        </label>
        <SegmentedControl
          label="图片尺寸"
          :model-value="draft.options.resizeMode"
          :options="resizeOptions"
          @update:model-value="
            draft.options.resizeMode = $event as DesktopQuickAction['options']['resizeMode']
          "
        />
        <label v-if="draft.options.resizeMode === 'width'" class="field-label">
          <span>宽度（px）</span>
          <input v-model.number="draft.options.width" type="number" min="1" max="32768" required />
        </label>
        <label v-if="draft.options.resizeMode === 'height'" class="field-label">
          <span>高度（px）</span>
          <input v-model.number="draft.options.height" type="number" min="1" max="32768" required />
        </label>
        <label v-if="draft.options.resizeMode === 'percentage'" class="field-label">
          <span>尺寸比例（%）</span>
          <input
            v-model.number="draft.options.percentage"
            type="number"
            min="1"
            max="1000"
            required
          />
        </label>
        <SegmentedControl
          label="输出位置"
          :model-value="draft.outputMode"
          :options="[
            { value: 'source', label: '原文件旁' },
            { value: 'custom', label: '指定文件夹' }
          ]"
          @update:model-value="draft.outputMode = $event as DesktopQuickAction['outputMode']"
        />
        <div v-if="draft.outputMode === 'custom'" class="flex min-w-0 items-center gap-2">
          <span
            class="min-w-0 flex-1 truncate text-xs text-muted-foreground"
            :title="draft.outputDirectory"
            >{{ draft.outputDirectory || '请选择文件夹' }}</span
          >
          <Button type="button" size="sm" variant="secondary" @click="chooseDirectory"
            ><FolderOpen class="size-3.5" /> 选择文件夹</Button
          >
        </div>
        <label class="field-label">
          <span>文件名后缀</span>
          <input v-model="draft.outputSuffix" maxlength="50" placeholder="例如 _share" />
        </label>
        <SegmentedControl
          label="同名文件"
          :model-value="draft.outputConflictPolicy"
          :options="[
            { value: 'rename', label: '自动改名' },
            { value: 'skip', label: '跳过' }
          ]"
          @update:model-value="
            draft.outputConflictPolicy = $event as DesktopQuickAction['outputConflictPolicy']
          "
        />
        <ToggleSwitch
          v-model="draft.options.allowEnlargement"
          label="放大小图"
          enabled-text="允许"
          disabled-text="不放大"
        />
        <SegmentedControl
          label="图片元数据"
          :model-value="draft.options.metadataMode"
          :options="[
            { value: 'colorProfile', label: '仅保留颜色配置' },
            { value: 'strip', label: '全部移除' },
            { value: 'all', label: '全部保留' }
          ]"
          @update:model-value="
            draft.options.metadataMode = $event as DesktopQuickAction['options']['metadataMode']
          "
        />
        <p class="text-xs text-muted-foreground">
          透明图片转 JPEG 时自动改为 PNG；动画图片会保留待处理并提示。
        </p>
        <div class="flex gap-2">
          <Button size="sm" type="submit">保存动作</Button>
          <Button size="sm" variant="secondary" type="button" @click="draft = null">取消</Button>
        </div>
      </form>

      <div class="flex flex-wrap gap-x-8 gap-y-4">
        <ToggleSwitch
          label="快捷处理完成通知"
          :model-value="desktop.notifyOnComplete"
          enabled-text="开启"
          disabled-text="关闭"
          @update:model-value="save({ notifyOnComplete: $event })"
        />
        <ToggleSwitch
          label="完成后显示结果"
          :model-value="desktop.revealOnComplete"
          enabled-text="开启"
          disabled-text="关闭"
          @update:model-value="save({ revealOnComplete: $event })"
        />
      </div>
      <p v-if="!isMac" class="text-xs text-muted-foreground">
        后台任务通过通知反馈；再次打开 VVTools 可查看当前批次。
      </p>
    </fieldset>
  </section>
</template>
