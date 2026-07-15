<script setup lang="ts">
import { computed, ref } from 'vue'
import { ListTodo } from '@lucide/vue'
import type { TaskStatus } from '../../../shared/types'
import { useAppStore } from '../stores/app'
import TaskTable from '../components/TaskTable.vue'

const store = useAppStore()
const filter = ref<'all' | TaskStatus>('all')
const filteredTasks = computed(() =>
  filter.value === 'all' ? store.tasks : store.tasks.filter((task) => task.status === filter.value)
)
const filters: { value: 'all' | TaskStatus; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '等待中' },
  { value: 'processing', label: '处理中' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' }
]
</script>

<template>
  <div class="page-container">
    <header class="page-header">
      <div>
        <h1>任务队列</h1>
        <p>查看所有媒体任务的进度、结果和失败信息。</p>
      </div>
      <div class="flex items-center gap-2 text-sm text-muted-foreground">
        <ListTodo class="size-4" />共 {{ store.tasks.length }} 个任务
      </div>
    </header>
    <div class="flex flex-wrap gap-1 rounded-lg border border-border bg-background p-1.5">
      <button
        v-for="item in filters"
        :key="item.value"
        class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
        :class="
          filter === item.value
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-muted'
        "
        @click="filter = item.value"
      >
        {{ item.label }}
      </button>
    </div>
    <TaskTable :tasks="filteredTasks" empty-text="当前筛选条件下暂无任务" />
  </div>
</template>
