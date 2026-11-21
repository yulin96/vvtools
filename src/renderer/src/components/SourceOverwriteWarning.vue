<script setup lang="ts">
import { computed } from 'vue'
import { TriangleAlert } from '@lucide/vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const visible = computed(() => store.settings?.common.outputConflictPolicy === 'overwrite')
</script>

<template>
  <span
    v-if="visible"
    class="source-overwrite-warning"
    role="status"
    aria-live="polite"
    aria-atomic="true"
    aria-label="覆盖模式已开启。处理成功后，同名文件（含原文件）或已识别的 VVTools 输出目录移入回收站，其他同名目录自动编号"
    title="同名文件（含原文件）或已识别的 VVTools 输出目录会移入回收站，其他同名目录自动编号"
  >
    <TriangleAlert class="size-3.5 shrink-0" aria-hidden="true" />
    <span class="truncate">覆盖模式 · 同名文件和已识别的输出目录移入回收站</span>
  </span>
</template>
