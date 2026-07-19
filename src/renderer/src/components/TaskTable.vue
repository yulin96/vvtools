<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Ban,
  CheckCircle2,
  CircleEllipsis,
  Clock3,
  FolderOpen,
  RefreshCcw,
  TriangleAlert,
  XCircle
} from '@lucide/vue'
import type { MediaTask, TaskStatus } from '../../../shared/types'
import { useAppStore } from '../stores/app'
import { fileName, formatBytes } from '../lib/utils'
import Button from './ui/Button.vue'
import Badge from './ui/Badge.vue'
import Progress from './ui/Progress.vue'
import Modal from './ui/Modal.vue'

const props = defineProps<{ tasks: MediaTask[]; emptyText?: string }>()
const store = useAppStore()
const selectedFailure = ref<MediaTask | null>(null)

const sortedTasks = computed(() =>
  [...props.tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
)

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
  failed: { label: '失败', tone: 'danger', icon: TriangleAlert },
  cancelled: { label: '已取消', tone: 'warning', icon: Ban }
}

function outputFormat(task: MediaTask): string {
  return task.outputPath.split('.').pop()?.toUpperCase() || '—'
}
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-border bg-background">
    <div
      v-if="sortedTasks.length === 0"
      class="flex min-h-36 flex-col items-center justify-center px-6 text-center"
    >
      <Clock3 class="mb-3 size-6 text-muted-foreground/60" />
      <p class="text-sm font-medium text-foreground">{{ emptyText || '暂无任务' }}</p>
      <p class="mt-1 text-xs text-muted-foreground">导入文件后，处理状态会显示在这里。</p>
    </div>
    <div v-else class="overflow-x-auto">
      <table class="task-table w-full min-w-[620px] table-fixed text-left text-sm">
        <thead class="border-b border-border bg-muted/45 text-xs text-muted-foreground">
          <tr>
            <th class="task-col-file w-[31%] px-4 py-2.5 font-medium">文件</th>
            <th class="task-col-format w-[10%] px-3 py-2.5 font-medium">格式</th>
            <th class="task-col-status w-[13%] px-3 py-2.5 font-medium">状态</th>
            <th class="task-col-progress w-[22%] px-3 py-2.5 font-medium">进度</th>
            <th class="task-col-result w-[10%] px-3 py-2.5 font-medium">结果</th>
            <th class="task-col-actions w-[14%] px-4 py-2.5 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-for="task in sortedTasks" :key="task.id" class="hover:bg-muted/25">
            <td class="task-col-file px-4 py-3">
              <p class="truncate font-medium text-foreground" :title="task.sourcePath">
                {{ fileName(task.sourcePath) }}
              </p>
              <p
                class="task-source-path mt-0.5 truncate text-xs text-muted-foreground"
                :title="task.sourcePath"
              >
                {{ task.sourcePath }}
              </p>
            </td>
            <td class="task-col-format px-3 py-3 font-mono text-xs text-muted-foreground">
              {{ outputFormat(task) }}
            </td>
            <td class="task-col-status px-3 py-3">
              <Badge :tone="statusMeta[task.status].tone">
                <component :is="statusMeta[task.status].icon" class="mr-1 size-3" />
                {{ statusMeta[task.status].label }}
              </Badge>
            </td>
            <td class="task-col-progress px-3 py-3">
              <div class="flex items-center gap-2">
                <Progress :value="task.progress" />
                <span class="w-9 text-right text-xs tabular-nums text-muted-foreground">
                  {{ task.progress === null ? '—' : `${Math.round(task.progress)}%` }}
                </span>
              </div>
              <p
                v-if="task.failure"
                class="mt-1 truncate text-xs text-destructive"
                :title="task.failure.message"
              >
                {{ task.failure.message }}
              </p>
            </td>
            <td class="task-col-result px-3 py-3 text-xs text-muted-foreground">
              {{ task.status === 'completed' ? formatBytes(task.outputSize) : '—' }}
            </td>
            <td class="task-col-actions px-4 py-3">
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
  </div>

  <Modal
    :open="Boolean(selectedFailure)"
    title="任务失败详情"
    description="以下信息用于定位媒体处理失败原因。"
    @update:open="!$event && (selectedFailure = null)"
  >
    <div v-if="selectedFailure?.failure" class="mt-5 space-y-4 text-sm">
      <div class="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">
        {{ selectedFailure.failure.message }}
        <span v-if="selectedFailure.failure.exitCode !== undefined"
          >（退出码 {{ selectedFailure.failure.exitCode }}）</span
        >
      </div>
      <div>
        <p class="mb-1 text-xs font-medium text-muted-foreground">源文件</p>
        <p class="break-all font-mono text-xs">{{ selectedFailure.sourcePath }}</p>
      </div>
      <div>
        <p class="mb-1 text-xs font-medium text-muted-foreground">输出文件</p>
        <p class="break-all font-mono text-xs">{{ selectedFailure.outputPath }}</p>
      </div>
      <div v-if="selectedFailure.failure.command">
        <p class="mb-1 text-xs font-medium text-muted-foreground">执行命令</p>
        <pre
          class="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-950 p-3 text-xs text-slate-100"
          >{{ selectedFailure.failure.command.display }}</pre>
      </div>
      <div v-if="selectedFailure.failure.stderrTail">
        <p class="mb-1 text-xs font-medium text-muted-foreground">错误日志</p>
        <pre
          class="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-950 p-3 text-xs text-slate-100"
          >{{ selectedFailure.failure.stderrTail }}</pre>
      </div>
      <div v-if="selectedFailure.failure.logPath">
        <p class="mb-1 text-xs font-medium text-muted-foreground">日志文件</p>
        <p class="break-all font-mono text-xs">{{ selectedFailure.failure.logPath }}</p>
      </div>
    </div>
  </Modal>
</template>
