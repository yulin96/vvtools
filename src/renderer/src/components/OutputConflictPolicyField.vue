<script setup lang="ts">
import { TriangleAlert } from '@lucide/vue'
import type { OutputConflictPolicy } from '../../../shared/types'
import { useAppStore } from '../stores/app'
import SegmentedControl from './ui/SegmentedControl.vue'

const store = useAppStore()
const conflictPolicyOptions = [
  { value: 'rename', label: '编号', title: '同名时自动添加编号' },
  { value: 'overwrite', label: '覆盖', title: '成功处理后替换已有文件' },
  { value: 'skip', label: '跳过', title: '同名时不创建任务' }
]

function updateConflictPolicy(value: string | number): void {
  void store.updateSettings({ outputConflictPolicy: value as OutputConflictPolicy })
}
</script>

<template>
  <div v-if="store.settings" class="output-conflict-control">
    <SegmentedControl
      class="conflict-policy-segments"
      label="同名文件"
      :model-value="store.settings.outputConflictPolicy"
      :options="conflictPolicyOptions"
      @update:model-value="updateConflictPolicy"
    />
    <span
      v-if="
        store.settings.outputMode === 'source' &&
        store.settings.outputConflictPolicy === 'overwrite'
      "
      class="source-overwrite-warning"
      title="如果输出路径与源文件相同，成功处理后将替换源文件"
    >
      <TriangleAlert class="size-3.5" />
      原目录覆盖模式
    </span>
  </div>
</template>
