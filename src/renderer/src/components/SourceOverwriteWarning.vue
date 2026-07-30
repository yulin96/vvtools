<script setup lang="ts">
import { TriangleAlert } from '@lucide/vue'
import { computed } from 'vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const visible = computed(
  () =>
    store.settings?.outputMode === 'source' && store.settings.outputConflictPolicy === 'overwrite'
)
</script>

<template>
  <Transition name="source-overwrite">
    <span
      v-if="visible"
      class="source-overwrite-warning"
      title="如果输出路径与源文件相同，成功处理后将替换源文件"
    >
      <TriangleAlert class="size-3.5" />
      原目录覆盖模式
    </span>
  </Transition>
</template>
