<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArrowDown,
  ArrowUp,
  Check,
  FilePenLine,
  Files,
  ListOrdered,
  Play,
  Plus,
  Trash2,
  TriangleAlert,
  X
} from '@lucide/vue'
import type {
  RenameFileInfo,
  RenameFileRequest,
  RenamePlanInspection,
  RenameBaseMode,
  RenameCaseMode,
  RenameDateFormat,
  RenameDatePosition,
  RenameDateSource,
  RenameMode,
  RenameSequencePosition,
  RenameSettings,
  RenameSortField
} from '../../../shared/types'
import { DEFAULT_RENAME_SETTINGS } from '../../../shared/constants'
import { useAppStore } from '../stores/app'
import { buildRenamePreview } from '../lib/rename-rules'
import { formatBytes } from '../lib/utils'
import AdvancedSettingsPanel from '../components/ui/AdvancedSettingsPanel.vue'
import AnimatedChevron from '../components/ui/AnimatedChevron.vue'
import Button from '../components/ui/Button.vue'
import DropFollowEffect from '../components/ui/DropFollowEffect.vue'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import ToggleSwitch from '../components/ui/ToggleSwitch.vue'

const store = useAppStore()
const advancedOpen = ref(false)
const dragging = ref(false)
const loadingFiles = ref(false)
const renaming = ref(false)
const settingsReady = ref(false)
const draft = ref<RenameSettings>({ ...DEFAULT_RENAME_SETTINGS })
const planByPath = ref(new Map<string, RenamePlanInspection>())
const planChecking = ref(false)
const resultMessage = ref('')
let settingsTimer: ReturnType<typeof setTimeout> | undefined
let planTimer: ReturnType<typeof setTimeout> | undefined
let planRequestId = 0
let settingsWrite = Promise.resolve()

const renameModeOptions = [
  { value: 'sequence', label: '顺序命名' },
  { value: 'custom', label: '自定义命名' }
]
const baseModeOptions = [
  { value: 'original', label: '保留原名' },
  { value: 'custom', label: '统一名称' }
]
const caseModeOptions = [
  { value: 'unchanged', label: '不变' },
  { value: 'lower', label: '小写' },
  { value: 'upper', label: '大写' },
  { value: 'title', label: '首字母大写' }
]
const positionOptions = [
  { value: 'prefix', label: '名称前' },
  { value: 'suffix', label: '名称后' }
]
const dateSourceOptions = [
  { value: 'none', label: '不添加' },
  { value: 'createdAt', label: '创建时间' },
  { value: 'modifiedAt', label: '修改时间' }
]
const dateFormatOptions = [
  { value: 'YYYYMMDD', label: '20260809' },
  { value: 'YYYY-MM-DD', label: '2026-08-09' },
  { value: 'YYYYMMDD-HHmmss', label: '精确到秒' }
]

const files = computed<RenameFileInfo[]>({
  get: () => store.pendingRenameFiles,
  set: (value) => (store.pendingRenameFiles = value)
})
const previewRows = computed(() =>
  buildRenamePreview(files.value, draft.value, window.api.platform)
)
const planKey = computed(() =>
  previewRows.value
    .map((row) => `${row.file.path}\u0000${row.targetName}\u0000${row.error ?? ''}`)
    .join('\u0001')
)
const rows = computed(() =>
  previewRows.value.map((row) => ({
    ...row,
    error: row.error ?? planByPath.value.get(row.file.path)?.error
  }))
)
const invalidCount = computed(() => rows.value.filter((row) => row.error).length)
const changedCount = computed(() => rows.value.filter((row) => row.changed && !row.error).length)
const canRename = computed(
  () =>
    files.value.length > 0 &&
    changedCount.value > 0 &&
    invalidCount.value === 0 &&
    !planChecking.value &&
    !renaming.value
)
const summary = computed(() => {
  if (files.value.length === 0) return resultMessage.value || '拖入文件后即可预览新名称'
  if (planChecking.value) return `${files.value.length} 个文件 · 正在检查名称冲突`
  if (invalidCount.value) return `${files.value.length} 个文件 · ${invalidCount.value} 个需要调整`
  if (changedCount.value === 0) return `${files.value.length} 个文件 · 名称没有变化`
  return `${files.value.length} 个文件 · ${changedCount.value} 个将被重命名`
})
const configSummary = computed(() => {
  if (draft.value.mode === 'sequence') return '按表格顺序生成 1、2、3、4…'
  const parts = [
    draft.value.baseMode === 'original'
      ? '保留原名称'
      : `统一为 ${draft.value.customName || '空名称'}`
  ]
  if (draft.value.prefix) parts.push(`前缀 ${draft.value.prefix}`)
  if (draft.value.suffix) parts.push(`后缀 ${draft.value.suffix}`)
  if (draft.value.sequenceEnabled) parts.push(`${draft.value.sequencePadding} 位顺序编号`)
  return parts.join(' · ')
})

watch(
  () => store.settings?.rename,
  (settings) => {
    if (!settings || settingsReady.value) return
    draft.value = { ...settings }
    settingsReady.value = true
  },
  { immediate: true }
)

watch(
  draft,
  () => {
    if (!settingsReady.value) return
    if (settingsTimer) clearTimeout(settingsTimer)
    settingsTimer = setTimeout(persistSettings, 250)
  },
  { deep: true }
)

watch(planKey, () => schedulePlanInspection(), { immediate: true })

function schedulePlanInspection(): void {
  if (planTimer) clearTimeout(planTimer)
  const requestId = ++planRequestId
  const requests = previewRows.value.map((row): RenameFileRequest => ({
    sourcePath: row.file.path,
    targetName: row.targetName
  }))
  if (requests.length === 0 || previewRows.value.some((row) => row.error)) {
    planByPath.value = new Map()
    planChecking.value = false
    return
  }
  planChecking.value = true
  planByPath.value = new Map()
  planTimer = setTimeout(async () => {
    try {
      const inspections = await window.api.inspectRenamePlan(requests)
      if (requestId !== planRequestId) return
      planByPath.value = new Map(
        inspections.map((inspection) => [inspection.sourcePath, inspection])
      )
    } catch (error) {
      if (requestId === planRequestId) {
        store.errorMessage = error instanceof Error ? error.message : String(error)
      }
    } finally {
      if (requestId === planRequestId) planChecking.value = false
    }
  }, 140)
}

function persistSettings(): void {
  const settings = { ...draft.value }
  settingsWrite = settingsWrite.then(() => store.updateSettings({ rename: settings }))
}

async function stagePaths(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  loadingFiles.value = true
  resultMessage.value = ''
  try {
    const result = await window.api.inspectRenameFiles(paths)
    const combined = new Map(files.value.map((file) => [file.path, file]))
    for (const file of result.files) combined.set(file.path, file)
    if (combined.size > 500) {
      store.errorMessage = '单次最多添加 500 个文件'
      return
    }
    files.value = [...combined.values()]
    if (result.rejected.length === 1) {
      store.errorMessage = `${result.rejected[0].path}：${result.rejected[0].reason}`
    } else if (result.rejected.length > 1) {
      store.errorMessage = `${result.rejected.length} 个项目未加入，仅支持普通文件`
    }
  } catch (error) {
    store.errorMessage = error instanceof Error ? error.message : String(error)
  } finally {
    loadingFiles.value = false
  }
}

async function chooseFiles(): Promise<void> {
  try {
    await stagePaths(await window.api.selectRenameFiles())
  } catch (error) {
    store.errorMessage = error instanceof Error ? error.message : String(error)
  }
}

async function executeRename(): Promise<void> {
  if (!canRename.value) return
  renaming.value = true
  const requests = rows.value.map((row): RenameFileRequest => ({
    sourcePath: row.file.path,
    targetName: row.targetName
  }))
  try {
    const results = await window.api.renameFiles(requests)
    const renamedCount = results.filter((result) => result.renamed).length
    files.value = []
    resultMessage.value = `已完成：${renamedCount} 个文件重命名成功`
  } catch (error) {
    store.errorMessage = error instanceof Error ? error.message : String(error)
    schedulePlanInspection()
  } finally {
    renaming.value = false
  }
}

function removeFile(path: string): void {
  files.value = files.value.filter((file) => file.path !== path)
}

function clearFiles(): void {
  files.value = []
  resultMessage.value = ''
}

function setMode(value: string | number): void {
  draft.value.mode = value as RenameMode
  if (draft.value.mode === 'sequence') advancedOpen.value = false
}

function setSort(field: RenameSortField): void {
  if (draft.value.sortField === field) {
    draft.value.sortDirection = draft.value.sortDirection === 'asc' ? 'desc' : 'asc'
  } else {
    draft.value.sortField = field
    draft.value.sortDirection = field === 'createdAt' || field === 'modifiedAt' ? 'desc' : 'asc'
  }
}

function sortLabel(field: RenameSortField): 'ascending' | 'descending' | 'none' {
  if (draft.value.sortField !== field) return 'none'
  return draft.value.sortDirection === 'asc' ? 'ascending' : 'descending'
}

function setNumber(
  key: 'sequenceStart' | 'sequenceStep' | 'sequencePadding',
  event: Event,
  minimum: number,
  maximum: number
): void {
  const input = event.target as HTMLInputElement
  const value = Number.parseInt(input.value, 10)
  draft.value[key] = Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : minimum
  input.value = String(draft.value[key])
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
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
  void stagePaths(
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
  if (settingsTimer) clearTimeout(settingsTimer)
  if (planTimer) clearTimeout(planTimer)
  if (settingsReady.value) persistSettings()
})
</script>

<template>
  <div
    class="video-drop-workspace rename-workspace"
    :class="{ 'video-drop-workspace-active': dragging }"
  >
    <DropFollowEffect :active="dragging" />

    <section v-if="settingsReady" class="video-config-panel" aria-label="批量重命名设置">
      <div class="video-config-heading">
        <div class="config-heading-main">
          <FilePenLine class="size-4 shrink-0 text-signal-strong" />
          <span class="shrink-0 text-sm font-semibold">批量重命名设置</span>
          <Button
            v-if="draft.mode === 'custom'"
            class="config-expand-toggle"
            variant="ghost"
            size="sm"
            :aria-expanded="advancedOpen"
            aria-controls="rename-advanced-settings"
            @click="advancedOpen = !advancedOpen"
          >
            {{ advancedOpen ? '收起设置' : '更多设置' }}
            <AnimatedChevron :expanded="advancedOpen" />
          </Button>
          <span class="config-summary truncate text-xs text-muted-foreground">
            {{ configSummary }}
          </span>
        </div>
        <div class="video-config-actions">
          <Button variant="secondary" size="sm" :disabled="loadingFiles" @click="chooseFiles">
            <Plus class="size-4" />{{ loadingFiles ? '正在读取…' : '添加文件' }}
          </Button>
          <Button v-if="files.length" variant="ghost" size="sm" @click="clearFiles">
            <Trash2 class="size-3.5" />清空
          </Button>
          <Button size="sm" :disabled="!canRename" @click="executeRename">
            <Play class="size-4" />{{
              renaming ? '正在重命名…' : `执行重命名${changedCount ? ` (${changedCount})` : ''}`
            }}
          </Button>
        </div>
      </div>

      <div class="rename-config-primary" :class="`rename-config-${draft.mode}`">
        <SegmentedControl
          class="rename-mode-segments"
          label="重命名方式"
          :model-value="draft.mode"
          :options="renameModeOptions"
          @update:model-value="setMode"
        />

        <div v-if="draft.mode === 'sequence'" class="rename-sequence-explainer">
          <ListOrdered class="size-4 shrink-0 text-signal-strong" />
          <div>
            <strong>按当前表格顺序编号</strong>
            <p>文件将命名为 1、2、3、4…，保留原扩展名；点击表头即可改变编号顺序。</p>
          </div>
        </div>

        <template v-else>
          <SegmentedControl
            label="名称来源"
            :model-value="draft.baseMode"
            :options="baseModeOptions"
            @update:model-value="draft.baseMode = $event as RenameBaseMode"
          />
          <label class="compact-field">
            <span>{{ draft.baseMode === 'custom' ? '统一名称' : '名称处理' }}</span>
            <input
              v-if="draft.baseMode === 'custom'"
              v-model="draft.customName"
              type="text"
              maxlength="200"
              placeholder="例如：产品图"
            />
            <span v-else class="rename-readonly-field">以每个文件的原名称为基础</span>
          </label>
          <label class="compact-field">
            <span>前缀</span>
            <input v-model="draft.prefix" type="text" maxlength="200" placeholder="例如：项目_" />
          </label>
          <label class="compact-field">
            <span>后缀</span>
            <input v-model="draft.suffix" type="text" maxlength="200" placeholder="例如：_最终版" />
          </label>
          <ToggleSwitch
            label="顺序编号"
            :model-value="draft.sequenceEnabled"
            enabled-text="添加编号"
            disabled-text="不添加编号"
            @update:model-value="draft.sequenceEnabled = $event"
          />
        </template>
      </div>

      <AdvancedSettingsPanel
        v-if="draft.mode === 'custom'"
        id="rename-advanced-settings"
        :open="advancedOpen"
      >
        <div class="rename-config-expanded">
          <fieldset class="config-group">
            <legend>查找与格式</legend>
            <div class="config-group-fields rename-format-fields">
              <label class="compact-field">
                <span>查找文字</span>
                <input
                  v-model="draft.findText"
                  type="text"
                  maxlength="200"
                  placeholder="留空则不替换"
                />
              </label>
              <label class="compact-field">
                <span>替换为</span>
                <input
                  v-model="draft.replaceText"
                  type="text"
                  maxlength="200"
                  placeholder="可留空以删除"
                />
              </label>
              <SegmentedControl
                class="rename-case-segments"
                label="大小写"
                :model-value="draft.caseMode"
                :options="caseModeOptions"
                @update:model-value="draft.caseMode = $event as RenameCaseMode"
              />
            </div>
          </fieldset>
          <fieldset class="config-group">
            <legend>顺序编号</legend>
            <div class="config-group-fields rename-sequence-fields">
              <SegmentedControl
                label="位置"
                :model-value="draft.sequencePosition"
                :options="positionOptions"
                :disabled="!draft.sequenceEnabled"
                @update:model-value="draft.sequencePosition = $event as RenameSequencePosition"
              />
              <label class="compact-field">
                <span>起始值</span>
                <input
                  :value="draft.sequenceStart"
                  type="number"
                  min="0"
                  max="999999"
                  :disabled="!draft.sequenceEnabled"
                  @change="setNumber('sequenceStart', $event, 0, 999999)"
                />
              </label>
              <label class="compact-field">
                <span>步长</span>
                <input
                  :value="draft.sequenceStep"
                  type="number"
                  min="1"
                  max="9999"
                  :disabled="!draft.sequenceEnabled"
                  @change="setNumber('sequenceStep', $event, 1, 9999)"
                />
              </label>
              <label class="compact-field">
                <span>位数</span>
                <input
                  :value="draft.sequencePadding"
                  type="number"
                  min="1"
                  max="8"
                  :disabled="!draft.sequenceEnabled"
                  @change="setNumber('sequencePadding', $event, 1, 8)"
                />
              </label>
              <label class="compact-field">
                <span>分隔符</span>
                <input v-model="draft.separator" type="text" maxlength="10" placeholder="_" />
              </label>
            </div>
          </fieldset>
          <fieldset class="config-group">
            <legend>日期</legend>
            <div class="config-group-fields rename-date-fields">
              <SegmentedControl
                label="日期来源"
                :model-value="draft.dateSource"
                :options="dateSourceOptions"
                @update:model-value="draft.dateSource = $event as RenameDateSource"
              />
              <SegmentedControl
                label="日期位置"
                :model-value="draft.datePosition"
                :options="positionOptions"
                :disabled="draft.dateSource === 'none'"
                @update:model-value="draft.datePosition = $event as RenameDatePosition"
              />
              <SegmentedControl
                label="日期格式"
                :model-value="draft.dateFormat"
                :options="dateFormatOptions"
                :disabled="draft.dateSource === 'none'"
                @update:model-value="draft.dateFormat = $event as RenameDateFormat"
              />
            </div>
          </fieldset>
        </div>
      </AdvancedSettingsPanel>
    </section>

    <div class="video-workspace-content workspace-scroll-content rename-workspace-content">
      <section
        v-if="files.length"
        class="batch-task-panel rename-list-panel"
        aria-labelledby="rename-list-title"
      >
        <header class="batch-task-header">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h2 id="rename-list-title">待重命名文件</h2>
              <span class="pending-count">{{ files.length }}</span>
            </div>
            <p>{{ summary }}</p>
          </div>
          <div class="rename-order-note">
            <ListOrdered class="size-4" />表格当前顺序就是编号顺序
          </div>
        </header>
        <div class="batch-task-table-wrap">
          <table class="batch-task-table rename-table">
            <thead>
              <tr>
                <th class="rename-col-order">顺序</th>
                <th :aria-sort="sortLabel('name')">
                  <button class="rename-sort-button" type="button" @click="setSort('name')">
                    当前名称
                    <component
                      :is="draft.sortDirection === 'asc' ? ArrowUp : ArrowDown"
                      v-if="draft.sortField === 'name'"
                      class="size-3"
                    />
                  </button>
                </th>
                <th>新名称</th>
                <th class="rename-col-extension" :aria-sort="sortLabel('extension')">
                  <button class="rename-sort-button" type="button" @click="setSort('extension')">
                    类型
                    <component
                      :is="draft.sortDirection === 'asc' ? ArrowUp : ArrowDown"
                      v-if="draft.sortField === 'extension'"
                      class="size-3"
                    />
                  </button>
                </th>
                <th class="rename-col-size" :aria-sort="sortLabel('size')">
                  <button class="rename-sort-button" type="button" @click="setSort('size')">
                    大小
                    <component
                      :is="draft.sortDirection === 'asc' ? ArrowUp : ArrowDown"
                      v-if="draft.sortField === 'size'"
                      class="size-3"
                    />
                  </button>
                </th>
                <th class="rename-col-date" :aria-sort="sortLabel('modifiedAt')">
                  <button class="rename-sort-button" type="button" @click="setSort('modifiedAt')">
                    修改时间
                    <component
                      :is="draft.sortDirection === 'asc' ? ArrowUp : ArrowDown"
                      v-if="draft.sortField === 'modifiedAt'"
                      class="size-3"
                    />
                  </button>
                </th>
                <th class="rename-col-date" :aria-sort="sortLabel('createdAt')">
                  <button class="rename-sort-button" type="button" @click="setSort('createdAt')">
                    创建时间
                    <component
                      :is="draft.sortDirection === 'asc' ? ArrowUp : ArrowDown"
                      v-if="draft.sortField === 'createdAt'"
                      class="size-3"
                    />
                  </button>
                </th>
                <th class="rename-col-status">状态</th>
                <th class="rename-col-action"><span class="sr-only">操作</span></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in rows"
                :key="row.file.path"
                :class="{ 'rename-row-invalid': row.error }"
              >
                <td class="rename-col-order">{{ row.position }}</td>
                <td>
                  <p class="rename-file-name" :title="row.file.name">{{ row.file.name }}</p>
                  <p class="rename-file-path" :title="row.file.path">{{ row.file.path }}</p>
                </td>
                <td>
                  <p
                    class="rename-target-name"
                    :class="{ 'semantic-danger': row.error }"
                    :title="row.targetName"
                  >
                    {{ row.targetName || '—' }}
                  </p>
                </td>
                <td class="rename-col-extension">
                  {{ row.file.extension.slice(1).toUpperCase() || '—' }}
                </td>
                <td class="rename-col-size">{{ formatBytes(row.file.size) }}</td>
                <td class="rename-col-date">{{ formatDateTime(row.file.modifiedAt) }}</td>
                <td class="rename-col-date">{{ formatDateTime(row.file.createdAt) }}</td>
                <td class="rename-col-status">
                  <span
                    v-if="row.error"
                    class="rename-status rename-status-error"
                    :title="row.error"
                  >
                    <TriangleAlert class="size-3.5" />{{ row.error }}
                  </span>
                  <span v-else-if="planChecking" class="rename-status">检查中</span>
                  <span v-else-if="!row.changed" class="rename-status">无需更改</span>
                  <span v-else class="rename-status rename-status-ready"
                    ><Check class="size-3.5" />可重命名</span
                  >
                </td>
                <td class="rename-col-action">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="移除此文件"
                    @click="removeFile(row.file.path)"
                  >
                    <X class="size-4" />
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <button
        v-else
        type="button"
        class="video-drop-prompt"
        :class="{ 'video-drop-prompt-active': dragging }"
        @click="chooseFiles"
      >
        <span class="video-drop-icon"><Files class="size-7" /></span>
        <span class="text-lg font-semibold">{{ resultMessage || '拖入需要重命名的文件' }}</span>
        <span class="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          支持不同类型、不同文件夹的普通文件；点击名称、大小、创建时间或修改时间即可调整编号顺序。
        </span>
        <span class="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-signal-strong">
          <Plus class="size-4" />选择文件
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.rename-config-primary {
  display: grid;
  grid-template-columns:
    minmax(170px, 1.05fr) minmax(145px, 0.9fr) minmax(165px, 1fr) minmax(130px, 0.85fr)
    minmax(130px, 0.85fr) minmax(135px, 0.8fr);
  gap: 12px;
  border-top: 1px solid var(--border);
  padding: 12px 16px 14px;
}

.rename-config-sequence {
  grid-template-columns: minmax(210px, 0.55fr) minmax(420px, 1.45fr);
}

.rename-mode-segments {
  min-width: 0;
}

.rename-sequence-explainer {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--signal-soft) 44%, var(--background));
  padding: 8px 12px;
}

.rename-sequence-explainer strong {
  display: block;
  font-size: 12px;
}

.rename-sequence-explainer p {
  margin-top: 2px;
  color: var(--muted-foreground);
  font-size: 11px;
  line-height: 1.45;
}

.rename-readonly-field {
  display: flex;
  height: 32px;
  align-items: center;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: color-mix(in srgb, var(--muted) 32%, var(--background));
  padding: 0 8px;
  color: var(--muted-foreground);
  font-size: 11px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rename-config-expanded {
  position: absolute;
  z-index: 15;
  top: calc(100% + 8px);
  right: 0;
  left: 0;
  display: grid;
  grid-template-columns: 1.05fr 1.45fr 0.9fr;
  gap: 20px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-raised);
  padding: 16px;
  box-shadow: var(--shadow-floating);
}

.rename-format-fields {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.rename-format-fields .rename-case-segments {
  grid-column: 1 / -1;
}

.rename-sequence-fields {
  grid-template-columns: repeat(3, minmax(72px, 1fr));
}

.rename-date-fields {
  grid-template-columns: 1fr;
}

.rename-workspace-content {
  overflow: hidden;
}

.rename-list-panel {
  width: 100%;
}

.rename-order-note {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted-foreground);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.rename-table {
  min-width: 1280px;
}

.rename-table th:nth-child(2),
.rename-table td:nth-child(2) {
  width: 21%;
}

.rename-table th:nth-child(3),
.rename-table td:nth-child(3) {
  width: 21%;
}

.rename-col-order {
  width: 5%;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.rename-col-extension {
  width: 7%;
}

.rename-col-size {
  width: 8%;
  font-variant-numeric: tabular-nums;
}

.rename-col-date {
  width: 12%;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.rename-col-status {
  width: 11%;
}

.rename-col-action {
  width: 4%;
  text-align: right;
}

.rename-sort-button {
  display: inline-flex;
  height: 28px;
  align-items: center;
  gap: 4px;
  border-radius: 6px;
  color: inherit;
  font: inherit;
}

.rename-sort-button:hover,
.rename-sort-button:focus-visible {
  color: var(--foreground);
}

.rename-sort-button:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.rename-file-name,
.rename-target-name,
.rename-file-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rename-file-name,
.rename-target-name {
  font-weight: 600;
}

.rename-target-name {
  color: var(--signal-strong);
}

.rename-file-path {
  margin-top: 2px;
  color: var(--muted-foreground);
  font-size: 10px;
}

.rename-status {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  color: var(--muted-foreground);
  font-size: 11px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rename-status-ready {
  color: var(--success-fg);
}

.rename-status-error {
  color: var(--danger-fg);
}

.rename-row-invalid,
.rename-row-invalid:hover {
  background: color-mix(in srgb, var(--danger-bg) 55%, transparent);
}

@media (max-width: 1280px) {
  .rename-config-primary {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .rename-config-sequence {
    grid-template-columns: minmax(190px, 0.65fr) minmax(360px, 1.35fr);
  }

  .rename-config-expanded {
    grid-template-columns: 1fr;
    max-height: min(62vh, 520px);
    overflow: auto;
  }

  .rename-config-expanded :deep(.config-group + .config-group) {
    border-top: 1px solid var(--border);
    border-left: 0;
    padding-top: 16px;
    padding-left: 0;
  }
}

@media (max-width: 920px) {
  .rename-config-primary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .rename-config-sequence {
    grid-template-columns: 1fr;
  }

  .rename-format-fields,
  .rename-sequence-fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
