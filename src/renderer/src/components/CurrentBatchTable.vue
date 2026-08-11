<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowRight,
  Ban,
  Check,
  CheckCircle2,
  Circle,
  CircleEllipsis,
  Clock3,
  FolderOpen,
  RefreshCcw,
  TriangleAlert,
  X,
  XCircle
} from '@lucide/vue'
import type {
  FontOptions,
  MediaTask,
  PdfOptions,
  SpriteOptions,
  TaskKind,
  TaskStatus
} from '../../../shared/types'
import { useAppStore } from '../stores/app'
import { taskProgressText, taskProgressValue } from '../lib/task-progress'
import { fileName, formatBytes } from '../lib/utils'
import Badge from './ui/Badge.vue'
import Button from './ui/Button.vue'
import Modal from './ui/Modal.vue'
import Progress from './ui/Progress.vue'

export interface PendingBatchItem {
  id?: string
  path: string
  label?: string
  spec?: string
  compression?: string
  sourceSize?: number
  metadataLoading?: boolean
  metadataError?: string
}

interface BatchRow {
  key: string
  pending?: PendingBatchItem
  task?: MediaTask
}

const props = defineProps<{
  kind: TaskKind
  pendingItems: PendingBatchItem[]
  tasks: MediaTask[]
}>()

defineEmits<{
  removePending: [idOrPath: string]
}>()

const store = useAppStore()
const selectedFailure = ref<MediaTask | null>(null)

const statusMeta: Record<
  TaskStatus,
  {
    label: string
    tone: 'neutral' | 'info' | 'success' | 'danger' | 'warning'
    icon: typeof Clock3
  }
> = {
  pending: { label: '等待中', tone: 'neutral', icon: Clock3 },
  processing: { label: '处理中', tone: 'info', icon: CircleEllipsis },
  completed: { label: '已完成', tone: 'success', icon: CheckCircle2 },
  skipped: { label: '已跳过', tone: 'warning', icon: TriangleAlert },
  failed: { label: '失败', tone: 'danger', icon: TriangleAlert },
  cancelled: { label: '已取消', tone: 'warning', icon: Ban }
}

const rows = computed<BatchRow[]>(() => {
  const result: BatchRow[] = props.pendingItems.map((pending) => ({
    key: pending.id ?? pending.path,
    pending
  }))
  const indexes = new Map(result.map((row, index) => [row.key, index]))
  for (const task of props.tasks) {
    const key = task.batchItemId ?? task.id
    const index = indexes.get(key)
    if (index === undefined) {
      indexes.set(key, result.length)
      result.push({ key, task })
    } else {
      result[index] = { ...result[index], task }
    }
  }
  return result
})
const totalCount = computed(() => rows.value.length)
const pendingCount = computed(() => rows.value.filter((row) => !row.task).length)
const activeCount = computed(
  () => props.tasks.filter((task) => ['pending', 'processing'].includes(task.status)).length
)
const completedCount = computed(
  () => props.tasks.filter((task) => task.status === 'completed').length
)
const skippedCount = computed(() => props.tasks.filter((task) => task.status === 'skipped').length)
const failedCount = computed(() => props.tasks.filter((task) => task.status === 'failed').length)
const cancelledCount = computed(
  () => props.tasks.filter((task) => task.status === 'cancelled').length
)
const batchSavings = computed(() => {
  const completedTasks = props.tasks.filter(
    (task) => task.status === 'completed' && task.outputSize !== undefined
  )
  if (!completedTasks.length) return null

  const sourceSize = completedTasks.reduce((total, task) => total + task.sourceSize, 0)
  const outputSize = completedTasks.reduce((total, task) => total + (task.outputSize ?? 0), 0)
  const difference = sourceSize - outputSize
  const percentage = sourceSize > 0 ? (Math.abs(difference) / sourceSize) * 100 : 0

  return { sourceSize, outputSize, difference, percentage }
})
const kindLabel = computed(
  () =>
    ({ image: '图片', video: '视频', sprite: '雪碧图', audio: '音频', pdf: 'PDF', font: '字体' })[
      props.kind
    ]
)
const summary = computed(() => {
  const parts: string[] = []
  if (pendingCount.value) parts.push(`${pendingCount.value} 个待开始`)
  if (activeCount.value) parts.push(`${activeCount.value} 个处理中或等待`)
  if (completedCount.value) parts.push(`${completedCount.value} 个已完成`)
  if (skippedCount.value) parts.push(`${skippedCount.value} 个已跳过`)
  if (failedCount.value) parts.push(`${failedCount.value} 个失败`)
  if (cancelledCount.value) parts.push(`${cancelledCount.value} 个已取消`)
  return parts.join(' · ') || '当前批次暂无任务'
})

function extension(path: string): string {
  return path.split('.').pop()?.toUpperCase() || '—'
}

function taskSpec(task: MediaTask): string {
  if (task.kind === 'sprite') {
    const options = task.options as SpriteOptions
    return `${task.outputPaths?.length ?? 1} 张 · ${options.imageFormat.toUpperCase()} · ${options.frameWidth}px`
  }
  if (task.kind === 'font') {
    const format = (task.options as FontOptions).outputFormat.toUpperCase()
    if (task.fontIndex !== undefined) return `${format} · 集合字体 ${task.fontIndex + 1}`
    if (task.fontInstance) return `${format} · ${task.fontInstance.name}`
    return format
  }
  if (task.kind === 'pdf' && (task.options as PdfOptions).operation === 'toImage') {
    const format = (task.options as PdfOptions).imageFormat.toUpperCase()
    if (task.pageNumbers?.length) return `${task.pageNumbers.length} 页 · ${format}`
  }
  if (task.pageNumber !== undefined) return `第 ${task.pageNumber} 页`
  if (task.sourceWidth && task.sourceHeight) return `${task.sourceWidth} × ${task.sourceHeight}`
  return extension(task.sourcePath)
}

function taskLabel(task: MediaTask): string {
  return task.relativeDirectory
    ? `${task.relativeDirectory}/${fileName(task.sourcePath)}`
    : fileName(task.sourcePath)
}

function taskFontCompression(task: MediaTask): string {
  if (task.kind !== 'font') return '—'
  const options = task.options as FontOptions
  if (options.operation !== 'subset') return '不压缩'
  if (options.subsetMode === 'latin') return '西文基础'
  if (options.subsetMode === 'chinese') return `中文 ${options.subsetChineseLevel}`
  return '自定义'
}
</script>

<template>
  <section class="batch-task-panel" aria-labelledby="current-batch-title">
    <header class="batch-task-header">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <h2 id="current-batch-title">当前{{ kindLabel }}任务</h2>
          <span class="pending-count">{{ totalCount }}</span>
        </div>
        <p>{{ summary }}</p>
      </div>
      <div v-if="batchSavings" class="batch-savings-summary">
        <span
          >转换前 <strong>{{ formatBytes(batchSavings.sourceSize) }}</strong></span
        >
        <ArrowRight class="size-3.5" />
        <span
          >转换后 <strong>{{ formatBytes(batchSavings.outputSize) }}</strong></span
        >
        <span
          class="batch-savings-total"
          :class="batchSavings.difference >= 0 ? 'semantic-success' : 'semantic-warning'"
        >
          {{
            batchSavings.difference >= 0
              ? `节省 ${formatBytes(batchSavings.difference)}`
              : `增加 ${formatBytes(Math.abs(batchSavings.difference))}`
          }}
          · {{ Math.round(batchSavings.percentage) }}%
        </span>
      </div>
      <div class="batch-task-actions">
        <slot name="actions" />
      </div>
    </header>

    <div class="batch-task-table-wrap">
      <table class="batch-task-table" :class="{ 'batch-task-table-font': kind === 'font' }">
        <thead>
          <tr>
            <th class="batch-col-name">名称</th>
            <th class="batch-col-size">转换前 → 转换后</th>
            <th class="batch-col-spec">{{ kind === 'font' ? '输出格式' : '规格' }}</th>
            <th v-if="kind === 'font'" class="batch-col-font-compression">压缩</th>
            <th class="batch-col-progress">进度</th>
            <th class="batch-col-status">状态</th>
            <th class="batch-col-actions"><span class="sr-only">操作</span></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.key"
            :class="{ 'batch-task-row-skipped': row.task?.status === 'skipped' }"
          >
            <td class="batch-col-name">
              <div class="batch-file-cell">
                <component
                  :is="
                    row.task?.status === 'completed'
                      ? Check
                      : row.task
                        ? statusMeta[row.task.status].icon
                        : Circle
                  "
                  class="batch-status-icon"
                  :class="{
                    'text-muted-foreground': !row.task,
                    'semantic-success': row.task?.status === 'completed',
                    'text-signal-strong': row.task?.status === 'processing',
                    'semantic-warning': row.task?.status === 'skipped',
                    'semantic-danger': row.task?.status === 'failed'
                  }"
                />
                <div class="min-w-0">
                  <p
                    class="truncate font-medium"
                    :title="row.task?.sourcePath ?? row.pending?.path"
                  >
                    {{
                      row.task
                        ? taskLabel(row.task)
                        : row.pending?.label || fileName(row.pending?.path ?? '')
                    }}
                  </p>
                  <p
                    class="batch-file-path truncate"
                    :title="row.task?.sourcePath ?? row.pending?.path"
                  >
                    {{ row.task?.sourcePath ?? row.pending?.path }}
                  </p>
                </div>
              </div>
            </td>
            <td class="batch-col-size" :class="{ 'text-muted-foreground': !row.task }">
              <div v-if="row.task" class="batch-size-cell">
                <span
                  :class="{
                    'line-through text-muted-foreground':
                      row.task.status === 'completed' && row.task.outputSize !== undefined
                  }"
                >
                  {{ formatBytes(row.task.sourceSize) }}
                </span>
                <span v-if="row.task.outputSize !== undefined">
                  {{ formatBytes(row.task.outputSize) }}
                </span>
              </div>
              <div
                v-else-if="row.pending"
                class="batch-size-cell"
                :title="row.pending.metadataError"
              >
                <span>
                  {{
                    row.pending.metadataLoading ? '读取中…' : formatBytes(row.pending.sourceSize)
                  }}
                </span>
                <ArrowRight class="size-3.5" />
                <span>—</span>
              </div>
            </td>
            <td class="batch-col-spec">
              <template v-if="row.task">{{ taskSpec(row.task) }}</template>
              <slot v-else-if="row.pending" name="pending-spec" :item="row.pending">
                {{
                  row.pending.metadataLoading
                    ? '读取中…'
                    : row.pending.spec || extension(row.pending.path)
                }}
              </slot>
            </td>
            <td v-if="kind === 'font'" class="batch-col-font-compression">
              <template v-if="row.task">{{ taskFontCompression(row.task) }}</template>
              <slot v-else-if="row.pending" name="pending-font-compression" :item="row.pending">
                {{ row.pending.compression || '—' }}
              </slot>
            </td>
            <td class="batch-col-progress">
              <div v-if="row.task" class="batch-progress-cell">
                <Progress :value="taskProgressValue(row.task)" />
                <span>{{ taskProgressText(row.task) }}</span>
              </div>
              <div v-else class="batch-progress-cell">
                <Progress :value="0" />
                <span>0%</span>
              </div>
              <p
                v-if="row.task?.failure"
                class="batch-failure-message"
                :title="row.task.failure.message"
              >
                {{ row.task.failure.message }}
              </p>
            </td>
            <td class="batch-col-status">
              <Badge
                v-if="row.task"
                :tone="statusMeta[row.task.status].tone"
                :title="row.task.skippedReason"
              >
                <component :is="statusMeta[row.task.status].icon" class="mr-1 size-3" />
                {{ statusMeta[row.task.status].label }}
              </Badge>
              <Badge v-else tone="neutral"><Clock3 class="mr-1 size-3" />待开始</Badge>
            </td>
            <td class="batch-col-actions">
              <div v-if="row.task" class="flex justify-end gap-1">
                <Button
                  v-if="row.task.status === 'pending' || row.task.status === 'processing'"
                  variant="ghost"
                  size="icon"
                  title="取消任务"
                  @click="store.cancelTask(row.task.id)"
                >
                  <XCircle class="size-4" />
                </Button>
                <Button
                  v-if="row.task.status === 'failed'"
                  variant="ghost"
                  size="icon"
                  title="查看失败原因"
                  @click="selectedFailure = row.task"
                >
                  <TriangleAlert class="size-4" />
                </Button>
                <Button
                  v-if="row.task.status === 'failed'"
                  variant="ghost"
                  size="icon"
                  title="重试任务"
                  @click="store.retryTask(row.task.id)"
                >
                  <RefreshCcw class="size-4" />
                </Button>
                <Button
                  v-if="row.task.status === 'completed'"
                  variant="ghost"
                  size="icon"
                  title="打开输出位置"
                  @click="store.openTaskOutput(row.task.id)"
                >
                  <FolderOpen class="size-4" />
                </Button>
              </div>
              <Button
                v-else-if="row.pending"
                variant="ghost"
                size="icon"
                title="移除"
                :aria-label="`移除 ${row.pending.label || fileName(row.pending.path)}${row.pending.spec ? `（${row.pending.spec}）` : ''}`"
                @click="$emit('removePending', row.pending.id ?? row.pending.path)"
              >
                <X class="size-4" />
              </Button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <Modal
    :open="Boolean(selectedFailure)"
    title="任务失败详情"
    description="以下信息用于定位媒体处理失败原因。"
    @update:open="!$event && (selectedFailure = null)"
  >
    <div v-if="selectedFailure?.failure" class="mt-5 space-y-4 text-sm">
      <div class="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">
        {{ selectedFailure.failure.message }}
        <span v-if="selectedFailure.failure.exitCode !== undefined">
          （退出码 {{ selectedFailure.failure.exitCode }}）
        </span>
      </div>
      <div>
        <p class="mb-1 text-xs font-medium text-muted-foreground">源文件</p>
        <p class="break-all font-mono text-xs">{{ selectedFailure.sourcePath }}</p>
      </div>
      <div v-if="selectedFailure.failure.stderrTail">
        <p class="mb-1 text-xs font-medium text-muted-foreground">错误日志</p>
        <pre
          class="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-950 p-3 text-xs text-slate-100"
          >{{ selectedFailure.failure.stderrTail }}</pre>
      </div>
    </div>
  </Modal>
</template>
