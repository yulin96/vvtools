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
    aria-label="覆盖模式已开启，处理成功后已有同名文件会移入系统回收站，再写入新文件，包括与源文件同路径的原文件"
    title="处理成功后，已有同名文件会先移入系统回收站；与源文件同名时，原文件也会移入回收站"
  >
    <TriangleAlert class="size-3.5 shrink-0" aria-hidden="true" />
    同名文件将移到回收站
  </span>
</template>
