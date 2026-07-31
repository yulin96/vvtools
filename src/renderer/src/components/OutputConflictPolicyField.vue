<script setup lang="ts">
import type { OutputConflictPolicy } from '../../../shared/types'
import { useAppStore } from '../stores/app'
import SegmentedControl from './ui/SegmentedControl.vue'

const store = useAppStore()
const conflictPolicyOptions = [
  { value: 'rename', label: '自动编号', title: '同名时自动添加编号' },
  { value: 'overwrite', label: '覆盖旧文件', title: '成功处理后替换已有文件' },
  { value: 'skip', label: '跳过新文件', title: '同名时不创建任务' }
]

function updateConflictPolicy(value: string | number): void {
  void store.updateSettings({
    common: { outputConflictPolicy: value as OutputConflictPolicy }
  })
}
</script>

<template>
  <SegmentedControl
    v-if="store.settings"
    class="conflict-policy-segments"
    label="同名文件"
    :model-value="store.settings.common.outputConflictPolicy"
    :options="conflictPolicyOptions"
    @update:model-value="updateConflictPolicy"
  />
</template>
