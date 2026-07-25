<script setup lang="ts">
import { computed } from 'vue'
import { CheckCircle2, TriangleAlert } from '@lucide/vue'
import type { MediaInspection } from '../../../shared/types'
import { fileName, formatBytes } from '../lib/utils'
import Button from './ui/Button.vue'
import Modal from './ui/Modal.vue'

const props = defineProps<{
  open: boolean
  inspections: MediaInspection[]
}>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: []
}>()

const validCount = computed(() => props.inspections.filter((item) => item.valid).length)
const invalidCount = computed(() => props.inspections.length - validCount.value)
const totalSize = computed(() =>
  props.inspections.reduce((total, item) => total + item.sourceSize, 0)
)

function mediaSummary(item: MediaInspection): string {
  const fields: string[] = []
  if (item.format) fields.push(item.format.toUpperCase())
  if (item.width && item.height) fields.push(`${item.width} × ${item.height}`)
  if (item.videoCodec) fields.push(item.videoCodec.toUpperCase())
  if (item.duration) fields.push(formatDuration(item.duration))
  fields.push(formatBytes(item.sourceSize))
  return fields.join(' · ')
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remaining = total % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${minutes}:${String(remaining).padStart(2, '0')}`
}
</script>

<template>
  <Modal
    :open="open"
    title="确认处理任务"
    description="已检查源文件和输出位置。确认后才会加入任务队列。"
    @update:open="emit('update:open', $event)"
  >
    <div class="mt-5 flex items-center gap-3 rounded-md border border-border bg-muted/35 px-4 py-3">
      <div class="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <CheckCircle2 class="size-4 text-emerald-600" />
        可处理 {{ validCount }} 个
      </div>
      <div v-if="invalidCount" class="flex items-center gap-1.5 text-sm font-medium text-red-700">
        <TriangleAlert class="size-4" />
        不可处理 {{ invalidCount }} 个
      </div>
      <span class="ml-auto text-xs text-muted-foreground"
        >源文件共 {{ formatBytes(totalSize) }}</span
      >
    </div>

    <div class="mt-4 max-h-[52vh] overflow-auto rounded-md border border-border">
      <article
        v-for="item in inspections"
        :key="item.sourcePath"
        class="border-b border-border px-4 py-3 last:border-b-0"
      >
        <div class="flex items-start gap-3">
          <component
            :is="item.valid ? CheckCircle2 : TriangleAlert"
            class="mt-0.5 size-4 shrink-0"
            :class="item.valid ? 'text-emerald-600' : 'text-red-600'"
          />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium" :title="item.sourcePath">
              {{ fileName(item.sourcePath) }}
            </p>
            <p v-if="item.valid" class="mt-0.5 text-xs text-muted-foreground">
              {{ mediaSummary(item) }}
            </p>
            <p v-else class="mt-0.5 text-xs text-red-700">{{ item.error }}</p>
            <p class="mt-1 truncate text-xs text-muted-foreground" :title="item.outputPath">
              输出：{{ item.outputPath }}
            </p>
          </div>
        </div>
      </article>
    </div>

    <p v-if="invalidCount" class="mt-3 text-xs text-muted-foreground">
      不可处理的文件不会加入队列，请根据上方原因检查源文件或输出目录。
    </p>

    <div class="mt-5 flex justify-end gap-2">
      <Button variant="secondary" @click="emit('update:open', false)">返回调整</Button>
      <Button :disabled="validCount === 0" @click="emit('confirm')">
        开始处理{{ validCount ? ` (${validCount})` : '' }}
      </Button>
    </div>
  </Modal>
</template>
