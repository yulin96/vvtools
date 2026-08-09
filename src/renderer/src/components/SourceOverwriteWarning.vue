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
    aria-label="覆盖模式已开启，同名输出将直接覆盖已有文件，包括同路径的源文件"
    title="输出路径与已有文件相同时将直接替换；与源文件同名时也会替换源文件"
  >
    <TriangleAlert class="size-3.5 shrink-0" aria-hidden="true" />
    同名输出将直接覆盖
  </span>
</template>
