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

const props = defineProps<{
  kind: TaskKind
  pendingItems: PendingBatchItem[]
  tasks: MediaTask[]
}>()

const emit = defineEmits<{
  removePending: [idOrPath: string]
  reprocessCompleted: [tasks: MediaTask[]]
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

const totalCount = computed(() => props.pendingItems.length + props.tasks.length)
const activeCount = computed(
  () => props.tasks.filter((task) => ['pending', 'processing'].includes(task.status)).length
)
const completedCount = computed(
  () => props.tasks.filter((task) => task.status === 'completed').length
)
const completedTasks = computed(() => props.tasks.filter((task) => task.status === 'completed'))
const canReprocessCompleted = computed(
  () =>
    completedTasks.value.length > 0 && activeCount.value === 0 && props.pendingItems.length === 0
)
const skippedCount = computed(() => props.tasks.filter((task) => task.status === 'skipped').length)
const failedCount = computed(() => props.tasks.filter((task) => task.status === 'failed').length)
const cancelledCount = computed(
  () => props.tasks.filter((task) => task.status === 'cancelled').length
)
const orderedTasks = computed(() => {
  const priority: Record<TaskStatus, number> = {
    processing: 0,
    pending: 1,
    failed: 2,
    skipped: 3,
    cancelled: 4,
    completed: 5
  }

  return [...props.tasks].sort(
    (left, right) =>
      priority[left.status] - priority[right.status] ||
      left.createdAt.localeCompare(right.createdAt)
  )
})
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
  () => ({ image: '图片', video: '视频', audio: '音频', pdf: 'PDF', font: '字体' })[props.kind]
)
const summary = computed(() => {
  const parts: string[] = []
  if (props.pendingItems.length) parts.push(`${props.pendingItems.length} 个待开始`)
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

function taskFontCompression(task: MediaTask): string {
  if (task.kind !== 'font') return '—'
  const options = task.options as FontOptions
  if (options.operation !== 'subset') return '不压缩'
  if (options.subsetMode === 'latin') return '西文基础'
  if (options.subsetMode === 'chinese') return `中文 ${options.subsetChineseLevel}`
  return '自定义'
}

function reprocessCompleted(): void {
  emit('reprocessCompleted', completedTasks.value)
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
        <Button
          v-if="canReprocessCompleted"
          variant="secondary"
          size="sm"
          title="将已完成任务的源文件重新加入待处理列表，可修改参数后再次开始"
          @click="reprocessCompleted"
        >
          <RefreshCcw class="size-3.5" />再次处理
        </Button>
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
          <tr v-for="item in pendingItems" :key="`pending:${item.id ?? item.path}`">
            <td class="batch-col-name">
              <div class="batch-file-cell">
                <Circle class="batch-status-icon text-muted-foreground" />
                <div class="min-w-0">
                  <p class="truncate font-medium" :title="item.path">
                    {{ item.label || fileName(item.path) }}
                  </p>
                  <p class="batch-file-path truncate" :title="item.path">{{ item.path }}</p>
                </div>
              </div>
            </td>
            <td class="batch-col-size text-muted-foreground">
              <div class="batch-size-cell" :title="item.metadataError">
                <span>{{ item.metadataLoading ? '读取中…' : formatBytes(item.sourceSize) }}</span>
                <ArrowRight class="size-3.5" />
                <span>—</span>
              </div>
            </td>
            <td class="batch-col-spec">
              <slot name="pending-spec" :item="item">
                {{ item.metadataLoading ? '读取中…' : item.spec || extension(item.path) }}
              </slot>
            </td>
            <td v-if="kind === 'font'" class="batch-col-font-compression">
              <slot name="pending-font-compression" :item="item">
                {{ item.compression || '—' }}
              </slot>
            </td>
            <td class="batch-col-progress">
              <div class="batch-progress-cell">
                <Progress :value="0" />
                <span>0%</span>
              </div>
            </td>
            <td class="batch-col-status">
              <Badge tone="neutral"><Clock3 class="mr-1 size-3" />待开始</Badge>
            </td>
            <td class="batch-col-actions">
              <Button
                variant="ghost"
                size="icon"
                title="移除"
                :aria-label="`移除 ${item.label || fileName(item.path)}${item.spec ? `（${item.spec}）` : ''}`"
                @click="$emit('removePending', item.id ?? item.path)"
              >
                <X class="size-4" />
              </Button>
            </td>
          </tr>

          <tr
            v-for="task in orderedTasks"
            :key="task.id"
            :class="{ 'batch-task-row-skipped': task.status === 'skipped' }"
          >
            <td class="batch-col-name">
              <div class="batch-file-cell">
                <component
                  :is="task.status === 'completed' ? Check : statusMeta[task.status].icon"
                  class="batch-status-icon"
                  :class="{
                    'semantic-success': task.status === 'completed',
                    'text-signal-strong': task.status === 'processing',
                    'semantic-warning': task.status === 'skipped',
                    'semantic-danger': task.status === 'failed'
                  }"
                />
                <div class="min-w-0">
                  <p class="truncate font-medium" :title="task.sourcePath">
                    {{ fileName(task.sourcePath) }}
                  </p>
                  <p class="batch-file-path truncate" :title="task.sourcePath">
                    {{ task.sourcePath }}
                  </p>
                </div>
              </div>
            </td>
            <td class="batch-col-size">
              <div class="batch-size-cell">
                <span
                  :class="{
                    'line-through text-muted-foreground':
                      task.status === 'completed' && task.outputSize !== undefined
                  }"
                >
                  {{ formatBytes(task.sourceSize) }}
                </span>
                <span v-if="task.outputSize !== undefined">{{ formatBytes(task.outputSize) }}</span>
              </div>
            </td>
            <td class="batch-col-spec">{{ taskSpec(task) }}</td>
            <td v-if="kind === 'font'" class="batch-col-font-compression">
              {{ taskFontCompression(task) }}
            </td>
            <td class="batch-col-progress">
              <div class="batch-progress-cell">
                <Progress :value="taskProgressValue(task)" />
                <span>{{ taskProgressText(task) }}</span>
              </div>
              <p v-if="task.failure" class="batch-failure-message" :title="task.failure.message">
                {{ task.failure.message }}
              </p>
            </td>
            <td class="batch-col-status">
              <Badge :tone="statusMeta[task.status].tone" :title="task.skippedReason">
                <component :is="statusMeta[task.status].icon" class="mr-1 size-3" />
                {{ statusMeta[task.status].label }}
              </Badge>
            </td>
            <td class="batch-col-actions">
              <div class="flex justify-end gap-1">
                <Button
                  v-if="task.status === 'pending' || task.status === 'processing'"
                  variant="ghost"
                  size="icon"
                  title="取消任务"
                  @click="store.cancelTask(task.id)"
                >
                  <XCircle class="size-4" />
                </Button>
                <Button
                  v-if="task.status === 'failed'"
                  variant="ghost"
                  size="icon"
                  title="查看失败原因"
                  @click="selectedFailure = task"
                >
                  <TriangleAlert class="size-4" />
                </Button>
                <Button
                  v-if="task.status === 'failed'"
                  variant="ghost"
                  size="icon"
                  title="重试任务"
                  @click="store.retryTask(task.id)"
                >
                  <RefreshCcw class="size-4" />
                </Button>
                <Button
                  v-if="task.status === 'completed'"
                  variant="ghost"
                  size="icon"
                  title="打开输出位置"
                  @click="store.openTaskOutput(task.id)"
                >
                  <FolderOpen class="size-4" />
                </Button>
              </div>
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
