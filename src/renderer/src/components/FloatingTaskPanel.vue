<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, ChevronUp, ListTodo } from '@lucide/vue'
import type { MediaTask } from '../../../shared/types'
import { useAppStore } from '../stores/app'
import { fileName } from '../lib/utils'
import Badge from './ui/Badge.vue'
import Button from './ui/Button.vue'
import Progress from './ui/Progress.vue'
import TaskTable from './TaskTable.vue'

const store = useAppStore()
const expanded = ref(false)

const activeTask = computed<MediaTask | undefined>(
  () =>
    store.tasks.find((task) => task.status === 'processing') ??
    store.tasks.find((task) => task.status === 'pending') ??
    [...store.tasks].reverse().find((task) => ['failed', 'completed'].includes(task.status))
)
const activeCount = computed(
  () => store.tasks.filter((task) => ['pending', 'processing'].includes(task.status)).length
)
const completedCount = computed(
  () => store.tasks.filter((task) => task.status === 'completed').length
)

const statusLabel = computed(() => {
  const status = activeTask.value?.status
  if (!status) return '暂无任务'
  return {
    pending: '等待中',
    processing: '处理中',
    completed: '已完成',
    failed: '处理失败',
    cancelled: '已取消'
  }[status]
})
</script>

<template>
  <section
    class="floating-task-panel"
    :class="{ 'floating-task-panel-expanded': expanded }"
    aria-label="任务进度"
  >
    <header class="floating-task-header">
      <div class="flex min-w-0 items-center gap-2.5">
        <ListTodo class="size-4 shrink-0 text-signal-strong" />
        <div class="min-w-0">
          <p class="text-sm font-semibold">任务进度</p>
          <p v-if="expanded" class="text-xs text-muted-foreground">
            {{ activeCount }} 个进行中 · {{ completedCount }} 个已完成
          </p>
        </div>
      </div>
      <Button variant="ghost" size="sm" :aria-expanded="expanded" @click="expanded = !expanded">
        {{ expanded ? '收起' : '展开' }}
        <component :is="expanded ? ChevronDown : ChevronUp" class="size-3.5" />
      </Button>
    </header>

    <div v-if="!expanded" class="floating-task-summary">
      <template v-if="activeTask">
        <div class="flex items-center justify-between gap-3">
          <p class="truncate text-xs font-medium" :title="activeTask.sourcePath">
            {{ fileName(activeTask.sourcePath) }}
          </p>
          <Badge
            :tone="
              activeTask.status === 'failed'
                ? 'danger'
                : activeTask.status === 'completed'
                  ? 'success'
                  : 'info'
            "
            >{{ statusLabel }}</Badge
          >
        </div>
        <div class="mt-2 flex items-center gap-2">
          <Progress :value="activeTask.progress" />
          <span class="w-9 text-right text-xs tabular-nums text-muted-foreground">{{
            activeTask.progress === null ? '—' : `${Math.round(activeTask.progress)}%`
          }}</span>
        </div>
      </template>
      <p v-else class="text-xs text-muted-foreground">拖入文件后，这里会持续显示处理进度。</p>
    </div>

    <div v-else class="min-h-0 flex-1 overflow-auto p-3 pt-0">
      <TaskTable :tasks="store.tasks" empty-text="暂无任务" />
    </div>
  </section>
</template>
