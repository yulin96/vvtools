<script setup lang="ts">
import { computed, ref } from 'vue'
import { History, Pause, Play, RefreshCcw, Trash2, XCircle } from '@lucide/vue'
import type { TaskKind, TaskStatus } from '../../../shared/types'
import { useAppStore } from '../stores/app'
import TaskTable from '../components/TaskTable.vue'
import Button from '../components/ui/Button.vue'
import Modal from '../components/ui/Modal.vue'

type KindFilter = 'all' | TaskKind
type StatusFilter = 'all' | TaskStatus
type DateFilter = 'all' | 'today' | '7days' | '30days'

const store = useAppStore()
const kindFilter = ref<KindFilter>('all')
const statusFilter = ref<StatusFilter>('all')
const dateFilter = ref<DateFilter>('all')
const confirmClearOpen = ref(false)

const retryableCount = computed(
  () => store.tasks.filter((task) => ['failed', 'interrupted'].includes(task.status)).length
)
const pendingCount = computed(() => store.tasks.filter((task) => task.status === 'pending').length)
const finishedCount = computed(
  () => store.tasks.filter((task) => ['completed', 'cancelled'].includes(task.status)).length
)
const filteredTasks = computed(() => {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const cutoff =
    dateFilter.value === 'today'
      ? startOfToday
      : dateFilter.value === '7days'
        ? now.getTime() - 7 * 24 * 60 * 60 * 1000
        : dateFilter.value === '30days'
          ? now.getTime() - 30 * 24 * 60 * 60 * 1000
          : null

  return store.tasks.filter((task) => {
    if (kindFilter.value !== 'all' && task.kind !== kindFilter.value) return false
    if (statusFilter.value !== 'all' && task.status !== statusFilter.value) return false
    return cutoff === null || Date.parse(task.createdAt) >= cutoff
  })
})

async function clearFinished(): Promise<void> {
  await store.clearFinishedTasks()
  confirmClearOpen.value = false
}
</script>

<template>
  <div class="page-container">
    <header class="page-header">
      <div>
        <h1>任务历史</h1>
        <p>查看处理结果、重新执行失败任务并管理本地历史记录。</p>
      </div>
      <div class="page-header-actions flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="secondary"
          :disabled="store.activeCount === 0 && !store.queuePaused"
          @click="store.setQueuePaused(!store.queuePaused)"
        >
          <component :is="store.queuePaused ? Play : Pause" class="size-4" />
          {{ store.queuePaused ? '继续队列' : '暂停队列' }}
        </Button>
        <Button
          variant="secondary"
          :disabled="pendingCount === 0"
          @click="store.cancelPendingTasks()"
        >
          <XCircle class="size-4" />
          取消等待{{ pendingCount ? ` (${pendingCount})` : '' }}
        </Button>
        <Button
          variant="secondary"
          :disabled="retryableCount === 0"
          @click="store.retryFailedTasks()"
        >
          <RefreshCcw class="size-4" />
          重试失败任务{{ retryableCount ? ` (${retryableCount})` : '' }}
        </Button>
        <Button
          variant="secondary"
          :disabled="finishedCount === 0"
          @click="confirmClearOpen = true"
        >
          <Trash2 class="size-4" />
          清除完成/取消
        </Button>
      </div>
    </header>

    <section class="settings-card history-filter-card mb-4 gap-3" aria-label="任务历史筛选">
      <div class="settings-card-title mr-auto">
        <History class="size-4" />
        <div>
          <h2>{{ filteredTasks.length }} 条记录</h2>
          <p>历史记录仅保存在当前设备。</p>
        </div>
      </div>
      <label class="field-label w-36">
        <span>任务类型</span>
        <select v-model="kindFilter" class="field-control">
          <option value="all">全部类型</option>
          <option value="image">图片</option>
          <option value="video">视频</option>
          <option value="audio">音频</option>
        </select>
      </label>
      <label class="field-label w-36">
        <span>任务状态</span>
        <select v-model="statusFilter" class="field-control">
          <option value="all">全部状态</option>
          <option value="pending">等待中</option>
          <option value="processing">处理中</option>
          <option value="completed">已完成</option>
          <option value="failed">失败</option>
          <option value="interrupted">异常中断</option>
          <option value="cancelled">已取消</option>
        </select>
      </label>
      <label class="field-label w-36">
        <span>创建时间</span>
        <select v-model="dateFilter" class="field-control">
          <option value="all">全部时间</option>
          <option value="today">今天</option>
          <option value="7days">最近 7 天</option>
          <option value="30days">最近 30 天</option>
        </select>
      </label>
    </section>

    <TaskTable :tasks="filteredTasks" empty-text="没有符合条件的任务" />
  </div>

  <Modal
    :open="confirmClearOpen"
    title="清除已完成和已取消记录？"
    description="只会删除任务记录，不会删除已经生成的媒体文件。"
    @update:open="confirmClearOpen = $event"
  >
    <div class="mt-6 flex justify-end gap-2">
      <Button variant="secondary" @click="confirmClearOpen = false">取消</Button>
      <Button @click="clearFinished">确认清除</Button>
    </div>
  </Modal>
</template>
