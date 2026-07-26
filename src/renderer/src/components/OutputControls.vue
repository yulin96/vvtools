<script setup lang="ts">
import { FolderCog, FolderOpen } from '@lucide/vue'
import type { OutputMode } from '../../../shared/types'
import { useAppStore } from '../stores/app'
import Button from './ui/Button.vue'
import SegmentedControl from './ui/SegmentedControl.vue'

const store = useAppStore()
const outputModeOptions = [
  { value: 'source', label: '原目录' },
  { value: 'custom', label: '指定目录' }
]

async function updateOutputMode(value: string | number): Promise<void> {
  if (!store.settings) return
  const outputMode = value as OutputMode
  try {
    if (outputMode === 'source') {
      await store.updateSettings({ outputMode })
      return
    }

    const path = await window.api.selectOutputDirectory(store.settings.outputDirectory)
    if (path) await store.updateSettings({ outputMode, outputDirectory: path })
  } catch (error) {
    store.errorMessage = error instanceof Error ? error.message : String(error)
  }
}

async function chooseOutput(): Promise<void> {
  if (!store.settings) return
  try {
    const path = await window.api.selectOutputDirectory(store.settings.outputDirectory)
    if (path) await store.updateSettings({ outputMode: 'custom', outputDirectory: path })
  } catch (error) {
    store.errorMessage = error instanceof Error ? error.message : String(error)
  }
}
</script>

<template>
  <div v-if="store.settings" class="header-output-control">
    <SegmentedControl
      class="output-mode-segments"
      label="输出位置"
      hide-label
      :model-value="store.settings.outputMode"
      :options="outputModeOptions"
      @update:model-value="updateOutputMode"
    />
    <Button
      v-if="store.settings.outputMode === 'custom'"
      variant="secondary"
      size="icon"
      :title="`选择输出目录：${store.settings.outputDirectory}`"
      aria-label="选择输出目录"
      @click="chooseOutput"
    >
      <FolderCog class="size-4" />
    </Button>
    <Button
      v-if="store.settings.outputMode === 'custom'"
      variant="secondary"
      size="icon"
      title="打开输出目录"
      aria-label="打开输出目录"
      @click="store.openOutputDirectory()"
    >
      <FolderOpen class="size-4" />
    </Button>
  </div>
</template>
